// ============================================================================
// The tree grown year by year from buds (komorebi-growth.js, growth_years): what must not fail silently. It is a pure function
// of the seed and the knobs; a tree grows on a stream of its own, so adding a tree moves no other; it fills the middle of the
// crown the grammar leaves bare; and its records are the grammar's, so the grove reads them unchanged. growth_years 0 is the
// grammar itself, which every other test of the grove holds.
// ============================================================================
import { test, expect } from "bun:test";
import { GROWTH, growBuds } from "../engine/canopy/komorebi-growth.js";
import { makeGrove, runChain, RUN_W } from "../engine/canopy/komorebi-grove.js";
import { DEFAULTS, TOPO_KEYS } from "../komorebi.js";
import { PRESETS } from "../presets.js";
import { mulberry32 } from "../engine/komorebi-math.js";

const spec = { years: 12, lambda: 0.52, angle: Math.PI/4, pitch: Math.PI/7, phyllo: 0, droop: -0.2, kids: 3 };
const grow = (over = {}, seed = 7) => { const out = { seg: [], tw: [], path: [] }; growBuds({ ...spec, ...over }, mulberry32(seed), out); return out; };

function grove(over) {
  const gl = new Proxy({}, { get(t, name) {
    if (name === "createBuffer") return () => ({ data: null });
    if (name === "bindBuffer") return (_, b) => { t.cur = b; };
    if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
    return () => ({}); } });
  const params = { ...DEFAULTS, faithful_canopy: true, leaves_per_cluster: 6, foliage_density: 1, ...over };
  const faith = {}, hub = { gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => true, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  return { g, faith, occ: hub.occ, leaves: Array.from((faith.rec?.leaves ?? faith.buf.data)) };
}

test("off by default, and a topology key: a year more or less is another tree", () => {
  expect(DEFAULTS.growth_years).toBe(0);
  expect(TOPO_KEYS).toContain("growth_years");
});

test("the same seed and knobs grow the same tree, to the bit", () => {
  const a = grow(), b = grow();
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  expect(JSON.stringify(grow({}, 8))).not.toBe(JSON.stringify(a));
});

test("the last growth year fits the metamer budget across the whole crown", () => {
  const out = { seg: [], tw: [] };
  const { M } = growBuds({ years: 20, lambda: 0.55, angle: 0.7, pitch: 0.2, phyllo: 0, droop: 0, kids: 6, bearing: 12 }, mulberry32(123), out);
  expect(M.length).toBe(GROWTH.cap);
  expect(out.tw).toHaveLength(12);
});

test("its records are the grammar's: every twig has a base and a heading, every segment an order and its twig, every path starts at its tip", () => {
  const out = grow();
  expect(out.tw.length).toBeGreaterThan(100);
  for (const t of out.tw) for (const k of ["x", "y", "z", "dx", "dy", "bx", "by"]) expect(Number.isFinite(t[k]), k).toBe(true);
  for (const s of out.seg) { expect(Number.isInteger(s.level)).toBe(true); expect(s.tw).toBeLessThan(out.tw.length); expect(Number.isFinite(s.f0)).toBe(true); }
  out.tw.forEach((t, i) => { expect(out.path[i][0]).toEqual([t.x, t.y, t.z]); expect(out.path[i].length).toBeGreaterThan(1); });
  // the trunk is grown, and stands on the ground
  expect(out.seg.some((s) => s.level === 0 && s.a[2] === 0)).toBe(true);
});

test("a second tree moves no leaf of the first", () => {
  const one = grove({ growth_years: 10, tree_count: 1 }), two = grove({ growth_years: 10, tree_count: 2 });
  const n = one.g.hier.nClusterTotal;
  expect(two.g.hier.nClusterTotal).toBeGreaterThan(n);
  // the first tree is the same tree: a second one shrinks every crown by one factor (the park's crowns share the frame), so
  // about its own trunk each twig of the first keeps its direction and its distance in that one ratio
  const off = (t) => [t.x - t.tx, t.y - t.ty];
  const [a0, b0] = [off(one.g.hier.twigs[0]), off(two.g.hier.twigs[0])], k = Math.hypot(...b0)/Math.hypot(...a0);
  for (let j = 0; j < n; j++) {
    const a = one.g.hier.twigs[j], b = two.g.hier.twigs[j];
    expect(a.tree).toBe(0); expect(b.tree).toBe(0);
    const [ax, ay] = off(a), [bx, by] = off(b);
    expect(Math.abs(bx - k*ax)).toBeLessThan(1e-6); expect(Math.abs(by - k*ay)).toBeLessThan(1e-6);
  }
});

test("it fills the middle of the crown the grammar leaves bare", () => {
  const share = (leaves, R) => { let inner = 0; const n = leaves.length/18; for (let i = 0; i < n; i++) if (Math.hypot(leaves[18*i], leaves[18*i + 1]) < 0.3*R) inner++; return inner/n; };
  const radius = (g) => g.hier.twigs.reduce((r, t) => Math.max(r, Math.hypot(t.x, t.y)), 0);
  const one = { tree_count: 1, limb_count: 11, leader_strength: 0, branch_levels: 3, branch_children: 3, inner_leaves: 0 };   // the grammar's own leaves, at the tips
  const grammar = grove({ ...one, growth_years: 0 }), buds = grove({ ...one, growth_years: 12 });
  const sg = share(grammar.leaves, radius(grammar.g)), sb = share(buds.leaves, radius(buds.g));
  console.log(`leaves within 0.3 of the crown radius: grammar ${(100*sg).toFixed(1)}%, grown from buds ${(100*sb).toFixed(1)}% (an even disk: 9%)`);
  expect(sg).toBeLessThan(0.05);
  expect(sb).toBeGreaterThan(0.15);
});

test("a grown cluster's leaves hang along the wood of the shoots it bundles, on stalks about it, each shoot carrying its share", () => {
  const params = { tree_count: 1, limb_count: 11, leader_strength: 0, branch_levels: 3, branch_children: 3, growth_years: 10, inner_leaves: 0, cluster_spread_m: 0.2, leaves_per_cluster: 30 };
  const { g, leaves } = grove(params);
  const byCluster = new Map();
  for (let i = 0; i < leaves.length/18; i++) { const j = Math.floor(leaves[18*i + 11]); if (!byCluster.has(j)) byCluster.set(j, []); byCluster.get(j).push(i); }
  const dist = (p, path) => {   // from p to the nearest point of a polyline (a flat run of points)
    let d = Infinity;
    for (let s = 0; s < path.length/3 - 1; s++) {
      const a = [path[3*s], path[3*s + 1], path[3*s + 2]], b = [path[3*s + 3], path[3*s + 4], path[3*s + 5]];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], L2 = ab[0]**2 + ab[1]**2 + ab[2]**2;
      const u = L2 > 0 ? Math.max(0, Math.min(1, (ap[0]*ab[0] + ap[1]*ab[1] + ap[2]*ab[2])/L2)) : 0;
      d = Math.min(d, Math.hypot(ap[0] - u*ab[0], ap[1] - u*ab[1], ap[2] - u*ab[2]));
    }
    return d;
  };
  let level = 0, far = 0, n = 0, bare = 0, shootsAll = 0;
  for (const [j, is] of byCluster) {
    const t = g.hier.twigs[j], bundle = g.hier.twigShoots[j], carried = new Array(bundle.length).fill(0);
    if (is.every((i) => leaves[18*i + 16] === t.z)) level++;
    for (const i of is) {
      const p = [leaves[18*i], leaves[18*i + 1], leaves[18*i + 16]], ds = bundle.map((path) => dist(p, path)), near = ds.indexOf(Math.min(...ds));
      if (ds[near] > 0.7*params.cluster_spread_m + 1e-9) far++;
      carried[near]++; n++;
    }
    shootsAll += bundle.length; bare += carried.filter((c) => c === 0).length;
  }
  console.log(`grown clusters with every leaf at its twig's height: ${level} of ${byCluster.size}; leaves beyond a stalk's reach of their bundle: ${far} of ${n}; shoots with no leaf: ${bare} of ${shootsAll}`);
  expect(level).toBe(0);
  expect(far).toBe(0);
  expect(bare / shootsAll, "every shoot carries its share (a stalk can land a leaf nearer a neighbour now and then)").toBeLessThan(0.05);
});

test("the leaf budget: a grown tree hangs the grammar's leaves for the same knobs, however many shoots it grew", () => {
  for (const knobs of [{ limb_count: 11, branch_levels: 3, branch_children: 3, phyllotaxis: "spiral" }, { limb_count: 7, branch_levels: 3, branch_children: 4, phyllotaxis: "opposite" }]) {
    const one = { tree_count: 1, leader_strength: 0.3, leaves_per_cluster: 20, ...knobs };
    const grammar = grove({ ...one, growth_years: 0 }), grown = grove({ ...one, growth_years: 12 });
    const twigs = knobs.limb_count * (knobs.phyllotaxis === "opposite" ? 2 : knobs.branch_children) ** (knobs.branch_levels - 1);
    expect(grammar.g.hier.twigs.length, "the grammar's twigs").toBe(twigs);
    expect(grown.g.hier.twigs.length, "the grown tree's clusters").toBe(twigs);
    expect(grown.leaves.length).toBe(grammar.leaves.length);
    const shoots = grown.g.hier.twigShoots.reduce((t, b) => t + b.length, 0);
    expect(shoots, "it grew more shoots than the grammar has twigs, and bundles them").toBeGreaterThan(twigs);
  }
});

// ---- the grown tree's forms (all opt-in): spur leaves, twig haze, sympodial and two-ranked shoots, the trunk's split, and the grove's thin twigs.
// Each is the tree without it while off, to the record and to the draw from the tree's stream, and shows its own form while on.
const counted = (over = {}, seed = 7) => {   // the tree, its metamers, and how many numbers it drew from its stream
  const out = { seg: [], tw: [], path: [], shoots: [] }, r = mulberry32(seed); let draws = 0;
  const { M } = growBuds({ ...spec, ...over }, () => { draws++; return r(); }, out);
  return { out, M, draws };
};
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0]*v[0] + u[1]*v[1] + u[2]*v[2])));
const FORMS = { leaf_years: 1, twig_haze: 0, sympodial: 0, trunk_split: 0, two_ranked: false, thin_twigs: false, trunk_base: false };

test("every form is off by default, travels as topology, and off is the tree without it: the same records and the same draws", () => {
  for (const [k, v] of Object.entries(FORMS)) { expect(DEFAULTS[k], k).toBe(v); expect(TOPO_KEYS, k).toContain(k); }
  const bare = counted();
  for (const off of [{ leafYears: 1 }, { leafYears: 0 }, { twigHaze: 0, hazeSeed: 5 }, { sympodial: 0 }, { trunkSplit: 0 }, { trunkSplit: 1 }, { twoRanked: false }]) {
    const t = counted(off);
    expect(JSON.stringify(t.out), JSON.stringify(off)).toBe(JSON.stringify(bare.out));
    expect(t.draws, JSON.stringify(off)).toBe(bare.draws);
  }
  // and in the grove: a grown look with every form at its default is the look without the keys, leaf for leaf and capsule for capsule
  const absent = Object.fromEntries(Object.keys(FORMS).map((k) => [k, undefined]));
  const a = grove({ growth_years: 8, tree_count: 2 }), b = grove({ growth_years: 8, tree_count: 2, ...absent });
  expect(a.leaves).toEqual(b.leaves);
  expect(JSON.stringify(a.faith.segRest)).toBe(JSON.stringify(b.faith.segRest));
});

test("spur leaves: the clusters hang along the shoots of the last N years, the same clusters and leaves, the last year's shoots all still among them", () => {
  const yearsOf = (t) => {   // the year each bearing shoot grew, by its tip (out.shoots holds the metamers' own points)
    const byTip = new Map(t.M.map((n, i) => [n.b, i])), last = Math.max(...t.M.filter((n) => n.alive).map((n) => n.yr)), count = new Map();
    for (const bundle of t.out.shoots) for (const s of bundle) { const yr = t.M[byTip.get(s[0])].yr; count.set(last - yr, (count.get(last - yr) || 0) + 1); }
    return count;   // years before the last → shoots bearing
  };
  const off = counted({ bearing: 99 }), on = counted({ bearing: 99, leafYears: 3 });
  const yOff = yearsOf(off), yOn = yearsOf(on);
  console.log(`bearing shoots by years before the last: leaf_years 1 ${JSON.stringify([...yOff])}, leaf_years 3 ${JSON.stringify([...yOn])}`);
  expect([...yOff.keys()]).toEqual([0]);
  expect([...yOn.keys()].sort()).toEqual([0, 1, 2]);
  expect(yOn.get(0), "the last year's shoots all bear, as before").toBe(yOff.get(0));
  expect(on.out.tw.length, "as many clusters").toBe(off.out.tw.length);
  expect(JSON.stringify(on.out.seg.map((s) => [s.a, s.b, s.level, s.f0])), "the wood is the same wood").toBe(JSON.stringify(off.out.seg.map((s) => [s.a, s.b, s.level, s.f0])));
  // in the grove: the look's leaves, as many, hung elsewhere
  const one = { tree_count: 1, growth_years: 10, inner_leaves: 0 };
  const g1 = grove({ ...one, leaf_years: 1 }), g4 = grove({ ...one, leaf_years: 4 });
  expect(g4.leaves.length).toBe(g1.leaves.length);
  expect(g4.leaves).not.toEqual(g1.leaves);
  const young = { ...one, growth_years: 5, branch_levels: 4, limb_count: 10, branch_children: 3 };
  const y1 = grove({ ...young, leaf_years: 1 }), y5 = grove({ ...young, leaf_years: 5 });
  expect(y5.leaves.length).toBe(y1.leaves.length);
  expect(y5.leaves).not.toEqual(y1.leaves);
});

test("twig haze: kids side twigs on each of the last year's shoots, that many orders deep, each finer than its stem, on a stream of its own", () => {
  const off = counted(), n0 = off.out.seg.length, M = off.M;
  const last = Math.max(...M.filter((n) => n.alive).map((n) => n.yr));
  const first = new Map(); M.forEach((n, i) => { if (!first.has(n.shoot)) first.set(n.shoot, i); });
  const newest = [...first.values()].filter((i) => M[i].alive && M[i].yr === last).length;
  const added = { 1: 3, 2: 3 + 9, 3: 3 + 9 + 27 };   // kids = 3 a stem, an order deeper each step
  for (const h of [1, 2, 3]) {
    const on = counted({ twigHaze: h, hazeSeed: 11 });
    expect(on.draws, "the tree's own stream is not drawn").toBe(off.draws);
    for (const k of ["tw", "path", "shoots"]) expect(JSON.stringify(on.out[k]), k).toBe(JSON.stringify(off.out[k]));
    expect(JSON.stringify(on.out.seg.slice(0, n0)), "the tree's wood comes first, untouched").toBe(JSON.stringify(off.out.seg));
    const haze = on.out.seg.slice(n0);
    expect(haze.length, `haze ${h}`).toBe(newest*added[h]);
    for (const s of haze) expect(s.haze).toBe(true);
    if (h === 2) {   // under sympodial shoots too, a haze twig is one straight capsule
      const zs = counted({ sympodial: 1 }), zn = zs.out.seg.length, zon = counted({ sympodial: 1, twigHaze: h, hazeSeed: 11 });
      const zl = Math.max(...zs.M.filter((n) => n.alive).map((n) => n.yr)), zf = new Map(); zs.M.forEach((n, i) => { if (!zf.has(n.shoot)) zf.set(n.shoot, i); });
      expect(zon.out.seg.length - zn, "one capsule a haze twig under sympodial").toBe([...zf.values()].filter((i) => zs.M[i].alive && zs.M[i].yr === zl).length*added[h]);
    }
    const byOrder = new Map();
    for (const s of haze) {
      const j = s.level - M[s.m].ord, stem = M[s.m];
      expect(j).toBeGreaterThanOrEqual(1); expect(j).toBeLessThanOrEqual(h);
      expect(stem.yr, "only on the last year's shoots").toBe(last);
      byOrder.set(j, (byOrder.get(j) || 0) + 1);
    }
    for (let j = 1; j <= h; j++) expect(byOrder.get(j), `order ${j}`).toBe(newest*3**j);
  }
  // finer each order: the pipe model's exponent (level + f) grows with the order, from the shoot's own
  const on = counted({ twigHaze: 3, hazeSeed: 11 }), own = new Map(on.out.seg.slice(0, n0).map((s) => [s.m, s.level + s.f0]));
  for (const s of on.out.seg.slice(n0)) expect(s.level + s.f0).toBeGreaterThan(own.get(s.m) + (s.level - M[s.m].ord) - 1e-9);
  expect(JSON.stringify(counted({ twigHaze: 7, hazeSeed: 11 }).out), "at most three orders").toBe(JSON.stringify(on.out));
});

test("the twig haze is fine wood whatever the order of the shoot it rides: the analytic occluder, trunk and main limbs, holds the same wood with it as without", () => {
  const one = { tree_count: 1, growth_years: 10, inner_leaves: 0, faithful_canopy: false };
  const off = grove(one).occ, on = grove({ ...one, twig_haze: 2 }).occ;
  expect(on.want).toBe(off.want);
  expect(JSON.stringify(on.rest)).toBe(JSON.stringify(off.rest));
});

test("sympodial: the free orders turn at every node, the held limbs and the trunk do not, by the share asked", () => {
  const turns = (t) => {   // the mean turn from one internode to the next within a shoot, held orders and free
    const sum = { held: 0, free: 0 }, n = { held: 0, free: 0 };
    for (const c of t.M) { if (!c.alive || c.par < 0) continue; const p = t.M[c.par]; if (p.shoot !== c.shoot) continue;
      const k = c.ord > 2 ? "free" : "held"; sum[k] += angle(p.d, c.d); n[k]++; }
    return { held: sum.held/n.held, free: sum.free/n.free };
  };
  const off = turns(counted()), half = turns(counted({ sympodial: 0.5 })), on = turns(counted({ sympodial: 1 }));
  console.log(`mean turn at a node (rad): held ${off.held.toFixed(3)} → ${on.held.toFixed(3)}; free ${off.free.toFixed(3)} → ${half.free.toFixed(3)} → ${on.free.toFixed(3)}`);
  expect(on.free - off.free).toBeGreaterThan(0.15);
  expect(half.free).toBeGreaterThan(off.free); expect(half.free).toBeLessThan(on.free);
  expect(Math.abs(on.held - off.held), "the held limbs stay straight").toBeLessThan(0.03);
});

test("two-ranked: one side bud a node, alternately either side of its shoot across the horizontal, in place of any phyllotaxis", () => {
  const across = (d) => { const ref = Math.abs(d[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
    const u = [d[1]*ref[2] - d[2]*ref[1], d[2]*ref[0] - d[0]*ref[2], d[0]*ref[1] - d[1]*ref[0]], l = Math.hypot(...u); return u.map((x) => x/l); };
  const sides = (M) => {   // each node's side shoot: which side of the shoot's horizontal across it leaves on; and the most a node carries
    const side = new Map(), per = new Map();
    for (const c of M) { if (!c.alive || c.par < 0) continue; const p = M[c.par]; if (c.ord !== p.ord + 1) continue;
      per.set(c.par, (per.get(c.par) || 0) + 1);
      if (!side.has(c.par)) { const u = across(p.d); side.set(c.par, Math.sign(c.d[0]*u[0] + c.d[1]*u[1] + c.d[2]*u[2])); } }
    let n = 0, alt = 0;
    M.forEach((c, i) => { if (c.alive && c.par >= 0 && M[c.par].shoot === c.shoot && side.has(i) && side.has(c.par)) { n++; if (side.get(i) !== side.get(c.par)) alt++; } });
    return { alternate: alt/n, most: Math.max(...per.values()) };
  };
  const ranked = counted({ twoRanked: true });
  for (const phyllo of [1, 2]) expect(JSON.stringify(counted({ phyllo, twoRanked: true }).out), `phyllotaxis ${phyllo}`).toBe(JSON.stringify(ranked.out));
  const on = sides(ranked.M), spiral = sides(counted().M), opposite = sides(counted({ phyllo: 2 }).M);
  console.log(`neighbouring nodes whose side shoots leave on opposite sides: two-ranked ${on.alternate.toFixed(2)}, spiral ${spiral.alternate.toFixed(2)}, opposite ${opposite.alternate.toFixed(2)}`);
  expect(on.alternate).toBeGreaterThan(0.9);
  expect(spiral.alternate).toBeLessThan(0.8); expect(opposite.alternate).toBeLessThan(0.8);
  expect(on.most).toBe(1); expect(opposite.most).toBe(2);
});

test("the trunk's split: that many stems of the trunk's own order leave one node at the fork's height, at even azimuths, and nothing branches off the trunk below it", () => {
  const trunkKids = (M, i) => M.filter((k) => k.alive && k.par === i && k.ord === 0);
  const lowest = (M) => Math.min(...M.filter((n) => n.alive && n.ord === 1 && n.par >= 0 && M[n.par].ord === 0).map((n) => M[n.par].b[2]));
  const off = counted().M;
  expect(off.every((_n, i) => trunkKids(off, i).length <= 1), "one trunk").toBe(true);
  expect(lowest(off), "the clear trunk alone lets limbs leave below the fork's height").toBeLessThan(10);
  for (const stems of [2, 3, 4]) {
    const M = counted({ trunkSplit: stems }).M;
    const forks = M.map((_n, i) => i).filter((i) => trunkKids(M, i).length > 1);
    expect(forks.length, `${stems} stems: one fork`).toBe(1);
    const f = M[forks[0]], kids = trunkKids(M, forks[0]);
    expect(kids.length).toBe(stems);
    expect(f.a[2] < 10 && f.b[2] >= 10, "the first node at the fork's height").toBe(true);
    expect(lowest(M), "nothing leaves the trunk below the fork").toBeGreaterThanOrEqual(10);
    const az = kids.map((k) => Math.atan2(k.d[1], k.d[0])).sort((a, b) => a - b), even = 2*Math.PI/stems;
    az.forEach((a, i) => { const gap = ((i + 1 < az.length ? az[i + 1] : az[0] + 2*Math.PI) - a); expect(gap).toBeGreaterThan(0.5*even); expect(gap).toBeLessThan(1.5*even); });
    for (const k of kids) { const lean = Math.acos(k.d[2]); expect(lean).toBeGreaterThan(0.1); expect(lean).toBeLessThan(0.7); }
  }
  expect(JSON.stringify(counted({ trunkSplit: 9 }).out), "at most six").toBe(JSON.stringify(counted({ trunkSplit: 6 }).out));
});

test("thin twigs: the grown wood keeps its pipe-model width down to 2 mm where the floor held every twig at 8–12 mm; the trunk, the limbs and the leaves are untouched", () => {
  const look = { tree_count: 1, growth_years: 10, trunk_radius_m: 0.04 };
  const off = grove(look), on = grove({ ...look, thin_twigs: true });
  expect(on.leaves).toEqual(off.leaves);
  const A = off.faith.segRest, B = on.faith.segRest;
  expect(B.length).toBe(A.length);
  let thinner = 0, floor = 0;
  A.forEach((a, i) => {
    const b = B[i];
    for (const k of ["ax", "ay", "bx", "by", "ha", "hb", "level", "clump"]) expect(b[k], k).toBe(a[k]);
    expect(a.ra).toBeGreaterThanOrEqual(0.012); expect(a.rb).toBeGreaterThanOrEqual(0.008);
    expect(b.ra).toBeGreaterThanOrEqual(0.002); expect(b.rb).toBeGreaterThanOrEqual(0.002);
    expect(b.ra).toBeLessThanOrEqual(a.ra); expect(b.rb).toBeLessThanOrEqual(a.rb);
    if (a.ra > 0.012) expect(b.ra, "wood above the old floor keeps its width").toBe(a.ra);
    if (b.rb < 0.008) thinner++;
    if (b.rb === 0.002) floor++;
  });
  console.log(`capsules thinner than the old 8 mm floor: ${thinner} of ${B.length}, ${floor} at 2 mm`);
  expect(thinner).toBeGreaterThan(B.length/2);
  expect(floor).toBeGreaterThan(0);
});

// TWIG JOINTS (twig_joints; komorebi-grove.js runJoints). A grown cluster leaves the rest of the tree at many points, and turned whole about its twig's base its
// wood slid off the branches it grows from. Every junction of a cluster's wood, its two pieces turned as fillSwayedSegs turns them: about the piece's joint by its
// cluster's bend, then by each outer run's, each cluster bent by an angle of its own. The two shipped looks grown from buds: a bare elm (its clusters leave older
// wood only) and a ginkgo, whose spurs of five years leaf off one another, three clusters deep.
const shipped = (name, over) => {
  const gl = new Proxy({}, { get(t, n) { return n === "createBuffer" ? () => ({ data: null }) : n === "bindBuffer" ? (_, b) => { t.cur = b; } : n === "bufferData" ? (_, d) => { if (t.cur) t.cur.data = d; } : () => ({}); } });
  const params = { ...DEFAULTS, ...PRESETS[name], ...over }, faith = {};
  const g = makeGrove({ gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => true, occ: {}, faith, sky: { start: [], count: [] } }).buildGrove(null);
  return { g, faith, params };
};
const bendOf = (c) => 0.05 + 0.1*((c*2654435761 >>> 0)/4294967296);   // a cluster's own bend, rad
const turnAbout = (t, jx, jy, p) => { const c = Math.cos(t), s = Math.sin(t), dx = p[0] - jx, dy = p[1] - jy; return [jx + c*dx - s*dy, jy + s*dx + c*dy]; };
const turned = (s, p) => { let q = turnAbout(bendOf(s.clump), s.tbx, s.tby, p); if (s.up) for (let u = 0; u < s.up.length; u += 3) q = turnAbout(bendOf(s.up[u]), s.up[u + 1], s.up[u + 2], q); return q; };
function junctions(rest) {   // every piece of a cluster's wood against the piece its start lies on: how far apart the two land
  const C = 0.25, grid = new Map(), cell = (x, y) => `${Math.floor(x/C)},${Math.floor(y/C)}`;
  rest.forEach((s, i) => { for (let x = Math.floor(Math.min(s.ax, s.bx)/C); x <= Math.floor(Math.max(s.ax, s.bx)/C); x++) for (let y = Math.floor(Math.min(s.ay, s.by)/C); y <= Math.floor(Math.max(s.ay, s.by)/C); y++) { const k = `${x},${y}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(i); } });
  const out = { n: 0, open: 0, cross: 0, max: 0 };
  rest.forEach((s, i) => {
    if (s.clump < 0) return;
    for (const j of grid.get(cell(s.ax, s.ay)) ?? []) {
      const q = rest[j], e = [q.bx - q.ax, q.by - q.ay, q.hb - q.ha], ll = e[0]**2 + e[1]**2 + e[2]**2;
      if (j === i || !(ll > 0)) continue;
      const f = Math.max(0, Math.min(1, ((s.ax - q.ax)*e[0] + (s.ay - q.ay)*e[1] + (s.ha - q.ha)*e[2])/ll));
      if (!(f > 1e-6) || Math.hypot(q.ax + e[0]*f - s.ax, q.ay + e[1]*f - s.ay, q.ha + e[2]*f - s.ha) > 1e-6) continue;
      const turn = (p) => q.clump >= 0 ? turned(q, p) : p, qa = turn([q.ax, q.ay]), qb = turn([q.bx, q.by]), m = turned(s, [s.ax, s.ay]);
      const gap = Math.hypot(m[0] - qa[0] - (qb[0] - qa[0])*f, m[1] - qa[1] - (qb[1] - qa[1])*f);
      out.n++; if (q.clump >= 0 && q.clump !== s.clump) out.cross++;
      if (gap > 1e-6) out.open++;
      out.max = Math.max(out.max, gap);
      return;
    }
  });
  return out;
}

test("twig joints: off by default, and off, the grove is the one grown before it, with no joint, no run and no buffer; the two grown looks ship it on", () => {
  expect(DEFAULTS.twig_joints).toBe(false);
  expect(PRESETS["glebe sunset"].twig_joints && PRESETS["yellow ginkgo"].twig_joints).toBe(true);
  const off = shipped("yellow ginkgo", { twig_joints: false }), on = shipped("yellow ginkgo", { twig_joints: true });
  expect(off.faith.runOn).toBe(false);
  expect(off.faith.runBuf ?? null).toBe(null);
  expect(off.faith.runTex ?? null).toBe(null);
  expect(off.g.hier.runs).toBe(null);
  expect(off.faith.segRest.some((s) => s.up)).toBe(false);
  off.faith.segRest.forEach((s) => { if (s.clump >= 0) { expect(s.tbx).toBe(off.g.hier.twigs[s.clump].bx); expect(s.tby).toBe(off.g.hier.twigs[s.clump].by); } });
  expect(Array.from(on.faith.buf.data), "the leaves hang where they did").toEqual(Array.from(off.faith.buf.data));
  const wood = (g) => g.faith.segRest.map((s) => [s.ax, s.ay, s.bx, s.by, s.ha, s.hb, s.ra, s.rb, s.clump]);
  expect(wood(on), "the wood at rest is the same wood").toEqual(wood(off));
  expect(shipped("park 1", { twig_joints: true }).faith.runOn, "a grammar tree leaves the tree at its twig's base alone: nothing to do").toBe(false);
});

test("twig joints: every junction of a grown cluster's wood stays closed as the clusters bend, where turned whole about the twig's base they came apart", () => {
  for (const name of ["glebe sunset", "yellow ginkgo"]) {
    const off = junctions(shipped(name, { twig_joints: false }).faith.segRest), on = junctions(shipped(name, { twig_joints: true }).faith.segRest);
    console.log(`${name}: ${on.n} junctions, ${on.cross} off another cluster's wood; open off ${off.open} (widest ${(off.max*100).toFixed(1)} cm), on ${on.open}`);
    expect(off.open, "the fault is there to fix").toBeGreaterThan(off.n/50);
    expect(on.n).toBe(off.n);
    expect(on.open).toBe(0);
  }
});

test("twig joints: each leaf turns with the run of wood it hangs beside, by the same joint and the same chain of outer turns", () => {
  const { g, faith, params } = shipped("yellow ginkgo", { twig_joints: true }), T = g.hier.runs.table, L = faith.buf.data, R = faith.runBuf.data, n = L.length/18;
  expect(faith.runOn).toBe(true);
  expect(R.length).toBe(3*n);
  expect(faith.runTex).toBeTruthy();
  const byCluster = new Map();
  faith.segRest.forEach((s) => { if (s.clump >= 0) (byCluster.get(s.clump) ?? byCluster.set(s.clump, []).get(s.clump)).push(s); });
  const reach = params.cluster_spread_m*0.7 + 1e-4;   // a leaf hangs off its shoot's wood by at most this (shootPlace), in float32
  const key = (a) => JSON.stringify(a ? Array.from(a, Math.fround) : null);
  let carried = 0;
  for (let i = 0; i < n; i++) {
    const j = Math.round(L[18*i + 11]), x = L[18*i], y = L[18*i + 1], o = R[3*i + 2];   // the cluster as the shader reads it: int(iC.w + 0.5)
    const chain = o >= 0 ? [T[RUN_W*o], T[RUN_W*o + 1], T[RUN_W*o + 2], ...(runChain(T, o) ?? [])] : null;   // the leaf's outer run, then that run's own outer turns
    if (o >= 0) carried++;
    const beside = (byCluster.get(j) ?? []).some((s) => {
      if (Math.fround(s.tbx) !== R[3*i] || Math.fround(s.tby) !== R[3*i + 1] || key(s.up) !== key(chain)) return false;
      const ex = s.bx - s.ax, ey = s.by - s.ay, ll = ex*ex + ey*ey, f = ll > 0 ? Math.max(0, Math.min(1, ((x - s.ax)*ex + (y - s.ay)*ey)/ll)) : 0;
      return Math.hypot(s.ax + ex*f - x, s.ay + ey*f - y) <= reach;
    });
    if (!beside) expect(beside, `leaf ${i} of cluster ${j}`).toBe(true);
  }
  console.log(`yellow ginkgo: ${n} leaves, ${carried} of them on runs another cluster's turn carries`);
  expect(carried).toBeGreaterThan(n/4);
});
