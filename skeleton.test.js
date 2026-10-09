// ============================================================================
// The tree's grammar as a function (spec §4.5, P4a-1): growSkeleton(spec, rng, out) in komorebi-math.js, lifted out of
// buildGrove so a leaf's veins can grow by the same rules (plane: true). The claim worth holding loudly is the one that
// fails SILENTLY: this is a pure refactor, so the grove is the SAME grove — every segment and twig of every species,
// bit for bit — because one reordered draw from the growth stream reshuffles every look there is. The fixtures below
// were captured from the closure grow() BEFORE it moved; the rest holds what the plane variant promises.
// ============================================================================
import { expect, test } from "bun:test";
import { DEFAULTS } from "./komorebi.js";
import { makeGrove } from "./komorebi-grove.js";
import * as math from "./komorebi-math.js";
import { PRESETS, TREE_SPECIES } from "./presets.js";

// ---- a digest of a grove's skeleton: FNV-1a over the bytes of every number, record by record, keys in sorted order,
// so what is pinned is the values and not the order a record happened to be built in (bits: -0 and 0 differ) ----
const f64 = new Float64Array(1), f8 = new Uint8Array(f64.buffer);
function fnv(recs) {
  let h = 0x811c9dc5;
  const byte = (b) => { h = Math.imul(h ^ b, 0x01000193); };
  const num = (v) => {
    if (typeof v !== "number") throw new Error(`a skeleton record holds a non-number: ${v}`);
    f64[0] = v;
    for (let i = 0; i < 8; i++) byte(f8[i]);
  };
  for (const r of recs) {
    for (const k of Object.keys(r).sort()) {
      for (let i = 0; i < k.length; i++) byte(k.charCodeAt(i));
      const v = r[k];
      if (Array.isArray(v)) v.forEach(num); else num(v);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// the recording GL stub (drop.test.js's idiom): buildGrove needs a context to allocate into and nothing from it
function groveOf(over) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = { ...DEFAULTS, tree_count: 2.5, leaves_per_cluster: 2, ...over };   // 2.5: a marginal tree, so its coverage is in the digest too
  const hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => false, occ: {}, faith: {}, sky: { start: [], count: [] } };
  return makeGrove(hub).buildGrove(null).hier;
}

// every species × three seeds (leader > 0: the monopodial trunk, all three phyllotaxis rules, droop both ways); the legacy
// single hub (leader_strength 0, which no species reaches) under each rule and with a droop; and three shipped looks
const CASES = {};
for (const [name, bundle] of Object.entries(TREE_SPECIES)) for (const seed of [1, 1234, 90210]) CASES[`${name}:${seed}`] = { ...bundle, seed };
for (const phyllotaxis of ["spiral", "whorled", "opposite"]) CASES[`hub-${phyllotaxis}`] = { phyllotaxis };
CASES["hub-droop"] = { droop: 0.35 };   // not 0.3: 0.3·(1/3)·5 is 0.49999999999999994, which Math.round sent to 0 cold and to 1 once JavaScriptCore had JITted it, so its digest was never recorded. growNode rounds by hand now; the tie test below holds that
for (const look of ["park 1", "curtain 1", "afternoon 7"]) CASES[look] = { ...PRESETS[look], leaves_per_cluster: 2 };

const FIXTURES = {   // captured from the closure grow() at HEAD d2e996e, before it moved: segment/twig counts and the FNV digest of every record
  "oak:1": { seg: 603, segs: "d2e4d489", tw: 405, twigs: "6a5bc98c" },
  "oak:1234": { seg: 603, segs: "98ce0e4e", tw: 405, twigs: "7c33727d" },
  "oak:90210": { seg: 603, segs: "0a3cbfa3", tw: 405, twigs: "1df21823" },
  "spruce:1": { seg: 678, segs: "fd588b43", tw: 243, twigs: "767cce8c" },
  "spruce:1234": { seg: 678, segs: "b269e889", tw: 243, twigs: "1317435c" },
  "spruce:90210": { seg: 678, segs: "5fec275e", tw: 243, twigs: "d84c27bd" },
  "birch:1": { seg: 1662, segs: "3bc5fc23", tw: 567, twigs: "cbe00293" },
  "birch:1234": { seg: 1662, segs: "c7732877", tw: 567, twigs: "646f4e2d" },
  "birch:90210": { seg: 1662, segs: "a3e046ee", tw: 567, twigs: "f2b8b7ae" },
  "willow:1": { seg: 2439, segs: "010e3c75", tw: 567, twigs: "0b487873" },
  "willow:1234": { seg: 2439, segs: "bd1cc6bb", tw: 567, twigs: "dedb4aca" },
  "willow:90210": { seg: 2439, segs: "9d1bc68b", tw: 567, twigs: "dc2d169e" },
  "maple:1": { seg: 138, segs: "01a922c7", tw: 72, twigs: "a818f92f" },
  "maple:1234": { seg: 138, segs: "3fdc4ab3", tw: 72, twigs: "e07266ad" },
  "maple:90210": { seg: 138, segs: "12aa7088", tw: 72, twigs: "ee243968" },
  "columnar:1": { seg: 795, segs: "bfbdccfb", tw: 324, twigs: "6bc99af1" },
  "columnar:1234": { seg: 795, segs: "7c8db7b7", tw: 324, twigs: "01d423b1" },
  "columnar:90210": { seg: 795, segs: "8873f6ff", tw: 324, twigs: "46c1bc5e" },
  "palm:1": { seg: 171, segs: "ff7316b0", tw: 42, twigs: "d1ce0c19" },
  "palm:1234": { seg: 171, segs: "2d2fafcc", tw: 42, twigs: "8d2f86a7" },
  "palm:90210": { seg: 171, segs: "8d731e67", tw: 42, twigs: "81d5cfb1" },
  "hub-spiral": { seg: 315, segs: "d6a321db", tw: 216, twigs: "8dedcd39" },
  "hub-whorled": { seg: 315, segs: "9d04371a", tw: 216, twigs: "b103e532" },
  "hub-opposite": { seg: 171, segs: "714fdf11", tw: 96, twigs: "537d668f" },
  "hub-droop": { seg: 843, segs: "ec70464d", tw: 216, twigs: "e5858394" },
  "park 1": { seg: 552, segs: "a5ffde76", tw: 198, twigs: "edaf598a" },
  "curtain 1": { seg: 1104, segs: "78834041", tw: 396, twigs: "4d1e7bea" },
  "afternoon 7": { seg: 720, segs: "0fb3c121", tw: 495, twigs: "78a7d80a" },
};

for (const [key, over] of Object.entries(CASES)) {
  test(`${key}: the grove's segments and twigs are the ones grow() grew`, () => {
    const g = groveOf(over);
    const got = { seg: g.segments.length, segs: fnv(g.segments), tw: g.twigs.length, twigs: fnv(g.twigs) };
    expect(JSON.stringify(got), key).toBe(JSON.stringify(FIXTURES[key]));
  });
}

// ---- the function: one place, called by the grove (the tree) and, later, the leaf ----
const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); }); return Object.freeze(o); };
const specOf = (over) => ({ levels: 4, kids: 3, lenRatio: 0.7, coneA: 0.6, droop: 0, phyllo: 0, leader: false, plane: false, base: [0, 0, 0], dir: [1, 0, 0], len: 1, level: 1, limb: 0, ...over });
const fresh = () => ({ seg: [], tw: [] });
const grown = (spec, seed = 7) => { const out = fresh(); math.growSkeleton(spec, math.mulberry32(seed), out); return out; };
const counting = (seed) => { const r = math.mulberry32(seed), draws = []; const rng = () => { const v = r(); draws.push(v); return v; }; rng.draws = draws; return rng; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (v) => { const m = Math.hypot(v[0], v[1], v[2]); return [v[0] / m, v[1] / m, v[2] / m]; };
const parentOf = (out, s) => out.seg.find((p) => p.b === s.a);   // a child grows from its parent's tip: the very same array
const angle = (u, v) => Math.acos(Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));
const HALF = () => 0.5;   // every draw the middle of its range: az offset 0, spread and length factor exactly their nominal

test("a droop at a rounding tie grows one grove, cold or JITted: 0.15·(2/3)·5 = 0.49999999999999994 is one sub-segment every time (canopy 3's level 2)", () => {
  expect(0.15 * (2 / 3) * 5).toBe(0.49999999999999994);   // the tie itself, as growNode computes it
  const spec = specOf({ levels: 3, kids: 3, droop: 0.15 });
  const first = grown(spec).seg.length;
  for (let i = 0; i < 1000; i++) {   // enough calls for JavaScriptCore to tier growNode up: Math.round's answer first moved near build 200 in a cold bun
    const out = grown(spec);
    expect(out.seg.length, `build ${i}`).toBe(first);
    const l2 = out.seg.filter((s) => s.level === 2);
    expect(l2.length, `build ${i}: three level-2 branches, one sub-segment each`).toBe(3);
    for (const s of l2) expect([s.f0, s.f1], `build ${i}`).toEqual([0, 1]);
  }
});

test("the grammar, read off a stream that always says 0.5: each child is lenRatio of its parent, deviating by the phyllotaxis' spread", () => {
  for (const [phyllo, spreadK, kids] of [[0, 1.0, 3], [1, 0.95, 3], [2, 0.96, 2]]) {   // spiral coneA·(0.55+0.9·½), whorled ·(0.7+0.5·½), opposite ·(0.9+0.12·½)
    const spec = specOf({ phyllo, kids, levels: 3 });
    const out = fresh();
    math.growSkeleton(spec, HALF, out);
    expect(out.seg.length).toBe(phyllo === 2 ? 7 : 13);   // 1 + 2 + 4, or 1 + 3 + 9
    for (const s of out.seg.slice(1)) {
      const p = parentOf(out, s);
      expect(p, `phyllo ${phyllo}`).toBeDefined();
      expect(Math.hypot(...sub(s.b, s.a))).toBeCloseTo(Math.hypot(...sub(p.b, p.a)) * spec.lenRatio, 12);
      expect(angle(unit(sub(s.b, s.a)), unit(sub(p.b, p.a)))).toBeCloseTo(spec.coneA * spreadK, 12);
    }
  }
});

test("the stream is drawn three times per child — azimuth, spread, length — and for nothing else", () => {
  for (const [phyllo, kids, nodes] of [[0, 3, 40], [1, 3, 40], [2, 3, 15]]) {   // opposite forks are pairs whatever `kids` says
    for (const leader of [false, true]) {
      const rng = counting(11), out = fresh();
      math.growSkeleton(specOf({ phyllo, kids, leader }), rng, out);
      expect(out.seg.length).toBe(nodes);
      expect(rng.draws.length, `phyllo ${phyllo} leader ${leader}`).toBe(3 * (nodes - 1));
    }
  }
});

test("one `out` collects every call into it: a twig's index is the count before it, which the segments of its own wood point back at", () => {
  const out = fresh(), rng = math.mulberry32(3);
  for (let i = 0; i < 3; i++) math.growSkeleton(specOf({ dir: [Math.cos(i), Math.sin(i), 0.4], limb: i }), rng, out);
  expect(out.tw.length).toBe(3 * 27);   // 3 limbs, 3^3 terminal twigs each (levels 4)
  const terminal = out.seg.filter((s) => s.tw >= 0);
  expect(terminal.map((s) => s.tw)).toEqual(Array.from({ length: out.tw.length }, (_, i) => i));
  expect(out.seg.filter((s) => s.tw < 0).length).toBe(out.seg.length - out.tw.length);
  expect(new Set(out.seg.map((s) => s.limb))).toEqual(new Set([0, 1, 2]));
});

test("droop curves a branch over sub-segments and plain branches stay one segment, as before", () => {
  const straight = grown(specOf({ droop: 0 })), bent = grown(specOf({ droop: 0.45 }));
  expect(straight.seg.every((s) => s.f0 === 0 && s.f1 === 1)).toBe(true);
  expect(bent.seg.length).toBeGreaterThan(straight.seg.length);
  expect(bent.tw.length).toBe(straight.tw.length);                 // sub-segments are wood, not topology
  expect(bent.seg.some((s) => s.f1 < 1)).toBe(true);
  const meanZ = (o) => o.tw.reduce((s, t) => s + t.z, 0) / o.tw.length;
  expect(meanZ(bent)).toBeLessThan(meanZ(straight));               // positive droop sags
});

// ---- plane: the leaf's 2-D use (the tree never passes it) ----
test("coneDirPlane is coneDir with the out-of-plane part dropped: unit, z = 0, and where the projection of coneDir points", () => {
  for (const hd of [0, 0.7, 2.1, -1.3, 3.0]) {
    const d = [Math.cos(hd), Math.sin(hd), 0];
    for (const az of [0, 0.4, 1.57, 2.5, Math.PI, 4.4, 6.0]) for (const spread of [0, 0.3, 0.9, 1.4]) {
      const c = math.coneDirPlane(d, az, spread);
      expect(c[2]).toBe(0);
      expect(Math.hypot(c[0], c[1])).toBeCloseTo(1, 14);
      const full = math.coneDir(d, az, spread), m = Math.hypot(full[0], full[1]);
      expect(c[0]).toBeCloseTo(full[0] / m, 12);
      expect(c[1]).toBeCloseTo(full[1] / m, 12);
    }
  }
  const d = [0, 1, 0];
  const held = math.coneDirPlane(d, Math.PI / 2, 0.8);                // az at the plane's normal: the whole cone offset points out of it, so the heading holds
  expect(held[0]).toBeCloseTo(0, 12);
  expect(held[1]).toBeCloseTo(1, 12);
  const left = math.coneDirPlane(d, 0, 0.5), right = math.coneDirPlane(d, Math.PI, 0.5);
  expect(left[0] * -right[0]).toBeGreaterThan(0);                     // az 0 and π fork to opposite sides
  expect(angle(left, d)).toBeCloseTo(0.5, 12);
});

test("plane: every z is 0, every heading is a unit vector in the plane, and the draws and the counts are the 3-D run's", () => {
  for (const phyllo of [0, 1, 2]) for (const leader of [false, true]) {
    const spec = specOf({ phyllo, leader });
    const flat = grown({ ...spec, plane: true }), tree = grown(spec);
    const tag = `phyllo ${phyllo} leader ${leader}`;
    for (const s of flat.seg) { expect(s.a[2] === 0 && s.b[2] === 0, tag).toBe(true); }
    for (const t of flat.tw) { expect(t.z === 0, tag).toBe(true); expect(Math.hypot(t.dx, t.dy), tag).toBeCloseTo(1, 12); }
    expect(flat.seg.length, tag).toBe(tree.seg.length);            // droop is 0 here, so a node is one segment in both
    expect(flat.tw.length, tag).toBe(tree.tw.length);
    const a = counting(5), b = counting(5);
    math.growSkeleton({ ...spec, plane: true }, a, fresh());
    math.growSkeleton(spec, b, fresh());
    expect(a.draws, tag).toEqual(b.draws);                         // the same draws in the same order: the plane changes where a child points, not what is asked of the stream
  }
  // headings unit: with the stream pinned at ½ every branch is exactly lenRatio^(level−1) long, which a heading of any other length would not give
  const out = fresh();
  math.growSkeleton(specOf({ plane: true, droop: 0.5 }), HALF, out);
  for (const s of out.seg) expect(Math.hypot(...sub(s.b, s.a))).toBeCloseTo(0.7 ** (s.level - 1), 12);
});

test("plane: no droop (the spec's is ignored), and a 3-D root is laid flat into the plane", () => {
  const spec = specOf({ plane: true, phyllo: 0, leader: true });
  expect(grown({ ...spec, droop: 0.6 })).toEqual(grown({ ...spec, droop: 0 }));
  expect(grown({ ...spec, droop: -0.6 })).toEqual(grown({ ...spec, droop: 0 }));
  const lifted = grown({ ...spec, base: [0.5, -0.25, 3], dir: [0.6, 0.6, 0.5] });
  for (const s of lifted.seg) expect(s.a[2] === 0 && s.b[2] === 0).toBe(true);
  for (const t of lifted.tw) expect(t.z === 0).toBe(true);
  const first = lifted.seg[0];
  expect(first.a).toEqual([0.5, -0.25, 0]);
  expect(Math.hypot(...sub(first.b, first.a))).toBeCloseTo(1, 12);                // the heading was made a unit vector in the plane
  expect(unit(sub(first.b, first.a))[0]).toBeCloseTo(Math.SQRT1_2, 12);
});

// ---- pure: nothing but `out` is written, and nothing is read but the arguments ----
test("growSkeleton is pure: the same inputs give the same outputs, the arguments are not written, and no module state is read", () => {
  for (const plane of [false, true]) {
    const spec = deepFreeze(specOf({ plane, droop: 0.2, phyllo: 1, leader: true }));   // a write to any of it throws (modules are strict)
    const a = grown(spec, 21), b = grown(spec, 21);
    expect(a).toEqual(b);
    expect(a.seg.length).toBeGreaterThan(10);
    // interleaved with a different call, and in the other order, the answer holds: no scratch survives between calls
    const other = specOf({ plane: !plane, kids: 2, levels: 5, phyllo: 2, coneA: 1.1 });
    const o1 = grown(other, 9), a2 = grown(spec, 21), o2 = grown(other, 9);
    expect(a2).toEqual(a);
    expect(o2).toEqual(o1);
  }
  const real = Math.random;
  Math.random = () => { throw new Error("growSkeleton asked for Math.random"); };
  try { grown(specOf({ droop: 0.3 })); grown(specOf({ plane: true })); } finally { Math.random = real; }
});
