import { describe, expect, it } from 'vitest';
import { call, get, makePreset, makeToken, makeUser } from './helpers';

// What the Worker itself answers with, pages and /api alike (static assets are served before the Worker runs).
const HARDENING = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
};

describe('hardening headers on every response the Worker generates', () => {
  it.each([
    ['the front page', () => get('/arboretum')],
    ['the sign-in page', () => get('/arboretum/login')],
    ['a missing page', () => get('/nowhere')],
    ['an API read', () => get('/api/health')],
    ['an API refusal', () => get('/api/me')],
    ['an API 404', () => get('/api/nowhere')],
    ['a write refused for its content type', () => call('POST', '/api/presets', { headers: { 'Content-Type': 'text/plain' } })],
    ['a preflight', () => call('OPTIONS', '/api/presets', { headers: { Origin: 'https://komorebi.eljojo.net', 'Access-Control-Request-Method': 'GET' } })],
  ])('%s', async (_name, fetch) => {
    const r = await fetch();
    for (const [name, value] of Object.entries(HARDENING)) expect(r.headers.get(name), name).toBe(value);
  });

  it('also covers a private preset page and the export', async () => {
    const user = await makeUser();
    const token = await makeToken(user);
    const preset = await makePreset(user, token);
    for (const path of [`/arboretum/p/${preset.id}`, '/api/export']) {
      const r = await call('GET', path, { token });
      for (const [name, value] of Object.entries(HARDENING)) expect(r.headers.get(name), `${path} ${name}`).toBe(value);
    }
  });

  it('keeps the CORS headers on a read route', async () => {
    const r = await call('GET', '/api/presets/1', { headers: { Origin: 'https://komorebi.eljojo.net' } });
    expect(r.headers.get('cache-control')).toBe('no-store');
    const p = await call('OPTIONS', '/api/presets/1', { headers: { Origin: 'https://komorebi.eljojo.net', 'Access-Control-Request-Method': 'GET' } });
    expect(p.headers.get('access-control-allow-origin')).toBe('*');
  });
});
