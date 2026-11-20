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
  { view_extent_m: 15.8, view_pitch_deg: 70, view_look_up_deg: 35, view_fov_deg: 60, view_yaw_deg: 150, view_center_x: -2, view_center_y: 3 },   // a 1.6 m eye looking up at a tree
  { view_extent_m: 9, view_pitch_deg: 40, view_look_up_deg: 20, view_fov_deg: 45, view_yaw_deg: -20, view_center_x: 1, view_center_y: 0 },      // looking up from a steeper tilt
];

test("looking up turns the gaze and not the eye: the eye is the tilt's, the frame's centre ray rises by the look up, and the horizon sits where the raised gaze puts it", () => {
  for (const f of FRAMINGS.filter((f) => f.view_look_up_deg > 0)) {
    const flat = { ...f, view_look_up_deg: 0 };
    expect(cameraPose(f).eye).toEqual(cameraPose(flat).eye);
    expect(cameraPose(f).elevation - cameraPose(flat).elevation).toBeCloseTo(f.view_look_up_deg * Math.PI / 180, 12);
    const eye = cameraPose(f).eye, far = 1e4, gaze = (f.view_pitch_deg + f.view_look_up_deg - 90) * Math.PI / 180, yaw = f.view_yaw_deg * Math.PI / 180;
    const P = [eye[0] + far * Math.cos(gaze) * Math.sin(yaw), eye[1] + far * Math.cos(gaze) * Math.cos(yaw), eye[2] + far * Math.sin(gaze)];
    const [x, y] = treeProject(f, 1, P);
    expect(x).toBeCloseTo(0, 9); expect(y).toBeCloseTo(0, 9);   // a point along the raised gaze is at the frame's centre
    const horizonY = -Math.tan(gaze) / Math.tan(f.view_fov_deg * Math.PI / 360);   // a far point at eye height, in normalised device y
    const [, hy] = treeProject(f, 1, [eye[0] + far * Math.sin(yaw), eye[1] + far * Math.cos(yaw), eye[2]]);
    expect(hy).toBeCloseTo(horizonY, 3);
  }
});

test("at a look up of 0 the camera is the tilt's, to the bit", () => {
  for (const f of FRAMINGS.filter((f) => !f.view_look_up_deg)) {
    const z = { ...f, view_look_up_deg: 0 };
    for (const P of [[1, 2, 0], [-3, 5, 4.5], [0.2, -1, 9]]) expect(treeProject(z, 1.3, P)).toEqual(treeProject(f, 1.3, P));
    expect(floorRay(z, 1.3, 0.2, -0.4)).toEqual(floorRay(f, 1.3, 0.2, -0.4));
    expect(cameraPose(z)).toEqual(cameraPose(f));
  }
});

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

test("the tree's light reads every layer there can be, one constant index each, in both its orders", () => {
  for (const src of [FS_TREE, FS_TREE_WOOD]) {
    // two orders: the crown's light gathers from the top layer down (the order the light meets them), the beam alone from the bottom up as it always did
    const taps = [...src.matchAll(/treeTap\(uLayer\[(\d)\], uLayerHeight\[(\d)\]/g)].map((m) => { expect(m[1]).toBe(m[2]); return Number(m[1]); });
    const all = Array.from({ length: MAX_LAYERS }, (_, i) => i);
    expect(taps).toEqual([...all].reverse().concat(all));
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

// ---- THE WOOD, SEEN (spec/model/camera.md): twigs under a pixel drawn by their coverage (thin_twigs), the trunk's foot standing in the ground on its root
// flare (trunk_base), round ends over a fork (trunk_split), and the bark's furrows (bark_texture). Each is shut by its own uniform, and the foot's arithmetic
// is compiled only into the program a tree with feet draws with, so with every knob shut the wood is drawn as it was ----
import { VS_TREE_WOOD, VS_TREE_WOOD_FOOT } from "../engine/transport/komorebi-shaders.js";

const TREE_VIEW_SRC = readFileSync(new URL("../engine/transport/komorebi-tree-view.js", import.meta.url), "utf8");
const glslNum = (src, name) => Number(new RegExp(`\\b${name} = ([0-9.]+)`).exec(src)?.[1]);
// The text of the block a GLSL statement opens, from its head to its matching brace.
const block = (src, head) => {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`no block ${head}`);
  let depth = 0;
  for (let i = at + head.length - 1; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) return { from: at, to: i + 1, text: src.slice(at, i + 1) }; }
  throw new Error(`unclosed ${head}`);
};
const mainOf = (src) => src.slice(src.indexOf("void main(){"));
const glslFn = (args, expr) => new Function(...args, `const { max, min, exp, sqrt, abs } = Math; const mix = (a, b, t) => a + (b - a)*t; const clamp = (x, a, b) => Math.min(Math.max(x, a), b);\nreturn ${expr};`);

test("the root flare's arithmetic is compiled only into the foot's program, and a tree without feet draws with the wood shader it always drew", () => {
  expect(VS_TREE_WOOD).not.toContain("#define WOOD_FOOT");
  expect(VS_TREE_WOOD_FOOT.startsWith("#version 300 es\n#define WOOD_FOOT\n")).toBe(true);
  expect(VS_TREE_WOOD_FOOT.replace("#define WOOD_FOOT\n", "")).toBe(VS_TREE_WOOD);
  // every statement that reads a foot sits inside #ifdef WOOD_FOOT; outside it every capsule is marked as no foot
  let depth = 0, inFoot = 0, read = 0;
  for (const line of VS_TREE_WOOD.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#if")) { depth++; if (t === "#ifdef WOOD_FOOT") inFoot = depth; continue; }
    if (t.startsWith("#endif")) { if (inFoot === depth) inFoot = 0; depth--; continue; }
    if (/uFoot/.test(t) && !t.startsWith("uniform ")) { read++; expect(`${inFoot > 0}: ${t}`).toBe(`true: ${t}`); }
  }
  expect(read).toBeGreaterThan(0);
  expect(VS_TREE_WOOD).toContain("vFlareZ = -1.0; vFlare = vec4(0.0);\n#ifdef WOOD_FOOT");
  for (const line of ["woodFoot: [VS_TREE_WOOD_FOOT, FS_TREE_WOOD]", "const feet = params.trunk_base ? hub.faith?.trunks : null", "const wood = program(nFeet ? 'woodFoot' : 'wood', names), U = wood.u;"])
    expect(`${TREE_VIEW_SRC.includes(line)}: ${line}`).toBe(`true: ${line}`);
});

test("each new branch of the wood's shaders is shut by its own uniform, each uniform is shut while its knob is, and every knob ships shut", () => {
  const fs = mainOf(FS_TREE_WOOD), vs = mainOf(VS_TREE_WOOD);
  const gates = ["if(vFlareZ > -0.5){", "if(uRoundEnds != 0){", "if(uGroundClip != 0){", "if(cov < 0.25){"].map((h) => block(fs, h));
  const discards = [...fs.matchAll(/discard;/g)].map((m) => m.index);
  expect(discards.length).toBe(4);
  for (const at of discards) expect(gates.some((g) => at > g.from && at < g.to)).toBe(true);
  // the bark touches the colour and the normal only inside its gate
  const bark = block(fs, "if(uBarkTex > 0.0){");
  for (const m of fs.matchAll(/bark \*=|n = normalize\(n - cross/g)) expect(m.index > bark.from && m.index < bark.to).toBe(true);
  expect(bark.text).toContain("bark *= ");
  // a twig is thinned to its coverage only under uWoodPx, so the one-sample keep (cov < 0.25) never runs at rest
  expect(vs).toContain("vWoodCov = 1.0;\n  if(uWoodPx > 0.0){");
  for (const m of vs.matchAll(/vWoodCov = rad\/hp/g)) { const g = block(vs, "if(uWoodPx > 0.0){"); expect(m.index > g.from && m.index < g.to).toBe(true); }
  // the uploads: each gate's rest value while its knob is shut
  for (const line of ["gl.uniform1f(U.woodPx, params.thin_twigs ? 2*Math.tan(0.5*clamp(params.view_fov_deg, 5, 140)*DEG)/h : 0);",
    "gl.uniform1i(U.groundClip, params.trunk_base ? 1 : 0);", "gl.uniform1f(U.barkTex, clamp(params.bark_texture ?? 0, 0, 1));",
    "gl.uniform1i(U.roundEnds, params.trunk_split >= 2 && params.growth_years > 0 ? 1 : 0);"]) expect(`${TREE_VIEW_SRC.includes(line)}: ${line}`).toBe(`true: ${line}`);
  for (const [k, v] of [["thin_twigs", false], ["trunk_base", false], ["trunk_split", 0], ["bark_texture", 0], ["view_look_up_deg", 0], ["view_sky", false]]) expect(`${k}: ${DEF[k]}`).toBe(`${k}: ${v}`);
});

test("the root flare is slight and long, the trunk's own width again at the top of its first piece of wood, and never wider than the card it is cut from", () => {
  const F = glslNum(FS_TREE_WOOD, "FLARE_F"), H = glslNum(FS_TREE_WOOD, "FLARE_H");
  expect([F, H]).toEqual([0.18, 1.5]);
  expect(glslNum(VS_TREE_WOOD_FOOT, "FLARE_F")).toBe(F); expect(glslNum(VS_TREE_WOOD_FOOT, "FLARE_H")).toBe(H);
  // the fragment's profile, run as written: r(z) for a foot capsule of radii (x, y), trunk radius z, length w
  const fs = mainOf(FS_TREE_WOOD);
  const hExpr = /float z = clamp\(vFlareZ, 0\.0, vFlare\.w\), h = ([^;]+);/.exec(fs)[1], rExpr = /float r = ([^;]+);/.exec(fs)[1];
  const profile = glslFn(["z", "vFlare", "FLARE_F", "FLARE_H"], `(() => { const h = ${hExpr}; return ${rExpr.replace(/1e-4/g, "1e-4")}; })()`);
  // the card's half-width, from the vertex shader: the capsule's base radius plus the whole flare
  expect(VS_TREE_WOOD_FOOT).toContain("vFlare = vec4(iSegH.z, iSegH.w, uFoot[i].z, L); rad = iSegH.z + FLARE_F*uFoot[i].z;");
  for (const [x, y, r0, w] of [[0.3, 0.29, 0.3, 2], [0.3, 0.27, 0.3, 0.5], [0.2, 0.2, 0.2, 6], [0.45, 0.4, 0.45, 1.2]]) {
    const v = { x, y, z: r0, w }, r = (z) => profile(z, v, F, H);
    expect(r(w)).toBeCloseTo(y, 12);                                                             // the next piece of wood takes over without a step
    expect(r(0)).toBeCloseTo(x + F * r0 * (1 - Math.exp(-w / (H * r0))), 12);
    let last = Infinity;
    for (let i = 0; i <= 200; i++) { const ri = r(w * i / 200); expect(ri).toBeLessThanOrEqual(x + F * r0 + 1e-12); expect(ri).toBeLessThanOrEqual(last + 1e-12); last = ri; }
  }
  // on a long first piece the foot is 0.18 of the radius wider at the ground and the swell falls to 1/e of that 1.5 radii up
  const v = { x: 0.3, y: 0.3, z: 0.3, w: 20 };
  expect(profile(0, v, F, H) - 0.3).toBeCloseTo(0.18 * 0.3, 6);
  expect((profile(1.5 * 0.3, v, F, H) - 0.3) / (0.18 * 0.3)).toBeCloseTo(Math.exp(-1), 6);
});

test("round ends cut a card's run-on past each end to the half disc of the stem's radius, and nothing within its length", () => {
  const fs = mainOf(FS_TREE_WOOD);
  const eExpr = /float e = ([^,]+, [^,]+), xa = clamp\(across, -1\.0, 1\.0\);/.exec(fs)[1], cut = /if\((e > 0\.0 && e\*e > .*)\) discard;/.exec(fs)[1];
  const discarded = glslFn(["vAlong", "vLen", "across", "rad"], `(() => { const e = ${eExpr}, xa = clamp(across, -1.0, 1.0); return ${cut}; })()`);
  // the card runs on a radius past each end (the vertex shader's), so the half disc fits it exactly
  expect(VS_TREE_WOOD).toContain("vAlong = t*len + aCorner.x*rad; vLen = len;");
  expect(VS_TREE_WOOD).toContain("vec3 C = mix(A, B, t) + ax*aCorner.x*rad;");
  for (const [len, rad] of [[1, 0.3], [0.4, 0.25], [3, 0.05]]) {
    for (let i = 0; i <= 120; i++) for (let j = 0; j <= 40; j++) {
      const along = -rad + (len + 2 * rad) * i / 120, across = -1 + 2 * j / 40;
      const past = Math.max(-along, along - len), inside = past <= 0 || Math.hypot(past, across * rad) <= rad;
      if (Math.abs(Math.hypot(Math.max(past, 0), across * rad) - rad) < 1e-9) continue;   // on the circle itself
      expect(discarded(along, len, across, rad)).toBe(!inside);
    }
  }
});

test("a twig under a pixel is drawn a pixel wide at its coverage, and under a quarter kept at one sample's weight by a chance that keeps its average", () => {
  const vs = mainOf(VS_TREE_WOOD), fs = mainOf(FS_TREE_WOOD);
  // drawn width × strength = the twig's own width; uWoodPx is a pixel's height per metre from the eye, so hp is half a pixel there
  expect(vs).toContain("float hp = 0.5*uWoodPx*length(uEyeW - mix(A, B, t)); if(rad < hp){ vWoodCov = rad/hp; rad = hp; }");
  expect(fs).toContain("frag = vec4(treeFinish(col, Tsun, vWorld), clamp(vWoodFade, 0.0, 1.0)*cov);");
  // the keep: chance k·cov at weight w, with k·w = 1 and w one of the four samples a pixel holds
  const keep = /if\(float\(h >> 8\)\*\(1\.0\/16777216\.0\) >= ([0-9.]+)\*cov\) discard;\n\s*cov = ([0-9.]+);/.exec(fs);
  expect(Number(keep[1]) * Number(keep[2])).toBe(1); expect(Number(keep[2])).toBe(0.25);
  // the hash, run as the shader writes it: its multipliers read from the source
  const m = /uvec3\(uvec2\(gl_FragCoord\.xy\), vWoodId\)\*uvec3\((\d+)u, (\d+)u, (\d+)u\);\n\s*uint h = \(q\.x \^ q\.y \^ q\.z\)\*(\d+)u;/.exec(fs).slice(1).map(Number);
  const u = (x, y, id) => ((Math.imul(((Math.imul(x, m[0]) ^ Math.imul(y, m[1]) ^ Math.imul(id, m[2])) >>> 0), m[3]) >>> 0) >>> 8) / 16777216;
  for (const cov of [0.02, 0.1, 0.2]) for (const id of [0, 7, 4093]) {
    let kept = 0; const N = 160;
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (u(x + 300, y + 200, id) < Number(keep[1]) * cov) kept++;
    expect(Math.abs(kept / (N * N) * Number(keep[2]) / cov - 1)).toBeLessThan(0.1);   // the haze's mean weight is its coverage
  }
});

test("the trunk meets the ground along the curve a cylinder makes, lowest in front: the bark in front of the card, not the card, is clipped", () => {
  const fs = mainOf(FS_TREE_WOOD);
  expect(fs).toContain("if((vWorld + normalize(uEyeW - vWorld)*rad*sqrt(1.0 - xa*xa)).z < 0.0) discard; }");
  // the lowest kept point of a vertical trunk's card, seen from an eye 1.6 m up and 8 m off, across its width
  const eye = [0, -8, 1.6], rad = 0.3;
  const lowest = (x) => {   // the card's height z where the bark in front of it meets the ground
    const f = (z) => { const P = [x * rad, 0, z], d = [eye[0] - P[0], eye[1] - P[1], eye[2] - P[2]], n = Math.hypot(...d); return z + d[2] / n * rad * Math.sqrt(1 - x * x); };
    let lo = -1, hi = 1; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; } return hi;
  };
  expect(lowest(0)).toBeLessThan(lowest(0.6)); expect(lowest(0.6)).toBeLessThan(lowest(0.95));
  expect(lowest(1)).toBeCloseTo(0, 9);   // at the silhouette the bark is the card itself
  expect(lowest(0)).toBeLessThan(-0.05);
});

test("the bark's pattern runs on across a bent joint of a near-upright stem, where reading its distance up along the axis broke it by ridges", () => {
  const fs = mainOf(FS_TREE_WOOD);
  expect(fs).toContain("bool upright = abs(vWoodAx.z) > 0.5;");
  expect(fs).toContain("vec3 e1 = normalize(cross(upright ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0), vWoodAx)), e2 = cross(vWoodAx, e1);");
  expect(fs).toContain("float th = atan(dot(n, e2), dot(n, e1)), up = upright ? vWorld.z/vWoodAx.z : dot(vWorld, vWoodAx);");
  expect(fs).toContain("vec2 p = vec2(th/6.2831853*BARK_RIDGES, up/(BARK_LONG*6.2831853*max(rt, 1e-3)/BARK_RIDGES));");
  const RIDGES = glslNum(FS_TREE_WOOD, "BARK_RIDGES"), LONG = glslNum(FS_TREE_WOOD, "BARK_LONG");
  expect([RIDGES, LONG, glslNum(FS_TREE_WOOD, "BARK_PLATES")]).toEqual([24, 8, 8]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const coords = (P, n, ax, rt, alongAxis = false) => {   // the shader's (ridges round, ridge lengths up)
    const upright = Math.abs(ax[2]) > 0.5, e1 = norm(cross(upright ? [1, 0, 0] : [0, 0, 1], ax)), e2 = cross(ax, e1);
    const up = upright && !alongAxis ? P[2] / ax[2] : dot(P, ax);
    return [Math.atan2(dot(n, e2), dot(n, e1)) / (2 * Math.PI) * RIDGES, up / (LONG * 2 * Math.PI * rt / RIDGES)];
  };
  // a trunk 10 m from the origin, 0.3 m round, bending 10° at a joint 3 m up, toward each of eight azimuths; the bark seen from each side
  const rt = 0.3, J = [10, 0, 3], below = [0, 0, 1];
  let broke = 0;
  for (let a = 0; a < 8; a++) for (let s = 0; s < 6; s++) {
    const az = a * Math.PI / 4, tilt = 10 * Math.PI / 180, above = [Math.sin(tilt) * Math.cos(az), Math.sin(tilt) * Math.sin(az), Math.cos(tilt)];
    const side = [Math.cos(s * Math.PI / 3), Math.sin(s * Math.PI / 3), 0], n1 = side, n2 = norm(side.map((v, i) => v - dot(side, above) * above[i]));
    const P = J.map((v, i) => v + rt * side[i]);
    const c1 = coords(P, n1, below, rt), c2 = coords(P, n2, above, rt);
    const dx = Math.abs(((c2[0] - c1[0]) % RIDGES + 1.5 * RIDGES) % RIDGES - RIDGES / 2);
    expect(dx).toBeLessThan(0.05);                     // round the stem: a twentieth of a ridge
    expect(Math.abs(c2[1] - c1[1])).toBeLessThan(0.1); // up it: a tenth of a ridge's length
    broke = Math.max(broke, Math.abs(coords(P, n2, above, rt, true)[1] - coords(P, n1, below, rt, true)[1]));
  }
  expect(broke).toBeGreaterThan(2);   // along the axis from the origin, bent away from it: whole ridges
});
