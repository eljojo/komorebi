# Komorebi

*木漏れ日 — sunlight that leaks through the trees, and the soft, breathing dapples it casts on the ground.*

A standalone WebGL2 engine that renders komorebi from physics rather than painting it: a point-sun source seen through canopy layers (shift‑multiply‑summed into dappled light), with two wind bands driving a trunk/limb/twig spring hierarchy. See [`komorebi-spec.md`](komorebi-spec.md) for the full vision, physics, and model.

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
- **`komorebi.global.js`** — deploy shim: bundles the engine + presets into a classic `window.Komorebi` global for no‑build embeds (the eljojo.net homepage).
- **`dev-server.js`** — bun static server + live‑reload for development (`nix run .#dev`).
- **`embed-build.mjs`** — the specialized deploy bundle for ONE page: `nix run .#embed -- '<look>'...` keeps only the named looks, asks the camera registry which cameras those looks select and prunes the rest (their GLSL, uniform groups and per-frame uploads with them), strips the design prose out of the shader literals and hard-folds the editor tier off — `dist/komorebi.embed.min.js`, the same `window.Komorebi` door. Prove it with `nix run .#embed-check` before shipping it.
- **`glslcheck.mjs`** — offline shader validation: assembles every GLSL template literal in the engine and compiles it with `glslangValidator`, so a shader typo fails here instead of on a black canvas.
- **`test-gl/`** — the pixel harness: real renders of every look in headless Chromium (WebGL2 via SwiftShader) — a PNG per preset under `test-gl/out/`, plus smoke, gate-invariant (byte-identical off states, in pixels), determinism, and transition-routing (each tier driven to completion; logic-only) suites. `test-gl/editor.mjs` (`nix run .#editor`) is the editor smoke: it drives index.html's mode ladder + macro bus and asserts the observable DOM effects — the UI-only regressions the pixel suites can't see. `test-gl/embed.mjs` (`nix run .#embed-check`) is the embed bundle's proof: it renders each kept look through the embed bundle AND through the raw ES modules in one page and requires the frames to be byte-identical (`--against <bundle.js>` also diffs an older deploy, with a contact sheet). `nix run .#pixels`; first run needs `cd test-gl && npm install && npx playwright install chromium`. PNGs and `node_modules/` stay untracked.
- **`komorebi-spec.md`** — the living spec (vision, physics, model). Kept in sync as the engine evolves.

## Develop

ES‑module dev needs http (not `file://`). With Nix:

```
nix run .#dev      # serve + live‑reload at http://localhost:8000
nix run .#lint     # biome
nix run .#build    # bundle dist/komorebi.player.min.js (the whole engine: every look, every camera)
node glslcheck.mjs # offline shader validation — compiles every GLSL literal in the engine modules (glslangValidator, no GPU)
nix run .#pixels   # the pixel harness — render every look + pixel suites (first run: cd test-gl && npm install && npx playwright install chromium)
nix run .#editor   # the editor smoke — mode ladder + macro bus driven in headless Chromium (same first-run setup)
nix run .#embed -- 'morning 2' 'afternoon 5b' 'morning 3'   # a one-page bundle: only those looks, only the cameras they use
nix run .#embed-check -- 'morning 2' 'afternoon 5b' 'morning 3'   # ...and prove it renders them byte-identically
```

## Using the engine

```js
import { create, PRESETS } from './komorebi.js' /* + './presets.js' */;
const eng = create(canvas, { params: PRESETS['morning 2'] });
eng.transitionTo(PRESETS['afternoon 5b'], { duration: 5 });
```

Or, for a no‑build page, load the bundle and use the global: `<script src="komorebi.player.min.js"></script>` then `Komorebi.create(…)` / `Komorebi.PRESETS`.

`create()` throws if WebGL2 / float render targets are unavailable, so callers can degrade gracefully — the editor shows the error; `player.html` leaves the background blank.
