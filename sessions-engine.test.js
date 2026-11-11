// Real engine lifecycle over a no-op GL boundary: CPU policy, not a GPU or cadence proof.
import { afterEach, expect, test } from 'bun:test';
import { create } from './komorebi.js';

const originalWindow=globalThis.window, originalRAF=globalThis.requestAnimationFrame;
afterEach(()=>{globalThis.window=originalWindow;globalThis.requestAnimationFrame=originalRAF;});
function engine(session={}){
  let next;
  globalThis.window={devicePixelRatio:1};globalThis.requestAnimationFrame=fn=>{next=fn;};
  const events={}, constants=new Map();
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
  const e=create({getContext:()=>gl,clientWidth:32,clientHeight:32,width:32,height:32,
    addEventListener:(key,fn)=>{events[key]=fn;},removeEventListener(){}}, {params:look,...(session===null?{}:{session})});
  let now=performance.now();
  return {e,look,events,step(){now+=17;next(now);},land(){for(let i=0;i<300&&e.trans.active;i++){now+=17;next(now);}}};
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
