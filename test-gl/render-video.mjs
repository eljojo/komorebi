// The headless GPU video exporter: one look -> frame-stepped Metal render in Chromium -> raw frames over a local POST -> ffmpeg.
//   node test-gl/render-video.mjs (--look-json <look.json> | --arboretum <id>[@<version>][:<share_token>]) (--commit <sha> | --tree) --out <dir> [options]
//   nix run .#video -- <the same>     from the repo root, under caffeinate (a render of an hour must not idle-sleep).  --help  prints this.
//   N minutes of an arboretum preset for the projector:   nix run .#video -- --arboretum <id> --commit <sha> --out test-gl/out/video/<name> --seconds 300
//
//   --arboretum 3          the look is an arboretum preset (https://komorebi.eljojo.net/arboretum/p/3): its params come from the API instead of a file. Without @version the head is resolved
//                          ONCE, at the first run, and the version it answers with is pinned in the run key: a resume that finds the head moved on is refused, and says to resume with
//                          3@<the run's version>. :<share_token> opens an unlisted preset (?k=); ARBORETUM_TOKEN in the environment is sent as a bearer token when it is set.
//                          Neither token is written anywhere, nor passed to a child process (the share token's sha256 prefix is recorded, to say which link it was); a
//                          401 / 403 / 404 / 422 is a one-line refusal naming the preset (exit 3; a 404 without a token says the preset may be private). --arboretum-base <url> moves the API
//                          host (a mirror; the tests' mock); with ARBORETUM_TOKEN set it must be https (http only to localhost / 127.0.0.1), else the call is refused before any request.
//                          The run key pins arboretum { id, version, params_sha256 }, which is what decides the frames. The manifest adds the preset as last fetched (name, page_url,
//                          komorebi_commit: a rename or a commit stamp on the same version moves no frame, so a resume refreshes them) and how (api_base, requested, head_resolved, ..).
//   --set key=value        override a look param (JSON value, or a bare string). Repeatable. adaptive_motion / auto_quality are refused: they are forced off. Only bake_resolution /
//                          tex_resolution / sample_count keep the look as authored: any other key is accepted with a warning and the manifest says NOT as authored.
//   --commit <sha>         the engine from `git archive <sha>` in a temp tree        --tree  a SNAPSHOT of the working tree, recorded dirty (git diff --stat + a hash of the diff)
//   --fps 60  --seconds 300  --size 1920x1080  (the OUTPUT size)
//   --ss k                 render at k x size and downscale in ffmpeg;  --ss-space linear|gamma  (default linear: see SS_NOTE in video-lib.mjs)
//   --preroll 30           seconds of discarded motion before frame 0 (integrated on a tiny engine, see video.html cheapPreroll)
//   --segment-seconds 10   one lossless segment + one checkpoint per this many seconds; a crash resumes from the last pair, exactly
//   --master ffv1|x264rgb  the lossless master codec (RGB 4:4:4 8-bit, bit-exact to what the GPU wrote, after the optional downscale)
//   --delivery hevc_videotoolbox|libx265|none   [--vt-bitrate 60M | --vt-quality 100] [--x265-crf 16] [--x265-preset slow] [--gop 120] [--trc bt709|iec61966-2-1]
//                          THE DEFAULT is made for a FAT32 USB stick played in a projector's own player: -b:v 60M -maxrate 75M -bufsize 120M (--vt-bitrate scales the cap, 1.25x, and
//                          the buffer, 2x; its suffix is k, K or M, since ffmpeg reads a lowercase m as milli): about 2 GB for 5 minutes. --vt-quality 100 is the explicit choice for
//                          the best picture: 157 Mbit/s, 5.9 GB for 5 minutes of a lit look.
//                          A delivery over FAT32's 4 GiB file limit is warned about on stderr and in run.log twice: before the render, when the seconds and the rate bound (the cap)
//                          say it may pass, and after the encode, from the file (manifest delivery_fat32). The free-space check budgets the cap.
//   --stills 1,5,9         PNGs at those seconds, from the delivery file and from the master        --measure  PSNR/SSIM of delivery vs master into the manifest, beside an encoder-free baseline (master through the delivery's format chain, no encoder)
//   --chrome <variant>     a key of GPU_VARIANTS in video-lib.mjs (default shell+angle-metal)          --restart  discard a previous run in --out (its master, manifest and delivery)
//   --merge-master         also write ONE master.mkv (a stream copy of the segments): a second copy on disk. Without it the master IS the segment set.
//   --drop-segments        (needs --merge-master) after master.mkv is written and verified, delete seg/*.mkv; the run is then complete.json and is not re-rendered
//   --discard-master       no master at all: after the delivery is encoded and its frame accounting is EXACT (and after --stills and --measure, which read the master), delete seg/*.mkv.
//                          Kept: seg/list.txt, seg/SHA256SUMS, the per-segment .json and .hashes, ckpt/, hashes.txt, complete.json. manifest.json says master.discarded = true
//                          (master.discarded_at) and segments_on_disk false; complete.json says master_discarded, so the same command again answers "complete" and renders and encodes
//                          nothing. A later --encode-only on it is refused (re-render with --restart). Incompatible with --merge-master, --drop-segments and --encode-only. A run
//                          interrupted or not verified before that point keeps its segments and resumes as ever. (A lossless master is about 0.8 GiB per 20 s at 1080p, 2.6 GiB at 4K.)
//   --encode-only          skip rendering: re-encode the delivery (and stills / measure) from the master already in --out. The manifest is rebuilt from run-key.json and the
//                          segment jsons; the flags (--look-json or --arboretum <id>[@version] (no fetch), --set, --size, --ss, --fps, --seconds ..) must DESCRIBE that run, else exit 3 naming the difference.
// THE MASTER is the lossless segment set: seg/seg_NNNNN.mkv, seg/list.txt (ffmpeg's concat demuxer list, names relative to the list: `-f concat -safe 0 -i seg/list.txt`
// plays it as one file, and the folder can be moved) and seg/SHA256SUMS (`cd seg && shasum -a 256 -c SHA256SUMS`). The delivery, the stills and the measure all read it
// through the concat list.
// Nothing is created in --out until the run-key check has passed; a refused --encode-only or resume leaves the folder as it was. A manifest keeps the previous --measure's
// quality_vs_master (marked carried_over) when this invocation does not measure, if that manifest is this run's (same run key).
// The output folder: seg/ ckpt/, delivery.mp4 (written as delivery.mp4.part and renamed when the encode succeeds), hashes.txt (one 64-bit frame hash per line), manifest.json, render-info.json (what rendered it: written as soon as the browser is
// up, so a failure in the encode never loses it), run-key.json, complete.json, run.log, look.json, psnr.log ssim.log (+ psnr-baseline.log ssim-baseline.log with --measure), still PNGs; master.mkv only with --merge-master.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import {
  ARBORETUM_BASE, ArboretumError, CONCAT_INPUT, FFMPEG, GPU_VARIANTS, HERE, PAGE_KEY, PLAYER_RGB, T0_MS, VT_BUFSIZE_X, VT_MAXRATE_X, assertServedPage, browserFacts, canonicalJson, canonicalSha256, chromiumIdentity, concatListText, countFrames, countPackets, deliveryArgs, exportEngine,
  diskPlan, estimateDeliveryMbit, exporterIdentity, fat32Forecast, fat32Report, fetchArboretum, ffmpegVersion, ffprobeJson, fmt, launchBrowser, linearKnownLimits, masterChain as masterChainOf, onExit, openPage, osFacts, parseArboretumSpec, pipeRequestTo, qualityReport,
  redactArgv, runBaseline, runFfmpegAsync, runMeasure, scaleRate, sha256, sha256File, spawnFfmpeg, startServer, stepMsFor,
} from './video-lib.mjs';

// The arboretum token is for the one fetch below: ffmpeg, git and Chromium inherit this process's environment and never see it.
const ARBORETUM_TOKEN = process.env.ARBORETUM_TOKEN || null;
delete process.env.ARBORETUM_TOKEN;

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flagAll = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
const die = (m) => { console.error(`render-video: ${m}`); process.exit(2); };
if (has('--help') || has('-h')) {   // the header comment IS the usage
  const lines = readFileSync(join(HERE, 'render-video.mjs'), 'utf8').split('\n');
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const LOOK = flag('--look-json'), ARB_SPEC = flag('--arboretum');
if (!!LOOK === !!ARB_SPEC) die('exactly one of --look-json <path> or --arboretum <id>[@<version>][:<share_token>]');
let ARB = null;   // the parsed --arboretum
if (ARB_SPEC) { try { ARB = parseArboretumSpec(ARB_SPEC); } catch (e) { die(e.message); } }
const ARB_BASE = flag('--arboretum-base', ARBORETUM_BASE);
const OUT = resolve(flag('--out') || die('--out <dir> is required'));
const ENCODE_ONLY = has('--encode-only');
if (!ENCODE_ONLY && !!flag('--commit') === has('--tree')) die('exactly one of --commit <sha> or --tree');
const FPS = Number(flag('--fps', 60));
const SECONDS = Number(flag('--seconds', 300));
const [OW, OH] = flag('--size', '1920x1080').split('x').map(Number);
const SS = Number(flag('--ss', 1));
const SS_SPACE = flag('--ss-space', 'linear');
const PREROLL_S = Number(flag('--preroll', 30));
const SEG_S = Number(flag('--segment-seconds', 10));
const MASTER = flag('--master', 'ffv1');
const DELIVERY = flag('--delivery', 'hevc_videotoolbox');
const VT_BITRATE = flag('--vt-bitrate', '60M');   // with -maxrate 1.25x and -bufsize 2x (video-lib.mjs): the USB-safe default
const VT_QUALITY = flag('--vt-quality');   // hevc_videotoolbox -q:v 0..100 (constant quality) instead of -b:v
const X265_CRF = flag('--x265-crf', '16');
const X265_PRESET = flag('--x265-preset', 'slow');
const GOP = Number(flag('--gop', 120));
const TRC = flag('--trc', 'bt709');
const STILLS = (flag('--stills', '') || '').split(',').filter(Boolean).map(Number);
const CHROME = flag('--chrome', 'shell+angle-metal');
const MERGE = has('--merge-master');
const ABORT_AFTER_SEG = flag('--abort-after-seg') === undefined ? null : Number(flag('--abort-after-seg'));   // test hook: die hard after this many segments
// test hook: --inject-failure 0:2,3:1 makes segment 0 fail its first 2 attempts and segment 3 its first (after its ffmpeg is up), to exercise the retry path
const INJECT = Object.fromEntries((flag('--inject-failure', '') || '').split(',').filter(Boolean).map((s) => s.split(':').map(Number)));
if (!Number.isFinite(FPS) || FPS <= 0) die('--fps');
if (!Number.isInteger(SS) || SS < 1 || SS > 4) die('--ss must be an integer 1..4');
if (!['linear', 'gamma'].includes(SS_SPACE)) die('--ss-space linear|gamma');
if (!['ffv1', 'x264rgb'].includes(MASTER)) die('--master ffv1|x264rgb');
if (!['hevc_videotoolbox', 'libx265', 'none'].includes(DELIVERY)) die('--delivery hevc_videotoolbox|libx265|none');
try { scaleRate(VT_BITRATE, 1); } catch (e) { die(`--vt-bitrate: ${e.message}`); }
if (!GPU_VARIANTS[CHROME]) die(`--chrome ${CHROME}: not one of ${Object.keys(GPU_VARIANTS).join(', ')}`);
const DISCARD = has('--discard-master');
if (DISCARD) for (const f of ['--merge-master', '--drop-segments', '--encode-only']) if (has(f)) die(`--discard-master and ${f} are incompatible: ${f === '--encode-only' ? 'it re-encodes from the master that --discard-master deletes' : 'it keeps a master that --discard-master deletes'}`);
if (has('--drop-segments') && !MERGE) die('--drop-segments needs --merge-master: without it the segments ARE the master');
const N = Math.round(SECONDS * FPS);
if (Math.abs(N - SECONDS * FPS) > 1e-9) die(`--seconds ${SECONDS} x --fps ${FPS} is not a whole number of frames`);
for (const t of STILLS) if (!(t >= 0 && Math.round(t * FPS) < N)) die(`--stills ${t}: not inside the ${SECONDS} s`);
const SEG_FRAMES = Math.round(SEG_S * FPS);
const PREROLL = Math.round(PREROLL_S * FPS);
const RW = OW * SS, RH = OH * SS;
const STEP = stepMsFor(FPS);
const QUALITY_KEYS = ['bake_resolution', 'tex_resolution', 'sample_count'];
const MAX_ATTEMPTS = 3;   // per segment

const overrides = {};
for (const kv of flagAll('--set')) {
  const i = kv.indexOf('=');
  if (i < 1) die(`--set ${kv}: expected key=value`);
  const k = kv.slice(0, i), raw = kv.slice(i + 1);
  if (k === 'adaptive_motion' || k === 'auto_quality') die(`--set ${k}: forced false for a video; refusing`);
  let val; try { val = JSON.parse(raw); } catch { val = raw; }
  overrides[k] = val;
}

// ------------------------------------------------------------------ the filter chains and commands (video-lib.mjs: pure strings, held by video.test.mjs)
const masterChain = () => masterChainOf({ ow: OW, oh: OH, ss: SS, space: SS_SPACE, master: MASTER });
const masterCodecArgs = () => (MASTER === 'ffv1'
  ? ['-c:v', 'ffv1', '-level', '3', '-coder', '1', '-context', '1', '-g', '1', '-slices', '24', '-slicecrc', '1']
  : ['-c:v', 'libx264rgb', '-qp', '0', '-preset', 'slow']);
const segArgs = (file, frames) => ['-hide_banner', '-nostats', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${RW}x${RH}`, '-framerate', String(FPS), '-i', '-',
  '-an', '-vf', masterChain(), '-fps_mode', 'passthrough', '-frames:v', String(frames), ...masterCodecArgs(), file];
const deliveryArgv = (input, out) => deliveryArgs({ input, out, fps: FPS, trc: TRC, codec: DELIVERY, vtQuality: VT_QUALITY, vtBitrate: VT_BITRATE, crf: X265_CRF, preset: X265_PRESET, gop: GOP });

const nSegs = Math.ceil(N / SEG_FRAMES);
const segName = (i) => `seg_${String(i).padStart(5, '0')}`;
const P = (...a) => join(OUT, ...a);
const segFile = (i) => P('seg', `${segName(i)}.mkv`);
const LIST = P('seg', 'list.txt'), SUMS = P('seg', 'SHA256SUMS');
const segsPresent = () => Array.from({ length: nSegs }, (_, i) => existsSync(segFile(i))).every(Boolean);
const mergedPresent = () => existsSync(P('master.mkv'));
// what the delivery and the measure read: the segment set through the concat demuxer, else the merged file
const masterInput = () => (segsPresent() ? CONCAT_INPUT(LIST) : ['-i', P('master.mkv')]);

if (has('--print-ffmpeg')) {   // dry run: the commands, nothing launched, nothing written
  console.log(JSON.stringify({ segment: [FFMPEG, ...segArgs('seg.mkv', SEG_FRAMES)], delivery: [FFMPEG, ...deliveryArgv(CONCAT_INPUT('seg/list.txt'), 'delivery.mp4')] }));
  process.exit(0);
}
// ------------------------------------------------------------------ files
// Nothing is created in --out until the run-key check has passed: a refused --encode-only or a refused resume leaves the folder exactly as it was.
const logFile = P('run.log');
const log = (...a) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(line); appendFileSync(logFile, `${line}\n`); };
// a warning that must not scroll past: stderr, and the run log
const warn = (m) => { console.error(`\n!!! render-video: WARNING: ${m}\n`); appendFileSync(logFile, `[${new Date().toISOString().slice(11, 19)}] WARNING: ${m}\n`); };
const free = () => { const r = spawnSync('df', ['-k', OUT], { encoding: 'utf8' }).stdout.trim().split('\n').pop().split(/\s+/); return Number(r[3]) * 1024; };
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJsonAtomic = (f, o) => { writeFileSync(`${f}.part`, `${JSON.stringify(o, (_k, v) => (v === Infinity ? 'inf' : v), 2)}\n`); renameSync(`${f}.part`, f); };   // PSNR of an identical frame is inf, JSON has none

// ------------------------------------------------------------------ the look
let lookBytes = null, lookParams = {}, ARB_RECORD = null;
if (LOOK) {
  lookBytes = readFileSync(LOOK);
  const lookJson = JSON.parse(lookBytes.toString('utf8'));
  lookParams = lookJson.params || lookJson;
} else if (!ENCODE_ONLY) {
  // The network is touched here, once, before anything in --out is: a refused fetch leaves the folder as it was. Without @version this resolves the head, and the
  // version it answers with is what the run key pins (a resume that finds the head moved on is refused below). --encode-only needs no look: the key has it.
  let preset;
  try { preset = await fetchArboretum({ base: ARB_BASE, id: ARB.id, version: ARB.version, share: ARB.share, token: ARBORETUM_TOKEN }); } catch (e) {
    if (!(e instanceof ArboretumError)) throw e;
    console.error(`render-video: ${e.message}`);
    process.exit(e.refusal ? 3 : 1);
  }
  lookParams = preset.params;
  lookBytes = Buffer.from(canonicalJson(preset.params));
  // block: what the run key pins, which is what decides the frames (a version's params are fixed). fetch: the preset as this invocation fetched it, and how; a rename or a commit
  // stamp on the same version moves no frame, so it sits outside the key and a resume refreshes it.
  ARB_RECORD = {
    block: { id: preset.id, version: preset.version, params_sha256: canonicalSha256(preset.params) },
    fetch: { name: preset.name, page_url: `${ARBORETUM_BASE}/arboretum/p/${preset.id}`, komorebi_commit: preset.komorebi_commit, api_base: ARB_BASE, requested: preset.requested, head_resolved: ARB.version === null, share_token_sha256_prefix: ARB.share ? sha256(ARB.share).slice(0, 8) : null, fetched_at: new Date().toISOString() },
  };
}
const finalParams = { ...lookParams, ...overrides, adaptive_motion: false, auto_quality: false };
const nonQuality = Object.keys(overrides).filter((k) => !QUALITY_KEYS.includes(k));
if (nonQuality.length) console.warn(`render-video: WARNING — overrides outside the quality knobs: ${nonQuality.join(', ')} (the look is NOT as authored)`);

// ------------------------------------------------------------------ the run key: everything that decides the frames
const killers = [];
onExit(() => { for (const k of killers.splice(0)) { try { k(); } catch { /* already gone */ } } });
// the engine is exported (and removed again on every way out, signals included: exportEngine registers that) only for a run that renders
const exp = ENCODE_ONLY ? null : exportEngine({ ...(has('--tree') ? { tree: true } : { commit: flag('--commit') }), keep: has('--keep-export') });
const EXPORTER = exporterIdentity();
const FFMPEG_VERSION = ffmpegVersion();   // this invocation's ffmpeg; in the run key, so a run is not resumed under another one
const OSF = osFacts();
const CHROMIUM = chromiumIdentity(CHROME);

const runKeyBody = () => ({
  engine: { commit: exp.provenance.commit, kind: exp.provenance.kind, engine_sha256: exp.provenance.engine_sha256 },   // the engine modules' own hash: edits to tests/docs/harness do not move it
  exporter: EXPORTER,                                                                                                    // the page, the clock, the chains, the file layout
  os: { kernel_release: OSF.kernel_release, product_version: OSF.product_version, build_version: OSF.build_version },
  chromium: CHROMIUM,
  look_sha256: sha256(lookBytes), overrides, forced: { adaptive_motion: false, auto_quality: false },
  fps: FPS, step_ms: STEP, t0_ms: T0_MS, size: [OW, OH], ss: SS, ss_space: SS === 1 ? 'n/a' : SS_SPACE, preroll_frames: PREROLL, segment_frames: SEG_FRAMES,
  master: MASTER, master_chain: masterChain(), chrome: CHROME, ffmpeg_version: FFMPEG_VERSION,
  ...(ARB_RECORD ? { arboretum: ARB_RECORD.block } : {}),   // a look from a file has no such key, so its run keys are what they were
});
if (has('--restart') && !ENCODE_ONLY) {
  for (const d of ['seg', 'ckpt']) { rmSync(P(d), { recursive: true, force: true }); mkdirSync(P(d), { recursive: true }); }
  // manifest.json and the delivery describe the run being discarded: left behind, the next manifest would carry their measure, and a --delivery none run would probe the old file as its own
  for (const f of ['run-key.json', 'render-info.json', 'complete.json', 'master.mkv', 'hashes.txt', 'manifest.json', 'delivery.mp4', 'delivery.mp4.part']) rmSync(P(f), { force: true });
}
let RUN_KEY, RK;   // RK: run-key.json as written when the run began ({ key, body, provenance, look, invocation })
const refuse = (m) => { console.error(`render-video: ${m}`); process.exit(3); };
if (ENCODE_ONLY) {
  // The manifest of a re-encode describes the RUN, so it is built from run-key.json, never from the flags. The flags must say the same thing as the key (the look's bytes,
  // the overrides, the output settings) and the same number of frames as the segments on disk; if they do not, nothing is written.
  if (!existsSync(P('run-key.json'))) refuse(`${OUT} has no run-key.json: --encode-only needs the run that made the master`);
  RK = readJson(P('run-key.json'));
  RUN_KEY = RK.key;
  if (existsSync(P('complete.json')) && readJson(P('complete.json')).master_discarded) refuse('the master was discarded (--discard-master); re-render with --restart');
  const flags = { look_sha256: lookBytes ? sha256(lookBytes) : RK.body.look_sha256, overrides, fps: FPS, size: [OW, OH], ss: SS, ss_space: SS === 1 ? 'n/a' : SS_SPACE, preroll_frames: PREROLL, segment_frames: SEG_FRAMES, master: MASTER };
  const differs = Object.keys(flags).filter((k) => !isDeepStrictEqual(RK.body[k], flags[k]));
  const onDisk = (existsSync(P('seg')) ? readdirSync(P('seg')) : []).filter((f) => /^seg_\d+\.json$/.test(f)).map((f) => readJson(P('seg', f)));
  const framesOnDisk = onDisk.reduce((a, j) => a + j.frames, 0);
  const lines = differs.map((k) => `  ${k}: run-key.json says ${JSON.stringify(RK.body[k])}, the flags say ${JSON.stringify(flags[k])}`);
  if (ARB) {   // no fetch: --arboretum only has to NAME the preset the key holds (without a version, the key's)
    const k = RK.body.arboretum, asked = `${ARB.id}${ARB.version ? `@${ARB.version}` : ''}`;
    if (!k) lines.push(`  arboretum: run-key.json says the look was a file, the flags say preset ${asked}`);
    else if (k.id !== ARB.id || (ARB.version !== null && k.version !== ARB.version)) lines.push(`  arboretum: run-key.json says preset ${k.id}@${k.version}, the flags say ${asked}`);
  }
  if (onDisk.length !== nSegs || framesOnDisk !== N) lines.push(`  --seconds ${SECONDS}: the flags make ${N} frames in ${nSegs} segments, the folder holds ${framesOnDisk} frames in ${onDisk.length} segments`);
  if (lines.length) refuse(`--encode-only: the flags do not describe the run in ${OUT}; the manifest would misdescribe its frames. What differs:\n${lines.join('\n')}\n  (run-key ${RUN_KEY})`);
} else {
  const body = runKeyBody();
  RUN_KEY = sha256(JSON.stringify(body));
  if (existsSync(P('run-key.json'))) {
    RK = readJson(P('run-key.json'));
    if (RK.key !== RUN_KEY) {
      const changed = Object.keys(body).filter((k) => JSON.stringify(RK.body[k]) !== JSON.stringify(body[k]))
        .map((k) => (k === 'exporter' ? `exporter (${Object.keys(body.exporter).filter((f) => body.exporter[f] !== RK.body.exporter?.[f]).join(', ') || 'was not recorded'})`
          : k === 'arboretum' ? `arboretum (${Object.keys(body.arboretum).filter((f) => !isDeepStrictEqual(body.arboretum[f], RK.body.arboretum?.[f])).join(', ') || 'was not recorded'})` : k));
      const was = RK.body.arboretum, now = body.arboretum;
      const moved = was && now && was.id === now.id && was.version !== now.version
        ? `\n  the preset moved on: this run is ${was.id}@${was.version}, ${ARB.version ? 'the flags name' : 'the head is now'} ${now.id}@${now.version}. Resume it with --arboretum ${was.id}@${was.version}, or --restart to render the new version.` : '';
      console.error(`render-video: ${OUT} holds a run with a different key. What differs: ${changed.join(', ')}.${moved}\n  old ${RK.key}\n  new ${RUN_KEY}\n  --restart discards it.`);
      process.exit(3);
    }
    if (ARB_RECORD) {   // the key matched: the frames are these; the preset's name or commit may have moved since, and the record follows it
      RK = { ...RK, look: { ...RK.look, name: ARB_RECORD.fetch.name }, arboretum_fetch: ARB_RECORD.fetch };
      writeJsonAtomic(P('run-key.json'), RK);
    }
  } else {
    // look and invocation sit beside the body: the key is the frames' identity, these say where the look file was and how the render was launched
    RK = { key: RUN_KEY, body, provenance: exp.provenance, look: ARB_RECORD ? { path: null, name: ARB_RECORD.fetch.name, source: 'arboretum' } : { path: resolve(LOOK), name: basename(LOOK) },
      ...(ARB_RECORD ? { arboretum_fetch: ARB_RECORD.fetch } : {}), invocation: { argv: redactArgv(argv), at: new Date().toISOString(), node: process.version } };
    mkdirSync(OUT, { recursive: true });
    writeJsonAtomic(P('run-key.json'), RK);
  }
  // the key is this run's: now the folder may be written to (look.json is the look as rendered, so a refused rerun must never rewrite it)
  mkdirSync(P('seg'), { recursive: true });
  mkdirSync(P('ckpt'), { recursive: true });
  writeFileSync(P('look.json'), `${JSON.stringify(finalParams, null, 2)}\n`);
}

const PAGE_SHA = RK.body.exporter?.video_html_sha256;   // the page the key names (an older key without it: nothing to compare, the check then fails loudly)

// ------------------------------------------------------------------ segment bookkeeping (a segment is done when its ckpt AND its json exist)
const segJson = (i) => readJson(P('seg', `${segName(i)}.json`));
const segDone = (i) => { try { return existsSync(segFile(i)) && existsSync(P('seg', `${segName(i)}.hashes`)) && statSync(segFile(i)).size === segJson(i).file_bytes; } catch { return false; } };   // a half-written json is not done
const segRange = (i) => ({ from: PREROLL + i * SEG_FRAMES, to: PREROLL + Math.min(N, (i + 1) * SEG_FRAMES) });
const ckptFile = (n) => P('ckpt', `ckpt_${String(n).padStart(9, '0')}.json`);
// a segment is only trusted if every one before it is done too, and the checkpoint at its end exists
const firstTodoSeg = () => { let k = 0; while (k < nSegs && segDone(k) && existsSync(ckptFile(segRange(k).to))) k++; return k; };

// ------------------------------------------------------------------ disk: the peak of THIS run
// The segments are the master (one copy; --merge-master adds a second), then the delivery on top (video-lib.mjs diskPlan: the figures it is built on).
const deliveryMbit = () => estimateDeliveryMbit({ codec: DELIVERY, vtQuality: VT_QUALITY, vtBitrate: VT_BITRATE });   // an upper bound: the bitrate's cap, -q:v's measured worst case
function checkDisk(framesToRender) {
  const plan = diskPlan({ framesToRender, frames: N, fps: FPS, ow: OW, oh: OH, merge: MERGE && !mergedPresent(), deliveryMbit: deliveryMbit() }), g = (b) => (b / 2 ** 30).toFixed(1);
  log(`disk: ${g(free())} GiB free; this run adds about ${g(plan.total)} GiB at its peak (segments ${g(plan.segments)}${plan.merged ? `, merged master ${g(plan.merged)}` : ''}, delivery ${g(plan.delivery)}, 1 GiB margin)`);
  // N / FPS and the rate bound are known now: a long run learns here that its delivery may not fit a FAT32 stick, not after hours of rendering
  const fat32 = fat32Forecast({ seconds: N / FPS, mbit: deliveryMbit() });
  if (fat32) warn(fat32);
  if (free() < plan.total) throw new Error(`disk: ${g(free())} GiB free, this run needs about ${g(plan.total)} GiB at its peak`);
}

// ------------------------------------------------------------------ render-info.json: what rendered the frames, written the moment the first session is up
const RI_FILE = P('render-info.json');
let ri = existsSync(RI_FILE) && !ENCODE_ONLY && readJson(RI_FILE).run_key === RUN_KEY ? readJson(RI_FILE) : null;
const fatal = (m) => Object.assign(new Error(m), { fatal: true });
async function recordSession(session, openInfo, firstSegment) {
  const browser = await browserFacts(session.browser);
  const launch = { variant: session.launch.variant, channel: session.launch.channel, args: session.launch.args };
  if (!ri) {
    ri = { written_at: new Date().toISOString(), run_key: RUN_KEY, renderer: openInfo.renderer, launch, browser, open_info: openInfo, os: OSF,
      host: { cpu: OSF.cpu, node: process.version, platform: `${process.platform}/${process.arch}`, load_at_start: os.loadavg() }, sessions: [], retries: [] };
  } else if (ri.renderer !== openInfo.renderer || ri.browser?.version !== browser.version || ri.browser?.angle !== browser.angle) {
    throw fatal(`this session's renderer / Chromium / ANGLE (${openInfo.renderer} | ${browser.version} | ${browser.angle}) is not the run's (${ri.renderer} | ${ri.browser?.version} | ${ri.browser?.angle}); --restart`);
  }
  ri.sessions.push({ at: new Date().toISOString(), first_segment: firstSegment, load: os.loadavg()[0], page_sha256: session.pageSha });
  writeJsonAtomic(RI_FILE, ri);
}
const recordRetry = (r) => { if (ri) { ri.retries.push(r); writeJsonAtomic(RI_FILE, ri); } };

// ------------------------------------------------------------------ render
async function renderAll(firstTodo) {
  if (firstTodo < nSegs) {   // an older master / completion mark is stale as soon as a segment is redone
    for (const f of ['master.mkv', 'complete.json']) rmSync(P(f), { force: true });
    for (let i = firstTodo; i < nSegs; i++) for (const e of ['mkv', 'hashes', 'json']) rmSync(P('seg', `${segName(i)}.${e}`), { force: true });
  }
  if (firstTodo === nSegs) { log(`all ${nSegs} segments already done`); return; }
  log(`resuming at segment ${firstTodo}/${nSegs} (${firstTodo ? `checkpoint ${segRange(firstTodo - 1).to}` : 'from the pre-roll'})`);

  const sinks = new Map();
  const srv = await startServer({ engineRoot: exp.dir, sinks });
  killers.push(() => srv.server.close());
  const frameBytes = RW * RH * 4;
  const batch = Math.max(1, Math.min(8, Math.floor((64 << 20) / frameBytes)));
  const params = finalParams;
  let session = null;   // { browser, page, launch }
  const closeSession = async () => { if (session) { try { await session.browser.close(); } catch { /* gone */ } session = null; } };
  killers.push(() => { session?.browser.close().catch(() => {}); });

  const openSession = async (atPump, state) => {
    const b = await launchBrowser(chromium, CHROME);
    if (b.browser.version() !== CHROMIUM.version) { await b.browser.close(); throw fatal(`Chromium ${b.browser.version()} launched, the run key says ${CHROMIUM.version}`); }
    const page = await openPage(b.browser, srv.port);
    // video.html is read live at every page load: what this session was handed must be the page the key names
    try { assertServedPage(srv.served, PAGE_SHA); } catch (e) { await b.browser.close(); throw fatal(e.message); }
    session = { browser: b.browser, page, launch: b, pageSha: srv.served.get(PAGE_KEY) };
    return page.evaluate((o) => window.__v.open(o), { params, rw: RW, rh: RH, step: STEP, T0: T0_MS, at: atPump, state, overrideKeys: Object.keys(overrides) });
  };

  let startState, startAt;
  if (firstTodo === 0) {
    // the pre-roll: the integrator state after PREROLL discarded frames, from a tiny engine (proved equal to the full-size one by gpu-probe.mjs)
    if (!existsSync(ckptFile(PREROLL))) {
      const b = await launchBrowser(chromium, CHROME);
      killers.push(() => b.browser.close().catch(() => {}));
      try {
        const page = await openPage(b.browser, srv.port);
        assertServedPage(srv.served, PAGE_SHA);
        const t = Date.now();
        const r = await page.evaluate(([p, n, s, T]) => window.__v.cheapPreroll(p, n, s, T), [params, PREROLL, STEP, T0_MS]);
        if (!r.info.motionActive) log('WARNING: the springs are at rest after the pre-roll (motion not active): this look is calm');
        writeFileSync(ckptFile(PREROLL), JSON.stringify({ at: PREROLL, state: r.state }));
        log(`pre-roll: ${PREROLL} frames integrated in ${Date.now() - t} ms, motion.time ${r.info.motion_time}`);
      } finally { await b.browser.close().catch(() => {}); }
    }
    ({ state: startState } = readJson(ckptFile(PREROLL))); startAt = PREROLL;
  } else {
    const c = readJson(ckptFile(segRange(firstTodo - 1).to));
    startState = c.state; startAt = c.at;
  }

  const t0 = Date.now();
  const attempts = new Map(), injected = new Map();   // per segment
  let doneSegs = 0, state = startState, at = startAt;
  for (let i = firstTodo; i < nSegs; ) {
    const { from, to } = segRange(i);
    const frames = to - from;
    if (at !== from) throw new Error(`internal: state is at ${at}, segment ${i} starts at ${from}`);
    let ff = null;
    try {
      if (!session) {
        const openInfo = await openSession(at, state);
        await recordSession(session, openInfo, i);
        log(`browser up: ${openInfo.renderer}; canvas ${openInfo.canvas} drawingBuffer ${openInfo.drawingBuffer}; bake ${openInfo.bakeRes} samples ${openInfo.samples}`);
        if (!/metal/i.test(openInfo.renderer) || /swiftshader/i.test(openInfo.renderer)) throw new Error(`renderer is not Metal: ${openInfo.renderer}`);
      }
      const file = segFile(i);
      ff = spawnFfmpeg(segArgs(file, frames));
      const thisFf = ff;
      killers.push(() => thisFf.kill());
      if ((injected.get(i) ?? 0) < (INJECT[i] ?? 0)) { injected.set(i, (injected.get(i) ?? 0) + 1); throw new Error(`injected failure in segment ${i}`); }
      const counter = { bytes: 0, last: Date.now() };
      sinks.set('seg', async (req, res) => { await pipeRequestTo(req, thisFf, counter); counter.last = Date.now(); res.writeHead(200).end('ok'); });
      const watchdog = setInterval(() => { if (Date.now() - counter.last > 15 * 60e3) { log('watchdog: no frames for 15 min, killing the browser'); session?.browser.close().catch(() => {}); } }, 30e3);
      const ts = Date.now();
      let r;
      try { r = await session.page.evaluate(([f, t, bt, sk]) => window.__v.run({ from: f, to: t, batch: bt, sink: sk }), [from, to, batch, '/__sink/seg']); }
      finally { clearInterval(watchdog); }
      const renderMs = Date.now() - ts;
      const done = await ff.end();
      if (done.code !== 0) throw new Error(`ffmpeg segment ${i} exited ${done.code}: ${done.stderrTail}`);
      if (counter.bytes !== frames * frameBytes) throw new Error(`segment ${i}: ${counter.bytes} bytes reached ffmpeg, expected ${frames * frameBytes}`);
      if (r.hashes.length !== frames) throw new Error(`segment ${i}: ${r.hashes.length} hashes for ${frames} frames`);
      const packets = countPackets(file);
      if (packets !== frames) throw new Error(`segment ${i}: ffprobe counts ${packets} packets, expected ${frames}`);
      // commit: hashes, checkpoint, then the json that says "done"
      writeFileSync(P('seg', `${segName(i)}.hashes`), `${r.hashes.map((h, k) => `${from + k + 1 - PREROLL} ${h}`).join('\n')}\n`);
      writeFileSync(ckptFile(to), JSON.stringify({ at: to, state: r.snapshot }));
      writeFileSync(P('seg', `${segName(i)}.json`), JSON.stringify({ segment: i, first_frame: from - PREROLL, frames, pumps: [from + 1, to], bytes_piped: counter.bytes, packets, file_bytes: statSync(file).size, file_sha256: await sha256File(file), render_wall_ms: renderMs, ffmpeg_version: FFMPEG_VERSION, page_sha256: session.pageSha, ffmpeg_args: ff.args, hashes_sha256: sha256(readFileSync(P('seg', `${segName(i)}.hashes`))), minMean: r.minMean, maxMean: r.maxMean }, null, 2));
      state = r.snapshot; at = to; doneSegs++; i++;
      const elapsed = (Date.now() - t0) / 1000, perFrame = renderMs / frames, left = (nSegs - i) * SEG_FRAMES * perFrame / 1000;
      log(`segment ${i - 1}/${nSegs - 1}: ${frames} frames, ${fmt(perFrame)} ms/frame (${fmt(1000 / perFrame)} fps), ${(statSync(file).size / 2 ** 20).toFixed(1)} MiB lossless, load ${os.loadavg()[0].toFixed(1)}, elapsed ${fmt(elapsed, 0)} s, ETA ${fmt(left, 0)} s`);
      if (ABORT_AFTER_SEG !== null && doneSegs >= ABORT_AFTER_SEG) { log(`--abort-after-seg ${ABORT_AFTER_SEG}: dying without cleanup`); process.kill(process.pid, 'SIGKILL'); }
    } catch (e) {
      if (e.fatal) { await closeSession(); throw e; }
      const n = (attempts.get(i) ?? 0) + 1; attempts.set(i, n);
      const msg = String(e.message || e).split('\n')[0];
      log(`segment ${i} FAILED (attempt ${n}/${MAX_ATTEMPTS}): ${msg}${session?.page?.pageLog?.length ? ` | page: ${session.page.pageLog.slice(0, 3).join(' ; ')}` : ''}`);
      recordRetry({ at: new Date().toISOString(), segment: i, attempt: n, error: msg });
      await closeSession();                                 // the browser first: nothing posts to the sink any more
      if (ff) { ff.kill(); await ff.exited; }               // then the failed segment's ffmpeg, so it neither lingers nor holds the segment file
      sinks.delete('seg');
      for (const ext of ['mkv', 'hashes', 'json']) rmSync(P('seg', `${segName(i)}.${ext}`), { force: true });
      if (n >= MAX_ATTEMPTS) throw e;
      // the failed segment is redone from the checkpoint that opens it (`state`/`at` still hold it)
    }
  }
  await closeSession();
  await srv.close();
}

// ------------------------------------------------------------------ the master is the segment set: verify it, list it, checksum it
let seg0Args = null;   // the ffmpeg arguments segment 0 was really made with (its json), for the manifest
async function recordMaster() {
  const present = segsPresent();
  const segs = [];
  for (let i = 0; i < nSegs; i++) {
    const j = segJson(i);
    if (i === 0) seg0Args = j.ffmpeg_args ?? null;
    let sha = j.file_sha256 ?? null, origin = 'segment json (written at render)';
    if (sha === null) origin = present ? 'computed at encode time (the segment json predates file_sha256)' : 'not recorded (the segment json predates file_sha256 and the segment file is gone)';
    if (present) {
      const h = await sha256File(segFile(i));
      if (sha !== null && h !== sha) throw new Error(`segment ${i} (${segFile(i)}) is not the file that was written: sha256 ${h}, recorded ${sha}`);
      sha ??= h;
    }
    segs.push({ file: `seg/${segName(i)}.mkv`, first_frame: j.first_frame, frames: j.frames, packets: j.packets, bytes: j.file_bytes, sha256: sha, sha256_origin: origin, hashes_sha256: j.hashes_sha256, bytes_piped: j.bytes_piped, render_wall_ms: j.render_wall_ms, ffmpeg_version: j.ffmpeg_version ?? null, page_sha256: j.page_sha256 ?? null });
  }
  const lateHashed = segs.filter((s) => s.sha256_origin !== 'segment json (written at render)').length;
  if (lateHashed) log(`WARNING: ${lateHashed}/${nSegs} segment jsons have no file_sha256 (made before the exporter hashed its segments): the hashes below are computed now, so they describe the files as they are, not as they were written`);
  if (present) {
    writeFileSync(LIST, concatListText(segs.map((s) => basename(s.file))));   // names relative to the list, so the folder can be moved or copied
    writeFileSync(SUMS, `${segs.map((s) => `${s.sha256}  ${basename(s.file)}`).join('\n')}\n`);
  }
  writeFileSync(P('hashes.txt'), Array.from({ length: nSegs }, (_, i) => readFileSync(P('seg', `${segName(i)}.hashes`), 'utf8')).join(''));
  return segs;
}

async function mergeMaster() {
  if (mergedPresent()) return;
  const r = await runFfmpegAsync(['-f', 'concat', '-safe', '0', '-i', LIST, '-c', 'copy', '-f', 'matroska', '-y', P('master.mkv.part')], { onChild: (p) => killers.push(() => p.kill('SIGKILL')) });
  if (r.code !== 0) throw new Error(`merge failed: ${r.stderr}`);
  renameSync(P('master.mkv.part'), P('master.mkv'));
}

const colourTags = (file, inputOpts = []) => {
  const j = ffprobeJson(file, inputOpts);
  const s = j.streams.find((x) => x.codec_type === 'video');
  return { codec: s.codec_name, codec_tag: s.codec_tag_string, pix_fmt: s.pix_fmt, width: s.width, height: s.height, r_frame_rate: s.r_frame_rate, avg_frame_rate: s.avg_frame_rate, nb_frames: s.nb_frames, duration: s.duration, bit_rate: s.bit_rate, profile: s.profile, level: s.level, color_range: s.color_range, color_space: s.color_space, color_transfer: s.color_transfer, color_primaries: s.color_primaries, format_duration: j.format.duration, size: Number(j.format.size) };
};

const man = {};   // manifest parts made by the steps below
async function deliver() {
  if (DELIVERY === 'none') return;
  // written under a temp name and renamed when the encode succeeds: a failed or killed encode never leaves a delivery.mp4 (a 0-byte stub breaks the next ffprobe) and never
  // replaces a good one
  const part = P('delivery.mp4.part');
  rmSync(part, { force: true });
  killers.push(() => rmSync(part, { force: true }));
  const args = deliveryArgv(masterInput(), part);
  const t = Date.now();
  const r = await runFfmpegAsync(args, { onChild: (p) => killers.push(() => p.kill('SIGKILL')) });
  if (r.code !== 0) { rmSync(part, { force: true }); throw new Error(`delivery encode failed: ${r.stderr.slice(-2000)}`); }
  renameSync(part, P('delivery.mp4'));
  // the command that makes delivery.mp4, as --print-ffmpeg prints it (runnable from the run folder); the .part step and the absolute list it really ran are beside it
  man.delivery_command = [FFMPEG, ...deliveryArgv(segsPresent() ? CONCAT_INPUT('seg/list.txt') : ['-i', 'master.mkv'], 'delivery.mp4')].join(' ');
  man.delivery_command_as_run = [FFMPEG, ...args].join(' ');
  man.delivery = { codec: DELIVERY, written_as: 'delivery.mp4.part, renamed to delivery.mp4 when the encode succeeded', source: segsPresent() ? 'the lossless segments through the concat demuxer (seg/list.txt)' : 'master.mkv', encode_wall_s: (Date.now() - t) / 1000, trc_tag: TRC, bitrate_arg: DELIVERY === 'hevc_videotoolbox' && !VT_QUALITY ? VT_BITRATE : undefined, maxrate_arg: DELIVERY === 'hevc_videotoolbox' && !VT_QUALITY ? scaleRate(VT_BITRATE, VT_MAXRATE_X) : undefined, bufsize_arg: DELIVERY === 'hevc_videotoolbox' && !VT_QUALITY ? scaleRate(VT_BITRATE, VT_BUFSIZE_X) : undefined, quality_arg: DELIVERY === 'hevc_videotoolbox' && VT_QUALITY ? VT_QUALITY : undefined, crf: DELIVERY === 'libx265' ? X265_CRF : undefined, preset: DELIVERY === 'libx265' ? X265_PRESET : undefined, gop: GOP };
}

async function stills() {
  const run = async (args, what) => { const r = await runFfmpegAsync(args, { onChild: (p) => killers.push(() => p.kill('SIGKILL')) }); if (r.code !== 0) throw new Error(`still ${what}: ${r.stderr}`); };
  for (const t of STILLS) {
    const n = Math.round(t * FPS), tag = `${String(t).padStart(2, '0')}s`;
    // the delivery's still is what a player shows: yuv420p -> rgb with the same chroma upsampling as measure()
    if (man.delivery_probe && !man.delivery_probe.error) await run(['-i', P('delivery.mp4'), '-vf', `select=eq(n\\,${n}),${PLAYER_RGB},format=rgb24`, '-frames:v', '1', '-fps_mode', 'passthrough', '-y', P(`still-${tag}.png`)], `${t}s of the delivery`);
    // the master's: from the segment that holds the frame (a segment set is not decoded from its start)
    const k = Math.floor(n / SEG_FRAMES), src = segsPresent() ? ['-i', segFile(k)] : ['-i', P('master.mkv')], local = segsPresent() ? n - k * SEG_FRAMES : n;
    await run([...src, '-vf', `select=eq(n\\,${local}),format=rgb24`, '-frames:v', '1', '-fps_mode', 'passthrough', '-y', P(`master-still-${tag}.png`)], `${t}s of the master`);
  }
}

// ------------------------------------------------------------------ the manifest: built from files (run-key.json, render-info.json, the segment jsons), the same in every branch
// Everything that says WHAT the frames are (look, overrides, output, clock, chain) comes from the run key K, never from this invocation's flags: on --encode-only the flags are
// only checked against it (above). What only this invocation can say (the delivery, the measure, the stills, its argv, its ffmpeg) is labelled as this invocation's.
function buildManifest({ segs, mpackets, masterProbe, mergedSha }) {
  const K = RK.body, kOverrides = K.overrides, nonQuality = Object.keys(kOverrides).filter((k) => !QUALITY_KEYS.includes(k)), kOut = { fps: K.fps, size: K.size, ss: K.ss, space: K.ss_space };
  const renderInfo = existsSync(RI_FILE) ? readJson(RI_FILE) : null;
  const prev = existsSync(P('manifest.json')) ? readJson(P('manifest.json')) : null;   // only for a run from before render-info.json existed
  const walls = segs.map((s) => s.render_wall_ms), frameCount = segs.reduce((a, s) => a + s.frames, 0), wallSum = walls.reduce((a, b) => a + b, 0);
  const piped = segs.reduce((a, s) => a + s.bytes_piped, 0) / (RW * RH * 4);
  const setSha = segs.every((s) => s.sha256) ? sha256(`${segs.map((s) => `${s.sha256}  ${basename(s.file)}`).join('\n')}\n`) : null;
  const lateHashed = segs.filter((s) => s.sha256_origin !== 'segment json (written at render)').length;
  const q = man.quality_vs_master;   // this invocation's measure: the frame accounting counts only what it measured itself
  // Without --measure the previous manifest's numbers are kept, marked, rather than dropped: they describe the delivery as it was when they were measured. Only this run's own
  // manifest (same run key) is trusted with them; numbers measured on another look, preset version or engine are never labelled as this one's.
  const was = prev?.run_key === RUN_KEY ? prev.quality_vs_master : undefined, wasCarried = was?.carried_over;
  const quality = q ?? (was && {
    ...was,
    carried_over: {
      from_manifest_made_at: wasCarried?.from_manifest_made_at ?? prev.made_at,
      delivery_reencoded_since: Boolean(man.delivery) || wasCarried?.delivery_reencoded_since === true,
      note: 'this invocation did not run --measure; these are the numbers of the invocation that did, for the delivery as it was then (delivery_reencoded_since says whether a new one has been encoded since)',
    },
  });
  const fa = {
    frames_requested: N, frames_piped_to_ffmpeg: piped, master_packets: mpackets, delivery_decoded_frames: man.delivery_probe?.decoded_frames ?? null,
    measure_frames_compared: q?.frames_compared ?? null, baseline_frames_compared: q?.encoder_free_baseline?.frames_compared ?? null,
  };
  // an unreadable delivery.mp4 has no decoded_frames (null): the accounting cannot be exact
  fa.exact = mpackets === N && piped === N && (man.delivery_probe ? man.delivery_probe.decoded_frames === N : true) && (q ? q.frames_compared === N && q.encoder_free_baseline.frames_compared === N : true);
  const lookPath = RK.look?.path ?? (prev?.look?.sha256 === K.look_sha256 ? prev.look.path : null);   // a path is only the look's if its bytes are the key's
  const manifest = {
    tool: 'test-gl/render-video.mjs', made_at: new Date().toISOString(), run_key: RUN_KEY,
    exporter: RK?.body.exporter ?? prev?.exporter ?? null,
    exporter_this_invocation: EXPORTER,
    engine: RK.provenance ?? prev?.engine, look: { path: lookPath, sha256: K.look_sha256, name: RK.look?.name ?? (lookPath ? basename(lookPath) : null), ...(K.arboretum ? { source: 'arboretum' } : {}) },
    // the preset the look came from (the key's block, and how it was fetched); the token and the share token are in neither
    ...(K.arboretum ? { arboretum: { ...K.arboretum, ...RK.arboretum_fetch } } : {}),
    overrides: kOverrides, look_changes_are_quality_only: nonQuality.length === 0,
    look_statement: nonQuality.length ? `NOT as authored: ${nonQuality.join(', ')} changed` : `the look is as authored; only the quality knobs ${Object.keys(kOverrides).join(', ') || '(none)'} are overridden, plus the two governors forced off (adaptive_motion=false, auto_quality=false)`,
    output: {
      fps: kOut.fps, frames: N, seconds: N / kOut.fps, size: kOut.size, render_size: [kOut.size[0] * kOut.ss, kOut.size[1] * kOut.ss], ss: kOut.ss,
      ss_downscale: kOut.ss === 1 ? null : {
        space: kOut.space, chain: K.master_chain,
        filter: kOut.space === 'linear' ? 'each plane scaled on its own as gray16 (extractplanes, scale flags=area+accurate_rnd, mergeplanes): a k x k box average, no channel mixing' : 'scale flags=area+accurate_rnd+full_chroma_int on the 8-bit display codes: a k x k box average',
        known_limits: kOut.space === 'linear' ? linearKnownLimits(kOut.ss) : [],
      },
    },
    clock: { step_ms: K.step_ms, fps_implied: 1000 / K.step_ms, t0_ms: K.t0_ms, preroll_frames: K.preroll_frames, preroll_seconds: K.preroll_frames / K.fps, note: 'dyadic step: every stamp exact, dt one constant double, ceil(dt/(1/120)) constant; sim time runs 3.8e-8 slow (5 minutes lose 11 microseconds)' },
    master: {
      kind: 'segment-set', note: 'the master IS the lossless segment set: seg/list.txt (ffmpeg concat demuxer) + seg/SHA256SUMS; there is no merged second copy unless merged is set',
      codec: K.master, args: masterCodecArgs(), frames: frameCount, total_bytes: segs.reduce((a, s) => a + s.bytes, 0),
      sha256_note: lateHashed ? `${lateHashed} of ${segs.length} segment jsons predate file_sha256: those hashes were computed by this invocation from the files on disk, so they cannot show a change since the render (the frame hashes in hashes.txt can)` : null,
      list: 'seg/list.txt', checksums: 'seg/SHA256SUMS', set_sha256: setSha, segments_on_disk: segsPresent(), segments: segs,
      read_command: `${FFMPEG} -f concat -safe 0 -i seg/list.txt ...`,
      merged: mergedSha ? { file: 'master.mkv', sha256: mergedSha, how: 'stream copy of the segments' } : null,
    },
    // version: the ffmpeg of THIS invocation (the delivery, the stills, the measure); master_version: the one that made the segments (the key's; each segment's own is in master.segments)
    ffmpeg: { version: FFMPEG_VERSION, master_version: K.ffmpeg_version ?? null, binary: FFMPEG, segment_command: [FFMPEG, ...(seg0Args ?? segArgs('seg_NNNNN.mkv', SEG_FRAMES))].join(' '), delivery_command: man.delivery_command ?? prev?.ffmpeg?.delivery_command, delivery_command_as_run: man.delivery_command_as_run ?? prev?.ffmpeg?.delivery_command_as_run },
    // invocation: how the run was launched (run-key.json; null where the key predates it), invocation_this_manifest: the run that wrote this file
    invocation: RK.invocation ? { ...RK.invocation, os: RK.body.os } : { argv: null, note: 'run-key.json does not record the rendering invocation (a run from before it did)' },
    invocation_this_manifest: { argv: redactArgv(argv), node: process.version, load: os.loadavg(), os: OSF },
    // what rendered the frames (render-info.json: written when the first browser was up, not rebuilt by a rerun)
    os: renderInfo?.os ?? prev?.os ?? null,
    host: renderInfo?.host ?? prev?.host ?? null,
    renderer: renderInfo?.renderer ?? prev?.renderer,
    launch: renderInfo?.launch ?? prev?.launch,
    browser: renderInfo?.browser ?? prev?.browser,
    open_info: renderInfo?.open_info ?? prev?.open_info,
    render: renderInfo ? {
      segments: nSegs, frames: frameCount, batch_frames: Math.max(1, Math.min(8, Math.floor((64 << 20) / (RW * RH * 4)))),
      render_wall_s: wallSum / 1000, ms_per_frame_mean: wallSum / frameCount, ms_per_frame_min_max_segment: [Math.min(...segs.map((s) => s.render_wall_ms / s.frames)), Math.max(...segs.map((s) => s.render_wall_ms / s.frames))],
      sessions: renderInfo.sessions.length, retries: renderInfo.retries.length, retry_log: renderInfo.retries,
    } : prev?.render,
    hashes: { file: 'hashes.txt', sha256: sha256(readFileSync(P('hashes.txt'))), frames: N, per_segment: segs.map((s) => ({ file: `seg/${basename(s.file, '.mkv')}.hashes`, sha256: s.hashes_sha256 })) },
    master_probe: masterProbe,
    delivery: man.delivery ?? prev?.delivery, delivery_probe: man.delivery_probe, delivery_fat32: man.delivery_fat32, quality_vs_master: quality,
    frame_accounting: fa,
    notes: [
      'transfer tag: the delivery is tagged bt709 / bt709 / bt709, tv range (--trc); it can be retagged later with -c copy and hevc_metadata',
      'HEVC level: left as VideoToolbox writes it (delivery_probe.level); the exporter does not set it',
      'quality_vs_master pairs frame i with frame i (settb/setpts=N on both inputs); the delivery is read back to RGB with the same player-grade chroma upsampling as the stills',
    ],
  };
  return { manifest, fa, setSha };
}

// ------------------------------------------------------------------ main
const completeFile = P('complete.json');
const alreadyComplete = !has('--restart') && !ENCODE_ONLY && existsSync(completeFile) && (segsPresent() || mergedPresent()) && readJson(completeFile).key === RUN_KEY;
const skipRender = ENCODE_ONLY || alreadyComplete;
// a completed run whose master was discarded has no segments, so alreadyComplete (which wants them) is false: it is answered here, before anything would re-render from the missing segments
const discardedComplete = !has('--restart') && !ENCODE_ONLY && existsSync(completeFile) && (() => { const c = readJson(completeFile); return c.key === RUN_KEY && c.master_discarded === true; })();
try {
  if (discardedComplete) {
    for (let i = 0; i < nSegs; i++) rmSync(segFile(i), { force: true });   // a run that died between complete.json and the last delete finishes the job
    log('the run is already complete (complete.json matches this run key) and its master was discarded (--discard-master): nothing to render or encode; --restart renders it again');
    process.exit(0);
  }
  const firstTodo = skipRender ? nSegs : firstTodoSeg();
  checkDisk(Math.max(0, N - firstTodo * SEG_FRAMES));
  if (!skipRender) await renderAll(firstTodo);
  else log(alreadyComplete ? 'the run is already complete (complete.json matches this run key): re-using the master' : '--encode-only: using the master already in the output folder');
  const segs = await recordMaster();
  let mergedSha = existsSync(P('master.mkv')) && existsSync(P('manifest.json')) ? readJson(P('manifest.json')).master?.merged?.sha256 ?? null : null;   // a merged master from an earlier run of this folder
  if (MERGE) { await mergeMaster(); mergedSha = await sha256File(P('master.mkv')); }
  const mpackets = segsPresent() ? countPackets(LIST, ['-f', 'concat', '-safe', '0']) : countPackets(P('master.mkv'));   // an independent count over the whole set
  const masterBytes = segs.reduce((a, s) => a + s.bytes, 0);
  const masterProbe = { ...colourTags(segsPresent() ? segFile(0) : P('master.mkv')), packets: mpackets, size_mib: masterBytes / 2 ** 20, mib_per_10s: masterBytes / 2 ** 20 / (N / FPS / 10), note: 'codec fields from the first segment; packets counted over the whole set; size is the sum of the segments' };
  await deliver();
  if (existsSync(P('delivery.mp4'))) {
    try {
      man.delivery_probe = { ...colourTags(P('delivery.mp4')), decoded_frames: countFrames(P('delivery.mp4')), size_mib: statSync(P('delivery.mp4')).size / 2 ** 20, mbit_s: (statSync(P('delivery.mp4')).size * 8) / (N / FPS) / 1e6 };
    } catch (e) {   // a stub or a damaged file: the manifest still gets written, saying so
      man.delivery_probe = { error: String(e.message || e).split('\n')[0], decoded_frames: null };
      log(`delivery.mp4 is not readable (${man.delivery_probe.error.slice(-120)}): recorded as such, the frame accounting cannot be exact; re-encode it`);
    }
    man.delivery_fat32 = fat32Report(statSync(P('delivery.mp4')).size, { seconds: N / FPS });
    if (!man.delivery_fat32.fits) warn(man.delivery_fat32.warning);
    if (has('--measure') && !man.delivery_probe.error) {
      const onChild = (p) => killers.push(() => p.kill('SIGKILL'));
      const vs = await runMeasure({ delivery: P('delivery.mp4'), input: masterInput(), cwd: OUT, fps: FPS, onChild });
      // the same numbers with no encoder: the format's own loss, so the delivery's can be split into format and encoder
      const base = await runBaseline({ input: masterInput(), cwd: OUT, fps: FPS, trc: TRC, onChild });
      man.quality_vs_master = qualityReport(vs, base);
    }
  }
  await stills();
  const { manifest, fa, setSha } = buildManifest({ segs, mpackets, masterProbe, mergedSha });
  // the delivery is encoded and probed, the stills and the measure have read the master: only an EXACT accounting lets the segments go
  const discarding = DISCARD && fa.exact;
  if (discarding) Object.assign(manifest.master, { segments_on_disk: false, discarded: true, discarded_at: new Date().toISOString() });
  writeJsonAtomic(P('manifest.json'), manifest);
  if ((!skipRender || discarding) && fa.exact) {
    writeFileSync(completeFile, JSON.stringify({ key: RUN_KEY, frames: N, master_set_sha256: setSha, ...(discarding ? { master_discarded: true } : {}), at: new Date().toISOString() }));
    if (discarding) { for (let i = 0; i < nSegs; i++) rmSync(segFile(i), { force: true }); log('master discarded (--discard-master): seg/*.mkv deleted; the lists, checksums, segment records, checkpoints and hashes stay'); }
    if (has('--drop-segments')) { for (let i = 0; i < nSegs; i++) rmSync(segFile(i), { force: true }); log('segments dropped (seg/*.mkv); master.mkv, hashes, checkpoints and the lists stay'); }
  }
  log(`done: ${N} frames; master ${mpackets} packets in ${nSegs} segments (${manifest.master_probe.size_mib.toFixed(0)} MiB)${mergedSha ? ' + merged master.mkv' : ''}; delivery ${man.delivery_probe && !man.delivery_probe.error ? `${man.delivery_probe.decoded_frames} frames, ${man.delivery_probe.size_mib.toFixed(1)} MiB, ${man.delivery_probe.mbit_s.toFixed(1)} Mbit/s` : 'none'}; frame accounting ${fa.exact ? 'EXACT' : 'MISMATCH'}`);
  if (!fa.exact) process.exitCode = 4;
} catch (e) {
  log(`FAILED: ${e.stack || e}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);   // everything is awaited by here; the exit handlers close what is left (server, browser, ffmpeg)
