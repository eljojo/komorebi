// ============================================================================
// The tree grown year by year from buds (komorebi-growth.js, growth_years): what must not fail silently. It is a pure function
// of the seed and the knobs; a tree grows on a stream of its own, so adding a tree moves no other; it fills the middle of the
// crown the grammar leaves bare; and its records are the grammar's, so the grove reads them unchanged. growth_years 0 is the
// grammar itself, which every other test of the grove holds.
// ============================================================================
import { test, expect } from "bun:test";
import { growBuds } from "./komorebi-growth.js";
import { makeGrove } from "./komorebi-grove.js";
import { DEFAULTS, TOPO_KEYS } from "./komorebi.js";
import { mulberry32 } from "./komorebi-math.js";

const spec = { years: 12, lambda: 0.52, angle: Math.PI/4, phyllo: 0, droop: -0.2, kids: 3 };
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
  const one = { tree_count: 1, limb_count: 11, leader_strength: 0, branch_levels: 3, branch_children: 3 };
  const grammar = grove({ ...one, growth_years: 0 }), buds = grove({ ...one, growth_years: 12 });
  const sg = share(grammar.leaves, radius(grammar.g)), sb = share(buds.leaves, radius(buds.g));
  console.log(`leaves within 0.3 of the crown radius: grammar ${(100*sg).toFixed(1)}%, grown from buds ${(100*sb).toFixed(1)}% (an even disk: 9%)`);
  expect(sg).toBeLessThan(0.05);
  expect(sb).toBeGreaterThan(0.15);
});
