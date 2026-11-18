// ============================================================================
// rows.mjs — the advanced panel's rows, audited: does each row rebuild what its key needs, and no more?
//
//   nix run .#rows                       every row, on the looks below (about ten minutes)
//   nix run .#rows -- edge_softness receiver      only those rows
//   nix run .#rows -- --looks 'memories|park 1'   only those looks        --json out.json   the full table
//
// A row's `rebuild` in PARAMS (komorebi-params.js) is the scope the editor runs when its control moves. Too little and the picture is
// stale until something else rebuilds it; too much and every tick of a drag pays for a regrow nothing needed. params.test.js holds the
// rows to what the GROVE's build reads, from its source. The other stages (the source's cut, the bakes, the fill, the carpet) re-run on
// signatures and on what each frame uploads, which no list in the source says whole. So this asks the engine itself, row by row:
//
//   A  a look born with the row's key at another value
//   B  the look as shipped, the key moved to that value on the running engine and the row's scope applied (what the panel does)
//   C  the look as shipped (the key never moved)
//
//   B must be A.  Where A is C the key does nothing on that look, and the look says nothing about the row.
//   Then every CHEAPER scope is tried in B's place: one that still gives A on every look where the key does something is reported
//   as enough. That is a finding to read against the source, not a proof: four looks and one value cannot show every mode.
//
// It reuses the pixel harness's page (harness.html: __run, __liveChange, __diff; the motion frozen, 320×180) on Chrome on the Metal GPU,
// which renders a row in a fraction of the time SwiftShader takes. Two frames count as one when no channel differs by more than TOL:
// a stale frame differs by tens. Exits 1 when a row asks for too little. Same first-run setup as pixels.
// ============================================================================
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { PARAMS, DEFAULTS } from '../engine/komorebi-params.js';
import { PRESETS } from '../presets.js';
import { assertHardwareRenderer, launchBrowser } from './video-lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const jsonOut = opt('--json');
// one look a cast and a camera: the layer cast on the floor, a faithful standing tree in the fall with its fill and carpet, the cloth, the tent, the sky view
const LOOKS = (opt('--looks') ?? 'memories|montebello|curtain 1|tent 1|canopy 1').split('|');
const only = args;
const VARIANT = 'chromium+angle-metal+enable-gpu', TOL = 2, FRAME = 36;
const FROZEN = ['wind_strength', 'weather_variability', 'drift_auto', 'auto_quality', 'adaptive_motion', 'adaptive_idle_fps'];   // harness.html's FREEZE, and HELD below: a row on one of these cannot be audited
// With no frame-rate limit a still scene's frames come faster than its idle rate, and adaptive_motion would re-present the frame from before the change.
const HELD = { adaptive_motion: false };
// what each scope leaves out, cheapest first: the scopes that could stand in for it (komorebi-engine.js apply)
// ('season' and 'density' are not tried for a row that asks for more: on a key outside their own sets they fall back to the full build, so they would always pass)
const CHEAPER = { '': [], bake: [''], source: [''], season: ['', 'bake'], density: ['', 'bake'], canopy: ['', 'bake'], textures: ['', 'bake', 'canopy'] };

// other values for the row's key: across a toggle, every other choice of a select (a mode's choices are not alike: the curtain keeps the cast the
// floor has and the tent does not), or three tenths of a slider's range away
function probes(row, cur) {
  if (row.kind === 't') return [!cur];
  if (row.kind === 'sel' || row.kind === 'sels') return row.choices.map(([, v]) => v).filter((v) => v !== cur);
  const span = row.max - row.min, step = row.step || span / 100;
  const to = cur + 0.3 * span <= row.max ? cur + 0.3 * span : cur - 0.3 * span;
  const v = Math.min(row.max, Math.max(row.min, Math.round(to / step) * step));
  return v === cur ? [] : [v];
}

// What a look born at the new value has to carry beside it for A to be the same look. A zoom moves the camera and never the trees (grove_reach_m), so the look
// born at another view names the reach the shipped look's grove was grown for; without it A would be another grove, and the row would be blamed for the law.
const BESIDE = { view_extent_m: (P) => ({ grove_reach_m: P.grove_reach_m > 0 ? P.grove_reach_m : P.view_extent_m }) };

const rows = Object.entries(PARAMS).filter(([k, d]) => d.row && d.row.rebuild in CHEAPER && !FROZEN.includes(k) && !k.startsWith('show_') && (!only.length || only.includes(k)));
if (!rows.length) { console.error('no such row'); process.exit(2); }

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
const { browser } = await launchBrowser(chromium, VARIANT, ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  await page.route('http://rows.test/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    try { await route.fulfill({ contentType: TYPES[extname(path)] ?? 'application/octet-stream', body: await readFile(resolve(ROOT, `.${path}`)) }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('http://rows.test/test-gl/harness.html');
  await page.waitForFunction(() => typeof window.__liveChange === 'function');
  const info = await page.evaluate(() => window.__glinfo());
  assertHardwareRenderer(info.renderer, VARIANT);
  console.log(`renderer: ${info.renderer}\nlooks: ${LOOKS.join(', ')}   ${rows.length} rows\n`);

  const opts = (look) => (PRESETS[look].faithful_canopy === true ? { rebake: true } : undefined);
  const born = (look, over) => page.evaluate(([p, o, f, q]) => window.__run(p, o, [f], q).then((r) => r.captures[0].id), [look, { ...HELD, ...over }, FRAME, opts(look)]);
  const moved = (look, key, value, scope) => page.evaluate(([p, k, v, q, h]) => window.__liveChange(p, h, k, v, q).then((r) => r.capture.id),
    [look, key, value, { rebake: PRESETS[look].faithful_canopy === true, apply: scope || null }, HELD]);
  const same = async (a, b) => { const d = await page.evaluate(([x, y]) => window.__diff(x, y), [a, b]); return { same: d.equal || d.maxDelta <= TOL, d }; };

  const shipped = {};
  for (const look of LOOKS) {
    shipped[look] = await born(look, {});
    const again = await born(look, {}), d = await same(shipped[look], again);
    if (!d.same) throw new Error(`${look}: two engines born alike differ on this renderer (max Δ${d.d.maxDelta}); nothing below would mean anything`);
  }

  const table = [];
  for (const [key, def] of rows) {
    const scope = def.row.rebuild, entry = { key, scope, looks: {}, stale: [], live: [], enough: null };
    const seen = [];   // every (look, value) where the key did something: { look, value, A }
    for (const look of LOOKS) {
      const P = { ...DEFAULTS, ...PRESETS[look] }, cur = P[key], said = [];
      for (const value of probes(def.row, cur)) {
        try {
          const A = await born(look, { ...BESIDE[key]?.(P), [key]: value });
          if ((await same(A, shipped[look])).same) { said.push('inert'); continue; }
          seen.push({ look, value, A });
          const d = await same(A, await moved(look, key, value, scope));
          if (d.same) said.push('ok');
          else { said.push(`STALE at ${value}: ${d.d.diffPixels} px, max Δ${d.d.maxDelta}`); if (!entry.stale.includes(look)) entry.stale.push(look); }
        } catch (e) { said.push(`error at ${value}: ${e.message.split('\n')[0].slice(0, 80)}`); }
      }
      const bad = said.filter((x) => x !== 'ok' && x !== 'inert');
      entry.looks[look] = !said.length ? 'no other value' : bad.length ? bad.join('; ') : said.includes('ok') ? 'ok' : 'inert';
      if (said.some((x) => x !== 'inert') && said.length) entry.live.push(look);
    }
    // a cheaper scope is enough when it gives A at every look and value where the key does something
    if (!entry.stale.length && seen.length) for (const cheaper of CHEAPER[scope]) {
      let all = true;
      for (const { look, value, A } of seen) if (!(await same(A, await moved(look, key, value, cheaper))).same) { all = false; break; }
      if (all) { entry.enough = cheaper; break; }
    }
    if (entry.stale.length) failed = true;
    const mark = entry.stale.length ? 'TOO LITTLE' : entry.enough !== null ? `'${entry.enough}' is enough here` : entry.live.length ? 'ok' : 'inert on these looks';
    console.log(`${key.padEnd(26)} '${scope}'`.padEnd(40) + mark.padEnd(26) + LOOKS.map((l) => `${l}: ${entry.looks[l]}`).join('   '));
    table.push(entry);
  }

  const little = table.filter((e) => e.stale.length), much = table.filter((e) => e.enough !== null), unseen = table.filter((e) => !e.live.length);
  console.log(`\n${table.length} rows: ${little.length} ask for too little, ${much.length} could ask for less on these looks, ${unseen.length} did nothing on any of them`);
  for (const e of little) console.log(`  TOO LITTLE  ${e.key} '${e.scope}': stale on ${e.stale.join(', ')}`);
  for (const e of much) console.log(`  LESS        ${e.key} '${e.scope}': '${e.enough}' gave the same frame on ${e.live.join(', ')}`);
  if (unseen.length) console.log(`  not seen: ${unseen.map((e) => e.key).join(' ')}`);
  if (jsonOut) await writeFile(jsonOut, JSON.stringify({ renderer: info.renderer, looks: LOOKS, tolerance: TOL, rows: table }, null, 1));
} finally { await browser.close(); }
process.exit(failed ? 1 : 0);
