// ============================================================================
// One tree ahead of its neighbours (spec §4.5, `tree_clock_spread`, `tree_pigment_spread`): a tree draws its own lead (how much sooner its whole clock runs: start,
// finish and both drop clocks) and its own depth (its red AND brown capacity, together), from (seed, tree index) on a salt of its own — never the growth RNG,
// never the leaf's streams. The claims worth holding loudly are the ones that fail SILENTLY: a knob at 0 that leaks one ulp into a shipped look, a draw that
// reshuffles the skeleton, a lead that moves the cached rank (and so is not a season key), a re-season that forgets a tree, a gate that opens late and skips a
// leaf. (The drop.test.js rig, copied: the pure laws first, then the one place that applies them.)
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { CANOPY_KEYS, DEFAULTS, FEATURES, SEASON_KEYS, TOPO_KEYS, featuresFor } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import * as LEAF from "./komorebi-leaf.js";
import * as MAZE from "./leaf-maze.js";
import { GROVE_READS, makeGrove } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";

const { DROP_EPS: EPS } = math;
const fall = (over) => ({ ...DEFAULTS, ...over });
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const at = (P, p) => ({ ...P, phenology: p });
const KNOBS = ["tree_clock_spread", "tree_pigment_spread"];
const absent = (P) => { const q = { ...P }; for (const k of KNOBS) delete q[k]; return q; };   // a params object that never heard of them
const CAP = { anthocyanin: 0.4, tannin: 0.2, wall_fraction: 0.2, turn_exposure: 1, leaf_drop: 1 };   // montebello's capacity (macros.js FALL_CAPACITY)

// ---- 1. the family ships off, as canopy knobs and season keys, on a salt of its own ---------------------------------------
test("the family ships off: both knobs 0, canopy AND season keys (they move only tau and the day), not topology, not read by the key", () => {
  for (const k of KNOBS) {
    expect(DEFAULTS[k], k).toBe(0);
    expect(CANOPY_KEYS, k).toContain(k);
    expect(SEASON_KEYS, k).toContain(k);
    expect(TOPO_KEYS, k).not.toContain(k);
    expect(GROVE_READS, `${k} is a season key: the cache key must not carry it`).not.toContain(k);
  }
  expect(SEASON_KEYS.length).toBe(16);
});

test("TREE_SALT is 2·0x9E3779B9 mod 2^32, differs from every other stream's salt, and is named nowhere else in the repo", () => {
  expect(math.TREE_SALT).toBe((2 * 0x9E3779B9) % 2 ** 32);
  expect(math.TREE_SALT).toBe(0x3C6EF372);
  const salts = [MAZE.AREOLE_SALT, LEAF.VARIANT_SALT, LEAF.OUTLINE_SALT, LEAF.FLIP_SALT, 0x2B9D4F6E /* litter */, 0x51ED270B /* pigment */, 0x7A3C91D5 /* drop */, 0x5bd1e995 /* wind */, 0x5EED /* growth */, math.TREE_SALT];
  expect(new Set(salts).size).toBe(salts.length);
  const files = readdirSync(".").filter((f) => /\.(js|mjs|html)$/.test(f) && !/\.test\.js$/.test(f));
  expect(files.length).toBeGreaterThan(20);
  const named = files.filter((f) => /3C6EF372/i.test(readFileSync(f, "utf8")));
  expect(named, "one place names the salt").toEqual(["komorebi-math.js"]);
});

// ---- 2. the laws ---------------------------------------------------------------------------------------------------------------
const corr = (u, v) => {
  const n = u.length, mu = u.reduce((s, x) => s + x, 0) / n, mv = v.reduce((s, x) => s + x, 0) / n;
  let suv = 0, suu = 0, svv = 0;
  for (let i = 0; i < n; i++) { suv += (u[i] - mu) * (v[i] - mv); suu += (u[i] - mu) ** 2; svv += (v[i] - mv) ** 2; }
  return suv / Math.sqrt(suu * svv);
};
test("treeDraws: a pure function of (seed, tree) in [0,1), uniform, distinct, and nobody else's stream", () => {
  const T = 3000, ts = Array.from({ length: T }, (_, i) => i);
  const d = ts.map((t) => math.treeDraws(77, t));
  for (let t = 0; t < T; t++) {
    for (const x of d[t]) expect(x >= 0 && x < 1).toBe(true);
    expect(math.treeDraws(77, t)).toEqual(d[t]);                              // pure: the same tree, the same two numbers
  }
  const out = [9, 9];
  expect(math.treeDraws(77, 5, out), "fills the caller's array").toBe(out);
  expect(out).toEqual(d[5]);
  expect(math.treeDraws(78, 5)).not.toEqual(d[5]);                              // the seed is in it
  const v = d.map((x) => x[0]), w = d.map((x) => x[1]);
  expect(new Set(v).size, "every tree its own lead").toBe(T);
  expect(new Set(w).size, "…and its own depth").toBe(T);
  for (const s of [v, w]) {
    const mean = s.reduce((a, x) => a + x, 0) / T;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.025);
    const deciles = new Array(10).fill(0);
    for (const x of s) deciles[Math.floor(x * 10)]++;
    for (const c of deciles) expect(Math.abs(c - T / 10)).toBeLessThan(75);
  }
  // its own stream: uncorrelated with the arrangement and wind-identity streams (per twig), the growth stream, the leaf's pigment draw, the drop hash, and the other draw
  const arr = ts.map((t) => math.mulberry32(math.hash3(77, t, 101))());
  const wind = ts.map((t) => math.mulberry32(math.hash3(77 ^ 0x5bd1e995, t, 101))());
  const growth = math.mulberry32(math.hash3(77, 0x5EED, 7)), gro = ts.map(() => growth());
  const pig = ts.map((t) => math.leafClock(77, t, 0)), drop = ts.map((t) => math.dropHash(77, t, 0));
  for (const [name, other] of Object.entries({ arr, wind, gro, pig, drop, w })) expect(Math.abs(corr(v, other)), `lead vs ${name}`).toBeLessThan(0.1);
  for (const [name, other] of Object.entries({ arr, wind, gro, pig, drop })) expect(Math.abs(corr(w, other)), `depth vs ${name}`).toBeLessThan(0.1);
  // one in five trees runs beyond half the reach: 1 − 2^(−1/3) of a uniform draw cubed
  const beyond = v.filter((x) => x * x * x > 0.5).length / T;
  expect(Math.abs(beyond - (1 - 2 ** (-1 / 3)))).toBeLessThan(4.5 * Math.sqrt(0.206 * 0.794 / T));
});

test("treeShift: -S·v³ — on a 10^5 quantile grid the mean lead is S/4, the sd 0.283·S, one in five beyond S/2; monotone, never ahead of S", () => {
  const N = 100000, S = 1;
  let sum = 0, sum2 = 0, beyond = 0, prev = 0;
  for (let i = 0; i < N; i++) {
    const v = (i + 0.5) / N, dT = math.treeShift(v, S);
    expect(dT <= 0 && dT > -S).toBe(true);                                      // the lead only: never late, never a whole reach
    expect(dT <= prev).toBe(true);                                             // monotone in the draw
    prev = dT; sum += -dT; sum2 += dT * dT;
    if (-dT > S / 2) beyond++;
  }
  const mean = sum / N, sd = Math.sqrt(sum2 / N - mean * mean);
  expect(mean).toBeCloseTo(S / 4, 4);
  expect(sd).toBeCloseTo(0.2835, 3);
  expect(Math.abs(beyond / N - (1 - 2 ** (-1 / 3)))).toBeLessThan(0.003);
  expect(Math.abs(beyond / N - 0.206)).toBeLessThan(0.003);
  expect(math.treeShift(0.5, 0.1)).toBeCloseTo(-0.1 * 0.125, 15);               // linear in the reach
});

test("treeGain: 1 + s(2w − 1) — mean 1, in [1 − s, 1 + s), sd s/√3, monotone", () => {
  const N = 100000;
  for (const s of [0.3, 0.6, 1]) {
    let sum = 0, sum2 = 0, prev = -Infinity;
    for (let i = 0; i < N; i++) {
      const c = math.treeGain((i + 0.5) / N, s);
      expect(c >= 1 - s && c < 1 + s).toBe(true);
      expect(c >= prev).toBe(true);
      prev = c; sum += c; sum2 += c * c;
    }
    const mean = sum / N;
    expect(mean).toBeCloseTo(1, 6);
    expect(Math.sqrt(sum2 / N - mean * mean)).toBeCloseTo(s / Math.sqrt(3), 4);
  }
  expect(math.treeGain(0, 1)).toBe(0);                                          // s = 1 lets a tree go without red
});

test("the shipped seed, frozen: 290626672 trees 0–4 lead by v³ = 0.3355, 0.0015, 0.5572, 0.1894, 0.0002 and carry c = 0.718, 1.241, 1.273, 0.821, 0.561 at 0.6", () => {
  const v3 = [0.3355, 0.0015, 0.5572, 0.1894, 0.0002], c06 = [0.718, 1.241, 1.273, 0.821, 0.561];
  for (let t = 0; t < 5; t++) {
    const [v, w] = math.treeDraws(290626672, t);
    expect(v * v * v, `tree ${t} v³`).toBeCloseTo(v3[t], 4);
    expect(math.treeGain(w, 0.6), `tree ${t} c at 0.6`).toBeCloseTo(c06[t], 3);
  }
  const P = { ...DEFAULTS, seed: 290626672, tree_clock_spread: 0.1, tree_pigment_spread: 0.6 };
  expect(math.treeShifts(P, 5)[0], "tree 0's lead at 0.1").toBeCloseTo(-0.03355, 5);
  expect(math.treeGains(P, 5)[0]).toBeCloseTo(0.718, 3);
});

test("treeShifts / treeGains: the gate is the table — null unless the knob is above 0 — and a tree's number is the same at any tree count", () => {
  const P = fall({ seed: 290626672 });
  for (const q of [P, absent(P), { ...P, tree_clock_spread: -0.1, tree_pigment_spread: -1 }]) {
    expect(math.treeShifts(q, 5), "no draw, nothing handed on").toBeNull();
    expect(math.treeGains(q, 5)).toBeNull();
  }
  const on = { ...P, tree_clock_spread: 0.12, tree_pigment_spread: 0.7 };
  const a = math.treeShifts(on, 3), b = math.treeShifts(on, 16), c = math.treeGains(on, 3), d = math.treeGains(on, 16);
  expect(a).toBeInstanceOf(Float64Array); expect(a.length).toBe(3); expect(b.length).toBe(16);
  for (let t = 0; t < 3; t++) { expect(Object.is(a[t], b[t]), `lead of tree ${t}`).toBe(true); expect(Object.is(c[t], d[t]), `depth of tree ${t}`).toBe(true); }
  expect(math.treeShifts({ ...on, tree_pigment_spread: 0 }, 3)).toEqual(a);        // each knob its own table
  expect(math.treeGains({ ...on, tree_clock_spread: 0 }, 3)).toEqual(c);
  expect(math.treeShifts({ ...on, tree_clock_spread: 0.12, seed: 5 }, 3)).not.toEqual(a);
});

// ---- 3. the gate, to the bit -------------------------------------------------------------------------------------------------
// Today's laws, copied from HEAD before this change: the claim at 0 is "the same expression", not an equivalent one.
const clamp = math.clamp, smoothstep = math.smoothstep;
const afterTurn0 = (P) => P.drop_after_turn > 0;
const turnLength0 = (P) => { const span = Math.max(P.turn_span, 1e-4); return span - clamp(P.turn_spread, 0, span * 0.95); };
function senescence0(P, phi) {
  const span = Math.max(P.turn_span, 1e-4), spread = clamp(P.turn_spread, 0, span * 0.95);
  if (afterTurn0(P)) { const T0 = P.turn_start + phi * spread; return smoothstep(T0, T0 + (span - spread), P.phenology); }
  return smoothstep(P.turn_start + phi * spread, P.turn_start + span, P.phenology);
}
function leafTau0(tauSummer, P, seed, j, k, out, phiE, gainE) {
  const r = math.mulberry32(math.hash3((seed >>> 0) ^ 0x51ED270B, j, k));
  const w = phiE === undefined ? 0 : P.turn_exposure;
  const phi = math.turnPhase(P, r(), phiE);
  const s = senescence0(P, phi);
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
const dropDay0 = (P, phiD) => phiD < P.leaf_drop ? P.drop_start + P.drop_span * phiD / P.leaf_drop : Infinity;
function dropDayAfterTurn0(P, phiTurn) {
  if (!(phiTurn < P.leaf_drop)) return Infinity;
  const span = Math.max(P.turn_span, 1e-4), spread = clamp(P.turn_spread, 0, span * 0.95);
  return P.turn_start + phiTurn * spread + (span - spread) + EPS + P.drop_lag;
}
const senescing0 = (P) => P.phenology > P.turn_start;
const lit0 = (P) => senescing0(P) && P.turn_exposure > 0;
const dropping0 = (P) => P.leaf_drop > 0 && P.phenology > (afterTurn0(P) ? P.turn_start + turnLength0(P) + P.drop_lag - EPS : P.drop_start - EPS);
const ordered0 = (P) => lit0(P) || (dropping0(P) && !afterTurn0(P) && P.drop_exposure > 0);

// the knobs "at 0 and absent": a params object that never heard of them, and one that carries them shut
const SHUT = [(P) => absent(P), (P) => ({ ...P, tree_clock_spread: 0, tree_pigment_spread: 0 })];
test("at 0 and absent the laws are today's, to the bit: senescence, leafTau, dropDay, dropDayAfterTurn, senescing, dropping, ordered — over a grid", () => {
  const PS = [0, 0.3, 0.5, 0.55, 0.5999, 0.6, 0.6001, 0.65, 0.7, 0.742, 0.75, 0.7999, 0.8, 0.9, 0.95, 1, 1.4];
  const SPANS = [[0.3, 0.18], [0.3, 0.29], [0.3, 0.5], [0.3, -1], [0.3, 0], [1e-6, 0.1], [0, 0], [0.05, 0.05]];
  const PHIS = [0, 0.01, 0.37, 0.5, 0.999999];
  const tau = [0.9, 0.7, 2.1];
  let n = 0;
  for (const mk of SHUT) for (const flag of [undefined, 0, 1]) {
    const base = (over) => mk({ ...DEFAULTS, ...CAP, ...(flag === undefined ? {} : { drop_after_turn: flag }), ...over });
    for (const p of PS) for (const [turn_span, turn_spread] of SPANS) {
      const P = base({ phenology: p, turn_span, turn_spread });
      for (const phi of PHIS) { expect(Object.is(math.senescence(P, phi), senescence0(P, phi)), JSON.stringify([flag, p, turn_span, turn_spread, phi])).toBe(true); n++; }
    }
    for (const p of PS) for (const te of [0, 0.5, 1]) for (const wf of [0, 0.2]) for (const [j, k] of [[0, 0], [3, 9], [41, 2]]) {
      const P = base({ phenology: p, turn_exposure: te, wall_fraction: wf });
      for (const [phiE, gainE] of [[undefined, undefined], [0.31, 1.2], [0.97, 0.6]]) {
        const got = math.leafTau(tau, P, 7, j, k, [0, 0, 0], phiE, gainE), want = leafTau0(tau, P, 7, j, k, [0, 0, 0], phiE, gainE);
        for (let c = 0; c < 3; c++) { expect(Object.is(got[c], want[c]), JSON.stringify([flag, p, te, wf, j, k, phiE, c])).toBe(true); n++; }
      }
    }
    for (const ld of [0, 0.3, 0.6, 1]) for (const phi of [0, 0.1, 0.29, 0.59, 0.6, 0.99]) {
      const P = base({ leaf_drop: ld });
      expect(Object.is(math.dropDay(P, phi), dropDay0(P, phi)), JSON.stringify(["dropDay", ld, phi])).toBe(true);
      for (const drop_lag of [0, 0.05, 0.2]) {
        const Q = base({ leaf_drop: ld, drop_lag });
        expect(Object.is(math.dropDayAfterTurn(Q, phi), dropDayAfterTurn0(Q, phi)), JSON.stringify(["after", ld, phi, drop_lag])).toBe(true);
      }
    }
    for (const p of PS) for (const ld of [0, 1]) for (const te of [0, 1]) for (const de of [0, 1]) for (const drop_lag of [0, 0.05]) {
      const P = base({ phenology: p, leaf_drop: ld, turn_exposure: te, drop_exposure: de, drop_lag });
      expect(math.senescing(P), "senescing").toBe(senescing0(P));
      expect(math.lit(P), "lit").toBe(lit0(P));
      expect(math.dropping(P), "dropping").toBe(dropping0(P));
      expect(math.ordered(P), "ordered").toBe(ordered0(P));
      expect(FEATURES.pigment.open(P) === senescing0(P) && FEATURES.exposure.open(P) === ordered0(P) && FEATURES.drop.open(P) === dropping0(P), "the registry").toBe(true);
    }
  }
  expect(n).toBeGreaterThan(10000);
});

// ---- the groves (the drop.test.js rig) ------------------------------------------------------------------------------------------
function growWith(over, faithful = false, { keep = false, drop = [] } = {}) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = fall({ tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, ...over });
  for (const k of drop) delete params[k];
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null, { keepSeason: keep });
  return { params, g, faith, litter: g.litter, layers: g.layerVAO.map((l) => Float32Array.from(l.buf.data)), faithLeaves: Float32Array.from(faith.buf.data), leafW: g.hier.leafW };
}
const memo = new Map();
const grow = (over, faithful = false, opts = {}) => {   // the dense groves cost a moment: build each once
  const key = JSON.stringify([over, faithful, opts]);
  if (!memo.has(key)) memo.set(key, growWith(over, faithful, opts));
  return memo.get(key);
};
const SF = 18;
const bits = (a) => new Uint32Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
const firstDiff = (a, b) => {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  const x = bits(a), y = bits(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `first bit difference at ${i}`;
  return null;
};
// a grove with a crown worth shading itself (exposure.test.js's), whole leaves only; and the small one, which carries marginal leaves (7.5 a twig, and a marginal tree at 2.4)
const dense = (over) => ({ ...PRESETS["afternoon 7"], leaves_per_cluster: 40, foliage_density: 1, tree_count: 3, ...over });
const small = (over) => ({ ...PRESETS["afternoon 7"], tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, ...over });
const FALL = { phenology: 0.85, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, turn_exposure: 1, leaf_drop: 1 };   // mid-turn and mid-fade: lit, ordered, dropping
function sameGrove(label, a, b) {
  for (const [i, l] of a.layers.entries()) expect(firstDiff(l, b.layers[i]), `${label}: layer ${i}`).toBe(null);
  expect(firstDiff(a.faithLeaves, b.faithLeaves), `${label}: faithful buffer`).toBe(null);
  expect(JSON.stringify(a.litter), `${label}: litter`).toBe(JSON.stringify(b.litter));
  if (b.leafW === null) expect(a.leafW, `${label}: leafW`).toBe(null); else expect(firstDiff(a.leafW, b.leafW), `${label}: leafW`).toBe(null);
}

test("at 0 and absent every buffer is the same grove: layers, faithful, litter, leafW — dense (lit + dropping, after the turn 0 and 1) and small (marginal leaves and tree), both paths", () => {
  for (const [name, mk] of [["dense", dense], ["small, tree_count 2.4", (o) => small({ tree_count: 2.4, ...o })]]) for (const flag of [0, 1]) for (const faithful of [false, true]) {
    const over = mk({ ...FALL, drop_after_turn: flag });
    const none = grow(over, faithful, { drop: KNOBS }), shut = grow(over, faithful);
    expect(shut.params.tree_clock_spread).toBe(0);
    expect(none.params.tree_clock_spread).toBeUndefined();
    expect(none.litter?.length, `${name}: leaves have let go (not vacuous)`).toBeGreaterThan(0);
    expect(none.leafW.some((w) => w > 0 && w < 1), `${name}: some are mid-fade`).toBe(true);
    sameGrove(`${name}, after-turn ${flag}, faithful ${faithful}`, shut, none);
  }
});

test("the grove never names treeDraws: it asks the tables (treeShifts / treeGains), which are null at the gate", () => {
  const src = read("./komorebi-grove.js");
  expect(src.includes("treeDraws")).toBe(false);
  expect(src.includes("treeShifts") && src.includes("treeGains")).toBe(true);
  expect(src.includes("TREE_SALT")).toBe(false);
});

// ---- 4. no growth draw ----------------------------------------------------------------------------------------------------------
test("no draw from the growth, arrangement or wind streams: at (0.1, 0.6) the skeleton, twigs and every non-tau slot are the (0, 0) grove's", () => {
  for (const [name, mk] of [["dense", dense], ["small, marginal tree", (o) => small({ tree_count: 2.4, ...o })]]) for (const faithful of [false, true]) {
    const over = mk({ ...FALL, leaf_drop: 0 });                       // no fade: every slot but the tau is the grove's own
    const off = grow(over, faithful), on = grow({ ...over, tree_clock_spread: 0.1, tree_pigment_spread: 0.6 }, faithful);
    expect(JSON.stringify(on.g.hier.segments), `${name}: segments`).toBe(JSON.stringify(off.g.hier.segments));
    expect(JSON.stringify(on.g.hier.twigs), `${name}: twigs`).toBe(JSON.stringify(off.g.hier.twigs));
    expect(on.faithLeaves.length).toBe(off.faithLeaves.length);
    let moved = 0;
    for (let i = 0; i < off.faithLeaves.length; i++) {
      const slot = i % SF;
      if (slot >= 8 && slot <= 10) { if (!Object.is(on.faithLeaves[i], off.faithLeaves[i])) moved++; continue; }
      if (!Object.is(on.faithLeaves[i], off.faithLeaves[i])) throw new Error(`${name}, faithful ${faithful}: record ${Math.floor(i / SF)} slot ${slot} moved`);
    }
    expect(moved, `${name}: the tau slots did move (not vacuous)`).toBeGreaterThan(100);
    on.layers.forEach((l, li) => {
      expect(l.length).toBe(off.layers[li].length);
      for (let i = 0; i < l.length; i++) { const slot = i % 17; if (slot >= 8 && slot <= 10) continue; if (!Object.is(l[i], off.layers[li][i])) throw new Error(`${name}: layer ${li} slot ${slot} moved`); }
    });
  }
});

// ---- 5. the block shift --------------------------------------------------------------------------------------------------------
const byAddr = (r) => new Map(r.litter.map((l) => [`${l.j}/${l.k}`, l]));
test("the lead is a block shift: every litter leaf's day is the (0, 0) grove's + its tree's Δ, to 1e-12 — both drop clocks, a marginal tree included; the rank does not move", () => {
  for (const tree_count of [3, 2.4]) for (const flag of [0, 1]) {
    const over = dense({ tree_count, phenology: 1, leaf_drop: 1, drop_after_turn: flag, turn_exposure: 1, anthocyanin: 0.4 });
    const off = grow(over, false, { keep: true }), on = grow({ ...over, tree_clock_spread: 0.1 }, false, { keep: true });
    const nTree = Math.ceil(tree_count), shifts = math.treeShifts(on.params, nTree), A = byAddr(off);
    expect(on.litter.length, `tree_count ${tree_count}`).toBe(off.litter.length);
    expect(on.litter.length).toBeGreaterThan(5000);
    const seen = new Set();
    for (const l of on.litter) {
      const t = on.g.hier.twigs[l.j].tree, o = A.get(`${l.j}/${l.k}`);
      seen.add(t);
      expect(Math.abs(l.D - (o.D + shifts[t])), `tree ${t} leaf ${l.j}/${l.k}`).toBeLessThan(1e-12);
    }
    expect([...seen].sort(), "every tree, the marginal one too").toEqual(Array.from({ length: nTree }, (_, t) => t));
    expect(shifts[0] < 0 && shifts.some((d) => d !== shifts[0]), "the trees lead by different amounts").toBe(true);
    // the cached rank is the grove's: the lead is added after it, which is what lets the knobs be season keys
    const both = grow({ ...over, tree_clock_spread: 0.1, tree_pigment_spread: 0.6 }, false, { keep: true });
    expect(off.g.season.rank, "the pass ran").not.toBe(null);
    expect(firstDiff(on.g.season.rank, off.g.season.rank), "rank: clock").toBe(null);
    expect(firstDiff(both.g.season.rank, off.g.season.rank), "rank: clock and pigment").toBe(null);
    expect(both.g.season.nTree).toBe(nTree);
  }
});

test("at its shifted start s is exactly 0, and at its shifted finish exactly 1 — for every tree's lead, both turn laws", () => {
  const P = fall({ ...CAP, seed: 290626672, tree_clock_spread: 0.15 });
  for (const flag of [0, 1]) {
    const Q = { ...P, drop_after_turn: flag }, shifts = math.treeShifts(Q, 16), span = 0.3, spread = 0.18;
    for (const dT of shifts) for (const phi of [0, 0.25, 0.6, 0.999]) {
      const start = Q.turn_start + dT, T0 = start + phi * spread, end = flag ? T0 + (span - spread) : start + span;
      expect(math.senescence(at(Q, T0), phi, dT), `flag ${flag} dT ${dT} phi ${phi}: start`).toBe(0);
      expect(math.senescence(at(Q, T0 + 1e-6), phi, dT) > 0, "…and moving just after it").toBe(true);
      expect(math.senescence(at(Q, end), phi, dT), `flag ${flag} dT ${dT} phi ${phi}: finish`).toBe(1);
      expect(math.senescence(at(Q, end - 1e-6), phi, dT) < 1).toBe(true);
    }
  }
});

test("the old drop clock shifts too: dropDay and dropDayAfterTurn are the unshifted day + dT", () => {
  const P = fall({ ...CAP, leaf_drop: 0.7 });
  for (const dT of [-0.15, -0.0335, -1e-9]) for (const phi of [0, 0.2, 0.69]) {
    expect(math.dropDay(P, phi, dT)).toBeCloseTo(math.dropDay(P, phi) + dT, 12);
    expect(math.dropDayAfterTurn(P, phi, dT)).toBeCloseTo(math.dropDayAfterTurn(P, phi) + dT, 12);
  }
  expect(math.dropDay(P, 0.7, -0.1), "a leaf that never drops, never drops").toBe(Infinity);
  expect(math.dropDayAfterTurn(P, 0.7, -0.1)).toBe(Infinity);
  expect(Object.is(math.dropDay(P, 0.2, 0), math.dropDay(P, 0.2)), "dT 0 is no shift").toBe(true);
});

// ---- 6. the depth -------------------------------------------------------------------------------------------------------------------
test("leafTau(…, cT) is leafTau at anthocyanin·cT and tannin·cT, to 1e-12, for s in (0, 1], with and without the light's say — and cT leaves the clock alone", () => {
  const tau = [0.9, 0.7, 2.1];
  let checked = 0;
  for (const p of [0.62, 0.7, 0.8, 0.9, 1]) for (const wf of [0, 0.2]) for (const cT of [0, 0.3, 0.718, 1.273, 1.9]) for (const [j, k] of [[0, 0], [3, 9], [41, 2], [7, 7]]) {
    const P = fall({ ...CAP, wall_fraction: wf, phenology: p }), Q = { ...P, anthocyanin: P.anthocyanin * cT, tannin: P.tannin * cT };
    for (const [phiE, gainE] of [[undefined, undefined], [0.31, 1.2], [0.97, 0.6]]) {
      const got = math.leafTau(tau, P, 7, j, k, [0, 0, 0], phiE, gainE, undefined, cT), want = math.leafTau(tau, Q, 7, j, k, [0, 0, 0], phiE, gainE);
      const s = math.senescence(P, math.turnPhase(P, math.leafClock(7, j, k), phiE));
      if (s > 0) checked++;
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - want[c]), JSON.stringify([p, wf, cT, j, k, phiE, c])).toBeLessThan(1e-12);
    }
  }
  expect(checked).toBeGreaterThan(300);
  // before the leaf has begun it is the authored tau, whatever its depth
  const early = fall({ ...CAP, phenology: 0.55 });
  expect(Array.from(math.leafTau(tau, early, 7, 3, 3, [0, 0, 0], undefined, undefined, undefined, 1.9))).toEqual(tau);
});

// the pigment state a litter leaf carries, solved: at leaf-off with wall_fraction 0 tau = carotenoid + b·tannin + a·anthocyanin per channel (s = 1)
function pigmentsOf(tau) {
  const A = math.TAU_ANTHOCYANIN, B = math.TAU_TANNIN, y = tau.map((t, c) => t - math.TAU_CAROTENOID[c]);
  const aa = A[0] * A[0] + A[1] * A[1] + A[2] * A[2], bb = B[0] * B[0] + B[1] * B[1] + B[2] * B[2], ab = A[0] * B[0] + A[1] * B[1] + A[2] * B[2];
  const ya = A[0] * y[0] + A[1] * y[1] + A[2] * y[2], yb = B[0] * y[0] + B[1] * y[1] + B[2] * y[2], det = aa * bb - ab * ab;
  const a = (ya * bb - yb * ab) / det, b = (aa * yb - ab * ya) / det;
  const res = Math.max(...y.map((v, c) => Math.abs(v - a * A[c] - b * B[c])));
  return { a, b, res };
}
test("the depth: the litter's tau solves to a_j/a_j0 = b_j/b_j0 = c of its tree, red AND brown, and the day does not move", () => {
  for (const tree_count of [3, 2.4]) {
    const over = dense({ tree_count, phenology: 1, leaf_drop: 1, turn_exposure: 0, anthocyanin: 0.8, tannin: 0.5, wall_fraction: 0, drop_exposure: 1 });
    const off = grow(over), on = grow({ ...over, tree_pigment_spread: 0.6 }), A = byAddr(off), nTree = Math.ceil(tree_count), gains = math.treeGains(on.params, nTree);
    expect(on.litter.length).toBe(off.litter.length);
    const seen = new Set();
    for (const l of on.litter) {
      const o = A.get(`${l.j}/${l.k}`), t = on.g.hier.twigs[l.j].tree, p1 = pigmentsOf(l.tau), p0 = pigmentsOf(o.tau);
      seen.add(t);
      expect(p0.res, "the (0, 0) leaf is carotenoid + a·anthocyanin + b·tannin").toBeLessThan(1e-9);
      expect(p1.res, "…and so is the deeper one").toBeLessThan(1e-9);
      expect(Math.abs(p1.a / p0.a - gains[t]), `tree ${t} red`).toBeLessThan(1e-7);
      expect(Math.abs(p1.b / p0.b - gains[t]), `tree ${t} brown`).toBeLessThan(1e-7);
      expect(Object.is(l.D, o.D), "the day is the grove's own").toBe(true);
    }
    expect([...seen].length, "every tree").toBe(nTree);
    expect(gains.some((c) => c < 0.9) && gains.some((c) => c > 1.1), "the trees differ").toBe(true);
  }
});

// ---- 6b. each leaf takes its OWN tree's pair wherever its tau is made ---------------------------------------------------------------
// The light's arm of the rewrite overwrites the hang loop's tau, and a grove that drops every leaf never shows it: so with the light on, nothing else here sees the two arms a grove with
// turn_exposure 0 takes — the hang loop's own leafTau, and the rewrite's sen-only arm for a leaf that is letting go. Held directly: the grove's tau in every buffer (and the litter's) against
// leafTau called by hand with the lead and the depth the leaf's own tree draws (treeDraws, not the tables the grove asks), a grove of four trees that draw four different pairs.
const TAU_OF = ["trans_r", "trans_g", "trans_b"];
function byHand(on) {
  const P = on.params, { twigs, nLeaf, nClusterTotal } = on.g.hier, nTree = Math.ceil(P.tree_count), dropping = math.dropping(P), after = math.afterTurn(P);
  const lead = [], depth = [];
  for (let t = 0; t < nTree; t++) { const [v, w] = math.treeDraws(P.seed, t); lead.push(math.treeShift(v, P.tree_clock_spread)); depth.push(math.treeGain(w, P.tree_pigment_spread)); }
  expect(new Set(lead).size, "the trees draw different leads").toBe(nTree);
  expect(new Set(depth).size, "…and different depths").toBe(nTree);
  const tau = TAU_OF.map((k) => -Math.log(math.clamp(P[k], 1e-4, 0.999)));
  // what a leaf of tree t would get from each way of being wrong: nobody's pair, the lead alone, the depth alone, tree 0's pair for every tree
  const pair = { own: (t) => [lead[t], depth[t]], none: () => [undefined, undefined], dTonly: (t) => [lead[t], undefined], cTonly: (t) => [undefined, depth[t]], tree0: () => [lead[0], depth[0]] };
  const tauOf = (alt, t, j, k) => { const [dT, cT] = pair[alt](t); return Array.from(math.leafTau(tau, P, P.seed, j, k, [0, 0, 0], undefined, undefined, dT, cT)); };
  const wantL = on.layers.map(() => []), wantF = [], litter = new Map(), diff = {}, diffFading = {};
  for (const alt of Object.keys(pair)) if (alt !== "own") diff[alt] = diffFading[alt] = 0;
  let fading = 0, gone = 0, mid = 0;
  for (let j = 0; j < nClusterTotal; j++) for (let k = 0; k < nLeaf; k++) {
    const t = twigs[j].tree, dT = lead[t], lt = tauOf("own", t, j, k);
    let w = 1, D = 0;
    if (dropping) {
      D = after ? math.dropDayAfterTurn(P, math.turnPhase(P, math.leafClock(P.seed, j, k)), dT) : math.dropDay(P, math.dropPhase(math.dropHash(P.seed, j, k), 0, P.drop_exposure), dT);
      w = math.retention(D, P.phenology);
    }
    for (const alt of Object.keys(diff)) {
      const other = tauOf(alt, t, j, k), differs = other.some((x, c) => !Object.is(x, lt[c]));
      if (differs) { diff[alt]++; if (w < 1) diffFading[alt]++; }
    }
    if (w < 1) fading++;
    if (w > 0 && w < 1) mid++;
    if (w === 0) { gone++; litter.set(`${j}/${k}`, { tau: lt, D }); continue; }
    for (let c = 0; c < 3; c++) { wantL[twigs[j].layer].push(Math.fround(lt[c] * w)); wantF.push(Math.fround(lt[c] * w)); }
  }
  const slots = (buf, stride) => { const o = []; for (let i = 0; i < buf.length; i += stride) o.push(buf[i + 8], buf[i + 9], buf[i + 10]); return o; };
  on.layers.forEach((l, li) => {
    const got = slots(l, 17);
    expect(got.length, `layer ${li}: the leaves that stay`).toBe(wantL[li].length);
    const at = got.findIndex((x, i) => !Object.is(x, wantL[li][i]));
    expect(at, `layer ${li}: leaf ${Math.floor(at / 3)} channel ${at % 3} is not leafTau of its own tree's lead and depth`).toBe(-1);
  });
  const gotF = slots(on.faithLeaves, 18), atF = gotF.findIndex((x, i) => !Object.is(x, wantF[i]));
  expect(gotF.length, "faithful: the leaves that stay").toBe(wantF.length);
  expect(atF, `faithful: leaf ${Math.floor(atF / 3)} channel ${atF % 3}`).toBe(-1);
  expect(on.litter?.length ?? 0, "the litter: the leaves that went").toBe(litter.size);
  for (const l of on.litter ?? []) {
    const o = litter.get(`${l.j}/${l.k}`);
    expect(o, `litter leaf ${l.j}/${l.k}`).toBeDefined();
    expect(Object.is(l.D, o.D), `litter leaf ${l.j}/${l.k}: its day`).toBe(true);
    for (let c = 0; c < 3; c++) expect(Object.is(l.tau[c], o.tau[c]), `litter leaf ${l.j}/${l.k} channel ${c}`).toBe(true);
  }
  return { diff, diffFading, fading, gone, mid };
}
const UNLIT = { turn_exposure: 0, anthocyanin: 0.8, tannin: 0.5, wall_fraction: 0.2, tree_clock_spread: 0.12, tree_pigment_spread: 0.7, foliage_density: 1, leaves_per_cluster: 6, tree_count: 4 };

test("neither lit nor dropping: the hang loop's leafTau takes each cluster's own tree's lead and depth — mid-turn and turned, both turn laws", () => {
  const seen = { none: 0, dTonly: 0, cTonly: 0, tree0: 0 };
  for (const flag of [0, 1]) for (const phenology of [0.78, 1]) {
    const on = grow(small({ ...UNLIT, leaf_drop: 0, drop_after_turn: flag, phenology }));
    expect(math.lit(on.params) || math.dropping(on.params), "the hang loop's tau is the grove's tau").toBe(false);
    expect(on.litter, "nothing dropped").toBe(null);
    const r = byHand(on);
    for (const alt of Object.keys(seen)) seen[alt] += r.diff[alt];
  }
  // not vacuous: each wrong way of handing the pair out gives some leaf another colour, so the comparison above can tell it
  for (const [alt, n] of Object.entries(seen)) expect(n, `a leaf told by '${alt}' differs`).toBeGreaterThan(50);
});

test("unlit and dropping: the rewrite's sen-only arm takes each leaf's own tree's lead and depth — for the leaves mid-fade and the leaves that have gone, both clocks", () => {
  for (const flag of [0, 1]) {
    const on = grow(small({ ...UNLIT, leaf_drop: 1, drop_exposure: 0, drop_after_turn: flag, phenology: 0.85 }));
    expect(math.lit(on.params) || math.ordered(on.params), "no light anywhere: no rank, no exposure arm").toBe(false);
    expect(math.dropping(on.params)).toBe(true);
    const r = byHand(on);
    expect(r.gone, `after-turn ${flag}: leaves have gone`).toBeGreaterThan(20);
    expect(r.mid, `after-turn ${flag}: some are mid-fade`).toBeGreaterThan(0);
    for (const alt of ["none", "dTonly", "cTonly", "tree0"]) expect(r.diffFading[alt], `after-turn ${flag}: a leaf that lets go, told by '${alt}', differs`).toBeGreaterThan(10);
  }
});

// ---- 7. the gates -----------------------------------------------------------------------------------------------------------------
test("the gates open with the reach: any leaf that has begun, or has begun to fade, finds senescing / dropping already open — S in {0.05, 0.1, 0.15}, a sweep by 1e-4, both clocks", () => {
  const VS = [0, 0.1, 0.35, 0.5, 0.8, 0.9, 0.99, 1 - 2 ** -24], PHIS = [0, 0.3, 0.7, 0.999999];
  for (const S of [0.05, 0.1, 0.15]) for (const flag of [0, 1]) {
    const base = fall({ ...CAP, leaf_drop: 1, tree_clock_spread: S, drop_after_turn: flag, litter: 1 });
    const bad = [];
    let begun = 0, fading = 0;
    for (let i = 0; i <= 10000; i++) {
      const p = 0.3 + i * 1e-4, P = at(base, p);
      const sen = math.senescing(P), dropping = math.dropping(P);
      let anyBegun = false, anyFading = false;
      for (const v of VS) {
        const dT = math.treeShift(v, S);
        for (const phi of PHIS) {
          if (math.senescence(P, phi, dT) > 0) anyBegun = true;
          const D = flag ? math.dropDayAfterTurn(P, phi, dT) : math.dropDay(P, phi, dT);
          if (math.retention(D, p) < 1) anyFading = true;
        }
      }
      if (anyBegun) { begun++; if (!sen) bad.push(`p ${p}: a leaf has begun to turn, senescing is shut`); }
      if (anyFading) { fading++; if (!dropping) bad.push(`p ${p}: a leaf has begun to fade, dropping is shut`); }
      if (FEATURES.pigment.open(P) !== sen || FEATURES.exposure.open(P) !== math.ordered(P) || FEATURES.drop.open(P) !== dropping || FEATURES.litter.open(P) !== dropping) bad.push(`p ${p}: the registry disagrees with the predicates`);
      if (dropping && !(sen)) bad.push(`p ${p}: dropping is open while senescing is shut`);
      if (dropping && !featuresFor(P).includes("litter")) bad.push(`p ${p}: litter is not offered once dropping opens`);
    }
    expect(bad.slice(0, 5), `S ${S}, flag ${flag}`).toEqual([]);
    expect(begun, "not vacuous").toBeGreaterThan(1000);
    expect(fading, "not vacuous").toBeGreaterThan(500);
    // the reach, exactly: nothing has begun at turn_start − S, the gate opens just above it, and (one ε early, on purpose) the drop's opens ε before the first possible fade
    const edge = base.turn_start - S;
    expect(math.senescing(at(base, edge)), "shut at the reach").toBe(false);
    expect(math.senescing(at(base, edge + 1e-9)), "open just above it").toBe(true);
    const first = flag ? edge + (0.3 - 0.18) + base.drop_lag - EPS : base.drop_start - S - EPS;
    expect(math.dropping(at(base, first - 1e-9))).toBe(false);
    expect(math.dropping(at(base, first + 1e-9))).toBe(true);
  }
});

test("at the reach no leaf has begun: every tree, every phase, both laws — s is exactly 0 and leafTau is the authored tau, to the bit", () => {
  const tau = [0.9, 0.7, 2.1];
  for (const S of [0.05, 0.1, 0.15]) for (const flag of [0, 1]) {
    const P = fall({ ...CAP, tree_clock_spread: S, tree_pigment_spread: 1, drop_after_turn: flag });
    P.phenology = P.turn_start - S;
    for (const v of [0, 0.3, 0.7, 0.99, 1 - 2 ** -24]) for (const phi of [0, 0.5, 0.999999]) {
      const dT = math.treeShift(v, S);
      expect(math.senescence(P, phi, dT), `S ${S} v ${v} phi ${phi}`).toBe(0);
    }
    for (const [j, k] of [[0, 0], [5, 3], [12, 9]]) for (const cT of [0, 1, 1.9]) {
      const got = math.leafTau(tau, P, 7, j, k, [0, 0, 0], undefined, undefined, math.treeShift(1 - 2 ** -24, S), cT);
      expect(Array.from(got)).toEqual(tau);
    }
  }
});

test("armed past the reach and short of the earliest tree's start the build is the knobs-at-0 build: every buffer, both paths, both turn laws — and a frame inside the early tree's turn is not", () => {
  // AT the reach itself every predicate is shut, so both builds are the summer grove whatever the tau code does and the comparison proves nothing. Halfway between the reach (turn_start − S) and the
  // first tree's own start (turn_start + the least Δ) the gates are open — senescing, and the light's pass with it — the tau code runs over every leaf, and still no leaf has begun.
  for (const S of [0.05, 0.1, 0.15]) for (const flag of [0, 1]) for (const faithful of [false, true]) {
    const armed = small({ ...FALL, anthocyanin: 0.8, tannin: 0.5, tree_clock_spread: S, tree_pigment_spread: 1, drop_after_turn: flag });
    // the least Δ, from the draws and the cube by hand — not asked of treeShift, so the window stands (and the build comparison below is what fails) whatever treeShift says
    const P = fall(armed), reach = P.turn_start - S, best = Math.max(...Array.from({ length: Math.ceil(P.tree_count) }, (_, t) => math.treeDraws(P.seed, t)[0] ** 3)), earliest = P.turn_start - S * best;
    const phenology = (reach + earliest) / 2;
    expect(phenology > reach && phenology < earliest, `S ${S}: inside the window`).toBe(true);
    expect(math.senescing(at(P, phenology)) && math.lit(at(P, phenology)), `S ${S}: the gates are open`).toBe(true);
    expect(math.senescence(at(P, phenology), 0, earliest - P.turn_start), `S ${S}: the earliest tree's earliest leaf has not begun`).toBe(0);
    const on = growWith({ ...armed, phenology }, faithful, { keep: true });
    expect(on.g.season.rank, `S ${S}: the exposure pass ran`).not.toBe(null);
    sameGrove(`S ${S}, after-turn ${flag}, faithful ${faithful}`, on, grow({ ...armed, phenology, tree_clock_spread: 0, tree_pigment_spread: 0 }, faithful));
  }
  const over = small({ ...FALL, phenology: 0.58, tree_clock_spread: 0.1 });      // tree 0 leads by a third of the reach: its first leaves begin at 0.5664
  expect(firstDiff(grow(over).faithLeaves, grow({ ...over, tree_clock_spread: 0 }).faithLeaves), "inside the reach the early tree has begun").not.toBe(null);
});

test("armed at summer the earliest tree is still to come: afternoon 7 at (0.11, 1), phenology 0.5 — the predicates open, the pass runs, and the frame is its summer", () => {
  const over = { ...PRESETS["afternoon 7"], phenology: 0.5, anthocyanin: 0.8, tannin: 0.5, turn_exposure: 1, tree_clock_spread: 0.11, tree_pigment_spread: 1 };
  const P = fall(over);
  expect(math.senescing(P) && math.lit(P) && math.ordered(P), "open").toBe(true);
  const earliest = (count) => P.turn_start + Math.min(...math.treeShifts(P, count));
  expect(earliest(2), "the two-tree looks' earliest T0: tree 0 leads by a third of the reach").toBeCloseTo(0.563, 3);
  expect(earliest(P.tree_count), "afternoon 7 has five trees, and the third leads by more than half").toBeCloseTo(0.6 - 0.11 * 0.5572, 3);
  expect(earliest(P.tree_count)).toBeGreaterThan(0.5);
  for (const faithful of [false, true]) {
    const armed = growWith(over, faithful, { keep: true }), summer = growWith({ ...over, tree_clock_spread: 0, tree_pigment_spread: 0, turn_exposure: 0 }, faithful);
    expect(armed.g.season.rank, "the exposure pass ran").not.toBe(null);
    sameGrove(`afternoon 7, faithful ${faithful}`, armed, summer);
  }
});

// ---- the predicates exist once ---------------------------------------------------------------------------------------------------------
test("the registry's pigment tier and the grove's gate read one predicate: the reach is in math.js, once", () => {
  const files = readdirSync(".").filter((f) => /\.(js|mjs)$/.test(f) && !/\.test\.js$/.test(f));
  const stating = files.filter((f) => /\b(turnOpens|dropOpens)\s*=/.test(readFileSync(f, "utf8")));
  expect(stating, "the reach-aware predicates are stated in komorebi-math.js and nowhere else").toEqual(["komorebi-math.js"]);
  for (const f of ["komorebi-grove.js", "komorebi-params.js", "editor.js"]) expect(/\.turn_start\s*-\s*\w+\.tree_clock_spread/.test(read(`./${f}`)), `${f} does not restate the reach`).toBe(false);
  expect(/params\.phenology\s*>\s*params\.turn_start/.test(read("./editor.js")), "editor.js does not restate the gate").toBe(false);
});

// ---- the held leaf (leaf-preview.js, DOM): it sits on a tree of the grove, and its lead and depth are the picture's own seed's ----------------------------------------------
// A stub DOM is enough to run draw(): the canvas keeps its dataset (the label the editor smoke reads), the clock is the test's, and the grove is the one hierOf hands over.
async function heldLeaf(params, hier) {
  const { makeLeafPreview } = await import("./leaf-preview.js");
  const ctx = new Proxy({}, { get: (t, name) => (name in t ? t[name] : () => {}), set: (t, name, v) => { t[name] = v; return true; } });
  const painted = [];   // the bytes of every leaf the inset painted, in order: the colours the picture shows
  ctx.putImageData = (img) => { painted.push(img.data); };
  const canvas = { style: {}, dataset: {}, width: 0, height: 0, clientWidth: 420, getContext: () => ctx, addEventListener() {}, after() {} };
  const saved = { document: globalThis.document, window: globalThis.window, ImageData: globalThis.ImageData }, now = performance.now;
  let t = 1000;
  performance.now = () => t;
  globalThis.document = { createElement: () => (canvas.created++ ? { getContext: () => ctx, width: 0, height: 0 } : canvas), getElementById: () => null, body: { appendChild() {} } };
  canvas.created = 0;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.ImageData = class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } };
  try {
    const preview = makeLeafPreview(params, () => hier);
    return { preview, canvas, painted, tick: (ms = 0) => { t += ms; preview.draw(); }, done: () => { performance.now = now; Object.assign(globalThis, saved); } };
  } catch (e) { performance.now = now; Object.assign(globalThis, saved); throw e; }
}
test("the held leaf: its tree is the one the grove hangs its cluster on, its lead and depth are drawn from the picture's seed, and the knobs recolour it live", async () => {
  const hier = { nClusterTotal: 4, nLeaf: 3, twigs: [{ tree: 1 }, { tree: 0 }, { tree: 1 }, { tree: 2 }] };   // cluster 0 hangs on tree 1, cluster 1 on tree 0
  const params = fall({ seed: 290626672, phenology: 1, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, leaf_shape: "maple", leaf_size_m: 0.0756, leaf_aspect: 1 });
  const H = await heldLeaf(params, hier);
  try {
    H.preview.show(true); H.tick();
    expect(H.canvas.dataset.label, "no knob up: the label is the tree-less one").toMatch(/^leaf 0·0 · outline \d+ · s [\d.]+ a [\d.]+ b [\d.]+$/);
    const a0 = +/ a ([\d.]+) /.exec(H.canvas.dataset.label)[1];
    Object.assign(params, { tree_clock_spread: 0.1, tree_pigment_spread: 0.6 });
    H.tick();
    const [v1, w1] = math.treeDraws(290626672, 1), label = H.canvas.dataset.label;   // cluster 0 is on tree 1: v³ 0.0015, c 1.241
    expect(label).toContain(` · tree 1 Δ ${math.treeShift(v1, 0.1).toFixed(3)} c ${math.treeGain(w1, 0.6).toFixed(2)}`);
    expect(+/ a ([\d.]+) /.exec(label)[1], "a is c times the tree-less leaf's, live and with no regrow").toBeCloseTo(a0 * math.treeGain(w1, 0.6), 1);
    expect(H.canvas.dataset.grows, "the recolour paid no regrow").toBe("1");
    // a regrow that waits (the seed moved a moment ago): the picture is still the leaf of the seed it was made with, so are its tree's numbers
    params.seed = 5;
    H.tick(10);
    expect(H.canvas.dataset.grows, "deferred, not dropped").toBe("1");
    expect(H.canvas.dataset.label).toContain(` · tree 1 Δ ${math.treeShift(v1, 0.1).toFixed(3)} c ${math.treeGain(w1, 0.6).toFixed(2)}`);
    Object.assign(params, { tree_clock_spread: 0.12 });
    H.tick(10);
    expect(H.canvas.dataset.label, "the lead follows the slider, from the made seed").toContain(` Δ ${math.treeShift(v1, 0.12).toFixed(3)} `);
    // the grove regrew: cluster 0 is on another tree now, and the leaf follows it
    hier.twigs[0].tree = 0;
    H.tick(10);
    const [v0, w0] = math.treeDraws(290626672, 0);
    expect(H.canvas.dataset.label).toContain(` · tree 0 Δ ${math.treeShift(v0, 0.12).toFixed(3)} c ${math.treeGain(w0, 0.6).toFixed(2)}`);
    Object.assign(params, { tree_clock_spread: 0, tree_pigment_spread: 0 });
    H.tick(10);
    expect(H.canvas.dataset.label, "both back at 0: the tree-less label again").toMatch(/^leaf 0·0 · outline \d+ · s [\d.]+ a [\d.]+ b [\d.]+$/);
    expect(+/ a ([\d.]+) /.exec(H.canvas.dataset.label)[1]).toBeCloseTo(a0, 5);
  } finally { H.done(); }
}, 60000);

// The held leaf at a MID-TURN season, with the address on the move. Phenology 1 saturates s for every leaf whatever its tree's lead, so the test above cannot tell a leaf that lost its lead; 0.78 is the middle of the
// default turn (0.6 to 0.9), where the leaf on show (0·0, tree 0) has s 0.21 on the look's clock and 0.55 with its tree's lead — the lead moves it by a third, nowhere near the clamps — and the leaf the address
// steps to (1·0, tree 2) moves 0.62 to 0.91. The colours are the picture's bytes against leaf-maze.js's own paint of the same raster; the tree-less, lead-less and depth-less paints are asserted to differ, so a
// comparison that cannot tell them fails loudly.
const NPX = 512;   // leaf-preview.js's raster side
const rasters = new Map();
function paintOf(P, j, k, dT, cT) {
  const grown = MAZE.leafMaze(LEAF.LEAF_SHAPES[P.leaf_shape] ?? LEAF.MAPLE, P.seed, j, k, P.leaf_size_m), key = `${P.seed}|${j}|${k}|${P.wall_fraction}`;
  if (!rasters.has(key)) rasters.set(key, MAZE.rasterLeaf(grown.blade, grown.maze, P.wall_fraction, NPX));
  const t = MAZE.tissues(P, P.seed, j, k, dT, cT);
  return MAZE.paintLeaf(rasters.get(key), t.wall, t.cell);
}
const firstByte = (a, b) => { if (a.length !== b.length) return -2; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
test("the held leaf mid-turn: its s and colours are its tree's lead and depth; stepping the address while a regrow waits leaves the picture on the tree it was made for", async () => {
  const seed = 290626672, hier = { nClusterTotal: 4, nLeaf: 3, twigs: [{ tree: 0 }, { tree: 2 }, { tree: 1 }, { tree: 0 }] };   // cluster 0 on tree 0, cluster 1 on tree 2
  const params = fall({ seed, phenology: 0.78, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, tree_clock_spread: 0.12, tree_pigment_spread: 0.6, leaf_shape: "maple", leaf_size_m: 0.0756, leaf_aspect: 1 });
  const ofTree = (t) => { const [v, w] = math.treeDraws(seed, t); return [math.treeShift(v, params.tree_clock_spread), math.treeGain(w, params.tree_pigment_spread)]; };
  const sOf = (j, k, dT) => math.senescence(params, math.leafClock(seed, j, k), dT);
  const H = await heldLeaf(params, hier);
  try {
    H.preview.show(true); H.tick();
    const [dT0, cT0] = ofTree(0);
    expect(sOf(0, 0, dT0) - sOf(0, 0), "the lead has moved s by a third at 0.78").toBeGreaterThan(0.3);
    expect(H.canvas.dataset.label).toContain(` · s ${sOf(0, 0, dT0).toFixed(2)} a `);
    expect(H.canvas.dataset.label).toContain(` · tree 0 Δ ${dT0.toFixed(3)} c ${cT0.toFixed(2)}`);
    expect(H.painted.length).toBe(1);
    expect(firstByte(H.painted[0], paintOf(params, 0, 0, dT0, cT0)), "the colours are tissues(…, the tree's lead, the tree's depth)").toBe(-1);
    for (const [name, wrong] of [["tree-less", [undefined, undefined]], ["lead dropped", [undefined, cT0]], ["depth dropped", [dT0, undefined]]]) expect(firstByte(H.painted[0], paintOf(params, 0, 0, ...wrong)), `the ${name} leaf is another colour`).not.toBe(-1);
    // [ ] ] ]: the address walks to 1·0, on tree 2, while the regrow it asks for waits out SETTLE_MS: the picture is still 0·0, on tree 0, in its label and its colours
    H.preview.step(1); H.preview.step(1); H.preview.step(1);
    expect(H.canvas.dataset.at).toBe("1·0");
    H.tick(10);
    expect(H.canvas.dataset.grows, "deferred, not made").toBe("1");
    expect(H.canvas.dataset.at, "the keys hold the new address").toBe("1·0");
    const [dT2] = ofTree(2);
    expect(H.canvas.dataset.label).toContain("leaf 0·0 ");
    expect(H.canvas.dataset.label).toContain(` · tree 0 Δ ${dT0.toFixed(3)} c ${cT0.toFixed(2)}`);
    expect(H.canvas.dataset.label).not.toContain(`Δ ${dT2.toFixed(3)}`);
    expect(H.canvas.dataset.label).toContain(` · s ${sOf(0, 0, dT0).toFixed(2)} a `);
    expect(H.painted.length, "nothing about the picture moved: no repaint").toBe(1);
    // a knob moves while it waits: the picture recolours live, still as the leaf and the tree it was made for
    Object.assign(params, { tree_clock_spread: 0.1, tree_pigment_spread: 0.45 });
    H.tick(10);
    const [dT0b, cT0b] = ofTree(0);
    expect(H.canvas.dataset.grows).toBe("1");
    expect(H.canvas.dataset.label).toContain("leaf 0·0 ");
    expect(H.canvas.dataset.label).toContain(` · s ${sOf(0, 0, dT0b).toFixed(2)} a `);
    expect(H.canvas.dataset.label).toContain(` · tree 0 Δ ${dT0b.toFixed(3)} c ${cT0b.toFixed(2)}`);
    expect(H.painted.length).toBe(2);
    expect(firstByte(H.painted[1], paintOf(params, 0, 0, dT0b, cT0b)), "…in the new knobs' colours, on 0·0's tree").toBe(-1);
    // settled: the picture is made for 1·0, and its tree is the one the grove hangs cluster 1 on
    H.tick(300);
    expect(H.canvas.dataset.grows).toBe("2");
    const [dT2b, cT2b] = ofTree(2);
    expect(H.canvas.dataset.label).toContain("leaf 1·0 ");
    expect(H.canvas.dataset.label).toContain(` · s ${sOf(1, 0, dT2b).toFixed(2)} a `);
    expect(H.canvas.dataset.label).toContain(` · tree 2 Δ ${dT2b.toFixed(3)} c ${cT2b.toFixed(2)}`);
    // the label's a and b are read back from the leaf's two tissues, so they carry the tree's depth (leafTau's own draws, by hand); the pixels of the leaf after a regrow are not asserted here
    const r = math.mulberry32(math.hash3((seed >>> 0) ^ 0x51ED270B, 1, 0));
    r();   // the first draw is the leaf's turn phase
    const aHand = params.anthocyanin * (0.5 + r()) * cT2b, bHand = params.tannin * (0.5 + r()) * cT2b;
    expect(H.canvas.dataset.label).toContain(` a ${aHand.toFixed(2)} b ${bHand.toFixed(2)} · tree 2`);
  } finally { H.done(); }
}, 120000);
