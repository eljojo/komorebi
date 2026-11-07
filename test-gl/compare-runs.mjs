// Are two exporter run folders the same render?   node test-gl/compare-runs.mjs <runA> <runB>        exit 0: identical; 1: the first difference, printed; 2: not comparable / unreadable
// For a serial render and a --jobs N render of the same clip (render-video.mjs --jobs). It reads files only; no ffmpeg, no browser.
//   - the run key (run-key.json) and the manifest's run_key: equal, else they are not the same run (an engine, exporter, look, size, ... differs; --jobs is not in the key)
//   - the pipeline and the segment records: same count, same first_frame and frames for each seg/seg_NNNNN.json
//   - master runs: hashes.txt line by line (64-bit frame hashes of the pixels as the GPU wrote them: THE equality), and each segment's hashes_sha256. The .mkv files are NOT compared:
//     Matroska carries a random segment UID, so identical frames make different bytes.
//   - direct runs (gpu, gpu-main10, browser; no raw pixels): each segment's file_sha256 and packets, from its record (the HEVC bytes the encoder made)
//   - checkpoints: every ckpt/ckpt_<pump>.json that BOTH folders hold has the same state. A serial render writes the full-size engine's state; a --jobs render the tiny engine's ("tiny": true),
//     so a difference here is the tiny-engine state diverging from the full-size one, the thing --jobs rests on.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const segRecords = (dir) => (existsSync(join(dir, 'seg')) ? readdirSync(join(dir, 'seg')) : []).filter((f) => /^seg_\d+\.json$/.test(f)).sort().map((f) => ({ file: f, ...readJson(join(dir, 'seg', f)) }));

// Returns the list of differences, first first (empty: the same render). Throws Error with .code = 'NOT_COMPARABLE' for a folder it cannot read.
export function compareRuns(a, b) {
  const diffs = [], add = (m) => { diffs.push(m); return diffs; };
  const need = (dir, f) => { if (!existsSync(join(dir, f))) throw Object.assign(new Error(`${dir} has no ${f}: not a run folder (or it was not rendered)`), { code: 'NOT_COMPARABLE' }); };
  for (const d of [a, b]) need(d, 'run-key.json');
  const ka = readJson(join(a, 'run-key.json')), kb = readJson(join(b, 'run-key.json'));
  if (ka.key !== kb.key) {
    const keys = [...new Set([...Object.keys(ka.body), ...Object.keys(kb.body)])].filter((k) => !isDeepStrictEqual(ka.body[k], kb.body[k]));
    add(`run key differs (${ka.key.slice(0, 12)} vs ${kb.key.slice(0, 12)}): ${keys.join(', ') || 'body equal'}`);
    return diffs;
  }
  for (const d of [a, b]) if (existsSync(join(d, 'manifest.json'))) { const m = readJson(join(d, 'manifest.json')); if (m.run_key !== ka.key) add(`${d}: manifest.json run_key ${String(m.run_key).slice(0, 12)} is not the run key ${ka.key.slice(0, 12)}`); }
  const pipeline = ka.body.pipeline ?? 'master';
  const sa = segRecords(a), sb = segRecords(b);
  if (sa.length !== sb.length) { add(`segment records: ${sa.length} vs ${sb.length}`); return diffs; }
  for (let i = 0; i < sa.length; i++) {
    const x = sa[i], y = sb[i];
    if (x.file !== y.file) { add(`segment record ${i}: ${x.file} vs ${y.file}`); return diffs; }
    for (const f of ['first_frame', 'frames', 'packets']) if (x[f] !== y[f]) add(`${x.file}: ${f} ${x[f]} vs ${y[f]}`);
    if (pipeline === 'master') { if (x.hashes_sha256 !== y.hashes_sha256) add(`${x.file}: frame-hash list differs (sha256 ${String(x.hashes_sha256).slice(0, 12)} vs ${String(y.hashes_sha256).slice(0, 12)})`); }
    else if (x.file_sha256 !== y.file_sha256) add(`${x.file}: encoded file differs (sha256 ${String(x.file_sha256).slice(0, 12)} vs ${String(y.file_sha256).slice(0, 12)})`);
  }
  if (pipeline === 'master') {
    need(a, 'hashes.txt'); need(b, 'hashes.txt');
    const ha = readFileSync(join(a, 'hashes.txt'), 'utf8').split('\n').filter(Boolean), hb = readFileSync(join(b, 'hashes.txt'), 'utf8').split('\n').filter(Boolean);
    if (ha.length !== hb.length) add(`hashes.txt: ${ha.length} vs ${hb.length} frames`);
    for (let i = 0; i < Math.min(ha.length, hb.length); i++) if (ha[i] !== hb[i]) { add(`hashes.txt: frame ${i + 1} differs (${ha[i]} vs ${hb[i]})`); break; }   // the first frame that differs; later ones follow from a state that moved
  }
  // the integrator states both folders hold: lowest pump first
  const ck = (d) => new Set((existsSync(join(d, 'ckpt')) ? readdirSync(join(d, 'ckpt')) : []).filter((f) => /^ckpt_\d+\.json$/.test(f)));
  const ca = ck(a), cb = ck(b), common = [...ca].filter((f) => cb.has(f)).sort();
  let checked = 0;
  for (const f of common) {
    const x = readJson(join(a, 'ckpt', f)), y = readJson(join(b, 'ckpt', f));
    checked++;
    if (!isDeepStrictEqual(x.state, y.state)) { add(`ckpt/${f}: the integrator state differs${x.tiny || y.tiny ? ` (${x.tiny ? 'A' : 'B'} ${x.tiny && y.tiny ? 'and B are' : 'is'} from the tiny engine)` : ''}: the parallel render did not start there where a serial one does`); break; }
  }
  compareRuns.lastChecked = { segments: sa.length, checkpoints: checked };
  return diffs;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [a, b, ...rest] = process.argv.slice(2);
  if (!a || !b || rest.length) { console.error('usage: node test-gl/compare-runs.mjs <runA> <runB>'); process.exit(2); }
  try {
    const diffs = compareRuns(a, b);
    if (diffs.length) { console.error(`DIFFERENT: ${diffs[0]}${diffs.length > 1 ? `\n  (${diffs.length - 1} more)\n${diffs.slice(1).map((d) => `  ${d}`).join('\n')}` : ''}`); process.exit(1); }
    console.log(`IDENTICAL: ${compareRuns.lastChecked.segments} segments, ${compareRuns.lastChecked.checkpoints} checkpoints compared, same run key`);
  } catch (e) { console.error(`compare-runs: ${e.message}`); process.exit(2); }
}
