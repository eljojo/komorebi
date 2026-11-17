// The site's layout, as pure file operations so a test can hold it (scripts/site.mjs builds the bundles and calls it):
// komorebi's static site at the root (only what its pages use), and arboretum's public/ under `base`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The site ships what the pages use, found by walking from them. (pages.yml shipped the repo minus an exclusion list, so
// the docs, the unit tests, the build tools and the dev server went out too.)
//   entries: index.html, about.html, player.html, examples/*.html and the built dist/*.min.js bundles.
//   from HTML: <script src>, <link href>, and the imports of inline scripts; <style> blocks are CSS.
//   from JS: static `import … from`, `import '…'`, `export … from`, and `import('…')` with a string literal.
//   from CSS: url(…) and @import.
//   from a web manifest (.webmanifest): the src of each of its icons.
// A same-site path counts, relative to the file that names it or root-absolute. A URL with a scheme or a host, a bare
// module name, a directory, anything under /<base>/ or /api/ (served by the Worker) and commit.json (written by the
// build) is not looked for. A file that is named and not there fails the build, naming both.
const ENTRY_PAGES = ['index.html', 'about.html', 'player.html'];
const GENERATED = ['commit.json'];
const kindOf = (rel) => (/\.html?$/i.test(rel) ? 'html' : /\.(?:m?js|cjs)$/i.test(rel) ? 'js' : /\.css$/i.test(rel) ? 'css' : /\.webmanifest$/i.test(rel) ? 'manifest' : null);

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

function jsRefs(text) {
  const code = text.replace(/^[ \t]*\/\/.*$/gm, ''); // whole-line comments only: stripping more could eat real code
  const out = [];
  for (const re of [
    /(?:[}\w$*])\s*\bfrom\s*(['"])([^'"\n]+)\1/g, // import … from '…', export … from '…'
    /\bimport\s*(['"])([^'"\n]+)\1/g, //              import '…'
    /\bimport\s*\(\s*(['"`])([^'"`$\n]+)\1/g, //        import('…')
  ]) for (const m of code.matchAll(re)) out.push(m[2]);
  return out.filter((url) => /^(?:\.{1,2}\/|\/)/.test(url) || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(url)); // a bare module name is no file
}

function cssRefs(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of code.matchAll(/@import\s*(['"])([^'"\n]+)\1/g)) out.push(m[2]);
  for (const m of code.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/gi)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// A manifest that is not JSON fails the build here, rather than ship an app with no icons.
function manifestRefs(text) {
  const icons = JSON.parse(text).icons ?? [];
  return icons.map((icon) => icon.src).filter((src) => typeof src === 'string');
}

function htmlRefs(text) {
  const out = [];
  const html = text.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>|<link\b([^>]*)>/gi)) {
    if (m[4] !== undefined) {
      const href = attr(m[4], 'href');
      if (href !== null) out.push(href);
    } else if (m[1].toLowerCase() === 'style') out.push(...cssRefs(m[3]));
    else {
      const src = attr(m[2], 'src');
      const type = (attr(m[2], 'type') ?? 'module').toLowerCase();
      if (src !== null) out.push(src);
      else if (type === 'module' || /javascript|ecmascript/.test(type)) out.push(...jsRefs(m[3]));
    }
  }
  return out;
}

// What the file at `rel` names, as written; [] for a kind of file that names nothing.
export function referencesIn(rel, text) {
  const kind = kindOf(rel);
  return kind === 'html' ? htmlRefs(text) : kind === 'js' ? jsRefs(text) : kind === 'css' ? cssRefs(text) : kind === 'manifest' ? manifestRefs(text) : [];
}

// The site-root-relative path `url` (written in the file at `from`) names, or null where nothing here is to be shipped for it.
export function resolveRef(from, url, { base = 'arboretum' } = {}) {
  const bare = url.trim().replace(/[?#].*$/s, '');
  if (!bare || /^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith('//')) return null;
  const parts = (bare.startsWith('/') ? [] : from.split('/').slice(0, -1)).concat(bare.split('/'));
  const path = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!path.length) throw new Error(`${url} (in ${from}) points outside the site`);
      path.pop();
    } else path.push(part);
  }
  if (!path.length || bare.endsWith('/') || bare.endsWith('/.') || bare.endsWith('/..')) return null;
  if (path[0] === base || path[0] === 'api') return null;
  let rel = path.join('/');
  try { rel = decodeURIComponent(rel); } catch {}
  return GENERATED.includes(rel) ? null : rel;
}

// The files of komorebi to ship: `paths` is every path in it ('/'-separated), `read(path)` the text of one. Sorted.
export function shipped({ paths, read }, { base = 'arboretum' } = {}) {
  const has = new Set(paths);
  const problems = [];
  for (const page of ENTRY_PAGES) if (!has.has(page)) problems.push(`${page}: a page the site starts from, and komorebi has none`);
  const queue = paths.filter((p) => ENTRY_PAGES.includes(p) || /^examples\/[^/]+\.html$/.test(p) || /^dist\/[^/]+\.min\.js$/.test(p));
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const url of referencesIn(from, read(from))) {
      const rel = resolveRef(from, url, { base });
      if (rel === null || seen.has(rel)) continue;
      if (!has.has(rel)) problems.push(`${rel}: referenced by ${from}, but komorebi has no such file`);
      else { seen.add(rel); queue.push(rel); }
    }
  }
  if (problems.length) throw new Error(`the site cannot be built from this komorebi:\n${[...new Set(problems)].join('\n')}`);
  return [...seen].sort();
}

// Every file under `dir` as a '/'-separated path relative to it, skipping what `skip` names.
export function files(dir, skip, rel = '') {
  return readdirSync(dir).flatMap((name) => {
    if (skip(name)) return [];
    const path = join(dir, name);
    const childRel = rel ? `${rel}/${name}` : name;
    return statSync(path).isDirectory() ? files(path, skip, childRel) : [{ rel: childRel, path }];
  });
}

// `outputs` are { to, from } (a file to copy) or { to, text }, with `to` '/'-separated and relative to `outDir`.
// Nothing is written until every output path is known to be in one place only, as a file and not also a folder.
export function writeLayout(outputs, outDir) {
  const problems = [];
  const seen = new Set();
  for (const { to } of outputs) {
    if (seen.has(to)) problems.push(`${to}: written twice`);
    seen.add(to);
  }
  for (const to of seen) {
    const parts = to.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (seen.has(parent)) problems.push(`${parent}: is a file and also holds ${to}`);
    }
  }
  if (problems.length) throw new Error(`the site would write an output path twice:\n${problems.join('\n')}`);

  for (const { to, from, text } of outputs) {
    const target = join(outDir, ...to.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    if (from) copyFileSync(from, target);
    else writeFileSync(target, text);
  }
}

// `komorebiDir` is komorebi at the pinned commit with both bundles already built into dist/. `outDir` must not exist.
// Nothing is written until the whole layout is known to put every output path in one place only.
export function assembleSite({ komorebiDir, publicDir, outDir, commit, base = 'arboretum' }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`the commit must be a full 40-character hash, not ${JSON.stringify(commit)}`);
  if (existsSync(outDir)) throw new Error(`${outDir} already exists; the site is built into a folder of its own`);

  const all = files(komorebiDir, (name) => name === '.git');
  const outputs = [
    ...shipped({ paths: all.map((f) => f.rel), read: (rel) => readFileSync(join(komorebiDir, ...rel.split('/')), 'utf8') }, { base }).map((rel) => ({ to: rel, from: join(komorebiDir, ...rel.split('/')) })),
    // The editor tells arboretum which komorebi commit a look was made on (arboretum-api.js reads this file).
    { to: 'commit.json', text: `{"commit":"${commit}"}\n` },
    ...files(publicDir, () => false).map(({ rel, path }) => ({ to: `${base}/${rel}`, from: path })),
  ];

  writeLayout(outputs, outDir);
}
