// The folder `wrangler dev --assets` serves in arboretum's dev mode (design §1.1): the deployed site's layout, so the
// editor and the API share one origin and the session cookie just works. A komorebi checkout sits at the root and
// public/ under arboretum/, as scripts/site-assemble.mjs lays them out; a checkout path under arboretum/ is refused.
// It only ever reads the checkout and public/; everything is written under `outDir`.
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { files, writeLayout } from './site-assemble.mjs';

// What the site's own build leaves out (pages.yml), plus builds and unit tests. In a worktree `.git` is a file.
const SKIPPED_NAMES = new Set(['.git', '.github', 'node_modules', 'test-gl', 'dist']);

// By name at any depth, folders included.
const skipped = (name) => SKIPPED_NAMES.has(name) || name.endsWith('.test.js');

// Whether a path inside the checkout (relative to its root) is served.
export const served = (rel) => !rel.split(sep).some(skipped);

// `outDir` is emptied first, so a file removed upstream is gone from the next build.
export function buildEditorAssets({ publicDir, komorebiDir, outDir }) {
  rmSync(outDir, { recursive: true, force: true });
  writeLayout(
    [
      ...files(komorebiDir, skipped).map(({ rel, path }) => ({ to: rel, from: path })),
      ...files(publicDir, () => false).map(({ rel, path }) => ({ to: `arboretum/${rel}`, from: path })),
    ],
    outDir,
  );
}

// The watcher's step: bring one path of the checkout up to date in `outDir`, whether it changed or vanished.
export function syncKomorebiFile({ komorebiDir, outDir, rel }) {
  if (!served(rel)) return;
  const source = join(komorebiDir, rel);
  const target = join(outDir, rel);
  if (existsSync(source) && !statSync(source).isDirectory()) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  } else if (!existsSync(source)) {
    rmSync(target, { recursive: true, force: true });
  }
}
