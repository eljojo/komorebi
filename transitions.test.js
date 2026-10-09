// Guards the one transition coupling that otherwise fails SILENTLY (spec §9): every knob in DEFAULTS must be
// classified by the scene-transition tables — it MORPHS live, deforms the CANOPY, or forces a TOPO rebuild —
// or be intentionally non-transitioning. A knob added to DEFAULTS without classifying it would just mis-morph
// with no error; these tests turn that into a loud `bun test` failure. Run: `bun test transitions.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from "./komorebi.js";
import { makeTransitions } from "./komorebi-transitions.js";

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
