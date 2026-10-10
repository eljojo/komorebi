import { describe, expect, it } from 'vitest';
import { baseFrom } from '../public/js/base.js';
import { BASE } from '../src/config';

const modules = import.meta.glob('../public/js/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

// The browser modules cannot import config.ts, so they learn the prefix from where they were served from.
describe('public/js finds the base path from its own URL', () => {
  it.each([
    ['https://komorebi.eljojo.net/arboretum/js/base.js', '/arboretum'],
    ['https://localhost:8787/arboretum/js/base.js', '/arboretum'],
    ['https://example.test/some/where/js/base.js', '/some/where'],
    ['https://example.test/js/base.js', ''],
  ])('%s is %j', (url, base) => {
    expect(baseFrom(url)).toBe(base);
  });

  it('agrees with the constant the pages are rendered with, where the pages put their scripts', () => {
    expect(baseFrom(`https://komorebi.eljojo.net${BASE}/js/base.js`)).toBe(BASE);
  });
});

describe('no module names an absolute arboretum path of its own', () => {
  it('sees the modules', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(10);
  });

  it.each(Object.entries(modules))('%s', (_file, source) => {
    const code = source.replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/['"`]\/(p\/|l\/|u\/|login|new|settings|js\/|vendor\/|engine\/|arboretum)/g) ?? []).toEqual([]);
    expect(code.match(/assign\((['"`])\/\1\)/g) ?? []).toEqual([]);
  });
});
