# The sky view

*The retina: the canopy seen against the source, by an eye lying on the ground and looking up.*

## The tree as the subject

The hammock at the festival: lying back, tall trunks converging overhead, crowns lit from behind against the bright sky, the whole grove leaning together with the gusts. It is not a new scene. It is the founding afternoon with the eyes turned the other way, the same grove and the same sun, no longer read off the floor but looked at.

Every other camera answers *what did the light land on*. This one stops looking at what the light lands on and looks at where it comes from, so the surface the light reaches is the retina. [`principles.md`](../principles.md) already holds what that does to the rule of modelling only what reaches the surface; here it means one thing: **in this view the tree is the subject**, and what reaches the eye has to read as an object rather than as a pattern that happens to have a tree behind it. That sets three requirements:

- **Law.** The wood is **connected**, trunk to limb to twig to leaf, without a gap.
- **Law.** It **tapers** by the pipe model as it goes ([`canopy.md`](canopy.md)).
- **Law.** It is **dark**. An occluder brighter than what it occludes is a light and not a body.

And the leaves are lanterns against the light, with the sun leaking through the gaps.

What this view does not yet buy is named so the direction is legible rather than implied: no lit bark, no sun on a trunk's near flank, no visible-surface shading of any kind. The tree here is an object made of shadow, correct in its structure and its connectivity, and unlit. **Not built:** the tree as a shaded body is the direction.

The view is a camera, `sky_view`, off by default; every look without it is unchanged. With it on, `view_pitch_deg` becomes the gaze's elevation, 90° at the zenith ([`camera.md`](camera.md)).

## It invents nothing

That is the point, and it is why the whole view is one branch of the camera chain and no new physics. The engine has always had an occluder field of per-channel optical depth at known heights, and a source with a known angular distribution. The floor integrates that field along the **sun's** rays and asks what fraction of the disk survives; the sky view integrates the *same* field along the **eye's** rays and asks what the eye receives. In its simplest form, the window this view was first built as, it is pure transmission:

> `col = T · (sky + L_source(θ))`,  `T` = Π over layers of `e^(−τ(p_L))` × the wood's transmittance

**Law.** The ray crosses layer `L`'s plane at plan `eye + dir.xy·(h_L/dir.z)`: the same layer, the same tap the floor reads, and deliberately **no shift by `g`**. `g` is where the *sun's* rays land ([`transport.md`](transport.md)), and this ray is the eye's. There is no receiver height to subtract either: these are absolute heights over an eye on the ground.

Per-channel Beer's law arrives for free. The tap exponentiates a per-channel optical depth, so a leaf between the eye and the sun passes its own green-gold. The leaf's transmittance, which every other look infers from a dapple's colour ([`leaf.md`](leaf.md)), is seen head-on.

**Law.** Outside the baked canopy box the read returns 1. Beyond the grove there is open sky, and an upward frame leaves that box within metres; the alternative is a clamped border texel smeared across the whole periphery.

Below the horizon the frame hands off to the distance haze ([`camera.md`](camera.md)): one behaviour and one colour shared with the floor's over-horizon rays, rather than a second sky model for the bottom of the picture.

## Wood as silhouette

The trunks and main limbs are the reference's defining structure, and they need no new data. They are the same analytic segments the floor casts shadows with ([`canopy.md`](canopy.md)), minus the one term that makes them a shadow: there is **no bulk shift** here. That vector is where the wood's shadow *falls*, and this view looks at the wood itself.

**The sway is kept.** Each endpoint drifts by its own height fraction exactly as the cast does. That is what puts the coherent band of the wind ([`motion.md`](motion.md)) on screen **directly** instead of inferred from a moving floor pattern: the unison lean of a whole grove is the soul of this look, and it comes from the motion system untouched.

**Law.** Geometrically the silhouette is the **closest approach** between the view ray and each segment, a clamped ray-to-segment minimisation in closed form, and the segment's optical depth applied over a soft edge on that distance. The columns converge on the zenith by **projection alone**. Nothing draws a trunk. The closed form's agreement with dense sampling is in [`../evidence/measurements.md#sky-view`](../evidence/measurements.md#sky-view).

**The wood occludes only in front of the eye.** The occlusion is ramped on in the first 5–20 cm of along-ray distance from the eye: wood *at* the eye is not between the eye and the sky. Without that gate an eye standing on a trunk's axis is shadowed by it in every direction, and the whole frame, sky and sun included, is multiplied by the trunk's `e^(−τ)`. The gate makes that pose survivable, never composed. **Authored:** *the hammock hangs between trees; do not stand the eye on a trunk.* Tree 0 is planted at plan (0, 0), so a view centred on the origin does exactly that.

## The occluder budget is a composition constraint

The analytic wood is a fixed table of segments ([`canopy.md`](canopy.md)). On the floor a truncated tail costs a few branch shadows; in this camera the wood **is** the structure, so a grove past the table loses whole trees' trunks: the later trees simply have none.

**Law.** A look whose subject is trunks trades limbs against trees: `tree_count·(limb_count + 1) ≤ 256`.

The table, why it is a look decision to raise, and the report of an overgrown grove are [`canopy.md`](canopy.md)'s; in this camera they become the rule above.

## The source, seen

The sun is not a point and every dapple is its image ([`source.md`](source.md)). This is the first time the thing being imaged is in the frame, and **it must be the same thing**.

**Law.** Both regions of the seen source come straight from the sampler: a core disk of `core_angular_radius_deg` and a halo annulus out to the cloud-widened `halo_angular_radius_deg`, each at the radiance its own **post-cloud weight over its own solid angle** gives. So `cloud_thickness` drains the disk into the aureole *here* by exactly the amount it softens the dapples *there*. That the seen core-to-halo energy split matches the sampler's weights across clear, hazy and overcast skies is measured: [`../evidence/measurements.md#sky-view`](../evidence/measurements.md#sky-view).

**The annulus is flat because the sampler's is flat.** A smooth falloff would look better and would no longer be the source the cast is drawn from.

**The eclipse carries over whole.** The same moon disk the sampler punches out of its weights is applied angularly in the same source plane, reconstructed from the cast's own ellipse projection, so the crescent stands at the *same orientation* the dapples image it at. Looking up during an eclipse you see the crescent itself, through the leaves, throwing crescents. The seen field is renormalised analytically (circle–circle overlap), so it carries exactly the sampler's total energy.

`L_disk(θ)` names this seen radiance below: the sampler's own core, halo and moon, unchanged. The sampler itself, its points and weights, is [`source.md`](source.md)'s.

## Two authored scales, and why they cannot be physical

A sun disk is about `10⁶` times a blue sky's radiance. No tone curve and no glare kernel carries that, so the absolute levels are **Authored**, and said so rather than dressed up as physics. There are two.

- **The sun's gain** multiplies the sampler's angular density. It leaves the core-to-halo ratio exactly the sampler's; only the absolute level moves.
- **The sky's gain** converts the authored ambient skylight, which is an **irradiance** (what the sky delivers *onto* a surface), into the **radiance** you see looking straight at the sky. That is a different quantity, and the engine never had it before this view.

`ambient_skylight` still steers the sky. The sky's gain is the one control that lifts the sky **without** lifting the canopy: it multiplies the radiance seen looking at the sky and never the irradiance landing on a leaf, so raising it moves open sky above the brightest crown rather than taking both up together. At the shipped daylight setting open sky lands just above the thinnest sunlit crown, and the disk clips white; the values are in [`../evidence/measurements.md#sky-view`](../evidence/measurements.md#sky-view).

The same compression stands between the disk and the canopy's glow (below). The glow sits at the sun's irradiance with unit gain; the disk sits at that times the core's seen radiance. Physically the disk is about `5·10⁴` times a lossless diffuser lit by the same sun, some fifteen and a half stops; the engine's is a few stops. So the conservation laws below are about the **dimensionless leaf model**, what a leaf does to a unit of light, and say nothing about disk against glow in the frame.

## The veiling glare

The bright-sky wash that grows around a source seen through gaps is the eye's own **veiling glare**. Here it is the lateral diffusion pass the curtain uses ([`receivers.md`](receivers.md)): the identical operator over the identical linear-HDR frame, before the tone curve, with its gate widened to this camera. On the curtain the scattering lives in the fabric; here it lives in the observer's eye. That makes it a **perception-tier** reading of a transport pass, the same honesty class as the mesopic shift ([`light.md`](light.md)), which likewise models the eye rather than the scene.

**Approximation.** It is *a compressed stand-in for a contrast the pipeline cannot carry*, the same class of deliberate non-physicality as the curtain's window wall. `glow_bleed` mixes the blurred frame in, so a sky pixel's rendered value falls between `(1−d)·sky` and `sky` depending on how much dark canopy its neighbourhood holds. A wide setting drags open sky down toward the canopy's own mean and reads as haze over the whole picture. **Authored:** set it to halo the source and nothing else. The diffusion radius still divides by `view_extent_m`, which frames nothing here, so in this view those two knobs set a plain screen-space glare radius.

The mesopic cue needed nothing: it reads the beam's transmittance, and in this view that is the ray's own sky transmittance, still exactly *how much of the light got through here*.

## The canopy glows

Look up through a grove on a clear day and the picture is mostly *bright*. The sky is the ground tone, and the crowns with sun on them are luminous green-gold: brighter than the crowns beside them in shade, and lit from within rather than merely thinner. That is the whole difference between a canopy and a stencil, and pure transmission cannot produce it. `T·(sky + source)` only ever removes light, so every leaf is a dim filter and a deep crown is black.

Light reaches a leaf, scatters inside it and leaves in every direction. Along the eye's ray that is a **source term**, and over a layered occluder field it is a sum rather than an integral, one term per layer, accumulated **eye → sky**. Its general form is the one the lantern (below) fills with measured quantities:

> `glow = Σ_L thr_L · e_L · A_L · sunColor`

- `thr_L` is the **throughput** from layer `L` down to the eye: the transmittance of the layers below it.
- `e_L` is the share of the sunlight landing on layer `L` that the layer sends on as diffuse light, read from its **foliage** alone (below).
- `A_L` is the sunlight arriving at layer `L` **from above**: the product of the layers over `L`, tapped along the **sun's** ray at `p_L + g·(h_M − h_L)` with `g = sunDir.xy/sunDir.z`. That is the same per-metre plan travel the bulk shift carries on the floor, read in the opposite sense, because here it is where the light comes *from*. For four layers it is six extra taps and no new data.

`g` is an argument of the ray, not a property of the view: this camera, which has no beam of its own, passes the sun it looks at; the sky fill passes the beam's own path. **Law.** The sky view's eye ray and each of the fill's hemisphere rays run **one shared ray**, so the two cannot drift into two answers to *what does this ray see* ([`fill.md`](fill.md)). The bounds below are therefore one bound, not two.

**The wood occludes the glow as it occludes the sky.** On an upward ray the trunks and limbs are crossed *before* the crowns, so the analytic occluder's transmittance multiplies the accumulated glow as well as `T`. That is a first-order statement (scatter born below a limb should not be blocked by it) and it is right in the geometry this view has, where the wood stands under the canopy it silhouettes against.

### The proxy at d = 0

With `leaf_diffuse` at 0 the leaf is a ballistic window ([`leaf.md`](leaf.md)), there is no measured diffuse share to read, and the glow is the authored proxy `sky_scatter`:

> `L += throughput·(1 − t_L)·ŝ_L·A_L·sunColor`,  `throughput *= t_L`,  `col = T·(sky + L_disk) + sky_scatter·L`

- `1 − t_L` is the share of the ray's beam that layer's **foliage** takes out: the scattering density.
- `ŝ_L = t_L / max(t_L)` is the layer's transmittance normalised to **unit peak**: hue with the brightness divided out, the curtain dye's twin. The chlorophyll spectrum carries the colour and the knob carries the level, which is why a crown reads green-gold at any `sky_scatter`. Taking the *layer's* spectrum rather than one leaf's is also a first-order account of scattered light filtering back out through the layer that made it.

**Law: the energy bound is structural, not a clamp.** `Σ_L (Π_{M<L} t_M)(1 − t_L)` telescopes to `1 − Π_M t_M` exactly, per channel. With `ŝ ≤ 1`, `A ≤ 1` and `sky_scatter ≤ 1` the whole term is bounded by `sky_scatter·(1 − T)·sunColor`: a crown can never radiate more than the sunlight landing on it, and a stack deep enough to darken has, by the same expression, little light left to scatter. `sky_scatter = 0` leaves `L` exactly zero, and the view is pure transmission.

**Above d = 0 the proxy is retired.** `sky_scatter` is an authored stand-in for the light a leaf passes diffusely, which `leaf_diffuse` now measures, and counting both would count it twice. While `leaf_diffuse` is above 0 the knob is dead: the glow is at the sun's own level, the editor hides the knob and says why. At 0 it is the live knob it always was. It is the floor's `fill_scatter` twin ([`fill.md`](fill.md)).

## The skylight is not a source

The first form of the glow read the sunlight on a layer as `sunColor·A_L + ambient`: a leaf scattering the skylight that fell on it. **That was a double count.** The skylight's passage through the leaves is already carried, by the `T·sky` term along the eye ray here, and by the fill's sky transmittance on the floor.

**Law.** For a uniform sky, diffuse transmission through Lambertian leaves equals the ballistic `T·L_sky` to first order ([`leaf.md`](leaf.md)), so an ambient term inside the glow counted the same skylight twice and lit a crown by it even with the sun off. Nothing is left for it to be. A leaf's *top* reflection goes up and never reaches an eye below; its *underside* has no light to send on, because the model has no ground bounce, and a term for one would be a new source, not this one.

So the glow is the sun's light scattered by the lit leaves, and with the sun off it is exactly zero and the ray is exactly `T·sky`. The shared ray never reads the skylight. A crown that needs to be brighter takes more diffuse light from the sun, not the skylight back. The double count's history is in [`../evidence/dead-ends.md#sky-view`](../evidence/dead-ends.md#sky-view).

## The skeleton joins the seen layers

Leaves must have twigs to hang on, or a crown reads as a cloud floating near a bare limb tip. In this camera the **fine wood** is stamped at bake time as neutral optical depth, additively, exactly as the leaves are, at the same plan point and read by the same tap.

**Law: do not bin long wood.** A segment that spans several bands, cut into pieces whose heights snap to different layers, becomes on the cast a staircase of disjoint shadows, each piece shifted by its own layer's `h·g`. That is the canopy's recorded dead end, and the reason the trunk and main limbs are an analytic continuous-height occluder ([`canopy.md`](canopy.md)). The seen view has the same hazard for the same reason, since its read `eye.xy + dir.xy·(h_L/dir.z)` is height-dependent too. So the rule is the same and so is the fix: only wood short enough to sit inside one band goes into a band. Levels 0 and 1, the trunk and main limbs, are drawn analytically as real capsules; **level 2 and above**, the sub-branches and twigs, are what the layers take.

## Wood and foliage are kept apart in what is read

*An opaque occluder in the scatter channel glows.* The glow reads its density and its hue from the layer's transmittance. Wood is neutral, so a twig's depth would normalise to a near-**white** hue at near-**full** density, and the term would answer with almost the whole illumination. The skeleton would render as pale filaments **brighter than the sky they stand against**: an occluder outshining what it occludes, and worse the thicker the wood. That breaks the third requirement outright.

**Law.** So the two occluders are kept in separate fields at the same texel:

> layer texel `= (τ_foliage.rgb, coverage)`,  wood `= τ_wood`;  transmittance `= e^(−τ_rgb)·e^(−τ_wood)`;  scatter density and hue `= e^(−τ_rgb)` **only**

The representation is the model here, which is why the wood is a texture of its own per layer, written by the same stamp and cleared per layer, so a layer with no twigs, or `branch_tau` tweened to 0, reads as no wood. The leaf bake is then the same bake on every camera. The earlier arrangement, where the wood rode the layer's coverage channel, is in [`../evidence/dead-ends.md#sky-view`](../evidence/dead-ends.md#sky-view).

Wood still appears in the ray's **throughput**, and in the sun's path to each layer: a twig shadows a leaf exactly as another leaf does. It appears **nowhere in the emission**. That makes the darkness structural rather than clamped. Wood can only multiply the result by a factor `≤ 1`, so a wood pixel is darker than the same ray without it, always, and darker the thicker the wood: the direction an occluder must move. A ray that meets nothing but wood emits exactly zero, at every `sky_scatter` up to 1 and at every `leaf_diffuse`. The measured comparison, wood read as foliage against wood kept apart, is in [`../evidence/measurements.md#sky-view`](../evidence/measurements.md#sky-view).

## Registration by construction

**Law.** A terminal segment is stamped into **its own clump's layer**, the very bin the leaves hanging on it went into, so wood and leaves are drawn at the same plan point and read at the same plan point. The residual is zero, not small.

The coherent sway is taken the same way. The stamp receives the **leaf bake's own per-layer factor**, `1 + sway_height_gain·(h_L/base − 1)`, as a rigid plan translation, instead of the cast path's height-scaled `h/h_ref`, because a twig and its leaves must move together and the leaves move by the layer's rule.

*Where two things must stay registered, give them one rule, not two rules that agree today.*

## The leaf is a lantern, not a window

Look up through a backlit leaf and you see its diffuse transmission, a glowing lamina, never the sun's disk through it. José's memory: *"it'd be easy to look at the sun and the canopy would act like sunglasses but still leaks would leak through."*

At `leaf_diffuse` 0 the sky view is the ballistic window: the disk shows through every leaf at `Π t`, tinted, and `sky_scatter` paints an authored glow beside it. With `leaf_diffuse` `d` (the neutral depth `k = −ln(1−d)`, capped as in [`leaf.md`](leaf.md)) the disk is only what a leaf lets through *as a beam*, and the light the leaf took out of your line of sight reappears as that leaf's glow: the canopy as sunglasses, with leaks through the gaps. No new knob and nothing authored in the leaf. It is the very beam `tb` and emission `t − tb` the fill uses ([`fill.md`](fill.md)), read along one eye ray instead of a hemisphere.

### Three transmittances of one upward ray

Per channel, with `t_L` and `tb_L` the layer texel read as a mixture of leaf and gap ([`leaf.md`](leaf.md)), `w_L` the layer-stamped wood and `W` the analytic occluder:

> `T_sky = Π t_L·w_L · W`  the sky. Diffuse and ballistic agree for a uniform sky, so the sky needs no split, and the mesopic cue reads this.
>
> `T_src = Π tb_L·w_L · W`  the disk. Collimated, so a leaf kills it, to `1−d` per leaf in the leaf's own hue, and only a gap passes it whole.
>
> `thr_L = Π_{M<L} t_M·w_M`  the glow descending to the eye from layer `L`. Diffuse, so it falls through the leaves below on their **true** `t`; wood blocks it.
>
> `A_L = Π_{M>L} tb_M·w_M`  the sunlight on layer `L` along the sun's ray. Ballistic, through wood.

and the ray's radiance is

> `glow = Σ_L thr_L·(t_L − tb_L)·sunColor·A_L · W`
>
> `srcSeen = sunColor·L_disk(θ)·T_src`
>
> `skyRad = sky·T_sky + glow + srcSeen`

where `sky` is the ambient skylight times the sky's gain.

**`srcSeen` is the leaked disk alone**, its own quantity, composed **last** and never folded into the sum earlier. **Not built:** a later phase, the eye's, takes the leaked disk out of the frame and gives it a glare of its own; until then the whole-frame veiling glare carries it.

**The wood never glows.** It is in `thr`, in `A` and in `T`, and nowhere in `t − tb`: wood has no coverage to take `k` by. A ray that meets only wood emits exactly 0, and wood can only darken.

### The identity, and where it is not an inequality

**Law.** When the eye ray *is* the sun's ray (`g` equals the ray's own travel per metre of rise) every `A_L` reads the very taps the ray passes, and the telescoping identity of [`fill.md`](fill.md) holds along it: `Π tb + Σ_L thr_L·(t_L − tb_L)·A_L = Π t`, beam plus emitted equals the total transmitted, for any `d`. At `d = 0`, `tb = t` and the glow is identically 0; as `d` rises `T_src` falls, the glow rises, and their sum stays `Π t`.

**Off that ray it is an identity no longer, and not an inequality either.** `Π tb + glow ≤ Π t` is false in general, and the counterexample is a picture, not a corner case. Two layers: the lower leaf lit by the sun through a *gap* in the upper layer, the eye looking at it through a dense leaf of the upper layer at another plan point. The sun's path to the lower leaf is clear (`A = 1`) and the eye ray's own beam is nearly dead, so `Π tb + glow` exceeds `Π t` by exactly

> `(t_0 − tb_0)(1 − tb_1)`

That is a lit leaf visible through a leaf in front of it. It is physics, the same displacement the floor shows ([`fill.md`](fill.md)), not a leak.

**Law.** What holds in every direction is the per-layer bound, a leaf glows no more than its diffuse share of the sunlight landing on it,

> `0 ≤ glow ≤ Σ_L thr_L·(t_L − tb_L)·sunColor`

and `T_src ≤ T_sky`. The contract is [`../contracts/conservation.md`](../contracts/conservation.md).

### The ray against its reference

The frame is tone-mapped and carries the source, the wood and the glare on top, so it cannot be held to a formula; the ray under it can. **Law.** `T_sky`, `T_src` and the glow are held to a pure reference taking the same taps, on the layers and wood the engine really baked. The errors and tolerances are in [`../evidence/measurements.md#sky-view`](../evidence/measurements.md#sky-view); where the check lives is [`../implementation.md`](../implementation.md).

### The gate

`leaf_diffuse` 0 is the window: the shared ray takes its ballistic branches, `T_src` is `T`, and the composition is the proxy line `(sky + sunColor·L_disk)·T + sky_scatter·L`. Off, the picture is unchanged, including the canopy looks with every lantern rung armed behind `d = 0`, and the floor, curtain and fill looks whose programs share the ray ([`../contracts/preservation.md`](../contracts/preservation.md)). As a quality rung its gate is `leaf_diffuse` 0, with no profiler axis of its own ([`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).

## No receiver

There is no surface between the canopy and the eye, so the whole receiver subsystem is inert: no fabric transmission, no dye, no folds, no seams, no ground albedo, no fold warp, no window. The sky view reads nothing of the fill either; it computes its own ray.

**Law.** `faithful_canopy` is forced off, for one reason further than the tent's. The tent has no *single* cast frame; the sky view has no cast frame at all, because the faithful pre-integration is along the sun's rays and this reads along the eye's. There is nothing for a single tap to be a tap of ([`canopy.md`](canopy.md), [`transport.md`](transport.md)).

## The mesh panels are windows onto this view

The tent's mesh panels ([`receivers.md`](receivers.md)) are windows onto precisely this view. A mesh is not a cast surface but a hole you see the canopy through, so per-panel material and this branch are the two halves of one step. **Not built:** an upper panel running this view's transport instead of the fabric's; `tent_mesh` is its one-sided approximation.

## Approximations and limits

- **Approximation: the sky is a flat radiance.** One colour across the dome, with no horizon brightening and no sun-adjacent aerosol forward-scatter, so the aureole in frame is the *sampler's* halo and not the atmosphere's. A real gradient wants a sky model the engine does not have; faking one with a screen-space ramp would be painting.
- **Approximation: single scatter.** A leaf's glow goes to the eye through the layers below on their true `t`; no leaf is lit by its neighbour's glow, nor by a bounce. A very dense crown is darker here than in life, where multiple scattering is most of what fills it.
- **Approximation: the ballistic residue carries the leaf's hue.** `(1−d)·T` is still the leaf's colour, so at `d` near 1 a single leaf over the disk leaves a few percent of it, tinted; a stack of three puts it out.
- **Authored: the gains.** The sun's and the sky's gains compress a contrast of about `10⁶` into what a tone curve carries, and the disk against the glow by many stops (above). The conservation laws are about the dimensionless leaf model, not about the frame's absolute levels.
- **Approximation: wood is a pure attenuator.** No bark is lit and no limb glows. The wood at a layer does not block that layer's own emission; it blocks every other layer's.
- **Approximation: the fine wood is stamped without the leaves' twig-hug jitter**, and a twig near the bake's texel scale aliases like any other thin feature.
- **Approximation: the wood gate near the eye.** Wood occludes only where its closest approach stands in front of the eye, over a 5–20 cm ramp. It makes a pose on a trunk's axis survivable, not composed.
- **Approximation: one constant angular soft edge on the wood.** It stands in for both a pixel's footprint and the penumbra a silhouette really has against the sun's disk. Physically the edge should be soft by the source's angular size only where the wood stands against the *source*, and knife-sharp against blue sky; knowing which needs the source's angular coverage at the wood's own position, a second ray march.
- **Approximation: the eclipse's split is the sampler's.** The seen field's renormalisation is exact, but the sampler's own estimate of the moon's bite is off in the core-to-halo split; that gap belongs to the sampler ([`source.md`](source.md)), not to the view.
- **Approximation: the glare radius is screen-space.** The diffusion radius divides by `view_extent_m`, which frames nothing here.
- **Approximation: a leaf's soft edge.** The slab reading of a texel made every leaf's rim glow brighter than its interior, a pale outline brightest in the channels the leaf absorbs. The cure was a model change, the texel read as a mixture ([`leaf.md`](leaf.md)), and what is left is the residue of two edges inside one texel. The rim, its measurement and its cure are in [`../evidence/dead-ends.md#sky-view`](../evidence/dead-ends.md#sky-view).
- **Law, reaffirmed: there is no focal plane.** Looking at the canopy instead of its cast changes nothing about it. The camera is still a pinhole: no eye depth of field, no bokeh, no near or far blur. Every soft edge in the frame is the source's angular size or the wood's antialiasing, exactly as on the floor.

## Not built

- **The tree as a shaded body**: lit bark, sun on a trunk's near flank, visible-surface shading. See [`../exploration/open.md`](../exploration/open.md).
- **The eye's own glare for the leaked disk**, taking `srcSeen` out of the frame-wide veiling glare. See [`../exploration/open.md`](../exploration/open.md).
- **Mesh panels as sky view**: the tent's upper panels running this transport. See [`../exploration/open.md`](../exploration/open.md).
- **A sky model** with horizon brightening and aerosol forward-scatter, to replace the flat radiance. See [`../exploration/open.md`](../exploration/open.md).

## Related

- [`../experience.md`](../experience.md): the hammock.
- [`../principles.md`](../principles.md): the surface decides what counts, and the surface is sometimes the retina.
- [`source.md`](source.md): the sampler this view shows, its core, halo and eclipse.
- [`leaf.md`](leaf.md): the texel as a mixture, the diffuse split, the neutral depth `k`.
- [`fill.md`](fill.md): the same shared ray, integrated over the floor's hemisphere.
- [`canopy.md`](canopy.md): the analytic woody occluder, the bake, why long wood is not binned.
- [`motion.md`](motion.md): the coherent sway the silhouettes carry.
- [`receivers.md`](receivers.md): the lateral diffusion pass read here as veiling glare; the tent's mesh band.
- [`camera.md`](camera.md): the gaze, the distance haze below the horizon, the tone tail.
- [`light.md`](light.md): the mesopic shift.
- [`transitions.md`](transitions.md): the viewpoint route between this view and the floor.
- [`../contracts/conservation.md`](../contracts/conservation.md), [`../contracts/preservation.md`](../contracts/preservation.md), [`../contracts/looks.md`](../contracts/looks.md).
- [`../evidence/measurements.md#sky-view`](../evidence/measurements.md#sky-view), [`../evidence/dead-ends.md#sky-view`](../evidence/dead-ends.md#sky-view).
