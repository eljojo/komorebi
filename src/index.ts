import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { registerAuth } from './api/auth';
import { registerMe } from './api/me';
import { registerExport } from './api/export';
import { registerPlaylists } from './api/playlists';
import { registerPresets } from './api/presets';
import { registerTokens } from './api/tokens';
import { registerPages } from './pages';
import { type AppEnv, type Resolver, bearerToken, sessionCookie } from './auth';
import { CORS_ORIGINS, MAX_BODY_BYTES } from './config';
import { ApiError } from './errors';
import { ENGINE_COMMIT } from './generated/engine';

const EDITOR_ROUTES: [string, RegExp][] = [
  ['GET', /^\/api\/me$/],
  ['GET', /^\/api\/presets$/],
  ['POST', /^\/api\/presets$/],
  ['GET', /^\/api\/presets\/[^/]+(\/versions(\/[^/]+)?)?$/],
  ['POST', /^\/api\/presets\/[^/]+\/versions$/],
  ['GET', /^\/api\/playlists(\/[^/]+)?$/],
  ['POST', /^\/api\/playlists$/],
  ['PUT', /^\/api\/playlists\/[^/]+\/items$/],
];

const HARDENING_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

// `resolvers` is how a caller is recognised, in order: a bearer token wins over the session cookie.
export function createApp(resolvers: Resolver[] = [bearerToken, sessionCookie]) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('resolvers', resolvers);
    await next();
  });

  // Everything the Worker answers: no framing (a same-site sibling could otherwise steer a signed-in person's
  // clicks on publish, archive or revoke), no sniffing, and nothing cached, since pages, the export and a freshly
  // minted token are private. Static assets never reach the Worker, so this does not slow them.
  app.use('*', async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) c.res.headers.set(name, value);
  });

  // Credentialed CORS goes only to the routes the editor uses (spec §8). Everywhere else a script running on the
  // editor's origin gets no answer it may read, so it cannot mint a token, publish a look or read the export.
  // A preflight names the method it is for, so that decides which route it is asking about. It advertises only the
  // methods this path grants the editor, because the browser caches every method a preflight lists.
  const editorCors = cors({
    origin: (origin) => (CORS_ORIGINS.includes(origin) ? origin : null),
    credentials: true,
    allowMethods: (_origin, c) => EDITOR_ROUTES.filter(([, path]) => path.test(c.req.path)).map(([m]) => m),
    allowHeaders: ['Content-Type', 'Authorization'],
  });
  app.use('/api/*', (c, next) => {
    const method = c.req.method === 'OPTIONS' ? c.req.header('Access-Control-Request-Method') : c.req.method;
    return EDITOR_ROUTES.some(([m, path]) => m === method && path.test(c.req.path)) ? editorCors(c, next) : next();
  });

  // A params object is at most 16 KB (spec §5), so nothing legitimate comes near this. Hono checks Content-Length
  // and also stops a stream that outgrows it.
  app.use(
    '/api/*',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: `a request body is at most ${MAX_BODY_BYTES / 1024} KB` }, 413) }),
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
  registerAuth(app);
  registerTokens(app);
  registerPages(app);

  return app;
}

export default createApp();
