// Arboretum's dev mode (design §1.1): `nix run .#dev [komorebi-checkout]`. Serves arboretum and, under /editor/,
// a komorebi checkout from one https origin, so the editor's session cookie and API calls are same-origin.
// The checkout is only ever read: it is copied into .wrangler/editor-assets, which is gitignored and is never
// what `wrangler deploy` ships (wrangler.jsonc keeps ./public; --assets below is a dev-command override).
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEditorAssets, syncKomorebiFile } from './editor-assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const komorebiDir = resolve(process.argv[2] ?? join(homedir(), 'code', 'komorebi'));
const outDir = join(ROOT, '.wrangler', 'editor-assets');
const ORIGIN = 'https://localhost:8787';

const run = (args) => spawn('npx', ['wrangler', ...args], { cwd: ROOT, stdio: 'inherit' });

const migrated = await new Promise((done) => run(['d1', 'migrations', 'apply', 'komorebi-arboretum', '--local']).on('exit', done));
if (migrated !== 0) process.exit(migrated ?? 1);

buildEditorAssets({ publicDir: join(ROOT, 'public'), komorebiDir, outDir });
const watcher = watch(komorebiDir, { recursive: true }, (_event, rel) => {
  if (rel) syncKomorebiFile({ komorebiDir, outDir, rel });
});

console.log(`arboretum  ${ORIGIN}\nthe editor ${ORIGIN}/editor/  (serving ${komorebiDir}; reload the tab after changing a file there)`);
const server = run(['dev', '--local-protocol', 'https', '--port', '8787', '--var', 'RP_ID:localhost', '--var', `ORIGIN:${ORIGIN}`, '--assets', outDir]);
server.on('exit', (code) => {
  watcher.close();
  process.exit(code ?? 0);
});
