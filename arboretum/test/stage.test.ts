import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { install } from '../scripts/stage.mjs';

// A staging area, a "committed" tree with old outputs in it, and the paths a bump would replace.
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'stage-'));
  const staged = join(root, 'staged');
  const live = join(root, 'live');
  mkdirSync(staged);
  mkdirSync(live);
  const put = (dir: string, name: string, text: string) => writeFileSync(join(dir, name), text);
  put(live, 'bundle-old.js', 'old bundle');
  put(live, 'engine.json', 'points at old');
  put(live, 'types.ts', 'old types');
  return { root, staged, live, put };
}

describe('install: replace the committed outputs only once every one is ready', () => {
  it('puts every staged file in place, creating folders, and only then removes the stale ones', () => {
    const { staged, live, put } = setup();
    put(staged, 'bundle-new.js', 'new bundle');
    put(staged, 'engine.json', 'points at new');
    put(staged, 'types.ts', 'new types');

    install(
      [
        { from: join(staged, 'bundle-new.js'), to: join(live, 'engine', 'bundle-new.js') },
        { from: join(staged, 'engine.json'), to: join(live, 'engine', 'engine.json') },
        { from: join(staged, 'types.ts'), to: join(live, 'types.ts') },
      ],
      [join(live, 'bundle-old.js'), join(live, 'engine.json')],
    );

    expect(readFileSync(join(live, 'engine', 'bundle-new.js'), 'utf8')).toBe('new bundle');
    expect(readFileSync(join(live, 'engine', 'engine.json'), 'utf8')).toBe('points at new');
    expect(readFileSync(join(live, 'types.ts'), 'utf8')).toBe('new types');
    expect(existsSync(join(live, 'bundle-old.js'))).toBe(false);
    expect(readdirSync(live).sort()).toEqual(['engine', 'types.ts']);
  });

  it('replaces nothing, and deletes nothing, when a staged file turns out to be missing', () => {
    const { staged, live, put } = setup();
    put(staged, 'types.ts', 'new types');
    // The bundle step failed: its output was never staged.

    expect(() =>
      install(
        [
          { from: join(staged, 'types.ts'), to: join(live, 'types.ts') },
          { from: join(staged, 'bundle-new.js'), to: join(live, 'bundle-new.js') },
        ],
        [join(live, 'bundle-old.js')],
      ),
    ).toThrow();

    expect(readFileSync(join(live, 'types.ts'), 'utf8')).toBe('old types');
    expect(readFileSync(join(live, 'bundle-old.js'), 'utf8')).toBe('old bundle');
    expect(readdirSync(live).sort()).toEqual(['bundle-old.js', 'engine.json', 'types.ts']);
  });

  it('leaves a stale path that is also an output alone', () => {
    const { staged, live, put } = setup();
    put(staged, 'engine.json', 'points at new');
    install([{ from: join(staged, 'engine.json'), to: join(live, 'engine.json') }], [join(live, 'engine.json')]);
    expect(readFileSync(join(live, 'engine.json'), 'utf8')).toBe('points at new');
  });
});
