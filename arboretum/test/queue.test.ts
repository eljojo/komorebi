import { describe, expect, it } from 'vitest';
import { arrive, holdFor, playable } from '../public/js/queue.js';

const items = [
  { preset_id: 1, crossfade_s: 2 },
  { preset_id: 2, crossfade_s: 9 },
  { preset_id: 3, crossfade_s: 4 },
];

describe('the player queue', () => {
  it('takes the crossfade of the look it is arriving at, not the one it is leaving', () => {
    expect(arrive(items, 1)).toEqual({ at: 1, duration: 9 });
    expect(arrive(items, 2)).toEqual({ at: 2, duration: 4 });
  });

  it('wraps in both directions, and the arriving look still sets the crossfade', () => {
    expect(arrive(items, 3)).toEqual({ at: 0, duration: 2 });
    expect(arrive(items, -1)).toEqual({ at: 2, duration: 4 });
  });

  it('leaves out the items the owner is told are unavailable', () => {
    const mixed = [{ preset_id: 1 }, { preset_id: 2, unavailable: true }, { preset_id: 3 }];
    expect(playable(mixed).map((i) => i.preset_id)).toEqual([1, 3]);
  });

  it('counts the dwell from when the crossfade ends: the fade in, then the dwell', () => {
    expect(holdFor({ crossfade_s: 5, dwell_s: 30 }, true)).toBe(35);
    expect(holdFor({ crossfade_s: 120, dwell_s: 1 }, true)).toBe(121);
  });

  it('gives the first look, which does not fade in, just its dwell', () => {
    expect(holdFor({ crossfade_s: 5, dwell_s: 30 }, false)).toBe(30);
  });
});
