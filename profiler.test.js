// Tests for profiler.js — the pure auto-profiler logic. Run: `bun test profiler.test.js`.
import { test, expect } from "bun:test";
import { AXES, axisValue, upValue, proposeVariants, proposeImprove, FRAME_BUDGET_MS } from "./profiler.js";

test("AXES carries the audit-classified taxonomy", () => {
  const by = Object.fromEntries(AXES.map(a => [a.key, a]));
  // proposable safe cuts (persistable params)
  expect(by.sample_count.cls).toBe("safe");
  expect(by.sample_count.proposable).toBe(true);
  expect(by.tex_resolution.proposable).toBe(true);
  expect(by.layer_count.proposable).toBe(true);
  // risky: foliage, aggressive-only
  expect(by.foliage_density.cls).toBe("risky");
  expect(by.foliage_density.proposable).toBe(true);
  // style-locked: diffraction is measured, never cut
  expect(by.chromatic_aberration.cls).toBe("style");
  expect(by.chromatic_aberration.proposable).toBe(false);
  // render resolution is the auto-scaler's runtime lever — not a stylistic axis, so it isn't here at all
  expect(by.res).toBeUndefined();
  // opt-in 'tune' optimizations: measured + auto-proposed, may change the look (off by default in the engine)
  expect(by.bake_resolution.cls).toBe("tune");
  expect(by.bake_resolution.proposable).toBe(true);
  expect(by.bake_resolution.pass).toBe("bake");
  expect(by.adaptive_motion.cls).toBe("tune");
  expect(by.adaptive_motion.proposable).toBe(true);
  expect(by.adaptive_motion.measure).toBe("skipfrac");   // special: cost is a frame-skip fraction, not a per-pass ablation
  // every axis has a label, a class, and a valid affected pass
  for (const a of AXES) {
    expect(typeof a.label).toBe("string");
    expect(["safe", "risky", "style", "tune"]).toContain(a.cls);
    expect(["transport", "bake", "both"]).toContain(a.pass);
  }
});

test("FRAME_BUDGET_MS is one 60fps frame", () => {
  expect(FRAME_BUDGET_MS).toBeCloseTo(1000 / 60, 6);
});

test("quality axes carry an up-level + gain priority; upValue lifts toward it or null at the ceiling", () => {
  const a = Object.fromEntries(AXES.map(x => [x.key, x]));
  // each safe quality axis can be pushed richer
  expect(upValue(a.sample_count, { sample_count: 32 })).toBe(48);
  expect(upValue(a.tex_resolution, { tex_resolution: 1024 })).toBe(2048);
  expect(upValue(a.layer_count, { layer_count: 3 })).toBe(4);          // MAX_LAYERS
  // already at/above the ceiling -> nothing to add
  expect(upValue(a.sample_count, { sample_count: 48 })).toBe(null);
  expect(upValue(a.layer_count, { layer_count: 4 })).toBe(null);
  // visual-priority order: samples (softer penumbra) > tex res (sharper leaf) > layers (more depth tiers)
  expect(a.sample_count.gain).toBeGreaterThan(a.tex_resolution.gain);
  expect(a.tex_resolution.gain).toBeGreaterThan(a.layer_count.gain);
  // axes with no up-level (cut-only / non-quality) yield null
  expect(upValue(a.bake_resolution, { bake_resolution: 0, tex_resolution: 1024 })).toBe(null);
  expect(upValue(a.foliage_density, { foliage_density: 1.0 })).toBe(null);
});

test("axisValue resolves bake_resolution's effective base (0 follows tex_resolution) and toggles adaptive on", () => {
  const a = Object.fromEntries(AXES.map(x => [x.key, x]));
  // bake_resolution 0 means 'follow tex_resolution' -> a cut toward 768 is real against the followed 1024
  expect(axisValue(a.bake_resolution, { bake_resolution: 0, tex_resolution: 1024 })).toBe(768);
  // already lower than the cut level -> nothing to cut
  expect(axisValue(a.bake_resolution, { bake_resolution: 768, tex_resolution: 1024 })).toBe(null);
  // adaptive is a toggle: the 'cut' is enabling it; once on there's nothing left to propose
  expect(axisValue(a.adaptive_motion, { adaptive_motion: false })).toBe(true);
  expect(axisValue(a.adaptive_motion, { adaptive_motion: true })).toBe(null);
});

const IMPROVE_BASE = { sample_count: 24, tex_resolution: 1024, layer_count: 2 };

test("proposeImprove returns one variant of the highest-value upgrades that fit the spare budget", () => {
  // spare 4ms, 0.7 safety -> 2.8ms to spend. costs(ms): samples 1.5, tex 3.0, layers 1.0
  const costs = { sample_count: 1.5, tex_resolution: 3.0, layer_count: 1.0 };
  const v = proposeImprove(IMPROVE_BASE, costs, 4);
  expect(v).not.toBeNull();
  expect(v.name).toBe("improve");
  // greedy by priority: samples(1.5) fits, tex(+3.0=4.5) overflows -> skipped, layers(+1.0=2.5) fits
  expect(v.applied.map(s => s.key)).toEqual(["sample_count", "layer_count"]);
  expect(v.params.sample_count).toBe(48);
  expect(v.params.layer_count).toBe(4);
  expect(v.params.tex_resolution).toBe(1024);          // untouched — it didn't fit
  expect(v.estAddedCost).toBeCloseTo(2.5, 6);
});

test("proposeImprove makes no recommendation when there's no room or nothing fits", () => {
  const costs = { sample_count: 1.5, tex_resolution: 3.0, layer_count: 1.0 };
  expect(proposeImprove(IMPROVE_BASE, costs, 0)).toBeNull();        // no spare
  expect(proposeImprove(IMPROVE_BASE, costs, -2)).toBeNull();       // over budget already
  expect(proposeImprove(IMPROVE_BASE, costs, 1)).toBeNull();        // 0.7ms budget — even the cheapest (1.0) doesn't fit
});

test("proposeImprove makes no recommendation when every quality axis is already maxed", () => {
  const maxed = { sample_count: 48, tex_resolution: 2048, layer_count: 4 };
  const costs = { sample_count: 1.0, tex_resolution: 1.0, layer_count: 1.0 };
  expect(proposeImprove(maxed, costs, 100)).toBeNull();              // huge budget, but nothing left to improve
});

test("proposeVariants folds tune cuts into the most aggressive rung", () => {
  const base = { sample_count: 32, tex_resolution: 1024, layer_count: 3, foliage_density: 1.65,
                 chromatic_aberration: 0, bake_resolution: 0, adaptive_motion: false };
  const costs = { sample_count: 0.25, foliage_density: 0.30, bake_resolution: 0.20, adaptive_motion: 0.15 };
  const v = proposeVariants(base, costs);
  const min = v[v.length - 1];                                       // the aggressive rung
  expect(min.applied.some(s => s.key === "bake_resolution")).toBe(true);
  expect(min.applied.some(s => s.key === "adaptive_motion")).toBe(true);
  expect(min.params.bake_resolution).toBe(768);
  expect(min.params.adaptive_motion).toBe(true);
  // the lite rung stays a single safe cut — tune opts only ride the aggressive rung
  expect(v[0].applied.every(s => s.cls === "safe")).toBe(true);
});

test("axisValue returns the lightest degraded value, or null when nothing to cut", () => {
  const a = Object.fromEntries(AXES.map(x => [x.key, x]));
  // absolute-level axes: lightest level if it reduces the base
  expect(axisValue(a.sample_count, { sample_count: 32 })).toBe(16);
  expect(axisValue(a.tex_resolution, { tex_resolution: 2048 })).toBe(1024);
  expect(axisValue(a.layer_count, { layer_count: 3 })).toBe(2);
  // already at/below the lightest level -> null (nothing to cut)
  expect(axisValue(a.tex_resolution, { tex_resolution: 1024 })).toBe(null);
  expect(axisValue(a.layer_count, { layer_count: 2 })).toBe(null);
  expect(axisValue(a.sample_count, { sample_count: 12 })).toBe(null);
  // relative axis (foliage): lightest multiplier of the base, always a reduction for base>0
  expect(axisValue(a.foliage_density, { foliage_density: 1.0 })).toBeCloseTo(0.5, 6);
  expect(axisValue(a.foliage_density, { foliage_density: 1.65 })).toBeCloseTo(0.825, 6);
  // non-proposable axes (diffraction) -> null (never produce a saved cut)
  expect(axisValue(a.chromatic_aberration, { chromatic_aberration: 3 })).toBe(null);
});

const BASE = { sample_count: 32, tex_resolution: 2048, layer_count: 3,
               foliage_density: 1.65, chromatic_aberration: 0 };

test("proposeVariants builds a distinct cost-ranked ladder: lite=top safe, medium=all safe, min=+risky", () => {
  // measured FRACTIONAL savings of fully degrading each axis (0..1 of total frame cost), all worth proposing
  const costs = { tex_resolution: 0.4, sample_count: 0.25, layer_count: 0.1, foliage_density: 0.35 };
  const v = proposeVariants(BASE, costs);
  expect(v.map(x => x.name)).toEqual(["lite", "medium", "min"]);
  // lite: only the single biggest SAFE cut
  expect(v[0].applied.map(s => s.key)).toEqual(["tex_resolution"]);
  expect(v[0].params.tex_resolution).toBe(1024);
  expect(v[0].estReduction).toBeCloseTo(0.4, 6);
  // medium: all worthwhile safe cuts, ranked by saving
  expect(v[1].applied.map(s => s.key)).toEqual(["tex_resolution", "sample_count", "layer_count"]);
  // min: the safe cuts plus the risky axis
  expect(v[2].applied.some(s => s.cls === "risky" && s.key === "foliage_density")).toBe(true);
  // diffraction (style) is NEVER baked in; and no two variants apply the same set
  for (const x of v) expect(x.params.chromatic_aberration).toBe(0);
  const keys = v.map(x => x.applied.map(s => s.key).sort().join(","));
  expect(new Set(keys).size).toBe(keys.length);
});

test("a trivial cut is dropped, lite is the single top cut, and there are no duplicate variants", () => {
  // samples 19% (worth it), layers 2% (below floor -> dropped), foliage 30% (risky); tex already at min here
  const base = { sample_count: 32, tex_resolution: 1024, layer_count: 3, foliage_density: 1.65, chromatic_aberration: 0 };
  const costs = { sample_count: 0.19, layer_count: 0.02, foliage_density: 0.30 };
  const v = proposeVariants(base, costs);
  expect(v.map(x => x.name)).toEqual(["lite", "min"]);             // two DISTINCT rungs — no padded duplicate "medium"
  expect(v[0].applied.map(s => s.key)).toEqual(["sample_count"]);  // lite = just samples
  expect(v[1].applied.map(s => s.key).sort()).toEqual(["foliage_density", "sample_count"]);
  for (const x of v) expect(x.applied.some(s => s.key === "layer_count")).toBe(false);   // the 2% cut is never proposed
});

test("a single worthwhile cut yields one variant, not three identical ones", () => {
  const base = { sample_count: 32, tex_resolution: 1024, layer_count: 2, foliage_density: 0.5, chromatic_aberration: 0 };
  const costs = { sample_count: 0.19 };   // only samples is both cuttable and worthwhile
  const v = proposeVariants(base, costs);
  expect(v.length).toBe(1);
  expect(v[0].name).toBe("lite");
  expect(v[0].applied.map(s => s.key)).toEqual(["sample_count"]);
});
