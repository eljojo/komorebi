# Komorebi — A Living Specification

*Sunlight filtering through the leaves of trees, and the shapes it casts on the ground.*

---

## 0. What this document is

This is a vision-and-specification document for an HTML5 / WebGL visualization of **komorebi** (木漏れ日, literally "sunlight that leaks through the trees"). It is meant to be a **living spec**: a single source of truth that another implementer — human or AI — can build from, return to, and revise as the work develops.

It holds three things, deliberately kept distinct:

1. **The vision and lived experience** that started this — the north star. When a later implementation decision is ambiguous, this is the arbiter. The point is not to reproduce a reference image; it is to recreate something that was *felt*.
2. **The physics** of the phenomenon, worked out from first principles.
3. **The computational model** — how to render it faithfully, and *why* it is built this way.

The governing intent, stated once so it colors everything below: **model the reality, not the artifacts.** The look should *emerge* from correct physics rather than being painted on. Where we approximate, we say so explicitly and we say why it is safe.

---

## 1. The lived experience (the north star)

This began with an afternoon under the trees in a park, in **early spring** — the leaves not yet fully grown, the canopy still sparse.

On the ground were the familiar dapples of light. But looked at closely, they were not crisp. They were **soft, out of focus** — like looking through an old prime lens, the kind with character. And the focus was not fixed: thick and thin clouds were drifting across the sun, and as they passed, the whole pattern **breathed in and out of focus**, blooming soft and then sharpening again. The bokeh on the ground was the thing — that very out-of-focus, glowing, low-contrast quality.

Then the wind, and two motions remembered vividly:

- **A strong directional breeze** that pushed all the leaves to one side, so the gaps on the ground **translated almost perfectly** — sliding sideways while keeping their shapes. You could *feel the breathing of the wind*, an easing-in rather than a switch flipping. And because branches can only move so far, at the peak of a gust you could feel the **elasticity of the branches fighting the wind** — and then, when the wind died, they returned to their original starting point. There is also a **backlash at that stiffening**: bent hard against their limit, the branches recoil — they snap back past rest and settle, not glide home.

- **A very faint wind, in all directions at once**, the kind that seems to come up when the sun shines a little stronger. This did not translate anything. It made the leaves **rearrange**, opening entirely new gaps. Because it was early spring and the foliage was sparse, *individual leaves still mattered* — moving one of them genuinely changed a gap — so the pattern reorganized into something wholly new. It looked, unmistakably, like **water caustics moving across the floor of a pool as waves collapse**: bright shapes merging, splitting, and dissolving rather than sliding.

And under the very faintest breeze, the shapes seemed to **glisten** — a fine twinkling in place.

Everything that follows is in service of that afternoon.

---

## 2. Guiding philosophy

Four commitments, in priority order:

1. **Model reality, not the artifacts.** Reproduce the *causes* and let the appearance fall out. The sun-images, the soft penumbrae, the translation, the reorganizing, the twinkle should all be *consequences* of a correct model, never special-cased effects.

2. **Never fake the structure, never fake the optics law.** Leaves are really where they are. Light really attenuates through them (Beer's law). The light source really integrates over its finite angular size. These are inviolate.

3. **There is exactly one sanctioned approximation: depth discretization.** We collapse the continuous depth of the canopy into a small number of layers (3–5). This is the *only* place we cheat, and it is the right place: it is where performance genuinely bites, and simultaneously where the eye is most forgiving. The eye needs "some dapples crisp, some soft"; it cannot count the layers. *(One smaller, optional optical approximation later joins it — the leaf-edge **diffraction** of §3.6, which rides this same transport shift rather than integrating a true diffraction kernel. It is off by default, so depth discretization stays the one cheat every frame pays.)*

4. **Only model what reaches the floor.** We never *see* the tree — only the light it throws on the ground, viewed from below. So the canopy must be faithful only in the ways that affect the cast pattern: where leaves are, their height, size, orientation, and how they move together. Anything about how the tree looks from the side that does not change the floor pattern, we decline to simulate. This is not faking; it is refusing to model the irrelevant, and it is what keeps the whole thing light.

---

## 3. The optics

### 3.1 The master fact: the sun is not a point

The sun has an angular diameter of roughly **half a degree** — about **1/100 of a radian**. Every soft thing in komorebi descends from this single fact. A point source would give razor-sharp shadows; an extended source cannot.

### 3.2 The dapples are images of the sun

The most important and least obvious truth: **most of the bright shapes on the ground are not the shapes of the gaps between the leaves. They are images of the sun.**

Each small gap in the canopy acts as a **pinhole camera**. If a gap is small enough relative to its height above the ground, it stops projecting *its own shape* and instead projects a picture of the light source behind it — and that source is the sun's disk. So the soft roundish dapples are little suns, hundreds of them, overlapping.

The proof is the partial solar eclipse: when the sun becomes a crescent, **every dapple on the ground becomes a crescent too.** The shapes track the source, not the holes.

This gives **two regimes**, governed by gap size `a` versus the blur scale `h·θ` (height × the sun's angular size):

- **Pinhole regime** (`a ≪ h·θ`): the gap's own shape washes out; you see a clean **image of the sun**.
- **Shadow regime** (`a ≫ h·θ`): you see a bright patch shaped like **the gap**, bordered by a fuzzy penumbra of width `~h·θ`.

For a canopy at ~10 m, `h·θ ≈ 10 cm` — which is why typical dapples are fist- to plate-sized and inescapably soft.

### 3.3 Blurriness is the *source*, not focus

The clean way to see this — and it maps directly onto the renderer — is a **convolution**:

> ground illuminance = (sharp gap map) ⊛ (the source's angular brightness profile, scaled to the ground by height)

The blur kernel *is* the source. Both regimes above fall out of this one operation automatically.

A critical consequence for implementers: **there is no focal plane here, and no plane of best focus. A pinhole has no focus.** The "out of focus" quality is *not* a focal-distance effect. Sharpness is set entirely by how large the source looks and how large the gap is. Do not model a focal plane.

### 3.4 Clouds turn the blur knob

On a clear day the source is the sun's bare ~0.5° disk: a crisp kernel, dapples as sharp as the canopy allows. When **thin cloud** drifts across, its droplets scatter the sunlight and smear the source into a bright **aureole** many degrees wide. The kernel fattens; every dapple bloats and softens. **Thick cloud** takes this to the limit — the source grows to fill the sky, the kernel becomes enormous, and the pattern dissolves into flat shade.

So the focus *breathing in and out* under drifting cloud is the **size of the light source changing over time** — nothing more. This is the single most expressive parameter in the whole piece.

Two felt qualities come *for free* from the same mechanism, which is why it read as an old prime lens:

- **Contrast sag.** As the source widens, each dapple's light spreads over a larger spot (peak dims) while the dark gaps fill with scattered light (shadows lift). Sharpness and contrast drop *together* — exactly the veiled, glowing look of old uncoated glass.
- **A bokeh duality worth keeping in mind.** In a camera, an out-of-focus point of light renders the shape of the *aperture* (why bokeh balls take the iris shape). In komorebi it is the inverse: a small gap renders the shape of the *source*. Camera bokeh shows you the hole; komorebi shows you the sun. Cloud, by inflating the source, pushes komorebi harder into that "you are seeing the source" regime.

### 3.5 Two realism details

- **The dapples are elliptical, not circular**, because the ground is tilted relative to the sun. The lower the sun, the more they stretch — elongated along the sun's direction, sheared toward its azimuth.
- **The "dark" areas are not black; they are a dim green.** That light passed *through* thin leaves, and chlorophyll transmits green while absorbing red and blue. The real scene is bright white-gold suns floating on a soft green-grey wash — never white-on-black.
- **The sunlight itself reddens as the sun lowers — and the shade goes blue.** At low elevation the beam crosses far more atmosphere (air mass by Kasten–Young, *not* `1/sin` — that diverges at the horizon); Rayleigh scattering (∝ λ⁻⁴) strips its blue/green, so the disk warms white → gold → orange → red. Meanwhile the ozone **Chappuis band** absorbs red from the *scattered* light, so the skylight that fills the shadows stays **blue** (the "blue hour") — which is why a low sun reads as *warm light on cool shade*. Both are modelled from `sun_elevation` by a cheap 3-band (R/G/B) Beer's-law atmosphere (`uSunColor` = the beam, `uAmbient` = the sky), with a `sky_turbidity` haze knob; the green wash above is the *transmitted* beam, the blue is the *skylight* — distinct mechanisms that compose. Computed in linear HDR, upstream of exposure and tone-map.
- **At dusk the eye itself cools the shade — the Purkinje shift.** As the light fails the retina's rods take over from the cones (mesopic vision): rods are colour-blind and peak in the blue-green (~505 nm), so the dim areas **desaturate toward a blue-grey** and **saturated reds darken first**, while anything still bright (the dapples) stays in cone vision, warm and coloured. It is a fact of *perception*, not of the light — but it is real and modelable, so it earns its place over a hand-grade. komorebi has no absolute luminance, so it is driven by two *honest* cues: a global "duskness" ramped from `sun_elevation` (a low sun is dim) **times** the *local* shade darkness (`acc`, the exposure-independent transmittance). Only the deep shade between the suns goes cool; the suns themselves are untouched. A `mesopic_strength` knob sets how far, and it hard-gates off for a daytime sun — the perception-honest route to the journal's "twilight is cool and soft," modelled rather than painted.

### 3.6 The colours split at the edges — leaf-edge diffraction

A later observation, brought in from looking at glass: through some lenses the bright and dark edges fringe, the red and blue of a highlight **splitting apart**. That split has an honest home here. The dapples are pinhole images formed at the gaps between leaves, and at every **leaf edge** the light **diffracts** — bends around the obstruction by an angle that grows with wavelength, **θ ∝ λ**. Red, the longest visible wavelength, spreads the most; blue the least. So the red image of the sun is thrown a touch *wider* than the blue one, and the two no longer land exactly on top of each other.

The consequence on the ground: **every dapple gains a warm outer rim and a cool core**, and the soft penumbra between a sun-image and the shade breaks into a faint spectrum. This is the felt "split" — but it is a *consequence of a real cause* (diffraction at the canopy's countless edges), never a prism painted over the picture. The leaves really do this; we are only making it visible.

It composes with everything already here, for free. The split is a per-wavelength change in the **angular** offset of the source, so it rides the very same **height × angle** shift that carries light to the ground (§4.6): higher foliage fringes more (its images are thrown further, so the wavelengths separate further), and a low sun — whose ellipse already stretches the dapples — stretches the fringe along with them. The three wavelengths are the same R/G/B bands (620 / 555 / 470 nm) the atmosphere model uses (§3.5), so the spread ratio is physically grounded rather than invented.

**The one honesty.** True diffraction would integrate a wavelength-dependent kernel at each gap, sized by the gap. We instead **scale the geometric pinhole shift per channel** by `λ/λ_green` — a cheap proxy that couples the dispersion to the *geometric* throw rather than to the gap width. It is a **second, smaller sanctioned approximation** alongside the depth discretization of §2, and it earns its place the same way: a real mechanism, off by default (strength 0 collapses the three channels back to one shared tap, byte-identical), and an expressive knob honestly *exaggerated* above the true ~λ-proportional value, the way the Purkinje shift of §3.5 is real-but-amplified. At realistic strength it is a hairline; pushed up, it is the **prism** look.

---

## 4. The computational model

### 4.1 It is all one thing: soft shadows from an area light

Everything above — pinhole sun-images, penumbra softness, the breathing cloud focus — is a single well-understood problem in costume: **soft shadows cast by an area light**, where the area light is exactly the source profile of §3.4 (sun disk plus variable cloud halo). A point light gives hard shadows; an area light gives penumbrae; a larger, softer light gives softer shadows. The cloud widening the source *is* the light growing.

### 4.2 The method: accumulate many small lights ("many suns")

The faithful, and barely harder, way to compute the convolution is to **sample the source and accumulate**, rather than blurring a finished picture:

> Scatter N weighted point-suns across the source. Each casts a perfectly **sharp** shadow. A sun offset by a small angle simply **shifts** each occluder by (its height × that angle). **Sum the N shifted sharp shadows**, and the sum *is* the soft shadow — the convolution, computed by sampling the light.

This was also a direct observation in the park: the big soft light is *literally an accumulation of many smaller ones*. The method matches the perception.

The payoff is the whole game: because the shift scales with height, **occluders at different depths blur by different amounts, for free.** And the cloud knob becomes literal — cloud thickness is just how widely the samples spread.

**Alternatives considered (and why not):**

- *Single global blur* — render one flat gap-map, blur once. Produces sun-images and penumbrae, but gives **every** dapple the same softness; it cannot vary blur with depth, so it reads as "a photo with a Gaussian blur," not light through a tree. **Rejected.**
- *Accumulation / many-suns* — **chosen.** Faithful, gives depth-varying softness, wires cloud straight into the light.
- *Per-pixel ray sampling from the ground up* — the same computation, more general but noisier. Not the starting point.

### 4.3 The architecture: four separable subsystems

The whole renderer is four parts, kept independent so that *reality* and *art* can be tuned without fighting:

| Subsystem | Role | Moves? |
|---|---|---|
| **Source** | the area light — a cloud of weighted point-suns | no (changes only with cloud) |
| **Canopy** | geometry only — fields of leaf occluders | **yes — the only thing that moves** |
| **Transport** | the shift-multiply-sum that carries light to the ground | no (pure physics) |
| **Look** | projection, color, exposure, tone-mapping | no |

### 4.4 The Source

The source is **not "a light." It is a cloud of weighted point-suns** — a list of `(angular offset, weight)` pairs.

- **Sampling pattern: a Vogel / sunflower (Fibonacci-angle) spiral.** Even, deterministic disk coverage with no clumping and no banding. ~**16–48 samples** holds 60 fps in a fragment shader.
- **The samples must be frame-stable.** If they jitter every frame they produce a numerical shimmer — and we must **not** let sampling noise impersonate the physical glisten. *All* visible motion comes from the canopy; none from the math.
- **Two populations**, matching the physics: a tight, heavy **core** (the ~0.5° sun, most of the energy) and a sparse, wide, low-weight **halo** (the cloud aureole).
- **The cloud knob** shifts weight from core to halo and spreads the halo points wider. Peak dims, total light conserved, contrast sags — the breathing of §3.4.
- **Keep the source purely angular and circular.** The elliptical ground stretch does **not** belong here; it lives in transport.

### 4.5 The Canopy

**The branch hierarchy is the truth.** It is a real 3D moving structure where the leaves live and where motion happens. The layered textures we render are merely a *per-frame snapshot* of that truth, in a form the light step can read fast. You do not choose between "a real tree" and "layers" — you have a real moving structure, and each frame you bake its current state into layers.

**A leaf, as data**, is tiny: which layer it is in, a **rest position** in the canopy plane (plan view, looking straight down), a size, an orientation, an **RGB transmittance**, and (for motion) spring state. The canopy never knows where the sun is — that keeps the separation honest.

**Gaps and clumps are emergent, never authored.** This is the correction that motion forces: because gaps *change when leaves move*, gaps cannot be the thing you draw — they are leftovers, the negative space between leaves. So:

- Grow a **light branch skeleton** (two or three levels: a few limbs → twigs → leaf clusters) and hang leaves on it.
- **Clumping is just the topology** — leaves cluster on twigs, twigs on branches, automatically.
- **Multi-scale gaps come from the skeleton's self-similarity** — big gaps between branches (shape-patches) and tiny gaps between leaves (sun-images), for free.
- The **gap-size distribution is a tuning target**, not a thing you generate directly.

**Now realized — a grown grove.** This is no longer a stand-in. The canopy is generated by growing several small recursive trees — a *grove* — each a trunk → a few limbs → `branch_children` sub-branches recursing `branch_levels` deep → terminal twigs that carry the leaf clusters. The trees' **crowns overlap to fill the frame**: one tree grown from a single central trunk leaves a bare-bright hole over its trunk (all foliage hangs outboard in a ring), so a grove is used instead — which also matches the park, several trees, the smaller ones reading denser (the same cluster packed into a smaller crown). Leaves **bin to depth layers by the height they grew to**, so higher foliage blurs more for free, and **multi-scale gaps fall out of the branching self-similarity** as intended. The fill radius is tied to `view_extent` so the grove fills the frame at any zoom. Knobs: `tree_count`, `limb_count` (arms per tree), `branch_levels`, `branch_children`, `branch_angle`, `branch_length_ratio`, `branch_pitch`. `tree_count` is treated as a **continuous** quantity — a fractional value renders `floor` full trees plus a marginal tree faded in by the remainder, and trees are appended at the end of the growth RNG stream so a fractional count only adds/removes the *last* tree — so a tree-count change can **morph** (the grove grows a tree in, the rest re-spacing to make room) rather than pop (§9), while integer counts render exactly as before. *(The earlier clustered-point scatter is retired; `clusters_per_layer` survives only as a legacy preset key.)*

**The bake — "becomes a texture":**

- Once per frame, rasterize current leaf positions into **3–5 depth-binned layers**.
- **Stamp optical depth, not transmittance.** Transmittances *multiply* (light must clear every leaf), which forces sorting of overlaps. Optical depth (`−log transmittance`) *adds*, so leaves accumulate with plain **additive blending — order-independent, no sorting.** Overlaps darken correctly on their own. Transport reads transmittance back as `exp(−depth)`.
- Because depth is **per-channel** (high red/blue, low green for a leaf), two overlapping leaves land twice as deep — darker *and* greener. **The green shadow wash falls straight out of Beer's law** instead of being painted on.
- **Soft edges come for free and honestly**: a leaf edge crossing a texel only partly covers it, so that texel gets a fraction of the depth. Area-averaging at finite resolution.
- **Orientation-driven footprint (bake this in from the start).** A leaf face-on blocks its full area; edge-on it blocks almost nothing. So its stamp is its true shape **foreshortened by tilt**. When a leaf flutters, its footprint shrinks and swells, winking small gaps open and shut — **a real chunk of the glisten lives right here in the stamp, not in transport.** Treat a leaf as shape-plus-orientation projecting to a footprint, never a fixed blob.

**Texture constraints:** it must resolve the **smallest gaps** (they throw the sharpest sun-images); it must **extend past the visible ground by the largest layer shift** (so dapples don't run out of canopy at the frame edge); and it should **tile** if wind is to scroll it indefinitely.

### 4.6 Transport

One equation:

> **A ground point's color = Σ over source samples of [ sample weight × Π over layers of transmittance(read at a shifted position) ].**

- The **shift for layer L = its height × the sample's angular offset.** High layers shift more, so high foliage blurs more — depth-dependent bokeh, automatically.
- **Multiplying transmittance across layers** is the physically correct "light must clear every layer."
- **The ellipse lives here.** Convert each angular sample-offset into a *ground-plane* offset through a small **2×2 matrix built from the sun's elevation and azimuth**. That matrix stretches the circular source-disk into the ground ellipse and shears the pattern toward the sun. The source stays a clean circle; transport owns the projection; the two never tangle.
- **Leaf-edge diffraction splits the channels (optional, §3.6).** With it on, each colour channel reads the layer at its own wavelength-scaled shift — red wider, blue narrower — so the dapple edges fringe warm-out / cool-in. With it off the three reads collapse to one shared tap, so every existing look is byte-identical and pays nothing.
- **Accumulate in linear HDR; tone-map at the very end.** The contrast/exposure knob lives downstream of the physics, so the look can be tuned without touching the light.

### 4.7 Look

Elliptical projection (from transport), the green wash (from the canopy), the **physical sun & sky colour** (`uSunColor`/`uAmbient` from the §3.5 atmosphere, driven by `sun_elevation` + `sky_turbidity`), the **ground albedo** the floor reflects with (`ground_rgb` — the irradiance that lands is reflected off a surface reflectance rather than an implicit white one; `(1,1,1)`, the default, is the plain white floor, and a few looks set a warm Mount-Royal dirt so their deep shade reads as dark earth while only the hottest dapples burn back toward white), a **tilted perspective camera** (`view_pitch_deg` / `view_fov_deg` — a pinhole that casts each pixel onto the floor; at pitch 0 it reduces exactly to the original orthographic top-down map, and tilting drops the near floor to the bottom of frame, recedes the far floor, and dissolves it into atmospheric haze; `view_extent_m` stays the zoom = the on-axis ground span. Camera height is omitted — for a flat floor it only rescales the view, which the zoom hold cancels, so it has no independent effect. A **far-field smear** (`far_smear`) then widens the soft-shadow throw by each pixel's ground footprint, which balloons toward the horizon — det(∂world/∂vUv) = `view_extent²·cos⁴pitch·aspect / D³` with `D = −ray.z`, so the footprint's linear size goes as `1/D^1.5`; realised by adding an `extraThrow` to every layer's height *inside* the existing `uProj` shift, so far dapples melt into soft **down-sun** streaks and the far-field aliasing/shimmer is averaged out while the near floor stays crisp. Referenced to the nearest visible row (`D_ref = cos pitch + tan(fov/2)·sin pitch`) it is *exactly* 0 at pitch 0 — a uniform footprint has no near/far gradient — so top-down presets stay byte-identical and the smear is purely a tilted-gaze phenomenon that strengthens with tilt), exposure and contrast tied to source width, and a final tone-map — all **downstream** of the physics, accumulated in linear HDR.

---

## 5. Motion

**One wind field, two bands, feeding one spring hierarchy.** Every node in the branch hierarchy is a little transform with a **rest pose** and a **damped spring** pulling it back; children inherit their parent's motion. The wind is an offset *force*, never a thing that drifts the rest pose.

The two motions remembered in the park are not two strengths of one thing — they are **two different mechanisms** living at two ends of the hierarchy.

### 5.1 The coherent band (top of the hierarchy)

A **slow, smooth, directional** wind that loads the big nodes — trunk, major limbs. Because everything hangs off them, the whole canopy shifts together and **the pattern translates nearly intact.**

Three specifics, each a required piece of the model:

- **Breathing / easing.** The wind signal is low-frequency with **attack and decay** — gusts ease in and out, never a square edge.
- **Nonlinear stiffening.** A real branch resists harder the more it bends, so past a point the motion **clips against a ceiling.** This stiffening is what is *felt* as the branch fighting the wind at the peak of a gust.
- **Backlash at the stiffening.** A branch bent hard against its ceiling has stored a lot of elastic energy. When it wins or the gust eases, it does **not** glide home — it **recoils past rest and oscillates back down.** The snap-back is **underdamped**, and the overshoot grows with how hard the branch was pushed into the ceiling. So this band is not *load → relax*; it is **load → clip against stiffening → whip-back → settle.**
- **Exact relaxation.** It returns to a **stored, honest equilibrium** — the original starting point.

**Realizing it (first concrete model).** Before a full branch hierarchy exists, the whole-tree node is collapsed into a **single 1-D spring** along the wind direction, and its displacement is applied as a **near-uniform translation of the canopy plane at bake time** — every leaf shifts by the same vector, so the dapple field slides bodily, which is exactly "translates nearly intact." A `height_gain` optionally lets higher layers ride longer levers and sway a touch more; at zero it is pure translation. The spring is the four specifics above, made literal:

- The wind is a **force**, not a target; the spring's rest is **0**, so relaxation is exact for free.
- **Stiffening** is a restoring force that *diverges at a ceiling* — `restoring ∝ u/(1−u²)` with `u` the sway as a fraction of the ceiling — so no finite gust can push past it, and the resistance climbs as it nears the limit (the "fighting").
- **Backlash** is the same underdamped spring with **asymmetric damping**: damping is cut on the *return* stroke (when velocity opposes displacement), so a branch released from near the ceiling whips back *past* rest and rings down, and the overshoot grows with how hard it was loaded — no separate mechanism.
- **Breathing** is an **asymmetric one-pole envelope** (independent attack and decay constants) on a smooth low-frequency gust signal, so gusts ease in and out rather than switching.

This is deliberately the *reduced* form of the §5 hierarchy (one node, not a tree); it is faithful to the felt behavior and is the seam the real spring graph will later plug into.

**Correction from feel-testing: translation alone is not wind.** A single rigid translation — every leaf shifted by the identical vector — does *not* read as wind, even with correct breathing and backlash. Two things were missing, and both are already in the spec elsewhere; the coherent band must carry them:

- **Leaves change angle as the wind blows.** The wind rocks each leaf, and by §4.5 a tilting leaf's footprint **foreshortens** — so the dapple *changes shape*, not just position, and returns to rest when the gust passes. Without this every blob keeps its exact silhouette and merely slides, which is the tell that betrays it as a translation. The rock has a quasi-static part (the leaf *flags* with the wind, ∝ the signed sway) and a fluttering part whose amplitude grows with wind strength (∝ |sway|), decorrelated in phase per leaf. At zero wind it vanishes, so the rest image is untouched.
- **The sway is not uniform.** Wind "is never only in one axis": clumps (twigs) must flex by **different amounts and in slightly different directions**, so the field shears and gaps morph rather than the whole sheet marching in lockstep. This is precisely the §5.4 *medium band* ("mid-branches & twigs flex differently → gaps morph and rearrange, then recover"), reached here as a per-clump variation on the single coherent sway rather than as its own hierarchy level — leaves are rigid within a clump, clumps differ from one another.

The lesson generalizes: **motion that only moves leaf *positions* will always look like a slide.** A real chunk of "wind" lives in leaf *orientation* driving the footprint (§4.5), and in *decorrelation* between neighbors (§5.2/§5.4). Position is the least of it.

**Now realized: a hierarchy of ROTATIONS, not translations.** The crucial correction. A first hierarchy attempt drove each limb and twig as a 2-D *translation* spring — clumps slid around the plan plane, each toward its own offset. It looked **wrong in an uncanny, almost hallucinatory way**: patches of dapples swimming in different directions with no rigid body behind them, so the eye cannot resolve it as a structure. The reason is physical — **a branch does not translate; it pivots.** A branch is anchored at a joint, has a length and an angle, and the wind *rotates* it about that joint; everything hanging off sweeps an arc and the whole sub-structure turns as one rigid piece. Rotation is the thing the eye reads as "branch." So the band is rebuilt as articulated rotation:

- **Trunk** — the single coherent spring of §5.1 (gust → stiffening → backlash); its sway still **translates** the whole field (the bulk drift). Unchanged.
- **Limbs** — a handful of arms **radiating from the trunk at the canopy centre**, each carrying a **scalar bend angle** on a soft/slow spring and pivoting **about the trunk** — the one joint where every limb meets it. A clump attaches to the limb whose direction points **toward** it, so it hangs off that limb's **far end**: every clump sits outward from the trunk pivot, all on one side, and a limb's bend swings its whole wedge of clumps as a rigid arc. Clumps sharing a limb swing together; neighbouring wedges bend by different amounts, so the field **shears at their seams** and gaps morph. The bend is the **wind's torque about the trunk** (below), plus a slow spatial drift so limbs differ.
- **Twigs** — every clump carries its own faster, stiffer bend angle, and swings about a **stem joint** — a base point offset from the clump *toward the trunk* (its limb's base; with a little per-twig angular spread so they don't lockstep). Bending the twig sweeps the whole clump to one side through an arc; leaves sweep arcs and the clump turns, decorrelated clump-to-clump.

A leaf inherits **twig-swing ∘ limb-swing ∘ trunk-translation**, and — critically — its **own orientation rotates with the branch** (`leaf angle += limb bend + twig bend`), which is what makes its footprint present differently as the branch turns. Because each clump is now a *rigid pivot* rather than a free-floating offset, the motion reads as branches in air instead of the earlier soup. The bend **breathes with the gust** and **rests at zero wind** (still image untouched).

**The stem joint is load-bearing — without it you get a vortex.** An earlier version pivoted each twig about its *own centroid*. Mathematically tidy, but it makes the two halves of a clump shear in opposite directions — a little **in-place spin**, i.e. a vortex — and a field of these reads as unphysical "swirling" the eye latches onto, with no agreement with the wind direction. The cure is to move the pivot **off the clump, onto a stem toward the parent**: now the whole clump (which is small next to the stem) swings the *same* way, a directional sweep, with only gentle rotation on top. Pivot location, not pivot amount, is what separates "branch in wind" from "vortex." (Set the stem length to zero and the swirl returns — the knob *is* the diagnosis.) Still **shallow** — the whole tree lives in the plan plane, not yet 3-D branches with real length and droop — but the kinematic principle (*wind changes branch angles about real joints; children inherit the rotation*) is now the spec's, and the stem was the change that pushed the **twigs** out of the uncanny valley.

**Then the trunk became real — and the vortex came back one level up.** With the stem joint curing the *twig* swirl, the same failure surfaced at the **limb** level, for the same reason: limbs were scattered plan anchors with clumps bound to the *nearest* one, so a limb's clumps **surrounded** its pivot — opposite sides swept opposite ways, each region spinning in place, a coarser vortex. (This is what reads as *whole planes swirling*.) The cure is the stem-joint principle lifted a level: give the tree a **trunk at the canopy centre**, grow the limbs as **arms** from it, and bind each clump to the limb whose direction points **toward** it — so every clump hangs off the far end, outward from the trunk, never straddling it. All limbs pivot about that **one** joint.

But a shared pivot springs a second trap: if every limb bends by the *same* angle about the same point, the whole canopy rotates rigidly — a field of little vortices traded for **one giant pinwheel**, still a swirl. So a limb's bend is not a uniform lean but the **wind's torque about the trunk**, `∝ cross(limb_dir, wind)`: limbs **broadside** to the wind swing hardest, limbs **end-on** barely move, and the two sides swing in **opposite senses** — every tip travels *downwind*, so the canopy **leans** rather than spins. The earlier "limbs lean downwind together" was the simplification that had to go; orientation-dependent torque is what lets a *shared* pivot read as a tree in wind. The twig `u`-bend now takes the same torque, for the same reason.

> Lesson, restated and stronger: not only does moving *positions* alone look like a slide (above) — moving positions *differently per region* looks like **soup**. The differential motion of a canopy is **rotational**: angles changing at joints, inherited down a tree. Translation is only the trunk's bulk drift; everything below it is rotation — and rotation about a **shared** joint must be driven by **torque** (an orientation-dependent bend), never a uniform angle, or it spins. The vortex is **scale-free**: it returns at every level where children straddle a pivot turned by a single angle, and it dies the same way each time — put the pivot on the parent (so children are one-sided) *and* drive the bend by torque (so a gust leans, not rotates).

**The joints are now real (a grown grove).** The kinematics above originally drove a *fake* skeleton (clustered points around the canopy centre). The canopy is now a grown grove (§4.5): each tree's limbs pivot about **its own** trunk, twigs about real grown stem joints, and the limb/twig torque is taken about that tree's trunk — so a gust leans every tree about its own base, not the frame centre. A leaf inherits its tree's limb-swing ∘ twig-swing ∘ the global trunk drift. The motion is still **2-D yaw** in the ground plane — branches turn about joints but do not yet *lean* in depth or foreshorten as they pitch. That 3-D step (lean + foreshorten, on the grown skeleton) is the next piece of work; the grown structure was its prerequisite, now in place.

**Now realized: the forcing is BROADBAND, with weather and crosswind.** The first model drove the spring with a single near-sinusoidal gust (one `gust_frequency` plus an attack/decay envelope). It read as *mechanical and one-directional* — and the reason is physical: real wind is **broadband**, its energy spread across every timescale at once (a minute-long surge carrying second-scale gusts carrying sub-second flutter), falling off with a characteristic **Kolmogorov −5/3 power spectrum** in the gust range. A single frequency puts all its energy at one period, so the eye locks onto it and reads a machine. The cure is to drive the spring with a **fractal sum of octaves over time** — frame-stable noise-of-time, so still no sampling RNG (§4.4): the per-octave amplitude gain `G = 2^(−H)` sets the spectral slope, with `H = 1/3` the physically-correct wind value (between "pink" `H=0`, choppy/nervous, and "brown" `H=0.5`, smooth/sluggish). `H` *is* the **character** of the wind.

Three controls fall out, each a real meteorological quantity:

- **strength** — the mean force ("how much").
- **gustiness** = **turbulence intensity** `σ/U` (≈0.1 calm … 0.2 open country … higher under a canopy) — "how alive." It scales the fluctuation against the mean; at high gustiness the deep lulls drop the force below the mean lean, so the spring recoils **back through rest** — the felt "comes back," now arising from the forcing itself, not only the backlash.
- **gust rate** = the lowest-octave frequency ("how frequent"); faster octaves and flutter layer on top automatically. *(This is the old `gust_frequency`, reinterpreted as the base rate of the broadband signal.)*

And the motion is no longer 1-D. A **lateral (crosswind) channel** — a second, decorrelated broadband stream on its own spring, perpendicular to the wind — runs alongside the longitudinal one (turbulence has no preferred sign across-wind, so it is genuinely bidirectional). The two compose into a 2-D sway, so the bulk drift **wanders** rather than tracking a dead-straight downwind line. *(This is the trunk-level seat of the §5.4 medium-band decorrelation; the limb/twig hierarchy adds the rest.)*

**Wind "patterns" — a few broadband characters.** Rather than expose `H`, octave count, asymmetry and burstiness as raw knobs, they are bundled into a small named set — **steady · gusty · squally · choppy · lazy** — each a pre-tuned *character* that all read the **same** shared knobs (strength, gustiness, rate, direction, weather), shaped differently inside (spectral slope, detail depth, mean-lean fraction, crosswind fraction, and a waveshaper that spikes peaks and deepens lulls for clustered/intermittent gusts). The gust-edge **asymmetry** (rise sharper than decay, ~1.35×, validated in the field) survives as the existing attack/decay envelope, now slewing the broadband force. A pattern is selected by name (`wind_pattern`) — the same minimal surface the §9 looks reference; it can later be promoted to a per-pattern generator function without changing that surface.

**Weather — the slowest band.** Above the gusts sits a **slow, self-evolving weather state**: low-frequency noise-of-time (again deterministic, so reproducible and frame-stable — a stochastic Ornstein–Uhlenbeck mean-reverting walk would do the same job but break the no-RNG rule) that drifts the **overall strength** (calm spells and gusty spells coming and going over minutes) and slowly **veers the direction**. `weather_variability` sets how much the day evolves on its own (0 = static, so existing looks are untouched) and `weather_speed` how fast. This is the difference between a calm afternoon and a gusty one — and it changes, unbidden, which way the wind leans.

The lesson, restated and stronger: **the first primitive was wrong, not just mis-tuned.** Wind is not a frequency with an amplitude; it is a *spectrum across timescales*, with a mean that itself drifts. Strength / gustiness / rate / pattern / weather are that spectrum made controllable — the broadband signal subsumes the single gust, and the deep lulls + crosswind retire the "leans downwind and never comes back" tell on their own.

### 5.2 The incoherent band (bottom of the hierarchy)

A **fast, spatially incoherent** forcing — "faint, in all directions" — that kicks **individual leaves and petioles** slightly differently, with almost no correlation between neighbors. That **decorrelation is the entire difference** from the coherent band: there, neighbors move together and shape is preserved; here, neighbors move independently, so gaps **reorganize** rather than translate.

Its visible effect scales from a faint **glisten** all the way up to full **caustic-like gap reorganization** — and what sets the scale is foliage density (§5.3).

**The caustics reference is physics, not just a vibe, and belongs in the model.** Pool caustics are bright features that move by **merging, splitting, and collapsing** rather than sliding. What reorganizes here is the same *visual grammar*: small gaps drifting in and out of the pinhole regime, neighboring sun-images overlapping and separating, brightness gathering and dispersing as apertures breathe. It is **not** literal optical focusing the way water is — but the felt behavior (smooth birth, merge, and collapse of bright shapes) is shared, and it tells an implementer what the second motion should *feel* like in a way no equation does.

**Driving it directly (a single continuous phase).** The band can be exercised without any wind by exposing one continuous **drift phase** φ. Each leaf is given a fixed rest position and a small, bounded **orbit** — amplitude, orientation, and starting phase all *decorrelated* between neighbors — and advancing φ walks every leaf around its own orbit. Because the orbits are bounded and share a rate, the canopy is **periodic in φ and returns exactly to its starting configuration each cycle** — this is the remembered "the gaps change, then go back to what they were." The neighbor-decorrelation is, again, the whole point: it makes gaps *reorganize* (merge, split, collapse) rather than translate. The one hard requirement is **continuity of the driver**: φ and φ+ε must differ only infinitesimally, so the eye reads a *morph*, not a cut. Any control that instead reshuffles a random *set* — most obviously changing an integer leaf **count** — steps discontinuously and reads as a jump-cut, which is exactly why density is the wrong knob for this. When the incoherent wind band (§5.4) is built, it simply *becomes* the driver of φ; exposing φ as a manual slider is the same mechanism with time replaced by a hand.

### 5.3 Density is a first-class knob

Whether independent leaf motion **restructures** the gaps or merely **twinkles** them is set by foliage density:

- **Low density** (the early-spring condition — sparse, immature leaves): individual leaves still matter; moving one opens or closes a real gap → the **caustic-like reorganization** is possible. *Low density is the enabling condition for the second motion, and the spec should say so plainly.*
- **High density** (summer canopy): every gap is backed by ten more leaves; the topology is saturated; the same flutter barely changes the cast pattern → flutter only **twinkles.**

Note that density is a *count*, and a count is a poor axis to *sweep*: nudging it regenerates a different random set, so the pattern jumps rather than morphs (see §5.2). Two non-physical harness measures make density pleasant to explore without changing the model: generate **each clump from its own stable seed** (so changing one knob never reshuffles unrelated clumps), and **fade the fractional marginal leaf in by coverage** (so crossing an integer count is continuous rather than a pop). These are about smoothing the *parameter space*, not the physics; the actual gap *reorganization* is the drift phase of §5.2, not density.

### 5.4 The unifying mapping

The three motions are the **same structure seen at three timescales**, mapped onto three levels of the hierarchy:

| Motion seen on the ground | Hierarchy level | Timescale |
|---|---|---|
| Wind **strengthens, calms, and veers** | (weather) modulates the whole coherent band | very slow (minutes) |
| Pattern **translates** intact | whole tree / major limbs sway together | slow |
| Gaps **morph and rearrange**, then recover | mid-branches & twigs flex differently from one another | medium |
| Pattern **glistens** | each leaf trembles on its own petiole | fast |

The bands **coexist and sum**, and the coherent band is itself **broadband** — not one slow rate but a fractal spread of them (§5.1), with a weather layer drifting its strength and direction on top. On the spring afternoon, a gentle directional breeze and a fine all-directions shimmer were both present, in shifting proportion, moment to moment. **That proportion, the wind's character (pattern + gustiness), and the foliage density are most of the expressive surface of the whole piece.**

---

## 6. Implementation target

- **Platform:** WebGL / HTML5, a full-screen quad with the heavy lifting in a fragment shader.
- **Canopy** lives as objects (CPU or compute), carrying rest pose and spring state, **re-baked to the depth-layer transmittance textures once per frame.**
- **Transport** is the shift-multiply-sum over **~16–48 source samples**, read in the fragment shader; target 60 fps.
- **The spring graph** lives in the canopy objects; the two wind bands drive it.
- **Render linear HDR, tone-map last.**
- **One shared engine, its looks, and its consumers.** The whole renderer is a standalone **ES module** — `komorebi.js`, `export { create, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG }` (plus the transition key-sets `MORPH_KEYS`/`CANOPY_KEYS`/`TOPO_KEYS`, exported only so a test can assert every knob is classified, §9) — where `create(canvas, { params })` returns a handle (`apply(scope)`, `setParams`, `transitionTo(params, {duration, onEnd})` for a cloud-bloom crossfade between looks (§9), `setPaused`, `dispose()` (stop the loop and free every GL object + the context — so a disposable second instance can be reclaimed), live `params`/`perf`/`motion`/`src`/`trans`, an `onFrame` hook). It runs its own rAF loop on whatever canvas it's handed and carries no UI. The **built-in looks are a separate module** — `presets.js`, `export const PRESETS`, each look merged over the engine's `DEFAULTS` — because the presets are *data*, not renderer (§9), and keeping the engine free of them lets it stay a pure renderer. Two pages import both directly: the **editor** (`index.html`, a thin shell that loads `editor.js` — the dev panel, HUD, insets, preset management, sun-drag, scene-stepping, and the §9 auto-profiler UI; its pure sub-concerns are split into siblings `presets-store.js` (★-look localStorage I/O) and `profiler.js` (the auto-profiler's cost taxonomy + variant algorithm), each unit-tested under `bun test`) and the reference **player** (`player.html` — a minimal viewer-only consumer: a full-bleed canvas cycling through presets, no UI). Because they use native ES-module `import`, both must be **served over http(s)**, not opened off the filesystem. The eljojo.net homepage embeds the player pattern too, but as a no-build classic-`<script>` site, so it loads a bundled `window.Komorebi` global instead (the `komorebi.global.js` deploy shim, §9). `create()` throws on missing WebGL2/float targets so a consumer can degrade to a static page. In the editor build only, the handle also carries a small `profiler` (GPU timer-query instrumentation + an offscreen stress burst) and a motion mirror, both used by the §9 auto-profiler and both dead-stripped from the player; the general `setPaused`/`dispose()` ship in both, so the profiler's A/B wipe can spin up a second engine per comparison and fully reclaim it on close. The engine ships as a pure renderer.

---

## 7. Open questions (this is a living spec)

These are deliberately unresolved and meant to be tuned during implementation:

- Skeleton depth — how few levels still give convincing multi-scale gaps.
- Source-sample count vs. performance, and the exact core/halo split and falloff of the source profile. *(Now measurable per-look with the §9 auto-profiler.)*
- The default foliage density, and how it is exposed as a control.
- The shape of the stiffening curve and the damping ratio that makes the backlash read right (visible overshoot without looking rubbery).
- Layer count and per-layer height assignment. *(Per-look cost now visible via the §9 auto-profiler's per-feature breakdown.)*
- How the two wind bands are authored — noise type, spatial correlation length, temporal spectra.
- The tone-mapping curve, and how exposure/contrast couple to source width.

---

## 8. Parameter reference

Grouped by subsystem; the knobs an implementer will actually expose.

**Source**
- `sample_count` (16–48)
- `core_angular_radius` (≈0.27°, sun half-angle)
- `core_weight_fraction`
- `halo_angular_radius` (cloud-driven)
- `halo_weight_fraction` (cloud-driven)
- `cloud_thickness` *(master breathing knob; redistributes core→halo and spreads the halo)*

**Canopy**
- `layer_count` (3–5)
- `layer_heights[]`
- `foliage_density` *(sets twinkle ↔ caustic-reorganization regime)*
- `leaf_size_distribution`, `leaf_aspect`
- `leaf_transmittance_rgb` (low green, high red/blue → green wash)
- grove / skeleton: `tree_count` (trees in the grove; >1 so crowns overlap and fill the centre; *continuous* — a fractional count fades a marginal tree in, so tree-count transitions morph, §9), `limb_count` (arms per tree), `branch_levels`, `branch_children`, `branch_angle`, `branch_length_ratio`, `branch_pitch` (limb rise → height spread), `cluster_spread` (leaf scatter on a twig), `leaves_per_cluster` (leaves per twig) *(`clusters_per_layer` is retired — kept only for preset compatibility)*
- texture: `resolution`, `world_extent` (≥ visible + max shift), `tiling`

**Transport**
- `sun_elevation`, `sun_azimuth` *(build the 2×2 ground-projection matrix; owns the ellipse + shear)*

**Wind — coherent band**
- `wind_pattern` *(the broadband **character**: steady·gusty·squally·choppy·lazy — a named bundle of spectral slope/octaves/lean/crosswind/burst that all read the shared knobs below, §5.1)*
- `direction`, `base_strength` *("how much")*
- `wind_gustiness` *(turbulence intensity σ/U — "how alive"; high → deep lulls drive the springback through rest, §5.1)*
- gust `frequency` *(now the **rate** = lowest-octave frequency of the broadband signal — "how frequent")*, `attack`, `decay` *(gust-edge asymmetry: rise sharper than decay, slewing the broadband force)*
- weather: `weather_variability` *(how much the day self-evolves — strength swells/lulls + slow direction veer; 0 = static, looks untouched)*, `weather_speed` *(how fast it drifts, minute-scale)*
- `stiffness`, `stiffening_curve` (nonlinear ceiling)
- `damping_ratio`, `backlash_gain` (underdamped snap-back / overshoot)
- hierarchy: `limb_count` (arms fanned from the trunk), `limb_flex`, `twig_flex` *(bend amplitudes — each is scaled by the wind **torque** about its pivot, so a uniform gust leans rather than spins)*, `stem_length` *(twig pivot offset toward the trunk; 0 = clump-scale swirl returns)*, `sway_height_gain` (higher layers ride longer levers)
- per-leaf: `leaf_swing` (footprint rocks → dapples change shape, §4.5), `flutter_freq`

**Wind — incoherent band**
- `strength`
- `spatial_correlation_length` (small → decorrelated per-leaf)
- `temporal_frequency` (flutter rate)
- `drift_phase` *(the continuous sweep axis of §5.2; periodic in 2π → exact return. Driven by hand now, by the wind band later)*
- `drift_amount` *(per-leaf orbit radius: 0 = static, small = twinkle, large = caustic-like reorganization)*

**Look**
- `exposure`, `contrast` (coupled to `cloud_thickness`)
- camera: `view_extent_m` (zoom = on-axis ground span), `view_pitch_deg` *(tilt from straight-down; 0 = the original top-down view, so it's opt-in per look)*, `view_fov_deg` *(lens / perspective strength)*, `far_smear` *(far-field dapple smear: extra throw per unit foreshortening, melting distant dapples into soft down-sun streaks; 0 at pitch 0 regardless)* — the far floor fades to atmospheric haze *(camera height is degenerate for a flat floor, so it isn't a control)*
- `ground_albedo_rgb` *(the floor's reflectance the dapples reflect off; `(1,1,1)` = white floor (the default), with a warm dirt-brown on the looks that opt in so their shade reads as earth and only the hottest dapples burn back toward white)*
- `tone_map_curve`
- `ambient_skylight` (scales the physical sky fill — ozone-blue by day, warming toward dusk)
- `sky_turbidity` *(atmospheric haze β; with `sun_elevation` drives the physical sun/sky colour — reddens the low sun, blue-shifts the shadow fill, desaturates a hazy dusk)*
- `mesopic_strength` *(Purkinje/rod dusk shift: cools & desaturates the deep shade as the sun lowers, reds darkening first; gated to low elevation, 0 = off — the dapples stay warm)*
- `chromatic_aberration` *(leaf-edge diffraction, §3.6: per-channel λ-proportional spread of the dapples → warm outer rim + cool core; 0 = off, presets byte-identical; the **prism** and **morning 3b** looks push it up)*

---

## 9. Harness notes (non-physical)

These belong to the authoring tool, not the model, but they shape how the model is *explored* and so are worth recording.

- **Presets.** The full parameter set is saveable to the browser's local storage by name, and any state can be exported/imported as JSON for sharing across machines. A set of looks ships built in — all grown groves, spanning mornings, afternoons (some with hazier / lower-sun variants) and a few set pieces, such as a single-tree *eclipse* whose gaps image a partially-eclipsed sun (§3.4 — every dapple a matching crescent), and a *prism* whose dapples fringe red-and-blue from leaf-edge diffraction (§3.6). **They live in their own module, `presets.js` (`export const PRESETS`), split out of `komorebi.js` so the engine carries no look data; each look is merged over the engine's `DEFAULTS`, and their definition order in that file *is* the dropdown / arrow-stepping order — there is no separate order list.** The editor boots into one of them (*afternoon 7*, auto-quality on); every other look is the user's own, saved (★) to local storage. The bare neutral config (`DEFAULTS`) is the merge base; it stays in the engine (exported, imported by `presets.js`) but is not itself a preset.
- **Stable per-clump seeding & fractional-leaf fade.** As in §5.3, so the parameter space is smooth to sweep.
- **Manual drift phase.** The §5.2 mechanism, exposed as a slider (`drift_phase`) with an `auto` option that advances it over time — a preview of the incoherent band before any real wind field exists.
- **Auto-quality (debug toggle).** A checkbox — **on** in the default scene (*afternoon 7*), though the underlying param defaults off — that watches frame rate and eases toward the highest quality that still holds ~60 fps. It spends the *cheapest* quality first — render resolution (nearly free for so soft a piece), then source-sample count — and leaves the physical and artistic params untouched. It chases a smooth 60 — dropping quality (debounced against lone spikes) whenever frames slip below it — and is deliberately **reluctant to climb back**: each forced downsize doubles the wait before it will probe upward again, so it ratchets to a stable level and parks there rather than hunting. Full quality is re-probed only on an explicit re-tune (toggling it, or loading a preset).
- **Preset auto-profiler (debug tool).** An editor-only profiling mode (a **profile** button in the Debug disclosure) that measures where a preset spends its frame budget and authors lighter variants from it. Because the loop is vsync-locked, naive fps reads flat on capable hardware, so per-pass cost is measured with **GPU timer queries** (`EXT_disjoint_timer_query_webgl2`) averaged over many **real on-screen frames** — the actual transport/bake passes under real conditions — at max quality with the auto-scaler held off. (An offscreen stress-burst was tried and abandoned: rendering a pass N× back-to-back measures idealised GPU *throughput* the driver can collapse, not a real frame, so it wildly over-reported spare capacity — it survives only as a coarse fallback where timer queries are absent.) The honest whole-frame number sits beside the per-pass split: the **live frame rate at full quality** — under 60 means the real frame is over budget, the very thing that makes auto-quality trim, which a synthetic "headroom ×" had obscured. The measurement is split **transport vs bake**, which is the point: `auto_quality` only trims the transport target (resolution, then samples), so the **bake pass is invisible to it** — yet on the windy looks that ship, bake is co-dominant, which is why a capable machine can sit at 60 fps and still run hot. The tool ablates each cost axis to show its share, classified by the cost audit: **safe** (sample count, texture resolution, layer count — low visual risk), **risky** (foliage density — changes the gap structure), **style** (leaf-edge diffraction — measured for its price, never auto-cut). The whole session runs at **max resolution with the auto-scaler held off**, so every figure is the cost of a *stylistic* decision at full quality (on a weak device the live canvas may already be downscaled, which would otherwise understate it); render resolution itself is deliberately **not** an axis — it is `auto_quality`'s runtime lever, not something the author sets, and the lite variants exist precisely to lower the *static* cost so that scaler has to engage **less**. It then proposes a few progressively-lighter variants — greedy over the *measured* per-axis cost, so an axis is judged on this look rather than a fixed order — and presents them as a **draggable wipe**: a second engine instance on its own stacked canvas, its wind **mirrored exactly** from the main look (`setMotionSource` copies the live motion + spring state each frame — sound because the variants never change the grove skeleton, so the spring arrays line up 1:1), so the gust *and* the flutter match across the seam and only the quality differs — and each engine's live fps is shown either side of the wipe, so on weak hardware you watch the lighter variant hold the refresh while the full look drops. That second engine is created per comparison and **disposed** on close, so the editor holds no second GL context when you're not comparing. The author picks one visually and saves it through the normal ★ preset flow (e.g. *afternoon 7 · lite*) — graceful degradation developed on a fast machine and human-verified, reaching the half of the frame the runtime governor can't. The engine gains only EDITOR-gated hooks (`eng.profiler` measurement + the motion mirror) plus the general `setPaused`/`dispose()`; the axis taxonomy + variant composition live in a pure, unit-tested module (`profiler.js`), the look persistence in `presets-store.js`, and the UI/orchestration in `editor.js` — the engine stays a pure renderer.
- **Dev panel hidden by default.** The whole authoring panel is hidden on load; press **D** to reveal it (**F** toggles browser fullscreen). The visualization stands alone until then. **On a touch screen there is no keyboard, so the panel is gesture-driven** — and, unlike the desktop, it does *not* auto-arrive after "feel": a phone opens straight into the full-bleed art with nothing sliding over it (a panel covering a third of a phone screen is the enemy of "feel it first"). A **double-tap** then toggles the panel in and out — the touch equivalent of **D**, persistent. And a **press-and-hold** *peeks* it away: while the finger is down the panel slides off-screen so you can glance at the dapples underneath, then slides back on release. The peek is a momentary hide that leaves the panel's shown/hidden state intact (it never sets `hidden`, only the slide transform), so it reads as "lift the panel to look, drop it back" rather than a dismiss; with the panel already hidden a hold does nothing, there being nothing in the way. The two gestures are deliberately split — **hold to look, double-tap to commit** — and both are guarded so a swipe (presets / time-of-day, above) still wins once the finger travels past the deadzone. Within each subsystem section the knobs are ordered **basic-first**: the handful actually authored per-look lead, and the set-and-forget mechanics (the cloud's halo/samples/eclipse, the canopy's fine leaf-geometry, the wind's spring response) fold into a collapsed *advanced* disclosure; the two least-touched sections (leaf drift, debug) collapse whole. The split was set from a survey of which knobs actually vary across the shipped presets.
- **HUD — signal over echo.** The corner HUD (shown only while the dev panel is open) deliberately carries *only what is live and computed and can't be read off a slider sitting in the panel beside it* — never an echo of a control. So it is two things. A **derived physics readout**: `blur h·θ`, the §3.2 softness scale (canopy height × the sun's angular size), the literal "how soft are the dapples" that no single slider shows. And a **live wind score**: one number that *breathes with the gusts* — the instantaneous broadband forcing, with the base strength and the slow weather spell already folded in — beside a character word read off **effective strength** (the one wind axis the presets actually vary; pattern and gustiness are fixed across every look, so a word off them would be a constant). Performance is treated as a **warning, not a gauge**: fps is hidden until it slips under 60 (shown below 55), and the auto-quality resolution scale shows only while it is compensating below full — so a nominal frame is a single quiet line and the HUD speaks up only when something diverges. The earlier HUD printed fps, tap counts, and echoes of the cloud/sun/wind sliders every frame; the rethink was purely raising signal-to-noise.
- **Per-knob tooltips.** Every control and section heading has a hover tooltip that leads with a plain "this does that" and then builds up to the why/physics — meant to help a newcomer form a mental model of what each knob represents and how it changes the cast pattern, not to be exhaustive.
- **Tree-grove preview (3D).** Press **T** for an inset that shows the *actual* grown grove the dapples come from — the branch skeleton (`hier.segments`) and a blob per leaf — count `leaves_per_cluster × foliage_density`, drawn as a light translucent haze (each leaf's opacity eased down as the count climbs) so the density reads as coverage; each tree's foliage takes a slightly different green so overlapping crowns stay legible, and the branch skeleton (tapered quads — thick trunk to thin twig) is drawn solid behind and again faintly over the haze so it ghosts through — in a slowly-turning 3/4 view, swaying with the live wind (a height-weighted downwind lean + the trunk drift), with a wind-direction arrow and ground grid. CPU-projected into a scissored corner, so it's free unless shown. It makes the otherwise-invisible structure (and the wind model) legible; the sway is an approximation of the bake's per-joint motion, not a re-derivation of it.
- **Scene transitions (VJ).** The **← / →** (and **↑ / ↓**) arrow keys step to the previous/next preset — through the same built-in + saved list the dropdown shows, wrapping at the ends — each a smooth transition rather than a cut. A transition retains as much as it honestly can, falling through **three tiers** keyed on *what actually differs* between the two looks:
  1. **Live morph.** The continuous look (sun, exposure, cloud, wind, colour grade, layer heights) **interpolates** from the current live params to the target with an ease-in-out; angles take the short way round. Read live or rebuilt cheaply, so it just tweens.
  2. **Grove morph.** When the two looks share the same **branching topology** — identical `seed`, `branch_levels`/`children`, `limb_count`, `layer_count` — the grove's RNG draws line up, so interpolating the continuous *canopy* knobs **deforms the very same grove** with **no bloom**: `branch_angle`/`length_ratio`/`pitch` fan the branches; leaf size/aspect/density and `trans_rgb` resize and recolour; `canopy_extent` rescales the baked world (it only needs a regrow + re-bake, not a texture realloc, so it morphs rather than dissolving). **`tree_count` morphs too**, treated as a *continuous* value — `floor(count)` full trees plus a marginal tree faded in by the fraction — so `afternoon 5→6` **grows the 6th tree in** (the others re-spacing and shrinking a touch to make room) instead of popping a new layout. Trees are appended at the *end* of the grove's RNG stream, so a fractional count only ever adds/removes the **last** tree; the existing ones keep their structure — which is why integer counts render byte-identically to before (no preset's look shifts). This is a true morph, not a dissolve; it costs a per-frame regrow, so it runs only while the **peak** grove (the busier, more-trees end) is under a leaf-count budget (`CANOPY_MORPH_MAX`) and otherwise falls back to tier 3. The **in-flight wind sway is preserved across the regrow** — the spring state's common *prefix* carries over, and a newly-grown tree starts at rest — so the breeze doesn't reset; this also fixes editor canopy-slider tweaks resetting the sway mid-gust. (One honest wrinkle: each frame re-bins twigs into depth layers by grown height, so a knob that shifts heights — `branch_pitch`/`angle` — can occasionally flip a single cluster between blur tiers mid-morph; negligible at the 2–3 layers these looks use, so the binning is left live rather than frozen.)
  3. **Cloud dissolve.** Only a genuine **branching change** — a different `branch_levels`/`children`, `limb_count`, `layer_count`, `seed`/`tex_resolution`, or a grove too big to morph live (a large `tree_count` jump like `5→16` blows the budget) — can't interpolate leaf-for-leaf. It is **swapped once at the transition's midpoint, hidden under a transient bloom**: the source is widened toward overcast (the §3.4 cloud knob, pushed up and back) so the field goes soft and low-contrast exactly when the grove regrows. So a big jump still dissolves through a passing cloud; but `afternoon 5→6` grows its extra tree in and `afternoon 4→5` (only `branch_angle`) morphs its branches — both under no cloud.

  Runtime flags (`auto_quality`, the debug toggles) differing never trigger a bloom — they just settle at the end. The whole thing is one engine entry point, `transitionTo(params, {duration, onEnd})`; the arrow keys are only its first driver (a planned MIDI/event layer will call the same method). The duration is an editor knob, not stored in a look; arrow keys are ignored while a panel control is focused (so they still nudge a slider). Tiers 2–3 reuse the grove growth (§4.5) and the breathing-cloud (§3.4) as a *transition between* looks rather than a state *within* one — modelled, not a painted dissolve.
- **Time of day (sun input).** An editor-only alternative to the raw `sun_elevation`/`sun_azimuth` sliders: a `time_of_day` + `latitude` pair that computes the sun's position for a **spring day** (equinox, declination ≈ 0) — hour angle 15°/hour from solar noon, `elevation = asin(cos lat · cos H)`, azimuth sweeping east→south→west — and writes elevation/azimuth. Latitude caps the noon sun (`90°−lat`). It's a one-way input helper (the angle params remain the source of truth, so presets store the angles, not the time). On a **touch** screen the canvas is swiped rather than drag-positioned: a **horizontal** swipe scrubs `time_of_day` live (the sun arcs across the day) and a **vertical** swipe steps presets (up = next), the desktop click-drag that frees the sun in 2-D being mouse-only.
- **Page-background player.** The engine doubles as an ambient background, viewer-only (no panel, no input): a fixed full-bleed canvas, optionally with page content on top. The repo ships a minimal reference, `player.html`; the eljojo.net homepage is a real-world embedding of the same pattern. It **rotates through a short cycle of presets** (currently `morning 2` → `afternoon 5b` → `morning 3`), holding each ~30 s and then **cross-fading to the next with `transitionTo`** (the same §9 scene-transition engine the editor's arrow keys drive) — so the background quietly drifts through times of day on its own. It degrades to a static page if WebGL2 is unavailable (the whole thing is wrapped in a `try`, so the page stays fully usable without it). The editor (`index.html`) and the player (`player.html`) share the one engine (`komorebi.js`); see §6.
- **Modules, dev server, and the deploy bundle (bun).** The source is plain ES modules — `komorebi.js` (engine) + `presets.js` (looks), with the editor split across `editor.js` (the authoring shell loaded by the thin `index.html`), `presets-store.js` (★-look persistence), and `profiler.js` (the auto-profiler's pure logic); the player imports only the engine + looks. There is **no build step in the dev loop**: the pages load the raw modules, so a save is live on the next reload. `nix run .#dev` runs a small bun static server (`dev-server.js`) that serves the repo over http (ES modules can't load from `file://`) and **live-reloads** every open tab on any `.js`/`.html`/`.css` change. The one thing that *is* built is the **deploy artifact** for no-build external embeds (the eljojo.net homepage, a classic-`<script>` static site): `nix run .#build` has bun bundle the `komorebi.global.js` shim — which imports the engine + presets and assigns `window.Komorebi` — into `dist/komorebi.player.min.js`, an IIFE global with the editor-only debug overlays **dead-stripped** (`--define KOMOREBI_EDITOR=false` const-folds the `EDITOR` flag, the same effect the old terser+`sed` pass had). So the library is *authored* as ESM (clean to develop, and importable by anyone with a bundler) but also *shipped* as a drop-in global (the lowest-friction form for pasting onto a static page) — the standard library split. The editor's own deploy (komorebi.eljojo.net, GitHub Pages) needs no bundle at all: it serves the raw modules straight off Pages.

---

*End of spec. This document is expected to grow. The afternoon in the park stays the arbiter: if a choice makes the simulation more technically correct but less true to what was seen and felt — the breathing focus, the translating gaps, the branches fighting and snapping back, the caustic reorganization of sparse spring leaves — the felt truth wins.*
