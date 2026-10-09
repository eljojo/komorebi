// The review-sheet tool: `node test-gl/review.mjs <spec.json> [--dir <folder>] [--keep-export]`
// (`nix run .#review -- spec.json`). Judging frames for José, from a CLEAN export of one commit (never the
// working tree, so a dirty tree or another agent's edits cannot leak into a sheet), laid out as labelled
// sheets whose frame IDs are quotable, plus the manifest.json that lets a later session tell what each
// image is. The pure parts are exported for review.test.js; the render path needs Chromium and ImageMagick.
//
// Spec: { commit, date?, made_by, purpose?, size?: [w,h], font?, sheets: [{ file, title, question, tile?: "4x2",
//   common?: { preset?, overrides?, size? }, frames: [{ id, preset?, overrides?, size?, label?, what }] }] }
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SIZE = [640, 360];
const DEFAULT_FONT = '/System/Library/Fonts/Helvetica.ttc';

// ---- pure parts ----

// Every problem at once, not the first: a spec is edited by hand and a render costs minutes.
export function specProblems(spec) {
  const out = [];
  const okSize = (z) => Array.isArray(z) && z.length === 2 && z.every((n) => Number.isInteger(n) && n > 0);
  if (!spec || typeof spec !== 'object') return ['spec is not an object'];
  if (!Array.isArray(spec.sheets) || !spec.sheets.length) return ['spec.sheets must be a non-empty array'];
  if (spec.size !== undefined && !okSize(spec.size)) out.push('spec.size must be [width, height] in whole pixels');
  const ids = new Set();
  const files = new Set();
  for (const [si, sh] of spec.sheets.entries()) {
    const at = `sheet ${sh?.file ?? si}`;
    if (typeof sh?.file !== 'string' || !/^[\w.-]+\.png$/.test(sh.file)) out.push(`${at}: file must be a plain name ending .png`);
    else if (files.has(sh.file)) out.push(`${at}: duplicate sheet file`);
    else files.add(sh.file);
    if (sh?.tile !== undefined && !/^\d+x\d+$/.test(sh.tile)) out.push(`${at}: tile must look like "4x2"`);
    if (sh?.common?.size !== undefined && !okSize(sh.common.size)) out.push(`${at}: common.size must be [width, height]`);
    if (!Array.isArray(sh?.frames) || !sh.frames.length) { out.push(`${at}: frames must be a non-empty array`); continue; }
    for (const f of sh.frames) {
      if (typeof f?.id !== 'string' || !/^[\w-]+$/.test(f.id)) { out.push(`${at}: frame id ${JSON.stringify(f?.id)} must be letters, digits, _ or -`); continue; }
      // The ID is the quoting handle and the file name; two images under one ID would make José's words ambiguous.
      if (ids.has(f.id)) out.push(`${at}: duplicate frame id ${f.id}`);
      ids.add(f.id);
      if (!(f.preset ?? sh.common?.preset)) out.push(`${at}: frame ${f.id} has no preset (its own or common.preset)`);
      if (f.size !== undefined && !okSize(f.size)) out.push(`${at}: frame ${f.id} size must be [width, height]`);
    }
  }
  return out;
}

export function validateSpec(spec) {
  const p = specProblems(spec);
  if (p.length) throw new Error(`bad spec:\n  ${p.join('\n  ')}`);
  return spec;
}

// Overrides merge common then frame, so a sheet states its recipe once and each frame only what differs.
export function resolveFrame(spec, sheet, frame) {
  return {
    id: frame.id,
    preset: frame.preset ?? sheet.common?.preset,
    size: frame.size ?? sheet.common?.size ?? spec.size ?? DEFAULT_SIZE,
    overrides: { ...(sheet.common?.overrides ?? {}), ...(frame.overrides ?? {}) },
  };
}

// run.js parses each value with JSON.parse, so JSON.stringify is the exact inverse: strings arrive quoted.
export const overrideArgs = (o) => Object.entries(o).map(([k, v]) => `${k}=${JSON.stringify(v)}`);

// One invocation, one --look group per frame: the browser and the page launch once, not per frame.
export const lookArgs = (frames) =>
  frames.flatMap((f) => ['--look', f.preset, '--as', f.id, '--size', f.size.join('x'), ...overrideArgs(f.overrides)]);

export const frameLabel = (f) => f.label ?? (f.what ? `${f.id}  ${f.what}` : f.id);

// Re-running must never erase José's words: his `jose` and the lead's `lead_read` ride through, and anything
// the new spec does not mention (other sheets, other frames) stays. A fresh non-null value wins over the old.
export function mergeManifest(old, fresh) {
  if (!old?.sheets) return fresh;
  const sheets = [];
  const seen = new Set();
  for (const s of fresh.sheets) {
    const o = old.sheets.find((x) => x.file === s.file);
    seen.add(s.file);
    if (!o) { sheets.push(s); continue; }
    const frames = s.frames.map((f) => ({ ...(o.frames ?? []).find((x) => x.id === f.id), ...f }));
    for (const f of o.frames ?? []) if (!frames.some((x) => x.id === f.id)) frames.push(f);
    sheets.push({ ...o, ...s, frames, lead_read: s.lead_read ?? o.lead_read ?? null, jose: s.jose ?? o.jose ?? null });
  }
  for (const o of old.sheets) if (!seen.has(o.file)) sheets.push(o);
  return { ...old, ...fresh, sheets };
}

// The commits a folder already holds renders of: each sheet's own, and for a manifest written before sheets carried one, the
// top-level source tree it was all rendered from.
export function folderCommits(old) {
  if (!old?.sheets) return [];
  const top = /git archive ([0-9a-f]{7,40})\b/.exec(old.how_rendered?.source_tree ?? '')?.[1] ?? null;
  return [...new Set(old.sheets.map((s) => s.commit ?? top).filter(Boolean))];
}

// What would make a render into this folder lie about what it holds — checked before the render, every problem at once. One folder is one
// commit: a sheet from another beside them would be read as theirs (the manifest's provenance is per folder, and José's words are kept by
// file). And an ID names one image: a frame ID the folder already holds on another sheet would overwrite that sheet's frames/<id>.png
// under its recorded sha256.
export function folderProblems(old, spec, sha) {
  if (!old?.sheets) return [];
  const out = [];
  const other = folderCommits(old).filter((c) => !sha.startsWith(c) && !c.startsWith(sha));
  if (other.length) out.push(`the folder holds renders of ${other.join(', ')}, not ${sha.slice(0, 7)}: render into another folder (--dir, or another spec.date)`);
  const owner = new Map();
  for (const sh of old.sheets) for (const f of sh.frames ?? []) owner.set(f.id, sh.file);
  for (const sh of spec.sheets) for (const f of sh.frames) {
    const o = owner.get(f.id);
    if (o && o !== sh.file) out.push(`frame id ${f.id} is already ${o}'s in this folder, not ${sh.file}'s: pick another id`);
  }
  return out;
}

// The spec beside the manifest says how to re-render every sheet the folder holds, not only the last run's: a sheet the new spec does not
// mention keeps its old entry — with the old spec's top-level size folded into its common.size, since the merged spec's top level is the new one's.
export function mergeSpec(oldSpec, spec) {
  const files = new Set(spec.sheets.map((sh) => sh.file));
  const kept = (oldSpec?.sheets ?? []).filter((sh) => !files.has(sh.file))
    .map((sh) => (oldSpec.size && !sh.common?.size ? { ...sh, common: { ...(sh.common ?? {}), size: oldSpec.size } } : sh));
  return { ...spec, sheets: [...spec.sheets, ...kept] };
}

// ---- the render path ----

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// montage expands %-escapes and a leading @ reads a file; a label is neither.
const magickText = (t) => t.replace(/%/g, '%%').replace(/^@/, '\\@');

function main(argv) {
  const args = argv.slice(2);
  const keep = args.includes('--keep-export');
  const di = args.indexOf('--dir');
  const dirArg = di >= 0 ? args[di + 1] : null;
  const specFile = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--dir');
  if (!specFile) throw new Error('usage: node test-gl/review.mjs <spec.json> [--dir <folder>] [--keep-export]');
  const spec = validateSpec(JSON.parse(readFileSync(specFile, 'utf8')));

  const rev = String(spec.commit ?? 'HEAD');
  let sha;
  try {
    if (rev.startsWith('-')) throw new Error('flag-like rev');
    sha = sh('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).trim();
  } catch {
    throw new Error(`commit ${JSON.stringify(rev)} is not a resolvable rev in ${REPO}`);
  }
  const date = spec.date ?? today();
  const dir = resolve(dirArg ?? join(REPO, 'test-gl/out/review', date));
  const mpath = join(dir, 'manifest.json'), spath = join(dir, 'review-spec.json');
  const old = existsSync(mpath) ? JSON.parse(readFileSync(mpath, 'utf8')) : null;
  const clash = folderProblems(old, spec, sha);
  if (clash.length) throw new Error(`cannot render into ${dir}:\n  ${clash.join('\n  ')}`);
  mkdirSync(join(dir, 'frames'), { recursive: true });

  const tmp = mkdtempSync(join(tmpdir(), 'komorebi-review-'));
  try {
    const tree = join(tmp, 'tree');
    mkdirSync(tree);
    const tar = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', REPO, sha, tree], { encoding: 'utf8' });
    if (tar.status !== 0) throw new Error(`git archive failed: ${tar.stderr}`);
    // node_modules is untracked (Playwright + its pinned Chromium), so the export borrows the repo's.
    symlinkSync(join(REPO, 'test-gl/node_modules'), join(tree, 'test-gl/node_modules'));

    const resolved = spec.sheets.flatMap((s) => s.frames.map((f) => resolveFrame(spec, s, f)));
    const run = spawnSync('node', ['run.js', ...lookArgs(resolved)], { cwd: join(tree, 'test-gl'), encoding: 'utf8', maxBuffer: 64 << 20 });
    if (run.status !== 0) throw new Error(`run.js failed (${run.status}):\n${run.stdout}\n${run.stderr}`);
    // run.js prints "  <path>.png   <hash>" per render, in order; the file name is the --as id.
    const hashes = {};
    for (const m of run.stdout.matchAll(/(\S+\.png)\s+([0-9a-f]{8})\b/g)) hashes[basename(m[1], '.png')] = m[2];
    for (const f of resolved) {
      if (!hashes[f.id]) throw new Error(`run.js printed no hash for ${f.id}:\n${run.stdout}`);
      copyFileSync(join(tree, 'test-gl/out', `${f.id}.png`), join(dir, 'frames', `${f.id}.png`));
    }

    const font = spec.font ?? (existsSync(DEFAULT_FONT) ? DEFAULT_FONT : null);
    const sheets = spec.sheets.map((s) => {
      const frames = s.frames.map((f) => {
        const r = resolveFrame(spec, s, f);
        return { id: f.id, file: `frames/${f.id}.png`, preset: r.preset, size: r.size, overrides: r.overrides, harness_hash: hashes[f.id], what: f.what ?? '', sha256: sha256(join(dir, 'frames', `${f.id}.png`)) };
      });
      const [w, h] = (s.frames[0] && resolveFrame(spec, s, s.frames[0]).size) || DEFAULT_SIZE;
      const tile = s.tile ?? `${Math.min(frames.length, 4)}x${Math.ceil(frames.length / 4)}`;
      // Tiles are scaled to fit 640x360 so a sheet of 16 stays viewable; the frames/ copies stay full size.
      const tileGeom = `${Math.min(w, 640)}x${Math.min(h, 360)}+8+8`;
      const margs = ['montage'];
      if (font) margs.push('-font', font);
      margs.push('-pointsize', '18');
      for (const f of s.frames) margs.push('-label', magickText(frameLabel(f)), join(dir, 'frames', `${f.id}.png`));
      margs.push('-tile', tile, '-geometry', tileGeom, '-background', 'white');
      if (s.title) margs.push('-title', magickText(s.title));
      margs.push(join(dir, s.file));
      sh('magick', margs);
      return { file: s.file, commit: sha, ids: frames.map((f) => f.id).join(', '), question: s.question ?? '', common: s.common ?? {}, frames, lead_read: null, jose: null };
    });

    const fresh = {
      folder: relative(REPO, dir).startsWith('..') ? dir : relative(REPO, dir),
      purpose: spec.purpose ?? 'Render sheets for José to review, archived so a future session can tell what each image is. Gitignored (test-gl/out/), never overwritten by the harness.',
      made_by: spec.made_by ?? '',
      how_rendered: {
        tool: 'test-gl/run.js --look "<preset>" --as <id> --size WxH key=value... (re-bakes before the capture, so faithful looks show their real cast)',
        renderer: 'headless Chromium, WebGL2 on SwiftShader (ANGLE/Vulkan), dpr 1, motion frozen',
        source_tree: `git archive ${sha} exported to a temp dir`,
        ...(spec.law ? { law: spec.law } : {}),
        harness_hash: 'FNV-1a of the frame as the harness reports it',
        sheets: `ImageMagick montage, ${font ? basename(font) : 'default font'} labels, tiles scaled to fit 640x360`,
      },
      ids: 'Every frame has an ID printed on its sheet. José refers to frames by these IDs. frames/<id>.png.',
      sheets,
    };
    // read again, not the copy from before the render: it takes minutes, and another run may have added a sheet to this folder meanwhile
    const now = existsSync(mpath) ? JSON.parse(readFileSync(mpath, 'utf8')) : null;
    const late = folderProblems(now, spec, sha);
    if (late.length) throw new Error(`the folder changed during the render; nothing written to its manifest (the frames and sheets are on disk):\n  ${late.join('\n  ')}`);
    writeFileSync(mpath, `${JSON.stringify(mergeManifest(now, fresh), null, 2)}\n`);
    // The spec as it ran, with the resolved sha, so the folder can be re-rendered from itself — every sheet it holds (one folder, one commit).
    const oldSpec = existsSync(spath) ? JSON.parse(readFileSync(spath, 'utf8')) : null;
    writeFileSync(spath, `${JSON.stringify({ ...mergeSpec(oldSpec, spec), commit: sha, date }, null, 2)}\n`);

    for (const s of sheets) console.log(join(dir, s.file));
    console.log(`${sheets.length} sheet(s), ${resolved.length} frame(s) from ${sha.slice(0, 7)} -> ${dir}`);
  } finally {
    if (keep) console.log(`export kept: ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv); } catch (e) { console.error(e.message); process.exit(1); }
}
