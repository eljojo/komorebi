import { exports } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { ENGINE_COMMIT } from '../src/generated/engine';

it('GET /api/health reports the engine commit', async () => {
  const res = await exports.default.fetch('https://arboretum.test/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, engine: ENGINE_COMMIT });
});
