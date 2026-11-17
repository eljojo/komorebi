// ============================================================================
// The Canopy, grown (spec/model/canopy.md) — buildGrove: a grove of recursive trees
// (leader, droop, taper, phyllotaxis), leaves hung on terminal twigs and
// binned to depth layers, the woody occluder segments, the faithful-path
// geometry, and the per-clump data textures — allocated and RETURNED as one
// grove value (installGrove, in the engine, makes one active). A factory over
// the engine's shared internals (hub).
//
// RE-SEASONING (spec/model/season.md, P2b). The season is a function of the grove, not a regrow: a phenology change moves each leaf's tau, the retained weight w, which leaves
// are compacted out, the litter list and leafW — and nothing else. The skeleton, every leaf's place, size, orientation, height and cluster address, the exposure field
// and its keyed rank are the GROVE's. So a grove built with `keepSeason` keeps a per-leaf record (`g.season`), and reseasonGrove re-runs the season arithmetic
// over it in one pass on typed arrays, landing BIT FOR BIT where a fresh buildGrove at the same params lands (reseason.test.js holds it, over every variant): the
// slider's last tick is the resting state and nothing regrows on release.
//   THE KEY. `season.key` is every param buildGrove READS except the season set (komorebi-params.js SEASON_KEYS), plus faithfulOn(). The engine re-seasons only
//   while the key still matches; a changed key regrows. GROVE_READS is derived from `grep -n "params\." komorebi-grove.js` and reseason.test.js greps again, so a
//   new read cannot slip past the key. Every grove carries its key (`grove.key`, cache or not), so the engine can tell a regrow whose structure is the one on screen from one
//   whose structure is still moving: only the first keeps the record, because the next tick of a moving structure would throw it away.
//   THE CACHE IS LAZY. A summer build keeps no record (rec exists only when lit || dropping, and recording always costs ~5 ms and ~7 MB a regrow): the first
//   'season' apply on a grove without one does one full build with keepSeason (when the structure it builds is the one on screen; see THE KEY). The exposure field and its keyed rank are kept from that build when it ran the
//   pass, and otherwise built by the first re-season whose gate needs `u`; the rank is never written into (exposureBlend hands it back itself at exposure_absolute 0).
//   GOTCHAS. A and B0 are kept as DOUBLES: the litter's `size` is read from the doubles in buildGrove, and a float32 copy differs in the last bits. A re-season writes
//   into the EXISTING buffers (layerVAO[l].buf, faith.buf), so the VAO pointers stay valid; it never touches `gr`, the hier springs, clusterData, clusterTex or leafTex —
//   which is also why there is no shallow-copy grove: installGrove would free the textures it shared. faith.* is engine-global (a second grove built for a transition
//   writes it), so the engine re-seasons only with no transition or a season-only grove morph, and with faith.buf still this grove's. leafW is a NEW array each time: the tree preview keys on it.
//   MEASURED (bun, median of 7, fall at t 0.9): afternoon 7 73 ms a regrow, the void 201, montebello 15 — see the cost test in reseason.test.js for the re-season's.
//   DENSITY CAPACITY. A fixed summer grove can keep a larger per-cluster prefix and reweight its active leaves. Its separate key excludes density, but its gate excludes pigment, drop and variety;
//   opening those rebuilds the actual population before any exposure rank is needed. Ordinary builds and season records retain their original keys and arithmetic. The active count and cast bounds follow the prefix.
// ============================================================================
import { DEG, GOLDEN, clamp, hash3, lerpAngle, makeGauss, mulberry32, smoothstep } from './komorebi-math.js';
import { afterTurn, springing, springDraws, leafSpring, springTau, dropDay, dropDayAfterTurn, dropHash, dropPhase, exposureBlend, exposureGrid, exposureRank, leafClock, leafTau, LEAF_SCHED, leafDraws, leafPigments, leafTauAt, turnWindow, lit, ordered, redGain, retention, senescing, dropping, treeGains, treeGenotype, treeShifts, turnOrder, turnPhase } from './komorebi-season.js';
import { growSkeleton } from './komorebi-grammar.js';
import { leafSide } from './komorebi-leaf.js';

const FAITH_MAX_RATIO = 1.7;   // faithful-tree height cap (spec/model/canopy.md): max crown height:radius before crown_aspect. A broad tree (mr above mz/RATIO) keeps its natural height untouched; a NARROW tree (steep branches → tiny mr → runaway plan-fill scale → tens of metres tall) gets its height clamped to crown·RATIO·aspect. Lower = shorter narrow trees.

// The fall tiers this module owns, as the bundler sees them (embed-build.mjs): each is substituted by a literal, true or false, and the code behind a false one is not
// in the bundle. A tier is cut only for a look that does not open it (komorebi-params.js FEATURES), so a flag that is false here means the guarded arithmetic was
// already unreachable for every look the bundle carries. The flags sit in the SAME expression as the call they guard, never in a predicate function or a local that
// holds one (`const sen = FEAT_X && ...`): a minifier inlines neither, and the arithmetic behind a guard it cannot fold stays in the bundle.
const FEAT_PIGMENT = true;
const FEAT_SPRING = true;
const FEAT_EXPOSURE = true;
const FEAT_DROP = true;
const FEAT_LITTER = true;
import { MAX_LAYERS, MAX_OCC, TOPO_KEYS, CANOPY_KEYS, SEASON_KEYS } from './komorebi-params.js';
import { growBuds, limbs as budLimbs } from './komorebi-growth.js';
import { SHOOT, clusterLight, clusterShoots, lightTilt, shootLeaf } from './komorebi-shoots.js';
import { LEAF_SHAPES, LEAF_ID_FRAC, LEAF_SAMPLES, SIZE_LIGHT, VARIETY_COLUMNS, VARIETY_REAL, VARIETY_GENOTYPES, VARIETY_ID_FRAC, leafColumn, leafColumnF, leafFlip, leafJitter, leafShape, leafVariant } from './komorebi-leaf.js';

// Every param buildGrove reads besides the season set, and so the whole of `season.key` (faithful_canopy and receiver reach it through faithfulOn(), which the key carries
// as the boolean it is). Held against a grep of this file in reseason.test.js.
export const GROVE_READS = [
  'branch_angle_deg','branch_children','branch_length_ratio','branch_levels','branch_pitch_deg','canopy_base_height_m','canopy_extent_m','canopy_thickness_m',
  'cluster_spread_m','crown_aspect','drop_after_turn','droop','faithful_canopy','foliage_density','grove_reach_m','growth_years','inner_leaves','layer_count','leader_strength','leaf_aspect','leaf_shape','leaf_size_m','leaf_variety','leaves_per_cluster',
  'limb_count','max_tilt','phyllotaxis','receiver','seed','shoot_leaves','sky_view','standing_scene','taper_delta','tilt_light','tree_count','trunk_radius_m','view_extent_m',
];
// Grow a grove as `look` would, on the live params: every key the build reads (the grove's own, the season set within the canopy keys,
// the topology) is the look's for the length of `build` and is put straight back after, so nothing else in the frame notices. A route
// grows the grove it lands on this way while the MORPH keys the grove also reads (the view extent sizes a park crown) are still tweening.
const GROWN_KEYS = [...new Set([...GROVE_READS, ...TOPO_KEYS, ...CANOPY_KEYS])];
export function growAs(params, look, build){
  const saved = {};
  for(const k of GROWN_KEYS){ saved[k] = params[k]; params[k] = look[k]; }
  try { return build(); } finally { for(const k of GROWN_KEYS) params[k] = saved[k]; }
}
export const seasonKey = (params, faithful) => `${GROVE_READS.map(k => params[k]).join('|')}|${faithful ? 1 : 0}`;
// Density can reuse a prefix only without population-dependent pigment, drop or outline work. It remains a structural key for ordinary re-seasoning.
export const densityEligible = P => !senescing(P) && !(FEAT_SPRING && springing(P)) && P.leaf_drop === 0 && P.leaf_variety === 0;
const DENSITY_READS = GROVE_READS.filter(k => k !== 'foliage_density');
export const densityKey = (P, faithful) => `${DENSITY_READS.map(k => P[k]).join('|')}|${faithful ? 1 : 0}`;
export const densityCount = (P, density = P.foliage_density) => {
  const pcF = Math.max(0, P.leaves_per_cluster*density), pcInt = Math.floor(pcF);
  return pcInt + (pcF-pcInt > 1e-4 ? 1 : 0);
};
// THE TIERS' KEYS (reseasonGrove): the STATE keys move only each leaf's state now; the rest of the season set moves its schedule. drop_after_turn is a grove key (a regrow), named
// here because the schedule reads it; the seed, which the draws read, is a grove key too and is never reached by a record that still matches.
const STATE_KEYS = ['phenology', 'trans_r', 'trans_g', 'trans_b', 'wall_fraction'];
export const SCHEDULE_KEYS = [...SEASON_KEYS.filter(k => !STATE_KEYS.includes(k)), 'drop_after_turn'];
const SREC = 11;   // a season record: x, y, h, A, B0, area, j, k, cov, layer, start of the leaf's 17 floats in its layer's buffer (the faithful record's first 16 are the same numbers)

// A FULL CROWN (spec/model/canopy.md, `inner_leaves`). Only a terminal twig bears leaves, so from above a grown crown is a wheel: a ring of leaves at the shell, a core a third as dense, bare limbs for spokes. A real crown carries shade
// leaves on the older wood too, thinning inward and never to zero. So each leaf has TWO places, and the knob is the share that takes the second: its TIP place (today's, verbatim: the hug or the blob off the twig's
// tip, at the twig's height) and a WOOD place, a point on the twig's whole ancestor path back to the trunk (math.growSkeleton's `out.path`, hier.twigPath) at the arc distance d = u²·pathLen from the tip — a density
// that falls as d^(-1/2) — with the twig hug's own scatter, tighter, about the wood (back along its heading, or an isotropic blob on the layer path), at the HEIGHT of that point. (h, u) are the leaf's own two draws, from
// a hash on a salt of its own: nothing is drawn from the growth, arrangement or wind streams, and a leaf's (h, u) is a pure function of (seed, j, k), so a tree_count or density morph moves nobody. The leaf is on the
// wood by the smoothstep s = (inner_leaves − h) over INNER_GLIDE: a slider moves each leaf inward along its own line and pops none (spec/contracts/continuity.md), and `inner_leaves` is a share — the count and the area are the look's.
// THE GATE: at 0 (or without a recorded path) the else is the literal old placement and the hash is never reached; the grove records no path then either. ONE FUNCTION for the hang loop and the editor's tree preview,
// which draws the same two gaussians, so what the preview shows is what the cast was handed. Writes [x, y, z] into `out`. (The params are named `params` here as in buildGrove: the key's grep, reseason.test.js, reads this file for `params.<key>`.)
// WIND, named: a faithful leaf pivots about its twig's base (clusterGeom), so a leaf on older wood swings with its twig and slides off the limb under the medium band (measured in inner.test.js; not fixed here — it
// needs a per-leaf pivot weight and a shader slot).
export const INNER_SALT = 0xDAA66D2B;   // 3·0x9E3779B9 mod 2^32: the golden gamma's next multiple after the per-tree salt's 2· (komorebi-season.js), in no other stream
const INNER_GLIDE = 0.05;        // the smoothstep's width in `inner_leaves`: a leaf is wholly on the wood this far past its own h
// A height's layer over a grove's band [zMin, dz, nLayer] (hier.layerBand): higher foliage, higher layer. The hang loop bins twigs and leaves by it, and leaf travel a layered leaf.
export const layerOfHeight = (z, [zMin, dz, nLayer]) => nLayer>1 ? clamp(Math.round((z-zMin)/dz*(nLayer-1)), 0, nLayer-1) : 0;
// The layer leaf j's leaf at height z hangs in, as the hang loop binned it: one at its twig's height (to the float a leaf record keeps) is on its twig's layer, one on the wood on its own height's.
export const leafLayerOf = (hier, j, z) => { const t = hier.twigs[j]; return hier.layerBand && z !== Math.fround(t.z) ? layerOfHeight(z, hier.layerBand) : t.layer; };
// The outward plan heading (older end -> nearer the tip) of segment i of a path of n segments into `e`, or of the nearest segment that has one: a vertical step has no direction in plan. False when none does.
function woodHeading(path, i, n, e){
  for(let o=0;o<n;o++) for(let side=0;side<2;side++){
    if(o === 0 && side) continue;
    const q = side ? i+o : i-o;
    if(q < 0 || q >= n) continue;
    const hx = path[3*q]-path[3*q+3], hy = path[3*q+1]-path[3*q+4], hl = Math.hypot(hx, hy);
    if(hl > 1e-6){ e[0] = hx/hl; e[1] = hy/hl; return true; }
  }
  return false;
}
const _heading = [0,0];
// A GROWN SHOOT'S LEAVES (growth_years > 0). A grown tree's cluster is a bundle of neighbouring shoots (komorebi-growth.js, THE LEAF
// BUDGET), and hier.twigShoots[j] holds each one's own wood, tip first. Leaf k of cluster j hangs on shoot k mod the bundle's size, so
// every shoot carries its share, at a uniform arc distance along that shoot's wood, off it by a stalk across the wood's 3-D
// direction at a uniform azimuth: a real shoot carries its leaves along its whole length, each on its own stalk, pointing any way
// about the stem. Held level at the twig's tip, every cluster was a flat line, and the crown, seen from the side, rows of dots.
// The (d, azimuth, stalk) draws are a hash of (seed, j, k) on a salt of their own, like inner_leaves'.
export const SHOOT_SALT = 0x78DDE6E4;   // 4·0x9E3779B9 mod 2^32: the golden gamma's next multiple after the inner leaves' salt, in no other stream
export const TREE_PACE_SALT = 0xF1BBCDC8;   // 8·0x9E3779B9 mod 2^32: the golden gamma's first multiple no stream holds (5· is the leaf's side, 6· the shoots' own, 7· the leaves' emergence): a tree's own pace (sway_spread)
function shootPlace(bundle, params, j, k, o){
  const path = bundle[k % bundle.length], m = path.length/3 - 1;   // segments 0..m-1: the shoot's own wood
  if(m < 1) return false;
  let len = 0; for(let i=0;i<m;i++) len += Math.hypot(path[3*i]-path[3*i+3], path[3*i+1]-path[3*i+4], path[3*i+2]-path[3*i+5]);
  if(!(len > 0)) return false;
  const r = mulberry32(hash3((params.seed>>>0)^SHOOT_SALT, j, k));
  let rem = r()*len, i = 0, L = 0;
  for(;i<m;i++){ L = Math.hypot(path[3*i]-path[3*i+3], path[3*i+1]-path[3*i+4], path[3*i+2]-path[3*i+5]); if(rem <= L || i === m-1) break; rem -= L; }
  const f = L > 0 ? Math.min(rem/L, 1) : 0;
  const ex = (path[3*i]-path[3*i+3])/(L||1), ey = (path[3*i+1]-path[3*i+4])/(L||1), ez = (path[3*i+2]-path[3*i+5])/(L||1);   // toward the tip
  const rx = Math.abs(ez) < 0.9 ? 0 : 1, rz = Math.abs(ez) < 0.9 ? 1 : 0;   // a reference off the wood's direction
  let ux = ey*rz, uy = ez*rx - ex*rz, uz = -ey*rx; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;   // e × ref
  const wx = ey*uz - ez*uy, wy = ez*ux - ex*uz, wz = ex*uy - ey*ux;   // e × u
  const th = r()*Math.PI*2, st = params.cluster_spread_m*(0.3 + 0.4*r()), c = Math.cos(th)*st, sn = Math.sin(th)*st;
  o[0] = path[3*i] + (path[3*i+3]-path[3*i])*f + c*ux + sn*wx;
  o[1] = path[3*i+1] + (path[3*i+4]-path[3*i+1])*f + c*uy + sn*wy;
  o[2] = path[3*i+2] + (path[3*i+5]-path[3*i+2])*f + c*uz + sn*wz;
  return true;
}
const _shoot = [0,0,0];
// LEAVES ON SHOOTS (komorebi-shoots.js, shoot_leaves): with the grove's shoots in hand (hier.leafShoots, hier.leafLight; null at shoot_leaves 0), leaf k
// hangs at its node on its shoot instead of where the twig hug and the inner leaves put it, and out[4] is its blade's heading, out[5] how much of it hangs
// there (1: the shoots are a switch). `lt` is the leaf's length (the grove's per-leaf size; the editor's preview hands the same). At 0 nothing below the old placement runs.
const _shootLeaf = [0,0,0,0,0,0];
export function placeLeaf(hier, j, g1, g2, k, params, faithful, out, lt = params.leaf_size_m){
  placeLeafOnWood(hier, j, g1, g2, k, params, faithful, out);
  out[5] = 0;
  const cs = hier.leafShoots ? hier.leafShoots[j] : null;
  if(!cs) return out;
  const spec = LEAF_SHAPES[params.leaf_shape], origin = spec ? (spec.origin ?? 0) : 0.5;   // where the stamp is placed from along the blade: the ellipse's middle, the outline's own origin
  shootLeaf(cs, j, k, hier.twigs[j], hier.leafLight[j], params, lt, origin, _shootLeaf, hier.twigPath ? hier.twigPath[j] : null, hier.twigPathLen ? hier.twigPathLen[j] : 0);
  const w = _shootLeaf[5];
  for(let c = 0; c < 4; c++) out[c] += (_shootLeaf[c] - out[c])*w;
  out[4] = _shootLeaf[4]; out[5] = w;
  return out;
}
function placeLeafOnWood(hier, j, g1, g2, k, params, faithful, out){
  const t = hier.twigs[j];
  let tdx=t.dx||0, tdy=t.dy||0; const tdl=Math.hypot(tdx,tdy), tHasDir=tdl>1e-4; if(tHasDir){ tdx/=tdl; tdy/=tdl; }   // unit twig heading (plan): the GROWN heading the bake stores on the twig (t.dx, t.dy, the end tangent), so the hug matches even on a drooped twig, in the grove and in the editor's preview (which calls this too) alike; leaves hug it
  // leaves HUG the twig (spec/model/canopy.md): trail back from the tip ALONG the twig heading (1.5×spread) with a tight perpendicular jitter (0.4×spread), instead of an isotropic blob. Same two draws → other attributes unchanged.
  const hug = faithful && tHasDir;   // twig-hug only in faithful mode; the layer/park scatter stays byte-identical
  let x = hug ? t.x - Math.abs(g1)*params.cluster_spread_m*1.5*tdx - g2*params.cluster_spread_m*0.4*tdy : t.x + g1*params.cluster_spread_m;
  let y = hug ? t.y - Math.abs(g1)*params.cluster_spread_m*1.5*tdy + g2*params.cluster_spread_m*0.4*tdx : t.y + g2*params.cluster_spread_m;
  let z = t.z;
  const path = hier.twigPath ? hier.twigPath[j] : undefined, n = path ? path.length/3 - 1 : 0;
  const bundle = hier.twigShoots ? hier.twigShoots[j] : undefined;
  if(faithful && bundle && shootPlace(bundle, params, j, k, _shoot)){ x = _shoot[0]; y = _shoot[1]; z = _shoot[2]; }
  out[0] = x; out[1] = y; out[2] = z; out[3] = 0;
  if(!(params.inner_leaves > 0)) return out;
  if(n < 1) return out;
  const r = mulberry32(hash3((params.seed>>>0)^INNER_SALT, j, k)), h = r(), u = r();
  const s = smoothstep(h, h + INNER_GLIDE, params.inner_leaves);
  if(s === 0) return out;                                // still at its tip: the else, exactly
  let rem = u*u*hier.twigPathLen[j], i = 0, L = 0;       // walk the path from the tip to the arc distance d
  for(;i<n;i++){
    L = Math.hypot(path[3*i]-path[3*i+3], path[3*i+1]-path[3*i+4], path[3*i+2]-path[3*i+5]);
    if(rem <= L || i === n-1) break;
    rem -= L;
  }
  const f = L > 0 ? Math.min(rem/L, 1) : 0;
  const qx = path[3*i] + (path[3*i+3]-path[3*i])*f, qy = path[3*i+1] + (path[3*i+4]-path[3*i+1])*f, qz = path[3*i+2] + (path[3*i+5]-path[3*i+2])*f;
  const sp = params.cluster_spread_m;
  let wx, wy;
  if(faithful && woodHeading(path, i, n, _heading)){      // hug the older wood like the twig: back along its heading, a tighter jitter across it
    const ex = _heading[0], ey = _heading[1];
    wx = qx - Math.abs(g1)*sp*0.5*ex - g2*sp*0.4*ey; wy = qy - Math.abs(g1)*sp*0.5*ey + g2*sp*0.4*ex;
  } else { wx = qx + g1*sp*0.4; wy = qy + g2*sp*0.4; }    // the layer path's blob, tighter about the wood
  out[0] = x + (wx - x)*s; out[1] = y + (wy - y)*s; out[2] = z + (qz - z)*s;
  let m = 0; while(m < n && !(path[3*m] === t.bx && path[3*m+1] === t.by)) m++;   // segments 0..m-1: the twig's own wood, tip back to its grown base
  out[3] = i >= m ? s : 0;                                // PIVOT WEIGHT: on older wood the leaf drops its twig's bend, by its share on the wood
  return out;
}

// each clump's depth in its own tree's crown, into airData's .y: the share of its tree's clumps more exposed than it,
// 0 on the skin, toward 1 at the core, so a wind that reaches depth R moves the outer R of every crown whatever its
// shape. A clump is exposed as far out from its trunk as the crown reaches (r / rMax) or as high in it (z over the tree's
// own height range), whichever is more: the rim and the top take the wind first, the low inner clumps near the trunk
// last. Approximation: a dome, not the crown's real hull, and the same from every side whatever the wind's direction.
export function crownDepth(twigs, out){
  const trees = new Map();
  for(let j=0;j<twigs.length;j++){ const t = twigs[j], k = `${t.tx},${t.ty}`; if(!trees.has(k)) trees.set(k, []); trees.get(k).push(j); }
  for(const js of trees.values()){
    let rMax = 0, zLo = Infinity, zHi = -Infinity;
    for(const j of js){ const t = twigs[j]; rMax = Math.max(rMax, Math.hypot(t.x - t.tx, t.y - t.ty)); zLo = Math.min(zLo, t.z); zHi = Math.max(zHi, t.z); }
    const ex = js.map(j => { const t = twigs[j];
      return Math.max(rMax > 1e-6 ? Math.hypot(t.x - t.tx, t.y - t.ty)/rMax : 1, zHi - zLo > 1e-6 ? (t.z - zLo)/(zHi - zLo) : 1); });
    const sorted = Float64Array.from(ex).sort(), n = js.length;
    js.forEach((j, i) => {
      let lo = 0, hi = n;   // the first exposure above this one's: everything from there on is more exposed
      while(lo < hi){ const m = (lo + hi) >> 1; if(sorted[m] > ex[i]) hi = m; else lo = m + 1; }
      out[4*j+1] = n > 1 ? (n - lo)/(n - 1) : 0;
    });
  }
}
export function makeGrove(hub){
  const { gl, params, MAX_TEX, quadBuf, faithfulOn, occ, faith, sky } = hub;

  // THE DRAWS, KEPT. A cluster's arrangement and wind streams are functions of (seed, cluster) alone, and the hang loop takes
  // them in one fixed order whatever the other knobs say, so the numbers cluster j's first n leaves draw are the same on every
  // regrow under that seed. They are drawn once and read back: a grove morph regrows every frame (spec/model/transitions.md), and its frames pay for
  // hanging the leaves, not for drawing them. Per cluster its two wind draws (sway, stem); per leaf, in stream order, the two
  // gaussians and seven arrangement draws, then its two wind draws. Held for the engine's life, as large as the busiest grove
  // grown under the seed; a new seed starts over.
  const DRAW = 11;
  let drawSeed = null, drawn = [];
  function clusterDraws(j, nLeaf){
    const seed = params.seed>>>0;
    if(seed !== drawSeed){ drawSeed = seed; drawn = []; }
    const had = drawn[j];
    if(had && had.n >= nLeaf) return had;
    const n = Math.max(nLeaf, had ? 2*had.n : 0), a = new Float64Array(n*DRAW);
    const rng  = mulberry32(hash3(seed, j, 101));               // arrangement stream
    const rng2 = mulberry32(hash3(seed^0x5bd1e995, j, 101));    // wind-identity stream (separate)
    const gauss = makeGauss(rng);
    const sway = rng2(), stem = rng2();
    for(let k=0, b=0;k<n;k++, b+=DRAW){
      a[b] = gauss(); a[b+1] = gauss();
      for(let i=2;i<9;i++) a[b+i] = rng();
      a[b+9] = rng2(); a[b+10] = rng2();
    }
    drawn[j] = { n, a, sway, stem };
    return drawn[j];
  }

  // ---- canopy generation: grow a real recursive skeleton, hang one leaf cluster on each
  // terminal twig, and bin them into depth layers by the height they grew to (spec/model/canopy.md) ----
  // ---- BUILD A GROVE (spec/model/canopy.md, spec/implementation.md). Pure in the sense that matters: it allocates and returns a grove, it does
  // not install one. That is what lets a transition hold TWO — the outgoing one still drawing while the incoming
  // one is grown — instead of the midpoint swap being the only way a topology change can happen.
  // (occ and faith are still written straight to engine state below. They belong to the ACTIVE grove, and the
  // crossfade's gate excludes both of their consumers — wood needs branch_tau > 0, faith needs faithfulOn() —
  // so a second grove never needs its own copy of either. If that gate ever widens, they move in here too.)
  // THE BUILD IS TWO HALVES. growGrove is the arithmetic: it reads the params and makes plain data (the skeleton, every leaf, the season, the wood's tables), and
  // touches neither the GPU nor the engine's shared state. uploadGrove hands that data to the GPU and to faith.*, occ.* and sky.*, reading nothing but what it was
  // handed. buildGrove is the two in a row and is what every caller uses; the halves are apart so a grove can be grown ahead of the frame that shows it
  // (grove-build.test.js holds both properties).
  function buildGrove(prevHier, opts){ return uploadGrove(growGrove(prevHier, opts)); }
  function growGrove(prevHier, { keepSeason = false, densityCapacity = null } = {}){
    const cacheDensity = densityCapacity !== null && densityEligible(params);
    keepSeason ||= cacheDensity;
    const E = params.canopy_extent_m;
    const tau = [
      -Math.log(clamp(params.trans_r,1e-4,0.999)),
      -Math.log(clamp(params.trans_g,1e-4,0.999)),
      -Math.log(clamp(params.trans_b,1e-4,0.999)),
    ];
    const pcF = Math.max(0, params.leaves_per_cluster*(cacheDensity ? Math.max(params.foliage_density, densityCapacity) : params.foliage_density));
    const pcInt = Math.floor(pcF);
    const frac = pcF - pcInt;                         // marginal leaf fades in by this
    const nLeaf = pcInt + (frac>1e-4 ? 1 : 0);
    const TAU2 = Math.PI*2;
    // THE LEAF'S OUTLINE (spec/model/leaf.md, P4a-2): null is the ellipse — the stamp's own line, and nothing below is asked of it. A grove OWNS its outline (like its cluster
    // textures), because a transition's crossfade bakes two groves into one layer texture and they may not share one.
    const shape = leafShape(params.leaf_shape, params.seed, params.leaf_variety);
    // LEAF VARIETY (spec/model/leaf.md): only an outline varies — the ellipse has no outlines to choose among — and only above 0. Below it every line of this function is the one it always was.
    const vary = !!shape && params.leaf_variety > 0;

    // ---- grow a GROVE: tree_count trees whose trunks spread across the view region with overlapping
    // crowns. Each tree is a trunk -> limb_count arms (rising by branch_pitch, fanned around the
    // circle) -> branch_children sub-branches per node (cone-fanned, shrunk by branch_length_ratio)
    // recursing branch_levels deep; TERMINAL branches are twigs, each carrying one leaf cluster. Big
    // gaps fall between limbs, small gaps between leaves — multi-scale, for free (spec/model/canopy.md). A grove
    // (not one centred tree) fills the centre and matches the park: several trees, the smaller ones
    // reading denser (the same cluster packed into a smaller crown). ----
    // tree_count is CONTINUOUS so a tree-count transition can morph (spec/model/canopy.md, transitions.md): floor(count) full trees
    // plus a marginal tree faded in by the fraction. At an integer count it's exactly floor trees, no partial.
    const treeCountF = Math.max(1, params.tree_count);
    const nFull  = Math.floor(treeCountF);
    const tFrac  = treeCountF - nFull;                  // marginal-tree coverage; 0 at integer counts
    const nTree  = nFull + (tFrac>1e-4 ? 1 : 0);        // trees actually built this frame
    // One tree ahead of its neighbours (spec/model/season.md): each tree's lead (its clocks run Δ sooner) and depth (its red and brown × c), drawn from (seed, tree index) on a salt of their own, so a tree keeps its numbers
    // as the grove grows and the marginal tree has its own. Tables of nTree, or null while the knob is 0 (no draw, nothing handed on). They touch only a leaf's tau and day; the growth stream is never drawn from.
    // Each table is built only where a tier that reads it is in the bundle: the lead by leafTau (pigment, exposure) and by the two drop days (drop), the depth by leafTau alone. The parentheses are load-bearing: the bundler
    // folds a dead `false ? A : B` as TEXT (embed-build.mjs foldDeadTernaries) and would take the last operand of a bare `||` for the whole condition.
    const tShift = (FEAT_PIGMENT || FEAT_EXPOSURE || FEAT_DROP) ? treeShifts(params, nTree) : null, tGain = (FEAT_PIGMENT || FEAT_EXPOSURE) ? treeGains(params, nTree) : null;
    const lpt    = Math.max(1, params.limb_count|0);   // limbs per tree
    const levels = Math.max(1, params.branch_levels|0);
    const kids   = Math.max(1, params.branch_children|0);
    const lenRatio = clamp(params.branch_length_ratio, 0.2, 0.95);
    const coneA  = params.branch_angle_deg*DEG;
    const limbEl = params.branch_pitch_deg*DEG;        // how steeply limbs rise from horizontal
    const nLimb  = nTree*lpt;                           // global limb count
    const gr = mulberry32(hash3(params.seed>>>0, 0x5EED, 7));   // growth stream (own RNG)
    const segments = [];     // {a,b,level} world-space skeleton, kept for the 3D view ([3])
    const twigs = [];        // terminal nodes: {x,y,z, limb, tx,ty} — plan x,y, height z, global limb, tree trunk
    // `inner_leaves` (placeLeaf): the path each twig grew along, collected only while the knob is up — a PARALLEL structure to twigs (hier.twigPath, hier.twigPathLen), never a key of a twig record, which the skeleton pin digests whole.
    // A flat run of doubles per twig, tip first, through the very sc() that scales the twig and the segments; its 3-D arc.
    const wantPath = params.inner_leaves > 0, twigPath = [], twigPathLen = [];
    // a grown tree's cluster is a bundle of shoots, each carrying its share of the leaves along its own wood (shootPlace): per twig, each shoot's wood, tip first, through sc()
    const twigShoots = Math.round(params.growth_years) > 0 ? [] : null;
    const limbDir  = new Float32Array(nLimb*2);         // plan unit direction (drives wind torque)
    const limbPlan = new Float32Array(nLimb*2);         // an outboard wind-sample point near each limb
    const treePos = new Float32Array(nTree*2);          // each tree's trunk in plan: where the gust reaches it (komorebi-motion.js, the trunks)
    const treeCrown = new Float32Array(nTree), treePace = new Float32Array(nTree);   // its crown's plan radius (m), the wake it casts (komorebi-air.js, shelter); and its own pace (TREE_PACE_SALT, below)
    const limbAttach = new Float32Array(nLimb);         // the height at which each limb MEETS its trunk — sway_pitch anchors its depth-foreshorten here so the join can't open (spec/model/motion.md). Filled LOCAL in the growth loops, then scaled into world height units with the rest of the tree.

    // crowns overlap so the canopy fills a span of ground (not just the baked extent), capped to fit inside the bake. The span is the
    // look's reach; a look that names none (0) takes the view's extent as it stands at this build, so its grove fills the frame it loads in.
    // The grove keeps what it was grown for (grove.reach): the engine names it for the look once the view has moved (holdReach).
    const reach = params.grove_reach_m > 0 ? params.grove_reach_m : params.view_extent_m;
    const Rfill = Math.min(E*0.46, Math.max(0.5, reach));
    // crown radius. PARK model: tied to the view so crowns fill the frame. STANDING scene (spec/model/transport.md): a natural,
    // fixed fraction of the bake extent instead — so a single tree's crown fits the texture (the view-tied size
    // overflows and clips it) and the tree reads as a discrete object, not a frame-filling canopy.
    const crown0 = params.standing_scene ? E*0.26 : (Rfill/Math.sqrt(treeCountF))*1.7;
    const trunkH = crown0*0.6;                          // a real trunk lifts each crown off the ground.
    // It's a CONSTANT (same for every tree), so it only offsets z uniformly — the relative layer-binding
    // below is unchanged, i.e. the cast dapples are untouched; only the 3D structure/preview gains height.

    const L = clamp(params.leader_strength, 0, 1);   // 0 = legacy single-hub; >0 = monopodial leader (limbs ALONG a trunk)
    const droop = clamp(params.droop, -1, 1);        // signed gravitropic curve: >0 sag down (willow/birch), <0 upsweep (conifer); 0 = straight rays
    const phyllo = params.phyllotaxis==='opposite' ? 2 : params.phyllotaxis==='whorled' ? 1 : 0;   // child-azimuth rule (spec/model/canopy.md)
    const years = Math.max(0, Math.round(params.growth_years));   // > 0: each tree grown year by year from buds (komorebi-growth.js) instead of by the grammar

    const grammar = { levels, kids, lenRatio, coneA, droop, phyllo, leader:L>0 };   // the tree's grammar, whole (math.growSkeleton): everything a node needs to grow its children, bar the root

    for(let tt=0;tt<nTree;tt++){
      // trunk placement: Vogel disk so trees spread evenly; the first tree sits at the centre.
      const treeCov = (tt===nFull) ? tFrac : 1.0;        // the marginal tree fades in by coverage (1 for full trees)
      const rr = Rfill*Math.sqrt(tt/treeCountF);         // normalise by the continuous count -> trees re-space smoothly as it morphs
      const aa = tt*GOLDEN + (gr()-0.5)*0.6;
      const tx = rr*Math.cos(aa), ty = rr*Math.sin(aa);
      treePos[2*tt] = tx; treePos[2*tt+1] = ty;
      const crown = crown0*(0.7+0.6*gr());               // per-tree size variation (smaller -> denser)
      // ITS OWN PACE (sway_spread): how fast this tree sways against the look's sway_stiffness, at sway_spread 1. A tree's natural
      // frequency is f ∝ d/H², and trees grow their trunks thicker as they grow taller (elastic similarity, d ∝ H^1.5), so
      // f ∝ H^−½: a bigger crown sways slower, as its size^−½. Same-sized trees differ too (wood, form): ±10 % on a draw of the
      // tree's own (seed, tree), never the growth stream, so the grove grows as it did. Provisional: the ±10 %.
      treeCrown[tt] = crown;
      treePace[tt] = Math.pow(crown/crown0, -0.5)*(1 + 0.1*(2*mulberry32(hash3((params.seed>>>0)^TREE_PACE_SALT, tt, 0))() - 1));
      const out = { seg:[], tw:[], path: wantPath ? [] : null, shoots: twigShoots ? [] : null };
      const limbBase = tt*lpt, limbRaw = new Float32Array(lpt*2);
      let leaderTop = 0, limbTop = 0;   // limbTop = highest limb-attach height (local); the trunk must at least reach it
      if(years>0){
        // GROWN FROM BUDS (komorebi-growth.js): apical control from the leader, side buds at the fork's angle, on a stream of the tree's own
        // (never `gr`, so a tree's growth moves no other tree). It hands back the grammar's records; the limbs are sectors of a balanced fan.
        // bearing: the grammar's twig count for the same knobs (limbs × children^(levels − 1), two children at opposite phyllotaxis), so the tree hangs the leaves the grammar would
        const bearing = lpt*Math.pow(phyllo===2 ? 2 : kids, levels - 1);
        const grown = growBuds({ years, lambda: 0.5 + 0.1*L, angle: coneA, pitch: limbEl, phyllo, droop, kids, bearing }, mulberry32(hash3(params.seed>>>0, 0xB0D5, tt)), out);
        budLimbs(grown, out, lpt, limbBase, limbDir, limbRaw, limbAttach);
      } else if(L>0){
        // MONOPODIAL (spec/model/canopy.md): limbs attach at staggered heights ALONG a continuing trunk axis (plan-centre),
        // so the branches actually MEET the trunk. leader_strength sends the origins UP the bole and shortens
        // limbs toward the top (acrotony → excurrent cone); low values keep them low (a few near-base forks →
        // decurrent dome). This replaces the single-origin hub AND the de-dandelion hack with the real mechanism.
        const boleH = 0.8;                               // BARE BOLE below the crown (local units) — a real trunk, so the tree isn't foliage-to-the-ground (a bush)
        const hLo = boleH, hHi = boleH + (1.0 + 0.6*L);  // crown band sits ABOVE the bole; taller for a stronger leader
        limbTop = hHi;                                   // the topmost limb attaches near hHi — the trunk must reach here
        for(let i=0;i<lpt;i++){
          const gi = limbBase+i;
          const f = (i+0.5)/lpt;                         // 0..1 up the limb set
          const h = hLo + (hHi-hLo)*f;                   // attach height ON the trunk axis, above the bole
          limbAttach[gi] = h;                            // (local; scaled below)
          const azGeo = i*GOLDEN + (gr()-0.5)*0.3;       // phyllotaxis spiral (geometry)
          const pitch = limbEl*(1 + 0.4*L*f);            // steeper toward the apex → a tighter cone
          const ce = Math.cos(pitch), se = Math.sin(pitch);
          const len = (0.4+0.2*gr())*(1 - 0.45*L*f);     // limbs SHORTER than the crown is tall → narrow crown on a tall trunk, not a bush; acrotony shortens toward the apex
          const dir = [ce*Math.cos(azGeo), ce*Math.sin(azGeo), se];
          // wind torque rides a BALANCED fan (decoupled from the spiral) so a gust still LEANS, never spins (spec/model/motion.md)
          const azBal = (i+0.5)/lpt*TAU2 + (gr()-0.5)*(TAU2/lpt)*0.6;
          limbDir[2*gi]=Math.cos(azBal); limbDir[2*gi+1]=Math.sin(azBal);
          limbRaw[2*i]=Math.cos(azGeo)*len; limbRaw[2*i+1]=Math.sin(azGeo)*len;
          growSkeleton({ ...grammar, base:[0,0,h], dir, len, level:1, limb:gi }, gr, out);
        }
      } else {
        // legacy single-hub: every limb from one point (the palm/lollipop) — kept as the leader_strength=0 case
        for(let i=0;i<lpt;i++){
          const gi = limbBase+i;
          const azL = (i+0.5)/lpt*TAU2 + (gr()-0.5)*(TAU2/lpt)*0.6;
          const ce = Math.cos(limbEl), se = Math.sin(limbEl);
          const dir = [ce*Math.cos(azL), ce*Math.sin(azL), se];
          const len = 0.7+0.5*gr();
          limbDir[2*gi]=Math.cos(azL); limbDir[2*gi+1]=Math.sin(azL);
          limbRaw[2*i]=dir[0]*len; limbRaw[2*i+1]=dir[1]*len;
          limbAttach[gi] = 0;                            // the hub IS the attach point (local 0); zLift below puts it at the trunk top
          growSkeleton({ ...grammar, base:[0,0,0], dir, len, level:1, limb:gi }, gr, out);
        }
      }
      // normalise the crown's PLAN extent to `crown` and lift onto the trunk. A monopodial tree carries its own
      // height (limbs are up the bole), so it scales z with the plan and stands on the ground; the legacy hub
      // lifts its whole crown by trunkH.
      let mr=1e-3, mz=1e-3; for(const w of out.tw){ mr=Math.max(mr, Math.hypot(w.x,w.y)); mz=Math.max(mz, w.z); }
      const s = crown/mr;   // PLAN fill (x,y): the widest twig → crown radius
      // HEIGHT scale (spec/model/canopy.md): the old code scaled z by this same s, but s = crown/mr EXPLODES for a narrow-plan tree
      // (steep branches → tiny mr → s of 6+), which — now that the faithful cast uses real z — made columnar ~47m,
      // palm ~16m. Floor the plan radius at mz/RATIO for the HEIGHT scale only: a broad tree (mr above the floor) is
      // UNCHANGED (sV == s, height preserved), a narrow tree is clamped to height = crown·RATIO·aspect. x/y keep s.
      // a tree grown from buds keeps the proportions it grew to: its height scales with its plan, uncapped, and crown_aspect is not
      // laid over it (the shape is the growth's, not set after it)
      const sV = years>0 ? s : crown/Math.max(mr, mz/FAITH_MAX_RATIO);
      // trunk top scales with leader_strength (spec/model/canopy.md): a weak leader (decurrent) ends DOWN in the crown at the highest
      // limb attach; a strong leader (excurrent) reaches the foliage apex. Always ≥ limbTop so every limb meets the trunk.
      if(L>0) leaderTop = limbTop + (mz - limbTop)*L;
      const aspect = years>0 ? 1 : clamp(params.crown_aspect, 0.4, 3);   // crown height factor (spec/model/canopy.md): scales crown height (narrow trees capped via sV above). Drives the faithful cast + 3D preview; the LAYER cast normalises height away (invariant).
      // scale the legacy-hub lift by aspect too, so an L=0 tree is a TRUE uniform z-scale: otherwise crown_aspect
      // leaks into the layer-mode wood (floorH's bole division assumes a pure scale), breaking the "invisible to the
      // layer cast" invariant for hub trees. aspect=1 (the default and every shipped look) → byte-identical. (spec/model/canopy.md)
      const zLift = (L>0 || years>0) ? 0 : trunkH*aspect;   // a grown tree stands on the ground on its own trunk
      const sc = (p) => [ p[0]*s+tx, p[1]*s+ty, p[2]*sV*aspect+zLift ];
      const twBase = twigs.length;   // this tree's first global twig index — turns grow()'s per-tree tw into the global clump id
      if(twigShoots) for(const bundle of out.shoots) twigShoots.push(bundle.map((pts) => Float64Array.from(pts.flatMap((q) => sc(q)))));
      if(wantPath) for(const pts of out.path){
        const flat = new Float64Array(pts.length*3); let arc = 0, px = 0, py = 0, pz = 0;
        for(let i=0;i<pts.length;i++){
          const q = sc(pts[i]); flat[3*i] = q[0]; flat[3*i+1] = q[1]; flat[3*i+2] = q[2];
          if(i) arc += Math.hypot(q[0]-px, q[1]-py, q[2]-pz);
          px = q[0]; py = q[1]; pz = q[2];
        }
        twigPath.push(flat); twigPathLen.push(arc);
      }
      // the twig BASE must ride the very same plan transform as the tip (sc's x,y half), or the shared pivot lands
      // off the wood; it is plan-only because the bend is 2-D yaw, so no z scale is needed.
      for(const w of out.tw){ const q=sc([w.x,w.y,w.z]); w.x=q[0]; w.y=q[1]; w.z=q[2]; w.bx=w.bx*s+tx; w.by=w.by*s+ty; w.tx=tx; w.ty=ty; w.tcov=treeCov; w.tree=tt; twigs.push(w); }
      for(const sg of out.seg){ segments.push({ a:sc(sg.a), b:sc(sg.b), level:sg.level, cov:treeCov, tree:tt, limb:sg.limb, px:tx, py:ty, f0:sg.f0||0, f1:(sg.f1!=null?sg.f1:1), clump:(sg.tw>=0 ? twBase+sg.tw : -1) }); }
      const trunkTop = (L>0) ? leaderTop*sV*aspect : trunkH*aspect;
      if(!years) segments.push({ a:[tx,ty,0], b:[tx,ty,trunkTop], level:0, cov:treeCov, tree:tt, limb:-1, px:tx, py:ty, f0:0, f1:1, clump:-1 });   // the continuing trunk axis (a tree grown from buds grew its own)
      for(let i=0;i<lpt;i++){ const gi=limbBase+i;
        limbPlan[2*gi]=limbRaw[2*i]*s*0.6+tx; limbPlan[2*gi+1]=limbRaw[2*i+1]*s*0.6+ty;
        limbAttach[gi]=limbAttach[gi]*sV*aspect+zLift; }   // the attach height must ride the IDENTICAL z transform sc() gives every twig/segment, or the anchor sits off the wood it is meant to hold onto
    }
    if(twigs.length > MAX_TEX) twigs.length = MAX_TEX;   // cap the per-clump data-texture width to the GPU limit
    if(twigPath.length > MAX_TEX){ twigPath.length = MAX_TEX; twigPathLen.length = MAX_TEX; }
    if(twigShoots && twigShoots.length > MAX_TEX) twigShoots.length = MAX_TEX;   // ...and the paths with the twigs they belong to

    // ---- map grown heights into the layer band: bin each twig to a layer by its height ----
    let zMin=1e18, zMax=-1e18;
    for(const t of twigs){ zMin=Math.min(zMin,t.z); zMax=Math.max(zMax,t.z); }
    const dz = (zMax-zMin) > 1e-4 ? (zMax-zMin) : 1;
    const nLayer = Math.max(1, params.layer_count|0);
    // a height's layer: higher foliage -> higher layer -> blurs more. The twigs bin by it, and so does each leaf by ITS height (inner_leaves hangs a leaf off its twig's height, so off its twig's layer); a leaf at its twig's height keeps t.layer
    const layerBand = [zMin, dz, nLayer];   // kept on hier: leaf travel bins a leaf by its own height as this loop does
    const layerOf = (z) => layerOfHeight(z, layerBand);
    for(const t of twigs) t.layer = layerOf(t.z);
    // LAYER/park height band (spec/model/canopy.md): bole 0→canopy_base, crown canopy_base→+thickness, NORMALISED by [zMin,zMax].
    // Used ONLY by the analytic woody occluder (non-faithful). This normalisation is invariant to a uniform z-scale —
    // correct for the depth cheat, but it would erase crown_aspect (and the real tree shape) from a faithful cast.
    const _cb = params.canopy_base_height_m, _th = params.canopy_thickness_m, _zb = Math.max(zMin, 1e-3);
    const floorH = (z) => z<=zMin ? _cb*(Math.max(0,z)/_zb) : _cb + (z-zMin)/dz*_th;
    // FAITHFUL cast (spec/model/canopy.md): leaves & skeleton cast from their REAL grown height — the very z the 3D preview draws,
    // so the shadow IS the preview tree. Any shape change (crown_aspect, droop, taper…) now flows into the shadow.
    let hMin=1e18, hMax=-1e18;
    for(const t of twigs){ if(t.z<hMin)hMin=t.z; if(t.z>hMax)hMax=t.z; }
    let castMin = hMin<=hMax ? hMin : 0, castMax = hMax>hMin ? hMax : (castMin+1);   // faith.hMin / faith.hMax, set at the upload
    let binH;   // faith.binH
    // Where each depth bin REALLY grew (the mean grown z of its twigs). The faithful cast ignores the park band, but the
    // sky fill's low-res layers (spec/model/fill.md) are depth bins on that path too, and a hemisphere read at the park band's heights
    // would be the wrong tree's. An empty bin falls back to its even share of the grown range.
    {
      const nb = Math.max(nLayer, MAX_LAYERS), sumZ = new Float64Array(nb), cnt = new Float64Array(nb);
      for(const t of twigs){ sumZ[t.layer] += t.z; cnt[t.layer]++; }
      binH = Float32Array.from(sumZ, (z, l) => cnt[l] ? z/cnt[l] : castMin + (castMax-castMin)*(nLayer>1 ? Math.min(l,nLayer-1)/(nLayer-1) : 0.5));
    }

    const nClusterTotal = twigs.length;
    const hier = {
      nLimb, limbDir, limbPlan, limbAttach,
      nTree, treePos, treeCrown, treePace,   // the trees, by index: tree 0 stands at the grove's origin, where the motion's own trunk (motion.u) is
      limbTree: Int32Array.from({ length: nLimb }, (_, i) => Math.floor(i/lpt)), clusterTree: new Int32Array(nClusterTotal),   // which tree a limb, a clump, belongs to
      treeDelta: new Float32Array(nTree*4),           // dynamic, by tree: its trunk's sway and u less tree 0's (publishBend), what each tree's wood adds to the shared sway
      swayData: new Float32Array(nClusterTotal*4),    // dynamic, by clump: its tree's treeDelta, the cluster texture's row 2
      limbAngle:new Float32Array(nLimb), limbVel:new Float32Array(nLimb),   // scalar YAW bend (radians): rotation about the vertical
      limbPitch:new Float32Array(nLimb), limbPitchVel:new Float32Array(nLimb),   // second DOF (spec/model/motion.md): ELEVATION bend in the limb's own vertical plane — what sway_pitch foreshortens by. Same spring constants as the yaw.
      nClusterTotal,
      nLeaf,   // the leaves hung on each cluster, the marginal one counted where there is one: the grove's own record, which the editor's held leaf walks instead of rebuilding it from the params
      leafRow: null, leafVariety: 0,   // leaf_variety (spec/model/leaf.md): each leaf's row in the outline table by (cluster, leaf) — j·nLeaf + k — and the variety the table was made for; the held leaf and the litter read them, never the params, which run ahead of the picture. null and 0 at the gate
      clusterPlan:new Float32Array(nClusterTotal*2), clusterLimb:new Int32Array(nClusterTotal),
      clusterPhase:new Float32Array(nClusterTotal),
      twigAngle:new Float32Array(nClusterTotal), twigVel:new Float32Array(nClusterTotal),
      clusterData:new Float32Array(nClusterTotal*4),   // dynamic: (limb bend, twig bend, .z per MODE — layer's stem seed / faithful's sway_pitch anchor offset, sway_pitch foreshorten factor) — see publishBend
      airData:new Float32Array(nClusterTotal*4),      // .x dynamic: the air's level at the clump (komorebi-air.js), the leaves' flutter under wind_air; .y static: the clump's depth in its crown (crownDepth), how far wind_depth's wind must reach; .zw spare
      clusterGeom:new Float32Array(nClusterTotal*4),   // static: (leaf pivot anchor.xy — twig tip on the layer path, real twig base in faithful; tree trunk pivot.xy)
      // topology signature: what makes limb/cluster index i mean the SAME branch across a regrow. tree_count is NOT
      // here (trees append, so the prefix still lines up — that's the morph); branch_angle/length/pitch/droop aren't
      // either (same indices, just bent differently — carrying their sway is the desired no-reset). But seed / depth /
      // children / limb_count / phyllotaxis / the leader↔hub azimuth flip re-mean every index, so the carry is invalid.
      topoSig: `${params.seed>>>0}|${levels}|${kids}|${lpt}|${phyllo}|${L>0?1:0}${years ? `|y${years}` : ''}`,
      segments, twigs, maxV:0,   // twigs (one per leaf cluster) for the 3D preview — so it scatters per twig like the bake, not per terminal segment (droop sub-segments)
      layerBand,   // [zMin, dz, nLayer]: the heights the twigs bin over (layerOfHeight)
      twigPath: wantPath ? twigPath : null, twigPathLen: wantPath ? Float64Array.from(twigPathLen) : null, twigShoots,   // twigShoots: a grown tree's clusters' shoots (placeLeaf), null for the grammar   // inner_leaves (placeLeaf): each twig's ancestor path and its arc, by twig index; null while the knob is 0
    };
    // carry the in-flight sway across a regrow so the wind doesn't reset (an editor tweak or a grove-morph
    // transition). Trees/limbs are appended at the end, so indices 0..min are the same twig: copy the common
    // PREFIX — existing trees keep their sway, a newly-grown tree starts at rest. ONLY when the topology signature
    // matches; a leader/phyllotaxis/depth edit re-means the indices, so we start at rest there (no wrong-twig bend). (spec/model/transitions.md)
    if(prevHier && prevHier.topoSig === hier.topoSig){
      const nL=Math.min(prevHier.nLimb,nLimb), nC=Math.min(prevHier.nClusterTotal,nClusterTotal);
      hier.limbAngle.set(prevHier.limbAngle.subarray(0,nL)); hier.limbVel.set(prevHier.limbVel.subarray(0,nL));
      hier.limbPitch.set(prevHier.limbPitch.subarray(0,nL)); hier.limbPitchVel.set(prevHier.limbPitchVel.subarray(0,nL));
      hier.twigAngle.set(prevHier.twigAngle.subarray(0,nC)); hier.twigVel.set(prevHier.twigVel.subarray(0,nC));
    }

    // ---- hang a leaf cluster on each twig, accumulating one instance buffer per depth layer ----
    // The leaf records are typed runs of DOUBLES, written by index: an Array grown a number at a time was most of a regrow at tens of thousands
    // of leaves. They hold the very doubles the Arrays held, so every pass below that reads them back (the variety's sizes, the season's slots,
    // the plan AABB) sees the same numbers, and the Float32Array made at upload rounds them as it always did.
    const nAll = nClusterTotal*nLeaf;
    const layerRun = [];
    for(let l=0;l<nLayer;l++) layerRun.push({ a: new Float64Array(17*Math.max(1, Math.ceil(nAll/nLayer))), n: 0 });   // 17 floats/leaf — see attribute layout below; a layer that takes more than its share doubles
    let faithData = new Float64Array(nAll*18);      // FAITHFUL: ALL leaves in one buffer, + the continuous height (spec/model/canopy.md) before the fade: 18 floats/leaf (let: abscission compacts it)
    const faithful = faithfulOn();                  // hoisted: the packing convention below must be ONE decision for the whole grove, not re-asked per leaf
    // Autumn senescence (spec/model/season.md): per-leaf pigment state. Every s_j is exactly 0 until phenology passes turn_start, so
    // below it the authored `tau` goes through untouched — the gate that keeps every shipped look byte-identical.
    const sen = senescing(params), leafT = [0,0,0];
    // Light decides who turns first (spec/model/season.md): exposure is a property of the STAND, not of the leaf — it needs every leaf's place
    // and height — so with turn_exposure up each leaf notes where its tau went (rec: x, y, z, area, j, k, fade, layer,
    // slot in its layer buffer, slot in the faithful one) and the loop below rewrites them once the grove is laid out.
    // Off (the default, and every look that never asks) rec is never made and the loop is P0's, bit for bit.
    // Abscission (spec/model/season.md) is a second reason to look back: who has let go is decided over the whole stand too (the light orders it), and a
    // leaf that has is compacted out of both buffers. `dropping` is its gate: at leaf_drop 0, or in a season before the first leaf's fade
    // can begin (drop_start - DROP_EPS), rec, the retention arithmetic, the compaction and the litter are never made — P1's buffers to the bit.
    const isLit = lit(params), isDropping = dropping(params), after = afterTurn(params);
    // Leaf-out (spec/model/season.md, the spring half) is a third: a leaf still growing is shrunk and tinted after the hang, and one not yet out is compacted. The hang writes every
    // leaf full-grown, so the re-season's record is the summer grove's and a step of the spring scales from it.
    const isSpring = FEAT_SPRING && springing(params), spr = [0,0], sprD = [0,0];
    const REC = 10;
    const rec = ((FEAT_EXPOSURE && isLit) || (FEAT_DROP && isDropping) || vary || isSpring) ? new Float64Array(nAll*REC) : null;   // vary: the rows are drawn by the light, over the same record
    const sRec = keepSeason ? new Float64Array(nClusterTotal*nLeaf*SREC) : null;   // the re-season's per-leaf record (see the header): doubles, because the litter wants the doubles
    let sEx = null, sRank = null;   // the exposure field and keyed rank, when this build ran the pass: the record keeps them, so the first re-season does not pay it again
    let sAt = 0;
    const pos = [0,0,0,0,0,0];   // placeLeaf's scratch: one leaf's x, y, z, its pivot weight, and on a shoot its blade's heading and its share
    let sideData = new Float64Array(nAll);   // FAITHFUL: each leaf's side (leafSide), in record order, compacted with pivotData
    let pivotData = new Float64Array(nAll);   // FAITHFUL: each leaf's pivot weight (placeLeaf's out[3]), in record order, before the fade (let: abscission compacts it with faithData)
    let zLow = Infinity, zHigh = -Infinity;   // the lowest and the highest height any leaf hangs at (past faith.hMin / faith.hMax only when inner_leaves hangs one on wood beyond every twig tip)
    let q = 0;   // the leaf's place in record order: every leaf of every cluster takes one, in the faithful run, the pivots and rec
    crownDepth(twigs, hier.airData);
    // SHOOTS AND LIGHT (komorebi-shoots.js): each cluster's light, from the growth sky, when a leaf reads it (tilt_light, shoot_leaves), and each cluster's
    // shoots when leaves hang on them. Both null at 0, and then nothing below reads them.
    const tiltOn = params.tilt_light > 0, shootsOn = params.shoot_leaves > 0 && !(params.growth_years > 0);   // a tree grown year by year hangs its leaves on its own grown shoots
    hier.leafLight = tiltOn || shootsOn ? clusterLight(twigs, params) : null;
    hier.leafShoots = shootsOn ? Array.from({ length: nClusterTotal }, (_, j) => clusterShoots(params.seed, j, nLeaf, params.phyllotaxis === 'opposite')) : null;
    for(let j=0;j<nClusterTotal;j++){
      const t = twigs[j];
      const dT = tShift ? tShift[t.tree] : undefined, cT = tGain ? tGain[t.tree] : undefined;   // this cluster's tree's lead and depth
      const dr = clusterDraws(j, nLeaf), D = dr.a;   // this cluster's arrangement and wind draws, in stream order (THE DRAWS, KEPT)
      const cx=t.x, cy=t.y;
      const swayRand = dr.sway*2-1; const stemRand = dr.stem*2-1;
      hier.clusterPlan[2*j]=cx; hier.clusterPlan[2*j+1]=cy; hier.clusterPhase[j]=swayRand*Math.PI;
      hier.clusterLimb[j]=t.limb; hier.clusterTree[j]=t.tree;      // grown level-1 ancestor (no search needed)
      // .xy is the LEAF PIVOT ANCHOR, and it means different things per path. LAYER/park: the twig tip (= the clump
      // centre), from which VS_BAKE offsets a SYNTHETIC stem joint by uStemLen — no wood is drawn there, so a made-up
      // joint costs nothing. FAITHFUL: the twig's REAL grown base, which is also what the wood twig turns about in
      // bakeFaithful's refill — one shared joint, so the medium band can't slide leaves off their visible twigs (spec/model/canopy.md).
      hier.clusterGeom[4*j]=faithful?t.bx:cx; hier.clusterGeom[4*j+1]=faithful?t.by:cy;
      hier.clusterGeom[4*j+2]=t.tx; hier.clusterGeom[4*j+3]=t.ty;    // limb pivot = this tree's trunk
      hier.clusterData[4*j+2]=stemRand;                             // static stem-angle seed (.z); tick writes .x/.y
      for(let k=0;k<nLeaf;k++){
        const cov = ((k===pcInt) ? frac : 1.0) * t.tcov;   // marginal-leaf fade × marginal-tree fade (spec/model/canopy.md)
        // where it hangs (placeLeaf): the twig hug off the tip, and with inner_leaves up a share of the leaves on the wood behind it. Same two draws → other attributes unchanged.
        const b = k*DRAW, g1 = D[b], g2 = D[b+1];
        const size = params.leaf_size_m*(0.6+0.8*D[b+2]);
        placeLeaf(hier, j, g1, g2, k, params, faithful, pos, size); pivotData[q] = pos[3]; sideData[q] = leafSide(params.seed, j, k);
        const x = pos[0], y = pos[1], z = pos[2];
        if(z < zLow) zLow = z;
        if(z > zHigh) zHigh = z;
        const li = z === t.z ? t.layer : layerOf(z), run = layerRun[li];   // a leaf at its twig's height is on its twig's layer; one on the wood is on the layer of its own height
        // An outline has its own width-to-length (komorebi-leaf.js), so the look's aspect is not its to squash: it takes the leaf AREA the ellipse would have, π·A·B0 = π·size²/(4·aspect), with A = B0 = size/(2√aspect) —
        // the fullness stays where the look had it, and a maple at 1.75 is a smaller maple, never a thin one. At aspect 1 Math.sqrt(1) is exactly 1 and x/1 is x, so both are the old bits; the ellipse keeps its literal line.
        const A  = shape ? size*0.5/Math.sqrt(params.leaf_aspect) : size*0.5;   // long half-axis
        const B0 = shape ? A : size*0.5/params.leaf_aspect;                     // face-on short half (shader foreshortens)
        let restTilt = D[b+3]*params.max_tilt*(Math.PI*0.5);
        if(tiltOn) restTilt += (lightTilt(D[b+3], hier.leafLight[j]) - restTilt)*params.tilt_light;   // TILT BY LIGHT: toward Planchais's law by tilt_light, from the same draw; max_tilt is the look's at 0 only
        let angle = D[b+4]*Math.PI;
        if(shape && leafFlip(params.seed, j, k)) angle += Math.PI;   // an outline is not the same leaf a half turn on: half of them take the other half-plane (komorebi-leaf.js)
        if(pos[5] > 0) angle = lerpAngle(angle, pos[4] + (D[b+4] - 0.5)*SHOOT.azJitter, pos[5], 2*Math.PI);   // on a shoot the blade points away from its node, the leaf's own draw a jitter about it
        const ax = 0.4+0.6*D[b+5], ay = 0.4+0.6*D[b+6];    // incoherent orbit
        const orient = D[b+7]*TAU2, phase = D[b+8]*TAU2;
        const swingGain = 0.6+0.8*D[b+9], swingPhase = D[b+10]*TAU2;
        // this leaf's own tau: a leaf not yet turning gets `tau` itself (leafTau's s=0 branch copies it, no arithmetic).
        // The hashes inside leafTau are pure functions of (seed, j, k) — they must never draw from rng/rng2/gr above,
        // or every shipped grove reshuffles.
        const lt = FEAT_PIGMENT && sen ? leafTau(tau, params, params.seed, j, k, leafT, undefined, undefined, dT, cT) : tau;
        // the cluster id the VS reads: j, and for an outline its row in the FRACTION (j + v/32) — a pure hash of (seed, j, k) on the leaf's own salt, like the pigment above
        const cid = shape ? j + leafVariant(params.seed, j, k)/LEAF_ID_FRAC : j;
        // iFade: the very `cov` folded into tau above. The bake writes it into alpha (coverage) so the leaf's BALLISTIC shadow (spec/model/leaf.md) fades out
        // with its tau — the mixture reads (tau·cov, cov·fade) as the same leaf over fade·cov of the area — instead of keeping its full footprint
        // on a leaf that is not there yet; alpha has no other reader.
        if(run.n + 17 > run.a.length){ const grown = new Float64Array(run.a.length*2); grown.set(run.a); run.a = grown; }
        const d = run.a, o = run.n, f = q*18; run.n += 17;
        d[o]=x; d[o+1]=y; d[o+2]=A; d[o+3]=B0; d[o+4]=angle; d[o+5]=restTilt; d[o+6]=swingGain; d[o+7]=swingPhase;
        d[o+8]=lt[0]*cov; d[o+9]=lt[1]*cov; d[o+10]=lt[2]*cov; d[o+11]=cid; d[o+12]=ax; d[o+13]=ay; d[o+14]=orient; d[o+15]=phase; d[o+16]=cov;
        faithData[f]=x; faithData[f+1]=y; faithData[f+2]=A; faithData[f+3]=B0; faithData[f+4]=angle; faithData[f+5]=restTilt; faithData[f+6]=swingGain; faithData[f+7]=swingPhase;
        faithData[f+8]=lt[0]*cov; faithData[f+9]=lt[1]*cov; faithData[f+10]=lt[2]*cov; faithData[f+11]=cid; faithData[f+12]=ax; faithData[f+13]=ay; faithData[f+14]=orient; faithData[f+15]=phase;
        faithData[f+16]=z; faithData[f+17]=cov;   // + REAL grown height (attr 5) — cast == preview — then the fade (attr 6)
        if(rec){ const r = q*REC; rec[r]=x; rec[r+1]=y; rec[r+2]=z; rec[r+3]=Math.PI*A*B0*cov; rec[r+4]=j; rec[r+5]=k; rec[r+6]=cov; rec[r+7]=li; rec[r+8]=o+8; rec[r+9]=f+8; }   // flat area (the ellipse), orientation ignored; the two slots are where this leaf's tau starts
        if(sRec){ sRec[sAt]=x; sRec[sAt+1]=y; sRec[sAt+2]=z; sRec[sAt+3]=A; sRec[sAt+4]=B0; sRec[sAt+5]=Math.PI*A*B0*cov; sRec[sAt+6]=j; sRec[sAt+7]=k; sRec[sAt+8]=cov; sRec[sAt+9]=li; sRec[sAt+10]=o; sAt += SREC; }
        q++;
      }
    }
    const layerData = layerRun.map(r => r.a.subarray(0, r.n));   // each layer's leaves, in hang order
    // The faithful cast's frame is swept over [hLo, hHi] = [hMin, hMax] when there is no wood to reach the ground (komorebi-bake.js), and both ends are the TWIG TIPS' (above): a leaf hung on wood beyond them would cast outside
    // the frame. Below the lowest tip is where a limb that falls to the trunk puts them; ABOVE the highest it is the droop, which bends a twig's tip below the joints behind it, so a leaf on that wood is higher than every tip
    // (measured: the willow at droop 0.8 puts 427 leaves up to 0.26 m over its highest tip, droop 1 / pitch 70 / no leader on afternoon 7 up to 0.40 m). So both ends are widened to the lowest and the highest leaf. Neither moves at
    // inner_leaves 0, where every leaf hangs at its twig's height and so is never beyond a tip, which keeps the frame to the bit (inner.test.js). hMax also scales the coherent sway (komorebi-bake.js: height / hMax), so a look
    // with heavy droop and inner leaves up leans a hair less at the same height, which is the price of one frame for the leaves and the wood (they share it).
    if(zLow < castMin) castMin = zLow;
    if(zHigh > castMax) castMax = zHigh;
    // Every leaf's place in the grove's order of light — the rank the season's exposure pass also builds, and from the same leaves: x, y, z, the leaf's flat area as the hang loop left it (BEFORE any shift below), its own clock as the tie-break.
    // The one function for both the rows (the pass below) and the season block, so the two cannot disagree about who is in the sun.
    const lightOf = () => {
      const n = rec.length/REC, X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), Ar = new Float64Array(n), K = new Float64Array(n);
      for(let i=0;i<n;i++){ X[i]=rec[REC*i]; Y[i]=rec[REC*i+1]; Z[i]=rec[REC*i+2]; Ar[i]=rec[REC*i+3]; K[i]=leafClock(params.seed, rec[REC*i+4], rec[REC*i+5]); }
      const ex = exposureGrid(X, Y, Z, Ar, E);   // K: the leaves nothing shades (e = 1) are ordered by their own clocks, not stacked on one rank
      return { ex, rank: exposureRank(ex, K) };
    };
    // LEAF VARIETY (spec/model/leaf.md, `leaf_variety`): which row of the outline table each leaf hangs in, and how big it is, from the grove's own light. The rank is the SUMMER set's, keyed by the leaf's clock as the season's is, and never exposureBlend's
    // (exposure_absolute is a season key; shape is not season) — so it is the season's rank to the bit, and a leaf's colour, day and fall order are the variety-0 grove's. THE ROW is its tree's genotype (treeGenotype: a pure function of (seed, t))
    // and its light class, the rank in columns jittered by the leaf's own leafJitter draw, so no stream is drawn from. THE SIZE shifts with the rank itself, continuous and not stepped by the column: m = 1 + SIZE_LIGHT·v·(1 − 2u), sun leaves
    // smaller, and is renormalised once per grove, weighted by each leaf's cover, so that Σ cov·A·B0 is the look's: the canopy is as full as it was, and the marginal leaf and tree count only as much as they fade in. The area the LIGHT reads
    // (rec, and the season record's slot 5) is the pre-shift one, which is what makes the rank the variety-0 rank. Runs BEFORE the season base is taken, so a re-season's copies carry the row (the cluster id's fraction) and the shifted half-axes.
    // The packing is j + row/128 in the cluster id; the hang loop pushed j + variant/32, which this overwrites in both buffers. The growth, positions, angles, flips, tilts, tau and heights are untouched.
    let leafRow = null, vLight = null, scaleMax = 1;
    if(vary){
      leafRow = new Uint8Array(nClusterTotal*nLeaf);
      if(rec.length){
        const n = rec.length/REC, v = VARIETY_REAL*params.leaf_variety, mOf = (u) => 1 + SIZE_LIGHT*v*(1 - 2*u);   // on the spreads' own scale (VARIETY_REAL)
        vLight = lightOf();
        const rank = vLight.rank, geno = Array.from({ length: nTree }, (_, t) => treeGenotype(params.seed, t, VARIETY_GENOTYPES));
        let S0 = 0, S1 = 0;
        for(let i=0;i<n;i++){ const o = REC*i, d = layerData[rec[o+7]], li = rec[o+8], w = rec[o+6]*d[li-6]*d[li-5], m = mOf(rank[i]); S0 += w; S1 += w*m*m; }
        const kappa = S1 > 0 ? Math.sqrt(S0/S1) : 1;
        for(let i=0;i<n;i++){
          const o = REC*i, j = rec[o+4], k = rec[o+5], u = rank[i], d = layerData[rec[o+7]], li = rec[o+8], fi = rec[o+9];
          const h = leafJitter(params.seed, j, k), row = geno[twigs[j].tree]*VARIETY_COLUMNS + leafColumn(u, h), s = kappa*mOf(u);
          // the outline rides the id as its first column plus the blend toward the next, packed into 0.1..0.9 of a row so a float's error never crosses a row (the VS reads it raw, leafQ blends):
          // a float32's half-ulp stays under the 0.1/128 margin for a cluster id under 16384, and costs the blend under 0.08 of a column there
          const cf = leafColumnF(u, h), c0 = Math.min(Math.floor(cf), VARIETY_COLUMNS - 1), w = c0 < VARIETY_COLUMNS - 1 ? cf - c0 : 0;
          const cid = j + (geno[twigs[j].tree]*VARIETY_COLUMNS + c0 + 0.1 + 0.8*w)/VARIETY_ID_FRAC;
          d[li-6] *= s; d[li-5] *= s; faithData[fi-6] = d[li-6]; faithData[fi-5] = d[li-5];
          d[li+3] = cid; faithData[fi+3] = cid;
          leafRow[j*nLeaf + k] = row;
          if(s > scaleMax) scaleMax = s;
          if(sRec){ sRec[i*SREC+3] = d[li-6]; sRec[i*SREC+4] = d[li-5]; }
        }
        if(keepSeason){ sEx = vLight.ex; sRank = vLight.rank; }   // what reseasonGrove would build from the record (its slot 5 keeps the pre-shift area): the first re-season does not pay for it again
      }
      hier.leafRow = leafRow; hier.leafVariety = params.leaf_variety;
    }
    const seasonBase = keepSeason ? layerData.map(a => Float32Array.from(a)) : null;   // the UNCOMPACTED layer records, before the rewrite below touches a tau
    const seasonPivot = keepSeason ? Float32Array.from(pivotData) : null;              // ...and the pivot weights, in the same record order (one push site)
    const seasonSide = keepSeason ? Float32Array.from(sideData) : null;                // ...and the sides
    let litter = null, leafW = null;
    if(rec?.length){
      const n = rec.length/REC;
      // each leaf's place in the grove's order of light — and, as far as exposure_absolute says, its raw light — what the two maps in komorebi-season.js
      // (and the drop day) take. It is the FULL summer set whatever has dropped: exposure is a season integral, not a function of who is
      // still hanging, so a leaf's day does not move as the season is read at another phenology.
      let u = null;
      if(FEAT_EXPOSURE && ordered(params)){
        const light = vLight ?? lightOf(), ex = light.ex, rank = light.rank;   // leaf_variety has already built them, from these very leaves: the same arrays
        u = exposureBlend(rank, ex, params.exposure_absolute);   // read below, never written: at exposure_absolute 0 it IS the rank the record keeps
        if(keepSeason){ sEx = ex; sRank = rank; }   // the same leaves in the same order as sRec (one push site), the same seed, clocks and E: what reseasonGrove would build
      }
      let alive = null, gone = 0;
      if(FEAT_DROP && isDropping){ litter = []; leafW = new Float32Array(nClusterTotal*nLeaf).fill(1); alive = new Uint8Array(n).fill(1); }
      if(isSpring && !alive) alive = new Uint8Array(n).fill(1);
      for(let i=0;i<n;i++){
        const o = REC*i, j = rec[o+4], k = rec[o+5];
        const dT = tShift ? tShift[twigs[j].tree] : undefined, cT = tGain ? tGain[twigs[j].tree] : undefined;   // this leaf's tree: the hang loop's own pair
        let w = 1, D = 0;
        if(FEAT_DROP && isDropping){
          D = after ? dropDayAfterTurn(params, turnPhase(params, leafClock(params.seed, j, k), FEAT_EXPOSURE && isLit ? turnOrder(u[i]) : undefined), dT)
            : dropDay(params, dropPhase(dropHash(params.seed, j, k), u ? u[i] : 0, params.drop_exposure), dT);
          w = retention(D, params.phenology);
          leafW[j*nLeaf + k] = w;
        }
        if(FEAT_SPRING && isSpring){
          leafSpring(params, springDraws(params.seed, j, k, sprD)[0], spr);
          if(spr[0] === 0){ alive[i] = 0; gone++; continue; }                // not out yet: no leaf, and nothing for the carpet
        }
        if(!(FEAT_EXPOSURE && isLit) && w === 1 && !(isSpring && (spr[0] < 1 || spr[1] < 1))) continue;   // nothing about this leaf changed: it is already in the buffers, full-grown
        const lt = FEAT_EXPOSURE && isLit ? leafTau(tau, params, params.seed, j, k, leafT, turnOrder(u[i]), redGain(u[i]), dT, cT) : FEAT_PIGMENT && sen ? leafTau(tau, params, params.seed, j, k, leafT, undefined, undefined, dT, cT) : FEAT_SPRING && isSpring ? springTau(tau, params, spr[1], sprD[1], leafT) : tau;
        const cov = rec[o+6], cf = cov*w;                                    // spec/contracts/continuity.md: a leaf leaves by fading — cov <- cov.w scales its tau and the fade its ballistic shadow rides on together
        const d = layerData[rec[o+7]], li = rec[o+8], fi = rec[o+9];
        if(FEAT_SPRING && isSpring && spr[0] < 1){ for(let a=6;a>=5;a--){ const v = d[li-a]*spr[0]; d[li-a] = v; faithData[fi-a] = v; } }   // still growing: its half-axes are its length's share of the grown leaf's
        for(let c=0;c<3;c++){ d[li+c] = lt[c]*cf; faithData[fi+c] = lt[c]*cf; }
        d[li+8] = cf; faithData[fi+9] = cf;
        if(w === 0){
          alive[i] = 0; gone++;
          if(FEAT_LITTER) litter.push({ x: rec[o], y: rec[o+1], h: rec[o+2], D, tau: [lt[0], lt[1], lt[2]], size: [d[li-6], d[li-5]], j, k, fade: cov, ...(leafRow && { row: leafRow[j*nLeaf + k] }) });   // its own statement: a build without the carpet still compacts, by the count of leaves that went and not by the list. `row` (leaf_variety): the outline it hung in, which the carpet lies it in
        }
      }
      // A leaf with w = 0 is not a faint leaf, it is no leaf: compacted out of both buffers in one pass over the records, so a bare canopy
      // is not a bake of ten thousand empty quads (a zero-tau quad still costs one in the bake). Survivors keep their order, in both.
      if(gone){
        const per = new Int32Array(nLayer);
        for(let i=0;i<n;i++) if(alive[i]) per[rec[REC*i+7]]++;
        const keepL = Array.from(per, (c) => new Float64Array(c*17)), keepF = new Float64Array((n-gone)*18), keepP = new Float64Array(n-gone), keepS = new Float64Array(n-gone);
        const atL = new Int32Array(nLayer);
        for(let i=0, s=0;i<n;i++){
          if(!alive[i]) continue;
          const o = REC*i, l = rec[o+7], li = rec[o+8] - 8, fi = rec[o+9] - 8;
          keepL[l].set(layerData[l].subarray(li, li+17), atL[l]); atL[l] += 17;
          keepF.set(faithData.subarray(fi, fi+18), s*18);
          keepS[s] = sideData[fi/18]; keepP[s++] = pivotData[fi/18];
        }
        for(let l=0;l<nLayer;l++) layerData[l] = keepL[l];
        faithData = keepF; pivotData = keepP; sideData = keepS;
      }
    }

    // ---- what the upload is handed: every array as the GPU takes it, every number the shared state takes ----
    const layers = layerData.map((a) => new Float32Array(a));   // 17 floats a leaf, a layer
    const faithArr = new Float32Array(faithData);               // 18 floats a leaf, every leaf
    // dynamic: row 0 the bend angles (publishBend), row 1 the air at each clump (publishAir), row 2 its tree's trunk less tree 0's (publishBend) — a NEW texture per grove (the old one is freed at install)
    const clusterRows = new Float32Array(Math.max(1,nClusterTotal)*12); clusterRows.set(hier.clusterData); clusterRows.set(hier.airData, Math.max(1,nClusterTotal)*4); clusterRows.set(hier.swayData, Math.max(1,nClusterTotal)*8);
    // ---- woody occluder (spec/model/canopy.md): trunk + MAIN LIMBS (level<=1) as CONTINUOUS-height analytic segments. Map
    // each grown z to a floor height with the SAME crown mapping the leaves bin by (zMin->canopy_base,
    // zMax->base+thickness), and the bole linearly to 0 — so a limb's base lands at the trunk's height and the
    // shadow CONNECTS (no layer-quantization snowflake). Fine sub-branches are dropped; the leaf dapples carry the
    // fine canopy. The trunk passes through all the limb heights, so the trunk shadow meets the crown. ----
    const occOut = {};
    {
      const tf = Math.pow(Math.max(1.001, kids), -1/clamp(params.taper_delta,1,4));   // pipe-model taper for the radius (floorH hoisted above)
      const rest=[], segH=[];
      let want=0;                                      // what the grove ASKED for, before the cap — see occ.want below
      for(const sg of segments){
        if(sg.level>1) continue;                       // trunk + main limbs only; fine sub-branches carried by the leaf dapples
        want++;
        if(rest.length >= MAX_OCC) continue;           // table full: keep counting rather than break, so the shortfall is a number instead of nothing
        const r = Math.max(0.01, params.trunk_radius_m*Math.pow(tf, sg.level));
        rest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], limb:sg.limb, px:sg.px, py:sg.py, tree:sg.tree });   // limb+pivot for the per-frame swing, tree for its trunk's sway
        segH.push(floorH(sg.a[2]), floorH(sg.b[2]), r, sg.cov);
      }
      // want > count means this grove is TRUNCATED: the tail of the grow order — whole later trees' boles and limbs —
      // casts no wood at all. It is invisible in a single frame (nothing is missing, there is just less), which is
      // exactly why it needs a number: the pixel harness reads these two and says so out loud.
      occOut.rest = rest; occOut.ht = new Float32Array(segH); occOut.count = rest.length; occOut.want = want;
      let hRef = 1e-3; for(let i=0;i<segH.length;i+=4) hRef = Math.max(hRef, segH[i], segH[i+1]);   // tallest floor-height → the drift's height-scale reference (foot planted, crown sways)
      occOut.hRef = hRef;
    }
    // ---- FAITHFUL skeleton (spec/model/canopy.md): EVERY segment (trunk + branches + TWIGS) as a tapered capsule at continuous
    // heights (the same floorH). Unlike the analytic occluder (level<=1, capped at MAX_OCC), this is a vertex buffer
    // with no level/count cap — so the twigs cast too and the leaves sit on VISIBLE wood. Used only in faithful mode. ----
    const woodRest = [];
    {
      const tf = Math.pow(Math.max(1.001, kids), -1/clamp(params.taper_delta,1,4));   // pipe-model taper
      for(const sg of segments){
        // taper by FRACTIONAL level (sg.f0/f1) so a drooping branch's sub-segments thin smoothly across the one
        // level→level+1 step rather than each repeating the whole step (the old sawtooth). Straight branches: f0=0,f1=1 → unchanged.
        const ra = Math.max(0.012, params.trunk_radius_m*Math.pow(tf, sg.level + (sg.f0||0)));     // thick at the base of the segment (min keeps twigs visible)
        const rb = Math.max(0.008, params.trunk_radius_m*Math.pow(tf, sg.level + (sg.f1!=null?sg.f1:1)));  // thinner toward the tip — continuous with the next sub-segment
        // segment→clump linkage: a TERMINAL (twig-order) segment names the clump hanging off it, and carries that
        // twig's real grown base — the pivot its leaves use in VS_FAITH — so the refill can swing wood and leaves
        // as one. -1 = trunk/limb/interior wood (no clump), and also any twig past the MAX_TEX cluster cap, which
        // bears no leaves at all. (twigs[] is already capped and scaled by here.)
        const cj = (sg.clump>=0 && sg.clump<twigs.length) ? sg.clump : -1;
        woodRest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], ha:sg.a[2], hb:sg.b[2], ra, rb, limb:sg.limb, px:sg.px, py:sg.py, tree:sg.tree,
                        cov:sg.cov, clump:cj, tbx:(cj>=0?twigs[cj].bx:0), tby:(cj>=0?twigs[cj].by:0),
                        level:sg.level, mz:0.5*(sg.a[2]+sg.b[2]) });   // REAL grown heights (cast == preview); level + midpoint height pick the SKY view's layer bin below
      }
    }
    // ---- SKY VIEW's layer-stamped wood (spec/model/sky-view.md). The look-up camera reads the layer textures as ANGULAR SILHOUETTES,
    // so wood binned into a layer is drawn at that layer's plan and read at the ray's crossing of that layer's height
    // — which is exactly where the leaves in the same bin are drawn and read. Registration therefore holds by
    // CONSTRUCTION for a terminal segment: it takes its own clump's layer, the very bin its leaves went into.
    // ONLY the fine wood goes in. Level 0 and 1 are the trunk and main limbs, which the analytic occluder already
    // draws as real 3-D capsules; binning those would both double them and shatter them, because a segment that
    // spans several layer bands is cut into pieces read at different plan points. Fine wood is short by construction
    // (measured well under one band at every shipped look), so it cannot come apart. ----
    const skyRest = [], skyStart = [], skyCount = [];
    {
      const nL = Math.max(1, params.layer_count|0);
      if(params.sky_view){
        const binOf = (s0) => s0.clump >= 0 ? twigs[s0.clump].layer
                            : (nL > 1 ? clamp(Math.round((s0.mz - zMin)/dz*(nL-1)), 0, nL-1) : 0);   // the twigs' own binning rule, applied to interior wood by its midpoint
        const byLayer = [];
        for(let l=0;l<nL;l++) byLayer.push([]);
        for(const s0 of woodRest) if(s0.level > 1) byLayer[binOf(s0)].push(s0);
        for(let l=0;l<nL;l++){ skyStart[l] = skyRest.length; skyCount[l] = byLayer[l].length; for(const s0 of byLayer[l]) skyRest.push(s0); }
      }
    }
    // FAITHFUL cast-frame plan AABB (spec/model/canopy.md / A5): the REAL plan extent of every leaf (faithData x,y) + every wood
    // endpoint, so bakeFaithful's cast frame covers a wide grove's OUTER crown. (Was bounded by ±canopy_extent/2, which
    // clipped it — park 1's crown reaches ~4.3 m vs half=3.25 m.) Rest positions; the per-bake pad covers sway+drift.
    let px0=1e18,py0=1e18,px1=-1e18,py1=-1e18;
    for(let i=0;i<faithData.length;i+=18){ const x=faithData[i],y=faithData[i+1]; if(x<px0)px0=x; if(x>px1)px1=x; if(y<py0)py0=y; if(y>py1)py1=y; }
    for(const s of woodRest){
      if(s.ax<px0)px0=s.ax; if(s.ax>px1)px1=s.ax; if(s.ay<py0)py0=s.ay; if(s.ay>py1)py1=s.ay;
      if(s.bx<px0)px0=s.bx; if(s.bx>px1)px1=s.bx; if(s.by<py0)py0=s.by; if(s.by>py1)py1=s.by;
    }
    if(px0>px1){ const h=params.canopy_extent_m/2; px0=-h;py0=-h;px1=h;py1=h; }   // empty grove fallback
    hier.leafW = leafW;   // abscission (spec/model/season.md): each leaf's retained weight by (twig, slot) for the tree preview, which scatters its own leaves; null at the gate
    const key = seasonKey(params, faithful);   // the structure it was grown for (see THE KEY)
    const wood = { radius: params.trunk_radius_m, base: _cb, thickness: _th, zMin, dz,
                   taper: Math.pow(Math.max(1.001, kids), -1/clamp(params.taper_delta,1,4)) };
    let season = null;
    if(keepSeason){
      let sx0=1e18, sy0=1e18, sx1=-1e18, sy1=-1e18;   // the wood's share of the faithful AABB: the season never moves it
      for(const s of woodRest){
        if(s.ax<sx0)sx0=s.ax; if(s.ax>sx1)sx1=s.ax; if(s.ay<sy0)sy0=s.ay; if(s.ay>sy1)sy1=s.ay;
        if(s.bx<sx0)sx0=s.bx; if(s.bx>sx1)sx1=s.bx; if(s.by<sy0)sy0=s.by; if(s.by>sy1)sy1=s.by;
      }
      season = { key, rec: sRec, base: seasonBase, pivot: seasonPivot, side: seasonSide, n: nClusterTotal*nLeaf, nLeaf, nLayer, nCluster: nClusterTotal, nTree, E, tau, seg: [sx0, sx1, sy0, sy1],
                 faithBuf: null, ex: sEx, rank: sRank, u: null, outL: null, outF: null };   // faithBuf: the upload's (the buffer this record is beside)
    }
    let density = null;
    if(cacheDensity){
      // The capacity's marginal leaf is geometry too; its live coverage is recomputed from the current params, never divided out of float32 tau.
      const tipMin = hMin<=hMax ? hMin : 0;
      density = { key: densityKey(params, faithful), hMin: tipMin, hMax: hMax>hMin ? hMax : tipMin+1 };
    }
    return { hier, layers, faithArr, pivot: pivotData, side: sideData, clusterRows, nClusterTotal, shape, litter, reach, key, wood, vary, scaleMax, season, density,
             under: cacheDensity ? { ...params } : null,   // the params a density capacity re-seasons under at the upload: the ones it was grown under
             occ: occOut, sky: { start: skyStart, count: skyCount, rest: skyRest },
             faith: { hMin: castMin, hMax: castMax, binH, rest: woodRest, box: [px0, px1, py0, py1] } };
  }

  // The other half: the grown grove onto the GPU and into the shared state. It reads `G` and nothing else, so the live params may be another look's by now.
  // The OUTGOING grove's own GL objects are freed by installGrove, not here; what is engine-global (the faithful leaves and wood, the sky view's wood) is replaced here.
  function uploadGrove(G){
    const { hier, shape, nClusterTotal } = G;
    // ---- one instanced VAO per depth layer from its accumulated leaves ----
    const buildLayerVAO = (arr) => {
      const buf=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      gl.bufferData(gl.ARRAY_BUFFER,arr,gl.STATIC_DRAW);
      const vao=gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      const S=68;   // 17 floats/leaf: [c.xy,A,B0][angle,tilt,swingGain,swingPhase][tau.rgb,clusterId (+ the outline in its fraction)][orbit.xyzw][iFade]
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5,1,gl.FLOAT,false,S,64); gl.vertexAttribDivisor(5,1);
      gl.bindVertexArray(null);
      return { vao, count: arr.length/17, buf };
    };
    const layerVAO = G.layers.map(buildLayerVAO);   // this grove's own
    faith.hMin = G.faith.hMin; faith.hMax = G.faith.hMax; faith.binH = G.faith.binH;

    // ---- FAITHFUL path (spec/model/canopy.md): one combined VAO of EVERY leaf, each carrying its continuous floor-height (attr 5),
    // for the per-sample geometry bake. Built always (cheap); only DRAWN when faithful_canopy is on. ----
    if(faith.vao){ gl.deleteVertexArray(faith.vao); gl.deleteBuffer(faith.buf); }
    {
      const arr = G.faithArr;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S=72;   // 18 floats/leaf: the 16 bake floats + the continuous height + the fade
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5,1,gl.FLOAT,false,S,64); gl.vertexAttribDivisor(5,1);
      gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6,1,gl.FLOAT,false,S,68); gl.vertexAttribDivisor(6,1);
      if(faith.pivotBuf) gl.deleteBuffer(faith.pivotBuf);
      faith.pivotBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, faith.pivotBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(G.pivot), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8,1,gl.FLOAT,false,4,0); gl.vertexAttribDivisor(8,1);   // the pivot weight, one float a leaf
      if(faith.sideBuf) gl.deleteBuffer(faith.sideBuf);
      faith.sideBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, faith.sideBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(G.side), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(9); gl.vertexAttribPointer(9,1,gl.FLOAT,false,4,0); gl.vertexAttribDivisor(9,1);   // the leaf's side, one float a leaf: read by the tree view alone
      faith.pivot = G.pivot;   // the survivors' weights, as uploaded
      faith.pivotOn = G.pivot.some((w) => w > 0);   // the bake's specialization: VS_FAITH_PIVOT only where a leaf has one
      gl.bindVertexArray(null);
      faith.vao=vao; faith.buf=buf; faith.count=arr.length/18;
    }

    // (the woody shadow is now the CONTINUOUS-height analytic occluder built below, spec/model/canopy.md — the old layer-stamped
    // branch quads were retired because layer quantization shattered continuous lines at a low sun.)

    // ---- (re)build the per-clump data textures sampled by the bake VS ----
    const makeDataTex = (old, data, rows = 1) => {
      if(old) gl.deleteTexture(old);
      const tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, Math.max(1,nClusterTotal), rows, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tx;
    };
    const clusterTex     = makeDataTex(null, G.clusterRows, 3);
    const clusterGeomTex = makeDataTex(null, hier.clusterGeom);      // static geometry
    // the outline's own texture, R16F: LEAF_SAMPLES θ across, one row per variant down. θ REPEATs (±π are one place), the variants CLAMP (a read between two rows is no leaf),
    // LINEAR in θ and no mips — a profile is read at its own resolution. 1×1 for the ellipse: bound and never sampled, because the shader's gate is a uniform branch.
    const leafTex = (() => {
      const tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      if(shape) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, LEAF_SAMPLES, shape.rows, 0, gl.RED, gl.FLOAT, shape.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tx;
    })();
    // the woody occluder's table (growGrove)
    occ.rest = G.occ.rest; occ.ht = G.occ.ht; occ.count = G.occ.count; occ.want = G.occ.want;
    occ.hRef = G.occ.hRef;
    // the FAITHFUL skeleton's capsules
    {
      const segRest = G.faith.rest;
      faith.segRest = segRest; faith.segCount = segRest.length;
      faith.segArr = new Float32Array(segRest.length*9);   // 9 floats/seg (last: marginal-tree coverage): iSeg(ax,ay,bx,by) + iSegH(ha,hb,ra,rb); positions refilled per bake with the sway
      if(faith.segVAO){ gl.deleteVertexArray(faith.segVAO); gl.deleteBuffer(faith.segBuf); }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, faith.segArr, gl.DYNAMIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S=36;
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,1,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.bindVertexArray(null);
      faith.segVAO=vao; faith.segBuf=buf;
    }
    // the SKY VIEW's layer-stamped wood: sky.start and sky.count are filled in place (the engine's handover copies them)
    {
      const segRest = G.sky.rest;
      sky.start.length = 0; sky.count.length = 0;
      for(let l=0;l<G.sky.start.length;l++){ sky.start[l] = G.sky.start[l]; sky.count[l] = G.sky.count[l]; }
      sky.segRest = segRest;
      sky.segArr = new Float32Array(segRest.length*9);
      if(sky.segVAO){ gl.deleteVertexArray(sky.segVAO); gl.deleteBuffer(sky.segBuf); sky.segVAO=null; sky.segBuf=null; }
      if(segRest.length){
        sky.segBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sky.segArr, gl.DYNAMIC_DRAW);
        sky.segVAO = gl.createVertexArray();
        gl.bindVertexArray(sky.segVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,36,0);  gl.vertexAttribDivisor(1,1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,36,16); gl.vertexAttribDivisor(2,1);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,1,gl.FLOAT,false,36,32); gl.vertexAttribDivisor(3,1);
        gl.bindVertexArray(null);
      }
    }
    faith.pminx=G.faith.box[0]; faith.pmaxx=G.faith.box[1]; faith.pminy=G.faith.box[2]; faith.pmaxy=G.faith.box[3];
    const grove = { hier, layerVAO, clusterTex, clusterGeomTex, leafTex, shape, litter: G.litter, reach: G.reach, key: G.key };   // key: the structure it was grown for (see THE KEY)
    grove.wood = G.wood;
    if(G.vary) grove.scaleMax = G.scaleMax;   // the largest shift leaf_variety gave a leaf: the faithful cast frame's pad grows by it (komorebi-bake.js); absent at the gate
    if(G.season){ grove.season = G.season; grove.season.faithBuf = faith.buf; }
    if(G.density){
      grove.season.density = G.density;
      reseasonGrove(grove, G.under);
    }
    return grove;
  }

  // Does this grove's cache still describe the params, and is the engine-global faith.* still its own? (see the header: THE KEY, GOTCHAS)
  const reseasonable = (g) => !!g?.season && g.season.faithBuf === faith.buf && (g.season.density
    ? densityEligible(params) && g.season.density.key === densityKey(params, faithfulOn()) && densityCount(params) <= g.season.nLeaf
    : g.season.key === seasonKey(params, faithfulOn()));

  // The season arithmetic of buildGrove (the hang loop's tau, the rec rewrite, the compaction, the litter, leafW, the faithful AABB), re-run over g.season in ONE pass
  // on typed arrays. It must stay the same arithmetic as buildGrove's, call for call — reseason.test.js holds the bytes.
  // THE TIERS (komorebi-season.js, "the leaf's season in three tiers"): each leaf's draws (S.draws: its three pigment-stream draws and its drop hash, the grove's) and its
  // schedule (S.sched: the turn window, the pigment depths and the drop day, a function of the draws and of the season set without the STATE keys) are kept, so a step
  // of the clock, the summer tint or the wall fraction does only each leaf's state now: s across its window, the mixture, the retention. Any other season key rebuilds
  // the schedule from the kept draws (no leaf is hashed again). The fallen are listed when the list is READ (g.litter is a getter): a floor with no carpet never asks.
  function reseasonGrove(g, P = params){
    const S = g.season, n = S.n, rec = S.rec, nLeaf = S.density ? densityCount(P) : S.nLeaf, nLayer = S.nLayer, tau = S.tau, leafT = [0,0,0], leafRow = g.hier.leafRow;   // leafRow: the table of rows the build drew (leaf_variety), which the litter keeps; null at the gate
    const pcF = S.density ? Math.max(0, P.leaves_per_cluster*P.foliage_density) : 0, pcInt = Math.floor(pcF), frac = pcF-pcInt;
    let hMin = S.density?.hMin, hMax = S.density?.hMax;
    // Summer transmission is authored live; the cached leaf geometry and exposure do not depend on it.
    tau[0] = -Math.log(clamp(P.trans_r,1e-4,0.999));
    tau[1] = -Math.log(clamp(P.trans_g,1e-4,0.999));
    tau[2] = -Math.log(clamp(P.trans_b,1e-4,0.999));
    const sen = senescing(P), ph = P.phenology, fw = (FEAT_PIGMENT || FEAT_EXPOSURE) ? P.wall_fraction : 0, twigs = g.hier.twigs;   // the tiers literally, so a bundle that cuts them folds the read away
    const track = dropping(P) && n > 0;
    // leaf-out: each leaf's two spring draws, kept with the grove the first time a step reaches the spring (its draws tier); its state is asked each step
    const isSpring = FEAT_SPRING && springing(P) && n > 0, spr = [0,0];
    if(FEAT_SPRING && isSpring && !S.springD){ S.springD = new Float64Array(2*n); for(let i=0;i<n;i++) springDraws(P.seed, rec[SREC*i+6], rec[SREC*i+7], S.springD, 2*i); }
    // buildGrove's three arms for a leaf's tau: the light's leafTau (FEAT_EXPOSURE && lit), its own clock's (FEAT_PIGMENT && senescing), or the summer tau. `lit` is senescing and
    // turn_exposure > 0, so given senescing the arm is a property of the schedule's keys, and the schedule is built for it.
    const turning = (FEAT_PIGMENT || FEAT_EXPOSURE) && sen && ((FEAT_EXPOSURE && P.turn_exposure > 0) || FEAT_PIGMENT);
    const sc = (FEAT_PIGMENT || FEAT_EXPOSURE || FEAT_DROP) && n > 0 && (turning || FEAT_DROP && track) ? scheduleOf(g, P) : null, at = sc?.at;
    if(!S.outL){ S.outL = S.base.map(a => new Float32Array(a.length)); S.outF = new Float32Array(n*18); S.outP = new Float32Array(n); S.outS = new Float32Array(n); }
    const outL = S.outL, outF = S.outF, outP = S.outP, outS = S.outS, wL = new Int32Array(nLayer);
    const fallen = FEAT_DROP && track ? [] : null, leafW = FEAT_DROP && track ? new Float32Array(S.nCluster*nLeaf).fill(1) : null;
    let wF = 0, px0 = S.seg[0], px1 = S.seg[1], py0 = S.seg[2], py1 = S.seg[3];
    let lx0 = 1e18, ly0 = 1e18, lx1 = -1e18, ly1 = -1e18;   // the survivors' plan extent (doubles, like buildGrove's own scan of faithData)
    for(let i=0;i<n;i++){
      const o = SREC*i, j = rec[o+6], k = rec[o+7];
      if(S.density && k >= nLeaf) continue;
      let w = 1;
      if(FEAT_DROP && track){
        w = retention(sc.D[i], ph);
        leafW[j*nLeaf + k] = w;
      }
      const cov = S.density ? ((k===pcInt) ? frac : 1.0)*twigs[j].tcov : rec[o+8], cf = cov*w;
      if(w === 0){
        if(FEAT_LITTER) fallen.push(i, cov);
        continue;
      }
      if(FEAT_SPRING && isSpring){ leafSpring(P, S.springD[2*i], spr); if(spr[0] === 0) continue; }   // not out yet: no leaf
      const lt = turning ? leafTauAt(tau, smoothstep(at[LEAF_SCHED*i], at[LEAF_SCHED*i+1], ph), at, LEAF_SCHED*i, fw, leafT) : FEAT_SPRING && isSpring ? springTau(tau, P, spr[1], S.springD[2*i+1], leafT) : tau;
      const l = rec[o+9], li = rec[o+10], bl = S.base[l], dl = outL[l], wl = wL[l];
      for(let q=0;q<8;q++){ const v = bl[li+q]; dl[wl+q] = v; outF[wF+q] = v; }
      if(FEAT_SPRING && isSpring && spr[0] < 1){ for(let a=2;a<=3;a++){ const v = rec[o+1+a]*spr[0]; dl[wl+a] = v; outF[wF+a] = v; } }   // still growing: the grown half-axes (the record's A, B0) × its length's share, as the build scales them
      for(let c=0;c<3;c++){ const v = lt[c]*cf; dl[wl+8+c] = v; outF[wF+8+c] = v; }
      for(let q=11;q<16;q++){ const v = bl[li+q]; dl[wl+q] = v; outF[wF+q] = v; }
      dl[wl+16] = cf; outF[wF+16] = rec[o+2]; outF[wF+17] = cf; outP[wF/18] = S.pivot[i]; outS[wF/18] = S.side[i];
      wL[l] = wl + 17; wF += 18;
      const x = rec[o], y = rec[o+1];
      if(x<lx0)lx0=x; if(x>lx1)lx1=x; if(y<ly0)ly0=y; if(y>ly1)ly1=y;
      if(S.density){ const z = rec[o+2]; if(z<hMin)hMin=z; if(z>hMax)hMax=z; }
    }
    for(let l=0;l<nLayer;l++){
      const L = g.layerVAO[l];
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buf);
      gl.bufferData(gl.ARRAY_BUFFER, outL[l].subarray(0, wL[l]), gl.DYNAMIC_DRAW);
      L.count = wL[l]/17;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, S.faithBuf);
    gl.bufferData(gl.ARRAY_BUFFER, outF.subarray(0, wF), gl.DYNAMIC_DRAW);
    faith.count = wF/18;
    gl.bindBuffer(gl.ARRAY_BUFFER, faith.pivotBuf);                                    // the survivors' pivot weights, beside them in the same order
    gl.bufferData(gl.ARRAY_BUFFER, outP.subarray(0, wF/18), gl.DYNAMIC_DRAW);
    faith.pivotOn = outP.subarray(0, wF/18).some((w) => w > 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, faith.sideBuf);                                     // ...and their sides
    gl.bufferData(gl.ARRAY_BUFFER, outS.subarray(0, wF/18), gl.DYNAMIC_DRAW);
    if(lx0<px0)px0=lx0; if(lx1>px1)px1=lx1; if(ly0<py0)py0=ly0; if(ly1>py1)py1=ly1;
    if(px0>px1){ const h=P.canopy_extent_m/2; px0=-h;py0=-h;px1=h;py1=h; }   // empty grove fallback
    faith.pminx=px0; faith.pmaxx=px1; faith.pminy=py0; faith.pmaxy=py1;
    if(S.density){ faith.hMin=hMin; faith.hMax=hMax; g.hier.nLeaf=nLeaf; S.key=g.key=seasonKey(P, faithfulOn()); }
    g.hier.leafW = leafW;
    if(!(FEAT_LITTER && fallen)){ setLitter(g, fallen && []); return; }   // no drop: the build's null; a bundle without the carpet: its empty list
    // THE FALLEN, LISTED WHEN READ: buildGrove's own objects, made from this step's numbers (the tint, the clock and the wall fraction are copied now; the schedule is the one
    // this step read, which only the next re-season rebuilds — and that replaces this getter before anything can read it). Read once, then kept; a route may replace the list.
    const tint = [tau[0], tau[1], tau[2]];
    let list = null;
    Object.defineProperty(g, 'litter', { configurable: true, enumerable: true, set(v){ setLitter(g, v); }, get(){
      if(list) return list;
      list = [];
      const t = [0,0,0];
      for(let f=0;f<fallen.length;f+=2){
        const i = fallen[f], o = SREC*i, j = rec[o+6], k = rec[o+7];
        const lt = turning ? leafTauAt(tint, smoothstep(at[LEAF_SCHED*i], at[LEAF_SCHED*i+1], ph), at, LEAF_SCHED*i, fw, t) : tint;
        list.push({ x: rec[o], y: rec[o+1], h: rec[o+2], D: sc.D[i], tau: [lt[0], lt[1], lt[2]], size: [rec[o+3], rec[o+4]], j, k, fade: fallen[f+1], ...(leafRow && { row: leafRow[j*nLeaf + k] }) });
      }
      // ...and the order the carpet lays them in (litterOrder: by day, ties by address), read off the schedule's whole-grove order: a leaf has fallen exactly when the
      // clock has reached its day, so the fallen are that order's survivors of a filter, in place. Out of sight (not enumerable), so the list is the build's list.
      const byDay = [], slot = new Int32Array(n).fill(-1), order = dayOrder(g, sc);
      for(let f=0;f<fallen.length;f+=2) slot[fallen[f]] = f/2;
      for(let q=0;q<n;q++){ const p = slot[order[q]]; if(p >= 0) byDay.push(list[p]); }
      Object.defineProperty(list, 'byDay', { value: byDay });
      return list;
    } });
  }
  // Every leaf of the record in the carpet's order (komorebi-litter.js litterOrder: ascending day, ties by cluster then leaf), with that comparator's own arithmetic. Kept with the
  // schedule that set the days, so the clock never sorts.
  function dayOrder(g, sc){
    if(sc.byDay) return sc.byDay;
    const rec = g.season.rec, D = sc.D, J = (i) => rec[SREC*i+6], K = (i) => rec[SREC*i+7];
    sc.byDay = Int32Array.from({ length: g.season.n }, (_, i) => i).sort((a, b) => D[a] - D[b] || J(a) - J(b) || K(a) - K(b));
    return sc.byDay;
  }
  const setLitter = (g, v) => Object.defineProperty(g, 'litter', { value: v, writable: true, configurable: true, enumerable: true });

  // A leaf's draws and schedule (THE TIERS, above), rebuilt when a season key outside the state keys moves. The exposure field, its rank and the blend `u` are read here
  // and only here: what the light orders (the turn, the red, the drop day) is all schedule. Its arms follow buildGrove's: the light's order where the turn is lit
  // (FEAT_EXPOSURE && turn_exposure > 0), the leaf's own clock otherwise; the drop day by the turn's phase after the turn, by its own hash mixed toward the light before.
  // After the turn a step can be dropping and not yet senescing (a turn window shorter than the fade); the build's day then takes the leaf's own clock where this takes
  // the light, but its retention is 1 either way (the day is past the turn's start + ε), so the day is never read there.
  function scheduleOf(g, P){
    const S = g.season, n = S.n, rec = S.rec, twigs = g.hier.twigs;
    const key = SCHEDULE_KEYS.map(k => P[k]).join('|');
    if(S.sched?.key === key) return S.sched;
    if(!S.draws){
      S.draws = new Float64Array(4*n);
      for(let i=0;i<n;i++){ const o = SREC*i, j = rec[o+6], k = rec[o+7]; leafDraws(P.seed, j, k, S.draws, 4*i); S.draws[4*i+3] = dropHash(P.seed, j, k); }
    }
    const lit = FEAT_EXPOSURE && P.turn_exposure > 0, after = afterTurn(P);
    let u = null;
    if(FEAT_EXPOSURE && (lit || FEAT_DROP && P.leaf_drop > 0 && !after && P.drop_exposure > 0)){
      if(!S.rank){
        const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), Ar = new Float64Array(n), K = new Float64Array(n);
        for(let i=0;i<n;i++){ const o = SREC*i; X[i]=rec[o]; Y[i]=rec[o+1]; Z[i]=rec[o+2]; Ar[i]=rec[o+5]; K[i]=S.draws[4*i]; }   // K: each leaf's own clock, leafClock (its first draw)
        S.ex = exposureGrid(X, Y, Z, Ar, S.E);
        S.rank = exposureRank(S.ex, K);
      }
      if(!S.u) S.u = new Float64Array(n);
      u = exposureBlend(S.rank, S.ex, P.exposure_absolute, S.u);   // at exposure_absolute 0 this IS the rank: read, never written
    }
    const tShift = (FEAT_PIGMENT || FEAT_EXPOSURE || FEAT_DROP) ? treeShifts(P, S.nTree) : null, tGain = (FEAT_PIGMENT || FEAT_EXPOSURE) ? treeGains(P, S.nTree) : null;   // the trees' lead and depth: the build's own tables, from the tree count the record kept, guarded by the same tiers
    if(!S.sched) S.sched = { key: null, builds: 0, at: new Float64Array(LEAF_SCHED*n), D: new Float64Array(n) };
    const sc = S.sched;
    const d = S.draws, at = sc.at, D = sc.D;
    for(let i=0;i<n;i++){
      const tree = twigs[rec[SREC*i+6]].tree, dT = tShift ? tShift[tree] : undefined, cT = tGain ? tGain[tree] : undefined;
      const phiE = lit ? turnOrder(u[i]) : undefined;
      const phi = turnPhase(P, d[4*i], phiE);
      turnWindow(P, phi, dT, at, LEAF_SCHED*i);
      if(FEAT_PIGMENT || FEAT_EXPOSURE) leafPigments(P, d[4*i+1], d[4*i+2], lit ? P.turn_exposure : 0, lit ? redGain(u[i]) : undefined, cT, at, LEAF_SCHED*i);
      if(FEAT_DROP && P.leaf_drop > 0) D[i] = after ? dropDayAfterTurn(P, phi, dT) : dropDay(P, dropPhase(d[4*i+3], u ? u[i] : 0, P.drop_exposure), dT);
    }
    sc.key = key; sc.builds++; sc.byDay = null;
    return sc;
  }

  // Radius and layer height are live look uniforms, but wood stores them in CPU geometry too.
  // Refresh those numbers from the grown skeleton; leaves and GPU allocations stay in place.
  function refreshWood(){
    if(!(params.branch_tau>0)) return false;   // a leaf-only crossfade shares faith.* with its incoming grove
    const g = hub.grove, w = g?.wood;
    if(!w || (w.radius===params.trunk_radius_m && w.base===params.canopy_base_height_m && w.thickness===params.canopy_thickness_m)) return false;
    w.radius=params.trunk_radius_m; w.base=params.canopy_base_height_m; w.thickness=params.canopy_thickness_m;
    const floorH = (z) => z<=w.zMin ? w.base*(Math.max(0,z)/Math.max(w.zMin,1e-3)) : w.base + (z-w.zMin)/w.dz*w.thickness;
    let i=0, hRef=1e-3;
    for(let k=0;k<g.hier.segments.length;k++){
      const sg=g.hier.segments[k], s=faith.segRest[k];
      s.ra=Math.max(0.012, w.radius*Math.pow(w.taper, sg.level+(sg.f0||0)));
      s.rb=Math.max(0.008, w.radius*Math.pow(w.taper, sg.level+(sg.f1!=null?sg.f1:1)));
      if(sg.level<=1 && i<occ.count){
        const ha=floorH(sg.a[2]), hb=floorH(sg.b[2]), o=4*i++;
        occ.ht[o]=ha; occ.ht[o+1]=hb; occ.ht[o+2]=Math.max(0.01, w.radius*Math.pow(w.taper, sg.level));
        hRef=Math.max(hRef,ha,hb);
      }
    }
    occ.hRef=hRef;
    return true;
  }

  return { buildGrove, growGrove, uploadGrove, reseasonGrove, reseasonable, refreshWood };
}

// What a bake hands its program to draw a grove's leaves in THEIR shape: the outline's texture (unit 6: 0-3 are the layers, 4 and 5 the cluster textures), the
// gate (a uniform, per grove — a crossfade bakes an ellipse grove and a maple one in one pass) and the box the quad covers. The ellipse's box is (0, 0, 1, 1), which
// leaves the corner it scales to the bit (x·1 + 0), so the off state is the quad it always was. `u` is a program's own table: bake, faith and litter name them alike.
const NO_BOX = [0, 0, 1, 1];
export function bindLeafShape(gl, u, g){
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, g.leafTex); gl.uniform1i(u.leafTex, 6);
  gl.uniform1i(u.leafShape, g.shape ? 1 : 0);
  gl.uniform4fv(u.shapeBox, g.shape ? g.shape.box : NO_BOX);
  // leaf_variety's packing: the cluster id's fraction is j + row/idFrac, and a varied grove's table has `rows` rows to read it in. An eight-row grove and the ellipse send 32 and 0: the VS's multiply by 32 is the same IEEE op as a literal ·32 (x·32 is exact), and the FS keeps its literal /8.
  gl.uniform1f(u.leafIdFrac, g.shape?.idFrac ?? LEAF_ID_FRAC);
  gl.uniform1f(u.leafRows, g.shape?.idFrac ? g.shape.rows : 0);
}
