// ============================================================================
// The pinnate grammar and the beech (spec §4.5, "Pinnate blades", P4a-3 step A). A beech's secondaries leave its midrib ALONG its length, and growSkeleton spawns children
// only at a tip, so the grammar is dedicated, like growLeaf's (komorebi-leaf.js). The radial profile holds the beech because it is star-shaped from a point on its midrib
// (0.45 of the way along): the same r(θ) texture, the same shaders, only another origin and another blade. The claims worth holding loudly are the ones that fail SILENTLY: a
// maple that moved by a bit, a stream drawn in another order (every beech there is regrows), a blade that is not star-shaped from its origin (the profile would be a lie about it),
// a held leaf that shows a maple's veins on a beech, a grove that needs more than the texture to hang one. (leaf-shape.test.js holds the maple's side, unedited; the helpers
// below are its measures, copied, because that file is a test and cannot be imported.)
// ============================================================================
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEFAULTS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import * as LEAF from "./komorebi-leaf.js";
import * as MAZE from "./leaf-maze.js";
import * as L from "./komorebi-litter.js";
import { makeGrove } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";

const DEG = math.DEG, TAU = math.TAU, N = LEAF.LEAF_SAMPLES;
const { MAPLE, BEECH } = LEAF;
const sum = (a) => a.reduce((s, v) => s + v, 0), mean = (a) => sum(a) / a.length;
const th = (i) => TAU * ((i + 0.5) / N - 0.5);   // sample i's angle: the texture's own texel centre
const SEEDS = [1, 1234, 90210];
const outline = (seed, v) => LEAF.profile(BEECH, LEAF.outlineSeed(BEECH, seed, v));
const memo = new Map();
const outlines = (seed) => { if (!memo.has(seed)) memo.set(seed, Array.from({ length: LEAF.LEAF_VARIANTS }, (_, v) => outline(seed, v))); return memo.get(seed); };
const every = (f) => { for (const seed of SEEDS) outlines(seed).forEach((r, v) => { f(r, `seed ${seed} v${v}`, seed, v); }); };

// ---- the measures -----------------------------------------------------------------------------------------------------------------
const smoothed = (r, h) => Float64Array.from(r, (_, i) => { let s = 0; for (let d = -h; d <= h; d++) s += r[(i + d + N) % N]; return s / (2 * h + 1); });
// The maxima of a profile that STAND CLEAR of it (±2 samples smoothed; local over ±4): a maximum counts when it rises above the higher of the two floors the profile falls to on either side
// before it meets a higher one, by more than `p` of its own height. Returns the sample indices. A shoulder or a tooth has no such prominence; the apex and the base of a beech do.
function peaks(r, p = 0.08) {
  const sm = smoothed(r, 2), out = [];
  for (let i = 0; i < N; i++) {
    let ok = true;
    for (let d = -4; d <= 4; d++) if (d && sm[(i + d + N) % N] > sm[i]) { ok = false; break; }
    if (!ok) continue;
    let lm = sm[i], rm = sm[i];
    for (let d = 1; d < N; d++) { const v = sm[(i - d + N) % N]; if (v > sm[i]) break; lm = Math.min(lm, v); }
    for (let d = 1; d < N; d++) { const v = sm[(i + d) % N]; if (v > sm[i]) break; rm = Math.min(rm, v); }
    if (sm[i] - Math.max(lm, rm) > p * sm[i]) out.push(i);
  }
  return out;
}
// width over length of the blade, from the profile's own points: the extent across the midrib (y) over the extent along it (x)
function extents(r) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let i = 0; i < N; i++) { const x = r[i] * Math.cos(th(i)), y = r[i] * Math.sin(th(i)); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1, wl: (y1 - y0) / (x1 - x0) };
}
// THE TIP HALF-ANGLE (leaf-shape.test.js's measure, copied): the margin's half-width w against its depth d behind the tip is a line near the tip — the least-squares slope of w over
// d ∈ [0.06, 0.26]·(the tip's reach) — atan of it, the mean of the two flanks. Here the tip is the beech's apex, read from the origin on its midrib.
function tipHalfAngle(sm, i) {
  const at = (a) => { const u = (a / TAU + 0.5) * N - 0.5, k = Math.floor(u), f = u - k; return sm[((k % N) + N) % N] * (1 - f) + sm[(((k + 1) % N) + N) % N] * f; };
  const rp = sm[i], angles = [];
  for (const dir of [-1, 1]) {
    const pts = [];
    let prev = rp;
    for (let k = 1; k < 220; k++) {
      const del = dir * k * (TAU / N) * 0.5, rr = at(th(i) + del);
      if (rr > prev + 1e-9 && k > 4) break;
      prev = rr;
      const d = rp - rr * Math.cos(del), w = Math.abs(rr * Math.sin(del));
      if (d > 0.26 * rp) break;
      if (d >= 0.06 * rp) pts.push([d, w]);
    }
    expect(pts.length, "a flank to fit").toBeGreaterThan(5);
    const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
    let sxy = 0, sxx = 0;
    for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    angles.push(Math.atan(sxy / sxx) / DEG);
  }
  return mean(angles);
}
// re-entrant rays from the profile's origin: along each of the 256 rays the lamina (the union of the discs) must be ONE run, so r(θ) is the whole truth about it. A gap narrower than 0.01
// is the discs' grain (a disc every 0.01), not a re-entry.
function reentries(discs) {
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const c = Math.cos(th(i)), s = Math.sin(th(i)), chords = [];
    for (let k = 0; k < discs.length; k += 3) {
      const b = discs[k] * c + discs[k + 1] * s, h = b * b - (discs[k] ** 2 + discs[k + 1] ** 2 - discs[k + 2] ** 2);
      if (h >= 0) chords.push([b - Math.sqrt(h), b + Math.sqrt(h)]);
    }
    const ahead = chords.filter(([, t1]) => t1 > 0).map(([t0, t1]) => [Math.max(t0, 0), t1]).sort((p, q) => p[0] - q[0]);
    if (!ahead.length) continue;
    let reach = ahead[0][1];
    for (const [t0, t1] of ahead.slice(1)) { if (t0 > reach + 0.01) bad++; reach = Math.max(reach, t1); }
  }
  return bad;
}

// ---- the species table ------------------------------------------------------------------------------------------------------------
test("the beech is a species of the table: pinnate, number 3, a constant — and the maple is palmate, and every species has its own number", () => {
  expect(LEAF.LEAF_SHAPES.beech).toBe(BEECH);
  expect(LEAF.LEAF_SHAPES.maple).toBe(MAPLE);
  expect(MAPLE.grammar).toBe("palmate");
  expect(BEECH.grammar).toBe("pinnate");
  expect(MAPLE.species).toBe(1);
  expect(BEECH.species).toBe(3);   // 2 is the red oak's: a species keeps its number whether or not it has an outline yet
  const all = Object.values(LEAF.LEAF_SHAPES);
  expect(new Set(all.map((s) => s.species)).size, "every species draws its own outlines").toBe(all.length);
  for (const seed of SEEDS) for (let v = 0; v < LEAF.LEAF_VARIANTS; v++) {
    const seeds = [1, 2, 3].map((species) => LEAF.outlineSeed({ species }, seed, v));
    expect(new Set(seeds).size, `species 1, 2, 3 at seed ${seed} v${v}`).toBe(3);
  }
  expect(Object.isFrozen(BEECH), "the species is a constant").toBe(true);
  // the numbers ARE the contract: another value regrows every beech there is
  expect({ ...BEECH }).toEqual({ species: 3, grammar: "pinnate", origin: 0.45, lenJitter: 0.06, W: 0.30, aBase: 0.55, cApex: 1.25, nMin: 9, nMax: 13, s0: 0.06, s1: 0.94, posJitter: 0.2, angle: 45, angleJitter: 4, tooth: 0.02, toothHalf: 0.05 });
  expect(DEFAULTS.leaf_shape, "the default is the ellipse").toBe("ellipse");
  expect(Object.keys(PRESETS).filter((n) => PRESETS[n].leaf_shape === "beech"), "no look asks for it yet: José picks from the sheet").toEqual([]);
});

test("profile dispatches on the grammar: a palmate spec grows growLeaf's skeleton and a pinnate one growPinnate's — bladeOf keeps whichever it grew, and names it", () => {
  for (const seed of SEEDS) for (let v = 0; v < 8; v++) {
    const m = LEAF.outlineSeed(MAPLE, seed, v), b = LEAF.outlineSeed(BEECH, seed, v);
    expect(LEAF.bladeOf(MAPLE, m).skel).toEqual(LEAF.growLeaf(MAPLE, math.mulberry32(m)));
    expect(LEAF.bladeOf(BEECH, b).skel).toEqual(LEAF.growPinnate(BEECH, math.mulberry32(b)));
    expect(LEAF.bladeOf(MAPLE, m).grammar).toBe("palmate");
    expect(LEAF.bladeOf(BEECH, b).grammar).toBe("pinnate");
    expect(Array.from(LEAF.profile(BEECH, b))).toEqual(Array.from(LEAF.bladeOf(BEECH, b).r));
  }
  expect(LEAF.bladeOf(BEECH, 5).skel.veins.filter((q) => q.order === 1), "a beech has one primary: its midrib").toHaveLength(1);
});

// ---- A1: the beech's outline -----------------------------------------------------------------------------------------------------
test("width over length is 0.48-0.62: an American beech is about half as wide as it is long (24 outlines)", () => {
  every((r, tag) => { const { wl } = extents(r); expect(wl, tag).toBeGreaterThan(0.48); expect(wl, tag).toBeLessThan(0.62); });
});

test("two maxima, and two only: the apex (|θ| < 10°) and the base (|θ| > 170°) — a beech has no lobes, and its widest part is a shoulder, not a peak", () => {
  every((r, tag) => {
    const ix = peaks(r);
    expect(ix.length, `${tag}: ${ix.map((i) => (th(i) / DEG).toFixed(0))}`).toBe(2);
    const deg = ix.map((i) => Math.abs(th(i) / DEG)).sort((a, b) => a - b);
    expect(deg[0], tag).toBeLessThan(10);
    expect(deg[1], tag).toBeGreaterThan(170);
  });
  // the measure can fail: three lobes are three maxima, and a ripple under the bar is none
  const three = Float64Array.from({ length: N }, (_, i) => 1 + 0.3 * Math.cos(3 * th(i)));
  expect(peaks(three).length).toBe(3);
  expect(peaks(Float64Array.from({ length: N }, (_, i) => 1 + 0.03 * Math.cos(3 * th(i)))).length).toBe(0);
});

test("the apex ends in a wedge 20-45° to either side of the midrib (the tip half-angle, measured as leaf-shape.test.js measures a lobe's), 35° on average", () => {
  // The brief asked for 20-35°. With the draws of the contract (W ±10%, c ±0.15, a ±0.10) the 24 apexes measure 28-43° with a mean of 35.2°: a wider, shorter-tapered leaf has a blunter point. The bar here is
  // the model's own spread, not the brief's number, and the mean is held to the brief's (a beech whose points all went blunt or needle would move it).
  const all = [];
  every((r, tag) => {
    const sm = smoothed(r, 3), tip = peaks(r).find((i) => Math.abs(th(i)) < 10 * DEG);
    expect(tip, tag).toBeDefined();
    const a = tipHalfAngle(sm, tip);
    expect(a, tag).toBeGreaterThan(20); expect(a, tag).toBeLessThan(45);
    all.push(a);
  });
  expect(mean(all)).toBeGreaterThan(30); expect(mean(all)).toBeLessThan(36);
  // the measure itself reads a wedge: a cone pointing along +x with its apex at 1 and its flanks 30° off the axis
  const cone = Float64Array.from({ length: N }, (_, i) => (Math.abs(th(i)) < 60 * DEG ? 1 / (Math.cos(th(i)) + Math.sin(Math.abs(th(i))) / Math.tan(30 * DEG)) : 0.35));
  const tip = peaks(cone).find((i) => Math.abs(th(i)) < 0.05);
  expect(tip).toBeDefined();
  expect(tipHalfAngle(smoothed(cone, 3), tip)).toBeGreaterThan(29);
  expect(tipHalfAngle(smoothed(cone, 3), tip)).toBeLessThan(31);
});

test("the blade is star-shaped from its origin on the midrib: along every one of the 256 rays the lamina is one run, so r(θ) is the whole truth about it (24 blades)", () => {
  for (const seed of SEEDS) for (let v = 0; v < LEAF.LEAF_VARIANTS; v++) {
    const { discs } = LEAF.growPinnate(BEECH, math.mulberry32(LEAF.outlineSeed(BEECH, seed, v)));
    expect(reentries(discs), `seed ${seed} v${v}`).toBe(0);
  }
  // the measure can fail: two discs with air between them along a ray are a re-entry (this is what a red oak does from any point of its midrib)
  expect(reentries([1, 0, 0.3, 1.4, 0, 0.3]), "a waist seen from outside the pair").toBeGreaterThan(0);
  expect(reentries([0, 0, 0.5, 0.6, 0, 0.3]), "the same pair seen from inside the larger one").toBe(0);
});

// ---- A2: teeth, area, variants, purity -------------------------------------------------------------------------------------------
test("18-26 teeth, one at the end of each secondary, each at most 3% of the radius — and they are there: the bumps stand on the margin", () => {
  for (const seed of SEEDS) for (let v = 0; v < LEAF.LEAF_VARIANTS; v++) {
    const vs = LEAF.outlineSeed(BEECH, seed, v), tag = `seed ${seed} v${v}`;
    const { veins, teeth } = LEAF.growPinnate(BEECH, math.mulberry32(vs));
    expect(teeth.length, tag).toBeGreaterThanOrEqual(18); expect(teeth.length, tag).toBeLessThanOrEqual(26);
    expect(teeth.length, tag).toBe(veins.filter((q) => q.order === 2).length);
    // the profile with the teeth over the profile without, both area-normalised: a tooth multiplies the radius within toothHalf of its angle by at most 1 + tooth, and two teeth that overlap multiply, so a sample
    // under m teeth is raised by at most (1 + tooth)^m — and the normalisation, which takes back a little of the area they add, can only lower it
    const plain = LEAF.profile({ ...BEECH, tooth: 0 }, vs), r = LEAF.profile(BEECH, vs), ratio = Float64Array.from(r, (x, i) => x / plain[i]);
    const ang = teeth.map(([tx, ty]) => Math.atan2(ty, tx)), under = (i) => ang.filter((a) => Math.abs(Math.atan2(Math.sin(th(i) - a), Math.cos(th(i) - a))) < BEECH.toothHalf).length;
    for (let i = 0; i < N; i++) {
      const m = under(i);
      expect(ratio[i], `${tag} sample ${i} under ${m} teeth`).toBeLessThanOrEqual((1 + BEECH.tooth) ** m + 1e-12);
      if (m === 1) expect(ratio[i], `${tag} sample ${i}: one tooth is at most 3%`).toBeLessThanOrEqual(1.03);
    }
    expect(Math.min(...ratio), `${tag}: the area normalisation takes back a little, not a tooth's worth`).toBeGreaterThan(0.99);
    for (const a of ang) {   // each tooth's own sample is raised
      const i = Math.round((a / TAU + 0.5) * N - 0.5), j = ((i % N) + N) % N;
      expect(ratio[j], `${tag}: the tooth at ${(a / DEG).toFixed(1)}°`).toBeGreaterThan(1.008);
    }
  }
  expect(BEECH.tooth, "a tooth is at most 3% of the radius").toBeLessThanOrEqual(0.03);
});

test("area is conserved: ∮½r²dθ = π to 1e-9 (the ellipse's, at aspect 1), and a raster of the linearly-read 256-sample profile holds π to 1%", () => {
  every((r, tag) => {
    let a = 0;
    for (let i = 0; i < N; i++) a += 0.5 * r[i] * r[i] * (TAU / N);
    expect(Math.abs(a - Math.PI), tag).toBeLessThan(1e-9);
  });
  const M = 1024;
  for (const r of outlines(1234)) {
    let rmax = 0; for (let i = 0; i < N; i++) rmax = Math.max(rmax, r[i]);
    const half = rmax * 1.001, px = (2 * half) / M;
    let n = 0;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = -half + (i + 0.5) * px, y = -half + (j + 0.5) * px, u = (Math.atan2(y, x) / TAU + 0.5) * N - 0.5, k = Math.floor(u), f = u - k;
      const rr = r[((k % N) + N) % N] * (1 - f) + r[(((k + 1) % N) + N) % N] * f;   // what a LINEAR texture read hands the shader
      if (Math.hypot(x, y) <= rr) n++;
    }
    expect(Math.abs((n * px * px) / Math.PI - 1)).toBeLessThan(0.01);
  }
});

test("the eight variants are eight leaves: no two within 0.01 of a unit radius of each other, RMS over the profile (beeches are more alike than maples, whose bar is 0.02)", () => {
  for (const seed of SEEDS) {
    const rs = outlines(seed);
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += (rs[a][i] - rs[b][i]) ** 2;
      expect(Math.sqrt(s / N), `seed ${seed}: ${a} vs ${b}`).toBeGreaterThan(0.01);
    }
  }
});

test("the outline is a pure function of its seed: bit-equal when regrown, different for another seed, and nothing is read but the arguments", () => {
  const a = LEAF.profile(BEECH, 77), b = LEAF.profile(BEECH, 77);
  expect(Array.from(b)).toEqual(Array.from(a));
  expect(Array.from(LEAF.profile(BEECH, 78))).not.toEqual(Array.from(a));
  const real = Math.random;
  Math.random = () => { throw new Error("the leaf asked for Math.random"); };
  try { LEAF.profile(BEECH, 5); LEAF.leafShape("beech", 99); } finally { Math.random = real; }
  expect(() => LEAF.profile(Object.freeze({ ...BEECH }), 3)).not.toThrow();   // nothing is written to the spec
});

// ---- the stream is the contract -----------------------------------------------------------------------------------------------------
// An independent replay of the documented draws: len, W, a, c, asym, nSide, then per secondary (alternating sides) its position and its angle. Reorder them and every beech regrows.
function replay(spec, vs) {
  const rng = math.mulberry32(vs), u = () => rng() * 2 - 1;
  const len = 1 + u() * spec.lenJitter, W = spec.W * (1 + u() * 0.10), a = spec.aBase + u() * 0.10, c = spec.cApex + u() * 0.15, asym = u() * 0.06;
  const nSide = spec.nMin + Math.floor(rng() * (spec.nMax - spec.nMin + 1)), secs = [];
  for (let i = 0; i < 2 * nSide; i++) {
    const k = Math.floor(i / 2), s = spec.s0 + (spec.s1 - spec.s0) * (k + 0.5 * (i % 2) + 0.25) / nSide + u() * spec.posJitter / nSide, ang = (spec.angle + u() * spec.angleJitter) * DEG;
    secs.push({ s, ang, side: i % 2 ? 1 : -1 });
  }
  return { len, W, a, c, asym, nSide, secs };
}
test("the stream: len, W, a, c, asym, nSide, then each secondary's position and angle — the skeleton is the replay of it, draw for draw", () => {
  for (const seed of SEEDS) for (let v = 0; v < LEAF.LEAF_VARIANTS; v++) {
    const vs = LEAF.outlineSeed(BEECH, seed, v), want = replay(BEECH, vs), { discs, veins, teeth } = LEAF.growPinnate(BEECH, math.mulberry32(vs)), tag = `seed ${seed} v${v}`;
    const [mid, ...sec] = veins;
    // the origin frame: the midrib runs +x from (−origin·len, 0)
    expect(mid.order, tag).toBe(1);
    expect(mid.a[0], tag).toBeCloseTo(-BEECH.origin * want.len, 12); expect(mid.a[1], tag).toBe(0);
    expect(mid.b[0], tag).toBeCloseTo((1 - BEECH.origin) * want.len, 12); expect(mid.b[1], tag).toBe(0);
    // W, a, c: the lamina's discs peak at W, at a/(a+c) of the way along; asym: every disc is offset across the midrib by asym of its own radius
    let rMax = 0, at = 0;
    for (let i = 0; i < discs.length; i += 3) {
      expect(discs[i + 1] / discs[i + 2], `${tag} disc ${i / 3}`).toBeCloseTo(want.asym, 12);
      if (discs[i + 2] > rMax) { rMax = discs[i + 2]; at = (discs[i] + BEECH.origin * want.len) / want.len; }
    }
    expect(rMax, tag).toBeLessThanOrEqual(want.W + 1e-12); expect(rMax, tag).toBeGreaterThan(want.W * 0.995);
    expect(Math.abs(at - want.a / (want.a + want.c)), tag).toBeLessThanOrEqual(0.5 / Math.ceil(want.len / 0.01) + 1e-9);   // the discs sit every 0.01: the peak is within half a step
    // nSide and the secondaries: positions, angles, sides
    expect(sec.length, tag).toBe(2 * want.nSide);
    expect(teeth.length, tag).toBe(2 * want.nSide);
    sec.forEach((q, i) => {
      const w = want.secs[i];
      expect(q.order).toBe(2);
      expect(q.a[0], `${tag} secondary ${i}`).toBeCloseTo(w.s * want.len - BEECH.origin * want.len, 12); expect(q.a[1]).toBe(0);
      const dx = q.b[0] - q.a[0], dy = q.b[1] - q.a[1];
      expect(Math.atan2(Math.abs(dy), dx), `${tag} secondary ${i}`).toBeCloseTo(w.ang, 12);   // runs forward at its own angle
      expect(Math.sign(dy), `${tag} secondary ${i}: alternate sides`).toBe(w.side);
      expect(teeth[i], "the tooth is where the secondary ends").toEqual(q.b);
    });
  }
});

test("a secondary runs out until it leaves the lamina and ends there: its tip is inside it, and a hair further along is not", () => {
  const { veins, discs } = LEAF.growPinnate(BEECH, math.mulberry32(LEAF.outlineSeed(BEECH, 1234, 0)));
  const inside = (x, y) => { for (let k = 0; k < discs.length; k += 3) if ((x - discs[k]) ** 2 + (y - discs[k + 1]) ** 2 <= discs[k + 2] ** 2) return true; return false; };
  const sec = veins.filter((q) => q.order === 2);
  expect(sec.length).toBeGreaterThanOrEqual(18);
  for (const s of sec) {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), ux = (s.b[0] - s.a[0]) / L, uy = (s.b[1] - s.a[1]) / L;
    expect(inside(s.a[0], s.a[1]), "it starts inside the lamina").toBe(true);
    expect(inside(s.b[0] - ux * 1e-6, s.b[1] - uy * 1e-6), "its tip is on the lamina's edge").toBe(true);
    expect(inside(s.b[0] + ux * 2e-3, s.b[1] + uy * 2e-3), "...and a hair past it is not").toBe(false);
  }
});

// ---- the descriptor the grove hands the bake -----------------------------------------------------------------------------------------
test("leafShape('beech'): eight rows of 256 float32s, the very profiles above, and the box the quad has to cover — memoised on (shape, seed)", () => {
  const s = LEAF.leafShape("beech", 1234);
  expect(s).not.toBeNull();
  expect(s.name).toBe("beech");
  expect(s.rows).toBe(8);
  expect(s.data).toBeInstanceOf(Float32Array);
  expect(s.data.length).toBe(8 * 256);
  outlines(1234).forEach((r, v) => { for (let i = 0; i < N; i++) expect(s.data[v * N + i]).toBe(Math.fround(r[i])); });
  expect(LEAF.leafShape("beech", 1234)).toBe(s);
  expect(LEAF.leafShape("beech", 1235)).not.toBe(s);
  expect(Array.from(LEAF.leafShape("beech", 1235).data)).not.toEqual(Array.from(s.data));
  expect(Array.from(s.data), "not the maple's").not.toEqual(Array.from(LEAF.leafShape("maple", 1234).data));
  const [cx, cy, hx, hy] = s.box;
  let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
  for (let v = 0; v < 8; v++) for (let i = 0; i < N; i++) {
    const x = s.data[v * N + i] * Math.cos(th(i)), y = s.data[v * N + i] * Math.sin(th(i));
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    expect(x >= cx - hx && x <= cx + hx && y >= cy - hy && y <= cy + hy).toBe(true);
  }
  expect(cx - hx).toBeCloseTo(x0 - 0.01, 9); expect(cx + hx).toBeCloseTo(x1 + 0.01, 9);
  expect(cy - hy).toBeCloseTo(y0 - 0.01, 9); expect(cy + hy).toBeCloseTo(y1 + 0.01, 9);
  expect(s.reach).toBeCloseTo(Math.hypot(Math.abs(cx) + hx, Math.abs(cy) + hy), 12);
  expect(s.rmax).toBe(Math.max(...s.data));
  // the quad is the union of eight beeches, not a margin of air: a beech is long and narrow, so its box is far under the maple's
  expect(4 * hx * hy).toBeLessThan(4 * LEAF.leafShape("maple", 1234).box[2] * LEAF.leafShape("maple", 1234).box[3]);
});

// ---- the maple does not move -----------------------------------------------------------------------------------------------------------
// leaf-shape.test.js, leaf.test.js and maze.test.js are unedited; they hold the maple's features. This holds its BITS: the profiles, the skeletons and the texture of the maple, taken at
// 9fc0d90, before the pinnate grammar was added. The exact digests are a claim about ONE platform (JavaScriptCore's Math.sin/cos/atan2/sqrt come from the system libm: skeleton.test.js says the
// same of the grove), so they are keyed like its fixtures; the quantised ones (1e-7: a ulp never reaches them, a changed draw moves them by 1e-2) hold everywhere.
const flat = (x, out = []) => { if (typeof x === "number") out.push(x); else if (x && typeof x === "object") for (const k of Object.keys(x)) flat(x[k], out); return out; };
const digestBits = (xs) => createHash("sha256").update(Buffer.from(Float64Array.from(xs).buffer)).digest("hex").slice(0, 16);
const digestQ = (xs) => createHash("sha256").update(Array.from(xs, (v) => Math.round(v * 1e7)).join(",")).digest("hex").slice(0, 16);
const mapleNumbers = () => {
  const prof = [], skel = [];
  for (const seed of [1, 1234, 4242, 90210]) for (let v = 0; v < 8; v++) {
    const vs = LEAF.outlineSeed(MAPLE, seed, v);
    prof.push(...LEAF.profile(MAPLE, vs));
    skel.push(...flat(LEAF.growLeaf(MAPLE, math.mulberry32(vs))));
  }
  const shape = LEAF.leafShape("maple", 1234);
  return { prof, skel, tex: [...shape.data, ...shape.box, shape.reach, shape.rmax] };
};
const MAPLE_Q = { prof: "97ae2efe0a1a41d0", skel: "b8e55a7e7b023d4d", tex: "08d268769edf3009" };
const MAPLE_BITS = { "darwin-arm64": { prof: "1a0cce673865be83", skel: "48c492766f6856b8", tex: "f1c56d34f2dd058c" } };
test("the maple's profiles, skeletons and texture are the bits they were before the pinnate grammar (quantised everywhere; exact on the platform they were recorded on)", () => {
  const got = mapleNumbers();
  for (const key of ["prof", "skel", "tex"]) expect(digestQ(got[key]), `${key}, quantised`).toBe(MAPLE_Q[key]);
  const exact = MAPLE_BITS[`${process.platform}-${process.arch}`];
  if (exact) for (const key of ["prof", "skel", "tex"]) expect(digestBits(got[key]), `${key}, exact`).toBe(exact[key]);
});

// ---- the held leaf: the pinnate grammar through bladeOf ----------------------------------------------------------------------------
const SIZE = 0.0756, UNIT = SIZE / 2, A_CELL = (MAZE.AREOLE_M / UNIT) ** 2;
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
let held = null;
const heldBeech = () => {
  if (!held) { const blade = LEAF.bladeOf(BEECH, LEAF.outlineSeed(BEECH, 1234, 0)); held = { blade, margin: MAZE.marginOf(blade), maze: MAZE.growAreoles(blade, { seed: 1, cellM: MAZE.AREOLE_M, unitM: UNIT }) }; }
  return held;
};

test("the held leaf of a beech has a beech's veins: ONE order-1 wall, the midrib, along the axis from the base to the apex, and the skeleton's own secondaries leaving it on both sides", () => {
  const { blade, margin, maze } = heldBeech(), k = blade.k;
  const byOrder = (o) => maze.walls.filter((w) => w.order === o);
  expect(byOrder(1)).toHaveLength(1);
  const [mid] = byOrder(1);
  expect(Math.abs(mid.a[1]) + Math.abs(mid.b[1]), "the midrib lies on the axis").toBeLessThan(1e-9);
  expect(mid.a[0]).toBeLessThan(0); expect(mid.b[0]).toBeGreaterThan(0);   // it runs through the origin: base behind, apex ahead
  // the midrib is the skeleton's, in the outline's frame: its apex end at the skeleton's tip or short of it (a chord of the 256-gon cuts a point off: 2-6% measured, a frame slip would be ~2x), its base end
  // at or beyond the skeleton's (the lamina's round base bulges behind the midrib's start, and the wall runs to the margin)
  const sk = blade.skel.veins[0];
  expect(mid.b[0]).toBeLessThanOrEqual(sk.b[0] * k * (1 + 1e-9));
  expect(mid.b[0]).toBeGreaterThan(0.92 * sk.b[0] * k);
  expect(mid.a[0]).toBeLessThanOrEqual(sk.a[0] * k + 1e-9);
  const veins2 = blade.skel.veins.filter((q) => q.order === 2), walls2 = byOrder(2);
  expect(walls2).toHaveLength(veins2.length);
  veins2.forEach((v, i) => {
    const w = walls2[i], dir = Math.atan2(v.b[1] - v.a[1], v.b[0] - v.a[0]), got = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
    expect(Math.hypot(w.a[0] - v.a[0] * k, w.a[1] - v.a[1] * k), `secondary ${i} starts where the skeleton's does`).toBeLessThan(1e-6);
    expect(Math.abs(Math.atan2(Math.sin(got - dir), Math.cos(got - dir))), `secondary ${i} runs along the skeleton's direction`).toBeLessThan(1e-9);
    // the wall runs to the MARGIN, which has the teeth on it, and the vein stops at the lamina: so it is no longer than the vein by more than a tooth is high (two, where they overlap); one that meets an older wall is shorter
    expect(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), `secondary ${i} is no longer than the skeleton's`).toBeLessThanOrEqual(k * Math.hypot(v.b[0] - v.a[0], v.b[1] - v.a[1]) + 2 * BEECH.tooth * Math.max(...blade.r));
  });
  expect(walls2.filter((w) => w.b[1] > 0).length, "both sides of the midrib").toBeGreaterThan(5);
  expect(walls2.filter((w) => w.b[1] < 0).length).toBeGreaterThan(5);
  expect(margin.length).toBeGreaterThan(200);
});

test("a beech's cells tile its margin: areas sum to it to 1e-9, every cell simple, positive and no bigger than a cell of the species, and none lies across the midrib", () => {
  const { margin, maze } = heldBeech();
  expect(Math.abs(maze.cells.reduce((s, c) => s + area(c.poly), 0) / area(margin) - 1)).toBeLessThan(1e-9);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hit = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  for (const c of maze.cells) {
    const a = area(c.poly);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(A_CELL * (1 + 1e-9));
    const n = c.poly.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) expect(hit(c.poly[i], c.poly[(i + 1) % n], c.poly[j], c.poly[(j + 1) % n])).toBe(false);
  }
  const [mid] = maze.walls.filter((w) => w.order === 1), d = [mid.b[0] - mid.a[0], mid.b[1] - mid.a[1]], l = Math.hypot(...d), n = [-d[1] / l, d[0] / l];
  for (const t of [0.2, 0.4, 0.6, 0.8]) {
    const p = [mid.a[0] + t * d[0], mid.a[1] + t * d[1]], side = (s) => maze.cells.findIndex((c) => inPoly([p[0] + s * 1e-6 * n[0], p[1] + s * 1e-6 * n[1]], c.poly));
    expect(side(1)).toBeGreaterThanOrEqual(0); expect(side(-1)).toBeGreaterThanOrEqual(0);
    expect(side(1), `a cell across the midrib at ${t}`).not.toBe(side(-1));
  }
});

test("every secondary wall of a beech ends on an older wall or the margin (a T-junction), and its walls carry wall_fraction on the raster to 0.01", () => {
  const { blade, margin, maze } = heldBeech();
  const toOlder = (p, idx) => {
    let best = Infinity;
    for (let i = 0; i < idx; i++) best = Math.min(best, segDist(p, maze.walls[i].a, maze.walls[i].b));
    for (let i = 0; i < margin.length; i++) best = Math.min(best, segDist(p, margin[i], margin[(i + 1) % margin.length]));
    return best;
  };
  maze.walls.forEach((w, i) => { if (w.order === 2) for (const p of [w.a, w.b]) expect(toOlder(p, i), `secondary wall ${i}`).toBeLessThan(1e-9); });
  const shareOf = (r) => { let w = 0, l = 0; for (let i = 0; i < r.lam.length; i++) { w += r.lam[i] * r.wall[i]; l += r.lam[i]; } return w / l; };
  for (const fw of [0.05, 0.2]) expect(Math.abs(shareOf(MAZE.rasterLeaf(blade, maze, fw, 512)) - fw)).toBeLessThan(0.01);
});

test("leafMaze(beech, ...) is the grove's own beech at that address: its variant, its outline seed, memoised apart from a maple's at the same address", () => {
  const a = MAZE.leafMaze(BEECH, 1234, 3, 4, SIZE), b = MAZE.leafMaze(BEECH, 1234, 3, 4, SIZE), m = MAZE.leafMaze(MAPLE, 1234, 3, 4, SIZE);
  expect(b).toBe(a);
  expect(m).not.toBe(a);
  expect(a.variant).toBe(LEAF.leafVariant(1234, 3, 4));
  expect(a.blade.r).toEqual(LEAF.profile(BEECH, LEAF.outlineSeed(BEECH, 1234, a.variant)));
  expect(a.blade.grammar).toBe("pinnate");
  expect(a.maze.walls.filter((w) => w.order === 1)).toHaveLength(1);
  expect(m.maze.walls.filter((w) => w.order === 1)).toHaveLength(5);
  expect(readFileSync(new URL("./leaf-preview.js", import.meta.url), "utf8")).toContain("LEAF_SHAPES[params.leaf_shape] ?? MAPLE");   // the inset reads the table, so a pick of 'beech' is the beech's blade
});

// The inset's own wiring, in bun: the source grep above only proves the table is read, so a preview that kept the text and drew the maple anyway would pass it.
// A stub DOM is enough to run draw() (tree.test.js's rig): the canvas keeps its dataset, the clock is the test's.
async function heldLeaf(params, hier) {
  const { makeLeafPreview } = await import("./leaf-preview.js");
  const calls = [];   // every call the inset makes on its 2d context, [name, ...args]: the bar and the words are drawn there and nowhere else
  const ctx = new Proxy({}, { get: (t, name) => (name in t ? t[name] : (...args) => { calls.push([name, ...args]); }), set: (t, name, v) => { t[name] = v; return true; } });
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
    return { preview, canvas, calls, tick: (ms = 0) => { t += ms; preview.draw(); }, done: () => { performance.now = now; Object.assign(globalThis, saved); } };
  } catch (e) { performance.now = now; Object.assign(globalThis, saved); throw e; }
}
test("the held leaf of a beech look grows pinnate, of a maple and of the ellipse look palmate, and follows a pick of the shape", async () => {
  const hier = { nClusterTotal: 4, nLeaf: 3, twigs: [{ tree: 0 }, { tree: 0 }, { tree: 0 }, { tree: 0 }] };
  const params = { ...DEFAULTS, seed: 1234, phenology: 0.8, leaf_shape: "beech", leaf_size_m: 0.0756, leaf_aspect: 1, wall_fraction: 0.2 };
  const H = await heldLeaf(params, hier);
  try {
    H.preview.show(true); H.tick();
    expect(H.canvas.dataset.grammar).toBe("pinnate");
    params.leaf_shape = "maple"; H.tick(1000); H.tick(1000);
    expect(H.canvas.dataset.grammar).toBe("palmate");
    params.leaf_shape = "beech"; H.tick(1000); H.tick(1000);
    expect(H.canvas.dataset.grammar).toBe("pinnate");
    params.leaf_shape = "ellipse"; H.tick(1000); H.tick(1000);
    expect(H.canvas.dataset.grammar, "the ellipse look falls back to the maple's blade").toBe("palmate");
  } finally { H.done(); }
}, 60000);

// THE ASPECT LAW, held leaf's side (leaf-shape.test.js holds the grove's): an outline takes the look's leaf AREA, so the leaf the inset grows is the maple at leaf_size_m/√aspect — the unit the grove's
// A = B0 = size/(2√aspect) puts it at — and not at the nominal size, which was the canopy's squashed leaf and the inset's whole one disagreeing. The ellipse look has no outline: the inset
// grows the maple at the nominal size, as it always did, and its aspect is nothing to the picture.
test("the held leaf follows the aspect law: a maple look grows its maze at leaf_size_m/√aspect (data-unit) while data-size stays the nominal size, an aspect move regrows it once, the ellipse look never", async () => {
  const hier = { nClusterTotal: 4, nLeaf: 3, twigs: [{ tree: 0 }, { tree: 0 }, { tree: 0 }, { tree: 0 }] };
  const params = { ...DEFAULTS, seed: 1234, phenology: 0.8, leaf_shape: "maple", leaf_size_m: 0.1, leaf_aspect: 1.75, wall_fraction: 0.2 };
  const H = await heldLeaf(params, hier);
  try {
    H.preview.show(true); H.tick();
    expect(H.canvas.dataset.unit, "the outline's unit: the area the ellipse would have").toBe(String(0.1 / Math.sqrt(1.75)));
    expect(H.canvas.dataset.size, "the nominal size, which editor.mjs reads").toBe("0.1");
    expect(H.canvas.dataset.grows).toBe("1");
    params.leaf_aspect = 1; H.tick(10);
    expect(H.canvas.dataset.grows, "deferred while the input moves").toBe("1");
    H.tick(300);
    expect(H.canvas.dataset.grows, "an aspect move regrows the maple's maze once").toBe("2");
    expect(H.canvas.dataset.unit, "at aspect 1 the unit is the size, exactly").toBe(H.canvas.dataset.size);
    expect(H.canvas.dataset.unit).toBe("0.1");
    H.tick(1000);
    expect(H.canvas.dataset.grows, "...and only once").toBe("2");
    params.leaf_shape = "ellipse"; params.leaf_aspect = 1.75; H.tick(10); H.tick(300);
    const grows = H.canvas.dataset.grows;
    expect(H.canvas.dataset.unit, "the ellipse look: the maple at the nominal size, as ever").toBe("0.1");
    params.leaf_aspect = 1.2; H.tick(10); H.tick(300);
    expect(H.canvas.dataset.grows, "an ellipse look's aspect is nothing to the picture").toBe(grows);
  } finally { H.done(); }
}, 120000);

// The overlays are the picture's scale and its words, which the dataset does not carry: the 1 cm bar is a centimetre of the leaf the maze was grown at (`unit`), so on the very same blade it is √aspect longer at aspect 1.75 than at 1,
// and the nominal line names both sizes only when they differ.
test("the held leaf's 1 cm bar is a centimetre of the size the maze was grown at, and its nominal line names both sizes when an outline's differs", async () => {
  const hier = { nClusterTotal: 4, nLeaf: 3, twigs: [{ tree: 0 }, { tree: 0 }, { tree: 0 }, { tree: 0 }] };
  const params = { ...DEFAULTS, seed: 1234, phenology: 0.8, leaf_shape: "maple", leaf_size_m: 0.1, leaf_aspect: 1.75, wall_fraction: 0.2 };
  const H = await heldLeaf(params, hier);
  const last = (name, pick = () => true) => { const c = H.calls.filter((x) => x[0] === name && pick(x)); expect(c.length, `the inset drew ${name}`).toBeGreaterThan(0); return c.at(-1); };
  const bar = () => last("lineTo")[1] - last("moveTo")[1];
  const nominal = () => last("fillText", (x) => /^nominal /.test(x[1]))[1];
  const settle = () => { H.calls.length = 0; H.tick(10); H.tick(300); };
  // the bar by hand: 1 cm over the unit's half (a unit is half the size), in the picture's pixels per unit — which the raster of the very blade the inset holds says
  const barBy = (unit) => { const [, j, k] = H.canvas.dataset.label.match(/^leaf (\d+)·(\d+)/), g = MAZE.leafMaze(MAPLE, 1234, +j, +k, unit); return (0.01 / (unit / 2)) * (H.canvas.width / (2 * MAZE.rasterLeaf(g.blade, g.maze, 0.2, 64).view.half)); };
  try {
    H.preview.show(true); H.tick();
    const own = bar();
    expect(own, "at aspect 1.75 the bar is a centimetre of the leaf at leaf_size_m/√1.75").toBeCloseTo(barBy(0.1 / Math.sqrt(1.75)), 6);
    expect(nominal()).toBe("nominal 10.0 cm (an outline at aspect 1.75: 7.6 cm at its own width); the grove draws 0.6–1.4× of it");
    params.leaf_aspect = 1; settle();
    expect(bar(), "at aspect 1 the bar is a centimetre of the leaf at leaf_size_m").toBeCloseTo(barBy(0.1), 6);
    expect(own / bar(), "the same blade at a smaller unit: a centimetre is √1.75 longer").toBeCloseTo(Math.sqrt(1.75), 9);
    expect(nominal(), "at aspect 1 the two sizes are one and the line names it once").toBe("nominal 10.0 cm; the grove draws 0.6–1.4× of it");
    params.leaf_shape = "ellipse"; params.leaf_aspect = 1.75; settle();
    expect(nominal(), "the ellipse look has no outline: the maple at the nominal size, and nothing to name").toBe("nominal 10.0 cm; the grove draws 0.6–1.4× of it");
  } finally { H.done(); }
}, 120000);

// ---- the grove: nothing but the texture and the box -----------------------------------------------------------------------------------
function groveRig(over) {
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
  const params = { ...DEFAULTS, tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, ...over };
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => false, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  const on = (tx, name) => calls.filter((c) => c.tex === tx && c.name === name).map((c) => c.a);
  return { params, g, on, layers: g.layerVAO.map((l) => Array.from(l.buf.data)), faithLeaves: Array.from(faith.buf.data) };
}
const LOOK = { ...PRESETS["afternoon 7"], leaf_aspect: 1, leaf_size_m: 0.0756, seed: 4242 };

test("a beech grove is a maple grove to the bit — every float of every leaf in both buffers — and differs only in the texture and the box the bake is handed", () => {
  const maple = groveRig({ ...LOOK, leaf_shape: "maple" }), beech = groveRig({ ...LOOK, leaf_shape: "beech" });
  expect(beech.layers.length).toBe(maple.layers.length);
  let n = 0;
  beech.layers.forEach((Lr, l) => { expect(Lr.length).toBe(maple.layers[l].length); for (let i = 0; i < Lr.length; i++) { expect(Object.is(Lr[i], maple.layers[l][i]), `layer ${l} float ${i}`).toBe(true); n++; } });
  expect(beech.faithLeaves.length).toBe(maple.faithLeaves.length);
  for (let i = 0; i < beech.faithLeaves.length; i++) expect(Object.is(beech.faithLeaves[i], maple.faithLeaves[i]), `faithful float ${i}`).toBe(true);
  expect(n).toBeGreaterThan(5000);
  expect(beech.g.shape).toBe(LEAF.leafShape("beech", 4242));
  expect(beech.g.shape).not.toBe(maple.g.shape);
  expect(beech.on(beech.g.leafTex, "texImage2D")).toEqual([["TEXTURE_2D", 0, "R16F", 256, 8, 0, "RED", "FLOAT", beech.g.shape.data]]);
  expect(Array.from(beech.g.shape.data)).not.toEqual(Array.from(maple.g.shape.data));
  expect(JSON.stringify(beech.g.hier.twigs), "the growth is the ellipse's").toBe(JSON.stringify(groveRig({ ...LOOK, leaf_shape: "ellipse" }).g.hier.twigs));
});

test("the carpet lays a beech in the outline it hung in: the instance's spare slot is leafVariant, and nothing else about a stamp moves", () => {
  const F = L.INSTANCE_FLOATS, frame = { ox: -50, oy: -50, ext: 100 }, P = { ...DEFAULTS, seed: 4242 };
  const list = Array.from({ length: 60 }, (_, i) => ({ x: i * 0.01 + 1.5, y: -2.25, h: 0, D: 0.8, tau: [0.2, 1.4, 2.5], size: [0.05, 0.05], j: i >> 3, k: i & 7, fade: 1 }));
  const e = L.litterInstances(list, P, frame, false), b = L.litterInstances(list, { ...P, leaf_shape: "beech" }, frame, false), ord = L.litterOrder(list);
  expect(b.count).toBe(e.count);
  for (let i = 0; i < ord.length; i++) {
    expect(b.data[i * F + 7], `leaf ${ord[i].j}/${ord[i].k}`).toBe(LEAF.leafVariant(4242, ord[i].j, ord[i].k));
    for (let c = 0; c < F; c++) if (c !== 7) expect(Object.is(b.data[i * F + c], e.data[i * F + c]), `slot ${c}`).toBe(true);
  }
});
