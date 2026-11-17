import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE } from '../src/config';
import gitignore from '../.gitignore?raw';
import wranglerConfig from '../wrangler.jsonc?raw';
import { buildEditorAssets, syncKomorebiFile } from '../scripts/editor-assets.mjs';

// A komorebi checkout, arboretum's public/ and an output folder, all in the runtime's in-memory file system.
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'assets-'));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  const publicDir = join(root, 'public');
  const komorebiDir = join(root, 'komorebi');
  const outDir = join(root, 'out');
  put(join(publicDir, 'llms.txt'), 'llms');
  put(join(publicDir, 'engine', 'engine.json'), 'engine');
  put(join(komorebiDir, 'index.html'), 'index');
  put(join(komorebiDir, 'editor.js'), 'editor');
  put(join(komorebiDir, 'examples', 'one.json'), 'one');
  return { root, put, publicDir, komorebiDir, outDir, args: { publicDir, komorebiDir, outDir } };
}

// Every file under a folder with its text, so a before and an after can be compared.
function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, snapshot(path, base));
    else out[path.slice(base.length)] = readFileSync(path, 'utf8');
  }
  return out;
}

describe('buildEditorAssets: the komorebi checkout at the root and public/ under arboretum/, as the deployed site has them', () => {
  it('serves both, so the editor and the API share one origin, and public/ where the deployed site has it', () => {
    const { args, outDir } = setup();
    buildEditorAssets(args);
    expect(readFileSync(join(outDir, 'arboretum', 'llms.txt'), 'utf8')).toBe('llms');
    expect(readFileSync(join(outDir, 'arboretum', 'engine', 'engine.json'), 'utf8')).toBe('engine');
    expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('index');
    expect(readFileSync(join(outDir, 'editor.js'), 'utf8')).toBe('editor');
    expect(readFileSync(join(outDir, 'examples', 'one.json'), 'utf8')).toBe('one');
    expect(existsSync(join(outDir, 'llms.txt'))).toBe(false);
    expect(existsSync(join(outDir, 'editor'))).toBe(false);
  });

  it('adds nothing of its own to the checkout (dev has no commit.json, as a local checkout has none)', () => {
    const { args, outDir } = setup();
    buildEditorAssets(args);
    expect(Object.keys(snapshot(outDir)).sort()).toEqual(['/arboretum/engine/engine.json', '/arboretum/llms.txt', '/editor.js', '/examples/one.json', '/index.html']);
  });

  it("leaves out the checkout's own arboretum/, so public/ alone is served there", () => {
    const { args, outDir, komorebiDir, put } = setup();
    put(join(komorebiDir, 'arboretum', 'public', 'llms.txt'), 'source');
    put(join(komorebiDir, 'arboretum', '.dev.vars'), 'secret');
    buildEditorAssets(args);
    expect(Object.keys(snapshot(outDir)).sort()).toEqual(['/arboretum/engine/engine.json', '/arboretum/llms.txt', '/editor.js', '/examples/one.json', '/index.html']);
  });

  it('puts public/ at the path the pages link to (BASE)', () => {
    const { args, outDir } = setup();
    buildEditorAssets(args);
    expect(readFileSync(join(outDir, BASE, 'llms.txt'), 'utf8')).toBe('llms');
  });

  it('leaves out git data, dependencies, the pixel harness, builds, workflows and unit tests', () => {
    const { args, outDir, komorebiDir, put } = setup();
    // In a worktree .git is a file, in a clone a folder.
    put(join(komorebiDir, '.git'), 'gitdir: elsewhere');
    put(join(komorebiDir, 'examples', '.git', 'HEAD'), 'ref');
    put(join(komorebiDir, 'node_modules', 'x', 'index.js'), 'x');
    put(join(komorebiDir, 'test-gl', 'editor.mjs'), 'smoke');
    put(join(komorebiDir, 'dist', 'komorebi.player.min.js'), 'bundle');
    put(join(komorebiDir, '.github', 'workflows', 'pages.yml'), 'ci');
    put(join(komorebiDir, 'maze.test.js'), 'test');
    put(join(komorebiDir, 'examples', 'deep.test.js'), 'test');
    buildEditorAssets(args);
    expect(Object.keys(snapshot(outDir)).filter((p) => !p.startsWith('/arboretum/')).sort()).toEqual(['/editor.js', '/examples/one.json', '/index.html']);
  });

  it('starts from nothing, so a file removed from the checkout is gone from the next build', () => {
    const { args, outDir, put } = setup();
    put(join(outDir, 'stale.js'), 'old');
    put(join(outDir, 'arboretum', 'stale-too.txt'), 'old');
    buildEditorAssets(args);
    expect(existsSync(join(outDir, 'stale.js'))).toBe(false);
    expect(existsSync(join(outDir, 'arboretum', 'stale-too.txt'))).toBe(false);
  });

  it('only reads the checkout and public/', () => {
    const { args, komorebiDir, publicDir } = setup();
    const before = [snapshot(komorebiDir), snapshot(publicDir)];
    buildEditorAssets(args);
    expect([snapshot(komorebiDir), snapshot(publicDir)]).toEqual(before);
  });
});

describe('syncKomorebiFile: the watcher keeps one changed file current', () => {
  it('copies a changed or new file and removes a deleted one', () => {
    const { args, outDir, komorebiDir, put } = setup();
    buildEditorAssets(args);
    put(join(komorebiDir, 'editor.js'), 'edited');
    put(join(komorebiDir, 'fresh', 'new.js'), 'new');
    syncKomorebiFile({ komorebiDir, outDir, rel: 'editor.js' });
    syncKomorebiFile({ komorebiDir, outDir, rel: join('fresh', 'new.js') });
    expect(readFileSync(join(outDir, 'editor.js'), 'utf8')).toBe('edited');
    expect(readFileSync(join(outDir, 'fresh', 'new.js'), 'utf8')).toBe('new');
  });

  it('removes from the output a file that is gone from the checkout', () => {
    const { args, outDir, komorebiDir, put } = setup();
    put(join(komorebiDir, 'gone.js'), 'x');
    buildEditorAssets(args);
    expect(existsSync(join(outDir, 'gone.js'))).toBe(true);
    rmSync(join(komorebiDir, 'gone.js'));
    syncKomorebiFile({ komorebiDir, outDir, rel: 'gone.js' });
    expect(existsSync(join(outDir, 'gone.js'))).toBe(false);
  });

  it('ignores a path the build leaves out', () => {
    const { args, outDir, komorebiDir, put } = setup();
    buildEditorAssets(args);
    put(join(komorebiDir, 'maze.test.js'), 'test');
    put(join(komorebiDir, 'node_modules', 'x.js'), 'x');
    syncKomorebiFile({ komorebiDir, outDir, rel: 'maze.test.js' });
    syncKomorebiFile({ komorebiDir, outDir, rel: join('node_modules', 'x.js') });
    expect(existsSync(join(outDir, 'maze.test.js'))).toBe(false);
    expect(existsSync(join(outDir, 'node_modules'))).toBe(false);
  });

  it("ignores the checkout's own arboretum/", () => {
    const { args, outDir, komorebiDir, put } = setup();
    buildEditorAssets(args);
    put(join(komorebiDir, 'arboretum', '.dev.vars'), 'secret');
    syncKomorebiFile({ komorebiDir, outDir, rel: join('arboretum', '.dev.vars') });
    syncKomorebiFile({ komorebiDir, outDir, rel: join('arboretum', 'llms.txt') });
    expect(existsSync(join(outDir, 'arboretum', '.dev.vars'))).toBe(false);
    expect(readFileSync(join(outDir, 'arboretum', 'llms.txt'), 'utf8')).toBe('llms');
  });
});

// The dev server serves komorebi's files with `wrangler dev --assets`, a command-line override. A deploy ships
// the built site (scripts/site.mjs), whose arboretum/ is a copy of public/, so nothing of komorebi's may ever sit
// in public/ (design §1.1).
describe('the never-deployable guard', () => {
  const published = Object.keys(import.meta.glob('../public/**/*')).map((p) => p.slice('../public/'.length));

  it('has no public/editor', () => {
    expect(published.filter((p) => p === 'editor' || p.startsWith('editor/'))).toEqual([]);
  });

  it('holds no komorebi or editor source outside public/engine/ (the pinned bundle)', () => {
    const stray = published.filter((p) => !p.startsWith('engine/')).filter((p) => /(^|\/)(komorebi[^/]*\.js|editor\.js|presets\.js|macros\.js)$/.test(p));
    expect(stray).toEqual([]);
  });

  it('is seen by the guard: public/ is not empty', () => {
    expect(published).toContain('llms.txt');
    expect(published.some((p) => p.startsWith('engine/'))).toBe(true);
  });

  // A plain `wrangler deploy` must never ship a half site, such as public/ alone at the root: the directory it
  // uploads is the built one, which does not exist until scripts/site.mjs has run.
  it('keeps wrangler.jsonc deploying the built, gitignored site and never public/ alone or the repo root', () => {
    expect(wranglerConfig).toMatch(/"directory"\s*:\s*"\.\/\.site"/);
    expect(gitignore.split('\n')).toContain('/.site/');
  });
});
