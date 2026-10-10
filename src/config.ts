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

// Credentialed CORS is only ever granted to this one origin (spec §3.2); never `*`. Local development is
// same-origin (the editor is served by arboretum's own dev server), so it needs no entry.
export const CORS_ORIGINS = [KOMOREBI_ORIGIN];
