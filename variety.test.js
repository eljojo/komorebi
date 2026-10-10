// ============================================================================
// LEAF VARIETY (spec §4.5, `leaf_variety`, P4a-4). José, 2026-10-09: "we need much more leaf diversity, more species and more variability within species, i showed you so many
// different maple leaves from my reference photos and looking at those sheets, they all look the same to me." A species is a distribution, a tree is a family, and a leaf is a member
// under its light: each tree draws a GENOTYPE (8 to a species and seed), each genotype grows eight outlines, one per light class, shade to sun — 64 rows of the outline texture instead of
// 8 — and a leaf hangs in the row its tree's genotype and its own light (the grove's rank of exposure, the one that reddens the sun side) pick, smaller and more deeply cut in the sun.
// The claims worth holding loudly are the ones that fail SILENTLY: a draw taken from a stream that reshuffles every shipped grove, a packing that rounds a row into its neighbour at a big grove,
// a light that is the season's (so the shape would move with the day), a size shift that is not renormalised (so the canopy would be fuller or sparser), a litter that rehashes the row
// it hung in, a held leaf that computes its row from the params that run ahead of the picture, and an off state that is not the old arithmetic to the bit.
// (leaf-shape.test.js holds the outline's gate and the shaders' strings; reseason.test.js the re-season's byte-identity; the helpers below are those files' measures, copied, because a test cannot be imported.)
// ============================================================================
import { expect, test } from "bun:test";
import { DEFAULTS, TOPO_KEYS, CANOPY_KEYS } from "./komorebi.js";
import * as paramsMod from "./komorebi-params.js";
import * as math from "./komorebi-math.js";
import * as LEAF from "./komorebi-leaf.js";
import * as MAZE from "./leaf-maze.js";
import * as L from "./komorebi-litter.js";
import { GROVE_READS, makeGrove } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";

const DEG = math.DEG, TAU = math.TAU, N = LEAF.LEAF_SAMPLES;
const { MAPLE, BEECH } = LEAF;
const sum = (a) => a.reduce((s, v) => s + v, 0), mean = (a) => sum(a) / a.length;
const th = (i) => TAU * ((i + 0.5) / N - 0.5);
const G = 8, V = 8, ROWS = G * V;

// ---- 3.1 the gate ---------------------------------------------------------------------------------------------------------------
test("leaf_variety ships 0, is a TOPO key right after leaf_shape and a key buildGrove reads — and is neither a canopy (morph) key nor a season key", () => {
  expect(DEFAULTS.leaf_variety).toBe(0);
  expect(TOPO_KEYS.indexOf("leaf_variety"), "a new texture and a new row per leaf cannot interpolate: it dissolves, as leaf_shape does").toBe(TOPO_KEYS.indexOf("leaf_shape") + 1);
  expect(GROVE_READS).toContain("leaf_variety");
  expect(CANOPY_KEYS, "not a canopy key: nothing about it morphs").not.toContain("leaf_variety");
  expect(paramsMod.SEASON_KEYS, "shape is not season: a re-season never moves a row").not.toContain("leaf_variety");
});

// ---- 3.2 the salt ---------------------------------------------------------------------------------------------------------------
test("GENOTYPE_SALT is 4·0x9E3779B9 mod 2^32, distinct from every salt in the repo, and its draws are uncorrelated with each of their streams", () => {
  const GOLD = 0x9E3779B9;
  expect(LEAF.GENOTYPE_SALT).toBe(0x78DDE6E4);
  expect(LEAF.GENOTYPE_SALT, "the golden gamma's next multiple after the inner-leaves salt's 3·").toBe((4 * GOLD) % 2 ** 32);
  const others = { variant: LEAF.VARIANT_SALT, outline: LEAF.OUTLINE_SALT, flip: LEAF.FLIP_SALT, litter: L.LITTER_SALT, leaf: 0x51ED270B, drop: 0x7A3C91D5, wind: 0x5bd1e995, growth: 0x5EED, tree: math.TREE_SALT, inner: 0xDAA66D2B, areole: MAZE.AREOLE_SALT };
  const all = [LEAF.GENOTYPE_SALT, ...Object.values(others)];
  expect(new Set(all).size, "no two salts alike").toBe(all.length);
  expect(math.TREE_SALT).toBe((2 * GOLD) % 2 ** 32);
  expect(others.inner).toBe((3 * GOLD) % 2 ** 32);
  const corr = (u, w) => {
    const n = u.length, mu = mean(u), mw = mean(w);
    let suw = 0, suu = 0, sww = 0;
    for (let i = 0; i < n; i++) { suw += (u[i] - mu) * (w[i] - mw); suu += (u[i] - mu) ** 2; sww += (w[i] - mw) ** 2; }
    return suw / Math.sqrt(suu * sww);
  };
  const cells = Array.from({ length: 2000 }, (_, i) => [i >> 4, i & 15]), seed = 77;
  const first = (salt, a, b) => math.mulberry32(math.hash3((seed ^ salt) >>> 0, a, b))();
  const mine = cells.map(([a, b]) => first(LEAF.GENOTYPE_SALT, a, b));
  for (const [name, salt] of Object.entries(others)) expect(Math.abs(corr(mine, cells.map(([a, b]) => first(salt, a, b)))), name).toBeLessThan(0.1);
});

// ---- 3.3 level 1: the tree's genotype -------------------------------------------------------------------------------------------
test("treeGenotype is the tree stream's THIRD draw — draws 1 and 2 stay the lead and the depth, so tree_clock_spread and tree_pigment_spread keep their bits", () => {
  for (const seed of [290626672, 4242, 77]) for (let t = 0; t < 12; t++) {
    const r = math.mulberry32(math.hash3((seed >>> 0) ^ math.TREE_SALT, t, 0));
    const lead = r(), depth = r(), third = r();
    expect(math.treeGenotype(seed, t, G), `seed ${seed} tree ${t}`).toBe(Math.floor(third * G));
    expect(math.treeDraws(seed, t), "the first two are treeDraws' own").toEqual([lead, depth]);
  }
  expect(Array.from({ length: 8 }, (_, t) => math.treeGenotype(290626672, t, G)), "the shipped seed's eight trees, frozen").toEqual([6, 0, 1, 0, 1, 2, 3, 2]);
  expect(Array.from({ length: 8 }, (_, t) => math.treeGenotype(4242, t, G))).toEqual([0, 1, 4, 4, 4, 7, 1, 3]);
  // pure per (seed, t): the same at any tree count, the marginal tree included — nothing to advance
  expect(math.treeGenotype(290626672, 5, G)).toBe(math.treeGenotype(290626672, 5, G));
  expect(Array.from({ length: 4 }, (_, t) => math.treeGenotype(1, t, 16)).every((g) => g >= 0 && g < 16)).toBe(true);
  // uniform over the eight (4000 trees, ±3.6σ), and no tree's genotype is its lead or its depth in disguise
  const trees = Array.from({ length: 4000 }, (_, t) => t), geno = trees.map((t) => math.treeGenotype(77, t, G)), draws = trees.map((t) => math.treeDraws(77, t));
  const counts = new Array(G).fill(0);
  for (const g of geno) counts[g]++;
  for (const c of counts) expect(Math.abs(c - 500)).toBeLessThan(80);
  const corr = (u, w) => {
    const mu = mean(u), mw = mean(w);
    let suw = 0, suu = 0, sww = 0;
    for (let i = 0; i < u.length; i++) { suw += (u[i] - mu) * (w[i] - mw); suu += (u[i] - mu) ** 2; sww += (w[i] - mw) ** 2; }
    return suw / Math.sqrt(suu * sww);
  };
  expect(Math.abs(corr(geno, draws.map((d) => d[0]))), "not the lead").toBeLessThan(0.1);
  expect(Math.abs(corr(geno, draws.map((d) => d[1]))), "not the depth").toBeLessThan(0.1);
});

// ---- 3.5 the rows, by hand ------------------------------------------------------------------------------------------------------
// rowSpec at (seed, variety v, row = g·8 + c): the genotype stream (draws in this order: lateral angle ±5°, basal length ±0.15, rho ±0.025, lateral length ±0.07), the leaf stream (±5°, ±0.12, ±0.02,
// ±0.06, basal angle ±10°) and the light class c: λ = (c + ½)/8 − ½, whose deeper cut in the sun is RHO_LIGHT·v·λ off the lobe breadth.
const U = (r) => 2 * r() - 1;
function byHand(seed, v, row) {
  const g = Math.floor(row / V), c = row % V;
  const Gs = math.mulberry32(math.hash3((seed >>> 0) ^ 0x78DDE6E4, 1, g)), Ls = math.mulberry32(math.hash3((seed >>> 0) ^ 0x78DDE6E4, 1, G + row));
  const dLatG = 5 * U(Gs), dBasG = 0.15 * U(Gs), dRhoG = 0.025 * U(Gs), dLenG = 0.07 * U(Gs);
  const dLatL = 5 * U(Ls), dBasL = 0.12 * U(Ls), dRhoL = 0.02 * U(Ls), dLenL = 0.06 * U(Ls), dBasAng = 10 * U(Ls);
  const lam = (c + 0.5) / V - 0.5, lat = 43 + v * (dLatG + dLatL), ba = 95 + v * dBasAng, bl = Math.max(0.12, 0.36 + v * (dBasG + dBasL)), ll = 0.85 + v * (dLenG + dLenL);
  const rhoBase = 0.21 + v * (dRhoG + dRhoL);
  return { angles: [-ba, -lat, 0, lat, ba], lengths: [bl, ll, 1, ll, bl], rho: rhoBase - 0.04 * v * lam, rhoBase, lam };
}
test("rowSpec by hand: both GENOTYPE_SALT streams replayed draw for draw, and the light class λ from the COLUMN — 3 seeds × 64 rows, every field to 1e-15", () => {
  expect([LEAF.VARIETY_GENOTYPES, LEAF.VARIETY_COLUMNS, LEAF.VARIETY_ID_FRAC, LEAF.VARIETY_JITTER, LEAF.RHO_LIGHT, LEAF.SIZE_LIGHT]).toEqual([8, 8, 128, 2, 0.04, 0.15]);
  for (const seed of [1, 1234, 290626672]) for (const v of [1, 0.5]) for (let row = 0; row < ROWS; row++) {
    const got = LEAF.rowSpec(MAPLE, seed, v, row), want = byHand(seed, v, row), tag = `seed ${seed} v ${v} row ${row}`;
    got.angles.forEach((a, i) => { expect(Math.abs(a - want.angles[i]), `${tag} angle ${i}`).toBeLessThan(1e-13); });   // degrees: 1e-15 relative to ~100
    got.lengths.forEach((a, i) => { expect(Math.abs(a - want.lengths[i]), `${tag} length ${i}`).toBeLessThan(1e-15); });
    expect(Math.abs(got.rho - want.rho), `${tag} rho`).toBeLessThan(1e-15);
    for (const key of Object.keys(MAPLE)) if (!["angles", "lengths", "rho"].includes(key)) expect(got[key], `${tag}: ${key} is the species'`).toEqual(MAPLE[key]);
  }
  expect(LEAF.rowSpec(BEECH, 1234, 1, 17), "the beech has no genotype numbers: its rows differ by their growth streams only").toBe(BEECH);
  // the light, isolated: rho less the genotype and leaf draws is −RHO_LIGHT·v·λ with λ the COLUMN's — a narrower lobe (a deeper cut) in the sun, a fuller one in the shade, whatever the genotype
  for (const row of [0, 7, 8 + 3, 5 * V + 4, 63]) {
    const got = LEAF.rowSpec(MAPLE, 1234, 1, row), want = byHand(1234, 1, row), lam = ((row % V) + 0.5) / V - 0.5;
    expect(Math.abs(got.rho - want.rhoBase + 0.04 * lam), `row ${row}`).toBeLessThan(1e-15);
    expect(Math.sign(got.rho - want.rhoBase), `row ${row}: the sun cuts deeper`).toBe(-Math.sign(lam));
  }
  // at variety 0 a row is the variety-0 leaf of that number, bit for bit: the rows a grove at 0 hangs are the first eight of a grove at 1's table's recipe
  for (let r = 0; r < 8; r++) expect(Array.from(LEAF.rowBlade(MAPLE, 1234, 0, r).r), `row ${r} at variety 0`).toEqual(Array.from(LEAF.profile(MAPLE, LEAF.outlineSeed(MAPLE, 1234, r))));
});

test("rowBlade is bladeOf of the row's spec and the row's own growth stream — one function for the texture and the held leaf", () => {
  for (const row of [0, 9, 27, 63]) {
    const a = LEAF.rowBlade(MAPLE, 1234, 1, row), b = LEAF.bladeOf(LEAF.rowSpec(MAPLE, 1234, 1, row), LEAF.outlineSeed(MAPLE, 1234, row));
    expect(Array.from(a.r)).toEqual(Array.from(b.r));
    expect(a.k).toBe(b.k);
    expect(a.grammar).toBe("palmate");
  }
  expect(LEAF.rowBlade(BEECH, 1234, 1, 30).grammar).toBe("pinnate");
  expect(Array.from(LEAF.rowBlade(BEECH, 1234, 1, 30).r), "a beech's row is its outline-seed leaf").toEqual(Array.from(LEAF.profile(BEECH, LEAF.outlineSeed(BEECH, 1234, 30))));
});

// leafColumn: V·u + VARIETY_JITTER·(h − ½), floored and clamped to the eight columns — the jitter (±one column) is leafJitter's, the very draw leafVariant floors
test("leafJitter is leafVariant's own draw and leafColumn is floor(8u + 2(h − ½)) clamped to 0..7", () => {
  for (const [j, k] of [[0, 0], [3, 5], [41, 2], [900, 11]]) {
    expect(LEAF.leafJitter(77, j, k)).toBe(math.mulberry32(math.hash3((77 >>> 0) ^ LEAF.VARIANT_SALT, j, k))());
    expect(LEAF.leafVariant(77, j, k), "the old pick is the same draw floored").toBe(Math.floor(LEAF.leafJitter(77, j, k) * LEAF.LEAF_VARIANTS));
  }
  expect(LEAF.leafColumn(0, 0), "clamped at the shade end").toBe(0);
  expect(LEAF.leafColumn(0.999, 1), "clamped at the sun end").toBe(7);
  expect(LEAF.leafColumn(0.5, 0.5), "no jitter at h = ½").toBe(4);
  expect(LEAF.leafColumn(0.5, 0), "a column of shade at h = 0").toBe(3);
  expect(LEAF.leafColumn(0.5, 1), "...and of sun at h = 1").toBe(5);
  for (let i = 0; i < 400; i++) { const u = (i + 0.5) / 400, h = (i * 0.618) % 1; expect(LEAF.leafColumn(u, h)).toBe(Math.min(7, Math.max(0, Math.floor(8 * u + 2 * (h - 0.5))))); }
});

// ---- 3.4 the texture ------------------------------------------------------------------------------------------------------------
test("leafShape(name, seed, 0) is leafShape(name, seed) — the very object, eight rows, no new field — for the maple and the beech", () => {
  for (const name of ["maple", "beech"]) {
    const s = LEAF.leafShape(name, 1234);
    expect(LEAF.leafShape(name, 1234, 0)).toBe(s);
    expect(LEAF.leafShape(name, 1234, undefined)).toBe(s);
    expect(LEAF.leafShape(name, 1234, -1), "not a positive number: not varied").toBe(s);
    expect(s.rows).toBe(8);
    expect(Object.keys(s).sort(), "today's descriptor, literally").toEqual(["box", "data", "name", "reach", "rmax", "rows"]);
  }
  expect(LEAF.leafShape("ellipse", 1234, 1), "the ellipse has no variety").toBeNull();
});

test("leafShape(name, seed, v > 0): 64 rows of rowBlade, the union box, idFrac 128, eight a tree, memoised on (name, seed, variety)", () => {
  for (const name of ["maple", "beech"]) {
    const spec = LEAF.LEAF_SHAPES[name], s = LEAF.leafShape(name, 1234, 1);
    expect(s.name).toBe(name);
    expect(s.rows).toBe(ROWS);
    expect(s.idFrac).toBe(128);
    expect(s.perTree).toBe(8);
    expect(s.variety).toBe(1);
    expect(s.data).toBeInstanceOf(Float32Array);
    expect(s.data.length).toBe(ROWS * N);
    for (let row = 0; row < ROWS; row++) {
      const r = LEAF.rowBlade(spec, 1234, 1, row).r;
      for (let i = 0; i < N; i++) if (s.data[row * N + i] !== Math.fround(r[i])) throw new Error(`${name} row ${row} sample ${i}`);
    }
    expect(LEAF.leafShape(name, 1234, 1)).toBe(s);
    expect(LEAF.leafShape(name, 1234, 0.5)).not.toBe(s);
    expect(LEAF.leafShape(name, 1235, 1)).not.toBe(s);
    expect(LEAF.leafShape(name, 1234)).not.toBe(s);
    const [cx, cy, hx, hy] = s.box;
    let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
    for (let row = 0; row < ROWS; row++) for (let i = 0; i < N; i++) {
      const x = s.data[row * N + i] * Math.cos(th(i)), y = s.data[row * N + i] * Math.sin(th(i));
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    expect(cx - hx).toBeCloseTo(x0 - 0.01, 9); expect(cx + hx).toBeCloseTo(x1 + 0.01, 9);   // the union of all 64, a pad of 0.01 a side
    expect(cy - hy).toBeCloseTo(y0 - 0.01, 9); expect(cy + hy).toBeCloseTo(y1 + 0.01, 9);
    expect(s.reach).toBeCloseTo(Math.hypot(Math.abs(cx) + hx, Math.abs(cy) + hy), 12);
    expect(s.rmax).toBe(Math.max(...s.data));
    expect(s.rmax, "a box that covers 64 outlines is not narrower than one that covers 8").toBeGreaterThanOrEqual(LEAF.leafShape(name, 1234).rmax - 1e-6);
  }
  // 64 outlines of a maple are bigger than eight: the box and the reach the litter culls by grow with them
  expect(LEAF.leafShape("maple", 1234, 1).reach).toBeGreaterThan(LEAF.leafShape("maple", 1234).reach);
});

test("every row of a varied maple is a leaf: area π to 1e-9 and star-shaped from the petiole base (one run along every ray, the clip too) — the whole table, 3 seeds", () => {
  for (const seed of [1, 1234, 90210]) for (let row = 0; row < ROWS; row++) {
    const spec = LEAF.rowSpec(MAPLE, seed, 1, row), blade = LEAF.rowBlade(MAPLE, seed, 1, row), tag = `seed ${seed} row ${row}`;
    let a = 0;
    for (let i = 0; i < N; i++) a += 0.5 * blade.r[i] * blade.r[i] * (TAU / N);
    expect(Math.abs(a - Math.PI), tag).toBeLessThan(1e-9);
    const { discs } = LEAF.growLeaf(spec, math.mulberry32(LEAF.outlineSeed(MAPLE, seed, row)));
    for (let i = 0; i < N; i++) {
      const c = Math.cos(th(i)), s = Math.sin(th(i)), chords = [];
      for (let k = 0; k < discs.length; k += 3) {
        const b = discs[k] * c + discs[k + 1] * s, h = b * b - (discs[k] ** 2 + discs[k + 1] ** 2 - discs[k + 2] ** 2);
        if (h >= 0) chords.push([b - Math.sqrt(h), b + Math.sqrt(h)]);
      }
      const ahead = chords.filter(([, t1]) => t1 > 0).map(([t0, t1]) => [Math.max(t0, 0), t1]).sort((p, q) => p[0] - q[0]);
      let reach = ahead[0][1], runs = 1;
      for (const [t0, t1] of ahead.slice(1)) { if (t0 > reach + 0.01) runs++; reach = Math.max(reach, t1); }
      if (runs !== 1) throw new Error(`${tag} ray ${i}: ${runs} runs`);
      if (c < 0) expect(blade.r[i] * -c, `${tag} ray ${i}: the truncate base`).toBeLessThanOrEqual(spec.back * blade.k + 1e-12);
    }
  }
});

test("every row of a varied beech is a leaf too: area π to 1e-9 over the whole table, 3 seeds (its rows differ by their growth streams alone, so the area is the normalisation's and nothing else's)", () => {
  for (const seed of [1, 1234, 90210]) for (let row = 0; row < ROWS; row++) {
    const r = LEAF.rowBlade(BEECH, seed, 1, row).r;
    let a = 0;
    for (let i = 0; i < N; i++) a += 0.5 * r[i] * r[i] * (TAU / N);
    expect(Math.abs(a - Math.PI), `seed ${seed} row ${row}`).toBeLessThan(1e-9);
  }
});

// ---- 3.6 the spread -------------------------------------------------------------------------------------------------------------
const rms = (a, b) => Math.sqrt(mean(Array.from(a, (v, i) => (v - b[i]) ** 2)));
const mirror = (r) => Float64Array.from({ length: N }, (_, i) => r[N - 1 - i]);
const rmsM = (a, b) => Math.min(rms(a, b), rms(a, mirror(b)));
function measure(r) {
  const sm = new Float64Array(N);
  for (let i = 0; i < N; i++) { let s = 0; for (let d = -3; d <= 3; d++) s += r[(i + d + N) % N]; sm[i] = s / 7; }
  const maxima = [];
  for (let i = 0; i < N; i++) {
    let ok = true;
    for (let d = -10; d <= 10; d++) if (d && sm[(i + d + N) % N] > sm[i]) { ok = false; break; }
    if (ok && sm[i] > 0.3) maxima.push(i);
  }
  const merged = [];
  for (const i of maxima) if (!merged.length || Math.min(Math.abs(i - merged[merged.length - 1]), N - Math.abs(i - merged[merged.length - 1])) > 12) merged.push(i);
  const lobes = merged.filter((i) => Math.abs(th(i)) < 125 * DEG).sort((a, b) => th(a) - th(b));
  const c = lobes.findIndex((i) => Math.abs(th(i)) < 10 * DEG);
  return { lobes, c, flanked: c > 0 && c < lobes.length - 1 };
}
function hullArea(p) {
  const q = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const x of q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop(); lo.push(x); }
  for (const x of q.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], x) <= 0) up.pop(); up.push(x); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let s = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i], b = h[(i + 1) % h.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
const solidity = (r) => Math.PI / hullArea(Array.from(r, (rr, i) => [rr * Math.cos(th(i)), rr * Math.sin(th(i))]));
const table = (seed, v) => Array.from({ length: ROWS }, (_, row) => LEAF.rowBlade(MAPLE, seed, v, row).r);

test("the spread at variety 1: pairwise 0.12–0.20 over the 64 rows, one tree's leaves more alike than two trees', every row a central lobe flanked by two, the sun more deeply cut than the shade", () => {
  for (const seed of [1, 1234, 90210]) {
    const rows = table(seed, 1), pair = [], within = [], between = [];
    for (let a = 0; a < ROWS; a++) for (let b = a + 1; b < ROWS; b++) { const d = rmsM(rows[a], rows[b]); pair.push(d); (Math.floor(a / V) === Math.floor(b / V) ? within : between).push(d); }
    expect(mean(pair), `seed ${seed}: pairwise`).toBeGreaterThan(0.12); expect(mean(pair), `seed ${seed}: pairwise`).toBeLessThan(0.20);
    expect(mean(within), `seed ${seed}: a family is more alike than a stand`).toBeLessThan(mean(between));
    // the laterals' angles at v = 1, measured: 33.0–52.7° (seed 1), 31.6–54.1° (1234), 33.0–54.1° (90210) with means 44.4, 42.3 and 43.7 — 28.8–55.5° over five seeds (4242 and 290626672 too) — against his 33–50°, mean 43. The band holds every row; the mean is held to his 43 ± 4
    const lat = [];
    rows.forEach((r, row) => {
      const m = measure(r);
      expect(m.flanked, `seed ${seed} row ${row}: a central lobe within 10° of the axis with a lobe each side`).toBe(true);
      for (const i of [m.lobes[m.c - 1], m.lobes[m.c + 1]]) { const a = Math.abs(th(i) / DEG); expect(a, `seed ${seed} row ${row}`).toBeGreaterThan(28); expect(a, `seed ${seed} row ${row}`).toBeLessThan(58); lat.push(a); }
    });
    expect(mean(lat), `seed ${seed}: the laterals' mean, his 43° ± 4`).toBeGreaterThan(40); expect(mean(lat), `seed ${seed}: the laterals' mean, his 43° ± 4`).toBeLessThan(47);
    const sol = rows.map(solidity), shade = sol.filter((_, row) => row % V < 4), sun = sol.filter((_, row) => row % V >= 4);
    expect(mean(shade) - mean(sun), `seed ${seed}: sun leaves are the deeper cut (lower solidity) by at least 0.015`).toBeGreaterThanOrEqual(0.015);
  }
});

test("variety scales the spread: 0.5 is narrower than 1 and 1 than 1.5", () => {
  const d = (v) => { const rows = table(1234, v), pair = []; for (let a = 0; a < ROWS; a++) for (let b = a + 1; b < ROWS; b++) pair.push(rmsM(rows[a], rows[b])); return mean(pair); };
  expect(d(0.5)).toBeLessThan(d(1));
  expect(d(1)).toBeLessThan(d(1.5));
});

// ---- 3.11 the packing -----------------------------------------------------------------------------------------------------------
test("the packing: j + row/128 round-trips for every cluster below 2^17 and every row 0–63 — and does not at 2^17, so the bound is real", () => {
  const ok = (j, r) => {
    const w = Math.fround(j + r / 128), f = w - Math.floor(w);                 // fract() of a float32 below 2^17 is exact: the seven bits under the cluster
    return Math.floor(w) === j && Math.floor(w + 0.5) === j && Math.floor(Math.fround(f * 128) + 0.5) === r && Math.floor((w - j) * 128 + 0.5) === r;
  };
  const js = [];
  for (let j = 0; j < 2 ** 14; j++) js.push(j);
  for (let j = 2 ** 17 - 4096; j < 2 ** 17; j++) js.push(j);
  for (const j of js) for (let r = 0; r < ROWS; r++) if (!ok(j, r)) throw new Error(`j ${j} row ${r} does not round-trip`);
  for (let j = 2 ** 14; j < 2 ** 17 - 4096; j += 97) for (const r of [0, 1, 31, 32, 62, 63]) if (!ok(j, r)) throw new Error(`j ${j} row ${r} does not round-trip`);
  expect(Math.fround(131071 + 63 / 128), "the largest cluster the packing holds, at the largest row").toBe(131071 + 63 / 128);
  expect(ok(2 ** 17, 63), "one cluster past it, float32 rounds the row into the next").toBe(false);
  expect(Math.fround(2 ** 17 + 63 / 128)).not.toBe(2 ** 17 + 63 / 128);
  expect(LEAF.LEAF_ID_FRAC, "the eight-row grove keeps its 32ths").toBe(32);
  expect((ROWS - 1) / LEAF.VARIETY_ID_FRAC, "a fraction under ½, or int(iC.w + 0.5) would round up into the next cluster").toBeLessThan(0.5);
  // the engine caps a grove at the GPU's MAX_TEXTURE_SIZE (16384 on most, 32768 on desktop GL): both are inside 2^17
  expect(32768).toBeLessThan(2 ** 17);
});

// ---- the grove ------------------------------------------------------------------------------------------------------------------
function glStub() {
  const calls = [];
  let nTex = 0;
  const gl = new Proxy({}, {
    get(t, name) {
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) return name;
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      if (name === "createTexture") return () => ({ tex: nTex++ });
      if (name === "bindTexture") return (_target, tx) => { t.bound = tx; };
      return (...a) => { calls.push({ name, tex: t.bound, a }); return {}; };
    },
  });
  return { gl, calls };
}
function rig(over, { faithful = false, keep = false } = {}) {
  const { gl, calls } = glStub();
  const params = { ...DEFAULTS, tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, ...over };
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  const G_ = makeGrove(hub), g = G_.buildGrove(null, keep ? { keepSeason: true } : undefined);
  const on = (tx, name) => calls.filter((c) => c.tex === tx && c.name === name).map((c) => c.a);
  return { params, g, on, G: G_, hub, faith, layers: g.layerVAO.map((l) => l.buf.data), faithLeaves: faith.buf.data, litter: g.litter };
}
const MAPLE_LOOK = { ...PRESETS["afternoon 7"], leaf_shape: "maple", leaf_aspect: 1, leaf_size_m: 0.103, seed: 4242 };
const sameBits = (a, b, label, skip = [], stride = 17) => {   // a layer's record is 17 floats, the faithful buffer's 18
  expect(a.length, `${label}: length`).toBe(b.length);
  for (let i = 0; i < a.length; i++) if (!skip.includes(i % stride) && !Object.is(a[i], b[i])) throw new Error(`${label}: float ${i} (column ${i % stride}) ${a[i]} vs ${b[i]}`);
};

// ---- 3.7 the off state ----------------------------------------------------------------------------------------------------------
test("OFF: leaf_variety 0 and absent hang the grove they always did — every float of both buffers the same bits, the 256 × 8 texture, no row anywhere — for the maple and the beech; the ellipse is the ellipse at 1", () => {
  for (const shape of ["maple", "beech"]) {
    const base = { ...MAPLE_LOOK, leaf_shape: shape, phenology: 0.9, leaf_drop: 1 };
    const zero = rig({ ...base, leaf_variety: 0 }), absent = rig({ ...base, leaf_variety: undefined });
    zero.layers.forEach((Lr, l) => { sameBits(Lr, absent.layers[l], `${shape} layer ${l}`); });
    sameBits(zero.faithLeaves, absent.faithLeaves, `${shape} faithful`, [], 18);
    for (const R of [zero, absent]) {
      expect(R.g.shape, "today's descriptor").toBe(LEAF.leafShape(shape, 4242));
      expect(R.on(R.g.leafTex, "texImage2D")).toEqual([["TEXTURE_2D", 0, "R16F", 256, 8, 0, "RED", "FLOAT", R.g.shape.data]]);
      expect(R.g.hier.leafRow, "no table of rows").toBe(null);
      expect(R.g.hier.leafVariety).toBe(0);
      expect(R.g.scaleMax, "no size shift").toBeUndefined();
      expect(R.litter.length, "leaves fell").toBeGreaterThan(50);
      for (const item of R.litter) expect("row" in item, "no litter row").toBe(false);
      for (const Lr of R.layers) for (let i = 11; i < Lr.length; i += 17) expect(Lr[i], "the old packing, j + variant/32").toBe(Math.fround(Math.floor(Lr[i]) + Math.round((Lr[i] - Math.floor(Lr[i])) * 32) / 32));
    }
  }
  const e0 = rig({ ...MAPLE_LOOK, leaf_shape: "ellipse", leaf_variety: 0 }), e1 = rig({ ...MAPLE_LOOK, leaf_shape: "ellipse", leaf_variety: 1 });
  e0.layers.forEach((Lr, l) => { sameBits(Lr, e1.layers[l], `ellipse layer ${l}`); });
  sameBits(e0.faithLeaves, e1.faithLeaves, "ellipse faithful", [], 18);
  expect(e1.g.shape).toBeNull();
  expect(e1.g.hier.leafRow).toBe(null);
  expect(e1.on(e1.g.leafTex, "texImage2D")).toEqual([["TEXTURE_2D", 0, "R16F", 1, 1, 0, "RED", "HALF_FLOAT", null]]);
});

// ---- 3.8 the grove, on ----------------------------------------------------------------------------------------------------------
const ON = { ...MAPLE_LOOK, tree_count: 4, foliage_density: 1.5, exposure_absolute: 0.7 };
const SREC = 11;
test("ON (layer and faithful): the same grove but for each leaf's size and its row — and the row is the tree's genotype and the leaf's own light, by hand", () => {
  for (const faithful of [false, true]) {
    const off = rig({ ...ON, leaf_variety: 0 }, { faithful, keep: true }), on = rig({ ...ON, leaf_variety: 1 }, { faithful, keep: true }), tag = faithful ? "faithful" : "layer";
    const seed = ON.seed, S0 = off.g.season, S1 = on.g.season, hier = on.g.hier, nLeaf = hier.nLeaf;
    // (a) everything but the size (floats 2, 3) and the cluster id's fraction (11) is the variety-0 grove's — tau, orbit, fade, height, position, angle, flips
    on.layers.forEach((Lr, l) => { sameBits(Lr, off.layers[l], `${tag} layer ${l}`, [2, 3, 11]); });
    sameBits(on.faithLeaves, off.faithLeaves, `${tag} faithful`, [2, 3, 11], 18);
    expect(JSON.stringify(on.g.hier.twigs), "the growth is the variety-0 grove's").toBe(JSON.stringify(off.g.hier.twigs));
    expect(JSON.stringify(on.g.hier.segments)).toBe(JSON.stringify(off.g.hier.segments));
    expect((ON.leaves_per_cluster * ON.foliage_density) % 1, "a marginal leaf: the table counts it").toBeGreaterThan(1e-4);
    expect(nLeaf).toBe(Math.floor(ON.leaves_per_cluster * ON.foliage_density) + 1);
    expect(S1.n).toBe(S0.n);
    // (d) the row by hand, from the doubles of the variety-0 build's record (x, y, h, the PRE-shift area) — never from the float32 buffers, whose rounding re-ranks ties
    const n = S0.n, X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), Ar = new Float64Array(n), K = new Float64Array(n);
    for (let i = 0; i < n; i++) { const o = SREC * i; X[i] = S0.rec[o]; Y[i] = S0.rec[o + 1]; Z[i] = S0.rec[o + 2]; Ar[i] = S0.rec[o + 5]; K[i] = math.leafClock(seed, S0.rec[o + 6], S0.rec[o + 7]); }
    const rank = math.exposureRank(math.exposureGrid(X, Y, Z, Ar, S0.E), K);
    const geno = Array.from({ length: S0.nTree }, (_, t) => math.treeGenotype(seed, t, G)), m = (u) => 1 + LEAF.SIZE_LIGHT * 1 * (1 - 2 * u);
    let s0 = 0, s1 = 0;
    for (let i = 0; i < n; i++) { const o = SREC * i, w = S0.rec[o + 8] * S0.rec[o + 3] * S0.rec[o + 4]; s0 += w; s1 += w * m(rank[i]) ** 2; }
    const kappa = Math.sqrt(s0 / s1);
    let smax = 0, cols = new Set(), genos = new Set(), leaves = 0;
    for (let i = 0; i < n; i++) {
      const o = SREC * i, j = S0.rec[o + 6], k = S0.rec[o + 7], l = S0.rec[o + 9], at = S0.rec[o + 10];
      const row = geno[S0.nTree > 0 ? hier.twigs[j].tree : 0] * V + LEAF.leafColumn(rank[i], LEAF.leafJitter(seed, j, k)), s = kappa * m(rank[i]);
      expect(hier.leafRow[j * nLeaf + k], `${tag} leaf ${j}/${k}: its row`).toBe(row);
      cols.add(row % V); genos.add(Math.floor(row / V)); leaves++;
      // (c) the packing the VS reads: j + row/128 in both buffers — the cluster, the rounded cluster and the row all recoverable
      const wL = on.layers[l][at + 11], wF = on.faithLeaves[18 * i + 11];
      for (const w of [wL, wF]) {
        expect(w, `${tag} leaf ${j}/${k}`).toBe(Math.fround(j + row / 128));
        expect(Math.floor(w)).toBe(j); expect(Math.floor(w + 0.5)).toBe(j); expect(Math.floor((w - j) * 128 + 0.5)).toBe(row);
      }
      // (b), (e) A === B0, A_v/A_0 = κ·m(u) — in doubles from the records, and to a float32 in the buffers
      const a0 = S0.rec[o + 3], b0 = S0.rec[o + 4], av = S1.rec[o + 3], bv = S1.rec[o + 4];
      expect(Math.abs(av / a0 / s - 1), `${tag} leaf ${j}/${k}: the shift is κ·m`).toBeLessThan(1e-12);
      expect(Math.abs(bv / b0 / s - 1)).toBeLessThan(1e-12);
      expect(Object.is(S1.rec[o + 5], S0.rec[o + 5]), "the record keeps the PRE-shift area: the light's input").toBe(true);
      expect(on.layers[l][at + 2]).toBe(on.layers[l][at + 3]);
      expect(on.faithLeaves[18 * i + 2]).toBe(on.faithLeaves[18 * i + 3]);
      expect(on.layers[l][at + 2]).toBe(Math.fround(av)); expect(on.faithLeaves[18 * i + 2]).toBe(Math.fround(av));
      smax = Math.max(smax, s);
    }
    // the shift is renormalised, cov-weighted: Σ cov·A·B0 is the variety-0 grove's
    let t0 = 0, t1 = 0;
    for (let i = 0; i < n; i++) { const o = SREC * i; t0 += S0.rec[o + 8] * S0.rec[o + 3] * S0.rec[o + 4]; t1 += S1.rec[o + 8] * S1.rec[o + 3] * S1.rec[o + 4]; }
    expect(Math.abs(t1 / t0 - 1), `${tag}: the canopy is as full as it was`).toBeLessThan(1e-12);
    expect(Math.abs(on.g.scaleMax / smax - 1), `${tag}: scaleMax is the largest shift`).toBeLessThan(1e-12);
    expect(off.g.scaleMax).toBeUndefined();
    expect(smax, "the sun leaves are not shrunk to nothing").toBeLessThan(1.3);
    // the table the grove hands the editor, and the texture the bake reads
    expect(hier.leafVariety).toBe(1);
    expect(hier.leafRow).toBeInstanceOf(Uint8Array);
    expect(hier.leafRow.length).toBe(hier.nClusterTotal * nLeaf);
    expect(on.g.shape).toBe(LEAF.leafShape("maple", seed, 1));
    expect(on.on(on.g.leafTex, "texImage2D")).toEqual([["TEXTURE_2D", 0, "R16F", 256, 64, 0, "RED", "FLOAT", on.g.shape.data]]);
    expect(cols.size, "all eight light classes are in use").toBe(8);
    expect(genos.size, "more than one family").toBeGreaterThanOrEqual(2);
    expect(leaves).toBeGreaterThan(1000);
    // the variety-0 grove, on the other hand, is untouched by there being a pass at all
    expect(off.g.hier.leafRow).toBe(null);
  }
});

// The marginal tree (tree_count 2.4: two full trees and a third faded in by 0.4) has a genotype like any other, treeGenotype being pure in (seed, t), so its leaves hang in rows and the cluster ids they carry stay numbers.
test("a marginal tree hangs in its own genotype: at tree_count 2.4 every leaf of the third tree is in treeGenotype's family and no cluster id is NaN", () => {
  for (const faithful of [false, true]) {
    const R = rig({ ...MAPLE_LOOK, tree_count: 2.4, leaf_variety: 1 }, { faithful, keep: true }), S = R.g.season, hier = R.g.hier, nLeaf = hier.nLeaf, seed = MAPLE_LOOK.seed, tag = faithful ? "faithful" : "layer";
    let marginal = 0;
    for (let i = 0; i < S.n; i++) {
      const o = SREC * i, j = S.rec[o + 6], k = S.rec[o + 7], tree = hier.twigs[j].tree, row = hier.leafRow[j * nLeaf + k];
      if (tree === 2) marginal++;
      expect(Math.floor(row / V), `${tag} leaf ${j}/${k} on tree ${tree}: its family is treeGenotype's`).toBe(math.treeGenotype(seed, tree, G));
      for (const w of [R.layers[S.rec[o + 9]][S.rec[o + 10] + 11], R.faithLeaves[18 * i + 11]]) {
        expect(Number.isFinite(w), `${tag} leaf ${j}/${k}: the cluster id is a number`).toBe(true);
        expect(w).toBe(Math.fround(j + row / 128));
      }
    }
    expect(marginal, `${tag}: the marginal tree hangs leaves`).toBeGreaterThan(50);
  }
});

// ---- 3.9 shape is not season ----------------------------------------------------------------------------------------------------
test("shape is not season: in a fall, leaf_variety moves no leaf's colour, day, retained weight or rank of light — only its size and the row the litter lies in", () => {
  const fall = { ...MAPLE_LOOK, tree_count: 3, phenology: 0.85, turn_exposure: 1, leaf_drop: 1, drop_exposure: 0.5, anthocyanin: 0.6 };
  for (const faithful of [false, true]) {
    const off = rig({ ...fall, leaf_variety: 0 }, { faithful, keep: true }), on = rig({ ...fall, leaf_variety: 1 }, { faithful, keep: true }), tag = faithful ? "faithful" : "layer";
    on.layers.forEach((Lr, l) => { sameBits(Lr, off.layers[l], `${tag} layer ${l}`, [2, 3, 11]); });
    sameBits(on.faithLeaves, off.faithLeaves, `${tag} faithful`, [2, 3, 11], 18);
    expect(on.g.hier.leafW.length).toBe(off.g.hier.leafW.length);
    on.g.hier.leafW.forEach((w, i) => { if (!Object.is(w, off.g.hier.leafW[i])) throw new Error(`${tag} leafW ${i}`); });
    const a = on.g.season.rank, b = off.g.season.rank;
    expect(a, "the season's rank was built").not.toBe(null);
    expect(a.length).toBe(b.length);
    a.forEach((u, i) => { if (!Object.is(u, b[i])) throw new Error(`${tag} rank ${i}: the season's light moved with the shape`); });
    expect(on.litter.length, "leaves fell").toBeGreaterThan(100);
    expect(on.litter.length).toBe(off.litter.length);
    const strip = (l) => { const c = { ...l }; delete c.size; delete c.row; return c; };
    expect(JSON.stringify(on.litter.map(strip)), `${tag}: the litter lists are equal but for size and row`).toBe(JSON.stringify(off.litter.map(strip)));
    for (const [q, item] of on.litter.entries()) {
      expect(item.row, `${tag}: a fallen leaf lies in the row it hung in`).toBe(on.g.hier.leafRow[item.j * on.g.hier.nLeaf + item.k]);
      expect(item.size[0]).toBe(item.size[1]);
      expect("row" in off.litter[q]).toBe(false);
    }
  }
});

// ---- 3.13 the litter ------------------------------------------------------------------------------------------------------------
const fallenLeaf = (over) => ({ x: 1.5, y: -2.25, h: 0, D: 0.8, tau: [0.2, 1.4, 2.5], size: [0.05, 0.05], j: 17, k: 3, fade: 1, ...over });
test("the carpet lies a leaf in the row it hung in: slot 7 is the leaf's own `row` when it has one, leafVariant when it has none — and the cull uses the 64-row box", () => {
  const F = L.INSTANCE_FLOATS, frame = { ox: -50, oy: -50, ext: 100 }, P = { ...DEFAULTS, seed: 4242, leaf_shape: "maple" };
  const withRow = Array.from({ length: 60 }, (_, i) => fallenLeaf({ j: i >> 3, k: i & 7, x: i * 0.01, row: (i * 5) % ROWS })), noRow = withRow.map((l) => { const c = { ...l }; delete c.row; return c; });
  const ord = L.litterOrder(withRow), a = L.litterInstances(withRow, { ...P, leaf_variety: 1 }, frame, false), b = L.litterInstances(noRow, P, frame, false);
  for (let i = 0; i < ord.length; i++) {
    expect(a.data[i * F + 7], `leaf ${ord[i].j}/${ord[i].k}: its row, not a rehash`).toBe(ord[i].row);
    expect(b.data[i * F + 7], "a leaf with no row lies in leafVariant's").toBe(LEAF.leafVariant(4242, ord[i].j, ord[i].k));
    for (let c = 0; c < F; c++) if (c !== 7) expect(Object.is(a.data[i * F + c], b.data[i * F + c]), `slot ${c}`).toBe(true);
  }
  expect(new Set(Array.from({ length: ord.length }, (_, i) => a.data[i * F + 7])).size, "more than 8 rows are in use").toBeGreaterThan(8);
  const e = L.litterInstances(withRow, { ...P, leaf_shape: "ellipse", leaf_variety: 1 }, frame, false);
  for (let i = 0; i < ord.length; i++) expect(e.data[i * F + 7], "the ellipse has no outline: 0").toBe(0);
  // the cull: a stamp whose reach crosses the frame's edge by the 64-row box's margin and not by the 8-row's is kept at variety 1 and culled at 0
  const r8 = LEAF.leafShape("maple", 4242).reach, r64 = LEAF.leafShape("maple", 4242, 1).reach, fr = { ox: -6, oy: -6, ext: 12 }, A = 0.05;
  const edgeLeaf = [fallenLeaf({ x: 6 + A * (r8 + r64) / 2, y: 0, row: 3 })];
  expect(r64).toBeGreaterThan(r8);
  expect(L.litterInstances(edgeLeaf, P, fr, false).count, "the 8-row box does not reach the frame").toBe(0);
  expect(L.litterInstances(edgeLeaf, { ...P, leaf_variety: 1 }, fr, false).count, "the 64-row box does").toBe(1);
});

// ---- 3.14 the held leaf ---------------------------------------------------------------------------------------------------------
// (pinnate.test.js's and tree.test.js's rig, copied: a stub DOM is enough to run draw())
async function heldLeaf(params, hier) {
  const { makeLeafPreview } = await import("./leaf-preview.js");
  const ctx = new Proxy({}, { get: (t, name) => (name in t ? t[name] : () => {}), set: (t, name, v) => { t[name] = v; return true; } });
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
    return { preview, canvas, tick: (ms = 0) => { t += ms; preview.draw(); }, done: () => { performance.now = now; Object.assign(globalThis, saved); } };
  } catch (e) { performance.now = now; Object.assign(globalThis, saved); throw e; }
}
test("the held leaf shows the leaf the grove hung: its row and the grove's own variety, never the params' — rowBlade's blade, a label with its tree, genotype and light class", async () => {
  const seed = 290626672, nLeaf = 3;
  const rows = Uint8Array.from([5 * 8 + 6, 1 * 8 + 2, 6 * 8 + 3,   0 * 8 + 7, 2 * 8 + 0, 3 * 8 + 4,   4, 9, 63,   0, 33, 17]);   // by (cluster, leaf): j·3 + k
  const hier = { nClusterTotal: 4, nLeaf, twigs: [{ tree: 6 }, { tree: 0 }, { tree: 1 }, { tree: 3 }], leafRow: rows, leafVariety: 1 };
  const params = { ...DEFAULTS, seed, phenology: 0.5, leaf_shape: "maple", leaf_size_m: 0.0756, leaf_aspect: 1, wall_fraction: 0.2, leaf_variety: 1 };
  const H = await heldLeaf(params, hier);
  const settle = () => { H.tick(10); H.tick(300); };
  try {
    H.preview.show(true); H.tick();
    const label = H.canvas.dataset.label;
    expect(label, "leaf 0·0 hangs on tree 6 in row 46: genotype 5, light class 6 (c ≥ 4 is sun)").toMatch(/^leaf 0·0 · outline 46 · s [\d.]+ a [\d.]+ b [\d.]+ · tree 6 · genotype 5 · sun 6$/);
    const grown = MAZE.leafMaze(MAPLE, seed, 0, 0, 0.0756, 1, 46);
    expect(Array.from(grown.blade.r), "the blade is rowBlade's").toEqual(Array.from(LEAF.rowBlade(MAPLE, seed, 1, 46).r));
    expect(grown.variant, "the row is the variant").toBe(46);
    expect(MAZE.leafMaze(MAPLE, seed, 0, 0, 0.0756, 1, 46), "memoised on the row").toBe(grown);
    expect(MAZE.leafMaze(MAPLE, seed, 0, 0, 0.0756, 1, 47), "...and on the row").not.toBe(grown);
    expect(MAZE.leafMaze(MAPLE, seed, 0, 0, 0.0756), "variety 0 is today's leaf, in a memo of its own").not.toBe(grown);
    // the grove still holds the old table: a params change runs ahead of the picture and changes nothing
    const grows = H.canvas.dataset.grows;
    params.leaf_variety = 0.4; settle();
    expect(H.canvas.dataset.grows, "the params' variety is nothing to the picture").toBe(grows);
    expect(H.canvas.dataset.label).toBe(label);
    params.leaf_variety = 1;
    // the shade side of another genotype: leaf 0·1 is row 10 (genotype 1, class 2), on the same tree
    H.preview.step(1); settle();
    expect(H.canvas.dataset.at).toBe("0·1");
    expect(H.canvas.dataset.label).toMatch(/^leaf 0·1 · outline 10 · .* · tree 6 · genotype 1 · shade 2$/);
    // c ≥ 4 is sun: 0·2 is row 51 (genotype 6, class 3), the last of the shade
    H.preview.step(1); settle();
    expect(H.canvas.dataset.at).toBe("0·2");
    expect(H.canvas.dataset.label).toMatch(/^leaf 0·2 · outline 51 · .* · tree 6 · genotype 6 · shade 3$/);
    // and the next tree's: 1·0 is row 7 (genotype 0, class 7) on tree 0
    H.preview.step(1); settle();
    expect(H.canvas.dataset.at).toBe("1·0");
    expect(H.canvas.dataset.label).toMatch(/^leaf 1·0 · outline 7 · .* · tree 0 · genotype 0 · sun 7$/);
    // ...and 1·2 is row 28 (genotype 3, class 4), the first of the sun
    H.preview.step(2); settle();
    expect(H.canvas.dataset.at).toBe("1·2");
    expect(H.canvas.dataset.label).toMatch(/^leaf 1·2 · outline 28 · .* · tree 0 · genotype 3 · sun 4$/);
    H.preview.step(-2); settle();
    expect(H.canvas.dataset.at).toBe("1·0");
    // with the 04b knobs also up the tree is named once: the lead and depth first, then the genotype and the light class
    Object.assign(params, { phenology: 0.78, tree_clock_spread: 0.1, tree_pigment_spread: 0.6 }); H.tick(10);
    expect(H.canvas.dataset.label).toMatch(/ · tree 0 Δ -?[\d.]+ c [\d.]+ · genotype 0 · sun 7$/);
    expect((H.canvas.dataset.label.match(/ tree /g) || []).length, "tree t once").toBe(1);
    Object.assign(params, { phenology: 0.5, tree_clock_spread: 0, tree_pigment_spread: 0 });
    // without a table (a variety-0 grove) every byte of today's label
    hier.leafRow = null; hier.leafVariety = 0;
    settle();
    expect(H.canvas.dataset.label, "no table, no knob: the tree-less label of today").toMatch(/^leaf 1·0 · outline \d+ · s [\d.]+ a [\d.]+ b [\d.]+$/);
    expect(H.canvas.dataset.label).not.toContain("genotype");
  } finally { H.done(); }
}, 180000);
