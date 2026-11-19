// The komorebi engine at the commit komorebi-render was built from (config.js, loadEngine): a bare mirror of the repo, a git
// worktree of that commit, its test-gl deps and Chromium. A worktree (not `git archive`) because render-video.mjs runs `git -C <its own repo> archive <sha>` for --commit:
// it must live inside a git repo that knows the commit, and a worktree's .git file leads to the mirror's object store.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
export async function defaultRun(cmd, args, { cwd, env, signal } = {}) {
  try {
    const r = await execute(cmd, args, { cwd, env, signal, encoding: 'utf8', maxBuffer: 64 << 20 });
    return { ...r, status: 0 };
  } catch (error) {
    return { status: typeof error.code === 'number' ? error.code : null, stdout: error.stdout, stderr: error.stderr,
      error: typeof error.code === 'number' ? null : error };
  }
}

// The arboretum token is for the exporter alone: git, npm and playwright never see it.
export function childEnv(config, base = process.env) {
  const env = { ...base, PLAYWRIGHT_BROWSERS_PATH: config.browsers };
  delete env.ARBORETUM_TOKEN;
  return env;
}

const tail = (r) => String(r.stderr || r.stdout || '').trim().split('\n').slice(-5).join(' | ');

async function step(run, env, label, cmd, args, cwd, signal) {
  const r = await run(cmd, args, { cwd, env, signal });
  if (r.error || r.status !== 0) throw new Error(`${label} failed${r.status != null ? ` (status ${r.status})` : ''}: ${r.error?.message ?? tail(r)}`);
  return r;
}

export async function ensureMirror({ config, pin, run = defaultRun, signal }) {
  const env = childEnv(config);
  mkdirSync(config.state, { recursive: true });
  if (!existsSync(join(config.mirror, 'HEAD'))) await step(run, env, 'git clone --mirror', 'git', ['clone', '--mirror', pin.repo, config.mirror], undefined, signal);
  return env;
}

const hasCommit = async (run, env, config, sha, signal) => (await run('git', ['-C', config.mirror, 'cat-file', '-e', `${sha}^{commit}`], { env, signal })).status === 0;

export async function prepare({ config, pin, run = defaultRun, signal }) {
  const sha = pin.commit;
  const dir = config.engineDir(sha);
  const script = join(dir, 'test-gl', 'render-video.mjs');
  const marker = join(dir, '.komorebi-render-prepared');
  const result = { dir, script, commit: sha };
  // Only a complete prepare leaves the marker: a half-done one (npm offline) is redone from where it stopped, each step being idempotent.
  if (existsSync(marker) && existsSync(script)) return result;

  const env = await ensureMirror({ config, pin, run, signal });
  if (!await hasCommit(run, env, config, sha, signal)) {
    await step(run, env, 'git fetch', 'git', ['-C', config.mirror, 'fetch', '--prune', 'origin'], undefined, signal);
    if (!await hasCommit(run, env, config, sha, signal)) throw new Error(`commit ${sha} is not in ${pin.repo} (the mirror has fetched everything it has)`);
  }
  if (!existsSync(join(dir, '.git'))) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });   // a worktree that never finished
    mkdirSync(join(config.state, 'engine'), { recursive: true });
    await run('git', ['-C', config.mirror, 'worktree', 'prune'], { env, signal });
    await step(run, env, 'git worktree add', 'git', ['-C', config.mirror, 'worktree', 'add', '--detach', dir, sha], undefined, signal);
  }
  const testGl = join(dir, 'test-gl');
  await step(run, env, 'npm ci', 'npm', ['ci', '--no-audit', '--no-fund'], testGl, signal);
  if (config.installBrowsers) {
    mkdirSync(config.browsers, { recursive: true });
    await step(run, env, 'playwright install chromium', 'npx', ['playwright', 'install', 'chromium'], testGl, signal);
  }
  writeFileSync(marker, `${sha}\n`);
  return result;
}

// Shipped playlists (["ship:story", "ship:shadows"]) as one playlist the exporter's --playlist-json reads, from the prepared
// worktree's presets.js: each look's params as shipped, paced as the editor paces them (the item's own times, else its
// playlist's crossfade_s, else ITEM_DEFAULTS). The lists play one after another and the whole loops; a list's `next` is not followed.
export async function shippedPlaylist(dir, list) {
  const { PRESETS, PLAYLISTS, ITEM_DEFAULTS } = await import(pathToFileURL(join(dir, 'presets.js')).href);
  const lists = list.map((v) => {
    const p = PLAYLISTS?.[v.slice(5)];
    if (!p) throw new Error(`${v} is not a shipped playlist of the engine`);
    return p;
  });
  const items = lists.flatMap((p) => p.items.map((it) => (typeof it === 'string' ? { look: it } : it)).map((it) => {
    if (!Object.hasOwn(PRESETS, it.look)) throw new Error(`${p.name} names ${JSON.stringify(it.look)}, which presets.js does not ship`);
    return { name: it.look, params: PRESETS[it.look], dwell_s: it.dwell_s ?? ITEM_DEFAULTS.dwell_s,
      crossfade_s: it.crossfade_s ?? p.crossfade_s ?? ITEM_DEFAULTS.crossfade_s, style: it.style ?? ITEM_DEFAULTS.style };
  }));
  return { name: lists.map((p) => p.name).join(', '), items };
}
