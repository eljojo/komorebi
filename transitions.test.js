// Guards the one transition coupling that otherwise fails SILENTLY (spec §9): every knob in DEFAULTS must be
// classified by the scene-transition tables — it MORPHS live, deforms the CANOPY, or forces a TOPO rebuild —
// or be intentionally non-transitioning. A knob added to DEFAULTS without classifying it would just mis-morph
// with no error; these tests turn that into a loud `bun test` failure. Run: `bun test transitions.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from "./komorebi.js";
import { CANOPY_MORPH_MAX } from "./komorebi-params.js";
import { makeTransitions } from "./komorebi-transitions.js";
import { GROVE_READS } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";
import { makeSource } from "./komorebi-source.js";
import { DEG, clamp, lerp, turnBack } from "./komorebi-math.js";
import riseFixture from './test-gl/fixtures/fall-look-up.json';
import shadowFixture from './test-gl/fixtures/purple-look-up.json';
import descentFixture from './test-gl/fixtures/look-up-fall.json';

// the DEFAULTS knobs that deliberately do NOT participate in transitions: runtime/debug flags, the look's
// tone-map + wind-pattern (live uniforms / a table swap, snapped not tweened), and the legacy clusters_per_layer.
const KNOWN_EXCLUDED = [
  "clusters_per_layer", "tone_map", "wind_pattern",
  "tree_species",   // inert label: the editor expands a TREE_SPECIES bundle into the shape knobs; the engine never reads it
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
    trans: { active: true, t: 0.99, dur: 1, durScale: 1, bloomMax: 1, crossfade: false, from: { ...DEFAULTS }, to: { ...DEFAULTS, exposure: 2 },
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

function transitionRig(from) {
  const noop = () => {};
  const params = { ...from }, swaps = [], bakes = [];
  const hub = {
    params, trans: { dur: 1 }, layerVAO: [{ count: 1000 }], groveIn: null,
    faithfulOn: () => params.faithful_canopy && (params.receiver | 0) !== 2 && !params.sky_view,
    warnCut: noop, regenSource: noop, resetPerf: noop, bake: () => bakes.push({ ...params }), regenCanopy: noop,
    // A rebuild given a look grows the grove from that look's values for every key the grove reads (the engine's rebuildAll),
    // so a swap records what the grove is grown from.
    rebuildAll: (look) => swaps.push({ ...params, ...(look ? Object.fromEntries(GROVE_READS.map((k) => [k, look[k]])) : {}) }),
    motionActive: () => false,
    // A grove too big to morph between looks of one branching is grown beside the shown one for the crossfade.
    buildTargetGrove: () => ({}), installGrove: noop, freeGrove: noop, sizeLayers: noop,
  };
  return { ...makeTransitions(hub), hub, params, swaps, bakes };
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
  for(const to of [{...PRESETS.memories,seed:123,branch_tau:1},{...PRESETS.memories,sky_view:true}]){
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
  Object.assign(r.hub,{beginLitterRise:()=>began++,stepLitterRise:()=>steps++,finishLitterRise:()=>null,endLitterRise:()=>ended++});
  r.transitionTo(riseFixture.to,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.litterRise).toBe(true);expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);expect(began).toBe(1);
  expect(r.swaps).toHaveLength(1);
  let cb;for(let i=0;i<122&&r.hub.trans.active;i++)cb=r.tickTransition(1/60);
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(ended).toBe(1);
  expect(r.hub.trans.active).toBe(false);expect(r.params.sky_view).toBe(true);expect(arrived).toBe(0);cb?.();expect(arrived).toBe(1);
});

test('purple eye → look up carries its shadow footprints without a midpoint swap',()=>{
  const r=transitionRig(shadowFixture.from);let began,steps=0,ended=0,arrived=0;
  Object.assign(r.hub,{beginLitterRise:(to,footprints)=>began={to,footprints},stepLitterRise:()=>steps++,finishLitterRise:()=>null,endLitterRise:()=>ended++});
  r.transitionTo(shadowFixture.to,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.litterRise).toBe(true);expect(r.hub.trans.shadowRise).toBe(true);
  expect(began).toEqual({to:shadowFixture.to,footprints:true});
  expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);
  expect(r.swaps).toHaveLength(1);
  let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(ended).toBe(1);
  expect(r.params.sky_view).toBe(true);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
});

test('look up → fall memories keeps the live sky grove until the carpet landing',()=>{
  const r=transitionRig(descentFixture.from);let began,ended=0,arrived=0,steps=0;
  Object.assign(r.hub,{beginLitterRise:(to,footprints,reverse)=>began={to,footprints,reverse},stepLitterRise:()=>steps++,
    finishLitterRise:()=>{Object.assign(r.params,descentFixture.to);r.hub.rebuildAll();return null;},endLitterRise:()=>ended++});
  r.transitionTo(descentFixture.to,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.litterRise).toBe(true);expect(r.hub.trans.litterFall).toBe(true);
  expect(began).toEqual({to:descentFixture.to,footprints:false,reverse:true});
  expect(r.params.sky_view).toBe(true);expect(r.swaps).toHaveLength(0);
  for(let i=0;i<100;i++){r.tickTransition(1/60);expect(r.params.sky_view).toBe(true);expect(r.swaps).toHaveLength(0);expect(r.hub.trans.bloom).toBe(0);}
  let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(r.params).toEqual(descentFixture.to);
  expect(ended).toBe(1);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
});

test('a floor with no dropped leaves keeps its existing transition when descent preparation declines',()=>{
  const r=transitionRig(descentFixture.from);let prepared=0;
  r.hub.beginLitterRise=()=>{prepared++;return false;};
  r.transitionTo(descentFixture.to);
  expect(prepared).toBe(1);expect(r.hub.trans.litterRise).not.toBe(true);expect(r.hub.trans.litterFall).not.toBe(true);
  expect(r.hub.trans.structDiff).toBe(true);
});

test('look up → purple eye keeps the live sky grove until the footprints land',()=>{
  const r=transitionRig(shadowFixture.to);let began,ended=0,arrived=0,steps=0;
  Object.assign(r.hub,{beginLitterRise:(to,footprints,reverse)=>began={to,footprints,reverse},stepLitterRise:()=>steps++,
    finishLitterRise:()=>{Object.assign(r.params,shadowFixture.from);r.hub.rebuildAll();return null;},endLitterRise:()=>ended++});
  r.transitionTo(shadowFixture.from,{duration:1,onEnd:()=>arrived++});
  expect(r.hub.trans.litterRise).toBe(true);expect(r.hub.trans.shadowFall).toBe(true);
  expect(began).toEqual({to:shadowFixture.from,footprints:true,reverse:true});
  expect(r.hub.trans.bloomMax).toBe(0);expect(r.hub.trans.durScale).toBe(2);
  for(let i=0;i<100;i++){r.tickTransition(1/60);expect(r.params.sky_view).toBe(true);expect(r.swaps).toHaveLength(0);expect(r.hub.trans.bloom).toBe(0);}
  let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
  expect(steps).toBeGreaterThan(100);expect(r.swaps).toHaveLength(1);expect(r.params).toEqual(shadowFixture.from);
  expect(ended).toBe(1);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
});

test('a leafless floor keeps the existing transition when the footprint descent declines',()=>{
  const r=transitionRig(shadowFixture.to);let prepared=0;
  r.hub.beginLitterRise=()=>{prepared++;return false;};
  r.transitionTo(shadowFixture.from);
  expect(prepared).toBe(1);expect(r.hub.trans.litterRise).not.toBe(true);expect(r.hub.trans.shadowFall).not.toBe(true);
  expect(r.hub.trans.structDiff).toBe(true);
});

test('cherry blossom ↔ park 2 follows one seasonal grove without a scene dissolve',()=>{
  for(const [from,to] of [[PRESETS['cherry blossom'],PRESETS['park 2']],[PRESETS['park 2'],PRESETS['cherry blossom']]]){
    const r=transitionRig(from);let began=0,steps=0,ended=0,arrived=0;
    Object.assign(r.hub,{beginSeasonTravel:()=>began++,stepSeasonTravel:()=>steps++,finishSeasonTravel:()=>null,endSeasonTravel:()=>ended++,
      beginSceneFade:()=>{},endSceneFade:()=>{},stepSceneFade:()=>{}});
    r.transitionTo(to,{duration:1,onEnd:()=>arrived++});
    expect(r.hub.trans.seasonTravel).toBe(true);expect(r.hub.trans.sceneFade).toBe(false);
    expect(r.hub.trans.bloomMax).toBe(0);expect(began).toBe(1);
    let cb;while(r.hub.trans.active)cb=r.tickTransition(1/60)||cb;
    expect(steps).toBeGreaterThan(0);expect(ended).toBe(1);
    for(const k in DEFAULTS)expect(r.params[k],k).toBe(k==='drift_phase'?from[k]:to[k]);
    expect(r.swaps).toHaveLength(0);expect(arrived).toBe(0);cb();expect(arrived).toBe(1);
  }
});

test('montebello ↔ park fall and rain ↔ cherry route to leaf travel instead of an ordinary grove morph',()=>{
  for(const [a,b] of [[PRESETS.montebello,PRESETS['park fall']],[PRESETS['montebello, rain'],PRESETS['cherry blossom']]]){
    for(const [from,to] of [[a,b],[b,a]]){
      const r=transitionRig(from);let began=0;
      r.hub.beginSeasonTravel=()=>began++;
      r.transitionTo(to);
      expect(r.hub.trans.seasonTravel).toBe(true);
      expect(r.hub.trans.canopyMorph).toBe(false);
      expect(r.hub.trans.sceneFade).toBe(false);
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
  Object.assign(r.hub,{beginLeafTravel:()=>started++,stepLeafTravel:()=>steps++,finishLeafTravel:()=>null,endLeafTravel:()=>ended++});
  r.transitionTo({...from,faithful_canopy:false,seed:123,layer_count:3,tone_map:2});
  expect(r.hub.trans.leafTravel).toBe(true);
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

test("leaf travel leaves other modes, empty groves, inner leaves, drop and oversized correspondences on their existing routes",()=>{
  const from={...DEFAULTS,faithful_canopy:true};
  for(const change of [{branch_tau:1},{canopy_fill:.5},{standing_scene:true},{sky_view:true},{receiver:1},
    {litter:1},{leaf_drop:1},{inner_leaves:.5},{leaf_size_m:0},{foliage_density:0},{tree_count:1000}]){
    const r=transitionRig(from);r.hub.beginLeafTravel=()=>{throw Error('unsupported leaf travel');};
    r.transitionTo({...from,faithful_canopy:false,...change});expect(r.hub.trans.leafTravel,JSON.stringify(change)).toBe(false);
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
  Object.assign(r.hub, { beginLeafTravel() {}, stepLeafTravel() {}, finishLeafTravel: () => null, endLeafTravel() {} });
  r.transitionTo(target, { duration: 1 });
  expect(r.hub.trans.leafTravel).toBe(true);
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
    Object.assign(r.hub, { beginLeafTravel: () => began++, stepLeafTravel: () => steps++, finishLeafTravel: () => null, endLeafTravel: () => ended++,
      beginSceneFade: () => { throw Error("unexpected scene dissolve"); } });
    r.transitionTo(target, { duration: 1 });
    expect(r.hub.trans.leafTravel).toBe(true);
    expect(r.hub.trans.sceneFade).toBe(false);
    expect(r.hub.trans.bloomMax).toBe(0);
    expect(r.hub.trans.durScale).toBe(2);
    expect(began).toBe(1);
    while (r.hub.trans.active) { r.tickTransition(1 / 60); expect(r.hub.trans.bloom).toBe(0); }
    expect(steps).toBeGreaterThan(110); expect(ended).toBe(1);
    for (const k in DEFAULTS) if (k !== "drift_phase") expect(r.params[k], k).toBe(target[k]);
  }
});

test("faithful overhead pairs a gentler route joins keep it: live morph, grove morph, re-season", () => {
  for (const [change, route] of [[{ exposure: 2 }, null], [{ leaf_size_m: DEFAULTS.leaf_size_m * 1.2 }, "canopyMorph"], [{ phenology: 0.8 }, "seasonMorph"]]) {
    const r = transitionRig(faithfulFrom);
    Object.assign(r.hub, { beginLeafTravel: () => { throw Error("unexpected leaf travel"); }, beginSceneFade: () => { throw Error("unexpected scene dissolve"); } });
    r.transitionTo({ ...faithfulFrom, ...change });
    expect(r.hub.trans.leafTravel, JSON.stringify(change)).toBe(false);
    if (route) expect(r.hub.trans[route], JSON.stringify(change)).toBe(true);
  }
});

test("a faithful structural pair leaf travel refuses still takes the scene dissolve", () => {
  for (const both of [{ branch_tau: 0.5 }, { standing_scene: true }, { litter: 1 }, { inner_leaves: 0.5 }, { canopy_fill: 0.5 }]) {
    const r = transitionRig({ ...faithfulFrom, ...both });
    r.hub.beginLeafTravel = () => { throw Error("unexpected leaf travel"); };
    Object.assign(r.hub, { beginSceneFade: () => {}, stepSceneFade: () => {}, endSceneFade: () => {} });
    r.transitionTo({ ...faithfulFrom, ...both, ...faithfulPairs[1] });
    expect(r.hub.trans.leafTravel, JSON.stringify(both)).toBe(false);
    expect(r.hub.trans.sceneFade, JSON.stringify(both)).toBe(true);
  }
  for (const differ of [{ eclipse: true }, { edge_area: true }]) {
    const r = transitionRig(faithfulFrom);
    r.hub.beginLeafTravel = () => { throw Error("unexpected leaf travel"); };
    Object.assign(r.hub, { beginSceneFade: () => {}, stepSceneFade: () => {}, endSceneFade: () => {} });
    r.transitionTo({ ...faithfulFrom, ...faithfulPairs[1], ...differ });
    expect(r.hub.trans.leafTravel, JSON.stringify(differ)).toBe(false);
    expect(r.hub.trans.sceneFade, JSON.stringify(differ)).toBe(true);
    expect(r.hub.trans.moon, JSON.stringify(differ)).toBe(null);   // each scene keeps its own source: no moon crosses inside a dissolve
  }
});

test("a faithful structural selection arriving during a scene dissolve continues the dissolve: two mixed pictures have no leaves to carry", () => {
  const r = transitionRig(faithfulFrom);
  let began = 0;
  r.hub.beginLeafTravel = () => { throw Error("unexpected leaf travel"); };
  Object.assign(r.hub, { beginSceneFade: () => began++, stepSceneFade: () => {}, endSceneFade: () => {} });
  r.transitionTo({ ...faithfulFrom, ...faithfulPairs[1], eclipse: true });
  for (let i = 0; i < 30; i++) r.tickTransition(1 / 60);
  r.transitionTo({ ...faithfulFrom, ...faithfulPairs[0], eclipse: true });
  expect(r.hub.trans.sceneFade).toBe(true);
  expect(r.hub.trans.leafTravel).toBe(false);
  expect(began).toBe(2);
});

test("faithful structural changes leaf travel refuses dissolve complete moving scenes without a midpoint rebuild or bloom", () => {
  for (const change of faithfulPairs) {
    const from = { ...faithfulFrom, branch_tau: 0.5 };
    const r = transitionRig(from), target = { ...from, ...change };
    let began = 0, steps = 0, ended = 0, callback = 0;
    r.hub.beginSceneFade = () => { began++; expect(r.params).toEqual(from); };
    r.hub.stepSceneFade = () => { steps++; };
    r.hub.endSceneFade = () => { ended++; };
    r.transitionTo(target, { duration: 1, onEnd: () => callback++ });
    expect(r.hub.trans.sceneFade).toBe(true);
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
    r.hub.beginSceneFade = () => { throw Error("unexpected scene dissolve"); };
    r.transitionTo({ ...from, ...change });
    expect(r.hub.trans.sceneFade).toBe(false);
  }
});

test("a look-only edit interrupting a faithful scene dissolve starts another scene dissolve", () => {
  const r = transitionRig({ ...DEFAULTS, faithful_canopy: true, branch_tau: 0.5 });   // wood: leaf travel refuses the pair
  let began=0, ended=0;
  r.hub.beginSceneFade=()=>began++;
  r.hub.stepSceneFade=()=>{};
  r.hub.endSceneFade=()=>ended++;
  r.transitionTo({ ...r.params, seed:1234567 });
  for(let i=0;i<30;i++) r.tickTransition(1/60);
  r.transitionTo({ ...r.params, exposure:2 });
  expect(r.hub.trans.sceneFade).toBe(true);
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
    for (const [t, opacity] of [[0.25, 0.5], [0.5, 0], [0.75, 0.5], [1, 1]]) {
      r.hub.trans.t = t;
      r.tickTransition(0);
      expect(r.hub.trans.shadowOpacity, `shadow opacity at t=${t}`).toBe(opacity);
      expect(r.hub.trans.bloom, "the floor fade does not add a cloud flash").toBe(0);
    }
    expect(r.hub.trans.active).toBe(false);
    expect(r.params).toEqual(PRESETS[to]);
  });
}

test("interrupting a floor fade preserves its visible shadow opacity", () => {
  const r = transitionRig(PRESETS["afternoon 7"]);
  r.transitionTo(PRESETS["park 1"]);
  r.hub.trans.t = 0.75;
  r.tickTransition(0);
  const opacity = r.hub.trans.shadowOpacity;
  expect(opacity).toBe(0.5);
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
  r.transitionTo({ ...from, layer_count: 3, tex_resolution: from.tex_resolution/2 });   // a texture size the two groves cannot share: a dissolve
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
  tickTo(r, 0.4);
  const shown = r.hub.trans.shadowOpacity;
  expect(shown).toBeLessThan(0.2);
  r.transitionTo(from);
  expect(r.hub.trans.backgroundFade).toBe(false);
  r.tickTransition(1/60);
  expect(Math.abs(r.hub.trans.shadowOpacity - shown)).toBeLessThan(0.02);
  tickTo(r, 0.5);
  expect(r.hub.trans.shadowOpacity).toBe(1);
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
  Object.assign(r.hub, { beginSceneFade: () => {}, stepSceneFade: () => {}, endSceneFade: () => ends++ });
  r.transitionTo({ ...from, seed: 77 });
  expect(r.hub.trans.sceneFade).toBe(true);
  tickTo(r, 0.5);
  const layer = { ...DEFAULTS, standing_scene: true, exposure: 2 };   // not faithful: no dissolve can take it
  r.transitionTo(layer);
  expect(ends).toBe(0); expect(r.hub.trans.sceneFade).toBe(true); expect(r.hub.trans.waiting.to.exposure).toBe(2);
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
// The source module's pure moon and height functions, read through the namespace so a missing one fails its test rather than the file.
import * as SOURCE from "./komorebi-source.js";
import * as GROVE from "./komorebi-grove.js";

// The transition rig with the real sampler and layer heights wired in, the way the engine wires them.
function sourceRig(from, over = {}) {
  const r = transitionRig(from), sized = [], built = [];
  Object.assign(r.hub, { perf: { auto: false }, src: {}, crossW: 0, sized, built,
    buildTargetGrove: (to) => { const g = { to }; built.push(g); return g; }, installGrove: () => {}, freeGrove: () => {},
    sizeLayers: (n) => sized.push(n),
    effCloud: () => clamp(lerp(r.params.cloud_thickness, 1, r.hub.trans.bloom), 0, 1), ...over });
  r.hub.trans.bloom = 0;
  Object.assign(r.hub, makeSource(r.hub));
  r.hub.transitionTo = r.transitionTo;
  return r;
}
// The share of the source's weight the moon covers, from the sampler's own weights against the same source with no eclipse.
const weights = (src) => Array.from({ length: src.count }, (_, i) => src.flat[i*3+2]);
const native = (p) => { const r = sourceRig(p); r.hub.regenSource(); return { src: { ...r.hub.src, flat: r.hub.src.flat.slice() }, heights: Array.from(r.hub.layerHeights()) }; };
const look = (p) => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, p[k]]));   // the params a look has, whatever else an object carries
const settle = (r) => { let frames = 0, cb; while (r.hub.trans.active && frames++ < 400) cb = r.tickTransition(1/60) || cb; return cb; };

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
  expect(typeof SOURCE.routeHeights).toBe("function");
  for (const n of [1, 2, 3, 4]) {
    const h = SOURCE.routeHeights(n, 4.2, 2.6), lh = native({ ...DEFAULTS, layer_count: n, canopy_base_height_m: 4.2, canopy_thickness_m: 2.6 }).heights;
    for (let i = 0; i < n; i++) expect(Math.fround(h[i])).toBe(lh[i]);
    for (let i = n; i < 4; i++) expect(h[i], "padded with the top layer").toBe(h[n - 1]);
  }
  const a = SOURCE.routeHeights(3, 4.2, 2.6), b = SOURCE.routeHeights(3, 4.9, 2.5);
  for (const e of [0.25, 0.5, 0.75]) for (let i = 0; i < 3; i++)
    expect(lerp(a[i], b[i], e)).toBeCloseTo(SOURCE.routeHeights(3, lerp(4.2, 4.9, e), lerp(2.6, 2.5, e))[i], 12);
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
  for (const over of [{ tex_resolution: A.tex_resolution/2 }, { bake_resolution: A.bake_resolution/2 }, { branch_tau: 0.5 }]) {
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
  for (const k of [...GROVE.GROVE_READS, "trans_r", "phenology", "edge_softness"]) expect(seen[k], k).toBe(look[k]);
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
  faithful.hub.beginSceneFade = faithful.hub.stepSceneFade = faithful.hub.endSceneFade = () => {};
  faithful.transitionTo({ ...PRESETS["the void"], faithful_canopy: true, branch_tau: 0.5 });
  expect(faithful.hub.trans.crossfade).toBe(false);
  expect(faithful.hub.trans.sceneFade).toBe(true);
});

// style 'fade': a driver asks for the dissolve of two moving scenes, whatever the pair's modes or cameras.
function fadeRig(from) {
  const r = crossRig(from, 1000), log = { began: 0, ended: 0, steps: 0 };
  r.hub.beginSceneFade = () => { log.began++; expect(r.params).toEqual(from); };
  r.hub.stepSceneFade = () => { log.steps++; };
  r.hub.endSceneFade = () => { log.ended++; };
  for (const k of ["beginGroveTravel", "beginLitterRise", "beginSeasonTravel", "beginLeafTravel"]) r.hub[k] = () => { throw Error(`unexpected ${k}`); };
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
    expect(r.hub.trans.sceneFade).toBe(true);
    expect(r.hub.trans.crossfade || r.hub.trans.backgroundFade || r.hub.trans.viewpoint || r.hub.trans.leafTravel || r.hub.trans.seasonTravel).toBe(false);
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
  r.hub.beginSceneFade = () => { throw Error("unexpected scene dissolve"); };
  r.transitionTo({ ...DEFAULTS, exposure: 2, sun_elevation_deg: 30 }, { style: "fade" });
  expect(r.hub.trans.sceneFade).toBe(false);
  expect(r.hub.trans.structDiff).toBe(false);
});

for (const change of [{ exposure: 2 }, { foliage_density: 1.5 }]) {
  test(`a fade requested during ${'exposure' in change ? 'a live' : 'a grove'} morph waits and keeps its style`, () => {
    const r = fadeRig({ ...DEFAULTS });
    r.hub.transitionTo = r.transitionTo;
    r.hub.beginSceneFade = () => { r.log.began++; };
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
    r.hub.beginSceneFade = () => { r.log.began++; };
    r.transitionTo({ ...DEFAULTS, foliage_density: 1.5 }, { duration: 0.1 });
    r.hub.trans[route] = true;
    const name = route[0].toUpperCase() + route.slice(1);
    r.hub[`step${name}`] = () => {};
    r.hub[`finish${name}`] = () => { Object.assign(r.params, r.hub.trans.to); return null; };
    r.hub[`end${name}`] = () => {};
    r.hub[`retarget${name}`] = () => { throw Error('a requested fade must wait'); };
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
    expect(sky.hub.trans.sceneFade || sky.hub.trans.crossfade).toBe(false);
    expect(sky.hub.trans.bloomMax).toBeGreaterThan(0);
    const floor = crossRig(PRESETS["afternoon 7"], 1000);
    floor.transitionTo(PRESETS["park 1"], { style });
    expect(floor.hub.trans.backgroundFade).toBe(true);
    expect(floor.hub.trans.sceneFade).toBe(false);
  }
});

// Carpeted floor-to-floor mode changes: the litter carpet stays visible through the lit-ground fade's midpoint, where the grove and
// camera swap would show as a cut, so these pairs dissolve two moving scenes instead.
for (const [from, to] of [["park fall", "forest floor"], ["forest floor", "park fall"], ["forest floor", "the yellow tree"], ["the yellow tree", "forest floor"]]) {
  test(`${from} → ${to}: a carpeted floor-to-floor mode change dissolves two moving scenes`, () => {
    const r = fadeRig(PRESETS[from]);
    r.transitionTo(PRESETS[to], { duration: 1 });
    expect(r.hub.trans.sceneFade).toBe(true);
    expect(r.hub.trans.backgroundFade).toBe(false);
    expect(r.hub.trans.bloomMax).toBe(0);
    for (let n = 0; r.hub.trans.active && n < 200; n++) { r.tickTransition(1 / 60); expect(r.hub.trans.bloom).toBe(0); }
    expect(r.params).toEqual(PRESETS[to]);
  });
}

test("montebello ↔ park fall keeps season travel over the carpeted scene dissolve", () => {
  for (const [from, to] of [["montebello", "park fall"], ["park fall", "montebello"]]) {
    const r = fadeRig(PRESETS[from]); let began = 0;
    r.hub.beginSeasonTravel = () => { began++; };
    r.hub.beginSceneFade = () => { throw Error("unexpected scene dissolve"); };
    r.transitionTo(PRESETS[to]);
    expect(r.hub.trans.seasonTravel).toBe(true);
    expect(began).toBe(1);
  }
});
