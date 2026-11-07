// Real WebGL, local files supplied through Playwright routes; no server.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const clock=(await readFile(resolve(root,'test-gl/video.html'),'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1];
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:320,height:180},deviceScaleFactor:1});page.setDefaultTimeout(300000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://season.test/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:`<style>body{margin:0}canvas{width:320px;height:180px}</style><script>${clock}</script>`});
    try{await route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,`.${path}`))});}catch{await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://season.test/');
  const edgeChecks=await page.evaluate(async()=>{
    const {FS_FAITH}=await import('/komorebi-shaders.js'),{texelMix}=await import('/komorebi-fill.js');
    const g=document.createElement('canvas').getContext('webgl2');
    if(!g?.getExtension('EXT_color_buffer_float'))throw Error('Float WebGL2 unavailable');
    const shader=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
    const vs=shader(g.VERTEX_SHADER,`#version 300 es
precision highp float;
out vec2 vLocal;out vec3 vTau;out float vFade;flat out float vVariant;
uniform float uRadius,uFade;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);vLocal=vec2(uRadius,0);vTau=vec3(${Math.LN10},1.1,4.6)*uFade;vFade=uFade;vVariant=0.0;}`);
    const fs=shader(g.FRAGMENT_SHADER,FS_FAITH),p=g.createProgram();g.attachShader(p,vs);g.attachShader(p,fs);g.linkProgram(p);
    if(!g.getProgramParameter(p,g.LINK_STATUS))throw Error(g.getProgramInfoLog(p));
    const tex=g.createTexture();g.bindTexture(g.TEXTURE_2D,tex);g.texImage2D(g.TEXTURE_2D,0,g.RGBA32F,1,1,0,g.RGBA,g.FLOAT,null);
    const fbo=g.createFramebuffer();g.bindFramebuffer(g.FRAMEBUFFER,fbo);g.framebufferTexture2D(g.FRAMEBUFFER,g.COLOR_ATTACHMENT0,g.TEXTURE_2D,tex,0);
    if(g.checkFramebufferStatus(g.FRAMEBUFFER)!==g.FRAMEBUFFER_COMPLETE)throw Error('Edge framebuffer incomplete');
    g.bindTexture(g.TEXTURE_2D,null);g.viewport(0,0,1,1);g.useProgram(p);g.clearColor(1,1,1,1);
    const U=name=>g.getUniformLocation(p,name),smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
    g.uniform1f(U('uEdge'),.26);g.uniform1i(U('uLeafShape'),0);
    let cases=0,maxError=0;
    for(const edge of [1,0])for(const season of [1,0])for(const k of [0,.001,.04,.08,.2])for(const radius of [.87,.75,.97,1.1])for(const fade of [1,.5,3e-5,0]){
      g.uniform1i(U('uEdgeArea'),edge);g.uniform1i(U('uSeasonCast'),season);g.uniform1f(U('uBeamK'),k);
      g.uniform1f(U('uRadius'),radius);g.uniform1f(U('uFade'),fade);g.clear(g.COLOR_BUFFER_BIT);g.drawArrays(g.TRIANGLES,0,3);
      const got=new Float32Array(4);g.readPixels(0,0,1,1,g.RGBA,g.FLOAT,got);
      if(g.getError())throw Error('Faithful edge probe GL error');
      const cov=1-smooth((radius-.74)/.26),tau=[Math.LN10,1.1,4.6].map(t=>t*fade*cov);
      const slab=tau.map(t=>Math.exp(-t)),mixture=texelMix(tau,cov*fade,k).Tb;
      // Only the legacy edge needs a bridge to its zero-diffusion endpoint; explicit area coverage stays exact.
      const expected=k===0&&!edge?slab:season&&!edge?slab.map((t,c)=>t+(mixture[c]-t)*smooth(k/.08)):mixture;
      for(let c=0;c<3;c++){
        const error=Math.abs(got[c]-expected[c]);maxError=Math.max(maxError,error);
        if(!Number.isFinite(got[c])||error>2e-5)throw Error(JSON.stringify({edge,season,k,radius,fade,channel:c,got:got[c],expected:expected[c]}));
      }
      cases++;
    }
    g.deleteFramebuffer(fbo);g.deleteTexture(tex);g.deleteProgram(p);g.deleteShader(vs);g.deleteShader(fs);g.getExtension('WEBGL_lose_context').loseContext();
    return {cases,maxError};
  });
  console.log('faithful seasonal edge coverage',JSON.stringify(edgeChecks));
  const results=await page.evaluate(async()=>{
    const {create}=await import('/komorebi.js'),{PRESETS}=await import('/presets.js');
    const A={...PRESETS['cherry blossom'],tree_count:1,branch_levels:2,branch_children:2,limb_count:4,leaves_per_cluster:6,
      sample_count:5,tex_resolution:256,bake_resolution:128,fill_directions:4,fill_resolution:64,litter_resolution:256,
      wind_strength:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
    const B={...A,phenology:.5,anthocyanin:0,turn_exposure:0,tree_pigment_spread:0,leaf_drop:0,drop_after_turn:0,litter:0,litter_age:.15,
      canopy_fill:0,leaf_diffuse:0,sample_count:8,bake_resolution:256,
      ...Object.fromEntries(['view_extent_m','view_pitch_deg','view_yaw_deg','view_center_x','view_center_y'].map(k=>[k,PRESETS['park 2'][k]]))};
    let e,c,last,stamp=0;const step=Math.floor(1000/60*2**20)/2**20,results=[];
    const need=(ok,msg)=>{if(!ok)throw Error(msg);};
    const diff=(a,b)=>a.reduce((m,x,i)=>Math.max(m,Math.abs(x-b[i])),0);
    function pump(n){for(let i=0;i<n;i++){stamp+=step;window.__clock.pump(stamp);}}
    function open(p){e?.dispose();c?.remove();window.__clock.drain();window.__clock.set(0);stamp=0;c=document.createElement('canvas');document.body.appendChild(c);e=create(c,{params:p});e.onFrame=()=>{const g=e.gl;last=new Uint8Array(320*180*4);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,last);const error=g.getError();need(!error,`WebGL ${error}`);};pump(1);}
    const {cameraPose,smoothstep}=await import('/komorebi-math.js');
    const tune={tree_count:1,branch_levels:2,branch_children:2,limb_count:4,leaves_per_cluster:6,
      sample_count:5,tex_resolution:256,bake_resolution:128,fill_directions:4,fill_resolution:64,litter_resolution:256,
      wind_strength:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
    const journey=()=>{
      const g=e.gl,vao=g.getParameter(g.VERTEX_ARRAY_BINDING);g.bindVertexArray(e.faith.vao);
      const buf=g.getVertexAttrib(7,g.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);g.bindVertexArray(vao);
      need(buf,'the travelling leaf attribute is absent');const data=new Float32Array(e.faith.count*4);
      g.bindBuffer(g.ARRAY_BUFFER,buf);g.getBufferSubData(g.ARRAY_BUFFER,0,data);return data;
    };
    for(const [an,bn] of [['montebello','park fall'],['montebello, rain','cherry blossom']]){
      for(const [fromName,toName] of [[an,bn],[bn,an]]){
        const from={...PRESETS[fromName],...tune},to={...PRESETS[toName],...tune},id=l=>`${l.j}/${l.k}`;
        open(from);const first=last.slice(),floorA=new Set(e.grove().litter.map(id));
        open(to);const final=last.slice(),floorB=new Set(e.grove().litter.map(id));
        open(from);e.transitionTo(to,{duration:1});need(e.trans.seasonTravel,`${fromName} -> ${toName} used an ordinary grove morph`);
        window.__clock.pump(stamp);const sourceDelta=diff(first,last);need(sourceDelta<=1,`two-carpet source changed: ${sourceDelta}`);
        const S=e.grove().season,aa=cameraPose(from).eye,bb=cameraPose(to).eye;let previous=journey(),shared=0,moving=0;
        for(let i=0;i<S.n;i++){const k=`${S.rec[i*11+6]}/${S.rec[i*11+7]}`;if(floorA.has(k)&&floorB.has(k))shared++;if(floorA.has(k)!==floorB.has(k))moving++;}
        need(shared>0&&moving>0,'the fixture needs grounded and travelling leaves');
        for(let frame=0;frame<120;frame++){
          pump(1);need(e.trans.active,'the travelling endpoint must still be available');const data=journey();
          for(let i=0;i<S.n;i++){
            const k=`${S.rec[i*11+6]}/${S.rec[i*11+7]}`,a=floorA.has(k),b=floorB.has(k),v=data[i*4+3];
            if(a&&b)need(v===0,'a shared carpet leaf lifted and would fall back');
            if(a&&!b)need(v>=previous[i*4+3],'a rising leaf reversed');
            if(!a&&b)need(v<=previous[i*4+3],'a falling leaf reversed');
          }
          const eye=cameraPose(e.params).eye,w=smoothstep(0,1,e.trans.t);
          for(let k=0;k<3;k++)need(Math.abs(eye[k]-(aa[k]+(bb[k]-aa[k])*w))<1e-9,'the camera took an outward-and-back detour');
          previous=data;
        }
        const landingDelta=diff(final,last);need(landingDelta<=1,`two-carpet landing jumped: ${landingDelta}`);
        pump(1);need(!e.trans.active&&diff(final,last)===0,'two-carpet native endpoint');
        open(from);e.transitionTo(to,{duration:1});pump(60);const before=last.slice();
        e.transitionTo(from,{duration:1});window.__clock.pump(stamp);const reversalDelta=diff(before,last);
        need(reversalDelta===0,`two-carpet reversal changed the displayed frame: ${reversalDelta}`);
        while(e.trans.active)pump(1);need(diff(first,last)===0,'two-carpet reversal did not restore the source');
        results.push({from:fromName,to:toName,shared,moving,sourceDelta,landingDelta,reversalDelta});
      }
    }
    open(A);const nativeA=last.slice();open(B);const nativeB=last.slice();
    const edgeFailures=[],edge=(ok,msg)=>{if(!ok)edgeFailures.push(msg);};
    const windA={...A,wind_strength:1,weather_variability:0,drift_auto:true},windB={...B,wind_strength:1,weather_variability:0,drift_auto:true};
    open(windA);e.transitionTo(windB,{duration:1});pump(45);const windBefore=last.slice();window.__clock.pump(stamp);
    const windPoseDelta=diff(windBefore,last);edge(windPoseDelta===0,`rendering the same wind pose twice changed the moving cast: ${windPoseDelta}`);results.push({windPoseDelta});
    open(A);e.transitionTo({...B,drift_phase:B.drift_phase+1},{duration:1});pump(60);const manualBefore=last.slice();e.transitionTo(A,{duration:1});window.__clock.pump(stamp);
    const manualReverseDelta=diff(manualBefore,last);edge(manualReverseDelta===0,`manual drift reset on reversal: ${manualReverseDelta}`);results.push({manualReverseDelta});
    const qa={...A,bake_resolution:512},qb={...B,bake_resolution:768};open(qa);e.perf.auto=true;e.perf.quality=.3;e.transitionTo(qb,{duration:1});pump(60);const qualityBefore=last.slice();window.__clock.pump(stamp+.0001);stamp+=.0001;
    const qualitySwapDelta=diff(qualityBefore,last);edge(qualitySwapDelta<=1,`the moving cast changed quality at the native quality swap: ${qualitySwapDelta}`);results.push({qualitySwapDelta});
    open(A);const spring=e.grove().hier;spring.limbAngle[0]=.1;spring.limbVel[0]=.1;spring.maxV=.1;pump(1);const beforeSpring=e.motion.time;
    e.transitionTo(B,{duration:1});pump(1);edge(e.motion.time>beforeSpring,'preparing a journey froze the residual branch springs');
    pump(119);const landingSpring=e.grove().hier;landingSpring.limbAngle[0]=.1;landingSpring.limbVel[0]=.1;landingSpring.maxV=.1;pump(1);
    need(!e.trans.active,'spring test must land');const afterSpring=e.motion.time;pump(1);edge(e.motion.time>afterSpring,'landing froze the residual branch springs');results.push({springsContinuous:e.motion.time>afterSpring});
    need(!edgeFailures.length,edgeFailures.join('; '));
    for(const [from,to,start,end] of [[A,B,nativeA,nativeB],[B,A,nativeB,nativeA]]){
      open(from);let ended=0;e.transitionTo(to,{duration:1,onEnd:()=>ended++});need(e.trans.seasonTravel,'wrong seasonal route');
      window.__clock.pump(stamp);const sourceDelta=diff(start,last);need(sourceDelta===0,`source changed: ${sourceDelta}`);
      let frames=0;while(e.trans.active&&frames++<130)pump(1);
      const endDelta=diff(end,last);need(endDelta===0,`native target changed: ${endDelta}`);need(ended===1,'callback count');
      results.push({route:from.litter?'cherry to park':'park to cherry',sourceDelta,endDelta,frames});
    }
    for(const [from,to] of [[A,B],[B,A]]){
      open(from);e.transitionTo(to,{duration:1});pump(120);need(e.trans.active,'expected last traveling frame');const almost=last.slice();
      e.setParams(to);window.__clock.pump(stamp);const landingDelta=diff(almost,last);need(landingDelta<=1,`landing jump: ${landingDelta}`);results.push({landingDelta});
    }
    for(const frames of [15,60,110]){
      open(A);e.transitionTo(B,{duration:1});pump(frames);const before=last.slice();e.transitionTo(A,{duration:.5});window.__clock.pump(stamp);
      const reversalDelta=diff(before,last);need(reversalDelta===0,`reversal changed the journey: ${reversalDelta}`);
      while(e.trans.active)pump(1);need(diff(nativeA,last)===0,'reversal did not settle on native source');results.push({reverseAt:frames,reversalDelta});
    }
    const C={...B,exposure:B.exposure+.2};open(C);const nativeC=last.slice();open(A);let cancelled=0,arrived=0;
    e.transitionTo(B,{duration:.5,onEnd:()=>cancelled++});pump(15);e.transitionTo({...A,seed:123},{duration:.1});e.transitionTo(C,{duration:.1,onEnd:()=>arrived++});
    let frames=0;while(e.trans.active&&frames++<180)pump(1);need(arrived===1&&cancelled===0,'queued callbacks');need(diff(nativeC,last)===0,'latest queued target');results.push({latestQueued:true});
    open(A);e.transitionTo(B,{duration:1});pump(50);e.setParams(A);pump(1);need(diff(nativeA,last)===0,'hard replacement changed source');
    const liveA={...A,wind_strength:1,drift_auto:true},liveB={...B,wind_strength:1,drift_auto:true};
    open(liveA);const time=e.motion.time;e.transitionTo(liveB,{duration:1});let phase=e.params.drift_phase;
    while(e.trans.active){pump(1);need(e.params.drift_phase>phase,'drift froze or rewound');phase=e.params.drift_phase;}
    const elapsed=e.motion.time-time;need(Math.abs(elapsed-121*step/1000)<1e-8,`wind clock advanced twice: ${elapsed}`);results.push({elapsed,driftContinuous:true});
    for(const [from,to] of [[liveA,liveB],[liveB,liveA]]){
      open(from);e.transitionTo(to,{duration:1});pump(120);const before=last.slice(),pose=structuredClone(e.snapshotMotion());
      e.setParams({...to,drift_phase:pose.dphase});e.setMotionSource({snapshotMotion:()=>pose});window.__clock.pump(stamp);e.setMotionSource(null);const liveLandingDelta=diff(before,last);
      need(liveLandingDelta<=1,`moving native landing was stale: ${liveLandingDelta}`);results.push({liveLandingDelta});
    }
    open(A);e.transitionTo(B,{duration:1});pump(35);e.transitionTo(C,{duration:1});window.__loss={e,stamp,step,ext:e.gl.getExtension('WEBGL_lose_context'),nativeC};return results;
  });
  await page.evaluate(()=>window.__loss.ext.loseContext());await page.waitForFunction(()=>window.__loss.e.gl.isContextLost());
  await page.waitForTimeout(100);await page.evaluate(()=>window.__loss.ext.restoreContext());await page.waitForFunction(()=>!window.__loss.e.gl.isContextLost());
  const recovery=await page.evaluate(()=>{const {e,stamp,step,nativeC}=window.__loss;let delta=-1;e.onFrame=()=>{const g=e.gl,b=new Uint8Array(nativeC.length);g.bindFramebuffer(g.FRAMEBUFFER,null);g.readPixels(0,0,320,180,g.RGBA,g.UNSIGNED_BYTE,b);delta=b.reduce((m,x,i)=>Math.max(m,Math.abs(x-nativeC[i])),0);};window.__clock.pump(stamp+step);const error=e.gl.getError();e.dispose();return {delta,error};});
  assert.deepEqual(recovery,{delta:0,error:0});assert.deepEqual(errors,[]);
  for(const r of results)console.log('PASS',JSON.stringify(r));console.log('PASS context recovery',JSON.stringify(recovery));
}finally{await browser.close();}
