# Komorebi

*木漏れ日 — sunlight that leaks through the trees, and the soft, breathing dapples it casts on the ground.*

A standalone WebGL2 engine that renders komorebi from physics rather than painting it: a point-sun source seen through canopy layers (shift‑multiply‑summed into dappled light), with two wind bands driving a trunk/limb/twig spring hierarchy. See [`komorebi-spec.md`](komorebi-spec.md) for the full vision, physics, and model.

Editor: [komorebi.eljojo.net](https://komorebi.eljojo.net). Examples: [`examples/`](examples/) ([see live](https://komorebi.eljojo.net/examples/)).



<img width="1582" height="986" alt="Screenshot 2026-08-24 at 19 54 46" src="https://github.com/user-attachments/assets/4372c83f-e158-4683-b78d-956957c8950f" />
<img width="1582" height="986" alt="Screenshot 2026-08-24 at 19 54 57" src="https://github.com/user-attachments/assets/68e7bb36-f279-4567-b994-9d51a113a6f0" />
<img width="1582" height="986" alt="Screenshot 2026-08-24 at 19 55 29" src="https://github.com/user-attachments/assets/e6635ba9-e129-4c3c-bbdb-d5c5c99eca05" />

<details>
  <summary>see more photos</summary>
<img width="1582" height="986" alt="Screenshot 2026-08-24 at 19 56 40" src="https://github.com/user-attachments/assets/050fcf0d-ebce-4def-809f-d3474faf88d5" />  
<img width="1582" height="986" alt="Screenshot 2026-08-24 at 19 55 07" src="https://github.com/user-attachments/assets/c1e201f3-7001-4920-a531-a6b44419bdc7" />
<img width="1582" height="986" alt="Screenshot 2026-08-24 at 19 55 47" src="https://github.com/user-attachments/assets/8bfab69d-6c79-427f-ac3c-5bc62dc4e574" />
<img width="1582" height="986" alt="Screenshot 2026-08-24 at 19 57 04" src="https://github.com/user-attachments/assets/85718e34-b496-41a9-a918-2b1ccc22955e" />
  
</details>


## Add it to your page

Download [`komorebi.player.min.js`](https://komorebi.eljojo.net/dist/komorebi.player.min.js) (about 37 kB gzipped; `nix run .#build` prints the current size) and put it on your own server. **Do not link to the copy on komorebi.eljojo.net.** That copy is for the editor and the examples. It changes without notice, and it is not a CDN.

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

The bundle contains every shipped look. The experimental looks are not in it: they are the receiver, enclosure
and sky-view work, and they are the only looks that use a camera other than the floor.

If your page uses two or three looks, `nix run .#embed -- '<look>'...` builds a bundle with only those looks, the
cameras they use, and the fall tiers they open: the sky fill, the leaf's diffuse share, the autumn pigment, the exposure
pass, leaf drop and the litter carpet. A tier none of the looks opens is left out. The three homepage looks
(`'morning 2' 'afternoon 5b' 'morning 3'`) come to 84 kB, or 28 kB gzipped, against 36 kB before the fall tiers could be
cut; the player bundle keeps every tier, because `montebello` ships and opens all six. `nix run .#embed-check` renders
each look through the bundle and through the raw modules, and requires the frames to be identical.

If you then switch a page's params to something the bundle was not built for (open `canopy_fill` on a bundle that left
the fill out, say), the tier stays off and the engine logs one `console.warn` per tier:
`komorebi: fill is not in komorebi.embed.min.js (...), so it stays off; build a bundle with the look that uses it`.

## Rendering MP4s

The Mac exporter uses the same scene and deterministic frame clock with four capture pipelines:

| `--pipeline` | When to use it | How the MP4 is made |
| --- | --- | --- |
| `master` (default) | Lossless archives, studies, later re-encoding | Lossless RGB segments, then eight-bit HEVC. |
| `gpu` | Everyday production | GPU resize when supersampling, output-sized RGB readback, VideoToolbox eight-bit HEVC. |
| `gpu-main10` | Highest measured fidelity, especially faint colours | GPU capture, direct P010 conversion, VideoToolbox HEVC Main10. Source RGB remains eight-bit, SDR BT709. |
| `browser` | Short scene-planning tests | Native browser HEVC QP1 from VideoFrame, then MP4 muxing. Fastest in the local comparison, with a small measured fidelity loss. |

Pipeline and scene quality are independent. For a 1920x1080 output, `--ss 1` renders 1080p directly; `--ss 2` renders
3840x2160 and combines four pixels per output pixel in linear light. This reduces sampling artifacts at additional cost;
it is 4K down to 1080p. Selecting a GPU pipeline does not force supersampling. Direct pipelines support ss 1 and 2.

```sh
nix run .#video -- --look-json look.json --commit <sha> --out test-gl/out/video/preview --seconds 5 --pipeline browser
nix run .#video -- --look-json look.json --commit <sha> --out test-gl/out/video/final --seconds 30 --pipeline gpu-main10 --vt-quality 100 --ss 2
```

GPU and master pipelines keep the existing 60M bitrate default; `--vt-quality 100` chooses highest-fidelity encoding with
larger files. Browser QP1 is fixed and refuses VT delivery controls. Main10 is ten-bit YUV 4:2:0, not HDR.
All pipelines checkpoint each segment. Direct modes retain encoded segments across interruption, stream-copy the final
delivery, verify it and delete those temporary segments. They have no lossless master or raw pixel hashes, so they refuse
`--measure`, `--stills`, `--encode-only`, `--merge-master` and `--drop-segments`. Their manifest records encoded checksums,
the selected pipeline and exact decoded frame accounting.

In two matched 30-second supersampled 1080p60 clips on an M1 Pro, the prototype GPU eight-bit path was 14–16% faster than
the master workflow, Main10 12–15% faster and browser 20–22% faster. GPU eight-bit was near-identical to the old MP4;
Main10 had the best measured source fidelity and roughly twice the file size. These are two looks, one run per method,
before server segment integration; use actual job timing rather than assuming those gains on another machine.
The [render server](https://github.com/eljojo/komorebi-render) exposes these as the job's `pipeline` field.

## Develop

ES‑module dev needs http (not `file://`). With Nix:

```
nix run .#dev      # serve + live‑reload at http://localhost:8000
nix run .#lint     # biome
nix run .#build    # bundle dist/komorebi.player.min.js (every shipped look, no experimental ones)
node glslcheck.mjs # offline shader validation — compiles every GLSL literal in the engine modules (glslangValidator, no GPU)
nix run .#pixels   # the pixel harness — render every look + pixel suites (first run: cd test-gl && npm install && npx playwright install chromium)
nix run .#editor   # the editor smoke — mode ladder + macro bus driven in headless Chromium (same first-run setup)
nix run .#embed -- 'morning 2' 'afternoon 5b' 'morning 3'   # a one-page bundle: only those looks, only the cameras they use
nix run .#embed-check                                       # ...and check it renders them byte-identically
```

[`CLAUDE.md`](CLAUDE.md) is the repo map. A push to `main` builds `dist/` and publishes the site.
