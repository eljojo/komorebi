# Conservation

*What must hold so that light is moved, divided and absorbed, but never made: the energy rules every subsystem answers to.*

The shade of a forest is lit by what the leaves gave up. If a model of that makes light out of nothing, the picture glows in a way no afternoon does, and the eye, which knows how bright shade is, reads it as wrong long before it can say why. These contracts keep the books. Most of them hold by the structure of the equations, not by a clamp: where a clamp would be needed, the model is wrong.

1. **Optical depth adds; transmittance multiplies; the bake stores depth.** Applies to every bake of leaves into depth layers. Each leaf stamps its optical depth, per channel, and overlapping leaves accumulate by plain addition, so the order in which they are drawn never matters and two leaves over one point are as dark as Beer's law says. Readers take transmittance back as the exponential of the stored depth. Why: Beer's law is not negotiable, and an order-dependent bake would make a leaf's darkness depend on the list it was drawn from. Owner: [`model/canopy.md`](../model/canopy.md).

2. **Light is averaged as transmittance, never as depth.** Applies to every place where light through the canopy is integrated over an area or a set of directions: the fill's hemisphere, a texel at a leaf's edge, a mip of the fill's output. Each ray's product of transmittances is taken at its own taps and the products are averaged; a blur or mip of optical depth is never read as light. A texel is read as a mixture of a representative leaf and a gap, reconstructed from its stored depth and coverage, not as a uniform slab. Why: the mean of an exponential is not the exponential of the mean, and averaging depth turns a gappy canopy into a uniform veil that passes too little light. Owner: [`model/fill.md`](../model/fill.md) for the hemisphere, [`model/leaf.md`](../model/leaf.md) for the texel.

3. **A split is never an add.** Applies to every mechanism that divides one quantity of light between two routes. Each is a mix of one fixed quantity, so the parts sum to the whole:
   - the leaf's **ballistic and diffuse shares**: what a leaf passes is divided between a beam that keeps travelling and a diffuse share that leaves in every direction; the beam sees only its share, as a neutral depth added to the leaf's own ([`model/leaf.md`](../model/leaf.md));
   - the fabric's **forward-scatter wrap**: the cloth's transmitted light is a mix of a ballistic band and a softer scattered band, never the band plus a glow ([`model/receivers.md`](../model/receivers.md));
   - the **lateral diffusion** on a cloth: the frame is mixed with a normalised blur of itself, which moves light between points and makes none ([`model/receivers.md`](../model/receivers.md));
   - the fill's **ambient term**: the light reaching shade is a share between the bare skylight and the canopy's own fill (`canopy_fill`), of one fixed quantity, never the skylight plus the fill ([`model/fill.md`](../model/fill.md)).

   Why: an add is the easiest way to make a picture brighter and the surest way to make it dishonest; a mix can only redistribute what landed.

4. **Beam plus emitted equals total transmitted, per column.** Applies wherever the diffuse split is open (`leaf_diffuse` above 0), on every camera that reads it: the fill's rays and the sky view's eye rays. Along any one column of layers lit along that column, the ballistic light that gets through plus the light each layer emits and the layers below pass on equals what the whole stack transmits:

   > `Π tb + Σ_L thr_L·(t_L − tb_L)·A_L = Π t`

   per channel, for any share `d`, by a telescoping sum. A leaf sends down exactly what its beam lost; at `d = 0` the emitted term is identically zero. Emission is defined as `t − tb`, so `tb ≤ t` holds by construction and the identity cannot fail at a leaf's edge. Why: this is the leaf-level energy balance, and it is what makes the shade's colour the leaves' own rather than an authored tint. Owner: [`model/fill.md`](../model/fill.md); the sky view's reading is [`model/sky-view.md`](../model/sky-view.md).

5. **Off the column, a per-layer bound holds instead.** Applies to the sky view and to any ray that does not run along the sun. There the telescoping identity is no longer an identity and not an inequality either: a lit leaf can be seen through a leaf in front of it. What holds for any direction is that a leaf glows no more than its diffuse share of the sunlight landing on it, `0 ≤ glow ≤ Σ thr·(t − tb)·sun`, and that what the eye sees of the source through the canopy is never more than the skylight through the same canopy. Why: the bound is the physics; the identity was only ever the special case of one direction. Owner: [`model/sky-view.md`](../model/sky-view.md).

6. **The fill's books close.** Applies to the sky fill.
   - **No light is made or lost globally.** Over a floor of unbounded extent every leaf's diffuse light lands somewhere, so beam plus fill, summed over the plane, is the total the canopy transmits.
   - **On the endless park's torus, the bottom layer receives what it emits.** The park's canopy box is one period of an endless field, read with wrapping, so a shifted ray moves nothing and the balance is exact.
   - **The finite tree is open, over a padded frame.** Outside its box is open sky; the fill is baked over a frame grown well beyond the box so that the glow decays across the floor. The tail the padding gives up is a named loss, recorded in evidence.
   - **One sun per camera.** The fill lights its leaves along the beam's own sun path, so the light it adds is the light the beam removed. A second sun would break the books.
   - **The clumping band is physics, not a leak.** A hemisphere ray and a sun-aligned column see different transmittance through a clumped canopy, so what the fill holds differs from what the beam gave up by a band that goes both ways. With independent layers the floor-averaged identity holds in expectation; a real grove is not independent.

   Why: the green of the shade is collective light, and its level must be the canopy's, not the renderer's. Owner: [`model/fill.md`](../model/fill.md). The band's size is in [`../evidence/measurements.md#fill`](../evidence/measurements.md#fill).

7. **The skylight is not a source.** Applies to the fill's scatter and the sky view's glow. A leaf's scattered light is the sun's light only; the skylight's passage through the leaves is already carried by the transmittance term, so a leaf that also scattered the sky would count it twice. With the sun off, a ray sees exactly the sky through the canopy. Why: double counting lit crowns with no sun to light them. Owner: [`model/sky-view.md`](../model/sky-view.md).

8. **The leaves take the cosine too.** Applies when the receiver's cosine law (`sun_cosine`) is on. The sunlight a leaf scatters down is dimmed by the same incidence as the beam, so the light the beam loses to a low sun does not reappear undimmed in the fill. Why: otherwise the beam/fill split stops dividing one quantity. Owner: [`model/fill.md`](../model/fill.md).

9. **The fabrics transmit no more than lands on them.** Applies to the curtain and the tent. The cloth's colour is the landed light (beam and skylight together) times a transmittance `Tt·tint̂ ≤ 1`, and the skylight is counted once, inside the landed light, never added again. The velvet's bands and the wrap's softer band are each at most 1, so their mix is too. Why: a cloth that out-glows the light that reached it is a lamp, not a curtain. Owner: [`model/receivers.md`](../model/receivers.md).

10. **An incidence ratio re-bases the bound; it does not break it.** Applies to the fold incidence on the cloth and the per-panel beam on the tent. A flank turned into the sun collects more than the flat plane would, so its incidence ratio exceeds 1; the scatter split still divides one fixed transmitted energy, and what the ratio corrects is the irradiance being divided. The tent's panel beam is capped and its divisor floored so that it cannot diverge at a raking or horizon sun; both limits are named in the model. Why: a tilted surface really does collect more light, and pretending otherwise would flatten the folds. Owner: [`model/receivers.md`](../model/receivers.md).

11. **A crown radiates no more than the sunlight landing on it; wood can only darken.** Applies to the sky view. The single-scatter glow is bounded by the scatter strength times the light the stack removes, by the same telescoping sum, so a deep stack that darkens has little left to scatter. Wood is in every transmittance and in no emission, so a ray that meets only wood emits exactly nothing. Why: occlusion that is luminous stops reading as an object ([principle 6](../principles.md#6-model-what-reaches-the-eye)). Owner: [`model/sky-view.md`](../model/sky-view.md).

12. **The seen source carries the sampler's energy.** Applies to the sky view's sun and aureole. The disk and halo in frame are each at their post-cloud weight over their own solid angle, so cloud drains the disk into the aureole exactly as it softens the dapples; the eclipse's bite is renormalised analytically so the seen field carries the sampler's total. The halo is flat because the sampler's is flat. Why: the thing seen and the thing imaged on the ground must be the same thing. Owner: [`model/sky-view.md`](../model/sky-view.md), with the sampler in [`model/source.md`](../model/source.md).

13. **Cloud conserves the source's light.** Applies to the sampler. Widening the source shifts weight from core to halo; the peak dims and the shadows lift, and the total is unchanged. Why: the breathing of focus is the source changing size, not brightness. Owner: [`model/source.md`](../model/source.md).

## Where energy is deliberately not conserved

These are named, so that no one mistakes them for leaks or "fixes" them into laws.

- **The ellipse stretches without thinning.** A low sun's dapple is stretched along the sun's direction, and the cleared fraction of the disk does not fall as it stretches. **Law, placed elsewhere:** the receiver's cosine (`sun_cosine`) does the conserving, at the receiver, not the projection ([`model/transport.md`](../model/transport.md), [`model/light.md`](../model/light.md)). With the cosine off (the shipped default), a low sun lands as brightly as a high one; that is the floor's historical omission, kept for looks that never ask for the law.
- **Extinction is normalised out of the beam.** The atmosphere carries the sun's hue, normalised to its peak channel, so its broadband loss to the air is not in the beam's level. **Approximation**, named in [`model/light.md`](../model/light.md).
- **The sky view's gains are authored.** A sun disk is about a million times the radiance of blue sky; no tone curve carries that. The levels of the seen disk and the seen sky are authored scales, chosen to keep the sampler's core-to-halo ratio exactly and to let the sky be lifted without lifting the canopy. **Authored** ([`model/sky-view.md`](../model/sky-view.md)).
- **`window_wall`.** An opaque wall should pass nothing, but the room the viewer stands in has its own dim light on the near side of the cloth, which this stands in for at a few percent. **Authored**: a stand-in for front-side room light, not transmission through masonry ([`model/receivers.md`](../model/receivers.md)).
- **`glow_bleed` read as veiling glare.** On a cloth, the lateral diffusion conserves the frame exactly. In the sky view the same pass reads as the eye's veiling glare, and there its effect on the picture is a compressed stand-in for a contrast the pipeline cannot carry: a wide setting drags open sky down toward the canopy's mean. **Authored**, in the same class as `window_wall` ([`model/sky-view.md`](../model/sky-view.md)).
- **The retired proxies.** `fill_scatter` and `sky_scatter` are authored stand-ins for the diffuse light a leaf passes. With the diffuse split open they are dead, because counting both would count the same light twice ([`model/fill.md`](../model/fill.md)).
- **No ground bounce, single scatter.** Light a leaf scatters goes down through the layers below and does not glow sideways out of neighbouring leaves, nor return from the floor. **Approximation**: the shade is darker than in life, where multiple scattering is much of what fills it.

## Known tensions

- **The curtain's diffusion runs on post-mesopic colour.** The fabric spreads light before any eye adapts to it, so physically the order is inverted. Recorded as an approximation; the two barely overlap, since mesopic acts on deep shade at a low sun and the glow on the hot patches ([`model/receivers.md`](../model/receivers.md)).
- **The diffusion's reach falls short past its cap.** A fixed number of taps cannot cover an arbitrarily large radius; past a capped spacing the reach stops short of the metres asked for, which conserves energy but spreads it less far than authored ([`model/receivers.md`](../model/receivers.md)).
- **A texel's mixture is exact only for one leaf or a full stack.** Between, where a second leaf partly overlaps the first, it is a bounded residue, and two edges inside one texel are outside it. The identity of contract 4 still holds by construction; the residue is in how much the texel passes, not in whether the books close ([`model/leaf.md`](../model/leaf.md)).
- **The padded frame gives up a tail.** On a finite tree, the share of the leaves' light that travels beyond the padding is lost; it is small, recorded in [`../evidence/measurements.md#fill`](../evidence/measurements.md#fill), and not zero.
- **The fill is baked at floor height.** A vertical cloth reads a hemisphere it only half sees and the tent reads it through each panel's view of the sky; these are approximations of the receivers, named in [`model/receivers.md`](../model/receivers.md).

## Related

- [`../principles.md`](../principles.md): principles 3, 4 and 6.
- [`determinism.md`](determinism.md): the other half of what keeps the picture honest.
- [`preservation.md`](preservation.md): every split's off state is the previous law.
- [`gates-and-rungs.md`](gates-and-rungs.md): the quality rungs these mechanisms degrade through.
- [`../model/fill.md`](../model/fill.md), [`../model/leaf.md`](../model/leaf.md), [`../model/receivers.md`](../model/receivers.md), [`../model/sky-view.md`](../model/sky-view.md), [`../model/source.md`](../model/source.md), [`../model/transport.md`](../model/transport.md), [`../model/light.md`](../model/light.md).
- [`../evidence/measurements.md`](../evidence/measurements.md): the books measured on the shipped looks.
