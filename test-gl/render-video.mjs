// The headless GPU video exporter: one look -> frame-stepped Metal render in Chromium -> raw frames over a local POST -> ffmpeg.
// Linux uses --chrome chromium+angle-vulkan+enable-gpu with --delivery hevc_vaapi (libx265 for a CPU master encode, none for stills); software renderers are refused.
// --delivery hevc_vaapi encodes on the AMD GPU at 60M (75M cap, 120M buffer), including gpu/gpu-main10 capture; VideoToolbox controls do not apply.
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
//   --playlist-json <f>    instead of ONE look, a PLAYLIST: the engine walks its looks with transitionTo, the way arboretum plays one (dwell, then a fade over the NEXT look's own crossfade, looping).
//   --arboretum-playlist <id>[:<share_token>]   the same, the list and every item's params fetched from arboretum (ARBORETUM_TOKEN as above; an item the token cannot read refuses the run).
//                          <f> is [{ name?, params, dwell_s?, crossfade_s?, style? }] (defaults 30 s, 5 s and 'morph'; style is 'morph' or 'fade', how that look arrives). --seconds is the length of the video; the playlist repeats to fill it, and the last fade may be cut.
//                          The looks must share one grove (seed, branching, resolutions, scene mode); other pairs are refused before the render. A requested scene fade takes twice crossfade_s;
//                          a fade between looks differing only in live parameters remains a morph on the ordinary clock. Dwell and checkpoints follow the actual landing.
//                          A fade in flight is not restorable state, so a playlist's checkpoints are taken where each fade LANDS (ckpt/): a resume restores the last landing before the segment and replays
//                          the frames in between unrecorded (at most one look's dwell and fade). No --encode-only. The playlist is in the run key (each item's params by hash), look.json is the
//                          first look and playlist.json the whole list.
//   --session-json <f>     fixed quality/presentation session, resolved by the pinned engine. Incompatible with --set. --ss remains a capture option.
//   --set key=value        override a look param (JSON value, or a bare string). Repeatable. adaptive_motion / auto_quality are refused: they are forced off. Only bake_resolution /
//                          tex_resolution / sample_count keep the look as authored: any other key is accepted with a warning and the manifest says NOT as authored.
//   --commit <sha>         the engine from `git archive <sha>` in a temp tree        --tree  a SNAPSHOT of the working tree, recorded dirty (git diff --stat + a hash of the diff)
//   --fps 60  --seconds 300  --size 1920x1080  (the OUTPUT size)
//   --ss k                 render at k x size and downscale in ffmpeg;  --ss-space linear|gamma  (default linear: see SS_NOTE in video-lib.mjs)
//   --pipeline master|gpu|gpu-main10|browser (default master): master keeps the existing lossless intermediate; gpu resizes on the GPU then encodes HEVC Main8;
//                          gpu-main10 converts output RGB directly to 10-bit P010 then HEVC Main10; browser feeds VideoFrame to native HEVC QP1, transferring only compressed bytes.
//                          Scene quality and --ss are independent: --ss 1 renders output size directly, --ss 2 renders 4K for a 1080p delivery. Direct pipelines support ss 1/2,
//                          linear downscale only, SDR bt709 and HEVC. GPU modes accept --vt-bitrate/--vt-quality; browser uses fixed QP1 (no VT delivery controls).
//                          All modes checkpoint each segment. Direct modes keep encoded MP4 segments until delivery is stream-copied and verified, then delete them;
//                          they have no lossless master or raw pixel hashes and refuse --measure, --stills, --encode-only, --merge-master and --drop-segments.
//   --preroll 30           seconds of discarded motion before frame 0 (integrated on a tiny engine, see video.html cheapPreroll)
//   --segment-seconds 10   one lossless segment + one checkpoint per this many seconds; a crash resumes from the last pair, exactly
//   --jobs N               (default 1, 1..8) render N segments at once, one Chromium session and one ffmpeg per segment, for a host whose single render leaves the GPU and cores idle (a render is a
//                          serial chain of waits: tick, GPU, readback, POST). The output is meant to be BYTE-IDENTICAL to --jobs 1: the same frames, seg/ layout, hashes.txt and run key (--jobs and
//                          --block-segments are not in the key, they cannot change a frame; they are recorded only in the invocation and, above 1, in render-info.json / the manifest's render.parallel).
//                          --jobs 1 is the code path as it was. First a CPU-only pass on the tiny engine writes ckpt/ckpt_<pump>.json (marked "tiny": true) at every pump a segment to render
//                          starts from: a single look at the segment's own first pump; a playlist at the segment's first pump when it is at rest there, else at the pump before the fade it falls
//                          inside, replayed unrecorded up to the segment (at most one crossfade of pumps), plus every fade landing. Sessions then claim BLOCKS of consecutive segments: a session
//                          opens its engine once on the block's first segment's start state and renders the block's segments back to back in that engine and page, exactly as the serial path
//                          does (each with its own ffmpeg, sink and commit); only the first segment of a block starts from a restored state. Nothing is carried between non-consecutive segments.
//                          A claim takes K = clamp(ceil(remaining / (2 * jobs)), 1, --block-segments) segments, remaining = segments not yet claimed, so blocks are large first and shrink to 1 as the
//                          pool drains (no long tails); a hole in the segment numbers ends a block. --block-segments n (default 4, 1..64; 1 is a session per segment) sets the cap; segments stay
//                          --segment-seconds long. Done = the segment's own files AND the checkpoint it starts from, so a crash leaves holes and only the holes are redone (--jobs 1 keeps its
//                          contiguous prefix). A segment that fails MAX_ATTEMPTS times keeps the block's committed segments, hands the rest of the block back to the pool, and fails the run at the
//                          end with its message; a retry reopens a fresh session at that segment's own start state. Every segment's end state, from the full-size engine, is compared with the
//                          tiny pass's state for the same pump where one was written, inside a block too: a difference means the output is NOT what a serial render makes, and the run stops
//                          naming the pump (rerun with --jobs 1). run.log: "session s: block [i..j]", "session s: setup X s (browser launch + engine build)" per block; render.parallel has the sum.
//                          UNPROVEN until test-gl/compare-runs.mjs <serial> <parallel> says so on a real GPU: tiny-engine state across FADES, VRAM at N sessions, and whether N sessions are faster.
//   --block-segments n     see --jobs (default 4); no effect with --jobs 1.
//   --master ffv1|x264rgb  the lossless master codec (RGB 4:4:4 8-bit, bit-exact to what the GPU wrote, after the optional downscale)
//   --delivery hevc_videotoolbox|hevc_vaapi|libx265|none   [--vt-bitrate 60M | --vt-quality 100] [--x265-crf 16] [--x265-preset slow] [--gop 120] [--trc bt709|iec61966-2-1]
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
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { exportSession } from './session-lib.mjs';
import os from 'node:os';
import { directDiskPlan, directJoinArgs, directSegmentArgs, pipelinePlan } from './pipeline.mjs';
import { checkAgainstTiny, eventsUpTo, parseBlockSegments, parseJobs, restorePoint, runPool, tinyEvents, tinyPlan, todoSegments } from './parallel.mjs';
import { captureCanvasRun, encodeCanvasRun, hevcQuantizerConfig, installLinearDownscale } from './webcodecs.mjs';
import {
  ARBORETUM_BASE, ArboretumError, CONCAT_INPUT, FFMPEG, GPU_VARIANTS, HERE, PAGE_KEY, PLAYER_RGB, T0_MS, VAAPI_BITRATE, VAAPI_DEVICE, VT_BUFSIZE_X, VT_MAXRATE_X, assertHardwareRenderer, assertServedPage, browserFacts, canonicalJson, canonicalSha256, checkPlaylistTimes, chromiumIdentity, concatListText, countFrames, countPackets, deliveryArgs, exportEngine,
  diskPlan, estimateDeliveryMbit, exporterIdentity, fat32Forecast, fat32Report, fetchArboretum, fetchArboretumPlaylist, ffmpegVersion, ffprobeJson, fmt, launchBrowser, linearKnownLimits, masterChain as masterChainOf, onExit, openPage, osFacts, parseArboretumSpec, parsePlaylistSpec, pipeRequestTo, playlistFromJson, playlistRunBlock, playlistSchedule, qualityReport,
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

const LOOK = flag('--look-json'), ARB_SPEC = flag('--arboretum'), PL_JSON = flag('--playlist-json'), PL_SPEC = flag('--arboretum-playlist');
if ([LOOK, ARB_SPEC, PL_JSON, PL_SPEC].filter(Boolean).length !== 1) die('exactly one of --look-json <path>, --arboretum <id>[@<version>][:<share_token>], --playlist-json <path> or --arboretum-playlist <id>[:<share_token>]');
const PLAYLIST_MODE = Boolean(PL_JSON || PL_SPEC);
const SESSION_FILE=flag('--session-json');
let SESSION_INPUT;
if(SESSION_FILE){try{SESSION_INPUT=JSON.parse(readFileSync(SESSION_FILE,'utf8'));}catch(e){die(`--session-json: ${e.message}`);}}
let ARB = null, PL_ARB = null;   // the parsed --arboretum / --arboretum-playlist
if (ARB_SPEC) { try { ARB = parseArboretumSpec(ARB_SPEC); } catch (e) { die(e.message); } }
if (PL_SPEC) { try { PL_ARB = parsePlaylistSpec(PL_SPEC); } catch (e) { die(e.message); } }
const ARB_BASE = flag('--arboretum-base', ARBORETUM_BASE);
const OUT = resolve(flag('--out') || die('--out <dir> is required'));
const ENCODE_ONLY = has('--encode-only');
if (PLAYLIST_MODE && ENCODE_ONLY) die('--encode-only is not supported for a playlist: its checkpoints are fade landings and the manifest is built from the playlist the run fetched');
if (!ENCODE_ONLY && !!flag('--commit') === has('--tree')) die('exactly one of --commit <sha> or --tree');
const FPS = Number(flag('--fps', 60));
const SECONDS = Number(flag('--seconds', 300));
const [OW, OH] = flag('--size', '1920x1080').split('x').map(Number);
const SS = Number(flag('--ss', 1));
const SS_SPACE = flag('--ss-space', 'linear');
const PIPELINE = flag('--pipeline', 'master');
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
let JOBS;   // not in the run key: it cannot change a frame (see renderParallel)
try { JOBS = parseJobs(has('--jobs') ? (flag('--jobs') ?? '') : undefined); } catch (e) { die(e.message); }
let BLOCK_SEGMENTS;   // likewise not in the run key; only read when JOBS > 1
try { BLOCK_SEGMENTS = parseBlockSegments(has('--block-segments') ? (flag('--block-segments') ?? '') : undefined); } catch (e) { die(e.message); }
const ABORT_AFTER_SEG = flag('--abort-after-seg') === undefined ? null : Number(flag('--abort-after-seg'));   // test hook: die hard after this many segments
// test hook: --inject-failure 0:2,3:1 makes segment 0 fail its first 2 attempts and segment 3 its first (after its ffmpeg is up), to exercise the retry path
const INJECT = Object.fromEntries((flag('--inject-failure', '') || '').split(',').filter(Boolean).map((s) => s.split(':').map(Number)));
if (!Number.isFinite(FPS) || FPS <= 0) die('--fps');
if (!Number.isInteger(SS) || SS < 1 || SS > 4) die('--ss must be an integer 1..4');
if (!['linear', 'gamma'].includes(SS_SPACE)) die('--ss-space linear|gamma');
if (!['ffv1', 'x264rgb'].includes(MASTER)) die('--master ffv1|x264rgb');
if (!['hevc_videotoolbox', 'hevc_vaapi', 'libx265', 'none'].includes(DELIVERY)) die('--delivery hevc_videotoolbox|hevc_vaapi|libx265|none');
if (['libx265', 'hevc_vaapi'].includes(DELIVERY) && (has('--vt-bitrate') || has('--vt-quality'))) die(`VideoToolbox delivery controls cannot be used with ${DELIVERY}`);
try { scaleRate(VT_BITRATE, 1); } catch (e) { die(`--vt-bitrate: ${e.message}`); }
if (!GPU_VARIANTS[CHROME]) die(`--chrome ${CHROME}: not one of ${Object.keys(GPU_VARIANTS).join(', ')}`);
const DISCARD = has('--discard-master');
if (DISCARD) for (const f of ['--merge-master', '--drop-segments', '--encode-only']) if (has(f)) die(`--discard-master and ${f} are incompatible: ${f === '--encode-only' ? 'it re-encodes from the master that --discard-master deletes' : 'it keeps a master that --discard-master deletes'}`);
let PLAN;
try { PLAN = pipelinePlan({ pipeline: PIPELINE, ow: OW, oh: OH, ss: SS, space: SS_SPACE }); } catch (e) { die(e.message); }
if (PLAN.direct) {
  for (const f of ['--measure', '--stills', '--encode-only', '--merge-master', '--drop-segments']) if (has(f)) die(`--pipeline ${PIPELINE} and ${f} are incompatible: direct pipelines have no lossless master`);
  if (!(DELIVERY === 'hevc_videotoolbox' || (DELIVERY === 'hevc_vaapi' && PIPELINE !== 'browser')) || TRC !== 'bt709')
    die(`--pipeline ${PIPELINE} requires hardware HEVC and SDR bt709 (VAAPI supports gpu/gpu-main10; browser uses native HEVC)`);
  if (PIPELINE === 'browser' && (has('--vt-quality') || has('--vt-bitrate'))) die('--pipeline browser uses native HEVC QP1, not VideoToolbox delivery controls');
}
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
if(SESSION_FILE && flagAll('--set').length)die('--session-json and --set are separate compatibility paths; choose one');
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
const segFile = (i) => P('seg', `${segName(i)}.${PLAN.extension}`);
const LIST = P('seg', 'list.txt'), SUMS = P('seg', 'SHA256SUMS');
const segsPresent = () => Array.from({ length: nSegs }, (_, i) => existsSync(segFile(i))).every(Boolean);
const mergedPresent = () => existsSync(P('master.mkv'));
// what the delivery and the measure read: the segment set through the concat demuxer, else the merged file
const masterInput = () => (segsPresent() ? CONCAT_INPUT(LIST) : ['-i', P('master.mkv')]);

if (has('--print-ffmpeg')) {   // dry run: the commands, nothing launched, nothing written
  console.log(JSON.stringify({ segment: [FFMPEG, ...(PLAN.direct ? directSegmentArgs({ pipeline: PIPELINE, codec: DELIVERY, ow: OW, oh: OH, fps: FPS, trc: TRC, vtQuality: VT_QUALITY, vtBitrate: VT_BITRATE, gop: GOP, file: 'seg.mp4' }) : segArgs('seg.mkv', SEG_FRAMES))], delivery: [FFMPEG, ...(PLAN.direct ? directJoinArgs({ input: CONCAT_INPUT('seg/list.txt'), out: 'delivery.mp4', fps: FPS }) : deliveryArgv(CONCAT_INPUT('seg/list.txt'), 'delivery.mp4'))] }));
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
let PLAYLIST = null;   // { name, items: [{ preset_id, version, name, dwell_s, crossfade_s, params }], block (the run key's), fetch (how it was fetched) }
if (PLAYLIST_MODE) {
  let pl;
  if (PL_JSON) {
    try { pl = playlistFromJson(JSON.parse(readFileSync(PL_JSON, 'utf8')), basename(PL_JSON)); } catch (e) { die(`--playlist-json: ${e.message}`); }
  } else {
    try { pl = await fetchArboretumPlaylist({ base: ARB_BASE, id: PL_ARB.id, share: PL_ARB.share, token: ARBORETUM_TOKEN }); } catch (e) {
      if (!(e instanceof ArboretumError)) throw e;
      console.error(`render-video: ${e.message}`);
      process.exit(e.refusal ? 3 : 1);
    }
  }
  try { checkPlaylistTimes(pl.items, FPS); } catch (e) { die(e.message); }
  if (pl.items.length < 2) die('a playlist needs at least two looks to transition between');
  const block = playlistRunBlock(pl, canonicalSha256);
  PLAYLIST = { name: pl.name, presentation:pl.presentation, items: pl.items, block,
    fetch: PL_SPEC ? { name: pl.name, page_url: `${ARBORETUM_BASE}/arboretum/l/${pl.id}`, api_base: ARB_BASE, requested: pl.requested, share_token_sha256_prefix: PL_ARB.share ? sha256(PL_ARB.share).slice(0, 8) : null, fetched_at: new Date().toISOString() } : null };
  lookParams = pl.items[0].params;
  lookBytes = Buffer.from(canonicalJson(block));
} else if (LOOK) {
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
let finalParams = { ...lookParams, ...overrides, adaptive_motion: false, auto_quality: false };
// a playlist's looks, each as rendered (the same overrides and the two governors forced off on every one)
let STOP_PARAMS = PLAYLIST ? PLAYLIST.items.map((it) => ({ ...it.params, ...overrides, adaptive_motion: false, auto_quality: false })) : [finalParams];
const nonQuality = Object.keys(overrides).filter((k) => !QUALITY_KEYS.includes(k));
if (nonQuality.length) console.warn(`render-video: WARNING — overrides outside the quality knobs: ${nonQuality.join(', ')} (the look is NOT as authored)`);

// ------------------------------------------------------------------ the run key: everything that decides the frames
const killers = [];
onExit(() => { for (const k of killers.splice(0)) { try { k(); } catch { /* already gone */ } } });
// the engine is exported (and removed again on every way out, signals included: exportEngine registers that) only for a run that renders
const exp = ENCODE_ONLY ? null : exportEngine({ ...(has('--tree') ? { tree: true } : { commit: flag('--commit') }), keep: has('--keep-export') });
let SESSION_RECORD=null;
if(SESSION_FILE && exp){
  try{
    const engine=await import(pathToFileURL(join(exp.dir,'komorebi.js')).href);
    SESSION_RECORD=exportSession(engine,SESSION_INPUT,PLAYLIST?PLAYLIST.items.map(it=>it.params):[lookParams],PLAYLIST?.presentation);
    STOP_PARAMS=SESSION_RECORD.effective;finalParams=STOP_PARAMS[0];
  }catch(e){die(`--session-json: ${e.message}`);}
}
// Playlist support keeps the same grove topology and mode. Check the exported engine's own key lists before anything renders.
let playlistEngine;
if (PLAYLIST && exp) {
  try {
    playlistEngine = await import(pathToFileURL(join(exp.dir, 'komorebi-params.js')).href);
    const { TOPO_KEYS, MODE_KEYS, DEFAULTS } = playlistEngine;
    const structural = [...TOPO_KEYS, ...MODE_KEYS];
    for (let i = 0; i < STOP_PARAMS.length; i++) {
      const a = { ...DEFAULTS, ...STOP_PARAMS[i] }, j = (i + 1) % STOP_PARAMS.length, b = { ...DEFAULTS, ...STOP_PARAMS[j] };
      const differ = structural.filter((k) => !isDeepStrictEqual(a[k], b[k]));
      if (differ.length) { console.error(`render-video: playlist item ${i + 1} (${PLAYLIST.items[i].name}) -> item ${j + 1} (${PLAYLIST.items[j].name}) changes ${differ.join(', ')}: that is a structural change (a dissolve under a cloud), not a morph. Keep a playlist's looks on one grove.`); process.exit(3); }
    }
  } catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') warn(`could not check the playlist's looks for structural changes (${String(e.message).split('\n')[0]}); a fade that does not land will fail the render instead`); else throw e; }
}
const SCHEDULE = PLAYLIST ? playlistSchedule({ items: PLAYLIST.items.map((it, i) => ({ ...it, params: STOP_PARAMS[i] })), fps: FPS, preroll: PREROLL, frames: N, engine: playlistEngine }) : [];
const PL_EVENTS = SCHEDULE.map((e) => ({ start: e.start, duration: e.duration_s, style: e.style, params: STOP_PARAMS[e.stop] }));
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
  ...(SESSION_RECORD?{session:SESSION_RECORD}:{}),
  fps: FPS, step_ms: STEP, t0_ms: T0_MS, size: [OW, OH], ss: SS, ss_space: SS === 1 ? 'n/a' : SS_SPACE, preroll_frames: PREROLL, segment_frames: SEG_FRAMES,
  master: MASTER, master_chain: masterChain(), chrome: CHROME, ffmpeg_version: FFMPEG_VERSION,
  ...(PLAN.direct ? { pipeline: PIPELINE, master: null, master_chain: null, pipeline_identity: { pipeline_sha256: sha256(readFileSync(join(HERE, 'pipeline.mjs'))), webcodecs_sha256: sha256(readFileSync(join(HERE, 'webcodecs.mjs'))) }, delivery_settings: { vt_bitrate: PIPELINE === 'browser' || DELIVERY === 'hevc_vaapi' || VT_QUALITY ? null : VT_BITRATE, vt_quality: PIPELINE === 'browser' ? null : VT_QUALITY ?? null, quantizer: PIPELINE === 'browser' ? 1 : null, gop: PIPELINE === 'browser' ? FPS * 2 : GOP, ...(DELIVERY === 'hevc_vaapi' ? { encoder: DELIVERY, vaapi_device: VAAPI_DEVICE, bitrate: VAAPI_BITRATE } : {}) } } : {}),
  ...(ARB_RECORD ? { arboretum: ARB_RECORD.block } : {}),   // a look from a file has no such key, so its run keys are what they were
  ...(PLAYLIST ? { playlist: PLAYLIST.block } : {}),         // likewise a single look has no playlist key
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
  // A run rendered under a session and one rendered without must not share frames, whichever side the flags are on.
  const keySession = RK.body.session?.requested ?? null, flagSession = SESSION_INPUT ?? null;
  if (!isDeepStrictEqual(keySession, flagSession)) lines.push(`  session: run-key.json says ${JSON.stringify(keySession)}, the flags say ${JSON.stringify(flagSession)}`);
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
    if (PLAYLIST?.fetch) {   // the key matched: the frames are these; the playlist's name may have moved since
      RK = { ...RK, look: { ...RK.look, name: PLAYLIST.name }, playlist_fetch: PLAYLIST.fetch };
      writeJsonAtomic(P('run-key.json'), RK);
    }
    if (ARB_RECORD) {   // the key matched: the frames are these; the preset's name or commit may have moved since, and the record follows it
      RK = { ...RK, look: { ...RK.look, name: ARB_RECORD.fetch.name }, arboretum_fetch: ARB_RECORD.fetch };
      writeJsonAtomic(P('run-key.json'), RK);
    }
  } else {
    // look and invocation sit beside the body: the key is the frames' identity, these say where the look file was and how the render was launched
    RK = { key: RUN_KEY, body, provenance: exp.provenance, look: PLAYLIST ? { path: PL_JSON ? resolve(PL_JSON) : null, name: PLAYLIST.name, source: PL_JSON ? 'playlist-json' : 'arboretum-playlist' } : ARB_RECORD ? { path: null, name: ARB_RECORD.fetch.name, source: 'arboretum' } : { path: resolve(LOOK), name: basename(LOOK) },
      ...(ARB_RECORD ? { arboretum_fetch: ARB_RECORD.fetch } : {}), ...(PLAYLIST?.fetch ? { playlist_fetch: PLAYLIST.fetch } : {}), invocation: { argv: redactArgv(argv), at: new Date().toISOString(), node: process.version } };
    mkdirSync(OUT, { recursive: true });
    writeJsonAtomic(P('run-key.json'), RK);
  }
  // the key is this run's: now the folder may be written to (look.json is the look as rendered, so a refused rerun must never rewrite it)
  mkdirSync(P('seg'), { recursive: true });
  mkdirSync(P('ckpt'), { recursive: true });
  writeFileSync(P('look.json'), `${JSON.stringify(finalParams, null, 2)}\n`);
  if (PLAYLIST) writeFileSync(P('playlist.json'), `${JSON.stringify({ name: PLAYLIST.name, items: PLAYLIST.items.map((it, i) => ({ name: it.name, preset_id: it.preset_id, version: it.version, dwell_s: it.dwell_s, crossfade_s: it.crossfade_s, style: it.style, params: STOP_PARAMS[i] })), timeline: SCHEDULE }, null, 2)}\n`);
}

const PAGE_SHA = RK.body.exporter?.video_html_sha256;   // the page the key names (an older key without it: nothing to compare, the check then fails loudly)

// ------------------------------------------------------------------ segment bookkeeping (a segment is done when its ckpt AND its json exist)
const segJson = (i) => readJson(P('seg', `${segName(i)}.json`));
const segDone = (i) => { try { return existsSync(segFile(i)) && (PLAN.direct || existsSync(P('seg', `${segName(i)}.hashes`))) && statSync(segFile(i)).size === segJson(i).file_bytes; } catch { return false; } };   // a half-written json is not done
const segRange = (i) => ({ from: PREROLL + i * SEG_FRAMES, to: PREROLL + Math.min(N, (i + 1) * SEG_FRAMES) });
const ckptFile = (n) => P('ckpt', `ckpt_${String(n).padStart(9, '0')}.json`);
// A playlist cannot checkpoint at a segment's end (a fade may be in flight there): its checkpoints are the LANDINGS, where the engine is at rest on a look. landingBefore(f) is the latest one at or
// before pump f that is on disk (the pre-roll, on the first look, if none), and a resume restores it and replays the pumps up to f unrecorded.
const landingsUpTo = (f) => SCHEDULE.filter((e) => e.land <= f);
const landingBefore = (f) => { let best = { at: PREROLL, stop: 0 }; for (const e of landingsUpTo(f)) if (e.land > best.at && existsSync(ckptFile(e.land))) best = { at: e.land, stop: e.stop }; return best; };
const segmentCheckpointed = (k) => (PLAYLIST ? landingsUpTo(segRange(k).to).every((e) => existsSync(ckptFile(e.land))) : existsSync(ckptFile(segRange(k).to)));
// a segment is only trusted if every one before it is done too, and the checkpoint at its end exists
const firstTodoSeg = () => { let k = 0; while (k < nSegs && segDone(k) && segmentCheckpointed(k)) k++; return k; };

// ------------------------------------------------------------------ disk: the peak of THIS run
// The segments are the master (one copy; --merge-master adds a second), then the delivery on top (video-lib.mjs diskPlan: the figures it is built on).
const deliveryMbit = () => PIPELINE === 'browser' ? 240 : PIPELINE === 'gpu-main10' && VT_QUALITY ? 320 : estimateDeliveryMbit({ codec: DELIVERY, vtQuality: VT_QUALITY, vtBitrate: VT_BITRATE });   // quality modes have no cap; these are planning estimates
function checkDisk(framesToRender) {
  const plan = PLAN.direct ? directDiskPlan({ framesToRender, frames: N, fps: FPS, mbit: deliveryMbit() }) : diskPlan({ framesToRender, frames: N, fps: FPS, ow: OW, oh: OH, merge: MERGE && !mergedPresent(), deliveryMbit: deliveryMbit() });
  const g = (b) => (b / 2 ** 30).toFixed(1);
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
    for (let i = firstTodo; i < nSegs; i++) for (const e of [PLAN.extension, 'hashes', 'json']) rmSync(P('seg', `${segName(i)}.${e}`), { force: true });
  }
  if (firstTodo === nSegs) { log(`all ${nSegs} segments already done`); return; }
  log(`resuming at segment ${firstTodo}/${nSegs} (${firstTodo ? `checkpoint ${segRange(firstTodo - 1).to}` : 'from the pre-roll'})`);

  const sinks = new Map();
  const srv = await startServer({ engineRoot: exp.dir, sinks });
  killers.push(() => srv.server.close());
  const frameBytes = PLAN.frameBytes;
  const batch = Math.max(1, Math.min(8, Math.floor((64 << 20) / frameBytes)));
  const params = finalParams;
  let session = null;   // { browser, page, launch }
  const closeSession = async () => { if (session) { try { await session.browser.close(); } catch { /* gone */ } session = null; } };
  killers.push(() => { session?.browser.close().catch(() => {}); });

  const openSession = async (atPump, state, stop = 0) => {
    const b = await launchBrowser(chromium, CHROME);
    if (b.browser.version() !== CHROMIUM.version) { await b.browser.close(); throw fatal(`Chromium ${b.browser.version()} launched, the run key says ${CHROMIUM.version}`); }
    const page = await openPage(b.browser, srv.port);
    // video.html is read live at every page load: what this session was handed must be the page the key names
    try { assertServedPage(srv.served, PAGE_SHA); } catch (e) { await b.browser.close(); throw fatal(e.message); }
    session = { browser: b.browser, page, launch: b, pageSha: srv.served.get(PAGE_KEY) };
    const info = await page.evaluate((o) => window.__v.open(o), { params: STOP_PARAMS[stop], rw: RW, rh: RH, step: STEP, T0: T0_MS, at: atPump, state, overrideKeys: Object.keys(overrides) });
    if (PLAN.downscale) await page.evaluate(installLinearDownscale, { width: OW, height: OH });
    return info;
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
  } else if (PLAYLIST) {
    startState = null; startAt = null;   // restored from the last landing when the session opens (below), and again after any retry
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
    if (!PLAYLIST && at !== from) throw new Error(`internal: state is at ${at}, segment ${i} starts at ${from}`);
    let ff = null;
    try {
      if (!session) {
        let openAt = at, openState = state, openStop = 0;
        if (PLAYLIST) { const lb = landingBefore(from); openAt = lb.at; openStop = lb.stop; openState = readJson(ckptFile(lb.at)).state; }
        const openInfo = await openSession(openAt, openState, openStop);
        await recordSession(session, openInfo, i);
        if (PLAYLIST && openAt < from) {   // the engine is at rest on look `openStop` at pump openAt: replay the schedule up to the segment, unrecorded
          const tr = Date.now();
          const rp = await session.page.evaluate(([f, t, ev, sn]) => window.__v.run({ from: f, to: t, capture: false, events: ev, snapAt: sn }), [openAt, from, PL_EVENTS.filter((e) => e.start > openAt && e.start <= from), landingsUpTo(from).filter((e) => e.land > openAt).map((e) => e.land)]);
          for (const l of rp.landings) writeFileSync(ckptFile(l.n), JSON.stringify({ at: l.n, state: l.snapshot }));
          log(`playlist resume: restored the landing at pump ${openAt}, replayed ${from - openAt} pumps to segment ${i} in ${Date.now() - tr} ms`);
        }
        log(`browser up: ${openInfo.renderer}; canvas ${openInfo.canvas} drawingBuffer ${openInfo.drawingBuffer}; bake ${openInfo.bakeRes} samples ${openInfo.samples}`);
        assertHardwareRenderer(openInfo.renderer, CHROME);
      }
      const file = segFile(i);
      ff = spawnFfmpeg(PLAN.direct ? directSegmentArgs({ pipeline: PIPELINE, codec: DELIVERY, ow: OW, oh: OH, fps: FPS, trc: TRC, vtQuality: VT_QUALITY, vtBitrate: VT_BITRATE, gop: GOP, file }) : segArgs(file, frames));
      const thisFf = ff;
      killers.push(() => thisFf.kill());
      if ((injected.get(i) ?? 0) < (INJECT[i] ?? 0)) { injected.set(i, (injected.get(i) ?? 0) + 1); throw new Error(`injected failure in segment ${i}`); }
      const counter = { bytes: 0, last: Date.now() };
      sinks.set('seg', async (req, res) => { await pipeRequestTo(req, thisFf, counter); counter.last = Date.now(); res.writeHead(200).end('ok'); });
      const watchdog = setInterval(() => { if (Date.now() - counter.last > 15 * 60e3) { log('watchdog: no frames for 15 min, killing the browser'); session?.browser.close().catch(() => {}); } }, 30e3);
      const ts = Date.now();
      // the playlist's fades that START in this segment, and the landings in it whose state is to come back (both empty for a single look)
      const events = PL_EVENTS.filter((e) => e.start > from && e.start <= to), snapAt = landingsUpTo(to).filter((e) => e.land > from).map((e) => e.land);
      let r;
      try {
        r = PIPELINE === 'browser'
          ? await session.page.evaluate(encodeCanvasRun, { config: hevcQuantizerConfig({ width: OW, height: OH, fps: FPS }), quantizer: 1, from, to, sink: '/__sink/seg', events, snapAt })
          : PLAN.direct ? await session.page.evaluate(captureCanvasRun, { from, to, batch, sink: '/__sink/seg', events, snapAt })
            : await session.page.evaluate(([f, t, bt, sk, ev, sn]) => window.__v.run({ from: f, to: t, batch: bt, sink: sk, events: ev, snapAt: sn }), [from, to, batch, '/__sink/seg', events, snapAt]);
      }
      finally { clearInterval(watchdog); }
      const renderMs = Date.now() - ts;
      const done = await ff.end();
      if (done.code !== 0) throw new Error(`ffmpeg segment ${i} exited ${done.code}: ${done.stderrTail}`);
      if (PIPELINE === 'browser' ? counter.bytes !== r.bytes || r.frames !== frames : counter.bytes !== frames * frameBytes || (PLAN.direct && r.frames !== frames)) throw new Error(`segment ${i}: capture frame/byte accounting mismatch`);
      if (!PLAN.direct && r.hashes.length !== frames) throw new Error(`segment ${i}: ${r.hashes.length} hashes for ${frames} frames`);
      const packets = countPackets(file);
      if (packets !== frames) throw new Error(`segment ${i}: ffprobe counts ${packets} packets, expected ${frames}`);
      if (PLAN.direct) {
        if (countFrames(file) !== frames) throw new Error(`segment ${i}: decoded frame count mismatch`);
        const s = ffprobeJson(file).streams.find((x) => x.codec_type === 'video');
        if (s.width !== OW || s.height !== OH || s.r_frame_rate !== `${FPS}/1` || (PIPELINE === 'gpu-main10' && (s.profile !== 'Main 10' || s.pix_fmt !== 'yuv420p10le'))) throw new Error(`segment ${i}: wrong delivery dimensions, clock or Main10 profile`);
      }
      // commit: hashes, checkpoint, then the json that says "done"
      if (!PLAN.direct) writeFileSync(P('seg', `${segName(i)}.hashes`), `${r.hashes.map((h, k) => `${from + k + 1 - PREROLL} ${h}`).join('\n')}\n`);
      if (PLAYLIST) { for (const l of r.landings ?? []) writeFileSync(ckptFile(l.n), JSON.stringify({ at: l.n, state: l.snapshot })); if ((r.landings ?? []).length !== snapAt.length) throw new Error(`segment ${i}: ${(r.landings ?? []).length} landings for ${snapAt.length} expected`); }
      else writeFileSync(ckptFile(to), JSON.stringify({ at: to, state: r.snapshot }));
      writeFileSync(P('seg', `${segName(i)}.json`), JSON.stringify({ segment: i, first_frame: from - PREROLL, frames, pumps: [from + 1, to], bytes_piped: counter.bytes, packets, file_bytes: statSync(file).size, file_sha256: await sha256File(file), render_wall_ms: renderMs, ffmpeg_version: FFMPEG_VERSION, page_sha256: session.pageSha, ffmpeg_args: ff.args, hashes_sha256: PLAN.direct ? null : sha256(readFileSync(P('seg', `${segName(i)}.hashes`))), minMean: r.minMean, maxMean: r.maxMean }, null, 2));
      state = r.snapshot; at = to; doneSegs++; i++;
      const elapsed = (Date.now() - t0) / 1000, perFrame = renderMs / frames, left = (nSegs - i) * SEG_FRAMES * perFrame / 1000;
      log(`segment ${i - 1}/${nSegs - 1}: ${frames} frames, ${fmt(perFrame)} ms/frame (${fmt(1000 / perFrame)} fps), ${(statSync(file).size / 2 ** 20).toFixed(1)} MiB ${PLAN.direct ? 'HEVC' : 'lossless'}, load ${os.loadavg()[0].toFixed(1)}, elapsed ${fmt(elapsed, 0)} s, ETA ${fmt(left, 0)} s`);
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
      for (const ext of [PLAN.extension, 'hashes', 'json']) rmSync(P('seg', `${segName(i)}.${ext}`), { force: true });
      if (n >= MAX_ATTEMPTS) throw e;
      // the failed segment is redone from the checkpoint that opens it (`state`/`at` still hold it)
    }
  }
  await closeSession();
  await srv.close();
}

// ------------------------------------------------------------------ render, --jobs N (N > 1): the same segments, N at a time
// renderAll above is the serial path and is not touched. This one is separate on purpose: --jobs 1 must stay exactly what it was, and nothing here can run without a browser to prove it,
// so the two share no code that could move. Keep the segment body (run, checks, commit) in step with renderAll's.
//  - A segment is DONE when its own files are and the checkpoint it starts from is on disk (segReady); the segments left are the holes, in order. Files of a segment to redo are removed first.
//  - One CPU-only pass on the tiny engine writes every start state the segments to render need (parallel.mjs tinyPlan), once, before any session opens. It writes only what is missing, with
//    "tiny": true, so a checkpoint a serial render made is never replaced; the pass is how a hole in the middle of a run can start at all, there being no session that integrated up to it.
//  - A segment is its own job: a fresh Chromium, an engine opened on its start state (a playlist replays the pumps from its restore point to the segment unrecorded), its own ffmpeg and sink
//    (/__sink/seg-<i>), closed when it ends. Nothing carries from one segment to the next in a session, so a segment renders the same whichever session takes it and in whatever order;
//    the price is a browser launch and an engine build per segment (a larger --segment-seconds amortises it).
//  - The full-size engine's state at a segment's end (and at the landings in it) must equal the tiny pass's for the same pump, where one was written: that is the state the NEXT segment started from,
//    and a serial render would have used this one. A difference is fatal for the segment (not retried: it is deterministic), and says to render with --jobs 1.
const writeCkptIfAbsent = (n, state, extra = {}) => { const f = ckptFile(n); if (!existsSync(f)) { writeFileSync(`${f}.part.${process.pid}`, JSON.stringify({ at: n, state, ...extra })); renameSync(`${f}.part.${process.pid}`, f); } };
const segReady = (i) => segDone(i) && existsSync(ckptFile(PLAYLIST ? restorePoint({ from: segRange(i).from, schedule: SCHEDULE, preroll: PREROLL }).at : segRange(i).from));
function reconcileCkpt(seg, n, state) {   // the full engine's state at pump n vs the tiny pass's, else it is written (never over a file already there: a later segment may be reading it)
  const f = ckptFile(n);
  if (!existsSync(f)) { writeCkptIfAbsent(n, state); return 'written'; }
  const verdict = checkAgainstTiny(readJson(f), state);
  if (verdict === 'mismatch') throw fatal(`segment ${seg}: the state at pump ${n} from the full-size engine differs from the tiny engine's (${f}); the segment that starts there was rendered from the tiny one, so a parallel render is NOT what a serial one makes. Render with --jobs 1`);
  return verdict;
}

async function renderParallel() {
  const todo = todoSegments({ nSegs, isDone: segReady });
  if (!todo.length) { log(`all ${nSegs} segments already done`); return; }
  for (const f of ['master.mkv', 'complete.json']) rmSync(P(f), { force: true });   // an older master / completion mark is stale as soon as a segment is redone
  for (const i of todo) for (const e of [PLAN.extension, 'hashes', 'json']) rmSync(P('seg', `${segName(i)}.${e}`), { force: true });
  log(`resuming ${todo.length}/${nSegs} segments (${todo.length === nSegs ? 'all' : `holes: ${todo.join(',')}`}) on ${JOBS} sessions`);

  const sinks = new Map();
  const srv = await startServer({ engineRoot: exp.dir, sinks });
  killers.push(() => srv.server.close());
  const frameBytes = PLAN.frameBytes;
  const batch = Math.max(1, Math.min(8, Math.floor((64 << 20) / frameBytes)));

  // ---- the CPU-only pass: every start state the segments to render need
  const plan = tinyPlan({ todo, segRange, schedule: SCHEDULE, preroll: PREROLL });
  const wanted = [...new Set([...plan.snapshotAt, ...plan.landings])];
  if (wanted.some((n) => !existsSync(ckptFile(n)))) {
    const b = await launchBrowser(chromium, CHROME);
    killers.push(() => b.browser.close().catch(() => {}));
    try {
      const page = await openPage(b.browser, srv.port);
      assertServedPage(srv.served, PAGE_SHA);
      const t = Date.now();
      const opts = { snapshotAt: plan.snapshotAt, snapAt: plan.landings, events: tinyEvents(eventsUpTo(PL_EVENTS, plan.upTo, PREROLL)) };
      const r = await page.evaluate(([p, n, s, T, o]) => window.__v.cheapPreroll(p, n, s, T, o), [finalParams, plan.upTo, STEP, T0_MS, opts]);
      if (!r.info.motionActive) log('WARNING: the springs are at rest after the pre-roll (motion not active): this look is calm');
      if (r.snapshots.length !== plan.snapshotAt.length || r.landings.length !== plan.landings.length) throw new Error(`tiny pass: ${r.snapshots.length}/${plan.snapshotAt.length} states and ${r.landings.length}/${plan.landings.length} landings came back`);
      for (const s of [...r.snapshots, ...r.landings]) writeCkptIfAbsent(s.n, s.snapshot, { tiny: true });
      log(`tiny pass: ${plan.upTo} pumps integrated in ${Date.now() - t} ms; ${plan.snapshotAt.length} start states${PLAYLIST ? ` and ${plan.landings.length} landings` : ''} written where missing`);
    } finally { await b.browser.close().catch(() => {}); }
  }

  const t0 = Date.now(), injected = new Map(), checked = { checked: 0, written: 0 };
  let doneSegs = 0, perFrameSum = 0;
  const slog = (w, ...a) => log(`session ${w}:`, ...a);
  // A worker's live session between the segments of its block: the browser, the page and the engine, which sits at pump `at`. The next segment of the block continues it, as renderAll does.
  const live = new Map();
  let setupSum = 0, nBlocks = 0;
  const closeSession = async (w) => { const s = live.get(w); live.delete(w); if (s) { try { await s.browser.close(); } catch { /* gone */ } } };

  const runSegment = async ({ worker: w, segment: i, fresh }) => {
    const { from, to } = segRange(i);
    const frames = to - from;
    const rp = PLAYLIST ? restorePoint({ from, schedule: SCHEDULE, preroll: PREROLL }) : { at: from, stop: 0, replay: 0 };
    let ff = null, watchdog = null;
    const endSegment = async () => {
      clearInterval(watchdog);
      if (ff) { ff.kill(); await ff.exited; }
      sinks.delete(`seg-${i}`);
    };
    try {
      if (fresh || !live.has(w)) {   // the first segment of a block, or a retry: a browser and an engine opened on THIS segment's start state (a failed session is never reused)
        await closeSession(w);
        const tSetup = Date.now();
        const b = await launchBrowser(chromium, CHROME);
        if (b.browser.version() !== CHROMIUM.version) { await b.browser.close(); throw fatal(`Chromium ${b.browser.version()} launched, the run key says ${CHROMIUM.version}`); }
        killers.push(() => b.browser.close().catch(() => {}));
        const opened = { browser: b.browser, launch: b, page: null, pageSha: null, at: null };
        live.set(w, opened);
        opened.page = await openPage(b.browser, srv.port);
        try { assertServedPage(srv.served, PAGE_SHA); } catch (e) { throw fatal(e.message); }   // video.html is read live at every page load: it must be the page the key names
        opened.pageSha = srv.served.get(PAGE_KEY);
        const openInfo = await opened.page.evaluate((o) => window.__v.open(o), { params: STOP_PARAMS[rp.stop], rw: RW, rh: RH, step: STEP, T0: T0_MS, at: rp.at, state: readJson(ckptFile(rp.at)).state, overrideKeys: Object.keys(overrides) });
        if (PLAN.downscale) await opened.page.evaluate(installLinearDownscale, { width: OW, height: OH });
        const setupS = (Date.now() - tSetup) / 1000;
        setupSum += setupS;
        slog(w, `setup ${fmt(setupS)} s (browser launch + engine build)`);
        await recordSession(opened, openInfo, i);
        opened.at = rp.at;
        if (rp.replay > 0) {   // the engine is at rest on look rp.stop at pump rp.at: replay the schedule up to the segment, unrecorded
          const tr = Date.now();
          const rpl = await opened.page.evaluate(([f, t, ev, sn]) => window.__v.run({ from: f, to: t, capture: false, events: ev, snapAt: sn }), [rp.at, from, PL_EVENTS.filter((e) => e.start > rp.at && e.start <= from), landingsUpTo(from).filter((e) => e.land > rp.at).map((e) => e.land)]);
          for (const l of rpl.landings) reconcileCkpt(i, l.n, l.snapshot);
          opened.at = from;
          slog(w, `segment ${i}: restored pump ${rp.at}, replayed ${rp.replay} pumps to the segment in ${Date.now() - tr} ms`);
        }
        slog(w, `segment ${i}: browser up: ${openInfo.renderer}; canvas ${openInfo.canvas} drawingBuffer ${openInfo.drawingBuffer}; bake ${openInfo.bakeRes} samples ${openInfo.samples}`);
        assertHardwareRenderer(openInfo.renderer, CHROME);
      }
      const sess = live.get(w);
      if (sess.at !== from) throw new Error(`internal: session ${w}'s engine is at pump ${sess.at}, segment ${i} starts at ${from}`);
      const file = segFile(i), sink = `seg-${i}`;
      ff = spawnFfmpeg(PLAN.direct ? directSegmentArgs({ pipeline: PIPELINE, codec: DELIVERY, ow: OW, oh: OH, fps: FPS, trc: TRC, vtQuality: VT_QUALITY, vtBitrate: VT_BITRATE, gop: GOP, file }) : segArgs(file, frames));
      const thisFf = ff;
      killers.push(() => thisFf.kill());
      if ((injected.get(i) ?? 0) < (INJECT[i] ?? 0)) { injected.set(i, (injected.get(i) ?? 0) + 1); throw new Error(`injected failure in segment ${i}`); }
      const counter = { bytes: 0, last: Date.now() };
      sinks.set(sink, async (req, res) => { await pipeRequestTo(req, thisFf, counter); counter.last = Date.now(); res.writeHead(200).end('ok'); });
      watchdog = setInterval(() => { if (Date.now() - counter.last > 15 * 60e3) { slog(w, 'watchdog: no frames for 15 min, killing the browser'); sess.browser.close().catch(() => {}); } }, 30e3);
      const ts = Date.now();
      const events = PL_EVENTS.filter((e) => e.start > from && e.start <= to), snapAt = landingsUpTo(to).filter((e) => e.land > from).map((e) => e.land);
      const r = PIPELINE === 'browser'
        ? await sess.page.evaluate(encodeCanvasRun, { config: hevcQuantizerConfig({ width: OW, height: OH, fps: FPS }), quantizer: 1, from, to, sink: `/__sink/${sink}`, events, snapAt })
        : PLAN.direct ? await sess.page.evaluate(captureCanvasRun, { from, to, batch, sink: `/__sink/${sink}`, events, snapAt })
          : await sess.page.evaluate(([f, t, bt, sk, ev, sn]) => window.__v.run({ from: f, to: t, batch: bt, sink: sk, events: ev, snapAt: sn }), [from, to, batch, `/__sink/${sink}`, events, snapAt]);
      clearInterval(watchdog);
      const renderMs = Date.now() - ts;
      const done = await ff.end();
      if (done.code !== 0) throw new Error(`ffmpeg segment ${i} exited ${done.code}: ${done.stderrTail}`);
      if (PIPELINE === 'browser' ? counter.bytes !== r.bytes || r.frames !== frames : counter.bytes !== frames * frameBytes || (PLAN.direct && r.frames !== frames)) throw new Error(`segment ${i}: capture frame/byte accounting mismatch`);
      if (!PLAN.direct && r.hashes.length !== frames) throw new Error(`segment ${i}: ${r.hashes.length} hashes for ${frames} frames`);
      const packets = countPackets(file);
      if (packets !== frames) throw new Error(`segment ${i}: ffprobe counts ${packets} packets, expected ${frames}`);
      if (PLAN.direct) {
        if (countFrames(file) !== frames) throw new Error(`segment ${i}: decoded frame count mismatch`);
        const s = ffprobeJson(file).streams.find((x) => x.codec_type === 'video');
        if (s.width !== OW || s.height !== OH || s.r_frame_rate !== `${FPS}/1` || (PIPELINE === 'gpu-main10' && (s.profile !== 'Main 10' || s.pix_fmt !== 'yuv420p10le'))) throw new Error(`segment ${i}: wrong delivery dimensions, clock or Main10 profile`);
      }
      // commit: hashes, the states (checked against the tiny pass's where it wrote one), then the json that says "done"
      if (!PLAN.direct) writeFileSync(P('seg', `${segName(i)}.hashes`), `${r.hashes.map((h, k) => `${from + k + 1 - PREROLL} ${h}`).join('\n')}\n`);
      if (PLAYLIST && (r.landings ?? []).length !== snapAt.length) throw new Error(`segment ${i}: ${(r.landings ?? []).length} landings for ${snapAt.length} expected`);
      for (const l of r.landings ?? []) checked[reconcileCkpt(i, l.n, l.snapshot) === 'checked' ? 'checked' : 'written']++;
      checked[reconcileCkpt(i, to, r.snapshot) === 'checked' ? 'checked' : 'written']++;   // where a fade is in flight at `to` no tiny file exists (only rest points are written), so this only writes
      writeFileSync(P('seg', `${segName(i)}.json`), JSON.stringify({ segment: i, first_frame: from - PREROLL, frames, pumps: [from + 1, to], bytes_piped: counter.bytes, packets, file_bytes: statSync(file).size, file_sha256: await sha256File(file), render_wall_ms: renderMs, ffmpeg_version: FFMPEG_VERSION, page_sha256: sess.pageSha, ffmpeg_args: ff.args, hashes_sha256: PLAN.direct ? null : sha256(readFileSync(P('seg', `${segName(i)}.hashes`))), minMean: r.minMean, maxMean: r.maxMean }, null, 2));
      doneSegs++; perFrameSum += renderMs / frames;
      const elapsed = (Date.now() - t0) / 1000, perFrame = renderMs / frames, left = (todo.length - doneSegs) * SEG_FRAMES * (perFrameSum / doneSegs) / Math.min(JOBS, Math.max(1, todo.length - doneSegs)) / 1000;
      log(`segment ${i}/${nSegs - 1}: ${frames} frames, ${fmt(perFrame)} ms/frame (${fmt(1000 / perFrame)} fps), ${(statSync(file).size / 2 ** 20).toFixed(1)} MiB ${PLAN.direct ? 'HEVC' : 'lossless'}, load ${os.loadavg()[0].toFixed(1)}, elapsed ${fmt(elapsed, 0)} s, ETA ${fmt(left, 0)} s, session ${w}`);
      sess.at = to;   // the engine is now at the start of the block's next segment, if there is one
      await endSegment();
      if (ABORT_AFTER_SEG !== null && doneSegs >= ABORT_AFTER_SEG) { log(`--abort-after-seg ${ABORT_AFTER_SEG}: dying without cleanup`); process.kill(process.pid, 'SIGKILL'); }
    } catch (e) {
      const sess = live.get(w);
      if (sess?.page?.pageLog?.length) e.pageLog = sess.page.pageLog.slice(0, 3);
      await closeSession(w);   // the browser first: nothing posts to the sink any more; a failed session is never continued (the retry opens a fresh one)
      await endSegment();
      throw e;
    }
  };
  const onFailure = async ({ worker: w, segment: i, attempt: n, error: e }) => {
    const msg = String(e.message || e).split('\n')[0];
    slog(w, `segment ${i} FAILED (attempt ${n}/${MAX_ATTEMPTS})${e.fatal ? ' [fatal]' : ''}: ${msg}${e.pageLog ? ` | page: ${e.pageLog.join(' ; ')}` : ''}`);
    recordRetry({ at: new Date().toISOString(), segment: i, attempt: n, error: msg, session: w });
    for (const ext of [PLAN.extension, 'hashes', 'json']) rmSync(P('seg', `${segName(i)}.${ext}`), { force: true });
  };
  const onBlock = async ({ worker: w, block }) => { nBlocks++; slog(w, `block [${block[0]}..${block[block.length - 1]}] (${block.length} segment${block.length === 1 ? '' : 's'})`); };
  await runPool({ segments: todo, jobs: JOBS, maxAttempts: MAX_ATTEMPTS, maxBlock: BLOCK_SEGMENTS, runSegment, onFailure, onBlock, onBlockEnd: async ({ worker: w }) => { await closeSession(w); } });
  if (ri) { ri.parallel = { jobs: JOBS, block_segments: BLOCK_SEGMENTS, blocks: nBlocks, setup_seconds_sum: Number(setupSum.toFixed(3)), segments_rendered: todo.length, tiny_state_checks: { ...checked, note: 'full-size end states (and landings) compared with the tiny pass\'s where it wrote one; any difference stops the run' } }; writeJsonAtomic(RI_FILE, ri); }
  log(`parallel render done: ${todo.length} segments on ${JOBS} sessions in ${fmt((Date.now() - t0) / 1000, 0)} s; tiny-engine states checked ${checked.checked}, written ${checked.written}; ${nBlocks} blocks, setup ${fmt(setupSum)} s in all (${fmt(setupSum / Math.max(1, todo.length), 2)} s per segment)`);
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
    segs.push({ file: `seg/${segName(i)}.${PLAN.extension}`, first_frame: j.first_frame, frames: j.frames, packets: j.packets, bytes: j.file_bytes, sha256: sha, sha256_origin: origin, hashes_sha256: j.hashes_sha256, bytes_piped: j.bytes_piped, render_wall_ms: j.render_wall_ms, ffmpeg_version: j.ffmpeg_version ?? null, page_sha256: j.page_sha256 ?? null });
  }
  const lateHashed = segs.filter((s) => s.sha256_origin !== 'segment json (written at render)').length;
  if (lateHashed) log(`WARNING: ${lateHashed}/${nSegs} segment jsons have no file_sha256 (made before the exporter hashed its segments): the hashes below are computed now, so they describe the files as they are, not as they were written`);
  if (present) {
    writeFileSync(LIST, concatListText(segs.map((s) => basename(s.file))));   // names relative to the list, so the folder can be moved or copied
    writeFileSync(SUMS, `${segs.map((s) => `${s.sha256}  ${basename(s.file)}`).join('\n')}\n`);
  }
  if (!PLAN.direct) writeFileSync(P('hashes.txt'), Array.from({ length: nSegs }, (_, i) => readFileSync(P('seg', `${segName(i)}.hashes`), 'utf8')).join(''));
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
  const args = PLAN.direct ? directJoinArgs({ input: masterInput(), out: part, fps: FPS }) : deliveryArgv(masterInput(), part);
  const t = Date.now();
  const r = await runFfmpegAsync(args, { onChild: (p) => killers.push(() => p.kill('SIGKILL')) });
  if (r.code !== 0) { rmSync(part, { force: true }); throw new Error(`delivery encode failed: ${r.stderr.slice(-2000)}`); }
  // VAAPI encodes untagged (deliveryArgs says why); this stream copy makes the hvc1 MP4 Apple's players decode
  let retag = null;
  if (!PLAN.direct && DELIVERY === 'hevc_vaapi') {
    const tagged = P('delivery.hvc1.mp4.part');
    killers.push(() => rmSync(tagged, { force: true }));
    retag = directJoinArgs({ input: ['-i', part], out: tagged, fps: FPS });
    const t2 = await runFfmpegAsync(retag, { onChild: (p) => killers.push(() => p.kill('SIGKILL')) });
    rmSync(part, { force: true });
    if (t2.code !== 0) { rmSync(tagged, { force: true }); throw new Error(`delivery hvc1 retag failed: ${t2.stderr.slice(-2000)}`); }
    renameSync(tagged, part);
  }
  renameSync(part, P('delivery.mp4'));
  // the command that makes delivery.mp4, as --print-ffmpeg prints it (runnable from the run folder); the .part step and the absolute list it really ran are beside it
  man.delivery_command = [FFMPEG, ...deliveryArgv(segsPresent() ? CONCAT_INPUT('seg/list.txt') : ['-i', 'master.mkv'], 'delivery.mp4')].join(' ');
  man.delivery_command_as_run = [FFMPEG, ...args].join(' ');
  if (retag) man.delivery_retag_command_as_run = [FFMPEG, ...retag].join(' ');
  const bitrate = DELIVERY === 'hevc_vaapi' ? VAAPI_BITRATE : DELIVERY === 'hevc_videotoolbox' && !VT_QUALITY ? VT_BITRATE : undefined;
  man.delivery = { codec: DELIVERY, written_as: 'delivery.mp4.part, renamed to delivery.mp4 when the encode succeeded', source: segsPresent() ? 'the lossless segments through the concat demuxer (seg/list.txt)' : 'master.mkv', encode_wall_s: (Date.now() - t) / 1000, trc_tag: TRC, bitrate_arg: bitrate, maxrate_arg: bitrate ? scaleRate(bitrate, VT_MAXRATE_X) : undefined, bufsize_arg: bitrate ? scaleRate(bitrate, VT_BUFSIZE_X) : undefined, quality_arg: DELIVERY === 'hevc_videotoolbox' && VT_QUALITY ? VT_QUALITY : undefined, crf: DELIVERY === 'libx265' ? X265_CRF : undefined, preset: DELIVERY === 'libx265' ? X265_PRESET : undefined, gop: GOP, ...(DELIVERY === 'hevc_vaapi' ? { encoder: DELIVERY, vaapi_device: VAAPI_DEVICE } : {}) };
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
  const piped = PLAN.direct ? frameCount : segs.reduce((a, s) => a + s.bytes_piped, 0) / (RW * RH * 4);
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
    tool: 'test-gl/render-video.mjs', made_at: new Date().toISOString(), run_key: RUN_KEY, pipeline: PIPELINE,
    exporter: RK?.body.exporter ?? prev?.exporter ?? null,
    exporter_this_invocation: EXPORTER,
    engine: RK.provenance ?? prev?.engine, look: { path: lookPath, sha256: K.look_sha256, name: RK.look?.name ?? (lookPath ? basename(lookPath) : null), ...(K.arboretum ? { source: 'arboretum' } : {}), ...(K.playlist ? { source: RK.look?.source ?? 'playlist' } : {}) },
    // the playlist (the key's block, how it was fetched, and the timeline the frames were rendered on, in pumps; video frame = pump - preroll_frames)
    ...(K.playlist ? { playlist: { ...K.playlist, ...RK.playlist_fetch, timeline: SCHEDULE, file: 'playlist.json' } } : {}),
    // the preset the look came from (the key's block, and how it was fetched); the token and the share token are in neither
    ...(K.arboretum ? { arboretum: { ...K.arboretum, ...RK.arboretum_fetch } } : {}),
    overrides: kOverrides, look_changes_are_quality_only: nonQuality.length === 0 && !K.session,
    ...(K.session?{session:K.session}:{}),
    look_statement: nonQuality.length ? `NOT as authored: ${nonQuality.join(', ')} changed` : K.session ? `the look is as authored, rendered under the ${K.session.resolved.quality} quality profile (its ceilings cap the look's fidelity requests) for a ${K.session.resolved.presentation} presentation (which sets the leaf-edge law), with the two governors forced off (adaptive_motion=false, auto_quality=false)` : `the look is as authored; only the quality knobs ${Object.keys(kOverrides).join(', ') || '(none)'} are overridden, plus the two governors forced off (adaptive_motion=false, auto_quality=false)`,
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
    ffmpeg: { version: FFMPEG_VERSION, master_version: K.ffmpeg_version ?? null, binary: FFMPEG, segment_command: [FFMPEG, ...(seg0Args ?? segArgs('seg_NNNNN.mkv', SEG_FRAMES))].join(' '), delivery_command: man.delivery_command ?? prev?.ffmpeg?.delivery_command, delivery_command_as_run: man.delivery_command_as_run ?? prev?.ffmpeg?.delivery_command_as_run, ...((man.delivery_retag_command_as_run ?? prev?.ffmpeg?.delivery_retag_command_as_run) ? { delivery_retag_command_as_run: man.delivery_retag_command_as_run ?? prev?.ffmpeg?.delivery_retag_command_as_run } : {}) },
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
      segments: nSegs, frames: frameCount, batch_frames: PIPELINE === 'browser' ? null : Math.max(1, Math.min(8, Math.floor((64 << 20) / PLAN.frameBytes))),
      render_wall_s: wallSum / 1000, ms_per_frame_mean: wallSum / frameCount, ms_per_frame_min_max_segment: [Math.min(...segs.map((s) => s.render_wall_ms / s.frames)), Math.max(...segs.map((s) => s.render_wall_ms / s.frames))],
      sessions: renderInfo.sessions.length, retries: renderInfo.retries.length, retry_log: renderInfo.retries,
      ...(renderInfo.parallel ? { parallel: renderInfo.parallel } : {}),
    } : prev?.render,
    hashes: PLAN.direct ? null : { file: 'hashes.txt', sha256: sha256(readFileSync(P('hashes.txt'))), frames: N, per_segment: segs.map((s) => ({ file: `seg/${basename(s.file, '.mkv')}.hashes`, sha256: s.hashes_sha256 })) },
    master_probe: masterProbe,
    delivery: man.delivery ?? prev?.delivery, delivery_probe: man.delivery_probe, delivery_fat32: man.delivery_fat32, quality_vs_master: quality,
    frame_accounting: fa,
    notes: [
      'transfer tag: the delivery is tagged bt709 / bt709 / bt709, tv range (--trc); it can be retagged later with -c copy and hevc_metadata',
      DELIVERY === 'hevc_vaapi' ? 'HEVC level: left as VAAPI writes it (delivery_probe.level); the exporter does not set it'
        : 'HEVC level: left as VideoToolbox writes it (delivery_probe.level); the exporter does not set it',
      'quality_vs_master pairs frame i with frame i (settb/setpts=N on both inputs); the delivery is read back to RGB with the same player-grade chroma upsampling as the stills',
    ],
  };
  if (PLAN.direct) {
    manifest.pipeline = PIPELINE;
    manifest.master = null;
    manifest.master_probe = null;
    manifest.encoded_segments = { codec: 'hevc', lossless: false, segments: segs, segments_on_disk: segsPresent(), list: 'seg/list.txt', checksums: 'seg/SHA256SUMS', set_sha256: setSha };
    manifest.output.ss_downscale = PLAN.downscale ? { space: 'linear', filter: 'GPU highp float 2x2 box average in pow(2.2) linear light, rounded to RGBA8' } : null;
    manifest.frame_accounting = { frames_requested: N, frames_captured: frameCount, encoded_packets: mpackets, delivery_decoded_frames: man.delivery_probe?.decoded_frames ?? null, exact: fa.exact };
    manifest.delivery = { ...man.delivery, source: 'encoded MP4 segments, stream copied without re-encoding', pipeline: PIPELINE, codec: 'hevc', ...(PIPELINE === 'browser' ? { quantizer: 1, gop: FPS * 2, bitrate_arg: null, maxrate_arg: null, bufsize_arg: null, quality_arg: null } : {}) };
    manifest.ffmpeg.delivery_command = [FFMPEG, ...directJoinArgs({ input: CONCAT_INPUT('seg/list.txt'), out: 'delivery.mp4', fps: FPS })].join(' ');
    manifest.notes = ['SDR BT709, limited range, 4:2:0; Main10 increases YUV precision, source RGB remains eight-bit.', 'No lossless master or pixel hashes: encoded segments have SHA256 checksums and decoded frame counts.'];
  }
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
  // --jobs N > 1 redoes the holes, not everything after the first one; --jobs 1 is the contiguous-prefix rule it always was
  const framesToRender = JOBS > 1 && !skipRender ? todoSegments({ nSegs, isDone: segReady }).reduce((a, i) => a + segRange(i).to - segRange(i).from, 0) : Math.max(0, N - firstTodo * SEG_FRAMES);
  checkDisk(framesToRender);
  if (!skipRender) await (JOBS > 1 ? renderParallel() : renderAll(firstTodo));
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
  const discarding = (DISCARD || PLAN.direct) && fa.exact;
  if (discarding) Object.assign(PLAN.direct ? manifest.encoded_segments : manifest.master, { segments_on_disk: false, discarded: true, discarded_at: new Date().toISOString() });
  writeJsonAtomic(P('manifest.json'), manifest);
  if ((!skipRender || discarding) && fa.exact) {
    writeFileSync(completeFile, JSON.stringify({ key: RUN_KEY, frames: N, master_set_sha256: setSha, ...(discarding ? { master_discarded: true } : {}), at: new Date().toISOString() }));
    if (discarding) { for (let i = 0; i < nSegs; i++) rmSync(segFile(i), { force: true }); log(PLAN.direct ? 'encoded segments removed after verified delivery; segment records, checksums and checkpoints stay' : 'master discarded (--discard-master): seg/*.mkv deleted; the lists, checksums, segment records, checkpoints and hashes stay'); }
    if (has('--drop-segments')) { for (let i = 0; i < nSegs; i++) rmSync(segFile(i), { force: true }); log('segments dropped (seg/*.mkv); master.mkv, hashes, checkpoints and the lists stay'); }
  }
  log(`done: ${N} frames; ${PLAN.direct ? PIPELINE : 'master'} ${mpackets} packets in ${nSegs} segments (${(masterBytes / 2 ** 20).toFixed(0)} MiB)${mergedSha ? ' + merged master.mkv' : ''}; delivery ${man.delivery_probe && !man.delivery_probe.error ? `${man.delivery_probe.decoded_frames} frames, ${man.delivery_probe.size_mib.toFixed(1)} MiB, ${man.delivery_probe.mbit_s.toFixed(1)} Mbit/s` : 'none'}; frame accounting ${fa.exact ? 'EXACT' : 'MISMATCH'}`);
  if (!fa.exact) process.exitCode = 4;
} catch (e) {
  log(`FAILED: ${e.stack || e}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);   // everything is awaited by here; the exit handlers close what is left (server, browser, ffmpeg)
