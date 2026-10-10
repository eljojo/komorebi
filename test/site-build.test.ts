import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import flake from '../flake.nix?raw';
import { assembleSite } from '../scripts/site-assemble.mjs';
import { BASE } from '../src/config';

const COMMIT = '6eda9ed3a052c61affd6a7a8cc5887700a5aa098';

// A komorebi tree as `git archive` leaves it after the two bundles are built into dist/, arboretum's public/, and an
// output folder that does not exist yet, all in the runtime's in-memory file system.
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'site-'));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const komorebiDir = join(root, 'komorebi');
  const publicDir = join(root, 'public');
  const outDir = join(root, 'site');
  put(join(komorebiDir, 'index.html'), 'index');
  put(join(komorebiDir, 'editor.js'), 'editor');
  put(join(komorebiDir, 'maze.test.js'), 'a unit test, which Pages serves too');
  put(join(komorebiDir, 'examples', 'one.html'), 'one');
  put(join(komorebiDir, 'dist', 'komorebi.player.min.js'), 'player');
  put(join(komorebiDir, 'dist', 'komorebi.embed.min.js'), 'embed');
  put(join(publicDir, 'arboretum.css'), 'css');
  put(join(publicDir, 'js', 'api.js'), 'api');
  put(join(publicDir, 'engine', 'engine.json'), 'engine');
  return { root, put, komorebiDir, publicDir, outDir, args: { komorebiDir, publicDir, outDir, commit: COMMIT } };
}

// Every file under a folder with its text.
function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, snapshot(path, base));
    else out[path.slice(base.length)] = readFileSync(path, 'utf8');
  }
  return out;
}

describe('assembleSite: komorebi at the root, arboretum under arboretum/', () => {
  it('lays out the site, the bundles, the commit and public/', () => {
    const { args, outDir } = setup();
    assembleSite(args);
    expect(Object.keys(snapshot(outDir)).sort()).toEqual([
      '/arboretum/arboretum.css',
      '/arboretum/engine/engine.json',
      '/arboretum/js/api.js',
      '/commit.json',
      '/dist/komorebi.embed.min.js',
      '/dist/komorebi.player.min.js',
      '/editor.js',
      '/examples/one.html',
      '/index.html',
      '/maze.test.js',
    ]);
    expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('index');
    expect(readFileSync(join(outDir, 'arboretum', 'js', 'api.js'), 'utf8')).toBe('api');
  });

  it('puts public/ where the pages link to it (BASE)', () => {
    const { args, outDir } = setup();
    assembleSite(args);
    expect(existsSync(join(outDir, BASE, 'arboretum.css'))).toBe(true);
  });

  it('writes commit.json as the editor reads it', () => {
    const { args, outDir } = setup();
    assembleSite(args);
    expect(JSON.parse(readFileSync(join(outDir, 'commit.json'), 'utf8'))).toEqual({ commit: COMMIT });
    expect(readFileSync(join(outDir, 'commit.json'), 'utf8')).toBe(`{"commit":"${COMMIT}"}\n`);
  });

  it('leaves out what pages.yml leaves out, at any depth: git data, the workflows, the pixel harness and flake files', () => {
    const { args, outDir, komorebiDir, put } = setup();
    // In a worktree .git is a file, in a clone a folder.
    put(join(komorebiDir, '.git'), 'gitdir: elsewhere');
    put(join(komorebiDir, 'examples', '.git', 'HEAD'), 'ref');
    put(join(komorebiDir, '.github', 'workflows', 'pages.yml'), 'ci');
    put(join(komorebiDir, 'test-gl', 'editor.mjs'), 'smoke');
    put(join(komorebiDir, 'examples', 'test-gl', 'deep.mjs'), 'smoke');
    put(join(komorebiDir, 'flake.nix'), 'flake');
    put(join(komorebiDir, 'flake.lock'), 'lock');
    put(join(komorebiDir, 'examples', 'flake.nix'), 'flake');
    assembleSite(args);
    const files = Object.keys(snapshot(outDir));
    for (const gone of ['.git', '.github', 'test-gl', 'flake.nix', 'flake.lock']) {
      expect(files.filter((f) => f.split('/').includes(gone) || f.split('/').some((p) => p.startsWith('flake.'))), gone).toEqual([]);
    }
    expect(files).toContain('/examples/one.html');
  });

  it('only reads the komorebi tree and public/', () => {
    const { args, komorebiDir, publicDir } = setup();
    const before = [snapshot(komorebiDir), snapshot(publicDir)];
    assembleSite(args);
    expect([snapshot(komorebiDir), snapshot(publicDir)]).toEqual(before);
  });
});

describe('assembleSite fails loudly rather than write one output path twice', () => {
  it('refuses a komorebi tree that already has a commit.json, and writes nothing', () => {
    const { args, outDir, komorebiDir, put } = setup();
    put(join(komorebiDir, 'commit.json'), '{"commit":"someone else"}');
    expect(() => assembleSite(args)).toThrow(/commit\.json/);
    expect(existsSync(outDir)).toBe(false);
  });

  it('refuses a komorebi file that lands on one of public/\'s', () => {
    const { args, outDir, komorebiDir, put } = setup();
    put(join(komorebiDir, 'arboretum', 'arboretum.css'), 'komorebi\'s own');
    expect(() => assembleSite(args)).toThrow(/arboretum\/arboretum\.css/);
    expect(existsSync(outDir)).toBe(false);
  });

  it('refuses a komorebi file that stands where public/ needs a folder, and the reverse', () => {
    const a = setup();
    a.put(join(a.komorebiDir, 'arboretum'), 'a file');
    expect(() => assembleSite(a.args)).toThrow(/arboretum/);
    const b = setup();
    b.put(join(b.komorebiDir, 'arboretum', 'js'), 'a file');
    expect(() => assembleSite(b.args)).toThrow(/arboretum\/js/);
  });

  it('names every collision it finds', () => {
    const { args, komorebiDir, put } = setup();
    put(join(komorebiDir, 'commit.json'), 'x');
    put(join(komorebiDir, 'arboretum', 'js', 'api.js'), 'x');
    expect(() => assembleSite(args)).toThrow(/commit\.json[\s\S]*arboretum\/js\/api\.js/);
  });

  it('refuses an output folder that already exists, so nothing old is mixed in', () => {
    const { args, outDir, put } = setup();
    put(join(outDir, 'stale.js'), 'old');
    expect(() => assembleSite(args)).toThrow(/already exists/);
  });

  it('refuses anything but a full commit hash', () => {
    const { args } = setup();
    for (const commit of ['', 'main', COMMIT.slice(0, 7), `${COMMIT}\n`]) expect(() => assembleSite({ ...args, commit }), commit).toThrow(/commit/);
  });
});

describe('nix run .#deploy', () => {
  it('builds the site after the tests and before anything reaches Cloudflare', () => {
    const at = (step: string) => flake.indexOf(step);
    expect(at('node scripts/site.mjs')).toBeGreaterThan(at('npm test'));
    expect(at('node scripts/site.mjs')).toBeLessThan(at('wrangler d1 migrations apply'));
    expect(at('node scripts/site.mjs')).toBeLessThan(at('npx wrangler deploy'));
  });
});
