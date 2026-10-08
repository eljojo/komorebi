// ============================================================================
// The litter (spec §4.7, "The floor is a map"). A leaf that has let go (§4.5, P3a) lies ON the receiver: h = 0, so it casts
// nothing — no throw, no blur — and it is SEEN BY REFLECTION. The same red leaf that glows backlit in the canopy reads tan-brown
// and desaturated lying face up under a sky it did not filter, so the carpet is not the canopy's transmittance on the ground: it
// is an albedo, a texture the floor's material reads. And it is a function of (phenology, seed), never of the run: nothing here
// accumulates, so a look is the same carpet whenever it is drawn.
//
// This file is the CPU half, as komorebi-fill.js is the fill's: the laws as pure functions (where a leaf lands, what colour it
// lies in, in what order they are laid), which `bun test` holds without a GPU, and the factory that bakes them. The shaders
// (VS_LITTER/FS_LITTER) and the floor's read (GLSL_T_FLOOR_MATERIAL) are the authority on the pixels.
// ============================================================================
import { DEG, TAU, clamp, hash3, makeGauss, mulberry32, smoothstep } from './komorebi-math.js';
import { leafHue } from './komorebi-fill.js';
import { CAMERAS, cameraFor } from './komorebi-transport.js';
import { bindLeafShape } from './komorebi-grove.js';
import { leafShape, leafVariant } from './komorebi-leaf.js';

// A leaf's landing and its angle on the ground are its OWN draws, from a stream seeded by (seed, cluster, leaf) on a salt of its own —
// never the growth RNG, so laying litter cannot move a twig or a leaf of any shipped grove, and independent of the pigment, drop-day,
// arrangement and wind-identity streams made from the same ingredients (the salts are all different, and a test holds them apart).
const LITTER_SALT = 0x2B9D4F6E;
const LITTER_SIGMA = 0.3;   // the scatter about the drift, as a share of it: a leaf is carried, not aimed (σ = 0.3·h·litter_drift_m)

// THE COLOUR — PROVISIONAL until a fresh-vs-dry litter photo against a grey card replaces both numbers. A fallen leaf reflects the hue
// of its own pigments: e^(−τ) is what it PASSES, and its hue (the transmittance with its brightness divided out, §3.5's idiom) is what
// it reflects, at the peak reflectance of a green-to-red leaf's brightest channel (0.35). That is FRESH. Over `litter_age` it browns —
// a smoothstep of (phenology − its day)/litter_age toward a dry-leaf brown — so the carpet ages red → copper → brown, the last to fall
// on top. Linear reflectance: LDR, so the texture is RGBA8.
const LITTER_PEAK = 0.35;
const ALBEDO_BROWN = [0.12, 0.08, 0.05];

// THE RAIN DAY (`leaf_wetness`; spec §4.7, "Wet litter"). José: "one day after rain many leaves fell on the ground". A dead leaf on the ground soaks: water fills
// the air spaces of its tissue, the index contrast at every cell-wall/air interface falls from (n_wall − 1) to (n_wall − n_water), and scattering goes as Δn². Less
// scattering lets light travel deeper before it returns, so more of it is absorbed: the leaf darkens AND saturates in one move, the strongly absorbed channel most.
// Dead tissue only: a red leaf still on the tree is alive and keeps its frost, so the carpet is the only reader of this.
const N_WALL = 1.47, N_WATER = 1.333;
const WET_RHO = ((N_WALL - N_WATER)/(N_WALL - 1))**2;   // ≈ 0.085: the share of its scattering a fully soaked leaf keeps
// Kubelka–Munk for an opaque pile. kmReflect is the STABLE inverse (not the textbook 1 + X − √(X² + 2X), which is NaN at R = 0 and cancels badly below R ≈ 1e-4):
// X = Infinity lands on 0 cleanly and small R stays exact.
const kmInvert = (R) => (1 - R)*(1 - R)/(2*R);
const kmReflect = (X) => 1/(1 + X + Math.sqrt(X*X + 2*X));
// S falls by the index law while K is the pigments' and does not move. w ≤ 0 (or NaN) is the gate: no arithmetic at all, R to the bit.
function wetten(R, w){
  if(!(w > 0)) return R;
  if(R >= 1) return 1;   // nothing to absorb: white never darkens
  if(R <= 0) return 0;
  return kmReflect(kmInvert(R)/(1 - Math.min(w, 1)*(1 - WET_RHO)));
}

// ONE function, so the browning process (P4b) replaces it behind the same signature and nothing else moves: (a leaf's τ, its age in
// litter_age units, the effective wetness) -> the albedo it reflects with. Age 0 is the leaf's own hue; age ≥ 1 is ALBEDO_BROWN to the bit, whatever the leaf was.
// Wetness is applied LAST, to the dry law's output: the age mix is the leaf's state, not a coverage mix, so K–M on the mixed R is the right object, and the honest
// reflectance that replaces the dry law needs no change here. `wet` sits before `out`: a caller that left `out` in its slot would hand an array to every comparison.
function litterAlbedo(tau, age, wet = 0, out = [0, 0, 0]){
  const hue = leafHue([Math.exp(-tau[0]), Math.exp(-tau[1]), Math.exp(-tau[2])]), s = smoothstep(0, 1, age);
  for(let c = 0; c < 3; c++) out[c] = LITTER_PEAK*hue[c]*(1 - s) + ALBEDO_BROWN[c]*s;
  if(wet > 0) for(let c = 0; c < 3; c++) out[c] = wetten(out[c], wet);
  return out;
}
// How old a leaf lies, in litter_age units: 0 the day it fell (phenology = its D). A litter_age of 0 is no time at all to brown in, so
// anything that has fallen is as old as it gets — and a leaf falling this very instant is not NaN.
function litterAge(P, D){
  const dt = P.phenology - D;
  return P.litter_age > 0 ? dt/P.litter_age : (dt > 0 ? Infinity : 0);
}

// WHERE A LEAF LANDS, and at what angle: (x, y) + h·litter_drift_m·(cos, sin)(wind_direction_deg) + σ·gauss, σ = 0.3·h·litter_drift_m.
// The wind is the SEASON's — the authored direction alone, in the convention motion.windX/windY use (0° is +x, 90° is +y). Not
// wind_strength, not the gusts, not the weather's veer: they are a function of the clock, and the carpet must stay a function of
// (phenology, seed). `P` is read for exactly four numbers (seed, litter_drift_m, wind_direction_deg), and nothing else of the live wind.
// The draw order is fixed (angle, then x, then y), so a leaf's landing never depends on another leaf's.
function litterLanding(l, P){
  const r = mulberry32(hash3((P.seed>>>0)^LITTER_SALT, l.j, l.k));
  const rot = r()*TAU;
  const g = makeGauss(r), gx = g(), gy = g();
  const d = l.h*P.litter_drift_m, w = P.wind_direction_deg*DEG, s = LITTER_SIGMA*d;
  return { x: l.x + d*Math.cos(w) + s*gx, y: l.y + d*Math.sin(w) + s*gy, rot };
}

// THE LAYERING: the last to fall lie on top, so the stamps are drawn in ascending D (ties by address, so the order is a property of
// the leaves and not of how the grove happened to list them) and the alpha-blended instance order IS the layering.
function litterOrder(list){
  return [...list].sort((a, b) => a.D - b.D || a.j - b.j || a.k - b.k);
}

// The bake's instance buffer: INSTANCE_FLOATS per stamp, in drop order —
//   [x, y, A, B0]        where it lies (metres) and the leaf's own half-axes (the grove's A and the face-on B0: lying flat it is not foreshortened)
//   [cos, sin, fade, v]  its angle on the ground as a unit vector (no trig on the GPU), the fade it carries (§5.3: a marginal leaf or
//                        tree lies at its fade, so a density morph does not pop its litter in at full weight), and its outline — leafVariant(seed, j, k),
//                        the very one the grove hung it in, so a fallen leaf keeps its shape; 0 for the ellipse, which has none
//   [r, g, b, 0]         litterAlbedo(tau, age, wetness)
// `wrap` is the endless park's carpet, which repeats like its fill: a landing is folded into the frame, and a stamp that crosses an edge
// is drawn again on the far side (the copy sits beside its leaf, so the layering is kept). A finite tree's is clamped: a stamp wholly off
// its padded frame has nothing to read and is dropped. `minHalf` is the half-extent below which the bake enlarges a stamp (three quarters of
// a texel): it only has to be known here so that a stamp which spills past an edge by its enlarged size, and the margin of anti-aliasing
// the quad is drawn with round it, is not missed.
const INSTANCE_FLOATS = 12;
const wrapInto = (v, o, ext) => o + ((((v - o) % ext) + ext) % ext);
function litterInstances(list, P, frame, wrap, minHalf = 0){
  const { ox, oy, ext } = frame, buf = [], rgb = [0, 0, 0], shape = leafShape(P.leaf_shape, P.seed);   // shape: the outline the leaves hung in; null is the ellipse
  for(const l of litterOrder(list)){
    // + the margin the stamp's quad is drawn with (VS_LITTER); and an outline's quad is its box, whose far corner is `reach` leaf units from the base the stamp turns about
    const land = litterLanding(l, P), A = l.size[0], B = l.size[1], reach = (Math.max(A, B, minHalf) + 1.5*minHalf)*(shape ? shape.reach : 1);
    let x = land.x, y = land.y;
    const xs = [0], ys = [0];
    if(wrap){
      x = wrapInto(x, ox, ext); y = wrapInto(y, oy, ext);
      if(x - reach < ox) xs.push(ext); if(x + reach > ox + ext) xs.push(-ext);
      if(y - reach < oy) ys.push(ext); if(y + reach > oy + ext) ys.push(-ext);
    } else if(x + reach < ox || x - reach > ox + ext || y + reach < oy || y - reach > oy + ext) continue;
    litterAlbedo(l.tau, litterAge(P, l.D), P.leaf_wetness, rgb);
    const c = Math.cos(land.rot), s = Math.sin(land.rot);
    for(const dx of xs) for(const dy of ys) buf.push(x + dx, y + dy, A, B, c, s, l.fade, shape ? leafVariant(P.seed, l.j, l.k) : 0, rgb[0], rgb[1], rgb[2], 0);
  }
  return { data: Float32Array.from(buf), count: buf.length/INSTANCE_FLOATS };
}

// ============================================================================
// THE BAKE (the GL half). The carpet is a texture over the sky fill's frame — fillFrame(E, h_max, bulkOn), asked of the bake module so the two
// cannot disagree — baked ONCE PER REGROW: litter does not skitter, a calm choice, and it never accumulates at runtime (José: "one day after
// rain many leaves fell on the ground"). It is not baked at the regrow itself but noticed at draw time, as the fill is (refreshLitter, before any
// target is bound): the same call runs from every route that grows a grove, a transition's morph and a context restore included, and it
// re-bakes exactly when a number the carpet is a function of has moved — the grove (a new value per regrow), the authored wind direction, the
// browning, the drift, the season, the seed, the size, the frame — and never for the live wind, the sun or the fill.
// OFF it is nothing: a 1×1 texture, no program, no buffer, no pass (`litter` 0, or a camera that is not the floor, or no leaf has fallen yet).
// ============================================================================
function newLitterState(){
  return { tex: null, res: 0, ready: false, grove: null, sig: new Float64Array(12), ox: 0, oy: 0, ext: 1, count: 0, passes: 0, vao: null, buf: null };
}

function makeLitter(hub){
  const { gl, params, litter } = hub;
  const sig = new Float64Array(litter.sig.length);
  // only the floor reflects, so only the floor has a carpet to read; the cloth transmits and the sky view has no surface (the registry says so)
  const litterWanted = () => params.litter > 0 && CAMERAS[cameraFor(params)].groups.includes('litter');
  const litterRes = () => clamp(params.litter_resolution|0, 64, Math.min(4096, hub.MAX_TEX || 4096));

  function allocTex(res){
    if(litter.tex) gl.deleteTexture(litter.tex);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, res, res, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);   // reflectance is LDR: 8 bits, linear; a 1×1 until a leaf has fallen
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);            // the far floor of a tilted camera is a mip, not a shimmer of single texels
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    litter.tex = t; litter.res = res; litter.ready = false;
  }
  // The stamp VAO: the unit quad every bake shares, and one instance buffer (12 floats a leaf, three vec4s) — made on the first carpet, never before.
  function ensureVAO(){
    if(litter.vao) return;
    litter.vao = gl.createVertexArray(); litter.buf = gl.createBuffer();
    gl.bindVertexArray(litter.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, hub.quadBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, litter.buf);
    for(let a = 0; a < 3; a++){ gl.enableVertexAttribArray(1 + a); gl.vertexAttribPointer(1 + a, 4, gl.FLOAT, false, 4*INSTANCE_FLOATS, 16*a); gl.vertexAttribDivisor(1 + a, 1); }
    gl.bindVertexArray(null);
  }
  // what the carpet is a function of, besides the grove itself (compared by identity: a regrow makes a new one)
  function litterSig(o, res, fr, wrap, n){
    o[0] = res; o[1] = fr.ox; o[2] = fr.oy; o[3] = fr.ext; o[4] = wrap ? 1 : 0;
    o[5] = params.litter_age; o[6] = params.litter_drift_m; o[7] = params.wind_direction_deg; o[8] = params.phenology; o[9] = params.seed; o[10] = n;
    o[11] = params.leaf_wetness;   // MORPH-class: a change re-bakes the carpet alone, and the sig must be long enough to hold it (a write past a Float64Array's end is silently dropped)
  }

  function bakeLitter(list, res, fr, wrap){
    if(litter.res !== res) allocTex(res);
    const e = hub.litterFor(), u = e.U, minHalf = 0.75*fr.ext/res;
    const inst = litterInstances(list, params, fr, wrap, minHalf);
    ensureVAO();
    gl.bindTexture(gl.TEXTURE_2D, litter.tex);
    const mode = wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE;   // the park repeats its carpet like its fill (the box is one period of an endless field); a tree's is empty at the edge of its padded frame
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hub.bakeFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, litter.tex, 0);
    gl.viewport(0, 0, res, res);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if(inst.count){
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // over, premultiplied: instance order is layering, and alpha accumulates as 1 − Π(1 − a)
      gl.useProgram(e.prog);
      gl.uniform2f(u.origin, fr.ox, fr.oy);
      gl.uniform2f(u.extent, fr.ext, fr.ext);
      gl.uniform1f(u.minHalf, minHalf);
      const unit = gl.getParameter(gl.ACTIVE_TEXTURE);
      bindLeafShape(gl, u, hub.grove);   // the outline the leaves fell from (unit 6) — the active grove's, whose list this is
      gl.activeTexture(unit);            // ...and the unit active before it stays active: the mips below are made on the carpet's own, wherever that was, and unit 6 is the fill's sampler
      gl.bindBuffer(gl.ARRAY_BUFFER, litter.buf);
      gl.bufferData(gl.ARRAY_BUFFER, inst.data, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(litter.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.count);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, litter.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    litter.ox = fr.ox; litter.oy = fr.oy; litter.ext = fr.ext;   // what the floor reads it by
    litter.count = inst.count; litter.grove = hub.grove; litter.ready = true; litter.passes++;
    litterSig(litter.sig, res, fr, wrap, list.length);
  }

  // Not wanted, or nothing to show: free what a shut gate no longer needs. The floor then runs its old material — a carpet with no leaf on it is the floor.
  function releaseLitter(){
    allocTex(1);
    litter.grove = null; litter.count = 0;
  }

  // Once per frame, before transport draws (and before any target is bound: a bake binds its own).
  function refreshLitter(){
    const list = hub.grove?.litter;
    if(!(litterWanted() && list?.length)){ if(litter.ready || litter.res !== 1) releaseLitter(); return; }
    const res = litterRes(), fr = hub.fillFrameNow(), wrap = !hub.bulkOn();
    if(litter.ready && litter.grove === hub.grove){
      litterSig(sig, res, fr, wrap, list.length);
      let same = true;
      for(let i = 0; i < sig.length; i++) if(sig[i] !== litter.sig[i]){ same = false; break; }
      if(same) return;
    }
    bakeLitter(list, res, fr, wrap);
  }

  allocTex(1);   // the 1×1 every engine holds: bound (and never read) while the gate is shut, and fresh after a context restore
  return { litterWanted, refreshLitter, releaseLitter };
}

// What the engine holds in place of the carpet in a bundle that cut it (embed-build.mjs, FEATURES.litter): nothing to bake, nothing to release.
const NO_LITTER = { refreshLitter: () => {} };

export { NO_LITTER, LITTER_SALT, LITTER_SIGMA, LITTER_PEAK, ALBEDO_BROWN, N_WALL, N_WATER, WET_RHO, kmInvert, kmReflect, wetten, INSTANCE_FLOATS, litterAlbedo, litterAge, litterLanding, litterOrder, litterInstances, newLitterState, makeLitter };
