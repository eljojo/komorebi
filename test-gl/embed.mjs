// ============================================================================
// embed.mjs — the EMBED bundle's proof: dist/komorebi.embed.min.js must render the looks it was built for
// EXACTLY as the raw engine does. embed-build.mjs cuts presets, cameras, uniform groups and GLSL comments
// out of a copy of the source tree; every one of those cuts is supposed to be unreachable for these looks,
// and "unreachable" is a claim about pixels. So this loads BOTH engines into ONE page — same browser, same
// GL stack, same context settings, frozen motion — and compares the frames byte for byte.
//
//   cd test-gl && node embed.mjs                    (or: nix run .#embed-check [-- <option>...])
//   --bundle <file.js>    which bundle to check. Default: dist/komorebi.embed.min.js.
//   <look>...             check only these looks. Default: every look the bundle carries.
//   --against <file.js>   also render a second bundle (an older deploy) and report how far the look moved,
//                         with a contact sheet in test-gl/out/. This is a look diff, not a pass or a fail.
//
// The bundles are classic scripts that assign window.Komorebi, so each is loaded in turn and its create /
// PRESETS captured before the next overwrites the global. Motion is frozen exactly as harness.html freezes
// it (wind, weather, drift, auto-quality), which is what makes a byte comparison meaningful at all.
// ============================================================================
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(join(ROOT, 'test-gl', 'package.json'));
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : fallback; };
const against = arg('--against', null);
const bundle = arg('--bundle', '/dist/komorebi.embed.min.js').replace(/^\.?\/?/, '/');
const named = argv;                                // no names: check every look the bundle carries
const FRAME = 30;                                  // deep enough that the bake, the grove and the first draw have all happened

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/against.js' && against) {        // the comparison bundle, wherever it lives
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return createReadStream(resolve(against)).pipe(res);
    }
    if (path === '/') {                             // the check page itself — held in memory, never written into the repo
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(PAGE);
    }
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (file !== ROOT && !file.startsWith(`${ROOT}/`)) { res.writeHead(403).end(); return; }
    try { if (!(await stat(file)).isFile()) throw 0; } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>komorebi — embed check</title>
<style>html,body{margin:0;background:#000}canvas.stage{position:absolute;top:0;left:0;width:320px;height:180px}</style>
<body></body>
<script type="module">
// One page, several engines. 'modules' is the raw ES-module engine off the served repo; every other entry is
// a classic-script bundle that assigns window.Komorebi (captured immediately, since the next one overwrites it).
const W = 320, H = 180;
const FREEZE = { wind_strength: 0, weather_variability: 0, drift_auto: false, auto_quality: false };
const engines = {}, caps = new Map();
let nextId = 0;
const mod = await import('/komorebi.js');
engines.modules = { create: mod.create, PRESETS: (await import('/presets.js')).PRESETS };

window.__load = (name, url) => new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = url;
  s.onload = () => {
    if (!window.Komorebi) return fail(new Error(url + ' loaded but set no window.Komorebi'));
    engines[name] = { create: window.Komorebi.create, PRESETS: window.Komorebi.PRESETS };
    ok(Object.keys(window.Komorebi.PRESETS));
  };
  s.onerror = () => fail(new Error('could not load ' + url));
  document.head.appendChild(s);
});
window.__has = (name, look) => !!engines[name]?.PRESETS[look];

function fnv1a(b){ let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); }

// One engine, one look, one frame — captured inside onFrame, which is the only place the drawing buffer of a
// context without preserveDrawingBuffer still holds what was drawn.
window.__capture = (engine, look, frame) => new Promise((resolve, reject) => {
  const E = engines[engine];
  if (!E) return reject(new Error('no engine ' + engine));
  const base = E.PRESETS[look];
  if (!base) return reject(new Error(engine + ' has no look ' + look));
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  document.body.appendChild(canvas);
  let eng = null, ticks = 0, done = false;
  const finish = (err, out) => {
    if (done) return; done = true;
    clearTimeout(timer);
    try { eng?.setPaused?.(true); eng?.dispose?.(); } catch {}
    canvas.remove();
    err ? reject(err) : resolve(out);
  };
  const timer = setTimeout(() => finish(new Error(engine + '/' + look + ' never reached frame ' + frame)), 120000);
  const t0 = performance.now();
  try { eng = E.create(canvas, { params: Object.assign({}, base, FREEZE) }); }
  catch (e) { return finish(e); }
  const gl = eng.gl;
  eng.onFrame = () => {
    if (done || ++ticks < frame) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const w = canvas.width, h = canvas.height;
    const bytes = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    const id = 'c' + nextId++;
    caps.set(id, { w, h, bytes });
    const e = gl.getError();
    finish(e ? new Error(engine + '/' + look + ': gl error ' + e) : null, { id, w, h, hash: fnv1a(bytes), ms: Math.round(performance.now() - t0) });
  };
});

// Exact byte comparison, plus the shape of the difference when there is one (how many pixels moved, and by
// how much) — "not identical" and "a different look" are very different answers.
window.__diff = (a, b) => {
  const A = caps.get(a), B = caps.get(b);
  if (!A || !B) throw new Error('no such capture');
  if (A.w !== B.w || A.h !== B.h) return { equal: false, note: 'different size' };
  let differing = 0, sum = 0, max = 0;
  for (let i = 0; i < A.bytes.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.bytes[i + k] - B.bytes[i + k]));
    if (d) { differing++; sum += d; if (d > max) max = d; }
  }
  const px = A.bytes.length / 4;
  return { equal: differing === 0, differingFrac: differing / px, meanDelta: sum / px, maxDelta: max };
};

// A contact sheet for eyes: captures in order, left to right.
window.__sheet = (ids, cols) => {
  const rows = ids.map((id) => caps.get(id));
  const w = rows[0].w, h = rows[0].h, PAD = 2, r = Math.ceil(rows.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * (w + PAD) + PAD; c.height = r * (h + PAD) + PAD;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, c.width, c.height);
  rows.forEach((cap, i) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(cap.bytes.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    for (let k = 3; k < img.data.length; k += 4) img.data[k] = 255;
    ctx.putImageData(img, PAD + (i % cols) * (w + PAD), PAD + Math.floor(i / cols) * (h + PAD));
  });
  return c.toDataURL('image/png');
};
window.__ready = true;
</script>`;

const { server, port } = await serve();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

let failed = 0, looks = named;
try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready);
  const inBundle = await page.evaluate((u) => window.__load('embed', u), bundle);
  console.log(`${basename(bundle)} carries ${inBundle.length} look(s): ${inBundle.join(', ')}`);
  if (!looks.length) looks = inBundle;
  if (against) {
    const inOld = await page.evaluate(() => window.__load('against', '/against.js'));
    console.log(`${basename(against)} carries ${inOld.length} look(s)`);
  }

  const sheet = [];
  for (const look of looks) {
    const a = await page.evaluate(([l, f]) => window.__capture('modules', l, f), [look, FRAME]);
    const b = await page.evaluate(([l, f]) => window.__capture('embed', l, f), [look, FRAME]);
    const d = await page.evaluate(([x, y]) => window.__diff(x, y), [a.id, b.id]);
    const ok = d.equal && a.hash === b.hash;
    if (!ok) failed++;
    console.log(`${ok ? 'pass' : 'FAIL'}  ${look.padEnd(14)} modules ${a.hash}  embed ${b.hash}${ok ? '' : `   differing ${(100 * d.differingFrac).toFixed(2)}% maxΔ ${d.maxDelta}`}`);
    sheet.push(b.id);
    if (against && await page.evaluate(([l]) => window.__has('against', l), [look])) {
      const c = await page.evaluate(([l, f]) => window.__capture('against', l, f), [look, FRAME]);
      const dd = await page.evaluate(([x, y]) => window.__diff(x, y), [c.id, b.id]);
      console.log(`      ${look.padEnd(14)} vs ${basename(against)}: ${dd.equal ? 'identical' : `${(100 * dd.differingFrac).toFixed(1)}% of pixels differ, mean Δ ${dd.meanDelta.toFixed(1)}/255, max Δ ${dd.maxDelta}`}`);
      sheet.push(c.id);
    }
  }
  if (against && sheet.length) {
    const url = await page.evaluate(([ids, cols]) => window.__sheet(ids, cols), [sheet, 2]);
    await mkdir(join(ROOT, 'test-gl', 'out'), { recursive: true });
    const file = join(ROOT, 'test-gl', 'out', 'embed-vs-against.png');
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`\ncontact sheet (left: this embed, right: ${basename(against)})  ${file}`);
  }
} catch (e) {
  failed++;
  console.log(`FAIL  ${e.message.split('\n')[0]}`);
}
if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(`  ${e}`); }
console.log(`\n${looks.length} look(s), ${failed ? `${failed} FAILED` : 'all byte-identical to the raw engine'}${errors.length ? `, ${errors.length} page errors` : ''}`);
await browser.close();
server.close();
process.exit(failed || errors.length ? 1 : 0);
