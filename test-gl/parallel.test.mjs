// The exporter's --jobs N, held without a browser or a GPU: the pool, the holes, the start states the CPU-only pass must write, compare-runs.mjs, and that --jobs is not in the run key.
//   node --test test-gl/parallel.test.mjs        (git and ffmpeg on PATH, and test-gl's `npm install` for the CLI tests: render-video.mjs imports playwright, but no browser is ever launched)
// What this CANNOT show: that the tiny engine's state equals the full-size engine's across fades, or anything about Chromium, the GPU, VRAM or speed. compare-runs.mjs on a serial and a --jobs render does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns } from './compare-runs.mjs';
import { MAX_JOBS, TINY_QUALITY, eventsUpTo, parseJobs, restorePoint, runPool, tinyEvents, tinyPlan, todoSegments } from './parallel.mjs';
import { HERE, playlistSchedule } from './video-lib.mjs';

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));
const withDir = async (fn) => { const dir = mkdtempSync(join(tmpdir(), 'komorebi-parallel-test-')); try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

// ---------------------------------------------------------------- --jobs as typed
test('parseJobs: absent is 1; a whole number 1..8 is itself; everything else is refused with the range in the message', () => {
  assert.equal(parseJobs(undefined), 1);
  for (const n of [1, 2, 3, 8]) assert.equal(parseJobs(String(n)), n);
  for (const bad of ['0', '9', '-1', '2.5', 'x', '', '3x', ' 3', '1e1']) assert.throws(() => parseJobs(bad), /--jobs .*1 to 8/, `'${bad}'`);
  assert.equal(MAX_JOBS, 8);
});

// ---------------------------------------------------------------- the holes
test('todoSegments: a segment is done by its own say-so, not by a contiguous prefix; only the missing ones are left, ascending', () => {
  const done = new Set([0, 1, 3, 4, 7]);
  assert.deepEqual(todoSegments({ nSegs: 9, isDone: (i) => done.has(i) }), [2, 5, 6, 8]);
  assert.deepEqual(todoSegments({ nSegs: 3, isDone: () => true }), []);
  assert.deepEqual(todoSegments({ nSegs: 3, isDone: () => false }), [0, 1, 2]);
});

// ---------------------------------------------------------------- the start states the CPU-only pass writes
const FPS = 60, PRE = 1800, SEG = 600;
const segRange = (i) => ({ from: PRE + i * SEG, to: PRE + (i + 1) * SEG });
// 10 s dwell, 5 s crossfade: fade 1 starts at pump 2401 and lands at 2704 (+LAND_MARGIN 3), look 2 is there from 2704, its fade starts at 3305 and lands at 3608, the next starts at 4209
const items = [{ dwell_s: 10, crossfade_s: 5 }, { dwell_s: 10, crossfade_s: 5 }, { dwell_s: 10, crossfade_s: 5 }];
const schedule = playlistSchedule({ items, fps: FPS, preroll: PRE, frames: 60 * 60 });

test('the schedule these tests stand on', () => {
  assert.deepEqual(schedule.slice(0, 3).map((e) => [e.start, e.land, e.stop]), [[2401, 2704, 1], [3305, 3608, 2], [4209, 4512, 0]]);
});

test('restorePoint: at rest a segment starts from its own pump; inside a fade, from the pump before the fade started, replaying up to the segment', () => {
  assert.deepEqual(restorePoint({ from: 1800, schedule, preroll: PRE }), { at: 1800, stop: 0, replay: 0 });
  assert.deepEqual(restorePoint({ from: 2400, schedule, preroll: PRE }), { at: 2400, stop: 0, replay: 0 }, 'the pump before the fade starts is at rest');
  assert.deepEqual(restorePoint({ from: 2401, schedule, preroll: PRE }), { at: 2400, stop: 0, replay: 1 }, 'the fade is applied before pump 2401');
  assert.deepEqual(restorePoint({ from: 3000, schedule, preroll: PRE }), { at: 3000, stop: 1, replay: 0 }, 'dwell on look 1: at rest');
  assert.deepEqual(restorePoint({ from: 2703, schedule, preroll: PRE }), { at: 2400, stop: 0, replay: 303 }, 'still in the fade after pump 2703');
  assert.deepEqual(restorePoint({ from: 2704, schedule, preroll: PRE }), { at: 2704, stop: 1, replay: 0 }, 'the landing pump itself is at rest (its state is the landing)');
  assert.deepEqual(restorePoint({ from: 3600, schedule, preroll: PRE }), { at: 3304, stop: 1, replay: 296 }, 'a later fade starts from the look the engine had landed on');
  assert.deepEqual(restorePoint({ from: 4200, schedule, preroll: PRE }), { at: 4200, stop: 2, replay: 0 });
});

test('restorePoint never replays more than one crossfade, however long the dwell (the landing-only rule would replay up to a whole dwell too)', () => {
  const long = playlistSchedule({ items: [{ dwell_s: 30, crossfade_s: 5 }, { dwell_s: 30, crossfade_s: 5 }], fps: FPS, preroll: PRE, frames: 60 * 300 });
  let worst = 0;
  for (let from = PRE; from < PRE + 60 * 300; from += SEG) worst = Math.max(worst, restorePoint({ from, schedule: long, preroll: PRE }).replay);
  assert.ok(worst <= 5 * FPS + 3, `replay ${worst} pumps`);
  assert.ok(worst > 0, 'the walk really crosses fades');
});

test('tinyPlan, a single look: the first pump of every segment to render, nothing else, and the pass runs no further than the last', () => {
  const p = tinyPlan({ todo: [0, 2, 5], segRange, schedule: [], preroll: PRE });
  assert.deepEqual(p, { snapshotAt: [1800, 3000, 4800], landings: [], upTo: 4800 });
  assert.deepEqual(tinyPlan({ todo: [3], segRange, schedule: [], preroll: PRE }).snapshotAt, [3600], 'a hole alone needs only its own state');
});

test('tinyPlan, a playlist: the restore point of each segment to render and every landing up to the last of them', () => {
  const p = tinyPlan({ todo: [0, 1, 2, 3, 4], segRange, schedule, preroll: PRE });
  // segment starts 1800 2400 3000 3600 4200 -> 1800, 2400, 3000 (dwell on look 1), 3304 (3600 is inside fade 2, which starts at 3305), 4200
  assert.deepEqual(p.snapshotAt, [1800, 2400, 3000, 3304, 4200]);
  assert.equal(p.upTo, 4200);
  assert.deepEqual(p.landings, [2704, 3608], 'landings up to the last restore point (the one at 4512 is later)');
  assert.deepEqual(tinyPlan({ todo: [3], segRange, schedule, preroll: PRE }), { snapshotAt: [3304], landings: [2704], upTo: 3304 }, 'a hole inside a fade: the state before the fade, and the landings before that');
});

test('eventsUpTo: the fades the tiny pass applies are those after the pre-roll and at or before where it stops', () => {
  const ev = schedule.map((e) => ({ start: e.start, duration: e.duration_s, params: { stop: e.stop } }));
  assert.deepEqual(eventsUpTo(ev, 3304, PRE).map((e) => e.start), [2401]);
  assert.deepEqual(eventsUpTo(ev, 3305, PRE).map((e) => e.start), [2401, 3305]);
  assert.deepEqual(eventsUpTo(ev, 2400, PRE), []);
});

test('tinyEvents: every event\'s params carry the tiny engine\'s sizes, else transitionTo sees a structural difference and dissolves instead of morphing', () => {
  const ev = [{ start: 10, duration: 5, params: { exposure: 1, bake_resolution: 4096, tex_resolution: 4096, sample_count: 48 } }, { start: 20, duration: 2, params: { exposure: 2 } }];
  const t = tinyEvents(ev);
  for (const e of t) for (const [k, v] of Object.entries(TINY_QUALITY)) assert.equal(e.params[k], v, `${k} in the event at ${e.start}`);
  assert.deepEqual(t.map((e) => [e.start, e.duration, e.params.exposure]), [[10, 5, 1], [20, 2, 2]], 'nothing else moves');
  assert.equal(ev[0].params.bake_resolution, 4096, 'the caller\'s events are not mutated');
});

test('the page applies the same three sizes to the look as tinyEvents applies to the events', () => {
  const html = readFileSync(join(HERE, 'video.html'), 'utf8');
  const m = html.match(/v\.cheapPreroll[\s\S]*?forceGovernorsOff\(\{ \.\.\.params, ([^}]*) \}\)/);
  assert.ok(m, 'cheapPreroll overrides not found');
  const got = Object.fromEntries(m[1].split(',').map((kv) => kv.split(':').map((s) => s.trim())).map(([k, v]) => [k, Number(v)]));
  assert.deepEqual(got, TINY_QUALITY);
});

// ---------------------------------------------------------------- the pool
test('runPool: concurrency never exceeds jobs, and reaches it', async () => {
  for (const jobs of [1, 2, 3, 8]) {
    let active = 0, max = 0;
    await runPool({ segments: Array.from({ length: 12 }, (_, i) => i), jobs, maxAttempts: 3, runSegment: async () => { active++; max = Math.max(max, active); await tick(3); active--; } });
    assert.equal(max, Math.min(jobs, 12), `jobs ${jobs}`);
  }
  let active = 0, max = 0;
  await runPool({ segments: [4, 7], jobs: 8, maxAttempts: 3, runSegment: async () => { active++; max = Math.max(max, active); await tick(3); active--; } });
  assert.equal(max, 2, 'never more workers than segments');
});

test('runPool: every segment runs exactly once on success, and the result lists them all', async () => {
  const seen = [];
  const r = await runPool({ segments: [0, 1, 2, 3, 4, 5, 6], jobs: 3, maxAttempts: 3, runSegment: async ({ segment }) => { seen.push(segment); await tick(segment % 3); } });
  assert.deepEqual(seen.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...r.completed].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok([...r.attempts.values()].every((n) => n === 1));
});

test('runPool: the claim order is the segment order whatever each segment takes, and the first claims go to the workers in turn', async () => {
  const claims = [];
  await runPool({ segments: [0, 1, 2, 3, 4, 5, 6, 7], jobs: 3, maxAttempts: 3, runSegment: async ({ worker, segment }) => { claims.push([segment, worker]); await tick([9, 1, 5, 1, 1, 7, 1, 1][segment]); } });
  assert.deepEqual(claims.map((c) => c[0]), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(claims.slice(0, 3).map((c) => c[1]), [1, 2, 3]);
  // with holes: the same, over what is left
  const holes = [];
  await runPool({ segments: [2, 5, 6, 8], jobs: 2, maxAttempts: 3, runSegment: async ({ segment }) => { holes.push(segment); await tick(1); } });
  assert.deepEqual(holes, [2, 5, 6, 8]);
});

test('runPool: a segment that fails once is retried by the same worker, onFailure sees the failed attempt, and the run succeeds', async () => {
  const log = [], failed = [];
  let n = 0;
  const r = await runPool({
    segments: [0, 1, 2], jobs: 2, maxAttempts: 3,
    runSegment: async ({ worker, segment, attempt }) => { log.push([segment, worker, attempt]); if (segment === 1 && n++ < 1) throw new Error('boom'); await tick(); },
    onFailure: async (f) => { failed.push([f.segment, f.worker, f.attempt, f.error.message]); },
  });
  assert.deepEqual(failed, [[1, 2, 1, 'boom']]);
  const tries = log.filter((l) => l[0] === 1);
  assert.deepEqual(tries.map((t) => t[2]), [1, 2]);
  assert.equal(tries[0][1], tries[1][1], 'the same worker retries');
  assert.deepEqual([...r.completed].sort(), [0, 1, 2]);
  assert.equal(r.attempts.get(1), 2);
});

test('runPool: a segment failing maxAttempts times fails the run with ITS message, after exactly maxAttempts tries, and no further segment is claimed', async () => {
  const tries = new Map(), claimed = [];
  await assert.rejects(runPool({
    segments: [0, 1, 2, 3, 4, 5], jobs: 1, maxAttempts: 3,
    runSegment: async ({ segment }) => { claimed.push(segment); tries.set(segment, (tries.get(segment) ?? 0) + 1); if (segment === 2) throw new Error('segment 2 exploded'); },
  }), /segment 2 exploded/);
  assert.equal(tries.get(2), 3);
  assert.deepEqual([...new Set(claimed)], [0, 1, 2], 'nothing after the failed segment is started');
});

test('runPool: a failed segment does not stop the segments in flight in other sessions: they finish, and the run still fails with the failed one\'s message', async () => {
  const finished = [];
  await assert.rejects(runPool({
    segments: [0, 1, 2, 3], jobs: 3, maxAttempts: 2,
    runSegment: async ({ segment }) => { if (segment === 0) throw new Error('bad browser'); await tick(15); finished.push(segment); },
  }), /bad browser/);
  assert.deepEqual(finished.sort(), [1, 2], 'segments 1 and 2 were in flight and finished; 3 was never claimed');
});

test('runPool: a session that fails (its browser dies) does not stop the others from taking the rest of the segments', async () => {
  const done = [];
  let boom = 0;
  await runPool({
    segments: [0, 1, 2, 3, 4, 5, 6, 7], jobs: 3, maxAttempts: 3,
    runSegment: async ({ segment }) => { await tick(2); if (segment === 1 && boom++ < 2) throw new Error('session died'); done.push(segment); },
  });
  assert.deepEqual(done.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('runPool: a fatal error stops the claims at once, lets segments in flight finish, and is the error that comes out whatever else failed', async () => {
  const finished = [], claimed = [];
  await assert.rejects(runPool({
    segments: [0, 1, 2, 3, 4, 5], jobs: 2, maxAttempts: 3,
    runSegment: async ({ segment }) => {
      claimed.push(segment);
      if (segment === 0) throw Object.assign(new Error('the run is not what it says'), { fatal: true });
      await tick(10); finished.push(segment);
    },
  }), /the run is not what it says/);
  assert.deepEqual(claimed, [0, 1], 'one try of the fatal segment (a fatal error is not retried), and nothing claimed after it');
  assert.deepEqual(finished, [1]);
});

test('runPool: resume runs only the holes (todoSegments over what is on disk), never a finished segment', async () => {
  const onDisk = new Set([0, 1, 3, 4, 7, 8]);
  const ran = [];
  const todo = todoSegments({ nSegs: 10, isDone: (i) => onDisk.has(i) });
  await runPool({ segments: todo, jobs: 3, maxAttempts: 3, runSegment: async ({ segment }) => { ran.push(segment); onDisk.add(segment); await tick(); } });
  assert.deepEqual(ran.sort((a, b) => a - b), [2, 5, 6, 9]);
  assert.deepEqual(todoSegments({ nSegs: 10, isDone: (i) => onDisk.has(i) }), [], 'and nothing is left');
});

test('runPool: no segments is a no-op', async () => {
  const r = await runPool({ segments: [], jobs: 3, maxAttempts: 3, runSegment: async () => { throw new Error('never'); } });
  assert.deepEqual(r.completed, []);
});

// ---------------------------------------------------------------- the exporter as a process: --jobs is not in the run key
const RENDER_VIDEO = join(HERE, 'render-video.mjs');
const NO_BROWSERS = join(tmpdir(), 'komorebi-video-test-no-browsers');
function exporter(args) {
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: NO_BROWSERS };
  delete env.ARBORETUM_TOKEN;
  const r = spawnSync(process.execPath, [RENDER_VIDEO, ...args], { encoding: 'utf8', env, maxBuffer: 64 << 20 });
  return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}
const base = (look, out) => ['--look-json', look, '--commit', 'HEAD', '--out', out, '--seconds', '1', '--fps', '30', '--size', '128x72', '--preroll', '1', '--segment-seconds', '1', '--delivery', 'none'];

test('--jobs 1, no --jobs and --jobs 3 make the SAME run key; the key body has no jobs; the invocation records it', () => withDir((root) => {
  const look = join(root, 'look.json');
  writeFileSync(look, '{"params":{"leaf_size":1}}\n');
  const keys = {};
  for (const [name, extra] of [['none', []], ['one', ['--jobs', '1']], ['three', ['--jobs', '3']]]) {
    const out = join(root, name);
    const r = exporter([...base(look, out), ...extra]);   // the key is written, then the first browser launch fails (no browsers path)
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /Executable doesn't exist/, `${name}: stops at the impossible browser launch`);
    const rk = JSON.parse(readFileSync(join(out, 'run-key.json'), 'utf8'));
    keys[name] = rk.key;
    assert.ok(!JSON.stringify(rk.body).includes('jobs'), `${name}: no jobs in the key body`);
    assert.equal(rk.invocation.argv.includes('--jobs'), extra.length > 0, `${name}: the argv records --jobs`);
  }
  assert.equal(keys.one, keys.none);
  assert.equal(keys.three, keys.none);
  // and a folder rendered with one setting resumes under another: the key matches, so the run is not refused
  const again = exporter([...base(look, join(root, 'none')), '--jobs', '3']);
  assert.equal(again.status, 1, again.all);
  assert.doesNotMatch(again.err, /different key/);
}));

test('--jobs outside 1..8, or not a number, is refused (exit 2, one line) before anything is created', () => withDir((root) => {
  const look = join(root, 'look.json');
  writeFileSync(look, '{"params":{}}\n');
  for (const bad of ['0', '9', 'x', '2.5']) {
    const out = join(root, `out-${bad}`);
    const r = exporter([...base(look, out), '--jobs', bad]);
    assert.equal(r.status, 2, `${bad}: ${r.all}`);
    assert.match(r.err, /--jobs .*1 to 8/);
    assert.ok(!existsSync(out), 'nothing created');
  }
  const last = exporter([...base(look, join(root, 'o')).slice(0, -2), '--jobs']);   // --jobs with no value, last
  assert.equal(last.status, 2, last.all);
}));
test('--help documents --jobs', () => {
  const r = exporter(['--help']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /--jobs N/);
  assert.match(r.out, /compare-runs\.mjs/);
});

// ---------------------------------------------------------------- compare-runs.mjs
// A run folder as the exporter leaves it, as far as the comparison reads: run-key.json, manifest.json, seg/*.json, hashes.txt, ckpt/
function makeRun(root, name, over = {}) {
  const o = { key: 'k'.repeat(64), pipeline: 'master', segs: [{ frames: 3, hashes: ['aa', 'bb', 'cc'] }, { frames: 2, hashes: ['dd', 'ee'] }], ckpts: { 100: { u: 1 }, 200: { u: 2 } }, ...over };
  const dir = join(root, name);
  mkdirSync(join(dir, 'seg'), { recursive: true }); mkdirSync(join(dir, 'ckpt'));
  writeFileSync(join(dir, 'run-key.json'), JSON.stringify({ key: o.key, body: { fps: 30, ...(o.pipeline === 'master' ? {} : { pipeline: o.pipeline }) } }));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ run_key: o.manifestKey ?? o.key }));
  let first = 0, n = 0;
  o.segs.forEach((s, i) => {
    writeFileSync(join(dir, 'seg', `seg_${String(i).padStart(5, '0')}.json`), JSON.stringify({ segment: i, first_frame: first, frames: s.frames, packets: s.frames, file_sha256: s.sha ?? `sha${i}`, hashes_sha256: s.hashes.join('|'), render_wall_ms: Math.random() }));
    first += s.frames;
    n += s.hashes.length;
  });
  if (o.pipeline === 'master') writeFileSync(join(dir, 'hashes.txt'), `${o.segs.flatMap((s) => s.hashes).map((h, i) => `${i + 1} ${h}`).join('\n')}\n`);
  for (const [at, state] of Object.entries(o.ckpts)) writeFileSync(join(dir, 'ckpt', `ckpt_${String(at).padStart(9, '0')}.json`), JSON.stringify({ at: Number(at), state, ...(o.tiny ? { tiny: true } : {}) }));
  return dir;
}

test('compare-runs: two renders of the same frames are identical, whatever their timings and checkpoint markers', () => withDir((root) => {
  const a = makeRun(root, 'a'), b = makeRun(root, 'b', { tiny: true });
  assert.deepEqual(compareRuns(a, b), []);
}));

test('compare-runs: a different frame hash is named by its frame number, first', () => withDir((root) => {
  const a = makeRun(root, 'a');
  const b = makeRun(root, 'b', { segs: [{ frames: 3, hashes: ['aa', 'bb', 'cc'] }, { frames: 2, hashes: ['dd', 'XX'] }] });
  const d = compareRuns(a, b);
  assert.ok(d.length >= 1);
  assert.ok(d.some((m) => /hashes\.txt: frame 5 differs \(5 ee vs 5 XX\)/.test(m)), d.join('\n'));
}));

test('compare-runs: a different run key, a manifest of another key, a different segment count and a different frame count are each a difference', () => withDir((root) => {
  const a = makeRun(root, 'a');
  assert.match(compareRuns(a, makeRun(root, 'k', { key: 'z'.repeat(64) }))[0], /run key differs/);
  assert.match(compareRuns(a, makeRun(root, 'm', { manifestKey: 'z'.repeat(64) }))[0], /manifest\.json run_key/);
  assert.match(compareRuns(a, makeRun(root, 's', { segs: [{ frames: 3, hashes: ['aa', 'bb', 'cc'] }] }))[0], /segment records: 2 vs 1/);
  assert.ok(compareRuns(a, makeRun(root, 'f', { segs: [{ frames: 3, hashes: ['aa', 'bb', 'cc'] }, { frames: 3, hashes: ['dd', 'ee', 'ff'] }] })).some((m) => /frames 2 vs 3/.test(m)));
}));

test('compare-runs: direct pipelines are compared by each segment\'s encoded-file hash (their pixels are never read back); master mkv bytes are not compared', () => withDir((root) => {
  const segs = (sha) => [{ frames: 3, hashes: ['a', 'b', 'c'], sha }, { frames: 2, hashes: ['d', 'e'], sha: 'same' }];
  const a = makeRun(root, 'a', { pipeline: 'gpu', segs: segs('one') });
  assert.deepEqual(compareRuns(a, makeRun(root, 'b', { pipeline: 'gpu', segs: segs('one') })), []);
  assert.match(compareRuns(a, makeRun(root, 'c', { pipeline: 'gpu', segs: segs('two') }))[0], /seg_00000\.json: encoded file differs/);
  const m = makeRun(root, 'm', { segs: segs('one') });
  assert.deepEqual(compareRuns(m, makeRun(root, 'n', { segs: segs('two') })), [], 'a master compares frame hashes, not the .mkv bytes');
}));

test('compare-runs: a checkpoint both folders hold must carry the same state (the tiny engine against the full-size one); one only a folder holds is not compared', () => withDir((root) => {
  const a = makeRun(root, 'a');
  const d = compareRuns(a, makeRun(root, 'b', { tiny: true, ckpts: { 100: { u: 1 }, 200: { u: 2.0000001 } } }));
  assert.match(d.join('\n'), /ckpt_000000200\.json: the integrator state differs \(B is from the tiny engine\)/);
  assert.deepEqual(compareRuns(a, makeRun(root, 'c', { tiny: true, ckpts: { 100: { u: 1 }, 200: { u: 2 }, 300: { u: 99 } } })), []);
}));

test('compare-runs: a folder that is not a run is "not comparable" (a thrown error), not "identical"', () => withDir((root) => {
  const a = makeRun(root, 'a');
  mkdirSync(join(root, 'empty'));
  assert.throws(() => compareRuns(a, join(root, 'empty')), (e) => e.code === 'NOT_COMPARABLE' && /run-key\.json/.test(e.message));
}));

test('compare-runs CLI: exit 0 identical, 1 different (first difference on stderr), 2 not comparable or bad usage', () => withDir((root) => {
  const a = makeRun(root, 'a'), b = makeRun(root, 'b'), c = makeRun(root, 'c', { segs: [{ frames: 3, hashes: ['aa', 'bb', 'cc'] }, { frames: 2, hashes: ['dd', 'XX'] }] });
  const cli = (...args) => spawnSync(process.execPath, [join(HERE, 'compare-runs.mjs'), ...args], { encoding: 'utf8' });
  assert.equal(cli(a, b).status, 0);
  assert.match(cli(a, b).stdout, /IDENTICAL/);
  const diff = cli(a, c);
  assert.equal(diff.status, 1);
  assert.match(diff.stderr, /DIFFERENT: .*frame 5/s);
  assert.equal(cli(a, join(root, 'nowhere')).status, 2);
  assert.equal(cli(a).status, 2);
}));
