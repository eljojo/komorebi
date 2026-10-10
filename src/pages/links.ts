import { KOMOREBI_ORIGIN } from '../config';

const withToken = (k: string | undefined) => (k ? `&k=${k}` : '');

// The share token is base64url, so it needs no escaping in a fragment. `k` belongs only to an unlisted look.
export function komorebiPresetLink(id: number, opts: { n?: number; k?: string } = {}): string {
  return `${KOMOREBI_ORIGIN}/#arboretum=${id}${opts.n !== undefined ? `@${opts.n}` : ''}${withToken(opts.k)}`;
}

export function komorebiPlaylistLink(id: number, k?: string): string {
  return `${KOMOREBI_ORIGIN}/#arboretum-playlist=${id}${withToken(k)}`;
}
