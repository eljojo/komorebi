// Builds the site Cloudflare serves, into .site/ (gitignored, never committed): `node scripts/site.mjs`.
//   komorebi's static site at the root, as GitHub Pages published it   (komorebi's .github/workflows/pages.yml)
//   arboretum's public/ under arboretum/
// The komorebi commit is the one public/engine/engine.json pins, so one pin drives the engine and the site. It is read
// through `git archive` into a temporary folder, as scripts/pin-engine.mjs does: the komorebi working tree is never
// touched. The two bundles are built there exactly as pages.yml builds them, then scripts/site-assemble.mjs lays the
// site out and refuses to write any path twice. `.site` is replaced only once the whole site exists, so a failed
// build leaves the last good one (or none, which `wrangler deploy` refuses).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleSite } from './site-assemble.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KOMOREBI = join(homedir(), 'code', 'komorebi');
const SITE = join(ROOT, '.site');
const BUILDING = join(ROOT, '.site.tmp');

// The eljojo.net homepage's three looks, as pages.yml's "Build the homepage bundle" step names them.
const HOMEPAGE_LOOKS = ['morning 2', 'afternoon 5b', 'morning 3'];

const { commit } = JSON.parse(readFileSync(join(ROOT, 'public', 'engine', 'engine.json'), 'utf8'));
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error(`public/engine/engine.json does not pin a full commit: ${JSON.stringify(commit)}`);

const tmp = mkdtempSync(join(tmpdir(), 'arboretum-site-'));
try {
  const archive = execFileSync('git', ['-C', KOMOREBI, 'archive', commit], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', tmp], { input: archive });

  // embed-build.mjs needs bun. No arguments: dist/komorebi.player.min.js. With looks: dist/komorebi.embed.min.js.
  const embedBuild = (...looks) => execFileSync('nix', ['shell', 'nixpkgs#bun', '-c', 'node', 'embed-build.mjs', ...looks], { cwd: tmp, stdio: 'inherit' });
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
