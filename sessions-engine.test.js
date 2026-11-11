// Real engine lifecycle over a no-op GL boundary: CPU policy, not a GPU or cadence proof.
import { afterEach, expect, test } from 'bun:test';
import { create } from './komorebi.js';

const originalWindow=globalThis.window, originalRAF=globalThis.requestAnimationFrame;
afterEach(()=>{globalThis.window=originalWindow;globalThis.requestAnimationFrame=originalRAF;});
function engine(session={},environment){
  let next;
  globalThis.window={devicePixelRatio:1};globalThis.requestAnimationFrame=fn=>{next=fn;};
  const events={}, constants=new Map(),documentEvents={};
  const ownerDocument={hidden:false,addEventListener:(key,fn)=>{documentEvents[key]=fn;},removeEventListener(){}};
  const gl=new Proxy({}, {get(_target,key){
    if(/^[A-Z_\d]+$/.test(key)){if(!constants.has(key))constants.set(key,constants.size+1);return constants.get(key);}
    if(key==='getParameter')return ()=>8192;
    if(key==='getExtension')return name=>name==='WEBGL_lose_context'?{loseContext(){}}:{};
    if(key==='getShaderParameter'||key==='getProgramParameter')return ()=>true;
    if(key==='checkFramebufferStatus')return ()=>gl.FRAMEBUFFER_COMPLETE;
    if(key==='getShaderInfoLog'||key==='getProgramInfoLog')return ()=>'';
    return ()=>({});
  }});
  const look={tree_count:1,branch_levels:1,branch_children:1,limb_count:1,leaves_per_cluster:2,foliage_density:0.1,layer_count:2,tex_resolution:1024,bake_resolution:768};
  const e=create({getContext:()=>gl,clientWidth:32,clientHeight:32,width:32,height:32,ownerDocument,
    addEventListener:(key,fn)=>{events[key]=fn;},removeEventListener(){}}, {params:look,environment,...(session===null?{}:{session})});
  let now=performance.now();
  return {e,look,events,ownerDocument,documentEvents,step(dt=17){now+=dt;next(now);},land(){for(let i=0;i<300&&e.trans.active;i++){now+=17;next(now);}}};
}

test('real engine preserves playback preferences across hard load, playlist-style arrival and recovery',()=>{
  const {e,look,events,land}=engine({playback:{adaptive_motion:false,auto_quality:false}});
  e.setParams({...look,adaptive_motion:true,auto_quality:true});
  expect(e.params.adaptive_motion).toBe(false);
  e.transitionTo({...look,exposure:2,adaptive_motion:true},{duration:0.1});land();
  expect(e.params.adaptive_motion).toBe(false);
  expect(e.authored).not.toHaveProperty('adaptive_motion');
  events.webglcontextlost({preventDefault(){}});
  e.setSession({playback:{adaptive_motion:false}});
  e.setParams({...look,adaptive_motion:true});events.webglcontextrestored();
  expect(e.params.adaptive_motion).toBe(false);
  e.dispose();
});

test('settings during a transition wait for arrival; authored request survives the cap',()=>{
  const {e,look,land}=engine();
  e.transitionTo({...look,sample_count:48,exposure:2},{duration:0.1});
  e.setSession({quality:'compact',playback:{adaptive_motion:false}});
  land();
  expect(e.params.sample_count).toBe(24);
  expect(e.authored.sample_count).toBe(48);
  e.setLookRequest('sample_count',undefined);
  expect(e.authored).not.toHaveProperty('sample_count');
  expect(e.params.layer_count).toBe(2);
  e.dispose();
});

test('queued fades use the latest session without saving resolved values as look opinions',()=>{
  const {e,look,land}=engine();
  e.transitionTo({...look,seed:1,sample_count:48},{duration:0.1,style:'fade'});
  e.transitionTo({...look,seed:2,sample_count:40},{duration:0.1,style:'fade'});
  e.setSession({quality:'compact',playback:{adaptive_motion:false}});land();
  expect(e.params.seed).toBe(2);expect(e.params.sample_count).toBe(24);expect(e.authored.sample_count).toBe(40);
  expect(e.params.adaptive_motion).toBe(false);e.dispose();
});

test('callers omitting session retain the flat-params playback contract',()=>{
  const {e,look,land}=engine(null);
  e.setParams({...look,adaptive_motion:false});expect(e.params.adaptive_motion).toBe(false);
  e.transitionTo({...look,adaptive_motion:true},{duration:0.1});land();
  expect(e.params.adaptive_motion).toBe(true);e.dispose();
});

test('opting an existing flat engine into sessions retains live art and inherited fidelity',()=>{
  const {e}=engine(null);
  e.params.exposure=4;e.apply('');
  e.setSession({quality:'compact'});
  expect(e.authored.exposure).toBe(4);
  expect(e.authored).not.toHaveProperty('sample_count');
  e.dispose();
});

test('a refused look or fidelity request leaves authored data intact',()=>{
  const {e}=engine();const before=e.authored;
  expect(()=>e.setParams({sample_count:null})).toThrow();
  expect(e.authored).toEqual(before);
  expect(()=>e.setLookRequest('sample_count',NaN)).toThrow();
  expect(e.authored).toEqual(before);
  e.dispose();
});

test('the live governor never raises an authored sample request below its usual floor',()=>{
  const {e,look}=engine();
  for(const faithful_canopy of [false,true]){
    e.setParams({...look,faithful_canopy,sample_count:1});
    expect(e.params.sample_count).toBe(1);
    expect(e.perf.sampleCount).toBeLessThanOrEqual(1);
  }
  e.dispose();
});

test('automatic FPS enables after ten active seconds below 45, without becoming a saved look opinion',()=>{
  const r=engine();const before=r.e.authored;
  for(let i=0;i<399;i++)r.step(25);
  expect(r.e.params.adaptive_motion).toBe(false);
  r.step(25);expect(r.e.params.adaptive_motion).toBe(true);
  expect(r.e.authored).toEqual(before);
  r.e.setParams({...r.look,adaptive_motion:false});
  expect(r.e.params.adaptive_motion).toBe(true);
  r.e.setSession({presentation:'projector'});
  expect(r.e.params.adaptive_motion).toBe(true);
  r.e.setSession({playback:{adaptive_motion:false}});
  for(let i=0;i<500;i++)r.step(25);
  expect(r.e.params.adaptive_motion).toBe(false);r.e.dispose();
});

test('automatic FPS keeps a fast startup full-rate and leaves manual profiles alone',()=>{
  const fast=engine();for(let i=0;i<600;i++)fast.step(1000/60);
  for(let i=0;i<500;i++)fast.step(25);
  expect(fast.e.params.adaptive_motion).toBe(false);fast.e.dispose();
  for(const settings of [{quality:'balanced'},{playback:{adaptive_motion:false}}]){
    const r=engine(settings);
    for(let i=0;i<500;i++)r.step(25);
    expect(r.e.params.adaptive_motion).toBe(false);
    r.e.setSession({});
    for(let i=0;i<399;i++)r.step(25);
    expect(r.e.params.adaptive_motion).toBe(false);
    r.step(25);expect(r.e.params.adaptive_motion).toBe(true);r.e.dispose();
  }
  const phone=engine({}, {phone:true});
  expect(phone.e.params.adaptive_motion).toBe(false);phone.e.dispose();
});

test('hidden-tab intervals do not count toward the automatic FPS window',()=>{
  const r=engine();for(let i=0;i<200;i++)r.step(25);
  expect(typeof r.documentEvents.visibilitychange).toBe('function');
  r.ownerDocument.hidden=true;r.documentEvents.visibilitychange();r.step(10000);
  r.ownerDocument.hidden=false;r.documentEvents.visibilitychange();r.step(10000);
  expect(r.e.params.adaptive_motion).toBe(false);
  for(let i=0;i<200;i++)r.step(25);
  expect(r.e.params.adaptive_motion).toBe(true);r.e.dispose();
});
