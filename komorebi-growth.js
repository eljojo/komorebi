// ============================================================================
// komorebi-growth.js — a tree grown year by year from buds, the light deciding which grow (spec/exploration/directions.md,
// "Trees grown year by year, from buds, under light"). Pure, no GL: buildGrove (komorebi-grove.js) calls it in place of the
// fork-at-the-tip grammar when growth_years is above 0, and takes back the same records the grammar hands it.
//
// THE YEAR. Every living bud sits at the tip of a metamer (one internode of wood, with its node) or, for the seedling's
// first bud, on the ground. Each year:
//   1. LIGHT. The foliage of the last two years casts shade into a voxel grid as a pyramid widening downward (light comes
//      from a fixed growth sky overhead, never from the scene's sun), and a bud's light is exp(−k·shade) at its place, its
//      own metamer's share left out.
//   2. SHEDDING. A side branch two years old or more whose light per internode falls below `shed` dies with all it carries:
//      the shell shades its own interior bare.
//   3. RESOURCE (Borchert–Honda). The light the whole tree gathers, times alpha, flows from the base toward the buds; at
//      every node it splits between the axis that continues (weight λ·Q) and each side branch (weight (1−λ)·Q), so apical
//      control is λ and a well-lit branch draws more.
//   4. GROWTH. A bud given v ≥ 1 grows a shoot of ⌊v⌋ internodes (at most maxShoot), each turned a little toward less shade
//      and by its tropism (the trunk up, a side branch by the look's droop). Each new node carries dormant side buds set by
//      the phyllotaxis; the last carries the axis's terminal bud.
// The leaves hang on the shoots grown in the last year, one cluster per shoot, as the grammar hangs one per twig.
// Approximation: one growth sky straight overhead, one internode length, no reiteration or epicormic shoots, and a shoot
// is straight between its nodes. Provisional: every constant in GROWTH, set by eye on one tree.
// ============================================================================
import { GOLDEN, TAU } from './komorebi-math.js';

export const GROWTH = {
  alpha: 4,       // resource per unit of light the tree gathers
  shadeA: 1,      // shade a node casts into its own voxel
  shadeB: 1.8,    // ...falling by this factor per voxel below
  shadeQ: 5,      // ...this many voxels deep
  k: 0.45,        // light = exp(−k · shade)
  xi: 0.3,        // how hard a shoot turns toward less shade
  trunkUp: 0.35,  // the trunk's pull upward
  droopPull: 0.3, // a side branch's pull down per unit of droop (negative droop sweeps up)
  setpoint: 1.5,  // how hard a side branch is held at its set angle (spec.pitch above the horizontal); 0 = not held. It must
                  // outweigh the turn toward light (xi), or every side shoot ends up vertical and a branch ends in an upward fan
  bole: 0.2,      // the share of the trunk's height kept clear of branches, as a park or street tree is pruned up as it grows
  maxShoot: 6,    // the longest shoot one bud grows in a year, in internodes
  shed: 0.2,      // light per internode below which a side branch dies
  cap: 60000,     // internodes: growth stops past this
  half: 64,       // the shade grid: ±half voxels across, 0..height up
  height: 128,
};

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
// a direction turned off `d` by `theta`, at azimuth `phi` about it
function turnOff(d, theta, phi){
  const ref = Math.abs(d[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const u = norm([d[1]*ref[2] - d[2]*ref[1], d[2]*ref[0] - d[0]*ref[2], d[0]*ref[1] - d[1]*ref[0]]);
  const w = [d[1]*u[2] - d[2]*u[1], d[2]*u[0] - d[0]*u[2], d[0]*u[1] - d[1]*u[0]];
  const c = Math.cos(theta), s = Math.sin(theta), cp = Math.cos(phi), sp = Math.sin(phi);
  return norm([c*d[0] + s*(cp*u[0] + sp*w[0]), c*d[1] + s*(cp*u[1] + sp*w[1]), c*d[2] + s*(cp*u[2] + sp*w[2])]);
}

// spec: { years, lambda (apical control), angle (rad, a side bud off its axis), pitch (rad, the set angle a side branch is held at
// above the horizontal), phyllo (0 spiral, 1 whorled, 2 opposite), droop,
// kids (the grammar's branch_children, which the wood's taper is expressed in) }
// rng: this tree's own stream. Fills out.seg, out.tw and (when out.path is an array) out.path exactly as growSkeleton does,
// in local units (one internode = 1), the tree standing at the origin. Returns { sector(m) } for the main limbs: see limbs().
export function growBuds(spec, rng, out){
  const G = GROWTH, { years, lambda, angle, phyllo, droop } = spec, kids = Math.max(1.001, spec.kids);
  const M = [];   // metamers: { a, b, d, par, ord, yr, alive, kids, buds, shoot }
  const B = [];   // buds: { m (metamer at whose tip, −1 the ground), d, ord, phi, alive, q, v }
  const rootKids = [], rootBuds = [];
  const div = phyllo === 2 ? Math.PI/2 : phyllo === 1 ? Math.PI/3 : GOLDEN;   // the turn from one node to the next
  const perNode = phyllo === 2 ? 2 : phyllo === 1 ? 3 : 1;                       // side buds at a node
  const addBud = (m, d, ord, phi) => { const i = B.length; B.push({ m, d, ord, phi, alive: true, q: 0, v: 0 }); (m < 0 ? rootBuds : M[m].buds).push(i); return i; };
  addBud(-1, [0, 0, 1], 0, rng()*TAU);

  const H = G.half, NZ = G.height, NX = 2*H + 1, grid = new Float32Array(NX*NX*NZ);
  const vox = (p) => { const i = Math.round(p[0]) + H, j = Math.round(p[1]) + H, z = Math.round(p[2]);
    return i < 0 || j < 0 || z < 0 || i >= NX || j >= NX || z >= NZ ? -1 : (z*NX + j)*NX + i; };
  const shadeAt = (x, y, z) => { const i = x + H, j = y + H; return i < 0 || j < 0 || z < 0 || i >= NX || j >= NX || z >= NZ ? 0 : grid[(z*NX + j)*NX + i]; };
  const tipOf = (m) => m < 0 ? [0, 0, 0] : M[m].b;
  const isCaster = (m, y) => m >= 0 && M[m].alive && M[m].yr >= y - 2;
  const shoots = [];   // { metas, yr, ord }

  for(let y = 0; y < years && M.length < G.cap; y++){
    // 1. light
    grid.fill(0);
    for(let m = 0; m < M.length; m++){
      if(!isCaster(m, y)) continue;
      const c = M[m].b, ci = Math.round(c[0]), cj = Math.round(c[1]), cz = Math.round(c[2]);
      for(let q = 0; q <= G.shadeQ; q++){
        const z = cz - q; if(z < 0) break;
        const s = G.shadeA*Math.pow(G.shadeB, -q);
        for(let dj = -q; dj <= q; dj++) for(let di = -q; di <= q; di++){
          const i = ci + di + H, j = cj + dj + H;
          if(i >= 0 && j >= 0 && i < NX && j < NX && z < NZ) grid[(z*NX + j)*NX + i] += s;
        }
      }
    }
    for(const b of B){ if(!b.alive) continue;
      const v = vox(tipOf(b.m)); const s = v < 0 ? 0 : grid[v] - (isCaster(b.m, y) ? G.shadeA : 0);
      b.q = Math.exp(-G.k*Math.max(0, s)); }
    // basipetal: the light each metamer's subtree gathers, and its internodes
    const Q = new Float64Array(M.length), N = new Float64Array(M.length);
    for(let m = M.length - 1; m >= 0; m--){ const n = M[m]; if(!n.alive) continue;
      let q = 0, c = 1; for(const bi of n.buds) if(B[bi].alive) q += B[bi].q;
      for(const k of n.kids) if(M[k].alive){ q += Q[k]; c += N[k]; }
      Q[m] = q; N[m] = c; }
    // 2. shedding
    const kill = (m) => { const st = [m]; while(st.length){ const x = st.pop(), n = M[x]; if(!n.alive) continue; n.alive = false;
      for(const bi of n.buds) B[bi].alive = false; for(const k of n.kids) st.push(k); } };
    if(y >= 2) for(let m = 0; m < M.length; m++){ const n = M[m];
      if(n.alive && n.ord > 0 && (n.par < 0 || M[n.par].ord < n.ord) && n.yr <= y - 2 && Q[m]/N[m] < G.shed) kill(m); }
    // the clear trunk: side branches leaving the trunk below a share of its height are pruned, year by year as it grows
    if(G.bole > 0){
      let top = 0; for(const n of M) if(n.alive && n.ord === 0) top = Math.max(top, n.b[2]);
      for(let m = 0; m < M.length; m++){ const n = M[m]; if(!n.alive || n.ord !== 0 || n.b[2] >= G.bole*top) continue;
        for(const bi of n.buds) if(B[bi].ord > 0) B[bi].alive = false;
        for(const k of n.kids) if(M[k].ord > 0) kill(k); }
    }
    // 3. resource, from the base out
    const vIn = new Float64Array(M.length);
    const split = (v, ord, kids, buds) => {
      let sw = 0; const w = [];
      for(const k of kids) if(M[k].alive){ const x = (M[k].ord === ord ? lambda : 1 - lambda)*Q[k]; w.push([0, k, x]); sw += x; }
      for(const bi of buds) if(B[bi].alive){ const x = (B[bi].ord === ord ? lambda : 1 - lambda)*B[bi].q; w.push([1, bi, x]); sw += x; }
      if(!(sw > 0)) return;
      for(const [t, i, x] of w){ const share = v*x/sw; if(t === 0) vIn[i] = share; else B[i].v = share; }
    };
    let Qroot = 0; for(const bi of rootBuds) if(B[bi].alive) Qroot += B[bi].q; for(const k of rootKids) if(M[k].alive) Qroot += Q[k];
    for(const b of B) b.v = 0;
    split(G.alpha*Qroot, 0, rootKids, rootBuds);
    for(let m = 0; m < M.length; m++) if(M[m].alive) split(vIn[m], M[m].ord, M[m].kids, M[m].buds);
    // 4. growth
    const grow = B.length;
    for(let bi = 0; bi < grow; bi++){
      const b = B[bi]; if(!b.alive || b.v < 1) continue;
      const n = Math.min(G.maxShoot, Math.floor(b.v));
      b.alive = false;
      let prev = b.m, d = b.d, phi = b.phi;
      const metas = [];
      for(let s = 0; s < n && M.length < G.cap; s++){
        const a = tipOf(prev);
        // toward less shade: the grid's gradient at the shoot's tip; the trunk also takes the sky's pull upward, a side
        // shoot only the shade around it (with no shade to steer by it keeps its heading)
        const ci = Math.round(a[0]), cj = Math.round(a[1]), cz = Math.round(a[2]);
        const gx = shadeAt(ci + 1, cj, cz) - shadeAt(ci - 1, cj, cz), gy = shadeAt(ci, cj + 1, cz) - shadeAt(ci, cj - 1, cz), gz = shadeAt(ci, cj, cz + 1) - shadeAt(ci, cj, cz - 1);
        const opt = b.ord === 0 ? norm([-gx, -gy, -gz + 0.5]) : Math.hypot(gx, gy, gz) > 1e-6 ? norm([-gx, -gy, -gz]) : [0, 0, 0];
        const trop = b.ord === 0 ? G.trunkUp : -droop*G.droopPull;
        // a side branch's set angle (the gravitropic setpoint the axis above it holds it to): pulled toward the direction
        // at spec.pitch above the horizontal along its own heading, so it cannot curl up into a second trunk
        let hx = 0, hy = 0, hz = 0;
        if(b.ord > 0 && G.setpoint > 0){ const h = Math.hypot(d[0], d[1]) || 1, cp = Math.cos(spec.pitch), sp = Math.sin(spec.pitch);
          hx = G.setpoint*(cp*d[0]/h - d[0]); hy = G.setpoint*(cp*d[1]/h - d[1]); hz = G.setpoint*(sp - d[2]); }
        d = norm([d[0] + G.xi*opt[0] + hx, d[1] + G.xi*opt[1] + hy, d[2] + G.xi*opt[2] + trop + hz]);
        const m = M.length;
        M.push({ a, b: [a[0] + d[0], a[1] + d[1], a[2] + d[2]], d, par: prev, ord: b.ord, yr: y, alive: true, kids: [], buds: [], shoot: shoots.length });
        (prev < 0 ? rootKids : M[prev].kids).push(m);
        phi += div + (rng() - 0.5)*0.3;
        for(let k = 0; k < perNode; k++) addBud(m, turnOff(d, angle*(0.85 + 0.3*rng()), phi + k*TAU/perNode), b.ord + 1, rng()*TAU);
        metas.push(m); prev = m;
      }
      if(metas.length){ addBud(prev, d, b.ord, phi); shoots.push({ metas, yr: y, ord: b.ord }); }
    }
  }

  // ---- hand the tree back as the grammar does ----
  const last = shoots.reduce((y, s) => s.metas.some((m) => M[m].alive) ? Math.max(y, s.yr) : y, -1);
  const leafy = [], twigOf = new Map();   // the shoots of the last year, which carry the leaves; shoot index → twig index
  shoots.forEach((s, i) => { if(s.yr === last && M[s.metas[0]].alive){ twigOf.set(i, leafy.length); leafy.push(s); } });
  // the twigs each metamer carries, for the pipe model's widths
  const T = new Float64Array(M.length);
  for(let m = M.length - 1; m >= 0; m--){ const n = M[m]; if(!n.alive) continue;
    if(n.kids.every((k) => !M[k].alive) && twigOf.has(n.shoot)) T[m] = 1;
    for(const k of n.kids) if(M[k].alive) T[m] += T[k]; }
  const total = Math.max(1, rootKids.reduce((t, k) => t + (M[k].alive ? T[k] : 0), 0));
  // the main limb each metamer belongs to: the first side axis off the trunk it grew on (−1 on the trunk itself)
  const limbRoot = new Int32Array(M.length).fill(-1);
  for(let m = 0; m < M.length; m++){ const n = M[m];
    if(n.ord === 0) continue;
    limbRoot[m] = n.ord === 1 && (n.par < 0 || M[n.par].ord === 0) ? m : limbRoot[n.par]; }
  for(let m = 0; m < M.length; m++){ const n = M[m]; if(!n.alive) continue;
    const tw = twigOf.has(n.shoot) ? twigOf.get(n.shoot) : -1;
    // the wood's width is the pipe model's exactly: radius ∝ (twigs carried)^(1/Δ). The grove widens a segment by
    // taper^(level + f) with taper = kids^(−1/Δ), so level + f = log_kids(all twigs / twigs carried); `level` stays the axis order
    const f = Math.log(total/Math.max(1, T[m]))/Math.log(kids) - n.ord;
    out.seg.push({ a: n.a, b: n.b, level: n.ord, limb: -1, m, f0: f, f1: f, tw }); }
  for(const s of leafy){
    const tip = M[s.metas[s.metas.length - 1]], base = M[s.metas[0]];
    out.tw.push({ x: tip.b[0], y: tip.b[1], z: tip.b[2], limb: -1, m: s.metas[s.metas.length - 1], dx: tip.d[0], dy: tip.d[1], bx: base.a[0], by: base.a[1] });
    if(out.path){   // tip first, back along the wood to where its limb leaves the trunk; a shoot of the trunk's own, along itself only
      const pts = [tip.b];
      if(s.ord > 0) for(let m = s.metas[s.metas.length - 1]; m >= 0 && M[m].ord > 0; m = M[m].par) pts.push(M[m].a);
      else for(let i = s.metas.length - 1; i >= 0; i--) pts.push(M[s.metas[i]].a);
      out.path.push(pts);
    }
  }
  return { limbRoot, M };
}

// the main limbs, for the wind: `lpt` sectors of a balanced fan about the trunk, each holding the first side axes whose
// azimuth falls in it, and the twigs on them (a twig on the trunk itself goes by where it hangs). Writes each segment's and
// twig's limb (global: limbBase + sector), the fan's directions, a plan point per limb and the height it meets the trunk.
export function limbs(grown, out, lpt, limbBase, limbDir, limbRaw, limbAttach){
  const { limbRoot, M } = grown;
  const sectorOfAz = (x, y) => { const a = Math.atan2(y, x); return Math.min(lpt - 1, Math.floor(((a % TAU) + TAU) % TAU/TAU*lpt)); };
  const sector = (m) => { const r = limbRoot[m]; if(r >= 0) return sectorOfAz(M[r].d[0], M[r].d[1]); const n = M[m]; return sectorOfAz(n.b[0], n.b[1]); };
  const sx = new Float64Array(lpt), sy = new Float64Array(lpt), sn = new Float64Array(lpt), hz = new Float64Array(lpt), hn = new Float64Array(lpt);
  for(const t of out.tw){ const s = sector(t.m); t.limb = limbBase + s; sx[s] += t.x; sy[s] += t.y; sn[s]++; }
  for(const g of out.seg){ g.limb = limbBase + sector(g.m); }
  for(let m = 0; m < M.length; m++) if(limbRoot[m] === m && M[m].alive){ const s = sector(m); hz[s] += M[m].a[2]; hn[s]++; }
  let hAll = 0, nAll = 0; for(let s = 0; s < lpt; s++){ hAll += hz[s]; nAll += hn[s]; }
  for(let i = 0; i < lpt; i++){
    const az = (i + 0.5)/lpt*TAU;
    limbDir[2*(limbBase + i)] = Math.cos(az); limbDir[2*(limbBase + i) + 1] = Math.sin(az);
    limbRaw[2*i] = sn[i] ? sx[i]/sn[i]/0.6 : Math.cos(az); limbRaw[2*i + 1] = sn[i] ? sy[i]/sn[i]/0.6 : Math.sin(az);
    limbAttach[limbBase + i] = hn[i] ? hz[i]/hn[i] : nAll ? hAll/nAll : 0;
  }
}
