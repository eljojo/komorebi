# CLAUDE.md — komorebi-render's map

What each file is and what it owns. The README is for people who send jobs; this file is for people who work on komorebi-render.
It lives in komorebi's repository and ships with it: it renders the komorebi commit it was built from, and reads the engine's
session profiles, quality rows and shipped playlists from the tree above it (`../engine/`, `../presets.js`). The exporter itself
(`../test-gl/render-video.mjs`) is never copied: read its header comment before you change how it is called.

## Files

- **`../flake.nix`** (komorebi's) — the devShell (node 22, ffmpeg, git; on Linux the render environment), `packages.komorebi-render` (bin/komorebi-render with the engine beside it and the commit it was built from in `render/commit`, PATH prefixed so `caffeinate` stays reachable), `apps.komorebi-render`, `apps.render-test`, `checks.render-tests`, `checks.render-package`, `checks.render-darwin-module`, `checks.render-nixos-module`, `checks.render-playwright` (nixpkgs' Playwright equals `test-gl/package.json`'s), `darwinModules.komorebi-render`, `nixosModules.komorebi-render`.
- **`src/cli.js`** — the commands: submit, list, status, cancel, prepare, worker, serve. Thin: it calls the modules below.
- **`src/config.js`** — `loadConfig(env)`: every path and limit the environment decides, ARBORETUM_TOKEN (or its runtime token file), `maxSeconds`, `host`, `port`. `loadEngine()`: the komorebi repository and the commit to render, from the package's `commit` file or the checkout's HEAD.
- **`src/spec.js`** — the job spec: validation into the canonical shape (`validateSpec`, `SpecError`), exactly one of `preset`, `look` or `playlist` (an arboretum playlist rendered as one continuous video: the exporter's `--arboretum-playlist`, video only, its share token redacted like a preset's; or an inline `{ name?, items }` object the worker writes to `playlist-input.json` and passes as `--playlist-json`, or shipped playlists: `"ship:<key>"` or a list of them, canonically always the list, checked against the engine's `presets.js` `PLAYLISTS`), PNG or default MP4, four video pipelines and their master/delivery restrictions, the folder name, the share-token redaction. `jobs` (1..8) and `block_segments` (1..64, only with `jobs` above 1) become the exporter's `--jobs` / `--block-segments` and are omitted from the argv at 1; PNG refuses video-only fields; a new video spec is stored with its pipeline named (gpu, or master when `master` is true), and older stored specs without one keep meaning master.
- **`src/quality.js`** — the engine's session profiles (`SESSION_PROFILES`, from `komorebi-session.js`), the quality knobs (`checkQuality`, `resolveQuality`) and their cost (`msPerFrame`, `estimateSeconds`); their rows come from the engine's `PARAMS`. The only place that names the keys that may become `--set`.
- **`src/exporter.js`** — the seam to render-video.mjs: argv from a spec, the caffeinate wrapper, progress from `seg/*.json`, the bounded `run.log` tail, the ETA from a run's own rate, the result from `manifest.json`. PNG uses one frame and the exporter's master still; `finalizeImage` decodes and checks dimensions, publishes delivery.png with SHA256/provenance, then discards the temporary master with recovery markers.
- **`src/store.js`** — `jobs.sqlite` over `node:sqlite`: the job table and its guarded state machine (queued, running, done, failed, cancelled), cancel requests, requeue at start.
- **`src/netmount.js`** — the async output-root check: exists, writable (a real write), on a network mount (`mount` output, injectable); `createOutputRootCheck` bounds callers to five seconds while retaining one stuck probe until it settles.
- **`src/engine.js`** — `prepare` (mirror, a worktree of the commit, `npm ci`, Chromium unless supplied by `PLAYWRIGHT_BROWSERS_PATH`), over an injectable runner. `shippedPlaylist` turns shipped playlist keys into the one playlist `--playlist-json` reads, from the worktree's `presets.js`. The worktree is what makes the exporter's `--commit` (`git -C <its repo> archive`) work.
- **`src/worker.js`** — `createWorker`: takes a job, checks the output root, prepares once, spawns the exporter in its own process group, polls progress and cancel, ends the job, recovers at start.
- **`src/view.js`** — `jobView`: a job as the CLI and API show it (redacted spec, effective pipeline, progress, ETA).
- **`src/api.js`** — `createApi`: the seven routes in `ROUTES`, a directly testable handler and the thin node:http listener; summaries, details, refusals and token scrubbing.
- **`src/ui.html`** — the read-only jobs page `GET /` serves: polls health, active jobs and the 50 newest past jobs every 10 s. Older pages and job details load on request.
- **`src/serve.js`** — starts the API before one worker, shares their bounded output-root check, closes both on shutdown and closes the API if the worker fails so launchd can restart them together.
- **`llms.txt`** — the API contract for agents, served as text/plain; `test/llms.test.js` checks routes, fields, values, examples and etiquette against the code.
- **`nix/darwin-module.nix`** — `services.komorebi-render`: a caffeinated launchd user agent, runtime token-file path, logs, and state-directory creation before launchd loads it.
- **`nix/module-test.nix`** — evaluates the module with stub launchd/activation options and checks disabled behavior, defaults, overrides, arguments, environment and logs.
- **`nix/nixos-module.nix`** — `nixosModules.komorebi-render`: the systemd API and worker, service user, render-group access, local state and output-mount ordering.
- **`nix/nixos-module-test.nix`** — evaluates the NixOS module against the real NixOS options and checks disabled behavior, ownership, mount ordering and overrides.
- **`test/*.test.js`** — `node --test`; no GPU, no network, no real npm, and git only on a throwaway repository (`loadEngine`). `fixtures/fake-exporter.mjs` stands in for render-video (seg/*.json, run.log, manifest.json, exit code from `FAKE_MODE`).
- **`test/stills.test.js`** — PNG spec/argv, API-to-worker results, decoded image dimensions and corruption, recovery after publication, cancellation/redaction, CLI and guide coverage. FFmpeg makes and decodes tiny CPU-only PNG fixtures.

## Rules that bite

- One job at a time; the database is the only channel between a CLI/API process and the worker.
- The look for a `look` job goes in `look-input.json`, never `look.json`: the exporter rewrites that one, and a resume re-reads its `--look-json`.
- Only `tex_resolution`, `bake_resolution`, `sample_count` may become `--set`; anything else changes the look.
- The share token and ARBORETUM_TOKEN stay out of logs, error text and listings (`redactSpec`, `scrub`). Never log an argv.
- A run must never fill the Mac's disk: the output-root check precedes every job.
- Tests run through the flake: `nix run .#render-test` from the repository root.
