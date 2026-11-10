# Light

*The light's colour and how it lands: what the atmosphere does to the beam and the sky, the cosine by which the beam meets a surface, what the eye does to the shade at dusk, how autumn turns the dusk law over, and how the leaf edges split the spectrum.*

Everything here is computed in **linear HDR**, upstream of exposure and the tone curve ([`camera.md`](camera.md)). Light is a quantity until the very end of the picture, and only then a colour.

## Three bands

The piece carries light in three bands, red, green and blue, centred at **620, 555 and 470 nm**. The atmosphere, the leaves' transmittance and the leaf-edge diffraction all speak these same three wavelengths, so a ratio between them is grounded rather than invented.

## The atmosphere: warm light, cool shade

**Law, in an approximation.** As the sun lowers, its beam crosses far more air and reddens; the skylight that fills the shadows stays blue. A low sun therefore reads as **warm light on cool shade**. Two mechanisms, modelled from `sun_elevation` by a cheap three-band Beer's-law atmosphere:

- **The beam reddens.** The path length is the **air mass**, by **Kasten–Young**, not `1/sin el`, which diverges at the horizon. Along that path **Rayleigh scattering** (∝ λ⁻⁴) strips the blue and green first, so the disk warms white → gold → orange → red. Ozone and aerosol extinguish it further.
- **The sky stays blue.** The skylight is the Rayleigh-scattered light, carried through the same ozone and aerosol. The ozone **Chappuis band** absorbs red from that scattered light, so the shade's fill stays blue into the evening: the blue hour.

**`sky_turbidity`** is the aerosol load β (Ångström): more haze reddens the low sun further and desaturates a hazy dusk.

Near sunset a share of the warm beam's colour bleeds into the sky's, so the sky warms toward dusk rather than staying a pure Rayleigh blue.

The atmosphere gives two colours: **the sun colour**, the beam's, and **the sky colour**, the skylight's. They are distinct mechanisms that compose. The **green** of the shade is neither: it is beam and skylight that passed *through* the leaves, collectively, summed over thousands of lit leaves each sending its own colour down ([`leaf.md`](leaf.md), [`fill.md`](fill.md)). The blue is the skylight. Under a canopy you see both, green wash and cool fill, and they are not the same thing.

### Hue, not level

**Approximation, named.** The atmosphere normalises the beam to its strongest channel, and the sky to its own: it sets the **hue** of each, and **exposure** carries brightness. The beam's broadband loss to the air, which is what really makes a low sun dim, is divided out unless a look puts it back ([The air's loss](#the-airs-loss)); the sky's own fall in brightness at dusk is divided out always. See [Approximations and limits](#approximations-and-limits).

**`ambient_skylight`** scales the sky's level against the beam. It is an **authored** level, an irradiance onto a surface, and it does not fall with the sun.

## The cosine law of the receiver

**Law.** Irradiance on a surface is the beam's radiance times the **cosine of its incidence**. The atmosphere above models the beam's spectrum and not its geometry, and without this law a floor under a 12° sun reads as bright as one under a 70° sun. The transport's ellipse cannot fix that: it stretches each dapple, but what transport builds is the *fraction* of the sun's disk that cleared every occluder, so energy never thins however far the image stretches ([`transport.md`](transport.md)). The conserving belongs to the **receiver**.

Radiance is invariant along a ray, so the sun **seen** takes nothing; every surface takes its own incidence `I`, a pure function of the sun's elevation and azimuth, from the same sun vector every camera uses, and unclamped in elevation (a 2° sun lands `sin 2°` on the floor, whatever floors the throws use):

| camera | surface | `I` |
|---|---|---|
| floor | horizontal | `sin el` |
| enclosure (the tent) | each panel | `sin el` at the crown; each panel multiplies that by its own incidence relative to the horizontal, within that factor's two limits ([`receivers.md`](receivers.md)) |
| cloth (the curtain) | vertical | `cos el · \|sin az\|` |
| sky view | none | `1` |

The vertical cloth's incidence does the opposite of the floor's: it **peaks** as the sun lowers head-on toward the window. This table is the one place the law lives.

The beam that lands is

> beam = `acc · sun colour · mix(1, I, sun_cosine)`

where `acc` is transport's cleared fraction. It is **normalised to the zenith**: a 12° floor is `sin 12°` = 0.208 of a zenith one and a 70° floor 0.940, so 70° is ×4.52 brighter than 12°.

**It scales the beam and nothing else.** The factor multiplies the sun colour that feeds each receiver's beam, before any surface reads it; on the floor, the cloth and the tent that colour feeds the beam alone. The **skylight** is not a beam and keeps its level.

**The leaves take the cosine too.** The sunlight a leaf scatters down is lit by the leaf's own incidence, and the leaves are near-horizontal, so the leaves' scattered sun takes the floor's `sin el` under `sun_cosine`, whichever camera reads it. Otherwise the beam the leaves remove would reappear undimmed in their scattered light, and the split between beam and fill would stop conserving energy ([`fill.md`](fill.md)).

### Exposure is the free constant

There is **no per-look normaliser**, because the free constant already exists and is called `exposure`. A normaliser would be exposure folded in. A look that turns the law on **re-sits its exposure**: `exposure / I` holds the dapples' linear level and lifts the shade by `1/I`, about ×2.3 at a 26° sun. Nothing else folds a constant in for it ([`camera.md`](camera.md)).

### The knob

`sun_cosine`, 0 to 1. At 0 the factor is exactly 1 and the picture is the old one; the default is 0. Most shipped looks carry the law with their exposure re-sat, and some keep the old law as an authored departure; which is which is recorded in [`../contracts/looks.md`](../contracts/looks.md#the-cosine-law). An interior value is the law under a higher sun, which a real sun does give, so the blend is honest; still, **author only 0 or 1**. It tweens in a transition, where the dapples move straight from one end's level to the other's ([`transitions.md`](transitions.md#live-morph)). The haze macro's exposure stops are authored for the old law and are re-sat by the look's own factor when it carries the law.
One test of the law against José's photographs of bare ground under a low and a high sun misses the photographed lit-to-shade ratio, and the cause is the authored level of the skylight, not the law; the measurement is in [`../evidence/measurements.md#light`](../evidence/measurements.md#light).

### The air's loss

**Law, carried by the looks that choose it.** A low sun is dim because its beam crosses more air, not only because it lands at a slant. The atmosphere's hue keeps the colour of that loss and divides out its level; `sun_extinction` puts the level back. At 1 the beam takes its brightest channel's transmittance against the zenith's, at the look's own turbidity: about 0.99 at 70°, 0.92 at 45°, 0.78 at 26°, 0.49 at 12° and 0.22 at 6°, so with the cosine law a 12° floor is ×9.1 under a 70° one, not ×4.5. It scales the beam and the leaves' scattered sun together, as the cosine does, so the split between beam and fill still conserves; the seen disk takes none. The default is 0, the old beam exactly.

It is not every look's law. On the artist's sheet it made some low suns scarce and amber in a way that read as evening, and turned others, the lowest suns above all, to mud; it is carried where he chose it ([`../contracts/looks.md`](../contracts/looks.md#the-airs-loss)). A look that carries it either holds its exposure, so its evening is darker, or re-sits it by the loss as it re-sits the cosine. Transitions treat it as part of the beam's factor ([`transitions.md`](transitions.md#live-morph)).

## The Purkinje shift: the eye cools the shade at dusk

**Law of perception, amplified by a knob.** As the light fails, the retina's rods take over from the cones (**mesopic** vision). Rods are colour-blind and peak in the blue-green, near 505 nm, so the dim areas **desaturate toward a blue-grey** and **saturated reds darken first**, while anything still bright, the dapples, stays in cone vision, warm and coloured. It is a fact of perception, not of the light, but it is real and modelable, so it earns its place over a hand-grade: the route to "twilight is cool and soft", modelled rather than painted.

The piece has no absolute luminance, so the shift is driven by two honest cues, multiplied:

- a global **duskness**, ramped from `sun_elevation` (a low sun is a dim world), zero for a daytime sun;
- the **local** shade darkness, read from `acc`, the exposure-independent transmittance at that point.

Only the deep shade between the suns goes cool; the suns themselves are untouched, and the deepest shade keeps a hint of its green. `mesopic_strength` sets how far. In the sky view `acc` is the eye ray's own transmittance, still "how much of the light got through here", so the same hook reads the canopy's density there ([`sky-view.md`](sky-view.md)).

## Autumn turns the dusk law over

At dusk the beam warms and the shade goes blue. In autumn **the sun-images stay white-gold and it is the shade that turns**, gold, orange, red, because the colour lives in what the leaves transmit, not in the light that reaches them: **warm light on warm shade**. That includes the shade's own skylight: with the canopy fill open it too has to come through the leaves, so the shade takes their colour instead of staying sky-blue under a red beam. Why the leaves turn and in what order is [`season.md`](season.md); how the fill carries their colour is [`fill.md`](fill.md).

## The colours split at the edges: leaf-edge diffraction

Through some lenses the bright and dark edges fringe, the red and blue of a highlight splitting apart. That split has an honest home here. The dapples are pinhole images formed at the gaps, and at every **leaf edge** the light **diffracts**, bending around the obstruction by an angle that grows with wavelength, **θ ∝ λ**. Red spreads the most, blue the least, so the red image of the sun is thrown a touch wider than the blue, and the two no longer land on top of each other.

On the ground: **every dapple gains a warm outer rim and a cool core**, and the penumbra between a sun-image and the shade breaks into a faint spectrum. It is a consequence of a real cause, never a prism painted over the picture.

It composes with everything else without being asked to. The split is a per-wavelength change in the **angular** offset of the source, so it rides the same height × angle shift that carries light to the ground: higher foliage fringes more, because its images are thrown further, and a low sun, whose ellipse already stretches the dapples, stretches the fringe with them. How the three channels are read is [`transport.md`](transport.md).

**Approximation, the second named one of the optics.** True diffraction would integrate a wavelength-dependent kernel at each gap, sized by the gap. The piece instead **scales the geometric pinhole shift per channel by `λ / λ_green`**, coupling the dispersion to the geometric throw rather than to the gap's width. It earns its place as depth discretisation does: a real mechanism, absent at rest, and cheap.

**Authored strength.** `chromatic_aberration` is deliberately exaggerated above the true, roughly λ-proportional value, the way the Purkinje shift is real but amplified. At a realistic strength it is a hairline; pushed up, it is the **prism** look. At 0 the three channels collapse to one shared read and the picture is unchanged. The looks that push it up are `prism`, `morning 3b` and `acid dreams`.

## Approximations and limits

- **Approximation: three bands.** The spectrum is three wavelengths, not a continuum; the atmosphere, the leaves and the diffraction share them.
- **Approximation: extinction divided out, where a look does not carry it.** The beam is normalised to its peak channel, so on a look at `sun_extinction` 0 its broadband loss to the air is not in the cosine law: the 12°:70° ratio is the law's ×4.5, not ×9.1. Exposure carries what level a look wants. [The air's loss](#the-airs-loss) puts it back.
- **Approximation: the sky's dusk fall divided out.** The skylight is normalised the same way; the sky's own dimming at dusk is not in the model. Its level is `ambient_skylight`, authored.
- **Approximation: the sky view's leaf glow takes no cosine yet.** By the same argument as on the floor, the light a lit leaf scatters toward the eye should take the leaf's `sin el` while the seen disk must not; both read the same sun colour inside one shared ray, and separating them is not yet done. The sky view gets `I = 1`.
- **Approximation: mesopic reads `acc`.** It tracks the shade's darkness, not absolute luminance, and does not follow a floor dimmed by the cosine law.
- **Approximation: the diffraction proxy** scales the geometric throw rather than integrating a gap-sized kernel (above).
- **Authored: the Purkinje strength and the diffraction strength** are amplified beyond the physical values on purpose.
- **Authored: the skylight's level** does not fall with the sun, which is why a low sun's lit-to-shade ratio stays higher than José's photographs show.

## Not built

- The leaf's cosine on the sky view's glow, with the seen disk exempt (see the approximation above); detail in [`../exploration/open.md`](../exploration/open.md).

## Related

- [`source.md`](source.md): the disk and aureole whose light this colours.
- [`transport.md`](transport.md): the ellipse, and the per-channel reads of diffraction.
- [`fill.md`](fill.md): how the skylight and the leaves' scattered sun reach the shade, and why the scattered sun takes `sin el`.
- [`receivers.md`](receivers.md): each surface's incidence, the tent's per-panel factor.
- [`camera.md`](camera.md): exposure and the tone tail, downstream of all of this.
- [`season.md`](season.md): why the shade turns in autumn.
- [`sky-view.md`](sky-view.md): the source seen; the mesopic hook along eye rays.
- [`../evidence/measurements.md#light`](../evidence/measurements.md#light): the ride-photo test of the cosine law.
