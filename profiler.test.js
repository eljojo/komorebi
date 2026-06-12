// Tests for profiler.js — the pure auto-profiler logic. Run: `bun test profiler.test.js`.
import { test, expect } from "bun:test";
import { AXES, axisValue, proposeVariants } from "./profiler.js";

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
  // every axis has a label, a class, and a valid affected pass
  for (const a of AXES) {
    expect(typeof a.label).toBe("string");
    expect(["safe", "risky", "style"]).toContain(a.cls);
    expect(["transport", "bake", "both"]).toContain(a.pass);
  }
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
