# Komorebi

*木漏れ日 — sunlight that leaks through the trees, and the soft, breathing dapples it casts on the ground.*

A standalone WebGL2 engine that renders komorebi from physics rather than painting it: a point-sun source seen through canopy layers (shift‑multiply‑summed into dappled light), with two wind bands driving a trunk/limb/twig spring hierarchy. See [`komorebi-spec.md`](komorebi-spec.md) for the full vision, physics, and model.

**Try it:** [komorebi.eljojo.net](https://komorebi.eljojo.net) — the editor, every knob live.
**See it embedded:** [the examples](https://komorebi.eljojo.net/examples/), whose source is in [`examples/`](examples/).

## Put it on your site

One script tag and one canvas. No build step, no dependencies, nothing to install:

```html
<canvas id="komorebi" style="position:fixed; inset:0; width:100%; height:100%; z-index:-1"></canvas>
<script src="https://komorebi.eljojo.net/dist/komorebi.player.min.js"></script>
<script>
  if (window.Komorebi) {
    try {
      Komorebi.create(document.getElementById('komorebi'), { params: Komorebi.PRESETS['morning 2'] });
    } catch (e) { /* no WebGL2: the page is just a page */ }
  }
</script>
```

That is the whole integration. The canvas needs a **CSS size** — the engine matches its backing store to `clientWidth`/`clientHeight` every frame (device pixel ratio capped at 2), so it follows a resize, a rotate or a layout change on its own. It runs its own `requestAnimationFrame` loop and draws nothing else on your page.

**Pin the version you tested against** if you care about stability: that URL always serves the newest build. Copy the file into your own site (it is ~190 kB, 60 kB gzipped) and you control when it changes.

### Pick a look

`Komorebi.PRESETS` is an object of named looks — pass one as `params`:

`morning 1` · `morning 2` · `morning 3` · `morning 3b` · `afternoon 4` · `afternoon 4b` · `afternoon 5` · `afternoon 5b` · `afternoon 6` · `afternoon 6b` · `afternoon 7` · `park 1` · `prism` · `memories` · `eclipse`

Most are bright dappled floors that sit happily under dark page text. `park 1` is a raking view across a sunlit dirt floor with the trees in frame; `memories` and `eclipse` are darker and want light text over them. The fastest way to choose is to open [the editor](https://komorebi.eljojo.net), step through with ← → until something feels right, and copy the name.

### Move between looks

`transitionTo` crossfades to another look over `duration` seconds — the engine picks its own route (morph the canopy live, dissolve the grove, or swap modes under a bloom) based on how far apart the two looks are:

```js
const cycle = ['morning 2', 'afternoon 5b', 'morning 3'];
let i = 0;
setInterval(() => {
  i = (i + 1) % cycle.length;
  eng.transitionTo(Komorebi.PRESETS[cycle[i]], { duration: 5 });
}, 30000);
```

### Tweak a look

A look is a plain object of parameters, so you can spread one and override:

```js
Komorebi.create(canvas, {
  params: { ...Komorebi.PRESETS['morning 2'], wind_strength: 0.4, view_extent_m: 5 },
});
```

`Komorebi.DEFAULTS` is the full parameter set with every knob at its default — the editor's advanced panel is a view onto exactly these names, and the tooltip on each one says what it does.

### Degrade gracefully

`create()` **throws** if WebGL2 or float render targets are missing, which is your cue to leave the page as it was. Guard on `window.Komorebi` too — a blocked or failed script should not take your page's JS down with it. Both guards are in the snippet above, and in every example.

### The handle

```js
const eng = Komorebi.create(canvas, { params, onFrame });
eng.transitionTo(params, { duration, onEnd })   // crossfade to another look
eng.setParams(params)                           // hard swap, no transition
eng.params                                      // the live parameters (mutate + eng.apply(scope) to re-read)
eng.setPaused(true)                             // stop the rAF loop (off-screen, hidden tab, reduced motion)
eng.dispose()                                   // free every GL object and the context; do this on unmount
```

`eng.dispose()` matters in a single-page app: an engine you drop without disposing keeps its context and its textures. Pair it with `setPaused` when the canvas scrolls out of view.

### With a bundler, or as ES modules

The engine is authored as ES modules and the bundle is just a convenience wrapper:

```js
import { create } from './komorebi.js';
import { PRESETS } from './presets.js';
const eng = create(canvas, { params: PRESETS['morning 2'] });
```

Same API, no global. ES modules must be **served over http(s)** — a page opened off `file://` cannot import them.

### A smaller bundle

The published bundle carries the whole engine: 23 looks, four cameras, both canopy tiers. If your page shows two or three looks, `nix run .#embed` builds one that carries only those — and only the cameras they actually select — typically around a third of the size. See `embed-build.mjs`, and `nix run .#embed-check` to prove your build still renders those looks byte-identically.

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

[`CLAUDE.md`](CLAUDE.md) is the repo map — what each file is and what it owns. Every push to `main` builds `dist/` and publishes the site (editor, examples and bundle) to GitHub Pages.
