// ============================================================================
// A leaf is not a window (spec §4.5/§4.6/§4.7). A real leaf's transmitted light is almost entirely DIFFUSE: the
// mesophyll scatters it, like frosted glass, so a leaf four metres up throws a dark shadow and its colour spreads
// over the floor beneath. The engine used to treat each leaf's transmittance as BALLISTIC, painting every leaf's
// colour as a sharp image inside its own shadow and multiplying complementary filters (green over red goes near
// black: the mid-fall "mud"). The split is T = T_b + T_d, ballistic (1−d)·T and diffuse d·T, and it enters as
// NEUTRAL depth: k = −ln(1−d), τ_ball = τ + k·coverage. These tests hold the laws that would otherwise fail
// SILENTLY: a ballistic share that is not the same hue as the leaf, a conservation that leaks, a gate that is not
// the old frame, a marginal leaf whose shadow pops, a soft edge read as a slab (P0c-edge: a texel is a mixture, the "edge" block).
// (The sky view's own half of the split — the lantern — is skydiffuse.test.js.)
// komorebi-fill.js is the reference the pixel harness holds the shader to; bun holds the reference to the laws.
// ============================================================================
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CAMERAS, TRANSPORT_GROUPS, GROUP_UPLOAD_KEYS, buildTransport } from "./komorebi.js";
import * as M from "./komorebi-math.js";
import * as F from "./komorebi-fill.js";
import { VS_BAKE, FS_BAKE, VS_FAITH, FS_FAITH, FS_FILL, GLSL_SKY_RAY } from "./komorebi-shaders.js";
import * as SH from "./komorebi-shaders.js";
import { makeGrove } from "./komorebi-grove.js";

const sum = (a) => a.reduce((s, v) => s + v, 0);
const H4 = [2, 3, 4, 5];                                               // a synthetic stack, lowest first
const SUN = [1.1, 0.95, 0.8];
// A layer is { h, t(x, y) -> [r,g,b], c(x, y) -> coverage }: what a baked texel holds (rgb = true depth, alpha = Σ coverage).
// A hash-random field, independent per layer and per 14 cm cell, with t kept off 0 so ratios stay well conditioned.
const u01 = (seed, c, cx, cy, L) => hash(seed * 8 + c, cx * 31 + L, cy) / 4294967296;
const hash = M.hash3;
const covStack = (seed, nL = 3) => H4.slice(0, nL).map((h, L) => ({
  h,
  t: (x, y) => { const cx = Math.floor(x * 7), cy = Math.floor(y * 7); return [0, 1, 2].map((c) => 0.05 + 0.95 * u01(seed, c, cx, cy, L)); },
  c: (x, y) => 2 * u01(seed, 3, Math.floor(x * 7), Math.floor(y * 7), L),
}));
const kOf = (seed) => M.ballisticK((hash(seed, 7, 7) % 1000) / 1000);   // d anywhere in [0, 0.999]: k from 0 up to the cap

// ---- the knob ---------------------------------------------------------------------------------------------------
test("leaf_diffuse ships at 0 and tweens: a live shader uniform on both paths, classified MORPH", () => {
  expect(DEFAULTS.leaf_diffuse).toBe(0);   // presets merge over DEFAULTS: anything else would reshade every shipped look
  expect(MORPH_KEYS).toContain("leaf_diffuse");
});

test("ballisticK: the neutral depth of the diffuse share — 0 at 0, monotone, −ln(1−d), capped at 6", () => {
  expect(M.ballisticK(0)).toBe(0);                                      // exactly: the gate, not a small number
  expect(M.BEAM_K_MAX).toBe(6);
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const d = i / 1000, k = M.ballisticK(d);
    expect(k, `d=${d}`).toBeGreaterThanOrEqual(prev);
    expect(k).toBeLessThanOrEqual(6);
    prev = k;
  }
  expect(M.ballisticK(0.5)).toBeCloseTo(Math.LN2, 14);
  expect(M.ballisticK(0.95)).toBeCloseTo(-Math.log(0.05), 14);          // the physical value: ~3 of neutral depth per unit coverage
  expect(M.ballisticK(1)).toBe(6);                                      // d = 1 is −ln 0: the cap is what keeps it finite
  expect(M.ballisticK(2)).toBe(6);                                      // out of range reads as the top, not NaN
  expect(M.ballisticK(-1)).toBe(0);
  expect(M.ballisticK(NaN)).toBe(0);
  // and it IS the split: the ballistic share of a unit-coverage leaf, e^−k, is the 1−d that was asked for
  for (const d of [0.1, 0.5, 0.95]) expect(Math.exp(-M.ballisticK(d))).toBeCloseTo(1 - d, 14);
});

// ---- the per-tap law ----------------------------------------------------------------------------------------------
test("tb is t BY IDENTITY at k = 0: the input comes back, not a copy that happens to be equal (leafTau's gate idiom)", () => {
  const t = [0.3, 0.6, 0.1];
  expect(F.ballistic(t, 1.7, 0)).toBe(t);
  expect(F.ballistic(t, 0, 0)).toBe(t);
  expect(F.ballistic(t, 1.7, -1)).toBe(t);                              // a negative k is not a split either
  expect(F.ballistic(t, 1.7, 3)).not.toBe(t);
});

test("neutral depth preserves hue where the texel is full: leafHue(Tb) = leafHue(T) for c ≥ 1 — a partial texel's gap only whitens it", () => {
  // k is the same in all three channels because the split is set by the leaf's scattering structure, not its pigments, so a FULL texel
  // (a = 1: the mixture IS the slab) keeps the leaf's hue through the split. A PARTIAL one has a gap, which passes the beam whole in every
  // channel alike: the residue is paler than the leaf, never darker than the leaf's own e^−κ share (Tb ≥ T·e^−κ).
  // (leafHue floors its peak at 1e-4, so the claim is for a beam still above that — a leaf darker than the floor has no hue to keep.)
  let kept = 0, pale = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const tau = [0, 1, 2].map((c) => -Math.log(0.2 + 0.8 * u01(seed, c, 1, 2, 0))), k = kOf(seed);
    const full = F.texelMix(tau, 1 + u01(seed, 3, 1, 2, 0), k);
    if (Math.max(...full.Tb) >= 1e-3) {
      const a = F.leafHue(full.Tb), b = F.leafHue(full.T);
      for (let i = 0; i < 3; i++) expect(a[i], `seed ${seed}`).toBeCloseTo(b[i], 12);
      kept++;
    }
    const c = 0.05 + 0.9 * u01(seed, 4, 1, 2, 0), part = F.texelMix(tau, c, k);
    for (let i = 0; i < 3; i++) expect(part.Tb[i], `seed ${seed}`).toBeGreaterThanOrEqual(part.T[i] * Math.exp(-k) - 1e-15);
    if (k > 1) { const a = F.leafHue(part.Tb), b = F.leafHue(part.T); if (a[0] !== b[0] || a[2] !== b[2]) pale++; }
  }
  expect(kept).toBeGreaterThan(1500);
  expect(pale).toBeGreaterThan(500);                                      // ...and the gap really does move the hue: this is not the full-texel identity in disguise
});

test("emitted light is real and bounded: 0 ≤ T − Tb ≤ T ≤ 1, per channel, at any coverage", () => {
  for (let seed = 0; seed < 10000; seed++) {
    const tau = [0, 1, 2].map((c) => 3 * u01(seed, c, 3, 4, 0)), c = 4 * u01(seed, 3, 3, 4, 0), k = kOf(seed);
    const { T, Tb } = F.texelMix(tau, c, k);
    for (let i = 0; i < 3; i++) {
      expect(T[i] - Tb[i], `seed ${seed}`).toBeGreaterThanOrEqual(0);       // a leaf's beam is never brighter than the light it passes in all
      expect(T[i] - Tb[i]).toBeLessThanOrEqual(T[i]);
      expect(T[i]).toBeLessThanOrEqual(1);
    }
  }
});

// ---- conservation -----------------------------------------------------------------------------------------------
test("the telescoping identity: Π tb + Σ thr·(t − tb)·A = Π t, to 1e-12, over 10^4 random stacks and any d", () => {
  // Q_L = Π_{M≤L} t · Π_{M>L} tb steps from Π tb (L = −1) to Π t (L = top) one layer at a time, and each step is that
  // layer's own thr·(t − tb)·A. So beam + emitted = total transmitted, for any d — and at d = 0 the emitted is exactly 0.
  // Every tap at ONE plan point (no shift, the sun straight down the ray), which is what the identity is about.
  let worst = 0, emitted = 0, shut = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const nL = 1 + (seed % 4), k = kOf(seed), layers = covStack(seed, nL);
    const p = [(hash(seed, 19, 0) % 4000) / 1000 - 2, (hash(seed, 19, 1) % 4000) / 1000 - 2];
    const r = F.skyRayRef(layers, p, [0, 0], [0, 0], [1, 1, 1], k);
    const emit = k > 0 ? r.L : [0, 0, 0];                                 // at k = 0 the sum is the P0b proxy, which is not this term: the new one is identically zero
    if (!(k > 0)) shut++;
    const Tb = [1, 1, 1];
    for (const l of layers) { const tb = F.ballistic(l.t(p[0], p[1]), l.c(p[0], p[1]), k); for (let c = 0; c < 3; c++) Tb[c] *= tb[c]; }
    for (let c = 0; c < 3; c++) {
      worst = Math.max(worst, Math.abs(Tb[c] + emit[c] - r.T[c]));
      expect(emit[c], `seed ${seed}`).toBeGreaterThanOrEqual(0);
      emitted += emit[c];
    }
  }
  expect(worst).toBeLessThan(1e-12);
  expect(emitted).toBeGreaterThan(100);                                   // not vacuous: the stacks really do emit
  expect(shut).toBeGreaterThan(0);                                        // ...and the d = 0 stacks are in the sweep too
});

test("at d = 0 nothing is emitted, exactly: t − tb is 0 for every tap and k = 0 is the call that never heard of k", () => {
  for (let seed = 0; seed < 500; seed++) {
    const layers = covStack(seed, 1 + (seed % 4));
    for (const l of layers) { const t = l.t(0.3, 0.7), tb = F.ballistic(t, l.c(0.3, 0.7), 0); expect(t.map((v, c) => v - tb[c]), `seed ${seed}`).toEqual([0, 0, 0]); }
    const args = [layers, [0.1, -0.3], [0.2, 0.1], [0.4, -0.2], SUN];
    expect(F.skyRayRef(...args, 0), `seed ${seed}`).toEqual(F.skyRayRef(...args));
  }
});

// The P0b reference, FROZEN at a3fdd9b — the floor as it was after the skylight double-count fix. fillRef at d = 0 has to
// reproduce it to the last bit: the proxy path runs verbatim, and every look that never asks for the split is that frame.
const P0B = (() => {
  const hue = (t) => { const m = Math.max(t[0], t[1], t[2], 1e-4); return [t[0] / m, t[1] / m, t[2] / m]; };
  function skyRayRef(layers, p, shift, gS, sun) {
    const n = layers.length;
    const at = layers.map((l) => [p[0] + shift[0] * l.h, p[1] + shift[1] * l.h]);
    const t = layers.map((l, L) => l.t(at[L][0], at[L][1]));
    const T = [1, 1, 1], L = [0, 0, 0], thr = [1, 1, 1];
    if (gS == null) { for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) T[c] *= t[i][c]; return { T, L }; }
    for (let i = 0; i < n; i++) {
      const A = [1, 1, 1];
      for (let m = i + 1; m < n; m++) {
        const dh = layers[m].h - layers[i].h, a = layers[m].t(at[i][0] + gS[0] * dh, at[i][1] + gS[1] * dh);
        for (let c = 0; c < 3; c++) A[c] *= a[c];
      }
      const s = hue(t[i]);
      for (let c = 0; c < 3; c++) {
        L[c] += thr[c] * (1 - t[i][c]) * s[c] * (sun[c] * A[c]);
        thr[c] *= t[i][c];
        T[c] *= t[i][c];
      }
    }
    return { T, L };
  }
  function fillRef(layers, x, K, { gS, sun, scatter, tile }) {
    const T = [0, 0, 0], S = [0, 0, 0], tau = [0, 0, 0];
    for (const d of F.fillDirections(K, tile)) {
      const r = skyRayRef(layers, x, d.shift, scatter > 0 ? gS : null, sun);
      for (let c = 0; c < 3; c++) { T[c] += r.T[c]; S[c] += r.L[c]; tau[c] -= Math.log(Math.max(r.T[c], 1e-300)); }
    }
    return { T: T.map((v) => v / K), S: S.map((v) => (v / K) * scatter), meanTau: tau.map((v) => v / K) };
  }
  return { skyRayRef, fillRef };
})();

test("fillRef at d = 0 IS the P0b reference, bit for bit — absent, k: 0, and with the layers carrying coverage", () => {
  for (let seed = 0; seed < 400; seed++) {
    const layers = covStack(seed, 1 + (seed % 4)), K = [1, 4, 16, 33][seed % 4], tile = seed % 16;
    const scatter = [0, 0.15, 0.5, 1][seed % 4], gS = [((hash(seed, 17, 0) % 2000) - 1000) / 500, ((hash(seed, 17, 1) % 2000) - 1000) / 500];
    const x = [(hash(seed, 19, 0) % 4000) / 1000 - 2, (hash(seed, 19, 1) % 4000) / 1000 - 2];
    const old = P0B.fillRef(layers, x, K, { gS, sun: SUN, scatter, tile });
    expect(F.fillRef(layers, x, K, { gS, sun: SUN, scatter, tile }), `absent, seed ${seed}`).toEqual(old);
    expect(F.fillRef(layers, x, K, { gS, sun: SUN, scatter, tile, k: 0 }), `k 0, seed ${seed}`).toEqual(old);
    // the same stack without any coverage to read: the proxy path never looks at it
    const bare = layers.map(({ h, t }) => ({ h, t }));
    expect(F.fillRef(bare, x, K, { gS, sun: SUN, scatter, tile }), `no coverage, seed ${seed}`).toEqual(old);
  }
});

test("the P0b proxy is OFF once d > 0: the albedo knob is inert and the light is the emitted t − tb, hue its own", () => {
  const layers = covStack(11), x = [0.3, -0.2], k = M.ballisticK(0.95), base = { gS: [0.5, -0.3], sun: SUN, k, tile: 3 };
  const a = F.fillRef(layers, x, 16, { ...base, scatter: 0 }), b = F.fillRef(layers, x, 16, { ...base, scatter: 0.8 });
  expect(b).toEqual(a);                                                   // two albedos, one fill: it is not the albedo's light any more
  expect(sum(a.S)).toBeGreaterThan(0);
  // with the proxy's own gate shut (scatter 0 and no k) there is no S at all — the split is what opened it
  expect(F.fillRef(layers, x, 16, { gS: [0.5, -0.3], sun: SUN, scatter: 0, tile: 3 }).S).toEqual([0, 0, 0]);
  // and Tsky never reads k: the uniform-sky identity says the skylight needs no split, only the sun does — any two k > 0 hand the same sky
  expect(a.T).toEqual(F.fillRef(layers, x, 16, { ...base, k: 2 * k, scatter: 0 }).T);
  expect(a.T).not.toEqual(F.fillRef(layers, x, 16, { ...base, k: 0, scatter: 0 }).T);   // (and at k = 0 the sky is the d = 0 slab: soft edges depth-averaged, the named approximation kept for byte-identity)
});

test("the sun off: the split has nothing to scatter either, exactly 0", () => {
  for (let seed = 0; seed < 300; seed++) {
    const r = F.fillRef(covStack(seed, 1 + (seed % 4)), [0.2, 0.1], [1, 4, 16][seed % 3], { gS: [0.3, 0.2], sun: [0, 0, 0], scatter: 0, k: kOf(seed) || 2, tile: seed % 16 });
    expect(r.S, `seed ${seed}`).toEqual([0, 0, 0]);
  }
});

test("floor-average conservation: with the sun at zenith, beam + the fill's emitted light is the total transmitted, within 5%", () => {
  // Not exact, and the spec says why: a hemisphere ray crosses the layers BELOW the emitting leaf at other plan points
  // than the sun's ray does, so the identity above holds per column and only in expectation over a spatially random stack
  // (layers independent, cells independent: E[thr] is the same at every shift). Floor-averaged it has to hold. The column
  // averages (beam, total) are taken over a wide floor — they are cheap, and a small patch has more noise in them than the
  // thing being measured — and the emitted light over a patch of the same stack.
  const PITCH = 0.15, WIDE = 200, N = 40, K = 32;
  for (const d of [0.5, 0.95]) for (const seed of [3, 41]) {
    const k = M.ballisticK(d), layers = covStack(seed, 3);
    let beam = 0, total = 0;
    for (let j = 0; j < WIDE; j++) for (let i = 0; i < WIDE; i++) {
      const x = -15 + i * PITCH, y = -15 + j * PITCH;
      let tb = 1, t = 1;
      for (const l of layers) { const m = F.texelMix(l.t(x, y).map((v) => -Math.log(v)), l.c(x, y), k); t *= m.T[1]; tb *= m.Tb[1]; }
      beam += tb; total += t;
    }
    let emit = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
      emit += F.fillRef(layers, [-3 + i * PITCH, -3 + j * PITCH], K, { gS: [0, 0], sun: [1, 1, 1], scatter: 0, k, tile: F.fillTile(i, j) }).S[1];
    beam /= WIDE * WIDE; total /= WIDE * WIDE; emit /= N * N;
    expect(emit, `d ${d} seed ${seed}: the stack really does emit`).toBeGreaterThan(0.05 * total);
    if (d < 0.9) expect(beam, `d ${d} seed ${seed}: and the beam really does survive`).toBeGreaterThan(0.05 * total);
    expect(Math.abs((beam + emit) / total - 1), `d ${d} seed ${seed}`).toBeLessThan(0.05);
  }
});

// ---- P0c-edge: a texel is a MIXTURE, not a slab (spec §4.5) --------------------------------------------------------------------
// The bake stores Σ τ_i·cov_i (rgb) and Σ cov_i (alpha). Every reader used to take that pair for a SLAB of depth τ (t = e^−τ), which is exact for
// leaves that fill the texel and stack, and Jensen-dark at an edge: a texel 30% under a leaf of depth 2.8 read as a thin bright leaf (t 0.43), not
// 70% gap and 30% dark leaf (T 0.72). The mixture, from the same two numbers, with a = min(c, 1) the leaf area of the texel:
//   τ̄ = τ/a (the representative leaf's depth)   κ = k·c/a   T = (1 − a) + a·e^−τ̄   Tb = (1 − a) + a·e^(−τ̄ − κ)   emit = T − Tb
// The truth it is held to is the texel SUPERSAMPLED n×n: each subsample lies under some leaves or none, and its transmittance is the product of theirs.
const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const leafDepth = (seed, a) => [0, 1, 2].map((c) => 0.1 + 3.2 * u01(seed, c, a, 7, 1));   // one leaf's own optical depth, RGB, from clear to deep blue
function supersample(n, leaves, k) {   // leaves: [{ tau, mask: boolean[n*n] }]
  const T = [0, 0, 0], Tb = [0, 0, 0];
  for (let i = 0; i < n * n; i++) {
    const depth = [0, 0, 0]; let stacked = 0;
    for (const l of leaves) if (l.mask[i]) { stacked++; for (let c = 0; c < 3; c++) depth[c] += l.tau[c]; }
    for (let c = 0; c < 3; c++) { T[c] += Math.exp(-depth[c]) / (n * n); Tb[c] += Math.exp(-depth[c] - k * stacked) / (n * n); }
  }
  return { T, Tb, emit: T.map((v, c) => v - Tb[c]) };
}
function bakePair(n, leaves) {   // what the bake writes for the same texel: each leaf adds its depth × its area share to rgb and the share to alpha
  const tau = [0, 0, 0]; let c = 0;
  for (const l of leaves) { const cov = l.mask.filter(Boolean).length / (n * n); c += cov; for (let ch = 0; ch < 3; ch++) tau[ch] += l.tau[ch] * cov; }
  return { tau, c };
}
const firstM = (n, m) => Array.from({ length: n * n }, (_, i) => i < m);   // a single leaf's mixture does not depend on WHERE in the texel it lies

test("edge: one leaf over a fraction c of the texel — the bake's pair through texelMix is the supersample's mean T, Tb and emit, to 1e-12, for every c in (0, 1]", () => {
  let worst = 0, n_c = 0;
  for (const n of [4, 7, 12]) for (let m = 1; m <= n * n; m++) for (let rep = 0; rep < 3; rep++) {
    const seed = n * 1000 + m * 3 + rep, k = kOf(seed) || M.ballisticK(0.95), leaf = { tau: leafDepth(seed, 1), mask: firstM(n, m) };
    const truth = supersample(n, [leaf], k), { tau, c } = bakePair(n, [leaf]), got = F.texelMix(tau, c, k);
    for (let ch = 0; ch < 3; ch++) {
      worst = Math.max(worst, Math.abs(got.T[ch] - truth.T[ch]), Math.abs(got.Tb[ch] - truth.Tb[ch]), Math.abs(got.T[ch] - got.Tb[ch] - truth.emit[ch]));
    }
    n_c++;
  }
  expect(n_c).toBeGreaterThan(200);
  expect(worst).toBeLessThan(1e-12);
});

test("edge: two leaves stacked over the WHOLE texel (c = 2) — exact: T = T1·T2, Tb = T1·T2·(1−d)², emit = T1·T2·(1 − (1−d)²)", () => {
  let worst = 0;
  for (let seed = 0; seed < 400; seed++) {
    const d = [0.5, 0.9, 0.95, 0.99][seed % 4], k = M.ballisticK(d), n = 6, t1 = leafDepth(seed, 1), t2 = leafDepth(seed, 2);
    const full = Array.from({ length: n * n }, () => true), leaves = [{ tau: t1, mask: full }, { tau: t2, mask: full }];
    const { tau, c } = bakePair(n, leaves), got = F.texelMix(tau, c, k), truth = supersample(n, leaves, k);
    expect(c).toBe(2);
    for (let ch = 0; ch < 3; ch++) {
      const T12 = Math.exp(-t1[ch] - t2[ch]);
      worst = Math.max(worst, Math.abs(got.T[ch] - T12), Math.abs(got.Tb[ch] - T12 * (1 - d) ** 2), Math.abs(got.T[ch] - got.Tb[ch] - T12 * (1 - (1 - d) ** 2)),
        Math.abs(got.Tb[ch] - truth.Tb[ch]));
    }
  }
  expect(worst).toBeLessThan(1e-12);
});

// Where the model is NOT exact: a second leaf overlapping the first inside one texel at c between 1 and 2 reads as a bounded slab residue. The common case in
// the bake is a texel that lies wholly inside one leaf with the EDGE of another crossing it (a is 1, the second leaf's share is the fraction beyond 1): held
// against the supersample over random edge orientations, as luminance (the glow's level; the blue channel alone is worse, and said so below).
function halfPlane(n, seed) {   // a leaf edge through the texel at a random angle and offset: a compact leaf, not salt and pepper
  const th = (2 * Math.PI * (hash(seed, 31, 0) % 100000)) / 100000, off = ((hash(seed, 31, 1) % 100000) / 100000 - 0.5) * 1.4, nx = Math.cos(th), ny = Math.sin(th);
  return Array.from({ length: n * n }, (_, i) => ((((i % n) + 0.5) / n - 0.5) * nx + ((Math.floor(i / n) + 0.5) / n - 0.5) * ny) > off);
}
test("edge: a texel inside one leaf with another's EDGE across it (c in 1..2) — the emission's luminance within 15%, blue alone within 45%: the bounded residue", () => {
  const n = 24, full = Array.from({ length: n * n }, () => true), k = M.ballisticK(0.95);
  let worstLum = 0, worstBlue = 0, tested = 0;
  for (let seed = 0; seed < 600; seed++) {
    const a = { tau: [1.35, 0.69, 1.83].map((v, c) => v * (0.8 + 0.4 * u01(seed, c, 1, 1, 1))), mask: full }, b = { tau: [1.35, 0.69, 1.83].map((v, c) => v * (0.8 + 0.4 * u01(seed, c, 2, 2, 2))), mask: halfPlane(n, seed) };
    const { tau, c } = bakePair(n, [a, b]);
    if (!(c > 1.02)) continue;
    const got = F.texelMix(tau, c, k), truth = supersample(n, [a, b], k), emit = got.T.map((v, ch) => v - got.Tb[ch]);
    worstLum = Math.max(worstLum, Math.abs(lum(emit) / lum(truth.emit) - 1));
    worstBlue = Math.max(worstBlue, Math.abs(emit[2] / truth.emit[2] - 1));
    tested++;
  }
  expect(tested).toBeGreaterThan(400);
  expect(worstLum).toBeLessThan(0.15);
  expect(worstLum, "not exact: this is the residue, not the identity in disguise").toBeGreaterThan(0.01);
  expect(worstBlue).toBeLessThan(0.45);
});

test("edge: the slab's error, pinned as the dead end — at c = 0.3 on a blue leaf (τ 2.8, d 0.95) the slab emits ≥ 5× the mixture, and its beam is 4× too dark", () => {
  // The numbers P0c-sky wrote down for the rim and the halo. A leaf of depth τ over 30% of the texel is the pair (0.3·τ, 0.3): the slab took it for a leaf
  // of depth 0.84 over ALL of it (t = 0.43, Jensen), so its glow t·(1 − e^−kc) is the cream rim (0.256 against the true 0.0173), and its beam e^(−τ − kc) the
  // dark halo (0.176 against the true 0.701: 70% of the texel is open sky).
  const tau = 2.8, c = 0.3, k = M.ballisticK(0.95);
  const slabT = Math.exp(-tau * c), slabEmit = slabT * (1 - Math.exp(-k * c)), slabBeam = Math.exp(-tau * c - k * c);
  const leaf = { tau: [tau, tau, tau], mask: firstM(10, 30) }, truth = supersample(10, [leaf], k), { tau: pair, c: cc } = bakePair(10, [leaf]), got = F.texelMix(pair, cc, k);
  expect(cc).toBeCloseTo(0.3, 14);
  expect(truth.T[2]).toBeCloseTo(0.7 + 0.3 * Math.exp(-tau), 14);
  expect(got.T[2]).toBeCloseTo(truth.T[2], 12);
  expect(got.T[2] - got.Tb[2]).toBeCloseTo(truth.emit[2], 12);
  expect(slabEmit).toBeCloseTo(0.256, 3);
  expect(slabEmit / truth.emit[2]).toBeGreaterThanOrEqual(5);              // ×14.8: the rim
  expect(slabT).toBeCloseTo(0.43, 2);
  expect(truth.T[2] / slabT).toBeGreaterThan(1.6);                          // the slab read the texel 40% too dark
  expect(slabBeam).toBeCloseTo(0.176, 3);
  expect(truth.Tb[2]).toBeCloseTo(0.701, 3);
  expect(truth.Tb[2] / slabBeam).toBeGreaterThan(3.9);                      // the halo
});

test("edge: k = 0 is not a split — Tb IS T (the same array) and the emission is exactly 0, at any coverage", () => {
  for (let seed = 0; seed < 500; seed++) {
    const m = F.texelMix(leafDepth(seed, 3), 3 * u01(seed, 9, 1, 1, 1), 0);
    expect(m.Tb).toBe(m.T);
    expect(m.T.map((v, c) => v - m.Tb[c])).toEqual([0, 0, 0]);
  }
  const neg = F.texelMix([1, 2, 3], 0.5, -1);                                 // a negative k is no split either
  expect(neg.Tb).toBe(neg.T);
});

test("edge: an empty texel (c < 1e-4) is exactly clear — T = Tb = 1, whatever depth sits beside it", () => {
  for (const c of [0, 1e-9, 5e-5, 9.99e-5]) for (const k of [0, 3]) {
    const m = F.texelMix([4, 0.2, 9], c, k);
    expect(m.T, `c ${c} k ${k}`).toEqual([1, 1, 1]);
    expect(m.Tb, `c ${c} k ${k}`).toEqual([1, 1, 1]);
  }
  const live = F.texelMix([0.3, 0.3, 0.3], 1e-4, 3);                          // ...and the guard is the guard, not a dead zone: at 1e-4 there is a texel
  expect(live.T[0]).toBeLessThan(1);
});

test("edge: a FULL texel (c ≥ 1) is the old slab, to the bit — the mixture changes only what a gap changes", () => {
  for (let seed = 0; seed < 2000; seed++) {
    const tau = leafDepth(seed, 4), c = 1 + 2 * u01(seed, 8, 1, 1, 1), k = kOf(seed) || 2.5, m = F.texelMix(tau, c, k);
    for (let ch = 0; ch < 3; ch++) {
      expect(m.T[ch], `seed ${seed}`).toBe(Math.exp(-tau[ch]));
      expect(m.Tb[ch], `seed ${seed}`).toBe(Math.exp(-(tau[ch] + k * c)));
    }
  }
});

test("edge: τ/c is fade-invariant — a leaf at fade f is the same leaf over f of the area, so emission per unit leaf area never moves, and it vanishes with f", () => {
  const tau = [0.9, 0.5, 1.4], k = M.ballisticK(0.95);
  for (const edge of [0.15, 0.6, 1]) {
    for (let i = 200; i >= 1; i--) {
      const f = i / 200, s = F.leafTexel(tau, f, edge), m = F.texelMix(s.rgb, s.a, k);
      for (let ch = 0; ch < 3; ch++) {
        expect((m.T[ch] - m.Tb[ch]) / s.a, `edge ${edge} f ${f}`).toBeCloseTo(Math.exp(-tau[ch]) * (1 - Math.exp(-k)), 12);   // the leaf's own glow per unit of its area, whatever its fade
      }
      expect(m.T[1], `edge ${edge} f ${f}`).toBeGreaterThanOrEqual(Math.exp(-tau[1]) - 1e-15);   // fading only ever lightens the texel: the gap it leaves is open sky...
      expect(m.T[1]).toBeLessThanOrEqual(1);
    }
    const faint = F.leafTexel(tau, 1e-5, edge);
    expect(F.texelMix(faint.rgb, faint.a, k).T).toEqual([1, 1, 1]);            // ...down to nothing at f -> 0
  }
});

test("edge: a bilinear read of one leaf's own edge never changes the leaf — τ̄ stays the leaf's depth at any weight, where a depth alone would blend toward 0", () => {
  const tau = [2.8, 1.2, 0.6], k = M.ballisticK(0.9);
  for (let seed = 0; seed < 300; seed++) {
    const c1 = 0.05 + 0.9 * u01(seed, 1, 1, 1, 1), c2 = 0.05 + 0.9 * u01(seed, 2, 1, 1, 1), w = u01(seed, 3, 1, 1, 1);
    const pair = (c) => ({ tau: tau.map((v) => v * c), c });
    const A = pair(c1), B = pair(c2), mix = { tau: tau.map((_, ch) => w * A.tau[ch] + (1 - w) * B.tau[ch]), c: w * c1 + (1 - w) * c2 };
    const got = F.texelMix(mix.tau, mix.c, k), want = F.texelMix(tau.map((v) => v * mix.c), mix.c, k);
    for (let ch = 0; ch < 3; ch++) { expect(got.T[ch], `seed ${seed}`).toBeCloseTo(want.T[ch], 12); expect(got.Tb[ch]).toBeCloseTo(want.Tb[ch], 12); }
  }
});

test("edge: the telescoping identity on the mixture — Π Tb + Σ thr·(T − Tb)·A = Π T, to 1e-12, over 10^4 random stacks and any d, with every term from texelMix", () => {
  // The identity is by construction (emit ≡ T − Tb), and this holds it so: every term spelled out here from texelMix alone, against skyRayRef's own sums.
  let worst = 0, glowed = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const nL = 1 + (seed % 4), k = kOf(seed) || M.ballisticK(0.95), layers = covStack(seed, nL), p = [(hash(seed, 19, 0) % 4000) / 1000 - 2, (hash(seed, 19, 1) % 4000) / 1000 - 2];
    const m = layers.map((l) => F.texelMix(l.t(p[0], p[1]).map((v) => -Math.log(v)), l.c(p[0], p[1]), k));
    const T = [1, 1, 1], Tb = [1, 1, 1], glow = [0, 0, 0], thr = [1, 1, 1];
    for (let L = 0; L < nL; L++) for (let c = 0; c < 3; c++) {
      let A = 1; for (let M2 = L + 1; M2 < nL; M2++) A *= m[M2].Tb[c];
      glow[c] += thr[c] * (m[L].T[c] - m[L].Tb[c]) * A; thr[c] *= m[L].T[c]; T[c] *= m[L].T[c]; Tb[c] *= m[L].Tb[c];
    }
    const r = F.skyRayRef(layers, p, [0, 0], [0, 0], [1, 1, 1], k);
    for (let c = 0; c < 3; c++) {
      worst = Math.max(worst, Math.abs(Tb[c] + glow[c] - T[c]), Math.abs(r.T[c] - T[c]), Math.abs(r.Tb[c] - Tb[c]), Math.abs(r.L[c] - glow[c]));
      glowed += glow[c];
    }
  }
  expect(worst).toBeLessThan(1e-12);
  expect(glowed).toBeGreaterThan(100);
});

// ---- the marginal leaf -------------------------------------------------------------------------------------------
test("a leaf fading in (§5.3) fades its BALLISTIC shadow with it: Tb is continuous in the fade f, and 1 at f = 0", () => {
  // The grove folds the fade into τ on the CPU, so alpha has to carry it too (iFade): the texel's pair is (τ·f·edge, edge·f), which
  // the mixture reads as a leaf of its own depth over edge·f of the area. Without the fade in alpha it would read the same τ as a
  // leaf over `edge` of it, the full footprint at depth τ·f, and its beam's k would keep full weight on a leaf that is not there yet.
  const tau = [0.9, 0.5, 1.4], k = M.ballisticK(0.95), edge = 0.8;
  const beam = (f, withFade) => { const s = F.leafTexel(tau, f, edge); return F.texelMix(s.rgb, withFade ? s.a : edge, k).Tb; };
  expect(beam(0, true)).toEqual([1, 1, 1]);                                  // f = 0: no coverage at all, the texel is empty
  let prev = beam(0, true);
  for (let i = 1; i <= 200; i++) {
    const tb = beam(i / 200, true);
    for (let c = 0; c < 3; c++) expect(Math.abs(tb[c] - prev[c]), `f=${i / 200}`).toBeLessThan(0.05);   // no step anywhere along the fade
    prev = tb;
  }
  for (let c = 0; c < 3; c++) expect(prev[c]).toBeCloseTo(1 - edge + edge * Math.exp(-tau[c] - k), 14);   // and f = 1 is the full leaf over its edge's share of the texel
  // the failure this prevents: alpha that is coverage alone puts the leaf's whole footprint under k at f = 0, a pop from 1 to 1 − edge·(1 − e^−k)
  expect(beam(0, false)[0]).toBeCloseTo(1 - edge + edge * Math.exp(-k), 14);
  expect(beam(0, false)[0]).toBeLessThan(0.3);
});

test("the grove hands the bake each leaf's fade (iFade) — the very factor it folded into its tau, in the layer and the faithful buffer", () => {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = { ...DEFAULTS, tree_count: 1.5, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2 };   // 7.5 leaves a twig, 1.5 trees: fades 1, ½ (marginal leaf), ½ (marginal tree), ¼ (both)
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => true, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  const layers = g.layerVAO.map((l) => Array.from(l.buf.data)), leaves = Array.from(faith.buf.data);
  const tau = [params.trans_r, params.trans_g, params.trans_b].map((v) => -Math.log(Math.min(Math.max(v, 1e-4), 0.999)));   // the grove's own clamp
  expect(g.layerVAO.every((l) => l.count === l.buf.data.length / 17), "17 floats a leaf on the layer path").toBe(true);
  expect(faith.count).toBe(leaves.length / 18);                              // 18 on the faithful one: the height, then the fade
  const seen = new Set();
  for (let i = 0; i + 17 < leaves.length; i += 18) {
    const fade = leaves[i + 17];
    seen.add(fade);
    for (let c = 0; c < 3; c++) expect(leaves[i + 8 + c], `leaf ${i / 18}`).toBe(Math.fround(tau[c] * fade));   // alpha's fade and tau's fade are one number
  }
  expect([...seen].sort()).toEqual([0.25, 0.5, 1]);
  let checked = 0;
  for (const l of layers) for (let i = 0; i + 16 < l.length; i += 17) {
    const fade = l[i + 16];
    for (let c = 0; c < 3; c++) expect(l[i + 8 + c]).toBe(Math.fround(tau[c] * fade));
    checked++;
  }
  expect(checked).toBe(leaves.length / 18);                                  // both buffers carry the same leaves
});

// ---- the shaders: the gate is the old expression, character for character --------------------------------------------
const code = (s) => s.replace(/\/\/.*$/gm, "");                              // identifiers in the code, not in the prose

test("the bake stamps coverage in alpha, fade included: a = cov·iFade·uCoverage", () => {
  expect(VS_BAKE.includes("layout(location=5) in float iFade;")).toBe(true);
  expect(VS_BAKE.includes("vFade = iFade * uCoverage;")).toBe(true);          // the grove-wide crossfade share rides alpha exactly as it rides tau
  expect(FS_BAKE.includes("frag = vec4(vTau*cov, cov*vFade);")).toBe(true);
  expect(VS_FAITH.includes("layout(location=6) in float iFade;")).toBe(true);   // the faithful record already has its height at 5
  expect(VS_FAITH.includes("vFade = iFade;")).toBe(true);
});

test("every cast camera taps the BEAM through the texel's mixture, and a shut gate is the literal old read in the else", () => {
  for (const cam of ["floor", "cloth", "enclosure"]) {
    const src = buildTransport(cam);
    expect(src.includes("uniform float uBeamK;"), `${cam} declares uBeamK`).toBe(true);
    expect(src.includes("texelMix(d.rgb, d.a, uBeamK, T, Tb);"), `${cam} tap reads the mixture`).toBe(true);
    expect(/texelMix\(d\.rgb, d\.a, uBeamK, T, Tb\);\s*return Tb;/.test(code(src)), `${cam} tap returns the ballistic share`).toBe(true);
    expect(code(src).includes("exp(-(d.rgb + uBeamK*d.a))"), `${cam}: the slab form is gone`).toBe(false);
    // the else of the uniform branch is the line the engine has always run
    expect(/if\(uBeamK > 0\.0\)\{[^}]*\}\s*else\s*\{\s*return exp\(-texture\(t,uv\)\.rgb\);/.test(code(src)), `${cam} tap else`).toBe(true);
    // ...and diffraction's per-channel taps ride the same mixture, at each channel's own dispersed position
    expect(/if\(uBeamK > 0\.0\)\{[^}]*texelMix\(qR\.rgb, qR\.a, uBeamK[^}]*texelMix\(qG\.rgb, qG\.a, uBeamK[^}]*texelMix\(qB\.rgb, qB\.a, uBeamK[^}]*\}\s*else\s*\{\s*float aR = texture\(t, \(world \+ H\*g\*cs\.r - uCanopyOrigin\)\/uCanopyExtent\)\.r;/.test(code(src)), `${cam} tapCA`).toBe(true);
    expect(src.includes("return exp(-vec3(aR,aG,aB));"), `${cam} tapCA else`).toBe(true);
  }
});

test("the faithful cast takes k at the bake, per stamp: the leaf's mixture over cov·fade, and the else is the literal old line", () => {
  expect(FS_FAITH.includes("uniform float uBeamK;")).toBe(true);
  expect(FS_FAITH.includes("in float vFade;")).toBe(true);
  // one stamp is one leaf over cf = cov·fade of the pixel at depth vTau/vFade: (1 − cf) + cf·e^(−vTau/vFade − k), which multiplicative blending then stacks leaf by leaf
  expect(code(FS_FAITH).includes("texelMix(vTau*cov, cov*vFade, uBeamK, T, Tb);")).toBe(true);
  expect(/frag = vec4\(Tb, 1\.0\);/.test(code(FS_FAITH))).toBe(true);
  expect(code(FS_FAITH).includes("exp(-(vTau + uBeamK*vFade)*cov)")).toBe(false);   // the slab form is gone
  expect(/else\s*frag = vec4\(exp\(-vTau\*cov\), 1\.0\);/.test(FS_FAITH)).toBe(true);
});

// refreshFaith is what keeps the cast current for a frame that nothing else baked. A recording stub GL and no grove (faith.vao null: bakeFaithful
// records what it was made of and stops there) are enough to read WHEN it casts; the pixels of the cast are the harness's.
import { makeBake } from "./komorebi-bake.js";
function castRig(over = {}) {
  let casts = 0;
  const gl = new Proxy({}, { get: (_t, name) => (/^[A-Z][A-Z0-9_]+$/.test(name) ? name : () => { if (name === "bindFramebuffer") casts++; return {}; }) });
  const params = { leaf_diffuse: 0, ...over };
  const src = { count: 29 }, faith = { vao: null, k: 0, n: 0 };
  const bake = makeBake({ gl, params, motion: {}, src, faith, sky: {}, U: {}, fill: {}, bakeRes: () => 256, faithfulOn: () => true });
  return { bake, params, src, faith, casts: () => casts };
}

test("refreshFaith: the cast is re-cast when leaf_diffuse moves OR the sample count does, and not for anything else", () => {
  const r = castRig();
  r.bake.bakeFaithful();
  expect([r.faith.k, r.faith.n], "the bake records what it was made of").toEqual([0, 29]);
  const base = r.casts();
  r.bake.refreshFaith(); r.bake.refreshFaith();
  expect(r.casts(), "nothing moved: no cast").toBe(base);
  r.src.flat = new Float32Array(87); r.src.maxR = 0.02;                                 // a transition's morph re-cuts the cloud's SHAPE every frame at the same count
  r.bake.refreshFaith();
  expect(r.casts(), "the cloud's shape moved at the same count: no cast (the morph does not re-cast the whole tree each frame)").toBe(base);
  r.params.leaf_diffuse = 0.5; r.bake.refreshFaith();
  expect(r.casts(), "leaf_diffuse moved: re-cast").toBe(base + 1);
  r.bake.refreshFaith();
  expect(r.casts(), "...once").toBe(base + 1);
  r.src.count = 22; r.bake.refreshFaith();                                              // resetPerf / the governor re-cut the cloud to a count the bake did not see
  expect(r.casts(), "the sample count moved: re-cast").toBe(base + 2);
  expect(r.faith.n).toBe(22);
  r.bake.refreshFaith();
  expect(r.casts(), "...once").toBe(base + 2);
});

test("ONE texelMix text: the sky ray, the fill, the cast tap and the faithful stamp carry the very same snippet, once each", () => {
  const mix = SH.GLSL_TEXEL_MIX;
  expect(typeof mix).toBe("string");
  expect(mix.includes("void texelMix(vec3 tau, float c, float k, out vec3 T, out vec3 Tb)")).toBe(true);
  expect(GLSL_SKY_RAY.includes(mix)).toBe(true);                            // the sky camera and the fill both take it through the shared ray...
  const programs = { fill: FS_FILL, faith: FS_FAITH, sky: buildTransport("sky"), floor: buildTransport("floor"), cloth: buildTransport("cloth"), enclosure: buildTransport("enclosure") };
  for (const [name, src] of Object.entries(programs)) {
    expect(src.includes(mix), `${name} carries it`).toBe(true);
    expect(src.split("void texelMix(").length - 1, `${name} defines it once`).toBe(1);
  }
  // the d = 0 side is nothing's business: the snippet declares no uniform and reads no k of its own
  expect(code(mix).includes("uniform")).toBe(false);
  // the guard: an empty texel is exactly clear, and k = 0 is not a split
  expect(code(mix).includes("c < 1e-4")).toBe(true);
});

test("the sky camera passes the beam's k to the shared ray from its OWN group; the fill passes its own, and reads no wood", () => {
  const sky = buildTransport("sky");
  expect(sky.includes("skyRay(pL0, pL1, pL2, pL3, uSunDir.xy / max(uSunDir.z, 0.05), uSkyScatter > 0.0 || uBeamK > 0.0, true, true, uBeamK, T, Tsrc, Lsc);")).toBe(true);
  expect(sky.includes("uniform float uBeamK;")).toBe(true);
  expect(CAMERAS.sky.groups).not.toContain("tap");                           // the cast cameras' tap is not part of a camera that casts nothing
  expect(Object.keys(TRANSPORT_GROUPS.sky.locs)).toContain("beamK");
  expect(FS_FILL.includes("skyRay(x + s*uLayerHeight[0], x + s*uLayerHeight[1], x + s*uLayerHeight[2], x + s*uLayerHeight[3], uFillG, scatter, uFillOpen, false, uFillBeamK, T, Tb, Lsc);")).toBe(true);
});

test("the shared per-ray snippet: alpha is COVERAGE on every camera, the wood is its own texture, and the emission is the leaf's own hue T − Tb, no albedo", () => {
  expect(GLSL_SKY_RAY.includes("w = readWood ? exp(-texture(wood, uv).r) : 1.0;")).toBe(true);
  const src = code(GLSL_SKY_RAY);
  expect(src.includes("if(beamK > 0.0) texelMix(d.rgb, d.a, beamK, t, tb);")).toBe(true);   // the tap reconstructs the mixture from the pair, once per tap...
  expect(src.includes("else { t = exp(-d.rgb); tb = t; }")).toBe(true);                       // ...and its else is the d = 0 read, the slab, character for character
  expect(/if\(beamK > 0\.0\)\{/.test(src)).toBe(true);                       // the split wherever k is up: the fill's and, now, the sky camera's
  expect(src.includes("Lsc += thr*(tL0 - tbL0)*uSunColor*A0;")).toBe(true);   // emit = T − Tb, the very terms the beam and the sky took out
  expect(src.includes("exp(-beamK")).toBe(false);                             // no slab form anywhere in the ray: k only ever reaches a texel through texelMix
  expect(src.includes("uAmbient")).toBe(false);                               // the skylight is Tsky's, and its passage needs no split (the uniform-sky identity)
  expect(src.includes("thr*(1.0-tL0)*leafHue(tL0)*uSunColor*A0")).toBe(true);  // the P0b term, still there as the else
  // the fill's own gain: the albedo at d = 0 (the literal old product), 1 above it
  expect(FS_FILL.includes("fillS = vec4(Lsum/K*(uFillBeamK > 0.0 ? 1.0 : uFillScatter), 1.0);")).toBe(true);
  expect(FS_FILL.includes("bool scatter = uFillScatter > 0.0 || uFillBeamK > 0.0;")).toBe(true);
});

test("the receivers: the floor is unchanged, the cloth and the tent now read S, and the shut gate is the old line", () => {
  expect(buildTransport("floor")).toContain("amb = mix(uAmbient, uAmbient*textureLod(uFillT, fuv, FILL_LOD).rgb + textureLod(uFillS, fuv, FILL_LOD).rgb, uCanopyFill);");
  expect(buildTransport("floor")).toContain("col = (acc*uSunColor + uAmbient) * uGround;");
  for (const cam of ["cloth", "enclosure"]) {
    const src = buildTransport(cam);
    expect(src, cam).toContain("E = acc*uSunColor*beamF + uAmbient*skyF*skyT;");   // the P0b line, kept verbatim
    expect(src, cam).toContain("E = acc*uSunColor*beamF + uAmbient*skyF;");        // and the shut-gate one
    expect(/if\(uBeamK > 0\.0\) E \+= textureLod\(uFillS, \(world-uFillOrigin\)\/uFillExtent, FILL_LOD\)\.rgb\*skyS\*uCanopyFill;/.test(src), `${cam} reads S behind both gates`).toBe(true);
  }
});

test("the curtain reads S at the vertical plane's view factor, 0.5 — the tent's own skyF gives its panels theirs", () => {
  // The skyline term keeps its floor convention (skyF 1 on the cloth: it is the sky the curtain was authored under), so the S read
  // gets a factor of its own. A vertical plane sees half the hemisphere, which is what skyF is for the tent's wall panels; read at 1
  // the curtain doubled when the split opened (×2.03 on curtain 1).
  const cloth = buildTransport("cloth"), tent = buildTransport("enclosure");
  expect(cloth.includes("float skyS = 0.5;")).toBe(true);
  expect(tent.includes("float skyS = 1.0;")).toBe(true);
  expect(tent.includes("skyS = skyF;")).toBe(true);                       // the tent: S through the same view of the hemisphere as the sky
  expect(cloth.includes("skyS = skyF;")).toBe(false);
  for (const src of [cloth, tent]) {
    expect(src).toContain("E = acc*uSunColor*beamF + uAmbient*skyF*skyT;");   // the P0b sky term untouched: only the S read moved
    expect(src).toContain("E = acc*uSunColor*beamF + uAmbient*skyF;");
    expect(src.includes("FILL_LOD).rgb*skyF*uCanopyFill")).toBe(false);
  }
});

test("registry: the beam's k is a declared, uploaded uniform of the beam group — and the fill bake carries its own", () => {
  expect(Object.keys(TRANSPORT_GROUPS.beam.locs)).toEqual(["beamK"]);
  expect(GROUP_UPLOAD_KEYS).toContain("beam");
  for (const cam of ["floor", "cloth", "enclosure"]) expect(CAMERAS[cam].groups, cam).toContain("beam");
  expect(code(FS_FILL).includes("uniform float uFillBeamK;")).toBe(true);
});
