// The site's layout, as pure file operations so a test can hold it (scripts/site.mjs builds the bundles and calls it):
// komorebi's static site at the root, exactly what GitHub Pages published, and arboretum's public/ under `base`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// What .github/workflows/pages.yml leaves out of the site (its rsync --exclude list), by name at any depth.
const skipped = (name) => name === '.git' || name === '.github' || name === 'test-gl' || name.startsWith('flake.');

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

  const outputs = [
    ...files(komorebiDir, skipped).map(({ rel, path }) => ({ to: rel, from: path })),
    // The editor tells arboretum which komorebi commit a look was made on (arboretum-api.js reads this file).
    { to: 'commit.json', text: `{"commit":"${commit}"}\n` },
    ...files(publicDir, () => false).map(({ rel, path }) => ({ to: `${base}/${rel}`, from: path })),
  ];

  writeLayout(outputs, outDir);
}
