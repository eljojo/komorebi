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
      expect(r.text.match(/>open komorebi</g)?.length ?? 0, path).toBe(1);
      expect(r.text.match(/href="\/about"/g)?.length ?? 0, path).toBe(1);
      expect(r.text, path).toMatch(/<a[^>]*href="\/#feel"[^>]*>open komorebi<\/a>/);
      if (front) expect(r.text, path).not.toContain('href="/arboretum"');
      // José, 2026-10-10: "about" is never in the head; it closes every page (the home's closing carries it with the pill).
      // The pill closes the home and stays in the head everywhere else.
      const head = r.text.slice(r.text.indexOf('<header>'), r.text.indexOf('</header>'));
      expect(head.includes('href="/about"'), `${path} about in the head`).toBe(false);
      expect(head.includes('>open komorebi<'), `${path} pill in the head`).toBe(!front);
      if (!front) expect(r.text.indexOf('href="/about"'), `${path} about after main`).toBeGreaterThan(r.text.indexOf('</main>'));
      expect(r.text, path).toMatch(/<title>[^<]* · komorebi<\/title>/);
      // komorebi's own module, from the site root (not under BASE): every page breathes out before it navigates away.
      expect(r.text, path).toContain('<script type="module" src="/breathe.js"></script>');
      expect(r.text, path).not.toContain('· arboretum</title>');
      expect(r.text.match(/\/breathe\.js/g)?.length ?? 0, path).toBe(1);
    }
  });

  it('signed in, on the account pages too', async () => {
    const user = await makeUser('walker');
    for (const path of ['/arboretum', '/arboretum/new', '/arboretum/settings']) {
      const r = await asSession(user, 'GET', path);
      expect(r.status, path).toBe(200);
      const front = path === '/arboretum';
      for (const part of NAV) if (!(front && part === 'href="/arboretum"')) expect(r.text, `${path} ${part}`).toContain(part);
      expect(r.text, path).toMatch(/<a[^>]*href="\/#feel"[^>]*>open komorebi<\/a>/);
      expect(r.text, path).toContain('<script type="module" src="/breathe.js"></script>');
      expect(r.text, path).toContain('href="/arboretum/new"');
      expect(r.text, path).toContain('href="/arboretum/settings"');
      expect(r.text, path).toContain(`href="/arboretum/u/${user.username}"`);
    }
  });

  it('closes the home with "about" and the pill, after the last section and outside the head', async () => {
    const { text } = await get('/arboretum');
    const lastHeading = text.lastIndexOf('<h2');
    const afterHead = text.slice(text.indexOf('</header>'));
    expect(lastHeading).toBeGreaterThan(-1);
    expect(text.indexOf('href="/about"')).toBeGreaterThan(lastHeading);
    expect(text.indexOf('>open komorebi<')).toBeGreaterThan(lastHeading);
    expect(afterHead).toContain('href="/about"');
    expect(afterHead).toMatch(/<a[^>]*class="feel"[^>]*href="\/#feel"[^>]*>open komorebi<\/a>/);
    // the head keeps the name and the session links
    const head = text.slice(text.indexOf('<header>'), text.indexOf('</header>'));
    expect(head).toContain('href="/arboretum/login"');
    expect(head).toMatch(/<a[^>]*href="\/"[^>]*>komorebi<\/a>/);
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
