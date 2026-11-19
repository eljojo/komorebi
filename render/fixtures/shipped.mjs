// A pinned worktree's presets.js for the shipped-playlist tests (engine, worker): no komorebi checkout needed.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// A worktree's presets.js, as komorebi ships it: looks by name, the playlists that walk them, the item defaults.
export function shippedFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kr-ship-'));
  writeFileSync(join(dir, 'presets.js'), `
export const PRESETS = { a: { exposure: 1 }, b: { exposure: 2 }, c: { exposure: 3 } };
export const ITEM_DEFAULTS = { dwell_s: 30, crossfade_s: 4, style: 'morph' };
export const PLAYLISTS = {
  story: { name: 'park story', next: 'shadows', crossfade_s: 2, items: ['a', { look: 'b', crossfade_s: 3.5, dwell_s: 10 }] },
  shadows: { name: 'shadows', items: [{ look: 'c', style: 'fade' }, 'a'] },
  broken: { name: 'broken', items: ['a', 'gone'] },
};
`);
  return dir;
}
