import { describe, expect, it } from 'vitest';
import { PARAMS, asSession, call, makePlaylist, makePreset, makeToken, makeUser, racing, reply, request, sessionFor } from './helpers';

// Publishing is a person's act on arboretum itself (design §7.1.2). The editor's origin may create things, but
// only private ones, so a script running there can never publish a look or a playlist.
const EDITOR = { Origin: 'https://komorebi.eljojo.net' };

describe('editor writes stay private, including when publication races the write', () => {
  it.each(['public', 'unlisted'] as const)('refuses a new version and items on %s content', async (visibility) => {
    const user = await makeUser();
    const token = await makeToken(user);
    const preset = await makePreset(user, token, { visibility });
    const list = await makePlaylist(token, { visibility });
    const version = await asSession(user, 'POST', `/api/presets/${preset.id}/versions`, { headers: EDITOR, json: { params: { tree_count: 9 } } });
    const items = await asSession(user, 'PUT', `/api/playlists/${list.id}/items`, { headers: EDITOR, json: { revision: 0, items: [] } });
    expect(version.status).toBe(403);
    expect(items.status).toBe(403);
  });

  it.each(['preset', 'playlist'] as const)('refuses an editor %s write published after its read', async (kind) => {
    const user = await makeUser();
    const token = await makeToken(user);
    const preset = await makePreset(user, token);
    const list = await makePlaylist(token, { items: [{ preset_id: preset.id }] });
    const base = kind === 'preset' ? `/api/presets/${preset.id}` : `/api/playlists/${list.id}`;
    const fetcher = racing(kind === 'preset' ? /from "presets"/ : /from "playlists"/, async () => {
      expect((await asSession(user, 'PATCH', base, { json: { visibility: 'public' } })).status).toBe(200);
    });
    const r = await fetcher(request(kind === 'preset' ? 'POST' : 'PUT', `${base}/${kind === 'preset' ? 'versions' : 'items'}`, {
      headers: { ...EDITOR, Cookie: `__Host-session=${await sessionFor(user)}` },
      json: kind === 'preset' ? { params: { tree_count: 9 } } : { revision: 1, items: [] },
    })).then(reply);
    expect(r.status).toBe(403);
    const after = await asSession(user, 'GET', base);
    if (kind === 'preset') expect(after.json.version).toBe(1);
    else expect(after.json.items.map((i: any) => i.preset_id)).toEqual([preset.id]);
  });
});

describe.each([
  ['POST /api/presets', '/api/presets', { name: 'x', params: PARAMS }],
  ['POST /api/playlists', '/api/playlists', { name: 'x' }],
])('%s from the editor origin', (_name, path, base) => {
  it.each(['public', 'unlisted'])('refuses visibility %s with a 403 that says where publishing is done', async (visibility) => {
    const user = await makeUser();
    const r = await asSession(user, 'POST', path, { json: { ...base, visibility }, headers: EDITOR });
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/arboretum/);
  });

  it('succeeds with no visibility, or private, and makes it private', async () => {
    const user = await makeUser();
    for (const extra of [{}, { visibility: 'private' }]) {
      const r = await asSession(user, 'POST', path, { json: { ...base, ...extra }, headers: EDITOR });
      expect(r.status).toBe(201);
      expect(r.json.visibility).toBe('private');
    }
  });

  it('lets a session on arboretum itself, with no Origin, still publish', async () => {
    const user = await makeUser();
    const r = await asSession(user, 'POST', path, { json: { ...base, visibility: 'public' } });
    expect(r.status).toBe(201);
    expect(r.json.visibility).toBe('public');
  });

  it('keeps answering a bad visibility with a 400', async () => {
    const user = await makeUser();
    const r = await asSession(user, 'POST', path, { json: { ...base, visibility: 'secret' }, headers: EDITOR });
    expect(r.status).toBe(400);
  });

  it('leaves a token as it was: private only, whatever the Origin', async () => {
    const token = await makeToken(await makeUser());
    const r = await call('POST', path, { token, json: { ...base, visibility: 'public' }, headers: EDITOR });
    expect(r.status).toBe(403);
  });
});
