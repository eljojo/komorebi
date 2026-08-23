// ============================================================================
// run.js — the real-pixel test harness for komorebi. Optional local tooling, not part of the nix flow.
//
//   cd test-gl && npm install && npx playwright install chromium && node run.js
//
// Every other automated check in this repo stops short of a pixel: the bun tests exercise pure modules and
// the shaders are only validated offline. This one renders. It serves the repo over http (ES modules can't
// load from file://), drives headless Chromium — real WebGL2 on SwiftShader/ANGLE, EXT_color_buffer_float
// and all — and compares actual framebuffer bytes.
//
// The point is suite 2. Every gated feature on this engine ships with the same claim: "off is byte-identical
// to the look before it" (the quality-rung contract, spec §9). That claim has always been argued from the
// source. Here it is executed: two engines, same frozen look, one with the gate's whole knob family cranked
// behind a zero gate — and the frames must match to the byte.
//
// Suites: SMOKE (every preset renders, non-degenerate, GL-clean, one PNG each into out/)
//         GATE  (the byte-identical off-path claims)
//         DETERMINISM (two independent engines agree; and a single engine holds still)
// ============================================================================
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));   // the repo root — what gets served
const OUT = join(ROOT, 'test-gl', 'out');
const SMOKE_FRAMES = 60;    // ticks a smoke run renders before its screenshot (long enough for the bake to warm and any governor to settle)
const GATE_FRAMES = 24;     // ticks a gate comparison settles for (motion is frozen, so this only has to clear the bake)
const STILL_FRAMES = [20, 60];   // the stillness proof: one engine, two captures forty ticks apart

// ---------------------------------------------------------------------------
// Suite 2 as data: one row per invariant. `a` and `b` are param overrides merged over the preset (and then
// over the harness's motion freeze); the assertion is always "these two frames are byte-identical".
// Adding an invariant is adding a line.
// ---------------------------------------------------------------------------
const FABRIC_FAMILY = {
  curtain_tt: 0.9, curtain_tint_r: 0.9, curtain_tint_g: 0.2, curtain_tint_b: 0.7,
  fold_depth: 0.9, fold_scale: 1.4, fold_coarsen: 0.9, fold_warp: 0.3,
  velvet_sheen: 1, curtain_scatter: 0.9, curtain_diffuse: 0.5, curtain_diffuse_m: 0.2,
  mullion_tau: 3, mullion_pitch_m: 0.2, mullion_bar_m: 0.04, mullion_depth_m: 0.1,
  window_w_m: 2, window_h_m: 2, window_cx_m: 0.3, window_cy_m: 1.2, window_wall: 0.4,
};

const INVARIANTS = [
  // The whole receiver=1 fabric surface, cranked, against a floor look that never asks for it.
  { name: 'floor look ignores the entire fabric family', preset: 'park 1',
    a: { receiver: 0 }, b: { receiver: 0, ...FABRIC_FAMILY } },
  // The lateral-diffusion tier alone: its gate adds/drops two HDR passes, which is the kind of thing that
  // leaks a rounding difference even when the mix weight is dead.
  { name: 'glow tier off-path: receiver 0 + curtain_diffuse 0.4', preset: 'park 1',
    a: { receiver: 0 }, b: { receiver: 0, curtain_diffuse: 0.4, curtain_diffuse_m: 0.08 } },
  // On the cloth itself, with the two authored-occluder gates shut: their geometry knobs must be dead code.
  { name: 'curtain with mullion_tau 0 / window_w_m 0 ignores their geometry', preset: 'curtain 1',
    a: { mullion_tau: 0, window_w_m: 0, fold_warp: 0 },
    b: { mullion_tau: 0, window_w_m: 0, fold_warp: 0,
         mullion_pitch_m: 0.1, mullion_bar_m: 0.09, mullion_depth_m: 0.5,
         window_h_m: 5, window_cx_m: 1.2, window_cy_m: 3, window_wall: 0.9 } },
  // Zero-vs-absent: cheap, but it pins the DEFAULTS merge path — an off gate whose default is not its off
  // value would show up here and nowhere else.
  { name: 'sway_pitch 0 == absent (layer path)', preset: 'memories', a: {}, b: { sway_pitch: 0 } },
  { name: 'chromatic_aberration 0 == absent (layer path)', preset: 'memories', a: {}, b: { chromatic_aberration: 0 } },
  { name: 'branch_tau 0 == absent (layer path)', preset: 'memories', a: {}, b: { branch_tau: 0 } },
];

// Suite 3: two independently created engines on the same frozen look must land on the same bytes.
// One look per camera: the floor (park 1), the curtain (curtain 1), the layer path (memories), the sky view
// (canopy 1) — the capture road has to be proven on the branch whose pixels are being read, not only the others.
const DETERMINISM = ['park 1', 'curtain 1', 'memories', 'canopy 1'];

// ---------------------------------------------------------------------------
// A ~20-line static file server over the repo root. Deliberately not the bun dev server: this harness must
// run off plain node so it never drags bun into its own dependency story.
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serveRoot() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (file !== ROOT && !file.startsWith(`${ROOT}/`)) { res.writeHead(403).end('forbidden'); return; }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
    } catch { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => { server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })); });
}

// ---------------------------------------------------------------------------
const results = [];
const log = (...a) => console.log(...a);
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const record = (suite, name, pass, detail) => { results.push({ suite, name, pass, detail }); };

async function writePNG(name, dataURL) {
  const file = join(OUT, `${name}.png`);
  await writeFile(file, Buffer.from(dataURL.split(',')[1], 'base64'));
  return file;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { server, port } = await serveRoot();
  const browser = await chromium.launch({
    // SwiftShader/ANGLE is the whole reason this works headless: a real WebGL2 ES 3.00 implementation with
    // EXT_color_buffer_float, and a software rasteriser, so the same bytes come out on any machine.
    // --enable-unsafe-swiftshader is what recent Chrome requires to allow the software fallback for WebGL.
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 640, height: 400 } });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => log(`  [page error] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log(`  [console] ${m.text()}`); });

  let failures = 0;
  try {
    await page.goto(`http://127.0.0.1:${port}/test-gl/harness.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true);

    // ---- preflight: fail loudly, with the fix, rather than letting create() throw twenty times ----
    const info = await page.evaluate(() => window.__glinfo());
    if (!info.webgl2 || !info.colorBufferFloat) {
      log('\nFATAL — headless Chromium did not come up with the context this engine requires.');
      log(`  webgl2: ${!!info.webgl2}   EXT_color_buffer_float: ${!!info.colorBufferFloat}`);
      log('  komorebi\'s create() hard-requires both. Fix: make sure the SwiftShader flags in this file');
      log('  reach Chromium — --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader — and that');
      log('  the browser is the Playwright-managed one (npx playwright install chromium).');
      await browser.close(); server.close();
      process.exit(1);
    }
    log(`WebGL2  ${info.version}`);
    log(`        ${info.glsl}`);
    log(`        renderer: ${info.renderer}   EXT_color_buffer_float: yes   EXT_float_blend: ${info.floatBlend ? 'yes' : 'no'}   dpr: ${info.dpr}`);

    // ---- suite 1: smoke ----
    // Optional CLI filter (substring match on preset names, case-insensitive): renders only the matching
    // looks and SKIPS the gate/determinism suites — the fast authoring loop. No args = the full run.
    const filters = process.argv.slice(2).map((s) => s.toLowerCase());
    const allPresets = await page.evaluate(() => window.__presets());
    const presets = filters.length ? allPresets.filter((n) => filters.some((f) => n.toLowerCase().includes(f))) : allPresets;
    if (filters.length && presets.length === 0) { log(`no preset matches: ${filters.join(', ')}`); await browser.close(); server.close(); process.exit(1); }
    log(`\nSMOKE — ${presets.length} presets @ ${SMOKE_FRAMES} frames`);
    for (const name of presets) {
      let r;
      try {
        r = await page.evaluate(([p, f]) => window.__run(p, {}, [f]), [name, SMOKE_FRAMES]);
      } catch (e) {
        record('smoke', name, false, e.message.split('\n')[0]);
        log(`  FAIL  ${name} — ${e.message.split('\n')[0]}`);
        continue;
      }
      const c = r.captures[0];
      const s = c.stats;
      const bad = [];
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      if (!(s.variance > 1)) bad.push(`flat frame (variance ${s.variance.toFixed(3)})`);
      if (s.blackFrac === 1) bad.push('all-black frame');
      if (s.whiteFrac === 1) bad.push('all-white frame');
      if (!s.opaque) bad.push('non-opaque readback (alpha:false context should read 255)');
      await writePNG(slug(name), await page.evaluate((id) => window.__png(id), c.id));   // out/<preset>.png — the look itself, the artifact this suite exists to produce
      record('smoke', name, bad.length === 0, bad.length ? bad.join('; ')
        : `${c.w}×${c.h} var ${s.variance.toFixed(0)} mean ${s.mean.toFixed(1)} ${r.ms} ms`);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${name.padEnd(14)} var ${s.variance.toFixed(0).padStart(5)}  mean ${s.mean.toFixed(1).padStart(5)}  ${String(r.ms).padStart(6)} ms  ${bad.join('; ')}`);
    }

    // A filtered run is the fast authoring loop: the smoke renders above are its whole point,
    // and the stillness/determinism/gate suites only run on a full sweep.
    if (!filters.length) {
    // ---- suite 3a: stillness — the proof that the capture road and the motion freeze are actually stable.
    // Two captures forty ticks apart out of ONE engine. If wind, weather, drift, the auto-quality governor
    // or the adaptive-fps present path were still moving anything, this is where it shows.
    log(`\nDETERMINISM — stillness (one engine, captures at ${STILL_FRAMES.join(' and ')})`);
    for (const name of DETERMINISM) {
      const r = await page.evaluate(([p, f]) => window.__run(p, {}, f), [name, STILL_FRAMES]);
      const d = await page.evaluate(([x, y]) => window.__diff(x, y), [r.captures[0].id, r.captures[1].id]);
      record('determinism', `${name} holds still`, d.equal, d.equal ? `hash ${r.captures[0].hash}` : `${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}`);
      log(`  ${d.equal ? 'ok  ' : 'FAIL'}  ${name.padEnd(14)} hash ${r.captures[0].hash}  ${d.equal ? '' : `${d.diffPixels} px differ (max Δ${d.maxDelta})`}`);
      if (!d.equal) await writePNG(`diff-still-${slug(name)}`, d.png);
    }

    // ---- suite 3b: two independent engines ----
    log('\nDETERMINISM — two independent engines, same look');
    for (const name of DETERMINISM) {
      const a = await page.evaluate(([p, f]) => window.__run(p, {}, [f]), [name, GATE_FRAMES]);
      const b = await page.evaluate(([p, f]) => window.__run(p, {}, [f]), [name, GATE_FRAMES]);
      const d = await page.evaluate(([x, y]) => window.__diff(x, y), [a.captures[0].id, b.captures[0].id]);
      record('determinism', `${name} reproduces`, d.equal, d.equal ? `hash ${a.captures[0].hash}` : `${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}`);
      log(`  ${d.equal ? 'ok  ' : 'FAIL'}  ${name.padEnd(14)} ${a.captures[0].hash} vs ${b.captures[0].hash}  ${d.equal ? '' : `${d.diffPixels} px differ (max Δ${d.maxDelta})`}`);
      if (!d.equal) await writePNG(`diff-repro-${slug(name)}`, d.png);
    }

    // ---- suite 2: the gate invariants ----
    log(`\nGATE INVARIANTS — byte-identical off-paths @ ${GATE_FRAMES} frames`);
    for (const inv of INVARIANTS) {
      const a = await page.evaluate(([p, o, f]) => window.__run(p, o, [f]), [inv.preset, inv.a, GATE_FRAMES]);
      const b = await page.evaluate(([p, o, f]) => window.__run(p, o, [f]), [inv.preset, inv.b, GATE_FRAMES]);
      const d = await page.evaluate(([x, y]) => window.__diff(x, y), [a.captures[0].id, b.captures[0].id]);
      const tag = inv.known ? 'KNOWN-FAIL' : 'FAIL';
      if (!d.equal) {
        await writePNG(`gate-${slug(inv.name)}-a`, await page.evaluate((id) => window.__png(id), a.captures[0].id));
        await writePNG(`gate-${slug(inv.name)}-b`, await page.evaluate((id) => window.__png(id), b.captures[0].id));
        await writePNG(`diff-${slug(inv.name)}`, d.png);
      }
      record('gate', inv.name, d.equal || !!inv.known,
        d.equal ? `identical (${a.captures[0].hash})` : `${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}, first at ${d.firstAt}${inv.known ? ` — known: ${inv.known}` : ''}`);
      log(`  ${d.equal ? 'ok  ' : tag}  [${inv.preset}] ${inv.name}`);
      if (!d.equal) log(`        ${d.diffPixels}/${d.total} px differ, max Δ${d.maxDelta}, first at (${d.firstAt}) — see out/diff-${slug(inv.name)}.png`);
    }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // ---- the table ----
  const w0 = Math.max(...results.map((r) => r.name.length), 4);
  log(`\n${'─'.repeat(w0 + 60)}`);
  log(`${'SUITE'.padEnd(13)}${'CASE'.padEnd(w0 + 2)}RESULT  DETAIL`);
  log('─'.repeat(w0 + 60));
  for (const r of results) {
    if (!r.pass) failures++;
    log(`${r.suite.padEnd(13)}${r.name.padEnd(w0 + 2)}${(r.pass ? 'pass' : 'FAIL').padEnd(8)}${r.detail}`);
  }
  log('─'.repeat(w0 + 60));
  log(`${results.length} cases, ${results.length - failures} pass, ${failures} fail   ·   screenshots in test-gl/out/`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
