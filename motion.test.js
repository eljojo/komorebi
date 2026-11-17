// Tests for komorebi-motion.js's trunks: each tree of the grove is driven by the gust as it reaches it. Run: `bun test motion.test.js`.
// Tree 0 stands at the grove's origin and its trunk is the motion's own, step for step what it was before every tree had one; a tree
// downwind takes the same gusts later by its distance along the wind over U, and one upwind sooner; calm air leaves every tree at rest;
// and what each tree adds to tree 0's sway is what its clumps read (the cluster texture's row 2), exactly 0 for tree 0's.
import { expect, test } from "bun:test";
import { AIR, carrySpeed, crossForce, gustEdge, leanForce, weatherAt } from "./komorebi-air.js";
import { makeMotion } from "./komorebi-motion.js";
import { DEFAULTS } from "./komorebi-params.js";
import { DEG, clamp } from "./komorebi-math.js";

const WIND = { ...DEFAULTS, wind_strength: 1.61, wind_gustiness: 0.25, gust_frequency: 0.13, wind_pattern: "squally", gust_attack: 1.2, gust_decay: 1.3, sway_stiffness: 1.2, damping_ratio: 0.65, backlash_gain: 1, sway_ceiling: 0.4, wind_direction_deg: 0, weather_variability: 0.4, wind_air: 0, drift_auto: false };
const FPS = 60, DT = 1 / FPS;

// a grove of nothing but trees: their trunks in plan and one limb and one clump on each, which is all the trunks read
function grove(pos) {
  const n = pos.length, f = (k) => new Float32Array(n * k), ids = Int32Array.from(pos, (_, k) => k);
  return {
    nTree: n, treePos: Float32Array.from(pos.flat()), nLimb: n, limbTree: ids, nClusterTotal: n, clusterTree: ids, clusterLimb: ids,
    limbDir: f(2), limbPlan: f(2), limbAngle: f(1), limbVel: f(1), limbPitch: f(1), limbPitchVel: f(1), limbAttach: f(1),
    treeDelta: f(4), swayData: f(4), clusterData: f(4), airData: f(4), clusterPlan: f(2), clusterGeom: f(4), clusterPhase: f(1), twigAngle: f(1), twigVel: f(1),
  };
}
function run(params, pos, frames, extra = {}, start = {}) {
  const motion = { time: 0, u: 0, v: 0, uLat: 0, vLat: 0, env: 0, driveEnv: 0, sway: [0, 0], windX: 1, windY: 0, weatherS: 1, ...start };
  const hier = Object.assign(grove(pos), extra), uploads = [];
  const gl = new Proxy({}, { get: (_, k) => k === "texSubImage2D" ? (...a) => uploads.push(a[3]) : () => ({}) });
  const hub = { gl, params, motion, faithfulOn: () => true, grove: { hier, clusterTex: {} }, groveIn: null, hier };
  const { tick } = makeMotion(hub);
  const trace = [];
  for (let f = 0; f < frames; f++) { tick(DT); trace.push([motion.u, ...hier.nTree > 1 ? motion.trunks.slice(1).map((s) => s.u) : []]); }
  return { motion, hier, trace, uploads };
}

// the trunk as it was integrated before each tree had its own: one spring pair on the force at the origin, now
function before(params, frames) {
  const m = { time: 0, u: 0, v: 0, uLat: 0, vLat: 0, env: 0, driveEnv: 0 }, out = [];
  for (let f = 0; f < frames; f++) {
    const dt = clamp(DT, 0, 1 / 15), t = m.time, { weatherS, dirVeer } = weatherAt(params, t), effDir = params.wind_direction_deg * DEG + dirVeer;
    const rawL = leanForce(params, t, weatherS), driveT = crossForce(params, t, weatherS);
    m.driveEnv = gustEdge(m.driveEnv, rawL, dt, params);
    const w = params.sway_stiffness, steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps, dz = params.damping_ratio, bl = params.backlash_gain;
    const spring = (u, v, drive) => { const denom = Math.max(0.02, 1 - u * u); let damp = dz; if (u * v < 0) damp /= 1 + bl; return v + (w * w * (drive - u / denom) - 2 * damp * w * v) * h; };
    for (let i = 0; i < steps; i++) { m.v = spring(m.u, m.v, m.driveEnv); m.u += m.v * h; m.vLat = spring(m.uLat, m.vLat, driveT); m.uLat += m.vLat * h; }
    m.u = clamp(m.u, -1.5, 1.5); m.uLat = clamp(m.uLat, -1.5, 1.5);
    m.env += (clamp(Math.abs(m.u), 0, 1) - m.env) * (1 - Math.exp(-dt / 0.6));
    const cx = Math.cos(effDir), cy = Math.sin(effDir), ceil = params.sway_ceiling;
    out.push({ u: m.u, uLat: m.uLat, env: m.env, sway: [(cx * m.u - cy * m.uLat) * ceil, (cy * m.u + cx * m.uLat) * ceil] });
    m.time += dt;
  }
  return out;
}

test("tree 0's trunk is the motion's own, step for step what it was before, with one tree or eight", () => {
  const ref = before(WIND, 1800);
  const ring = Array.from({ length: 8 }, (_, k) => [k ? 3 * Math.cos(k) : 0, k ? 3 * Math.sin(k) : 0]);
  for (const pos of [[[0, 0]], ring]) {
    const { motion } = run(WIND, pos, 1800), last = ref[ref.length - 1];
    expect(Object.is(motion.u, last.u) && Object.is(motion.uLat, last.uLat) && Object.is(motion.env, last.env)).toBe(true);
    expect(Object.is(motion.sway[0], last.sway[0]) && Object.is(motion.sway[1], last.sway[1])).toBe(true);
  }
});

test("a tree downwind takes the same gusts later by its distance along the wind over U; one upwind, sooner", () => {
  const lag = 30, s = AIR.U * lag * DT;   // 1.5 m along the wind (+x): half a second, thirty frames
  const { trace } = run({ ...WIND, weather_variability: 0 }, [[0, 0], [s, 0], [-s, 0], [0, 4]], 3600);   // a steady direction: the weather's veer would turn the distance along the wind
  let down = 0, up = 0, across = 0, swing = 0;
  for (let f = 1800; f < 3600 - lag; f++) {   // past the start, where each began at rest on a different stretch of the gusts
    down = Math.max(down, Math.abs(trace[f + lag][1] - trace[f][0]));
    up = Math.max(up, Math.abs(trace[f][2] - trace[f + lag][0]));
    across = Math.max(across, Math.abs(trace[f][3] - trace[f][0]));
    swing = Math.max(swing, Math.abs(trace[f + lag][0] - trace[f][0]));
  }
  expect(down, "downwind: tree 0's u half a second later").toBeLessThan(1e-6);
  expect(up, "upwind: tree 0's u half a second sooner").toBeLessThan(1e-6);
  expect(across, "across the wind the gust arrives together").toBeLessThan(1e-6);
  expect(swing, "...and half a second is a lag the eye can see: the sway moves that much in it").toBeGreaterThan(0.05);
});

test("calm air leaves every tree at rest, and writes nothing to what they add", () => {
  const { motion, hier } = run({ ...WIND, wind_strength: 0 }, [[0, 0], [2, 1], [-3, 2]], 300);
  for (const s of [motion, ...motion.trunks.slice(1)]) expect([s.u, s.uLat, s.v, s.vLat]).toEqual([0, 0, 0, 0]);
  expect([...hier.treeDelta].every((x) => x === 0) && [...hier.swayData].every((x) => x === 0)).toBe(true);
});

test("what each tree adds to tree 0's sway and u is what its clumps read (row 2); tree 0's adds exactly 0, and one tree never writes the row", () => {
  const { motion, hier, uploads } = run(WIND, [[0, 0], [3, 0], [-2, 2]], 600);
  expect(uploads.length, "rows 0 and 2 each frame").toBe(1200);
  for (let k = 0; k < 3; k++) {
    const tr = k ? motion.trunks[k] : motion;
    expect(hier.swayData[4 * k]).toBe(Math.fround(tr.sway[0] - motion.sway[0]));
    expect(hier.swayData[4 * k + 1]).toBe(Math.fround(tr.sway[1] - motion.sway[1]));
    expect(hier.swayData[4 * k + 2]).toBe(Math.fround(tr.u - motion.u));
  }
  expect([hier.swayData[0], hier.swayData[1], hier.swayData[2]]).toEqual([0, 0, 0]);
  expect(Math.abs(hier.swayData[4]), "a tree downwind is somewhere else in its sway").toBeGreaterThan(1e-3);
  expect(run(WIND, [[0, 0]], 600).uploads.length, "one tree: row 0 only").toBe(600);
});

// ---- the prototypes, each off at 0 (the identity above runs with all four at their defaults) ----

test("sway_spread: a tree at pace p rings at p times the look's frequency (its springs' time runs p times as fast)", () => {
  // two trees across the wind (one gust), released from the same lean into calm air: the first crossing of rest comes at 1/p the time
  const calm = { ...WIND, wind_strength: 0, weather_variability: 0, sway_spread: 1 };
  const start = () => ({ u: 0.3, trunks: [null, { driveEnv: 0, u: 0.3, v: 0, uLat: 0, vLat: 0, env: 0 }] });
  const { trace } = run(calm, [[0, 0], [0, 3]], 600, { treePace: Float32Array.from([1, 0.8]) }, start());
  const cross = (k) => trace.findIndex((r) => r[k] < 0);
  expect(cross(0)).toBeGreaterThan(20);
  expect(cross(1) / cross(0)).toBeCloseTo(1 / 0.8, 1);
  const off = run({ ...calm, sway_spread: 0 }, [[0, 0], [0, 3]], 600, { treePace: Float32Array.from([1, 0.8]) }, start()).trace;
  expect(off.every((r) => r[0] === r[1]), "off: one pace").toBe(true);
});

test("gust_carry: the gust crosses at U·√(force), so the downwind lag shortens as the wind strengthens", () => {
  expect(carrySpeed({ ...WIND, gust_carry: 0, wind_strength: 4 }, 1)).toBe(AIR.U);
  expect(carrySpeed({ ...WIND, gust_carry: 1, wind_strength: 1 }, 1)).toBeCloseTo(AIR.U, 12);
  expect(carrySpeed({ ...WIND, gust_carry: 1, wind_strength: 4 }, 1)).toBeCloseTo(2 * AIR.U, 12);
  expect(carrySpeed({ ...WIND, gust_carry: 1, wind_strength: 0 }, 1), "never under 1 m/s").toBe(1);
  const P = { ...WIND, weather_variability: 0, wind_strength: 4, gust_carry: 1 }, lag = 30, s = 2 * AIR.U * lag * DT;
  const { trace } = run(P, [[0, 0], [s, 0]], 3600);
  let worst = 0;
  for (let f = 1800; f < 3600 - lag; f++) worst = Math.max(worst, Math.abs(trace[f + lag][1] - trace[f][0]));
  expect(worst).toBeLessThan(1e-6);
});

test("wind_shelter: a tree in a crown's wake leans less than one in the open; off, it leans as the open one", () => {
  const P = { ...WIND, weather_variability: 0, wind_shelter: 1 }, crowns = { treeCrown: Float32Array.from([2.5, 2.5, 2.5]) };
  const mean = (tr, k) => tr.slice(1800).reduce((a, r) => a + r[k], 0) / 1800;
  const on = run(P, [[0, 0], [3, 0], [0, 12]], 3600, crowns).trace;   // tree 1 three metres behind tree 0; tree 2 far across the wind
  const off = run({ ...P, wind_shelter: 0 }, [[0, 0], [3, 0], [0, 12]], 3600, crowns).trace;
  expect(mean(on, 1) / mean(off, 1), "in the lee: a smaller mean lean").toBeLessThan(0.75);
  expect(mean(on, 0)).toBe(mean(off, 0));   // tree 0 stands in the open, upwind of everything
  expect(mean(on, 2)).toBeCloseTo(mean(off, 2), 3);   // and so, near enough, does the one far across the wind
});
