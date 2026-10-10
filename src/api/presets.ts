import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type Actor, type AppEnv, type Ctx, secured, viaFor } from '../auth';
import { LIMITS } from '../config';
import { type Db, connect } from '../db/client';
import { presetVersions, presets, users } from '../db/schema';
import { ApiError } from '../errors';
import { LOOK_NAMES } from '../generated/engine';
import { randomBase64Url } from '../random';
import { rawMember } from '../rawjson';
import { MAX_PARAMS_BYTES, validateMeta, validateParams } from '../validate';
import { canSee } from './access';
import { isVisibility, parseId, readJsonBody } from './util';

type PresetRow = { preset: typeof presets.$inferSelect; owner: string; head: typeof presetVersions.$inferSelect };

export async function loadPreset(db: Db, id: number | null): Promise<PresetRow | undefined> {
  if (id === null) return undefined;
  const [row] = await db
    .select({ preset: presets, owner: users.username, head: presetVersions })
    .from(presets)
    .innerJoin(users, eq(users.id, presets.ownerId))
    .innerJoin(presetVersions, eq(presetVersions.id, presets.headVersionId))
    .where(eq(presets.id, id));
  return row;
}

// The preset as an API client sees it: the head version plus the preset's own fields. The owner also sees who
// else can see it.
export function presetView(row: PresetRow, viewer: Actor | null, withParams = true) {
  const { preset, head } = row;
  return {
    id: preset.id,
    owner: row.owner,
    name: head.name,
    description: head.description,
    tags: head.tags,
    version: head.n,
    komorebi_commit: head.komorebiCommit,
    parent: head.parent,
    via: head.via,
    created_at: preset.createdAt,
    updated_at: preset.updatedAt,
    ...(withParams && { params: JSON.parse(head.params) }),
    ...(viewer?.userId === preset.ownerId && {
      visibility: preset.visibility,
      share_token: preset.shareToken,
      archived: preset.archivedAt !== null,
    }),
  };
}

const notFound = () => new ApiError(404, 'not found');

async function visiblePreset(c: Ctx, actor: Actor | null): Promise<PresetRow> {
  const row = await loadPreset(connect(c.env.DB), parseId(c.req.param('id')));
  if (!row || !canSee(row.preset, actor, c.req.query('k'))) throw notFound();
  return row;
}

async function ownedPreset(c: Ctx, actor: Actor): Promise<PresetRow> {
  const row = await loadPreset(connect(c.env.DB), parseId(c.req.param('id')));
  // Not visible reads as missing; visible but someone else's is a plain refusal.
  if (!row || !canSee(row.preset, actor, undefined)) throw notFound();
  if (row.preset.ownerId !== actor.userId) throw new ApiError(403, 'only the owner can do that');
  return row;
}

type VersionFields = {
  name: string;
  description: string | null;
  tags: string[];
  params: string;
  komorebiCommit: string | null;
  parent: string | null;
};

// What a new version says, from the body, with anything left out carried over from `head`. Throws on a refusal.
async function versionFields(c: Ctx, db: Db, actor: Actor, body: Record<string, unknown>, text: string, head: PresetRow['head'] | null): Promise<VersionFields> {
  const has = (key: string) => key in body;

  const meta = validateMeta({
    name: has('name') ? body.name : head?.name,
    description: has('description') ? body.description : (head?.description ?? undefined),
    tags: has('tags') ? body.tags : head?.tags,
  });
  if (!meta.ok) throw new ApiError(422, meta.errors.join('; '), { errors: meta.errors });

  let params: string;
  if (has('params') || !head) {
    const refusal = validateParams(body.params);
    if (!refusal.ok) throw new ApiError(422, refusal.message, { reason: refusal.reason, keys: refusal.keys });
    params = rawMember(text, 'params')!;
    // The validator measures the parsed value; padding with whitespace must not get past it.
    if (new TextEncoder().encode(params).length > MAX_PARAMS_BYTES) {
      throw new ApiError(422, 'params is over 16 KB', { reason: 'too_large', keys: [] });
    }
  } else {
    params = head.params;
  }

  let komorebiCommit = head?.komorebiCommit ?? null;
  if (has('komorebi_commit')) {
    if (typeof body.komorebi_commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(body.komorebi_commit)) {
      throw new ApiError(422, 'komorebi_commit must be 7 to 40 lowercase hex characters');
    }
    komorebiCommit = body.komorebi_commit;
  }

  let parent = head?.parent ?? null;
  if (has('parent')) parent = await checkedParent(c, db, actor, body.parent);

  return { name: meta.meta.name, description: meta.meta.description ?? null, tags: meta.meta.tags, params, komorebiCommit, parent };
}

// A parent is a built-in look or a version the actor can see (spec §4.1). Hidden and missing read the same.
async function checkedParent(c: Ctx, db: Db, actor: Actor, parent: unknown): Promise<string> {
  const refuse = () => new ApiError(422, 'parent must be look:<a built-in look name> or preset:<id>@<n> of a version you can see');
  if (typeof parent !== 'string' || parent.length > 120) throw refuse();
  if (parent.startsWith('look:')) {
    if (!LOOK_NAMES.includes(parent.slice(5))) throw refuse();
    return parent;
  }
  const match = /^preset:(\d+)@(\d+)$/.exec(parent);
  const id = parseId(match?.[1]);
  const n = parseId(match?.[2]);
  if (id === null || n === null) throw refuse();
  const row = await loadPreset(db, id);
  if (!row || !canSee(row.preset, actor, undefined)) throw refuse();
  const [version] = await db.select({ id: presetVersions.id }).from(presetVersions).where(and(eq(presetVersions.presetId, id), eq(presetVersions.n, n)));
  if (!version) throw refuse();
  return parent;
}

async function assertVersionQuota(db: Db, ownerId: number) {
  const [{ recent }] = await db
    .select({ recent: count() })
    .from(presetVersions)
    .innerJoin(presets, eq(presets.id, presetVersions.presetId))
    .where(and(eq(presets.ownerId, ownerId), gt(presetVersions.createdAt, Date.now() - 24 * 3600 * 1000)));
  if (recent >= LIMITS.versionsPerDay) {
    throw new ApiError(429, `at most ${LIMITS.versionsPerDay} new versions per 24 hours`, { limit: 'versionsPerDay' });
  }
}

export function registerPresets(app: Hono<AppEnv>) {
  secured(app, 'POST', '/api/presets', 'write', async (c, actor) => {
    const db = connect(c.env.DB);
    const { body, text } = await readJsonBody(c);

    let visibility: 'public' | 'unlisted' | 'private' = 'private';
    if (body.visibility !== undefined) {
      if (!isVisibility(body.visibility)) throw new ApiError(400, 'visibility must be public, unlisted or private');
      if (actor.kind === 'token' && body.visibility !== 'private') {
        throw new ApiError(403, 'making a preset visible needs a person in a browser; a token can only create private presets');
      }
      visibility = body.visibility;
    }

    const fields = await versionFields(c, db, actor, body, text, null);

    const [{ owned }] = await db.select({ owned: count() }).from(presets).where(eq(presets.ownerId, actor.userId));
    if (owned >= LIMITS.presets) throw new ApiError(429, `at most ${LIMITS.presets} presets per user`, { limit: 'presets' });
    await assertVersionQuota(db, actor.userId);

    const now = Date.now();
    // One batch is one transaction: a preset never exists without its first version as head.
    const [[created]] = await db.batch([
      db.insert(presets).values({ ownerId: actor.userId, visibility, shareToken: randomBase64Url(16), createdAt: now, updatedAt: now }).returning({ id: presets.id }),
      db.insert(presetVersions).values({ ...fields, presetId: sql`last_insert_rowid()`, n: 1, via: viaFor(actor, c.req.header('Origin') ?? null), createdAt: now }),
      db
        .update(presets)
        .set({ headVersionId: sql`last_insert_rowid()` })
        .where(eq(presets.id, sql`(select preset_id from preset_versions where id = last_insert_rowid())`)),
    ]);
    return c.json(presetView((await loadPreset(db, created.id))!, actor), 201);
  });

  secured(app, 'GET', '/api/presets', 'anonymous', async (c, actor) => {
    const db = connect(c.env.DB);
    const who = c.req.query('owner');
    if (!who) throw new ApiError(400, 'owner is required: me, or a username');

    let where;
    let viewer: Actor | null = null;
    if (who === 'me') {
      if (!actor) throw new ApiError(401, 'sign in, or send a bearer token');
      viewer = actor;
      where = and(eq(presets.ownerId, actor.userId), c.req.query('archived') === '1' ? undefined : isNull(presets.archivedAt));
    } else {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.username, who));
      if (!user) throw notFound();
      where = and(eq(presets.ownerId, user.id), eq(presets.visibility, 'public'), isNull(presets.archivedAt));
    }
    const rows = await db
      .select({ preset: presets, owner: users.username, head: presetVersions })
      .from(presets)
      .innerJoin(users, eq(users.id, presets.ownerId))
      .innerJoin(presetVersions, eq(presetVersions.id, presets.headVersionId))
      .where(where)
      .orderBy(desc(presets.id));
    return c.json({ presets: rows.map((r) => presetView(r, viewer, false)) });
  });

  secured(app, 'GET', '/api/presets/:id', 'anonymous', async (c, actor) => c.json(presetView(await visiblePreset(c, actor), actor)));

  secured(app, 'POST', '/api/presets/:id/versions', 'write', async (c, actor) => {
    const db = connect(c.env.DB);
    const row = await ownedPreset(c, actor);
    const { body, text } = await readJsonBody(c);
    if ('visibility' in body) throw new ApiError(400, 'visibility is not part of a version; change it with PATCH /api/presets/:id');

    const fields = await versionFields(c, db, actor, body, text, row.head);
    await assertVersionQuota(db, actor.userId);

    const now = Date.now();
    const id = row.preset.id;
    await db.batch([
      db.insert(presetVersions).values({
        ...fields,
        presetId: id,
        n: sql`(select coalesce(max(n), 0) + 1 from preset_versions where preset_id = ${id})`,
        via: viaFor(actor, c.req.header('Origin') ?? null),
        createdAt: now,
      }),
      db.update(presets).set({ headVersionId: sql`last_insert_rowid()`, updatedAt: now }).where(eq(presets.id, id)),
    ]);
    return c.json(presetView((await loadPreset(db, id))!, actor), 201);
  });

  secured(app, 'GET', '/api/presets/:id/versions', 'anonymous', async (c, actor) => {
    const row = await visiblePreset(c, actor);
    const versions = await connect(c.env.DB).select().from(presetVersions).where(eq(presetVersions.presetId, row.preset.id)).orderBy(presetVersions.n);
    return c.json({ versions: versions.map((v) => ({ n: v.n, name: v.name, via: v.via, created_at: v.createdAt })) });
  });

  secured(app, 'GET', '/api/presets/:id/versions/:n', 'anonymous', async (c, actor) => {
    const row = await visiblePreset(c, actor);
    const n = parseId(c.req.param('n'));
    if (n === null) throw notFound();
    const [v] = await connect(c.env.DB).select().from(presetVersions).where(and(eq(presetVersions.presetId, row.preset.id), eq(presetVersions.n, n)));
    if (!v) throw notFound();
    return c.json(versionView(v));
  });

  // Not versioned: who can see a look is not part of the look (spec §9). A person's act, never a token's.
  secured(app, 'PATCH', '/api/presets/:id', 'session', async (c, actor) => {
    const db = connect(c.env.DB);
    const row = await ownedPreset(c, actor);
    const { body } = await readJsonBody(c);
    if (!isVisibility(body.visibility)) throw new ApiError(400, 'visibility must be public, unlisted or private');
    await db.update(presets).set({ visibility: body.visibility, updatedAt: Date.now() }).where(eq(presets.id, row.preset.id));
    return c.json(presetView((await loadPreset(db, row.preset.id))!, actor));
  });

  for (const action of ['archive', 'unarchive'] as const) {
    secured(app, 'POST', `/api/presets/:id/${action}`, 'session', async (c, actor) => {
      const db = connect(c.env.DB);
      const row = await ownedPreset(c, actor);
      const now = Date.now();
      await db
        .update(presets)
        .set({ archivedAt: action === 'archive' ? (row.preset.archivedAt ?? now) : null, updatedAt: now })
        .where(eq(presets.id, row.preset.id));
      return c.json(presetView((await loadPreset(db, row.preset.id))!, actor));
    });
  }
}

export function versionView(v: typeof presetVersions.$inferSelect) {
  return {
    preset_id: v.presetId,
    n: v.n,
    name: v.name,
    description: v.description,
    tags: v.tags,
    params: JSON.parse(v.params),
    komorebi_commit: v.komorebiCommit,
    parent: v.parent,
    via: v.via,
    created_at: v.createdAt,
  };
}
