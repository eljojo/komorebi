// ============================================================================
// The math the organs share — pure functions, no GL, no engine state. The constants and the interpolation helpers, the two-circle overlap
// area, and the deterministic RNG that keeps the canopy frame-stable. The laws of each
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
// ---- deterministic RNG so canopy is frame-stable & reproducible ------------
function mulberry32(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function makeGauss(rng){ return ()=>{ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }; }
function hash3(a,b,c){ let h=(a^0x9E3779B1)>>>0;
  h=Math.imul(h^b,0x85EBCA6B)>>>0; h=Math.imul(h^c,0xC2B2AE35)>>>0;
  return (h^(h>>>15))>>>0; }

export { DEG, TAU, GOLDEN, lensArea, clamp, lerp, smoothstep, lerpAngle, mulberry32, makeGauss, hash3 };
