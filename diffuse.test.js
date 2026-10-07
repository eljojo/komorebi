// ============================================================================
// A leaf is not a window (spec §4.5/§4.6/§4.7). A real leaf's transmitted light is almost entirely DIFFUSE: the
// mesophyll scatters it, like frosted glass, so a leaf four metres up throws a dark shadow and its colour spreads
// over the floor beneath. The engine used to treat each leaf's transmittance as BALLISTIC, painting every leaf's
// colour as a sharp image inside its own shadow and multiplying complementary filters (green over red goes near
// black: the mid-fall "mud"). The split is T = T_b + T_d, ballistic (1−d)·T and diffuse d·T, and it enters as
// NEUTRAL depth: k = −ln(1−d), τ_ball = τ + k·coverage. These tests hold the laws that would otherwise fail
// SILENTLY: a ballistic share that is not the same hue as the leaf, a conservation that leaks, a gate that is not
// the old frame, a marginal leaf whose shadow pops, a sky view that has quietly started to read a knob it must not.
// komorebi-fill.js is the reference the pixel harness holds the shader to; bun holds the reference to the laws.
// ============================================================================
import { test, expect } from "bun:test";
import { DEFAULTS, MORPH_KEYS, CAMERAS, TRANSPORT_GROUPS, GROUP_UPLOAD_KEYS, buildTransport } from "./komorebi.js";
import * as M from "./komorebi-math.js";
import * as F from "./komorebi-fill.js";
import { VS_BAKE, FS_BAKE, VS_FAITH, FS_FAITH, FS_FILL, GLSL_SKY_RAY } from "./komorebi-shaders.js";
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

test("neutral depth preserves hue: leafHue(tb) = leafHue(t), for any k and any coverage", () => {
  // k is the same in all three channels because the split is set by the leaf's scattering structure, not its pigments.
  // (leafHue floors its peak at 1e-4, so the claim is for a beam still above that — a leaf darker than the floor has no hue to keep.)
  let kept = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const t = [0, 1, 2].map((c) => 0.2 + 0.8 * u01(seed, c, 1, 2, 0)), c = 2 * u01(seed, 3, 1, 2, 0), k = kOf(seed);
    const tb = F.ballistic(t, c, k);
    if (Math.max(...tb) < 1e-3) continue;
    const a = F.leafHue(tb), b = F.leafHue(t);
    for (let i = 0; i < 3; i++) expect(a[i], `seed ${seed}`).toBeCloseTo(b[i], 12);
    kept++;
  }
  expect(kept).toBeGreaterThan(1500);
});

test("emitted light is real and bounded: 0 ≤ t − tb ≤ t, per channel", () => {
  for (let seed = 0; seed < 10000; seed++) {
    const t = [0, 1, 2].map((c) => u01(seed, c, 3, 4, 0)), c = 4 * u01(seed, 3, 3, 4, 0), k = kOf(seed);
    const tb = F.ballistic(t, c, k);
    for (let i = 0; i < 3; i++) {
      expect(t[i] - tb[i], `seed ${seed}`).toBeGreaterThanOrEqual(0);       // a leaf's beam is never brighter than the light it passes in all
      expect(t[i] - tb[i]).toBeLessThanOrEqual(t[i]);
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
  // and Tsky never reads k: the uniform-sky identity says the skylight needs no split, only the sun does
  expect(a.T).toEqual(F.fillRef(layers, x, 16, { ...base, k: 0, scatter: 0 }).T);
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
      for (const l of layers) { const tt = l.t(x, y)[1], cc = l.c(x, y); t *= tt; tb *= tt * Math.exp(-k * cc); }
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

// ---- the marginal leaf -------------------------------------------------------------------------------------------
test("a leaf fading in (§5.3) fades its BALLISTIC shadow with it: tb is continuous in the fade f, and 1 at f = 0", () => {
  // The grove folds the fade into τ on the CPU, so alpha has to carry it too (iFade) or the beam's k·coverage would
  // keep its full weight on a leaf that is not there yet and pop the instant it starts to appear.
  const tau = [0.9, 0.5, 1.4], k = M.ballisticK(0.95), edge = 0.8;
  const depth = (f, withFade) => { const s = F.leafTexel(tau, f, edge); return [0, 1, 2].map((c) => s.rgb[c] + k * (withFade ? s.a : edge)); };
  expect(depth(0, true)).toEqual([0, 0, 0]);                                // f = 0: no depth at all, tb = 1 in every channel
  let prev = depth(0, true).map((d) => Math.exp(-d));
  for (let i = 1; i <= 200; i++) {
    const tb = depth(i / 200, true).map((d) => Math.exp(-d));
    for (let c = 0; c < 3; c++) expect(Math.abs(tb[c] - prev[c]), `f=${i / 200}`).toBeLessThan(0.05);   // no step anywhere along the fade
    prev = tb;
  }
  for (let c = 0; c < 3; c++) expect(prev[c]).toBeCloseTo(Math.exp(-(tau[c] + k) * edge), 14);   // and f = 1 is the full leaf
  // the failure this prevents: alpha that is coverage alone is e^(−k·edge) at f = 0, a pop of 1 − e^(−k·edge)
  expect(Math.exp(-depth(0, false)[0])).toBeLessThan(0.1);
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

test("every cast camera taps the BEAM as tau + k·alpha, and a shut gate is the literal old read in the else", () => {
  for (const cam of ["floor", "cloth", "enclosure"]) {
    const src = buildTransport(cam);
    expect(src.includes("uniform float uBeamK;"), `${cam} declares uBeamK`).toBe(true);
    expect(src.includes("exp(-(d.rgb + uBeamK*d.a))"), `${cam} tap`).toBe(true);
    // the else of the uniform branch is the line the engine has always run
    expect(/if\(uBeamK > 0\.0\)\{[^}]*\}\s*else\s*\{\s*return exp\(-texture\(t,uv\)\.rgb\);/.test(src), `${cam} tap else`).toBe(true);
    // ...and diffraction's per-channel taps ride the same k, at each channel's own dispersed position
    expect(/if\(uBeamK > 0\.0\)\{[^}]*qR\.a[^}]*qG\.a[^}]*qB\.a[^}]*\}\s*else\s*\{\s*float aR = texture\(t, \(world \+ H\*g\*cs\.r - uCanopyOrigin\)\/uCanopyExtent\)\.r;/.test(src), `${cam} tapCA`).toBe(true);
    expect(src.includes("return exp(-vec3(aR,aG,aB));"), `${cam} tapCA else`).toBe(true);
  }
});

test("the faithful cast takes k at the bake: exp(−(τ + k·fade)·cov), and the else is the literal old line", () => {
  expect(FS_FAITH.includes("uniform float uBeamK;")).toBe(true);
  expect(FS_FAITH.includes("in float vFade;")).toBe(true);
  expect(FS_FAITH.includes("frag = vec4(exp(-(vTau + uBeamK*vFade)*cov), 1.0);")).toBe(true);
  expect(/else\s*frag = vec4\(exp\(-vTau\*cov\), 1\.0\);/.test(FS_FAITH)).toBe(true);
});

test("the sky camera is compiled with the literal 0.0 and never declares the knob: this phase leaves the sky view alone", () => {
  const sky = buildTransport("sky");
  expect(sky.includes("skyRay(pL0, pL1, pL2, pL3, uSkyScatter > 0.0, true, true, 0.0, T, Lsc);")).toBe(true);
  expect(code(sky).includes("uBeamK")).toBe(false);                          // (the comment on that very line names it; the code never does)
  expect(CAMERAS.sky.groups).not.toContain("tap");
  expect(FS_FILL.includes("skyRay(x + s*uLayerHeight[0], x + s*uLayerHeight[1], x + s*uLayerHeight[2], x + s*uLayerHeight[3], scatter, false, false, uFillBeamK, T, Lsc);")).toBe(true);
});

test("the shared per-ray snippet: alpha is COVERAGE where the wood is not in it, and the emission is the leaf's own hue, no albedo", () => {
  expect(GLSL_SKY_RAY.includes("woodInAlpha ? exp(-d.a) : d.a")).toBe(true);
  const src = code(GLSL_SKY_RAY);
  expect(/if\(beamK > 0\.0 && !woodInAlpha\)\{/.test(src)).toBe(true);        // the split only where alpha is coverage; the sky view's call can never reach it
  expect(src.includes("thr*tL0*(1.0-exp(-beamK*qL0.a))*uSunColor*A0")).toBe(true);
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
    expect(/if\(uBeamK > 0\.0\) E \+= textureLod\(uFillS, \(world-uCanopyOrigin\)\/uCanopyExtent, FILL_LOD\)\.rgb\*skyF\*uCanopyFill;/.test(src), `${cam} reads S behind both gates`).toBe(true);
  }
});

test("registry: the beam's k is a declared, uploaded uniform of the tap group — and the fill bake carries its own", () => {
  expect(Object.keys(TRANSPORT_GROUPS.tap.locs)).toEqual(["beamK"]);
  expect(GROUP_UPLOAD_KEYS).toContain("tap");
  for (const cam of ["floor", "cloth", "enclosure"]) expect(CAMERAS[cam].groups, cam).toContain("tap");
  expect(code(FS_FILL).includes("uniform float uFillBeamK;")).toBe(true);
});
