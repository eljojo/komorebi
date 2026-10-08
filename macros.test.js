// ============================================================================
// The macro table's couplings, held loudly (the transitions.test.js pattern):
// a macro that drags a rebuild-class param on every pointermove, a stop set
// that drifts out of shape, or a probe that stops being invertible would each
// fail silently in the UI — so the table is data and this reads it.
// ============================================================================
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS } from "./komorebi.js";
import { MACROS, createBus, macroParams, macroUsable, macroValue } from "./macros.js";
import { PRESETS } from "./presets.js";

const MORPH = new Set(MORPH_KEYS), CANOPY = new Set(CANOPY_KEYS);
const REBUILD = new Set([...TOPO_KEYS, ...MODE_KEYS]);

test("every macro target is a real engine param", () => {
  for (const [key, m] of Object.entries(MACROS))
    for (const stop of m.stops)
      for (const p of Object.keys(stop.set))
        expect(p in DEFAULTS, `${key} targets unknown param '${p}'`).toBe(true);
});

test("live macros touch only live-safe params — never the rebuild classes", () => {
  for (const [key, m] of Object.entries(MACROS)) {
    if (!m.live) continue;
    for (const p of Object.keys(m.stops[0].set)) {
      expect(REBUILD.has(p), `live macro '${key}' drags rebuild param '${p}'`).toBe(false);
      expect(CANOPY.has(p), `live macro '${key}' drags canopy-regrow param '${p}'`).toBe(false);
    }
  }
});

test("non-live macros stay inside MORPH ∪ CANOPY (no TOPO/MODE)", () => {
  for (const [key, m] of Object.entries(MACROS)) {
    if (m.live) continue;
    for (const p of Object.keys(m.stops[0].set))
      expect(MORPH.has(p) || CANOPY.has(p), `macro '${key}' target '${p}' is neither MORPH nor CANOPY`).toBe(true);
  }
});

test("a tweened macro is never `live` (the editor branches on truthiness), regrows the canopy, and has a positive time constant", () => {
  const tweened = Object.entries(MACROS).filter(([, m]) => m.tween !== undefined);
  expect(tweened.map(([k]) => k)).toContain("season");
  for (const [key, m] of tweened) {
    expect(m.live, `${key}: live must be falsy, not a string`).toBe(false);
    expect(m.scope, `${key}: a tween rides the canopy regrow`).toBe("canopy");
    expect(typeof m.tween === "number" && m.tween > 0, `${key}: tween must be seconds > 0`).toBe(true);
  }
  expect(MACROS.season.tween).toBe(0.8);
});

// ---- the season axis: spring -> summer -> fall, every stop a recipe lifted from a look ------------------------------------
const CAPACITY = ["anthocyanin", "tannin", "wall_fraction", "turn_exposure", "leaf_drop"];
const STRUCTURE = ["foliage_density", "branch_length_ratio", "branch_pitch_deg", "trans_r", "trans_g", "trans_b"];
const NEVER_TARGETS = ["canopy_fill", "leaf_diffuse", "exposure_absolute", "litter", "litter_resolution", "litter_age", "litter_drift_m", "leaf_wetness"];

test("season stops: phenology is the probe; every stop carries the same keys, annotated with the look it was lifted from", () => {
  const m = MACROS.season;
  expect(m.probe).toBe("phenology");
  expect(m.stops.map((s) => s.t)).toEqual([0, 0.35, 0.55, 0.62, 1]);
  expect(m.stops.map((s) => s.from)).toEqual(["memories", "morning 1", "afternoon 4", null, "montebello"]);
  expect(m.stops.map((s) => s.set.phenology)).toEqual([0.15, 0.4, 0.5, 0.6, 0.9]);
  for (const s of m.stops) expect(Object.keys(s.set).sort()).toEqual(["phenology", ...STRUCTURE, ...CAPACITY].sort());
});

test("season stops: every annotated value is the look's own (capacity keys: montebello's; the fall stops' structure: afternoon 4's)", () => {
  for (const s of MACROS.season.stops) {
    for (const k of Object.keys(s.set)) {
      // the last green day has no look: its phenology IS turn_start, and its structure is the summer's (afternoon 4)
      // montebello's own structure (park 1's 1.55 / 0.68 / 20) is deliberately NOT the stop's: see macros.js
      const src = CAPACITY.includes(k) ? PRESETS.montebello
        : k === "phenology" ? (s.from ? PRESETS[s.from] : { phenology: DEFAULTS.turn_start })
        : PRESETS[s.from && s.from !== "montebello" ? s.from : "afternoon 4"];
      expect(s.set[k], `${s.from ?? "last green day"} @ ${s.t}: ${k}`).toBe(src[k]);
    }
  }
});

test("season stops: the capacity pigments are constant across the axis (inert below turn_start, so spring and summer are the looks' own)", () => {
  const stops = MACROS.season.stops;
  for (const k of CAPACITY) for (const s of stops) expect(s.set[k], k).toBe(stops[0].set[k]);
  expect(DEFAULTS.turn_start).toBe(0.6);
  for (const s of stops) if (s.set.phenology <= DEFAULTS.turn_start) expect(s.t <= 0.62).toBe(true);
});

test("macroValue('season') places the real looks on the axis", () => {
  expect(macroValue("season", PRESETS.memories)).toBe(0);
  expect(macroValue("season", PRESETS["morning 1"])).toBeCloseTo(0.35, 12);
  for (const n of ["afternoon 4", "afternoon 5", "afternoon 6", "afternoon 7"]) expect(macroValue("season", PRESETS[n]), n).toBeCloseTo(0.55, 12);
  expect(macroValue("season", PRESETS.montebello)).toBe(1);
});

test("no macro ever targets physics a look has or doesn't (the fill, the glass, the carpet, the rain)", () => {
  for (const [key, m] of Object.entries(MACROS))
    for (const stop of m.stops) for (const p of NEVER_TARGETS) expect(p in stop.set, `${key} targets '${p}'`).toBe(false);
  expect(TOPO_KEYS).toContain("litter");   // and litter is TOPO, which the non-live rule above already keeps out of any macro
});

test("no two macros write the same param (last-write-wins fights)", () => {
  const owner = new Map();
  for (const [key, m] of Object.entries(MACROS))
    for (const p of Object.keys(m.stops[0].set)) {
      expect(owner.has(p), `param '${p}' written by both '${owner.get(p)}' and '${key}'`).toBe(false);
      owner.set(p, key);
    }
});

test("stops are well-formed: same param set throughout, t ascending from 0 to 1", () => {
  for (const [key, m] of Object.entries(MACROS)) {
    const keys0 = Object.keys(m.stops[0].set).sort().join();
    expect(m.stops[0].t).toBe(0);
    expect(m.stops[m.stops.length - 1].t).toBe(1);
    for (let i = 0; i < m.stops.length; i++) {
      expect(Object.keys(m.stops[i].set).sort().join(), `${key} stop ${i} param set differs`).toBe(keys0);
      if (i) expect(m.stops[i].t > m.stops[i - 1].t, `${key} stops not ascending`).toBe(true);
    }
    expect(m.probe in m.stops[0].set, `${key} probe '${m.probe}' not among its own targets`).toBe(true);
  }
});

test("each probe is strictly monotone across its stops (invertibility)", () => {
  for (const [key, m] of Object.entries(MACROS)) {
    const vals = m.stops.map((s) => s.set[m.probe]);
    const dir = Math.sign(vals[vals.length - 1] - vals[0]);
    expect(dir !== 0, `${key} probe is flat`).toBe(true);
    for (let i = 1; i < vals.length; i++)
      expect(dir * (vals[i] - vals[i - 1]) > 0, `${key} probe not monotone at stop ${i}`).toBe(true);
  }
});

test("macroParams -> macroValue round-trips through the probe", () => {
  for (const key of Object.keys(MACROS))
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const p = macroParams(key, t);
      expect(Math.abs(macroValue(key, p) - t), `${key} round-trip at t=${t}`).toBeLessThan(1e-9);
    }
});

test("macroValue clamps out-of-range looks to the ends and reads real presets sanely", () => {
  expect(macroValue("weather", { cloud_thickness: 0.9 })).toBe(1);
  expect(macroValue("wind_y", { wind_strength: -1 })).toBe(0);
  for (const name of Object.keys(PRESETS))
    for (const key of Object.keys(MACROS)) {
      const t = macroValue(key, PRESETS[name]);
      expect(t >= 0 && t <= 1, `${key} on '${name}' out of range: ${t}`).toBe(true);
    }
});

test("the dishonest-elsewhere recipes are gated, and macroUsable answers per look", () => {
  // floor recipes: exposure regime (haze), floor albedo (palette), authored leaf hue (season), sky-view
  // coverage arithmetic (grove). Cast-only: diffraction (prism). The rest work everywhere.
  for (const k of ["haze", "palette", "season", "grove"]) expect(MACROS[k].gate).toBe("floor");
  expect(MACROS.prism.gate).toBe("cast");
  for (const k of ["weather", "focus", "wind_x", "wind_y"]) expect(MACROS[k].gate).toBe(undefined);
  expect(macroUsable("haze", PRESETS["afternoon 5"])).toBe(true);
  expect(macroUsable("haze", PRESETS["canopy 1"])).toBe(false);
  expect(macroUsable("haze", PRESETS["curtain 1"])).toBe(false);
  expect(macroUsable("prism", PRESETS["curtain 1"])).toBe(true);
  expect(macroUsable("prism", PRESETS["canopy 1"])).toBe(false);
  expect(macroUsable("weather", PRESETS["canopy 1"])).toBe(true);
});

test("the bus routes set() through the mapping and the applier", () => {
  const params = { ...DEFAULTS };
  const calls = [];
  const bus = createBus(() => params, (dict, scope, live) => { Object.assign(params, dict); calls.push([scope, live]); });
  bus.set("weather", 1);
  expect(params.cloud_thickness).toBe(0.55);
  expect(calls[0]).toEqual(["source", true]);
  bus.set("grove", 0.5, { commit: false });       // a non-live drag previews without its rebuild scope
  expect(calls[1][0]).toBe(null);
  bus.set("grove", 0);                             // committed: the canopy regrow rides along
  expect(calls[2][0]).toBe("canopy");
  expect(params.tree_count).toBe(1);
  expect(bus.get("grove")).toBe(0);
});

// ---- the tween: a bus-side one-pole ease, never transitionTo -------------------------------------------------------------
function rig(start = PRESETS["afternoon 4"]) {
  const params = { ...DEFAULTS, ...start };
  const calls = [];
  const bus = createBus(() => params, (dict, scope, live) => { Object.assign(params, dict); calls.push({ dict: { ...dict }, scope, live }); });
  return { params, calls, bus };
}
const TAU = MACROS.season.tween;
function run(bus, seconds, fps = 60) { for (let i = 0; i < seconds * fps; i++) bus.tick(1 / fps); }

test("tween: set() stores a target only — nothing is applied until tick", () => {
  const { bus, calls } = rig();
  bus.set("season", 1);
  expect(calls.length).toBe(0);
});

test("tween: converges to the target, the applied phenology is monotone, and the LAST apply is the stop's own dict, exactly", () => {
  const { bus, calls, params } = rig(PRESETS.memories);
  bus.set("season", 1);
  run(bus, 8 * TAU);
  const ph = calls.map((c) => c.dict.phenology);
  expect(ph.length).toBeGreaterThan(10);
  for (let i = 1; i < ph.length; i++) expect(ph[i] >= ph[i - 1], `step ${i}`).toBe(true);
  expect(calls.every((c) => c.scope === "canopy" && c.live === false)).toBe(true);
  expect(calls[calls.length - 1].dict).toEqual(macroParams("season", 1));
  expect(bus.get("season")).toBe(1);
  const n = calls.length;
  run(bus, 1);
  expect(calls.length, "idle after landing").toBe(n);
  expect(params.phenology).toBe(0.9);
});

test("tween: one apply per tick at most, and none when the dict did not change", () => {
  const { bus, calls } = rig();
  bus.set("season", 1);
  bus.tick(0.016);
  expect(calls.length).toBe(1);
  bus.tick(0);                                     // the clock did not move
  expect(calls.length).toBe(1);
  bus.set("season", 1);                            // a repeated target moves nothing either
  bus.tick(0);
  expect(calls.length).toBe(1);
});

test("tween: the first set seeds the ease from the look's own place on the axis", () => {
  const { bus, calls } = rig();                    // afternoon 4 sits at 0.55 (phenology 0.5)
  bus.set("season", 1);
  bus.tick(0.016);
  const ph = calls[0].dict.phenology;
  expect(ph).toBeGreaterThan(0.5);
  expect(ph).toBeLessThan(macroParams("season", 0.6).phenology);   // a small step from 0.55, not a jump toward the target
});

test("tween: retargeting mid-flight continues from the current ease with no jump", () => {
  const { bus, calls } = rig(PRESETS.memories);
  bus.set("season", 1);
  run(bus, 0.5);
  const before = calls[calls.length - 1].dict.phenology;
  bus.set("season", 0.3);
  bus.tick(1 / 600);
  const after = calls[calls.length - 1].dict.phenology;
  expect(Math.abs(after - before)).toBeLessThan(0.01);
  run(bus, 8 * TAU);
  expect(calls[calls.length - 1].dict).toEqual(macroParams("season", 0.3));
});

test("tween: cancel() drops the target and applies nothing", () => {
  const { bus, calls } = rig(PRESETS.memories);
  bus.set("season", 1);
  run(bus, 0.3);
  const n = calls.length;
  bus.cancel();
  run(bus, 2);
  expect(calls.length).toBe(n);
  bus.set("season", 0);                            // and the next set seeds afresh from the look
  bus.tick(0.016);
  expect(calls.length).toBe(n + 1);
});

test("tween: one big tick lands the target exactly (the editor's release of a gated look)", () => {
  const { bus, calls } = rig();
  bus.set("season", 0);
  bus.tick(1e9);
  expect(calls.length).toBe(1);
  expect(calls[0].dict).toEqual(macroParams("season", 0));
});

test("tween: get() reads the look (the probe), not the target", () => {
  const { bus } = rig(PRESETS.memories);
  bus.set("season", 1);
  expect(bus.get("season")).toBe(0);
  bus.tick(0.1);
  expect(bus.get("season")).toBeGreaterThan(0);
  expect(bus.get("season")).toBeLessThan(1);
});

test("the one-pole step: x += (target - x)(1 - e^(-dt/tau)), so it composes across any frame split", () => {
  const a = rig(PRESETS.memories), b = rig(PRESETS.memories);
  a.bus.set("season", 1); b.bus.set("season", 1);
  for (let i = 0; i < 10; i++) a.bus.tick(0.01);
  b.bus.tick(0.1);
  expect(a.calls[a.calls.length - 1].dict.phenology).toBeCloseTo(b.calls[b.calls.length - 1].dict.phenology, 9);
});
