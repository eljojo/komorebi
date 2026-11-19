import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import engine from '../public/engine/engine.json';
import { lineage } from '../public/js/lineage-infer.js';
import builtins from './fixtures/lineage.json';
import { asSession, call, makeToken, makeUser } from './helpers';

// The lineage page: a person's presets and komorebi's built-in looks as one family tree. The tree is worked out by
// lineage-infer.js (in the browser), from GET /api/export and the built-ins file scripts/engine.mjs writes.

type Look = { name: string; params: Record<string, unknown>; comment?: string; date: number | null };
type Version = { n: number; params: Record<string, unknown>; parent?: string | null; created_at: number; via?: string; name?: string; description?: string | null };

// A small engine: five sliders 0..10, a seed, and the keys that are never the look.
function engineOf(looks: Look[]) {
  return {
    defaults: { a: 0, b: 0, c: 0, d: 0, e: 0, seed: 1, drift_phase: 0, sample_count: 32 },
    ranges: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((k) => [k, { min: 0, max: 10 }])),
    angleKeys: [],
    legacyKeys: { old_a: 'a' },
    skipKeys: ['sample_count'],
    labels: {},
    looks: looks.map((l, order) => ({ comment: '', experimental: false, playlists: [], ...l, order })),
  };
}
function exportOf(presets: { id: number; versions: Version[]; archived?: boolean }[]) {
  return {
    presets: presets.map((p) => ({
      id: p.id,
      visibility: 'private',
      archived_at: p.archived ? 1 : null,
      versions: p.versions.map((v) => ({ name: `look ${p.id}`, description: null, tags: [], parent: null, via: 'editor', ...v })),
    })),
    playlists: [],
  };
}
const parentOf = (tree: ReturnType<typeof lineage>, id: string) => tree.edges.find((e: any) => e.to === id && e.primary);

const DAY = 86_400_000;
const LOOKS: Look[] = [
  { name: 'first', params: { a: 1 }, date: 1 * DAY },
  { name: 'second', params: { a: 1, b: 5 }, comment: "'second' — first, with b raised", date: 2 * DAY },
];

describe('lineage-infer', () => {
  it('hangs the oldest built-in from the engine defaults, and a built-in from the look its comment names', () => {
    const tree = lineage(engineOf(LOOKS), exportOf([]));
    expect(parentOf(tree, 'look:first')).toMatchObject({ from: 'defaults' });
    expect(parentOf(tree, 'look:second')).toMatchObject({ from: 'look:first', kind: 'comment' });
  });

  it('believes a declared parent, and follows a preset from version to version', () => {
    const tree = lineage(engineOf(LOOKS), exportOf([
      { id: 7, versions: [{ n: 1, params: { a: 9, b: 9, c: 9 }, parent: 'look:second', created_at: 3 * DAY }, { n: 2, params: { a: 8 }, created_at: 4 * DAY }] },
    ]));
    expect(parentOf(tree, 'preset:7@1')).toMatchObject({ from: 'look:second', kind: 'declared' });
    expect(parentOf(tree, 'preset:7@2')).toMatchObject({ from: 'preset:7@1', kind: 'version' });
  });

  it('infers the nearest look, but never one younger than the preset', () => {
    // Nearest to `second`, but saved half a day before git first saw `second`.
    const params = { a: 2, b: 5, c: 3, d: 3, e: 3 };
    const tree = lineage(engineOf(LOOKS), exportOf([{ id: 1, versions: [{ n: 1, params, created_at: 1.5 * DAY }] }]));
    expect(parentOf(tree, 'preset:1@1')).toMatchObject({ from: 'look:first', kind: 'inferred' });
    const later = lineage(engineOf(LOOKS), exportOf([{ id: 1, versions: [{ n: 1, params, created_at: 3 * DAY }] }]));
    expect(parentOf(later, 'preset:1@1')).toMatchObject({ from: 'look:second', kind: 'inferred' });
  });

  it('calls a look that differs in three parameters or fewer a copy, and lists what changed, the biggest first', () => {
    const tree = lineage(engineOf(LOOKS), exportOf([
      { id: 1, versions: [{ n: 1, params: { a: 5, b: 5, c: 5, d: 5 }, created_at: 3 * DAY }] },
      { id: 2, versions: [{ n: 1, params: { a: 5, b: 5, c: 6, d: 5 }, created_at: 4 * DAY }] },
    ]));
    const e = parentOf(tree, 'preset:2@1');
    expect(e).toMatchObject({ from: 'preset:1@1', kind: 'copy' });
    expect(e.changed).toEqual([{ k: 'c', from: 5, to: 6, d: 0.1 }]);
  });

  it('compares looks as the engine loads them: legacy names migrated, the drift phase and machine keys left out', () => {
    const tree = lineage(engineOf(LOOKS), exportOf([{ id: 1, versions: [{ n: 1, params: { old_a: 1, drift_phase: 2.5, sample_count: 16 }, created_at: 3 * DAY }] }]));
    expect(parentOf(tree, 'preset:1@1')).toMatchObject({ from: 'look:first', kind: 'copy', changed: [] });
  });

  it('takes a description that names a built-in when that look is about as near as the nearest', () => {
    // `second` is nearer (1.0 against 1.3), but not by enough to overrule what the description says.
    const looks = [...LOOKS, { name: 'acid dreams', params: { a: 1, b: 2, c: 2 }, date: 2.5 * DAY }];
    const tree = lineage(engineOf(looks), exportOf([{ id: 1, versions: [{ n: 1, params: { a: 2, b: 5, c: 1, d: 4, e: 4 }, description: 'based on acid dreams', created_at: 3 * DAY }] }]));
    expect(parentOf(tree, 'preset:1@1')).toMatchObject({ from: 'look:acid dreams', kind: 'inferred' });
  });

  it('hangs a built-in that carries a preset’s name from that preset: the preset became the built-in', () => {
    const looks = [...LOOKS, { name: 'Blue Hour', params: { a: 2, b: 2, c: 2, d: 2 }, date: 5 * DAY }];
    const tree = lineage(engineOf(looks), exportOf([{ id: 3, versions: [{ n: 1, name: 'blue hour', params: { a: 2, b: 2, c: 2, d: 3 }, created_at: 4 * DAY }] }]));
    expect(parentOf(tree, 'look:Blue Hour')).toMatchObject({ from: 'preset:3@1', kind: 'promoted' });
  });

  it('marks versions many presets were given together as a bulk re-save', () => {
    const presets = [1, 2, 3, 4, 5].map((id) => ({
      id,
      versions: [{ n: 1, params: { a: id }, created_at: 3 * DAY }, { n: 2, params: { a: id, e: 1 }, via: 'token:bot', created_at: 9 * DAY + id * 1000 }],
    }));
    const tree = lineage(engineOf(LOOKS), exportOf(presets));
    expect(parentOf(tree, 'preset:3@2')).toMatchObject({ from: 'preset:3@1', kind: 'sweep' });
  });

  it('keeps a declared look komorebi no longer ships as a node of its own', () => {
    const tree = lineage(engineOf(LOOKS), exportOf([{ id: 1, versions: [{ n: 1, params: { a: 4 }, parent: 'look:retired', created_at: 3 * DAY }] }]));
    expect(tree.nodes.find((n: any) => n.id === 'look:retired')).toMatchObject({ gone: true });
    expect(parentOf(tree, 'preset:1@1')).toMatchObject({ from: 'look:retired', kind: 'declared' });
  });

  it('roots every one of komorebi’s built-in looks in the engine defaults, without a cycle', () => {
    const tree = lineage(builtins, exportOf([]));
    const byId = new Map(tree.nodes.map((n: any) => [n.id, n]));
    expect(tree.nodes.filter((n: any) => n.kind === 'look')).toHaveLength(builtins.looks.length);
    for (const n of tree.nodes as any[]) {
      let a = n;
      for (let i = 0; a.parent && i <= tree.nodes.length; i++) a = byId.get(a.parent);
      expect(a.id, n.id).toBe('defaults');
    }
  });
});

describe('/arboretum/lineage', () => {
  const unfollowed = (headers: Record<string, string> = {}) =>
    exports.default.fetch(new Request('https://arboretum.test/arboretum/lineage', { redirect: 'manual', headers }));

  it('sends a signed-out visitor, or someone holding only a token, to sign in: it is a person’s page', async () => {
    const user = await makeUser('lineage');
    const asked: Record<string, string>[] = [{}, { Authorization: `Bearer ${await makeToken(user)}` }];
    for (const headers of asked) {
      const r = await unfollowed(headers);
      expect(r.status).toBe(302);
      expect(r.headers.get('Location')).toBe('/arboretum/login');
    }
  });

  it('frames the tree for a person, naming the built-ins file this engine wrote and the export it reads', async () => {
    const user = await makeUser('lineage');
    const r = await asSession(user, 'GET', '/arboretum/lineage');
    expect(r.status).toBe(200);
    expect(r.text).toContain(`data-lineage="/arboretum/engine/${engine.lineage}"`);
    expect(r.text).toContain('data-export="/api/export"');
    expect(r.text).toContain('src="/arboretum/js/lineage.js"');
  });

  it('draws the parents arboretum holds from a real export', async () => {
    const user = await makeUser('lineage');
    const token = await makeToken(user);
    const look = builtins.looks[0].name;
    const first = await call('POST', '/api/presets', { token, json: { name: 'from a look', params: { tree_count: 3 }, parent: `look:${look}` } });
    const second = await call('POST', '/api/presets', { token, json: { name: 'from a preset', params: { tree_count: 4 }, parent: `preset:${first.json.id}@1` } });
    const exported = await call('GET', '/api/export', { token });
    const tree = lineage(builtins, exported.json);
    expect(parentOf(tree, `preset:${first.json.id}@1`)).toMatchObject({ from: `look:${look}`, kind: 'declared' });
    expect(parentOf(tree, `preset:${second.json.id}@1`)).toMatchObject({ from: `preset:${first.json.id}@1`, kind: 'declared' });
  });
});
