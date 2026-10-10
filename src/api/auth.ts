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
import { credentials, users } from '../db/schema';
import { issueChallenge, takeChallenge } from '../challenges';
import { ApiError } from '../errors';
import { assertUnder, clientIp, recordEvent } from '../ratelimit';
import { SESSION_COOKIE, endSession, openSession, setSessionCookie } from '../session';
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

const isUnique = (err: unknown) => /UNIQUE/i.test(`${err} ${(err as { cause?: unknown })?.cause}`);

// A passkey that checks out, as the row we store.
async function verifiedPasskey(c: Ctx, response: any, expectedChallenge: string) {
  try {
    const result = await verifyRegistrationResponse({ response, expectedChallenge, ...verifying(c) });
    if (!result.verified) throw new Error('not verified');
    return result.registrationInfo!.credential;
  } catch {
    throw new ApiError(400, 'that passkey could not be verified');
  }
}

const passkeyRow = (userId: number | ReturnType<typeof sql>, credential: Awaited<ReturnType<typeof verifiedPasskey>>) => ({
  id: credential.id,
  userId,
  publicKey: isoBase64URL.fromBuffer(credential.publicKey),
  counter: credential.counter,
  transports: credential.transports ?? null,
  createdAt: Date.now(),
});

async function failedLogin(db: Db, ip: string, message: string): Promise<never> {
  await recordEvent(db, ip, 'failed-login');
  throw new ApiError(401, message);
}

export function registerAuth(app: Hono<AppEnv>) {
  secured(app, 'POST', '/api/auth/register-options', 'anonymous', async (c) => {
    const db = connect(c.env.DB);
    await assertUnder(db, clientIp(c), 'signup', LIMITS.signupsPerHour, 'signups');
    const username = await freeUsername(db, (await readJsonBody(c)).body.username);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: c.env.RP_ID,
      userName: username,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    await issueChallenge(c, db, { challenge: options.challenge, purpose: 'register', pendingUsername: username });
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

    // One transaction, so there is never a user without a passkey (or a passkey without a user).
    const userId = sql<number>`(select id from users where username = ${username})`;
    const session = await openSession(db, userId);
    try {
      await db.batch([
        db.insert(users).values({ username, createdAt: Date.now() }),
        db.insert(credentials).values(passkeyRow(userId, credential)),
        ...session.statements,
        recordEvent(db, ip, 'signup'),
      ]);
    } catch (err) {
      if (isUnique(err)) throw new ApiError(409, 'that username or passkey is already taken');
      throw err;
    }
    setSessionCookie(c, session.token);
    return c.json({ username }, 201);
  });

  secured(app, 'POST', '/api/auth/login-options', 'anonymous', async (c) => {
    const db = connect(c.env.DB);
    await assertUnder(db, clientIp(c), 'failed-login', LIMITS.failedLoginsPerHour, 'failedLogins');
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

    const session = await openSession(db, stored.cred.userId);
    await db.batch([
      db.update(credentials).set({ counter, lastUsedAt: Date.now() }).where(eq(credentials.id, stored.cred.id)),
      ...session.statements,
    ]);
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
    // The count is part of the delete, so two removals racing cannot both pass the check.
    const removed = await db
      .delete(credentials)
      .where(and(eq(credentials.id, id), sql`(select count(*) from credentials where user_id = ${actor.userId}) > 1`))
      .returning({ id: credentials.id });
    if (!removed.length) throw new ApiError(409, 'this is your last passkey; add another before removing it');
    return c.json({ removed: id });
  });

  secured(app, 'POST', '/api/auth/add-passkey-options', 'session', async (c, actor) => {
    const db = connect(c.env.DB);
    const existing = await db.select({ id: credentials.id }).from(credentials).where(eq(credentials.userId, actor.userId));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: c.env.RP_ID,
      userName: actor.username,
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
    try {
      await db.insert(credentials).values(passkeyRow(actor.userId, credential));
    } catch (err) {
      if (isUnique(err)) throw new ApiError(409, 'that passkey is already registered');
      throw err;
    }
    return c.json({ id: credential.id }, 201);
  });
}
