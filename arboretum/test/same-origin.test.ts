import { describe, expect, it } from 'vitest';
import { PARAMS, asSession, call, makePlaylist, makePreset, makeToken, makeUser } from './helpers';

// The editor and arboretum are one origin, so a request cannot be told apart by where it came from: a session
// is a person whichever page sent it. Only a token is kept to private content.
const FROM_EDITOR = { Origin: 'https://komorebi.eljojo.net', Referer: 'https://komorebi.eljojo.net/' };

describe.each([
  ['POST /api/presets', '/api/presets', { name: 'x', params: PARAMS }],
  ['POST /api/playlists', '/api/playlists', { name: 'x' }],
])('%s with the editor\'s Origin and Referer', (_name, path, base) => {
  it.each(['public', 'unlisted'])('lets a session publish %s content', async (visibility) => {
    const user = await makeUser();
    const r = await asSession(user, 'POST', path, { json: { ...base, visibility }, headers: FROM_EDITOR });
    expect(r.status).toBe(201);
    expect(r.json.visibility).toBe(visibility);
  });

  it('still keeps a token to private', async () => {
    const token = await makeToken(await makeUser());
    const r = await call('POST', path, { token, json: { ...base, visibility: 'public' }, headers: FROM_EDITOR });
    expect(r.status).toBe(403);
  });
});

describe('changing content that is already visible', () => {
  it.each(['public', 'unlisted'] as const)('lets a session add a version and set items on %s content, from the editor too', async (visibility) => {
    const user = await makeUser();
    const token = await makeToken(user);
    const preset = await makePreset(user, token, { visibility });
    const list = await makePlaylist(token, { visibility });
    const version = await asSession(user, 'POST', `/api/presets/${preset.id}/versions`, { headers: FROM_EDITOR, json: { params: { tree_count: 9 } } });
    const items = await asSession(user, 'PUT', `/api/playlists/${list.id}/items`, { headers: FROM_EDITOR, json: { revision: 0, items: [{ preset_id: preset.id }] } });
    expect(version.status).toBe(201);
    expect(items.status).toBe(200);
  });

  it.each(['public', 'unlisted'] as const)('lets a token add a version to %s content, and still refuses it the playlist', async (visibility) => {
    const user = await makeUser();
    const token = await makeToken(user);
    const preset = await makePreset(user, token, { visibility });
    const list = await makePlaylist(token, { visibility });
    const version = await call('POST', `/api/presets/${preset.id}/versions`, { token, json: { params: { tree_count: 9 } } });
    const items = await call('PUT', `/api/playlists/${list.id}/items`, { token, json: { revision: 0, items: [] } });
    expect(version.status).toBe(201);
    expect(items.status).toBe(403);
  });
});
