// The eclipse pairs on real WebGL: `morning 3b → eclipse` and `eclipse → acid dreams` take the shared-layer crossfade across their
// different layer counts, with no bloom, while the moon slides on or off. Checked here: the route and its bloom; a zero-time redraw
// at the start against the settled outgoing look; the landed frame against the target loaded fresh; no frame-to-frame spike where
// the moon changes the sampled source; interruptions (reversal before and after the window, a third look, a selection inside the
// window, setParams, dispose, context loss); the sky view; and the settled `eclipse` against the engine before the moon could move.
// Still air throughout (wind 0, weather 0, automatic drift off, drift_amount 0), so nothing but the route can make two frames differ.
// No local server: Playwright supplies the repo's modules, and the base engine's from `git show`.
// Run from the repo root: nix develop -c bun test-gl/eclipse-crossfade.mjs [--base <commit>]
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
// The engine the settled look is held to: the commit before a route could move the moon.
const base=process.argv.includes('--base')?process.argv[process.argv.indexOf('--base')+1]:'4c0e89e';
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--force-color-profile=srgb']});
try {
  const page=await browser.newPage({viewport:{width:320,height:180},deviceScaleFactor:1});
  page.setDefaultTimeout(900000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('http://eclipse.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:320px;height:180px}</style><script>${clock}</script>`});
    try {
      const body=path.startsWith('/base/')?execFileSync('git',['show',`${base}:${path.slice(6)}`],{cwd:root}):await readFile(resolve(root,`.${path}`));
      await route.fulfill({contentType:'text/javascript',body});
    } catch {await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://eclipse.test/');
  const results=await page.evaluate(async()=>{
    const {create}=await import('/komorebi.js');
    const {PRESETS}=await import('/presets.js');
    const still={wind_strength:0,weather_variability:0,drift_auto:false,drift_amount:0,auto_quality:false,adaptive_motion:false};
    const small={...still,tex_resolution:256,bake_resolution:256,fill_directions:4,fill_resolution:64,litter_resolution:256};
    const step=Math.floor(1000/60*2**20)/2**20;
    let e,c,last,stamp,make=create;
    function pump(n=1){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
    function open(p){
      e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;
      c=document.createElement('canvas');document.body.appendChild(c);e=make(c,{params:p});
      e.onFrame=()=>{const gl=e.gl;last=new Uint8Array(c.width*c.height*4);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,last);if(gl.getError())throw Error('GL error');};
      pump(1);
    }
    const max=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    const mean=(a,b)=>a.reduce((s,x,i)=>s+(i%4===3?0:Math.abs(x-b[i])),0)/(a.length/4*3);
    const need=(ok,msg)=>{if(!ok)throw Error(msg);};
    const fresh=p=>{open(p);return last.slice();};
    const weights=()=>Array.from({length:e.src.count},(_,i)=>e.src.flat[i*3+2]);
    const land=(limit=2000)=>{let n=0;while(e.trans.active&&n++<limit)pump();need(!e.trans.active,'route did not land');pump();};
    const results={};

    // ---- the settled eclipse, as authored, against the engine before this change ----
    {
      const p={...PRESETS.eclipse,...still};
      const now=fresh(p);
      make=(await import('/base/komorebi.js')).create;const before=fresh(p);make=create;
      results.settledEclipse={max:max(now,before),mean:+mean(now,before).toFixed(4)};
      need(max(now,before)===0,`settled eclipse differs from the engine before (max ${max(now,before)})`);
    }

    // ---- the two pairs, driven to landing ----
    for(const [a,b] of [['morning 3b','eclipse'],['eclipse','acid dreams']]){
      const A={...PRESETS[a],...small},B={...PRESETS[b],...small},target=fresh(B),source=fresh(A);
      open(A);let ended=0;e.transitionTo(B,{duration:2,onEnd:()=>ended++});
      need(e.trans.crossfade&&e.trans.bloomMax===0,`${a} → ${b} is not the crossfade`);
      window.__clock.pump(stamp);const startDelta=max(source,last);
      need(startDelta===0,`${a} → ${b}: zero-time redraw moved the outgoing look (max ${startDelta})`);
      let prev=last.slice(),prevW=weights();const frames=[];
      while(e.trans.active){
        pump();need(e.trans.bloom===0,'bloom during the crossfade');
        const w=weights(),total=w.reduce((s,v)=>s+v,0);
        const moon=w.length===prevW.length?w.reduce((m,v,i)=>Math.max(m,Math.abs(v-prevW[i])),0)/total:null;
        frames.push({t:e.trans.t,step:mean(prev,last),moon,count:w.length});
        prev=last.slice();prevW=w;
      }
      pump();
      const landed=max(target,last);need(ended===1,'onEnd did not fire once');
      // A spike: a step above 1.6× the median of its ±5 neighbours. It is the moon's when some point-sun's weight moved by more than
      // 0.004 of the total that frame; the sample-count change (a different set of point-suns) is measured apart.
      const med=i=>{const s=frames.slice(Math.max(0,i-5),i+6).filter((_,j)=>j!==Math.min(i,5)).map(f=>f.step).sort((x,y)=>x-y);return s[s.length>>1]||0;};
      const moonSpikes=[],steps=frames.map(f=>f.step);
      frames.forEach((f,i)=>{if(f.step>1.6*med(i)&&f.step>0.05&&f.moon!==null&&f.moon>0.004)moonSpikes.push({i,step:+f.step.toFixed(3),moon:+f.moon.toFixed(4)});});
      const swap=frames.findIndex((f,i)=>i>0&&f.count!==frames[i-1].count);
      results[`${a} → ${b}`]={frames:frames.length,startDelta,landed,landedMean:+mean(target,last).toFixed(4),
        largestStep:+Math.max(...steps).toFixed(3),largestMoonWeightStep:+Math.max(...frames.map(f=>f.moon??0)).toFixed(4),moonSpikes,
        sampleCountStep:swap<0?null:{frame:swap,t:+frames[swap].t.toFixed(3),step:+frames[swap].step.toFixed(3),neighbourMedian:+med(swap).toFixed(3),from:frames[swap-1].count,to:frames[swap].count}};
      need(landed===0,`${a} → ${b}: landed frame differs from the look loaded fresh (max ${landed})`);
      need(moonSpikes.length===0,`${a} → ${b}: moon spikes ${JSON.stringify(moonSpikes)}`);
    }

    // ---- the same gate on the cloud dissolve: wood closes the crossfade, and the moon still crosses under the bloom ----
    {
      const A={...PRESETS['morning 3b'],...small,branch_tau:0.5},B={...PRESETS.eclipse,...small,branch_tau:0.5},target=fresh(B);
      open(A);e.transitionTo(B,{duration:2});need(!e.trans.crossfade&&e.trans.bloomMax>0,'wood did not take the cloud dissolve');
      let held=true,finite=true,moonFrames=0,prevD=null;
      while(e.trans.active){pump();if(e.trans.active){held&&=e.params.eclipse===true;finite&&=Number.isFinite(e.src.moonD);if(prevD!==null&&e.src.moonD!==prevD)moonFrames++;prevD=e.src.moonD;}}
      pump();results.dissolve={held,finite,moonFrames,landed:max(target,last)};
      need(held&&finite&&moonFrames>100&&max(target,last)===0,`dissolve across the eclipse gate: ${JSON.stringify(results.dissolve)}`);
    }

    // ---- interruptions on morning 3b → eclipse ----
    {
      const A={...PRESETS['morning 3b'],...small},B={...PRESETS.eclipse,...small},C={...PRESETS['acid dreams'],...small};
      const nativeA=fresh(A),nativeB=fresh(B),nativeC=fresh(C),out=[];
      for(const [name,at,next,expect] of [['reverse before the window',0.2,A,nativeA],['reverse after the window',0.8,A,nativeA],['a third look before the window',0.2,C,nativeC],['a third look after the window',0.85,C,nativeC]]){
        open(A);e.transitionTo(B,{duration:2});while(e.trans.t<at)pump();
        need(!(e.trans.t>0.3&&e.trans.t<0.7),'interruption landed inside the window');
        const shown=last.slice();e.transitionTo(next,{duration:2});window.__clock.pump(stamp);const jump=max(shown,last),jumpMean=+mean(shown,last).toFixed(4);
        land();const landed=max(expect,last);out.push({name,jump,jumpMean,landed});
        need(landed===0,`${name}: landed ${landed}`);need(jump<=2,`${name}: the interruption moved the picture (max ${jump})`);
      }
      // A selection inside the window waits for the route's settled frame and then starts from it.
      open(A);let firstEnd=0;e.transitionTo(B,{duration:2,onEnd:()=>firstEnd++});while(e.trans.t<0.5)pump();
      e.transitionTo(C,{duration:2});need(e.trans.waiting,'a selection inside the window did not wait');
      land();if(e.trans.active)land();need(firstEnd===0,'the superseded route announced its end');
      out.push({name:'a selection inside the window waits',landed:max(nativeC,last)});need(max(nativeC,last)===0,'waited selection did not land on its look');
      // A hard replacement mid-route leaves nothing of it.
      for(const at of [0.2,0.5,0.8]){open(A);e.transitionTo(B,{duration:2});while(e.trans.t<at)pump();e.setParams(C);pump();
        out.push({name:`setParams at t=${at}`,landed:max(nativeC,last)});need(max(nativeC,last)===0,`setParams at ${at}`);}
      // Dispose mid-route.
      open(A);e.transitionTo(B,{duration:2});while(e.trans.t<0.4)pump();e.dispose();e=null;c.remove();c=null;open(A);out.push({name:'dispose mid-route',ok:true});
      results.interruptions=out;
      open(A);e.transitionTo(B,{duration:2});while(e.trans.t<0.25)pump();
      window.__loss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),nativeB};
    }
    return results;
  });
  await page.evaluate(()=>window.__loss.ext.loseContext());await page.waitForFunction(()=>window.__loss.e.gl.isContextLost());await page.waitForTimeout(100);
  await page.evaluate(()=>window.__loss.ext.restoreContext());await page.waitForFunction(()=>!window.__loss.e.gl.isContextLost());
  results.contextRestore=await page.evaluate(()=>{
    const {e,step,nativeB}=window.__loss;let stamp=window.__loss.stamp,max=-1;
    e.onFrame=()=>{const g=e.gl,p=new Uint8Array(nativeB.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,p);max=p.reduce((m,v,i)=>Math.max(m,Math.abs(v-nativeB[i])),0);};
    stamp+=step;window.__clock.pump(stamp);const r={active:e.trans.active,eclipse:e.params.eclipse,layer_count:e.params.layer_count,max,error:e.gl.getError()};e.dispose();return r;
  });
  // ---- the sky view: the camera that draws the source itself ----
  results.skyView=await page.evaluate(async()=>{
    const {create}=await import('/komorebi.js');const {PRESETS}=await import('/presets.js');
    const sky={wind_strength:0,weather_variability:0,drift_auto:false,drift_amount:0,auto_quality:false,adaptive_motion:false,tex_resolution:256,bake_resolution:256,
      sky_view:true,view_pitch_deg:70,view_fov_deg:60};
    const step=Math.floor(1000/60*2**20)/2**20;let e,c,last,stamp;
    const pump=(n=1)=>{for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}};
    const open=p=>{e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
      e.onFrame=()=>{const g=e.gl;last=new Uint8Array(c.width*c.height*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,last);if(g.getError())throw Error('GL error');};pump();};
    const max=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    const out=[];
    for(const [a,b] of [['morning 3b','eclipse'],['eclipse','acid dreams']]){
      const A={...PRESETS[a],...sky},B={...PRESETS[b],...sky};
      open(B);const target=last.slice();open(A);const source=last.slice();
      e.transitionTo(B,{duration:2});const crossfade=e.trans.crossfade;window.__clock.pump(stamp);const start=max(source,last);
      let finite=true,frames=0,moon=[];while(e.trans.active&&frames++<1000){pump();finite&&=Number.isFinite(e.src.moonD);moon.push(e.src.moonD/e.src.coreR);}
      pump();out.push({route:`${a} → ${b}`,crossfade,start,landed:max(target,last),finite,moonFrom:+moon[0].toFixed(3),moonTo:+moon.at(-1).toFixed(3)});
    }
    e.dispose();return out;
  });
  console.log(JSON.stringify(results,null,1));
  assert.deepEqual(errors,[]);
  assert.equal(results.contextRestore.max,0,'context restore did not land on the target');
  for(const s of results.skyView){assert.equal(s.start,0,`${s.route} sky: start`);assert.equal(s.landed,0,`${s.route} sky: landed`);assert.ok(s.finite);}
  console.log('PASS eclipse crossfade');
}finally{await browser.close();}
