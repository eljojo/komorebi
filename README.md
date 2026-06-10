# Komorebi

*木漏れ日 — sunlight that leaks through the trees, and the soft, breathing dapples it casts on the ground.*

A standalone WebGL2 engine that renders komorebi from physics rather than painting it: a point-sun source seen through canopy layers (shift‑multiply‑summed into dappled light), with two wind bands driving a trunk/limb/twig spring hierarchy. See [`komorebi-spec.md`](komorebi-spec.md) for the full vision, physics, and model.

## Files

- **`komorebi.js`** — the engine. The whole renderer, no UI: `Komorebi.create(canvas, opts)`.
- **`editor.html`** — the authoring tool: dev panel, HUD, presets, sun‑drag. Open in a browser (needs WebGL2).
- **`player.html`** — minimal viewer‑only reference: a full‑bleed canvas cycling through presets, no UI.
- **`komorebi-spec.md`** — the living spec (vision, physics, model). Kept in sync as the engine evolves.

## Using the engine

```js
const eng = Komorebi.create(canvas, { params: Komorebi.PRESETS['morning 2'] });
eng.transitionTo(Komorebi.PRESETS['afternoon 5b'], { duration: 5 });
```

`Komorebi.create()` throws if WebGL2 / float render targets are unavailable, so callers can degrade gracefully — the editor shows the error; `player.html` leaves the background blank.
