import {test,expect} from 'bun:test';
import {makeTransitions} from './komorebi-transitions.js';
import {PRESETS} from './presets.js';
import {DEFAULTS} from './komorebi-params.js';
import fixture from './test-gl/fixtures/fall-look-up.json';
import {groveTravelEligible,groveFlightProgress,matchGroveTrees,makeGroveTravel,carriedLeaf} from './komorebi-grove-travel.js';

// fall memories with inner leaves, and park 2's soft edges, which the route needs on at both ends or neither: the fixture predates both.
const fall={...fixture.from,edge_area:PRESETS['park 2'].edge_area??false,inner_leaves:.35};

function rig(from){
 const noop=()=>{},events=[];
 const hub={params:{...from},trans:{dur:1},layerVAO:[{count:1000}],grove:{litter:[{}]},
  faithfulOn:()=>true,warnCut:noop,regenSource:noop,resetPerf:noop,bake:noop,motionActive:()=>false,
  beginSceneFade:()=>events.push('fade'),rebuildAll:()=>events.push('rebuild'),
  beginGroveTravel:()=>{events.push('prepare');return true;},stepGroveTravel:(dt,t)=>events.push(['step',dt,t]),
  finishGroveTravel:()=>{events.push('land');},endGroveTravel:()=>events.push('free'),resumeAdaptive:()=>events.push('resume')};
 return {hub,events,...makeTransitions(hub)};
}

test('fall memoriez ↔ park 2 carries both rooted groves instead of dissolving completed scenes',()=>{
 for(const [from,to]of[[fall,PRESETS['park 2']],[PRESETS['park 2'],fall]]){
  const r=rig(from);r.transitionTo(to,{duration:3});
  expect(r.hub.trans.groveTravel).toBe(true);
  expect(r.hub.trans.sceneFade).toBe(false);expect(r.hub.trans.seasonTravel).toBe(false);
  expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);
  expect(r.events).toEqual(['prepare']);expect(r.hub.params).toEqual(from);
 }
});

test('the grove gate accepts the authored pair and keeps unsupported grammars on their existing route',()=>{
 const a=fall,b=PRESETS['park 2'];
 expect(groveTravelEligible(a,b)).toBe(true);expect(groveTravelEligible(b,a)).toBe(true);
 for(const both of [{inner_leaves:0},{inner_leaves:.5},{edge_area:false}])expect(groveTravelEligible({...a,...both},{...b,...both}),JSON.stringify(both)).toBe(true);   // leaves on older wood and soft edges travel
 expect(groveTravelEligible({...a,inner_leaves:0},b)).toBe(true);   // inner leaves may differ: each leaf keeps its own place at each end
 for(const patch of [{seed:1},{branch_levels:2},{branch_children:2},{limb_count:3},{leader_strength:0},
  {tree_count:3},{leaf_variety:.5},{leaf_diffuse:.1},{edge_area:!a.edge_area},{sway_pitch:.3},
  {sun_cosine:1},{sky_view:true},{receiver:1},{standing_scene:false},{faithful_canopy:false},{branch_tau:0},
  {canopy_fill:.1},{litter:1},{leaf_drop:.1},{leaf_size_m:0},{tone_map:0},{foliage_density:100}]){
  expect(groveTravelEligible(a,{...b,...patch}),JSON.stringify(patch)).toBe(false);
 }
 expect(groveTravelEligible({...a,tree_count:6},b)).toBe(false);
 expect(groveTravelEligible(PRESETS['cherry blossom'],b)).toBe(false);
});

test('floor pickups start in order and approach their destination monotonically',()=>{
 for(const id of [0,.25,.5,.75,1]){
  expect(groveFlightProgress(0,id)).toBe(0);expect(groveFlightProgress(1,id)).toBe(1);
  let previous=0;for(let i=0;i<=600;i++){const f=groveFlightProgress(i/600,id);expect(f).toBeGreaterThanOrEqual(previous);expect(f).toBeLessThanOrEqual(1);expect(f-previous).toBeLessThan(.004);previous=f;}
 }
 expect(groveFlightProgress(.15,0)).toBeGreaterThan(groveFlightProgress(.15,1));
});

test('root correspondence preserves every destination tree once and sends surplus crowns to the nearest root',()=>{
 const scene=points=>({params:{tree_count:points.length},hier:{twigs:points.map(([tx,ty],tree)=>({tx,ty,tree}))}});
 const a=scene([[0,0],[10,0],[2,0],[9,0],[30,0]]),b=scene([[1,0],[10,0]]),map=matchGroveTrees(a,b);
 expect(map.filter(p=>p.primary).map(p=>p.target).sort()).toEqual([0,1]);
 expect(map[0]).toEqual({target:0,primary:true});expect(map[1]).toEqual({target:1,primary:true});
 expect(map[2]).toEqual({target:0,primary:false});expect(map[3]).toEqual({target:1,primary:false});
 expect(map[4]).toEqual({target:1,primary:false});
});

test('a grove journey lands before handing its callback back to the frame loop',()=>{
 const r=rig(fall);let arrived=0;r.transitionTo(PRESETS['park 2'],{duration:1,onEnd:()=>arrived++});
 let callback;for(let i=0;i<121;i++)callback=r.tickTransition(1/60)||callback;
 expect(r.events.filter(x=>x==='land')).toHaveLength(1);expect(r.events.filter(x=>x==='free')).toHaveLength(1);
 expect(r.events).toContain('resume');expect(r.events).not.toContain('fade');
 expect(r.hub.trans.active).toBe(false);expect(r.hub.trans.groveTravel).toBe(false);
 expect(arrived).toBe(0);expect(typeof callback).toBe('function');callback();expect(arrived).toBe(1);
});

test('retargeting an active grove journey retains its carried geometry',()=>{
 const r=rig(fall),calls=[];r.hub.retargetGroveTravel=(to,opts)=>calls.push({to,opts});
 r.transitionTo(PRESETS['park 2']);r.tickTransition(.02);r.transitionTo(fall,{duration:2});
 expect(calls).toHaveLength(1);expect(calls[0].to).toEqual({...DEFAULTS,...fall});   // the target as the engine resolves it: every key, the saved look's own over the defaults
 expect(r.events.filter(x=>x==='prepare')).toHaveLength(1);expect(r.events).not.toContain('rebuild');
});


test('a grove whose twig population exceeds the device texture width keeps its existing route',()=>{
 const hub={params:fixture.from,MAX_TEX:128};let scenes=0;
 const travel=makeGroveTravel(hub,()=>{scenes++;throw Error('unsupported scene prepared');},()=>{});
 expect(travel.beginGroveTravel(PRESETS['park 2'])).toBe(false);expect(scenes).toBe(0);
});

test('a carried leaf on older wood drops its twig\'s bend by its pivot weight, as the bake draws it',()=>{
 const leaves=Float32Array.from([1,0,.1,.05,0,0,1,0,1,1,1,0,0,0,0,0,2,1, 1,0,.1,.05,0,0,1,0,1,1,1,0,0,0,0,0,2,1]);
 const hub={hier:{clusterData:Float32Array.from([0,.5,0,1]),clusterGeom:new Float32Array(4)},motion:{u:0,time:0,sway:[0,0]},faith:{hMax:2},
  params:{leaf_swing:0,flutter_freq:1,drift_amount:0,drift_phase:0}};
 const q={hub,data:leaves,pivot:Float32Array.from([1,.25])},o=new Float64Array(6);
 for(const [i,weight] of [[0,1],[18,.25]]){
  const T=.5*(1-weight);carriedLeaf(q,i,o);   // VS_FAITH: thT *= 1 - iPivotDrop, about the twig base, then the leaf's angle less thT
  expect(o[0]).toBeCloseTo(Math.cos(T),6);expect(o[1]).toBeCloseTo(Math.sin(T),6);expect(o[4]).toBeCloseTo(-T,6);
 }
 carriedLeaf({...q,pivot:null},0,o);expect(o[0]).toBeCloseTo(Math.cos(.5),6);   // no weights: every leaf swings with its twig, as before
});
