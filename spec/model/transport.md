# Transport

*How the sun's light is carried from the source, through the canopy, to the surface it lands on.*

Transport is the part of the piece that does not move. The source holds still unless the cloud changes; the canopy is the only thing the wind touches; transport is pure geometry between them. It takes a cloud of point-suns and a field of occluders and says, for every point of a receiving surface, what fraction of the sun's disk reached it. Everything the eye reads as komorebi on a surface — the round sun-images, the soft penumbrae, the long ellipses of a low sun, the trunk's streak across a lawn — is that fraction.

## One problem: soft shadows from an area light

Pinhole sun-images, penumbra softness and the breathing of focus as clouds pass are one well-understood problem in costume: **soft shadows cast by an area light**. The area light is the source profile, the sun's half-degree disk with its variable cloud halo ([`source.md`](source.md)). A point light gives hard shadows; an area light gives penumbrae; a larger, softer light gives softer shadows. A cloud widening the source *is* the light growing. **Law.**

The two regimes of the dapples fall out of this without being asked for. A gap of size `a` at height `h` above a surface, under a source of angular size `θ`, throws its own shape when `a ≫ h·θ` and an image of the sun when `a ≪ h·θ`; between them a penumbra of width about `h·θ`. Transport never tests which regime a gap is in. The regime is decided by each occluder's height feeding the shift below, which is why the same sun in the same frame can draw a window bar sharp a few centimetres off a curtain and a tree's gaps as soft suns metres away.

## Many suns: the convolution as accumulation

The soft shadow is the convolution of the sharp shadow with the source. Transport computes it the way it was seen in the park: **the big soft light is literally an accumulation of many smaller ones.**

> Scatter N weighted point-suns across the source. Each casts a perfectly **sharp** shadow. A sun offset by a small angle simply **shifts** each occluder by its height times that angle. **Sum the N shifted sharp shadows**, and the sum *is* the soft shadow.

The method matches the perception, and the payoff is the whole game: because the shift scales with height, **occluders at different depths blur by different amounts, for free.** High foliage throws softer images than low foliage; a branch grazing the fabric throws a hard edge beside the soft plates of the crown above it. The cloud knob becomes literal: cloud thickness is how widely the samples spread, and nothing in transport changes when it moves.

A single blur of one flat gap-map was rejected: it gives every dapple the same softness and reads as a photograph with a Gaussian blur, not light through a tree ([dead ends](../evidence/dead-ends.md#transport)). Per-pixel ray sampling from the surface up is the same computation, more general and noisier; it was not the starting point and is not built.

## The equation

One equation is the beam on every cast camera:

> **acc(p) = Σᵢ wᵢ · Π_L T_L( p + (h_L − z_p) · gᵢ )**
>
> **gᵢ = P · θᵢ + b**

- `p` is the receiver point's plan position and `z_p` its height; on the floor `z_p = 0`.
- `(θᵢ, wᵢ)` are the source samples: angular offsets and weights summing to one ([`source.md`](source.md)).
- `h_L` is the height of depth layer `L`, and `T_L` is that layer's transmittance read at a plan position ([`canopy.md`](canopy.md) owns the bake that makes it).
- `gᵢ` is the **ground displacement per unit height** for sample `i`: the projection `P` of the sample's angular offset (the ellipse), plus the bulk shift `b` (the standing scene). Both are below.

**Multiplying across layers** is the physical statement that light must clear every layer. **Summing across samples, weighted**, is the integral over the source. The result `acc` is dimensionless: the fraction of the sun's disk that cleared every occluder at that point, which is the landed beam irradiance in units of the unobstructed sun. **Law** in form; the discretisation of the canopy into layers is the one approximation it pays (below).

The receiver turns `acc` into colour — on the floor `(acc·sunColour + ambient)·albedo`, on the cloth through its transmittance, on a tent panel with an incidence factor ([`receivers.md`](receivers.md)). The `ambient` there is not transport's: the skylight that fills the shade and the sunlight the leaves scatter down are the sky fill's ([`fill.md`](fill.md)). The sum above is the *beam* only.

## The shift by height

The shift for layer `L` under sample `i` is `(h_L − z_p)·gᵢ`. Every visible property of a dapple's softness comes from this one product: the height spread of the canopy sets how much its layers disagree, the sample spread sets how far each is smeared, and the sun's angle sets the ellipse they are smeared into.

The camera's far-field smear widens the throw toward a tilted horizon by adding to each layer's height *inside* this shift, so it rides the same ellipse and the same bulk direction rather than being a blur laid over the picture. Its law is the camera's ([`camera.md`](camera.md)).

## The ellipse lives here

The source stays a clean circle of angular offsets; it does not know the ground exists ([`source.md`](source.md)). Turning a circular source into the ellipse a low sun throws is transport's, through one **2×2 matrix `P` built from the sun's elevation and azimuth**: it maps an angular offset to a ground displacement per unit height. A sun at elevation `e` stretches its image by `1/sin²e` along the azimuth and by `1/sin e` across it, so `P` is the symmetric matrix with those two principal values, its major axis turned to the sun's azimuth.

Keeping the projection here and not in the source is what keeps the two from tangling. The source can be sampled, weighted and eclipsed as a pure angular object, and every surface, including a vertical cloth or a tilted panel, receives the same circular source through its own geometry.

**The ellipse conserves nothing, and that is correct.** `acc` is a cleared *fraction* of the disk, so the beam does not thin however far a low sun stretches its images. What does thin the light at a grazing sun is the receiver's cosine law, which is light's ([`light.md`](light.md), `sun_cosine`).

`P` carries `1/sin e`, which diverges at the horizon; the elevation it is built from is floored at 4° to keep it finite. **Approximation**, active only below 4° of sun.

## The bulk shift and the connected shadow

The ellipse maps the *offsets* of the source samples. The **centre** of the source, an offset of zero, maps through `P` to zero shift. On its own, then, transport drops every shadow **directly under** its occluder, only stretched. For an endless, uniform canopy overhead this is invisible — a bulk translation of an endless field shows nothing — and the overhead park never needs more.

It is wrong the moment a tree is a discrete object standing in a scene. A real trunk's shadow is a line `height × cot(elevation)` long, thrown away from the sun; without a bulk offset a vertical trunk casts a small fuzzy blob at its own foot. And the dappled crown's shadow sits on top of the crown instead of being cast across the floor.

The bulk shift supplies the missing physics: a ground shift of **`b = cot(e) · (anti-sun direction)` per unit height**, folded into every sample's `gᵢ`. **Law.** With it a low sun throws the whole tree to the side — trunk streak, then branch shadows, then the dappled crown — marching `height × cot(e)` down-sun. The elevation it is built from is floored at 6°, higher than the ellipse's floor, because `cot e` diverges faster than `P` near the horizon. **Approximation**, active only below 6° of sun.

**It applies to every occluder through the one shared `g`**: the leaf layers, the analytic wood, the faithful cast, the trunk. That is what makes the shadow **one connected thing**. The trunk's foot is at height zero and never moves; the crown is high and moves most; all of it is one rigid object whose shadow sweeps together, and lowering the sun stretches the whole of it from foot to crown as one. Pinning any part of the shadow in place slides the trunk out from under its own crown as the sun moves ([dead ends](../evidence/dead-ends.md#transport)).

**The park's shear (`park_throw`).** The overhead park has no bulk shift, so its layers stack straight down whatever the sun. `park_throw` (0..1, default 0) gives it the throw, scaled: each layer lands `h·cot(e)` down-sun times the knob, which is what real leaves at different heights do under a low sun. It ships off on purpose: with the far smear riding inside the shift, it slashes a low-sun floor into sharp down-sun streaks, a look to choose, never to land on (José, 2026-11-09: "the shear in general is like very sharp and pointy and aggressive … i want off by default with the option of turning on"). With `far_smear` 0 the same throw only slides the layers apart, with no streaks (`test-gl/out/review/2026-11-09-pending/item17-shear-nosmear.png`). 0 is no throw, to the bit; it never makes the park a finite scene (the wrap and the fill's frame stay the park's).

**When the bulk shift is on.** It is on whenever the canopy is a finite object: the standing scene (`standing_scene`) on the floor, and every receiver other than the floor — the curtain and the tent always stand under a discrete tree. In the overhead park it is zero, because there it would only drag an endless pattern across its own texture, a cost with no visible benefit. The same question — is the canopy a finite object? — decides the canopy boundary below and the sky fill's domain and the sun it lights its leaves by ([`fill.md`](fill.md)), so one answer keeps the beam and the fill on the same geometry.

Where the camera stands to frame that shadow, and why it never follows it, is [`camera.md`](camera.md)'s.

### The lit floor and the discrete tree

To read a shadow on a lit floor rather than a wall of dapples, the canopy must not fill the view. In the standing scene the crown is sized to a natural fraction of its bake rather than inflated to fill the frame, so a single tree is a finite object and the surround outside its box reads as fully lit floor (the boundary rule below). No new geometry: the same grove, made a discrete tree, its connected shadow swept aside by the bulk shift, the camera parked on the floor it falls on. `park 1` is its first look ([`../contracts/looks.md`](../contracts/looks.md)).

## The receiver-relative read

The floor read shifts each layer by `h_L · g`. For any receiver, the only change is that the height is measured **relative to the receiver point**: the layer at height `h` is read shifted by **`(h − z_p) · g`**, where `z_p` is the receiver point's own height. **Law.** An occluder a height `(h − z_p)` above a given point throws its shadow exactly onto that point, whatever the surface is doing there.

On the floor `z_p = 0` and it is the plain read. On a vertical cloth `z_p` is the height up the cloth, so the dapples and the trunk's streak stand up the plane instead of lying on the floor, and the bulk shift is what rakes them up it: a low sun is what makes the shadow climb. On the tent each pixel lands on one of its panels and contributes that hit's plan point and height. The transport is the same line in every case.

So the read is **geometry-free**: valid for any receiver that can name a plan point and a height per pixel. This is the "geometry up" half of the receiver interface — the receiver's shape enters the very shift that casts the shadow, so occluder and receiver share one geometry and the shadow cannot come apart from what casts it. The surfaces themselves, and what each does with the landed light, are [`receivers.md`](receivers.md).

## Two tiers: the layer loop and the faithful tap

There are two ways to evaluate the equation.

**The layer tier** runs the sum per pixel over the source samples, reading each depth layer at its shifted position. It is the **general-geometry tier**: because the receiver enters only as `(p, z_p)`, it serves the floor, the cloth, the tent and any receiver that can name a point and a height.

**The faithful tier** moves the sum out of the pixel. The real grown geometry — every leaf and the whole woody skeleton at its own continuous height — is cast per source sample onto one receiver frame and weight-summed there into **one pre-integrated soft-shadow texture** ([`canopy.md`](canopy.md) owns that cast). Transport then reads it with **a single tap** at the receiver point: the value it finds is already `acc`, already transmittance, already integrated over the disk. The sample loop never runs.

The single tap is the reason the faithful tier is fast and the reason it is narrow: it needs one flat frame in which the whole convolution can be pre-integrated — the floor's plan coordinates, or the cloth's own across-and-up. **The faithful tier is the flat-plane tier.** A receiver with no single frame — the tent's panels, chosen per pixel — cannot be pre-baked, and there the layer tier is used whatever the look asks for. Stated as the rule: **the pre-baked tier buys speed by fixing a receiver frame, and buys it only where a receiver frame exists.** The tent loses nothing by it: at enclosure distances the whole cast is deep in the pinhole regime, where the disk blur is centimetres wide and the layer tier's height quantisation is invisible beneath it. [`receivers.md`](receivers.md) applies the rule to each surface.

Two consequences of the single tap:

- **Nothing can composite into a loop that does not run.** Anything stamped into the depth layers is invisible on the faithful tier. An occluder that must appear on both tiers is applied at the receiver, after transport, where both have already collapsed to one `acc` (the window's mullion grid is the case, [`receivers.md`](receivers.md)).
- **The faithful cast is sun-projected.** Its frame and every leaf's throw are functions of the sun's angles, so a moving sun re-casts it even in still air, and so does anything that changes what a leaf passes to the beam. The layer tier reprojects every frame through `P` and `b` and needs no re-cast.

## The woody occluder, as transport reads it

On the layer tier the trunk and main limbs are not in the depth layers; they are a set of continuous-height analytic segments ([`canopy.md`](canopy.md)), because a vertical trunk has no horizontal footprint to stamp and layer quantisation shatters a continuous branch. Transport casts them **once per pixel**, along the source's central direction (the bulk shift), with a soft edge that grows with height to stand in for the area light's penumbra, and multiplies their transmittance into `acc`. **Approximation:** the wood's penumbra is a height-scaled edge, not the per-sample integral the leaves get; on the faithful tier the wood is cast as real geometry per sample and needs no such stand-in.

**The segments are one table shared by every camera.** The floor, the cloth and the tent cast it as a shadow; the sky view reads the very same segments as silhouette ([`sky-view.md`](sky-view.md)). One wood, one set of numbers, so the shadow and the seen tree cannot disagree.

## Leaf-edge diffraction: per-channel taps

With diffraction on, each colour channel reads each layer at its own wavelength-scaled shift, `(h − z_p)·g·s_c` with `s_c = λ_c/λ_green` for the red, green and blue bands: red is thrown a touch wider, blue narrower, so every dapple gains a warm outer rim and a cool core. It rides the same shift as everything else, so higher foliage fringes more and a low sun's ellipse stretches the fringe with the dapples. Off, the three reads collapse to one shared tap and the picture is unchanged. **Approximation**, and an exaggerated one by choice: it scales the geometric pinhole shift per channel rather than integrating a wavelength-dependent kernel sized by each gap. The physics, the honesty and the knob (`chromatic_aberration`) are [`light.md`](light.md)'s.

## The canopy boundary

The baked canopy is a bounded box, and a view, a shift or a tilted horizon can read past it. What lies past it **follows the scene**, and both the ordinary and the per-channel taps obey the same rule:

- **The endless park repeats.** Its box is one period of an endless field, so a read past one side enters from the other. Nothing reads a border texel stretched into a band across a wide or panned view. On 2026-11-10 the artist took the repeat over the band it replaced, which the shipped floor looks and `tent 1` had been pinned with: the two differ only in a thin strip at the far edge and on the tent's lower panels, imperceptibly, and the repeat is this rule.
- **A finite tree is open sky.** Outside its box there is zero optical depth: the surround of a standing tree, a curtain's tree or a tent's grove is fully lit.

The choice is the same finite-object question that turns the bulk shift on, and it matches the sky fill's domains ([`fill.md`](fill.md)). **Law** for the finite tree; for the park the repetition is of the *texture*, not of a periodically grown grove, so a wide enough view can still reveal the repeat or a seam (below).

## What the beam reads of a leaf

A leaf scatters most of what it passes in every direction; only a small ballistic share keeps travelling as a beam. Transport is the beam, so each tap reads the texel's **ballistic** transmittance — the texel read as a mixture of a representative leaf and a gap, the gap passing the beam whole and the leaf passing it at its own depth plus the neutral depth its diffuse share took out of the beam. What the leaves passed diffusely is delivered by the fill, not by this sum. With the diffuse share at zero the tap is the plain transmittance of the texel's stored depth. The law of the leaf, the mixture and its limits are [`leaf.md`](leaf.md)'s; transport only reads it, at every tap, on both tiers.

## Accumulate in linear HDR

The sum is accumulated in linear light, and the tone curve comes at the very end, so exposure and contrast are tuned downstream of the physics without touching it ([`camera.md`](camera.md)).

## One program per camera

The receiver question — what did the light land on — has four answers: the floor, the standing cloth, the enclosure stood around the viewer, and the retina looking up. They are not four effects to blend; they are four programs. **A camera is a mode, not a runtime branch:** it can change only through a structural rebuild, never inside a frame, so the choice is made when the program is composed rather than per pixel.

Transport is therefore **one master account, compiled per camera**. It is written as named pieces — the camera's own block, the occluder tiers, the receiver's material, the shared Look — and a **registry** says which pieces each camera speaks: one entry per camera, read by everything that has to agree about it, so the four-way question is answered in one place. A camera's program contains only what that camera reads; the others' branches are absent, not skipped. The sky view is the clearest case: it reads the canopy along the eye's rays, not the sun's, so it carries no source samples and no shift at all ([`sky-view.md`](sky-view.md)).

What this buys is room, not speed, and one more thing the piece values: **a new camera is an addition, never an edit.** It contributes its own entry and nothing outside that entry has to learn about it. What an entry owes is the [extension contract](../contracts/gates-and-rungs.md). Materials ride the camera while each receiver has exactly one; the moment a look wants a pairing that does not exist, material becomes a registry of its own (below, Not built).

## Approximations and limits

- **Depth discretisation** — **Approximation**, the one every layer-tier frame pays. The canopy's continuous depth is collapsed into a few layers at fixed heights, so leaves at different heights within a layer blur alike and are decoupled from the continuous twig they grew on. Invisible for the overhead park, where only the dapple field is seen; visible when the tree is an object. The faithful tier is its opt-out, on flat receivers ([`canopy.md`](canopy.md)).
- **Discrete source samples** — **Approximation**. The integral over the disk is a weighted sum over a fixed sample cloud; frame-stable, so it adds no motion ([`source.md`](source.md), [`../contracts/determinism.md`](../contracts/determinism.md)).
- **The wood's penumbra on the layer tier** — **Approximation**. Cast once per pixel along the central direction with a height-scaled soft edge, not integrated per sample. On the cloth its capsule distance is measured partly in plan depth rather than up the cloth, so its penumbra there is approximate.
- **Fine twigs on the layer tier** — **Approximation**. Only the trunk and main limbs are cast as wood; finer branches are left to the leaf dapples, which is close to what thin twigs do in a dappled mass. The faithful tier casts every twig.
- **Diffraction** — **Approximation**, exaggerated on purpose. A per-channel scale of the geometric shift, not a gap-sized diffraction kernel ([`light.md`](light.md)).
- **Elevation floors** — **Approximation**. The ellipse is built from an elevation of at least 4°, the bulk shift from at least 6°; below those the sun's images stop lengthening.
- **The park's repetition** — **Approximation**. The overhead canopy repeats its texture, not a periodically grown grove; a view wide enough can show the period or a seam.
- **The faithful tier needs a flat receiver frame** — **Law** of the method, not of the world: a receiver with no single frame takes the layer tier.
- **Beam only** — **Approximation.** What the leaves scatter and what the sky sends is not in this sum; with the fill shut, the diffuse light a leaf takes out of the beam simply leaves the scene ([`fill.md`](fill.md)).

## Not built

- **Per-pixel ray sampling from the receiver up**, the more general and noisier form of the same integral ([`../exploration/open.md`](../exploration/open.md)).
- **Material as its own axis**, separate from the camera; named candidate: the enclosure's mesh panels read as sky rather than as fabric ([`../exploration/open.md`](../exploration/open.md)).

## Related

- [`overview.md`](overview.md) — where transport sits in the causal spine.
- [`source.md`](source.md) — the sample cloud transport sums over.
- [`canopy.md`](canopy.md) — the depth layers, the woody occluder and the faithful cast that transport reads.
- [`leaf.md`](leaf.md) — what a texel passes to the beam.
- [`light.md`](light.md) — the receiver's cosine, the sun's colour, diffraction's physics.
- [`fill.md`](fill.md) — the rest of the light: skylight and scattered sun through the same canopy.
- [`receivers.md`](receivers.md) — the surfaces, their geometry and their materials.
- [`sky-view.md`](sky-view.md) — the camera that reads the canopy along the eye's rays.
- [`camera.md`](camera.md) — framing, the far-field smear, the Look's tail.
- [`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md) — the extension contract a new camera owes.
- [`../contracts/preservation.md`](../contracts/preservation.md) — what every off state owes.
- [`../evidence/dead-ends.md#transport`](../evidence/dead-ends.md#transport) — the single blur, the auto-centre on the crown.
