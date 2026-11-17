import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { apiTokens, presetVersions, presets, users } from '../src/db/schema';

const db = drizzle(env.DB);
const now = Date.now();

async function user(username: string) {
  const [u] = await db.insert(users).values({ username, createdAt: now }).returning();
  return u;
}

describe('schema', () => {
  it('round-trips a user', async () => {
    const u = await user('schema-roundtrip');
    const [again] = await db.select().from(users).where(eq(users.id, u.id));
    expect(again.username).toBe('schema-roundtrip');
  });

  it('refuses a duplicate username', async () => {
    await user('schema-dup');
    await expect(user('schema-dup')).rejects.toThrow();
  });

  it('refuses a duplicate token hash', async () => {
    const u = await user('schema-hash');
    const row = { userId: u.id, label: 'a', scope: 'read' as const, tokenHash: 'h'.repeat(64), createdAt: now };
    await db.insert(apiTokens).values(row);
    await expect(db.insert(apiTokens).values({ ...row, label: 'b' })).rejects.toThrow();
  });

  it('refuses a duplicate (preset_id, n)', async () => {
    const u = await user('schema-versions');
    const [p] = await db
      .insert(presets)
      .values({ ownerId: u.id, shareToken: 'schema-versions-token', createdAt: now, updatedAt: now })
      .returning();
    const v = { presetId: p.id, n: 1, name: 'x', tags: [], params: '{}', via: 'web', createdAt: now };
    await db.insert(presetVersions).values(v);
    await expect(db.insert(presetVersions).values(v)).rejects.toThrow();
  });

  it('defaults a preset to private and not archived', async () => {
    const u = await user('schema-defaults');
    const [p] = await db
      .insert(presets)
      .values({ ownerId: u.id, shareToken: 'schema-defaults-token', createdAt: now, updatedAt: now })
      .returning();
    expect(p.visibility).toBe('private');
    expect(p.archivedAt).toBeNull();
  });

  it('refuses an unknown visibility', async () => {
    const u = await user('schema-vis');
    await expect(
      db.insert(presets).values({ ownerId: u.id, visibility: 'secret' as never, shareToken: 'schema-vis-token', createdAt: now, updatedAt: now }),
    ).rejects.toThrow();
  });
});

// The pruning deletes run on every ceremony and every limit check, so they must not scan their tables.
describe('indexes', () => {
  async function plan(query: string, ...binds: unknown[]) {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query}`).bind(...binds).all<{ detail: string }>();
    return results.map((r) => r.detail).join(' | ');
  }

  it('lets the challenge pruning find expired rows by an index', async () => {
    expect(await plan('DELETE FROM challenges WHERE expires_at < ?', 1)).toMatch(/USING (COVERING )?INDEX/);
  });

  it('lets the rate-event pruning find old rows by an index', async () => {
    expect(await plan('DELETE FROM rate_events WHERE at < ?', 1)).toMatch(/USING (COVERING )?INDEX/);
  });

  it('lets the rate-event count use the (ip, action, at) index', async () => {
    expect(await plan('SELECT count(*) FROM rate_events WHERE ip = ? AND action = ? AND at > ?', 'x', 'signup', 1)).toMatch(/USING (COVERING )?INDEX/);
  });

  it('bounds the daily version count by both preset and creation time', async () => {
    const query = 'SELECT count(*) FROM preset_versions v JOIN presets p ON p.id = v.preset_id WHERE p.owner_id = ? AND v.created_at > ?';
    expect(await plan(query, 1, 1)).toMatch(/USING COVERING INDEX .*\(preset_id=\? AND created_at>\?\)/);
  });
});
