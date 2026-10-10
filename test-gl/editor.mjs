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
    // arboretum's dev server serves the site at its root; under /editor/ the same files answer here, over plain http, which is how the smoke reaches the session tier
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/editor\//, '/');
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
const requested = [];   // every path the main page (at /index.html) asks for
page.on('request', (r) => requested.push(new URL(r.url()).pathname));

// every alert/confirm/prompt the page raises is recorded; a prompt is answered with `dialogReply` (null cancels it)
const dialogs = [];
let dialogReply = null;
page.on('dialog', async (d) => {
  dialogs.push({ type: d.type(), message: d.message(), def: d.defaultValue() });
  if (d.type() === 'prompt' && dialogReply !== null) await d.accept(dialogReply); else await d.dismiss();
});
const displayOf = (pg, sel) => pg.$$eval(sel, (els) => els.map((e) => getComputedStyle(e).display));

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
  // the welcome's quiet row: "about" is always there, "arboretum" only where arboretum is served (not here, at /index.html)
  check('at /index.html the welcome shows the about link and hides the arboretum link',
    await page.isVisible('#welcome .more a[href="about.html"]') && !(await page.isVisible('#arbLink')));
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

  // THE AREAS (Part B): the advanced panel is eleven collapsible areas, grouped by the pass you make, each remembering whether it is open. The first <select> in #dev stays the preset dropdown.
  const areas = await page.$$eval('#dev > details > summary.sec', (ss) => ss.map((s) => ({ name: s.textContent, open: s.parentElement.open })));
  check('the areas, in order: Sun, Colour & light, Density, Season, Leaves, Tree shape, Scene, Wind, Tune, Debug, Lab',
    areas.map((a) => a.name).join('|') === 'Sun|Colour & light|Density|Season|Leaves|Tree shape|Scene|Wind|Tune|Debug|Lab', areas.map((a) => a.name).join('|'));
  check('Colour & light, Density and Season start open, and every other area closed (Lab included)',
    areas.every((a) => a.open === ['Colour & light', 'Density', 'Season'].includes(a.name)), JSON.stringify(areas.filter((a) => a.open).map((a) => a.name)));
  const areaOf = (lbl) => page.evaluate((l) => {
    const r = [...document.querySelectorAll('#dev .ctl')].find((q) => q.querySelector('label')?.textContent === l);
    if (!r) return null;
    let d = r.closest('details');
    while (d.parentElement.closest('details')) d = d.parentElement;
    return d.querySelector(':scope > summary').textContent;
  }, lbl);
  const placed = {};
  for (const lbl of ['ground R', 'ground B', 'tonemap', 'faithful tree', 'fabric Tt', 'receiver', 'glow bleed', 'limbs', 'speed', 'phenology', 'fall lag', 'leaf variety', 'density', 'CLOUD']) placed[lbl] = await areaOf(lbl);
  check('ground rows sit under Colour & light, tone_map under Tune, the faithful tree under Tree shape, the cloth under Lab',
    placed['ground R'] === 'Colour & light' && placed['ground B'] === 'Colour & light' && placed.tonemap === 'Tune' && placed['faithful tree'] === 'Tree shape' && placed['fabric Tt'] === 'Lab' && placed.receiver === 'Lab', JSON.stringify(placed));
  check('and the rest land where they were grouped: glow bleed in Scene, limbs and leaf drift speed in Wind, phenology and fall lag in Season',
    placed['glow bleed'] === 'Scene' && placed.limbs === 'Wind' && placed.speed === 'Wind' && placed.phenology === 'Season' && placed['fall lag'] === 'Season' && placed['leaf variety'] === 'Leaves' && placed.density === 'Density' && placed.CLOUD === 'Sun', JSON.stringify(placed));
  const nested = await page.$$eval('#dev > details > details', (ds) => ds.map((d) => `${d.parentElement.querySelector(':scope > summary').textContent}/${d.querySelector(':scope > summary').textContent}:${d.open}`));
  check('Wind holds two nested groups, spring mechanics and leaf drift, both closed', nested.join() === 'Wind/spring mechanics:false,Wind/leaf drift:false', nested.join());
  const tipless = await page.evaluate(() => [...document.querySelectorAll('#dev summary')].filter((s) => {
    const tip = document.getElementById('tip');
    tip.innerHTML = ''; tip.style.display = 'none';
    s.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return tip.style.display !== 'block' || tip.innerHTML === '';
  }).map((s) => s.textContent));
  check('every area and nested group has a tip', tipless.length === 0, tipless.join());
  const summaryShown = (txt) => page.evaluate((t) => {
    const s = [...document.querySelectorAll('#dev summary.sec')].find((q) => q.textContent === t);
    return s ? getComputedStyle(s.parentElement).display !== 'none' : null;
  }, txt);

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
  check('the floor look shows the ground and hides the cloth', (await rowShown('ground R')) && !(await rowShown('fabric Tt')));
  await setReceiver(1);                                             // curtain: no floor albedo, no ray camera, but a fabric
  let curtain = false;                                              // the gate pass rides onFrame — SwiftShader frames are long, and the camera swap compiles a new program
  for (let i = 0; i < 30 && !curtain; i++) { await page.waitForTimeout(400); curtain = !(await rowShown('ground R')) && !(await rowShown('tilt \u00b0')) && (await rowShown('fabric Tt')); }
  check('curtain hides the floor-only knobs and shows the fabric', curtain);
  check('an area with a live row keeps its heading on the curtain (Colour & light, Lab)', (await summaryShown('Colour & light')) === true && (await summaryShown('Lab')) === true);
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
  check("the leaf shape select offers the ellipse, the maple and the beech", JSON.stringify(await page.evaluate(() => [...[...document.querySelectorAll('#dev .ctl.select')].find((q) => q.querySelector('label')?.textContent === 'leaf shape').querySelectorAll('option')].map((o) => o.value))) === '["ellipse","maple","beech"]');
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
  check('and an emptied area takes its heading with it: looking up leaves Lab nothing, so Lab goes', (await summaryShown('Lab')) === false && (await summaryShown('Wind')) === true, `${await summaryShown('Lab')} ${await summaryShown('Wind')}`);
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

  // A BEECH'S OWN VEINS (P4a-3). The inset reads the outline table by the look's leaf_shape, and bladeOf names the grammar the veins were grown in, so picking the beech regrows the held leaf as a beech (a midrib and
  // its secondaries, cut by leaf-maze.js as a pinnate blade) and not as the maple it falls back to for the ellipse. `data-grammar` is the grammar the veins of the picture on show were grown in (the blade's
  // own, not the look's name for it: an inset that ignored the table would read palmate here).
  const grammarNow = () => page.$eval('#leaf', (c) => c.dataset.grammar);
  check("the held leaf of the ellipse look is the maple's blade (palmate), as it was", (await grammarNow()) === 'palmate', `reads ${await grammarNow()}`);
  // LEAF VARIETY (P4a-4): only an outline has rows to vary, so the `leaf variety` row is there for the maple and the beech and hidden on the ellipse look (LOCAL_GATE reads leaf_shape, and gateSig carries it)
  check("the ellipse look has no outlines to vary: the leaf variety row is hidden", (await rowShown('leaf variety')) === false, `${await rowShown('leaf variety')}`);
  await setSelect('leaf shape', 'beech');
  check("picking the beech regrows the held leaf as a beech: data-grammar reads pinnate", await poll(async () => (await grammarNow()) === 'pinnate'), `reads ${await grammarNow()}`);
  check("picking the beech shows the leaf variety row", await poll(async () => (await rowShown('leaf variety')) === true), `${await rowShown('leaf variety')}`);
  await setSelect('leaf shape', 'maple');
  check("picking the maple keeps the leaf variety row", await poll(async () => (await rowShown('leaf variety')) === true && (await grammarNow()) === 'palmate'), `${await rowShown('leaf variety')} ${await grammarNow()}`);
  await setSelect('leaf shape', 'ellipse');
  check("...and the ellipse regrows it again as the maple's blade it falls back to (data-grammar reads palmate)", await poll(async () => (await grammarNow()) === 'palmate'), `reads ${await grammarNow()}`);
  check("...and hides the leaf variety row again", await poll(async () => (await rowShown('leaf variety')) === false), `${await rowShown('leaf variety')}`);

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

  // SETTLE (§4.5). A regrow is about 0.13 s in bun and a re-raster most of that, so a slider drag, or a canopy morph that lerps leaf_size_m every tick, must not pay one per frame: the picture
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

  // ---- PLAYLISTS (playlists.js): the save prompt, a ★ that shares a built-in's name, and the rows that wait for a second playlist ----
  const devPick = (value) => page.evaluate((v) => { const s = document.querySelector('#dev select'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const devOpts = () => page.$eval('#dev select', (s) => [...s.options].map((o) => [o.value, o.textContent]));
  const devBtn = (text) => page.evaluate((t) => [...document.querySelectorAll('#dev .ctl button')].find((b) => b.textContent === t).click(), text);
  const setCloudSlider = (v) => page.$eval('#dev', (dev, val) => {
    const i = [...dev.querySelectorAll('.ctl')].find((r) => r.querySelector('label')?.textContent === 'CLOUD').querySelector('input');
    i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  const askSave = async (reply) => { dialogs.length = 0; dialogReply = reply; await devBtn('save'); dialogReply = null; return dialogs[0]; };

  const rowDisplay = await page.evaluate(() => getComputedStyle(document.querySelector('#dev .playlist-row')).display);
  check('with one playlist there is no playlist row', rowDisplay === 'none', rowDisplay);
  check('and no \u25b6 anywhere', (await displayOf(page, '.playstop')).every((x) => x === 'none') && (await page.$$('#strip .playstop')).length === 0, (await displayOf(page, '.playstop')).join());

  // THE LOOK'S CHIP (every editor, arboretum or not): one muted line under the look select that says where the look lives
  const chipNow = () => page.$eval('#dev .look-chip', (e) => (e.hidden ? '' : e.textContent));
  const chipIs = async (want) => poll(async () => (await chipNow()) === want);
  await devPick('afternoon 7');
  check('a built-in, unchanged, reads "built-in"', await chipIs('built-in'), await chipNow());
  await setCloudSlider(0.12);
  check('and an edit prefixes "● edited · "', await chipIs('● edited · built-in'), await chipNow());
  let d = await askSave('k2 mine');
  check('save on a built-in offers no name', d?.type === 'prompt' && d.def === '', JSON.stringify(d));
  check('a new name adds a ★ and selects it', (await devOpts()).some(([v, t]) => v === 'k2 mine' && t === '★ k2 mine') && (await page.$eval('#dev select', (s) => s.value)) === 'k2 mine');
  check('a saved ★ with no arboretum reads "★ saved here", and the save cleared the edit', await chipIs('★ saved here'), await chipNow());
  d = await askSave(null);
  check('save pre-fills the current ★ name', d?.def === 'k2 mine', JSON.stringify(d));
  check('and cancelling it adds nothing', (await devOpts()).filter(([, t]) => t.startsWith('★ ')).length === 1);
  d = await askSave('k2 mine 2');
  check('another new name adds another ★', (await devOpts()).filter(([, t]) => t.startsWith('★ ')).length === 2 && d?.def === 'k2 mine');

  // a ★ named like a built-in lists beside it, with a value of its own, and each loads its own look
  d = await askSave('afternoon 7');
  const same = (await devOpts()).filter(([, t]) => t.endsWith(' afternoon 7'));
  check('a ★ named like a built-in is listed beside it, as before, with a value of its own', same.length === 2 && same[0][1] === '• afternoon 7' && same[1][1] === '★ afternoon 7' && same[0][0] !== same[1][0], JSON.stringify(same));
  await devPick(same[0][0]);
  check('the built-in loads the built-in', Math.abs(parseFloat(await cloudVal()) - PRESETS['afternoon 7'].cloud_thickness) < 1e-6, `cloud ${await cloudVal()}`);
  await devPick(same[1][0]);
  check('and the ★ loads the ★', Math.abs(parseFloat(await cloudVal()) - 0.12) < 1e-6, `cloud ${await cloudVal()}`);
  await page.waitForTimeout(300);
  await page.$eval('#play .preset button:nth-child(1)', (b) => b.click());   // ‹ from the ★: the entry before it in the list, not the one before the built-in
  check('stepping goes from the ★, not from the built-in of its name', (await page.$eval('#dev select', (s) => s.value)) === 'k2 mine 2');
  await page.waitForTimeout(400);

  // delete takes the ★ and leaves the built-in
  await devPick(same[1][0]);
  dialogs.length = 0;
  await devBtn('delete');
  const afterDel = await devOpts();
  check('delete removes the ★ and leaves the built-in', afterDel.filter(([, t]) => t.endsWith(' afternoon 7')).map(([, t]) => t).join() === '• afternoon 7' && dialogs.length === 0, JSON.stringify(afterDel.filter(([, t]) => t.endsWith(' afternoon 7'))));
  await devPick('memories');
  dialogs.length = 0;
  await devBtn('delete');
  check('delete still refuses a built-in', dialogs[0]?.type === 'alert' && /Built-in/.test(dialogs[0].message), JSON.stringify(dialogs));
  for (const n of ['k2 mine', 'k2 mine 2']) { await devPick(n); await devBtn('delete'); }
  check('and the ★ looks go the same way', (await devOpts()).every(([, t]) => !t.startsWith('★ ')));
  // ⌘S / Ctrl+S is the save button: the same prompt, the same ★, and the browser's own save-page stays out of it
  dialogs.length = 0; dialogReply = 'k2 keys';
  await page.keyboard.press('Control+s');
  dialogReply = null;
  await page.waitForTimeout(300);
  check('Ctrl+S prompts for a name and keeps a ★ under it', dialogs[0]?.type === 'prompt' && (await devOpts()).some(([v, t]) => v === 'k2 keys' && t === '★ k2 keys'), JSON.stringify(dialogs));
  await devPick('k2 keys'); await devBtn('delete');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('komorebi.editor')));
  check('the editor settings remember the playlist and the entry', stored.playlist === 'local' && typeof stored.selected?.local === 'string', JSON.stringify(stored));

  // the tiers (arboretum.js): at /index.html (a fork, komorebi's own dev server) arboretum is local-only: its code is there to keep the ★ looks,
  // but it asks the network for nothing, and shows nothing of the session
  const arbAsked = requested.filter((p) => p.startsWith('/api/'));
  check('at /index.html the editor makes no request to arboretum at startup', arbAsked.length === 0, arbAsked.join());
  const arbUi = await page.evaluate(() => ({ marker: document.body.dataset.arboretum, text: ['dev', 'play', 'strip'].filter((id) => /arboretum/i.test(document.getElementById(id).textContent)) }));
  check('and shows no arboretum UI', arbUi.marker === undefined && arbUi.text.length === 0, JSON.stringify(arbUi));

  // reload holds the mode (persistence), and each area stays open or closed the way it was left
  await page.evaluate(() => { for (const n of ['Season', 'Lab']) [...document.querySelectorAll('#dev summary.sec')].find((q) => q.textContent === n).click(); });   // Season closes, Lab opens
  await page.waitForFunction(() => { const o = JSON.parse(localStorage.getItem('komorebi.editor')).open ?? {}; return o.Season === false && o.Lab === true; }).catch(() => {});
  await page.reload({ waitUntil: 'load' });
  await page.click('#feel');
  await page.waitForSelector('#strip:not(.hidden)', { timeout: 60000 });
  check('mode persists across reload (zen)', true);
  const reopened = await page.$$eval('#dev > details > summary.sec', (ss) => Object.fromEntries(ss.map((s) => [s.textContent, s.parentElement.open])));
  check('and the areas persist: Season closed and Lab open as left, Colour & light and Density still open, Sun still closed',
    reopened.Season === false && reopened.Lab === true && reopened['Colour & light'] === true && reopened.Density === true && reopened.Sun === false, JSON.stringify(reopened));

  // a cached arboretum playlist as the second playlist: the row and the ▶ appear (play and advanced, never zen), and the arrows walk its items
  {
    await page.goto('about:blank');   // one GL page at a time: SwiftShader starves a second page's load while the first renders
    const cloudCache = { v: 1, me: null, origin: {}, playlists: { 7: { id: 7, name: 'k2 list', owner: 'jo', k: null, fetched_at: 1, unavailable: 0, items: [
      { preset_id: 1, version: 1, owner: 'jo', name: 'one', dwell_s: 2, crossfade_s: 1, params: PRESETS['afternoon 7'] },
      { preset_id: 2, version: 1, owner: 'jo', name: 'two', dwell_s: 2, crossfade_s: 1, params: PRESETS.memories }] } } };
    const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
    await ctx.addInitScript(([cache]) => {
      if (localStorage.getItem('komorebi.editor')) return;   // only the first load: a reload keeps what the page wrote
      localStorage.setItem('komorebi.arboretum', JSON.stringify(cache));
      localStorage.setItem('komorebi.editor', JSON.stringify({ mode: 'play', playlist: 'arb:7' }));
    }, [cloudCache]);
    const page2 = await ctx.newPage();
    page2.setDefaultTimeout(30000);
    page2.on('pageerror', (e) => errors.push(`[after check ${results.length}] page 2: ${e.message}`));
    await page2.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
    await page2.click('#feel');
    await page2.waitForSelector('#play:not(.hidden)', { timeout: 60000 });
    const sel2 = () => page2.$eval('#dev select', (s) => ({ value: s.value, opts: [...s.options].map((o) => o.textContent) }));
    const first = await sel2();
    check('a cached cloud playlist lists its items by name and opens on the first', first.opts.join() === 'one,two' && first.value === '0', JSON.stringify(first));
    check('with a second playlist the playlist row is there, on the active one', await page2.evaluate(() => {
      const s = document.querySelectorAll('#dev select')[1];
      return getComputedStyle(s.closest('.ctl')).display !== 'none' && [...s.options].map((o) => o.textContent).join() === 'all looks,k2 list' && s.value === 'arb:7';
    }));
    const vis = await page2.evaluate(() => Object.fromEntries(['play', 'dev', 'strip'].map((id) => [id, [...document.querySelectorAll(`#${id} .playstop`)].map((b) => getComputedStyle(b).display !== 'none')])));
    check('the ▶ shows in play and advanced, and the zen strip has none', vis.play.length === 1 && vis.play[0] && vis.dev.length === 1 && vis.dev[0] && vis.strip.length === 0, JSON.stringify(vis));
    await page2.waitForTimeout(800);
    await page2.$eval('#play .preset button:nth-child(2)', (b) => b.click());
    check('› steps to the next item, by index', (await sel2()).value === '1' && (await page2.$eval('#play .preset .name', (e) => e.textContent)) === 'two');
    await page2.waitForTimeout(400);
    await page2.evaluate(() => { const s = document.querySelectorAll('#dev select')[1]; s.value = 'local'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    const back = await sel2();
    check('swapping to all looks lists the built-ins again and the ▶ goes', back.opts.length > 3 && back.value === Object.keys(PRESETS)[0]
      && (await displayOf(page2, '.playstop')).every((x) => x === 'none'), JSON.stringify({ n: back.opts.length, v: back.value }));
    await ctx.close();
  }

  // the editor under /editor/, where arboretum's dev server serves it, with /api/health answering as arboretum does: the gate opens
  {
    await page.goto('about:blank');
    const ctx3 = await browser.newContext({ viewport: { width: 640, height: 480 } });
    const page3 = await ctx3.newPage();
    page3.setDefaultTimeout(30000);
    page3.on('pageerror', (e) => errors.push(`[after check ${results.length}] page 3: ${e.message}`));
    const asked = [];
    page3.on('request', (r) => asked.push(new URL(r.url()).pathname));
    await page3.route('**/api/health', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, engine: 'abc1234' }) }));
    await page3.goto(`http://127.0.0.1:${port}/editor/index.html`, { waitUntil: 'load' });
    let on = null;
    try { on = await (await page3.waitForFunction(() => document.body.dataset.arboretum || null)).jsonValue(); } catch { /* reported below */ }
    check('under /editor/ with /api/health answering, the gate opens on the page\'s own origin', on === `http://127.0.0.1:${port}`, String(on));
    check('and it asked /api/health once', asked.filter((p) => p === '/api/health').length === 1, asked.filter((p) => /api|arboretum/.test(p)).join());
    let arbShown = false;
    try { await page3.waitForSelector('#arbLink', { state: 'visible', timeout: 5000 }); arbShown = true; } catch { /* reported below */ }
    check('and the welcome\'s arboretum link shows, to /arboretum, beside about', arbShown && await page3.$eval('#arbLink', (a) => a.getAttribute('href')) === '/arboretum' && await page3.isVisible('#welcome .more a[href="about.html"]'));
    await ctx3.close();
  }

  // the read tier: a link opened at /index.html (a fork) is GET from arboretum's own origin, anonymously, and lands as a ★; nothing else is asked.
  // The mock stands in for arboretum's CORS allowing anonymous GETs from any origin.
  {
    await page.goto('about:blank');
    const arboretumOrigin = 'https://komorebi.eljojo.net';
    const open6 = async (hash, answer) => {
      const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
      const pg = await ctx.newPage();
      pg.setDefaultTimeout(30000);
      pg.on('pageerror', (e) => errors.push(`[after check ${results.length}] k6 page: ${e.message}`));
      pg.on('console', (m) => { if (m.type() === 'error' && !(m.text().startsWith('Failed to load resource') && /komorebi\.eljojo\.net/.test(m.location().url))) errors.push(`[after check ${results.length}] k6 page console: ${m.text()}`); });
      const own = [], theirs = [];
      pg.on('request', (r) => { const u = new URL(r.url()); if (u.origin === arboretumOrigin) theirs.push(`${r.method()} ${u.pathname}${u.search} cookie:${r.headers().cookie ?? '-'}`); else if (u.pathname.startsWith('/api/')) own.push(u.pathname); });
      await pg.route(`${arboretumOrigin}/**`, (route) => answer(route));
      await pg.goto(`http://127.0.0.1:${port}/index.html${hash}`, { waitUntil: 'load' });
      return { ctx, pg, own, theirs };
    };
    {
      const dusk = { id: 31, owner: 'ana', name: 'k6 forked', version: 1, params: PRESETS.memories };
      const { ctx, pg, own, theirs } = await open6('#arboretum=31', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(dusk) }));
      const there = await pg.waitForFunction(() => document.querySelector('#dev select').value === 'k6 forked', null, { timeout: 60000 }).then(() => true, () => false);
      check('a #arboretum= link at /index.html is one cookie-less GET to arboretum\'s own origin, and lands as a ★', there && theirs.join() === 'GET /api/presets/31 cookie:-' && own.length === 0, `${there} ${theirs.join()} ${own.join()}`);
      const rec = await pg.evaluate(() => ({ star: 'k6 forked' in JSON.parse(localStorage.getItem('komorebi.presets') || '{}'), origin: JSON.parse(localStorage.getItem('komorebi.arboretum') || '{}').origin?.['k6 forked'], marker: document.body.dataset.arboretum, ui: !!document.querySelector('.arb-cta, .arb-inrow, .arb-who') }));
      check('and it is a synced copy of #31 by ana, with no session and no arboretum controls', rec.star && rec.origin?.id === 31 && rec.origin.owner === 'ana' && rec.origin.synced === true && rec.marker === undefined && !rec.ui, JSON.stringify(rec));
      await ctx.close();
    }
    {
      const { ctx, pg, theirs } = await open6('#arboretum=31', (route) => route.abort('failed'));   // a browser that blocks the read (CORS), or a network that fails
      const said = await pg.waitForFunction(() => document.getElementById('hint').textContent === 'arboretum: arboretum unreachable' && !document.getElementById('hint').classList.contains('gone'), null, { timeout: 20000 }).then(() => true, () => false);
      await pg.waitForSelector('#strip:not(.hidden)', { timeout: 60000 });
      check('a link the browser blocks is said quietly through the key-hint line, and the editor lands as usual', said && theirs.length === 1 && (await pg.$eval('#dev select', (s) => s.value)) === 'afternoon 7', `${said} ${theirs.join()}`);
      await ctx.close();
    }
  }

  // ---- ARBORETUM, cloud first (arboretum.js), at /editor/ with page.route standing in for arboretum. Signed out it is local-only; signed
  // in, your looks live in arboretum (folders, and uncategorized for the rest), a full copy is kept here, and every save goes up ----
  {
    await page.goto('about:blank');
    const ctx4 = await browser.newContext({ viewport: { width: 640, height: 480 } });
    await ctx4.route('**/arboretum/login', (route) => route.fulfill({ contentType: 'text/html', body: '<p>login</p>' }));
    // two ★ looks made before ever signing in, seeded once
    await ctx4.addInitScript(([one, two]) => {
      if (localStorage.getItem('komorebi.presets') !== null) return;
      localStorage.setItem('komorebi.presets', JSON.stringify({ 'local one': one, 'local two': two }));
      localStorage.setItem('komorebi.arboretum', JSON.stringify({ v: 1, me: null, origin: { 'local two': { parent: 'look:memories' } }, playlists: {} }));
      localStorage.setItem('komorebi.editor', JSON.stringify({ mode: 'play', playlist: 'local' }));
    }, [{ ...PRESETS.memories, cloud_thickness: 0.2 }, { ...PRESETS.memories, cloud_thickness: 0.25 }]);
    const page4 = await ctx4.newPage();
    page4.setDefaultTimeout(30000);
    page4.on('pageerror', (e) => errors.push(`[after check ${results.length}] page 4: ${e.message}`));
    // the mock's own refusals (401, 422, aborted calls, a missing commit.json) are logged by Chromium as failed loads: expected, not page errors
    const expected = (m) => m.text().startsWith('Failed to load resource') && /\/api\/|commit\.json/.test(m.location().url);
    page4.on('console', (m) => { if (m.type() === 'error' && !expected(m)) errors.push(`[after check ${results.length}] page 4 console: ${m.text()}`); });
    const alerts = [], prompts = [];
    let reply = null;
    page4.on('dialog', async (d) => {
      if (d.type() !== 'prompt') { alerts.push(d.message()); await d.dismiss(); return; }
      prompts.push(d.defaultValue());
      if (reply !== null) await d.accept(reply); else await d.dismiss();
    });

    // The mock arboretum. `seen` is every call the page makes to it, in order, with the body it sent.
    const seen = [];
    const db = {   // the presets, newest first; the playlists
      presets: [
        { id: 21, owner: 'jo', name: 'dusk', version: 1, params: PRESETS.memories },
        { id: 5, owner: 'jo', name: 'dawn', version: 1, params: PRESETS['afternoon 7'] },
        { id: 6, owner: 'ana', name: 'ana dusk', version: 3, params: PRESETS.memories },
      ],
      lists: {
        7: { id: 7, name: 'evening', items: [{ preset_id: 5, dwell_s: 11, crossfade_s: 2 }, { preset_id: 6, dwell_s: 12, crossfade_s: 3 }, { preset_id: 99, dwell_s: 40, crossfade_s: 7 }] },
        8: { id: 8, name: 'morning', items: [] },
      },
    };
    const server = { signedIn: false, down: false, refuse: null, nextPreset: 12, nextList: 9 };
    const byId = (id) => db.presets.find((p) => p.id === id);
    const itemView = (i) => { const p = byId(i.preset_id); return p ? { preset_id: p.id, version: p.version, owner: p.owner, name: p.name, dwell_s: i.dwell_s ?? 30, crossfade_s: i.crossfade_s ?? 5, params: p.params } : { preset_id: i.preset_id, dwell_s: i.dwell_s ?? 30, crossfade_s: i.crossfade_s ?? 5, unavailable: true }; };
    const view = (l) => { const items = l.items.map(itemView); return { id: l.id, owner: 'jo', name: l.name, description: null, created_at: 1, updated_at: 2, visibility: 'private', share_token: 'sekret', items, unavailable: items.filter((i) => i.unavailable).length }; };
    await page4.route('**/api/**', (route) => {
      const req = route.request(), u = new URL(req.url());
      const body = req.postData() ? JSON.parse(req.postData()) : undefined;
      const k = `${req.method()} ${u.pathname}`;
      if (server.down && k !== 'GET /api/health') { seen.push({ method: req.method(), path: u.pathname + u.search, body, down: true }); return route.abort('failed'); }
      seen.push({ method: req.method(), path: u.pathname + u.search, body });
      const json = (status, b) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      if (k === 'GET /api/health') return json(200, { ok: true, engine: 'abc1234' });
      if (!server.signedIn) return json(401, { error: 'sign in, or send a bearer token' });
      if (k === 'GET /api/me') return json(200, { username: 'jo', kind: 'session' });
      if (k === 'GET /api/playlists') return json(200, { playlists: Object.values(db.lists).map(({ items, ...s }) => ({ ...s, owner: 'jo' })).reverse() });
      if (k === 'GET /api/presets') return json(200, { presets: db.presets.filter((p) => p.owner === 'jo').map(({ params, ...s }) => s) });
      const one = u.pathname.match(/^\/api\/presets\/(\d+)$/), items = u.pathname.match(/^\/api\/playlists\/(\d+)\/items$/), pl = u.pathname.match(/^\/api\/playlists\/(\d+)$/);
      if (one && req.method() === 'GET') return byId(Number(one[1])) ? json(200, byId(Number(one[1]))) : json(404, { error: 'not found' });
      if (pl && req.method() === 'GET') return json(200, view(db.lists[pl[1]]));
      if (req.method() === 'POST' && /^\/api\/presets(\/\d+\/versions)?$/.test(u.pathname)) {
        if (server.refuse) { const r = server.refuse; server.refuse = null; return json(r.status, r.body); }
        if (u.pathname === '/api/presets') {
          const p = { id: server.nextPreset++, owner: 'jo', name: body.name, version: 1, params: body.params };
          db.presets.unshift(p);
          return json(201, { id: p.id, owner: 'jo', name: p.name, version: 1 });
        }
        const p = byId(Number(u.pathname.split('/')[3]));
        Object.assign(p, { name: body.name, version: p.version + 1, params: body.params });
        return json(201, { id: p.id, owner: 'jo', name: p.name, version: p.version });
      }
      if (k === 'POST /api/playlists') {
        const l = { id: server.nextList++, name: body.name, items: [] };
        db.lists[l.id] = l;
        return json(201, view(l));
      }
      if (items && req.method() === 'PUT') {
        db.lists[items[1]].items = body.items;
        return json(200, view(db.lists[items[1]]));
      }
      return json(404, { error: 'not found' });
    });
    const calls = (re) => seen.filter((c) => re.test(`${c.method} ${c.path}`));
    const lastCall = (re) => calls(re).at(-1);
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page4.waitForTimeout(60); } return false; };
    const dev4 = (fn, ...a) => page4.evaluate(fn, ...a);
    const opts4 = (i) => dev4((n) => [...document.querySelectorAll('#dev select')[n].options].map((o) => o.textContent), i);   // i: 0 = the look select, 1 = the playlist select
    const pick4 = (i, v) => dev4(([n, val]) => { const s = document.querySelectorAll('#dev select')[n]; s.value = val; s.dispatchEvent(new Event('change', { bubbles: true })); }, [i, v]);
    const pickByText4 = (i, t) => dev4(([n, text]) => { const s = document.querySelectorAll('#dev select')[n]; s.value = [...s.options].find((o) => o.textContent === text).value; s.dispatchEvent(new Event('change', { bubbles: true })); }, [i, t]);
    const value4 = (i) => dev4((n) => document.querySelectorAll('#dev select')[n].value, i);
    const selectedText4 = (i) => dev4((n) => { const s = document.querySelectorAll('#dev select')[n]; return s.selectedOptions[0]?.textContent ?? ''; }, i);
    const click4 = (sel) => dev4((s) => document.querySelector(s).click(), sel);
    const btn4 = (text) => dev4((t) => [...document.querySelectorAll('#dev .ctl button')].find((b) => b.textContent === t).click(), text);
    const shown4 = (sel) => dev4((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && !e.closest('[hidden]'); }, sel);
    const text4 = (sel) => dev4((s) => document.querySelector(s)?.textContent ?? null, sel);
    const slider4 = (v) => dev4((val) => {
      const i = [...document.querySelectorAll('#dev .ctl')].find((r) => r.querySelector('label')?.textContent === 'CLOUD').querySelector('input');
      i.value = String(val); i.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const save4 = async (name) => { prompts.length = 0; reply = name; await btn4('save'); reply = null; return prompts[0]; };
    const waitCall = (re, n = 1) => until(() => calls(re).length >= n);
    const near = (a, b) => Math.abs(a - b) < 1e-6;
    const chip4 = () => dev4(() => { const e = document.querySelector('#dev .look-chip'); return e.hidden ? '' : e.textContent; });
    const chipTitle4 = () => dev4(() => document.querySelector('#dev .look-chip').title);
    const chipIs4 = (want) => until(async () => (await chip4()) === want);
    const toast4 = async () => (await text4('#dev .arb-status')) ?? '';
    const chips4 = () => dev4(() => [...document.querySelectorAll('#dev .arb-inrow .arb-in')].map((b) => `${b.textContent}:${b.getAttribute('aria-pressed')}`).join());
    const chipsAre4 = (want) => until(async () => (await chips4()) === want);
    const clickChip4 = (name) => dev4((n) => [...document.querySelectorAll('#dev .arb-inrow .arb-in')].find((b) => b.textContent === n).click(), name);
    const stars4 = () => dev4(() => Object.keys(JSON.parse(localStorage.getItem('komorebi.presets') || '{}')));
    const mirror4 = () => dev4(() => JSON.parse(localStorage.getItem('komorebi.arboretum.mirror') || 'null'));
    const focus4 = () => dev4(() => window.dispatchEvent(new Event('focus')));
    const putAfter = (path) => { const i = seen.findLastIndex((c) => c.method === 'PUT' && c.path === path); return { put: seen[i], before: seen[i - 1] }; };
    const moveBox4 = () => dev4(() => { const b = document.querySelector('#dev .arb-move'); return b && !b.hidden ? { text: b.querySelector('.arb-move-text').hidden ? '' : b.querySelector('.arb-move-text').textContent, buttons: [...b.querySelectorAll('button')].filter((x) => !x.hidden).map((x) => x.textContent) } : null; });
    const openAdvanced4 = async () => {
      await page4.click('#feel');
      await page4.waitForSelector('#play:not(.hidden), #dev:not(.hidden)', { timeout: 60000 });   // the mode you left is the mode you come back to
      await page4.waitForTimeout(800);
      if (await page4.$eval('#dev', (e) => e.classList.contains('hidden'))) await page4.evaluate(() => [...document.querySelectorAll('#play .modes button')].find((b) => b.textContent.includes('advanced')).click());
      await page4.waitForSelector('#dev:not(.hidden)', { timeout: 15000 });
    };
    // switching list is asynchronous (a folder is fetched first): the select shows the new value at once, so wait for the editor to have moved
    const editorList4 = () => dev4(() => JSON.parse(localStorage.getItem('komorebi.editor')).playlist);
    const goList4 = async (text, value) => { await pickByText4(1, text); await until(async () => (await editorList4()) === value); };
    const POSTS = /^POST \/api\/presets(\/\d+\/versions)?$/;

    // SIGNED OUT: local only. Two ★ looks, no notice, no cloud UI, and arboretum is asked nothing but who you are.
    await page4.goto(`http://127.0.0.1:${port}/editor/index.html`, { waitUntil: 'load' });
    await openAdvanced4();
    await waitCall(/^GET \/api\/me$/);
    await until(() => shown4('#dev .arb-cta'));
    check('in the playful sidebar and the zen strip, arboretum is asked nothing but /api/health (and /api/me once the advanced panel opens)', seen.every((c) => c.path === '/api/health' || c.path === '/api/me'), seen.map((c) => c.path).join());
    check('signed out it is local only: all looks lists the two ★ looks, and there is no notice, no chips, no +, no folders',
      (await opts4(1)).join() === 'all looks' && (await opts4(0)).includes('★ local one') && (await opts4(0)).includes('★ local two') && !(await moveBox4())
      && !(await shown4('#dev .arb-inrow')) && !(await shown4('#dev .playlist-row')) && (await text4('#dev .arb-who')) === '' && (await text4('#dev .arb-cta')) === 'keep your looks in arboretum ↗');
    check('the look has its chip: a built-in, unchanged', await chipIs4('built-in'), await chip4());
    await pick4(0, 'local one');
    check('and a ★ is "★ saved here"', await chipIs4('★ saved here'), await chip4());
    await slider4(0.21);
    const preS = await save4('local three');
    check('a save signed out is a ★ here, and asks arboretum nothing', preS === 'local one' && (await stars4()).includes('local three') && calls(/^POST /).length === 0 && seen.every((c) => c.path === '/api/health' || c.path === '/api/me'), JSON.stringify(await stars4()));
    await pick4(0, 'local three'); await btn4('delete');
    const [popup] = await Promise.all([ctx4.waitForEvent('page'), click4('#dev .arb-cta')]);
    await popup.waitForURL('**/arboretum/login').catch(() => {});
    check('the sign-in button opens arboretum\'s /arboretum/login in a new tab', popup.url() === `http://127.0.0.1:${port}/arboretum/login`, popup.url());
    await popup.close();

    // SIGNED IN: the first check offers to move the ★ looks in, and mirrors the cloud
    server.signedIn = true;
    await focus4();
    await until(async () => (await text4('#dev .arb-who')) === 'arboretum · jo' && (await moveBox4()) !== null);
    check('signed in, the line reads "arboretum · jo" and a notice offers to move the 2 ★ looks, private', (await text4('#dev .arb-who')) === 'arboretum · jo' && JSON.stringify(await moveBox4()) === JSON.stringify({ text: "move your 2 looks into arboretum? they'll be private", buttons: ['move', 'not now'] }), JSON.stringify(await moveBox4()));
    check('the lists are uncategorized, your folders in arboretum\'s order, the built-ins, and on this browser (the ★ looks are not moved yet)', (await opts4(1)).join() === 'uncategorized,morning,evening,built-ins,on this browser', (await opts4(1)).join());
    check('and no all looks, and no ☁ rows', !(await opts4(1)).includes('all looks') && (await opts4(0)).every((t) => !t.includes('☁')), (await opts4(0)).join());
    check('the mirror holds what is mine (dusk, dawn) and both playlists, fetched by version: each preset once', JSON.stringify((await mirror4()).order) === '[21,5]' && (await mirror4()).playlists.map((l) => l.id).join() === '8,7' && calls(/^GET \/api\/presets\/(21|5)$/).length === 2 && calls(/^GET \/api\/presets\/6$/).length === 0, JSON.stringify(await mirror4()).slice(0, 160));
    check('with a + beside the playlist select', await shown4('#dev .playlist-row button'));

    // not now: the ★ looks stay as their own list, with a button; the notice is not asked again on every focus
    await click4('#dev .arb-move-no');
    await focus4();
    await page4.waitForTimeout(600);
    check('"not now" puts the notice away, keeps both ★s, and a later focus does not ask again', (await moveBox4()) === null || !(await moveBox4()).text, JSON.stringify(await moveBox4()));
    await goList4('on this browser', 'local');
    check('on this browser lists the un-moved ★s, with a "move to arboretum" button', (await opts4(0)).join() === '★ local one,★ local two' && JSON.stringify((await moveBox4())?.buttons) === '["move to arboretum"]', `${(await opts4(0)).join()} ${JSON.stringify(await moveBox4())}`);
    await pick4(0, 'local one');
    check('a ★ there has its chip, and removing is a delete (the ★ only)', await chipIs4('★ saved here') && (await dev4(() => [...document.querySelectorAll('#dev .ctl button')].some((b) => b.textContent === 'delete' && !b.hidden))));

    // the next session asks again; a refusal during the move stays local with its reason
    await page4.reload({ waitUntil: 'load' });
    await openAdvanced4();
    await until(async () => (await moveBox4())?.text);
    check('in the next session the first signed-in check asks again', (await moveBox4())?.text === "move your 2 looks into arboretum? they'll be private", JSON.stringify(await moveBox4()));
    server.refuse = { status: 422, body: { error: 'branch_levels must be 1–4', reason: 'out_of_range' } };
    const p0 = calls(POSTS).length;
    await click4('#dev .arb-move-yes');
    await waitCall(POSTS, p0 + 2);
    await until(async () => (await stars4()).join() === 'local one');
    const mv = calls(POSTS).slice(p0);
    check('move uploads each ★ as a private preset (parent, no visibility) — the refused one stays local, the other is no longer a ★', mv.length === 2 && mv[0].body.name === 'local one' && mv[1].body.name === 'local two' && mv[1].body.parent === 'look:memories' && (await stars4()).join() === 'local one', JSON.stringify(mv.map((c) => c.body.name)));
    const toastNow = await toast4();
    await pickByText4(1, 'on this browser');
    await until(async () => (await opts4(0)).join() === '★ local one');
    await pick4(0, 'local one');
    check('the refusal is in the toast verbatim, and in that look\'s chip title', toastNow === 'branch_levels must be 1–4' && (await chipTitle4()).includes('branch_levels must be 1–4'), `${toastNow} | ${await chipTitle4()}`);
    await click4('#dev .arb-move-yes');
    await waitCall(POSTS, p0 + 3);
    await until(async () => (await stars4()).length === 0 && (await value4(1)) === 'arb:unc');
    check('move to arboretum again moves the rest: no local ★ left, and the editor goes to uncategorized, where both moved looks are', (await stars4()).length === 0 && (await value4(1)) === 'arb:unc' && (await opts4(0)).includes('local one') && (await opts4(0)).includes('local two') && (await opts4(0)).includes('dusk'), `${(await stars4()).join()} ${(await opts4(0)).join()}`);
    check('and on this browser, and the notice, are gone', !(await opts4(1)).includes('on this browser') && (await moveBox4()) === null, (await opts4(1)).join());
    check('no request carried visibility', seen.every((c) => !/visibility/i.test(`${c.path} ${JSON.stringify(c.body ?? '')}`)));

    // every save goes to arboretum, private: a built-in becomes a new preset, parented on it, and lands in uncategorized
    await goList4('built-ins', 'builtins');
    check('built-ins is a list of the shipped looks alone, with no remove or delete', (await opts4(0)).every((t) => /^[•◦] /.test(t)) && !(await dev4(() => [...document.querySelectorAll('#dev .ctl button')].some((b) => (b.textContent === 'delete' || b.textContent === 'remove') && !b.hidden))));
    await pick4(0, 'afternoon 7');
    check('a built-in selected: "built-in"', await chipIs4('built-in'), await chip4());
    await slider4(0.12);
    check('an edit prefixes "● edited · "', await chipIs4('● edited · built-in'), await chip4());
    const p1 = calls(POSTS).length;
    const preB = await save4('k4 fresh');
    await waitCall(POSTS, p1 + 1);
    const fresh = lastCall(POSTS)?.body ?? {};
    check('save on a built-in offers no name and POSTs a new preset with parent look:<built-in> (no komorebi_commit here)', preB === '' && fresh.name === 'k4 fresh' && fresh.parent === 'look:afternoon 7' && !('komorebi_commit' in fresh) && near(fresh.params?.cloud_thickness, 0.12), JSON.stringify({ ...fresh, params: '…' }));
    const freshId = server.nextPreset - 1;
    await until(async () => (await value4(1)) === 'arb:unc' && (await selectedText4(0)) === 'k4 fresh');
    check('the editor goes to uncategorized, on the new look, and no ★ was written here', (await value4(1)) === 'arb:unc' && (await selectedText4(0)) === 'k4 fresh' && (await stars4()).length === 0, `${await value4(1)} ${await selectedText4(0)}`);
    check(`the chip reads ☁ #${freshId} v1 and the toast says what landed`, await chipIs4(`☁ #${freshId} v1`) && (await toast4()) === `kept in arboretum · #${freshId} v1`, `${await chip4()} / ${await toast4()}`);
    check('uncategorized lists it first, newest first', (await opts4(0))[0] === 'k4 fresh', (await opts4(0)).join());

    // saving a preset of yours is a new version of it, in place
    await slider4(0.35);
    check('editing it says so over its cloud chip', await chipIs4(`● edited · ☁ #${freshId} v1`), await chip4());
    const preV = await save4('k4 fresh');
    await waitCall(POSTS, p1 + 2);
    const ver = lastCall(POSTS);
    check('save again pre-fills its name and POSTs a new version of it, with no parent', preV === 'k4 fresh' && ver.path === `/api/presets/${freshId}/versions` && !('parent' in ver.body) && near(ver.body.params.cloud_thickness, 0.35), JSON.stringify({ ...ver, body: '…' }));
    check('the chip reads v2', await chipIs4(`☁ #${freshId} v2`), await chip4());

    // folders: a chip moves the look out of uncategorized and back, with no request of its own for uncategorized
    check('under the save row: in: with a chip per folder, none lit', await chipsAre4('morning:false,evening:false'), await chips4());
    await clickChip4('morning');
    await waitCall(/^PUT \/api\/playlists\/8\/items$/);
    const m1 = putAfter('/api/playlists/8/items');
    await until(async () => (await value4(1)) === 'arb:8');
    check('adding to morning GETs it fresh and appends this look\'s preset; the look is no longer uncategorized and the editor follows it into the folder',
      m1.before.path === '/api/playlists/8' && JSON.stringify(m1.put.body.items.map((i) => i.preset_id)) === JSON.stringify([freshId]) && (await value4(1)) === 'arb:8' && (await selectedText4(0)) === 'k4 fresh' && await chipsAre4('morning:true,evening:false'), JSON.stringify(m1.put.body) + await chips4());
    await goList4('uncategorized', 'arb:unc');
    check('and uncategorized no longer lists it', !(await opts4(0)).includes('k4 fresh'), (await opts4(0)).join());
    await goList4('morning', 'arb:8');
    await clickChip4('morning');
    await waitCall(/^PUT \/api\/playlists\/8\/items$/, 2);
    await until(async () => (await value4(1)) === 'arb:unc');
    check('taking it out of its last folder brings it back to uncategorized, selected there', (await opts4(0)).includes('k4 fresh') && (await selectedText4(0)) === 'k4 fresh' && await chipsAre4('morning:false,evening:false'), `${(await opts4(0)).join()} ${await chips4()}`);
    await clickChip4('evening');
    await waitCall(/^PUT \/api\/playlists\/7\/items$/);
    const e1 = putAfter('/api/playlists/7/items');
    check('adding to evening keeps its other items in their places, the unavailable one sent back with its times',
      e1.before.path === '/api/playlists/7' && JSON.stringify(e1.put.body.items.map((i) => i.preset_id)) === JSON.stringify([5, 6, 99, freshId])
      && e1.put.body.items[2].dwell_s === 40 && e1.put.body.items[2].crossfade_s === 7 && !('unavailable' in e1.put.body.items[2]), JSON.stringify(e1.put.body));

    // a + makes a private playlist, which becomes the active folder and gets a chip
    reply = 'night';
    await click4('#dev .playlist-row button');
    reply = null;
    await until(async () => (await value4(1)) === `arb:${server.nextList - 1}`);
    check('+ prompts, POSTs only the name, and makes the new folder active, with its chip', JSON.stringify(lastCall(/^POST \/api\/playlists$/)?.body) === '{"name":"night"}' && (await opts4(0)).length === 0 && (await chips4()).includes('night:false'), `${await chips4()}`);

    // a save in a folder places it there; and a ★ is not written
    await goList4('evening', 'arb:7');
    await until(async () => (await opts4(0)).join() === 'dawn,ana dusk,k4 fresh');
    await pick4(0, '0');
    await slider4(0.31);
    const before = seen.length;
    const preF = await save4('dawn');
    await until(async () => /#5 v2/.test(await toast4()));
    check('save in a folder pre-fills the item\'s name and POSTs a new version of it, with no items written (the playlist already points at it)', preF === 'dawn' && /^kept in arboretum · #5 v2$/.test(await toast4()) && seen.slice(before).every((c) => c.method !== 'PUT') && (await stars4()).length === 0, await toast4());
    await pick4(0, '1');
    await slider4(0.44);
    await save4('ana dusk, mine');
    await until(async () => (await opts4(0)).join() === 'dawn,ana dusk, mine,k4 fresh');
    const rp = putAfter('/api/playlists/7/items');
    check('save on someone else\'s item makes your own new preset, parented on theirs, in the place of the item: a fresh GET, the unavailable item sent back',
      lastCall(POSTS).body.parent === 'preset:6@3' && rp.before.path === '/api/playlists/7' && rp.put.body.items[1].dwell_s === 12 && rp.put.body.items[2].preset_id === 99 && rp.put.body.items[2].dwell_s === 40, JSON.stringify(rp.put.body));
    await pick4(0, '1');
    await btn4('remove');
    await until(async () => (await opts4(0)).join() === 'dawn,k4 fresh');
    const rm = putAfter('/api/playlists/7/items');
    check('remove takes the item out of the folder from a fresh GET, the unavailable item kept', rm.before.path === '/api/playlists/7' && JSON.stringify(rm.put.body.items.map((i) => i.preset_id)) === JSON.stringify([5, 99, freshId]), JSON.stringify(rm.put.body));
    await goList4('uncategorized', 'arb:unc');
    check('in uncategorized there is no remove or delete (archiving is on arboretum\'s site)', !(await dev4(() => [...document.querySelectorAll('#dev .ctl button')].some((b) => (b.textContent === 'delete' || b.textContent === 'remove') && !b.hidden))));

    // a refusal on a save is shown verbatim and is not queued
    await pick4(0, '0');
    await slider4(0.7);
    server.refuse = { status: 422, body: { error: 'branch_levels must be 1–4', reason: 'out_of_range' } };
    const q0 = (await mirror4()).queue.length;
    await save4(await selectedText4(0));
    await until(async () => (await toast4()) === 'branch_levels must be 1–4');
    check('a 422 on save is in the toast verbatim and the chip title, and nothing waits', (await chipTitle4()).includes('branch_levels must be 1–4') && (await mirror4()).queue.length === q0, `${await toast4()} | ${await chipTitle4()}`);

    // OFFLINE: arboretum cannot be reached; the mirror answers
    const today = new Date().toISOString().slice(0, 10);
    server.down = true;
    await focus4();
    await until(async () => (await opts4(1)).includes('offline'));
    check('with arboretum down, every list still shows from the mirror and the playlist select says offline once', (await opts4(1)).filter((t) => t === 'offline').length === 1 && (await opts4(1)).includes('uncategorized') && (await opts4(0)).length > 0, (await opts4(1)).join());
    check('and the look\'s chip says offline copy, dated by the last refresh', (await chip4()).replace(/^● edited · /, '') === `offline copy · ${today}`, await chip4());
    await goList4('evening', 'arb:7');
    check('a folder opens from the mirror too, without a request that gets through', (await opts4(0)).join() === 'dawn,k4 fresh', (await opts4(0)).join());

    // an offline save waits, shown as such, and goes up in order
    await goList4('uncategorized', 'arb:unc');
    await pick4(0, '0');
    const name0 = await selectedText4(0);
    await slider4(0.77);
    await save4(name0);
    check('an offline save of a preset of yours waits: the chip says ⇡ waiting to go up', await chipIs4('⇡ waiting to go up') && (await mirror4()).queue.length === 1, `${await chip4()} ${(await mirror4()).queue.length}`);
    await goList4('built-ins', 'builtins');
    await pick4(0, 'memories');
    await slider4(0.05);
    await save4('k4 offline');
    await goList4('uncategorized', 'arb:unc');
    check('an offline save of a new look is a pending item at the top of uncategorized, and both wait in the order made', (await opts4(0))[0] === 'k4 offline' && (await mirror4()).queue.map((q) => q.body.name).join() === `${name0},k4 offline`, `${(await opts4(0))[0]} ${(await mirror4()).queue.map((q) => q.body.name)}`);
    await pick4(0, '0');
    check('and its chip says ⇡ waiting to go up', await chipIs4('⇡ waiting to go up'), await chip4());
    const idle = calls(POSTS).length;
    server.down = false;
    await focus4();
    await waitCall(POSTS, idle + 2);
    await until(async () => (await mirror4()).queue.length === 0);
    const pushed = calls(POSTS).slice(idle);
    check('with arboretum back, the next check pushes them in the order they were made', pushed.length === 2 && pushed[0].path.endsWith('/versions') && pushed[0].body.name === name0 && pushed[1].path === '/api/presets' && pushed[1].body.name === 'k4 offline' && pushed[1].body.parent === 'look:memories', JSON.stringify(pushed.map((c) => [c.path, c.body.name])));
    await until(async () => !(await opts4(1)).includes('offline'));
    check('and the offline mark goes, the waiting items are ordinary looks again', !(await opts4(1)).includes('offline') && (await mirror4()).queue.length === 0 && (await chip4()).startsWith('☁ #'), `${(await opts4(1)).join()} ${await chip4()}`);

    // SIGNED OUT AGAIN: the mirror is not shown, saves are local ★s; signing back in resumes
    server.signedIn = false;
    await focus4();
    await until(() => shown4('#dev .arb-cta'));
    check('a session that has ended brings the sign-in line back; the lists are all looks alone — the mirror is kept but not shown', (await opts4(1)).join() === 'all looks' && (await mirror4()).order.length > 2 && !(await shown4('#dev .arb-inrow')) && !(await shown4('#dev .playlist-row button')), `${(await opts4(1)).join()} ${(await mirror4()).order.length}`);
    const idle2 = seen.length, posts2 = calls(POSTS).length;
    await pick4(0, 'afternoon 7');
    await slider4(0.66);
    await save4('local again');
    await page4.waitForTimeout(300);
    check('and a save is a local ★ again, with no request', (await stars4()).join() === 'local again' && calls(POSTS).length === posts2 && seen.slice(idle2).every((c) => c.path === '/api/me' || c.path === '/api/health'), JSON.stringify(seen.slice(idle2).map((c) => `${c.method} ${c.path}`)));
    server.signedIn = true;
    await focus4();
    await until(async () => (await opts4(1)).includes('uncategorized'));
    check('signing in again resumes from the mirror; the local ★ is on its list with the move button, and the notice is not put up again this session', (await opts4(1)).includes('on this browser') && (await opts4(1)).includes('uncategorized') && JSON.stringify(await moveBox4()) === JSON.stringify({ text: '', buttons: ['move to arboretum'] }), `${(await opts4(1)).join()} ${JSON.stringify(await moveBox4())}`);

    check('no request ever carried visibility', seen.every((c) => !/visibility/i.test(`${c.path} ${JSON.stringify(c.body ?? '')}`)), seen.find((c) => /visibility/i.test(JSON.stringify(c.body ?? '')))?.path);
    check('and arboretum raised no alert', alerts.length === 0, alerts.join(' | '));
    const elsewhere = await dev4(() => ['play', 'strip'].filter((id) => /arboretum|☁|uncategorized/i.test(document.getElementById(id).textContent) || document.getElementById(id).querySelector('.arb-inrow, .arb-cta, .arb-status, .arb-who, .arb-move, .look-chip, .arb-in')));
    check('and nothing of it is in the playful sidebar or the zen strip', elsewhere.length === 0, elsewhere.join());
    await ctx4.close();
  }

  // a cloud playlist that is active when the page opens asks /api/me at once, and when arboretum cannot be reached its cached copy plays on
  {
    await page.goto('about:blank');
    const cache = { v: 1, me: null, origin: {}, playlists: { 7: { id: 7, name: 'k4 cached', owner: 'jo', k: null, fetched_at: 1700000000000, unavailable: 0, items: [
      { preset_id: 1, version: 1, owner: 'jo', name: 'one', dwell_s: 2, crossfade_s: 1, params: PRESETS['afternoon 7'] },
      { preset_id: 2, version: 1, owner: 'jo', name: 'two', dwell_s: 2, crossfade_s: 1, params: PRESETS.memories }] } } };
    const ctx5 = await browser.newContext({ viewport: { width: 640, height: 480 } });
    await ctx5.addInitScript(([c]) => {
      if (localStorage.getItem('komorebi.editor')) return;
      localStorage.setItem('komorebi.arboretum', JSON.stringify(c));
      localStorage.setItem('komorebi.editor', JSON.stringify({ mode: 'play', playlist: 'arb:7' }));
    }, [cache]);
    const page5 = await ctx5.newPage();
    page5.setDefaultTimeout(30000);
    page5.on('pageerror', (e) => errors.push(`[after check ${results.length}] page 5: ${e.message}`));
    page5.on('console', (m) => { if (m.type() === 'error' && !(m.text().startsWith('Failed to load resource') && /\/api\//.test(m.location().url))) errors.push(`[after check ${results.length}] page 5 console: ${m.text()}`); });
    const asked5 = [];
    await page5.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      asked5.push(u.pathname);
      const json = (b) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(b) });
      if (u.pathname === '/api/health') return json({ ok: true, engine: 'abc1234' });
      if (u.pathname === '/api/me') return json({ username: 'jo', kind: 'session' });
      if (u.pathname === '/api/playlists') return json({ playlists: [{ id: 7, owner: 'jo', name: 'k4 cached' }] });
      if (u.pathname === '/api/presets') return json({ presets: [] });
      return route.abort('failed');   // the playlist itself cannot be reached
    });
    await page5.goto(`http://127.0.0.1:${port}/editor/index.html`, { waitUntil: 'load' });
    await page5.click('#feel');
    await page5.waitForSelector('#play:not(.hidden)', { timeout: 60000 });
    const got = async () => { const end = Date.now() + 15000; while (Date.now() < end) { if (asked5.includes('/api/me')) return true; await page5.waitForTimeout(60); } return false; };
    check('with a cloud playlist active, /api/me is asked without the advanced panel', await got(), asked5.join());
    await page5.evaluate(() => { const s = document.querySelectorAll('#dev select')[1]; s.value = 'builtins'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page5.waitForTimeout(500);
    await page5.evaluate(() => { const s = document.querySelectorAll('#dev select')[1]; s.value = 'arb:7'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page5.waitForFunction(() => document.querySelector('#dev .look-chip')?.textContent === 'offline copy · 2023-11-14', null, { timeout: 15000 }).catch(() => {});
    const off = await page5.evaluate(() => ({ status: document.querySelector('#dev .look-chip')?.textContent, opts: [...document.querySelectorAll('#dev select')[0].options].map((o) => o.textContent), list: document.querySelectorAll('#dev select')[1].value }));
    check('when the playlist cannot be fetched its cached copy is played, and the look\'s chip says so, with the day it was fetched', off.status === 'offline copy · 2023-11-14' && off.opts.join() === 'one,two' && off.list === 'arb:7', JSON.stringify(off));
    await ctx5.close();
  }
  // ---- LINKS AND PLAY (K5), at /editor/ with page.route standing in for arboretum: the two link shapes, a failed link, playing a playlist, and the cache ----
  {
    await page.goto('about:blank');   // one GL page at a time
    const expected5 = (m) => m.text().startsWith('Failed to load resource') && /\/api\//.test(m.location().url);   // the mock's own 401/404/aborts
    // A page at /editor/ on `hash`; `answer(url, json)` is the mock arboretum behind /api/health. Returns the page and every /api path+query it asked.
    const open5 = async (hash, answer, cache = null) => {
      const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
      if (cache) await ctx.addInitScript(([c]) => {
        if (localStorage.getItem('komorebi.editor')) return;   // only the first load: a reload keeps what the page wrote
        localStorage.setItem('komorebi.arboretum', JSON.stringify(c));
        localStorage.setItem('komorebi.editor', JSON.stringify({ mode: 'play', playlist: 'arb:7' }));
      }, [cache]);
      const pg = await ctx.newPage();
      pg.setDefaultTimeout(30000);
      pg.on('pageerror', (e) => errors.push(`[after check ${results.length}] k5 page: ${e.message}`));
      pg.on('console', (m) => { if (m.type() === 'error' && !expected5(m)) errors.push(`[after check ${results.length}] k5 page console: ${m.text()}`); });
      const seen = [], methods = [];
      await pg.route('**/api/**', (route) => {
        const u = new URL(route.request().url());
        seen.push(u.pathname + u.search);
        methods.push(route.request().method());
        const json = (status, b) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
        return answer(u, json, route);
      });
      await pg.goto(`http://127.0.0.1:${port}/editor/index.html${hash}`, { waitUntil: 'load' });
      return { ctx, pg, seen, methods };
    };
    const healthy = (rest) => (u, json, route) => (u.pathname === '/api/health' ? json(200, { ok: true, engine: 'abc1234' }) : rest(u, json, route));
    const devValue = (pg) => pg.$eval('#dev select', (s) => s.value);
    const until5 = (pg, fn, arg, ms = 60000) => pg.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
    const landed = (pg, value) => until5(pg, (v) => document.querySelector('#dev select').value === v, value);

    // #arboretum=<id>: saved into all looks, lands directly without "feel", the hash is cleared
    {
      const dusk = { id: 12, owner: 'ana', name: 'k5 dusk', version: 2, params: PRESETS.memories };
      const { ctx, pg, seen } = await open5('#arboretum=12', healthy((u, json) => (u.pathname === '/api/presets/12' ? json(200, dusk) : json(401, { error: 'sign in' }))));
      const there = await landed(pg, 'k5 dusk');
      const a = await pg.evaluate(() => ({
        label: [...document.querySelectorAll('#dev select')[0].options].find((o) => o.selected)?.textContent,
        star: 'k5 dusk' in JSON.parse(localStorage.getItem('komorebi.presets') || '{}'),
        origin: JSON.parse(localStorage.getItem('komorebi.arboretum') || '{}').origin?.['k5 dusk'],
        list: JSON.parse(localStorage.getItem('komorebi.editor') || '{}').playlist,
        hash: location.hash,
        intro: document.body.classList.contains('intro'), welcome: getComputedStyle(document.getElementById('welcome')).display,
      }));
      check('#arboretum=12: it asks for preset 12, and without "feel" the dev select reads the imported ★, saved in all looks', there && seen.includes('/api/presets/12') && a.label === '★ k5 dusk' && a.star && a.list === 'local' && !a.intro && a.welcome === 'none', JSON.stringify({ there, ...a }));
      check('it is a synced copy of #12 v2 by ana, and the hash is cleared', a.origin?.id === 12 && a.origin.version === 2 && a.origin.owner === 'ana' && a.origin.synced === true && a.hash === '', JSON.stringify(a));
      await ctx.close();
    }
    // #arboretum=<id>@<n>&k=<token>: that version, with the token, normalised to the head's shape
    {
      const head = { id: 12, owner: 'ana', name: 'k5 head', version: 5, params: PRESETS['afternoon 7'] };
      const v2 = { preset_id: 12, n: 2, name: 'k5 pinned', description: null, tags: [], params: PRESETS.memories, via: 'web', created_at: 1 };
      const { ctx, pg, seen } = await open5('#arboretum=12@2&k=tok', healthy((u, json) => {
        if (u.searchParams.get('k') !== 'tok') return json(404, { error: 'not found' });
        if (u.pathname === '/api/presets/12/versions/2') return json(200, v2);
        return u.pathname === '/api/presets/12' ? json(200, head) : json(404, { error: 'not found' });
      }));
      const there = await landed(pg, 'k5 pinned');
      const rec = await pg.evaluate(() => JSON.parse(localStorage.getItem('komorebi.arboretum') || '{}').origin?.['k5 pinned']);
      check('#arboretum=12@2&k=tok requests /versions/2?k=tok', seen.includes('/api/presets/12/versions/2?k=tok'), seen.join());
      check('and the pinned version lands as a ★ recorded as #12 v2 by the head\'s owner', there && rec?.id === 12 && rec.version === 2 && rec.owner === 'ana' && rec.synced === true, JSON.stringify({ there, rec }));
      await ctx.close();
    }
    // a failed link: afternoon 7, and the reason through the hint
    {
      const { ctx, pg } = await open5('#arboretum=99', healthy((_u, json) => json(404, { error: 'not found' })));
      const said = await until5(pg, () => document.getElementById('hint').textContent === 'arboretum: not found' && !document.getElementById('hint').classList.contains('gone'), null, 20000);   // it is up for ten seconds from the failed fetch
      check('a 404 link shows "arboretum: not found" through the hint', said);
      await pg.keyboard.press('h');
      const keys = await pg.evaluate(() => document.getElementById('hint').textContent);
      check('and H brings the key hints back in its place', /change scene/.test(keys), keys);
      await pg.waitForSelector('#strip:not(.hidden)', { timeout: 60000 });
      check('it lands on afternoon 7', (await devValue(pg)) === 'afternoon 7', await devValue(pg));
      await ctx.close();
    }
    // #arboretum-playlist=<id>&k=<token>: the playlist is active and plays
    {
      const mk = (id, name, params) => ({ preset_id: id, version: 1, owner: 'ana', name, dwell_s: 2, crossfade_s: 1, params });
      const list7 = { id: 7, owner: 'ana', name: 'k5 list', description: null, visibility: 'unlisted', items: [mk(1, 'one', PRESETS['afternoon 7']), mk(2, 'two', PRESETS.memories)], unavailable: 0 };
      const { ctx, pg, seen, methods } = await open5('#arboretum-playlist=7&k=tok', healthy((u, json) => {
        if (u.pathname === '/api/playlists/7') return u.searchParams.get('k') === 'tok' ? json(200, list7) : json(404, { error: 'not found' });
        return json(401, { error: 'sign in' });
      }));
      const prompts5 = [];
      pg.on('dialog', async (d) => { prompts5.push(d.type()); if (d.type() === 'prompt') await d.accept('k5 mine'); else await d.dismiss(); });
      await pg.click('#feel');
      const first = await until5(pg, () => { const s = document.querySelector('#dev select'); return s.value === '0' && [...s.options].map((o) => o.textContent).join() === 'one,two'; });
      check('#arboretum-playlist=7&k=tok requests the playlist with the token, and after "feel" the dev select is on item 0 of it', first && seen.includes('/api/playlists/7?k=tok'), seen.join());
      const kept = await pg.evaluate(() => JSON.parse(localStorage.getItem('komorebi.arboretum') || '{}').playlists?.[7]?.k);
      check('the token is remembered with the cached playlist, and the playlist is the active one', kept === 'tok' && (await pg.evaluate(() => JSON.parse(localStorage.getItem('komorebi.editor')).playlist)) === 'arb:7', String(kept));
      const second = await until5(pg, () => document.querySelector('#dev select').value === '1', null, 30000);
      check('play starts by itself: within the dwell the next item is on', second, await devValue(pg));
      const surfaces = await pg.evaluate(() => Object.fromEntries(['play', 'dev', 'strip'].map((id) => [id, [...document.querySelectorAll(`#${id} .playstop`)].map((b) => `${getComputedStyle(b).display !== 'none'}:${b.textContent}`)])));
      check('while it plays the ■ is in the playful sidebar and the advanced panel, and the zen strip has none', surfaces.play.length === 1 && surfaces.play[0] === 'true:■' && surfaces.dev.length === 1 && surfaces.dev[0] === 'true:■' && surfaces.strip.length === 0, JSON.stringify(surfaces));
      // a weather-slider edit stops it
      await pg.$eval('#play', (el) => {
        const inp = [...el.querySelectorAll('.ctl')].find((r) => r.querySelector('label')?.textContent === 'weather').querySelector('input');
        inp.value = '0.3'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const at = await devValue(pg);
      await pg.waitForTimeout(3800);
      const btns = await pg.evaluate(() => [...document.querySelectorAll('.playstop')].map((b) => b.textContent).join());
      check('a weather-slider edit stops play: the item stays, and the buttons read ▶', (await devValue(pg)) === at && btns === '▶,▶', `${at} -> ${await devValue(pg)} ${btns}`);
      // ‹ steps back, and the dev select follows
      await pg.$eval('#play .preset button:nth-child(1)', (b) => b.click());
      const back = at === '1' ? '0' : '1';
      check('‹ steps back and the dev select follows', await until5(pg, (v) => document.querySelector('#dev select').value === v, back, 15000) && (await pg.$eval('#play .preset .name', (e) => e.textContent)) === (back === '0' ? 'one' : 'two'), `${at} -> ${await devValue(pg)}`);
      // someone else's playlist is read-only (design §3.5)
      const del = await pg.evaluate(() => [...document.querySelectorAll('#dev .ctl button')].filter((b) => b.textContent === 'remove' || b.textContent === 'delete').map((b) => b.hidden));
      check('it is read-only: there is no remove', del.length === 1 && del[0] === true, JSON.stringify(del));
      const before = seen.length;
      await pg.evaluate(() => { const i = [...document.querySelectorAll('#dev .ctl')].find((r) => r.querySelector('label')?.textContent === 'CLOUD').querySelector('input'); i.value = '0.21'; i.dispatchEvent(new Event('input', { bubbles: true })); });
      await pg.evaluate(() => [...document.querySelectorAll('#dev .ctl button')].find((b) => b.textContent === 'save').click());
      await until5(pg, () => document.querySelectorAll('#dev select')[1].value === 'local', null, 15000);
      const mine = await pg.evaluate(() => ({ list: document.querySelectorAll('#dev select')[1].value, value: document.querySelector('#dev select').value, star: 'k5 mine' in JSON.parse(localStorage.getItem('komorebi.presets') || '{}') }));
      check('and save there makes a ★ in all looks and switches to it, writing nothing to arboretum', mine.list === 'local' && mine.value === 'k5 mine' && mine.star && methods.slice(before).every((m) => m === 'GET'), JSON.stringify({ mine, after: seen.slice(before) }));
      // the token comes back with a re-fetch
      await pg.evaluate(() => { const s = document.querySelectorAll('#dev select')[1]; s.value = 'arb:7'; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await until5(pg, () => document.querySelector('#dev select').value !== 'k5 mine', null, 15000);
      check('opening the playlist again fetches it with the token the link carried', seen.filter((p) => p === '/api/playlists/7?k=tok').length === 2, seen.filter((p) => /playlists/.test(p)).join());
      await ctx.close();
    }
    // the cache: with arboretum unreachable a cached playlist still steps
    {
      const cache = { v: 1, me: null, origin: {}, playlists: { 7: { id: 7, name: 'k5 cached', owner: 'ana', k: 'tok', fetched_at: 1700000000000, unavailable: 0, items: [
        { preset_id: 1, version: 1, owner: 'ana', name: 'one', dwell_s: 2, crossfade_s: 1, params: PRESETS['afternoon 7'] },
        { preset_id: 2, version: 1, owner: 'ana', name: 'two', dwell_s: 2, crossfade_s: 1, params: PRESETS.memories }] } } };
      const { ctx, pg } = await open5('', (_u, _json, route) => route.abort('failed'), cache);
      await pg.click('#feel');
      await pg.waitForSelector('#play:not(.hidden)', { timeout: 60000 });
      await pg.waitForTimeout(800);
      const s0 = await pg.$eval('#dev select', (s) => ({ value: s.value, opts: [...s.options].map((o) => o.textContent).join() }));
      await pg.$eval('#play .preset button:nth-child(2)', (b) => b.click());
      const stepped = await until5(pg, () => document.querySelector('#dev select').value === '1', null, 15000);
      check('with every call to arboretum failing, a cached playlist still steps', s0.opts === 'one,two' && stepped && (await pg.$eval('#play .preset .name', (e) => e.textContent)) === 'two', JSON.stringify(s0));
      await ctx.close();
    }
  }
} catch (e) {
  check('smoke run', false, e.message.split('\n')[0]);
}

if (errors.length) { console.log('PAGE ERRORS:'); for (const e of errors) console.log(`  ${e}`); }
const failed = results.filter(([, ok]) => !ok).length + (errors.length ? 1 : 0);
console.log(`\n${results.length} checks, ${failed ? `${failed} FAILED` : 'all pass'}${errors.length ? `, ${errors.length} page errors` : ', no page errors'}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
