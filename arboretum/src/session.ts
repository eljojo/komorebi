import { eq, lt, type SQL } from 'drizzle-orm';
import { setCookie } from 'hono/cookie';
import type { Ctx } from './auth';
import { SESSION_MS } from './config';
import type { Db } from './db/client';
import { sessions } from './db/schema';
import { randomBase64Url } from './random';
import { sha256Hex } from './tokens';

// `__Host-` is added by the cookie helper's prefix option; it forces Secure, Path=/ and no Domain, so no sibling
// eljojo.net app can set or overwrite this cookie (spec §3.2).
export const SESSION_COOKIE = 'session';

// The statements that open a session, to ride in the caller's batch. `userId` may be a subselect, because
// sign-up opens the session in the same transaction that creates the user. Expired sessions are swept here.
export async function openSession(db: Db, userId: number | SQL) {
  const token = randomBase64Url(32);
  const now = Date.now();
  return {
    token,
    statements: [
      db.delete(sessions).where(lt(sessions.expiresAt, now)),
      db.insert(sessions).values({ tokenHash: await sha256Hex(token), userId, createdAt: now, expiresAt: now + SESSION_MS }),
    ],
  };
}

export function setSessionCookie(c: Ctx, token: string) {
  setCookie(c, SESSION_COOKIE, token, { prefix: 'host', httpOnly: true, secure: true, path: '/', sameSite: 'Lax', maxAge: SESSION_MS / 1000 });
}

export async function endSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
}
