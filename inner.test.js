// ============================================================================
// Leaves on the older wood, so the crown is full (`inner_leaves`, spec §4.5 "A full crown"). From above a grown crown is a wheel: a ring of leaves at the shell,
// a core a third as dense, bare limbs for spokes, because only a terminal twig bears leaves. Real crowns carry shade leaves on the wood behind (short shoots),
// thinning inward and never to zero. The claims worth holding loudly are the ones that fail SILENTLY: a gate that leaks into every shipped look, a hash that
// reaches the growth stream, a leaf that moves without its height and layer, a preview that places leaves somewhere the cast does not, a share that pops
// instead of gliding (§5.3). (The drop.test.js and tree.test.js pattern: the stub-GL rig, then the laws, then the one place that applies them.)
// ============================================================================
import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { CANOPY_KEYS, DEFAULTS, SEASON_KEYS, TOPO_KEYS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import * as LEAF from "./komorebi-leaf.js";
import * as MAZE from "./leaf-maze.js";
import * as GROVE from "./komorebi-grove.js";   // a namespace, not names: placeLeaf and INNER_SALT arrive with the change, and a missing named import would fail this whole file at link time instead of test by test
import { makeEditorTools } from "./komorebi-editor-tools.js";
import { makeMotion } from "./komorebi-motion.js";
import { PRESETS, TREE_SPECIES } from "./presets.js";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const SF = 18, SL = 17, SREC = 11;   // faithful record, layer record, season record
const FALL = { phenology: 0.85, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, turn_exposure: 1, leaf_drop: 1 };   // mid-turn and mid-fade: lit, ordered, dropping

// ---- the groves (the tree.test.js rig) ------------------------------------------------------------------------------------------------
const stubGl = () => new Proxy({}, {
  get(t, name) {
    if (name === "createBuffer") return () => ({ data: null });
    if (name === "bindBuffer") return (_, b) => { t.cur = b; };
    if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
    return () => ({});
  },
});
function growWith(over, faithful = false, { keep = false, drop = [], maxTex = 16384 } = {}) {
  const gl = stubGl();
  const params = { ...DEFAULTS, ...over };
  for (const k of drop) delete params[k];
  const faith = {}, hub = { gl, params, MAX_TEX: maxTex, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  const g = GROVE.makeGrove(hub).buildGrove(null, { keepSeason: keep });
  return { params, g, faith, litter: g.litter, layers: g.layerVAO.map((l) => Float32Array.from(l.buf.data)), faithLeaves: Float32Array.from(faith.buf.data), leafW: g.hier.leafW, rec: g.season ? g.season.rec : null, season: g.season };
}
const memo = new Map();
const grow = (over, faithful = false, opts = {}) => {   // the dense groves cost a moment: build each once
  const key = JSON.stringify([over, faithful, opts]);
  if (!memo.has(key)) memo.set(key, growWith(over, faithful, opts));
  return memo.get(key);
};
const bits = (a) => new Uint32Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
const firstDiff = (a, b) => {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  const x = bits(a), y = bits(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `first bit difference at ${i}`;
  return null;
};
const PARK = { ...PRESETS["park 1"] }, AFT = { ...PRESETS["afternoon 7"] }, MONTE = { ...PRESETS.montebello };
const small = (over) => ({ ...PRESETS["afternoon 7"], tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, ...over });
const dense = (over) => ({ ...PRESETS["afternoon 7"], leaves_per_cluster: 40, foliage_density: 1, tree_count: 3, ...over });
function sameGrove(label, a, b) {
  a.layers.forEach((l, i) => { expect(firstDiff(l, b.layers[i]), `${label}: layer ${i}`).toBe(null); });
  expect(a.layers.length, `${label}: layers`).toBe(b.layers.length);
  expect(firstDiff(a.faithLeaves, b.faithLeaves), `${label}: faithful buffer`).toBe(null);
  expect(JSON.stringify(a.litter), `${label}: litter`).toBe(JSON.stringify(b.litter));
  if (b.leafW === null) expect(a.leafW, `${label}: leafW`).toBe(null); else expect(firstDiff(a.leafW, b.leafW), `${label}: leafW`).toBe(null);
  expect(firstDiff(a.rec, b.rec), `${label}: the season record`).toBe(null);
}

// ---- 1. the knob ships off, a canopy knob the cache key carries ---------------------------------------------------------------------
test("ships off: inner_leaves 0 in DEFAULTS; a canopy knob (it moves leaves, so it morphs) the cache key carries; not a season key, not topology (the smoothstep morphs the indices)", () => {
  expect(DEFAULTS.inner_leaves).toBe(0);
  expect(CANOPY_KEYS).toContain("inner_leaves");
  expect(GROVE.GROVE_READS).toContain("inner_leaves");
  expect(SEASON_KEYS).not.toContain("inner_leaves");
  expect(TOPO_KEYS).not.toContain("inner_leaves");
  const reads = GROVE.GROVE_READS, at = reads.indexOf("inner_leaves");
  expect(reads[at - 1] < "inner_leaves" && "inner_leaves" < reads[at + 1], "the key list is kept in order: foliage_density < inner_leaves < layer_count").toBe(true);
  expect(CANOPY_KEYS.indexOf("inner_leaves"), "beside cluster_spread_m, the knob it extends").toBe(CANOPY_KEYS.indexOf("cluster_spread_m") + 1);
});

test("INNER_SALT is 3·0x9E3779B9 mod 2^32 (the golden gamma's next multiple after TREE_SALT's 2·), differs from every other stream's salt, and is named in komorebi-grove.js alone", () => {
  expect(GROVE.INNER_SALT).toBe((3 * 0x9E3779B9) % 2 ** 32);
  expect(GROVE.INNER_SALT).toBe(0xDAA66D2B);
  const salts = [MAZE.AREOLE_SALT, LEAF.VARIANT_SALT, LEAF.OUTLINE_SALT, LEAF.FLIP_SALT, 0x2B9D4F6E /* litter */, 0x51ED270B /* pigment */, 0x7A3C91D5 /* drop */, 0x5bd1e995 /* wind */, 0x5EED /* growth */, math.TREE_SALT, GROVE.INNER_SALT];
  expect(new Set(salts).size).toBe(salts.length);
  const files = readdirSync(".").filter((f) => /\.(js|mjs|html)$/.test(f) && !/\.test\.js$/.test(f));
  expect(files.length).toBeGreaterThan(20);
  expect(files.filter((f) => /DAA66D2B/i.test(readFileSync(f, "utf8"))), "one place names the salt").toEqual(["komorebi-grove.js"]);
});

// ---- 2. the gate, to the bit ----------------------------------------------------------------------------------------------------------
const GATES = [
  ["park 1 (faithful)", PARK, true],
  ["afternoon 7 (layer)", AFT, false],
  ["montebello (lit + dropping, faithful)", MONTE, true],
  ["small, a marginal leaf and a marginal tree, lit + dropping (layer)", small({ tree_count: 2.4, ...FALL }), false],
  ["small, a marginal leaf and a marginal tree, lit + dropping (faithful)", small({ tree_count: 2.4, ...FALL }), true],
];
test("at 0 every buffer is the build that never heard of the key: layers, faithful, litter, leafW and the season record — park 1, afternoon 7, montebello, small with marginal leaves", () => {
  for (const [name, cfg, faithful] of GATES) {
    const none = grow(cfg, faithful, { keep: true, drop: ["inner_leaves"] }), shut = grow({ ...cfg, inner_leaves: 0 }, faithful, { keep: true });
    expect(none.params.inner_leaves, `${name}: absent`).toBeUndefined();
    expect(shut.params.inner_leaves).toBe(0);
    expect(none.rec.length, `${name}: the record is there to compare`).toBeGreaterThan(1000);
    sameGrove(name, shut, none);
    for (const k of ["hMin", "hMax", "pminx", "pmaxx", "pminy", "pmaxy"]) expect(Object.is(shut.faith[k], none.faith[k]), `${name}: the cast frame's faith.${k}`).toBe(true);
    expect(firstDiff(shut.faith.binH, none.faith.binH), `${name}: faith.binH`).toBe(null);
  }
  const m = grow(MONTE, true, { keep: true, drop: ["inner_leaves"] });
  expect(m.litter.length, "montebello's leaves have let go (not vacuous)").toBeGreaterThan(100);
  expect(m.leafW.some((w) => w > 0 && w < 1), "...some are mid-fade").toBe(true);
});

// The OLD placement, copied from the hang loop as it stood at 9d8f3ad: the claim at 0 is "this expression", not an equivalent one. The gate test above compares two builds of the NEW code;
// this one holds the new code to the old, leaf by leaf, on a platform-independent oracle (the grove's own twigs, the grove's own stream).
function oldPlacement(g, params, faithful) {
  const pcF = Math.max(0, params.leaves_per_cluster * params.foliage_density), pcInt = Math.floor(pcF), nLeaf = pcInt + (pcF - pcInt > 1e-4 ? 1 : 0), out = [];
  g.hier.twigs.forEach((t, j) => {
    const rng = math.mulberry32(math.hash3(params.seed >>> 0, j, 101)), gauss = math.makeGauss(rng), cx = t.x, cy = t.y;
    let tdx = t.dx || 0, tdy = t.dy || 0; const tdl = Math.hypot(tdx, tdy), tHasDir = tdl > 1e-4; if (tHasDir) { tdx /= tdl; tdy /= tdl; }
    for (let k = 0; k < nLeaf; k++) {
      const g1 = gauss(), g2 = gauss(); for (let q = 0; q < 7; q++) rng();   // size, tilt, angle, the orbit pair, orient, phase: the grove's other draws
      const hug = faithful && tHasDir;
      const x = hug ? cx - Math.abs(g1) * params.cluster_spread_m * 1.5 * tdx - g2 * params.cluster_spread_m * 0.4 * tdy : cx + g1 * params.cluster_spread_m;
      const y = hug ? cy - Math.abs(g1) * params.cluster_spread_m * 1.5 * tdy + g2 * params.cluster_spread_m * 0.4 * tdx : cy + g2 * params.cluster_spread_m;
      out.push({ j, k, x, y, z: t.z, layer: t.layer });
    }
  });
  return out;
}
test("at 0 a leaf is where the old hang loop put it, on its twig's height and layer: x, y, z and the layer buffer, leaf by leaf, whole leaves and marginal ones", () => {
  for (const [name, cfg, faithful] of [["park 1", PARK, true], ["afternoon 7", AFT, false], ["small, marginal", small({ tree_count: 2.4 }), true], ["small, marginal, layer", small({ tree_count: 2.4 }), false]]) {
    const r = grow({ ...cfg, inner_leaves: 0 }, faithful), old = oldPlacement(r.g, r.params, faithful), F = r.faithLeaves;
    expect(F.length / SF, `${name}: a leaf each`).toBe(old.length);
    const perLayer = r.layers.map(() => []);
    old.forEach((l, i) => {
      if (!Object.is(F[i * SF], Math.fround(l.x)) || !Object.is(F[i * SF + 1], Math.fround(l.y)) || !Object.is(F[i * SF + 16], Math.fround(l.z))) throw new Error(`${name}: leaf ${l.j}/${l.k} is not where the old loop put it`);
      perLayer[l.layer].push(l);
    });
    perLayer.forEach((ls, li) => {
      expect(r.layers[li].length / SL, `${name}: layer ${li} holds the leaves of the twigs binned to it`).toBe(ls.length);
      ls.forEach((l, i) => { if (!Object.is(r.layers[li][i * SL], Math.fround(l.x)) || !Object.is(r.layers[li][i * SL + 1], Math.fround(l.y))) throw new Error(`${name}: layer ${li} leaf ${l.j}/${l.k}`); });
    });
  }
});

test("the gate is a gate: at 0 (or absent) placeLeaf never touches the path, and the hash with INNER_SALT sits behind it in the source", () => {
  const twig = { x: 1, y: 2, z: 3, dx: 1, dy: 0.5, bx: 0.7, by: 1.8, tree: 0, layer: 0 };
  const poison = Float64Array.from([1, 2, 3, NaN, NaN, NaN, NaN, NaN, NaN]);
  const hier = { twigs: [twig], twigPath: [poison], twigPathLen: Float64Array.from([NaN]) };
  for (const faithful of [false, true]) for (const inner of [0, undefined, -0.3, NaN]) {
    const P = { ...DEFAULTS, seed: 77, inner_leaves: inner }, out = [0, 0, 0], sp = P.cluster_spread_m, g1 = 0.8, g2 = -1.1;
    GROVE.placeLeaf(hier, 0, g1, g2, 4, P, faithful, out);
    const tdl = Math.hypot(1, 0.5), tdx = 1 / tdl, tdy = 0.5 / tdl;   // the old expressions, in the old order
    const x = faithful ? 1 - Math.abs(g1) * sp * 1.5 * tdx - g2 * sp * 0.4 * tdy : 1 + g1 * sp, y = faithful ? 2 - Math.abs(g1) * sp * 1.5 * tdy + g2 * sp * 0.4 * tdx : 2 + g2 * sp;
    expect([out[0], out[1], out[2]], `inner_leaves ${inner}, faithful ${faithful}: the old placement, the poisoned path unread`).toEqual([x, y, 3]);
    expect(Object.is(out[0], x) && Object.is(out[1], y)).toBe(true);
  }
  const src = read("./komorebi-grove.js");
  const at = src.indexOf("export function placeLeaf(");
  expect(at, "placeLeaf is exported from the grove").toBeGreaterThan(-1);
  const body = src.slice(at, src.indexOf("\n}\n", at));
  const gate = body.indexOf("params.inner_leaves > 0"), hash = body.indexOf("hash3(");
  expect(gate, "the gate is in the function").toBeGreaterThan(-1);
  expect(hash, "...and the hash comes after it").toBeGreaterThan(gate);
  expect(body.slice(gate, hash), "...with a return between them: the gate's else is the old placement").toContain("return");
  expect(body.slice(0, gate), "nothing before the gate names the salt").not.toContain("INNER_SALT");
  expect([...src.matchAll(/INNER_SALT/g)].length, "the declaration and the one hash").toBe(2);
  expect(src.slice(0, at).match(/hash3\([^)]*INNER_SALT/), "no hash with the salt outside placeLeaf").toBe(null);
});

// ---- 3. no growth draw ----------------------------------------------------------------------------------------------------------------
function sameSkeleton(label, a, b) {
  expect(a.segments.length, `${label}: segments`).toBe(b.segments.length);
  expect(a.twigs.length, `${label}: twigs`).toBe(b.twigs.length);
  a.twigs.forEach((t, j) => {
    expect(Object.keys(t), `${label}: twig ${j}'s keys (the skeleton pin digests every one)`).toEqual(Object.keys(b.twigs[j]));
    for (const k of Object.keys(t)) if (!Object.is(t[k], b.twigs[j][k])) throw new Error(`${label}: twig ${j} .${k} moved`);
  });
  a.segments.forEach((s, i) => {
    for (const side of ["a", "b"]) s[side].forEach((v, c) => { if (!Object.is(v, b.segments[i][side][c])) throw new Error(`${label}: segment ${i} .${side}[${c}] moved`); });
    for (const k of ["level", "limb", "f0", "f1", "clump", "cov", "tree", "px", "py"]) if (!Object.is(s[k], b.segments[i][k])) throw new Error(`${label}: segment ${i} .${k} moved`);
  });
}
test("no draw from the growth, arrangement or wind streams: at 0.3 and 1 the twigs (every key) and the segments are the 0 grove's, bit for bit — and no twig record carries a path", () => {
  for (const [name, cfg, faithful] of [["park 1", PARK, true], ["afternoon 7", AFT, false], ["small, marginal tree", small({ tree_count: 2.4 }), true], ["willow-ish droop", small({ droop: 0.3, leader_strength: 0.3 }), true]]) {
    const off = grow({ ...cfg, inner_leaves: 0 }, faithful);
    for (const inner of [0.3, 1]) {
      const on = grow({ ...cfg, inner_leaves: inner }, faithful);
      sameSkeleton(`${name} @ ${inner}`, on.g.hier, off.g.hier);
      for (const t of on.g.hier.twigs) for (const k of Object.keys(t)) expect(/path/i.test(k), `a twig record holds .${k}`).toBe(false);
      expect(JSON.stringify(on.g.hier.twigs), name).toBe(JSON.stringify(off.g.hier.twigs));
    }
  }
});

test("the same draws: growing a root with a path collected consumes the stream exactly as growing it without, and the segments and twigs are the same records; plane mode collects none", () => {
  const spec = { levels: 4, kids: 3, lenRatio: 0.7, coneA: 0.6, droop: 0.3, phyllo: 0, leader: true, plane: false, base: [0, 0, 0.8], dir: [0.8, 0.3, 0.5], len: 1, level: 1, limb: 0 };
  const counting = (seed) => { const r = math.mulberry32(seed), draws = []; const rng = () => { const v = r(); draws.push(v); return v; }; rng.draws = draws; return rng; };
  const a = counting(11), b = counting(11), without = { seg: [], tw: [] }, withPath = { seg: [], tw: [], path: [] };
  math.growSkeleton(spec, a, without);
  math.growSkeleton(spec, b, withPath);
  expect(b.draws).toEqual(a.draws);
  expect(withPath.seg).toEqual(without.seg);
  expect(withPath.tw).toEqual(without.tw);
  expect(withPath.path.length, "a path for every twig, in the twig's own order").toBe(without.tw.length);
  const flat = { seg: [], tw: [], path: [] };
  math.growSkeleton({ ...spec, plane: true }, counting(5), flat);
  expect(flat.tw.length).toBeGreaterThan(10);
  expect(flat.path, "plane mode passes no chain").toEqual([]);
});

// ---- 4. the path: every ancestor joint, tip first, to the trunk --------------------------------------------------------------------------
const key3 = (p) => `${p[0]},${p[1]},${p[2]}`;
test("a twig's path is its ancestors' joints, droop sub-segments included, tip first, from the real wood to the trunk axis: every step is a segment of hier.segments, and the lengths add up", () => {
  for (const [name, cfg, faithful] of [["park 1 (leader 0.15, upsweep)", PARK, true], ["afternoon 7 (the legacy hub, straight)", AFT, false], ["willow-ish (droop 0.4, leader)", small({ droop: 0.4, leader_strength: 0.3, tree_count: 2 }), true], ["hub with droop", small({ droop: 0.3, leader_strength: 0, tree_count: 2 }), true], ["a marginal tree, curved", small({ droop: 0.2, leader_strength: 0.2, tree_count: 2.4 }), true]]) {
    const { g, params } = grow({ ...cfg, inner_leaves: 0.4 }, faithful), H = g.hier;
    expect(H.twigPath.length, name).toBe(H.twigs.length);
    expect(H.twigPathLen).toBeInstanceOf(Float64Array);
    expect(H.twigPathLen.length).toBe(H.twigs.length);
    const steps = new Set(H.segments.map((s) => `${key3(s.a)}|${key3(s.b)}`));
    let longest = 0;
    H.twigs.forEach((t, j) => {
      const P = H.twigPath[j], n = P.length / 3, pt = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
      expect(P).toBeInstanceOf(Float64Array);
      expect(n, `${name}: twig ${j} has joints`).toBeGreaterThanOrEqual(params.branch_levels + 1);
      longest = Math.max(longest, n);
      expect([P[0], P[1], P[2]].every((v, c) => Object.is(v, [t.x, t.y, t.z][c])), `${name}: twig ${j} starts at its tip`).toBe(true);
      let hasBase = false;
      for (let i = 0; i < n; i++) if (Object.is(P[3 * i], t.bx) && Object.is(P[3 * i + 1], t.by)) hasBase = true;
      expect(hasBase, `${name}: twig ${j} passes through its real base`).toBe(true);
      expect(Object.is(P[3 * (n - 1)], t.tx) && Object.is(P[3 * (n - 1) + 1], t.ty), `${name}: twig ${j} ends on its trunk axis`).toBe(true);
      expect(Math.abs(P[3 * (n - 1) + 2] - H.limbAttach[t.limb]), `${name}: ...at the height its limb meets the trunk (limbAttach is float32, scaled from a float32 local height)`).toBeLessThan(1e-6);
      let L = 0;
      for (let i = 0; i + 1 < n; i++) {
        expect(steps.has(`${key3(pt(i + 1))}|${key3(pt(i))}`), `${name}: twig ${j} step ${i} is a segment of the skeleton (older end first)`).toBe(true);
        L += Math.hypot(P[3 * i] - P[3 * i + 3], P[3 * i + 1] - P[3 * i + 4], P[3 * i + 2] - P[3 * i + 5]);
      }
      expect(Math.abs(H.twigPathLen[j] - L), `${name}: twig ${j} pathLen is the 3-D arc`).toBeLessThan(1e-12);
    });
    if (cfg.droop) expect(longest, `${name}: the curve's sub-segment joints are on the path`).toBeGreaterThan(params.branch_levels + 1);
    else expect(longest, `${name}: straight wood is one segment a level`).toBe(params.branch_levels + 1);
  }
});

test("the paths are cut with the twigs: past the cluster cap (MAX_TEX) the twigs, the paths and the arcs are the same first N, and each path still starts at its own twig's tip", () => {
  const r = growWith({ ...PARK, inner_leaves: 0.5 }, true, { maxTex: 100 }), H = r.g.hier;
  expect(H.twigs.length).toBe(100);
  expect(H.twigPath.length).toBe(100);
  expect(H.twigPathLen.length).toBe(100);
  H.twigs.forEach((t, j) => { if (!(Object.is(H.twigPath[j][0], t.x) && Object.is(H.twigPath[j][1], t.y) && Object.is(H.twigPath[j][2], t.z))) throw new Error(`twig ${j}'s path does not start at its tip`); });
  expect(r.faithLeaves.length / SF, "only the kept twigs bear leaves").toBe(100 * 31);
});

test("path recording is part of the gate: at 0 nothing is collected (hier.twigPath is null), and the grove is allocated as before", () => {
  const off = grow({ ...PARK, inner_leaves: 0 }, true), none = grow(PARK, true, { drop: ["inner_leaves"] });
  expect(off.g.hier.twigPath).toBeNull();
  expect(off.g.hier.twigPathLen).toBeNull();
  expect(none.g.hier.twigPath).toBeNull();
  expect(grow({ ...PARK, inner_leaves: 0.2 }, true).g.hier.twigPath.length).toBe(198);
});

// ---- 5. the law, on a path of known shape -------------------------------------------------------------------------------------------------
// a twig whose wood runs straight back along -x from its tip, 4 m of it, level (the arc distance is the x distance) or falling `drop` m over it; and a bent one for the geometry
const flatHier = (len = 4, spread = 0, drop = 0) => ({ P: { ...DEFAULTS, seed: 5, cluster_spread_m: spread, inner_leaves: 1 }, hier: { twigs: [{ x: 0, y: 0, z: 3, dx: 1, dy: 0, bx: -0.2, by: 0, tree: 0, layer: 0 }], twigPath: [Float64Array.from([0, 0, 3, -len, 0, 3 - drop])], twigPathLen: Float64Array.from([Math.hypot(len, drop)]) } });
const hOf = (seed, j, k) => { const r = math.mulberry32(math.hash3((seed >>> 0) ^ GROVE.INNER_SALT, j, k)); const h = r(), u = r(); return { h, u }; };
test("the share glides: a leaf is on its tip below its own h, on the wood above h + 0.05, and the smoothstep between — the place AND the height mix by that one share, on a level path and on a sloped one — and the hash is (seed ^ INNER_SALT, j, k), nobody else's stream", () => {
  // The sloped path is what lets the height be seen: on a level one the wood is at the tip's height, so a height that jumped to the wood's as soon as the share leaves 0, or that mixed by the share squared, is the same number.
  let mid = 0;
  for (const drop of [0, 2.5]) {
    const { P, hier } = flatHier(4, 0, drop);
    for (let k = 0; k < 40; k++) {
      const { h, u } = hOf(P.seed, 0, k), d = u * u * 4;   // a straight path: the arc fraction u² is also the fraction of the plan run and of the fall
      for (const inner of [h - 0.01, h, h + 0.01, h + 0.025, h + 0.05, h + 0.2]) {
        if (inner <= 0) continue;
        const out = [0, 0, 0];
        GROVE.placeLeaf(hier, 0, 0, 0, k, { ...P, inner_leaves: inner }, true, out);
        const s = math.smoothstep(h, h + 0.05, inner);
        expect(out[0], `leaf ${k} at ${inner.toFixed(3)} (drop ${drop})`).toBeCloseTo(-d * s, 12);
        expect(out[1]).toBeCloseTo(0, 12);
        expect(out[2], `leaf ${k} at ${inner.toFixed(3)} (drop ${drop}): the height is the tip's mixed with the wood's by the SAME share`).toBeCloseTo(3 - drop * u * u * s, 12);
        if (!drop) expect(out[2]).toBe(3);   // a level path: the wood is at the tip's height
        if (s === 0) { expect(out[0] === 0, "s = 0 is the tip, exactly").toBe(true); expect(out[2] === 3, "...at the tip's height").toBe(true); }
        if (drop && s > 0.2 && s < 0.8 && u > 0.3) mid++;
      }
    }
  }
  expect(mid, "leaves caught mid-glide on the sloped path (not vacuous)").toBeGreaterThan(10);
});

test("density falls as d^(-1/2): the arc distance from the tip is u²·pathLen, so the share within d of the tip is sqrt(d / pathLen)", () => {
  const { P, hier } = flatHier(4, 0), ds = [];
  for (let k = 0; k < 8000; k++) {
    if (hOf(P.seed, 0, k).h > 0.9) continue;   // on the wood at inner_leaves 1
    const out = [0, 0, 0];
    GROVE.placeLeaf(hier, 0, 0, 0, k, P, true, out);
    ds.push(-out[0] / 4);
  }
  expect(ds.length).toBeGreaterThan(6500);
  for (const q of [0.01, 0.04, 0.25, 0.64, 0.9]) {
    const share = ds.filter((d) => d <= q).length / ds.length;
    expect(Math.abs(share - Math.sqrt(q)), `share within ${q} of the path`).toBeLessThan(0.02);
  }
  expect(ds.every((d) => d >= 0 && d <= 1)).toBe(true);
  expect(ds.some((d) => d < 0.002), "never to zero, but thick at the tip: leaves right at it").toBe(true);
  expect(ds.some((d) => d > 0.9), "...and a few right back at the trunk").toBe(true);
});

test("the wood hug: back along the heading of the segment it lies on, a perpendicular scatter of 0.4 spread; the layer path's blob is isotropic at 0.4 — and a leaf keeps the height of the point it hangs at", () => {
  // tip (0,0,3) -> base (-0.2,0,3) -> (-1.2, 0.0, 2) falling 1 m over 1 m of plan -> (-1.2, -1.5, 2) turning to -y
  const pts = [[0, 0, 3], [-0.2, 0, 3], [-1.2, 0, 2], [-1.2, -1.5, 2]], flat = Float64Array.from(pts.flat());
  let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1], pts[i][2] - pts[i + 1][2]);
  const hier = { twigs: [{ x: 0, y: 0, z: 3, dx: 1, dy: 0, bx: -0.2, by: 0, tree: 0, layer: 0 }], twigPath: [flat], twigPathLen: Float64Array.from([L]) };
  const P = { ...DEFAULTS, seed: 9, cluster_spread_m: 0.28, inner_leaves: 1 };
  // an independent walk of the polyline
  const walk = (d) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (d <= len || i + 2 === pts.length) { const f = Math.min(d / len, 1); const pl = Math.hypot(a[0] - b[0], a[1] - b[1]); return { q: a.map((v, c) => v + (b[c] - v) * f), e: [(a[0] - b[0]) / pl, (a[1] - b[1]) / pl] }; }
      d -= len;
    }
  };
  let seen = 0; const zs = new Set();
  for (let k = 0; k < 400; k++) {
    const { h, u } = hOf(P.seed, 0, k); if (h > 0.9) continue;
    const g1 = Math.sin(k) * 1.3, g2 = Math.cos(2 * k) * 1.1, { q, e } = walk(u * u * L);
    for (const faithful of [true, false]) {
      const out = [0, 0, 0]; GROVE.placeLeaf(hier, 0, g1, g2, k, P, faithful, out);
      const sp = P.cluster_spread_m, want = faithful ? [q[0] - Math.abs(g1) * sp * 0.5 * e[0] - g2 * sp * 0.4 * e[1], q[1] - Math.abs(g1) * sp * 0.5 * e[1] + g2 * sp * 0.4 * e[0]] : [q[0] + g1 * sp * 0.4, q[1] + g2 * sp * 0.4];
      expect(Math.abs(out[0] - want[0]) + Math.abs(out[1] - want[1]), `leaf ${k} faithful ${faithful}`).toBeLessThan(1e-9);
      expect(out[2], `leaf ${k}: the height of the path where it hangs`).toBeCloseTo(q[2], 12);
    }
    zs.add(Math.round(q[2] * 1000)); seen++;
  }
  expect(seen).toBeGreaterThan(300);
  expect(zs.size, "leaves hang at many heights, level 3 down to 2").toBeGreaterThan(50);
});

test("a path with a vertical step or no length is finite everywhere: the heading carries over from the nearest wood that has a plan direction", () => {
  const flatTwig = { x: 0, y: 0, z: 3, dx: 1, dy: 0, bx: -0.2, by: 0, tree: 0, layer: 0 };
  const paths = [[[0, 0, 3], [0, 0, 2], [-1, 0, 2]], [[0, 0, 3], [-1, 0, 3], [-1, 0, 1]], [[0, 0, 3], [0, 0, 1], [0, 0, 0]], [[0, 0, 3], [0, 0, 3]]];
  for (const pts of paths) {
    let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(...pts[i].map((v, c) => v - pts[i + 1][c]));
    const hier = { twigs: [flatTwig], twigPath: [Float64Array.from(pts.flat())], twigPathLen: Float64Array.from([L]) };
    for (let k = 0; k < 200; k++) for (const faithful of [true, false]) {
      const out = [0, 0, 0]; GROVE.placeLeaf(hier, 0, 0.6, -0.9, k, { ...DEFAULTS, seed: 3, inner_leaves: 1 }, faithful, out);
      expect(out.every(Number.isFinite), `${JSON.stringify(pts)} leaf ${k}`).toBe(true);
    }
  }
});

// ---- 6. count and area, and the shared height ------------------------------------------------------------------------------------------
test("count and area unchanged: the leaf count and the sum of A·B0·fade are Object.is-equal at 0 and 0.5, and in an unlit look every slot but the place and the height is the 0 grove's, leaf by leaf — lit, the tau slots move too (the wood leaves change who shades whom)", () => {
  for (const [name, cfg, faithful] of [["park 1", PARK, true], ["afternoon 7", AFT, false], ["small, marginal leaf and tree", small({ tree_count: 2.4 }), true]]) {
    const off = grow({ ...cfg, inner_leaves: 0 }, faithful), on = grow({ ...cfg, inner_leaves: 0.5 }, faithful);
    expect(on.faithLeaves.length, `${name}: faithful count`).toBe(off.faithLeaves.length);
    expect(on.layers.reduce((s, l) => s + l.length / SL, 0), `${name}: layer count`).toBe(off.layers.reduce((s, l) => s + l.length / SL, 0));
    const area = (F) => { let a = 0; for (let i = 0; i < F.length; i += SF) a += F[i + 2] * F[i + 3] * F[i + 17]; return a; };
    expect(Object.is(area(on.faithLeaves), area(off.faithLeaves)), `${name}: the sum of A·B0·fade`).toBe(true);
    let moved = 0;
    for (let i = 0; i < off.faithLeaves.length; i++) {
      const slot = i % SF;
      if (slot === 0 || slot === 1 || slot === 16) { if (!Object.is(on.faithLeaves[i], off.faithLeaves[i])) moved++; continue; }
      if (!Object.is(on.faithLeaves[i], off.faithLeaves[i])) throw new Error(`${name}: record ${Math.floor(i / SF)} slot ${slot} moved`);
    }
    expect(moved, `${name}: places and heights did move (not vacuous)`).toBeGreaterThan(off.faithLeaves.length / SF * 0.3);
  }
  // ...and lit (turn_exposure 1, nothing dropping so no leaf is gone): the count and the area are still the look's, but the order of light is not, so some leaves are another colour — the qualification the spec states
  for (const [name, cfg, faithful] of [["dense afternoon 7, lit", dense({ ...FALL, leaf_drop: 0 }), false], ["park 1, lit", { ...PARK, ...FALL, leaf_drop: 0 }, true]]) {
    const off = grow({ ...cfg, inner_leaves: 0 }, faithful), on = grow({ ...cfg, inner_leaves: 0.5 }, faithful), F = off.faithLeaves, G = on.faithLeaves;
    expect(G.length, `${name}: faithful count`).toBe(F.length);
    const area = (B) => { let a = 0; for (let i = 0; i < B.length; i += SF) a += B[i + 2] * B[i + 3] * B[i + 17]; return a; };
    expect(Object.is(area(G), area(F)), `${name}: the sum of A·B0·fade`).toBe(true);
    let tauMoved = 0, otherMoved = 0;
    for (let i = 0; i < F.length; i++) {
      const slot = i % SF;
      if (Object.is(F[i], G[i])) continue;
      if (slot === 8 || slot === 9 || slot === 10) tauMoved++; else if (slot !== 0 && slot !== 1 && slot !== 16) otherMoved++;
    }
    expect(tauMoved, `${name}: lit, the wood leaves re-order the light and so change some leaves' tau`).toBeGreaterThan(50);
    expect(otherMoved, `${name}: ...and nothing else moves but the place and the height`).toBe(0);
  }
});

const layerOfRef = (r) => {   // the twigs' own binning rule, from outside: zMin/dz over the twigs, round, clamp
  const tw = r.g.hier.twigs, n = Math.max(1, r.params.layer_count | 0);
  let lo = 1e18, hi = -1e18; for (const t of tw) { lo = Math.min(lo, t.z); hi = Math.max(hi, t.z); }
  const dz = hi - lo > 1e-4 ? hi - lo : 1;
  return (z) => (n > 1 ? Math.min(n - 1, Math.max(0, Math.round((z - lo) / dz * (n - 1)))) : 0);
};
test("per-leaf height everywhere: at 0.5 a leaf on the wood leaves its twig's height for one on its path, and its layer is the layer of ITS height; at 0 it is its twig's, to the bit", () => {
  for (const [name, cfg, faithful] of [["park 1", PARK, true], ["afternoon 7", AFT, false], ["willow-ish", small({ droop: 0.4, leader_strength: 0.3 }), true]]) {
    const r = grow({ ...cfg, inner_leaves: 0.5 }, faithful, { keep: true }), H = r.g.hier, layerOf = layerOfRef(r), S = r.season, base = S.base;
    const F = r.faithLeaves;
    let off = 0, atTwig = 0, worstLayer = 0;
    for (let i = 0; i < S.n; i++) {
      const o = SREC * i, x = S.rec[o], y = S.rec[o + 1], z = S.rec[o + 2], j = S.rec[o + 6], layer = S.rec[o + 9], start = S.rec[o + 10], t = H.twigs[j], P = H.twigPath[j];
      let lo = 1e18, hi = -1e18; for (let q = 2; q < P.length; q += 3) { lo = Math.min(lo, P[q]); hi = Math.max(hi, P[q]); }
      expect(z >= lo - 1e-9 && z <= hi + 1e-9, `${name}: leaf ${i}'s height ${z} is within its path's [${lo}, ${hi}]`).toBe(true);
      expect(Object.is(F[i * SF + 16], Math.fround(z)), `${name}: the faithful slot is the record's`).toBe(true);
      expect(Object.is(F[i * SF], Math.fround(x)) && Object.is(F[i * SF + 1], Math.fround(y)), `${name}: ...and so is its place`).toBe(true);
      if (z === t.z) { atTwig++; expect(layer, `${name}: a leaf at its twig's height is on its twig's layer`).toBe(t.layer); } else { off++; }
      if (layer !== layerOf(z)) worstLayer++;
      expect(Object.is(base[layer][start], Math.fround(x)) && Object.is(base[layer][start + 1], Math.fround(y)), `${name}: leaf ${i} is in layer ${layer}'s buffer at ${start}`).toBe(true);
    }
    expect(worstLayer, `${name}: every layer index is layerOf(z)`).toBe(0);
    expect(off, `${name}: the faithful height is no longer the twig's for many leaves`).toBeGreaterThan(S.n * 0.25);
    expect(atTwig, `${name}: ...and a share of leaves still sits on the twigs`).toBeGreaterThan(S.n * 0.2);
    expect(new Set(S.rec.filter((_, q) => q % SREC === 9)).size, `${name}: more than one layer is in use`).toBeGreaterThan(1);
  }
  const z0 = grow({ ...PARK, inner_leaves: 0 }, true, { keep: true });
  for (let i = 0; i < z0.season.n; i++) {
    const o = SREC * i, t = z0.g.hier.twigs[z0.season.rec[o + 6]];
    if (!Object.is(z0.season.rec[o + 2], t.z) || z0.season.rec[o + 9] !== t.layer) throw new Error(`at 0 leaf ${i} is not on its twig's height and layer`);
  }
});

test("the layer a leaf is binned to moves its buffer's contents and nothing else: the layers hold the same leaves as the faithful buffer, grouped by each leaf's own layer, in order — in summer and mid-fall, where the light rewrites each leaf's tau in the slot it recorded", () => {
  for (const [name, cfg] of [["afternoon 7, summer", AFT], ["dense afternoon 7, mid-turn (lit, no leaf gone)", dense({ ...FALL, leaf_drop: 0 })]]) for (const faithful of [false, true]) {
    const r = grow({ ...cfg, inner_leaves: 0.5 }, faithful, { keep: true }), S = r.season, per = r.layers.map(() => []);
    for (let i = 0; i < S.n; i++) per[S.rec[SREC * i + 9]].push(i);
    per.forEach((idx, li) => {
      expect(r.layers[li].length / SL, `${name}: layer ${li}`).toBe(idx.length);
      idx.forEach((i, q) => {
        for (const [ls, fs] of [[0, 0], [1, 1], [8, 8], [9, 9], [10, 10], [11, 11], [16, 17]]) if (!Object.is(r.layers[li][q * SL + ls], r.faithLeaves[i * SF + fs])) throw new Error(`${name}: layer ${li} slot ${q} is not leaf ${i} (slot ${ls})`);
      });
    });
  }
  const lit = grow({ ...dense({ ...FALL, leaf_drop: 0 }), inner_leaves: 0.5 }, false, { keep: true }), summer = grow({ ...dense({ ...FALL, leaf_drop: 0 }), phenology: 0.5, inner_leaves: 0.5 }, false);
  expect(firstDiff(lit.faithLeaves, summer.faithLeaves), "the fall is not the summer (the tau slots were rewritten: not vacuous)").not.toBe(null);
});

test("the faithful cast frame reaches the lowest leaf: a leaf hung on wood below every twig tip pulls faith.hMin down to it (the swept range of the cast box, with no wood to reach the ground); at 0 it is the twigs' lowest tip", () => {
  for (const [name, cfg] of [["columnar on park 1, no wood", { ...PARK, ...TREE_SPECIES.columnar, branch_tau: 0 }], ["maple on park 1, no wood", { ...PARK, ...TREE_SPECIES.maple, branch_tau: 0 }], ["park 1", PARK]]) {
    const off = grow({ ...cfg, inner_leaves: 0 }, true), on = grow({ ...cfg, inner_leaves: 1 }, true);
    const twigLow = Math.min(...off.g.hier.twigs.map((t) => t.z));
    expect(Object.is(off.faith.hMin, twigLow), `${name}: at 0 the frame is the twigs'`).toBe(true);
    let low = Infinity; for (let i = 16; i < on.faithLeaves.length; i += SF) low = Math.min(low, on.faithLeaves[i]);
    expect(low, `${name}: leaves hang below the twigs (not vacuous)`).toBeLessThan(twigLow - 0.05);
    expect(on.faith.hMin, `${name}: faith.hMin reaches the lowest leaf`).toBeLessThanOrEqual(low + 1e-6);
    expect(on.faith.hMax, `${name}: ...and hMax, which scales the sway, is the twigs' own (no leaf here rises above its tip: the next test is the grove where one does)`).toBe(off.faith.hMax);
  }
});

test("the faithful cast frame reaches the highest leaf too: heavy droop bends a twig's tip below the joints behind it, so a leaf hung on that wood is ABOVE every twig tip, and faith.hMax is pulled up to the highest leaf; at 0 it is the twigs' own highest tip, to the bit", () => {
  const rows = [];
  for (const [name, cfg] of [["willow, droop 0.8, on park 1", { ...PARK, ...TREE_SPECIES.willow, droop: 0.8 }], ["droop 1, pitch 70, no leader, on afternoon 7", { ...AFT, droop: 1, branch_pitch_deg: 70, leader_strength: 0 }]]) {
    const off = grow({ ...cfg, inner_leaves: 0 }, true), none = grow(cfg, true, { drop: ["inner_leaves"] }), on = grow({ ...cfg, inner_leaves: 1 }, true);
    const twigHigh = Math.max(...off.g.hier.twigs.map((t) => t.z));
    expect(Object.is(off.faith.hMax, twigHigh), `${name}: at 0 the frame's top is the twigs' highest tip`).toBe(true);
    expect(Object.is(none.faith.hMax, off.faith.hMax) && Object.is(none.faith.hMin, off.faith.hMin), `${name}: ...and the same bits as the build that never heard of the key`).toBe(true);
    let high = -Infinity, above = 0;
    for (let i = 16; i < on.faithLeaves.length; i += SF) { high = Math.max(high, on.faithLeaves[i]); if (on.faithLeaves[i] > Math.fround(twigHigh)) above++; }
    expect(above, `${name}: leaves hang above every twig tip (not vacuous)`).toBeGreaterThan(100);
    expect(high - twigHigh, `${name}: ...by a good deal, which a centimetre-wide margin could never cover`).toBeGreaterThan(0.2);
    expect(on.faith.hMax, `${name}: faith.hMax reaches the highest leaf`).toBeGreaterThanOrEqual(high - 1e-6);
    expect(on.faith.hMax - high, `${name}: ...and goes no further than it`).toBeLessThan(1e-6);
    expect(Object.is(on.faith.hMin, Math.min(off.faith.hMin, on.faith.hMin)), `${name}: hMin is still the lowest of the two`).toBe(true);
    rows.push(`${name}: hMax ${off.faith.hMax.toFixed(4)} -> ${on.faith.hMax.toFixed(4)} m, ${above} leaves above the twigs' highest tip, the highest ${(high - twigHigh).toFixed(4)} m over it`);
  }
  console.log(`\nthe cast frame's top at inner_leaves 1 (bun):\n  ${rows.join("\n  ")}`);
});

// ---- 6b. an inner leaf keeps its tree ---------------------------------------------------------------------------------------------------------
// The tree is the TWIG's, whatever wood the leaf hangs on: a leaf on a limb another tree's crown overlaps is still its own tree's, with its tree's lead and depth (§4.5). Held the way tree.test.js holds the tip
// leaves: every tau in every buffer, the litter's, and each leaf's retained weight against leafTau (and the drop day) called by hand with the pair the twig's tree draws (treeDraws, not the grove's tables).
// Four places hand a leaf its tree's pair — the hang loop's own tau, the rewrite's light arm, its sen-only arm (a leaf letting go), and the re-season's copy of the rewrite — and each reads it off the twig the
// leaf belongs to, so each is held apart: unlit with nothing dropping (the hang loop's tau is the only tau there is), unlit and dropping, lit, lit and dropping, both clocks; on the layer cast and the faithful one.
function reseasoned(build, to, faithful) {   // a grove built at one season and re-seasoned in place to another, the engine's cheap path (reseason.test.js holds that it is a fresh build's bytes)
  const gl = stubGl(), params = { ...DEFAULTS, ...build }, P1 = { ...DEFAULTS, ...to }, faith = {};
  const maker = GROVE.makeGrove({ gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } });
  const g = maker.buildGrove(null, { keepSeason: true });
  maker.reseasonGrove(g, P1);
  return { params: P1, g, litter: g.litter, layers: g.layerVAO.map((l) => Float32Array.from(l.buf.data)), faithLeaves: Float32Array.from(faith.buf.data), leafW: g.hier.leafW, season: g.season };
}
function innerByHand(snap, label) {
  const P = snap.params, S = snap.season, rec = S.rec, { twigs, nLeaf } = snap.g.hier, nTree = Math.ceil(P.tree_count);
  const isLit = math.lit(P), dropping = math.dropping(P), after = math.afterTurn(P);
  expect(math.senescing(P), `${label}: the leaves are turning`).toBe(true);
  const lead = [], depth = [];
  for (let t = 0; t < nTree; t++) { const [v, w] = math.treeDraws(P.seed, t); lead.push(math.treeShift(v, P.tree_clock_spread)); depth.push(math.treeGain(w, P.tree_pigment_spread)); }
  expect(nTree, `${label}: a grove of at least three trees`).toBeGreaterThanOrEqual(3);
  expect(new Set(lead).size, `${label}: the trees draw different leads`).toBe(nTree);
  expect(new Set(depth).size, `${label}: ...and different depths`).toBe(nTree);
  const u = isLit ? math.exposureBlend(S.rank, S.ex, P.exposure_absolute) : null;   // the grove's own order of light, read: the exposure is not what is under test, the pair each leaf is handed is
  if (!isLit) expect(math.ordered(P), `${label}: no light anywhere, no rank`).toBe(false);
  const tauOf = (i, j, k, dT, cT) => Array.from(isLit ? math.leafTau(S.tau, P, P.seed, j, k, [0, 0, 0], math.turnOrder(u[i]), math.redGain(u[i]), dT, cT) : math.leafTau(S.tau, P, P.seed, j, k, [0, 0, 0], undefined, undefined, dT, cT));
  const wantL = snap.layers.map(() => []), wantF = [], litter = new Map();
  let inner = 0, tip = 0, differs = 0, differsFading = 0, gone = 0, mid = 0;
  for (let i = 0; i < S.n; i++) {
    const o = SREC * i, j = rec[o + 6], k = rec[o + 7], t = twigs[j].tree, onWood = rec[o + 2] !== twigs[j].z, cov = rec[o + 8], layer = rec[o + 9];
    let w = 1, D = 0;
    if (dropping) {
      D = after ? math.dropDayAfterTurn(P, math.turnPhase(P, math.leafClock(P.seed, j, k), isLit ? math.turnOrder(u[i]) : undefined), lead[t]) : math.dropDay(P, math.dropPhase(math.dropHash(P.seed, j, k), u ? u[i] : 0, P.drop_exposure), lead[t]);
      w = math.retention(D, P.phenology);
      if (!Object.is(snap.leafW[j * nLeaf + k], Math.fround(w))) throw new Error(`${label}: leaf ${j}/${k} (${onWood ? "on the wood" : "at its tip"}) retains ${snap.leafW[j * nLeaf + k]}, its tree's pair says ${w}`);
    }
    const own = tauOf(i, j, k, lead[t], depth[t]);
    if (onWood) {
      inner++;
      const next = tauOf(i, j, k, lead[(t + 1) % nTree], depth[(t + 1) % nTree]);   // what the leaf would get from the NEXT tree's pair: the mutant these assertions are written to tell
      if (next.some((x, c) => !Object.is(x, own[c]))) { differs++; if (w < 1) differsFading++; }
    } else tip++;
    if (w > 0 && w < 1) mid++;
    if (w === 0) { gone++; litter.set(`${j}/${k}`, { tau: own, D }); continue; }
    const cf = cov * w;
    for (let c = 0; c < 3; c++) { wantL[layer].push(Math.fround(own[c] * cf)); wantF.push(Math.fround(own[c] * cf)); }
  }
  const slots = (buf, stride) => { const o = []; for (let i = 0; i < buf.length; i += stride) o.push(buf[i + 8], buf[i + 9], buf[i + 10]); return o; };
  snap.layers.forEach((l, li) => {
    const got = slots(l, SL), at = got.findIndex((x, i) => !Object.is(x, wantL[li][i]));
    expect(got.length, `${label}: layer ${li}: the leaves that stay`).toBe(wantL[li].length);
    expect(at, `${label}: layer ${li}: leaf ${Math.floor(at / 3)} channel ${at % 3} is not leafTau of its twig's tree's lead and depth`).toBe(-1);
  });
  const gotF = slots(snap.faithLeaves, SF), atF = gotF.findIndex((x, i) => !Object.is(x, wantF[i]));
  expect(gotF.length, `${label}: faithful: the leaves that stay`).toBe(wantF.length);
  expect(atF, `${label}: faithful: leaf ${Math.floor(atF / 3)} channel ${atF % 3} is not leafTau of its twig's tree's lead and depth`).toBe(-1);
  expect(snap.litter?.length ?? 0, `${label}: the litter: the leaves that went`).toBe(litter.size);
  for (const l of snap.litter ?? []) {
    const o = litter.get(`${l.j}/${l.k}`);
    expect(o, `${label}: litter leaf ${l.j}/${l.k}`).toBeDefined();
    expect(Object.is(l.D, o.D), `${label}: litter leaf ${l.j}/${l.k}: its day`).toBe(true);
    for (let c = 0; c < 3; c++) expect(Object.is(l.tau[c], o.tau[c]), `${label}: litter leaf ${l.j}/${l.k} channel ${c}`).toBe(true);
  }
  return { inner, tip, differs, differsFading, gone, mid };
}
const INNER_TREES = small({ tree_count: 4, leaves_per_cluster: 6, foliage_density: 1, inner_leaves: 1, tree_clock_spread: 0.15, tree_pigment_spread: 0.6, anthocyanin: 0.8, tannin: 0.5, wall_fraction: 0.2, phenology: 0.85, drop_exposure: 0 });
const INNER_CASES = [
  ["unlit, nothing dropping (the hang loop's own tau)", { turn_exposure: 0, leaf_drop: 0 }],
  ["unlit and dropping (the rewrite's sen-only arm and the litter's tau)", { turn_exposure: 0, leaf_drop: 1 }],
  ["unlit, dropping after the turn", { turn_exposure: 0, leaf_drop: 1, drop_after_turn: 1 }],
  ["lit, nothing dropping (the rewrite's light arm)", { turn_exposure: 1, leaf_drop: 0 }],
  ["lit and dropping", { turn_exposure: 1, leaf_drop: 1, drop_exposure: 1 }],
  ["lit, dropping after the turn", { turn_exposure: 1, leaf_drop: 1, drop_after_turn: 1 }],
];
test("an inner leaf keeps its tree: at inner_leaves 1 (every leaf on the wood) and 0.5 (half of them, half at the tips) on four trees with a lead and a depth each, every tau, retained weight and litter entry is leafTau's with the pair of the twig's tree — lit and unlit, dropping and not, layer and faithful, as built and as re-seasoned", () => {
  for (const innerLeaves of [1, 0.5]) for (const [label, over] of INNER_CASES) for (const faithful of [false, true]) {
    const cfg = { ...INNER_TREES, ...over, inner_leaves: innerLeaves }, name = `inner ${innerLeaves}, ${label}, ${faithful ? "faithful" : "layer"}`;
    const built = grow(cfg, faithful, { keep: true });
    const re = reseasoned({ ...cfg, phenology: 0.3 }, cfg, faithful);   // built in the summer, where nothing turns and no rank is made: the re-season does all of it
    for (const [how, snap] of [["built", built], ["re-seasoned", re]]) {
      const r = innerByHand(snap, `${name}, ${how}`), n = snap.season.n;
      expect(r.inner + r.tip, `${name}, ${how}: every leaf is accounted for`).toBe(n);
      expect(r.inner, `${name}, ${how}: leaves on the wood`).toBeGreaterThan(n * (innerLeaves === 1 ? 0.9 : 0.35));
      if (innerLeaves < 1) expect(r.tip, `${name}, ${how}: ...and at the tips`).toBeGreaterThan(n * 0.35);
      // not vacuous: a leaf on the wood handed the next tree's pair would have another colour, for many leaves — and, where leaves are letting go, for some that fade or fall
      expect(r.differs, `${name}, ${how}: an inner leaf told the next tree's pair differs`).toBeGreaterThan(n * 0.1);
      if (over.leaf_drop) { expect(r.gone, `${name}, ${how}: leaves have gone`).toBeGreaterThan(20); expect(r.mid, `${name}, ${how}: some are mid-fade`).toBeGreaterThan(0); expect(r.differsFading, `${name}, ${how}: ...inner ones among them`).toBeGreaterThan(5); }
    }
  }
});

// ---- 7. the ring ------------------------------------------------------------------------------------------------------------------------
function ringOf(r) {
  const tw = r.g.hier.twigs, d = r.faithLeaves, R = new Map();
  for (const t of tw) R.set(t.tree, Math.max(R.get(t.tree) || 0, Math.hypot(t.x - t.tx, t.y - t.ty)));
  const bins = new Array(10).fill(0); let tot = 0;
  for (let i = 0; i < d.length; i += SF) {
    const t = tw[Math.floor(d[i + 11])], f = d[i + 17], rr = Math.hypot(d[i] - t.tx, d[i + 1] - t.ty) / R.get(t.tree);
    bins[Math.min(9, Math.floor(rr * 10))] += f; tot += f;
  }
  const share = bins.map((v) => v / tot), dens = share.map((v, i) => v / (2 * i + 1)), d7 = dens.slice(0, 7), peak = Math.max(...dens);
  return { share, within3: share[0] + share[1] + share[2], within5: share.slice(0, 5).reduce((a, b) => a + b, 0), flat: Math.min(...d7) / Math.max(...d7), peak: dens.map((v) => v / peak) };
}
test("the ring at 0 is the baseline to the digit (the method is the brief's): park 1 within 0.5 R 0.398, within 0.3 R 0.081, flatness 0.29; afternoon 7 0.156 / 0.015", () => {
  const p = ringOf(grow({ ...PARK, inner_leaves: 0 }, true)), a = ringOf(grow({ ...AFT, inner_leaves: 0 }, false));
  expect(+p.within5.toFixed(3)).toBe(0.398);
  expect(+p.within3.toFixed(3)).toBe(0.081);
  expect(+p.flat.toFixed(2)).toBe(0.29);
  expect(p.share.map((v) => +(v * 100).toFixed(1))).toEqual([0.8, 1.9, 5.4, 11.8, 19.8, 23.3, 18.2, 11.5, 5.0, 2.3]);
  expect(+a.within5.toFixed(3)).toBe(0.156);
  expect(+a.within3.toFixed(3)).toBe(0.015);   // the brief's table says 0.016; its own bin list (0.0 0.3 1.2) and this method say 0.0150
  expect(a.share.map((v) => +(v * 100).toFixed(1))).toEqual([0.0, 0.3, 1.2, 4.0, 10.1, 17.0, 20.6, 18.8, 14.7, 13.2]);
});

test("the ring at 0.3 is full: park 1 puts 0.12 of its leaves inside 0.3 R (0.081 at 0) and flattens its core (min/max area density over bins 0-6 from 0.29); afternoon 7 puts 0.06 there (0.015)", () => {
  const p = ringOf(grow({ ...PARK, inner_leaves: 0.3 }, true)), a = ringOf(grow({ ...AFT, inner_leaves: 0.3 }, false));
  expect(p.within3).toBeGreaterThanOrEqual(0.12);
  // THE BRIEF ASKED 0.5 AND THE LAW IT SPECIFIES LANDS AT 0.44 (the hug trails the wood's leaves inward along the limb, and the paths all end on the trunk: bin 0 is the peak). The simulation the 0.5 came from scattered the
  // wood leaves isotropically (0.4 spread): that scatter measures 0.63, within 0.3 R 0.127. A floor between the baseline and what the law reaches, so the test can fail (it reads 0.29 with no wood leaves).
  expect(p.flat).toBeGreaterThanOrEqual(0.4);
  expect(a.within3).toBeGreaterThanOrEqual(0.06);
});

test("the ring (reported): park 1 and afternoon 7 at 0, 0.3, 0.6 — leaf share by r/R in 10 bins, density/peak, within 0.5 R, within 0.3 R", () => {
  const rows = [], by = {};
  for (const [name, cfg, faithful] of [["park 1", PARK, true], ["afternoon 7", AFT, false]]) for (const inner of [0, 0.3, 0.6]) {
    const R = ringOf(grow({ ...cfg, inner_leaves: inner }, faithful));
    if (!by[name]) by[name] = [];
    by[name].push(R);
    rows.push(`${name.padEnd(11)} inner ${inner.toFixed(1)}  leaf % ${R.share.map((v) => (v * 100).toFixed(1)).join(" ")}  density/peak ${R.peak.map((v) => v.toFixed(2).slice(1 - Math.floor(v))).join(" ")}  <0.5R ${R.within5.toFixed(3)}  <0.3R ${R.within3.toFixed(3)}  flat(0-6) ${R.flat.toFixed(2)}`);
  }
  console.log(`\nthe ring (bun):\n  ${rows.join("\n  ")}`);
  // what the three rows say, held: the knob fills the core and the middle further the further it is turned, in both groves — no saturation, no step back
  for (const [name, [r0, r3, r6]] of Object.entries(by)) for (const key of ["within3", "within5"]) {
    expect(r3[key], `${name}: ${key} grows from inner_leaves 0 to 0.3`).toBeGreaterThan(r0[key] + 0.02);
    expect(r6[key], `${name}: ...and from 0.3 to 0.6`).toBeGreaterThan(r3[key] + 0.02);
  }
});

// ---- 8. continuity (§5.3) ---------------------------------------------------------------------------------------------------------------
test("a slider move glides: from 0.30 to 0.301 no leaf moves, in place or in height, more than a smoothstep's steepest slope allows (30 per unit of the share, over its tip-to-wood distance in each); on park 1 and its species none moves 0.05 m in plan", () => {
  const worsts = [];
  for (const [name, cfg, faithful, absolute] of [["park 1", PARK, true, true], ["oak on park 1", { ...PARK, ...TREE_SPECIES.oak }, true, true], ["spruce on park 1", { ...PARK, ...TREE_SPECIES.spruce }, true, true], ["afternoon 7", AFT, false, false]]) {
    const a = grow({ ...cfg, inner_leaves: 0.3 }, faithful), b = grow({ ...cfg, inner_leaves: 0.301 }, faithful), z = grow({ ...cfg, inner_leaves: 0 }, faithful), w = grow({ ...cfg, inner_leaves: 1 }, faithful);
    let moved = 0, movedZ = 0, worst = 0, worstZ = 0;
    for (let i = 0; i < a.faithLeaves.length; i += SF) {
      const dp = Math.hypot(a.faithLeaves[i] - b.faithLeaves[i], a.faithLeaves[i + 1] - b.faithLeaves[i + 1]), dz = Math.abs(a.faithLeaves[i + 16] - b.faithLeaves[i + 16]);
      worst = Math.max(worst, dp); worstZ = Math.max(worstZ, dz);
      if (dp > 0) moved++;
      if (dz > 0) movedZ++;
      const reach = Math.hypot(w.faithLeaves[i] - z.faithLeaves[i], w.faithLeaves[i + 1] - z.faithLeaves[i + 1]);   // tip to wood (at 1, a leaf with h < 0.95 is wholly on the wood)
      expect(dp, `${name}: leaf ${i / SF} moved ${dp.toFixed(4)} m`).toBeLessThanOrEqual(0.001 * 30 * reach + 1e-5);
      // ...and the height glides the same way: the leaf's z is its tip's mixed with the wood's by the same share, so a step of 0.001 moves it at most 0.03 of its own tip-to-wood height (the faithful slot is the
      // cast's height, the layer bin's and the exposure grid's: a height that jumped, or mixed by a steeper share, would pop a leaf's whole shadow between layers and onto another floor height)
      const reachZ = Math.abs(w.faithLeaves[i + 16] - z.faithLeaves[i + 16]);
      expect(dz, `${name}: leaf ${i / SF} rose or fell ${dz.toFixed(4)} m of a reach of ${reachZ.toFixed(3)} m`).toBeLessThanOrEqual(0.001 * 30 * reachZ + 1e-5);
    }
    expect(moved, `${name}: some leaves are in the glide at 0.3 (not vacuous)`).toBeGreaterThan(5);
    expect(movedZ, `${name}: ...and some of them change height (not vacuous)`).toBeGreaterThan(5);
    // The brief's 0.05 m holds where the wood is short (park 1: reach up to 2.3 m, worst step 0.031). On the layer path's afternoon 7 a path runs to 3 m and the steepest point of the glide
    // carries such a leaf 0.079 m in a step of 0.001: continuous, but not under 0.05. It is the slope of the 0.05-wide smoothstep (30, not 20), and widening INNER_GLIDE is the lever, not a bound here.
    if (absolute) expect(worst, `${name}: worst plan step`).toBeLessThanOrEqual(0.05);
    worsts.push(`${name} ${worst.toFixed(4)} m (height ${worstZ.toFixed(4)} m)`);
  }
  console.log(`\nglide 0.30 -> 0.301, worst step per grove: ${worsts.join(" | ")}`);
});

// ---- 9. determinism ---------------------------------------------------------------------------------------------------------------------
test("deterministic: two builds at 0.5 are the same bytes, whatever was built between them, and a leaf's draw is a pure function of (seed, j, k) — the tree count does not reach it", () => {
  const a = growWith({ ...PARK, inner_leaves: 0.5 }, true, { keep: true });
  growWith({ ...AFT, inner_leaves: 0.9 }, false);
  const b = growWith({ ...PARK, inner_leaves: 0.5 }, true, { keep: true });
  sameGrove("park 1 twice", a, b);
  expect(hOf(77, 5, 3)).toEqual(hOf(77, 5, 3));
  expect(hOf(78, 5, 3)).not.toEqual(hOf(77, 5, 3));
  // a leaf's first two draws are not the arrangement stream's, nor the pigment's, nor the drop's: uncorrelated over a grid of addresses
  const cells = Array.from({ length: 2000 }, (_, i) => [Math.floor(i / 25), i % 25]);
  const mine = cells.map(([j, k]) => hOf(77, j, k).h);
  const other = { arrangement: cells.map(([j]) => math.mulberry32(math.hash3(77, j, 101))()), wind: cells.map(([j]) => math.mulberry32(math.hash3(77 ^ 0x5bd1e995, j, 101))()), pigment: cells.map(([j, k]) => math.leafClock(77, j, k)), drop: cells.map(([j, k]) => math.dropHash(77, j, k)) };
  const corr = (u, v) => { const n = u.length, mu = u.reduce((s, x) => s + x, 0) / n, mv = v.reduce((s, x) => s + x, 0) / n; let suv = 0, suu = 0, svv = 0; for (let i = 0; i < n; i++) { suv += (u[i] - mu) * (v[i] - mv); suu += (u[i] - mu) ** 2; svv += (v[i] - mv) ** 2; } return suv / Math.sqrt(suu * svv); };
  for (const [name, v] of Object.entries(other)) expect(Math.abs(corr(mine, v)), name).toBeLessThan(0.1);
  const mean = mine.reduce((s, x) => s + x, 0) / mine.length;
  expect(Math.abs(mean - 0.5)).toBeLessThan(0.03);
  // The lines above hold the replica of the hash (hOf) and not the grove. On the GROVE: park 1 grows tree 0 the same at any tree count (the marginal tree is appended, and nothing re-spaces the rest: asserted below, so the
  // comparison is of the hash alone), so if the count of trees ever reached a leaf's (h, u) tree 0's leaves would sit elsewhere at 2.4 trees than at 2 — and at 3. Their x, y and z, bit for bit, at inner_leaves 0.5.
  for (const [lo, hi] of [[2, 2.4], [2, 3]]) {
    const A = grow({ ...PARK, tree_count: lo, inner_leaves: 0.5 }, true), B = grow({ ...PARK, tree_count: hi, inner_leaves: 0.5 }, true);
    const n0 = A.g.hier.twigs.filter((t) => t.tree === 0).length, nLeaf = A.g.hier.nLeaf, count = n0 * nLeaf;
    expect(A.g.hier.nLeaf, "the same leaves a twig").toBe(B.g.hier.nLeaf);
    expect(n0, "tree 0's twigs come first").toBeGreaterThan(50);
    expect(A.g.hier.twigs[n0].tree).toBe(1);
    A.g.hier.twigs.slice(0, n0).forEach((t, j) => { const u = B.g.hier.twigs[j]; if (!(u.tree === 0 && Object.is(t.x, u.x) && Object.is(t.y, u.y) && Object.is(t.z, u.z))) throw new Error(`park 1's tree 0 grew differently at ${hi} trees than at ${lo}: twig ${j}`); });
    let onWood = 0;
    for (let i = 0; i < count; i++) {
      for (const slot of [0, 1, 16]) if (!Object.is(A.faithLeaves[i * SF + slot], B.faithLeaves[i * SF + slot])) throw new Error(`tree_count ${lo} vs ${hi}: tree 0's leaf ${i} (slot ${slot}) hangs elsewhere`);
      if (!Object.is(A.faithLeaves[i * SF + 16], Math.fround(A.g.hier.twigs[Math.floor(i / nLeaf)].z))) onWood++;
    }
    expect(onWood, `tree_count ${lo} vs ${hi}: a fair share of tree 0's leaves are on the wood (not vacuous)`).toBeGreaterThan(count * 0.25);
  }
});

// ---- 10. the preview places the cast's leaves -------------------------------------------------------------------------------------------
// The tree-preview inset (T, EDITOR only) scatters its own blob per leaf from the twigs; it asks the same placeLeaf with the same two draws, and walks the grove's other seven per leaf
// so its leaf IS the grove's leaf. Its points are projected on the way out; with the turntable stopped and no wind the projection inverts to the place and height it was given.
function previewLeaves(over, faithful, live = {}) {   // `live`: params set AFTER the grove is built, as the editor's sliders do before the regrow lands
  const calls = [];
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "POINTS") return 0x0000;
      if (name === "drawArrays") return (mode, _first, count) => { if (mode === 0) calls.push(Float32Array.from(t.cur.data.subarray(0, count * 6))); };
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = { ...DEFAULTS, ...over };
  const faith = {}, hub = {
    gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] },
    canvas: { width: 960, height: 540 }, motion: { windX: 1, windY: 0, u: 0, sway: [0, 0] }, src: {}, U: { viz: {}, pts: {} },
  };
  const g = GROVE.makeGrove(hub).buildGrove(null);
  hub.hier = g.hier;
  Object.assign(params, live);
  makeEditorTools(hub);
  const now = performance.now;
  performance.now = () => 0;   // yaw 0: the projection below is a plain affine map
  try { hub.drawTreeInset(null, false); } finally { performance.now = now; }
  const segs = g.hier.segments;
  let R = 1e-3, maxZ = 1e-3;
  for (const s of segs) { R = Math.max(R, Math.hypot(s.a[0], s.a[1]), Math.hypot(s.b[0], s.b[1])); maxZ = Math.max(maxZ, s.a[2], s.b[2]); }
  return { pts: calls[0], fit: 0.72 / Math.max(R, maxZ * 1.4), F: Float32Array.from(faith.buf.data), g };
}
test("the preview and the cast share one placement: at 0.5 the preview draws one point per kept leaf, at the faithful buffer's x, y and z — and at 0 too, now that it walks the grove's draw order", () => {
  for (const inner of [0, 0.5]) for (const [name, cfg, faithful] of [["park 1", PARK, true], ["small, marginal tree, layer", small({ tree_count: 2.4 }), false]]) {
    const { pts, fit, F } = previewLeaves({ ...cfg, inner_leaves: inner }, faithful), n = F.length / SF;
    expect(pts.length / 6, `${name} @ ${inner}: a point for every leaf the cast keeps`).toBe(n);
    const pitch = 24 * Math.PI / 180, hk = Math.cos(pitch), dk = Math.sin(pitch);
    let worstXY = 0, worstZ = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[6 * i] / fit, y = F[i * SF + 1], z = ((pts[6 * i + 1] + 0.4) / fit + y * dk) / (1.4 * hk);
      worstXY = Math.max(worstXY, Math.abs(x - F[i * SF])); worstZ = Math.max(worstZ, Math.abs(z - F[i * SF + 16]));
    }
    expect(worstXY, `${name} @ ${inner}: x`).toBeLessThan(1e-4);
    expect(worstZ, `${name} @ ${inner}: z`).toBeLessThan(1e-4);
  }
  // and the heights are not all the twigs': the preview has a leaf on the wood too
  const { pts, fit, F, g } = previewLeaves({ ...PARK, inner_leaves: 0.5 }, true);
  const pitch = 24 * Math.PI / 180, hk = Math.cos(pitch), dk = Math.sin(pitch);
  let off = 0;
  for (let i = 0; i < F.length / SF; i++) { const z = ((pts[6 * i + 1] + 0.4) / fit + F[i * SF + 1] * dk) / (1.4 * hk), t = g.hier.twigs[Math.floor(F[i * SF + 11])]; if (Math.abs(z - t.z) > 1e-3) off++; }
  expect(off, "the preview's leaves hang at their own heights").toBeGreaterThan(1000);
});

test("a live inner_leaves over a hier that recorded no path (the preview reads the grove's hier with the LIVE params until the regrow lands): every leaf is at its tip and nothing throws or goes NaN — placeLeaf on a missing, short or empty path, and the preview on a grove built at 0", () => {
  const twig = { x: 1, y: 2, z: 3, dx: 1, dy: 0.5, bx: 0.7, by: 1.8, tree: 0, layer: 0 };
  const hiers = {
    "no path table (a grove built at 0)": { twigs: [twig], twigPath: null, twigPathLen: null },
    "no table at all": { twigs: [twig] },
    "no entry for the twig": { twigs: [twig], twigPath: [undefined], twigPathLen: Float64Array.from([0]) },
    "a one-point path": { twigs: [twig], twigPath: [Float64Array.from([1, 2, 3])], twigPathLen: Float64Array.from([0]) },
  };
  for (const [name, hier] of Object.entries(hiers)) for (const faithful of [false, true]) for (let k = 0; k < 60; k++) {
    const P = { ...DEFAULTS, seed: 77, inner_leaves: 0.8 }, out = [0, 0, 0], sp = P.cluster_spread_m, g1 = Math.sin(k) * 1.4, g2 = Math.cos(3 * k) * 1.2;
    GROVE.placeLeaf(hier, 0, g1, g2, k, P, faithful, out);
    const tdl = Math.hypot(1, 0.5), tdx = 1 / tdl, tdy = 0.5 / tdl;   // the old expressions
    const x = faithful ? 1 - Math.abs(g1) * sp * 1.5 * tdx - g2 * sp * 0.4 * tdy : 1 + g1 * sp, y = faithful ? 2 - Math.abs(g1) * sp * 1.5 * tdy + g2 * sp * 0.4 * tdx : 2 + g2 * sp;
    if (!(Object.is(out[0], x) && Object.is(out[1], y) && Object.is(out[2], 3))) throw new Error(`${name}, faithful ${faithful}, leaf ${k}: [${out}] is not the tip's place [${x}, ${y}, 3]`);
  }
  // the editor: the grove is built at 0, the slider is dragged to 0.7, the preview rebuilds its leaves from that hier before the new grove arrives — at the cast's own places, which are the tips'
  for (const [name, cfg, faithful] of [["park 1", PARK, true], ["small, layer", small({ tree_count: 2.4 }), false]]) {
    const { pts, fit, F } = previewLeaves({ ...cfg, inner_leaves: 0 }, faithful, { inner_leaves: 0.7 }), n = F.length / SF;
    expect(pts.length / 6, `${name}: a point for every leaf the cast keeps`).toBe(n);
    const pitch = 24 * Math.PI / 180, hk = Math.cos(pitch), dk = Math.sin(pitch);
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[6 * i] / fit, y = F[i * SF + 1], z = ((pts[6 * i + 1] + 0.4) / fit + y * dk) / (1.4 * hk);
      worst = Math.max(worst, Math.abs(x - F[i * SF]), Math.abs(z - F[i * SF + 16]));
    }
    expect(worst, `${name}: the preview's leaves are the cast's`).toBeLessThan(1e-4);
  }
});

// ---- 11. light decides: a shade leaf ranks low ---------------------------------------------------------------------------------------------
test("light decides: with turn_exposure 1 a leaf hung on the older wood ranks lower in the grove's order of light than a leaf at a tip — it sits under the shell", () => {
  const ranks = [];
  for (const [name, cfg] of [["dense afternoon 7", dense({ ...FALL, leaf_drop: 0 })], ["park 1", { ...PARK, ...FALL, leaf_drop: 0 }]]) {
    const r = grow({ ...cfg, inner_leaves: 0.5 }, name === "park 1", { keep: true }), S = r.season, H = r.g.hier;
    expect(S.rank, `${name}: the build ran the exposure pass`).not.toBe(null);
    let si = 0, ni = 0, st = 0, nt = 0;
    for (let i = 0; i < S.n; i++) {
      const o = SREC * i, tipZ = H.twigs[S.rec[o + 6]].z;
      if (S.rec[o + 2] !== tipZ) { si += S.rank[i]; ni++; } else { st += S.rank[i]; nt++; }
    }
    expect(ni, `${name}: inner leaves`).toBeGreaterThan(100);
    expect(nt, `${name}: tip leaves`).toBeGreaterThan(100);
    expect(si / ni, `${name}: mean rank, inner ${(si / ni).toFixed(3)} vs tip ${(st / nt).toFixed(3)}`).toBeLessThan(st / nt);
    ranks.push(`${name}: ${ni} inner leaves mean rank ${(si / ni).toFixed(3)}, ${nt} tip leaves ${(st / nt).toFixed(3)}`);
  }
  console.log(`\nrank of light at inner_leaves 0.5 (bun): ${ranks.join(" | ")}`);
});

test("a leaf is lit and falls from the height it hangs at: the order of light is the one the season record's own leaves give, and a fallen leaf's place and height are its record's", () => {
  const over = { ...dense({ ...FALL }), inner_leaves: 0.5 };
  const r = grow(over, false, { keep: true }), S = r.season, n = S.n;
  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), A = new Float64Array(n), K = new Float64Array(n);
  for (let i = 0; i < n; i++) { const o = SREC * i; X[i] = S.rec[o]; Y[i] = S.rec[o + 1]; Z[i] = S.rec[o + 2]; A[i] = S.rec[o + 5]; K[i] = math.leafClock(r.params.seed, S.rec[o + 6], S.rec[o + 7]); }
  const rank = math.exposureRank(math.exposureGrid(X, Y, Z, A, S.E), K);   // what reseasonGrove builds from the record when the build kept none
  expect(firstDiff(rank, S.rank), "the build's rank is the record's").toBe(null);
  const flat = grow({ ...over, inner_leaves: 0 }, false, { keep: true });
  expect(firstDiff(S.rank, flat.season.rank), "...and it is not the tip-only grove's: the wood leaves changed who shades whom").not.toBe(null);
  const d = grow({ ...over, phenology: 0.95, leaf_drop: 1 }, false, { keep: true });
  expect(d.litter.length, "leaves have let go (not vacuous)").toBeGreaterThan(1000);
  let onWood = 0;
  const dByAddr = new Map(); for (let i = 0; i < d.season.n; i++) dByAddr.set(`${d.season.rec[SREC * i + 6]}/${d.season.rec[SREC * i + 7]}`, SREC * i);
  for (const l of d.litter) {
    const o = dByAddr.get(`${l.j}/${l.k}`);
    if (!Object.is(l.x, d.season.rec[o]) || !Object.is(l.y, d.season.rec[o + 1]) || !Object.is(l.h, d.season.rec[o + 2])) throw new Error(`fallen leaf ${l.j}/${l.k} does not fall from its record's place and height`);
    if (l.h !== d.g.hier.twigs[l.j].z) onWood++;
  }
  expect(onWood, "...and many of them fell from the wood, not from a twig tip").toBeGreaterThan(d.litter.length * 0.25);
});

// ---- 12. the wind: reported, not fixed ---------------------------------------------------------------------------------------------------------
// A faithful leaf pivots on its twig's base, so a leaf hung back along a limb swings with the TWIG and slides off the wood it hangs on. The slip is the twig's bend times the leaf's distance from the twig
// base. Measured here as the largest twig angle the springs reach in a second of park 1's squally wind, times each inner leaf's plan distance from its twig base (the arc it is carried that the wood is not).
function windSlip(cfg, inner, seconds = 1) {
  const r = growWith({ ...cfg, inner_leaves: inner }, true), H = r.g.hier, params = r.params;
  const motion = { time: 0, u: 0, v: 0, uLat: 0, vLat: 0, env: 0, driveEnv: 0, sway: [0, 0], windX: 1, windY: 0, weatherS: 1 };
  const gl = new Proxy({}, { get: () => () => ({}) });
  const hub = { gl, params, motion, faithfulOn: () => true, grove: { hier: H, clusterTex: {} }, groveIn: null };
  const { tick } = makeMotion(hub);
  const peak = new Float64Array(H.nClusterTotal);
  for (let f = 0; f < 60 * seconds; f++) { tick(1 / 60); for (let j = 0; j < H.nClusterTotal; j++) peak[j] = Math.max(peak[j], Math.abs(H.twigAngle[j])); }
  const F = r.faithLeaves, slips = [];
  for (let i = 0; i < F.length / SF; i++) {
    const j = Math.floor(F[i * SF + 11]), t = H.twigs[j];
    if (F[i * SF + 16] === Math.fround(t.z)) continue;   // a tip leaf: on its twig (the buffer is float32)
    slips.push(peak[j] * Math.hypot(F[i * SF] - t.bx, F[i * SF + 1] - t.by));
  }
  return { slips, peakMax: Math.max(...peak) };
}
test("the wind slip, pinned to what the spec quotes: park 1's squally wind from rest — at its own twig_flex 0.18 the first second carries no inner leaf off its wood by a leaf length (0.15 m); half a minute, and the engine's default twig_flex, carry some", () => {
  const rows = [], got = {};
  for (const [label, flex] of [["twig_flex 0.18 (park 1's own)", 0.18], ["twig_flex 0.35 (the engine default)", 0.35]]) for (const seconds of [1, 30]) {
    const { slips, peakMax } = windSlip({ ...PARK, twig_flex: flex }, 0.5, seconds);
    const mean = slips.reduce((s, v) => s + v, 0) / slips.length, over = slips.filter((v) => v > 0.15).length, max = Math.max(...slips);
    got[`${flex}/${seconds}`] = { peakMax, max, mean, share: over / slips.length };
    rows.push(`${label}, ${String(seconds).padStart(2)} s: ${slips.length} inner leaves, peak twig angle ${peakMax.toFixed(3)} rad, slip max ${max.toFixed(3)} m, mean ${mean.toFixed(3)} m, ${(100 * over / slips.length).toFixed(1)}% beyond a leaf length (0.15 m)`);
    expect(slips.length).toBeGreaterThan(1000);
    expect(slips.every(Number.isFinite)).toBe(true);
  }
  console.log(`\nwind slip, park 1 squally (bun):\n  ${rows.join("\n  ")}`);
  // The wind and the springs are deterministic; the bounds are loose (about the measured value either way) for another platform's last bits and so the next tune of the wind moves the spec's quote on purpose, not by drift.
  // Measured here: 0.18, 1 s: 0.051 rad, max 0.074 m, mean 0.008 m, none past a leaf. 0.18, 30 s: 0.197 rad, 0.255 m, 0.051 m, 4.8 %. 0.35, 1 s: 0.098 rad, 0.144 m. 0.35, 30 s: 0.383 rad, 0.496 m, 0.098 m, 20.2 %.
  const a = got["0.18/1"], b = got["0.18/30"], c = got["0.35/1"], d = got["0.35/30"];
  expect(a.max, "park 1's own twig_flex, the first second: the worst inner leaf stays under a leaf length").toBeLessThan(0.15);
  expect(a.share, "...and none is past it").toBe(0);
  expect(a.peakMax).toBeGreaterThan(0.03); expect(a.peakMax).toBeLessThan(0.08);
  expect(a.max).toBeGreaterThan(0.04); expect(a.max).toBeLessThan(0.11);
  expect(a.mean).toBeGreaterThan(0.004); expect(a.mean).toBeLessThan(0.016);
  expect(b.peakMax).toBeGreaterThan(0.12); expect(b.peakMax).toBeLessThan(0.3);
  expect(b.max, "half a minute carries the worst leaf past a leaf length").toBeGreaterThan(0.15); expect(b.max).toBeLessThan(0.4);
  expect(b.mean).toBeGreaterThan(0.025); expect(b.mean).toBeLessThan(0.09);
  expect(b.share).toBeGreaterThan(0.01); expect(b.share).toBeLessThan(0.12);
  expect(c.max).toBeGreaterThan(0.08); expect(c.max).toBeLessThan(0.25);
  expect(d.max).toBeGreaterThan(0.3); expect(d.max).toBeLessThan(0.8);
  expect(d.share, "at the engine's default twig_flex about a fifth are past a leaf length").toBeGreaterThan(0.1); expect(d.share).toBeLessThan(0.35);
});

// ---- 13. the editor ------------------------------------------------------------------------------------------------------------------------
test("the editor offers it: a canopy row in the Density area, just before the spread, and a help text in the editor's voice", () => {
  const src = read("./editor.js");
  const row = src.indexOf("['s','inner_leaves','inner leaves',0,1,0.01,'canopy']"), spread = src.indexOf("['s','cluster_spread_m'");
  expect(row, "the row").toBeGreaterThan(-1);
  expect(row).toBeLessThan(spread);
  expect(spread - row, "right before cluster_spread_m").toBeLessThan(500);
  expect(src, "its help").toMatch(/\n {2}inner_leaves:"<b>/);
});
