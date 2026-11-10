// Public-engine shadow descent checks, using a pumped clock and local-file routes without a server.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),render=process.argv.includes('--render');
const fixture=JSON.parse(await readFile(resolve(root,'test-gl/fixtures/purple-look-up.json'),'utf8'));
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({channel:'chromium',args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--force-color-profile=srgb']});
try{
 const W=render?640:320,H=render?360:180,page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});page.setDefaultTimeout(300000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('http://shadowfall.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:${W}px;height:${H}px}</style><script>${clock}</script>`});
  await route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,`.${path}`))});
 });
 await page.goto('http://shadowfall.test/');
 const results=await page.evaluate(async({fixture,W,H,render})=>{
  const {create}=await import('/komorebi.js');
  const small={tree_count:1,branch_levels:2,branch_children:2,limb_count:4,leaves_per_cluster:16,foliage_density:1.4,sample_count:5,
   tex_resolution:256,bake_resolution:256,fill_directions:4,fill_resolution:64,litter_resolution:256,
   wind_strength:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
  const A={...fixture.to,...small},B={...fixture.from,...small};
  let e,c,last,stamp=0;const step=Math.floor(1000/60*2**20)/2**20,results=[];
  const need=(ok,msg)=>{if(!ok)throw Error(msg);};
  const diff=(a,b)=>a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0);
  const mean=(a,b)=>a.reduce((s,v,i)=>s+(i%4===3?0:Math.abs(v-b[i])),0)/(a.length/4*3);
  const pump=(n=1)=>{for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}};
  function open(p){
   e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;
   c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
   e.onFrame=()=>{const g=e.gl;last=new Uint8Array(c.width*c.height*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,last);need(!g.getError(),'WebGL error');};pump();
  }
  open(A);const nativeA=last.slice();open(B);const nativeB=last.slice();
  open(A);let ended=0;const grove=e.grove().hier;e.transitionTo(B,{duration:1,onEnd:()=>ended++});
  need(e.trans.shadowFall&&e.trans.litterRise,'descent still uses the scene swap');
  window.__clock.pump(stamp);const sourceDelta=diff(nativeA,last);need(sourceDelta===0,'native sky changed at preparation');
  let previous=last.slice(),maxStep=0;
  for(let i=0;i<120;i++){
   pump();need(e.params.sky_view&&e.grove().hier===grove,'sky grove replaced before landing');
   need(e.trans.bloom===0&&!e.trans.swapped,'bloom or midpoint swap');maxStep=Math.max(maxStep,mean(previous,last));previous=last.slice();
  }
  const before=last.slice();pump();const landingDelta=diff(before,last);
  need(landingDelta<=2,`landing jump ${landingDelta}`);need(diff(nativeB,last)===0,'settled floor differs from native');
  need(ended===1&&!e.trans.shadowFall&&!e.trans.litterRise,'completion state');need(maxStep<40,`scene-sized step ${maxStep}`);
  results.push({sourceDelta,landingDelta,maxStep});
  open(A);e.transitionTo({...B,adaptive_motion:true},{duration:.1});while(e.trans.active)pump();pump();need(diff(nativeB,last)===0,'idle adaptive floor landing');
  open(A);e.transitionTo(B,{duration:1});pump(40);const still=last.slice();window.__clock.pump(stamp);need(diff(still,last)===0,'zero-time redraw moved the flight');
  c.style.width='360px';pump();need(c.width===360,'moving field did not resize');
  open(A);e.transitionTo(B,{duration:1});pump(40);e.setParams(A);window.__clock.pump(stamp);need(diff(nativeA,last)===0,'hard replacement kept the floor scene');
  const C={...B,exposure:B.exposure+.2};open(C);const nativeC=last.slice();open(A);let cancelled=0,queued=0;
  e.transitionTo(B,{duration:.25,onEnd:()=>cancelled++});pump(10);e.transitionTo({...B,seed:123},{duration:.1});e.transitionTo(C,{duration:.1,onEnd:()=>queued++});
  let ticks=0;while(e.trans.active&&ticks++<180)pump();need(queued===1&&cancelled===0,'queued callbacks');need(diff(nativeC,last)===0,'latest queued floor');
  results.push({adaptiveIdle:true,zeroTimeRedraw:true,resize:true,hardReplacement:true,latestQueue:true});
  const liveA={...A,wind_strength:1,drift_auto:true},liveB={...B,wind_strength:1,drift_auto:true,adaptive_motion:true};
  open(liveA);const time=e.motion.time;e.transitionTo(liveB,{duration:1});let phase=e.params.drift_phase;
  while(e.trans.active){pump();const d=(e.params.drift_phase-phase+2*Math.PI)%(2*Math.PI);need(Math.abs(d-liveB.drift_speed*step/1000)<1e-8,`drift jumped at landing ${d}`);phase=e.params.drift_phase;}
  const elapsed=e.motion.time-time;need(Math.abs(elapsed-121*step/1000)<1e-8,`wind reset or advanced twice ${elapsed}`);
  const landed=e.motion.time;pump();need(e.motion.time-landed<.034,'adaptive clock accumulated the journey');results.push({elapsed,adaptiveStep:e.motion.time-landed});
  open(liveA);e.transitionTo({...liveB,adaptive_motion:false},{duration:1});pump(120);const flying=last.slice();
  e.trans.t=1;window.__clock.pump(stamp);const movingLandingDelta=diff(flying,last);need(movingLandingDelta<=2,`floor springs changed on installation ${movingLandingDelta}`);
  results.push({movingLandingDelta});
  if(render){
   open({...fixture.to,auto_quality:false,adaptive_motion:false});pump(119);let previous=null;
   const enc=document.createElement('canvas');enc.width=W;enc.height=H;const ctx=enc.getContext('2d'),im=ctx.createImageData(W,H);
   window.__render=n=>{
    if(n===60)e.transitionTo({...fixture.from,auto_quality:false,adaptive_motion:false},{duration:4});pump();
    const p=last;let luma=0,delta=0;for(let i=0;i<p.length;i+=4){luma+=.2126*p[i]+.7152*p[i+1]+.0722*p[i+2];if(previous)for(let k=0;k<3;k++)delta+=Math.abs(p[i+k]-previous[i+k]);}
    for(let y=0;y<H;y++)im.data.set(p.subarray((H-y-1)*W*4,(H-y)*W*4),y*W*4);ctx.putImageData(im,0,0);previous=p;
    return {png:enc.toDataURL('image/png'),t:e.trans.t,luma:luma/(W*H),delta:delta/(W*H*3),shadowFall:!!e.trans.shadowFall,bloom:e.trans.bloom};
   };
   window.__dispose=()=>e.dispose();
  }else{
   open(A);e.transitionTo(B,{duration:1});pump(35);e.transitionTo(C,{duration:1});
   window.__loss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),nativeC};
  }
  return results;
 },{fixture,W,H,render});
 for(const r of results)console.log('PASS',JSON.stringify(r));
 if(render){
  const out=resolve(root,'test-gl/out/look-up-to-purple-eye/integrated');await mkdir(resolve(out,'frames'),{recursive:true});const frames=[];
  for(let n=0;n<600;n++){const f=await page.evaluate(n=>window.__render(n),n);await writeFile(resolve(out,'frames',`${String(n).padStart(4,'0')}.png`),Buffer.from(f.png.split(',')[1],'base64'));delete f.png;frames.push({frame:n,...f});if(n%60===0)console.log('FRAME',n,JSON.stringify(f));}
  await writeFile(resolve(out,'frames.json'),JSON.stringify(frames,null,2));await page.evaluate(()=>window.__dispose());
 }else{
  await page.evaluate(()=>window.__loss.ext.loseContext());await page.waitForFunction(()=>window.__loss.e.gl.isContextLost());await page.waitForTimeout(100);
  await page.evaluate(()=>window.__loss.ext.restoreContext());await page.waitForFunction(()=>!window.__loss.e.gl.isContextLost());
  const recovery=await page.evaluate(()=>{
   const {e,stamp,step,nativeC}=window.__loss;let max=-1;e.onFrame=()=>{const g=e.gl,p=new Uint8Array(nativeC.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,p);max=p.reduce((m,v,i)=>Math.max(m,Math.abs(v-nativeC[i])),0);};
   window.__clock.pump(stamp+step);const error=e.gl.getError();e.dispose();return {max,error};
  });assert.deepEqual(recovery,{max:0,error:0});console.log('PASS context recovery',JSON.stringify(recovery));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
