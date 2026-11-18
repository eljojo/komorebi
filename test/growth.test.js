// ============================================================================
// The tree grown year by year from buds (komorebi-growth.js, growth_years): what must not fail silently. It is a pure function
// of the seed and the knobs; a tree grows on a stream of its own, so adding a tree moves no other; it fills the middle of the
// crown the grammar leaves bare; and its records are the grammar's, so the grove reads them unchanged. growth_years 0 is the
// grammar itself, which every other test of the grove holds.
// ============================================================================
import { test, expect } from "bun:test";
import { growBuds } from "../komorebi-growth.js";
import { makeGrove } from "../komorebi-grove.js";
import { DEFAULTS, TOPO_KEYS } from "../komorebi.js";
import { mulberry32 } from "../komorebi-math.js";

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
  return { g, leaves: Array.from(faith.buf.data) };
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
