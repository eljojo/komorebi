// Public-engine regressions and optional review render; local modules are route-fulfilled, with no server.
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {assemble} from '../embed-build.mjs';
const root=resolve(import.meta.dirname,'..'),render=process.argv.includes('--render');
const bundled=process.argv.includes('--without-seasonal');
const sources=bundled?assemble({looks:['canopy 1','park 1'],features:['leafDiffuse'],strip:false}).files:null;
const fixture=JSON.parse(await readFile(resolve(root,'test-gl/fixtures/purple-look-up.json'),'utf8'));
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({channel:'chromium',args:['--use-gl=angle','--use-angle=metal','--enable-gpu','--force-color-profile=srgb']});
try{
 const W=render?640:320,H=render?360:180,page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});page.setDefaultTimeout(300000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('http://shadow.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:${W}px;height:${H}px}</style><script>${clock}</script>`});
  await route.fulfill({contentType:'text/javascript',body:sources?.[path.slice(1)]??await readFile(resolve(root,`.${path}`))});
 });
 await page.goto('http://shadow.test/');
 const results=await page.evaluate(async({fixture,W,H,render})=>{
  const {create}=await import('/komorebi.js');
  const small={tree_count:1,branch_levels:2,branch_children:2,limb_count:4,leaves_per_cluster:16,foliage_density:1.4,
   sample_count:5,tex_resolution:256,bake_resolution:256,fill_resolution:64,fill_directions:4,litter_resolution:256,
   wind_strength:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
  const A={...fixture.from,...small},B={...fixture.to,...small};
  let e,c,last,stamp=0;const step=Math.floor(1000/60*2**20)/2**20,results=[];
  const need=(ok,msg)=>{if(!ok)throw Error(msg);};
  const diff=(a,b)=>{let max=0,mean=0;for(let i=0;i<a.length;i++)if(i%4!==3){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);mean+=d;}return {max,mean:mean/(a.length/4*3)};};
  const pump=(n=1)=>{for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}};
  const open=p=>{
   e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;
   c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
   e.onFrame=()=>{const g=e.gl;last=new Uint8Array(c.width*c.height*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,last);need(!g.getError(),'WebGL error');};pump();
  };
  open(A);const nativeA=last.slice();open(B);const nativeB=last.slice();
  open(A);let arrived=0;e.transitionTo(B,{duration:1,onEnd:()=>arrived++});
  need(e.trans.shadowRise&&e.trans.litterRise,'shadow pickup still falls back to a grove swap');
  window.__clock.pump(stamp);const source=diff(nativeA,last);need(source.max===0,'native source changed');
  const grove=e.grove?.().hier;let maxStep=0,previous=last.slice();
  for(let i=0;i<120;i++){
   pump();need(e.trans.bloom===0,'extra cloud bloom');need(e.trans.shadowRise&&!e.trans.swapped,'midpoint scene swap');
   if(grove)need(e.grove().hier===grove,'midpoint grove rebuild');
   maxStep=Math.max(maxStep,diff(previous,last).mean);previous=last.slice();
  }
  need(e.trans.active,'expected final moving frame');const flying=last.slice();
  e.setParams(B);window.__clock.pump(stamp);const handoff=diff(flying,last);need(handoff.mean<.05,`native sky handoff ${handoff.mean}`);
  need(diff(nativeB,last).max===0,'target differs from its native frame');need(maxStep<40,`scene-sized frame step ${maxStep}`);
  results.push({source,handoff,maxStep});
  open(A);e.transitionTo(B,{duration:.25,onEnd:()=>arrived++});while(e.trans.active)pump();
  need(arrived===1,'completion callback');need(!e.trans.shadowRise,'pickup state survived landing');need(diff(nativeB,last).max===0,'natural native landing');
  open(A);e.transitionTo(B,{duration:1});pump(40);const still=last.slice();window.__clock.pump(stamp);need(diff(still,last).max===0,'zero-time redraw moved leaves');
  c.style.width='360px';pump();need(c.width===360,'moving field did not resize');
  open(A);e.transitionTo(B,{duration:1});pump(40);e.setParams(A);window.__clock.pump(stamp);need(diff(nativeA,last).max===0,'hard replacement did not release pickup');
  const C={...B,exposure:B.exposure+.2};open(C);const nativeC=last.slice();open(A);let cancelled=0,queued=0;
  e.transitionTo(B,{duration:.25,onEnd:()=>cancelled++});pump(10);
  e.transitionTo({...B,exposure:.1},{duration:.1});e.transitionTo(C,{duration:.1,onEnd:()=>queued++});
  let ticks=0;while(e.trans.active&&ticks++<150)pump();need(queued===1&&cancelled===0,'queued callbacks');need(diff(nativeC,last).max===0,'latest queued look');
  results.push({nativeLanding:true,zeroTimeRedraw:true,resize:true,hardReplacement:true,latestQueue:true});
  const liveA={...A,wind_strength:1,drift_auto:true},liveB={...B,wind_strength:1,drift_auto:true,adaptive_motion:true};
  open(liveA);const time=e.motion.time;let phase;
  e.transitionTo(liveB,{duration:1});phase=e.params.drift_phase;
  while(e.trans.active){pump();need((e.params.drift_phase-phase+2*Math.PI)%(2*Math.PI)>0,'automatic drift froze');phase=e.params.drift_phase;}
  const elapsed=e.motion.time-time;need(Math.abs(elapsed-121*step/1000)<1e-8,`wind clock advanced twice ${elapsed}`);
  const landed=e.motion.time;pump();need(e.motion.time-landed<.034,'adaptive clock accumulated the journey');results.push({elapsed,adaptiveStep:e.motion.time-landed});
  if(render){
   open({...fixture.from,auto_quality:false,adaptive_motion:false});pump(119);
   let previous=null;
   const enc=document.createElement('canvas');enc.width=W;enc.height=H;const ctx=enc.getContext('2d'),im=ctx.createImageData(W,H);
   window.__render=n=>{
    if(n===60)e.transitionTo({...fixture.to,auto_quality:false,adaptive_motion:false},{duration:4});pump();
    const p=last;let luma=0,delta=0;for(let i=0;i<p.length;i+=4){luma+=.2126*p[i]+.7152*p[i+1]+.0722*p[i+2];if(previous)for(let k=0;k<3;k++)delta+=Math.abs(p[i+k]-previous[i+k]);}
    for(let y=0;y<H;y++)im.data.set(p.subarray((H-y-1)*W*4,(H-y)*W*4),y*W*4);ctx.putImageData(im,0,0);previous=p;
    return {png:enc.toDataURL('image/png'),t:e.trans.t,luma:luma/(W*H),delta:delta/(W*H*3),shadowRise:!!e.trans.shadowRise,bloom:e.trans.bloom};
   };
   window.__dispose=()=>e.dispose();
  }else{
   open(A);e.transitionTo(B,{duration:1});pump(35);e.transitionTo(C,{duration:1});
   window.__loss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),nativeC};
  }
  return results;
 },{fixture,W,H,render});
 for(const r of results)console.log('PASS',bundled?'without seasonal tiers':'modules',JSON.stringify(r));
 if(render){
  const out=resolve(root,'test-gl/out/shadow-rise/integrated');await mkdir(resolve(out,'frames'),{recursive:true});
  const frames=[];
  for(let n=0;n<600;n++){const f=await page.evaluate(n=>window.__render(n),n);await writeFile(resolve(out,'frames',`${String(n).padStart(4,'0')}.png`),Buffer.from(f.png.split(',')[1],'base64'));delete f.png;frames.push({frame:n,...f});if(n%60===0)console.log('FRAME',n,JSON.stringify(f));}
  await writeFile(resolve(out,'frames.json'),JSON.stringify(frames,null,2));await page.evaluate(()=>window.__dispose());
 }else{
  await page.evaluate(()=>window.__loss.ext.loseContext());await page.waitForFunction(()=>window.__loss.e.gl.isContextLost());await page.waitForTimeout(100);
  await page.evaluate(()=>window.__loss.ext.restoreContext());await page.waitForFunction(()=>!window.__loss.e.gl.isContextLost());
  const recovery=await page.evaluate(()=>{
   const {e,stamp,step,nativeC}=window.__loss;let max=-1;
   e.onFrame=()=>{const g=e.gl,p=new Uint8Array(nativeC.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,p);max=p.reduce((m,v,i)=>Math.max(m,Math.abs(v-nativeC[i])),0);};
   window.__clock.pump(stamp+step);const error=e.gl.getError();e.dispose();return {max,error};
  });assert.deepEqual(recovery,{max:0,error:0});console.log('PASS context recovery',JSON.stringify(recovery));
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
