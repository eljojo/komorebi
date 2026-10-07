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
  "lit/layer": "4d728b7d", "lit/faith": "964badf7",
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
    // (Leaves of EQUAL exposure share a rank and so a day — the fully lit crown top is a tenth of this grove — but they sit at the
    // exposed end, far from these cuts; the precondition is asserted, so a cut that lands in a tie fails loudly rather than loosely.)
    const phases = [...phasesOf(dense({ phenology: 0.5 })).values()];
    const ties = new Map(); for (const v of phases) ties.set(v, (ties.get(v) ?? 0) + 1);
    expect([...ties].filter(([v, c]) => c > 3 && Math.abs(v - L) < 0.05), `no tie group at the cut (leaf_drop ${L})`).toEqual([]);
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
