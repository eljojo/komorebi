// ============================================================================
// The season — pure functions, no GL, no engine state (spec/model/season.md). A leaf's pigment state through the autumn turn and what orders it (light, the
// leaf's own clock, its tree's lead), abscission, and the spring's leaf-out; the predicates the grove and the feature registry (komorebi-params.js) ask of the
// same params; the per-leaf and per-tree draws, each on a salt of its own. The grove (komorebi-grove.js) lays the leaves out and calls these; the routes
// between seasons and the editor read the same laws.
// ============================================================================
import { DEG, clamp, hash3, mulberry32, smoothstep } from '../komorebi-math.js';
import { mixtureTau } from '../leaf/komorebi-leaf.js';

// ---- autumn senescence (spec/model/season.md): a leaf's pigment state, per leaf. Chlorophyll is dismantled and the carotenoid
// that was always there shows; anthocyanin is synthesised (red); tannin browns. Optical depth is ADDITIVE, so each
// pigment is a basis vector of per-channel tau (R,G,B), and a leaf is its summer tau faded out plus these faded in.
// FITTED to the PROSPECT-D leaf model (Féret et al. 2017; computed from the `prospect` R package, Féret & de Boissieu 2024) in OKLab, D65, over 77 turned leaves spanning the autumn Norway-maple
// set's measured range (anthocyanin 0-22 ug/cm2, carotenoid at its mean 5.25 ug/cm2, brown 0-1.5 units), every component held
// >= 0 so no leaf adds light (leaf.test.js holds the fit). The units keep each knob's green depth per unit (2.8, 1.2): a = 1 is
// about 23 ug/cm2 of anthocyanin, b = 1 about 1.7 PROSPECT brown units. The real gold's red lies past the sRGB primary, which a
// non-negative depth cannot paint: carotenoid's red is capped at the light's own, the fit's worst leaf. Backlit leaves against a
// diffuser (tau = -ln(leaf / diffuser), one per pigment state) would replace the model with José's own maples.
const TAU_CAROTENOID  = [0, 0.514, 2.243];       // absorbs blue and some green, no red -> gold (T 1/.60/.11). Always present, hidden by chlorophyll until it goes
const TAU_ANTHOCYANIN = [0.519, 2.8, 1.685];     // absorbs green, then blue, a little red: on top of the gold it turns orange -> red -> maroon as a rises (T_g .34 / .064 / .021 at a = .2 / .8 / 1.2)
const TAU_TANNIN      = [0.883, 1.2, 1.398];     // broad, warm-leaning (b > g > r): the russet of beech and oak (T .41/.18/.026 at b = 1, over the gold)
// A leaf's identity is its OWN stream, seeded from (seed, cluster, leaf) and never the growth RNG, so drawing from it
// cannot move one twig or one leaf of any shipped grove. The salt keeps it independent of the arrangement stream
// (hash3(seed, j, 101), made from the same ingredients).
const LEAF_SALT = 0x51ED270B;
const _leafCell=[0,0,0], _leafWall=[0,0,0];   // scratch for leafTau, written and read within one synchronous call
// s_j: how far leaf (stream value phi in [0,1)) has turned. smoothstep from its own start to the common finish; the
// spread is clamped under the span so the transition keeps a floor of width and the smoothstep a positive one.
// DROP AFTER THE TURN (`drop_after_turn`, spec/model/season.md Abscission): the common finish above leaves a leaf no turn of its own to wait for (every leaf ends at
// turn_start + turn_span), so a drop bound to the turn would have no order. At 1 each leaf's window is its own LENGTH L = span − spread from its own start, and
// the last leaf (phi -> 1) still ends at turn_start + span. The start is the same expression, so s = 0 below turn_start and every summer byte survive. THE TRADE:
// the mid-turn crown turns sooner at 1 (a turn change inside a drop knob; from turn_start + turn_span on the colour is identical). At 0 the branch is not
// taken and the expression below is today's, literally.
const afterTurn = (P) => P.drop_after_turn > 0;
function turnLength(P){
  const span = Math.max(P.turn_span, 1e-4);
  return span - clamp(P.turn_spread, 0, span*0.95);
}
// ONE TREE AHEAD (`dT`, below): a tree's lead moves the whole clock — the start, and so the finish with it — by shifting `turn_start`. The grove hands no `dT` at tree_clock_spread 0 (and the
// lead of a tree that draws exactly 0 is 0), and then `start` IS turn_start: the expressions below are today's, literally, with no `+ 0` in them.
// The window itself, [start, finish) of the turn, written at out[o], out[o+1]: what senescence smoothsteps across, and what the grove's re-season keeps per leaf.
function turnWindow(P, phi, dT, out, o = 0){
  const span = Math.max(P.turn_span, 1e-4), spread = clamp(P.turn_spread, 0, span*0.95);
  const start = dT ? P.turn_start + dT : P.turn_start;
  if(afterTurn(P)){ const T0 = start + phi*spread; out[o] = T0; out[o+1] = T0 + (span - spread); }
  else { out[o] = start + phi*spread; out[o+1] = start + span; }
  return out;
}
const _turnWin = [0,0];
function senescence(P, phi, dT){
  turnWindow(P, phi, dT, _turnWin);
  return smoothstep(_turnWin[0], _turnWin[1], P.phenology);
}
// A leaf's own turn clock phi_j: the FIRST draw of leafTau's stream, the number its senescence starts by when no light orders it (turn_exposure 0).
// Given as its order with a gain of 1, leafTau is that leaf to the bit — which is what lets the exposure rank use it as the tie-break among
// leaves of equal light (exposureRank's `key`): the one that would have started first on its own is the one the rank puts first. It does not
// draw a stream of its own, so nothing about a leaf moves. Pure function of (seed, j, k), like leafTau's.
function leafClock(seed, j, k){ return mulberry32(hash3((seed>>>0)^LEAF_SALT, j, k))(); }
// A leaf's turn phase phi' (leafTau's, in leafTau's float order): its own clock, mixed toward the exposure order by turn_exposure when the grove hands one over.
// One function so the turn and the drop-after-the-turn ask the same question of the same leaf; the draw itself stays leafTau's, so no stream moves.
function turnPhase(P, phi, phiE){
  const w = phiE === undefined ? 0 : P.turn_exposure;
  if(w > 0) phi += (phiE - phi)*w;
  return phi;
}
// One leaf's tau (R,G,B): summer*(1-s) + s*(carotenoid + a*anthocyanin + b*tannin), the cells; the walls the same
// without the anthocyanin (vein tissue makes none); then the sieve mixture. j,k = the leaf's cluster and its place in
// it — stable under tree_count / density morphs, which a flat running index is not. Fills `out` (no garbage per leaf).
// GATE: s_j = 0 (not yet turning — every leaf at phenology <= turn_start) returns tauSummer's own numbers with no
// arithmetic on them. At s = 0 wall and cell are the same tissue, so the mixture would be the identity in exact
// arithmetic; the branch makes it the identity in float too, for any f_w.
// LIGHT (below): `phiE` and `gainE` = this leaf's turn order and red gain by exposure, given only by a grove that has
// laid itself out. Absent `phiE`, or turn_exposure 0, no arithmetic touches phi or a: P0's leaf, to the bit. The draws
// keep their order either way (phi, then a, then b), so the hash never moves.
// ONE TREE AHEAD (spec/model/season.md): `dT` (<= 0) is the leaf's tree's lead, which shifts its clock (senescence); `cT` is the tree's depth, which scales red AND brown after the light's gain — the walls brown with the
// tree, because b is in both tissues. Both absent (the grove hands them over only at tree_clock_spread / tree_pigment_spread above 0) and no arithmetic touches the leaf.
function leafTau(tauSummer, P, seed, j, k, out = [0,0,0], phiE, gainE, dT, cT){
  const r = mulberry32(hash3((seed>>>0)^LEAF_SALT, j, k));
  turnWindow(P, turnPhase(P, r(), phiE), dT, _leafSched);       // mix(phi, f(1 - exposure), w); r() first, so the draws keep their order
  const s = smoothstep(_leafSched[0], _leafSched[1], P.phenology);
  if(s === 0){ out[0]=tauSummer[0]; out[1]=tauSummer[1]; out[2]=tauSummer[2]; return out; }
  leafPigments(P, r(), r(), phiE === undefined ? 0 : P.turn_exposure, gainE, cT, _leafSched);
  return leafTauAt(tauSummer, s, _leafSched, 0, P.wall_fraction, out);
}
// THE LEAF'S SEASON IN THREE TIERS (spec/model/season.md "Re-seasoning"). leafTau above is the three in a row; the grove's re-season keeps the first two per leaf, so a
// step of the clock pays only the third, in the same float order, so the two are one arithmetic:
//   its DRAWS: the leaf's own stream, (seed, j, k) alone, so the grove's: [turn clock, red, brown] (leafDraws; the first is leafClock);
//   its SCHEDULE: what the season's knobs make of them, the window it turns in (turnWindow) and the wall and cell pigment depths it turns toward (leafPigments),
//     written as [start, finish, wall r g b, cell r g b] at out[o] (LEAF_SCHED numbers);
//   its STATE NOW: phenology, the summer tint and the wall fraction (leafTauAt), with s = smoothstep(start, finish, phenology).
const LEAF_SCHED = 8;
const _leafSched = new Float64Array(LEAF_SCHED);
function leafDraws(seed, j, k, out, o = 0){
  const r = mulberry32(hash3((seed>>>0)^LEAF_SALT, j, k));
  out[o] = r(); out[o+1] = r(); out[o+2] = r();
  return out;
}
// `w` is the light's weight on this leaf's red (turn_exposure where the grove handed an order, else 0); `gainE` its red gain by exposure; `cT` its tree's depth.
function leafPigments(P, d1, d2, w, gainE, cT, out, o = 0){
  let a = P.anthocyanin*(0.5 + d1);
  let b = P.tannin*(0.5 + d2);
  if(w > 0) a *= 1 + (gainE - 1)*w;                           // a * mix(1, g(exposure), w)
  if(cT !== undefined){ a *= cT; b *= cT; }                   // the tree's depth, red and brown together
  for(let c=0;c<3;c++){
    const pig = TAU_CAROTENOID[c] + b*TAU_TANNIN[c];
    out[o+2+c] = pig;                                         // the walls: no anthocyanin (vein tissue makes none)
    out[o+5+c] = pig + a*TAU_ANTHOCYANIN[c];                  // the cells
  }
  return out;
}
function leafTauAt(tauSummer, s, sched, o, fw, out = [0,0,0]){
  if(s === 0){ out[0]=tauSummer[0]; out[1]=tauSummer[1]; out[2]=tauSummer[2]; return out; }
  const cell = _leafCell, wall = _leafWall;
  for(let c=0;c<3;c++){
    const base = tauSummer[c]*(1-s);
    wall[c] = base + s*sched[o+2+c];
    cell[c] = base + s*sched[o+5+c];
  }
  return mixtureTau(wall, cell, fw, out);
}

// ---- LIGHT DECIDES WHO TURNS FIRST (spec/model/season.md, P1). Anthocyanin is made in light, so the leaves that see the sun —
// the crown's top, its sun side, its outer shell, a tree with no shading neighbour — turn first and turn reddest,
// while the shaded interior and underside go later and stay yellow. A leaf's exposure is the fraction of a sun ray
// that reaches it through the leaves in the way: Beer-Lambert up a representative sun ray over a plan grid of leaf
// area per height band, the CPU twin of the layer bake. Pure arithmetic over positions — no GL, and no RNG, so a
// grove laid out for it is the same grove (the growth stream is never drawn from).
// THE SEASON'S SUN, not the look's. Pigment integrates over weeks, and the live sun (time_of_day, a look's authored
// angle) is not a canopy parameter: a look that sweeps the sun must not repaint its leaves. 45 degrees is the mid-
// latitude daytime mean; azimuth 180 is SOUTH here — updateSunFromTime puts solar noon at 180 (east 90, west 270) and
// sunDirection measures azimuth from +x toward +y, so the ray climbs toward -x.
const SEASON_SUN = { el: 45, az: 180 };
// kx: Beer-Lambert's extinction per unit leaf-area index, I = I0 exp(-kx . LAI / sin el). 0.5 is the projection
// function G of a canopy whose leaves face every way at random (a spherical leaf-angle distribution, the textbook
// default for broadleaf stands; k_eff ~ 0.5-0.8 measured across them); the 1/sin(el) is the longer slant path, taken
// below in the slab. Orientation is otherwise ignored (leaves are counted by their flat area), and so is clumping.
const EXPOSURE_K = 0.5;
const EXPOSURE_RES = 48, EXPOSURE_BANDS = 24;   // plan cells across the canopy extent / height bands across the grown crown
// What the valley's terrain will say about the leaf at plan position (x, y): a hill's shadow, a slope that faces away
// from the sun, the building across the way. 1 until it exists — a named seam, not a feature (hence the unused
// arguments). Multiplied into every exposure, before the rank.
function groundShade(_x, _y){ return 1; }
// Each leaf's exposure in (0, 1]: exp(-kx . leaf area the ray passes through / sin el) . groundShade. x, y, z = the
// leaf's plan position and grown height, area = its flat area (times its fade), E = the canopy extent. The grid is
// ANCHORED to the world (cell edges at multiples of E/48), so a morph that nudges leaves does not slide the lattice;
// it widens only for a grove more than twice the extent. Leaf area is binned per cell and height band; the ray is
// walked cell by cell from the leaf (2-D DDA) and, in each cell, takes the area whose height lies in the slab the ray
// climbs through there — not "everything above", which would count leaves that are nowhere near the ray. Within a band
// area is spread evenly (so the leaf's own cluster shades it by half) and the leaf's own area is taken back out,
// so a lone leaf is fully lit: exactly 1, not 1 minus dust. The topmost leaf has nothing above it and is exactly 1.
function exposureGrid(x, y, z, area, E, out = new Float64Array(x.length)){
  const n = x.length, B = EXPOSURE_BANDS;
  if(!n) return out;
  let x0=Infinity, x1=-Infinity, y0=Infinity, y1=-Infinity, zMin=Infinity, zMax=-Infinity;
  for(let i=0;i<n;i++){
    if(x[i]<x0)x0=x[i]; if(x[i]>x1)x1=x[i]; if(y[i]<y0)y0=y[i]; if(y[i]>y1)y1=y[i]; if(z[i]<zMin)zMin=z[i]; if(z[i]>zMax)zMax=z[i];
  }
  const cs = Math.max(E/EXPOSURE_RES, Math.max(x1-x0, y1-y0)/(2*EXPOSURE_RES - 1));
  const ox = Math.floor(x0/cs)*cs, oy = Math.floor(y0/cs)*cs;
  const nx = Math.floor((x1-ox)/cs) + 1, ny = Math.floor((y1-oy)/cs) + 1;
  const dzB = zMax > zMin ? (zMax - zMin)/B : 1, W = B + 1;
  const above = new Float64Array(nx*ny*W);                    // above[c*W + b] = leaf area in cell c in bands >= b (the last slot stays 0)
  const band = (zz) => Math.min(B-1, Math.floor((zz - zMin)/dzB));
  for(let i=0;i<n;i++) above[(Math.floor((y[i]-oy)/cs)*nx + Math.floor((x[i]-ox)/cs))*W + band(z[i])] += area[i];
  for(let c=0;c<nx*ny;c++) for(let b=B-1;b>=0;b--) above[c*W+b] += above[c*W+b+1];
  const aboveAt = (c, h) => {                                 // leaf area in cell c above height h, area spread evenly through each band
    const u = (h - zMin)/dzB;
    if(u >= B) return 0;
    if(u <= 0) return above[c*W];
    const b = Math.floor(u), o = c*W + b;
    return above[o] - (u - b)*(above[o] - above[o+1]);
  };
  const el = SEASON_SUN.el*DEG, az = SEASON_SUN.az*DEG, tanEl = Math.tan(el), sinEl = Math.sin(el);
  const dx = Math.cos(az), dy = Math.sin(az), adx = Math.abs(dx), ady = Math.abs(dy);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tDX = adx > 0 ? cs/adx : Infinity, tDY = ady > 0 ? cs/ady : Infinity;   // horizontal distance across one cell, per axis
  const k = EXPOSURE_K/(cs*cs*sinEl);
  for(let i=0;i<n;i++){
    const px = x[i] - ox, py = y[i] - oy;
    let cx = Math.floor(px/cs), cy = Math.floor(py/cs);
    let tMX = adx > 0 ? ((dx > 0 ? (cx+1)*cs - px : px - cx*cs)/adx) : Infinity;
    let tMY = ady > 0 ? ((dy > 0 ? (cy+1)*cs - py : py - cy*cs)/ady) : Infinity;
    const zi = z[i], bi = band(zi);
    let t = 0, sum = 0;
    for(let first=true, steps=nx+ny;steps-- > 0;first=false){     // a ray crosses at most nx+ny cells: termination does not lean on the data
      const tOut = Math.min(tMX, tMY), zlo = zi + t*tanEl, zhi = zi + tOut*tanEl;
      if(zlo >= zMax) break;                                  // the ray has climbed out of the crown
      const c = cy*nx + cx;
      let a = aboveAt(c, zlo) - aboveAt(c, zhi);
      if(first) a -= area[i]*Math.max(0, Math.min(zhi, zMin + (bi+1)*dzB) - zlo)/dzB;   // the leaf is not its own shade
      if(a > 1e-9) sum += a;                                  // under a thousandth of a mm^2 is rounding, not leaf
      t = tOut;
      if(tMX < tMY){ cx += sx; tMX += tDX; } else { cy += sy; tMY += tDY; }
      if(cx < 0 || cx >= nx || cy < 0 || cy >= ny) break;     // off the grid: nothing grows there
    }
    out[i] = Math.exp(-k*sum)*groundShade(x[i], y[i]);
  }
  return out;
}
// HOW EXPOSURE ACTS. Both maps take the leaf's exposure RANK u in its own grove (0 buried .. 1 most exposed — its
// percentile, below), not the raw exposure. Raw exposure is a property of how dense a look is (a crowded grove's mean
// is ~0.3, an open one's ~0.7), so mapping it directly would repaint a look every time its density moved: a dense look
// would turn greener and a sparse one earlier. The rank is uniform on (0,1) whatever the density, exactly like the
// hash it blends with, so the look's own turn schedule and its mean red are untouched BY CONSTRUCTION and exposure
// only decides WHO. Between-tree differences survive (the rank is the grove's, not the tree's): a shaded tree ranks
// below a sunlit one. What is lost is absolute light — a wholly open canopy is still ordered, top to underside, over
// its whole span, which amplifies differences a stand that sunny would barely have, and a grove wholly in shade still
// has a red, early half. exposureBlend (below) gives absolute light back, as far as exposure_absolute says.
// TIES. A leaf whose one representative ray crosses no leaf area is exactly 1 — the up-sun shell and the top of the stand, a few percent of a
// grove — and equals have to share a rank (the mean-rank law), so they would share one u: one turn phase, one drop day, a surface that dims as
// one. `key` (optional: each leaf's own turn clock, leafClock) breaks the tie, and only the tie: within a run of equal exposure the leaf with the
// SMALLER key — the one that would have turned first on its own (its own clock, not its tree's: a tree's lead is added after the rank) — takes the higher rank, so the group spreads over its own slice of the order
// (the same (lo + up)/(2n) per leaf, so every untied leaf's rank is the keyless one to the bit). Leaves equal in the key as well (a 32-bit
// collision) cannot be told apart and keep the mid-rank of their slots, so the ranks stay a permutation of (i + 1/2)/n and the mean exactly 1/2.
// Absent `key` it is the keyless law, ties alike. NOT reached at exposure_absolute 1: there u is the raw exposure, literally 1.0 for the group.
function exposureRank(ex, key, out = new Float64Array(ex.length)){
  const n = ex.length;
  if(!n) return out;
  if(key){
    const order = new Uint32Array(n);
    for(let i=0;i<n;i++) order[i] = i;
    order.sort((a, b) => ex[a] < ex[b] ? -1 : ex[a] > ex[b] ? 1 : key[b] < key[a] ? -1 : key[b] > key[a] ? 1 : 0);   // exposure ascending, then key DESCENDING: the earliest clock is last, the highest rank
    for(let lo=0, up;lo<n;lo=up){
      const e = ex[order[lo]], q = key[order[lo]];
      for(up=lo+1;up<n && ex[order[up]] === e && key[order[up]] === q;up++);
      const r = (lo + up)/(2*n);
      for(let m=lo;m<up;m++) out[order[m]] = r;
    }
    return out;
  }
  const sorted = Float64Array.from(ex).sort();                // typed arrays sort numerically
  for(let i=0;i<n;i++){
    const v = ex[i];
    let lo = 0, hi = n;                                        // lo -> first index with sorted >= v, hi -> first with sorted > v
    while(lo < hi){ const m = (lo + hi) >> 1; if(sorted[m] < v) lo = m + 1; else hi = m; }
    let up = lo, top = n;
    while(up < top){ const m = (up + top) >> 1; if(sorted[m] <= v) up = m + 1; else top = m; }
    out[i] = (lo + up)/(2*n);                                  // leaves below it + half of those equal to it (mid-rank: ties alike, mean exactly 1/2)
  }
  return out;
}
// TIMING: phi' = 1 - u. The most exposed leaf is phi' ~ 0 and starts at turn_start, the earliest any leaf can; the most
// buried is ~1 and starts with the last, at turn_start + spread. (0,1) like the hash, so the gate that no leaf has
// begun by turn_start survives. Light orders the turn because chlorophyll breakdown and anthocyanin synthesis are
// light-gated, and a leaf that sits in the shade of its neighbours is the last to be told. Nothing here assumes u is
// uniform: with exposure_absolute up u is the raw exposure's share, a crowded grove's piled near 0.3, and phi' simply
// piles near 0.7 (later) — the clamp only catches a raw exposure that underflowed to 0, so phi' stays under 1.
function turnOrder(u){ return Math.min(1 - u, 1 - 2**-24); }
// CAPACITY: anthocyanin is made from light, so the red a leaf can make rises with the light it gets. gain = 0.5 + u:
// half the capacity buried, one-and-a-half most exposed, linear between — the same +-50% as the hash's own spread, so
// the product still spans a physical 3:1 per factor. MEAN: at exposure_absolute 0 u averages exactly 1/2 over a grove
// (exposureRank), so the gain averages exactly 1 and the grove's mean capacity is the look's own `anthocyanin`; exposure
// moves red from the shade to the sun and does not mint any. (What is left is the sample covariance with each leaf's
// independent hash.) Above 0 the mean follows the light: 0.5 + mean exposure, ~0.8 for a crowded grove — less red overall.
function redGain(u){ return 0.5 + u; }
// ABSOLUTE LIGHT, AS A BLEND (exposure_absolute w, 0..1). The rank keeps a look's schedule and mean red by construction
// and is blind to how much light there is; raw exposure sees it (a grove in deep shade turns late and pale, one in the
// open early and deep) but repaints a look whenever its density moves. Asked to choose, José: "Both, as a blend" —
// u = mix(rank, exposure, w) into the same two maps. GATE: w <= 0 hands back the rank itself, no arithmetic: P1's u to the
// bit. w = 1 is rank*0 + exposure*1, the raw exposure exactly. Both inputs are in (0, 1], and so is any blend of them.
function exposureBlend(rank, ex, w, out = new Float64Array(rank.length)){
  if(!(w > 0)) return rank;
  const v = Math.min(w, 1), r = 1 - v;
  for(let i=0;i<rank.length;i++) out[i] = rank[i]*r + ex[i]*v;
  return out;
}

// ---- ABSCISSION (spec/model/season.md, P3a). A leaf lets go on its own day, the sunlit ones first, and a marcescent share (beech
// keeps about half its brown leaves) never does within the season. Per leaf: a drop PHASE phi_d = mix(hash_d, 1 - u,
// drop_exposure) — hash_d its own draw, u its exposure as P1/P1b leave it (the rank, or the blend with raw light; consumed,
// never recomputed) — and a drop DAY D = drop_start + drop_span . phi_d / leaf_drop for phi_d < leaf_drop, else never.
// The retention floor 1 - leaf_drop is the shaded tail of that order: exactly the tissue that is marcescent.
// hash_d is a pure function of (seed, cluster, leaf) on its OWN salt, so drawing it cannot move a twig or a leaf of any
// shipped grove, and it is independent of the pigment draw (LEAF_SALT) and the arrangement stream (hash3(seed, j, 101)).
const DROP_SALT = 0x7A3C91D5;
function dropHash(seed, j, k){ return mulberry32(hash3((seed>>>0)^DROP_SALT, j, k))(); }
function dropPhase(hashD, u, w){
  if(!(w > 0)) return hashD;                                  // drop_exposure 0: the hash itself, no arithmetic
  const v = Math.min(w, 1);
  return hashD*(1 - v) + turnOrder(u)*v;                      // the same 1 - u the turn orders by (clamped under 1, so a leaf with no light still has a day); v = 1 is turnOrder(u) exactly
}
// ONE TREE AHEAD: `dT` shifts the old drop clock with the turn's (a leaf that fell earlier lies older), both clocks by the same lead. Absent or 0 it is today's expression.
function dropDay(P, phiD, dT){ return phiD < P.leaf_drop ? (dT ? P.drop_start + dT : P.drop_start) + P.drop_span*phiD/P.leaf_drop : Infinity; }
// AFTER THE TURN (drop_after_turn 1): the day is the end of the leaf's OWN window, T0 + L, plus the fade's DROP_EPS (so s_j is 1 where the fade BEGINS, D − ε, not
// only at D) plus drop_lag (0 = it fades the instant it has turned). `phiTurn` is the leaf's turn phase (turnPhase): one order for the colour and the day, no hash
// of its own (a third clock, spec/model/season.md). leaf_drop stays the share: marcescent = the last to turn. drop_start/span/exposure are not read.
function dropDayAfterTurn(P, phiTurn, dT){
  if(!(phiTurn < P.leaf_drop)) return Infinity;
  const span = Math.max(P.turn_span, 1e-4), spread = clamp(P.turn_spread, 0, span*0.95);
  const start = dT ? P.turn_start + dT : P.turn_start;        // the tree's lead (see senescence): the same start the colour was turned by, so the day still follows the turn
  return start + phiTurn*spread + (span - spread) + DROP_EPS + P.drop_lag;
}
// spec/contracts/continuity.md's continuity rule: a leaf leaves by fading, never popping. w falls from 1 to 0 over the DROP_EPS (phenology units)
// ending at the leaf's day, so a season that moves by a hair moves the canopy by a hair. cov <- cov . w scales the leaf's
// tau and the fade its ballistic shadow rides on together. GATE: before the fade begins w is 1 with no arithmetic at all.
const DROP_EPS = 0.01;
// CALM, for a season that is played live (macros.js): no applied step of the phenology may be wider than half a fade window, or it jumps the fade of every
// leaf whose window it spans and pops it (salt-and-pepper thinning, spec/contracts/continuity.md). A full-speed drag moves ~0.006 a frame at 60 Hz, inside the clamp; a rate-gated
// catch-up after a slow regrow moves ~0.018, which is not. THE TRADE: while the clamp binds the season moves slower than the hand, at most
// TWEEN_STEP per apply, and arrives a beat late (the landing still snaps to the stop's exact dict).
const TWEEN_STEP = DROP_EPS/2;
// THE SEASON'S PREDICATES, in one place: the grove reads them to decide what to compute, and the feature registry (komorebi-params.js FEATURES)
// reads them to decide what a bundle may leave out. They are the same four questions asked of the same params, so they cannot be asked twice.
// `ordered` is the exposure pass's gate: the drop consumes the exposure rank (the sunlit leaves go first) even at turn_exposure 0, so a look that drops
// its leaves by light needs the pass whether or not it lets light order the turn.
// ONE TREE AHEAD: the gates open by the knob's REACH. The earliest a leaf can begin is turn_start − tree_clock_spread (a tree's lead is S·v³ with v < 1, so none reaches it) and the earliest it can
// fade is drop_start − S; opening that far ahead is free for a tree that has not got there (every s is 0, `retention` returns 1) and a late open would skip a leaf. At 0 these are turn_start and
// drop_start themselves, the literal old predicates. THE GATE, restated: every leaf at phenology <= turn_start − tree_clock_spread keeps its authored tau literally. At <= 0.1 every shipped summer (0.5)
// is untouched; at 0.15 a tree with v³ > 2/3 reaches into it (canopy 2's trees 5, 11, 12) — physical, and said in the spec and the help.
const turnOpens = (P) => P.tree_clock_spread > 0 ? P.turn_start - P.tree_clock_spread : P.turn_start;
const dropOpens = (P) => P.tree_clock_spread > 0 ? P.drop_start - P.tree_clock_spread : P.drop_start;
const senescing = (P) => P.phenology > turnOpens(P);
// ---- THE SPRING HALF (spec model/season.md, "Leaf-out"). Below the turn the season opens with leaf-out: each leaf emerges on its own day and grows to its
// full size over leaf_out_span (one leaf's midrib, a 21-day smoothstep in Gregory 1980's sugar maple, area as its square), the leaves' days scattered over
// leaf_out_spread (12 days, first bud break to full leaf-out, at the same site), so the last is full-grown at leaf_out_end. A new leaf is the summer leaf at a
// share of its optical depth, young_depth (chlorophyll a quarter of summer's, Yang et al. 2016, read through PROSPECT), greening to it over leaf_green_span, and
// optionally flushed red (young_red, anthocyanin units; juvenile Norway maple ≈ 0.4, Merzlyak et al. 2008). The calendar is inferred: about 230 days a
// phenology unit (Provisional). A leaf's emergence draws from a stream of its own, SPRING_SALT = 7·0x9E3779B9 mod 2^32, the golden gamma's next multiple
// after the shoots' 6·: no other leaf stream moves. The spring closes before the turn can open, so a leaf is in spring or in fall, never both.
const SPRING_SALT = 0x5384540F;
function springDraws(seed, j, k, out, o = 0){   // [emergence order ψ, red share h]
  const r = mulberry32(hash3((seed>>>0)^SPRING_SALT, j, k));
  out[o] = r(); out[o+1] = r();
  return out;
}
// The spring's span and the leaf_out_end it can have: held so the last leaf is full-grown and green before the turn's earliest start.
function springShape(P, out){
  const span = Math.max(P.leaf_out_span, 1e-4), green = Math.max(P.leaf_green_span, 1e-4), spread = clamp(P.leaf_out_spread, 0, span*0.95);
  const tail = Math.max(0, green - span);
  out[0] = Math.min(P.leaf_out_end, turnOpens(P) - tail); out[1] = span; out[2] = spread; out[3] = green; out[4] = out[0] + tail;   // end, span, spread, green, closes
  return out;
}
const _springShape = new Float64Array(5);
const springing = (P) => P.leaf_out_end > 0 && P.phenology < springShape(P, _springShape)[4];
// A leaf's state now: out[0] its length's share of the full leaf (its half-axes scale by it), out[1] how far it has greened. Both 1 once grown: the summer leaf.
function leafSpring(P, psi, out){
  const sh = springShape(P, _springShape), E = sh[0] - sh[1] - (1 - psi)*sh[2];
  out[0] = smoothstep(E, E + sh[1], P.phenology); out[1] = smoothstep(E, E + sh[3], P.phenology);
  return out;
}
// The young leaf's depth: the summer depth at g = young_depth + (1 − young_depth)·q, plus the red that fades as it greens. q = 1 returns the summer leaf's own numbers.
function springTau(tauSummer, P, q, h, out = [0,0,0]){
  if(q === 1){ out[0]=tauSummer[0]; out[1]=tauSummer[1]; out[2]=tauSummer[2]; return out; }
  const yd = clamp(P.young_depth, 0, 1), g = yd + (1 - yd)*q, red = (1 - q)*Math.max(0, P.young_red)*(0.5 + h);
  for(let c=0;c<3;c++) out[c] = g*tauSummer[c] + red*TAU_ANTHOCYANIN[c];
  return out;
}

const lit = (P) => senescing(P) && P.turn_exposure > 0;
// After the turn the first fade begins at turn_start + L + drop_lag (the earliest leaf, phi' 0, D − ε), and `dropping` opens ONE ε before it on purpose: (x + ε) − ε is not x
// in float, an early open is free (retention returns exactly 1), and a late one would skip a fade. It may never be later than the first fade.
// The drop follows the turn there, not the light, so drop_exposure no longer asks for the pass (a lit turn still does).
const dropping = (P) => P.leaf_drop > 0 && P.phenology > (afterTurn(P) ? turnOpens(P) + turnLength(P) + P.drop_lag - DROP_EPS : dropOpens(P) - DROP_EPS);
const ordered = (P) => lit(P) || (dropping(P) && !afterTurn(P) && P.drop_exposure > 0);
function retention(D, p){ return p > D - DROP_EPS ? 1 - smoothstep(D - DROP_EPS, D, p) : 1; }

// ---- ONE TREE AHEAD OF ITS NEIGHBOURS (spec/model/season.md, `tree_clock_spread`, `tree_pigment_spread`). Within one kind the INDIVIDUAL shifts the clock by days to two weeks (a stressed tree runs early, a long tail) and its
// red depth about two to one between neighbours; within a crown it is the light (above). So each tree t (the twig's `tree`) draws two numbers, on a salt of its own and never the growth, arrangement or
// leaf streams — the lead first, then the depth — and the grove asks two tables, null at the gate. TREE_SALT = 2·0x9E3779B9 mod 2^32: the next multiple of the golden gamma, in no other stream.
//   the lead   Δ_t = −S·v³ <= 0 (S = tree_clock_spread): SKEWED — most trees near the look's schedule, a few early. Mean S/4, median S/8, sd 0.283·S, one in five (1 − 2^(−1/3) = 0.206) beyond S/2. S is the REACH,
//              as turn_spread is the last leaf's. It shifts the tree's clocks, not the season (`D` stays global, so a leaf that fell earlier lies older): start, finish and both drop days together.
//              A cube because the square is a spread, not a skew, and the fourth power leaves five trees too thin a tail to ever show one.
//   the depth  c_t = 1 + s·(2w − 1), s = tree_pigment_spread: in [1 − s, 1 + s), mean 1 in EXPECTATION and not by construction (a tree keeps its draw as the grove grows, so a tree_count morph is an identity); s = 1 lets
//              a tree go without red. It scales the leaf's anthocyanin AND tannin together (leafTau).
// A tree's two numbers are a pure function of (seed, t): the same at any tree_count, the marginal tree's included. Light still ranks grove-wide: the rank's key stays the leaf's own clock, so the cached rank
// survives the knobs (which is what lets them be season keys) and the lead is added after it.
const TREE_SALT = 0x3C6EF372;
function treeDraws(seed, t, out = [0,0]){
  const r = mulberry32(hash3((seed>>>0)^TREE_SALT, t, 0));
  out[0] = r(); out[1] = r();
  return out;
}
// THE TREE'S LEAF GENOTYPE (`leaf_variety`, spec/model/leaf.md): the same stream's THIRD draw, floor(r()·G) — an individual holds its clock, its red depth and its leaf form in one place. The first two stay treeDraws' (the lead, the depth), so
// tree_clock_spread and tree_pigment_spread keep their bits, and the growth stream is never touched. Pure per (seed, t): the same at any tree_count, the marginal tree's included; two trees may share one (siblings). Nothing here is
// gated: the grove asks only while leaf_variety is up.
function treeGenotype(seed, t, G){
  const r = mulberry32(hash3((seed>>>0)^TREE_SALT, t, 0));
  r(); r();
  return Math.floor(r()*G);
}
const treeShift = (v, S) => -S*(v*v*v);
const treeGain = (w, s) => 1 + s*(2*w - 1);
// THE GATE is the table: no knob, no draw and nothing handed on (null), so the grove's off path is the literal old arithmetic.
function treeShifts(P, nTree){
  if(!(P.tree_clock_spread > 0)) return null;
  const out = new Float64Array(nTree), d = [0,0];
  for(let t=0;t<nTree;t++) out[t] = treeShift(treeDraws(P.seed, t, d)[0], P.tree_clock_spread);
  return out;
}
function treeGains(P, nTree){
  if(!(P.tree_pigment_spread > 0)) return null;
  const out = new Float64Array(nTree), d = [0,0];
  for(let t=0;t<nTree;t++) out[t] = treeGain(treeDraws(P.seed, t, d)[1], P.tree_pigment_spread);
  return out;
}

export { TAU_CAROTENOID, TAU_ANTHOCYANIN, TAU_TANNIN, senescence, turnWindow, leafClock, turnPhase, afterTurn, leafTau, LEAF_SCHED, leafDraws, leafPigments, leafTauAt, TREE_SALT, treeDraws, treeGenotype, treeShift, treeGain, treeShifts, treeGains, SEASON_SUN, EXPOSURE_K, exposureGrid, exposureRank, exposureBlend, groundShade, turnOrder, redGain, DROP_EPS, TWEEN_STEP, senescing, lit, dropping, ordered, SPRING_SALT, springDraws, springShape, springing, leafSpring, springTau, dropHash, dropPhase, dropDay, dropDayAfterTurn, retention };
