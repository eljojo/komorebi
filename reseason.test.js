// ============================================================================
// Re-seasoning (spec §4.5, P2b): the season is a function of the grove, not a regrow. Everything a phenology change moves
// (τ_j, the retained weight, which leaves are compacted out, the litter list, leafW, the faithful AABB) is re-run over the
// per-leaf record a grove built with `keepSeason` keeps, and it must land BIT FOR BIT where a fresh buildGrove at the same
// params lands — the tween's landing tick is the resting state, and nothing regrows on release. Held loudly because every way
// it breaks is silent: a float32 where the litter wants the double, a cached rank that a blend wrote into, a key that missed a
// param buildGrove reads (a stale grove that looks fine), a carpet whose signature never noticed the leaves changed colour.
// (The drop.test.js stub-GL rig; the engine tests drive the real create() over the same stub.)
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { CANOPY_KEYS, DEFAULTS, create } from "./komorebi.js";
import * as paramsMod from "./komorebi-params.js";
import * as groveMod from "./komorebi-grove.js";
import { makeGrove } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";
import { macroParams } from "./macros.js";

// ---- the rig: one stub GL per hub (a grove writes the engine-global faith.* of ITS hub, so the cached grove and the fresh
// builds it is held to each get their own) ------------------------------------------------------------------------------
function rig(params, faithful = false) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const faith = {}, hub = { gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  return { hub, faith, params, G: makeGrove(hub) };
}
const bitsOf = (a) => new Uint32Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
const firstDiff = (a, b) => {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  const x = bitsOf(a), y = bitsOf(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `first bit difference at ${i}`;
  return null;
};
// what a grove put on the GPU, copied out (the re-season reuses its output arrays between ticks, so a snapshot must own its bytes)
const snapshot = (R, g) => ({
  layers: g.layerVAO.map((l) => Float32Array.from(l.buf.data)),
  counts: g.layerVAO.map((l) => l.count),
  faith: Float32Array.from(R.faith.buf.data),
  faithCount: R.faith.count,
  aabb: [R.faith.pminx, R.faith.pmaxx, R.faith.pminy, R.faith.pmaxy],
  litter: g.litter == null ? null : JSON.parse(JSON.stringify(g.litter)),
  leafW: g.hier.leafW == null ? null : Float32Array.from(g.hier.leafW),
});
function compare(label, got, want) {
  expect(got.layers.length, `${label}: layers`).toBe(want.layers.length);
  got.layers.forEach((a, l) => { expect(firstDiff(a, want.layers[l]), `${label}: layer ${l} buffer`).toBe(null); });
  expect(got.counts, `${label}: layer counts`).toEqual(want.counts);
  expect(firstDiff(got.faith, want.faith), `${label}: faithful buffer`).toBe(null);
  expect(got.faithCount, `${label}: faithful count`).toBe(want.faithCount);
  got.aabb.forEach((v, i) => { expect(Object.is(v, want.aabb[i]), `${label}: AABB ${i} ${v} vs ${want.aabb[i]}`).toBe(true); });
  expect(JSON.stringify(got.litter), `${label}: litter list (sizes as doubles)`).toBe(JSON.stringify(want.litter));
  if (want.leafW === null) expect(got.leafW, `${label}: leafW`).toBe(null);
  else expect(firstDiff(got.leafW, want.leafW), `${label}: leafW`).toBe(null);
}

// a grove worth shading itself, small enough to be built a few dozen times: the afternoons' leaf and structure, 3 depth layers,
// a marginal leaf (6 × 1.25 = 7.5 a twig) and a fall that turns, lights the ranking and lets go
const SMALL = { ...PRESETS["afternoon 7"], tree_count: 2, leaves_per_cluster: 6, foliage_density: 1.25, layer_count: 3,
  leaf_drop: 1, turn_exposure: 1, anthocyanin: 0.4, tannin: 0.2, wall_fraction: 0.2 };
const PH = [0.5, 0.6, 0.65, 0.7, 0.742, 0.8, 0.9, 1.0];

// every variant: build with keepSeason at the first phenology, re-season through the rest, and hold each stop to a fresh build
function identity(name, over, { faithful = false, phs = PH, move = () => ({}) } = {}) {
  test(`byte-identity vs a fresh buildGrove: ${name}`, () => {
    const base = { ...SMALL, ...over };
    const A = rig({ ...base, phenology: phs[0] }, faithful), B = rig({ ...base }, faithful);
    const g = A.G.buildGrove(null, { keepSeason: true });
    let sawLitter = false, sawPartial = false;
    for (const p of phs) {
      const step = { phenology: p, ...move(p) };
      Object.assign(A.params, step);
      A.G.reseasonGrove(g, A.params);
      Object.assign(B.params, step);
      const fresh = B.G.buildGrove(null);
      const want = snapshot(B, fresh);
      compare(`${name} @ ${p}`, snapshot(A, g), want);
      if (want.litter?.length) sawLitter = true;
      if (want.leafW?.some((w) => w > 0 && w < 1)) sawPartial = true;
    }
    if (base.leaf_drop > 0) { expect(sawLitter, "the variant must actually drop leaves, or it proves nothing").toBe(true); expect(sawPartial, "...and catch some mid-fade").toBe(true); }
  });
}

identity("layer path, exposure_absolute 0 (the rank is u)", { exposure_absolute: 0 });
identity("faithful path", { exposure_absolute: 0 }, { faithful: true });
identity("maple outline (the cluster id carries the variant in its fraction)", { leaf_shape: "maple", leaf_aspect: 1, leaf_size_m: 0.0756 });
identity("maple outline, faithful", { leaf_shape: "maple", leaf_aspect: 1, leaf_size_m: 0.0756 }, { faithful: true });
identity("fractional density and tree count (a marginal leaf and a marginal tree)", { foliage_density: 1.3, tree_count: 2.4 });
identity("fractional density and tree count, faithful", { foliage_density: 1.3, tree_count: 2.4 }, { faithful: true });
identity("exposure_absolute 0.5 (the blend is a fresh array each tick)", { exposure_absolute: 0.5 });
identity("exposure_absolute 1 (u is the raw exposure)", { exposure_absolute: 1 });
identity("turn_exposure 0, drop_exposure 1 (the drop consumes the rank: the exposure field must be built)", { turn_exposure: 0, drop_exposure: 1 });
identity("drop_exposure 0 (the hash alone: no exposure at all unless the turn asks)", { drop_exposure: 0, turn_exposure: 0 });
identity("drop_exposure 0 with turn_exposure 1", { drop_exposure: 0 });
identity("leaf_drop 0 (no litter, no leafW)", { leaf_drop: 0 });
identity("leaf_drop 0.6 (a marcescent share)", { leaf_drop: 0.6 });
identity("tannin and wall_fraction moving with the clock", { leaf_drop: 0 }, { move: (p) => ({ tannin: 0.2 + p * 0.3, wall_fraction: 0.6 * (1 - p) }) });
// After the turn: the window each leaf turns in, and the day it lets go, are one law on this side of the cache. Extra stops put the branch in view: the first leaf lets go
// at turn_start + L + lag (0.78 here), so 0.8 is mid-fade for the earliest and 0.85 for a good share. `identity` fails any variant whose stops never drop a leaf or never catch one mid-fade.
const AFTER_PH = [0.5, 0.6, 0.7, 0.775, 0.8, 0.82, 0.85, 0.9, 0.95, 1.0];
identity("drop after the turn", { drop_after_turn: 1 }, { phs: AFTER_PH });
identity("drop after the turn, faithful", { drop_after_turn: 1 }, { faithful: true, phs: AFTER_PH });
identity("drop after the turn, turn_exposure 0 (the leaf's own clock) with leaf_drop 0.6", { drop_after_turn: 1, turn_exposure: 0, leaf_drop: 0.6 }, { phs: AFTER_PH });
identity("drop after the turn, drop_lag moving with the clock", { drop_after_turn: 1 }, { phs: AFTER_PH, move: (p) => ({ drop_lag: 0.02 + p * 0.08 }) });
identity("turn_start, turn_span, turn_spread, drop_start, drop_span moving (the whole season set)", {}, { move: (p) => ({ turn_start: 0.55 + p * 0.05, turn_span: 0.3 + p * 0.1, turn_spread: 0.2 * p, drop_start: 0.6 + p * 0.05, drop_span: 0.25 + p * 0.05 }) });
// One tree ahead of its neighbours (`tree_clock_spread`, `tree_pigment_spread`; tree.test.js holds the laws): the lead and the depth are tables of the tree count the record keeps, and the loop
// reads each leaf's tree off its twig, so the re-season makes the build's own four calls (the two drop days, the turn and the tau) with the same dT and cT, bit for bit.
identity("per-tree clock", { tree_clock_spread: 0.1, drop_after_turn: 1 }, { phs: AFTER_PH });
identity("per-tree clock, faithful", { tree_clock_spread: 0.1, drop_after_turn: 1 }, { faithful: true, phs: AFTER_PH });
identity("per-tree clock, the old drop clock (it shifts too)", { tree_clock_spread: 0.1 });
identity("per-tree pigment", { tree_pigment_spread: 0.6 });
identity("per-tree clock on a marginal tree (it draws its own lead)", { tree_count: 2.4, tree_clock_spread: 0.1 });
identity("per-tree pigment on a marginal tree, faithful", { tree_count: 2.4, tree_pigment_spread: 0.6 }, { faithful: true });
identity("both knobs moving with the clock", {}, { move: (p) => ({ tree_clock_spread: 0.15 * p, tree_pigment_spread: 0.9 * (1 - p) }) });
identity("both knobs moving with the clock, after the turn", { drop_after_turn: 1 }, { phs: AFTER_PH, move: (p) => ({ tree_clock_spread: 0.15 * (1 - p), tree_pigment_spread: 0.9 * p }) });

// Leaves on the older wood (`inner_leaves`, inner.test.js holds the laws): a canopy key the cache key carries, so the season never moves it, but a re-season keeps every leaf where the grove put it —
// its place, its height and its layer, which the record kept — and so lands where a fresh build at the same params lands, on both paths, mid-fall, with the light ordering the leaves it hangs on the wood.
identity("inner leaves 0.4 (a leaf's own height and layer are in the record)", { inner_leaves: 0.4 });
identity("inner leaves 0.4, faithful", { inner_leaves: 0.4 }, { faithful: true });
identity("inner leaves 0.4, marginal leaf and tree, after the turn, with the per-tree clock", { inner_leaves: 0.4, foliage_density: 1.3, tree_count: 2.4, drop_after_turn: 1, tree_clock_spread: 0.1 }, { phs: AFTER_PH });
identity("inner leaves 0.4, maple outline, faithful", { inner_leaves: 0.4, leaf_shape: "maple", leaf_aspect: 1, leaf_size_m: 0.0756 }, { faithful: true });
// Leaf variety (`leaf_variety`, variety.test.js holds the laws): each leaf's outline row and size shift come from the grove's own rank of light, on the summer set, BEFORE the season base is taken — so the record the re-season
// reads carries the row in the cluster id and the shifted half-axes, the litter list carries the row it lies in, and a re-season lands bit for bit where a fresh build lands, on both paths, mid-fall, with the shifted
// areas never fed back to the light (the record keeps the pre-shift area: the season's rank at any variety is the variety-0 rank).
const VAR = { leaf_shape: "maple", leaf_aspect: 1, leaf_size_m: 0.0756, leaf_variety: 1 };
identity("leaf variety 1, maple (the row rides the cluster id; the litter keeps it)", VAR);
identity("leaf variety 1, maple, faithful", VAR, { faithful: true });
identity("leaf variety 1, maple, inner leaves 0.4", { ...VAR, inner_leaves: 0.4 });
identity("leaf variety 1, maple, marginal leaf and tree", { ...VAR, tree_count: 2.4, foliage_density: 1.3 });
identity("leaf variety 1, maple, exposure_absolute 0.5", { ...VAR, exposure_absolute: 0.5 });
identity("leaf variety 1, maple, unlit (the row needs the light whether or not the turn does)", { ...VAR, turn_exposure: 0, drop_exposure: 0, leaf_drop: 1 });
// The UNLIT arm. SMALL turns by the light (turn_exposure 1), and a lit leaf's tau is overwritten by the exposure arm of the rewrite; every variant above therefore leaves the other arm — the one a grove with
// turn_exposure 0 takes, `FEAT_PIGMENT && sen` — free to lose its lead or its depth with nothing failing. These turn by the leaf's own clock alone: with no drop (the hang loop's tau is the only
// tau, and the re-season's sen-only arm must reproduce it for every leaf), with the hash-only old drop clock (the rewrite's non-lit arm, for the leaves that go), and after the turn.
identity("unlit per-tree clock (the sen-only arm carries the lead)", { tree_clock_spread: 0.1, turn_exposure: 0, leaf_drop: 0 });
identity("unlit per-tree pigment (the sen-only arm carries the depth)", { tree_pigment_spread: 0.6, anthocyanin: 0.8, turn_exposure: 0, leaf_drop: 0 });
identity("unlit per-tree clock and pigment, the old drop clock on the hash alone", { tree_clock_spread: 0.1, tree_pigment_spread: 0.6, turn_exposure: 0, drop_exposure: 0, leaf_drop: 1 });
identity("unlit per-tree clock and pigment, the old drop clock on the hash alone, faithful", { tree_clock_spread: 0.1, tree_pigment_spread: 0.6, turn_exposure: 0, drop_exposure: 0, leaf_drop: 1 }, { faithful: true });
identity("unlit per-tree clock and pigment, after the turn", { tree_clock_spread: 0.1, tree_pigment_spread: 0.6, turn_exposure: 0, drop_after_turn: 1, leaf_drop: 1 }, { phs: AFTER_PH });

test("an anthocyanin-only change: the leaves recolour, none drops, and it is a fresh build's bytes", () => {
  const base = { ...SMALL, leaf_drop: 0, phenology: 0.8 };
  const A = rig(base), B = rig(base);
  const g = A.G.buildGrove(null, { keepSeason: true });
  const before = snapshot(A, g);
  for (const anthocyanin of [0.9, 0.1, 0.4]) {
    Object.assign(A.params, { anthocyanin }); Object.assign(B.params, { anthocyanin });
    A.G.reseasonGrove(g, A.params);
    const got = snapshot(A, g), want = snapshot(B, B.G.buildGrove(null));
    compare(`anthocyanin ${anthocyanin}`, got, want);
    expect(got.litter, "nothing dropped").toBe(null);
    expect(got.counts).toEqual(before.counts);
    if (anthocyanin !== 0.4) expect(firstDiff(got.layers[0], before.layers[0]), "the colour moved").not.toBe(null);
  }
});

// ---- path independence: the cache is never mutated ---------------------------------------------------------------------
test("path independence: p1 then p2 is p2 directly (and back to the first is the first)", () => {
  const A = rig({ ...SMALL, phenology: 0.5 }), C = rig({ ...SMALL, phenology: 0.5 });
  const g = A.G.buildGrove(null, { keepSeason: true }), h = C.G.buildGrove(null, { keepSeason: true });
  Object.assign(A.params, { phenology: 0.8 }); A.G.reseasonGrove(g, A.params);
  const at08 = snapshot(A, g);
  Object.assign(A.params, { phenology: 0.95 }); A.G.reseasonGrove(g, A.params);
  Object.assign(A.params, { phenology: 0.72, exposure_absolute: 0.5 }); A.G.reseasonGrove(g, A.params);
  Object.assign(A.params, { phenology: 0.8, exposure_absolute: 0 }); A.G.reseasonGrove(g, A.params);
  compare("0.8 by way of 0.95, 0.72 (blended)", snapshot(A, g), at08);
  Object.assign(C.params, { phenology: 0.8 }); C.G.reseasonGrove(h, C.params);
  compare("0.8 directly", snapshot(C, h), at08);
});

// ---- laziness ------------------------------------------------------------------------------------------------------------
test("laziness: a summer build keeps no season cache unless asked; ex and rank wait for a gate that needs u", () => {
  const S = rig({ ...SMALL, phenology: 0.5 });
  expect(S.G.buildGrove(null).season, "no cache unless asked").toBeUndefined();
  const A = rig({ ...SMALL, phenology: 0.5 });
  const g = A.G.buildGrove(null, { keepSeason: true });
  expect(g.season.ex).toBe(null);
  expect(g.season.rank).toBe(null);
  Object.assign(A.params, { phenology: 0.58 }); A.G.reseasonGrove(g, A.params);   // below turn_start and below drop_start − ε: no gate needs the light
  expect(g.season.ex).toBe(null);
  Object.assign(A.params, { phenology: 0.8 }); A.G.reseasonGrove(g, A.params);
  expect(g.season.ex).not.toBe(null);
  const rank = g.season.rank, copy = Float64Array.from(rank);
  Object.assign(A.params, { phenology: 0.9, exposure_absolute: 0.5 }); A.G.reseasonGrove(g, A.params);
  Object.assign(A.params, { phenology: 0.7, exposure_absolute: 1 }); A.G.reseasonGrove(g, A.params);
  expect(g.season.rank, "the same object").toBe(rank);
  expect(firstDiff(rank, copy), "never written into").toBe(null);
  // the drop alone asks for the light, and only while drop_exposure > 0
  const D = rig({ ...SMALL, phenology: 0.5, turn_exposure: 0, drop_exposure: 0 });
  const d = D.G.buildGrove(null, { keepSeason: true });
  Object.assign(D.params, { phenology: 0.9 }); D.G.reseasonGrove(d, D.params);
  expect(d.season.ex, "drop_exposure 0 and turn_exposure 0: nothing asks for u").toBe(null);
  Object.assign(D.params, { drop_exposure: 1 }); D.G.reseasonGrove(d, D.params);
  expect(d.season.ex).not.toBe(null);
});

test("a fall build keeps the exposure field it ran, and it is the one the first re-season would have built", () => {
  const F = rig({ ...SMALL, phenology: 0.8, exposure_absolute: 0.5 });
  const f = F.G.buildGrove(null, { keepSeason: true });
  expect(f.season.ex, "the build ran the pass: the record keeps it").not.toBe(null);
  expect(f.season.rank).not.toBe(null);
  const L = rig({ ...SMALL, phenology: 0.5, exposure_absolute: 0.5 });   // the same grove from a summer cache: its first fall re-season builds them
  const l = L.G.buildGrove(null, { keepSeason: true });
  Object.assign(L.params, { phenology: 0.8 }); L.G.reseasonGrove(l, L.params);
  expect(firstDiff(f.season.ex, l.season.ex), "the field").toBe(null);
  expect(firstDiff(f.season.rank, l.season.rank), "the keyed rank").toBe(null);
  const rank = f.season.rank, copy = Float64Array.from(rank);
  Object.assign(F.params, { phenology: 0.9, exposure_absolute: 0 }); F.G.reseasonGrove(f, F.params);
  expect(f.season.rank, "reused, not rebuilt").toBe(rank);
  expect(firstDiff(rank, copy), "never written into").toBe(null);
});

test("leaf variety: the build keeps the rank of light its rows were drawn by, a re-season reuses it (never writes into it) and never touches the table of rows", () => {
  const A = rig({ ...SMALL, ...VAR, phenology: 0.5, exposure_absolute: 0 });   // a summer build: nothing asks for the light but the rows
  const g = A.G.buildGrove(null, { keepSeason: true });
  expect(g.season.ex, "the pass ran the field for the rows: the record keeps it").not.toBe(null);
  expect(g.season.rank).not.toBe(null);
  const rank = g.season.rank, copy = Float64Array.from(rank), rows = Uint8Array.from(g.hier.leafRow), ex = g.season.ex;
  expect(rows.some((r) => r !== rows[0]), "the rows differ").toBe(true);
  for (const step of [{ phenology: 0.8 }, { phenology: 0.9, exposure_absolute: 0.5 }, { phenology: 0.72, exposure_absolute: 1 }, { phenology: 0.8, exposure_absolute: 0 }]) {
    Object.assign(A.params, step); A.G.reseasonGrove(g, A.params);
    expect(g.season.rank, `${JSON.stringify(step)}: the same object`).toBe(rank);
    expect(g.season.ex).toBe(ex);
    expect(firstDiff(rank, copy), "never written into").toBe(null);
    expect(Array.from(g.hier.leafRow), "the rows are the shape's, not the season's").toEqual(Array.from(rows));
  }
});

// ---- the key ---------------------------------------------------------------------------------------------------------------
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
test("the key: SEASON_KEYS is a subset of CANOPY_KEYS, and the key list is exactly what buildGrove reads besides the season set", () => {
  const SEASON = paramsMod.SEASON_KEYS;
  expect(SEASON.length).toBe(16);
  for (const k of SEASON) expect(CANOPY_KEYS, k).toContain(k);
  expect([...SEASON].sort()).toEqual(["anthocyanin", "drop_exposure", "drop_lag", "drop_span", "drop_start", "exposure_absolute", "leaf_drop", "phenology", "tannin", "tree_clock_spread", "tree_pigment_spread", "turn_exposure", "turn_spread", "turn_span", "turn_start", "wall_fraction"].sort());
  const src = read("./komorebi-grove.js");
  const reads = new Set([...src.matchAll(/params\.([a-z_0-9]+)/g)].map((m) => m[1]).filter((k) => k in DEFAULTS));
  const season = new Set(SEASON), listed = new Set(groveMod.GROVE_READS);
  for (const k of reads) expect(season.has(k) || listed.has(k), `buildGrove reads params.${k}: it is neither in the season set nor in the key`).toBe(true);
  // the listed keys buildGrove does not name itself reach it through faithfulOn() — which the key also carries, as the boolean it is
  // ...or through the math it hands params to: drop_after_turn is a flip the key must carry (it moves every leaf's day and its mid-turn colour) and is read as P.drop_after_turn in komorebi-math.js
  const mathSrc = read("./komorebi-math.js"), mathReads = new Set([...mathSrc.matchAll(/\bP\.([a-z_0-9]+)/g)].map((m) => m[1]));
  for (const k of listed) expect(reads.has(k) || ["faithful_canopy", "receiver"].includes(k) || mathReads.has(k), `${k} is in the key but buildGrove never reads it`).toBe(true);
  expect(listed.has("drop_after_turn"), "a flip of the flag invalidates the cache").toBe(true);
  for (const k of listed) { expect(k in DEFAULTS, k).toBe(true); expect(season.has(k), `${k} is a season key`).toBe(false); }
  // and what the math functions it hands params to read (leafTau, senescence, dropDay) is the season set, nothing else
  const math = read("./komorebi-math.js");
  const P = new Set([...math.matchAll(/\bP\.([a-z_0-9]+)/g)].map((m) => m[1]));
  for (const k of P) expect(season.has(k) || listed.has(k), `komorebi-math.js reads P.${k}, a season-set key (or one the cache key carries)?`).toBe(true);
});

// ---- the engine: apply('season') decides fast or full -------------------------------------------------------------------
function engineRig(over) {
  const counts = { createBuffer: 0, createVertexArray: 0, bufferData: 0 };
  globalThis.requestAnimationFrame = () => 0;
  const gl = new Proxy({}, {
    get(t, name) {
      if (typeof name !== "string") return undefined;
      if (name === "getParameter") return () => 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return () => true;
      if (name === "createBuffer") return () => { counts.createBuffer++; return { data: null }; };
      if (name === "createVertexArray") return () => { counts.createVertexArray++; return {}; };
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, d) => { counts.bufferData++; if (t.cur) t.cur.data = d; };
      return () => ({});
    },
  });
  const canvas = { getContext: () => gl, addEventListener() {}, removeEventListener() {}, clientWidth: 100, clientHeight: 100, width: 100, height: 100 };
  const eng = create(canvas, { params: { ...SMALL, phenology: 0.8, ...over } });
  eng.setPaused(true);
  return { eng, counts };
}
const built = (counts) => counts.createBuffer + counts.createVertexArray;

test("apply('season'): the first builds with the cache (a full path); a season-set-only change after it re-seasons — nothing is built", () => {
  const { eng, counts } = engineRig({});
  let b = built(counts);
  expect(eng.apply("season"), "no cache yet: a full build says so").toBe("build");
  expect(built(counts), "no cache yet: one full build").toBeGreaterThan(b);
  for (const change of [{ phenology: 0.85 }, { phenology: 0.9, anthocyanin: 0.7 }, { leaf_drop: 0.5, drop_start: 0.72, turn_start: 0.58 }, { exposure_absolute: 0.5 }, { tree_clock_spread: 0.1 }, { tree_pigment_spread: 0.6 }]) {
    b = built(counts);
    Object.assign(eng.params, change);
    expect(eng.apply("season"), `${JSON.stringify(change)}: the cache was used`).toBe("reseason");
    expect(built(counts), `${JSON.stringify(change)}: the fast path builds no buffer`).toBe(b);
  }
});

test("apply('season'): a param buildGrove reads besides the season set takes the full path", () => {
  const cases = [{ view_extent_m: 5.1 }, { seed: 4242 }, { faithful_canopy: true }, { foliage_density: 1.4 }, { leaf_shape: "maple" }, { leaf_shape: "maple", leaf_variety: 1 }, { leaf_variety: 0.5 }, { canopy_base_height_m: 2.4 },
    { canopy_thickness_m: 1.1 }, { trunk_radius_m: 0.21 }, { tree_count: 3 }, { drop_after_turn: 1 }, { trans_g: 0.4 }, { limb_count: 5 }, { leaf_size_m: 0.13 }, { sky_view: true }, { inner_leaves: 0.3 }];
  for (const change of cases) {
    const { eng, counts } = engineRig({});
    eng.apply("season");                                   // the cache
    const b = built(counts);
    Object.assign(eng.params, change);
    expect(eng.apply("season"), `${JSON.stringify(change)} must regrow`).toBe("build");
    expect(built(counts), `${JSON.stringify(change)} must regrow`).toBeGreaterThan(b);
  }
});

test("apply('season'): while a transition is active the grove is rebuilt, not re-seasoned (the target grove shares the engine-global faith.*)", () => {
  const { eng, counts } = engineRig({});
  eng.apply("season");
  eng.trans.active = true;
  const b = built(counts);
  Object.assign(eng.params, { phenology: 0.85 });
  eng.apply("season");
  expect(built(counts)).toBeGreaterThan(b);
});

test("apply('season'): the carpet's grove is dropped, so the next refreshLitter bakes (its signature keys on the grove, not the capacities)", () => {
  const { eng } = engineRig({});
  eng.apply("season");
  eng.litter.grove = "sentinel";
  Object.assign(eng.params, { anthocyanin: 0.9 });          // an anthocyanin-only re-season: phenology and the litter keys unmoved
  eng.apply("season");
  expect(eng.litter.grove).toBe(null);
});

// ---- the record is kept only when the structure has stopped moving ----------------------------------------------------------
// A season apply that has to build (no cache, or a stale one) used to keep the per-leaf record every time. On the season slider's spring half every tick moves structure, so every
// tick built a record (~5 ms, ~7 MB on afternoon 7) that the next tick threw away. It is kept now when the structure being built is the one the grove on screen was grown for.
test("apply('season') over a sweep that moves the structure: no tick keeps a season record; the first with the structure settled keeps one and the apply after it is fast; every frame is a fresh build's", () => {
  const { eng } = engineRig({});
  const fresh = (label) => { const B = rig({ ...eng.params }); compare(label, snapshot(eng, eng.grove()), snapshot(B, B.G.buildGrove(null))); };
  for (const foliage_density of [1.1, 1.2, 1.3, 1.4, 1.5]) {
    Object.assign(eng.params, { foliage_density, phenology: 0.8 });
    expect(eng.apply("season"), `density ${foliage_density}`).toBe("build");
    expect(eng.grove().season, `density ${foliage_density}: the structure moved, so the next tick would throw the record away`).toBeUndefined();
    fresh(`density ${foliage_density}`);
  }
  Object.assign(eng.params, { phenology: 0.85 });
  expect(eng.apply("season"), "the structure is the one just built: this regrow keeps the record").toBe("build");
  expect(eng.grove().season, "...and it is there").toBeDefined();
  fresh("settled, with the record");
  Object.assign(eng.params, { phenology: 0.9, anthocyanin: 0.7 });
  expect(eng.apply("season"), "the apply after it takes the fast path").toBe("reseason");
  fresh("re-seasoned");
  Object.assign(eng.params, { foliage_density: 1.6 });
  expect(eng.apply("season"), "the structure moves again").toBe("build");
  expect(eng.grove().season, "...and the record is not kept").toBeUndefined();
  fresh("moving again");
});

// ---- the cost: reported, not asserted -------------------------------------------------------------------------------------------
const med = (f, n = 7) => { const ts = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); f(); ts.push(performance.now() - t0); } ts.sort((a, b) => a - b); return ts[n >> 1]; };
test("cost (reported): a fall frame by regrow and by re-season at t 0.9, median of 7", () => {
  const rows = [];
  for (const [look, faithful, own] of [["afternoon 7", false, false], ["the void", false, false], ["montebello", true, true]]) {
    const params = { ...DEFAULTS, ...PRESETS[look], ...(own ? {} : macroParams("season", 0.9)), phenology: 0.9 };
    const R = rig(params, faithful);
    R.G.buildGrove(null); R.G.buildGrove(null, { keepSeason: true });   // warm
    const tBuild = med(() => R.G.buildGrove(null));
    const tKeep = med(() => R.G.buildGrove(null, { keepSeason: true }));
    const g = R.G.buildGrove(null, { keepSeason: true });
    const t0 = performance.now();
    R.G.reseasonGrove(g, R.params);
    const tFirst = performance.now() - t0;                 // the first one: a fall build kept the exposure field, so it no longer pays it
    const tRe = med(() => R.G.reseasonGrove(g, R.params));
    Object.assign(R.params, { phenology: 0.5 });
    const tSummer = med(() => R.G.buildGrove(null));
    Object.assign(R.params, { phenology: 0.9 });
    rows.push(`${look.padEnd(12)} summer build ${tSummer.toFixed(1).padStart(6)} | fall build ${tBuild.toFixed(1).padStart(6)} | fall build+keep ${tKeep.toFixed(1).padStart(6)} | re-season first ${tFirst.toFixed(1).padStart(6)} then ${tRe.toFixed(1).padStart(6)} ms`);
  }
  console.log(`\nre-season cost (bun, ms):\n  ${rows.join("\n  ")}`);
  expect(rows.length).toBe(3);
}, 120000);
