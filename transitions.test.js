// Guards the one transition coupling that otherwise fails SILENTLY (spec §9): every knob in DEFAULTS must be
// classified by the scene-transition tables — it MORPHS live, deforms the CANOPY, or forces a TOPO rebuild —
// or be intentionally non-transitioning. A knob added to DEFAULTS without classifying it would just mis-morph
// with no error; these tests turn that into a loud `bun test` failure. Run: `bun test transitions.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS } from "./komorebi.js";

// the DEFAULTS knobs that deliberately do NOT participate in transitions: runtime/debug flags, the look's
// tone-map + wind-pattern (live uniforms / a table swap, snapped not tweened), and the legacy clusters_per_layer.
const KNOWN_EXCLUDED = [
  "clusters_per_layer", "tone_map", "wind_pattern",
  "drift_auto", "auto_quality", "show_source", "show_layer", "show_layer_index",
];

test("the three transition classes are pairwise disjoint", () => {
  const m = new Set(MORPH_KEYS), c = new Set(CANOPY_KEYS);
  for (const k of CANOPY_KEYS) expect(m.has(k)).toBe(false);
  for (const k of TOPO_KEYS) { expect(m.has(k)).toBe(false); expect(c.has(k)).toBe(false); }
});

test("every classified key exists in DEFAULTS (catches typos / stale renames)", () => {
  for (const k of [...MORPH_KEYS, ...CANOPY_KEYS, ...TOPO_KEYS, ...KNOWN_EXCLUDED])
    expect(k in DEFAULTS).toBe(true);
});

test("every DEFAULTS knob is classified or explicitly excluded — no silent omissions", () => {
  const covered = new Set([...MORPH_KEYS, ...CANOPY_KEYS, ...TOPO_KEYS, ...KNOWN_EXCLUDED]);
  const missing = Object.keys(DEFAULTS).filter((k) => !covered.has(k));
  expect(missing).toEqual([]);   // add a new knob to a transition class (or to KNOWN_EXCLUDED) to satisfy this
});
