import {test,expect} from 'bun:test';
import {makeTransitions} from './komorebi-transitions.js';
import {PRESETS} from './presets.js';
import fixture from './test-gl/fixtures/fall-look-up.json';
import {groveTravelEligible,groveFlightProgress,matchGroveTrees,makeGroveTravel} from './komorebi-grove-travel.js';

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
 for(const [from,to]of[[fixture.from,PRESETS['park 2']],[PRESETS['park 2'],fixture.from]]){
  const r=rig(from);r.transitionTo(to,{duration:3});
  expect(r.hub.trans.groveTravel).toBe(true);
  expect(r.hub.trans.sceneFade).toBe(false);expect(r.hub.trans.seasonTravel).toBe(false);
  expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);
  expect(r.events).toEqual(['prepare']);expect(r.hub.params).toEqual(from);
 }
});

test('the grove gate accepts the authored pair and keeps unsupported grammars on their existing route',()=>{
 const a=fixture.from,b=PRESETS['park 2'];
 expect(groveTravelEligible(a,b)).toBe(true);expect(groveTravelEligible(b,a)).toBe(true);
 for(const patch of [{seed:1},{branch_levels:2},{branch_children:2},{limb_count:3},{leader_strength:0},
  {tree_count:3},{leaf_variety:.5},{inner_leaves:.1},{leaf_diffuse:.1},{edge_area:true},{sway_pitch:.3},
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
 const r=rig(fixture.from);let arrived=0;r.transitionTo(PRESETS['park 2'],{duration:1,onEnd:()=>arrived++});
 let callback;for(let i=0;i<121;i++)callback=r.tickTransition(1/60)||callback;
 expect(r.events.filter(x=>x==='land')).toHaveLength(1);expect(r.events.filter(x=>x==='free')).toHaveLength(1);
 expect(r.events).toContain('resume');expect(r.events).not.toContain('fade');
 expect(r.hub.trans.active).toBe(false);expect(r.hub.trans.groveTravel).toBe(false);
 expect(arrived).toBe(0);expect(typeof callback).toBe('function');callback();expect(arrived).toBe(1);
});

test('retargeting an active grove journey retains its carried geometry',()=>{
 const r=rig(fixture.from),calls=[];r.hub.retargetGroveTravel=(to,opts)=>calls.push({to,opts});
 r.transitionTo(PRESETS['park 2']);r.tickTransition(.02);r.transitionTo(fixture.from,{duration:2});
 expect(calls).toHaveLength(1);expect(calls[0].to).toEqual(fixture.from);
 expect(r.events.filter(x=>x==='prepare')).toHaveLength(1);expect(r.events).not.toContain('rebuild');
});


test('a grove whose twig population exceeds the device texture width keeps its existing route',()=>{
 const hub={params:fixture.from,MAX_TEX:128};let scenes=0;
 const travel=makeGroveTravel(hub,()=>{scenes++;throw Error('unsupported scene prepared');},()=>{});
 expect(travel.beginGroveTravel(PRESETS['park 2'])).toBe(false);expect(scenes).toBe(0);
});
