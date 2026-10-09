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
import { makeGrove } from '../komorebi-grove.js';
import { DEFAULTS, migrateLegacy } from '../komorebi-params.js';
import { EXPERIMENTAL, PRESETS } from '../presets.js';

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

// What a look hangs, counted off the grove the engine's own code builds for it (over a stub GL): how many clusters it has and how many leaves hang on each. The leaves are
// the instance buffers' own count, not leaves_per_cluster × foliage_density: the held leaf's [ / ] must walk exactly these, and an oracle that restated the formula would agree
// with a preview that restated it too. phenology 0 so no leaf has let go.
function hungBy(look) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === 'createBuffer') return () => ({ data: null });
      if (name === 'bindBuffer') return (_, b) => { t.cur = b; };
      if (name === 'bufferData') return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = { ...DEFAULTS, ...migrateLegacy(PRESETS[look]), phenology: 0 };
  const hub = { gl, params, MAX_TEX: 8192, quadBuf: {}, faithfulOn: () => false, occ: {}, faith: {}, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  const clusters = g.hier.twigs.length;
  return { clusters, perCluster: g.layerVAO.reduce((s, L) => s + L.count, 0) / clusters };
}
// the shipped look at this foliage density that hangs the fewest clusters (the walk is the cost of the check)
function lookAtDensity(density) {
  const rows = Object.keys(PRESETS).filter((n) => !EXPERIMENTAL.includes(n) && PRESETS[n].foliage_density === density).map((name) => ({ name, ...hungBy(name) }));
  return rows.sort((a, b) => a.clusters - b.clusters)[0];
}

const { server, port } = await serveRoot();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });   // small: SwiftShader frames must stay well under the event-timing windows
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(`[after check ${results.length}] ${e.message}\n    ${(e.stack || '').split('\n').slice(1, 4).join('\n    ')}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[after check ${results.length}] console: ${m.text()}`); });

const results = [];
const check = (name, ok, detail = '') => { results.push([name, ok, detail]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`); };

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

  // preset filter: default hides every experimental look
  const optCount = () => page.$eval('#dev select', (s) => [...s.options].filter((o) => !o.textContent.startsWith('★ ')).length);
  const n0 = await optCount();
  check('experimental looks hidden by default', n0 === Object.keys(PRESETS).length - EXPERIMENTAL.length, `built-ins listed: ${n0}`);

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

  // season macro: the slider is a TARGET the bus eases toward on the frame clock (no snap, no transition, no error)
  const densNow = () => page.$eval('#dev', (dev) => {
    const rows = [...dev.querySelectorAll('.ctl')];
    return parseFloat(rows.find((r) => r.querySelector('label')?.textContent === 'density').querySelector('input').value);
  });
  const dens0 = await densNow();
  await page.$eval('#play', (el) => {
    const rows = [...el.querySelectorAll('.ctl')];
    const row = rows.find((r) => r.querySelector('label')?.textContent === 'season');
    const inp = row.querySelector('input');
    inp.value = '0';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const densRight = await densNow();
  check('season macro tweens: right after the input the density has not snapped', Math.abs(densRight - 0.45) > 1e-6 && Math.abs(densRight - dens0) < 0.5, `density ${dens0} -> ${densRight} (target 0.45)`);
  // the ease advances at most 0.1 s of clock per frame (a slept tab must not jump it), and SwiftShader frames are long: wait out the frames, not the seconds
  let dens = await densNow();
  for (let tries = 0; tries < 240 && Math.abs(dens - 0.45) > 1e-6; tries++) { await page.waitForTimeout(500); dens = await densNow(); }
  check('season macro (input) tweens to sparse spring', Math.abs(dens - 0.45) < 1e-6, `density ${dens}`);

  // experimental toggle reveals every built-in look
  await page.$eval('#play', (el) => {
    const rows = [...el.querySelectorAll('.ctl.toggle')];
    const row = rows.find((r) => r.querySelector('label')?.textContent.startsWith('experimental looks'));
    row.querySelector('input').click();
  });
  const n1 = await optCount();
  check('experimental toggle reveals all looks', n1 === Object.keys(PRESETS).length, `built-ins listed: ${n1}`);

  // the playful dropdown jumps straight to a look and marks beta ones with a distinct glyph
  const betaMarks = await page.evaluate(() => { const s = [...document.querySelectorAll('#play select')].pop(); return [...s.options].filter((o) => o.textContent.startsWith('\u25e6 ')).length; });
  check('beta looks carry their own marker in the list', betaMarks === EXPERIMENTAL.length, `\u25e6 options: ${betaMarks}`);
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
  // SENESCENCE ROWS (§4.5): the season row is always there; the pigment rows hang off it. At summer (phenology under
  // turn_start) no leaf has begun to turn, so capacity, vein share and the turn clock are sliders that lie — hidden
  // until the season passes the threshold, and gone again when it returns.
  const setSeason = (v) => page.evaluate((val) => {
    const r = [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === 'phenology');
    const i = r.querySelector('input'); i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  const PIGMENT_ROWS = ['anthocyanin', 'tannin', 'vein share', 'sun first', 'early trees', 'tree pigment'];
  const pigmentShown = async () => (await Promise.all(PIGMENT_ROWS.map(rowShown)));
  check('the season row is there and the pigment rows hide at summer', (await rowShown('phenology')) === true && (await pigmentShown()).every((v) => v === false), `${await rowShown('phenology')} ${await pigmentShown()}`);
  await setSeason(0.8);
  let turning = false;
  for (let i = 0; i < 30 && !turning; i++) { await page.waitForTimeout(400); turning = (await pigmentShown()).every((v) => v === true); }
  check('past turn_start the pigment rows appear', turning, `${await pigmentShown()}`);
  await setSeason(0.5);
  let summer = false;
  for (let i = 0; i < 30 && !summer; i++) { await page.waitForTimeout(400); summer = (await pigmentShown()).every((v) => v === false); }
  check('and go again when the season comes back', summer, `${await pigmentShown()}`);
  // ABSOLUTE LIGHT (§4.5) chooses what the exposure order is made of, so it needs the season past the turn AND an order to choose for:
  // sun first up, or (below) leaves falling by the light. Turning alone (the look under test ships sun first at 0 and leaf fall at 0) leaves none.
  const setSunFirst = (val) => page.evaluate((v) => {
    const r = [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === 'sun first');
    const i = r.querySelector('input'); i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true }));
  }, val);
  await setSeason(0.8);
  let sunRow = false;
  for (let i = 0; i < 30 && !sunRow; i++) { await page.waitForTimeout(400); sunRow = (await rowShown('sun first')) === true; }
  check('turning with sun first at 0: sun first is there, absolute light is not', sunRow && (await rowShown('absolute light')) === false, `${await rowShown('sun first')} ${await rowShown('absolute light')}`);
  await setSunFirst(0.5);
  let absRow = false;
  for (let i = 0; i < 30 && !absRow; i++) { await page.waitForTimeout(400); absRow = (await rowShown('absolute light')) === true; }
  check('raise sun first and absolute light appears', absRow, `${await rowShown('absolute light')}`);
  await setSeason(0.5);
  let absGone = false;
  for (let i = 0; i < 30 && !absGone; i++) { await page.waitForTimeout(400); absGone = (await rowShown('absolute light')) === false; }
  check('back at summer it goes again, whatever sun first says', absGone && (await rowShown('sun first')) === false, `${await rowShown('absolute light')} ${await rowShown('sun first')}`);
  await setSunFirst(0);
  // LEAF FALL (§4.5, abscission) is the gate of its own family and sits behind the same season as the pigments: before a leaf can be turning
  // none is about to fall, so the row hides at summer. Its followers (what order, when, how long) are sliders that lie while leaf fall is 0 —
  // nothing drops — so they hide until it is up, and go again with it.
  const setSlider = (label, v) => page.evaluate(([lab, val]) => {
    const r = [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === lab);
    const i = r.querySelector('input'); i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true }));
  }, [label, v]);
  // THE REACH (§4.5, early trees): the earliest tree begins up to its reach sooner, so the season rows open by it — with early trees at 0.15 the pigment rows are there at phenology 0.5 (0.5 > 0.6 − 0.15), and
  // shut again with it. (The row itself waits for the season like the pigments, so it is raised from a turning one first.)
  await setSeason(0.8);
  let reachRows = false;
  for (let i = 0; i < 30 && !reachRows; i++) { await page.waitForTimeout(400); reachRows = (await pigmentShown()).every((v) => v === true); }
  await setSlider('early trees', 0.15);
  await setSeason(0.5);
  let reached = false;
  for (let i = 0; i < 30 && !reached; i++) { await page.waitForTimeout(400); reached = (await pigmentShown()).every((v) => v === true); }
  check('early trees 0.15 opens the pigment rows at summer (the earliest tree is already turning)', reachRows && reached, `${reachRows} ${await pigmentShown()}`);
  await setSlider('early trees', 0);
  let reachShut = false;
  for (let i = 0; i < 30 && !reachShut; i++) { await page.waitForTimeout(400); reachShut = (await pigmentShown()).every((v) => v === false); }
  check('and early trees back at 0 shuts them with the summer', reachShut, `${await pigmentShown()}`);
  const DROP_FOLLOWERS = ['sun falls first', 'fall start', 'fall span', 'after its turn'];   // 'fall lag' is not one: it waits for 'after its turn' as well
  const followersShown = async () => Promise.all(DROP_FOLLOWERS.map(rowShown));
  check('at summer leaf fall and its followers are hidden', (await rowShown('leaf fall')) === false && (await followersShown()).every((v) => v === false), `${await rowShown('leaf fall')} ${await followersShown()}`);
  await setSeason(0.8);
  let fallRow = false;
  for (let i = 0; i < 30 && !fallRow; i++) { await page.waitForTimeout(400); fallRow = (await rowShown('leaf fall')) === true; }
  check('past the turn leaf fall is there, its followers are not (it ships at 0)', fallRow && (await followersShown()).every((v) => v === false), `${await rowShown('leaf fall')} ${await followersShown()}`);
  await setSlider('leaf fall', 0.5);
  let followers = false;
  for (let i = 0; i < 30 && !followers; i++) { await page.waitForTimeout(400); followers = (await followersShown()).every((v) => v === true); }
  check('raise leaf fall and sun falls first, fall start and fall span appear', followers, `${await followersShown()}`);
  // ABSOLUTE LIGHT reads the fall's order too: leaves letting go by the light (sun falls first ships at 1) is an order for it to choose the make of, sun first at 0 or not
  let absFall = false;
  for (let i = 0; i < 30 && !absFall; i++) { await page.waitForTimeout(400); absFall = (await rowShown('absolute light')) === true; }
  check('leaves falling by the light: absolute light shows with sun first at 0', absFall, `${await rowShown('absolute light')}`);
  // AFTER ITS TURN: with it on the day is the turn's end plus the lag, so fall start, fall span and sun falls first are not read and hide; the lag appears.
  // A select like litter (a 0/1 TOPO key: a checkbox's boolean would never equal a preset's 0)
  const setSelect = (label, v) => page.evaluate(([lab, val]) => {
    const r = [...document.querySelectorAll('#dev .ctl.select')].find((q) => q.querySelector('label')?.textContent === lab);
    const sel = r.querySelector('select'); sel.value = String(val); sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, v]);
  check('fall lag waits for after its turn', (await rowShown('fall lag')) === false, `${await rowShown('fall lag')}`);
  await setSelect('after its turn', 1);
  let afterOn = false;
  for (let i = 0; i < 30 && !afterOn; i++) { await page.waitForTimeout(400); afterOn = (await rowShown('fall lag')) === true; }
  check('after its turn: fall lag appears, fall start / span / sun falls first go', afterOn && (await Promise.all(['sun falls first', 'fall start', 'fall span'].map(rowShown))).every((v) => v === false), `${await rowShown('fall lag')} ${await Promise.all(['sun falls first', 'fall start', 'fall span'].map(rowShown))}`);
  check('after its turn the fall reads no exposure order, so with sun first at 0 absolute light goes', (await rowShown('absolute light')) === false, `${await rowShown('absolute light')}`);
  await setSelect('after its turn', 0);
  let afterOff = false;
  for (let i = 0; i < 30 && !afterOff; i++) { await page.waitForTimeout(400); afterOff = (await rowShown('fall lag')) === false && (await rowShown('fall start')) === true; }
  check('and back off: the old three return, the lag goes', afterOff, `${await rowShown('fall lag')} ${await rowShown('fall start')}`);
  await setSlider('leaf fall', 0);
  let followersGone = false;
  for (let i = 0; i < 30 && !followersGone; i++) { await page.waitForTimeout(400); followersGone = (await followersShown()).every((v) => v === false); }
  check('and go with it when it returns to 0', followersGone && (await rowShown('leaf fall')) === true, `${await followersShown()} ${await rowShown('leaf fall')}`);
  await setSeason(0.5);
  let fallGone = false;
  for (let i = 0; i < 30 && !fallGone; i++) { await page.waitForTimeout(400); fallGone = (await rowShown('leaf fall')) === false; }
  check('back at summer leaf fall goes too', fallGone, `${await rowShown('leaf fall')}`);
  // THE LITTER ROWS (§4.7). `litter` is the carpet's own gate beside leaf fall: the leaves it lays are the ones leaf fall lets go of, so it hides at summer and
  // while leaf fall is 0; its followers (how it browns, how far the season's wind carries it, how big its texture is) are sliders on a bake that does not run
  // while it is off, so they hide until it is on. Only the floor has leaves to lie on: on the curtain there is none of the four.
  const LITTER_FOLLOWERS = ['browns over', 'carried', 'wet', 'litter res'];
  const litterFollowers = async () => Promise.all(LITTER_FOLLOWERS.map(rowShown));
  const poll = async (f) => { let ok = false; for (let i = 0; i < 30 && !ok; i++) { await page.waitForTimeout(400); ok = await f(); } return ok; };
  check('at summer litter and its followers are hidden', (await rowShown('litter')) === false && (await litterFollowers()).every((v) => v === false), `${await rowShown('litter')} ${await litterFollowers()}`);
  await setSeason(0.8);
  await poll(async () => (await rowShown('leaf fall')) === true);
  check('past the turn, with leaf fall at 0, there is still nothing to lay: litter stays hidden', (await rowShown('leaf fall')) === true && (await rowShown('litter')) === false && (await litterFollowers()).every((v) => v === false), `${await rowShown('litter')} ${await litterFollowers()}`);
  await setSlider('leaf fall', 0.5);
  check('raise leaf fall and litter appears, its followers not (it ships off)', await poll(async () => (await rowShown('litter')) === true) && (await litterFollowers()).every((v) => v === false), `${await rowShown('litter')} ${await litterFollowers()}`);
  await setSelect('litter', 1);
  check('turn litter on and the browning, the drift and the texture size appear', await poll(async () => (await litterFollowers()).every((v) => v === true)), `${await litterFollowers()}`);
  await setReceiver(1);
  check('on the curtain — which has no floor to lay leaves on — none of the four is there', await poll(async () => (await rowShown('litter')) === false && (await litterFollowers()).every((v) => v === false)), `${await rowShown('litter')} ${await litterFollowers()}`);
  await setReceiver(0);
  check('back on the floor the four return', await poll(async () => (await rowShown('litter')) === true && (await litterFollowers()).every((v) => v === true)), `${await rowShown('litter')} ${await litterFollowers()}`);
  await setSelect('litter', 0);
  check('litter off takes its followers with it', await poll(async () => (await litterFollowers()).every((v) => v === false)) && (await rowShown('litter')) === true, `${await litterFollowers()} ${await rowShown('litter')}`);
  await setSlider('leaf fall', 0);
  check('and with leaf fall back at 0 litter goes too', await poll(async () => (await rowShown('litter')) === false), `${await rowShown('litter')}`);
  await setSeason(0.5);
  await poll(async () => (await rowShown('leaf fall')) === false);
  // THE LEAF'S OUTLINE (§4.5, P4a-2). The species picker merges a bundle over the live look, and every bundle names its outline — the maple's is 'maple', every other 'ellipse' — so the
  // 'leaf shape' select follows the pick both ways: a maple -> oak pick has to take the lobes off, or the oak is lobed.
  const selVal = (label) => page.evaluate((lab) => { const r = [...document.querySelectorAll('#dev .ctl.select')].find((q) => q.querySelector('label')?.textContent === lab); return r.querySelector('select').value; }, label);
  check("the leaf shape row is there and reads the look's own outline: ellipse", (await rowShown('leaf shape')) === true && (await selVal('leaf shape')) === 'ellipse', `${await rowShown('leaf shape')} ${await selVal('leaf shape')}`);
  await setSelect('species', 'maple');
  check("picking maple in the species select turns 'leaf shape' to maple", await poll(async () => (await selVal('leaf shape')) === 'maple'), `reads ${await selVal('leaf shape')}`);
  await setSelect('species', 'oak');
  check("picking oak takes the lobes off: 'leaf shape' reads ellipse", await poll(async () => (await selVal('leaf shape')) === 'ellipse'), `reads ${await selVal('leaf shape')}`);
  await setSelect('species', 'maple');
  await poll(async () => (await selVal('leaf shape')) === 'maple');
  await setSelect('leaf shape', 'ellipse');
  check("changing the outline by hand is a divergence from the picked species: the picker drops back to custom", await poll(async () => (await selVal('species')) === ''), `species reads '${await selVal('species')}'`);
  // THE SKY FILL ROWS (§4.7): canopy_fill is the gate and sits on every camera that lights a surface; its three followers
  // (the leaf albedo, the ray count, the texture size) are sliders that lie while it is shut — nothing bakes — so they hide
  // until it opens. The albedo is the floor's alone (the cloth and the tent take Tsky only), and the sky view, which has
  // no surface to light, has none of the four.
  const setFill = (v) => page.evaluate((val) => {
    const r = [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === 'canopy fill');
    const i = r.querySelector('input'); i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  // A LIVE TRANSITION OWNS THE MORPH KEYS: the stepper above started one (SwiftShader stretches it), and every frame of it
  // writes params.canopy_fill back to the look's own value. The pigment rows never noticed — their knobs are canopy keys,
  // morphed only on a grove morph — so settle first, the way the top of this file does: a hard preset apply aborts it.
  await page.$eval('#dev select', (sel) => { sel.value = 'afternoon 7'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1500);
  const FILL_ROWS = ['leaf scatter', 'fill rays', 'fill res'];
  const fillShown = async () => (await Promise.all(FILL_ROWS.map(rowShown)));
  check('the fill gate is there and its three followers hide while it is shut', (await rowShown('canopy fill')) === true && (await fillShown()).every((v) => v === false), `${await rowShown('canopy fill')} ${await fillShown()}`);
  await setFill(0.6);
  let fillOpen = false;
  for (let i = 0; i < 30 && !fillOpen; i++) { await page.waitForTimeout(400); fillOpen = (await fillShown()).every((v) => v === true); }
  check('opening canopy_fill brings its followers', fillOpen, `${await fillShown()}`);
  // A LEAF IS NOT A WINDOW (§4.5): leaf_diffuse measures the light the P0b albedo guessed at, so above 0 the albedo slider would lie
  // and goes; at 0 it is back. The knob rides the cast cameras' tap group and the sky view's own group (below).
  const setSplit = (v) => page.evaluate((val) => {
    const r = [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === 'leaf diffuse');
    const i = r.querySelector('input'); i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  check('the leaf diffuse row is there on the floor, beside a leaf scatter that still works', (await rowShown('leaf diffuse')) === true && (await rowShown('leaf scatter')) === true, `${await rowShown('leaf diffuse')} ${await rowShown('leaf scatter')}`);
  check('the edge area row is shown at leaf diffuse 0', (await rowShown('edge area')) === true, `${await rowShown('edge area')}`);
  await setSplit(0.7);
  let scatterGone = false;
  for (let i = 0; i < 30 && !scatterGone; i++) { await page.waitForTimeout(400); scatterGone = (await rowShown('leaf scatter')) === false && (await rowShown('leaf diffuse')) === true; }
  check('leaf diffuse above 0 retires the albedo slider it replaces', scatterGone, `${await rowShown('leaf scatter')} ${await rowShown('leaf diffuse')}`);
  check('...and edge area, whose job every texel already does above 0', (await rowShown('edge area')) === false, `${await rowShown('edge area')}`);
  await setSplit(0);
  let scatterBack = false;
  for (let i = 0; i < 30 && !scatterBack; i++) { await page.waitForTimeout(400); scatterBack = (await rowShown('leaf scatter')) === true; }
  check('and at 0 the albedo is back', scatterBack, `${await rowShown('leaf scatter')}`);
  check('...and edge area is back with it', (await rowShown('edge area')) === true, `${await rowShown('edge area')}`);
  await setReceiver(1);                                             // the curtain takes Tsky alone: the albedo is a slider that lies there
  let clothFill = false;
  for (let i = 0; i < 30 && !clothFill; i++) { await page.waitForTimeout(400); clothFill = !(await rowShown('leaf scatter')) && (await rowShown('fill rays')) && (await rowShown('canopy fill')); }
  check('on the curtain the leaf albedo goes but the gate and the fill itself stay', clothFill, `${await rowShown('leaf scatter')} ${await rowShown('fill rays')} ${await rowShown('canopy fill')}`);
  // THE SUN'S COSINE LAW (§3.5): the beam lands on the cloth by its own incidence, so the row is there on the curtain as it is on the floor; the sky view's factor is always 1, so it has no row there
  check('the cosine row is there on the curtain (the cloth takes its own incidence)', (await rowShown('cosine')) === true, `${await rowShown('cosine')}`);
  await setReceiver(0);
  await page.evaluate(() => { const r = [...document.querySelectorAll('#dev .ctl.toggle')].find((q) => q.querySelector('label')?.textContent === 'look up'); r.querySelector('input').click(); });
  let skyFill = false;                                              // the sky camera speaks no fill group: all four rows go
  for (let i = 0; i < 40 && !skyFill; i++) { await page.waitForTimeout(400); skyFill = !(await rowShown('canopy fill')) && (await fillShown()).every((v) => v === false); }
  check('the sky view has none of the four fill rows', skyFill, `${await rowShown('canopy fill')} ${await fillShown()}`);
  check('the sky view never reads sun_cosine: radiance is invariant, so its row is hidden', (await rowShown('cosine')) === false, `${await rowShown('cosine')}`);
  // THE LEAF IS A LANTERN (§4.9): the look-up view reads the split through its own group, so the row is there, and above 0 the authored
  // foliage glow is the proxy it replaces (the sky view's twin of the floor's leaf scatter) and goes; at 0 it is back.
  check('the sky view reads the split: leaf diffuse is there, beside the foliage glow it replaces', (await rowShown('leaf diffuse')) === true && (await rowShown('foliage glow')) === true, `${await rowShown('leaf diffuse')} ${await rowShown('foliage glow')}`);
  await setSplit(0.7);
  let glowGone = false;
  for (let i = 0; i < 30 && !glowGone; i++) { await page.waitForTimeout(400); glowGone = (await rowShown('foliage glow')) === false && (await rowShown('leaf diffuse')) === true; }
  check('looking up, leaf diffuse above 0 retires the foliage glow it replaces', glowGone, `${await rowShown('foliage glow')} ${await rowShown('leaf diffuse')}`);
  await setSplit(0);
  let glowBack = false;
  for (let i = 0; i < 30 && !glowBack; i++) { await page.waitForTimeout(400); glowBack = (await rowShown('foliage glow')) === true; }
  check('and at 0 the foliage glow is back', glowBack, `${await rowShown('foliage glow')}`);
  await page.evaluate(() => { const r = [...document.querySelectorAll('#dev .ctl.toggle')].find((q) => q.querySelector('label')?.textContent === 'look up'); r.querySelector('input').click(); });
  let backFloor = false;
  for (let i = 0; i < 40 && !backFloor; i++) { await page.waitForTimeout(400); backFloor = (await rowShown('canopy fill')) === true && (await fillShown()).every((v) => v === true); }
  check('back on the floor the four return', backFloor, `${await rowShown('canopy fill')} ${await fillShown()}`);
  check('...and the cosine row returns with the floor', (await rowShown('cosine')) === true, `${await rowShown('cosine')}`);
  await setFill(0);
  let fillShut = false;
  for (let i = 0; i < 30 && !fillShut; i++) { await page.waitForTimeout(400); fillShut = (await fillShown()).every((v) => v === false); }
  check('and shutting it hides them again', fillShut, `${await fillShown()}`);
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

  // THE HELD LEAF (L, leaf-preview.js §4.5): one grown leaf against the sun, off until summoned. Its lamina's mean colour is read off the canvas itself:
  // green at summer, red at the end of the turn with anthocyanin up — and it must follow the sliders without a regrow.
  await page.$eval('#hint', (h) => h.classList.add('gone'));
  check('the held leaf is not in the page until L', await page.$('#leaf') === null);
  await page.keyboard.press('l');
  await page.waitForSelector('#leaf', { state: 'visible', timeout: 15000 });
  let leafSized = false;                                            // the size is set on the first frame after the key, not by the key
  for (let i = 0; i < 100 && !leafSized; i++) { leafSized = await page.$eval('#leaf', (c) => c.clientWidth > 0 && c.clientWidth === c.clientHeight); if (!leafSized) await page.waitForTimeout(100); }
  check('l shows #leaf, square and non-zero', leafSized);
  check('and does not surface the key hints', await page.$eval('#hint', (h) => h.classList.contains('gone')));
  const leafMean = () => page.$eval('#leaf', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) { r += d[i]; g += d[i + 1]; n++; }
    return { r: r / (n || 1), g: g / (n || 1), n };
  });
  const until = async (pred, ms) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await leafMean(); if (pred(v)) return v; await page.waitForTimeout(100); } return v; };
  await setSlider('phenology', 0.5);
  const summerLeaf = await until((m) => m.n > 1000 && m.g > m.r, 20000);
  check('at summer the leaf is green (mean G > R over the lamina)', summerLeaf.n > 1000 && summerLeaf.g > summerLeaf.r, JSON.stringify(summerLeaf));
  // GOLD FIRST. At phenology 1 a leaf with no anthocyanin at all is already carotenoid-gold with R > G (T .74 / .58), so "r > g" says nothing about whether the anthocyanin
  // (or the vein share) reached the inset. The red leaf is held to the gold one instead: the same leaf, the same season and vein share, only the anthocyanin moved. And the label
  // is waited on before anything is read off the canvas: the repaint rewrites its `a`, and a read taken before it is a read of the old picture.
  const leafLabel = () => page.$eval('#leaf', (c) => c.dataset.label);
  const labelState = async () => {
    const label = await leafLabel(), m = /^leaf (\d+)·(\d+) · outline \d+ · s (-?[\d.]+) a (-?[\d.]+) b (-?[\d.]+)$/.exec(label ?? '');
    return m ? { label, j: +m[1], k: +m[2], s: +m[3], a: +m[4], b: +m[5] } : { label };
  };
  const untilLabel = async (pred, ms) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await labelState(); if (pred(v)) return v; await page.waitForTimeout(100); } return v; };
  const rOverG = (m) => m.r / m.g;
  await setSlider('anthocyanin', 0);
  await setSlider('vein share', 0.2);
  await setSlider('phenology', 1);
  const goldState = await untilLabel((s) => s.s > 0.5 && s.a < 0.005, 20000);
  check('phenology 1, anthocyanin 0, vein share 0.2: the leaf has turned and the label says no anthocyanin', goldState.s > 0.5 && goldState.a < 0.005, goldState.label);
  const goldLeaf = await leafMean();
  await setSlider('anthocyanin', 0.8);
  // a leaf's own anthocyanin is 0.5-1.5 x the knob (leafTau), so the label reads 0.4-1.2 at 0.8; anything above 0.35 is the knob having reached the picture
  const redState = await untilLabel((s) => s.s > 0.5 && s.a >= 0.35, 20000);
  check('anthocyanin 0.8: the repaint landed (the label reads a between 0.35 and 1.25)', redState.a >= 0.35 && redState.a <= 1.25, redState.label);
  const autumnLeaf = await leafMean();
  check(`the red leaf's mean r/g is at least 1.5x the gold leaf's (red ${rOverG(autumnLeaf).toFixed(2)}, gold ${rOverG(goldLeaf).toFixed(2)})`, rOverG(autumnLeaf) >= 1.5 * rOverG(goldLeaf), `red ${JSON.stringify(autumnLeaf)} gold ${JSON.stringify(goldLeaf)}`);
  await page.keyboard.press(']');
  const stepped = await untilLabel((s) => s.j !== redState.j || s.k !== redState.k, 10000);   // the address only: the label's s / a / b can move without a step
  check('] steps to the next leaf: the address moves to the one after it', (stepped.j === redState.j && stepped.k === redState.k + 1) || (stepped.j === redState.j + 1 && stepped.k === 0), `${redState.label} -> ${stepped.label}`);

  // THE LEAVES THE GROVE HANGS. [ / ] walk one ring through exactly the leaves the grove hung — a cluster's own count (the marginal leaf only where there is one), over the
  // grove's own clusters, wrapping at both ends — and the oracle is the grove the engine's code builds for the look (hungBy), never leaves_per_cluster × foliage_density.
  // `data-at` is the address the keys hold now; the picture (the label) follows once the address has been still.
  const atNow = () => page.$eval('#leaf', (c) => c.dataset.at);
  const walk = async (key, want, limit) => {                        // press until the address reads `want`; the addresses on the way, first to last
    const seen = [await atNow()];
    for (let i = 0; i < limit && seen[seen.length - 1] !== want; i++) { await page.keyboard.press(key); seen.push(await atNow()); }
    return seen;
  };
  const applyLook = async (name) => {
    await page.$eval('#dev select', (sel, v) => { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); }, name);
    await page.waitForTimeout(1500);
  };
  const dense = lookAtDensity(1.65);
  await applyLook(dense.name);
  const upTo = await walk(']', '1·0', dense.perCluster + 5);
  check(`on ${dense.name} (density 1.65, ${dense.perCluster} leaves a cluster) ] reaches leaf 0·${dense.perCluster - 1} and then 1·0`, upTo[upTo.length - 1] === '1·0' && upTo[upTo.length - 2] === `0·${dense.perCluster - 1}`, upTo.slice(-3).join(' '));
  await walk('[', '0·0', dense.perCluster + 5);
  await page.keyboard.press('[');
  const lastLeaf = `${dense.clusters - 1}·${dense.perCluster - 1}`;
  check(`[ from 0·0 wraps to the last leaf of the last cluster, ${lastLeaf} (${dense.clusters} clusters)`, (await atNow()) === lastLeaf, `at ${await atNow()}`);
  const wrapped = await untilLabel((s) => `${s.j}·${s.k}` === lastLeaf, 20000);
  check('...and the picture follows to it: that leaf grows', `${wrapped.j}·${wrapped.k}` === lastLeaf, wrapped.label);
  await page.keyboard.press(']');
  check('] from the last leaf wraps to 0·0', (await atNow()) === '0·0', `at ${await atNow()}`);
  const sparse = lookAtDensity(0.45);
  await applyLook(sparse.name);
  const upToSparse = await walk(']', '1·0', sparse.perCluster + 5);
  check(`on ${sparse.name} (density 0.45, ${sparse.perCluster} leaves a cluster) no address past leaf 0·${sparse.perCluster - 1} is ever shown`, upToSparse[upToSparse.length - 1] === '1·0' && upToSparse[upToSparse.length - 2] === `0·${sparse.perCluster - 1}`, upToSparse.slice(-3).join(' '));

  // SETTLE (§4.5). A regrow is ~0.5 s and a re-raster most of that, so a slider drag, or a canopy morph that lerps leaf_size_m every tick, must not pay one per frame: the picture
  // keeps showing the last leaf until its inputs have been still for 250 ms, then makes the one it was asked for. `data-grows` / `data-rasters` count the makes; `data-size` /
  // `data-wall` are what the picture on show was made with.
  const dataOf = (name) => page.$eval('#leaf', (c, n) => c.dataset[n], name);
  const dragged = async (row, values, counter, made) => {
    const c0 = +(await dataOf(counter));
    for (const [i, v] of values.entries()) { await setSlider(row, v); if (i < values.length - 1) await page.waitForTimeout(100); }
    const during = +(await dataOf(counter)) - c0;
    const want = await page.evaluate((lab) => [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === lab).querySelector('input').value, row);
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && Number(await dataOf(made)) !== Number(want)) await page.waitForTimeout(100);
    const landed = +(await dataOf(counter)) - c0 - during;
    await page.waitForTimeout(800);                                 // and nothing more follows it
    return { during, landed, later: +(await dataOf(counter)) - c0 - during - landed, want, made: await dataOf(made) };
  };
  const sizes = Array.from({ length: 10 }, (_, i) => 0.06 + 0.005 * i);
  const dz = await dragged('leaf (m)', sizes, 'grows', 'size');
  check(`dragging leaf (m) through ${sizes.length} values regrows at most twice during the drag (${dz.during})`, dz.during <= 2, JSON.stringify(dz));
  check(`...then exactly once when it settles, on the final size (${dz.made} of ${dz.want}), and not again`, dz.landed === 1 && dz.later === 0 && Number(dz.made) === Number(dz.want), JSON.stringify(dz));
  const veins = Array.from({ length: 10 }, (_, i) => 0.05 + 0.01 * i);
  const dw = await dragged('vein share', veins, 'rasters', 'wall');
  check(`dragging vein share through ${veins.length} values re-rasterises at most twice during the drag (${dw.during})`, dw.during <= 2, JSON.stringify(dw));
  check(`...then exactly once when it settles, on the final share (${dw.made} of ${dw.want}), and not again`, dw.landed === 1 && dw.later === 0 && Number(dw.made) === Number(dw.want), JSON.stringify(dw));

  // THE INSET IS UNDER THE CONTROLS and over the art. It is fixed bottom-left and 80 % of the screen when big, so it overlaps the strip's ‹ arrow and the panels' lower rows,
  // and it takes the clicks aimed at them unless the controls are stacked above it. Where nothing overlaps it, a click still toggles its size.
  const leafBox = () => page.$eval('#leaf', (c) => { const r = c.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: c.clientWidth }; });
  const topAt = (x, y) => page.evaluate(([px, py]) => { const e = document.elementFromPoint(px, py); return e ? `${e.closest('#leaf, #strip, #play, #dev, #gl')?.id ?? e.tagName}` : null; }, [x, y]);
  const small = await leafBox();
  await page.mouse.click(small.l + 40, small.t + 30);               // the inset's upper-left: clear of the strip along the bottom, and of both panels (hidden in zen)
  check('a click on the inset where nothing overlaps it enlarges it', await poll(async () => (await leafBox()).w > small.w + 50), `${small.w} -> ${(await leafBox()).w}`);
  const big = await leafBox();
  const overArt = await topAt(big.l + 40, big.t + 30);
  check('and it still paints over the art canvas', overArt === 'leaf', `top element at the inset's corner: ${overArt}`);
  const centreOf = (sel) => page.$eval(sel, (b) => { const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const inside = (p) => p.x > big.l && p.x < big.r && p.y > big.t && p.y < big.b;
  const sbc = await centreOf('#strip');
  let arrow = { faded: true, top: null };
  for (let i = 0; i < 20 && arrow.faded; i++) {                      // wake the strip, then read it in one go: it retires again a few seconds after the cursor stills
    await page.mouse.move(sbc.x, sbc.y - 80); await page.mouse.move(sbc.x + 1, sbc.y - 79);
    await page.waitForTimeout(300);
    const a = await centreOf('#strip .preset button');
    arrow = { ...a, faded: await page.$eval('#strip', (e) => e.classList.contains('faded')), top: await topAt(a.x, a.y) };
  }
  check('the strip\'s ‹ arrow, under the big inset, is the control: elementFromPoint there is the strip, not #leaf', !arrow.faded && inside(arrow) && arrow.top === 'strip', JSON.stringify({ ...arrow, insideInset: inside(arrow) }));
  const lowestRow = (panel) => page.evaluate(([sel, b]) => {
    const rows = [...document.querySelectorAll(`${sel} .ctl`)].map((r) => { const q = r.getBoundingClientRect(); return { id: r.dataset.tipKey ?? r.textContent.slice(0, 12), x: q.left + q.width / 2, y: q.top + q.height / 2, w: q.width }; })
      .filter((r) => r.w > 0 && r.x > b.l && r.x < b.r && r.y > b.t && r.y < Math.min(b.b, innerHeight));
    return rows.sort((p, q) => q.y - p.y)[0] ?? null;
  }, [panel, big]);
  const slidIn = (id) => page.waitForFunction((q) => document.getElementById(q).getBoundingClientRect().left >= 0, id, { timeout: 15000 });   // the panel's slide-in is a transition: its rows are off-screen until it lands
  await page.$eval('#strip .preset .more', (b) => b.click());
  await page.waitForSelector('#play:not(.hidden)', { timeout: 15000 });
  await slidIn('play');
  const playRow = await lowestRow('#play');
  const playTop = playRow && await topAt(playRow.x, playRow.y);
  check('the playful panel\'s lowest row under the inset is the control, not #leaf', playTop === 'play', JSON.stringify({ ...playRow, top: playTop }));
  await page.evaluate(() => [...document.querySelectorAll('#play .modes button')].find((b) => b.textContent.includes('advanced')).click());
  await page.waitForSelector('#dev:not(.hidden)', { timeout: 15000 });
  await slidIn('dev');
  const devRow = await lowestRow('#dev');
  const devTop = devRow && await topAt(devRow.x, devRow.y);
  check('the advanced panel\'s lowest row under the inset is the control, not #leaf', devTop === 'dev', JSON.stringify({ ...devRow, top: devTop }));
  await page.evaluate(() => [...document.querySelectorAll('#dev .ctl button')].find((b) => b.textContent.includes('playful')).click());
  await page.waitForSelector('#play:not(.hidden)');
  await page.evaluate(() => [...document.querySelectorAll('#play .modes button')].find((b) => b.textContent.includes('zen')).click());
  await page.waitForSelector('#strip:not(.hidden)');
  await page.waitForTimeout(700);
  await page.mouse.click(big.l + 40, big.t + 30);
  check('and a click where nothing overlaps it shrinks it again', await poll(async () => (await leafBox()).w < big.w - 50), `${big.w} -> ${(await leafBox()).w}`);

  await page.keyboard.press('l');
  check('l again hides it', await page.$eval('#leaf', (c) => getComputedStyle(c).display === 'none'));
  await setSlider('phenology', 0.5);   // leave the season as the checks below found it

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
