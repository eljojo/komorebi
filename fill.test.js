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
import { FS_FILL } from "./komorebi-shaders.js";
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

test("the sun's unit direction is one helper: the sky view's seen source and the fill's sun path read the same vector", () => {
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
