import { sql } from 'drizzle-orm';
import { LIMITS } from './config';
import type { Db } from './db/client';
import { ApiError } from './errors';
import { randomBase64Url } from './random';

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The one place a token is made. The plaintext is returned here and nowhere else: only its hash is stored.
export async function mintToken(db: Db, userId: number, label: string, scope: 'read' | 'write') {
  if (label.length < 1 || label.length > 40) throw new ApiError(400, 'a token label is 1 to 40 characters');
  const token = `arb_${randomBase64Url(32)}`;
  // The limit is part of the insert, so a burst of parallel mints cannot each pass a check made before the others landed.
  const [row] = await db.all<{ id: number }>(sql`
    insert into api_tokens (user_id, label, scope, token_hash, created_at)
    select ${userId}, ${label}, ${scope}, ${await sha256Hex(token)}, ${Date.now()}
    where (select count(*) from api_tokens where user_id = ${userId} and revoked_at is null) < ${LIMITS.tokens}
    returning id`);
  if (!row) throw new ApiError(429, `at most ${LIMITS.tokens} live tokens per user; revoke one first`, { limit: 'tokens' });
  return { id: row.id, token };
}
