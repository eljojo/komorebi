import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type AppEnv, secured } from '../auth';
import { connect } from '../db/client';
import { playlistItems, playlists, presetVersions, presets } from '../db/schema';
import { ENGINE_COMMIT } from '../generated/engine';
import { versionView } from './presets';

// Your backup: everything the actor's user owns, archived presets and private ones included. A version's
// `params` is the parsed object; `params_text` is the exact text that was stored (spec §2.3), which is what a restore would use.
export function registerExport(app: Hono<AppEnv>) {
  secured(app, 'GET', '/api/export', 'read', async (c, actor) => {
    const db = connect(c.env.DB);

    const owned = await db.select().from(presets).where(eq(presets.ownerId, actor.userId)).orderBy(presets.id);
    const versions = await db
      .select({ version: presetVersions })
      .from(presetVersions)
      .innerJoin(presets, eq(presets.id, presetVersions.presetId))
      .where(eq(presets.ownerId, actor.userId))
      .orderBy(presetVersions.presetId, presetVersions.n);

    const lists = await db.select().from(playlists).where(eq(playlists.ownerId, actor.userId)).orderBy(playlists.id);
    const items = await db
      .select({ item: playlistItems })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
      .where(eq(playlists.ownerId, actor.userId))
      .orderBy(playlistItems.playlistId, playlistItems.position);

    return c.json({
      exported_at: Date.now(),
      engine_commit: ENGINE_COMMIT,
      username: actor.username,
      presets: owned.map((p) => ({
        id: p.id,
        visibility: p.visibility,
        share_token: p.shareToken,
        archived_at: p.archivedAt,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
        versions: versions.filter((v) => v.version.presetId === p.id).map((v) => ({ ...versionView(v.version), params_text: v.version.params })),
      })),
      playlists: lists.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        visibility: l.visibility,
        share_token: l.shareToken,
        created_at: l.createdAt,
        updated_at: l.updatedAt,
        items: items
          .filter((i) => i.item.playlistId === l.id)
          .map((i) => ({ position: i.item.position, preset_id: i.item.presetId, dwell_s: i.item.dwellS, crossfade_s: i.item.crossfadeS })),
      })),
    });
  });
}
