import { afterEach, expect, it, vi } from 'vitest';
import { failure, send } from '../public/js/api.js';

afterEach(() => vi.unstubAllGlobals());

it('returns a visible failure when the network rejects, without retrying a write', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch', fetcher);
  const r = await send('POST', '/api/presets', { name: 'a look' });
  expect(r).toMatchObject({ ok: false, status: 0 });
  expect(failure(r)).toMatch(/unreachable/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['{ incomplete', 'null', '[]'])('does not call a successful but unreadable response a save: %s', async (body) => {
  vi.stubGlobal('fetch', async () => new Response(body, { status: 201 }));
  const r = await send('POST', '/api/tokens', { label: 'laptop', scope: 'write' });
  expect(r.ok).toBe(false);
  expect(failure(r)).toMatch(/check.*retry/i);
});

it('preserves the server refusal and successful JSON bodies', async () => {
  vi.stubGlobal('fetch', async () => new Response('{"error":"that list changed"}', { status: 409 }));
  expect(failure(await send('PUT', '/api/playlists/1/items', {}))).toBe('that list changed');
  vi.stubGlobal('fetch', async () => new Response('{"id":1}', { status: 201 }));
  expect(await send('POST', '/api/presets', {})).toEqual({ ok: true, status: 201, data: { id: 1 } });
});
