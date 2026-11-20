// ============================================================================
// The sky the floor camera sees over the horizon (view_sky; komorebi-light.js THE SKY SEEN, spec/model/light.md). What must hold: the sky's level is the
// ambient's, one factor for all three bands, so the whole sky lights a horizontal surface with the ambient's luminance and keeps its own hue; the second
// order is the once-scattered sky's mean radiance; the sky is blue overhead, pale at the horizon, warm and bright toward a low sun, and still blue overhead
// under a setting sun; the shader's skyRadiance is skyShape, constant for constant and step for step; and the sky's code is compiled only into the floor's
// sky variant, so the floor without it is the program it was.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { TRANSPORT_CAMERAS, buildTransport } from "../komorebi.js";
import { FS_TREE, FS_TREE_WOOD, GLSL_SKY_SEEN, defineIn } from "../engine/transport/komorebi-shaders.js";
import { treeNames } from "../engine/transport/komorebi-tree-view.js";
import { atmosphere, sunDirection, skyShape, skyModel, SKY_G, SKY_HR, SKY_HA, SKY_R, SKY_TOP, SKY_STEPS } from "../engine/light/komorebi-light.js";

const DEG = Math.PI / 180;
const Y = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const dir = (elDeg, azDeg) => [Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG), Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG), Math.sin(elDeg * DEG)];
// A scene's sky as the render builds it: the sun's direction, and skyModel from the same elevation, turbidity and ambient (komorebi-render.js).
const scene = (el, beta, az = 0, ambientSky = 0.3925) => {
  const atm = atmosphere({ sun: [0, 0, 0], ambient: [0, 0, 0] }, el, beta, ambientSky), s = sunDirection([0, 0, 0], el, az);
  return { atm, s, M: skyModel(el, beta, s, atm.ambient) };
};
const shown = ({ s, M }, d) => skyShape(d, s, M).map((v, i) => v * M.scale[i]);   // the radiance as the shader shows it (skyRadiance)
// The irradiance a horizontal surface takes from a sky, over the upper hemisphere on a grid finer than skyModel's own (16 × 32), so the test is not the
// model's quadrature checked against itself.
const irradiance = (L) => {
  const E = [0, 0, 0], NE = 48, NA = 96;
  for (let j = 0; j < NE; j++) {
    const e = (j + 0.5) / NE * Math.PI / 2, dw = (Math.PI / 2 / NE) * (2 * Math.PI / NA) * Math.cos(e);
    for (let k = 0; k < NA; k++) { const v = L([Math.cos(e) * Math.cos((k + 0.5) / NA * 2 * Math.PI), Math.cos(e) * Math.sin((k + 0.5) / NA * 2 * Math.PI), Math.sin(e)]); for (let i = 0; i < 3; i++) E[i] += v[i] * Math.sin(e) * dw; }
  }
  return E;
};
const SUNS = [[70, 0.05], [30, 0.05], [12, 0.05], [4, 0.05], [12, 0.3], [30, 0.15]];

test("the whole sky lights a horizontal surface with the ambient's luminance, shown in the receivers' units (a sky of radiance L shows as πL)", () => {
  for (const [el, beta] of SUNS) for (const amb of [0.3925, 1]) {
    const sc = scene(el, beta, 40, amb);
    const E = irradiance((d) => shown(sc, d));
    expect(Math.abs(Y(E) / (Math.PI * Y(sc.atm.ambient)) - 1)).toBeLessThan(0.02);   // two quadratures of a sky peaked at the sun: within 2 %
  }
});

test("one factor for all three bands: the sky keeps its own hue, not the ambient's", () => {
  for (const [el, beta] of SUNS) {
    const sc = scene(el, beta);
    expect(sc.M.scale[1]).toBe(sc.M.scale[0]); expect(sc.M.scale[2]).toBe(sc.M.scale[0]);
  }
  // under a low sun the sky's own light is not the ambient's colour: scaled band by band it would be (the lavender sky)
  const sc = scene(12, 0.05), E = irradiance((d) => shown(sc, d)), a = sc.atm.ambient;
  expect(Math.abs(E[2] / E[0] - a[2] / a[0])).toBeGreaterThan(0.1);
});

test("the second order is the once-scattered sky's mean radiance: its irradiance on a horizontal surface over π, band by band", () => {
  for (const [el, beta] of SUNS) {
    const { s, M } = scene(el, beta), once = { ...M, iso: [0, 0, 0] };
    const E = irradiance((d) => skyShape(d, s, once));
    for (let i = 0; i < 3; i++) expect(Math.abs(M.iso[i] / (E[i] / Math.PI) - 1)).toBeLessThan(0.02);   // two quadratures of a sky peaked at the sun: within 2 %
    expect(Math.min(...M.iso)).toBeGreaterThan(0);
  }
});

test("blue overhead and paler at the horizon, at any sun", () => {
  for (const [el, beta] of SUNS) {
    const sc = scene(el, beta), zen = shown(sc, [0, 0, 1]), hor = shown(sc, dir(1, 90));
    expect(zen[2] / zen[0]).toBeGreaterThan(hor[2] / hor[0]);
    expect(zen[2]).toBeGreaterThan(zen[0]);
  }
});

test("toward a low sun the horizon is warmer and brighter than away from it", () => {
  for (const [el, beta] of [[12, 0.05], [4, 0.05], [12, 0.3]]) {
    const sc = scene(el, beta, 60), toward = shown(sc, dir(2, 60)), away = shown(sc, dir(2, 240));
    expect(toward[0] / toward[2]).toBeGreaterThan(away[0] / away[2]);
    expect(Y(toward)).toBeGreaterThan(2 * Y(away));
  }
});

test("under a setting sun the zenith is still blue: the high air sees the sun through the air above it, not the ground's whole path", () => {
  // a sun reddened by its full path at every height (the first version) left a 3° sun's zenith grey to warm; through the air above each point it is blue
  for (const el of [1, 3, 6]) { const z = shown(scene(el, 0.05), [0, 0, 1]); expect(z[2] / z[0]).toBeGreaterThan(1.5); }
});

test("the second order lifts the horizon away from a low sun: without it that horizon is far darker against the sky above it", () => {
  const { s, M } = scene(12, 0.05), once = { ...M, iso: [0, 0, 0] };
  const ratio = (m) => Y(skyShape(dir(0.5, 180), s, m)) / Y(skyShape(dir(10, 180), s, m));
  expect(ratio(M)).toBeGreaterThan(1.5 * ratio(once));
});

// ---- THE SHADER'S HALF: GLSL skyRadiance run as written, per band, against skyShape ----
const FLOOR = buildTransport("floor"), FLOOR_SKY = buildTransport("floor", true);
const glslConst = (src, name) => Number(new RegExp(`\\b${name} = ([0-9.]+)`).exec(src)?.[1]);
// The function's body with its vec3s taken one band at a time: every vec3 uniform is that band's number, a vec3 of one value is that value, and the one
// true vector (the ray against the sun) is dotted as written.
function skyRadianceGLSL(src) {
  const body = /vec3 skyRadiance\(vec3 d\)\{\n([\s\S]*?)\n\}/.exec(src)[1]
    .replace(/float\((\w+)\)/g, "$1")
    .replace(/\b(float|vec3|int)\s+/g, "let ")
    .replace(/vec3\(d\.xy, z\)/g, "[d[0], d[1], z]").replace(/d\.z/g, "d[2]")
    .replace(/vec3\(0\.0\)/g, "0");
  const f = new Function("d", "uSkySunDir", "uSkyR", "uSkyA", "uSkyO", "uSkyIso", "uSkyMs", "uSkyScale", "SKY_G", "SKY_HR", "SKY_HA", "SKY_R", "SKY_TOP", "SKY_STEPS",
    `const { max, sqrt, exp, pow } = Math; const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];\n${body}`);
  const C = ["SKY_G", "SKY_HR", "SKY_HA", "SKY_R", "SKY_TOP", "SKY_STEPS"].map((n) => glslConst(src, n));
  return (d, s, M) => [0, 1, 2].map((i) => f(d, s, M.r[i], M.a[i], M.o[i], M.iso[i], M.ms, M.scale[i], ...C));
}

test("the shader's skyRadiance carries skyShape's constants, its phases' 3/16π and 1/4π, and the same rays", () => {
  expect([glslConst(FLOOR_SKY, "SKY_G"), glslConst(FLOOR_SKY, "SKY_HR"), glslConst(FLOOR_SKY, "SKY_HA"), glslConst(FLOOR_SKY, "SKY_R"), glslConst(FLOOR_SKY, "SKY_TOP"), glslConst(FLOOR_SKY, "SKY_STEPS")])
    .toEqual([SKY_G, SKY_HR, SKY_HA, SKY_R, SKY_TOP, SKY_STEPS]);
  expect(Number(/float pR = ([0-9.]+)\*/.exec(FLOOR_SKY)[1])).toBeCloseTo(3 / (16 * Math.PI), 7);
  expect(Number(/pA = ([0-9.]+)\*/.exec(FLOOR_SKY)[1])).toBeCloseTo(1 / (4 * Math.PI), 7);
  const glsl = skyRadianceGLSL(FLOOR_SKY);
  for (const [el, beta, az] of [[12, 0.05, 30], [3, 0.1, -140], [55, 0.3, 200]]) {
    const sc = scene(el, beta, az);
    for (const d of [[0, 0, 1], dir(0, az), dir(5, az + 180), dir(30, az + 90), dir(-20, az)]) {
      const a = shown(sc, d), b = glsl(d, sc.s, sc.M);
      for (let i = 0; i < 3; i++) expect(Math.abs(b[i] - a[i]) / a[i]).toBeLessThan(1e-6);
    }
  }
});

test("the floor's program carries the sky only in its sky variant: every line of it compiled out without VIEW_SKY, and nothing else differs", () => {
  expect(FLOOR).not.toContain("#define VIEW_SKY");
  expect(FLOOR_SKY.startsWith("#version 300 es\n#define VIEW_SKY\n")).toBe(true);
  expect(FLOOR_SKY.replace("#define VIEW_SKY\n", "")).toBe(FLOOR);
  // every line that names the sky sits inside an #ifdef VIEW_SKY block
  let depth = 0, inSky = 0, named = 0;
  for (const line of FLOOR.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#if")) { depth++; if (t === "#ifdef VIEW_SKY") inSky = depth; continue; }
    if (t.startsWith("#endif")) { if (inSky === depth) inSky = 0; depth--; continue; }
    if (/skyRadiance|gSkyDir|uSky(SunDir|R|A|O|Iso|Ms|Scale)\b|SKY_(G|HR|HA|R|TOP|STEPS)\b/.test(line)) { named++; expect(`${inSky > 0}: ${t}`).toBe(`true: ${t}`); }
  }
  expect(named).toBeGreaterThan(5);
  // the sky changes what the post block mixes the far floor toward, and only under the floor's own ray
  expect(FLOOR_SKY).toContain("if(gSkyDir.z > -1.5) col = mix(colNear, skyRadiance(gSkyDir), fog);");
  // no other camera has a sky variant
  for (const cam of TRANSPORT_CAMERAS.filter((c) => c !== "floor")) expect(buildTransport(cam, true)).toBe(buildTransport(cam));
});

test("the render compiles the floor's sky variant only for a look that opens view_sky, and builds the sky's air only then", () => {
  const render = readFileSync(new URL("../engine/transport/komorebi-render.js", import.meta.url), "utf8");
  expect(render).toContain("transportFor(cam, !!params.view_sky)");
  expect(render).toMatch(/if\(params\.view_sky\)\{[^\n]*\n[^\n]*sunDirection[\s\S]{0,400}?skyModel\(params\.sun_elevation_deg, params\.sky_turbidity, sd, a\)/);
});

test("the seen tree fades into the same sky as the floor beside it: one snippet, along the ray from the eye, only in its sky variant; without it the flat haze it always took", () => {
  expect(FLOOR_SKY).toContain(GLSL_SKY_SEEN);
  for (const src of [FS_TREE, FS_TREE_WOOD]) {
    const sky = defineIn(src, ["VIEW_SKY"]);
    expect(sky).toContain(GLSL_SKY_SEEN);
    expect(sky).toContain("  if(fog > 0.0) col = mix(col, skyRadiance(normalize(P - uEye)), fog);");
    let depth = 0, inSky = 0, named = 0;
    for (const line of src.split("\n")) {
      const t = line.trim();
      if (t.startsWith("#if")) { depth++; if (t === "#ifdef VIEW_SKY") inSky = depth; continue; }
      if (t.startsWith("#else")) { if (inSky === depth) inSky = -depth; continue; }
      if (t.startsWith("#endif")) { if (Math.abs(inSky) === depth) inSky = 0; depth--; continue; }
      if (/skyRadiance|uSky(SunDir|R|A|O|Iso|Ms|Scale)\b/.test(line)) { named++; expect(`${inSky > 0}: ${t}`).toBe(`true: ${t}`); }
    }
    expect(named).toBeGreaterThan(5);
    expect(src).toContain("#else\n  col = mix(col, uHazeColor, fog);\n#endif");
  }
  expect(treeNames({ view_sky: true })).toEqual(["VIEW_SKY"]);
  expect(treeNames({ view_sky: false })).toEqual([]);
});
