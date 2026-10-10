import type { Hono } from 'hono';
import { canSee } from '../api/access';
import { loadPlaylist, playlistView } from '../api/playlists';
import { parseId } from '../api/util';
import type { AppEnv } from '../auth';
import { connect } from '../db/client';
import engine from '../../public/engine/engine.json';
import { komorebiPlaylistLink } from './links';
import { Layout, notFound, viewerOf } from './layout';

export function registerPlaylistPages(app: Hono<AppEnv>) {
  app.get('/l/:id', async (c) => {
    const viewer = await viewerOf(c);
    const db = connect(c.env.DB);
    const row = await loadPlaylist(db, parseId(c.req.param('id')));
    if (!row || !canSee(row.playlist, viewer, c.req.query('k'))) return notFound(c, viewer);

    const { playlist } = row;
    // The same view the API serves: what this viewer may not see is already left out, and only the owner gets a count.
    const view = await playlistView(db, row, viewer);
    const isOwner = viewer?.userId === playlist.ownerId;
    const k = playlist.visibility === 'unlisted' ? playlist.shareToken : undefined;
    const unavailable = view.unavailable ?? 0;

    return c.html(
      <Layout
        title={playlist.name}
        viewer={viewer}
        scripts={[...(view.items.length ? ['/js/player.js'] : []), ...(isOwner ? ['/js/owner-playlist.js'] : [])]}
      >
        <h1>{playlist.name}</h1>
        <p class="meta">
          by <a href={`/u/${row.owner}`}>{row.owner}</a>
        </p>
        {playlist.description ? <p>{playlist.description}</p> : null}
        {view.items.length ? (
          <figure class="preview">
            <canvas id="player" data-src={`/api/playlists/${playlist.id}${k ? `?k=${k}` : ''}`} data-engine={engine.file}></canvas>
            <figcaption>
              <button id="prev" type="button">previous</button> <button id="next" type="button">next</button>
            </figcaption>
          </figure>
        ) : (
          <p class="quiet">nothing to play yet</p>
        )}
        <p>
          <a class="primary" href={komorebiPlaylistLink(playlist.id, k)}>play in komorebi</a>
        </p>
        <ol id="items" class="plain">
          {view.items.map((i) => (
            <li data-preset={i.preset_id} data-dwell={i.dwell_s} data-crossfade={i.crossfade_s}>
              <a href={`/p/${i.preset_id}`}>{i.name}</a>{' '}
              <span class="when">
                {i.dwell_s} s · crossfade {i.crossfade_s} s
              </span>
            </li>
          ))}
        </ol>
        {isOwner && unavailable > 0 ? <p class="quiet">{unavailable === 1 ? '1 item unavailable' : `${unavailable} items unavailable`}</p> : null}
        {isOwner ? (
          <section id="owner-controls" data-playlist={playlist.id} hidden>
            <h2>yours</h2>
            <p>
              <label>
                visibility{' '}
                <select name="visibility">
                  {(['private', 'unlisted', 'public'] as const).map((v) => (
                    <option value={v} selected={v === playlist.visibility}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            {playlist.visibility === 'unlisted' ? (
              <p>
                share link <input class="share" readonly value={`${c.env.ORIGIN}/l/${playlist.id}?k=${playlist.shareToken}`} />
              </p>
            ) : null}
            <p>
              <button id="save-items" type="button">save the list</button>
              {unavailable > 0 ? ' Saving drops the items that are unavailable.' : null}
            </p>
            <p class="msg" role="status"></p>
          </section>
        ) : null}
      </Layout>,
    );
  });
}
