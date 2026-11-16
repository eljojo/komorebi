// ============================================================================
// cost.mjs: what a look costs to draw on this machine's GPU, and what a change to it adds. `nix run .#cost -- …`
//
//   node test-gl/cost.mjs <look>... [key=value ...] [--vs key=value ...] [--runs 3] [--frames 200] [--size 1920x1080] [--out file.json]
//
// <look> is a built-in look's name, or a .json file holding a look: a bare params object, or an arboretum preset as
// GET /api/presets/:id returns it ({ name, params }). key=value (JSON values) applies to every look; --vs starts B, the same
// look with these on top, measured beside A. A warm-up measurement per look is thrown away (the page's first grove and the JIT's
// first pass are slower); then runs alternate A B, B A, A B … so a GPU warming up loads both sides alike.
//
// Each measurement is one engine on Chrome on the Metal GPU (video-lib.mjs's launcher; it refuses a software renderer), at
// --size with auto-quality and the adaptive frame rate held off, the browser without vsync. Per look and side it reports
// the median over runs of each run's median:
//   frame   the interval between frames each closed by a one-pixel read: the frame's whole work, CPU and GPU. The headline.
//   build   a regrow of the grove (apply('canopy')): what a canopy change, or each step of a canopy morph, pays on the CPU
//   gpu     the timer queries' milliseconds of the frame's passes (transport and bake), secondary: on Metal they read more than
//           the whole frame takes (20–40 ms inside 9–15 ms frames on the faithful maples), so they rank passes, not frames
// and the spread (the smallest to the largest run median) beside it, so a difference inside the spread reads as none.
// The record (look, params, every sample, the renderer, Chrome's version, the commit and whether the tree was dirty) goes to
// --out, by default test-gl/out/cost/<date>-<time>.json. The engine is the working tree as it is on disk.
// ============================================================================
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { REPO, assertHardwareRenderer, launchBrowser, startServer } from './video-lib.mjs';

const VARIANT = 'chromium+angle-metal+enable-gpu';
const NO_VSYNC = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

function parseArgs(argv) {
  const o = { looks: [], a: {}, b: null, runs: 3, frames: 200, size: [1920, 1080], out: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--vs') { o.b = {}; continue; }
    if (x === '--runs') { o.runs = Number(argv[++i]); continue; }
    if (x === '--frames') { o.frames = Number(argv[++i]); continue; }
    if (x === '--size') { o.size = argv[++i].split('x').map(Number); continue; }
    if (x === '--out') { o.out = argv[++i]; continue; }
    if (x === '--help' || x === '-h') { o.help = true; continue; }
    const eq = x.indexOf('=');
    if (eq > 0 && !x.endsWith('.json')) { const [k, v] = [x.slice(0, eq), x.slice(eq + 1)]; let val; try { val = JSON.parse(v); } catch { val = v; } (o.b ?? o.a)[k] = val; continue; }
    o.looks.push(x);
  }
  return o;
}

const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const spread = (xs) => { const s = xs.filter(Number.isFinite); return s.length ? [Math.min(...s), Math.max(...s)] : [NaN, NaN]; };

const opts = parseArgs(process.argv.slice(2));
if (opts.help || !opts.looks.length) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(opts.help ? 0 : 1);
}

const srv = await startServer({ engineRoot: REPO });
const { browser } = await launchBrowser(chromium, VARIANT, NO_VSYNC);
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: opts.size[0], height: opts.size[1] } });
page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${srv.port}/test-gl/cost.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { polling: 100, timeout: 60000 });
const renderer = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d.UNMASKED_RENDERER_WEBGL); });
assertHardwareRenderer(renderer, VARIANT);

async function lookOf(arg) {
  if (arg.endsWith('.json')) {
    const d = JSON.parse(readFileSync(arg, 'utf8'));
    return d.params && typeof d.params === 'object' ? { name: d.name ?? basename(arg), params: d.params } : { name: basename(arg), params: d };
  }
  const params = await page.evaluate((n) => window.__cost.preset(n), arg);
  if (!params) throw new Error(`no built-in look named ${arg}`);
  return { name: arg, params };
}

const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : '–').padStart(6);
const side = (rs) => {
  const pick = (k) => rs.map((r) => r[k]);
  const out = {};
  for (const k of ['transportMs', 'bakeMs', 'wallMs', 'buildMs']) out[k] = { median: median(pick(k)), spread: spread(pick(k)) };
  out.gpuMs = { median: median(rs.map((r) => (r.transportMs || 0) + (r.bakeMs || 0))), spread: spread(rs.map((r) => (r.transportMs || 0) + (r.bakeMs || 0))) };
  out.leaves = rs[0]?.leaves ?? null;
  return out;
};

console.log(`${renderer}\n${opts.size.join('x')}, ${opts.runs} runs of ${opts.frames} frames${opts.b ? `, B = A + ${JSON.stringify(opts.b)}` : ''}\n`);
const records = [];
for (const arg of opts.looks) {
  const look = await lookOf(arg), A = { ...look.params, ...opts.a }, B = opts.b ? { ...A, ...opts.b } : null;
  const runs = { A: [], B: [] };
  await page.evaluate(([p, o]) => window.__cost.measure(p, o), [A, { w: opts.size[0], h: opts.size[1], frames: 60, builds: 3 }]);   // warm-up, not kept: the page's first grove and the JIT's first pass are slower
  for (let r = 0; r < opts.runs; r++) {
    const order = B ? (r % 2 ? ['B', 'A'] : ['A', 'B']) : ['A'];
    for (const s of order) runs[s].push(await page.evaluate(([p, o]) => window.__cost.measure(p, o), [s === 'A' ? A : B, { w: opts.size[0], h: opts.size[1], frames: opts.frames }]));
  }
  const a = side(runs.A), b = B ? side(runs.B) : null;
  const line = (label, s) => `  ${label}  frame ${fmt(s.wallMs.median)} ms (${fmt(s.wallMs.spread[0])}–${fmt(s.wallMs.spread[1])})  build ${fmt(s.buildMs.median)} ms  gpu ${fmt(s.gpuMs.median)} ms  ${s.leaves ?? '?'} leaves`;
  console.log(look.name);
  console.log(line('A', a));
  if (b) {
    console.log(line('B', b));
    const d = b.wallMs.median - a.wallMs.median, inside = b.wallMs.spread[0] <= a.wallMs.spread[1] && a.wallMs.spread[0] <= b.wallMs.spread[1];
    const db = b.buildMs.median - a.buildMs.median;
    console.log(`  B − A  frame ${d >= 0 ? '+' : ''}${d.toFixed(2)} ms (${(100 * d / a.wallMs.median).toFixed(1)}%)${inside ? ', inside the spread' : ''}  build ${db >= 0 ? '+' : ''}${db.toFixed(1)} ms (×${(b.buildMs.median / a.buildMs.median).toFixed(2)})`);
  }
  records.push({ look: look.name, A: { params: A, summary: a, runs: runs.A }, B: B ? { params: B, summary: b, runs: runs.B } : null });
}

const git = (...a) => { try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim(); } catch { return null; } };
const out = opts.out ?? join(REPO, 'test-gl/out/cost', `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
mkdirSync(join(out, '..'), { recursive: true });
writeFileSync(out, JSON.stringify({ commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain', '--untracked-files=no'), renderer, chrome: browser.version(), size: opts.size, runs: opts.runs, frames: opts.frames, a: opts.a, vs: opts.b, records }, null, 1));
console.log(`\n${out}`);
await browser.close(); await srv.close();
