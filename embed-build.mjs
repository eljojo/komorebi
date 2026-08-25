// ============================================================================
// embed-build.mjs — the deploy bundles. Both come from here, so there is one definition of a build.
//
//   node embed-build.mjs                            -> dist/komorebi.player.min.js   every shipped look
//   node embed-build.mjs 'morning 2' 'park 1' ...    -> dist/komorebi.embed.min.js    only these looks
//
// (or: nix run .#build / nix run .#embed -- <look>...). Both are IIFE globals: window.Komorebi.
//
// The bundle contains only what its looks can reach. A look that no bundle carries cannot run, so its
// camera, its GLSL and its uniform uploads are dead weight.
//
// WHAT IT CUTS. Each cut comes from a table, not from a decision:
//   • LOOKS — presets.js keeps the named looks. The default set is PRESETS minus EXPERIMENTAL, which is
//     the line the editor already draws: the experimental looks are the receiver, enclosure and sky-view
//     work, and they are the only looks that select a camera other than the floor.
//   • CAMERAS — cameraFor() reads the kept looks and returns the cameras they select. CAMERAS,
//     TRANSPORT_GROUPS, GROUP_UPLOAD_KEYS and render.js's GROUP_UPLOAD are pruned to that set, in the
//     same agreement registry.test.js guards. The bundler then drops the orphaned GLSL_T_* strings.
//   • GLSL PROSE — a template literal is opaque to a minifier, so the shader design notes ship as bytes.
//     Comments outside `${}` are removed here. The source keeps its notes.
//   • THE EDITOR TIER — `--define KOMOREBI_EDITOR=false` does not fold: bun and esbuild both refuse to
//     inline `const EDITOR = <ternary>` into its use sites, so the overlays, the timer-query extension and
//     the inset shaders shipped in every bundle before this (7.6 kB raw, 3.1 kB gzip, measured). This
//     substitutes the constant, and the dead branches then go.
//
// WHAT IT DOES NOT CUT: the faithful canopy tier, the glow tier and the woody occluder. A look can turn
// each of them on, and they are code, not table data. They stay, and stay off at runtime.
//
// Verify a bundle with `nix run .#embed-check`. It renders each look through the bundle and through the
// raw ES modules and requires the frames to be byte-identical.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPERIMENTAL, PRESETS } from './presets.js';
import { cameraFor, CAMERAS, GROUP_UPLOAD_KEYS } from './komorebi.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
// No arguments: every shipped look, into the general bundle. Named looks: those looks, into the one-page one.
const named = process.argv.slice(2);
const looks = named.length ? named : Object.keys(PRESETS).filter((n) => !EXPERIMENTAL.includes(n));
const outFile = named.length ? 'komorebi.embed.min.js' : 'komorebi.player.min.js';
for (const n of looks) if (!PRESETS[n]) { console.error(`unknown look '${n}' — see presets.js`); process.exit(2); }

// ---- WHAT THE LOOKS NEED. The camera set is derived, never declared: cameraFor is the same selector the
// engine runs per draw, so a look that reaches a camera keeps it by construction. ----
const cameras = [...new Set(looks.map((n) => cameraFor(PRESETS[n])))];
const groups = [...new Set(cameras.flatMap((c) => CAMERAS[c].groups))];
const uploads = GROUP_UPLOAD_KEYS.filter((g) => groups.includes(g));

// ---- GLSL comment strip. Template literals only; `${}` interpolations are JS and are left alone. Comment
// lines go, trailing comments go, indentation goes — every one of those is whitespace to a GLSL compiler,
// and the line structure survives because `#version` and `precision` need it. ----
function stripGlslComments(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const a = src.indexOf('`', i);
    if (a < 0) { out += src.slice(i); break; }
    let b = a + 1;
    while (b < src.length && !(src[b] === '`' && src[b - 1] !== '\\')) b++;
    out += `${src.slice(i, a + 1)}${stripLiteral(src.slice(a + 1, b))}\``;
    i = b + 1;
  }
  return out;
}
function stripLiteral(s) {
  const kept = [];
  for (const line of s.split('\n')) {
    let depth = 0, cut = -1;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '$' && line[i + 1] === '{') { depth++; i++; continue; }
      if (depth > 0) { if (line[i] === '}') depth--; continue; }
      if (line[i] === '/' && line[i + 1] === '/') { cut = i; break; }
    }
    const code = (cut < 0 ? line : line.slice(0, cut)).trim();
    if (code) kept.push(code);
  }
  return kept.join('\n');
}

// ---- ENTRY PRUNING on an object literal, by top-level key. These four literals are all written the same
// way — one key per line at a known indent, its value ending where the next key begins — so the entries can
// be sliced apart on that shape alone. A key that was asked for and is missing is an error, not a silent
// drop: the caller's list is the contract. ----
function pruneObject(src, header, indent, keep) {
  const at = src.indexOf(header);
  if (at < 0) throw new Error(`embed: cannot find "${header.trim()}"`);
  const body = at + header.length;
  const lines = src.slice(body).split('\n');
  const key = new RegExp(`^ {${indent}}('[^']+'|[\\w]+):`);
  const close = new RegExp(`^ {0,${indent - 2}}\\}`);
  const out = [], dropped = [], seen = [];
  let cur = null, inBlock = false;   // presets.js keeps retired looks inside a /* ... */ block: a key in there is not an entry
  const flush = () => {
    if (!cur) return;
    seen.push(cur.name);
    if (keep.includes(cur.name)) out.push(...cur.lines); else dropped.push(cur.name);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const commented = inBlock;
    const opens = line.indexOf('/*'), closes = line.indexOf('*/');
    if (inBlock) { if (closes >= 0) inBlock = false; }
    else if (opens >= 0 && (closes < 0 || closes < opens)) inBlock = true;
    if (commented) { if (cur) cur.lines.push(line); else out.push(line); continue; }
    if (close.test(line)) {
      flush();
      out.push(...lines.slice(i));
      const missing = keep.filter((k) => !seen.includes(k));
      if (missing.length) throw new Error(`embed: "${header.trim()}" has no entry ${missing.join(', ')}`);
      const kept = src.slice(0, body) + out.join('\n');
      const count = (re) => (kept.match(re) || []).length;
      if (count(/\/\*/g) !== count(/\*\//g)) throw new Error(`embed: pruning "${header.trim()}" split a /* */ comment`);
      return { src: kept, dropped };
    }
    const m = line.match(key);
    if (m) { flush(); cur = { name: m[1].replace(/'/g, ''), lines: [line] }; }
    else if (cur) cur.lines.push(line);
    else out.push(line);
  }
  throw new Error(`embed: "${header.trim()}" never closes`);
}

// ---- the build flag the bundlers won't fold (see the header): drop the declaration, substitute the uses.
function hardcodeEditorOff(src) {
  const decl = 'const EDITOR = (typeof KOMOREBI_EDITOR !== "undefined") ? KOMOREBI_EDITOR : true;';
  if (!src.includes(decl)) return src;                       // a module that doesn't carry the flag
  return src.replace(decl, '').replace(/(?<![\w$])EDITOR(?![\w$])/g, 'false');
}

// ---- assemble a source tree: the repo's modules, with the four transformed ones written over them ----
const work = mkdtempSync(join(tmpdir(), 'komorebi-embed-'));
for (const f of readdirSync(ROOT)) if (f.endsWith('.js') && !f.endsWith('.test.js')) copyFileSync(join(ROOT, f), join(work, f));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const write = (f, s) => writeFileSync(join(work, f), s);

const p = pruneObject(read('presets.js'), 'export const PRESETS = {\n', 2, looks);
write('presets.js', p.src);

let transport = read('komorebi-transport.js');
const c = pruneObject(transport, 'const CAMERAS = {\n', 2, cameras);
const g = pruneObject(c.src, 'const TRANSPORT_GROUPS = {\n', 2, groups);
transport = g.src.replace(/const GROUP_UPLOAD_KEYS = \[[^\]]*\]/, `const GROUP_UPLOAD_KEYS = [${uploads.map((k) => `'${k}'`).join(',')}]`);
write('komorebi-transport.js', stripGlslComments(transport));

const u = pruneObject(read('komorebi-render.js'), '  const GROUP_UPLOAD = {\n', 4, uploads);
write('komorebi-render.js', hardcodeEditorOff(u.src));
write('komorebi-shaders.js', stripGlslComments(read('komorebi-shaders.js')));
for (const f of ['komorebi-engine.js', 'komorebi-source.js']) write(f, hardcodeEditorOff(read(f)));

// ---- bundle (the player build's own line, minus the define that never worked) ----
mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'dist', outFile);
execFileSync('bun', ['build', join(work, 'komorebi.global.js'), '--minify', '--format=iife', `--outfile=${out}`], { stdio: 'inherit' });
rmSync(work, { recursive: true, force: true });

const bytes = readFileSync(out);
const gz = execFileSync('gzip', ['-9c'], { input: bytes }).length;
console.log(`\nlooks     ${looks.join(', ')}`);
console.log(`cameras   ${cameras.join(', ')}   (dropped: ${c.dropped.join(', ') || 'none'})`);
console.log(`groups    ${groups.join(', ')}   (dropped: ${g.dropped.join(', ') || 'none'})`);
console.log(`presets   kept ${looks.length}, dropped ${p.dropped.length}`);
console.log(`\ndist/${outFile}   ${bytes.length} raw   ${gz} gzip`);
