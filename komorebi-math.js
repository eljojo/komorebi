// ============================================================================
// The math the organs share — pure functions, no GL, no engine state. The constants and the interpolation helpers, the two-circle overlap
// area, the deterministic RNG that keeps the canopy frame-stable, and the helpers the routes between looks share. The laws of each
// organ live in its own module (komorebi-season.js, komorebi-light.js, komorebi-camera.js, komorebi-grammar.js, komorebi-air.js, komorebi-leaf.js).
// ============================================================================
const DEG = Math.PI / 180, TAU = Math.PI*2;
const GOLDEN = Math.PI*(3 - Math.sqrt(5));   // the golden angle (rad), the step of every spiral in the growth: trees about the grove, limbs up the trunk, children about a node (spec/model/canopy.md)
// Area shared by two circles, radii r1/r2, centres d apart — the eclipse's moon against the source's core disk and
// against its whole extent. Used only to renormalize the SEEN source's radiance (spec/model/sky-view.md); the cast's own crescent comes
// from zeroing sample weights, which is a discrete estimate of this same area.
function lensArea(r1, r2, d){
  if(r2 <= 0 || r1 <= 0) return 0;
  if(d >= r1 + r2) return 0;                                  // disjoint
  if(d <= Math.abs(r1 - r2)) return Math.PI*Math.min(r1, r2)*Math.min(r1, r2);   // one contains the other
  const a1 = Math.acos(clamp((d*d + r1*r1 - r2*r2)/(2*d*r1), -1, 1));
  const a2 = Math.acos(clamp((d*d + r2*r2 - r1*r1)/(2*d*r2), -1, 1));
  return r1*r1*(a1 - Math.sin(2*a1)/2) + r2*r2*(a2 - Math.sin(2*a2)/2);
}
const clamp = (x,a,b) => Math.min(b, Math.max(a, x));
const lerp = (a,b,t) => a + (b-a)*t;
const smoothstep = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
// shortest-arc interpolation for a periodic value (degrees->360, radians->TAU): 350°->10° goes +20°.
const lerpAngle = (a,b,t,period) => { const d=((b-a)%period + period*1.5)%period - period*0.5; return a + d*t; };
// A travel route turning back mid-flight (spec: reversal keeps progress): like walking home for a forgotten wallet.
// The momentum it had is spent first, an even deceleration over a tenth of a second that carries it on just past the
// press (never more than half the way left to the far end, which would otherwise be a landing), then it eases home
// and settles at rest. The
// farther out it was, the longer the way back, up to a whole route: half a route for a turn at the start, a whole
// route from halfway on. Progress p and its velocity v (per second) stay continuous; `full` is a whole route in
// seconds. Already heading for `to` (a second turn caught mid-deceleration), it eases there from its current velocity,
// capped where the cubic would overshoot `to`.
const turnBack = (p, v, to, full) => {
  const T = full*Math.min(1, 0.5 + Math.abs(to-p)), dir = Math.sign(to-p) || 1;
  if(v*dir >= 0){
    const m0 = dir*Math.min(Math.abs(v)*T, 3*Math.abs(to-p));
    return { T,
      at: u => clamp((2*u*u*u-3*u*u+1)*p + (u*u*u-2*u*u+u)*m0 + (3*u*u-2*u*u*u)*to, 0, 1),
      rate: u => ((6*u*u-6*u)*p + (3*u*u-4*u+1)*m0 + (6*u-6*u*u)*to)/T };
  }
  const td = Math.min(0.1, T/2, Math.abs(1-to-p)/Math.abs(v)), turn = p + v*td/2, back = T - td;
  return { T,
    at: u => { const s = u*T; return s < td ? p + v*s - v*s*s/(2*td) : lerp(turn, to, smoothstep(0, back, s-td)); },
    rate: u => { const s = u*T; if(s < td) return v*(1 - s/td); const x = (s-td)/back; return (to-turn)*6*x*(1-x)/back; } };
};

// ---- deterministic RNG so canopy is frame-stable & reproducible ------------
function mulberry32(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function makeGauss(rng){ return ()=>{ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }; }
function hash3(a,b,c){ let h=(a^0x9E3779B1)>>>0;
  h=Math.imul(h^b,0x85EBCA6B)>>>0; h=Math.imul(h^c,0xC2B2AE35)>>>0;
  return (h^(h>>>15))>>>0; }

// THE IRIS GATE (spec/model/transitions.md), one rule for every route that crosses it: when only one end has a hood, no boundary moves. The
// hood keeps that end's own feather and shape for the whole route and its opacity runs between 0 and 1. `shown` is
// the opacity an interrupted fade shows, where the next route starts. Null when nothing fades: two hooded ends morph
// their feather and shape at full opacity, two bare ends have no mask.
function irisRoute(a, b, shown = null) {
  const on = a.vignette > 0, to = Number(b.vignette > 0), from = shown ?? Number(on);
  if (from === to) return null;
  const end = on === (b.vignette > 0) ? null : on ? a : b;
  return { from, to, shape: end && { vignette: end.vignette, vignette_shape: end.vignette_shape } };
}
// One step at the route's eased progress e: holds the hooded end's geometry in p, returns the opacity to draw with.
function irisStep(route, e, p) {
  if (route.shape) Object.assign(p, route.shape);
  return lerp(route.from, route.to, e);
}

export { DEG, TAU, GOLDEN, irisRoute, irisStep, lensArea, clamp, lerp, smoothstep, lerpAngle, turnBack, mulberry32, makeGauss, hash3 };
