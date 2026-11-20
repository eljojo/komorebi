// ============================================================================
// THE GROVE'S BUILD, IN TWO HALVES (komorebi-grove.js). growGrove is the arithmetic: the skeleton, the leaves, the season, the wood's
// tables, as plain data. uploadGrove hands that data to the GPU as a detached grove holding its own state (g.own: faith, occ, sky); attaching
// it moves that state onto a hub's shared objects. buildGrove is the two halves and the attach in a row. The halves exist so a grove can
// be grown ahead of the frame that shows it. What must not slip: growing or uploading reaching the shared state (a grove grown ahead would
// disturb the one on screen); the halves and the attach giving anything but the grove one build gives; the upload reading the live
// parameters, which may be another look's by then.
// ============================================================================
import { test, expect } from "bun:test";
import { makeGrove, attachGrove, attachedGrove } from "../engine/canopy/komorebi-grove.js";
import { DEFAULTS } from "../engine/komorebi-params.js";
import { PRESETS } from "../presets.js";

// a stand-in GL that counts every call and keeps what each buffer and texture was given
function rig(params, faithful) {
  const seen = { calls: 0, textures: [] };
  const gl = new Proxy({}, {
    get(t, name) {
      if (typeof name !== "string") return undefined;
      return (...a) => {
        seen.calls++;
        if (name === "createBuffer") return { data: null };
        if (name === "bindBuffer") { t.cur = a[1]; return undefined; }
        if (name === "bufferData") { if (t.cur) t.cur.data = a[1]; return undefined; }
        if (name === "texImage2D") { seen.textures.push([a[3], a[4], a[8] ? Array.from(a[8]) : null]); return undefined; }
        return {};
      };
    },
  });
  const faith = {}, occ = {}, sky = { start: [], count: [] };
  const hub = { gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => faithful, occ, faith, sky };
  return { hub, faith, occ, sky, params, seen, G: makeGrove(hub) };
}
const plain = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(x) : x)));
// everything a build leaves behind: on the GPU, in the shared state, and on the grove itself
const snapshot = (R, g) => plain({
  layers: g.layerVAO.map((l) => [l.count, l.buf.data]), textures: R.seen.textures,
  faith: { ...R.faith, vao: undefined, rec: undefined, buf: (R.faith.rec?.leaves ?? R.faith.buf.data), pivotBuf: (R.faith.rec?.pivot ?? R.faith.pivotBuf.data), segVAO: undefined, segBuf: R.faith.segBuf?.data },
  occ: R.occ, sky: { ...R.sky, segVAO: undefined, segBuf: R.sky.segBuf?.data },
  grove: { key: g.key, reach: g.reach, wood: g.wood, scaleMax: g.scaleMax, litter: g.litter, shape: g.shape && [g.shape.rows, g.shape.data.length],
           leafW: g.hier.leafW, clusterData: g.hier.clusterData, clusterGeom: g.hier.clusterGeom, nLeaf: g.hier.nLeaf,
           season: g.season && { key: g.season.key, n: g.season.n, rec: g.season.rec, pivot: g.season.pivot, seg: g.season.seg, attached: attachedGrove(R.hub) === g, density: g.season.density } },
});

const small = { tree_count: 2, leaves_per_cluster: 5, branch_levels: 2, inner_leaves: 0.35 };
const CASES = [
  ["the layer cast on the floor", { ...PRESETS["afternoon 7"], ...small }, false, {}],
  ["a faithful standing tree with its wood, in the fall", { ...PRESETS.montebello, ...small }, true, {}],
  ["the same, keeping its season record", { ...PRESETS.montebello, ...small }, true, { keepSeason: true }],
  ["a maple outline with variety", { ...PRESETS["afternoon 7"], ...small, leaf_shape: "maple", leaf_aspect: 1, leaf_variety: 0.6 }, false, {}],
  ["the sky view, its fine wood binned by layer", { ...PRESETS["canopy 1"], ...small }, false, {}],
  ["a summer grove grown to a density capacity", { ...PRESETS["afternoon 7"], ...small, phenology: 0.5, leaf_drop: 0, leaf_variety: 0, foliage_density: 0.8 }, false, { densityCapacity: 1.6 }],
];

for (const [name, look, faithful, opts] of CASES) {
  test(`growing touches neither the GPU nor the shared state, the upload not the shared state, and attached it is the grove one build gives: ${name}`, () => {
    const A = rig({ ...DEFAULTS, ...look }, faithful), want = snapshot(A, A.G.buildGrove(null, opts));
    const B = rig({ ...DEFAULTS, ...look }, faithful);
    const before = JSON.stringify(plain({ faith: B.faith, occ: B.occ, sky: B.sky }));
    const grown = B.G.growGrove(null, opts);
    expect(B.seen.calls, "no GL call while growing").toBe(0);
    expect(JSON.stringify(plain({ faith: B.faith, occ: B.occ, sky: B.sky })), "the shared state as it was").toBe(before);
    const up = B.G.uploadGrove(grown);
    expect(JSON.stringify(plain({ faith: B.faith, occ: B.occ, sky: B.sky })), "the shared state as it was, after the upload").toBe(before);
    expect(snapshot(B, attachGrove(B.hub, up))).toEqual(want);
  });
}

test("the upload reads the grove it was handed, not the live parameters: another look may be on them by then", () => {
  for (const [name, look, faithful, opts] of CASES.slice(0, 5)) {   // (a density capacity re-seasons at once, on the parameters it was grown under)
    const A = rig({ ...DEFAULTS, ...look }, faithful), want = snapshot(A, A.G.buildGrove(null, opts));
    const B = rig({ ...DEFAULTS, ...look }, faithful), grown = B.G.growGrove(null, opts);
    Object.assign(B.params, { trunk_radius_m: 0.41, taper_delta: 1.3, layer_count: B.params.layer_count === 1 ? 3 : 1, sky_view: !B.params.sky_view, canopy_extent_m: 31, canopy_base_height_m: 7.5,
      canopy_thickness_m: 0.7, branch_children: 5, seed: 99, view_extent_m: 17, grove_reach_m: 9, standing_scene: !B.params.standing_scene, foliage_density: 2.5, phenology: 0.99 });
    expect(snapshot(B, attachGrove(B.hub, B.G.uploadGrove(grown))), name).toEqual(want);
  }
});

// A LAYERED GROVE'S FAITHFUL LEAVES stay on the CPU as a record (faith.rec) until a cast asks to draw them (faithGL): a layered look's regrow and its
// re-seasons send the GPU its layers alone, and a route reads the record rather than waiting on a read back. A faithful grove's go up with it, as before.
const faithfulBuffers = (F) => [F.vao, F.buf, F.pivotBuf, F.sideBuf];
test("a layered grove uploads no faithful buffer: its leaves are a record, the grown arrays as they are", () => {
  const R = rig({ ...DEFAULTS, ...PRESETS["afternoon 7"], ...small }, false), G = R.G.growGrove(null, {}), F = R.G.uploadGrove(G).own.faith;
  expect(faithfulBuffers(F)).toEqual([null, null, null, null]);
  expect(F.rec.leaves).toBe(G.faithArr);
  expect(Array.from(F.rec.pivot)).toEqual(Array.from(Float32Array.from(G.pivot)));
  expect(Array.from(F.rec.side)).toEqual(Array.from(Float32Array.from(G.side)));
  expect(F.count).toBe(G.faithArr.length / 18);
});
test("a faithful grove's leaves go up with it, and it keeps no record", () => {
  const R = rig({ ...DEFAULTS, ...PRESETS.montebello, ...small }, true), G = R.G.growGrove(null, {}), F = R.G.uploadGrove(G).own.faith;
  expect(F.rec).toBe(null);
  expect(Array.from(F.buf.data)).toEqual(Array.from(G.faithArr));
  expect(Array.from(F.sideBuf.data)).toEqual(Array.from(Float32Array.from(G.side)));
});
test("the first cast that asks uploads the record once, the very leaves, pivots and sides, and lets it go", () => {
  const R = rig({ ...DEFAULTS, ...PRESETS["afternoon 7"], ...small, inner_leaves: 0.35 }, false), G = R.G.growGrove(null, {});
  attachGrove(R.hub, R.G.uploadGrove(G));
  const rec = R.faith.rec;
  expect(R.G.faithGL(R.faith)).toBe(true);
  expect(R.faith.rec).toBe(null);
  expect(R.faith.buf.data).toBe(rec.leaves);
  expect(R.faith.pivotBuf.data).toBe(rec.pivot);
  expect(R.faith.sideBuf.data).toBe(rec.side);
  const vao = R.faith.vao, calls = R.seen.calls;
  expect(R.G.faithGL(R.faith)).toBe(true);
  expect([R.faith.vao, R.seen.calls]).toEqual([vao, calls]);
  const empty = rig({ ...DEFAULTS }, false);
  expect(empty.G.faithGL(empty.faith), "no grove: nothing to cast").toBe(false);
});
test("a layered grove's re-season rewrites its record and no faithful buffer; once uploaded, the buffer", () => {
  const look = { ...DEFAULTS, ...PRESETS.montebello, ...small };
  const R = rig(look, false), g = R.G.buildGrove(null, { keepSeason: true }), later = { ...look, phenology: Math.min(1, look.phenology + 0.2) };
  R.G.reseasonGrove(g, later);
  expect(faithfulBuffers(R.faith)).toEqual([null, null, null, null]);
  const fresh = rig(later, false), F = fresh.G.uploadGrove(fresh.G.growGrove(null, {})).own.faith;
  expect(R.faith.count).toBe(F.count);
  expect(Array.from(R.faith.rec.leaves)).toEqual(Array.from(F.rec.leaves));
  expect(Array.from(R.faith.rec.pivot)).toEqual(Array.from(F.rec.pivot));
  R.G.faithGL(R.faith);
  R.G.reseasonGrove(g, look);
  expect(R.faith.rec).toBe(null);
  expect(R.faith.buf.data.length).toBe(R.faith.count * 18);
});
test("the regrow in place: a layered grove takes none of a faithful one's buffers, which stay its for the free; a faithful one makes its own from a layered one", () => {
  const look = { ...DEFAULTS, ...PRESETS["afternoon 7"], ...small };
  const A = rig(look, true), layered = rig(look, false), was = A.G.uploadGrove(A.G.growGrove(null, {})), held = faithfulBuffers(was.own.faith);
  const now = A.G.uploadGrove(layered.G.growGrove(null, {}), was);   // the upload reads the grown grove alone, so the layered one goes up on A's GL
  expect(faithfulBuffers(now.own.faith)).toEqual([null, null, null, null]);
  faithfulBuffers(was.own.faith).forEach((b, i) => { expect(b).toBe(held[i]); });
  const back = A.G.uploadGrove(A.G.growGrove(null, {}), now);
  expect(back.own.faith.rec).toBe(null);
  expect(back.own.faith.vao).toBeTruthy();
});
