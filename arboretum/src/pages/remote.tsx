import type { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { BASE } from '../config';
import { Layout, viewerOf } from './layout';

// The remote control (src/remote.ts; the editor's half is komorebi's editor/remote.js): a phone, signed in, driving an editor
// that is showing somewhere else. The page is a shell; public/js/remote.js builds everything in it from what the screen sends.
export function registerRemotePages(app: Hono<AppEnv>) {
  app.get(`${BASE}/remote`, async (c) => {
    const viewer = await viewerOf(c);
    if (viewer?.kind !== 'session') {
      return c.html(
        <Layout title="remote" viewer={viewer}>
          <h1>remote</h1>
          <p>
            Change what komorebi is showing from your phone. <a href={`${BASE}/login`}>Sign in</a> here, then come back to this page.
          </p>
        </Layout>,
      );
    }
    return c.html(
      <Layout title="remote" viewer={viewer} scripts={[`${BASE}/js/remote.js`]}>
        <section id="remote">
          <p class="r-status msg" role="status">connecting…</p>
          <ul class="plain r-screens" hidden></ul>
          <p class="quiet r-help" hidden>
            Nothing is showing. In komorebi, on the screen you want to change, open settings and turn on remote control, signed in as{' '}
            {viewer.username}.
          </p>
          <div class="r-board" hidden></div>
        </section>
        <noscript>
          <p>The remote needs JavaScript.</p>
        </noscript>
      </Layout>,
    );
  });
}
