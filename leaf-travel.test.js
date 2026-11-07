import { test, expect } from 'bun:test';
import * as travel from './komorebi-leaf-travel.js';

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
