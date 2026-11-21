// ============================================================================
// komorebi-air.js — the air the grove stands in: the wind's force as a pure function of time (the weather and the
// broadband gusts, motion.md "Broadband forcing"), and the air at a place, which is that force arriving there.
// Pure, no GL: the motion (komorebi-motion.js) reads it to move the leaves, and anything else that must follow the
// same air (the sound, sound-worklet.js) imports the same functions rather than a copy of them.
//
// THE AIR AT A PLACE. A gust is not everywhere at once: it is carried through the grove by the mean wind, so a clump
// downwind feels it later than one upwind (Taylor's frozen turbulence). The air at plan point p, time t, is
//   level(p, t) = |G(t − s/U)| · eddy(p, t),     s = p·ŵ the distance along the wind from the grove's origin,
// G the wind's longitudinal force after its gust edges (the trunk spring's own drive, motion.driveEnv), and eddy a
// log-normal factor, mean 1, never below zero, from the engine's −5/3 noise of time sampled at the same carried time
// and offset across the wind, so clumps side by side feel unrelated stretches of it.
// Each tree's trunk spring is driven by the same law where it stands (komorebi-motion.js, the trunks: its own edges on the
// force at its carried time); the first tree's, at the origin, by G now. The air elsewhere is G earlier (downwind) or later
// (upwind). Upwind of the origin the gust has not reached the first trunk yet but has reached those leaves, so the air keeps
// G's recent past (a ring) and runs it ahead (the same edges applied to the same pure force), over `reach` metres.
// Approximation: one carried signal and one eddy field, not a simulated flow; U is not the wind's real speed (the
// model has none) but a constant. U, sigma, rate and L are Provisional: they are what the prototype that first made
// the sound read as wind used. The canopy repeats every canopy_extent_m and this air does not, so where a repeat's
// seam is in view the air on its two sides differs.
// ============================================================================
import { DEG, clamp, hash3 } from '../komorebi-math.js';

// ---- broadband wind signal (spec/model/motion.md). Real wind is BROADBAND, not a single frequency — a single sine
// reads as a machine because all its energy sits at one period. A frame-stable fractal sum of octaves over
// TIME with per-octave amplitude gain G=2^(-H) gives a power spectrum ∝ f^-(2H+1): the Kolmogorov inertial
// subrange is -5/3, i.e. H=1/3 → G≈0.794 (the number that makes a noise sum *feel* like wind — between
// "pink" H=0 choppy and "brown" H=0.5 sluggish). Pure function of t → no per-frame RNG (all engine motion
// is deterministic-of-time & reproducible, spec/model/source.md). H is the per-pattern "character" knob below. -------
const VNOISE_STD = 0.496;                  // measured std of vnoise1 — normalizes fbm1 to ~unit std
function vnoise1(x){                       // smooth 1-D value noise -> [-1,1]
  const i=Math.floor(x), f=x-i, u=f*f*(3-2*f);
  const a=(hash3(i>>>0,0x9E37,0x85EB)>>>0)/4294967296;
  const b=(hash3((i+1)>>>0,0x9E37,0x85EB)>>>0)/4294967296;
  return (a+(b-a)*u)*2-1;
}
// fractal Brownian motion in time, normalized to ~UNIT STANDARD DEVIATION (octaves are decorrelated, so
// var(sum)=Σ amp²·var(vnoise); dividing by √(Σamp²)·VNOISE_STD gives σ≈1). Unit std is what makes the
// gustiness knob mean turbulence-intensity (σ/U) honestly — without it, gustiness was nearly inert.
function fbm1(t, freq, octaves, H){
  const G=Math.pow(2,-H); let sum=0, amp=1, a2=0, fr=freq;
  for(let i=0;i<octaves;i++){ sum+=amp*vnoise1(t*fr + i*19.7); a2+=amp*amp; amp*=G; fr*=2; }
  return a2>0 ? sum/(Math.sqrt(a2)*VNOISE_STD) : 0;
}
// ---- wind PATTERNS (spec/model/motion.md): a few broadband CHARACTERS, all reading the SAME shared knobs (strength,
// gustiness, gust rate, direction, weather) but shaped differently inside. `H` = spectral slope (choppy↔
// silky), `octaves` = detail depth, `lean` = steady downwind mean fraction (low → deeper lulls that drive
// the springback through rest), `lat` = crosswind fraction (breaks the 1-D slide), `burst` = waveshape that
// spikes peaks & deepens lulls (clustered/intermittent gusts). Selected by name (`wind_pattern`). ----------
const WIND_PATTERNS = {
  steady:  { H:0.72, octaves:4, lean:0.55, lat:0.45, burst:0.0 },   // smooth rolling directional breeze
  gusty:   { H:0.34, octaves:5, lean:0.35, lat:0.75, burst:0.35 },  // Kolmogorov-ish, the natural default
  squally: { H:0.24, octaves:5, lean:0.22, lat:0.85, burst:0.7 },   // bursty, sharp rises, deep clustered lulls
  choppy:  { H:0.12, octaves:6, lean:0.30, lat:0.80, burst:0.25 },  // nervous fine high-freq, cold-front edge
  lazy:    { H:0.88, octaves:3, lean:0.62, lat:0.40, burst:0.0 },   // very slow faint stir (pairs with glisten)
};
// a smooth, spatially-varying, slowly-evolving wind force — sampled at each node's position. Returns the scalar
// downwind component (the only one the limb/twig loops ever read); the crosswind term it used to also compute
// and box into an array was always discarded, so this is the same number with half the trig and no per-node alloc.
function windNoise(x, y, t, k){
  return 0.7*(Math.sin(x*k + t*0.9) + 0.5*Math.sin(y*k*1.3 - t*1.4 + 1.7));
}
// THE BRANCH NOISE AS WIND (branch_noise; a prototype). windNoise is two tones in time, 0.9 and 1.4 rad/s, the same for
// every pattern: the limbs and twigs tremble at one tempo whatever the wind's character, and the floor's brightness
// tempo does not follow H. branchNoise keeps windNoise's shape (the two terms, their weights, their phase across the
// grove, carried the same way) and makes each tone the pattern's own fractal sum instead: unit-std fbm1 scaled to a
// sine's spread, its lowest octave BN_BASE times the tone's frequency, so its flat low end reaches up to the tone (each
// value-noise octave is flat below about 0.4 of its frequency) and above it the spectrum falls as f^-(2H+1) over the
// pattern's octaves: a lazy wind slow and smooth, a choppy one nervous. Same spread as windNoise, a different tempo.
const BN_BASE = 2.5;
function branchNoise(x, y, t, k, pat){
  const s = Math.SQRT1_2, w1 = 0.9, w2 = 1.4;
  return 0.7*(s*fbm1(t + x*k/w1, BN_BASE*w1/(2*Math.PI), pat.octaves, pat.H)
            + 0.5*s*fbm1(-t + (y*k*1.3 + 1.7)/w2 + 53.3, BN_BASE*w2/(2*Math.PI), pat.octaves, pat.H));
}
export { fbm1, WIND_PATTERNS, windNoise, branchNoise };

// THE LEAF'S FLUTTER AS WIND (flutter_broadband). Each leaf rocks on one tone, sin(t·flutter_freq·2π + its phase): the
// flutter's size follows the wind (|u|, or the air under wind_air) but its tempo is the same whatever the wind's
// character, and the leaves' rock is what sets the floor's brightness tempo, so the pattern's H never reaches the floor
// (spec/model/motion.md, Patterns). flutter_broadband blends the tone into the pattern's own fractal sum: fbm1 at the
// pattern's gain 2^−H, FLUTTER_OCT octaves from FLUTTER_LOW of the flutter rate up (an eighth to four times it, so the
// sum falls as f^−(2H+1) across the floor's band), scaled to the tone's spread (unit std × √½). Each leaf reads it at its
// own time, its phase stretched over FLUTTER_SPAN seconds, so neighbours are unrelated stretches of one signal. Still a
// pure function of time and the leaf's address (spec/contracts/determinism.md). `tone` is the caller's own sine, returned
// as it is at band 0 so the off state is the old flutter to the bit. GLSL_FLUTTER is the shaders' twin: the same integer
// hash (komorebi-math.js hash3) on uints, so the lattice matches the CPU's exactly and only float rounding differs.
const FLUTTER_OCT = 6;
const FLUTTER_LOW = 0.125;
const FLUTTER_SPAN = 97.3;
export function leafFlutter(tone, t, phase, f, band, H){
  if(!(band > 0)) return tone;
  const n = fbm1(t + phase*FLUTTER_SPAN, f*FLUTTER_LOW, FLUTTER_OCT, H)*Math.SQRT1_2;
  return tone + (n - tone)*band;
}
// THE LEAVES FLUTTER IN A WINDOW OF THE AIR (flutter_onset; a prototype). A leaf's flutter is torsional galloping, a
// self-excited instability (Tadrist et al. 2018): below a critical air speed the leaf only flags; past it the flutter rises
// to its limit cycle within about 30% (ONSET_RISE) and then hardly grows with the wind. The critical speed depends on how
// the leaf faces the wind, not on its size, so the leaves of one crown wake one after another: each leaf's own threshold
// is the onset times 1 + spread·h, h its phase over 2π (uniform per leaf, and continuous, so the shaders and the CPU agree
// at every leaf). Past `window` times the onset the crown reconfigures (the leaves bend, overlap and clump, Cauchy number
// 1) and the flutter falls by `fade` over the next ONSET_FALL of the air. Saturated, a leaf flutters at ONSET_FULL, about
// the trunk's sway |u| at the shipped looks' strongest, so a gust's peak looks as the always-on flutter did. The air is
// the clump's own (airLevel: the gust carried to it, times its eddy); the trunk's sway, which lags the air and is
// compressed near its ceiling, no longer sizes the flutter. At onset 0 the flutter's size is what it was, to the bit.
// The branches are left as they are (their sway still grows with the drive, not as U^(11/6)).
// Approximation: a smoothstep onset and fall, not the galloping's amplitude law; the constants are Provisional.
const ONSET_RISE = 1.3;
const ONSET_FALL = 1.8;
const ONSET_FULL = 0.7;
export const ONSET = { rise: ONSET_RISE, fall: ONSET_FALL, full: ONSET_FULL };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a)/(b - a))); return t*t*(3 - 2*t); };
export function flutterWindow(wm, air, phase, onset, spread, win, fade){
  if(!(onset > 0)) return wm;
  const c = onset*(1 + spread*phase*0.15915494), r = onset*win;
  return ONSET_FULL*smooth(c, c*ONSET_RISE, air)*(1 - fade*smooth(r, r*ONSET_FALL, air));
}
// the window's four, as the shaders take them (a vec4), from a look's params; onset 0 is off
export const onsetOf = (p) => [Math.max(0, p.flutter_onset || 0), Math.max(0, p.flutter_spread ?? 0.5), Math.max(1, p.flutter_window ?? 2.4), clamp(p.flutter_fade ?? 0.5, 0, 1)];
// whether the motion must publish the air at each clump: wind_air reads it, and so does the flutter's window
export const airRead = (p) => p.wind_air > 0 || p.flutter_onset > 0;
// the H a look's flutter takes: its wind pattern's (gusty's for an unknown name, as the motion falls back)
export const flutterH = (params) => (WIND_PATTERNS[params.wind_pattern] || WIND_PATTERNS.gusty).H;
const GLSL_FLUTTER = `uint flHash(uint a, uint b, uint c){ uint h = a ^ 0x9E3779B1u; h = (h ^ b)*0x85EBCA6Bu; h = (h ^ c)*0xC2B2AE35u; return h ^ (h >> 15u); }
float flNoise(float x){   // vnoise1 (komorebi-air.js)
  float i = floor(x), f = x - i, w = f*f*(3.0 - 2.0*f); uint k = uint(int(i));
  float a = float(flHash(k, 0x9E37u, 0x85EBu))/4294967296.0, b = float(flHash(k + 1u, 0x9E37u, 0x85EBu))/4294967296.0;
  return (a + (b - a)*w)*2.0 - 1.0;
}
float leafFlutter(float tone, float t, float phase, float f, float band, float H){   // leafFlutter (komorebi-air.js)
  if(!(band > 0.0)) return tone;
  float g = exp2(-H), amp = 1.0, a2 = 0.0, s = 0.0, fr = f*${FLUTTER_LOW}, x = t + phase*${FLUTTER_SPAN};
  for(int i = 0; i < ${FLUTTER_OCT}; i++){ s += amp*flNoise(x*fr + float(i)*19.7); a2 += amp*amp; amp *= g; fr *= 2.0; }
  float n = s/(sqrt(a2)*${VNOISE_STD})*0.70710678;
  return tone + (n - tone)*band;
}
float flutterGust(float wm, float flick, float k){   // flutterGust (komorebi-air.js)
  return k > 0.0 ? wm + (flick - wm)*k : wm;
}
float flutterWindow(float wm, float air, float phase, vec4 w){   // flutterWindow (komorebi-air.js); w = (onset, spread, window, fade)
  if(!(w.x > 0.0)) return wm;
  float c = w.x*(1.0 + w.y*phase*0.15915494), r = w.x*w.z;
  return ${ONSET_FULL}*smoothstep(c, c*${ONSET_RISE}, air)*(1.0 - w.w*smoothstep(r, r*${ONSET_FALL}, air));
}`;
export { GLSL_FLUTTER, FLUTTER_OCT, FLUTTER_LOW, FLUTTER_SPAN };

// THE LEAVES FLICKER ON THE GUST'S EDGES (flutter_gust). The flutter's size follows the trunk's sway |u|, so in a steady push
// the leaves flicker at full size for as long as it blows, and the leaves and the branches always move in one proportion. A
// leaf answers the air at once and to far less of it than a branch: it wakes as a gust rises, before the branches lean, and
// keeps flickering as the gust dies and the branches settle; in a steady push a broad leaf flags and holds. The flick is
// that: how far the trunk's drive (its gust-edged force, driveEnv) stands from its own slow mean, a one-pole of
// FLICK.tau seconds, times FLICK.gain (about the mean |u| on the shipped looks under gusty), capped at FLICK.cap. It is
// the motion's state, ticked beside the trunk's spring; each tree has its own, and the shaders read tree 0's as a uniform
// and the rest as what they add to it (the cluster texture's row 2, .w). flutter_gust blends the flutter's size from |u|
// toward it; at 0 the size is |u| (or the air) exactly. The quasi-static flagging (0.5·u) is left as it is.
export const FLICK = { tau: 2.5, gain: 4, cap: 1.5 };
export function flickMeanStep(mean, drive, dt){ return mean + (drive - mean)*(1 - Math.exp(-dt/FLICK.tau)); }
export function flickLevel(drive, mean){ return Math.min(FLICK.cap, FLICK.gain*Math.abs(drive - mean)); }
export function flutterGust(wm, flick, k){ return k > 0 ? wm + (flick - wm)*k : wm; }

export const AIR = {
  U: 3,          // m/s: how fast a gust is carried through the grove
  sigma: 0.8,    // the eddies' log-normal spread
  rate: 0.5,     // Hz: the eddies' lowest octave
  L: 2,          // m: how far apart across the wind two clumps feel unrelated eddies (as the prototype spaced them)
  reach: 40,     // m: how far from the origin the air is followed; beyond it, the nearest it knows
  hz: 30,        // the rate G is kept and run ahead at
};

// ---- the wind's force, pure in time (the arithmetic komorebi-motion.js's tick has always done, moved here) ----
export function weatherAt(params, t){
  const wv = params.weather_variability, wt = t*0.012*Math.max(1e-3, params.weather_speed);
  const weatherS = clamp(1 + wv*0.85*fbm1(wt, 1, 3, 0.6), 0, 2.5);   // strength swells & lulls over minutes
  const dirVeer  = wv*30*DEG*fbm1(wt+13.1, 1, 3, 0.6);               // ±~30° slow veer/back at full variability
  return { weatherS, dirVeer };
}
// THE GUST ACROSS THE WIND (gust_width_m). A gust has a width: trees side by side across the wind share only part of it. The gust
// noise at across-wind position y is read from independent LANES of the same noise of time, a lane every gust_width_m, blended
// between the two lanes y falls between and rescaled to keep its spread, so two places correlate fully at the same y and fade
// apart over about a width. y = 0 is lane 0, the noise as it always was; 0 width = one lane everywhere (off).
// Approximation: lanes blended across the wind, not a 2-D turbulent field. Provisional: the width is the look's.
const LANE = 211.3;   // s: how far apart in the noise's time two lanes are read, so they are unrelated
function laneNoise(t, freq, octaves, H, y, L){
  if(!(L > 0) || y === 0) return fbm1(t, freq, octaves, H);
  const x = y/L, i = Math.floor(x), f = x - i, w = f*f*(3 - 2*f);
  return (fbm1(t + LANE*i, freq, octaves, H)*(1 - w) + fbm1(t + LANE*(i + 1), freq, octaves, H)*w)/Math.hypot(1 - w, w);
}
const shaped = (g, pat) => { if(pat.burst>0){ const e=1+pat.burst*2; return Math.sign(g)*Math.pow(Math.abs(g),e); } return g; };   // spike peaks, deepen lulls
// the longitudinal force before its gust edges: the mean lean plus the gustiness-scaled fluctuation; at y across the wind
// (THE GUST ACROSS THE WIND), and in shelter S, the share of the wind's speed a tree in other crowns' wake still gets (shelter,
// below): drag goes as the speed squared, so the mean takes S² and the gusts S (their spread kept). y 0, S 1: as it always was.
export function leanForce(params, t, weatherS, y = 0, S = 1){
  const pat = WIND_PATTERNS[params.wind_pattern] || WIND_PATTERNS.gusty;
  const gL = shaped(laneNoise(t, Math.max(1e-3, params.gust_frequency), pat.octaves, pat.H, y, params.gust_width_m), pat);
  return S === 1 ? params.wind_strength*weatherS*(pat.lean + params.wind_gustiness*gL)
                 : params.wind_strength*weatherS*(pat.lean*S*S + params.wind_gustiness*gL*S);
}
// the zero-mean crosswind, on its own decorrelated stream (the same y and S: a crosswind gust is the speed times its spread)
export function crossForce(params, t, weatherS, y = 0, S = 1){
  const pat = WIND_PATTERNS[params.wind_pattern] || WIND_PATTERNS.gusty;
  const gT = shaped(laneNoise(t+101.7, Math.max(1e-3, params.gust_frequency), pat.octaves, pat.H, y, params.gust_width_m), pat);
  return S === 1 ? params.wind_strength*weatherS*(params.wind_gustiness*pat.lat*gT) : params.wind_strength*weatherS*(params.wind_gustiness*pat.lat*gT)*S;
}
// the gust edges: one step of the asymmetric one-pole, the rise sharper than the decay
export function gustEdge(G, raw, dt, params){
  const tc = (raw>G) ? params.gust_attack : params.gust_decay;
  return G + (raw - G) * (1 - Math.exp(-dt/Math.max(tc,1e-3)));
}

// ---- G kept and run ahead: a uniform grid of G at times k/hz ----
export function makeAirTrack(){
  const ahead = Math.ceil(AIR.reach/AIR.U*AIR.hz) + 2, size = 1 << Math.ceil(Math.log2(ahead + 4));
  return { t: 0, G: 0, last: -1, past: new Float32Array(size), mask: size - 1, ahead, future: new Float32Array(ahead + 1), started: false, ran: false };
}
// after the motion has moved G to `G` at time `t` (the end of its step): keep every grid point passed since the last
// call, then run G ahead from here
export function advanceAir(tr, params, t, G, runAhead){
  const h = 1/AIR.hz;
  if(!tr.started){ tr.started = true; tr.t = t; tr.G = G; tr.last = Math.floor(t*AIR.hz); tr.past[tr.last & tr.mask] = G; }
  for(let k = tr.last + 1; k*h <= t; k++){
    const u = t > tr.t ? (k*h - tr.t)/(t - tr.t) : 1;
    tr.past[k & tr.mask] = tr.G + (G - tr.G)*u; tr.last = k;
  }
  tr.t = t; tr.G = G; tr.ran = !!runAhead;
  if(!runAhead) return;
  const f = tr.future; f[0] = G;
  for(let k = 1; k <= tr.ahead; k++){
    const tk = t + (k - 1)*h;
    f[k] = gustEdge(f[k-1], leanForce(params, tk, weatherAt(params, tk).weatherS), h, params);
  }
}
// G at time τ, from the kept past (clamped to its oldest), the present, or the run ahead (clamped to its end)
export function airForce(tr, tau){
  const h = 1/AIR.hz;
  if(tau >= tr.t && !tr.ran) return tr.G;   // not run ahead: the nearest it knows
  if(tau >= tr.t){ const x = Math.min((tau - tr.t)*AIR.hz, tr.ahead), k = Math.floor(x), u = x - k;
    return k >= tr.ahead ? tr.future[tr.ahead] : tr.future[k]*(1 - u) + tr.future[k+1]*u; }
  const oldest = Math.max(tr.last - tr.mask + 1, 0), x = Math.max(tau*AIR.hz, oldest), k = Math.floor(x), u = x - k;
  if(k >= tr.last){ const a = tr.past[tr.last & tr.mask], ta = tr.last*h; return a + (tr.G - a)*clamp((tau - ta)/Math.max(tr.t - ta, 1e-9), 0, 1); }
  return tr.past[k & tr.mask]*(1 - u) + tr.past[(k + 1) & tr.mask]*u;
}
// G's grid from tau0 for n points, for a consumer elsewhere (the sound's worklet) to read with curveForce
export function airCurve(tr, tau0, n, out = new Float32Array(n)){
  for(let i = 0; i < n; i++) out[i] = airForce(tr, tau0 + i/AIR.hz);
  return out;
}
export function curveForce(curve, tau0, tau){
  const x = clamp((tau - tau0)*AIR.hz, 0, curve.length - 1), k = Math.floor(x), u = x - k;
  return k >= curve.length - 1 ? curve[curve.length - 1] : curve[k]*(1 - u) + curve[k+1]*u;
}

// ---- the air at a place ----
// THE SPEED A GUST IS CARRIED AT (gust_carry). Gusts travel with the mean wind, so a strong wind carries them through the grove
// faster. The force goes as the speed squared, so with gust_carry 1 the speed is U·√(force), U at a force of 1 (wind_strength ×
// the weather), never under 1 m/s; between, the exponent eases from 0 (U, constant: off) to ½. Provisional: U at a force of 1.
export function carrySpeed(params, weatherS){
  const a = params.gust_carry;
  return a > 0 ? Math.max(1, AIR.U*Math.pow(Math.max(0, params.wind_strength*weatherS), a/2)) : AIR.U;
}
// where along and across the wind (wx, wy) a plan point lies, from the grove's origin
export function airDelay(x, y, wx, wy, U = AIR.U){ return (x*wx + y*wy)/U; }
export function airAcross(x, y, wx, wy){ return -x*wy + y*wx; }
export function eddy(t, x, y, wx, wy, U = AIR.U){
  const along = x*wx + y*wy, across = -x*wy + y*wx;
  const n = fbm1(t - along/U + across*17.3/AIR.L + 1000, AIR.rate, 4, 1/3);
  return Math.exp(AIR.sigma*n - AIR.sigma*AIR.sigma/2);
}
// the air's level at (x, y), time t, given G there (force(τ) for τ = t − delay)
export function airLevel(force, t, x, y, wx, wy, U = AIR.U){
  return Math.abs(force(t - airDelay(x, y, wx, wy, U)))*eddy(t, x, y, wx, wy, U);
}

// SHELTER (wind_shelter). A crown is a porous obstacle: behind it the wind is slower, the deficit widening and fading downwind as
// the wake mixes out. Each upwind crown j of plan radius r_j costs a tree d downwind and dy across a deficit
//   δ = δ0·(r_j/b)²·exp(−(dy/b)²),   b = r_j + k·d   (the wake's half-width, growing as it goes; δ·b² kept: the momentum it lost)
// and the wakes add as a root sum of squares; the tree keeps the share S = 1 − wind_shelter·√Σδ² of the wind's speed, never under
// S_MIN. The most upwind trees stand in the open (S 1). Out: S by tree, into `out`. 0 = off, every S 1.
// Approximation: a plan wake behind a disc, not a flow; its depth δ0 (a crown about half open) and its spread k are Provisional.
const WAKE = { d0: 0.5, k: 0.15, sMin: 0.2 };
export function shelter(pos, crown, n, wx, wy, amount, out){
  for(let k=0;k<n;k++){
    if(!(amount > 0)){ out[k] = 1; continue; }
    const ak = pos[2*k]*wx + pos[2*k+1]*wy, ck = -pos[2*k]*wy + pos[2*k+1]*wx;
    let sum = 0;
    for(let j=0;j<n;j++){
      if(j === k) continue;
      const d = ak - (pos[2*j]*wx + pos[2*j+1]*wy);
      if(!(d > 0)) continue;
      const dy = ck - (-pos[2*j]*wy + pos[2*j+1]*wx), r = crown[j], b = r + WAKE.k*d, q = r/b;
      const delta = WAKE.d0*q*q*Math.exp(-(dy/b)*(dy/b));
      sum += delta*delta;
    }
    out[k] = Math.max(WAKE.sMin, 1 - amount*Math.sqrt(sum));
  }
  return out;
}
// how hard a leaf flutters: the trunk's sway |u| as the light has always drawn it, or, with wind_air, the air where it
// hangs. The shaders' `wm` and the travel routes compute exactly this.
export function flutterLevel(u, level, amount){ return amount > 0 ? Math.abs(u)*(1 - amount) + level*amount : Math.abs(u); }

// THE WIND'S REACH INTO A CROWN. A faint wind moves only the leaves on a crown's skin; a deeper one reaches the inner
// leaves; only a strong one moves everything. Each clump has a depth in its own tree's crown, 0 at the skin, 1 at the
// core (komorebi-grove.js, crownDepth). The wind reaches depth R = level / (wind_depth · L0), deeper as the flutter
// level rises, and a clump rocks fully once reached, fading out over the last w of depth beyond it (a smoothstep). The
// skin always rocks. At wind_depth 0 every clump is reached and every frame is as before.
// Approximation: a reach that grows with the level, not air flowing through foliage. L0 (the level that reaches the
// core at wind_depth 1) and w are Provisional.
// plain constants, so the shaders interpolate them by name and glslcheck.mjs resolves them; keep them non-integer (GLSL floats)
const DEPTH_L0 = 0.7;
const DEPTH_W = 0.25;
export const DEPTH = { L0: DEPTH_L0, w: DEPTH_W };
export { DEPTH_L0, DEPTH_W };
// the share of a clump's rock the wind reaches, 0..1: what the shaders' `dg`, the travel routes and the sound multiply by
export function depthGate(level, depth, amount){
  if(!(amount > 0)) return 1;
  const x = Math.min(1, Math.max(0, (level/(amount*DEPTH.L0) - depth)/DEPTH.w + 1));
  return x*x*(3 - 2*x);
}
