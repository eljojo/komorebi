import { and, desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { canSee } from '../api/access';
import { loadPreset } from '../api/presets';
import { parseId } from '../api/util';
import type { Actor, AppEnv, Ctx } from '../auth';
import { connect } from '../db/client';
import { presetVersions } from '../db/schema';
import engine from '../../public/engine/engine.json';
import { komorebiPresetLink } from './links';
import { Layout, Tags, day, notFound, viewerOf } from './layout';

type Row = NonNullable<Awaited<ReturnType<typeof loadPreset>>>;

// `k` rides on a link only while the preset is unlisted: it is the secret that lets a stranger in.
const shareKey = (row: Row) => (row.preset.visibility === 'unlisted' ? row.preset.shareToken : undefined);
const withK = (k: string | undefined) => (k ? `?k=${k}` : '');

async function visibleRow(c: Ctx, viewer: Actor | null): Promise<Row | null> {
  const row = await loadPreset(connect(c.env.DB), parseId(c.req.param('id')));
  return row && canSee(row.preset, viewer, c.req.query('k')) ? row : null;
}

// The note comes before the preview so that a dark frame on a screen reads as intended (spec §4.3).
function Look(props: { tags: string[]; src: string }) {
  return (
    <>
      {props.tags.includes('projector') ? <p class="note">made for a projector in the yard; on a screen it looks wrong on purpose</p> : null}
      <figure class="preview">
        <canvas id="preview" data-src={props.src} data-engine={engine.file}></canvas>
      </figure>
    </>
  );
}

function OwnerControls(props: { row: Row; origin: string }) {
  const { preset } = props.row;
  return (
    <section id="owner-controls" data-preset={preset.id} hidden>
      <h2>yours</h2>
      <p>
        <label>
          visibility{' '}
          <select name="visibility">
            {(['private', 'unlisted', 'public'] as const).map((v) => (
              <option value={v} selected={v === preset.visibility}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </p>
      {preset.visibility === 'unlisted' ? (
        <p>
          share link <input class="share" readonly value={`${props.origin}/p/${preset.id}?k=${preset.shareToken}`} />
        </p>
      ) : null}
      <p>
        {preset.archivedAt ? (
          <button id="unarchive" type="button">unarchive</button>
        ) : (
          <button id="archive" type="button">archive</button>
        )}
      </p>
      <details id="new-version">
        <summary>new version</summary>
        <form>
          <label>
            paste params as JSON
            <textarea name="params" rows={6} spellcheck={false} required></textarea>
          </label>
          <button type="submit">save as a new version</button>
        </form>
      </details>
      <details id="add-to-playlist">
        <summary>add to playlist</summary>
        <form>
          <select name="playlist"></select>
          <input name="name" placeholder="name of the new playlist" hidden />
          <button type="submit">add</button>
        </form>
      </details>
      <p class="msg" role="status"></p>
    </section>
  );
}

export function registerPresetPages(app: Hono<AppEnv>) {
  app.get('/p/:id', async (c) => {
    const viewer = await viewerOf(c);
    const row = await visibleRow(c, viewer);
    if (!row) return notFound(c, viewer);
    const { preset, head } = row;
    const k = shareKey(row);
    const isOwner = viewer?.userId === preset.ownerId;
    return c.html(
      <Layout title={head.name} viewer={viewer} scripts={['/js/preview.js', ...(isOwner ? ['/js/owner-preset.js'] : [])]}>
        <h1>{head.name}</h1>
        <p class="meta">
          by <a href={`/u/${row.owner}`}>{row.owner}</a> <Tags tags={head.tags} />
        </p>
        {head.description ? <p>{head.description}</p> : null}
        <Look tags={head.tags} src={`/api/presets/${preset.id}${withK(k)}`} />
        <p>
          <a class="primary" href={komorebiPresetLink(preset.id, { k })}>open in komorebi</a>
        </p>
        <p class="meta">
          version {head.n} · <a href={`/p/${preset.id}/history${withK(k)}`}>history</a>
        </p>
        {isOwner ? <OwnerControls row={row} origin={c.env.ORIGIN} /> : null}
      </Layout>,
    );
  });

  app.get('/p/:id/history', async (c) => {
    const viewer = await viewerOf(c);
    const row = await visibleRow(c, viewer);
    if (!row) return notFound(c, viewer);
    const { preset, head } = row;
    const k = shareKey(row);
    const versions = await connect(c.env.DB).select().from(presetVersions).where(eq(presetVersions.presetId, preset.id)).orderBy(desc(presetVersions.n));
    return c.html(
      <Layout title={`history of ${head.name}`} viewer={viewer}>
        <h1>{head.name}</h1>
        <p class="meta">
          <a href={`/p/${preset.id}${withK(k)}`}>back to the look</a>
        </p>
        <h2>history</h2>
        <ul class="plain">
          {versions.map((v) => (
            <li>
              <span class="n">{v.n}</span> <a href={`/p/${preset.id}/v/${v.n}${withK(k)}`}>{v.name}</a>{' '}
              <span class="when">{v.via} · {day(v.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Layout>,
    );
  });

  app.get('/p/:id/v/:n', async (c) => {
    const viewer = await viewerOf(c);
    const row = await visibleRow(c, viewer);
    const n = parseId(c.req.param('n'));
    if (!row || n === null) return notFound(c, viewer);
    const [v] = await connect(c.env.DB)
      .select()
      .from(presetVersions)
      .where(and(eq(presetVersions.presetId, row.preset.id), eq(presetVersions.n, n)));
    if (!v) return notFound(c, viewer);
    const k = shareKey(row);
    return c.html(
      <Layout title={v.name} viewer={viewer} scripts={['/js/preview.js']}>
        <h1>{v.name}</h1>
        <p class="meta">
          version {v.n} of <a href={`/p/${row.preset.id}${withK(k)}`}>this look</a> by <a href={`/u/${row.owner}`}>{row.owner}</a> <Tags tags={v.tags} />
        </p>
        {v.description ? <p>{v.description}</p> : null}
        <Look tags={v.tags} src={`/api/presets/${row.preset.id}/versions/${v.n}${withK(k)}`} />
        <p>
          <a class="primary" href={komorebiPresetLink(row.preset.id, { n: v.n, k })}>open this version in komorebi</a>
        </p>
        <p class="meta">
          <span class="when">{v.via} · {day(v.createdAt)}</span> · <a href={`/p/${row.preset.id}/history${withK(k)}`}>history</a>
        </p>
      </Layout>,
    );
  });
}
