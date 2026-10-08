// Guards the camera registry's three halves (spec §4.9/§9). Transport is assembled from a table: CAMERAS says which
// uniform GROUPS a camera speaks, TRANSPORT_GROUPS says what each group declares and what its locations are called,
// and GROUP_UPLOAD (inside create(), enumerated at module level by GROUP_UPLOAD_KEYS) says how each group is filled
// per frame. Those three must name the same things, and the failure when they don't is SILENT: a group a camera
// names but no table defines is a missing declaration; a group that declares uniforms but uploads none leaves them
// at zero; an uploader no camera speaks is dead code that looks alive. None of that throws — it renders, wrongly.
// These tests turn each into a loud `bun test` failure. Run: `bun test registry.test.js`.
//
// (The fourth half — that GROUP_UPLOAD's functions match GROUP_UPLOAD_KEYS — cannot be seen from here, because the
// functions close over engine state. create() checks that pair itself, on construction.)
import { test, expect } from "bun:test";
import { CAMERAS, TRANSPORT_GROUPS, GROUP_UPLOAD_KEYS, TRANSPORT_CAMERAS, FEATURES, buildTransport } from "./komorebi.js";
import { FS_FILL, GLSL_SKY_RAY, GLSL_LAYER_FIELD, GLSL_SUN_DIR_DECLS } from "./komorebi-shaders.js";

const ALL_GROUPS = Object.keys(TRANSPORT_GROUPS);
const SPOKEN = new Set(Object.values(CAMERAS).flatMap((c) => c.groups));

test("every group a camera speaks is a group that exists", () => {
  for (const [name, cam] of Object.entries(CAMERAS))
    for (const g of cam.groups)
      expect(`${name}: ${g} in TRANSPORT_GROUPS`).toBe(`${name}: ${ALL_GROUPS.includes(g) ? g : `MISSING(${g})`} in TRANSPORT_GROUPS`);
});

test("every group carrying uniforms also carries an upload — a declared uniform nobody fills reads as zero", () => {
  for (const [g, def] of Object.entries(TRANSPORT_GROUPS)) {
    if (!def.locs) continue;   // a functions-only group (the fold field, the warp) has nothing to fill
    expect(`${g}: ${GROUP_UPLOAD_KEYS.includes(g)}`).toBe(`${g}: true`);
  }
});

test("no uploader without a group, and no group without a camera — both are dead code that looks alive", () => {
  for (const g of GROUP_UPLOAD_KEYS) expect(`upload ${g}: ${ALL_GROUPS.includes(g)}`).toBe(`upload ${g}: true`);
  for (const g of ALL_GROUPS) expect(`group ${g} spoken: ${SPOKEN.has(g)}`).toBe(`group ${g} spoken: true`);
});

test("a functions-only group uploads nothing — the fold field and the warp declare no uniforms of their own", () => {
  for (const g of GROUP_UPLOAD_KEYS) expect(`${g} has locs: ${!!TRANSPORT_GROUPS[g].locs}`).toBe(`${g} has locs: true`);
});

// Every entry has to be complete enough to assemble, and every camera has to be one of the four the selection
// function can return — a camera in the table that nothing selects would never be compiled and never be caught.
test("every camera entry assembles into a whole program", () => {
  expect(TRANSPORT_CAMERAS).toEqual(Object.keys(CAMERAS));
  for (const [name, cam] of Object.entries(CAMERAS)) {
    expect(typeof cam.prologue).toBe("string");
    expect(typeof cam.camera).toBe("string");
    expect(Array.isArray(cam.material) && cam.material.length > 0).toBe(true);
    expect(Array.isArray(cam.params)).toBe(true);          // documentation-grade, but it must be there to be read
    const src = buildTransport(name);
    expect(src.startsWith("#version 300 es")).toBe(true);
    expect(src.includes("void main(){")).toBe(true);
    expect(src.includes("${")).toBe(false);                 // every interpolation resolved at module load
  }
});

test("an unknown camera is refused rather than silently assembled empty", () => {
  expect(() => buildTransport("periscope")).toThrow();
});

// ---- THE SKY FILL (§4.7). A uniform group like any other, plus two couplings that would otherwise fail silently:
// the sky view must never read what it has no surface to light, and the per-ray physics the fill integrates must be
// the SAME source the sky view runs, so the two cannot drift into two answers to "what does this ray see".
test("the sky fill is a registry group: declared, uploaded, spoken by the cameras that light a surface and not by the sky view", () => {
  expect(Object.keys(TRANSPORT_GROUPS.fill.locs).sort()).toEqual(["canopyFill", "fillExtent", "fillOrigin", "fillS", "fillT"]);
  expect(GROUP_UPLOAD_KEYS).toContain("fill");
  for (const cam of ["floor", "cloth", "enclosure"]) expect(CAMERAS[cam].groups, cam).toContain("fill");
  expect(CAMERAS.sky.groups).not.toContain("fill");
});

test("the sky view never reads the fill: no uniform, no tap, no branch in its program", () => {
  const sky = buildTransport("sky");
  for (const name of ["uCanopyFill", "uFillT", "uFillS"]) expect(sky.includes(name), name).toBe(false);
});

test("a shut canopy_fill runs the OLD expression verbatim, on the floor and on both cloth receivers", () => {
  // the gate's whole claim is that off is the bytes it always was; the pixel harness executes it, this pins that
  // the literal line is still in the source (as the else of a uniform branch — canopy_fill tweens, so a program
  // cannot be selected by it: programs are chosen by MODE flags only, §4.6)
  expect(buildTransport("floor")).toContain("col = (acc*uSunColor + uAmbient) * uGround;");
  for (const cam of ["cloth", "enclosure"]) expect(buildTransport(cam), cam).toContain("E = acc*uSunColor*beamF + uAmbient*skyF;");
  for (const cam of ["floor", "cloth", "enclosure"]) {
    const src = buildTransport(cam);
    expect(src.includes("if(uCanopyFill > 0.0){"), cam).toBe(true);
    // every read of the fill textures sits behind that gate: the only mentions before it are the uniform declarations
    const before = src.slice(0, src.indexOf("if(uCanopyFill > 0.0){"));
    expect(before.replace(/uniform highp sampler2D uFill[TS];/g, "").replace(/uniform vec2 {2}uFill(Origin|Extent);/g, "").includes("uFill"), cam).toBe(false);
  }
});

test("the per-ray physics is ONE source: the sky view and the fill both carry GLSL_SKY_RAY and neither restates its sum", () => {
  const sky = buildTransport("sky");
  expect(sky.includes(GLSL_SKY_RAY)).toBe(true);
  expect(FS_FILL.includes(GLSL_SKY_RAY)).toBe(true);
  // the telescoping source term lives in the snippet and nowhere else in either program
  const term = "thr*(1.0-tL";
  expect(GLSL_SKY_RAY.includes(term)).toBe(true);
  expect(sky.split(GLSL_SKY_RAY).join("").includes(term)).toBe(false);
  expect(FS_FILL.split(GLSL_SKY_RAY).join("").includes(term)).toBe(false);
});

test("the shared per-ray snippet never reads the skylight: its passage is T·sky, so a source term of it counts it twice", () => {
  // the source term is the SUN's light scattered by the lit leaves (§4.9). uAmbient inside it re-radiates skylight
  // that the transmission term (the eye ray's T·sky, the fill's Tsky) already carries.
  expect(GLSL_SKY_RAY.replace(/\/\/.*$/gm, "").includes("uAmbient")).toBe(false);
});

test("both programs declare every uniform the shared per-ray snippet reads", () => {
  const needs = new Set(GLSL_SKY_RAY.replace(/\/\/.*$/gm, "").match(/\bu[A-Z]\w*/g));   // identifiers in the code, not in the prose
  expect(needs.size).toBeGreaterThan(5);
  for (const [name, src] of [["sky", buildTransport("sky")], ["fill", FS_FILL]])
    for (const u of needs) expect(new RegExp(`uniform[^;]*\\b${u}\\b`).test(src), `${name} declares ${u}`).toBe(true);
  // ...as the SAME lines the transport head and the sunDir group declare them with, not look-alikes
  for (const cam of TRANSPORT_CAMERAS) expect(buildTransport(cam).includes(GLSL_LAYER_FIELD), cam).toBe(true);
  expect(FS_FILL.includes(GLSL_LAYER_FIELD)).toBe(true);
  expect(FS_FILL.includes(GLSL_SUN_DIR_DECLS)).toBe(false);   // the fill walks the beam's sun path (uFillG), so it has no sun direction to declare
  expect(buildTransport("sky").includes(GLSL_SUN_DIR_DECLS)).toBe(true);
});

test("the fill is READ from a coarser mip: K rays point-sampled per texel are an estimate with leaf-scale speckle, and a bilinear read of it is a lattice", () => {
  // averaging the fill's own output (T and S are already transmittance and radiance) is more rays' worth of the same
  // estimator — the box average of the mip — and is NOT the forbidden blur of tau, which would veil a gappy canopy
  for (const cam of ["floor", "cloth", "enclosure"]) {
    const src = buildTransport(cam);
    expect(src.includes("textureLod(uFillT"), `${cam} reads Tsky through textureLod`).toBe(true);
    expect(/texture\(uFill[TS]/.test(src), `${cam} has no plain bilinear fill read`).toBe(false);
  }
  expect(buildTransport("floor").includes("textureLod(uFillS")).toBe(true);
  expect(buildTransport("floor").includes("const float FILL_LOD")).toBe(true);
});

// ---- THE BEAM (§4.5). The beam's k is read by the taps, and by the receivers' fill share: it is a group of its own so that a bundle which cuts
// the leaf's diffuse share (embed-build.mjs, FEATURES.leafDiffuse) drops the uniform and keeps the taps as the functions they are.
test("the beam's k is a group of its own, spoken before the taps that read it, and the taps are functions only", () => {
  expect(Object.keys(TRANSPORT_GROUPS.beam.locs)).toEqual(["beamK", "edgeArea"]);
  expect(TRANSPORT_GROUPS.beam.decls.includes("uniform float uBeamK;")).toBe(true);
  expect(TRANSPORT_GROUPS.tap.locs).toBeUndefined();
  expect(TRANSPORT_GROUPS.tap.decls.includes("uniform")).toBe(false);
  expect(GROUP_UPLOAD_KEYS).toContain("beam");
  expect(GROUP_UPLOAD_KEYS).not.toContain("tap");
  for (const cam of ["floor", "cloth", "enclosure"]) {
    const g = CAMERAS[cam].groups;
    expect(g.indexOf("beam"), `${cam} speaks beam`).toBeGreaterThanOrEqual(0);
    expect(g.indexOf("beam"), `${cam}: declaration before use`).toBeLessThan(g.indexOf("tap"));
    expect(g.indexOf("tap")).toBeLessThan(g.indexOf("ca"));   // tapCA reads uBeamK too
  }
  expect(CAMERAS.sky.groups).not.toContain("beam");           // the sky view declares its own uBeamK in its own group
});

test("every feature that owns a group names one that exists and that a camera speaks — a feature the cut could not find would silently stay", () => {
  for (const [name, f] of Object.entries(FEATURES)) {
    if (!f.group) continue;
    expect(ALL_GROUPS.includes(f.group), `${name}: group ${f.group}`).toBe(true);
    expect(SPOKEN.has(f.group), `${name}: ${f.group} is spoken`).toBe(true);
  }
});
