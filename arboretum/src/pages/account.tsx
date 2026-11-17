import type { Hono } from 'hono';
import type { AppEnv, Ctx } from '../auth';
import { TAGS } from '../validate';
import { Layout, WEBAUTHN_BROWSER, viewerOf } from './layout';
import { BASE } from '../config';

// A person's pages: a signed-out visitor, or anyone who is not a person in a browser, is sent to sign in.
async function signedIn(c: Ctx) {
  const viewer = await viewerOf(c);
  return viewer?.kind === 'session' ? viewer : null;
}

export function registerAccountPages(app: Hono<AppEnv>) {
  app.get(`${BASE}/new`, async (c) => {
    const viewer = await signedIn(c);
    if (!viewer) return c.redirect(`${BASE}/login`);
    return c.html(
      <Layout title="new look" viewer={viewer} scripts={[`${BASE}/js/new.js`]}>
        <h1>new look</h1>
        <p>Paste the JSON that komorebi’s “copy JSON” gives you, or choose the file. Either the params object or <code>{'{ "params": … }'}</code> works.</p>
        <form id="new">
          <label>
            params
            <textarea name="params" rows={8} spellcheck={false} required></textarea>
          </label>
          <label>
            or a file
            <input type="file" accept=".json,application/json" />
          </label>
          <label>
            name
            <input name="name" maxlength={80} required />
          </label>
          <label>
            description
            <textarea name="description" rows={3} maxlength={500}></textarea>
          </label>
          <fieldset>
            <legend>tags</legend>
            {TAGS.map((t) => (
              <label class="inline">
                <input type="checkbox" name="tags" value={t} /> {t}
              </label>
            ))}
          </fieldset>
          <label>
            visibility
            <select name="visibility">
              <option value="private" selected>private</option>
              <option value="unlisted">unlisted</option>
              <option value="public">public</option>
            </select>
          </label>
          <button type="submit">save</button>
          <p class="msg" role="status"></p>
        </form>
        <noscript><p>Saving a look needs JavaScript.</p></noscript>
      </Layout>,
    );
  });

  app.get(`${BASE}/settings`, async (c) => {
    const viewer = await signedIn(c);
    if (!viewer) return c.redirect(`${BASE}/login`);
    return c.html(
      <Layout title="settings" viewer={viewer} classic={[WEBAUTHN_BROWSER]} scripts={[`${BASE}/js/settings.js`]}>
        <h1>settings</h1>
        <noscript><p>Settings need JavaScript.</p></noscript>

        <section id="passkeys">
          <h2>passkeys</h2>
          <ul class="plain"></ul>
          <p>
            <button id="add-passkey" type="button">add a passkey</button>
          </p>
          <p>Without a passkey you cannot sign in, and there is no recovery. Your last passkey cannot be removed.</p>
          <p class="msg" role="status"></p>
        </section>

        <section id="tokens">
          <h2>tokens</h2>
          <p>A token lets an agent read, or read and write, as you. It can only ever make things private.</p>
          <form>
            <label>
              label
              <input name="label" maxlength={40} required />
            </label>
            <label>
              scope
              <select name="scope">
                <option value="read">read</option>
                <option value="write">write</option>
              </select>
            </label>
            <button type="submit">make a token</button>
          </form>
          <div id="minted" hidden>
            <p>
              <strong>Copy this token now. It is shown once and cannot be shown again.</strong>
            </p>
            <p>
              <code></code>
            </p>
          </div>
          <ul class="plain"></ul>
          <p class="msg" role="status"></p>
        </section>

        <section>
          <h2>your data</h2>
          <p>
            <a href="/api/export" download="arboretum-export.json">export my data</a>
          </p>
        </section>

        <p>
          <button id="logout" type="button">log out</button>
        </p>
      </Layout>,
    );
  });
}
