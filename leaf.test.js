// ============================================================================
// Per-leaf pigment state (spec §4.5, autumn senescence): the pure laws in komorebi-math.js and the one place
// the grove applies them. The claims worth holding loudly are the ones that would otherwise fail SILENTLY:
// a summer look that drifts by a ulp, a per-leaf hash that eats the growth RNG and reshuffles every shipped
// grove, a sieve law that stops being a mean of transmittances. (The macros.test.js pattern: data + laws.)
// ============================================================================
import { test, expect } from "bun:test";
import { DEFAULTS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import { makeGrove } from "./komorebi-grove.js";

const tauOf = (p) => [-Math.log(p.trans_r), -Math.log(p.trans_g), -Math.log(p.trans_b)];
const TAU_SUMMER = tauOf(DEFAULTS);
const fall = (over) => ({ ...DEFAULTS, ...over });                 // a look, merged over the defaults like a preset
const LEAVES = Array.from({ length: 400 }, (_, i) => [Math.floor(i / 20), i % 20]);   // (cluster, leaf) pairs

test("at the default phenology a leaf keeps its authored summer tau, exactly", () => {
  // 0.5 is summer: turn_start (0.6) is above it, so no leaf has begun to turn. Exactness is the point — a
  // look whose leaves moved by a ulp would move every pixel hash, so equality is bit-for-bit, not a tolerance.
  expect(DEFAULTS.phenology).toBe(0.5);
  for (const [j, k] of LEAVES.slice(0, 40)) {
    expect(Array.from(math.leafTau(TAU_SUMMER, DEFAULTS, 1234, j, k))).toEqual(TAU_SUMMER);
    // the sieve tier and both pigments armed: still summer, because s_j = 0 makes wall and cell the same tissue
    const armed = fall({ anthocyanin: 1, tannin: 1, wall_fraction: 0.4 });
    expect(Array.from(math.leafTau(TAU_SUMMER, armed, 1234, j, k))).toEqual(TAU_SUMMER);
  }
});

test("not-yet-turning stays exact for ANY authored tau and any vein share, not just the default look's", () => {
  // -ln(f*e^-x + (1-f)*e^-x) is x only up to a rounding error that depends on x, so a handful of looks proves
  // little: sweep the whole authored range (trans 1e-4..0.999) against several shares.
  const armed = (fw) => fall({ anthocyanin: 1, tannin: 1, wall_fraction: fw, phenology: 0.6 });   // 0.6 = turn_start: every s_j is 0
  let n = 0;
  for (let i = 0; i < 300; i++) {
    const tau = [0.01 + i * 0.0317, 9 - i * 0.0291, 0.5 + ((i * 7919) % 1000) / 123.4];
    for (const fw of [0.1, 0.37, 0.8, 1]) { expect(Array.from(math.leafTau(tau, armed(fw), 9, i, i % 7))).toEqual(tau); n++; }
  }
  expect(n).toBe(1200);
});

test("a leaf's turn fraction s_j is non-decreasing in phenology from turn_start to 1", () => {
  for (const phi of [0, 0.13, 0.5, 0.87, 0.999]) {
    let prev = -1;
    for (let ph = 0.6; ph <= 1.0000001; ph += 0.01) {
      const s = math.senescence(fall({ phenology: ph }), phi);
      expect(s >= prev, `phi ${phi}: s fell from ${prev} to ${s} at phenology ${ph.toFixed(2)}`).toBe(true);
      prev = s;
    }
    expect(prev).toBe(1);                                          // leaf-off end: every leaf has finished turning
    expect(math.senescence(fall({ phenology: 0.6 }), phi)).toBe(0);   // and none has started at turn_start
  }
});

test("the spread is real: at mid-turn some leaves have turned and some have not", () => {
  const s = LEAVES.map(([j, k]) => math.senescence(fall({ phenology: 0.72 }), (j * 20 + k) / 400));
  expect(Math.min(...s)).toBe(0);
  expect(Math.max(...s)).toBeGreaterThan(0.2);
});

test("at phenology 1 with anthocyanin the green channel is deeper than summer's", () => {
  // anthocyanin absorbs green, and the chlorophyll that used to pass it is gone: the shade goes red, not green.
  const p = fall({ phenology: 1, anthocyanin: 0.8 });
  for (const [j, k] of LEAVES) {
    const t = math.leafTau(TAU_SUMMER, p, 1234, j, k);
    expect(t[1], `leaf ${j}/${k}`).toBeGreaterThan(TAU_SUMMER[1]);
    expect(t[0], `leaf ${j}/${k} red must still pass`).toBeLessThan(TAU_SUMMER[0]);
  }
});

test("deterministic per (seed, leaf), different across leaves and seeds", () => {
  const p = fall({ phenology: 1, anthocyanin: 0.8, tannin: 0.5 });
  const a = Array.from(math.leafTau(TAU_SUMMER, p, 77, 5, 3));
  expect(Array.from(math.leafTau(TAU_SUMMER, p, 77, 5, 3))).toEqual(a);
  expect(Array.from(math.leafTau(TAU_SUMMER, p, 78, 5, 3))).not.toEqual(a);
  const distinct = new Set(LEAVES.map(([j, k]) => math.leafTau(TAU_SUMMER, p, 77, j, k)[1]));
  expect(distinct.size).toBeGreaterThan(300);
  // the photos' ~3:1 range in red depth across one tree: a_j = anthocyanin*(0.5 + h_j), h_j in [0,1)
  const dep = LEAVES.map(([j, k]) => math.leafTau(TAU_SUMMER, fall({ phenology: 1, anthocyanin: 1 }), 77, j, k)[1] - math.TAU_CAROTENOID[1]);
  const ratio = Math.max(...dep) / Math.min(...dep);
  expect(ratio).toBeGreaterThan(2.5);
  expect(ratio).toBeLessThan(3.0001);
});

test("mixtureTau with no vein share is the cell, exactly", () => {
  const cell = [0.1234567890123, 1.9183745261903726, 3.456789012345679], wall = [0.05, 0.4, 2.2];
  expect(Array.from(math.mixtureTau(wall, cell, 0))).toEqual(cell);
});

test("a vein share lets more green through, monotonically, when the wall is the clearer tissue", () => {
  const wall = [0.4, 0.65, 2.8], cell = [0.5, 3.05, 3.4];          // veins: no anthocyanin → clearer in green
  let prev = -1;
  for (let fw = 0; fw <= 1.0000001; fw += 0.1) {
    const T = Math.exp(-math.mixtureTau(wall, cell, fw)[1]);
    expect(T > prev, `T_g did not rise at f_w=${fw.toFixed(1)}`).toBe(true);
    prev = T;
  }
  expect(Math.exp(-math.mixtureTau(wall, cell, 1)[1])).toBeCloseTo(Math.exp(-wall[1]), 12);
});

test("Jensen: the mixture is never deeper than the mean of its tau (the sieve effect)", () => {
  for (const fw of [0.05, 0.2, 0.5, 0.9])
    for (const wall of [[0.3, 0.6, 2.5], [0.1, 1.9, 3.0], [1, 1, 1]])
      for (const cell of [[0.5, 3.0, 3.5], [2, 0.2, 0.2], [1, 1, 1]]) {
        const t = math.mixtureTau(wall, cell, fw);
        for (let c = 0; c < 3; c++) {
          const mean = fw * wall[c] + (1 - fw) * cell[c];
          expect(t[c], `fw ${fw} ch ${c}`).toBeLessThanOrEqual(mean + 1e-12);
          if (Math.abs(wall[c] - cell[c]) > 0.5) expect(t[c]).toBeLessThan(mean);   // strict wherever the tissues actually differ
        }
      }
});

test("the pigment basis keeps its physical ordering (constants are PROVISIONAL, the ordering is not)", () => {
  const [car, ant, brn] = [math.TAU_CAROTENOID, math.TAU_ANTHOCYANIN, math.TAU_TANNIN];
  expect(car[2] > car[1] && car[2] > car[0]).toBe(true);            // carotenoid absorbs blue; red and green pass
  expect(ant[1] > ant[0] && ant[1] > ant[2]).toBe(true);            // anthocyanin absorbs green
  expect(brn[2] > brn[1] && brn[1] > brn[0]).toBe(true);            // tannin: broad, warm-leaning
  // a maple at leaf-off with anthocyanin 0.8 transmits red-orange: R above G above B, G down to a fraction of R
  const T = math.leafTau(TAU_SUMMER, fall({ phenology: 1, anthocyanin: 0.8 }), 1234, 0, 0).map((t) => Math.exp(-t));
  expect(T[0] > T[1] && T[1] > T[2]).toBe(true);
  expect(T[1] / T[0]).toBeLessThan(0.3);
});

// ---- the grove: one place applies the laws, and must not touch the growth RNG ------------------------------
// buildGrove allocates GL buffers; a recording stub is enough to read the exact floats it uploads.
function growWith(over, faithful = false) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});                                           // every other GL call (and constant) is inert
    },
  });
  const params = fall({ tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, ...over });
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  return { params, g, faith, layers: g.layerVAO.map((l) => Array.from(l.buf.data)), faithLeaves: Array.from(faith.buf.data) };
}
// float indices of tau in a leaf record: [c.xy,A,B0][angle,tilt,swingGain,swingPhase][tau.rgb,clusterId][orbit][iFade] (+ the faithful record's height before the fade)
const isTau = (i, stride) => i % stride >= 8 && i % stride <= 10;
const sansTau = (arr, stride) => arr.filter((_, i) => !isTau(i, stride));
// index of the first float where two uploads disagree, -1 if they match to the bit — a failure that names a slot
// instead of dumping ten thousand floats
const firstDiff = (a, b) => (a.length !== b.length ? Math.min(a.length, b.length) : a.findIndex((v, i) => !Object.is(v, b[i])));

test("the pigment family at summer leaves the grove byte-identical to a look that never heard of it", () => {
  for (const faithful of [false, true]) {
    const bare = growWith({}, faithful);
    const armed = growWith({ phenology: 0.5, anthocyanin: 1, tannin: 1, turn_span: 0.3, wall_fraction: 0.3 }, faithful);
    for (const [i, l] of bare.layers.entries()) expect(firstDiff(armed.layers[i], l), `layer ${i}, faithful ${faithful}`).toBe(-1);
    expect(firstDiff(armed.faithLeaves, bare.faithLeaves)).toBe(-1);
  }
});

test("the per-leaf hashes never touch the growth RNG: geometry is identical at any phenology", () => {
  for (const faithful of [false, true]) {
    const summer = growWith({ phenology: 0.5, anthocyanin: 0.8, tannin: 0.4, wall_fraction: 0.2 }, faithful);
    const autumn = growWith({ phenology: 1, anthocyanin: 0.8, tannin: 0.4, wall_fraction: 0.2 }, faithful);
    // skeleton and twigs come off the growth stream; positions, sizes, tilts, orbits off each leaf's own streams
    expect(JSON.stringify(autumn.g.hier.segments)).toBe(JSON.stringify(summer.g.hier.segments));
    expect(JSON.stringify(autumn.g.hier.twigs)).toBe(JSON.stringify(summer.g.hier.twigs));
    for (const [i, l] of summer.layers.entries()) expect(firstDiff(sansTau(autumn.layers[i], 17), sansTau(l, 17)), `layer ${i}`).toBe(-1);
    expect(firstDiff(sansTau(autumn.faithLeaves, 18), sansTau(summer.faithLeaves, 18))).toBe(-1);
    // ...and it is not vacuous: the tau slots themselves did move
    expect(firstDiff(autumn.faithLeaves, summer.faithLeaves)).toBeGreaterThanOrEqual(0);
  }
});

test("the grove writes leafTau times the leaf's own coverage, into both the layer and faithful buffers", () => {
  const { params, faithLeaves, layers } = growWith({ phenology: 0.85, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2 });
  const tau = tauOf(params), nLeaf = 8, frac = 0.5;                  // 5 × 1.5 = 7.5 leaves per twig: seven whole, one half
  let checked = 0, half = 0;
  for (let i = 0; i + 17 < faithLeaves.length; i += 18) {
    const j = faithLeaves[i + 11], k = (i / 18) % nLeaf, cov = k === 7 ? frac : 1;
    const want = math.leafTau(tau, params, params.seed, j, k);
    for (let c = 0; c < 3; c++) expect(faithLeaves[i + 8 + c]).toBe(Math.fround(want[c] * cov));
    checked++; if (cov < 1) half++;
  }
  expect(checked).toBeGreaterThan(100);
  expect(half).toBeGreaterThan(10);
  expect(layers.flat().length / 17).toBe(checked);                   // the layer buffers carry the same leaves
});
