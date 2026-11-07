// Public-engine grove correspondence and lifecycle, using routed local files and a pumped clock.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),render=process.argv.includes('--render');
const fixture=JSON.parse(await readFile(resolve(root,'test-gl/fixtures/fall-park.json'),'utf8'));
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({channel:'chromium',args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--force-color-profile=srgb']});
try{
 const W=render?640:320,H=render?360:180,page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});page.setDefaultTimeout(300000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('http://grove.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:${W}px;height:${H}px}</style><script>${clock}</script>`});
  await route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,`.${path}`))});
 });
 await page.goto('http://grove.test/');
 const results=await page.evaluate(async({fixture,W,H,render})=>{
  const {create}=await import('/komorebi.js');
  const tune={branch_levels:2,branch_children:2,limb_count:3,foliage_density:1,sample_count:5,tex_resolution:256,bake_resolution:256,
   fill_directions:4,fill_resolution:64,litter_resolution:256,wind_strength:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
  const A={...fixture.from,...tune,tree_count:2,leaves_per_cluster:12,phenology:.85,leaf_drop:.6},B={...fixture.to,...tune,tree_count:1,leaves_per_cluster:6};
  let e,c,last,stamp=0;const step=Math.floor(1000/60*2**20)/2**20,results=[];
  const need=(ok,msg)=>{if(!ok)throw Error(msg);};
  const diff=(a,b)=>a.reduce((m,v,i)=>Math.max(m,Math.abs(v-b[i])),0);
  const pump=(n=1)=>{for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}};
  function open(p){
   e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;
   c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
   e.onFrame=()=>{const g=e.gl;last=new Uint8Array(c.width*c.height*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,last);need(!g.getError(),'WebGL error');};pump();
  }
  if(render){
   open({...fixture.from,auto_quality:false,adaptive_motion:false});pump(119);let previous=null;
   const target={...fixture.to,auto_quality:false,adaptive_motion:false},enc=document.createElement('canvas');enc.width=W;enc.height=H;const ctx=enc.getContext('2d'),im=ctx.createImageData(W,H);
   window.__render=n=>{
    if(n===60){e.transitionTo(target,{duration:4});need(e.trans.groveTravel,'authored pair did not select grove travel');}pump();
    const p=last;let luma=0,delta=0;for(let i=0;i<p.length;i+=4){luma+=.2126*p[i]+.7152*p[i+1]+.0722*p[i+2];if(previous)for(let k=0;k<3;k++)delta+=Math.abs(p[i+k]-previous[i+k]);}
    for(let y=0;y<H;y++)im.data.set(p.subarray((H-y-1)*W*4,(H-y)*W*4),y*W*4);ctx.putImageData(im,0,0);previous=p;
    return {png:enc.toDataURL('image/png'),t:e.trans.t,luma:luma/(W*H),delta:delta/(W*H*3),groveTravel:!!e.trans.groveTravel,bloom:e.trans.bloom};
   };
   window.__dispose=()=>e.dispose();return results;
  }
  open(A);need(e.grove().litter.length>0,'reduced fixture needs actual carpet leaves');const nativeA=last.slice();open(B);const nativeB=last.slice();
  open(A);e.transitionTo({...B,phyllotaxis:A.phyllotaxis},{duration:.1});while(e.trans.active)pump();need(e.params.tree_count===B.tree_count,'same-grammar tree-count landing');
  for(const [from,to,first,final]of[[A,B,nativeA,nativeB],[B,A,nativeB,nativeA]]){
   open(from);const original=e.grove();let ended=0;e.transitionTo(to,{duration:.25,onEnd:()=>ended++});need(e.trans.groveTravel,'wrong route');
   window.__clock.pump(stamp);const sourceDelta=diff(first,last);need(sourceDelta===0,`source changed ${sourceDelta}`);
   let frames=0,before;while(e.trans.active&&frames++<40){before=last.slice();pump();if(e.trans.active){need(e.grove()===original,'native grove replaced before landing');need(!e.trans.sceneFade&&!e.trans.swapped&&e.trans.bloom===0,'scene fade or midpoint swap');}}
   const landingDelta=diff(before,last),nativeDelta=diff(final,last);need(nativeDelta===0,`native target changed ${nativeDelta}`);need(landingDelta<=1,`static landing jumped ${landingDelta}`);
   need(ended===1&&!e.trans.groveTravel,'completion state');results.push({direction:from.litter?'floor to park':'park to floor',sourceDelta,landingDelta,nativeDelta});
  }
  open(A);e.transitionTo(B,{duration:1});pump(35);const middle=last.slice(),time=e.motion.time;window.__clock.pump(stamp);need(diff(middle,last)===0&&e.motion.time===time,'zero-time redraw moved the field');
  e.transitionTo(A,{duration:.25});window.__clock.pump(stamp);need(diff(middle,last)===0,'reversal changed the field');while(e.trans.active)pump();need(diff(nativeA,last)===0,'reversal did not restore native source');
  open(A);const g=e.gl,live=new Map();
  for(const type of ['Buffer','Texture','Program','Framebuffer','VertexArray']){
   const made=g[`create${type}`].bind(g),freed=g[`delete${type}`].bind(g),set=new Set();live.set(type,set);
   g[`create${type}`]=(...args)=>{const value=made(...args);set.add(value);return value;};g[`delete${type}`]=value=>{set.delete(value);return freed(value);};
  }
  e.transitionTo(B,{duration:.25});pump(10);e.transitionTo(A,{duration:.25});while(e.trans.active)pump();
  const leaked=Object.fromEntries([...live].map(([k,v])=>[k,v.size]));need(Object.values(leaked).every(n=>n===0),`temporary resource leak ${JSON.stringify(leaked)}`);
  open(A);e.transitionTo({...B,adaptive_motion:true},{duration:.1});while(e.trans.active)pump();pump();need(diff(nativeB,last)===0,'adaptive still landing');
  open(A);e.transitionTo(B,{duration:1});pump(30);c.style.width='360px';pump();need(c.width===360,'field resize');
  open(A);e.transitionTo(B,{duration:1});pump(30);e.setParams(B);window.__clock.pump(stamp);need(diff(nativeB,last)===0&&!e.trans.groveTravel,'hard replacement');
  const C={...B,exposure:B.exposure+.2};open(C);const nativeC=last.slice();open(A);let cancelled=0,queued=0;
  e.transitionTo(B,{duration:.25,onEnd:()=>cancelled++});pump(10);e.transitionTo({...B,seed:123},{duration:.1});e.transitionTo(C,{duration:.1,onEnd:()=>queued++});
  let frames=0;while(e.trans.active&&frames++<160)pump();need(queued===1&&cancelled===0&&diff(nativeC,last)===0,'latest queued target');
  open({...A,phenology:0});e.transitionTo(B,{duration:.1});need(!e.trans.groveTravel,'empty carpet must decline preparation');
  results.push({zeroTime:true,reversal:true,temporaryResourcesReleased:leaked,adaptiveStill:true,resize:true,hardReplacement:true,latestQueue:true,emptyCarpetFallback:true});
  const movingA={...A,wind_strength:1,drift_auto:true},movingB={...B,wind_strength:1,drift_auto:true};
  open(movingA);const start=e.motion.time;e.transitionTo(movingB,{duration:.25});while(e.trans.active)pump();
  const elapsed=e.motion.time-start;need(Math.abs(elapsed-31*step/1000)<1e-8,`wind clock reset or doubled ${elapsed}`);const phase=e.params.drift_phase;pump();need(Math.abs(e.params.drift_phase-phase-movingB.drift_speed*step/1000)<1e-8,'destination drift clock');
  open(movingA);e.transitionTo(movingB,{duration:1});pump(120);const almost=last.slice();e.trans.t=1;window.__clock.pump(stamp);const movingLandingDelta=diff(almost,last);need(movingLandingDelta<=1,`destination motion jumped ${movingLandingDelta}`);
  open({...B,bake_resolution:512});const nativeQuality=last.slice();
  open({...A,bake_resolution:512});e.perf.auto=true;e.perf.quality=.3;e.perf.sampleCount=5;e.transitionTo({...B,bake_resolution:512},{duration:.25});while(e.trans.active)pump();need(diff(nativeQuality,last)===0,'quality landing differs from native target');
  results.push({elapsed,movingLandingDelta,autoQuality:true});
  open(A);e.transitionTo(B,{duration:1});pump(20);e.transitionTo(C,{duration:.1});window.__loss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),nativeC};
  return results;
 },{fixture,W,H,render});
 for(const r of results)console.log('PASS',JSON.stringify(r));
 if(render){
  const out=resolve(root,'test-gl/out/review/2026-11-07-fall-memoriez-to-park-2/integrated');await mkdir(resolve(out,'frames'),{recursive:true});const frames=[];
  for(let n=0;n<600;n++){const f=await page.evaluate(n=>window.__render(n),n);await writeFile(resolve(out,'frames',`${String(n).padStart(4,'0')}.png`),Buffer.from(f.png.split(',')[1],'base64'));delete f.png;frames.push({frame:n,...f});if(n%60===0)console.log('FRAME',n,JSON.stringify(f));}
  await writeFile(resolve(out,'frames.json'),JSON.stringify(frames,null,2));await page.evaluate(()=>window.__dispose());
 }else{
  await page.evaluate(()=>window.__loss.ext.loseContext());await page.waitForFunction(()=>window.__loss.e.gl.isContextLost());await page.waitForTimeout(100);
  await page.evaluate(()=>window.__loss.ext.restoreContext());await page.waitForFunction(()=>!window.__loss.e.gl.isContextLost());
  const recovery=await page.evaluate(()=>{const {e,stamp,step,nativeC}=window.__loss;let max=-1;e.onFrame=()=>{const g=e.gl,p=new Uint8Array(nativeC.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,p);max=p.reduce((m,v,i)=>Math.max(m,Math.abs(v-nativeC[i])),0);};window.__clock.pump(stamp+step);const error=e.gl.getError();e.dispose();return {max,error};});
  assert.deepEqual(recovery,{max:0,error:0});console.log('PASS context recovery',JSON.stringify(recovery));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
