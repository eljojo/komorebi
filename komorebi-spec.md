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
- `tone_map_curve`
- `ambient_skylight` (lifts the green shadow wash)

---

## 9. Harness notes (non-physical)

These belong to the authoring tool, not the model, but they shape how the model is *explored* and so are worth recording.

- **Presets.** The full parameter set is saveable to the browser's local storage by name, and any state can be exported/imported as JSON for sharing across machines. Two presets ship built in: *afternoon 5* (the boot default — a calm, warm, near-overhead spring scene with auto-quality on) and *afternoon 4* (its windier predecessor); every other look is the user's own, saved (★) to local storage. The bare neutral config still lives in code as the merge base (`DEFAULTS`) but is no longer exposed as a preset.
- **Stable per-clump seeding & fractional-leaf fade.** As in §5.3, so the parameter space is smooth to sweep.
- **Manual drift phase.** The §5.2 mechanism, exposed as a slider (`drift_phase`) with an `auto` option that advances it over time — a preview of the incoherent band before any real wind field exists.
- **Auto-quality (debug toggle).** A checkbox — **on** in the default scene (*afternoon 5*), though the underlying param defaults off — that watches frame rate and eases toward the highest quality that still holds ~60 fps. It spends the *cheapest* quality first — render resolution (nearly free for so soft a piece), then source-sample count — and leaves the physical and artistic params untouched. It chases a smooth 60 — dropping quality (debounced against lone spikes) whenever frames slip below it — and is deliberately **reluctant to climb back**: each forced downsize doubles the wait before it will probe upward again, so it ratchets to a stable level and parks there rather than hunting. Full quality is re-probed only on an explicit re-tune (toggling it, or loading a preset).
- **Dev panel hidden by default.** The whole authoring panel is hidden on load; press **D** to reveal it. The visualization stands alone until then.

---

*End of spec. This document is expected to grow. The afternoon in the park stays the arbiter: if a choice makes the simulation more technically correct but less true to what was seen and felt — the breathing focus, the translating gaps, the branches fighting and snapping back, the caustic reorganization of sparse spring leaves — the felt truth wins.*
