// The burn test: how hard komorebi can be pushed on THIS machine before live playback stops holding 60 fps.
//   nix run .#burn -- [--tiers 1080p,1440p,4k] [--levels 8] [--seconds 15] [--look montebello] [--headed] [--quick]
// Run it on the machine under test. The browser runs with vsync and the frame-rate cap off, so every frame interval is what
// that frame cost; it runs headless by default (over SSH too), and --headed shows the window. It writes
// test-gl/out/burn/<date>-<host>/results.json as it goes and prints three lines per level.
//
// A multi-stage fitness test (burn-lib.mjs says how a level loads the look and how a shuttle is graded): each resolution tier
// climbs from the look as authored to every load slider at its editor maximum. Each level runs three shuttles: steady wind, a
// storm, and a chain of transitions between looks that take different routes. A shuttle is comfortable when even its slowest
// 1% of frames leave a quarter of the 16.7 ms budget spare, holding when 95% fit, breaking otherwise. Each shuttle climbs on
// its own and sits out once it has broken at two levels in a row; a tier ends when all three have. The worst single frame of
// each shuttle is reported apart: a rebuild or a first transition freezes the picture for that long, which a live set feels
// whatever the averages say.
//
//   --tiers      which backing sizes, from one 1920x1080 window (default 1080p,1440p,4k)
//   --levels     rungs from the authored look to the maxima (default 8)
//   --seconds    each shuttle's length (default 15)
//   --look       the preset the ladder loads (default montebello)
//   --chain      presets the transition shuttle walks, comma-separated
//   --duration   each transition's length in seconds (default 4)
//   --headed     show the window (a display must be attached and the session logged in)
//   --browser    a Chrome or Chromium binary to drive instead of Playwright's (on NixOS, the system's Chrome)
//   --chrome     the GPU flag set (video-lib.mjs GPU_VARIANTS; default ANGLE on Metal on macOS, on Vulkan elsewhere)
//   --quick      a smoke run: 1080p, 3 levels, 5 s shuttles
// What it cannot see: the GPU's power, clocks, temperature and busy share. Read those beside it (VictoriaMetrics on Linux,
// powermetrics on a Mac); results.json records each level's start and end time to line them up.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { frameStats, grade, levelLook, SHUTTLES, shouldStop, stillRunning, TIERS, tierSummary } from './burn-lib.mjs';
import { assertHardwareRenderer, GPU_VARIANTS, HERE, startServer } from './video-lib.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flag = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const QUICK = has('--quick');
const TIER_NAMES = (flag('--tiers', QUICK ? '1080p' : '1080p,1440p,4k')).split(',');
const LEVELS = Number(flag('--levels', QUICK ? 3 : 8));
const SECONDS = Number(flag('--seconds', QUICK ? 5 : 15));
const LOOK = flag('--look', 'montebello');
const CHAIN = flag('--chain', 'park fall,forest floor,the yellow tree,cherry blossom,park 1,prism,montebello').split(',');
const DURATION = Number(flag('--duration', 4));
const HEADED = has('--headed');
const BROWSER = flag('--browser');
const CHROME = flag('--chrome', process.platform === 'darwin' ? 'chromium+angle-metal+enable-gpu' : 'chromium+angle-vulkan+enable-gpu');
for (const t of TIER_NAMES) if (!TIERS[t]) { console.error(`--tiers: ${t} is not one of ${Object.keys(TIERS).join(', ')}`); process.exit(2); }
if (!GPU_VARIANTS[CHROME]) { console.error(`--chrome ${CHROME}: not one of ${Object.keys(GPU_VARIANTS).join(', ')}`); process.exit(2); }
if (!(LEVELS >= 2) || !(SECONDS > 0) || !(DURATION > 0)) { console.error('--levels must be 2 or more; --seconds and --duration positive'); process.exit(2); }

const host = os.hostname().split('.')[0];
const OUT = flag('--out', join(HERE, 'out', 'burn', `${new Date().toISOString().slice(0, 10)}-${host}${QUICK ? '-quick' : ''}`));
mkdirSync(OUT, { recursive: true });
const results = {
  tool: 'test-gl/burn.mjs', started_at: new Date().toISOString(),
  host: { name: host, platform: process.platform, release: os.release(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memory_gib: Math.round(os.totalmem() / 2 ** 30) },
  settings: { tiers: TIER_NAMES, levels: LEVELS, seconds: SECONDS, look: LOOK, chain: CHAIN, duration: DURATION, headed: HEADED, chrome: CHROME, browser: BROWSER ?? 'playwright', vsync: false },
  tiers: [],
};
const save = () => writeFileSync(join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const f1 = (x) => (x == null ? '-' : x.toFixed(1));
const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`);
const line = (name, s) => `${name} ${s.grade} (p50 ${f1(s.frames.p50)} p99 ${f1(s.frames.p99)} ms, ${pct(s.frames.over)} over, worst ${f1(s.frames.worst)})`;
const shuttle = ({ intervals, cpu }) => { const frames = frameStats(intervals); return { frames, cpu: frameStats(cpu), grade: grade(frames) }; };

const srv = await startServer({ engineRoot: join(HERE, '..') });
const v = GPU_VARIANTS[CHROME];
const browser = await chromium.launch({
  headless: !HEADED,
  ...(BROWSER ? { executablePath: BROWSER } : v.channel ? { channel: v.channel } : {}),
  // no vsync and no frame-rate cap: an interval is what the frame cost. A page that is not frontmost must not be throttled.
  args: [...v.args, '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--window-position=0,0', '--window-size=1920,1080'],
});
const stop = async () => { await browser.close().catch(() => {}); await srv.close(); };
process.on('SIGINT', async () => { save(); await stop(); process.exit(130); });

try {
  for (const tierName of TIER_NAMES) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: TIERS[tierName].dpr });
    page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
    await page.goto(`http://127.0.0.1:${srv.port}/test-gl/burn.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__burn);
    const looks = await page.evaluate((names) => window.__burn.resolved(names), [LOOK, ...CHAIN]);
    const info = await page.evaluate((p) => window.__burn.open(p), looks[LOOK]);
    if (!BROWSER) assertHardwareRenderer(info.renderer, CHROME);
    const tier = { tier: tierName, info, levels: [] };
    results.tiers.push(tier);
    console.log(`\n== ${tierName}: ${info.backing.join('x')} on ${info.renderer}`);
    const history = Object.fromEntries(SHUTTLES.map((n) => [n, []]));
    for (let level = 0; level < LEVELS; level++) {
      const running = stillRunning(history);
      if (!running.length) { console.log(`   every shuttle has broken twice: ${tierName} ends here`); break; }
      const look = levelLook(looks[LOOK], level, LEVELS);
      const started = new Date().toISOString();
      const label = `${tierName} L${level}`;
      const shuttles = {};
      if (running.includes('steady')) {
        await page.evaluate((t) => window.__burn.hud(t), `${label}  steady`);
        await page.evaluate((p) => window.__burn.setLook(p), look);
        shuttles.steady = shuttle(await page.evaluate((s) => window.__burn.measure(s), SECONDS));
      }
      if (running.includes('storm')) {
        await page.evaluate((t) => window.__burn.hud(t), `${label}  storm`);
        await page.evaluate((p) => window.__burn.setLook(p), { ...look, wind_strength: 1.6, wind_gustiness: 0.5 });
        shuttles.storm = shuttle(await page.evaluate((s) => window.__burn.measure(s), SECONDS));
      }
      if (running.includes('transitions')) {
        await page.evaluate((t) => window.__burn.hud(t), `${label}  transitions`);
        const chain = CHAIN.map((name) => ({ name, params: levelLook(looks[name], level, LEVELS) }));
        const t = await page.evaluate((o) => window.__burn.transitions(o), { looks: chain, seconds: SECONDS, duration: DURATION });
        shuttles.transitions = { ...shuttle(t), routes: t.routes };
      }
      for (const [name, sh] of Object.entries(shuttles)) history[name].push(sh.grade);
      const load = Object.fromEntries(['tree_count', 'foliage_density', 'leaves_per_cluster', 'layer_count', 'sample_count', 'tex_resolution'].map((k) => [k, look[k]]));
      tier.levels.push({ level, started, ended: new Date().toISOString(), load, shuttles });
      tier.summary = Object.fromEntries(SHUTTLES.map((n) => [n, tierSummary(history[n])]));
      save();
      console.log(`${label}  trees ${load.tree_count} density ${load.foliage_density} leaves ${load.leaves_per_cluster} layers ${load.layer_count} samples ${load.sample_count} tex ${load.tex_resolution}`);
      for (const [name, sh] of Object.entries(shuttles)) {
        const routes = sh.routes ? `: ${sh.routes.map((r) => `${r.route} ${(r.ms / 1000).toFixed(1)} s`).join(', ')}` : '';
        console.log(`   ${line(name, sh)}${routes}`);
        if (shouldStop(history[name])) console.log(`   ${name} has broken twice in a row and sits out the rest of ${tierName}`);
      }
    }
    await page.close();
  }
} finally {
  results.ended_at = new Date().toISOString();
  save();
  await stop();
}

// the ladder against the tiers: a level whose frame time barely grows from 1080p to 4K is not spending it on pixels
const rows = Math.max(...results.tiers.map((t) => t.levels.length));
console.log(`\nsteady p50 frame time in ms (grade), by level and tier`);
console.log(`level  ${results.tiers.map((t) => t.tier.padEnd(24)).join('')}`);
for (let l = 0; l < rows; l++) {
  console.log(`L${l}`.padEnd(7) + results.tiers.map((t) => { const x = t.levels[l]?.shuttles.steady; return (x ? `${f1(x.frames.p50)} (${x.grade})` : '-').padEnd(24); }).join(''));
}
console.log(`\n${'tier'.padEnd(7)}${'shuttle'.padEnd(13)}${'comfortable to'.padEnd(17)}${'holds to'.padEnd(11)}breaks at`);
for (const t of results.tiers) for (const n of SHUTTLES) {
  const s = t.summary?.[n] ?? {};
  const at = (i) => (i == null ? '-' : `L${i}`);
  console.log(`${t.tier.padEnd(7)}${n.padEnd(13)}${at(s.comfortableTo).padEnd(17)}${at(s.holdsTo).padEnd(11)}${s.breaksAt == null ? 'never' : `L${s.breaksAt}`}`);
}
console.log(`\nresults: ${join(OUT, 'results.json')}`);
