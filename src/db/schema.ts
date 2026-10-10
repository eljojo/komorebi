// The schema (spec §4). Timestamps are integer milliseconds. Migrations in migrations/ are generated from
// this file by `npm run db:generate`; never edit a generated migration.
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  // The WebAuthn user handle (base64url of opaque random bytes), the same for every passkey of the account. Set at
  // sign-up; the migration that added it gave existing users one. Never derived from anything about the person.
  webauthnUserId: text('webauthn_user_id').unique(),
  createdAt: integer('created_at').notNull(),
});

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id),
    label: text('label').notNull(),
    // `write` includes read.
    scope: text('scope', { enum: ['read', 'write'] }).notNull(),
    // sha-256 hex of the token; the token itself is shown once and never stored.
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [
    check('api_tokens_scope', sql`${t.scope} in ('read', 'write')`),
    check('api_tokens_label', sql`length(${t.label}) between 1 and 40`),
    index('api_tokens_user').on(t.userId),
  ],
);

export const presets = sqliteTable(
  'presets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('owner_id').notNull().references(() => users.id),
    visibility: text('visibility', { enum: ['public', 'unlisted', 'private'] }).notNull().default('private'),
    // Generated for every preset, so going unlisted later needs no extra step.
    shareToken: text('share_token').notNull().unique(),
    // No foreign key: presets and preset_versions reference each other, and a version needs its preset first.
    headVersionId: integer('head_version_id'),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [check('presets_visibility', sql`${t.visibility} in ('public', 'unlisted', 'private')`), index('presets_owner').on(t.ownerId)],
);

// Append-only: never updated, never deleted.
export const presetVersions = sqliteTable(
  'preset_versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    presetId: integer('preset_id').notNull().references(() => presets.id),
    n: integer('n').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    // The exact JSON text the sender wrote for `params`. Re-serialising a parsed object would be a rewrite (spec §2.3).
    params: text('params').notNull(),
    komorebiCommit: text('komorebi_commit'),
    parent: text('parent'),
    via: text('via').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [unique('preset_versions_preset_n').on(t.presetId, t.n)],
);

export const playlists = sqliteTable(
  'playlists',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('owner_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    description: text('description'),
    visibility: text('visibility', { enum: ['public', 'unlisted', 'private'] }).notNull().default('private'),
    shareToken: text('share_token').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [check('playlists_visibility', sql`${t.visibility} in ('public', 'unlisted', 'private')`), index('playlists_owner').on(t.ownerId)],
);

export const playlistItems = sqliteTable(
  'playlist_items',
  {
    playlistId: integer('playlist_id').notNull().references(() => playlists.id),
    position: integer('position').notNull(),
    // A preset, not a version: a playlist always plays the latest.
    presetId: integer('preset_id').notNull().references(() => presets.id),
    dwellS: real('dwell_s').notNull(),
    crossfadeS: real('crossfade_s').notNull(),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.position] })],
);

export const credentials = sqliteTable(
  'credentials',
  {
    // The authenticator's credential id, base64url: what a usernameless login presents to find the account.
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    // COSE public key, base64url.
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull(),
    transports: text('transports', { mode: 'json' }).$type<string[]>(),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('credentials_user').on(t.userId)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    // sha-256 hex of the cookie's value; the value itself is never stored.
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

// Server-side and single-use: a ceremony's challenge is deleted the moment it is looked up, so a captured
// response cannot be replayed with a cookie the client sets itself. The browser holds only `id`.
export const challenges = sqliteTable(
  'challenges',
  {
    id: text('id').primaryKey(),
    challenge: text('challenge').notNull(),
    purpose: text('purpose', { enum: ['register', 'login', 'add-passkey'] }).notNull(),
    // Null for sign-up and login, where nobody is known yet.
    userId: integer('user_id').references(() => users.id),
    pendingUsername: text('pending_username'),
    // Sign-up only: the user handle sent in the options, kept until the account exists to hold it.
    pendingUserHandle: text('pending_user_handle'),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    check('challenges_purpose', sql`${t.purpose} in ('register', 'login', 'add-passkey')`),
    // Every ceremony sweeps the expired ones.
    index('challenges_expires').on(t.expiresAt),
  ],
);

export const rateEvents = sqliteTable(
  'rate_events',
  {
    ip: text('ip').notNull(),
    action: text('action').notNull(),
    at: integer('at').notNull(),
  },
  // (ip, action, at) serves the counts; `at` alone serves the sweep of rows older than the window.
  (t) => [index('rate_events_ip_action').on(t.ip, t.action, t.at), index('rate_events_at').on(t.at)],
);
