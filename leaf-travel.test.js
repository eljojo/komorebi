import { test, expect } from 'bun:test';
import * as travel from './komorebi-leaf-travel.js';
import { smoothstep } from './komorebi-math.js';
import { DEFAULTS, CANOPY_MORPH_MAX } from './komorebi-params.js';

function grove(groups){
  const leaves=[],plan=[],twigs=[];
  for(let j=0;j<groups.length;j++){
    const [x,n]=groups[j];plan.push(x,0);twigs.push({layer:j%2});
    for(let i=0;i<n;i++)leaves.push(x+i*.01,0,.1,.05,0,0,1,0,1,2,3,j,1,1,0,0,2,1);
  }
  const count=groups.length;
  return {leaves:new Float32Array(leaves),hier:{clusterPlan:new Float32Array(plan),nClusterTotal:count,twigs,
    clusterGeom:new Float32Array(count*4),clusterData:Float32Array.from({length:count*4},(_,i)=>i%4===3?1:0)},
    params:{faithful_canopy:true,leaf_swing:0,flutter_freq:1,drift_amount:0,drift_phase:0,sway_height_gain:0,canopy_base_height_m:2,canopy_thickness_m:2,layer_count:2},
    motion:{u:0,time:0,sway:[0,0]},hMax:2,rows:8,shape:null};
}

test('spatial correspondence carries every endpoint leaf exactly once, including unequal cluster and leaf counts',()=>{
  expect(typeof travel.pairLeaves).toBe('function');
  const a=grove([[0,3],[1,2],[2,4]]),b=grove([[2,2],[0,3]]);
  const pairs=travel.pairLeaves(a,b);
  for(const [side,q] of [[0,a],[1,b]]){
    const live=pairs.filter(p=>p[side+2]).map(p=>p[side]);
    expect(live.length).toBe(q.leaves.length/18);
    expect(new Set(live).size).toBe(live.length);
    expect(live.slice().sort((x,y)=>x-y)).toEqual(Array.from({length:q.leaves.length/18},(_,i)=>i*18));
  }
});

test('travelling leaves preserve endpoint positions and total area; surplus leaves shrink rather than fade',()=>{
  expect(typeof travel.moveLeaves).toBe('function');
  const a=grove([[0,3],[1,2],[2,4]]),b=grove([[2,2],[0,3]]),pairs=travel.pairLeaves(a,b);
  for(let i=0;i<b.leaves.length;i+=18){b.leaves[i+2]=.2;b.leaves[i+3]=.08;}
  const out=new Float32Array(pairs.length*12);
  for(const w of [0,.25,.5,.75,1]){
    travel.moveLeaves(a,b,pairs,w,out);
    let area=0;
    for(let i=0;i<pairs.length;i++){
      const p=pairs[i],o=12*i;
      area+=out[o+2]*out[o+3];
      expect(out[o+9]).toBe(1);
      if(w===0&&p[2])expect(out[o]).toBeCloseTo(a.leaves[p[0]],6);
      if(w===1&&p[3])expect(out[o]).toBeCloseTo(b.leaves[p[1]],6);
    }
    expect(area).toBeCloseTo(9*(1-w)*.1*.05+5*w*.2*.08,6);
  }
});

test('both travel casts retain each varied leaf\'s native outline blend at both ends',()=>{
  const a=grove([[0,3]]),b=grove([[0,3]]);
  a.shape={idFrac:128,rows:64};b.shape={idFrac:128,rows:64};
  for(const [q,variants] of [[a,[10.49,31.1,63.1]],[b,[2.7,47.3,55.9]]]){
    variants.forEach((v,n)=>{q.leaves[18*n+11]=v/128;});
  }
  const pairs=travel.pairLeaves(a,b);
  for(const w of [0,.5,1]){
    const ordinary=travel.moveLeaves(a,b,pairs,w,new Float32Array(pairs.length*12));
    const patch=travel.movePatchLeaves(a,b,pairs,new Float32Array(pairs.length).fill(w),[.1,.1],new Float32Array(pairs.length*16));
    for(const [data,stride] of [[ordinary,12],[patch,16]])for(let n=0;n<pairs.length;n++)for(const [side,q] of [[0,a],[1,b]]){
      const native=(q.leaves[pairs[n][side]+11]%1)*128;
      expect(data[stride*n+10+side]*64).toBe(native);
    }
  }
});

test('unvaried travel still samples the centre of each original outline row',()=>{
  const a=grove([[0,8]]),b=grove([[0,8]]);
  for(const q of [a,b])for(let n=0;n<8;n++)q.leaves[18*n+11]=n/32;
  const pairs=travel.pairLeaves(a,b),data=travel.moveLeaves(a,b,pairs,.5,new Float32Array(pairs.length*12));
  for(let n=0;n<8;n++)for(const side of [0,1])expect(data[12*n+10+side]).toBe((n+.5)/8);
});

// ---- between two faithful groves the travel goes patch by patch ----

function scatter(n,seed,x0,x1,y0=0,y1=1){
  let s=seed;const r=()=>{s=(s*16807)%2147483647;return s/2147483647;};
  const leaves=[];
  for(let i=0;i<n;i++)leaves.push(x0+r()*(x1-x0),y0+r()*(y1-y0),.02,.01,0,0,1,0,1,2,3,0,1,1,0,0,2,1);
  return {leaves:new Float32Array(leaves),hier:{clusterPlan:new Float32Array(2),nClusterTotal:1,twigs:[{layer:0}],
    clusterGeom:new Float32Array(4),clusterData:Float32Array.from([0,0,0,1])},
    params:{faithful_canopy:true,leaf_swing:0,flutter_freq:1,drift_amount:0,drift_phase:0},
    motion:{u:0,time:0,sway:[0,0]},hMax:2,shape:null};
}

test('travel checks the actual patch correspondence before allocating moving-cast resources',()=>{
  for(const excess of [0,1]){
    const heavy=CANOPY_MORPH_MAX/2+excess,n=heavy+10000;
    const a=scatter(n,1,0,0),b=scatter(n,2,0,0);
    for(let i=0;i<n;i++){a.leaves[18*i]=i<heavy?.02:.22;b.leaves[18*i]=i<10000?.02:.22;a.leaves[18*i+1]=b.leaves[18*i+1]=.02;}
    const params={...DEFAULTS,...a.params,seed:1},to={...params,seed:2};
    let bound,programs=0,restored=0,disposed=0;
    const gl=new Proxy({}, {get:(_,key)=>{
      if(key==='bindBuffer')return (_,buffer)=>{bound=buffer;};
      if(key==='getBufferSubData')return (_,_offset,out)=>out.set(bound);
      return ()=>{};
    }});
    const source={params:{...params},faith:{count:n,buf:a.leaves,hMax:2},hier:a.hier,motion:a.motion,grove:{shape:null},motionActive:()=>false};
    const hub={gl,params,trans:{},faith:{count:n,buf:b.leaves,hMax:2},hier:b.hier,motion:b.motion,grove:{shape:null},
      src:{count:1,flat:[0,0,1]},projMatrix:()=>[1,0,0,1],program:()=>{programs++;return {};}};
    const route=travel.makeLeafTravel(hub,()=>({hub:source,restore:()=>{restored++;},dispose:()=>{disposed++;}}));
    route.beginLeafTravel(to);Object.assign(params,to);
    const result=route.stepLeafTravel(0,0,0);
    if(excess){
      expect(result).toBe(false);
      expect(programs).toBe(0);
      expect(params).toEqual({...DEFAULTS,...a.params,seed:1});
      route.finishLeafTravel();expect(restored).toBe(1);
    }else{
      expect(result).not.toBe(false);
      expect(programs).toBeGreaterThan(0);
      route.finishLeafTravel();expect(restored).toBe(0);
    }
    route.endLeafTravel();expect(disposed).toBe(1);
  }
});

test('only a route between two faithful groves goes patch by patch',()=>{
  expect(travel.patchTravel({faithful_canopy:true},{faithful_canopy:true})).toBe(true);
  expect(travel.patchTravel({faithful_canopy:true},{faithful_canopy:false})).toBe(false);
  expect(travel.patchTravel({faithful_canopy:false},{faithful_canopy:true})).toBe(false);
});

test('the patch field ranks carriers to an even spread, deterministically, and is coherent over a patch',()=>{
  const n=600,xy=new Float64Array(2*n);
  let s=7;const r=()=>{s=(s*16807)%2147483647;return s/2147483647;};
  for(let i=0;i<n;i++){xy[2*i]=r()*4;xy[2*i+1]=r()*4;}
  const p=travel.patchField(xy,travel.PATCH_M);
  expect(Array.from(p).sort((x,y)=>x-y).map((v,i)=>Math.abs(v-i/(n-1))<1e-6).every(Boolean)).toBe(true);
  expect(Array.from(travel.patchField(xy,travel.PATCH_M))).toEqual(Array.from(p));
  let near=0,nn=0,far=0,nf=0;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    const d=Math.hypot(xy[2*i]-xy[2*j],xy[2*i+1]-xy[2*j+1]),dp=Math.abs(p[i]-p[j]);
    if(d<.05){near+=dp;nn++;}else if(d>1.5){far+=dp;nf++;}
  }
  expect(nn).toBeGreaterThan(10);
  expect(near/nn).toBeLessThan(.4*far/nf);
});

test('each carrier keeps its own clock: all at 0 through the first handoff, all at 1 through the last, monotone between',()=>{
  expect(travel.TRIP_D).toBe(.35);expect(travel.PATCH_M).toBe(.4);
  for(const w of [0,.05,.11,.12])expect(travel.tripW(w)).toBe(0);
  for(const w of [.88,.95,1])expect(travel.tripW(w)).toBe(1);
  // wherever the moving cast shares the frame with a native one, every carrier is at an end
  for(let w=0;w<=1;w+=.005)if(smoothstep(0,.12,w)*smoothstep(0,.12,1-w)<1)expect([0,1]).toContain(travel.tripW(w));
  for(const p of [0,.2,.5,.8,1]){
    expect(travel.tripClock(p,0)).toBe(0);expect(travel.tripClock(p,1)).toBe(1);
    let prev=-1;
    for(let W=-.1;W<=1.1;W+=.01){const v=travel.tripClock(p,W);expect(v).toBeGreaterThanOrEqual(prev);expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1);prev=v;}
    // a carrier's trip starts at p(1-d) and takes d of the middle
    expect(travel.tripClock(p,p*(1-travel.TRIP_D)-1e-6)).toBe(0);
    expect(travel.tripClock(p,p*(1-travel.TRIP_D)+travel.TRIP_D+1e-6)).toBe(1);
  }
});

test('pairing within patch cells carries every endpoint leaf exactly once, keeps trips short and is deterministic',()=>{
  const a=scatter(3000,3,0,2,0,2),b=scatter(2000,11,0,2,0,2),cell=travel.PATCH_M/2;
  const pairs=travel.patchPairs(a,b,[0,0],cell);
  for(const [side,q] of [[0,a],[1,b]]){
    const live=pairs.filter(p=>p[side+2]).map(p=>p[side]);
    expect(live.slice().sort((x,y)=>x-y)).toEqual(Array.from({length:q.leaves.length/18},(_,i)=>i*18));
  }
  expect(pairs.length).toBeGreaterThanOrEqual(3000);
  // both groves fill every cell here, so no trip leaves its cell
  for(const [ia,ib] of pairs)expect(Math.hypot(a.leaves[ia]-b.leaves[ib],a.leaves[ia+1]-b.leaves[ib+1])).toBeLessThanOrEqual(cell*Math.SQRT2+1e-6);
  expect(travel.patchPairs(a,b,[0,0],cell)).toEqual(pairs);
  // the cast point is the plan point less the sun's throw times the leaf's height (2 m here)
  const shifted=travel.patchPairs(a,b,[.05,0],cell);
  for(const [side,q] of [[0,a],[1,b]])expect(shifted.filter(p=>p[side+2]).length).toBe(q.leaves.length/18);
});

test('a cell whose leaves have no partner hands them to the nearest cell that has some',()=>{
  const a=scatter(60,5,0,.4,0,.4),b=scatter(40,9,0,.4,0,.4),cell=.2;
  // an outgoing island one cell to the right of the shared area, and an incoming one far above it
  const islandA=scatter(10,13,.42,.58,0,.18),islandB=scatter(8,17,0,.18,1.0,1.18);
  const join=(p,q)=>({...p,leaves:Float32Array.from([...p.leaves,...q.leaves])});
  const A=join(a,islandA),B=join(b,islandB),pairs=travel.patchPairs(A,B,[0,0],cell);
  for(const [side,q] of [[0,A],[1,B]]){
    const live=pairs.filter(p=>p[side+2]).map(p=>p[side]);
    expect(live.slice().sort((x,y)=>x-y)).toEqual(Array.from({length:q.leaves.length/18},(_,i)=>i*18));
  }
  for(const [ia,ib,la,lb] of pairs){
    if(la&&ia>=60*18)expect(B.leaves[ib]).toBeGreaterThanOrEqual(.2);   // the island's nearest full cell is the one to its left
    if(lb&&ib>=40*18)expect(A.leaves[ia+1]).toBeGreaterThanOrEqual(.2); // the far island lands in the top row of shared cells
  }
  expect(travel.patchPairs(scatter(5,1,0,1),{...scatter(1,1,0,1),leaves:new Float32Array(0)},[0,0],cell)).toEqual([]);
});

test('carriers on their own clocks: each takes its own progress, outline mix and edge',()=>{
  const a=grove([[0,3],[1,2],[2,4]]),b=grove([[2,2],[0,3]]),pairs=travel.pairLeaves(a,b);
  const n=pairs.length,ref=new Float32Array(12*n),own=new Float32Array(16*n);
  for(const w of [0,.3,1]){
    travel.moveLeaves(a,b,pairs,w,ref);
    travel.movePatchLeaves(a,b,pairs,new Float32Array(n).fill(w),[.1,.5],own);
    for(let i=0;i<n;i++){
      for(let k=0;k<12;k++)expect(own[16*i+k]).toBeCloseTo(ref[12*i+k],6);
      expect(own[16*i+12]).toBeCloseTo(w,6);expect(own[16*i+13]).toBeCloseTo(.1+.4*w,6);
    }
  }
  const wi=Float32Array.from({length:n},(_,i)=>i%2);
  travel.movePatchLeaves(a,b,pairs,wi,[.1,.5],own);
  for(let i=0;i<n;i++){
    const [ia,ib,la,lb]=pairs[i],q=i%2?b:a,j=i%2?ib:ia,live=i%2?lb:la;
    expect(own[16*i]).toBeCloseTo(q.leaves[j],6);
    expect(own[16*i+2]*own[16*i+3]).toBeCloseTo(live?q.leaves[j+2]*q.leaves[j+3]:0,6);
  }
});
