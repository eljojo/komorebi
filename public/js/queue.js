// How the inline player steps through a playlist.

// The owner's copy of a playlist also carries items they cannot play now; the player skips those.
/**
 * @template {{ unavailable?: boolean }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export const playable = (items) => items.filter((item) => !item.unavailable);

// Stepping to index `to` (it wraps). The transition *into* a look takes that look's own crossfade, because the
// crossfade is how that look wants to be arrived at.
/**
 * @param {{ crossfade_s: number }[]} items
 * @param {number} to
 */
export function arrive(items, to) {
  const at = ((to % items.length) + items.length) % items.length;
  return { at, duration: items[at].crossfade_s };
}
