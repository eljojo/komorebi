import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { registerAuth } from './api/auth';
import { registerMe } from './api/me';
import { registerExport } from './api/export';
import { registerPlaylists } from './api/playlists';
import { registerPresets } from './api/presets';
import { registerRemote } from './api/remote';
import { registerTokens } from './api/tokens';
import { registerPages } from './pages';
import { type AppEnv, type Resolver, bearerToken, sessionCookie } from './auth';
import { BASE, KOMOREBI_ORIGIN, LEGACY_HOST, MAX_BODY_BYTES } from './config';
import { ApiError } from './errors';
import { ENGINE_COMMIT } from './generated/engine';

// What any editor on any host may read: one look (head or a version) and one playlist, the things a link names.
// Listings, `me` and every write are the same-origin pages' and tokens' alone: no other origin gets a CORS grant.
const READ_ROUTES: RegExp[] = [/^\/api\/presets\/[^/]+(\/versions(\/[^/]+)?)?$/, /^\/api\/playlists\/[^/]+$/];

const HARDENING_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

// `resolvers` is how a caller is recognised, in order: a bearer token wins over the session cookie.
export function createApp(resolvers: Resolver[] = [bearerToken, sessionCookie]) {
  // Not strict: `/arboretum/` is the same page as `/arboretum`, as a static site would answer it.
  const app = new Hono<AppEnv>({ strict: false });

  // `/` is komorebi's own index.html, a static asset that run_worker_first (wrangler.jsonc) routes here so the old
  // host can be redirected. On the site it is handed straight back to the assets, before the hardening below: it is
  // komorebi's page, and answers as the static site always did.
  app.use('*', async (c, next) => {
    if (c.req.path === '/' && new URL(c.req.url).hostname !== LEGACY_HOST) return c.env.ASSETS.fetch(c.req.raw);
    await next();
  });

  app.use('*', async (c, next) => {
    c.set('resolvers', resolvers);
    await next();
  });

  // Everything the Worker answers: no framing (a same-site sibling could otherwise steer a signed-in person's
  // clicks on publish, archive or revoke), no sniffing, and nothing cached, since pages, the export and a freshly
  // minted token are private. Static assets never reach the Worker, so this does not slow them.
  app.use('*', async (c, next) => {
    await next();
    if (c.res.status === 101) return;   // the remote's socket (src/remote.ts): the room's answer, whose headers are not ours to change
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) c.res.headers.set(name, value);
  });

  // While arboretum.eljojo.net stays attached, only its /api answers; every other path is the same path under BASE on
  // the one site (a 301 turns any write into a GET, which is fine: nothing writes through a page, only through /api).
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.hostname !== LEGACY_HOST || url.pathname.startsWith('/api/')) return next();
    return c.redirect(`${KOMOREBI_ORIGIN}${BASE}${url.pathname === '/' ? '' : url.pathname}${url.search}`, 301);
  });

  // The anonymous read grant, and the only CORS there is: the editor and arboretum are one origin, so nothing of the
  // session's needs a cross-origin answer. `*` and no credentials, so a browser never hands a page a credentialed
  // answer through it, and what another host reads is what an anonymous visitor may see (José: "any editor would be
  // able to load presets from arboretum if the browser allowed the ajax request").
  const readCors = cors({ origin: '*', allowMethods: ['GET'] });
  app.use('/api/*', (c, next) => {
    const method = c.req.method === 'OPTIONS' ? c.req.header('Access-Control-Request-Method') : c.req.method;
    return method === 'GET' && READ_ROUTES.some((path) => path.test(c.req.path)) ? readCors(c, next) : next();
  });

  // A params object is at most 16 KB (spec §5), so nothing legitimate comes near this. Hono checks Content-Length
  // and also stops a stream that outgrows it.
  app.use(
    '/api/*',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: `a request body is at most ${MAX_BODY_BYTES / 1024} KB` }, 413) }),
  );

  // The CSRF guard (spec §3.2): a cross-origin form post (always a "simple" content type) is the one write that
  // needs no preflight, and this refuses it before anything else runs.
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
  registerRemote(app);
  registerPages(app);

  return app;
}

export { RemoteRoom } from './remote';

export default createApp();
