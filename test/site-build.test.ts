import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import flake from '../flake.nix?raw';
import { assembleSite, referencesIn, resolveRef, shipped, writeLayout } from '../scripts/site-assemble.mjs';
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
  put(join(komorebiDir, 'index.html'), '<script type="module" src="./editor.js"></script><script type="module" src="/breathe.js"></script>');
  put(join(komorebiDir, 'about.html'), '<link rel="stylesheet" href="about.css">');
  put(join(komorebiDir, 'about.css'), 'body { margin: 0 }');
  put(join(komorebiDir, 'player.html'), '<script type="module">import { create } from "./engine.js";</script>');
  put(join(komorebiDir, 'editor.js'), 'import { create } from "./engine.js";');
  put(join(komorebiDir, 'engine.js'), 'engine');
  put(join(komorebiDir, 'breathe.js'), 'breathe');
  put(join(komorebiDir, 'examples', 'one.html'), '<script src="../dist/komorebi.player.min.js"></script>');
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
      '/about.css',
      '/about.html',
      '/arboretum/arboretum.css',
      '/arboretum/engine/engine.json',
      '/arboretum/js/api.js',
      '/breathe.js',
      '/commit.json',
      '/dist/komorebi.embed.min.js',
      '/dist/komorebi.player.min.js',
      '/editor.js',
      '/engine.js',
      '/examples/one.html',
      '/index.html',
      '/player.html',
    ]);
    expect(readFileSync(join(outDir, 'engine.js'), 'utf8')).toBe('engine');
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

  it('ships what the pages use and nothing else: no docs, tests, build tools, servers or unreferenced scripts', () => {
    const { args, outDir, komorebiDir, put } = setup();
    for (const [name, text] of Object.entries({
      'CLAUDE.md': 'repo map',
      'README.md': 'readme',
      'komorebi-spec.md': 'spec',
      'maze.test.js': 'a unit test',
      'embed-build.mjs': 'a build tool',
      'glslcheck.mjs': 'a build tool',
      'dev-server.js': 'a server',
      'orphan.js': 'nothing imports it',
      'biome.jsonc': '{}',
      CNAME: 'komorebi.eljojo.net',
      '.gitignore': '/dist/',
      'flake.nix': 'flake',
      '.github/workflows/pages.yml': 'ci',
      'test-gl/editor.mjs': 'smoke',
      'examples/notes.md': 'notes',
      'examples/helper.test.js': 'test',
    })) put(join(komorebiDir, name), text);
    assembleSite(args);
    const files = Object.keys(snapshot(outDir));
    expect(files.filter((f) => !f.startsWith('/arboretum/')).sort()).toEqual([
      '/about.css',
      '/about.html',
      '/breathe.js',
      '/commit.json',
      '/dist/komorebi.embed.min.js',
      '/dist/komorebi.player.min.js',
      '/editor.js',
      '/engine.js',
      '/examples/one.html',
      '/index.html',
      '/player.html',
    ]);
  });

  it('only reads the komorebi tree and public/', () => {
    const { args, komorebiDir, publicDir } = setup();
    const before = [snapshot(komorebiDir), snapshot(publicDir)];
    assembleSite(args);
    expect([snapshot(komorebiDir), snapshot(publicDir)]).toEqual(before);
  });
});

describe('what komorebi holds where arboretum or the commit go is never shipped', () => {
  it('writes its own commit.json, never one komorebi holds, even where a page names it', () => {
    const { args, outDir, komorebiDir, put } = setup();
    put(join(komorebiDir, 'commit.json'), '{"commit":"someone else"}');
    put(join(komorebiDir, 'about.html'), '<link rel="stylesheet" href="about.css"><script type="module" src="./commit.json"></script>');
    assembleSite(args);
    expect(readFileSync(join(outDir, 'commit.json'), 'utf8')).toBe(`{"commit":"${COMMIT}"}\n`);
  });

  it('serves /arboretum from public/ even where a komorebi file stands there and a page names it', () => {
    const { args, outDir, komorebiDir, put } = setup();
    put(join(komorebiDir, 'arboretum', 'arboretum.css'), 'komorebi\'s own');
    put(join(komorebiDir, 'about.html'), '<link rel="stylesheet" href="about.css"><link rel="stylesheet" href="/arboretum/arboretum.css">');
    assembleSite(args);
    expect(readFileSync(join(outDir, 'arboretum', 'arboretum.css'), 'utf8')).toBe('css');
  });
});

describe('writeLayout fails loudly rather than write one output path twice', () => {
  it('refuses two outputs for one path, and writes nothing', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'layout-')), 'site');
    expect(() => writeLayout([{ to: 'commit.json', text: 'a' }, { to: 'commit.json', text: 'b' }], out)).toThrow(/commit\.json/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a file that stands where another output needs a folder', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'layout-')), 'site');
    expect(() => writeLayout([{ to: 'arboretum', text: 'a' }, { to: 'arboretum/js/api.js', text: 'b' }], out)).toThrow(/arboretum: is a file/);
  });

  it('names every collision it finds', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'layout-')), 'site');
    expect(() =>
      writeLayout([{ to: 'commit.json', text: 'a' }, { to: 'commit.json', text: 'b' }, { to: 'x/y.js', text: 'a' }, { to: 'x/y.js', text: 'b' }], out),
    ).toThrow(/commit\.json[\s\S]*x\/y\.js/);
  });
});

describe('assembleSite refuses what it cannot build', () => {
  it('fails, naming the file and who referenced it, when a page uses a file komorebi does not have, and writes nothing', () => {
    const { args, outDir, komorebiDir } = setup();
    rmSync(join(komorebiDir, 'breathe.js'));
    expect(() => assembleSite(args)).toThrow(/breathe\.js[\s\S]*index\.html/);
    expect(existsSync(outDir)).toBe(false);
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

// The walk, over an in-memory tree: { path: text }.
const tree = (files: Record<string, string>) => ({ paths: Object.keys(files), read: (p: string) => files[p] });
const PAGES = { 'index.html': '', 'about.html': '', 'player.html': '' };
const walk = (files: Record<string, string>) => shipped(tree({ ...PAGES, ...files }), { base: 'arboretum' });

describe('shipped: a walk from the pages', () => {
  it('starts from index, about, player, examples/*.html and dist/*.min.js, and nothing else', () => {
    expect(
      walk({
        'examples/a.html': '',
        'examples/deep/b.html': '',
        'dist/komorebi.player.min.js': '',
        'dist/komorebi.embed.min.js': '',
        'dist/notes.js': '',
        'other.html': '',
        'README.md': '',
      }),
    ).toEqual(['about.html', 'dist/komorebi.embed.min.js', 'dist/komorebi.player.min.js', 'examples/a.html', 'index.html', 'player.html']);
  });

  it('follows script src, link href (stylesheets and icons) and the imports of inline module scripts', () => {
    const out = walk({
      'index.html': `<link rel="stylesheet" href="about.css"><link rel="icon" href="leaf.svg"><script src="classic.js"></script>
        <script type="module" src="./editor.js"></script><script type="module">import { a } from './inline.js'; import('./lazy-inline.js');</script>
        <script src="/breathe.js"></script>`,
      'about.css': '', 'leaf.svg': '', 'classic.js': '', 'editor.js': '', 'inline.js': '', 'lazy-inline.js': '', 'breathe.js': '', 'unused.js': '',
    });
    expect(out).toEqual(['about.css', 'about.html', 'breathe.js', 'classic.js', 'editor.js', 'index.html', 'inline.js', 'lazy-inline.js', 'leaf.svg', 'player.html']);
  });

  it('follows, transitively, import … from, multi-line imports, bare imports, export … from, export *, and import() of a string', () => {
    const out = walk({
      'index.html': '<script type="module" src="a.js"></script>',
      'a.js': "import { x } from './b.js';\nimport {\n  y,\n  z, // 'it's\n} from \"./c.js\";\nimport './side.js';\nexport { q } from './d.js';\nexport * from './e.js';\nconst l = () => import('./f.js');",
      'b.js': "import * as ns from './sub/g.js'", 'c.js': '', 'side.js': '', 'd.js': '', 'e.js': '', 'f.js': '',
      'sub/g.js': "import h from '../h.js'; import i from './i.js'", 'h.js': '', 'sub/i.js': '',
      'unused.js': '',
    });
    expect(out).toEqual(['a.js', 'about.html', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js', 'h.js', 'index.html', 'player.html', 'side.js', 'sub/g.js', 'sub/i.js']);
  });

  it('follows the icons a web manifest names, relative to the manifest', () => {
    const out = walk({
      'index.html': '<link rel="manifest" href="app/manifest.webmanifest">',
      'app/manifest.webmanifest': JSON.stringify({ name: 'x', start_url: '../', icons: [{ src: 'icons/a.png' }, { src: '/b.png' }, { src: 'https://cdn.example/c.png' }] }),
      'app/icons/a.png': '', 'b.png': '', 'unused.png': '',
    });
    expect(out).toEqual(['about.html', 'app/icons/a.png', 'app/manifest.webmanifest', 'b.png', 'index.html', 'player.html']);
  });

  it('follows CSS url() and @import, relative to the stylesheet', () => {
    const out = walk({
      'index.html': '<link rel="stylesheet" href="css/site.css">',
      'css/site.css': "@import 'base.css'; @import url(\"more.css\"); /* url(commented.png) */ a { background: url(../img/leaf.png); } b { background: url('x.svg#frag') } c { background: url(data:image/png;base64,AAA) }",
      'css/base.css': '', 'css/more.css': '', 'img/leaf.png': '', 'css/x.svg': '', 'css/commented.png': '', 'img/other.png': '',
    });
    expect(out).toEqual(['about.html', 'css/base.css', 'css/more.css', 'css/site.css', 'css/x.svg', 'img/leaf.png', 'index.html', 'player.html']);
  });

  it('reads style blocks in a page as CSS, relative to the page', () => {
    expect(walk({ 'examples/a.html': '<style>p { background: url(bg.png) }</style>', 'examples/bg.png': '' })).toContain('examples/bg.png');
  });

  it('resolves relative paths against the referencing file and root-absolute ones against the site root', () => {
    const out = walk({
      'examples/a.html': '<script src="../dist/komorebi.player.min.js"></script><script type="module">import { c } from "../komorebi.js"; import "/presets.js"</script>',
      'dist/komorebi.player.min.js': '', 'komorebi.js': '', 'presets.js': '',
    });
    expect(out).toEqual(expect.arrayContaining(['dist/komorebi.player.min.js', 'komorebi.js', 'presets.js']));
  });

  it('ignores a query and a hash, and takes a cycle once', () => {
    const out = walk({ 'index.html': '<script type="module" src="a.js?v=3#x"></script>', 'a.js': "import './b.js'", 'b.js': "import './a.js'" });
    expect(out).toEqual(['a.js', 'about.html', 'b.js', 'index.html', 'player.html']);
  });

  it('ignores every URL with a scheme or a host, arboretum’s and the API’s paths, bare module names and directories', () => {
    const out = walk({
      'index.html': `<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet"><script src="//cdn.example/x.js"></script>
        <link rel="icon" href="data:,"><link rel="canonical" href="/"><link rel="alternate" href="examples/">
        <script type="module">import 'https://esm.sh/x'; import('/arboretum/js/api.js'); import fs from 'node:fs'; import r from 'react'; fetch('/api/health');</script>
        <link rel="stylesheet" href="/arboretum/arboretum.css"><link rel="stylesheet" href="/arboretum"><script src="/api/me"></script>`,
    });
    expect(out).toEqual(['about.html', 'index.html', 'player.html']);
  });

  it('does not follow what is commented out', () => {
    const out = walk({
      'index.html': '<!-- <script src="gone.js"></script> --><script type="module" src="a.js"></script>',
      'a.js': "// import './gone.js';\n  // import('./gone2.js')\nimport './kept.js';",
      'kept.js': '',
    });
    expect(out).toEqual(['a.js', 'about.html', 'index.html', 'kept.js', 'player.html']);
  });

  it('does not look for commit.json: the build writes it', () => {
    expect(walk({ 'index.html': '<script src="commit.json"></script>' })).toEqual(['about.html', 'index.html', 'player.html']);
  });

  it('fails when a referenced file is missing, naming it and the file that referenced it', () => {
    expect(() => walk({ 'index.html': '<script type="module" src="editor.js"></script>' })).toThrow(/editor\.js[^\n]*index\.html/);
    expect(() => walk({ 'index.html': '<script type="module" src="a.js"></script>', 'a.js': "import './nope.js'" })).toThrow(/nope\.js[^\n]*a\.js/);
    expect(() => walk({ 'index.html': '<link rel="stylesheet" href="s.css">', 's.css': 'a { background: url(nope.png) }' })).toThrow(/nope\.png[^\n]*s\.css/);
  });

  it('names every missing file at once', () => {
    expect(() => walk({ 'index.html': '<script src="a.js"></script><script src="b.js"></script>' })).toThrow(/a\.js[\s\S]*b\.js/);
  });

  it('fails when a page it starts from is missing', () => {
    for (const page of ['index.html', 'about.html', 'player.html']) {
      const files: Record<string, string> = { ...PAGES };
      delete files[page];
      expect(() => shipped(tree(files), { base: 'arboretum' }), page).toThrow(new RegExp(page.replace('.', '\\.')));
    }
  });

  it('fails on a reference that climbs out of the site', () => {
    expect(() => walk({ 'index.html': '<script src="../../x.js"></script>' })).toThrow(/x\.js|outside/);
  });
});

describe('referencesIn and resolveRef', () => {
  it('lists what a file names, by kind of file', () => {
    expect(referencesIn('a.html', '<script src="x.js"></script><link href="y.css">')).toEqual(['x.js', 'y.css']);
    expect(referencesIn('a.js', "import a from './x.js'; import('./y.js')")).toEqual(['./x.js', './y.js']);
    expect(referencesIn('a.css', '@import "x.css"; a { background: url(y.png) }')).toEqual(['x.css', 'y.png']);
    expect(referencesIn('a.md', 'import a from "./x.js"')).toEqual([]);
    expect(referencesIn('a.png', 'url(x.png)')).toEqual([]);
  });

  it.each([
    ['index.html', 'editor.js', 'editor.js'],
    ['index.html', './editor.js', 'editor.js'],
    ['examples/a.html', '../dist/x.js', 'dist/x.js'],
    ['examples/a.html', '/breathe.js', 'breathe.js'],
    ['sub/dir/a.js', '../b.js?x=1#y', 'sub/b.js'],
    ['index.html', 'my%20file.js', 'my file.js'],
    ['index.html', 'https://x.example/a.js', null],
    ['index.html', '//x.example/a.js', null],
    ['index.html', 'data:,', null],
    ['index.html', '#top', null],
    ['index.html', '', null],
    ['index.html', './', null],
    ['index.html', 'examples/', null],
    ['index.html', '/arboretum/js/api.js', null],
    ['index.html', '/arboretum', null],
    ['index.html', '/api/health', null],
    ['index.html', '/arboretums.js', 'arboretums.js'],
    ['index.html', 'commit.json', null],
  ])('%s names %s → %s', (from, url, rel) => {
    expect(resolveRef(from, url, { base: 'arboretum' })).toBe(rel);
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
