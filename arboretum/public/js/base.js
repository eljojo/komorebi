// Where arboretum's pages live on this site (BASE in src/config.ts). The modules are served from `${BASE}/js/`,
// so the prefix is one level up from this file; a page that loads them at all has therefore agreed on it.
export const baseFrom = (moduleUrl) => new URL('..', moduleUrl).pathname.replace(/\/$/, '');

export const BASE = baseFrom(import.meta.url);
