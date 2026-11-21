// ============================================================================
// adopt.mjs — turning a setting that ships off on by default, and deciding for each built-in look whether it takes it or keeps what it
// was made with (spec/contracts/preservation.md §3–4; GRANDFATHERED in engine/komorebi-params.js). Built-in looks only: a look kept in
// arboretum, a local save or an embed is not touched or measured here.
//
// An upgrade answers four questions before it ships, each a stage that writes its answer into the review folder:
//   the look         render       each moved look as it is (a) and as it would ship (b, c… per variant), on the GPU, measured
//   realtime cost    cost         each moved look's frame at a and at each other column (test-gl/cost.mjs): no pick may lose more than 10 fps,
//                                 and a verdict nearer that limit than A's own runs lie apart (the noise floor) is measured again
//   motion           motion       a minute of video of a and of the pick (render-video.mjs), read by the komorebi pattern measures (pattern.mjs)
//   transitions      transitions  every route the shipped playlists walk with a moved look at either end, as it is and as picked: the route's kind,
//                                 its largest step in brightness, its churn, and a strip of frames; a run twice, for the noise floor
// Every stage prints which questions are still open and the command that answers each; README.md and index.html say the same.
//
//   nix run .#adopt -- survey key=value [key=value …]      which built-ins the new default moves, and which share a grove (seconds)
//   nix run .#adopt -- render key=value … [--variant 'name:key=*0.82,…'] [--size 640x360] [--dir <folder>]
//                                                          into archive/reviews/<date>-adopt-<keys>/ (about a second a look a column)
//   nix run .#adopt -- cost <folder> [--again look …]      about half a minute a look a column; --again measures those looks afresh
//   nix run .#adopt -- motion <folder> [look …]            the three looks the flip moves most when none is named; minutes a look
//   nix run .#adopt -- transitions <folder>                seconds a route, three runs of it; at decisions.json's picks when there is one, else
//                                                          every look at b
//   nix run .#adopt -- status <folder>                     the questions, and what answers each
//   nix run .#adopt -- apply <folder> [--allow-split]      the folder's decisions.json written into the sources, and checked
//   nix run .#adopt -- record                              test/defaults.json brought up to parameters added or removed
//
// HOW A LOOK IS FOUND TO MOVE. presets.js is evaluated twice, in two node processes, once over DEFAULTS as they are and once with the flip
// written into them (the `__world` mode below): a look moves when its params differ. Nothing about how presets.js is written is assumed.
// Every stage after render holds the tree to the looks the render saw, and refuses when they changed.
//
// RENDER. The pixel harness's page (harness.html: __run, __diff, __png; the motion frozen) on Chrome on the Metal GPU, as rows.mjs does,
// from the working tree: A and B differ by exactly the params the flip moves. Each look is rendered at a, again at a (two engines born
// alike must agree, or nothing measured means anything), then at b and each variant, all at FRAME ticks, faithful looks re-baked. For each
// column against a: mean |Δ| over the frame (0–255, the mean of the three channels) and the share of pixels any channel of which moves by
// more than 8. A column within TOL of a everywhere is "no visible change" and is never shown as a choice. The motion is frozen, so a key
// that only moves things (the wind's) shows nothing here: the motion stage is where it shows.
//
// THE FOLDER. sheets/ (looks most changed first, six to a sheet: a, b, c…, where b moves (Δ ×16), and a zoom of a and b where the
// change is small), frames/<id>.png at full size, where an id is the look's rank and its column (3b), index.html (the four questions, a
// pick per look and the decisions.json it makes), manifest.json (the flip, the params, the commit, source hashes, every frame's hash),
// cost.json, motion.json + motion/, transitions.json + transitions/, README.md (its questions block is rewritten by each stage; the rest
// is written once, to be filled in), and src/ (this script and its lib, as the render ran).
//
// NOISE FLOORS. A measure means something only beside what it does when nothing changed. Cost: cost.mjs runs A three times, and
// how far those runs lie apart in fps is the look's floor; a drop nearer the 10 fps limit than that could land on either side, so the
// question stays open on it until it is measured again (--again) with nothing else on the GPU. Transitions: each route's a runs twice;
// a route runs on the wall clock, so its frames fall at other moments each run, and the largest share by which a route's two a runs
// differ, over every route, is the floor that b must clear to read differently (adopt-lib.mjs fpsDrop, routeFloor).
//
// DECISIONS. decisions.json is { picks: { "<look>": "a"|"b"|"c"… }, rest: "b"|null, why: { "<look>": "the artist's words" },
// motion?: "why the motion need not be measured", transitions?: "why the routes that change kind or read differently are fine" }: a look the picks leave out
// takes `rest`; a look whose frame did not move keeps the old value, named in it on purpose.
//
// APPLY refuses while a question is open (adopt-lib.mjs questionsOf), when the tree's looks are no longer the ones rendered, and when the
// picks would set apart two looks that share a grove on a key a route reads (--allow-split says that is meant). Then it writes the new
// defaults and GRANDFATHERED (komorebi-params.js), pins the kept looks' old values and the variants' values (presets.js), and rewrites
// test/defaults.json; evaluates presets.js again and holds every look to what it was shown as; and lists what is left to write by hand.
// It commits nothing.
// ============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  addGrandfathered, checkRecord, FPS_CAP, FPS_LIMIT, flipTravels, fpsDrop, groveGroups, keysPhrase, lookOrder, paramsKey, parseFlip, parseVariant, pick,
  pinLook, playlistPairs, questionsOf, ROUTE_MEASURES, recordText, resolvePicks, resolveVariant, routeFloor, routeMoves, setDefault, setInLook, splitGroups, survey,
} from './adopt-lib.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RECORD = join(ROOT, 'test/defaults.json');
const SOURCES = ['engine/komorebi-params.js', 'presets.js', 'test-gl/adopt.mjs', 'test-gl/adopt-lib.mjs', 'test-gl/harness.html'];
const VARIANT = 'chromium+angle-metal+enable-gpu', TOL = 2, FRAME = 36, MOVE = 8, PER_SHEET = 6, TILE = [400, 225];
const HELD = { adaptive_motion: false };   // with no frame-rate limit a still scene's frames come faster than its idle rate (rows.mjs)
const FREEZE = ['wind_strength', 'weather_variability', 'drift_auto', 'auto_quality'];   // harness.html's: a flip of one cannot be rendered there
// the motion stage's clip: long enough for the pattern measures' slow terms (the scramble and its return), small enough to render in a minute or two;
// pattern.mjs reads frames at a short side of 360 whatever it is given
const CLIP = { seconds: 60, size: '640x360' };
// the measures the motion table leads with (pattern-lib.mjs's header says what each is)
const MEASURES = [
  ['NNI', (r) => r.spatial.nni.mean], ["Moran's I", (r) => r.spatial.moransI.mean], ['β', (r) => r.spatial.beta.mean],
  ['α', (r) => r.temporal.alpha], ['speed', (r) => r.temporal.speed], ['direction', (r) => r.temporal.directionConsistency], ['rhythm', (r) => r.temporal.rhythm],
  ['τ (s)', (r) => r.impermanence.tau], ['scramble', (r) => r.impermanence.scramble.mean], ['scrambles/min', (r) => r.impermanence.scramble.perMinute],
  ['back in (s)', (r) => r.impermanence.scramble.returnSeconds], ['patch life (s)', (r) => r.impermanence.tracks.lifetimeMedian],
];

const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const writeJson = (f, d) => writeFileSync(f, `${JSON.stringify(d, null, 1)}\n`);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const needBrowser = () => { if (!existsSync(join(ROOT, 'test-gl/node_modules'))) throw new Error('first run: cd test-gl && npm install && npx playwright install chromium'); };

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

// ---- the folder ----
// The render's manifest, what each later stage wrote, and the picks; the tree held to the looks the render saw.
function loadFolder(dirArg) {
  const dir = resolve(dirArg);
  const m = readJson(join(dir, 'manifest.json'));
  if (!m) throw new Error(`${dir}: no manifest.json; render first`);
  const flip = flipFrom(Object.entries(m.flip).map(([k, v]) => `${k}=${JSON.stringify(v)}`));
  const s = surveyOf(flip);
  const drift = [];
  const now = new Map(s.moved.map((x) => [x.look, x]));
  for (const l of m.looks) {
    if (!now.has(l.look)) drift.push(`${l.look}: the flip no longer moves it`);
    else if (paramsKey({ ...s.before.defaults, ...s.before.presets[l.look] }) !== l.before) drift.push(`${l.look}: its params changed since the render`);
  }
  for (const x of s.moved) if (!m.looks.some((l) => l.look === x.look)) drift.push(`${x.look}: moved now, not rendered`);
  if (drift.length) throw new Error(`the looks are not the ones rendered; render again:\n  ${drift.join('\n  ')}`);
  const decisions = readJson(join(dir, 'decisions.json'));
  let picks = null;
  if (decisions) {
    const r = resolvePicks(decisions, m.looks, m.columns);
    if (r.problems.length) throw new Error(`decisions.json:\n  ${r.problems.join('\n  ')}`);
    picks = r.picks;
  }
  const state = { m, decisions, cost: readJson(join(dir, 'cost.json')), motion: readJson(join(dir, 'motion.json')), transitions: readJson(join(dir, 'transitions.json')) };
  return { dir, flip, s, state, picks };
}
const cellOf = (m, look, letter) => m.looks.find((l) => l.look === look).cells.find((c) => c.letter === letter);
const atPick = (picks, look) => (picks ? picks[look] : 'b');
const shownDir = (dir) => (relative(ROOT, dir).startsWith('..') ? dir : relative(ROOT, dir));

// The questions, said everywhere at once: on the terminal, in README.md's questions block, and at the top of index.html.
function report(f) {
  const { dir, state, picks } = f;
  const qs = questionsOf(state, picks, shownDir(dir));
  console.log('\nthe four questions:');
  for (const q of qs) console.log(`  ${q.open ? '[ ]' : '[x]'} ${q.title}: ${q.say}`);
  const block = ['<!-- adopt:questions (rewritten by each stage) -->', '## The four questions', '',
    ...qs.map((q) => `- ${q.open ? '[ ]' : '[x]'} **${q.title}.** ${q.say}`), '', ...tables(state, picks), '<!-- /adopt:questions -->'].join('\n');
  const rpath = join(dir, 'README.md');
  const readme = existsSync(rpath) ? readFileSync(rpath, 'utf8') : '';
  const re = /<!-- adopt:questions[\s\S]*?<!-- \/adopt:questions -->/;
  writeFileSync(rpath, re.test(readme) ? readme.replace(re, block) : readme.replace(/\*\*Seen\.\*\*/, `${block}\n\n**Seen.**`));
  writeFileSync(join(dir, 'index.html'), indexHtml(state, picks, qs));
  return qs;
}

// The measured answers, as markdown tables (README) — index.html draws the same data.
function tables(state, picks) {
  const out = [];
  const { cost, motion, transitions } = state;
  if (cost) {
    out.push(`Cost (${cost.renderer}, ${cost.size.join('×')}; frames a second as seen, capped at ${FPS_CAP}):`, '', '| look | column | a fps | b fps | frame ms a → b | noise floor (how far the A runs lie apart) | |', '|---|---|---|---|---|---|---|');
    for (const [look, cols] of Object.entries(cost.looks)) for (const [c, r] of Object.entries(cols)) {
      const v = fpsDrop(r.aMs, r.bMs, r.aSpread);
      out.push(`| ${look} | ${c} | ${v.a.toFixed(1)} | ${v.b.toFixed(1)} | ${r.aMs.toFixed(2)} → ${r.bMs.toFixed(2)} | ${v.floor.toFixed(1)} fps | ${v.unsure ? '**inside the noise: measure again**' : v.slow ? `**${v.drop.toFixed(1)} fps slower**` : ''} |`);
    }
    out.push('');
  }
  if (motion) {
    out.push(`Motion (${CLIP.seconds} s at ${CLIP.size}, pattern.mjs; B − A):`, '', `| look | pick | ${MEASURES.map(([n]) => n).join(' | ')} |`, `|---|---|${MEASURES.map(() => '---').join('|')}|`);
    for (const [look, r] of Object.entries(motion.looks)) out.push(`| ${look} | ${r.pick} | ${MEASURES.map(([n]) => fmtDelta(r.a[n], r.b[n])).join(' | ')} |`);
    out.push('');
  }
  if (transitions) {
    const floor = routeFloor(transitions.pairs);
    const floorSaid = floor ? `noise floor, the largest share by which a route's two a runs differ: ${ROUTE_MEASURES.map((k) => `${k} ${(100 * floor[k]).toFixed(0)}%`).join(', ')}` : 'no noise floor: a run once';
    out.push(`Transitions (${transitions.pairs.length} routes, motion frozen; ${picks ? 'at the picks' : 'every moved look at b'}; ${floorSaid}):`, '', '| route | kind a → b | max ΔL a (a again) → b | churn/σ a (a again) → b | reads differently | strips |', '|---|---|---|---|---|---|');
    const again = (p, k, n) => (p.a2 ? ` (${p.a2[k].toFixed(n)})` : '');
    for (const p of transitions.pairs) out.push(`| ${p.from} → ${p.to} | ${p.a.kind === p.b.kind ? p.a.kind : `**${p.a.kind} → ${p.b.kind}**`} | ${p.a.maxDL.toFixed(2)}${again(p, 'maxDL', 2)} → ${p.b.maxDL.toFixed(2)} | ${p.a.churnN.toFixed(3)}${again(p, 'churnN', 3)} → ${p.b.churnN.toFixed(3)} | ${floor && p.a2 ? routeMoves(p, floor).map((k) => `**${k}**`).join(', ') : ''} | \`${p.a.strip}\` \`${p.b.strip}\` |`);
    out.push('');
  }
  return out;
}
const fmtDelta = (a, b) => (a == null || b == null ? '–' : `${(b - a >= 0 ? '+' : '')}${(b - a).toFixed(Math.abs(a) < 10 ? 3 : 1)}`);

// ---- the harness page on the GPU, for render and transitions ----
async function openHarness(viewport) {
  needBrowser();
  const { chromium } = await import('playwright');
  const { assertHardwareRenderer, launchBrowser } = await import('./video-lib.mjs');
  const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
  const { browser } = await launchBrowser(chromium, VARIANT, ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  await page.route('http://adopt.test/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    try { await route.fulfill({ contentType: TYPES[extname(path)] ?? 'application/octet-stream', body: readFileSync(resolve(ROOT, `.${path}`)) }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('http://adopt.test/test-gl/harness.html');
  await page.waitForFunction(() => typeof window.__run === 'function');
  const renderer = (await page.evaluate(() => window.__glinfo())).renderer;
  assertHardwareRenderer(renderer, VARIANT);
  return { browser, page, renderer };
}

// ---- render: the look ----
async function render(flip, variants, size, dirArg) {
  for (const k of Object.keys(flip)) if (FREEZE.includes(k)) throw new Error(`${k}: the harness freezes it for every frame, so a still cannot show it; it is a question for the motion stage alone`);
  const s = surveyOf(flip);
  printSurvey(flip, s);
  if (!s.moved.length) { console.log('\nnothing moves: nothing to render'); return; }
  needBrowser();
  const dir = resolve(dirArg ?? join(ROOT, 'archive/reviews', `${today()}-adopt-${Object.keys(flip).join('-')}`));
  if (existsSync(join(dir, 'manifest.json'))) throw new Error(`${dir} already holds a render: one folder, one question (--dir for another)`);
  mkdirSync(join(dir, 'frames'), { recursive: true }); mkdirSync(join(dir, 'sheets'), { recursive: true }); mkdirSync(join(dir, 'src'), { recursive: true });
  const columns = [{ letter: 'a', name: 'as it is', over: () => ({}) }, { letter: 'b', name: `${Object.entries(flip).map(([k, v]) => `${k} ${v}`).join(', ')}`, over: (m) => m.over }];
  for (const [i, v] of variants.entries()) columns.push({ letter: String.fromCharCode(99 + i), name: `b + ${v.name}`, variant: v, over: (m) => ({ ...m.over, ...resolveVariant(v, s.after.presets[m.look]) }) });

  const { browser, page, renderer } = await openHarness({ width: Math.max(size[0], 640), height: Math.max(size[1], 360) });
  const rows = [];
  try {
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
    folder: shownDir(dir),
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
  writeJson(join(dir, 'manifest.json'), manifest);
  writeFileSync(join(dir, 'README.md'), readme(manifest));
  const quiet = rows.filter((r) => !r.visible).map((r) => r.look);
  console.log(`\n${rows.filter((r) => r.visible).length} looks move visibly${quiet.length ? `; no visible change on ${quiet.join(', ')}` : ''}\n${join(dir, 'index.html')}`);
  report({ dir, state: { m: manifest, decisions: null, cost: null, motion: null, transitions: null }, picks: null });
}

// ---- cost: what each column costs a frame, on this machine's GPU (test-gl/cost.mjs, its defaults: 1920×1080, three runs of 200 frames
// alternating A and B). Looks handed the same params on top are measured in one call. ----
function cost(f, again) {
  needBrowser();
  const { dir, state, picks } = f, m = state.m;
  for (const look of again) {
    if (!m.looks.some((l) => l.look === look)) throw new Error(`${look}: the flip does not move it`);
    if (state.cost) delete state.cost.looks[look];   // measured afresh, not averaged with the noisy run
  }
  mkdirSync(join(dir, 'cost'), { recursive: true });
  const groups = new Map();   // the params on top, as JSON → [look, letter][]
  for (const l of m.looks) {
    const letters = picks ? (picks[l.look] === 'a' ? [] : [picks[l.look]]) : m.columns.slice(1).map((c) => c.letter);
    for (const c of letters) {
      if (state.cost?.looks[l.look]?.[c]) continue;   // measured already: a pick changed, not the look
      const key = JSON.stringify(cellOf(m, l.look, c).over);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([l.look, c]);
    }
  }
  const out = state.cost ?? { looks: {} };
  let n = 0;
  for (const [key, members] of groups) {
    const over = JSON.parse(key), file = join(dir, 'cost', `${String(++n).padStart(2, '0')}.json`);
    const looks = [...new Set(members.map(([look]) => look))];
    console.log(`\ncost: ${looks.length} look${looks.length > 1 ? 's' : ''} with ${JSON.stringify(over)}`);
    const r = spawnSync(process.execPath, [join(ROOT, 'test-gl/cost.mjs'), ...looks, '--vs', ...Object.entries(over).map(([k, v]) => `${k}=${JSON.stringify(v)}`), '--out', file], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`cost.mjs failed (${r.status}); what it measured before is in ${shownDir(join(dir, 'cost'))}`);
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    Object.assign(out, { renderer: rec.renderer, size: rec.size, runs: rec.runs, frames: rec.frames, commit: rec.commit });
    for (const x of rec.records) {
      const aMs = x.A.summary.wallMs.median, bMs = x.B.summary.wallMs.median;
      for (const [look, c] of members.filter(([l]) => l === x.look)) {
        out.looks[look] ??= {};
        out.looks[look][c] = { aMs, bMs, aSpread: x.A.summary.wallMs.spread, bSpread: x.B.summary.wallMs.spread, buildA: x.A.summary.buildMs.median, buildB: x.B.summary.buildMs.median, ...fpsDrop(aMs, bMs, x.A.summary.wallMs.spread), file: relative(dir, file) };
      }
    }
    writeJson(join(dir, 'cost.json'), out);   // after each call, so a long run interrupted keeps what it measured
  }
  if (!groups.size) console.log('every look and column is measured already');
  state.cost = out;
  return report(f);
}

// ---- motion: a minute of video of a and of the pick, read by the pattern measures ----
function motion(f, named) {
  needBrowser();
  const { dir, state, picks } = f, m = state.m;
  const ranked = m.looks.filter((l) => l.visible).sort((x, y) => x.rank - y.rank).map((l) => l.look);
  const looks = named.length ? named : ranked.slice(0, 3);
  if (!looks.length) throw new Error('no look moves visibly in a still, so none is the obvious one to film: name the looks (a key that only moves things shows only here)');
  for (const look of looks) if (!m.looks.some((l) => l.look === look)) throw new Error(`${look}: the flip does not move it`);
  mkdirSync(join(dir, 'motion'), { recursive: true });
  const out = state.motion ?? { clip: CLIP, looks: {} };
  const before = f.s.before.presets;
  for (const look of looks) {
    const p = atPick(picks, look);
    if (p === 'a') { console.log(`${look}: kept as it is, nothing to compare`); continue; }
    const r = { pick: p, a: null, b: null };
    for (const [side, over] of [['a', {}], ['b', cellOf(m, look, p).over]]) {
      const name = `${slug(look)}-${side === 'a' ? 'a' : p}`, vdir = join(dir, 'motion', name), lookFile = join(dir, 'motion', `${name}.json`);
      writeJson(lookFile, { name: look, params: { ...before[look], ...over } });
      if (!existsSync(join(vdir, 'delivery.mp4'))) {
        console.log(`\nmotion: ${look} ${side === 'a' ? 'a' : p}, ${CLIP.seconds} s`);
        const v = spawnSync(process.execPath, [join(ROOT, 'test-gl/render-video.mjs'), '--look-json', lookFile, '--tree', '--out', vdir, '--seconds', String(CLIP.seconds), '--size', CLIP.size], { cwd: ROOT, stdio: 'inherit' });
        if (v.status !== 0) throw new Error(`render-video.mjs failed (${v.status}) on ${look}`);
      }
      const pj = join(vdir, 'pattern.json');
      if (!existsSync(pj)) {
        const pr = spawnSync(process.execPath, [join(ROOT, 'test-gl/pattern.mjs'), join(vdir, 'delivery.mp4'), '--out', pj], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
        if (pr.status !== 0) throw new Error(`pattern.mjs failed (${pr.status}) on ${look}`);
      }
      const res = JSON.parse(readFileSync(pj, 'utf8'));
      r[side] = Object.fromEntries(MEASURES.map(([n, get]) => [n, get(res) ?? null]));
      r[`${side}Video`] = relative(dir, join(vdir, 'delivery.mp4'));
    }
    out.looks[look] = r;
    writeJson(join(dir, 'motion.json'), out);
  }
  state.motion = out;
  return report(f);
}

// ---- transitions: every route the shipped playlists walk with a moved look at an end, as it is and as picked ----
async function transitions(f) {
  const { dir, state, picks } = f, m = state.m;
  const moved = new Set(m.looks.map((l) => l.look));
  const overOf = (look) => (moved.has(look) ? cellOf(m, look, atPick(picks, look)).over : {});
  const pairs = playlistPairs(f.s.before.playlists, f.s.before.presets).filter(([a, b]) => Object.keys(overOf(a)).length || Object.keys(overOf(b)).length);
  if (!pairs.length) { console.log('no shipped route has a look that changes at either end'); }
  mkdirSync(join(dir, 'transitions'), { recursive: true });
  const { browser, page, renderer } = await openHarness({ width: 640, height: 360 });
  const out = { renderer, picks: picks ?? null, pairs: [] };
  try {
    for (const [i, [from, to]] of pairs.entries()) {
      const row = { from, to };
      for (const [side, over] of [['a', [{}, {}]], ['a2', [{}, {}]], ['b', [overOf(from), overOf(to)]]]) {
        const r = await page.evaluate(([x, y, o]) => window.__transition(x, y, o), [from, to, { freeze: true, over }]);
        const fr = r.frames;
        let maxDL = 0, churnN = 0;
        for (let k = 1; k < fr.length; k++) { maxDL = Math.max(maxDL, Math.abs(fr[k].luma - fr[k - 1].luma)); churnN = Math.max(churnN, fr[k].churn / Math.max(1, Math.sqrt(fr[k].variance))); }
        row[side] = { kind: r.info.kind, maxDL, churnN, frames: fr.length };
        if (side === 'a2') continue;   // the floor's run: its numbers only
        const strip = `transitions/${String(i + 1).padStart(2, '0')}-${side}.png`;
        writeFileSync(join(dir, strip), Buffer.from((await page.evaluate(([ids, c]) => window.__strip(ids, c), [fr.map((x) => x.id), 8])).split(',')[1], 'base64'));
        row[side].strip = strip;
      }
      out.pairs.push(row);
      console.log(`  ${`${from} → ${to}`.padEnd(54)} ${row.a.kind === row.b.kind ? row.a.kind : `${row.a.kind} → ${row.b.kind}  CHANGES KIND`}   ΔL ${row.a.maxDL.toFixed(2)} (${row.a2.maxDL.toFixed(2)}) → ${row.b.maxDL.toFixed(2)}   churn/σ ${row.a.churnN.toFixed(3)} (${row.a2.churnN.toFixed(3)}) → ${row.b.churnN.toFixed(3)}`);
    }
  } finally { await browser.close(); }
  writeJson(join(dir, 'transitions.json'), out);
  state.transitions = out;
  return report(f);
}

function readme(m) {
  const shown = m.looks.filter((r) => r.visible).sort((x, y) => x.rank - y.rank);
  const quiet = m.looks.filter((r) => !r.visible).map((r) => r.look);
  const cols = m.columns.slice(1);
  const out = [
    `# ${Object.keys(m.flip).join(', ')} on by default (${today()})`, '',
    `${Object.entries(m.flip).map(([k, v]) => `\`${k}\` ${JSON.stringify(m.from[k])} → ${JSON.stringify(v)}`).join(', ')}. A is each built-in look today, ${cols.map((c) => `${c.letter.toUpperCase()} ${c.name}`).join(', ')}. ${m.how_rendered.tree}; ${m.how_rendered.renderer}, ${m.how_rendered.size.join('×')}, motion frozen.`, '',
    `Most changed first (mean |A−B| of 255, share of pixels moving by more than ${MOVE}):`, '',
    `| id | look | ${cols.map((c) => `${c.letter} mean | ${c.letter} pixels`).join(' | ')} | sheet |`,
    `|---|---|${cols.map(() => '---|---').join('|')}|---|`,
    ...shown.map((r) => `| ${r.rank} | ${r.look} | ${r.cells.slice(1).map((c) => (c.same ? '— | —' : `${c.mean.toFixed(1)} | ${(c.moved * 100).toFixed(1)} %`)).join(' | ')} | \`${r.sheet}\` |`), '',
  ];
  if (quiet.length) out.push(`No visible change in the still (they keep the old value, named on purpose): ${quiet.join(', ')}.`, '');
  if (m.still.length) out.push(`Not moved (they name the key): ${m.still.join(', ')}.`, '');
  if (m.groups.length) out.push(`Share a grove, and ${m.routed.join(', ')} travels with it: ${m.groups.map((g) => g.join(' · ')).join('; ')}.`, '');
  out.push('**Seen.** (to write)', '', "## José's pick", '', '(pending; then decisions.json beside this file, and `nix run .#adopt -- apply <this folder>`)', '');
  return out.join('\n');
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

// The page the artist picks on: the four questions first, then the looks most changed first with a pick per look (and what each column
// costs a frame), the decisions.json the picks make, and the routes and the motion as measured.
function indexHtml(state, picks, qs) {
  const { m, cost, motion, transitions } = state;
  const costOf = (look, c) => { const r = cost?.looks[look]?.[c]; return r ? { ...r, ...fpsDrop(r.aMs, r.bMs, r.aSpread) } : null; };
  const shown = m.looks.filter((r) => r.visible).sort((x, y) => x.rank - y.rank)
    .map((r) => ({ rank: r.rank, look: r.look, cells: r.cells.map((c) => ({ letter: c.letter, id: c.id, file: c.file, mean: c.mean ?? 0, moved: c.moved ?? 0, same: c.same ?? false, cost: costOf(r.look, c.letter) })) }));
  const data = { flip: m.flip, from: m.from, columns: m.columns, groups: m.groups, routed: m.routed, quiet: m.looks.filter((r) => !r.visible).map((r) => r.look), still: m.still, looks: shown,
    picks: picks ?? {}, why: state.decisions?.why ?? {}, rest: state.decisions?.rest ?? 'b', motionWhy: state.decisions?.motion ?? '', transitionsWhy: state.decisions?.transitions ?? '',
    fpsLimit: FPS_LIMIT, fpsCap: FPS_CAP };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const qHtml = qs.map((q) => `<li class="${q.open ? 'open' : 'done'}"><b>${esc(q.title)}.</b> ${esc(q.say)}</li>`).join('');
  const motionHtml = motion ? `<h2>Motion</h2><p>${CLIP.seconds} s at ${CLIP.size} of a and of the pick, read by pattern.mjs; B − A.</p><div class="scroll"><table><tr><th>look</th><th>pick</th>${MEASURES.map(([n]) => `<th>${esc(n)}</th>`).join('')}<th>videos</th></tr>${Object.entries(motion.looks).map(([look, r]) => `<tr><td>${esc(look)}</td><td>${r.pick}</td>${MEASURES.map(([n]) => `<td>${fmtDelta(r.a[n], r.b[n])}</td>`).join('')}<td><a href="${r.aVideo}">a</a> <a href="${r.bVideo}">${r.pick}</a></td></tr>`).join('')}</table></div>` : '';
  const floor = transitions ? routeFloor(transitions.pairs) : null;
  const moves = (p) => (floor && p.a2 ? routeMoves(p, floor) : []);
  const again = (p, k, n) => (p.a2 ? ` (again ${p.a2[k].toFixed(n)})` : '');
  const transHtml = transitions ? `<h2>Transitions</h2><p>${transitions.pairs.length} routes, motion frozen, ${transitions.picks ? 'at the picks' : 'every moved look at b'}: a as it is, b as it would ship. ${floor ? `Noise floor, the largest share by which a route's two a runs differ: ${ROUTE_MEASURES.map((k) => `${k} ${(100 * floor[k]).toFixed(0)}%`).join(', ')}; a route past it reads differently.` : 'No noise floor: a was run once.'}</p>${transitions.pairs.map((p) => `<div class="route${p.a.kind !== p.b.kind || moves(p).length ? ' changed' : ''}"><h3>${esc(p.from)} → ${esc(p.to)}: ${p.a.kind === p.b.kind ? esc(p.a.kind) : `${esc(p.a.kind)} → ${esc(p.b.kind)}`}${moves(p).length ? `, reads differently (${moves(p).join(', ')})` : ''}</h3><p>largest step in brightness ${p.a.maxDL.toFixed(2)}${again(p, 'maxDL', 2)} → ${p.b.maxDL.toFixed(2)} · churn/σ ${p.a.churnN.toFixed(3)}${again(p, 'churnN', 3)} → ${p.b.churnN.toFixed(3)}</p><div class="strips"><a href="${p.a.strip}"><img loading="lazy" src="${p.a.strip}"></a><a href="${p.b.strip}"><img loading="lazy" src="${p.b.strip}"></a></div></div>`).join('')}` : '';
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(Object.keys(m.flip).join(', '))} on by default</title>
<style>
:root { --bg: #161616; --fg: #e8e8e8; --dim: #9a9a9a; --line: #333; --warn: #ffb454; --pick: #7fd88f; --bad: #ff6b6b; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 6px; } h3 { font-size: 14px; margin: 0 0 4px; } p { color: var(--dim); margin: 4px 0 12px; }
ul.q { padding-left: 18px; } ul.q li { margin: 4px 0; } ul.q li.open::marker { content: '☐  '; color: var(--warn); } ul.q li.done::marker { content: '☑  '; color: var(--pick); }
.look, .route { border-top: 1px solid var(--line); padding: 10px 0; }
.look h2 { font-size: 15px; margin: 0 0 6px; }
.cells, .strips { display: flex; gap: 8px; flex-wrap: wrap; }
.cell { width: 320px; max-width: 100%; }
.cell img, .strips img { width: 100%; display: block; }
.strips a { width: 480px; max-width: 100%; }
.cell label { display: flex; gap: 6px; align-items: center; margin-top: 4px; cursor: pointer; flex-wrap: wrap; }
.cell.on img { outline: 3px solid var(--pick); }
.slow { color: var(--bad); font-weight: 600; } .route.changed h3 { color: var(--warn); }
.why, .wide { width: 100%; max-width: 660px; margin-top: 6px; background: #222; color: var(--fg); border: 1px solid var(--line); padding: 4px; }
#warn { color: var(--warn); white-space: pre-wrap; }
textarea#out { width: 100%; height: 160px; background: #222; color: var(--fg); border: 1px solid var(--line); font: 12px ui-monospace, monospace; }
.bar { position: sticky; top: 0; background: var(--bg); padding: 8px 0; z-index: 1; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
button, select { background: #2a2a2a; color: var(--fg); border: 1px solid var(--line); padding: 4px 10px; }
.scroll { overflow-x: auto; } table { border-collapse: collapse; font-size: 12px; } td, th { border: 1px solid var(--line); padding: 3px 6px; text-align: right; } td:first-child, th:first-child { text-align: left; }
</style>
<h1>${esc(Object.entries(m.flip).map(([k, v]) => `${k} ${JSON.stringify(m.from[k])} → ${JSON.stringify(v)}`).join(', '))}</h1>
<p>${m.columns.map((c) => `<b>${c.letter}</b> ${esc(c.name)}`).join(' · ')}. Most changed first.</p>
<h2>The four questions</h2><ul class="q">${qHtml}</ul>
<p>As of the last stage run; picking here changes decisions.json, and the next stage reads it.</p>
<div class="bar">unpicked looks take <select id="rest"></select> <button id="save">save decisions.json</button> <span id="warn"></span></div>
<div id="looks"></div>
<p id="quiet"></p>
<h2>Motion and routes, in words</h2>
<p>Only where a question asks for them: why the motion need not be filmed, and why routes that change kind are fine.</p>
<input id="motionWhy" class="wide" placeholder="motion: why it need not be measured (optional)">
<input id="transitionsWhy" class="wide" placeholder="transitions: why the routes that change kind or read differently are fine (optional)">
${motionHtml}
${transHtml}
<h2>decisions.json</h2>
<textarea id="out" readonly></textarea>
<script>
const D = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const picks = { ...D.picks }, why = { ...D.why };
const rest = document.getElementById('rest');
for (const c of [{ letter: '', name: 'no default: pick every look' }, ...D.columns]) rest.add(new Option(c.letter ? c.letter + ' — ' + c.name : c.name, c.letter));
rest.value = D.rest || '';
const root = document.getElementById('looks');
const text = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
for (const l of D.looks) {
  const box = document.createElement('div'); box.className = 'look';
  box.innerHTML = '<h2>' + l.rank + '. ' + text(l.look) + '</h2><div class="cells"></div><input class="why" placeholder="why (optional, kept beside the pin)">';
  const cells = box.querySelector('.cells');
  for (const c of l.cells) {
    const d = document.createElement('div'); d.className = 'cell'; d.dataset.letter = c.letter;
    const stat = c.letter === 'a' ? 'as it is' : c.same ? 'no visible change' : 'mean ' + c.mean.toFixed(2) + ' · ' + (c.moved * 100).toFixed(1) + ' % of pixels';
    const fps = c.cost ? ' <span class="' + (c.cost.slow || c.cost.unsure ? 'slow' : '') + '" title="noise floor: the A runs lie ' + c.cost.floor.toFixed(1) + ' fps apart">' + c.cost.a.toFixed(0) + ' → ' + c.cost.b.toFixed(0) + ' fps' + (c.cost.unsure ? ', inside the noise' : '') + '</span>' : '';
    d.innerHTML = '<a href="' + c.file + '" target="_blank"><img loading="lazy" src="' + c.file + '"></a><label><input type="radio" name="p' + l.rank + '" value="' + c.letter + '"' + (picks[l.look] === c.letter ? ' checked' : '') + '> <b>' + c.id + '</b> ' + stat + fps + '</label>';
    cells.appendChild(d);
  }
  const w = box.querySelector('.why'); w.value = why[l.look] ?? '';
  box.addEventListener('change', (e) => { if (e.target.type === 'radio') { picks[l.look] = e.target.value; update(); } });
  w.addEventListener('input', (e) => { if (e.target.value.trim()) why[l.look] = e.target.value.trim(); else delete why[l.look]; update(); });
  root.appendChild(box);
}
document.getElementById('quiet').textContent = (D.quiet.length ? 'No visible change in the still (they keep the old value, named on purpose): ' + D.quiet.join(', ') + '. ' : '') + (D.still.length ? 'Not moved (they name the key): ' + D.still.join(', ') + '.' : '');
const mw = document.getElementById('motionWhy'), tw = document.getElementById('transitionsWhy');
mw.value = D.motionWhy; tw.value = D.transitionsWhy;
for (const el of [rest, mw, tw]) el.addEventListener('input', update);
function chosen(look) { return picks[look] ?? (rest.value || null); }
function update() {
  D.looks.forEach((l, i) => { for (const d of root.children[i].querySelectorAll('.cell')) d.classList.toggle('on', d.dataset.letter === chosen(l.look)); });
  const warn = [];
  const missing = D.looks.filter((l) => !chosen(l.look));
  if (missing.length) warn.push(missing.length + ' looks have no pick');
  const slow = D.looks.filter((l) => { const c = l.cells.find((x) => x.letter === chosen(l.look))?.cost; return c?.slow && !c.unsure; });
  const unsure = D.looks.filter((l) => l.cells.find((c) => c.letter === chosen(l.look))?.cost?.unsure);
  if (unsure.length) warn.push('inside the noise floor as picked, to measure again: ' + unsure.map((l) => l.look).join(', '));
  if (slow.length) warn.push('more than ' + D.fpsLimit + ' fps slower as picked: ' + slow.map((l) => l.look).join(', '));
  // looks that share a grove travel without a dissolve only while they agree on the flip
  for (const g of D.groups) { const ps = new Set(g.map((look) => (chosen(look) ?? 'b') === 'a' ? 'a' : 'b+')); if (ps.size > 1) warn.push('one grove, split: ' + g.map((look) => look + ' ' + (chosen(look) ?? 'b')).join(' · ')); }
  document.getElementById('warn').textContent = warn.join('\\n');
  const out = { picks, rest: rest.value || null, why };
  if (mw.value.trim()) out.motion = mw.value.trim();
  if (tw.value.trim()) out.transitions = tw.value.trim();
  document.getElementById('out').value = JSON.stringify(out, null, 1);
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
function apply(f, allowSplit) {
  const { dir, flip, s, state, picks } = f, m = state.m;
  if (!picks) throw new Error('no decisions.json: pick in index.html first');
  const open = questionsOf(state, picks, shownDir(dir)).filter((q) => q.open);
  if (open.length) throw new Error(`open questions:\n  ${open.map((q) => `${q.title}: ${q.say}`).join('\n  ')}`);
  const decisions = state.decisions;
  // what each look must be once the sources are written: a as it is, b the after world, c… b with the variant's values as rendered
  const expected = {};
  for (const l of m.looks) expected[l.look] = picks[l.look] === 'a' ? s.before.presets[l.look] : { ...s.before.presets[l.look], ...cellOf(m, l.look, picks[l.look]).over };
  const split = splitGroups(m.groups, picks, m.routed, expected);
  if (split.length && !allowSplit) throw new Error(`these share a grove today and would not (--allow-split if that is meant):\n  ${split.map((g) => g.join(' · ')).join('\n  ')}`);

  const keys = Object.keys(flip), why = decisions.why ?? {};
  const pPath = join(ROOT, 'engine/komorebi-params.js'), lPath = join(ROOT, 'presets.js');
  let params = readFileSync(pPath, 'utf8'), presets = readFileSync(lPath, 'utf8');
  for (const [k, v] of Object.entries(flip)) params = setDefault(params, k, v);
  params = addGrandfathered(params, m.from);
  for (const l of m.looks) {
    const p = picks[l.look], said = why[l.look] ? `; ${why[l.look]}` : '';
    if (p === 'a') presets = pinLook(presets, l.look, pick(s.before.presets[l.look], l.keys), l.visible
      ? `kept as made, from before ${keysPhrase(keys)} on by default (GRANDFATHERED in komorebi-params.js)${said}`
      : `off on purpose: ${keys.join(', ')} changes nothing visible here (GRANDFATHERED in komorebi-params.js)${said}`);
    else if (p !== 'b') {
      const cell = cellOf(m, l.look, p), v = m.variants.find((x) => x.letter === p);
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
    const want = expected[look] ?? s.before.presets[look];   // a look the flip does not move is what it was
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
const folder = () => { if (!args.length) throw new Error('name the review folder'); return loadFolder(args.shift()); };
try {
  const cmd = args.shift();
  if (cmd === 'survey') { const flip = flipFrom(args); printSurvey(flip, surveyOf(flip)); }
  else if (cmd === 'render') {
    const variants = take('--variant').map(parseVariant), size = (take('--size')[0] ?? '640x360').split('x').map(Number), dir = take('--dir')[0];
    if (size.length !== 2 || !size.every((n) => Number.isInteger(n) && n > 0)) throw new Error('--size WxH');
    await render(flipFrom(args), variants, size, dir);
  } else if (cmd === 'cost') { const f = folder(); cost(f, args); }
  else if (cmd === 'motion') { const f = folder(); motion(f, args); }
  else if (cmd === 'transitions') await transitions(folder());
  else if (cmd === 'status') report(folder());
  else if (cmd === 'apply') { const allow = flag('--allow-split'); apply(folder(), allow); }
  else if (cmd === 'record') record();
  else throw new Error('usage: adopt survey|render key=value… | cost|motion|transitions|status|apply <folder> | record   (test-gl/adopt.mjs header)');
} catch (e) { console.error(e.message); process.exit(1); }
process.exit(0);
