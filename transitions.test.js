// Guards the one transition coupling that otherwise fails SILENTLY (spec §9): every knob in DEFAULTS must be
// classified by the scene-transition tables — it MORPHS live, deforms the CANOPY, or forces a TOPO rebuild —
// or be intentionally non-transitioning. A knob added to DEFAULTS without classifying it would just mis-morph
// with no error; these tests turn that into a loud `bun test` failure. Run: `bun test transitions.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from "./komorebi.js";
import { makeTransitions } from "./komorebi-transitions.js";
import { PRESETS } from "./presets.js";
import riseFixture from './test-gl/fixtures/fall-look-up.json';

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
    rebuildAll: () => swaps.push({ ...params }), motionActive: () => false,
  };
  return { ...makeTransitions(hub), hub, params, swaps, bakes };
}

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

test("an iris turning on sweeps inward during the first quarter, before the scene swap", () => {
  const r=transitionRig({...DEFAULTS,vignette:0,vignette_shape:2});
  r.transitionTo({...r.params,vignette:0.24,vignette_shape:3.1});
  expect(r.hub.trans.irisRadius).toBe(Math.SQRT2);
  let radius=r.hub.trans.irisRadius;
  for(let i=0;i<15;i++) {
    r.tickTransition(1/60);
    expect(r.hub.trans.irisRadius).toBeLessThanOrEqual(radius);
    radius=r.hub.trans.irisRadius;
  }
  expect(radius).toBe(1);
  expect(r.params.vignette).toBeCloseTo(0.24*0.15625,12);
});

test("an iris turning off opens beyond the frame during the last quarter", () => {
  const r=transitionRig({...DEFAULTS,vignette:0.24,vignette_shape:3.1});
  r.transitionTo({...r.params,vignette:0});
  for(let i=0;i<45;i++) r.tickTransition(1/60);
  expect(r.hub.trans.irisRadius).toBe(1);
  for(let i=0;i<14;i++) r.tickTransition(1/60);
  expect(r.hub.trans.irisRadius).toBeGreaterThan(1.4);
  r.tickTransition(1/60);
  expect(r.hub.trans.active).toBe(false);
  expect(r.params.vignette).toBe(0);
});

test("interrupting an iris sweep carries its visible radius into the new morph", () => {
  const r=transitionRig({...DEFAULTS,vignette:0});
  r.transitionTo({...r.params,vignette:0.24});
  for(let i=0;i<6;i++) r.tickTransition(1/60);
  const radius=r.hub.trans.irisRadius;
  expect(radius).toBeGreaterThan(1);
  r.transitionTo({...r.params,vignette:0.4});
  expect(r.hub.trans.irisRadius).toBe(radius);
  r.tickTransition(0);
  expect(r.hub.trans.irisRadius).toBe(radius);
});

test("faithful structural changes dissolve complete moving scenes without a midpoint rebuild or bloom", () => {
  for (const change of [{ layer_count: 4, foliage_density: 2.4, tone_map: 0 },
                         { seed: 783609357, leader_strength: 0.55, leaf_shape: "maple", foliage_density: 1 }]) {
    const from = { ...DEFAULTS, faithful_canopy: true, layer_count: 3, foliage_density: 0.4, tone_map: 2 };
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
  const r = transitionRig({ ...DEFAULTS, faithful_canopy: true });
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
