// Tests of the quality study (study.mjs). No GPU render and no browser: the grid, the argv, the parsers, the ffmpeg filter graphs (run for real on
// tiny synthetic clips), the knee, the screen's proposal, the estimate, the sheet plan, and the report over a hand-made run folder.
//   nix shell nixpkgs#nodejs_22 nixpkgs#ffmpeg -c node --test test-gl/study.test.mjs        (ffmpeg on PATH; ImageMagick is not needed: the sheets are skipped without it)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// the module as a namespace: a missing export fails the one test that uses it (TypeError), not the whole file at load
import * as S from './study.mjs';
import { FFMPEG, HERE, REPO, canonicalSha256, concatListText } from './video-lib.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'komorebi-study-test-'));
const ff = (args) => { const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };

// ---------------------------------------------------------------- 1. the variant grid and its dedupe
const AUTH = { tex: 2048, bake: 1024, samples: 32 };   // the engine's DEFAULTS
const ids = (g) => g.map((v) => v.id);

test('the grid is the brief\'s: REF, A, tex x3, bake x5, samples x4, ss 2 on authored, max without ss', () => {
  const g = S.variantGrid(AUTH);
  assert.deepEqual(ids(g), ['ref', 'A', 'tex1024', 'tex2048', 'tex4096', 'bake768', 'bake1024', 'bake1536', 'bake2048', 'bake0', 'smp16', 'smp24', 'smp32', 'smp48', 'ss2', 'maxnoss']);
  const by = Object.fromEntries(g.map((v) => [v.id, v]));
  assert.deepEqual(by.ref.set, { tex_resolution: 4096, bake_resolution: 0, sample_count: 48 });
  assert.equal(by.ref.ss, 2);
  assert.deepEqual(by.A.set, {});
  assert.equal(by.A.ss, 1);
  assert.deepEqual(by.tex4096.set, { tex_resolution: 4096 });
  assert.deepEqual(by.bake0.set, { bake_resolution: 0 });
  assert.deepEqual(by.smp16.set, { sample_count: 16 });
  assert.deepEqual(by.ss2.set, {});
  assert.equal(by.ss2.ss, 2);
  assert.deepEqual(by.maxnoss.set, by.ref.set);
  assert.equal(by.maxnoss.ss, 1);
});

test('a variant equal to authored is dropped from the renders and says which it equals', () => {
  const g = S.variantGrid(AUTH), by = Object.fromEntries(g.map((v) => [v.id, v]));
  assert.equal(by.tex2048.dupe_of, 'A');
  assert.equal(by.bake1024.dupe_of, 'A');
  assert.equal(by.smp32.dupe_of, 'A');
  assert.equal(by.ref.dupe_of, null);
  assert.equal(S.renderableVariants(g).length, 13);
  assert.ok(S.renderableVariants(g).every((v) => !v.dupe_of));
});

test('bake 0 follows tex, so equal EFFECTIVE settings are the same variant (and a tex change drags a following bake with it)', () => {
  const follow = { tex: 2048, bake: 0, samples: 32 };
  const by = Object.fromEntries(S.variantGrid(follow).map((v) => [v.id, v]));
  assert.equal(by.bake0.dupe_of, 'A');
  assert.equal(by.bake2048.dupe_of, 'A', 'bake 2048 under tex 2048 is what bake 0 gives');
  assert.deepEqual(by.tex1024.effective, { tex: 1024, bake: 1024, samples: 32, ss: 1 });
  assert.deepEqual(by.ref.effective, { tex: 4096, bake: 4096, samples: 48, ss: 2 });
});

test('a look authored at the maximum has no "max without ss" of its own; REF stays', () => {
  const by = Object.fromEntries(S.variantGrid({ tex: 4096, bake: 0, samples: 48 }).map((v) => [v.id, v]));
  assert.equal(by.maxnoss.dupe_of, 'A');
  assert.equal(by.tex4096.dupe_of, 'A');
  assert.equal(by.bake0.dupe_of, 'A');
  assert.equal(by.smp48.dupe_of, 'A');
  assert.equal(by.ref.dupe_of, null);
  assert.equal(by.ss2.dupe_of, 'ref', 'authored is already max, so ss 2 on authored IS the reference');
});

test('authoredQuality reads the three knobs from a look over the engine defaults', () => {
  assert.deepEqual(S.authoredQuality({}), AUTH);
  assert.deepEqual(S.authoredQuality({ tex_resolution: 1024, bake_resolution: 0, sample_count: 24 }), { tex: 1024, bake: 0, samples: 24 });
});

// ---------------------------------------------------------------- 2. the render-video argv
test('--set / --ss argv: the quality keys only, in render-video\'s order, --ss only above 1', () => {
  const by = Object.fromEntries(S.variantGrid(AUTH).map((v) => [v.id, v]));
  assert.deepEqual(S.variantArgv(by.A), []);
  assert.deepEqual(S.variantArgv(by.ref), ['--set', 'bake_resolution=0', '--set', 'tex_resolution=4096', '--set', 'sample_count=48', '--ss', '2']);
  assert.deepEqual(S.variantArgv(by.bake1536), ['--set', 'bake_resolution=1536']);
  assert.deepEqual(S.variantArgv(by.ss2), ['--ss', '2']);
  assert.deepEqual(S.variantArgv(by.maxnoss), ['--set', 'bake_resolution=0', '--set', 'tex_resolution=4096', '--set', 'sample_count=48']);
});

test('a variant that sets anything but a quality key is refused', () => {
  assert.throws(() => S.variantArgv({ id: 'x', set: { exposure: 2 }, ss: 1 }), /exposure/);
});

test('the child command is render-video.mjs itself, with no delivery, the same clock for every variant, and the variant\'s overrides last', () => {
  const v = S.variantGrid(AUTH).find((x) => x.id === 'smp24');
  const argv = S.childArgv({ lookFile: '/o/l/look.json', engine: { commit: 'abc1234' }, out: '/o/l/smp24', seconds: 30, size: [1920, 1080], fps: 60, preroll: 30, chrome: 'shell+angle-metal', variant: v });
  assert.equal(argv[0], join(HERE, 'render-video.mjs'));
  const at = (f) => argv[argv.indexOf(f) + 1];
  assert.equal(at('--look-json'), '/o/l/look.json');
  assert.equal(at('--commit'), 'abc1234');
  assert.equal(at('--out'), '/o/l/smp24');
  assert.equal(at('--seconds'), '30');
  assert.equal(at('--size'), '1920x1080');
  assert.equal(at('--fps'), '60');
  assert.equal(at('--preroll'), '30');
  assert.equal(at('--delivery'), 'none');
  assert.equal(at('--chrome'), 'shell+angle-metal');
  assert.deepEqual(argv.slice(-2), ['--set', 'sample_count=24']);
  assert.ok(!argv.includes('--discard-master'), 'the masters are kept until the report has read them');
  assert.ok(!argv.includes('--tree'));
  assert.ok(S.childArgv({ lookFile: 'l', engine: { tree: true }, out: 'o', seconds: 1, size: [64, 36], fps: 60, preroll: 0, chrome: 'c', variant: v }).includes('--tree'));
});

// ---------------------------------------------------------------- 3. the metric parsers (fixtures: ffmpeg 7.1's own output on two 6-frame clips, one with temporal noise)
const PSNR_ERR = '[Parsed_ssim_9 @ 0x7bcac6e040] SSIM R:0.715335 (5.456659) G:0.705311 (5.306358) B:0.270168 (1.367774) All:0.563605 (3.601200)\n[Parsed_psnr_8 @ 0x7bcac6df80] PSNR r:19.134420 g:24.395082 b:19.674875 average:20.519487 min:19.812787 max:21.390282\n';
const PSNR_LOG = `n:1 mse_avg:472.12 mse_r:731.65 mse_g:235.96 mse_b:448.75 psnr_avg:21.39 psnr_r:19.49 psnr_g:24.40 psnr_b:21.61
n:2 mse_avg:477.87 mse_r:736.70 mse_g:236.69 mse_b:460.22 psnr_avg:21.34 psnr_r:19.46 psnr_g:24.39 psnr_b:21.50
n:6 mse_avg:678.89 mse_r:847.52 mse_g:238.82 mse_b:950.34 psnr_avg:19.81 psnr_r:18.85 psnr_g:24.35 psnr_b:18.35
`;
const SSIM_LOG = `n:1 R:0.719357 G:0.709110 B:0.279262 All:0.569243 (3.657676)
n:2 R:0.716018 G:0.708253 B:0.271906 All:0.565392 (3.619027)
n:6 R:0.714239 G:0.701248 B:0.252270 All:0.555919 (3.525380)
`;
const VMAF_JSON = JSON.stringify({ version: '2.3.1', fps: 31.2, frames: [{ frameNum: 0, metrics: { vmaf: 97.5 } }, { frameNum: 1, metrics: { vmaf: 96.25 } }, { frameNum: 2, metrics: { vmaf: 99 } }], pooled_metrics: { vmaf: { min: 96.25, max: 99, mean: 97.583333, harmonic_mean: 97.55 } }, aggregate_metrics: {} });

test('parsePair: the psnr / ssim summary and logs, with the per-frame minima', () => {
  const m = S.parsePair({ stderr: PSNR_ERR, psnrLog: PSNR_LOG, ssimLog: SSIM_LOG });
  assert.equal(m.psnr_db, 20.519487);
  assert.equal(m.ssim, 0.563605);
  assert.equal(m.psnr_min_frame_db, 19.81);
  assert.equal(m.ssim_min_frame, 0.555919);
  assert.equal(m.frames, 3);
  assert.equal(m.vmaf, null, 'no libvmaf, no number');
});

test('parsePair: identical frames print inf, which is kept (and a frame of inf is never the minimum)', () => {
  const err = '[Parsed_ssim_9 @ 0x1] SSIM R:1.000000 (inf) G:1.000000 (inf) B:1.000000 (inf) All:1.000000 (inf)\n[Parsed_psnr_8 @ 0x1] PSNR r:inf g:inf b:inf average:inf min:inf max:inf\n';
  const m = S.parsePair({ stderr: err, psnrLog: 'n:1 mse_avg:0.00 psnr_avg:inf psnr_r:inf\nn:2 mse_avg:0.00 psnr_avg:inf psnr_r:inf\n', ssimLog: 'n:1 R:1.000000 G:1.000000 B:1.000000 All:1.000000 (inf)\nn:2 R:1.000000 G:1.000000 B:1.000000 All:1.000000 (inf)\n' });
  assert.equal(m.psnr_db, Infinity);
  assert.equal(m.ssim, 1);
  assert.equal(m.frames, 2);
});

test('parseVmaf: the pooled mean and minimum from libvmaf\'s JSON log; the stderr score line as the fallback', () => {
  assert.deepEqual(S.parseVmaf({ json: VMAF_JSON }), { vmaf: 97.583333, vmaf_min_frame: 96.25 });
  assert.deepEqual(S.parseVmaf({ stderr: '[Parsed_libvmaf_12 @ 0x1] VMAF score: 98.125000\n' }), { vmaf: 98.125, vmaf_min_frame: null });
  assert.equal(S.parseVmaf({}), null);
});

test('parseYavg: one value per frame from signalstats\' metadata print', () => {
  const text = 'frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=0\nframe:1    pts:1       pts_time:0.0166667\nlavfi.signalstats.YAVG=509.969\nframe:2    pts:2       pts_time:0.0333333\nlavfi.signalstats.YAVG=509.969\n';
  assert.deepEqual(S.parseYavg(text), [0, 509.969, 509.969]);
  assert.deepEqual(S.parseYavg(''), []);
});

test('hasFilter reads `ffmpeg -filters`: libvmaf present or not', () => {
  const without = ' ... vmafmotion        V->V       Calculate the VMAF Motion score.\n TS. psnr              VV->V      Calculate the PSNR between two video streams.\n';
  assert.equal(S.hasFilter(without, 'libvmaf'), false, 'vmafmotion is not libvmaf');
  assert.equal(S.hasFilter(without, 'psnr'), true);
  assert.equal(S.hasFilter(`${without} ... libvmaf            VV->V      Calculate the VMAF between two video streams.\n`, 'libvmaf'), true);
});

// ---------------------------------------------------------------- 4. the filter graphs, as strings
test('the pair graph: both inputs indexed, psnr and ssim always, libvmaf only when asked, a selection re-indexed on both', () => {
  const g = S.pairGraph({ fps: 60, vmafLog: null });
  assert.match(g, /\[0:v\]settb=1\/60,setpts=N,format=gbrp\[d\]/);
  assert.match(g, /\[1:v\]settb=1\/60,setpts=N,format=gbrp\[m\]/);
  assert.match(g, /psnr=stats_file=psnr\.log\[p\]/);
  assert.match(g, /ssim=stats_file=ssim\.log\[s\]/);
  assert.ok(!g.includes('libvmaf'));
  const v = S.pairGraph({ fps: 60, vmafLog: 'vmaf.json' });
  assert.match(v, /libvmaf=log_fmt=json:log_path=vmaf\.json/);
  assert.match(v, /format=yuv444p/);
  const sel = S.pairGraph({ fps: 60, select: [0, 60], vmafLog: null });
  assert.equal(sel.split('select=eq(n\\,0)+eq(n\\,60),setpts=N').length, 3, 'the selection is on both inputs');
});

test('the analysis graph: one decode, a Laplacian residual and a frame difference, each reduced to a per-frame mean by signalstats', () => {
  const g = S.analysisGraph({ fps: 60 });
  assert.match(g, /^\[0:v\]settb=1\/60,setpts=N,format=gray16le,split=2\[a\]\[b\]/);
  assert.match(g, /convolution=0m='0 -1 0 -1 4 -1 0 -1 0':0rdiv=0\.125:0bias=32768/);
  assert.match(g, /lut=y='abs\(val-32768\)'/);
  assert.match(g, /tblend=all_mode=difference/);
  assert.equal(g.split('signalstats').length, 3);
  assert.match(g, /file=hp\.txt/);
  assert.match(g, /file=shimmer\.txt/);
  assert.match(S.analysisGraph({ fps: 60, select: [0, 60] }), /^\[0:v\]settb=1\/60,setpts=N,select=eq\(n\\,0\)\+eq\(n\\,60\),setpts=N,format=gray16le/);
});

// ---------------------------------------------------------------- 5. the high-frequency and shimmer arithmetic, on tiny synthetic frames through real ffmpeg
const W = 16, H = 8;
const flat = () => Buffer.alloc(W * H * 4);
const dot = () => { const b = flat(); const i = (4 * W + 8) * 4; b[i] = b[i + 1] = b[i + 2] = 255; return b; };   // one white pixel in a black frame (bgr0)
function clipFrom(dir, name, frames, w = W, h = H) {
  writeFileSync(join(dir, `${name}.raw`), Buffer.concat(frames));
  ff(['-f', 'rawvideo', '-pix_fmt', 'bgr0', '-s', `${w}x${h}`, '-framerate', '60', '-i', join(dir, `${name}.raw`), '-c:v', 'ffv1', '-level', '3', join(dir, `${name}.mkv`)]);
  return ['-i', join(dir, `${name}.mkv`)];
}

test('hfFromYavg and shimmerFromYavg turn signalstats\' 16-bit means back into 8-bit code units', () => {
  assert.equal(S.hfFromYavg(0), 0);
  assert.ok(Math.abs(S.hfFromYavg(65276 / 8 / 255) - 1) < 1e-9, 'a residual of one code everywhere is 1');
  assert.ok(Math.abs(S.shimmerFromYavg(65276 / 255) - 1) < 1e-9);
});

test('measureClip on a flat frame, a lone white pixel and the same again: the Laplacian mean and the frame difference match the hand count', async () => {
  const dir = tmp();
  try {
    const input = clipFrom(dir, 'dot', [flat(), dot(), dot()]);
    const m = await S.measureClip({ input, cwd: dir, fps: 60 });
    // the pixel: |L| = 4*255 at it and 255 at each of its four neighbours, over 16x8 pixels
    const hf = (4 * 255 + 4 * 255) / (W * H);
    assert.equal(m.hp.length, 3);
    assert.ok(Math.abs(m.hp[0]) < 1e-6, `flat frame: ${m.hp[0]}`);
    assert.ok(Math.abs(m.hp[1] - hf) / hf < 0.005, `${m.hp[1]} vs ${hf}`);
    assert.ok(Math.abs(m.hp[2] - hf) / hf < 0.005);
    // frame difference: 255 at one pixel between frames 0 and 1, nothing between 1 and 2; N-1 values
    assert.equal(m.shimmer.length, 2);
    assert.ok(Math.abs(m.shimmer[0] - 255 / (W * H)) / (255 / (W * H)) < 0.005, `${m.shimmer[0]}`);
    assert.ok(Math.abs(m.shimmer[1]) < 1e-6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('measureClip with a selection keeps only those frames, indexed from the clip start', async () => {
  const dir = tmp();
  try {
    const input = clipFrom(dir, 'sel', [flat(), dot(), flat(), dot()]);
    const m = await S.measureClip({ input, cwd: dir, fps: 60, select: [1, 3] });
    assert.equal(m.hp.length, 2);
    assert.ok(m.hp[0] > 10 && m.hp[1] > 10, 'frames 1 and 3 are the ones with the pixel');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('excess: the variant\'s mean minus REF\'s, positive when the variant is jaggier / noisier; frame counts must agree', () => {
  assert.equal(S.excess([3, 5, 4], [1, 2, 3]), 2);
  assert.equal(S.excess([1, 1], [2, 2]), -1, 'a smoother variant is negative: sharpness is never rewarded');
  assert.throws(() => S.excess([1, 2], [1]), /frames/);
});

test('measurePair on two real clips: psnr / ssim from ffmpeg, identical clips are inf and 1', async () => {
  const dir = tmp();
  try {
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=60:d=0.1,format=bgr0', '-c:v', 'ffv1', join(dir, 'a.mkv')]);
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=60:d=0.1,noise=alls=6:allf=t:all_seed=7,format=bgr0', '-c:v', 'ffv1', join(dir, 'b.mkv')]);
    const same = await S.measurePair({ variant: ['-i', join(dir, 'a.mkv')], ref: ['-i', join(dir, 'a.mkv')], cwd: dir, fps: 60, vmaf: false });
    assert.equal(same.psnr_db, Infinity);
    assert.equal(same.ssim, 1);
    assert.equal(same.frames, 6);
    assert.equal(same.vmaf, null);
    const noisy = await S.measurePair({ variant: ['-i', join(dir, 'b.mkv')], ref: ['-i', join(dir, 'a.mkv')], cwd: dir, fps: 60, vmaf: false });
    assert.ok(noisy.psnr_db > 15 && noisy.psnr_db < 40, `${noisy.psnr_db}`);
    assert.ok(noisy.ssim < 0.95 && noisy.ssim > 0.2);
    assert.equal(noisy.frames, 6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- 6. no visible difference, the knee, the cost
test('the stated threshold, as numbers', () => {
  assert.deepEqual(S.THRESHOLD, { ssim: 0.999, vmaf: 98, psnr_db: 48 });
  assert.match(S.thresholdText(true), /SSIM >= 0\.999 and VMAF >= 98/);
  assert.match(S.thresholdText(false), /SSIM >= 0\.999 and PSNR >= 48 dB/);
  assert.match(S.thresholdText(false), /no libvmaf/);
});

test('indistinguishable: SSIM and VMAF when VMAF exists, SSIM and PSNR when not; a missing figure never passes', () => {
  assert.equal(S.indistinguishable({ ssim: 0.9995, vmaf: 98.5, psnr_db: 30 }, { hasVmaf: true }), true);
  assert.equal(S.indistinguishable({ ssim: 0.9985, vmaf: 99, psnr_db: 60 }, { hasVmaf: true }), false);
  assert.equal(S.indistinguishable({ ssim: 0.9999, vmaf: 97.9, psnr_db: 60 }, { hasVmaf: true }), false);
  assert.equal(S.indistinguishable({ ssim: 0.9995, vmaf: null, psnr_db: 60 }, { hasVmaf: true }), false);
  assert.equal(S.indistinguishable({ ssim: 0.9995, vmaf: null, psnr_db: 48.1 }, { hasVmaf: false }), true);
  assert.equal(S.indistinguishable({ ssim: 0.9995, vmaf: null, psnr_db: 47.9 }, { hasVmaf: false }), false);
  assert.equal(S.indistinguishable({ ssim: 1, vmaf: null, psnr_db: Infinity }, { hasVmaf: false }), true);
  assert.equal(S.indistinguishable({ ssim: 0.9995, vmaf: null, psnr_db: null }, { hasVmaf: false }), false);
});

test('costFromSegments: the median ms/frame of the segments, the first (compile, warm-up) left out once there are three or more', () => {
  const seg = (ms, frames = 600) => ({ frames, render_wall_ms: ms * frames });
  assert.deepEqual(S.costFromSegments([seg(40), seg(15), seg(17), seg(16)]), { ms_per_frame: 16, ms_first_segment: 40, segments: 4 });
  assert.equal(S.costFromSegments([seg(20), seg(10)]).ms_per_frame, 15, 'two segments: both count');
  assert.equal(S.costFromSegments([seg(20)]).ms_per_frame, 20);
});

test('selectKnee: the cheapest variant within the threshold, REF only when nothing cheaper is', () => {
  const row = (id, cost_ms, flag) => ({ id, cost_ms, flag });
  assert.deepEqual(S.selectKnee([row('ref', 300, true), row('A', 15, false), row('bake1536', 90, true), row('smp24', 60, true), row('tex1024', 9, false)]).id, 'smp24');
  assert.equal(S.selectKnee([row('ref', 300, true), row('A', 15, true), row('smp16', 11, true)]).id, 'smp16');
  const none = S.selectKnee([row('ref', 300, true), row('A', 15, false)]);
  assert.equal(none.id, 'ref');
  assert.match(none.note, /nothing cheaper/);
  assert.equal(S.selectKnee([row('ref', 300, true), row('b', 50, true), row('a', 50, true)]).id, 'a', 'a tie is the id order, so the report does not flip');
});

test('knobSummary: per variant, on how many looks it is within the threshold, and its mean cost against REF', () => {
  const looks = [
    { rows: [{ id: 'ref', cost_ms: 300, flag: true }, { id: 'bake1536', cost_ms: 150, flag: true }, { id: 'smp16', cost_ms: 10, flag: false }] },
    { rows: [{ id: 'ref', cost_ms: 200, flag: true }, { id: 'bake1536', cost_ms: 100, flag: false }, { id: 'smp16', cost_ms: 10, flag: false }] },
  ];
  const s = Object.fromEntries(S.knobSummary(looks).map((r) => [r.id, r]));
  assert.deepEqual([s.bake1536.looks, s.bake1536.flagged], [2, 1]);
  assert.equal(s.bake1536.mean_cost_vs_ref, 0.5);
  assert.deepEqual([s.smp16.looks, s.smp16.flagged], [2, 0]);
  assert.ok(!s.ref, 'REF is the yardstick, not a row');
  assert.match(S.knobSentence(s.bake1536, 'bake 1536'), /bake 1536 vs REF: indistinguishable on 1\/2 looks/);
});

// ---------------------------------------------------------------- 7. the screen: descriptors, the sensitivity ranking, the proposal
const row = (name, o = {}) => ({ name, ssim: 0.99, psnr_db: 40, camera: 'floor', wind: 0.5, windy: true, tiers: [], projector: false, ...o });

test('lookDescriptors names the real keys: camera from the registry, the fall tiers from FEATURES, wind, sun disc, canopy', () => {
  const P = { receiver: 0, sky_view: false, wind_strength: 1.34, core_angular_radius_deg: 0.77, halo_angular_radius_deg: 4.3, eclipse: true, eclipse_amount: 0.4, foliage_density: 1.65, layer_count: 3, tree_count: 3, clusters_per_layer: 82, leaves_per_cluster: 59, leaf_size_m: 0.1, faithful_canopy: false, tex_resolution: 1024, bake_resolution: 0, sample_count: 32 };
  const d = S.lookDescriptors(P, { cameraFor: () => 'sky', featuresFor: () => ['fill', 'drop'] });
  assert.equal(d.camera, 'sky');
  assert.deepEqual(d.tiers, ['fill', 'drop']);
  assert.equal(d.wind_strength, 1.34);
  assert.equal(d.windy, true);
  assert.equal(d.core_angular_radius_deg, 0.77);
  assert.equal(d.eclipse, true);
  assert.equal(d.foliage_density, 1.65);
  assert.equal(d.leaf_count, 3 * 3 * 82 * 59);
  assert.deepEqual([d.tex_resolution, d.bake_resolution, d.sample_count], [1024, 0, 32]);
  assert.equal(S.lookDescriptors({ ...P, wind_strength: 0 }, { cameraFor: () => 'floor', featuresFor: () => [] }).windy, false);
});

test('spearman: rank correlation, ties averaged', () => {
  assert.equal(S.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(S.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(S.spearman([1, 1, 1], [1, 2, 3]), 0, 'a constant explains nothing');
  assert.ok(Math.abs(S.spearman([1, 2, 2, 4], [1, 3, 2, 4]) - 0.9486832980505138) < 1e-9);
});

test('explainers: the numeric descriptors that rank with the loss of fidelity, strongest first', () => {
  const rows = [1, 2, 3, 4, 5].map((i) => row(`l${i}`, { ssim: 1 - i * 0.01, wind_strength: i, foliage_density: 3 - (i % 2), leaf_size_m: 0.1 }));
  const ex = S.explainers(rows);
  assert.equal(ex[0].key, 'wind_strength');
  assert.equal(ex[0].rho, 1);
  assert.ok(!ex.some((e) => e.key === 'leaf_size_m'), 'a constant is left out');
});

test('proposeLooks: ten looks, the most sensitive, a few controls, every camera, windy and still, the fall tiers, the projector looks', () => {
  const cams = ['floor', 'cloth', 'enclosure', 'sky'];
  const tiers = ['fill', 'leafDiffuse', 'pigment', 'exposure', 'drop', 'litter'];
  const rows = [];
  for (let i = 0; i < 31; i++) rows.push(row(`look ${i}`, { camera: cams[i % 4 === 3 ? (i % 8 === 3 ? 3 : 2) : i % 2], ssim: 0.9 + 0.1 * ((i * 7) % 31) / 31, wind: i % 3 === 0 ? 0 : 1.2, windy: i % 3 !== 0, tiers: i % 5 === 0 ? [tiers[i % 6]] : [], projector: i === 17 }));
  const p = S.proposeLooks(rows, { n: 10 });
  assert.equal(p.picks.length, 10);
  assert.equal(new Set(p.picks.map((x) => x.name)).size, 10);
  const chosen = p.picks.map((x) => rows.find((r) => r.name === x.name));
  for (const c of cams) assert.ok(chosen.some((r) => r.camera === c), `camera ${c} covered`);
  assert.ok(chosen.some((r) => r.windy) && chosen.some((r) => !r.windy), 'windy and still');
  assert.ok(chosen.some((r) => r.projector), 'the projector look');
  const sorted = [...rows].sort((a, b) => a.ssim - b.ssim);
  for (const r of sorted.slice(0, 3)) assert.ok(chosen.includes(r), `${r.name} is among the most sensitive`);
  for (const r of sorted.slice(-2)) assert.ok(chosen.includes(r), `${r.name} is a control: the least sensitive`);
  for (const x of p.picks) assert.ok(x.reason && !x.reason.includes('\n'), 'a one-line reason each');
  assert.ok(p.uncovered.every((u) => u.startsWith('tier:')), 'all mandatory cameras, wind states and projector looks fit; missing tiers are reported honestly');
  const tiersCovered = new Set(chosen.flatMap((r) => r.tiers));
  assert.ok(tiersCovered.size >= 3, `fall tiers covered: ${[...tiersCovered]}`);
});

test('proposeLooks says what it could not cover, and takes everything when there are fewer candidates than slots', () => {
  const rows = [row('a'), row('b', { ssim: 0.95 }), row('c', { ssim: 0.97, windy: false })];
  const p = S.proposeLooks(rows, { n: 10 });
  assert.equal(p.picks.length, 3);
  assert.ok(p.uncovered.some((u) => /cloth/.test(u)), `uncovered: ${p.uncovered}`);
});

test('the proposal over the real built-in looks reaches all four cameras and the controls (descriptors from the repo\'s own presets.js)', async () => {
  const eng = await S.loadEngine(REPO);
  assert.ok(Object.keys(eng.PRESETS).length >= 30);
  const rows = Object.entries(eng.PRESETS).map(([name, P], i) => ({ name, ssim: 0.9 + ((i * 13) % 29) / 300, psnr_db: 30, ...S.lookDescriptors(P, eng), projector: /projector/i.test(name) }));
  const cams = new Set(rows.map((r) => r.camera));
  assert.deepEqual([...cams].sort(), ['cloth', 'enclosure', 'floor', 'sky']);
  const p = S.proposeLooks(rows, { n: 10 });
  const chosen = p.picks.map((x) => rows.find((r) => r.name === x.name));
  for (const c of cams) assert.ok(chosen.some((r) => r.camera === c), `${c} covered`);
  assert.deepEqual(p.uncovered.filter((u) => /camera/.test(u)), []);
  const least = [...rows].sort((a, b) => b.ssim - a.ssim).slice(0, 2);
  for (const r of least) assert.ok(chosen.includes(r), `control ${r.name}`);
});

// ---------------------------------------------------------------- 8. the estimate, the disk, the resume
test('variantMsGuess: REF is the max, authored is authored, and a raised knob lies between', () => {
  const grid = S.variantGrid(AUTH), by = Object.fromEntries(grid.map((v) => [v.id, v]));
  const g = (id) => S.variantMsGuess(by[id], AUTH, { authoredMs: 15, maxMs: 300 });
  assert.equal(g('ref'), 300);
  assert.equal(g('A'), 15);
  assert.equal(g('tex1024'), 15, 'a lowered knob is not cheaper than authored in this guess');
  assert.ok(g('tex4096') > 15 && g('tex4096') < 300);
  assert.ok(g('smp48') > 15 && g('smp48') < g('tex4096') * 10);
  assert.ok(g('ss2') > 15 && g('ss2') <= 300);
  assert.ok(g('maxnoss') > g('ss2') || g('maxnoss') > 15);
});

test('estimateRun: looks x variants x frames x ms/frame, plus a fixed cost per variant; REF dominates', () => {
  const e = S.estimateRun({ looks: [{ authored: AUTH }, { authored: AUTH }], seconds: 30, fps: 60 });
  assert.equal(e.variants, 26);
  assert.equal(e.frames, 26 * 1800);
  const refShare = (2 * 1800 * 300) / 1000;
  assert.ok(e.seconds > refShare && e.seconds < refShare * 20, `${e.seconds}`);
  const half = S.estimateRun({ looks: [{ authored: AUTH }, { authored: AUTH }], seconds: 15, fps: 60 });
  assert.ok(half.seconds < e.seconds * 0.6);
  const fast = S.estimateRun({ looks: [{ authored: AUTH, authoredMs: 1, maxMs: 2 }], seconds: 30, fps: 60 });
  assert.ok(fast.seconds < e.seconds / 4, 'the screen\'s own measurements replace the M4 defaults');
  assert.match(S.formatDuration(3 * 3600 + 20 * 60), /3 h 20 min/);
  assert.match(S.formatDuration(95), /1 min/);
});

test('diskEstimate: the lossless masters of every variant of every look, at the exporter\'s per-frame figure', () => {
  const d = S.diskEstimate({ variants: 26, frames: 1800, size: [1920, 1080] });
  assert.ok(Math.abs(d.bytes - 26 * 1800 * 0.72e6) < 1e6);
  assert.ok(Math.abs(S.diskEstimate({ variants: 1, frames: 100, size: [3840, 2160] }).bytes - 100 * 0.72e6 * 4) < 1e6);
});

test('variantComplete: complete.json with the frames this run wants, nothing else', () => {
  const dir = tmp();
  try {
    assert.equal(S.variantComplete(dir, 1800), false);
    writeFileSync(join(dir, 'complete.json'), JSON.stringify({ key: 'k', frames: 1800 }));
    assert.equal(S.variantComplete(dir, 1800), true);
    assert.equal(S.variantComplete(dir, 900), false, 'a run of another length is not this run');
    writeFileSync(join(dir, 'complete.json'), '{half');
    assert.equal(S.variantComplete(dir, 1800), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runMetaProblems: a folder is one commit, one clock, one size', () => {
  const meta = { commit: 'abc', seconds: 30, fps: 60, size: [1920, 1080], preroll: 30, chrome: 'x' };
  assert.deepEqual(S.runMetaProblems(meta, { ...meta }), []);
  assert.equal(S.runMetaProblems(null, meta).length, 0);
  const p = S.runMetaProblems(meta, { ...meta, seconds: 10, size: [1280, 720] });
  assert.equal(p.length, 2);
  assert.match(p.join('\n'), /seconds/);
  assert.match(p.join('\n'), /size/);
});

test('the pure helpers: slug and the looks resolver', () => {
  assert.equal(S.slug('afternoon 4b'), 'afternoon-4b');
  assert.equal(S.slug('★ Montebello / #2'), 'montebello-2');
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'one.json'), JSON.stringify({ name: 'One', params: { exposure: 1 } }));
    writeFileSync(join(dir, 'two.json'), JSON.stringify({ exposure: 2 }));
    writeFileSync(join(dir, 'proposal.json'), JSON.stringify({ looks: [{ name: 'One', file: join(dir, 'one.json'), reason: 'r' }] }));
    const all = S.readLooks(dir, { skip: ['proposal.json'] });
    assert.deepEqual(all.map((l) => l.name), ['One', 'two']);
    assert.deepEqual(all[0].params, { exposure: 1 });
    assert.deepEqual(all[1].params, { exposure: 2 });
    const chosen = S.readLooks(join(dir, 'proposal.json'));
    assert.deepEqual(chosen.map((l) => l.name), ['One']);
    assert.equal(chosen[0].reason, 'r');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- 9. the sheet: ids, the busiest region, the crop, the montage
test('frame ids are quotable: S<look>-<variant>, with -2x for the 200% crop', () => {
  assert.equal(S.frameId(3, 'bake1536', 1), 'S3-bake1536');
  assert.equal(S.frameId(3, 'bake1536', 2), 'S3-bake1536-2x');
  assert.equal(S.frameId(10, 'ref', 1), 'S10-ref');
});

test('busiestWindow: the window with the most residual energy, found through an integral image', () => {
  const w = 40, h = 24, plane = new Float64Array(w * h);
  for (let y = 15; y < 19; y++) for (let x = 28; x < 33; x++) plane[y * w + x] = 5;
  plane[2 * w + 3] = 1;
  const r = S.busiestWindow(plane, w, h, 10, 6);
  assert.ok(r.x <= 28 && r.x + 10 >= 33 && r.y <= 15 && r.y + 6 >= 19, JSON.stringify(r));
  assert.equal(r.sum, 100);
  assert.equal(r.x % 2, 0, 'even offsets, so a 4:2:0 crop cannot shift a pixel');
  assert.equal(r.y % 2, 0);
  assert.deepEqual(S.busiestWindow(new Float64Array(w * h), w, h, 10, 6), { x: 0, y: 0, w: 10, h: 6, sum: 0 });
});

test('cropSize: a quarter of the frame each way, even', () => {
  assert.deepEqual(S.cropSize(1920, 1080), [480, 270]);
  assert.deepEqual(S.cropSize(130, 74), [32, 18]);
});

test('sheetVariants: REF, A, the knee, then up to three informative ones (worst SSIM, jaggiest, shimmeriest), no repeats', () => {
  const rows = [
    { id: 'ref', ssim: 1, hf_excess: 0, shimmer_excess: 0 }, { id: 'A', ssim: 0.97, hf_excess: 0.5, shimmer_excess: 0.1 },
    { id: 'smp24', ssim: 0.9995, hf_excess: 0.01, shimmer_excess: 0.0 }, { id: 'tex1024', ssim: 0.9, hf_excess: -0.2, shimmer_excess: 0.02 },
    { id: 'smp16', ssim: 0.98, hf_excess: 0.1, shimmer_excess: 0.9 }, { id: 'ss2', ssim: 0.99, hf_excess: 2.5, shimmer_excess: 0.05 },
  ];
  assert.deepEqual(S.sheetVariants(rows, 'smp24'), ['ref', 'A', 'smp24', 'tex1024', 'ss2', 'smp16']);
  assert.deepEqual(S.sheetVariants(rows.slice(0, 2), 'A'), ['ref', 'A']);
  assert.deepEqual(S.sheetVariants(rows, 'tex1024'), ['ref', 'A', 'tex1024', 'ss2', 'smp16', 'smp24'].slice(0, 6));
});

test('montageArgs: review.mjs\'s conventions (labels, white background, a title), no scaling of a crop', () => {
  const a = S.montageArgs({ items: [{ file: '/f/S1-ref.png', label: 'S1-ref  100%' }, { file: '/f/S1-A.png', label: '100% of A, 50% of 100%' }], tile: '2x1', size: [480, 270], title: 'S1 x', out: '/s/S1-100.png', font: '/F.ttc' });
  assert.equal(a[0], 'montage');
  assert.deepEqual(a.slice(a.indexOf('-font'), a.indexOf('-font') + 2), ['-font', '/F.ttc']);
  assert.ok(a.includes('-label'));
  assert.equal(a[a.indexOf('-label') + 1], 'S1-ref  100%%', 'ImageMagick expands percent escapes; literal percents are doubled');
  assert.equal(a[a.indexOf('-label') + 2], '/f/S1-ref.png');
  assert.equal(a[a.indexOf('-tile') + 1], '2x1');
  assert.equal(a[a.indexOf('-geometry') + 1], '480x270+8+8');
  assert.equal(a[a.indexOf('-title') + 1], 'S1 x');
  assert.equal(a.at(-1), '/s/S1-100.png');
  assert.ok(S.montageArgs({ items: [{ file: 'f', label: '50% off @x' }], tile: '1x1', size: [4, 4], title: '@t%', out: 'o' }).includes('50%% off @x'), 'percent signs are doubled, as review.mjs does');
});

// ---------------------------------------------------------------- 10. the plot
test('plotSvg: one point per variant, the threshold line, a legend; no raw sharpness anywhere', () => {
  const svg = S.plotSvg({ title: 't', points: [{ id: 'A', knob: 'A', x: 0.05, ssim: 0.97, flag: false }, { id: 'smp24', knob: 'samples', x: 0.2, ssim: 0.9995, flag: true, knee: true }, { id: 'ref', knob: 'ref', x: 1, ssim: 1, flag: true }] });
  assert.match(svg, /^<svg /);
  assert.equal(svg.split('<circle').length - 1, 3 + 4, 'three points and the legend swatches');
  assert.match(svg, /SSIM >= 0\.999/);
  assert.match(svg, /smp24/);
  assert.ok(svg.includes('</svg>'));
});

// ---------------------------------------------------------------- 11. a whole run folder, hand-made: the measure, the knee, the report, without a GPU
function fakeRun(out, slug, clips) {
  // clips: { id: { vf, ms } }; every clip is 30 frames of 128x72 testsrc2 through `vf`
  mkdirSync(out, { recursive: true });
  const variants = Object.keys(clips).map((id) => ({ id, label: id, knob: id === 'ref' || id === 'A' ? id : id.replace(/\d+$/, ''), set: {}, ss: 1, effective: { tex: 2048, bake: 1024, samples: 32, ss: 1 }, dupe_of: null }));
  for (const [id, c] of Object.entries(clips)) {
    const d = join(out, slug, id), seg = join(d, 'seg');
    mkdirSync(seg, { recursive: true });
    ff(['-f', 'lavfi', '-i', `testsrc2=s=128x72:r=60:d=0.5,${c.vf ? `${c.vf},` : ''}format=bgr0`, '-c:v', 'ffv1', '-level', '3', join(seg, 'seg_00000.mkv')]);
    writeFileSync(join(seg, 'list.txt'), concatListText(['seg_00000.mkv']));
    writeFileSync(join(seg, 'seg_00000.json'), JSON.stringify({ segment: 0, first_frame: 0, frames: 30, render_wall_ms: c.ms * 30 }));
    writeFileSync(join(d, 'complete.json'), JSON.stringify({ key: `k-${id}`, frames: 30, master_set_sha256: `sha-${id}`, at: '2026-10-10T00:00:00Z' }));
    writeFileSync(join(d, 'run-key.json'), JSON.stringify({ key: `k-${id}`, provenance: { kind: 'commit', commit: 'c0ffee0123456789c0ffee0123456789c0ffee01', dirty: false } }));
  }
  writeFileSync(join(out, 'study.json'), JSON.stringify({ tool: 'test-gl/study.mjs', commit: 'c0ffee0', seconds: 0.5, fps: 60, size: [128, 72], preroll: 30, chrome: 'x', looks: [{ name: 'Fake look', slug, file: join(out, slug, 'look.json'), authored: AUTH, variants }] }));
}

test('measureLook + assemble over a hand-made run: metrics, flags, the knee, the crops, report.json / report.md / plot.svg, and the sheets skipped without ImageMagick', async () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', {
      ref: { vf: null, ms: 300 },
      A: { vf: 'noise=alls=8:allf=t:all_seed=3', ms: 15 },
      tex1024: { vf: null, ms: 9 },            // identical to REF: within the threshold, and cheaper than A
      smp16: { vf: 'noise=alls=1:allf=t:all_seed=5', ms: 12 },
    });
    const log = [];
    const rep = await S.assemble({ out, magick: false, log: (m) => log.push(m), date: '2026-10-10' });
    assert.equal(rep.vmaf_available, S.hasFilter(spawnSync(FFMPEG, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout, 'libvmaf'));
    const look = rep.looks[0];
    const by = Object.fromEntries(look.rows.map((r) => [r.id, r]));
    assert.equal(by.ref.ssim, null, 'REF is the yardstick');
    assert.equal(by.A.flag, false);
    assert.ok(by.A.hf_excess > 0, 'noise is jaggier than REF');
    assert.ok(by.A.shimmer_excess > 0, 'temporal noise flickers');
    assert.equal(by.A.cost_ms, 15);
    assert.equal(by.tex1024.psnr_db, Infinity);
    assert.equal(by.tex1024.ssim, 1);
    assert.equal(by.tex1024.hf_excess, 0);
    assert.equal(by.tex1024.shimmer_excess, 0);
    if (!rep.vmaf_available) assert.equal(by.tex1024.vmaf, null);
    assert.equal(by.tex1024.flag, true);
    assert.equal(look.knee.id, 'tex1024', 'the cheapest variant within the threshold');
    assert.ok(by.smp16.ssim > by.A.ssim);
    // the cache: the measurement is a file, and a second pass reads it instead of ffmpeg
    assert.ok(existsSync(join(out, 'fake', 'metrics', 'A.json')));
    // the crops: the same frame, the busiest region, 100% and 200%, for REF, A, the knee and the informative ones
    const sheetIds = look.sheet.variants;
    assert.deepEqual(sheetIds.slice(0, 3), ['ref', 'A', 'tex1024']);
    for (const id of sheetIds) {
      assert.ok(existsSync(join(out, 'review', '2026-10-10', 'frames', `S1-${id}.png`)), `${id} 100%`);
      assert.ok(existsSync(join(out, 'review', '2026-10-10', 'frames', `S1-${id}-2x.png`)), `${id} 200%`);
    }
    const man = JSON.parse(readFileSync(join(out, 'review', '2026-10-10', 'manifest.json'), 'utf8'));
    const f = man.sheets[0].frames.find((x) => x.id === 'S1-A');
    assert.equal(f.variant, 'A');
    assert.equal(f.file, 'frames/S1-A.png');
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.equal(man.sheets[0].commit, 'c0ffee0123456789c0ffee0123456789c0ffee01');
    assert.equal(typeof f.metrics.ssim, 'number');
    assert.equal(f.crop.w, 32);
    assert.equal(man.sheets[0].jose, null);
    assert.ok(log.some((l) => /ImageMagick|magick/.test(l)), 'the skipped sheets are said');
    // the report files
    const md = readFileSync(join(out, 'report.md'), 'utf8');
    assert.match(md, /SSIM >= 0\.999/);
    assert.match(md, /libvmaf/);
    assert.match(md, /Fake look/);
    assert.match(md, /knee/i);
    assert.match(md, /tex1024/);
    assert.ok(readFileSync(join(out, 'plot.svg'), 'utf8').startsWith('<svg'));
    const json = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(json.looks[0].rows.find((r) => r.id === 'tex1024').psnr_db, 'inf', 'JSON has no infinity');
    assert.equal(json.threshold.ssim, 0.999);
    assert.ok(json.summary.length >= 3);
    // a second pass reads the cache: removing the masters changes nothing
    rmSync(join(out, 'fake', 'A', 'seg', 'seg_00000.mkv'));
    const again = await S.assemble({ out, magick: false, log: () => {}, date: '2026-10-10' });
    assert.equal(again.looks[0].rows.find((r) => r.id === 'A').ssim, by.A.ssim);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('clean: masters go only after the required report and sheets are complete; the records stay', { skip: spawnSync('magick', ['-version']).status !== 0 }, async () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', { ref: { vf: null, ms: 300 }, A: { vf: 'noise=alls=8:allf=t:all_seed=3', ms: 15 } });
    const refuse = S.clean({ out });
    assert.equal(refuse.removed, 0);
    assert.match(refuse.refused[0], /fake/);
    assert.ok(existsSync(join(out, 'fake', 'A', 'seg', 'seg_00000.mkv')));
    await S.assemble({ out, magick: true, log: () => {}, date: '2026-10-10' });
    const done = S.clean({ out });
    assert.equal(done.removed, 2);
    assert.ok(!existsSync(join(out, 'fake', 'A', 'seg', 'seg_00000.mkv')));
    assert.ok(existsSync(join(out, 'fake', 'A', 'seg', 'seg_00000.json')));
    assert.ok(existsSync(join(out, 'fake', 'A', 'complete.json')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('default CLI report refuses missing ImageMagick instead of reporting complete with missing sheets', () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', { ref: { vf: null, ms: 300 }, A: { vf: null, ms: 15 } });
    const ffmpeg = FFMPEG.includes('/') ? FFMPEG : process.env.PATH.split(':').map((dir) => join(dir, FFMPEG)).find(existsSync);
    const r = spawnSync(process.execPath, [join(HERE, 'study.mjs'), 'report', '--out', out], { encoding: 'utf8', env: { ...process.env, PATH: out, FFMPEG: ffmpeg } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ImageMagick.*required/i);
    assert.ok(!existsSync(join(out, 'report.json')), 'a refused default report publishes no completion artifact');
    assert.ok(existsSync(join(out, 'fake', 'A', 'seg', 'seg_00000.mkv')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('clean keeps masters after partial metric analysis that did not generate sheets', async () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', { ref: { vf: null, ms: 300 }, A: { vf: null, ms: 15 } });
    await S.assemble({ out, magick: false, log: () => {}, date: '2026-10-10' });
    assert.equal(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).complete, false);
    assert.match(readFileSync(join(out, 'report.md'), 'utf8'), /Partial analysis.*cleanup is refused/);
    const result = S.clean({ out });
    assert.equal(result.removed, 0);
    assert.match(result.refused[0], /report.*sheet/i);
    assert.ok(existsSync(join(out, 'fake', 'A', 'seg', 'seg_00000.mkv')));
    assert.equal(S.clean({ out, force: true }).removed, 0, 'an unrequested force property cannot bypass required sheets');
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('clean keeps masters when a required generated sheet has disappeared', { skip: spawnSync('magick', ['-version']).status !== 0 }, async () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', { ref: { vf: null, ms: 300 }, A: { vf: null, ms: 15 } });
    await S.assemble({ out, magick: true, log: () => {}, date: '2026-10-10' });
    rmSync(join(out, 'review', '2026-10-10', 'S1-200.png'));
    const result = S.clean({ out });
    assert.equal(result.removed, 0);
    assert.match(result.refused[0], /report.*sheet/i);
    assert.ok(existsSync(join(out, 'fake', 'A', 'seg', 'seg_00000.mkv')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('report publishes completion only after the final plot succeeds, retaining masters after a plot write failure', { skip: spawnSync('magick', ['-version']).status !== 0 }, async () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', { ref: { vf: null, ms: 300 }, A: { vf: null, ms: 15 } });
    mkdirSync(join(out, 'plot.svg'));
    await assert.rejects(S.assemble({ out, magick: true, log: () => {}, date: '2026-10-10' }), { code: 'EISDIR' });
    assert.ok(!existsSync(join(out, 'report.json')), 'failed artifact generation publishes no completion marker');
    assert.equal(S.clean({ out }).removed, 0);
    assert.ok(existsSync(join(out, 'fake', 'A', 'seg', 'seg_00000.mkv')));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- 12. the command line, without a GPU
const run = (args) => spawnSync(process.execPath, [join(HERE, 'study.mjs'), ...args], { encoding: 'utf8' });

test('--help names the three steps, clean, and the estimated wall time of the run step', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0, r.stderr);
  for (const w of ['screen', 'run', 'report', 'clean', '--looks', '--seconds', '--arboretum', 'ARBORETUM_TOKEN', 'libvmaf']) assert.ok(r.stdout.includes(w), `help mentions ${w}`);
  assert.match(r.stdout, /wall time/i);
  assert.match(r.stdout, /\d+(\.\d+)? h/);
});

test('help master budget matches lossless frames for ten default looks and their actual deduplicated variants', () => {
  const e = S.estimateRun({ looks: Array.from({ length: 10 }, () => ({ authored: AUTH })), seconds: 30, fps: 60 });
  const budget = S.diskEstimate({ variants: e.variants, frames: 1800, size: [1920, 1080] });
  assert.ok(S.HELP.includes(`${(budget.bytes / 1e9).toFixed(1)} GB`));
});

test('run --dry-run plans every variant of every look and renders nothing', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ name: 'A look', params: { exposure: 1 } }));
    writeFileSync(join(dir, 'b.json'), JSON.stringify({ name: 'B look', params: { tex_resolution: 4096, bake_resolution: 0, sample_count: 48 } }));
    const r = run(['run', '--looks', dir, '--out', join(dir, 'out'), '--commit', 'abc1234', '--seconds', '30', '--size', '1920x1080', '--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 looks/);
    assert.match(r.stdout, /A look: 13 renders/);
    assert.match(r.stdout, /B look: 11 renders/);   // 16 rows minus tex4096, bake0, smp48, maxnoss and ss2 (= ref)
    assert.match(r.stdout, /wall time/i);
    assert.match(r.stdout, /render-video\.mjs/);
    assert.ok(!existsSync(join(dir, 'out', 'a-look')), 'a dry run writes nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run refuses changed look params before skipping completed variants or rewriting the saved input', () => {
  const dir = tmp();
  try {
    const params = { exposure: 1 }, input = join(dir, 'input.json'), out = join(dir, 'out');
    writeFileSync(input, JSON.stringify({ name: 'One', params }));
    mkdirSync(join(out, 'one'), { recursive: true });
    const saved = join(out, 'one', 'look-input.json');
    writeFileSync(saved, JSON.stringify({ name: 'One', params }));
    writeFileSync(join(out, 'study.json'), JSON.stringify({ commit: 'abc1234', seconds: 30, fps: 60, size: [1920, 1080], preroll: 30, chrome: 'shell+angle-metal',
      looks: [{ name: 'One', slug: 'one', params_sha256: canonicalSha256(params), authored: AUTH, variants: S.variantGrid(AUTH) }] }));
    writeFileSync(input, JSON.stringify({ name: 'One', params: { exposure: 2 } }));
    const before = readFileSync(saved, 'utf8');
    const r = run(['run', '--looks', input, '--out', out, '--commit', 'abc1234', '--dry-run']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /looks or quality variants differ/);
    assert.equal(readFileSync(saved, 'utf8'), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('report refuses a truncated master instead of repeating its last frame to pair it with REF', async () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', { ref: { vf: null, ms: 300 }, A: { vf: null, ms: 15 } });
    const master = join(out, 'fake', 'A', 'seg', 'seg_00000.mkv');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=60:d=0.25,format=bgr0', '-c:v', 'ffv1', master]);
    await assert.rejects(S.assemble({ out, magick: false, log: () => {} }), /decoded frames disagree/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('report with ImageMagick writes labelled sheets and preserves José\'s archive remarks on a rerun', { skip: spawnSync('magick', ['-version']).status !== 0 }, async () => {
  const out = tmp();
  try {
    fakeRun(out, 'fake', { ref: { vf: null, ms: 300 }, A: { vf: null, ms: 15 } });
    await S.assemble({ out, magick: true, log: () => {}, date: '2026-10-10' });
    const folder = join(out, 'review', '2026-10-10'), path = join(folder, 'manifest.json'), manifest = JSON.parse(readFileSync(path, 'utf8'));
    for (const sh of manifest.sheets) {
      assert.equal(sh.generated, true); assert.ok(existsSync(join(folder, sh.file)));
      assert.equal(readFileSync(join(folder, sh.file)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      sh.jose = 'keep this observation';
    }
    writeFileSync(path, JSON.stringify(manifest));
    await S.assemble({ out, magick: true, log: () => {}, date: '2026-10-10' });
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).sheets[0].jose, 'keep this observation');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
