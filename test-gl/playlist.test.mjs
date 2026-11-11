// The exporter's playlist mode, held without a browser: the timeline arithmetic, the spec and file parsers, and the arboretum playlist fetch against a mock in this process.
//   nix shell nixpkgs#nodejs_22 -c node --test test-gl/playlist.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as lib from './video-lib.mjs';
import * as engine from '../komorebi-params.js';
import { makeTransitions } from '../komorebi-transitions.js';
import { restorePoint } from './parallel.mjs';

const FPS = 60, PRE = 1800;
const items = (n, dwell = 1, cross = 6) => Array.from({ length: n }, () => ({ dwell_s: dwell, crossfade_s: cross }));

test('playlistSchedule: the first look is there for its dwell, then each next look fades in over ITS OWN crossfade and its dwell counts from the landing', () => {
  const it = [{ dwell_s: 2, crossfade_s: 9 }, { dwell_s: 1, crossfade_s: 6 }, { dwell_s: 3, crossfade_s: 4 }];
  const ev = lib.playlistSchedule({ items: it, fps: FPS, preroll: PRE, frames: 60 * 60 });
  // look 0 for 2 s (pumps PRE+1..PRE+120), then the fade into look 1 starts BEFORE pump PRE+121 and lasts 6 s (look 1's crossfade)
  assert.deepEqual(ev[0], { k: 1, stop: 1, start: PRE + 121, land: PRE + 121 + 360 + lib.LAND_MARGIN, duration_s: 6, style: 'morph' });
  // look 1's dwell (1 s) is counted from its landing; look 2 then fades in over 4 s
  assert.equal(ev[1].start, ev[0].land + 60 + 1);
  assert.equal(ev[1].land - ev[1].start, 240 + lib.LAND_MARGIN);
  // it loops: the item after the last is the first, faded in over the first's crossfade (9 s)
  assert.equal(ev[2].stop, 0);
  assert.equal(ev[2].duration_s, 9);
  assert.equal(ev[3].stop, 1);
});

test('playlistSchedule: starts are strictly after the previous landing, fades never overlap, and nothing starts at or past the last frame', () => {
  const frames = 7200;
  const ev = lib.playlistSchedule({ items: items(11), fps: FPS, preroll: PRE, frames });
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].start > ev[i - 1].land, `fade ${i} starts after fade ${i - 1} landed`);
  assert.ok(ev.every((e) => e.start <= PRE + frames));
  assert.ok(ev.length >= 11 && ev.length < 20, `${ev.length} fades in 120 s of 7 s slots`);
});

test('playlistSchedule: one look has nothing to transition to; a render shorter than the first dwell has no fade', () => {
  assert.deepEqual(lib.playlistSchedule({ items: items(1), fps: FPS, preroll: PRE, frames: 9999 }), []);
  assert.deepEqual(lib.playlistSchedule({ items: items(3, 30), fps: FPS, preroll: PRE, frames: 600 }), []);
});

test('playlistSchedule: a zero crossfade is a cut that still lands (the margin covers it)', () => {
  const ev = lib.playlistSchedule({ items: items(2, 1, 0), fps: FPS, preroll: PRE, frames: 600 });
  assert.equal(ev[0].land - ev[0].start, lib.LAND_MARGIN);
});

for (const [style, change, scale] of [['fade', { foliage_density: 1.5 }, 2], ['fade', { exposure: 2 }, 1], ['morph', { foliage_density: 1.5 }, 1]]) {
  test(`playlistSchedule: ${style} ${Object.keys(change)[0]} checkpoints match the engine clock and resume during the passage`, () => {
    const a = { ...engine.DEFAULTS }, b = { ...a, ...change }, noop = () => {};
    const hub = { params: { ...a }, trans: { dur: 1 }, layerVAO: [{ count: 1000 }], groveIn: null,
      faithfulOn: () => false, warnCut: noop, regenSource: noop, resetPerf: noop, bake: noop, regenCanopy: noop,
      rebuildAll: noop, motionActive: () => false, beginSceneFade: noop, stepSceneFade: noop, endSceneFade: noop };
    const router = makeTransitions(hub), items = [{ params: a, dwell_s: 1, crossfade_s: 1 }, { params: b, dwell_s: 1, crossfade_s: 1, style }];
    const schedule = lib.playlistSchedule({ items, fps: FPS, preroll: 0, frames: 600, engine });
    const event = schedule[0];
    router.transitionTo(b, { duration: event.duration_s, style: event.style });
    for (let pump = event.start; pump <= event.land; pump++) router.tickTransition(lib.stepMsFor(FPS) / 1000);
    assert.equal(hub.trans.active, false, 'a landing checkpoint must contain a settled engine');
    assert.equal(event.land - event.start, 60 * scale + lib.LAND_MARGIN);
    const mid = event.start + 60 * scale - 1;
    assert.deepEqual(restorePoint({ from: mid, schedule, preroll: 0 }), { at: event.start - 1, stop: 0, replay: mid - event.start + 1 });
    assert.deepEqual(restorePoint({ from: event.land, schedule, preroll: 0 }), { at: event.land, stop: 1, replay: 0 });
    assert.equal(schedule[1].start, event.land + 60 + 1, 'the dwell follows the actual landing');
  });
}

test('checkPlaylistTimes: arboretum\'s limits, and a whole number of frames', () => {
  lib.checkPlaylistTimes(items(2), FPS);
  assert.throws(() => lib.checkPlaylistTimes([{ dwell_s: 0.5, crossfade_s: 5 }], FPS), /dwell_s must be 1\.\.3600/);
  assert.throws(() => lib.checkPlaylistTimes([{ dwell_s: 5, crossfade_s: 121 }], FPS), /crossfade_s must be 0\.\.120/);
  assert.throws(() => lib.checkPlaylistTimes([{ dwell_s: 1.01, crossfade_s: 5 }], FPS), /whole number of frames/);
  lib.checkPlaylistTimes([{ dwell_s: 1.5, crossfade_s: 2.5 }], 30);
});

test('parsePlaylistSpec: <id>[:share_token]; a version or anything else is refused without echoing the share token', () => {
  assert.deepEqual(lib.parsePlaylistSpec('3'), { id: 3, share: null });
  assert.deepEqual(lib.parsePlaylistSpec('12:abc_DEF-9'), { id: 12, share: 'abc_DEF-9' });
  for (const bad of ['', '0', 'x', '3@1', '3@1:SECRETSHARE', '-3']) {
    assert.throws(() => lib.parsePlaylistSpec(bad), (e) => /<id>\[:<share_token>\]/.test(e.message) && !e.message.includes('SECRETSHARE'), bad);
  }
});

test('playlistFromJson: a list or { name, items }, with arboretum\'s defaults (30 s, 5 s); params are required', () => {
  const a = lib.playlistFromJson([{ params: { exposure: 1 } }, { name: 'b', params: { exposure: 2 }, dwell_s: 4, crossfade_s: 1 }], 'f.json');
  assert.equal(a.name, 'f.json');
  assert.deepEqual(a.items.map((i) => [i.name, i.dwell_s, i.crossfade_s]), [['item 1', 30, 5], ['b', 4, 1]]);
  assert.equal(lib.playlistFromJson({ name: 'mine', items: [{ params: {} }] }).name, 'mine');
  assert.throws(() => lib.playlistFromJson([]), /non-empty/);
  assert.throws(() => lib.playlistFromJson([{ dwell_s: 3 }]), /item 1 has no params/);
});

test('redactArgv: the playlist\'s share token leaves the argv, with a hash prefix to say which link it was', () => {
  const out = lib.redactArgv(['--arboretum-playlist', '3:SECRETSHARE', '--out', 'x']);
  assert.ok(!out.join(' ').includes('SECRETSHARE'));
  assert.match(out[1], /^3:<share token omitted, sha256 [0-9a-f]{8}>$/);
});

// ---- fetchArboretumPlaylist against a mock that answers arboretum's live shape ----
const TOKEN = 'arb_MOCKTOKEN', SHARE = 'MOCKSHARE';
const item = (id, over = {}) => ({ preset_id: id, version: 1, owner: 'eljojo', name: `look ${id}`, dwell_s: 1, crossfade_s: 6, params: { exposure: id }, ...over });
async function mock(body, status = 200) {
  const requests = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    requests.push({ path: u.pathname, k: u.searchParams.get('k'), authorization: req.headers.authorization ?? null });
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(typeof body === 'function' ? body(u) : body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

test('fetchArboretumPlaylist: the items in order with their dwell, crossfade and params; the share token as ?k=; the bearer when there is a token', async () => {
  const m = await mock({ id: 3, name: 'rainbow', revision: 1, items: [item(4), item(40, { dwell_s: 2 })] });
  try {
    const pl = await lib.fetchArboretumPlaylist({ base: m.base, id: 3, share: SHARE, token: TOKEN });
    assert.equal(pl.name, 'rainbow');
    assert.equal(pl.revision, 1);
    assert.deepEqual(pl.items.map((i) => [i.preset_id, i.dwell_s, i.crossfade_s, i.params.exposure]), [[4, 1, 6, 4], [40, 2, 6, 40]]);
    assert.deepEqual(m.requests.at(-1), { path: '/api/playlists/3', k: SHARE, authorization: `Bearer ${TOKEN}` });
    await lib.fetchArboretumPlaylist({ base: m.base, id: 3 });
    assert.deepEqual(m.requests.at(-1), { path: '/api/playlists/3', k: null, authorization: null });
  } finally { await m.close(); }
});

test('fetchArboretumPlaylist: an unavailable item, an empty list, another playlist or an item with no params is refused, not skipped', async () => {
  for (const [body, re] of [
    [{ id: 3, items: [item(4), { preset_id: 9, dwell_s: 1, crossfade_s: 1, unavailable: true }] }, /item 2 \(preset 9\) is unavailable/],
    [{ id: 3, items: [] }, /no items/],
    [{ id: 7, items: [item(4)] }, /not that playlist/],
    [{ id: 3, items: [item(4, { params: null })] }, /item 1 has no params/],
  ]) {
    const m = await mock(body);
    try { await assert.rejects(lib.fetchArboretumPlaylist({ base: m.base, id: 3 }), re); } finally { await m.close(); }
  }
});

test('fetchArboretumPlaylist: 401 / 403 / 404 / 422 are refusals naming the playlist; neither token appears even when the server echoes them', async () => {
  for (const status of [401, 403, 404, 422]) {
    const m = await mock({ error: `bad ${TOKEN} ${SHARE}` }, status);
    try {
      await assert.rejects(lib.fetchArboretumPlaylist({ base: m.base, id: 3, share: SHARE, token: TOKEN }), (e) => {
        assert.ok(e instanceof lib.ArboretumError && e.refusal === true, `${status} is a refusal`);
        assert.match(e.message, /^arboretum playlist 3: /);
        assert.ok(!e.message.includes(TOKEN) && !e.message.includes(SHARE));
        return true;
      });
    } finally { await m.close(); }
  }
  const m = await mock({}, 503);
  try { await assert.rejects(lib.fetchArboretumPlaylist({ base: m.base, id: 3 }), (e) => e instanceof lib.ArboretumError && e.refusal === false); } finally { await m.close(); }
});

test('fetchArboretumPlaylist: the bearer token is never sent over plain http to another host', async () => {
  await assert.rejects(lib.fetchArboretumPlaylist({ base: 'http://example.com', id: 3, token: TOKEN }), (e) => /must be https/.test(e.message) && !e.message.includes(TOKEN));
});

// ---- an item's style: how its look arrives ('morph' by default, or 'fade') ----
test('playlistSchedule: each event carries its item\'s style, morph when absent', () => {
  const it = [{ dwell_s: 1, crossfade_s: 1 }, { dwell_s: 1, crossfade_s: 1, style: 'fade' }, { dwell_s: 1, crossfade_s: 1, style: 'morph' }];
  const ev = lib.playlistSchedule({ items: it, fps: FPS, preroll: PRE, frames: 3600 });
  assert.deepEqual(ev.slice(0, 3).map((e) => [e.stop, e.style]), [[1, 'fade'], [2, 'morph'], [0, 'morph']]);
});

test('playlistFromJson: an optional style per item, morph by default; anything but morph or fade is refused naming the item', () => {
  const a = lib.playlistFromJson([{ params: {} }, { params: {}, style: 'fade' }, { params: {}, style: 'morph' }]);
  assert.deepEqual(a.items.map((i) => i.style), ['morph', 'fade', 'morph']);
  assert.throws(() => lib.playlistFromJson([{ params: {} }, { params: {}, style: 'wipe' }]), /item 2: style must be 'morph' or 'fade'/);
});

test('fetchArboretumPlaylist: an item\'s style is read, and an unknown or absent one is morph', async () => {
  const m = await mock({ id: 3, name: 'x', revision: 1, items: [item(4, { style: 'fade' }), item(5), item(6, { style: 'wipe' })] });
  try {
    const pl = await lib.fetchArboretumPlaylist({ base: m.base, id: 3 });
    assert.deepEqual(pl.items.map((i) => i.style), ['fade', 'morph', 'morph']);
  } finally { await m.close(); }
});

test('playlistRunBlock: the run key block holds each item\'s style, and a morph playlist hashes as it did before styles existed', () => {
  assert.deepEqual(lib.playlistRunBlock({ id: null, revision: null, items: [{ preset_id: null, version: null, dwell_s: 1, crossfade_s: 2, style: 'morph' }] }, () => 'h'), { id: null, revision: null, items: [{ preset_id: null, version: null, dwell_s: 1, crossfade_s: 2, params_sha256: 'h' }] });
  assert.deepEqual(lib.playlistRunBlock({ id: null, revision: null, items: [{ preset_id: null, version: null, dwell_s: 1, crossfade_s: 2, style: 'fade' }] }, () => 'h'), { id: null, revision: null, items: [{ preset_id: null, version: null, dwell_s: 1, crossfade_s: 2, params_sha256: 'h', style: 'fade' }] });
});
