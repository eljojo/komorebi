import {test,expect} from 'bun:test';
import {PRESETS} from './presets.js';
import * as travel from './komorebi-season-travel.js';
import {create} from './komorebi.js';
import { cameraPose } from './komorebi-camera.js';

test('seasonal leaf journeys are monotone, staggered and settle at their own endpoints',()=>{
  expect(typeof travel.flightProgress).toBe('function');
  for(const identity of [0,.1,.5,.9,1]){
    expect(travel.flightProgress(0,identity)).toBe(0);
    expect(travel.flightProgress(1,identity)).toBe(1);
    let prev=0;
    for(let i=1;i<=600;i++){
      const w=travel.flightProgress(i/600,identity);
      expect(w).toBeGreaterThanOrEqual(prev);expect(w).toBeLessThanOrEqual(1);
      expect(w-prev).toBeLessThan(.006);prev=w;
    }
  }
  expect(travel.flightProgress(.35,.1)).not.toBe(travel.flightProgress(.35,.9));
});

test('the standing camera travels through eye space and takes the short yaw arc',()=>{
  expect(typeof travel.seasonCamera).toBe('function');
  const a=PRESETS['cherry blossom'],b=PRESETS['park 2'];
  const at=w=>travel.seasonCamera(a,b,w);
  for(const k of ['view_extent_m','view_pitch_deg','view_yaw_deg','view_fov_deg','view_center_x','view_center_y']){
    expect(at(0)[k]).toBe(a[k]);expect(at(1)[k]).toBe(b[k]);
  }
  expect(at(.5).view_yaw_deg).toBeCloseTo(202.8802734375,8);
  const height=p=>p.view_extent_m*Math.cos(p.view_pitch_deg*Math.PI/180)**2/(2*Math.tan(p.view_fov_deg*Math.PI/360));
  expect(height(at(.5))).toBeCloseTo((height(a)+height(b))/2,10);
});

test('season travel requires a shared standing grove with a carpet at one end and a full canopy at the other',()=>{
  expect(typeof travel.seasonTravelEligible).toBe('function');
  const a=PRESETS['cherry blossom'],b=PRESETS['park 2'];
  expect(travel.seasonTravelEligible(a,b)).toBe(true);expect(travel.seasonTravelEligible(b,a)).toBe(true);
  for(const change of [{seed:1},{branch_angle_deg:20},{leaf_variety:.9},{standing_scene:false},{faithful_canopy:false},
    {sky_view:true},{receiver:1},{sun_elevation_deg:45},{tone_map:0},{foliage_density:100},{leaf_drop:.2},{litter:1},{trans_r:.1},{trans_g:.1},{trans_b:.1},{phenology:.05,leaf_out_end:.14}]){   // a leafing-out end: the flight carries grown leaves only
    expect(travel.seasonTravelEligible(a,{...b,...change}),JSON.stringify(change)).toBe(false);
  }
});

test('fall looks with litter at both ends travel through their shared standing grove',()=>{
  for(const [a,b] of [[PRESETS.montebello,PRESETS['park fall']],[PRESETS['montebello, rain'],PRESETS['cherry blossom']]]){
    expect(travel.seasonTravelEligible(a,b)).toBe(true);
    expect(travel.seasonTravelEligible(b,a)).toBe(true);
    for(const change of [{seed:1},{leaf_shape:'maple'},{branch_tau:0},{sun_azimuth_deg:120},{tone_map:0},{wind_strength:2},{trans_r:.1},{trans_g:.1},{trans_b:.1}]){
      expect(travel.seasonTravelEligible(a,{...b,...change}),JSON.stringify(change)).toBe(false);
    }
  }
});

test('montebello ↔ park fall moves directly between camera eyes without an outward-and-back detour',()=>{
  for(const [a,b] of [[PRESETS.montebello,PRESETS['park fall']],[PRESETS['park fall'],PRESETS.montebello]]){
    const aa=cameraPose(a).eye,bb=cameraPose(b).eye;let previous=aa;
    for(let i=0;i<=600;i++){
      const w=i/600,eye=cameraPose({...a,...travel.seasonCamera(a,b,w)}).eye;
      for(let k=0;k<3;k++){
        expect(eye[k]).toBeCloseTo(aa[k]+(bb[k]-aa[k])*w,10);
        expect((eye[k]-previous[k])*(bb[k]-aa[k])).toBeGreaterThanOrEqual(-1e-12);
      }
      previous=eye;
    }
    expect(Math.abs(travel.seasonCamera(a,b,.999).view_yaw_deg-a.view_yaw_deg)).toBeLessThan(10.31);
  }
});

// ---- the route on a GL that checks what a browser checks ----------------------------------------------------------------------------------
// A stand-in GL that keeps each buffer's size, each vertex array's instanced attributes and each program's vertex source, and refuses an
// instanced draw whose enabled attribute would be read past its buffer's end, as WebGL does (INVALID_OPERATION, and nothing is drawn).
// A software rasteriser lets that read through, so only a GPU shows the leaves gone; this holds it without one.
function checkedGL(){
  const log={refused:[],draws:[]};let array=null,vao=null,program=null;
  const attr=i=>{if(!vao.attrs[i])vao.attrs[i]={};return vao.attrs[i];};
  const gl=new Proxy({},{get(_,name){
    if(typeof name!=='string')return undefined;
    if(name==='FRAMEBUFFER_COMPLETE')return 0x8cd5;
    if(name==='ARRAY_BUFFER')return 'ARRAY_BUFFER';
    if(name==='getParameter')return ()=>4096;
    if(name==='getShaderParameter'||name==='getProgramParameter')return ()=>true;
    if(name==='getExtension')return ()=>({loseContext(){}});
    if(name==='checkFramebufferStatus')return ()=>0x8cd5;
    if(name==='createBuffer')return ()=>({floats:0,data:null});
    if(name==='bindBuffer')return (target,b)=>{if(target==='ARRAY_BUFFER')array=b;};
    if(name==='bufferData')return (target,d)=>{if(target==='ARRAY_BUFFER'&&array){array.floats=typeof d==='number'?d/4:d.length;array.data=typeof d==='number'?null:Float32Array.from(d);}};
    if(name==='createVertexArray')return ()=>({attrs:{}});
    if(name==='bindVertexArray')return v=>{vao=v;};
    if(name==='enableVertexAttribArray')return i=>{if(vao)attr(i).on=true;};
    if(name==='vertexAttribPointer')return (i,size,_type,_norm,stride,offset)=>{if(vao)Object.assign(attr(i),{buf:array,size,stride:stride||size*4,offset});};
    if(name==='vertexAttribDivisor')return (i,d)=>{if(vao)attr(i).divisor=d;};
    if(name==='createShader')return ()=>({source:''});
    if(name==='shaderSource')return (s,source)=>{s.source=source;};
    if(name==='createProgram')return ()=>({vertex:''});
    if(name==='attachShader')return (p,s)=>{if(s.source.includes('gl_Position'))p.vertex=s.source;};
    if(name==='useProgram')return p=>{program=p;};
    if(name==='drawArraysInstanced')return (_mode,_first,_count,instances)=>{
      const short=Object.entries(vao?.attrs??{}).filter(([,a])=>a.on&&a.divisor===1&&a.buf&&(instances-1)*a.stride+a.offset+a.size*4>a.buf.floats*4).map(([i,a])=>`attribute ${i}: ${a.buf.floats} floats for ${instances} leaves`);
      if(short.length){log.refused.push(short.join(', '));return;}
      log.draws.push({instances,travel:/^#define SEASON_TRAVEL$/m.test(program?.vertex??''),pivot:/^#define PIVOT$/m.test(program?.vertex??'')});
    };
    return ()=>({});
  }});
  return {gl,log};
}

test('season travel with leaves on older wood: every cast is drawn, the flight by its own shader and the resting ends with their own weights',()=>{
  const savedWindow=globalThis.window,savedRaf=globalThis.requestAnimationFrame;
  globalThis.window={devicePixelRatio:1};
  try{
    const still={wind_strength:0,weather_variability:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
    for(const [fromName,toName] of [['park fall','montebello'],['montebello','park fall']]){
      const from={...PRESETS[fromName],...still},to={...PRESETS[toName],...still};
      expect(from.inner_leaves,`${fromName} hangs leaves on older wood`).toBeGreaterThan(0);
      const {gl,log}=checkedGL();let next,now=performance.now();
      globalThis.requestAnimationFrame=cb=>{next=cb;return 0;};
      const canvas={getContext:()=>gl,addEventListener(){},removeEventListener(){},clientWidth:100,clientHeight:100,width:100,height:100};
      const eng=create(canvas,{params:from});
      const pump=()=>{const frame=next;now+=1000/60;frame(now);};
      pump();
      expect(eng.faith.pivotOn,'the resting grove draws with its pivot weights').toBe(true);
      expect(eng.faith.pivotBuf.floats,'at rest: one weight a hanging leaf').toBe(eng.faith.count);
      const restOn=eng.faith.pivotOn;
      eng.transitionTo(to,{duration:1});
      expect(eng.trans.seasonTravel,`${fromName} -> ${toName} is a season travel`).toBe(true);
      const S=eng.grove().season;let flown=0,rested=0;
      for(let f=0;f<400&&eng.trans.active;f++){
        log.draws.length=0;pump();
        if(!eng.trans.active)break;
        expect(log.refused,`${fromName} -> ${toName}, frame ${f}: a draw the browser would refuse`).toEqual([]);
        expect(eng.faith.count,'every leaf of the grove is in the buffer while they travel').toBe(S.n);
        expect(eng.faith.pivotBuf.floats,`frame ${f}: one weight a leaf in the buffer`).toBe(S.n);
        expect(eng.faith.pivotBuf.data.every((w,i)=>w===S.pivot[i]),`frame ${f}: each leaf's own weight, in the record's order`).toBe(true);
        const leaves=log.draws.filter(d=>d.instances===S.n);
        if(eng.trans.travelField.weight>0){
          expect(leaves.some(d=>d.travel),`frame ${f}: the moving cast is drawn by the flight's shader`).toBe(true);flown++;
        }
        if(eng.trans.travelField.weight<1){
          // (the start of the journey is the look that was at rest, so it is cast as it was)
          if(f===0)expect(leaves.some(d=>!d.travel&&d.pivot===restOn),'the first frame casts the resting grove by the shader it rested on').toBe(true);
          expect(leaves.some(d=>!d.travel),`frame ${f}: the resting end is cast under the moving one`).toBe(true);rested++;
        }
      }
      expect(flown,'the flight was seen').toBeGreaterThan(20);expect(rested,'and both handoffs').toBeGreaterThan(2);
      expect(eng.trans.active).toBe(false);
      log.draws.length=0;pump();
      expect(log.refused).toEqual([]);
      expect(eng.faith.pivotBuf.floats,'landed: one weight a hanging leaf again').toBe(eng.faith.count);
      eng.dispose();
    }
  }finally{globalThis.window=savedWindow;globalThis.requestAnimationFrame=savedRaf;}
});
