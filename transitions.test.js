// Guards the one transition coupling that otherwise fails SILENTLY (spec §9): every knob in DEFAULTS must be
// classified by the scene-transition tables — it MORPHS live, deforms the CANOPY, or forces a TOPO rebuild —
// or be intentionally non-transitioning. A knob added to DEFAULTS without classifying it would just mis-morph
// with no error; these tests turn that into a loud `bun test` failure. Run: `bun test transitions.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from "./komorebi.js";
import { makeTransitions } from "./komorebi-transitions.js";
import { PRESETS } from "./presets.js";

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
