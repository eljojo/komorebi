import { describe, expect, it } from 'vitest';
import { ENGINE_COMMIT } from '../src/generated/engine';
import { PARAMS, call, get, makePlaylist, makePreset, makeToken, makeUser, storedParams } from './helpers';

describe('GET /api/export', () => {
  it('needs an actor, and a read token is enough', async () => {
    expect((await get('/api/export')).status).toBe(401);
    const u = await makeUser('export');
    expect((await get('/api/export', await makeToken(u, { scope: 'read' }))).status).toBe(200);
  });

  it('is everything you own: private and archived presets, every version, and playlists with their items', async () => {
    const u = await makeUser('export');
    const token = await makeToken(u);
    const a = await makePreset(u, token, { name: 'a v1' });
    await call('POST', `/api/presets/${a.id}/versions`, { token, json: { name: 'a v2' } });
    const b = await makePreset(u, token, { name: 'b', visibility: 'public', archived: true });
    const pl = await makePlaylist(token, { name: 'list', items: [{ preset_id: a.id, dwell_s: 12 }, { preset_id: b.id }] });

    const before = Date.now();
    const r = await get('/api/export', token);
    expect(r.status).toBe(200);
    expect(r.json.username).toBe(u.username);
    expect(r.json.engine_commit).toBe(ENGINE_COMMIT);
    expect(r.json.exported_at).toBeGreaterThanOrEqual(before - 1000);

    expect(r.json.presets.map((p: any) => p.id).sort()).toEqual([a.id, b.id].sort());
    const ea = r.json.presets.find((p: any) => p.id === a.id);
    expect(ea).toMatchObject({ visibility: 'private', share_token: a.share_token, archived_at: null });
    expect(ea.versions.map((v: any) => [v.n, v.name])).toEqual([[1, 'a v1'], [2, 'a v2']]);
    expect(ea.versions[0]).toMatchObject({ params: PARAMS, via: 'token:test laptop', tags: [], parent: null });
    const eb = r.json.presets.find((p: any) => p.id === b.id);
    expect(eb.archived_at).toEqual(expect.any(Number));

    expect(r.json.playlists).toHaveLength(1);
    expect(r.json.playlists[0]).toMatchObject({ id: pl.id, name: 'list', visibility: 'private', share_token: pl.share_token });
    expect(r.json.playlists[0].items).toEqual([
      { position: 0, preset_id: a.id, dwell_s: 12, crossfade_s: 5 },
      { position: 1, preset_id: b.id, dwell_s: 30, crossfade_s: 5 },
    ]);
  });

  it('holds nothing of anyone else\'s', async () => {
    const mine = await makeUser('export');
    const theirs = await makeUser('export');
    const theirToken = await makeToken(theirs);
    await makePreset(theirs, theirToken, { visibility: 'public' });
    await makePlaylist(theirToken, { visibility: 'public' });
    const r = await get('/api/export', await makeToken(mine));
    expect(r.json.presets).toEqual([]);
    expect(r.json.playlists).toEqual([]);
  });

  it('carries each version\'s params exactly as stored, byte for byte, beside the parsed object', async () => {
    const u = await makeUser('export');
    const token = await makeToken(u);
    const oddly = '{ "tree_count": 1.0,\n\t"exposure":   1e0 , "eclipse" : false }';
    const made = await call('POST', '/api/presets', { token, body: `{"name":"odd","params":${oddly}}` });
    expect(made.status, made.text).toBe(201);
    const second = await call('POST', `/api/presets/${made.json.id}/versions`, { token, body: '{"params":{"tree_count":  4}}' });
    expect(second.status, second.text).toBe(201);

    const versions = (await get('/api/export', token)).json.presets[0].versions;
    expect(versions[0].params_text).toBe(oddly);
    expect(versions[0].params_text).toBe(await storedParams(made.json.id, 1));
    expect(versions[1].params_text).toBe('{"tree_count":  4}');
    expect(versions[0].params).toEqual({ tree_count: 1, exposure: 1, eclipse: false });
  });
});
