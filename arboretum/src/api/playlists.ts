import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type Actor, type AppEnv, type Ctx, secured } from '../auth';
import { LIMITS } from '../config';
import { type Db, connect } from '../db/client';
import { playlistItems, playlists, presetVersions, presets, users } from '../db/schema';
import { ApiError } from '../errors';
import { randomBase64Url } from '../random';
import { validateMeta } from '../validate';
import { PRESENTATION_IDS } from '../generated/engine';
import { canSee } from './access';
import { isVisibility, parseId, readJsonBody, visibilityChange } from './util';

const MAX_ITEMS = 500;
const DWELL = { min: 1, max: 3600, default: 30 };
const CROSSFADE = { min: 0, max: 120, default: 5 };
const STYLES = ['morph', 'fade'] as const;
type Style = (typeof STYLES)[number];
// D1 allows 100 bound parameters per statement; an item row binds 6.
const ROWS_PER_INSERT = 16;

type PlaylistRow = { playlist: typeof playlists.$inferSelect; owner: string };

export async function loadPlaylist(db: Db, id: number | null): Promise<PlaylistRow | undefined> {
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
    .select({ item: playlistItems, preset: presets, head: presetVersions, presetOwner: users.username })
    .from(playlistItems)
    .innerJoin(presets, eq(presets.id, playlistItems.presetId))
    .innerJoin(users, eq(users.id, presets.ownerId))
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
    ...(playlist.presentation === null ? {} : { presentation:playlist.presentation }),
    created_at: playlist.createdAt,
    updated_at: playlist.updatedAt,
    ...(viewer?.userId === playlist.ownerId && { visibility: playlist.visibility, share_token: playlist.shareToken, revision: playlist.revision }),
  };
}

// The playlist with the items as this viewer may see them (spec §4.2). Other people simply get fewer items. The
// owner gets the unavailable ones too, in their places and with nothing but their times, so the list they edit
// is whole and saving it does not drop an item that may come back; they are also told how many.
type PlayableItem = { preset_id: number; version: number; owner: string; name: string; dwell_s: number; crossfade_s: number; style: Style; params: unknown };
type UnavailableItem = { preset_id: number; dwell_s: number; crossfade_s: number; style: Style; unavailable: true };

export async function playlistView(db: Db, row: PlaylistRow, viewer: Actor | null) {
  const all = await loadItems(db, row.playlist.id);
  const isOwner = viewer?.userId === row.playlist.ownerId;
  // An archived preset is skipped even for its own author: playlists never play what is archived.
  const available = (i: (typeof all)[number]) => !i.preset.archivedAt && canSee(i.preset, viewer, undefined);
  return {
    ...summary(row, viewer),
    items: all.flatMap((i): (PlayableItem | UnavailableItem)[] => {
      if (available(i)) {
        return [{ preset_id: i.preset.id, version: i.head.n, owner: i.presetOwner, name: i.head.name, dwell_s: i.item.dwellS, crossfade_s: i.item.crossfadeS, style: i.item.style, params: JSON.parse(i.head.params) }];
      }
      return isOwner ? [{ preset_id: i.preset.id, dwell_s: i.item.dwellS, crossfade_s: i.item.crossfadeS, style: i.item.style, unavailable: true }] : [];
    }),
    ...(isOwner && { unavailable: all.filter((i) => !available(i)).length }),
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

// Anyone sees a public or unlisted playlist at once, so changing one is a person's act (spec §3.3).
function assertTokenMayChange(actor: Actor, row: PlaylistRow) {
  if (actor.kind === 'token' && row.playlist.visibility !== 'private') throw visibleRefusal();
}

// The same rule as a condition of the write itself, for the statements below: the owner may have published the
// playlist since `assertTokenMayChange` read it. A session has no such restriction.
const privateIfToken = (actor: Actor) => (actor.kind === 'token' ? sql`visibility = 'private'` : sql`1`);
const visibleRefusal = () => new ApiError(403, 'changing a visible playlist needs a person in a browser; tokens can only change private playlists');

function checkedMeta(name: unknown, description: unknown) {
  const meta = validateMeta({ name, description });
  if (!meta.ok) throw new ApiError(422, meta.errors.join('; '), { errors: meta.errors });
  return meta.meta;
}

function checkedPresentation(value: unknown): string | null {
  if(value === undefined || value === null)return null;
  if(typeof value !== 'string' || !PRESENTATION_IDS.includes(value))throw new ApiError(422,'presentation must be a shipped profile or null');
  return value;
}

type ParsedItem = { presetId: number; dwellS: number; crossfadeS: number; style: Style };

function parseItems(raw: unknown): ParsedItem[] {
  if (!Array.isArray(raw)) throw new ApiError(400, 'items must be a list');
  if (raw.length > MAX_ITEMS) throw new ApiError(422, `a playlist holds at most ${MAX_ITEMS} items`);
  const inRange = (v: unknown, r: { min: number; max: number }) => typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;
  return raw.map((item, i) => {
    const at = `item ${i + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new ApiError(422, `${at} must be an object`);
    const { preset_id, dwell_s = DWELL.default, crossfade_s = CROSSFADE.default, style = 'morph' } = item as Record<string, unknown>;
    if (typeof preset_id !== 'number' || !Number.isSafeInteger(preset_id) || preset_id < 1) throw new ApiError(422, `${at}: preset_id must be a preset's id`);
    if (!inRange(dwell_s, DWELL)) throw new ApiError(422, `${at}: dwell_s must be ${DWELL.min} to ${DWELL.max} seconds`);
    if (!inRange(crossfade_s, CROSSFADE)) throw new ApiError(422, `${at}: crossfade_s must be ${CROSSFADE.min} to ${CROSSFADE.max} seconds`);
    if (!STYLES.includes(style as Style)) throw new ApiError(422, `${at}: style must be ${STYLES.map((s) => `"${s}"`).join(' or ')}`);
    return { presetId: preset_id, dwellS: dwell_s as number, crossfadeS: crossfade_s as number, style: style as Style };
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
    const presentation=checkedPresentation(body.presentation);

    // The limit is part of the insert, so a burst of parallel requests cannot each pass a count made before the others landed.
    const now = Date.now();
    const [created] = await db.all<{ id: number }>(sql`
      insert into playlists (owner_id, name, description, visibility, share_token, created_at, updated_at, presentation)
      select ${actor.userId}, ${meta.name}, ${meta.description ?? null}, ${visibility}, ${randomBase64Url(16)}, ${now}, ${now}, ${presentation}
      where (select count(*) from playlists where owner_id = ${actor.userId}) < ${LIMITS.playlists}
      returning id`);
    if (!created) throw new ApiError(429, `at most ${LIMITS.playlists} playlists per user`, { limit: 'playlists' });
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

    const patch: Partial<Omit<typeof playlists.$inferInsert,'revision'>> & {revision?:number|SQL} = { updatedAt: Date.now() };
    const guards=[];
    if('presentation' in body){
      patch.presentation=checkedPresentation(body.presentation);
      if(!Number.isSafeInteger(body.revision) || (body.revision as number)<0)throw new ApiError(400,'revision must be the nonnegative integer returned by GET /api/playlists/:id');
      guards.push(eq(playlists.revision,body.revision as number));
      patch.revision=sql`${playlists.revision}+1`;
    }
    if ('visibility' in body) {
      // Publishing is a person's act (spec §3.3); a token may not even ask.
      if (actor.kind !== 'session') throw new ApiError(403, 'changing visibility needs a person in a browser; a token cannot do it');
      if (!isVisibility(body.visibility)) throw new ApiError(400, 'visibility must be public, unlisted or private');
      Object.assign(patch, visibilityChange(body.visibility));
    }
    assertTokenMayChange(actor, row);
    const meta = checkedMeta('name' in body ? body.name : row.playlist.name, 'description' in body ? body.description : (row.playlist.description ?? undefined));
    if ('name' in body) patch.name = meta.name;
    if ('description' in body) patch.description = meta.description ?? null;

    const updated = await db.update(playlists).set(patch).where(and(eq(playlists.id, row.playlist.id), privateIfToken(actor),...guards)).returning({ id: playlists.id });
    if (!updated.length) {
      assertTokenMayChange(actor,(await loadPlaylist(db,row.playlist.id))!);
      if('presentation' in body)throw new ApiError(409,'that playlist changed; reload it before saving presentation');
      throw visibleRefusal();
    }
    return c.json(await playlistView(db, (await loadPlaylist(db, row.playlist.id))!, actor));
  });

  secured(app, 'PUT', '/api/playlists/:id/items', 'write', async (c, actor) => {
    const db = connect(c.env.DB);
    const row = await ownedPlaylist(c, actor);
    assertTokenMayChange(actor, row);
    const { body } = await readJsonBody(c);
    const items = parseItems(body.items);
    const revision = body.revision;
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      throw new ApiError(400, 'revision must be the nonnegative integer returned by GET /api/playlists/:id');
    }

    // Every new preset must be one the owner can see now: their own, or someone else's public one. One that is
    // already in this list stays acceptable when it has become unavailable, or saving would drop it (§4.2).
    // The ids go in as one JSON parameter because a statement may bind only 100.
    const ids = [...new Set(items.map((i) => i.presetId))];
    const found = await db
      .select({ id: presets.id, ownerId: presets.ownerId, visibility: presets.visibility, shareToken: presets.shareToken, archivedAt: presets.archivedAt })
      .from(presets)
      .where(sql`${presets.id} in (select value from json_each(${JSON.stringify(ids)}))`);
    const listed = new Set((await db.select({ id: playlistItems.presetId }).from(playlistItems).where(eq(playlistItems.playlistId, row.playlist.id))).map((r) => r.id));
    const usable = new Set(found.filter((p) => listed.has(p.id) || canSee(p, actor, undefined)).map((p) => p.id));
    const unusable = ids.filter((id) => !usable.has(id));
    if (unusable.length) throw new ApiError(422, 'some presets are not yours and not public', { preset_ids: unusable });

    // The first statement reserves this revision and checks private-only writers atomically. A mismatch assigns
    // NULL to a NOT NULL column, aborting the whole batch before the old list can be deleted, even for an empty PUT.
    const rows = items.map((i, position) => ({ playlistId: row.playlist.id, position, ...i }));
    const inserts = [];
    for (let at = 0; at < rows.length; at += ROWS_PER_INSERT) inserts.push(db.insert(playlistItems).values(rows.slice(at, at + ROWS_PER_INSERT)));
    const touch = db.update(playlists).set({
      updatedAt: Date.now(),
      revision: sql<number>`(select ${playlists.revision} + 1 where ${playlists.revision} = ${revision} and ${privateIfToken(actor)})`,
    }).where(eq(playlists.id, row.playlist.id));
    try {
      await db.batch([
        touch,
        db.delete(playlistItems).where(eq(playlistItems.playlistId, row.playlist.id)),
        // One transaction: a failure leaves the old list.
        ...inserts,
      ]);
    } catch (err) {
      if (/NOT NULL constraint failed: playlists\.revision/i.test(`${err} ${(err as { cause?: unknown })?.cause}`)) {
        assertTokenMayChange(actor, (await loadPlaylist(db, row.playlist.id))!);
        throw new ApiError(409, 'that playlist changed; reload it before saving the list');
      }
      throw err;
    }
    return c.json(await playlistView(db, (await loadPlaylist(db, row.playlist.id))!, actor));
  });
}
