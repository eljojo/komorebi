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

test("non-live macros stay inside the CANOPY morph class (no TOPO/MODE)", () => {
  for (const [key, m] of Object.entries(MACROS)) {
    if (m.live) continue;
    for (const p of Object.keys(m.stops[0].set))
      expect(MORPH.has(p) || CANOPY.has(p), `macro '${key}' target '${p}' is neither MORPH nor CANOPY`).toBe(true);
  }
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
  bus.set("season", 0.5, { commit: false });      // a non-live drag previews without its rebuild scope
  expect(calls[1][0]).toBe(null);
  bus.set("season", 0);                            // committed: the canopy regrow rides along
  expect(calls[2][0]).toBe("canopy");
  expect(params.foliage_density).toBe(0.45);
  expect(bus.get("season")).toBe(0);
});
