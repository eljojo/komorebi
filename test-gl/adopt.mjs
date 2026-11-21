// ============================================================================
// adopt.mjs — turning a setting that ships off on by default, and deciding for each built-in look whether it takes it or keeps what it
// was made with (spec/contracts/preservation.md §3–4; GRANDFATHERED in engine/komorebi-params.js). Built-in looks only: a look kept in
// arboretum, a local save or an embed is not touched or measured here.
//
//   nix run .#adopt -- survey key=value [key=value …]      which built-ins the new default moves, and which share a grove (seconds)
//   nix run .#adopt -- render key=value … [--variant 'name:key=*0.82,…'] [--size 640x360] [--dir <folder>]
//                                                          every moved look as it is (a) and as it would ship (b, and c… per variant),
//                                                          rendered and measured, into archive/reviews/<date>-adopt-<keys>/
//   nix run .#adopt -- apply <folder> [--allow-split]      the folder's decisions.json written into the sources, and checked
//   nix run .#adopt -- record                              test/defaults.json brought up to parameters added or removed
//
// HOW A LOOK IS FOUND TO MOVE. presets.js is evaluated twice, in two node processes, once over DEFAULTS as they are and once with the flip
// written into them (the `__world` mode below): a look moves when its params differ. Nothing about how presets.js is written is assumed.
//
// RENDER. The pixel harness's page (harness.html: __run, __diff, __png; the motion frozen) on Chrome on the Metal GPU, as rows.mjs does,
// from the working tree: A and B differ by exactly the params the flip moves. Each look is rendered at a, again at a (two engines born
// alike must agree, or nothing measured means anything), then at b and each variant, all at FRAME ticks, faithful looks re-baked. For each
// column against a: mean |Δ| over the frame (0–255, the mean of the three channels) and the share of pixels any channel of which moves by
// more than 8. A column within TOL of a everywhere is "no visible change" and is never shown as a choice. The motion is frozen, so a key
// that only moves things (the wind's) shows nothing here: judge it on video (nix run .#video).
//
// THE FOLDER. sheets/ (looks most changed first, six to a sheet: a, b, c…, where b moves (Δ ×16), and a zoom of a and b where the
// change is small), frames/<id>.png at full size, where an id is the look's rank and its column (3b), index.html (the choices, a pick per
// look, and the decisions.json it makes), manifest.json (the flip, the params, the commit, source hashes, every frame's hash), README.md
// to fill in, and src/ (this script and its lib, as they ran).
//
// APPLY. decisions.json is { picks: { "<look>": "a"|"b"|"c"… }, rest: "b"|null, why: { "<look>": "the artist's words" } }: a look the
// picks leave out takes `rest`; a look whose frame did not move takes b. It refuses when the tree's looks are no longer the ones the
// render saw, and when the picks would set apart two looks that share a grove on a key a route reads (--allow-split says that is meant).
// Then it writes the new defaults and GRANDFATHERED (komorebi-params.js), pins the kept looks' old values and the variants' values
// (presets.js), and rewrites test/defaults.json; evaluates presets.js again and holds every look to what it was shown as; and lists what
// is left to write by hand. It commits nothing.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addGrandfathered, checkRecord, flipTravels, groveGroups, keysPhrase, lookOrder, paramsKey, parseFlip, parseVariant, pick, pinLook,
  recordText, resolvePicks, resolveVariant, setDefault, setInLook, splitGroups, survey,
} from './adopt-lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RECORD = join(ROOT, 'test/defaults.json');
const SOURCES = ['engine/komorebi-params.js', 'presets.js', 'test-gl/adopt.mjs', 'test-gl/adopt-lib.mjs', 'test-gl/harness.html'];
const VARIANT = 'chromium+angle-metal+enable-gpu', TOL = 2, FRAME = 36, MOVE = 8, PER_SHEET = 6, TILE = [400, 225];
const HELD = { adaptive_motion: false };   // with no frame-rate limit a still scene's frames come faster than its idle rate (rows.mjs)
const FREEZE = ['wind_strength', 'weather_variability', 'drift_auto', 'auto_quality'];   // harness.html's: a flip of one cannot be rendered there

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---- the two worlds ----
if (process.argv[2] === '__world') {
  const over = JSON.parse(process.argv[3]);
  const P = await import(pathToFileURL(join(ROOT, 'engine/komorebi-params.js')).href);
  Object.assign(P.DEFAULTS, over);   // before presets.js is first imported, so LOOK_DEFAULTS is taken from these
  const { PRESETS, PLAYLISTS } = await import(pathToFileURL(join(ROOT, 'presets.js')).href);
  // exit only once the pipe has taken it all: an exit straight after a write to a pipe cuts it at 64 KB
  await new Promise((done) => process.stdout.write(JSON.stringify({ defaults: P.DEFAULTS, presets: PRESETS, playlists: PLAYLISTS }), done));
  process.exit(0);
}
const world = (over = {}) => JSON.parse(sh(process.execPath, [join(ROOT, 'test-gl/adopt.mjs'), '__world', JSON.stringify(over)]));

const { PARAMS, GRANDFATHERED } = await import(pathToFileURL(join(ROOT, 'engine/komorebi-params.js')).href);
const { FIDELITY_KEYS, PLAYBACK_KEYS } = await import(pathToFileURL(join(ROOT, 'engine/komorebi-session.js')).href);

function flipFrom(args) {
  const { flip, problems } = parseFlip(args, PARAMS, [...FIDELITY_KEYS, ...PLAYBACK_KEYS]);
  for (const k of Object.keys(flip)) if (k in GRANDFATHERED) problems.push(`${k}: already grandfathered once (from ${JSON.stringify(GRANDFATHERED[k])}); a second flip is a hand edit`);
  if (problems.length) throw new Error(problems.join('\n'));
  return flip;
}

// What the flip moves, in the order a person meets the looks, and the groves it could set apart.
function surveyOf(flip) {
  const before = world(), after = world(flip);
  const s = survey(before, after);
  const order = lookOrder(before.presets, before.playlists);
  s.moved.sort((x, y) => order.indexOf(x.look) - order.indexOf(y.look));
  const from = pick(before.defaults, Object.keys(flip));
  const routed = flipTravels(flip, PARAMS);
  const groups = routed.length ? groveGroups(before.presets, s.moved.map((m) => m.look), PARAMS) : [];
  return { before, after, ...s, from, routed, groups };
}

function printSurvey(flip, s) {
  for (const [k, v] of Object.entries(flip)) console.log(`${k}: ${JSON.stringify(s.from[k])} → ${JSON.stringify(v)}   (travels: ${PARAMS[k].travels})`);
  console.log(`\n${Object.keys(s.before.presets).length} built-ins: ${s.moved.length} move, ${s.still.length} do not`);
  const extra = s.moved.filter((m) => m.keys.some((k) => !(k in flip)));
  for (const m of s.moved) console.log(`  moves  ${m.look}${extra.includes(m) ? `   (also ${m.keys.filter((k) => !(k in flip)).join(', ')})` : ''}`);
  if (s.still.length) console.log(`  not moved  ${s.still.join(' · ')}`);
  if (s.routed.length) {
    console.log(`\n${s.routed.join(', ')} ${s.routed.length > 1 ? 'travel' : 'travels'} with the grove: looks that share one should be decided together`);
    for (const g of s.groups) console.log(`  one grove: ${g.join(' · ')}`);
    if (!s.groups.length) console.log('  no two moved looks share a grove');
  }
}

// ---- render ----
async function render(flip, variants, size, dirArg) {
  for (const k of Object.keys(flip)) if (FREEZE.includes(k)) throw new Error(`${k}: the harness freezes it for every frame, so a still cannot show it`);
  const s = surveyOf(flip);
  printSurvey(flip, s);
  if (!s.moved.length) { console.log('\nnothing moves: nothing to render'); return; }
  if (!existsSync(join(ROOT, 'test-gl/node_modules'))) throw new Error('first run: cd test-gl && npm install && npx playwright install chromium');
  const dir = resolve(dirArg ?? join(ROOT, 'archive/reviews', `${today()}-adopt-${Object.keys(flip).join('-')}`));
  if (existsSync(join(dir, 'manifest.json'))) throw new Error(`${dir} already holds a render: one folder, one question (--dir for another)`);
  mkdirSync(join(dir, 'frames'), { recursive: true }); mkdirSync(join(dir, 'sheets'), { recursive: true }); mkdirSync(join(dir, 'src'), { recursive: true });
  const columns = [{ letter: 'a', name: 'as it is', over: () => ({}) }, { letter: 'b', name: `${Object.entries(flip).map(([k, v]) => `${k} ${v}`).join(', ')}`, over: (m) => m.over }];
  for (const [i, v] of variants.entries()) columns.push({ letter: String.fromCharCode(99 + i), name: `b + ${v.name}`, variant: v, over: (m) => ({ ...m.over, ...resolveVariant(v, s.after.presets[m.look]) }) });

  const { chromium } = await import('playwright');
  const { assertHardwareRenderer, launchBrowser } = await import('./video-lib.mjs');
  const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
  const { browser } = await launchBrowser(chromium, VARIANT, ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
  const rows = [];
  let renderer;
  try {
    const page = await browser.newPage({ viewport: { width: Math.max(size[0], 640), height: Math.max(size[1], 360) }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(600000);
    await page.route('http://adopt.test/**', async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      try { await route.fulfill({ contentType: TYPES[extname(path)] ?? 'application/octet-stream', body: readFileSync(resolve(ROOT, `.${path}`)) }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('http://adopt.test/test-gl/harness.html');
    await page.waitForFunction(() => typeof window.__run === 'function');
    renderer = (await page.evaluate(() => window.__glinfo())).renderer;
    assertHardwareRenderer(renderer, VARIANT);
    console.log(`\nrenderer: ${renderer}   ${size.join('×')}   ${s.moved.length} looks × ${columns.length} columns`);
    await page.evaluate(PAGE_HELPERS);

    for (const m of s.moved) {
      const opts = { size, ...(s.before.presets[m.look].faithful_canopy === true ? { rebake: true } : {}) };
      const born = (over) => page.evaluate(([p, o, f, q]) => window.__run(p, o, [f], q).then((r) => r.captures[0]), [m.look, { ...HELD, ...over }, FRAME, opts]);
      const a = await born({}), again = await born({});
      const d0 = await page.evaluate(([x, y]) => window.__diff(x, y), [a.id, again.id]);
      if (!d0.equal && d0.maxDelta > TOL) throw new Error(`${m.look}: two engines born alike differ on this renderer (max Δ${d0.maxDelta}); nothing measured would mean anything`);
      const cells = [{ letter: 'a', over: {}, hash: a.hash, png: await page.evaluate((id) => window.__png(id), a.id) }];
      for (const c of columns.slice(1)) {
        const over = c.over(m), cap = await born(over);
        const st = await page.evaluate(([x, y]) => window.__adoptMeasure(x, y), [a.id, cap.id]);
        cells.push({ letter: c.letter, over, hash: cap.hash, ...st });
      }
      const top = Math.max(...cells.slice(1).map((c) => c.mean));
      const visible = cells.slice(1).some((c) => !c.same);
      rows.push({ look: m.look, keys: m.keys, cells, top, visible, before: paramsKey({ ...s.before.defaults, ...s.before.presets[m.look] }) });
      console.log(`  ${m.look.padEnd(34)} ${cells.slice(1).map((c) => `${c.letter} ${c.same ? 'no visible change' : `mean ${c.mean.toFixed(2)}  ${(c.moved * 100).toFixed(1)} %`}`).join('   ')}`);
    }

    // most changed first; a look no column moves visibly is listed, never shown as a choice
    const shown = rows.filter((r) => r.visible).sort((x, y) => y.top - x.top);
    shown.forEach((r, i) => { r.rank = i + 1; });
    for (const r of shown) for (const c of r.cells) {
      c.id = `${r.rank}${c.letter}`;
      writeFileSync(join(dir, 'frames', `${c.id}.png`), Buffer.from(c.png.split(',')[1], 'base64'));
      c.file = `frames/${c.id}.png`; c.sha256 = sha256(join(dir, c.file));
    }
    for (let i = 0; i < shown.length; i += PER_SHEET) {
      const part = shown.slice(i, i + PER_SHEET);
      const file = `sheets/looks-${String(i / PER_SHEET + 1).padStart(2, '0')}.png`;
      const title = `${Object.entries(flip).map(([k, v]) => `${k} ${JSON.stringify(s.from[k])} → ${JSON.stringify(v)}`).join(', ')}  ·  ${columns.map((c) => `${c.letter} ${c.name}`).join('  ·  ')}`;
      const png = await page.evaluate(([rs, t, tile]) => window.__adoptSheet(rs, t, tile), [part.map((r) => ({ rank: r.rank, look: r.look, cells: r.cells.map((c) => ({ letter: c.letter, id: c.id, png: c.png, mean: c.mean, moved: c.moved, same: c.same, diff: c.diff, zoom: c.zoom })) })), title, TILE]);
      writeFileSync(join(dir, file), Buffer.from(png.split(',')[1], 'base64'));
      for (const r of part) r.sheet = file;
      console.log(join(dir, file));
    }
  } finally { await browser.close(); }

  const commit = sh('git', ['rev-parse', 'HEAD']).trim();
  const dirty = sh('git', ['status', '--porcelain', '--', ...SOURCES]).trim();
  for (const f of ['test-gl/adopt.mjs', 'test-gl/adopt-lib.mjs']) copyFileSync(join(ROOT, f), join(dir, 'src', f.split('/').pop()));
  const strip = (r) => ({ look: r.look, rank: r.rank ?? null, sheet: r.sheet ?? null, visible: r.visible, keys: r.keys, before: r.before,
    cells: r.cells.map((c) => ({ letter: c.letter, id: c.id ?? null, file: c.file ?? null, over: c.over, harness_hash: c.hash, sha256: c.sha256 ?? null,
      ...(c.letter === 'a' ? {} : { mean: c.mean, moved: c.moved, max: c.max, same: c.same }) })) });
  const manifest = {
    folder: relative(ROOT, dir).startsWith('..') ? dir : relative(ROOT, dir),
    question: `Turn ${keysPhrase(Object.keys(flip)).replace(/ (was|were)$/, '')} on by default: which built-in looks take it, and which keep what they were made with?`,
    flip, from: s.from, variants: variants.map((v) => ({ letter: columns.find((c) => c.variant === v).letter, ...v })),
    columns: columns.map((c) => ({ letter: c.letter, name: c.name })),
    routed: s.routed, groups: s.groups, still: s.still,
    how_rendered: { tool: 'test-gl/adopt.mjs render (src/ holds it as it ran)', page: 'test-gl/harness.html __run, motion frozen', renderer, variant: VARIANT,
      size, frame: FRAME, tolerance: TOL, moved_threshold: MOVE, tree: `working tree on ${commit}${dirty ? ', with uncommitted changes to the sources' : ''}` },
    commit, dirty: dirty || null,
    sources: Object.fromEntries(SOURCES.map((f) => [f, sha256(join(ROOT, f))])),
    looks: rows.map(strip),
  };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
  writeFileSync(join(dir, 'index.html'), indexHtml(manifest, rows));
  writeFileSync(join(dir, 'README.md'), readme(manifest, rows));
  const quiet = rows.filter((r) => !r.visible).map((r) => r.look);
  console.log(`\n${rows.filter((r) => r.visible).length} looks move visibly${quiet.length ? `; no visible change on ${quiet.join(', ')}` : ''}\n${join(dir, 'index.html')}`);
}

// In the page: measure a capture against another, and lay sheets out. Strings, so the node side never needs a PNG decoder.
const PAGE_HELPERS = `(() => {
  const TOL = ${TOL}, MOVE = ${MOVE};
  async function pixels(url){ const img = new Image(); img.src = url; await img.decode(); const c = new OffscreenCanvas(img.width, img.height);
    const x = c.getContext('2d'); x.drawImage(img, 0, 0); return { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data, img }; }
  window.__adoptMeasure = async (aId, bId) => {
    const exact = window.__diff(aId, bId), png = window.__png(bId);
    if (exact.equal) return { png, mean: 0, moved: 0, max: 0, same: true, diff: null, zoom: null };
    const A = await pixels(window.__png(aId)), B = await pixels(png), n = A.w * A.h;
    let sum = 0, moved = 0; const cell = new Float64Array(16 * 16);
    for (let p = 0; p < n; p++) { const i = p * 4; let t = 0, m = 0;
      for (let k = 0; k < 3; k++) { const d = Math.abs(A.d[i + k] - B.d[i + k]); t += d; if (d > m) m = d; }
      sum += t / 3; if (m > MOVE) moved++;
      cell[Math.floor((Math.floor(p / A.w) / A.h) * 16) * 16 + Math.floor(((p % A.w) / A.w) * 16)] += t; }
    const mean = sum / n;
    // where a change is small it is shown zoomed: the quarter-size window (4×4 of the 16×16 cells) that moves most
    let best = -1, bx = 0, by = 0;
    for (let y = 0; y <= 12; y++) for (let x = 0; x <= 12; x++) { let s = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) s += cell[(y + j) * 16 + x + i]; if (s > best) { best = s; bx = x; by = y; } }
    return { png, mean, moved: moved / n, max: exact.maxDelta, same: exact.maxDelta <= TOL, diff: exact.png, zoom: mean < 2 ? [bx / 16, by / 16, 0.25, 0.25] : null };
  };
  window.__adoptSheet = async (rows, title, [tw, th]) => {
    const lab = 22, pad = 6, head = 30;
    const tiles = rows.map((r) => { const t = [];
      for (const c of r.cells) t.push({ url: c.png, label: c.letter === 'a' ? c.id : c.id + (c.same ? '  no visible change' : '  mean ' + c.mean.toFixed(2) + '  ' + (c.moved * 100).toFixed(1) + ' %') });
      for (const c of r.cells) if (c.diff) t.push({ url: c.diff, label: 'where ' + c.id + ' moves (×16)' });
      const z = r.cells.find((c) => c.zoom);
      if (z) for (const c of [r.cells[0], z]) t.push({ url: c.png, label: c.id + ' zoomed', crop: z.zoom });
      return t; });
    const cols = Math.max(...tiles.map((t) => t.length));
    const k = document.createElement('canvas'); k.width = pad + cols * (tw + pad); k.height = head + rows.length * (lab * 2 + th + pad);
    const x = k.getContext('2d'); x.fillStyle = '#1e1e1e'; x.fillRect(0, 0, k.width, k.height);
    x.fillStyle = '#eee'; x.font = 'bold 15px sans-serif'; x.fillText(title, pad, 20);
    for (let r = 0; r < rows.length; r++) {
      const y0 = head + r * (lab * 2 + th + pad);
      x.fillStyle = '#fff'; x.font = 'bold 14px sans-serif'; x.fillText(rows[r].rank + '. ' + rows[r].look, pad, y0 + 15);
      for (let i = 0; i < tiles[r].length; i++) { const t = tiles[r][i], X = pad + i * (tw + pad), Y = y0 + lab;
        const img = new Image(); img.src = t.url; await img.decode();
        if (t.crop) x.drawImage(img, t.crop[0] * img.width, t.crop[1] * img.height, t.crop[2] * img.width, t.crop[3] * img.height, X, Y, tw, th);
        else x.drawImage(img, X, Y, tw, th);
        x.fillStyle = '#ccc'; x.font = '12px sans-serif'; x.fillText(t.label, X, Y + th + 15); }
    }
    return k.toDataURL('image/png');
  };
})()`;

function readme(m, rows) {
  const shown = rows.filter((r) => r.visible).sort((x, y) => x.rank - y.rank);
  const quiet = rows.filter((r) => !r.visible).map((r) => r.look);
  const cols = m.columns.slice(1);
  const out = [
    `# ${Object.keys(m.flip).join(', ')} on by default (${today()})`, '',
    `${Object.entries(m.flip).map(([k, v]) => `\`${k}\` ${JSON.stringify(m.from[k])} → ${JSON.stringify(v)}`).join(', ')}. A is each built-in look today, ${m.columns.slice(1).map((c) => `${c.letter.toUpperCase()} ${c.name}`).join(', ')}. ${m.how_rendered.tree}; ${m.how_rendered.renderer}, ${m.how_rendered.size.join('×')}, motion frozen.`, '',
    `Most changed first (mean |A−B| of 255, share of pixels moving by more than ${MOVE}):`, '',
    `| id | look | ${cols.map((c) => `${c.letter} mean | ${c.letter} pixels`).join(' | ')} | sheet |`,
    `|---|---|${cols.map(() => '---|---').join('|')}|---|`,
    ...shown.map((r) => `| ${r.rank} | ${r.look} | ${r.cells.slice(1).map((c) => (c.same ? '— | —' : `${c.mean.toFixed(1)} | ${(c.moved * 100).toFixed(1)} %`)).join(' | ')} | \`${r.sheet}\` |`), '',
  ];
  if (quiet.length) out.push(`No visible change in the still (they take the new default): ${quiet.join(', ')}.`, '');
  if (m.still.length) out.push(`Not moved (they name the key): ${m.still.join(', ')}.`, '');
  if (m.groups.length) out.push(`Share a grove, and ${m.routed.join(', ')} travels with it: ${m.groups.map((g) => g.join(' · ')).join('; ')}.`, '');
  out.push('**Seen.** (to write)', '', "## José's pick", '', '(pending; then decisions.json beside this file, and `nix run .#adopt -- apply <this folder>`)', '');
  return out.join('\n');
}

// The page the artist picks on: the looks most changed first, a pick per look, and the decisions.json the picks make.
function indexHtml(m, rows) {
  const shown = rows.filter((r) => r.visible).sort((x, y) => x.rank - y.rank)
    .map((r) => ({ rank: r.rank, look: r.look, sheet: r.sheet, cells: r.cells.map((c) => ({ letter: c.letter, id: c.id, file: c.file, mean: c.mean ?? 0, moved: c.moved ?? 0, same: c.same ?? false })) }));
  const data = { flip: m.flip, from: m.from, columns: m.columns, groups: m.groups, routed: m.routed, quiet: rows.filter((r) => !r.visible).map((r) => r.look), still: m.still, looks: shown };
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${Object.keys(m.flip).join(', ')} on by default</title>
<style>
:root { --bg: #161616; --fg: #e8e8e8; --dim: #9a9a9a; --line: #333; --warn: #ffb454; --pick: #7fd88f; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; } p { color: var(--dim); margin: 4px 0 12px; }
.look { border-top: 1px solid var(--line); padding: 10px 0; }
.look h2 { font-size: 15px; margin: 0 0 6px; }
.cells { display: flex; gap: 8px; flex-wrap: wrap; }
.cell { width: 320px; max-width: 100%; }
.cell img { width: 100%; display: block; cursor: zoom-in; }
.cell label { display: flex; gap: 6px; align-items: center; margin-top: 4px; cursor: pointer; }
.cell.on img { outline: 3px solid var(--pick); }
.why { width: 100%; max-width: 660px; margin-top: 6px; background: #222; color: var(--fg); border: 1px solid var(--line); padding: 4px; }
#warn { color: var(--warn); white-space: pre-wrap; }
textarea#out { width: 100%; height: 140px; background: #222; color: var(--fg); border: 1px solid var(--line); font: 12px ui-monospace, monospace; }
.bar { position: sticky; top: 0; background: var(--bg); padding: 8px 0; z-index: 1; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
button, select { background: #2a2a2a; color: var(--fg); border: 1px solid var(--line); padding: 4px 10px; }
</style>
<h1>${Object.entries(m.flip).map(([k, v]) => `${k} ${JSON.stringify(m.from[k])} → ${JSON.stringify(v)}`).join(', ')}</h1>
<p>${m.columns.map((c) => `<b>${c.letter}</b> ${c.name}`).join(' · ')}. Most changed first. Pick per look; a look you leave unpicked takes the default below.</p>
<div class="bar">unpicked looks take <select id="rest"></select> <button id="save">save decisions.json</button> <span id="warn"></span></div>
<div id="looks"></div>
<p id="quiet"></p>
<h2 style="font-size:15px">decisions.json</h2>
<textarea id="out" readonly></textarea>
<script>
const D = ${JSON.stringify(data)};
const picks = {}, why = {};
const rest = document.getElementById('rest');
for (const c of [{ letter: '', name: 'no default: pick every look' }, ...D.columns]) rest.add(new Option(c.letter ? c.letter + ' — ' + c.name : c.name, c.letter));
rest.value = 'b';
const root = document.getElementById('looks');
for (const l of D.looks) {
  const box = document.createElement('div'); box.className = 'look';
  box.innerHTML = '<h2>' + l.rank + '. ' + l.look + '</h2><div class="cells"></div><input class="why" placeholder="why (optional, kept beside the pin)">';
  const cells = box.querySelector('.cells');
  for (const c of l.cells) {
    const d = document.createElement('div'); d.className = 'cell'; d.dataset.letter = c.letter;
    const stat = c.letter === 'a' ? 'as it is' : c.same ? 'no visible change' : 'mean ' + c.mean.toFixed(2) + ' · ' + (c.moved * 100).toFixed(1) + ' % of pixels';
    d.innerHTML = '<a href="' + c.file + '" target="_blank"><img loading="lazy" src="' + c.file + '"></a><label><input type="radio" name="p' + l.rank + '" value="' + c.letter + '"> <b>' + c.id + '</b> ' + stat + '</label>';
    cells.appendChild(d);
  }
  box.addEventListener('change', (e) => { if (e.target.type === 'radio') { picks[l.look] = e.target.value; update(); } });
  box.querySelector('.why').addEventListener('input', (e) => { if (e.target.value.trim()) why[l.look] = e.target.value.trim(); else delete why[l.look]; update(); });
  root.appendChild(box);
}
document.getElementById('quiet').textContent = (D.quiet.length ? 'No visible change in the still (they take the new default): ' + D.quiet.join(', ') + '. ' : '') + (D.still.length ? 'Not moved (they name the key): ' + D.still.join(', ') + '.' : '');
rest.addEventListener('change', update);
function chosen(look) { return picks[look] ?? (rest.value || null); }
function update() {
  for (const box of root.children) { const l = D.looks[[...root.children].indexOf(box)]; for (const d of box.querySelectorAll('.cell')) d.classList.toggle('on', d.dataset.letter === chosen(l.look)); }
  const warn = [];
  const missing = D.looks.filter((l) => !chosen(l.look));
  if (missing.length) warn.push(missing.length + ' looks have no pick');
  // looks that share a grove travel without a dissolve only while they agree on the flip
  for (const g of D.groups) { const ps = new Set(g.map((look) => { const p = chosen(look) ?? 'b'; return p === 'a' ? 'a' : 'b+'; })); if (ps.size > 1) warn.push('one grove, split: ' + g.map((look) => look + ' ' + (chosen(look) ?? 'b')).join(' · ')); }
  document.getElementById('warn').textContent = warn.join('\\n');
  document.getElementById('out').value = JSON.stringify({ picks, rest: rest.value || null, why }, null, 1);
}
document.getElementById('save').addEventListener('click', () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([document.getElementById('out').value + '\\n'], { type: 'application/json' }));
  a.download = 'decisions.json'; a.click();
});
update();
</script>
`;
}

// ---- apply ----
function apply(dirArg, allowSplit) {
  const dir = resolve(dirArg);
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const decisions = JSON.parse(readFileSync(join(dir, 'decisions.json'), 'utf8'));
  const flip = flipFrom(Object.entries(m.flip).map(([k, v]) => `${k}=${JSON.stringify(v)}`));
  const s = surveyOf(flip);
  // the tree must hold the looks the render showed, or the picks are about other pictures
  const drift = [];
  const now = new Map(s.moved.map((x) => [x.look, x]));
  for (const l of m.looks) {
    if (!now.has(l.look)) drift.push(`${l.look}: the flip no longer moves it`);
    else if (paramsKey({ ...s.before.defaults, ...s.before.presets[l.look] }) !== l.before) drift.push(`${l.look}: its params changed since the render`);
  }
  for (const x of s.moved) if (!m.looks.some((l) => l.look === x.look)) drift.push(`${x.look}: moved now, not rendered`);
  if (drift.length) throw new Error(`the looks are not the ones rendered; render again:\n  ${drift.join('\n  ')}`);

  const { picks, problems } = resolvePicks(decisions, m.looks, m.columns);
  if (problems.length) throw new Error(`decisions.json:\n  ${problems.join('\n  ')}`);
  // what each look must be once the sources are written: a as it is, b the after world, c… b with the variant's values as rendered
  const expected = {};
  for (const l of m.looks) {
    const cell = l.cells.find((c) => c.letter === picks[l.look]);
    expected[l.look] = picks[l.look] === 'a' ? s.before.presets[l.look] : { ...s.before.presets[l.look], ...cell.over };
  }
  const split = splitGroups(m.groups, picks, m.routed, expected);
  if (split.length && !allowSplit) throw new Error(`these share a grove today and would not (--allow-split if that is meant):\n  ${split.map((g) => g.join(' · ')).join('\n  ')}`);

  const keys = Object.keys(flip), why = decisions.why ?? {};
  const pPath = join(ROOT, 'engine/komorebi-params.js'), lPath = join(ROOT, 'presets.js');
  let params = readFileSync(pPath, 'utf8'), presets = readFileSync(lPath, 'utf8');
  for (const [k, v] of Object.entries(flip)) params = setDefault(params, k, v);
  params = addGrandfathered(params, m.from);
  for (const l of m.looks) {
    const p = picks[l.look], said = why[l.look] ? `; ${why[l.look]}` : '';
    if (p === 'a') presets = pinLook(presets, l.look, pick(s.before.presets[l.look], l.keys), `kept as made, from before ${keysPhrase(keys)} on by default (GRANDFATHERED in komorebi-params.js)${said}`);
    else if (p !== 'b') {
      const cell = l.cells.find((c) => c.letter === p), v = m.variants.find((x) => x.letter === p);
      const values = Object.fromEntries(Object.entries(cell.over).filter(([k]) => !keys.includes(k)));
      presets = setInLook(presets, l.look, values, `took ${keys.join(', ')} with ${v.name}: ${Object.entries(values).map(([k, x]) => `${k} ${x}`).join(', ')}${said}`);
    }
  }
  writeFileSync(pPath, params);
  writeFileSync(lPath, presets);

  // held to what was shown: evaluate presets.js as now written
  const fresh = world();
  const wrong = [];
  for (const look of Object.keys(s.before.presets)) {
    const want = expected[look] ?? s.after.presets[look];   // a look the flip does not move is what it was
    const got = fresh.presets[look];
    if (paramsKey(got) !== paramsKey(want)) wrong.push(`${look}: ${Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k])).join(', ')}`);
  }
  for (const [k, v] of Object.entries(flip)) if (JSON.stringify(fresh.defaults[k]) !== JSON.stringify(v)) wrong.push(`DEFAULTS.${k} is ${JSON.stringify(fresh.defaults[k])}`);
  if (wrong.length) throw new Error(`written, but the looks are not what was picked (the sources are edited; git diff shows how):\n  ${wrong.join('\n  ')}`);
  writeFileSync(RECORD, recordText(fresh.defaults));

  const n = (p) => m.looks.filter((l) => picks[l.look] === p).length;
  console.log(`${keys.join(', ')} on by default. ${n('b')} looks take it, ${n('a')} keep what they were made with${m.variants.map((v) => `, ${n(v.letter)} take it with ${v.name}`).join('')}.`);
  console.log('every built-in evaluates to what it was shown as; test/defaults.json records the new defaults.');
  if (split.length) console.log(`split groves (allowed): ${split.map((g) => g.join(' · ')).join('; ')}`);
  console.log(`\nleft to write by hand:
  - the prose above GRANDFATHERED in engine/komorebi-params.js: what was turned on, which looks keep it off, what a look kept elsewhere takes
  - ${keys.join(', ')}'s comment in PARAMS ("on by default (a look from before it was keeps …: GRANDFATHERED, below)") and its model file in spec/model/
  - spec/contracts/looks.md: the looks kept as made, and why
  - the unit tests that hold the old default (nix run .#test)
  - ${relative(ROOT, join(dir, 'README.md'))}: what was seen, and José's picks, as said`);
}

// ---- record ----
function record() {
  const d = world().defaults;
  const old = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};
  const { changed, added, removed } = checkRecord(old, d);
  if (changed.length) throw new Error(`these defaults changed, which is a flip, not a new parameter (nix run .#adopt -- survey ${changed.map((c) => `${c.key}=${JSON.stringify(c.now)}`).join(' ')}):\n  ${changed.map((c) => `${c.key}: ${JSON.stringify(c.was)} → ${JSON.stringify(c.now)}`).join('\n  ')}`);
  writeFileSync(RECORD, recordText(d));
  if (!Object.keys(old).length) console.log(`test/defaults.json: ${Object.keys(d).length} defaults, recorded`);
  else console.log(`test/defaults.json: ${Object.keys(d).length} defaults${added.length ? `, added ${added.join(', ')}` : ''}${removed.length ? `, removed ${removed.join(', ')}` : ''}`);
}

// ---- the command line ----
const args = process.argv.slice(2);
const take = (name) => { const out = []; for (let i = args.indexOf(name); i >= 0; i = args.indexOf(name)) out.push(args.splice(i, 2)[1]); return out; };
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
try {
  const cmd = args.shift();
  if (cmd === 'survey') { const flip = flipFrom(args); printSurvey(flip, surveyOf(flip)); }
  else if (cmd === 'render') {
    const variants = take('--variant').map(parseVariant), size = (take('--size')[0] ?? '640x360').split('x').map(Number), dir = take('--dir')[0];
    if (size.length !== 2 || !size.every((n) => Number.isInteger(n) && n > 0)) throw new Error('--size WxH');
    await render(flipFrom(args), variants, size, dir);
  } else if (cmd === 'apply') {
    const allow = flag('--allow-split');
    if (args.length !== 1) throw new Error('apply <folder> [--allow-split]');
    apply(args[0], allow);
  } else if (cmd === 'record') record();
  else throw new Error('usage: adopt survey|render key=value… | apply <folder> | record   (test-gl/adopt.mjs header)');
} catch (e) { console.error(e.message); process.exit(1); }
process.exit(0);
