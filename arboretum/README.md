# arboretum

A quiet place where [komorebi](https://komorebi.eljojo.net) looks are kept, grouped into playlists, and shared.
Find the right look or playlist here, then open it in komorebi.

It lives at https://komorebi.eljojo.net/arboretum, on the same site as komorebi itself, and runs on one Cloudflare Worker
with D1. Server-rendered pages, passkey accounts, and a JSON API that the komorebi
editor and agents use. How an agent uses the API is in [`public/llms.txt`](public/llms.txt).

## Run it locally

Arboretum lives in komorebi's repository, under `arboretum/`, and its toolchain is komorebi's nix devShell. Install
the dependencies once, then start the dev mode:

```sh
cd arboretum
nix develop -c npm ci
nix run .#arboretum-dev                                   # serves this checkout
nix run .#arboretum-dev -- ~/code/komorebi-other-worktree # or another checkout, such as a worktree
```

It applies the migrations to the local database, then runs `wrangler dev` over https with the passkeys pointed at
localhost. Open https://localhost:8787/ (komorebi) or https://localhost:8787/arboretum and accept the self-signed certificate once.

The komorebi editor is served from the same origin, at https://localhost:8787/, so the editor and the API
share one session cookie with no CORS. The checkout is copied (read-only) into `.wrangler/editor-assets`, a
throwaway folder that is gitignored and never deployed: `wrangler.jsonc` ships the built site (`.site`, below), and
`--assets` only overrides it for the dev command. The layout is the deployed site's: the checkout at the root and
`public/` under `/arboretum/`; the checkout's own `arboretum/` (this source) is left out. After changing a file
in the checkout, reload the tab.

It has to be https. The session and passkey-challenge cookies are `__Host-` cookies, which are `Secure`, and
Safari drops `Secure` cookies on plain `http://localhost`, so signing up fails there. The dev command's `RP_ID` and
`ORIGIN` vars point the passkeys at localhost instead of komorebi.eljojo.net.

The local database lives in `.wrangler/` and is never uploaded.

## One site

komorebi.eljojo.net is this Worker. komorebi's static site is at the root, arboretum's pages are under `/arboretum`
(`BASE` in `src/config.ts`), and the API is at `/api`. `node scripts/site.mjs` builds that site into `.site/` (gitignored,
never committed): it takes this repository at HEAD with `git archive` (uncommitted changes are refused), builds its player
and homepage bundles as komorebi's `pages.yml` does, adds `commit.json`, and puts `public/` under `arboretum/`.
`nix run .#arboretum-deploy` runs it before `wrangler deploy`, which uploads `.site`; a plain `wrangler deploy` before a build stops at the missing folder.
arboretum.eljojo.net stays attached for now: its `/api` answers as before and every other path is a 301 to
`https://komorebi.eljojo.net/arboretum` plus the path.

## Test

```sh
cd arboretum
nix develop -c npm test
nix develop -c npm run typecheck
```

The tests run in the Workers runtime, in-process, against a local D1 with the migrations applied.

## The komorebi engine

Playlists may carry an optional `presentation` identifier generated from the engine (screen or projector). Omission means no preference. Creation accepts it; changing or clearing it uses `PATCH /api/playlists/:id` with `{ "presentation": "projector", "revision": 0 }` (null clears it). A successful presentation update increments the common item revision; stale writes return 409. Existing name and visibility updates retain their request shape. Device quality and FPS preferences stay outside playlist data.

The editor, previews and playlist player opt into the shared engine session policy. Preset params remain sparse authored data; inherited fidelity is distinct from an explicit request, and legacy FPS keys remain accepted without controlling session-aware playback. This rendering session is separate from an authentication session.

Arboretum renders looks with the komorebi engine in the folder above it: it ships as part of komorebi, so there is no
pin. Its validator only accepts the keys that engine knows, within the editor's slider ranges.
`node scripts/engine.mjs` generates `public/engine/`, `src/generated/` and the test fixtures from that tree (all
gitignored); `npm test`, `npm run typecheck` and the dev mode run it first, so an engine change is what arboretum
validates on the next run. It only reads the engine, and builds the bundle outside komorebi's `dist/`.
