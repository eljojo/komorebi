// Who is asking, and whether they may (spec §3). Every /api route is registered through `secured`, which runs
// `authorize` first, so a route cannot forget to ask.
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { BASE } from './config';
import { connect } from './db/client';
import { apiTokens, sessions, users } from './db/schema';
import { ApiError } from './errors';
import { SESSION_COOKIE } from './session';
import { sha256Hex } from './tokens';

export type TokenActor = { userId: number; username: string; kind: 'token'; scope: 'read' | 'write'; label: string };
export type SessionActor = { userId: number; username: string; kind: 'session' };
export type Actor = TokenActor | SessionActor;

export type AppEnv = { Bindings: Cloudflare.Env; Variables: { resolvers: Resolver[] } };
export type Ctx = Context<AppEnv>;

// One way of recognising a caller.
export type Resolver = (c: Ctx) => Promise<Actor | null>;

export const bearerToken: Resolver = async (c) => {
  const match = /^bearer (\S+)$/i.exec(c.req.header('Authorization') ?? '');
  if (!match) return null;
  const db = connect(c.env.DB);
  const [row] = await db
    .select({ tokenId: apiTokens.id, userId: users.id, username: users.username, scope: apiTokens.scope, label: apiTokens.label })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, await sha256Hex(match[1])), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: Date.now() }).where(eq(apiTokens.id, row.tokenId));
  return { userId: row.userId, username: row.username, kind: 'token', scope: row.scope, label: row.label };
};

// A bearer header, whether or not its token works, means the caller chose to be a token: a cookie riding along
// is not consulted, so a bad token is a 401 rather than a quiet fallback to the browser's login.
export const sessionCookie: Resolver = async (c) => {
  if (/^bearer /i.test(c.req.header('Authorization') ?? '')) return null;
  const value = getCookie(c, SESSION_COOKIE, 'host');
  if (!value) return null;
  const [row] = await connect(c.env.DB)
    .select({ userId: users.id, username: users.username })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, await sha256Hex(value)), gt(sessions.expiresAt, Date.now())));
  return row ? { ...row, kind: 'session' } : null;
};

async function getActor(c: Ctx): Promise<Actor | null> {
  for (const resolve of c.var.resolvers) {
    const actor = await resolve(c);
    if (actor) return actor;
  }
  return null;
}

// anonymous: may be nobody · read: any actor · write: a session, or a token with write scope · session: a person in a browser
export type Policy = 'anonymous' | 'read' | 'write' | 'session';
export type ActorFor<P extends Policy> = P extends 'anonymous' ? Actor | null : P extends 'session' ? SessionActor : Actor;

export async function authorize<P extends Policy>(c: Ctx, policy: P): Promise<ActorFor<P>> {
  const actor = await getActor(c);
  if (policy === 'anonymous') return actor as ActorFor<P>;
  if (!actor) throw new ApiError(401, 'sign in, or send a bearer token');
  if (policy === 'session' && actor.kind !== 'session') {
    throw new ApiError(403, 'this needs a person signed in in a browser; a token cannot do it');
  }
  if (policy === 'write' && actor.kind === 'token' && actor.scope !== 'write') {
    throw new ApiError(403, 'this token is read-only');
  }
  return actor as ActorFor<P>;
}

// The routes' declared policies, keyed `METHOD path`; a test compares it with the router's own table.
export const policies = new Map<string, Policy>();

export function secured<P extends Policy>(
  app: Hono<AppEnv>,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  policy: P,
  handler: (c: Ctx, actor: ActorFor<P>) => Response | Promise<Response>,
) {
  policies.set(`${method} ${path}`, policy);
  app.on(method, path, async (c) => handler(c, await authorize(c, policy)));
}

// How a new version arrived (spec §3.3). History only: nothing is allowed or refused by it. The editor and
// arboretum are one origin, so a session's source is read off the page that sent the request: a Referer inside
// BASE is a page of arboretum's own, anything else (komorebi's editor at the root, or no Referer) is the editor.
export function viaFor(actor: Actor, referer: string | null): string {
  if (actor.kind === 'token') return `token:${actor.label}`;
  let path: string | null = null;
  try {
    if (referer !== null) path = new URL(referer).pathname;
  } catch {}
  return path !== null && (path === BASE || path.startsWith(`${BASE}/`)) ? 'web' : 'editor';
}
