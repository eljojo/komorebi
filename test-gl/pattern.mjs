// `nix run .#pattern -- <video>... [options]`: a dappled-light video's spatio-temporal features, as JSON on stdout (and
// --out <file>). The features and their sources are in pattern-lib.mjs's header. Works on a phone recording of real dapples
// and on a komorebi render alike, so the two can be compared with the same settings.
//   --vf <filters>     ffmpeg filters applied first, in source pixels (e.g. "deshake,crop=1600:900:200:100" for a handheld clip)
//   --ss <s> --t <s>   trim: start and duration in seconds
//   --short <px>       short side the frames are scaled to for patches and spectra (default 360)
//   --flow-width <px>  width of the frames the optical flow runs on (default 160)
//   --flow-hz <hz>     how many frame pairs per second the flow is computed for (default 12; each pair is consecutive frames)
//   --patch-hz <hz>    how many frames per second get patch statistics and β (default 1)
//   --sigma, --k, --min-sep, --bg, --min-contrast   the patch detector (pattern-lib findPatches), in --short pixels
//                      and luminance (defaults 2, 0.5, 6, 4, 0.02)
//   --tiles <n>        α is also measured on an n×n grid of tiles and their median reported (default 4)
//   --imp-hz <hz>      frames a second for the impermanence measures (default 4): the decorrelation curve and the
//                      scramble/return on --imp-width px frames (default 80), and each patch tracked through time
// Luminance is the decoded grey (ffmpeg `gray`, gamma-encoded as stored): what the eye sees on the screen, as in Zhang.
// Sampling uses the filtered output's constant frame rate.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
	decorrelation,
	findPatches,
	flowPairSummary,
	flowSummary,
	gaussBlur,
	hornSchunck,
	lag1,
	moransI,
	mrd,
	nni,
	scramble,
	spectralBeta,
	temporalAlpha,
	trackPatches,
} from "./pattern-lib.mjs";

function parse(argv) {
	const o = {
		inputs: [],
		vf: "",
		ss: null,
		t: null,
		short: 360,
		flowWidth: 160,
		flowHz: 12,
		patchHz: 1,
		sigma: 2,
		k: 0.5,
		minSep: 6,
		bg: 4,
		minContrast: 0.02,
		tiles: 4,
		impHz: 4,
		impWidth: 80,
		out: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i],
			v = () => argv[++i];
		if (a === "--vf") o.vf = v();
		else if (a === "--ss") o.ss = +v();
		else if (a === "--t") o.t = +v();
		else if (a === "--short") o.short = +v();
		else if (a === "--flow-width") o.flowWidth = +v();
		else if (a === "--flow-hz") o.flowHz = +v();
		else if (a === "--patch-hz") o.patchHz = +v();
		else if (a === "--sigma") o.sigma = +v();
		else if (a === "--k") o.k = +v();
		else if (a === "--min-sep") o.minSep = +v();
		else if (a === "--bg") o.bg = +v();
		else if (a === "--min-contrast") o.minContrast = +v();
		else if (a === "--tiles") o.tiles = +v();
		else if (a === "--imp-hz") o.impHz = +v();
		else if (a === "--imp-width") o.impWidth = +v();
		else if (a === "--out") o.out = v();
		else if (a === "--help" || a === "-h") {
			console.log(readHelp());
			process.exit(0);
		} else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
		else o.inputs.push(a);
	}
	if (!o.inputs.length) throw new Error("no input video (see --help)");
	return o;
}

function readHelp() {
	const lines = readFileSync(new URL(import.meta.url), "utf8").split("\n");
	const head = lines.slice(
		0,
		lines.findIndex((l) => !l.startsWith("//")),
	);
	return head.map((l) => l.replace(/^\/\/ ?/, "")).join("\n");
}

// YUV4MPEG carries dimensions and the clock of the filtered frames in the same stream as their grey bytes.
async function* grayFrames(stream) {
	let buf = Buffer.alloc(0),
		frameBytes = 0;
	for await (const chunk of stream) {
		buf = Buffer.concat([buf, chunk]);
		if (!frameBytes) {
			const end = buf.indexOf(10);
			if (end < 0) continue;
			const header = buf.subarray(0, end).toString("ascii");
			const w = Number(header.match(/ W(\d+) /)?.[1]);
			const h = Number(header.match(/ H(\d+) /)?.[1]);
			const [, n, d] = header.match(/ F(\d+):(\d+) /) ?? [];
			const fps = Number(n) / Number(d);
			if (
				!header.startsWith("YUV4MPEG2 ") ||
				!/ Cmono(?: |$)/.test(header) ||
				!(w > 0 && h > 0 && fps > 0 && Number.isFinite(fps))
			) {
				throw new Error(`Invalid grey video header: ${header}`);
			}
			frameBytes = w * h;
			buf = buf.subarray(end + 1);
			yield { w, h, fps };
		}
		while (buf.length > frameBytes) {
			const end = buf.indexOf(10);
			if (end < 0 || buf.length < end + 1 + frameBytes) break;
			const marker = buf.subarray(0, end).toString("ascii");
			if (marker !== "FRAME" && !marker.startsWith("FRAME "))
				throw new Error("Invalid video frame header");
			yield buf.subarray(end + 1, end + 1 + frameBytes);
			buf = buf.subarray(end + 1 + frameBytes);
		}
	}
	if (buf.length) throw new Error("Truncated grey video stream");
}

function downsample({ w, h, data }, W) {
	const s = w / W,
		H = Math.max(1, Math.round(h / s)),
		out = new Float32Array(W * H);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			let a = 0,
				c = 0;
			for (
				let yy = Math.floor(y * s);
				yy < Math.min(h, Math.floor((y + 1) * s));
				yy++
			)
				for (
					let xx = Math.floor(x * s);
					xx < Math.min(w, Math.floor((x + 1) * s));
					xx++
				) {
					a += data[yy * w + xx];
					c++;
				}
			out[y * W + x] = c ? a / c : 0;
		}
	return { w: W, h: H, data: out };
}

const stat = (a) => {
	const f = a.filter(Number.isFinite);
	if (!f.length) return { mean: null, sd: null, n: 0 };
	const m = f.reduce((s, v) => s + v, 0) / f.length;
	return {
		mean: m,
		sd: Math.sqrt(f.reduce((s, v) => s + (v - m) ** 2, 0) / f.length),
		n: f.length,
	};
};
const median = (a) => {
	const f = a.filter(Number.isFinite).sort((p, q) => p - q);
	return f.length ? f[f.length >> 1] : null;
};

async function measure(input, o) {
	const vf = [
		o.vf,
		`scale='if(lt(iw,ih),${o.short},-2)':'if(lt(iw,ih),-2,${o.short})'`,
		"format=gray",
	]
		.filter(Boolean)
		.join(",");
	const args = [
		"-v",
		"error",
		...(o.ss != null ? ["-ss", String(o.ss)] : []),
		"-i",
		input,
		"-map",
		"0:v:0",
		...(o.t != null ? ["-t", String(o.t)] : []),
		"-vf",
		vf,
		"-fps_mode",
		"cfr",
		"-f",
		"yuv4mpegpipe",
		"-",
	];
	const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
	const closed = new Promise((resolve) => {
		ff.once("close", resolve);
		ff.once("error", resolve);
	});
	const frames = grayFrames(ff.stdout);
	const { value: header } = await frames.next();
	if (!header) {
		const code = await closed;
		if (code instanceof Error) throw code;
		throw new Error(`No video frames from ffmpeg (exit ${code}) on ${input}`);
	}
	const { w, h, fps } = header;
	const frameBytes = w * h,
		flowEvery = Math.max(1, Math.round(fps / o.flowHz)),
		patchEvery = Math.max(1, Math.round(fps / o.patchHz)),
		impEvery = Math.max(1, Math.round(fps / o.impHz));
	const mean = [],
		tiles = Array.from({ length: o.tiles * o.tiles }, () => []),
		flowPairs = [],
		spatial = { nni: [], mrd: [], moran: [], beta: [], patches: [] },
		impFrames = [],
		impPatches = [];
	let idx = 0,
		fh = 0,
		prevFlow = null;
	const fw = Math.min(o.flowWidth, w);
	for await (const raw of frames) {
		const data = new Float32Array(frameBytes);
		let s = 0;
		for (let i = 0; i < frameBytes; i++) s += data[i] = raw[i] / 255;
		mean.push(s / frameBytes);
		for (let ty = 0; ty < o.tiles; ty++)
			for (let tx = 0; tx < o.tiles; tx++) {
				let a = 0,
					c = 0;
				for (
					let y = Math.floor((ty * h) / o.tiles);
					y < Math.floor(((ty + 1) * h) / o.tiles);
					y++
				)
					for (
						let x = Math.floor((tx * w) / o.tiles);
						x < Math.floor(((tx + 1) * w) / o.tiles);
						x++
					) {
						a += data[y * w + x];
						c++;
					}
				tiles[ty * o.tiles + tx].push(a / c);
			}
		const frame = { w, h, data };
		const patchesNow = () =>
			findPatches(frame, {
				sigma: o.sigma,
				k: o.k,
				minSep: o.minSep,
				bg: o.bg,
				minContrast: o.minContrast,
			});
		let p = null;
		if (idx % impEvery === 0) {
			impFrames.push(
				gaussBlur(downsample(frame, Math.min(o.impWidth, w)), 1).data,
			);
			p = patchesNow();
			impPatches.push(p);
		}
		if (idx % patchEvery === 0) {
			p ??= patchesNow();
			spatial.patches.push(p.length);
			spatial.nni.push(nni(p, w, h));
			spatial.mrd.push(mrd(p, w, h));
			spatial.moran.push(moransI(p, w, h));
			spatial.beta.push(spectralBeta(frame));
		}
		// flow on consecutive frames (idx-1, idx) whenever idx-1 is on the flow grid
		const startsPair = idx % flowEvery === 0;
		const small =
			startsPair || prevFlow ? gaussBlur(downsample(frame, fw), 1) : null;
		if (prevFlow) {
			flowPairs.push(
				flowPairSummary(hornSchunck(prevFlow, small, { alpha: 1, iters: 60 })),
			);
			fh = small.h;
		}
		prevFlow = startsPair ? small : null;
		idx++;
	}
	const code = await closed;
	if (code instanceof Error) throw code;
	if (code !== 0) throw new Error(`ffmpeg exited ${code} on ${input}`);
	if (!idx) throw new Error(`No video frames from ffmpeg on ${input}`);
	const fl = flowSummary(flowPairs);
	const tileAlpha = tiles.map((s) => temporalAlpha(s, fps));
	const impFs = fps / impEvery,
		lags = [1, 2, 4, 8, 16, 32, 64, 128, 256].filter(
			(l) => l < impFrames.length / 2,
		),
		dec = decorrelation(impFrames, impFs, lags),
		scr = scramble(impFrames, impFs),
		tr = trackPatches(impPatches, impFs, {
			maxDist: o.minSep / 2,
			returnDist: o.minSep / 2,
			returnWithin: 2,
		});
	return {
		input,
		fps,
		frames: idx,
		seconds: idx / fps,
		size: [w, h],
		settings: {
			vf: o.vf || null,
			ss: o.ss,
			t: o.t,
			short: o.short,
			flowWidth: fw,
			flowHz: fps / flowEvery,
			patchHz: fps / patchEvery,
			sigma: o.sigma,
			k: o.k,
			minSep: o.minSep,
			bg: o.bg,
			minContrast: o.minContrast,
			tiles: o.tiles,
			impHz: impFs,
			impWidth: Math.min(o.impWidth, w),
		},
		spatial: {
			nni: stat(spatial.nni),
			mrd: stat(spatial.mrd),
			moransI: stat(spatial.moran),
			beta: stat(spatial.beta),
			patches: stat(spatial.patches),
		},
		temporal: {
			alpha: temporalAlpha(mean, fps),
			alphaTilesMedian: median(tileAlpha),
			alphaTiles: tileAlpha,
			// speed in frame diagonals per second; direction consistency 1 = one steady direction, 0 = every way
			speed:
				fl.meanSpeed === null
					? null
					: (fl.meanSpeed * fps) / Math.hypot(fw, fh),
			directionConsistency: fl.directionConsistency,
			rhythm: lag1(fl.movement),
			flowPairs: flowPairs.length,
			brightness: stat(mean),
		},
		// the pattern scrambled by the wind and settling back: not in Zhang
		impermanence: {
			decorrelation: dec.curve,
			tau: dec.tau,
			plateau: dec.plateau,
			scramble: {
				mean: scr.mean,
				median: scr.median,
				p90: scr.p90,
				episodes: scr.episodes,
				perMinute: scr.perMinute,
				returnSeconds: scr.returnSeconds,
				sameShapeAfter: scr.sameShapeAfter,
			},
			tracks: {
				tracks: tr.tracks,
				censored: tr.censored,
				lifetime: stat(tr.lifetimes),
				lifetimeMedian: median(tr.lifetimes),
				seenLife: tr.seenLife,
				birthsPerSecond: tr.birthsPerSecond,
				returns: tr.returns,
				returnShare: tr.returnShare,
			},
		},
	};
}

const o = parse(process.argv.slice(2));
const results = [];
for (const input of o.inputs) {
	const r = await measure(input, o);
	results.push(r);
	console.error(
		`${input}: NNI ${r.spatial.nni.mean?.toFixed(3)}  MRD ${r.spatial.mrd.mean?.toFixed(3)}  I ${r.spatial.moransI.mean?.toFixed(3)}  β ${r.spatial.beta.mean?.toFixed(2)}  α ${r.temporal.alpha?.toFixed(2)} (tiles ${r.temporal.alphaTilesMedian?.toFixed(2)})  Dθ ${r.temporal.directionConsistency?.toFixed(2)}  ρ1 ${r.temporal.rhythm?.toFixed(2)}  speed ${r.temporal.speed?.toFixed(4)}  τ ${r.impermanence.tau?.toFixed(2)} s  plateau ${r.impermanence.plateau?.toFixed(2)}  scramble ${r.impermanence.scramble.mean?.toFixed(3)} (${r.impermanence.scramble.perMinute?.toFixed(1)}/min, back in ${r.impermanence.scramble.returnSeconds?.toFixed(1)} s, same ${r.impermanence.scramble.sameShapeAfter?.toFixed(2)})  life ${r.impermanence.tracks.lifetimeMedian?.toFixed(2)} s (seen ${r.impermanence.tracks.seenLife?.toFixed(2)} s)  returns ${r.impermanence.tracks.returnShare?.toFixed(2)}`,
	);
}
const json = JSON.stringify(
	results.length === 1 ? results[0] : results,
	null,
	2,
);
if (o.out) writeFileSync(o.out, `${json}\n`);
else console.log(json);
