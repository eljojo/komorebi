// ============================================================================
// THE GROVE'S BUILD, IN TWO HALVES (komorebi-grove.js). growGrove is the arithmetic: the skeleton, the leaves, the season, the wood's
// tables, as plain data. uploadGrove hands that data to the GPU and to the engine's shared state (faith.*, occ.*, sky.*). buildGrove is
// the two in a row, and is what every route calls. The halves exist so a grove can be grown ahead of the frame that shows it.
// What must not slip: growing reaching the GPU or the shared state (a grove grown ahead would disturb the one on screen); the two
// halves giving anything but the grove one build gives; the upload reading the live parameters, which may be another look's by then.
// ============================================================================
import { test, expect } from "bun:test";
import { makeGrove } from "../engine/canopy/komorebi-grove.js";
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
  faith: { ...R.faith, vao: undefined, buf: R.faith.buf.data, pivotBuf: R.faith.pivotBuf.data, segVAO: undefined, segBuf: R.faith.segBuf?.data },
  occ: R.occ, sky: { ...R.sky, segVAO: undefined, segBuf: R.sky.segBuf?.data },
  grove: { key: g.key, reach: g.reach, wood: g.wood, scaleMax: g.scaleMax, litter: g.litter, shape: g.shape && [g.shape.rows, g.shape.data.length],
           leafW: g.hier.leafW, clusterData: g.hier.clusterData, clusterGeom: g.hier.clusterGeom, nLeaf: g.hier.nLeaf,
           season: g.season && { key: g.season.key, n: g.season.n, rec: g.season.rec, pivot: g.season.pivot, seg: g.season.seg, own: g.season.faithBuf === R.faith.buf, density: g.season.density } },
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
  test(`growing touches neither the GPU nor the shared state, and the upload gives the grove one build gives: ${name}`, () => {
    const A = rig({ ...DEFAULTS, ...look }, faithful), want = snapshot(A, A.G.buildGrove(null, opts));
    const B = rig({ ...DEFAULTS, ...look }, faithful);
    const before = JSON.stringify(plain({ faith: B.faith, occ: B.occ, sky: B.sky }));
    const grown = B.G.growGrove(null, opts);
    expect(B.seen.calls, "no GL call while growing").toBe(0);
    expect(JSON.stringify(plain({ faith: B.faith, occ: B.occ, sky: B.sky })), "the shared state as it was").toBe(before);
    expect(snapshot(B, B.G.uploadGrove(grown))).toEqual(want);
  });
}

test("the upload reads the grove it was handed, not the live parameters: another look may be on them by then", () => {
  for (const [name, look, faithful, opts] of CASES.slice(0, 5)) {   // (a density capacity re-seasons at once, on the parameters it was grown under)
    const A = rig({ ...DEFAULTS, ...look }, faithful), want = snapshot(A, A.G.buildGrove(null, opts));
    const B = rig({ ...DEFAULTS, ...look }, faithful), grown = B.G.growGrove(null, opts);
    Object.assign(B.params, { trunk_radius_m: 0.41, taper_delta: 1.3, layer_count: B.params.layer_count === 1 ? 3 : 1, sky_view: !B.params.sky_view, canopy_extent_m: 31, canopy_base_height_m: 7.5,
      canopy_thickness_m: 0.7, branch_children: 5, seed: 99, view_extent_m: 17, grove_reach_m: 9, standing_scene: !B.params.standing_scene, foliage_density: 2.5, phenology: 0.99 });
    expect(snapshot(B, B.G.uploadGrove(grown)), name).toEqual(want);
  }
});
