// The folder `wrangler dev --assets` serves in arboretum's dev mode (design §1.1): public/ whole, and a komorebi
// checkout under editor/, so the editor and the API share one origin and the session cookie just works.
// It only ever reads the checkout and public/; everything is written under `outDir`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

// What the site's own build leaves out (pages.yml), plus builds and unit tests. In a worktree `.git` is a file.
const SKIPPED_NAMES = new Set(['.git', '.github', 'node_modules', 'test-gl', 'dist']);

// Whether a path inside the checkout (relative to its root) is served.
export const served = (rel) => {
  const parts = rel.split(sep);
  return !parts.some((p) => SKIPPED_NAMES.has(p)) && !parts.at(-1).endsWith('.test.js');
};

function copyTree(from, to, rel = '') {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const childRel = rel ? join(rel, name) : name;
    if (!served(childRel)) continue;
    const source = join(from, name);
    if (statSync(source).isDirectory()) copyTree(source, join(to, name), childRel);
    else copyFileSync(source, join(to, name));
  }
}

// `outDir` is emptied first, so a file removed upstream is gone from the next build.
export function buildEditorAssets({ publicDir, komorebiDir, outDir }) {
  rmSync(outDir, { recursive: true, force: true });
  copyTree(publicDir, outDir);
  copyTree(komorebiDir, join(outDir, 'editor'));
}

// The watcher's step: bring one path of the checkout up to date in `outDir`, whether it changed or vanished.
export function syncKomorebiFile({ komorebiDir, outDir, rel }) {
  if (!served(rel)) return;
  const source = join(komorebiDir, rel);
  const target = join(outDir, 'editor', rel);
  if (existsSync(source) && !statSync(source).isDirectory()) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  } else if (!existsSync(source)) {
    rmSync(target, { recursive: true, force: true });
  }
}
