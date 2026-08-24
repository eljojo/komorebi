// ============================================================================
// editor.mjs — the EDITOR smoke: drive index.html's mode ladder + macro bus in
// headless Chromium (same SwiftShader stack as run.js) and assert the
// observable DOM effects. The advanced sliders mirror every macro write, so
// params are checkable without reaching module scope; page errors are recorded
// with the check they landed after. This is where UI-only regressions live —
// the kind bun test and the pixel suites structurally cannot see (a CSS
// cascade once kept the zen strip painted through the intro while every
// class-based assertion passed).
//
//   cd test-gl && node editor.mjs        (or: nix run .#editor)
//
// Not byte-stable and not meant to be: it asserts BEHAVIOR (modes, gates,
// proximity, persistence), with polls where SwiftShader's long frames make
// single-shot event timing a coin toss.
// ============================================================================
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));   // the repo root — what gets served
const require = createRequire(join(ROOT, 'test-gl', 'package.json'));
const { chromium } = require('playwright');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
function serveRoot() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, ''));
    if (file !== ROOT && !file.startsWith(`${ROOT}/`)) { res.writeHead(403).end(); return; }
    try { if (!(await stat(file)).isFile()) throw 0; } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const { server, port } = await serveRoot();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });   // small: SwiftShader frames must stay well under the event-timing windows
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(`[after check ${results.length}] ${e.message}\n    ${(e.stack || '').split('\n').slice(1, 4).join('\n    ')}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[after check ${results.length}] console: ${m.text()}`); });

const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok, detail]); console.log(`    `); };

try {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  // the intro owns the screen: no surface may appear before "feel", even via the D key
  await page.keyboard.press('d');
  await page.mouse.move(450, 600);
  await page.waitForTimeout(300);
  const introClean = await page.evaluate(() => ['dev', 'play', 'strip'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none'));
  check('intro hides every surface (D key included)', introClean);
  await page.click('#feel');
  await page.waitForSelector('#strip:not(.hidden)', { timeout: 60000 });   // arrive() waits out the full welcome crossfade (slower under SwiftShader)
  check('boot lands in zen everywhere', true);
  await page.$eval('#strip .preset .more', (b) => b.click());              // climb to playful for the macro checks
  await page.waitForSelector('#play:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(800);   // let the slide-in transition land before pointer work
  check('+ climbs to the playful sidebar', await page.$eval('#strip', (e) => getComputedStyle(e).display === 'none'));
  // settle: a hard preset re-apply aborts the (long, SwiftShader-stretched) welcome crossfade via setParams,
  // so everything after runs on a quiet engine
  await page.evaluate(() => { const s = [...document.querySelectorAll('#play select')].pop(); s.value = 'afternoon 7'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1200);
  check('key hints hidden by default', await page.$eval('#hint', (h) => h.classList.contains('gone')));

  // advanced sliders exist in the (hidden) dev panel and mirror macro writes
  const cloudVal = () => page.$eval('#dev', (dev) => {
    const rows = [...dev.querySelectorAll('.ctl')];
    const row = rows.find((r) => r.querySelector('label')?.textContent === 'CLOUD');
    return row.querySelector('input').value;
  });

  // preset filter: default hides the 8 experimental looks (23 built-ins -> 15)
  const optCount = () => page.$eval('#dev select', (s) => [...s.options].filter((o) => !o.textContent.startsWith('★ ')).length);
  const n0 = await optCount();
  check('experimental looks hidden by default', n0 === 15, `built-ins listed: ${n0}`);

  // the playful weather macro drives cloud_thickness (visible in the advanced slider)
  await page.$eval('#play', (el) => {
    const rows = [...el.querySelectorAll('.ctl')];
    const row = rows.find((r) => r.querySelector('label')?.textContent === 'weather');
    const inp = row.querySelector('input');
    inp.value = '1';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const cv = await cloudVal();
  check('weather macro writes cloud_thickness', Math.abs(parseFloat(cv) - 0.55) < 1e-6, `cloud slider now ${cv}`);

  // the wind pad writes strength + pattern
  const windVal = () => page.$eval('#dev', (dev) => {
    const rows = [...dev.querySelectorAll('.ctl')];
    const row = rows.find((r) => r.querySelector('label')?.textContent === 'strength');
    return row.querySelector('input').value;
  });
  const pad = await page.$('#play .pad');
  const box = await pad.boundingBox();
  let wv = '';
  for (let tries = 0; tries < 5; tries++) {   // input dispatch is main-thread; a long GL frame can swallow a single click
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1);   // top-right: strong + squally
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(800);
    wv = await windVal();
    if (parseFloat(wv) > 1.5) break;
  }
  check('wind pad writes wind_strength', parseFloat(wv) > 1.5, `strength now ${wv}`);

  // season macro (on release) regrows without error
  await page.$eval('#play', (el) => {
    const rows = [...el.querySelectorAll('.ctl')];
    const row = rows.find((r) => r.querySelector('label')?.textContent === 'season');
    const inp = row.querySelector('input');
    inp.value = '0';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dens = await page.$eval('#dev', (dev) => {
    const rows = [...dev.querySelectorAll('.ctl')];
    return rows.find((r) => r.querySelector('label')?.textContent === 'density').querySelector('input').value;
  });
  check('season macro (release) regrows to sparse spring', Math.abs(parseFloat(dens) - 0.45) < 1e-6, `density ${dens}`);

  // experimental toggle doubles the list
  await page.$eval('#play', (el) => {
    const rows = [...el.querySelectorAll('.ctl.toggle')];
    const row = rows.find((r) => r.querySelector('label')?.textContent.startsWith('experimental looks'));
    row.querySelector('input').click();
  });
  const n1 = await optCount();
  check('experimental toggle reveals all looks', n1 === 23, `built-ins listed: ${n1}`);

  // the playful dropdown jumps straight to a look and marks beta ones with a distinct glyph
  const betaMarks = await page.evaluate(() => { const s = [...document.querySelectorAll('#play select')].pop(); return [...s.options].filter((o) => o.textContent.startsWith('\u25e6 ')).length; });
  check('beta looks carry their own marker in the list', betaMarks === 8, `\u25e6 options: ${betaMarks}`);
  await page.evaluate(() => { const s = [...document.querySelectorAll('#play select')].pop(); s.value = 'memories'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  const devSync = await page.$eval('#dev select', (s) => s.value);
  check('playful dropdown jumps and the dev select follows', devSync === 'memories', `dev shows ${devSync}`);

  // gated macros grey out on a non-floor look and wake on a floor one
  await page.evaluate(() => { const s = [...document.querySelectorAll('#play select')].pop(); s.value = 'canopy 1'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  const gates = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#play .ctl')];
    const state = (lbl) => { const r = rows.find((q) => q.querySelector('label')?.textContent === lbl); return r.querySelector('input').disabled; };
    return { haze: state('haze'), weather: state('weather') };
  });
  check('haze gates off on the sky look, weather stays live', gates.haze === true && gates.weather === false, JSON.stringify(gates));
  await page.evaluate(() => { const s = [...document.querySelectorAll('#play select')].pop(); s.value = 'memories'; s.dispatchEvent(new Event('change', { bubbles: true })); });

  // preset stepper advances and the name label follows
  const name0 = await page.$eval('#play .preset .name', (e) => e.textContent);
  await page.$eval('#play .preset button:nth-child(2)', (b) => b.click());   // the arrows sit together now: [‹][›][name]
  await page.waitForTimeout(400);
  const name1 = await page.$eval('#play .preset .name', (e) => e.textContent);
  check('preset stepper steps', name1 !== name0, `${name0} -> ${name1}`);

  // the ladder: advanced, back to playful, down to zen
  await page.$eval('#dev', () => {});
  await page.evaluate(() => [...document.querySelectorAll('#play .modes button')].find((b) => b.textContent.includes('advanced')).click());
  await page.waitForSelector('#dev:not(.hidden)');
  check('ladder: playful -> advanced', await page.$eval('#play', (e) => e.classList.contains('hidden')));

  // INERT ROWS: the advanced panel hides the knobs the current camera never reads (§4.9), and an emptied
  // section takes its heading with it. Computed style, not the property — the point is that the CSS lands.
  const rowShown = (lbl) => page.evaluate((l) => {
    const r = [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === l);
    return r ? getComputedStyle(r).display !== 'none' : null;
  }, lbl);
  const setReceiver = (v) => page.evaluate((val) => {
    const r = [...document.querySelectorAll('#dev .ctl.select')].find((q) => q.querySelector('label')?.textContent === 'receiver');
    const s = r.querySelector('select'); s.value = String(val); s.dispatchEvent(new Event('change', { bubbles: true }));
  }, v);
  const headShown = (txt) => page.evaluate((t) => {
    const h = [...document.querySelectorAll('#dev h2')].find((q) => q.textContent === t);
    return h ? getComputedStyle(h).display !== 'none' : null;
  }, txt);
  check('the floor look shows the ground and hides the cloth', (await rowShown('ground R')) && !(await rowShown('fabric Tt')));
  await setReceiver(1);                                             // curtain: no floor albedo, no ray camera, but a fabric
  let curtain = false;                                              // the gate pass rides onFrame — SwiftShader frames are long, and the camera swap compiles a new program
  for (let i = 0; i < 30 && !curtain; i++) { await page.waitForTimeout(400); curtain = !(await rowShown('ground R')) && !(await rowShown('tilt \u00b0')) && (await rowShown('fabric Tt')); }
  check('curtain hides the floor-only knobs and shows the fabric', curtain);
  check('an emptied section takes its heading with it', (await headShown('Background')) === false);
  await setReceiver(0);
  let floor = false;
  for (let i = 0; i < 30 && !floor; i++) { await page.waitForTimeout(400); floor = (await rowShown('ground R')) && !(await rowShown('fabric Tt')); }
  check('back on the floor the ground returns and the cloth goes', floor);
  await page.evaluate(() => [...document.querySelectorAll('#dev .ctl button')].find((b) => b.textContent.includes('playful')).click());
  await page.waitForSelector('#play:not(.hidden)');
  check('ladder: advanced -> playful', await page.$eval('#dev', (e) => e.classList.contains('hidden')));
  await page.evaluate(() => [...document.querySelectorAll('#dev .ctl button')].find((b) => b.textContent.includes('playful')).click());
  await page.waitForSelector('#play:not(.hidden)');
  check('strip painted gone while in playful', await page.$eval('#strip', (e) => getComputedStyle(e).display === 'none'));
  await page.evaluate(() => [...document.querySelectorAll('#play .modes button')].find((b) => b.textContent.includes('zen')).click());
  await page.waitForSelector('#strip:not(.hidden)');
  await page.waitForTimeout(700);
  check('ladder: playful -> zen strip', true);
  // the + rides the preset row without overlapping the next-preset button
  const overlap = await page.evaluate(() => {
    const more = document.querySelector('#strip .preset .more');
    const btns = [...document.querySelectorAll('#strip .preset button')].filter((b) => b !== more);
    const m = more.getBoundingClientRect();
    return btns.some((b) => { const r = b.getBoundingClientRect();
      return m.left < r.right && r.left < m.right && m.top < r.bottom && r.top < m.bottom; });
  });
  check('zen + button clear of the stepper', !overlap);
  const rowOrder = await page.$eval('#strip .preset', (r) => [...r.children].map((c) => c.classList.contains('name') ? 'name' : c.classList.contains('more') ? 'plus' : c.textContent).join(' '));
  check('zen arrows sit together before the title', rowOrder === '\u2039 \u203a name plus', rowOrder);

  // desktop zen: one horizontal bar, shown by cursor proximity
  const wide = await page.$eval('#strip', (e) => e.classList.contains('wide') && getComputedStyle(e).display === 'flex');
  const stripH = await page.$eval('#strip', (e) => e.offsetHeight);
  check('desktop strip is one horizontal bar', wide && stripH < 70, `flex=${wide} h=${stripH}px`);

  // after the arrival hold, moving the cursor far fades it; coming near revives it
  await page.waitForTimeout(2700);                                  // outlast STRIP_HOLD_MS
  await page.mouse.move(320, 100);                                  // far from the bottom bar
  await page.waitForTimeout(200);
  check('strip fades when the cursor leaves its area', await page.$eval('#strip', (e) => e.classList.contains('faded')));
  const sb = await page.$eval('#strip', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(sb.x, sb.y - 80);                           // near (within the proximity margin)
  await page.waitForTimeout(1500);                                  // pointermove dispatch is rAF-aligned — slow SwiftShader frames need room
  check('strip appears when the cursor comes near', await page.$eval('#strip', (e) => !e.classList.contains('faded')));
  await page.mouse.move(sb.x, sb.y);                                // hovering it: stays
  await page.waitForTimeout(3000);
  await page.mouse.move(sb.x + 2, sb.y);
  check('strip holds while hovered', await page.$eval('#strip', (e) => !e.classList.contains('faded')));
  await page.mouse.move(320, 100);
  await page.waitForTimeout(200);
  check('strip retires again on leave', await page.$eval('#strip', (e) => e.classList.contains('faded')));
  await page.mouse.move(sb.x, sb.y - 80);                           // near again: visible...
  await page.waitForTimeout(300);
  let stillFaded = false;                                           // poll: coalesced pointer events can land late under load
  for (let i = 0; i < 15 && !stillFaded; i++) { await page.waitForTimeout(1000); stillFaded = await page.$eval('#strip', (e) => e.classList.contains('faded')); }
  check('a still cursor retires the strip too', stillFaded);

  // D in zen speaks proximity: fade-toggle, never display-toggle (which would strand the pointer machinery)
  await page.mouse.move(sb.x, sb.y); await page.mouse.move(sb.x + 1, sb.y);   // wake it deterministically first
  await page.waitForTimeout(800);
  await page.keyboard.press('d');
  await page.waitForTimeout(900);
  check('D fades the visible strip', await page.$eval('#strip', (e) => e.classList.contains('faded') && getComputedStyle(e).display !== 'none'));
  await page.keyboard.press('d');
  await page.waitForTimeout(900);
  check('D wakes it again (hover-equivalent)', await page.$eval('#strip', (e) => !e.classList.contains('faded')));

  // the key hints retire on a timer; H resurfaces them
  await page.$eval('#hint', (h) => h.classList.add('gone'));        // stand in for the 30 s retire
  await page.keyboard.press('h');
  check('H resurfaces the key hints', await page.$eval('#hint', (h) => !h.classList.contains('gone')));
  await page.$eval('#hint', (h) => h.classList.add('gone'));
  await page.keyboard.press('x');
  check('any unmapped key resurfaces them too', await page.$eval('#hint', (h) => !h.classList.contains('gone')));

  // reload holds the mode (persistence)
  await page.reload({ waitUntil: 'load' });
  await page.click('#feel');
  await page.waitForSelector('#strip:not(.hidden)', { timeout: 60000 });
  check('mode persists across reload (zen)', true);
} catch (e) {
  check('smoke run', false, e.message.split('\n')[0]);
}

if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(`  ${e}`); }
const failed = results.filter(([, ok]) => !ok).length + (errors.length ? 1 : 0);
console.log(`\n${results.length} checks, ${failed ? `${failed} FAILED` : 'all pass'}${errors.length ? `, ${errors.length} page errors` : ', no page errors'}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
