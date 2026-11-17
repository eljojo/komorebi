// ============================================================================
// The spring half: leaf-out (komorebi-math.js leafSpring, springTau; komorebi-grove.js; spec model/season.md "Leaf-out"). What must hold: each leaf grows from
// nothing to its full size and greens from the young depth, on its own day, and the last is full-grown at leaf_out_end; the gate (leaf_out_end 0, or a phenology
// past the spring) is the summer leaf to the bit; the spring closes before the turn; the emergence stream is its own; a bare grove at bud break.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { DEFAULTS, GRANDFATHERED, PARAMS, SEASON_KEYS } from "./komorebi-params.js";
import { PRESETS } from "./presets.js";
import { SPRING_SALT, TAU_ANTHOCYANIN, leafSpring, springShape, springTau, springing } from "./komorebi-math.js";
import { makeGrove } from "./komorebi-grove.js";

const P = { ...DEFAULTS };
function grow(over) {
  const gl = new Proxy({}, { get(t, name) {
    if (typeof name !== "string") return undefined;
    return (...a) => { if (name === "createBuffer") return { data: null }; if (name === "bindBuffer") { t.cur = a[1]; return undefined; } if (name === "bufferData") { if (t.cur) t.cur.data = a[1]; return undefined; } return {}; };
  } });
  const params = { ...DEFAULTS, ...PRESETS["park 1"], ...over };
  return makeGrove({ gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => true, occ: {}, faith: {}, sky: { start: [], count: [] } }).growGrove(null, {});
}

test("one leaf: its length grows from nothing to full over leaf_out_span from its own day, it greens over leaf_green_span, and the last leaf is full-grown at leaf_out_end", () => {
  const out = [0, 0], sh = springShape(P, new Float64Array(5));
  for (const psi of [0, 0.3, 0.999]) {
    let prev = [-1, -1];
    for (let i = 0; i <= 400; i++) {
      const p = i / 400 * 0.3; leafSpring({ ...P, phenology: p }, psi, out);
      expect(out[0]).toBeGreaterThanOrEqual(prev[0]); expect(out[1]).toBeGreaterThanOrEqual(prev[1]);   // monotone
      prev = [...out];
    }
  }
  leafSpring({ ...P, phenology: P.leaf_out_end }, 1, out); expect(out[0]).toBe(1);                    // the last leaf (ψ → 1) is full-grown at leaf_out_end
  leafSpring({ ...P, phenology: P.leaf_out_end - P.leaf_out_span - P.leaf_out_spread }, 0, out); expect(out[0]).toBe(0);   // the first is just breaking
  expect(sh[0]).toBe(0.14); expect(sh[4]).toBeCloseTo(0.14 + 0.17 - 0.09, 12);                       // the spring closes once the last leaf is green
});

test("the gate: leaf_out_end 0, or a phenology past the spring, is no spring at all; the summer leaf's own numbers come back", () => {
  for (const ph of [0, 0.05, 0.15, 0.3, 0.5, 0.9]) expect(springing({ ...P, leaf_out_end: 0, phenology: ph })).toBe(false);
  expect(springing({ ...P, phenology: 0.5 })).toBe(false); expect(springing({ ...P, phenology: 0.1 })).toBe(true);
  const tau = [1.3, 1.0, 6.9];
  expect(springTau(tau, P, 1, 0.5)).toEqual(tau);
  const young = springTau(tau, P, 0, 0.5);
  for (let c = 0; c < 3; c++) expect(young[c]).toBeCloseTo(P.young_depth * tau[c], 12);   // a new leaf: the summer leaf at young_depth of its depth, no red by default
  const red = springTau(tau, { ...P, young_red: 0.4 }, 0, 0.5);
  for (let c = 0; c < 3; c++) expect(red[c]).toBeCloseTo(P.young_depth * tau[c] + 0.4 * TAU_ANTHOCYANIN[c], 12);
});

test("the spring closes before the turn can open, however it is set", () => {
  const Q = { ...P, leaf_out_end: 0.5, leaf_green_span: 0.4, leaf_out_span: 0.1, turn_start: 0.6, tree_clock_spread: 0.1 };
  const sh = springShape(Q, new Float64Array(5));
  expect(sh[4]).toBeLessThanOrEqual(0.5 + 1e-12);   // the earliest tree's turn opens at 0.6 − 0.1
  expect(springing({ ...Q, phenology: 0.51 })).toBe(false);
});

test("it ships on, a look from before it keeps 0, and its six keys are season keys", () => {
  expect(DEFAULTS.leaf_out_end).toBe(0.14); expect(GRANDFATHERED.leaf_out_end).toBe(0);
  for (const k of ["leaf_out_end", "leaf_out_span", "leaf_out_spread", "leaf_green_span", "young_depth", "young_red"]) { expect(SEASON_KEYS, k).toContain(k); expect(PARAMS[k].row.rebuild, k).toBe("season"); }
});

test("a grove at bud break is bare; leafing out its leaves are fewer and smaller; past the spring it is the summer grove to the bit", () => {
  const summer = grow({ phenology: 0.5 }), off = grow({ phenology: 0.5, leaf_out_end: 0 }), bare = grow({ phenology: 0 }), mid = grow({ phenology: 0.03 });   // the buds break from 0 to 0.05 (span + spread under leaf_out_end)
  expect(Array.from(summer.faithArr)).toEqual(Array.from(off.faithArr));
  const n = (g) => g.faithArr.length / 18, area = (g) => { let s = 0; for (let i = 0; i < g.faithArr.length; i += 18) s += g.faithArr[i + 2] * g.faithArr[i + 3]; return s; };
  expect(n(bare)).toBe(0);
  expect(n(mid)).toBeGreaterThan(0); expect(n(mid)).toBeLessThan(n(summer));
  expect(area(mid) / n(mid)).toBeLessThan(area(summer) / n(summer));   // the leaves out are still growing
});

test("the emergence stream's salt is 7·0x9E3779B9 mod 2^32 and no other stream's", () => {
  expect(SPRING_SALT).toBe((7 * 0x9E3779B9) % 2 ** 32);
  const src = readdirSync(new URL(".", import.meta.url)).filter((f) => /^komorebi.*\.js$/.test(f)).map((f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8")).join("\n");
  const all = [...src.matchAll(/_SALT\s*=\s*(0x[0-9A-Fa-f]+)/g)].map((m) => Number(m[1]));
  expect(all.filter((v) => v === SPRING_SALT)).toHaveLength(1);
});
