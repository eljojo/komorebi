// The schema (spec §4). Timestamps are integer milliseconds. Migrations in migrations/ are generated from
// this file by `npm run db:generate`; never edit a generated migration.
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
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
