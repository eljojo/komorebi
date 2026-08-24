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
- **`presets.js`** — the built‑in looks, an ES module: `export const PRESETS`. Split out of the engine (data, not renderer); imported by the pages.
- **`index.html`** — the editor / landing page (opens on a welcome screen): dev panel, HUD, presets, sun‑drag. Imports the modules, so it must be **served** (`nix run .#dev`), not opened off the filesystem.
- **`player.html`** — minimal viewer‑only reference: a full‑bleed canvas cycling through presets, no UI.
- **`komorebi.global.js`** — deploy shim: bundles the engine + presets into a classic `window.Komorebi` global for no‑build embeds (the eljojo.net homepage).
- **`dev-server.js`** — bun static server + live‑reload for development (`nix run .#dev`).
- **`glslcheck.mjs`** — offline shader validation: assembles every GLSL template literal in the engine and compiles it with `glslangValidator`, so a shader typo fails here instead of on a black canvas.
- **`test-gl/`** — the pixel harness: real renders of every look in headless Chromium (WebGL2 via SwiftShader) — a PNG per preset under `test-gl/out/`, plus smoke, gate-invariant (byte-identical off states, in pixels), determinism, and transition-routing (each tier driven to completion; logic-only) suites. `nix run .#pixels`; first run needs `cd test-gl && npm install && npx playwright install chromium`. PNGs and `node_modules/` stay untracked.
- **`komorebi-spec.md`** — the living spec (vision, physics, model). Kept in sync as the engine evolves.

## Develop

ES‑module dev needs http (not `file://`). With Nix:

```
nix run .#dev      # serve + live‑reload at http://localhost:8000
nix run .#lint     # biome
nix run .#build    # bundle dist/komorebi.player.min.js (the global, editor stripped)
node glslcheck.mjs # offline shader validation — compiles every GLSL literal in the engine modules (glslangValidator, no GPU)
nix run .#pixels   # the pixel harness — render every look + pixel suites (first run: cd test-gl && npm install && npx playwright install chromium)
```

## Using the engine

```js
import { create, PRESETS } from './komorebi.js' /* + './presets.js' */;
const eng = create(canvas, { params: PRESETS['morning 2'] });
eng.transitionTo(PRESETS['afternoon 5b'], { duration: 5 });
```

Or, for a no‑build page, load the bundle and use the global: `<script src="komorebi.player.min.js"></script>` then `Komorebi.create(…)` / `Komorebi.PRESETS`.

`create()` throws if WebGL2 / float render targets are unavailable, so callers can degrade gracefully — the editor shows the error; `player.html` leaves the background blank.
