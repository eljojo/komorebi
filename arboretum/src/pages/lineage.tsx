import type { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { BASE } from '../config';
import engine from '../../public/engine/engine.json';
import { signedIn } from './account';
import { Layout } from './layout';

// Your looks as a family tree, beside komorebi's built-in ones: where each came from. A person's page. The tree is
// worked out in the browser (public/js/lineage.js) from your export and the built-ins file scripts/engine.mjs writes, so
// this document is only its frame and the words that say what it is.
export function registerLineagePages(app: Hono<AppEnv>) {
  app.get(`${BASE}/lineage`, async (c) => {
    const viewer = await signedIn(c);
    if (!viewer) return c.redirect(`${BASE}/login`);
    return c.html(
      <Layout title="lineage" viewer={viewer} scripts={[`${BASE}/js/lineage.js`]}>
        <h1>lineage</h1>
        <p class="meta">
          Where each of your looks came from, among komorebi’s own. What arboretum and komorebi say is drawn solid; where
          nothing says, the nearest older look by its parameters is taken, and drawn dashed.
        </p>
        <section id="lineage" data-lineage={`${BASE}/engine/${engine.lineage}`} data-export="/api/export">
          <p class="msg" role="status">
            drawing the tree…
          </p>
        </section>
      </Layout>,
    );
  });
}
