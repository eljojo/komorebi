# Implementation

*Where each part of the model lives in this repository's code, and which tests and harness rows hold it.*

## What this is

The map of the repository is [`../CLAUDE.md`](../CLAUDE.md): what each file is and what it owns. It stays the authority on that, and nothing here repeats it. This file adds what the map does not carry: a crosswalk from the model to the code. A reader of [`model/fill.md`](model/fill.md) who needs to find the fill's bake, the reference it is held to and the harness row that would go red comes here. It also keeps the implementation facts the model's meaning does not depend on: texture formats and why they were chosen, the uniform budget, the per-frame signatures that decide a re-bake, the floating-point traps the code was built around, the harness and its commands, and how a bundle is cut. Everything here describes the code as the old spec and the map record it. Where the two disagree, or a name could not be confirmed, an `AUDIT` comment says so. Where a fact belongs to the model, this file gives it one sentence and a link.

## The engine's shape

**One door.** The renderer is a standalone ES module. `komorebi.js` is the public door: it re-exports the sibling `komorebi-*.js` modules and has no UI of its own. Its surface is `export { create, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG }`. It also exports a few couplings for one reason only, so that a test can read them. Without that, a disagreement between them would fail silently:

- the transition key sets `MORPH_KEYS`, `CANOPY_KEYS`, `TOPO_KEYS` and `MODE_KEYS`, which let a test assert that every knob is classified;
- the camera registry's `CAMERAS`, `TRANSPORT_GROUPS` and `GROUP_UPLOAD_KEYS`, which let a test assert that its three halves name the same groups.

**The subsystem factories.** `komorebi-engine.js` is `create()` itself. It holds the GL plumbing, the shared-internals hub, the rebuild coordinators, auto-quality and the frame loop. Each subsystem (grove, bake, source, motion, transitions, render, editor tools) is a factory module that closes over the hub. They stand on four foundations: shaders (`komorebi-shaders.js`), transport (`komorebi-transport.js`), params (`komorebi-params.js`) and math (`komorebi-math.js`). The pure halves were split out so a unit test can run them without GL: the leaf outline (`komorebi-leaf.js`), the fill's quadrature (`komorebi-fill.js`) and the litter's laws (`komorebi-litter.js`). See the map for each module's ownership.

**The handle.** `create(canvas, { params })` returns a handle:

| Member | What it does |
|---|---|
| `apply(scope)` | re-applies the current params at a named scope (`'season'` and `'density'` take the cheap paths of [`model/season.md`](model/season.md)) |
| `setParams(p)` | assigns params |
| `transitionTo(params, { duration, onEnd })` | moves to another look by the route [`model/transitions.md`](model/transitions.md) selects |
| `setPaused(b)` | stops or resumes the loop |
| `dispose()` | stops the loop and frees every GL object and the context, so a second, disposable engine can be reclaimed |
| `params`, `perf`, `motion`, `src`, `trans` | live state |
| `onFrame` | a per-frame hook |

The engine runs its own `requestAnimationFrame` loop on the canvas it is handed. `create()` throws when WebGL2 or float render targets are missing, so a page can fall back to a static picture.

**Looks are data.** The built-in looks live in `presets.js` (`export const PRESETS`, plus `EXPERIMENTAL`, the looks the editor hides behind its toggle). Each is merged over the engine's `DEFAULTS`. Their order in that file *is* the dropdown and arrow-key order; there is no separate list. `DEFAULTS` is the merge base. It is exported, but it is not itself a look. Each look's intent is recorded in [`contracts/looks.md`](contracts/looks.md).

**Old spellings keep working.** One alias map, `LEGACY_KEYS` (defined in `komorebi-params.js` beside `migrateLegacy`, re-exported through `komorebi.js`), translates retired param names to current ones. It is applied at every door external params come through: `create`, `setParams`, `transitionTo` and the ★ store. A current name that is already present wins, and nothing the engine writes back out uses an old name. `legacy-keys.test.js` is the test for it by name.

**The consumers.**

- **The editor.** `index.html` is a thin shell over `editor.js`: the dev panel, the HUD, the insets, preset management, sun-drag, scene stepping and the profiler UI. Its pure parts are siblings with their own tests:
  - `playlists.js`, `arboretum.js` and `arboretum-api.js`: look storage and arboretum;
  - `profiler.js`: the auto-profiler's cost taxonomy and its variant and improve proposals (`proposeVariants`, `proposeImprove`);
  - `macros.js`: the control bus (`createBus`);
  - `leaf-maze.js` and `leaf-preview.js`: the held leaf.
- **The player.** `player.html` is a viewer-only reference: a full-bleed canvas that cycles through looks with `transitionTo`.
- **The global shim.** `komorebi.global.js` bundles the engine and the looks into a classic `window.Komorebi` global, for pages with no build step.
- **The bundles.** `embed-build.mjs` writes `dist/komorebi.player.min.js` (every shipped look) and `dist/komorebi.embed.min.js` (only the looks one page names). See [Build and bundles](#build-and-bundles).
- **The examples.** `examples/` holds the embeds the README points to.

Pages that import the modules natively must be served over http(s), not opened from the filesystem (`nix run .#dev`).

**What the editor tier adds.** The engine carries an `EDITOR` constant. In the editor build the handle also has a small `profiler` (GPU timer-query instrumentation, plus an offscreen stress burst kept as a coarse fallback) and a motion mirror (`setMotionSource`, which copies the live motion and spring state into a second engine each frame for the profiler's A/B wipe). These sit in `komorebi-editor-tools.js` with the debug overlays. The bundles fold the tier off (see below). The general `setPaused` and `dispose()` ship everywhere, because the A/B wipe creates and disposes a second engine per comparison. The held-leaf inset, the playlists and arboretum are imported by `editor.js` alone. No engine module, preset or bundle names them: `maze.test.js` and `arboretum.test.js` hold that.

## Transport as a registry

The model fact is [`model/transport.md`](model/transport.md#one-program-per-camera): one program per camera, chosen at compile time. This section covers how that is built.

**A camera is a compiled program.** Transport lives as named GLSL snippets in `komorebi-transport.js`: camera blocks, occluder tiers, materials and the shared Look tail. Each snippet carries its own uniform declarations, and `buildTransport()` assembles them. A camera can only change through a structural rebuild, so the selection is a build key, not a runtime branch. Within a variant every emitted line is a line the single shader used to run. The branches disappear because they are left out, and the two flags that once chose between them do not reach any variant. The cameras are:

- floor;
- cloth (the curtain);
- enclosure (the tent);
- sky (the retina);
- a transition-only viewpoint that joins sky rays to floor casts. Bundles keep it only when they keep both the sky and floor cameras.

**Three halves that must agree.** One entry per camera is read by three consumers:

1. **the assembler**, which picks the snippet composition and declares the groups' uniforms;
2. **the location table**, which looks up the uniform locations each group names;
3. **the per-frame upload**, which fills each group (`GROUP_UPLOAD`, keyed by `GROUP_UPLOAD_KEYS`, called from `komorebi-render.js`'s per-group upload).

Each uniform group names its GLSL declarations, its location keys and its upload together. A uniform declared in one variant but filled in another therefore shows up as a key that does not line up, rather than as a silent black frame. `registry.test.js` holds the three halves to the same groups. It also holds the shared sky ray to one exact text in both the sky program and the fill program, and holds that snippet never to read `uAmbient`. What a new entry owes is the extension contract in [`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md). Materials ride the camera because every receiver so far has exactly one.

**Why the split: the uniform-row budget.** The split buys headroom, not speed. The four-in-one shader declared **246 vec4 rows** of uniforms against WebGL2's guaranteed **224**. Split, each camera declares only what it reads. One more thing moved out of the uniforms: the occluder's segment table, two vec4 arrays that, at the table's original 64-segment capacity, would have cost **128 rows** in every camera at once (the table is now 256 segments). With it gone, the four variants stand at **85, 94, 101 and 30** rows, all well inside the floor.

**The segment table as a data texture.** The analytic woody occluder is a fixed table of segments, its capacity `MAX_OCC` = 256 in `komorebi-params.js`: one row of plan endpoints and one row of heights.
It is stored as an RGBA32F data texture that the shader reads with `texelFetch`. That read is exact on RGBA32F, so it carries the same floats a uniform upload did. A marginal tree's coverage is stored beside each segment's radius, so a tree-count morph fades the whole tree's wood. The texture can hold two sets, which is what a wood crossfade would need (not built; see [`exploration/open.md`](exploration/open.md)).

**One compile per camera, for the engine's life.** Each program is compiled on the first use of its camera and kept. The one compile a camera ever costs lands inside the rebuild a mode flip already performs. `glslcheck.mjs` assembles every GLSL template literal and compiles it with `glslangValidator`, so a shader typo fails offline instead of as a black canvas.

## The crosswalk

One table per model file. *Module* names the file that owns the mechanism (see the map). *Named* lists the function or constant the old spec names. *Unit* lists the bun tests (`*.test.js` at the repository root). *Harness* lists the pixel-harness suites and flags and the `test-gl/*.mjs` route drivers. "Not recorded" means the old spec does not say. Test files whose contents the old spec never describes are listed by name only.

### Source — [`model/source.md`](model/source.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Vogel-spiral point-sun cloud: core and halo, weights, frame-stable | `komorebi-source.js` | not recorded | `transitions.test.js` (halo radius, core energy and monotone cloud through the real sampler on the shared-layer crossfade) | determinism (two engines born alike give equal frames) |
| Cloud as the blur knob | `komorebi-source.js` | `cloud_thickness`, halo radius | as above | smoke; `--look` for eyes |
| Eclipse as a source property | not recorded | not recorded | not recorded | the eclipse look in smoke and determinism |
| Seen disk radiance (sky view) | `komorebi-source.js`, `komorebi-transport.js` | `SKY_SUN_GAIN` | not recorded | `--sky` |

*Representation.* How the sample list reaches the shader is not recorded. Regenerating identical samples does not trigger a faithful re-cast; changed offsets or weights do (see [Signatures](#the-signatures-that-decide-a-re-bake)). The shared cast geometry (bulk shift, ellipse projection, layer heights) also lives in `komorebi-source.js`; it is listed under transport.

### Light — [`model/light.md`](model/light.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Atmosphere: sun colour, sky colour, turbidity | `komorebi-math.js` | `atmosphere()` (normalise to hue; exposure carries brightness) | not recorded | smoke |
| Sun direction and the receiver's cosine | `komorebi-math.js` (the one place the per-receiver table lives) | `sunDirection`, `sunIncidence`, `sun_cosine`; `beamExtinction`, `beamLoss`, `sun_extinction` (the air's loss; a slot of the fill's signature); `beamExposure` (exposure across the law in a morph; `komorebi-transitions.js`, `komorebi-season-travel.js`); the haze macro's re-sit (`macros.js`) | `cosine.test.js` (by name), `macros.test.js` (haze) | gate rows at `sun_cosine` 0 |
| Time of day (editor helper) | `editor.js` | `updateSunFromTime` (solar noon at azimuth 180°, the convention `komorebi-math.js`'s season sun shares); see [The editor](#the-editor-and-the-player) | not recorded | editor smoke |
| Leaf-edge diffraction (the prism) | `komorebi-transport.js`, `komorebi-shaders.js` | `tapCA` (three single-channel reads) | not recorded | gate rows (off collapses to one tap) |
| Purkinje/mesopic shift; autumn's inversion of the dusk law | not recorded | not recorded | not recorded | not recorded |

*Representation.* `sun_cosine` scales the sun-colour upload live. It does not re-bake, so it holds an entry in the fill's signature (the fill's `S` takes the floor's `sin el`).

### Camera — [`model/camera.md`](model/camera.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| View (pitch, yaw, pan, zoom, fov) and the floor ray-cast | `komorebi-transport.js` | `uProj`, `D_ref = cos pitch + tan(fov/2)·sin pitch` | `viewpoint.test.js` (geometry of the sky↔floor eye) | `test-gl/viewpoint.mjs` |
| Shared tone tail: exposure → tone curve → contrast → gamma, last | `komorebi-shaders.js` ("the shared tone tail") | not recorded | not recorded | smoke; determinism |
| Vignette iris | `komorebi-math.js` (pure formula), post block every camera runs | `vignetteMask`, `vignette` | `vignette.test.js` (holds the shader's source to the formula) | gate rows |
| Glow tier (receiver lateral diffusion) | `komorebi-render.js` | `glow_bleed_m` | not recorded | gate rows (0 is the direct draw, nothing allocated) |
| Far smear, distance haze | `komorebi-transport.js` | not recorded | not recorded | smoke |

*Representation.* With the glow tier open, transport writes linear HDR into an **RGBA16F** target. Two separable blur passes follow, then a compositing pass that carries the relocated tone tail. Perceptual and atmospheric terms (mesopic shift, distance haze) stay upstream of the blur. At 0 the frame is the direct draw and nothing is allocated.

- **The kernel.** Horizontal then vertical, 13 taps each (13 + 13, not 169), with σ = radius/3 so the taps span ±3σ. That makes the **weights constant**, `exp(−k²/8)` normalised (`FS_GLOW_BLUR`), and puts the whole radius into the tap spacing, radius/6 in pixels (`GLOW_TAPS` 6 a side; the weight table is computed for exactly that count). The spacing caps at 6 px (`GLOW_STEP_MAX`), which is where the reach stops growing ([`model/receivers.md`](model/receivers.md); the figures are [`evidence/measurements.md#receivers`](evidence/measurements.md#receivers)). The radius in pixels is `glow_bleed_m` × the target's height / `view_extent_m`.
- **Where the passes sit.** Transport → H → V → composite, all four inside one `drawFrameInto`, so all four are heavy work: under the adaptive frame rate they run together on the idle cadence and the re-present blit shows the composited frame, so the glow cannot fall out of step with the cast.
- **The silent fallback.** A driver that refuses a complete RGBA16F target latches the tier off: the three targets are freed and every frame takes the direct path, the look without its glow.

### Canopy — [`model/canopy.md`](model/canopy.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Growth grammar | `komorebi-math.js` | `growSkeleton(spec, rng, out)` (its `plane` mode has no caller) | `skeleton.test.js` (what `plane` promises) | smoke |
| The grove: trees, leaves binned to layers, woody occluder, faithful geometry | `komorebi-grove.js` | `buildGrove`, `layerOf(z)`, `GROVE_READS` | `tree.test.js` | determinism; pins |
| Per-tree draws (lead, depth, genotype) | `komorebi-math.js` | `treeDraws`, `treeGenotype`, `TREE_SALT = 2·0x9E3779B9 mod 2³²`, `treeShifts`, `treeGains` | `tree.test.js` (`hier.twigs` and `segments` JSON-equal at any knob value; buffers unchanged with both knobs at 0) | gate rows |
| Where a leaf hangs (`inner_leaves`) | `komorebi-grove.js` | `placeLeaf` (also called by the editor's tree preview), `INNER_SALT`, `INNER_GLIDE` 0.05 | `inner.test.js` (the old hang loop's expressions leaf by leaf; the step bound) | gate rows at 0 |
| Species bundles | `presets.js` | `TREE_SPECIES` | not recorded | not recorded |
| Faithful height cap | `komorebi-grove.js`, `komorebi-math.js`, `komorebi-params.js` | `FAITH_MAX_RATIO` | not recorded | not recorded |
| Bake to depth layers | `komorebi-bake.js`, `komorebi-shaders.js` | `VS_BAKE` | not recorded | smoke; pins |
| Faithful cast of the real geometry | `komorebi-bake.js`, `komorebi-shaders.js` | `bakeFaithful`, `VS_FAITH` (`VS_FAITH_PIVOT` for a grove with leaves on older wood: the pivot weight, a separate buffer at attribute 8), `FS_FAITH`, `refreshFaith` | not recorded | gate rows (`faithful_canopy` off is the layer path); still-cast re-cast rows |
| Continuous tree count | `komorebi-grove.js` | marginal tree appended at the end of the stream | `transitions.test.js` | `afternoon 5→6` route |
| Tree inset (`T`) | `komorebi-editor-tools.js` | `placeLeaf`, `hier.segments`, `hier.leafW` (see [The editor](#the-editor-and-the-player)) | not recorded | editor smoke |

*Representation.*

- **Layer textures.** One **RGBA16F** texture per depth layer: per-channel optical depth τ in rgb, leaf coverage in alpha. The alpha is written `cov·iFade·uCoverage` on every camera; it is the same bake everywhere.
- **Leaf records.** A layer leaf record is 17 floats, the 17th being `iFade`. A faithful record is 18 floats; it keeps its height before the fade.
- **The faithful path.** Leaves and wood are drawn at their own heights, each source sample into its own buffer with multiplicative blend. The buffers are weight-summed into **one pre-integrated soft-shadow texture**, which transport taps once (`tapFaith`). The layer textures are then 1×1. The format of the pre-integrated texture is not recorded. A bare faithful canopy still bakes its wood rather than returning early. Without the wood, an empty leaf set left a stale or zero shadow, and the whole floor went black.
- **The cast frame's pad.** The frame is padded by `leaf_size_m·max(1, 0.7·rmax·scaleMax)` plus the drift, the trunk's sway and 5 cm (`komorebi-bake.js`). An ellipse's long half-axis is at most 0.7 of the size, which a pad of 1 covers; an outline reaches `rmax` of it from its base; and leaf variety's size shift grows that by the largest shift any leaf took (`scaleMax`, up to about 1.15, absent and exactly ×1 when there is no variety).
- **Bake resolution.** `bake_resolution` sizes the layer textures independently of the sample-texture resolution. It ships at 1536 (0 means follow `tex_resolution`). `auto_quality` trims it below the knee, snapped to 256 so the textures reallocate only at a level boundary. The layer textures are sampled `LINEAR`.

### Leaf — [`model/leaf.md`](model/leaf.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Transmittance and the sieve mixture | `komorebi-math.js` | `leafTau` | `leaf.test.js` (by name) | gate rows |
| Ballistic/diffuse split, neutral depth k | `komorebi-math.js` (`ballisticK`), shaders | `leaf_diffuse`, `uBeamK` (its own `beam` group) | `diffuse.test.js` (beam + emitted = transmitted to 1e−12 over 10⁴ random stacks; floor-averaged identity in expectation) | `lit` rows; `differ` rows; zero-vs-absent rows on layer, faithful, cloth and tent paths with the fill shut and open |
| The texel as a mixture | one GLSL function shared by the cast taps, the faithful stamp and the shared ray; JS twin in `komorebi-fill.js`. It costs a divide and two exponentials per tap on a texel already fetched; with `edge_area` off and `leaf_diffuse` 0 it costs the branch | `texelMix`, `edge_area` | `diffuse.test.js` (the `edge` block, against the supersampled texel) | `--edge` (lantern rim, beam halo, faithful stamp); `--gate edge_area` |
| Marginal fade | `komorebi-grove.js` (writes it), bake shaders (alpha) | `iFade` | `diffuse.test.js` (`tb` continuous in the fade, exactly 1 at 0) | `near` row (0 → 0.005 of a leaf moves the frame by a hair) |
| Maple outline (palmate) | `komorebi-leaf.js` | `growLeaf`, `profile`, `leafShape` | `leaf-shape.test.js` (the bands are the calibration; a one-ulp move passes them, which is why `pinnate.test.js` also pins the maple's profiles, skeletons and texture by digest) | gate rows (`leaf_shape` `'ellipse'` keeps its literal line) |
| Beech outline (pinnate) | `komorebi-leaf.js` | `growPinnate`, `exitAlong` | `pinnate.test.js` (replays the stream draw for draw; profiles, skeletons and texture by digest, a pin against drift) | pins |
| Aspect law | `komorebi-leaf.js` | `leaf_size_m/√aspect` | not recorded | continuity row (maple at 1.75 equals maple at aspect 1 with the adjusted size) |
| Shared outline hash (grove and litter) | `komorebi-leaf.js` | `leafVariant` | `litter.test.js` | not recorded |
| Leaf variety (genotype × light) | `komorebi-leaf.js` | `rowSpec`, `rowBlade`, `GENOTYPE_SALT` (4·0x9E3779B9 mod 2³²) | `variety.test.js` (the id packing on both sides of its bound) | pins (every shipped look, the beech and the maple unchanged) |
| Outline read in the shaders | `komorebi-shaders.js` | `GLSL_LEAF_Q`, `uLeafRows`, `uLeafIdFrac` | `variety.test.js` | pins |
| Held leaf (`L` inset) | `leaf-maze.js`, `leaf-preview.js` (editor only) | `growAreoles`, `rasterLeaf`, `paintLeaf`, `tissues`, `leafMaze` | `maze.test.js` | editor smoke |

*Representation.*

- **The outline texture** is **256 × 64 R16F** (32 KB). One species takes eight rows, one per outline variant. With `leaf_variety`, a genotype grows eight outlines, one per light class, so the texture holds 64 rows, row = g·8 + c.
- **The id packing.** The row rides in the fraction of the cluster id. An eight-row grove packs it as **j + variant/32**, exact in float32 for any cluster below 2¹⁷. A varied grove packs its first column and the blend toward the next as **j + (row₀ + 0.1 + 0.8·w)/128**: the 0.1 margins keep a float's error from crossing a row, which holds while a float32's half-ulp at j is under 0.1/128, so for any cluster below 2¹⁴; there the blend is good to under 0.08 of a column. The GPU's `MAX_TEXTURE_SIZE` caps the clusters (2¹⁴ on most devices, so inside the bound; 2¹⁵ on desktop GL, where a varied grove past 2¹⁴ clusters can read a neighbouring row), and the engine does not cap it further. A design that packed with 512 was exact only to 2¹⁵. The litter keeps the row the leaf hung in, in instance slot 7, instead of rehashing it.
- **The vertex and fragment sides differ on purpose.** `VS_BAKE` and `VS_FAITH` read the packing through a uniform: rounded to a row, `floor(fract(iC.w)*uLeafIdFrac + 0.5)`, and raw in a varied grove (`uLeafIdFrac` 128), whose fraction is the blend `leafQ` mixes the two rows by. The fragment side keeps a literal `/8.0` and overrides it in a uniform branch for a varied grove only; [Numerical discipline](#numerical-discipline) says why.
- **The texel law** is stored as nothing new. Every reader reconstructs the mixture from the same two numbers in the layer texel.

### Season — [`model/season.md`](model/season.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| The four predicates | `komorebi-math.js` (read by the grove, the feature registry and the editor) | `senescing`, `lit`, `dropping`, `ordered`; `turnOpens`, `dropOpens`; `DROP_EPS` | `features.test.js` | gate rows |
| Pigment basis | `komorebi-math.js` | `TAU_CAROTENOID`, `TAU_ANTHOCYANIN`, `TAU_TANNIN` (provisional) | not recorded | gate rows (every summer unchanged) |
| Per-leaf clocks, turn order | `komorebi-math.js` | `leafClock`, `turnOrder`, `turnPhase`, `redGain` | `drop.test.js` | gate rows |
| Light orders the turn | `komorebi-math.js` | `exposureGrid`, `exposureRank`, `groundShade`, `SEASON_SUN`, `EXPOSURE_K` | `exposure.test.js` (by name); the planted-ray test (a leaf under an up-sun crown, with and without the neighbour); `drop.test.js` (equal raw light falls on `drop_start` together) | gate rows |
| One tree ahead | `komorebi-math.js` | `treeDraws`, `tree_clock_spread` | `tree.test.js` | gate rows |
| Abscission, compaction | `komorebi-grove.js` | `alive[i] = 0` count | `drop.test.js` (buffers frozen as digests); `features.test.js` | gate rows on layer and faithful paths |
| Re-seasoning | `komorebi-grove.js`, `komorebi-math.js` | `reseasonGrove`, `scheduleOf`, `SCHEDULE_KEYS`, `keepSeason`, `SEASON_KEYS` (`komorebi-params.js`); the tiers `leafDraws`, `turnWindow`, `leafPigments`, `leafTauAt` (`leafTau` is the three in a row) | `reseason.test.js` (equal to a fresh `buildGrove`, bit for bit) | pins |
| Density capacity (summer) | `komorebi-grove.js`, `komorebi-engine.js` | `densityCapacity` | `reseason.test.js`, `transitions.test.js`, `features.test.js` | routing harness |
| The live season macro | `macros.js`, `komorebi-math.js` | `createBus`, `tween: τ`, `TWEEN_STEP` (half a fade window) | `macros.test.js` (by name) | each spring and summer stop held to the look it came from |
| Litter laws: landing, colour, drop order | `komorebi-litter.js` | `litterAlbedo(tau, age, wet)`, `kmInvert`, `kmReflect`, `ALBEDO_BROWN`, `LITTER_SALT` | `litter.test.js` (the five salts differ and are uncorrelated; the albedo values; the redhead keeps its green) | carpet check, stamp check, `--gate litter` |
| Litter carpet bake | `komorebi-litter.js` | `makeLitter`, `refreshLitter`, `fillFrame` | stub-GL wiring in the bun tests | carpet check; context-loss row |

*Representation.*

- **The carpet** is one **RGBA8** texture over the fill's frame. RGBA8 because linear reflectance is LDR. It is **premultiplied**, blended `ONE, ONE_MINUS_SRC_ALPHA`, so alpha accumulates as `1 − Π(1 − a)` where straight alpha would square it. Premultiplying also lets the bilinear read and the mips average coverage-weighted colour, instead of darkening every edge toward the empty texels' black. It is mipped, so the far floor of a tilted camera reads a mip rather than a shimmer of single texels.
- **Small leaves.** A leaf smaller than a texel is drawn at three quarters of a texel's half-extent, and its alpha is reduced for the area it gained.
- **Cost of the format.** Quantisation is coarse in a wet brown's blue (about 7/255), but the value is constant per leaf, so it does not band.
- **When it is allocated.** The texture is 1×1 until a leaf has fallen on a floor that asked for litter, with no program, no buffer and no pass. `litter_resolution` (default 1024) is a TOPO-class tune knob. Memory per size goes to [`evidence/measurements.md#season`](evidence/measurements.md#season).
- **What the re-season record survives.** The engine re-seasons only while the grove's key still matches, no transition is in flight other than a season-only grove morph, and `faith.buf` is still this grove's: `faith.*` is engine-global, and a grove built for a transition may write it. Otherwise the next `'season'` apply is one full build that keeps a record, and the one after is fast. The record is lazy: a summer build keeps none (recording costs about 5 ms and 7 MB a regrow), and the build keeps one only when the structure it grows is the one on screen, so the spring half of the season macro, which moves structure every tick, does not record and discard one per tick. The exposure field and its rank come from the build when it ran the exposure pass, otherwise from the first re-season whose gate needs `u`, and the cached rank is never written into. A and B₀ are kept as doubles, since the litter's sizes are read from the doubles and a float32 copy differs in the last bits. `hier.leafW` is a new array on every re-season, because the tree inset keys on it. The record keeps each leaf's draws (`season.draws`, four doubles) and its schedule (`season.sched`, eight doubles and the drop day, keyed on `SCHEDULE_KEYS`: the season set without `phenology`, `trans_rgb` and `wall_fraction`, plus `drop_after_turn`); the exposure blend `u` is read only when the schedule is rebuilt. `grove.litter` after a re-season is a getter that builds the list on first read and keeps it; assigning to it replaces it with a plain list, and `refreshLitter` reads it only when the floor wants a carpet. A `'season'` apply bakes only when no frame will (`frameBakes`): with the loop running, the canopy moving and no transition in flight, the next frame's own bake is the one that shows the step, so the apply's would be thrown away.
- **The density capacity's invariants.** The capacity record's key excludes density and checks buffer ownership and free slots; `hier.nLeaf` and the ordinary key describe the active population. The faithful cast frame follows the active leaves: plan bounds scan their double positions plus the wood, and `faith.hMin`/`hMax` start from the twig tips and widen only to active inner leaves, while the layer bins and the fill's `binH` stay the fixed skeleton's. The live morph's leaf budget counts the exact larger prefix, the marginal leaf included, beside the previous conservative estimate, so a source with no leaves cannot slip past it. The bend is republished and the replaced regrow's activity hint (`hier.maxV`) cleared as a regrow would. An interruption or reversal reuses a sufficient capacity or builds a larger one once. The path is independent of every autumn `FEAT_` flag, so a summer bundle may cut them all.

### Transport — [`model/transport.md`](model/transport.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Shift-multiply-sum over the samples | `komorebi-transport.js` | `tap()` | not recorded | smoke; determinism |
| Layer shift by height; the ellipse matrix | `komorebi-source.js` (cast geometry), uploaded | `uProj` | not recorded | smoke |
| Standing scene's bulk shift | `komorebi-source.js` | `uBulkShift`, `hub.bulkShift()` | not recorded | standing looks in smoke |
| Faithful single tap | `komorebi-transport.js` | `tapFaith` | not recorded | faithful gate rows |
| Per-channel diffraction taps | `komorebi-transport.js`, `komorebi-shaders.js` | `tapCA` | not recorded | gate rows |
| Canopy boundary (repeat vs open box) | `komorebi-transport.js`; wrap mode set in `komorebi-render.js` (`REPEAT` for the endless park) | `bulkOn` | not recorded | not recorded |
| Analytic woody occluder | `komorebi-transport.js`, data texture | `uOccSeg`, `uOccHt` | not recorded | `--sky` (wood reads) |
| One program per camera | `komorebi-transport.js` | `buildTransport`, `CAMERAS`, `TRANSPORT_GROUPS`, `GROUP_UPLOAD_KEYS`, `cameraFor` | `registry.test.js` | smoke and determinism through every camera a shipped look selects; `glslcheck.mjs` |

*Representation.* The layer path re-projects every frame from `uProj` and `uBulkShift`, so a still-air sun morph needs no re-bake. The faithful cast is projected along the sun, so a still-air sun morph between two faithful looks re-casts every frame (see [Signatures](#the-signatures-that-decide-a-re-bake)).

### Fill — [`model/fill.md`](model/fill.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Fixed cosine-weighted rays, interleaved over a 4×4 tile | `komorebi-fill.js` (directions made in float64 and uploaded) | `fill_directions` (K) | `fill.test.js` (tile ≥ 2× closer for `T_sky`, ≥ 1.8× for `S` than the unrotated rays) | `--fill` |
| Per-ray quadrature (the shared ray) | `komorebi-shaders.js` (`GLSL_SKY_RAY`), CPU twin in `komorebi-fill.js` | `skyRay`, `skyRayRef` | `fill.test.js` (energy bound over 10⁴ stacks; sun off gives exactly `T·sky`) | fill check |
| The bake | `komorebi-shaders.js` (`FS_FILL`), `komorebi-bake.js` | `makeFill` | not recorded | gate crossed on a running engine |
| Domain: wrapped park, open padded frame | `komorebi-fill.js` | `fillFrame(E, h_max, bulkOn)` (box grown by 3·`h_max`), `fillFrameNow` | `fill.test.js` (torus closure to 1e−9; the books on a synthetic stack) | bookkeeping rows |
| Emission with the diffuse split | shaders, `komorebi-fill.js` | `leaf_diffuse`, `texelMix` | `diffuse.test.js` | fill check with the split on (within 1.2·10⁻⁴) |
| The books (conservation) | harness | `__fillCheck` (`energy`) | `fill.test.js`, `diffuse.test.js` | bookkeeping rows |
| How each receiver reads it | `komorebi-transport.js` | `amb = mix(uAmbient, uAmbient·T_sky + S, canopy_fill)` | the registry (the sky program does not declare the fill group) | gate rows on each camera |
| Faithful path with the fill open | `komorebi-bake.js` | a low-resolution layer bake kept alive, sized by `fill_resolution` | not recorded | gate rows |
| Retired proxy | shaders | `fill_scatter` (inert above `leaf_diffuse` 0) | not recorded | row holding `fill_scatter` inert |

*Representation.*

- **Two targets in one pass.** The fill writes `T_sky` and `S` into **two RGBA16F** textures, two render targets of one pass, so the K·L layer taps are read once. The pass runs after the layer bake, every frame under wind. It runs again on its own when the sun or the sky moves without a bake. The cost is `K·(L + L(L−1)/2)` bilinear half-float taps per texel with the scatter term on and `K·L` without.
- **The mip read.** The 4×4 tile is aligned to the mip chain, so a level-2 box is exactly one tile's 16·K directions. The receiver reads **level 3**, four tiles. That is the one place a mip touches the fill. It is lawful because `T_sky` is already a transmittance and `S` a radiance. Why level 3 rather than level 2 is in [`evidence/measurements.md#fill`](evidence/measurements.md#fill).
- **Divide, don't scale.** The sum is divided by K, not multiplied by `1/K`, so K rays of exactly 1 give exactly 1.
- **The literal off line.** At `canopy_fill` 0 the floor is the literal `(acc·uSunColor + uAmbient)·uGround`, in the else of a uniform branch. It is a branch rather than a separate program because `canopy_fill` tweens, and programs are selected by MODE flags only. The fill's textures, program and FBO are not allocated.

### Receivers — [`model/receivers.md`](model/receivers.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Receiver interface (geometry up, material down) | `komorebi-transport.js` (material rides the camera entry) | `CAMERAS` | `registry.test.js` | gate rows |
| Floor | `komorebi-transport.js` | `uGround`, `col = (acc·uSunColor + amb)·ground` | not recorded | smoke |
| Litter on the floor only | registry: the `litter` group belongs to the floor camera | `uLitterOn`, `uLitterOrigin`, `uLitterExtent` | not recorded | rows holding curtain, tent and sky view unchanged with the litter gate open |
| Curtain: transmission, standing plane, pleats, mullions, window, fold warp | `komorebi-transport.js` | `mullionT`, `velvetCloth`, `clothUV`, `castUV`, `uCurtainBake`, `uClothY` | not recorded | gate rows (a floor look ignores the whole fabric family; a zero gate ignores its geometry) |
| Faithful cast re-aimed at the cloth | `komorebi-bake.js` | `uCurtainBake`, `uClothY` | not recorded | curtain looks |
| Tent: polytope, panels, seams, mesh | `komorebi-transport.js` (fifteen planes in eleven panel groups) | `TENT_TMAX` (a safety clamp only) | not recorded | tent looks in smoke and determinism |
| Window aperture across a zero gate | `komorebi-transitions.js` | not recorded | `transitions.test.js` | not recorded |

*Representation.* The enclosure forces the layer tier (`receiver = 2`). A flip re-packs the grove's per-mode cluster data and reallocates the layer textures, so it runs the full rebuild. One derived predicate, `faithfulOn()` (`faithful_canopy`, and neither the enclosure nor the sky view), gates the bake dispatch, the texture sizing, the per-mode cluster packing and the governor's quality model together. They must agree on every frame, or the layer bake reads faithful-packed data and the leaves slide off their twigs.

### Sky view — [`model/sky-view.md`](model/sky-view.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Transmission along eye rays | `komorebi-shaders.js`, `komorebi-transport.js` | `GLSL_LAYER_FIELD`, `GLSL_SKY_RAY` | `skydiffuse.test.js` | `--sky` |
| Wood as silhouette; the occluder budget | `komorebi-transport.js`, `komorebi-bake.js` (wood stamp) | `GLSL_WOOD_FIELD`, `woodTex[L]`, `uWood`, `readWood`, `MAX_OCC` (256 segments), `tree_count·(limb_count + 1) ≤ 256` | not recorded | `--sky` (wood reads) |
| Source seen; authored gains | `komorebi-transport.js` | `srcSeen` (composed last), `SKY_SUN_GAIN`, `SKY_SKY_GAIN` | not recorded | `--sky` |
| Canopy glows (single scatter) | shared ray | `sky_scatter`, `uSkyScatter` | `fill.test.js` (bound shared with the fill) | gate rows |
| The lantern (diffuse split along the eye ray) | shared ray | `uBeamK`, `Tsrc` | `skydiffuse.test.js` (identity along the source ray to 1e−12) | `--sky` at `d` 0, 0.5, 0.95; `canopy 1` row blind to `edge_area`/split knobs |

*Representation.*

- **The wood texture.** Each layer's wood is one **R16F** texture, holding wood optical depth only. Leaves keep their own RGBA16F texel, so transmittance is `e^(−τ_rgb)·e^(−τ_wood)`, while scatter density and hue use `e^(−τ_rgb)` only. The wood was moved out of the leaves' alpha into a texture of its own.
- **Why R16F and not something cheaper.** Wood depth accumulates additively, and it has to round exactly as it did in the alpha of an RGBA16F. With R16F the move changed no frame at `leaf_diffuse` 0; `canopy 1`–`4` were pinned in pixels before the change.
- **When it is allocated.** The textures are layer-sized only when `sky_view` is on, and 1×1 otherwise (the `faithTex` idiom). They are freed in `dispose()` and rebuilt on a context restore.
- **Bundles.** The sky camera's group (`uBeamK`, `uWood` and their uploader) leaves the player bundle, whose looks select only the floor.

### Motion — [`model/motion.md`](model/motion.md)

| Mechanism | Module | Named | Unit | Harness |
|---|---|---|---|---|
| Broadband wind signal; patterns and weather | `komorebi-motion.js`, `komorebi-math.js` (wind noise) | `WIND_PATTERNS` | not recorded | determinism under frozen motion |
| Trunk/limb/twig spring hierarchy; rotations | `komorebi-motion.js` | joint rotations as `mat2(c,s,-s,c)` in both leaf shaders and the CPU wood | not recorded | not recorded (a still frame cannot expose a wrong sign) |
| Drift phase (incoherent band) | `komorebi-motion.js` | `drift_phase`, `auto` | not recorded | transition suites (drift continues through landing) |
| Spring state across a regrow | `komorebi-engine.js`, `komorebi-motion.js` | common prefix carried over | `grove-travel.test.js` | `test-gl/grove-travel.mjs`, `test-gl/season-travel.mjs` (residual springs) |
| Motion mirror (editor) | `komorebi-editor-tools.js` | `setMotionSource` | not recorded | not recorded |
| Adaptive frame rate | `komorebi-engine.js` | `adaptive_motion`, `adaptive_idle_fps` (offscreen target, blit) | not recorded | the video exporter refuses it (forced off) |

### Transitions — [`model/transitions.md`](model/transitions.md)

| Route | Module | Unit | Harness |
|---|---|---|---|
| Live morph, grove morph, shared-layer crossfade, capped bloom | `komorebi-transitions.js` | `transitions.test.js` (routing; through the real sampler) | transition-routing suite in the pixel harness (each tier driven to completion); `test-gl/dissolve-landing.mjs` (the cloud dissolve's landed frame against the target loaded fresh); `test-gl/eclipse-crossfade.mjs` (the crossfade across layer counts and the moon: start, landing, spikes, interruptions, the sky view, the settled `eclipse` against the engine before) |
| Floor-to-floor fade through the lit ground | `komorebi-transitions.js` | `transitions.test.js` | routing suite; `test-gl/dissolve-landing.mjs` (landed against fresh, both directions) |
| Scene dissolve (faithful structural pairs leaf travel refuses, carpeted floor-to-floor mode changes, a driver's fade) | `komorebi-scene-fade.js` | `transitions.test.js` (routing) | routing suite |
| Viewpoint sky↔floor | `komorebi-transitions.js`, `komorebi-transport.js` (fifth camera) | `viewpoint.test.js` | `test-gl/viewpoint.mjs` |
| Leaf travel faithful↔layer and faithful↔faithful | `komorebi-leaf-travel.js` | `leaf-travel.test.js` (correspondence, area) | `test-gl/leaf-travel.mjs` |
| Season travel | `komorebi-season-travel.js` | `season-travel.test.js`, `transitions.test.js` | `test-gl/season-travel.mjs` (compiled faithful fragment against the per-leaf reference across both edge modes) |
| Litter rise and fall | `komorebi-litter-rise.js` | `litter-rise.test.js` | `test-gl/litter-rise.mjs`, `test-gl/litter-fall.mjs` (`--render`) |
| Shadow rise and fall | `komorebi-litter-rise.js` | `shadow-rise.test.js`, `transitions.test.js` | `test-gl/shadow-rise.mjs`, `test-gl/shadow-fall.mjs` (`--render`) |
| Grove regroup | `komorebi-grove-travel.js` | `grove-travel.test.js` | `test-gl/grove-travel.mjs` (`--render`) |
| Eclipse gate (the moon crosses) | `komorebi-transitions.js` (`trans.moon`), `komorebi-source.js` (`moonSpacing`, `moonClear`, `moonDistance`, `moonX`, `moonCover`) | `transitions.test.js` | `test-gl/eclipse-crossfade.mjs` |
| Key classes | `komorebi-params.js` | `MORPH_KEYS`, `CANOPY_KEYS`, `TOPO_KEYS`, `MODE_KEYS`, `SEASON_KEYS`; `CANOPY_MORPH_MAX` | `transitions.test.js` and the coverage test (every knob classified or explicitly excluded) | — |

`test-gl/fixtures/` holds four route fixtures (`fall-look-up.json`, `fall-park.json`, `look-up-fall.json`, `purple-look-up.json`); what each holds is not recorded. The gates themselves are [`contracts/transitions.md`](contracts/transitions.md).

*Representation of the travelling routes.*

- **Leaf, season and grove travel** each cast their moving leaves into a transient **RGBA16F** world-space transmission map. The floor reads that map before lighting and grading. The map's bounds include the full projected halo. Season and grove travel use the larger endpoint sample and bake budgets, scaled by the current governor.
- **The litter flights** accumulate optical depth and reflected-light moments in **two RGBA16F eye targets** at up to twice the canvas dimensions. The final read averages four transmittances, not four optical depths.
- **The scene dissolve** renders both scenes into canvas-sized **RGBA8** targets in one GL context. It decodes them by gamma 2.2, mixes, and re-encodes.
- **Cleanup.** Every route releases its temporary scene, programs and textures on completion, hard replacement, disposal and context loss.

## The signatures that decide a re-bake

Several passes do not run on a schedule. Each frame they compare a numeric snapshot of their inputs and re-run only when it has moved. Each signature carries exactly the inputs that change a bake's output without some other bake running. A missing entry freezes a picture while its knob tweens. A spurious entry re-bakes every frame.

**The fill's signature** (`fillSig`, length `FILL_SIG_LEN` = 17, exported, and the engine sizes its array from it). It re-runs the fill alone when the sky or the sun moves and no bake does. Its slots, in order (`komorebi-bake.js`):

0. the sun's elevation, 1. its azimuth, 2. the turbidity (the sun's colour and the sky's);
3. the leaf albedo the fill pass reads (`fill_scatter`, on a floor camera), 4. the ray count, 5. the fill texture's resolution;
6. the layer count, 7. the canopy's base height, 8. its thickness, 9. its extent;
10. whether the cast is faithful, 11. the leaf's ballistic share (`leaf_diffuse`, through `ballisticK`): it changes what `S` is made of, and no bake runs when a MORPH key tweens;
12. whether the canopy wraps (the open box and the padded frame of a finite tree);
13. the edge law (`edge_area`): it changes what both `T_sky` and `S` are made of;
14. the receiver's cosine (`sun_cosine`) and 15. the air's loss (`sun_extinction`): live scales of the sun colour that `S` reads;
16. the park's shear (`park_throw`, 0 on a finite scene): it moves the beam's path the fill bakes along.

The skylight's level is not in it: `ambient_skylight` scales the fill where a receiver reads it, not where it is made.

**The faithful cast's snapshot** (`refreshFaith`). A still faithful cast compares a reusable snapshot before drawing:

- the source offsets and weights;
- the sun angles;
- the cloth plane;
- drift;
- the leaf-bake uniforms;
- the bake resolution;
- alongside it, checks on the diffuse split, the wood and the edge law.

A change re-casts once even with the wind off. Regenerating identical samples does not. Sample count alone cannot describe the source or its projection. The live-wood refresh re-casts when a radius, layer-height tween or `branch_tau` changes, including in still air. With wood off it does nothing, so a leaf crossfade never rewrites the incoming grove's faithful geometry from the outgoing skeleton.

**The carpet's signature** (`refreshLitter`, once per frame, before any target is bound). It re-bakes when any of these moves:

- the grove (a new value per regrow, a transition's morph included);
- the authored wind direction;
- `litter_age` and `litter_drift_m`;
- the phenology;
- the seed;
- the size or the frame;
- `leaf_wetness` (MORPH-class, so only the carpet re-bakes).

It never re-bakes for the live wind, the sun or the fill. It keys on the grove and the litter keys, not the pigment capacities. A re-bake does not sort or draw again what the clock did not move: a re-seasoned grove's list carries its drop order (`byDay`, not enumerable, read off `season.sched.byDay`, every leaf in `litterOrder`'s order, sorted once per schedule), and `litterInstances` keeps each landing (`newLitterCache`, per grove, keyed on the seed, the drift and the wind direction, checked against the leaf's own place), writing the instances straight into one typed buffer. Every route that grows a grove calls it, including a context restore and an editor slider. The harness measures `passes` at 1 after two dozen frames.

**The grove's structural key.** It is every param `buildGrove` reads besides the season set, plus `faithfulOn()` (`GROVE_READS`). The list was derived by grepping the grove, and a test greps again. A key mismatch regrows; a change only in `SEASON_KEYS` re-seasons. The density-capacity record has its own key, which excludes density and checks buffer ownership and available slots.

**The held-leaf inset** (editor only). A change of leaf, size or (for an outline) aspect regrows the maze. The vein share re-rasterises the masks. Season and pigments only recolour. A regrow or re-raster waits until its inputs have been still for 250 ms.

## Numerical discipline

The piece's preservation and determinism contracts are executed by equality in pixels ([`contracts/preservation.md`](contracts/preservation.md), [`contracts/determinism.md`](contracts/determinism.md)). That makes floating point a design input. These are the traps the code is built around.

- **GLSL matrices are column-major.** The joint rotations are written `mat2(c,s,-s,c)` in both leaf shaders and in the CPU wood, the same counterclockwise rotation. Reverse that constructor and the foliage separates from its wood under wind. A still frame cannot show the mistake, so only motion exposes the sign. The leaf's own angle is the same trap the other way: the outline uses a clockwise rest-angle basis while the joint bends are counterclockwise, so the shaders write `angle − limb bend − twig bend`.
- **A divide by a uniform is not a divide by a literal.** A divide by a uniform may compile to a multiply by a reciprocal (about 2.5 ULP), where a divide by a literal may be an exact multiply. So `GLSL_LEAF_Q` keeps its literal `/8.0` line, and a uniform branch (`if(uLeafRows > 0.0)`) overrides it only for a varied grove. The vertex side can take the uniform: a highp `*` is correctly rounded, and x·32 is a power-of-two scaling of an exact fraction, so `fract(iC.w)*uLeafIdFrac` at 32 is the same IEEE bits as the literal it replaced.
- **Zero terms that vanish exactly.** With `edge_area` on at `k = 0`, every reader takes `texelMix`, and `exp(-tbar - 0.0*c/a)` is `exp(-tbar)` bit for bit, so `T_b = T`. Likewise `sky_scatter = 0` adds an exact zero to the transmission term, which IEEE 754 guarantees. The wet step at `leaf_wetness` 0 gives `S_w = 1` and `F_w = F` exactly, checked with `Object.is` against the dry evaluation.
- **Angles are made in float64 on the CPU.** GLSL ES promises only about 2⁻¹¹ absolute error from `sin` and `cos`. A fill ray's plan shift is `tanθ·h`, tens of metres near the horizon, so a few 10⁻⁴ of angle is centimetres on the floor, more than a leaf's edge. The fill's unit vectors `(cos φ_k, sin φ_k)` and the sixteen tile rotations are computed in float64 and uploaded. The shader rotates, shifts by cos²θ and takes one `sqrt`. A first shader that computed `cos φ` itself missed its CPU reference by 3·10⁻³ to 9·10⁻³.
- **Identities that make an off state exact.** At aspect 1, `Math.sqrt(1)` is exactly 1 and `x/1` is `x`, so an outline's `A` and `B0` keep their old bits. The ellipse's quad is `aCorner·1 + 0`, the same bits.
- **Float sums do not undo.** `(x + ε) − ε ≠ x` in float, so the drop gate opens one `DROP_EPS` early on purpose. An early open is free, because `retention` returns exactly 1.
- **Pin digests rather than re-deriving them from buffers.** Positions come back from the buffers through float32, and re-ranking from them re-orders a few dozen leaves in ten thousand. So `drop.test.js` freezes a digest of every leaf's τ instead of recomputing it from the buffer. Likewise the density-capacity path never divides a fade out of float32 data, and keeps the literal marginal-leaf × marginal-tree multiplication.
- **Stable inverses.** `kmReflect(X) = 1/(1 + X + √(X² + 2X))` is the stable form. The textbook `1 + X − √(X² + 2X)` is NaN at `R = 0` and cancels badly below `R ≈ 1e-4`.
- **Writes past the end of a `Float64Array` are silent.** An out-of-range index write is dropped without error. A signature array sized by hand and shorter than its writer would leave a slot permanently at its old value, compared against a fresh one that never lands, and the fill would re-bake every frame. So `FILL_SIG_LEN` is one exported number, and the engine sizes its array from it.
- **The `FEAT_` constants are declared verbatim** as `const FEAT_X = true;` in each module that guards a tier. The build substitutes that exact text and throws on a module that uses a flag it does not declare. Without that, a module that forgot the declaration would keep its tier while the build reported it cut.
- **The orphan sweep runs to a fixpoint.** After every other cut, a top-level `const GLSL_|VS_|FS_ = ` literal that nothing references except its declaration and the import/export lists is deleted, together with its list entries. The sweep repeats until nothing more goes. It exists because a minifier keeps an unreferenced template literal that contains a `${}`. Before the sweep, a floor-only bundle carried the cut sky camera's `uSkyScatter` four times. The minifier folds `false ? A : B` only after the sweep has counted A's references.
- **Half-float tolerances are stated, not assumed.** The fill check holds the shader to its reference within one half-float ULP. The fill check with the split on holds within 1.2·10⁻⁴. The sky check's worst error is 1.6·10⁻⁴ against a tolerance of 10⁻³. In each case a wrong ray, height, weight or sun path is orders of magnitude outside the tolerance.

## The editor and the player

The editor is a tool for exploring the model, not part of it: nothing here reaches a look's frame, a bundle or the engine. `index.html` is its shell and `editor.js` its body; the map names the pure siblings.

**Three surfaces.** The mode ladder runs from a zen strip (the default, which fades after stillness) to the playful macro sidebar and the advanced panel. After "feel" the active surface slides in, on a touch screen as on a desktop. **D** toggles it (in zen it wakes or fades the strip); **F**, or a double-click on the picture with a mouse, toggles fullscreen. On touch there is no keyboard: a **tap** on the picture toggles the surface as D does, and yields to a swipe once the finger passes a 12 px deadzone. The first arrival on a touch screen shows the two gestures once, in the key-hint line. While a finger holds a slider on any of the three surfaces, everything but that slider's row fades out so the picture shows, and returns on release.

**What the strip and the playful sidebar offer.** With a mouse the strip is one bar of three dials: focus, cloudiness and time. On touch it shows one dial at a time above a row of words (focus, clouds, sun, season, time) that picks which, with *as it was* and the way up to the playful sidebar beside them. The playful sidebar leads with focus, cloudiness, sun, season, density and time, then *as it was* and *new leaves* (a new seed); haze, sparkle, the tree count and the wind pad sit one step further, under *more*. Each dial names both of its ends, starts from the look's own value, which a mark on the track shows, and writes only what it names, so a touch at rest changes nothing: focus is the focus macro, cloudiness is `cloud_thickness`, sun turns `sun_azimuth_deg` up to 90° either way, season is `phenology` from the start of the turn, density scales `foliage_density` between 0.6 and 1.4 of the look's. Time here is an offset of up to two hours either way from the look's own sun, moved along the clock model's arc and never below 15° of elevation; it does not write `time_of_day`. While a dial moves, one sentence says what is happening in the world's words and goes quiet a moment after; a dial the look cannot use stays in place, dimmed, and says why when touched. *As it was* returns what these dials wrote to the look's values.

**The look in the advanced panel.** The panel opens on the look's name between ‹ and ›; the name is the dropdown of the active list. Under it, the chip, then *save* and, behind ···, *delete* and the JSON pair. The toggle that lists the experimental looks is the panel's last row.

**The advanced panel.** Its eleven areas, grouped by the pass you make, are Sun, Colour & light, Density, Season, Leaves, Tree shape, Scene, Wind, Tune, Debug and Lab; each remembers whether it is open, and until one is touched *Colour & light*, *Density* and *Season* start open. Within an area the knobs authored per look come first and the set-and-forget mechanics fold into a collapsed group, a split chosen from which knobs actually vary across the shipped looks. Every control and heading has a tooltip that leads with a plain "this does that" and then builds to the physics: meant to give a mental model, not an inventory.

**A row shows only where it acts.** A row hides on a camera whose program does not declare its uniform group (the litter's rows off the floor, the fill's in the sky view, the fabric's on the floor), and while a gate of its own is shut, read through the predicates the grove and the registry use: the pigment rows, the per-tree spreads and leaf fall until a leaf can be turning; the drop's start, span and light order while nothing falls or after the turn (`drop_after_turn`), and `drop_lag` only after it; `litter` until leaves fall, and its age, drift, wetness and resolution until it is open; `exposure_absolute` while neither a lit turn nor a light-ordered drop reads the exposure order; the fill's ray count and resolution while `canopy_fill` is 0; `edge_area`, `fill_scatter` and `sky_scatter` above `leaf_diffuse` 0. An area or a heading with nothing left under it hides with its rows. The check runs on a signature of what the predicates read, so a frame where nothing moved pays nothing.

**Keys.** The arrows step the active list with a transition, and are ignored while a panel input or select has focus, so a focused slider still takes them. **R** draws a new seed, **T** and **L** toggle the insets, `[` and `]` step the held leaf, ⌘S or Ctrl+S saves, and any other bare key shows the key hints for ten seconds.

**Pointer.** On the desktop a drag orbits the camera (↔ `view_yaw_deg`, ↕ `view_pitch_deg`, 0 to 80°), a shift-drag pans (`view_center_x`, `view_center_y`) and the wheel zooms (`view_extent_m`, 0.5 to 40 m). Dragging the sun instead is a toggle in the *Scene* area, off by default. On touch a swipe on either axis steps the list on release (up or left is next), the name of the look it lands on passes across the top, and no gesture on the picture writes the look. A pointer resting on the picture hides after 3 s.

**Time of day.** `time_of_day` and `latitude` place the sun for an **equinox** day (declination 0): the hour angle runs 15° an hour from solar noon, `elevation = asin(cos lat · cos H)` (floored at the engine's 4°), and the azimuth sweeps east through south (180°) to west, so latitude caps the noon sun at 90° − lat. `updateSunFromTime` is one-way: it writes `sun_elevation_deg` and `sun_azimuth_deg`, and a look stores the angles, never the time.

**The HUD.** Shown only while the advanced panel is up and the A/B wipe is not, it carries only what is live and computed and cannot be read off a slider beside it ([`evidence/dead-ends.md#editor-echoes`](evidence/dead-ends.md#editor-echoes)): `blur h·θ`, the canopy's base height times the sun's angular radius in centimetres, the literal softness of the dapples; and a live wind score, the instantaneous forcing with the base strength and the weather spell folded in, beside a word (calm, light, breezy, windy, strong) read off the effective strength, `wind_strength` times the weather. The word reads strength, not pattern or gustiness, so it drifts with the weather over a day. Performance is a warning, not a gauge: the frame rate appears below 55 fps, and the governor's resolution scale only while it is below 1.

**The tree inset** (`T`, bottom-right; hovering grows it, a click pins it). It draws the grove's own skeleton (`hier.segments`, tapered quads, solid behind the leaves and faint over them) and a blob per leaf, placed by the grove's own `placeLeaf` over the grove's draw order, as a translucent haze whose per-leaf opacity falls as `leaves_per_cluster × foliage_density` climbs, a different green per tree, in a slowly turning three-quarter view with a wind arrow and a ground grid. A dropped leaf leaves it: it reads `hier.leafW`, the retained weight by (twig, slot), which is null at the abscission gate. It is projected on the CPU into a scissored corner, so it costs nothing unless shown. **Approximation:** its sway is a height-weighted downwind lean plus the trunk's drift, not the bake's per-joint motion, so it leans a little harder than the cast moves.

**The held leaf** (`L`, bottom-left) is [`model/leaf.md`](model/leaf.md#the-held-leaf)'s. `[` and `]` walk one ring over every leaf the grove hangs, cluster by cluster, wrapping at both ends, and a click enlarges it. It carries a 1 cm bar, the address `j·k`, the outline variant and s, a and b; with a per-tree knob up, the tree it hangs on with that tree's lead Δ and depth c, drawn from the seed the picture was made with, so it recolours with those sliders like the pigments. It is drawn at the look's nominal `leaf_size_m` (an outline at `leaf_size_m/√aspect`, both named when they differ) and says the grove draws 0.6 to 1.4 times that. When it redraws is under [Signatures](#the-signatures-that-decide-a-re-bake).

**The profiler** (editor tier only). It measures a look at full resolution with the governor held off, by GPU timer queries averaged over real on-screen frames, split transport against bake, beside the live frame rate at full quality, and ablates each axis of the cost audit ([`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md#the-cost-audit-who-may-cross-a-rung)) to read its share. It runs both ways:

- **Lighter.** `proposeVariants` ranks the cuts worth taking (at least 5 % of the frame) by their measured saving on this look, not by a fixed order, and composes up to three cumulative variants: the biggest safe cut (*lite*), every worthwhile safe cut (*medium*), and those with the risky and tune cuts (*min*). Identical rungs collapse.
- **Richer.** The breakdown shows the **spare budget**: one 60 fps frame (16.67 ms) less the measured cost. With spare, the safe axes' up-levels are measured for their added cost, and `proposeImprove` takes them by visual priority (more samples, then sharper textures, then a depth layer) while they fit 0.7 of the spare, offering one *improve* variant, or nothing when none fits: no padded recommendation. The fill's ray count and resolution are **cut-only**, with no up-level, so the improve proposal can never offer a look that does not use the fill a free upgrade to it. `faithful_canopy` has none either: turning it on is an author's decision, not a budget spend.
- `leaf_diffuse` and `edge_area` carry no axis: the split costs a divide and two exponentials on a texel already fetched, and the fill's added sun-path taps sit inside the `canopy_fill` axis.

Both directions land on the same **A/B wipe**: a second engine on a stacked canvas behind a draggable divider, its wind mirrored exactly by `setMotionSource`. The mirror is sound because a variant never changes the grove skeleton, so the spring arrays line up one for one, and the gust and the flutter match across the seam. Each side's live frame rate is shown. The second engine is disposed when the wipe closes. A chosen variant is saved like any look, named after its source (`afternoon 7 · lite`).

**The macro bus** (`macros.js`). The sidebar's and the strip's controls are macros, not parameters: one input `t ∈ [0, 1]` drives an authored recipe through `createBus`, `set(key, t)` in and a partial parameter set out, so MIDI or audio could drive the same keys. Every stop is lifted from a shipped look; numbers interpolate piecewise-linearly between stops, and strings and booleans snap to the nearer. Each macro declares a **probe**, a parameter strictly monotone across its stops, which the bus inverts to seat the thumb on the current look. A macro is gated to the cameras where its recipe is honest: `floor` (haze, ground, season, grove) needs the floor receiver and no sky view, `cast` (prism) any camera but the sky view. What a macro may never write is [`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md)'s.

**The season macro.** Its stops, `t` against `phenology`: `memories` 0 and 0.15, `morning 1` 0.35 and 0.40, `afternoon 4` 0.55 and 0.50, the last green day 0.62 and 0.60 (`turn_start`; no look), `montebello` 1 and 0.90. At every stop the capacities are `montebello`'s: `anthocyanin` 0.4, `tannin` 0.2, `wall_fraction` 0.2, `turn_exposure` 1, `leaf_drop` 1. It declares `tween: 0.8` s: `set` stores a target, and the frame clock's `tick(dt)` eases the macro's own value toward it by one pole, `x += (target − x)(1 − e^(−dt/τ))`, monotone, never overshooting, and composing across any split of the same elapsed time. Each tick applies the recipe at scope `'season'` once, and only when it changed; within 0.002 of the target it applies the stop's exact parameters and idles; loading a look cancels it. The step clamp (`TWEEN_STEP`) is [`model/season.md`](model/season.md#a-season-played-live)'s.

**The cost gate.** The editor times every season apply and keeps a moving average of it (`tweenGateStep`): when one costs over 12 ms the next waits `cost/0.30` ms of wall time, while the ease keeps running on the clock, so the catch-up is a bigger step and not a stall; once the average passes 50 ms the drag falls back to one exact apply on release. A one-off build of the re-season record is not measured, or it would latch the fallback for the whole drag; a build that follows a build, the spring half where every tick regrows, is.

**Lists, play and links.** What the dropdown lists, and what the arrows, the ‹ › and the swipe walk, is the active list, wrapping at both ends. Its rules are `playlists.js`'s; arboretum's three tiers (local always, read from any origin, the session only where arboretum answers and you are signed in) are set out at the head of `arboretum.js`. Only an arboretum playlist plays, because only it carries times: each look is held for its dwell, then the next arrives over its own crossfade, by the automatic route or as a fade, which each item of a playlist of yours chooses on a *morph* / *fade* row in the advanced panel (the item's, not the look's; the row is absent where there is no such item), and the dwell starts when a look has **finished arriving**, so a long crossfade never eats the time a look is meant to be seen. The look play starts on has no fade in; any edit of the look stops play; a step by hand restarts the dwell. A look brought in by a link refreshes in place the copy already here from the same preset, and never one holding an edit not yet sent up (it lands beside it); the hash is cleared once the look has landed, and a failed link says why in the key-hint line. *Copy JSON* and *paste JSON* move a whole look as text.

**The player.** `player.html` is viewer-only: no panel, and no input but a pointer that hides after 3 s at rest. It cycles `morning 2 → afternoon 5b → morning 3`, starting a five-second `transitionTo` every 30 s, and wraps the engine in a `try`, so without WebGL2 or float targets the page keeps a blank background and stays usable.

## The harness

Two tiers. The **unit tests** (`*.test.js` at the root, run under `bun test`) hold the pure laws, plus the wiring over a stub GL. The **pixel harness** (`test-gl/`, run by `test-gl/run.js` through `test-gl/harness.html`, with helpers in `harness-lib.mjs`) renders real frames in headless Chromium on WebGL2 via SwiftShader. Under frozen motion its captures are stable to the byte, so the assertion is equality rather than a tolerance. Renders are evidence, not source.

### Pixel harness suites (`nix run .#pixels`)

| Suite or row kind | What it proves |
|---|---|
| **Smoke** | every shipped look creates, renders a non-degenerate frame and raises no GL error; a PNG per look under `test-gl/out/` |
| **Gate invariants** (equality rows) | a gated feature's off state reproduces the previous frame in pixels: a floor look ignores the whole fabric family, a zero gate ignores its geometry, zero equals absent |
| **Live rows** (`differ`) | the two frames must *not* match, proving that the gate is a real switch and that the equality rows beside it are not passing on a dead feature |
| **Pins** | one look's own hash, written down from the engine *before* a change that touches no gate (for example, moving the sky view's wood to its own texture). An a == b row can survive a change that moves both sides; a pin cannot |
| **Energy rows** (`lit`) | the frames differ *and* the split frame's mean level lies between bounds; a frame that threw its diffuse light away sits below them |
| **Continuity rows** (`near`) | a leaf count stepped from none to 0.005 of a leaf moves the frame by a hair (the marginal fade) |
| **Determinism** | two independently created engines under frozen motion give equal frames: no sampling RNG, measured |
| **Fill check** (`--fill`) | the engine bakes a real fill; the harness reads back the layers it read and the `T_sky`/`S` it wrote, rebuilds them at sampled texels from `komorebi-fill.js` (bilinear taps through the fill's own domain, the bake's heights, atmosphere and beam sun path) and compares within one half-float ULP; also run with the split on, emission against coverage read back out of alpha |
| **Gate crossed on a running engine** | what is allocated at each step, and that shutting the gate again restores the old frame exactly |
| **Live-change suite** | a knob assigned on a running engine gives the frame an engine born with it gives (the fill re-bakes, the faithful cast re-casts) |
| **Bookkeeping rows** (`__fillCheck`'s `energy`) | on the real baked layers: what the leaves emit, what the hemisphere sends down, what the beam gives up, what the fill texture holds. The endless park is held to its closure and the bottom layer's identity, the beam's deficit to the clumping band, a finite tree to its padded frame's share and the glow's decay at the frame edge. These rows were red on the engine before the wrap, the frame and the one-sun rule |
| **Sky check** (`--sky`; `SKY_CHECKS`, `__skyCheck`) | a program compiled from exactly the engine's snippets (`GLSL_LAYER_FIELD`, `GLSL_WOOD_FIELD`, `GLSL_SKY_RAY`) runs 1024 fixed eye rays with `readWood` true on the layers and R16F wood the engine baked, and holds `T`, `T_src` and the glow to `skyRayRef` at `d` 0, 0.5 and 0.95 on `canopy 1`–`4`; the rows also count what they measured |
| **Edge rows** (`--edge`) | the lantern's rim, the beam's halo and the faithful stamp, each measured on the shader the engine compiles and the layers it baked; `edge_area` has rows in each suite |
| **Litter rows** | the whole family armed behind a shut gate in a frame the carpet would bite (zero equals absent at phenology 0.9 with `leaf_drop` 1); `differ` on both floor paths, with the fill open; curtain, tent and sky view unchanged with the gate open |
| **Carpet check** (`__litterCheck`, `--gate litter`) | the baked RGBA8 carpet read back and held to a CPU painting of the same stamps in drop order, with the reverse order as the yardstick; a sparse carpet to its closed forms; `passes` at 1 |
| **Stamp check** | a direct draw of the stamp shader: layering (`src + dst·(1 − a)` exactly), the blend, sub-texel area, the rim |
| **Context-loss rows** | a look with the fill open, and one with the carpet, since their programs, textures and buffers exist only while a look opens those tiers (`montebello` opens both); restoration rebuilds them |
| **Transition routing** | each tier driven to completion; logic only |
| **Eyes mode** (`--look "<look>" key=value …`) | a look rendered with overrides, re-baked first, written to `out/`; not a suite, and asserts nothing |

`--gate [substring …]` runs only the gate rows whose name matches. It is the fast loop for adding a gate. `--fill`, `--sky` and `--edge` run their suites alone.

### Route drivers

`test-gl/viewpoint.mjs`, `leaf-travel.mjs`, `season-travel.mjs`, `litter-rise.mjs`, `litter-fall.mjs`, `shadow-rise.mjs`, `shadow-fall.mjs` and `grove-travel.mjs` drive one travelling route each on WebGL. Between them they cover:

- native endpoint pixels and moving landings;
- reversal and queued selections;
- wind, drift and adaptive clocks, and residual springs;
- the reduced-quality midpoint, resize and cancellation;
- hard replacement, resource release and context recovery.

Most take `--render` to capture the authored pair. What each route promises is in [`contracts/transitions.md`](contracts/transitions.md).

### Other proofs

| Tool | Command | What it proves |
|---|---|---|
| **Embed check** (`test-gl/embed.mjs`) | `nix run .#embed-check` | the embed bundle and the raw ES modules render every kept look byte-identically in one page, on the same GL stack under frozen motion; `--against <bundle.js>` diffs an older deploy and writes a contact sheet; `--over '<json>'` renders with params that open a tier (the fill, for one) |
| **Review sheets** (`test-gl/review.mjs`, `review-example.json`; `review.test.js`) | `nix run .#review -- spec.json` | judging frames rendered from a clean export of a commit, laid out as labelled sheets with quotable IDs, plus the `manifest.json` each review folder carries; where a look's deliberate change is shown to José |
| **Editor smoke** (`test-gl/editor.mjs`) | `nix run .#editor` | index.html's mode ladder, the macro bus, saving, playlists, the panel's areas, the look chip and arboretum's tiers, asserted on observable DOM effects the pixel suites cannot see |
| **Shader validation** | `node glslcheck.mjs` (invocation not recorded) | every GLSL literal compiles under `glslangValidator` |
| **Video exporter** (`render-video.mjs` and its siblings) | `nix run .#video -- …`; tests via `node --test test-gl/video.test.mjs` and the other test files beside it, each naming its run command in its header | its own tests: downscale, frame pairing, run key and refusals, playlist timeline, parallel claims; GPU checks are separate files; see the map |

### Running and what stays untracked

- **Unit tests:** `bun test` (the old spec's word; the exact devShell invocation is not recorded).
- **Pixels:** `nix run .#pixels`, with a suite flag where wanted. The first run on a machine needs `cd test-gl && npm install && npx playwright install chromium`. Playwright's Chromium sits outside nix on purpose, because it pins its own build. The video exporter's Playwright is pinned to the version of the Nix Chromium it renders with.
- **Untracked:** PNGs, everything under `test-gl/out/` (review folders included) and `node_modules/`.

## Build and bundles

**One definition of a build.** `embed-build.mjs` writes both bundles:

- `nix run .#build` keeps every shipped look and writes `dist/komorebi.player.min.js`;
- `nix run .#embed -- '<look>'…` keeps the named looks and writes `dist/komorebi.embed.min.js`.

The functions are exported, and the command line runs only when the file is the entry script (`bundle.test.js`, `features.test.js`). Every cut is read from a table, never decided by hand.

**Camera pruning.** `cameraFor()` reads the kept looks and names the cameras they select. `CAMERAS`, `TRANSPORT_GROUPS`, `GROUP_UPLOAD_KEYS` and the per-frame `GROUP_UPLOAD` are pruned to that set, keeping the three-halves agreement `registry.test.js` guards. An unreachable camera takes its GLSL, its uniform groups and its upload with it, and the orphan sweep removes its shader strings. Only the experimental looks select a camera other than the floor, so the player bundle carries the floor camera alone.

**The feature registry and the four-way cut.** The fall tiers are interleaved in the floor program and the grove, so no table cut sheds them. They are cut by a registry derived per look, the way the camera is. `FEATURES` and `featuresFor(P)` in `komorebi-params.js` say what opens each tier, and the build keeps the union over its looks:

| Tier | Opened when |
|---|---|
| `fill` | `canopy_fill > 0` |
| `leafDiffuse` | `leaf_diffuse > 0`, or `edge_area` on (its uniform is its own `beam` group) |
| `pigment` | `senescing` |
| `exposure` | the exposure pass runs (`ordered`) |
| `drop` | leaves are dropping |
| `litter` | `litter > 0` and leaves are dropping |

The predicates are those of `komorebi-math.js`, read by the grove and the registry alike, never restated. The dependency that is easy to miss: `ordered` is `lit || (dropping && !afterTurn && drop_exposure > 0)`. A look that drops by light therefore opens `exposure` without turning by it. A bundle that cut `exposure` for that look would drop its leaves in another order and paint a different tree, without saying so.

A cut is made four ways:

1. **`FEAT_` constants** (declared verbatim per module) are substituted. They turn the grove's arithmetic, the fill and carpet factories (`makeFill`, `makeLitter`) and the `ballisticK` calls into dead branches, whose text is then removed.
2. **The tier's uniform group** leaves every kept camera.
3. **GLSL lines tagged `// @feature <name>`** are dropped, each leaving the old expression as the whole body. `features.test.js` holds that any subset leaves every literal as balanced as it was, and that no assembled program names a cut group's uniform.
4. **The orphan sweep** deletes what the first three left unreferenced.

`--features a,b|all|none` overrides the derived set.

**The key-compaction gotcha.** The grove compacts dropped leaves out of both buffers by counting the leaves that went (`alive[i] = 0`). It used to ask `litter?.length`, which with the carpet cut and the drop kept would compact nothing, and the bake would carry thousands of zero-τ quads. The litter push is now its own guarded statement.

**The test that fails if a predicate is wrong** builds a grove with exactly the tiers a look does not open cut out. It requires every uploaded layer and faithful buffer to equal the whole grove's. Its reference holds the exposure gate open, so the test does not trust `ordered`. Either of these mutations turns it red:

- dropping the drop clause from `ordered`;
- reverting compaction to `litter?.length`.

**What else the build does.**

- It strips the comments from the shader literals. A template literal is opaque to a minifier, so the design notes were shipping to every visitor.
- It folds the editor tier off by substituting the `EDITOR` flag. A `--define KOMOREBI_EDITOR=false` never folded on its own: neither bun nor esbuild inlines `const EDITOR = <ternary>` into its use sites.
- It deliberately does **not** cut the faithful tier, the glow tier or the woody occluder. They are interleaved code rather than table data, so cutting them would mean editing the engine instead of reading it. They stay, gated off at runtime, and a later look that opens one still works.
- `leaf_variety` is a cost no cut sees. Its pass is interleaved in the grove's build and reaches `exposureGrid`, `exposureRank` and `treeGenotype`. A `FEATURES` tier opened by an outline together with `leaf_variety > 0` would be the way to cut it. None is built.

**The warning at the doors.** The build rewrites the engine's `BUILD` constant to the bundle's file name, its looks and the tiers it cut. At the three doors params come through (`create`, `setParams`, `transitionTo`), `cutWarnings` returns one message per cut tier the params open, and the engine `console.warn`s each once per engine, naming the `nix run .#embed` command that would build a bundle with the look. The raw modules cut nothing and pay nothing.

**What carries what.** The general player carries every fall tier, because `montebello` ships and opens all six. The lasting value is the per-page embed: `.github/workflows/pages.yml` builds the homepage's three-look bundle and publishes it beside the player. The proofs are in pixels:

- the player bundle renders every shipped look unchanged and keeps every tier;
- the homepage embed drops all six tiers and renders unchanged;
- combination builds (`--features <set>` over `memories`, `park 1` and `afternoon 7`, run with `--over` params that open the tier) pass for every set the registry derives;
- the two builds that must fail in pixels do: the drop's exposure rank cut under a look that needs it, and the fill cut under `canopy_fill` 1, which also prints the warning.

**Sizes** belong to evidence: what each tier costs, what the sweep and the pruning saved, and the bundles over time are in [`evidence/measurements.md`](evidence/measurements.md). `nix run .#build` prints the current size, and that size grows with every look added.

## Related

- [`../CLAUDE.md`](../CLAUDE.md): the repository map, authoritative for what each file owns.
- [`model/overview.md`](model/overview.md): the causal spine this crosswalk indexes.
- [`contracts/preservation.md`](contracts/preservation.md): what a gate's off state owes, which the equality rows and pins execute.
- [`contracts/determinism.md`](contracts/determinism.md): frame stability and identity by address, which the determinism suite measures.
- [`contracts/conservation.md`](contracts/conservation.md): the books the bookkeeping rows hold.
- [`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md): the quality-rung and extension contracts a new gate or camera owes.
- [`contracts/transitions.md`](contracts/transitions.md): the route gates the route drivers check.
- [`contracts/looks.md`](contracts/looks.md): each shipped look's intent, and the feature registry's role in what a bundle may cut.
- [`evidence/measurements.md`](evidence/measurements.md): costs, sizes, tolerances measured and the numbers behind the representation choices.
- [`glossary.md`](glossary.md): the words.
