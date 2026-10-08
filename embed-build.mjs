// ============================================================================
// embed-build.mjs — the deploy bundles. Both come from here, so there is one definition of a build.
//
//   node embed-build.mjs                            -> dist/komorebi.player.min.js   every shipped look
//   node embed-build.mjs 'morning 2' 'park 1' ...    -> dist/komorebi.embed.min.js    only these looks
//   ... --features a,b | all | none                  keep that set of fall tiers instead of the set the looks open (the combination proofs)
//
// (or: nix run .#build / nix run .#embed -- <look>...). Both are IIFE globals: window.Komorebi. The functions are exported and the CLI runs only when this is the
// entry script, so bundle.test.js and features.test.js build into a temp directory and never touch dist/.
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
//     same agreement registry.test.js guards.
//   • THE FALL TIERS — featuresFor() (komorebi-params.js FEATURES) reads the kept looks and returns the tiers they open: the sky fill, the leaf's diffuse share, the autumn
//     pigment, the exposure pass, abscission, the litter carpet. A tier no kept look opens is cut: its FEAT_ constant is substituted by false in every module that guards it
//     (a module that uses a flag it does not declare is an error), the dead `false ? A : B` is removed as text, its uniform group leaves every kept camera, and the GLSL lines
//     tagged with its name are dropped. The engine's BUILD constant is rewritten to say which tiers this bundle cut, so a host that opens one is told (cutWarnings).
//   • THE ORPHAN SWEEP — a shader string nothing references is deleted, whatever cut it loose (see sweepOrphans). A minifier will not do it for a literal with a `${}`.
//   • GLSL PROSE — a template literal is opaque to a minifier, so the shader design notes ship as bytes.
//     Comments outside `${}` are removed here. The source keeps its notes.
//   • THE EDITOR TIER — `--define KOMOREBI_EDITOR=false` does not fold: bun and esbuild both refuse to
//     inline `const EDITOR = <ternary>` into its use sites, so the overlays, the timer-query extension and
//     the inset shaders shipped in every bundle before this (7.6 kB raw, 3.1 kB gzip, measured). This
//     substitutes the constant, and the dead branches then go.
//
// WHAT IT DOES NOT CUT: the faithful canopy tier, the glow tier and the woody occluder. A look can turn
// each of them on, and they are code, not table data. They stay, and stay off at runtime. Nor does it cut the general player's fall tiers: montebello ships, opens all six, and
// the player carries its looks. The tiers are cut from a bundle built for a page whose looks do not open them.
//
// Verify a bundle with `nix run .#embed-check`. It renders each look through the bundle and through the
// raw ES modules, and requires the frames to be byte-identical.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXPERIMENTAL, PRESETS } from './presets.js';
import { cameraFor, CAMERAS, DEFAULTS, FEATURES, GROUP_UPLOAD_KEYS, featuresFor } from './komorebi.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = 'komorebi.global.js';

// ---- GLSL comment strip. Template literals only; `${}` interpolations are JS and are left alone. Comment
// lines go, trailing comments go, indentation goes — every one of those is whitespace to a GLSL compiler,
// and the line structure survives because `#version` and `precision` need it. ----
// The walk over a source's template literals is ONE function, so that the strip and any other literal-wise edit cannot disagree about where a literal ends.
export function templateLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const a = src.indexOf('`', i);
    if (a < 0) break;
    let b = a + 1;
    while (b < src.length && !(src[b] === '`' && src[b - 1] !== '\\')) b++;
    out.push([a + 1, b]);
    i = b + 1;
  }
  return out;
}
function mapLiterals(src, fn) {
  let out = '', at = 0;
  for (const [a, b] of templateLiterals(src)) { out += src.slice(at, a) + fn(src.slice(a, b)); at = b; }
  return out + src.slice(at);
}
// Where a line's comment starts: the first `//` outside a `${}` (those are JS).
function commentAt(line) {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i + 1] === '{') { depth++; i++; continue; }
    if (depth > 0) { if (line[i] === '}') depth--; continue; }
    if (line[i] === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}
// THE TAGS. A GLSL line whose comment ends in `@feature <name>...` is dropped from a bundle that cut ANY feature it names: the lines of a branch only an open feature takes, down to the
// `} else {` that makes the old expression the whole body. The tag is read off the comment BEFORE the comment is stripped (so before the line is judged empty), and a tag that does
// not end its comment, or names nothing the registry knows, is an error here rather than a line that silently stays.
const TAG = /@feature((?:\s+[A-Za-z]+)+)\s*$/;
function tagged(line, cut) {
  const at = commentAt(line);
  if (at < 0) return false;
  const comment = line.slice(at);
  if (!comment.includes('@feature')) return false;
  const m = comment.match(TAG);
  if (!m) throw new Error(`embed: a '@feature' tag must end its comment: ${line.trim()}`);
  const names = m[1].trim().split(/\s+/);
  for (const n of names) if (!FEATURES[n]) throw new Error(`embed: '@feature ${n}' names no feature in FEATURES: ${line.trim()}`);
  return names.some((n) => cut.includes(n));
}
// The tag drop alone, comments left in: what a test compares against the repo's own programs.
export function dropTagged(src, cut) {
  return mapLiterals(src, (lit) => lit.split('\n').filter((line) => !tagged(line, cut)).join('\n'));
}
export function stripGlslComments(src, cut = []) {
  return mapLiterals(src, (lit) => stripLiteral(lit, cut));
}
function stripLiteral(s, cut) {
  const kept = [];
  for (const line of s.split('\n')) {
    if (tagged(line, cut)) continue;
    const at = commentAt(line);
    const code = (at < 0 ? line : line.slice(0, at)).trim();
    if (code) kept.push(code);
  }
  return kept.join('\n');
}

// ---- ENTRY PRUNING on an object literal, by top-level key. These four literals are all written the same
// way — one key per line at a known indent, its value ending where the next key begins — so the entries can
// be sliced apart on that shape alone. A key that was asked for and is missing is an error, not a silent
// drop: the caller's list is the contract. ----
export function pruneObject(src, header, indent, keep) {
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

// ---- THE FEATURE FLAGS. Each module that guards a tier declares it, verbatim, as `const FEAT_X = true;` (the registry names the flag: FEATURES[x].flag); the build drops that line
// and substitutes the uses by a literal, for the same reason EDITOR is (below). A module that USES a flag without declaring it is an error: a guard the substitution
// cannot find would compile to `FEAT_X is not defined` in a bundle that cut it, or worse, to nothing at all. Uses in comments do not count.
function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}
export function substituteFlags(src, file, flags) {
  let out = src;
  for (const [flag, value] of Object.entries(flags)) {
    const decl = `const ${flag} = true;`, uses = new RegExp(`(?<![\\w$'"])${flag}(?![\\w$'"])`, 'g');   // a flag's NAME in quotes (the registry's own table) is not a use
    if (!out.includes(decl)) {
      if (uses.test(withoutComments(out))) throw new Error(`embed: ${file} uses ${flag} but does not declare it as '${decl}'`);
      continue;
    }
    out = out.replace(decl, '').replace(uses, String(value));
  }
  return out;
}
// A flag that is false leaves `false ? A : B` behind, and a minifier folds that, but only AFTER the sweep below has counted A's references: a shader a dead branch names would
// look alive. So the dead consequent is removed here, as text. The scan is a small one (strings, templates, comments, brackets, nested ?:) because the branches it meets are
// ours: a function expression, a factory call.
function endOfConsequent(src, from) {
  let depth = 0, nested = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '\'' || c === '"') { for (i++; src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '`') { i = endOfTemplate(src, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '?' && d !== '.' && d !== '?') nested++;
    else if (depth === 0 && c === ':') { if (nested === 0) return i; nested--; }
  }
  throw new Error('embed: a dead `false ? ... :` never finds its else');
}
function endOfTemplate(src, open) {
  for (let i = open + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '`') return i;
    if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1;
      for (i += 2; depth; i++) {
        if (src[i] === '`') i = endOfTemplate(src, i);
        else if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
      }
      i--;
    }
  }
  throw new Error('embed: unterminated template literal');
}
export function foldDeadTernaries(src) {
  const re = /(?<![\w$.])false \? /g;
  let out = '', at = 0, from = 0;
  for (;;) {
    re.lastIndex = from;
    const m = re.exec(src);
    if (!m) break;
    from = m.index + m[0].length;
    if (src.slice(src.lastIndexOf('\n', m.index) + 1, m.index).includes('//')) continue;   // a comment that quotes one is not one
    out += src.slice(at, m.index);
    at = endOfConsequent(src, from) + 1;
    from = at;
  }
  return out + src.slice(at);
}

// ---- the build flag the bundlers won't fold (see the header): drop the declaration, substitute the uses.
// A module that does not carry the flag is returned as it came.
function hardcodeEditorOff(src) {
  const decl = 'const EDITOR = (typeof KOMOREBI_EDITOR !== "undefined") ? KOMOREBI_EDITOR : true;';
  if (!src.includes(decl)) return src;
  return src.replace(decl, '').replace(/(?<![\w$])EDITOR(?![\w$])/g, 'false');
}

// ---- THE ORPHAN SWEEP. A shader string that nothing references still ships, when its literal carries a `${}` the minifier will not prove
// free of side effects (GLSL_T_SKY_DECLS interpolates an imported cap, so a floor-only bundle kept the sky view's whole shader). So: a top-level
// `const GLSL_|VS_|FS_ = \`...\`` whose name is referenced nowhere in the assembled tree except its own declaration and the import/export
// lists is deleted, and so are its entries in those lists, until nothing more falls (deleting one string can orphan the snippets it carried).
// It reads the tree as it stands after every other cut, and it knows nothing of the tables: whatever those left unreferenced goes.
const DECL = /^const ((?:GLSL_|VS_|FS_)\w+) = `/gm;
const LISTS = /\b(import|export)(\s*)\{([^}]*)\}/g;
function codeOnly(src) {
  return withoutComments(src.replace(LISTS, ''));
}
function declSpan(src, m) {
  const a = m.index, open = a + m[0].length;
  let b = open;
  while (b < src.length && !(src[b] === '`' && src[b - 1] !== '\\')) b++;
  let end = b + 1;
  if (src[end] === ';') end++;
  if (src[end] === '\n') end++;
  return [a, end];
}
export function sweepOrphans(files) {
  const swept = [];
  for (;;) {
    const bodies = [...files.values()].map(codeOnly).join('\n');
    const dead = new Set();
    for (const src of files.values()) {
      for (const m of src.matchAll(DECL)) {
        const refs = (bodies.match(new RegExp(`(?<![\\w$])${m[1]}(?![\\w$])`, 'g')) || []).length;
        if (refs <= 1) dead.add(m[1]);   // the one is its own declaration
      }
    }
    if (!dead.size) return swept;
    for (const [f, src0] of files) {
      let src = src0;
      for (const m of [...src.matchAll(DECL)].reverse()) {
        if (!dead.has(m[1])) continue;
        const [a, b] = declSpan(src, m);
        src = src.slice(0, a) + src.slice(b);
      }
      src = src.replace(LISTS, (whole, kw, ws, inner) => {
        const names = inner.split(',').map((n) => n.trim()).filter(Boolean);
        const kept = names.filter((n) => !dead.has(n.split(/\s+as\s+/)[0]));
        return kept.length === names.length ? whole : `${kw}${ws}{ ${kept.join(', ')} }`;
      });
      files.set(f, src);
    }
    swept.push(...dead);
  }
}

// ---- which modules a bundle reaches: the entry and everything it imports, transitively. The sweep reads only these, so a script nothing bundles
// (the editor's, the macro bus) cannot keep a string alive, and the tree a test imports from is the tree the bundle is made of. ----
const IMPORT = /\bfrom\s*(['"])(\.\/[^'"]+)\1/g;
function reachable(all, entry) {
  const seen = new Map();
  const walk = (f) => {
    if (seen.has(f)) return;
    if (!all.has(f)) throw new Error(`embed: ${entry} reaches ${f}, which is not in the tree`);
    seen.set(f, all.get(f));
    for (const m of all.get(f).matchAll(IMPORT)) walk(m[2].slice(2));
  };
  walk(entry);
  return seen;
}

// ---- WHAT A BUILD KEEPS. The tiers a bundle carries are derived from its looks the way its cameras are: the union of featuresFor over the kept looks (each merged over DEFAULTS,
// as the engine merges it). `features` overrides it, which is how the combination proofs build a bundle that keeps a set no look asks for: 'all', 'none', or a list.
export function keptFeatures(looks, features) {
  const all = Object.keys(FEATURES);
  if (features === 'all') return all;
  if (features === 'none') return [];
  if (Array.isArray(features)) {
    for (const f of features) if (!FEATURES[f]) throw new Error(`unknown feature '${f}' — the features are ${all.join(', ')}`);
    return all.filter((f) => features.includes(f));
  }
  const open = new Set(looks.flatMap((n) => featuresFor({ ...DEFAULTS, ...PRESETS[n] })));
  return all.filter((f) => open.has(f));
}

// ---- assemble a source tree: the repo's modules, with the transformed ones written over them. Pure (nothing is written): the bundle, the
// tests and the pixel proofs all start from this one function, so there is one definition of what a build's source IS. ----
export function assemble({ looks, features, strip = true, name } = {}) {
  const shipped = Object.keys(PRESETS).filter((n) => !EXPERIMENTAL.includes(n));
  const kept = looks ?? shipped;
  for (const n of kept) if (!PRESETS[n]) throw new Error(`unknown look '${n}' — see presets.js`);
  const file = name ?? (looks ? 'komorebi.embed.min.js' : 'komorebi.player.min.js');
  const keep = keptFeatures(kept, features), cut = Object.keys(FEATURES).filter((f) => !keep.includes(f));

  // WHAT THE LOOKS NEED. The camera set is derived, never declared: cameraFor is the same selector the engine runs per draw, so a look that
  // reaches a camera keeps it by construction. A cut tier takes its uniform group out of every camera that spoke it, or buildTransport would index a group the table no longer has.
  const cutGroups = cut.map((f) => FEATURES[f].group).filter(Boolean);
  const cameras = [...new Set(kept.map((n) => cameraFor(PRESETS[n])))];
  const groups = [...new Set(cameras.flatMap((c) => CAMERAS[c].groups))].filter((g) => !cutGroups.includes(g));
  const uploads = GROUP_UPLOAD_KEYS.filter((g) => groups.includes(g));

  const all = new Map();
  for (const f of readdirSync(ROOT)) if (f.endsWith('.js') && !f.endsWith('.test.js')) all.set(f, readFileSync(join(ROOT, f), 'utf8'));
  const files = reachable(all, ENTRY);

  const p = pruneObject(files.get('presets.js'), 'export const PRESETS = {\n', 2, kept);
  files.set('presets.js', p.src);

  const c = pruneObject(files.get('komorebi-transport.js'), 'const CAMERAS = {\n', 2, cameras);
  const g = pruneObject(c.src, 'const TRANSPORT_GROUPS = {\n', 2, groups);
  const speaks = (list) => list.split(',').map((x) => x.trim()).filter((x) => !cutGroups.includes(x.replace(/'/g, ''))).join(',');
  const transport = g.src
    .replace(/(groups: \[)([^\]]*)(\])/g, (_, a, list, z) => `${a}${speaks(list)}${z}`)
    .replace(/const GROUP_UPLOAD_KEYS = \[[^\]]*\]/, `const GROUP_UPLOAD_KEYS = [${uploads.map((k) => `'${k}'`).join(',')}]`);
  files.set('komorebi-transport.js', transport);

  const u = pruneObject(files.get('komorebi-render.js'), '  const GROUP_UPLOAD = {\n', 4, uploads);
  files.set('komorebi-render.js', u.src);

  // THE BUILD'S OWN NAME, for the warning (komorebi-engine.js): the file, the looks it was made for and what it left out. Verbatim or it throws, like the flags.
  const buildDecl = "const BUILD = { name: 'modules', cut: [] };";
  const label = `${file} (${looks ? kept.join(', ') : 'every shipped look'})`;
  const flags = Object.fromEntries(Object.keys(FEATURES).map((f) => [FEATURES[f].flag, keep.includes(f)]));
  for (const [f, src] of files) {
    let s = substituteFlags(src, f, flags);
    if (f === 'komorebi-engine.js') {
      if (!s.includes(buildDecl)) throw new Error(`embed: ${f} does not declare BUILD as '${buildDecl}'`);
      s = s.replace(buildDecl, `const BUILD = ${JSON.stringify({ name: label, cut })};`);
    }
    s = hardcodeEditorOff(foldDeadTernaries(s));
    if (f === 'komorebi-transport.js' || f === 'komorebi-shaders.js') s = strip ? stripGlslComments(s, cut) : dropTagged(s, cut);
    files.set(f, s);
  }
  const swept = sweepOrphans(files);
  return { files: Object.fromEntries(files), looks: kept, features: keep, cut, cameras, groups, uploads, dropped: { presets: p.dropped, cameras: c.dropped, groups: g.dropped }, swept };
}

export function writeTree(files, dir) {
  mkdirSync(dir, { recursive: true });
  for (const [f, src] of Object.entries(files)) writeFileSync(join(dir, f), src);
}

// ---- bundle (the player build's own line, minus the define that never worked) ----
export function build({ looks, features, out, name, quiet = false } = {}) {
  const asm = assemble({ looks, features, name });
  const work = mkdtempSync(join(tmpdir(), 'komorebi-embed-'));
  try {
    writeTree(asm.files, work);
    execFileSync('bun', ['build', join(work, ENTRY), '--minify', '--format=iife', `--outfile=${out}`], { stdio: quiet ? 'ignore' : 'inherit' });
  } finally { rmSync(work, { recursive: true, force: true }); }
  const bytes = readFileSync(out);
  const gzip = execFileSync('gzip', ['-9c'], { input: bytes }).length;
  return { ...asm, out, raw: bytes.length, gzip };
}

// ---- the CLI: only when this file is the entry script, so a test can import the functions without building anything. ----
function main() {
  // No looks: every shipped look, into the general bundle. Named looks: those looks, into the one-page one. `--features a,b | all | none` keeps that set
  // of fall tiers instead of the set the looks open (the combination proofs build bundles no look asks for).
  const args = process.argv.slice(2);
  let features;
  const at = args.indexOf('--features');
  if (at >= 0) {
    const v = args.splice(at, 2)[1] ?? '';
    features = v === 'all' || v === 'none' ? v : v.split(',').map((x) => x.trim()).filter(Boolean);
  }
  const outFile = args.length ? 'komorebi.embed.min.js' : 'komorebi.player.min.js';
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  let r;
  try { r = build({ looks: args.length ? args : undefined, features, out: join(ROOT, 'dist', outFile) }); }
  catch (e) { console.error(e.message); process.exit(2); }
  console.log(`\nlooks     ${r.looks.join(', ')}`);
  console.log(`cameras   ${r.cameras.join(', ')}   (dropped: ${r.dropped.cameras.join(', ') || 'none'})`);
  console.log(`groups    ${r.groups.join(', ')}   (dropped: ${r.dropped.groups.join(', ') || 'none'})`);
  console.log(`features  kept ${r.features.join(', ') || 'none'}   cut ${r.cut.join(', ') || 'none'}`);
  console.log(`presets   kept ${r.looks.length}, dropped ${r.dropped.presets.length}`);
  console.log(`swept     ${r.swept.length} unreferenced shader strings`);
  console.log(`\ndist/${outFile}   ${r.raw} raw   ${r.gzip} gzip`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
