// Tests for test-gl/pattern-lib.mjs: the floor pattern's spatio-temporal features (after Zhang & Andersen). Run:
// `nix run .#test -- test/pattern.test.js`. Each feature is held to a synthetic input whose answer is known in closed form:
// random points have NNI 1, a square lattice 2, a tight cluster far below 1; a translation has one direction and a known
// speed; noise of spectral slope α gives back α; an alternating series has negative lag-1 correlation.
import { expect, test } from "bun:test";
import {
	fft,
	findPatches,
	flowSummary,
	hornSchunck,
	lag1,
	moransI,
	mrd,
	nni,
	rng,
	spectralBeta,
	temporalAlpha,
} from "../test-gl/pattern-lib.mjs";

const W = 400,
	H = 300;

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
	expect(flowSummary(frames).directionConsistency).toBeCloseTo(1, 6);
});

test("rhythm: smooth series near +1, alternating near -1", () => {
	const smooth = Array.from({ length: 200 }, (_, t) => Math.sin(t / 15));
	const alt = Array.from({ length: 200 }, (_, t) => (t % 2 ? 1 : -1));
	expect(lag1(smooth)).toBeGreaterThan(0.95);
	expect(lag1(alt)).toBeLessThan(-0.95);
});
