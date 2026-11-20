// ============================================================================
// The math the organs share — pure functions, no GL, no engine state. The constants, interpolation helpers,
// and deterministic RNG keep the canopy frame-stable. The laws of each
// organ live in its own module (komorebi-season.js, komorebi-light.js, komorebi-camera.js, komorebi-grammar.js, komorebi-air.js, komorebi-leaf.js).
// ============================================================================
const DEG = Math.PI / 180, TAU = Math.PI*2;
const GOLDEN = Math.PI*(3 - Math.sqrt(5));   // the golden angle (rad), the step of every spiral in the growth: trees about the grove, limbs up the trunk, children about a node (spec/model/canopy.md)
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

export { DEG, TAU, GOLDEN, clamp, lerp, smoothstep, lerpAngle, mulberry32, makeGauss, hash3 };
