// Who is asking, and whether they may (spec §3). Every /api route is registered through `secured`, which runs
// `authorize` first, so a route cannot forget to ask.
import { and, eq, isNull } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { KOMOREBI_ORIGIN } from './config';
import { connect } from './db/client';
import { apiTokens, users } from './db/schema';
import { ApiError } from './errors';
import { sha256Hex } from './tokens';

export type TokenActor = { userId: number; username: string; kind: 'token'; scope: 'read' | 'write'; label: string };
export type SessionActor = { userId: number; username: string; kind: 'session' };
export type Actor = TokenActor | SessionActor;

export type AppEnv = { Bindings: Cloudflare.Env; Variables: { resolvers: Resolver[] } };
export type Ctx = Context<AppEnv>;

// One way of recognising a caller. Brief 03 adds the session cookie as a second one.
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  policy: P,
  handler: (c: Ctx, actor: ActorFor<P>) => Response | Promise<Response>,
) {
  policies.set(`${method} ${path}`, policy);
  app.on(method, path, async (c) => handler(c, await authorize(c, policy)));
}

// How a new version arrived (spec §3.3). Sessions come with brief 03; until then only the token branch runs.
export function viaFor(actor: Actor, origin: string | null): string {
  if (actor.kind === 'token') return `token:${actor.label}`;
  return origin === KOMOREBI_ORIGIN ? 'editor' : 'web';
}
