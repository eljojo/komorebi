import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { canSee } from '../api/access';
import type { AppEnv } from '../auth';
import { connect } from '../db/client';
import { playlists, presetVersions, presets, users } from '../db/schema';
import { Layout, WEBAUTHN_BROWSER, Tags, day, notFound, viewerOf } from './layout';
import { BASE } from '../config';
import engine from '../../public/engine/engine.json';
import { komorebiPresetLink } from './links';

// How many looks the garden picks. Only the player draws; the rest are quiet entries.
const GARDEN_SIZE = 6;

type Entry = { id: number; name: string; owner: string };

// A few at random, from what anyone may see without a key: public and not archived (`canSee`, for an anonymous viewer).
// We will improve the choosing over time.
async function gardenEntries(db: ReturnType<typeof connect>): Promise<Entry[]> {
  return db
    .select({ id: presets.id, name: presetVersions.name, owner: users.username })
    .from(presets)
    .innerJoin(presetVersions, eq(presetVersions.id, presets.headVersionId))
    .innerJoin(users, eq(users.id, presets.ownerId))
    .where(and(eq(presets.visibility, 'public'), isNull(presets.archivedAt)))
    .orderBy(sql`random()`)
    .limit(GARDEN_SIZE);
}

// One player, and the looks it moves between as the pointer or the keyboard rests on an entry (garden.js). The entries
// are plain, linked text, so the list reads and works without the script; the figure goes where there is no WebGL2.
function Garden(props: { entries: Entry[] }) {
  if (!props.entries.length) return <p class="garden-empty">The garden is quiet for now. Looks that people share will grow here.</p>;
  return (
    <div id="garden" class="garden">
      <figure class="stage">
        <canvas id="stage" data-engine={engine.file}></canvas>
      </figure>
      <ul class="looks">
        {props.entries.map((e) => (
          <li class="look" data-src={`/api/presets/${e.id}`}>
            {/* The name is not a link: a click rests the player on it and a double-click takes it fullscreen (José). */}
            <p class="name">{e.name}</p>
            <p class="by">
              by <a href={`${BASE}/u/${e.owner}`}>{e.owner}</a> · <a href={`${BASE}/p/${e.id}`}>details</a> ·{' '}
              <a href={komorebiPresetLink(e.id)}>open in komorebi</a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Only what is not public gets a label: it tells the owner who else can see the thing.
function Visibility(props: { of: 'public' | 'unlisted' | 'private' }) {
  return props.of === 'public' ? null : <span class="label">{props.of}</span>;
}

type LookRow = { preset: typeof presets.$inferSelect; head: Pick<typeof presetVersions.$inferSelect, 'name' | 'tags'> };

function Looks(props: { rows: LookRow[] }) {
  return (
    <ul class="plain">
      {props.rows.map((r) => (
        <li>
          <a href={`${BASE}/p/${r.preset.id}`}>{r.head.name}</a> <Tags tags={r.head.tags} /> <Visibility of={r.preset.visibility} />{' '}
          <span class="when">{day(r.preset.updatedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function registerFrontPages(app: Hono<AppEnv>) {
  app.get(BASE, async (c) => {
    const viewer = await viewerOf(c);
    const entries = await gardenEntries(connect(c.env.DB));
    return c.html(
      <Layout title="arboretum" viewer={viewer} home wide scripts={entries.length ? [`${BASE}/js/garden.js`] : []}>
        <div class="column">
          <h1>
            arboretum<span class="sub">where looks are kept</span>
          </h1>
          <p>
            Komorebi is sunlight through leaves, and a look is one way of tuning it: a canopy, a sun, a wind, an hour of the day. Arboretum
            is the part of komorebi where looks are kept, so an afternoon you found still loads tomorrow, and where anyone can walk among the
            ones people chose to share.
          </p>
        </div>

        <section class="garden-section">
          <h2>The garden</h2>
          <p class="column">
            A few of the looks people have shared publicly, picked anew each time you come. Rest on one, or tap it, and the light moves to it; open
            it in komorebi and let it be.
          </p>
          <Garden entries={entries} />
        </section>

        <div class="column">
          <h2>Keeping your looks</h2>
          <p>
            Sign in with a passkey and the looks you save from inside komorebi are kept here, ready on your other machines too. There is
            no email and no password, and so no way back if every passkey is lost: add a second one once you are in. Each edit becomes a
            new version, and the older ones stay.
          </p>
          {viewer ? null : (
            <p>
              <a href={`${BASE}/login`}>Sign in or sign up</a>.
            </p>
          )}

          <h2>Playlists</h2>
          <p>
            A playlist is looks in an order, each with a dwell, how long it stays, and a crossfade, how it melts into the next. Play one in
            komorebi and the light drifts from look to look.
          </p>

          <h2>Sharing</h2>
          <p>
            A look you save from komorebi starts out private, and only you can see it. Make it unlisted and anyone who has its link can open it, though it
            is listed nowhere. Make it public and it can appear in the garden above and on your page. Playlists are shared the same way.
          </p>

          <h2>For the curious, and for agents</h2>
          <p>
            Everything here is also a JSON API on the same site, and <a href={`${BASE}/llms.txt`}>llms.txt</a> tells an agent how to use it.
            In <a href={`${BASE}/settings`}>settings</a> you can make a token that lets an agent read, or read and write, as you. What it
            makes stays private; making something public is always your own act, in a browser.
          </p>
        </div>
      </Layout>,
    );
  });

  // Sign-in and sign-up are one page (José, 2026-10-09). Sign-in comes first: it asks for nothing, and a
  // passkey from 1Password or the system answers it.
  app.get(`${BASE}/login`, async (c) => {
    const viewer = await viewerOf(c);
    return c.html(
      <Layout title="sign in" viewer={viewer} classic={[WEBAUTHN_BROWSER]} scripts={[`${BASE}/js/login.js`, `${BASE}/js/signup.js`]}>
        <h1>sign in</h1>
        <p>
          <button id="login" type="button">sign in with a passkey</button>
        </p>
        <p class="msg" role="status"></p>
        <h2>new here?</h2>
        <p>Choose a username, then make a passkey. There is no email and no password.</p>
        <p>
          <strong>There is no recovery.</strong> If you lose every passkey, the account is gone. Add a second passkey in settings once you are in.
        </p>
        <form id="signup">
          <label>
            username
            <input name="username" autocomplete="username webauthn" required minlength={3} maxlength={30} pattern="[a-zA-Z][a-zA-Z0-9\-]{2,29}" />
          </label>
          <button type="submit">make a passkey</button>
          <p class="msg" role="status"></p>
        </form>
        <noscript><p>Passkeys need JavaScript.</p></noscript>
      </Layout>,
    );
  });

  app.get(`${BASE}/u/:username`, async (c) => {
    const viewer = await viewerOf(c);
    const db = connect(c.env.DB);
    const [user] = await db.select().from(users).where(eq(users.username, c.req.param('username').toLowerCase()));
    if (!user) return notFound(c, viewer);

    // The same `canSee` for everyone: a stranger gets the public view, and the owner gets everything of theirs,
    // so the owner can find their own private looks from any machine (spec §12) and unarchive what they shelved.
    const shown = (await db
      .select({ preset: presets, head: { name: presetVersions.name, tags: presetVersions.tags } })
      .from(presets)
      .innerJoin(presetVersions, eq(presetVersions.id, presets.headVersionId))
      .where(eq(presets.ownerId, user.id))
      .orderBy(desc(presets.id))
    ).filter((r) => canSee(r.preset, viewer, undefined));
    const looks = shown.filter((r) => !r.preset.archivedAt);
    const archived = shown.filter((r) => r.preset.archivedAt);
    const lists = (await db.select().from(playlists).where(eq(playlists.ownerId, user.id)).orderBy(desc(playlists.id))).filter((l) =>
      canSee(l, viewer, undefined),
    );

    return c.html(
      <Layout title={user.username} viewer={viewer}>
        <h1>{user.username}</h1>
        <h2>playlists</h2>
        {lists.length ? (
          <ul class="plain">
            {lists.map((l) => (
              <li>
                <a href={`${BASE}/l/${l.id}`}>{l.name}</a> <Visibility of={l.visibility} /> <span class="when">{day(l.updatedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="quiet">none yet</p>
        )}
        <h2>looks</h2>
        {looks.length ? <Looks rows={looks} /> : <p class="quiet">none yet</p>}
        {archived.length ? (
          <>
            <h2 class="quiet">archived</h2>
            <Looks rows={archived} />
          </>
        ) : null}
      </Layout>,
    );
  });
}
