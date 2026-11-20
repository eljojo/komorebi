// Guards the one transition coupling that otherwise fails SILENTLY (spec/model/transitions.md): every knob in DEFAULTS must be
// classified by the scene-transition tables — it MORPHS live, deforms the CANOPY, or forces a TOPO rebuild —
// or be intentionally non-transitioning. A knob added to DEFAULTS without classifying it would just mis-morph
// with no error; these tests turn that into a loud `bun test` failure. Run: `bun test transitions.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from "../komorebi.js";
import { CANOPY_MORPH_MAX, LIT_GROUND_DIP, LIT_GROUND_HOLD } from "../engine/komorebi-params.js";
// The lit ground's exposure for a shadow opacity: the reciprocal of the light it lets onto the floor.
const held = (opacity) => 1 / (1 + (1 / LIT_GROUND_HOLD - 1) * (1 - opacity));
// The lit ground's shadow opacity at t from rest: a steep fall into the midpoint, a steep rise out of it.
const litShadow = (t) => (t < 0.5 ? 1 - (t / 0.5) ** LIT_GROUND_DIP : 1 - (1 - (t - 0.5) / 0.5) ** LIT_GROUND_DIP);
import { makeTransitions } from "../engine/transitions/komorebi-transitions.js";
import { GROVE_READS } from "../engine/canopy/komorebi-grove.js";
import { PRESETS as AUTHORED_PRESETS } from "../presets.js";
// The transition coordinator receives concrete render params; authored looks may inherit fidelity.
const PRESETS=Object.fromEntries(Object.entries(AUTHORED_PRESETS).map(([name,look])=>[name,{...DEFAULTS,...look}]));
import { makeSource } from "../engine/light/komorebi-source.js";
import { makeCast } from "../engine/transport/komorebi-cast.js";
import { DEG, clamp, lerp, smoothstep } from "../engine/komorebi-math.js";
import { beamExposure } from "../engine/light/komorebi-light.js";
import { cameraFor } from "../komorebi.js";
import { restTrans, turnBack } from "../engine/transitions/komorebi-routes.js";
import { makeSceneFade } from "../engine/transitions/komorebi-scene-fade.js";
import { makeLeafTravel } from "../engine/transitions/komorebi-leaf-travel.js";
import { makeSeasonTravel } from "../engine/transitions/komorebi-season-travel.js";
import { makeLitterRise } from "../engine/transitions/komorebi-litter-rise.js";
import { makeGroveTravel } from "../engine/transitions/komorebi-grove-travel.js";
import riseFixture from '../test-gl/fixtures/fall-look-up.json';
import shadowFixture from '../test-gl/fixtures/purple-look-up.json';
import descentFixture from '../test-gl/fixtures/look-up-fall.json';

// the DEFAULTS knobs that deliberately do NOT participate in transitions: runtime/debug flags, the look's
// tone-map + wind-pattern (live uniforms / a table swap, snapped not tweened), and the legacy clusters_per_layer.
const KNOWN_EXCLUDED = [
  "clusters_per_layer", "tone_map", "wind_pattern",
  "tree_species",   // inert label: the editor expands a TREE_SPECIES bundle into the shape knobs; the engine never reads it
  "grove_reach_m",  // 0 stands for the view, so the name is never tweened: a route goes by the reach each end grows for (reach.test.js)
  "tree_view",      // the seen tree fades over the route (treeFade), held on until it lands: nothing it reads is rebuilt
  "drift_auto", "auto_quality", "adaptive_motion", "adaptive_idle_fps", "show_source", "show_layer", "show_layer_index",
];
// standing_scene / faithful_canopy / receiver used to sit in KNOWN_EXCLUDED — but they are NOT inert: flipping one
// needs a structural rebuild. They moved to MODE_KEYS, which transitionTo folds into structDiff. (See the mode-flag test.)

// Scene-MODE flags (standing_scene, faithful_canopy, receiver, sky_view) are NOT inert: flipping one changes
// regen-time state (crown sizing, faithTex allocation, the bake path, the camera mapping), so a transition that lands
// on a differing flag must force a structural rebuild — not silently snap the flag with the old geometry/textures
// still in place. sky_view is the same class: it turns the camera over AND forces the layer tier, which reallocates.
test("scene-mode flags are classified as rebuild-forcing (MODE_KEYS), not inert", () => {
  expect(Array.isArray(MODE_KEYS)).toBe(true);
  expect(MODE_KEYS).toContain("standing_scene");
  expect(MODE_KEYS).toContain("faithful_canopy");
  expect(MODE_KEYS).toContain("receiver");
  expect(MODE_KEYS).toContain("sky_view");
});

test("the transition classes are pairwise disjoint", () => {
  const m = new Set(MORPH_KEYS), c = new Set(CANOPY_KEYS), t = new Set(TOPO_KEYS);
  for (const k of CANOPY_KEYS) expect(m.has(k)).toBe(false);
  for (const k of TOPO_KEYS) { expect(m.has(k)).toBe(false); expect(c.has(k)).toBe(false); }
  for (const k of MODE_KEYS) { expect(m.has(k)).toBe(false); expect(c.has(k)).toBe(false); expect(t.has(k)).toBe(false); }
});

test("every classified key exists in DEFAULTS (catches typos / stale renames)", () => {
  for (const k of [...MORPH_KEYS, ...CANOPY_KEYS, ...TOPO_KEYS, ...MODE_KEYS, ...KNOWN_EXCLUDED])
    expect(k in DEFAULTS).toBe(true);
});

test("every DEFAULTS knob is classified or explicitly excluded — no silent omissions", () => {
  const covered = new Set([...MORPH_KEYS, ...CANOPY_KEYS, ...TOPO_KEYS, ...MODE_KEYS, ...KNOWN_EXCLUDED]);
  const missing = Object.keys(DEFAULTS).filter((k) => !covered.has(k));
  expect(missing).toEqual([]);   // add a new knob to a transition class (MORPH/CANOPY/TOPO/MODE) or KNOWN_EXCLUDED
});

// A host's onEnd is a host callback like onFrame: the engine must schedule its next frame BEFORE it runs, or a throwing onEnd ends the
// animation. tickTransition therefore lands the route and hands the callback back for frame() to call after schedule(), never calls it.
test("a landing route's onEnd is handed back by tickTransition, not called", () => {
  let fired = 0;
  const noop = () => {};
  const hub = {
    params: { ...DEFAULTS }, faithfulOn: () => false, motionActive: () => false, crossW: 0, groveIn: null,
    regenSource: noop, resetPerf: noop, bake: noop, regenCanopy: noop, installGrove: noop,
    trans: { ...restTrans(), active: true, t: 0.99, dur: 1, durScale: 1, bloomMax: 1, crossfade: false, from: { ...DEFAULTS }, to: { ...DEFAULTS, exposure: 2 },
             swapped: true, structDiff: false, canopyMorph: false, bloom: 0, onEnd: () => { fired++; } },
  };
  const { tickTransition } = makeTransitions(hub);
  const cb = tickTransition(1);   // the step is clamped to 1/15 s: 0.99 + 0.067 lands
  expect(typeof cb).toBe("function");
  expect(fired, "not called inside the tick").toBe(0);
  expect(hub.trans.active).toBe(false);
  expect(hub.trans.onEnd, "cleared before it is handed back, so an abort cannot fire it").toBe(null);
  expect(hub.params.exposure, "landed on the target").toBe(2);
  cb();
  expect(fired).toBe(1);
  expect(tickTransition(1), "nothing to hand back once landed").toBeFalsy();
});

// The five long routes over a rig's hub: each module's own entry (its name and policy) with nothing prepared. A test replaces
// what it drives (begin, step, finish, end, retarget); one it does not expect throws at its begin, which has no scene to make.
const routesOver = hub => ({ sceneFade: makeSceneFade(hub), leafTravel: makeLeafTravel(hub), seasonTravel: makeSeasonTravel(hub),
  litterRise: makeLitterRise(hub), groveTravel: makeGroveTravel(hub) });

function transitionRig(from) {
  const noop = () => {};
  const params = { ...DEFAULTS, ...from }, swaps = [], bakes = [];   // as the engine holds a look: every key, the saved look's own over the defaults
  const hub = {
    params, trans: { ...restTrans(), dur: 1 }, layerVAO: [{ count: 1000 }], groveIn: null,
    faithfulOn: () => params.faithful_canopy && (params.receiver | 0) !== 2 && !params.sky_view,
    warnCut: noop, regenSource: noop, resetPerf: noop, bake: () => bakes.push({ ...params }), regenCanopy: noop,
    // A rebuild given a look grows the grove from that look's values for every key the grove reads (the engine's rebuildAll),
    // so a swap records what the grove is grown from.
    rebuildAll: (look) => swaps.push({ ...params, ...(look ? Object.fromEntries(GROVE_READS.map((k) => [k, look[k]])) : {}) }),
    motionActive: () => false,
    // A grove too big to morph between looks of one branching is grown beside the shown one for the crossfade.
    buildTargetGrove: () => ({}), installGrove: noop, freeGrove: noop, sizeLayers: noop,
  };
  hub.routes = routesOver(hub);
  return { ...makeTransitions(hub), hub, params, swaps, bakes };
}

for(const waiting of ['none','travel','fade']){
  test(`an over-budget correspondence dissolves from the restored source and keeps ${waiting} request callbacks`,()=>{
    const from={...DEFAULTS,faithful_canopy:true,branch_tau:0,canopy_fill:0,litter:0,leaf_drop:0,inner_leaves:0};
    const to={...from,seed:from.seed+1},next={...from,seed:from.seed+2},r=transitionRig(from);
    let arrived=0,nextArrived=0,started=0,ended=0;
    let pending=waiting==='travel'?{to:next,opts:{duration:.1,onEnd:()=>nextArrived++}}:null;
    r.hub.transitionTo=r.transitionTo;
    Object.assign(r.hub.routes.leafTravel,{begin(){},
      step(){Object.assign(r.params,from);return false;},finish:()=>{const p=pending;pending=null;return p;},end:()=>{ended++;}});
    Object.assign(r.hub.routes.sceneFade,{begin:()=>{started++;},step(){},end(){}});
    r.transitionTo(to,{duration:.4,onEnd:()=>arrived++});
    if(waiting==='fade')r.transitionTo(next,{style:'fade',duration:.1,onEnd:()=>nextArrived++});
    r.tickTransition(1/60);
    expect(r.hub.trans.route?.name).toBe('sceneFade');
    expect(r.hub.trans.bloomMax).toBe(0);
    expect(r.hub.trans.dur).toBe(.4);
    expect(r.hub.trans.t).toBe(0);
    expect(started).toBe(1);expect(ended).toBe(1);
    let frames=0;while(r.hub.trans.active&&frames++<200)r.tickTransition(1/60)?.();
    expect(r.hub.trans.active).toBe(false);
    expect(arrived).toBe(waiting==='none'?1:0);
    expect(nextArrived).toBe(waiting==='none'?0:1);
    expect(r.params.seed).toBe(waiting==='none'?to.seed:next.seed);
  });
}

test('density routing: summer fixed groves reweight within the peak budget, including a bare source', () => {
  for (const fromDensity of [0, 0.4, 1.65]) for (const density of [0.4, 1.65]) {
    if (fromDensity === density) continue;
    const from = { ...DEFAULTS, leaves_per_cluster: 39, foliage_density: fromDensity }, r = transitionRig(from);
    r.hub.hier = { nClusterTotal: 360 };
    r.hub.layerVAO = [{ count: 360*Math.ceil(39*fromDensity) }];
    const capacities = []; let regrows = 0;
    r.hub.reweight = capacity => capacities.push(capacity);
    r.hub.regenCanopy = () => regrows++;
    r.transitionTo({ ...from, foliage_density: density, trans_r: 0.1 });
    expect(r.hub.trans.densityMorph).toBe(true);
    r.tickTransition(1/60);
    expect(capacities).toEqual([Math.max(fromDensity, density)]); expect(regrows).toBe(0); expect(r.bakes).toHaveLength(1);
  }
  for (const over of [{ tree_count: 6 }, { leaf_size_m: 0.2 }, { view_extent_m: 9 }, { canopy_base_height_m: 6 }, { phenology: 0.8 }, { tree_clock_spread: 0.2 }, { leaf_drop: 1 }]) {
    const from = { ...DEFAULTS }, r = transitionRig(from); r.hub.hier = { nClusterTotal: 360 };
    r.transitionTo({ ...from, foliage_density: 0.4, ...over });
    expect(r.hub.trans.densityMorph, JSON.stringify(over)).toBe(false);
  }
  for (const count of [CANOPY_MORPH_MAX/65, CANOPY_MORPH_MAX/65 + 1]) {
    const from = { ...DEFAULTS, leaves_per_cluster: 39, foliage_density: 0 }, r = transitionRig(from);
    r.hub.hier = { nClusterTotal: count }; r.hub.layerVAO = [{ count: 0 }];
    r.transitionTo({ ...from, foliage_density: 1.65 });
    expect(r.hub.trans.canopyMorph).toBe(count*65 <= CANOPY_MORPH_MAX);
  }
  const from = { ...DEFAULTS, leaves_per_cluster: 39, foliage_density: 0.4 }, r = transitionRig(from);
  const clusters = Math.floor(CANOPY_MORPH_MAX/65);
  r.hub.hier = { nClusterTotal: clusters }; r.hub.layerVAO = [{ count: clusters*16 }];
  r.transitionTo({ ...from, foliage_density: 1.65 });
  expect(r.hub.trans.canopyMorph, 'retain the original conservative budget as well as covering the capacity').toBe(clusters*16*(1.65/0.4) <= CANOPY_MORPH_MAX);
});

test('tint morphs select re-season, while autumn density or leaf geometry still regrows', () => {
  for (const other of [{}, { foliage_density: 2 }, { tree_count: 6 }, { leaf_size_m: 0.2 }, { cluster_spread_m: 0.4 }]) {
    const from = { ...DEFAULTS, phenology: 0.8, trans_r: 0.21, trans_g: 0.356, trans_b: 0.336 };
    const r = transitionRig(from); let seasons = 0, regrows = 0;
    r.hub.reseason = () => seasons++; r.hub.regenCanopy = () => regrows++;
    r.transitionTo({ ...from, trans_r: 0.094, trans_g: 0.402, trans_b: 0.1, ...other });
    expect(r.hub.trans.canopyMorph).toBe(true);
    r.tickTransition(1/60);
    expect(seasons).toBe(Object.keys(other).length ? 0 : 1);
    expect(regrows).toBe(Object.keys(other).length ? 1 : 0);
    expect(r.bakes).toHaveLength(1);
  }
});

for(const [from,to] of [['morning 1','memories'],['memories','morning 1']]){
  test(`${from} → ${to}: the grove reorganizes without a cloud or halo detour`,()=>{
    const r=transitionRig(PRESETS[from]),target={},installed=[];let overlap=false,arrived=0;
    Object.assign(r.hub,{perf:{auto:false},src:{},buildTargetGrove:()=>target,installGrove:g=>installed.push(g),
      effCloud:()=>clamp(lerp(r.params.cloud_thickness,1,r.hub.trans.bloom),0,1)});
    r.hub.regenSource=makeSource(r.hub).regenSource;
    r.transitionTo(PRESETS[to],{duration:1,onEnd:()=>arrived++});
    expect(r.hub.trans.crossfade).toBe(true);expect(r.hub.groveIn).toBe(target);
    expect(r.hub.trans.durScale).toBe(2);
    let previous=r.params.cloud_thickness,callback,frames=0;
    while(r.hub.trans.active&&frames++<130){
      callback=r.tickTransition(1/60)||callback;
      const p=r.params,src=r.hub.src,core=p.core_angular_radius_deg*DEG;
      expect(src.haloR).toBeCloseTo(lerp(core*2,p.halo_angular_radius_deg*DEG,p.cloud_thickness),12);
      const nCore=Math.max(3,Math.round(src.count*.5));let weight=0;
      for(let i=0;i<nCore;i++)weight+=src.flat[i*3+2];
      expect(weight).toBeCloseTo(p.core_weight_fraction*(1-p.cloud_thickness),6);
      expect((p.cloud_thickness-previous)*(PRESETS[to].cloud_thickness-PRESETS[from].cloud_thickness)).toBeGreaterThanOrEqual(0);
      expect(r.hub.trans.bloom).toBe(0);previous=p.cloud_thickness;
      overlap ||= r.hub.crossW>0&&r.hub.crossW<1;
    }
    expect(overlap).toBe(true);expect(installed).toEqual([target]);expect(r.swaps).toHaveLength(0);
    expect(r.hub.trans.active).toBe(false);expect(r.params).toEqual(PRESETS[to]);
    expect(arrived).toBe(0);callback();expect(arrived).toBe(1);
  });
}

test('topology swaps outside the shared layer bake retain their cloud cover',()=>{
  for(const to of [{...PRESETS.memories,seed:123,branch_tau:1},{...PRESETS.memories,sky_view:true},{...PRESETS.memories,bake_resolution:1536}]){
    const r=transitionRig(PRESETS.memories);r.transitionTo(to);
    expect(r.hub.trans.crossfade).toBe(false);
    for(let i=0;i<60;i++)r.tickTransition(1/60);
    expect(r.hub.trans.bloom).toBeGreaterThan(0);
  }
});

// The cloud dissolve regrows the grove once, at the midpoint, while the MORPH keys are still mid-tween. view_extent_m is one of
// them and sizes a park crown, so a grove grown from the tweening value would land as neither look's grove.
test('morning 3b → eclipse with wood: the grove grown under the bloom is the target\'s, while the camera keeps tweening', () => {
  const from = { ...PRESETS['morning 3b'], branch_tau: 0.5 }, to = { ...PRESETS.eclipse, branch_tau: 0.5 }, r = transitionRig(from);   // wood closes the crossfade
  expect(from.view_extent_m).not.toBe(to.view_extent_m);
  r.transitionTo(to);
  expect(r.hub.trans.structDiff && !r.hub.trans.crossfade && !r.hub.trans.backgroundFade, 'takes the cloud dissolve').toBe(true);
  while (r.hub.trans.active && !r.swaps.length) r.tickTransition(1 / 60);
  expect(r.swaps).toHaveLength(1);
  for (const k of GROVE_READS) expect(r.swaps[0][k], `${k} when the grove is grown`).toBe(to[k]);
  expect(r.params.view_extent_m, 'the picture keeps its tween').toBeGreaterThan(from.view_extent_m);
  expect(r.params.view_extent_m).toBeLessThan(to.view_extent_m);
  while (r.hub.trans.active) r.tickTransition(1 / 60);
  expect(r.swaps).toHaveLength(1);
  expect(r.params).toEqual(to);
});

test('fall memories → look up lifts the actual litter without a midpoint swap',()=>{
  const r=transitionRig(riseFixture.from);let began=0,steps=0,ended=0,arrived=0;
  r.hub.grove={litter:[{}]};
  Object.assign(r.hub.routes.litterRise,{begin:()=>began++,step:()=>steps++,finish:()=>null,end:()=>ended++});
  r.transitionTo(riseFixture.to,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.route?.name).toBe('litterRise');expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);expect(began).toBe(1);
  expect(r.swaps).toHaveLength(1);
  let cb;for(let i=0;i<122&&r.hub.trans.active;i++)cb=r.tickTransition(1/60);
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(ended).toBe(1);
  expect(r.hub.trans.active).toBe(false);expect(r.params.sky_view).toBe(true);expect(arrived).toBe(0);cb?.();expect(arrived).toBe(1);
});

test('purple eye → look up carries its shadow footprints without a midpoint swap',()=>{
  const r=transitionRig(shadowFixture.from);let began,steps=0,ended=0,arrived=0;
  Object.assign(r.hub.routes.litterRise,{begin:(to,footprints)=>began={to,footprints},step:()=>steps++,finish:()=>null,end:()=>ended++});
  r.transitionTo(shadowFixture.to,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.route?.name).toBe('litterRise');expect(r.hub.trans.shadowRise).toBe(true);
  expect(began).toEqual({to:{...DEFAULTS,...shadowFixture.to},footprints:true});
  expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);
  expect(r.swaps).toHaveLength(1);
  let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(ended).toBe(1);
  expect(r.params.sky_view).toBe(true);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
});

test('look up → fall memories keeps the live sky grove until the carpet landing',()=>{
  const r=transitionRig(descentFixture.from);let began,ended=0,arrived=0,steps=0;
  Object.assign(r.hub.routes.litterRise,{begin:(to,footprints,reverse)=>began={to,footprints,reverse},step:()=>steps++,
    finish:()=>{Object.assign(r.params,descentFixture.to);r.hub.rebuildAll();return null;},end:()=>ended++});
  r.transitionTo(descentFixture.to,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.route?.name).toBe('litterRise');expect(r.hub.trans.litterFall).toBe(true);
  expect(began).toEqual({to:{...DEFAULTS,...descentFixture.to},footprints:false,reverse:true});
  expect(r.params.sky_view).toBe(true);expect(r.swaps).toHaveLength(0);
  for(let i=0;i<100;i++){r.tickTransition(1/60);expect(r.params.sky_view).toBe(true);expect(r.swaps).toHaveLength(0);expect(r.hub.trans.bloom).toBe(0);}
  let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(r.params).toEqual({...DEFAULTS,...descentFixture.to});
  expect(ended).toBe(1);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
});

test('a floor with no dropped leaves keeps its existing transition when descent preparation declines',()=>{
  const r=transitionRig(descentFixture.from);let prepared=0;
  r.hub.routes.litterRise.begin=()=>{prepared++;return false;};
  r.transitionTo(descentFixture.to);
  expect(prepared).toBe(1);expect(r.hub.trans.route?.name).not.toBe('litterRise');expect(r.hub.trans.litterFall).not.toBe(true);
  expect(r.hub.trans.structDiff).toBe(true);
});

test('look up → purple eye keeps the live sky grove until the footprints land',()=>{
  const r=transitionRig(shadowFixture.to);let began,ended=0,arrived=0,steps=0;
  Object.assign(r.hub.routes.litterRise,{begin:(to,footprints,reverse)=>began={to,footprints,reverse},step:()=>steps++,
    finish:()=>{Object.assign(r.params,shadowFixture.from);r.hub.rebuildAll();return null;},end:()=>ended++});
  r.transitionTo(shadowFixture.from,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.route?.name).toBe('litterRise');expect(r.hub.trans.shadowFall).toBe(true);
  expect(began).toEqual({to:{...DEFAULTS,...shadowFixture.from},footprints:true,reverse:true});
  expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);
  for(let i=0;i<100;i++){r.tickTransition(1/60);expect(r.params.sky_view).toBe(true);expect(r.swaps).toHaveLength(0);expect(r.hub.trans.bloom).toBe(0);}
  let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(r.params).toEqual({...DEFAULTS,...shadowFixture.from});
  expect(ended).toBe(1);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
});

test('a leafless floor keeps the existing transition when the footprint descent declines',()=>{
  const r=transitionRig(shadowFixture.to);let prepared=0;
  r.hub.routes.litterRise.begin=()=>{prepared++;return false;};
  r.transitionTo(shadowFixture.from);
  expect(prepared).toBe(1);expect(r.hub.trans.route?.name).not.toBe('litterRise');expect(r.hub.trans.shadowFall).not.toBe(true);
  expect(r.hub.trans.structDiff).toBe(true);
});

test('afternoon 4, 4b, 5, 5b and prism → afternoon 6b do not morph their leaves onto the older wood: a leaf flew 2.5 of its lengths a frame and gaps flickered, so the inner leaves cross as two groves',()=>{
  for(const n of ['afternoon 4','afternoon 4b','afternoon 5','afternoon 5b','prism']) for(const [from,to] of [[PRESETS[n],PRESETS['afternoon 6b']],[PRESETS['afternoon 6b'],PRESETS[n]]]){
    const r=transitionRig(from);
    Object.assign(r.hub.routes.sceneFade,{begin:()=>{},end:()=>{},step:()=>{}});
    r.transitionTo(to,{duration:1});
    expect(r.hub.trans.canopyMorph,`${n}: no leaf-by-leaf morph across inner_leaves`).toBe(false);
    expect(r.hub.trans.crossfade,`${n}: the two groves crossfade`).toBe(true);
  }
});

test('morning 3b → morning 3 does not morph its leaves between their shoots and their old places: the two arrangements cross as two groves, so no leaf flies (the leaves flickered)',()=>{
  for(const [from,to] of [[PRESETS['morning 3b'],PRESETS['morning 3']],[PRESETS['morning 3'],PRESETS['morning 3b']]]){
    const r=transitionRig(from);
    Object.assign(r.hub.routes.sceneFade,{begin:()=>{},end:()=>{},step:()=>{}});
    r.transitionTo(to,{duration:1});
    expect(r.hub.trans.canopyMorph,'no leaf-by-leaf morph across shoot_leaves').toBe(false);
    expect(r.hub.trans.crossfade||r.hub.trans.structDiff,'the two groves cross').toBe(true);
  }
});

test('a pair that sees its tree keeps the cast: cherry blossom ↔ park 2 with tree_view takes no season travel, which would draw its own leaves and not the tree',()=>{
  const tree={tree_view:true};
  for(const [from,to] of [[{...PRESETS['cherry blossom'],...tree},{...PRESETS['park 2'],...tree}],[{...PRESETS['park 2'],...tree},{...PRESETS['cherry blossom'],...tree}]]){
    const r=transitionRig(from);let began=0;
    Object.assign(r.hub.routes.seasonTravel,{begin:()=>began++,step:()=>{},finish:()=>null,end:()=>{}});
    r.hub.routes.groveTravel.begin=()=>{throw Error('unexpected beginGroveTravel');};r.hub.routes.litterRise.begin=()=>{throw Error('unexpected beginLitterRise');};
    Object.assign(r.hub.routes.sceneFade,{begin:()=>{},end:()=>{},step:()=>{}});
    r.transitionTo(to,{duration:1});
    expect(r.hub.trans.route?.name).not.toBe('seasonTravel');expect(began).toBe(0);
    let n=0;while(r.hub.trans.active&&n++<10000)r.tickTransition(1/60);
    for(const k in DEFAULTS)expect(r.params[k],k).toBe(k==='drift_phase'?r.params[k]:to[k]);
  }
});

test('under the trees ↔ park 2 keeps the grove and the shadow: the camera glides and the seen tree fades, with no bloom and no rebuild',()=>{
  const park2={...PRESETS['park 2'],leaf_shape:'maple'};   // park story's leaves are maple since 2026-11-19, park 2's (an experiment) the ellipse still: the pair as one grove
  for(const [from,to] of [[PRESETS['park 1, under the trees'],park2],[park2,PRESETS['park 1, under the trees']]]){
    const r=transitionRig(from),out=!!from.tree_view;
    r.hub.routes.sceneFade.begin=()=>{throw Error('unexpected scene fade');};r.hub.routes.seasonTravel.begin=()=>{throw Error('unexpected season travel');};
    r.hub.routes.groveTravel.begin=()=>{throw Error('unexpected grove travel');};r.hub.routes.litterRise.begin=()=>{throw Error('unexpected litter rise');};
    r.transitionTo(to,{duration:1});
    expect(r.hub.trans.treeFade,'the tree fades').toBe(true);
    expect(r.hub.trans.structDiff,'nothing is rebuilt').toBe(false);
    expect(r.hub.trans.backgroundFade,'the shadow does not fade to the ground').toBe(false);
    const shown=[];
    while(r.hub.trans.active){
      expect(r.params.tree_view,'the tree is held on while it fades').toBe(true);
      expect(r.hub.trans.bloom,'no bloom').toBe(0);
      shown.push(r.hub.trans.treeOpacity);
      r.tickTransition(1/60);
    }
    expect(shown[0]).toBe(out?1:0);
    for(let i=1;i<shown.length;i++) expect(out?shown[i]<=shown[i-1]:shown[i]>=shown[i-1],`step ${i}`).toBe(true);
    expect(r.swaps.length,'no grove rebuilt').toBe(0);
    for(const k in DEFAULTS)expect(r.params[k],k).toBe(k==='drift_phase'?r.params[k]:to[k]);
    expect(r.hub.trans.treeFade,'a landed route fades nothing').toBe(false);
  }
});

test('cherry blossom ↔ park 2 follows one seasonal grove without a scene dissolve',()=>{
  for(const [from,to] of [[PRESETS['cherry blossom'],PRESETS['park 2']],[PRESETS['park 2'],PRESETS['cherry blossom']]]){
    const r=transitionRig(from);let began=0,steps=0,ended=0,arrived=0;
    Object.assign(r.hub.routes.seasonTravel,{begin:()=>began++,step:()=>steps++,finish:()=>null,end:()=>ended++});
    Object.assign(r.hub.routes.sceneFade,{begin:()=>{},end:()=>{},step:()=>{}});
    r.transitionTo(to,{duration:1,onEnd:()=>arrived++});
    expect(r.hub.trans.route?.name).toBe('seasonTravel');
    expect(r.hub.trans.bloomMax).toBe(0);expect(began).toBe(1);
    let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
    expect(steps).toBeGreaterThan(0);expect(ended).toBe(1);
    for(const k in DEFAULTS)expect(r.params[k],k).toBe(k==='drift_phase'?from[k]:to[k]);
    expect(r.swaps).toHaveLength(0);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
  }
});

test('park 1, from above ↔ park fall turns one grove through the season while the seen tree fades, the reach past the bake\'s cap moving nothing',()=>{
  const above=PRESETS['park 1, from above'],fall=PRESETS['park fall'];
  expect(above.grove_reach_m).not.toBe(fall.grove_reach_m);   // two reaches as written, one span grown (groveFill)
  for(const [from,to] of [[above,fall],[fall,above]]){
    const r=transitionRig(from);let began=0;
    Object.assign(r.hub.routes.seasonTravel,{begin:()=>began++,step:()=>{},finish:()=>null,end:()=>{}});
    r.transitionTo(to,{duration:1});
    expect(r.hub.trans.route?.name,'the season travel, not a dissolve').toBe('seasonTravel');
    expect(began).toBe(1);
    expect(r.hub.trans.treeFade,'the seen tree fades').toBe(true);
    const shown=[];
    while(r.hub.trans.active){ shown.push(r.hub.trans.treeOpacity); r.tickTransition(1/60); }
    expect(shown[0]).toBe(from.tree_view?1:0);
    expect(shown.some(o=>o>0&&o<1),'through every opacity, not a switch').toBe(true);
    for(let i=1;i<shown.length;i++) expect(from.tree_view?shown[i]<=shown[i-1]:shown[i]>=shown[i-1],`step ${i}`).toBe(true);
    expect(r.swaps,'no grove rebuilt').toHaveLength(0);
    for(const k in DEFAULTS)expect(r.params[k],k).toBe(k==='drift_phase'?r.params[k]:to[k]);
  }
});

test('the park story\'s standing looks move only the camera between them: their reaches differ past the bake\'s cap, which grows one grove',()=>{
  // park1 inside2 and park 1, from above arm the carpet, a topo key, so under the trees dissolves into inside2; each pair either side moves only its camera.
  for(const [x,y] of [['park 1, the scene','park 1, under the trees'],['park1 inside2','park 1, from above']])for(const [a,b] of [[x,y],[y,x]]){
    const r=transitionRig(PRESETS[a]);
    r.transitionTo(PRESETS[b],{duration:1});
    expect(r.hub.trans.canopyMorph,`${a} → ${b}: no regrow`).toBe(false);
    expect(r.hub.trans.structDiff,`${a} → ${b}: no rebuild`).toBe(false);
    expect(r.hub.trans.route,`${a} → ${b}: no long route`).toBeNull();
    while(r.hub.trans.active) r.tickTransition(1/60);
    expect(r.swaps,`${a} → ${b}: no grove rebuilt`).toHaveLength(0);
  }
});

test('montebello ↔ park fall and rain ↔ park fall route to leaf travel instead of an ordinary grove morph',()=>{
  for(const [a,b] of [[PRESETS.montebello,PRESETS['park fall']],[PRESETS['montebello, rain'],PRESETS['park fall']]]){
    for(const [from,to] of [[a,b],[b,a]]){
      const r=transitionRig(from);let began=0;
      r.hub.routes.seasonTravel.begin=()=>began++;
      r.transitionTo(to);
      expect(r.hub.trans.route?.name).toBe('seasonTravel');
      expect(r.hub.trans.canopyMorph).toBe(false);
      expect(r.hub.trans.bloomMax).toBe(0);
      expect(r.hub.trans.durScale).toBe(2);
      expect(began).toBe(1);expect(r.swaps).toHaveLength(0);
    }
  }
});

test("a shared grove turns continuously between sky and floor without a midpoint rebuild", () => {
  for(const sky of [true,false]) {
    const from={...DEFAULTS,sky_view:sky,faithful_canopy:false,standing_scene:true,branch_tau:0,canopy_fill:0,litter:0,
      view_pitch_deg:sky?80:16,view_fov_deg:64};
    const target={...from,sky_view:!sky,view_pitch_deg:sky?16:80};
    const r=transitionRig(from);r.transitionTo(target,{duration:1});
    expect(r.hub.trans.viewpoint).toBe(true);
    expect(r.hub.trans.viewElevation).toBeCloseTo((sky?80:-74)*Math.PI/180,12);
    for(let i=0;i<60;i++)r.tickTransition(1/60);
    expect(r.hub.trans.viewElevation).toBeCloseTo(3*Math.PI/180,10);
    expect(r.hub.trans.viewSkyWeight).toBeCloseTo(0.5,12);
    expect(r.hub.trans.bloom).toBe(0);
    expect(r.swaps).toHaveLength(0);
    while(r.hub.trans.active)r.tickTransition(1/60);
    expect(r.params).toEqual(target);
    expect(r.swaps).toHaveLength(1);
  }
});

test("viewpoint routing keeps grove replacement, faithful casts, wood, fill and other receivers on existing paths", () => {
  const from={...DEFAULTS,sky_view:true,standing_scene:true,faithful_canopy:false,view_pitch_deg:80,view_fov_deg:64};
  for(const change of [{seed:123},{foliage_density:2},{faithful_canopy:true},{standing_scene:false},
    {branch_tau:2},{canopy_fill:0.4},{litter:1},{receiver:1},{view_pitch_deg:80}]) {
    const r=transitionRig(from);
    r.transitionTo({...from,sky_view:false,view_pitch_deg:16,...change});
    expect(r.hub.trans.viewpoint,JSON.stringify(change)).toBe(false);
  }
});

test("interrupting a viewpoint move continues from the current eye and gaze", () => {
  const from={...DEFAULTS,sky_view:true,standing_scene:true,view_pitch_deg:80,view_fov_deg:64};
  const r=transitionRig(from);r.transitionTo({...from,sky_view:false,view_pitch_deg:16});
  for(let i=0;i<40;i++)r.tickTransition(1/60);
  const eye=[...r.hub.trans.viewEye],angle=r.hub.trans.viewElevation;
  r.transitionTo(from);r.tickTransition(0);
  expect(r.hub.trans.viewpoint).toBe(true);
  expect(r.hub.trans.viewEye).toEqual(eye);
  expect(r.hub.trans.viewElevation).toBe(angle);
});

test("a partial cloud or grove transition cannot become a shared-grove viewpoint", () => {
  const from={...DEFAULTS,sky_view:true,standing_scene:true,view_pitch_deg:80,view_fov_deg:64};
  const r=transitionRig(from);
  r.transitionTo({...from,cloud_thickness:.8});
  r.tickTransition(1/60);
  r.transitionTo({...r.params,sky_view:false,view_pitch_deg:16});
  expect(r.hub.trans.viewpoint).toBe(false);
});

test("a woodless overhead faithful↔layer switch moves leaves without clearing the floor or swapping at midpoint",()=>{
  const from={...DEFAULTS,standing_scene:false,faithful_canopy:true,branch_tau:0,canopy_fill:0,litter:0};
  const r=transitionRig(from);let started=0,steps=0,ended=0;
  Object.assign(r.hub.routes.leafTravel,{begin:()=>started++,step:()=>steps++,finish:()=>null,end:()=>ended++});
  r.transitionTo({...from,faithful_canopy:false,seed:123,layer_count:3,tone_map:2});
  expect(r.hub.trans.route?.name).toBe('leafTravel');
  expect(r.hub.trans.backgroundFade).toBe(false);
  expect(r.hub.trans.bloomMax).toBe(0);
  expect(started).toBe(1);
  for(let i=0;i<61;i++)r.tickTransition(1/60);
  expect(r.swaps).toHaveLength(1); // the incoming native grove is built at the start, ready to receive the moving leaves
  expect(steps).toBeGreaterThan(0);
  while(r.hub.trans.active)r.tickTransition(1/60);
  expect(ended).toBe(1);
  expect(r.params.faithful_canopy).toBe(false);
});

test("leaf travel leaves other modes, empty groves, drop and oversized correspondences on their existing routes",()=>{
  const from={...DEFAULTS,faithful_canopy:true};
  for(const change of [{branch_tau:1},{canopy_fill:.5},{standing_scene:true},{sky_view:true},{receiver:1},
    {litter:1},{leaf_drop:1},{leaf_size_m:0},{foliage_density:0},{tree_count:1000}]){
    const r=transitionRig(from);r.hub.routes.leafTravel.begin=()=>{throw Error('unsupported leaf travel');};
    r.transitionTo({...from,faithful_canopy:false,...change});expect(r.hub.trans.route?.name,JSON.stringify(change)).not.toBe('leafTravel');
  }
});

const eased=t=>t*t*(3-2*t);
test("a hood turning on keeps the incoming geometry for the whole route and fades in on the eased progress", () => {
  const r=transitionRig({...DEFAULTS,vignette:0,vignette_shape:2});
  r.transitionTo({...r.params,vignette:0.24,vignette_shape:3.1});
  expect(r.hub.trans.irisOpacity).toBe(0);
  expect(r.params.vignette).toBe(0);   // nothing moves before the first step: a zero-time redraw is the outgoing look
  let shown=0,frames=0;
  while(r.hub.trans.active){
    r.tickTransition(1/60); frames++;
    expect(r.params.vignette).toBe(0.24); expect(r.params.vignette_shape).toBe(3.1);
    expect(r.hub.trans.irisOpacity).toBeCloseTo(eased(r.hub.trans.t),12);
    expect(r.hub.trans.irisOpacity).toBeGreaterThanOrEqual(shown); shown=r.hub.trans.irisOpacity;
  }
  expect(frames).toBe(60);
  expect(shown).toBe(1);
  expect("irisRadius" in r.hub.trans).toBe(false);
});

test("a hood turning off keeps the outgoing geometry for the whole route and fades out, landing on the target exactly", () => {
  const r=transitionRig({...DEFAULTS,vignette:0.24,vignette_shape:3.1});
  r.transitionTo({...r.params,vignette:0,vignette_shape:2});
  expect(r.hub.trans.irisOpacity).toBe(1);
  let shown=1;
  for(let i=0;i<59;i++){
    r.tickTransition(1/60);
    expect(r.params.vignette).toBe(0.24); expect(r.params.vignette_shape).toBe(3.1);
    expect(r.hub.trans.irisOpacity).toBeCloseTo(1-eased(r.hub.trans.t),12);
    expect(r.hub.trans.irisOpacity).toBeLessThanOrEqual(shown); shown=r.hub.trans.irisOpacity;
  }
  r.tickTransition(1/60);
  expect(r.hub.trans.active).toBe(false);
  expect(r.hub.trans.irisOpacity).toBe(0);
  expect(r.params.vignette).toBe(0); expect(r.params.vignette_shape).toBe(2);
});

test("two hooded looks morph feather and shape at full opacity, as before", () => {
  const r=transitionRig({...DEFAULTS,vignette:0.24,vignette_shape:3.1});
  r.transitionTo({...r.params,vignette:0.4,vignette_shape:5});
  expect(r.hub.trans.iris).toBe(null);
  for(let i=0;i<30;i++) r.tickTransition(1/60);
  const e=eased(r.hub.trans.t);
  expect(r.params.vignette).toBeCloseTo(0.24+(0.4-0.24)*e,12);
  expect(r.params.vignette_shape).toBeCloseTo(3.1+(5-3.1)*e,12);
  expect(r.hub.trans.irisOpacity).toBe(1);
});

test("an interrupted fade starts the next route from the opacity it shows", () => {
  for(const [next,end] of [[{vignette:0.4,vignette_shape:5},1],[{vignette:0},0]]){
    const r=transitionRig({...DEFAULTS,vignette:0});
    r.transitionTo({...r.params,vignette:0.24,vignette_shape:3.1});
    for(let i=0;i<20;i++) r.tickTransition(1/60);
    const shown=r.hub.trans.irisOpacity;
    expect(shown).toBeGreaterThan(0); expect(shown).toBeLessThan(1);
    r.transitionTo({...r.params,...next});
    expect(r.hub.trans.irisOpacity).toBe(shown);
    r.tickTransition(0);
    expect(r.hub.trans.irisOpacity).toBe(shown);
    expect(r.params.vignette).toBe(0.24);
    let last=shown;
    while(r.hub.trans.active){
      r.tickTransition(1/60);
      const o=r.hub.trans.irisOpacity;
      if(end) expect(o).toBeGreaterThanOrEqual(last); else { expect(o).toBeLessThanOrEqual(last); if(r.hub.trans.active) expect(r.params.vignette).toBe(0.24); }
      last=o;
    }
    expect(last).toBe(end);
    expect(r.params.vignette).toBe(next.vignette);
  }
});

// Two faithful overhead groves that differ structurally: P1 a layer count, density and tone; P2 a seed, leader and outline.
const faithfulPairs = [{ layer_count: 4, foliage_density: 2.4, tone_map: 0 },
                       { seed: 783609357, leader_strength: 0.55, leaf_shape: "maple", foliage_density: 1 }];
const faithfulFrom = { ...DEFAULTS, faithful_canopy: true, layer_count: 3, foliage_density: 0.4, tone_map: 2 };

test("leaf travel carries the ground's brightest channel straight between two hues, so a steep contrast keeps its midtones", () => {
  const green = { ground_r: 0.41, ground_g: 0.96, ground_b: 0.21 }, blue = { ground_r: 0.33, ground_g: 0.22, ground_b: 1 };
  const r = transitionRig({ ...faithfulFrom, ...green }), target = { ...faithfulFrom, ...faithfulPairs[0], ...blue };
  Object.assign(r.hub.routes.leafTravel, { begin() {}, step() {}, finish: () => null, end() {} });
  r.transitionTo(target, { duration: 1 });
  expect(r.hub.trans.route?.name).toBe('leafTravel');
  let lowest = Infinity;
  while (r.hub.trans.active) {
    r.tickTransition(1 / 60);
    const peak = Math.max(r.params.ground_r, r.params.ground_g, r.params.ground_b);
    lowest = Math.min(lowest, peak);
    for (const k of ["ground_r", "ground_g", "ground_b"]) expect(r.params[k]).toBeLessThanOrEqual(1);
  }
  expect(lowest).toBeGreaterThanOrEqual(0.96 - 1e-9);   // a plain per-channel tween dips to 0.61 midway
  for (const k of ["ground_r", "ground_g", "ground_b"]) expect(r.params[k]).toBe(blue[k]);
});

test("two faithful overhead groves that differ structurally travel their leaves, with no bloom and no scene dissolve", () => {
  for (const change of faithfulPairs) {
    const r = transitionRig(faithfulFrom), target = { ...faithfulFrom, ...change };
    let began = 0, steps = 0, ended = 0;
    Object.assign(r.hub.routes.leafTravel, { begin: () => began++, step: () => steps++, finish: () => null, end: () => ended++ });
    r.hub.routes.sceneFade.begin = () => { throw Error("unexpected scene dissolve"); };
    r.transitionTo(target, { duration: 1 });
    expect(r.hub.trans.route?.name).toBe('leafTravel');
    expect(r.hub.trans.bloomMax).toBe(0);
    expect(r.hub.trans.durScale).toBe(2);
    expect(began).toBe(1);
    while (r.hub.trans.active) { r.tickTransition(1 / 60); expect(r.hub.trans.bloom).toBe(0); }
    expect(steps).toBeGreaterThan(110); expect(ended).toBe(1);
    for (const k in DEFAULTS) if (k !== "drift_phase") expect(r.params[k], k).toBe(target[k]);
  }
});

test("leaves on older wood travel like any other: inner leaves at either end or both keep leaf travel", () => {
  const layered = { ...faithfulFrom, faithful_canopy: false, seed: 123 };
  for (const [from, to] of [[{ inner_leaves: 0.5 }, { inner_leaves: 0.5 }], [{ inner_leaves: 0 }, { inner_leaves: 0.35 }], [{ inner_leaves: 0.35 }, { inner_leaves: 0 }]])
    for (const target of [{ ...faithfulFrom, ...faithfulPairs[1] }, layered]) {
      const r = transitionRig({ ...faithfulFrom, ...from });
      Object.assign(r.hub.routes.leafTravel, { begin() {}, step() {}, finish: () => null, end() {} });
      r.hub.routes.sceneFade.begin = () => { throw Error("unexpected scene dissolve"); };
      r.transitionTo({ ...target, ...to });
      expect(r.hub.trans.route?.name, JSON.stringify([from, to, target.faithful_canopy])).toBe('leafTravel');
    }
});

test("faithful overhead pairs a gentler route joins keep it: live morph, grove morph, re-season", () => {
  for (const [change, route] of [[{ exposure: 2 }, null], [{ leaf_size_m: DEFAULTS.leaf_size_m * 1.2 }, "canopyMorph"], [{ phenology: 0.8 }, "seasonMorph"]]) {
    const r = transitionRig(faithfulFrom);
    r.hub.routes.leafTravel.begin = () => { throw Error("unexpected leaf travel"); }; r.hub.routes.sceneFade.begin = () => { throw Error("unexpected scene dissolve"); };
    r.transitionTo({ ...faithfulFrom, ...change });
    expect(r.hub.trans.route?.name, JSON.stringify(change)).not.toBe('leafTravel');
    if (route) expect(r.hub.trans[route], JSON.stringify(change)).toBe(true);
  }
});

test("a faithful structural pair leaf travel refuses still takes the scene dissolve", () => {
  for (const both of [{ branch_tau: 0.5 }, { standing_scene: true }, { litter: 1 }, { canopy_fill: 0.5 }]) {
    const r = transitionRig({ ...faithfulFrom, ...both });
    r.hub.routes.leafTravel.begin = () => { throw Error("unexpected leaf travel"); };
    Object.assign(r.hub.routes.sceneFade, { begin: () => {}, step: () => {}, end: () => {} });
    r.transitionTo({ ...faithfulFrom, ...both, ...faithfulPairs[1] });
    expect(r.hub.trans.route?.name, JSON.stringify(both)).not.toBe('leafTravel');
    expect(r.hub.trans.route?.name, JSON.stringify(both)).toBe('sceneFade');
  }
  for (const differ of [{ eclipse: !faithfulFrom.eclipse }, { edge_area: !faithfulFrom.edge_area }]) {
    const r = transitionRig(faithfulFrom);
    r.hub.routes.leafTravel.begin = () => { throw Error("unexpected leaf travel"); };
    Object.assign(r.hub.routes.sceneFade, { begin: () => {}, step: () => {}, end: () => {} });
    r.transitionTo({ ...faithfulFrom, ...faithfulPairs[1], ...differ });
    expect(r.hub.trans.route?.name, JSON.stringify(differ)).not.toBe('leafTravel');
    expect(r.hub.trans.route?.name, JSON.stringify(differ)).toBe('sceneFade');
    expect(r.hub.trans.moon, JSON.stringify(differ)).toBe(null);   // each scene keeps its own source: no moon crosses inside a dissolve
  }
});

test("a faithful structural selection arriving during a scene dissolve continues the dissolve: two mixed pictures have no leaves to carry", () => {
  const r = transitionRig(faithfulFrom);
  let began = 0;
  r.hub.routes.leafTravel.begin = () => { throw Error("unexpected leaf travel"); };
  Object.assign(r.hub.routes.sceneFade, { begin: () => began++, step: () => {}, end: () => {} });
  r.transitionTo({ ...faithfulFrom, ...faithfulPairs[1], eclipse: true });
  for (let i = 0; i < 30; i++) r.tickTransition(1 / 60);
  r.transitionTo({ ...faithfulFrom, ...faithfulPairs[0], eclipse: true });
  expect(r.hub.trans.route?.name).toBe('sceneFade');
  expect(began).toBe(2);
});

test("faithful structural changes leaf travel refuses dissolve complete moving scenes without a midpoint rebuild or bloom", () => {
  for (const change of faithfulPairs) {
    const from = { ...faithfulFrom, branch_tau: 0.5 };
    const r = transitionRig(from), target = { ...from, ...change };
    let began = 0, steps = 0, ended = 0, callback = 0;
    r.hub.routes.sceneFade.begin = () => { began++; expect(r.params).toEqual(from); };
    r.hub.routes.sceneFade.step = () => { steps++; };
    r.hub.routes.sceneFade.end = () => { ended++; };
    r.transitionTo(target, { duration: 1, onEnd: () => callback++ });
    expect(r.hub.trans.route?.name).toBe('sceneFade');
    expect(began).toBe(1);
    expect(r.params).toEqual(target);
    expect(r.swaps).toHaveLength(1);
    let cb;
    for (let n = 0; r.hub.trans.active && n < 130; n++) {
      cb = r.tickTransition(1 / 60) || cb;
      expect(r.hub.trans.bloom).toBe(0);
      expect(r.swaps).toHaveLength(1);
    }
    expect(r.hub.trans.active).toBe(false);
    expect(steps).toBeGreaterThan(110);
    expect(ended).toBe(1);
    expect(callback).toBe(0);
    cb();
    expect(callback).toBe(1);
  }
});

test("ordinary faithful look morphs and other receiver changes keep their existing routes", () => {
  const from = { ...DEFAULTS, faithful_canopy: true };
  for (const change of [{ exposure: 2 }, { receiver: 1 }]) {
    const r = transitionRig(from);
    r.hub.routes.sceneFade.begin = () => { throw Error("unexpected scene dissolve"); };
    r.transitionTo({ ...from, ...change });
    expect(r.hub.trans.route?.name).not.toBe('sceneFade');
  }
});

test("a look-only edit interrupting a faithful scene dissolve starts another scene dissolve", () => {
  const r = transitionRig({ ...DEFAULTS, faithful_canopy: true, branch_tau: 0.5 });   // wood: leaf travel refuses the pair
  let began=0, ended=0;
  r.hub.routes.sceneFade.begin=()=>began++;
  r.hub.routes.sceneFade.step=()=>{};
  r.hub.routes.sceneFade.end=()=>ended++;
  r.transitionTo({ ...r.params, seed:1234567 });
  for(let i=0;i<30;i++) r.tickTransition(1/60);
  r.transitionTo({ ...r.params, exposure:2 });
  expect(r.hub.trans.route?.name).toBe('sceneFade');
  expect(began).toBe(2);
  expect(ended).toBe(0);
});

for (const [from, to] of [["afternoon 7", "park 1"], ["park 1", "afternoon 7"]]) {
  test(`${from} → ${to}: wood stays off the afternoon canopy and meets zero at the mode swap`, () => {
    const r = transitionRig(PRESETS[from]);
    r.transitionTo(PRESETS[to]);
    let sawFade = false, frames = 0;
    while (r.hub.trans.active && frames++ < 200) {
      r.tickTransition(1 / 60);
      if (!r.params.standing_scene) expect(r.params.branch_tau, `wood on afternoon at t=${r.hub.trans.t}`).toBe(0);
      else if (r.params.branch_tau > 0 && r.params.branch_tau < PRESETS["park 1"].branch_tau) sawFade = true;
    }
    expect(r.hub.trans.active).toBe(false);
    expect(sawFade, "park's wood fades rather than snapping").toBe(true);
    expect(r.swaps).toHaveLength(1);
    expect(r.swaps[0].branch_tau, "both paths meet without wood at the swap").toBeCloseTo(0, 12);
    expect(r.params).toEqual(PRESETS[to]);
  });
}

test("wood still tweens across the whole route when its scene mode stays the same", () => {
  for (const [a, b] of [[0, 2], [2, 0]]) {
    const from = { ...PRESETS["park 1"], branch_tau: a };
    const r = transitionRig(from);
    r.transitionTo({ ...from, branch_tau: b });
    for (let i = 0; i < 30; i++) r.tickTransition(1 / 60);
    expect(r.params.branch_tau).toBeCloseTo(1, 12);
    expect(r.swaps).toHaveLength(0);
  }
});

for (const mode of ["faithful_canopy", "sky_view"]) {
  test(`the ${mode} wood fade re-bakes in still air with an unchanged sun`, () => {
    const r = transitionRig(DEFAULTS);
    r.transitionTo({ ...DEFAULTS, [mode]: true, branch_tau: 2 });
    for (let i = 0; i < 90; i++) r.tickTransition(1 / 60);
    expect(r.params.branch_tau).toBeCloseTo(1, 12);
    expect(r.bakes.some((p) => p.branch_tau > 0 && p.branch_tau < 2), "intermediate wood opacity reaches the bake").toBe(true);
    expect(r.bakes.at(-1).branch_tau).toBe(r.params.branch_tau);
  });
}

test("a mode swap between two wood-bearing looks keeps their ordinary wood tween", () => {
  const from = { ...PRESETS["park 1"], branch_tau: 2 };
  const r = transitionRig(from);
  r.transitionTo({ ...from, faithful_canopy: false, branch_tau: 4 });
  for (let i = 0; i < 60; i++) r.tickTransition(1 / 60);
  expect(r.params.branch_tau).toBeCloseTo(3, 12);
});

test("interrupting the park fade starts from its live wood opacity and fades out before returning to afternoon", () => {
  const r = transitionRig(PRESETS["afternoon 7"]);
  r.transitionTo(PRESETS["park 1"]);
  for (let i = 0; i < 90; i++) r.tickTransition(1 / 60);
  const live = r.params.branch_tau;
  expect(live).toBeGreaterThan(0);
  expect(live).toBeLessThan(PRESETS["park 1"].branch_tau);
  r.transitionTo(PRESETS["afternoon 7"]);
  expect(r.params.branch_tau).toBe(live);
  let previous = live, frames = 0;
  while (r.hub.trans.active && frames++ < 200) {
    r.tickTransition(1 / 60);
    expect(r.params.branch_tau).toBeLessThanOrEqual(previous);
    if (!r.params.standing_scene) expect(r.params.branch_tau).toBe(0);
    previous = r.params.branch_tau;
  }
  expect(r.params).toEqual(PRESETS["afternoon 7"]);
});

for (const [from, to] of [["afternoon 7", "park 1"], ["park 1", "afternoon 7"]]) {
  test(`${from} → ${to}: shadows dissolve into the lit floor around the grove swap`, () => {
    const r = transitionRig(PRESETS[from]);
    r.transitionTo(PRESETS[to]);
    expect(r.hub.trans.shadowOpacity).toBe(1);
    // held and then steep into the swap, steep out of it: through zero without resting there, the bare floor on screen for a breath
    expect(litShadow(0.25), "the shadows still nearly whole a quarter in").toBeGreaterThan(0.98);
    expect(litShadow(0.45) + litShadow(0.55), "less than half of either side's shadows within a twentieth of the swap").toBeLessThan(1);
    for (const [t, opacity] of [0.25, 0.45, 0.5, 0.55, 0.75, 1].map((t) => [t, litShadow(t)])) {
      r.hub.trans.t = t;
      r.tickTransition(0);
      expect(r.hub.trans.shadowOpacity, `shadow opacity at t=${t}`).toBeCloseTo(opacity, 12);
      expect(r.hub.trans.exposureHold, `the exposure held down with the shadows gone, at t=${t}`).toBeCloseTo(held(opacity), 12);
      expect(r.hub.trans.bloom, "the floor fade does not add a cloud flash").toBe(0);
    }
    expect(r.hub.trans.active).toBe(false);
    expect(r.params).toEqual(PRESETS[to]);
  });
}

test("afternoon 6 → park 1, the scene: the seen tree comes in with its shadow, not after it", () => {
  const r = transitionRig(PRESETS["afternoon 6"]);
  r.transitionTo(PRESETS["park 1, the scene"]);
  expect(r.hub.trans.backgroundFade, "through the lit ground").toBe(true);
  expect(r.hub.trans.treeFade, "the tree fades in").toBe(true);
  for (const t of [0.25, 0.45, 0.5, 0.55, 0.6, 0.75]) {
    r.hub.trans.t = t;
    r.tickTransition(0);
    expect(r.hub.trans.treeOpacity, `tree at t=${t}`).toBeCloseTo(t < 0.5 ? 0 : r.hub.trans.shadowOpacity, 12);
  }
});

test("interrupting a floor fade preserves its visible shadow opacity", () => {
  const r = transitionRig(PRESETS["afternoon 7"]);
  r.transitionTo(PRESETS["park 1"]);
  r.hub.trans.t = 0.75;
  r.tickTransition(0);
  const opacity = r.hub.trans.shadowOpacity;
  expect(opacity).toBeCloseTo(litShadow(0.75), 12);
  r.transitionTo(PRESETS["afternoon 7"]);
  expect(r.hub.trans.shadowOpacity).toBe(opacity);
  r.tickTransition(1 / 60);
  expect(r.hub.trans.shadowOpacity).toBeLessThan(opacity);
});

test("park → afternoon: the incoming camera is settled before the grove rebuild and throughout the fade-in", () => {
  const r = transitionRig(PRESETS["park 1"]), target = PRESETS["afternoon 7"];
  const camera = ["view_extent_m", "view_pitch_deg", "view_fov_deg", "view_yaw_deg", "view_center_x", "view_center_y"];
  r.transitionTo(target);
  r.hub.trans.t = 0.25;
  r.tickTransition(0);
  expect(r.params.view_extent_m, "the outgoing half keeps its current movement").toBeGreaterThan(target.view_extent_m);
  for (const t of [0.5, 0.6, 0.75, 0.95, 1]) {
    r.hub.trans.t = t;
    r.tickTransition(0);
    for (const k of camera) expect(r.params[k], `${k} must be settled at t=${t}`).toBe(target[k]);
  }
  for (const k of camera) expect(r.swaps[0][k], `${k} must be final when the incoming grove is built`).toBe(target[k]);
});

test("afternoon → park keeps the existing camera tween", () => {
  const r = transitionRig(PRESETS["afternoon 7"]);
  r.transitionTo(PRESETS["park 1"]);
  r.hub.trans.t = 0.75;
  r.tickTransition(0);
  expect(r.params.view_extent_m).toBeGreaterThan(PRESETS["afternoon 7"].view_extent_m);
  expect(r.params.view_extent_m).toBeLessThan(PRESETS["park 1"].view_extent_m);
});

for (const reverse of [false, true]) {
  test(`window ${reverse ? "off" : "on"}: fade the aperture's influence with full-sized geometry`, () => {
    const on = PRESETS["curtain 1"], off = { ...on, window_w_m: 0, window_h_m: 0 };
    const r = transitionRig(reverse ? on : off);
    r.transitionTo(reverse ? off : on);
    for (const t of [0.01, 0.25, 0.5, 0.75]) {
      r.hub.trans.t = t;
      r.tickTransition(0);
      expect(r.params.window_w_m).toBe(on.window_w_m);
      expect(r.params.window_h_m).toBe(on.window_h_m);
      expect(r.hub.trans.windowOpacity).toBeGreaterThan(0);
      expect(r.hub.trans.windowOpacity).toBeLessThan(1);
    }
    r.hub.trans.t = 1;
    r.tickTransition(0);
    expect(r.params).toEqual(reverse ? off : on);
  });
}

for (const reverse of [false, true]) {
  test(`leaf_diffuse ${reverse ? "off" : "on"}: the proxy and measured glow meet at zero without a lighting jump`, () => {
    const proxy = PRESETS["canopy 1"], split = { ...proxy, leaf_diffuse: 0.5 };
    const r = transitionRig(reverse ? split : proxy);
    r.transitionTo(reverse ? proxy : split);
    r.hub.trans.t = 0.25;
    r.tickTransition(0);
    if (reverse) {
      expect(r.params.leaf_diffuse).toBeCloseTo(0.25, 12);
      expect(r.params.sky_scatter).toBe(0);
    } else {
      expect(r.params.leaf_diffuse).toBe(0);
      expect(r.params.sky_scatter).toBeCloseTo(proxy.sky_scatter / 2, 12);
    }
    r.hub.trans.t = 0.5;
    r.tickTransition(0);
    expect(r.params.leaf_diffuse).toBe(0);
    expect(r.params.sky_scatter).toBe(0);
    r.hub.trans.t = 0.75;
    r.tickTransition(0);
    if (reverse) {
      expect(r.params.leaf_diffuse).toBe(0);
      expect(r.params.sky_scatter).toBeCloseTo(proxy.sky_scatter / 2, 12);
    } else {
      expect(r.params.sky_scatter).toBe(0);
      expect(r.params.leaf_diffuse).toBeCloseTo(0.25, 12);
    }
  });
}

// ---- interruption starts from what is shown (spec contracts/transitions.md) ----
const tickTo = (r, t) => { while (r.hub.trans.t < t) r.tickTransition(1/60); };
const linked = from => { const r = transitionRig(from); r.hub.transitionTo = r.transitionTo; return r; };   // the engine's own wiring

test('an interrupted cloud dissolve carries its bloom into the next route and eases it out', () => {
  const from = { ...DEFAULTS }, r = transitionRig(from);
  r.transitionTo({ ...from, layer_count: 3, bake_resolution: from.bake_resolution/2 });   // a texture size the two groves cannot share: a dissolve
  expect(r.hub.trans.bloomMax).toBeGreaterThan(0);
  tickTo(r, 0.45);
  const shown = r.hub.trans.bloom;
  expect(shown).toBeGreaterThan(0.4);
  r.transitionTo(from);                               // back, before the swap: a live morph with no bloom of its own
  expect(r.hub.trans.bloom).toBe(shown);
  r.tickTransition(1/60);
  expect(Math.abs(r.hub.trans.bloom - shown)).toBeLessThan(0.02);
  tickTo(r, 0.5);
  expect(r.hub.trans.bloom).toBe(0);
});

test('an interrupted lit-ground fade carries its shadow opacity into a route that is not one', () => {
  const from = { ...DEFAULTS }, r = transitionRig(from);
  r.transitionTo({ ...from, standing_scene: true });
  expect(r.hub.trans.backgroundFade).toBe(true);
  tickTo(r, 0.49);
  const shown = r.hub.trans.shadowOpacity;
  expect(shown).toBeLessThan(0.2);
  r.transitionTo(from);
  expect(r.hub.trans.backgroundFade).toBe(false);
  r.tickTransition(1/60);
  expect(Math.abs(r.hub.trans.shadowOpacity - shown)).toBeLessThan(0.02);
  expect(Math.abs(r.hub.trans.exposureHold - held(shown)), "the held exposure comes back with the shadows, never in one frame").toBeLessThan(0.02);
  tickTo(r, 0.5);
  expect(r.hub.trans.shadowOpacity).toBe(1);
  expect(r.hub.trans.exposureHold).toBe(1);
});

test('a selection inside the crossfade window waits for the window to close, keeping the half-faded grove', () => {
  const from = { ...DEFAULTS }, r = linked(from), freed = [], installed = [];
  Object.assign(r.hub, { buildTargetGrove: to => ({ seed: to.seed }), freeGrove: g => freed.push(g), installGrove: g => installed.push(g) });
  const to = { ...from, seed: 77 }; let ended = 0;
  r.transitionTo(to, { onEnd: () => ended++ });
  expect(r.hub.trans.crossfade).toBe(true);
  tickTo(r, 0.5);
  expect(r.hub.crossW).toBeGreaterThan(0);
  const third = { ...from, exposure: from.exposure + 0.5 };
  r.transitionTo(from); r.transitionTo(third);        // the latest waiting selection replaces the earlier one
  expect(freed).toHaveLength(0); expect(r.hub.trans.to.seed).toBe(77); expect(r.hub.groveIn).not.toBeNull();
  let start = null;
  while (!start) start = r.tickTransition(1/60);
  expect(installed).toHaveLength(1); expect(r.params.seed).toBe(77);
  start();
  expect(r.hub.trans.to.exposure).toBe(third.exposure); expect(r.hub.trans.t).toBe(0);
  while (r.hub.trans.active) { const cb = r.tickTransition(1/60); if (cb) cb(); }
  expect(ended).toBe(0);                              // the superseded route's completion never fires
});

test('a selection the faithful dissolve cannot take waits for its landing instead of dropping the outgoing scene', () => {
  const from = { ...DEFAULTS, faithful_canopy: true, branch_tau: 0.5 }, r = linked(from); let ends = 0;   // wood: leaf travel refuses the pair
  Object.assign(r.hub.routes.sceneFade, { begin: () => {}, step: () => {}, end: () => ends++ });
  r.transitionTo({ ...from, seed: 77 });
  expect(r.hub.trans.route?.name).toBe('sceneFade');
  tickTo(r, 0.5);
  const layer = { ...DEFAULTS, standing_scene: true, exposure: 2 };   // not faithful: no dissolve can take it
  r.transitionTo(layer);
  expect(ends).toBe(0); expect(r.hub.trans.route?.name).toBe('sceneFade'); expect(r.hub.trans.waiting.to.exposure).toBe(2);
  let start = null;
  while (!start) start = r.tickTransition(1/60);
  expect(ends).toBe(1);
  start();
  expect(r.hub.trans.to.exposure).toBe(2);
});

test('a turn through the horizon finishes before a look it cannot reach starts, rather than teleporting the eye', () => {
  const A = { ...DEFAULTS, sky_view: true, standing_scene: true, canopy_base_height_m: 2, view_pitch_deg: 80, view_fov_deg: 64, view_extent_m: 3.1 };
  const B = { ...A, sky_view: false, view_pitch_deg: 16, view_fov_deg: 50, view_extent_m: 4.1 };
  const r = linked(A);
  r.transitionTo(B);
  expect(r.hub.trans.viewpoint).toBe(true);
  tickTo(r, 0.5);
  const eye = [...r.hub.trans.viewEye];
  r.transitionTo({ ...B, sun_elevation_deg: B.sun_elevation_deg - 20 });
  expect(r.hub.trans.viewpoint).toBe(true); expect(r.hub.trans.viewEye).toEqual(eye);
  let start = null;
  while (!start) start = r.tickTransition(1/60);
  expect(r.params.sky_view).toBe(false);
  start();
  expect(r.hub.trans.to.sun_elevation_deg).toBe(B.sun_elevation_deg - 20);
});

test('turnBack: momentum is spent, then the route eases home; the farther out, the longer the way back, up to a whole route', () => {
  const full = 4;
  for (const [p, v, to] of [[0.5, 0.25, 0], [0.1, 0.25, 0], [0.9, 0.25, 0], [0.97, 0.4, 0], [0.5, 0.375, 0], [0.6, -0.25, 1], [0.5, 0, 0]]) {
    const turn = turnBack(p, v, to, full), far = 1 - to;
    expect(turn.T).toBeCloseTo(full*Math.min(1, 0.5 + Math.abs(to - p)), 12);
    expect(turn.at(0)).toBeCloseTo(p, 12); expect(turn.rate(0)).toBeCloseTo(v, 12);
    expect(turn.at(1)).toBeCloseTo(to, 12); expect(turn.rate(1)).toBeCloseTo(0, 12);
    let previous = turn.at(0), turned = false, peak = p;
    for (let u = 1/512; u <= 1; u += 1/512) {
      const x = turn.at(u);
      expect(Math.abs(x - far)).toBeGreaterThan(0);                        // never reaches the far end
      expect(Math.abs(x - p)).toBeLessThanOrEqual(Math.abs(far - p)/2 + Math.abs(to - p) + 1e-12);
      if (Math.sign(x - previous) === Math.sign(to - p) && x !== previous) turned = true;
      else if (turned) expect(x).toBeCloseTo(previous, 12);               // once turned for home, it never heads out again
      if (Math.abs(x - to) > Math.abs(peak - to)) peak = x;
      previous = x;
    }
    if (v*Math.sign(to - p) < 0) expect(Math.abs(peak - p)).toBeGreaterThan(0);   // the momentum carried it past the press
  }
  const early = turnBack(0.1, 0.25, 0, full), mid = turnBack(0.5, 0.25, 0, full), late = turnBack(0.9, 0.25, 0, full);
  expect(early.T).toBeLessThan(mid.T); expect(mid.T).toBe(full); expect(late.T).toBe(full);
});

// ---- THE ECLIPSE PAIRS: the shared-layer crossfade across layer counts, and the moon crossing the eclipse gate ----
// The source and cast modules' pure moon and height functions, read through the namespace so a missing one fails its test rather than the file.
import * as SOURCE from "../engine/light/komorebi-source.js";
import * as CAST from "../engine/transport/komorebi-cast.js";
import * as GROVE from "../engine/canopy/komorebi-grove.js";

// The transition rig with the real sampler and layer heights wired in, the way the engine wires them.
function sourceRig(from, over = {}) {
  const r = transitionRig(from), sized = [], built = [];
  Object.assign(r.hub, { perf: { auto: false }, src: {}, crossW: 0, sized, built,
    buildTargetGrove: (to) => { const g = { to }; built.push(g); return g; }, installGrove: () => {}, freeGrove: () => {},
    sizeLayers: (n) => sized.push(n),
    effCloud: () => clamp(lerp(r.params.cloud_thickness, 1, r.hub.trans.bloom), 0, 1), ...over });
  r.hub.trans.bloom = 0;
  Object.assign(r.hub, makeSource(r.hub), makeCast(r.hub));
  r.hub.transitionTo = r.transitionTo;
  return r;
}
// The share of the source's weight the moon covers, from the sampler's own weights against the same source with no eclipse.
const weights = (src) => Array.from({ length: src.count }, (_, i) => src.flat[i*3+2]);
const native = (p) => { const r = sourceRig(p); r.hub.regenSource(); return { src: { ...r.hub.src, flat: r.hub.src.flat.slice() }, heights: Array.from(r.hub.layerHeights()) }; };
const look = (p) => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, p[k]]));   // the params a look has, whatever else an object carries
const settle = (r) => { let frames = 0, cb; while (r.hub.trans.active && frames++ < 400) cb = r.tickTransition(1/60) || cb; return cb; };

test("a live morph reuses the source until its inputs change, including when the inset buffer is replaced", () => {
  const uploads = [], originalBuffer = {}, restoredBuffer = {};
  const gl = { bindBuffer: (_target, buffer) => uploads.push(buffer), bufferData() {} };
  const r = sourceRig(DEFAULTS, { gl, srcDbgBuf: originalBuffer });
  r.hub.regenSource();
  const first = r.hub.src.flat;
  r.transitionTo({ ...DEFAULTS, exposure: 2 }, { duration: 1 });
  for (let i = 0; i < 10; i++) r.tickTransition(1/60);
  expect(r.hub.src.flat).toBe(first);
  expect(uploads).toEqual([originalBuffer]);

  r.hub.srcDbgBuf = restoredBuffer;
  r.hub.regenSource();
  expect(r.hub.src.flat).toBe(first);
  expect(uploads).toEqual([originalBuffer, restoredBuffer]);

  r.params.cloud_thickness = 1;
  r.hub.regenSource();
  expect(r.hub.src.flat).not.toBe(first);
  expect(uploads).toEqual([originalBuffer, restoredBuffer, restoredBuffer]);
});

test("a three-sample source keeps the halo's share through full cloud", () => {
  for (const cloud_thickness of [0.3, 1]) {
    const p = { ...DEFAULTS, sample_count: 3, cloud_thickness, core_weight_fraction: 0.88, eclipse: false };
    const w = weights(native(p).src);
    expect(w).toHaveLength(3);
    expect(w.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(w[2]).toBeCloseTo(1 - p.core_weight_fraction * (1 - cloud_thickness), 6);
  }
});

test("layer transport packs the contributing rays without moving or renormalizing the full source", () => {
  const { flat, count, beam } = native(PRESETS.eclipse).src;
  expect(count).toBe(48);
  expect(beam).toHaveLength(33);
  expect(Array.from(beam)).toEqual(Array.from(flat).filter((_, i) => flat[i-i%3+2] !== 0));
  expect(native({ ...PRESETS.eclipse, eclipse_amount: 1.3 }).src.beam).toHaveLength(0);
  const clear = native(PRESETS["morning 3b"]).src;
  expect(clear.beam).toEqual(clear.flat);
});

for (const [a, b] of [["morning 3b", "eclipse"], ["eclipse", "acid dreams"]]) {
  test(`${a} → ${b}: the shared-layer crossfade across layer counts, with no bloom`, () => {
    const A = PRESETS[a], B = PRESETS[b], r = sourceRig(A);
    expect(A.layer_count).not.toBe(B.layer_count);
    r.transitionTo(B, { duration: 1 });
    expect(r.hub.trans.crossfade).toBe(true);
    expect(r.hub.trans.bloomMax).toBe(0);
    expect(r.hub.built.map((g) => g.to)).toEqual([B]);                  // the incoming grove is grown from the target look itself
    const n = Math.max(A.layer_count, B.layer_count);
    expect(r.params.layer_count, "the route runs at the larger count").toBe(n);
    expect(r.hub.sized).toEqual([n]);
    expect(r.params.eclipse, "the eclipse is held on for the whole route").toBe(true);
    let frames = 0;
    while (r.hub.trans.active && frames++ < 400) {
      r.tickTransition(1/60);
      expect(r.hub.trans.bloom).toBe(0);
      if (r.hub.trans.active) { expect(r.params.layer_count).toBe(n); expect(r.params.eclipse).toBe(true); }
    }
    expect(r.swaps).toHaveLength(0);
    expect(look(r.params)).toEqual(look(B));                             // the authored layer count and eclipse, restored at landing
    expect(r.hub.sized.at(-1), "the layer textures come back to the target's count").toBe(B.layer_count);
  });

  test(`${a} → ${b}: each layer's height runs from the outgoing look's own to the incoming look's own`, () => {
    const A = PRESETS[a], B = PRESETS[b], r = sourceRig(A), hA = native(A).heights, hB = native(B).heights;
    r.transitionTo(B, { duration: 1 });
    const h0 = Array.from(r.hub.layerHeights());
    for (let i = 0; i < A.layer_count; i++) expect(h0[i], `layer ${i} at the start`).toBe(hA[i]);
    let previous = h0;
    while (r.hub.trans.active) {
      r.tickTransition(1/60);
      const h = Array.from(r.hub.layerHeights());
      for (let i = 0; i < r.params.layer_count; i++) expect(Math.abs(h[i] - previous[i]), `layer ${i} moves smoothly`).toBeLessThan(0.1);
      previous = h;
    }
    const h1 = Array.from(r.hub.layerHeights());
    for (let i = 0; i < B.layer_count; i++) expect(h1[i], `layer ${i} at landing`).toBe(hB[i]);
  });
}

test("the route's layer heights: each end exactly, and for equal counts the heights a tween of base and thickness gives", () => {
  expect(typeof CAST.routeHeights).toBe("function");
  for (const n of [1, 2, 3, 4]) {
    const h = CAST.routeHeights(n, 4.2, 2.6), lh = native({ ...DEFAULTS, layer_count: n, canopy_base_height_m: 4.2, canopy_thickness_m: 2.6 }).heights;
    for (let i = 0; i < n; i++) expect(Math.fround(h[i])).toBe(lh[i]);
    for (let i = n; i < 4; i++) expect(h[i], "padded with the top layer").toBe(h[n - 1]);
  }
  const a = CAST.routeHeights(3, 4.2, 2.6), b = CAST.routeHeights(3, 4.9, 2.5);
  for (const e of [0.25, 0.5, 0.75]) for (let i = 0; i < 3; i++)
    expect(lerp(a[i], b[i], e)).toBeCloseTo(CAST.routeHeights(3, lerp(4.2, 4.9, e), lerp(2.6, 2.5, e))[i], 12);
});

test("equal layer counts keep today's heights through a crossfade", () => {
  const r = sourceRig(PRESETS["morning 1"]);
  r.transitionTo(PRESETS.memories, { duration: 1 });
  expect(r.hub.trans.crossfade).toBe(true);
  expect(r.hub.trans.layerRoute ?? null).toBe(null);
  expect(r.hub.sized).toEqual([]);
});

test("the crossfade still refuses what the two groves cannot share", () => {
  const A = PRESETS["morning 3b"];
  for (const over of [{ tex_resolution: A.tex_resolution, bake_resolution: 0 }, { bake_resolution: A.bake_resolution/2 }, { branch_tau: 0.5 }]) {
    const r = sourceRig(A); r.transitionTo({ ...PRESETS.eclipse, ...over });
    expect(r.hub.trans.crossfade, JSON.stringify(over)).toBe(false);
    expect(r.hub.trans.bloomMax).toBeGreaterThan(0);
  }
});

test("the moon's path: the authored bite at one end, clear of every sample at the other, monotone between", () => {
  expect(typeof SOURCE.moonDistance).toBe("function");
  for (const [coreDeg, haloDeg, cloud, N] of [[0.3, 1, 0, 48], [0.27, 4, 0.4, 32], [0.3, 1, 0, 3], [0.5, 0.5, 0, 5]]) {
    const coreR = coreDeg*DEG, haloR = lerp(coreR*2, haloDeg*DEG, cloud), nCore = Math.max(3, Math.round(N*0.5)), nHalo = Math.max(0, N - nCore);
    const [dCore, dHalo] = SOURCE.moonSpacing(coreR, haloR, nCore, nHalo);
    const clear = SOURCE.moonClear(coreR, haloR, dCore, dHalo);
    for (const v of [dCore, dHalo, clear]) expect(Number.isFinite(v) && v > 0).toBe(true);
    for (const amount of [0.6, 0.55, 0, -1]) {
      expect(SOURCE.moonDistance(0, amount, clear), "the bite is the settled look's expression").toBe(1.3 - amount);
      let previous = -Infinity;
      for (let x = 0; x <= 1.0000001; x += 0.01) { const m = SOURCE.moonDistance(x, amount, clear); expect(m).toBeGreaterThanOrEqual(previous); previous = m; }
      if (1.3 - amount < 2) expect(Math.abs(SOURCE.moonX(SOURCE.moonDistance(0.37, amount, clear), amount, clear) - 0.37)).toBeLessThan(1e-9);
    }
  }
});

test("the moon's limb: a band of zero is today's hard rule, and a band is continuous across the limb", () => {
  expect(typeof SOURCE.moonCover).toBe("function");
  for (const d of [0, 0.5, 0.999, 1, 1.001, 3]) expect(SOURCE.moonCover(d, 1, 0)).toBe(d < 1 ? 0 : 1);
  expect(SOURCE.moonCover(1, 1, 0.2)).toBe(0.5);
  expect(SOURCE.moonCover(0.85, 1, 0.2)).toBe(0);
  expect(SOURCE.moonCover(1.15, 1, 0.2)).toBe(1);
});

test("entering the eclipse: the source starts with no sample covered, lands on the settled crescent, and never jumps", () => {
  const A = PRESETS["morning 3b"], B = PRESETS.eclipse, r = sourceRig(A), clearA = weights(native(A).src), settled = weights(native(B).src);
  r.transitionTo(B, { duration: 5 });
  r.hub.regenSource();
  expect(weights(r.hub.src), "zero time: the outgoing look's own weights").toEqual(clearA);
  let previous = weights(r.hub.src), biggest = 0, moon = [];
  while (r.hub.trans.active) {
    r.tickTransition(1/60);
    const w = weights(r.hub.src);
    if (w.length === previous.length) biggest = Math.max(biggest, ...w.map((v, i) => Math.abs(v - previous[i])));
    moon.push(r.hub.src.moonD/r.hub.src.coreR);
    previous = w;
  }
  expect(weights(r.hub.src), "landed on the settled eclipse's own weights").toEqual(settled);
  for (let i = 1; i < moon.length - 1; i++) expect(moon[i], "the moon only moves inward").toBeLessThanOrEqual(moon[i - 1] + 1e-12);
  expect(biggest/Math.max(...settled), "no sample's weight jumps: a frame moves under a quarter of a sample").toBeLessThan(0.25);
  const bite = moon.filter((m) => m < 2).length;
  expect(bite/moon.length, "most of the time on the visible bite").toBeGreaterThan(0.6);
});

test("leaving the eclipse: the moon slides off and the authored values come back at landing", () => {
  const A = PRESETS.eclipse, B = PRESETS["acid dreams"], r = sourceRig(A), bitten = weights(native(A).src), clearB = weights(native(B).src);
  r.transitionTo(B, { duration: 1 });
  r.hub.regenSource();
  expect(weights(r.hub.src), "zero time: the settled crescent").toEqual(bitten);
  settle(r);
  expect(look(r.params)).toEqual(look(B));
  expect(weights(r.hub.src)).toEqual(clearB);
});

test("a source with no halo samples, no cloud and the fewest samples keeps the moon's path defined", () => {
  const A = { ...PRESETS.eclipse, sample_count: 3, cloud_thickness: 0, halo_angular_radius_deg: 0 }, r = sourceRig({ ...A, eclipse: false });
  r.transitionTo(A, { duration: 1 });
  while (r.hub.trans.active) { r.tickTransition(1/60); for (const v of r.hub.src.flat) expect(Number.isFinite(v)).toBe(true); expect(Number.isFinite(r.hub.src.moonD)).toBe(true); }
});

test("a cloud dissolve across the eclipse gate moves the moon under the bloom too", () => {
  const A = { ...PRESETS["morning 3b"], branch_tau: 0.5 }, B = { ...PRESETS.eclipse, branch_tau: 0.5 }, r = sourceRig(A);
  r.transitionTo(B, { duration: 1 });
  expect(r.hub.trans.crossfade).toBe(false);
  expect(r.hub.trans.bloomMax).toBeGreaterThan(0);
  let moved = 0, previous = null;
  while (r.hub.trans.active) {
    r.tickTransition(1/60);
    if (r.hub.trans.active) expect(r.params.eclipse).toBe(true);
    const m = r.hub.src.moonD/r.hub.src.coreR;
    if (previous !== null && m !== previous) moved++;
    previous = m;
  }
  expect(r.swaps).toHaveLength(1);
  expect(r.swaps[0].eclipse, "held through the midpoint swap").toBe(true);
  expect(moved).toBeGreaterThan(50);
  expect(look(r.params)).toEqual(look(B));
});

test("an interrupted eclipse route starts the next from the moon, limb and layer heights it shows", () => {
  for (const back of [0.2, 0.8]) {
    const A = PRESETS["morning 3b"], B = PRESETS.eclipse, r = sourceRig(A);
    r.transitionTo(B, { duration: 1 });
    tickTo(r, back);
    if (r.hub.trans.crossfade && r.hub.crossW > 0 && r.hub.crossW < 1) continue;   // inside the window a selection waits (held below)
    r.hub.regenSource();
    const shown = { m: r.hub.src.moonD/r.hub.src.coreR, w: weights(r.hub.src), h: Array.from(r.hub.layerHeights()) };
    r.transitionTo(A, { duration: 1 });
    r.hub.regenSource();
    expect(Math.abs(r.hub.src.moonD/r.hub.src.coreR - shown.m), `the moon stays where it was at t=${back}`).toBeLessThan(1e-9);
    expect(weights(r.hub.src).map((v, i) => Math.abs(v - shown.w[i])).reduce((a, b) => Math.max(a, b), 0), "and the limb with it").toBeLessThan(1e-6);
    expect(Array.from(r.hub.layerHeights()), "the layers stay where they were").toEqual(shown.h);
    r.tickTransition(1/60);
    expect(Math.abs(r.hub.src.moonD/r.hub.src.coreR - shown.m)).toBeLessThan(0.05);
    settle(r);
    expect(look(r.params)).toEqual(look(A));
    expect(r.hub.sized.at(-1)).toBe(A.layer_count);
    expect(weights(r.hub.src)).toEqual(weights(native(A).src));
  }
});

test("a selection inside the eclipse crossfade's window waits, and the moon keeps moving", () => {
  const A = PRESETS["morning 3b"], B = PRESETS.eclipse, r = sourceRig(A);
  r.transitionTo(B, { duration: 1 });
  let frames = 0;
  while (!(r.hub.crossW > 0) && r.hub.trans.active && frames++ < 400) r.tickTransition(1/60);
  expect(r.hub.trans.crossfade && r.hub.crossW > 0, "inside the crossfade window").toBe(true);
  r.hub.crossW = 0.5;
  r.transitionTo(PRESETS["acid dreams"], { duration: 1 });
  expect(r.hub.trans.waiting?.to?.layer_count).toBe(PRESETS["acid dreams"].layer_count);
  const m = r.hub.src.moonD;
  r.tickTransition(1/60);
  expect(r.hub.src.moonD).not.toBe(m);
});

test("the grove grown for a route is grown from the target's value of every key the grove reads", () => {
  expect(typeof GROVE.growAs).toBe("function");
  const params = { ...PRESETS["morning 3b"] }, look = PRESETS.eclipse, seen = {};
  GROVE.growAs(params, look, () => Object.assign(seen, params));
  for (const k of [...GROVE.GROVE_READS, "trans_r", "phenology"]) expect(seen[k], k).toBe(look[k]);
  expect(params).toEqual(PRESETS["morning 3b"]);
});

// A grove too big to morph between two looks of one branching (the void's 16 trees against morning 3b's 5) shares the layer bake
// as a topology change does, so it crossfades rather than dissolving under a cloud.
const LEAVES = { "morning 3b": 32000, "the void": 103000 };
function crossRig(from, leaves) {
  const r = transitionRig(from), target = {}, installed = [];
  r.hub.layerVAO = [{ count: leaves }];
  Object.assign(r.hub, { buildTargetGrove: () => target, installGrove: (g) => installed.push(g), freeGrove: () => {}, sizeLayers: () => {} });
  return { ...r, target, installed };
}
for (const [from, to] of [["morning 3b", "the void"], ["the void", "morning 3b"]]) {
  test(`${from} → ${to}: a same-branching grove too big to morph crossfades`, () => {
    const r = crossRig(PRESETS[from], LEAVES[from]);
    r.transitionTo(PRESETS[to], { duration: 1 });
    expect(r.hub.trans.crossfade).toBe(true);
    expect(r.hub.trans.canopyMorph).toBe(false);
    expect(r.hub.trans.bloomMax).toBe(0);
    expect(r.hub.trans.durScale).toBe(2);
    expect(r.hub.groveIn).toBe(r.target);
    for (let n = 0; r.hub.trans.active && n < 200; n++) { r.tickTransition(1 / 60); expect(r.hub.trans.bloom).toBe(0); }
    expect(r.installed).toEqual([r.target]);
    expect(r.swaps).toHaveLength(0);
    expect(r.params).toEqual(PRESETS[to]);
  });
}

test("a same-branching grove within the morph budget still grove-morphs; wood or a faithful end keeps the old route", () => {
  const small = crossRig(PRESETS["morning 3b"], 1000);
  small.transitionTo(PRESETS["the void"]);
  expect(small.hub.trans.canopyMorph).toBe(true);
  expect(small.hub.trans.crossfade).toBe(false);
  const wood = crossRig({ ...PRESETS["morning 3b"], branch_tau: 0.5 }, LEAVES["morning 3b"]);
  wood.transitionTo({ ...PRESETS["the void"], branch_tau: 0.5 });
  expect(wood.hub.trans.crossfade).toBe(false);
  expect(wood.hub.trans.bloomMax).toBeGreaterThan(0);
  const faithful = crossRig({ ...PRESETS["morning 3b"], faithful_canopy: true, branch_tau: 0.5 }, LEAVES["morning 3b"]);
  faithful.hub.routes.sceneFade.begin = faithful.hub.routes.sceneFade.step = faithful.hub.routes.sceneFade.end = () => {};
  faithful.transitionTo({ ...PRESETS["the void"], faithful_canopy: true, branch_tau: 0.5 });
  expect(faithful.hub.trans.crossfade).toBe(false);
  expect(faithful.hub.trans.route?.name).toBe('sceneFade');
});

// style 'fade': a driver asks for the dissolve of two moving scenes, whatever the pair's modes or cameras.
function fadeRig(from) {
  const r = crossRig(from, 1000), log = { began: 0, ended: 0, steps: 0 };
  r.hub.routes.sceneFade.begin = () => { log.began++; expect(r.params).toEqual(from); };
  r.hub.routes.sceneFade.step = () => { log.steps++; };
  r.hub.routes.sceneFade.end = () => { log.ended++; };
  for (const k of ["groveTravel", "litterRise", "seasonTravel", "leafTravel"]) r.hub.routes[k].begin = () => { throw Error(`unexpected ${k}`); };
  return { ...r, log };
}
const fadePairs = {
  "layer ↔ layer topology": [PRESETS["morning 1"], PRESETS.memories],
  "floor ↔ sky": [PRESETS.memories, { ...PRESETS.memories, sky_view: true }],
  "faithful ↔ layer": [PRESETS["afternoon 7"], PRESETS["park 1"]],
  "standing carpet": [PRESETS["park fall"], PRESETS["the yellow tree"]],
};
for (const [name, [a, b]] of Object.entries(fadePairs)) for (const [from, to] of [[a, b], [b, a]]) {
  test(`style 'fade' (${name}${from === a ? "" : ", reversed"}) dissolves two moving scenes and lands on the target`, () => {
    const r = fadeRig(from);
    let arrived = 0, cb;
    r.transitionTo(to, { duration: 1, style: "fade", onEnd: () => arrived++ });
    expect(r.hub.trans.route?.name).toBe('sceneFade');
    expect(r.hub.trans.crossfade || r.hub.trans.backgroundFade || r.hub.trans.viewpoint).toBe(false);
    expect(r.hub.trans.bloomMax).toBe(0);
    expect(r.hub.trans.durScale).toBe(2);
    expect(r.hub.groveIn).toBe(null);
    expect(r.log.began).toBe(1);
    expect(r.params).toEqual({ ...DEFAULTS, ...to });
    for (let n = 0; r.hub.trans.active && n < 200; n++) { cb = r.tickTransition(1 / 60) || cb; expect(r.hub.trans.bloom).toBe(0); }
    expect(r.hub.trans.active).toBe(false);
    expect(r.log.ended).toBe(1);
    expect(r.params).toEqual({ ...DEFAULTS, ...to });
    cb(); expect(arrived).toBe(1);
  });
}

test("style 'fade' on a pair that differs only in MORPH keys takes the plain live morph", () => {
  const r = fadeRig({ ...DEFAULTS });
  r.hub.routes.sceneFade.begin = () => { throw Error("unexpected scene dissolve"); };
  r.transitionTo({ ...DEFAULTS, exposure: 2, sun_elevation_deg: 30 }, { style: "fade" });
  expect(r.hub.trans.route?.name).not.toBe('sceneFade');
  expect(r.hub.trans.structDiff).toBe(false);
});

for (const change of [{ exposure: 2 }, { foliage_density: 1.5 }]) {
  test(`a fade requested during ${'exposure' in change ? 'a live' : 'a grove'} morph waits and keeps its style`, () => {
    const r = fadeRig({ ...DEFAULTS });
    r.hub.transitionTo = r.transitionTo;
    r.hub.routes.sceneFade.begin = () => { r.log.began++; };
    let cancelled = 0, arrived = 0;
    r.transitionTo({ ...DEFAULTS, ...change }, { duration: 0.1, onEnd: () => cancelled++ });
    r.tickTransition(1 / 60);
    const shown = { ...r.params }, target = { ...DEFAULTS, foliage_density: 1.8 };
    r.transitionTo(target, { duration: 0.1, style: 'fade', onEnd: () => arrived++ });
    expect(r.params).toEqual(shown);
    expect(r.hub.trans.waiting?.opts.style).toBe('fade');
    for (let n = 0; r.hub.trans.active && n < 100; n++) r.tickTransition(1 / 60)?.();
    expect(r.log.began).toBe(1);
    expect(r.params).toEqual(target);
    expect(cancelled).toBe(0);
    expect(arrived).toBe(1);
  });
}

for (const route of ['leafTravel', 'seasonTravel', 'litterRise', 'groveTravel']) {
  test(`a requested fade waits for ${route} and the latest later selection supersedes it`, () => {
    const r = fadeRig({ ...DEFAULTS });
    r.hub.transitionTo = r.transitionTo;
    r.hub.routes.sceneFade.begin = () => { r.log.began++; };
    r.transitionTo({ ...DEFAULTS, foliage_density: 1.5 }, { duration: 0.1 });
    r.hub.trans.route = r.hub.routes[route];
    Object.assign(r.hub.routes[route], { step: () => {}, finish: () => { Object.assign(r.params, r.hub.trans.to); return null; }, end: () => {},
      retarget: () => { throw Error('a requested fade must wait'); } });
    let first = 0, latest = 0;
    r.transitionTo({ ...DEFAULTS, foliage_density: 1.8 }, { duration: 0.1, style: 'fade', onEnd: () => first++ });
    r.transitionTo({ ...DEFAULTS }, { duration: 0.1, style: 'fade', onEnd: () => latest++ });
    for (let n = 0; r.hub.trans.active && n < 100; n++) r.tickTransition(1 / 60)?.();
    expect(r.log.began).toBe(1);
    expect(r.params.foliage_density).toBe(DEFAULTS.foliage_density);
    expect(first).toBe(0);
    expect(latest).toBe(1);
  });
}

test("absent or 'morph' style keeps the automatic routes for the same pairs", () => {
  for (const style of [undefined, "morph"]) {
    const cross = crossRig(PRESETS["morning 1"], 1000);
    cross.transitionTo(PRESETS.memories, { style });
    expect(cross.hub.trans.crossfade).toBe(true);
    const sky = crossRig(PRESETS.memories, 1000);
    sky.transitionTo({ ...PRESETS.memories, sky_view: true }, { style });
    expect((sky.hub.trans.route?.name === 'sceneFade') || sky.hub.trans.crossfade).toBe(false);
    expect(sky.hub.trans.bloomMax).toBeGreaterThan(0);
    const floor = crossRig(PRESETS["afternoon 7"], 1000);
    floor.transitionTo(PRESETS["park 1"], { style });
    expect(floor.hub.trans.backgroundFade).toBe(true);
    expect(floor.hub.trans.route?.name).not.toBe('sceneFade');
  }
});

// Carpeted floor-to-floor mode changes: the litter carpet stays visible through the lit-ground fade's midpoint, where the grove and
// camera swap would show as a cut, so these pairs dissolve two moving scenes instead.
for (const [from, to] of [["park fall", "forest floor"], ["forest floor", "park fall"], ["forest floor", "the yellow tree"], ["the yellow tree", "forest floor"]]) {
  test(`${from} → ${to}: a carpeted floor-to-floor mode change dissolves two moving scenes`, () => {
    const r = fadeRig(PRESETS[from]);
    r.transitionTo(PRESETS[to], { duration: 1 });
    expect(r.hub.trans.route?.name).toBe('sceneFade');
    expect(r.hub.trans.backgroundFade).toBe(false);
    expect(r.hub.trans.bloomMax).toBe(0);
    for (let n = 0; r.hub.trans.active && n < 200; n++) { r.tickTransition(1 / 60); expect(r.hub.trans.bloom).toBe(0); }
    expect(r.params).toEqual(PRESETS[to]);
  });
}

for (const [from, to] of [["forest floor", "afternoon 7"], ["afternoon 7", "forest floor"]]) {
  test(`${from} → ${to}: the litter carpet dissolves with the canopy`, () => {
    const r = fadeRig(PRESETS[from]);
    r.transitionTo(PRESETS[to], { duration: 1, style: 'morph' });
    expect(r.hub.trans.route?.name).toBe('sceneFade');
    expect(r.hub.trans.crossfade).toBe(false);
    expect(r.hub.groveIn).toBe(null);
    expect(r.hub.trans.durScale).toBe(2);
    for (let n = 0; r.hub.trans.active && n < 200; n++) r.tickTransition(1 / 60);
    expect(r.log.ended).toBe(1);
    expect(r.params).toEqual(PRESETS[to]);
  });
}

test("montebello ↔ park fall keeps season travel over the carpeted scene dissolve", () => {
  for (const [from, to] of [["montebello", "park fall"], ["park fall", "montebello"]]) {
    const r = fadeRig(PRESETS[from]); let began = 0;
    r.hub.routes.seasonTravel.begin = () => { began++; };
    r.hub.routes.sceneFade.begin = () => { throw Error("unexpected scene dissolve"); };
    r.transitionTo(PRESETS[to]);
    expect(r.hub.trans.route?.name).toBe('seasonTravel');
    expect(began).toBe(1);
  }
});

// THE REGISTRY (komorebi-routes.js): what the lifecycle holds for every long route, whichever it is.
const groveFloor = { ...DEFAULTS, ...riseFixture.from, edge_area: PRESETS["park 2"].edge_area ?? false, inner_leaves: 0.35 };   // fall memoriez, as grove-travel.test.js holds it
const runOut = (r) => { for (let n = 0; r.hub.trans.active && n < 1000; n++) r.tickTransition(1 / 60)?.(); };   // to landing, completions called
const carriedGrove = (r, log) => Object.assign(r.hub.routes.groveTravel,
  { begin: () => true, step() {}, finish: () => null, end: () => { log.ended++; return log.pending; }, retarget() {} });

test("a route started from idle starts from rest: the window fade a landed route left is not read by the grove travel that follows", () => {
  const r = transitionRig({ ...groveFloor, window_w_m: 1, window_h_m: 1 }), log = { ended: 0 };
  r.transitionTo(groveFloor, { duration: 0.1 });
  expect(r.hub.trans.windowFade).toBe(true);
  runOut(r);
  carriedGrove(r, log);
  r.transitionTo(PRESETS["park 2"], { duration: 2 });
  const t = r.hub.trans, rest = restTrans();
  expect(t.route?.name).toBe("groveTravel");
  expect(t.active && t.windowFade ? t.windowOpacity : 1, "the window opacity the render reads").toBe(1);
  const own = ["from", "to", "t", "dur", "durScale", "active", "route", "structDiff", "bloomMax", "onEnd"];   // what the start itself writes
  for (const k of Object.keys(rest)) if (!own.includes(k)) expect(t[k], k).toEqual(rest[k]);
  expect(Object.keys(t).sort(), "no field outside the rest state").toEqual(Object.keys(rest).sort());
});

test("an abort ends the running route, frees a half-faded grove and leaves the state at rest", () => {
  const r = transitionRig(groveFloor), log = { ended: 0 };
  carriedGrove(r, log);
  r.transitionTo(PRESETS["park 2"], { duration: 2, onEnd: () => { throw Error("an aborted route completes nothing"); } });
  r.tickTransition(1 / 60); r.tickTransition(1 / 60);
  let freed = 0; r.hub.groveIn = {}; r.hub.freeGrove = () => freed++; r.hub.crossW = 0.5;
  r.abortTransition();
  expect(log.ended).toBe(1);
  expect([freed, r.hub.groveIn, r.hub.crossW]).toEqual([1, null, 0]);
  expect(r.hub.trans).toEqual({ ...restTrans(), dur: 2 });
});

for (const waiting of [false, true]) {
  test(`a lost context ends every route and keeps ${waiting ? "a waiting selection over the route's pending one" : "the route's pending selection"}; the restore lands on it at rest`, () => {
    const r = transitionRig(groveFloor), log = { ended: 0 }, ends = {}, arrived = [];
    let owedDone = 0, waitDone = 0;
    const owed = { to: { ...DEFAULTS, ...PRESETS["park 2"], exposure: 3 }, opts: { onEnd: () => owedDone++ } }, later = { ...groveFloor, exposure: 2 };
    log.pending = owed;
    r.hub.arrived = to => arrived.push(to);
    for (const [name, route] of Object.entries(r.hub.routes)) if (name !== "groveTravel") route.end = () => { ends[name] = (ends[name] ?? 0) + 1; };
    carriedGrove(r, log);
    r.transitionTo(PRESETS["park 2"], { duration: 2 });
    r.tickTransition(1 / 60);
    if (waiting) r.transitionTo(later, { style: "fade", onEnd: () => waitDone++ });
    r.loseContext();
    const want = waiting ? { ...DEFAULTS, ...later } : owed.to;
    expect(r.hub.trans.route, "no route runs").toBe(null);
    expect(r.hub.trans.active, "a landing is owed").toBe(true);
    expect([log.ended, ends]).toEqual([1, { sceneFade: 1, leafTravel: 1, seasonTravel: 1, litterRise: 1 }]);
    expect(r.hub.trans.to).toEqual(want);
    const cb = r.restoreContext();
    expect(r.hub.trans).toEqual({ ...restTrans(), dur: 2 });
    expect(r.params).toEqual(want);
    expect(arrived).toEqual([want]);
    cb();
    expect([owedDone, waitDone]).toEqual(waiting ? [0, 1] : [1, 0]);
  });
}

test("a route whose step gives up lands as a scene fade to the same target, keeping the caller's clock and completion", () => {
  const from = { ...DEFAULTS, faithful_canopy: true, branch_tau: 0, canopy_fill: 0, litter: 0, leaf_drop: 0, inner_leaves: 0 };
  const to = { ...from, seed: from.seed + 1 }, r = transitionRig(from), log = { leaf: 0, fade: 0 };
  r.hub.transitionTo = r.transitionTo;
  Object.assign(r.hub.routes.leafTravel, { begin() {}, step() { Object.assign(r.params, from); return false; }, finish: () => null, end: () => { log.leaf++; } });
  Object.assign(r.hub.routes.sceneFade, { begin: () => { log.fade++; }, step() {}, end() {} });
  let arrived = 0;
  r.transitionTo(to, { duration: 0.4, onEnd: () => arrived++ });
  expect(r.hub.trans.route?.name).toBe("leafTravel");
  const target = r.hub.trans.to;
  r.tickTransition(1 / 60);
  expect(r.hub.trans.route?.name).toBe("sceneFade");
  expect([r.hub.trans.to, r.hub.trans.dur, r.hub.trans.t]).toEqual([target, 0.4, 0]);
  expect(log).toEqual({ leaf: 1, fade: 1 });
  runOut(r);
  expect(arrived).toBe(1);
  expect(r.params.seed).toBe(to.seed);
});

// The live morph's exposure follows the receivers the two looks stand on: between two looks of one camera the dapples travel straight from one
// end's level to the other's (beamExposure, with that camera's incidence), between two cameras it is the plain lerp unless the route lands on the floor, where it is the floor's blend.
// The camera is read off the look on screen when the route starts, whatever the route holds back.
const midRoute = (from, to) => {
  const r = transitionRig(from);
  r.transitionTo(to, { duration: 4 / 15 });
  expect(r.hub.trans.route, JSON.stringify([cameraFor(from), cameraFor(to)])).toBeNull();   // the live morph, not a long route
  while (r.hub.trans.t < 0.5) r.tickTransition(1 / 60);   // a camera change runs a longer clock; the midpoint is on t
  const e = smoothstep(0, 1, r.hub.trans.t);
  expect(e).toBeGreaterThanOrEqual(0.5);
  return { r, a: { ...DEFAULTS, ...from }, b: { ...DEFAULTS, ...to }, e };
};
const LAW = { sun_cosine: 1, sun_extinction: 1 };
const CAMERA_LOOKS = {
  cloth: { receiver: 1 }, enclosure: { receiver: 2 }, sky: { sky_view: true, view_pitch_deg: 80 }, floor: {},
};
for (const cam of ["cloth", "enclosure", "floor"]) {
  test(`${cam} to ${cam}: the exposure at the route's midpoint is beamExposure's, not the plain lerp of the morph`, () => {
    const from = { ...CAMERA_LOOKS[cam], ...LAW, faithful_canopy: false, standing_scene: false, sun_elevation_deg: 13, sun_azimuth_deg: 62, exposure: 1.27 };
    const to = { ...from, sun_elevation_deg: 40, sun_azimuth_deg: 130, exposure: 3.5 };
    const { r, a, b, e } = midRoute(from, to);
    const law = beamExposure(cam, a, b, e, r.params), plain = lerp(a.exposure, b.exposure, e);
    expect(cameraFor(r.params)).toBe(cam);
    expect(Math.abs(law - plain), "the two differ here, so the test can tell them apart").toBeGreaterThan(0.01);
    expect(r.params.exposure).toBe(law);
  });
}

// A route that lands on the floor blends in the floor's law whatever camera it left; any other change of camera is the plain lerp.
for (const [cam, other] of [["cloth", "floor"], ["enclosure", "floor"], ["sky", "floor"]]) {
  test(`${cam} to ${other}: the route lands on the floor, so the exposure is the floor's beam blend, not the plain lerp`, () => {
    const from = { ...CAMERA_LOOKS[cam], ...LAW, faithful_canopy: false, standing_scene: false, sun_elevation_deg: 13, sun_azimuth_deg: 62, exposure: 1.27 };
    const to = { ...CAMERA_LOOKS[other], ...LAW, faithful_canopy: false, standing_scene: false, sun_elevation_deg: 40, sun_azimuth_deg: 130, exposure: 3.5 };
    const { r, a, b, e } = midRoute(from, to);
    const floor = beamExposure("floor", a, b, e, r.params), plain = lerp(a.exposure, b.exposure, e);
    expect(Math.abs(floor - plain), "the two differ here, so the test can tell them apart").toBeGreaterThan(0.01);
    expect(r.params.exposure).toBe(floor);
  });
}

for (const [cam, other] of [["floor", "cloth"], ["floor", "sky"], ["cloth", "enclosure"], ["sky", "cloth"]]) {
  test(`${cam} to ${other}: the route does not land on the floor and the cameras differ, so the exposure is the plain lerp`, () => {
    const from = { ...CAMERA_LOOKS[cam], ...LAW, faithful_canopy: false, standing_scene: false, sun_elevation_deg: 13, sun_azimuth_deg: 62, exposure: 1.27 };
    const to = { ...CAMERA_LOOKS[other], ...LAW, faithful_canopy: false, standing_scene: false, sun_elevation_deg: 40, sun_azimuth_deg: 130, exposure: 3.5 };
    const { r, a, b, e } = midRoute(from, to);
    const plain = lerp(a.exposure, b.exposure, e);
    expect(Math.abs(beamExposure(other, a, b, e, r.params) - plain) + Math.abs(beamExposure(cam, a, b, e, r.params) - plain), "a blend in either end's law would differ here").toBeGreaterThan(0.01);
    expect(r.params.exposure).toBe(plain);
  });
}
