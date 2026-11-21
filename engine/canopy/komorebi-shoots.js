// ============================================================================
// Leaves on shoots, displayed by light (spec model/canopy.md, "Shoots"; model/leaf.md, "What one leaf stamps"). Pure: no GL, no EDITOR file.
// The grove (komorebi-grove.js) asks this module three things: each cluster's light, each cluster's shoots, and where on them leaf k hangs.
//
// THE CLUSTER'S LIGHT is the growth sky's, overhead, never the scene's sun: every other cluster above casts its leaf area down a cone widening by one unit
// per unit of drop (Pałubicki et al. 2009's shadow pyramid, 45°, without the voxels), as a gaussian of that radius faded in over its first two leaf sizes
// of drop, and the cluster's light is e^(−½·the leaf area index above it), leaves facing every way. A smooth function of where the clusters are, so a
// morph that nudges them nudges it. Each cluster casts its NOMINAL area (leaves_per_cluster leaves of the look's size), so density moves no light.
//
// THE LEAF BY LIGHT (Planchais & Sinoquet 1998, beech): mean inclination 22° in shade (5 % of open light) to 34° in the open; the leaf's own tilt draw
// spreads it over [0, 2μ], so ⟨cos⟩ is 0.905 and 0.781, against their leaf-inclination effect 0.91 / 0.80 (Table 3, vertical).
//
// THE SHOOT (Gregory 1980; Dupré et al. 1986; Lemoine et al. 2002). The twig is last year's long shoot; this year's leave it at its nodes, the leader at
// its tip and the laterals back along its own wood, alternately left and right, or in decussate pairs where the tree's phyllotaxis is opposite. A shoot
// carries 3–5 leaves one a node (alternate, Dupré) or 2–4 pairs (opposite, Gregory). Short in shade, long in sun: its internode glides from 2.5 mm to
// 11 mm and on, by a smoothstep of its own threshold against the share of long laterals, 40 % at 0.138 of open light to 85 % in the open (Lemoine).
// A long shoot in light rises toward upright (Dupré's second flush). Each blade sits off its node on its petiole, fanned forward along the shoot, so the
// blades point along the branch (Planchais Fig. 4B). Lengths are in the look's blade lengths, botanical: a beech blade is 50 mm.
//
// CONTINUITY. A leaf's shoot and node are fixed by (seed, j, k) alone, never by the light, so a density step adds leaves at the end of the last shoot
// and moves no one; the light moves only continuous things (the internode, the rise, the tilt). Turning the shoots on or off is not a morph: a leaf's
// old place and its node can be a limb apart, so stepped through a share it would fly (a one-second morph flew one 19.5 of its own lengths in a
// frame, and the gaps it crossed flickered). shoot_leaves is a switch, and the two arrangements cross as two groves (komorebi-params.js). With inner_leaves up, a share of the SHOOTS hangs back
// on the older wood, whole, by each shoot's own draws and the u² arc law placeLeaf gives single leaves: spurs on old wood.
// PROVISIONAL: every constant in SHOOT not marked cited. APPROXIMATIONS: a shoot's leaf count does not follow its type; a cluster has one light; the
// twig's plan heading stands for its 3-D axis; a leaf sits at its node's height.
// ============================================================================
import { DEG, clamp, hash3, mulberry32, smoothstep } from '../komorebi-math.js';

// 6·0x9E3779B9 mod 2^32: the golden gamma's next multiple after the leaf's side (5·, komorebi-leaf.js), in no other stream
export const SHOOT_LEAF_SALT = 0xB54CDA56;
export const SHOOT = {
  // cited
  shortInternode: 2.5/50,   // ≤ 2.5 mm (Lemoine p. 763) over a 50 mm beech blade (Planchais Table 1)
  longInternode: 11/50,     // ≥ 11 mm (Lemoine p. 763)
  longShare: [[0.138, 0.40], [1, 0.85]],   // [relative light, share of long laterals] (Lemoine Tables I–II)
  tiltMean: [[0.05, 22], [1, 34]],         // [relative light, mean inclination °] (Planchais & Sinoquet, p. 244–246)
  // provisional
  longMax: 0.35,            // a long shoot's internode at full vigour, in blade lengths (the 11 mm floor is 0.22)
  parentInternode: 0.35,    // the twig's own internodes, where the laterals leave it, in blade lengths
  glide: 0.05,              // the smoothstep's half-width in long share, as INNER_GLIDE
  rise: 0.7,                // how far a long shoot in full light turns upright (0 flat, 1 vertical)
  petiole: [0.15, 0.7],     // petiole over blade length: alternate (beech, short) / opposite (maple, long)
  fan: [100, 25],           // degrees a blade turns off its shoot's axis, at its first node / its last
  azJitter: 0.6,            // radians: the leaf's own angle draw spreads its blade this much about the fan's direction
  shootRadius: 0.01,        // this year's shoot as wood (leaf_stalks), in blade lengths: about 0.5 mm on a 50 mm beech blade; at 0.02 it read as a twig
  stalkRadius: 0.01,        // the petiole as wood (leaf_stalks), in blade lengths: about 0.5 mm
};
const lerpTab = (tab, x) => { if(x <= tab[0][0]) return tab[0][1]; for(let i = 1; i < tab.length; i++) if(x <= tab[i][0]){ const [a, fa] = tab[i-1], [b, fb] = tab[i]; return fa + (fb - fa)*(x - a)/(b - a); } return tab[tab.length-1][1]; };
export const longShare = (e) => lerpTab(SHOOT.longShare, e);
export const tiltMeanDeg = (e) => lerpTab(SHOOT.tiltMean, e);
// A leaf's rest tilt by light, from its own tilt draw u: uniform over [0, 2μ(e)].
export const lightTilt = (u, e) => u*2*tiltMeanDeg(e)*DEG;

// Each cluster's light (see the header). twigs: the grove's twigs (x, y, z, tcov). P: the look.
export function clusterLight(twigs, P, cone = 1, G = 0.5){
  const n = twigs.length, out = new Float64Array(n), s0 = P.leaf_size_m*2, onset = P.leaf_size_m*2;
  const a0 = Math.max(1, P.leaves_per_cluster)*Math.PI*(P.leaf_size_m*0.5)**2/P.leaf_aspect;
  // a coarse grid by plan cell, so each cluster visits only the clusters that can reach it (a cone reaches 4σ, and σ grows with the drop)
  let zMax = -Infinity, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const t of twigs){ if(t.z > zMax) zMax = t.z; if(t.x < x0) x0 = t.x; if(t.x > x1) x1 = t.x; if(t.y < y0) y0 = t.y; if(t.y > y1) y1 = t.y; }
  let zMin = Infinity; for(const t of twigs) if(t.z < zMin) zMin = t.z;
  const reach = 4*(s0 + cone*Math.max(zMax - zMin, 0)), cell = Math.max(reach/4, 1e-3);
  const nx = Math.max(1, Math.ceil((x1 - x0)/cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0)/cell) + 1), grid = new Map();
  for(let j = 0; j < n; j++){ const t = twigs[j], key = Math.floor((t.x - x0)/cell)*ny + Math.floor((t.y - y0)/cell); if(!grid.has(key)) grid.set(key, []); grid.get(key).push(j); }
  const r = Math.ceil(reach/cell);
  for(let i = 0; i < n; i++){
    const a = twigs[i], ci = Math.floor((a.x - x0)/cell), cj = Math.floor((a.y - y0)/cell); let lai = 0;
    for(let gx = Math.max(0, ci - r); gx <= Math.min(nx - 1, ci + r); gx++) for(let gy = Math.max(0, cj - r); gy <= Math.min(ny - 1, cj + r); gy++){
      const c = grid.get(gx*ny + gy); if(!c) continue;
      for(const j of c){
        if(j === i) continue;
        const b = twigs[j], dz = b.z - a.z; if(dz <= 0) continue;
        const sg = s0 + cone*dz, r2 = (b.x - a.x)**2 + (b.y - a.y)**2; if(r2 > 16*sg*sg) continue;
        lai += a0*(b.tcov ?? 1)*Math.exp(-r2/(2*sg*sg))/(2*Math.PI*sg*sg)*smoothstep(0, onset, dz);
      }
    }
    out[i] = Math.exp(-G*lai);
  }
  return out;
}

// Cluster j's shoots, enough for nLeaf leaves: for each leaf its shoot s, node and side; for each shoot its leaf count n and its type threshold h.
// Draws: hash3(seed ^ SHOOT_LEAF_SALT, j, s). Prefix-stable in nLeaf.
export function clusterShoots(seed, j, nLeaf, opposite){
  const shoot = [], leaf = [];
  for(let s = 0; leaf.length < nLeaf; s++){
    const r = mulberry32(hash3((seed>>>0)^SHOOT_LEAF_SALT, j, s));
    const n = opposite ? 2*(2 + Math.floor(3*r())) : 3 + Math.floor(3*r());
    const h = r();
    shoot.push({ n, h });
    for(let i = 0; i < n && leaf.length < nLeaf; i++) leaf.push(opposite ? { s, node: i >> 1, side: (i & 1) ? -1 : 1 } : { s, node: i, side: (i & 1) ? -1 : 1 });
  }
  return { shoot, leaf };
}

// Where leaf k of cluster j hangs on its shoot: o[0..2] its place, o[3] its pivot weight (as placeLeaf's), o[4] its blade's heading in the record's
// clockwise basis (the blade's apex points away from its node), o[5] how much of it hangs there: 1 while the shoots are on.
// o[6..8] its node, o[9..11] its shoot's base (where the shoot leaves its twig, or the older wood it hangs back on), o[12] that share of the
// shoot on the older wood (0 on its twig): what leaf_stalks draws as the shoot's wood and the leaf's stalk.
// t: the twig; e: the cluster's light; lt: the leaf's own length; origin: where along the blade its stamp is placed from (0.5 the ellipse's middle,
// the outline's own origin); path, pathLen: the twig's wood back to the trunk (inner shoots).
export function shootLeaf(cs, j, k, t, e, P, lt, origin, o, path = null, pathLen = 0){
  const opposite = P.phyllotaxis === 'opposite', L0 = P.leaf_size_m;
  const { s, node, side } = cs.leaf[k], sh = cs.shoot[s];
  let hx = t.dx || 0, hy = t.dy || 0; const hl = Math.hypot(hx, hy); if(hl > 1e-6){ hx /= hl; hy /= hl; } else { hx = 1; hy = 0; }
  const type = smoothstep(sh.h - SHOOT.glide, sh.h + SHOOT.glide, longShare(e));   // 0 short .. 1 long
  const ell = clamp((e - 0.05)/0.95, 0, 1);
  const iota = L0*(SHOOT.shortInternode + (SHOOT.longMax - SHOOT.shortInternode)*type);
  let ox = t.x, oy = t.y, dxp = hx, dyp = hy;
  if(s > 0){   // laterals back along the twig, alternately side to side; a decussate pair in the vertical plane reads narrower from above
    const pos = opposite ? ((s + 1) >> 1) : s, back = pos*SHOOT.parentInternode*L0;
    ox -= hx*back; oy -= hy*back;
    const ang = (opposite && (pos & 1) === 0 ? 0.5 : 1)*((s & 1) ? 1 : -1)*(P.branch_angle_deg*DEG);
    const c = Math.cos(ang), sn = Math.sin(ang); dxp = hx*c - hy*sn; dyp = hx*sn + hy*c;
  }
  let oz = t.z; o[3] = 0; o[12] = 0;
  if(P.inner_leaves > 0 && path && path.length >= 6){   // an inner shoot: the whole shoot back on the older wood
    const r = mulberry32(hash3((P.seed>>>0)^SHOOT_LEAF_SALT, j, 0x10000 + s)), h = r(), u = r();
    const w = smoothstep(h, h + 0.05, P.inner_leaves);
    if(w > 0){
      const n = path.length/3 - 1; let rem = u*u*pathLen, i = 0, L = 0;
      for(; i < n; i++){ L = Math.hypot(path[3*i]-path[3*i+3], path[3*i+1]-path[3*i+4], path[3*i+2]-path[3*i+5]); if(rem <= L || i === n-1) break; rem -= L; }
      const f = L > 0 ? Math.min(rem/L, 1) : 0;
      const qx = path[3*i] + (path[3*i+3]-path[3*i])*f, qy = path[3*i+1] + (path[3*i+4]-path[3*i+1])*f, qz = path[3*i+2] + (path[3*i+5]-path[3*i+2])*f;
      ox += (qx - ox)*w; oy += (qy - oy)*w; oz += (qz - oz)*w;
      let m = 0; while(m < n && !(path[3*m] === t.bx && path[3*m+1] === t.by)) m++;
      o[3] = i >= m ? w : 0; o[12] = w;
    }
  }
  const up = SHOOT.rise*type*ell*Math.PI/2, run = Math.cos(up), climb = Math.sin(up);
  const along = (node + 1)*iota;
  const nx = ox + dxp*along*run, ny = oy + dyp*along*run, nz = oz + along*climb;
  const nodes = opposite ? sh.n >> 1 : sh.n, fanDeg = SHOOT.fan[0] + (SHOOT.fan[1] - SHOOT.fan[0])*node/Math.max(1, nodes - 1);
  const fan = side*fanDeg*DEG, fc = Math.cos(fan), fs = Math.sin(fan);
  const bx = dxp*fc - dyp*fs, by = dxp*fs + dyp*fc;
  const reach = SHOOT.petiole[opposite ? 1 : 0]*L0 + lt*origin;
  o[0] = nx + bx*reach; o[1] = ny + by*reach; o[2] = nz;
  o[4] = -Math.atan2(by, bx);
  o[5] = P.shoot_leaves > 0 ? 1 : 0;
  o[6] = nx; o[7] = ny; o[8] = nz; o[9] = ox; o[10] = oy; o[11] = oz;
  return o;
}
