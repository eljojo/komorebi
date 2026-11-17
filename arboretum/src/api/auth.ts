// Passkey sign-up, login and passkey management (spec §3.1), following bike-app-astro's flow with the
// challenges kept server-side (src/challenges.ts).
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { and, count, eq, sql } from 'drizzle-orm';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { Hono } from 'hono';
import { type AppEnv, type Ctx, secured } from '../auth';
import { LIMITS } from '../config';
import { type Db, connect } from '../db/client';
import { credentials, rateEvents, sessions, users } from '../db/schema';
import { issueChallenge, takeChallenge } from '../challenges';
import { ApiError } from '../errors';
import { assertUnder, clientIp, eventFull, eventWithin, reserve, tooMany } from '../ratelimit';
import { SESSION_COOKIE, endSession, openSession, setSessionCookie } from '../session';
import { sha256Hex } from '../tokens';
import { randomBase64Url } from '../random';
import { freeUsername } from '../usernames';
import { readJsonBody } from './util';

const RP_NAME = 'arboretum';

// UV is "preferred" in the options, so an authenticator that skips it must not fail verification afterwards.
const verifying = (c: Ctx) => ({ expectedOrigin: c.env.ORIGIN, expectedRPID: c.env.RP_ID, requireUserVerification: false });

async function credentialFrom(c: Ctx) {
  const { body } = await readJsonBody(c);
  if (typeof body.credential !== 'object' || body.credential === null) throw new ApiError(400, 'credential is required');
  return body.credential as any;
}

// The transports WebAuthn defines. The browser sends them, so anything else is the sender's JSON, not a fact
// about the authenticator, and is not kept or echoed back.
const TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable'];
const MAX_CREDENTIAL_ID_BYTES = 1023;

const isUnique = (err: unknown) => /UNIQUE/i.test(`${err} ${(err as { cause?: unknown })?.cause}`);
// A subselect that found nothing: the row it was meant to read (a credential, a session) is gone.
const isMissing = (err: unknown) => /NOT NULL constraint failed/i.test(`${err} ${(err as { cause?: unknown })?.cause}`);

// A passkey that checks out, as the row we store.
async function verifiedPasskey(c: Ctx, response: any, expectedChallenge: string) {
  let credential;
  try {
    const result = await verifyRegistrationResponse({ response, expectedChallenge, ...verifying(c) });
    if (!result.verified) throw new Error('not verified');
    credential = result.registrationInfo!.credential;
  } catch {
    throw new ApiError(400, 'that passkey could not be verified');
  }
  if (isoBase64URL.toBuffer(credential.id).length > MAX_CREDENTIAL_ID_BYTES) {
    throw new ApiError(400, `that passkey's id is longer than WebAuthn allows (${MAX_CREDENTIAL_ID_BYTES} bytes)`);
  }
  return credential;
}

const passkeyRow = (userId: number | ReturnType<typeof sql>, credential: Awaited<ReturnType<typeof verifiedPasskey>>) => ({
  id: credential.id,
  userId,
  publicKey: isoBase64URL.fromBuffer(credential.publicKey),
  counter: credential.counter,
  transports: Array.isArray(credential.transports) ? credential.transports.filter((t) => TRANSPORTS.includes(t)) : null,
  createdAt: Date.now(),
});

// Two logins verified against the same stored counter can finish in either order, so the later write must not
// roll the counter back: a replayed assertion would verify again. A passkey that always sends 0 stays at 0.
export const credentialUsed = (db: Db, id: string, counter: number) =>
  db.update(credentials).set({ counter: sql`max(counter, ${counter})`, lastUsedAt: Date.now() }).where(eq(credentials.id, id));

async function failedLogin(db: Db, ip: string, message: string): Promise<never> {
  await reserve(db, ip, 'failed-login', LIMITS.failedLoginsPerHour, 'failedLogins');
  throw new ApiError(401, message);
}

// Starting any ceremony counts against one per-address limit, taken before the options are made (spec §5).
const startCeremony = (c: Ctx, db: Db) => reserve(db, clientIp(c), 'ceremony', LIMITS.ceremoniesPerHour, 'ceremonyStarts');

export function registerAuth(app: Hono<AppEnv>) {
  secured(app, 'POST', '/api/auth/register-options', 'anonymous', async (c) => {
    const db = connect(c.env.DB);
    await assertUnder(db, clientIp(c), 'signup', LIMITS.signupsPerHour, 'signups');
    const username = await freeUsername(db, (await readJsonBody(c)).body.username);
    await startCeremony(c, db);
    // One opaque handle per account (WebAuthn user handle), random and unrelated to the person; it is kept with
    // the challenge until the account exists to hold it.
    const handle = randomBase64Url(32);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: c.env.RP_ID,
      userName: username,
      userID: isoBase64URL.toBuffer(handle),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await issueChallenge(c, db, { challenge: options.challenge, purpose: 'register', pendingUsername: username, pendingUserHandle: handle });
    return c.json(options);
  });

  secured(app, 'POST', '/api/auth/register', 'anonymous', async (c) => {
    const db = connect(c.env.DB);
    const ip = clientIp(c);
    const response = await credentialFrom(c);
    await assertUnder(db, ip, 'signup', LIMITS.signupsPerHour, 'signups');
    const challenge = await takeChallenge(c, db, 'register');
    const username = await freeUsername(db, challenge.pendingUsername);
    const credential = await verifiedPasskey(c, response, challenge.challenge);

    // One transaction, so there is never a user without a passkey (or a passkey without a user). Its first
    // statement is the sign-up's own rate event, which refuses itself over the limit and so aborts the rest.
    const userId = sql<number>`(select id from users where username = ${username})`;
    const session = await openSession(db, userId);
    try {
      await db.batch([
        db.insert(rateEvents).values({ ip, action: 'signup', at: eventWithin(ip, 'signup', LIMITS.signupsPerHour) }),
        db.insert(users).values({ username, webauthnUserId: challenge.pendingUserHandle, createdAt: Date.now() }),
        db.insert(credentials).values(passkeyRow(userId, credential)),
        ...session.statements,
      ]);
    } catch (err) {
      if (eventFull(err)) throw tooMany('signups');
      if (isUnique(err)) throw new ApiError(409, 'that username or passkey is already taken');
      throw err;
    }
    setSessionCookie(c, session.token);
    return c.json({ username }, 201);
  });

  secured(app, 'POST', '/api/auth/login-options', 'anonymous', async (c) => {
    const db = connect(c.env.DB);
    await assertUnder(db, clientIp(c), 'failed-login', LIMITS.failedLoginsPerHour, 'failedLogins');
    await startCeremony(c, db);
    // No allowCredentials: a discoverable credential names its own account, so nobody types a username.
    const options = await generateAuthenticationOptions({ rpID: c.env.RP_ID, userVerification: 'preferred' });
    await issueChallenge(c, db, { challenge: options.challenge, purpose: 'login' });
    return c.json(options);
  });

  secured(app, 'POST', '/api/auth/login', 'anonymous', async (c) => {
    const db = connect(c.env.DB);
    const ip = clientIp(c);
    const response = await credentialFrom(c);
    await assertUnder(db, ip, 'failed-login', LIMITS.failedLoginsPerHour, 'failedLogins');
    const challenge = await takeChallenge(c, db, 'login');

    const [stored] = typeof response.id === 'string'
      ? await db
          .select({ cred: credentials, username: users.username })
          .from(credentials)
          .innerJoin(users, eq(users.id, credentials.userId))
          .where(eq(credentials.id, response.id))
      : [];
    if (!stored) return failedLogin(db, ip, 'that passkey is not recognised');

    let counter: number;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        credential: {
          id: stored.cred.id,
          publicKey: isoBase64URL.toBuffer(stored.cred.publicKey),
          counter: stored.cred.counter,
          transports: stored.cred.transports as any,
        },
        ...verifying(c),
      });
      if (!result.verified) throw new Error('not verified');
      counter = result.authenticationInfo.newCounter;
    } catch {
      return failedLogin(db, ip, 'that passkey could not be verified');
    }

    // The session's owner is read from the credential inside the batch: a passkey removed while this assertion was
    // being verified leaves no row to read, the NOT NULL user_id refuses the insert, and the batch rolls back
    // whole. Otherwise a removal (which ends every session) could be followed by a fresh 30-day one.
    const session = await openSession(db, sql`(select user_id from credentials where id = ${stored.cred.id})`);
    try {
      await db.batch([
        credentialUsed(db, stored.cred.id, counter),
        ...session.statements,
      ]);
    } catch (err) {
      if (isMissing(err)) return failedLogin(db, ip, 'that passkey is not recognised');
      throw err;
    }
    setSessionCookie(c, session.token);
    return c.json({ username: stored.username });
  });

  secured(app, 'POST', '/api/auth/logout', 'session', async (c) => {
    await endSession(connect(c.env.DB), getCookie(c, SESSION_COOKIE, 'host')!);
    deleteCookie(c, SESSION_COOKIE, { prefix: 'host', secure: true, path: '/' });
    return c.json({ ok: true });
  });

  secured(app, 'GET', '/api/auth/passkeys', 'session', async (c, actor) => {
    const rows = await connect(c.env.DB).select().from(credentials).where(eq(credentials.userId, actor.userId)).orderBy(credentials.createdAt);
    return c.json({ passkeys: rows.map((r) => ({ id: r.id, transports: r.transports, created_at: r.createdAt, last_used_at: r.lastUsedAt })) });
  });

  secured(app, 'POST', '/api/auth/passkeys/:id/remove', 'session', async (c, actor) => {
    const db = connect(c.env.DB);
    const id = String(c.req.param('id'));
    const [mine] = await db.select({ id: credentials.id }).from(credentials).where(and(eq(credentials.id, id), eq(credentials.userId, actor.userId)));
    if (!mine) throw new ApiError(404, 'not found');
    // The count is part of the delete, so two removals racing cannot both pass the check. A removal also ends
    // every session of the user, this one included, in the same transaction: a passkey that was removed because
    // it was lost must not leave behind a login that someone holding it already made. The sessions go only
    // when the credential is really gone.
    const [removed] = await db.batch([
      db
        .delete(credentials)
        .where(and(eq(credentials.id, id), sql`(select count(*) from credentials where user_id = ${actor.userId}) > 1`))
        .returning({ id: credentials.id }),
      db.delete(sessions).where(and(eq(sessions.userId, actor.userId), sql`not exists (select 1 from credentials where id = ${id})`)),
    ]);
    if (!removed.length) throw new ApiError(409, 'this is your last passkey; add another before removing it');
    return c.json({ removed: id });
  });

  secured(app, 'POST', '/api/auth/add-passkey-options', 'session', async (c, actor) => {
    const db = connect(c.env.DB);
    await startCeremony(c, db);
    const existing = await db.select({ id: credentials.id }).from(credentials).where(eq(credentials.userId, actor.userId));
    // Every passkey of an account carries the account's one user handle, or credential managers show two people.
    const [{ handle }] = await db.select({ handle: users.webauthnUserId }).from(users).where(eq(users.id, actor.userId));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: c.env.RP_ID,
      userName: actor.username,
      userID: isoBase64URL.toBuffer(handle!),
      attestationType: 'none',
      excludeCredentials: existing,
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await issueChallenge(c, db, { challenge: options.challenge, purpose: 'add-passkey', userId: actor.userId });
    return c.json(options);
  });

  secured(app, 'POST', '/api/auth/add-passkey', 'session', async (c, actor) => {
    const db = connect(c.env.DB);
    const response = await credentialFrom(c);
    const challenge = await takeChallenge(c, db, 'add-passkey');
    if (challenge.userId !== actor.userId) throw new ApiError(400, 'that sign-in step was started by someone else (challenge)');
    const credential = await verifiedPasskey(c, response, challenge.challenge);
    // The owner is read from the session that authorised this enrollment, at commit. Removing a passkey ends
    // every session, so an enrollment still pending then finds no session, the NOT NULL user_id refuses the
    // insert, and nothing is added.
    const owner = sql<number>`(select user_id from sessions where token_hash = ${await sha256Hex(getCookie(c, SESSION_COOKIE, 'host')!)} and expires_at > ${Date.now()})`;
    try {
      await db.insert(credentials).values(passkeyRow(owner, credential));
    } catch (err) {
      if (isUnique(err)) throw new ApiError(409, 'that passkey is already registered');
      if (isMissing(err)) throw new ApiError(401, 'your session ended before the passkey was added; sign in again');
      throw err;
    }
    return c.json({ id: credential.id }, 201);
  });
}
