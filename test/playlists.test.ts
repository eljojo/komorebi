import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/config';
import { PARAMS, asSession, call, fillPlaylists, get, makePlaylist, makePreset, makeToken, makeUser } from './helpers';

async function owner(scope: 'read' | 'write' = 'write') {
  const user = await makeUser('owner');
  return { user, token: await makeToken(user, { scope }) };
}

const playlistCount = async (ownerId: number) =>
  (await env.DB.prepare('SELECT count(*) AS n FROM playlists WHERE owner_id = ?').bind(ownerId).first<{ n: number }>())!.n;

describe('playlist presentation', () => {
  it('round-trips a shipped presentation default and guards concurrent metadata and item writes', async () => {
    const o=await owner();
    const made=await call('POST','/api/playlists',{token:o.token,json:{name:'yard',presentation:'projector'}});
    expect(made.json.presentation).toBe('projector');
    const path=`/api/playlists/${made.json.id}`;
    const changed=await call('PATCH',path,{token:o.token,json:{presentation:'screen',revision:made.json.revision}});
    expect(changed.status).toBe(200);
    expect(changed.json.presentation).toBe('screen');
    expect(changed.json.revision).toBe(made.json.revision+1);
    expect((await call('PATCH',path,{token:o.token,json:{presentation:'projector',revision:made.json.revision}})).status).toBe(409);
    expect((await call('PUT',`${path}/items`,{token:o.token,json:{items:[],revision:made.json.revision}})).status).toBe(409);
    expect((await call('PATCH',path,{token:o.token,json:{presentation:'projector'}})).status).toBe(400);
    expect((await call('PATCH',path,{token:o.token,json:{presentation:'unknown',revision:changed.json.revision}})).status).toBe(422);
    expect((await call('PATCH',path,{token:o.token,json:{name:'still compatible'}})).status).toBe(200);
    const cleared=await call('PATCH',path,{token:o.token,json:{presentation:null,revision:changed.json.revision}});
    expect(cleared.json.presentation).toBeUndefined();
  });
});

describe('POST /api/playlists', () => {
  it('needs a token with write scope', async () => {
    const o = await owner();
    expect((await call('POST', '/api/playlists', { json: { name: 'x' } })).status).toBe(401);
    const read = await makeToken(o.user, { scope: 'read' });
    expect((await call('POST', '/api/playlists', { token: read, json: { name: 'x' } })).status).toBe(403);
  });

  it('creates a private, empty playlist with a share token of its own', async () => {
    const o = await owner();
    const r = await call('POST', '/api/playlists', { token: o.token, json: { name: 'slow afternoon', description: 'for the yard' } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      owner: o.user.username,
      name: 'slow afternoon',
      description: 'for the yard',
      visibility: 'private',
      items: [],
      unavailable: 0,
    });
    expect(r.json.share_token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect((await get(`/api/playlists/${r.json.id}`, o.token)).json).toEqual(r.json);
  });

  it.each(['public', 'unlisted'])('refuses a token asking for %s with 403, and creates nothing', async (visibility) => {
    const o = await owner();
    const r = await call('POST', '/api/playlists', { token: o.token, json: { name: 'x', visibility } });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/person in a browser/);
    expect(await playlistCount(o.user.id)).toBe(0);
  });

  it('lets a token ask for private, refuses a value that is not a visibility, and lets a session choose', async () => {
    const o = await owner();
    expect((await call('POST', '/api/playlists', { token: o.token, json: { name: 'x', visibility: 'private' } })).status).toBe(201);
    expect((await call('POST', '/api/playlists', { token: o.token, json: { name: 'x', visibility: 'secret' } })).status).toBe(400);
    const s = await asSession(o.user, 'POST', '/api/playlists', { json: { name: 'x', visibility: 'public' } });
    expect(s.json.visibility).toBe('public');
  });

  it('checks the name and description', async () => {
    const o = await owner();
    for (const json of [{}, { name: '' }, { name: 'x'.repeat(81) }, { name: 'x', description: 'd'.repeat(501) }, { name: 7 }]) {
      const r = await call('POST', '/api/playlists', { token: o.token, json });
      expect(r.status, JSON.stringify(json).slice(0, 40)).toBe(422);
      expect(r.json.errors).toBeInstanceOf(Array);
    }
  });

  it(`stops at ${LIMITS.playlists} playlists with a 429 naming the limit`, async () => {
    const o = await owner();
    await fillPlaylists(o.user.id, LIMITS.playlists);
    const r = await call('POST', '/api/playlists', { token: o.token, json: { name: 'x' } });
    expect(r.status).toBe(429);
    expect(r.json.error).toContain(`${LIMITS.playlists} playlists`);
    expect((await call('POST', '/api/playlists', { token: (await owner()).token, json: { name: 'x' } })).status).toBe(201);
  });

  it(`stops at ${LIMITS.playlists} playlists when a burst arrives at once`, async () => {
    const o = await owner();
    await fillPlaylists(o.user.id, LIMITS.playlists - 5);
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/api/playlists', { token: o.token, json: { name: `burst ${i}` } })));
    expect(replies.filter((r) => r.status === 201)).toHaveLength(5);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(7);
    expect(await playlistCount(o.user.id)).toBe(LIMITS.playlists);
  });
});

describe('PATCH /api/playlists/:id', () => {
  it('renames and redescribes with a write token, leaving what is not mentioned', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token, { name: 'before' });
    await call('PATCH', `/api/playlists/${p.id}`, { token: o.token, json: { description: 'now described' } });
    const r = await call('PATCH', `/api/playlists/${p.id}`, { token: o.token, json: { name: 'after' } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ name: 'after', description: 'now described', visibility: 'private' });
  });

  it('validates the merged result', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token);
    expect((await call('PATCH', `/api/playlists/${p.id}`, { token: o.token, json: { name: '' } })).status).toBe(422);
  });

  it('refuses any visibility from a token, even private, and changes nothing', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token, { name: 'before' });
    for (const visibility of ['public', 'unlisted', 'private']) {
      const r = await call('PATCH', `/api/playlists/${p.id}`, { token: o.token, json: { name: 'sneaky', visibility } });
      expect(r.status).toBe(403);
      expect(r.json.error).toMatch(/browser/);
    }
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.name).toBe('before');
  });

  it('lets a session change visibility, and the playlist then reads accordingly', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token);
    expect((await get(`/api/playlists/${p.id}`)).status).toBe(404);
    const r = await asSession(o.user, 'PATCH', `/api/playlists/${p.id}`, { json: { visibility: 'public' } });
    expect(r.status).toBe(200);
    expect((await get(`/api/playlists/${p.id}`)).status).toBe(200);
    expect((await asSession(o.user, 'PATCH', `/api/playlists/${p.id}`, { json: { visibility: 'secret' } })).status).toBe(400);
  });

  it('is for the owner with a write token', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token, { visibility: 'public' });
    const body = { name: 'mine' };
    expect((await call('PATCH', `/api/playlists/${p.id}`, { json: body })).status).toBe(401);
    expect((await call('PATCH', `/api/playlists/${p.id}`, { token: await makeToken(o.user, { scope: 'read' }), json: body })).status).toBe(403);
    expect((await call('PATCH', `/api/playlists/${p.id}`, { token: (await owner()).token, json: body })).status).toBe(403);
    const hidden = await makePlaylist(o.token);
    expect((await call('PATCH', `/api/playlists/${hidden.id}`, { token: (await owner()).token, json: body })).status).toBe(404);
    expect((await call('PATCH', '/api/playlists/999999999', { token: o.token, json: body })).status).toBe(404);
  });
});

describe('who may read a playlist: 404, never 403', () => {
  it.each([
    ['public', { anon: 200, other: 200, owner: 200, withK: 200, wrongK: 200 }],
    ['unlisted', { anon: 404, other: 404, owner: 200, withK: 200, wrongK: 404 }],
    ['private', { anon: 404, other: 404, owner: 200, withK: 404, wrongK: 404 }],
  ] as const)('%s', async (visibility, expected) => {
    const o = await owner();
    const p = await makePlaylist(o.token, { visibility });
    const path = `/api/playlists/${p.id}`;
    expect({
      anon: (await get(path)).status,
      other: (await get(path, (await owner('read')).token)).status,
      owner: (await get(path, o.token)).status,
      withK: (await get(`${path}?k=${p.share_token}`)).status,
      wrongK: (await get(`${path}?k=${p.share_token}x`)).status,
    }).toEqual(expected);
  });

  it('shows visibility, share_token and unavailable to the owner only', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token, { visibility: 'public' });
    const theirs = (await get(`/api/playlists/${p.id}`)).json;
    expect(theirs).not.toHaveProperty('visibility');
    expect(theirs).not.toHaveProperty('share_token');
    expect(theirs).not.toHaveProperty('unavailable');
    expect((await get(`/api/playlists/${p.id}`, o.token)).json).toMatchObject({ visibility: 'public', share_token: p.share_token, unavailable: 0 });
  });

  it('a hidden playlist and a missing one answer the same', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token);
    expect((await get(`/api/playlists/${p.id}`)).json).toEqual((await get('/api/playlists/999999999')).json);
    expect((await get('/api/playlists/abc')).status).toBe(404);
  });
});

describe('GET /api/playlists?owner=', () => {
  it('needs owner; me needs an actor', async () => {
    expect((await get('/api/playlists')).status).toBe(400);
    expect((await get('/api/playlists?owner=me')).status).toBe(401);
  });

  it('me lists all of yours, newest first, without items', async () => {
    const o = await owner();
    await makePlaylist(o.token, { name: 'first' });
    await makePlaylist(o.token, { name: 'second', visibility: 'public' });
    const r = await get('/api/playlists?owner=me', o.token);
    expect(r.json.playlists.map((p: any) => p.name)).toEqual(['second', 'first']);
    expect(r.json.playlists[0]).toMatchObject({ owner: o.user.username, visibility: 'public' });
    expect(r.json.playlists[0]).not.toHaveProperty('items');
  });

  it('a username lists only that user\'s public playlists, the same to everyone', async () => {
    const o = await owner();
    await makePlaylist(o.token, { name: 'out', visibility: 'public' });
    await makePlaylist(o.token, { name: 'link only', visibility: 'unlisted' });
    await makePlaylist(o.token, { name: 'mine' });
    for (const token of [undefined, o.token]) {
      const r = await get(`/api/playlists?owner=${o.user.username}`, token);
      expect(r.json.playlists.map((p: any) => p.name)).toEqual(['out']);
      expect(r.json.playlists[0]).not.toHaveProperty('share_token');
    }
    expect((await get('/api/playlists?owner=no-such-person-here')).status).toBe(404);
  });
});

describe('PUT /api/playlists/:id/items', () => {
  it('refuses a stale revision without dropping a newer item', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token);
    const b = await makePreset(o.user, o.token);
    const list = await makePlaylist(o.token);
    const initial = (await get(`/api/playlists/${list.id}`, o.token)).json;
    const revision = initial.revision ?? 0;
    const first = await call('PUT', `/api/playlists/${list.id}/items`, { token: o.token, json: { revision, items: [{ preset_id: a.id }] } });
    expect(first.status).toBe(200);
    const stale = await call('PUT', `/api/playlists/${list.id}/items`, { token: o.token, json: { revision, items: [{ preset_id: b.id }] } });
    expect(stale.status).toBe(409);
    expect((await get(`/api/playlists/${list.id}`, o.token)).json.items.map((i: any) => i.preset_id)).toEqual([a.id]);
  });

  it('accepts only one of two writes with the same revision, including an empty replacement', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token);
    const list = await makePlaylist(o.token);
    const writes = await Promise.all([[], [{ preset_id: a.id }]].map((items) => call('PUT', `/api/playlists/${list.id}/items`, { token: o.token, json: { revision: 0, items } })));
    expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get(`/api/playlists/${list.id}`, o.token)).json.revision).toBe(1);
  });

  it.each([undefined, -1, 0.5, '0', null])('requires a nonnegative integer revision: %s', async (revision) => {
    const o = await owner();
    const list = await makePlaylist(o.token);
    const r = await call('PUT', `/api/playlists/${list.id}/items`, { token: o.token, json: { revision, items: [] } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/revision/);
  });

  const put = async (token: string | undefined, id: number, json: unknown) => {
    const revision = (await get(`/api/playlists/${id}`, token)).json?.revision;
    return call('PUT', `/api/playlists/${id}/items`, { token, json: { ...(json as Record<string, unknown>), revision } });
  };

  it('replaces the whole ordered list, with the defaults 30 s and 5 s', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token, { name: 'a' });
    const b = await makePreset(o.user, o.token, { name: 'b' });
    const p = await makePlaylist(o.token);
    const r = await put(o.token, p.id, { items: [{ preset_id: b.id }, { preset_id: a.id, dwell_s: 60, crossfade_s: 0 }] });
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([
      { preset_id: b.id, version: 1, owner: o.user.username, name: 'b', dwell_s: 30, crossfade_s: 5, style: 'morph', params: PARAMS },
      { preset_id: a.id, version: 1, owner: o.user.username, name: 'a', dwell_s: 60, crossfade_s: 0, style: 'morph', params: PARAMS },
    ]);
    const swapped = await put(o.token, p.id, { items: [{ preset_id: a.id }] });
    expect(swapped.json.items.map((i: any) => i.preset_id)).toEqual([a.id]);
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.items).toHaveLength(1);
    expect((await put(o.token, p.id, { items: [] })).json.items).toEqual([]);
  });

  it('lets a preset appear more than once, and sit in any number of playlists', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token);
    const one = await makePlaylist(o.token);
    const two = await makePlaylist(o.token);
    expect((await put(o.token, one.id, { items: [{ preset_id: a.id }, { preset_id: a.id }] })).json.items).toHaveLength(2);
    expect((await put(o.token, two.id, { items: [{ preset_id: a.id }] })).status).toBe(200);
  });

  it('accepts 500 items and refuses 501', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token);
    const p = await makePlaylist(o.token);
    const item = { preset_id: a.id, dwell_s: 10 };
    const ok = await put(o.token, p.id, { items: Array(500).fill(item) });
    expect(ok.status).toBe(200);
    expect(ok.json.items).toHaveLength(500);
    const tooMany = await put(o.token, p.id, { items: Array(501).fill(item) });
    expect(tooMany.status).toBe(422);
    expect(tooMany.json.error).toMatch(/500/);
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.items).toHaveLength(500);
  });

  it('checks dwell_s (1 to 3600), crossfade_s (0 to 120) and the item shape', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token);
    const p = await makePlaylist(o.token);
    const bad: unknown[] = [
      { preset_id: a.id, dwell_s: 0.5 },
      { preset_id: a.id, dwell_s: 3601 },
      { preset_id: a.id, dwell_s: '30' },
      { preset_id: a.id, crossfade_s: -1 },
      { preset_id: a.id, crossfade_s: 121 },
      { preset_id: 'x' },
      { preset_id: 1.5 },
      { preset_id: 0 },
      {},
      7,
    ];
    for (const item of bad) expect((await put(o.token, p.id, { items: [item] })).status, JSON.stringify(item)).toBe(422);
    for (const item of [{ dwell_s: 1 }, { dwell_s: 3600 }, { crossfade_s: 0 }, { crossfade_s: 120 }]) {
      expect((await put(o.token, p.id, { items: [{ preset_id: a.id, ...item }] })).status, JSON.stringify(item)).toBe(200);
    }
    expect((await put(o.token, p.id, { items: 'nope' })).status).toBe(400);
    expect((await put(o.token, p.id, {})).status).toBe(400);
  });

  it('gives every item a style: morph unless it says fade, and only those two are taken', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token);
    const p = await makePlaylist(o.token);
    const r = await put(o.token, p.id, { items: [{ preset_id: a.id }, { preset_id: a.id, style: 'fade' }, { preset_id: a.id, style: 'morph' }] });
    expect(r.status, r.text).toBe(200);
    expect(r.json.items.map((i: any) => i.style)).toEqual(['morph', 'fade', 'morph']);
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.items.map((i: any) => i.style)).toEqual(['morph', 'fade', 'morph']);
    for (const style of ['dissolve', 'FADE', '', null, 3]) {
      const bad = await put(o.token, p.id, { items: [{ preset_id: a.id }, { preset_id: a.id, style }] });
      expect(bad.status, JSON.stringify(style)).toBe(422);
      expect(bad.json.error).toBe('item 2: style must be "morph" or "fade"');
    }
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.items.map((i: any) => i.style)).toEqual(['morph', 'fade', 'morph']);
  });

  it('takes your own presets and other people\'s public ones, and names the ones it cannot', async () => {
    const o = await owner();
    const other = await owner();
    const mine = await makePreset(o.user, o.token, { visibility: 'private' });
    const pub = await makePreset(other.user, other.token, { visibility: 'public' });
    const unlisted = await makePreset(other.user, other.token, { visibility: 'unlisted' });
    const priv = await makePreset(other.user, other.token);
    const gone = await makePreset(other.user, other.token, { visibility: 'public', archived: true });
    const p = await makePlaylist(o.token);

    expect((await put(o.token, p.id, { items: [{ preset_id: mine.id }, { preset_id: pub.id }] })).status).toBe(200);

    const r = await put(o.token, p.id, { items: [{ preset_id: pub.id }, { preset_id: unlisted.id }, { preset_id: priv.id }, { preset_id: gone.id }, { preset_id: 999999999 }] });
    expect(r.status).toBe(422);
    expect(r.json.preset_ids).toEqual([unlisted.id, priv.id, gone.id, 999999999]);
    // A refusal changes nothing.
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.items.map((i: any) => i.preset_id)).toEqual([mine.id, pub.id]);
  });

  it('is for the owner with a write token', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token, { visibility: 'public' });
    const p = await makePlaylist(o.token, { visibility: 'public' });
    const body = { items: [{ preset_id: a.id }] };
    expect((await put(undefined, p.id, body)).status).toBe(401);
    expect((await put(await makeToken(o.user, { scope: 'read' }), p.id, body)).status).toBe(403);
    expect((await put((await owner()).token, p.id, body)).status).toBe(403);
    const hidden = await makePlaylist(o.token);
    expect((await put((await owner()).token, hidden.id, body)).status).toBe(404);
    expect((await put(o.token, 999999999, body)).status).toBe(404);
  });
});

describe('the items a viewer gets', () => {
  it('always play the latest version of each preset', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token, { name: 'old name', visibility: 'public' });
    const p = await makePlaylist(o.token, { visibility: 'public', items: [{ preset_id: a.id }] });
    await asSession(o.user, 'POST', `/api/presets/${a.id}/versions`, { json: { name: 'new name', params: { tree_count: 9 } } });
    const item = (await get(`/api/playlists/${p.id}`)).json.items[0];
    expect(item).toMatchObject({ name: 'new name', params: { tree_count: 9 } });
  });

  it('carry the head version number and the username of the preset\'s owner', async () => {
    const o = await owner();
    const other = await owner();
    const mine = await makePreset(o.user, o.token, { name: 'mine', visibility: 'public' });
    const theirs = await makePreset(other.user, other.token, { name: 'theirs', visibility: 'public' });
    await asSession(other.user, 'POST', `/api/presets/${theirs.id}/versions`, { json: { name: 'theirs, again', params: { tree_count: 4 } } });
    const p = await makePlaylist(o.token, { visibility: 'public', items: [{ preset_id: mine.id }, { preset_id: theirs.id }] });
    for (const viewer of [o.token, undefined]) {
      const items = (await get(`/api/playlists/${p.id}`, viewer)).json.items;
      expect(items[0]).toMatchObject({ preset_id: mine.id, version: 1, owner: o.user.username });
      expect(items[1]).toMatchObject({ preset_id: theirs.id, version: 2, owner: other.user.username });
    }
  });

  it('leave out what this viewer cannot see, silently, and tell only the owner how many', async () => {
    const o = await owner();
    const other = await owner();
    const visible = await makePreset(other.user, other.token, { name: 'visible', visibility: 'public' });
    const turns = await makePreset(other.user, other.token, { name: 'goes private', visibility: 'public' });
    const mineUnlisted = await makePreset(o.user, o.token, { name: 'mine, unlisted', visibility: 'unlisted' });
    const p = await makePlaylist(o.token, {
      visibility: 'public',
      items: [{ preset_id: visible.id }, { preset_id: turns.id }, { preset_id: mineUnlisted.id }],
    });
    const names = (r: { json: any }) => r.json.items.filter((i: any) => !i.unavailable).map((i: any) => i.name);

    expect(names(await get(`/api/playlists/${p.id}`, o.token))).toEqual(['visible', 'goes private', 'mine, unlisted']);

    await env.DB.prepare("UPDATE presets SET visibility = 'private' WHERE id = ?").bind(turns.id).run();

    const mineView = await get(`/api/playlists/${p.id}`, o.token);
    expect(names(mineView)).toEqual(['visible', 'mine, unlisted']);
    expect(mineView.json.unavailable).toBe(1);

    const anon = await get(`/api/playlists/${p.id}`);
    expect(names(anon)).toEqual(['visible']);
    expect(anon.json).not.toHaveProperty('unavailable');

    // Its own author still sees it in the playlist.
    expect(names(await get(`/api/playlists/${p.id}`, other.token))).toEqual(['visible', 'goes private']);
  });

  it('skip an archived preset for everyone, its owner included, and count it for the playlist owner', async () => {
    const o = await owner();
    const other = await owner();
    const theirs = await makePreset(other.user, other.token, { name: 'theirs', visibility: 'public' });
    const mine = await makePreset(o.user, o.token, { name: 'mine' });
    const p = await makePlaylist(o.token, { visibility: 'public', items: [{ preset_id: theirs.id }, { preset_id: mine.id }] });
    await env.DB.prepare('UPDATE presets SET archived_at = 1 WHERE id IN (?, ?)').bind(theirs.id, mine.id).run();
    const r = await get(`/api/playlists/${p.id}`, o.token);
    expect(r.json.items.map((i: any) => [i.preset_id, i.unavailable])).toEqual([[theirs.id, true], [mine.id, true]]);
    expect(r.json.unavailable).toBe(2);
    expect((await get(`/api/playlists/${p.id}`, other.token)).json.items).toEqual([]);
  });

  it('are counted as unavailable only for what is gone from the owner\'s view, and the list stays for when it returns', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token, { name: 'a' });
    const p = await makePlaylist(o.token, { items: [{ preset_id: a.id }] });
    await env.DB.prepare('UPDATE presets SET archived_at = 1 WHERE id = ?').bind(a.id).run();
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.unavailable).toBe(1);
    await env.DB.prepare('UPDATE presets SET archived_at = NULL WHERE id = ?').bind(a.id).run();
    const back = await get(`/api/playlists/${p.id}`, o.token);
    expect(back.json.unavailable).toBe(0);
    expect(back.json.items).toHaveLength(1);
    expect(back.json.items[0]).toMatchObject({ name: 'a' });
  });

  it('archiving a preset through a session hides it from other people\'s reads and playlists, and the playlist owner is told', async () => {
    const o = await owner();
    const other = await owner();
    const theirs = await makePreset(other.user, other.token, { name: 'theirs', visibility: 'public' });
    const keep = await makePreset(other.user, other.token, { name: 'keep', visibility: 'public' });
    const p = await makePlaylist(o.token, { visibility: 'public', items: [{ preset_id: theirs.id }, { preset_id: keep.id }] });
    const names = (r: { json: any }) => r.json.items.filter((i: any) => !i.unavailable).map((i: any) => i.name);

    expect((await asSession(other.user, 'POST', `/api/presets/${theirs.id}/archive`, { json: {} })).status).toBe(200);

    expect((await get(`/api/presets/${theirs.id}`, o.token)).status).toBe(404);
    expect((await get(`/api/presets/${theirs.id}`)).status).toBe(404);
    const mine = await get(`/api/playlists/${p.id}`, o.token);
    expect(names(mine)).toEqual(['keep']);
    expect(mine.json.unavailable).toBe(1);
    expect(names(await get(`/api/playlists/${p.id}`))).toEqual(['keep']);

    expect((await asSession(other.user, 'POST', `/api/presets/${theirs.id}/unarchive`, { json: {} })).status).toBe(200);
    const back = await get(`/api/playlists/${p.id}`, o.token);
    expect(names(back)).toEqual(['theirs', 'keep']);
    expect(back.json.unavailable).toBe(0);
  });

  it('only a session may change a playlist\'s visibility; a token with write scope may not', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token);
    const viaToken = await call('PATCH', `/api/playlists/${p.id}`, { token: o.token, json: { visibility: 'public' } });
    expect(viaToken.status).toBe(403);
    const viaSession = await asSession(o.user, 'PATCH', `/api/playlists/${p.id}`, { json: { visibility: 'public' } });
    expect(viaSession.status).toBe(200);
    expect(viaSession.json.visibility).toBe('public');
  });

  it('a read token sees what its user sees', async () => {
    const o = await owner();
    const a = await makePreset(o.user, o.token, { name: 'private one' });
    const p = await makePlaylist(o.token, { items: [{ preset_id: a.id }] });
    const read = await makeToken(o.user, { scope: 'read' });
    expect((await get(`/api/playlists/${p.id}`, read)).json.items).toHaveLength(1);
  });
});

describe('a fresh share link each time a playlist goes unlisted', () => {
  const setVisibility = (user: { id: number }, id: number, visibility: string) =>
    asSession(user, 'PATCH', `/api/playlists/${id}`, { json: { visibility } });

  it.each(['private', 'public'] as const)('makes a new token when a %s playlist goes unlisted, and the old link stays dead', async (from) => {
    const o = await owner();
    const p = await makePlaylist(o.token, { visibility: from });
    const r = await setVisibility(o.user, p.id, 'unlisted');
    expect(r.status).toBe(200);
    expect(r.json.share_token).not.toBe(p.share_token);
    expect((await get(`/api/playlists/${p.id}?k=${r.json.share_token}`)).status).toBe(200);
    expect((await get(`/api/playlists/${p.id}?k=${p.share_token}`)).status).toBe(404);
  });

  it('does not bring back the link of an earlier unlisted period', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token);
    const first = (await setVisibility(o.user, p.id, 'unlisted')).json.share_token;
    await setVisibility(o.user, p.id, 'private');
    const second = (await setVisibility(o.user, p.id, 'unlisted')).json.share_token;
    expect(second).not.toBe(first);
    expect((await get(`/api/playlists/${p.id}?k=${first}`)).status).toBe(404);
  });

  it('keeps the token when it is set to unlisted while already unlisted, or leaves unlisted', async () => {
    const o = await owner();
    const p = await makePlaylist(o.token);
    const first = (await setVisibility(o.user, p.id, 'unlisted')).json.share_token;
    expect((await setVisibility(o.user, p.id, 'unlisted')).json.share_token).toBe(first);
    expect((await setVisibility(o.user, p.id, 'public')).json.share_token).toBe(first);
  });
});

describe('a token cannot change what is visible (spec §3.3)', () => {
  it.each(['public', 'unlisted'] as const)('is refused a rename, a new description and new items on a %s playlist, with 403', async (visibility) => {
    const o = await owner();
    const mine = await makePreset(o.user, o.token);
    const p = await makePlaylist(o.token, { name: 'before', visibility });
    for (const body of [{ name: 'sneaky' }, { description: 'sneaky' }]) {
      const r = await call('PATCH', `/api/playlists/${p.id}`, { token: o.token, json: body });
      expect(r.status).toBe(403);
      expect(r.json.error).toMatch(/browser/);
    }
    const put = await call('PUT', `/api/playlists/${p.id}/items`, { token: o.token, json: { revision: 0, items: [{ preset_id: mine.id }] } });
    expect(put.status).toBe(403);
    expect(put.json.error).toMatch(/browser/);
    const after = (await asSession(o.user, 'GET', `/api/playlists/${p.id}`)).json;
    expect(after).toMatchObject({ name: 'before', description: null, items: [] });
  });

  it('may change a private playlist', async () => {
    const o = await owner();
    const mine = await makePreset(o.user, o.token);
    const p = await makePlaylist(o.token);
    expect((await call('PATCH', `/api/playlists/${p.id}`, { token: o.token, json: { name: 'quiet' } })).status).toBe(200);
    expect((await call('PUT', `/api/playlists/${p.id}/items`, { token: o.token, json: { revision: 0, items: [{ preset_id: mine.id }] } })).status).toBe(200);
  });

  it.each(['public', 'unlisted'] as const)('lets a person in a browser change a %s playlist', async (visibility) => {
    const o = await owner();
    const mine = await makePreset(o.user, o.token);
    const p = await makePlaylist(o.token, { visibility });
    expect((await asSession(o.user, 'PATCH', `/api/playlists/${p.id}`, { json: { name: 'by hand' } })).status).toBe(200);
    expect((await asSession(o.user, 'PUT', `/api/playlists/${p.id}/items`, { json: { revision: 0, items: [{ preset_id: mine.id }] } })).status).toBe(200);
  });
});

describe('the owner’s view keeps what is unavailable, in its place (so saving does not drop it)', () => {
  // The playlist is public, and a token may not change a visible one: the owner saves it from a browser.
  const put = async (o: { user: { id: number } }, id: number, json: unknown) => {
    const revision = (await asSession(o.user, 'GET', `/api/playlists/${id}`)).json.revision;
    return asSession(o.user, 'PUT', `/api/playlists/${id}/items`, { json: { ...(json as Record<string, unknown>), revision } });
  };

  async function withHiddenMiddle() {
    const o = await owner();
    const other = await owner();
    const first = await makePreset(o.user, o.token, { name: 'first', visibility: 'public' });
    const theirs = await makePreset(other.user, other.token, { name: 'theirs', visibility: 'public' });
    const last = await makePreset(o.user, o.token, { name: 'last', visibility: 'public' });
    const p = await makePlaylist(o.token, {
      visibility: 'public',
      items: [{ preset_id: first.id, dwell_s: 10, crossfade_s: 1 }, { preset_id: theirs.id, dwell_s: 20, crossfade_s: 2 }, { preset_id: last.id, dwell_s: 40, crossfade_s: 3 }],
    });
    await asSession(other.user, 'PATCH', `/api/presets/${theirs.id}`, { json: { visibility: 'private' } });
    return { o, other, first, theirs, last, p };
  }

  it('returns an unavailable item where it sits, with no name and no params', async () => {
    const { o, first, theirs, last, p } = await withHiddenMiddle();
    const r = await get(`/api/playlists/${p.id}`, o.token);
    expect(r.json.items).toHaveLength(3);
    expect(r.json.items[0]).toMatchObject({ preset_id: first.id, name: 'first', dwell_s: 10, crossfade_s: 1 });
    expect(r.json.items[1]).toEqual({ preset_id: theirs.id, dwell_s: 20, crossfade_s: 2, style: 'morph', unavailable: true });
    expect(r.json.items[2]).toMatchObject({ preset_id: last.id, name: 'last' });
    expect(r.json.unavailable).toBe(1);
  });

  it('tells nobody else: other people get the playable items only', async () => {
    const { other, p, theirs } = await withHiddenMiddle();
    const stranger = await get(`/api/playlists/${p.id}`);
    expect(stranger.json.items.map((i: any) => i.name)).toEqual(['first', 'last']);
    expect(stranger.text).not.toContain('unavailable');
    // The hidden preset's own author is not the playlist's owner: they see their preset, and no count.
    const author = await get(`/api/playlists/${p.id}`, await makeToken(other.user));
    expect(author.json.items.map((i: any) => i.preset_id)).toContain(theirs.id);
    expect(author.json).not.toHaveProperty('unavailable');
  });

  it('is what the owner saves back: the list read is accepted by PUT and nothing is dropped', async () => {
    const { o, p, theirs } = await withHiddenMiddle();
    const read = (await get(`/api/playlists/${p.id}`, o.token)).json.items;
    const saved = await put(o, p.id, { items: read.map((i: any) => ({ preset_id: i.preset_id, dwell_s: i.dwell_s, crossfade_s: i.crossfade_s })) });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.json.items.map((i: any) => i.preset_id)).toEqual(read.map((i: any) => i.preset_id));
    expect(saved.json.items[1]).toEqual({ preset_id: theirs.id, dwell_s: 20, crossfade_s: 2, style: 'morph', unavailable: true });
    // It is still there when the preset comes back.
    await env.DB.prepare("UPDATE presets SET visibility = 'public' WHERE id = ?").bind(theirs.id).run();
    expect((await get(`/api/playlists/${p.id}`)).json.items.map((i: any) => i.name)).toEqual(['first', 'theirs', 'last']);
  });

  it('keeps the style of an unavailable item the client sends back, like its times', async () => {
    const { o, p, theirs } = await withHiddenMiddle();
    const read = (await get(`/api/playlists/${p.id}`, o.token)).json.items;
    const saved = await put(o, p.id, { items: read.map((i: any) => ({ preset_id: i.preset_id, dwell_s: i.dwell_s, crossfade_s: i.crossfade_s, style: i.preset_id === theirs.id ? 'fade' : i.style })) });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.json.items[1]).toEqual({ preset_id: theirs.id, dwell_s: 20, crossfade_s: 2, style: 'fade', unavailable: true });
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.items[1].style).toBe('fade');
  });

  it('accepts it moved to another place, with other times', async () => {
    const { o, p, first, theirs, last } = await withHiddenMiddle();
    const r = await put(o, p.id, { items: [{ preset_id: theirs.id, dwell_s: 99 }, { preset_id: last.id }, { preset_id: first.id }] });
    expect(r.status, r.text).toBe(200);
    expect(r.json.items[0]).toEqual({ preset_id: theirs.id, dwell_s: 99, crossfade_s: 5, style: 'morph', unavailable: true });
  });

  it('can be removed, and then it is gone: putting it back is refused like any invisible preset', async () => {
    const { o, p, first, theirs, last } = await withHiddenMiddle();
    expect((await put(o, p.id, { items: [{ preset_id: first.id }, { preset_id: last.id }] })).status).toBe(200);
    expect((await get(`/api/playlists/${p.id}`, o.token)).json.unavailable).toBe(0);
    const back = await put(o, p.id, { items: [{ preset_id: first.id }, { preset_id: theirs.id }] });
    expect(back.status).toBe(422);
    expect(back.json.preset_ids).toEqual([theirs.id]);
  });

  it('still requires new items to be visible when they are added', async () => {
    const { o, other, p, first, theirs } = await withHiddenMiddle();
    const hidden = await makePreset(other.user, other.token, { name: 'also hidden', visibility: 'private' });
    const r = await put(o, p.id, { items: [{ preset_id: first.id }, { preset_id: theirs.id }, { preset_id: hidden.id }] });
    expect(r.status).toBe(422);
    expect(r.json.preset_ids).toEqual([hidden.id]);
  });

  it('counts only this playlist’s own list: a preset hidden here but listed in another playlist is not allowed in', async () => {
    const { o, theirs } = await withHiddenMiddle();
    const elsewhere = await makePlaylist(o.token);
    const r = await put(o, elsewhere.id, { items: [{ preset_id: theirs.id }] });
    expect(r.status).toBe(422);
  });
});
