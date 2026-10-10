import { describe, expect, it } from 'vitest';
import engine from '../public/engine/engine.json';
import webauthn from '../node_modules/@simplewebauthn/browser/package.json';
import { WEBAUTHN_BROWSER } from '../src/pages/layout';
import { exports } from 'cloudflare:workers';
import { asSession, call, get, makePlaylist, makePreset, makeToken, makeUser } from './helpers';

async function owner() {
  const user = await makeUser('owner');
  return { user, token: await makeToken(user) };
}

const html = (r: { headers: Headers }) => expect(r.headers.get('Content-Type')).toMatch(/^text\/html/);

describe('the front pages', () => {
  it('/ says what arboretum is and offers a way in, without listing any looks', async () => {
    const o = await owner();
    await makePreset(o.user, o.token, { visibility: 'public', name: 'a quiet afternoon' });
    const r = await get('/');
    expect(r.status).toBe(200);
    html(r);
    expect(r.text).toContain('href="/login"');
    expect(r.text).toContain('href="/signup"');
    expect(r.text).not.toContain('a quiet afternoon');
  });

  it('/signup says plainly that there is no recovery', async () => {
    const r = await get('/signup');
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/no recovery/i);
    expect(r.text).toMatch(/every passkey/i);
    expect(r.text).toContain('name="username"');
  });

  it('/login is one passkey button and no username field', async () => {
    const r = await get('/login');
    expect(r.status).toBe(200);
    expect(r.text).toContain('id="login"');
    expect(r.text).not.toContain('name="username"');
  });

  it('the nav shows who is signed in, and a way in when nobody is', async () => {
    const o = await owner();
    const out = await get('/');
    expect(out.text).not.toContain(`href="/u/${o.user.username}"`);
    const inn = await asSession(o.user, 'GET', '/');
    expect(inn.text).toContain(`href="/u/${o.user.username}"`);
    expect(inn.text).toContain('href="/settings"');
    expect(inn.text).toContain('href="/new"');
  });
});

describe('/u/:username', () => {
  it('is a 404 page for an unknown user', async () => {
    const r = await get('/u/nobody-here');
    expect(r.status).toBe(404);
    html(r);
  });

  async function seeded() {
    const o = await owner();
    await makePreset(o.user, o.token, { visibility: 'public', name: 'shown look', tags: ['projector'] });
    await makePreset(o.user, o.token, { visibility: 'unlisted', name: 'unlisted look' });
    await makePreset(o.user, o.token, { visibility: 'private', name: 'private look' });
    await makePreset(o.user, o.token, { visibility: 'public', archived: true, name: 'archived look' });
    await makePlaylist(o.token, { visibility: 'public', name: 'shown list' });
    await makePlaylist(o.token, { visibility: 'unlisted', name: 'unlisted list' });
    await makePlaylist(o.token, { name: 'private list' });
    return o;
  }

  it('lists only public, non-archived presets and public playlists to everyone else, as text with no previews', async () => {
    const o = await seeded();
    const someoneElse = await makeUser('other');

    for (const viewer of [undefined, someoneElse]) {
      const r = viewer ? await asSession(viewer, 'GET', `/u/${o.user.username}`) : await get(`/u/${o.user.username}`);
      expect(r.status).toBe(200);
      expect(r.text).toContain('shown look');
      expect(r.text).toContain('projector');
      expect(r.text).toContain('shown list');
      for (const hidden of ['unlisted look', 'private look', 'archived look', 'unlisted list', 'private list']) {
        expect(r.text).not.toContain(hidden);
      }
      expect(r.text).not.toMatch(/archived<\/h2>/);
      expect(r.text).not.toContain('<canvas');
    }
  });

  describe('as the owner', () => {
    // The <li> that holds a name, so a label is checked on its own row.
    const row = (text: string, name: string) => new RegExp(`<li>(?:(?!</li>).)*${name}(?:(?!</li>).)*</li>`, 's').exec(text)?.[0] ?? '';

    it('lists all their non-archived presets and playlists, each labelled private or unlisted where it is not public', async () => {
      const o = await seeded();
      const r = await asSession(o.user, 'GET', `/u/${o.user.username}`);
      expect(r.status).toBe(200);
      expect(row(r.text, 'unlisted look')).toMatch(/>unlisted</);
      expect(row(r.text, 'private look')).toMatch(/>private</);
      expect(row(r.text, 'unlisted list')).toMatch(/>unlisted</);
      expect(row(r.text, 'private list')).toMatch(/>private</);
      const pub = row(r.text, 'shown look');
      expect(pub).toContain('shown look');
      expect(pub).not.toMatch(/>(private|unlisted|public)</);
      expect(row(r.text, 'shown list')).not.toMatch(/>(private|unlisted|public)</);
      expect(r.text).not.toContain('<canvas');
    });

    it('lists their archived presets under an archived heading, after the rest, and links them', async () => {
      const o = await owner();
      const live = await makePreset(o.user, o.token, { visibility: 'public', name: 'live look' });
      const old = await makePreset(o.user, o.token, { visibility: 'private', archived: true, name: 'shelved look' });
      const r = await asSession(o.user, 'GET', `/u/${o.user.username}`);
      const heading = r.text.search(/<h2[^>]*>archived<\/h2>/);
      expect(heading).toBeGreaterThan(-1);
      expect(r.text.indexOf('shelved look')).toBeGreaterThan(heading);
      expect(r.text.indexOf('live look')).toBeLessThan(heading);
      expect(r.text).toContain(`href="/p/${old.id}"`);
      expect(r.text).toContain(`href="/p/${live.id}"`);
    });

    it('has no archived heading when nothing is archived', async () => {
      const o = await owner();
      await makePreset(o.user, o.token, { name: 'only look' });
      const r = await asSession(o.user, 'GET', `/u/${o.user.username}`);
      expect(r.text).not.toMatch(/archived<\/h2>/);
    });

    it('keeps another person’s private and archived things off their own profile view of someone else', async () => {
      const o = await seeded();
      const me = await seeded();
      const r = await asSession(me.user, 'GET', `/u/${o.user.username}`);
      expect(r.text).toContain('shown look');
      for (const hidden of ['unlisted look', 'private look', 'archived look', 'unlisted list', 'private list']) {
        expect(r.text).not.toContain(hidden);
      }
    });
  });

  it('links each item to its page', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: 'public' });
    const l = await makePlaylist(o.token, { visibility: 'public' });
    const r = await get(`/u/${o.user.username}`);
    expect(r.text).toContain(`href="/p/${p.id}"`);
    expect(r.text).toContain(`href="/l/${l.id}"`);
  });

  it('shows a name containing markup as text', async () => {
    const o = await owner();
    await makePreset(o.user, o.token, { visibility: 'public', name: '<script>alert(1)</script>' });
    const r = await get(`/u/${o.user.username}`);
    expect(r.text).not.toContain('<script>alert(1)');
    expect(r.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

const engineFile = engine.file;

describe('/p/:id', () => {
  it.each([
    ['public', undefined, 200],
    ['unlisted', undefined, 404],
    ['unlisted', 'wrong', 404],
    ['unlisted', 'right', 200],
    ['private', undefined, 404],
    ['private', 'right', 404],
  ] as const)('a %s preset, k=%s, is %i for a stranger', async (visibility, k, status) => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility });
    const q = k === undefined ? '' : `?k=${k === 'right' ? p.share_token : k}`;
    const r = await get(`/p/${p.id}${q}`);
    expect(r.status).toBe(status);
    html(r);
  });

  it('a private preset is the owner’s alone, and another signed-in person gets a 404', async () => {
    const o = await owner();
    const other = await makeUser('other');
    const p = await makePreset(o.user, o.token, { visibility: 'private' });
    expect((await asSession(o.user, 'GET', `/p/${p.id}`)).status).toBe(200);
    expect((await asSession(other, 'GET', `/p/${p.id}`)).status).toBe(404);
  });

  it('an archived preset is a 404 for everyone but its owner, even when public', async () => {
    const o = await owner();
    const other = await makeUser('other');
    const p = await makePreset(o.user, o.token, { visibility: 'public', archived: true });
    expect((await get(`/p/${p.id}`)).status).toBe(404);
    expect((await asSession(other, 'GET', `/p/${p.id}`)).status).toBe(404);
    expect((await asSession(o.user, 'GET', `/p/${p.id}`)).status).toBe(200);
  });

  it.each(['/p/999999', '/p/0', '/p/abc', '/p/1.5'])('%s is a 404 page', async (path) => {
    const r = await get(path);
    expect(r.status).toBe(404);
    html(r);
  });

  it('holds the name, description, tags, owner and version in the HTML itself', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: 'public', name: 'montebello, rain', description: 'wet leaves, slow', tags: ['experimental'] });
    const r = await get(`/p/${p.id}`);
    expect(r.text).toContain('montebello, rain');
    expect(r.text).toContain('wet leaves, slow');
    expect(r.text).toContain('experimental');
    expect(r.text).toContain(`href="/u/${o.user.username}"`);
    expect(r.text).toMatch(/version 1/);
    expect(r.text).toContain(`href="/p/${p.id}/history"`);
  });

  it('shows markup in a name or description as text', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: 'public', name: '<script>alert(1)</script>', description: '<img src=x onerror=alert(2)>' });
    const r = await get(`/p/${p.id}`);
    expect(r.text).not.toContain('<script>alert(1)');
    expect(r.text).not.toContain('<img src=x');
    expect(r.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.text).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });

  it('the main action is open in komorebi, with k only when unlisted', async () => {
    const o = await owner();
    const pub = await makePreset(o.user, o.token, { visibility: 'public' });
    const unl = await makePreset(o.user, o.token, { visibility: 'unlisted' });
    expect((await get(`/p/${pub.id}`)).text).toContain(`href="https://komorebi.eljojo.net/#arboretum=${pub.id}"`);
    expect((await get(`/p/${unl.id}?k=${unl.share_token}`)).text).toContain(
      `href="https://komorebi.eljojo.net/#arboretum=${unl.id}&amp;k=${unl.share_token}"`,
    );
  });

  it('keeps the share token on its own links while unlisted', async () => {
    const o = await owner();
    const unl = await makePreset(o.user, o.token, { visibility: 'unlisted' });
    const r = await get(`/p/${unl.id}?k=${unl.share_token}`);
    expect(r.text).toContain(`href="/p/${unl.id}/history?k=${unl.share_token}"`);
    expect(r.text).toContain(`data-src="/api/presets/${unl.id}?k=${unl.share_token}"`);
  });

  it('puts one canvas on the page, pointing at the engine file and at the API', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: 'public' });
    const r = await get(`/p/${p.id}`);
    expect(r.text.match(/<canvas/g)).toHaveLength(1);
    expect(r.text).toContain(`data-engine="${engineFile}"`);
    expect(r.text).toContain(`data-src="/api/presets/${p.id}"`);
    expect(r.text).toContain('src="/js/preview.js"');
  });

  it('says what a projector look is before the canvas, and says nothing otherwise', async () => {
    const o = await owner();
    const proj = await makePreset(o.user, o.token, { visibility: 'public', tags: ['projector'] });
    const plain = await makePreset(o.user, o.token, { visibility: 'public' });
    const r = await get(`/p/${proj.id}`);
    const note = r.text.indexOf('made for a projector in the yard; on a screen it looks wrong on purpose');
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(r.text.indexOf('<canvas'));
    expect((await get(`/p/${plain.id}`)).text).not.toContain('made for a projector');
  });

  describe('owner controls', () => {
    it('are there for the owner only', async () => {
      const o = await owner();
      const other = await makeUser('other');
      const p = await makePreset(o.user, o.token, { visibility: 'public' });
      const mine = await asSession(o.user, 'GET', `/p/${p.id}`);
      for (const part of ['id="owner-controls"', 'name="visibility"', 'id="archive"', 'id="new-version"', 'id="add-to-playlist"']) {
        expect(mine.text).toContain(part);
      }
      for (const r of [await get(`/p/${p.id}`), await asSession(other, 'GET', `/p/${p.id}`)]) {
        expect(r.text).not.toContain('owner-controls');
        expect(r.text).not.toContain('name="visibility"');
        expect(r.text).not.toContain('id="archive"');
      }
    });

    it('offer unarchive for an archived preset, and only archive otherwise', async () => {
      const o = await owner();
      const live = await makePreset(o.user, o.token);
      const gone = await makePreset(o.user, o.token, { archived: true });
      expect((await asSession(o.user, 'GET', `/p/${live.id}`)).text).not.toContain('id="unarchive"');
      const r = await asSession(o.user, 'GET', `/p/${gone.id}`);
      expect(r.text).toContain('id="unarchive"');
      expect(r.text).not.toContain('id="archive"');
    });

    it('show the share link only while the preset is unlisted', async () => {
      const o = await owner();
      const unl = await makePreset(o.user, o.token, { visibility: 'unlisted' });
      const pub = await makePreset(o.user, o.token, { visibility: 'public' });
      expect((await asSession(o.user, 'GET', `/p/${unl.id}`)).text).toContain(`https://arboretum.test/p/${unl.id}?k=${unl.share_token}`);
      expect((await asSession(o.user, 'GET', `/p/${pub.id}`)).text).not.toContain('?k=');
    });

    it('open in komorebi carries k for the owner of an unlisted preset who arrived without it', async () => {
      const o = await owner();
      const unl = await makePreset(o.user, o.token, { visibility: 'unlisted' });
      const r = await asSession(o.user, 'GET', `/p/${unl.id}`);
      expect(r.text).toContain(`#arboretum=${unl.id}&amp;k=${unl.share_token}`);
    });
  });
});

describe('/p/:id/history', () => {
  it('lists the versions newest first, with how each arrived', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { name: 'first name' });
    // A token may only add to a private look, so the look is published afterwards.
    await call('POST', `/api/presets/${p.id}/versions`, { token: await makeToken(o.user, { label: 'studio laptop claude' }), json: { name: 'second name' } });
    await asSession(o.user, 'PATCH', `/api/presets/${p.id}`, { json: { visibility: 'public' } });
    const r = await get(`/p/${p.id}/history`);
    expect(r.status).toBe(200);
    expect(r.text.indexOf('second name')).toBeGreaterThan(-1);
    expect(r.text.indexOf('second name')).toBeLessThan(r.text.indexOf('first name'));
    expect(r.text).toContain('token:test laptop');
    expect(r.text).toContain('token:studio laptop claude');
    expect(r.text).toContain(`href="/p/${p.id}/v/2"`);
    expect(r.text).toContain(`href="/p/${p.id}/v/1"`);
  });

  it('follows the same 404 rules as the preset', async () => {
    const o = await owner();
    const priv = await makePreset(o.user, o.token, { visibility: 'private' });
    const unl = await makePreset(o.user, o.token, { visibility: 'unlisted' });
    const arch = await makePreset(o.user, o.token, { visibility: 'public', archived: true });
    expect((await get(`/p/${priv.id}/history`)).status).toBe(404);
    expect((await get(`/p/${unl.id}/history`)).status).toBe(404);
    expect((await get(`/p/${unl.id}/history?k=${unl.share_token}`)).status).toBe(200);
    expect((await get(`/p/${arch.id}/history`)).status).toBe(404);
    expect((await asSession(o.user, 'GET', `/p/${priv.id}/history`)).status).toBe(200);
    expect((await get('/p/999999/history')).status).toBe(404);
  });
});

describe('/p/:id/v/:n', () => {
  it('previews one version and opens that version in komorebi', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: 'public', name: 'first name', tags: ['projector'] });
    await call('POST', `/api/presets/${p.id}/versions`, { token: o.token, json: { name: 'second name', tags: [] } });
    const r = await get(`/p/${p.id}/v/1`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('first name');
    expect(r.text).not.toContain('second name');
    expect(r.text.match(/<canvas/g)).toHaveLength(1);
    expect(r.text).toContain(`data-src="/api/presets/${p.id}/versions/1"`);
    expect(r.text).toContain(`href="https://komorebi.eljojo.net/#arboretum=${p.id}@1"`);
    expect(r.text).toMatch(/open this version in komorebi/i);
    // The note follows the version's own tags.
    expect(r.text.indexOf('made for a projector')).toBeLessThan(r.text.indexOf('<canvas'));
    expect((await get(`/p/${p.id}/v/2`)).text).not.toContain('made for a projector');
  });

  it('carries k for an unlisted preset', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: 'unlisted' });
    const r = await get(`/p/${p.id}/v/1?k=${p.share_token}`);
    expect(r.text).toContain(`#arboretum=${p.id}@1&amp;k=${p.share_token}`);
    expect(r.text).toContain(`data-src="/api/presets/${p.id}/versions/1?k=${p.share_token}"`);
  });

  it('is a 404 for a version that is not there, and follows the preset’s rules', async () => {
    const o = await owner();
    const pub = await makePreset(o.user, o.token, { visibility: 'public' });
    const priv = await makePreset(o.user, o.token, { visibility: 'private' });
    for (const path of [`/p/${pub.id}/v/2`, `/p/${pub.id}/v/0`, `/p/${pub.id}/v/abc`, `/p/${priv.id}/v/1`, '/p/999999/v/1']) {
      expect((await get(path)).status, path).toBe(404);
    }
    expect((await asSession(o.user, 'GET', `/p/${priv.id}/v/1`)).status).toBe(200);
  });
});

describe('/l/:id', () => {
  it.each([
    ['public', undefined, 200],
    ['unlisted', undefined, 404],
    ['unlisted', 'wrong', 404],
    ['unlisted', 'right', 200],
    ['private', undefined, 404],
    ['private', 'right', 404],
  ] as const)('a %s playlist, k=%s, is %i for a stranger', async (visibility, k, status) => {
    const o = await owner();
    const l = await makePlaylist(o.token, { visibility });
    const q = k === undefined ? '' : `?k=${k === 'right' ? l.share_token : k}`;
    const r = await get(`/l/${l.id}${q}`);
    expect(r.status).toBe(status);
    html(r);
  });

  it('a private playlist is the owner’s alone', async () => {
    const o = await owner();
    const other = await makeUser('other');
    const l = await makePlaylist(o.token);
    expect((await asSession(o.user, 'GET', `/l/${l.id}`)).status).toBe(200);
    expect((await asSession(other, 'GET', `/l/${l.id}`)).status).toBe(404);
  });

  it.each(['/l/999999', '/l/0', '/l/abc'])('%s is a 404 page', async (path) => {
    const r = await get(path);
    expect(r.status).toBe(404);
    html(r);
  });

  async function listOf(o: Awaited<ReturnType<typeof owner>>, visibility: 'public' | 'unlisted' | 'private' = 'public') {
    const a = await makePreset(o.user, o.token, { visibility: 'public', name: 'first look' });
    const b = await makePreset(o.user, o.token, { visibility: 'public', name: 'second look' });
    const l = await makePlaylist(o.token, {
      visibility,
      name: 'slow afternoon',
      items: [
        { preset_id: b.id, dwell_s: 45, crossfade_s: 8 },
        { preset_id: a.id, dwell_s: 30, crossfade_s: 5 },
      ],
    });
    return { a, b, l };
  }

  it('lists the looks in order with dwell and crossfade, each linking to its preset', async () => {
    const o = await owner();
    const { a, b, l } = await listOf(o);
    const r = await get(`/l/${l.id}`);
    expect(r.text).toContain('slow afternoon');
    expect(r.text.indexOf('second look')).toBeLessThan(r.text.indexOf('first look'));
    expect(r.text).toContain(`href="/p/${b.id}"`);
    expect(r.text).toContain(`href="/p/${a.id}"`);
    expect(r.text).toMatch(/45 s/);
    expect(r.text).toMatch(/crossfade 8 s/);
  });

  it('shows markup in a playlist or look name as text', async () => {
    const o = await owner();
    const p = await makePreset(o.user, o.token, { visibility: 'public', name: '<b>bold look</b>' });
    const l = await makePlaylist(o.token, { visibility: 'public', name: '<script>alert(3)</script>', items: [{ preset_id: p.id }] });
    const r = await get(`/l/${l.id}`);
    expect(r.text).not.toContain('<script>alert(3)');
    expect(r.text).not.toContain('<b>bold look');
    expect(r.text).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
    expect(r.text).toContain('&lt;b&gt;bold look&lt;/b&gt;');
  });

  it('has one canvas for the inline player, with previous and next, and none when nothing can play', async () => {
    const o = await owner();
    const { l } = await listOf(o);
    const r = await get(`/l/${l.id}`);
    expect(r.text.match(/<canvas/g)).toHaveLength(1);
    expect(r.text).toContain(`data-src="/api/playlists/${l.id}"`);
    expect(r.text).toContain(`data-engine="${engineFile}"`);
    expect(r.text).toContain('id="prev"');
    expect(r.text).toContain('id="next"');
    expect(r.text).toContain('src="/js/player.js"');
    const empty = await makePlaylist(o.token, { visibility: 'public' });
    expect((await get(`/l/${empty.id}`)).text).not.toContain('<canvas');
  });

  it('plays in komorebi, with k only when unlisted', async () => {
    const o = await owner();
    const pub = await listOf(o, 'public');
    const unl = await listOf(o, 'unlisted');
    expect((await get(`/l/${pub.l.id}`)).text).toContain(`href="https://komorebi.eljojo.net/#arboretum-playlist=${pub.l.id}"`);
    const r = await get(`/l/${unl.l.id}?k=${unl.l.share_token}`);
    expect(r.text).toContain(`href="https://komorebi.eljojo.net/#arboretum-playlist=${unl.l.id}&amp;k=${unl.l.share_token}"`);
    expect(r.text).toContain(`data-src="/api/playlists/${unl.l.id}?k=${unl.l.share_token}"`);
  });

  it('skips what the viewer cannot see, and tells only the owner how many', async () => {
    const o = await owner();
    const other = await makeUser('other');
    const mine = await makePreset(o.user, o.token, { visibility: 'public', name: 'mine' });
    const theirs = await makePreset(other, await makeToken(other), { visibility: 'public', name: 'theirs' });
    const gone = await makePreset(o.user, o.token, { visibility: 'public', name: 'archived later' });
    const l = await makePlaylist(o.token, { visibility: 'public', items: [{ preset_id: mine.id }, { preset_id: theirs.id }, { preset_id: gone.id }] });

    const before = await asSession(o.user, 'GET', `/l/${l.id}`);
    expect(before.text).not.toMatch(/unavailable/);

    await asSession(other, 'PATCH', `/api/presets/${theirs.id}`, { json: { visibility: 'private' } });
    await asSession(o.user, 'POST', `/api/presets/${gone.id}/archive`);

    const mineView = await asSession(o.user, 'GET', `/l/${l.id}`);
    expect(mineView.text).toContain('2 items unavailable');
    expect(mineView.text).toContain('mine');
    expect(mineView.text).not.toContain('theirs');
    expect(mineView.text).not.toContain('archived later');

    const stranger = await get(`/l/${l.id}`);
    expect(stranger.text).not.toMatch(/unavailable/);
    expect(stranger.text).not.toContain('theirs');
  });

  describe('what the owner cannot play now', () => {
    async function hiddenMiddle() {
      const o = await owner();
      const other = await makeUser('other');
      const first = await makePreset(o.user, o.token, { visibility: 'public', name: 'first look' });
      const theirs = await makePreset(other, await makeToken(other), { visibility: 'public', name: 'their secret name' });
      const l = await makePlaylist(o.token, {
        visibility: 'public',
        items: [{ preset_id: first.id }, { preset_id: theirs.id, dwell_s: 77, crossfade_s: 3 }],
      });
      await asSession(other, 'PATCH', `/api/presets/${theirs.id}`, { json: { visibility: 'private' } });
      return { o, first, theirs, l };
    }

    it('are rows of their own in the owner’s list, in place and with their times, which the editor can keep or remove', async () => {
      const { o, first, theirs, l } = await hiddenMiddle();
      const r = await asSession(o.user, 'GET', `/l/${l.id}`);
      expect(r.text).toContain(`data-preset="${theirs.id}" data-dwell="77" data-crossfade="3" data-unavailable="true"`);
      expect(r.text.indexOf(`data-preset="${first.id}"`)).toBeLessThan(r.text.indexOf(`data-preset="${theirs.id}"`));
      expect(r.text).not.toContain('their secret name');
      expect(r.text).toMatch(/<li[^>]*data-unavailable[^>]*>[^]*?unavailable[^]*?<\/li>/);
      expect(r.text).toContain('1 item unavailable');
    });

    it('are not said to be dropped by saving, because saving keeps them', async () => {
      const { o, l } = await hiddenMiddle();
      const r = await asSession(o.user, 'GET', `/l/${l.id}`);
      expect(r.text).not.toMatch(/drops/i);
    });

    it('are not rows for anyone else', async () => {
      const { l } = await hiddenMiddle();
      const r = await get(`/l/${l.id}`);
      expect(r.text).not.toContain('data-unavailable');
      expect(r.text.match(/<li /g)).toHaveLength(1);
    });

    it('leave nothing to play when every item is unavailable', async () => {
      const o = await owner();
      const a = await makePreset(o.user, o.token, { name: 'a' });
      const l = await makePlaylist(o.token, { items: [{ preset_id: a.id }] });
      await asSession(o.user, 'POST', `/api/presets/${a.id}/archive`);
      const r = await asSession(o.user, 'GET', `/l/${l.id}`);
      expect(r.text).not.toContain('<canvas');
      expect(r.text).not.toContain('player.js');
      expect(r.text).toContain('nothing to play yet');
      expect(r.text).toContain('data-unavailable');
    });
  });

  describe('owner controls', () => {
    it('are there for the owner only', async () => {
      const o = await owner();
      const other = await makeUser('other');
      const { l } = await listOf(o);
      const mine = await asSession(o.user, 'GET', `/l/${l.id}`);
      for (const part of ['id="owner-controls"', 'name="visibility"', 'id="save-items"', 'src="/js/owner-playlist.js"']) {
        expect(mine.text).toContain(part);
      }
      for (const r of [await get(`/l/${l.id}`), await asSession(other, 'GET', `/l/${l.id}`)]) {
        expect(r.text).not.toContain('owner-controls');
        expect(r.text).not.toContain('name="visibility"');
        expect(r.text).not.toContain('owner-playlist.js');
      }
    });

    it('carry what the editor needs on each row, and the share link while unlisted', async () => {
      const o = await owner();
      const { b, l } = await listOf(o, 'unlisted');
      const r = await asSession(o.user, 'GET', `/l/${l.id}`);
      expect(r.text).toContain(`data-preset="${b.id}" data-dwell="45" data-crossfade="8"`);
      expect(r.text).toContain(`https://arboretum.test/l/${l.id}?k=${l.share_token}`);
      expect(r.text).toContain(`#arboretum-playlist=${l.id}&amp;k=${l.share_token}`);
    });
  });
});

// A page's redirect is the answer; fetch would otherwise follow it to /login.
const unfollowed = (path: string, headers: Record<string, string> = {}) =>
  exports.default.fetch(new Request(`https://arboretum.test${path}`, { redirect: 'manual', headers }));

describe('/new and /settings', () => {
  it.each(['/new', '/settings'])('%s sends a signed-out visitor to /login', async (path) => {
    const r = await unfollowed(path);
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/login');
  });

  it.each(['/new', '/settings'])('%s sends someone holding only a token to /login too, since it is a person’s page', async (path) => {
    const o = await owner();
    const r = await unfollowed(path, { Authorization: `Bearer ${o.token}` });
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe('/login');
  });

  it('/new takes pasted or uploaded JSON, then name, description, tags and visibility defaulting to private', async () => {
    const o = await owner();
    const r = await asSession(o.user, 'GET', '/new');
    expect(r.status).toBe(200);
    html(r);
    expect(r.text).toContain('name="params"');
    expect(r.text).toContain('type="file"');
    expect(r.text).toContain('name="name"');
    expect(r.text).toContain('name="description"');
    expect(r.text).toContain('value="projector"');
    expect(r.text).toContain('value="experimental"');
    expect(r.text).toMatch(/<option value="private" selected/);
    expect(r.text).toContain('src="/js/new.js"');
  });

  it('/settings holds passkeys, tokens, the export and log out, and no device codes', async () => {
    const o = await owner();
    const r = await asSession(o.user, 'GET', '/settings');
    expect(r.status).toBe(200);
    expect(r.text).toContain('id="passkeys"');
    expect(r.text).toContain('id="tokens"');
    expect(r.text).toContain('href="/api/export"');
    expect(r.text).toContain('id="logout"');
    expect(r.text).toContain('src="/js/settings.js"');
    expect(r.text).not.toMatch(/device code|add a device/i);
  });
});

describe('the vendored passkey library', () => {
  it('is named for the version package.json installs, and the ceremony pages load it', async () => {
    expect(WEBAUTHN_BROWSER).toBe(`/vendor/simplewebauthn-browser-${webauthn.version}.umd.min.js`);
    for (const path of ['/signup', '/login']) expect((await get(path)).text).toContain(`src="${WEBAUTHN_BROWSER}"`);
    const o = await owner();
    expect((await asSession(o.user, 'GET', '/settings')).text).toContain(`src="${WEBAUTHN_BROWSER}"`);
  });
});
