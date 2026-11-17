import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type AppEnv, secured } from '../auth';
import { connect } from '../db/client';
import { apiTokens } from '../db/schema';
import { ApiError } from '../errors';
import { mintToken } from '../tokens';
import { parseId, readJsonBody } from './util';

// Minting and revoking are a person's acts: a token can never reach these (spec §3.3).
export function registerTokens(app: Hono<AppEnv>) {
  secured(app, 'POST', '/api/tokens', 'session', async (c, actor) => {
    const { body } = await readJsonBody(c);
    if (typeof body.label !== 'string') throw new ApiError(400, 'label is required');
    if (body.scope !== 'read' && body.scope !== 'write') throw new ApiError(400, 'scope must be read or write');
    const { id, token } = await mintToken(connect(c.env.DB), actor.userId, body.label, body.scope);
    return c.json({ id, label: body.label, scope: body.scope, token }, 201);
  });

  secured(app, 'GET', '/api/tokens', 'session', async (c, actor) => {
    const rows = await connect(c.env.DB)
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, actor.userId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.id));
    return c.json({ tokens: rows.map((t) => ({ id: t.id, label: t.label, scope: t.scope, created_at: t.createdAt, last_used_at: t.lastUsedAt })) });
  });

  secured(app, 'DELETE', '/api/tokens/:id', 'session', async (c, actor) => {
    const id = parseId(c.req.param('id'));
    const revoked =
      id === null
        ? []
        : await connect(c.env.DB)
            .update(apiTokens)
            .set({ revokedAt: Date.now() })
            .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, actor.userId), isNull(apiTokens.revokedAt)))
            .returning({ id: apiTokens.id });
    if (!revoked.length) throw new ApiError(404, 'not found');
    return c.json({ revoked: id });
  });
}
