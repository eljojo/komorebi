import type { Hono } from 'hono';
import { type AppEnv, secured } from '../auth';

export function registerMe(app: Hono<AppEnv>) {
  secured(app, 'GET', '/api/me', 'read', (c, actor) => c.json({ username: actor.username, kind: actor.kind }));
}
