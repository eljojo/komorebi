// Tests of the video exporter (render-video.mjs builds its chains from video-lib.mjs; this file runs those same strings).
//   node --test test-gl/video.test.mjs            (ffmpeg and git on PATH, and test-gl's `npm install`: the exporter imports the playwright package, but no browser is ever launched;
//                                                  the real-frame test also needs the fixtures below, else it is skipped and says how to make them)
//
// 1. THE DOWNSCALE. The master is rendered at ss x the output size and box-averaged by ffmpeg. The averaging must be per channel: a pure blue pixel must
//    stay pure blue. swscale's area scaler of a planar-RGB format is not (it runs through its YUV-shaped intermediate and mixes planes), so the
//    chain scales each plane on its own as gray16. Held to a FLOAT reference of the exact box average (linear light: the engine's own power law 2.2).
// 2. THE PAIRING of measure(): the delivery (mp4, 1/15360 clock) and the master (mkv, ms clock) must be compared frame i with frame i.
// 3. the dark-end error of the linear chain, as stated.   4. the server's served-hash map pins the page.   5. the exporter as a process with no browser: the run key, --encode-only, its refusals.
// 6. the exporter's help, key-first writes, the carried-over measure, the delivery command, segment hashes without file_sha256, --set.
// 7. the USB-safe delivery, the FAT32 limit, the disk estimate.   8. --arboretum against a mock that answers arboretum's live shapes: the fetch, the pin, the refusals, and that no token reaches a file, a message or a child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, cpSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, closeSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// the library as a namespace: a missing export fails the one test that uses it (TypeError), not the whole file at load
import * as lib from './video-lib.mjs';
import { CONCAT_INPUT, FFMPEG, HERE, PLAYER_RGB, concatListText, deliveryArgs, deliveryFilter, ffprobeJson, masterChain, parseMeasure, runMeasure, sha256, startServer } from './video-lib.mjs';

const W = 3840, H = 2160;   // the render size of a 1080p ss-2 export
const FIXTURES = ['ultraviolet', 'cherry'].map((l) => join(HERE, 'out', 'video', 'chain-fixtures', l, 'master.mkv'));

// ---------------------------------------------------------------- the chain under test, fed raw rgba the way the page's readPixels delivers it
function runChain(chain, frames, w, h, outW, outH) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', '60', '-i', '-', '-an', '-vf', chain, '-f', 'rawvideo', '-pix_fmt', 'bgr0', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err}`));
      const all = Buffer.concat(out), fb = outW * outH * 4;
      if (all.length !== fb * frames.length) return reject(new Error(`got ${all.length} bytes, expected ${fb * frames.length}`));
      resolve(frames.map((_, i) => all.subarray(i * fb, (i + 1) * fb)));
    });
    p.stdin.on('error', () => {});
    (async () => { for (const f of frames) if (!p.stdin.write(f)) await new Promise((r) => p.stdin.once('drain', r)); p.stdin.end(); })();
  });
}

// ---------------------------------------------------------------- the reference: the exact k x k box average, in float
// `linear`: mean of (v/255)^2.2, back through ^(1/2.2); `gamma`: mean of the codes. Row order is the chain's: it starts with vflip.
const DEC = Float64Array.from({ length: 256 }, (_, v) => (v / 255) ** 2.2);
function reference(frame, w, h, k, space) {
  const ow = w / k, oh = h / k, ref = new Float64Array(ow * oh * 3), n = k * k;
  for (let y = 0; y < oh; y++) {
    const sy0 = (oh - 1 - y) * k;   // vflip: output row y is the box at input rows (oh-1-y)*k ..
    for (let x = 0; x < ow; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const v = frame[((sy0 + dy) * w + x * k + dx) * 4 + c]; s += space === 'linear' ? DEC[v] : v; }
        ref[(y * ow + x) * 3 + c] = space === 'linear' ? 255 * (s / n) ** (1 / 2.2) : s / n;
      }
    }
  }
  return ref;
}
// ours is bgr0 (B,G,R,x); the reference is R,G,B.
// Two readings of "within 1 code": maxErrInt = |ours - round(ref)| (an 8-bit output against the 8-bit-rounded reference) must be <= 1, and the float
// error maxErr must be <= 1.5. The float error can exceed 1 by a hair at the very dark end (6 channels in 6 M on a real frame, 1.065): the linear
// intermediate is 16 bit, one step of it there is 1.85 display codes, so the output grid is {0, 2, 4, ..} and a reference of 0.935 lands on 2.
// That is the accepted "code 1 lost in the 16-bit linear intermediate" (the manifest states it); a chain that lets the planes mix leaks up to 6 full codes (the negative control below).
function compare(ours, ref, ow, oh) {
  let maxErr = 0, maxErrInt = 0, over1 = 0, over05 = 0, worst = null;
  const count = ow * oh * 3, hist = new Float64Array(3);
  for (let i = 0; i < ow * oh; i++) {
    for (let c = 0; c < 3; c++) {
      const o = ours[i * 4 + (2 - c)], r = ref[i * 3 + c], e = Math.abs(o - r), ei = Math.abs(o - Math.round(r));
      hist[c] = Math.max(hist[c], e);
      if (ei > maxErrInt) maxErrInt = ei;
      if (e > maxErr) { maxErr = e; worst = { pixel: [i % ow, (i / ow) | 0], channel: 'RGB'[c], ours: o, ref: r }; }
      if (e > 1) over1++; else if (e > 0.5) over05++;
    }
  }
  return { maxErr, maxErrInt, worst, over1, over05, over1Frac: over1 / count, perChannelMax: [...hist] };
}
const bad = (rows) => rows.filter((r) => r.maxErrInt > 1 || r.maxErr > 1.5).map((r) => `${r.label}: int ${r.maxErrInt}, float ${r.maxErr.toFixed(3)} at ${JSON.stringify(r.worst)}`);

const solid = (r, g, b, w = W, h = H) => { const f = Buffer.alloc(w * h * 4); f.fill(Buffer.from([r, g, b, 255])); return f; };
// 2x2 blocks that alternate two colours both ways (every box average mixes them), and seeded noise
const checker = (a, b, w = W, h = H) => { const f = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = (x + y) & 1 ? b : a; f.set([c[0], c[1], c[2], 255], (y * w + x) * 4); } return f; };
const noise = (seed, w = W, h = H) => { const f = Buffer.alloc(w * h * 4); let s = seed; for (let i = 0; i < f.length; i += 4) { s = (Math.imul(s, 1664525) + 1013904223) | 0; f[i] = s >>> 24; f[i + 1] = (s >>> 16) & 255; f[i + 2] = (s >>> 8) & 255; f[i + 3] = 255; } return f; };

const CARDS = [
  ['pure R', [255, 0, 0]], ['pure G', [0, 255, 0]], ['pure B', [0, 0, 255]],
  ['cyan', [0, 255, 255]], ['magenta', [255, 0, 255]], ['yellow', [255, 255, 0]], ['white', [255, 255, 255]],
  ['dark blue 40', [0, 0, 40]], ['dark blue 12', [0, 0, 12]], ['dark red 30', [30, 0, 0]], ['dark green 20', [0, 20, 0]],
  ['ultraviolet-ish', [20, 0, 90]], ['cherry-ish', [120, 8, 20]],
];

function reportCards(name, rows) { console.log(`  ${name}\n${rows.map((r) => `    ${r.label.padEnd(18)} max error ${r.maxErr.toFixed(3)} codes (int ${r.maxErrInt})${r.leak ? `  LEAK ${r.leak}` : ''}`).join('\n')}`); }

async function cardsFor(space, ss) {
  const ow = W / ss, oh = H / ss;
  const chain = masterChain({ ow, oh, ss, space, master: 'ffv1' });
  const frames = CARDS.map(([, c]) => solid(...c));
  const outs = await runChain(chain, frames, W, H, ow, oh);
  return CARDS.map(([label, c], i) => {
    const o = outs[i];
    const cmp = compare(o, reference(frames[i], W, H, ss, space), ow, oh);
    // no cross-channel leak: a channel that is 0 in the card must be exactly 0 everywhere in the output
    const leaks = []; for (let ch = 0; ch < 3; ch++) if (c[ch] === 0) { let m = 0; for (let p = 0; p < ow * oh; p++) m = Math.max(m, o[p * 4 + (2 - ch)]); if (m > 0) leaks.push(`${'RGB'[ch]}=${m}`); }
    return { label, ...cmp, leak: leaks.join(' ') };
  });
}

for (const [space, ss] of [['linear', 2], ['linear', 4], ['gamma', 2]]) {
  test(`downscale ${space} ss ${ss}: flat cards stay within 1 code of the box average and no channel leaks into another`, async () => {
    const rows = await cardsFor(space, ss);
    reportCards(`${space} ss ${ss}`, rows);
    assert.deepEqual(rows.filter((r) => r.leak).map((r) => `${r.label}: ${r.leak}`), [], 'cross-channel leak');
    assert.deepEqual(bad(rows), [], 'card off by more than 1 code');
  });
}

for (const space of ['linear', 'gamma']) {
  test(`downscale ${space} ss 2: 2x2 mixes of two colours and seeded noise within 1 code of the float box average`, async () => {
    const ss = 2, ow = W / ss, oh = H / ss;
    const chain = masterChain({ ow, oh, ss, space, master: 'ffv1' });
    const frames = [checker([0, 0, 255], [0, 0, 0]), checker([255, 0, 0], [0, 0, 255]), checker([0, 255, 0], [255, 0, 255]), checker([10, 10, 10], [0, 0, 60]), noise(7)];
    const outs = await runChain(chain, frames, W, H, ow, oh);
    const names = ['blue/black checker', 'red/blue checker', 'green/magenta checker', 'dark grey/dark blue checker', 'noise'];
    const rows = outs.map((o, i) => ({ label: names[i], ...compare(o, reference(frames[i], W, H, ss, space), ow, oh) }));
    reportCards(`${space} ss 2 mixed`, rows);
    assert.deepEqual(bad(rows), []);
  });
}

// NEGATIVE CONTROL. A chain that area-scales gbrp16le in one pass (the planes not kept apart): this harness must see its leak, else a green above proves nothing.
test('negative control: a one-pass gbrp16le area scale leaks across channels and is caught by the same measures', async () => {
  const ow = W / 2, oh = H / 2, L = (inv) => `clip(pow(val/maxval,${inv ? '1/2.2' : '2.2'})*maxval+0.5,0,maxval)`, LUT = (inv) => `lutrgb=r='${L(inv)}':g='${L(inv)}':b='${L(inv)}'`;
  const onePass = `vflip,format=gbrp16le,${LUT(false)},scale=${ow}:${oh}:flags=area+accurate_rnd+full_chroma_int,${LUT(true)},format=bgr0`;
  const frames = [solid(0, 0, 255), solid(0, 255, 0)];
  const outs = await runChain(onePass, frames, W, H, ow, oh);
  const leak = (o, ch) => { let m = 0; for (let p = 0; p < ow * oh; p++) m = Math.max(m, o[p * 4 + (2 - ch)]); return m; };
  assert.ok(leak(outs[0], 0) > 1, `pure blue should leak into red under the one-pass chain, got R=${leak(outs[0], 0)}`);
  assert.ok(leak(outs[1], 2) > 1, `pure green should leak into blue under the one-pass chain, got B=${leak(outs[1], 2)}`);
  const cmp = compare(outs[0], reference(frames[0], W, H, 2, 'linear'), ow, oh);
  assert.ok(bad([{ label: 'one-pass blue', ...cmp }]).length > 0);
});

// the real 4K frames: the exact GPU pixels of three frames (two of projector-ultraviolet, one of projector-cherry), lossless FFV1 at 4K
// from render-video.mjs --size 3840x2160 --ss 1 --seconds 0.1 (see FIXTURES; test-gl/out is untracked)
function decodeFixture(file, idx) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${idx})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64 << 20 });
  if (r.status !== 0 || r.stdout.length !== W * H * 4) throw new Error(`fixture ${file} frame ${idx}: ${r.stderr}`);
  const f = r.stdout; for (let i = 3; i < f.length; i += 4) f[i] = 255;   // bgr0's pad byte is not an alpha
  return f;
}
for (const space of ['linear', 'gamma']) {
  test(`downscale ${space} ss 2: three real 4K frames within 1 code of the box average`, async (t) => {
    if (!FIXTURES.every(existsSync)) return t.skip('no 4K fixtures: for L in ultraviolet cherry; do node test-gl/render-video.mjs --look-json reference-photos-do-not-commit/outside-projection/presets/projector-$L.json --tree --out test-gl/out/video/chain-fixtures/$L --seconds 0.1 --size 3840x2160 --ss 1 --preroll 60 --set bake_resolution=4096 --set tex_resolution=4096 --set sample_count=48 --delivery none; done');
    const ss = 2, ow = W / ss, oh = H / ss;
    const frames = [decodeFixture(FIXTURES[0], 0), decodeFixture(FIXTURES[0], 5), decodeFixture(FIXTURES[1], 3)];
    const outs = await runChain(masterChain({ ow, oh, ss, space, master: 'ffv1' }), frames, W, H, ow, oh);
    const rows = outs.map((o, i) => ({ label: ['uv frame 0', 'uv frame 5', 'cherry frame 3'][i], ...compare(o, reference(frames[i], W, H, ss, space), ow, oh) }));
    console.log(`  real frames, ${space}\n${rows.map((r) => `    ${r.label.padEnd(15)} max ${r.maxErr.toFixed(3)} codes, int ${r.maxErrInt} (R ${r.perChannelMax[0].toFixed(2)} G ${r.perChannelMax[1].toFixed(2)} B ${r.perChannelMax[2].toFixed(2)}), ${(100 * r.over1Frac).toFixed(4)} % of channels over 1 code, ${r.over05} in (0.5, 1]`).join('\n')}`);
    assert.deepEqual(bad(rows), []);
    // the figure the chain's comment and the manifest state for real frames (LINEAR_SS_LIMITS): the float error, 1.065 on the cherry frame
    if (space === 'linear') for (const r of rows) assert.ok(r.maxErr <= lib.LINEAR_SS_LIMITS.ss2_float_real_frames_codes, `${r.label}: float error ${r.maxErr.toFixed(3)} is above the stated ${lib.LINEAR_SS_LIMITS.ss2_float_real_frames_codes}`);
  });
}

// ================================================================ 2. the pairing of measure()
// A clip whose frames are ALL distinct (every consecutive pair differs by tens of codes), made the way the exporter makes its files: raw frames at -framerate 60
// into an FFV1 mkv (the master: a millisecond clock, pts 0,17,33,50,67 ..), then deliveryArgs() into an mp4 (the delivery: 1/15360 s, pts 0,256,512 ..).
// Frame i against frame i is then ~45 dB; frame i against frame i-1 is ~12 dB. The graph that pairs by timestamp (LEGACY_GRAPH) is the control: with MEASURE_LEGACY=1 the
// main tests run it and FAIL; the control tests below assert that it does, so a return to it is caught either way.
// The exporter's master is a SET of segments read through the concat demuxer (seg/list.txt), not one file: every pairing test runs both inputs.
const LEGACY_GRAPH = (lf, sf) => `[0:v]${PLAYER_RGB},format=gbrp[d];[1:v]format=gbrp[m];[d]split[d1][d2];[m]split[m1][m2];[d1][m1]psnr=stats_file=${lf}[p];[d2][m2]ssim=stats_file=${sf}[s]`;
const CW = 128, CH = 72, CN = 120, FPS = 60;
// frame k of a clip: neighbours differ by tens of codes. black: a flat black card, the one picture that survives RGB -> YUV 4:2:0 -> RGB bit-exact.
function distinctFrame(k, w = CW, h = CH, black = false) {
  const f = Buffer.alloc(w * h * 4);
  if (black) { f.fill(Buffer.from([0, 0, 0, 255])); return f; }
  const base = [40 + ((k * 37) % 176), 40 + ((k * 91) % 176), 40 + ((k * 53) % 176)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f.set([base[0] + (x >> 3), base[1] + (y >> 3), base[2] + ((x + y) >> 4), 255], (y * w + x) * 4);
  return f;
}
// the segment flags of render-video.mjs (masterCodecArgs, ffv1)
const SEG_FFV1 = ['-c:v', 'ffv1', '-level', '3', '-coder', '1', '-context', '1', '-g', '1', '-slices', '24', '-slicecrc', '1'];
// frames [k0, k0+n) as ONE lossless segment, made the way the exporter makes it: rgba on stdin, the master chain, passthrough timestamps
function makeSegment(file, k0, n, { w = CW, h = CH, ss = 1, fps = FPS, black = [] } = {}) {
  const rw = w * ss, rh = h * ss, raw = Buffer.concat(Array.from({ length: n }, (_, i) => distinctFrame(k0 + i, rw, rh, black.includes(k0 + i))));
  const mk = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${rw}x${rh}`, '-framerate', String(fps), '-i', '-', '-an', '-vf', masterChain({ ow: w, oh: h, ss, space: 'linear', master: 'ffv1' }), '-fps_mode', 'passthrough', '-frames:v', String(n), ...SEG_FFV1, file], { input: raw });
  assert.equal(mk.status, 0, String(mk.stderr));
}
// the clip as a segment set: seg/seg_NNNNN.mkv + seg/list.txt, and the concat input that reads it
function makeSegmentSet(dir, counts, opts) {
  mkdirSync(join(dir, 'seg'), { recursive: true });
  let k0 = 0;
  const names = counts.map((n, i) => { const name = `seg_${String(i).padStart(5, '0')}.mkv`; makeSegment(join(dir, 'seg', name), k0, n, opts); k0 += n; return name; });
  writeFileSync(join(dir, 'seg', 'list.txt'), concatListText(names));
  return CONCAT_INPUT(join(dir, 'seg', 'list.txt'));
}
const lossyDelivery = (input, out) => {
  const dl = spawnSync(FFMPEG, deliveryArgs({ input, out, fps: FPS, trc: 'bt709', codec: 'libx265', crf: 2, preset: 'ultrafast', gop: 30 }).filter((a) => a !== '-nostats'), { encoding: 'utf8' });
  assert.equal(dl.status, 0, dl.stderr);
};
// A delivery that is lossless IN YUV: the delivery's own filter (matrix, range, 4:2:0) into FFV1 instead of an encoder. Its only loss is the format's.
function yuvLosslessDelivery(input, out) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-an', '-vf', deliveryFilter({ fps: FPS, trc: 'bt709' }), '-r', String(FPS), '-fps_mode', 'cfr', '-c:v', 'ffv1', '-level', '3', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
function makeClip(dir) {
  makeSegment(join(dir, 'master.mkv'), 0, CN);
  lossyDelivery(['-i', join(dir, 'master.mkv')], join(dir, 'delivery.mp4'));
}
const tb = (f) => ffprobeJson(f).streams[0].time_base;
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const withDir = async (fn) => { const dir = mkdtempSync(join(tmpdir(), 'komorebi-video-test-')); try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const legacyGraph = () => (process.env.MEASURE_LEGACY ? LEGACY_GRAPH('psnr.log', 'ssim.log') : undefined);

test('measure: delivery frame i is compared with master frame i (every frame distinct; PSNR floor of the pairing)', () => withDir(async (dir) => {
  makeClip(dir);
  // the clocks really are different (else this test would pass vacuously)
  assert.equal(tb(join(dir, 'master.mkv')), '1/1000');
  assert.notEqual(tb(join(dir, 'delivery.mp4')), `1/${FPS}`);
  const q = await runMeasure({ delivery: join(dir, 'delivery.mp4'), input: ['-i', join(dir, 'master.mkv')], cwd: dir, fps: FPS, graph: legacyGraph() });
  console.log(`  ${process.env.MEASURE_LEGACY ? 'LEGACY graph' : 'index-paired graph'}, one file: ${q.frames_compared} frames, PSNR avg ${q.psnr_rgb_avg_db} min frame ${q.psnr_min_frame_db} dB, SSIM ${q.ssim_rgb_all}`);
  assert.equal(q.frames_compared, CN);
  assert.ok(Number.isFinite(q.psnr_rgb_avg_db) && Number.isFinite(q.ssim_rgb_all) && q.psnr_r_g_b.every(Number.isFinite) && q.ssim_r_g_b.every(Number.isFinite), `summary not parsed: ${JSON.stringify(q)}`);
  assert.ok(q.psnr_min_frame_db > 35, `the worst frame pair is ${q.psnr_min_frame_db} dB: some delivery frames are compared with a neighbouring master frame`);
}));

test('measure on the production input: a 2-segment master through the concat demuxer (seg/list.txt) is paired frame i with frame i', () => withDir(async (dir) => {
  const input = makeSegmentSet(dir, [50, 70]);
  lossyDelivery(input, join(dir, 'delivery.mp4'));
  const q = await runMeasure({ delivery: join(dir, 'delivery.mp4'), input, cwd: dir, fps: FPS, graph: legacyGraph() });
  console.log(`  ${process.env.MEASURE_LEGACY ? 'LEGACY graph' : 'index-paired graph'}, concat of 50 + 70: ${q.frames_compared} frames, PSNR avg ${q.psnr_rgb_avg_db} min frame ${q.psnr_min_frame_db} dB`);
  assert.equal(q.frames_compared, CN);
  assert.ok(q.psnr_min_frame_db > 35, `the worst frame pair is ${q.psnr_min_frame_db} dB: some delivery frames are compared with a neighbouring master frame`);
}));

test('negative control: a graph that pairs by timestamp compares mismatched frames and the same floor catches it', () => withDir(async (dir) => {
  makeClip(dir);
  const q = await runMeasure({ delivery: join(dir, 'delivery.mp4'), input: ['-i', join(dir, 'master.mkv')], cwd: dir, fps: FPS, graph: LEGACY_GRAPH('psnr.log', 'ssim.log') });
  console.log(`  legacy graph: ${q.frames_compared} frames, PSNR avg ${q.psnr_rgb_avg_db} min frame ${q.psnr_min_frame_db} dB`);
  assert.ok(q.psnr_min_frame_db < 20, `legacy pairing should compare mismatched frames, min is ${q.psnr_min_frame_db} dB`);
  // and every third delivery frame is the mismatched one
  const per = readFileSync(join(dir, 'psnr.log'), 'utf8').trim().split('\n').map((l) => Number(/psnr_avg:(\S+)/.exec(l)[1]));
  const low = per.map((v, i) => (v < 20 ? i : -1)).filter((i) => i >= 0);
  assert.ok(low.length >= CN / 3 - 2 && low.length <= CN / 3 + 2, `expected about a third of the frames mismatched, got ${low.length}`);
}));

test('negative control: a timestamp-paired graph on the concat input is caught by the same floor', () => withDir(async (dir) => {
  const input = makeSegmentSet(dir, [50, 70]);
  lossyDelivery(input, join(dir, 'delivery.mp4'));
  const q = await runMeasure({ delivery: join(dir, 'delivery.mp4'), input, cwd: dir, fps: FPS, graph: LEGACY_GRAPH('psnr.log', 'ssim.log') });
  console.log(`  legacy graph, concat: ${q.frames_compared} frames, PSNR avg ${q.psnr_rgb_avg_db} min frame ${q.psnr_min_frame_db} dB`);
  assert.ok(q.psnr_min_frame_db < 20, `legacy pairing of the concat input should compare mismatched frames, min is ${q.psnr_min_frame_db} dB`);
}));

// ---------------------------------------------------------------- frames identical to the master (PSNR inf) are compared frames
const ROW = (n, psnr) => `n:${n} mse_avg:0.00 mse_r:0.00 mse_g:0.00 mse_b:0.00 psnr_avg:${psnr} psnr_r:${psnr} psnr_g:${psnr} psnr_b:${psnr}`;
test('parseMeasure: a row with psnr_avg:inf is a compared frame and never the minimum', () => {
  const q = parseMeasure('', [ROW(1, 'inf'), ROW(2, '45.50'), ROW(3, 'inf'), ROW(4, '47.25')].join('\n'));
  assert.equal(q.frames_compared, 4);
  assert.equal(q.psnr_min_frame_db, 45.5);
  const all = parseMeasure('PSNR r:inf g:inf b:inf average:inf min:inf max:inf\n', [ROW(1, 'inf'), ROW(2, 'inf')].join('\n'));
  assert.equal(all.frames_compared, 2);
  assert.equal(all.psnr_rgb_avg_db, Infinity);
  assert.deepEqual(all.psnr_r_g_b, [Infinity, Infinity, Infinity]);
});

test('measure: black frames through a delivery that is lossless in YUV come back identical (inf) and are still counted', () => withDir(async (dir) => {
  const black = [0, 1, 2, 3, 4, 60, 61, 62];
  makeSegment(join(dir, 'master.mkv'), 0, CN, { black });
  yuvLosslessDelivery(['-i', join(dir, 'master.mkv')], join(dir, 'delivery.mkv'));
  const q = await runMeasure({ delivery: join(dir, 'delivery.mkv'), input: ['-i', join(dir, 'master.mkv')], cwd: dir, fps: FPS });
  const inf = readFileSync(join(dir, 'psnr.log'), 'utf8').trim().split('\n').filter((l) => /psnr_avg:inf/.test(l)).length;
  assert.equal(inf, black.length, 'the black frames should be bit-identical after the round trip');
  assert.equal(q.frames_compared, CN, `${inf} identical frames were dropped from the count`);
  assert.ok(Number.isFinite(q.psnr_min_frame_db), 'the minimum is a real frame, not inf');
}));

// ---------------------------------------------------------------- the encoder-free baseline
test('baseline: the master through the delivery chain with NO encoder equals the measure of a YUV-lossless delivery, and bounds a lossy one from above', () => withDir(async (dir) => {
  makeClip(dir);
  const input = ['-i', join(dir, 'master.mkv')];
  yuvLosslessDelivery(input, join(dir, 'lossless.mkv'));
  const lossy = await runMeasure({ delivery: join(dir, 'delivery.mp4'), input, cwd: dir, fps: FPS });
  const lossless = await runMeasure({ delivery: join(dir, 'lossless.mkv'), input, cwd: dir, fps: FPS, psnrLog: 'psnr-l.log', ssimLog: 'ssim-l.log' });
  const base = await lib.runBaseline({ input, cwd: dir, fps: FPS, trc: 'bt709' });
  console.log(`  format only (no encoder): ${base.psnr_rgb_avg_db} dB, SSIM ${base.ssim_rgb_all}   lossless-YUV delivery: ${lossless.psnr_rgb_avg_db} dB   x265 crf 2: ${lossy.psnr_rgb_avg_db} dB`);
  assert.equal(base.frames_compared, CN);
  for (const k of ['psnr_rgb_avg_db', 'psnr_min_frame_db', 'ssim_rgb_all']) assert.equal(base[k], lossless[k], k);
  assert.deepEqual(base.psnr_r_g_b, lossless.psnr_r_g_b);
  assert.deepEqual(base.ssim_r_g_b, lossless.ssim_r_g_b);
  assert.ok(base.psnr_rgb_avg_db > lossy.psnr_rgb_avg_db, 'a lossy encode cannot beat the format-only ceiling');
}));

test('qualityReport: the delivery numbers, the baseline beside them, and the encoder\'s own loss as the difference', () => {
  const vs = { psnr_rgb_avg_db: 45, ssim_rgb_all: 0.95, frames_compared: 10 }, base = { psnr_rgb_avg_db: 47.5, ssim_rgb_all: 0.97, frames_compared: 10 };
  const q = lib.qualityReport(vs, base);
  assert.equal(q.psnr_rgb_avg_db, 45);
  assert.equal(q.encoder_free_baseline.psnr_rgb_avg_db, 47.5);
  assert.equal(q.encoder_loss.psnr_db, 2.5);
  assert.ok(Math.abs(q.encoder_loss.ssim - 0.02) < 1e-9);
  assert.equal(lib.qualityReport({ ...vs, psnr_rgb_avg_db: 47.5, ssim_rgb_all: 0.97 }, base).encoder_loss.psnr_db, 0, 'a YUV-lossless delivery loses nothing to the encoder');
});

// ================================================================ 3. dark-end error of the linear chain: the figures the code states, measured
// STATED (video-lib.mjs LINEAR_SS_LIMITS, in the masterChain comment and the manifest's known_limits) and held here. They are measurements, not proofs: a bound of
// "at most ~0.93 codes after rounding" does not hold (dark content at ss 2 reaches 1.34 float), and at ss 3 and 4 the integer error reaches 2.
const darkNoise = (seed, m, w, h) => { const f = Buffer.alloc(w * h * 4); let s = seed; for (let i = 0; i < f.length; i += 4) { for (let c = 0; c < 3; c++) { s = (Math.imul(s, 1664525) + 1013904223) | 0; f[i + c] = (s >>> 24) % m; } f[i + 3] = 255; } return f; };
async function darkError(ss, m, { ow = 320, oh = 180, seed = 11 + m } = {}) {
  const w = ow * ss, h = oh * ss, frame = darkNoise(seed, m, w, h);
  const [o] = await runChain(masterChain({ ow, oh, ss, space: 'linear', master: 'ffv1' }), [frame], w, h, ow, oh);
  return compare(o, reference(frame, w, h, ss, 'linear'), ow, oh);
}
test('linear downscale, dark noise: the stated error figures hold (ss 2 within 1 integer code; ss 3 and 4 within 2), and a 0.93 bound does not', async () => {
  const L = lib.LINEAR_SS_LIMITS;
  assert.ok(L, 'video-lib.mjs states no LINEAR_SS_LIMITS');
  const rows = [];
  for (const [ss, m] of [[2, 2], [2, 3], [2, 5], [2, 14], [3, 2], [3, 3], [3, 5], [4, 2], [4, 3], [4, 5]]) rows.push({ ss, m, ...(await darkError(ss, m)) });
  // at ss 4 the 2-code case is rare (1 channel in 2.7 million of this frame): a big frame finds it
  rows.push({ ss: 4, m: 3, big: true, ...(await darkError(4, 3, { ow: 1280, oh: 720, seed: 1 })) });
  console.log(`  dark noise 0..m-1\n${rows.map((r) => `    ss ${r.ss} m ${String(r.m).padEnd(2)} float max ${r.maxErr.toFixed(3)}, integer max ${r.maxErrInt}${r.big ? '  (1280x720 output)' : ''}`).join('\n')}`);
  for (const r of rows.filter((x) => x.ss === 2)) { assert.ok(r.maxErrInt <= L.ss2_int_codes, `ss 2 integer error ${r.maxErrInt}`); assert.ok(r.maxErr <= L.ss2_float_dark_noise_codes, `ss 2 float error ${r.maxErr}`); }
  for (const r of rows.filter((x) => x.ss > 2)) assert.ok(r.maxErrInt <= L.ss34_int_codes, `ss ${r.ss} integer error ${r.maxErrInt}`);
  for (const ss of [3, 4]) assert.ok(rows.some((r) => r.ss === ss && r.maxErrInt === L.ss34_int_codes), `the ss 3-4 figure is reached at ss ${ss}, not just an upper bound`);
  assert.ok(rows.some((r) => r.ss === 2 && r.maxErr > 0.93), 'a "~0.93 after rounding" bound is false at ss 2');
});

// ================================================================ 4. the server's served-hash map pins the page bytes
test('the server records the sha256 of the page bytes it hands out; assertServedPage refuses a page that is not the one the key names', () => withDir(async (dir) => {
  const page = join(dir, 'page'), engine = join(dir, 'engine');
  mkdirSync(page); mkdirSync(engine);
  writeFileSync(join(page, 'video.html'), '<html>one</html>');
  const srv = await startServer({ engineRoot: engine, pageDir: page });
  try {
    const url = `http://127.0.0.1:${srv.port}/video.html`;
    assert.equal(await (await fetch(url)).text(), '<html>one</html>');
    const key = sha256(Buffer.from('<html>one</html>'));
    assert.equal(srv.served.get('/video.html (test-gl)'), key);
    lib.assertServedPage(srv.served, key);   // the page the key names: fine
    writeFileSync(join(page, 'video.html'), '<html>two</html>');   // an edit between two page loads (a retried session reloads the page)
    await (await fetch(url)).text();
    assert.throws(() => lib.assertServedPage(srv.served, key), /video\.html/);
    assert.throws(() => lib.assertServedPage(new Map(), key), /video\.html/, 'a page that was never served is not the key\'s either');
  } finally { srv.server.closeAllConnections?.(); await srv.close(); }
}));

// ================================================================ 5. the exporter as a process, with no browser
// render-video.mjs run with a Playwright browsers path that does not exist, so not even a stray launch can start a Chromium (the pixel harness may be running one).
// --encode-only never launches one; the key tests stop at the first launch, which fails.
const RENDER_VIDEO = join(HERE, 'render-video.mjs');
const NO_BROWSERS = join(tmpdir(), 'komorebi-video-test-no-browsers');
const testEnv = (env) => { const e = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS, ...env }; if (!('ARBORETUM_TOKEN' in env)) delete e.ARBORETUM_TOKEN; return e; };   // a developer's real token never reaches a test
function exporter(args, env = {}) {
  const r = spawnSync(process.execPath, [RENDER_VIDEO, ...args], { encoding: 'utf8', env: testEnv(env), maxBuffer: 64 << 20 });
  return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}
// the same without blocking the event loop, for the tests that serve a mock arboretum from this process
function exporterAsync(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [RENDER_VIDEO, ...args], { env: testEnv(env) });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (status) => resolve({ status, out, err, all: `${out}\n${err}` }));
  });
}
test('the browsers path of these tests does not exist', () => assert.ok(!existsSync(NO_BROWSERS)));

// A finished run folder as render-video.mjs leaves it, built without a browser: 2 lossless segments (1 s each at 30 fps, 128x72 at ss 2 through the real master chain), their jsons and
// hashes, and run-key.json. extras: the fields a current exporter writes beside the key (look, invocation); older folders (uv-2) have none.
const RUN = { fps: 30, ow: 128, oh: 72, ss: 2, counts: [30, 30], segFrames: 30, preroll: 30, overrides: { bake_resolution: 64, sample_count: 8 }, ffmpegVersion: 'ffmpeg version 7.0-fixture', page: 'p'.repeat(64) };
function makeRun(root, over = {}) {
  const o = { ...RUN, ...over }, out = join(root, 'run'), look = join(root, 'look-input.json'), lookBytes = Buffer.from('{"params":{"leaf_size":1}}\n');
  mkdirSync(join(out, 'seg'), { recursive: true }); mkdirSync(join(out, 'ckpt'));
  writeFileSync(look, lookBytes);
  const rw = o.ow * o.ss, rh = o.oh * o.ss;
  let k0 = 0;
  o.counts.forEach((n, i) => {
    const name = `seg_${String(i).padStart(5, '0')}`, file = join(out, 'seg', `${name}.mkv`);
    makeSegment(file, k0, n, { w: o.ow, h: o.oh, ss: o.ss, fps: o.fps });
    const hashes = `${Array.from({ length: n }, (_, k) => `${k0 + k + 1} ${(k0 + k).toString(16).padStart(16, '0')}`).join('\n')}\n`, bytes = readFileSync(file);
    writeFileSync(join(out, 'seg', `${name}.hashes`), hashes);
    writeFileSync(join(out, 'seg', `${name}.json`), JSON.stringify({ segment: i, first_frame: k0, frames: n, pumps: [k0 + 1, k0 + n], bytes_piped: n * rw * rh * 4, packets: n, file_bytes: bytes.length, ...(o.noSegSha ? {} : { file_sha256: sha256(bytes) }), render_wall_ms: 1000, ffmpeg_args: ['-fixture'], hashes_sha256: sha256(Buffer.from(hashes)), minMean: 1, maxMean: 2, ...(o.segExtras ?? {}) }));
    k0 += n;
  });
  const body = {
    engine: { commit: '0'.repeat(40), kind: 'commit', engine_sha256: 'e'.repeat(64) }, exporter: { video_html_sha256: 'a'.repeat(64), render_video_sha256: 'b'.repeat(64), video_lib_sha256: 'c'.repeat(64) },
    os: { kernel_release: '1', product_version: '1', build_version: '1' }, chromium: { playwright: '1', browser: 'chromium-headless-shell', revision: '1', version: '1' },
    look_sha256: o.arboretum ? lib.canonicalSha256(ARB_PARAMS) : sha256(lookBytes), overrides: o.overrides, forced: { adaptive_motion: false, auto_quality: false },
    fps: o.fps, step_ms: lib.stepMsFor(o.fps), t0_ms: lib.T0_MS, size: [o.ow, o.oh], ss: o.ss, ss_space: o.ss === 1 ? 'n/a' : 'linear', preroll_frames: o.preroll, segment_frames: o.segFrames,
    master: 'ffv1', master_chain: masterChain({ ow: o.ow, oh: o.oh, ss: o.ss, space: 'linear', master: 'ffv1' }), chrome: 'shell+angle-metal',
    ...(o.old ? {} : { ffmpeg_version: o.ffmpegVersion }),
    ...(o.arboretum ? { arboretum: arbKey() } : {}),
  };
  const rk = {
    key: sha256(JSON.stringify(body)), body, provenance: { kind: 'commit', commit: '0'.repeat(40), dirty: false, engine_files: {}, engine_sha256: 'e'.repeat(64) },
    ...(o.arboretum ? { look: { path: null, name: arbFetch().name, source: 'arboretum' }, arboretum_fetch: arbFetch() } : {}),
    ...(o.old || o.arboretum ? {} : { look: { path: '/where/the/look/was.json', name: 'was.json' } }),
    ...(o.old ? {} : { invocation: { argv: ['--look-json', 'was.json', '--tree', '--out', 'the-render'], at: '2026-01-01T00:00:00.000Z', node: 'v22' } }),
  };
  writeFileSync(join(out, 'run-key.json'), JSON.stringify(rk, null, 2));
  return { out, look, lookBytes, rk, root };
}
// the flags that describe RUN, as an operator types them; flags: replaces (value) or removes (null) one, '--set': the list
function encodeArgs(f, flags = {}) {
  const all = { '--look-json': f.look, '--out': f.out, '--seconds': '2', '--fps': '30', '--size': '128x72', '--ss': '2', '--ss-space': 'linear', '--segment-seconds': '1', '--preroll': '1', '--delivery': 'none', '--set': ['bake_resolution=64', 'sample_count=8'], ...flags };
  const { '--set': sets, ...rest } = all;
  return ['--encode-only', ...Object.entries(rest).filter(([, v]) => v !== null).flatMap(([k, v]) => (v === true ? [k] : [k, String(v)])), ...sets.flatMap((s) => ['--set', s])];
}
const X265 = { '--delivery': 'libx265', '--x265-preset': 'ultrafast', '--x265-crf': '2', '--gop': '30' };
const run = (fn) => withDir((root) => fn(makeRun(root), root));

// ---------------------------------------------------------------- the manifest is built from run-key.json, and flags that disagree with it are refused
test('encode-only with faithful flags: the manifest describes the run from run-key.json, and keeps the rendering invocation apart from this one', () => run((f) => {
  const r = exporter(encodeArgs(f));
  assert.equal(r.status, 0, r.all);
  const m = readJson(join(f.out, 'manifest.json'));
  assert.equal(m.look.sha256, f.rk.body.look_sha256);
  assert.equal(m.look.path, '/where/the/look/was.json', 'the look path is the one recorded when the run began');
  assert.deepEqual(m.overrides, RUN.overrides);
  assert.equal(m.look_changes_are_quality_only, true);
  assert.match(m.look_statement, /bake_resolution, sample_count/);
  assert.deepEqual([m.output.fps, m.output.size, m.output.render_size, m.output.ss, m.output.frames, m.output.seconds], [30, [128, 72], [256, 144], 2, 60, 2]);
  assert.equal(m.output.ss_downscale.chain, f.rk.body.master_chain);
  assert.equal(m.clock.preroll_frames, 30);
  assert.deepEqual(m.invocation.argv, f.rk.invocation.argv, 'invocation is the one that rendered');
  assert.ok(m.invocation_this_manifest.argv.includes('--encode-only'), 'and this run is recorded beside it');
  assert.equal(m.ffmpeg.master_version, RUN.ffmpegVersion, 'the ffmpeg that made the segments is the key\'s, not this invocation\'s');
  assert.match(m.ffmpeg.version, /^ffmpeg version /);
}));

test('encode-only reads the segments\' own records: ffmpeg version and page hash per segment', () => withDir((root) => {
  const f = makeRun(root, { segExtras: { ffmpeg_version: 'ffmpeg version 7.0-fixture', page_sha256: 'd'.repeat(64) } });
  const r = exporter(encodeArgs(f));
  assert.equal(r.status, 0, r.all);
  const m = readJson(join(f.out, 'manifest.json'));
  assert.deepEqual(m.master.segments.map((s) => [s.ffmpeg_version, s.page_sha256]), [['ffmpeg version 7.0-fixture', 'd'.repeat(64)], ['ffmpeg version 7.0-fixture', 'd'.repeat(64)]]);
}));

test('encode-only on a run key that records no look path, invocation or ffmpeg version: still rebuilt, those fields null, the previous manifest\'s path used only if its sha256 matches', () => withDir((root) => {
  const f = makeRun(root, { old: true });
  writeFileSync(join(f.out, 'manifest.json'), JSON.stringify({ look: { path: '/was/here/look.json', sha256: f.rk.body.look_sha256 } }));
  let r = exporter(encodeArgs(f));
  assert.equal(r.status, 0, r.all);
  let m = readJson(join(f.out, 'manifest.json'));
  assert.equal(m.look.path, '/was/here/look.json');
  assert.equal(m.ffmpeg.master_version, null);
  assert.equal(m.invocation.argv, null, 'the rendering argv was never recorded: say so, do not put this run\'s there');
  writeFileSync(join(f.out, 'manifest.json'), JSON.stringify({ look: { path: '/some/other/look.json', sha256: 'f'.repeat(64) } }));
  r = exporter(encodeArgs(f));
  assert.equal(r.status, 0, r.all);
  m = readJson(join(f.out, 'manifest.json'));
  assert.equal(m.look.path, null, 'a path whose bytes are not the key\'s look is not the look\'s path');
}));

const REFUSALS = [
  ['a look file the run was not made from', (_f, root) => { const other = join(root, 'other-look.json'); writeFileSync(other, '{"params":{"leaf_size":2}}\n'); return { '--look-json': other }; }, /look_sha256/],
  ['a forgotten --set', () => ({ '--set': [] }), /overrides/],
  ['a different --set value', () => ({ '--set': ['bake_resolution=4096', 'sample_count=8'] }), /overrides/],
  ['a different --ss', () => ({ '--ss': '1' }), /\bss\b/],
  ['a different --size', () => ({ '--size': '256x144' }), /size/],
  ['a different --fps', () => ({ '--fps': '60', '--seconds': '1' }), /fps/],
  ['a different --ss-space', () => ({ '--ss-space': 'gamma' }), /ss_space/],
  ['a different --segment-seconds', () => ({ '--segment-seconds': '2' }), /segment_frames/],
  ['a different --preroll', () => ({ '--preroll': '30' }), /preroll_frames/],
  ['a different --master', () => ({ '--master': 'x264rgb' }), /master/],
];
for (const [what, flags, names] of REFUSALS) {
  test(`encode-only refuses ${what} (exit 3, names the difference), and writes nothing`, () => run((f, root) => {
    const r = exporter(encodeArgs(f, flags(f, root)));
    assert.equal(r.status, 3, r.all);
    assert.match(r.err, names);
    assert.ok(!existsSync(join(f.out, 'manifest.json')), 'a manifest that misdescribes the frames was written');
    assert.ok(!existsSync(join(f.out, 'seg', 'list.txt')), 'the master\'s list was rewritten');
  }));
}

test('encode-only refuses a --seconds that is not what the folder holds (a shorter one would rewrite the master\'s list), exit 3', () => run((f) => {
  assert.equal(exporter(encodeArgs(f)).status, 0);
  const list = readFileSync(join(f.out, 'seg', 'list.txt'), 'utf8'), manifest = readFileSync(join(f.out, 'manifest.json'), 'utf8');
  for (const seconds of ['1', '3']) {
    const r = exporter(encodeArgs(f, { '--seconds': seconds }));
    assert.equal(r.status, 3, `--seconds ${seconds}: ${r.all}`);
    assert.match(r.err, /seconds/);
  }
  assert.equal(readFileSync(join(f.out, 'seg', 'list.txt'), 'utf8'), list);
  assert.equal(readFileSync(join(f.out, 'manifest.json'), 'utf8'), manifest);
}));

// ---------------------------------------------------------------- a failed delivery encode leaves nothing that breaks the next run
test('a failed delivery encode leaves no delivery.mp4 (not a 0-byte one), and a later run without a delivery still writes its manifest', () => run((f) => {
  const bad = exporter(encodeArgs(f, { ...X265, '--x265-preset': 'bogus' }));
  assert.notEqual(bad.status, 0, bad.all);
  assert.ok(!existsSync(join(f.out, 'delivery.mp4')), 'a stub delivery.mp4 was left behind');
  assert.ok(!existsSync(join(f.out, 'delivery.mp4.part')), 'the temp file was left behind');
  const ok = exporter(encodeArgs(f, { '--delivery': 'none' }));
  assert.equal(ok.status, 0, ok.all);
  assert.ok(existsSync(join(f.out, 'manifest.json')));
}));

test('a good delivery.mp4 survives a later encode that fails', () => run((f) => {
  const good = exporter(encodeArgs(f, X265));
  assert.equal(good.status, 0, good.all);
  const before = sha256(readFileSync(join(f.out, 'delivery.mp4')));
  const bad = exporter(encodeArgs(f, { ...X265, '--x265-preset': 'bogus' }));
  assert.notEqual(bad.status, 0);
  assert.equal(sha256(readFileSync(join(f.out, 'delivery.mp4'))), before, 'the failed re-encode replaced the good delivery');
}));

test('an unreadable delivery.mp4 (a stub from an older run) does not stop the manifest: it is recorded as unreadable and the accounting is not exact', () => run((f) => {
  writeFileSync(join(f.out, 'delivery.mp4'), '');
  const r = exporter(encodeArgs(f, { '--delivery': 'none' }));
  assert.equal(r.status, 4, r.all);
  const m = readJson(join(f.out, 'manifest.json'));
  assert.ok(m.delivery_probe.error, 'delivery_probe should carry the ffprobe error');
  assert.equal(m.frame_accounting.exact, false);
}));

// ---------------------------------------------------------------- the segment list is relative to itself, so the folder can move
test('seg/list.txt holds names relative to the list: a copy of the folder plays from the copy with the original gone', () => run((f, root) => {
  assert.equal(exporter(encodeArgs(f)).status, 0);
  const lines = readFileSync(join(f.out, 'seg', 'list.txt'), 'utf8').trim().split('\n');
  assert.deepEqual(lines, ["file 'seg_00000.mkv'", "file 'seg_00001.mkv'"]);
  const moved = join(root, 'moved');
  cpSync(f.out, moved, { recursive: true });
  rmSync(f.out, { recursive: true, force: true });
  const list = join(moved, 'seg', 'list.txt');
  const r = lib.runFfmpeg([...CONCAT_INPUT(list), '-map', '0:v:0', '-f', 'null', '-']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lib.countPackets(list, ['-f', 'concat', '-safe', '0']), 60);
}));

// ---------------------------------------------------------------- what the manifest states of the downscale and of the measure
test('the manifest states the linear downscale error as measured (ss 2 within 1 code of the rounded reference, float 1.07 on real frames, ss 3-4 up to 2), not as a bound', () => run((f) => {
  assert.equal(exporter(encodeArgs(f)).status, 0);
  const text = readJson(join(f.out, 'manifest.json')).output.ss_downscale.known_limits.join('\n');
  assert.doesNotMatch(text, /0\.93/, 'the 0.93 bound is false');
  assert.match(text, /1\.07/);
  assert.match(text, /ss 3/);
  assert.match(text, /2 (display )?codes/);
}));

test('--measure: the manifest carries the encoder-free baseline and the encoder\'s own loss beside the delivery numbers, and the accounting covers both measures', () => run((f) => {
  const r = exporter(encodeArgs(f, { ...X265, '--measure': true }));
  assert.equal(r.status, 0, r.all);
  const m = readJson(join(f.out, 'manifest.json')), q = m.quality_vs_master;
  assert.equal(q.frames_compared, 60);
  assert.equal(q.encoder_free_baseline.frames_compared, 60);
  assert.ok(q.encoder_free_baseline.psnr_rgb_avg_db >= q.psnr_rgb_avg_db, 'the baseline is the ceiling');
  assert.ok(Math.abs(q.encoder_loss.psnr_db - (q.encoder_free_baseline.psnr_rgb_avg_db - q.psnr_rgb_avg_db)) < 1e-9);
  assert.equal(m.frame_accounting.baseline_frames_compared, 60);
  assert.ok(existsSync(join(f.out, 'psnr-baseline.log')) && existsSync(join(f.out, 'ssim-baseline.log')));
}));

// ---------------------------------------------------------------- provenance in the run key
const ffmpegLine = () => spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0];
test('the run key records ffmpeg\'s version, and a rerun under another ffmpeg is refused (exit 3, names ffmpeg_version); no Chromium is started', () => withDir((root) => {
  const out = join(root, 'run'), look = join(root, 'look.json');
  writeFileSync(look, '{"params":{"leaf_size":1}}\n');
  const args = ['--look-json', look, '--commit', 'HEAD', '--out', out, '--seconds', '1', '--fps', '30', '--size', '128x72', '--preroll', '1', '--segment-seconds', '1', '--delivery', 'none'];
  const first = exporter(args);   // the key is written, then the first browser launch fails (no browsers path)
  assert.equal(first.status, 1, first.all);
  assert.match(first.all, /Executable doesn't exist/, 'the run should stop at the impossible browser launch');
  const rk = readJson(join(out, 'run-key.json'));
  assert.equal(rk.body.ffmpeg_version, ffmpegLine());
  assert.equal(rk.look.path, look);
  assert.ok(rk.invocation.argv.includes('--commit'));
  const fake = join(root, 'ffmpeg-fake');
  writeFileSync(fake, `#!/bin/sh\nif [ "$1" = "-version" ]; then echo "ffmpeg version 99.0-fake"; exit 0; fi\nexec "${FFMPEG}" "$@"\n`);
  chmodSync(fake, 0o755);
  const second = exporter(args, { FFMPEG: fake });
  assert.equal(second.status, 3, second.all);
  assert.match(second.err, /ffmpeg_version/);
  assert.equal(readJson(join(out, 'run-key.json')).key, rk.key, 'the key is not rewritten');
}));

// ================================================================ 6. the exporter's help, key-first writes, the carried-over measure, the delivery command, segment hashes, --set
const printFfmpeg = (f, flags = {}) => JSON.parse(exporter([...encodeArgs(f, flags), '--print-ffmpeg']).out);

test('--help prints the header usage and exits 0 with no other flag', () => {
  for (const flagName of ['--help', '-h']) {
    const r = exporter([flagName]);
    assert.equal(r.status, 0, r.all);
    for (const must of ['--look-json', '--arboretum', '--encode-only', '--commit']) assert.ok(r.out.includes(must), `${flagName} does not mention ${must}`);
    assert.doesNotMatch(r.out, /^import /m, 'the usage is the header comment, not the source');
  }
});

test('encode-only with no run-key.json refuses (exit 3) before it creates anything: no folder, no seg/, no ckpt/', () => withDir((root) => {
  const look = join(root, 'look.json');
  writeFileSync(look, '{"params":{"leaf_size":1}}\n');
  const missing = join(root, 'never-run'), empty = join(root, 'empty');
  mkdirSync(empty);
  for (const out of [missing, empty]) {
    const r = exporter(['--encode-only', '--look-json', look, '--out', out, '--seconds', '2', '--fps', '30', '--size', '128x72', '--segment-seconds', '1', '--delivery', 'none']);
    assert.equal(r.status, 3, r.all);
    assert.match(r.err, /run-key\.json/);
  }
  assert.ok(!existsSync(missing), 'the refusal created the output folder');
  assert.deepEqual(readdirSync(empty), [], 'the refusal left seg/ or ckpt/ in an empty folder');
}));

test('a refused resume leaves look.json as the run wrote it (the run-key check comes first)', () => withDir((root) => {
  const out = join(root, 'run'), a = join(root, 'a.json'), b = join(root, 'b.json');
  writeFileSync(a, '{"params":{"leaf_size":1}}\n');
  writeFileSync(b, '{"params":{"leaf_size":2}}\n');
  const args = (look) => ['--look-json', look, '--commit', 'HEAD', '--out', out, '--seconds', '1', '--fps', '30', '--size', '128x72', '--preroll', '1', '--segment-seconds', '1', '--delivery', 'none'];
  const first = exporter(args(a));   // the key and look.json are written, then the first browser launch fails (no browsers path)
  assert.equal(first.status, 1, first.all);
  const written = readFileSync(join(out, 'look.json'), 'utf8');
  assert.equal(JSON.parse(written).leaf_size, 1, 'the first run writes look.json');
  const second = exporter(args(b));
  assert.equal(second.status, 3, second.all);
  assert.match(second.err, /look_sha256/);
  assert.equal(readFileSync(join(out, 'look.json'), 'utf8'), written, 'the refused rerun rewrote look.json with the look it was refused for');
}));

test('encode-only without --measure keeps the previous manifest\'s quality_vs_master, baseline included, marked as carried over', () => run((f) => {
  assert.equal(exporter(encodeArgs(f, X265)).status, 0);
  assert.equal(readJson(join(f.out, 'manifest.json')).quality_vs_master, undefined, 'no measure has been made yet');
  assert.equal(exporter(encodeArgs(f, { ...X265, '--measure': true })).status, 0);
  const measured = readJson(join(f.out, 'manifest.json'));
  assert.ok(measured.quality_vs_master.encoder_free_baseline && !measured.quality_vs_master.carried_over);
  const again = exporter(encodeArgs(f, { '--delivery': 'none' }));   // stills / manifest only: the delivery on disk is the one that was measured
  assert.equal(again.status, 0, again.all);
  const m = readJson(join(f.out, 'manifest.json')), q = m.quality_vs_master;
  const { carried_over: _c, ...numbers } = q, { carried_over: _m, ...before } = measured.quality_vs_master;
  assert.deepEqual(numbers, before, 'the carried numbers are the measured ones, untouched');
  assert.equal(q.carried_over.from_manifest_made_at, measured.made_at);
  assert.equal(q.carried_over.delivery_reencoded_since, false);
  assert.equal(m.frame_accounting.exact, true);
  // a delivery encoded by THIS invocation is a different file than the one the numbers describe: the mark says so
  const re = exporter(encodeArgs(f, X265));
  assert.equal(re.status, 0, re.all);
  const q3 = readJson(join(f.out, 'manifest.json')).quality_vs_master;
  assert.equal(q3.carried_over.delivery_reencoded_since, true);
  assert.equal(q3.carried_over.from_manifest_made_at, measured.made_at, 'carried twice, the numbers still date from the manifest that measured them');
}));

test('a carried-over measure keeps saying the delivery was re-encoded since, through a later invocation that encodes nothing', () => run((f) => {
  assert.equal(exporter(encodeArgs(f, { ...X265, '--measure': true })).status, 0);
  assert.equal(exporter(encodeArgs(f, X265)).status, 0);   // a new delivery.mp4: the numbers describe the one before it
  const file = join(f.out, 'manifest.json');
  assert.equal(readJson(file).quality_vs_master.carried_over.delivery_reencoded_since, true);
  const later = exporter(encodeArgs(f, { '--delivery': 'none' }));
  assert.equal(later.status, 0, later.all);
  assert.equal(readJson(file).quality_vs_master.carried_over.delivery_reencoded_since, true, 'the mark was lost by an invocation that did not encode');
}));

test('a measure is carried only into the manifest of the run that made it: a previous manifest under another run key, or under none, carries nothing', () => run((f) => {
  assert.equal(exporter(encodeArgs(f, { ...X265, '--measure': true })).status, 0);
  const file = join(f.out, 'manifest.json'), measured = readJson(file);
  assert.equal(measured.run_key, f.rk.key);
  const { run_key: _k, ...withoutKey } = measured;
  for (const [what, prev] of [['another run key', { ...measured, run_key: 'a-different-run-key-0000' }], ['no run key', withoutKey]]) {
    writeFileSync(file, JSON.stringify(prev));
    const r = exporter(encodeArgs(f, { '--delivery': 'none' }));
    assert.equal(r.status, 0, r.all);
    assert.equal(readJson(file).quality_vs_master, undefined, `numbers measured under ${what} were carried into this run's manifest`);
  }
}));

test('--restart discards the previous run\'s manifest and delivery with its master, so nothing measured on the run it replaces is labelled as the new run\'s', () => run((f, root) => {
  assert.equal(exporter(encodeArgs(f, { ...X265, '--measure': true })).status, 0);
  for (const name of ['manifest.json', 'delivery.mp4']) assert.ok(existsSync(join(f.out, name)), name);
  const other = join(root, 'other-look.json');
  writeFileSync(other, '{"params":{"leaf_size":2}}\n');
  const r = exporter(['--look-json', other, '--commit', 'HEAD', '--out', f.out, '--restart', '--seconds', '1', '--fps', '30', '--size', '128x72', '--preroll', '1', '--segment-seconds', '1', '--delivery', 'none']);
  assert.equal(r.status, 1, r.all);   // the new run begins: its key is written, then the first browser launch fails (no browsers path)
  assert.match(r.all, /Executable doesn't exist/);
  for (const name of ['manifest.json', 'delivery.mp4']) assert.ok(!existsSync(join(f.out, name)), `--restart left ${name}`);
  assert.notEqual(readJson(join(f.out, 'run-key.json')).key, f.rk.key);
}));

test('--set: a key outside the quality knobs is accepted with a warning and the manifest says NOT as authored; the two governors are refused (exit 2)', () => withDir((root) => {
  const f = makeRun(root, { overrides: { bake_resolution: 64, leaf_size: 3 } });
  const r = exporter(encodeArgs(f, { '--set': ['bake_resolution=64', 'leaf_size=3'] }));
  assert.equal(r.status, 0, r.all);
  assert.match(r.err, /WARNING.*leaf_size.*NOT as authored/);
  const m = readJson(join(f.out, 'manifest.json'));
  assert.equal(m.look_changes_are_quality_only, false);
  assert.match(m.look_statement, /^NOT as authored: leaf_size changed/);
  for (const key of ['adaptive_motion', 'auto_quality']) {
    const bad = exporter(encodeArgs(f, { '--set': [`${key}=true`] }));
    assert.equal(bad.status, 2, bad.all);
    assert.match(bad.err, new RegExp(key));
  }
}));

test('the manifest names the final delivery.mp4 the way --print-ffmpeg does; the .part command it really ran is recorded beside it', () => run((f) => {
  const r = exporter(encodeArgs(f, X265));
  assert.equal(r.status, 0, r.all);
  const m = readJson(join(f.out, 'manifest.json')), printed = printFfmpeg(f, X265);
  assert.equal(m.ffmpeg.delivery_command, printed.delivery.join(' '));
  assert.doesNotMatch(m.ffmpeg.delivery_command, /\.part/);
  assert.match(m.ffmpeg.delivery_command, / delivery\.mp4$/);
  assert.match(m.ffmpeg.delivery_command_as_run, / \S*delivery\.mp4\.part$/);
  assert.ok(m.ffmpeg.delivery_command_as_run.includes(join(f.out, 'seg', 'list.txt')), 'the command as run names the real list');
}));

test('segment jsons from before file_sha256: encode-only computes the hashes, records them as computed after the fact (not as the render\'s), and writes SHA256SUMS', () => withDir((root) => {
  const f = makeRun(root, { noSegSha: true });
  const r = exporter(encodeArgs(f));
  assert.equal(r.status, 0, r.all);
  assert.match(r.all, /file_sha256/, 'the console says why the hashes were computed');
  const m = readJson(join(f.out, 'manifest.json'));
  const want = [0, 1].map((i) => sha256(readFileSync(join(f.out, 'seg', `seg_0000${i}.mkv`))));
  assert.deepEqual(m.master.segments.map((s) => s.sha256), want);
  assert.ok(m.master.segments.every((s) => /computed at encode time/.test(s.sha256_origin)), JSON.stringify(m.master.segments.map((s) => s.sha256_origin)));
  assert.match(m.master.sha256_note, /file_sha256/);
  assert.equal(readFileSync(join(f.out, 'seg', 'SHA256SUMS'), 'utf8'), `${want.map((h, i) => `${h}  seg_0000${i}.mkv`).join('\n')}\n`);
}));

test('segment jsons that carry file_sha256 say the hash is the render\'s', () => run((f) => {
  assert.equal(exporter(encodeArgs(f)).status, 0);
  const m = readJson(join(f.out, 'manifest.json'));
  assert.ok(m.master.segments.every((s) => s.sha256_origin === 'segment json (written at render)'));
  assert.equal(m.master.sha256_note, null);
}));

// ================================================================ 7. the USB-safe default
// José plays the file from a FAT32 stick straight into the projector's own player: -q:v 100 gave 157 Mbit/s and 5.9 GB for 5 minutes of a lit look. The default is a
// bitrate with a cap (5 minutes: about 2 GB at 54.5 dB against the q100 file), and a file over FAT32's 4 GiB is warned about, not discovered at the projector.
const VT = (o = {}) => lib.deliveryArgs({ input: ['-i', 'm.mkv'], out: 'o.mp4', fps: 60, trc: 'bt709', codec: 'hevc_videotoolbox', gop: 120, ...o });
test('hevc_videotoolbox at a bitrate: -b:v with a cap of 1.25x and a buffer of 2x (60M is -maxrate 75M -bufsize 120M); -q:v carries neither', () => {
  assert.ok(VT({ vtBitrate: '60M' }).join(' ').includes('-b:v 60M -maxrate 75M -bufsize 120M'));
  assert.ok(VT({ vtBitrate: '40M' }).join(' ').includes('-b:v 40M -maxrate 50M -bufsize 80M'));
  assert.ok(VT({ vtBitrate: '45000k' }).join(' ').includes('-b:v 45000k -maxrate 56250k -bufsize 90000k'));
  assert.ok(VT({ vtBitrate: '60000000' }).join(' ').includes('-b:v 60000000 -maxrate 75000000 -bufsize 120000000'));
  const q = VT({ vtQuality: 100, vtBitrate: '60M' }).join(' ');
  assert.ok(q.includes('-q:v 100') && !/-b:v|-maxrate|-bufsize/.test(q), q);
  assert.throws(() => lib.scaleRate('fast', 1.25), /fast/);
});

test('--print-ffmpeg: the default delivery is hevc_videotoolbox -b:v 60M -maxrate 75M -bufsize 120M; --vt-bitrate scales the cap; --vt-quality stays an explicit choice; a bad rate is refused', () => run((f) => {
  const vt = (flags) => printFfmpeg(f, { '--delivery': null, ...flags }).delivery.join(' ');
  assert.ok(vt({}).includes('-c:v hevc_videotoolbox -b:v 60M -maxrate 75M -bufsize 120M'), vt({}));
  assert.ok(vt({ '--vt-bitrate': '40M' }).includes('-b:v 40M -maxrate 50M -bufsize 80M'));
  const q = vt({ '--vt-quality': '100' });
  assert.ok(q.includes('-q:v 100') && !/-maxrate|-bufsize|-b:v/.test(q), q);
  const bad = exporter([...encodeArgs(f, { '--delivery': null, '--vt-bitrate': 'fast' }), '--print-ffmpeg']);
  assert.equal(bad.status, 2, bad.all);
  assert.match(bad.err, /--vt-bitrate/);
}));

test('estimateDeliveryMbit: the cap for a bitrate delivery, the measured worst case for -q:v (157 Mbit/s), libx265 and none', () => {
  const est = lib.estimateDeliveryMbit;
  assert.equal(est({ codec: 'hevc_videotoolbox', vtBitrate: '60M' }), 75);
  assert.equal(est({ codec: 'hevc_videotoolbox', vtBitrate: '40000k' }), 50);
  assert.ok(est({ codec: 'hevc_videotoolbox', vtQuality: 100, vtBitrate: '60M' }) >= 157);
  assert.equal(est({ codec: 'libx265' }), 40);
  assert.equal(est({ codec: 'none' }), 0);
});

test('--vt-bitrate takes k, K and M; a lowercase m is milli to ffmpeg and is refused with that reason', () => {
  for (const [rate, scaled, mbit] of [['60M', '75M', 60], ['45000k', '56250k', 45], ['45000K', '56250K', 45], ['60000000', '75000000', 60]]) {
    assert.equal(lib.scaleRate(rate, 1.25), scaled, rate);
    assert.equal(lib.mbitOf(rate), mbit, rate);
  }
  for (const rate of ['60m', '0.5m']) {
    assert.throws(() => lib.scaleRate(rate, 1.25), /milli/, rate);
    assert.throws(() => lib.mbitOf(rate), /milli/, rate);
    assert.throws(() => lib.estimateDeliveryMbit({ codec: 'hevc_videotoolbox', vtBitrate: rate }), /milli/, rate);
  }
  assert.throws(() => lib.scaleRate('60G', 1.25), /expected a number/);
});

test('--vt-bitrate 60m is refused by the exporter (exit 2) and the message says why and what to write', () => run((f) => {
  const r = exporter([...encodeArgs(f, { '--delivery': null, '--vt-bitrate': '60m' }), '--print-ffmpeg']);
  assert.equal(r.status, 2, r.all);
  assert.match(r.err, /--vt-bitrate/);
  assert.match(r.err, /milli/);
  assert.match(r.err, /60M/);
}));

test('the free-space line budgets the delivery at its cap: an hour of the default delivery is announced as 31.4 GiB (75 Mbit/s)', () => withDir((root) => {
  const look = join(root, 'look.json');
  writeFileSync(look, '{"params":{"leaf_size":1}}\n');
  const r = exporter(['--look-json', look, '--commit', 'HEAD', '--out', join(root, 'run'), '--seconds', '3600', '--fps', '30', '--size', '128x72', '--preroll', '1']);
  assert.match(r.out, /delivery 31\.4/, r.all);
}));

// What a run really wrote: arboretum preset 3 at 1920x1080, 5 minutes at 60 fps: the segments 12 950 384 474 B (719 466 B a frame, 18 000 frames) beside a delivery-60M.mp4 of 1 968 435 087 B;
// and 717 714 B a frame over a 600-frame smoke.
const MEASURED_5MIN = { segments: 12950384474, delivery: 1968435087 }, MEASURED_SMOKE_SEGMENTS = 430628574;
test('diskPlan: the lossless master is budgeted at what a run measured at 1080p, and scaled by area for another size', () => {
  const plan = (o) => lib.diskPlan({ framesToRender: 18000, frames: 18000, fps: 60, ow: 1920, oh: 1080, merge: false, deliveryMbit: 75, ...o });
  const five = plan({});
  assert.ok(five.segments >= MEASURED_5MIN.segments, `${five.segments} B budgeted, the 5-minute run wrote ${MEASURED_5MIN.segments}`);
  assert.ok(five.segments <= MEASURED_5MIN.segments * 1.1, `${five.segments} B budgeted is more than 10 % over what the run wrote`);
  assert.ok(five.total >= MEASURED_5MIN.segments + MEASURED_5MIN.delivery, 'the peak (segments plus the delivery) is covered');
  const smoke = plan({ framesToRender: 600, frames: 600 });
  assert.ok(smoke.segments >= MEASURED_SMOKE_SEGMENTS && smoke.segments <= MEASURED_SMOKE_SEGMENTS * 1.1, `${smoke.segments}`);
  assert.equal(five.delivery, (300 * 75e6) / 8, 'the delivery is its rate bound over the seconds');
  assert.equal(five.total, five.segments + five.merged + five.delivery + five.margin);
  const uhd = plan({ ow: 3840, oh: 2160, merge: true, deliveryMbit: 0 });
  assert.equal(uhd.segments, 4 * five.segments, 'four times the pixels');
  assert.equal(uhd.merged, uhd.segments, 'a merged master is one more copy of every frame');
  assert.equal(uhd.delivery, 0);
});

test('the free-space line of 5 minutes of 1080p60 announces the measured 12.1 GiB of segments', () => withDir((root) => {
  const look = join(root, 'look.json');
  writeFileSync(look, '{"params":{"leaf_size":1}}\n');
  const r = exporter(['--look-json', look, '--commit', 'HEAD', '--out', join(root, 'run'), '--seconds', '300', '--fps', '60', '--size', '1920x1080', '--preroll', '1']);
  assert.match(r.out, /segments 12\.1,/, r.all);
}));

test('the default delivery is recorded in the manifest as bitrate, cap and buffer; --vt-quality records the quality and none of them (a stand-in for the hardware encoder)', () => run((f, root) => {
  const { fake, calls } = fakeVideoToolbox(root);
  const r = exporter(encodeArgs(f, { '--delivery': 'hevc_videotoolbox', '--gop': '30' }), { FFMPEG: fake });
  assert.equal(r.status, 0, r.all);
  assert.ok(readFileSync(calls, 'utf8').includes('"-b:v","60M","-maxrate","75M","-bufsize","120M"'), 'the ffmpeg that ran was not given the USB-safe default');
  let m = readJson(join(f.out, 'manifest.json'));
  assert.deepEqual([m.delivery.bitrate_arg, m.delivery.maxrate_arg, m.delivery.bufsize_arg, m.delivery.quality_arg], ['60M', '75M', '120M', undefined]);
  assert.ok(m.ffmpeg.delivery_command.includes('-b:v 60M -maxrate 75M -bufsize 120M'));
  const q = exporter(encodeArgs(f, { '--delivery': 'hevc_videotoolbox', '--gop': '30', '--vt-quality': '100' }), { FFMPEG: fake });
  assert.equal(q.status, 0, q.all);
  m = readJson(join(f.out, 'manifest.json'));
  assert.deepEqual([m.delivery.bitrate_arg, m.delivery.maxrate_arg, m.delivery.bufsize_arg, m.delivery.quality_arg], [undefined, undefined, undefined, '100']);
}));
// stands in for ffmpeg where there is no VideoToolbox: logs every call, runs the real ffmpeg with hevc_videotoolbox swapped for ultrafast libx265 and its rate flags dropped
function fakeVideoToolbox(root) {
  const calls = join(root, 'ffmpeg-calls.log'), fake = join(root, 'ffmpeg-vt');
  writeFileSync(fake, `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const a = process.argv.slice(2);
require('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(a) + '\\n');
const out = [];
for (let i = 0; i < a.length; i++) {
  if (a[i] === 'hevc_videotoolbox') out.push('libx265', '-preset', 'ultrafast');
  else if (['-b:v', '-maxrate', '-bufsize', '-q:v'].includes(a[i])) i++;
  else out.push(a[i]);
}
process.exit(spawnSync(${JSON.stringify(FFMPEG)}, out, { stdio: 'inherit' }).status ?? 1);
`);
  chmodSync(fake, 0o755);
  return { fake, calls };
}

test('fat32Report: a file fits up to 4 GiB - 1 byte; over that the report says so, with the size and the average bitrate that would fit', () => {
  const ok = lib.fat32Report(2 ** 32 - 1);
  assert.deepEqual([ok.fits, ok.warning, ok.limit_bytes, ok.size_bytes], [true, undefined, 2 ** 32 - 1, 2 ** 32 - 1]);
  const over = lib.fat32Report(2 ** 32, { seconds: 300 });
  assert.equal(over.fits, false);
  assert.match(over.warning, /FAT32/);
  assert.match(over.warning, /4 GiB/);
  assert.match(over.warning, /114\.5 Mbit\/s/, 'the average bitrate that fits 300 s under the limit');
  assert.equal(lib.fat32Report(2 ** 32).fits, false);
});

test('a delivery over 4 GiB is warned about on stderr and recorded in the manifest; one under it is recorded as fitting (a sparse stand-in for the big file)', () => run((f) => {
  const fd = openSync(join(f.out, 'delivery.mp4'), 'w');
  ftruncateSync(fd, 2 ** 32 + 1);
  closeSync(fd);
  const big = exporter(encodeArgs(f, { '--delivery': 'none' }));
  assert.equal(big.status, 4, big.all);   // the stand-in is not a video, so the frame accounting is not exact: exit 4
  assert.match(big.err, /FAT32/);
  let m = readJson(join(f.out, 'manifest.json'));
  assert.equal(m.delivery_fat32.fits, false);
  assert.equal(m.delivery_fat32.size_bytes, 2 ** 32 + 1);
  assert.match(m.delivery_fat32.warning, /4 GiB/);
  rmSync(join(f.out, 'delivery.mp4'));
  const small = exporter(encodeArgs(f, X265));
  assert.equal(small.status, 0, small.all);
  assert.doesNotMatch(small.err, /FAT32/);
  m = readJson(join(f.out, 'manifest.json'));
  assert.equal(m.delivery_fat32.fits, true);
  assert.equal(m.delivery_fat32.warning, undefined);
}));

test('fat32Forecast: the seconds and the delivery\'s rate bound say before the render whether the file may pass 4 GiB; nothing when it fits or when there is no delivery', () => {
  assert.equal(lib.fat32Forecast({ seconds: 300, mbit: 75 }), null, '2.6 GiB');
  assert.equal(lib.fat32Forecast({ seconds: 1800, mbit: 0 }), null, '--delivery none');
  assert.equal(lib.fat32Forecast({ seconds: 458, mbit: 75 }), null, 'just under the limit');
  const w = lib.fat32Forecast({ seconds: 459, mbit: 75 });
  assert.match(w, /may pass the 4 GiB file limit of a FAT32 stick/, 'a bound, so "may"');
  const long = lib.fat32Forecast({ seconds: 1800, mbit: 75 });
  assert.match(long, /1800 s at up to 75 Mbit\/s is up to 15\.7 GiB/);
  assert.match(long, /19\.0 Mbit\/s or less would fit/);
  assert.match(long, /exFAT/);
});

test('a long run is told before the render that its delivery may pass 4 GiB (stderr, and run.log ahead of the first browser launch); a short run and --delivery none are not', () => withDir((root) => {
  const look = join(root, 'look.json');
  writeFileSync(look, '{"params":{"leaf_size":1}}\n');
  const args = (name, extra) => ['--look-json', look, '--commit', 'HEAD', '--out', join(root, name), '--fps', '30', '--size', '128x72', '--preroll', '1', ...extra];
  const long = exporter(args('long', ['--seconds', '1800']));
  assert.match(long.err, /FAT32/, long.all);
  const log = readFileSync(join(root, 'long', 'run.log'), 'utf8');
  assert.ok(log.includes('FAT32') && log.indexOf('FAT32') < log.indexOf('FAILED'), 'the warning must come before the render, whose first browser launch fails here');
  assert.doesNotMatch(exporter(args('short', ['--seconds', '300'])).err, /FAT32/);
  assert.doesNotMatch(exporter(args('none', ['--seconds', '1800', '--delivery', 'none'])).err, /FAT32/);
}));

// ================================================================ 8. --arboretum <id>[@version][:share_token]
// The look comes from the arboretum's API instead of a file. Every test serves it from a mock in this process (never the network) and runs the exporter without a browser:
// the run key is written, then the first Chromium launch fails. The token and the share token below are test values; what is held is that neither one ever reaches a file
// the exporter writes, a message it prints, or a child process it starts.
// The share token has characters that percent-encode: ?k= carries it as test-share%2F%2B%26%3D..., so a scrub of the raw text alone would let the URL a server echoes through.
const TOKEN = 'test-bearer-0123456789abcdef', SHARE = 'test-share/+&=fedcba9876543210';
const SECRETS = [TOKEN, SHARE, encodeURIComponent(SHARE)];
const holdsSecret = (text) => SECRETS.some((x) => text.includes(x));
const ARB_PUBLIC = 'https://arboretum.eljojo.net';
const ARB_PARAMS = { leaf_size: 2, foliage_density: 2.4, nested: { b: 2, a: 1 } };
// functions, not constants: a library that does not export canonicalSha256 fails these tests one by one, not the file.
// arbKey: what the run key pins of the preset. arbFetch: what is recorded beside it (the preset as last fetched, and how).
const arbKey = () => ({ id: 3, version: 1, params_sha256: lib.canonicalSha256(ARB_PARAMS) });
const arbFetch = () => ({ name: 'projector 3', page_url: `${ARB_PUBLIC}/p/3`, komorebi_commit: 'abc1234', api_base: 'http://mock', requested: '3@1', head_resolved: false, share_token_sha256_prefix: sha256(SHARE).slice(0, 8), fetched_at: '2026-01-01T00:00:00.000Z' });
// The shapes arboretum answers (its llms.txt; read live): the head route names the preset { id, version } and a version route { preset_id, n }, each beside its own other keys.
// The mock builds both from one record, so a client that reads one route's names off the other's answer fails here as it does against the server.
const LIVE_HEAD_KEYS = ['archived', 'created_at', 'description', 'id', 'komorebi_commit', 'name', 'owner', 'params', 'parent', 'share_token', 'tags', 'updated_at', 'version', 'via', 'visibility'];
const LIVE_VERSION_KEYS = ['created_at', 'description', 'komorebi_commit', 'n', 'name', 'params', 'parent', 'preset_id', 'tags', 'via'];
const presetV = (id, version, over = {}) => ({ id, version, name: `projector ${id}`, description: 'a look', tags: ['projector'], komorebi_commit: 'abc1234', parent: null, via: 'web', created_at: 1, params: { leaf_size: 1 + version, foliage_density: 2.4, nested: { b: 2, a: 1 } }, ...over });
const asHead = (r) => ({ id: r.id, owner: 'eljojo', name: r.name, description: r.description, tags: r.tags, version: r.version, komorebi_commit: r.komorebi_commit, parent: r.parent, via: r.via, created_at: r.created_at, updated_at: r.created_at + 1, params: r.params, visibility: 'private', share_token: 'mock-owner-link', archived: false });
const asVersion = (r) => ({ preset_id: r.id, n: r.version, name: r.name, description: r.description, tags: r.tags, params: r.params, komorebi_commit: r.komorebi_commit, parent: r.parent, via: r.via, created_at: r.created_at });
// presets: { '<id>': { <version>: <record> } } (the head is the highest version);  status: { '<id>': <http status> } answers that status, with a body that ECHOES what it was sent (a hostile server);
// raw: { '<id>': { status = 200, text } } answers exactly that text
async function mockArboretum({ presets = {}, status = {}, raw = {} } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), m = /^\/api\/presets\/(\d+)(?:\/versions\/(\d+))?$/.exec(url.pathname);
    requests.push({ path: url.pathname, k: url.searchParams.get('k'), authorization: req.headers.authorization ?? null });
    const send = (code, o, text) => { res.writeHead(code, { 'content-type': text === undefined ? 'application/json' : 'text/plain' }); res.end(text ?? JSON.stringify(o)); };
    if (!m) return send(404, { error: 'not found' });
    if (raw[m[1]]) return send(raw[m[1]].status ?? 200, null, raw[m[1]].text);
    if (status[m[1]]) return send(status[m[1]], { error: `refused (${req.headers.authorization ?? 'no auth'}) (${url.search})` });
    const versions = presets[m[1]];
    if (!versions) return send(404, { error: 'not found' });
    const v = m[2] ? Number(m[2]) : Math.max(...Object.keys(versions).map(Number));
    return versions[v] ? send(200, m[2] ? asVersion(versions[v]) : asHead(versions[v])) : send(404, { error: 'not found' });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { base: `http://127.0.0.1:${server.address().port}`, requests, presets, close: () => { server.closeAllConnections(); return new Promise((ok) => server.close(ok)); } };
}
const withMock = (opts, fn) => async () => { const mock = await mockArboretum(opts); try { return await withDir((root) => fn(mock, root)); } finally { await mock.close(); } };
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const filesHolding = (dir, secrets) => walk(dir).filter((f) => { const b = readFileSync(f); return secrets.some((x) => b.includes(x)); });
const arbArgs = (root, spec, mock, extra = []) => ['--arboretum', spec, '--arboretum-base', mock.base, '--commit', 'HEAD', '--out', join(root, 'run'), '--seconds', '1', '--fps', '30', '--size', '128x72', '--preroll', '1', '--segment-seconds', '1', '--delivery', 'none', ...extra];

test('parseArboretumSpec: <id>[@version][:share_token]; anything else is refused without echoing the share token', () => {
  const ok = [['3', 3, null, null], ['3@2', 3, 2, null], ['3:abc', 3, null, 'abc'], ['3@2:abc', 3, 2, 'abc'], ['12@10:a:b', 12, 10, 'a:b']];
  for (const [spec, id, version, share] of ok) assert.deepEqual(lib.parseArboretumSpec(spec), { id, version, share }, spec);
  for (const spec of ['', 'x', '3@', '3@0', '0', '-3', '3@2@1', '@2', '3:', ' 3', '3.5', '3@x:SECRETSHARE', '0:SECRETSHARE']) {
    assert.throws(() => lib.parseArboretumSpec(spec), (e) => /<id>\[@<version>\]\[:<share_token>\]/.test(e.message) && !e.message.includes('SECRETSHARE'), `[${spec}]`);
  }
});

test('canonicalJson: keys sorted at every depth, arrays kept in order; canonicalSha256 is the hash of those bytes', () => {
  assert.equal(lib.canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(lib.canonicalSha256({ b: 1, a: 2 }), lib.canonicalSha256({ a: 2, b: 1 }));
  assert.equal(lib.canonicalSha256({ a: 2 }), sha256(Buffer.from('{"a":2}')));
});

test('redactArgv: the share token leaves --arboretum\'s value, with a sha256 prefix in its place; every other argument is untouched', () => {
  const prefix = sha256('SECRETSHARE').slice(0, 8);
  assert.deepEqual(lib.redactArgv(['--out', 'x', '--arboretum', '3@2:SECRETSHARE', '--seconds', '10']), ['--out', 'x', '--arboretum', `3@2:<share token omitted, sha256 ${prefix}>`, '--seconds', '10']);
  assert.deepEqual(lib.redactArgv(['--arboretum', '3@2']), ['--arboretum', '3@2']);
  assert.deepEqual(lib.redactArgv(['--look-json', 'a:b']), ['--look-json', 'a:b']);
});

test('the mock answers the key sets arboretum answers: the head names the preset { id, version }, a version { preset_id, n }', withMock({ presets: { 3: { 1: presetV(3, 1) } } }, async (mock) => {
  const get = async (path) => (await fetch(`${mock.base}${path}`)).json();
  assert.deepEqual(Object.keys(await get('/api/presets/3')).sort(), LIVE_HEAD_KEYS);
  assert.deepEqual(Object.keys(await get('/api/presets/3/versions/1')).sort(), LIVE_VERSION_KEYS);
}));

test('fetchArboretum: the head, a version, the share token as ?k=, the bearer only when there is a token; what comes back is the preset', withMock({ presets: { 3: { 1: presetV(3, 1), 2: presetV(3, 2) } } }, async (mock) => {
  const head = await lib.fetchArboretum({ base: mock.base, id: 3 });
  assert.deepEqual([head.id, head.version, head.name, head.komorebi_commit, head.params.leaf_size], [3, 2, 'projector 3', 'abc1234', 3]);
  assert.deepEqual(mock.requests.at(-1), { path: '/api/presets/3', k: null, authorization: null });
  const v1 = await lib.fetchArboretum({ base: `${mock.base}/`, id: 3, version: 1, share: SHARE, token: TOKEN });
  assert.deepEqual([v1.id, v1.version, v1.name, v1.komorebi_commit, v1.params.leaf_size], [3, 1, 'projector 3', 'abc1234', 2]);
  assert.deepEqual(mock.requests.at(-1), { path: '/api/presets/3/versions/1', k: SHARE, authorization: `Bearer ${TOKEN}` });
}));

test('fetchArboretum: a pinned version is one request, to the version route, and never a read of the head first', withMock({ presets: { 3: { 1: presetV(3, 1), 2: presetV(3, 2) } } }, async (mock) => {
  const v1 = await lib.fetchArboretum({ base: mock.base, id: 3, version: 1 });
  assert.equal(v1.version, 1);
  assert.deepEqual(mock.requests.map((r) => r.path), ['/api/presets/3/versions/1']);
}));

test('fetchArboretum: a server that answers another preset or version, or no params, is refused (the pin in the run key must be true)', withMock({ presets: { 3: { 1: presetV(3, 2), 2: presetV(4, 2), 3: presetV(3, 3, { params: null }) } } }, async (mock) => {
  await assert.rejects(lib.fetchArboretum({ base: mock.base, id: 3, version: 1 }), /preset 3@1: .*version 2/);
  await assert.rejects(lib.fetchArboretum({ base: mock.base, id: 3, version: 2 }), /preset 3@2: .*preset 4/);
  await assert.rejects(lib.fetchArboretum({ base: mock.base, id: 3, version: 3 }), /preset 3@3: .*params/);
}));

test('fetchArboretum: 401 / 403 / 404 / 422 are one-line refusals naming the preset, and neither token appears even when the server echoes them', withMock({ presets: {}, status: { 1: 401, 2: 403, 4: 422 } }, async (mock) => {
  for (const [id, code] of [[1, 401], [2, 403], [3, 404], [4, 422]]) {
    await assert.rejects(lib.fetchArboretum({ base: mock.base, id, share: SHARE, token: TOKEN }), (e) => {
      assert.equal(e.refusal, true, `${code} is a refusal`);
      assert.ok(!e.message.includes('\n'), `${code}: not one line`);
      assert.match(e.message, new RegExp(`preset ${id}\\b`));
      assert.ok(e.message.includes(String(code)), e.message);
      assert.ok(!holdsSecret(e.message), `${code}: a secret in "${e.message}"`);
      return true;
    });
  }
  // the ones that are not a refusal: a server error and a server that is not there
  const down = await mockArboretum({ status: { 5: 502 } });
  await assert.rejects(lib.fetchArboretum({ base: down.base, id: 5, share: SHARE, token: TOKEN }), (e) => e.refusal === false && /502/.test(e.message) && !holdsSecret(e.message));
  await down.close();
  await assert.rejects(lib.fetchArboretum({ base: down.base, id: 5, share: SHARE, token: TOKEN }), (e) => e.refusal === false && !e.message.includes('\n') && !holdsSecret(e.message) && /preset 5/.test(e.message));
}));

test('fetchArboretum: a 404 without a token says the preset may be private and ARBORETUM_TOKEN is not set (the server hides a private preset behind a 404); with a token it does not', withMock({ presets: {} }, async (mock) => {
  for (const version of [null, 2]) {
    await assert.rejects(lib.fetchArboretum({ base: mock.base, id: 3, version }), (e) => e.refusal === true && /404/.test(e.message) && /may be private/.test(e.message) && /ARBORETUM_TOKEN is not set/.test(e.message) && !e.message.includes('\n'), `version ${version}`);
  }
  await assert.rejects(lib.fetchArboretum({ base: mock.base, id: 3, token: TOKEN }), (e) => e.refusal === true && /404/.test(e.message) && !/private|not set/.test(e.message));
}));

const scrubRaw = {};   // filled per request by the test below
test('fetchArboretum: a server\'s text is scrubbed of the bearer and the share token before it is shortened, so no fragment survives wherever the cut falls', withMock({ raw: scrubRaw }, async (mock) => {
  const bearer = 'QZ-bearer-9f8e7d6c5b4a', share = 'WX/share+9f8e7d6c5b4a', tokens = [bearer, share];
  let scrubbed = 0;
  for (const order of [[0, 1], [1, 0]]) {
    for (let filler = 100; filler <= 200; filler++) {
      scrubRaw[8] = { status: 422, text: `${'x'.repeat(filler)} ${order.map((i) => tokens[i]).join(' ')} ${'y'.repeat(30)}` };
      const e = await lib.fetchArboretum({ base: mock.base, id: 8, token: bearer, share }).then(() => null, (err) => err);
      assert.ok(e instanceof lib.ArboretumError, `filler ${filler}`);
      for (const t of tokens) for (let n = 1; n <= t.length; n++) assert.ok(!e.message.includes(t.slice(0, n)), `filler ${filler}: the first ${n} characters of a secret survived in "${e.message}"`);
      if (e.message.includes('[redacted]')) scrubbed++;
    }
  }
  assert.ok(scrubbed > 0, 'the scrub never ran');
}));

test('fetchArboretum: a 200 whose body is not an object (null, a number, an array, not JSON) is the one-line ArboretumError, not a TypeError', withMock({ raw: { 1: { text: 'null' }, 2: { text: '3' }, 4: { text: '[]' }, 5: { text: 'not json' } } }, async (mock) => {
  for (const id of [1, 2, 4, 5]) {
    await assert.rejects(lib.fetchArboretum({ base: mock.base, id }), (e) => e instanceof lib.ArboretumError && e.refusal === false && !e.message.includes('\n') && new RegExp(`preset ${id}\\b`).test(e.message), `preset ${id}`);
  }
}));

test('isBearerSafeBase: https anywhere; http only to the host localhost or 127.0.0.1, not to a name that merely starts or ends with it', () => {
  for (const base of ['https://arboretum.eljojo.net', 'https://mirror.example/api', 'http://127.0.0.1:8080', 'http://localhost:3000/', 'http://localhost']) assert.equal(lib.isBearerSafeBase(base), true, base);
  for (const base of ['http://arboretum.eljojo.net', 'http://10.4.10.206:8080', 'http://0.0.0.0:1', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'http://evil.example/127.0.0.1', 'http://127.0.0.1@evil.example', 'ftp://127.0.0.1', 'arboretum.eljojo.net', '']) assert.equal(lib.isBearerSafeBase(base), false, base);
});

test('fetchArboretum: the bearer token is never sent to an http base that is not localhost: the call is refused before any request leaves', withMock({ presets: { 3: { 1: presetV(3, 1) } } }, async (mock) => {
  const lan = mock.base.replace('127.0.0.1', '0.0.0.0');   // reaches this mock, but names no loopback host
  await assert.rejects(lib.fetchArboretum({ base: lan, id: 3, token: TOKEN }), (e) => e instanceof lib.ArboretumError && e.refusal === true && /https/.test(e.message) && !holdsSecret(e.message) && !e.message.includes('\n'));
  assert.deepEqual(mock.requests, [], 'a request left with the bearer on it');
}));

test('--arboretum and --look-json are exclusive, and one of them is required (exit 2); a malformed spec is refused without echoing the share token', () => withDir((root) => {
  const look = join(root, 'l.json');
  writeFileSync(look, '{}\n');
  const base = ['--out', join(root, 'run'), '--commit', 'HEAD'];
  for (const args of [[...base], [...base, '--look-json', look, '--arboretum', '3']]) {
    const r = exporter(args);
    assert.equal(r.status, 2, r.all);
    assert.match(r.err, /--look-json/);
    assert.match(r.err, /--arboretum/);
  }
  const bad = exporter([...base, '--arboretum', '3@0:SECRETSHARE']);
  assert.equal(bad.status, 2, bad.all);
  assert.ok(!bad.all.includes('SECRETSHARE'));
  assert.ok(!existsSync(join(root, 'run')));
}));

test('--arboretum: the head is fetched once and pinned in the run key; the look is its params; the preset is recorded, the tokens are not; a moved head refuses a resume, a pinned version resumes', withMock({ presets: { 3: { 1: presetV(3, 1), 2: presetV(3, 2) } } }, async (mock, root) => {
  const args = arbArgs(root, `3:${SHARE}`, mock), out = join(root, 'run');
  const first = await exporterAsync(args, { ARBORETUM_TOKEN: TOKEN });
  assert.equal(first.status, 1, first.all);   // the key and look.json are written, then the first browser launch fails (no browsers path)
  assert.match(first.all, /Executable doesn't exist/);
  assert.deepEqual(mock.requests, [{ path: '/api/presets/3', k: SHARE, authorization: `Bearer ${TOKEN}` }], 'one fetch: the head');
  const rk = readJson(join(out, 'run-key.json')), params = presetV(3, 2).params, sha = lib.canonicalSha256(params);
  assert.deepEqual(rk.body.arboretum, { id: 3, version: 2, params_sha256: sha }, 'the key pins what decides the frames');
  assert.equal(rk.body.look_sha256, sha, 'the look IS the preset\'s params');
  assert.deepEqual(rk.arboretum_fetch, { name: 'projector 3', page_url: `${ARB_PUBLIC}/p/3`, komorebi_commit: 'abc1234', api_base: mock.base, requested: '3', head_resolved: true, share_token_sha256_prefix: sha256(SHARE).slice(0, 8), fetched_at: rk.arboretum_fetch.fetched_at });
  assert.equal(rk.look.source, 'arboretum');
  assert.equal(rk.look.path, null);
  const argvAt = rk.invocation.argv.indexOf('--arboretum');
  assert.equal(rk.invocation.argv[argvAt + 1], `3:<share token omitted, sha256 ${sha256(SHARE).slice(0, 8)}>`);
  assert.deepEqual(readJson(join(out, 'look.json')), { ...params, adaptive_motion: false, auto_quality: false });
  const lookBefore = readFileSync(join(out, 'look.json'), 'utf8');

  mock.presets[3][3] = presetV(3, 3);   // the preset moves on
  const moved = await exporterAsync(args, { ARBORETUM_TOKEN: TOKEN });
  assert.equal(moved.status, 3, moved.all);
  assert.match(moved.err, /moved on/);
  assert.match(moved.err, /3@2/);
  assert.match(moved.err, /3@3/);
  assert.match(moved.err, /arboretum/);
  assert.equal(readFileSync(join(out, 'look.json'), 'utf8'), lookBefore, 'a refused resume leaves look.json alone');

  const pinned = await exporterAsync(arbArgs(root, `3@2:${SHARE}`, mock), { ARBORETUM_TOKEN: TOKEN });
  assert.equal(pinned.status, 1, pinned.all);   // past the key check: stopped by the missing browser again
  assert.match(pinned.all, /Executable doesn't exist/);
  assert.equal(mock.requests.at(-1).path, '/api/presets/3/versions/2');
  assert.equal(readJson(join(out, 'run-key.json')).key, rk.key, 'the key is not rewritten');

  const leaked = filesHolding(root, SECRETS);
  assert.deepEqual(leaked, [], 'a secret reached a file');
  for (const r of [first, moved, pinned]) assert.ok(!holdsSecret(r.all), 'a secret reached the console');
}));

test('--arboretum 3@1: a pinned version is fetched from the version route alone, pinned in the key, and recorded as not resolved from the head', withMock({ presets: { 3: { 1: presetV(3, 1), 2: presetV(3, 2) } } }, async (mock, root) => {
  const r = await exporterAsync(arbArgs(root, '3@1', mock));
  assert.equal(r.status, 1, r.all);   // the key is written, then the first browser launch fails (no browsers path)
  assert.match(r.all, /Executable doesn't exist/);
  assert.deepEqual(mock.requests.map((q) => q.path), ['/api/presets/3/versions/1']);
  const rk = readJson(join(root, 'run', 'run-key.json'));
  assert.deepEqual([rk.body.arboretum.id, rk.body.arboretum.version, rk.arboretum_fetch.requested, rk.arboretum_fetch.head_resolved], [3, 1, '3@1', false]);
  assert.equal(rk.body.look_sha256, lib.canonicalSha256(presetV(3, 1).params));
}));

test('--arboretum: a rename or a commit stamp on the same version moves no frame and refuses no resume; the record follows it; other params under the same version are refused', withMock({ presets: { 3: { 1: presetV(3, 1), 2: presetV(3, 2) } } }, async (mock, root) => {
  const out = join(root, 'run');
  const first = await exporterAsync(arbArgs(root, '3@2', mock));
  assert.equal(first.status, 1, first.all);
  const rk = readJson(join(out, 'run-key.json'));
  mock.presets[3][2] = presetV(3, 2, { name: 'renamed', komorebi_commit: 'fedcba9' });   // the same version, the same params
  for (const spec of ['3@2', '3']) {
    const r = await exporterAsync(arbArgs(root, spec, mock));
    assert.equal(r.status, 1, `${spec}: ${r.all}`);
    assert.match(r.all, /Executable doesn't exist/, `${spec}: the key check must pass`);
  }
  const after = readJson(join(out, 'run-key.json'));
  assert.equal(after.key, rk.key, 'the key is not rewritten');
  assert.deepEqual(Object.keys(rk.body.arboretum).sort(), ['id', 'params_sha256', 'version'], 'the key holds what decides the frames and nothing they do not show');
  assert.deepEqual([after.arboretum_fetch.name, after.arboretum_fetch.komorebi_commit, after.look.name], ['renamed', 'fedcba9', 'renamed'], 'what is recorded of the preset follows it');
  mock.presets[3][2] = presetV(3, 2, { params: { leaf_size: 99 } });
  const changed = await exporterAsync(arbArgs(root, '3@2', mock));
  assert.equal(changed.status, 3, changed.all);
  assert.match(changed.err, /params_sha256/);
}));

test('--arboretum: a refusal (401 / 403 / 404 / 422) is one stderr line that names the preset, exit 3, nothing created, and no secret even when the server echoes it', withMock({ presets: {}, status: { 1: 401, 2: 403, 4: 422 } }, async (mock, root) => {
  for (const id of [1, 2, 3, 4]) {
    const r = await exporterAsync(arbArgs(root, `${id}:${SHARE}`, mock), { ARBORETUM_TOKEN: TOKEN });
    assert.equal(r.status, 3, r.all);
    assert.equal(r.err.trim().split('\n').length, 1, r.err);
    assert.match(r.err, new RegExp(`arboretum preset ${id}\\b`));
    assert.ok(!holdsSecret(r.all), r.all);
  }
  assert.ok(!existsSync(join(root, 'run')), 'a refused fetch created the output folder');
}));

test('--arboretum: without ARBORETUM_TOKEN a 404 says the preset may be private and the token is not set', withMock({ presets: {} }, async (mock, root) => {
  const r = await exporterAsync(arbArgs(root, '3', mock));
  assert.equal(r.status, 3, r.all);
  assert.match(r.err, /arboretum preset 3: 404/);
  assert.match(r.err, /may be private/);
  assert.match(r.err, /ARBORETUM_TOKEN is not set/);
}));

test('--arboretum: a server that answers null is one stderr line and exit 1, no stack trace, nothing created', withMock({ raw: { 7: { text: 'null' } } }, async (mock, root) => {
  const r = await exporterAsync(arbArgs(root, '7', mock));
  assert.equal(r.status, 1, r.all);
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
  assert.match(r.err, /^render-video: arboretum preset 7: /);
  assert.ok(!existsSync(join(root, 'run')));
}));

test('--arboretum-base: with ARBORETUM_TOKEN set, an http base that is not localhost is refused (exit 3, one line) before any request, and nothing is created', withMock({ presets: { 3: { 1: presetV(3, 1) } } }, async (mock, root) => {
  const lan = { base: mock.base.replace('127.0.0.1', '0.0.0.0') };
  const r = await exporterAsync(arbArgs(root, '3', lan), { ARBORETUM_TOKEN: TOKEN });
  assert.equal(r.status, 3, r.all);
  assert.equal(r.err.trim().split('\n').length, 1, r.err);
  assert.match(r.err, /https/);
  assert.ok(!holdsSecret(r.all), r.all);
  assert.deepEqual(mock.requests, [], 'a request left with the bearer on it');
  assert.ok(!existsSync(join(root, 'run')));
}));

test('--arboretum --encode-only needs no network: the flags are checked against the run key\'s preset, and the manifest carries the preset block, never the tokens', () => withDir((root) => {
  const f = makeRun(root, { arboretum: true });
  const dead = ['--arboretum-base', 'http://127.0.0.1:1'];   // nothing listens there: a fetch would fail
  const flags = { '--look-json': null, '--arboretum': `3@1:${SHARE}` };
  const r = exporter([...encodeArgs(f, flags), ...dead], { ARBORETUM_TOKEN: TOKEN });
  assert.equal(r.status, 0, r.all);
  const m = readJson(join(f.out, 'manifest.json'));
  assert.deepEqual(m.arboretum, { ...arbKey(), ...arbFetch() });
  assert.equal(m.look.sha256, arbKey().params_sha256);
  assert.equal(m.look.source, 'arboretum');
  assert.equal(m.look.name, 'projector 3');
  assert.deepEqual(filesHolding(root, SECRETS), []);
  // the flags must describe the run's preset
  for (const [what, spec, want] of [['another preset', '4', /arboretum/], ['another version', '3@2', /arboretum/]]) {
    const bad = exporter([...encodeArgs(f, { ...flags, '--arboretum': spec }), ...dead]);
    assert.equal(bad.status, 3, `${what}: ${bad.all}`);
    assert.match(bad.err, want);
  }
  const head = exporter([...encodeArgs(f, { ...flags, '--arboretum': '3' }), ...dead]);   // no version: the key's pin
  assert.equal(head.status, 0, head.all);
  // a look file is not the preset's params
  const file = exporter(encodeArgs(f));
  assert.equal(file.status, 3, file.all);
  assert.match(file.err, /look_sha256/);
  // and a preset flag on a run made from a look file
  const other = makeRun(join(root, 'other'));
  const wrong = exporter([...encodeArgs(other, { '--look-json': null, '--arboretum': '3@1' }), ...dead]);
  assert.equal(wrong.status, 3, wrong.all);
  assert.match(wrong.err, /arboretum/);
}));

test('ARBORETUM_TOKEN is not handed to any child process (ffmpeg, git, Chromium inherit the environment)', () => withDir((root) => {
  const f = makeRun(root), dump = join(root, 'env.json'), fake = join(root, 'ffmpeg-env');
  writeFileSync(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env));\nprocess.exit(require('node:child_process').spawnSync(${JSON.stringify(FFMPEG)}, process.argv.slice(2), { stdio: 'inherit' }).status ?? 1);\n`);
  chmodSync(fake, 0o755);
  const r = exporter(encodeArgs(f), { ARBORETUM_TOKEN: TOKEN, FFMPEG: fake });
  assert.equal(r.status, 0, r.all);
  assert.ok(existsSync(dump), 'the stand-in ffmpeg was never started');
  assert.ok(!readFileSync(dump, 'utf8').includes(TOKEN), 'the token reached a child process');
}));
