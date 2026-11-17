// Every limit in one place (spec §5). A quota that is hit answers 429 and names itself.
export const LIMITS = {
  presets: 1000,
  playlists: 100,
  // Rolling 24 hours, counting the first version of a new preset.
  versionsPerDay: 200,
  tokens: 10,
  // Per IP address, per rolling hour (spec §5). Completed sign-ups and failed logins count, and so does every
  // ceremony started (register-options, login-options and add-passkey-options share one count).
  signupsPerHour: 5,
  failedLoginsPerHour: 20,
  ceremoniesPerHour: 60,
};

export const MAX_BODY_BYTES = 64 * 1024;

export const SESSION_MS = 30 * 24 * 3600 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Names that would let someone pass for the project, plus the site's own path words (spec §3.1).
export const RESERVED_USERNAMES = [
  'komorebi', 'arboretum', 'admin', 'api', 'root', 'www', 'help', 'about', 'settings', 'new',
  'login', 'logout', 'signup', 'u', 'p', 'l', 'engine', 'export',
];

export const KOMOREBI_ORIGIN = 'https://komorebi.eljojo.net';

// Arboretum's pages and its static files live under this path on komorebi.eljojo.net; `/` and everything else
// outside /api is komorebi's own site. The one place the prefix is written: every page route, href and asset URL
// is built from it. public/js finds it from where its own modules are served (public/js/base.js).
export const BASE = '/arboretum';

// arboretum.eljojo.net stays attached while links to it are replaced: its /api answers as ever, and every other
// path is a permanent redirect to the same path under BASE on KOMOREBI_ORIGIN.
export const LEGACY_HOST = 'arboretum.eljojo.net';
