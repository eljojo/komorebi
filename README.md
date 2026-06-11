# Komorebi

*木漏れ日 — sunlight that leaks through the trees, and the soft, breathing dapples it casts on the ground.*

A standalone WebGL2 engine that renders komorebi from physics rather than painting it: a point-sun source seen through canopy layers (shift‑multiply‑summed into dappled light), with two wind bands driving a trunk/limb/twig spring hierarchy. See [`komorebi-spec.md`](komorebi-spec.md) for the full vision, physics, and model.

## Files

- **`komorebi.js`** — the engine, an ES module. The whole renderer, no UI: `export { create, DEFAULTS, … }`.
- **`presets.js`** — the built‑in looks, an ES module: `export const PRESETS`. Split out of the engine (data, not renderer); imported by the pages.
- **`index.html`** — the editor / landing page (opens on a welcome screen): dev panel, HUD, presets, sun‑drag. Imports the modules, so it must be **served** (`nix run .#dev`), not opened off the filesystem.
- **`player.html`** — minimal viewer‑only reference: a full‑bleed canvas cycling through presets, no UI.
- **`komorebi.global.js`** — deploy shim: bundles the engine + presets into a classic `window.Komorebi` global for no‑build embeds (the eljojo.net homepage).
- **`dev-server.js`** — bun static server + live‑reload for development (`nix run .#dev`).
- **`komorebi-spec.md`** — the living spec (vision, physics, model). Kept in sync as the engine evolves.

## Develop

ES‑module dev needs http (not `file://`). With Nix:

```
nix run .#dev      # serve + live‑reload at http://localhost:8000
nix run .#lint     # biome
nix run .#build    # bundle dist/komorebi.player.min.js (the global, editor stripped)
```

## Using the engine

```js
import { create, PRESETS } from './komorebi.js' /* + './presets.js' */;
const eng = create(canvas, { params: PRESETS['morning 2'] });
eng.transitionTo(PRESETS['afternoon 5b'], { duration: 5 });
```

Or, for a no‑build page, load the bundle and use the global: `<script src="komorebi.player.min.js"></script>` then `Komorebi.create(…)` / `Komorebi.PRESETS`.

`create()` throws if WebGL2 / float render targets are unavailable, so callers can degrade gracefully — the editor shows the error; `player.html` leaves the background blank.
