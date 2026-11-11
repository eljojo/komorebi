// The production route on WebGL, supplied through Playwright routes without a local server. Its two looks differ in the hood
// (vignette .24 against 0), so the last block also holds the hood's gate on a still live morph of the hooded look, against the
// engine before the hood faded (served from `git show`).
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
// The engine whose hood swept its boundary across the frame: the settled hooded look is held to it, and its rim is printed beside ours.
const base='3a4809b';
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:320,height:180},deviceScaleFactor:1});page.setDefaultTimeout(300000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://travel.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:320px;height:180px}</style><script>${clock}</script>`});
    try{
      const body=path.startsWith('/base/')?execFileSync('git',['show',`${base}:${path.slice(6)}`],{cwd:root}):await readFile(resolve(root,`.${path}`));
      await route.fulfill({contentType:'text/javascript',body});
    }catch{await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://travel.test/');
  const results=await page.evaluate(async()=>{
    const {create,DEFAULTS}=await import('/komorebi.js');
    const A={...DEFAULTS,faithful_canopy:true,standing_scene:false,leaf_shape:'beech',leaf_variety:.9,foliage_density:1.5,leaf_diffuse:.34,
      canopy_extent_m:14,tree_count:2,branch_levels:2,branch_children:2,limb_count:5,leaves_per_cluster:7,sample_count:8,tex_resolution:256,bake_resolution:256,
      wind_strength:0,drift_auto:false,weather_variability:0,auto_quality:false,adaptive_motion:false,tone_map:0,vignette:.24,vignette_shape:3.1};
    const B={...A,faithful_canopy:false,leaf_shape:'ellipse',leaf_variety:0,seed:123,tree_count:4,branch_levels:1,branch_children:1,
      canopy_extent_m:7,canopy_base_height_m:2,canopy_thickness_m:2.6,foliage_density:1,leaf_diffuse:0,tone_map:2,vignette:0};
    let e,c,last,stamp=0;const step=Math.floor(1000/60*2**20)/2**20;
    function open(p){e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});e.onFrame=()=>{const g=e.gl;last=new Uint8Array(320*180*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,last);if(g.getError())throw Error('WebGL error');};pump(1);}
    function pump(n){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
    const diff=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    const need=(ok,msg)=>{if(!ok)throw Error(msg);};
    open(A);const nativeA=last.slice();open(B);const nativeB=last.slice(),results=[];
    open({...A,wind_strength:1});const windStart=e.motion.time;e.transitionTo({...B,wind_strength:1},{duration:1});pump(10);
    const windElapsed=e.motion.time-windStart;need(Math.abs(windElapsed-10*step/1000)<1e-9,`a frame advanced the parent wind more than once: ${windElapsed}`);results.push({windElapsed});
    for(const [from,to,start,end] of [[A,B,nativeA,nativeB],[B,A,nativeB,nativeA]]){
      open(from);let ended=0;e.transitionTo(to,{duration:1,onEnd:()=>ended++});need(e.trans.leafTravel,'wrong transition route');
      window.__clock.pump(stamp);const sourceDelta=diff(start,last);need(sourceDelta===0,`source endpoint changed: ${sourceDelta}`);
      let frames=0;while(e.trans.active&&frames++<130)pump(1);
      const endDelta=diff(end,last);need(endDelta===0,`target endpoint changed: ${endDelta}`);need(ended===1,'callback count');
      results.push({route:from.faithful_canopy?'faithful to layers':'layers to faithful',sourceDelta,endDelta,frames});
    }
    const liveA={...A,wind_strength:1,drift_auto:true,drift_amount:.145},liveB={...B,wind_strength:1,drift_auto:true,drift_amount:.145};
    open(liveA);e.transitionTo(liveB,{duration:1});pump(120);need(e.trans.active,'expected the frame immediately before landing');const nearLanding=last.slice(),phaseAtLanding=e.params.drift_phase;
    e.setParams({...liveB,drift_phase:phaseAtLanding});window.__clock.pump(stamp);
    const liveLandingDelta=diff(nearLanding,last);need(liveLandingDelta<=1,`moving target was stale or changed its edge law on landing: ${liveLandingDelta}`);results.push({liveLandingDelta});
    open(liveB);const beforeFirstTick=last.slice();e.transitionTo(liveA,{duration:1});window.__clock.pump(stamp+.001);
    const firstTickDelta=diff(beforeFirstTick,last);need(firstTickDelta<=1,`first positive diffuse value changed the native edge law: ${firstTickDelta}`);results.push({firstTickDelta});
    open(A);e.params.view_extent_m*=1.1;pump(1);const reframed=last.slice();e.transitionTo(B,{duration:1});window.__clock.pump(stamp);
    const reframedDelta=diff(reframed,last);need(reframedDelta===0,`starting a morph regrew the reframed source: ${reframedDelta}`);results.push({reframedDelta});
    pump(15);e.transitionTo({...A,view_extent_m:A.view_extent_m*1.1},{duration:.1});while(e.trans.active)pump(1);
    need(diff(reframed,last)===0,'reversal regrew the reframed source');
    open(A);e.transitionTo(B,{duration:1});pump(45);const before=last.slice();e.transitionTo(A,{duration:1});window.__clock.pump(stamp);
    const reverseDelta=diff(before,last);need(reverseDelta<=1,`reversal jumped: ${reverseDelta}`);while(e.trans.active)pump(1);need(diff(nativeA,last)===0,'reversal endpoint changed');results.push({reverseDelta});
    open(A);e.transitionTo(B,{duration:1});pump(110);const edge=last.slice();e.transitionTo(A,{duration:1});window.__clock.pump(stamp);
    const edgeReverseDelta=diff(edge,last);need(edgeReverseDelta<=1,`reversal near landing jumped: ${edgeReverseDelta}`);while(e.trans.active)pump(1);need(diff(nativeA,last)===0,'late reversal endpoint changed');results.push({edgeReverseDelta});
    const C={...A,exposure:A.exposure+.2};open(C);const nativeC=last.slice();open(A);let cancelled=0,arrived=0;
    e.transitionTo(B,{duration:1,onEnd:()=>cancelled++});pump(35);e.transitionTo(C,{duration:.1,onEnd:()=>arrived++});
    let queuedFrames=0;while(e.trans.active&&queuedFrames++<160)pump(1);
    need(!e.trans.active&&arrived===1&&cancelled===0,'queued request/callback did not land');need(diff(nativeC,last)===0,'queued target changed');results.push({queuedRequest:true});
    open(A);e.transitionTo(B,{duration:1});pump(35);e.setParams(A);pump(1);need(diff(nativeA,last)===0,'hard replacement changed the endpoint');
    open({...A,wind_strength:1,drift_auto:true,drift_amount:.145});e.transitionTo({...B,wind_strength:1,drift_auto:true,drift_amount:.145},{duration:1});let phase=e.params.drift_phase;while(e.trans.active){pump(1);need(e.params.drift_phase>phase,'drift stopped or jumped');phase=e.params.drift_phase;}results.push({driftContinuous:true});
    window.__hooded=A;
    open(A);e.transitionTo(B,{duration:1});pump(35);e.transitionTo(C,{duration:1});window.__loss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),nativeB:nativeC};return results;
  });
  await page.evaluate(()=>window.__loss.ext.loseContext());await page.waitForFunction(()=>window.__loss.e.gl.isContextLost());
  await page.waitForTimeout(100);await page.evaluate(()=>window.__loss.ext.restoreContext());await page.waitForFunction(()=>!window.__loss.e.gl.isContextLost());
  const recovery=await page.evaluate(()=>{const {e,stamp,step,nativeB}=window.__loss;let delta=-1;e.onFrame=()=>{const g=e.gl,b=new Uint8Array(nativeB.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,b);delta=b.reduce((m,x,i)=>Math.max(m,Math.abs(x-nativeB[i])),0);};window.__clock.pump(stamp+step);const error=e.gl.getError();e.dispose();return {delta,error};});
  assert.deepEqual(recovery,{delta:0,error:0});
  // ---- the hood across its gate: the hooded look against itself with vignette 0, still air, so only the hood moves the rim ----
  const hood=await page.evaluate(async()=>{
    const {create}=await import('/komorebi.js'),{create:createBase}=await import('/base/komorebi.js');
    const H={...window.__hooded,drift_amount:0},H0={...H,vignette:0,vignette_shape:2};
    let e,c,last,stamp=0,make=create;const step=Math.floor(1000/60*2**20)/2**20;
    function pump(n=1){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
    function open(p){e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;c=document.createElement('canvas');document.body.appendChild(c);e=make(c,{params:p});
      e.onFrame=()=>{const g=e.gl;last=new Uint8Array(320*180*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,last);if(g.getError())throw Error('WebGL error');};pump();}
    const diff=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    const fresh=p=>{open(p);return last.slice();};
    // The rim: the mean RGB of the frame's left edge (x 0..2) about the middle row, where the hood removes nearly all the light.
    const rim=()=>{let s=0,n=0;for(let y=80;y<100;y++)for(let x=0;x<3;x++)for(let k=0;k<3;k++){s+=last[(y*320+x)*4+k];n++;}return s/n;};
    const out={};
    make=createBase;const before=fresh(H);make=create;const now=fresh(H);
    out.settledHooded=diff(now,before);
    for(const engine of ['base','now']){
      make=engine==='base'?createBase:create;
      for(const [name,from,to] of [['off → on',H0,H],['on → off',H,H0]]){
        const target=fresh(to),source=fresh(from);
        open(from);e.transitionTo(to,{duration:1});window.__clock.pump(stamp);
        const start=diff(source,last),series=[rim()];
        while(e.trans.active)pump(),series.push(rim());
        pump();const landed=diff(target,last);
        // Each frame's step against the median of its ±5 neighbours: a boundary crossing the rim is one large step among small ones.
        const steps=series.slice(1).map((v,i)=>v-series[i]),size=steps.map(Math.abs);
        const med=i=>{const s=size.slice(Math.max(0,i-5),i+6).filter((_,j)=>j!==Math.min(i,5)).sort((x,y)=>x-y);return s[s.length>>1];};
        const worst=size.reduce((w,v,i)=>v-(2+3*med(i))>w.excess?{i,step:+v.toFixed(2),neighbours:+med(i).toFixed(2),excess:v-(2+3*med(i))}:w,{excess:-Infinity});
        const sign=to.vignette>0?-1:1,monotone=steps.every(d=>sign*d>=0);
        out[`${engine} ${name}`]={start,landed,frames:steps.length,rimFrom:+series[0].toFixed(2),rimTo:+series.at(-1).toFixed(2),
          largestStep:+Math.max(...size).toFixed(2),worst:{...worst,excess:+worst.excess.toFixed(2)},monotone};
      }
    }
    make=create;e.dispose();c.remove();return out;
  });
  console.log('hood',JSON.stringify(hood,null,1));
  assert.equal(hood.settledHooded,0,'the settled hooded look differs from the engine before the fade');
  for(const name of ['off → on','on → off']){
    const r=hood[`now ${name}`];
    assert.equal(r.start,0,`hood ${name}: the zero-time redraw moved the outgoing look`);
    assert.equal(r.landed,0,`hood ${name}: the landed frame differs from the look loaded fresh`);
    assert.ok(r.monotone,`hood ${name}: the rim does not move one way`);
    assert.ok(r.worst.excess<=0,`hood ${name}: a single-frame rim step stands out of its neighbours ${JSON.stringify(r.worst)}`);
  }
  assert.deepEqual(errors,[]);
  for(const r of results)console.log('PASS',JSON.stringify(r));console.log('PASS context recovery',JSON.stringify(recovery));console.log('PASS hood');
}finally{await browser.close();}
