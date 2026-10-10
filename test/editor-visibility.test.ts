import { describe, expect, it } from 'vitest';
import { PARAMS, asSession, call, makeToken, makeUser } from './helpers';

// Publishing is a person's act on arboretum itself (design §7.1.2). The editor's origin may create things, but
// only private ones, so a script running there can never publish a look or a playlist.
const EDITOR = { Origin: 'https://komorebi.eljojo.net' };

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
