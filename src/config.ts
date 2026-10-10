// Every limit in one place (spec §5). A quota that is hit answers 429 and names itself.
export const LIMITS = {
  presets: 1000,
  playlists: 100,
  // Rolling 24 hours, counting the first version of a new preset.
  versionsPerDay: 200,
  tokens: 10,
};

export const KOMOREBI_ORIGIN = 'https://komorebi.eljojo.net';

// Credentialed CORS is only ever granted to these two (spec §3.2); never `*`.
export const CORS_ORIGINS = [KOMOREBI_ORIGIN, 'http://localhost:8000'];
