// ============================================================================
// The leaf's outline (spec §4.5, "the grown leaf"). A leaf is not an ellipse, and this is the CPU half of the one that is not, as
// komorebi-fill.js is the fill's: the grammar as pure functions, which `bun test` holds without a GPU, and the radial profile r(θ) the
// grove hands the bake as a texture. The shaders (GLSL_LEAF_Q, komorebi-shaders.js) are the authority on the pixels.
//
// THE SHAPE IS A RADIAL PROFILE, NOT AN ATLAS. A stamp may vary its OUTLINE and nothing finer: texelMix (§4.5) is exact only while a
// leaf's depth is uniform inside a bake texel (7-22 mm), so a vein or a tooth baked into the stamp's depth would be averaged in τ and
// come out Jensen-dark. The outline is the one thing a coverage mask can carry honestly, so it is r(θ) from the leaf's ORIGIN — the one
// point the blade is star-shaped from, where the centroid is not: the PETIOLE BASE of a maple, a point 0.45 of the way along a beech's midrib
// — in the unit frame the ellipse lives in, AREA-NORMALISED (∮½r²dθ = π, the unit circle's) so that swapping the ellipse for a lobed blade of
// the same size and aspect leaves the canopy's fullness where it was. (The stamp is placed by that origin: a beech hangs from the middle of
// its blade, as the ellipse does, and a maple from its base.)
//
// A blade GROWS, in one of two grammars. PALMATE (growLeaf, the maple): primary veins fan from the base, each carrying a lamina of discs that
// thins to a point at its tip, and alternate secondaries run out along each primary until they leave the lamina and end in a tooth. PINNATE
// (growPinnate, the beech): ONE midrib, and the secondaries leave it along its length. The blade is the union of the lamina's discs; a secondary
// only decides where the margin is toothed (the teeth are sub-texel everywhere, kept as process and never tuned for). growSkeleton cannot grow
// either: it spawns children at a node's tip, by phyllotaxis, and a maple's laterals (a beech's secondaries) leave the vein along its length at
// a fan of fixed angles.
// ============================================================================
import { DEG, TAU, hash3, mulberry32 } from './komorebi-math.js';

const LEAF_SAMPLES = 256;   // θ samples of r(θ), sample i at θ = 2π((i + ½)/256 − ½): the texture's own texel centres, so a linear read of it is a linear read of this
const LEAF_VARIANTS = 8;    // outlines per species: rows of the texture, to which more species append theirs (up to 16 in all, see LEAF_ID_FRAC)
const LEAF_ID_FRAC = 32;    // a leaf's outline rides its cluster id's FRACTION — j + row/32, exact in float32 for any cluster the engine can hold — so the instance records keep their stride and the VS's int(iC.w + 0.5) is still j: which holds while the fraction stays under ½, i.e. for 16 rows

// Each of these is a stream of its OWN, never the growth, arrangement or wind-identity RNG (komorebi-grove.js): drawing from them cannot move a twig
// or a leaf of any shipped grove. Distinct from the pigment (0x51ED270B), drop (0x7A3C91D5), litter (0x2B9D4F6E), wind-identity (0x5bd1e995) and
// growth (0x5EED) salts — a test holds them apart.
const OUTLINE_SALT = 0x4C3AF001;   // grows the outlines
const VARIANT_SALT = 0x6E1B35D7;   // picks a leaf's outline
const FLIP_SALT = 0x3D8C5A21;      // turns half the hanging leaves through a half turn

// THE SUGAR MAPLE (Acer saccharum), measured against the reference photos: actinodromous, five primaries from the hub — laterals at ±55-70° and
// basals at ±100-115° — whose lamina is a stripe of constant width that thins to a point. The lamina's half-width is rho·len along the first `hold` of a
// primary and then falls to (1 − taper)·rho·len at its tip: the wedge a lobe ends in opens at asin(rho·taper/(1 − hold)) to either side of its vein, whatever
// its length. The wedge's angle and the sinus beside it fight (a wide wedge fills the sinus with its own flank), and `hold` is what lets them both be as a
// maple has them: a 30° tip on a lobe whose sides run nearly parallel down to a deep U. At hold 0 this is a plain linear taper, and then no lobe tip gets wider than ~17° with the
// sinuses a maple needs. The first `hub` of a primary carries no lamina (the base is a notch, not a disc). Lengths are the central primary's.
const MAPLE = Object.freeze({
  species: 1,   // hash3's second argument: each species' outlines are its own draws
  grammar: 'palmate',   // growLeaf: the primaries fan from one hub (bladeOf picks the grower by this)
  angles: Object.freeze([-105, -62, 0, 62, 105]), angleJitter: 4,   // primaries (°) and the ± they wander
  lengths: Object.freeze([0.55, 0.85, 1, 0.85, 0.55]), lengthJitter: 0.10,
  hub: 0.12, hold: 0.6, rho: 0.19, taper: 1,
  secStep: 0.18, secAngle: 45, secJitter: 0.10,   // alternate secondaries every 0.18 along a primary, at 45° ± 10%
  tooth: 0.02, toothHalf: 0.06,                   // each secondary ends in a 2% radial tooth, 0.06 rad to either side
});
// THE AMERICAN BEECH (Fagus grandifolia), pinnate: a midrib with 9-13 secondaries a side, alternate and half a step out of phase, leaving it forward at ~45° and running out to the margin to end in a
// small tooth. The lamina is a disc every 0.01 along the midrib of radius body(s) = W·s^a(1−s)^c, normalised to peak at W: a round base (a < 1), the blade widest at a/(a + c) of the way along, and a long
// taper to a point (c > 1). Each disc's centre is offset across the midrib by `asym` of its own radius, which makes the base oblique. W, a, c and asym wander per leaf with the length (WIDTH_JITTER and
// the rest, below): the beech's eight outlines are more alike than the maple's — only these draws part them. `origin` is where the profile is read from: 0.45 of the way along the midrib, a point the blade is
// star-shaped from (the radial profile holds it; the red oak has no such point). Width over length ~0.55, a pointed apex (28-43° to either side, 35° on average), no lobes.
const BEECH = Object.freeze({
  species: 3, grammar: 'pinnate', origin: 0.45, lenJitter: 0.06,
  W: 0.30, aBase: 0.55, cApex: 1.25,
  nMin: 9, nMax: 13, s0: 0.06, s1: 0.94, posJitter: 0.2,   // secondaries a side; they sit over s0..s1 of the midrib, each ±posJitter of a step off its place
  angle: 45, angleJitter: 4,
  tooth: 0.02, toothHalf: 0.05,
});
const LEAF_SHAPES = Object.freeze({ maple: MAPLE, beech: BEECH });

// One blade's vein skeleton, in the plane, from a spec and a stream. Returns { discs, veins, teeth }: the lamina as flat (x, y, r) triples, the
// veins as {a, b, order} for a picture, and the margin points the secondaries end at. THE STREAM IS THE CONTRACT: per primary its angle then its length,
// then one draw per secondary (its angle) — reorder them and every outline there is regrows differently.
function growLeaf(spec, rng){
  const discs = [], veins = [], teeth = [], prim = [];
  for(let p = 0; p < spec.angles.length; p++){
    const ang = (spec.angles[p] + (rng()*2 - 1)*spec.angleJitter)*DEG, len = spec.lengths[p]*(1 + (rng()*2 - 1)*spec.lengthJitter);
    const dx = Math.cos(ang), dy = Math.sin(ang), n = Math.ceil(len/0.01);
    for(let i = 0; i <= n; i++){
      const s = i/n;
      if(s >= spec.hub) discs.push(dx*len*s, dy*len*s, spec.rho*len*(1 - spec.taper*Math.max(0, (s - spec.hold)/(1 - spec.hold))));
    }
    veins.push({ a: [0, 0], b: [dx*len, dy*len], order: 1 });
    prim.push({ ang, len, dx, dy });
  }
  for(let p = 0; p < prim.length; p++){
    const { ang, len, dx, dy } = prim[p];
    let side = (p % 2) ? 1 : -1;
    for(let d = spec.secStep; d < len - 1e-9; d += spec.secStep){
      const bx = dx*d, by = dy*d, a2 = ang + side*spec.secAngle*DEG*(1 - spec.secJitter + 2*spec.secJitter*rng());
      const ex = Math.cos(a2), ey = Math.sin(a2), L = exitAlong(discs, bx, by, ex, ey);
      veins.push({ a: [bx, by], b: [bx + ex*L, by + ey*L], order: 2 });
      teeth.push([bx + ex*L, by + ey*L]);
      side = -side;
    }
  }
  return { discs, veins, teeth };
}

// How far a ray from (x, y) along the unit (dx, dy) stays inside the union of the discs — the exit, not the farthest root: a ray that leaves the lamina
// is out. Each disc cuts the ray in a chord [t0, t1]; the reach grows through every chord that holds it.
function exitAlong(discs, x, y, dx, dy){
  let reach = 0;
  for(let moved = true; moved;){
    moved = false;
    for(let i = 0; i < discs.length; i += 3){
      const ex = x - discs[i], ey = y - discs[i + 1], b = ex*dx + ey*dy, h = b*b - (ex*ex + ey*ey - discs[i + 2]*discs[i + 2]);
      if(h < 0) continue;
      const q = Math.sqrt(h);
      if(-b - q <= reach && -b + q > reach){ reach = -b + q; moved = true; }
    }
  }
  return reach;
}

// One pinnate blade's vein skeleton, in the plane and in the ORIGIN frame (the profile is read from there): the midrib runs +x from (−origin·len, 0) to ((1 − origin)·len, 0), and the apex is +x.
// Returns the same { discs, veins, teeth } as growLeaf, so everything downstream of the grammar (the profile, the teeth, the held leaf) is one body. The midrib is the one order-1 vein; each secondary
// is order 2, leaves the midrib at its position, runs out at its angle until it leaves the lamina (exitAlong) and ends in a tooth. The lamina is the midrib's discs alone: a secondary adds none.
// THE STREAM IS THE CONTRACT (pinnate.test.js replays it): len, W, a, c, asym, nSide, then per secondary, alternating sides, its position and then its angle — reorder them and every beech regrows.
// The disc radius is body(s) and does not scale with len, so the length is a draw of the leaf's ASPECT (it is area-normalised away, the radius is not): without that the length would move nothing.
const WIDTH_JITTER = 0.10, A_JITTER = 0.10, C_JITTER = 0.15, OBLIQUE = 0.06;   // W ±10%, the base's roundness a ±0.10, the taper c ±0.15, asym ±0.06 of a disc's radius
function growPinnate(spec, rng){
  const discs = [], veins = [], teeth = [], u = () => rng()*2 - 1;
  const len = 1 + u()*spec.lenJitter, W = spec.W*(1 + u()*WIDTH_JITTER), a = spec.aBase + u()*A_JITTER, c = spec.cApex + u()*C_JITTER, asym = u()*OBLIQUE;
  const nSide = spec.nMin + Math.floor(rng()*(spec.nMax - spec.nMin + 1));
  const peak = Math.pow(a/(a + c), a)*Math.pow(c/(a + c), c), ox = spec.origin*len, n = Math.ceil(len/0.01);
  for(let i = 0; i <= n; i++){
    const s = i/n, r = s > 0 && s < 1 ? W*Math.pow(s, a)*Math.pow(1 - s, c)/peak : 0;
    if(r > 0) discs.push(s*len - ox, asym*r, r);
  }
  veins.push({ a: [-ox, 0], b: [len - ox, 0], order: 1 });
  for(let i = 0; i < 2*nSide; i++){
    const side = (i % 2) ? 1 : -1, k = Math.floor(i/2);
    const s = spec.s0 + (spec.s1 - spec.s0)*(k + 0.5*(i % 2) + 0.25)/nSide + u()*spec.posJitter/nSide;
    const ang = (spec.angle + u()*spec.angleJitter)*DEG, bx = s*len - ox, ex = Math.cos(ang), ey = side*Math.sin(ang), L = exitAlong(discs, bx, 0, ex, ey);
    veins.push({ a: [bx, 0], b: [bx + ex*L, ey*L], order: 2 });
    teeth.push([bx + ex*L, ey*L]);
  }
  return { discs, veins, teeth };
}
const GRAMMARS = { palmate: growLeaf, pinnate: growPinnate };

// r(θ) of one variant: the farthest point of the blade along each of LEAF_SAMPLES rays from the leaf's origin — the far root of the farthest chord, which is
// the blade's reach on that ray whether or not the ray is whole inside it (the grammar's blade is star-shaped from its origin, a test holds that) — then the
// teeth, then the area normalisation. `variantSeed` is the stream's seed.
// bladeOf is that whole body with nothing thrown away: the skeleton the outline was grown from, and `k`, the area normalisation (r is already scaled by it) — so a
// consumer that wants the veins gets the SAME grammar run the outline came from, and skeleton points × k are in the outline's unit frame — and the grammar's name, since the
// veins of a palmate blade and a pinnate one are not cut into regions alike by the editor's held leaf. `profile` is its r.
function bladeOf(spec, variantSeed){
  const skel = GRAMMARS[spec.grammar](spec, mulberry32(variantSeed)), { discs, teeth } = skel, r = new Float64Array(LEAF_SAMPLES);
  for(let i = 0; i < LEAF_SAMPLES; i++){
    const th = TAU*((i + 0.5)/LEAF_SAMPLES - 0.5), c = Math.cos(th), s = Math.sin(th);
    let far = 0;
    for(let k = 0; k < discs.length; k += 3){
      const b = discs[k]*c + discs[k + 1]*s, h = b*b - (discs[k]*discs[k] + discs[k + 1]*discs[k + 1] - discs[k + 2]*discs[k + 2]);
      if(h >= 0) far = Math.max(far, b + Math.sqrt(h));
    }
    r[i] = far;
  }
  for(const [tx, ty] of teeth){
    const a = Math.atan2(ty, tx);
    for(let i = 0; i < LEAF_SAMPLES; i++){
      const th = TAU*((i + 0.5)/LEAF_SAMPLES - 0.5), d = Math.atan2(Math.sin(th - a), Math.cos(th - a));
      if(Math.abs(d) < spec.toothHalf) r[i] *= 1 + spec.tooth*(0.5 + 0.5*Math.cos(Math.PI*d/spec.toothHalf));
    }
  }
  let a = 0;
  for(let i = 0; i < LEAF_SAMPLES; i++) a += 0.5*r[i]*r[i]*(TAU/LEAF_SAMPLES);
  const k = Math.sqrt(Math.PI/a);
  for(let i = 0; i < LEAF_SAMPLES; i++) r[i] *= k;
  return { skel, r, k, grammar: spec.grammar };
}
const profile = (spec, variantSeed) => bladeOf(spec, variantSeed).r;
// The seed of variant v's stream: the grove's seed, the outline salt and the species — so a re-seeded grove grows other outlines, and no two species share a draw.
const outlineSeed = (spec, seed, v) => hash3((seed>>>0)^OUTLINE_SALT, spec.species, v);

// A leaf's outline, by the address that never moves: one of LEAF_VARIANTS, a pure function of (seed, cluster, leaf) on its own salt. The grove (which
// outline it hangs in) and the litter (which it lies in) both ask here, so a fallen leaf keeps its shape.
function leafVariant(seed, j, k){
  return Math.floor(mulberry32(hash3((seed>>>0)^VARIANT_SALT, j, k))()*LEAF_VARIANTS);
}

// Whether a hanging leaf is turned a half turn past the grove's draw. The grove draws a leaf's angle on [0, π), every orientation there is for an ellipse
// (it is the same leaf a half turn on) and half of them for an outline, which is not: every tip would point into one half-plane. A pure function of
// (seed, cluster, leaf) on its own salt, so the growth stream and every ellipse grove keep their bytes.
function leafFlip(seed, j, k){
  return mulberry32(hash3((seed>>>0)^FLIP_SALT, j, k))() < 0.5;
}

// A species' outlines for a seed, as the grove hands them to the bake: the LEAF_VARIANTS profiles in one buffer (a texture's rows, rounded to the float32 it
// uploads), the box the quad has to cover — the union of the variants' extents in the unit frame, as `[cx, cy, hx, hy]` (centre and half-size) — and `reach`, the
// farthest corner of it from the origin (the litter's cull radius, in leaf units), and `rmax`, the longest radius of any outline (the faithful cast frame's pad). null is the ellipse: no profile, no box, nothing to upload. Memoised on
// (shape, seed): the engine asks per regrow, the litter per bake, the harness per check — and a name with no outline yet is the ellipse, not an error.
const memo = new Map();
function leafShape(name, seed){
  const spec = LEAF_SHAPES[name];
  if(!spec) return null;
  const key = `${name}|${seed>>>0}`;
  let g = memo.get(key);
  if(!g){
    const data = new Float32Array(LEAF_VARIANTS*LEAF_SAMPLES);
    for(let v = 0; v < LEAF_VARIANTS; v++) data.set(profile(spec, outlineSeed(spec, seed, v)), v*LEAF_SAMPLES);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for(let v = 0; v < LEAF_VARIANTS; v++) for(let i = 0; i < LEAF_SAMPLES; i++){
      const th = TAU*((i + 0.5)/LEAF_SAMPLES - 0.5), r = data[v*LEAF_SAMPLES + i], x = r*Math.cos(th), y = r*Math.sin(th);
      if(x < x0) x0 = x;
      if(x > x1) x1 = x;
      if(y < y0) y0 = y;
      if(y > y1) y1 = y;
    }
    const pad = 0.01, hx = (x1 - x0)/2 + pad, hy = (y1 - y0)/2 + pad, cx = (x0 + x1)/2, cy = (y0 + y1)/2;   // pad: half float's rounding of r, and the arc between two samples bulging past their chord
    let rmax = 0;
    for(let i = 0; i < data.length; i++) rmax = Math.max(rmax, data[i]);
    g = { name, data, rows: LEAF_VARIANTS, box: [cx, cy, hx, hy], reach: Math.hypot(Math.abs(cx) + hx, Math.abs(cy) + hy), rmax };
    if(memo.size >= 8) memo.delete(memo.keys().next().value);
    memo.set(key, g);
  }
  return g;
}

export { LEAF_SAMPLES, LEAF_VARIANTS, LEAF_ID_FRAC, OUTLINE_SALT, VARIANT_SALT, FLIP_SALT, MAPLE, BEECH, LEAF_SHAPES, growLeaf, growPinnate, bladeOf, profile, outlineSeed, leafVariant, leafFlip, leafShape };
