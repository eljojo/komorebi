import { desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { canSee } from '../api/access';
import type { AppEnv } from '../auth';
import { connect } from '../db/client';
import { playlists, presetVersions, presets, users } from '../db/schema';
import { Layout, WEBAUTHN_BROWSER, Tags, day, notFound, viewerOf } from './layout';

// Only what is not public gets a label: it tells the owner who else can see the thing.
function Visibility(props: { of: 'public' | 'unlisted' | 'private' }) {
  return props.of === 'public' ? null : <span class="label">{props.of}</span>;
}

type LookRow = { preset: typeof presets.$inferSelect; head: typeof presetVersions.$inferSelect };

function Looks(props: { rows: LookRow[] }) {
  return (
    <ul class="plain">
      {props.rows.map((r) => (
        <li>
          <a href={`/p/${r.preset.id}`}>{r.head.name}</a> <Tags tags={r.head.tags} /> <Visibility of={r.preset.visibility} />{' '}
          <span class="when">{day(r.preset.updatedAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function registerFrontPages(app: Hono<AppEnv>) {
  app.get('/', async (c) => {
    const viewer = await viewerOf(c);
    return c.html(
      <Layout title="arboretum" viewer={viewer}>
        <h1>arboretum</h1>
        <p>
          A quiet place where <a href="https://komorebi.eljojo.net">komorebi</a> looks are kept, grouped into playlists, and shared.
        </p>
        <p>Find the right look or playlist here, then open it in komorebi and let it be.</p>
        {viewer ? null : (
          <p>
            <a href="/login">Sign in or sign up</a>.
          </p>
        )}
      </Layout>,
    );
  });

  // Sign-in and sign-up are one page (José, 2026-10-09). Sign-in comes first: it asks for nothing, and a
  // passkey from 1Password or the system answers it.
  app.get('/login', async (c) => {
    const viewer = await viewerOf(c);
    return c.html(
      <Layout title="sign in" viewer={viewer} classic={[WEBAUTHN_BROWSER]} scripts={['/js/login.js', '/js/signup.js']}>
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

  app.get('/u/:username', async (c) => {
    const viewer = await viewerOf(c);
    const db = connect(c.env.DB);
    const [user] = await db.select().from(users).where(eq(users.username, c.req.param('username').toLowerCase()));
    if (!user) return notFound(c, viewer);

    // The same `canSee` for everyone: a stranger gets the public view, and the owner gets everything of theirs,
    // so the owner can find their own private looks from any machine (spec §12) and unarchive what they shelved.
    const shown = (await db
      .select({ preset: presets, head: presetVersions })
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
                <a href={`/l/${l.id}`}>{l.name}</a> <Visibility of={l.visibility} /> <span class="when">{day(l.updatedAt)}</span>
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
