// Everything the environment decides, read once. The ARBORETUM_TOKEN (or the file it is read from) lives here and is handed to the exporter alone:
// never print a config.
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_SECONDS } from './spec.js';

export function loadConfig(env = process.env, home = homedir()) {
  const state = resolve(env.KOMOREBI_RENDER_STATE || join(home, '.local', 'state', 'komorebi-render'));
  let maxSeconds = DEFAULT_MAX_SECONDS;
  if (env.KOMOREBI_RENDER_MAX_SECONDS !== undefined) {
    maxSeconds = Number(env.KOMOREBI_RENDER_MAX_SECONDS);
    if (!Number.isInteger(maxSeconds) || maxSeconds < 1) throw new Error(`KOMOREBI_RENDER_MAX_SECONDS must be a whole number of seconds, got ${JSON.stringify(env.KOMOREBI_RENDER_MAX_SECONDS)}`);
  }
  let port = 8077;
  if (env.KOMOREBI_RENDER_PORT !== undefined) {
    port = env.KOMOREBI_RENDER_PORT === '' ? NaN : Number(env.KOMOREBI_RENDER_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`KOMOREBI_RENDER_PORT must be a port number (0 to 65535), got ${JSON.stringify(env.KOMOREBI_RENDER_PORT)}`);
  }
  return {
    state,
    dbPath: join(state, 'jobs.sqlite'),
    mirror: join(state, 'komorebi.git'),
    browsers: env.PLAYWRIGHT_BROWSERS_PATH || join(state, 'browsers'),
    installBrowsers: !env.PLAYWRIGHT_BROWSERS_PATH,
    engineDir: (sha) => join(state, 'engine', sha),
    out: env.KOMOREBI_RENDER_OUT ? resolve(env.KOMOREBI_RENDER_OUT) : null,
    allowLocal: env.KOMOREBI_RENDER_ALLOW_LOCAL === '1',
    maxSeconds,
    host: env.KOMOREBI_RENDER_HOST || '0.0.0.0',   // no auth: the API is for the LAN (brief 3)
    port,
    token: env.ARBORETUM_TOKEN || readTokenFile(env.KOMOREBI_RENDER_ARBORETUM_TOKEN_FILE),
  };
}

// The nix module hands the program a path, never the token: the token must not enter the nix store. Read once, at start.
// A configured file that cannot be used stops the start (the message names the path, never the contents).
function readTokenFile(file) {
  if (!file) return null;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new Error(`KOMOREBI_RENDER_ARBORETUM_TOKEN_FILE ${file} cannot be read (${e.code ?? e.message})`); }
  const token = text.trim();
  if (!token) throw new Error(`KOMOREBI_RENDER_ARBORETUM_TOKEN_FILE ${file} is empty`);
  return token;
}

// The engine komorebi-render runs: the exporter of the komorebi it ships in, at that tree's commit. The package writes the
// commit it was built from into `commit` beside src/; a checkout asks its own git. The prepared worktree comes from a mirror
// of the public repository, so the commit must have been pushed there. A build from uncommitted changes has no commit to render.
export const KOMOREBI_REPO = 'https://github.com/eljojo/komorebi';
export function loadEngine(dir = fileURLToPath(new URL('..', import.meta.url))) {
  let commit;
  try { commit = readFileSync(join(dir, 'commit'), 'utf8').trim(); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    try { commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {
      throw new Error(`${dir} has no commit: komorebi-render renders the komorebi commit it was built from, and this one was built from uncommitted changes`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${dir}: the engine's commit must be a full 40-hex sha, got ${JSON.stringify(commit)}`);
  return { repo: KOMOREBI_REPO, commit };
}
