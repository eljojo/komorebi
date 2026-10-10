import { describe, expect, it } from 'vitest';
import { asSession, get, makePlaylist, makePreset, makeToken, makeUser } from './helpers';

// Arboretum is a part of komorebi: every page carries komorebi's own links, and no page has a name of its own.
async function pages() {
  const user = await makeUser('walker');
  const token = await makeToken(user);
  const p = await makePreset(user, token, { visibility: 'public' });
  const l = await makePlaylist(token, { visibility: 'public', items: [{ preset_id: p.id }] });
  return [
    ['front', '/arboretum'],
    ['login', '/arboretum/login'],
    ['profile', `/arboretum/u/${user.username}`],
    ['look', `/arboretum/p/${p.id}`],
    ['history', `/arboretum/p/${p.id}/history`],
    ['version', `/arboretum/p/${p.id}/v/1`],
    ['playlist', `/arboretum/l/${l.id}`],
    ['not found', '/arboretum/p/999999'],
  ] as const;
}

const NAV = [
  'href="/"',
  'href="/arboretum"',
  'href="/about"',
];

describe('every page carries komorebi’s links', () => {
  it('signed out, on every page type', async () => {
    for (const [name, path] of await pages()) {
      const r = await get(path);
      // José, 2026-10-10: on arboretum's own front page, its link and the pill are redundant; the komorebi name leads home.
      const front = name === 'front';
      for (const part of NAV) if (!(front && part === 'href="/arboretum"')) expect(r.text, `${path} ${part}`).toContain(part);
      expect(r.text, path).toMatch(/<a[^>]*href="\/"[^>]*>komorebi<\/a>/);
      expect(r.text, path).toContain('href="/arboretum/login"');
      expect(r.text, path).not.toContain('player.html');
      expect(r.text.match(/>open komorebi</g)?.length ?? 0, path).toBe(front ? 0 : 1);
      if (front) expect(r.text, path).not.toContain('href="/arboretum"');
      else expect(r.text, path).toMatch(/<a[^>]*href="\/#feel"[^>]*>open komorebi<\/a>/);
      expect(r.text, path).toMatch(/<title>[^<]* · komorebi<\/title>/);
      expect(r.text, path).not.toContain('· arboretum</title>');
    }
  });

  it('signed in, on the account pages too', async () => {
    const user = await makeUser('walker');
    for (const path of ['/arboretum', '/arboretum/new', '/arboretum/settings']) {
      const r = await asSession(user, 'GET', path);
      expect(r.status, path).toBe(200);
      const front = path === '/arboretum';
      for (const part of NAV) if (!(front && part === 'href="/arboretum"')) expect(r.text, `${path} ${part}`).toContain(part);
      if (front) expect(r.text, path).not.toContain('>open komorebi<');
      else expect(r.text, path).toMatch(/<a[^>]*href="\/#feel"[^>]*>open komorebi<\/a>/);
      expect(r.text, path).toContain('href="/arboretum/new"');
      expect(r.text, path).toContain('href="/arboretum/settings"');
      expect(r.text, path).toContain(`href="/arboretum/u/${user.username}"`);
    }
  });

  it('has no background light: no light script, and a canvas only where a look is highlighted (the garden’s player, a look, a playlist)', async () => {
    const all = await pages();
    for (const [name, path] of all) {
      const r = await get(path);
      expect(r.text, path).not.toContain('light.js');
      expect(r.text, path).not.toContain('id="light"');
      const canvases = r.text.match(/<canvas/g)?.length ?? 0;
      expect(canvases, path).toBe(['front', 'look', 'version', 'playlist'].includes(name) ? 1 : 0);
    }
  });
});
