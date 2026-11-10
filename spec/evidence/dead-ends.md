# Dead ends

*Every recorded failure, rejected alternative, superseded rule and lesson in the piece's history, kept so nobody walks the same road twice.*

This is the most valuable evidence the piece has. A model file says what komorebi is; this file says what it was not allowed to become, and why. Each entry names what was tried, what it looked like or what went wrong, the cause, what replaced it, and, where one was stated at the time, the general lesson. Numbers are kept where they are the evidence of the failure. An entry's scope (the look, the state, the conditions) is stated where it was recorded; a date appears where one was recorded, and its absence means none was. How to read these, and what a measurement from one look does and does not prove, is in [`README.md`](README.md).

The headings are the model's subsystems, in the model's order, so a model file's link lands on its own section. Within a section the order is roughly the order in which the piece met the problem. A dead end that belongs to two subsystems is told once, where its cause lives, and the other section carries one line pointing to it.

## source

### Jittered source samples

**What was tried.** Nothing shipped this way; it is the alternative the sampler was designed against: re-drawing the point-suns of the source each frame, as a stochastic area-light renderer would.

**What it would look like.** A numerical shimmer over the whole floor, which the eye cannot tell from the physical glisten of leaves trembling on their petioles.

**Why.** Sampling noise that changes per frame is visible motion that does not come from the canopy.

**What replaced it.** A fixed, frame-stable Vogel spiral with a heavy core and a sparse halo ([`../model/source.md`](../model/source.md)); the rule is a contract ([`../contracts/determinism.md`](../contracts/determinism.md)).

**The lesson.** *All visible motion comes from the canopy; none from the math.* Sampling noise must never impersonate the glisten.

### The ground ellipse inside the source

**What was tried.** Rejected at design: stretching the source disk itself into the elliptical shape the dapples take on a tilted ground.

**Why.** The ellipse is a projection of the source onto the ground, which depends on the sun's elevation and azimuth; the source is an angular distribution and knows nothing of the ground.

**What replaced it.** The source stays purely angular and circular; a 2×2 matrix built from the sun's angles converts each angular offset into a ground offset in transport ([`../model/transport.md`](../model/transport.md)). "The source stays a clean circle; transport owns the projection; the two never tangle."

## light

### Every beam landing at full strength

**What was tried.** From the first release until `sun_cosine`, the engine modelled the beam's *spectrum* through the atmosphere and not its *geometry*: every receiver took the beam at full strength whatever its incidence.

**What it looked like.** The floor read as bright under a 12° sun as under a 70° one. *Scope:* a four-frame sheet of one look with the sun at 12°, 26°, 50° and 70°; a probe on the floor read the same level in all four frames.

**Why.** Irradiance on a surface is the beam's radiance times the cosine of its incidence. Nothing applied the cosine.

**What replaced it.** The cosine law at the receiver: each surface takes its own incidence (`sin el` on the floor and the tent's crown, `cos el·|sin az|` on the vertical cloth, nothing for the eye), normalised to the zenith ([`../model/light.md`](../model/light.md)). It ships at 0, so the old convention is still every shipped look's.

### Conserving the beam with the ground ellipse

**What was tried.** The obvious first thought: the elliptical stretch of a low sun's dapples already spreads the image, so surely it thins the light.

**Why it cannot.** The ellipse stretches each dapple by `1/sin²·1/sin`, but `acc` is a cleared *fraction* of the disk, so the energy never thins however far the image stretches. The ellipse spreads the image and conserves nothing.

**What replaced it.** The receiver's cosine does the conserving ([`../model/light.md`](../model/light.md), [`../model/transport.md`](../model/transport.md)).

### A per-look normaliser for the cosine law

**What was tried.** Rejected at design: a per-look constant that would hold each look's brightness when the cosine law is turned on.

**Why.** The free constant already exists and is called `exposure`. A normaliser would be exposure folded in under another name.

**What replaced it.** A look that turns the law on re-sits its own `exposure` (`exposure/sin el` holds the dapples' linear level and lifts the shade by `1/sin el`, about ×2.3 at a 26° sun) ([`../model/light.md`](../model/light.md), [`../model/camera.md`](../model/camera.md)).

### The cosine as a multiply in the shader

**What was tried.** Rejected at design: applying the beam's cosine factor as a multiply in GLSL.

**Why.** A multiply in a shader can be contracted by the GPU compiler into a different fused multiply-add than the line it joins, so the law's off state would no longer be the old frame on some GPU.

**What replaced it.** The factor scales the sun colour's upload on the CPU; the sun colour feeds the beam alone on every surface camera, so scaling the upload is scaling the beam, and at 0 the factor is exactly 1.

### The leaves' scattered sun without the cosine

**What was tried.** Rejected at design: leaving the sunlight the leaves scatter down (`S`, the sky fill) at its old level when the beam takes its cosine.

**Why.** The beam the leaves remove is scaled at transport; without the same factor in `S` it would reappear undimmed there, and the beam/`S` split would stop conserving energy.

**What replaced it.** `S` takes the leaves' own incidence, the floor's `sin el`, since the leaves are near-horizontal ([`../model/fill.md`](../model/fill.md)).

### Air mass by 1/sin

**What was tried.** The textbook air mass, `1/sin(elevation)`, for the path the beam takes through the atmosphere.

**What goes wrong.** It diverges at the horizon, exactly where the low sun's reddening is the subject.

**What replaced it.** Air mass by Kasten–Young, inside a three-band Beer's-law atmosphere ([`../model/light.md`](../model/light.md)).

### Reading José's ride photographs as a test of the cosine law

**What was tried.** Checking the cosine law against José's photographs of bare ground, which read lit/shade about 2 to 2.6 under a 12° sun (target about 2.5) and about 6 to 8 under 45°.

**What it showed.** The engine misses the band at the authored skylight. *Scope:* `montebello` at 45°, 25°, 12° and 7°, `sun_cosine` 1, `litter` 0, `tone_map` 0, `contrast` 1, mesopic 0, exposure set per frame so the open floor lands at 0.9, sRGB decoded to linear, `acc` read per channel from a companion frame with sky and fill off. Two estimators: 17.4, 11.5, 5.6, 2.9 (each shade pixel's own beam leakage taken out) and 10.5, 6.9, 4.1, 2.6 (the literal mean of lit over shade pixels, thresholds stated). With the law off: 22.2, 22.7, 19.2, 14.3 and 12.0, 9.7, 7.6, 6.7. At 12° neither estimator is in 2–2.6; at 45° both are above 6–8.

**Why.** Not the law. (lit/shade − 1) falls ×3.6 and ×3.1 from 45° to 12°, inside the photographs' own ×3 to ×7 and beside the law's `sin 45°/sin 12°` = ×3.4. What misses is the level of the shade against the beam: the shade's fill (skylight through the canopy, `kA = 0.08·ambient_skylight` = 0.078 here, plus the leaves' scattered sun) is an authored level that does not fall with the sun (linear 0.0057 at 45°, 0.0055 at 12°, while a lit dapple completed to the full beam falls 0.099 → 0.031). The literal ratio also moves with its threshold (at 12°: 5.0, 4.7, 4.3, 4.1, 3.7 at `acc_Y` ≤ 0.02, 0.05, 0.1, 0.15, 0.25), because the shade is never pure under a low sun.

**What replaced it.** Nothing was tuned to reach the band; the skylight a look wants is its author's to set. The full table belongs to [`measurements.md`](measurements.md#light).

### A hand-grade for the dusk

**What was tried.** Rejected at design: a colour grade painted onto low-sun frames to make twilight cool and soft.

**Why.** The cooling is a real, modelable fact of perception: the rods take over as the light fails, so deep shade desaturates toward blue-grey and saturated reds darken first while the bright dapples stay in cone vision. A real mechanism earns its place over a grade.

**What replaced it.** The Purkinje (mesopic) shift, cued by a duskness ramped from the sun's elevation times the local shade darkness `acc`, gated off for a daytime sun ([`../model/light.md`](../model/light.md)).

### A prism painted on, and a true diffraction kernel

**What was tried.** Two rejected ways to make the dapples' colours split at their edges: painting a chromatic fringe over the picture, and integrating a true wavelength-dependent diffraction kernel at each gap, sized by the gap.

**Why.** The first is an artifact painted on, not a cause; the second costs a per-gap kernel the transport cannot afford.

**What replaced it.** A proxy that rides the existing transport: the geometric pinhole shift scaled per channel by `λ/λ_green`, so red is thrown wider than blue at every leaf edge. It couples dispersion to the geometric throw rather than to the gap width, which is its named limit, and it is off by default ([`../model/light.md`](../model/light.md)). It was the "second, smaller sanctioned approximation" that first broke the one-approximation rule ([principles](#principles)).

## camera

### A focal plane

**What was tried.** Rejected from the founding afternoon, and named so nobody adds it: modelling the dapples' softness as a focus effect, with a focal distance or a plane of best focus.

**Why.** A pinhole has no focus. The out-of-focus quality is set entirely by how large the source looks and how large the gap is; the blur kernel *is* the source.

**What replaced it.** The convolution of the gap map with the source's angular profile, scaled by height ([`../model/transport.md`](../model/transport.md)). The sky view reaffirmed it rather than quietly dropping it: looking at the canopy instead of its cast adds no eye depth of field, no bokeh, no near/far blur ([`../model/sky-view.md`](../model/sky-view.md)).

### Camera height as a control

**What was tried.** Rejected at design: a camera height knob for the tilted floor camera.

**Why.** For a flat floor, camera height only rescales the view, which the zoom hold cancels; it has no independent effect.

**What replaced it.** Zoom (`view_extent_m`), pitch, yaw and pan are the camera's controls ([`../model/camera.md`](../model/camera.md)).

### Blurring the glow after the tone curve

**What was tried.** Rejected at design for the cloth's lateral diffusion: blurring display-encoded pixels.

**Why.** A neighbourhood average of display-encoded pixels is not an average of light. The tone curve is steeply non-linear exactly where the glow lives (the hot dapples sit on its shoulder), so a blur after it spreads the wrong quantity and throws away the highlight energy the effect exists to redistribute.

**What replaced it.** With the glow tier on, transport writes linear HDR to a float target and the Look's tail (exposure → tone curve → contrast → gamma) sits past the blur ([`../model/camera.md`](../model/camera.md), [`../model/receivers.md`](../model/receivers.md)).

### Two copies of the tone tail

**What was tried.** Rejected when the glow tier landed: letting the direct draw and the compositing pass each carry their own copy of the Look's tail.

**Why.** Two copies that agree today drift apart later, and the gate's off state stops being honest.

**What replaced it.** One shared tail, included by both paths. "Shared source is the only thing that keeps the gate's off state honest a year from now."

### Crossing the iris gate

The vignette iris that appeared whole in one frame is told under [transitions](#the-iris-installed-in-one-frame).

## canopy

### The clustered-point scatter

**What was tried.** Before the grove, the canopy was a stand-in: leaf clusters scattered as points around the canopy centre, a fake skeleton the motion system drove as if it had joints.

**What went wrong.** It was not a tree. Gaps and clumps have to be emergent, the negative space of a grown structure, because gaps change when leaves move; a scatter has no topology for the clumping to come from, and no real joints for the wind to turn.

**What replaced it.** The grown grove: trees grown trunk → limbs → recursive sub-branches → twigs carrying the leaf clusters, leaves binned to depth layers by the height they grew to ([`../model/canopy.md`](../model/canopy.md)). `clusters_per_layer` survives only as a legacy preset key.

**The lesson.** "This is the correction that motion forces": gaps cannot be the thing you draw. Grow a skeleton and let clumping be its topology and multi-scale gaps its self-similarity.

### One tree from a central trunk

**What was tried.** Growing the canopy as a single tree from one central trunk.

**What it looked like.** A bare, bright hole over the trunk: all the foliage hangs outboard in a ring.

**What replaced it.** A grove of several trees whose crowns overlap to fill the frame, which also matches the park: several trees, the smaller ones reading denser ([`../model/canopy.md`](../model/canopy.md)).

### The single-origin hub (the dandelion)

**What was tried.** Originally every limb grew from one point, `[0,0,0]`, fanned evenly around a full circle.

**What it looked like.** The literal definition of a dandelion. Every tree read as the same spoke-burst; the tree-architecture research named it the core fault, since a single hub is botanically correct only for a palm. The model had no axis of apical control at all.

**What replaced it.** `leader_strength`: the trunk is a continuing axis and the limbs attach along it at staggered heights, so the branches meet the trunk (high leader → the excurrent cone of a conifer; low but nonzero → a few near-base forks and a decurrent dome). At 0 it is still the old single hub, which is now the `palm` species: "the old piña-colada wasn't wrong, just stuck rendering every tree as a palm" ([`../model/canopy.md`](../model/canopy.md)).

### The de-dandelion patch

**What was tried.** A first cosmetic fix for the hub: sliding the *drawn* limb bases off the hub to hide it.

**What went wrong.** The topology was still one fork, and the branches floated, disconnected from the trunk, visibly so in the grove preview.

**What replaced it.** Retired for the real mechanism, the leader above.

### Golden-angle limbs as the wind's pivot

**What was tried.** Rejected when the leader landed: letting the golden-angle phyllotaxis spiral that now places the limbs also be the basis the wind's torque is resolved against.

**Why.** An uneven fan of mechanical pivots would let a gust spin the canopy rather than lean it.

**What replaced it.** The rendered divergence angle and the mechanical pivot are decoupled: limbs are drawn on the spiral, while the torque basis stays a balanced fan ([`../model/motion.md`](../model/motion.md)).

### Height scaled by the plan-fill factor

**What was tried.** The per-tree normalisation stretches the plan so the widest twig fills the crown radius (`s = crown/mr`), and the old code scaled the height by that same `s`.

**What went wrong.** For a narrow-plan species (steep branches → tiny `mr` → `s` of 6 or more) the height explodes: `columnar` computed to about 47 m once the faithful cast used real heights.

**What replaced it.** The height scale floors the plan radius: a broad tree's height is untouched, a narrow one is capped at a fixed ratio of the crown radius times its aspect ([`../model/canopy.md`](../model/canopy.md)). Decoupling height from plan fill was the prerequisite for `crown_aspect`.

### The skeleton grammar's plane mode for the veins

**What was tried.** The branching rule was made a function with a `plane` mode that keeps growth in a flat sheet, meant for the leaf's veins: the same grammar all the way down.

**What went wrong.** Nothing calls it. A maple's laterals leave the vein *along its length*, and this grammar (children only at a node's tip) cannot grow that; a beech's secondaries leave its midrib along its length too.

**What replaced it.** Dedicated leaf grammars, the palmate maple and the pinnate beech ([`../model/leaf.md`](../model/leaf.md)). The plane mode has no caller; its promise is still held by a test.

### Wood stamped into the depth layers (the snowflake)

**What was tried.** The first woody shadow, for a backlit tree seen from the side, stamped each branch into the leaf depth layers.

**What it looked like.** It shattered. A branch spanning two layers *jumped*, and the continuously cast trunk floated free of the snapped branches: a "snowflake".

**Why.** Layer quantisation snaps a continuous branch's height to a few discrete values, and at a low sun the shadow shift between adjacent layers is about a metre. Leaves are a cloud and do not care; thin continuous wood does.

**What replaced it.** A continuous-height analytic occluder for the trunk and main limbs: line segments whose endpoint heights map through the same crown curve the leaves bin by, so a limb's base meets the trunk at a shared height and the whole shadow connects. The fine sub-branches are dropped on that path; the faithful cast bakes the whole skeleton as real geometry ([`../model/canopy.md`](../model/canopy.md)). The same rule later forbade binning long wood into the sky view's layers ([sky-view](#long-wood-binned-into-the-seen-layers)) and stamping the window grid into a layer ([receivers](#the-window-grid-stamped-into-a-depth-layer)).

### The analytic wood evaluated per sample

**What was tried.** Evaluating the analytic woody occluder once per source sample, inside the many-suns loop.

**What went wrong.** It stalled the GPU.

**What replaced it.** One evaluation per pixel along the central sun direction, with a soft edge that grows with height to stand in for the area light's penumbra ([`../model/canopy.md`](../model/canopy.md)).

### The layer band under a tree that is seen (the exploding sandwich)

**What was tried.** Casting a tree meant to be seen as an object (the standing scene, the curtain) through the depth-layer bake that serves the overhead park.

**What it looked like.** The layer band betrays it: leaves snap to a few flat heights, decoupled from the continuous twig they grew on, so what the leaves cast is no longer the tree. José called it the "exploding sandwich".

**Why.** In the park you never see the tree, so where a leaf is relative to its twig is not even a question; the moment the tree is the subject, it is.

**What replaced it.** `faithful_canopy`, the gated opt-out from depth discretisation: the actual geometry cast at real grown heights, leaves and the whole skeleton, so the shadow *is* the tree ([`../model/canopy.md`](../model/canopy.md)). The layer path stays the park's default.

### The faithful cast without its medium band

**What was tried.** At first the faithful canopy did not carry the medium wind band (the twigs flexing differently from one another).

**Why, the honest reason worth keeping.** The baked wood twigs rotated about the *limb*, while the leaf model pivoted about a *synthetic* stem joint built from `stem_length`, which is not the wood twig's real base. Driving the leaves by a twig bend the wood could not share slid them off their now visible, opaque twigs; "leaves sit on their twigs" must hold under motion, not only at rest. So the band was dropped and registration bought with stillness.

**What replaced it.** Not a smaller amplitude but **one shared joint**: growth records each terminal twig's real base, and both the leaves and that twig's own wood swing about it by the same per-twig angle, in the same order (twig about its base, then twig and leaves together about the limb). Registration holds by construction ([`../model/canopy.md`](../model/canopy.md), [`../model/motion.md`](../model/motion.md)).

**The lesson.** A grown twig's base is offset from its clump toward the parent, so it already *is* a stem joint; the layer path invents one only because it has no wood to borrow from. Where two things must stay registered, give them one rule.

### An assumed cast frame

**What was tried.** Bounding the faithful cast frame by an assumed `±canopy_extent/2` box.

**What went wrong.** It clipped a wide grove's outer crown.

**What replaced it.** The cast frame is bounded by the real plan extent of the leaves and wood, padded for sway and drift, and swept over the real height range ([`../model/canopy.md`](../model/canopy.md)).

### The wood's rim by the leaf's edge softness

**What was tried.** Rejected: giving the faithful wood the leaves' soft edge (`edge_softness`).

**Why.** That softness models a leaf half-covering a texel; on thin twigs it would let them go translucent.

**What replaced it.** A deliberately tight anti-alias on the wood, so thin twigs stay opaque; the wood's soft penumbra comes from the per-sample integration over the disk, not from its rim.

### A trunk laid as a flat ribbon

**What was tried.** Implied by the fix: laying the faithful wood's capsule width across the segment before projecting it.

**What it looked like.** A vertical trunk would read as a flat ribbon at some azimuths.

**What replaced it.** The capsule is built perpendicular to the shadow spine: both endpoints are projected first, and the width is laid across the streak, so a trunk reads round at every azimuth.

### Fullness by leaf count (the naked canopy)

**What was tried.** Making a species read full by raising its leaf count.

**What it looked like.** A small-leaf species scattered as thin specks that never tiled the cluster; the canopy read *naked*, a dark skeleton with ghost-faint leaves, however many leaves were added.

**Why.** A cluster's shadow is its areal coverage, (leaf count × leaf area) ⁄ cluster-disc area. With `cluster_spread_m` fixed and the wood opaque, a sparse cluster casts about 80 % transmittance. Coverage goes as leaf area; the count barely moves it.

**What replaced it.** Leaf size is the lever: the species bundles carry `leaf_size_m` and `foliage_density` tuned for coverage, not raw count ([`../model/canopy.md`](../model/canopy.md)).

### The wheel crown

**What was tried.** Hanging every leaf off a twig tip, as the grammar did: only a terminal node bears a cluster.

**What it looked like.** José, looking down at park 1 with the sun at 70°: *"looked off, like it's broken … I don't think it'd look like that irl."* From above a crown was a wheel: a ring of leaves at 0.4–0.6 of the crown's radius, a core a third as dense, bare limbs for spokes, and with the wood drawn the spokes over the thin core broke the blob. *Scope:* park 1, R 1.28 / 2.07 m, 0.081 of the leaves inside 0.3 R, the core's area density down to 0.29 of its peak.

**Why.** No twig tip lies within 0.2 R; the core holds only the bare level-1 limbs.

**Rejected on the way.** The faithful twig hug already trails 58 % of park 1's leaves past the twig base, so it is not the lever. Hanging leaves on the twig and its *parent* does not reach the core either: the parent ends near 0.4 R, and a simulation with half the leaves on twig and parent reached 0.063 inside 0.3 R where the whole path reached 0.127 with 0.3 of them.

**What replaced it.** `inner_leaves`: a share of each twig's leaves hangs back along the whole path of its ancestors to the trunk, thinning inward and never to none, as the shade leaves of a real crown do on the older wood ([`../model/canopy.md`](../model/canopy.md)).

### Per-leaf numbers drawn from the growth stream

**What was tried.** Rejected wherever a new per-leaf or per-tree number was needed (a turn clock, a capacity, a drop day, an outline variant, a tree's lead, an inner-leaf placement): drawing it from the growth, arrangement or wind random streams.

**Why.** One more draw from any of those streams re-seeds every grove ever grown, so every shipped look would reshuffle.

**What replaced it.** Every such number is a pure hash of the leaf's or tree's address on a salt of its own ([`../contracts/determinism.md`](../contracts/determinism.md)). Keyed by (cluster, leaf) rather than a running index, a leaf also keeps its identity when the tree count or density morphs, so a leaf that turns red stays that leaf.

### The empty faithful bake

**What was tried.** The faithful bake returned early on an empty leaf set, a guard for an empty grove.

**What went wrong.** When `leaf_drop` 1 reached leaf-off, the pre-integrated shadow was left as it was: zero on a fresh engine, so the whole floor went black (×0.36 of the leafy frame on `park 1` and on `curtain 1`), and the last leafy bake on a live one.

**What replaced it.** An empty leaf set takes the ordinary path: no leaves drawn, the wood if there is any, and the accumulator's weights summing to 1 where nothing shades. A bare faithful canopy bakes its wood, not nothing.

### An integer tree count

**What was tried.** Treating `tree_count` as an integer.

**What went wrong.** A change of count popped a new layout instead of morphing.

**What replaced it.** A continuous count: `floor` full trees plus a marginal tree faded in by the remainder, with trees appended at the end of the growth stream, so a fractional count only adds or removes the last tree and integer counts render exactly as before ([`../model/canopy.md`](../model/canopy.md), [`../model/transitions.md`](../model/transitions.md)).

### Density changes by regrow alone, and tree count by reweighting

**What was tried.** Two paths were weighed for a summer density morph: regrowing every frame, or reweighting the cached leaves.

**What was found.** Each clump resets its arrangement and wind streams and a leaf consumes the same draws at any count, so with the structure fixed a density change moves only the active prefix and its marginal coverage; reweighting a cached larger prefix is exact. The same shortcut does **not** hold for `tree_count`: a count change re-spaces existing trunks and, outside a standing scene, rescales crowns, so marginal-tree coverage alone is insufficient.

**What replaced it.** Density reweights a cached capacity inside a deliberately summer-only gate; tree count still regrows ([`../model/season.md`](../model/season.md)).

## leaf

### The leaf as stained glass (the mid-fall mud)

**What was tried.** Until `leaf_diffuse`, every leaf's transmittance was *ballistic*: `e^(−τ)` of a straight ray, so every leaf painted its own colour as a sharp image inside its own shadow.

**What it looked like.** Two overlapping leaves of complementary colours, green over red, multiplied to near-black: the mid-fall "mud".

**Why.** A real leaf is not stained glass. The mesophyll scatters what it passes, so a leaf's transmitted light is almost all diffuse, like frosted glass; a leaf four metres up throws a *dark* shadow and its colour spreads over the floor beneath it. The colour of shade is collective.

**What replaced it.** The ballistic/diffuse split: the beam keeps `(1−d)·T` as a neutral depth `k = −ln(1−d)` on top of the leaf's own, and the diffuse share is emitted into the sky fill ([`../model/leaf.md`](../model/leaf.md), [`../model/fill.md`](../model/fill.md)).

### The texel read as a slab (dead end, kept)

**What was tried.** The split was first built on the *slab* at every reader: the baked pair (depth `τ = Σ τ_i·cov_i`, coverage `c`) was taken for a slab of depth τ, so the beam was `e^(−τ − k·c)` at the tap and the glow `t·(1 − e^(−k·c))`.

**What it looked like.** Right for the leaf, wrong for its edge, and loud twice. In the lantern a cream **rim** round every leaf, up to ×2.3 (blue), ×1.7 (red), ×1.2 (green) of its own interior's glow, brightest in the channels the leaf absorbs. On the floor a dark **halo** round every ballistic leaf shadow: at a texel 30 % under a leaf of depth 2.8 (blue), the beam read 0.18 where the mixture gives 0.70; the slab read the texel as a thin bright leaf of depth 0.84 (`t = 0.43`) where it is 70 % open sky and 30 % dark leaf (`T = 0.72`). The fill over-emitted at rims too, hidden by its hemisphere and its mip. Nearly half of every stamp is partial (44 % of the ellipse's area at `edge_softness` 0.25), so this was no corner of the picture.

*Measured* (the engine's own taps on the layers it baked): the rim at ×2.26 of the interior (R/G/B 1.65/1.16/2.26, `canopy 1` at `leaf_diffuse` 0.95); the soft-edge band's mean beam ×0.43 of the mixture's on `afternoon 7`, ×0.44/0.51/0.40 on the faithful stamp. After the fix: ×0.95 and ×1.000.

**Why.** The bake averages **depth** over a texel, where light averages **transmittance**, and `e^(−mean τ)` is not `mean e^(−τ)`: Jensen, in the other direction from the fill's (there it forbids blurring the layers, here it forbids reading the average as a leaf). The soft edge had always been depth-averaged (the bake's own comment called it "honest area-averaging"), so the same darkening sits in every `leaf_diffuse` 0 render. The split added a second reading of the same texel at `k > 0`, where the error multiplied instead of sitting quietly in a leaf's penumbra.

**What replaced it.** The texel read as a **mixture** of one representative leaf and a gap (`texelMix`, one shared function for every reader): `τ̄ = τ/a`, `T = (1−a) + a·e^(−τ̄)`, `T_b = (1−a) + a·e^(−τ̄−κ)`, emission `T − T_b` ([`../model/leaf.md`](../model/leaf.md)). At `d = 0` the slab is kept by default for the old frames, and `edge_area` is the rung that reads the mixture there too (decision 33; it ships off, the look being José's call).

**The lesson.** *The error was always there; the split only made it loud.* The same dead end, read along the eye's ray, is told under [sky-view](#the-soft-edge-that-glowed).

### The marginal fade on coverage alone

**What was tried.** Building the ballistic shadow on the baked coverage alone, while the fractional (marginal) leaf's fade was folded only into τ.

**What went wrong.** The shadow popped to full weight the instant the leaf existed: the mixture would read its τ as a leaf over its whole footprint, a full leaf's `k` on a leaf that is 0.005 there. *Measured* on the slab draft: stepping a leaf count from none to 0.005 of a leaf moved the frame by 39 grey levels with alpha unfaded, against 2 with the fade.

**What replaced it.** The fade rides as its own per-leaf attribute and multiplies coverage, the same lever τ rides ([`../model/leaf.md`](../model/leaf.md), [`../contracts/continuity.md`](../contracts/continuity.md)).

### A 0..1 blend for the edge law

**What was tried.** Rejected: making `edge_area` a continuous blend between the slab and the mixture.

**Why.** A blend of two readings of one texel is a transmittance no texel has.

**What replaced it.** A boolean; a transition snaps it under the bloom ([`../model/leaf.md`](../model/leaf.md)).

### The glow proxy's hue from the mixture

**What was tried.** With `edge_area` on at `d = 0`, normalising the old glow proxy's hue from the mixture `t`.

**What went wrong.** The gap's share passes every channel alike, so it whitened the hue into one the leaf never had; the `canopy 1` rim peak read ×1.39 of the interior.

**What replaced it.** The hue is taken from the leaf's own transmittance `e^(−τ̄)`, and the level from the mixture; the rim peak reads ×0.95 (×1.26 in blue with the knob off).

### A per-channel gain on a leaf's τ

**What was tried.** Rejected at design: brightening a deep autumn leaf's veins with a per-channel gain on its optical depth.

**Why.** It cannot do what a leaf does. Beer's law is convex, so light through a leaf of bright walls beside dark cells is a mean of *transmittances*, `T = f_w·e^(−τ_wall) + (1−f_w)·e^(−τ_cell)`; a small share of clear wall lifts a deep leaf far more than the mean τ suggests. A red leaf held to the sky glows orange at its veins.

**What replaced it.** The sieve mixture, with `wall_fraction` as the wall share and the walls making no anthocyanin ([`../model/leaf.md`](../model/leaf.md)).

### The star maple (dead end, kept)

**What was tried.** The first maple outline: laterals at ±62°, basals at ±105° of length 0.55, rho 0.19, no clip, "calibrated on José's pressed leaves", which were not these leaves.

**What it looked like.** A five-pointed star none of his leaves resembles. José, looking at the sheets: *"they all look the same to me."* By the same measure applied to his thirteen maples (2026-10-09): sinuses twice his (0.53 against 0.26); laterals where his sinuses are (62° against 43°); a blade reaching 0.30 behind its petiole (his 0.03); solidity 0.65, below all thirteen of his (mean 0.76), and a solidity spread (sd 0.007) a fifth of his (0.035); five lobe maxima every time against his 3–5. Each of his leaves was 0.29–0.67 from the nearest of 800 engine maples, while his leaves are 0.04–0.45 from one another.

**Why.** The first bands (five lobes, laterals 52–72°, sinus 0.35–0.65) had been fitted to the star's own output and held it in place. The test proved the grammar agreed with itself.

**What replaced it.** The grammar recalibrated on José's thirteen maples, read with the test's own measure, including a truncate base (`r(150°)` from 0.30 to 0.09) ([`../model/leaf.md`](../model/leaf.md); the table is in [`measurements.md`](measurements.md#leaf)).

**The lesson.** *Read the measure on the leaves it claims to be, with the same code, before the bands are written.*

### The mitten (dead end, kept)

**What was tried.** The first numbers, a design partner's, grew a three- or four-lobed mitten: laterals at ±40°, secondaries filling the sinuses, one lamina radius for every vein. The calibrated grammar's first taper was then linear.

**Why it failed.** *A wide lobe and a deep sinus cannot both come from a linear taper:* the flank is a cone, and a cone wide enough for a 25–35° tip fills the sinus beside it.

**What replaced it.** A lamina that keeps its width over the first 0.6 of the vein, then thins to the tip, so both a broad lobe and a deep sinus can stand.

### Bands that demand every leaf inside José's range

**What was tried.** Test bands requiring every generated leaf's sinus inside his 0.15–0.36 *and* its solidity inside 0.66–0.80.

**Why it fails.** It is not satisfiable: the grammar's per-primary jitter (±4°, ±10 %) alone spreads one leaf's sinus over 0.18–0.40 at any mean.

**What replaced it.** The means sit in his range and each leaf inside a wider envelope.

### An outline squashed by the look's aspect

**What was tried.** The hang loop divided every leaf's width by `leaf_aspect`, an outline's included.

**What it looked like.** José, 2026-10-09, of his ultraviolet maple: *"last night i actually tried rendering maple and it looked so thin and weird."* His projector look (maple, aspect 1.75, 0.1 m) squashed a blade whose width over length is 1.27–1.71 to 0.73–0.98, narrower than every one of his thirteen leaves (1.01–1.57), and the held-leaf inset, which never read the aspect, showed another leaf than the canopy's. Before the fix the same pair was max Δ103 apart on `memories`.

**Why.** An outline has its own width-to-length; what the look's aspect means for it is the leaf's area.

**Rejected alternatives.** The shape select setting aspect 1 (a loaded export, his, still squashes, and the leaf area jumps ×1.75, so his crown goes darker); dividing by the aspect for the ellipse alone and keeping the size (the area jumps ×1.75 the same); keeping the stretch (no real leaf is stretched, and the held leaf would have to follow).

**What replaced it.** An outline takes the look's leaf **area**, never its aspect: `A = B0 = size/(2√aspect)`. A maple at 1.75 is a smaller maple, never a thin one ([`../model/leaf.md`](../model/leaf.md)).

### A tip-scaled ratio for the outline's mask

**What was tried.** Rejected: reading an outline's mask as the ratio `|l|/r(θ)`.

**Why.** It would double the soft edge's width at a tip.

**What replaced it.** `q' = |l| − r(θ) + 1`, which keeps the edge's width at a tip and in a sinus.

### Lobed blades on the ellipse's angles

**What was tried.** Giving outlined leaves the grove's orientation draw, which lies on [0, π): every orientation an ellipse has.

**What went wrong.** Only half of a lobed blade's orientations; every tip pointed into one half-plane.

**What replaced it.** Half the hanging leaves are turned a half turn by a hash of their own; the ellipse keeps its angles to the bit.

### Voronoi for the areole maze

**What was tried.** Rejected for the held-leaf fixture: a Voronoi tessellation for the cells between the veins.

**Why.** Voronoi gives 120° Y-junctions and no hierarchy, where a leaf's veins meet at right angles and the older ones are wider.

**What replaced it.** Successive domain division seeded by the grown veins (Bohn, Andreotti & Douady): T-junctions near square, wall width by order ([`../model/leaf.md`](../model/leaf.md)).

### Leaf variety too narrow, and nothing between trees

**What was tried.** The first variety was eight outline variants per species, varying vein angles by ±4° and lengths by ±10 %.

**What it looked like.** José, 2026-10-09: *"we need much more leaf diversity, more species and more variability within species … looking at those sheets, they all look the same to me."* Two causes: the mean was wrong (the star, above), and the spread was narrow on the axes the eye reads. His thirteen are 0.19 from one another on average (r(θ), mirror-min RMS); the first maple's eight were 0.105 and the recalibrated one's 0.09. What varied only moved a finger of the same leaf, and nothing at all differed between trees.

**What replaced it.** `leaf_variety`, three levels: the tree's genotype, a family of eight outlines per genotype by light class, and the leaf placed in its class by its rank of light ([`../model/leaf.md`](../model/leaf.md)).

### Rejected designs for leaf variety

- **An atlas.** Every row is still a radial profile, so the coverage mask stays the one thing an outline carries.
- **A continuous per-leaf outline.** A texture row per leaf; the rows are the classes.
- **The blended exposure (`exposureBlend`) for the light class.** Shape is not season; `exposure_absolute` is a season key, so the class reads the summer rank.
- **The inner-leaves position as a proxy for light.** One light, two consequences: the class reads the same exposure rank that reddens the sun side.
- **Scaling every spread by 1.6** to reach his 0.19–0.22: measured in the design pass, it loses the central lobe on one row in 64 on four seeds in five and spans solidity 0.53–0.96. The slider instead runs to 1.5. Which of the two José means is his to say ([`../exploration/open.md`](../exploration/open.md)).

### A packing width of 512

**What was tried.** The first design packed the outline row into the fraction of the cluster id at width 512, "exact for every cluster the engine allows".

**What went wrong.** It is exact only to 2^15 clusters, and a grove holds one species' texture.

**What replaced it.** Width 128, exact in float32 for any cluster below 2^17; a mixed grove will set its own.

### A divide by a uniform in the fragment shader

**What was tried.** Rejected: replacing the fragment side's literal `/8.0` with a divide by a uniform.

**Why.** A divide by a uniform may compile to a multiply by a reciprocal (2.5 ULP), where a divide by a literal may be exact, so the unvaried frame would move. The vertex side's multiply by a power-of-two uniform is correctly rounded and was safe.

**What replaced it.** The literal line is kept, and a uniform branch overrides it for a varied grove alone.

## season

### Exposure to the look's live sun

**What was tried.** Rejected at design: ordering the autumn turn by each leaf's exposure to the look's own sun.

**Why.** Pigment integrates over weeks. The look's sun (a time of day, an authored angle, one that moves under a transition) is not a canopy parameter, and a look must not repaint its leaves because its sun moved.

**What replaced it.** One representative season sun, 45° elevation from the south ([`../model/season.md`](../model/season.md)).

### Raw exposure as the order of the turn

**What was tried.** Mapping a leaf's raw exposure directly to its turn time and red capacity.

**Why it was not the default.** Raw exposure is a property of how dense a look is (a crowded grove's mean is about 0.3, an open one's about 0.7), so a dense look would turn later and greener, an open one earlier, as its density moved: repainting by density.

**What replaced it.** The leaf's **rank** in its grove's exposure, uniform whatever the density, so the look's schedule and mean red are untouched by construction. José later asked for the absolute light too ("Both, as a blend"), so `exposure_absolute` blends the two; at 1 the repainting by density is back, by design and by the author's choice ([`../model/season.md`](../model/season.md)).

### The middle rank for exact ties (a coherent wave)

**What was tried.** The rank's law for equals: every leaf whose representative ray crosses no leaf area has exposure exactly 1 (the up-sun shell and the top of the stand, 3.4 % of `afternoon 7`, 3.7 % of `memories`, 4.1 % of `park 1`, 0.4 % of `canopy 2`), and the whole group shared the middle rank.

**What it looked like.** One turn phase at `turn_exposure` 1, and at `drop_exposure` 1 one drop day and one fade: a surface dimming as one where the season should trickle. At `leaf_drop` 1 the first day, about 0.705, was the whole group's. *Measured, the wave was coherence, not count:* the worst sliding fade window held 1.50× its uniform share on `afternoon 7`, 1.55× on `memories`, 1.61× on `park 1`, and 2.42× on the dense test grove.

**What replaced it.** Each leaf's own turn clock breaks the tie: within a run of equal light, the leaf that would have started first on its own takes the higher rank. That is the process, not a coin. The worst window is now its uniform share on every look (1.0, 1.1, 1.2) ([`../model/season.md`](../model/season.md)). Not reached: at `exposure_absolute` 1 the raw light is literally equal and the group still goes together.

### Other keys for the tie

Rejected for the tie-break, and kept as the reasons:

- **The drop's own hash**, which would order the shell's fall independently of its turn.
- **A fresh salt**, a third clock with no process behind it.
- **Spatial keys** (height in the band, distance to the sun-side edge), which order the shell as a sweep. That is a coherent wave again, what calm forbids; the hash is right *because* it is incoherent.

### Laws rejected for one tree ahead of its neighbours

José (2026-10-08) asked for one tree to turn ahead of its own kind (photo 0631: one fully orange sugar maple among green-yellow neighbours); his decisions (2026-10-09) made the tree clock skewed, a few trees running early. The lead adopted is `Δ = −S·v³`. Rejected:

- **A threshold share** (a coin per tree: early or not). Half the two-tree seeds would show no early tree at all, and a coin is blank or loud, never a gradient.
- **v²**: a spread, not a skew; the typical tree would already be well ahead.
- **v⁴**: too thin a tail for five trees (one in six beyond S/2), so a small grove would seldom show an early tree.
- **A centred law (±S)**: half the trees would run late, and the look's schedule would be nobody's.
- **A mean held by construction** (subtracting the grove's own mean depth): a tree would change its numbers as the grove grew, repainting every tree each time one is added.
- **Rank within each tree**: it would erase light across crowns, and a tree in another's shade would turn as early as one in the open.

([`../model/season.md`](../model/season.md))

### Leaves letting go before they turn

**What was tried.** The first abscission: a second per-leaf clock behind the turn, ordered by the same light but not bound to the leaf's own turn.

**What it looked like.** Fable's park-1 diagnosis, which José accepted: at 0.78 (sheet k5) "the tree feels disconnected from" its carpet, a lemon carpet under a dark crown. A leaf could let go while it was a third of the way to yellow; the most exposed leaf went at s = 0.259 everywhere.

**Why.** In life abscission follows senescence: a leaf lets go after it has turned, with a lag, and the sunlit ones first because they finished first (José's beech: the leaves go brown, and then go).

**What replaced it.** `drop_after_turn`: each leaf turns over a window of its own length from its own start, and its day is the end of that window plus a lag. Off by default; it shipped on six looks (`montebello`, `park fall`, `forest floor`, `the yellow tree`, `montebello, rain`, `cherry blossom`), all six accepted as shipped on 2026-11-09 ([`../model/season.md`](../model/season.md), [`../contracts/looks.md`](../contracts/looks.md)).

### Binding the drop to today's end of the turn

**What was tried.** The first thought for the fix: "the turn's end plus a lag".

**Why it fails.** The turn's upper edge is common: every leaf ends at the same phenology, so that day would be one day for every leaf, with no order and nothing down before it. Each leaf needs a window of its own.

### A hash of its own for the after-turn day

**What was tried.** Rejected: drawing the after-turn drop day from a new per-leaf hash.

**Why.** The turn's own start is already a strict progression; a hash would be a third clock.

### Species fall values in the species bundles

**What was tried.** Rejected: putting the provisional species `leaf_drop` values (maple 1, red oak 0.8, beech 0.5) into the tree species bundles.

**Why.** The species bundles are shape-only by contract. A species-colour table is where those and the pigment family would live ([`../exploration/open.md`](../exploration/open.md)).

### The season played live in wide steps

**What was tried.** A rate-gated catch-up while dragging the season slider, applying whatever phenology step the gate allowed.

**What went wrong.** A leaf fades over a fixed window of phenology; one applied step wider than half of it pops the leaves whose fade it jumps. *Measured:* a catch-up stepped about 0.018 and would thin about 6 % of `afternoon 7` as salt-and-pepper in one frame.

**What replaced it.** Each applied step of the season is clamped to half a fade window; while it binds the season moves slower than the hand, and the landing snaps to the stop's exact values ([`../contracts/continuity.md`](../contracts/continuity.md)).

### The season by regrow

**What was tried.** Every change of the season regrew the whole grove.

**What went wrong.** The fall frame cost about four times summer, and the season slider fell back to applying on release at the turn. *Scope:* median of 11 at a fall frame, phenology 0.9: `afternoon 7` 62 ms (summer's own regrow 15), the void 154 ms, `montebello` 12 ms.

**Why.** Nothing in the fall arithmetic needs the skeleton regrown: the skeleton, every leaf's place and the exposure field are the grove's; only τ, retention, compaction and the litter move.

**What replaced it.** Re-seasoning the cached grove in one pass over typed arrays, identical to a fresh build at the same params: about 6, 14 and 1 ms ([`../model/season.md`](../model/season.md)).

### The litter's first colour law (dead end, kept as the lesson)

**What was tried.** `0.35·leafHue(e^(−τ))`: laying the leaf's *transmittance* hue, brightness divided out, on the floor.

**What it looked like.** Maximally saturated, blue at 2 % of the peak: an orange-yellow stain.

**Why.** A fallen leaf is seen by reflection, and a leaf reflects because it scatters: the strongly absorbed channel comes back from the shallowest scatterings, so reflectance saturates far less than transmittance. What a backlit leaf passes and what a face-up leaf returns are different objects; the carpet is not the canopy's cast laid on the ground.

**What replaced it.** The opaque pile, Kubelka–Munk `R∞`, with one provisional unknown κ (2, chosen by José on 2026-10-08 from the review sheets in `test-gl/out/review/2026-10-08/`, comparing κ 1, 2, 4 and the stain law on `montebello`, `afternoon 7` and the redhead) ([`../model/season.md`](../model/season.md)).

### Browning mixed in reflectance, or by adding optical depths

**What was tried.** Two ways of ageing a fallen leaf toward brown were considered: mixing the fresh reflectance with the brown reflectance, and adding a brown optical depth to the leaf's own τ.

**What went wrong.** A reflectance mix would need the Kubelka–Munk inversion run on the mixed state before wetness could act on it; and adding τ's can never raise a red leaf's green toward brown's, since absorption only ever deepens a channel.

**Why.** Browning is a change in the pigments, and the pigments live in the absorption-to-scattering ratio `q`, not in the reflectance.

**What replaced it.** The mix is made in K-space, inside `q`: `q = κ·((1 − s)·τ + s·τ_brown)/S_w`. It is linear in the pigments, monotone per channel toward brown, and exact at age 1, which is also the hook P4b's browning process will replace ([`../model/season.md`](../model/season.md)).

### The textbook Kubelka–Munk inverse

**What was tried.** `R = 1 + X − √(X² + 2X)`, the textbook form of the reflectance of an opaque pile.

**What went wrong.** It is NaN at `R = 0` and cancels badly below `R ≈ 10⁻⁴`.

**What replaced it.** The stable pair `kmInvert(R) = (1 − R)²/(2R)` and `kmReflect(X) = 1/(1 + X + √(X² + 2X))`.

### Montebello's dirt at full strength

**What was tried.** The carpet laid over `montebello`'s authored dirt floor as it was.

**What it looked like.** The carpet vanished: on `park 1`'s dirt a montebello leaf matched the floor in chroma and sat at 1.1× its luminance.

**Why.** Real soil reflects 0.1–0.2; the authored dirt was brighter than the leaves lying on it.

**What replaced it.** `montebello`'s dirt was cut to ×0.6 (José, 2026-10-08, from the same sheets as κ), and the look ships damp at `leaf_wetness` 0.5 ([`../contracts/looks.md`](../contracts/looks.md)).

### Wetness as a canopy key

**What was tried.** Classifying `leaf_wetness` with the canopy keys, read at regrow.

**What went wrong.** A canopy key regrows the whole grove to re-tint the carpet, which a live writer (the rain coupling, P8) would have to do every frame; and macros may never write canopy keys, so rain could not drive it at all.

**What replaced it.** `leaf_wetness` is a MORPH key: the carpet's re-bake signature notices it and only the carpet re-bakes, with no regrow ([`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).

### A straight-alpha carpet

**What was tried.** Blending the litter stamps with straight alpha.

**What went wrong.** Straight alpha squares the coverage where leaves overlap, and a bilinear read or a mip darkens every leaf edge toward the empty texels' black.

**Why.** A texel of the carpet is a mixture of leaf and gap, so its reads must average coverage-weighted colour.

**What replaced it.** A premultiplied RGBA8 texture blended `ONE, ONE_MINUS_SRC_ALPHA`, so alpha accumulates as `1 − Π(1 − a)` and the reads and mips average the right quantity ([`../model/season.md`](../model/season.md)).

### The canopy's penumbra mask on a fallen leaf

**What was tried.** Stamping a fallen leaf with the soft mask the canopy's leaves are baked with.

**What went wrong.** That mask is how a leaf throws a shadow, not what a leaf looks like; a leaf at height zero casts nothing and has no penumbra.

**What replaced it.** A crisp one-texel anti-aliased rim on a flat ellipse or outline, the leaf's own `A` and face-on `B0`, unforeshortened.

### The stamp quad cut at the ellipse (found by measuring)

**What was tried.** Drawing each litter stamp's quad exactly the size of the ellipse.

**What went wrong.** A fragment outside the quad is never made, and the anti-aliasing ramp lies half outside the ellipse, so every leaf's tips were cut at 50 % coverage: sixteen sub-texel leaves kept ×0.80 of their area.

**What replaced it.** The quad is drawn a texel and a half wider than the stamp all round; a leaf smaller than a texel is drawn at three quarters of a texel's half-extent with its alpha spent for the area it gained (which over-counts so small a stamp by about a fifth, measured ×1.26, and is named) ([`measurements.md#season`](measurements.md#season)).

### Litter that accumulates or moves at run time

**What was considered.** A carpet that builds up as leaves fall during a session, and that skitters in a gust or drifts in a breeze.

**Why it was rejected.** José's decision: the litter does not accumulate at runtime, and it does not move. The carpet must stay a function of (phenology, seed) so the same look is the same carpet whenever it is drawn; and a carpet that skittered would trade calm for restlessness.

**What stands.** The carpet is baked once per regrow, noticed when a number it depends on moves, never for the live wind, the sun or the fill ([`../model/season.md`](../model/season.md), [`../contracts/determinism.md`](../contracts/determinism.md)).

### A fallen leaf's colour frozen at its day

**What was considered.** Whether a leaf that has fallen keeps the colour it had on the day `D` it let go.

**Why it was rejected.** The turn goes on after a leaf has fallen; what the leaf's own pigments can no longer say is said by the age mix toward brown.

**What stands.** The litter record carries the leaf's τ at the grove's phenology *now*, and `litter_age` carries "it has been lying there a while".

### The carpet baked at the regrow

**What was tried.** Baking the carpet inside the regrow that produced the litter list.

**What went wrong.** Routes that do not regrow (a context restore, an editor slider on `litter_age` or `litter_drift_m`, a phenology tween) would have missed it.

**What replaced it.** `refreshLitter` runs once per frame before any target is bound, like the fill's refresh, and re-bakes exactly when a number the carpet is a function of has moved ([`../implementation.md`](../implementation.md)).

### Landing by the live wind

**What was considered.** Carrying a falling leaf by the gusts and the weather's veer.

**Why it was rejected.** Those are functions of the clock; the carpet must stay a function of (phenology, seed).

**What stands.** A leaf lands at `(x, y) + h·litter_drift_m·(cos, sin)(wind_direction_deg) + σ·gauss`: the authored season wind alone, with a scatter drawn from the leaf's own litter stream ([`../model/season.md`](../model/season.md)).

## transport

### A single global blur

**What was tried.** Considered and rejected at the founding: render one flat gap map and blur it once.

**What it looks like.** It produces sun-images and penumbrae, but gives every dapple the same softness; it cannot vary blur with depth, so it reads as "a photo with a Gaussian blur", not light through a tree.

**What replaced it.** Many suns: sum the sharp shadows cast by a cloud of point-suns, each layer shifted by its height times the sample's angle, so higher foliage blurs more for free ([`../model/transport.md`](../model/transport.md)). Per-pixel ray sampling from the ground up was noted as the same computation, more general but noisier, and not the starting point.

### No bulk shift for a tree that stands in the scene

**What was tried.** The park model maps the source's sample *offsets* to ground displacements, but its centre to zero shift, so every shadow lands directly under its occluder.

**What went wrong.** For a discrete tree, a vertical trunk's "shadow" collapses to a small fuzzy blob at its own foot instead of a streak, and the crown's shadow sits on top of the tree instead of being cast over there. For the endless overhead canopy this is invisible, since a bulk translation of an endless field shows nothing.

**What replaced it.** `standing_scene`: a bulk shift `cot(elevation)` per unit height away from the sun, folded into every occluder's shift. The park keeps it off, because for a frame-filling canopy it would only drag the pattern off its texture ([`../model/transport.md`](../model/transport.md)).

### Centring the camera on the crown's shadow

**What was tried.** A dead end worth recording: a first attempt auto-centred the camera on the crown's shadow (view centre += −crown height · bulk shift).

**What it looked like.** The trunk slid out from under its own crown as the sun moved; the tree's shadow visibly came apart.

**Why.** The trunk's foot is at height 0 and never shifts; the crown is high and shifts most. Pinning the crown at screen centre moved everything else against it.

**What replaced it.** The bulk shift is applied to every occluder through the one shared shift, and the camera is left alone. Lowering the sun stretches the whole connected shadow as one. The editor's "frame shadow" is a one-shot camera move, explicitly not the per-frame centring ([`../model/transport.md`](../model/transport.md)).

**The lesson.** The whole shadow is one connected thing; don't centre on a piece of it. Occluder and receiver must share one geometry or the shadow comes apart.

### A border texel stretched into a band

**What was tried.** Reading the cast layers with their edges clamped when the camera sees beyond the bake.

**What went wrong.** A border texel stretched into a band across the view.

**What replaced it.** The canopy boundary follows the scene: the overhead canopy field repeats; a finite tree has zero optical depth outside its box ([`../model/transport.md`](../model/transport.md)).

### One shader for every camera

**What was tried.** One transport shader serving the floor, the cloth, the enclosure and the sky view, with runtime flags choosing the branch.

**What went wrong.** It declared 246 vec4 rows of uniforms against WebGL2's guaranteed 224.

**What replaced it.** One master source compiled per camera from a registry, so each program declares only what it reads; a camera is an addition, not an edit ([`../model/transport.md`](../model/transport.md), [`../contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).

### The wood's segment table as uniforms

**What was tried.** Holding the analytic occluder's segment table as two uniform arrays.

**What went wrong.** 128 rows, over half the guaranteed budget, in every camera at once.

**What replaced it.** A data texture read exactly with texel fetches.

## fill

### One flat sky for the shade (the magenta shade)

**What was tried.** The cast filtered only the beam; the skylight and the leaves' scattered sun were one flat, unfiltered ambient.

**What it looked like.** Under a red fall canopy, a red beam on a blue-lit floor: the shade went magenta (`memories` at phenology 1; at 0.75 a blue-violet under a warm beam).

**Why.** A missing term, not a wrong colour: the skylight that fills the shade also came through the leaves.

**What replaced it.** The sky fill, the cosine-weighted hemisphere integral through the canopy ([`../model/fill.md`](../model/fill.md)).

### The same rays at every texel

**What was tried.** The first render gave every fill texel the same K fixed directions.

**What it looked like.** Decimetre-scale facets: neighbouring texels hit correlated leaves, and the mip averaged only K directions' worth of noise.

**What replaced it.** Each texel takes its own rotation of the set by its slot in a fixed 4×4 ordering; a tile holds 16·K directions. Every other ordering tried (azimuth only, other sub-stratum permutations, a Vogel spiral dealt out by stride) landed within 0.44–0.50 of the unrotated error, no better ([`../model/fill.md`](../model/fill.md)).

### A bilinear read of the estimate

**What was tried.** Reading the fill's point-sampled estimate bilinearly. *Found in the first render, not predicted:* `fill_scatter` 0.5 on `memories` drew a regular grid at the texel pitch.

**What replaced it.** The receiver reads a mip of the fill's own output, level 3, four tiles: luma RMS 1.99 of 255 against a K = 64 bake, where level 2 gave 2.84, a 4-tap smoothing of level 2 2.14, and the uninterleaved fill 5.92 (`memories`).

### Blurring the layers' optical depth

**What was tried.** Rejected: a mip or blur of the layers' depth before the rays read them.

**Why.** Jensen. It turns a gappy canopy into a uniform veil and underestimates the fill; a stack half open per layer passes more than `e^(−mean τ)` by a wide margin. Only transmittances may be averaged.

### Trigonometry on the GPU

**What was tried.** *Found, not predicted:* the first interleaved shader computed the ray azimuth's cosine itself.

**What went wrong.** It missed its own CPU reference by 3·10⁻³ to 9·10⁻³, against 2.4·10⁻⁴ before. A ray's plan shift is tens of metres near the horizon, so a few 10⁻⁴ of angle is more than a leaf's edge.

**What replaced it.** The directions are made in double precision on the CPU and uploaded ([`../model/fill.md`](../model/fill.md)).

### The authored scattering albedo

**What was tried.** `fill_scatter`, a leaf's single-scattering albedo, guessed at 0.1–0.25 so the shade "read right".

**Why it was wrong.** It conflated reflectance with transmittance. A leaf reflects little but passes a great deal (about 0.35 for a green summer leaf, 0.6–0.75 for a red fall one); the low values only read right against a beam already carrying the transmitted light as sun-images.

**What replaced it.** The diffuse light `leaf_diffuse` measures. Above 0 the proxy is inert and hidden, or the light would be counted twice ([`../model/fill.md`](../model/fill.md)).

### Light "created" under the crown

**What was observed.** Two frames side by side showed a glow under the crown that the beam's missing light was not under.

**Why it is not a leak.** Displacement: the beam's deficit sits where the sun throws it, the leaves' light is spread by the hemisphere beneath them. The same energy in two places reads as an addition. On the real layers beam + fill is the old total within 0.5–3 %, and the hemispheric descent differs from the column's by the canopy's clumping (−5 % … +15 %), which is physics.

### The fill bounded by the canopy box

**What was tried.** The first fill was a texture bounded by the canopy box, read with clamped edges.

**What went wrong.** It lost about half the glow that spreads beyond the box (the bottom layer received 0.69–0.73 of what it emitted on `memories`; a finite tree's box held 41–57 % of what its leaves sent down) and repeated the border texel to the horizon; `S` at the box's edge sat at 0.27–0.64 of its brightest block.

**What replaced it.** The endless park wraps its box; a finite tree is open over a frame padded by 3·h_max, where `S` falls to ≤ 0.004 at the edge ([`../model/fill.md`](../model/fill.md)). Wrapping the hemisphere inputs alone still left a border texel stretched across a wide view, so the lighting textures repeat at the receiver too.

### A second sun in the park

**What was tried.** The fill lit its leaves along the real sun while the park's beam has no bulk shift.

**What went wrong.** At a 36° sun the fill emitted about 14 % more than the beam lost; the books broke.

**What replaced it.** One sun per camera: the fill walks the beam's own path. José: *"I welcome optimizations for stuff that makes no difference."*

### The cloth that "doubled" (a measurement on the wrong frame)

**What was tried.** The first account of the split on the curtain read: the cloth doubled when the split opened (×2.0 read at a sky share of 1, ×1.5 at 0.5); `curtain 1` "a dim look whose beam is nearly dark"; "`S` is the whole change". The ×1.53 was parked as a question.

**Why it was wrong.** All of it was measured on the faithful cast's first frame, baked before its own source existed: a beam with no sun in it, so `S` was all there was to see.

**What replaced it.** With the bake order fixed the real ratio is ×1.008. The harness now proves, for every faithful look, its unaided frame against its re-baked one.

**The lesson.** *A frame measured for a claim has to be the frame the engine really shows.*

### Cloth and tent without the scattered sun

**What was tried.** Rejected when the split opened: the cloth and tent reading only the filtered skylight.

**Why.** With the beam going dark they would lose every watt the leaves gave up: ×0.957 on `curtain 1` and ×0.81 on `tent 1` without `S`.

## receivers

### The skylight counted twice on the cloth

**Do not** add the ambient a second time (`… + ambient·Tt`): it double-counts the skylight and breaks both the energy bound and the collapse to the floor. The skylight is part of the landed irradiance and passes the cloth once ([`../model/receivers.md`](../model/receivers.md)).

### Coarsening the drape by chirping its frequency

**What was tried.** A single sinusoid whose frequency falls down the drape, `k(v) = fold_scale/√(1 + fold_coarsen·v)`.

**What it looked like.** A ridge is a curve of constant phase, so every ridge tilts outward as it descends: a symmetric diagonal fan spreading from the frame centre, which reads as light on the bottom of a swimming pool, the caustic fan, not fabric.

**What replaced it.** Three incommensurate harmonics crossfaded in weight down the drape: the finest dies out toward the hem, ridges vertical throughout ([`../model/receivers.md`](../model/receivers.md)).

**The lesson.** *A spatially varying frequency is a statement about phase, and phase is where the geometry lives:* where a feature's orientation is fixed, vary which frequencies are present, never the frequency.

### A woven tooth on velvet

Rejected: a flat warp×weft grid. A thin woven grid reads as canvas, not terciopelo.

### The forward-scatter wrap as an add

Rejected: the tempting `+ s·glow`. The scattered share is a split of the same transmitted energy (a mix of two bands, each ≤ 1), so the cloth can never out-glow the light that landed on it.

### The window grid stamped into a depth layer

**Do not.** On the faithful path transport is one pre-integrated tap and the layer loop never runs, so a layer-stamped grid is invisible in exactly the looks that need it; layers also shatter continuous lines at a low sun (the [snowflake](#wood-stamped-into-the-depth-layers-the-snowflake)). "Composites through the existing tap" is only free while there is a loop to composite into. The grid is an analytic occluder in the cloth's own coordinates, applied after transport where both tiers have one `acc` ([`../model/receivers.md`](../model/receivers.md)).

### The bars' penumbra with ground obliquity

Rejected: the woody occluder's `1/sin(elevation)` factor in the mullion penumbra. That factor is ground obliquity; the cloth is viewed head-on, so a bar's shadow is never smeared along a receding plane.

### The bars taking the beam alone

Rejected: treating the window bars like distant wood, which blocks only the sun's disk. A bar centimetres off the cloth subtends nearly the whole hemisphere behind that point, so it takes beam and sky alike; otherwise the shaded panes read merely un-sunlit instead of dark.

### An infinite lit field behind the cloth

**What was tried.** The curtain before the aperture: light behind the cloth with no boundary, tiled edge to edge by a uniform fishnet of bars.

**What went wrong.** Monotone by construction; nothing was dark because nothing was wall. The scene's composition is a finite bright rectangle in a dark room.

**What replaced it.** The window aperture, cast at the bars' own plane through their own penumbra, which also confines the grid: a wall has no glazing. An aperture drawn straight while the bars inside it S-bend over the pleats was rejected: it would announce itself as a mask laid over the picture.

### Two copies of the pleat field

Rejected: letting the shading and the warp each compute the corrugation. Two copies drift apart the moment either is edited, and the S-bend slides off the folds it bends over. One function returns the displacement and its derivative to both.

### Warping the shading coordinate too

Rejected: the pleats are attached to the cloth, so only the arriving pattern warps. Warping both would slide the folds off themselves.

### The throw rates as the fold's sun direction

Rejected: reusing the per-height throw vectors for the folds' incidence. Both carry `1/sin(elevation)`, diverge toward the horizon and are floored, while incidence on a vertical cloth *peaks* as the sun lowers head-on; the folds would be dimmest at the sunset the look is built for. A unit sun direction, unclamped in elevation, is sent instead.

### A horizontal nap ripple

A `v`-varying ripple draws horizontal etched stripes, the opposite of a vertical pile grain; past ±5 % a grain reads as engraving. The nap varies across `u` only, at ±4 %.

### A kernel sampled too sparsely

The cloth's 13-tap blur cannot cover any radius: past a capped spacing a hard cast edge would come back as thirteen shifted copies of itself. The spacing caps at 6 px and the reach then falls short of the metres asked. The trade is chosen: a glow that stops short still reads as a glow, a combed one reads as a bug.

### A flat receiver for the tent

**What was tried.** Making the tent from a flat cloth: exposure, drape, sun angle, distance.

**Why it cannot.** A plane has one normal, so every point meets the beam at one angle; the tent's read is panels at different brightnesses because they face different ways.

**What replaced it.** The enclosure, a convex polytope ray-cast per pixel ([`../model/receivers.md`](../model/receivers.md)).

### The tent as an infinite prism

**Do not.** An infinite ridge converges to a vanishing point, an endless corridor; a real enclosure converges to a surface at a finite distance with an edge. A distance fade standing in for a wall does not produce a room.

**The lesson.** *A depth cue is not a boundary; only a boundary is a boundary.* The far cap closes the tent, and the depth fade became a gentle cue.

### The tent that read as a church

**What was tried.** Flat panels meeting at angles with a dark rib drawn along each meeting.

**What it looked like.** The grammar of a stone vault; the tent read as a church.

**What replaced it.** Sides as arches sampled as tangent strips and shaded off the smooth profile normal, and a seam pass that draws only junctions between different panel groups.

**The lesson.** *When a smooth thing is approximated by pieces, every downstream pass that reads the pieces must be told which boundaries are the object's and which are the approximation's.*

### A true curved intersection, and modelled hubs

Rejected: a curved-surface ray intersection (it would close a 1.45 cm silhouette error at the cost of the closed-form single minimum) and authored hub vertices (the half-space intersection derives them for free).

### Hip rake gated at zero

Rejected: below a rake floor the hips stop binding and the cap silently reverts to a slab. The rake is floored at 0.15, about 4 cm setback, for shape.

### A converging seam pattern as a fold

**Do not.** The two seams converging at the foot end meet at a point with a height, where the spine meets the vent apex. A yaw of a crease slides it sideways with no height to converge on. Where lines converge, the free parameter is *where*, not which way they lean.

### Tuning a shape to one canvas

The near vent sat 3.3° outside the frame; raising its apex would bring it in at 0.65 m on 16:9, but 0.75 m at 16:10, 0.85 m at 4:3, and never at 1:1. *A shape tuned until a feature scrapes the edge of one canvas is undone by a window resize; where a feature is out of frame, the camera is the control that works.*

### The arch's shoulder out of range

A shoulder inside the straight base→crown line bends the arc the wrong way and its tangent planes slice off the crown edge; a shoulder height outside (0.25, 0.75) of the ridge makes the profile double back and the smooth normal undefined. It is clamped to [0.30, 0.70].

### The faithful tier on the enclosure

The faithful bake pre-integrates the disk into one texture in one receiver frame, and the enclosure has none, so it forces the layer tier; at enclosure distances the cast is deep in the pinhole regime, where layer quantisation is invisible. *The pre-baked tier buys speed by fixing a receiver frame, and buys it only where a receiver frame exists.*

### Seams measured to the neighbouring plane

**What was tried.** Painting a seam by each pixel's distance to the neighbouring plane.

**What it looked like.** A stain, not a tape: the distance is foreshortened by the dihedral, so the shallowest junction drew the fattest band. The mesh hem at 18.4° painted 76.0 mm of fabric; a crown edge at 46.9° 32.8 mm.

**What replaced it.** Distance to the edge line, `|c − n̂·hit|·(1 − (n̂·n̂_win)²)^(−½)`: both now paint 24.0 mm.

**The lesson.** *A distance to a plane is not a distance to that plane's edge.*

### A crease at the mesh hem

Rejected: a crease would make a brightness step that reads like the hem, but the reference is tensioned fabric on a bent pole. *A material boundary and a geometric edge are different things: do not let one stand in for the other.*

### A bigger ambient for the shaded slope

Rejected: the shaded side of a real white tent is lifted by light bounced off the lit side opposite. The honest fix is a bounce term, not a bigger ambient (not built; [`../exploration/open.md`](../exploration/open.md)).

## sky-view

### A clamped border across the periphery

Outside the baked canopy box the eye's read returns open sky. An upward frame leaves the box within metres, so the alternative is a clamped border texel smeared across the whole periphery.

### A prettier glow round the sun

Rejected: a smooth falloff for the halo seen in frame. The annulus is flat because the sampler's is flat; a smooth glow would look better and would no longer be the source the cast is drawn from. Measured, the seen field's core:halo split matches the sampler's weights to 0.08 %.

### Physical sky and sun levels

A sun disk is about 10⁶ times a blue sky's radiance; no tone curve and no 13-tap glare carries that. The absolute levels are authored gains, stated as such rather than dressed up as physics ([`../model/sky-view.md`](../model/sky-view.md)).

### A wide veiling glare

A wide `glow_bleed` drags open sky toward the canopy's mean and reads as haze over the whole picture: at 0.35 a daylight sky loses 13 sRGB levels; a dark preset goes from (81,109,157) to (68,93,138). Set it to halo the source and nothing else.

### Pure transmission (the stencil)

`T·(sky + source)` only removes light: every leaf a dim filter, a deep crown black. Looking up on a clear day the crowns with sun on them are luminous. Replaced by single-scatter foliage radiance along the eye ray.

### The skylight inside the scatter term

**What was tried.** The first form read `S_L = sunColor·A_L + ambient`: a leaf scattering the skylight that fell on it.

**What went wrong.** A double count: that light's passage is already carried by `T·sky` (and in the fill by `T_sky`), since for a uniform sky diffuse transmission through Lambertian leaves equals the ballistic one to first order. It lit a crown even with the sun off.

**What replaced it.** The term is the sun's light alone; with the sun off it is exactly zero. A crown that needs to be brighter takes more sun-scatter, not the skylight back.

### Long wood binned into the seen layers

**Do not.** A segment spanning several bands is cut into pieces snapped to different layers, and the seen read is height-dependent too, so a branch becomes a staircase, the same failure as the cast's [snowflake](#wood-stamped-into-the-depth-layers-the-snowflake). Only wood short enough to sit inside one band (level 2 and above) goes into a band; trunks and limbs are analytic.

### Wood in the scatter channel

**What was tried.** Stamping the fine wood into the same texel the scatter reads its density and hue from.

**What it looked like.** Wood is neutral, so a twig normalised to a near-white hue at near-full density, and the skeleton rendered as pale filaments brighter than the sky. Against a sky of luminance 198, a bare twig read 216, 217, 217 at `branch_tau` 2.2, 3.2, 5.0, brighter the more opaque. *An opaque occluder in the scatter channel glows.*

**What replaced it.** Wood in a texture of its own: in throughput and the sun's path, nowhere in the emission. The same twig now reads 63, 31, 10.

### Wood riding the layer's coverage channel

The wood first took the layer texture's alpha, which nothing read. When the leaf's diffuse split made coverage worth reading on every camera, the two could not share a channel; the sky view's data had been a special case of the leaf bake. The wood moved to its own texture, and the leaf bake became the same on every camera, with the old frames unchanged.

### Two sway rules for a twig and its leaves

The stamped twig takes the leaf bake's own per-layer sway, not the cast path's height-scaled one, because a twig and its leaves must move together. *Where two things must stay registered, give them one rule, not two rules that agree today.*

### The sky view as a window

Until the lantern, the sun's disk showed through every leaf, tinted, and an authored `sky_scatter` painted a glow beside it. A real backlit leaf shows its diffuse glow, never the disk through it; José: *"the canopy would act like sunglasses but still leaks would leak through."* Replaced by the lantern: the disk only through what a leaf passes as a beam, the rest the leaf's own glow. `sky_scatter` is retired above `leaf_diffuse` 0.

### A conservation bound that was false

The phase was specified with `Π tb + glow ≤ Π t` for any eye ray. It is false off the sun's ray: a leaf lit through a gap can be seen through a dense leaf in front of it, exceeding the bound by `(t_0 − tb_0)(1 − tb_1)`. That is physics. The identity holds along the sun's ray; elsewhere only the per-layer bound holds.

### The soft edge that glowed

The sky-view face of the [slab dead end](#the-texel-read-as-a-slab-dead-end-kept). At coverage 0.3 on `canopy 1` the slab emitted 0.34 against the true 0.05 in blue, 0.40 against 0.07 in red, 0.48 against 0.14 in green: a pale cream outline round every green leaf (×2.26 measured). It was the model as specified, not a wiring fault; the cure was a model change, area-correct emission. Now the rim's peak is ×0.95.

### The eye on a trunk

With tree 0 planted at the origin, a camera centred there stood the eye on a trunk, which then shadowed every direction and multiplied the whole frame, sun included. Wood occludes only in front of the eye now. *The hammock hangs between trees; do not stand the eye on a trunk.*

### A painted sky gradient

Rejected: a screen-space ramp for horizon brightening. A real gradient wants a sky model the piece does not have; a ramp would be painting.

### Lifting the occluder budget silently

Never lift the analytic wood's table past a look that has been rendering truncated with the wood open: it has been showing its truncated self, and a bigger table repaints it. The table now stands at 256 segments ([`../model/canopy.md`](../model/canopy.md)); the rule governs the next raise, and whether the raise to 256 repainted `the void` is José's to confirm ([`../contracts/looks.md`](../contracts/looks.md)).
## motion

### Translation alone

**Correction from feel-testing.** One rigid translation of every leaf does not read as wind, even with correct breathing and backlash. Missing: leaves changing angle (a tilting leaf's footprint foreshortens, so the dapple changes shape) and non-uniform sway between clumps.

**The lesson.** *Motion that only moves leaf positions will always look like a slide.*

### A hierarchy of translation springs

**What was tried.** The first hierarchy drove each limb and twig as a 2-D translation spring.

**What it looked like.** Wrong in an uncanny, almost hallucinatory way: patches of dapples swimming in different directions with no rigid body behind them.

**Why.** A branch does not translate; it pivots about a joint, and rotation is what the eye reads as "branch".

**What replaced it.** A hierarchy of rotations ([`../model/motion.md`](../model/motion.md)). Moving positions differently per region looks like soup.

### Twigs pivoting about their own centroid

Each clump's two halves sheared in opposite directions: an in-place spin, a vortex, which the eye latches onto. The cure moved the pivot onto a stem toward the parent. Set the stem length to zero and the swirl returns; the knob is the diagnosis.

### Limbs as scattered anchors

The vortex came back one level up: clumps bound to the nearest limb surrounded its pivot, and whole planes swirled. The cure: limbs as arms from a trunk, each clump bound to the limb pointing toward it.

### One angle for every limb (the pinwheel)

With a shared pivot, one uniform bend rotated the whole canopy rigidly: one giant pinwheel. The cure: each limb bends by the wind's torque about the trunk, so the canopy leans rather than spins.

**The lesson.** *The vortex is scale-free:* it returns wherever children straddle a pivot turned by one angle, and dies the same way: pivot on the parent, bend by torque.

### Joints on a fake skeleton

The kinematics first drove clustered points round the canopy centre; with the grown grove each tree leans about its own trunk. See [the clustered-point scatter](#the-clustered-point-scatter). The faithful band that was dropped for registration is told under [canopy](#the-faithful-cast-without-its-medium-band).

### A reversed rotation constructor

GLSL matrices are column-major; reversing the rotation constructor separates the foliage from its wood under wind, and a still frame cannot expose it.

### Foreshortening from the yaw, or from the ground

**Do not** drive the limb's foreshortening from its yaw (a limb turning in plan does not lose elevation), and do not scale heights from the ground, which opens a hairline gap at the limb–trunk join under a low sun. The pitch has its own DOF and scales from the attach height.

### An even pitch response

Carried, not fixed: `1 − cos` is even, so an upwind limb pitched up foreshortens slightly instead of lifting its cast.

### A single gust frequency

**What was tried.** One near-sinusoidal gust with an attack/decay envelope.

**What it looked like.** Mechanical and one-directional; it leaned downwind and never came back.

**What replaced it.** Broadband forcing with the Kolmogorov slope, a crosswind channel, and a slow weather state.

**The lesson.** *The first primitive was wrong, not just mis-tuned.*

### A random walk for the weather

Rejected: an Ornstein–Uhlenbeck walk would do the job but break the no-RNG rule; deterministic noise of time does it instead.

### Density as the sweep axis

A count is a poor axis to sweep: nudging it regenerates a different set and jump-cuts. The reorganisation is the drift phase, which is what the incoherent band is as built.
## transitions

### A bloom pushed to full overcast

**What was tried.** Hiding a structural swap under a bloom pushed to full overcast.

**What went wrong.** The bloom stopped dissolving and flooded the frame toward white. On a mode flip the swap cut from a blown frame to a shaded interior: the largest frame-to-frame luminance step was 11.6× a live morph's. On a topology dissolve a bright look bloomed to luma 249 of 255 and held for eight frames; the picture disappeared and the new grove faded back out of white.

**What replaced it.** A capped bloom at twice the clock, with different depths: a mode flip changes the camera, so cover buys nothing (2.9×); a topology dissolve has a swap to hide (1.1× at the crossing of flash and readability, against 3.8× uncapped). The cap is set where the worst route is best, since a floor and a sky pull opposite ways.

### Luminance as the measure of a dissolve

A frame that swaps every dapple for one of the same brightness moves the mean not at all. The harness measures churn too, against the frame's contrast; by that reading the swap frame scored 3.6× a live morph's whole transition. No depth turns a cut into a dissolve.

### The midpoint swap for a topology change

Replaced, inside a narrow gate, by growing the incoming grove early and baking both into the same layers at complementary coverage: gaps merge, split and collapse into the new arrangement. Its former 0.20 bloom was removed too: on `morning 1` ↔ `memories` the effective cloud overshot both ends to about 0.426.

### The iris installed in one frame

A first positive vignette feather installed the whole ellipse in one frame. The boundary now sweeps in from outside the frame over the first quarter, and opens over the last when turned off.

### Wood across a mode swap

The woodless look must never cast the other look's skeleton (an overhead trunk collapses to a dot with radial limbs); the wood fades out over one half and in over the other.

### A cloud dissolve between floor modes

Floor-to-floor mode changes (afternoon 7 ↔ park 1) now fade through the lit ground instead, with no bloom.

### Independent zoom, tilt and pan

Interpolated separately they make the eye overshoot and return; the seasonal route interpolates the eye's position and pitch and reconstructs the rest.

### A law switched on the last frame

A moving cast holding a tiny positive `leaf_diffuse` and then snapping to the zero-diffusion texel law at landing would pop. Native casts keep their endpoint's law, and with `edge_area` off the moving cast bridges the slab into the mixture over `smoothstep(0, 0.08, k)`.

### Two trees, and a late change of material

The litter flight avoids revealing a second completed tree above its own ground shadow (one leaf field crosses the horizon), and a lifted leaf changes from reflecting to transmitting early, not only when seen from underneath. Its supersampled eye targets average four transmittances, not their optical depths.

### Dissolving scenes on the projector

Faithful structural routes now dissolve two moving scenes in linear display light. *Measured* at 640×360, 60 fps on Metal, 1024 bakes, 32 samples: the largest mean-luminance step fell from 127.14 to 0.87 (cherry green → green 2) and 23.43 to 0.59 (green 2 → ultraviolet).

### Gates that are zero

A window aperture crossing zero never grows a pinhole: the enabled end's geometry is kept and its restriction fades. A `leaf_diffuse` crossing zero with an active proxy fades the proxy out over the first half rather than dropping it on the first positive value.

### Stale geometry and frozen dapples

With wood off, a leaf crossfade must not rewrite the shared faithful geometry from the outgoing skeleton. A still faithful cast keyed on sample count alone missed source changes; it compares a snapshot of the real inputs. A still-air time-of-day morph between faithful looks would freeze the dapple at its start angle without a re-bake each frame. A mode flag assigned without the full rebuild would run on stale geometry and textures.

### The slider through `transitionTo`

The wrong tool for a macro: it restarts an ease per input, resets the profiler, and dissolves above budget; a regrow per input stutters. Macros tween their own value instead. A regrow mid-gust also used to reset the sway; the spring prefix now carries over.

## harness

### The offscreen stress burst

Tried and abandoned: rendering a pass many times back to back measures idealised GPU throughput, which the driver can collapse, and wildly over-reported spare capacity. Real frames with GPU timer queries replaced it; the synthetic "headroom ×" was retired for the live full-quality frame rate.

### A governor blind to the bake

`auto_quality` trimmed only transport while the bake was co-dominant on windy looks; bake resolution is now its lever too.

### Gate rows that can pass on a dead feature

An a == b row survives a change that moves both sides, so pins hold a look's own hash; and byte-identical rows could pass only because a feature is dead, so `differ` rows prove the switch is real. The fill's bookkeeping rows were red on the engine before the wrap, the padded frame and the one sun, "which is the only reason to believe them".

### Bundles that shipped what they did not need

A `--define` of the editor flag never folded (neither bun nor esbuild inlines that const), so editor overlays shipped in every bundle (7.6 kB raw, 3.1 kB gzip by ablation). About 64 kB of design notes rode inside shader literals. A cut camera's GLSL strings survived because a minifier keeps a literal with `${}`; the orphan sweep removes them.

### Two gotchas in the feature cut

Compaction keyed to `litter?.length` would, with the carpet cut and the drop kept, leave thousands of zero-depth quads; it counts dropped leaves. And `ordered` includes the drop by light even at `turn_exposure` 0: a bundle that cut `exposure` for such a look would drop its leaves in another order and paint a different tree without saying so.

### Inventing an axis before a look asks

Materials ride the camera until a real look wants a pair that does not exist; inventing that axis first would be inventing the combination.

### Editor echoes

The HUD once printed fps, tap counts and slider echoes every frame; it now carries only what is live and computed. The tree preview walked a gaussian stream of its own; it now places leaves with the grove's own function. The canvas drag that moved the sun became a toggle; the default orbits the camera.

## principles

### Exactly one sanctioned approximation

The founding rule: depth discretisation is the *only* place the piece cheats. Amended twice: leaf-edge diffraction joined as "a second, smaller sanctioned approximation", and `faithful_canopy` became the opt-out from even this one. The present principle ([`../principles.md`](../principles.md), §5) names depth discretisation as the one approximation every frame pays and every other approximation where it lives.

### We never see the tree

The founding fourth commitment: model only what reaches the surface; we never see the tree, only its cast, viewed from below. Amended first for the backlit curtain (trunk and branches as silhouette), second for the sky view (the surface is the retina), and third, reversing it: in the canopy looks we should see the tree, dark connected wood that is never luminous. The budget rule earned its keep while the ground was the only surface. Its successor is "model what reaches the eye" (§6); the tree as a lit body is not built.

### Byte identity as a law

For a long stretch every feature's off state being byte-identical to the first release was treated as a law. Preservation is now the default and the safer route, not the goal: a change that is more komorebi may move pixels, including a shipped look's, and owes review ([`../principles.md`](../principles.md), §8; [`../contracts/preservation.md`](../contracts/preservation.md)).

## Related

- [`README.md`](README.md): how to read this evidence.
- [`measurements.md`](measurements.md) and [`observations.md`](observations.md).
- [`../principles.md`](../principles.md) and [`../model/overview.md`](../model/overview.md).
