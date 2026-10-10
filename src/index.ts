import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { registerMe } from './api/me';
import { registerExport } from './api/export';
import { registerPlaylists } from './api/playlists';
import { registerPresets } from './api/presets';
import { type AppEnv, type Resolver, bearerToken } from './auth';
import { CORS_ORIGINS } from './config';
import { ApiError } from './errors';
import { ENGINE_COMMIT } from './generated/engine';

// `resolvers` is how a caller is recognised; brief 03 adds the session cookie to the default.
export function createApp(resolvers: Resolver[] = [bearerToken]) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('resolvers', resolvers);
    await next();
  });

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (CORS_ORIGINS.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // The CSRF guard (spec §3.2): with CORS granted to one origin, a cross-origin form post (always a "simple"
  // content type) is the only write left that needs no preflight, and this refuses it before anything else runs.
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const type = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') throw new ApiError(415, 'writes must be sent as application/json');
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.message, ...err.details }, err.status);
    console.error(err);
    return c.json({ error: 'something went wrong on our side' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not found' }, 404));

  app.get('/api/health', (c) => c.json({ ok: true, engine: ENGINE_COMMIT }));
  registerMe(app);
  registerPresets(app);
  registerPlaylists(app);
  registerExport(app);

  return app;
}

export default createApp();
