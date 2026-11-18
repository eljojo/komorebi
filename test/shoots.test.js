// ============================================================================
// Leaves on shoots, displayed by light (komorebi-shoots.js; spec model/canopy.md "Shoots", model/leaf.md). What must hold: the law's cited ends;
// a leaf's shoot and node are its own (prefix-stable, pure in (seed, j, k)); the shares glide from nothing to everything; the scene's sun never
// reaches it; a blade points away from its node; the salt is its own.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { DEFAULTS, PARAMS } from "../engine/komorebi-params.js";
import { PRESETS } from "../presets.js";
import { SHOOT, SHOOT_LEAF_SALT, clusterShoots, lightTilt, longShare, shootLeaf, tiltMeanDeg } from "../engine/canopy/komorebi-shoots.js";
import { makeGrove } from "../engine/canopy/komorebi-grove.js";
const ENGINE_SOURCES = [...readdirSync(new URL("../", import.meta.url)).filter((n) => /^komorebi.*\.js$/.test(n)), ...readdirSync(new URL("../engine/", import.meta.url), { recursive: true }).filter((n) => n.endsWith(".js")).map((n) => `engine/${n}`)];   // every module of the engine, as a path from the root

function grow(over) {
  const gl = new Proxy({}, { get(t, name) {
    if (typeof name !== "string") return undefined;
    return (...a) => { if (name === "createBuffer") return { data: null }; if (name === "bindBuffer") { t.cur = a[1]; return undefined; } if (name === "bufferData") { if (t.cur) t.cur.data = a[1]; return undefined; } return {}; };
  } });
  const params = { ...DEFAULTS, ...PRESETS["park 1"], ...over };
  return makeGrove({ gl, params, MAX_TEX: 16384, quadBuf: {}, faithfulOn: () => true, occ: {}, faith: {}, sky: { start: [], count: [] } }).growGrove(null, {});
}

test("the law's cited ends: Planchais's 22° in shade and 34° in the open, ⟨cos⟩ against their Table 3; Lemoine's long share", () => {
  expect(tiltMeanDeg(0.05)).toBe(22); expect(tiltMeanDeg(0)).toBe(22); expect(tiltMeanDeg(1)).toBe(34);
  const cosMean = (e) => { let s = 0; const n = 20000; for (let i = 0; i < n; i++) s += Math.cos(lightTilt((i + 0.5) / n, e)); return s / n; };
  expect(cosMean(0.05)).toBeCloseTo(0.905, 2); expect(cosMean(1)).toBeCloseTo(0.781, 2);
  expect(Math.abs(cosMean(0.05) - 0.91)).toBeLessThan(0.02); expect(Math.abs(cosMean(1) - 0.80)).toBeLessThan(0.02);
  expect(longShare(0.138)).toBeCloseTo(0.40, 12); expect(longShare(1)).toBeCloseTo(0.85, 12);
});

test("a leaf's shoot and node are its own: a cluster's shoots are prefix-stable in the leaf count, and pure in (seed, j)", () => {
  for (const opposite of [false, true]) for (const j of [0, 7, 311]) {
    const a = clusterShoots(290626672, j, 12, opposite), b = clusterShoots(290626672, j, 30, opposite);
    expect(b.leaf.slice(0, 12)).toEqual(a.leaf);
    expect(b.shoot.slice(0, a.shoot.length)).toEqual(a.shoot);
    expect(clusterShoots(290626672, j, 12, opposite)).toEqual(a);
    if (opposite) for (const l of a.leaf) expect(l.side === 1 || l.side === -1).toBe(true);
  }
});

test("a switch: on, every leaf hangs at its node; off, none does", () => {
  const t = { x: 0, y: 0, z: 3, dx: 1, dy: 0, bx: -0.3, by: 0 }, o = [0, 0, 0, 0, 0, 0];
  for (const opposite of [false, true]) {
    const cs = clusterShoots(77, 3, 200, opposite), P = { ...DEFAULTS, phyllotaxis: opposite ? "opposite" : "spiral", inner_leaves: 0 };
    const share = (x) => cs.leaf.map((_, k) => shootLeaf(cs, 3, k, t, 0.5, { ...P, shoot_leaves: x }, 0.1, 0.5, o)[5]);
    expect(share(1).every((w) => w === 1)).toBe(true);
    expect(share(0).every((w) => w === 0)).toBe(true);
  }
});

test("a blade points away from its node: the record's clockwise heading turns the leaf's own +x (its apex) onto the blade's direction", () => {
  const t = { x: 0, y: 0, z: 3, dx: 0.6, dy: 0.8, bx: -0.3, by: -0.4 }, o = [0, 0, 0, 0, 0, 0];
  const cs = clusterShoots(5, 0, 12, false), P = { ...DEFAULTS, inner_leaves: 0, shoot_leaves: 1, phyllotaxis: "spiral" };
  for (let k = 0; k < 12; k++) {
    const lt = 0.1, origin = 0.5;
    shootLeaf(cs, 0, k, t, 0.6, P, lt, origin, o);
    const apex = [Math.cos(o[4]), -Math.sin(o[4])];   // R(a)·(1, 0) with R = mat2(c, -s, s, c), column-major (GLSL_FAITH_VERTEX)
    // the leaf's place minus its node is the blade's direction times its reach, so the apex points along it
    const { s, node } = cs.leaf[k], sh = cs.shoot[s];
    expect(Number.isFinite(o[4]) && sh.n > 0 && node >= 0).toBe(true);
    const shoot0 = shootLeaf(cs, 0, k, t, 0.6, { ...P }, 0, 0, [0, 0, 0, 0, 0, 0]);   // reach 0 but the petiole: still along the blade
    const dir = [o[0] - shoot0[0], o[1] - shoot0[1]], dl = Math.hypot(...dir);
    expect(dir[0] / dl).toBeCloseTo(apex[0], 9); expect(dir[1] / dl).toBeCloseTo(apex[1], 9);
  }
});

test("the scene's sun never reaches it, and two builds are the same bytes", () => {
  const a = grow({}), b = grow({ sun_elevation_deg: 64, sun_azimuth_deg: 200 }), c = grow({});
  expect(Array.from(b.faithArr.filter((_, i) => i % 18 < 8 || i % 18 >= 16))).toEqual(Array.from(a.faithArr.filter((_, i) => i % 18 < 8 || i % 18 >= 16)));
  expect(Array.from(c.faithArr)).toEqual(Array.from(a.faithArr));
});

test("the shoots and the tilt move leaves, at 0 they read nothing, and the looks kept as made keep 0", () => {
  const on = grow({}), off = grow({ shoot_leaves: 0, tilt_light: 0 }), tilt = grow({ shoot_leaves: 0 });
  expect(on.hier.leafShoots).not.toBeNull(); expect(off.hier.leafShoots).toBeNull(); expect(off.hier.leafLight).toBeNull(); expect(tilt.hier.leafShoots).toBeNull();
  let moved = 0, tilted = 0;
  for (let i = 0; i < off.faithArr.length; i += 18) { if (on.faithArr[i] !== off.faithArr[i]) moved++; if (tilt.faithArr[i + 5] !== off.faithArr[i + 5]) tilted++; }
  expect(moved).toBeGreaterThan(off.faithArr.length / 18 / 2);
  expect(tilted).toBeGreaterThan(off.faithArr.length / 18 / 2);
  for (let i = 0; i < off.faithArr.length; i += 18) expect(tilt.faithArr[i]).toBe(off.faithArr[i]);   // tilt alone moves no leaf
  const KEPT = [...Object.keys(PRESETS).filter((n) => n.startsWith("afternoon")), "morning 1", "morning 2", "morning 3", "forest floor", "prism"];   // kept as made, as the artist chose (contracts/looks.md); morning 3b takes the shoots
  for (const n of KEPT) { expect(PRESETS[n].shoot_leaves, n).toBe(0); expect(PRESETS[n].tilt_light, n).toBe(0); }
});

test("a grove grown year by year hangs its leaves on its own grown shoots: shoot_leaves stands aside", () => {
  const g = grow({ growth_years: 3 });
  expect(g.hier.leafShoots).toBeNull();
});

test("shoot_leaves travels as a different arrangement of the same leaves, never a morph: a leaf's old place and its place on a shoot can be a limb apart", () => {
  expect(PARAMS.shoot_leaves.travels).toBe("topo");
  // and the measured reason: a one-second morph of the share, stepped as the engine steps it, flew a leaf 19.5 of its own lengths in a frame
});

test("the shoots' salt is its own", () => {
  const src = ENGINE_SOURCES.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
  const all = [...src.matchAll(/_SALT\s*=\s*(0x[0-9A-Fa-f]+)/g)].map((m) => Number(m[1]));
  expect(all.filter((v) => v === SHOOT_LEAF_SALT)).toHaveLength(1);
  expect(SHOOT.longShare[0][1]).toBe(0.4);
});
