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
//         TRANSITIONS (each routing tier — morph / crossfade / dissolve / mode — driven to completion;
//                      logic-only, no pixels: transitions aren't byte-stable by design)
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
  fabric_tt: 0.9, fabric_tint_r: 0.9, fabric_tint_g: 0.2, fabric_tint_b: 0.7,
  fold_depth: 0.9, fold_scale: 1.4, fold_coarsen: 0.9, fold_warp: 0.3,
  velvet_sheen: 1, fabric_scatter: 0.9, glow_bleed: 0.5, glow_bleed_m: 0.2,
  mullion_tau: 3, mullion_pitch_m: 0.2, mullion_bar_m: 0.04, mullion_depth_m: 0.1,
  window_w_m: 2, window_h_m: 2, window_cx_m: 0.3, window_cy_m: 1.2, window_wall: 0.4,
};

const INVARIANTS = [
  // The whole receiver=1 fabric surface, cranked, against a floor look that never asks for it.
  { name: 'floor look ignores the entire fabric family', preset: 'park 1',
    a: { receiver: 0 }, b: { receiver: 0, ...FABRIC_FAMILY } },
  // The lateral-diffusion tier alone: its gate adds/drops two HDR passes, which is the kind of thing that
  // leaks a rounding difference even when the mix weight is dead.
  { name: 'glow tier off-path: receiver 0 + glow_bleed 0.4', preset: 'park 1',
    a: { receiver: 0 }, b: { receiver: 0, glow_bleed: 0.4, glow_bleed_m: 0.08 } },
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

// Suite 4 as data: one row per transition ROUTING tier. transitionTo classifies the from->to diff into a
// tier, and each tier drives different code — the grove crossfade grows a SECOND grove (buildTargetGrove),
// the mode flip swaps the camera — so a crash or a mis-routed tier is invisible to every frozen-frame suite
// above (none of them ever call transitionTo; a missing-import crash on exactly the crossfade path once
// survived all of them). `over` merges over the `to` preset; the assertion is the engine's own routing
// verdict (trans.crossfade/structDiff, read right after transitionTo) plus onEnd fired and GL stayed clean.
// 'memories' is the base because the crossfade gate needs branch_tau 0 + non-faithful at both ends.
// ---------------------------------------------------------------------------
const TRANSITION_ROUTES = [
  { name: 'live morph stays non-structural', from: 'memories', to: 'memories',
    over: { sun_azimuth_deg: 123, sun_elevation_deg: 47 },
    expect: { crossfade: false, structDiff: false } },
  { name: 'seed-only topology diff takes the grove crossfade', from: 'memories', to: 'memories',
    over: { seed: 1234567 },
    expect: { crossfade: true, structDiff: true } },
  { name: 'wood at the target end closes the crossfade gate', from: 'memories', to: 'memories',
    over: { seed: 7654321, branch_tau: 0.5 },
    expect: { crossfade: false, structDiff: true } },
  { name: 'camera flip routes as a mode transition', from: 'memories', to: 'canopy 1',
    over: {},
    expect: { crossfade: false, structDiff: true } },
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

    // ---- suite 4 (opt-in): TRANSITIONS ----
    // `node run.js --transition "afternoon 7" "canopy 1"` — deliberately NOT part of the default run, because
    // unlike everything else here it is not byte-stable: the wind is live (a frozen transition is not a
    // transition) so two runs differ pixel for pixel. What it produces instead is a NUMBER — the largest
    // frame-to-frame step in mean luminance — and a contact sheet to look at. Repeat the route to see the
    // metric's own spread before reading much into a small change in it.
    if (process.argv[2] === '--transition') {
      const [from, to] = process.argv.slice(3);
      if (!from || !to) { log('usage: node run.js --transition "<from look>" "<to look>"'); await browser.close(); server.close(); process.exit(2); }
      const r = await page.evaluate(([a, b]) => window.__transition(a, b, {}), [from, to]);
      const f = r.frames;
      log(`\nTRANSITION — ${from} -> ${to}   ${r.info.structDiff ? 'STRUCTURAL (dissolve + rebuild under the bloom)' : 'live morph, no bloom'}${r.info.canopyMorph ? ' + grove morph' : ''}`);
      log(`  ${f.length} frames over ${r.ms} ms   (mean luminance is Rec.709 over the whole frame, 0-255)\n`);
      // Absolute churn is CONTRAST-BLIND, and the bloom spends contrast: at its peak the frame is pale, so a
      // wholesale rearrangement moves few grey levels. The normalized column divides by the frame's own spread
      // (√variance), which is the closer stand-in for what an eye adapted to that pale frame actually sees.
      log('   #      t   bloom  swap    luma     Δ   churn   /σ');
      let maxD = 0, maxAt = -1, swapAt = -1, swapD = 0, maxC = 0, maxCAt = -1, swapC = 0, maxN = 0, maxNAt = -1, swapN = 0;
      for (let i = 0; i < f.length; i++) {
        const d = i ? f[i].luma - f[i - 1].luma : 0;
        // trans.swapped flips at t>=0.5 on EVERY route; only a structural one actually swaps anything there.
        const justSwapped = r.info.structDiff && i > 0 && f[i].swapped && !f[i - 1].swapped;
        if (justSwapped) { swapAt = i; swapD = d; swapC = f[i].churn; }
        if (i && Math.abs(d) > Math.abs(maxD)) { maxD = d; maxAt = i; }
        if (i && f[i].churn > maxC) { maxC = f[i].churn; maxCAt = i; }
        const nrm = i ? f[i].churn / Math.max(1, Math.sqrt(f[i].variance)) : 0;
        if (i && nrm > maxN) { maxN = nrm; maxNAt = i; }
        if (justSwapped) swapN = nrm;
        log(`  ${String(i).padStart(2)}  ${f[i].t.toFixed(3)}  ${f[i].bloom.toFixed(3)}  ${justSwapped ? ' <<' : (f[i].swapped ? '  •' : '   ')}  ${f[i].luma.toFixed(2).padStart(7)}  ${(i ? (d >= 0 ? '+' : '') + d.toFixed(2) : '').padStart(7)}  ${(i ? f[i].churn.toFixed(2) : '').padStart(6)}  ${(i ? nrm.toFixed(3) : '').padStart(6)}`);
      }
      const file = join(OUT, `trans-${slug(from)}-${slug(to)}.png`);
      await writeFile(file, Buffer.from((await page.evaluate(([ids, c]) => window.__strip(ids, c), [f.map((x) => x.id), 8])).split(',')[1], 'base64'));
      log(`\n  max |ΔL| per frame   ${Math.abs(maxD).toFixed(2)}   at frame ${maxAt} (t=${f[maxAt] ? f[maxAt].t.toFixed(3) : '-'})`);
      log(`  max CHURN per frame  ${maxC.toFixed(2)}   at frame ${maxCAt} (t=${f[maxCAt] ? f[maxCAt].t.toFixed(3) : '-'})`);
      log(`  max CHURN/σ          ${maxN.toFixed(3)}   at frame ${maxNAt} (t=${f[maxNAt] ? f[maxNAt].t.toFixed(3) : '-'})`);
      if (swapAt >= 0) log(`  the swap frame       ${swapAt}: t=${f[swapAt].t.toFixed(3)}  bloom=${f[swapAt].bloom.toFixed(3)}  ΔL=${(swapD >= 0 ? '+' : '') + swapD.toFixed(2)}  churn=${swapC.toFixed(2)}  churn/σ=${swapN.toFixed(3)}`);
      else log('  the swap frame       none — this route morphs live, nothing is swapped');
      log(`  strip                ${file}`);
      await browser.close(); server.close();
      process.exit(0);
    }

    // ---- suite 1: smoke ----
    // Optional CLI filter (substring match on preset names, case-insensitive): renders only the matching
    // looks and SKIPS the gate/determinism suites — the fast authoring loop. No args = the full run.
    const filters = process.argv.slice(2).map((s) => s.toLowerCase());
    const allPresets = await page.evaluate(() => window.__presets());
    const presets = filters.length ? allPresets.filter((n) => filters.some((f) => n.toLowerCase().includes(f))) : allPresets;
    if (filters.length && presets.length === 0) { log(`no preset matches: ${filters.join(', ')}`); await browser.close(); server.close(); process.exit(1); }
    log(`\nSMOKE — ${presets.length} presets @ ${SMOKE_FRAMES} frames`);
    const truncated = [];   // groves that outgrew the woody-occluder table (§4.5) — see the note under the loop
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
      // THE OCCLUDER CAP (§4.5). A grove that grows more level-≤1 segments than the table holds loses the tail of
      // the grow order — whole later trees render with no bole and no limbs. Nothing looks broken; there is just
      // less wood than the parameters asked for, which is why it went unnoticed for as long as it did. A pixel
      // cannot report it, so the engine does: `want` is what grew, `count` is what fits.
      const cut = r.occ ? r.occ.want - r.occ.count : 0;
      if (cut > 0) truncated.push(`${name} grew ${r.occ.want}, cap ${r.occ.cap} — ${cut} segments of wood dropped`);
      await writePNG(slug(name), await page.evaluate((id) => window.__png(id), c.id));   // out/<preset>.png — the look itself, the artifact this suite exists to produce
      record('smoke', name, bad.length === 0, bad.length ? bad.join('; ')
        : `${c.w}×${c.h} var ${s.variance.toFixed(0)} mean ${s.mean.toFixed(1)} ${r.ms} ms${cut > 0 ? `  WOOD TRUNCATED ${r.occ.want}>${r.occ.cap}` : ''}`);
      log(`  ${bad.length ? 'FAIL' : cut > 0 ? 'WARN' : 'ok  '}  ${name.padEnd(14)} var ${s.variance.toFixed(0).padStart(5)}  mean ${s.mean.toFixed(1).padStart(5)}  ${String(r.ms).padStart(6)} ms  ${bad.join('; ')}`);
    }
    // Loud, but deliberately not a FAILURE: the looks that hit the cap were authored against the truncation, so
    // what ships is what their author saw. Raising MAX_OCC would repaint them, which is a look decision. What this
    // guarantees is that the NEXT grove to outgrow the table says so on the first run instead of never.
    if (truncated.length) { log(`\n  WOOD TRUNCATED — the occluder table is full for these looks:`); for (const t of truncated) log(`    ${t}`); }

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

    // ---- suite 4: transition routing ----
    log('\nTRANSITIONS — each routing tier driven to completion (logic-only; no pixels)');
    for (const route of TRANSITION_ROUTES) {
      let r;
      try {
        r = await page.evaluate(([from, to, over]) => window.__transitionSmoke(from, to, over), [route.from, route.to, route.over]);
      } catch (e) {
        record('transition', route.name, false, e.message.split('\n')[0]);
        log(`  FAIL  ${route.name} — ${e.message.split('\n')[0]}`);
        continue;
      }
      const bad = [];
      if (!r.onEndFired) bad.push('onEnd never fired');
      if (r.glError) bad.push(`gl.getError 0x${r.glError.toString(16)}`);
      for (const [k, v] of Object.entries(route.expect)) if (r[k] !== v) bad.push(`${k}=${r[k]} (want ${v})`);
      record('transition', route.name, bad.length === 0, bad.length ? bad.join('; ')
        : `crossfade ${r.crossfade} structDiff ${r.structDiff}  ${r.ticks} ticks ${r.ms} ms`);
      log(`  ${bad.length ? 'FAIL' : 'ok  '}  ${route.name.padEnd(50)} ${bad.join('; ') || `${r.ticks} ticks ${r.ms} ms`}`);
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
