// Tests for test-gl/pattern-lib.mjs: the floor pattern's spatio-temporal features (after Zhang & Andersen). Run:
// `nix run .#test -- test/pattern.test.js`. Each feature is held to a synthetic input whose answer is known in closed form:
// random points have NNI 1, a square lattice 2, a tight cluster far below 1; a translation has one direction and a known
// speed; noise of spectral slope α gives back α; an alternating series has negative lag-1 correlation.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	decorrelation,
	fft,
	findPatches,
	flowPairSummary,
	flowSummary,
	hornSchunck,
	lag1,
	moransI,
	mrd,
	nni,
	rng,
	scramble,
	spectralBeta,
	temporalAlpha,
	trackPatches,
} from "../test-gl/pattern-lib.mjs";

const W = 400,
	H = 300;

test.skipIf(spawnSync("ffmpeg", ["-version"]).status !== 0)(
	"the pattern CLI measures the filtered clock and every consecutive pair at stride one",
	() => {
		const dir = mkdtempSync(join(tmpdir(), "komorebi-pattern-"));
		try {
			const clip = join(dir, "motion.y4m");
			const encoded = spawnSync(
				"ffmpeg",
				[
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"testsrc2=size=48x32:rate=60",
					"-t",
					"2",
					"-f",
					"yuv4mpegpipe",
					clip,
				],
				{ encoding: "utf8" },
			);
			expect(encoded.status, encoded.stderr).toBe(0);
			const measured = spawnSync(
				process.execPath,
				[
					"test-gl/pattern.mjs",
					clip,
					"--vf",
					"fps=5",
					"--flow-hz",
					"100",
					"--short",
					"32",
					"--flow-width",
					"24",
				],
				{ encoding: "utf8" },
			);
			expect(measured.status, measured.stderr).toBe(0);
			const json = JSON.parse(measured.stdout);
			expect([json.fps, json.frames, json.seconds]).toEqual([5, 10, 2]);
			expect(json.settings.flowHz).toBe(5);
			expect(json.temporal.flowPairs).toBe(9);
			expect(json.temporal.speed).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

test("NNI: random points about 1, a lattice 2, a cluster well below 1", () => {
	const r = rng(7);
	const rand = Array.from({ length: 2000 }, () => ({ x: r() * W, y: r() * H }));
	expect(nni(rand, W, H)).toBeGreaterThan(0.95);
	expect(nni(rand, W, H)).toBeLessThan(1.1); // no edge correction (as Zhang): edges push it slightly above 1
	const lat = [];
	for (let y = 5; y < H; y += 10)
		for (let x = 5; x < W; x += 10) lat.push({ x, y });
	expect(nni(lat, W, H)).toBeCloseTo(2, 1); // spacing d, density 1/d², expected 0.5·d → ratio 2
	const clu = Array.from({ length: 200 }, () => ({
		x: 200 + r() * 10,
		y: 150 + r() * 10,
	}));
	expect(nni(clu, W, H)).toBeLessThan(0.2);
});

test("MRD: everything at the centre is 0, all at the corners is 1", () => {
	expect(mrd([{ x: W / 2, y: H / 2 }], W, H)).toBe(0);
	const corners = [
		{ x: 0, y: 0 },
		{ x: W, y: 0 },
		{ x: 0, y: H },
		{ x: W, y: H },
	];
	expect(mrd(corners, W, H)).toBeCloseTo(1, 12);
});

test("Moran's I: neighbours alike positive, alternating negative, random near its expectation", () => {
	const pts = [];
	for (let y = 5; y < H; y += 20)
		for (let x = 5; x < W; x += 20) pts.push({ x, y });
	const smooth = pts.map((p) => ({ ...p, v: p.x / W })); // a gradient: like near like
	const checker = pts.map((p) => ({
		...p,
		v: ((p.x - 5) / 20 + (p.y - 5) / 20) % 2,
	}));
	const r = rng(3);
	const noise = pts.map((p) => ({ ...p, v: r() }));
	expect(moransI(smooth, W, H)).toBeGreaterThan(0.05);
	expect(moransI(checker, W, H)).toBeLessThan(0);
	expect(Math.abs(moransI(noise, W, H) - -1 / (pts.length - 1))).toBeLessThan(
		0.02,
	);
});

test("patches: blobs are found where they were put", () => {
	const img = new Float32Array(W * H);
	const centres = [
		[60, 50],
		[200, 150],
		[330, 240],
		[120, 230],
	];
	for (const [cx, cy] of centres)
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++)
				img[y * W + x] += Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 36));
	const p = findPatches(
		{ w: W, h: H, data: img },
		{ sigma: 2, k: 1, minSep: 10 },
	);
	expect(p.length).toBe(4);
	for (const [cx, cy] of centres)
		expect(p.some((q) => Math.hypot(q.x - cx, q.y - cy) < 1.5)).toBe(true);
});

test("patches: flat ground with encoder noise has none; dapples in a shadow are found, not the lit ground around it", () => {
	const r = rng(9);
	const flat = Float32Array.from(
		{ length: W * H },
		() => 0.8 + (r() - 0.5) * 0.01,
	);
	expect(findPatches({ w: W, h: H, data: flat }).length).toBe(0);
	// a lit floor (0.8) with one shadow (0.2) in the middle holding three dapples
	const img = Float32Array.from(
		{ length: W * H },
		() => 0.8 + (r() - 0.5) * 0.01,
	);
	const dapples = [
		[170, 130],
		[220, 160],
		[190, 180],
	];
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (Math.hypot(x - 200, y - 150) < 60) img[y * W + x] = 0.2;
			for (const [cx, cy] of dapples)
				img[y * W + x] +=
					0.5 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 16));
		}
	const p = findPatches({ w: W, h: H, data: img });
	expect(p.length).toBe(3);
	for (const [cx, cy] of dapples)
		expect(p.some((q) => Math.hypot(q.x - cx, q.y - cy) < 1.5)).toBe(true);
});

// a 2D field with amplitude spectrum f^-beta: every frequency filled, random phase, transformed back
function field(n, beta, seed) {
	const r = rng(seed),
		re = new Float64Array(n * n),
		im = new Float64Array(n * n);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			const fx = x <= n / 2 ? x : x - n,
				fy = y <= n / 2 ? y : y - n,
				f = Math.hypot(fx, fy);
			if (!f) continue;
			const a = Math.pow(f, -beta),
				ph = r() * 2 * Math.PI;
			re[y * n + x] = a * Math.cos(ph);
			im[y * n + x] = a * Math.sin(ph);
		}
	const rr = new Float64Array(n),
		ri = new Float64Array(n);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			rr[x] = re[y * n + x];
			ri[x] = im[y * n + x];
		}
		fft(rr, ri);
		for (let x = 0; x < n; x++) {
			re[y * n + x] = rr[x];
			im[y * n + x] = ri[x];
		}
	}
	for (let x = 0; x < n; x++) {
		for (let y = 0; y < n; y++) {
			rr[y] = re[y * n + x];
			ri[y] = im[y * n + x];
		}
		fft(rr, ri);
		for (let y = 0; y < n; y++) re[y * n + x] = rr[y];
	}
	return { w: n, h: n, data: Float32Array.from(re) };
}

test("β: a field built with amplitude f^-1 reads about 1, f^-2 about 2", () => {
	expect(spectralBeta(field(128, 1, 11))).toBeCloseTo(1, 0);
	expect(spectralBeta(field(128, 2, 12))).toBeCloseTo(2, 0);
});

// a series with power spectrum f^-alpha
function series(n, alpha, seed) {
	const r = rng(seed),
		s = new Float64Array(n);
	for (let k = 1; k < n / 2; k++) {
		const a = Math.pow(k, -alpha / 2),
			ph = r() * 2 * Math.PI;
		for (let t = 0; t < n; t++)
			s[t] += a * Math.cos((2 * Math.PI * k * t) / n + ph);
	}
	return s;
}

test("α: series built with power f^-1 and f^-2.5 read back within 0.25", () => {
	expect(Math.abs(temporalAlpha(series(2048, 1, 5), 24) - 1)).toBeLessThan(
		0.25,
	);
	expect(Math.abs(temporalAlpha(series(2048, 2.5, 6), 24) - 2.5)).toBeLessThan(
		0.25,
	);
});

test("flow: a pattern sliding right reads rightward at its speed; direction consistency 1", () => {
	const n = 64,
		sx = 0.4;
	const make = (dx) => {
		const d = new Float32Array(n * n);
		for (let y = 0; y < n; y++)
			for (let x = 0; x < n; x++)
				d[y * n + x] =
					Math.sin((2 * Math.PI * (x - dx)) / 16) +
					Math.cos((2 * Math.PI * y) / 21);
		return { w: n, h: n, data: d };
	};
	const { u, v } = hornSchunck(make(0), make(sx), { alpha: 0.5, iters: 200 });
	let su = 0,
		sv = 0,
		c = 0;
	for (let y = 8; y < n - 8; y++)
		for (let x = 8; x < n - 8; x++) {
			su += u[y * n + x];
			sv += v[y * n + x];
			c++;
		}
	expect(su / c).toBeCloseTo(sx, 1);
	expect(Math.abs(sv / c)).toBeLessThan(0.05);
	const frames = [0, 1, 2, 3, 4].map(() => ({ u, v, w: n, h: n }));
	expect(
		flowSummary(frames.map(flowPairSummary)).directionConsistency,
	).toBeCloseTo(1, 6);
});

test("rhythm: smooth series near +1, alternating near -1", () => {
	const smooth = Array.from({ length: 200 }, (_, t) => Math.sin(t / 15));
	const alt = Array.from({ length: 200 }, (_, t) => (t % 2 ? 1 : -1));
	expect(lag1(smooth)).toBeGreaterThan(0.95);
	expect(lag1(alt)).toBeLessThan(-0.95);
});

test("flow: a still pair has zero speed and no direction", () => {
	const flat = { u: new Float32Array(4), v: new Float32Array(4) };
	const still = flowPairSummary(flat);
	const rest = flowSummary([still]);
	expect(rest.meanSpeed).toBe(0);
	expect(rest.directionConsistency).toBeNull();
	const moving = { u: Float32Array.of(1, 1, 1, 1), v: flat.v };
	expect(
		flowSummary([still, flowPairSummary(moving)]).directionConsistency,
	).toBeCloseTo(1, 12);
});

test("a flat clip has no spatial correlation or scramble to measure", () => {
	const frames = Array.from({ length: 24 }, () =>
		Float32Array.of(0.5, 0.5, 0.5, 0.5),
	);
	expect(decorrelation(frames, 4, [1, 4, 8])).toEqual({
		curve: [],
		tau: null,
		plateau: null,
	});
	const result = scramble(frames, 4);
	expect(result.mean).toBeNull();
	expect(result.episodes).toBeNull();
});

// impermanence: how fast the whole pattern forgets itself, and how long each dapple lives
test("decorrelation: a frozen pattern never forgets; an AR(1) pattern forgets as ρ^k, its 1/e time -1/ln ρ steps", () => {
	const r = rng(21),
		n = 32 * 32,
		noise = () => Float32Array.from({ length: n }, () => r() - 0.5);
	const still = Array.from({ length: 40 }, () => noise()).map(
		(_, __, a) => a[0],
	);
	const s = decorrelation(still, 4, [1, 4, 16]);
	expect(s.curve.every((c) => Math.abs(c.r - 1) < 1e-9)).toBe(true);
	expect(s.tau).toBeNull();
	const rho = 0.8,
		ar = [noise()];
	for (let t = 1; t < 4000; t++) {
		const e = noise(),
			f = new Float32Array(n);
		for (let i = 0; i < n; i++)
			f[i] = rho * ar[t - 1][i] + Math.sqrt(1 - rho * rho) * e[i];
		ar.push(f);
	}
	const d = decorrelation(ar, 4, [1, 2, 4, 8]);
	for (const c of d.curve) expect(c.r).toBeCloseTo(rho ** c.lag, 1);
	expect(d.tau).toBeCloseTo(-1 / Math.log(rho) / 4, 1); // in seconds at 4 frames a second
});

test("tracks: lifetimes, births and deaths, and a dapple coming back where it was", () => {
	// frame lists at 2 Hz: A lives frames 0..9 (whole clip, censored); B is born at 2, dies after 5 (4 frames);
	// C lives 1..2, is gone at 3..4, comes back at 5 in the same place and lives to 6
	const A = { x: 10, y: 10 },
		B = { x: 50, y: 20 },
		C = { x: 80, y: 60 };
	const seq = Array.from({ length: 10 }, (_, t) => {
		const f = [A];
		if (t >= 2 && t <= 5) f.push(B);
		if ((t >= 1 && t <= 2) || (t >= 5 && t <= 6))
			f.push({ ...C, x: C.x + (t % 2) });
		return f;
	});
	const tr = trackPatches(seq, 2, {
		maxDist: 3,
		returnDist: 4,
		returnWithin: 2,
	});
	expect(tr.tracks).toBe(4);
	expect(tr.censored).toBe(1);
	expect(tr.lifetimes.sort((p, q) => p - q)).toEqual([1, 1, 2]); // seconds: C twice (2 frames each), B (4 frames)
	expect(tr.returns).toBe(1);
	expect(tr.returnShare).toBeCloseTo(1 / 3, 9); // of the complete tracks' births, one is a return
	// lifetime as seen: a patch looked at at a random moment belongs to a long track more often than to a short one
	expect(tr.seenLife).toBeCloseTo((1 + 1 + 4) / (1 + 1 + 2), 9);
});

test("tracks: a patch the detector misses for one frame is still one patch", () => {
	const P = { x: 30, y: 30 };
	const seq = Array.from({ length: 12 }, (_, t) =>
		t >= 2 && t <= 9 && t !== 5 ? [P] : [],
	);
	expect(trackPatches(seq, 1, { maxGap: 0 }).tracks).toBe(2);
	const one = trackPatches(seq, 1, { maxGap: 1 });
	expect(one.tracks).toBe(1);
	expect(one.lifetimes).toEqual([8]);
	expect(one.returns).toBe(0);
});

test("return: a pattern scrambled by gusts and settling back is measured by how far and how long it strays from rest", () => {
	const r = rng(33),
		n = 24 * 24,
		rest = Float32Array.from({ length: n }, () => r() - 0.5);
	// 4 fps, 120 s: calm, with three gusts of 5 s that scramble the frame half way, then settle back at once
	const frames = [];
	for (let t = 0; t < 480; t++) {
		const gust = [40, 200, 360].some((g) => t >= g && t < g + 20) ? 0.7 : 0.05;
		frames.push(
			Float32Array.from(rest, (v) => (1 - gust) * v + gust * (r() - 0.5)),
		);
	}
	const s = scramble(frames, 4);
	expect(s.episodes).toBe(3);
	expect(s.perMinute).toBeCloseTo(1.5, 6);
	expect(s.returnSeconds).toBeCloseTo(5, 0);
	expect(s.p90).toBeGreaterThan(s.mean);
	expect(s.sameShapeAfter).toBeGreaterThan(0.99); // settles back into the very shape it left
	// a pattern that does not come back: after each gust it settles into a new arrangement
	const drift = [];
	let cur = rest;
	for (let t = 0; t < 480; t++) {
		const gusting = [40, 200, 360].some((g) => t >= g && t < g + 20);
		if (gusting) cur = Float32Array.from({ length: n }, () => r() - 0.5);
		drift.push(Float32Array.from(cur, (v) => v + 0.02 * (r() - 0.5)));
	}
	expect(scramble(drift, 4).sameShapeAfter).toBeLessThan(0.2);
});
