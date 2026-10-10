# arboretum

A quiet place where [komorebi](https://komorebi.eljojo.net) looks are kept, grouped into playlists, and shared.
Find the right look or playlist here, then open it in komorebi.

It runs on one Cloudflare Worker with D1. Server-rendered pages, passkey accounts, and a JSON API that the komorebi
editor and agents use. How an agent uses the API is in [`public/llms.txt`](public/llms.txt).

## Run it locally

The toolchain is the nix devShell. Every command goes through `nix develop -c`.

```sh
nix develop -c npm install
nix develop -c npx wrangler d1 migrations apply komorebi-arboretum --local
nix develop -c npx wrangler dev --local-protocol https --var RP_ID:localhost --var ORIGIN:https://localhost:8787
```

Open https://localhost:8787 and accept the self-signed certificate once.

It has to be https. The session and passkey-challenge cookies are `__Host-` cookies, which are `Secure`, and
Safari drops `Secure` cookies on plain `http://localhost`, so signing up fails there. The two `--var`s point the
passkeys at localhost instead of arboretum.eljojo.net.

The local database lives in `.wrangler/` and is never uploaded.

## Test

```sh
nix develop -c npm test
nix develop -c npm run typecheck
```

The tests run in the Workers runtime, in-process, against a local D1 with the migrations applied.

## The komorebi engine

Arboretum renders looks with komorebi's own engine, pinned to a commit on komorebi's `origin/main`. Its
validator only accepts the keys that engine knows, within the editor's slider ranges. To move the pin:

```sh
nix develop -c node scripts/pin-engine.mjs <commit>
```

That rebuilds `public/engine/`, `src/generated/engine.ts` and the test fixtures from a `git archive` of
`~/code/komorebi`. It never touches that checkout.
