// Builds the site Cloudflare serves, into .site/ (gitignored, never committed): `node scripts/site.mjs`.
//   komorebi's static site at the root, as GitHub Pages publishes it   (.github/workflows/pages.yml)
//   arboretum's public/ under arboretum/
// The komorebi is this repository at HEAD, read through `git archive` into a temporary folder, the commit
// public/engine/engine.json was generated from (scripts/engine.mjs). A tree with uncommitted changes is refused: what
// is deployed is a commit, and the validator and the site must both be that commit. The two bundles are built there
// exactly as pages.yml builds them, then scripts/site-assemble.mjs lays the site out and refuses to write any path
// twice. `.site` is replaced only once the whole site exists, so a failed build leaves the last good one (or none,
// which `wrangler deploy` refuses).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleSite } from './site-assemble.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KOMOREBI = join(ROOT, '..');
const SITE = join(ROOT, '.site');
const BUILDING = join(ROOT, '.site.tmp');

// The eljojo.net homepage's three looks, as pages.yml's "Build the homepage bundle" step names them.
const HOMEPAGE_LOOKS = ['morning 2', 'afternoon 5b', 'morning 3'];

const git = (...args) => execFileSync('git', ['-C', KOMOREBI, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('the repository has uncommitted changes: commit them first, the site is built from HEAD');
const commit = git('rev-parse', 'HEAD');
const { commit: generated } = JSON.parse(readFileSync(join(ROOT, 'public', 'engine', 'engine.json'), 'utf8'));
if (generated !== commit) throw new Error(`public/engine/ was generated at ${generated}, not HEAD ${commit}: run node scripts/engine.mjs`);

const tmp = mkdtempSync(join(tmpdir(), 'arboretum-site-'));
try {
  const archive = execFileSync('git', ['-C', KOMOREBI, 'archive', commit], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', tmp], { input: archive });

  // embed-build.mjs needs bun (the devShell's). No arguments: dist/komorebi.player.min.js. With looks: dist/komorebi.embed.min.js.
  const embedBuild = (...looks) => execFileSync('node', ['embed-build.mjs', ...looks], { cwd: tmp, stdio: 'inherit' });
  embedBuild();
  embedBuild(...HOMEPAGE_LOOKS);

  rmSync(BUILDING, { recursive: true, force: true });
  assembleSite({ komorebiDir: tmp, publicDir: join(ROOT, 'public'), outDir: BUILDING, commit });
  rmSync(SITE, { recursive: true, force: true });
  renameSync(BUILDING, SITE);
  console.log(`built .site from komorebi ${commit}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(BUILDING, { recursive: true, force: true });
}
