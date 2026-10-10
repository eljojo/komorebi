import { describe, expect, it } from 'vitest';
import doc from '../public/llms.txt?raw';
import { createApp } from '../src';
import { policies } from '../src/auth';

// llms.txt is how an agent learns the API (José, 2026-10-09), so it must not fall behind the routes.
describe('llms.txt', () => {
  it('names every API route an agent or the editor can reach', () => {
    createApp();
    const routes = [...policies.keys()].filter((r) => !r.includes('/api/auth/'));
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(doc, route).toContain(route);
  });

  it('tells an agent where its token comes from and never to print it', () => {
    expect(doc).toContain('ARBORETUM_TOKEN');
    expect(doc).toMatch(/never print/i);
  });

  it('tells an agent that numbers stay within the editor\'s slider ranges, with leeway, and that a refusal names the range', () => {
    expect(doc).toMatch(/slider ranges/);
    expect(doc).toMatch(/quarter of each range/);
    expect(doc).toMatch(/out_of_range/);
  });
});
