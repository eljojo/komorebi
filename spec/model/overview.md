# The world, in one page

*What exists in komorebi and what causes what. Read this before any mechanism; every other file in `model/` is a deeper account of one row of the spine below.*

## The spine

Light leaves the sun, crosses a canopy, lands on a surface, and reaches an eye. The piece models exactly that chain, and nothing is drawn that is not a consequence of it.

| Stage | What it is | What it decides | File |
|---|---|---|---|
| **Source** | The sun's half-degree disk and the aureole cloud smears it into: a cloud of weighted point-suns, fixed from frame to frame. | How soft every shadow is. Cloud widens the source; the pattern breathes in and out of focus and its contrast sags with it. | [`source.md`](source.md) |
| **Light** | What the atmosphere does to the beam and the sky, what the receiver's tilt does to the beam, and what the eye does at dusk. | The sun's warmth and the shade's blue; a low sun landing by its cosine; the Purkinje cooling of deep shade; the spectrum splitting at leaf edges. | [`light.md`](light.md) |
| **Canopy** | A grown grove: trunks, limbs, twigs, leaves, each where growth put it, moving on springs. Once a frame its leaves are baked into a few depth layers of per-channel optical depth; the trunk and limbs are a continuous occluder of their own. | Where light can travel. Gaps and clumps are never drawn; they are the negative space the skeleton leaves. | [`canopy.md`](canopy.md) |
| **Leaf** | One leaf, as material and as shape: an RGB transmittance by Beer's law; a diffusing lamina, not a window, so almost all it passes is scattered; an outline grown from its veins. | The green of the shade, the darkness of a leaf's own shadow, the glow of a backlit crown, the shape a fallen leaf lies in. | [`leaf.md`](leaf.md) |
| **Season** | The slow axis: each leaf's own clock turns it, light orders the turn across a stand, trees run ahead of their neighbours, leaves let go on their own day and lie on the floor as a carpet that ages and wets. | The colour of the shade in autumn, which tree is red beside a yellow one, what the floor is made of. | [`season.md`](season.md) |
| **Transport** | Many suns: each point-sun shifts every occluder by its height times the sun's angular offset; the shifted sharp shadows multiply across layers and sum across suns. The soft shadow is that sum, and higher foliage blurs more for free. | The dapples, the penumbrae, the ellipse of a low sun, the trunk's streak across a standing scene. | [`transport.md`](transport.md) |
| **Fill** | What lights the shade: skylight that also had to come through the leaves, and the sunlight the lit leaves scatter down, integrated over the floor's hemisphere. | The shade's level and colour; conservation between what the beam loses and what the leaves give back. | [`fill.md`](fill.md) |
| **Receiver** | The surface the light lands on. It takes the arriving irradiance and its own geometry and returns radiance toward the eye: an opaque floor, a translucent pleated cloth, a tent of panels around the viewer. | Whether the dapples lie flat, stand up a curtain, or wrap a room; what the surface does to the light it answers. | [`receivers.md`](receivers.md) |
| **Sky view** | No surface at all: the eye lies on the ground and looks up through the same canopy along its own rays. The source is in frame; the wood is silhouette; the leaves are lanterns. | The founding afternoon with the eyes turned the other way. | [`sky-view.md`](sky-view.md) |
| **Camera** | Where the viewer stands and how the landed light becomes a picture: pitch, orbit, pan, zoom; far-field smear and haze; exposure, tone and the projector's iris, all downstream of the physics in linear HDR. | Framing, and the Look's final grade. | [`camera.md`](camera.md) |

Two more accounts cut across the spine:

| | What it is | File |
|---|---|---|
| **Motion** | One wind field, two bands, feeding one spring hierarchy of rotations about real joints. The coherent band translates the pattern intact and loads the branches against a stiffening ceiling; the incoherent band, as built a bounded orbit each leaf walks as the drift phase advances, trembles each leaf alone and reorganises the gaps. Weather drifts the coherent band over minutes; the drift phase does not follow the wind. | [`motion.md`](motion.md) |
| **Transitions** | How the piece moves between looks: retain what can honestly be retained, reorganise rather than dissolve, never cut. Leaves travel between floor and canopy; a grove regroups leaf by leaf; weather is the cover of last resort. | [`transitions.md`](transitions.md) |

## The causal order, said once

**Weather** changes the source and the forces on the grove. The **source** sets the blur kernel. The **grove** sets where light can travel, and the **wind** moves it: the coherent band through the trunk and limbs, the incoherent band through each leaf. **Transport** carries the surviving beam to a surface; the **fill** carries the skylight and the leaves' scattered light to the same surface. The **receiver** answers with its material. The **camera** and the **eye** make a picture of it. Across weeks the **season** rewrites what each leaf is made of and where it lies.

Nothing runs the other way. The canopy never knows where the sun is; the source never knows the ground is tilted; the receiver's geometry feeds up into transport and its material flows down from the landed light. This separation is what lets reality and art be tuned without fighting.

## Three timescales

| Seen on the ground | Cause | Timescale |
|---|---|---|
| Softness breathes in and out | cloud widening and tightening the source | seconds to minutes |
| Wind strengthens, calms, veers | weather drifting the coherent band | minutes |
| The pattern translates intact | trunk and major limbs swaying together | slow |
| Gaps morph and rearrange, then recover | mid-branches and twigs flexing differently | medium |
| The pattern glistens | each leaf trembling on its own petiole | fast |
| Shade turns gold, then red; leaves fall; the floor becomes a carpet | the season | weeks |

## Four surfaces, one physics

Transport is one account compiled four ways, one per **camera**: the floor, the standing cloth, the enclosure, the retina. A camera is a mode of the piece, not an effect; it changes only through a structural rebuild. Materials ride their camera. A new surface is written as an addition and owes the [extension contract](../contracts/gates-and-rungs.md).

## Where the approximations are

Every stage above names its own in a closing section. The one every frame pays is the canopy's **depth discretisation** into a few layers, opted out of by the faithful cast when the tree's structure is the subject. The rest (a diffraction proxy, single scattering, a flat sky, a texel read as one leaf and a gap, a coarse hull with smooth shading) are local, bounded and absent when their knob is at rest. [`principles.md`](../principles.md) §5 is the policy; each file is the list.

## What the model is not

It is not a picture of a tree. Nothing is drawn: no bark is lit, no leaf is shaded, no sky has a gradient. Everything the eye receives is transmission, scattering and reflection of one source through one grove onto one surface, and where that is not yet true the file says **Not built**. The directions the artist wants next are in [`../exploration/directions.md`](../exploration/directions.md).

## Related

- [`../experience.md`](../experience.md): what this world is for.
- [`../principles.md`](../principles.md): how changes to it are judged.
- [`../contracts/README.md`](../contracts/README.md): what must remain true of it.
- [`../implementation.md`](../implementation.md): where each stage lives in the code.
