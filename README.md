# arboretum

A quiet place where [komorebi](https://komorebi.eljojo.net) looks are kept, grouped into playlists, and shared.
Find the right look or playlist here, then open it in komorebi.

It lives at https://komorebi.eljojo.net/arboretum, on the same site as komorebi itself, and runs on one Cloudflare Worker
with D1. Server-rendered pages, passkey accounts, and a JSON API that the komorebi
editor and agents use. How an agent uses the API is in [`public/llms.txt`](public/llms.txt).

## Run it locally

The toolchain is the nix devShell. Install the dependencies once, then start the dev mode:

```sh
nix develop -c npm ci
nix run .#dev                                       # serves the komorebi checkout at ~/code/komorebi
nix run .#dev -- ~/code/komorebi-arboretum-editor   # or another checkout, such as a worktree
```

It applies the migrations to the local database, then runs `wrangler dev` over https with the passkeys pointed at
localhost. Open https://localhost:8787/arboretum and accept the self-signed certificate once.

The komorebi editor is served from the same origin, at https://localhost:8787/editor/, so the editor and the API
share one session cookie with no CORS. The checkout is copied (read-only) into `.wrangler/editor-assets`, a
throwaway folder that is gitignored and never deployed: `wrangler.jsonc` ships the built site (`.site`, below), and
`--assets` only overrides it for the dev command. There `public/` is served under `/arboretum/`, as deployed, and the
checkout stays at `/editor/` because komorebi's `detect()` keys on that path on localhost. After changing a file in the checkout, reload the tab.

It has to be https. The session and passkey-challenge cookies are `__Host-` cookies, which are `Secure`, and
Safari drops `Secure` cookies on plain `http://localhost`, so signing up fails there. The dev command's `RP_ID` and
`ORIGIN` vars point the passkeys at localhost instead of komorebi.eljojo.net.

The local database lives in `.wrangler/` and is never uploaded.

## One site

komorebi.eljojo.net is this Worker. komorebi's static site is at the root, arboretum's pages are under `/arboretum`
(`BASE` in `src/config.ts`), and the API is at `/api`. `node scripts/site.mjs` builds that site into `.site/` (gitignored,
never committed): it takes komorebi at the commit `public/engine/engine.json` pins with `git archive`, builds its player and
homepage bundles as komorebi's `pages.yml` does, adds `commit.json`, and puts `public/` under `arboretum/`. `nix run .#deploy`
runs it before `wrangler deploy`, which uploads `.site`; a plain `wrangler deploy` before a build stops at the missing folder.
arboretum.eljojo.net stays attached for now: its `/api` answers as before and every other path is a 301 to
`https://komorebi.eljojo.net/arboretum` plus the path.

## Test

```sh
nix develop -c npm test
nix develop -c npm run typecheck
```

The tests run in the Workers runtime, in-process, against a local D1 with the migrations applied.

## The komorebi engine

Arboretum renders looks with komorebi's own engine, pinned to one komorebi commit. Its
validator only accepts the keys that engine knows, within the editor's slider ranges. To move the pin:

```sh
nix develop -c node scripts/pin-engine.mjs <commit>
```

That rebuilds `public/engine/`, `src/generated/engine.ts` and the test fixtures from a `git archive` of
`~/code/komorebi`. It never touches that checkout.
