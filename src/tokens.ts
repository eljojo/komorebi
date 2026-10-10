import { and, count, eq, isNull } from 'drizzle-orm';
import { LIMITS } from './config';
import type { Db } from './db/client';
import { apiTokens } from './db/schema';
import { ApiError } from './errors';
import { randomBase64Url } from './random';

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The one place a token is made. The plaintext is returned here and nowhere else: only its hash is stored.
export async function mintToken(db: Db, userId: number, label: string, scope: 'read' | 'write') {
  if (label.length < 1 || label.length > 40) throw new ApiError(400, 'a token label is 1 to 40 characters');
  const [{ live }] = await db
    .select({ live: count() })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
  if (live >= LIMITS.tokens) {
    throw new ApiError(429, `at most ${LIMITS.tokens} live tokens per user; revoke one first`, { limit: 'tokens' });
  }
  const token = `arb_${randomBase64Url(32)}`;
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, label, scope, tokenHash: await sha256Hex(token), createdAt: Date.now() })
    .returning({ id: apiTokens.id });
  return { id: row.id, token };
}
