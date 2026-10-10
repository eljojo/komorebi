// Interleavings: a write lands between a handler's read and its commit. Each uses `racing` to run that write at
// that exact point, so the outcome does not depend on timing.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { credentials, playlistItems, playlists, presetVersions, sessions, users } from '../src/db/schema';
import { Authenticator } from './authenticator';
import { Browser, asSession, db, makePlaylist, makePreset, makeToken, makeUser, racing, reply, request, sessionFor } from './helpers';

const run = crypto.randomUUID().slice(0, 6);
let seq = 0;
const newName = () => `race-${run}-${++seq}`;

async function signUp(b: Browser) {
  const username = newName();
  const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
  const a = new Authenticator();
  const r = await b.call('POST', '/api/auth/register', { json: { credential: await a.create(options.json) } });
  expect(r.status, r.text).toBe(201);
  return { username, a };
}

async function addPasskey(b: Browser) {
  const options = await b.call('POST', '/api/auth/add-passkey-options');
  const a = new Authenticator();
  const r = await b.call('POST', '/api/auth/add-passkey', { json: { credential: await a.create(options.json) } });
  expect(r.status, r.text).toBe(201);
  return a;
}

const userIdOf = async (username: string) => (await db.select().from(users).where(eq(users.username, username)))[0].id;

describe('S3: removing a passkey while a login with it is being verified', () => {
  it('opens no session: the session insert needs its credential to still exist', async () => {
    const owner = new Browser();
    const { username, a: stolen } = await signUp(owner);
    await addPasskey(owner);
    const userId = await userIdOf(username);

    const thief = new Browser();
    const options = await thief.call('POST', '/api/auth/login-options');
    const credential = await stolen.get(options.json);
    // The login has read the credential; now the owner removes it (which also ends every session they have).
    thief.fetcher = racing(/from "credentials"/, async () => {
      expect((await owner.call('POST', `/api/auth/passkeys/${stolen.credentialId}/remove`)).status).toBe(200);
    });
    const r = await thief.call('POST', '/api/auth/login', { json: { credential } });

    expect(r.status, r.text).toBe(401);
    expect(thief.jar.has('__Host-session')).toBe(false);
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toEqual([]);
  });
});

describe('S3: removing a passkey while an enrollment is being verified', () => {
  it('adds no credential: the commit needs the session that authorised it to still exist', async () => {
    const b = new Browser();
    const { username } = await signUp(b);
    const second = await addPasskey(b);
    const userId = await userIdOf(username);

    const options = await b.call('POST', '/api/auth/add-passkey-options');
    const credential = await new Authenticator().create(options.json);
    // The enrollment has taken its challenge; now the person (or the owner on another device) removes a passkey.
    const remover = new Browser();
    remover.ip = b.ip;
    b.fetcher = racing(/delete from "challenges" where "challenges"\."id"/, async () => {
      const again = await remover.call('POST', '/api/auth/login-options');
      const login = await remover.call('POST', '/api/auth/login', { json: { credential: await second.get(again.json) } });
      expect(login.status).toBe(200);
      expect((await remover.call('POST', `/api/auth/passkeys/${second.credentialId}/remove`)).status).toBe(200);
    });
    const r = await b.call('POST', '/api/auth/add-passkey', { json: { credential } });

    expect(r.status, r.text).toBe(401);
    expect(await db.select({ id: credentials.id }).from(credentials).where(eq(credentials.userId, userId))).toHaveLength(1);
  });
});

// S2: a token may change only what is private, and that has to hold when the change is committed, not only when
// the row was first read. Here the owner publishes in between.
describe('S2: a token write that loses a race with the owner publishing', () => {
  const asToken = (when: RegExp, then: () => Promise<unknown>, method: string, path: string, token: string, json: unknown) =>
    racing(when, then)(request(method, path, { token, json })).then(reply);

  it('appends no version to a preset that became public after the read', async () => {
    const owner = await makeUser();
    const token = await makeToken(owner);
    const preset = await makePreset(owner, token);

    const r = await asToken(/from "presets"/, async () => {
      expect((await asSession(owner, 'PATCH', `/api/presets/${preset.id}`, { json: { visibility: 'public' } })).status).toBe(200);
    }, 'POST', `/api/presets/${preset.id}/versions`, token, { params: { tree_count: 99 } });

    expect(r.status, r.text).toBe(403);
    expect(await db.select().from(presetVersions).where(eq(presetVersions.presetId, preset.id))).toHaveLength(1);
    expect((await asSession(owner, 'GET', `/api/presets/${preset.id}`)).json.version).toBe(1);
  });

  it('still lets a session append to a preset published in between', async () => {
    const owner = await makeUser();
    const token = await makeToken(owner);
    const preset = await makePreset(owner, token);
    const r = await racing(/from "presets"/, async () => {
      await asSession(owner, 'PATCH', `/api/presets/${preset.id}`, { json: { visibility: 'public' } });
    })(request('POST', `/api/presets/${preset.id}/versions`, { json: { params: { tree_count: 4 } }, headers: { Cookie: `__Host-session=${await sessionFor(owner)}` } })).then(reply);
    expect(r.status, r.text).toBe(201);
  });

  it('changes no playlist name or description after the owner published it', async () => {
    const owner = await makeUser();
    const token = await makeToken(owner);
    const list = await makePlaylist(token, { name: 'before' });

    const r = await asToken(/from "playlists"/, async () => {
      expect((await asSession(owner, 'PATCH', `/api/playlists/${list.id}`, { json: { visibility: 'public' } })).status).toBe(200);
    }, 'PATCH', `/api/playlists/${list.id}`, token, { name: 'token after publication', description: 'x' });

    expect(r.status, r.text).toBe(403);
    const [row] = await db.select().from(playlists).where(eq(playlists.id, list.id));
    expect(row).toMatchObject({ name: 'before', description: null, visibility: 'public' });
  });

  it.each([
    ['replacing items', (presetId: number) => [{ preset_id: presetId }]],
    ['emptying the list', () => []],
  ])('keeps the old items when %s loses the race, the delete included', async (_what, items) => {
    const owner = await makeUser();
    const token = await makeToken(owner);
    const a = await makePreset(owner, token);
    const b = await makePreset(owner, token);
    const list = await makePlaylist(token, { items: [{ preset_id: a.id }, { preset_id: b.id }] });

    const r = await asToken(/from "playlists"/, async () => {
      expect((await asSession(owner, 'PATCH', `/api/playlists/${list.id}`, { json: { visibility: 'unlisted' } })).status).toBe(200);
    }, 'PUT', `/api/playlists/${list.id}/items`, token, { items: items(b.id) });

    expect(r.status, r.text).toBe(403);
    const rows = await db.select().from(playlistItems).where(eq(playlistItems.playlistId, list.id)).orderBy(playlistItems.position);
    expect(rows.map((i) => i.presetId)).toEqual([a.id, b.id]);
  });
});
