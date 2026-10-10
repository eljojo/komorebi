# arboretum

A quiet place where [komorebi](https://komorebi.eljojo.net) looks are kept, grouped into playlists, and shared.
Find the right look or playlist here, then open it in komorebi.

It runs on one Cloudflare Worker with D1. Server-rendered pages, passkey accounts, and a JSON API that the komorebi
editor and agents use. How an agent uses the API is in [`public/llms.txt`](public/llms.txt).

## Run it locally

The toolchain is the nix devShell. Install the dependencies once, then start the dev mode:

```sh
nix develop -c npm ci
nix run .#dev                                       # serves the komorebi checkout at ~/code/komorebi
nix run .#dev -- ~/code/komorebi-arboretum-editor   # or another checkout, such as a worktree
```

It applies the migrations to the local database, then runs `wrangler dev` over https with the passkeys pointed at
localhost. Open https://localhost:8787 and accept the self-signed certificate once.

The komorebi editor is served from the same origin, at https://localhost:8787/editor/, so the editor and the API
share one session cookie with no CORS. The checkout is copied (read-only) into `.wrangler/editor-assets`, a
throwaway folder that is gitignored and never deployed: `wrangler.jsonc` still ships `./public` alone, and
`--assets` only overrides it for the dev command. After changing a file in the checkout, reload the tab.

It has to be https. The session and passkey-challenge cookies are `__Host-` cookies, which are `Secure`, and
Safari drops `Secure` cookies on plain `http://localhost`, so signing up fails there. The dev command's `RP_ID` and
`ORIGIN` vars point the passkeys at localhost instead of arboretum.eljojo.net.

The local database lives in `.wrangler/` and is never uploaded.

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
