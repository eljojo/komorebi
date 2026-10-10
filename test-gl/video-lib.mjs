// Shared plumbing of the video exporter (render-video.mjs) and its probe (gpu-probe.mjs): the static server that hands out
// test-gl/video.html from here and every other path from the ENGINE tree, the sink routes, Chromium on Metal, ffmpeg.
// Nothing here touches an existing file of the repo.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// ---- the clock step (see video.html): dyadic, so a frame's dt is one constant double and the sub-step count cannot flip ----
export const stepMsFor = (fps) => Math.floor((1000 / fps) * 2 ** 20) / 2 ** 20;
export const T0_MS = 5000;   // any multiple of 2^-20; keeps every stamp exact in a double

// What tick() computes per frame, run over n frames: the histogram of ceil(dt/(1/120)). Used by the probe to PROVE the remedy.
export function subStepHistogram(fps, n, { naive }) {
  const step = naive ? 1000 / fps : stepMsFor(fps);
  const h = {};
  let last = T0_MS;
  for (let i = 1; i <= n; i++) {
    const now = naive ? T0_MS + (i * 1000) / fps : T0_MS + i * step;
    const dt = (now - last) / 1000; last = now;
    const c = Math.ceil(dt / (1 / 120));
    h[c] = (h[c] || 0) + 1;
  }
  return h;
}

// ---- the server: video.html from test-gl/, the rest from the engine root; /__sink/<name> routes registered by the driver ----
// `served` is what the browser was actually handed, hashed. The page is read live from pageDir at every load (a retried session reloads it), so the exporter
// compares served.get(PAGE_KEY) with the run key after each load (assertServedPage) and records it per session and per segment. pageDir is a seam for the tests.
export const PAGE_KEY = '/video.html (test-gl)';
export function assertServedPage(served, expectedSha) {
  const got = served.get(PAGE_KEY);
  if (got !== expectedSha) throw new Error(`video.html as served is ${got ? `sha256 ${got.slice(0, 12)}` : 'not served at all'}, the run key names ${String(expectedSha).slice(0, 12)}: the page changed under a running export`);
}
export async function startServer({ engineRoot, sinks = new Map(), pageDir = HERE }) {
  const served = new Map();   // '/path' -> sha256 of the bytes sent (200s only)
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith('/__sink/')) {
        const h = sinks.get(path.slice(8));
        if (!h) { res.writeHead(404).end('no such sink'); return; }
        await h(req, res, url);
        return;
      }
      const root = path === '/video.html' ? pageDir : engineRoot;
      const file = join(root, path === '/video.html' ? 'video.html' : normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (file !== root && !file.startsWith(`${root}/`)) { res.writeHead(403).end('forbidden'); return; }
      let bytes;
      try { if (!(await stat(file)).isFile()) throw new Error('not a file'); bytes = await readFile(file); } catch { res.writeHead(404).end('not found'); return; }
      served.set(path === '/video.html' ? PAGE_KEY : `/${relative(engineRoot, file)}`, sha256(bytes));
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(bytes);
    } catch (e) {
      try { res.writeHead(500).end(String(e?.message || e)); } catch { /* connection already gone */ }
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, port: server.address().port, served, sinks, close: () => new Promise((ok) => server.close(ok)) };
}

// ---- Chromium ----
// shell  = chromium_headless_shell (Playwright's default for headless)    chromium = Chrome for Testing, new headless (channel 'chromium')
export const GPU_VARIANTS = {
  'shell+angle-metal': { channel: null, args: ['--use-gl=angle', '--use-angle=metal', '--force-color-profile=srgb'] },
  'shell+enable-gpu': { channel: null, args: ['--enable-gpu', '--force-color-profile=srgb'] },
  'chromium+enable-gpu': { channel: 'chromium', args: ['--enable-gpu', '--force-color-profile=srgb'] },
  'chromium+angle-metal+enable-gpu': { channel: 'chromium', args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--force-color-profile=srgb'] },
  swiftshader: { channel: null, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] },
};

export async function launchBrowser(chromium, variantName) {
  const v = GPU_VARIANTS[variantName];
  if (!v) throw new Error(`unknown GPU variant ${variantName}`);
  // --js-flags=--expose-gc: the page calls gc() after each POST so the Blob it sent is released at once (see video.html), else the browser's blob store fills at ~2 GB
  const args = [...v.args, '--js-flags=--expose-gc'];
  const browser = await chromium.launch({ ...(v.channel ? { channel: v.channel } : {}), args });
  return { browser, variant: variantName, channel: v.channel || 'chromium_headless_shell', args };
}

export async function openPage(browser, port, { viewport = { width: 1280, height: 720 } } = {}) {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport });
  const log = [];
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`); });
  await page.goto(`http://127.0.0.1:${port}/video.html`, { waitUntil: 'load' });
  // NOT waitForFunction's default polling: that is requestAnimationFrame, which video.html replaces
  await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 60000 });
  page.pageLog = log;
  return page;
}

// Browser-level facts for the manifest: the real command line, GPU feature status, the encoders Chromium itself would use.
export async function browserFacts(browser) {
  const out = { version: browser.version() };
  try {
    const s = await browser.newBrowserCDPSession();
    const info = await s.send('SystemInfo.getInfo');
    const { glExtensions, ...aux } = info.gpu.auxAttributes || {};   // the extension list is 6 kB of noise
    out.gpu = {
      devices: info.gpu.devices, driverBugWorkarounds: info.gpu.driverBugWorkarounds?.length,
      featureStatus: info.gpu.featureStatus, auxAttributes: aux,
    };
    out.angle = aux.glVersion;
    out.modelName = info.modelName; out.modelVersion = info.modelVersion; out.commandLine = info.commandLine;
    await s.detach();
  } catch (e) { out.cdpError = String(e.message || e).split('\n')[0]; }
  return out;
}

// ---- the master's filter chain (pure; the exporter and test-gl/video.test.mjs both build it from here) ----
// SS_NOTE. The engine writes display-encoded 8-bit (pow(x,1/2.2) in its tone tail). Averaging 2x2 of those CODES (gamma) darkens an
// edge pixel relative to the light it covers; averaging the LIGHT (decode with pow 2.2, average, re-encode) is what a pixel that integrates
// its footprint shows. `linear` does the latter in 16-bit with the engine's own power law (not sRGB's toe): lutrgb on gbrp16.
// EACH PLANE IS SCALED ALONE, as gray16. swscale's area scaler of gbrp16 does not keep the planes apart (it runs RGB through a YUV-shaped
// intermediate): pure blue gained up to 7 codes of red, a real frame was off by up to 6 codes. A gray plane has nothing to mix with.
// The error left is the 16-bit linear grid (one step at the dark end is 1.85 display codes): the input codes are rounded onto it and the average is rounded
// again, so the two roundings can stack. It is MEASURED, not bounded (LINEAR_SS_LIMITS; video.test.mjs holds each figure): at --ss 2 every test is within
// 1 code of the integer-rounded float box average, and against the unrounded one the worst is 1.07 codes on real frames (a few dark B channels) and 1.34 on
// synthetic dark noise; --ss 3 and 4 can reach 2 integer codes on dark content. A flat code 1 maps to 0.
export const LINEAR_SS_LIMITS = { ss2_int_codes: 1, ss2_float_real_frames_codes: 1.07, ss2_float_dark_noise_codes: 1.34, ss34_int_codes: 2 };
export function linearKnownLimits(ss) {
  const L = LINEAR_SS_LIMITS;
  return [
    'the 16-bit linear intermediate maps a flat display code 1 to 0 (the other 255 codes round-trip exactly) and its dark-end step is 1.85 display codes; the input codes are rounded onto that grid and the average is rounded again, so the two errors can stack',
    `MEASURED against the exact box average in float, not a bound (video.test.mjs): ss 2 is within ${L.ss2_int_codes} code of the integer-rounded reference in every test, with a float error of at most ${L.ss2_float_real_frames_codes} codes on real frames (a few dark channels) and ${L.ss2_float_dark_noise_codes} on synthetic dark noise (codes 0-4); ss 3 and 4 can reach ${L.ss34_int_codes} codes against the integer-rounded reference on dark content${ss > 2 ? ` (this run is ss ${ss})` : ''}`,
  ];
}
const L2 = (inv) => `clip(pow(val/maxval,${inv ? '1/2.2' : '2.2'})*maxval+0.5,0,maxval)`;
const LUT = (inv) => `lutrgb=r='${L2(inv)}':g='${L2(inv)}':b='${L2(inv)}'`;
export function masterChain({ ow, oh, ss, space, master }) {
  const fin = master === 'ffv1' ? 'format=bgr0' : 'format=bgr24';
  if (ss === 1) return `vflip,${fin}`;
  if (space === 'gamma') return `vflip,scale=${ow}:${oh}:flags=area+accurate_rnd+full_chroma_int,${fin}`;
  const plane = (name, from) => `[${from}]extractplanes=${name},scale=${ow}:${oh}:flags=area+accurate_rnd[p${name}]`;
  // gbrp16le's planes are G, B, R: the merge takes input 0/1/2 plane 0 as output planes 0/1/2
  return `vflip,format=gbrp16le,${LUT(false)},split=3[s0][s1][s2];${plane('g', 's0')};${plane('b', 's1')};${plane('r', 's2')};[pg][pb][pr]mergeplanes=0x001020:gbrp16le,${LUT(true)},${fin}`;
}

// ---- the delivery, its measure, its stills (pure strings; the exporter, its tests and the encoder comparisons all build them from here) ----
// Both the delivery and its measure take their frame numbers from the INDEX (settb=1/fps,setpts=N), never from a container clock: the master (mkv) counts
// in milliseconds (0,17,33,50,67 ..) and the delivery (mp4) in 1/15360 s (0,256,512 ..), and ffmpeg's frame sync pairs by timestamp, so a comparison by
// timestamp meets the previous master frame at every third delivery frame.
export const INDEX_PTS = (fps) => `settb=1/${fps},setpts=N`;
// What a player does to a yuv420p/bt709/tv file on its way to RGB: the chroma is upsampled with a real filter, in the file's matrix and range.
export const PLAYER_RGB = 'scale=in_range=tv:in_color_matrix=bt709:out_range=pc:flags=accurate_rnd+full_chroma_int';
export const deliveryFilter = ({ fps, trc }) => `${INDEX_PTS(fps)},scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,setparams=colorspace=bt709:color_primaries=bt709:color_trc=${trc}:range=tv,format=yuv420p`;
// ---- rates: the delivery's bitrate with its cap, the FAT32 file limit, and what a run costs on disk ----
// hevc_videotoolbox's -b:v is an average. Beside it -maxrate (1.25x) and -bufsize (2x) make a ceiling a projector's own player can count on: 60M gives 75M / 120M,
// about 2 GB for 5 minutes. -q:v 100 is the explicit choice for the best picture and measured 157 Mbit/s (5.9 GB for 5 minutes) on a lit look.
export const VT_MAXRATE_X = 1.25, VT_BUFSIZE_X = 2;
const RATE = /^(\d+(?:\.\d+)?)([kKM]?)$/;
// ffmpeg reads a lowercase m as milli: -b:v 60m asks for 0.06 bit/s, hevc_videotoolbox answers with its floor instead of an error (4 s of noisy 1080p60: 5-8 MB against 20 MB at 60M),
// and the manifest and the free-space check would still say 60 Mbit/s
function parseRate(rate) {
  const s = String(rate), m = RATE.exec(s);
  if (m) return m;
  if (/^\d+(?:\.\d+)?m$/.test(s)) throw new Error(`bitrate ${JSON.stringify(s)}: ffmpeg reads a lowercase m as milli, not mega: write ${s.slice(0, -1)}M`);
  throw new Error(`bitrate ${JSON.stringify(s)}: expected a number with an optional k, K or M (60M, 45000k, 60000000)`);
}
export function scaleRate(rate, factor) {
  const m = parseRate(rate);
  return `${Number((Number(m[1]) * factor).toFixed(3))}${m[2]}`;
}
export function mbitOf(rate) {
  const m = parseRate(rate);
  return m[2] === '' ? Number(m[1]) / 1e6 : m[2].toLowerCase() === 'k' ? Number(m[1]) / 1e3 : Number(m[1]);
}
// The delivery's size for the free-space check, as an upper bound in Mbit/s: a bitrate delivery never sustains more than its cap; -q:v has no cap (157 measured, 160 stated);
// libx265 CRF 16 sits well under 40 (CRF 6 measured 17)
export function estimateDeliveryMbit({ codec, vtQuality, vtBitrate }) {
  if (codec === 'none') return 0;
  if (codec === 'libx265') return 40;
  return vtQuality ? 160 : mbitOf(vtBitrate) * VT_MAXRATE_X;
}
// A FAT32 stick holds files up to 4 GiB - 1 byte. The player reads the stick directly, so a delivery over it is a failure found at the projector unless it is said here:
// before the render, from the seconds and the rate bound (fat32Forecast), and after the encode, from the file (fat32Report).
export const FAT32_MAX_BYTES = 2 ** 32 - 1;
const fat32Fit = (seconds) => (seconds ? ` An average of ${(Math.floor(((FAT32_MAX_BYTES * 8) / seconds / 1e6) * 10) / 10).toFixed(1)} Mbit/s or less would fit these ${seconds} s.` : '');
const FAT32_EXFAT = ' An exFAT stick has no such limit.';
export function fat32Report(bytes, { seconds } = {}) {
  const fits = bytes <= FAT32_MAX_BYTES;
  if (fits) return { limit_bytes: FAT32_MAX_BYTES, size_bytes: bytes, fits };
  return { limit_bytes: FAT32_MAX_BYTES, size_bytes: bytes, fits, warning: `the delivery is ${(bytes / 2 ** 30).toFixed(2)} GiB, over the 4 GiB file limit of a FAT32 stick (${FAT32_MAX_BYTES} bytes): it will not copy to one.${fat32Fit(seconds)}${FAT32_EXFAT}` };
}
// mbit is a bound (estimateDeliveryMbit: the bitrate's cap), not the average the encoder will reach, hence "may"; null when the bound fits, or when there is no delivery (0)
export function fat32Forecast({ seconds, mbit }) {
  const bytes = (seconds * mbit * 1e6) / 8;
  if (bytes <= FAT32_MAX_BYTES) return null;
  return `the delivery may pass the 4 GiB file limit of a FAT32 stick: ${seconds} s at up to ${mbit} Mbit/s is up to ${(bytes / 2 ** 30).toFixed(1)} GiB.${fat32Fit(seconds)}${FAT32_EXFAT}`;
}

// ---- disk: what a run adds at its peak ----
// The lossless master, measured on arboretum preset 3 at 1920x1080: 719 466 B a frame over a 5-minute run (12 950 384 474 B in 18 000 frames) and 717 714 over a 600-frame smoke;
// projector-ultraviolet sits at 0.35 MB. A segment alone runs from 0.57 to 0.83 MB a frame, so this is the whole-run figure of the heaviest look measured, not a bound: a sharper look
// can pass it, and the margin and the delivery cap's slack take up some of that. Another size scales by area.
export const LOSSLESS_BYTES_PER_FRAME_1080 = 0.72e6;
export const DISK_MARGIN_BYTES = 1e9;
// framesToRender: what is still to be rendered; frames: the whole run (a merged master copies every frame, the delivery covers all of them)
export function diskPlan({ framesToRender, frames, fps, ow, oh, merge, deliveryMbit }) {
  const perFrame = (LOSSLESS_BYTES_PER_FRAME_1080 * ow * oh) / (1920 * 1080);
  const segments = framesToRender * perFrame, merged = merge ? frames * perFrame : 0, delivery = ((frames / fps) * deliveryMbit * 1e6) / 8;
  return { segments, merged, delivery, margin: DISK_MARGIN_BYTES, total: segments + merged + delivery + DISK_MARGIN_BYTES };
}

// input: the ffmpeg input arguments of the master (['-i', file] or the concat demuxer over the segments)
export function deliveryArgs({ input, out, fps, trc, codec, vtQuality, vtBitrate, crf, preset, gop }) {
  const common = ['-hide_banner', '-nostats', '-y', ...input, '-an', '-vf', deliveryFilter({ fps, trc }), '-r', String(fps), '-fps_mode', 'cfr'];
  const enc = codec === 'hevc_videotoolbox'
    ? ['-c:v', 'hevc_videotoolbox', ...(vtQuality ? ['-q:v', String(vtQuality)] : ['-b:v', vtBitrate, '-maxrate', scaleRate(vtBitrate, VT_MAXRATE_X), '-bufsize', scaleRate(vtBitrate, VT_BUFSIZE_X)]), '-profile:v', 'main', '-g', String(gop), '-tag:v', 'hvc1']
    : ['-c:v', 'libx265', '-preset', preset, '-crf', String(crf), '-g', String(gop), '-tag:v', 'hvc1', '-x265-params', `keyint=${gop}:min-keyint=${gop}:open-gop=0:log-level=error`];
  // -f mp4: the exporter writes to delivery.mp4.part and renames on success, and a name ending in .part has no muxer of its own
  return [...common, ...enc, '-movflags', '+faststart', '-f', 'mp4', out];
}
// stats files are written relative to the cwd the run is given (a path in a filtergraph needs escaping, a bare name does not)
// head: what input 0 goes through on its way to planar RGB. The master (input 1) only gets the index stamp.
const pairGraph = (head, { fps, psnrLog, ssimLog }) => `[0:v]${head},format=gbrp[d];[1:v]${INDEX_PTS(fps)},format=gbrp[m];[d]split[d1][d2];[m]split[m1][m2];[d1][m1]psnr=stats_file=${psnrLog}[p];[d2][m2]ssim=stats_file=${ssimLog}[s]`;
export const measureGraph = ({ fps, psnrLog, ssimLog }) => pairGraph(`${INDEX_PTS(fps)},${PLAYER_RGB}`, { fps, psnrLog, ssimLog });
// The encoder-free baseline: input 0 is the MASTER through the delivery's own filter (matrix, range, 4:2:0) and the same player-grade read-back, no encoder.
export const baselineGraph = ({ fps, trc, psnrLog, ssimLog }) => pairGraph(`${deliveryFilter({ fps, trc })},${PLAYER_RGB}`, { fps, psnrLog, ssimLog });
// delivery: the file to compare, or omitted for the baseline (then the master is read twice)
export const measureArgs = ({ delivery, input, graph }) => ['-hide_banner', '-nostats', ...(delivery ? ['-i', delivery] : input), ...input, '-lavfi', graph, '-map', '[p]', '-f', 'null', '-', '-map', '[s]', '-f', 'null', '-'];
// ffmpeg prints a frame identical to the master as `inf`, which Number() cannot read
const num = (s) => (s === 'inf' ? Infinity : Number(s));
export function parseMeasure(stderr, psnrLogText) {
  const ps = /PSNR r:(\S+) g:(\S+) b:(\S+) average:(\S+) min:(\S+) max:(\S+)/.exec(stderr), ss = /SSIM R:(\S+) .* G:(\S+) .* B:(\S+) .* All:(\S+)/.exec(stderr);
  // the lowest per-frame PSNR is the proof of the pairing: frame i of the delivery against frame i of the master. A shifted pair sits far below the encoder's own error.
  // A frame bit-identical to the master (psnr_avg:inf, e.g. black through a YUV-lossless delivery) is a compared frame: it counts, and it is never the minimum.
  const per = psnrLogText.trim().split('\n').map((l) => num(/psnr_avg:(\S+)/.exec(l)?.[1])).filter((x) => !Number.isNaN(x));
  return { psnr_rgb_avg_db: ps && num(ps[4]), psnr_min_frame_db: Math.min(...per), psnr_r_g_b: ps && [ps[1], ps[2], ps[3]].map(num), ssim_rgb_all: ss && Number(ss[4]), ssim_r_g_b: ss && [ss[1], ss[2], ss[3]].map(Number), frames_compared: per.length };
}
async function measureRun({ delivery, input, cwd, graph, onChild, psnrLog, pairing }) {
  const r = await runFfmpegAsync(measureArgs({ delivery, input, graph }), { cwd, onChild, quiet: false });   // the summary lines are info-level
  if (r.code !== 0) throw new Error(`measure: ffmpeg exited ${r.code}: ${r.stderr.slice(-1500)}`);
  return { ...parseMeasure(r.stderr, readFileSync(join(cwd, psnrLog), 'utf8')), pairing };
}
// Compare a delivery with the master it came from. cwd receives psnr.log and ssim.log (names are the caller's); onChild gets the ffmpeg process (to kill it on a signal).
export function runMeasure({ delivery, input, cwd, fps, psnrLog = 'psnr.log', ssimLog = 'ssim.log', graph, onChild }) {
  return measureRun({ delivery, input, cwd, onChild, psnrLog, graph: graph || measureGraph({ fps, psnrLog, ssimLog }), pairing: `index-exact: ${INDEX_PTS(fps)} on both inputs` });
}
// The same numbers for the master through the delivery's chain with NO encoder: the loss of the FORMAT alone (RGB -> bt709 tv 4:2:0 -> RGB). A delivery cannot beat it,
// and the gap between it and runMeasure's numbers is what the encoder costs.
export function runBaseline({ input, cwd, fps, trc, psnrLog = 'psnr-baseline.log', ssimLog = 'ssim-baseline.log', onChild }) {
  return measureRun({ input, cwd, onChild, psnrLog, graph: baselineGraph({ fps, trc, psnrLog, ssimLog }), pairing: `index-exact: ${INDEX_PTS(fps)} on both inputs; input 0 is the master through the delivery filter, no encoder` });
}
export function qualityReport(vs, baseline) {
  const diff = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? a - b : a === b ? 0 : null);
  return {
    ...vs,
    encoder_free_baseline: { ...baseline, what: 'the master through the delivery\'s own scale / matrix / format=yuv420p chain and the same player-grade read-back, with NO encoder: the loss of the format alone (RGB to bt709 tv 4:2:0 and back). A delivery cannot score above it.' },
    encoder_loss: { psnr_db: diff(baseline.psnr_rgb_avg_db, vs.psnr_rgb_avg_db), ssim: diff(baseline.ssim_rgb_all, vs.ssim_rgb_all), note: 'baseline minus delivery: what the encoder costs on top of the format; 0 for a delivery that is lossless in YUV' },
  };
}

// ---- ffmpeg ----
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE || 'ffprobe';
export function ffmpegVersion() {
  const r = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n')[0];
}
// inputOpts: ffprobe options that belong to the INPUT (['-f','concat','-safe','0'] to probe a concat list)
export function ffprobeJson(file, inputOpts = []) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...inputOpts, file], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
// exact number of video packets (== frames for an intra / one-packet-per-frame stream), read from the container index
export function countPackets(file, inputOpts = []) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', ...inputOpts, file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe -count_packets ${file}: ${r.stderr}`);
  return Number(r.stdout.trim());
}
// decoded frames, actually counted (-count_frames decodes the stream)
export function countFrames(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe -count_frames ${file}: ${r.stderr}`);
  return Number(r.stdout.trim());
}

// A running ffmpeg fed through stdin. write() honours back-pressure; end() resolves with { code, stderrTail }.
export function spawnFfmpeg(args) {
  const p = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
  p.stdin.on('error', () => { /* surfaced by the exit code */ });
  const exited = new Promise((ok) => p.on('close', (code) => ok({ code, stderrTail: err.slice(-3000) })));
  return {
    proc: p, args, exited,
    async write(chunk) { if (!p.stdin.write(chunk)) await Promise.race([once(p.stdin, 'drain'), exited]); },
    async end() { p.stdin.end(); return exited; },
    kill() { try { p.kill('SIGKILL'); } catch { /* gone */ } },
  };
}

// Run a finished ffmpeg command to completion; returns { code, stderr }.
export function runFfmpeg(args, { quiet = true } = {}) {
  const r = spawnSync(FFMPEG, ['-hide_banner', ...(quiet ? ['-loglevel', 'error', '-nostats'] : []), ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
  return { code: r.status, stderr: r.stderr, stdout: r.stdout };
}

// The same, asynchronously: the event loop stays free, so a SIGINT/SIGTERM handler runs at once and can kill the child (onChild registers it).
export function runFfmpegAsync(args, { cwd, quiet = true, onChild } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', ...(quiet ? ['-loglevel', 'error', '-nostats'] : []), ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    onChild?.(p);
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; if (out.length > 1e6) out = out.slice(-5e5); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 4e6) err = err.slice(-2e6); });   // psnr/ssim print their summary last
    p.on('error', reject);
    p.on('close', (code, signal) => resolve({ code: code ?? (signal ? 128 : 1), signal, stdout: out, stderr: err }));
  });
}

// sha256 of a file, streamed (a segment is hundreds of MB)
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256'), s = createReadStream(file);
    s.on('data', (d) => h.update(d)); s.on('error', reject); s.on('end', () => resolve(h.digest('hex')));
  });
}

// The concat demuxer's list: one `file '<abs path>'` per line (a single quote in a path is written as '\'' ).
export const concatListText = (files) => `${files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')}\n`;
export const CONCAT_INPUT = (list) => ['-f', 'concat', '-safe', '0', '-i', list];

// The sink route's reader: stream a request body into an ffmpeg stdin, count bytes.
export async function pipeRequestTo(req, ff, counter) {
  for await (const chunk of req) { counter.bytes += chunk.length; await ff.write(chunk); }
}

export function stats(a) {
  const s = [...a].sort((x, y) => x - y), n = s.length;
  if (!n) return { n: 0 };
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  return { n, mean: s.reduce((x, y) => x + y, 0) / n, median: q(0.5), p90: q(0.9), max: s[n - 1], min: s[0] };
}
export const fmt = (x, d = 1) => (x === undefined || x === null || Number.isNaN(x) ? '-' : Number(x).toFixed(d));
export { createReadStream };

// ---- the arboretum: a look fetched from the API instead of read from a file ----
// The API host. The preset's public page (/p/<id>) is always on it, wherever --arboretum-base fetched from (a mirror, or a mock in the tests).
export const ARBORETUM_BASE = 'https://komorebi.eljojo.net';
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
// The preset's params as bytes: keys sorted at every depth, so the hash is the params' and not the order a server happened to write them in. It is the look's identity in the run key.
export const canonicalJson = (v) => JSON.stringify(sortKeys(v));
export const canonicalSha256 = (v) => sha256(Buffer.from(canonicalJson(v)));
// <id>[@<version>][:<share_token>]. A refusal never echoes the argument: it may carry the share token.
export function parseArboretumSpec(spec) {
  const m = /^([1-9]\d*)(?:@([1-9]\d*))?(?::(\S+))?$/.exec(String(spec));
  if (!m) throw new Error('--arboretum: expected <id>[@<version>][:<share_token>]');
  return { id: Number(m[1]), version: m[2] ? Number(m[2]) : null, share: m[3] ?? null };
}
// What is recorded of how the exporter was launched: the share token is a credential, so it leaves the argv and a sha256 prefix says which link it was.
export const redactArgv = (argv) => argv.map((a, i) => {
  const m = argv[i - 1] === '--arboretum' ? /^([^:]*):(.+)$/.exec(a) : null;
  return m ? `${m[1]}:<share token omitted, sha256 ${sha256(m[2]).slice(0, 8)}>` : a;
});
// refusal: the server said no (401 / 403 / 404 / 422): the request cannot be met. Otherwise (a 5xx, nothing listening) it may be tried again.
export class ArboretumError extends Error { constructor(message, refusal) { super(message); this.refusal = refusal; } }
// The bearer goes only over https; plain http only to this machine (the tests' mock). Anywhere else it would cross the network in the clear.
export function isBearerSafeBase(base) {
  try {
    const u = new URL(base);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch { return false; }
}
// GET /api/presets/<id> (the head) or /api/presets/<id>/versions/<n>, with the bearer token when there is one and ?k=<share> for an unlisted preset. Every message is one line,
// names the preset, and has the token and the share token cut out of it, whatever the server echoes back or the network layer says about the URL.
export async function fetchArboretum({ base = ARBORETUM_BASE, id, version = null, share = null, token = null, timeoutMs = 30000 }) {
  const requested = `${id}${version ? `@${version}` : ''}`;
  const secrets = [token, share, share && encodeURIComponent(share)].filter(Boolean);
  // scrub first, shorten last: a cut that lands inside a secret would leave the front of it past the scrub
  const say = (m) => { let t = String(m); for (const x of secrets) t = t.split(x).join('[redacted]'); return `arboretum preset ${requested}: ${t.replace(/\s+/g, ' ').trim().slice(0, 240)}`; };
  const fail = (m, refusal) => new ArboretumError(say(m), refusal);
  let host = 'the server';
  try { host = new URL(base).host; } catch { /* reported below, where the fetch fails */ }
  if (token && !isBearerSafeBase(base)) throw fail(`not sending the bearer token to ${host}: --arboretum-base must be https (http only to localhost or 127.0.0.1)`, true);
  let res, text;
  try {
    const url = `${base.replace(/\/+$/, '')}/api/presets/${id}${version ? `/versions/${version}` : ''}${share ? `?k=${encodeURIComponent(share)}` : ''}`;
    res = await fetch(url, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(timeoutMs) });
    text = await res.text();
  } catch (e) { throw fail(`could not reach ${host} (${e.cause?.code ?? e.name})`, false); }
  const serverSaid = () => { try { return JSON.parse(text).error ?? text; } catch { return text; } };
  if (res.status === 401) throw fail(`401: ${token ? 'the token was refused' : 'it needs a token (set ARBORETUM_TOKEN)'}`, true);
  if (res.status === 403) throw fail(`403: not allowed to read it ${token ? 'with this token' : 'without a token'}${share ? ' and this share link' : ' (an unlisted preset needs its :<share_token>)'}`, true);
  // the server answers 404 for a private preset it will not show, too: without a token that is the likelier cause
  if (res.status === 404) throw fail(`404: no such preset${version ? ' version' : ''}${token ? '' : ' (it may be private: ARBORETUM_TOKEN is not set)'}`, true);
  if (res.status === 422) throw fail(`422: the server rejected the request: ${serverSaid()}`, true);
  if (!res.ok) throw fail(`the server answered ${res.status}`, false);
  let body;
  try { body = JSON.parse(text); } catch { throw fail('the answer is not JSON', false); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('the answer is not a preset', false);
  // the head and a version do not name the preset alike: { id, version, .. } and { preset_id, n, .. } (arboretum's llms.txt; both read live)
  const gotId = version ? body.preset_id : body.id, gotVersion = version ? body.n : body.version;
  // the run key pins what is answered, so what is answered must be what was asked
  if (Number(gotId) !== id) throw fail(`the server answered preset ${gotId}`, false);
  if (!Number.isInteger(gotVersion) || (version && gotVersion !== version)) throw fail(`the server answered version ${gotVersion}`, false);
  if (!body.params || typeof body.params !== 'object' || Array.isArray(body.params)) throw fail('the answer has no params', false);
  return { id, version: gotVersion, name: String(body.name ?? `preset ${id}`), komorebi_commit: body.komorebi_commit ?? null, params: body.params, requested };
}

// ---- the engine tree: a pinned commit (git archive, as review.mjs does) or a SNAPSHOT of the working tree ----
// A snapshot, not the live tree: another build edits these files while a render runs, and a render that straddles an edit is a
// frame sequence from two engines. The snapshot is hashed file by file by the server (`served`) and the dirt is recorded.
const git = (args) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
export function exportEngine({ commit, tree, keep = false }) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'komorebi-video-'));
  // the temp tree is removed on every way out: a normal exit, process.exit, an exception, SIGINT / SIGTERM / SIGHUP (and here, if the export itself throws)
  if (!keep) onExit(() => rmSync(tmp, { recursive: true, force: true }));
  try { return exportInto(tmp, { commit, tree }); } catch (e) { if (!keep) rmSync(tmp, { recursive: true, force: true }); throw e; }
}
function exportInto(tmp, { commit, tree }) {
  const dir = join(tmp, 'tree');
  mkdirSync(dir);
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  if (commit) {
    if (String(commit).startsWith('-')) throw new Error('flag-like rev');
    const sha = git(['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]).stdout.trim();
    if (!sha) throw new Error(`commit ${JSON.stringify(commit)} does not resolve in ${REPO}`);
    const tar = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', REPO, sha, dir], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`git archive failed: ${tar.stderr}`);
    return { dir, tmp, provenance: { kind: 'commit', commit: sha, head, dirty: false, ...engineIdentity(dir) } };
  }
  if (!tree) throw new Error('exportEngine needs { commit } or { tree: true }');
  const listed = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).stdout.split('\0').filter(Boolean)
    .filter((f) => !f.startsWith('reference-photos-do-not-commit/') && !f.startsWith('test-gl/out/') && !f.startsWith('test-gl/node_modules/'));
  for (const f of listed) {
    const src = join(REPO, f);
    if (!existsSync(src)) continue;   // tracked and deleted in the working tree
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(src, join(dir, f));
  }
  const diff = git(['diff', 'HEAD']).stdout;
  const stat = git(['diff', '--stat', 'HEAD']).stdout;
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard']).stdout.split('\0').filter((f) => f && !f.startsWith('reference-photos-do-not-commit/') && existsSync(join(REPO, f)));
  return {
    dir, tmp,
    provenance: {
      kind: 'working-tree', commit: head, dirty: true, ...engineIdentity(dir), snapshot_of: 'the working tree at launch, copied (tracked + untracked-not-ignored, minus reference-photos and test-gl/out)',
      diff_stat: stat.trim().split('\n'), diff_sha256: sha256(diff), diff_bytes: diff.length,
      untracked: untracked.map((f) => ({ path: f, sha256: sha256(spawnSync('cat', [join(REPO, f)]).stdout) })),
    },
  };
}
export const cleanupExport = (e) => { if (e?.tmp) rmSync(e.tmp, { recursive: true, force: true }); };

// Run fn once when the process ends: 'exit' (normal end, process.exit, an uncaught exception) and the signals a shell or a kill sends. The signal handlers need a
// free event loop, which is why the long ffmpeg runs of the exporter are async.
const exitFns = [];
export function onExit(fn) {
  if (!exitFns.length) {
    const run = () => { while (exitFns.length) { try { exitFns.pop()(); } catch { /* already gone */ } } };
    process.on('exit', run);
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { run(); process.exit(128 + os.constants.signals[sig]); });
  }
  exitFns.push(fn);
}

// ---- who made the frames: the exporter's own files, the OS, the Chromium (all go into the manifest AND the run key) ----
export function exporterIdentity() {
  const f = (n) => sha256(readFileSync(join(HERE, n)));
  return { video_html_sha256: f('video.html'), render_video_sha256: f('render-video.mjs'), video_lib_sha256: f('video-lib.mjs') };
}
export function osFacts() {
  const sw = Object.fromEntries((spawnSync('sw_vers', { encoding: 'utf8' }).stdout || '').split('\n').map((l) => l.split(/:\s+/)).filter((p) => p.length === 2));
  return { platform: process.platform, arch: process.arch, kernel_release: os.release(), product_name: sw.ProductName, product_version: sw.ProductVersion, build_version: sw.BuildVersion, cpu: os.cpus()[0].model, memory_gb: Math.round(os.totalmem() / 2 ** 30) };
}
// The Chromium Playwright will launch for a variant, known BEFORE launching: the revision table of the installed playwright-core (the page checks the live browser.version() against it).
export function chromiumIdentity(variantName) {
  const req = createRequire(import.meta.url);
  const dir = dirname(req.resolve('playwright-core/package.json'));
  const table = JSON.parse(readFileSync(join(dir, 'browsers.json'), 'utf8')).browsers;
  const name = GPU_VARIANTS[variantName].channel === 'chromium' ? 'chromium' : 'chromium-headless-shell';
  const row = table.find((b) => b.name === name);
  return { playwright: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, browser: name, revision: row.revision, version: row.browserVersion };
}

// The engine's identity, independent of unrelated dirt (tests, docs, harness edits): the sha256 of every engine module the page can import.
export function engineIdentity(dir) {
  const files = readdirSync(dir).filter((f) => /^komorebi.*\.js$/.test(f) || f === 'presets.js').sort();
  const map = Object.fromEntries(files.map((f) => [f, sha256(readFileSync(join(dir, f)))]));
  return { engine_files: map, engine_sha256: sha256(files.map((f) => `${f}:${map[f]}`).join('\n')) };
}
