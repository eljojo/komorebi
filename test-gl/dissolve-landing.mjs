// The midpoint routes land on the look loaded fresh, on real WebGL: the cloud dissolve (`morning 3b → eclipse` with wood, which closes the crossfade) and the fade
// through the lit ground (`afternoon 7 ↔ park 1`) each regrow the grove once, mid-route, and the landed frame must equal the
// target loaded fresh, byte for byte. Wind and drift are off, so nothing but the route can make the two frames differ.
// No local server: Playwright supplies the repo's modules. Run from the repo root: nix develop -c bun test-gl/dissolve-landing.mjs
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-color-profile=srgb']});
try {
  const page=await browser.newPage({viewport:{width:320,height:180},deviceScaleFactor:1});
  page.setDefaultTimeout(600000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://landing.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:320px;height:180px}</style><script>${clock}</script>`});
    try {await route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,`.${path}`))});}
    catch {await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://landing.test/');
  const results=await page.evaluate(async()=>{
    const {create}=await import('/komorebi.js');
    const {PRESETS}=await import('/presets.js');
    const small={sample_count:8,tex_resolution:256,bake_resolution:256,fill_directions:4,fill_resolution:64,litter_resolution:256,
      wind_strength:0,weather_variability:0,drift_auto:false,drift_amount:0,auto_quality:false,adaptive_motion:false};
    const step=Math.floor(1000/60*2**20)/2**20;
    let e,c,last,stamp;
    function pump(n){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
    function open(p){
      e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;
      c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
      e.onFrame=()=>{const gl=e.gl;last=new Uint8Array(c.width*c.height*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,last);if(gl.getError())throw Error('GL error');};
      pump(1);
    }
    const max=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    const mean=(a,b)=>a.reduce((s,x,i)=>s+(i%4===3?0:Math.abs(x-b[i])),0)/(a.length/4*3);
    const results=[];
    for(const [a,b,route,over] of [['morning 3b','eclipse','dissolve',{branch_tau:0.5}],['afternoon 7','park 1','lit ground'],['park 1','afternoon 7','lit ground']]){
      const A={...PRESETS[a],...small,...over},B={...PRESETS[b],...small,...over};
      open(B);const fresh=last.slice();
      open(A);let ended=0;e.transitionTo(B,{duration:1,onEnd:()=>ended++});
      const took=e.trans.backgroundFade?'lit ground':e.trans.structDiff&&!e.trans.crossfade?'dissolve':'other';
      if(took!==route)throw Error(`${a} → ${b} took ${took}, not ${route}`);
      let frames=0;while(e.trans.active&&frames++<400)pump(1);
      if(e.trans.active||ended!==1)throw Error(`${a} → ${b} did not land once`);
      pump(1);
      results.push({route:`${a} → ${b}`,took,frames,max:max(fresh,last),mean:+mean(fresh,last).toFixed(4)});
    }
    e.dispose();
    return results;
  });
  for(const r of results)console.log(r.max===0?'PASS':'FAIL',JSON.stringify(r));
  assert.deepEqual(errors,[]);
  for(const r of results)assert.equal(r.max,0,`${r.route}: landed frame differs from the look loaded fresh (max ${r.max}, mean ${r.mean})`);
}finally{await browser.close();}
