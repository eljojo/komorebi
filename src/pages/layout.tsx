import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Actor, Ctx } from '../auth';
import { authorize } from '../auth';
import { BASE } from '../config';

// Copied from node_modules by scripts/vendor.mjs; the version is in the name so a bump is a visible change.
export const WEBAUTHN_BROWSER = `${BASE}/vendor/simplewebauthn-browser-14.0.0.umd.min.js`;

export const viewerOf = (c: Ctx): Promise<Actor | null> => authorize(c, 'anonymous');

// Every page is a plain document that reads without JavaScript; `scripts` are the modules that add to it. Arboretum is
// a part of komorebi, so no page names itself as a site: the head is komorebi's, with arboretum as one of its links.
// The page is a plain dark ground: a canvas appears only where a look is being highlighted.
export function Layout(props: { title: string; home?: boolean; viewer: Actor | null; scripts?: string[]; classic?: string[]; wide?: boolean; children?: Child }) {
  const { viewer } = props;
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="dark" />
          <title>{`${props.title} · komorebi`}</title>
          <link rel="stylesheet" href={`${BASE}/arboretum.css`} />
          {/* komorebi's own manifest, at the site root: arboretum is part of the one installed app; ?v= follows komorebi's index.html */}
          <link rel="manifest" href="/manifest.webmanifest?v=2" />
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=2" />
        </head>
        <body>
          <header>
            <a class="name" href="/">komorebi</a>
            <nav>
              {/* On arboretum's own front page its link and the pill are redundant: the komorebi name leads home (José). */}
              {props.home ? null : <a href={BASE}>arboretum</a>}
              {viewer ? (
                <>
                  <a href={`${BASE}/new`}>new</a>
                  <a href={`${BASE}/settings`}>settings</a>
                  <a href={`${BASE}/u/${viewer.username}`}>{viewer.username}</a>
                </>
              ) : (
                <a href={`${BASE}/login`}>sign in</a>
              )}
            </nav>
            {/* Straight into the light: the welcome's own "feel", without the welcome (index.html reads #feel). */}
            {props.home ? null : <a class="feel" href="/#feel">open komorebi</a>}
          </header>
          <main class={props.wide ? 'wide' : undefined}>{props.children}</main>
          {/* "about" closes every page, never the head (José). The home's own closing carries it beside the pill (front.tsx). */}
          {props.home ? null : (
            <footer class="closing">
              <a href="/about">about</a>
            </footer>
          )}
          {props.classic?.map((src) => <script src={src}></script>)}
          {props.scripts?.map((src) => <script type="module" src={src}></script>)}
          {/* komorebi's own module, from the site root and not under BASE: the page breathes out before a link leaves it. */}
          <script type="module" src="/breathe.js"></script>
        </body>
      </html>
    </>
  );
}

// A page you may not see reads exactly like a page that does not exist (spec §6).
export function notFound(c: Ctx, viewer: Actor | null) {
  return c.html(
    <Layout title="not found" viewer={viewer}>
      <h1>not found</h1>
      <p>There is nothing here. <a href={BASE}>Back to the start.</a></p>
    </Layout>,
    404,
  );
}

export const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function Tags(props: { tags: string[] }) {
  return props.tags.length ? <span class="tags">{props.tags.map((t) => <span class="tag">{t}</span>)}</span> : null;
}
