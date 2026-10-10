// The GPU probe: does Metal come up in headless Chromium, are its pixels repeatable, what does a frame cost, how fast is the pipe.
// A sibling of run.js that touches nothing of it. `node test-gl/gpu-probe.mjs [stage...] [--look <json>] [--cherry <json>] [--tree|--commit <sha>]`
//   stages: glinfo | determinism | timing | swiftshader | sink      (default: all, in that order)
// Writes test-gl/out/video/probe/<stage>.json beside a probe.log, so a later stage (or a later session) reads the earlier stages' answers.
// One Chromium at a time, always closed before the next launch.
import { chromium } from 'playwright';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import {
  GPU_VARIANTS, REPO, T0_MS, browserFacts, exportEngine, fmt, launchBrowser, openPage, spawnFfmpeg, startServer, stats, stepMsFor, subStepHistogram, pipeRequestTo,
} from './video-lib.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PRESET_DIR = '/Users/jojo/code/komorebi/reference-photos-do-not-commit/outside-projection/presets';
const CHERRY = flag('--cherry', join(PRESET_DIR, 'projector-cherry.json'));
const ULTRA = flag('--look', join(PRESET_DIR, 'projector-ultraviolet.json'));
const OUT = resolve(flag('--out', join(REPO, 'test-gl/out/video/probe')));
mkdirSync(OUT, { recursive: true });
const STAGES = argv.filter((a) => ['glinfo', 'determinism', 'timing', 'swiftshader', 'sink'].includes(a));
const want = (s) => !STAGES.length || STAGES.includes(s);
const FPS = 60, STEP = stepMsFor(FPS);

const logFile = join(OUT, 'probe.log');
const log = (...a) => { const line = a.join(' '); console.log(line); appendFileSync(logFile, `${line}\n`); };
const save = (name, obj) => writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
const load = (name) => (existsSync(join(OUT, `${name}.json`)) ? JSON.parse(readFileSync(join(OUT, `${name}.json`), 'utf8')) : null);
const loadLook = (p) => { const j = JSON.parse(readFileSync(p, 'utf8')); return j.params || j; };
const loadAvg = () => os.loadavg().map((x) => x.toFixed(1)).join(' ');

// the engine this probe measures: a snapshot of the working tree (brief 18's dirt included, recorded) unless --commit says otherwise
const exp = exportEngine(flag('--commit') ? { commit: flag('--commit') } : { tree: true });
const srv = await startServer({ engineRoot: exp.dir });
log(`\n=== gpu-probe ${new Date().toISOString()}  engine: ${exp.provenance.kind} ${exp.provenance.commit.slice(0, 7)}${exp.provenance.dirty ? ` (dirty, diff sha256 ${exp.provenance.diff_sha256.slice(0, 12)})` : ''}  load ${loadAvg()}  ${os.cpus()[0].model}`);

async function withBrowser(variant, fn) {
  const b = await launchBrowser(chromium, variant);
  try { return await fn(b); } finally { await b.browser.close(); }
}
const isMetal = (r) => /metal/i.test(r || '') && !/swiftshader/i.test(r || '');

// ============================================================ 1. glinfo
async function stageGlinfo() {
  log('\n--- 1. which binaries bring Metal up (headless), and the limits');
  const rows = [];
  for (const variant of Object.keys(GPU_VARIANTS).filter((v) => v !== 'swiftshader')) {
    const row = { variant, args: GPU_VARIANTS[variant].args, channel: GPU_VARIANTS[variant].channel || 'chromium_headless_shell' };
    try {
      await withBrowser(variant, async (b) => {
        const page = await openPage(b.browser, srv.port);
        row.info = await page.evaluate(() => window.__v.glinfo());
        row.facts = await browserFacts(b.browser);
        row.browser = b.browser.version();
        row.pageLog = page.pageLog.slice(0, 5);
      });
    } catch (e) { row.error = String(e.message || e).split('\n')[0]; }
    row.metal = isMetal(row.info?.renderer);
    rows.push(row);
    const i = row.info || {};
    log(`${variant.padEnd(34)} metal=${row.metal ? 'YES' : 'NO '}  renderer: ${i.renderer ?? row.error}`);
    if (i.webgl2) {
      log(`${''.padEnd(34)} EXT_color_buffer_float=${i.colorBufferFloat}  EXT_float_blend=${i.floatBlend}  half=${i.colorBufferHalfFloat}  timer=${i.timerQuery}  MAX_TEXTURE=${i.maxTexture}  MAX_RENDERBUFFER=${i.maxRenderbuffer}  MAX_VIEWPORT=${i.maxViewport}`);
      log(`${''.padEnd(34)} 3840x2160 drawing buffer ${i.drawingBuffer4k}  sizes ${JSON.stringify(i.drawingBuffers)}  RGBA16F FBO ${JSON.stringify(i.fboRGBA16F)}  dpr ${i.dpr}`);
      const gf = row.facts?.gpu?.featureStatus;
      if (gf) log(`${''.padEnd(34)} featureStatus: ${JSON.stringify(gf)}`);
      log(`${''.padEnd(34)} browser ${row.browser}`);
    }
  }
  save('glinfo', rows);
  return rows;
}

// ============================================================ helpers for the render stages
const baseParams = (lookPath, over = {}) => ({ ...loadLook(lookPath), ...over, adaptive_motion: false, auto_quality: false });

// one engine on a fresh page: [cheap or real pre-roll] then `frames` frames, hashed (and optionally timed)
async function renderRun(page, { look, over, rw, rh, preroll, mode, frames, timing, capture = true, state = null, at = null }) {
  const params = baseParams(look, over);
  const info = {};
  let st = state, atPump = at;
  const t0 = Date.now();
  if (mode === 'cheap') {
    const r = await page.evaluate(([p, n, s, T]) => window.__v.cheapPreroll(p, n, s, T), [params, preroll, STEP, T0_MS]);
    st = r.state; atPump = preroll; info.cheap = r.info;
  }
  info.prerollMs = Date.now() - t0;
  const open = await page.evaluate((o) => window.__v.open(o), { params, rw, rh, step: STEP, T0: T0_MS, at: mode === 'real' ? 0 : atPump, state: mode === 'real' ? null : st });
  info.open = open;
  const t1 = Date.now();
  let from = mode === 'real' ? 0 : atPump;
  if (mode === 'real') {   // the plain way: every pre-roll frame is a full-size frame, nothing read
    await page.evaluate(([f, t]) => window.__v.run({ from: f, to: t, capture: false }), [0, preroll]);
    from = preroll;
    info.prerollMs = Date.now() - t1;
  }
  const t2 = Date.now();
  const r = await page.evaluate(([f, t, tm, cap]) => window.__v.run({ from: f, to: t, timing: tm, capture: cap, batch: 1 }), [from, from + frames, !!timing, capture]);
  info.runMs = Date.now() - t2;
  info.at = from;
  await page.evaluate(() => window.__v.close());
  return { ...r, info };
}
const sameHashes = (a, b) => a.length === b.length && a.every((h, i) => h === b[i]);
const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; };

// ============================================================ 2. determinism
async function stageDeterminism(binary) {
  log(`\n--- 2. determinism on ${binary}: projector-cherry, 1920x1080, bake 1024, 32 samples, adaptive_motion/auto_quality off`);
  const PRE = 1800, N = 600;
  const hist = { naive: subStepHistogram(FPS, 216000, { naive: true }), dyadic: subStepHistogram(FPS, 216000, { naive: false }) };
  log(`sub-step count ceil(dt/(1/120)) over 216000 frames   n*1000/60 stamps: ${JSON.stringify(hist.naive)}   dyadic step ${STEP} ms (${fmt(1000 / STEP, 6)} fps): ${JSON.stringify(hist.dyadic)}`);
  const res = { binary, step_ms: STEP, hist, runs: {} };
  const spec = { look: CHERRY, over: {}, rw: 1920, rh: 1080, preroll: PRE, frames: N };
  // A and B: two fresh pages in one launch; C: a fresh launch; D: cheap pre-roll + restore (the CPU state, no full-size warm-up)
  await withBrowser(binary, async (b) => {
    for (const name of ['A', 'B']) {
      const page = await openPage(b.browser, srv.port);
      const t = Date.now();
      res.runs[name] = await renderRun(page, { ...spec, mode: 'real' });
      log(`run ${name} (fresh page, real pre-roll ${PRE} frames): ${fmt((Date.now() - t) / 1000)} s, ${N} hashes, min/max sparse mean ${fmt(res.runs[name].minMean, 2)}/${fmt(res.runs[name].maxMean, 2)}  renderer ${res.runs[name].info.open.renderer}`);
      await page.close();
    }
    const page = await openPage(b.browser, srv.port);
    res.runs.D = await renderRun(page, { ...spec, mode: 'cheap' });
    log(`run D (cheap pre-roll ${PRE} frames on a 64x36 engine in ${res.runs.D.info.prerollMs} ms, state restored into the real engine): ${N} hashes`);
    // E: resume at frame 300 from run A's... the state at 300 comes from a cheap pre-roll to PRE+300, restored into a fresh engine, 60 frames
    const cp = await page.evaluate(([p, n, s, T]) => window.__v.cheapPreroll(p, n, s, T), [baseParams(CHERRY), PRE + 300, STEP, T0_MS]);
    res.runs.E = await renderRun(page, { ...spec, mode: 'state', state: cp.state, at: PRE + 300, frames: 60 });
    await page.close();
  });
  await withBrowser(binary, async (b) => {
    const page = await openPage(b.browser, srv.port);
    const t = Date.now();
    res.runs.C = await renderRun(page, { ...spec, mode: 'real' });
    log(`run C (fresh browser launch, real pre-roll): ${fmt((Date.now() - t) / 1000)} s`);
    await page.close();
  });
  const H = (k) => res.runs[k].hashes;
  const cmp = (x, y, a = H(x), b = H(y)) => ({ pair: `${x} vs ${y}`, equal: sameHashes(a, b), frames: a.length, first_diff: firstDiff(a, b) });
  res.compare = [cmp('A', 'B'), cmp('A', 'C'), cmp('A', 'D'), cmp('A', 'E', H('A').slice(300, 360), H('E'))];
  for (const c of res.compare) log(`  ${c.pair.padEnd(8)} ${c.equal ? 'IDENTICAL' : `DIFFER (first at frame ${c.first_diff})`}  (${c.frames} frame hashes)`);
  const distinct = new Set(H('A')).size;
  log(`  distinct frames in A: ${distinct}/${N} (a still image would give 1)   A[0]=${H('A')[0]} A[299]=${H('A')[299]} A[599]=${H('A')[599]}`);
  res.distinct = distinct;
  res.verdict = res.compare.every((c) => c.equal) && distinct > N * 0.9 ? 'DETERMINISTIC' : 'NOT DETERMINISTIC';
  log(`  verdict: ${res.verdict}`);
  for (const k of Object.keys(res.runs)) { res.runs[k] = { info: res.runs[k].info, hashes: res.runs[k].hashes, minMean: res.runs[k].minMean, maxMean: res.runs[k].maxMean }; }
  save('determinism', res);
  return res;
}

// ============================================================ 3. timing matrix
// gl.finish() and a polled fence do not wait inside one task in Chromium, so the split is: pump = the engine's JS up to onFrame (it queues
// GL commands); read1 = the first readPixels (the GPU's remaining work + the copy); copy = an immediate second readPixels (the copy alone);
// GPU wait = read1 - copy. total = pump + read1. busy = EXT_disjoint_timer_query_webgl2 over the frame's commands, collected after the run.
async function stageTiming(binary) {
  log(`\n--- 3. ms per frame on ${binary}: look ${ULTRA.split('/').pop()}, load at start ${loadAvg()}`);
  const rows = [];
  const lookName = (p) => p.split('/').pop();
  const matrix = [];
  for (const [rw, rh] of [[1920, 1080], [3840, 2160]]) for (const bake of [1024, 2048, 4096]) for (const samples of [32, 48]) matrix.push({ rw, rh, bake, samples });
  await withBrowser(binary, async (b) => {
    const page = await openPage(b.browser, srv.port);
    for (const m of matrix) {
      const over = { bake_resolution: m.bake, tex_resolution: m.bake, sample_count: m.samples };
      const warm = 10, n = m.bake >= 4096 ? 30 : 50;
      const t = Date.now();
      try {
        const r = await renderRun(page, { look: ULTRA, over, rw: m.rw, rh: m.rh, preroll: 300, mode: 'cheap', frames: warm + n, timing: true });
        const cut = (a) => a.slice(warm);
        const row = {
          ...m, look: lookName(ULTRA), load: loadAvg(), frames: n,
          pump: stats(cut(r.timing.pump)), read1: stats(cut(r.timing.read1)), copy: stats(cut(r.timing.copy)), total: stats(cut(r.timing.total)),
          busy: stats(cut(r.timing.busy).filter((x) => !Number.isNaN(x))),
          meanMin: r.minMean, meanMax: r.maxMean, distinct: new Set(r.hashes).size,
        };
        row.gpu_wait = fmt(row.read1.median - row.copy.median);
        rows.push(row);
        log(`${m.rw}x${m.rh} bake ${String(m.bake).padEnd(4)} N ${m.samples}  pump ${fmt(row.pump.median)}  GPU-wait ${row.gpu_wait}  copy ${fmt(row.copy.median)}  = total ${fmt(row.total.median)} ms (p90 ${fmt(row.total.p90)}, max ${fmt(row.total.max)})  ${fmt(1000 / row.total.median)} fps   timer* ${fmt(row.busy.median)}  [mean ${fmt(r.minMean, 1)}..${fmt(r.maxMean, 1)}, ${row.distinct}/${warm + n} distinct]  ${fmt((Date.now() - t) / 1000)} s`);
      } catch (e) {
        rows.push({ ...m, error: String(e.message || e).split('\n')[0] });
        log(`${m.rw}x${m.rh} bake ${m.bake} N ${m.samples}  FAILED: ${rows.at(-1).error}`);
      }
    }
    await page.close();
  });
  log('  (timer* = EXT_disjoint_timer_query_webgl2 over the frame\'s commands: informational, it includes idle gaps on this backend)');
  save('timing', { binary, rows });
  return rows;
}

// ============================================================ 4. SwiftShader vs Metal, the same frames
const b64u8 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
function diffFrames(a, b) {
  // per channel over RGB: mean |d|, max |d|, share of pixels where that channel differs, PSNR
  const out = {};
  const n = a.length / 4;
  ['R', 'G', 'B'].forEach((ch, c) => {
    let sum = 0, sq = 0, max = 0, cnt = 0;
    for (let i = c; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]); if (d) { cnt++; sum += d; sq += d * d; if (d > max) max = d; } }
    out[ch] = { mean_abs: sum / n, max_abs: max, share_differing: cnt / n, psnr: sq ? 10 * Math.log10((255 * 255) / (sq / n)) : Infinity };
  });
  return out;
}
async function stageSwiftshader(binary) {
  const W = 640, H = 360, FR = Number(flag('--sw-frames', 6)), AT = 600;
  log(`\n--- 4. Metal (${binary}) vs SwiftShader, the same ${FR} frames (all compared per channel), projector-cherry ${W}x${H}, bake 1024, 32 samples`);
  const params = baseParams(CHERRY);
  let state, metal;
  await withBrowser(binary, async (b) => {
    const page = await openPage(b.browser, srv.port);
    const cp = await page.evaluate(([p, n, s, T]) => window.__v.cheapPreroll(p, n, s, T), [params, AT, STEP, T0_MS]);
    state = cp.state;
    const info = await page.evaluate((o) => window.__v.open(o), { params, rw: W, rh: H, step: STEP, T0: T0_MS, at: AT, state });
    const t = Date.now();
    metal = await page.evaluate(([f, t2]) => window.__v.run({ from: f, to: t2, keepEvery: 1, batch: 1 }), [AT, AT + FR]);
    metal.info = info; metal.ms = Date.now() - t;
    await page.evaluate(() => window.__v.close());
    await page.close();
  });
  log(`Metal: ${metal.info.renderer}  ${FR} frames in ${metal.ms} ms`);
  const swift = await withBrowser('swiftshader', async (b) => {
    const page = await openPage(b.browser, srv.port);
    const info = await page.evaluate((o) => window.__v.open(o), { params, rw: W, rh: H, step: STEP, T0: T0_MS, at: AT, state });
    const t = Date.now();
    const r = await page.evaluate(([f, t2]) => window.__v.run({ from: f, to: t2, keepEvery: 1, batch: 1 }), [AT, AT + FR]);
    r.info = info; r.ms = Date.now() - t;
    await page.close();
    return r;
  });
  log(`SwiftShader: ${swift.info.renderer}  ${FR} frames in ${swift.ms} ms`);
  const same = metal.hashes.filter((h, i) => h === swift.hashes[i]).length;
  const perFrame = metal.kept.map((k, i) => ({ n: k.n, ...diffFrames(b64u8(k.b64), b64u8(swift.kept[i].b64)) }));
  const agg = (ch, f) => perFrame.reduce((m, r) => Math.max(m, r[ch][f]), 0);
  const res = { W, H, frames: FR, at: AT, identical_hashes: same, metalRenderer: metal.info.renderer, swiftRenderer: swift.info.renderer, perFrame };
  log(`frames byte-identical between the two: ${same}/${FR}`);
  for (const ch of ['R', 'G', 'B']) {
    const mean = perFrame.reduce((s2, r) => s2 + r[ch].mean_abs, 0) / perFrame.length;
    const minPsnr = perFrame.reduce((m, r) => Math.min(m, r[ch].psnr), Infinity);
    log(`  ${ch}: mean |d| ${fmt(mean, 4)} codes, worst-frame max |d| ${agg(ch, 'max_abs')}, worst share of pixels differing ${fmt(100 * agg(ch, 'share_differing'), 3)} %, lowest PSNR ${fmt(minPsnr, 2)} dB`);
  }
  save('swiftshader', res);
  return res;
}

// ============================================================ 5. the pipe
async function stageSink(binary) {
  log(`\n--- 5. the pipe: in-page fetch POST -> Node -> ffmpeg, noise frames, nothing rendered`);
  const rows = [];
  await withBrowser(binary, async (b) => {
    const page = await openPage(b.browser, srv.port);
    for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
      for (const sinkKind of ['null', 'hevc_videotoolbox 40M']) {
        const n = w === 1920 ? 300 : 120, batch = w === 1920 ? 8 : 4;
        const enc = sinkKind === 'null' ? ['-f', 'null', '-'] : ['-vf', 'vflip,format=yuv420p', '-c:v', 'hevc_videotoolbox', '-b:v', '40M', '-g', '120', '-tag:v', 'hvc1', '-y', join(OUT, 'sink-test.mp4')];
        const ff = spawnFfmpeg(['-hide_banner', '-nostats', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', '60', '-i', '-', ...enc]);
        const counter = { bytes: 0 };
        srv.sinks.set('sinktest', async (req, res) => { await pipeRequestTo(req, ff, counter); res.writeHead(200).end('ok'); });
        const t = Date.now();
        const r = await page.evaluate(([u, ww, hh, nn, bb]) => window.__v.sinkTest(u, ww, hh, nn, bb), [`/__sink/sinktest`, w, h, n, batch]);
        const sentMs = Date.now() - t;
        const done = await ff.end();
        const ms = Date.now() - t;
        const row = { w, h, sink: sinkKind, frames: n, batch, bytes: counter.bytes, ok: counter.bytes === n * w * h * 4 && done.code === 0, page_fps: n / (r.ms / 1000), end_fps: n / (ms / 1000), sent_ms: sentMs, total_ms: ms, load: loadAvg() };
        rows.push(row);
        log(`${w}x${h} -> ${sinkKind.padEnd(22)} ${n} frames  POST side ${fmt(row.page_fps)} fps  incl. encoder flush ${fmt(row.end_fps)} fps  bytes ${counter.bytes === n * w * h * 4 ? 'exact' : 'MISMATCH'}  ffmpeg exit ${done.code}`);
      }
    }
    await page.close();
  });
  save('sink', rows);
  return rows;
}

// ============================================================ main
try {
  let gl = load('glinfo');
  if (want('glinfo')) gl = await stageGlinfo();
  const working = (gl || []).filter((r) => r.metal && r.info?.colorBufferFloat);
  if (!working.length) { log('NO variant brought Metal up with EXT_color_buffer_float; the render stages do not run.'); process.exitCode = 2; }
  else {
    const binary = flag('--binary') || working[0].variant;
    log(`\nbinary for the render stages: ${binary}`);
    if (want('determinism')) await stageDeterminism(binary);
    if (want('timing')) await stageTiming(binary);
    if (want('swiftshader')) await stageSwiftshader(binary);
    if (want('sink')) await stageSink(binary);
  }
} finally {
  await srv.close();
}
