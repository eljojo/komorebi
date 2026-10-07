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
// and the fill from drifting, and test-gl's fill check holds this file to the shader on real layers (and its sky check the look-up half: wood read, the beam's T_src, the lantern's glow).
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

// A TEXEL IS A MIXTURE, NOT A SLAB (§4.5). A layer texel holds Σ τ_i·cov_i in rgb and Σ cov_i in alpha: the bake ADDS, which is exact for leaves
// that fill the texel and stack, and at an edge Jensen-dark if the pair is read as a slab of depth τ (t = e^−τ): a texel 30% under a leaf of
// depth 2.8 is 70% open sky and 30% dark leaf (T 0.72), not a thin bright leaf of depth 0.84 (t 0.43). At d > 0 every reader reconstructs the
// mixture from the same two numbers, with a = min(c, 1) the leaf AREA of the texel:
//     τ̄ = τ/a        the representative leaf's depth: exact for one leaf, fade-invariant (a leaf at fade f is the same leaf over f of the area),
//                    and bilinear-safe (the pair interpolates as a coverage-weighted mean of the leaves' depths, never a blend toward 0)
//     κ = k·c/a      k per leaf; c/a leaves deep where leaves stack (a = 1: κ = k·c)
//     T  = (1 − a) + a·e^−τ̄          what the texel truly passes: the hue, the skylight, the light a leaf sends on downward
//     Tb = (1 − a) + a·e^(−τ̄ − κ)    the BALLISTIC share, the part that still travels as a beam (k is neutral depth, math.js ballisticK)
//     emit = T − Tb                  the diffuse light the leaf sends on, per unit of its own area × a: the gap emits nothing
// Exact for one leaf at any c ≤ 1, and for any number of leaves stacked over the whole texel (c = 2: T = T1·T2, Tb = T1·T2·(1−d)²); between, where a
// second leaf only partly overlaps, it is a bounded slab residue (luminance of the emission within 15% where one leaf covers the texel and another's
// edge crosses it; two edges inside ONE texel are outside it). Emit ≡ T − Tb by construction, so the telescoping sums close exactly. A texel with
// c < 1e-4 is empty: T = Tb = 1. k ≤ 0 is no split: Tb IS T (the same array) and nothing is emitted. At c ≥ 1, T and Tb are the old slab to the bit.
// d = 0 never calls this: its soft edges stay depth-averaged, a named approximation kept for byte-identity (§4.5).
// `tau` is the texel's rgb depth as the bake wrote it (Σ τ·cov), the same numbers GLSL_TEXEL_MIX is handed.
export function texelMix(tau, c, k){
  if(!(c >= 1e-4)){ const T = [1, 1, 1]; return { T, Tb: T }; }
  const a = Math.min(c, 1), T = [0, 1, 2].map((ch) => (1 - a) + a * Math.exp(-tau[ch] / a));
  if(!(k > 0)) return { T, Tb: T };
  const kappa = k * c / a;
  return { T, Tb: [0, 1, 2].map((ch) => (1 - a) + a * Math.exp(-tau[ch] / a - kappa)) };
}

// The BEAM through one texel (§4.5): Tb of the mixture, from the transmittance t a layer closure hands (the texture holds τ = −ln t). k = 0 hands
// the input back (the gate: the same array, no arithmetic), like leafTau's s = 0. NOT t·e^(−k·c): that slab is the Jensen-dark halo; and
// t − ballistic(t, c, k) is not the emission either, because the sky a partial texel passes is its mixture T, not t.
export function ballistic(t, c, k){
  if(!(k > 0)) return t;
  return texelMix(t.map((v) => -Math.log(v)), c, k).Tb;
}

// What ONE leaf leaves in a layer texel, as the bake writes it (VS_BAKE/FS_BAKE): rgb = its depth, which the grove has already
// scaled by the marginal fade (§5.3), and alpha = its coverage with that SAME fade (iFade), both × the leaf mask at this
// texel (`edge`) and the grove's crossfade share (`grove`, uCoverage). Alpha carrying the fade is what lets the ballistic
// shadow fade with its leaf: k·alpha is then a depth that goes to 0 as f does, where coverage alone would keep k·edge of
// beam-dimming on a leaf that is not there yet and pop it in.
export const leafTexel = (tau, fade, edge = 1, grove = 1) => ({ rgb: tau.map((v) => v * fade * grove * edge), a: edge * fade * grove });

// ONE ray through the layer stack — the sky view's per-ray formula (§4.9), line for line with GLSL_SKY_RAY.
//   layers: [{ h, t(x, y) -> [r,g,b], c(x, y) -> coverage, w?(x, y) -> wood }], lowest first; t is the layer's FOLIAGE transmittance at
//   a plan point (the texture's e^−τ), c its coverage (read only when k > 0), w the layer-stamped WOOD's transmittance there (neutral: one number for all
//   three channels). A layer with no w is read with no wood — what the fill does (readWood false: its hemisphere ignores wood by
//   design); the sky camera's layers carry it.
//   p: where the ray starts (plan); shift: its plan travel per metre of rise; gS: the SUN PATH's, the same per-metre travel — the BEAM's
//   (the bulk shift: [0, 0] in the endless park) for the fill, the real sun's for the sky view, which has no beam (§4.7, one sun per camera)
//   k: the beam's neutral depth (ballisticK). 0 runs the P0b sum, ŝ-weighted, on the slab t. k > 0 is the split (§4.5), and every texel is read as a
//   MIXTURE of leaf and gap (texelMix): the layer passes T (the sky, the hue, what the glow descends through), its beam only Tb, and it emits the light
//   its beam lost, T − Tb, in its own hue (no ŝ, no albedo), lit by the sun's BALLISTIC path to it, A_L = Π_{M>L} Tb_M·w_M, and
//   carried down through the layers below by their TRUE T (and the wood: wood blocks the glow, it never makes any).
//   The ray itself still passes the true T: the skylight needs no split — and no k moves it.
//   returns { T: Π T_L·w_L (what the ray passes), Tb: Π Tb_L·w_L (what the BEAM passes — the sun's disk, seen: a leaf kills it; = T at k = 0),
//             L: P0b: Σ thr_L (1 − t_L) ŝ_L (sun·A_L) — BEFORE the albedo; split: the glow Σ thr_L (T_L − Tb_L) (sun·A_L) }
//   No skylight in L either way: its passage is T
export function skyRayRef(layers, p, shift, gS, sun, k = 0){
  const n = layers.length, split = k > 0;
  const wood = (l, x, y) => (l.w ? l.w(x, y) : 1);   // a layer with no wood texture reads as clear
  const at = layers.map((l) => [p[0] + shift[0] * l.h, p[1] + shift[1] * l.h]);
  const mixAt = (l, px, py) => texelMix(l.t(px, py).map((v) => -Math.log(v)), l.c(px, py), k);   // the texture holds τ and the closure hands t: τ back, ulp for ulp
  const mix = split ? layers.map((l, L) => mixAt(l, at[L][0], at[L][1])) : null;
  const t = split ? mix.map((m) => m.T) : layers.map((l, L) => l.t(at[L][0], at[L][1]));
  const w = layers.map((l, L) => wood(l, at[L][0], at[L][1]));
  const x = layers.map((l, L) => (l.w ? [t[L][0] * w[L], t[L][1] * w[L], t[L][2] * w[L]] : t[L]));   // what the RAY loses: leaves × wood
  const T = [1, 1, 1], L = [0, 0, 0], thr = [1, 1, 1], Tb = [1, 1, 1];
  for(let i = 0; i < n; i++) for(let c = 0; c < 3; c++) T[c] *= x[i][c];
  if(split) for(let i = 0; i < n; i++){
    const tb = mix[i].Tb;   // the beam through this layer's mixture, in the leaf's own hue
    for(let c = 0; c < 3; c++) Tb[c] *= layers[i].w ? tb[c] * w[i] : tb[c];
  } else for(let c = 0; c < 3; c++) Tb[c] = T[c];
  if(gS == null) return { T, Tb, L };   // no albedo asked: the scatter branch is skipped, as the shader skips it
  for(let i = 0; i < n; i++){
    // the sun's path down to layer i: what the layers above it let through, read along g from where THIS ray crosses i
    const A = [1, 1, 1];
    for(let m = i + 1; m < n; m++){
      const dh = layers[m].h - layers[i].h, px = at[i][0] + gS[0] * dh, py = at[i][1] + gS[1] * dh;
      const a = split ? mixAt(layers[m], px, py).Tb : layers[m].t(px, py);   // the beam only: a leaf's diffuse light does not travel on as one
      const wm = wood(layers[m], px, py);                                      // ...and a twig shadows a leaf exactly as another leaf does
      for(let c = 0; c < 3; c++) A[c] *= layers[m].w ? a[c] * wm : a[c];
    }
    if(split){
      for(let c = 0; c < 3; c++){
        L[c] += thr[c] * (mix[i].T[c] - mix[i].Tb[c]) * (sun[c] * A[c]);   // the leaf's foliage alone: wood is in thr and A, never in the emission
        thr[c] *= x[i][c];
      }
      continue;
    }
    const s = leafHue(t[i]);
    for(let c = 0; c < 3; c++){
      L[c] += thr[c] * (1 - t[i][c]) * s[c] * (sun[c] * A[c]);
      thr[c] *= x[i][c];
    }
  }
  return { T, Tb, L };
}

// THE SKY VIEW'S EYE RAY, composed (§4.9): the sky camera's whole per-pixel sum, line for line with GLSL_T_SKY_CAMERA. `wood` is the
// analytic occluder's transmittance (trunk and main limbs, one neutral number along this ray: the camera's loop of `T *= e`),
// `ambient` is uAmbient·SKY_SKY_GAIN, `disk` the sampler's angular radiance at this ray (core / halo / moon, L), `skyScatter` the
// retired proxy's knob. k = 0 is the sky camera as it was: (ambient + sun·L)·T + sky_scatter·Lsc, character for character. Above 0 the
// leaf is a lantern: the sky is seen through every leaf (T), the disk through none that covers it (Tsrc), and the light a leaf took out
// of the line of sight comes back as its glow. srcSeen is the leaked disk ALONE and is added last, so a later phase can take it out of
// the sum and route it somewhere of its own (the eye). `proxy` is the sky_scatter term (zero above k = 0: retired, exactly like the
// fill's albedo); `glow` the lantern (zero at k = 0, by identity).
export function skySeenRef(layers, p, shift, gS, { sun, ambient, disk, k = 0, skyScatter = 0, wood = 1 }){
  const split = k > 0, scatter = skyScatter > 0 || split;
  const r = skyRayRef(layers, p, shift, scatter ? gS : null, sun, k);
  const T = r.T.map((v) => v * wood), Tsrc = r.Tb.map((v) => v * wood);
  let Lsc = r.L;
  if(!split && skyScatter > 0) Lsc = Lsc.map((v) => v * skyScatter);   // the proxy, as the camera scales it: before the wood
  Lsc = Lsc.map((v) => v * wood);                                        // wood stands BELOW the crowns on an upward ray: it occludes the canopy's own glow as it does the sky
  const zero = [0, 0, 0];
  if(!split){
    const rad = [0, 1, 2].map((c) => (ambient[c] + sun[c] * disk) * T[c] + Lsc[c]);
    return { T, Tsrc, glow: zero, proxy: Lsc, srcSeen: [0, 1, 2].map((c) => sun[c] * disk * Tsrc[c]), rad, acc: T };
  }
  const srcSeen = [0, 1, 2].map((c) => sun[c] * disk * Tsrc[c]);
  const rad = [0, 1, 2].map((c) => (ambient[c] * T[c] + Lsc[c]) + srcSeen[c]);
  return { T, Tsrc, glow: Lsc, proxy: zero, srcSeen, rad, acc: T };
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
