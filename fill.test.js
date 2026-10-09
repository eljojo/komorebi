// ============================================================================
// The sky fill (spec §4.7, "What the shade is lit by"): the shade between the dapples is lit by the skylight that
// came THROUGH the canopy and by the sunlight the lit leaves scatter downward. The fill shader runs a fixed
// cosine-weighted quadrature over a layer stack; komorebi-fill.js is that quadrature as pure functions, and these
// tests hold its laws. The ones worth holding loudly are the ones that would otherwise fail SILENTLY: weights that
// stop summing to one, a canopy-free stack that stops being exactly bright, a mean taken in tau instead of in
// transmittance (Jensen), a scatter term that out-glows the light that landed on the leaves.
// ============================================================================
import { test, expect } from "bun:test";
import { DEFAULTS } from "./komorebi.js";
import { hash3, sunDirection, DEG } from "./komorebi-math.js";
import { FILL_GOLDEN, FILL_TILE, fillTile, fillDirections, fillRays, fillTurns, skyRayRef, fillRef } from "./komorebi-fill.js";
import { FS_FILL, GLSL_SKY_RAY } from "./komorebi-shaders.js";
import { TRANSPORT_GROUPS, buildTransport } from "./komorebi.js";
import { makeGrove } from "./komorebi-grove.js";

const SUN = [1.1, 0.95, 0.8], G_SUN = [0.5, -0.3];   // sun colour, the sun's plan travel per metre of rise
const HEIGHTS = [2, 3, 4];                                                    // a synthetic 3-layer stack, lowest first
// a layer is { h, t(x, y) -> [r,g,b] }: the layer's FOLIAGE transmittance at a plan point
const stack = (field) => HEIGHTS.map((h, L) => ({ h, t: (x, y) => field(x, y, L) }));
const open = stack(() => [1, 1, 1]);
const tauField = (s) => (x, y, L) => {   // a smooth, channel-dependent optical depth scaled by s: exp(-s*tau) falls pointwise as s grows
  const w = 1 + Math.sin(1.7 * x + L) * Math.cos(1.3 * y - L);
  return [Math.exp(-s * 0.5 * w), Math.exp(-s * 0.2 * w), Math.exp(-s * 0.9 * w)];
};
const checker = (tau) => (x, y, L) => {   // gappy: half of every layer is open, half is tau deep — the same MEAN tau as a uniform tau/2 veil
  const open = (Math.floor(x / 0.5) + Math.floor(y / 0.5) + L) % 2 === 0;
  return open ? [1, 1, 1] : [Math.exp(-tau), Math.exp(-tau), Math.exp(-tau)];
};
// a hash-random layer field, a fresh stack per seed: every tap (the ray's own, the sun path's) reads an independent value
const randomField = (seed) => (x, y, L) => {
  const cx = Math.floor(x * 7), cy = Math.floor(y * 7);
  const u = (c) => hash3(seed * 4 + c, cx * 31 + L, cy) / 4294967296;
  return [u(0), u(1), u(2)];
};
const sum = (a) => a.reduce((s, v) => s + v, 0);
const grid = Array.from({ length: 144 }, (_, i) => [(i % 12) * 0.37 - 2, Math.floor(i / 12) * 0.41 - 2.2]);

test("the directions: K weights of 1/K that sum to one, every one strictly above the horizon", () => {
  for (const K of [1, 2, 3, 7, 16, 33, 64]) {
    const d = fillDirections(K);
    expect(d.length).toBe(K);
    expect(Math.abs(sum(d.map((x) => x.w)) - 1)).toBeLessThan(1e-12);
    for (const x of d) {
      expect(x.w).toBe(1 / K);
      expect(x.theta).toBeGreaterThan(0);
      expect(x.theta).toBeLessThan(Math.PI / 2);
    }
  }
});

test("stratified in cos^2(theta) at the stratum midpoints, azimuth by the golden angle, no randomness anywhere", () => {
  const K = 16, d = fillDirections(K);
  for (let k = 0; k < K; k++) {
    expect(Math.cos(d[k].theta) ** 2).toBeCloseTo(1 - (k + 0.5) / K, 12);
    expect(d[k].phi).toBeCloseTo(k * FILL_GOLDEN, 12);
    // the plan travel per metre of rise IS tan(theta) along the azimuth
    expect(d[k].shift[0]).toBeCloseTo(Math.tan(d[k].theta) * Math.cos(d[k].phi), 12);
    expect(d[k].shift[1]).toBeCloseTo(Math.tan(d[k].theta) * Math.sin(d[k].phi), 12);
  }
  expect(fillDirections(K)).toEqual(d);                       // frame-stable: the same call, the same numbers
  // the stratification is what makes 1/K the right weight for a COSINE-weighted integral: E[cos^2] = 1/2 exactly,
  // and E[cos] -> 2/3 (the cosine-weighted hemisphere's mean cosine) as K grows
  const mean = (K2, f) => sum(fillDirections(K2).map((x) => f(x.theta))) / K2;
  expect(mean(16, (t) => Math.cos(t) ** 2)).toBeCloseTo(0.5, 12);
  expect(Math.abs(mean(64, Math.cos) - 2 / 3)).toBeLessThan(0.01);
});

test("the shader's uniforms: each ray's (cos^2 theta centre, cos phi, sin phi) and each slot's (cos, sin) turn, flat, in float32 — no trig on the GPU", () => {
  // GLSL ES only promises ~2^-11 absolute error from sin/cos, and a ray's shift is tan(theta)*height metres long: a
  // few 1e-4 of angle is centimetres on the floor. So the unit vectors come from float64 JS, and the shader rotates.
  const K = 16, flat = fillRays(K), d = fillDirections(K);
  expect(flat).toBeInstanceOf(Float32Array);
  expect(flat.length).toBe(3 * K);
  for (let k = 0; k < K; k++) {
    expect(flat[3 * k]).toBe(Math.fround(Math.cos(d[k].theta) ** 2));
    expect(flat[3 * k + 1]).toBe(Math.fround(Math.cos(d[k].phi)));
    expect(flat[3 * k + 2]).toBe(Math.fround(Math.sin(d[k].phi)));
  }
  const turns = fillTurns();
  expect(turns).toBeInstanceOf(Float32Array);
  expect(turns.length).toBe(32);
  for (let b = 0; b < 16; b++) {
    expect(turns[2 * b]).toBe(Math.fround(Math.cos(2 * Math.PI * b / 16)));
    expect(turns[2 * b + 1]).toBe(Math.fround(Math.sin(2 * Math.PI * b / 16)));
  }
  // rotating ray k's unit vector by slot b's turn IS the rotated direction's azimuth — the identity the shader relies on
  for (let b = 0; b < 16; b++) fillDirections(K, b).forEach((r, k) => {
    const c = Math.cos(d[k].phi), s = Math.sin(d[k].phi), ct = Math.cos(2 * Math.PI * b / 16), st = Math.sin(2 * Math.PI * b / 16);
    expect(c * ct - s * st).toBeCloseTo(Math.cos(r.phi), 12);
    expect(s * ct + c * st).toBeCloseTo(Math.sin(r.phi), 12);
  });
});

test("no canopy: Tsky is 1 and the scattered light is 0, EXACTLY", () => {
  for (const K of [1, 3, 7, 16, 49]) {
    const r = fillRef(open, [0.3, -0.7], K, { gS: G_SUN, sun: SUN, scatter: 0.9 });
    expect(r.T).toEqual([1, 1, 1]);                           // exact for any K, not just the powers of two: the sum is divided by K, not multiplied by 1/K
    expect(r.S).toEqual([0, 0, 0]);
  }
});

test("an opaque slab: Tsky is 0, whatever else the stack holds", () => {
  const slab = stack((x, y, L) => (L === 1 ? [0, 0, 0] : randomField(5)(x, y, L)));
  for (const x of grid.slice(0, 30)) expect(fillRef(slab, x, 16, { gS: G_SUN, sun: SUN, scatter: 0.5 }).T).toEqual([0, 0, 0]);
});

test("a denser stack lets less sky through, monotonically", () => {
  const mean = (s) => sum(grid.map((x) => fillRef(stack(tauField(s)), x, 16, { gS: G_SUN, sun: SUN, scatter: 0 }).T[1])) / grid.length;
  let prev = Infinity;
  for (const s of [0, 0.25, 0.5, 1, 2, 4]) {
    const m = mean(s);
    expect(m, `s=${s}`).toBeLessThan(prev);
    prev = m;
  }
  expect(mean(0)).toBe(1);
});

test("Jensen: the mean is of TRANSMITTANCE — a gappy canopy passes more than the veil of the same mean tau", () => {
  // the checker is half open and half 2 deep per layer (mean tau 1 per layer, 3 over the stack); the veil of that
  // mean is exp(-3). Averaging tau first (a blur, a mip) lands on the veil and calls a gappy crown a uniform one.
  const gappy = stack(checker(2));
  const T = grid.map((x) => fillRef(gappy, x, 16, { gS: G_SUN, sun: SUN, scatter: 0 }).T);
  const meanT = sum(T.map((t) => t[0])) / T.length;
  expect(meanT).toBeGreaterThan(Math.exp(-3) * 2);           // by a wide margin, not by a rounding error
  // and per sample point, per channel: the quadrature's own Jensen inequality — E[exp(-X)] >= exp(-E[X]) over the K rays
  for (const x of grid) {
    const r = fillRef(gappy, x, 16, { gS: G_SUN, sun: SUN, scatter: 0 });
    for (let c = 0; c < 3; c++) expect(r.T[c]).toBeGreaterThanOrEqual(Math.exp(-r.meanTau[c]) - 1e-12);
  }
});

test("energy: the scattered light never exceeds scatter * (1 - Tsky) * sun, over 10^4 random stacks", () => {
  let worst = -Infinity, strict = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const nL = 1 + (seed % 3);
    const K = [1, 4, 16, 33][seed % 4];
    const scatter = (hash3(seed, 9, 9) % 1001) / 1000;
    const sun = [0, 1, 2].map((c) => (hash3(seed, 11, c) % 2000) / 1000);
    const layers = stack(randomField(seed)).slice(0, nL);
    const gS = [((hash3(seed, 17, 0) % 2000) - 1000) / 500, ((hash3(seed, 17, 1) % 2000) - 1000) / 500];
    const r = fillRef(layers, [(hash3(seed, 19, 0) % 4000) / 1000 - 2, (hash3(seed, 19, 1) % 4000) / 1000 - 2], K, { gS, sun, scatter });
    for (let c = 0; c < 3; c++) {
      expect(r.T[c]).toBeLessThanOrEqual(1);
      const bound = scatter * (1 - r.T[c]) * sun[c];
      worst = Math.max(worst, r.S[c] - bound);
      if (r.S[c] > bound + 1e-12) throw new Error(`seed ${seed} channel ${c}: S ${r.S[c]} > bound ${bound}`);
      if (r.S[c] > 0.5 * bound && bound > 0) strict++;         // the bound is not vacuous: random stacks come close to it
    }
  }
  expect(worst).toBeLessThanOrEqual(1e-12);
  expect(strict).toBeGreaterThan(100);
});

// ---- THE AMBIENT TERM WAS A DOUBLE COUNT (§4.9, §4.7). The source term is the SUN's light scattered by the lit leaves.
// The skylight's own passage through a layer is already the T·sky term (the eye ray's, the fill's Tsky): for a uniform
// sky, diffuse transmission through Lambertian leaves equals the ballistic T·L_sky to first order, so a leaf that also
// "re-radiated" the sky that fell on it counted that skylight twice. Leaf-top reflection goes up, never to an eye
// below, and an underside has nothing to reflect (the model has no ground bounce). With the sun off nothing is left to
// scatter — the loudest way to say it, and the way these tests hold it.
const sunless = (seed) => {   // a random stack and ray; the caller turns the sun off
  const nL = 1 + (seed % 3), K = [1, 4, 16][seed % 3];
  const layers = stack(randomField(seed)).slice(0, nL);
  const gS = [((hash3(seed, 17, 0) % 2000) - 1000) / 500, ((hash3(seed, 17, 1) % 2000) - 1000) / 500];
  const x = [(hash3(seed, 19, 0) % 4000) / 1000 - 2, (hash3(seed, 19, 1) % 4000) / 1000 - 2];
  return { K, layers, gS, x, d: fillDirections(K)[seed % K] };
};
test("sun off: a sky ray through any leaf stack IS the transmitted sky, with zero scatter, exactly", () => {
  const SKY = [0.9, 1.3, 2.1];   // a uniform sky radiance, per channel
  for (let seed = 0; seed < 2000; seed++) {
    const { layers, gS, x, d } = sunless(seed);
    const r = skyRayRef(layers, x, d.shift, gS, [0, 0, 0]);
    expect(r.L, `seed ${seed}`).toEqual([0, 0, 0]);   // no sun, no scatter: skylight does not make a leaf glow
    const T = [1, 1, 1];
    layers.forEach((l) => { const t = l.t(x[0] + d.shift[0] * l.h, x[1] + d.shift[1] * l.h); for (let c = 0; c < 3; c++) T[c] *= t[c]; });
    for (let c = 0; c < 3; c++) {
      expect(r.T[c]).toBeCloseTo(T[c], 12);
      expect(r.T[c] * SKY[c] + 0.7 * r.L[c], `seed ${seed} channel ${c}`).toBe(r.T[c] * SKY[c]);   // the sky view's col = T·sky + sky_scatter·L
    }
  }
});
test("sun off: the fill's scattered light S is exactly 0, for any stack, any K, any tile, any albedo", () => {
  for (let seed = 0; seed < 600; seed++) {
    const { layers, gS, x, K } = sunless(seed);
    const scatter = 0.05 + (hash3(seed, 9, 9) % 951) / 1000;
    const r = fillRef(layers, x, K, { gS, sun: [0, 0, 0], scatter, tile: seed % 16 });
    expect(r.S, `seed ${seed}`).toEqual([0, 0, 0]);
  }
});

test("the scatter albedo is a pure gain: 0 turns the term off exactly, and Tsky never reads it", () => {
  const layers = stack(tauField(1.5));
  const x = [0.4, 0.2], base = { gS: G_SUN, sun: SUN };
  const off = fillRef(layers, x, 16, { ...base, scatter: 0 }), on = fillRef(layers, x, 16, { ...base, scatter: 0.5 }), full = fillRef(layers, x, 16, { ...base, scatter: 1 });
  expect(off.S).toEqual([0, 0, 0]);
  expect(on.T).toEqual(off.T);
  for (let c = 0; c < 3; c++) { expect(on.S[c]).toBeGreaterThan(0); expect(on.S[c]).toBeCloseTo(0.5 * full.S[c], 12); }
});

test("one direction IS the sky view's per-ray formula (§4.9), on the same stack", () => {
  // The formula as the spec states it, spelled out here independently of komorebi-fill.js:
  //   L = sum_L thr_L (1 - t_L) shat_L (sun A_L),  thr_L = prod_{M<L} t_M,  A_L = prod_{M>L} t_M(p_L + g (h_M - h_L)),
  //   shat = t / max(t) (unit-peak hue), p_L = where the ray crosses layer L.
  const layers = stack(randomField(42));
  const dirs = fillDirections(5);
  for (const d of dirs) {
    const p = [0.3, -0.45];
    const pts = HEIGHTS.map((h) => [p[0] + d.shift[0] * h, p[1] + d.shift[1] * h]);
    const t = layers.map((l, L) => l.t(pts[L][0], pts[L][1]));
    const want = [0, 0, 0], thr = [1, 1, 1], T = [1, 1, 1];
    for (let L = 0; L < 3; L++) {
      const A = [1, 1, 1];
      for (let M = L + 1; M < 3; M++) {
        const a = layers[M].t(pts[L][0] + G_SUN[0] * (HEIGHTS[M] - HEIGHTS[L]), pts[L][1] + G_SUN[1] * (HEIGHTS[M] - HEIGHTS[L]));
        for (let c = 0; c < 3; c++) A[c] *= a[c];
      }
      const peak = Math.max(t[L][0], t[L][1], t[L][2], 1e-4);
      for (let c = 0; c < 3; c++) { want[c] += thr[c] * (1 - t[L][c]) * (t[L][c] / peak) * (SUN[c] * A[c]); thr[c] *= t[L][c]; T[c] *= t[L][c]; }
    }
    const ray = skyRayRef(layers, p, d.shift, G_SUN, SUN);
    for (let c = 0; c < 3; c++) { expect(ray.L[c]).toBeCloseTo(want[c], 12); expect(ray.T[c]).toBeCloseTo(T[c], 12); }
  }
  // ...and the fill at K = 1 is that same ray, in the direction fillDirections(1) names
  const d1 = fillDirections(1)[0];
  const ray = skyRayRef(layers, [0.3, -0.45], d1.shift, G_SUN, SUN);
  const f = fillRef(layers, [0.3, -0.45], 1, { gS: G_SUN, sun: SUN, scatter: 0.7 });
  for (let c = 0; c < 3; c++) { expect(f.T[c]).toBe(ray.T[c]); expect(f.S[c]).toBeCloseTo(0.7 * ray.L[c], 14); }
});

test("the gate: canopy_fill ships shut, and the fill knobs carry the defaults the spec names", () => {
  expect(DEFAULTS.canopy_fill).toBe(0);          // presets merge over DEFAULTS: a 1 here would relight every shipped look
  expect(DEFAULTS.fill_scatter).toBe(0);
  expect(DEFAULTS.fill_directions).toBe(16);
  expect(DEFAULTS.fill_resolution).toBe(256);
});

test("the sun's unit direction is one helper: transport's uSunDir reads it (the cloth's incidence, the sky view's seen source); the fill walks the beam's bulk shift instead, one sun per camera", () => {
  const v = sunDirection([0, 0, 0], 55, 30);
  expect(v[0]).toBe(Math.cos(55 * DEG) * Math.cos(30 * DEG));
  expect(v[1]).toBe(Math.cos(55 * DEG) * Math.sin(30 * DEG));
  expect(v[2]).toBe(Math.sin(55 * DEG));
  expect(Math.hypot(...v)).toBeCloseTo(1, 14);
  const out = [9, 9, 9];
  expect(sunDirection(out, 12, 200)).toBe(out);   // fills the caller's scratch: a static frame allocates nothing
});

// buildGrove allocates GL buffers; a recording stub is enough to read what it hands the engine (leaf.test.js's idiom)
function grow(over) {
  const gl = new Proxy({}, { get: (_t, name) => (name === "createBuffer" ? () => ({}) : () => ({})) });
  const params = { ...DEFAULTS, tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, ...over };
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => true, occ: {}, faith, sky: { start: [], count: [] } };
  return { g: makeGrove(hub).buildGrove(null), faith };
}

test("the faithful path's low-res layers sit where the twigs really grew: each bin's height is its twigs' mean grown z", () => {
  // the park band (canopy_base_height_m + thickness) is a normalisation the faithful cast ignores — it casts from the
  // grown z. The fill's hemisphere has to be read at the heights the leaves REALLY hang at (§4.7), bottom to top.
  const { g, faith } = grow({ layer_count: 3, crown_aspect: 2 });
  expect(faith.binH.length).toBeGreaterThanOrEqual(3);
  const tw = g.hier.twigs;
  for (let l = 0; l < 3; l++) {
    const z = tw.filter((t) => t.layer === l).map((t) => t.z);
    expect(z.length, `bin ${l} is populated`).toBeGreaterThan(0);
    expect(faith.binH[l]).toBeCloseTo(sum(z) / z.length, 4);
  }
  expect(faith.binH[0]).toBeLessThan(faith.binH[1]);
  expect(faith.binH[1]).toBeLessThan(faith.binH[2]);
  expect(faith.binH[2]).toBeLessThanOrEqual(faith.hMax);
  expect(faith.binH[0]).toBeGreaterThanOrEqual(faith.hMin);
});

// ---- INTERLEAVED SAMPLING (§4.7). Every texel integrating the SAME 16 directions makes neighbouring texels hit
// correlated leaves, so the mip's box average smooths only 16 directions' worth of noise and the bilinear read of that
// shows facets. Each texel of a 4x4 tile gets its own rotation of the set from a fixed ordered pattern, so the 16
// texels the mip-2 box averages together cover 256 distinct directions. Fixed, never time-varying: byte-stable.
test("the tile: a Bayer ordering of 16 slots, periodic in 4, every 4x4 window holding each slot once", () => {
  expect([...FILL_TILE].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
  expect(fillTile(0, 0)).toBe(FILL_TILE[0]);
  expect(fillTile(5, 6)).toBe(fillTile(1, 2));
  expect(fillTile(-3, 9)).toBe(fillTile(1, 1));                         // a texel is never negative, but the pattern is a pure function of (i mod 4, j mod 4)
  for (const [x0, y0] of [[0, 0], [1, 3], [2, 2], [7, 5]]) {            // aligned (the mip box) or not (the bilinear read between boxes)
    const seen = new Set();
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) seen.add(fillTile(x0 + i, y0 + j));
    expect(seen.size).toBe(16);
  }
  // ordered: edge-adjacent texels are far apart in the order, which is what makes the 2x2 and 4x4 sub-boxes cover well too
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) expect(Math.abs(fillTile(i, j) - fillTile(i + 1, j))).toBeGreaterThanOrEqual(2);
  // the shader carries the SAME table, character for character
  expect(FS_FILL.includes(`int[16](${FILL_TILE.join(",")})`)).toBe(true);
});

test("a rotated set is still K weights of 1/K that sum to one, every one strictly above the horizon, and deterministic", () => {
  for (const K of [1, 2, 7, 16, 33, 64])
    for (let b = 0; b < 16; b++) {
      const d = fillDirections(K, b);
      expect(d.length).toBe(K);
      expect(Math.abs(sum(d.map((x) => x.w)) - 1)).toBeLessThan(1e-12);
      for (const x of d) { expect(x.theta).toBeGreaterThan(0); expect(x.theta).toBeLessThan(Math.PI / 2); expect(Number.isFinite(x.shift[0] + x.shift[1])).toBe(true); }
      expect(fillDirections(K, b)).toEqual(d);                          // same texel, same directions
    }
  expect(fillDirections(16, undefined)).toEqual(fillDirections(16));   // no tile = the plain set, untouched
});

test("the 16 tiles together are 256 distinct directions: cos^2 theta exactly equispaced, one rotation per slot", () => {
  const K = 16, all = [];
  for (let b = 0; b < 16; b++) for (const d of fillDirections(K, b)) all.push({ c2: Math.cos(d.theta) ** 2 });
  all.sort((p, q) => q.c2 - p.c2);
  for (const [m, d] of all.entries()) expect(d.c2).toBeCloseTo(1 - (m + 0.5) / 256, 12);   // the midpoints of 256 strata, each used once
  // and a slot is a rotation of the same set in azimuth: ray k of slot b is ray k of slot 0 turned by 2*pi*b/16
  const plain = fillDirections(K, 0);
  for (let b = 1; b < 16; b++) for (const [k, d] of fillDirections(K, b).entries()) expect(d.phi - plain[k].phi).toBeCloseTo(2 * Math.PI * b / 16, 12);
});

test("no canopy is still exactly bright through any tile", () => {
  for (let b = 0; b < 16; b++) {
    const r = fillRef(open, [0.1, 0.2], 16, { gS: G_SUN, sun: SUN, scatter: 0.9, tile: b });
    expect(r.T).toEqual([1, 1, 1]);
    expect(r.S).toEqual([0, 0, 0]);
  }
});

// A leaf-scale GAPPY stack: ~45% of every layer's 14 cm cells are open, the rest a random 0.05..0.45 transmittance.
const gappy = (seed) => stack((x, y, L) => {
  const cx = Math.floor(x * 7), cy = Math.floor(y * 7), u = (c) => hash3(seed * 4 + c, cx * 31 + L, cy) / 4294967296;
  return u(0) < 0.45 ? [1, 1, 1] : [0.05 + 0.4 * u(1), 0.05 + 0.4 * u(2), 0.05 + 0.4 * u(3)];
});
test("interleaving: the 4x4 box of rotated per-texel estimates lands at least 2x closer to a K=1024 reference than the unrotated 16 rays", () => {
  // what the mip-2 read sees is the mean over a 4x4 tile of fill texels (5 cm apart here). Unrotated, all 16 texels
  // carry the same 16 directions; rotated, they carry 256. Measured as RMS over many stacks, against the same box
  // average of a K=1024 estimate (the continuum it is an estimate of).
  const opt = { gS: G_SUN, sun: SUN, scatter: 0 };
  const N = 120, P = 0.05;
  let eU = 0, eR = 0;
  for (let seed = 0; seed < N; seed++) {
    const layers = gappy(seed), x0 = (hash3(seed, 1, 1) % 4000) / 1000 - 2, y0 = (hash3(seed, 2, 2) % 4000) / 1000 - 2;
    let ref = 0, un = 0, rot = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = [x0 + i * P, y0 + j * P];
      ref += fillRef(layers, x, 1024, opt).T[1] / 16;
      un += fillRef(layers, x, 16, opt).T[1] / 16;
      rot += fillRef(layers, x, 16, { ...opt, tile: fillTile(i, j) }).T[1] / 16;
    }
    eU += (un - ref) ** 2 / N; eR += (rot - ref) ** 2 / N;
  }
  expect(Math.sqrt(eR) * 2).toBeLessThanOrEqual(Math.sqrt(eU));
});

test("interleaving holds for the scattered light too", () => {
  const opt = { gS: G_SUN, sun: SUN, scatter: 1 };
  const N = 40, P = 0.05;
  let eU = 0, eR = 0;
  for (let seed = 0; seed < N; seed++) {
    const layers = gappy(1000 + seed), x0 = (hash3(seed, 3, 3) % 4000) / 1000 - 2, y0 = (hash3(seed, 4, 4) % 4000) / 1000 - 2;
    let ref = 0, un = 0, rot = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = [x0 + i * P, y0 + j * P];
      ref += fillRef(layers, x, 1024, opt).S[1] / 16;
      un += fillRef(layers, x, 16, opt).S[1] / 16;
      rot += fillRef(layers, x, 16, { ...opt, tile: fillTile(i, j) }).S[1] / 16;
    }
    eU += (un - ref) ** 2 / N; eR += (rot - ref) ** 2 / N;
  }
  expect(Math.sqrt(eR) * 1.8).toBeLessThanOrEqual(Math.sqrt(eU));
});

// ---- THE BOX IS NOT THE WORLD, AND THERE IS ONE SUN PER CAMERA (§4.7). The fill used to light its leaves along the REAL sun
// while the beam it was balancing walks its own path (the bulk shift: none at all in the endless park), and it read its
// hemisphere through a texture bounded by the canopy box — CLAMP_TO_EDGE, so half the glow that spreads past the box was lost
// and the border texel was repeated to the horizon. The reference now takes the sun path as an argument and reads the layers
// through a DOMAIN: wrap (the endless park: light leaving one side enters from the other), open (the finite tree: outside
// the box is open sky, over a frame padded to hold the glow) or clamp (what it used to be).
import * as FILL from "./komorebi-fill.js";

const P = 6, FRAME = { ox: -P / 2, oy: -P / 2, ext: P };
// a field periodic over the frame: integer wavenumbers, so the torus is exactly the field's own period and an analytic sum over a grid is exact
const wave = (x, y, a, b, ph) => Math.cos((2 * Math.PI * (a * (x + P / 2) + b * (y + P / 2))) / P + ph);
const tFor = (L) => (x, y) => [0, 1, 2].map((c) => 0.5 + 0.2 * wave(x, y, 1 + (L % 2), c - 1, 0.9 * L + c) + 0.1 * wave(x, y, 2, 1 - c, 0.4 * L - c));
const cFor = (L) => (x, y) => 0.65 + 0.2 * wave(x, y, 1, 1 + L, 0.5 * L) + 0.1 * wave(x, y, 2, -1, 1.3 * L);   // 0.35..0.95: one leaf over most of a texel, never past 1 — the mixture's a = min(c, 1) has a kink there, and the sums below are exact only for a field smooth enough that a lattice shift moves nothing
const K_BEAM = M_BALLISTIC(0.95);
function M_BALLISTIC(d) { return -Math.log(1 - d); }   // ballisticK without the import: the cap is not what these stacks are about
const H3 = [2, 3.5, 5];
const SUN3 = [1.2, 1.0, 0.7];
// A texel carries depth AND coverage (the bake writes both from one mask), so a layer that only SHADES — takes light out of the ray and the sun and puts none back — is
// WOOD, not a leaf with its coverage left at 0: at d > 0 a depth without coverage is an empty texel. `w` is that neutral transmittance, wrapped through the domain with the layer.
const woodOf = (L) => (x, y) => tFor(L)(x, y)[1];
const shadeSpec = () => [{ t: tFor(0), c: cFor(0) }, { t: () => [1, 1, 1], c: () => 0, w: woodOf(1) }, { t: () => [1, 1, 1], c: () => 0, w: woodOf(2) }];
const torus = (stackSpec, mode) => stackSpec.map((s, L) => {
  const dom = FILL.fillDomain({ h: H3[L], t: s.t, c: s.c }, FRAME, mode);
  return s.w ? { ...dom, w: (x, y) => FILL.fillDomain({ h: H3[L], t: (px, py) => [s.w(px, py), 1, 1] }, FRAME, mode).t(x, y)[0] } : dom;
});
const NG = 40, PITCH = P / NG;
const gridPts = Array.from({ length: NG * NG }, (_, q) => [-P / 2 + ((q % NG) + 0.5) * PITCH, -P / 2 + (Math.floor(q / NG) + 0.5) * PITCH]);
// Σ_x S(x) over the grid. `tiled` gives each texel its own slot of the 4x4 interleave, as the shader does; the plain set (every texel the same K
// rays) is what makes the translation exact, because a rotated texel shifts by its own ray and only every 4th texel shares one
const fillSum = (layers, opt, tiled = false, K = 16) => gridPts.reduce((a, x, q) => { const s = FILL.fillRef(layers, x, K, { ...opt, tile: tiled ? fillTile(q % NG, Math.floor(q / NG)) : undefined }).S; return a.map((v, c) => v + s[c]); }, [0, 0, 0]);

test("the fill frame: the canopy box itself in the endless park, padded by 3·h_max on every side for a finite tree", () => {
  expect(FILL.FILL_PAD).toBe(3);                                       // the cosine kernel's tail beyond 3h is P(cos²θ < 0.1) = 10%: named, not hidden
  expect(FILL.fillFrame(28, 8, false)).toEqual({ ox: -14, oy: -14, ext: 28 });   // wrapped: its own period
  expect(FILL.fillFrame(28, 8, true)).toEqual({ ox: -38, oy: -38, ext: 76 });     // 28 + 2·3·8, centred on the box
  const f = FILL.fillFrame(40, 5.5, true);
  expect(f.ox + f.ext / 2).toBeCloseTo(0, 12);                          // centred on the canopy
  expect(f.ext).toBeCloseTo(40 + 2 * 3 * 5.5, 12);
  const out = { ox: 0, oy: 0, ext: 0 };   // the engine asks every frame (the litter's signature): a caller's scratch is filled in place, nothing allocated
  expect(FILL.fillFrame(28, 8, true, out)).toBe(out);
  expect(out).toEqual({ ox: -38, oy: -38, ext: 76 });
});

test("the domain: wrap is the torus, open is open sky, clamp is the border — and inside the frame all three are the field", () => {
  const layer = { h: 3, t: (x, y) => [0.2 + 0.01 * (x + 3), 0.5, 0.9 - 0.01 * (y + 3)], c: (x) => 0.3 + 0.02 * (x + 3) };
  const wrap = FILL.fillDomain(layer, FRAME, "wrap"), open = FILL.fillDomain(layer, FRAME, "open"), clamp = FILL.fillDomain(layer, FRAME, "clamp");
  for (const [x, y] of [[-2.5, 1.2], [0, 0], [2.9, -2.9]]) for (const d of [wrap, open, clamp]) { expect(d.t(x, y)).toEqual(layer.t(x, y)); expect(d.c(x, y)).toBe(layer.c(x, y)); }
  const w = wrap.t(7.1, -9.4), r = layer.t(7.1 - P, -9.4 + 2 * P);
  for (let c = 0; c < 3; c++) expect(w[c]).toBeCloseTo(r[c], 12);       // wrapped into the frame by whole periods, either way
  expect(wrap.c(-3.5, 0)).toBeCloseTo(layer.c(2.5, 0), 12);
  expect(open.t(3.2, 0)).toEqual([1, 1, 1]); expect(open.c(3.2, 0)).toBe(0);   // outside: nothing there to take light out, nothing to glow
  expect(open.t(0, -9)).toEqual([1, 1, 1]);
  expect(clamp.t(9, 0)).toEqual(layer.t(3, 0)); expect(clamp.c(-9, 0)).toBe(layer.c(-3, 0));
});

test("a texel tap through the domain: wrap blends the last texel with the first, open and clamp end at the edge", () => {
  const n = 4, data = new Float32Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const o = (j * n + i) * 4; data[o] = i; data[o + 1] = j; data[o + 2] = 0; data[o + 3] = 1; }
  const f = { ox: 0, oy: 0, ext: 4 };                                   // 1 m texels, centres at i + 0.5
  expect(FILL.texelTap(data, n, f, "clamp", 1.5, 2.5).slice(0, 2)).toEqual([1, 2]);
  expect(FILL.texelTap(data, n, f, "clamp", -3, 9).slice(0, 2)).toEqual([0, 3]);       // CLAMP_TO_EDGE: the outermost texel
  expect(FILL.texelTap(data, n, f, "open", -0.1, 1.5)).toEqual([0, 0, 0, 0]);          // outside the frame: no depth, no coverage
  expect(FILL.texelTap(data, n, f, "open", 3.9, 1.5)[0]).toBe(3);                      // inside, within half a texel of the edge: the edge texel, as CLAMP gives it
  expect(FILL.texelTap(data, n, f, "wrap", 0, 1.5)[0]).toBeCloseTo(1.5, 12);           // halfway between texel 3 (left, wrapped) and texel 0
  expect(FILL.texelTap(data, n, f, "wrap", 4.5, 1.5)[0]).toBeCloseTo(FILL.texelTap(data, n, f, "wrap", 0.5, 1.5)[0], 12);
  expect(FILL.texelTap(data, n, f, "wrap", -0.5, 1.5)[0]).toBeCloseTo(FILL.texelTap(data, n, f, "wrap", 3.5, 1.5)[0], 12);
});

test("the translation identity on the torus: the bottom layer's received light IS its emitted light, to 1e-9", () => {
  // Only layer 0 emits (the layers above carry depth and no coverage, so they only shade its sun), and nothing lies below it:
  // every ray's light from it arrives undimmed. A ray from floor point x crosses the layer at x + s·h, so the sum over the
  // floor of what it receives is the sum over the layer of what it emits shifted by s·h — and on a torus a shift moves nothing.
  // Held for ANY sun path, any K, any tile: that is what makes it a bookkeeping law and not a coincidence of one stack.
  const spec = shadeSpec();
  for (const gS of [[0, 0], [0.9, -0.4], [-1.7, 2.2]]) {
    const layers = torus(spec, "wrap");
    const got = fillSum(layers, { gS, sun: SUN3, scatter: 0, k: K_BEAM });
    const want = [0, 0, 0];
    for (const y of gridPts) {                                         // M_0(y) = (T0 − Tb0)·sun·A_0, A_0 along the sun's path through the layers above (wood: it only takes light away)
      const m0 = FILL.texelMix(spec[0].t(y[0], y[1]).map((v) => -Math.log(v)), spec[0].c(y[0], y[1]), K_BEAM);
      for (let c = 0; c < 3; c++) {
        let A = 1;
        for (let m = 1; m < 3; m++) A *= spec[m].w(y[0] + gS[0] * (H3[m] - H3[0]), y[1] + gS[1] * (H3[m] - H3[0]));
        want[c] += (m0.T[c] - m0.Tb[c]) * SUN3[c] * A;
      }
    }
    for (let c = 0; c < 3; c++) { expect(want[c]).toBeGreaterThan(1); expect(Math.abs(got[c] / want[c] - 1), `gS ${gS} channel ${c}`).toBeLessThan(1e-9); }
    // the interleave is unbiased too, to the lattice's aliasing: each slot's texels are a coarser lattice (every 4th), so the identity is only as exact as the field is smooth at 4 texels
    const tiled = fillSum(layers, { gS, sun: SUN3, scatter: 0, k: K_BEAM }, true);
    for (let c = 0; c < 3; c++) expect(Math.abs(tiled[c] / want[c] - 1), `tiled, gS ${gS} channel ${c}`).toBeLessThan(1e-4);
  }
});

test("...and the box not wrapped does not close it: clamped it repeats the border, open it sees open sky past the sides", () => {
  const spec = shadeSpec();
  const gS = [0.9, -0.4], run = (mode) => fillSum(torus(spec, mode), { gS, sun: SUN3, scatter: 0, k: K_BEAM })[1];
  const wrapped = run("wrap");
  expect(Math.abs(run("clamp") / wrapped - 1)).toBeGreaterThan(0.005);  // the border texel is not the neighbouring period (a smooth field: 1%, against the wrap's 1e-9)
  expect(Math.abs(run("open") / wrapped - 1)).toBeGreaterThan(0.02);    // rays that left the box saw open sky and brought nothing back (and the sun path past the edge is unshaded)
});

test("one sun per camera: Σ S equals the beam's deficit Σ D when the fill walks the BEAM's path, and not when it walks another", () => {
  // L0 is uniform (every ray's descent through it is the same number), L1 emits, L2 only shades L1's sun. The beam reads layer L
  // at x + g·h_L, so its deficit at x is w0·w2(x+g·h2)·[T1 − Tb1](x+g·h1): the same terms as the emission with the sun
  // path A_1 read along that very g. Summed over the torus they are one number — if g is the same g.
  const U = 0.55;
  const spec = [{ t: () => [1, 1, 1], c: () => 0, w: () => U }, { t: tFor(1), c: cFor(1) }, { t: () => [1, 1, 1], c: () => 0, w: woodOf(2) }];   // L0 and L2 only shade (wood), so L1 alone emits
  const gBeam = [0.9, -0.4], gReal = [0.35, 0.8];
  const beamDeficit = (g) => {
    const D = [0, 0, 0];
    for (const x of gridPts) for (let c = 0; c < 3; c++) {
      const q = [1, 2].map((m) => [x[0] + g[0] * H3[m], x[1] + g[1] * H3[m]]);
      const m1 = FILL.texelMix(spec[1].t(...q[0]).map((v) => -Math.log(v)), spec[1].c(...q[0]), K_BEAM), w2 = spec[2].w(...q[1]);
      D[c] += (U * m1.T[c] * w2 - U * m1.Tb[c] * w2) * SUN3[c];   // what the beam gave up: Π T − Π Tb down this column
    }
    return D;
  };
  const D = beamDeficit(gBeam);
  const S = fillSum(torus(spec, "wrap"), { gS: gBeam, sun: SUN3, scatter: 0, k: K_BEAM });
  const Sreal = fillSum(torus(spec, "wrap"), { gS: gReal, sun: SUN3, scatter: 0, k: K_BEAM });
  for (let c = 0; c < 3; c++) {
    expect(D[c]).toBeGreaterThan(0.5);
    expect(Math.abs(S[c] / D[c] - 1), `channel ${c}`).toBeLessThan(1e-9);
  }
  expect(Math.abs(Sreal[1] / D[1] - 1)).toBeGreaterThan(0.01);          // the fill lit along a different sun than the beam used is a different number: the 14% the park measured
});

test("the endless park's sun path is vertical: gS = 0 lights layer i from the layers above it at the plan point the ray crossed i", () => {
  // The beam in the park has no bulk shift, so the sun a leaf is lit by is straight overhead of the leaf: A_i = Π_{m>i} tb_m(p_i), every tap at p_i.
  // Spelled out here without skyRayRef's own loop, on random stacks with coverage, for any ray.
  for (let seed = 0; seed < 300; seed++) {
    const nL = 2 + (seed % 2), k = M_BALLISTIC([0.5, 0.95][seed % 2]);
    const layers = [0, 1, 2].slice(0, nL).map((L) => ({ h: H3[L], t: (x, y) => randomField(seed)(x, y, L), c: (x, y) => 2 * randomField(seed + 1)(x, y, L)[0] }));
    const mix = (L, x, y) => FILL.texelMix(layers[L].t(x, y).map((v) => -Math.log(v)), layers[L].c(x, y), k);   // the texel's mixture: T for what the leaf passes, Tb for the beam
    const x = [(hash3(seed, 5, 0) % 4000) / 1000 - 2, (hash3(seed, 5, 1) % 4000) / 1000 - 2], s = fillDirections(7)[seed % 7].shift;
    const p = layers.map((l) => [x[0] + s[0] * l.h, x[1] + s[1] * l.h]);
    const want = [0, 0, 0], thr = [1, 1, 1];
    for (let i = 0; i < nL; i++) {
      const mi = mix(i, ...p[i]);
      for (let c = 0; c < 3; c++) {
        let A = 1;
        for (let m = i + 1; m < nL; m++) A *= mix(m, ...p[i]).Tb[c];   // layer m read AT p_i: nothing travels sideways per metre of rise
        want[c] += thr[c] * (mi.T[c] - mi.Tb[c]) * SUN3[c] * A;
        thr[c] *= mi.T[c];
      }
    }
    const got = FILL.skyRayRef(layers, x, s, [0, 0], SUN3, k).L;
    for (let c = 0; c < 3; c++) expect(got[c], `seed ${seed}`).toBeCloseTo(want[c], 12);
  }
});

// ---- THE BAKE'S WIRING: what the fill pass is handed, and what it does to the layer textures. A stub GL records the calls and a
// real makeSource supplies the very bulkShift / bulkOn the engine uses — so this holds the wiring, not a restatement of it.
import { makeBake, makeFill } from "./komorebi-bake.js";
import { makeSource } from "./komorebi-source.js";
import { MAX_LAYERS } from "./komorebi-params.js";

function bakeRig(over) {
  const calls = [];
  const gl = new Proxy({}, { get: (_t, name) => (/^[A-Z][A-Z0-9_]+$/.test(name) ? name : (...a) => { calls.push([name, ...a]); return name === "checkFramebufferStatus" ? "FRAMEBUFFER_COMPLETE" : {}; }) });
  const params = { ...DEFAULTS, canopy_fill: 1, canopy_extent_m: 28, layer_count: 3, canopy_base_height_m: 5, canopy_thickness_m: 3, sun_elevation_deg: 36, sun_azimuth_deg: 30, ...over };
  const { bulkShift, bulkOn, layerHeights } = makeSource({ gl, params, perf: {}, trans: {}, src: {}, effCloud: () => 0 });
  const U = { layers: Array.from({ length: MAX_LAYERS }, (_, i) => `layer${i}`) };
  for (const k of ["origin", "extent", "frameOrigin", "frameExtent", "sunPath", "open", "sun", "heights", "layerCount", "ray", "turn", "count", "scatter", "beamK"]) U[k] = k;
  const fill = { tex: [null, null], res: 0, ready: false, sig: new Float64Array(16), K: 0, rays: null };
  const hub = { gl, params, motion: {}, src: {}, faith: { binH: new Float32Array(MAX_LAYERS) }, sky: {}, U, fill, bakeFBO: {}, faithFBO: {}, fillFBO: {}, emptyVAO: {}, progBake: {}, progFaith: {}, progFaithSeg: {}, progFAcc: {},
    bakeRes: () => 256, faithfulOn: () => false, layerTex: Array.from({ length: MAX_LAYERS }, (_, i) => ({ layer: i })), makeLayerTexture: () => ({}), fail: (m) => { throw new Error(m); },
    fillFor: () => ({ prog: {}, U }), bulkShift, bulkOn, layerHeights };
  const bake = makeBake(hub);
  Object.assign(hub, { bakeLayers: bake.bakeLayers, fillFrameNow: bake.fillFrameNow });   // what the engine puts on the hub for the fill to reach
  makeFill(hub).bakeFill(false);
  const draw = calls.findIndex((c) => c[0] === "drawArrays");
  const uni = (name) => calls.filter((c) => c[0].startsWith("uniform") && c[1] === name).map((c) => c.slice(2));
  const wraps = (which) => calls.map((c, i) => [c, i]).filter(([c]) => c[0] === "texParameteri" && c[2] === "TEXTURE_WRAP_S" && c[3] === which).map(([, i]) => i);
  return { calls, draw, uni, wraps, fill, params };
}

test("the park wraps and the finite tree pads: the wrap is selected by !bulkOn, on the layer textures, for the fill pass only", () => {
  const park = bakeRig({});
  expect(park.params.standing_scene || park.params.receiver).toBeFalsy();
  const rep = park.wraps("REPEAT"), clamp = park.wraps("CLAMP_TO_EDGE");
  expect(rep.length).toBe(3);                                            // one per active layer, set before the draw...
  expect(rep.every((i) => i < park.draw)).toBe(true);
  expect(clamp.filter((i) => i > park.draw).length).toBe(3);             // ...and put back after it: transport reads the same textures CLAMPED, and every shipped look must stay byte-identical
  expect(park.uni("open")).toEqual([[0]]);                               // wrapped: no open sky beyond the box (the texture repeats)
  expect(park.uni("sunPath")).toEqual([[0, 0]]);                         // the beam has no bulk shift in the endless park
  expect(park.uni("frameOrigin")).toEqual([[-14, -14]]);                 // the frame is the box
  expect(park.uni("frameExtent")).toEqual([[28, 28]]);
  expect([park.fill.ox, park.fill.oy, park.fill.ext]).toEqual([-14, -14, 28]);   // what the receivers read it by

  for (const over of [{ standing_scene: true }, { receiver: 1 }, { receiver: 2 }]) {
    const tree = bakeRig(over);
    expect(tree.wraps("REPEAT").length, JSON.stringify(over)).toBe(0);   // a finite tree has open sky around it: its taps stay open and CLAMPed
    expect(tree.uni("open")).toEqual([[1]]);
    const el = Math.max(36, 6) * DEG, az = 30 * DEG, cot = Math.cos(el) / Math.sin(el);
    const [gx, gy] = tree.uni("sunPath")[0];
    expect(gx).toBeCloseTo(cot * Math.cos(az), 12);                      // the BEAM's own bulk shift, not the sun's direction
    expect(gy).toBeCloseTo(cot * Math.sin(az), 12);
    const hMax = 5 + 3, ext = 28 + 2 * 3 * hMax;                         // the highest layer sits at base + thickness
    expect(tree.uni("frameExtent")).toEqual([[ext, ext]]);
    expect(tree.uni("frameOrigin")).toEqual([[-ext / 2, -ext / 2]]);
    expect([tree.fill.ox, tree.fill.oy, tree.fill.ext]).toEqual([-ext / 2, -ext / 2, ext]);
    expect(tree.uni("origin")).toEqual([[-14, -14]]);                    // the LAYERS are still the canopy box: only the fill's own frame grew
  }
});

test("the fill's signature carries bulkOn, so toggling standing_scene re-bakes the frame it is read over", () => {
  const a = bakeRig({}).fill.sig, b = bakeRig({ standing_scene: true }).fill.sig;
  expect(Array.from(a)).not.toEqual(Array.from(b));
});

test("the fill's sun path is an argument of the shared ray, never read off the sun: the sky view passes the real direction, the fill the beam's", () => {
  const code = (s) => s.replace(/\/\/.*$/gm, "");
  expect(/void skyRay\(vec2 pL0, vec2 pL1, vec2 pL2, vec2 pL3, vec2 gS,/.test(GLSL_SKY_RAY)).toBe(true);
  expect(code(GLSL_SKY_RAY).includes("uSunDir")).toBe(false);          // nothing in the shared ray looks at the sun itself any more
  expect(FS_FILL.includes("uniform vec2  uFillG;")).toBe(true);
  expect(code(FS_FILL).includes("uSunDir")).toBe(false);               // the fill pass has no real sun to walk
  expect(FS_FILL.includes("skyRay(x + s*uLayerHeight[0], x + s*uLayerHeight[1], x + s*uLayerHeight[2], x + s*uLayerHeight[3], uFillG, scatter, uFillOpen, false, uFillBeamK, T, Tb, Lsc);")).toBe(true);
  expect(buildTransport("sky").includes("skyRay(pL0, pL1, pL2, pL3, uSunDir.xy / max(uSunDir.z, 0.05), uSkyScatter > 0.0 || uBeamK > 0.0, true, true, uBeamK, T, Tsrc, Lsc);")).toBe(true);   // the sky has no beam: it keeps the sun it looks at
});

test("every fill READ is over the fill's own frame, not the canopy's: the floor, the cloth and the tent", () => {
  for (const cam of ["floor", "cloth", "enclosure"]) {
    const src = buildTransport(cam);
    expect(src.includes("uniform vec2  uFillOrigin;"), cam).toBe(true);
    expect(src.includes("uniform vec2  uFillExtent;"), cam).toBe(true);
    const reads = src.match(/textureLod\(uFill[TS], [^;]*?, FILL_LOD\)/g);
    expect(reads.length, cam).toBeGreaterThan(0);
    for (const r of reads) { expect(r.includes("uFillOrigin") && r.includes("uFillExtent") || r.includes("fuv"), `${cam}: ${r}`).toBe(true); expect(r.includes("uCanopy"), `${cam}: ${r}`).toBe(false); }
  }
  expect(buildTransport("floor").includes("vec2 fuv = (world-uFillOrigin)/uFillExtent;")).toBe(true);
  expect(Object.keys(TRANSPORT_GROUPS.fill.locs).sort()).toEqual(["canopyFill", "fillExtent", "fillOrigin", "fillS", "fillT"]);
});
