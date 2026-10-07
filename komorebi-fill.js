// ============================================================================
// The sky fill's CPU half (spec §4.7, "What the shade is lit by"). The shade between the dapples is lit by the
// skylight that came THROUGH the canopy and by sunlight the lit leaves scatter downward:
//
//     E_shade(x) = uAmbient · T̄_sky(x) + ∫ L_scat(x, ω) cosθ dω
//
// and the second integrand IS the sky view's scattered radiance along a ray (§4.9). The fill shader (FS_FILL) evaluates both
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

// THE BOX IS NOT THE WORLD (§4.7). The layers are baked over the canopy box, and a hemisphere ray from a floor point leaves it
// within a few metres of height — an 8 m layer at 60° is 14 m sideways. What a tap outside the box reads is the question the
// first fill answered with CLAMP_TO_EDGE: the border texel, repeated to the horizon, which lost about half of the glow spreading
// past the box. Two honest answers, chosen by whether the look has a beam bulk shift (bulkOn: standing_scene or a receiver):
//   'wrap'  the ENDLESS PARK. The beam has no bulk shift because the canopy is a field without an edge (§4.8), so the box is one
//           period of it: light leaving one side enters from the other (REPEAT on the layer textures for the fill pass).
//   'open'  the FINITE TREE. Outside the box is open sky (t = 1, nothing to glow), over a frame PADDED so the glow can decay across
//           the floor instead of being cut at the box: 3·h_max on every side, since a cosine-weighted ray travels beyond 3 h
//           with probability P(cos²θ < 1/10) = 10%, and that is the tail the padding still gives up.
//   'clamp' what it was; kept so the reference can say what the old box did.
// The frame is the plan square the fill is BAKED over (and every receiver reads it by): origin (ox, oy), side ext.
export const FILL_PAD = 3;
export function fillFrame(E, hMax, bulkOn){
  const pad = bulkOn ? FILL_PAD * hMax : 0;
  return { ox: -E / 2 - pad, oy: -E / 2 - pad, ext: E + 2 * pad };
}

// A layer read through a domain: the layer's t / c closures are defined inside `frame` (the canopy box); outside it a tap reads
// by `mode`. Returns a layer of the same shape (c only if it had one), so skyRayRef / fillRef run on it unchanged.
const wrapInto = (v, o, ext) => { const r = (v - o) % ext; return o + (r < 0 ? r + ext : r); };
export function fillDomain(layer, frame, mode){
  const { ox, oy, ext } = frame, ex = ox + ext, ey = oy + ext;
  const outside = (x, y) => x < ox || x > ex || y < oy || y > ey;
  const at = (f, none) => (x, y) => {
    if(mode === 'wrap') return f(wrapInto(x, ox, ext), wrapInto(y, oy, ext));
    if(mode === 'clamp') return f(Math.min(Math.max(x, ox), ex), Math.min(Math.max(y, oy), ey));
    return outside(x, y) ? none : f(x, y);   // 'open'
  };
  const out = { ...layer, t: at(layer.t, [1, 1, 1]) };
  if(layer.c) out.c = at(layer.c, 0);
  return out;
}

// A bilinear tap of a baked layer texture (n×n RGBA, texel centres at (i+½)/n over `frame`) through the same domain, as the GPU
// does it: CLAMP_TO_EDGE inside the box ('clamp', and 'open' within half a texel of its edge), REPEAT ('wrap'), or nothing at all
// outside ('open': rgb depth 0, coverage 0). Returns [r, g, b, a] = depth and coverage, still in the texture's own units.
export function texelTap(data, n, frame, mode, x, y){
  let u = (x - frame.ox) / frame.ext, v = (y - frame.oy) / frame.ext;
  if(mode === 'open' && (u < 0 || u > 1 || v < 0 || v > 1)) return [0, 0, 0, 0];
  let fx, fy, x0, y0, x1, y1;
  if(mode === 'wrap'){
    u -= Math.floor(u); v -= Math.floor(v);
    fx = u * n - 0.5; fy = v * n - 0.5;
    x0 = Math.floor(fx); y0 = Math.floor(fy);
    x1 = (x0 + 1 + n) % n; y1 = (y0 + 1 + n) % n; x0 = (x0 + n) % n; y0 = (y0 + n) % n;
    fx -= Math.floor(fx); fy -= Math.floor(fy);
  } else {
    fx = Math.min(Math.max(u * n - 0.5, 0), n - 1); fy = Math.min(Math.max(v * n - 0.5, 0), n - 1);
    x0 = Math.floor(fx); y0 = Math.floor(fy); x1 = Math.min(x0 + 1, n - 1); y1 = Math.min(y0 + 1, n - 1);
    fx -= x0; fy -= y0;
  }
  const a = (y0 * n + x0) * 4, b = (y0 * n + x1) * 4, c = (y1 * n + x0) * 4, d = (y1 * n + x1) * 4, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  return [data[a] * w00 + data[b] * w10 + data[c] * w01 + data[d] * w11, data[a + 1] * w00 + data[b + 1] * w10 + data[c + 1] * w01 + data[d + 1] * w11,
    data[a + 2] * w00 + data[b + 2] * w10 + data[c + 2] * w01 + data[d + 2] * w11, data[a + 3] * w00 + data[b + 3] * w10 + data[c + 3] * w01 + data[d + 3] * w11];
}

// leafHue: a transmittance normalized to unit peak — the spectrum with its brightness divided out (§3.5's idiom).
export const leafHue = (t) => { const m = Math.max(t[0], t[1], t[2], 1e-4); return [t[0] / m, t[1] / m, t[2] / m]; };

// A LEAF IS NOT A WINDOW (§4.5). A layer texel holds the leaf's true optical depth τ in rgb and its COVERAGE c in alpha (Σ of
// the leaf masks over it), so the one texel carries both transmittances. t = e^−τ is all the light the leaf passes — hue,
// skylight, the light it sends on downward. The BALLISTIC share, the part that still travels as a beam, is tb = e^(−τ − k·c): k
// is neutral depth per unit coverage (math.js ballisticK), identical in every channel, so tb is t scaled by one number and
// has t's own hue. What is left, t − tb = t·(1 − e^(−k·c)), is the diffuse light the leaf emits; it is never negative and
// never more than t. k = 0 hands the input back (the gate: the same array, no arithmetic), like leafTau's s = 0.
export function ballistic(t, c, k){
  if(!(k > 0)) return t;
  const f = Math.exp(-k * c);
  return [t[0] * f, t[1] * f, t[2] * f];
}

// What ONE leaf leaves in a layer texel, as the bake writes it (VS_BAKE/FS_BAKE): rgb = its depth, which the grove has already
// scaled by the marginal fade (§5.3), and alpha = its coverage with that SAME fade (iFade), both × the leaf mask at this
// texel (`edge`) and the grove's crossfade share (`grove`, uCoverage). Alpha carrying the fade is what lets the ballistic
// shadow fade with its leaf: k·alpha is then a depth that goes to 0 as f does, where coverage alone would keep k·edge of
// beam-dimming on a leaf that is not there yet and pop it in.
export const leafTexel = (tau, fade, edge = 1, grove = 1) => ({ rgb: tau.map((v) => v * fade * grove * edge), a: edge * fade * grove });

// ONE ray through the layer stack — the sky view's per-ray formula (§4.9), line for line with GLSL_SKY_RAY.
//   layers: [{ h, t(x, y) -> [r,g,b], c(x, y) -> coverage }], lowest first; t is the layer's FOLIAGE transmittance at a plan
//   point, c its coverage (read only when k > 0)
//   p: where the ray starts (plan); shift: its plan travel per metre of rise; gS: the SUN PATH's, the same per-metre travel — the BEAM's
//   (the bulk shift: [0, 0] in the endless park) for the fill, the real sun's for the sky view, which has no beam (§4.7, one sun per camera)
//   k: the beam's neutral depth (ballisticK). 0 runs the P0b sum, ŝ-weighted. k > 0 is the split (§4.5): each layer emits the light its
//   beam lost, t − tb, in its own hue (no ŝ, no albedo), lit by the sun's BALLISTIC path to it, A_L = Π_{M>L} tb_M, and
//   carried down through the layers below by their TRUE t. The ray itself still passes the true t: the skylight needs no split.
//   returns { T: Π t_L (what the ray passes), L: P0b: Σ thr_L (1 − t_L) ŝ_L (sun·A_L) — BEFORE the albedo; split: Σ thr_L (t_L − tb_L) (sun·A_L) }
//   No skylight in L either way: its passage is T
export function skyRayRef(layers, p, shift, gS, sun, k = 0){
  const n = layers.length, split = k > 0;
  const at = layers.map((l) => [p[0] + shift[0] * l.h, p[1] + shift[1] * l.h]);
  const t = layers.map((l, L) => l.t(at[L][0], at[L][1]));
  const T = [1, 1, 1], L = [0, 0, 0], thr = [1, 1, 1];
  if(gS == null){ for(let i = 0; i < n; i++) for(let c = 0; c < 3; c++) T[c] *= t[i][c]; return { T, L }; }   // no albedo asked: the scatter branch is skipped, as the shader skips it
  for(let i = 0; i < n; i++){
    // the sun's path down to layer i: what the layers above it let through, read along g from where THIS ray crosses i
    const A = [1, 1, 1];
    for(let m = i + 1; m < n; m++){
      const dh = layers[m].h - layers[i].h, x = at[i][0] + gS[0] * dh, y = at[i][1] + gS[1] * dh;
      const a = split ? ballistic(layers[m].t(x, y), layers[m].c(x, y), k) : layers[m].t(x, y);   // the beam only: a leaf's diffuse light does not travel on as one
      for(let c = 0; c < 3; c++) A[c] *= a[c];
    }
    if(split){
      const e = 1 - Math.exp(-k * layers[i].c(at[i][0], at[i][1]));
      for(let c = 0; c < 3; c++){
        L[c] += thr[c] * t[i][c] * e * (sun[c] * A[c]);
        thr[c] *= t[i][c];
        T[c] *= t[i][c];
      }
      continue;
    }
    const s = leafHue(t[i]);
    for(let c = 0; c < 3; c++){
      L[c] += thr[c] * (1 - t[i][c]) * s[c] * (sun[c] * A[c]);
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
// texel's slot in the interleaving (fillTile), as the shader derives it from its own texel. k = the beam's neutral depth:
// above 0 the albedo is OFF — the P0b proxy was an authored stand-in for exactly the diffuse light k measures, so counting
// both would count it twice — and S is the emitted light as it is, in the leaf's own colour, at the level d·T.
export function fillRef(layers, x, K, { gS, sun, scatter, tile, k = 0 }){
  const T = [0, 0, 0], S = [0, 0, 0], tau = [0, 0, 0], split = k > 0;
  for(const d of fillDirections(K, tile)){
    const r = skyRayRef(layers, x, d.shift, split || scatter > 0 ? gS : null, sun, k);   // scatter 0 skips the whole sun-path branch, exactly as FS_FILL does
    for(let c = 0; c < 3; c++){ T[c] += r.T[c]; S[c] += r.L[c]; tau[c] -= Math.log(Math.max(r.T[c], 1e-300)); }
  }
  return { T: T.map((v) => v / K), S: S.map((v) => (v / K) * (split ? 1 : scatter)), meanTau: tau.map((v) => v / K) };
}
