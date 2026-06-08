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

3. **There is exactly one sanctioned approximation: depth discretization.** We collapse the continuous depth of the canopy into a small number of layers (3–5). This is the *only* place we cheat, and it is the right place: it is where performance genuinely bites, and simultaneously where the eye is most forgiving. The eye needs "some dapples crisp, some soft"; it cannot count the layers.

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
- **Accumulate in linear HDR; tone-map at the very end.** The contrast/exposure knob lives downstream of the physics, so the look can be tuned without touching the light.

### 4.7 Look

Elliptical projection (from transport), the green wash (from the canopy), exposure and contrast tied to source width, and a final tone-map — all **downstream** of the physics.

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

### 5.2 The incoherent band (bottom of the hierarchy)

A **fast, spatially incoherent** forcing — "faint, in all directions" — that kicks **individual leaves and petioles** slightly differently, with almost no correlation between neighbors. That **decorrelation is the entire difference** from the coherent band: there, neighbors move together and shape is preserved; here, neighbors move independently, so gaps **reorganize** rather than translate.

Its visible effect scales from a faint **glisten** all the way up to full **caustic-like gap reorganization** — and what sets the scale is foliage density (§5.3).

**The caustics reference is physics, not just a vibe, and belongs in the model.** Pool caustics are bright features that move by **merging, splitting, and collapsing** rather than sliding. What reorganizes here is the same *visual grammar*: small gaps drifting in and out of the pinhole regime, neighboring sun-images overlapping and separating, brightness gathering and dispersing as apertures breathe. It is **not** literal optical focusing the way water is — but the felt behavior (smooth birth, merge, and collapse of bright shapes) is shared, and it tells an implementer what the second motion should *feel* like in a way no equation does.

### 5.3 Density is a first-class knob

Whether independent leaf motion **restructures** the gaps or merely **twinkles** them is set by foliage density:

- **Low density** (the early-spring condition — sparse, immature leaves): individual leaves still matter; moving one opens or closes a real gap → the **caustic-like reorganization** is possible. *Low density is the enabling condition for the second motion, and the spec should say so plainly.*
- **High density** (summer canopy): every gap is backed by ten more leaves; the topology is saturated; the same flutter barely changes the cast pattern → flutter only **twinkles.**

### 5.4 The unifying mapping

The three motions are the **same structure seen at three timescales**, mapped onto three levels of the hierarchy:

| Motion seen on the ground | Hierarchy level | Timescale |
|---|---|---|
| Pattern **translates** intact | whole tree / major limbs sway together | slow |
| Gaps **morph and rearrange**, then recover | mid-branches & twigs flex differently from one another | medium |
| Pattern **glistens** | each leaf trembles on its own petiole | fast |

The two bands **coexist and sum.** On the spring afternoon, a gentle directional breeze and a fine all-directions shimmer were both present, in shifting proportion, moment to moment. **That proportion, plus the foliage density, is most of the expressive surface of the whole piece.**

---

## 6. Implementation target

- **Platform:** WebGL / HTML5, a full-screen quad with the heavy lifting in a fragment shader.
- **Canopy** lives as objects (CPU or compute), carrying rest pose and spring state, **re-baked to the depth-layer transmittance textures once per frame.**
- **Transport** is the shift-multiply-sum over **~16–48 source samples**, read in the fragment shader; target 60 fps.
- **The spring graph** lives in the canopy objects; the two wind bands drive it.
- **Render linear HDR, tone-map last.**

---

## 7. Open questions (this is a living spec)

These are deliberately unresolved and meant to be tuned during implementation:

- Skeleton depth — how few levels still give convincing multi-scale gaps.
- Source-sample count vs. performance, and the exact core/halo split and falloff of the source profile.
- The default foliage density, and how it is exposed as a control.
- The shape of the stiffening curve and the damping ratio that makes the backlash read right (visible overshoot without looking rubbery).
- Layer count and per-layer height assignment.
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
- skeleton params: `branch_levels`, `branches_per_node`, `cluster_spread`
- texture: `resolution`, `world_extent` (≥ visible + max shift), `tiling`

**Transport**
- `sun_elevation`, `sun_azimuth` *(build the 2×2 ground-projection matrix; owns the ellipse + shear)*

**Wind — coherent band**
- `direction`, `base_strength`
- gust `attack`, `decay`, `frequency` (the breathing)
- `stiffness`, `stiffening_curve` (nonlinear ceiling)
- `damping_ratio`, `backlash_gain` (underdamped snap-back / overshoot)

**Wind — incoherent band**
- `strength`
- `spatial_correlation_length` (small → decorrelated per-leaf)
- `temporal_frequency` (flutter rate)

**Look**
- `exposure`, `contrast` (coupled to `cloud_thickness`)
- `tone_map_curve`
- `ambient_skylight` (lifts the green shadow wash)

---

*End of spec. This document is expected to grow. The afternoon in the park stays the arbiter: if a choice makes the simulation more technically correct but less true to what was seen and felt — the breathing focus, the translating gaps, the branches fighting and snapping back, the caustic reorganization of sparse spring leaves — the felt truth wins.*
