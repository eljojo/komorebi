// The burn test's pure half (burn-lib.mjs): the load ladder, the frame statistics, the grades and the stop rule.
//   node --test test-gl/burn.test.mjs        (no browser, no GPU)
// What this cannot show: anything about a real frame. burn.mjs runs the ladder in a headed browser on the machine under test.
import test from 'node:test';
import assert from 'node:assert/strict';

const lib = await import('./burn-lib.mjs').catch(() => ({}));

test('the ladder starts at the look as authored and ends with every load slider at its editor maximum', () => {
  const base = { tree_count: 5, foliage_density: 1.65, leaves_per_cluster: 39, layer_count: 3, sample_count: 32, tex_resolution: 1024, wind_strength: 1 };
  const first = lib.levelLook(base, 0, 10), last = lib.levelLook(base, 9, 10);
  for (const [k, v] of Object.entries(base)) assert.equal(first[k], v, `level 0 keeps ${k}`);
  assert.deepEqual([last.tree_count, last.foliage_density, last.leaves_per_cluster, last.layer_count, last.sample_count, last.tex_resolution], [16, 3, 80, 4, 48, 4096]);
  const mid = lib.levelLook(base, 4, 10);
  assert.ok(mid.tree_count > 5 && mid.tree_count < 16 && Number.isInteger(mid.tree_count), 'integer knobs step in whole numbers');
  assert.ok(mid.foliage_density > 1.65 && mid.foliage_density < 3);
  for (let l = 1; l < 10; l++) for (const k of ['tree_count', 'foliage_density', 'leaves_per_cluster', 'sample_count'])
    assert.ok(lib.levelLook(base, l, 10)[k] >= lib.levelLook(base, l - 1, 10)[k], `${k} never falls between levels`);
  assert.equal(lib.levelLook({ ...base, tree_count: 20 }, 9, 10).tree_count, 20, 'a look already past the maximum is not lowered');
  assert.equal(last.wind_strength, 1, 'the ladder leaves the wind to the shuttles');
});

test('frame statistics: fps, percentiles, the share of frames over the 60 fps budget, the worst hitch', () => {
  const ms = [...Array(97).fill(10), 20, 20, 120];
  const s = lib.frameStats(ms);
  assert.equal(s.frames, 100);
  assert.equal(s.p50, 10);
  assert.equal(s.worst, 120);
  assert.equal(s.over, 0.03, 'three frames took longer than 16.7 ms');
  assert.ok(Math.abs(s.fps - 1000 / (ms.reduce((a, b) => a + b) / 100)) < 1e-9);
  assert.equal(lib.frameStats([]).frames, 0);
});

// The browser runs without vsync or a frame-rate cap, so an interval is what the frame cost: CPU and GPU together, with
// nothing waiting on the display. 60 fps is a 16.7 ms budget.
test('grades: comfortable keeps a quarter of the budget spare even in the slowest 1% of frames; holding fits the budget 95% of the time; else breaking', () => {
  assert.equal(lib.grade(lib.frameStats(Array(600).fill(8))), 'comfortable');
  assert.equal(lib.grade(lib.frameStats([...Array(597).fill(8), 14, 14, 14])), 'comfortable', '99% of frames at 8 ms');
  assert.equal(lib.grade(lib.frameStats(Array(600).fill(14))), 'holding', 'fits, with under a quarter spare');
  assert.equal(lib.grade(lib.frameStats([...Array(585).fill(10), ...Array(15).fill(30)])), 'holding', '2.5% of frames over budget');
  assert.equal(lib.grade(lib.frameStats([...Array(560).fill(10), ...Array(40).fill(30)])), 'breaking', '6.7% over budget');
  assert.equal(lib.grade(lib.frameStats(Array(600).fill(25))), 'breaking');
  assert.equal(lib.grade(lib.frameStats([])), 'breaking', 'no frames at all is not a pass');
  assert.equal(lib.worst(['comfortable', 'breaking', 'holding']), 'breaking');
});

test('the stop rule ends a tier after two breaking levels in a row, as a beep test ends on the second miss', () => {
  assert.equal(lib.shouldStop(['comfortable', 'holding', 'breaking']), false);
  assert.equal(lib.shouldStop(['comfortable', 'breaking', 'holding', 'breaking']), false);
  assert.equal(lib.shouldStop(['comfortable', 'breaking', 'breaking']), true);
});

test('a tier reads as how far it stayed comfortable, how far it held, and where it first broke', () => {
  assert.deepEqual(lib.tierSummary(['comfortable', 'comfortable', 'holding', 'comfortable', 'breaking', 'breaking']), { comfortableTo: 1, holdsTo: 3, breaksAt: 4 });
  assert.deepEqual(lib.tierSummary(['comfortable', 'comfortable']), { comfortableTo: 1, holdsTo: 1, breaksAt: null });
  assert.deepEqual(lib.tierSummary(['breaking', 'breaking']), { comfortableTo: null, holdsTo: null, breaksAt: 0 });
});

test('a transition is named by the route the engine took', () => {
  assert.equal(lib.routeOf({ active: true, groveTravel: true }), 'grove travel');
  assert.equal(lib.routeOf({ active: true, litterRise: true }), 'litter rise');
  assert.equal(lib.routeOf({ active: true, seasonTravel: true }), 'season travel');
  assert.equal(lib.routeOf({ active: true, leafTravel: true }), 'leaf travel');
  assert.equal(lib.routeOf({ active: true, sceneFade: true }), 'scene fade');
  assert.equal(lib.routeOf({ active: true, crossfade: true }), 'crossfade');
  assert.equal(lib.routeOf({ active: true }), 'morph');
  assert.equal(lib.routeOf({ active: false }), 'none');
});

test('resolution tiers render 1080p, 1440p and 4K from one 1920x1080 window', () => {
  assert.deepEqual(Object.keys(lib.TIERS), ['1080p', '1440p', '4k']);
  for (const [name, t] of Object.entries(lib.TIERS)) {
    assert.deepEqual([Math.round(1920 * t.dpr), Math.round(1080 * t.dpr)], { '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160] }[name]);
  }
});
