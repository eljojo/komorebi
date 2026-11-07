// Exercise the public engine with a pumped clock and route-fulfilled files; no server.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),render=process.argv.includes('--render');
const fixture=JSON.parse(await readFile(resolve(root,'test-gl/fixtures/fall-look-up.json'),'utf8'));
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({channel:'chromium',args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--force-color-profile=srgb']});
try{
 const W=render?640:320,H=render?360:180,page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});page.setDefaultTimeout(300000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('http://rise.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:${W}px;height:${H}px}</style><script>${clock}</script>`});
  try{await route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,`.${path}`))});}catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('http://rise.test/');
 const result=await page.evaluate(async({fixture,W,H,render})=>{
  const {create}=await import('/komorebi.js');
  const small={tree_count:1,branch_levels:2,branch_children:2,limb_count:4,leaves_per_cluster:16,foliage_density:1.4,sample_count:5,
   tex_resolution:256,bake_resolution:256,fill_directions:4,fill_resolution:64,litter_resolution:256,
   wind_strength:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
  const A={...fixture.from,...small},B={...fixture.to,...small};
  let e,c,last,stamp=0,read=true;const step=Math.floor(1000/60*2**20)/2**20,results=[];
  const need=(ok,msg)=>{if(!ok)throw Error(msg);},diff=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
  function pump(n=1){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
  function open(p){e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
   e.onFrame=()=>{if(read){const g=e.gl;last=new Uint8Array(c.width*c.height*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,last);}const error=e.gl.getError();need(!error,`WebGL ${error}`);};pump();}
  open(A);const nativeA=last.slice();open(B);const nativeB=last.slice();
  open(A);let ended=0;e.transitionTo(B,{duration:1,onEnd:()=>ended++});need(e.trans.litterRise,'wrong litter route');window.__clock.pump(stamp);
  const sourceDelta=diff(nativeA,last);need(sourceDelta===0,`source changed ${sourceDelta}`);
  pump(120);const before=last.slice();need(e.trans.active,'expected last flying frame');e.setParams(B);window.__clock.pump(stamp);
  const landingDelta=diff(before,last);need(landingDelta<=2,`landing jump ${landingDelta}`);results.push({sourceDelta,landingDelta});
  open(A);ended=0;e.transitionTo(B,{duration:.25,onEnd:()=>ended++});while(e.trans.active)pump();need(ended===1,'completion callback');need(diff(nativeB,last)===0,'native target');
  open(A);e.transitionTo({...B,adaptive_motion:true},{duration:.1});while(e.trans.active)pump();pump();need(diff(nativeB,last)===0,'idle adaptive landing');
  open(A);e.transitionTo(B,{duration:.5});pump(20);const still=last.slice();window.__clock.pump(stamp);need(diff(still,last)===0,'zero-time redraw moved leaves');
  c.style.width='360px';pump();need(c.width===360,'mid-flight resize');while(e.trans.active)pump();
  open(A);e.transitionTo(B,{duration:1});pump(20);e.setParams(A);pump();need(diff(nativeA,last)===0,'hard replacement');
  const C={...B,exposure:B.exposure+.2};open(C);const nativeC=last.slice();open(A);let cancelled=0,arrived=0;
  e.transitionTo(B,{duration:.25,onEnd:()=>cancelled++});pump(10);e.transitionTo({...A,seed:123},{duration:.1});e.transitionTo(C,{duration:.1,onEnd:()=>arrived++});
  let frames=0;while(e.trans.active&&frames++<150)pump();need(arrived===1&&cancelled===0,'queued callbacks');need(diff(nativeC,last)===0,'latest queued target');results.push({queue:true,resize:true,cancel:true});
  const liveA={...A,wind_strength:1,drift_auto:true},liveB={...B,wind_strength:1,drift_auto:true,adaptive_motion:true};
  open(liveA);const time=e.motion.time;e.transitionTo(liveB,{duration:1});let phase=e.params.drift_phase;
  while(e.trans.active){pump();need((e.params.drift_phase-phase+Math.PI*2)%(Math.PI*2)>0,'drift froze');phase=e.params.drift_phase;}
  const elapsed=e.motion.time-time;need(Math.abs(elapsed-121*step/1000)<1e-8,`wind advanced twice ${elapsed}`);
  const landed=e.motion.time;pump();need(e.motion.time-landed<.034,'adaptive clock accumulated transition time');results.push({elapsed,adaptiveStep:e.motion.time-landed});
  open(liveA);e.transitionTo({...liveB,adaptive_motion:false},{duration:1});pump(120);const liveBefore=last.slice(),pose=structuredClone(e.snapshotMotion());
  e.setParams({...liveB,adaptive_motion:false,drift_phase:pose.dphase});e.setMotionSource({snapshotMotion:()=>pose});window.__clock.pump(stamp);e.setMotionSource(null);
  const movingLandingDelta=diff(liveBefore,last);need(movingLandingDelta<=2,`moving landing ${movingLandingDelta}`);results.push({movingLandingDelta});
  if(render){
   read=false;open(fixture.from);pump(119);const real=window.__clock.realNow,start=real();e.transitionTo(fixture.to,{duration:4});const setupMs=real()-start;
   const enc=document.createElement('canvas');enc.width=W;enc.height=H;const ctx=enc.getContext('2d'),im=ctx.createImageData(W,H);
   let prev=null;
   window.__render=(hold)=>{const start=real();if(hold)window.__clock.pump(stamp);else pump();const frameMs=real()-start,g=e.gl,pixels=new Uint8Array(W*H*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,W,H,g.RGBA,g.UNSIGNED_BYTE,pixels);
    let luma=0,delta=0;for(let i=0;i<pixels.length;i+=4){luma+=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];if(prev)for(let k=0;k<3;k++)delta+=Math.abs(pixels[i+k]-prev[i+k]);}
    for(let y=0;y<H;y++)im.data.set(pixels.subarray((H-y-1)*W*4,(H-y)*W*4),y*W*4);ctx.putImageData(im,0,0);prev=pixels;
    return {png:enc.toDataURL('image/png'),t:e.trans.t,frameMs,luma:luma/(W*H),delta:delta/(W*H*3)};};
   // Hold the displayed outgoing pose before the journey starts.
   window.__hold=()=>{window.__clock.pump(stamp);const g=e.gl;g.finish();};
   window.__dispose=()=>e.dispose();results.push({setupMs,fullRoute:e.trans.litterRise});
  }else{open(A);e.transitionTo(B,{duration:1});pump(35);e.transitionTo(C,{duration:1});window.__loss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),nativeC};}
  return results;
 },{fixture,W,H,render});
 for(const r of result)console.log('PASS',JSON.stringify(r));
 if(render){
  const out=resolve(root,'test-gl/out/fall-to-look-up/integrated');await mkdir(resolve(out,'frames'),{recursive:true});
  const stats=[];await page.evaluate(()=>window.__hold());
  for(let i=0;i<600;i++){const f=await page.evaluate(hold=>window.__render(hold),i<60);await writeFile(resolve(out,'frames',`${String(i).padStart(4,'0')}.png`),Buffer.from(f.png.split(',')[1],'base64'));delete f.png;stats.push({frame:i,...f});if(i%60===0)console.log('FRAME',i,JSON.stringify(f));}
  await writeFile(resolve(out,'frames.json'),JSON.stringify(stats,null,2));await page.evaluate(()=>window.__dispose());
 }else{
  await page.evaluate(()=>window.__loss.ext.loseContext());await page.waitForFunction(()=>window.__loss.e.gl.isContextLost());await page.waitForTimeout(100);
  await page.evaluate(()=>window.__loss.ext.restoreContext());await page.waitForFunction(()=>!window.__loss.e.gl.isContextLost());
  const recovery=await page.evaluate(()=>{const {e,stamp,step,nativeC}=window.__loss;let delta=-1;e.onFrame=()=>{const g=e.gl,b=new Uint8Array(nativeC.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,b);delta=b.reduce((m,x,i)=>Math.max(m,Math.abs(x-nativeC[i])),0);};window.__clock.pump(stamp+step);const error=e.gl.getError();e.dispose();return {delta,error};});
  assert.deepEqual(recovery,{delta:0,error:0});console.log('PASS context recovery',JSON.stringify(recovery));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
