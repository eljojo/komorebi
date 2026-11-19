// ============================================================================
// The tree seen from the floor camera (komorebi-tree-view.js, spec model/camera.md and model/leaf.md). What must hold: the tree is drawn in the floor camera's
// own perspective, so a point on the floor lands on the floor's own pixel; a stood-up leaf projects straight down onto exactly the footprint the cast stamps;
// each leaf's side is its own and moves no other draw; the finite leaf passes what the look says it does; and the light reads every layer there is.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULTS, MAX_LAYERS } from "../engine/komorebi-params.js";
import { PRESETS } from "../presets.js";
import { hash3 } from "../engine/komorebi-math.js";
import { leafSide, SIDE_SALT } from "../engine/leaf/komorebi-leaf.js";
import { cameraPose } from "../engine/transport/komorebi-camera.js";
import { treeProject, floorRay } from "../engine/transport/komorebi-tree-view.js";
import { SLAB, SLAB_N, slabLeaf, slabK, slabTable } from "../engine/leaf/komorebi-leaf.js";
import { FS_TREE, FS_TREE_WOOD, VS_TREE } from "../engine/transport/komorebi-shaders.js";
import { makeGrove } from "../engine/canopy/komorebi-grove.js";

const FRAMINGS = [
  { view_extent_m: 13.49, view_pitch_deg: 61.4, view_fov_deg: 60, view_yaw_deg: 28.5, view_center_x: -1.49, view_center_y: -6.5 },   // park 1 as shipped
  { view_extent_m: 32.6, view_pitch_deg: 70, view_fov_deg: 100, view_yaw_deg: 0, view_center_x: 0, view_center_y: -2.6 },             // a 1.6 m eye
  { view_extent_m: 28.3, view_pitch_deg: 55, view_fov_deg: 30, view_yaw_deg: -40, view_center_x: 3, view_center_y: 1 },              // the scene from above
  { view_extent_m: 4, view_pitch_deg: 0, view_fov_deg: 50, view_yaw_deg: 0, view_center_x: 0, view_center_y: 0 },                    // straight down: the old map
];

test("a point on the floor projects onto the pixel whose floor ray lands on it, at any pitch, lens, zoom, orbit and pan", () => {
  for (const f of FRAMINGS) for (const aspect of [16 / 9, 1, 0.6]) {
    for (let i = 0; i < 200; i++) {
      const x = (i % 20) / 10 - 1, y = Math.floor(i / 20) / 10 - 1;   // across the frame, normalised device coordinates
      const w = floorRay(f, aspect, x, y);
      if (!w) continue;                                                // over the horizon
      const [px, py, depth] = treeProject(f, aspect, [w[0], w[1], 0]);
      expect(depth).toBeGreaterThan(0);
      expect(px).toBeCloseTo(x, 9); expect(py).toBeCloseTo(y, 9);
    }
  }
});

test("the eye the projection runs from is cameraPose's: a point straight below it is straight below in the image's own vertical plane, and the eye itself is at depth 0", () => {
  for (const f of FRAMINGS) {
    const eye = cameraPose(f).eye;
    expect(treeProject(f, 1, eye)[2]).toBeCloseTo(0, 9);
    if (f.view_pitch_deg > 0) expect(treeProject(f, 1, [eye[0], eye[1], 0])[0]).toBeCloseTo(0, 9);   // the foot of the eye lies on the image's vertical centre line
  }
});

// The TREE_VIEW stage, mirrored: the corner the cast stamps is `world` = base + R·(lc·(A, B)), B = B0·max(0.05, |cos(tilt + swing)|); the tree stands it up at
// height hEff + lc.y·B0·sin(side·(tilt + swing)).
function standUp(A, B0, angle, tilt, swing, side, lc) {
  const c = Math.cos(angle), s = Math.sin(angle), B = B0 * Math.max(0.05, Math.abs(Math.cos(tilt + swing))), roll = side * (tilt + swing);
  const R = (v) => [c * v[0] + s * v[1], -s * v[0] + c * v[1]];   // mat2(c,-s,s,c)·v, column-major
  const plan = R([lc[0] * A, lc[1] * B]);
  return { plan, z: lc[1] * B0 * Math.sin(roll), cast: R([lc[0] * A, lc[1] * B]) };
}
test("a stood-up leaf projects straight down onto the cast's own footprint, at full width where the footprint keeps one", () => {
  for (const tilt of [0, 0.2, 0.6, 1.1]) for (const swing of [-0.3, 0, 0.25]) for (const side of [-1, 1]) for (const angle of [0, 0.7, 2.9]) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((lc) => standUp(0.05, 0.03, angle, tilt, swing, side, lc));
    for (const k of corners) { expect(k.plan[0]).toBe(k.cast[0]); expect(k.plan[1]).toBe(k.cast[1]); }
    if (Math.abs(Math.cos(tilt + swing)) >= 0.05) {
      const a = corners[0], d = corners[3];   // the short side, lc.y −1 → 1
      expect(Math.hypot(d.plan[0] - a.plan[0], d.plan[1] - a.plan[1], d.z - a.z)).toBeCloseTo(2 * 0.03, 12);
    }
  }
  // registration by construction: the tree's corner IS the cast's corner, stood up — one placement, not two that agree
  expect(VS_TREE).toContain("vec3 P = vec3(world, hEff + lc.y*B0*sin(roll));");
  expect(VS_TREE).toContain("float roll = iSide*(restTilt + swing);");
});

test("a leaf's side is ±1, its own pure hash on a salt no other stream uses, and about half go each way", () => {
  let up = 0;
  for (let j = 0; j < 100; j++) for (let k = 0; k < 100; k++) {
    const s = leafSide(290626672, j, k);
    expect(s === 1 || s === -1).toBe(true);
    expect(leafSide(290626672, j, k)).toBe(s);
    if (s > 0) up++;
  }
  expect(up / 1e4).toBeGreaterThan(0.48); expect(up / 1e4).toBeLessThan(0.52);
  const salts = readFileSync(new URL("../engine/season/komorebi-season.js", import.meta.url), "utf8") + readFileSync(new URL("../engine/canopy/komorebi-grove.js", import.meta.url), "utf8")
    + readFileSync(new URL("../engine/leaf/komorebi-leaf.js", import.meta.url), "utf8") + readFileSync(new URL("../engine/season/komorebi-litter.js", import.meta.url), "utf8");
  const all = [...salts.matchAll(/_SALT\s*=\s*(0x[0-9A-Fa-f]+)/g)].map((m) => Number(m[1]));
  expect(all.filter((v) => v === SIDE_SALT)).toHaveLength(1);
  expect(leafSide(1, 2, 3)).toBe((hash3(1 ^ SIDE_SALT, 2, 3) & 1) ? 1 : -1);
});

// a stand-in GL that keeps what each buffer was given (grove-build.test.js's)
function rig(params) {
  const gl = new Proxy({}, { get(t, name) {
    if (typeof name !== "string") return undefined;
    return (...a) => { if (name === "createBuffer") return { data: null }; if (name === "bindBuffer") { t.cur = a[1]; return undefined; } if (name === "bufferData") { if (t.cur) t.cur.data = a[1]; return undefined; } return {}; };
  } });
  const faith = {}, occ = {}, sky = { start: [], count: [] };
  return { faith, G: makeGrove({ gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => true, occ, faith, sky }) };
}
test("every faithful leaf uploads its side beside it, in record order, through the drop's compaction", () => {
  for (const name of ["park 1", "montebello"]) {
    const R = rig({ ...DEFAULTS, ...PRESETS[name] }), g = R.G.growGrove(null, { keepSeason: true });
    expect(g.side.length * 18, name).toBe(g.faithArr.length);
    expect(g.season.side.length, name).toBe(g.season.n);
    const F = R.G.uploadGrove(g).own.faith;   // a detached grove: its faithful state is its own
    expect(F.sideBuf.data.length, name).toBe(F.count);
    expect(Array.from(F.sideBuf.data).every((s) => s === 1 || s === -1), name).toBe(true);
  }
});

test("the finite leaf passes the look's own transmittance, its underside reflects more than its top, and the table is that leaf", () => {
  for (let c = 0; c < 3; c++) for (const T of [0.001, 0.01, 0.05, 0.1, 0.26, 0.356, 0.5]) {
    const m = slabLeaf(slabK(T, SLAB.s[c]), SLAB.s[c]);
    if ((1 - SLAB.f0) * slabLeaf(0, SLAB.s[c])[2] < T) continue;   // brighter than a clear slab of this scattering passes: named (k = 0)
    expect((1 - SLAB.f0) * m[2]).toBeCloseTo(T, 9);
    expect(m[1]).toBeGreaterThan(m[0]);
  }
  const t = slabTable(SLAB_N);
  expect(t.length).toBe(SLAB_N * 3 * 4);
  for (let c = 0; c < 3; c++) for (let i = 1; i < SLAB_N; i++) expect(t[(c * SLAB_N + i) * 4 + 2]).toBeGreaterThanOrEqual(t[(c * SLAB_N + i - 1) * 4 + 2]);
});

test("the tree's light reads every layer there can be, one constant index each", () => {
  for (const src of [FS_TREE, FS_TREE_WOOD]) {
    expect((src.match(/treeTap\(uLayer\[\d\]/g) || []).length).toBe(MAX_LAYERS);
    for (let i = 0; i < MAX_LAYERS; i++) expect(src).toContain(`treeTap(uLayer[${i}], uLayerHeight[${i}]`);
  }
});

// ---- A TILTED LEAF'S SHADOW (tilt_shadow): the cast throws each corner from its own height, so the quad is the leaf's true shadow along the sun ----
import { leafShadowCorner } from "../engine/transport/komorebi-cast.js";
import { VS_FAITH } from "../engine/transport/komorebi-shaders.js";
import { DEFAULTS as DEF, GRANDFATHERED as GF, PARAMS as PR } from "../engine/komorebi-params.js";

const shoelace = (q) => Math.abs(q.reduce((a, p, i) => { const r = q[(i + 1) % q.length]; return a + p[0] * r[1] - r[0] * p[1]; }, 0)) / 2;
const QUAD = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

test("the cast quad at tilt_shadow 1 is the leaf's true shadow, |(u×v)·s|/s_z, for any tilt, side, heading and sun", () => {
  for (let k = 0; k < 2000; k++) {
    const u = (i) => hash3(k, i, 991) / 4294967296;
    const el = (5 + 85 * u(0)) * Math.PI / 180, az = 2 * Math.PI * u(1), s = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
    const g = [s[0] / s[2], s[1] / s[2]], A = 0.02 + 0.1 * u(2), B0 = 0.01 + 0.06 * u(3), ang = 2 * Math.PI * u(4), roll = (u(5) * 2 - 1) * 1.45, h = 1 + 8 * u(6);
    const leaf = { c: [u(7) * 4 - 2, u(8) * 4 - 2], A, B0, ang, roll, h, g };
    const area = shoelace(QUAD.map((lc) => leafShadowCorner(lc, leaf)));
    // the stood-up leaf's two edges: the long axis 2A along R(1, 0), the short one 2·(R(0, B), B0·sin roll); R turns clockwise by ang
    const co = Math.cos(ang), si = Math.sin(ang), B = B0 * Math.abs(Math.cos(roll));
    const e1 = [2 * A * co, -2 * A * si, 0], e2 = [2 * B * si, 2 * B * co, 2 * B0 * Math.sin(roll)];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    expect(Math.hypot(...n)).toBeCloseTo(4 * A * B0, 10);                                             // a leaf of the record's size, stood up
    expect(area).toBeCloseTo(Math.abs(n[0] * s[0] + n[1] * s[1] + n[2] * s[2]) / s[2], 10);
  }
});

test("at tilt_shadow 0 the cast is the plan footprint, whatever the sun: the old stamp", () => {
  const leaf = { c: [0.3, -0.2], A: 0.06, B0: 0.04, ang: 0.7, roll: 0.6, h: 4, share: 0 };
  for (const g of [[0, 0], [1.8, -0.4], [5.6, 2]]) expect(shoelace(QUAD.map((lc) => leafShadowCorner(lc, { ...leaf, g })))).toBeCloseTo(4 * 0.06 * 0.04 * Math.cos(0.6), 12);
});

test("a low sun: a leaf rolled toward it throws a longer shadow than its footprint, one rolled away a thinner one, and a canopy's total grows", () => {
  const g = [1 / Math.tan(15 * Math.PI / 180), 0], base = { c: [0, 0], A: 0.05, B0: 0.04, ang: Math.PI / 2, h: 3, g };   // the short axis along x, toward the sun's plan direction
  const area = (roll, share) => shoelace(QUAD.map((lc) => leafShadowCorner(lc, { ...base, roll, share })));
  const toward = area(-0.3, 1), away = area(0.3, 1), flat = area(0.3, 0);   // away is thinner only while tan(roll) < 2·tan(el); steeper, a low sun lengthens every leaf
  expect(Math.max(toward, away)).toBeGreaterThan(flat); expect(Math.min(toward, away)).toBeLessThan(flat);
  expect((toward + away) / 2).toBeGreaterThan(flat);   // the mean over sides: a low sun closes the canopy, the plan footprint keeps it open
});

test("the shader casts each corner from its own height only under tilt_shadow, and the shut gate is the old line; it ships on, kept off for looks from before", () => {
  expect(VS_FAITH).toContain("float dz = uTiltShadow > 0.0 ? uTiltShadow*lc.y*B0*sin(iSide*(restTilt + swing)) : 0.0;");
  expect(VS_FAITH).toContain("float hc = uTiltShadow > 0.0 ? hEff + dz : hEff;");
  expect(VS_FAITH).toContain("recvPt = world - uG * hc;");
  expect(DEF.tilt_shadow).toBe(1); expect(GF.tilt_shadow).toBe(0); expect(PR.tilt_shadow.travels).toBe("morph");
});

// ---- THE TREE'S CURVE (tree_tone): the seen tree is shown through AgX with contrast, so a bright, saturated leaf rolls toward white instead of
// toward pure yellow-green; the gain holds a sunlit leaf of park 1, from above at the luminance the frame's ACES fit gave it ----
import { TREE_GAIN, TREE_POWER, treeCurve } from "../engine/transport/komorebi-camera.js";

const acesFit = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);

test("the tree's curve shows a sunlit leaf at the frame curve's luminance, and rolls a bright leaf toward white where the frame's pushes it to yellow", () => {
  const sunlit = [0.12, 0.49, 0.0], backlit = [0.84, 1.09, 0.0];   // park 1, from above: the slab's top lit at 26° and the leaf seen through, exposed
  expect(lum(treeCurve(sunlit))).toBeCloseTo(lum(sunlit.map(acesFit)), 2);
  expect(sat(treeCurve(backlit).map((c) => c ** (1 / 2.2)))).toBeLessThan(0.6);
  expect(sat(backlit.map(acesFit).map((c) => c ** (1 / 2.2)))).toBeGreaterThan(0.8);
  for (const c of [[0, 0, 0], [0.01, 0.02, 0.03], [100, 100, 100]]) for (const v of treeCurve(c)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
});

test("the shader runs the curve's own constants, at tree_tone 0 it is the frame's tail to the bit, and it ships on, kept off for looks from before", () => {
  for (const src of [FS_TREE, FS_TREE_WOOD]) {
    expect(src).toContain("if(uTreeTone <= 0.0) return frame;");
    expect(src).toContain(`vec3(${TREE_POWER})`);
    expect(src).toContain(`uExposure*${TREE_GAIN}`);
  }
  expect(DEF.tree_tone).toBe(1); expect(GF.tree_tone).toBe(0); expect(PR.tree_tone.travels).toBe("morph");
});
