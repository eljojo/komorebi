// ============================================================================
// CPU math & physics substrate — pure functions, no GL, no engine state.
// Constants and interpolation helpers, the 3-band atmosphere (spec §3.5), the
// deterministic RNG that keeps the canopy frame-stable, the broadband wind
// signal (spec §5.1), and the skeleton-growth grammar and its vector helpers (spec §4.5).
// ============================================================================
const DEG = Math.PI / 180, TAU = Math.PI*2;
const GOLDEN = Math.PI*(3 - Math.sqrt(5));   // the golden angle (rad), the step of every spiral in the growth: trees about the grove, limbs up the trunk, children about a node (§4.5)
// Area shared by two circles, radii r1/r2, centres d apart — the eclipse's moon against the source's core disk and
// against its whole extent. Used only to renormalize the SEEN source's radiance (§4.9); the cast's own crescent comes
// from zeroing sample weights, which is a discrete estimate of this same area.
function lensArea(r1, r2, d){
  if(r2 <= 0 || r1 <= 0) return 0;
  if(d >= r1 + r2) return 0;                                  // disjoint
  if(d <= Math.abs(r1 - r2)) return Math.PI*Math.min(r1, r2)*Math.min(r1, r2);   // one contains the other
  const a1 = Math.acos(clamp((d*d + r1*r1 - r2*r2)/(2*d*r1), -1, 1));
  const a2 = Math.acos(clamp((d*d + r2*r2 - r1*r1)/(2*d*r2), -1, 1));
  return r1*r1*(a1 - Math.sin(2*a1)/2) + r2*r2*(a2 - Math.sin(2*a2)/2);
}
const FAITH_MAX_RATIO = 1.7;   // faithful-tree height cap (spec §4.5): max crown height:radius before crown_aspect. A broad tree (mr above mz/RATIO) keeps its natural height untouched; a NARROW tree (steep branches → tiny mr → runaway plan-fill scale → tens of metres tall) gets its height clamped to crown·RATIO·aspect. Lower = shorter narrow trees.
const clamp = (x,a,b) => Math.min(b, Math.max(a, x));
const lerp = (a,b,t) => a + (b-a)*t;
const smoothstep = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
// shortest-arc interpolation for a periodic value (degrees->360, radians->TAU): 350°->10° goes +20°.
const lerpAngle = (a,b,t,period) => { const d=((b-a)%period + period*1.5)%period - period*0.5; return a + d*t; };

// ---- atmospheric colour: physical sun-disk + sky tint from solar elevation (spec §3.5). A cheap
// 3-band (R=620, G=555, B=470 nm) Beer's-law model. As the sun lowers, air mass grows and Rayleigh
// (∝ λ⁻⁴) reddens the direct beam; the ozone Chappuis band absorbs red, so the SCATTERED sky stays
// blue (the "blue hour"). Returns LINEAR RGB — the renderer's exposure/ACES/gamma stay downstream. --
const TAU_RAY = [0.0597, 0.0938, 0.1851];   // Rayleigh vertical optical depth per band (sea level)
const TAU_OZ  = [0.0403, 0.0258, 0.0040];   // ozone Chappuis (300 DU) — absorbs red, not blue
const TAU_AER = [1.861, 2.151, 2.670];      // aerosol per unit turbidity β (Ångström λ^-1.3)
function airMass(hDeg){                       // Kasten-Young 1989 — finite at the horizon (1/sin diverges)
  const h = Math.max(hDeg, 0);
  return 1/(Math.sin(h*DEG) + 0.50572*Math.pow(h+6.07995, -1.6364));
}
const _atmT=[0,0,0], _atmSky=[0,0,0];   // module scratch for the 3-band intermediates (written + read within one synchronous call)
// Fills the caller's `out` ({sun:[3], ambient:[3]}) in place rather than allocating, so a static frame makes no garbage.
function atmosphere(out, hDeg, beta, ambientSky){
  const m = airMass(hDeg);
  let tmax=1e-9, smax=1e-9;
  for(let i=0;i<3;i++){
    const ext = TAU_OZ[i] + beta*TAU_AER[i];
    _atmT[i]   = Math.exp(-m*(TAU_RAY[i] + ext));   // direct-beam transmittance -> sun disk
    _atmSky[i] = TAU_RAY[i]*Math.exp(-m*ext);       // Rayleigh single-scatter through ozone/aerosol -> sky
    tmax=Math.max(tmax,_atmT[i]); smax=Math.max(smax,_atmSky[i]);
  }
  const su=out.sun, am=out.ambient;
  su[0]=_atmT[0]/tmax; su[1]=_atmT[1]/tmax; su[2]=_atmT[2]/tmax;   // normalize to HUE; exposure carries brightness
  const kA = 0.08*ambientSky, dusk = smoothstep(15,0,hDeg)*0.5;    // belt-of-Venus: warm beam bleeds into the sky near sunset
  am[0]=(_atmSky[0]/smax + dusk*su[0])*kA;
  am[1]=(_atmSky[1]/smax + dusk*su[1])*kA;
  am[2]=(_atmSky[2]/smax + dusk*su[2])*kA;
  return out;
}

// The sun's UNIT direction (cos el·cos az, cos el·sin az, sin el), written into `out`. Deliberately unclamped in
// elevation (§4.9): incidence on a vertical cloth peaks as the sun lowers, where the 1/sin(el) throws diverge. ONE
// helper because two readers need the same vector — transport's uSunDir upload and the sky fill's sun path (§4.7).
function sunDirection(out, elevDeg, azDeg){
  const el=elevDeg*DEG, az=azDeg*DEG;
  out[0]=Math.cos(el)*Math.cos(az); out[1]=Math.cos(el)*Math.sin(az); out[2]=Math.sin(el);
  return out;
}

// ---- deterministic RNG so canopy is frame-stable & reproducible ------------
function mulberry32(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function makeGauss(rng){ return ()=>{ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }; }
function hash3(a,b,c){ let h=(a^0x9E3779B1)>>>0;
  h=Math.imul(h^b,0x85EBCA6B)>>>0; h=Math.imul(h^c,0xC2B2AE35)>>>0;
  return (h^(h>>>15))>>>0; }

// ---- autumn senescence (spec §4.5): a leaf's pigment state, per leaf. Chlorophyll is dismantled and the carotenoid
// that was always there shows; anthocyanin is synthesised (red); tannin browns. Optical depth is ADDITIVE, so each
// pigment is a basis vector of per-channel tau (R,G,B), and a leaf is its summer tau faded out plus these faded in.
// PROVISIONAL until backlit measurements (tau = -ln(leaf / diffuser), one leaf per pigment state) replace them;
// what is held honest meanwhile is their ORDERING (leaf.test.js), and the shape of the story they tell:
const TAU_CAROTENOID  = [0.30, 0.55, 2.8];   // absorbs blue, passes red+green -> gold (T .74/.58/.06). Always present, hidden by chlorophyll until it goes
const TAU_ANTHOCYANIN = [0.10, 2.8, 1.0];    // absorbs green, a little blue: on top of the gold it turns orange -> red -> maroon as a rises (T_g .33 / .06 / .02 at a = .2 / .8 / 1.2)
const TAU_TANNIN      = [0.8, 1.2, 1.9];     // broad, warm-leaning (b > g > r): the russet of beech and oak (T .33/.17/.01 at b = 1, over the gold)
// A leaf's identity is its OWN stream, seeded from (seed, cluster, leaf) and never the growth RNG, so drawing from it
// cannot move one twig or one leaf of any shipped grove. The salt keeps it independent of the arrangement stream
// (hash3(seed, j, 101), made from the same ingredients).
const LEAF_SALT = 0x51ED270B;
const _leafCell=[0,0,0], _leafWall=[0,0,0];   // scratch for leafTau, written and read within one synchronous call
// s_j: how far leaf (stream value phi in [0,1)) has turned. smoothstep from its own start to the common finish; the
// spread is clamped under the span so the transition keeps a floor of width and the smoothstep a positive one.
// DROP AFTER THE TURN (`drop_after_turn`, spec §4.5 Abscission): the common finish above leaves a leaf no turn of its own to wait for (every leaf ends at
// turn_start + turn_span), so a drop bound to the turn would have no order. At 1 each leaf's window is its own LENGTH L = span − spread from its own start, and
// the last leaf (phi -> 1) still ends at turn_start + span. The start is the same expression, so s = 0 below turn_start and every summer byte survive. THE TRADE:
// the mid-turn crown turns sooner at 1 (a turn change inside a drop knob; from turn_start + turn_span on the colour is identical). At 0 the branch is not
// taken and the expression below is today's, literally.
const afterTurn = (P) => P.drop_after_turn > 0;
function turnLength(P){
  const span = Math.max(P.turn_span, 1e-4);
  return span - clamp(P.turn_spread, 0, span*0.95);
}
function senescence(P, phi){
  const span = Math.max(P.turn_span, 1e-4), spread = clamp(P.turn_spread, 0, span*0.95);
  if(afterTurn(P)){ const T0 = P.turn_start + phi*spread; return smoothstep(T0, T0 + (span - spread), P.phenology); }
  return smoothstep(P.turn_start + phi*spread, P.turn_start + span, P.phenology);
}
// The sieve effect (Beer's law is convex): a leaf is bright vein walls (tau_wall) beside dark cells (tau_cell), and
// light through the whole leaf is the MEAN OF TRANSMITTANCES, not of tau — so a small clear fraction lifts a deep
// leaf far more than the mean tau suggests, and tau_j <= f_w*tau_wall + (1-f_w)*tau_cell (Jensen). f_w = 0 is the
// cell, bit for bit, via its own branch (no exp/log round trip) — that is what keeps the off state exact.
function mixtureTau(tauWall, tauCell, fw, out = [0,0,0]){
  if(!(fw > 0)){ out[0]=tauCell[0]; out[1]=tauCell[1]; out[2]=tauCell[2]; return out; }
  const f = Math.min(fw, 1);
  for(let c=0;c<3;c++) out[c] = -Math.log(f*Math.exp(-tauWall[c]) + (1-f)*Math.exp(-tauCell[c]));
  return out;
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
function leafTau(tauSummer, P, seed, j, k, out = [0,0,0], phiE, gainE){
  const r = mulberry32(hash3((seed>>>0)^LEAF_SALT, j, k));
  const w = phiE === undefined ? 0 : P.turn_exposure;
  const phi = turnPhase(P, r(), phiE);                        // mix(phi, f(1 - exposure), w); r() first, so the draws keep their order
  const s = senescence(P, phi);
  if(s === 0){ out[0]=tauSummer[0]; out[1]=tauSummer[1]; out[2]=tauSummer[2]; return out; }
  let a = P.anthocyanin*(0.5 + r());
  const b = P.tannin*(0.5 + r());
  if(w > 0) a *= 1 + (gainE - 1)*w;                           // a * mix(1, g(exposure), w)
  const cell = _leafCell, wall = _leafWall;
  for(let c=0;c<3;c++){
    const base = tauSummer[c]*(1-s), pig = TAU_CAROTENOID[c] + b*TAU_TANNIN[c];
    wall[c] = base + s*pig;
    cell[c] = base + s*(pig + a*TAU_ANTHOCYANIN[c]);
  }
  return mixtureTau(wall, cell, P.wall_fraction, out);
}

// ---- LIGHT DECIDES WHO TURNS FIRST (spec §4.5, P1). Anthocyanin is made in light, so the leaves that see the sun —
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
// SMALLER key — the one that would have turned first on its own — takes the higher rank, so the group spreads over its own slice of the order
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

// ---- ABSCISSION (spec §4.5, P3a). A leaf lets go on its own day, the sunlit ones first, and a marcescent share (beech
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
function dropDay(P, phiD){ return phiD < P.leaf_drop ? P.drop_start + P.drop_span*phiD/P.leaf_drop : Infinity; }
// AFTER THE TURN (drop_after_turn 1): the day is the end of the leaf's OWN window, T0 + L, plus the fade's DROP_EPS (so s_j is 1 where the fade BEGINS, D − ε, not
// only at D) plus drop_lag (0 = it fades the instant it has turned). `phiTurn` is the leaf's turn phase (turnPhase): one order for the colour and the day, no hash
// of its own (a third clock, §4.5). leaf_drop stays the share: marcescent = the last to turn. drop_start/span/exposure are not read.
function dropDayAfterTurn(P, phiTurn){
  if(!(phiTurn < P.leaf_drop)) return Infinity;
  const span = Math.max(P.turn_span, 1e-4), spread = clamp(P.turn_spread, 0, span*0.95);
  return P.turn_start + phiTurn*spread + (span - spread) + DROP_EPS + P.drop_lag;
}
// §5.3's continuity rule: a leaf leaves by fading, never popping. w falls from 1 to 0 over the DROP_EPS (phenology units)
// ending at the leaf's day, so a season that moves by a hair moves the canopy by a hair. cov <- cov . w scales the leaf's
// tau and the fade its ballistic shadow rides on together. GATE: before the fade begins w is 1 with no arithmetic at all.
const DROP_EPS = 0.01;
// CALM, for a season that is played live (macros.js): no applied step of the phenology may be wider than half a fade window, or it jumps the fade of every
// leaf whose window it spans and pops it (salt-and-pepper thinning, §5.3). A full-speed drag moves ~0.006 a frame at 60 Hz, inside the clamp; a rate-gated
// catch-up after a slow regrow moves ~0.018, which is not. THE TRADE: while the clamp binds the season moves slower than the hand, at most
// TWEEN_STEP per apply, and arrives a beat late (the landing still snaps to the stop's exact dict).
const TWEEN_STEP = DROP_EPS/2;
// THE SEASON'S PREDICATES, in one place: the grove reads them to decide what to compute, and the feature registry (komorebi-params.js FEATURES)
// reads them to decide what a bundle may leave out. They are the same four questions asked of the same params, so they cannot be asked twice.
// `ordered` is the exposure pass's gate: the drop consumes the exposure rank (the sunlit leaves go first) even at turn_exposure 0, so a look that drops
// its leaves by light needs the pass whether or not it lets light order the turn.
const senescing = (P) => P.phenology > P.turn_start;
const lit = (P) => senescing(P) && P.turn_exposure > 0;
// After the turn the first fade begins at turn_start + L + drop_lag (the earliest leaf, phi' 0, D − ε), and `dropping` opens ONE ε before it on purpose: (x + ε) − ε is not x
// in float, an early open is free (retention returns exactly 1), and a late one would skip a fade. It may never be later than the first fade.
// The drop follows the turn there, not the light, so drop_exposure no longer asks for the pass (a lit turn still does).
const dropping = (P) => P.leaf_drop > 0 && P.phenology > (afterTurn(P) ? P.turn_start + turnLength(P) + P.drop_lag - DROP_EPS : P.drop_start - DROP_EPS);
const ordered = (P) => lit(P) || (dropping(P) && !afterTurn(P) && P.drop_exposure > 0);
function retention(D, p){ return p > D - DROP_EPS ? 1 - smoothstep(D - DROP_EPS, D, p) : 1; }

// A LEAF IS NOT A WINDOW (§4.5). What a leaf passes is T = T_b + T_d: the ballistic share keeps travelling as a beam, the
// diffuse share (d = leaf_diffuse) is scattered by the mesophyll and leaves in every direction. The beam sees (1−d)·T, which
// is NEUTRAL depth on top of the leaf's own: k = −ln(1−d) per leaf (a texel is a mixture of one, §4.5, texelMix), the same in every channel because the split is
// set by the leaf's scattering structure and not by its pigments (so the beam keeps the leaf's hue and the diffuse share
// is simply t − tb). d → 1 is −ln 0, so k is capped where the beam is already dark (e^−6 = 0.25 %). d = 0 is exactly 0 —
// the gate, no log round trip — and so is anything that is not a positive number.
const BEAM_K_MAX = 6;
function ballisticK(d){ return d > 0 ? Math.min(-Math.log1p(-Math.min(d, 1)), BEAM_K_MAX) : 0; }

// ---- broadband wind signal (spec §5.1). Real wind is BROADBAND, not a single frequency — a single sine
// reads as a machine because all its energy sits at one period. A frame-stable fractal sum of octaves over
// TIME with per-octave amplitude gain G=2^(-H) gives a power spectrum ∝ f^-(2H+1): the Kolmogorov inertial
// subrange is -5/3, i.e. H=1/3 → G≈0.794 (the number that makes a noise sum *feel* like wind — between
// "pink" H=0 choppy and "brown" H=0.5 sluggish). Pure function of t → no per-frame RNG (all engine motion
// is deterministic-of-time & reproducible, spec §4.4). H is the per-pattern "character" knob below. -------
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
// ---- wind PATTERNS (spec §5.1): a few broadband CHARACTERS, all reading the SAME shared knobs (strength,
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

// ---- skeleton growth (spec §4.5): grow real 3D branch segments from a seed ----
function normalize3(v){ const m=Math.hypot(v[0],v[1],v[2])||1e-9; return [v[0]/m, v[1]/m, v[2]/m]; }
// a child direction deviating from unit parent dir `d` by `spread` radians, at azimuth `az`
// around d (in the plane perpendicular to it). Builds an orthonormal basis around d.
function coneDir(d, az, spread){
  const up = Math.abs(d[2])>0.9 ? [1,0,0] : [0,0,1];
  const s = normalize3([ d[1]*up[2]-d[2]*up[1], d[2]*up[0]-d[0]*up[2], d[0]*up[1]-d[1]*up[0] ]); // ⟂ d
  const u = [ d[1]*s[2]-d[2]*s[1], d[2]*s[0]-d[0]*s[2], d[0]*s[1]-d[1]*s[0] ];                   // ⟂ d,s
  const cs=Math.cos(spread), sn=Math.sin(spread), ca=Math.cos(az), sa=Math.sin(az);
  return normalize3([ cs*d[0]+sn*(ca*s[0]+sa*u[0]),
                      cs*d[1]+sn*(ca*s[1]+sa*u[1]),
                      cs*d[2]+sn*(ca*s[2]+sa*u[2]) ]);
}
// tilt a unit direction toward straight-down (−z) by `dth` rad, IN ITS OWN VERTICAL PLANE (azimuth fixed) — the
// gravitropic droop of a branch (spec §4.5). dth<0 lifts it (upsweep). Guards a ~vertical heading (no plane to droop in).
function bendDown(dir, dth){
  const horiz = Math.hypot(dir[0], dir[1]);
  if(horiz < 1e-4) return dir;
  const a = clamp(Math.atan2(dir[2], horiz) - dth, -Math.PI*0.5, Math.PI*0.5);
  const ca = Math.cos(a);
  return [ ca*dir[0]/horiz, ca*dir[1]/horiz, Math.sin(a) ];
}
// coneDir restricted to the plane z = 0, for an in-plane unit `d`: the cone's offset along the in-plane perpendicular
// (sin·cos az) is kept and the part along z (sin·sin az) is dropped, so az 0 and π fork to opposite sides and az π/2 holds
// the heading. Same side as coneDir's own s axis; always unit, so the zero-length projection coneDir would need a guard
// for (spread π/2 at az π/2) is simply no turn.
function coneDirPlane(d, az, spread){
  const m = Math.hypot(d[0], d[1]) || 1e-9, hx = d[0]/m, hy = d[1]/m;
  const dl = Math.atan2(Math.sin(spread)*Math.cos(az), Math.cos(spread));
  const c = Math.cos(dl), s = Math.sin(dl);
  return [ c*hx + s*hy, c*hy - s*hx, 0 ];
}

// ---- THE GRAMMAR (spec §4.5): a skeleton grown from a spec, a stream and an `out` — trunk, limb, branch, twig by one
// recursive rule — a function and not a closure, so a leaf's veins can grow by the same rules the tree's boughs do.
// The caller owns `out` ({ seg:[], tw:[] }) and may grow many roots into one: a twig's index is the count in `out.tw` before
// it, which the segments of its own wood carry (`tw`, -1 for wood that bears nothing) so the faithful bake swings them about
// the twig's joint (§5.4). Pure: nothing is read but the arguments, nothing written but `out`. THE STREAM IS THE CONTRACT —
// three draws per child, in the order azimuth, spread, length; reorder one and every grove there is regrows differently.
// spec: levels (depth; level >= levels bears a twig), kids (children per node; `opposite` is always 2), lenRatio, coneA
// (the child cone's half-angle), droop (signed gravitropic curve, §4.5), phyllo (0 spiral / 1 whorled / 2 opposite),
// leader (monopodial: the spiral steps by the golden angle), and the root: base, dir (unit), len, level, limb.
// plane: the leaf's 2-D use — every z is 0, no droop, children turn by coneDirPlane. The draws are the same, so a plane
// run is the same topology as the 3-D one.
function growSkeleton(spec, rng, out){
  const { base, dir, len, level, limb, plane } = spec;
  if(!plane){ growNode(spec, rng, out, base, dir, len, level, limb); return; }
  const m = Math.hypot(dir[0], dir[1]) || 1e-9;
  growNode(spec, rng, out, [base[0], base[1], 0], [dir[0]/m, dir[1]/m, 0], len, level, limb);
}
function growNode(g, rng, out, base, dir, len, level, limb){
  const { levels, plane } = g;
  // index the twig this call will bear, if it is a terminal one — the segments pushed below are that twig's
  // OWN wood, and the faithful bake must swing them about the same joint, by the same angle, as its leaves (§5.4).
  const twIdx = (level >= levels) ? out.tw.length : -1;
  // droop/upsweep (spec §4.5): curve the branch toward gravity over a few SUB-SEGMENTS — a smooth arc, not a
  // straight ray and not a single kink. Stronger on outer orders (level/levels), and children inherit the
  // curved END-TANGENT, so the sag compounds toward the tips (the willow cascade / birch trail). 0 = straight.
  const dLevel = plane ? 0 : g.droop * (level/levels);
  let tip, endDir = dir;
  if(Math.abs(dLevel) > 1e-3){
    const nSub = Math.min(6, 1 + Math.round(Math.abs(dLevel)*5));
    const dl = len/nSub, dth = dLevel*1.9/nSub;        // total curve ≈ dLevel·1.9 rad over the branch length
    let p = base, d = dir;
    for(let sx=0;sx<nSub;sx++){
      d = bendDown(d, dth);                            // tilt the heading toward −z (down) in its own vertical plane
      const np = [ p[0]+d[0]*dl, p[1]+d[1]*dl, p[2]+d[2]*dl ];
      // f0/f1 = this sub-segment's fractional span of the ONE level→level+1 taper step, so the faithful skeleton
      // thins SMOOTHLY along a drooping branch instead of resetting the full step per sub-segment (a sawtooth).
      out.seg.push({ a:p, b:np, level, limb, f0:sx/nSub, f1:(sx+1)/nSub, tw:twIdx });
      p = np;
    }
    tip = p; endDir = d;
  } else {
    tip = [ base[0]+dir[0]*len, base[1]+dir[1]*len, base[2]+dir[2]*len ];
    out.seg.push({ a:base, b:tip, level, limb, f0:0, f1:1, tw:twIdx });   // straight branch: full step (byte-identical)
  }
  // bx,by = the twig's REAL base: where this terminal branch attaches to its parent. It is the joint the whole
  // twig (wood + the leaves on it) turns about under the medium band, and — being offset from the clump toward
  // the parent by GROWTH — it is a genuine stem joint, so §5.1's anti-vortex property holds without uStemLen.
  if(level >= levels){ out.tw.push({ x:tip[0], y:tip[1], z:tip[2], limb, dx:endDir[0], dy:endDir[1], bx:base[0], by:base[1] }); return; }   // dx,dy = twig heading (plan) so leaves can hug the twig, not scatter as a blob
  // phyllotaxis (§4.5): how children fan around the parent. opposite forces PAIRED forks; whorled an even ring; spiral the golden angle.
  const { phyllo, coneA, lenRatio, leader } = g;
  const nKids = (phyllo===2) ? 2 : g.kids;
  for(let c=0;c<nKids;c++){
    let az, spread;
    if(phyllo===2){       az = level*1.5707963 + c*Math.PI + (rng()-0.5)*0.08;  spread = coneA*(0.9+0.12*rng()); }   // opposite/decussate: a symmetric Y, plane flipped 90° each level
    else if(phyllo===1){  az = (c+0.5)/nKids*TAU + (rng()-0.5)*0.15;           spread = coneA*(0.7+0.5*rng()); }   // whorled: even ring (conifer tiers)
    else {                az = (leader ? c*GOLDEN : (c+0.5)/nKids*TAU) + (rng()-0.5)*(leader?0.4:1.2); spread = coneA*(0.55+0.9*rng()); }   // spiral / legacy fan
    growNode(g, rng, out, tip, (plane ? coneDirPlane : coneDir)(endDir, az, spread), len*lenRatio*(0.8+0.4*rng()), level+1, limb);
  }
}


// THE EDGE (§4.7), as the shader computes it (GLSL_T_POST): a superellipse mask on the frame, 1 inside radius
// (1 − feather), 0 at the frame's edge and in the corners beyond the curve. u, v in 0..1. The reference the
// vignette test holds the shader's formula to; feather 0 is the gate shut.
function vignetteMask(u, v, feather, shape) {
  if (!(feather > 0)) return 1;
  const qx = Math.abs(u * 2 - 1), qy = Math.abs(v * 2 - 1);
  const d = Math.pow(Math.pow(qx, shape) + Math.pow(qy, shape), 1 / shape);
  return 1 - smoothstep(1 - feather, 1, d);
}

export { DEG, TAU, vignetteMask, lensArea, FAITH_MAX_RATIO, clamp, lerp, smoothstep, lerpAngle, atmosphere, sunDirection, mulberry32, makeGauss, hash3, TAU_CAROTENOID, TAU_ANTHOCYANIN, TAU_TANNIN, senescence, mixtureTau, leafClock, turnPhase, afterTurn, leafTau, SEASON_SUN, EXPOSURE_K, exposureGrid, exposureRank, exposureBlend, groundShade, turnOrder, redGain, DROP_EPS, TWEEN_STEP, senescing, lit, dropping, ordered, dropHash, dropPhase, dropDay, dropDayAfterTurn, retention, BEAM_K_MAX, ballisticK, fbm1, WIND_PATTERNS, windNoise, coneDir, coneDirPlane, bendDown, GOLDEN, growSkeleton };
