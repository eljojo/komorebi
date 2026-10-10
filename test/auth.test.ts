import { env, exports } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src';
import { policies, viaFor } from '../src/auth';
import { LIMITS } from '../src/config';
import { apiTokens } from '../src/db/schema';
import { mintToken, sha256Hex } from '../src/tokens';
import { call, db, get, makeToken, makeUser, reply } from './helpers';

describe('tokens', () => {
  it('look like arb_ + 32 random bytes in base64url, and only the hash is stored', async () => {
    const u = await makeUser();
    const { token } = await mintToken(db, u.id, 'studio laptop', 'read');
    expect(token).toMatch(/^arb_[A-Za-z0-9_-]{43}$/);
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.userId, u.id));
    expect(row.tokenHash).toBe(await sha256Hex(token));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.scope).toBe('read');
    expect(row.label).toBe('studio laptop');
  });

  it('are different every time', async () => {
    const u = await makeUser();
    const a = await mintToken(db, u.id, 'a', 'read');
    const b = await mintToken(db, u.id, 'b', 'read');
    expect(a.token).not.toBe(b.token);
  });

  it('refuse a label outside 1 to 40 characters', async () => {
    const u = await makeUser();
    await expect(mintToken(db, u.id, '', 'read')).rejects.toMatchObject({ status: 400 });
    await expect(mintToken(db, u.id, 'x'.repeat(41), 'read')).rejects.toMatchObject({ status: 400 });
    await expect(mintToken(db, u.id, 'x'.repeat(40), 'read')).resolves.toBeTruthy();
  });

  it(`stop at ${LIMITS.tokens} live tokens per user with a 429 naming the limit; a revoked token frees a slot`, async () => {
    const u = await makeUser();
    for (let i = 0; i < LIMITS.tokens; i++) await mintToken(db, u.id, `t${i}`, 'read');
    await expect(mintToken(db, u.id, 'one too many', 'read')).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining(`${LIMITS.tokens} live tokens`),
    });
    await db.update(apiTokens).set({ revokedAt: Date.now() }).where(eq(apiTokens.label, 't0'));
    await expect(mintToken(db, u.id, 'fits now', 'read')).resolves.toBeTruthy();
    const other = await makeUser();
    await expect(mintToken(db, other.id, 'someone else', 'read')).resolves.toBeTruthy();
  });
});

describe('GET /api/me', () => {
  it('says who the token acts as', async () => {
    const u = await makeUser('me');
    const r = await get('/api/me', await makeToken(u));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ username: u.username, kind: 'token' });
  });

  it('is 401 without a token, with a made-up token, and with a revoked one', async () => {
    const u = await makeUser();
    const token = await makeToken(u);
    expect((await get('/api/me')).status).toBe(401);
    expect((await get('/api/me', 'arb_nonsense')).status).toBe(401);
    await db.update(apiTokens).set({ revokedAt: Date.now() }).where(eq(apiTokens.userId, u.id));
    const r = await get('/api/me', token);
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: expect.any(String) });
  });

  it('records last_used_at', async () => {
    const u = await makeUser();
    const token = await makeToken(u);
    const [before] = await db.select().from(apiTokens).where(eq(apiTokens.userId, u.id));
    expect(before.lastUsedAt).toBeNull();
    await get('/api/me', token);
    const [after] = await db.select().from(apiTokens).where(eq(apiTokens.userId, u.id));
    expect(after.lastUsedAt).toBeGreaterThan(0);
  });

  it('accepts the Bearer scheme in any case and refuses other schemes', async () => {
    const u = await makeUser();
    const token = await makeToken(u);
    const as = (auth: string) => call('GET', '/api/me', { headers: { Authorization: auth } });
    expect((await as(`bearer ${token}`)).status).toBe(200);
    expect((await as(`Basic ${token}`)).status).toBe(401);
    expect((await as(token)).status).toBe(401);
  });
});

describe('errors', () => {
  it('are JSON, also for an unknown /api path', async () => {
    const r = await get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ error: expect.any(String) });
  });
});

describe('the CSRF guard: writes must be application/json', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s with another content type is 415 before anything else runs', async (method) => {
    const u = await makeUser();
    const token = await makeToken(u);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const r = await call(method, '/api/presets', { token, body: '{}', headers: { 'Content-Type': type } });
      expect(r.status, `${method} ${type}`).toBe(415);
      expect(r.json.error).toMatch(/application\/json/);
    }
  });

  it('is 415 even for an anonymous request, and for a missing content type', async () => {
    const res = await createApp().request('/api/presets', { method: 'POST', body: 'x' }, env);
    expect(res.status).toBe(415);
  });

  it('lets application/json with parameters through to the next check', async () => {
    const r = await call('POST', '/api/presets', { body: '{}', headers: { 'Content-Type': 'Application/JSON; charset=utf-8' } });
    expect(r.status).toBe(401);
  });

  it('does not apply to GET, HEAD or OPTIONS', async () => {
    expect((await get('/api/health')).status).toBe(200);
    const head = await reply(await createApp().request('/api/health', { method: 'HEAD' }, env));
    expect(head.status).toBe(200);
    const opts = await reply(await createApp().request('/api/presets', { method: 'OPTIONS' }, env));
    expect(opts.status).not.toBe(415);
  });
});

describe('CORS on /api/*', () => {
  const KOMOREBI = 'https://komorebi.eljojo.net';

  // The editor's whole surface (spec §8), and nothing else.
  const EDITOR_ROUTES = [
    'GET /api/me',
    'GET /api/presets',
    'POST /api/presets',
    'GET /api/presets/1',
    'GET /api/presets/1/versions',
    'GET /api/presets/1/versions/2',
    'POST /api/presets/1/versions',
    'GET /api/playlists',
    'GET /api/playlists/1',
    'POST /api/playlists',
    'PUT /api/playlists/1/items',
  ];
  // A script on the editor's origin must not be able to reach these: minting a token, publishing, the export.
  const OTHER_ROUTES = [
    'GET /api/health',
    'POST /api/auth/register-options',
    'POST /api/auth/register',
    'POST /api/auth/login-options',
    'POST /api/auth/login',
    'POST /api/auth/logout',
    'GET /api/auth/passkeys',
    'POST /api/auth/passkeys/x/remove',
    'POST /api/auth/add-passkey-options',
    'POST /api/auth/add-passkey',
    'POST /api/tokens',
    'GET /api/tokens',
    'DELETE /api/tokens/1',
    'GET /api/export',
    'PATCH /api/presets/1',
    'POST /api/presets/1/archive',
    'POST /api/presets/1/unarchive',
    'PATCH /api/playlists/1',
  ];

  async function preflight(path: string, origin: string, method = 'POST') {
    const res = await createApp().request(
      path,
      { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type,authorization' } },
      env,
    );
    return res.headers;
  }

  async function actual(method: string, path: string, origin: string) {
    const init: RequestInit = { method, headers: { Origin: origin, 'Content-Type': 'application/json' } };
    if (method !== 'GET') init.body = '{}';
    return (await createApp().request(path, init, env)).headers;
  }

  it.each([KOMOREBI])('allows %s, with credentials', async (origin) => {
    const h = await preflight('/api/presets', origin);
    expect(h.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(h.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(h.get('Access-Control-Allow-Methods')?.split(',').map((m) => m.trim()).sort()).toEqual(['GET', 'POST']);
    expect((h.get('Access-Control-Allow-Headers') ?? '').toLowerCase().split(',').map((m) => m.trim()).sort()).toEqual(['authorization', 'content-type']);
  });

  it.each(['https://evil.example', 'https://komorebi.eljojo.net.evil.example', 'http://localhost:8000', 'http://localhost:8001', 'https://eljojo.net', 'null'])(
    'gives %s no allow-origin on a preflight',
    async (origin) => {
      const h = await preflight('/api/presets', origin);
      expect(h.get('Access-Control-Allow-Origin')).toBeNull();
    },
  );

  it.each(EDITOR_ROUTES)('answers the komorebi origin on %s, preflight and request', async (route) => {
    const [method, path] = route.split(' ');
    expect((await preflight(path, KOMOREBI, method)).get('Access-Control-Allow-Origin'), 'preflight').toBe(KOMOREBI);
    const h = await actual(method, path, KOMOREBI);
    expect(h.get('Access-Control-Allow-Origin'), 'request').toBe(KOMOREBI);
    expect(h.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it.each(OTHER_ROUTES)('gives the komorebi origin no CORS headers on %s, preflight or request', async (route) => {
    const [method, path] = route.split(' ');
    for (const h of [await preflight(path, KOMOREBI, method), await actual(method, path, KOMOREBI)]) {
      expect(h.get('Access-Control-Allow-Origin')).toBeNull();
      expect(h.get('Access-Control-Allow-Credentials')).toBeNull();
    }
  });

  it('does not grant a method the route lacks: a preflight for DELETE on an editor path gets nothing', async () => {
    expect((await preflight('/api/presets/1', KOMOREBI, 'DELETE')).get('Access-Control-Allow-Origin')).toBeNull();
    expect((await preflight('/api/presets/1', KOMOREBI, 'PATCH')).get('Access-Control-Allow-Origin')).toBeNull();
    expect((await preflight('/api/playlists', KOMOREBI, 'PUT')).get('Access-Control-Allow-Origin')).toBeNull();
    expect((await preflight('/api/playlists/1/items', KOMOREBI, 'POST')).get('Access-Control-Allow-Origin')).toBeNull();
  });

  // A preflight is cached by the browser for every method it lists, so it may list only what that path grants the
  // editor: a GET preflight on /api/playlists must not leave a POST permitted for the cache's lifetime.
  it.each([
    ['/api/me', ['GET']],
    ['/api/presets', ['GET', 'POST']],
    ['/api/presets/1', ['GET']],
    ['/api/presets/1/versions', ['GET', 'POST']],
    ['/api/presets/1/versions/2', ['GET']],
    ['/api/playlists', ['GET', 'POST']],
    ['/api/playlists/1', ['GET']],
    ['/api/playlists/1/items', ['PUT']],
  ])('advertises on %s only %j', async (path, methods) => {
    for (const asked of methods) {
      const h = await preflight(path, KOMOREBI, asked);
      expect(h.get('Access-Control-Allow-Methods')?.split(',').map((m) => m.trim()).sort()).toEqual(methods);
    }
  });

  it('answers a request from elsewhere with no allow-origin, even on an editor route', async () => {
    expect((await actual('GET', '/api/me', 'https://evil.example')).get('Access-Control-Allow-Origin')).toBeNull();
  });

  // Any editor, on any host, may read a look or a playlist it was handed a link to (José, 2026-10-10: "ideally any
  // editor would be able to load presets from arboretum if the browser allowed the ajax request"). The grant is `*`
  // without credentials, so a browser never lets a page read a credentialed answer through it: what anyone reads
  // this way is what an anonymous visitor may see.
  const READ_ROUTES = ['/api/presets/1', '/api/presets/1/versions', '/api/presets/1/versions/2', '/api/playlists/1'];
  it.each(READ_ROUTES)('lets any origin read GET %s, without credentials', async (path) => {
    for (const origin of ['https://evil.example', 'http://localhost:8000', 'https://eljojo.net', 'null']) {
      const h = await actual('GET', path, origin);
      expect(h.get('Access-Control-Allow-Origin'), origin).toBe('*');
      expect(h.get('Access-Control-Allow-Credentials'), origin).toBeNull();
      const p = await preflight(path, origin, 'GET');
      expect(p.get('Access-Control-Allow-Origin'), `${origin} preflight`).toBe('*');
      expect(p.get('Access-Control-Allow-Methods')?.split(',').map((m) => m.trim())).toEqual(['GET']);
    }
  });

  it('keeps the komorebi origin credentialed on the read routes', async () => {
    const h = await actual('GET', '/api/presets/1', KOMOREBI);
    expect(h.get('Access-Control-Allow-Origin')).toBe(KOMOREBI);
    expect(h.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it.each(['GET /api/presets', 'GET /api/playlists', 'GET /api/me', 'GET /api/export', 'POST /api/presets/1/versions', 'PUT /api/playlists/1/items'])(
    'grants other origins nothing on %s',
    async (route) => {
      const [method, path] = route.split(' ');
      expect((await actual(method, path, 'https://evil.example')).get('Access-Control-Allow-Origin')).toBeNull();
      expect((await preflight(path, 'https://evil.example', method)).get('Access-Control-Allow-Origin')).toBeNull();
    },
  );

  it('also reaches a 415, so the editor can read the refusal', async () => {
    const res = await createApp().request(
      '/api/presets',
      { method: 'POST', headers: { Origin: KOMOREBI, 'Content-Type': 'text/plain' }, body: 'x' },
      env,
    );
    expect(res.status).toBe(415);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(KOMOREBI);
  });
});

describe('every /api route goes through authorize', () => {
  it('has a declared policy for each registered route except /api/health', () => {
    const app = createApp();
    const routes = app.routes.filter((r) => r.path.startsWith('/api') && r.method !== 'ALL');
    expect(routes.length).toBeGreaterThan(10);
    const unguarded = routes
      .filter((r) => r.path !== '/api/health')
      .filter((r) => !policies.has(`${r.method} ${r.path}`))
      .map((r) => `${r.method} ${r.path}`);
    expect(unguarded).toEqual([]);
  });

  it('would catch a route registered around the helper', () => {
    const app = createApp();
    app.get('/api/sneaky', (c) => c.json({}));
    const sneaky = app.routes.filter((r) => r.path.startsWith('/api') && r.method !== 'ALL' && !policies.has(`${r.method} ${r.path}`) && r.path !== '/api/health');
    expect(sneaky.map((r) => r.path)).toEqual(['/api/sneaky']);
  });
});

describe('via', () => {
  const token = { userId: 1, username: 'u', kind: 'token', scope: 'write', label: 'studio laptop claude' } as const;
  const session = { userId: 1, username: 'u', kind: 'session' } as const;

  it('is token:<label> for a token', () => {
    expect(viaFor(token, null)).toBe('token:studio laptop claude');
    expect(viaFor(token, 'https://komorebi.eljojo.net')).toBe('token:studio laptop claude');
  });

  it('is editor for a session from the komorebi origin and web otherwise', () => {
    expect(viaFor(session, 'https://komorebi.eljojo.net')).toBe('editor');
    expect(viaFor(session, 'http://localhost:8000')).toBe('web');
    expect(viaFor(session, 'http://localhost:8001')).toBe('web');
    expect(viaFor(session, null)).toBe('web');
    expect(viaFor(session, 'https://arboretum.eljojo.net')).toBe('web');
    expect(viaFor(session, 'https://komorebi.eljojo.net.evil.example')).toBe('web');
  });
});

describe('the request body cap', () => {
  const MAX = 64 * 1024;

  it('refuses a body over 64 KB with a 413 from its Content-Length, before reading it', async () => {
    const u = await makeUser();
    const r = await call('POST', '/api/presets', { token: await makeToken(u), body: JSON.stringify({ pad: 'x'.repeat(MAX) }) });
    expect(r.status).toBe(413);
    expect(r.json).toEqual({ error: expect.any(String) });
  });

  it('refuses one that lies about or omits its length, stopping the read at the limit', async () => {
    const u = await makeUser();
    const chunk = new TextEncoder().encode('x'.repeat(8 * 1024));
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        sent += chunk.length;
        controller.enqueue(chunk);
        if (sent > 4 * MAX) controller.close();
      },
    });
    const res = await exports.default.fetch(
      new Request('https://arboretum.test/api/presets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await makeToken(u)}`, 'Content-Type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(4 * MAX);
  });

  it('lets a body just under it through to the next check', async () => {
    const u = await makeUser();
    const r = await call('POST', '/api/presets', { token: await makeToken(u), body: JSON.stringify({ pad: 'x'.repeat(MAX - 100) }) });
    expect(r.status).not.toBe(413);
  });

  it('gives a 413 the CORS headers, so the editor can read it', async () => {
    const res = await createApp().request(
      '/api/presets',
      { method: 'POST', headers: { Origin: 'https://komorebi.eljojo.net', 'Content-Type': 'application/json' }, body: 'x'.repeat(MAX + 1) },
      env,
    );
    expect(res.status).toBe(413);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://komorebi.eljojo.net');
  });
});
