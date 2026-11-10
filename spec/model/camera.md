# The camera and the Look

*Where the viewer stands, and how the landed light becomes a picture: tilt, orbit, pan and zoom; the far floor's smear and haze; exposure, tone curve, contrast and gamma, last; and the projector's soft iris. All of it is downstream of the physics.*

## Downstream of the physics

**Law of the order.** Light is computed as light, in **linear HDR**, until the very end. The source, the canopy, transport, the fill and the receiver produce a radiance toward the eye; the camera decides which piece of the world each pixel looks at; and only then does the **Look's tail** turn radiance into a displayed colour. **Render linear HDR, tone-map last.** Nothing in the Look feeds back into the physics, and nothing physical is done after the tone curve.

The Look's place in the spine: the elliptical projection comes from transport, the green wash from the canopy, the sun and sky colour from the atmosphere ([`light.md`](light.md)), the reflectance of the floor from the receiver ([`receivers.md`](receivers.md)). This file owns the rest: the view and the tail.

## The floor camera

The overhead and tilted looks see the floor through a **tilted perspective camera**: a pinhole that casts each pixel's ray onto the ground plane, then asks transport what landed at that ground point.

- **Pitch** (`view_pitch_deg`) tilts the gaze from straight down. **At pitch 0 the camera reduces exactly to the original orthographic top-down map**, so tilt is opt-in per look. Tilting drops the near floor to the bottom of the frame, recedes the far floor, and dissolves it into haze toward the horizon.
- **Zoom** (`view_extent_m`) is the on-axis ground span: the vertical span of floor the frame shows along its centre line, held fixed at any tilt.
- **Lens** (`view_fov_deg`) is the vertical field of view, the strength of the perspective.
- **Orbit** (`view_yaw_deg`) rotates the sampled floor about the frame's centre, a true orbit for a flat floor: the tilt axis stays put while the world turns under it. The rotation is applied to the ground point **before** transport's sun shift, so the shift stays in world space and the shadows remain physically cast as the gaze turns. 0 is no rotation.
- **Pan** (`view_center_x`, `view_center_y`) slides the world point the screen centre looks at, added after the orbit. It walks the view across the floor: push the tree out of frame and watch only what it casts.

**Law: there is no camera height.** For a flat floor, eye height only rescales the view, which the zoom hold cancels exactly; it has no independent effect, so it is not a control.

Pitch, orbit, pan and zoom together let a person walk around the structure to make sense of it.

### Framing the off-frame tree

In a standing scene the tree is grown at the world's origin and its shadow is thrown down-sun across the floor ([`transport.md`](transport.md)). **Framing that shadow is the camera's job.** A fixed pan looks at the patch of floor in front of the tree, so the tree's foot sits off the frame and only its cast lies in view; orbit and pan pivot on that floor patch, not on the trunk. As the sun moves, the shadow sweeps across the fixed view, and raised past overhead it retreats under the off-frame tree, leaving lit floor, which is correct. Physics moves the shadow; the camera is only where you stand.

**The camera never follows the shadow.** The trunk's foot is at height 0 and never shifts; the crown is high and shifts most. A camera centred on the crown's shadow makes the trunk slide out from under its own crown as the sun moves. The whole shadow is one connected object and sweeps together because every occluder shares one shift; the camera stays still. This was tried and rejected: [`../evidence/dead-ends.md#camera`](../evidence/dead-ends.md#camera). A one-time convenience that computes a pan and zoom near the shadow, to nudge from, is a camera move, not a per-frame follow.

### The far-field smear

**Approximation.** Under a tilted gaze a pixel covers a growing patch of ground toward the horizon. Point-sampling that patch aliases the dapples and makes the far floor shimmer, which would be sampling noise impersonating the glisten. `far_smear` widens each pixel's soft-shadow throw by its own ground footprint, so far dapples melt into soft **down-sun** streaks and the shimmer is averaged out while the near floor stays crisp.

The footprint is exact for a flat floor. With `D = −ray.z` (the ray's downward component):

> det(∂world/∂uv) = `view_extent² · cos⁴ pitch · aspect / D³`

so the footprint's linear size goes as `1/D^1.5`. The smear grows with that footprint measured against the frame's nearest visible row (`D_ref = cos pitch + tan(fov/2) · sin pitch`), scaled by `far_smear`, and is added to every layer's throw height inside transport's own shift; so it is drawn along the sun's direction, as the shadows are. **At pitch 0 it is exactly zero**: a top-down view has a uniform footprint and no near-far gradient. The smear is a tilted-gaze phenomenon and strengthens with tilt.

What it stands in for is integrating each pixel's whole ground footprint; it widens the throw along the sun's direction only, not across it.

### The distance haze

**Authored.** The far floor dissolves into **atmospheric haze** before it reaches the horizon, and a ray at or above the horizon is all haze. The haze takes the **hue of the sky** at a steady brightness, so the far floor fades into the time of day's own atmosphere. It begins beyond the frame's own extent on the floor, so a top-down view never shows it. The sky view's frame hands off to the same haze below its horizon, and the transition between sky and floor meets on it: one behaviour and one colour for the bottom of every picture, rather than a second sky model.

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

**One tail.** The tail is one definition shared by every path that draws a picture, so two paths can never become two Looks.

**Contrast is the look's, not the cloud's.** The contrast sag under cloud is the source's own convolution ([`source.md`](source.md)); the `contrast` knob is an independent grade on top of it.

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

Turning the iris on or off in a transition never installs or removes the whole mask in one frame: its boundary sweeps in from outside the frame, or opens out again, while the settled mask and its place before the tail stay as authored. The sweep is [`transitions.md`](transitions.md)'s and its promise [`../contracts/transitions.md`](../contracts/transitions.md)'s.

## Approximations and limits

- **Approximation: the far-field smear** widens the throw along the sun's direction by a pixel's footprint; it stands in for integrating the footprint, and is absent at pitch 0 or `far_smear` 0.
- **Authored: the distance haze**, a sky-hued fade with an authored onset, not a model of aerosol along the view ray.
- **Approximation: the mesopic shift before the diffusion**, the inverse of the physical order, negligible because the two barely overlap.
- **Authored: the tone curve and contrast.** The curve is a display choice, not a model of the eye's adaptation. Exposure follows the cloud (`cloud_exposure`: × (1 + cloud), each look re-sat at its own cloud), as an eye opens up under a passing cloud; contrast does not, and whether it should grey toward flat in real overcast is **Open**.
- **Authored: the iris**, a presentation device, keystoned on a tilted floor by design.
- **Law, held: no camera height and no focal plane.** Neither has an effect the model could show ([`source.md`](source.md)).

## Open

- The tone curve, and whether and how exposure and contrast should couple to the source's width. Recorded in [`../exploration/open.md`](../exploration/open.md).

## Related

- [`light.md`](light.md): the atmosphere's colours, the cosine law that leaves exposure to the look, the Purkinje shift.
- [`transport.md`](transport.md): the shift the far smear rides; the standing scene's bulk shift.
- [`receivers.md`](receivers.md): the floor's albedo, the cloth and tent geometry, the lateral diffusion.
- [`sky-view.md`](sky-view.md): the upward camera and its veiling glare.
- [`transitions.md`](transitions.md): the eye travelling between sky and floor.
- [`../contracts/transitions.md`](../contracts/transitions.md): the iris sweep's promises.
- [`../evidence/dead-ends.md#camera`](../evidence/dead-ends.md#camera): the camera that followed the crown's shadow.
