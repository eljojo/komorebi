import { test, expect } from 'bun:test';
import * as travel from '../engine/transitions/komorebi-leaf-travel.js';
import { restTrans } from '../engine/transitions/komorebi-routes.js';
import { smoothstep } from '../engine/komorebi-math.js';
import { DEFAULTS, CANOPY_MORPH_MAX } from '../engine/komorebi-params.js';
import { create } from '../komorebi.js';

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
    const hub={gl,params,trans:restTrans(),regenSource(){},faith:{count:n,buf:b.leaves,hMax:2},hier:b.hier,motion:b.motion,grove:{shape:null},
      src:{count:1,flat:[0,0,1]},projMatrix:()=>[1,0,0,1],sharedProgram:()=>{programs++;return {};}};
    const route=travel.makeLeafTravel(hub,()=>({hub:source,restore:()=>{restored++;},dispose:()=>{disposed++;}}));
    route.begin(to);Object.assign(params,to);
    const result=route.step(0,0,0);
    if(excess){
      expect(result).toBe(false);
      expect(programs).toBe(0);
      expect(params).toEqual({...DEFAULTS,...a.params,seed:1});
      route.finish();expect(restored).toBe(1);
    }else{
      expect(result).not.toBe(false);
      expect(programs).toBeGreaterThan(0);
      route.finish();expect(restored).toBe(0);
    }
    route.end();expect(disposed).toBe(1);
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

// ---- leaves on older wood (inner_leaves) travel from where they are drawn ----

test('a faithful leaf on older wood leaves and lands where the bake draws it: its pivot weight drops its twig\'s bend',()=>{
  const a=grove([[1,2]]),b=grove([[1,2]]);
  for(const q of [a,b]){q.hier.clusterData[1]=.5;q.pivot=Float32Array.from([1,.25]);delete q.hier.twigs;}   // twig bend .5 about the twig base (0,0); leaf 0 wholly on the wood, leaf 1 a quarter; the faithful path reads no twig record
  const pairs=travel.pairLeaves(a,b),out=new Float32Array(pairs.length*12);
  for(const w of [0,1]){
    travel.moveLeaves(a,b,pairs,w,out);
    for(let n=0;n<pairs.length;n++){
      const i=pairs[n][w],q=w?b:a,T=.5*(1-q.pivot[i/18]),x=q.leaves[i],y=q.leaves[i+1];   // VS_FAITH: thT *= 1 - iPivotDrop, about TB, then the leaf's angle less thT
      expect(out[12*n]).toBeCloseTo(Math.cos(T)*x-Math.sin(T)*y,6);
      expect(out[12*n+1]).toBeCloseTo(Math.sin(T)*x+Math.cos(T)*y,6);
      expect(out[12*n+4]).toBeCloseTo(-T,6);
    }
  }
});

test('a layered leaf hung off its twig\'s height travels from its own layer, not its twig\'s',()=>{
  const a=grove([[0,2]]),b=grove([[0,2]]);
  for(const q of [a,b]){
    q.params.faithful_canopy=false;q.params.stem_length=0;
    q.hier.twigs=[{layer:0,z:1}];q.hier.layerBand=[1,1,2];   // heights 1..2 over two layers: the twig on the lower, a leaf at 2 on the upper
    q.leaves[16]=1;q.leaves[18+16]=2;
  }
  const pairs=travel.pairLeaves(a,b),out=travel.moveLeaves(a,b,pairs,0,new Float32Array(pairs.length*12));
  const heights=pairs.map((p,n)=>[p[0],out[12*n+8]]).sort((p,q)=>p[0]-q[0]).map(p=>p[1]);
  expect(heights).toEqual([2,4]);   // canopy_base_height_m 2 + layer/(layer_count−1) · canopy_thickness_m 2
});

// ---- the outgoing scene's wind is its own ----
// retainTravelSource gives the outgoing scene a motion of its own, so each scene ticks the wind it carries once a frame. A trunk
// (every tree's but the first) or any state added to motion later that stays shared would be ticked by both: the engine's wind would
// run ahead of an engine that never travelled. The whole engine on a stub GL, held to a control that stands still on the same clock.
test('a leaf travel leaves the engine\'s wind where a standing engine has it: nothing in the outgoing scene\'s motion is shared',()=>{
  const gl=new Proxy({},{get(_t,name){
    if(typeof name!=='string')return undefined;
    if(name==='FRAMEBUFFER_COMPLETE')return 0x8cd5;
    if(name==='getParameter')return ()=>4096;
    if(name==='getShaderParameter'||name==='getProgramParameter')return ()=>true;
    if(name==='getExtension')return ()=>({loseContext(){}});
    if(name==='checkFramebufferStatus')return ()=>0x8cd5;
    return ()=>({});
  }});
  const savedWindow=globalThis.window,savedRaf=globalThis.requestAnimationFrame;
  globalThis.window={devicePixelRatio:1};
  try{
    const small={faithful_canopy:true,standing_scene:false,tree_count:3,branch_levels:2,branch_children:2,limb_count:4,leaves_per_cluster:4,sample_count:4,
      tex_resolution:64,bake_resolution:64,wind_strength:1,weather_variability:0,drift_auto:false,auto_quality:false,adaptive_motion:false};
    const A={...DEFAULTS,...small},B={...A,faithful_canopy:false};
    const run=travelling=>{
      let next,now=1000;
      globalThis.requestAnimationFrame=cb=>{next=cb;return 0;};
      const canvas={getContext:()=>gl,addEventListener(){},removeEventListener(){},clientWidth:64,clientHeight:36,width:64,height:36};
      const eng=create(canvas,{params:A});
      const pump=()=>{const frame=next;now+=1000/60;frame(now);};
      for(let f=0;f<30;f++)pump();
      if(travelling){eng.transitionTo(B,{duration:10});expect(eng.trans.route?.name).toBe('leafTravel');}
      const seen=[];
      for(let f=0;f<20;f++){pump();seen.push(JSON.stringify(eng.motion));}
      eng.dispose();
      return seen;
    };
    const still=run(false),flying=run(true);
    expect(JSON.parse(still[19]).trunks?.length,'the wind has trunks of the other trees to tick').toBe(3);
    for(let f=0;f<flying.length;f++){
      expect(JSON.parse(flying[f]).trunks,`frame ${f}: the engine's trunks tick once`).toEqual(JSON.parse(still[f]).trunks);
      expect(flying[f],`frame ${f}: the engine's whole wind state ticks once`).toBe(still[f]);
    }
  }finally{globalThis.window=savedWindow;globalThis.requestAnimationFrame=savedRaf;}
});

// ---- the carriers move on the GPU; the CPU keeps their records and the moving cast's frame ----
// A grove with every input moved() reads set: clumps turned by their limb and twig, trees swaying apart, the air, a crown depth, drift,
// leaves on older wood (faithful) or on layers off their twig's height (layered).
function windy(seed,faithful,n=7){
  let s=seed;const r=()=>{s=(s*16807)%2147483647;return s/2147483647;};
  const leaves=[],twigs=[],G=new Float32Array(4*n),D=new Float32Array(4*n),S=new Float32Array(4*n),air=new Float32Array(4*n);
  for(let j=0;j<n;j++){
    G.set([r()*4-2,r()*4-2,r()*.6-.3,r()*.6-.3],4*j);D.set([r()-.5,r()-.5,faithful?r()*.3:r()*6,faithful?.6+.4*r():1],4*j);
    S.set([r()*.2-.1,r()*.2-.1,r()*.4-.2,0],4*j);air.set([r(),r(),0,0],4*j);twigs.push({layer:j%3,z:2+j%3});
    for(let k=0;k<4+j;k++)leaves.push(G[4*j]+r()-.5,G[4*j+1]+r()-.5,.03+.05*r(),.02+.03*r(),r()*6,r()-.5,r(),r()*6,1,2,3,j+(k%4)/32,r()*.3,r()*.3,r()*6,r()*6,faithful?1+r()*4:2+r()*3,r());
  }
  const count=leaves.length/18;
  return {leaves:new Float32Array(leaves),pivot:faithful?Float32Array.from({length:count},()=>r()<.3?r():0):null,
    hier:{nClusterTotal:n,clusterPlan:new Float32Array(2*n),twigs,layerBand:[2,1.5,3],clusterGeom:G,clusterData:D,swayData:S,airData:air},
    params:{faithful_canopy:faithful,leaf_swing:1.35,flutter_freq:1.4,wind_air:.5,wind_depth:.7,drift_amount:.145,drift_phase:r()*6,stem_length:.18,
      sway_height_gain:.75,canopy_base_height_m:2,canopy_thickness_m:2.6,layer_count:3},
    motion:{u:r()-.5,time:100*r(),sway:[r()*.3,r()*.3]},hMax:5,shape:null};
}
// The frame is the carriers' own box at their progress, less only the drift, which it bounds by its largest orbit: every carrier
// moveLeaves or movePatchLeaves places lies inside, and each side of the frame lies within that orbit of a carrier.
test('the moving cast\'s frame holds every carrier the reference places, and is their box but for the drift\'s orbit',()=>{
  for(const [fa,fb] of [[false,true],[true,false],[true,true],[false,false]])for(let seed=1;seed<12;seed++){
    const a=windy(seed,fa),b=windy(seed+50,fb,5);   // fewer leaves at B: some carriers fade out
    for(let i=0;i<b.leaves.length;i+=54)[b.leaves[i+2],b.leaves[i+3]]=[b.leaves[i+3],b.leaves[i+2]];   // and some leaves longer than wide
    const pairs=travel.pairLeaves(a,b),n=pairs.length,out=new Float32Array(16*n);
    const pa=travel.framePrep(a),pb=travel.framePrep(b),ka=pairs.map(p=>p[0]/18),kb=pairs.map(p=>p[1]/18);
    const trip=Float32Array.from(pairs,(_,k)=>((k*37)%n)/n),wi=new Float32Array(n);
    const e=Math.max(...[a,b].map(q=>{let r=0;for(let i=0;i<q.leaves.length;i+=18)r=Math.max(r,Math.hypot(q.leaves[i+12],q.leaves[i+13]));return q.params.drift_amount*r;}));
    for(let k=0;k<3;k++){
      for(const q of [a,b]){const p=q.hier.clusterData;for(let i=0;i<p.length;i+=4){p[i]+=.3*Math.sin(seed+k+i);p[i+1]-=.2*Math.cos(seed*k+i);}q.motion.u+=.1;q.motion.time+=.7;q.motion.sway[0]-=.05;q.params.drift_phase+=.9;}
      travel.framePoints(a,pa);travel.framePoints(b,pb);
      for(const W of [0,.3,.5,1])for(const patch of [false,true]){
        for(let c=0;c<n;c++)wi[c]=patch?travel.tripClock(trip[c],W):W;
        const box=travel.carrierBox(a,b,pa,pb,ka,kb,c=>wi[c],new Float64Array(6)),S=patch?16:12;
        if(patch)travel.movePatchLeaves(a,b,pairs,wi,[0,0],out);else travel.moveLeaves(a,b,pairs,W,out);
        const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity],eps=1e-5;
        for(let c=0;c<n;c++)[out[S*c],out[S*c+1],out[S*c+8]].forEach((v,x)=>{lo[x]=Math.min(lo[x],v);hi[x]=Math.max(hi[x],v);});
        expect(lo[0]).toBeGreaterThanOrEqual(box[0]-eps);expect(hi[0]).toBeLessThanOrEqual(box[2]+eps);
        expect(lo[1]).toBeGreaterThanOrEqual(box[1]-eps);expect(hi[1]).toBeLessThanOrEqual(box[3]+eps);
        expect(lo[2]).toBeCloseTo(box[4],4);expect(hi[2]).toBeCloseTo(box[5],4);
        expect(lo[0]-box[0]).toBeLessThanOrEqual(2*e+eps);expect(box[2]-hi[0]).toBeLessThanOrEqual(2*e+eps);
        expect(lo[1]-box[1]).toBeLessThanOrEqual(2*e+eps);expect(box[3]-hi[1]).toBeLessThanOrEqual(2*e+eps);
      }
    }
  }
});

// The frame's pad is the largest carrier at any flutter: a carrier between a foreshortened end and an open one is larger than either
// end's leaf. No carrier the reference places, at any progress and wind, is larger; and the bound is the corners' own largest, found
// by sweeping the trip finely, so it is no looser than the foreshortening's limits make it.
test('the frame\'s pad holds the largest carrier at any flutter, and no more',()=>{
  for(const [fa,fb] of [[false,true],[true,false],[true,true],[false,false]])for(let seed=1;seed<12;seed++){
    const a=windy(seed,fa),b=windy(seed+50,fb,5);
    for(let i=0;i<b.leaves.length;i+=54)[b.leaves[i+2],b.leaves[i+3]]=[b.leaves[i+3],b.leaves[i+2]];
    for(const q of [a,b])q.params.leaf_swing=6;   // flutter that reaches the foreshortening's floor
    const pairs=travel.pairLeaves(a,b),n=pairs.length,out=new Float32Array(12*n),bound=travel.carrierSize(a,b,pairs);
    let seen=0;
    for(let k=0;k<40;k++){
      for(const q of [a,b]){q.motion.time+=.37;q.motion.u=Math.sin(seed+k);}
      for(let W=0;W<=1;W+=.05){travel.moveLeaves(a,b,pairs,W,out);for(let c=0;c<n;c++)seen=Math.max(seen,out[12*c+2],out[12*c+3]);}
    }
    expect(seen).toBeLessThanOrEqual(bound*(1+1e-6));
    let sweep=0;
    for(const [ia,ib,la,lb] of pairs)for(const ha of [1,.05])for(const hb of [1,.05])for(let W=0;W<=1;W+=1/2000){
      const A=la?a.leaves[ia+2]*a.leaves[ia+3]*ha:0,B=lb?b.leaves[ib+2]*b.leaves[ib+3]*hb:0;
      const L=Math.log(a.leaves[ia+2]/(a.leaves[ia+3]*ha))*(1-W)+Math.log(b.leaves[ib+2]/(b.leaves[ib+3]*hb))*W;
      sweep=Math.max(sweep,Math.sqrt((A*(1-W)+B*W)*Math.exp(Math.abs(L))));
    }
    expect(bound).toBeGreaterThanOrEqual(sweep*(1-1e-9));expect(bound).toBeLessThanOrEqual(sweep*(1+1e-5));
  }
});

test('a carrier\'s record is each end\'s leaf as the shader reads it: its record, a layered end\'s layer fraction, fade, pivot and outline row',()=>{
  const a=windy(3,true),b=windy(9,false),pairs=travel.pairLeaves(a,b),trip=Float32Array.from(pairs,(_,i)=>i/pairs.length);
  const rec=travel.carrierRecords(a,b,pairs,trip),ref=travel.moveLeaves(a,b,pairs,0,new Float32Array(12*pairs.length));
  expect(rec.length).toBe(travel.CARRY_STRIDE*pairs.length);
  for(let n=0;n<pairs.length;n++){
    const [ia,ib,la,lb]=pairs[n],o=travel.CARRY_STRIDE*n;
    for(let k=0;k<16;k++){expect(rec[o+k]).toBe(a.leaves[ia+k]);expect(rec[o+20+k]).toBe(b.leaves[ib+k]);}
    expect(rec[o+16]).toBe(a.leaves[ia+16]);expect(rec[o+18]).toBe(a.pivot[ia/18]);expect(rec[o+38]).toBe(0);
    expect(2+rec[o+36]*2.6).toBeCloseTo(travel.moveLeaves(a,b,[pairs[n]],1,new Float32Array(12))[8],5);   // the layer's height, as moved() places it
    expect([rec[o+17],rec[o+37]]).toEqual([a.leaves[ia+17],b.leaves[ib+17]]);
    expect([rec[o+19],rec[o+39]]).toEqual([ref[12*n+10],ref[12*n+11]]);
    expect([rec[o+40],rec[o+41],rec[o+42]]).toEqual([la?1:0,lb?1:0,trip[n]]);
  }
});
