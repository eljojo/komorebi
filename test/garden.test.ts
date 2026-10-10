import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import engine from '../public/engine/engine.json';
import { presets } from '../src/db/schema';
import { db, get, makePreset, makeToken, makeUser } from './helpers';

// The garden is the front page's one player and the few public looks it rotates through. This file's storage starts
// empty, so the first test sees an empty garden.
const looks = (text: string) => text.match(/<li class="look"/g)?.length ?? 0;

describe('the garden on /arboretum', () => {
  it('says one calm line when no look is public yet, and is not an error, with no player', async () => {
    const r = await get('/arboretum');
    expect(r.status).toBe(200);
    expect(r.text).toContain('class="garden-empty"');
    expect(r.text).toMatch(/garden is quiet/i);
    expect(looks(r.text)).toBe(0);
    expect(r.text).not.toContain('<canvas');
    expect(r.text).not.toContain('/js/garden.js');
  });

  it('shows a public look with its name, owner, page and open-in-komorebi links, and where its params are', async () => {
    const user = await makeUser('gardener');
    const token = await makeToken(user);
    const p = await makePreset(user, token, { visibility: 'public', name: 'dew on the lawn' });
    const r = await get('/arboretum');
    expect(r.text).not.toContain('class="garden-empty"');
    expect(looks(r.text)).toBe(1);
    expect(r.text).toContain('dew on the lawn');
    expect(r.text).toContain(`href="/arboretum/u/${user.username}"`);
    expect(r.text).toContain(`href="/arboretum/p/${p.id}"`);
    expect(r.text).toContain(`href="https://komorebi.eljojo.net/#arboretum=${p.id}"`);
    expect(r.text).toContain(`data-src="/api/presets/${p.id}"`);
    expect(r.text).toContain('src="/arboretum/js/garden.js"');
  });

  it('has exactly one player: one figure with one canvas, pointing at the engine file', async () => {
    const user = await makeUser('gardener');
    const token = await makeToken(user);
    for (let i = 0; i < 3; i++) await makePreset(user, token, { visibility: 'public', name: `one of three ${i}` });
    const r = await get('/arboretum');
    expect(r.text.match(/<figure/g)).toHaveLength(1);
    expect(r.text.match(/<canvas/g)).toHaveLength(1);
    expect(r.text).toContain(`data-engine="${engine.file}"`);
  });

  it('never shows a private, unlisted or archived look, or leaks their share links', async () => {
    const user = await makeUser('gardener');
    const token = await makeToken(user);
    const unlisted = await makePreset(user, token, { visibility: 'unlisted', name: 'unlisted secret' });
    await makePreset(user, token, { visibility: 'private', name: 'private secret' });
    await makePreset(user, token, { visibility: 'public', archived: true, name: 'archived secret' });
    await makePreset(user, token, { visibility: 'public', name: 'shown in the open' });
    // The pick is random, so ask often enough that a leak would show.
    for (let i = 0; i < 8; i++) {
      const r = await get('/arboretum');
      for (const hidden of ['unlisted secret', 'private secret', 'archived secret', unlisted.share_token]) expect(r.text).not.toContain(hidden);
    }
  });

  it('shows at most six looks, all of them public ones', async () => {
    const user = await makeUser('gardener');
    const token = await makeToken(user);
    const ids = new Set<number>();
    for (let i = 0; i < 9; i++) ids.add((await makePreset(user, token, { visibility: 'public', name: `plenty ${i}` })).id);
    const hiddenId = (await makePreset(user, token, { visibility: 'private', name: 'plenty private' })).id;
    for (let i = 0; i < 4; i++) {
      const r = await get('/arboretum');
      expect(looks(r.text)).toBe(6);
      const shown = [...r.text.matchAll(/<li class="look"[^>]*data-src="\/api\/presets\/(\d+)"/g)].map((m) => Number(m[1]));
      expect(new Set(shown).size).toBe(6);
      expect(shown).not.toContain(hiddenId);
    }
  });

  it('shows names containing markup as text', async () => {
    const user = await makeUser('gardener');
    const token = await makeToken(user);
    // Enough looks that the pick cannot leave this one out for long: ask until it is shown.
    await makePreset(user, token, { visibility: 'public', name: '<b>bold</b>' });
    let text = '';
    for (let i = 0; i < 40 && !text.includes('bold'); i++) text = (await get('/arboretum')).text;
    expect(text).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(text).not.toContain('<b>bold');
  });
});

describe('the front page text', () => {
  it('links into about, the player and the editor', async () => {
    const r = await get('/arboretum');
    for (const href of ['/about', '/player.html', '/arboretum/llms.txt']) expect(r.text).toContain(`href="${href}"`);
    expect(r.text).toMatch(/<a[^>]*href="\/"[^>]*>open komorebi<\/a>/);
  });

  it('is titled arboretum · komorebi', async () => {
    expect((await get('/arboretum')).text).toContain('<title>arboretum · komorebi</title>');
  });
});
