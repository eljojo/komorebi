# CLAUDE.md — the repo map

What each file is and what it owns, for whoever (or whatever) is about to change one. The README is for people
putting komorebi on a page; this is for people working on komorebi. The spec ([`komorebi-spec.md`](komorebi-spec.md))
is the vision, the physics and the model, and it is kept in sync as the engine evolves — read it before changing
what the engine *does*, not just how.

## Files

- **`komorebi.js`** — the engine's public door, an ES module: `export { create, DEFAULTS, … }`, re-exported from the modules below. The whole renderer, no UI.
  - **`komorebi-engine.js`** — `create()` itself: GL plumbing, the shared-internals hub the subsystem factories close over, the rebuild coordinators, auto-quality, and the frame loop.
  - **`komorebi-grove.js`** — `buildGrove`: the grown canopy — trees, leaves binned to depth layers, the woody occluder, the faithful-path geometry.
  - **`komorebi-bake.js`** — the per-frame bakes: leaves to per-layer optical depth, and the faithful path's pre-integrated soft shadow.
  - **`komorebi-source.js`** — the Vogel-spiral point-sun cloud and the shared cast geometry (bulk shift, ellipse projection, layer heights).
  - **`komorebi-motion.js`** — the broadband wind signal and the trunk/limb/twig spring hierarchy.
  - **`komorebi-transitions.js`** — the cloud-bloom crossfade between looks.
  - **`komorebi-render.js`** — one frame onto a target: the transport draw, the per-group uniform upload, the glow tier.
  - **`komorebi-editor-tools.js`** — EDITOR-only: debug overlays, the profiling primitive, the motion mirror.
  - **`komorebi-transport.js`** — the transport master + camera registry: GLSL snippets `buildTransport()` assembles into one program per camera.
  - **`komorebi-shaders.js`** — the bake / faithful-bake / display shaders and the shared tone tail.
  - **`komorebi-params.js`** — `DEFAULTS`, the legacy-name migration, the transition key classification, the engine caps.
  - **`komorebi-math.js`** — CPU math: the atmosphere model, deterministic RNG, wind noise, skeleton-growth helpers.
- **`presets.js`** — the built‑in looks, an ES module: `export const PRESETS` (+ `EXPERIMENTAL`, the looks the editor hides behind its toggle). Split out of the engine (data, not renderer); imported by the pages.
- **`macros.js`** — the control bus: high‑level macros (weather, haze, focus, the wind pad, season, grove, palette, prism), each one input driving an authored multi‑param recipe lifted from the shipped looks. The editor's playful/minimalist modes are its first source; MIDI/audio can drive the same bus later.
- **`index.html`** — the editor / landing page (opens on a welcome screen): three modes — a minimalist auto‑fading strip (the default), a playful macro sidebar, and the full dev panel — plus HUD, presets, sun‑drag. Imports the modules, so it must be **served** (`nix run .#dev`), not opened off the filesystem.
- **`player.html`** — minimal viewer‑only reference: a full‑bleed canvas cycling through presets, no UI.
- **`examples/`** — the copy-paste embeds the README points at: a drop-in background, a sized hero panel, and the ES-module route. Served as part of the site, so they are also the live demos.
- **`komorebi.global.js`** — deploy shim: bundles the engine + presets into a classic `window.Komorebi` global for no‑build embeds (the eljojo.net homepage, and anyone else's page).
- **`dev-server.js`** — bun static server + live‑reload for development (`nix run .#dev`).
- **`embed-build.mjs`** — the specialized deploy bundle for ONE page: `nix run .#embed -- '<look>'...` keeps only the named looks, asks the camera registry which cameras those looks select and prunes the rest (their GLSL, uniform groups and per-frame uploads with them), strips the design prose out of the shader literals and hard-folds the editor tier off — `dist/komorebi.embed.min.js`, the same `window.Komorebi` door. Prove it with `nix run .#embed-check` before shipping it.
- **`glslcheck.mjs`** — offline shader validation: assembles every GLSL template literal in the engine and compiles it with `glslangValidator`, so a shader typo fails here instead of on a black canvas.
- **`test-gl/`** — the pixel harness: real renders of every look in headless Chromium (WebGL2 via SwiftShader) — a PNG per preset under `test-gl/out/`, plus smoke, gate-invariant (byte-identical off states, in pixels), determinism, and transition-routing (each tier driven to completion; logic-only) suites. `test-gl/editor.mjs` (`nix run .#editor`) is the editor smoke: it drives index.html's mode ladder + macro bus and asserts the observable DOM effects — the UI-only regressions the pixel suites can't see. `test-gl/embed.mjs` (`nix run .#embed-check`) is the embed bundle's proof: it renders each kept look through the embed bundle AND through the raw ES modules in one page and requires the frames to be byte-identical (`--against <bundle.js>` also diffs an older deploy, with a contact sheet). `nix run .#pixels`; first run needs `cd test-gl && npm install && npx playwright install chromium`. PNGs and `node_modules/` stay untracked.
- **`.github/workflows/pages.yml`** — the deploy: builds `dist/` and publishes the whole repo to GitHub Pages (komorebi.eljojo.net) on every push to `main`, which is what makes `dist/komorebi.player.min.js` a URL other sites can point a `<script>` at.
- **`komorebi-spec.md`** — the living spec (vision, physics, model). Kept in sync as the engine evolves.
