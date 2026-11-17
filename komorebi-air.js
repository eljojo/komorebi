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
import { DEG, clamp, fbm1, WIND_PATTERNS } from './komorebi-math.js';

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
