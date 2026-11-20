// The floor pattern's spatio-temporal features, measured from frames: pure, no browser, no engine import.
// After Zhang & Andersen, "Spatio-temporal dynamics of komorebi light patterns" (CIE 2025), and Zhang, Ren & Andersen,
// "Effects of spatio-temporal features of komorebi dappled light on human responses" (preprint 2026,
// doi:10.21203/rs.3.rs-8959941/v1), which tie these numbers to how calm and natural people found real dappled light.
//
// Spatial, on single frames (luminance in [0,1], row-major):
//   findPatches  the light patches' centres. OURS, not Zhang's: Zhang marked centres by hand because blur defeated his
//                detector; here they are local maxima of a Gaussian-blurred frame above mean + k·σ, thinned to minSep.
//                So the values compare across inputs measured with the same settings, not directly with Zhang's tables.
//   nni          Clark–Evans nearest neighbour index: below 1 clustered, 1 random, above 1 dispersed. No edge correction.
//   mrd          mean distance from the frame centre over the half diagonal (Zhang's eq. 4).
//   moransI      spatial autocorrelation of the patches' brightness, weights 1/(d/diagonal) (Zhang's eq. 2).
//   spectralBeta slope β of the radially averaged amplitude spectrum, A ∝ f^-β.
// Temporal, on a sequence:
//   temporalAlpha slope α of the Welch power spectrum of a brightness series, P ∝ f^-α ("brightness tempo": high is slow).
//   hornSchunck  optical flow between two frames (Horn & Schunck 1981, the method Zhang used).
//   flowSummary  mean speed, direction consistency (1 − circular variance of each interval's dominant direction: 1 steady,
//                0 every way) and the movement series; lag1 its lag-1 autocorrelation ("rhythm": + smooth, 0 random, − alternating).

// A small deterministic generator (mulberry32), for the tests' synthetic inputs.
export function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function gaussBlur({ w, h, data }, sigma) {
	if (!(sigma > 0)) return { w, h, data: Float32Array.from(data) };
	const r = Math.ceil(sigma * 3),
		k = new Float32Array(2 * r + 1);
	let s = 0;
	for (let i = -r; i <= r; i++)
		s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
	for (let i = 0; i < k.length; i++) k[i] /= s;
	const tmp = new Float32Array(w * h),
		out = new Float32Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let a = 0;
			for (let i = -r; i <= r; i++)
				a += k[i + r] * data[y * w + Math.min(w - 1, Math.max(0, x + i))];
			tmp[y * w + x] = a;
		}
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let a = 0;
			for (let i = -r; i <= r; i++)
				a += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
			out[y * w + x] = a;
		}
	return { w, h, data: out };
}

function meanSd(a) {
	let m = 0;
	for (const v of a) m += v;
	m /= a.length;
	let s = 0;
	for (const v of a) s += (v - m) ** 2;
	return [m, Math.sqrt(s / a.length)];
}

export function findPatches(img, { sigma = 2, k = 0.5, minSep = 6 } = {}) {
	const { w, h, data } = gaussBlur(img, sigma);
	const [m, sd] = meanSd(data);
	const thr = m + k * sd,
		cand = [];
	for (let y = 1; y < h - 1; y++)
		for (let x = 1; x < w - 1; x++) {
			const v = data[y * w + x];
			if (v <= thr) continue;
			let peak = true;
			for (let dy = -1; dy <= 1 && peak; dy++)
				for (let dx = -1; dx <= 1; dx++)
					if ((dx || dy) && data[(y + dy) * w + x + dx] > v) {
						peak = false;
						break;
					}
			if (peak) cand.push({ x, y, v: img.data[y * w + x], b: v });
		}
	cand.sort((p, q) => q.b - p.b);
	const kept = [],
		s2 = minSep * minSep;
	for (const p of cand)
		if (kept.every((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 >= s2))
			kept.push(p);
	return kept.map(({ x, y, v }) => ({ x, y, v }));
}

export function nni(pts, w, h) {
	const n = pts.length;
	if (n < 2) return NaN;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		let best = Infinity;
		for (let j = 0; j < n; j++)
			if (i !== j) {
				const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
				if (d < best) best = d;
			}
		sum += Math.sqrt(best);
	}
	return sum / n / (0.5 / Math.sqrt(n / (w * h)));
}

export function mrd(pts, w, h) {
	if (!pts.length) return NaN;
	let s = 0;
	for (const p of pts) s += Math.hypot(p.x - w / 2, p.y - h / 2);
	return s / ((pts.length * Math.hypot(w, h)) / 2);
}

export function moransI(pts, w, h) {
	const n = pts.length;
	if (n < 3) return NaN;
	const diag = Math.hypot(w, h);
	let m = 0;
	for (const p of pts) m += p.v;
	m /= n;
	let num = 0,
		W = 0,
		den = 0;
	for (let i = 0; i < n; i++) {
		den += (pts[i].v - m) ** 2;
		for (let j = 0; j < n; j++)
			if (i !== j) {
				const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / diag;
				const wij = 1 / Math.max(d, 1e-6);
				W += wij;
				num += wij * (pts[i].v - m) * (pts[j].v - m);
			}
	}
	return den > 0 ? (n / W) * (num / den) : NaN;
}

// in-place radix-2 complex FFT
export function fft(re, im) {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const a = (-2 * Math.PI) / len,
			wr = Math.cos(a),
			wi = Math.sin(a);
		for (let i = 0; i < n; i += len) {
			let cr = 1,
				ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const ur = re[i + k],
					ui = im[i + k];
				const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
				const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
				re[i + k] = ur + vr;
				im[i + k] = ui + vi;
				re[i + k + len / 2] = ur - vr;
				im[i + k + len / 2] = ui - vi;
				const t = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = t;
			}
		}
	}
}

// least-squares slope of y on x
function slope(xs, ys) {
	const n = xs.length;
	let mx = 0,
		my = 0;
	for (let i = 0; i < n; i++) {
		mx += xs[i];
		my += ys[i];
	}
	mx /= n;
	my /= n;
	let sxy = 0,
		sxx = 0;
	for (let i = 0; i < n; i++) {
		sxy += (xs[i] - mx) * (ys[i] - my);
		sxx += (xs[i] - mx) ** 2;
	}
	return sxy / sxx;
}

// β over the central power-of-two square, Hann-windowed; fitted from 4 cycles per frame to a quarter of Nyquist, in
// log-spaced bins so the many high-frequency rings do not outvote the few low ones.
export function spectralBeta({ w, h, data }, { fLo = 4, fHiFrac = 0.25 } = {}) {
	let n = 1;
	while (n * 2 <= Math.min(w, h)) n *= 2;
	const x0 = (w - n) >> 1,
		y0 = (h - n) >> 1;
	let m = 0;
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) m += data[(y0 + y) * w + x0 + x];
	m /= n * n;
	const re = new Float64Array(n * n),
		im = new Float64Array(n * n);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			const win =
				(0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (n - 1))) *
				(0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (n - 1)));
			re[y * n + x] = (data[(y0 + y) * w + x0 + x] - m) * win;
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
		for (let y = 0; y < n; y++) {
			re[y * n + x] = rr[y];
			im[y * n + x] = ri[y];
		}
	}
	const fHi = (n / 2) * fHiFrac,
		nb = 16,
		sums = new Float64Array(nb),
		cnt = new Float64Array(nb);
	const lLo = Math.log(fLo),
		lHi = Math.log(fHi);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			const fx = x <= n / 2 ? x : x - n,
				fy = y <= n / 2 ? y : y - n,
				f = Math.hypot(fx, fy);
			if (f < fLo || f > fHi) continue;
			const b = Math.min(
				nb - 1,
				Math.floor(((Math.log(f) - lLo) / (lHi - lLo)) * nb),
			);
			sums[b] += Math.hypot(re[y * n + x], im[y * n + x]);
			cnt[b]++;
		}
	const xs = [],
		ys = [];
	for (let b = 0; b < nb; b++)
		if (cnt[b]) {
			xs.push(lLo + ((b + 0.5) * (lHi - lLo)) / nb);
			ys.push(Math.log(sums[b] / cnt[b]));
		}
	return -slope(xs, ys);
}

// α by Welch (Hann, 50% overlap, segments of the largest power of two ≤ a quarter of the series, at least 64 samples),
// detrended per segment; fitted in log-spaced bins from 2 cycles per segment to min(fs/4, fHiMax) Hz.
export function temporalAlpha(series, fs, { fHiMax = 4 } = {}) {
	const N = series.length;
	let L = 64;
	while (L * 2 <= N / 4) L *= 2;
	if (N < L) return NaN;
	const psd = new Float64Array(L / 2 + 1),
		re = new Float64Array(L),
		im = new Float64Array(L);
	let segs = 0;
	for (let s = 0; s + L <= N; s += L / 2) {
		const xs = [],
			ys = [];
		for (let i = 0; i < L; i++) {
			xs.push(i);
			ys.push(series[s + i]);
		}
		const b = slope(xs, ys);
		let m = 0;
		for (let i = 0; i < L; i++) m += series[s + i] - b * i;
		m /= L;
		for (let i = 0; i < L; i++) {
			re[i] =
				(series[s + i] - b * i - m) *
				(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)));
			im[i] = 0;
		}
		fft(re, im);
		for (let k = 0; k <= L / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
		segs++;
	}
	const df = fs / L,
		fLo = 2 * df,
		fHi = Math.min(fs / 4, fHiMax);
	if (!(fHi > fLo * 1.5)) return NaN;
	const nb = 12,
		sums = new Float64Array(nb),
		cnt = new Float64Array(nb),
		lLo = Math.log(fLo),
		lHi = Math.log(fHi);
	for (let k = 1; k <= L / 2; k++) {
		const f = k * df;
		if (f < fLo || f > fHi) continue;
		const bi = Math.min(
			nb - 1,
			Math.floor(((Math.log(f) - lLo) / (lHi - lLo)) * nb),
		);
		sums[bi] += psd[k] / segs;
		cnt[bi]++;
	}
	const xs = [],
		ys = [];
	for (let b = 0; b < nb; b++)
		if (cnt[b]) {
			xs.push(lLo + ((b + 0.5) * (lHi - lLo)) / nb);
			ys.push(Math.log(sums[b] / cnt[b]));
		}
	return xs.length >= 3 ? -slope(xs, ys) : NaN;
}

// Horn–Schunck on two frames of the same size: u, v in pixels per frame.
export function hornSchunck(a, b, { alpha = 1, iters = 80 } = {}) {
	const { w, h } = a,
		A = a.data,
		B = b.data,
		n = w * h;
	const Ix = new Float32Array(n),
		Iy = new Float32Array(n),
		It = new Float32Array(n);
	const at = (D, x, y) =>
		D[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = y * w + x;
			Ix[i] =
				0.25 *
				(at(A, x + 1, y) -
					at(A, x, y) +
					at(A, x + 1, y + 1) -
					at(A, x, y + 1) +
					at(B, x + 1, y) -
					at(B, x, y) +
					at(B, x + 1, y + 1) -
					at(B, x, y + 1));
			Iy[i] =
				0.25 *
				(at(A, x, y + 1) -
					at(A, x, y) +
					at(A, x + 1, y + 1) -
					at(A, x + 1, y) +
					at(B, x, y + 1) -
					at(B, x, y) +
					at(B, x + 1, y + 1) -
					at(B, x + 1, y));
			It[i] =
				0.25 *
				(at(B, x, y) -
					at(A, x, y) +
					at(B, x + 1, y) -
					at(A, x + 1, y) +
					at(B, x, y + 1) -
					at(A, x, y + 1) +
					at(B, x + 1, y + 1) -
					at(A, x + 1, y + 1));
		}
	let u = new Float32Array(n),
		v = new Float32Array(n),
		u2 = new Float32Array(n),
		v2 = new Float32Array(n);
	const a2 = alpha * alpha;
	for (let k = 0; k < iters; k++) {
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const i = y * w + x;
				const ub =
					(at(u, x - 1, y) +
						at(u, x + 1, y) +
						at(u, x, y - 1) +
						at(u, x, y + 1)) /
						6 +
					(at(u, x - 1, y - 1) +
						at(u, x + 1, y - 1) +
						at(u, x - 1, y + 1) +
						at(u, x + 1, y + 1)) /
						12;
				const vb =
					(at(v, x - 1, y) +
						at(v, x + 1, y) +
						at(v, x, y - 1) +
						at(v, x, y + 1)) /
						6 +
					(at(v, x - 1, y - 1) +
						at(v, x + 1, y - 1) +
						at(v, x - 1, y + 1) +
						at(v, x + 1, y + 1)) /
						12;
				const t =
					(Ix[i] * ub + Iy[i] * vb + It[i]) /
					(a2 + Ix[i] * Ix[i] + Iy[i] * Iy[i]);
				u2[i] = ub - Ix[i] * t;
				v2[i] = vb - Iy[i] * t;
			}
		[u, u2] = [u2, u];
		[v, v2] = [v2, v];
	}
	return { u, v, w, h };
}

// Per interval: mean speed and the dominant direction (the mode of a 36-bin, speed-weighted histogram of flow angles).
// Over the sequence: mean speed, direction consistency R = |mean of e^{iθ_t}| (1 − Zhang's circular variance), the
// movement series.
export function flowSummary(flows) {
	const movement = [],
		thetas = [];
	for (const { u, v } of flows) {
		const hist = new Float64Array(36);
		let s = 0;
		for (let i = 0; i < u.length; i++) {
			const m = Math.hypot(u[i], v[i]);
			s += m;
			if (m > 0)
				hist[
					Math.min(
						35,
						Math.floor(
							((Math.atan2(v[i], u[i]) + Math.PI) / (2 * Math.PI)) * 36,
						),
					)
				] += m;
		}
		movement.push(s / u.length);
		let best = 0;
		for (let b = 1; b < 36; b++) if (hist[b] > hist[best]) best = b;
		thetas.push(-Math.PI + (best + 0.5) * ((2 * Math.PI) / 36));
	}
	let c = 0,
		sn = 0;
	for (const t of thetas) {
		c += Math.cos(t);
		sn += Math.sin(t);
	}
	const R = thetas.length ? Math.hypot(c, sn) / thetas.length : NaN;
	const meanSpeed =
		movement.reduce((a, b) => a + b, 0) / Math.max(1, movement.length);
	return { meanSpeed, directionConsistency: R, movement, thetas };
}

export function lag1(s) {
	const n = s.length;
	if (n < 3) return NaN;
	let m = 0;
	for (const v of s) m += v;
	m /= n;
	let num = 0,
		den = 0;
	for (let i = 0; i < n; i++) {
		den += (s[i] - m) ** 2;
		if (i) num += (s[i] - m) * (s[i - 1] - m);
	}
	return den > 0 ? num / den : NaN;
}
