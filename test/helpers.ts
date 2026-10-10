import { env, exports } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { SESSION_MS } from '../src/config';
import { presetVersions, presets, sessions, users } from '../src/db/schema';
import { randomBase64Url } from '../src/random';
import { mintToken, sha256Hex } from '../src/tokens';

export const db = drizzle(env.DB);

// Storage is shared inside a test file, so every test makes its own people.
const run = crypto.randomUUID().slice(0, 8);
let seq = 0;

export async function makeUser(prefix = 'user') {
  const username = `${prefix}-${run}-${++seq}`;
  const [u] = await db.insert(users).values({ username, createdAt: Date.now() }).returning();
  return u;
}

export async function makeToken(user: { id: number }, opts: { scope?: 'read' | 'write'; label?: string } = {}) {
  const { token } = await mintToken(db, user.id, opts.label ?? 'test laptop', opts.scope ?? 'write');
  return token;
}

export type CallOpts = {
  token?: string;
  json?: unknown;
  // The body exactly as sent; wins over `json`.
  body?: string;
  headers?: Record<string, string>;
};

export type Reply = { status: number; headers: Headers; json: any; text: string };

export async function reply(res: Response): Promise<Reply> {
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, json, text };
}

export function request(method: string, path: string, opts: CallOpts = {}): Request {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`);
  const body = opts.body ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined);
  // Writes must be JSON (the CSRF guard); a test that wants another type sets it in `headers`.
  if (method !== 'GET' && method !== 'HEAD' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(`https://arboretum.test${path}`, { method, headers, body: body ?? (method === 'GET' ? undefined : '{}') });
}

export async function call(method: string, path: string, opts: CallOpts = {}): Promise<Reply> {
  return reply(await exports.default.fetch(request(method, path, opts)));
}

export const get = (path: string, token?: string) => call('GET', path, { token });

export const PARAMS = { tree_count: 3, eclipse: false, tree_species: 'oak' };

// A person's browser: a cookie jar and an address, talking to the real app. The jar keeps what Set-Cookie says
// and drops what it deletes, as a browser would.
let ipSeq = 0;
export class Browser {
  jar = new Map<string, string>();
  ip = `10.${(++ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;

  async call(method: string, path: string, opts: CallOpts = {}): Promise<Reply> {
    const headers: Record<string, string> = { 'CF-Connecting-IP': this.ip, ...opts.headers };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await exports.default.fetch(request(method, path, { ...opts, headers }));
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((p) => p.trim());
      const [name, ...value] = pair.split('=');
      const gone = attrs.some((a) => /^max-age=0$/i.test(a)) || value.join('=') === '';
      if (gone) this.jar.delete(name);
      else this.jar.set(name, value.join('='));
    }
    return reply(res);
  }
}

// A real session for a user made directly in the database, for tests that are about something else than signing in.
export async function sessionFor(user: { id: number }) {
  const token = randomBase64Url(32);
  const now = Date.now();
  await db.insert(sessions).values({ tokenHash: await sha256Hex(token), userId: user.id, createdAt: now, expiresAt: now + SESSION_MS });
  return token;
}

export async function asSession(user: { id: number }, method: string, path: string, opts: CallOpts = {}): Promise<Reply> {
  const headers = { ...opts.headers, Cookie: `__Host-session=${await sessionFor(user)}` };
  return call(method, path, { ...opts, headers });
}

type PresetOpts = { visibility?: 'public' | 'unlisted' | 'private'; archived?: boolean } & Record<string, unknown>;

// Made through the API (as a token would), then given the visibility and archive state a person would set.
export async function makePreset(owner: { id: number }, token: string, opts: PresetOpts = {}) {
  const { visibility, archived, ...fields } = opts;
  const r = await call('POST', '/api/presets', { token, json: { name: 'a look', params: PARAMS, ...fields } });
  if (r.status !== 201) throw new Error(`makePreset: ${r.status} ${r.text}`);
  const patch: Partial<typeof presets.$inferInsert> = {};
  if (visibility) patch.visibility = visibility;
  if (archived) patch.archivedAt = Date.now();
  if (Object.keys(patch).length) await db.update(presets).set(patch).where(eq(presets.id, r.json.id));
  return r.json as { id: number; share_token: string };
}

// Bulk rows for the quota tests, in one statement each (D1 caps bound parameters per query at 100).
export async function fillPresets(ownerId: number, count: number) {
  await env.DB.prepare(
    `INSERT INTO presets (owner_id, visibility, share_token, created_at, updated_at)
     WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ?1)
     SELECT ?2, 'private', 'fill-' || ?2 || '-' || i, 0, 0 FROM s`,
  )
    .bind(count, ownerId)
    .run();
}

export async function fillVersions(presetId: number, count: number, createdAt: number, startAt: number) {
  await env.DB.prepare(
    `INSERT INTO preset_versions (preset_id, n, name, tags, params, via, created_at)
     WITH RECURSIVE s(i) AS (SELECT ?3 UNION ALL SELECT i + 1 FROM s WHERE i < ?3 + ?1 - 1)
     SELECT ?2, i, 'filler', '[]', '{}', 'web', ?4 FROM s`,
  )
    .bind(count, presetId, startAt, createdAt)
    .run();
}

export async function presetCount(ownerId: number) {
  return (await env.DB.prepare('SELECT count(*) AS n FROM presets WHERE owner_id = ?').bind(ownerId).first<{ n: number }>())!.n;
}

export async function storedParams(presetId: number, n: number) {
  const [row] = await db
    .select({ params: presetVersions.params })
    .from(presetVersions)
    .where(and(eq(presetVersions.presetId, presetId), eq(presetVersions.n, n)));
  return row.params;
}

export async function fillPlaylists(ownerId: number, count: number) {
  await env.DB.prepare(
    `INSERT INTO playlists (owner_id, name, visibility, share_token, created_at, updated_at)
     WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ?1)
     SELECT ?2, 'filler', 'private', 'fill-pl-' || ?2 || '-' || i, 0, 0 FROM s`,
  )
    .bind(count, ownerId)
    .run();
}

// A playlist through the API, then given the visibility a person would set.
export async function makePlaylist(token: string, opts: { visibility?: 'public' | 'unlisted' | 'private'; items?: unknown[]; name?: string } = {}) {
  const r = await call('POST', '/api/playlists', { token, json: { name: opts.name ?? 'a list' } });
  if (r.status !== 201) throw new Error(`makePlaylist: ${r.status} ${r.text}`);
  if (opts.items) {
    const put = await call('PUT', `/api/playlists/${r.json.id}/items`, { token, json: { items: opts.items } });
    if (put.status !== 200) throw new Error(`makePlaylist items: ${put.status} ${put.text}`);
  }
  if (opts.visibility) await env.DB.prepare('UPDATE playlists SET visibility = ? WHERE id = ?').bind(opts.visibility, r.json.id).run();
  return r.json as { id: number; share_token: string };
}
