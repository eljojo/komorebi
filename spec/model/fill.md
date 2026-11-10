# The sky fill

*What lights the shade: the skylight that came through the canopy, and the sunlight the lit leaves send down, integrated over each floor point's hemisphere.*

## The missing term

Lying under a tree in summer, the dark places on the ground are not black and not sky-blue. They are a dim green. In autumn they go gold, orange, red, while the sun-images stay white-gold. The green of the shade is **collective**: thousands of lit leaves, each sending its colour down in every direction, summed. It is not the colour any one leaf paints on the ground; a leaf four metres up throws a dark shadow, and its colour spreads over the floor beneath it ([`leaf.md`](leaf.md) says why the light a leaf passes is almost all diffuse).

A floor point under a canopy is lit by three things:

1. the sun's beam through the gaps, which transport builds as `acc`, the landed fraction of the sun's disk ([`transport.md`](transport.md));
2. the skylight, which also had to come through the canopy to get there;
3. the sunlight the lit leaves scatter downward.

The cast filters only the first. Without the fill, the other two are one flat, unfiltered sky. Under a red fall canopy that is a red beam on a blue-lit floor, and the shade reads **magenta**. The cause is a missing term, not a wrong colour. **Law:**

> `E_shade(x) = ambient · T̄_sky(x) + ∫_hemi L_scat(x, ω) cosθ dω`

`T̄_sky` is the **cosine-weighted hemispherical transmittance** of the canopy above `x`, forestry's *diffuse gap fraction*. The piece's sky is a flat radiance, so `ambient = π·L_sky` and the first term is exactly `ambient·T̄_sky`. The second term's integrand is the sky view's scattered radiance along a ray ([`sky-view.md`](sky-view.md), "the canopy glows"): the same telescoping single-scatter sum over the layers, of the sun's light only.

The skylight is not in that second sum, and the split is the point. The skylight's passage through the leaves is the first term; a leaf that also scattered the skylight that fell on it would count that light twice. For a uniform sky, diffuse transmission through the leaves equals the ballistic transmittance to first order, so the skylight needs no split at all ([`sky-view.md`](sky-view.md) gives the argument, and why nothing is left over for a leaf's skylight scatter to be).

So the shade is the sky camera integrated over the floor's hemisphere: no new physics, and not a second copy of it. The sky view's eye ray and every one of the fill's hemisphere rays run **one shared ray**, the same text, so the piece cannot answer "what does this ray see" two ways. The sky view passes the sun it looks at and reads the wood; the fill passes the beam's own sun path (below, *One sun per camera*) and ignores the wood by design.

## What a ray reads

Each hemisphere ray crosses the depth layers at shifted plan points, `x + h_L·d`, where `h_L` is the layer's height over the floor and `d = tanθ·(cosφ, sinφ)` is the ray's plan travel per metre of rise. At each crossing the ray reads the layer's texel as a **mixture of leaf and gap** ([`leaf.md`](leaf.md), the texel mixture law), which gives it two transmittances per channel:

- `t_L`, what the layer truly passes: hue, skylight, and the light it sends on downward;
- `tb_L`, the ballistic share: the beam, and the sun's path *to* a leaf.

From those, along each ray, per layer, per channel:

- `A_L = Π_{M>L} tb_M`, the sunlight reaching layer `L`, ballistic, read along the sun's path from where this ray crosses `L`;
- `thr_L = Π_{M<L} t_M`, what the light a layer emits finds below it: the lower layers on their true `t`.

The fill reads `T` and `T_b` from the leaf's law; it does not own them. Whether the texel is read as a mixture or as the older slab depends on the leaf's own switches (`leaf_diffuse`, `edge_area`), and the fill follows whatever that law says ([`leaf.md`](leaf.md)).

## The skylight term

> `T_sky(x) = (1/K) Σ_k Π_L t_L(x + h_L·d_k)`

**Law:** the skylight takes no split. No neutral depth `k` moves `T_sky`; it reads the layers' true `t`.

## The emission term

With the leaf's diffuse share open (`leaf_diffuse` above 0, [`leaf.md`](leaf.md)), a leaf is not a window. The beam keeps the ballistic part; the rest of what the leaf passes is emitted, diffusely, in the leaf's own colour. A layer emits `t_L − tb_L`: the leaf's own diffuse share over its fraction of the texel, the gap emitting nothing. **Law:**

> `S(x) = (1/K) Σ_k Σ_L thr_kL · (t_kL − tb_kL) · sun · A_kL`

There is no albedo in it, nothing authored, and no skylight. The hue is `t`'s own and the level is the diffuse share `d` of the leaf's transmittance. With `leaf_diffuse` at 0 the emitted term is identically zero, and the older proxy runs instead (*The retired proxy*, below).

`sun` here is the sun's colour as the leaves receive it (*The leaves take the cosine*, below), and the sun path `A_L` walks is the beam's (*One sun per camera*).

## Conservation is the telescoping sum

Write `Q_L = Π_{M≤L} t · Π_{M>L} tb`: the layers up to `L` pass the true light, the ones above it only the beam. Then `Q_L − Q_{L−1} = thr_L·(t_L − tb_L)·A_L` exactly, and summing over the layers:

> `Π tb + Σ_L thr_L·(t_L − tb_L)·A_L = Π t`

**Law: beam plus emitted equals the total transmitted, for any `d`**, per channel and per ray. That is exact per **column**, every tap at one plan point with the sun straight down the ray, and the leaf-level balance is exact with it: a leaf sends down precisely what its beam lost.

## What the books say

What the *floor* receives is a statement about where that light goes, and it holds in a weaker, honest form.

**No light is made or lost globally.** Over a floor of unbounded extent every ray's light from a leaf lands somewhere, so the fill holds what the leaves send down: summed over the plane, beam plus fill is the total without the split, and the bottom layer's received light equals its emitted light, because a ray from the floor crosses the layer at a shifted point and a shift moves nothing on a torus.

**Above the bottom layer it is a band, not an identity.** The hemispheric descent through the layers below an emitting leaf differs from the ballistic one the beam's column takes, by the canopy's clumping: a twig hangs leaves into every layer over the same plan point, so a sun-aligned column and a cosine-weighted hemisphere see different transmittance. The difference goes both ways, and **that is physics, not a leak**. With independent layers the floor-averaged identity holds in expectation; a real grove is not independent. The measured bands, per look, are in [`../evidence/measurements.md#fill`](../evidence/measurements.md#fill); the energy bounds as a requirement are [`../contracts/conservation.md`](../contracts/conservation.md).

## What a frame shows is displacement

Two frames side by side can seem to show light created: a glow under the crown that the beam's missing light was not under. The beam's deficit sits where the sun throws it (down-sun of the leaves for a standing tree; straight under them in the endless park, [`transport.md`](transport.md)), and the leaves' light is spread by the hemisphere over the floor beneath them. So a frame shows the glow in one place and the shadow in another: the same energy in two places, which the eye reads as an addition. On a sparse canopy it is also small. Most of the floor's light is gap light, and the split changes the leaf-lit part of the frame, not its level.

## Energy is structural

`T_sky ≤ 1` and `S ≥ 0`, by construction, with no clamp anywhere. On the split path, the emission is bounded by the identity above: what the leaves send down is what the beam lost. On the proxy path, `S ≤ fill_scatter·(1 − T_sky)·sun` per channel, by the sky view's own telescoping bound (`Σ thr·(1 − t) = 1 − Π t`, `ŝ ≤ 1`, `A ≤ 1`). Because the fill and the sky view run one ray, that is one bound, not two.

The average over rays is a true average: K rays that each see an open sky give exactly 1. An open sky is exactly bright for any K.

## The quadrature

**Approximation:** K fixed rays estimate the continuous hemisphere. `fill_directions` is K, 16 by default.

The rays are **fixed and cosine-weighted.** A cosine-weighted pdf makes cos²θ uniform, so the hemisphere is cut into K strata of equal measure in cos²θ, and each ray sits at its stratum's midpoint:

> `θ_k = acos √(1 − (k + ½)/K)`,  `φ_k` by the golden angle,  weight `1/K` each.

Nothing is random, so a frame is the same frame ([`../contracts/determinism.md`](../contracts/determinism.md)).

**Interleaved over a 4×4 tile.** If every texel integrated the *same* K directions, neighbouring texels would hit correlated leaves; any average over texels would still be only K directions' worth of noise, and its bilinear read would show facets at the scale of decimetres. So each texel takes its own rotation of the set by its slot `b` (0..15) in a fixed 4×4 Bayer ordering:

- azimuth rotated by `2π·b/16`;
- cos²θ shifted by a sub-stratum, `(15 − b + ½)/16 − ½` of one stratum, always inside its stratum, so θ stays below 90°.

The 16 texels of a tile together hold `16·K` directions, with cos²θ at exactly the `16·K` stratum midpoints. The slot is a pure function of the texel's position (its column and row modulo 4), fixed and never time-varying; each texel's weights are still `1/K`. Other orderings of the slots were tried and none did better ([`../evidence/dead-ends.md#fill`](../evidence/dead-ends.md#fill)).

The angles are computed once, in double precision, and only rotated per texel. A ray's plan shift is `tanθ·h`, tens of metres near the horizon, so a loosely computed sine or cosine would move a tap by more than a leaf's edge ([`../evidence/dead-ends.md#fill`](../evidence/dead-ends.md#fill); where it is computed is [`../implementation.md`](../implementation.md)).

## Jensen is a law of the bake

**Law:** the sum is over **transmittance**. Each ray's product is taken at the ray's own taps, and the K products are what get averaged. Never a mip or a blur of the layers' optical depth: that would turn a gappy canopy into a uniform veil and underestimate the fill. A stack half open per layer passes far more than `e^(−mean τ)`.

The one place an average over texels appears is the receiver reading the fill's *own output*, and that is the same law, not an exception. `T_sky` is already a transmittance and `S` a radiance, so a box average of them is more rays' worth of the same mean. It is needed because K rays point-sampled per texel are an *estimate*: smooth at crown-gap scale, a leaf-scale pattern ray by ray, and a plain bilinear read of that estimate shows a regular lattice at the texel pitch.

A 4×4 box is exactly one tile's `16·K` directions. The receiver reads the **8×8 box: four tiles**. A single-tile box still shows independent noise per box, reconstructed at the box pitch; the four-tile read is cleaner for the same cost ([`../evidence/measurements.md#fill`](../evidence/measurements.md#fill)). What it blurs away is small, because crown gaps are metres, and it scales with the texel, so `fill_resolution` is the one spatial knob.

## The fill's resolution

`fill_resolution` is the fill's size, in texels per side, over its frame (*The box is not the world*, below): 256 by default. The fill varies at the scale of crown gaps, not dapples, so it is much coarser than the cast. Its cost scales linearly in K and with the square of the resolution, and is paid at each bake.

## The box is not the world

A hemisphere ray from a floor point leaves the canopy box within a few metres of height; a ray at 60° from an 8 m layer travels 14 m sideways. So a box is never the whole of what a floor point sees, and a fill bounded by the box, with its border repeated to the horizon, loses much of the glow that spreads beyond it ([`../evidence/dead-ends.md#fill`](../evidence/dead-ends.md#fill)). **Law:** the domain follows whether the look has a beam bulk shift, the flag that already separates the endless park from a standing tree or a receiver scene ([`transport.md`](transport.md)).

- **The endless park wraps.** Its box is one period of an endless field. The fill reads its hemisphere with the layers wrapped: light leaving one side enters from the other and there is no border to repeat. The fill's frame is the box, and its two terms repeat at the receiver too, so a wide or panned view sees the same endless field in its shade as in its dapples.
- **The finite tree is open, over a padded frame.** Outside its box there is open sky: no leaves, nothing to glow. The fill is baked over the box grown by **3·`h_max`** on every side, `h_max` the canopy's top height, and `fill_resolution` counts texels over *that* frame, so a texel is coarser there. The receivers read the fill by its own frame, never the canopy's. The glow then decays across the floor instead of plateauing at a border.

**Law of the padding:** a cosine-weighted ray travels beyond `3h` sideways when `tanθ > 3`, that is when `cos²θ < 1/10`, and because cos²θ is uniform that happens with probability **10 %**. That tail, for a leaf at the very edge of the box, is what the padding gives up; over a whole finite look it is a few percent of the leaves' light ([`../evidence/measurements.md#fill`](../evidence/measurements.md#fill)).

The fallen-leaf carpet lies over the same frame and is lit by the same shade as the floor beside it ([`season.md`](season.md)).

## One sun per camera

**Law:** the sun path the fill's `A_L` walks is the **beam's**: zero lateral throw in the endless park, the real throw for a standing tree and for the cloth. The shared ray takes it as an argument. The sky view, which has no beam, passes the direction it looks at.

In an endless field a lateral sun direction makes no difference to anything the beam can see ([`transport.md`](transport.md)), so there is nothing for the fill to pay for. Lighting the park's leaves along the real sun while its beam has no shift would be a second sun, and it broke the books: the fill emitted more than the beam lost ([`../evidence/dead-ends.md#fill`](../evidence/dead-ends.md#fill)). José's reason is the whole of the argument: *"I welcome optimizations for stuff that makes no difference."* With one sun per camera, summed over one period of the park, the light the fill emits equals the light the beam gave up.

## The leaves take the cosine

The sunlight a leaf scatters down is lit by the leaf's own incidence, and the leaves are near-horizontal, so `S` is made with the sun's colour scaled by the floor's `sin el` under the cosine law:

> `sun_S = sun · mix(1, sin el, sun_cosine)`

whatever camera reads `S`; `T_sky` is the skylight and keeps its level. Why the split would otherwise stop conserving is [`light.md`](light.md)'s.

## The receivers

**The floor.** The shade is a *share* of one fixed quantity, never an addition:

> `amb = mix(ambient, ambient·T_sky + S, canopy_fill)`,  then  `(acc·sun + amb)·ground`

At `canopy_fill` 0 this is the floor without the fill; at 1 the shade is lit entirely through the canopy. `canopy_fill` is the share; 1 is physical.

**The cloth and the tent.** Both read the fill at the point's plan position, through the same `canopy_fill` share, and both read `S` too once the split is open, because with the beam going dark a receiver that took `T_sky` alone would lose every watt the leaves gave up:

> `E = acc·sun·beamF + (ambient·T_sky·skyF + S·skyS)`

`S` is hemispherical light like the sky, so it goes through the panel's view of the hemisphere:

- the tent: its own `skyF`, so `skyS = skyF`;
- the curtain, a vertical plane that sees half the hemisphere: **`skyS = 0.5`**. That is a factor of its own, because the curtain's *sky* term keeps the floor's `skyF = 1`, the convention it was authored under. The choice of 0.5 comes from the cloth's real hemisphere, half canopy and half ground.

With the split shut (`leaf_diffuse` 0) the cloth and the tent read `T_sky` and no `S`; the proxy's `S` is the floor's alone. The beam that still gets through the gaps is most of the cloth's light; the leaves' diffuse light adds a little ([`../evidence/measurements.md#fill`](../evidence/measurements.md#fill)). The cloth's and the tent's own laws are [`receivers.md`](receivers.md)'s.

**The sky view** reads nothing of the fill. It splits the same leaf on its own terms: one eye ray where the fill averages a hemisphere, and what it shows is the glow itself, not a floor's share of it ([`sky-view.md`](sky-view.md)).

## The gate

`canopy_fill` 0 is the floor without the fill, and nothing of the fill exists or runs; off, the picture is unchanged ([`../contracts/preservation.md`](../contracts/preservation.md)). The default is 0; a look opts in with `canopy_fill` 1. `montebello`, `montebello, rain`, `the yellow tree` and `cherry blossom` open it.

`canopy_fill` tweens in a transition, so crossing 0 mid-transition is continuous. `fill_directions` and `fill_resolution` are tuning knobs, integers that cannot interpolate, and halving either is a safe cut. The quality rung and the feature a bundle may cut are in [`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md).

## When the fill is made again

The fill is a function of the layers, the sun's colour and its path through them, and the leaf's law. **Law:** it is made again whenever any of those move: after every layer bake (every frame under wind), and on its own when the sun or the sky moves without a bake (a time-of-day morph, a dragged sun), because `S` reads the sun's colour, which the sky's turbidity moves. It is also made again when a knob that changes what `T_sky` or `S` are made of tweens without moving the layers: `leaf_diffuse`, `edge_area`, `sun_cosine`. On the faithful path the cast is re-cast on a change of the leaf's law too, because each stamp has that law baked in. A knob assigned on a running engine must show the frame an engine born with it shows ([`../contracts/determinism.md`](../contracts/determinism.md)).

## The faithful path

The faithful cast taps one pre-integrated shadow, not depth layers ([`canopy.md`](canopy.md)). With the fill open it keeps a **low-resolution layer set** alive for the fill alone, sized by `fill_resolution`, with the layers at the heights their twigs really grew to (the mean grown height of each depth bin, not the park band the faithful cast ignores) and the faithful sway rule, in which sway grows with height. This does not reopen the faithful opt-out: depth layers are the right tool for a *diffuse* quantity, and the opt-out is about sharp structure.

## The retired proxy

Before the leaf's diffuse share was measured, the leaves' scattered sun was an authored stand-in:

> `S = fill_scatter · (1/K) Σ_k Σ_L thr_kL · (1 − t_kL) · ŝ_kL · sun · A_kL`

`fill_scatter` is a single-scattering albedo, the floor's twin of the sky view's `sky_scatter`. `ŝ` carries the colour, so `fill_scatter` is the peak-channel albedo, and values of 0.1–0.25 sat right. They sat right only against a beam that was already carrying the transmitted light as sun-images: the proxy conflated reflectance with transmittance. A leaf reflects little but passes a great deal, and what it passes diffusely is what `leaf_diffuse` now measures.

**Law:** with `leaf_diffuse` above 0 the proxy is off and `fill_scatter` is inert, or the same light would be counted twice. At `leaf_diffuse` 0 the proxy runs as it always did; `fill_scatter` 0 leaves the shade as filtered skylight alone. How a transition crosses between the proxy and the split is [`../contracts/transitions.md`](../contracts/transitions.md)'s.

## What authors should expect

At `canopy_fill` 1 the shade **dims and takes the leaves' colour**: greener in summer, redder in fall, instead of staying sky-blue, and it does so everywhere under a canopy. A look that opens it has to be re-sat: about **half a stop** more `ambient_skylight` or `exposure`, or some light put back with `fill_scatter` on the proxy path.

## Approximations and limits

- **Approximation — a flat sky.** The sky is one radiance with no gradient, so `ambient = π·L_sky` exactly. Shared with [`sky-view.md`](sky-view.md).
- **Approximation — K fixed rays.** They estimate the continuous hemisphere. The interleave spreads 16·K directions over each tile, and the receiver's four-tile read filters the leaf-scale residue; `fill_directions` trades the residue for cost.
- **Approximation — single scatter.** A leaf's emitted light passes the layers below on their true `t` and is not scattered again; no ground bounce.
- **Approximation — no wood in the hemisphere.** The woody occluder takes the beam only; a limb's share of the sky is thin. The sky view, which looks at the tree, reads the wood.
- **Approximation — the padded frame's tail.** On a finite tree, the light that travels beyond 3·`h_max` is given up: 10 % of a cosine-weighted leaf's light at the very edge of the box, a few percent of all of it.
- **Approximation — the fill is baked at floor height.** A point high up the cloth reads the hemisphere of the floor point beneath it.
- **Approximation — the cloth's hemisphere is half ground.** A vertical cloth sees half canopy and half ground; the piece has no ground-bounce term for that half, and the curtain's `skyS = 0.5` is the canopy half.
- **Approximation — the faithful path's low-resolution layers.** They are drawn from the faithful cast's packed cluster data, so a twig's synthetic joint stands in for its grown one under wind. Exact at rest; a diffuse quantity does not see the difference.
- **Approximation — the fill's resolution.** The fill varies at crown-gap scale; the receiver's read blurs anything finer, by design.
- **Authored — `fill_scatter`.** The retired proxy, live only at `leaf_diffuse` 0.
- **Authored — `skyS` for the curtain.** 0.5 is chosen from the cloth's hemisphere, not measured.

## Related

- [`leaf.md`](leaf.md): the texel mixture law, `T` and `T_b`, the diffuse share and the neutral depth.
- [`sky-view.md`](sky-view.md): the eye ray that runs the same shared ray, the canopy glow, why the skylight is not a source.
- [`transport.md`](transport.md): the beam `acc`, the bulk shift, the endless park and the standing tree.
- [`light.md`](light.md): the cosine law, the sun's colour, the sky's level.
- [`receivers.md`](receivers.md): the floor, the curtain and the tent that read the fill.
- [`canopy.md`](canopy.md): the depth layers and the faithful cast.
- [`season.md`](season.md): the carpet over the fill's frame; why fall shade is warm.
- [`../contracts/conservation.md`](../contracts/conservation.md): the energy bounds and the books as requirements.
- [`../contracts/preservation.md`](../contracts/preservation.md): what the shut gate owes.
- [`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md): the quality rung and the feature cut.
- [`../evidence/measurements.md#fill`](../evidence/measurements.md#fill) and [`../evidence/dead-ends.md#fill`](../evidence/dead-ends.md#fill): the numbers and the first attempts.
