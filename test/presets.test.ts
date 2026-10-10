import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import looks from './fixtures/looks.json';
import { LIMITS } from '../src/config';
import { presetVersions, presets } from '../src/db/schema';
import { LEGACY_KEYS, LOOK_NAMES } from '../src/generated/engine';
import { DEFAULT_VALUES } from '../src/generated/builtins';
import { PARAMS, asSession, call, db, fillPresets, fillVersions, get, intercepting, makePreset, makeToken, makeUser, presetCount, request, storedParams } from './helpers';

async function owner(scope: 'read' | 'write' = 'write') {
  const user = await makeUser('owner');
  return { user, token: await makeToken(user, { scope }) };
}

describe('POST /api/presets', () => {
  it('needs a token with write scope', async () => {
    const { user } = await owner();
    const body = { name: 'x', params: PARAMS };
    expect((await call('POST', '/api/presets', { json: body })).status).toBe(401);
    const read = await makeToken(user, { scope: 'read' });
    const r = await call('POST', '/api/presets', { token: read, json: body });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/read-only/);
  });

  it('creates a private preset, version 1, and answers as GET does', async () => {
    const { user, token } = await owner();
    const r = await call('POST', '/api/presets', {
      token,
      json: { name: 'montebello, rain', description: 'wet', tags: ['projector'], params: PARAMS, komorebi_commit: '5ee46f1' },
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      owner: user.username,
      name: 'montebello, rain',
      description: 'wet',
      tags: ['projector'],
      version: 1,
      params: PARAMS,
      komorebi_commit: '5ee46f1',
      parent: null,
      via: 'token:test laptop',
      visibility: 'private',
      archived: false,
    });
    expect(r.json.share_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const again = await get(`/api/presets/${r.json.id}`, token);
    expect(again.json).toEqual(r.json);
  });

  it('gives every preset its own share token, even a private one', async () => {
    const { token } = await owner();
    const a = await makePreset({ id: 0 }, token);
    const b = await makePreset({ id: 0 }, token);
    expect(a.share_token).not.toBe(b.share_token);
  });

  it('records which token wrote the version', async () => {
    const { user } = await owner();
    const token = await makeToken(user, { label: 'studio laptop claude' });
    const r = await call('POST', '/api/presets', { token, json: { name: 'x', params: PARAMS } });
    expect(r.json.via).toBe('token:studio laptop claude');
  });

  describe('visibility', () => {
    it.each(['public', 'unlisted'])('refuses a token asking for %s with 403, and creates nothing', async (visibility) => {
      const { user, token } = await owner();
      const r = await call('POST', '/api/presets', { token, json: { name: 'x', params: PARAMS, visibility } });
      expect(r.status).toBe(403);
      expect(r.json.error).toMatch(/person in a browser/);
      expect(await presetCount(user.id)).toBe(0);
    });

    it('lets a token ask for private, which is what it gets anyway', async () => {
      const { token } = await owner();
      const r = await call('POST', '/api/presets', { token, json: { name: 'x', params: PARAMS, visibility: 'private' } });
      expect(r.status).toBe(201);
      expect(r.json.visibility).toBe('private');
    });

    it('refuses a value that is not a visibility', async () => {
      const { token } = await owner();
      const r = await call('POST', '/api/presets', { token, json: { name: 'x', params: PARAMS, visibility: 'secret' } });
      expect(r.status).toBe(400);
    });
  });

  describe('params are stored verbatim', () => {
    it('keeps the sender\'s exact text, which re-serialising would rewrite', async () => {
      const { token } = await owner();
      const raw = '{ "tree_count" : 3.0 ,\n  "eclipse":false,"tree_species" :  "oak" }';
      const r = await call('POST', '/api/presets', { token, body: `{"name":"x", "params": ${raw} }` });
      expect(r.status).toBe(201);
      expect(await storedParams(r.json.id, 1)).toBe(raw);
      expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);
      expect(r.json.params).toEqual({ tree_count: 3, eclipse: false, tree_species: 'oak' });
    });

    // A shipped look unchanged is refused (builtin looks, below), so each one is sent with one knob nudged.
    it.each(Object.entries(looks))('keeps the shipped look %s, one knob changed, as sent', async (_name, shipped) => {
      const { token } = await owner();
      const look = { ...shipped, cloud_thickness: shipped.cloud_thickness + 0.01 };
      const raw = JSON.stringify(look, null, 2);
      const r = await call('POST', '/api/presets', { token, body: `{"params":${raw},"name":"x"}` });
      expect(r.status, r.text).toBe(201);
      expect(await storedParams(r.json.id, 1)).toBe(raw);
      expect(r.json.params).toEqual(look);
    });
  });

  describe('built-in looks are not stored unchanged', () => {
    const shipped = looks['afternoon 7'] as Record<string, number | boolean | string>;
    const refused = (r: { status: number; json: any }, name: string) => {
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ reason: 'builtin', error: `this is komorebi's built-in look "${name}", unchanged; change something first` });
    };
    async function post(params: unknown, who?: { token: string }) {
      const { token } = who ?? (await owner());
      return call('POST', '/api/presets', { token, json: { name: 'mine', params } });
    }

    it.each(Object.keys(looks))('refuses %s as shipped, naming a look with the same params', async (name) => {
      const r = await post(looks[name as keyof typeof looks]);
      expect(r.status).toBe(422);
      expect(r.json.reason).toBe('builtin');
      const named = /built-in look "(.*)", unchanged/.exec(r.json.error)![1] as keyof typeof looks;
      expect(Object.keys(DEFAULT_VALUES).filter((k) => !k.startsWith('show_') && (looks[named] as any)[k] !== (looks[name as keyof typeof looks] as any)[k])).toEqual([]);
    });

    it('names the look itself', async () => {
      refused(await post(shipped), 'afternoon 7');
    });

    it('stores nothing when it refuses', async () => {
      const o = await owner();
      const before = await presetCount(o.user.id);
      await post(shipped, o);
      expect(await presetCount(o.user.id)).toBe(before);
    });

    it('accepts a built-in with one knob changed a little', async () => {
      expect((await post({ ...shipped, cloud_thickness: (shipped.cloud_thickness as number) + 0.01 })).status).toBe(201);
    });

    it('still refuses it with only a debug overlay flipped', async () => {
      refused(await post({ ...shipped, show_layer: true, show_layer_index: 2, show_source: false }), 'afternoon 7');
    });

    it('still refuses it with time_of_day and latitude added', async () => {
      refused(await post({ ...shipped, time_of_day: 6.5, latitude: 45.4 }), 'afternoon 7');
    });

    it('still refuses it sent partially, with the keys equal to their defaults left out', async () => {
      const partial = Object.fromEntries(Object.entries(shipped).filter(([k, v]) => DEFAULT_VALUES[k] !== v));
      expect(Object.keys(partial).length).toBeLessThan(Object.keys(shipped).length);
      refused(await post(partial), 'afternoon 7');
    });

    it('still refuses it under a legacy key spelling', async () => {
      const [old, current] = Object.entries(LEGACY_KEYS)[0];
      const { [current]: value, ...rest } = shipped;
      refused(await post({ ...rest, [old]: value }), 'afternoon 7');
    });

    it('refuses through a session and from the editor too', async () => {
      const user = await makeUser('person');
      refused(await asSession(user, 'POST', '/api/presets', { json: { name: 'mine', params: shipped } }), 'afternoon 7');
      const editor = await asSession(user, 'POST', '/api/presets', { headers: { Origin: 'https://komorebi.eljojo.net' }, json: { name: 'mine', params: shipped } });
      refused(editor, 'afternoon 7');
    });

    async function seededHead(params: unknown) {
      const o = await owner();
      const p = await makePreset(o.user, o.token, { name: 'fine' });
      const [{ id }] = await db.select({ id: presetVersions.id }).from(presetVersions).where(eq(presetVersions.presetId, p.id));
      await db.update(presetVersions).set({ params: JSON.stringify(params) }).where(eq(presetVersions.id, id));
      return { ...o, id: p.id };
    }

    it('lets a rename-only version of a preset whose head is fine through', async () => {
      const o = await owner();
      const p = await makePreset(o.user, o.token, { name: 'fine', params: { ...shipped, cloud_thickness: (shipped.cloud_thickness as number) + 0.01 } });
      const r = await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { name: 'renamed' } });
      expect(r.status).toBe(201);
    });

    it('refuses a version whose params turn it into a built-in, and appends nothing', async () => {
      const o = await owner();
      const p = await makePreset(o.user, o.token, { name: 'fine' });
      refused(await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { params: shipped } }), 'afternoon 7');
      expect((await get(`/api/presets/${p.id}/versions`, o.token)).json.versions).toHaveLength(1);
    });

    it('refuses a rename-only version whose carried-over head is a built-in', async () => {
      const o = await seededHead(shipped);
      refused(await call('POST', `/api/presets/${o.id}/versions`, { token: o.token, json: { name: 'renamed' } }), 'afternoon 7');
    });

    it('accepts a version that moves a built-in head off the built-in', async () => {
      const o = await seededHead(shipped);
      const r = await call('POST', `/api/presets/${o.id}/versions`, { token: o.token, json: { params: { ...shipped, cloud_thickness: (shipped.cloud_thickness as number) + 0.01 } } });
      expect(r.status).toBe(201);
    });
  });

  describe('refusals from the validators', () => {
    async function post(json: unknown) {
      const { token } = await owner();
      return call('POST', '/api/presets', { token, json });
    }

    it('names the unknown keys', async () => {
      const r = await post({ name: 'x', params: { ...PARAMS, not_a_knob: 1, also_not: 2 } });
      expect(r.status).toBe(422);
      expect(r.json.error).toMatch(/not_a_knob, also_not/);
      expect(r.json).toMatchObject({ reason: 'unknown_keys', keys: ['not_a_knob', 'also_not'] });
    });

    it('names the keys with a wrong type', async () => {
      const r = await post({ name: 'x', params: { tree_count: 'three' } });
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ reason: 'bad_values', keys: ['tree_count'] });
    });

    it('names the keys past what the editor can make, with the range they were held to', async () => {
      const r = await post({ name: 'x', params: { tree_count: 1, limb_count: 1, branch_levels: 20, branch_children: 6 } });
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ reason: 'out_of_range', keys: ['branch_levels'] });
      expect(r.json.error).toMatch(/branch_levels must be 1–4/);
    });

    // JSON.parse keeps only the last copy of a repeated key, but the stored text is the sender's own: an earlier
    // copy would be stored without ever being validated.
    it.each([
      ['a repeated known key', '{"tree_count":3,"tree_count":4}', ['tree_count']],
      ['a repeated key whose earlier copy has the wrong type', '{"tree_count":"junk","tree_count":3}', ['tree_count']],
      ['a repeated key spelled with an escape', '{"tree_count":3,"tree\\u005fcount":4}', ['tree_count']],
      ['a repeated unknown key', '{"tree_count":3,"nope":1,"nope":2}', ['nope']],
    ])('refuses %s with 422, naming the key', async (_what, params, keys) => {
      const { token, user } = await owner();
      const r = await call('POST', '/api/presets', { token, body: `{"name":"x","params":${params}}` });
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ reason: expect.stringMatching(/duplicate_keys|unknown_keys/), keys });
      expect(r.json.error).toContain(keys[0]);
      expect(await presetCount(user.id)).toBe(0);
    });

    it('says duplicate_keys when that is the only trouble', async () => {
      const { token } = await owner();
      const r = await call('POST', '/api/presets', { token, body: '{"name":"x","params":{"eclipse":true,"eclipse":false}}' });
      expect(r.json).toMatchObject({ reason: 'duplicate_keys', keys: ['eclipse'] });
    });

    it('refuses params that are not an object, or missing', async () => {
      expect((await post({ name: 'x', params: [] })).json.reason).toBe('not_object');
      expect((await post({ name: 'x' })).status).toBe(422);
    });

    it('refuses over 16 KB of params text, whitespace included', async () => {
      const { token } = await owner();
      const r = await call('POST', '/api/presets', { token, body: `{"name":"x","params":{"tree_count":1${' '.repeat(17000)}}}` });
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ reason: 'too_large' });
    });

    it('lists every metadata problem', async () => {
      const r = await post({ name: '', tags: ['loud'], params: PARAMS });
      expect(r.status).toBe(422);
      expect(r.json.errors).toHaveLength(2);
      expect(r.json.error).toMatch(/name/);
    });

    it('refuses a body that is not a JSON object', async () => {
      const { token } = await owner();
      expect((await call('POST', '/api/presets', { token, body: '{nope' })).status).toBe(400);
      expect((await call('POST', '/api/presets', { token, body: '[1]' })).status).toBe(400);
    });
  });

  describe('komorebi_commit', () => {
    it.each(['abc1234', '5ee46f11bcfea6f46dbef09971a8f04f39712cda'])('accepts %s', async (komorebi_commit) => {
      const r = await call('POST', '/api/presets', { token: (await owner()).token, json: { name: 'x', params: PARAMS, komorebi_commit } });
      expect(r.status).toBe(201);
    });

    it.each(['abc123', 'ABC1234', 'zzzzzzz', 'a'.repeat(41), 7])('refuses %s', async (komorebi_commit) => {
      const r = await call('POST', '/api/presets', { token: (await owner()).token, json: { name: 'x', params: PARAMS, komorebi_commit } });
      expect(r.status).toBe(422);
      expect(r.json.error).toMatch(/komorebi_commit/);
    });
  });

  describe('parent', () => {
    const create = (token: string, parent: unknown) => call('POST', '/api/presets', { token, json: { name: 'x', params: PARAMS, parent } });

    it('accepts a built-in look, including one with a space in its name', async () => {
      const { token } = await owner();
      const spaced = LOOK_NAMES.find((n) => n.includes(' '))!;
      const r = await create(token, `look:${spaced}`);
      expect(r.status).toBe(201);
      expect(r.json.parent).toBe(`look:${spaced}`);
    });

    it('refuses a look that is not built in, and anything else that is not a parent', async () => {
      const { token } = await owner();
      for (const parent of ['look:no such look', 'look:', 'preset:1', 'preset:1@', 'preset:x@1', 'preset:0@1', 'elsewhere', 7, 'look:' + 'x'.repeat(120)]) {
        const r = await create(token, parent);
        expect(r.status, String(parent)).toBe(422);
        expect(r.json.error).toMatch(/parent/);
      }
    });

    it('accepts a version of your own private preset', async () => {
      const { user, token } = await owner();
      const p = await makePreset(user, token);
      expect((await create(token, `preset:${p.id}@1`)).status).toBe(201);
    });

    it('accepts a version of someone else\'s public preset', async () => {
      const a = await owner();
      const p = await makePreset(a.user, a.token, { visibility: 'public' });
      expect((await create((await owner()).token, `preset:${p.id}@1`)).status).toBe(201);
    });

    it.each(['private', 'unlisted'] as const)('refuses a version of someone else\'s %s preset, as it would a missing one', async (visibility) => {
      const a = await owner();
      const p = await makePreset(a.user, a.token, { visibility });
      const b = await owner();
      const hidden = await create(b.token, `preset:${p.id}@1`);
      const missing = await create(b.token, `preset:999999999@1`);
      expect(hidden.status).toBe(422);
      expect(hidden.json).toEqual(missing.json);
    });

    it('refuses a version number the preset does not have', async () => {
      const { user, token } = await owner();
      const p = await makePreset(user, token);
      expect((await create(token, `preset:${p.id}@2`)).status).toBe(422);
    });

    it('refuses someone else\'s archived preset even if it is public', async () => {
      const a = await owner();
      const p = await makePreset(a.user, a.token, { visibility: 'public', archived: true });
      expect((await create((await owner()).token, `preset:${p.id}@1`)).status).toBe(422);
    });
  });

  describe('quotas', () => {
    it(`stops at ${LIMITS.presets} presets with a 429 naming the limit`, async () => {
      const { user, token } = await owner();
      await fillPresets(user.id, LIMITS.presets);
      const r = await call('POST', '/api/presets', { token, json: { name: 'x', params: PARAMS } });
      expect(r.status).toBe(429);
      expect(r.json.error).toContain(`${LIMITS.presets} presets`);
    });

    it(`stops at ${LIMITS.versionsPerDay} new versions in 24 hours, counting the first version of a preset`, async () => {
      const { user, token } = await owner();
      const first = await makePreset(user, token);
      await fillVersions(first.id, LIMITS.versionsPerDay - 2, Date.now() - 1000, 2);
      expect((await call('POST', '/api/presets', { token, json: { name: 'the 200th', params: PARAMS } })).status).toBe(201);
      const r = await call('POST', '/api/presets', { token, json: { name: 'the 201st', params: PARAMS } });
      expect(r.status).toBe(429);
      expect(r.json.error).toContain(`${LIMITS.versionsPerDay} new versions`);
      const v = await call('POST', `/api/presets/${first.id}/versions`, { token, json: { name: 'renamed' } });
      expect(v.status).toBe(429);
    });

    it(`stops at ${LIMITS.presets} presets when a burst arrives at once`, async () => {
      const { user, token } = await owner();
      await fillPresets(user.id, LIMITS.presets - 5);
      const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/api/presets', { token, json: { name: `burst ${i}`, params: PARAMS } })));
      expect(replies.filter((r) => r.status === 201)).toHaveLength(5);
      expect(replies.filter((r) => r.status === 429).every((r) => r.json.limit === 'presets')).toBe(true);
      expect(replies.filter((r) => r.status === 429)).toHaveLength(7);
      expect(await presetCount(user.id)).toBe(LIMITS.presets);
    });

    it(`stops at ${LIMITS.versionsPerDay} new versions when a burst of new versions arrives at once`, async () => {
      const { user, token } = await owner();
      const first = await makePreset(user, token);
      await fillVersions(first.id, LIMITS.versionsPerDay - 6, Date.now() - 1000, 2);
      const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', `/api/presets/${first.id}/versions`, { token, json: { name: `burst ${i}` } })));
      expect(replies.filter((r) => r.status === 201)).toHaveLength(5);
      expect(replies.filter((r) => r.status === 429)).toHaveLength(7);
      const versions = (await get(`/api/presets/${first.id}/versions`, token)).json.versions;
      expect(versions.at(-1).n).toBe(LIMITS.versionsPerDay - 6 + 1 + 5);
    });

    it('stops at the daily version limit when a burst of new presets arrives, and leaves no preset without a head', async () => {
      const { user, token } = await owner();
      const first = await makePreset(user, token);
      await fillVersions(first.id, LIMITS.versionsPerDay - 6, Date.now() - 1000, 2);
      const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/api/presets', { token, json: { name: `burst ${i}`, params: PARAMS } })));
      expect(replies.filter((r) => r.status === 201)).toHaveLength(5);
      expect(replies.filter((r) => r.status === 429)).toHaveLength(7);
      expect(await presetCount(user.id)).toBe(6);
      const headless = await env.DB.prepare('SELECT count(*) AS n FROM presets WHERE owner_id = ? AND head_version_id IS NULL').bind(user.id).first<{ n: number }>();
      expect(headless!.n).toBe(0);
    });

    it('rolls: versions older than 24 hours do not count', async () => {
      const { user, token } = await owner();
      const first = await makePreset(user, token);
      await fillVersions(first.id, LIMITS.versionsPerDay + 50, Date.now() - 25 * 3600 * 1000, 2);
      const r = await call('POST', `/api/presets/${first.id}/versions`, { token, json: { name: 'fine' } });
      expect(r.status).toBe(201);
    });

    it('counts per user', async () => {
      const a = await owner();
      await fillPresets(a.user.id, LIMITS.presets);
      expect((await call('POST', '/api/presets', { token: (await owner()).token, json: { name: 'x', params: PARAMS } })).status).toBe(201);
    });
  });
});

describe('who may read a preset: 404, never 403', () => {
  async function setup(visibility: 'public' | 'unlisted' | 'private', archived = false) {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility, archived });
    const other = await owner('read');
    return { o, p, other };
  }
  const readers = async (path: string, s: Awaited<ReturnType<typeof setup>>) => ({
    anon: (await get(path)).status,
    other: (await get(path, s.other.token)).status,
    owner: (await get(path, s.o.token)).status,
    withK: (await get(`${path}?k=${s.p.share_token}`)).status,
    wrongK: (await get(`${path}?k=${s.p.share_token}x`)).status,
  });
  const paths = (id: number) => [`/api/presets/${id}`, `/api/presets/${id}/versions`, `/api/presets/${id}/versions/1`];

  it('public: anyone', async () => {
    const s = await setup('public');
    for (const path of paths(s.p.id)) expect(await readers(path, s), path).toEqual({ anon: 200, other: 200, owner: 200, withK: 200, wrongK: 200 });
  });

  it('unlisted: the owner, or anyone with ?k=', async () => {
    const s = await setup('unlisted');
    for (const path of paths(s.p.id)) expect(await readers(path, s), path).toEqual({ anon: 404, other: 404, owner: 200, withK: 200, wrongK: 404 });
  });

  it('private: the owner only, and a share token does not open it', async () => {
    const s = await setup('private');
    for (const path of paths(s.p.id)) expect(await readers(path, s), path).toEqual({ anon: 404, other: 404, owner: 200, withK: 404, wrongK: 404 });
  });

  it.each(['public', 'unlisted', 'private'] as const)('archived %s: the owner only, whatever the visibility', async (visibility) => {
    const s = await setup(visibility, true);
    for (const path of paths(s.p.id)) expect(await readers(path, s), path).toEqual({ anon: 404, other: 404, owner: 200, withK: 404, wrongK: 404 });
  });

  it('a missing preset and a hidden one answer the same', async () => {
    const s = await setup('private');
    const hidden = await get(`/api/presets/${s.p.id}`);
    const missing = await get('/api/presets/999999999');
    expect(hidden.status).toBe(404);
    expect(hidden.json).toEqual(missing.json);
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999999999999'])('treats the id %s as not found', async (id) => {
    expect((await get(`/api/presets/${id}`)).status).toBe(404);
  });

  it('shows visibility, share_token and archived to the owner only', async () => {
    const s = await setup('public');
    const mine = (await get(`/api/presets/${s.p.id}`, s.o.token)).json;
    const theirs = (await get(`/api/presets/${s.p.id}`, s.other.token)).json;
    expect(mine).toMatchObject({ visibility: 'public', share_token: s.p.share_token, archived: false });
    expect(theirs).not.toHaveProperty('visibility');
    expect(theirs).not.toHaveProperty('share_token');
    expect(theirs).not.toHaveProperty('archived');
    expect(theirs).toMatchObject({ id: s.p.id, name: 'a look', params: PARAMS, version: 1 });
  });

  it('lets a read token read, since tokens act as their user', async () => {
    const s = await setup('private');
    const read = await makeToken(s.o.user, { scope: 'read' });
    expect((await get(`/api/presets/${s.p.id}`, read)).status).toBe(200);
  });
});

describe('GET /api/presets?owner=', () => {
  it('needs owner', async () => {
    expect((await get('/api/presets')).status).toBe(400);
  });

  it('owner=me needs an actor', async () => {
    expect((await get('/api/presets?owner=me')).status).toBe(401);
  });

  it('owner=me lists your non-archived presets, newest first, without params', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token, { name: 'first' });
    const b = await makePreset(o.user, o.token, { name: 'second', visibility: 'public' });
    await makePreset(o.user, o.token, { name: 'gone', archived: true });
    const r = await get('/api/presets?owner=me', o.token);
    expect(r.status).toBe(200);
    expect(r.json.presets.map((p: any) => p.name)).toEqual(['second', 'first']);
    expect(r.json.presets[0]).toMatchObject({ id: b.id, owner: o.user.username, version: 1, visibility: 'public', archived: false });
    expect(r.json.presets[1].id).toBe(a.id);
    expect(r.json.presets[0]).not.toHaveProperty('params');
  });

  it('owner=me&archived=1 lists the archived ones too', async () => {
    const o = await owner();
    await makePreset(o.user, o.token, { name: 'kept' });
    await makePreset(o.user, o.token, { name: 'gone', archived: true });
    const r = await get('/api/presets?owner=me&archived=1', o.token);
    expect(r.json.presets.map((p: any) => [p.name, p.archived])).toEqual([['gone', true], ['kept', false]]);
  });

  it('owner=<username> lists only that user\'s public, non-archived presets, to anyone', async () => {
    const o = await owner();
    await makePreset(o.user, o.token, { name: 'public one', visibility: 'public' });
    await makePreset(o.user, o.token, { name: 'unlisted', visibility: 'unlisted' });
    await makePreset(o.user, o.token, { name: 'private' });
    await makePreset(o.user, o.token, { name: 'archived', visibility: 'public', archived: true });
    for (const token of [undefined, o.token, (await owner('read')).token]) {
      const r = await get(`/api/presets?owner=${o.user.username}`, token);
      expect(r.status).toBe(200);
      expect(r.json.presets.map((p: any) => p.name)).toEqual(['public one']);
      expect(r.json.presets[0]).not.toHaveProperty('share_token');
      expect(r.json.presets[0]).not.toHaveProperty('visibility');
    }
    expect((await get(`/api/presets?owner=${o.user.username}&archived=1`)).json.presets).toHaveLength(1);
  });

  it('owner=<username> of nobody is 404', async () => {
    expect((await get('/api/presets?owner=no-such-person-here')).status).toBe(404);
  });
});

describe('POST /api/presets/:id/versions', () => {
  async function seeded() {
    const o = await owner();
    const raw = '{"tree_count" :  3.0,"eclipse":false}';
    const created = await call('POST', '/api/presets', {
      token: o.token,
      body: `{"name":"v1 name","description":"d1","tags":["projector"],"params":${raw},"komorebi_commit":"abc1234","parent":"look:${LOOK_NAMES[0]}"}`,
    });
    return { ...o, id: created.json.id as number, raw };
  }

  it('refuses a repeated key in a new version too, and appends nothing', async () => {
    const o = await seeded();
    const r = await call('POST', `/api/presets/${o.id}/versions`, { token: o.token, body: '{"params":{"eclipse":true,"eclipse":false}}' });
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ reason: 'duplicate_keys', keys: ['eclipse'] });
    expect((await get(`/api/presets/${o.id}/versions`, o.token)).json.versions).toHaveLength(1);
  });

  it('appends version n+1 and moves the head; a rename alone carries everything else over', async () => {
    const s = await seeded();
    const r = await call('POST', `/api/presets/${s.id}/versions`, { token: s.token, json: { name: 'renamed' } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      id: s.id,
      version: 2,
      name: 'renamed',
      description: 'd1',
      tags: ['projector'],
      params: { tree_count: 3, eclipse: false },
      komorebi_commit: 'abc1234',
      parent: `look:${LOOK_NAMES[0]}`,
    });
    expect(await storedParams(s.id, 2)).toBe(s.raw);
    expect((await get(`/api/presets/${s.id}`, s.token)).json).toEqual(r.json);
  });

  it('never updates in place: version 1 is as it was', async () => {
    const s = await seeded();
    await call('POST', `/api/presets/${s.id}/versions`, { token: s.token, json: { name: 'renamed', description: 'd2', tags: [], params: { tree_count: 9 } } });
    const v1 = await get(`/api/presets/${s.id}/versions/1`, s.token);
    expect(v1.json).toMatchObject({ n: 1, name: 'v1 name', description: 'd1', tags: ['projector'], params: { tree_count: 3, eclipse: false } });
    expect(await storedParams(s.id, 1)).toBe(s.raw);
    const v2 = await get(`/api/presets/${s.id}/versions/2`, s.token);
    expect(v2.json).toMatchObject({ n: 2, name: 'renamed', description: 'd2', tags: [], params: { tree_count: 9 } });
  });

  it('takes new params verbatim too, and validates them', async () => {
    const s = await seeded();
    const raw = '{ "tree_count": 4.50 }';
    const ok = await call('POST', `/api/presets/${s.id}/versions`, { token: s.token, body: `{"params":${raw}}` });
    expect(ok.status).toBe(201);
    expect(await storedParams(s.id, 2)).toBe(raw);
    const bad = await call('POST', `/api/presets/${s.id}/versions`, { token: s.token, json: { params: { nope: 1 } } });
    expect(bad.status).toBe(422);
    expect(bad.json.keys).toEqual(['nope']);
    expect((await get(`/api/presets/${s.id}/versions`, s.token)).json.versions).toHaveLength(2);
  });

  it('validates the merged metadata', async () => {
    const s = await seeded();
    const r = await call('POST', `/api/presets/${s.id}/versions`, { token: s.token, json: { tags: ['loud'] } });
    expect(r.status).toBe(422);
  });

  it('records each version\'s own way in', async () => {
    const s = await seeded();
    const other = await makeToken(s.user, { label: 'phone' });
    await call('POST', `/api/presets/${s.id}/versions`, { token: other, json: { name: 'from the phone' } });
    const list = (await get(`/api/presets/${s.id}/versions`, s.token)).json.versions;
    expect(list.map((v: any) => v.via)).toEqual(['token:test laptop', 'token:phone']);
  });

  it('moves updated_at', async () => {
    const s = await seeded();
    const before = (await get(`/api/presets/${s.id}`, s.token)).json.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const after = (await call('POST', `/api/presets/${s.id}/versions`, { token: s.token, json: { name: 'later' } })).json.updated_at;
    expect(after).toBeGreaterThan(before);
  });

  it('is for the owner with a write token', async () => {
    const s = await seeded();
    const body = { name: 'x' };
    expect((await call('POST', `/api/presets/${s.id}/versions`, { json: body })).status).toBe(401);
    const read = await makeToken(s.user, { scope: 'read' });
    expect((await call('POST', `/api/presets/${s.id}/versions`, { token: read, json: body })).status).toBe(403);
  });

  it('is 403 for someone who can see the preset but does not own it, and 404 for someone who cannot', async () => {
    const s = await seeded();
    await db.update(presets).set({ visibility: 'public' }).where(eq(presets.id, s.id));
    const stranger = (await owner()).token;
    expect((await call('POST', `/api/presets/${s.id}/versions`, { token: stranger, json: { name: 'mine now' } })).status).toBe(403);
    await db.update(presets).set({ visibility: 'private' }).where(eq(presets.id, s.id));
    expect((await call('POST', `/api/presets/${s.id}/versions`, { token: stranger, json: { name: 'mine now' } })).status).toBe(404);
    expect((await get(`/api/presets/${s.id}`, s.token)).json.name).toBe('v1 name');
  });

  it('refuses a visibility, which belongs to PATCH and is not part of a version', async () => {
    const s = await seeded();
    const r = await call('POST', `/api/presets/${s.id}/versions`, { token: s.token, json: { visibility: 'public' } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/PATCH/);
  });

  it('is 404 for a preset that does not exist', async () => {
    const o = await owner();
    expect((await call('POST', '/api/presets/999999999/versions', { token: o.token, json: { name: 'x' } })).status).toBe(404);
  });

  it('still works on your own archived preset', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { archived: true });
    expect((await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { name: 'x' } })).status).toBe(201);
  });
});

describe('preset summary queries', () => {
  it.each(['the owner list', 'the profile'])('reads no params for %s', async (what) => {
    const o = await owner();
    await makePreset(o.user, o.token);
    const seen: string[] = [];
    const path = what === 'the owner list' ? '/api/presets?owner=me' : `/arboretum/u/${o.user.username}`;
    const res = await intercepting((sql) => void seen.push(sql))(request('GET', path, { token: o.token }));
    expect(res.status).toBe(200);
    const reads = seen.filter((sql) => /join "preset_versions"/.test(sql));
    expect(reads.length).toBeGreaterThan(0);
    for (const sql of reads) expect(sql).not.toMatch(/"preset_versions"\."params"/);
  });
});

describe('GET /api/presets/:id/versions', () => {
  it('lists a summary per version in order, and returns one whole', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { name: 'one', description: 'd', komorebi_commit: 'abc1234' });
    await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { name: 'two' } });
    const list = await get(`/api/presets/${p.id}/versions`, o.token);
    expect(list.json.versions).toEqual([
      { n: 1, name: 'one', via: 'token:test laptop', created_at: expect.any(Number) },
      { n: 2, name: 'two', via: 'token:test laptop', created_at: expect.any(Number) },
    ]);
    const whole = await get(`/api/presets/${p.id}/versions/1`, o.token);
    expect(whole.json).toEqual({
      preset_id: p.id,
      n: 1,
      name: 'one',
      description: 'd',
      tags: [],
      params: PARAMS,
      komorebi_commit: 'abc1234',
      parent: null,
      via: 'token:test laptop',
      created_at: expect.any(Number),
    });
  });

  // A history is a list of names and dates; the params of every version are never needed to draw it.
  it.each([
    ['the API list', (id: number, token: string) => request('GET', `/api/presets/${id}/versions`, { token })],
    ['the history page', (id: number, token: string) => request('GET', `/arboretum/p/${id}/history`, { token })],
  ])('reads no params for %s', async (_what, req) => {
    const o = await owner();
    const p = await makePreset(o.user, o.token);
    await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { name: 'two' } });
    const seen: string[] = [];
    const res = await intercepting((sql) => void seen.push(sql))(req(p.id, o.token));
    expect(res.status).toBe(200);
    const versionReads = seen.filter((sql) => /from "preset_versions"/.test(sql));
    expect(versionReads.length).toBeGreaterThan(0);
    for (const sql of versionReads) expect(sql).not.toMatch(/"params"/);
  });

  it.each(['0', '3', 'x', '1.5'])('is 404 for version %s', async (n) => {
    const o = await owner();
    const p = await makePreset(o.user, o.token);
    expect((await get(`/api/presets/${p.id}/versions/${n}`, o.token)).status).toBe(404);
  });
});

describe('visibility and archiving are session-only', () => {
  it('PATCH /api/presets/:id, archive and unarchive are 403 for every token, even a write one on its own preset', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token);
    for (const [method, path, json] of [
      ['PATCH', `/api/presets/${p.id}`, { visibility: 'public' }],
      ['POST', `/api/presets/${p.id}/archive`, {}],
      ['POST', `/api/presets/${p.id}/unarchive`, {}],
    ] as const) {
      const r = await call(method, path, { token: o.token, json });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(r.json.error).toMatch(/browser/);
    }
    const after = (await get(`/api/presets/${p.id}`, o.token)).json;
    expect(after).toMatchObject({ visibility: 'private', archived: false });
  });

  it('are 401 without anyone, and 403 for a token whatever the id', async () => {
    const o = await owner();
    expect((await call('PATCH', '/api/presets/1', { json: { visibility: 'public' } })).status).toBe(401);
    expect((await call('POST', '/api/presets/999999999/archive', { token: o.token, json: {} })).status).toBe(403);
  });

  describe('as a person in a browser (a real session)', () => {
    it('PATCH sets visibility, and the preset then reads accordingly', async () => {
      const o = await owner();
      const p = await makePreset(o.user, o.token);
      expect((await get(`/api/presets/${p.id}`)).status).toBe(404);
      const r = await asSession(o.user, 'PATCH', `/api/presets/${p.id}`, { json: { visibility: 'public' } });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: p.id, visibility: 'public' });
      expect((await get(`/api/presets/${p.id}`)).status).toBe(200);
      expect(r.json.version).toBe(1);
    });

    it('PATCH refuses a visibility that is not one, or none', async () => {
      const o = await owner();
      const p = await makePreset(o.user, o.token);
      expect((await asSession(o.user, 'PATCH', `/api/presets/${p.id}`, { json: { visibility: 'secret' } })).status).toBe(400);
      expect((await asSession(o.user, 'PATCH', `/api/presets/${p.id}`, { json: {} })).status).toBe(400);
    });

    it('is the owner\'s alone: 404 for a stranger who cannot see it, 403 for one who can', async () => {
      const o = await owner();
      const stranger = await makeUser();
      const p = await makePreset(o.user, o.token);
      expect((await asSession(stranger, 'PATCH', `/api/presets/${p.id}`, { json: { visibility: 'public' } })).status).toBe(404);
      expect((await asSession(stranger, 'POST', `/api/presets/${p.id}/archive`, { json: {} })).status).toBe(404);
      await db.update(presets).set({ visibility: 'public' }).where(eq(presets.id, p.id));
      expect((await asSession(stranger, 'PATCH', `/api/presets/${p.id}`, { json: { visibility: 'private' } })).status).toBe(403);
      expect((await asSession(stranger, 'POST', `/api/presets/${p.id}/archive`, { json: {} })).status).toBe(403);
    });

    it('archive hides a public preset from everyone but its owner; unarchive brings it back', async () => {
      const o = await owner();
      const p = await makePreset(o.user, o.token, { visibility: 'public' });
      const archived = await asSession(o.user, 'POST', `/api/presets/${p.id}/archive`, { json: {} });
      expect(archived.status).toBe(200);
      expect(archived.json.archived).toBe(true);
      expect((await get(`/api/presets/${p.id}`)).status).toBe(404);
      expect((await get(`/api/presets/${p.id}`, o.token)).status).toBe(200);
      expect((await get(`/api/presets?owner=${o.user.username}`)).json.presets).toEqual([]);
      const back = await asSession(o.user, 'POST', `/api/presets/${p.id}/unarchive`, { json: {} });
      expect(back.json.archived).toBe(false);
      expect((await get(`/api/presets/${p.id}`)).status).toBe(200);
    });

    it('a session write records web from an arboretum page, and editor from anywhere else', async () => {
      const o = await owner();
      const web = await asSession(o.user, 'POST', '/api/presets', {
        json: { name: 'x', params: PARAMS },
        headers: { Referer: 'https://arboretum.test/arboretum/new' },
      });
      expect(web.json.via).toBe('web');
      const editor = await asSession(o.user, 'POST', `/api/presets/${web.json.id}/versions`, {
        json: { name: 'y' },
        headers: { Referer: 'https://arboretum.test/' },
      });
      expect(editor.json.via).toBe('editor');
    });

    it('a session may ask for a visibility on create', async () => {
      const o = await owner();
      const r = await asSession(o.user, 'POST', '/api/presets', { json: { name: 'x', params: PARAMS, visibility: 'unlisted' } });
      expect(r.status).toBe(201);
      expect(r.json.visibility).toBe('unlisted');
    });
  });
});

describe('a fresh share link each time it goes unlisted', () => {
  const setVisibility = (user: { id: number }, id: number, visibility: string) =>
    asSession(user, 'PATCH', `/api/presets/${id}`, { json: { visibility } });

  it.each(['private', 'public'])('makes a new token when a %s preset goes unlisted, and the old link stays dead', async (from) => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: from as 'private' | 'public' });
    const before = p.share_token;
    const r = await setVisibility(o.user, p.id, 'unlisted');
    expect(r.status).toBe(200);
    expect(r.json.share_token).not.toBe(before);
    expect(r.json.share_token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect((await get(`/api/presets/${p.id}?k=${r.json.share_token}`)).status).toBe(200);
    expect((await get(`/api/presets/${p.id}?k=${before}`)).status).toBe(404);
  });

  it('does not bring back the link of an earlier unlisted period', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token);
    const first = (await setVisibility(o.user, p.id, 'unlisted')).json.share_token;
    await setVisibility(o.user, p.id, 'private');
    const second = (await setVisibility(o.user, p.id, 'unlisted')).json.share_token;
    expect(second).not.toBe(first);
    expect((await get(`/api/presets/${p.id}?k=${first}`)).status).toBe(404);
    expect((await get(`/api/presets/${p.id}?k=${second}`)).status).toBe(200);
  });

  it('keeps the token when it is set to unlisted while already unlisted, since that is no transition', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token);
    const first = (await setVisibility(o.user, p.id, 'unlisted')).json.share_token;
    const again = await setVisibility(o.user, p.id, 'unlisted');
    expect(again.json.share_token).toBe(first);
  });

  it('keeps the token when it goes from unlisted to something else', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token);
    const first = (await setVisibility(o.user, p.id, 'unlisted')).json.share_token;
    expect((await setVisibility(o.user, p.id, 'public')).json.share_token).toBe(first);
  });
});

describe('a token cannot change what is visible (spec §3.3)', () => {
  it.each(['public', 'unlisted'] as const)('is refused a new version on a %s preset, with 403, and nothing is appended', async (visibility) => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility });
    const r = await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { name: 'sneaky' } });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/browser/);
    expect((await get(`/api/presets/${p.id}/versions`, o.token)).json.versions).toHaveLength(1);
  });

  it('may append versions to a private preset', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token);
    expect((await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { name: 'quiet' } })).status).toBe(201);
  });

  it.each(['public', 'unlisted'] as const)('lets a person in a browser append to a %s preset', async (visibility) => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility });
    expect((await asSession(o.user, 'POST', `/api/presets/${p.id}/versions`, { json: { name: 'by hand' } })).status).toBe(201);
  });
});
