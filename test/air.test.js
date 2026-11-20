// Tests for komorebi-air.js: the air the grove stands in. Run: `bun test air.test.js`.
// The off state owes the old flutter exactly; the air's kept past and its run ahead are the same G the motion drives the
// trunk with; a clump downwind feels the gust later by its distance over U; the eddies are a factor of mean 1. The wind's
// reach: off, every leaf rocks; on, the skin always, the core only once the wind is strong enough, deeper as it rises.
import { expect, test } from "bun:test";
import { AIR, DEPTH, FLICK, WIND_PATTERNS, advanceAir, airCurve, airDelay, airForce, airLevel, branchNoise, crossForce, curveForce, depthGate, eddy, flickLevel, flickMeanStep, flutterGust, flutterH, flutterLevel, gustEdge, leafFlutter, leanForce, makeAirTrack, shelter, weatherAt, windNoise } from "../engine/motion/komorebi-air.js";
import { fft } from "../test-gl/pattern-lib.mjs";
import { crownDepth } from "../engine/canopy/komorebi-grove.js";
import { DEFAULTS } from "../engine/komorebi-params.js";

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

// ---- the gust across the wind (gust_width_m) and the force in shelter (wind_shelter) ----
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; } return ab / Math.sqrt(aa * bb); };
const std = (a) => Math.sqrt(corr(a, a) * 0 + a.reduce((s, x) => s + x * x, 0) / a.length - (a.reduce((s, x) => s + x, 0) / a.length) ** 2);
test("a gust has a width: across the wind the force decorrelates over about gust_width_m, keeping its spread; y 0 is the force as it was", () => {
  const W = { ...P, weather_variability: 0, wind_pattern: "steady", gust_width_m: 4 }, ts = Array.from({ length: 6000 }, (_, i) => i * 0.05);
  const at = (y) => ts.map((t) => leanForce(W, t, 1, y));
  const y0 = at(0);
  expect(y0.every((f, i) => f === leanForce({ ...W, gust_width_m: 0 }, ts[i], 1)), "y 0: lane 0, the old force to the bit").toBe(true);
  expect(corr(y0, at(0.2)), "a fraction of a width: the same gust").toBeGreaterThan(0.95);
  expect(corr(y0, at(4)), "a width apart: another gust").toBeLessThan(0.3);
  expect(corr(y0, at(-12))).toBeLessThan(0.3);
  expect(std(at(2)) / std(y0), "between two lanes the spread is kept").toBeGreaterThan(0.85);
  expect(std(at(2)) / std(y0)).toBeLessThan(1.15);
  expect(at(7).every((f, i) => f === leanForce({ ...W, gust_width_m: 0 }, ts[i], 1, 7)) , "width 0: one gust everywhere").toBe(false);
  expect(ts.every((t) => leanForce({ ...W, gust_width_m: 0 }, t, 1, 7) === leanForce({ ...W, gust_width_m: 0 }, t, 1))).toBe(true);
});
test("in shelter S the mean drag takes S² and the gusts S (drag goes as the speed squared)", () => {
  const Q = { ...P, wind_gustiness: 0 };
  expect(leanForce(Q, 3, 1, 0, 0.5)).toBeCloseTo(leanForce(Q, 3, 1) * 0.25, 12);   // no gusts: the mean alone
  const G = { ...P, wind_gustiness: 0.5 }, open = leanForce(G, 3, 1), mean = leanForce({ ...G, wind_gustiness: 0 }, 3, 1);
  expect(leanForce(G, 3, 1, 0, 0.5)).toBeCloseTo(mean * 0.25 + (open - mean) * 0.5, 12);
  expect(crossForce(G, 3, 1, 0, 0.5)).toBeCloseTo(crossForce(G, 3, 1) * 0.5, 12);
});
test("shelter: the most upwind tree stands in the open; one in a crown's wake keeps less of the wind, fading downwind and across", () => {
  const pos = Float32Array.from([0, 0, 3, 0, 12, 0, 3, 8]), crown = Float32Array.from([2.5, 2.5, 2.5, 2.5]), S = new Float64Array(4);
  shelter(pos, crown, 4, 1, 0, 1, S);
  expect(S[0]).toBe(1);                              // upwind of all
  expect(S[1]).toBeLessThan(0.7);                    // three metres behind it: 0.64 of the wind
  expect(S[2]).toBeGreaterThan(S[1]);                // further back: the wake has mixed out more
  expect(S[3]).toBeGreaterThan(0.95);                // beside it, eight metres across the wind
  expect([...shelter(pos, crown, 4, 1, 0, 0, S)]).toEqual([1, 1, 1, 1]);   // off: everyone in the open
  shelter(pos, crown, 4, -1, 0, 1, S);
  expect(S[2], "the wind turned: the far tree is upwind now").toBe(1);
});

// the branch noise as wind (branch_noise): the same spread as windNoise's two tones, a tempo set by the pattern. How fast a
// signal changes is read as the spread of its step over a quarter second against its own spread: a lazy wind's branches
// move slowly, a choppy one's quickly, and the tones' tempo is the same for every pattern
test("branch noise: windNoise's spread, the pattern's tempo", () => {
	const fs = 24, n = fs * 1200, x = 1.3, y = -0.7, k = 1.5;
	const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
	const pace = (a) => sd(a.slice(6).map((v, i) => v - a[i])) / sd(a);
	const tones = Array.from({ length: n }, (_, i) => windNoise(x, y, i / fs, k));
	const of = (p) => Array.from({ length: n }, (_, i) => branchNoise(x, y, i / fs, k, WIND_PATTERNS[p]));
	const lazy = of("lazy"), gusty = of("gusty"), choppy = of("choppy");
	for (const b of [lazy, gusty, choppy]) expect(Math.abs(sd(b) / sd(tones) - 1)).toBeLessThan(0.08);
	expect(pace(lazy)).toBeLessThan(pace(gusty));
	expect(pace(gusty)).toBeLessThan(pace(choppy));
	expect(pace(choppy) / pace(lazy)).toBeGreaterThan(1.5);
});

// the leaf's flutter as wind (flutter_broadband): off, the caller's tone to the bit; on, the tone's spread, a spectrum that
// falls as f^-(2H+1) at the look's pattern's H over the floor's band, and each leaf an unrelated stretch of it
test("flutter_broadband 0 is the tone, to the bit", () => {
	for (const tone of [-1, -0.37, 0, 1e-9, 0.81]) for (const band of [0, undefined, -0.2]) expect(Object.is(leafFlutter(tone, 12.3, 1.7, 1.4, band, 0.34), tone)).toBe(true);
	const half = leafFlutter(0.4, 12.3, 1.7, 1.4, 0.5, 0.34), full = leafFlutter(0.4, 12.3, 1.7, 1.4, 1, 0.34);
	expect(half).toBeCloseTo((0.4 + full) / 2, 12);
	expect(flutterH({ wind_pattern: "lazy" })).toBe(WIND_PATTERNS.lazy.H);
	expect(flutterH({ wind_pattern: "nope" })).toBe(WIND_PATTERNS.gusty.H);
});
test("broadband flutter: the tone's spread, the pattern's slope, unrelated leaves", () => {
	const fs = 24, n = fs * 1800, f = 1.4, L = 8192;
	const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
	// Welch PSD, then the slope of log power against log frequency over log-spaced bins in [lo, hi]
	const slope = (x, lo, hi) => {
		const psd = new Float64Array(L / 2 + 1), re = new Float64Array(L), im = new Float64Array(L);
		for (let s = 0; s + L <= x.length; s += L / 2) {
			for (let i = 0; i < L; i++) { re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1))); im[i] = 0; }
			fft(re, im);
			for (let k = 0; k <= L / 2; k++) psd[k] += re[k] ** 2 + im[k] ** 2;
		}
		const nb = 12, sum = new Float64Array(nb), cnt = new Float64Array(nb), xs = [], ys = [];
		for (let k = 1; k <= L / 2; k++) {
			const fk = (k * fs) / L;
			if (fk < lo || fk > hi) continue;
			const b = Math.min(nb - 1, Math.floor((Math.log(fk / lo) / Math.log(hi / lo)) * nb));
			sum[b] += psd[k]; cnt[b]++;
		}
		for (let b = 0; b < nb; b++) if (cnt[b]) { xs.push(Math.log(lo) + ((b + 0.5) / nb) * Math.log(hi / lo)); ys.push(Math.log(sum[b] / cnt[b])); }
		const mx = xs.reduce((a, v) => a + v, 0) / xs.length, my = ys.reduce((a, v) => a + v, 0) / ys.length;
		let num = 0, den = 0;
		for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
		return -num / den;
	};
	const leaf = (phase, H) => Float64Array.from({ length: n }, (_, i) => leafFlutter(0, i / fs, phase, f, 1, H));
	const slopes = {};
	for (const [name, { H }] of Object.entries(WIND_PATTERNS)) {
		const x = leaf(1.7, H);
		expect(Math.abs(sd(x) * Math.SQRT2 - 1), `${name}: a sine's spread`).toBeLessThan(0.1);
		slopes[name] = slope(x, 0.4 * f / 8, 0.4 * f * 4);
		expect(Math.abs(slopes[name] - (2 * H + 1)), `${name}: slope ${slopes[name].toFixed(2)} against 2H+1 ${(2 * H + 1).toFixed(2)}`).toBeLessThan(0.35);
	}
	expect(slopes.lazy).toBeGreaterThan(slopes.gusty);
	expect(slopes.gusty).toBeGreaterThan(slopes.choppy);
	const a = leaf(1.0, 0.34), b = leaf(1.3, 0.34), ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
	let c = 0;
	for (let i = 0; i < n; i++) c += (a[i] - ma) * (b[i] - mb);
	expect(Math.abs(c / n / (sd(a) * sd(b))), "two leaves a little apart in phase").toBeLessThan(0.15);
});
test("flutter_gust 0 is the flutter's size as it was, to the bit", () => {
	for (const wm of [0, 1e-9, 0.37, 1.2]) for (const k of [0, undefined, -0.3]) expect(Object.is(flutterGust(wm, 0.9, k), wm)).toBe(true);
	expect(flutterGust(0.4, 1.0, 1)).toBe(1.0);
	expect(flutterGust(0.4, 1.0, 0.5)).toBeCloseTo(0.7, 12);
});
test("the flick: high as a gust rises and as it dies, quiet in a steady push and in calm", () => {
	// a drive that rests at 0.6, rises over 2 s to 1.2, holds 20 s, falls over 2 s back to 0.6 and holds, at 60 Hz
	const dt = 1 / 60, drive = (t) => (t < 20 ? 0.6 : t < 22 ? 0.6 + 0.3 * (t - 20) : t < 42 ? 1.2 : t < 44 ? 1.2 - 0.3 * (t - 42) : 0.6);
	let mean = drive(0);
	const at = {};
	for (let i = 0; i <= 70 * 60; i++) {
		const t = i * dt, d = drive(t);
		mean = flickMeanStep(mean, d, dt);
		for (const s of [19, 22, 40, 44, 69]) if (Math.abs(t - s) < dt / 2) at[s] = flickLevel(d, mean);
	}
	expect(at[19]).toBe(0);                                   // a steady push: the leaves only flag
	expect(at[22]).toBeGreaterThan(0.25 * FLICK.gain);       // the gust coming up
	expect(at[40]).toBeLessThan(0.01 * FLICK.gain);          // the gust held: the branches lean, the leaves settle
	expect(at[44]).toBeGreaterThan(0.25 * FLICK.gain);       // the gust dying away
	expect(at[69]).toBeLessThan(1e-3);                        // after it, quiet again
	// it never goes past the cap, however hard the step
	let m = 0;
	for (let i = 0; i < 600; i++) { m = flickMeanStep(m, 10, dt); expect(flickLevel(10, m)).toBeLessThanOrEqual(FLICK.cap); }
});
