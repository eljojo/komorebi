// ============================================================================
// embed-build.mjs — the SPECIALIZED deploy bundle: one page, a named set of looks, and nothing else.
//
//   node embed-build.mjs 'morning 2' 'afternoon 5b' 'morning 3'      (or: nix run .#embed -- <look>...)
//   -> dist/komorebi.embed.min.js   IIFE global (window.Komorebi), same door as the player bundle
//
// WHY THIS EXISTS. `nix run .#build` ships the whole engine: 23 looks, four cameras, both canopy tiers.
// An ambient background on one page uses a handful of looks on ONE camera, and pays for the rest in bytes
// it will never execute. This build asks the looks what they need and drops the rest.
//
// WHAT IT CUTS, and why each cut is answerable from data rather than from judgement:
//   • LOOKS — presets.js keeps only the named ones. Everything else in that file is data nobody reads.
//   • CAMERAS — cameraFor() (the transport registry's own selector) reads the kept looks and returns the
//     cameras they actually select; CAMERAS, TRANSPORT_GROUPS, GROUP_UPLOAD_KEYS and render.js's
//     GROUP_UPLOAD are pruned to that set, in the same three-halves agreement registry.test.js guards —
//     so an unreachable camera takes its GLSL, its uniform groups and its per-frame upload with it. The
//     bundler then drops the orphaned GLSL_T_* strings on its own: they are pure literals nobody names.
//   • GLSL PROSE — the shader sources carry the engine's design notes, and a template literal is opaque
//     to a minifier, so every one of those bytes ships. They are stripped here (comments only, outside
//     `${}`), which is most of the raw-size win and none of the meaning: the source keeps its notes.
//   • THE EDITOR TIER — `--define KOMOREBI_EDITOR=false` does NOT actually fold: bun and esbuild both
//     refuse to inline this file's `const EDITOR = <ternary>` into its use sites, so the overlays, the
//     timer-query extension and the inset shaders ship in the player bundle today (measured: 7.6 kB raw,
//     3.1 kB gzip). Substituting the constant textually is what makes the dead branches actually die.
//
// WHAT IT DOES NOT CUT, deliberately: the faithful canopy tier, the glow tier and the woody occluder are
// unreachable for a look that leaves their gates at zero, but they are interleaved CODE, not table data —
// removing them means editing the engine, not reading it. They stay, and stay gated off at runtime.
//
// The output is verified, not assumed: test-gl/embed.mjs renders every kept look through this bundle and
// through the raw ES modules and requires the frames to be byte-identical.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from './presets.js';
import { cameraFor, CAMERAS, GROUP_UPLOAD_KEYS } from './komorebi.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const looks = process.argv.slice(2);
if (!looks.length) { console.error("usage: node embed-build.mjs 'morning 2' 'afternoon 5b' ..."); process.exit(2); }
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
  let cur = null;
  const flush = () => {
    if (!cur) return;
    seen.push(cur.name);
    if (keep.includes(cur.name)) out.push(...cur.lines); else dropped.push(cur.name);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (close.test(line)) {
      flush();
      out.push(...lines.slice(i));
      const missing = keep.filter((k) => !seen.includes(k));
      if (missing.length) throw new Error(`embed: "${header.trim()}" has no entry ${missing.join(', ')}`);
      return { src: src.slice(0, body) + out.join('\n'), dropped };
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
const out = join(ROOT, 'dist', 'komorebi.embed.min.js');
execFileSync('bun', ['build', join(work, 'komorebi.global.js'), '--minify', '--format=iife', `--outfile=${out}`], { stdio: 'inherit' });
rmSync(work, { recursive: true, force: true });

const bytes = readFileSync(out);
const gz = execFileSync('gzip', ['-9c'], { input: bytes }).length;
console.log(`\nlooks     ${looks.join(', ')}`);
console.log(`cameras   ${cameras.join(', ')}   (dropped: ${c.dropped.join(', ') || 'none'})`);
console.log(`groups    ${groups.join(', ')}   (dropped: ${g.dropped.join(', ') || 'none'})`);
console.log(`presets   kept ${looks.length}, dropped ${p.dropped.length}`);
console.log(`\ndist/komorebi.embed.min.js   ${bytes.length} raw   ${gz} gzip`);
