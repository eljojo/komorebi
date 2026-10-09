// ============================================================================
// Abscission (spec §4.5, P3a): a leaf lets go on its own day, the sunlit ones first, and a marcescent share (beech)
// never does within the season. The claims worth holding loudly are the ones that fail SILENTLY: a gate that leaks
// arithmetic into a summer look, a drop day drawn from a stream that reshuffles every shipped grove, a leaf that
// pops out instead of fading (§5.3), two buffers that disagree about who is left, an exposure that forgot the
// leaves already gone. (The exposure.test.js pattern: pure laws, then the one place that applies them.)
// ============================================================================
import { test, expect } from "bun:test";
import { CANOPY_KEYS, DEFAULTS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import { makeEditorTools } from "./komorebi-editor-tools.js";
import { makeGrove } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";

const fall = (over) => ({ ...DEFAULTS, ...over });
const tauOf = (p) => [-Math.log(p.trans_r), -Math.log(p.trans_g), -Math.log(p.trans_b)];
const { DROP_EPS: EPS } = math;

// ---- the pure laws --------------------------------------------------------------------------------------------
test("the family ships off: leaf_drop 0 is the gate, and all four are canopy knobs (they morph the same grove)", () => {
  expect(DEFAULTS.leaf_drop).toBe(0);
  expect(DEFAULTS.drop_start).toBe(0.7);
  expect(DEFAULTS.drop_span).toBe(0.3);
  expect(DEFAULTS.drop_exposure).toBe(1);
  for (const k of ["leaf_drop", "drop_start", "drop_span", "drop_exposure"]) expect(CANOPY_KEYS, k).toContain(k);
  expect(EPS).toBe(0.01);
});

test("dropHash: a pure function of (seed, cluster, leaf) in [0,1), uniform, and nobody else's stream", () => {
  const cells = Array.from({ length: 2000 }, (_, i) => [Math.floor(i / 25), i % 25]);
  const h = cells.map(([j, k]) => math.dropHash(77, j, k));
  for (let i = 0; i < 2000; i++) {
    expect(h[i] >= 0 && h[i] < 1).toBe(true);
    expect(math.dropHash(77, ...cells[i])).toBe(h[i]);                      // pure: same address, same number
  }
  expect(math.dropHash(78, 5, 3)).not.toBe(math.dropHash(77, 5, 3));       // the seed is in it
  expect(new Set(h).size).toBe(2000);                                       // and so is each leaf
  const mean = h.reduce((s, v) => s + v, 0) / h.length;
  expect(Math.abs(mean - 0.5)).toBeLessThan(0.03);                          // uniform: ~4σ of the mean of 2000 draws
  const deciles = new Array(10).fill(0);
  for (const v of h) deciles[Math.floor(v * 10)]++;
  for (const c of deciles) expect(Math.abs(c - 200)).toBeLessThan(50);
  // its own stream: uncorrelated with the arrangement stream (hash3(seed, j, 101)) and the wind-identity one that the growth
  // loop draws from, and with the leaf's own pigment draw — a salt that merely shifted one of those would show here
  const corr = (u, v) => {
    const n = u.length, mu = u.reduce((s, x) => s + x, 0) / n, mv = v.reduce((s, x) => s + x, 0) / n;
    let suv = 0, suu = 0, svv = 0;
    for (let i = 0; i < n; i++) { suv += (u[i] - mu) * (v[i] - mv); suu += (u[i] - mu) ** 2; svv += (v[i] - mv) ** 2; }
    return suv / Math.sqrt(suu * svv);
  };
  const arr = cells.map(([j]) => math.mulberry32(math.hash3(77, j, 101))());
  const wind = cells.map(([j]) => math.mulberry32(math.hash3(77 ^ 0x5bd1e995, j, 101))());
  const growth = math.mulberry32(math.hash3(77, 0x5EED, 7)), gro = cells.map(() => growth());
  const pig = cells.map(([j, k]) => math.mulberry32(math.hash3(77 ^ 0x51ED270B, j, k))());   // P0's leaf stream (salt frozen here: it must never be this one)
  for (const [name, v] of Object.entries({ arr, wind, gro, pig })) expect(Math.abs(corr(h, v)), name).toBeLessThan(0.1);
});

test("dropPhase: mix(hash, 1 − u, drop_exposure) — the hash itself at 0, the exposed-first order at 1", () => {
  for (const [hsh, u] of [[0.13, 0.9], [0.77, 0.02], [0.5, 1], [0.999, 0.5]]) {
    expect(Object.is(math.dropPhase(hsh, u, 0), hsh)).toBe(true);           // no arithmetic: the hash to the bit
    expect(math.dropPhase(hsh, u, 1)).toBe(math.turnOrder(u));              // the same 1 − u the turn uses, clamped under 1
    const mid = math.dropPhase(hsh, u, 0.5);
    expect(mid).toBeGreaterThanOrEqual(Math.min(hsh, 1 - u) - 1e-12);
    expect(mid).toBeLessThanOrEqual(Math.max(hsh, 1 - u) + 1e-12);
  }
  for (const w of [0.3, 1]) {                                               // exposed first: a brighter leaf never gets a LATER phase
    let prev = Infinity;
    for (let i = 1; i <= 20; i++) { const phi = math.dropPhase(0.4, i / 20, w); expect(phi <= prev).toBe(true); expect(phi >= 0 && phi < 1).toBe(true); prev = phi; }
  }
  expect(math.dropPhase(0.4, 0, 1)).toBeLessThan(1);                        // a leaf with no light at all still has a day
});

test("dropDay: drop_start + drop_span·φ/leaf_drop below leaf_drop, never at or above it", () => {
  const P = fall({ leaf_drop: 0.6, drop_start: 0.7, drop_span: 0.3 });
  for (const phi of [0, 0.1, 0.3, 0.59]) expect(math.dropDay(P, phi)).toBeCloseTo(0.7 + 0.3 * phi / 0.6, 12);
  expect(math.dropDay(P, 0)).toBe(0.7);                                     // the first leaf goes at drop_start, the last of the dropping share at start + span
  expect(math.dropDay(P, 0.6)).toBe(Infinity);                              // the retention floor 1 − leaf_drop: the marcescent tail
  expect(math.dropDay(P, 0.99)).toBe(Infinity);
  expect(math.dropDay(fall({ leaf_drop: 0 }), 0)).toBe(Infinity);           // the gate: nothing ever drops
  expect(math.dropDay(fall({ leaf_drop: 1 }), 0.999999)).toBeLessThan(1);   // leaf_drop 1: every leaf has a day, inside the span
  let prev = -1;
  for (let i = 0; i < 60; i++) { const D = math.dropDay(P, i / 100); expect(D >= prev).toBe(true); prev = D; }
});

test("retention: exactly 1 until a leaf's fade begins, w(D − ε) = 1, w(D) = 0, continuous, never rises", () => {
  for (const D of [0.7, 0.7123, 0.85, 0.999, 1]) {
    for (let p = 0; p <= D - EPS + 1e-12; p += 0.013) expect(Object.is(math.retention(D, p), 1), `D ${D} p ${p}`).toBe(true);
    expect(Object.is(math.retention(D, D - EPS), 1)).toBe(true);
    expect(math.retention(D, D)).toBe(0);
    expect(math.retention(D, D + 0.5)).toBe(0);
    let prev = 1, worst = 0;
    const dp = 1e-4;
    for (let p = D - 2 * EPS; p <= D + EPS; p += dp) {
      const w = math.retention(D, p);
      expect(w >= 0 && w <= 1).toBe(true);
      expect(w <= prev + 1e-15, `w rose at p ${p}`).toBe(true);
      worst = Math.max(worst, Math.abs(w - prev)); prev = w;
    }
    expect(worst).toBeLessThan(1.5 / EPS * dp * 1.001);                     // smoothstep's steepest slope is 1.5/ε: no step anywhere
  }
  for (const p of [0, 0.5, 1, 7]) expect(Object.is(math.retention(Infinity, p), 1)).toBe(true);   // a leaf that never drops never feels it
  expect(math.retention(0.8, 0.8 - EPS / 2)).toBeCloseTo(0.5, 12);          // the fade is a smoothstep: half way at the middle
});

// ---- the grove: one place applies the laws, and must not touch the growth RNG ------------------------------------
function growWith(over, faithful = false) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = fall({ tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, ...over });
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  return { params, g, faith, litter: g.litter, layers: g.layerVAO.map((l) => Array.from(l.buf.data)), faithLeaves: Array.from(faith.buf.data) };
}
const memo = new Map();
const grow = (over, faithful = false) => {   // the dense groves cost a moment: build each once
  const key = JSON.stringify([over, faithful]);
  if (!memo.has(key)) memo.set(key, growWith(over, faithful));
  return memo.get(key);
};
const SF = 18, SL = 17;   // faithful record: [x,y,A,B0, angle,tilt,swingGain,swingPhase, tau.rgb,cluster, orbit×4, z, fade]; layer: the same 16 floats, then the fade
const firstDiff = (a, b) => (a.length !== b.length ? Math.min(a.length, b.length) : a.findIndex((v, i) => !Object.is(v, b[i])));
// a grove with a crown worth shading itself (exposure.test.js's), whole leaves only
const dense = (over) => ({ ...PRESETS["afternoon 7"], leaves_per_cluster: 40, foliage_density: 1, tree_count: 3, ...over });
// the small default grove, which carries marginal leaves (7.5 a twig: the eighth is half a leaf) — the fade in the records is worth checking on
const small = (over) => ({ ...PRESETS["afternoon 7"], tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, ...over });
const DS = 0.7, SPAN = 0.3;
// every leaf of a grove that has NOT dropped any: its address (j, k — k is its place in its twig, which the grove pushes in order)
function leavesOf(faithLeaves) {
  const L = [], slot = new Map();
  for (let i = 0; i + SF <= faithLeaves.length; i += SF) {
    const j = faithLeaves[i + 11], k = slot.get(j) ?? 0;
    slot.set(j, k + 1);
    L.push({ i, j, k, key: `${j}/${k}`, x: faithLeaves[i], y: faithLeaves[i + 1], z: faithLeaves[i + 16], fade: faithLeaves[i + 17] });
  }
  return L;
}
// each leaf's own drop phase, read off a grove that lets ALL of them go: at leaf_drop 1 and leaf-off, D = drop_start + drop_span·φ.
// (The grove's own number, not a recomputation: recomputing exposure from the float32 buffer re-ranks a few dozen leaves in ten thousand.)
function phasesOf(over, faithful = false) {
  const { litter, params } = grow({ ...over, leaf_drop: 1, phenology: 1 }, faithful);
  const m = new Map();
  for (const l of litter) m.set(`${l.j}/${l.k}`, (l.D - params.drop_start) / params.drop_span);
  return m;
}
// who is still hanging at (leaf_drop L, phenology p), and by how much: the laws applied to those phases
const weightsAt = (leaves, phases, P, L, p) => leaves.map((l) => {
  const phi = phases.get(l.key);
  const D = phi < L ? P.drop_start + P.drop_span * phi / L : Infinity;
  return math.retention(D, p);
});

test("below the first fade the grove is P1's to the bit: phenology ≤ drop_start − ε, whatever leaf_drop says", () => {
  const p = DS - EPS;
  for (const faithful of [false, true]) {
    const off = grow(dense({ phenology: p, leaf_drop: 0 }), faithful), on = grow(dense({ phenology: p, leaf_drop: 1 }), faithful);
    for (const [i, l] of off.layers.entries()) expect(firstDiff(on.layers[i], l), `layer ${i}, faithful ${faithful}`).toBe(-1);
    expect(firstDiff(on.faithLeaves, off.faithLeaves)).toBe(-1);
    expect(on.litter, "no list below the first fade").toBeNull();
    expect(on.g.hier.leafW).toBeNull();
  }
});

// P1b's buffers (7dfadf0), frozen as FNV digests over every float of the layer buffers and the faithful one, at three seasons.
// Frozen, not recomputed: the claim is "the same bytes as before this change existed". The drop family is armed — it must be dead code.
const fnv = (arrs) => {
  let h = 0x811c9dc5;
  for (const a of arrs) {
    const f = Float32Array.from(a), u = new Uint32Array(f.buffer);
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193) >>> 0;
    h = Math.imul(h ^ f.length, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};
const BASE = { ...PRESETS["afternoon 7"], tree_count: 2, leaves_per_cluster: 6, foliage_density: 1.3, layer_count: 3 };
const PIG = { phenology: 0.95, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2 };
const FROZEN = {
  "summer/layer": "8913d117", "summer/faith": "dad14bc3",
  "pigment/layer": "610ecb09", "pigment/faith": "487265f1",
  // lit/* re-recorded when the tie-break landed (exposureRank's key): the fully lit shell is ordered by each leaf's own clock, not stacked on one mid-rank. summer/* and pigment/* did not move.
  "lit/layer": "c26ff213", "lit/faith": "1ef35281",
};
test("leaf_drop 0 is P1 to the bit — summer, fall, and fall with sun first — with the rest of the family armed", () => {
  const armed = { drop_start: 0.5, drop_span: 0.1, drop_exposure: 1, leaf_drop: 0 };
  const cfgs = { summer: { ...BASE }, pigment: { ...BASE, ...PIG }, lit: { ...BASE, ...PIG, turn_exposure: 1, exposure_absolute: 0.5 } };
  for (const [name, cfg] of Object.entries(cfgs)) for (const faithful of [false, true]) {
    const r = growWith({ ...cfg, ...armed }, faithful);
    expect(fnv([...r.layers, r.faithLeaves]), `${name}/${faithful ? "faith" : "layer"}`).toBe(FROZEN[`${name}/${faithful ? "faith" : "layer"}`]);
    expect(r.litter, "no list at the gate").toBeNull();
    expect(r.g.hier.leafW).toBeNull();
  }
});
test("…and the digests are not vacuous: leaf_drop 1 in leaf-off moves them", () => {
  const r = growWith({ ...BASE, ...PIG, leaf_drop: 1 }, true);
  expect(fnv([...r.layers, r.faithLeaves])).not.toBe(FROZEN["pigment/faith"]);
});

test("the share still hanging: 1 up to drop_start, never rises with the season, and 1 − leaf_drop once the span is over", () => {
  const n = grow(dense({ phenology: 0.5 })).faithLeaves.length / SF;
  expect(n).toBeGreaterThan(5000);
  for (const L of [0.3, 0.5, 0.8]) {
    let prev = n, any = false;
    for (let p = 0.6; p <= 1.0000001; p += 0.05) {
      const c = grow(dense({ phenology: p, leaf_drop: L, drop_exposure: 1 })).faithLeaves.length / SF;
      expect(c <= prev, `leaf_drop ${L}: the count rose from ${prev} to ${c} at phenology ${p.toFixed(2)}`).toBe(true);
      if (p <= DS + 1e-9) expect(c, `nothing has let go by drop_start (phenology ${p.toFixed(2)})`).toBe(n);
      if (c < n) any = true;
      prev = c;
    }
    expect(any, "not vacuous: leaves did go").toBe(true);
    // the share at the end of the span: the rank is uniform, so the drop phases are evenly spread and 1 − leaf_drop is held to within a leaf.
    // (Leaves of EQUAL exposure used to share a rank and so a day — the fully lit crown top is a tenth of this grove — and a cut inside
    // that group would have taken all of it or none; the leaf's own clock now breaks the tie, and the precondition is asserted: no day is shared.)
    const phases = [...phasesOf(dense({ phenology: 0.5 })).values()];
    const ties = new Map(); for (const v of phases) ties.set(v, (ties.get(v) ?? 0) + 1);
    expect([...ties].filter(([, c]) => c > 1), `no day shared by more than one leaf (leaf_drop ${L})`).toEqual([]);
    const end = grow(dense({ phenology: DS + SPAN, leaf_drop: L, drop_exposure: 1 })).faithLeaves.length / SF;
    expect(Math.abs(end / n - (1 - L)), `leaf_drop ${L}: ${end}/${n} retained`).toBeLessThanOrEqual(1 / n + 1e-12);
  }
  // exposure off: the hash is uniform, so the share is leaf_drop to within sampling noise (4σ of a binomial) — and it is exactly leaf_drop at the ends
  for (const L of [0.3, 0.5, 0.8]) {
    const end = grow(dense({ phenology: DS + SPAN, leaf_drop: L, drop_exposure: 0 })).faithLeaves.length / SF;
    expect(Math.abs(end / n - (1 - L))).toBeLessThan(4 * Math.sqrt(L * (1 - L) / n));
  }
  expect(grow(dense({ phenology: 1, leaf_drop: 1, drop_exposure: 0.4 })).faithLeaves.length, "leaf_drop 1: every leaf has a day").toBe(0);
});

test("a bare canopy is two empty buffers, a count of zero — and every leaf in the litter", () => {
  const r = grow(small({ phenology: 1, leaf_drop: 1 }), true), full = grow(small({ phenology: 1, leaf_drop: 0 }), true);
  expect(r.faithLeaves.length).toBe(0);
  expect(r.layers.every((l) => l.length === 0)).toBe(true);
  expect(r.g.layerVAO.every((L) => L.count === 0)).toBe(true);
  expect(r.faith.count).toBe(0);
  expect(r.litter).toHaveLength(full.faithLeaves.length / SF);
});

test("exposed first: at drop_exposure 1 the leaves that let go are the lit ones; at 0, light has no say", () => {
  const full = grow(dense({ phenology: 0.5 }), true), leaves = leavesOf(full.faithLeaves);
  const n = leaves.length;
  // the grid, from the buffer: float32 positions re-rank a few dozen leaves in ten thousand, which a MEAN comparison does not feel
  const ex = math.exposureGrid(leaves.map((l) => l.x), leaves.map((l) => l.y), leaves.map((l) => l.z), leaves.map((l) => Math.PI * full.faithLeaves[l.i + 2] * full.faithLeaves[l.i + 3] * l.fade), full.params.canopy_extent_m);
  const u = math.exposureRank(ex);
  const gap = (over) => {
    const phases = phasesOf({ ...dense({}), ...over }, true);
    const w = weightsAt(leaves, phases, full.params, 0.5, 0.9);
    let sd = 0, nd = 0, sr = 0, nr = 0;
    for (let i = 0; i < n; i++) { if (w[i] === 0) { sd += u[i]; nd++; } else { sr += u[i]; nr++; } }
    expect(nd, "some fell").toBeGreaterThan(100); expect(nr, "some stayed").toBeGreaterThan(100);
    return { gap: sd / nd - sr / nr, sigma: Math.sqrt((1 / 12) * (1 / nd + 1 / nr)) };
  };
  const on = gap({ drop_exposure: 1 });
  expect(on.gap, "mean exposure rank, fallen minus retained").toBeGreaterThan(0.3);
  const off = gap({ drop_exposure: 0 });
  expect(Math.abs(off.gap)).toBeLessThan(4 * off.sigma);
  const half = gap({ drop_exposure: 0.5 });
  expect(half.gap, "in between, in between").toBeGreaterThan(off.gap);
  expect(half.gap).toBeLessThan(on.gap);
});

test("turn_exposure 0 does not switch the light off: the grid still runs for drop_exposure, and the leaf colour is P0's", () => {
  const over = dense({ phenology: 0.9, anthocyanin: 0.8, tannin: 0.3, turn_exposure: 0, drop_exposure: 1, leaf_drop: 0.5 });
  const full = grow({ ...over, leaf_drop: 0 }, true), leaves = leavesOf(full.faithLeaves);
  const ex = math.exposureGrid(leaves.map((l) => l.x), leaves.map((l) => l.y), leaves.map((l) => l.z), leaves.map((l) => Math.PI * full.faithLeaves[l.i + 2] * full.faithLeaves[l.i + 3] * l.fade), full.params.canopy_extent_m);
  const u = math.exposureRank(ex);
  const phases = phasesOf({ ...over, leaf_drop: 1 }, true);
  const w = weightsAt(leaves, phases, full.params, 0.5, 0.9);
  let sd = 0, nd = 0, sr = 0, nr = 0;
  for (let i = 0; i < leaves.length; i++) { if (w[i] === 0) { sd += u[i]; nd++; } else { sr += u[i]; nr++; } }
  expect(sd / nd - sr / nr).toBeGreaterThan(0.3);
  // survivors that are not mid-fade carry P0's tau (no exposure in the colour), to the bit
  const r = grow(over, true), tau = tauOf(r.params), out = [0, 0, 0];
  let seen = 0, k = 0;
  for (let s = 0; s < leaves.length; s++) {
    if (!(w[s] > 0)) continue;
    const off = k++ * SF;
    if (w[s] !== 1) continue;
    const want = math.leafTau(tau, r.params, r.params.seed, leaves[s].j, leaves[s].k, out);
    for (let c = 0; c < 3; c++) expect(r.faithLeaves[off + 8 + c]).toBe(Math.fround(want[c] * leaves[s].fade));
    seen++;
  }
  expect(seen).toBeGreaterThan(1000);
  // and with both knobs at 0 nothing needs the light: no hash of it can matter, the drop is the hash alone
  const flat = phasesOf({ ...over, drop_exposure: 0 }, true);
  for (const l of leaves.slice(0, 300)) expect(flat.get(l.key)).toBeCloseTo(math.dropHash(r.params.seed, l.j, l.k), 12);
});

test("the drop day is the leaf's own: at drop_exposure 0 it is dropHash(seed, j, k), whatever the grove around it does", () => {
  for (const faithful of [false, true]) {
    const over = small({ phenology: 0.9, drop_exposure: 0 });
    const full = grow({ ...over, leaf_drop: 0 }, faithful), r = grow({ ...over, leaf_drop: 1 }, faithful);
    const phases = phasesOf(over, faithful);
    expect(phases.size).toBe(full.faithLeaves.length / SF);
    for (const l of leavesOf(full.faithLeaves)) expect(phases.get(l.key), l.key).toBeCloseTo(math.dropHash(r.params.seed, l.j, l.k), 12);
    // a different seed grows a different grove AND different days; the same seed two ways grows the same days
    const again = phasesOf(over, faithful);
    for (const [key, v] of phases) expect(again.get(key)).toBe(v);
  }
});

test("exposure is the season's: a leaf's day does not depend on the phenology it is read at, or on who has already gone", () => {
  const at = (p) => grow(dense({ phenology: p, leaf_drop: 0.6 }), true).litter;
  const early = at(0.85), late = at(0.95), end = at(1);
  expect(early.length).toBeGreaterThan(100);
  expect(late.length).toBeGreaterThan(early.length);
  const lateD = new Map(late.map((l) => [`${l.j}/${l.k}`, l.D])), endD = new Map(end.map((l) => [`${l.j}/${l.k}`, l.D]));
  for (const l of early) {
    expect(lateD.has(`${l.j}/${l.k}`), "once down, down for good").toBe(true);
    expect(Object.is(lateD.get(`${l.j}/${l.k}`), l.D), "the same day however the season is sampled").toBe(true);
    expect(Object.is(endD.get(`${l.j}/${l.k}`), l.D)).toBe(true);
    expect(l.D).toBeLessThanOrEqual(0.85);
  }
  for (const l of late) expect(l.D).toBeLessThanOrEqual(0.95);
});

// ---- TIES: the leaves nothing shades share an exposure of exactly 1 (the up-sun shell and the stand's top), and the rank used to give them
// one mid-rank — one drop day, one fade, a surface dimming as one. Each one's own turn clock now orders them over their slice of the order.
// The litter carries the grove's own doubles (x, y, h, the half-axes, the fade), so exposureGrid over them IS the grove's exposure, bit for bit,
// and the claims below can be exact.
const TIES = { phenology: 1, leaf_drop: 1, drop_exposure: 1, exposure_absolute: 0 };
const litterExposure = (r) => math.exposureGrid(
  Float64Array.from(r.litter, (l) => l.x), Float64Array.from(r.litter, (l) => l.y), Float64Array.from(r.litter, (l) => l.h),
  Float64Array.from(r.litter, (l) => Math.PI * l.size[0] * l.size[1] * l.fade), r.params.canopy_extent_m);

test("no two leaves share a day: at drop_exposure 1 the days are exactly drop_start + drop_span·(i + ½)/n — the shell spread, not stacked", () => {
  const r = grow(dense(TIES), true), n = r.litter.length;
  expect(n).toBeGreaterThan(10000);
  const days = r.litter.map((l) => l.D).sort((a, b) => a - b);
  let worst = 0, at = -1;
  for (let i = 0; i < n; i++) { const d = Math.abs(days[i] - (DS + SPAN * (i + 0.5) / n)); if (d > worst) { worst = d; at = i; } }
  expect(worst, `worst day ${at} of ${n}`).toBeLessThan(1e-9);
  expect(new Set(days).size, "every leaf its own day").toBe(n);
});

test("inside the sunlit shell the leaf that started turning first lets go first", () => {
  const r = grow(dense(TIES), true), ex = litterExposure(r);
  const shell = r.litter.filter((_, i) => ex[i] === 1).map((l) => ({ D: l.D, phi: math.leafClock(r.params.seed, l.j, l.k) })).sort((a, b) => a.phi - b.phi);
  expect(shell.length, "not vacuous: a real shell, a tenth of the grove").toBeGreaterThan(500);
  expect(new Set(shell.map((s) => s.phi)).size, "no two clocks collide").toBe(shell.length);
  for (let i = 1; i < shell.length; i++) expect(shell[i - 1].D < shell[i].D, `clock ${shell[i - 1].phi} (day ${shell[i - 1].D}) vs ${shell[i].phi} (day ${shell[i].D})`).toBe(true);
});

test("one u: the litter's colour is leafTau at the order its DAY implies — the turn and the drop read the same rank", () => {
  // phenology 1 has every leaf fully turned (only the red gain is read); 0.85 is mid-turn, so the turn ORDER is read too, on the half that has fallen by then
  for (const phenology of [1, 0.85]) {
    const r = grow(dense({ ...TIES, phenology, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, turn_exposure: 1 }), true), P = r.params, tau = tauOf(P), out = [0, 0, 0];
    expect(r.litter.length, `phenology ${phenology}`).toBeGreaterThan(phenology === 1 ? 10000 : 5000);
    let worst = 0;
    for (const l of r.litter) {
      const u = 1 - (l.D - P.drop_start) / P.drop_span, want = math.leafTau(tau, P, P.seed, l.j, l.k, out, math.turnOrder(u), math.redGain(u));
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(l.tau[c] - want[c]));
    }
    expect(worst, `phenology ${phenology}`).toBeLessThan(1e-9);
  }
});

test("between rank and raw light: at exposure_absolute 0.5 the days are still all different; at 1 the shell shares one — the named corner", () => {
  const half = grow(dense({ ...TIES, exposure_absolute: 0.5 }), true);
  expect(new Set(half.litter.map((l) => l.D)).size, "(1 − w) of the rank's spread survives").toBe(half.litter.length);
  // At 1 u IS the raw exposure, literally 1.0 for every leaf that nothing shades: there is no rank left to spread them by, and they go on
  // drop_start itself, together. Held as a fact, not fixed (a correction inside the rank cannot reach a blend that has dropped it).
  const one = grow(dense({ ...TIES, exposure_absolute: 1 }), true), ex = litterExposure(one);
  const shell = one.litter.filter((_, i) => ex[i] === 1);
  expect(shell.length, "not vacuous").toBeGreaterThan(500);
  for (const l of shell) expect(l.D, `${l.j}/${l.k}`).toBe(one.params.drop_start);
});

test("the drop never touches the growth RNG: skeleton, twigs, and every surviving leaf's place are the grove's own", () => {
  for (const faithful of [false, true]) {
    // at or below drop_start: the same grove, record for record, tau and all
    const lo0 = grow(dense({ phenology: DS, leaf_drop: 0 }), faithful), lo1 = grow(dense({ phenology: DS, leaf_drop: 1 }), faithful);
    expect(JSON.stringify(lo1.g.hier.segments)).toBe(JSON.stringify(lo0.g.hier.segments));
    expect(JSON.stringify(lo1.g.hier.twigs)).toBe(JSON.stringify(lo0.g.hier.twigs));
    expect(lo1.faithLeaves.length).toBe(lo0.faithLeaves.length);
    for (let i = 0; i < lo0.faithLeaves.length; i += SF) for (const c of [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16])
      expect(Object.is(lo1.faithLeaves[i + c], lo0.faithLeaves[i + c]), `record ${i / SF} slot ${c}`).toBe(true);
    // and at leaf-off, with most of them gone, the skeleton and twigs are still the same objects' contents
    const hi0 = grow(dense({ phenology: 1, leaf_drop: 0 }), faithful), hi1 = grow(dense({ phenology: 1, leaf_drop: 0.8 }), faithful);
    expect(JSON.stringify(hi1.g.hier.segments)).toBe(JSON.stringify(hi0.g.hier.segments));
    expect(JSON.stringify(hi1.g.hier.twigs)).toBe(JSON.stringify(hi0.g.hier.twigs));
    expect(hi1.faithLeaves.length).toBeLessThan(hi0.faithLeaves.length);
  }
});

test("compaction: Σ(w > 0) records on both buffers, the survivors are the grove's own leaves in order, and the two buffers agree leaf for leaf", () => {
  for (const [name, mk, L, p] of [["dense", dense, 0.7, 0.9], ["small (marginal leaves)", small, 0.8, 0.92]]) {
    for (const faithful of [false, true]) {
      const over = mk({ phenology: p, anthocyanin: 0.8, turn_exposure: 1 });
      const full = grow({ ...over, leaf_drop: 0 }, faithful), r = grow({ ...over, leaf_drop: L }, faithful);
      const leaves = leavesOf(full.faithLeaves), phases = phasesOf(over, faithful);
      const w = weightsAt(leaves, phases, full.params, L, p);
      const alive = [...leaves.keys()].filter((i) => w[i] > 0);
      expect(alive.length, `${name}: some fell, some did not`).toBeGreaterThan(10);
      expect(alive.length).toBeLessThan(leaves.length);
      expect(r.faithLeaves.length / SF, `${name}: faithful buffer`).toBe(alive.length);
      expect(r.layers.reduce((s, l) => s + l.length / SL, 0), `${name}: layer buffers`).toBe(alive.length);
      expect(r.faith.count).toBe(alive.length);
      expect(r.g.layerVAO.reduce((s, L2) => s + L2.count, 0)).toBe(alive.length);
      // the survivors, in order, untouched but for tau and the fade
      const twigLayer = (j) => full.g.hier.twigs[j].layer;
      const cursor = r.layers.map(() => 0);
      alive.forEach((s, n) => {
        const f = leaves[s], o = n * SF;
        for (const c of [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16]) expect(Object.is(r.faithLeaves[o + c], full.faithLeaves[f.i + c]), `${name}: leaf ${f.key} slot ${c}`).toBe(true);
        // …and the layer buffer holds the same leaf, bit for bit, in the same order
        const l = twigLayer(f.j), q = cursor[l]++ * SL;
        for (let c = 0; c < 16; c++) expect(Object.is(r.layers[l][q + c], r.faithLeaves[o + c]), `${name}: leaf ${f.key} layer slot ${c}`).toBe(true);
        expect(Object.is(r.layers[l][q + 16], r.faithLeaves[o + 17]), `${name}: leaf ${f.key} fade`).toBe(true);
      });
      for (const [l, c] of cursor.entries()) expect(r.layers[l].length / SL, `layer ${l} is exhausted`).toBe(c);
    }
  }
});

test("w multiplies the leaf's coverage: tau and the fade it rides on scale together, so the ballistic shadow fades with the leaf", () => {
  const over = small({ phenology: 0.855, anthocyanin: 0.8, tannin: 0.3, drop_exposure: 0 });   // mid-fade for the leaves whose day is just past (0.855 + ε/2)
  for (const faithful of [false, true]) {
    const full = grow({ ...over, leaf_drop: 0 }, faithful), r = grow({ ...over, leaf_drop: 1 }, faithful);
    const leaves = leavesOf(full.faithLeaves), phases = phasesOf(over, faithful), P = full.params, tau = tauOf(P);
    const w = weightsAt(leaves, phases, P, 1, over.phenology);
    const alive = [...leaves.keys()].filter((i) => w[i] > 0), fading = alive.filter((i) => w[i] < 1);
    expect(fading.length, "leaves are mid-fade at this phenology").toBeGreaterThan(10);
    const out = [0, 0, 0];
    alive.forEach((s, n) => {
      const f = leaves[s], o = n * SF, lt = math.leafTau(tau, P, P.seed, f.j, f.k, out), cf = f.fade * w[s];
      expect(r.faithLeaves[o + 17]).toBeCloseTo(cf, 6);                                     // the fade the bake writes into alpha
      for (let c = 0; c < 3; c++) expect(r.faithLeaves[o + 8 + c]).toBeCloseTo(lt[c] * cf, 5);   // the optical depth, scaled by the SAME factor
    });
    // a fading leaf is on the tree, not yet on the ground
    const litter = new Set(r.litter.map((l) => `${l.j}/${l.k}`));
    for (const s of fading) expect(litter.has(leaves[s].key), "mid-fade leaves are not litter yet").toBe(false);
  }
});

test("the litter: exactly the leaves with w = 0, each with what the next phase needs", () => {
  const over = small({ phenology: 0.9, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, turn_exposure: 1 });
  const L = 0.7, p = over.phenology;
  const full = grow({ ...over, leaf_drop: 0 }, true), r = grow({ ...over, leaf_drop: L }, true);
  const leaves = leavesOf(full.faithLeaves), phases = phasesOf(over, true), P = full.params;
  const w = weightsAt(leaves, phases, P, L, p);
  const dead = [...leaves.keys()].filter((i) => w[i] === 0).map((i) => leaves[i]);
  expect(dead.length).toBeGreaterThan(10);
  expect(r.litter).toHaveLength(dead.length);
  const byKey = new Map(r.litter.map((l) => [`${l.j}/${l.k}`, l]));
  expect(byKey.size).toBe(dead.length);
  for (const f of dead) {
    const l = byKey.get(f.key);
    expect(l, f.key).toBeDefined();
    expect(l.x).toBeCloseTo(f.x, 5); expect(l.y).toBeCloseTo(f.y, 5); expect(l.h).toBeCloseTo(f.z, 5);
    expect(l.size[0]).toBeCloseTo(full.faithLeaves[f.i + 2], 5); expect(l.size[1]).toBeCloseTo(full.faithLeaves[f.i + 3], 5);
    expect(l.j).toBe(f.j); expect(l.k).toBe(f.k);
    expect(l.D).toBeLessThanOrEqual(p);                                                       // it has had its day
    expect(l.D).toBeGreaterThanOrEqual(DS);
    expect(l.fade).toBeCloseTo(f.fade, 6);                                                    // a marginal leaf's litter is marginal too (§5.3)
    expect(l.tau).toHaveLength(3);
    for (const c of l.tau) expect(Number.isFinite(c) && c > 0).toBe(true);
  }
  // a leaf that stays is on no list
  for (const [i, f] of leaves.entries()) if (w[i] > 0) expect(byKey.has(f.key)).toBe(false);
});

test("the litter's colour is the leaf's own tau: leafTau at this season, before the fade, with the light's say when turn_exposure is up", () => {
  const over = small({ phenology: 0.95, anthocyanin: 0.8, tannin: 0.3, turn_exposure: 0 });
  const r = grow({ ...over, leaf_drop: 0.7 }, true), tau = tauOf(r.params), out = [0, 0, 0];
  expect(r.litter.length).toBeGreaterThan(10);
  for (const l of r.litter) {
    const want = math.leafTau(tau, r.params, r.params.seed, l.j, l.k, out);
    for (let c = 0; c < 3; c++) expect(l.tau[c]).toBe(want[c]);
  }
});

test("the preview's weights: hier.leafW holds each leaf's w by (twig, slot), and its non-zeros are exactly the buffer's leaves", () => {
  for (const faithful of [false, true]) {
    const over = small({ phenology: 0.86, leaf_drop: 0.8, drop_exposure: 0.5 });
    const r = grow(over, faithful), W = r.g.hier.leafW, nLeaf = 8;
    expect(W).toBeInstanceOf(Float32Array);
    expect(W.length).toBe(r.g.hier.nClusterTotal * nLeaf);
    let live = 0, zero = 0, mid = 0;
    for (const v of W) { expect(v >= 0 && v <= 1).toBe(true); if (v > 0) live++; if (v === 0) zero++; if (v > 0 && v < 1) mid++; }
    expect(live).toBe(r.faithLeaves.length / SF);
    expect(zero).toBe(r.litter.length);
    expect(mid, "some leaves mid-fade at this phenology").toBeGreaterThan(0);
    for (const l of r.litter) expect(W[l.j * nLeaf + l.k], `${l.j}/${l.k}`).toBe(0);
  }
});

// The tree-preview inset (T, EDITOR only) is a second scatter: it re-draws its own blob per leaf from the twigs, not from the grove's buffers, so
// a leaf that has let go has to be taken out of IT as well or the preview keeps a canopy the cast has lost. The recording stub counts the points
// drawn for the leaf haze (the one POINTS draw there is) — one per leaf the preview scatters.
function previewPoints(over) {
  const calls = [];
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "POINTS") return 0x0000;
      if (name === "drawArrays") return (mode, _first, count) => calls.push({ mode, count });
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = fall({ tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, ...over });
  const faith = {}, hub = {
    gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => false, occ: {}, faith, sky: { start: [], count: [] },
    canvas: { width: 960, height: 540 }, motion: { windX: 1, windY: 0, u: 0, sway: [0, 0] }, src: {}, U: { viz: {}, pts: {} },
  };
  const g = makeGrove(hub).buildGrove(null);
  hub.hier = g.hier;
  makeEditorTools(hub);
  hub.drawTreeInset(null, false);
  return { points: calls.filter((c) => c.mode === 0).map((c) => c.count), kept: faith.buf.data.length / SF };
}
test("the tree preview scatters one point per leaf still on the tree: dropped leaves vanish there too", () => {
  const full = previewPoints(small({ phenology: 0.9, leaf_drop: 0 }));
  expect(full.points).toEqual([full.kept]);
  expect(full.kept).toBeGreaterThan(1000);
  const some = previewPoints(small({ phenology: 0.9, leaf_drop: 0.8 }));
  expect(some.kept).toBeLessThan(full.kept * 0.8);
  expect(some.points, "one point per leaf in the cast's buffers").toEqual([some.kept]);
  expect(previewPoints(small({ phenology: 1, leaf_drop: 1 })).points, "a bare tree has no haze to draw").toEqual([0]);
});

// ============================================================================
// After the turn (`drop_after_turn`, `drop_lag`; spec §4.5, Abscission): a leaf lets go only once it has turned, a lag after the end of
// ITS OWN window. Off (the default) none of this exists, to the bit; the claims below are the on state, and the exactness of the off one.
// ============================================================================
const CAP = { anthocyanin: 0.4, tannin: 0.2, wall_fraction: 0.2, turn_exposure: 1, leaf_drop: 1 };   // montebello's capacity, FALL_CAPACITY (macros.js)
const LAG = 0.05;

// the sign of s·sp, with every smoothstep of today's senescence copied here, frozen: the claim at 0 is "the same expression, not an equivalent one"
const oldSenescence = (P, phi) => {
  const span = Math.max(P.turn_span, 1e-4), spread = Math.min(Math.max(P.turn_spread, 0), span * 0.95);
  return math.smoothstep(P.turn_start + phi * spread, P.turn_start + span, P.phenology);
};
// leafTau as it stood before the knob: the draw order, the exposure mix and the gate, copied.
function oldLeafTau(tauSummer, P, seed, j, k, out, phiE, gainE) {
  const r = math.mulberry32(math.hash3((seed >>> 0) ^ 0x51ED270B, j, k));
  const w = phiE === undefined ? 0 : P.turn_exposure;
  let phi = r();
  if (w > 0) phi += (phiE - phi) * w;
  const s = oldSenescence(P, phi);
  if (s === 0) { out[0] = tauSummer[0]; out[1] = tauSummer[1]; out[2] = tauSummer[2]; return out; }
  let a = P.anthocyanin * (0.5 + r());
  const b = P.tannin * (0.5 + r());
  if (w > 0) a *= 1 + (gainE - 1) * w;
  const wall = [0, 0, 0], cell = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const base = tauSummer[c] * (1 - s), pig = math.TAU_CAROTENOID[c] + b * math.TAU_TANNIN[c];
    wall[c] = base + s * pig;
    cell[c] = base + s * (pig + a * math.TAU_ANTHOCYANIN[c]);
  }
  return math.mixtureTau(wall, cell, P.wall_fraction, out);
}

// each leaf's own turn phase φ′, by address, off a reference grove that lets every leaf go on today's drop (after the turn off, drop_exposure 1: D = drop_start +
// drop_span·turnOrder(u)), so the u is the grove's own and the claim under test does not mark its own homework
function turnPhases(over, faithful = false) {
  const ref = grow({ ...over, leaf_drop: 1, phenology: 1, drop_after_turn: 0, drop_exposure: 1 }, faithful), P = ref.params, m = new Map();
  for (const l of ref.litter) m.set(`${l.j}/${l.k}`, math.turnPhase(P, math.leafClock(P.seed, l.j, l.k), P.turn_exposure > 0 ? (l.D - P.drop_start) / P.drop_span : undefined));
  return m;
}
const at = (P, p) => ({ ...P, phenology: p });

test("after the turn: DEFAULTS ships it off with a lag of 0.05; the flag is a flip (TOPO) and the lag a season canopy knob", async () => {
  const { TOPO_KEYS, SEASON_KEYS } = await import("./komorebi-params.js");
  expect(DEFAULTS.drop_after_turn).toBe(0);
  expect(DEFAULTS.drop_lag).toBe(0.05);
  expect(TOPO_KEYS).toContain("drop_after_turn");
  expect(CANOPY_KEYS).not.toContain("drop_after_turn");
  expect(SEASON_KEYS).not.toContain("drop_after_turn");
  expect(CANOPY_KEYS).toContain("drop_lag");
  expect(SEASON_KEYS).toContain("drop_lag");
});

test("after the turn off: senescence is today's expression to the bit, leafTau is today's leafTau, over a grid with the clamp and span < 1e-4", () => {
  const grid = [];
  for (const phi of [0, 0.01, 0.37, 0.5, 0.999999]) for (const p of [0, 0.6, 0.6000001, 0.7, 0.75, 0.82, 0.9, 0.95, 1.4])
    for (const [turn_span, turn_spread] of [[0.3, 0.18], [0.3, 0.29], [0.3, 0.5], [0.3, -1], [0.3, 0], [1e-6, 0.1], [0, 0], [0.05, 0.05]]) grid.push([phi, p, turn_span, turn_spread]);
  for (const flag of [undefined, 0]) for (const [phi, p, turn_span, turn_spread] of grid) {
    const P = { ...DEFAULTS, phenology: p, turn_span, turn_spread, ...(flag === undefined ? {} : { drop_after_turn: flag }) };
    expect(Object.is(math.senescence(P, phi), oldSenescence(P, phi)), JSON.stringify([phi, p, turn_span, turn_spread, flag])).toBe(true);
  }
  const tau = [0.9, 0.7, 2.1];
  for (const flag of [undefined, 0]) for (const p of [0.6, 0.7, 0.8, 0.95]) for (const te of [0, 0.5, 1]) for (const [j, k] of [[0, 0], [3, 9], [41, 2]]) {
    const P = { ...DEFAULTS, ...CAP, turn_exposure: te, phenology: p, ...(flag === undefined ? {} : { drop_after_turn: flag }) };
    for (const [phiE, gainE] of [[undefined, undefined], [0.31, 1.2], [0.97, 0.6]]) {
      const got = math.leafTau(tau, P, 7, j, k, [0, 0, 0], phiE, gainE), want = oldLeafTau(tau, P, 7, j, k, [0, 0, 0], phiE, gainE);
      for (let c = 0; c < 3; c++) expect(Object.is(got[c], want[c]), JSON.stringify([flag, p, te, j, k, phiE, c])).toBe(true);
    }
  }
});

test("turnPhase is leafTau's phase, in leafTau's float order, and the window at 1 is each leaf's own: L = span − spread from its own start", () => {
  const P = { ...DEFAULTS, turn_exposure: 0.37 };
  for (const [phi, phiE] of [[0.2, 0.9], [0.77, 0.1], [0.5, 0.5]]) {
    expect(Object.is(math.turnPhase(P, phi, phiE), phi + (phiE - phi) * 0.37)).toBe(true);
    expect(Object.is(math.turnPhase(P, phi, undefined), phi)).toBe(true);        // no exposure handed: the clock itself
    expect(Object.is(math.turnPhase({ ...P, turn_exposure: 0 }, phi, phiE), phi)).toBe(true);
  }
  const on = { ...DEFAULTS, drop_after_turn: 1 }, span = 0.3, spread = 0.18, L = span - spread;
  for (const phi of [0, 0.25, 0.6, 0.999]) {
    const T0 = 0.6 + phi * spread;
    expect(math.senescence(at(on, T0), phi)).toBe(0);                            // s = 0 at its own start
    expect(math.senescence(at(on, T0 + L / 2), phi)).toBeCloseTo(0.5, 12);
    expect(math.senescence(at(on, T0 + L), phi)).toBe(1);                        // finished L after it started
  }
  expect(math.senescence(at(on, 0.9), 0.999999)).toBeCloseTo(1, 9);              // the last leaf still ends at turn_start + span
  expect(math.senescence(at(on, 0.6), 0)).toBe(0);                               // and nothing has begun at turn_start
  // L keeps a floor: the spread is clamped under the span, as at 0
  const tight = { ...on, turn_spread: 0.5 };
  expect(math.senescence(at(tight, 0.6 + 0.285 + 0.0149), 1)).toBeLessThan(1);
});

test("no leaf falls before its turn ends: s_j(D − ε) = 1 for every leaf in the litter, both paths, turn_exposure 0/½/1, leaf_drop 1/½, lag 0/0.05", () => {
  let checked = 0;
  for (const faithful of [false, true]) for (const te of [0, 0.5, 1]) {
    const phases = turnPhases(small({ ...CAP, turn_exposure: te }), faithful);
    for (const leaf_drop of [1, 0.5]) for (const drop_lag of [0, LAG]) {
      const r = grow(small({ ...CAP, turn_exposure: te, leaf_drop, drop_lag, drop_after_turn: 1, phenology: 0.99 }), faithful);
      expect(r.litter.length, `faithful ${faithful} te ${te} ld ${leaf_drop} lag ${drop_lag}`).toBeGreaterThan(leaf_drop === 1 ? 100 : 40);
      for (const l of r.litter) {
        const phi = phases.get(`${l.j}/${l.k}`);
        expect(phi < leaf_drop, "only the dropping share falls").toBe(true);
        expect(math.senescence(at(r.params, l.D - EPS), phi), `${l.j}/${l.k}: day ${l.D}`).toBe(1);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(2000);
});

const ON = { ...TIES, ...CAP, drop_after_turn: 1 };
test("exact progression: sorted days = turn_start + span − spread + ε + lag + spread·(i+½)/n, all distinct (turn_exposure 1, exposure_absolute 0, leaf_drop 1)", () => {
  const r = grow(dense(ON), true), n = r.litter.length;
  expect(n).toBeGreaterThan(10000);
  const days = r.litter.map((l) => l.D).sort((a, b) => a - b), spread = 0.18;
  let worst = 0, atI = -1;
  for (let i = 0; i < n; i++) { const d = Math.abs(days[i] - (0.6 + 0.3 - spread + EPS + LAG + spread * (i + 0.5) / n)); if (d > worst) { worst = d; atI = i; } }
  expect(worst, `worst day ${atI} of ${n}`).toBeLessThan(1e-9);
  expect(new Set(days).size, "every leaf its own day").toBe(n);
});

test("the order is the turn's: D follows φ′ (the leaf that turned first lets go first), the sunlit shell by its own clock, and at turn_exposure 0 D is the clock alone", () => {
  const off = grow(dense({ ...ON, drop_after_turn: 0 }), true), on = grow(dense(ON), true);
  const byD = (r) => r.litter.map((l) => ({ k: `${l.j}/${l.k}`, D: l.D })).sort((a, b) => a.D - b.D).map((x) => x.k);
  expect(byD(on), "the same leaves in the same order as the sun-first drop at turn_exposure 1").toEqual(byD(off));
  const ex = litterExposure(on), shell = on.litter.filter((_, i) => ex[i] === 1).map((l) => ({ D: l.D, phi: math.leafClock(on.params.seed, l.j, l.k) })).sort((a, b) => a.phi - b.phi);
  expect(shell.length, "not vacuous: a real shell").toBeGreaterThan(500);
  for (let i = 1; i < shell.length; i++) expect(shell[i - 1].D < shell[i].D, `clock ${shell[i - 1].phi} vs ${shell[i].phi}`).toBe(true);
  // turn_exposure 0: no light in the turn, so none in the drop — the exposure pass is not even asked for
  const P0 = { ...DEFAULTS, ...CAP, turn_exposure: 0, drop_after_turn: 1, phenology: 0.99 };
  expect(math.ordered(P0), "drop_exposure 1 does not open the pass when the drop follows the turn and the turn is not lit").toBe(false);
  const z = grow(small({ ...CAP, turn_exposure: 0, drop_after_turn: 1, phenology: 0.99 }), true);
  expect(z.litter.length).toBeGreaterThan(100);
  for (const l of z.litter) expect(Math.abs(l.D - (0.6 + 0.12 + EPS + LAG + 0.18 * math.leafClock(z.params.seed, l.j, l.k))), `${l.j}/${l.k}`).toBeLessThan(1e-9);
});

test("calm: the worst sliding ε window of days is within 1.2× of uniform, on the dense grove and on park 1", () => {
  const worst = (r) => {
    const d = r.litter.map((l) => l.D).sort((a, b) => a - b), n = d.length;
    let hi = 0, mx = 0;
    for (let lo = 0; lo < n; lo++) { while (hi < n && d[hi] <= d[lo] + EPS) hi++; mx = Math.max(mx, hi - lo); }
    return mx / (n * EPS / 0.18);
  };
  const a = worst(grow(dense(ON), true)), b = worst(grow({ ...PRESETS["park 1"], ...CAP, drop_after_turn: 1, phenology: 1 }, true));
  expect(a, "dense(TIES)").toBeLessThanOrEqual(1.2);
  expect(b, "park 1").toBeLessThanOrEqual(1.2);
});

test("marcescence: at leaf_drop ½ half the leaves hang after the last day, and they are the larger φ′ (the last to turn)", () => {
  const all = grow(dense({ ...ON, leaf_drop: 1 }), true), half = grow(dense({ ...ON, leaf_drop: 0.5 }), true), n = all.litter.length;
  const fell = new Set(half.litter.map((l) => `${l.j}/${l.k}`)), hung = all.litter.filter((l) => !fell.has(`${l.j}/${l.k}`));
  const phases = turnPhases(dense(ON), true);
  expect(half.litter.length + hung.length).toBe(n);
  expect(hung.length, "half of them, to a leaf").toBe(n - Math.ceil((n - 1) / 2));
  expect(Math.max(...half.litter.map((l) => phases.get(`${l.j}/${l.k}`)))).toBeLessThan(0.5);
  expect(Math.min(...hung.map((l) => phases.get(`${l.j}/${l.k}`)))).toBeGreaterThanOrEqual(0.5);
  expect(half.litter.every((l) => l.D < 0.96), "all fell inside the season").toBe(true);
});

test("convergence: from turn_start + turn_span on every leaf's tau is the same whether the drop follows the turn or not", () => {
  const P0 = { ...DEFAULTS, ...CAP }, out0 = [0, 0, 0], out1 = [0, 0, 0], tau = [0.9, 0.7, 2.1];
  for (const p of [0.9, 0.95, 1.2]) for (const phi of [0, 0.3, 0.8, 0.999]) {
    for (const f of [0, 1]) expect(math.senescence({ ...P0, drop_after_turn: f, phenology: p }, phi), `p ${p} phi ${phi} flag ${f}`).toBe(1);
    for (const te of [0, 1]) for (const [j, k] of [[0, 0], [5, 3]]) {
      const a = math.leafTau(tau, { ...P0, turn_exposure: te, phenology: p, drop_after_turn: 0 }, 9, j, k, out0, 0.4, 1.1);
      const b = math.leafTau(tau, { ...P0, turn_exposure: te, phenology: p, drop_after_turn: 1 }, 9, j, k, out1, 0.4, 1.1);
      for (let c = 0; c < 3; c++) expect(Object.is(a[c], b[c])).toBe(true);
    }
  }
  for (const faithful of [false, true]) {
    const a = grow(small({ ...CAP, leaf_drop: 0, phenology: 0.95, drop_after_turn: 0 }), faithful), b = grow(small({ ...CAP, leaf_drop: 0, phenology: 0.95, drop_after_turn: 1 }), faithful);
    expect(firstDiff(b.faithLeaves, a.faithLeaves), `faithful ${faithful}`).toBe(-1);
    for (const [i, l] of a.layers.entries()) expect(firstDiff(b.layers[i], l), `layer ${i}`).toBe(-1);
  }
});

test("`dropping` at 1 is never later than the first fade (sweep by 1e-4), the registry agrees, and it is one ε early", async () => {
  const { FEATURES, featuresFor } = await import("./komorebi-params.js");
  for (const [drop_lag, leaf_drop] of [[0, 1], [LAG, 1], [0.2, 0.5], [0.05, 0.01]]) {
    const base = { ...DEFAULTS, ...CAP, drop_after_turn: 1, drop_lag, leaf_drop };
    const firstFade = 0.6 + 0.12 + drop_lag;                       // the earliest leaf (φ′ = 0): D − ε
    expect(math.dropping(at(base, 0.6)), "summer").toBe(false);
    expect(math.dropping(at(base, firstFade - EPS - 1e-9))).toBe(false);
    expect(math.dropping(at(base, firstFade - EPS + 1e-9)), "one ε early, on purpose").toBe(true);
    for (let p = 0.5; p < 1.3; p += 1e-4) {
      const P = at(base, p);
      if (p > firstFade) { expect(math.dropping(P), `p ${p}`).toBe(true); expect(FEATURES.drop.open(P)).toBe(true); expect(featuresFor({ ...P, litter: 1 })).toContain("litter"); }
      expect(FEATURES.drop.open(P)).toBe(math.dropping(P));
    }
  }
  expect(math.dropping({ ...DEFAULTS, ...CAP, drop_after_turn: 1, leaf_drop: 0, phenology: 1 })).toBe(false);
  expect(math.ordered({ ...DEFAULTS, drop_after_turn: 1, turn_exposure: 0, leaf_drop: 1, drop_exposure: 1, phenology: 1 })).toBe(false);
  expect(math.ordered({ ...DEFAULTS, drop_after_turn: 0, turn_exposure: 0, leaf_drop: 1, drop_exposure: 1, phenology: 1 })).toBe(true);   // today's
  expect(math.ordered({ ...DEFAULTS, drop_after_turn: 1, turn_exposure: 1, leaf_drop: 1, phenology: 1 })).toBe(true);                      // the turn itself is lit
});

// ---- the baseline and the effect, on real groves (montebello's capacity). afternoon 7 (32 175 leaves) and park 1 (6 138) give the same shares: the rank is uniform. ----
function table(look, flag) {
  const over = { ...PRESETS[look], ...CAP, drop_after_turn: flag, phenology: 1 };
  const r = grow(over, look === "park 1"), phases = turnPhases({ ...PRESETS[look], ...CAP }, look === "park 1"), n = r.litter.length;
  const rows = {};
  for (const p of [0.75, 0.8, 0.85, 0.9]) {
    const fell = r.litter.filter((l) => l.D <= p), hang = r.litter.filter((l) => l.D > p);
    const sAtD = fell.map((l) => math.senescence(at(r.params, l.D), phases.get(`${l.j}/${l.k}`)));
    const sNow = (ls) => ls.reduce((s, l) => s + math.senescence(at(r.params, p), phases.get(`${l.j}/${l.k}`)), 0) / ls.length;
    const frac = (f) => (fell.length ? sAtD.filter(f).length / fell.length : 0);
    rows[p] = { down: fell.length / n, lt05: frac((s) => s < 0.5), lt09: frac((s) => s < 0.9), lt1: frac((s) => s < 1), min: Math.min(...sAtD), crown: sNow(hang), n };
  }
  return rows;
}
test("the baseline at 0 (afternoon 7, park 1): down 16.7 / 33.3 / 50 / 66.7 %, most exposed leaf goes at s 0.259", () => {
  for (const look of ["afternoon 7", "park 1"]) {
    const t = table(look, 0), want = { 0.75: [0.167, 1, 1, 1], 0.8: [0.333, 0.71, 1, 1], 0.85: [0.5, 0.48, 1, 1], 0.9: [0.667, 0.36, 0.8, 1] };
    for (const [p, w] of Object.entries(want)) {
      expect(t[p].down, `${look} ${p} down`).toBeCloseTo(w[0], 2);
      expect(Math.abs(t[p].lt05 - w[1]), `${look} ${p} s<0.5`).toBeLessThan(0.02);
      expect(Math.abs(t[p].lt09 - w[2]), `${look} ${p} s<0.9`).toBeLessThan(0.02);
      expect(t[p].lt1, `${look} ${p} s<1`).toBeCloseTo(w[3], 2);
      expect(t[p].min, `${look} ${p} min s at D`).toBeCloseTo(0.259, 3);
    }
  }
}, 120000);
test("the effect at 1 (afternoon 7, park 1): down 0 / 11.1 / 38.9 / 66.7 %, every fallen leaf fully turned, the crown mean s 0.50 / 0.74 / 0.93 / 1.00", () => {
  for (const look of ["afternoon 7", "park 1"]) {
    const t = table(look, 1), want = { 0.75: [0, 0.5], 0.8: [0.111, 0.74], 0.85: [0.389, 0.93], 0.9: [0.667, 1] };
    console.log(`\n${look} at 1 (down % / crown mean s / min s at D): ${Object.entries(t).map(([p, r]) => `${p}: ${(100 * r.down).toFixed(1)} / ${r.crown.toFixed(3)} / ${r.down > 0 ? r.min.toFixed(3) : "-"}`).join(" | ")}`);
    for (const [p, w] of Object.entries(want)) {
      expect(Math.abs(t[p].down - w[0]), `${look} ${p} down`).toBeLessThan(0.002);
      expect(Math.abs(t[p].crown - w[1]), `${look} ${p} crown mean s`).toBeLessThan(0.02);
      if (t[p].down > 0) expect(t[p].min, `${look} ${p} min s at D`).toBeGreaterThanOrEqual(1);
    }
  }
}, 120000);
