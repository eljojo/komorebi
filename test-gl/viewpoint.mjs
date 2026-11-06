// One shared grove through sky↔floor, on real WebGL. No local server: Playwright supplies the repo's modules.
// Run from the repo root: nix develop -c bun test-gl/viewpoint.mjs
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-color-profile=srgb']});
try {
  const page=await browser.newPage({viewport:{width:320,height:180},deviceScaleFactor:1});
  page.setDefaultTimeout(300000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://viewpoint.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:320px;height:180px}</style><script>${clock}</script>`});
    try {await route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,`.${path}`))});}
    catch {await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://viewpoint.test/');
  const results=await page.evaluate(async()=>{
    const {create,DEFAULTS}=await import('/komorebi.js');
    const A={...DEFAULTS,sky_view:true,standing_scene:true,faithful_canopy:false,branch_tau:0,canopy_fill:0,litter:0,
      canopy_base_height_m:2,canopy_thickness_m:2.6,view_pitch_deg:80,view_fov_deg:64,view_extent_m:3.1,
      sample_count:8,tex_resolution:256,bake_resolution:256,tree_count:2,branch_levels:2,limb_count:5,
      wind_strength:0,weather_variability:0,drift_auto:false,auto_quality:false,adaptive_motion:false,glow_bleed:0.14,sun_cosine:0.6};
    const B={...A,sky_view:false,view_pitch_deg:16,view_fov_deg:50,view_center_x:.25,view_center_y:-.3,view_yaw_deg:20,view_extent_m:4.1};
    const step=Math.floor(1000/60*2**20)/2**20;
    let e,c,last,stamp;
    function open(p){
      e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;
      c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
      e.onFrame=()=>{const gl=e.gl;last=new Uint8Array(c.width*c.height*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,last);if(gl.getError())throw Error('GL error');};
      pump(1);
    }
    function pump(n){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
    const delta=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    const luma=b=>{let s=0;for(let i=0;i<b.length;i+=4)s+=.2126*b[i]+.7152*b[i+1]+.0722*b[i+2];return s/(b.length/4);};
    const require=(ok,msg)=>{if(!ok)throw Error(msg);};
    open(A);const sky=last.slice();open(B);const floor=last.slice();const results=[];
    for(const [from,to,source,target] of [[A,B,sky,floor],[B,A,floor,sky]]){
      open(from);const grove=e.grove();let ended=0;
      e.transitionTo(to,{duration:1,onEnd:()=>ended++});
      require(e.trans.viewpoint,'wrong route');
      window.__clock.pump(stamp);require(delta(source,last)===0,`source endpoint moved: sky=${from.sky_view}, delta=${delta(source,last)}, t=${e.trans.t}`);
      let prev=luma(last),maxStep=0,frames=0;
      while(e.trans.active&&frames++<130){pump(1);const v=luma(last);maxStep=Math.max(maxStep,Math.abs(v-prev));prev=v;if(e.trans.active)require(e.grove()===grove,'grove replaced before landing');}
      require(!e.trans.active&&ended===1,'route did not land once');
      const endDelta=delta(target,last);require(endDelta===0,`target endpoint differs: ${endDelta}`);
      require(maxStep<12,`large luminance step ${maxStep}`);
      require(!e.gl.isContextLost(),'context lost on landing');
      results.push({route:from.sky_view?'sky to floor':'floor to sky',frames,maxStep,endpointDelta:endDelta});
    }
    open(A);e.transitionTo(B,{duration:1});pump(45);const before=last.slice();
    e.transitionTo(A,{duration:1});window.__clock.pump(stamp);
    const interruptionDelta=delta(before,last);require(interruptionDelta<=1,`interruption moved the viewpoint: ${interruptionDelta}`);
    e.setParams(B);pump(1);require(delta(floor,last)===0,'hard replacement did not land');
    results.push({interruptionDelta,hardReplacementDelta:delta(floor,last)});
    open({...A,wind_strength:1,drift_auto:true,drift_amount:.145});e.transitionTo({...B,wind_strength:1,drift_auto:true,drift_amount:.145},{duration:1});
    let phase=e.params.drift_phase;
    while(e.trans.active){pump(1);require(e.params.drift_phase>phase,'drift clock jumped or stopped');phase=e.params.drift_phase;}
    results.push({windClock:e.motion.time,driftContinuous:true});
    open(A);e.transitionTo(B,{duration:1});pump(35);
    window.__loss={engine:e,canvas:c,extension:e.gl.getExtension('WEBGL_lose_context'),target:floor,step,stamp};
    return results;
  });
  await page.evaluate(()=>window.__loss.extension.loseContext());
  await page.waitForFunction(()=>window.__loss.engine.gl.isContextLost());
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.__loss.extension.restoreContext());
  await page.waitForFunction(()=>!window.__loss.engine.gl.isContextLost());
  const recovery=await page.evaluate(()=>{
    const s=window.__loss,e=s.engine;window.__clock.pump(s.stamp+s.step);
    const gl=e.gl,b=new Uint8Array(320*180*4);
    let captured=false;
    e.onFrame=()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,320,180,gl.RGBA,gl.UNSIGNED_BYTE,b);captured=true;};
    window.__clock.pump(s.stamp+2*s.step);
    const diff=b.reduce((m,x,i)=>Math.max(m,Math.abs(x-s.target[i])),0),error=gl.getError();
    e.dispose();return {captured,diff,error};
  });
  assert.deepEqual(recovery,{captured:true,diff:0,error:0});
  assert.deepEqual(errors,[]);
  for(const r of results)console.log('PASS',JSON.stringify(r));
  console.log('PASS context recovery',JSON.stringify(recovery));
} finally {await browser.close();}
