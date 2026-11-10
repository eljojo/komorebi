# The source

*The sun as the piece models it: a half-degree disk, smeared by cloud into an aureole, sampled as a fixed cloud of weighted point-suns. Every soft thing on the ground descends from it.*

## The sun is not a point

**Law.** The sun's disk subtends roughly **half a degree**, about **1/100 of a radian**; its half-angle is about 0.27°. A point source would throw razor-sharp shadows. An extended source cannot. Every softness in komorebi, every penumbra and every round dapple, comes from this one fact, and the piece never adds softness from anywhere else.

## The dapples are images of the sun

**Law.** Most of the bright shapes on the ground are not the shapes of the gaps between the leaves. They are **images of the sun**.

Each small gap in the canopy is a **pinhole camera**. When the gap is small against its height above the ground, it stops projecting its own shape and projects a picture of the light behind it, and that light is the sun's disk. The soft roundish dapples are little suns, hundreds of them, overlapping.

The proof is the partial solar eclipse: when the sun becomes a crescent, **every dapple on the ground becomes a crescent too**. The shapes track the source, not the holes.

There are **two regimes**, set by the gap's size `a` against the blur scale `h·θ` (the gap's height times the sun's angular size):

- **Pinhole regime** (`a ≪ h·θ`): the gap's own shape washes out and the ground shows a clean image of the sun.
- **Shadow regime** (`a ≫ h·θ`): the ground shows a bright patch shaped like the gap, bordered by a penumbra of width about `h·θ`.

Under a canopy about 10 m up, `h·θ ≈ 10 cm`, which is why typical dapples are fist- to plate-sized and inescapably soft.

## Blurriness is the source, not focus

The two regimes are one operation, a **convolution**:

> ground illuminance = (sharp gap map) ⊛ (the source's angular brightness profile, scaled to the ground by height)

The blur kernel *is* the source, scaled by each occluder's height. Both regimes fall out of it without being asked for.

**Law.** There is **no focal plane** here and no plane of best focus. A pinhole has no focus. The out-of-focus quality of the afternoon is not a focal-distance effect: sharpness is set entirely by how large the source looks and how large the gap is. Nothing in the piece models a focal plane, and nothing should.

How the convolution is computed (one sharp shadow per point-sun, each shifted by height times angle, summed) is [`transport.md`](transport.md)'s account. The source's job ends at the list of suns.

## Cloud turns the blur knob

On a clear day the source is the bare half-degree disk: a crisp kernel, dapples as sharp as the canopy allows. When **thin cloud** drifts across, its droplets scatter the sunlight and smear the source into a bright **aureole** many degrees wide. The kernel fattens and every dapple bloats and softens. **Thick cloud** takes this to the limit: the source grows toward the whole sky, the kernel becomes enormous, and the pattern dissolves into flat shade.

So the focus breathing in and out under drifting cloud, the thing the afternoon was about, is **the size of the light source changing over time**, and nothing more. `cloud_thickness` is that size, and it is the most expressive knob in the piece.

### What cloud does to contrast

Two felt qualities come from the same mechanism, which is why the afternoon read as an old prime lens:

- **Contrast sag.** As the source widens, each dapple's light spreads over a larger spot, so its peak dims, while the dark gaps fill with light arriving from the wider source, so the shade lifts. The total light the sampler carries is unchanged (its weights always sum to one), so sharpness and contrast fall *together*, the veiled, glowing look of old uncoated glass. No contrast control is involved: the sag is the convolution's own.
- **The bokeh duality.** In a camera, an out-of-focus point of light renders the shape of the *aperture*; that is why bokeh balls take the iris shape. Komorebi is the inverse: a small gap renders the shape of the *source*. Camera bokeh shows you the hole; komorebi shows you the sun. Cloud, by inflating the source, pushes the pattern harder into the regime where what you see is the source.

## The sampler

The source is **not "a light"**. It is a **cloud of weighted point-suns**: a list of (angular offset, weight) pairs, the area light written as the samples that integrate it.

**Two populations**, matching the physics:

- a tight, heavy **core**, the half-degree sun, carrying most of the energy;
- a sparse, wide, low-weight **halo**, the cloud's aureole, an annulus around the core.

**The pattern is a Vogel (sunflower) spiral**: successive points turn by the golden angle and step outward by the square root of their index, so each population covers its disk or annulus evenly by area, with no clumping and no banding. Half the samples (at least three) form the core disk; the rest form the halo annulus from the core's edge outward, its spiral started at a fixed angular offset from the core's. Each sample in a population carries an equal share of that population's weight.

**The cloud knob moves energy and spreads the halo.** With cloud thickness `t` from 0 to 1:

- the core's weight is `core_weight_fraction · (1 − t)`, and the halo takes the rest, so the weights always sum to one;
- the halo's outer radius runs from twice the core's radius in clear sky to `halo_angular_radius_deg` under full cloud.

Clear, almost everything is in the core and the halo is a thin ring around the disk; overcast, the core is drained and the halo is wide. Peak dims, total light is held, contrast sags: the breathing above.

**The knobs.** `sample_count` (the samples per frame; between 16 and 48 holds the piece at frame rate, and 48 is the most it takes), `core_angular_radius_deg` (the sun's half-angle, 0.27° for the real sun; a look may widen it on purpose), `core_weight_fraction` (the core's share in clear sky), `halo_angular_radius_deg` (the aureole's extent at full cloud) and `cloud_thickness`.

### Purely angular, purely circular

**Law of the separation.** The source is a set of angles on a circle and nothing else. It never knows the ground is tilted, where the sun stands in the sky, or what the light lands on. The elliptical stretch of a low sun's dapples belongs to transport, which turns each angular offset into a ground offset through a small matrix built from the sun's elevation and azimuth ([`transport.md`](transport.md)). The source stays a clean circle; the two never tangle.

### Frame-stable

**Law.** The samples are **fixed**: the same offsets and weights every frame for a given source. If they jittered from frame to frame they would produce a numerical shimmer, and sampling noise would impersonate the physical glisten of the afternoon. All visible motion comes from the canopy; none from the math. The sampler changes only when its own inputs change (the cloud, the radii, the sample count, the eclipse). The contract is [`../contracts/determinism.md`](../contracts/determinism.md).

## The eclipse

The eclipse is a **property of the source**, not a trick of the ground. Turned on (`eclipse`), a moon disk the size of the sun's core is laid over the source, offset from its centre by an amount `eclipse_amount` sets (more is a deeper bite). Every point-sun inside the moon loses its weight; what remains is a crescent, and the remaining weights are renormalised to sum to one. Transport needs to know nothing: every pinhole in the canopy images the crescent, and every dapple on the ground becomes one. It is the proof of [the second section](#the-dapples-are-images-of-the-sun), run as a look (`eclipse`, with a tiny crisp source and no cloud, so the crescents stay sharp).

**Law.** A real eclipse dims the light by the share of the disk the moon covers, and each crescent stays as bright per area as the clear sun's disc: every point of it still sees uncovered sun. The sampler drops the covered samples and keeps the rest at their own weight, and the seen source keeps its radiance over the uncovered disc. Until 2026-11-10 the sampler renormalised, so the crescents kept the clear sun's total and the dimming was left to exposure; the lines that did it are in the comment at the sampler (`komorebi-source.js`), to bring it back as a look's choice.

## The source, seen

In the sky view, where the eye looks up through the canopy, the source is in frame for the first time, and it is **the sampler's own**: a core disk and a halo annulus, each at the radiance its weight over its own solid angle gives, with the same moon punched out in the same orientation the dapples image it at. So cloud drains the seen disk into the aureole by exactly as much as it softens the dapples, and an eclipse shows the crescent itself, through the leaves, throwing crescents. Because the sampler's halo is flat, the seen halo is flat too. The account is [`sky-view.md`](sky-view.md).

## The source in a transition

Between looks that cannot morph, the source is the cover: the transition swells the cloud toward overcast and widens the halo, so the pattern dissolves into soft shade while the grove changes beneath it, then tightens again. That use of the source belongs to [`transitions.md`](transitions.md).

## Approximations and limits

- **Approximation: a finite sample of the source.** The disk and aureole are integrated by a few dozen point-suns, not continuously. Every soft edge is a sum of that many sharp shadows; the sample count is the knob, and its trade against cost is **Open** (below).
- **Approximation: a flat aureole.** A real aureole falls off steeply away from the sun. The sampler's halo carries uniform weight per area across its annulus. The exact split and falloff of a true cloudy source are **Open**.
- **Approximation: cloud as source width alone.** Cloud here only redistributes the source's light; it never removes any. A real thick cloud also dims the beam, and whatever dimming a look wants is carried by its exposure and its skylight ([`light.md`](light.md), [`camera.md`](camera.md)).
- **Law, held: no focal plane.** Any future depth-of-field idea is a departure from the optics, not an extension of it.

## Open

- How many samples a look needs against what it costs, and the exact core/halo split and falloff of a cloudy source profile. Recorded in [`../exploration/open.md`](../exploration/open.md).

## Related

- [`transport.md`](transport.md): the many-suns accumulation, the ellipse, the shift by height.
- [`light.md`](light.md): the beam's colour and how it lands; the leaf-edge diffraction that splits the source per wavelength.
- [`sky-view.md`](sky-view.md): the source seen.
- [`transitions.md`](transitions.md): the cloud bloom as transition cover.
- [`../contracts/determinism.md`](../contracts/determinism.md): frame-stability.
- [`../experience.md`](../experience.md): the breathing focus the source exists to make.
