import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../src/config';
import { apiTokens } from '../src/db/schema';
import { sha256Hex } from '../src/tokens';
import { PARAMS, asSession, call, db, get, makeToken, makeUser, sessionFor } from './helpers';

const mint = (user: { id: number }, json: unknown) => asSession(user, 'POST', '/api/tokens', { json });

describe('POST /api/tokens', () => {
  it.each(['\0abc', 'ab\0cd'])('refuses a NUL label without creating a token: %s', async (label) => {
    const u = await makeUser();
    const r = await mint(u, { label, scope: 'write' });
    expect(r.status).toBe(400);
    expect(await db.select().from(apiTokens).where(eq(apiTokens.userId, u.id))).toEqual([]);
  });

  it('mints a token for a session and shows it once', async () => {
    const u = await makeUser();
    const r = await mint(u, { label: 'studio laptop claude', scope: 'write' });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: expect.any(Number), label: 'studio laptop claude', scope: 'write', token: expect.stringMatching(/^arb_/) });
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, r.json.id));
    expect(row.tokenHash).toBe(await sha256Hex(r.json.token));
    expect(row.userId).toBe(u.id);
    expect(JSON.stringify(row)).not.toContain(r.json.token);
  });

  it('gives a token that works as its user, with the scope asked for', async () => {
    const u = await makeUser();
    const read = (await mint(u, { label: 'r', scope: 'read' })).json.token;
    const write = (await mint(u, { label: 'w', scope: 'write' })).json.token;
    expect((await get('/api/me', read)).json).toEqual({ username: u.username, kind: 'token' });
    expect((await call('POST', '/api/presets', { token: read, json: { name: 'x', params: PARAMS } })).status).toBe(403);
    const made = await call('POST', '/api/presets', { token: write, json: { name: 'x', params: PARAMS } });
    expect(made.status).toBe(201);
    expect(made.json.via).toBe('token:w');
  });

  it('refuses a scope that is not read or write, and a missing or bad label', async () => {
    const u = await makeUser();
    expect((await mint(u, { label: 'x', scope: 'admin' })).status).toBe(400);
    expect((await mint(u, { label: 'x', scope: 'read+write' })).status).toBe(400);
    expect((await mint(u, { label: 'x' })).status).toBe(400);
    expect((await mint(u, { scope: 'read' })).status).toBe(400);
    expect((await mint(u, { label: '', scope: 'read' })).status).toBe(400);
    expect((await mint(u, { label: 7, scope: 'read' })).status).toBe(400);
  });

  it(`stops at ${LIMITS.tokens} live tokens with a 429`, async () => {
    const u = await makeUser();
    for (let i = 0; i < LIMITS.tokens; i++) expect((await mint(u, { label: `t${i}`, scope: 'read' })).status).toBe(201);
    const r = await mint(u, { label: 'too many', scope: 'read' });
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ limit: 'tokens' });
  });

  it(`stops at ${LIMITS.tokens} when 25 mints arrive at once, not after`, async () => {
    const u = await makeUser();
    // One session made beforehand, so the 25 requests really are in flight together.
    const headers = { Cookie: `__Host-session=${await sessionFor(u)}` };
    const replies = await Promise.all(Array.from({ length: 25 }, (_, i) => call('POST', '/api/tokens', { json: { label: `burst${i}`, scope: 'read' }, headers })));
    expect(replies.filter((r) => r.status === 201)).toHaveLength(LIMITS.tokens);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(25 - LIMITS.tokens);
    const live = await db.select().from(apiTokens).where(eq(apiTokens.userId, u.id));
    expect(live).toHaveLength(LIMITS.tokens);
  });

  it('is 401 anonymously and 403 for any token, even a write one', async () => {
    const u = await makeUser();
    expect((await call('POST', '/api/tokens', { json: { label: 'x', scope: 'read' } })).status).toBe(401);
    const r = await call('POST', '/api/tokens', { token: await makeToken(u, { scope: 'write' }), json: { label: 'x', scope: 'read' } });
    expect(r.status).toBe(403);
    expect(await db.select().from(apiTokens).where(eq(apiTokens.label, 'x'))).toEqual([]);
  });
});

describe('GET /api/tokens', () => {
  it('lists the user\'s live tokens without secrets, with created and last-used times', async () => {
    const u = await makeUser();
    const other = await makeUser();
    const a = (await mint(u, { label: 'a', scope: 'read' })).json;
    const b = (await mint(u, { label: 'b', scope: 'write' })).json;
    await mint(other, { label: 'theirs', scope: 'read' });
    await get('/api/me', a.token);

    const r = await asSession(u, 'GET', '/api/tokens');
    expect(r.status).toBe(200);
    expect(r.json.tokens).toEqual([
      { id: b.id, label: 'b', scope: 'write', created_at: expect.any(Number), last_used_at: null },
      { id: a.id, label: 'a', scope: 'read', created_at: expect.any(Number), last_used_at: expect.any(Number) },
    ]);
    expect(r.text).not.toContain('arb_');
    expect(r.text).not.toMatch(/hash/i);
  });

  it('is 401 anonymously and 403 for a token', async () => {
    const u = await makeUser();
    expect((await call('GET', '/api/tokens')).status).toBe(401);
    expect((await get('/api/tokens', await makeToken(u))).status).toBe(403);
  });
});

describe('DELETE /api/tokens/:id', () => {
  it('revokes: the token stops working and drops off the list, freeing a slot', async () => {
    const u = await makeUser();
    const t = (await mint(u, { label: 'gone', scope: 'read' })).json;
    expect((await get('/api/me', t.token)).status).toBe(200);
    const r = await asSession(u, 'DELETE', `/api/tokens/${t.id}`);
    expect(r.status).toBe(200);
    expect((await get('/api/me', t.token)).status).toBe(401);
    expect((await asSession(u, 'GET', '/api/tokens')).json.tokens).toEqual([]);
    expect((await asSession(u, 'DELETE', `/api/tokens/${t.id}`)).status).toBe(404);
  });

  it("cannot revoke someone else's token, and an unknown id is a 404", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const t = (await mint(theirs, { label: 'theirs', scope: 'read' })).json;
    expect((await asSession(mine, 'DELETE', `/api/tokens/${t.id}`)).status).toBe(404);
    expect((await asSession(mine, 'DELETE', '/api/tokens/nope')).status).toBe(404);
    expect((await get('/api/me', t.token)).status).toBe(200);
  });

  it('is 401 anonymously and 403 for a token, even the one being revoked', async () => {
    const u = await makeUser();
    const t = (await mint(u, { label: 'self', scope: 'write' })).json;
    expect((await call('DELETE', `/api/tokens/${t.id}`)).status).toBe(401);
    expect((await call('DELETE', `/api/tokens/${t.id}`, { token: t.token })).status).toBe(403);
    expect((await get('/api/me', t.token)).status).toBe(200);
  });

  it('is refused unless sent as application/json, like every write', async () => {
    const u = await makeUser();
    const t = (await mint(u, { label: 'x', scope: 'read' })).json;
    const r = await asSession(u, 'DELETE', `/api/tokens/${t.id}`, { headers: { 'Content-Type': 'text/plain' } });
    expect(r.status).toBe(415);
    expect((await get('/api/me', t.token)).status).toBe(200);
  });
});
