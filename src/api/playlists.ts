import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type Actor, type AppEnv, type Ctx, secured } from '../auth';
import { LIMITS } from '../config';
import { type Db, connect } from '../db/client';
import { playlistItems, playlists, presetVersions, presets, users } from '../db/schema';
import { ApiError } from '../errors';
import { randomBase64Url } from '../random';
import { validateMeta } from '../validate';
import { canSee } from './access';
import { isVisibility, parseId, readJsonBody } from './util';

const MAX_ITEMS = 500;
const DWELL = { min: 1, max: 3600, default: 30 };
const CROSSFADE = { min: 0, max: 120, default: 5 };
// D1 allows 100 bound parameters per statement; an item row binds 5.
const ROWS_PER_INSERT = 19;

type PlaylistRow = { playlist: typeof playlists.$inferSelect; owner: string };

async function loadPlaylist(db: Db, id: number | null): Promise<PlaylistRow | undefined> {
  if (id === null) return undefined;
  const [row] = await db
    .select({ playlist: playlists, owner: users.username })
    .from(playlists)
    .innerJoin(users, eq(users.id, playlists.ownerId))
    .where(eq(playlists.id, id));
  return row;
}

async function loadItems(db: Db, playlistId: number) {
  return db
    .select({ item: playlistItems, preset: presets, head: presetVersions })
    .from(playlistItems)
    .innerJoin(presets, eq(presets.id, playlistItems.presetId))
    .innerJoin(presetVersions, eq(presetVersions.id, presets.headVersionId))
    .where(eq(playlistItems.playlistId, playlistId))
    .orderBy(playlistItems.position);
}

function summary(row: PlaylistRow, viewer: Actor | null) {
  const { playlist } = row;
  return {
    id: playlist.id,
    owner: row.owner,
    name: playlist.name,
    description: playlist.description,
    created_at: playlist.createdAt,
    updated_at: playlist.updatedAt,
    ...(viewer?.userId === playlist.ownerId && { visibility: playlist.visibility, share_token: playlist.shareToken }),
  };
}

// The playlist with the items as this viewer may see them (spec §4.2): the rest are left out silently, and
// only the owner is told how many.
async function playlistView(db: Db, row: PlaylistRow, viewer: Actor | null) {
  const all = await loadItems(db, row.playlist.id);
  // An archived preset is skipped even for its own author: playlists never play what is archived.
  const visible = all.filter((i) => !i.preset.archivedAt && canSee(i.preset, viewer, undefined));
  return {
    ...summary(row, viewer),
    items: visible.map((i) => ({
      preset_id: i.preset.id,
      name: i.head.name,
      dwell_s: i.item.dwellS,
      crossfade_s: i.item.crossfadeS,
      params: JSON.parse(i.head.params),
    })),
    ...(viewer?.userId === row.playlist.ownerId && { unavailable: all.length - visible.length }),
  };
}

async function visiblePlaylist(c: Ctx, actor: Actor | null): Promise<PlaylistRow> {
  const row = await loadPlaylist(connect(c.env.DB), parseId(c.req.param('id')));
  if (!row || !canSee(row.playlist, actor, c.req.query('k'))) throw new ApiError(404, 'not found');
  return row;
}

async function ownedPlaylist(c: Ctx, actor: Actor): Promise<PlaylistRow> {
  const row = await visiblePlaylist(c, actor);
  if (row.playlist.ownerId !== actor.userId) throw new ApiError(403, 'only the owner can do that');
  return row;
}

function checkedMeta(name: unknown, description: unknown) {
  const meta = validateMeta({ name, description });
  if (!meta.ok) throw new ApiError(422, meta.errors.join('; '), { errors: meta.errors });
  return meta.meta;
}

type ParsedItem = { presetId: number; dwellS: number; crossfadeS: number };

function parseItems(raw: unknown): ParsedItem[] {
  if (!Array.isArray(raw)) throw new ApiError(400, 'items must be a list');
  if (raw.length > MAX_ITEMS) throw new ApiError(422, `a playlist holds at most ${MAX_ITEMS} items`);
  const inRange = (v: unknown, r: { min: number; max: number }) => typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;
  return raw.map((item, i) => {
    const at = `item ${i + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new ApiError(422, `${at} must be an object`);
    const { preset_id, dwell_s = DWELL.default, crossfade_s = CROSSFADE.default } = item as Record<string, unknown>;
    if (typeof preset_id !== 'number' || !Number.isSafeInteger(preset_id) || preset_id < 1) throw new ApiError(422, `${at}: preset_id must be a preset's id`);
    if (!inRange(dwell_s, DWELL)) throw new ApiError(422, `${at}: dwell_s must be ${DWELL.min} to ${DWELL.max} seconds`);
    if (!inRange(crossfade_s, CROSSFADE)) throw new ApiError(422, `${at}: crossfade_s must be ${CROSSFADE.min} to ${CROSSFADE.max} seconds`);
    return { presetId: preset_id, dwellS: dwell_s as number, crossfadeS: crossfade_s as number };
  });
}

export function registerPlaylists(app: Hono<AppEnv>) {
  secured(app, 'POST', '/api/playlists', 'write', async (c, actor) => {
    const db = connect(c.env.DB);
    const { body } = await readJsonBody(c);

    let visibility: 'public' | 'unlisted' | 'private' = 'private';
    if (body.visibility !== undefined) {
      if (!isVisibility(body.visibility)) throw new ApiError(400, 'visibility must be public, unlisted or private');
      if (actor.kind === 'token' && body.visibility !== 'private') {
        throw new ApiError(403, 'making a playlist visible needs a person in a browser; a token can only create private playlists');
      }
      visibility = body.visibility;
    }
    const meta = checkedMeta(body.name, body.description);

    const [{ owned }] = await db.select({ owned: count() }).from(playlists).where(eq(playlists.ownerId, actor.userId));
    if (owned >= LIMITS.playlists) throw new ApiError(429, `at most ${LIMITS.playlists} playlists per user`, { limit: 'playlists' });

    const now = Date.now();
    const [created] = await db
      .insert(playlists)
      .values({ ownerId: actor.userId, name: meta.name, description: meta.description ?? null, visibility, shareToken: randomBase64Url(16), createdAt: now, updatedAt: now })
      .returning({ id: playlists.id });
    return c.json(await playlistView(db, (await loadPlaylist(db, created.id))!, actor), 201);
  });

  secured(app, 'GET', '/api/playlists', 'anonymous', async (c, actor) => {
    const db = connect(c.env.DB);
    const who = c.req.query('owner');
    if (!who) throw new ApiError(400, 'owner is required: me, or a username');

    let where;
    let viewer: Actor | null = null;
    if (who === 'me') {
      if (!actor) throw new ApiError(401, 'sign in, or send a bearer token');
      viewer = actor;
      where = eq(playlists.ownerId, actor.userId);
    } else {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.username, who));
      if (!user) throw new ApiError(404, 'not found');
      where = and(eq(playlists.ownerId, user.id), eq(playlists.visibility, 'public'));
    }
    const rows = await db
      .select({ playlist: playlists, owner: users.username })
      .from(playlists)
      .innerJoin(users, eq(users.id, playlists.ownerId))
      .where(where)
      .orderBy(desc(playlists.id));
    return c.json({ playlists: rows.map((r) => summary(r, viewer)) });
  });

  secured(app, 'GET', '/api/playlists/:id', 'anonymous', async (c, actor) =>
    c.json(await playlistView(connect(c.env.DB), await visiblePlaylist(c, actor), actor)),
  );

  secured(app, 'PATCH', '/api/playlists/:id', 'write', async (c, actor) => {
    const db = connect(c.env.DB);
    const row = await ownedPlaylist(c, actor);
    const { body } = await readJsonBody(c);

    const patch: Partial<typeof playlists.$inferInsert> = { updatedAt: Date.now() };
    if ('visibility' in body) {
      // Publishing is a person's act (spec §3.3); a token may not even ask.
      if (actor.kind !== 'session') throw new ApiError(403, 'changing visibility needs a person in a browser; a token cannot do it');
      if (!isVisibility(body.visibility)) throw new ApiError(400, 'visibility must be public, unlisted or private');
      patch.visibility = body.visibility;
    }
    const meta = checkedMeta('name' in body ? body.name : row.playlist.name, 'description' in body ? body.description : (row.playlist.description ?? undefined));
    patch.name = meta.name;
    patch.description = meta.description ?? null;

    await db.update(playlists).set(patch).where(eq(playlists.id, row.playlist.id));
    return c.json(await playlistView(db, (await loadPlaylist(db, row.playlist.id))!, actor));
  });

  secured(app, 'PUT', '/api/playlists/:id/items', 'write', async (c, actor) => {
    const db = connect(c.env.DB);
    const row = await ownedPlaylist(c, actor);
    const { body } = await readJsonBody(c);
    const items = parseItems(body.items);

    // Every preset must be one the owner can see now: their own, or someone else's public one.
    // The ids go in as one JSON parameter because a statement may bind only 100.
    const ids = [...new Set(items.map((i) => i.presetId))];
    const found = await db
      .select({ id: presets.id, ownerId: presets.ownerId, visibility: presets.visibility, shareToken: presets.shareToken, archivedAt: presets.archivedAt })
      .from(presets)
      .where(sql`${presets.id} in (select value from json_each(${JSON.stringify(ids)}))`);
    const usable = new Set(found.filter((p) => canSee(p, actor, undefined)).map((p) => p.id));
    const unusable = ids.filter((id) => !usable.has(id));
    if (unusable.length) throw new ApiError(422, 'some presets are not yours and not public', { preset_ids: unusable });

    const rows = items.map((i, position) => ({ playlistId: row.playlist.id, position, ...i }));
    const inserts = [];
    for (let at = 0; at < rows.length; at += ROWS_PER_INSERT) inserts.push(db.insert(playlistItems).values(rows.slice(at, at + ROWS_PER_INSERT)));
    // One transaction: a failure leaves the old list.
    await db.batch([
      db.delete(playlistItems).where(eq(playlistItems.playlistId, row.playlist.id)),
      ...inserts,
      db.update(playlists).set({ updatedAt: Date.now() }).where(eq(playlists.id, row.playlist.id)),
    ]);
    return c.json(await playlistView(db, (await loadPlaylist(db, row.playlist.id))!, actor));
  });
}
