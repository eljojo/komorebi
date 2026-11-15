// Tests for komorebi-air.js: the air the grove stands in. Run: `bun test air.test.js`.
// The off state owes the old flutter exactly; the air's kept past and its run ahead are the same G the motion drives the
// trunk with; a clump downwind feels the gust later by its distance over U; the eddies are a factor of mean 1. The wind's
// reach: off, every leaf rocks; on, the skin always, the core only once the wind is strong enough, deeper as it rises.
import { expect, test } from "bun:test";
import { AIR, DEPTH, advanceAir, airCurve, airDelay, airForce, airLevel, curveForce, depthGate, eddy, flutterLevel, gustEdge, leanForce, makeAirTrack, weatherAt } from "./komorebi-air.js";
import { crownDepth } from "./komorebi-grove.js";
import { DEFAULTS } from "./komorebi-params.js";

const P = { ...DEFAULTS, wind_strength: 0.6, wind_gustiness: 0.5, wind_pattern: "squally", weather_variability: 0.7 };
const h = 1 / AIR.hz;
// the motion's own step of G, at the air's grid rate
const step = (G, t) => gustEdge(G, leanForce(P, t, weatherAt(P, t).weatherS), h, P);

test("wind_air 0 flutters with the trunk's sway, exactly", () => {
  for (const u of [-1.3, -0.4, 0, 1e-9, 0.37, 1.2]) expect(flutterLevel(u, 99, 0)).toBe(Math.abs(u));
  expect(flutterLevel(-0.5, 0.8, 1)).toBe(0.8);
  expect(flutterLevel(-0.5, 0.8, 0.25)).toBeCloseTo(0.5 * 0.75 + 0.8 * 0.25, 12);
});

test("the run ahead is the G the motion goes on to drive the trunk with", () => {
  const tr = makeAirTrack();
  let G = 0, t = 0;
  for (let k = 0; k < 600; k++) { G = step(G, t); t = (k + 1) * h; advanceAir(tr, P, t, G, false); }
  advanceAir(tr, P, t, G, true);
  const ahead = [];
  for (let k = 1; k <= 120; k++) { G = step(G, t + (k - 1) * h); ahead.push(G); }
  for (let k = 1; k <= 120; k++) expect(airForce(tr, t + k * h)).toBeCloseTo(ahead[k - 1], 6);   // kept in single precision
});

test("the kept past returns G as it was, and the present is G now", () => {
  const tr = makeAirTrack(), seen = [];
  let G = 0, t = 0;
  for (let k = 0; k < 300; k++) { G = step(G, t); t = (k + 1) * h; seen.push(G); advanceAir(tr, P, t, G, false); }
  for (const back of [1, 7, 60, 250]) expect(airForce(tr, t - back * h)).toBeCloseTo(seen[seen.length - 1 - back], 6);
  expect(airForce(tr, t)).toBe(G);
});

test("G is continuous across the present, at any frame step", () => {
  const tr = makeAirTrack();
  let G = 0, t = 0;
  for (let k = 0; k < 500; k++) { const dt = 1 / 60 + ((k * 7919) % 13 - 6) * 3e-4; G = gustEdge(G, leanForce(P, t, weatherAt(P, t).weatherS), dt, P); t += dt; advanceAir(tr, P, t, G, true); }
  expect(Math.abs(airForce(tr, t - 1e-4) - airForce(tr, t + 1e-4))).toBeLessThan(1e-3);
});

test("a clump downwind feels the gust later, by its distance along the wind over U", () => {
  const tr = makeAirTrack();
  let G = 0, t = 0;
  for (let k = 0; k < 900; k++) { G = step(G, t); t = (k + 1) * h; advanceAir(tr, P, t, G, true); }
  const force = (tau) => airForce(tr, tau), wx = Math.cos(0.6), wy = Math.sin(0.6);
  for (const [x, y] of [[0, 0], [4, 1], [-6, 2], [12, -3]]) {
    const s = x * wx + y * wy;
    expect(airDelay(x, y, wx, wy)).toBeCloseTo(s / AIR.U, 12);
    expect(airLevel(force, t, x, y, wx, wy) / eddy(t, x, y, wx, wy)).toBeCloseTo(Math.abs(force(t - s / AIR.U)), 12);
  }
});

test("a consumer's curve reads G as the track does", () => {
  const tr = makeAirTrack();
  let G = 0, t = 0;
  for (let k = 0; k < 900; k++) { G = step(G, t); t = (k + 1) * h; advanceAir(tr, P, t, G, true); }
  const tau0 = t - 5, curve = airCurve(tr, tau0, 301);
  for (const tau of [t - 4.97, t - 1.234, t, t + 2.5, t + 4.9]) expect(curveForce(curve, tau0, tau)).toBeCloseTo(airForce(tr, tau), 4);
});

test("the eddies are a factor of mean 1 that never goes below zero", () => {
  let sum = 0, min = Infinity, n = 0;
  for (let i = 0; i < 400; i++) for (let k = 0; k < 50; k++) {
    const e = eddy(k * 0.37, (i % 20) * 0.7, Math.floor(i / 20) * 0.9, 1, 0);
    sum += e; min = Math.min(min, e); n++;
  }
  expect(min).toBeGreaterThan(0);
  expect(sum / n).toBeGreaterThan(0.85);
  expect(sum / n).toBeLessThan(1.15);
});

test("wind_depth 0 rocks every leaf, at any depth and level", () => {
  for(const d of [0, 0.3, 1]) for(const L of [0, 0.05, 0.4, 2]) expect(depthGate(L, d, 0)).toBe(1);
});

test("the skin always rocks; the core only once the wind reaches it", () => {
  for(const L of [0, 0.01, 0.3, 1]) expect(depthGate(L, 0, 1)).toBe(1);
  expect(depthGate(0.05, 1, 1)).toBe(0);                        // a faint wind does not reach the core
  expect(depthGate(DEPTH.L0, 1, 1)).toBe(1);                    // L0 reaches it at wind_depth 1
  expect(depthGate(2*DEPTH.L0, 1, 2)).toBe(1);                  // a higher wind_depth needs a stronger wind for the same reach
  expect(depthGate(DEPTH.L0, 1, 2)).toBeLessThan(1);
});

test("the reach grows with the wind and shrinks with the depth, smoothly", () => {
  let prev = -1;
  for(let L = 0; L <= 1; L += 0.01){ const g = depthGate(L, 0.6, 1); expect(g).toBeGreaterThanOrEqual(prev); expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThanOrEqual(1); prev = g; }
  prev = 2;
  for(let d = 0; d <= 1; d += 0.01){ const g = depthGate(0.3, d, 1); expect(g).toBeLessThanOrEqual(prev); prev = g; }
});

test("a crown's depth: 0 on its rim and top, the share more exposed inside, each tree its own", () => {
  // two trees; each has a rim clump, a top clump and an inner clump near its trunk, low
  const tw = [];
  for(const [tx, ty] of [[0, 0], [10, 0]]){
    tw.push({ x: tx + 2, y: ty, z: 3, tx, ty }, { x: tx + 0.2, y: ty, z: 5, tx, ty }, { x: tx + 0.3, y: ty + 0.1, z: 3.2, tx, ty });
  }
  const out = new Float32Array(tw.length*4); crownDepth(tw, out);
  for(const k of [0, 3]){
    expect(out[4*k+1]).toBeCloseTo(0, 6);             // the rim
    expect(out[4*(k+1)+1]).toBeCloseTo(0, 6);         // the top
    expect(out[4*(k+2)+1]).toBeCloseTo(1, 6);         // inside, low, near the trunk: both others more exposed
  }
});
