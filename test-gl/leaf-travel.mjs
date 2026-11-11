// The production route on WebGL, supplied through Playwright routes without a local server. Its two looks differ in the hood
// (vignette .24 against 0), so the last block also holds the hood's gate on a still live morph of the hooded look, against the
// engine before the hood faded (served from `git show`). The faithful block holds the same route between two faithful overhead groves
// that differ structurally (seed, outline, leader, layer count, density, tone), which the scene dissolve took before.
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
  // ---- two faithful groves: the route, its handoffs, its interruptions, and ends that differ in sample count and bake size ----
  const faithful=await page.evaluate(async()=>{
    const {create}=await import('/komorebi.js');
    const F1={...window.__hooded,drift_amount:0},F2={...F1,seed:123,leaf_shape:'maple',leader_strength:.55,layer_count:4,foliage_density:1,tone_map:2,leaf_diffuse:0};
    const F3={...F1,seed:77,leaf_shape:'ellipse',layer_count:3,foliage_density:1.2,exposure:F1.exposure+.2};
    let e,c,last,stamp=0;const step=Math.floor(1000/60*2**20)/2**20;
    function pump(n=1){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
    function open(p){e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});
      e.onFrame=()=>{const g=e.gl;last=new Uint8Array(320*180*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,last);if(g.getError())throw Error('WebGL error');};pump();}
    const diff=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    const mean=(a,b)=>a.reduce((s,x,i)=>s+(i%4===3?0:Math.abs(x-b[i])),0)/(a.length/4*3);
    const need=(ok,msg)=>{if(!ok)throw Error(msg);};
    const fresh=p=>{open(p);return last.slice();};
    // A cleared floor or a doubled shadow at a handoff is one frame whose change stands out of its ±5 neighbours.
    const spikes=steps=>{const med=i=>{const s=steps.slice(Math.max(0,i-5),i+6).filter((_,j)=>j!==Math.min(i,5)).sort((x,y)=>x-y);return s[s.length>>1];};
      return steps.map((v,i)=>({i,step:+v.toFixed(3),neighbours:+med(i).toFixed(3)})).filter(f=>f.step>0.5+3*f.neighbours);};
    // A whole route from a settled look: the zero-time redraw, every frame's step with the route's eased progress, the landing.
    function route(from,to,label){
      const target=fresh(to),source=fresh(from);open(from);let ended=0;
      e.transitionTo(to,{duration:1,onEnd:()=>ended++});
      need(e.trans.leafTravel&&!e.trans.sceneFade&&e.trans.bloomMax===0&&e.trans.durScale===2,`${label}: not leaf travel`);
      window.__clock.pump(stamp);const start=diff(source,last);
      const steps=[],t=[];let prev=last.slice();
      while(e.trans.active){pump();need(e.trans.bloom===0,`${label}: bloom`);steps.push(mean(prev,last));t.push(e.trans.t);prev=last.slice();}
      pump();const landed=diff(target,last);need(ended===1,`${label}: onEnd`);
      const at=(a,b)=>Math.max(...steps.filter((_,i)=>t[i]>=a&&t[i]<b));
      return {start,landed,frames:steps.length,largestStep:+Math.max(...steps).toFixed(3),handoffIn:+at(0,.25).toFixed(3),middle:+at(.25,.75).toFixed(3),handoffOut:+at(.75,1.01).toFixed(3),spikes:spikes(steps)};
    }
    const out={};
    for(const [from,to,label] of [[F1,F2,'F1 → F2'],[F2,F1,'F2 → F1']]){
      const r=out[label]=route(from,to,label);
      need(r.start===0,`${label}: zero-time redraw moved the outgoing look (${r.start})`);need(r.landed===0,`${label}: landed ${r.landed}`);
      need(r.spikes.length===0,`${label}: handoff spikes ${JSON.stringify(r.spikes)}`);
    }
    // Ends of a different quality: the moving cast takes the incoming end's sample count and bake size throughout.
    const Q2={...F2,sample_count:F1.sample_count*2,bake_resolution:F1.bake_resolution*2};
    for(const [from,to,label] of [[F1,Q2,'F1 → F2 at 2× samples and bake'],[Q2,F1,'F2 at 2× samples and bake → F1']]){
      const r=out[label]=route(from,to,label);
      need(r.start===0&&r.landed===0,`${label}: ends ${r.start}/${r.landed}`);need(r.spikes.length===0,`${label}: handoff spikes ${JSON.stringify(r.spikes)}`);
    }
    // The background the route moves against: the settled ends in wind.
    const wind={wind_strength:1,drift_auto:true,drift_amount:.145};
    const settled=p=>{open(p);let m=0,prev=last.slice();for(let i=0;i<60;i++){pump();m=Math.max(m,mean(prev,last));prev=last.slice();}return m;};
    const W1={...F1,...wind},W2={...F2,...wind};
    out.wind={settledOut:+settled(W1).toFixed(3),settledIn:+settled(W2).toFixed(3)};
    open(W1);e.transitionTo(W2,{duration:1});{let m=0,prev=last.slice(),steps=[];while(e.trans.active){pump();const d=mean(prev,last);steps.push(d);m=Math.max(m,d);prev=last.slice();}
      out.wind.largestStep=+m.toFixed(3);out.wind.spikes=spikes(steps);}
    need(out.wind.spikes.length===0,`wind: spikes ${JSON.stringify(out.wind.spikes)}`);
    // Interruptions: reversal, a third faithful grove arriving in flight, a hard replacement, dispose.
    const n1=fresh(F1),n3=fresh(F3);
    for(const at of [45,110]){
      open(F1);e.transitionTo(F2,{duration:1});pump(at);const shown=last.slice();e.transitionTo(F1,{duration:1});need(e.trans.leafTravel,'reversal left leaf travel');
      window.__clock.pump(stamp);const jump=diff(shown,last);while(e.trans.active)pump();pump();
      out[`reverse at ${at}`]={jump,landed:diff(n1,last)};need(jump<=1&&diff(n1,last)===0,`reverse at ${at}: ${JSON.stringify(out[`reverse at ${at}`])}`);
    }
    {open(F1);let first=0,third=0;e.transitionTo(F2,{duration:1,onEnd:()=>first++});pump(35);e.transitionTo(F3,{duration:.5,onEnd:()=>third++});
      need(e.trans.leafTravel,'a third selection broke the moving route');let n=0;while(e.trans.active&&n++<400)pump();pump();
      out.third={first,third,landed:diff(n3,last)};need(first===0&&third===1&&diff(n3,last)===0,`third look: ${JSON.stringify(out.third)}`);}
    {open(F1);e.transitionTo(F2,{duration:1});pump(35);e.setParams(F1);pump();out.setParams=diff(n1,last);need(out.setParams===0,'hard replacement');}
    {open(F1);e.transitionTo(F2,{duration:1});pump(35);e.dispose();e=null;c.remove();c=null;open(F1);out.dispose=diff(n1,last);need(out.dispose===0,'dispose');}
    const n2=fresh(F2);open(F1);e.transitionTo(F2,{duration:1});pump(35);
    window.__floss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),n2};
    return out;
  });
  await page.evaluate(()=>window.__floss.ext.loseContext());await page.waitForFunction(()=>window.__floss.e.gl.isContextLost());
  await page.waitForTimeout(100);await page.evaluate(()=>window.__floss.ext.restoreContext());await page.waitForFunction(()=>!window.__floss.e.gl.isContextLost());
  faithful.contextLoss=await page.evaluate(()=>{const {e,stamp,step,n2}=window.__floss;let delta=-1;e.onFrame=()=>{const g=e.gl,b=new Uint8Array(n2.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,b);delta=b.reduce((m,x,i)=>Math.max(m,Math.abs(x-n2[i])),0);};window.__clock.pump(stamp+step);const error=e.gl.getError();e.dispose();return {delta,error};});
  console.log('faithful',JSON.stringify(faithful,null,1));
  assert.deepEqual(faithful.contextLoss,{delta:0,error:0},'context loss during faithful travel did not land on the target');
  // At identical geometry, both moving shaders must cut the native blade, including its fractional outline blend.
  const outlines=await page.evaluate(async()=>{
    const S=await import('/komorebi-shaders.js'),L=await import('/komorebi-leaf.js'),T=await import('/komorebi-leaf-travel.js');
    const c=document.createElement('canvas');c.width=c.height=256;document.body.append(c);
    const gl=c.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});gl.getExtension('EXT_color_buffer_float');
    const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    function program(v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
    const refQ=(side)=>S.GLSL_LEAF_Q.replaceAll('uLeafTex',`uTex${side}`).replaceAll('uLeafRows',`uRows${side}`).replaceAll('leafQ',`leafQ${side}`);
    const ref=program(S.VS_LEAF_TRAVEL,`#version 300 es
precision highp float;in vec2 vLocal;out vec4 frag;uniform float uVariantA,uVariantB,uWeight,uEdge;uniform int uShapeA,uShapeB;
${refQ('A')}
${refQ('B')}
void main(){float qa=uShapeA==0?length(vLocal):leafQA(vLocal,uVariantA);float qb=uShapeB==0?length(vLocal):leafQB(vLocal,uVariantB);
float cov=1.0-smoothstep(1.0-uEdge,1.0,mix(qa,qb,uWeight));frag=vec4(vec3(exp(-cov)),1.0);}`);
    const nativePrograms=[program(S.VS_LEAF_TRAVEL,S.FS_LEAF_TRAVEL),program(S.VS_LEAF_TRAVEL_PATCH,S.FS_LEAF_TRAVEL_PATCH)];
    const quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    const texture=(shape)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.R16F,shape?256:1,shape?.rows??1,0,gl.RED,gl.FLOAT,shape?.data??new Float32Array([1]));for(const k of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,k,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;};
    function q(shape,row){return {shape,leaves:Float32Array.from([0,0,.25,.25,0,0,0,0,1,1,1,row/(shape?.idFrac??32),0,0,0,0,0,1]),hier:{clusterGeom:new Float32Array(4),clusterData:new Float32Array(4)},params:{faithful_canopy:true,leaf_swing:0,flutter_freq:1,drift_amount:0,drift_phase:0},motion:{u:0,time:0,sway:[0,0]},hMax:1};}
    const rows=[10.49,31.1,47.9,63.1],results=[];
    for(const [name,a,b] of [
      ...rows.map(r=>[`varied maple ${r}`,q(L.leafShape('maple',1,1),r),q(L.leafShape('beech',2,.9),r)]),
      ['unvaried',q(L.leafShape('maple',1),3),q(L.leafShape('beech',2),5)],
      ['mixed tables',q(L.leafShape('maple',1,1),10.49),q(L.leafShape('beech',2),5)],
      ['ellipse',q(null,0),q(L.leafShape('maple',1,1),10.49)]]){
      const textures=[texture(a.shape),texture(b.shape)];
      for(const w of [0,.5,1]){
        const data=T.moveLeaves(a,b,[[0,0,true,true]],w,new Float32Array(12));
        function draw(p,isRef){
          gl.useProgram(p);gl.viewport(0,0,256,256);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
          gl.vertexAttrib4f(1,...data.slice(0,4));gl.vertexAttrib4f(2,...data.slice(4,8));gl.vertexAttrib4f(3,...data.slice(8,12));gl.vertexAttrib4f(4,w,.1,0,0);
          const loc=n=>gl.getUniformLocation(p,n);
          gl.uniform2f(loc('uOrigin'),-1,-1);gl.uniform2f(loc('uExtent'),2,2);gl.uniform2f(loc('uG'),0,0);gl.uniform4f(loc('uBox'),0,0,4,4);
          gl.uniform1f(loc('uWeight'),w);gl.uniform1f(loc('uEdge'),.1);gl.uniform1f(loc('uBeamK'),0);gl.uniform1i(loc('uEdgeArea'),0);
          for(const [unit,end] of [[0,a],[1,b]]){
            const side=unit?'B':'A';gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures[unit]);
            gl.uniform1i(loc(isRef?`uTex${side}`:`uLeaf${side}`),unit);gl.uniform1i(loc(`uShape${side}`),end.shape?1:0);
            if(isRef){const raw=(end.leaves[11]%1)*(end.shape?.idFrac??32);gl.uniform1f(loc(`uVariant${side}`),end.shape?.idFrac?raw:Math.floor(raw+.5));gl.uniform1f(loc(`uRows${side}`),end.shape?.idFrac?end.shape.rows:0);}
          }
          gl.drawArrays(gl.TRIANGLE_STRIP,0,4);const out=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,out);if(gl.getError())throw Error('outline probe WebGL error');return out;
        }
        const expected=draw(ref,true);
        if(!expected.some((v,i)=>i%4!==3&&v<250))throw Error('empty native outline reference');
        for(const [i,p] of nativePrograms.entries()){
          const actual=draw(p,false);let max=0,sum=0,changed=0;
          for(let k=0;k<actual.length;k+=4){const d=Math.abs(actual[k]-expected[k]);max=Math.max(max,d);sum+=d;if(d>=2)changed++;}
          results.push({name,w,cast:i?'patch':'single',max,mean:sum/65536,visible:changed/65536});
        }
      }
      textures.forEach(t=>{gl.deleteTexture(t);});
    }
    c.remove();return results;
  });
  assert.ok(outlines.every(r=>r.max<=1),`moving outline differs from native: ${JSON.stringify(outlines.filter(r=>r.max>1))}`);
  console.log('PASS native outline blends',outlines.length,'comparisons, max',Math.max(...outlines.map(r=>r.max)));
  assert.deepEqual(errors,[]);
  for(const r of results)console.log('PASS',JSON.stringify(r));console.log('PASS context recovery',JSON.stringify(recovery));console.log('PASS hood');console.log('PASS faithful travel');
}finally{await browser.close();}
