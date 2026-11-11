# CLAUDE.md — the repo map

What each file is and what it owns. The README is for people who put komorebi on a page; this file is for people
who work on komorebi. The spec ([`spec/`](spec/README.md)) holds the vision, the physics and the
model. Read the spec before you change what the engine does: `spec/README.md` (how it is organised and written),
`spec/experience.md` and `spec/principles.md` first, then `spec/model/overview.md` and the model file for the mechanism
you are touching.

## Keeping the record clean

- **The spec is current.** A change to what komorebi does updates its home in `spec/` in the same piece of work: the
  model file, `contracts/looks.md` for a look, an artist's decision with its reason in the file that carries it,
  `exploration/open.md` to close or re-status an item. `evidence/observations.md` holds only what José lived. Follow `spec/README.md`'s conventions.
- **Uncommitted notes hold only what is pending.** `spec-no-commit/`, `QUESTIONS-FOR-JOSE.md` and the `*-no-commit.md`
  files are working notes outside git. When something lands, delete it there: what was done lives in git and `spec/`.
- **Git is a pruned bonsai.** One commit per coherent change. A commit message says what changes in komorebi, from the
  software's point of view, and makes sense to someone with only the repository: no session context, no "José picked",
  no item numbers, no paths to files outside git. Code comments follow the same rule: what the code does and why.

## Reviewing work

Anything visual is judged on before/after evidence, kept as an archive under `test-gl/out/review/` (git-ignored), one
folder per question: `<date>-<topic>/` with the script that rendered it, a `manifest.json` (params, commit, source
hashes) and a short `README.md` saying what A and B are, what was seen, and José's picks and comments on it, once, as said.

- **Sheets** for stills: labelled montages with quotable frame IDs (`nix run .#review -- spec.json` from a commit, or the
  folder's own script rendering the working tree in headless Chromium, with a candidate change applied to the served
  module text so A and B differ by exactly that change). A batch of
  questions gets an `index.html` that leads with the choices that change the image most.
- **Videos** for motion: side by side, with the per-frame change plotted, a slowed or zoomed replay where the
  difference is small, lossless masters deleted once the delivery is encoded.
- **Measure before showing.** Report the difference between options (mean |A−B| over the frame, the share of pixels
  that visibly move); zoom where it is small; never present a byte-identical pair as a choice; say plainly when an
  option changes nothing visible.

## Files

Each file's own header says what it does in full; this map says what it owns and what it must stay out of.
`spec/implementation.md` is the crosswalk from the model to these modules, their tests and the harness.

**The engine.** `komorebi.js` is its public door (`export { create, DEFAULTS, … }`), re-exported from the modules below;
the whole renderer, no UI. No engine module may import an EDITOR-only file, and nothing in the built bundles names one.

- `komorebi-engine.js` — `create()`: GL plumbing, the shared-internals hub, rebuild coordinators, auto-quality, the frame loop.
- `komorebi-grove.js` — the grown canopy (`buildGrove`) and where one leaf hangs (`placeLeaf`, also the editor's tree preview's).
- `komorebi-bake.js` — the per-frame bakes: optical depth per layer, the faithful soft shadow, the sky fill.
- `komorebi-fill.js` — the sky fill's CPU half, pure; the reference `fill.test.js` and the harness hold the shader to.
- `komorebi-litter.js` — fallen leaves as a floor material: the pure laws and the once-per-regrow carpet bake.
- `komorebi-leaf.js` — the leaf's outline, grown as a vein skeleton (`growLeaf`, `leafShape`, `leafVariant`); pure, with `GLSL_LEAF_Q` its shader half.
- `komorebi-source.js` — the point-sun cloud, the shared cast geometry and the eclipse moon, as pure functions.
- `komorebi-motion.js` — the wind signal and the trunk/limb/twig springs.
- `komorebi-transitions.js` — the routes between looks, and which one a pair takes. Each long route has its own module:
  `komorebi-scene-fade.js` (the dissolve), `komorebi-leaf-travel.js` (faithful↔layer and faithful↔faithful, patch by
  patch), `komorebi-season-travel.js`, `komorebi-grove-travel.js` and `komorebi-litter-rise.js` (floor↔sky).
- `komorebi-render.js` — one frame onto a target.
- `komorebi-transport.js` — the camera registry: GLSL snippets `buildTransport()` assembles into one program per camera.
- `komorebi-shaders.js` — the bake and display shaders, the shared tone tail, the sky fill's bake.
- `komorebi-params.js` — `DEFAULTS`, the legacy-name migration, transition key classes, engine caps, and the feature
  registry (`FEATURES`, `featuresFor`) that tells a bundle which fall tiers it may cut.
- `komorebi-math.js` — CPU math: atmosphere, deterministic RNG, wind noise, skeleton growth.
- `komorebi-editor-tools.js`, `profiler.js` — EDITOR-only: debug overlays, the profiler and its proposals, the motion mirror.

**Looks.** `presets.js` — the built-in looks (`PRESETS`, and `EXPERIMENTAL`, which the editor hides behind its toggle).
`macros.js` — the control bus: one input drives an authored recipe lifted from the shipped looks.

**The editor** (EDITOR-only; `spec/implementation.md`, "The editor and the player", says how it behaves).
- `index.html` — the shell: the welcome, the three surfaces and their CSS. Must be served (`nix run .#dev`), not opened as a file.
- `editor.js` — the body: modes, panels, dials, keys and pointer, the in-place about.
- `playlists.js` — the playlist model and every rule for lists, the mirror and saves; pure, given its `fetch` and timer.
- `arboretum.js` — where looks are kept, in tiers (local, read, session; its header sets them out); the only file that
  touches storage or arboretum. `arboretum-api.js` is its wire, imported by it alone.
- `leaf-maze.js` (pure) and `leaf-preview.js` — the held leaf (`L`); `leaf-preview.js` is imported by `editor.js` alone.

**The site.** `about.html` + `about.css` — the one source of the about text, which the welcome also opens in place.
`breathe.js` — how a page is left (not loaded by `examples/`). `player.html` — viewer-only. `examples/` — the embeds the
README points at. `komorebi.global.js` — the `window.Komorebi` shim for no-build embeds. `.github/workflows/pages.yml` —
the deploy on a push to `main`, which writes `commit.json`.

**Build and checks.**
- `embed-build.mjs` — both bundles: `nix run .#build` (the player, every look) and `nix run .#embed -- '<look>'...`
  (only those looks, with their unused cameras and fall tiers cut). Check a bundle with `nix run .#embed-check`.
- `glslcheck.mjs` — every shader compiled offline, so a typo fails here and not on a black canvas.
- `dev-server.js` — `nix run .#dev`, with live reload.

**`test-gl/`** — real renders in headless Chromium (first run: `cd test-gl && npm install && npx playwright install chromium`).
- `run.js` — the pixel harness: `nix run .#pixels` (about an hour); `--only <substring>...` runs the matching rows,
  `--list` prints them.
- `editor.mjs` — the editor smoke, `nix run .#editor`: the DOM effects the pixel suites cannot see.
- `embed.mjs` — the bundle against the raw modules, byte for byte. `review.mjs` — review sheets from a clean export of a commit.
- `render-video.mjs` — the video exporter, `nix run .#video -- …` (`--help` lists everything), with its siblings
  `video-lib.mjs`, `video.html`, `pipeline.mjs`, `parallel.mjs` (`--jobs`), `compare-runs.mjs`, `webcodecs.mjs`,
  `gpu-probe.mjs` and `study.mjs`. Each test file's header says how to run it.

**The spec.** `spec/` is the work; the code is one implementation of it (see the top of this file). `komorebi-spec.md` is
the single-file spec it replaced, kept as history until José retires it; nothing cites it.

## Arboretum

Arboretum is where the editor keeps looks, online or not; `arboretum.js`'s header describes its tiers. Signed out, or on a
fork or `nix run .#dev`, it works locally and asks the network for nothing unless a link is opened. To develop the session
half, run arboretum's `nix run .#dev -- <this checkout>` from the arboretum repo and open `https://localhost:8787/`.
