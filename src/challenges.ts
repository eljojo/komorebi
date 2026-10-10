// WebAuthn challenges (brief 03): kept on the server and single-use. The browser carries only the row's id, in
// a short-lived `__Host-challenge` cookie, so a captured response cannot be replayed with a cookie the client
// sets itself.
import { eq, lt } from 'drizzle-orm';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Ctx } from './auth';
import { CHALLENGE_TTL_MS } from './config';
import type { Db } from './db/client';
import { challenges } from './db/schema';
import { ApiError } from './errors';
import { randomBase64Url } from './random';

type Purpose = typeof challenges.$inferSelect.purpose;

export async function issueChallenge(c: Ctx, db: Db, row: { challenge: string; purpose: Purpose; userId?: number; pendingUsername?: string; pendingUserHandle?: string }) {
  await db.delete(challenges).where(lt(challenges.expiresAt, Date.now()));
  const id = randomBase64Url(24);
  await db.insert(challenges).values({ id, userId: null, pendingUsername: null, pendingUserHandle: null, ...row, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  setCookie(c, 'challenge', id, { prefix: 'host', httpOnly: true, secure: true, path: '/', sameSite: 'Lax', maxAge: CHALLENGE_TTL_MS / 1000 });
}

// Deleted as it is looked up, so a wrong attempt burns the challenge as surely as a right one.
export async function takeChallenge(c: Ctx, db: Db, purpose: Purpose) {
  const id = getCookie(c, 'challenge', 'host');
  const gone = new ApiError(400, 'that sign-in step expired or was already used; start again (challenge)');
  if (!id) throw gone;
  deleteCookie(c, 'challenge', { prefix: 'host', secure: true, path: '/' });
  const [row] = await db.delete(challenges).where(eq(challenges.id, id)).returning();
  if (!row || row.expiresAt <= Date.now() || row.purpose !== purpose) throw gone;
  return row;
}
