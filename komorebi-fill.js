// ============================================================================
// The sky fill's CPU half (spec §4.7, "What the shade is lit by"). The shade between the dapples is lit by the
// skylight that came THROUGH the canopy and by sunlight the lit leaves scatter downward:
//
//     E_shade(x) = uAmbient · T̄_sky(x) + ∫ L_scat(x, ω) cosθ dω
//
// and the second integrand IS the sky view's radiance along a ray (§4.9). The fill shader (FS_FILL) evaluates both
// over K fixed, cosine-weighted directions; these are the same directions and the same per-ray sum as pure
// functions, so the laws (weights, the Jensen direction, the energy bound) are held by `bun test` without a GPU.
// The shader is the authority on the numbers; the GLSL both cameras run (GLSL_SKY_RAY) is what keeps the sky view
// and the fill from drifting, and test-gl's fill check holds this file to the shader on real layers.
// ============================================================================

export const FILL_GOLDEN = Math.PI * (3 - Math.sqrt(5));   // the golden angle, the source cloud's own azimuth step (§4.4)
const TAU = 2 * Math.PI;

// INTERLEAVED SAMPLING. If every fill texel integrated the SAME K directions, neighbouring texels would hit correlated
// leaves: the mip the receiver reads would average K directions' worth of noise however many texels it spans, and the
// bilinear read of that shows facets. So each texel of a 4x4 tile takes its own rotation of the set, by its slot in a
// fixed Bayer ordering — and the 16 texels one tile (a mip-2 box) averages together cover 16·K distinct directions (256
// at the default); the receiver reads mip 3, four tiles. The slot is a pure function of (i mod 4, j mod 4): a frame is
// the same frame, and no noise anywhere.
// Slot b rotates the whole set by 2π·b/16 in azimuth and shifts every ray's cos²θ by a sub-stratum, (15−b + ½)/16 − ½
// of one stratum (always strictly inside it, so θ stays below 90°): across the 16 slots each stratum is cut into 16, and
// the combined cos²θ are exactly the 16·K stratum midpoints.
export const FILL_TILE = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];   // slot of texel (i, j) at index (i&3) + 4·(j&3); GLSL carries this same table
export const fillTile = (i, j) => FILL_TILE[(i & 3) + 4 * (j & 3)];
const tileTurn = (b) => TAU * b / 16;                  // the slot's azimuth rotation
const tileShift = (b) => ((15 - b) + 0.5) / 16 - 0.5;  // the slot's sub-stratum, in strata

// The k-th of K directions of a cosine-weighted hemisphere, stratified in cos²θ: cos²θ_k = 1 − (k + ½ + shift)/K. A
// cosine-weighted pdf makes cos²θ uniform, so every stratum carries the same measure and each direction weighs
// exactly 1/K. The azimuth steps by the golden angle so neighbouring strata never line up. `tile` is the texel's
// slot (fillTile), or undefined for the plain set. `shift` is the plan travel per metre of rise, tanθ·(cosφ, sinφ).
export function fillDirections(K, tile){
  const out = [], turn = tile == null ? 0 : tileTurn(tile), sub = tile == null ? 0 : tileShift(tile);
  for(let k = 0; k < K; k++){
    const c2 = 1 - (k + 0.5 + sub) / K, theta = Math.acos(Math.sqrt(c2)), phi = k * FILL_GOLDEN + turn, tn = Math.tan(theta);
    out.push({ theta, phi, w: 1 / K, shift: [tn * Math.cos(phi), tn * Math.sin(phi)] });
  }
  return out;
}

// What the shader takes, flat and in the float32 it is uploaded as. NO TRIG ON THE GPU: GLSL ES promises only ~2⁻¹¹
// absolute error from sin/cos, and a ray's plan shift is tanθ·h metres long (tens of metres near the horizon), so a few
// 1e-4 of angle is centimetres on the floor — more than a leaf's edge. So the unit vectors are made here, in float64:
//   fillRays:  per ray of the PLAIN set, (cos²θ_k, cosφ_k, sinφ_k)
//   fillTurns: per slot b, (cos, sin) of its azimuth rotation 2π·b/16
// and the shader applies the texel's slot itself (it knows its own texel): rotate the unit vector by the slot's turn,
// shift cos²θ by the slot's sub-stratum, scale by tanθ = √((1 − cos²θ)/cos²θ). Only a sqrt and multiplies.
export function fillRays(K){
  const out = new Float32Array(3 * K);
  fillDirections(K).forEach((d, k) => { out[3 * k] = Math.cos(d.theta) ** 2; out[3 * k + 1] = Math.cos(d.phi); out[3 * k + 2] = Math.sin(d.phi); });
  return out;
}
export function fillTurns(){
  const out = new Float32Array(32);
  for(let b = 0; b < 16; b++){ out[2 * b] = Math.cos(tileTurn(b)); out[2 * b + 1] = Math.sin(tileTurn(b)); }
  return out;
}

// leafHue: a transmittance normalized to unit peak — the spectrum with its brightness divided out (§3.5's idiom).
const hue = (t) => { const m = Math.max(t[0], t[1], t[2], 1e-4); return [t[0] / m, t[1] / m, t[2] / m]; };

// ONE ray through the layer stack — the sky view's per-ray formula (§4.9), line for line with GLSL_SKY_RAY.
//   layers: [{ h, t(x, y) -> [r,g,b] }], lowest first; t is the layer's FOLIAGE transmittance at a plan point
//   p: where the ray starts (plan); shift: its plan travel per metre of rise; gS: the sun's, the same
//   returns { T: Π t_L (what the ray passes), L: Σ thr_L (1 − t_L) ŝ_L (sun·A_L + amb) } — L BEFORE the albedo
export function skyRayRef(layers, p, shift, gS, sun, amb){
  const n = layers.length;
  const at = layers.map((l) => [p[0] + shift[0] * l.h, p[1] + shift[1] * l.h]);
  const t = layers.map((l, L) => l.t(at[L][0], at[L][1]));
  const T = [1, 1, 1], L = [0, 0, 0], thr = [1, 1, 1];
  if(gS == null){ for(let i = 0; i < n; i++) for(let c = 0; c < 3; c++) T[c] *= t[i][c]; return { T, L }; }   // no albedo asked: the scatter branch is skipped, as the shader skips it
  for(let i = 0; i < n; i++){
    // the sun's path down to layer i: what the layers above it let through, read along g from where THIS ray crosses i
    const A = [1, 1, 1];
    for(let m = i + 1; m < n; m++){
      const dh = layers[m].h - layers[i].h, a = layers[m].t(at[i][0] + gS[0] * dh, at[i][1] + gS[1] * dh);
      for(let c = 0; c < 3; c++) A[c] *= a[c];
    }
    const s = hue(t[i]);
    for(let c = 0; c < 3; c++){
      L[c] += thr[c] * (1 - t[i][c]) * s[c] * (sun[c] * A[c] + amb[c]);
      thr[c] *= t[i][c];
      T[c] *= t[i][c];
    }
  }
  return { T, L };
}

// The fill at plan point x: the mean of K rays. Both sums are DIVIDED by K (not scaled by 1/K), so K rays of exactly
// 1 sum to exactly K and divide to exactly 1 — "no canopy" is exactly bright for any K, as it is in the shader.
// The mean is of TRANSMITTANCE, never of optical depth: T is Σ_k Π_L t_kL, and `meanTau` (the veil that mean tau
// would give) is returned only so a test can hold the Jensen gap between the two. scatter = the leaves' albedo; tile = the
// texel's slot in the interleaving (fillTile), as the shader derives it from its own texel.
export function fillRef(layers, x, K, { gS, sun, amb, scatter, tile }){
  const T = [0, 0, 0], S = [0, 0, 0], tau = [0, 0, 0];
  for(const d of fillDirections(K, tile)){
    const r = skyRayRef(layers, x, d.shift, scatter > 0 ? gS : null, sun, amb);   // scatter 0 skips the whole sun-path branch, exactly as FS_FILL does
    for(let c = 0; c < 3; c++){ T[c] += r.T[c]; S[c] += r.L[c]; tau[c] -= Math.log(Math.max(r.T[c], 1e-300)); }
  }
  return { T: T.map((v) => v / K), S: S.map((v) => (v / K) * scatter), meanTau: tau.map((v) => v / K) };
}
