# Komorebi

*木漏れ日 — sunlight that leaks through the trees, and the soft, breathing dapples it casts on the ground.*

A standalone WebGL2 engine that renders komorebi from physics rather than painting it: a point-sun source seen through canopy layers (shift‑multiply‑summed into dappled light), with two wind bands driving a trunk/limb/twig spring hierarchy. See [`komorebi-spec.md`](komorebi-spec.md) for the full vision, physics, and model.

Editor: [komorebi.eljojo.net](https://komorebi.eljojo.net). Examples: [`examples/`](examples/).

## Add it to your page

Download [`komorebi.player.min.js`](https://komorebi.eljojo.net/dist/komorebi.player.min.js) (191 kB, 60 kB gzipped) and put it on your own server. **Do not link to the copy on komorebi.eljojo.net.** That copy is for the editor and the examples. It changes without notice, and it is not a CDN.

```html
<canvas id="komorebi" style="position:fixed; inset:0; width:100%; height:100%; z-index:-1"></canvas>
<script src="/komorebi.player.min.js"></script>
<script>
  if (window.Komorebi) {
    try {
      Komorebi.create(document.getElementById('komorebi'), { params: Komorebi.PRESETS['morning 2'] });
    } catch (e) { /* no WebGL2 */ }
  }
</script>
```

Give the canvas a size in CSS. The engine reads that size each frame, so a resize needs no code.

`create()` throws when the browser has no WebGL2 or no float render targets. Catch it, and the page keeps its
background. Test `window.Komorebi` too, in case the script did not load.

### Looks

`Komorebi.PRESETS` holds the looks:

`morning 1` · `morning 2` · `morning 3` · `morning 3b` · `afternoon 4` · `afternoon 4b` · `afternoon 5` · `afternoon 5b` · `afternoon 6` · `afternoon 6b` · `afternoon 7` · `park 1` · `prism` · `memories` · `eclipse`

Most looks are bright, and dark text stays readable on them. `memories` and `eclipse` are dark. `park 1` shows the
trees. Open the editor and step with ← → to compare them.

### Change the look

```js
eng.transitionTo(Komorebi.PRESETS['afternoon 5b'], { duration: 5 });
```

The engine selects the transition itself, from the difference between the two looks.

### Change a parameter

A look is a plain object. Copy one and set the parameters you want:

```js
Komorebi.create(canvas, { params: { ...Komorebi.PRESETS['morning 2'], wind_strength: 0.4 } });
```

`Komorebi.DEFAULTS` holds every parameter at its default value. The editor has a tooltip for each one.

### The engine handle

```js
const eng = Komorebi.create(canvas, { params, onFrame });
eng.transitionTo(params, { duration, onEnd })   // fade to another look
eng.setParams(params)                           // change look immediately
eng.params                                      // the live parameters
eng.setPaused(true)                             // stop the frame loop
eng.dispose()                                   // free the GL objects and the context
```

Call `eng.dispose()` when you remove the canvas. An engine that you drop keeps its context.

### ES modules

The bundle wraps ES modules. Import them if you have a bundler:

```js
import { create } from './komorebi.js';
import { PRESETS } from './presets.js';
const eng = create(canvas, { params: PRESETS['morning 2'] });
```

Serve ES modules over http(s). A page on `file://` cannot import them.

### A smaller bundle

The bundle contains 23 looks, four cameras and both canopy tiers. If your page uses two or three looks,
`nix run .#embed` builds a bundle with only those looks and the cameras they use. It is approximately one third
of the size. `nix run .#embed-check` shows that the smaller bundle renders those looks byte-identically.

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

[`CLAUDE.md`](CLAUDE.md) is the repo map. A push to `main` builds `dist/` and publishes the site.
