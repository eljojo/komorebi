# The camera and the Look

*Where the viewer stands, and how the landed light becomes a picture: tilt, orbit, pan and zoom; the far floor's smear and haze; exposure, tone curve, contrast and gamma, last; and the projector's soft iris. All of it is downstream of the physics.*

## Downstream of the physics

**Law of the order.** Light is computed as light, in **linear HDR**, until the very end. The source, the canopy, transport, the fill and the receiver produce a radiance toward the eye; the camera decides which piece of the world each pixel looks at; and only then does the **Look's tail** turn radiance into a displayed colour. **Render linear HDR, tone-map last.** Nothing in the Look feeds back into the physics, and nothing physical is done after the tone curve.

The Look's place in the spine: the elliptical projection comes from transport, the green wash from the canopy, the sun and sky colour from the atmosphere ([`light.md`](light.md)), the reflectance of the floor from the receiver ([`receivers.md`](receivers.md)). This file owns the rest: the view and the tail.

## The floor camera

The overhead and tilted looks see the floor through a **tilted perspective camera**: a pinhole that casts each pixel's ray onto the ground plane, then asks transport what landed at that ground point.

- **Pitch** (`view_pitch_deg`) tilts the gaze from straight down. **At pitch 0 the camera reduces exactly to the original orthographic top-down map**, so tilt is opt-in per look. Tilting drops the near floor to the bottom of the frame, recedes the far floor, and dissolves it into haze toward the horizon.
- **Look up** (`view_look_up_deg`, up to 70°) turns the gaze up past the tilt, as a person standing still lifts their eyes: the eye stays where zoom, tilt and lens put it, and only the direction it looks moves. The floor slides down out of the frame and, past the horizon, the frame holds what lies over it: the haze, or the sky ([`light.md`](light.md#the-sky-seen)). At 0 the gaze is the tilt's and the camera is the one it was.
- **Zoom** (`view_extent_m`) is the on-axis ground span: the vertical span of floor the frame shows along its centre line, held fixed at any tilt. Looking up leaves it the span the tilt's own gaze would show, which is what places the eye. It frames and does nothing else: the grove is grown for its reach, not for the zoom ([`canopy.md`](canopy.md#the-grown-grove)).
- **Lens** (`view_fov_deg`) is the vertical field of view, the strength of the perspective.
- **Orbit** (`view_yaw_deg`) rotates the sampled floor about the frame's centre, a true orbit for a flat floor: the tilt axis stays put while the world turns under it. The rotation is applied to the ground point **before** transport's sun shift, so the shift stays in world space and the shadows remain physically cast as the gaze turns. 0 is no rotation.
- **Pan** (`view_center_x`, `view_center_y`) slides the world point the screen centre looks at, added after the orbit. It walks the view across the floor: push the tree out of frame and watch only what it casts.

**Law: the eye's height is derived, not a control.** The eye stands `H = view_extent·cos²pitch / (2·tan(fov/2))` above the floor, `H·tan(pitch)` back from the looked-at point along the tilt's gaze, turned by the orbit and moved by the pan. For a flat floor that height only rescales the view, which the zoom hold cancels exactly. Once the tree is seen ([below](#the-tree-seen-from-the-floor-camera)) it sets the perspective, and it is still not a control: zoom, pitch and lens decide it, so every framing is also a place to stand. `park 1`'s shipped framing stands the eye 2.7 m up; a wide lens tilted toward the horizon at a long zoom brings it to a person's 1.6 m, and a steep tilt at a narrow lens lifts it over the grove.

**The reach.** The tilt goes to 80° from straight down, the look up 70° past it, and the zoom's slider to 60 m. From a person's eye, with the gaze lifted, that frames a whole tree as a photograph taken standing on the path does: the trunk at the bottom of the frame, the crown round, not stretched toward the top. `dows lake` and `glebe sunset` stand there, the eye 1.6 m up, an 80° tilt with the gaze lifted 21.5° more.

Pitch, orbit, pan and zoom together let a person walk around the structure to make sense of it.

Standing-camera glides use each endpoint's rendered pitch, capped at 80°, when solving the path between the two eyes. A saved tilt above that limit has the same glide as the rendered tilt.

### Framing the off-frame tree

In a standing scene the tree is grown at the world's origin and its shadow is thrown down-sun across the floor ([`transport.md`](transport.md)). **Framing that shadow is the camera's job.** A fixed pan looks at the patch of floor in front of the tree, so the tree's foot sits off the frame and only its cast lies in view; orbit and pan pivot on that floor patch, not on the trunk. As the sun moves, the shadow sweeps across the fixed view, and raised past overhead it retreats under the off-frame tree, leaving lit floor, which is correct. Physics moves the shadow; the camera is only where you stand.

**The camera never follows the shadow.** The trunk's foot is at height 0 and never shifts; the crown is high and shifts most. A camera centred on the crown's shadow makes the trunk slide out from under its own crown as the sun moves. The whole shadow is one connected object and sweeps together because every occluder shares one shift; the camera stays still. This was tried and rejected: [`../evidence/dead-ends.md#camera`](../evidence/dead-ends.md#camera). A one-time convenience that computes a pan and zoom near the shadow, to nudge from, is a camera move, not a per-frame follow.

### The tree seen from the floor camera

On a standing scene cast faithfully, `tree_view` lets the floor camera see the tree itself: the leaves and wood the shadow is cast from, where they really hang, over the floor their shadow falls on. **Nothing new is grown.** The tree is the faithful cast's own leaf records and its own swayed wood, drawn in the floor camera's own perspective from the derived eye, after the floor and before the Look's tail. A point on the floor lands on the floor's own pixel, so the tree stands exactly on the ground it shades.

**Law. The leaf and its shadow are one placement.** Each leaf is stood back up from the corner its footprint is stamped at, by the same vertex code in the same frame, so the stood-up leaf projects straight down onto exactly the footprint the cast throws. The wood is the cast's swayed skeleton, each segment a cylinder turned to the eye. It remains visible after the last leaf falls. Gusts move the leaves and their shadows together by construction.

A leaf and a piece of bark are **receivers of the beam** ([`transport.md`](transport.md#the-receiver-relative-read)): each names a plan point and a height, and the sun reaching it is read through the leaves above it along the beam, the sky through the leaf area above it. What a leaf then does with that light is [`leaf.md`](leaf.md#a-leaf-seen). Everything the floor does after its light (the dusk shift, the haze, the iris, the Look's tail) is per pixel, so a tree pixel takes the same steps the floor pixel beside it takes, save one: the tail's curve is the tree's own ([the tree's curve](#the-trees-curve)).

The overhead park has no tree to see: its canopy is endless and above the frame. The tree view is opened per look, and off it is the floor as it was. Between a look that sees its tree and one that does not, the tree fades and nothing else changes on its account: it is not a scene mode, since nothing the grove, the cast or the floor holds reads it ([`../contracts/transitions.md`](../contracts/transitions.md#gate-crossings-within-any-morph)).

#### The wood, seen

Each piece of the skeleton is drawn as a flat card through its axis, turned to face the eye, its normal rebuilt across it so it shades as a round stem; each card runs on past its ends by its radius so the joints close. Four things, each opened per look and each the old drawing when shut, make that card stand as wood.

**Twigs finer than a pixel** (`thin_twigs`, Approximation). Drawn at its own width a twig falls between the samples and breaks into dashes; drawn a pixel wide at full strength it darkens the crown by its whole pixel. So a twig finer than a pixel is drawn a pixel wide and as strong as the share of the pixel it covers. A pixel holds four samples, and a twig covering less than a quarter of one would land on none of them: it is kept at one sample's weight with four times its coverage as the chance, by a hash of the pixel and the twig, right on average over a crown's haze of twigs and still from frame to frame while the twig is. The same knob grows the twigs at their own thin widths ([`canopy.md`](canopy.md)).

**Where the trunk meets the ground** (`trunk_base`). The card's foot ended in a straight edge and ran on a radius below the ground, over the floor. Now nothing below the ground is drawn: the bark a point of the card stands for lies in front of the card by the round's depth there, toward the eye, and where that bark is below the ground it is not seen. So a trunk meets the ground along the curve a cylinder makes, lowest in front. **Authored:** its foot flares into its roots, slight and long, as an elm's in the open: at most 0.18 of the trunk's radius wider at the ground, falling off over 1.5 radii up and gone where the trunk's first piece of wood ends, so the trunk above takes over without a step. The bark rounds over the flare as over the trunk. A wider flare stood the trunk on an elephant's foot, a shorter one made a lip ([`../evidence/dead-ends.md#camera`](../evidence/dead-ends.md#camera)). The same knob darkens the ground round each trunk, by the share of the sky the trunk hides ([`fill.md`](fill.md)).

**Round ends** (`trunk_split`, on a tree grown from buds whose trunk forks into two stems or more). Where a stem goes on in one of its own width, a card's run-on past its end is hidden in the next. At a fork the trunk goes on in thinner stems, and its square run-on stood out round them like a sleeve. With the ends cut to the half sphere a stem ends in, the trunk closes over the fork in a dome the stems leave from. The ends are round on every piece of wood of such a tree.

**Bark** (`bark_texture`, Authored). Old bark, an elm's, an oak's, an ash's, is ridges running up the stem that part and meet again round long furrows. They are laid on the round in the stem's own terms: round it by angle, the same 24 ridges on every branch whatever its width, so a thin limb's bark is as finely cut for its size as the trunk's and the pattern closes on itself; up it by distance along the stem, each ridge eight times as long as it is wide. The furrows are darker, seeing less of the sky and the sun, and a crest's flanks turn the stem's normal, so a low sun picks the ridges out. Broad plates, eight round the stem and many ridges long, darken it in streaks that still read where the ridges are finer than a pixel. Each fades to the bark's own colour before it can alias, so far bark is smooth as the eye sees it. The pattern runs on across a joint: the angle round is taken from a direction a small bend does not swing, and for a stem nearer upright than 60° the distance up is its height over the stem's rise, so where a stem bends at a joint the pattern slips only by the joint's height times how much the bend shortens the rise, a small fraction of a ridge on a trunk. The flare's swell does not stretch it. `bark_texture` is the furrows' depth; its colour stays the measured bark's (`bark_r`, `bark_g`, `bark_b`).

### The far-field smear

**Approximation.** Under a tilted gaze a pixel covers a growing patch of ground toward the horizon. Point-sampling that patch aliases the dapples and makes the far floor shimmer, which would be sampling noise impersonating the glisten. `far_smear` widens each pixel's soft-shadow throw by its own ground footprint, so far dapples melt into soft **down-sun** streaks and the shimmer is averaged out while the near floor stays crisp.

The footprint is exact for a flat floor. With `D = −ray.z` (the ray's downward component):

> det(∂world/∂uv) = `view_extent² · cos⁴ pitch · aspect / D³`

so the footprint's linear size goes as `1/D^1.5`; the pitch here is the tilt's, which places the eye, whatever the look up. The smear grows with that footprint measured against the frame's nearest visible row (`D_ref = cos γ + tan(fov/2) · sin γ`, γ the gaze: the tilt plus the look up; held above zero, since a gaze turned up can put the frame's bottom row at the horizon), scaled by `far_smear`, and is added to every layer's throw height inside transport's own shift; so it is drawn along the sun's direction, as the shadows are. **With the gaze straight down it is exactly zero**: a top-down view has a uniform footprint and no near-far gradient. The smear is a tilted-gaze phenomenon and strengthens with tilt.

What it stands in for is integrating each pixel's whole ground footprint; it widens the throw along the sun's direction only, not across it.

### The distance haze

**Authored.** The far floor dissolves into **atmospheric haze** before it reaches the horizon, and a ray at or above the horizon is all haze. The haze takes the **hue of the sky** at a steady brightness, so the far floor fades into the time of day's own atmosphere. It begins beyond the frame's own extent on the floor, so a top-down view never shows it. The sky view's frame hands off to the same haze below its horizon, and the transition between sky and floor meets on it: one behaviour and one colour for the bottom of every picture, rather than a second sky model.

With `view_sky` on, the floor camera's haze is the sky itself: over the horizon each ray shows the clear sky's radiance in its own direction ([`light.md`](light.md#the-sky-seen)), and the far floor fades, by the same onset, into the sky's horizon in its own azimuth, warm toward a low sun and cool away from it. A look that turns its gaze up to a tree then stands it against a sky rather than a pale wall. A far tree fades the same way, into the sky's horizon along the ray from the eye to it: the tree and the floor it stands on go into one air.

## The same knobs on the other cameras

The view knobs mean what each camera's geometry lets them mean:

- **The enclosure (the tent).** The eye is fixed on the tent's centreline and only the gaze turns. So `view_yaw_deg` is a framing control and a lighting control at once, because it turns the tent's panels against the world sun, and the two cannot be separated. The pitch bounds what is visible below the eye. The geometry is [`receivers.md`](receivers.md)'s.
- **The cloth (the curtain).** The receiver is a standing plane; how the camera frames it is [`receivers.md`](receivers.md)'s.
- **The sky view.** The eye lies on the ground; `view_pitch_deg` becomes the **gaze elevation**, 90° at the zenith. See [`sky-view.md`](sky-view.md).

A transition can carry the eye itself between the sky camera and the floor camera, preserving the authored pan, orbit, lens and zoom at both ends ([`transitions.md`](transitions.md)).

## The Look's tail

Each pixel's radiance, in linear HDR, passes through this order and no other:

1. **The perception and atmosphere terms**, still linear: the Purkinje shift of the deep shade at dusk ([`light.md`](light.md)), then the distance haze.
2. **The iris** (below), a mask on the light.
3. **Exposure**: a multiply. It is the free constant of the whole model, the one place a look sets how bright its world is. The cosine law leaves it to the look on purpose, and a look that turns that law on re-sits it ([`light.md`](light.md)).
4. **The tone curve** (`tone_map`): none (a clip), Reinhard, or ACES.
5. **Contrast**: a scale about middle grey, `(c − 0.5) · contrast + 0.5`, clipped.
6. **Gamma**: 2.2, to the display.

**One tail.** The tail is one definition shared by every path that draws a picture, so two paths can never become two Looks. The seen tree is the one exception, and only in its curve ([below](#the-trees-curve)).

**Contrast is the look's, not the cloud's.** The contrast sag under cloud is the source's own convolution ([`source.md`](source.md)); the `contrast` knob is an independent grade on top of it.

### The tree's curve

**Authored.** The seen tree ([above](#the-tree-seen-from-the-floor-camera)) is shown through a tone curve of its own: AgX with its contrast look, in place of the frame's. Exposure, contrast and gamma are the Look's, as the floor takes them.

The frame's ACES fit works on each channel apart. A leaf that passes almost no blue, as the park's does, climbs its shoulder in red and green alone, so a sunlit leaf lands on lime and one seen through toward the sun on pure yellow. On the floor the leaf's colour arrives only diluted, multiplied into the ground, so the shadow never shows it; on the tree it is shown straight. Seen from above, `park 1, from above`'s leaves sat at a median saturation of 0.80 against its shadow's 0.25, and under the trees a third of the backlit crown was near pure yellow. AgX rolls a bright colour toward white and keeps its hue: the greens lose their acid and the backlit leaves glow pale gold.

Its gain is set so a sunlit leaf of `park 1, from above` shows as bright as the frame's curve showed it, so the crown keeps its brightness and its darks. Matched on the lit floor instead, the curve lifted the crown's darks and it read paler, not deeper. Given to the whole frame, the same curve greyed and lifted the shadow. The artist chose the tree alone, at the leaf's brightness (2026-11-19, `archive/reviews/2026-11-19-tree-tone`; [`../evidence/measurements.md`](../evidence/measurements.md#the-trees-curve)).

`tree_tone` mixes the tree's curve over the frame's: 1, the default, is the tree's; 0 is the frame's, the tree finished exactly as the floor is. A look from before it keeps 0. It tweens. It does not darken the inside of the crown: a crown seen from above still shows mostly its sunlit tops over sunlit ground.

### Where the tail sits when a blur pass exists

Two things in the piece spread light sideways across the picture: the lateral diffusion through a curtain's weave, and the same operator read as the eye's veiling glare in the sky view (`glow_bleed`; [`receivers.md`](receivers.md), [`sky-view.md`](sky-view.md)). A neighbourhood average of display-encoded pixels is not an average of light; the tone curve is steeply non-linear exactly where the glow lives, on its shoulder, so a blur after it would spread the wrong quantity and throw away the highlight energy the effect exists to redistribute.

So when a blur pass exists, **the tail sits past the blur**: the frame is kept in linear HDR, blurred, composited, and only then does exposure → tone curve → contrast → gamma run. What stays **upstream** of the blur is everything perceptual and atmospheric, the mesopic shift and the haze, and the iris.

**Approximation.** Physically a fabric spreads the light before any eye adapts to it, so applying the mesopic shift before the diffusion inverts the true order. It is negligible in practice: the mesopic term is gated to deep shade under a low sun, and the glow is carried by the hot patches; the two barely overlap.

## The projector's soft iris

**Authored: a presentation device, not physics.** José throws the piece onto a backyard at night with a real projector. A projector is a hard rectangle of light; nothing in a canopy has a frame. The light should **pool in the yard and fade**, not show its edge.

`vignette` is the **feather**: the outer fraction of the frame's half-extent over which the light fades to black. It is also the gate: at 0 there is no mask and the picture is unchanged. `vignette_shape` (2 to 8) is the exponent `n` of a **superellipse**:

> `q = |2·uv − 1|`, `d = (|q_x|ⁿ + |q_y|ⁿ)^(1/n)`, light × `(1 − smoothstep(1 − vignette, 1, d))`

Fully lit inside, black at the frame's edge and in the corners beyond the curve. `n = 2` is an ellipse touching all four edges; `n = 8` a rounded rectangle. On an axis `d = |q|` for every `n`, so the shape shows only off-axis.

**It multiplies the light, before the tail**, on every camera. So it dims the way a real throw would, as an iris on the projector rather than a darkening of the picture, and where a blur pass exists it spreads already-masked light. Both knobs tween. On the tilted floor camera a screen-space mask lands on the floor as a **keystoned oval**, by design: a throw onto a yard is oblique anyway.

### Crossing the iris's gate

Turning the iris on or off in a transition never installs or removes the whole mask in one frame, and never moves its edge: the hood keeps its authored shape and fades in or out, while the settled mask and its place before the tail stay as authored. The fade is [`transitions.md`](transitions.md)'s and its promise [`../contracts/transitions.md`](../contracts/transitions.md)'s.

## Approximations and limits

- **Approximation: the far-field smear** widens the throw along the sun's direction by a pixel's footprint; it stands in for integrating the footprint, and is absent with the gaze straight down or `far_smear` 0.
- **Authored: the distance haze**, a sky-hued fade with an authored onset, not a model of aerosol along the view ray. Under `view_sky` it fades into the seen sky's horizon instead of a flat colour, by the same onset; the seen tree's haze stays the flat colour, so a far tree and the floor beside it fade toward different colours.
- **Approximation: the mesopic shift before the diffusion**, the inverse of the physical order, negligible because the two barely overlap.
- **Authored: the tone curve and contrast.** The curve is a display choice, not a model of the eye's adaptation. Exposure follows the cloud (`cloud_exposure`: × (1 + cloud), each look re-sat at its own cloud), as an eye opens up under a passing cloud; contrast does not, and whether it should grey toward flat in real overcast is **Open**.
- **Authored: the tree's curve**, AgX on the seen tree alone, its gain matched to a sunlit leaf of one look ([above](#the-trees-curve)). Absent: `tree_tone` 0 or `tree_view` 0.
- **Authored: the iris**, a presentation device, keystoned on a tilted floor by design.
- **Law, held: no camera-height control and no focal plane.** The height is derived from the framing ([above](#the-floor-camera)); a focal plane has no effect the model could show ([`source.md`](source.md)).
- **The tree view's light** (Approximation). A leaf's sun is read along the beam's central direction through the low-res layer set the sky fill bakes, each layer standing for a slab a layer thick and shading the leaf by as much of the slab as lies above it: none at the leaf's own height, so a leaf never shades itself, all of it a layer above, so the light changes continuously up the crown; its sky goes as e^(−½·leaf area above), the season's spherical leaf. A penumbra the size of one leaf is not resolved. Absent: `tree_view` 0.
- **The wood as a card** (Approximation). Each stem is a flat card shaded as a round one, so its silhouette is a cylinder's only from the side; the ground clip, the flare and the round ends cut the card to the outline a solid would show, and nothing behind the card is hidden by the bark's depth in front of it. Absent: `tree_view` 0.
- **Approximation: twigs under a pixel** are drawn by their coverage, and under a quarter of a pixel by a chance of being kept, which is right on average and grainy one twig at a time. Absent: `thin_twigs` off.
- **Authored: the root flare**, its width and fall chosen by eye, carried by the trunk's first piece of wood alone, so a short first piece carries less of it. Absent: `trunk_base` off.
- **Authored: the bark's pattern**, its ridges, plates and depth chosen by eye, not measured; its colour is the measured bark's. A stem leaning further than 60° from upright takes its distance up along its own axis from the world's origin, so at a bent joint its pattern breaks by its distance from that origin times the bend. Absent: `bark_texture` 0.

## Open

- The tone curve, and whether and how exposure and contrast should couple to the source's width. Recorded in [`../exploration/open.md`](../exploration/open.md).

## Related

- [`light.md`](light.md): the atmosphere's colours, the sky seen over the horizon, the cosine law that leaves exposure to the look, the Purkinje shift.
- [`canopy.md`](canopy.md): the skeleton the seen wood is drawn from, its widths, its fork.
- [`transport.md`](transport.md): the shift the far smear rides; the standing scene's bulk shift.
- [`receivers.md`](receivers.md): the floor's albedo, the cloth and tent geometry, the lateral diffusion.
- [`sky-view.md`](sky-view.md): the upward camera and its veiling glare.
- [`transitions.md`](transitions.md): the eye travelling between sky and floor.
- [`../contracts/transitions.md`](../contracts/transitions.md): the iris fade's promises.
- [`../evidence/dead-ends.md#camera`](../evidence/dead-ends.md#camera): the camera that followed the crown's shadow.
