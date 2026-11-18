import type { Hono } from 'hono';
import { type AppEnv, secured } from '../auth';
import { ApiError } from '../errors';
import { MAX_LABEL, SCREEN_ID } from '../remote';

// The remote's socket (src/remote.ts): a person in a browser, into their own room. A WebSocket upgrade carries the session
// cookie and no preflight, so another site could open one in a signed-in person's browser; the Origin is checked here, and only
// the site's own pages may connect (the editor at the root, the remote under BASE, one origin). It is held to the request's own
// origin, not to ORIGIN: `wrangler dev` rewrites the URL and the Origin header from localhost to the route's host before the
// Worker sees them, so in dev the two agree with each other and never with ORIGIN (a foreign Origin is left as it was).
export function registerRemote(app: Hono<AppEnv>) {
  secured(app, 'GET', '/api/remote', 'session', async (c, actor) => {
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') throw new ApiError(400, 'this is a WebSocket: connect with Upgrade: websocket');
    if (c.req.header('Origin') !== new URL(c.req.url).origin) throw new ApiError(403, 'the remote connects only from this site’s own pages');
    const role = c.req.query('role');
    if (role !== 'screen' && role !== 'remote') throw new ApiError(400, 'role is screen or remote');
    const headers = new Headers(c.req.raw.headers);
    headers.set('X-Remote-Role', role);
    if (role === 'screen') {
      const screen = c.req.query('screen') ?? '';
      if (!SCREEN_ID.test(screen)) throw new ApiError(400, 'a screen names itself: 8 to 64 letters, digits, - or _');
      headers.set('X-Remote-Screen', screen);
      headers.set('X-Remote-Label', (c.req.query('label') ?? '').slice(0, MAX_LABEL));
    }
    const room = c.env.REMOTE.get(c.env.REMOTE.idFromName(`user:${actor.userId}`));
    return room.fetch(new Request(c.req.url, { headers }));
  });
}
