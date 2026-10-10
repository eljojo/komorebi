import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import wranglerConfig from '../wrangler.jsonc?raw';
import { createApp } from '../src';

// wrangler.jsonc is JSONC; its comments sit on lines of their own.
const config = JSON.parse(wranglerConfig.replace(/^\s*\/\/.*$/gm, ''));

const OLD = 'https://arboretum.eljojo.net';
const NEW = 'https://komorebi.eljojo.net';

const fetchAt = (url: string, init: RequestInit = {}) => exports.default.fetch(new Request(url, { redirect: 'manual', ...init }));

describe('arboretum.eljojo.net while it is still attached', () => {
  it.each([
    ['/', `${NEW}/arboretum`],
    ['/login', `${NEW}/arboretum/login`],
    ['/p/12', `${NEW}/arboretum/p/12`],
    ['/p/12?k=abc_DEF-1', `${NEW}/arboretum/p/12?k=abc_DEF-1`],
    ['/p/12/v/2?k=abc', `${NEW}/arboretum/p/12/v/2?k=abc`],
    ['/u/some-one', `${NEW}/arboretum/u/some-one`],
    ['/js/api.js', `${NEW}/arboretum/js/api.js`],
    ['/arboretum', `${NEW}/arboretum/arboretum`],
    ['/nowhere', `${NEW}/arboretum/nowhere`],
  ])('moves %s permanently to %s', async (path, location) => {
    const r = await fetchAt(`${OLD}${path}`);
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe(location);
  });

  it('moves a write too, rather than answering it', async () => {
    const r = await fetchAt(`${OLD}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(301);
  });

  it('keeps every /api path answering exactly as before', async () => {
    const health = await fetchAt(`${OLD}/api/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as any).ok).toBe(true);
    const me = await fetchAt(`${OLD}/api/me`);
    expect(me.status).toBe(401);
    const read = await fetchAt(`${OLD}/api/presets/999999`, { headers: { Origin: 'https://elsewhere.example' } });
    expect(read.status).toBe(404);
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('does not take /api-lookalikes for the API', async () => {
    expect((await fetchAt(`${OLD}/apiary`)).status).toBe(301);
  });

  it('puts the hardening headers on the redirect too', async () => {
    expect((await fetchAt(`${OLD}/`)).headers.get('X-Frame-Options')).toBe('DENY');
  });
});

describe('komorebi.eljojo.net', () => {
  // `/` is komorebi's index.html, a static asset; run_worker_first sends it through the Worker (for the old host's
  // redirect) and the Worker hands it straight on, as the site served it before: no hardening headers on it.
  it('answers / from the static assets, untouched', async () => {
    const asked: string[] = [];
    const ASSETS = {
      fetch: async (request: Request) => {
        asked.push(request.url);
        return new Response('komorebi', { headers: { 'Cache-Control': 'public, max-age=600' } });
      },
    };
    const r = await createApp().fetch(new Request(`${NEW}/`), { ...env, ASSETS } as typeof env);
    expect(asked).toEqual([`${NEW}/`]);
    expect(await r.text()).toBe('komorebi');
    expect(r.headers.get('Cache-Control')).toBe('public, max-age=600');
    expect(r.headers.get('X-Frame-Options')).toBeNull();
  });

  it('serves arboretum under /arboretum and the API under /api, without a redirect', async () => {
    const page = await fetchAt(`${NEW}/arboretum`);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect((await fetchAt(`${NEW}/api/health`)).status).toBe(200);
  });
});

describe('wrangler.jsonc', () => {
  it('attaches both hosts as custom domains', () => {
    const hosts = config.routes.map((r: any) => [r.pattern, r.custom_domain]);
    expect(hosts).toEqual([
      ['komorebi.eljojo.net', true],
      ['arboretum.eljojo.net', true],
    ]);
  });

  it('points passkeys at the one origin', () => {
    expect(config.vars).toEqual({ RP_ID: 'komorebi.eljojo.net', ORIGIN: 'https://komorebi.eljojo.net' });
  });

  it('runs the Worker first for / alone, so the rest of the site is served as assets', () => {
    expect(config.assets.run_worker_first).toEqual(['/']);
    expect(config.assets.binding).toBe('ASSETS');
  });
});
