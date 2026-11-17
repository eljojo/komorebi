import { env } from 'cloudflare:workers';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { credentialUsed } from '../src/api/auth';
import { LIMITS, RESERVED_USERNAMES, SESSION_MS } from '../src/config';
import { challenges, credentials, rateEvents, sessions, users } from '../src/db/schema';
import { ipKey } from '../src/ratelimit';
import { sha256Hex } from '../src/tokens';
import backfill from '../migrations/0004_backfill_webauthn_user_id.sql?raw';
import { Authenticator } from './authenticator';
import { Browser, call, db, makeToken, makeUser } from './helpers';

const run = crypto.randomUUID().slice(0, 6);
let seq = 0;
const newName = () => `p-${run}-${++seq}`;

async function signUp(b: Browser, username = newName(), a = new Authenticator()) {
  const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
  expect(options.status, options.text).toBe(200);
  const r = await b.call('POST', '/api/auth/register', { json: { credential: await a.create(options.json) } });
  expect(r.status, r.text).toBe(201);
  return { username, a };
}

async function signIn(b: Browser, a: Authenticator) {
  const options = await b.call('POST', '/api/auth/login-options');
  expect(options.status, options.text).toBe(200);
  return b.call('POST', '/api/auth/login', { json: { credential: await a.get(options.json) } });
}

const userNamed = async (username: string) => (await db.select().from(users).where(eq(users.username, username)))[0];

describe('register-options', () => {
  it('asks for a resident key, prefers user verification, and names the relying party', async () => {
    const b = new Browser();
    const r = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    expect(r.status).toBe(200);
    expect(r.json.rp.id).toBe('arboretum.test');
    expect(r.json.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'preferred' });
    expect(r.json.attestation).toBe('none');
    expect(r.json.challenge).toEqual(expect.any(String));
  });

  it('keeps the challenge on the server and gives the browser only its id, in a __Host-challenge cookie', async () => {
    const b = new Browser();
    const r = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    const header = r.headers.getSetCookie().find((c) => c.startsWith('__Host-challenge='))!;
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; Secure/i);
    expect(header).toMatch(/; Path=\//);
    expect(header).toMatch(/; SameSite=Lax/i);
    expect(header).not.toMatch(/Domain=/i);
    expect(header).toMatch(/Max-Age=300/);
    const id = b.jar.get('__Host-challenge')!;
    expect(id).not.toBe(r.json.challenge);
    const [row] = await db.select().from(challenges).where(eq(challenges.id, id));
    expect(row).toMatchObject({ challenge: r.json.challenge, purpose: 'register', userId: null });
    expect(row.expiresAt - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(row.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000);
  });

  it.each(['ab', 'a'.repeat(31), '1abc', '-abc', 'a_b', 'a b', 'ab.c', 'é-ab', ''])('refuses the username %j', async (username) => {
    const r = await new Browser().call('POST', '/api/auth/register-options', { json: { username } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/username/);
  });

  it('refuses a username that is not a string', async () => {
    expect((await new Browser().call('POST', '/api/auth/register-options', { json: { username: 7 } })).status).toBe(400);
    expect((await new Browser().call('POST', '/api/auth/register-options', { json: {} })).status).toBe(400);
  });

  it.each(RESERVED_USERNAMES.filter((n) => n.length >= 3))('refuses the reserved name %s, in any case', async (name) => {
    const r = await new Browser().call('POST', '/api/auth/register-options', { json: { username: name.toUpperCase() } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/reserved/);
  });

  it('reserves the names the brief lists', () => {
    expect([...RESERVED_USERNAMES].sort()).toEqual(
      ['komorebi', 'arboretum', 'admin', 'api', 'root', 'www', 'help', 'about', 'settings', 'new', 'login', 'logout', 'signup', 'u', 'p', 'l', 'engine', 'export'].sort(),
    );
  });

  it('refuses a taken username with a 409, whatever its case', async () => {
    const { username } = await signUp(new Browser());
    const r = await new Browser().call('POST', '/api/auth/register-options', { json: { username: username.toUpperCase() } });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/taken/);
  });
});

describe('register', () => {
  it('verifies the passkey, then makes the user, the credential and a session', async () => {
    const b = new Browser();
    const { username, a } = await signUp(b, 'Mixed-' + run + '-Case');
    const user = await userNamed(`mixed-${run}-case`);
    expect(user).toBeTruthy();
    expect(username).not.toBe(user.username);

    const [cred] = await db.select().from(credentials).where(eq(credentials.userId, user.id));
    expect(cred.id).toBe(a.credentialId);
    expect(cred.counter).toBe(0);
    expect(cred.lastUsedAt).toBeNull();

    const me = await b.call('GET', '/api/me');
    expect(me.json).toEqual({ username: user.username, kind: 'session' });
  });

  it('sets __Host-session: HttpOnly, Secure, Path=/, SameSite=Lax, no Domain, 30 days; stores only its hash', async () => {
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    const a = new Authenticator();
    const r = await b.call('POST', '/api/auth/register', { json: { credential: await a.create(options.json) } });
    const header = r.headers.getSetCookie().find((c) => c.startsWith('__Host-session='))!;
    expect(header).toMatch(/; HttpOnly/i);
    expect(header).toMatch(/; Secure/i);
    expect(header).toMatch(/; Path=\//);
    expect(header).toMatch(/; SameSite=Lax/i);
    expect(header).not.toMatch(/Domain=/i);
    expect(header).toContain(`Max-Age=${SESSION_MS / 1000}`);
    expect(SESSION_MS).toBe(30 * 24 * 3600 * 1000);

    const token = b.jar.get('__Host-session')!;
    const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
    expect(row).toBeTruthy();
    expect(row.expiresAt - row.createdAt).toBe(SESSION_MS);
    expect(JSON.stringify(row)).not.toContain(token);
    // The one-time challenge cookie is cleared.
    expect(b.jar.has('__Host-challenge')).toBe(false);
  });

  it('refuses a passkey signed over a different challenge, and creates nothing', async () => {
    const b = new Browser();
    const username = newName();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    const credential = await new Authenticator().create(options.json, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    const r = await b.call('POST', '/api/auth/register', { json: { credential } });
    expect(r.status).toBe(400);
    expect(await userNamed(username)).toBeUndefined();
    expect(b.jar.has('__Host-session')).toBe(false);
  });

  it('refuses a passkey made for another origin', async () => {
    const b = new Browser();
    const username = newName();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    const credential = await new Authenticator({ origin: 'https://evil.example' }).create(options.json);
    expect((await b.call('POST', '/api/auth/register', { json: { credential } })).status).toBe(400);
    expect(await userNamed(username)).toBeUndefined();
  });

  it('refuses a replayed challenge: it works once, even with the cookie put back', async () => {
    const b = new Browser();
    const username = newName();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    const challengeId = b.jar.get('__Host-challenge')!;
    const credential = await new Authenticator().create(options.json);
    expect((await b.call('POST', '/api/auth/register', { json: { credential } })).status).toBe(201);

    const attacker = new Browser();
    attacker.jar.set('__Host-challenge', challengeId);
    const again = await attacker.call('POST', '/api/auth/register', { json: { credential } });
    expect(again.status).toBe(400);
    expect(again.json.error).toMatch(/challenge/);
    expect(await db.select().from(challenges).where(eq(challenges.id, challengeId))).toEqual([]);
  });

  it('burns the challenge on a failed attempt too', async () => {
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    const challengeId = b.jar.get('__Host-challenge')!;
    const a = new Authenticator();
    await b.call('POST', '/api/auth/register', { json: { credential: await a.create(options.json, 'wrong') } });
    b.jar.set('__Host-challenge', challengeId);
    const retry = await b.call('POST', '/api/auth/register', { json: { credential: await a.create(options.json) } });
    expect(retry.status).toBe(400);
    expect(retry.json.error).toMatch(/challenge/);
  });

  it('refuses an expired challenge and removes it', async () => {
    const b = new Browser();
    const username = newName();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    const challengeId = b.jar.get('__Host-challenge')!;
    await db.update(challenges).set({ expiresAt: Date.now() - 1 }).where(eq(challenges.id, challengeId));
    const r = await b.call('POST', '/api/auth/register', { json: { credential: await new Authenticator().create(options.json) } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/challenge/);
    expect(await userNamed(username)).toBeUndefined();
    expect(await db.select().from(challenges).where(eq(challenges.id, challengeId))).toEqual([]);
  });

  it('refuses a request with no challenge cookie, or one that names nothing', async () => {
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    const credential = await new Authenticator().create(options.json);
    const bare = new Browser();
    expect((await bare.call('POST', '/api/auth/register', { json: { credential } })).status).toBe(400);
    bare.jar.set('__Host-challenge', 'nonsense');
    expect((await bare.call('POST', '/api/auth/register', { json: { credential } })).status).toBe(400);
  });

  it('refuses a challenge that was issued for something else', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    const r = await b.call('POST', '/api/auth/register', { json: { credential: await a.create({ challenge: options.json.challenge, user: { id: 'x' } }) } });
    expect(r.status).toBe(400);
  });

  it('refuses a body with no credential', async () => {
    const b = new Browser();
    await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    expect((await b.call('POST', '/api/auth/register', { json: {} })).status).toBe(400);
  });

  it('refuses a name taken between the options and the registration', async () => {
    const username = newName();
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    await signUp(new Browser(), username);
    const r = await b.call('POST', '/api/auth/register', { json: { credential: await new Authenticator().create(options.json) } });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/taken/);
  });

  it('refuses a passkey that is already registered', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    const r = await b.call('POST', '/api/auth/register', { json: { credential: await a.create(options.json) } });
    expect(r.status).toBe(409);
  });
});

describe('what a passkey stores is only what WebAuthn defines', () => {
  const idOfLength = (bytes: number) => isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(bytes)));
  const storedFor = async (username: string) => (await db.select().from(credentials).where(eq(credentials.userId, (await userNamed(username)).id)))[0];

  async function registerWith(response: Record<string, unknown>, a = new Authenticator()) {
    const b = new Browser();
    const username = newName();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    const credential = await a.create(options.json);
    Object.assign(credential.response, response);
    return { username, b, r: await b.call('POST', '/api/auth/register', { json: { credential } }) };
  }

  it('keeps the transports WebAuthn lists and drops anything else', async () => {
    const { username, r, b } = await registerWith({ transports: ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable', 'carrier-pigeon', '{"a":1}', 7, { big: 'json' }, null] });
    expect(r.status, r.text).toBe(201);
    expect((await storedFor(username)).transports).toEqual(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable']);
    expect((await b.call('GET', '/api/auth/passkeys')).json.passkeys[0].transports).toEqual(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable']);
  });

  it('stores no transports when what was sent is not a list', async () => {
    for (const transports of ['internal', { big: 'json' }, 7]) {
      const { username, r } = await registerWith({ transports });
      expect(r.status, r.text).toBe(201);
      expect((await storedFor(username)).transports).toBeNull();
    }
  });

  it('applies to an added passkey too', async () => {
    const b = new Browser();
    const { username } = await signUp(b);
    const options = await b.call('POST', '/api/auth/add-passkey-options');
    const credential = await new Authenticator().create(options.json);
    credential.response.transports = ['usb', 'junk'];
    expect((await b.call('POST', '/api/auth/add-passkey', { json: { credential } })).status).toBe(201);
    const rows = await db.select().from(credentials).where(eq(credentials.userId, (await userNamed(username)).id));
    expect(rows.map((c) => c.transports).sort()).toEqual([['internal'], ['usb']]);
  });

  it('accepts a credential id of 1023 bytes and refuses one of 1024', async () => {
    const long = new Authenticator();
    long.credentialId = idOfLength(1023);
    const ok = await registerWith({}, long);
    expect(ok.r.status, ok.r.text).toBe(201);

    const tooLong = new Authenticator();
    tooLong.credentialId = idOfLength(1024);
    const bad = await registerWith({}, tooLong);
    expect(bad.r.status).toBe(400);
    expect(bad.r.json.error).toMatch(/1023/);
    expect(await userNamed(bad.username)).toBeUndefined();
  });

  it('refuses an added passkey with an id over 1023 bytes too', async () => {
    const b = new Browser();
    await signUp(b);
    const options = await b.call('POST', '/api/auth/add-passkey-options');
    const tooLong = new Authenticator();
    tooLong.credentialId = idOfLength(1024);
    const r = await b.call('POST', '/api/auth/add-passkey', { json: { credential: await tooLong.create(options.json) } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/1023/);
  });
});

describe('login', () => {
  it('is usernameless: the options name no credential, and the passkey alone finds the account', async () => {
    const { username, a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    expect(options.json.allowCredentials ?? []).toEqual([]);
    expect(options.json.rpId).toBe('arboretum.test');
    expect(options.json.userVerification).toBe('preferred');
    const [row] = await db.select().from(challenges).where(eq(challenges.id, b.jar.get('__Host-challenge')!));
    expect(row).toMatchObject({ purpose: 'login', userId: null });

    const r = await b.call('POST', '/api/auth/login', { json: { credential: await a.get(options.json) } });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ username });
    expect((await b.call('GET', '/api/me')).json).toEqual({ username, kind: 'session' });
    expect(b.jar.has('__Host-challenge')).toBe(false);
  });

  it('updates the counter and last_used_at', async () => {
    const { username, a } = await signUp(new Browser());
    const before = Date.now();
    expect((await signIn(new Browser(), a)).status).toBe(200);
    expect((await signIn(new Browser(), a)).status).toBe(200);
    const [cred] = await db.select().from(credentials).where(eq(credentials.userId, (await userNamed(username)).id));
    expect(cred.counter).toBe(2);
    expect(cred.lastUsedAt).toBeGreaterThanOrEqual(before);
  });

  describe('the signature counter', () => {
    async function stored(counter: number) {
      const user = await makeUser();
      const id = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)));
      await db.insert(credentials).values({ id, userId: user.id, publicKey: 'k', counter, transports: null, createdAt: Date.now() });
      return id;
    }
    const counterOf = async (id: string) => (await db.select().from(credentials).where(eq(credentials.id, id)))[0];

    // Two logins verified against the same stored counter can finish in either order; the later write must not
    // undo the earlier one, or a replayed assertion would verify again.
    it('never goes backwards: a lower value arriving later is ignored', async () => {
      const id = await stored(5);
      await db.batch([credentialUsed(db, id, 7)]);
      await db.batch([credentialUsed(db, id, 6)]);
      expect((await counterOf(id)).counter).toBe(7);
    });

    it('moves forward', async () => {
      const id = await stored(5);
      await db.batch([credentialUsed(db, id, 6)]);
      expect((await counterOf(id)).counter).toBe(6);
      await db.batch([credentialUsed(db, id, 9)]);
      expect((await counterOf(id)).counter).toBe(9);
    });

    it('stays 0 for a passkey that always sends 0 (synced passkeys such as 1Password)', async () => {
      const id = await stored(0);
      await db.batch([credentialUsed(db, id, 0)]);
      expect((await counterOf(id)).counter).toBe(0);
    });

    it('still records the use when the counter does not move', async () => {
      const id = await stored(7);
      await db.batch([credentialUsed(db, id, 3)]);
      const row = await counterOf(id);
      expect(row.counter).toBe(7);
      expect(row.lastUsedAt).toBeGreaterThan(0);
    });
  });

  it('opens a session cookie with the same attributes as sign-up', async () => {
    const { a } = await signUp(new Browser());
    const r = await signIn(new Browser(), a);
    const header = r.headers.getSetCookie().find((c) => c.startsWith('__Host-session='))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).toContain(`Max-Age=${SESSION_MS / 1000}`);
  });

  it('refuses a passkey nobody registered', async () => {
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    const stranger = new Authenticator();
    await stranger.create({ challenge: 'x', user: { id: 'x' } });
    const r = await b.call('POST', '/api/auth/login', { json: { credential: await stranger.get(options.json) } });
    expect(r.status).toBe(401);
    expect(b.jar.has('__Host-session')).toBe(false);
  });

  it('refuses an assertion signed over a different challenge', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    const r = await b.call('POST', '/api/auth/login', { json: { credential: await a.get(options.json, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') } });
    expect(r.status).toBe(401);
    expect(b.jar.has('__Host-session')).toBe(false);
  });

  it('refuses a signature made by a different key', async () => {
    const { a } = await signUp(new Browser());
    const imposter = new Authenticator();
    await imposter.create({ challenge: 'x', user: { id: 'x' } });
    imposter.credentialId = a.credentialId;
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    const r = await b.call('POST', '/api/auth/login', { json: { credential: await imposter.get(options.json) } });
    expect(r.status).toBe(401);
  });

  it('refuses a replayed assertion: the challenge works once', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    const challengeId = b.jar.get('__Host-challenge')!;
    const credential = await a.get(options.json);
    expect((await b.call('POST', '/api/auth/login', { json: { credential } })).status).toBe(200);

    const attacker = new Browser();
    attacker.jar.set('__Host-challenge', challengeId);
    const again = await attacker.call('POST', '/api/auth/login', { json: { credential } });
    expect(again.status).toBe(400);
    expect(again.json.error).toMatch(/challenge/);
    expect(attacker.jar.has('__Host-session')).toBe(false);
  });

  it('refuses an expired challenge', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    await db.update(challenges).set({ expiresAt: Date.now() - 1 }).where(eq(challenges.id, b.jar.get('__Host-challenge')!));
    const r = await b.call('POST', '/api/auth/login', { json: { credential: await a.get(options.json) } });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/challenge/);
  });

  it('refuses a registration challenge used to log in', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    const r = await b.call('POST', '/api/auth/login', { json: { credential: await a.get(options.json) } });
    expect(r.status).toBe(400);
  });

  it('sweeps expired sessions when a new one is opened', async () => {
    const { username, a } = await signUp(new Browser());
    const user = await userNamed(username);
    await db.insert(sessions).values({ tokenHash: `stale-${run}-${seq}`, userId: user.id, createdAt: 0, expiresAt: 1 });
    await signIn(new Browser(), a);
    expect(await db.select().from(sessions).where(eq(sessions.tokenHash, `stale-${run}-${seq}`))).toEqual([]);
  });
});

describe('sessions', () => {
  it('stop working when they expire', async () => {
    const b = new Browser();
    const { username } = await signUp(b);
    expect((await b.call('GET', '/api/me')).status).toBe(200);
    await db.update(sessions).set({ expiresAt: Date.now() - 1 }).where(eq(sessions.userId, (await userNamed(username)).id));
    expect((await b.call('GET', '/api/me')).status).toBe(401);
  });

  it('are not recognised under a guessed value or without the __Host- prefix', async () => {
    const b = new Browser();
    await signUp(b);
    const token = b.jar.get('__Host-session')!;
    expect((await call('GET', '/api/me', { headers: { Cookie: `__Host-session=${token}x` } })).status).toBe(401);
    expect((await call('GET', '/api/me', { headers: { Cookie: `session=${token}` } })).status).toBe(401);
    expect((await call('GET', '/api/me', { headers: { Cookie: `__Host-session=${token}` } })).status).toBe(200);
  });

  it('give way to a bearer token when both are sent', async () => {
    const b = new Browser();
    await signUp(b);
    const other = await makeUser();
    const token = await makeToken(other);
    const r = await b.call('GET', '/api/me', { token });
    expect(r.json).toEqual({ username: other.username, kind: 'token' });
  });

  it('are ignored when a bearer token is sent that does not work', async () => {
    const b = new Browser();
    await signUp(b);
    expect((await b.call('GET', '/api/me', { token: 'arb_nonsense' })).status).toBe(401);
  });

  it('end at logout: the row is deleted, the cookie cleared, the old cookie dead', async () => {
    const b = new Browser();
    const { username } = await signUp(b);
    const token = b.jar.get('__Host-session')!;
    const r = await b.call('POST', '/api/auth/logout');
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie().find((c) => c.startsWith('__Host-session='))).toMatch(/Max-Age=0/);
    expect(b.jar.has('__Host-session')).toBe(false);
    expect(await db.select().from(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)))).toEqual([]);
    expect((await call('GET', '/api/me', { headers: { Cookie: `__Host-session=${token}` } })).status).toBe(401);
    expect((await userNamed(username)).id).toBeGreaterThan(0);
  });

  it('only that session ends at logout; the same person on another device stays in', async () => {
    const { a } = await signUp(new Browser());
    const one = new Browser();
    const two = new Browser();
    await signIn(one, a);
    await signIn(two, a);
    await one.call('POST', '/api/auth/logout');
    expect((await two.call('GET', '/api/me')).status).toBe(200);
  });

  it('logout needs a session', async () => {
    expect((await call('POST', '/api/auth/logout')).status).toBe(401);
    expect((await call('POST', '/api/auth/logout', { token: await makeToken(await makeUser()) })).status).toBe(403);
  });
});

describe('passkeys', () => {
  it('are listed for the signed-in user, without key material', async () => {
    const b = new Browser();
    const { a } = await signUp(b);
    const r = await b.call('GET', '/api/auth/passkeys');
    expect(r.status).toBe(200);
    expect(r.json.passkeys).toEqual([{ id: a.credentialId, transports: ['internal'], created_at: expect.any(Number), last_used_at: null }]);
    expect(r.text).not.toMatch(/public/i);
  });

  it('can be added: another passkey on the same account, which then signs in on its own', async () => {
    const b = new Browser();
    const { username } = await signUp(b);
    const options = await b.call('POST', '/api/auth/add-passkey-options');
    expect(options.status, options.text).toBe(200);
    expect(options.json.excludeCredentials).toHaveLength(1);
    expect(options.json.authenticatorSelection).toMatchObject({ residentKey: 'required' });
    expect(options.json.user.name).toBe(username);
    const second = new Authenticator();
    const added = await b.call('POST', '/api/auth/add-passkey', { json: { credential: await second.create(options.json) } });
    expect(added.status, added.text).toBe(201);
    expect(added.json).toEqual({ id: second.credentialId });
    expect((await b.call('GET', '/api/auth/passkeys')).json.passkeys).toHaveLength(2);

    const elsewhere = new Browser();
    expect((await signIn(elsewhere, second)).json).toEqual({ username });
  });

  it('cannot be added with a challenge made for someone else', async () => {
    const mine = new Browser();
    await signUp(mine);
    const theirs = new Browser();
    await signUp(theirs);
    const options = await theirs.call('POST', '/api/auth/add-passkey-options');
    const credential = await new Authenticator().create(options.json);
    mine.jar.set('__Host-challenge', theirs.jar.get('__Host-challenge')!);
    const r = await mine.call('POST', '/api/auth/add-passkey', { json: { credential } });
    expect(r.status).toBe(400);
  });

  it('refuse a challenge that is replayed or expired', async () => {
    const b = new Browser();
    await signUp(b);
    const options = await b.call('POST', '/api/auth/add-passkey-options');
    const challengeId = b.jar.get('__Host-challenge')!;
    const credential = await new Authenticator().create(options.json);
    await db.update(challenges).set({ expiresAt: Date.now() - 1 }).where(eq(challenges.id, challengeId));
    expect((await b.call('POST', '/api/auth/add-passkey', { json: { credential } })).status).toBe(400);
    b.jar.set('__Host-challenge', challengeId);
    expect((await b.call('POST', '/api/auth/add-passkey', { json: { credential } })).status).toBe(400);
  });

  it('can be removed, but never the last one (409)', async () => {
    const b = new Browser();
    const { a: first } = await signUp(b);
    const options = await b.call('POST', '/api/auth/add-passkey-options');
    const second = new Authenticator();
    await b.call('POST', '/api/auth/add-passkey', { json: { credential: await second.create(options.json) } });

    const gone = await b.call('POST', `/api/auth/passkeys/${first.credentialId}/remove`);
    expect(gone.status).toBe(200);
    // Removing signs this session out too, so the rest goes through a fresh login.
    expect((await b.call('GET', '/api/auth/passkeys')).status).toBe(401);
    expect((await signIn(b, second)).status).toBe(200);
    expect((await b.call('GET', '/api/auth/passkeys')).json.passkeys.map((p: any) => p.id)).toEqual([second.credentialId]);

    const last = await b.call('POST', `/api/auth/passkeys/${second.credentialId}/remove`);
    expect(last.status).toBe(409);
    expect(last.json.error).toMatch(/last/);
    expect((await b.call('GET', '/api/auth/passkeys')).json.passkeys).toHaveLength(1);
  });

  it('signs the user out everywhere when one is removed, the current session included, and nobody else', async () => {
    const b = new Browser();
    const { username, a: first } = await signUp(b);
    const options = await b.call('POST', '/api/auth/add-passkey-options');
    const second = new Authenticator();
    await b.call('POST', '/api/auth/add-passkey', { json: { credential: await second.create(options.json) } });
    const elsewhere = new Browser();
    expect((await signIn(elsewhere, second)).status).toBe(200);
    const bystander = new Browser();
    await signUp(bystander);
    const user = await userNamed(username);
    expect((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length).toBe(2);

    expect((await b.call('POST', `/api/auth/passkeys/${first.credentialId}/remove`)).status).toBe(200);

    expect((await db.select().from(sessions).where(eq(sessions.userId, user.id)))).toEqual([]);
    expect((await b.call('GET', '/api/me')).status).toBe(401);
    expect((await elsewhere.call('GET', '/api/me')).status).toBe(401);
    expect((await bystander.call('GET', '/api/me')).status).toBe(200);
    expect((await signIn(new Browser(), second)).status).toBe(200);
  });

  it('keeps every session when the removal is refused', async () => {
    const b = new Browser();
    const { a } = await signUp(b);
    const elsewhere = new Browser();
    expect((await signIn(elsewhere, a)).status).toBe(200);
    expect((await b.call('POST', `/api/auth/passkeys/${a.credentialId}/remove`)).status).toBe(409);
    expect((await b.call('GET', '/api/me')).status).toBe(200);
    expect((await elsewhere.call('GET', '/api/me')).status).toBe(200);
  });

  it("cannot remove someone else's, and an unknown id is a 404", async () => {
    const mine = new Browser();
    await signUp(mine);
    const options = await mine.call('POST', '/api/auth/add-passkey-options');
    await mine.call('POST', '/api/auth/add-passkey', { json: { credential: await new Authenticator().create(options.json) } });
    const theirs = new Browser();
    const { a } = await signUp(theirs);
    expect((await mine.call('POST', `/api/auth/passkeys/${a.credentialId}/remove`)).status).toBe(404);
    expect((await mine.call('POST', '/api/auth/passkeys/nope/remove')).status).toBe(404);
    expect((await theirs.call('GET', '/api/auth/passkeys')).json.passkeys).toHaveLength(1);
  });

  it.each([
    ['GET', '/api/auth/passkeys'],
    ['POST', '/api/auth/passkeys/x/remove'],
    ['POST', '/api/auth/add-passkey-options'],
    ['POST', '/api/auth/add-passkey'],
  ])('%s %s needs a session: 401 anonymous, 403 for a token', async (method, path) => {
    expect((await call(method, path)).status).toBe(401);
    expect((await call(method, path, { token: await makeToken(await makeUser()) })).status).toBe(403);
  });
});

describe('per-IP limits', () => {
  it(`allow ${LIMITS.signupsPerHour} sign-ups an hour, then 429; another address is unaffected`, async () => {
    const b = new Browser();
    for (let i = 0; i < LIMITS.signupsPerHour; i++) await signUp(b);
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    expect(options.status).toBe(429);
    expect(options.json).toMatchObject({ limit: 'signups' });
    await signUp(new Browser());
  });

  describe('by IPv6 /64', () => {
    // A person or a bot typically holds a whole /64, so rotating the lower 64 bits must not buy more sign-ups.
    const inside = (tail: string) => `2001:db8:1:2:${tail}`;

    it(`allow ${LIMITS.signupsPerHour} sign-ups an hour from one /64, however its addresses are spelled`, async () => {
      const spellings = [inside('1::1'), inside('aaaa:bbbb:cccc:dddd'), '2001:DB8:1:2::7', '2001:db8:1:2:0:0:0:9', inside('ffff:ffff:ffff:ffff')];
      expect(spellings).toHaveLength(LIMITS.signupsPerHour);
      for (const ip of spellings) {
        const b = new Browser();
        b.ip = ip;
        await signUp(b);
      }
      const blocked = new Browser();
      blocked.ip = inside('1234::5678');
      const options = await blocked.call('POST', '/api/auth/register-options', { json: { username: newName() } });
      expect(options.status).toBe(429);
      expect(options.json).toMatchObject({ limit: 'signups' });
    });

    it('leave the neighbouring /64 and IPv4 alone', async () => {
      const b = new Browser();
      b.ip = '2001:db8:5:5:1::1';
      for (let i = 0; i < LIMITS.signupsPerHour; i++) await signUp(b);
      const next = new Browser();
      next.ip = '2001:db8:5:6::1';
      await signUp(next);
      await signUp(new Browser());
    });

    it('count failed logins by /64 too', async () => {
      const stranger = new Authenticator();
      await stranger.create({ challenge: 'x', user: { id: 'x' } });
      const prefix = '2001:db8:9:9';
      for (let i = 0; i < LIMITS.failedLoginsPerHour; i++) {
        const b = new Browser();
        b.ip = `${prefix}:${i + 1}::1`;
        const options = await b.call('POST', '/api/auth/login-options');
        expect(options.status).toBe(200);
        expect((await b.call('POST', '/api/auth/login', { json: { credential: await stranger.get(options.json) } })).status).toBe(401);
      }
      const b = new Browser();
      b.ip = `${prefix}:ffff::2`;
      expect((await b.call('POST', '/api/auth/login-options')).status).toBe(429);
    });
  });

  it('stop a registration that was started before the limit was reached', async () => {
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
    const credential = await new Authenticator().create(options.json);
    await db.insert(rateEvents).values(Array.from({ length: LIMITS.signupsPerHour }, () => ({ ip: b.ip, action: 'signup', at: Date.now() })));
    expect((await b.call('POST', '/api/auth/register', { json: { credential } })).status).toBe(429);
  });

  it('count only successful sign-ups', async () => {
    const b = new Browser();
    for (let i = 0; i < LIMITS.signupsPerHour + 2; i++) {
      const options = await b.call('POST', '/api/auth/register-options', { json: { username: newName() } });
      expect(options.status).toBe(200);
      const bad = await b.call('POST', '/api/auth/register', { json: { credential: await new Authenticator().create(options.json, 'wrong') } });
      expect(bad.status).toBe(400);
    }
  });

  it('forget sign-ups older than an hour, and delete those rows', async () => {
    const b = new Browser();
    const old = Date.now() - 3600_000 - 1000;
    await db.insert(rateEvents).values(Array.from({ length: LIMITS.signupsPerHour }, () => ({ ip: b.ip, action: 'signup', at: old })));
    await signUp(b);
    expect((await db.select().from(rateEvents).where(eq(rateEvents.ip, b.ip))).filter((e) => e.at === old)).toEqual([]);
  });

  it(`allow ${LIMITS.failedLoginsPerHour} failed logins an hour, then 429, at login-options too`, async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const stranger = new Authenticator();
    await stranger.create({ challenge: 'x', user: { id: 'x' } });
    for (let i = 0; i < LIMITS.failedLoginsPerHour; i++) {
      const options = await b.call('POST', '/api/auth/login-options');
      expect(options.status).toBe(200);
      const r = await b.call('POST', '/api/auth/login', { json: { credential: await stranger.get(options.json) } });
      expect(r.status).toBe(401);
    }
    const blocked = await b.call('POST', '/api/auth/login-options');
    expect(blocked.status).toBe(429);
    expect(blocked.json).toMatchObject({ limit: 'failedLogins' });
    // The limit is per address.
    expect((await signIn(new Browser(), a)).status).toBe(200);
  });

  it('count failed logins and not successful ones', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    for (let i = 0; i < LIMITS.failedLoginsPerHour + 2; i++) expect((await signIn(b, a)).status).toBe(200);
  });

  it('count a wrong-challenge assertion as a failed login', async () => {
    const { a } = await signUp(new Browser());
    const b = new Browser();
    const options = await b.call('POST', '/api/auth/login-options');
    await b.call('POST', '/api/auth/login', { json: { credential: await a.get(options.json, 'wrong') } });
    // login-options also counts, as the ceremony it started.
    expect((await db.select().from(rateEvents).where(eq(rateEvents.ip, b.ip))).map((e) => e.action).sort()).toEqual(['ceremony', 'failed-login']);
  });
});

describe('the config', () => {
  it('RP_ID and ORIGIN come from bindings', () => {
    expect(env.RP_ID).toBe('arboretum.test');
    expect(env.ORIGIN).toBe('https://arboretum.test');
  });
});

describe('ipKey: what a rate limit counts by', () => {
  it('is an IPv4 address as it is', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('is the /64 prefix of an IPv6 address, spelled one way whatever the input spelling', () => {
    expect(ipKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:DB8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('::1')).toBe('0:0:0:0::/64');
  });

  it('reads an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('leaves what is not an address (no header) alone', () => {
    expect(ipKey('unknown')).toBe('unknown');
  });
});

describe('one WebAuthn user handle per account', () => {
  it('stores the handle from the registration options on the user at sign-up', async () => {
    const b = new Browser();
    const username = newName();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    await b.call('POST', '/api/auth/register', { json: { credential: await new Authenticator().create(options.json) } });
    expect((await userNamed(username)).webauthnUserId).toBe(options.json.user.id);
  });

  it('is opaque and random: different for each account, and not made from the username', async () => {
    const handles = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const options = await new Browser().call('POST', '/api/auth/register-options', { json: { username: newName() } });
      expect(options.json.user.id).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]{43,}$/));
      handles.add(options.json.user.id);
    }
    expect(handles.size).toBe(3);
  });

  it('is reused for every passkey added later', async () => {
    const b = new Browser();
    const username = newName();
    const options = await b.call('POST', '/api/auth/register-options', { json: { username } });
    await b.call('POST', '/api/auth/register', { json: { credential: await new Authenticator().create(options.json) } });

    const first = await b.call('POST', '/api/auth/add-passkey-options');
    const second = await b.call('POST', '/api/auth/add-passkey-options');
    expect(first.json.user.id).toBe(options.json.user.id);
    expect(second.json.user.id).toBe(options.json.user.id);
    expect((await userNamed(username)).webauthnUserId).toBe(options.json.user.id);
  });

  it('is given to accounts that existed before, by the migration, without touching one that has it', async () => {
    const old = await Promise.all([1, 2, 3].map(() => db.insert(users).values({ username: newName(), createdAt: 1 }).returning().then((r) => r[0])));
    const [kept] = await db.insert(users).values({ username: newName(), createdAt: 1, webauthnUserId: 'already-has-one' }).returning();
    for (const sql of backfill.split('--> statement-breakpoint').map((q) => q.replace(/^--.*$/gm, '').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean)) await env.DB.exec(sql);

    const after = await Promise.all(old.map((u) => userNamed(u.username)));
    for (const u of after) expect(u.webauthnUserId).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]{43,}$/));
    expect(new Set(after.map((u) => u.webauthnUserId)).size).toBe(3);
    expect((await userNamed(kept.username)).webauthnUserId).toBe('already-has-one');
  });
});
