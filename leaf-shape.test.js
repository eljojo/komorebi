// ============================================================================
// The leaf's outline (spec §4.5, P4a-2): a sugar maple's blade as a radial profile r(θ), area-normalised, from the petiole base. The claims
// worth holding loudly are the ones that fail SILENTLY: an outline that grows a mitten instead of a maple (the wrong number of lobes, a sinus
// that is a notch or a gap), a stream that shares a salt with a draw that reshuffles every shipped grove, a gate that leaks an outline into a look
// that never asked, a fallen leaf that lies in another shape than the one it hung in. (The litter.test.js pattern: the pure laws first, then
// the one place that applies them over a stub GL, then the strings the shaders must keep.)
// ============================================================================
import { expect, test } from "bun:test";
import { DEFAULTS, TOPO_KEYS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import * as LEAF from "./komorebi-leaf.js";

const DEG = math.DEG, TAU = math.TAU, N = 256;
const sum = (a) => a.reduce((s, v) => s + v, 0), mean = (a) => sum(a) / a.length;
const th = (i) => TAU * ((i + 0.5) / N - 0.5);   // sample i's angle: the texture's own texel centre

// ---- the gate ---------------------------------------------------------------------------------------------------------------
test("leaf_shape ships 'ellipse' and is a TOPO key: a different outline is a different grove, so it dissolves under the bloom and never morphs", () => {
  expect(DEFAULTS.leaf_shape).toBe("ellipse");
  expect(TOPO_KEYS).toContain("leaf_shape");
  expect(TOPO_KEYS.indexOf("leaf_shape")).toBe(TOPO_KEYS.indexOf("phyllotaxis") + 1);   // beside the other string that re-means the grove
});

// ---- the measure: Fable's, from the round-11 script (smooth ±3 samples; maxima over ±10, merged inside 12; lobes are the maxima in |θ| < 125°) -----
// RECALIBRATED 2026-10-09 against José's thirteen maples (DSC_0617–0622, DSCF1667 ×3, DSC_0656 ×5), which this same measure reads as THREE main lobes and, in a few, a small basal one on each side: so the
// lobes are found by the central one (within 10° of the axis) and the two that flank it, and nothing below counts on five.
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
  const lobeR = lobes.map((i) => sm[i]);
  const sinus = [];   // depth of the margin between neighbours, of the SHORTER one's length
  for (let k = 0; k + 1 < lobes.length; k++) {
    let mn = 9;
    for (let i = lobes[k]; i <= lobes[k + 1]; i++) mn = Math.min(mn, sm[i]);
    sinus.push(1 - mn / Math.min(lobeR[k], lobeR[k + 1]));
  }
  const c = lobes.findIndex((i) => Math.abs(th(i)) < 10 * DEG), flanked = c > 0 && c < lobes.length - 1;
  const asym = flanked ? Math.abs(lobeR[c - 1] - lobeR[c + 1]) / ((lobeR[c - 1] + lobeR[c + 1]) / 2) : NaN;   // the two laterals: the basals are not always there
  return { sm, lobes, lobeR, sinus, c, flanked, asym };
}
// The blade's SOLIDITY (its area over its convex hull's: a star is low, a mitten high) and its WIDTH OVER LENGTH, (max y − min y)/max x, from the origin — the petiole base — along the axis; and r(θ) symmetrised, the
// mean of the profile at θ and −θ, which is how the six angles of the table in spec §4.5 are read.
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
function shapeOf(r) {
  const pts = Array.from(r, (rr, i) => [rr * Math.cos(th(i)), rr * Math.sin(th(i))]), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { solidity: Math.PI / hullArea(pts), wl: (Math.max(...ys) - Math.min(...ys)) / Math.max(...xs) };
}
const symAt = (r, deg) => { const i = Math.round(((deg * DEG) / TAU + 0.5) * N - 0.5); return 0.5 * (r[i] + r[N - 1 - i]); };
// THE TIP HALF-ANGLE: how wide the wedge a lobe ends in opens. In the lobe's own frame (x along the lobe, from the petiole base through its tip; y across),
// the margin's half-width w against its depth d behind the tip is a line near the tip — the least-squares slope of w over d ∈ [0.06, 0.26]·(lobe length),
// the distal quarter minus the last sixth of it (the tooth and the rounding of the very tip), atan of it, the mean of the two flanks. It is the angle of the
// margin's tangent, not the chord to a point: a rounded tip would score wide on a chord and a pointed one narrow, which is backwards. Only the three large
// lobes have a flank to fit: a basal lobe's is the notch of the base.
function tipHalfAngle(sm, i) {
  const at = (a) => { const u = (a / TAU + 0.5) * N - 0.5, k = Math.floor(u), f = u - k; return sm[((k % N) + N) % N] * (1 - f) + sm[(((k + 1) % N) + N) % N] * f; };
  const rp = sm[i], angles = [];
  for (const dir of [-1, 1]) {
    const pts = [];
    let prev = rp;
    for (let k = 1; k < 220; k++) {
      const del = dir * k * (TAU / N) * 0.5, rr = at(th(i) + del);
      if (rr > prev + 1e-9 && k > 4) break;                     // the margin turns up into the next lobe
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

const SEEDS = [1, 1234, 90210];
const MAPLE = LEAF.LEAF_SHAPES.maple;
const outline = (seed, v) => LEAF.profile(MAPLE, LEAF.outlineSeed(MAPLE, seed, v));
const memo = new Map();
const outlines = (seed) => { if (!memo.has(seed)) memo.set(seed, Array.from({ length: LEAF.LEAF_VARIANTS }, (_, v) => outline(seed, v))); return memo.get(seed); };
const every = (f) => { for (const seed of SEEDS) outlines(seed).forEach((r, v) => { f(r, `seed ${seed} v${v}`, measure(r), seed, v); }); };

test("eight variants of a sugar maple, three seeds: three to five lobes across the forward 250° — a central lobe on the axis and one each side of it, the laterals at 33–53° (José's thirteen: 43 ± 4)", () => {
  expect(LEAF.LEAF_VARIANTS).toBe(8);
  expect(LEAF.LEAF_SAMPLES).toBe(256);
  expect(LEAF.LEAF_ID_FRAC).toBe(32);   // the fraction of a cluster id, in 1/32ths: exact in float32 for any cluster a texture can hold
  expect((LEAF.LEAF_VARIANTS - 1) / LEAF.LEAF_ID_FRAC, "the VS reads the cluster as int(iC.w + 0.5): a fraction of ½ or more would round up into the next cluster").toBeLessThan(0.5);
  const counts = [], lat = [];
  every((_r, tag, m) => {
    expect(m.lobes.length, tag).toBeGreaterThanOrEqual(3); expect(m.lobes.length, tag).toBeLessThanOrEqual(5);
    expect(m.flanked, `${tag}: a central lobe within 10° of the axis, and a lobe each side of it`).toBe(true);
    for (const i of [m.lobes[m.c - 1], m.lobes[m.c + 1]]) { const a = Math.abs(th(i) / DEG); expect(a, tag).toBeGreaterThan(33); expect(a, tag).toBeLessThan(53); lat.push(a); }
    counts.push(m.lobes.length);
  });
  expect(mean(counts), "three main lobes and, now and then, a small basal one — not the star's five").toBeLessThanOrEqual(4.6);
  expect(mean(lat)).toBeGreaterThan(40); expect(mean(lat)).toBeLessThan(47);
});

test("the lobes' order of length: the central lobe is the longest of a maple — on every leaf, and by more than 5% over its laterals on average", () => {
  const ratio = [];
  every((_r, tag, m) => {
    expect(m.lobeR[m.c], tag).toBeGreaterThan(m.lobeR[m.c - 1]);
    expect(m.lobeR[m.c], tag).toBeGreaterThan(m.lobeR[m.c + 1]);
    ratio.push(m.lobeR[m.c] / ((m.lobeR[m.c - 1] + m.lobeR[m.c + 1]) / 2));
  });
  expect(mean(ratio), "a central lobe stands clear of its laterals").toBeGreaterThan(1.05);
});

test("sinuses: central–lateral 0.12–0.45 of the shorter lobe on every leaf, 0.20–0.32 on average (José's: 0.26) — U's, not the five-pointed star's gaps (0.53)", () => {
  const all = [];
  every((_r, tag, m) => {
    for (const k of [m.c - 1, m.c]) { expect(m.sinus[k], `${tag} sinus ${k}`).toBeGreaterThan(0.12); expect(m.sinus[k], `${tag} sinus ${k}`).toBeLessThan(0.45); all.push(m.sinus[k]); }
  });
  expect(mean(all)).toBeGreaterThan(0.20); expect(mean(all)).toBeLessThan(0.32);
});

test("solidity and width over length: the blade fills its hull (0.66–0.83 on every leaf, 0.70–0.79 on average; his 0.760) and is about as wide as it is long (0.95–1.60, 1.10–1.45; his 1.29)", () => {
  const sol = [], wl = [];
  every((r, tag) => {
    const q = shapeOf(r);
    expect(q.solidity, tag).toBeGreaterThan(0.66); expect(q.solidity, tag).toBeLessThan(0.83);
    expect(q.wl, tag).toBeGreaterThan(0.95); expect(q.wl, tag).toBeLessThan(1.60);
    sol.push(q.solidity); wl.push(q.wl);
  });
  expect(mean(sol)).toBeGreaterThan(0.70); expect(mean(sol)).toBeLessThan(0.79);
  expect(mean(wl)).toBeGreaterThan(1.10); expect(mean(wl)).toBeLessThan(1.45);
});

test("a truncate base: no blade behind the petiole — mean r(150°) ≤ 0.12 and r(120°) ≤ 0.25 (his 0.03 and 0.11; the star's 0.30 and 0.74) — and exactly: r(θ)·(−cos θ) never passes back·k", () => {
  expect(MAPLE.back, "the half-plane behind the petiole's insertion, in the grammar's own units").toBeGreaterThan(0);
  const r150 = [], r120 = [];
  for (const seed of SEEDS) for (let v = 0; v < LEAF.LEAF_VARIANTS; v++) {
    const b = LEAF.bladeOf(MAPLE, LEAF.outlineSeed(MAPLE, seed, v));
    r150.push(symAt(b.r, 150)); r120.push(symAt(b.r, 120));
    for (let i = 0; i < N; i++) { const c = Math.cos(th(i)); if (c < 0) expect(b.r[i] * -c, `seed ${seed} v${v} ray ${i}`).toBeLessThanOrEqual(MAPLE.back * b.k + 1e-12); }
  }
  expect(mean(r150)).toBeLessThanOrEqual(0.12);
  expect(mean(r120)).toBeLessThanOrEqual(0.25);
});

test("the laterals sit where his do: the blade reaches farther at 44° than at 62° (his 1.66 against 1.15) — the star's deep gap was at 44° and its laterals at 62°", () => {
  const r44 = [], r62 = [];
  every((r) => { r44.push(symAt(r, 44)); r62.push(symAt(r, 62)); });
  expect(mean(r44)).toBeGreaterThan(mean(r62));
});

test("the lobes end in a wedge 25–35° to either side of their axis (the tip half-angle, measured on the distal quarter of the margin — see tipHalfAngle): the central lobe and both laterals", () => {
  every((_r, tag, m) => {
    for (const k of [m.c - 1, m.c, m.c + 1]) { const a = tipHalfAngle(m.sm, m.lobes[k]); expect(a, `${tag} lobe ${k}`).toBeGreaterThan(25); expect(a, `${tag} lobe ${k}`).toBeLessThan(35); }
  });
  // the measure itself reads a wedge: a cone pointing along +x with its apex at 1 and its flanks 30° off the axis, which in polar form is r(θ) = 1/(cos θ + sin|θ|/tan 30°)
  const cone = Float64Array.from({ length: N }, (_, i) => (Math.abs(th(i)) < 60 * DEG ? 1 / (Math.cos(th(i)) + Math.sin(Math.abs(th(i))) / Math.tan(30 * DEG)) : 0.35));
  const m = measure(cone), tip = m.lobes.find((i) => Math.abs(th(i)) < 0.05);
  expect(tip).toBeDefined();
  expect(tipHalfAngle(m.sm, tip)).toBeGreaterThan(29);
  expect(tipHalfAngle(m.sm, tip)).toBeLessThan(31);
});

test("asymmetry: no two sides of a leaf are one (the laterals differ on every leaf, by more than 0.2%), and by a tenth of a lobe on average (3–15%)", () => {
  const all = [];
  every((_r, tag, m) => { expect(m.asym, tag).toBeGreaterThan(0.002); all.push(m.asym); });
  expect(mean(all)).toBeGreaterThan(0.03);
  expect(mean(all)).toBeLessThan(0.15);
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

test("the eight variants are eight leaves: no two within 0.02 of a unit radius of each other, RMS over the profile", () => {
  for (const seed of SEEDS) {
    const rs = outlines(seed);
    for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += (rs[a][i] - rs[b][i]) ** 2;
      expect(Math.sqrt(s / N), `seed ${seed}: ${a} vs ${b}`).toBeGreaterThan(0.02);
    }
  }
});

// a radial profile can only hold a STAR-SHAPED blade, from the origin it is read from: along every ray from the petiole base the blade is one stretch
test("the blade is star-shaped from the petiole base: along every one of the 256 rays the lamina is one run, so r(θ) is the whole truth about it", () => {
  for (const seed of SEEDS) for (let v = 0; v < LEAF.LEAF_VARIANTS; v++) {
    const { discs } = LEAF.growLeaf(MAPLE, math.mulberry32(LEAF.outlineSeed(MAPLE, seed, v)));
    for (let i = 0; i < N; i++) {
      const c = Math.cos(th(i)), s = Math.sin(th(i)), chords = [];
      for (let k = 0; k < discs.length; k += 3) {
        const b = discs[k] * c + discs[k + 1] * s, h = b * b - (discs[k] ** 2 + discs[k + 1] ** 2 - discs[k + 2] ** 2);
        if (h >= 0) chords.push([b - Math.sqrt(h), b + Math.sqrt(h)]);
      }
      const ahead = chords.filter(([, t1]) => t1 > 0).map(([t0, t1]) => [Math.max(t0, 0), t1]).sort((p, q) => p[0] - q[0]);   // from the base outward: what lies behind it is not on the ray
      let reach = ahead[0][1], runs = 1;
      for (const [t0, t1] of ahead.slice(1)) { if (t0 > reach + 0.01) runs++; reach = Math.max(reach, t1); }   // a ray grazing the margin crosses the scallops between two discs 0.01 apart: a gap narrower than that is the lamina's grain, not a re-entry
      expect(runs, `seed ${seed} v${v} ray ${i}`).toBe(1);
    }
  }
});

test("the veins: five primaries fanned from the base, each with alternate secondaries every 0.18 that run out until they leave the lamina", () => {
  const { veins, discs, teeth } = LEAF.growLeaf(MAPLE, math.mulberry32(5));
  const prim = veins.filter((v) => v.order === 1), sec = veins.filter((v) => v.order === 2);
  expect(prim).toHaveLength(5);
  prim.forEach((p, k) => {
    const ang = Math.atan2(p.b[1], p.b[0]) / DEG, len = Math.hypot(...p.b);
    expect(Math.abs(ang - MAPLE.angles[k]), `primary ${k}`).toBeLessThanOrEqual(MAPLE.angleJitter + 1e-9);
    expect(Math.abs(len / MAPLE.lengths[k] - 1), `primary ${k}`).toBeLessThanOrEqual(MAPLE.lengthJitter + 1e-9);
  });
  expect(sec.length).toBe(teeth.length);
  expect(sec.length).toBeGreaterThan(10);
  for (const s of sec) {
    // it leaves a primary, every 0.18 along it, at 45° ± 10% (alternating sides) ...
    const on = prim.map((p) => { const L = Math.hypot(...p.b), u = [p.b[0] / L, p.b[1] / L]; return { p, d: s.a[0] * u[0] + s.a[1] * u[1], off: Math.abs(s.a[0] * u[1] - s.a[1] * u[0]) }; }).filter((q) => q.off < 1e-9 && q.d > 0);
    expect(on, "its base lies on exactly one primary").toHaveLength(1);
    const { p, d } = on[0], pa = Math.atan2(p.b[1], p.b[0]), sa = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
    const dev = Math.abs(Math.atan2(Math.sin(sa - pa), Math.cos(sa - pa))) / DEG;
    expect(dev).toBeGreaterThanOrEqual(45 * 0.9 - 1e-6); expect(dev).toBeLessThanOrEqual(45 * 1.1 + 1e-6);
    expect(Math.abs(d / MAPLE.secStep - Math.round(d / MAPLE.secStep)), "every 0.18 along the vein").toBeLessThan(1e-9);
    // ... and ends where the lamina does: its tip is inside it, and a hair further along it is not (the lamina is the discs, all of which are the primaries')
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), ux = (s.b[0] - s.a[0]) / L, uy = (s.b[1] - s.a[1]) / L;
    const inside = (x, y) => { for (let k = 0; k < discs.length; k += 3) if ((x - discs[k]) ** 2 + (y - discs[k + 1]) ** 2 <= discs[k + 2] ** 2) return true; return false; };
    expect(inside(s.b[0] - ux * 1e-6, s.b[1] - uy * 1e-6), "its tip is on the lamina's edge").toBe(true);
    expect(inside(s.b[0] + ux * 2e-3, s.b[1] + uy * 2e-3), "...and a hair past it is not").toBe(false);
  }
});

test("the outline is a pure function of its seed: bit-equal when regrown, different for another seed, and nothing is read but the arguments", () => {
  const a = LEAF.profile(MAPLE, 77), b = LEAF.profile(MAPLE, 77);
  expect(Array.from(b)).toEqual(Array.from(a));
  expect(Array.from(LEAF.profile(MAPLE, 78))).not.toEqual(Array.from(a));
  const real = Math.random;
  Math.random = () => { throw new Error("the leaf asked for Math.random"); };
  try { LEAF.profile(MAPLE, 5); LEAF.leafShape("maple", 99); LEAF.leafVariant(1, 2, 3); } finally { Math.random = real; }
  expect(() => LEAF.profile(Object.freeze({ ...MAPLE, angles: Object.freeze([...MAPLE.angles]), lengths: Object.freeze([...MAPLE.lengths]) }), 3)).not.toThrow();   // nothing is written to the spec
  expect(Object.isFrozen(MAPLE) && Object.isFrozen(MAPLE.angles) && Object.isFrozen(MAPLE.lengths), "the species is a constant").toBe(true);
});

// ---- the descriptor the grove hands the bake -----------------------------------------------------------------------------------
test("leafShape: the ellipse is no profile at all; the maple is eight rows of 256 float32s, the very profiles above, and the box the quad has to cover", () => {
  expect(LEAF.leafShape("ellipse", 1234)).toBeNull();
  expect(LEAF.leafShape("", 1234)).toBeNull();
  expect(LEAF.leafShape("oak", 1234)).toBeNull();   // a species with no outline yet is the ellipse, not an error
  const s = LEAF.leafShape("maple", 1234);
  expect(s.rows).toBe(8);
  expect(s.data).toBeInstanceOf(Float32Array);
  expect(s.data.length).toBe(8 * 256);
  outlines(1234).forEach((r, v) => { for (let i = 0; i < N; i++) expect(s.data[v * N + i]).toBe(Math.fround(r[i])); });
  expect(LEAF.leafShape("maple", 1234)).toBe(s);                                   // memoised on (shape, seed)
  expect(LEAF.leafShape("maple", 1235)).not.toBe(s);
  expect(Array.from(LEAF.leafShape("maple", 1235).data)).not.toEqual(Array.from(s.data));
  // the box: every point of every outline lies inside it, and it is the union, not a margin of air (within the pad of 0.01 a side)
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
  expect(s.rmax).toBe(Math.max(...s.data));                                          // the longest radius any outline has: the faithful cast frame's pad
  expect(4 * hx * hy, "the quad costs about twice the ellipse's (4 units²)").toBeGreaterThan(6);
  expect(4 * hx * hy).toBeLessThan(10);
});

// ---- leafVariant: which of the eight a leaf hangs in, and lies in -----------------------------------------------------------------
test("leafVariant: one of eight, a pure function of (seed, cluster, leaf), uniform over them, and different leaves are different draws", () => {
  const cells = Array.from({ length: 4000 }, (_, i) => [i >> 4, i & 15]);
  const v = cells.map(([j, k]) => LEAF.leafVariant(77, j, k));
  expect(v.every((x) => Number.isInteger(x) && x >= 0 && x < 8)).toBe(true);
  expect(cells.map(([j, k]) => LEAF.leafVariant(77, j, k))).toEqual(v);                       // pure: no stream to advance
  const counts = new Array(8).fill(0);
  for (const x of v) counts[x]++;
  for (const c of counts) expect(Math.abs(c - 500)).toBeLessThan(80);                          // ~±3.6σ of 4000 draws into eight bins
  expect(cells.slice(0, 200).map(([j, k]) => LEAF.leafVariant(78, j, k))).not.toEqual(v.slice(0, 200));   // the seed is in it
  expect(LEAF.leafVariant(77, 5, 3) !== LEAF.leafVariant(77, 3, 5) || LEAF.leafVariant(77, 6, 3) !== LEAF.leafVariant(77, 3, 6), "so is each address, in order").toBe(true);
});

test("the leaf's streams never touch the growth RNG: their own salts, uncorrelated with every other stream, and no state to advance", () => {
  const salts = [LEAF.VARIANT_SALT, LEAF.OUTLINE_SALT, LEAF.FLIP_SALT, 0x2B9D4F6E /* litter */, 0x51ED270B /* the pigment draw */, 0x7A3C91D5 /* the drop day */, 0x5bd1e995 /* wind identity */, 0x5EED /* growth */];
  expect(new Set(salts).size).toBe(salts.length);
  const corr = (u, w) => {
    const n = u.length, mu = mean(u), mw = mean(w);
    let suw = 0, suu = 0, sww = 0;
    for (let i = 0; i < n; i++) { suw += (u[i] - mu) * (w[i] - mw); suu += (u[i] - mu) ** 2; sww += (w[i] - mw) ** 2; }
    return suw / Math.sqrt(suu * sww);
  };
  const cells = Array.from({ length: 2000 }, (_, i) => [i >> 4, i & 15]), seed = 77;
  const variant = cells.map(([j, k]) => LEAF.leafVariant(seed, j, k));
  const first = (a, b, c) => math.mulberry32(math.hash3(a, b, c))();
  const streams = {
    arrangement: cells.map(([j]) => first(seed, j, 101)),
    wind: cells.map(([j]) => first(seed ^ 0x5bd1e995, j, 101)),
    pigment: cells.map(([j, k]) => first(seed ^ 0x51ED270B, j, k)),
    drop: cells.map(([j, k]) => math.dropHash(seed, j, k)),
    litter: cells.map(([j, k]) => first(seed ^ 0x2B9D4F6E, j, k)),
    flip: cells.map(([j, k]) => (LEAF.leafFlip(seed, j, k) ? 1 : 0)),   // the half turn: not tied to the outline a leaf hangs in
  };
  for (const [name, s] of Object.entries(streams)) expect(Math.abs(corr(variant, s)), name).toBeLessThan(0.1);
  // the grammar's own stream is no leaf's: the variant a leaf hangs in does not move the outlines, and the outlines do not move it
  const before = Array.from(LEAF.profile(MAPLE, LEAF.outlineSeed(MAPLE, seed, 3)));
  for (const [j, k] of cells) LEAF.leafVariant(seed, j, k);
  expect(Array.from(LEAF.profile(MAPLE, LEAF.outlineSeed(MAPLE, seed, 3)))).toEqual(before);
  expect(LEAF.leafVariant(seed, 5, 5)).toBe(variant[5 * 16 + 5]);
});

// ============================================================================
// THE GROVE: the one place that hangs an outline on a leaf. A recording stub GL keeps the floats buildGrove uploads and the texture it makes.
// ============================================================================
import { makeGrove } from "./komorebi-grove.js";
import { PRESETS, TREE_SPECIES } from "./presets.js";

function groveRig(over, faithful = false) {
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
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  const on = (tx, name) => calls.filter((c) => c.tex === tx && c.name === name).map((c) => c.a);
  return { params, g, on, layers: g.layerVAO.map((l) => l.buf.data), faithLeaves: faith.buf.data, litter: g.litter };
}
const MAPLE_LOOK = { ...PRESETS["afternoon 7"], leaf_shape: "maple", leaf_aspect: 1, leaf_size_m: 0.103, seed: 4242 };
// the leaves of a buffer in the order they were pushed: (cluster, place in it) and the 12th float, which is the cluster id and — for an outline — its variant in the fraction
const slots = (buf, stride) => {
  const n = new Map(), out = [];
  for (let i = 0; i + stride <= buf.length; i += stride) { const w = buf[i + 11], j = Math.floor(w), k = n.get(j) ?? 0; n.set(j, k + 1); out.push({ w, j, k }); }
  return out;
};

test("the ellipse's cluster id is the integer it always was: iC.w is j to the bit, so every record, stride and digest of every shipped grove is the one before", () => {
  const { layers, faithLeaves } = groveRig({});
  for (const L of layers) { expect(L.length % 17).toBe(0); for (const { w, j } of slots(L, 17)) { expect(Number.isInteger(w)).toBe(true); expect(w).toBe(j); } }
  expect(faithLeaves.length % 18).toBe(0);
  for (const { w, j } of slots(faithLeaves, 18)) expect(w).toBe(j);
  expect(groveRig({}).g.shape).toBeNull();
});

test("a maple's cluster id carries its outline in the fraction — j + v/32, exact in float32 — so the VS's int(iC.w + 0.5) is still j and nothing's stride moves", () => {
  const { params, layers, faithLeaves, g } = groveRig(MAPLE_LOOK);
  let n = 0;
  for (const [buf, stride] of [...layers.map((L) => [L, 17]), [faithLeaves, 18]]) {
    expect(buf.length % stride).toBe(0);
    for (const { w, j, k } of slots(buf, stride)) {
      const v = LEAF.leafVariant(params.seed, j, k);
      expect(w, `cluster ${j} leaf ${k}`).toBe(j + v / LEAF.LEAF_ID_FRAC);
      expect(Math.floor(w)).toBe(j);
      expect(Math.floor(w + 0.5), "what the VS reads as the cluster").toBe(j);
      expect(Math.floor((w - j) * 32 + 0.5), "what the VS reads as the variant").toBe(v);
      n++;
    }
  }
  expect(n).toBeGreaterThan(500);
  expect(new Set(slots(faithLeaves, 18).map(({ w, j }) => Math.round((w - j) * 32))).size, "the eight outlines are all in use").toBe(8);
  expect(g.shape).toBe(LEAF.leafShape("maple", params.seed));
});

test("the outline never touches the growth: a maple grove is the ellipse's grove leaf for leaf — positions, sizes, tau — but for the one float, the aspect it asked for, and half the angles a half turn on", () => {
  const ell = groveRig({ ...MAPLE_LOOK, leaf_shape: "ellipse" }), map = groveRig(MAPLE_LOOK);
  expect(map.layers.length).toBe(ell.layers.length);
  let n = 0, turned = 0;
  map.layers.forEach((L, l) => {
    expect(L.length).toBe(ell.layers[l].length);
    for (let i = 0; i < L.length; i++) if (i % 17 !== 11 && i % 17 !== 4) expect(Object.is(L[i], ell.layers[l][i]), `layer ${l} float ${i}`).toBe(true);
    for (let i = 11; i < L.length; i += 17) expect(Math.floor(L[i])).toBe(ell.layers[l][i]);
    // the angle: the ellipse's draw, or that draw plus π (float32 rounds the sum, so within an ulp of 2π)
    for (let i = 4; i < L.length; i += 17) {
      const d = L[i] - ell.layers[l][i];
      expect(d === 0 || Math.abs(d - Math.PI) < 2e-6, `layer ${l} float ${i}: ${d}`).toBe(true);
      n++; if (d !== 0) turned++;
    }
  });
  expect(n).toBeGreaterThan(200);
  expect(turned / n, "about half the blades point into the other half-plane").toBeGreaterThan(0.35);
  expect(turned / n).toBeLessThan(0.65);
});

test("an outline's half turn is a pure hash of (seed, cluster, leaf): the ellipse's angles stay [0, π) and every maple tip direction is reachable", () => {
  const ell = groveRig({ ...MAPLE_LOOK, leaf_shape: "ellipse" }), map = groveRig(MAPLE_LOOK);
  for (const L of ell.layers) for (let i = 4; i < L.length; i += 17) { expect(L[i]).toBeGreaterThanOrEqual(0); expect(L[i]).toBeLessThan(Math.PI + 1e-6); }
  let down = 0, up = 0;   // the central lobe's direction at rest is R·(1, 0) = (cos a, −sin a) (VS_BAKE): its y sign says which half-plane the tip is in
  for (const L of map.layers) for (let i = 4; i < L.length; i += 17) { if (-Math.sin(L[i]) < 0) down++; else up++; }
  expect(down).toBeGreaterThan(0);
  expect(up).toBeGreaterThan(0);
  const flips = [];
  for (let k = 0; k < 64; k++) flips.push(LEAF.leafFlip(7, 3, k));
  for (let k = 0; k < 64; k++) expect(LEAF.leafFlip(7, 3, k), "the same address, the same answer").toBe(flips[k]);
  expect(flips.some((f) => f) && flips.some((f) => !f)).toBe(true);
});

test("one texture per grove, made beside the cluster textures: R16F, 256 × 8, REPEAT in θ and CLAMP across variants, LINEAR — and a 1×1 for the ellipse", () => {
  const m = groveRig(MAPLE_LOOK), e = groveRig({});
  expect(m.g.leafTex).toBeDefined();
  expect(m.on(m.g.leafTex, "texImage2D")).toEqual([["TEXTURE_2D", 0, "R16F", 256, 8, 0, "RED", "FLOAT", m.g.shape.data]]);
  const par = m.on(m.g.leafTex, "texParameteri").map((a) => a.slice(1).join("="));
  expect(par).toContain("TEXTURE_MIN_FILTER=LINEAR"); expect(par).toContain("TEXTURE_MAG_FILTER=LINEAR");
  expect(par).toContain("TEXTURE_WRAP_S=REPEAT");            // the θ seam: ±π are one place
  expect(par).toContain("TEXTURE_WRAP_T=CLAMP_TO_EDGE");     // a row is a variant, and a read between two of them is no leaf
  expect(par.some((p) => p.startsWith("TEXTURE_MIN_FILTER=") && /MIPMAP/.test(p)), "no mips: a profile is read at its own resolution").toBe(false);
  expect(e.on(e.g.leafTex, "texImage2D")).toEqual([["TEXTURE_2D", 0, "R16F", 1, 1, 0, "RED", "HALF_FLOAT", null]]);
  expect(e.g.shape).toBeNull();
  expect(m.g.leafTex).not.toBe(m.g.clusterTex);
  expect(groveRig(MAPLE_LOOK).g.leafTex, "a texture per grove: the crossfade bakes two in one pass").not.toBe(m.g.leafTex);
});

test("the grove's variant is a function of the grove's seed: another seed hangs other outlines, and regrowing the same one hangs the same", () => {
  const a = slots(groveRig(MAPLE_LOOK).faithLeaves, 18).map((s) => s.w), b = slots(groveRig(MAPLE_LOOK).faithLeaves, 18).map((s) => s.w), c = slots(groveRig({ ...MAPLE_LOOK, seed: 4243 }).faithLeaves, 18).map((s) => s.w);
  expect(b).toEqual(a);
  expect(c).not.toEqual(a);
});

// ============================================================================
// THE ASPECT LAW (leaf diversity, 2026-10-09). José: "last night i actually tried rendering maple and it looked so thin and weird". The hang loop divided every leaf's width by
// leaf_aspect, an outline's included, so his ultraviolet maple (aspect 1.75) was squashed from W/L 1.27-1.71 to 0.73-0.98 (each over 1.75) — narrower than every one of his thirteen leaves — and the
// editor's `leaf shape` select leaves the look's 1.75 in place. An outline has its own width-to-length; what the look's aspect means for it is the leaf's AREA: A = B0 = size/(2√aspect),
// so π·A·B0 is the ellipse's π·size²/(4·aspect) and the canopy is as full as it was.
// ============================================================================
const ASPECT = 1.75;
const lawBuffers = (faithful) => {
  const map = groveRig({ ...MAPLE_LOOK, leaf_aspect: ASPECT }, faithful), ell = groveRig({ ...MAPLE_LOOK, leaf_shape: "ellipse", leaf_aspect: ASPECT }, faithful);
  return faithful ? [[map.faithLeaves, ell.faithLeaves, 18]] : map.layers.map((L, l) => [L, ell.layers[l], 17]);
};

test("an outline takes the look's leaf AREA, never its aspect: A === B0 and A·B0 the ellipse's, in both buffers — and nothing else of a leaf moves but its half turn and its variant", () => {
  let n = 0;
  for (const faithful of [false, true]) for (const [M, E, stride] of lawBuffers(faithful)) {
    expect(M.length).toBe(E.length);
    for (let i = 0; i < M.length; i += stride) {
      const tag = `${faithful ? "faithful" : "layer"} leaf at float ${i}`;
      expect(M[i + 2], `${tag}: an outline is as wide as it is long`).toBe(M[i + 3]);
      expect(Math.abs((M[i + 2] * M[i + 2]) / (E[i + 2] * E[i + 3]) - 1), `${tag}: the ellipse's area (float32 rounding only)`).toBeLessThan(2e-7);
      for (let c = 0; c < stride; c++) if (c !== 2 && c !== 3 && c !== 4 && c !== 11) expect(Object.is(M[i + c], E[i + c]), `${tag} float ${c}`).toBe(true);
      n++;
    }
  }
  expect(n).toBeGreaterThan(1000);
});

test("the ellipse keeps its own line at the look's aspect: B0 is A/aspect, never A — the law is the outline's and nobody else's", () => {
  for (const faithful of [false, true]) {
    const ell = groveRig({ ...MAPLE_LOOK, leaf_shape: "ellipse", leaf_aspect: ASPECT }, faithful);
    const bufs = faithful ? [[ell.faithLeaves, 18]] : ell.layers.map((L) => [L, 17]);
    for (const [E, stride] of bufs) for (let i = 0; i < E.length; i += stride) {
      expect(E[i + 3] / Math.fround(E[i + 2] / ASPECT) - 1, `${faithful ? "faithful" : "layer"} float ${i}`).toBeCloseTo(0, 6);
      expect(E[i + 3]).toBeLessThan(E[i + 2]);
    }
  }
});

test("the litter follows by itself: a fallen outline lies at A === B0 and the ellipse's area, in doubles — it reads the record's (A, B0)", () => {
  const over = { phenology: 0.9, leaf_drop: 1 }, map = groveRig({ ...MAPLE_LOOK, ...over, leaf_aspect: ASPECT }).litter, ell = groveRig({ ...MAPLE_LOOK, ...over, leaf_shape: "ellipse", leaf_aspect: ASPECT }).litter;
  expect(map.length, "the same leaves fell").toBe(ell.length);
  expect(map.length).toBeGreaterThan(100);
  const at = new Map(ell.map((l) => [`${l.j}/${l.k}`, l]));
  for (const l of map) {
    const e = at.get(`${l.j}/${l.k}`);
    expect(e, `leaf ${l.j}/${l.k} fell on both`).toBeDefined();
    expect(l.size[0], `leaf ${l.j}/${l.k}`).toBe(l.size[1]);
    expect(Math.abs((l.size[0] * l.size[1]) / (e.size[0] * e.size[1]) - 1), `leaf ${l.j}/${l.k}`).toBeLessThan(1e-15);
  }
});

test("the faithful cast's pad still covers a leaf: the longest half-axis in the buffer is at most 0.7·leaf_size_m, at aspect 1 and at 1.75", () => {
  for (const aspect of [1, ASPECT]) for (const faithful of [false, true]) {
    const { faithLeaves } = groveRig({ ...MAPLE_LOOK, leaf_aspect: aspect }, faithful);
    let top = 0;
    for (let i = 0; i < faithLeaves.length; i += 18) top = Math.max(top, faithLeaves[i + 2], faithLeaves[i + 3]);
    expect(top, `aspect ${aspect}`).toBeLessThanOrEqual(0.7 * MAPLE_LOOK.leaf_size_m * (1 + 1e-6));
    expect(top).toBeGreaterThan(0.5 * MAPLE_LOOK.leaf_size_m);
  }
});

// ============================================================================
// THE SHADERS: the quad grows with the outline, and one snippet carries the edge law into the three programs that cut a leaf's mask. The strings are
// the contract (the pixel harness holds the pixels): the ellipse's own line must survive in each, because the gate is a uniform branch and not a program.
// ============================================================================
import { readFileSync } from "node:fs";
import * as SH from "./komorebi-shaders.js";
const code = (s) => s.replace(/\/\/.*$/gm, "");

test("the three masks keep the ellipse's own line and take the outline through ONE snippet, behind a uniform branch — not a program variant", () => {
  expect(typeof SH.GLSL_LEAF_Q).toBe("string");
  for (const [name, fs] of Object.entries({ FS_BAKE: SH.FS_BAKE, FS_FAITH: SH.FS_FAITH, FS_LITTER: SH.FS_LITTER })) {
    expect(fs.includes("float r = length(vLocal);"), `${name} keeps the literal ellipse line`).toBe(true);
    expect(fs.includes(SH.GLSL_LEAF_Q), `${name} carries the snippet`).toBe(true);
    expect(fs.split("float leafQ(").length - 1, `${name} defines it once`).toBe(1);
    expect(fs.includes("uniform int uLeafShape;"), `${name} declares the gate`).toBe(true);
    expect(code(fs).includes("if(uLeafShape != 0) r = leafQ(vLocal, vVariant);"), `${name}: the gate is a uniform branch after the ellipse's line`).toBe(true);
    expect(code(fs).indexOf("float r = length(vLocal);")).toBeLessThan(code(fs).indexOf("if(uLeafShape != 0)"));
    expect(fs.includes("flat in float vVariant;"), `${name}: the outline arrives flat — a leaf has one`).toBe(true);
  }
  // nothing else cuts a leaf's mask
  for (const [name, src] of Object.entries({ FS_FACC: SH.FS_FACC, FS_FILL: SH.FS_FILL, FS_FAITH_SEG: SH.FS_FAITH_SEG })) expect(code(src).includes("leafQ"), name).toBe(false);
});

test("leafQ: q' = |l| − r(θ) + 1 — the ellipse's ramp WIDTH kept at the tips and the sinus bottoms — read at u = θ/2π + ½ from the variant's own row, guarded at the origin", () => {
  const q = code(SH.GLSL_LEAF_Q);
  expect(q).toContain("uniform highp sampler2D uLeafTex;");
  expect(q).toContain("float leafQ(vec2 l, float variant){");
  expect(q).toContain("atan(");
  expect(q).toContain("0.15915494");                                                  // 1/2π: u = θ/2π + ½
  expect(q).toContain(`float v = (variant + 0.5)/${LEAF.LEAF_VARIANTS}.0;`);         // a row's centre: no read between two variants — the literal line, kept: a divide by a literal may compile to an exact multiply where a divide by a uniform may not
  expect(q, "a varied grove's table has more rows: a uniform branch overrides the literal line, after it").toContain("uniform float uLeafRows;");
  expect(q).toContain("if(uLeafRows > 0.0) v = (variant + 0.5)/uLeafRows;");
  expect(q.indexOf("if(uLeafRows > 0.0)"), "...and only after it").toBeGreaterThan(q.indexOf("float v = (variant + 0.5)/"));
  expect(q).toContain("- texture(uLeafTex, vec2(u, v)).r + 1.0");
  expect(/dot\(l, ?l\) < 1e-12/.test(q), "atan(0, 0) is undefined: the origin has a guard").toBe(true);
});

test("the quad grows with the outline: every VS places a corner at aCorner·box.zw + box.xy, and the ellipse's (0, 0, 1, 1) leaves it to the bit", () => {
  for (const [name, vs] of Object.entries({ VS_BAKE: SH.VS_BAKE, VS_FAITH: SH.VS_FAITH })) {
    expect(vs.includes("uniform vec4  uShapeBox;"), name).toBe(true);
    expect(code(vs).includes("vec2 lc = aCorner*uShapeBox.zw + uShapeBox.xy;"), `${name} scales the corner into the box`).toBe(true);
    expect(code(vs).includes("R*(lc*vec2(A,B))"), `${name} places the leaf by it`).toBe(true);
    expect(code(vs).includes("vLocal = lc;"), `${name} hands the mask the same local`).toBe(true);
    expect(code(vs).includes("vVariant = floor(fract(iC.w)*uLeafIdFrac + 0.5);"), `${name} reads the outline off the fraction, by the grove's own packing`).toBe(true);
    expect(vs.includes("uniform float uLeafIdFrac;"), `${name} declares the packing`).toBe(true);
    expect(code(vs).includes("int cid = int(iC.w + 0.5);"), `${name}: the cluster is still j`).toBe(true);
    expect(code(vs).includes("R*(aCorner*vec2(A,B))"), `${name}: no corner is placed any other way`).toBe(false);
  }
  const lit = code(SH.VS_LITTER);
  expect(SH.VS_LITTER.includes("uniform vec4  uShapeBox;")).toBe(true);
  expect(lit).toContain("vec2 lc = aCorner*m*uShapeBox.zw + uShapeBox.xy;");
  expect(lit).toContain("vec2 d = lc*hs*k;");
  expect(lit).toContain("vLocal = lc;");
  expect(lit).toContain("vVariant = iB.w;");                                          // the litter's own instance slot: [cos, sin, fade, variant]
  expect(lit).toContain("vCol = vec4(iC.rgb*a, a);");                                 // premultiplied, as before
  expect(/\bvec2 d = aCorner\*m\*hs\*k;/.test(lit), "the old corner line is gone").toBe(false);
});

test("the program's uniforms are named alike in the bake, the faithful bake and the carpet, and the engine looks every one of them up and frees the texture", () => {
  const engine = readFileSync(new URL("./komorebi-engine.js", import.meta.url), "utf8");
  const names = [["leafTex", "uLeafTex"], ["leafShape", "uLeafShape"], ["shapeBox", "uShapeBox"], ["leafIdFrac", "uLeafIdFrac"], ["leafRows", "uLeafRows"]];   // the last two: the grove's packing (the VS) and its row count (the FS) — the litter's program has no uLeafIdFrac, and its lookup is a null that an upload ignores
  for (const prog of ["progBake", "progFaith"]) for (const [key, name] of names) expect(engine.includes(`${key}:loc(${prog},'${name}')`), `${prog} ${name}`).toBe(true);
  for (const [key, name] of names) expect(engine.includes(`${key}:loc(prog,'${name}')`), `litter ${name}`).toBe(true);
  const between = (a, b) => engine.slice(engine.indexOf(a), engine.indexOf(b, engine.indexOf(a)));
  expect(between("function freeGrove", "function installGrove")).toContain("g.leafTex");                // a grove frees what it made
  expect(between("dispose(){", "gl.getExtension('WEBGL_lose_context')")).toContain("hub.grove?.leafTex");   // ...and a disposed engine frees the active one's (a lost context forgets it with the grove: grove:null)
});

// ============================================================================
// THE BAKES: each grove is drawn in its OWN shape — the layer bake per grove (a crossfade bakes two into one pass), the faithful bake with the active one,
// the carpet with the one the leaves fell from. A recording stub GL reads what each draw was handed.
// ============================================================================
import { makeBake } from "./komorebi-bake.js";
import { bindLeafShape } from "./komorebi-grove.js";

const rec = () => {
  const calls = [];
  const gl = new Proxy({}, { get: (_t, name) => (/^[A-Z][A-Z0-9_]+$/.test(name) ? name : (...a) => { calls.push([name, ...a]); return name === "checkFramebufferStatus" ? "FRAMEBUFFER_COMPLETE" : name === "getParameter" ? `was:${a[0]}` : {}; }) });
  return { calls, gl };
};
// what the program was told about the outline when draw #n was issued: the last of each setting before it
const stateAt = (calls, n) => {
  const draws = calls.map((c, i) => [c, i]).filter(([c]) => c[0] === "drawArraysInstanced").map(([, i]) => i), end = draws[n];
  const last = (pred) => calls.slice(0, end).reverse().find(pred);
  const tex = last((c) => c[0] === "bindTexture" && /^leaf-/.test(c[2]));
  return { tex: tex?.[2], unit: last((c) => c[0] === "uniform1i" && /leafTex$/.test(c[1]))?.[2], shape: last((c) => c[0] === "uniform1i" && /leafShape$/.test(c[1]))?.[2], box: last((c) => c[0] === "uniform4fv" && /shapeBox$/.test(c[1]))?.[2],
    activeBefore: calls.slice(0, calls.indexOf(tex)).reverse().find((c) => c[0] === "activeTexture")?.[1] };
};

test("bindLeafShape: unit 6, the grove's own texture and gate and box and packing — the ellipse's box is (0, 0, 1, 1), the quad it has always been, and an 8-row grove sends 32 and 0 (the literal path)", () => {
  const { calls, gl } = rec(), u = { leafTex: "u.tex", leafShape: "u.shape", shapeBox: "u.box", leafIdFrac: "u.idFrac", leafRows: "u.rows" };
  const shape = LEAF.leafShape("maple", 9), varied = LEAF.leafShape("maple", 9, 1);
  bindLeafShape(gl, u, { leafTex: "leaf-m", shape });
  bindLeafShape(gl, u, { leafTex: "leaf-e", shape: null });
  bindLeafShape(gl, u, { leafTex: "leaf-v", shape: varied });
  expect(calls).toEqual([
    ["activeTexture", "TEXTURE6"], ["bindTexture", "TEXTURE_2D", "leaf-m"], ["uniform1i", "u.tex", 6], ["uniform1i", "u.shape", 1], ["uniform4fv", "u.box", shape.box], ["uniform1f", "u.idFrac", 32], ["uniform1f", "u.rows", 0],
    ["activeTexture", "TEXTURE6"], ["bindTexture", "TEXTURE_2D", "leaf-e"], ["uniform1i", "u.tex", 6], ["uniform1i", "u.shape", 0], ["uniform4fv", "u.box", [0, 0, 1, 1]], ["uniform1f", "u.idFrac", 32], ["uniform1f", "u.rows", 0],
    ["activeTexture", "TEXTURE6"], ["bindTexture", "TEXTURE_2D", "leaf-v"], ["uniform1i", "u.tex", 6], ["uniform1i", "u.shape", 1], ["uniform4fv", "u.box", varied.box], ["uniform1f", "u.idFrac", 128], ["uniform1f", "u.rows", 64],
  ]);
});

function layerRig(grove, groveIn, crossW = 0) {
  const { calls, gl } = rec();
  const keys = ["origin", "extent", "edge", "morph", "morphAmount", "windLevel", "windTime", "leafSwing", "flutterFreq", "stemLen", "sway", "coverage", "clusterTex", "clusterGeom", "leafTex", "leafShape", "shapeBox", "leafIdFrac", "leafRows"];
  const U = { bake: Object.fromEntries(keys.map((k) => [k, `bake.${k}`])) };
  const params = { ...DEFAULTS, layer_count: 2, canopy_extent_m: 12, canopy_base_height_m: 5, canopy_thickness_m: 3 };
  const hub = { gl, params, motion: { u: 0, time: 0, sway: [0, 0] }, src: {}, faith: {}, sky: {}, U, fill: {}, bakeFBO: {}, faithFBO: {}, fillFBO: {}, emptyVAO: {}, progBake: {}, progFaith: {}, progFaithSeg: {}, progFAcc: {},
    bakeRes: () => 256, faithfulOn: () => false, layerTex: [{}, {}, {}, {}], layerHeights: () => [5, 8], grove, groveIn, crossW, fillWanted: () => false };
  makeBake(hub).bake();
  return { calls };
}
const lay = (shape, tag) => ({ layerVAO: [{ vao: "v0", count: 3 }, { vao: "v1", count: 2 }], clusterTex: "cT", clusterGeomTex: "cG", leafTex: `leaf-${tag}`, shape });

test("the layer bake binds each grove's own outline before each of its draws — a crossfade bakes a maple grove and an ellipse one into one layer texture", () => {
  const shape = LEAF.leafShape("maple", 5);
  const solo = layerRig(lay(null, "e"));
  for (let n = 0; n < 2; n++) expect(stateAt(solo.calls, n)).toEqual({ tex: "leaf-e", unit: 6, shape: 0, box: [0, 0, 1, 1], activeBefore: "TEXTURE6" });
  // the unit a bake leaves ACTIVE is the cluster geometry's (5), as it was before an outline existed: the engine binds a target onto whatever unit is active, and unit 6 is the fill's sampler —
  // a frame target bound there is a feedback loop the moment the floor draws into it (the harness found exactly that)
  for (const rig of [solo, layerRig(lay(shape, "m"), lay(null, "e"), 0.4)]) {
    const draws = rig.calls.map((c, i) => [c, i]).filter(([c]) => c[0] === "drawArraysInstanced").map(([, i]) => i);
    for (const d of draws) expect(rig.calls.slice(0, d).reverse().find((c) => c[0] === "activeTexture")[1], "the unit active at the draw").toBe("TEXTURE5");
  }
  const both = layerRig(lay(shape, "m"), lay(null, "e"), 0.4);
  const draws = both.calls.filter((c) => c[0] === "drawArraysInstanced");
  expect(draws).toHaveLength(4);                                                           // 2 layers × 2 groves
  const want = [{ tex: "leaf-m", shape: 1, box: shape.box }, { tex: "leaf-e", shape: 0, box: [0, 0, 1, 1] }];
  for (let n = 0; n < 4; n++) expect(stateAt(both.calls, n), `draw ${n}`).toEqual({ ...want[n % 2], unit: 6, activeBefore: "TEXTURE6" });
  // and the cluster textures stay where they were: 4 and 5, per grove
  expect(both.calls.filter((c) => c[0] === "uniform1i" && c[1] === "bake.clusterTex").map((c) => c[2])).toEqual([4, 4, 4, 4]);
});

test("the faithful bake draws the ACTIVE grove in its outline, and pads its cast frame by the longest radius that outline reaches (a lobe is not an ellipse's quad)", () => {
  const src = readFileSync(new URL("./komorebi-bake.js", import.meta.url), "utf8"), fn = src.slice(src.indexOf("function bakeFaithful"), src.indexOf("function bakeFaithful") + 10000);
  expect(fn).toContain("bindLeafShape(gl, U.faith, hub.grove);");
  expect(fn.indexOf("bindLeafShape(gl, U.faith, hub.grove);")).toBeLessThan(fn.indexOf("gl.drawArraysInstanced"));
  expect(fn).toContain("const pad = params.leaf_size_m*Math.max(1, 0.7*(hub.grove?.shape?.rmax ?? 0)*(hub.grove?.scaleMax ?? 1)) + params.drift_amount");   // a leaf's long half-axis is at most 0.7·leaf_size_m, times the largest shift leaf_variety gave one (scaleMax; ×1 is exact when there is none); the ellipse's 1 is the pad it has always had, to the bit
});

// ---- the carpet: the leaf lies in the shape it hung in ----
import * as L from "./komorebi-litter.js";
const fallenLeaf = (over) => ({ x: 1.5, y: -2.25, h: 0, D: 0.8, tau: [0.2, 1.4, 2.5], size: [0.05, 0.05], j: 17, k: 3, fade: 1, ...over });
const F = L.INSTANCE_FLOATS;

test("an instance's spare slot carries the leaf's outline — leafVariant(seed, j, k), the one the grove hung it in — and 0 for the ellipse, which has none", () => {
  const list = Array.from({ length: 60 }, (_, i) => fallenLeaf({ j: i >> 3, k: i & 7, x: i * 0.01 })), frame = { ox: -50, oy: -50, ext: 100 };
  const P = { ...DEFAULTS, seed: 4242 };
  const e = L.litterInstances(list, P, frame, false), m = L.litterInstances(list, { ...P, leaf_shape: "maple" }, frame, false);
  expect(m.count).toBe(e.count);
  const ord = L.litterOrder(list);
  for (let i = 0; i < ord.length; i++) {
    expect(e.data[i * F + 7], "the ellipse has no outline: 0").toBe(0);
    expect(m.data[i * F + 7], `leaf ${ord[i].j}/${ord[i].k}`).toBe(LEAF.leafVariant(4242, ord[i].j, ord[i].k));
    for (let c = 0; c < F; c++) if (c !== 7) expect(Object.is(m.data[i * F + c], e.data[i * F + c]), `slot ${c}`).toBe(true);   // nothing else about a stamp moves
  }
  expect(new Set(Array.from({ length: ord.length }, (_, i) => m.data[i * F + 7])).size, "more than one outline is in use").toBeGreaterThan(3);
});

test("a stamp's reach grows with its outline's box, so a lobe that crosses an edge is drawn on the far side too and one beside a clamped frame is not culled", () => {
  const reach = LEAF.leafShape("maple", 1234).reach, P = { ...DEFAULTS, seed: 1234 }, PM = { ...P, leaf_shape: "maple" };
  expect(reach).toBeGreaterThan(2);
  const frame = { ox: -6, oy: -6, ext: 12 };
  const off = [fallenLeaf({ x: 6.1, y: 0 })];                                             // 10 cm past the edge of a clamped frame: a 5 cm ellipse is nowhere near it, a lobed leaf of the same size reaches over
  expect(L.litterInstances(off, P, frame, false).count).toBe(0);
  expect(L.litterInstances(off, PM, frame, false).count).toBe(1);
  const near = [fallenLeaf({ x: 5.9, y: 0 })];                                            // 10 cm inside the edge of a wrapped one: the ellipse stays whole, the lobed leaf is drawn again a period away
  expect(L.litterInstances(near, P, frame, true).count).toBe(1);
  expect(L.litterInstances(near, PM, frame, true).count).toBe(2);
  expect(L.litterInstances([fallenLeaf({ x: 0, y: 0 })], PM, frame, true).count).toBe(1);   // nowhere near an edge: one stamp
  // the enlargement of a sub-texel stamp and its anti-aliasing margin scale with it too: the bound is (max(A, B, minHalf) + 1.5·minHalf)·reach
  const tiny = [fallenLeaf({ x: 6.05, y: 0, size: [0.001, 0.001] })], mh = 0.01;
  expect(L.litterInstances(tiny, P, frame, false, mh).count).toBe(0);
  expect(L.litterInstances(tiny, PM, frame, false, mh).count).toBe(1);
});

function litterBakeRig(over, list, grove) {
  const { calls, gl } = rec();
  const params = { ...DEFAULTS, litter: 1, canopy_extent_m: 12, layer_count: 2, canopy_base_height_m: 5, canopy_thickness_m: 3, seed: 1234, ...over };
  const u = { origin: "litter.origin", extent: "litter.extent", minHalf: "litter.minHalf", leafTex: "litter.leafTex", leafShape: "litter.leafShape", shapeBox: "litter.shapeBox" };
  const litter = L.newLitterState();
  const hub = { gl, params, litter, MAX_TEX: 4096, bakeFBO: {}, quadBuf: {}, litterFor: () => ({ prog: {}, U: u }), bulkOn: () => false, fillFrameNow: () => ({ ox: -6, oy: -6, ext: 12 }), grove: { litter: list, ...grove } };
  L.makeLitter(hub).refreshLitter();
  return { calls };
}

test("the carpet is drawn in the outline its leaves fell from, on unit 6, with the quad's box — and the ellipse's carpet with the box it has always had", () => {
  const list = [fallenLeaf({ j: 1, k: 1 }), fallenLeaf({ j: 2, k: 0, x: 2 })], shape = LEAF.leafShape("maple", 1234);
  const m = litterBakeRig({ leaf_shape: "maple" }, list, { leafTex: "leaf-m", shape }), e = litterBakeRig({}, list, { leafTex: "leaf-e", shape: null });
  expect(stateAt(m.calls, 0)).toEqual({ tex: "leaf-m", unit: 6, shape: 1, box: shape.box, activeBefore: "TEXTURE6" });
  expect(stateAt(e.calls, 0)).toEqual({ tex: "leaf-e", unit: 6, shape: 0, box: [0, 0, 1, 1], activeBefore: "TEXTURE6" });
  const data = m.calls.find((c) => c[0] === "bufferData" && c[2] instanceof Float32Array)[2];
  expect(data[7]).toBe(LEAF.leafVariant(1234, 1, 1));                                   // the buffer the draw read is the outline's
  // and the unit that was active before it is active after it: the carpet's mips are made on whatever unit it was bound to, and unit 6 is the fill's sampler
  const at = m.calls.findIndex((c) => c[0] === "bindTexture" && c[2] === "leaf-m");
  expect(m.calls.slice(0, at).filter((c) => c[0] === "getParameter").pop()).toEqual(["getParameter", "ACTIVE_TEXTURE"]);
  expect(m.calls.slice(at).find((c) => c[0] === "activeTexture")).toEqual(["activeTexture", "was:ACTIVE_TEXTURE"]);
});

// ============================================================================
// THE SPECIES: the maple's bundle names its outline, and every other bundle names the ellipse (bundles are partial merges over the live params, so a maple → oak
// pick has to take the lobes off); the profile carries its own width-to-length, and the bundle's size keeps the leaf AREA where it was.
// ============================================================================
test("every species bundle names its outline; the maple's is 'maple' at aspect 1 and 0.103 m, the rest are the ellipse", () => {
  for (const [name, b] of Object.entries(TREE_SPECIES)) expect(b.leaf_shape, name).toBe(name === "maple" ? "maple" : "ellipse");
  expect(TREE_SPECIES.maple.leaf_aspect).toBe(1);
  expect(TREE_SPECIES.maple.leaf_size_m).toBe(0.103);
  for (const [name, b] of Object.entries(TREE_SPECIES)) if (name !== "maple") expect(b.leaf_aspect, `${name} keeps the ellipse's own aspect`).toBeUndefined();
});

test("the maple bundle conserves the leaf's AREA at the default aspect: the profile is π·A² (aspect 1), and 0.103² is 0.13²/1.6 to 0.4% — so canopy fullness is where it was", () => {
  const area = (size, aspect) => Math.PI * (size / 2) * (size / 2 / aspect);   // the ellipse's: A = size/2, B0 = A/aspect
  const was = area(0.13, DEFAULTS.leaf_aspect), now = area(TREE_SPECIES.maple.leaf_size_m, TREE_SPECIES.maple.leaf_aspect);
  expect(Math.abs(now / was - 1)).toBeLessThan(0.005);
  expect(DEFAULTS.leaf_aspect).toBe(1.6);
  const r = outline(1234, 0);
  let a = 0; for (let i = 0; i < N; i++) a += 0.5 * r[i] * r[i] * (TAU / N);
  expect(a).toBeCloseTo(Math.PI, 9);                                                    // the profile stands in for the unit circle at aspect 1: its area is π·A·B0 with B0 = A
});
