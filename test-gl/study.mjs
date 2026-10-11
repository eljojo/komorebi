// The quality study: screen real looks, sweep the quality knobs, then compare lossless frames.
// All GPU work goes through render-video.mjs. Importing this module never launches a browser.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  CONCAT_INPUT, FFMPEG, HERE, LOSSLESS_BYTES_PER_FRAME_1080, canonicalSha256,
  cleanupExport, exportEngine, fetchArboretum, parseArboretumSpec, runFfmpegAsync, sha256,
} from './video-lib.mjs';
import { folderProblems, mergeManifest } from './review.mjs';

const QUALITY_KEYS = ['bake_resolution', 'tex_resolution', 'sample_count'];
export const THRESHOLD = { ssim: 0.999, vmaf: 98, psnr_db: 48 };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const jsonRead = (f) => JSON.parse(readFileSync(f, 'utf8'), (_, v) => v === 'inf' ? Infinity : v);
const jsonWrite = (f, v) => {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(`${f}.part`, `${JSON.stringify(v, (_, x) => x === Infinity ? 'inf' : x, 2)}\n`);
  renameSync(`${f}.part`, f);
};
const textOrEmpty = (f) => existsSync(f) ? readFileSync(f, 'utf8') : '';
const number = (v) => /^(?:inf|infinity)$/i.test(v) ? Infinity : Number(v);
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'look';
export const authoredQuality = (p) => ({ tex: p.tex_resolution ?? 2048, bake: p.bake_resolution ?? 1024, samples: p.sample_count ?? 32 });

export function variantGrid(authored) {
  const variants = [
    { id: 'ref', label: 'REF (max)', knob: 'ref', set: { tex_resolution: 4096, bake_resolution: 0, sample_count: 48 }, ss: 2 },
    { id: 'A', label: 'authored', knob: 'A', set: {}, ss: 1 },
    ...[1024, 2048, 4096].map((n) => ({ id: `tex${n}`, label: `tex ${n}`, knob: 'tex', set: { tex_resolution: n }, ss: 1 })),
    ...[768, 1024, 1536, 2048, 0].map((n) => ({ id: `bake${n}`, label: `bake ${n}`, knob: 'bake', set: { bake_resolution: n }, ss: 1 })),
    ...[16, 24, 32, 48].map((n) => ({ id: `smp${n}`, label: `samples ${n}`, knob: 'samples', set: { sample_count: n }, ss: 1 })),
    { id: 'ss2', label: 'authored, ss 2', knob: 'ss', set: {}, ss: 2 },
    { id: 'maxnoss', label: 'max without ss', knob: 'max', set: { tex_resolution: 4096, bake_resolution: 0, sample_count: 48 }, ss: 1 },
  ];
  const seen = new Map();
  return variants.map((v) => {
    const tex = v.set.tex_resolution ?? authored.tex, bake = v.set.bake_resolution ?? authored.bake;
    const effective = { tex, bake: bake || tex, samples: v.set.sample_count ?? authored.samples, ss: v.ss };
    const key = JSON.stringify(effective), dupe_of = seen.get(key) ?? null;
    // Only authored-equivalent settings (and ss2 equivalent to REF) are omitted; distinct knob rows remain sweeps.
    if (v.id === 'ref' || v.id === 'A') seen.set(key, v.id);
    return { ...v, effective, dupe_of };
  });
}
export const renderableVariants = (grid) => grid.filter((v) => !v.dupe_of);
export function variantArgv(v) {
  for (const k of Object.keys(v.set)) if (!QUALITY_KEYS.includes(k)) throw new Error(`not a quality key: ${k}`);
  return [...QUALITY_KEYS.filter((k) => k in v.set).flatMap((k) => ['--set', `${k}=${v.set[k]}`]), ...(v.ss > 1 ? ['--ss', String(v.ss)] : [])];
}
export function childArgv({ lookFile, engine, out, seconds, size, fps, preroll, chrome, variant }) {
  return [join(HERE, 'render-video.mjs'), '--look-json', lookFile, ...(engine.tree ? ['--tree'] : ['--commit', engine.commit]),
    '--out', out, '--seconds', String(seconds), '--size', size.join('x'), '--fps', String(fps), '--preroll', String(preroll), '--delivery', 'none', '--chrome', chrome, ...variantArgv(variant)];
}

export function parseVmaf({ json, stderr = '' } = {}) {
  if (json) {
    const v = JSON.parse(json), scores = v.frames?.map((f) => f.metrics.vmaf) ?? [];
    return { vmaf: v.pooled_metrics?.vmaf?.mean ?? mean(scores), vmaf_min_frame: scores.length ? Math.min(...scores) : v.pooled_metrics?.vmaf?.min ?? null };
  }
  const m = /VMAF score:\s*([\d.]+)/.exec(stderr);
  return m ? { vmaf: Number(m[1]), vmaf_min_frame: null } : null;
}
export function parsePair({ stderr, psnrLog = '', ssimLog = '', vmafJson }) {
  const ps = [...psnrLog.matchAll(/psnr_avg:([\d.]+|inf)/g)].map((m) => number(m[1]));
  const ss = [...ssimLog.matchAll(/All:([\d.]+)/g)].map((m) => Number(m[1]));
  const p = /PSNR .*?average:([\d.]+|inf)/.exec(stderr), s = /SSIM .*?All:([\d.]+)/.exec(stderr);
  if (!p || !s || !ps.length || ps.length !== ss.length) throw new Error('ffmpeg did not produce matching psnr/ssim frames');
  return { psnr_db: number(p[1]), ssim: Number(s[1]), psnr_min_frame_db: Math.min(...ps), ssim_min_frame: Math.min(...ss), frames: ps.length,
    vmaf: null, ...(parseVmaf({ json: vmafJson, stderr }) ?? {}) };
}
export const parseYavg = (text) => [...text.matchAll(/lavfi.signalstats.YAVG=([\d.e+-]+)/g)].map((m) => Number(m[1]));
export const hasFilter = (text, name) => text.split('\n').some((l) => l.trim().split(/\s+/)[1] === name);
const selection = (select) => select ? `,select=${select.map((n) => `eq(n\\,${n})`).join('+')},setpts=N` : '';
export function pairGraph({ fps = 60, select, vmafLog = null }) {
  const n = vmafLog ? 3 : 2;
  const graph = [`[0:v]settb=1/${fps},setpts=N${selection(select)},format=gbrp[d]`, `[1:v]settb=1/${fps},setpts=N${selection(select)},format=gbrp[m]`,
    `[d]split=${n}[dp][ds]${vmafLog ? '[dv]' : ''}`, `[m]split=${n}[mp][ms]${vmafLog ? '[mv]' : ''}`,
    '[dp][mp]psnr=stats_file=psnr.log[p]', '[ds][ms]ssim=stats_file=ssim.log[s]'];
  if (vmafLog) graph.push('[dv]format=yuv444p[dvmaf]', '[mv]format=yuv444p[mvmaf]', `[dvmaf][mvmaf]libvmaf=log_fmt=json:log_path=${vmafLog}[v]`);
  return graph.join(';');
}
export function analysisGraph({ fps = 60, select } = {}) {
  return `[0:v]settb=1/${fps},setpts=N${selection(select)},format=gray16le,split=2[a][b];` +
    "[a]convolution=0m='0 -1 0 -1 4 -1 0 -1 0':0rdiv=0.125:0bias=32768,lut=y='abs(val-32768)',scale=in_range=pc:out_range=pc,format=yuv444p16le,signalstats,metadata=print:file=hp.txt[hp];" +
    '[b]tblend=all_mode=difference,scale=in_range=pc:out_range=pc,format=yuv444p16le,signalstats,metadata=print:file=shimmer.txt[sh]';
}
// ffmpeg's gray16 conversion maps white to 65276; the Laplacian is scaled by 1/8 to avoid clipping signed values.
export const hfFromYavg = (n) => n * 8 * 255 / 65276;
export const shimmerFromYavg = (n) => n * 255 / 65276;
export const excess = (a, b) => {
  if (a.length !== b.length) throw new Error(`different frames: ${a.length} versus ${b.length}`);
  return mean(a) - mean(b);
};
export async function measurePair({ variant, ref, cwd, fps = 60, vmaf = false, select }) {
  mkdirSync(cwd, { recursive: true });
  const graph = pairGraph({ fps, select, vmafLog: vmaf ? 'vmaf.json' : null });
  const args = ['-hide_banner', '-nostats', '-y', ...variant, ...ref, '-filter_complex', graph, '-map', '[p]', '-f', 'null', '-', '-map', '[s]', '-f', 'null', '-'];
  if (vmaf) args.push('-map', '[v]', '-f', 'null', '-');
  const result = await runFfmpegAsync(args, { cwd, quiet: false });
  if (result.code) throw new Error(`ffmpeg pair: ${result.stderr}`);
  return parsePair({ stderr: result.stderr, psnrLog: textOrEmpty(join(cwd, 'psnr.log')), ssimLog: textOrEmpty(join(cwd, 'ssim.log')), vmafJson: vmaf ? textOrEmpty(join(cwd, 'vmaf.json')) : null });
}
export async function measureClip({ input, cwd, fps = 60, select }) {
  mkdirSync(cwd, { recursive: true });
  const result = await runFfmpegAsync(['-hide_banner', '-nostats', '-y', ...input, '-filter_complex', analysisGraph({ fps, select }), '-map', '[hp]', '-f', 'null', '-', '-map', '[sh]', '-f', 'null', '-'], { cwd });
  if (result.code) throw new Error(`ffmpeg analysis: ${result.stderr}`);
  return { hp: parseYavg(textOrEmpty(join(cwd, 'hp.txt'))).map(hfFromYavg), shimmer: parseYavg(textOrEmpty(join(cwd, 'shimmer.txt'))).map(shimmerFromYavg) };
}

export const thresholdText = (hasVmaf) => `SSIM >= 0.999 and ${hasVmaf ? 'VMAF >= 98' : 'PSNR >= 48 dB (no libvmaf)'}`;
export const indistinguishable = (r, { hasVmaf }) => r.ssim != null && r.ssim >= THRESHOLD.ssim && (hasVmaf ? r.vmaf != null && r.vmaf >= THRESHOLD.vmaf : r.psnr_db != null && r.psnr_db >= THRESHOLD.psnr_db);
export function costFromSegments(segs) {
  const ms = segs.map((s) => s.render_wall_ms / s.frames), sorted = (ms.length >= 3 ? ms.slice(1) : ms).sort((a, b) => a - b), i = Math.floor(sorted.length / 2);
  return { ms_per_frame: sorted.length ? (sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2) : null, ms_first_segment: ms[0] ?? null, segments: segs.length };
}
export function selectKnee(rows) {
  const good = rows.filter((r) => r.flag && Number.isFinite(r.cost_ms)).sort((a, b) => a.cost_ms - b.cost_ms || a.id.localeCompare(b.id));
  if (!good.length) throw new Error('no measured reference cost');
  return { ...good[0], note: good[0].id === 'ref' ? 'nothing cheaper is within the threshold' : 'cheapest variant within the threshold; José judges' };
}
export function knobSummary(looks) {
  const by = new Map();
  for (const look of looks) {
    const ref = look.rows.find((r) => r.id === 'ref');
    for (const r of look.rows.filter((r) => r.id !== 'ref')) {
      const s = by.get(r.id) ?? { id: r.id, label: r.label ?? r.id, looks: 0, flagged: 0, costs: [] };
      s.looks++; s.flagged += Number(r.flag);
      if (r.cost_ms != null && ref.cost_ms > 0) s.costs.push(r.cost_ms / ref.cost_ms);
      by.set(r.id, s);
    }
  }
  return [...by.values()].map(({ costs, ...s }) => ({ ...s, mean_cost_vs_ref: mean(costs) }));
}
export const knobSentence = (s, label = s.label) => `${label} vs REF: indistinguishable on ${s.flagged}/${s.looks} looks; mean cost ${(s.mean_cost_vs_ref * 100).toFixed(1)}% of REF`;
export function lookDescriptors(params, eng) {
  const p = { ...eng.DEFAULTS, ...params };
  const keys = ['wind_strength', 'core_angular_radius_deg', 'halo_angular_radius_deg', 'eclipse', 'eclipse_amount', 'foliage_density', 'layer_count', 'tree_count', 'clusters_per_layer', 'leaves_per_cluster', 'leaf_size_m', 'faithful_canopy', 'sample_count', 'tex_resolution', 'bake_resolution'];
  return { ...Object.fromEntries(keys.map((k) => [k, p[k]])), camera: eng.cameraFor(p), tiers: eng.featuresFor(p), wind: p.wind_strength, windy: p.wind_strength > 0,
    leaf_count: p.layer_count * p.tree_count * p.clusters_per_layer * p.leaves_per_cluster };
}
export async function loadEngine(root) {
  const [eng, { PRESETS }] = await Promise.all([import(pathToFileURL(join(root, 'komorebi.js')).href), import(pathToFileURL(join(root, 'presets.js')).href)]);
  return { ...eng, PRESETS };
}
function ranks(a) {
  const sorted = a.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v), out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1; while (j < sorted.length && sorted[j].v === sorted[i].v) j++;
    for (let k = i; k < j; k++) out[sorted[k].i] = (i + j - 1) / 2;
    i = j;
  }
  return out;
}
export function spearman(a, b) {
  const x = ranks(a), y = ranks(b), mx = mean(x), my = mean(y);
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < x.length; i++) { xy += (x[i] - mx) * (y[i] - my); xx += (x[i] - mx) ** 2; yy += (y[i] - my) ** 2; }
  return xx && yy ? xy / Math.sqrt(xx * yy) : 0;
}
export function explainers(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter((k) => k !== 'ssim' && k !== 'psnr_db' && rows.every((r) => typeof r[k] === 'number' && Number.isFinite(r[k])))
    .map((key) => ({ key, rho: spearman(rows.map((r) => r[key]), rows.map((r) => 1 - r.ssim)) }))
    .filter((r) => r.rho !== 0).sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}
export function proposeLooks(rows, { n = 10 } = {}) {
  const sorted = [...rows].sort((a, b) => a.ssim - b.ssim), picks = [], chosen = new Set();
  const add = (r, reason) => { if (r && !chosen.has(r) && picks.length < n) { chosen.add(r); picks.push({ name: r.name, file: r.file, slug: r.slug, reason }); } };
  for (const r of sorted.slice(0, 3)) add(r, 'among the three most sensitive to quality');
  for (const r of sorted.slice(-2).reverse()) add(r, 'control: among the two least sensitive');
  const features = (r) => [`camera:${r.camera}`, r.windy ? 'windy' : 'still', ...(r.tiers ?? []).map((t) => `tier:${t}`), ...(r.projector ? [`projector:${r.name}`] : [])];
  const required = new Set(['camera:floor', 'camera:sky', 'camera:cloth', 'camera:enclosure', 'windy', 'still', ...rows.flatMap(features).filter((f) => f.startsWith('tier:') || f.startsWith('projector:'))]);
  while (picks.length < Math.min(n, rows.length)) {
    const covered = new Set([...chosen].flatMap(features));
    const remaining = sorted.filter((r) => !chosen.has(r)).map((r) => ({ r, missing: features(r).filter((f) => required.has(f) && !covered.has(f)) }))
      .sort((a, b) => b.missing.reduce((s, f) => s + (f.startsWith('projector:') ? 10 : 1), 0) - a.missing.reduce((s, f) => s + (f.startsWith('projector:') ? 10 : 1), 0));
    add(remaining[0].r, remaining[0].missing.length ? `covers ${remaining[0].missing.join(', ')}` : 'additional sensitive look');
  }
  const covered = new Set([...chosen].flatMap(features));
  return { picks, uncovered: [...required].filter((f) => !covered.has(f)) };
}

export function variantMsGuess(v, authored, { authoredMs = 15, maxMs = 300 } = {}) {
  if (v.id === 'ref') return maxMs;
  const aBake = authored.bake || authored.tex;
  const ratio = Math.max(1, v.effective.tex / authored.tex) ** 2 * Math.max(1, v.effective.bake / aBake) ** 2 * Math.max(1, v.effective.samples / authored.samples) * v.ss ** 2;
  return Math.min(maxMs, authoredMs * ratio);
}
export function estimateRun({ looks, seconds = 30, fps = 60 }) {
  let variants = 0, wall = 0;
  for (const l of looks) for (const v of renderableVariants(l.variants ?? variantGrid(l.authored ?? authoredQuality(l.params ?? {})))) {
    variants++; wall += seconds * fps * variantMsGuess(v, l.authored ?? authoredQuality(l.params ?? {}), l) / 1000 + 5;
  }
  return { variants, frames: variants * seconds * fps, seconds: wall };
}
export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min ${s} s`;
}
export const diskEstimate = ({ variants, frames, size }) => ({ bytes: variants * frames * LOSSLESS_BYTES_PER_FRAME_1080 * size[0] * size[1] / (1920 * 1080) });
export function variantComplete(dir, frames) {
  try { return jsonRead(join(dir, 'complete.json')).frames === frames; } catch { return false; }
}
export const runMetaProblems = (old, fresh) => old ? ['commit', 'seconds', 'fps', 'size', 'preroll', 'chrome'].filter((k) => !isDeepStrictEqual(old[k], fresh[k])).map((k) => `${k} differs from this folder's run`) : [];
export function readLooks(path, { skip = [] } = {}) {
  const full = resolve(path);
  if (statSync(full).isDirectory()) return readdirSync(full).filter((f) => f.endsWith('.json') && !skip.includes(f)).sort().flatMap((f) => readLooks(join(full, f)));
  const data = jsonRead(full);
  if (Array.isArray(data.looks)) return data.looks.flatMap((l) => {
    if (!l.file) throw new Error(`chosen look ${l.name} needs file`);
    return readLooks(resolve(dirname(full), l.file)).map((r) => ({ ...r, ...l, file: resolve(dirname(full), l.file) }));
  });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`not a look: ${full}`);
  return [{ name: data.name ?? basename(full, '.json'), params: data.params ?? data, file: full, projector: data.projector ?? /projector/i.test(data.name ?? basename(full)) }];
}

export const frameId = (look, variant, scale) => `S${look}-${variant}${scale === 2 ? '-2x' : ''}`;
export const cropSize = (w, h) => [Math.max(2, Math.floor(w / 8) * 2), Math.max(2, Math.floor(h / 8) * 2)];
export function busiestWindow(plane, width, height, w, h) {
  const stride = width + 1, integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) integral[(y + 1) * stride + x + 1] = plane[y * width + x] + integral[y * stride + x + 1] + integral[(y + 1) * stride + x] - integral[y * stride + x];
  let best = { x: 0, y: 0, w, h, sum: 0 };
  for (let y = 0; y + h <= height; y += 2) for (let x = 0; x + w <= width; x += 2) {
    const sum = integral[(y + h) * stride + x + w] - integral[y * stride + x + w] - integral[(y + h) * stride + x] + integral[y * stride + x];
    if (sum > best.sum) best = { x, y, w, h, sum };
  }
  return best;
}
export function sheetVariants(rows, knee) {
  const ids = new Set(['ref', 'A', knee]);
  for (const [key, direction] of [['ssim', 1], ['hf_excess', -1], ['shimmer_excess', -1]]) {
    const row = [...rows].filter((r) => r.id !== 'ref').sort((a, b) => direction * (a[key] - b[key]))[0];
    if (row) ids.add(row.id);
  }
  const others = rows.filter((r) => !ids.has(r.id));
  for (const r of others) { if (ids.size >= Math.min(6, rows.length)) break; ids.add(r.id); }
  return [...ids].filter((id) => rows.some((r) => r.id === id));
}
const magickText = (s) => s.replace(/%/g, '%%').replace(/^@/, '\\@');
export function montageArgs({ items, tile, size, title, out, font }) {
  return ['montage', ...(font ? ['-font', font] : []), '-pointsize', '18', ...items.flatMap((i) => ['-label', magickText(i.label), i.file]), '-tile', tile, '-geometry', `${size.join('x')}+8+8`, '-background', 'white', '-title', magickText(title), out];
}
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function plotSvg({ title, points }) {
  const colors = ['#2563eb', '#ea580c', '#16a34a', '#9333ea'], groups = ['authored', 'textures/bake', 'samples', 'supersampling/max'];
  const group = (p) => p.knob === 'A' ? 0 : ['tex', 'bake'].includes(p.knob) ? 1 : p.knob === 'samples' ? 2 : 3;
  const y = (s) => 340 - Math.max(0, Math.min(1, s)) * 290;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="430" viewBox="0 0 900 430"><rect width="900" height="430" fill="white"/><g font-family="sans-serif" font-size="12"><text x="55" y="25">${xml(title)}</text><path d="M55 50V340H700" fill="none" stroke="black"/><path d="M55 ${y(THRESHOLD.ssim)}H700" stroke="#aaa" stroke-dasharray="4 4"/><text x="710" y="${y(THRESHOLD.ssim) + 4}">SSIM &gt;= 0.999</text>${points.map((p) => `<circle cx="${55 + p.x * 620}" cy="${y(p.ssim ?? 1)}" r="${p.knee ? 7 : 4}" fill="${colors[group(p)]}" stroke="${p.flag ? 'black' : 'none'}"/><text x="${59 + p.x * 620}" y="${y(p.ssim ?? 1) - 7}">${xml(p.id)}</text>`).join('')}${groups.map((g, i) => `<circle cx="${60 + i * 210}" cy="390" r="4" fill="${colors[i]}"/><text x="${70 + i * 210}" y="394">${g}</text>`).join('')}<text x="240" y="365">render cost / REF (lower is cheaper)</text><text x="5" y="180">SSIM</text></g></svg>`.replace('SSIM &gt;=', 'SSIM >=');
}

const masterInput = (dir) => CONCAT_INPUT(join(dir, 'seg', 'list.txt'));
const segmentRecords = (dir) => readdirSync(join(dir, 'seg')).filter((f) => /^seg_\d+\.json$/.test(f)).sort().map((f) => jsonRead(join(dir, 'seg', f)));
const metricKey = (dir) => canonicalSha256({ complete: jsonRead(join(dir, 'complete.json')), run: jsonRead(join(dir, 'run-key.json')) });
function cachedMetrics(path, key) {
  try { const c = jsonRead(path); return c.cache_key === key ? c : null; } catch { return null; }
}
export async function measureLook({ out, look, meta, vmaf, log = console.log }) {
  const root = join(out, look.slug), refDir = join(root, 'ref'), refKey = metricKey(refDir), frames = Math.round(meta.seconds * meta.fps);
  const analysis = async (id) => {
    const dir = join(root, id), key = metricKey(dir), path = join(root, 'metrics', `${id}-analysis.json`);
    const old = cachedMetrics(path, key);
    if (old) return old;
    if (!variantComplete(dir, frames)) throw new Error(`${look.name}/${id}: incomplete; finish run before report`);
    const m = await measureClip({ input: masterInput(dir), cwd: join(root, 'metrics', `${id}-analysis`), fps: meta.fps });
    if (m.hp.length !== frames || m.shimmer.length !== Math.max(0, frames - 1)) throw new Error(`${look.name}/${id}: decoded frames disagree with complete.json`);
    const result = { ...m, cache_key: key }; jsonWrite(path, result); return result;
  };
  const refAnalysis = await analysis('ref');
  const rendered = [];
  for (const v of renderableVariants(look.variants)) {
    const dir = join(root, v.id), key = canonicalSha256({ variant: metricKey(dir), ref: refKey, vmaf, threshold: THRESHOLD }), path = join(root, 'metrics', `${v.id}.json`);
    const old = cachedMetrics(path, key);
    if (old) { rendered.push(old); continue; }
    log(`${look.name}: measuring ${v.id} against REF`);
    const a = v.id === 'ref' ? refAnalysis : await analysis(v.id);
    const pair = v.id === 'ref' ? { ssim: null, psnr_db: null, vmaf: null, frames } : await measurePair({ variant: masterInput(dir), ref: masterInput(refDir), cwd: join(root, 'metrics', `${v.id}-pair`), fps: meta.fps, vmaf });
    if (pair.frames !== frames) throw new Error(`${look.name}/${v.id}: paired frames ${pair.frames}, expected ${frames}`);
    const cost = costFromSegments(segmentRecords(dir));
    const result = { ...v, ...pair, hf_excess: excess(a.hp, refAnalysis.hp), shimmer_excess: excess(a.shimmer, refAnalysis.shimmer), cost_ms: cost.ms_per_frame, cost,
      flag: v.id === 'ref' || indistinguishable(pair, { hasVmaf: vmaf }), vmaf_enabled: vmaf, cache_key: key };
    jsonWrite(path, result); rendered.push(result);
  }
  const by = new Map(rendered.map((r) => [r.id, r]));
  const rows = look.variants.map((v) => v.dupe_of ? { ...by.get(v.dupe_of), ...v, cache_key: null } : by.get(v.id));
  return { name: look.name, slug: look.slug, authored: look.authored, rows, knee: selectKnee(rendered) };
}
function ffSync(args, options = {}) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 256 << 20, ...options });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr?.toString().trim() || r.error?.message}`);
  return r.stdout;
}
function sourceCommit(dir, fallback) { return jsonRead(join(dir, 'run-key.json')).provenance?.commit ?? fallback; }
async function makeSheet({ out, meta, look, index, reviewDir, magick, log }) {
  const root = join(out, look.slug), variants = sheetVariants(look.rows.filter((r) => !r.dupe_of), look.knee.id);
  const frame = Math.min(60, Math.round(meta.seconds * meta.fps) - 1), [width, height] = meta.size, [w, h] = cropSize(width, height);
  const cropPath = join(root, 'metrics', 'crop.json'), cropKey = canonicalSha256({ ref: metricKey(join(root, 'ref')), frame, size: meta.size });
  let crop = cachedMetrics(cropPath, cropKey)?.crop;
  if (!crop) {
    const raw = ffSync([...masterInput(join(root, 'ref')), '-vf', `select=eq(n\\,${frame}),format=gray16le,convolution=0m='0 -1 0 -1 4 -1 0 -1 0':0rdiv=0.125:0bias=32768,lut=y='abs(val-32768)'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray16le', '-']);
    if (raw.length !== width * height * 2) throw new Error(`${look.name}: wrong crop source frame size`);
    const plane = new Float64Array(width * height);
    for (let i = 0; i < plane.length; i++) plane[i] = raw.readUInt16LE(i * 2);
    crop = busiestWindow(plane, width, height, w, h); jsonWrite(cropPath, { cache_key: cropKey, crop });
  }
  mkdirSync(join(reviewDir, 'frames'), { recursive: true });
  const commit = sourceCommit(join(root, 'ref'), meta.commit), sheets = [];
  for (const scale of [1, 2]) {
    const frames = [];
    for (const id of variants) {
      const row = look.rows.find((r) => r.id === id), dir = join(root, id), fid = frameId(index, id, scale), file = `frames/${fid}.png`, target = join(reviewDir, file);
      const fingerprint = canonicalSha256({ source: metricKey(dir), frame, crop, scale }), stamp = join(root, 'metrics', `${fid}-crop.json`);
      if (!existsSync(target) || !cachedMetrics(stamp, fingerprint)) {
        ffSync([...masterInput(dir), '-vf', `select=eq(n\\,${frame}),crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}${scale === 2 ? ',scale=iw*2:ih*2:flags=neighbor' : ''}`, '-frames:v', '1', target]);
        jsonWrite(stamp, { cache_key: fingerprint });
      }
      frames.push({ id: fid, file, variant: id, frame_index: frame, scale, crop, metrics: row, commit: sourceCommit(dir, meta.commit), sha256: sha256(readFileSync(target)), what: `${look.name}: ${row.label}, ${scale * 100}%` });
    }
    const file = `S${index}-${scale * 100}.png`, title = `S${index} ${look.name} — ${scale * 100}% (frame ${frame})`;
    if (magick) {
      const font = '/System/Library/Fonts/Helvetica.ttc';
      const r = spawnSync('magick', montageArgs({ items: frames.map((f) => ({ file: join(reviewDir, f.file), label: `${f.id}  ${f.what}` })), tile: `${frames.length}x1`, size: [crop.w * scale, crop.h * scale], title, out: join(reviewDir, file), font: existsSync(font) ? font : null }), { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`ImageMagick montage: ${r.stderr || r.error?.message}`);
    } else log(`ImageMagick (magick) unavailable: ${file} sheet skipped; labelled crop IDs and PNGs in manifest/frames`);
    sheets.push({ file, generated: Boolean(magick), sha256: magick ? sha256(readFileSync(join(reviewDir, file))) : null, commit, title, ids: frames.map((f) => f.id).join(', '), question: 'Which quality differences are visible? The knee is a proposal for José.', frames, lead_read: null, jose: null });
  }
  return { variants, crop, frame_index: frame, sheets };
}
function reportMarkdown(report) {
  const lines = ['# Komorebi quality study', '', `Run wall time estimate: ${formatDuration(report.estimate.seconds)} (${report.estimate.variants} variants, ${report.meta.looks.length} looks × ${report.meta.seconds} s × ${report.meta.fps} fps; screen costs when available, otherwise M4 15/300 ms per frame). Screen timings are at 640×360 and omit larger-output overhead; bake cost does not scale with output pixel area. The estimate excludes report CPU time.`, '',
    `libvmaf: ${report.vmaf_available ? 'available' : 'unavailable'}. Proposed “no visible difference” flag: ${thresholdText(report.vmaf_available)}. This is a numerical flag; José decides by eye.`, '',
    'PSNR and SSIM compare lossless RGB masters by frame index. VMAF, when available, reads the same pairs in yuv444p. High-frequency excess is the difference in mean absolute Laplacian residual energy; shimmer excess is the difference in mean absolute consecutive-frame difference. Both are in 8-bit luma code units; positive means jaggier/noisier or more flicker than REF. Raw sharpness is never rewarded.', '',
    'Costs are median segment ms/frame (omit segment 0 when there are at least three). All sweeps change one knob from authored; this does not establish the optimum combination of multiple knobs.', ''];
  const fmt = (n, digits = 4) => n == null ? '—' : n === Infinity ? 'inf' : n.toFixed(digits);
  for (const look of report.looks) {
    lines.push(`## ${look.name}`, '', `Proposed knee: **${look.knee.id}** — ${look.knee.note}. Crops: S${report.looks.indexOf(look) + 1}-<variant> and -2x.`, '',
      '| variant | PSNR dB | SSIM | VMAF | HF excess | shimmer excess | ms/frame | flag | equals |', '|---|---:|---:|---:|---:|---:|---:|---|---|');
    for (const r of look.rows) lines.push(`| ${r.id} | ${fmt(r.psnr_db, 2)} | ${fmt(r.ssim, 6)} | ${fmt(r.vmaf, 2)} | ${fmt(r.hf_excess)} | ${fmt(r.shimmer_excess)} | ${fmt(r.cost_ms, 2)} | ${r.flag ? 'yes' : 'no'} | ${r.dupe_of ?? ''} |`);
    lines.push('');
  }
  lines.push('## Across looks', '', ...report.summary.map((s) => `- ${knobSentence(s)}`), '', `Cost vs quality: plot.svg. Review sheets and manifest: review/<date>/. ${report.complete ? 'Masters may now be removed with study.mjs clean --out <this folder>.' : 'Partial analysis: required sheets were not generated; cleanup is refused. Run report with ImageMagick to complete them.'}`, '');
  return lines.join('\n');
}
export async function assemble({ out, magick, log = console.log, date = new Date().toISOString().slice(0, 10) }) {
  const meta = jsonRead(join(out, 'study.json'));
  const filters = spawnSync(FFMPEG, ['-hide_banner', '-filters'], { encoding: 'utf8' });
  if (filters.status !== 0) throw new Error(`ffmpeg -filters: ${filters.stderr || filters.error?.message}`);
  const vmaf = hasFilter(filters.stdout, 'libvmaf');
  if (magick === undefined) {
    magick = spawnSync('magick', ['-version'], { encoding: 'utf8' }).status === 0;
    if (!magick) throw new Error('ImageMagick (magick) is required for the review sheets; run report with nix shell nixpkgs#nodejs_22 nixpkgs#ffmpeg nixpkgs#imagemagick -c node test-gl/study.mjs report --out <dir>');
  }
  const reviewDir = join(out, 'review', date), manifestPath = join(reviewDir, 'manifest.json'), old = existsSync(manifestPath) ? jsonRead(manifestPath) : null;
  // Check archive ownership before any crop can overwrite a frame or its sha256.
  const specs = meta.looks.flatMap((l, i) => [1, 2].map((s) => ({ file: `S${i + 1}-${s * 100}.png`, frames: renderableVariants(l.variants).map((v) => ({ id: frameId(i + 1, v.id, s) })) })));
  const clash = folderProblems(old, { sheets: specs }, sourceCommit(join(out, meta.looks[0].slug, 'ref'), meta.commit));
  if (clash.length) throw new Error(clash.join('\n'));
  const looks = [];
  for (const [i, l] of meta.looks.entries()) {
    const measured = await measureLook({ out, look: l, meta, vmaf, log });
    measured.sheet = await makeSheet({ out, meta, look: measured, index: i + 1, reviewDir, magick, log }); looks.push(measured);
  }
  const report = { tool: 'test-gl/study.mjs', complete: Boolean(magick), review_dir: reviewDir, meta, vmaf_available: vmaf, threshold: THRESHOLD, estimate: estimateRun(meta), looks, summary: knobSummary(looks) };
  const fresh = { folder: reviewDir, purpose: 'Quality study: matched frames, busiest REF crop, 100% and nearest-neighbour 200%. José judges.', made_by: 'test-gl/study.mjs report', sheets: looks.flatMap((l) => l.sheet.sheets) };
  jsonWrite(manifestPath, mergeManifest(old, fresh));
  writeFileSync(join(out, 'report.md'), reportMarkdown(report));
  const points = looks.flatMap((l) => l.rows.filter((r) => !r.dupe_of).map((r) => ({ ...r, id: `${l.name}/${r.id}`, x: r.cost_ms / l.rows.find((x) => x.id === 'ref').cost_ms, knee: r.id === l.knee.id })));
  writeFileSync(join(out, 'plot.svg'), plotSvg({ title: 'Quality against measured rendering cost (black outlines: within threshold)', points }));
  jsonWrite(join(out, 'report.json'), report);
  return report;
}
export function clean({ out }) {
  const meta = jsonRead(join(out, 'study.json')), refused = []; let removed = 0;
  let report = null;
  try { report = jsonRead(join(out, 'report.json')); } catch { /* A stopped report has no completion artifact. */ }
  for (const look of meta.looks) {
    const root = join(out, look.slug);
    const reported = report?.looks?.find((l) => l.slug === look.slug);
    const artifacts = report?.complete === true && isDeepStrictEqual(report.meta, meta) && reported?.sheet?.sheets?.length === 2 && reported.sheet.sheets.every((sh) => {
      try {
        return sh.generated && sha256(readFileSync(join(report.review_dir, sh.file))) === sh.sha256 && sh.frames.every((f) => sha256(readFileSync(join(report.review_dir, f.file))) === f.sha256);
      } catch { return false; }
    });
    const ready = artifacts && renderableVariants(look.variants).every((v) => {
      try {
        const c = jsonRead(join(root, 'metrics', `${v.id}.json`));
        return c.cache_key === reported.rows.find((r) => r.id === v.id)?.cache_key && c.cache_key === canonicalSha256({ variant: metricKey(join(root, v.id)), ref: metricKey(join(root, 'ref')), vmaf: c.vmaf_enabled, threshold: THRESHOLD });
      } catch { return false; }
    });
    if (!ready) { refused.push(`${look.slug}: complete report, cached metrics and required sheets/crops must match; run report first`); continue; }
    for (const v of renderableVariants(look.variants)) {
      const seg = join(root, v.id, 'seg');
      for (const f of readdirSync(seg).filter((f) => f.endsWith('.mkv'))) { rmSync(join(seg, f)); removed++; }
      const merged = join(root, v.id, 'master.mkv'); if (existsSync(merged)) { rmSync(merged); removed++; }
    }
  }
  return { removed, refused };
}

function runChild(argv) {
  return new Promise((yes, no) => {
    const env = { ...process.env }; delete env.ARBORETUM_TOKEN;
    const child = spawn(process.execPath, argv, { stdio: 'inherit', env });
    const interrupt = () => child.kill('SIGTERM'); process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const finish = () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); };
    child.once('error', (e) => { finish(); no(e); });
    child.once('exit', (code, signal) => { finish(); code === 0 ? yes() : no(new Error(`render-video exited ${signal ?? code}; resume the same command`)); });
  });
}
export const HELP = `Quality study: screen → José confirms the proposed list → run → report → clean.
  node test-gl/study.mjs screen --looks <exported look JSON directory> --out <screen dir> [--arboretum <ids>]
  node test-gl/study.mjs run --looks <chosen.json> --seconds 30 --size 1920x1080 --out <run dir>
  node test-gl/study.mjs report --out <run dir>
  node test-gl/study.mjs clean --out <run dir>
screen includes every built-in plus your JSONs; --arboretum is a comma-separated list of id[@version][:share_token],
using fetchArboretum and ARBORETUM_TOKEN. Tokens never enter files or render children.
screen writes screen.json, screen.md, proposal.json and look JSONs. Edit/copy proposal.json to chosen.json to confirm.
Every GPU render delegates to render-video.mjs, with the same frame clock and 30 s pre-roll.
--commit <sha> selects the engine (default HEAD, resolved once); run may reuse the commit in the proposal.
--fps <n> (60), --preroll <seconds> (30), --chrome <variant> (shell+angle-metal).
run keeps lossless masters and skips completed variants; interrupted exporter segments resume.
--dry-run prints run's commands and estimates without writing or rendering.
report: paired PSNR, SSIM, optional libvmaf, Laplacian excess, shimmer excess, measured cost, knee and numbered crops.
ImageMagick magick is required for labelled 100%/200% sheets; report refuses to complete without it.
Use nix shell nixpkgs#nodejs_22 nixpkgs#ffmpeg nixpkgs#imagemagick -c node test-gl/study.mjs report --out <run dir>.
clean removes masters only after the complete report and its sheets/crops match; segment records and hashes stay.
Estimated run wall time for 10 looks × ~13 variants × 30 seconds × 60 fps: ${formatDuration(estimateRun({ looks: Array.from({ length: 10 }, () => ({ authored: authoredQuality({}) })) }).seconds)}
(M4 defaults: authored 15 ms/frame, max 300; actual screen timings replace these; estimates exclude report CPU time).
Masters: about ${(diskEstimate({ variants: 130, frames: 1800, size: [1920, 1080] }).bytes / 1e9).toFixed(1)} GB at 1080p for 10 × 13 × 30 s. Use a NAS folder with sufficient free space.
`;
function argsOptions(args) {
  const value = (flag, fallback) => { const i = args.indexOf(flag); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`); return args[i + 1]; };
  const size = value('--size', '1920x1080').split('x').map(Number), seconds = Number(value('--seconds', 30)), fps = Number(value('--fps', 60)), preroll = Number(value('--preroll', 30));
  if (size.length !== 2 || !size.every((n) => Number.isInteger(n) && n >= 8 && n % 2 === 0)) throw new Error('--size must be even WxH (at least 8)');
  if (!(seconds > 0 && Number.isFinite(seconds) && fps > 0 && Number.isFinite(fps) && Number.isInteger(seconds * fps) && preroll >= 0 && Number.isFinite(preroll))) throw new Error('invalid seconds/fps/preroll; frame count must be whole');
  return { size, seconds, fps, preroll, chrome: value('--chrome', 'shell+angle-metal'), out: resolve(value('--out') ?? (() => { throw new Error('--out is required'); })()),
    lookPath: value('--looks'), commit: value('--commit'), arboretum: args.flatMap((a, i) => a === '--arboretum' ? args[i + 1].split(',') : []), dryRun: args.includes('--dry-run') };
}
function assertSameLooks(old, fresh) {
  if (!old) return;
  const identity = (l) => ({ name: l.name, slug: l.slug, params_sha256: l.params_sha256, authored: l.authored, variants: l.variants });
  if (!isDeepStrictEqual(old.looks.map(identity), fresh.looks.map(identity))) throw new Error('looks or quality variants differ from this folder; resume the original selection or use another --out');
}
export async function runStudy(o) {
  if (!o.lookPath) throw new Error('run needs --looks');
  const looks = readLooks(o.lookPath), chosen = statSync(o.lookPath).isFile() ? jsonRead(o.lookPath) : null;
  const prior = existsSync(join(o.out, 'study.json')) ? jsonRead(join(o.out, 'study.json')) : null;
  let engine = null;
  try {
    const commit = o.commit ?? chosen?.commit ?? prior?.commit ?? 'HEAD';
    // A dry run only prints argv; a real run resolves HEAD once so every child exports the same commit.
    if (!o.dryRun) engine = exportEngine({ commit });
    const meta = { tool: 'test-gl/study.mjs', commit: engine?.provenance.commit ?? commit, seconds: o.seconds, size: o.size, fps: o.fps, preroll: o.preroll, chrome: o.chrome,
      looks: looks.map((l) => ({ ...l, slug: l.slug ?? slug(l.name), authored: authoredQuality(l.params), params_sha256: canonicalSha256(l.params), variants: variantGrid(authoredQuality(l.params)) })) };
    if (new Set(meta.looks.map((l) => l.slug)).size !== meta.looks.length) throw new Error('look names collide as folder names');
    const problems = runMetaProblems(prior, meta); if (problems.length) throw new Error(problems.join('\n')); assertSameLooks(prior, meta);
    const estimate = estimateRun(meta), disk = diskEstimate({ variants: estimate.variants, frames: meta.seconds * meta.fps, size: meta.size });
    console.log(`${looks.length} looks, ${estimate.variants} renders; estimated wall time ${formatDuration(estimate.seconds)}; lossless masters ${(disk.bytes / 1e9).toFixed(1)} GB`);
    if (!o.dryRun) jsonWrite(join(o.out, 'study.json'), meta);
    for (const look of meta.looks) {
      const root = join(o.out, look.slug), lookFile = join(root, 'look-input.json');
      console.log(`${look.name}: ${renderableVariants(look.variants).length} renders`);
      if (!o.dryRun) jsonWrite(lookFile, { name: look.name, params: look.params });
      for (const variant of renderableVariants(look.variants)) {
        const dir = join(root, variant.id), argv = childArgv({ ...meta, lookFile, engine: { commit: meta.commit }, out: dir, variant });
        if (o.dryRun) console.log([process.execPath, ...argv].map((a) => JSON.stringify(a)).join(' '));
        else if (variantComplete(dir, o.seconds * o.fps)) console.log(`${look.name}/${variant.id}: complete, skipped`);
        else await runChild(argv);
      }
    }
    return meta;
  } finally { cleanupExport(engine); }
}
export async function screenStudy(o) {
  const token = process.env.ARBORETUM_TOKEN ?? null; delete process.env.ARBORETUM_TOKEN;
  const engine = exportEngine({ commit: o.commit ?? 'HEAD' });
  try {
    const eng = await loadEngine(engine.dir), builtins = Object.entries(eng.PRESETS).map(([name, params]) => ({ name, params, origin: 'builtin' }));
    const supplied = o.lookPath ? readLooks(o.lookPath).map((l) => ({ ...l, origin: 'own' })) : [];
    for (const spec of o.arboretum) {
      const fetched = await fetchArboretum({ ...parseArboretumSpec(spec), token });
      supplied.push({ name: fetched.name, params: fetched.params, origin: 'arboretum', arboretum: { id: fetched.id, version: fetched.version }, projector: /projector/i.test(fetched.name) });
    }
    const candidates = [...builtins, ...supplied].map((l, i) => ({ ...l, slug: `${l.origin}-${slug(l.name)}-${i + 1}` }));
    const meta = { commit: engine.provenance.commit, fps: 60, size: [640, 360], seconds: 61 / 60, preroll: o.preroll, chrome: o.chrome, looks: candidates.map((l) => ({ ...l, authored: authoredQuality(l.params), params_sha256: canonicalSha256(l.params), variants: variantGrid(authoredQuality(l.params)).slice(0, 2) })) };
    const screenPath = join(o.out, 'screen.json'), prior = existsSync(screenPath) ? jsonRead(screenPath) : null;
    const clash = runMetaProblems(prior?.meta, meta); if (clash.length) throw new Error(clash.join('\n')); assertSameLooks(prior?.meta, meta);
    mkdirSync(o.out, { recursive: true });
    jsonWrite(screenPath, { meta, rows: prior?.rows ?? [] });
    const rows = [];
    for (const l of meta.looks) {
      const root = join(o.out, l.slug), file = join(root, 'look-input.json'); jsonWrite(file, { name: l.name, params: l.params });
      for (const v of l.variants) {
        const dir = join(root, v.id);
        if (!variantComplete(dir, 61)) await runChild(childArgv({ ...meta, lookFile: file, engine: { commit: meta.commit }, out: dir, variant: v }));
      }
      const pair = await measurePair({ variant: masterInput(join(root, 'A')), ref: masterInput(join(root, 'ref')), fps: 60, select: [0, 60], cwd: join(root, 'screen-metrics') });
      const a = await measureClip({ input: masterInput(join(root, 'A')), fps: 60, select: [0, 60], cwd: join(root, 'A', 'analysis') });
      const r = await measureClip({ input: masterInput(join(root, 'ref')), fps: 60, select: [0, 60], cwd: join(root, 'ref', 'analysis') });
      const authoredMs = costFromSegments(segmentRecords(join(root, 'A'))).ms_per_frame, maxMs = costFromSegments(segmentRecords(join(root, 'ref'))).ms_per_frame;
      rows.push({ ...lookDescriptors(l.params, eng), name: l.name, slug: l.slug, file, origin: l.origin, projector: l.projector ?? /projector/i.test(l.name), ...pair, hf_excess: excess(a.hp, r.hp), authored_ms_per_frame: authoredMs, max_ms_per_frame: maxMs,
        authored: l.authored, authoredMs, maxMs });
      // Completed rows are recorded after each look so a stopped screen can validate its resume recipe.
      jsonWrite(screenPath, { meta, rows });
    }
    rows.sort((a, b) => a.ssim - b.ssim);
    const proposal = proposeLooks(rows), picks = proposal.picks.map((p) => ({ ...p, authoredMs: rows.find((r) => r.file === p.file).authoredMs, maxMs: rows.find((r) => r.file === p.file).maxMs }));
    const report = { meta, rows, explainers: explainers(rows), proposal, note: 'Frames 0 and 60 after standard pre-roll. Timings include the 61 intervening deterministic frames. Estimates use measured screen cost without pixel-area scaling (bake cost dominates independently of output size); larger-output overhead is unmeasured.' };
    jsonWrite(screenPath, report); jsonWrite(join(o.out, 'proposal.json'), { commit: meta.commit, looks: picks, uncovered: proposal.uncovered });
    const table = ['| look | camera | SSIM | PSNR | HF excess | authored ms/frame | max ms/frame | wind | fall tiers |', '|---|---|---:|---:|---:|---:|---:|---:|---|', ...rows.map((r) => `| ${r.name} | ${r.camera} | ${r.ssim.toFixed(6)} | ${r.psnr_db.toFixed(2)} | ${r.hf_excess.toFixed(4)} | ${r.authored_ms_per_frame.toFixed(2)} | ${r.max_ms_per_frame.toFixed(2)} | ${r.wind_strength} | ${r.tiers.join(', ')} |`)].join('\n');
    const text = `# Screen\n\n${report.note}\n\n${table}\n\n## Proposed looks — José confirms before run\n\n${picks.map((p) => `- ${p.name}: ${p.reason}`).join('\n')}\n\nUncovered: ${proposal.uncovered.join(', ') || 'none'}\n\nNumeric descriptor correlations with sensitivity (associations, not causes): ${report.explainers.map((e) => `${e.key}: ${e.rho.toFixed(3)}`).join('; ')}\n`;
    writeFileSync(join(o.out, 'screen.md'), text); console.log(text); return report;
  } finally { cleanupExport(engine); }
}
async function main(args) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  const command = args[0]; if (!['screen', 'run', 'report', 'clean'].includes(command)) throw new Error('choose screen, run, report or clean; --help');
  const o = argsOptions(args.slice(1));
  if (command === 'screen') await screenStudy(o);
  else if (command === 'run') await runStudy(o);
  else if (command === 'report') { await assemble(o); console.log(`report.json, report.md, plot.svg and review sheets: ${o.out}`); }
  else { const result = clean(o); console.log(`removed ${result.removed} master files`); if (result.refused.length) throw new Error(result.refused.join('\n')); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(`study: ${e.message}`); process.exitCode = 2; });
