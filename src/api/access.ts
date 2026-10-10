// Read access (spec §6): one rule for presets and playlists. Whatever you may not see is a 404, so existence
// does not leak.
import type { Actor } from '../auth';
import type { Visibility } from './util';

export type Shareable = { ownerId: number; visibility: Visibility; shareToken: string; archivedAt?: number | null };

// A share token is a secret compared against input, so compare in constant time.
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

export function canSee(r: Shareable, actor: Actor | null, k: string | undefined): boolean {
  if (actor?.userId === r.ownerId) return true;
  if (r.archivedAt) return false;
  if (r.visibility === 'public') return true;
  return r.visibility === 'unlisted' && k !== undefined && sameSecret(k, r.shareToken);
}
