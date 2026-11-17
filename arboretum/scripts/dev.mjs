// Arboretum's dev mode (design §1.1): `nix run .#arboretum-dev [komorebi-checkout]`, this checkout by default. Serves the deployed site's layout from one
// https origin, so the editor's session cookie and API calls are same-origin: a komorebi checkout at the root and
// arboretum's pages under /arboretum. The checkout is only ever read: it is copied into .wrangler/editor-assets, which
// is gitignored and is never what `wrangler deploy` ships (wrangler.jsonc ships the built site, ./.site; --assets
// below is a dev-command override that keeps the config's run_worker_first, so `/` still passes the Worker).
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEditorAssets, syncKomorebiFile } from './editor-assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const komorebiDir = resolve(process.argv[2] ?? join(ROOT, '..'));
const outDir = join(ROOT, '.wrangler', 'editor-assets');
const ORIGIN = 'https://localhost:8787';

const run = (args) => spawn('npx', ['wrangler', ...args], { cwd: ROOT, stdio: 'inherit' });

const migrated = await new Promise((done) => run(['d1', 'migrations', 'apply', 'komorebi-arboretum', '--local']).on('exit', done));
if (migrated !== 0) process.exit(migrated ?? 1);

buildEditorAssets({ publicDir: join(ROOT, 'public'), komorebiDir, outDir });
const watcher = watch(komorebiDir, { recursive: true }, (_event, rel) => {
  if (rel) syncKomorebiFile({ komorebiDir, outDir, rel });
});

console.log(`komorebi   ${ORIGIN}/\narboretum  ${ORIGIN}/arboretum  (serving ${komorebiDir}; reload the tab after changing a file there)`);
const server = run(['dev', '--local-protocol', 'https', '--port', '8787', '--var', 'RP_ID:localhost', '--var', `ORIGIN:${ORIGIN}`, '--assets', outDir]);
server.on('exit', (code) => {
  watcher.close();
  process.exit(code ?? 0);
});
