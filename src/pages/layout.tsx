import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Actor, Ctx } from '../auth';
import { authorize } from '../auth';

// Copied from node_modules by scripts/vendor.mjs; the version is in the name so a bump is a visible change.
export const WEBAUTHN_BROWSER = '/vendor/simplewebauthn-browser-14.0.0.umd.min.js';

export const viewerOf = (c: Ctx): Promise<Actor | null> => authorize(c, 'anonymous');

// Every page is a plain document that reads without JavaScript; `scripts` are the modules that add to it.
export function Layout(props: { title: string; viewer: Actor | null; scripts?: string[]; classic?: string[]; children?: Child }) {
  const { viewer } = props;
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <title>{props.title === 'arboretum' ? 'arboretum' : `${props.title} · arboretum`}</title>
          <link rel="stylesheet" href="/arboretum.css" />
        </head>
        <body>
          <header>
            <a class="home" href="/">arboretum</a>
            <nav>
              {viewer ? (
                <>
                  <a href="/new">new</a>
                  <a href="/settings">settings</a>
                  <a href={`/u/${viewer.username}`}>{viewer.username}</a>
                </>
              ) : (
                <>
                  <a href="/login">sign in</a>
                  <a href="/signup">sign up</a>
                </>
              )}
            </nav>
          </header>
          <main>{props.children}</main>
          {props.classic?.map((src) => <script src={src}></script>)}
          {props.scripts?.map((src) => <script type="module" src={src}></script>)}
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
      <p>There is nothing here. <a href="/">Back to the start.</a></p>
    </Layout>,
    404,
  );
}

export const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function Tags(props: { tags: string[] }) {
  return props.tags.length ? <span class="tags">{props.tags.map((t) => <span class="tag">{t}</span>)}</span> : null;
}
