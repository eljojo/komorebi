import { describe, expect, it } from 'vitest';
import { komorebiPlaylistLink, komorebiPresetLink } from '../src/pages/links';

describe('open in komorebi', () => {
  it('links a preset by its id', () => {
    expect(komorebiPresetLink(12)).toBe('https://komorebi.eljojo.net/#arboretum=12');
  });

  it('carries the share token when there is one', () => {
    expect(komorebiPresetLink(12, { k: 'abc_DEF-123' })).toBe('https://komorebi.eljojo.net/#arboretum=12&k=abc_DEF-123');
  });

  it('names a version with @n, token after it', () => {
    expect(komorebiPresetLink(12, { n: 3 })).toBe('https://komorebi.eljojo.net/#arboretum=12@3');
    expect(komorebiPresetLink(12, { n: 3, k: 'tok' })).toBe('https://komorebi.eljojo.net/#arboretum=12@3&k=tok');
  });
});

describe('play in komorebi', () => {
  it('links a playlist, with the token when there is one', () => {
    expect(komorebiPlaylistLink(7)).toBe('https://komorebi.eljojo.net/#arboretum-playlist=7');
    expect(komorebiPlaylistLink(7, 'tok')).toBe('https://komorebi.eljojo.net/#arboretum-playlist=7&k=tok');
  });
});
