// ============================================================================
// The held leaf's physics (spec §4.5, "The held leaf"): ONE grown leaf, rasterised with the areole maze at full resolution — walls beside cells — so the
// sieve effect can be seen where the engine only carries its mean (`wall_fraction`, Decision 10: the vibe at no performance cost). A pure editor sibling
// like macros.js and profiler.js: leaf-preview.js draws it, editor.js owns the key, and NO engine module imports it, so nothing here can reach a bundle.
//
// THE MAZE IS SUCCESSIVE DOMAIN DIVISION (Bohn, Andreotti & Douady), not Voronoi: a leaf's higher veins do not grow at random sites but in the domains the
// older veins left, each ending where it meets an older wall — a T-junction, never the 120° Y a Voronoi diagram makes — and a hierarchy of widths falls out
// of the order the cuts were made in. SEEDED BY THE GROWN VEINS: order 1 are the five primaries, which cut the margin polygon into radial sectors; order 2
// are the skeleton's secondaries, each running along its direction until it hits the wall of the region it is in; from order 3 on, a region bigger than an
// areole is cut by a chord across its long axis, until every cell is about 1 mm.
//
// THE WALLS CARRY EXACTLY `wall_fraction`: each wall has a half-width in proportion to its order, solved so the walls' area is f_w of the lamina and then
// measured on the raster and corrected once. So the picture's mean transmittance is the mixture the engine computes, and the sieve reads literally.
// ============================================================================
import { DEG, TAU, hash3, leafTau, mulberry32 } from './komorebi-math.js';
import { LEAF_SAMPLES, bladeOf, leafVariant, outlineSeed } from './komorebi-leaf.js';

const AREOLE_M = 0.001;          // a maple's areole is ~1 mm across. It moves into the species spec the day the engine reads it
const AREOLE_SALT = 0x3D1A8C57;  // the maze's own stream: distinct from every salt the leaf's other streams use (maze.test.js lists them)
const EPS = 1e-7;                // a start on a wall is begun this far along its direction, so it is an interior point of the region it enters
const SQUARE_AT = 0.7;   // the two sides a chord lands on count as near-parallel within ~45°
const JITTER_AT = 0.15, JITTER_DEG = 8, REDRAWS = 8;   // a chord's point sits within ±15 % of the half-length from the centroid, its angle ±8° off the cross axis

// The wall width multipliers by order: PROVISIONAL (a look at the crop will set them). The broader tertiaries that bound rows of cells are in
// the photograph, so order 3 is twice an areole wall and the widths settle to 1 by order 5.
const widthOf = (o) => (o === 1 ? 4 : o === 2 ? 3 : 1 + 0.5*Math.max(0, 5 - o));

// ---- polygons ---------------------------------------------------------------------------------------------------------------
// zero-length edges out: the margin has the petiole's coincident samples, and a split that lands on a vertex leaves a doubled point
function dedupe(p){
  const q = [];
  for(const pt of p) if(!q.length || Math.hypot(pt[0] - q[q.length - 1][0], pt[1] - q[q.length - 1][1]) > 1e-12) q.push(pt);
  while(q.length > 1 && Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) <= 1e-12) q.pop();
  return q;
}
// the blade's margin as the 256-gon the outline is, in the outline's unit frame (r is already area-normalised)
function marginOf(blade){
  const p = [];
  for(let i = 0; i < LEAF_SAMPLES; i++){ const th = TAU*((i + 0.5)/LEAF_SAMPLES - 0.5); p.push([blade.r[i]*Math.cos(th), blade.r[i]*Math.sin(th)]); }
  return dedupe(p);
}
const signedArea = (p) => { let s = 0; for(let i = 0; i < p.length; i++){ const a = p[i], b = p[(i + 1) % p.length]; s += a[0]*b[1] - b[0]*a[1]; } return s/2; };
function inside(pt, poly){
  let c = false;
  for(let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const a = poly[i], b = poly[j];
    if((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0])*(pt[1] - a[1]))/(b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
// area, centroid and the long axis of a simple polygon, from its second moments (not "the longest edge": a margin region has dozens of short 256-gon edges)
function moments(p){
  let A = 0, mx = 0, my = 0, ixx = 0, iyy = 0, ixy = 0;
  for(let i = 0; i < p.length; i++){
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], c = x0*y1 - x1*y0;
    A += c; mx += (x0 + x1)*c; my += (y0 + y1)*c;
    ixx += (x0*x0 + x0*x1 + x1*x1)*c; iyy += (y0*y0 + y0*y1 + y1*y1)*c; ixy += (x0*y1 + 2*x0*y0 + 2*x1*y1 + x1*y0)*c;
  }
  const sgn = A < 0 ? -1 : 1;
  A = Math.abs(A)/2; mx = mx*sgn/(6*A); my = my*sgn/(6*A);   // the centroid: Σ(x0+x1)c / (6·signed area)
  const sxx = sgn*ixx/12 - A*mx*mx, syy = sgn*iyy/12 - A*my*my, sxy = sgn*ixy/24 - A*mx*my;
  const phi = 0.5*Math.atan2(2*sxy, sxx - syy);   // the long axis: where the variance is greatest
  const u = [Math.cos(phi), Math.sin(phi)];
  let half = 0;
  for(const q of p) half = Math.max(half, Math.abs((q[0] - mx)*u[0] + (q[1] - my)*u[1]));
  return { area: A, c: [mx, my], u, half };
}
// the first hit of the ray p + t·d (t > tmin) with the polygon's boundary: its edge, the point on it
function rayHit(poly, p, d, tmin = 1e-12){
  let best = null;
  for(let i = 0; i < poly.length; i++){
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = d[0]*ey - d[1]*ex;
    if(den === 0) continue;
    const ax = a[0] - p[0], ay = a[1] - p[1], t = (ax*ey - ay*ex)/den, u = (ax*d[1] - ay*d[0])/den;
    if(t > tmin && u >= 0 && u < 1 && (!best || t < best.t)) best = { t, e: i, u, pt: [p[0] + t*d[0], p[1] + t*d[1]] };
  }
  return best;
}
// THE ONE PRIMITIVE: a chord of a simple polygon through an interior point p along d — walk both ways to the FIRST boundary hit and split there, which is
// valid for a convex polygon and a concave one alike. A start on a wall is p = start + ε·d, so its backward walk lands on the wall it grew from.
// Returns { a, b, parts: [polygon, polygon] } or null when the chord has no two ends on different edges.
function chord(poly, p, d){
  const fwd = rayHit(poly, p, d), bwd = rayHit(poly, p, [-d[0], -d[1]]);
  if(!fwd || !bwd || fwd.e === bwd.e) return null;
  return { a: bwd.pt, b: fwd.pt, parts: cutAt(poly, bwd, fwd) };
}
// the two polygons a cut between two boundary points makes: P to Q along the boundary, and Q back to P
function cutAt(poly, P, Q){
  const n = poly.length, a = [P.pt], b = [Q.pt];
  for(let i = 1, c = (Q.e - P.e + n) % n; i <= c; i++) a.push(poly[(P.e + i) % n]);
  a.push(Q.pt);
  for(let i = 1, c = (P.e - Q.e + n) % n; i <= c; i++) b.push(poly[(Q.e + i) % n]);
  b.push(P.pt);
  return [dedupe(a), dedupe(b)];
}

// ---- the maze ---------------------------------------------------------------------------------------------------------------
// growAreoles(blade, { seed, cellM, unitM }) → { cells: [{poly, order}], walls: [{a, b, order}] } in the outline's unit frame (1 unit = unitM metres).
// Walls are in the order they were cut, so "older" is "earlier in the array". The only stream is the chords' jitter, drawn in the order the regions are cut.
function growAreoles(blade, { seed, cellM, unitM }){
  const rng = mulberry32(hash3((seed>>>0)^AREOLE_SALT, 0, 0)), A = (cellM/unitM)*(cellM/unitM), k = blade.k;
  const margin = marginOf(blade), walls = [], veins = blade.skel.veins;
  // ORDER 1: the five primaries are rays from the petiole base — and the margin is star-shaped from it — so each cuts a radial polygon into two radial ones.
  // Built straight as sectors between consecutive primaries by angle, the last wrapping through the petiole's side.
  const O = [0, 0], prim = [];
  for(const v of veins){
    if(v.order !== 1) continue;
    const len = Math.hypot(v.b[0], v.b[1]), d = [v.b[0]/len, v.b[1]/len], hit = rayHit(margin, O, d);
    prim.push({ d, hit, ang: Math.atan2(d[1], d[0]) });
    walls.push({ a: [0, 0], b: hit.pt, order: 1 });
  }
  const sorted = [...prim].sort((p, q) => p.ang - q.ang);
  const regions = sorted.map((p, i) => {
    const q = sorted[(i + 1) % sorted.length], n = margin.length, poly = [O, p.hit.pt];
    for(let s = 1, c = (q.hit.e - p.hit.e + n) % n; s <= c; s++) poly.push(margin[(p.hit.e + s) % n]);
    poly.push(q.hit.pt);
    return { poly: dedupe(poly), order: 1 };
  });
  // ORDER 2: each secondary, in skeleton order, starts on its primary and runs along its direction to the first wall or the margin of the region it enters;
  // a younger vein ends where it meets an older wall. One that meets a neighbour's secondary is shorter than growLeaf's: intended.
  for(const v of veins){
    if(v.order !== 2) continue;
    const dx = v.b[0] - v.a[0], dy = v.b[1] - v.a[1], l = Math.hypot(dx, dy), d = [dx/l, dy/l], p = [v.a[0]*k + EPS*d[0], v.a[1]*k + EPS*d[1]];
    const at = regions.findIndex((r) => inside(p, r.poly));
    const cut = at < 0 ? null : chord(regions[at].poly, p, d);
    if(!cut) continue;
    walls.push({ a: cut.a, b: cut.b, order: 2 });
    regions.splice(at, 1, { poly: cut.parts[0], order: 2 }, { poly: cut.parts[1], order: 2 });
  }
  // ORDER >= 3: while a region is bigger than an areole, a chord through a point near its centroid, across its long axis. BFS, so walls come in order.
  const cells = [];
  for(let q = 0; q < regions.length; q++){
    const R = regions[q], m = moments(R.poly);
    if(m.area <= A){ cells.push({ poly: R.poly, order: R.order }); continue; }
    const tilt = (2*rng() - 1)*JITTER_DEG*DEG, ca = Math.cos(tilt), sa = Math.sin(tilt), cross = [-m.u[1], m.u[0]], d = [cross[0]*ca - cross[1]*sa, cross[0]*sa + cross[1]*ca];
    let p = null;
    for(let t = 0; t < REDRAWS && !p; t++){
      const s = (2*rng() - 1)*JITTER_AT*m.half, c = [m.c[0] + m.u[0]*s, m.c[1] + m.u[1]*s];
      if(inside(c, R.poly)) p = c;
    }
    if(!p) p = midChord(R.poly, m.c, m.u);
    const cut = chord(R.poly, p, squared(R.poly, p, d)), order = Math.max(3, R.order + 1);
    if(!cut || cut.parts.some((x) => Math.abs(signedArea(x)) < 1e-15)){ cells.push({ poly: R.poly, order: R.order }); continue; }   // a degenerate region is left whole rather than looped on
    walls.push({ a: cut.a, b: cut.b, order });
    regions.push({ poly: cut.parts[0], order }, { poly: cut.parts[1], order });
  }
  return { cells, walls };
}
// Cells meet their walls nearly square (the crop's rows of cells, and Bohn et al.'s: a new wall leaves a domain perpendicular to the older ones that bound it). The
// principal axis says only where the region is long, and the sides of a region cut by earlier chords are not square to it, so the direction is turned once toward the
// two sides it would land on: the cross-axis chord d is tried, and where its two ends meet near-parallel sides it turns HALFWAY to the perpendicular q of their mean.
// normalize(d + q) is the bisector of the two, so a chord 40° off square ends about 20° off: not square. The half turn is what the maze is built and measured with
// (junction median 83.5°, 94 % of chord ends within 90° ± 25°; maze.test.js holds ±10° and 80 %), and a full turn would draw a different maze everywhere, so "nearly
// square" is the claim this fixture makes.
function squared(poly, p, d){
  const f = rayHit(poly, p, d), b = rayHit(poly, p, [-d[0], -d[1]]);
  if(!f || !b) return d;
  const dir = (h) => { const a = poly[h.e], c = poly[(h.e + 1) % poly.length], l = Math.hypot(c[0] - a[0], c[1] - a[1]); return [(c[0] - a[0])/l, (c[1] - a[1])/l]; };
  const e1 = dir(f);
  let e2 = dir(b);
  if(e1[0]*e2[0] + e1[1]*e2[1] < 0) e2 = [-e2[0], -e2[1]];
  if(e1[0]*e2[0] + e1[1]*e2[1] < SQUARE_AT) return d;
  const m = [e1[0] + e2[0], e1[1] + e2[1]], l = Math.hypot(...m);
  let q = [-m[1]/l, m[0]/l];
  if(q[0]*d[0] + q[1]*d[1] < 0) q = [-q[0], -q[1]];
  const n = [d[0] + q[0], d[1] + q[1]], ln = Math.hypot(...n);
  return [n[0]/ln, n[1]/ln];
}
// the midpoint of the longest stretch of the line c + t·u that lies inside the polygon: an interior point where a jittered one fell outside a concave region
function midChord(poly, c, u){
  const ts = [];
  for(let i = 0; i < poly.length; i++){
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = u[0]*ey - u[1]*ex;
    if(den === 0) continue;
    const ax = a[0] - c[0], ay = a[1] - c[1], t = (ax*ey - ay*ex)/den, s = (ax*u[1] - ay*u[0])/den;
    if(s >= 0 && s < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  let best = 0, mid = 0;
  for(let i = 0; i + 1 < ts.length; i += 2) if(ts[i + 1] - ts[i] > best){ best = ts[i + 1] - ts[i]; mid = (ts[i] + ts[i + 1])/2; }
  return [c[0] + u[0]*mid, c[1] + u[1]*mid];
}

// ---- the raster -------------------------------------------------------------------------------------------------------------
// The blemish hook (P4b, built: nothing). A blemish is { kind, … }; `kind` names an entry here that may add τ or punch holes — browning from the margin, tar
// spot, leaf spot with its halo, insect holes. The registry is empty, so with `blemishes = []` (today, always) the loops below do nothing and the output
// is bit-for-bit what it is without them.
const BLEMISH = {};

const SS = 4;   // supersampling per axis: 16 samples a pixel, so a wall thinner than a pixel is a coverage, not a speckle
// The picture's frame: the margin's box, squared and padded, with the leaf's tip up (the leaf's +x is the picture's up).
function viewOf(margin){
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for(const [x, y] of margin){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
  return { cx: (x0 + x1)/2, cy: (y0 + y1)/2, half: 1.04*Math.max(x1 - x0, y1 - y0)/2 };
}
// the lamina on the subsample grid (1 inside the margin): an even-odd scanline fill, the sample taken at each cell's centre
function fillLamina(margin, view, S){
  const s = S/(2*view.half), lam = new Uint8Array(S*S), pts = margin.map(([x, y]) => [(y - view.cy)*s + S/2, S/2 - (x - view.cx)*s]);
  for(let r = 0; r < S; r++){
    const yy = r + 0.5, xs = [];
    for(let i = 0; i < pts.length; i++){
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if((a[1] > yy) !== (b[1] > yy)) xs.push(a[0] + (yy - a[1])*(b[0] - a[0])/(b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for(let i = 0; i + 1 < xs.length; i += 2) for(let c = Math.max(0, Math.ceil(xs[i] - 0.5)); c < S && c + 0.5 < xs[i + 1]; c++) lam[r*S + c] = 1;
  }
  return lam;
}
// each wall as a capsule of half-width w·widthOf(order), as the area of a one-sample box it covers (exact for a strip, so a hairline keeps its area), the
// union of them by max so a junction is not counted twice
function stampWalls(walls, w, view, S){
  const s = S/(2*view.half), cover = new Uint8Array(S*S);
  for(const wl of walls){
    const ax = (wl.a[1] - view.cy)*s + S/2, ay = S/2 - (wl.a[0] - view.cx)*s, bx = (wl.b[1] - view.cy)*s + S/2, by = S/2 - (wl.b[0] - view.cx)*s;
    const hw = w*widthOf(wl.order)*s, dx = bx - ax, dy = by - ay, l2 = dx*dx + dy*dy, pad = hw + 1;
    const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad)), c1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx) + pad));
    const r0 = Math.max(0, Math.floor(Math.min(ay, by) - pad)), r1 = Math.min(S - 1, Math.ceil(Math.max(ay, by) + pad));
    for(let r = r0; r <= r1; r++) for(let c = c0; c <= c1; c++){
      const px = c + 0.5 - ax, py = r + 0.5 - ay, t = l2 ? Math.max(0, Math.min(1, (px*dx + py*dy)/l2)) : 0, d = Math.hypot(px - t*dx, py - t*dy);
      const cov = Math.min(d + 0.5, hw) - Math.max(d - 0.5, -hw);
      if(cov > 0){ const v = Math.round(Math.min(1, cov)*255), i = r*S + c; if(v > cover[i]) cover[i] = v; }
    }
  }
  return cover;
}
// one pass at width w: the two coverages per pixel (`lam`: how much of it is lamina; `wall`: how much of THAT is wall), and the share of the lamina the walls hold
function pass(margin, maze, view, w, N){
  const S = N*SS, lamS = fillLamina(margin, view, S), cover = w > 0 ? stampWalls(maze.walls, w, view, S) : null;
  const lam = new Float32Array(N*N), wall = new Float32Array(N*N);
  let wSum = 0, lSum = 0;
  for(let j = 0; j < N; j++) for(let i = 0; i < N; i++){
    let l = 0, wc = 0;
    for(let q = 0; q < SS; q++) for(let p = 0; p < SS; p++){ const x = (j*SS + q)*S + i*SS + p; if(lamS[x]){ l++; if(cover) wc += cover[x]/255; } }
    lam[j*N + i] = l/(SS*SS);
    if(l){ wall[j*N + i] = wc/l; wSum += wc; lSum += l; }
  }
  return { lam, wall, share: lSum ? wSum/lSum : 0 };
}
// rasterLeaf(blade, maze, fw, N, blemishes) → { lam, wall, N, view, w, share }: N×N Float32 coverages. The wall half-width unit w is solved so that
// Σ L_o·2·h_o = f_w·(lamina area), then the walls are rasterised and w rescaled ONCE by f_w over the share measured (junctions overlap and a hairline is
// quantised), so the share is f_w to the raster's own resolution and the picture's mean is the engine's mixture. f_w = 0 draws no wall: all lamina is cell.
function rasterLeaf(blade, maze, fw, N, blemishes = []){
  const margin = marginOf(blade), view = viewOf(margin), area = Math.abs(signedArea(margin));
  let w = 0, share = 0, out;
  if(fw > 0){
    let L = 0;
    for(const wl of maze.walls) L += Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1])*2*widthOf(wl.order);
    w = fw*area/L;
    // the probe is at the final N: at N/2 the hairline walls' coverage is measured off a coarser lamina edge and the share lands ~0.6 % high at f_w 0.2
    const probe = pass(margin, maze, view, w, N);
    if(probe.share > 0) w *= fw/probe.share;
  }
  out = pass(margin, maze, view, w, N);
  share = out.share;
  const r = { lam: out.lam, wall: out.wall, N, view, w, share };
  for(const b of blemishes) BLEMISH[b.kind]?.mask?.(r, b);
  return r;
}

// ---- the colour -------------------------------------------------------------------------------------------------------------
const srgb = (t) => 255*(t <= 0.0031308 ? 12.92*t : 1.055*Math.pow(t, 1/2.4) - 0.055);
// A held leaf against a white sun: T = lam·(wall·e^−τ_wall + (1 − wall)·e^−τ_cell) per channel, sRGB-encoded, no tone map. RGBA, N×N.
// A pigment change only recolours: the masks are not touched. Outside the lamina is dark.
function paintLeaf(raster, tauWall, tauCell, blemishes = []){
  const { lam, wall, N } = raster, out = new Uint8ClampedArray(N*N*4), eW = tauWall.map((t) => Math.exp(-t)), eC = tauCell.map((t) => Math.exp(-t));
  for(let i = 0; i < N*N; i++){
    const l = lam[i], f = wall[i];
    for(let c = 0; c < 3; c++){
      let t = l*(f*eW[c] + (1 - f)*eC[c]);
      for(const b of blemishes) t = BLEMISH[b.kind]?.tint?.(t, i, c, b) ?? t;
      out[i*4 + c] = srgb(t);
    }
    out[i*4 + 3] = 255;
  }
  return out;
}

// ---- the tissues, from the engine's own function ----------------------------------------------------------------------------
// τ_wall and τ_cell of the leaf at address (j, k): leafTau returns only their mixture, and the pigment law is not restated here — leafTau is called twice.
// f_w = 0 makes mixtureTau copy the cell, so the first call IS τ_cell; with the anthocyanin at 0 as well, a = 0·(0.5 + r()) = 0, the draws keep their order
// (phi, then a, then b), and cell = base + s·(pig + 0) is exactly the wall's arithmetic. No `phiE`: with turn_exposure > 0 the canopy's leaf turns by its light,
// which a leaf held in the hand cannot know — so this is the leaf at its own clock.
// `dT` and `cT` are its tree's lead and depth (tree_clock_spread, tree_pigment_spread; math.js treeShifts / treeGains), which the caller reads for the tree the leaf hangs on and hands to both calls
// alike: the lead moves the leaf's clock and the depth scales its red AND brown, so the walls brown with the tree and the cells redden with it. Absent, the leaf is the tree-less one.
function tissues(P, seed, j, k, dT, cT){
  const summer = [P.trans_r, P.trans_g, P.trans_b].map((t) => -Math.log(Math.min(0.999, Math.max(1e-4, t))));   // komorebi-grove.js's tauSummer
  const cell = leafTau(summer, { ...P, wall_fraction: 0 }, seed, j, k, undefined, undefined, undefined, dT, cT);
  const wall = leafTau(summer, { ...P, wall_fraction: 0, anthocyanin: 0 }, seed, j, k, undefined, undefined, undefined, dT, cT);
  return { wall, cell, summer };
}

// ---- the leaf at an address ---------------------------------------------------------------------------------------------------
// Leaf (j, k) of the grove: its outline variant and the stream that grew it are the grove's own (leafVariant, outlineSeed), so this is the leaf the engine hangs
// there. Memoised on what regrows it (seed, address, size) — the raster and the pigment are the preview's to redo, and cheap beside the maze.
const memo = new Map();
function leafMaze(spec, seed, j, k, sizeM){
  const key = `${spec.species}|${seed>>>0}|${j}|${k}|${sizeM}`;
  let g = memo.get(key);
  if(!g){
    const variant = leafVariant(seed, j, k), blade = bladeOf(spec, outlineSeed(spec, seed, variant));
    g = { variant, blade, maze: growAreoles(blade, { seed: hash3(seed>>>0, j, k), cellM: AREOLE_M, unitM: sizeM/2 }) };
    if(memo.size >= 8) memo.delete(memo.keys().next().value);
    memo.set(key, g);
  }
  return g;
}

export { AREOLE_M, AREOLE_SALT, marginOf, growAreoles, rasterLeaf, paintLeaf, tissues, leafMaze };
