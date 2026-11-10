# Gates and rungs

*What a quality rung and a new camera owe, how each parameter behaves when one look becomes another, who may trade quality for cost, and what a bundle may leave out.*

The piece grows in two directions: a look gets better (a rung on a quality ladder), and the engine learns to see somewhere new (a camera). Both arrive behind gates, and both are paid for by someone's frame budget. This file states the laws that keep that growth honest. The physics of each rung and camera lives in its model file; what a change owes existing looks is [`preservation.md`](preservation.md).

## Gates

**Law.** A gate is a parameter whose zero, false or absent state is the previous law. While it is shut it allocates nothing and runs nothing: textures, programs and passes are created on the first draw that wants them and freed on the first that does not. Opening a gate is a real switch, and the harness holds both halves: shut, every look it could reach renders as before (the landing rule of [`preservation.md` §1](preservation.md#1-a-feature-lands-with-its-off-state-unchanged)); open, the frame changes.

A gate does not reach what it is not about. A floor-only knob leaves the cloth, the tent and the sky view untouched with the gate open; a cloth knob is inert on the floor; a zero gate ignores the geometry behind it.

## The quality-rung contract

A quality upgrade never lands as a bare improvement. It lands as a **rung** on a ladder, and owes four things:

1. **A gate** whose off state is the look before it, at landing.
2. **A declared cheaper rung it degrades to**: the next step down, and ultimately off.
3. **A cost-audit entry** whenever it carries measurable per-frame cost, classified as below.
4. **A statement of who may cross it**: the runtime governor on its own, or only an authored lite variant judged by eye.

The exemplar is the faithful cast. Its gate is `faithful_canopy`; its cheaper rung is the layered cast, the path every overhead park takes; it is classified risky; and only a human-verified lite look may cross it. The governor never trims it. Other ladders follow the same shape: the sky fill degrades through fewer rays and a coarser fill texture to off; the cloth's lateral-diffusion glow degrades to the forward-scatter wrap, and the wrap to none.

**Corrections are not rungs.** A change to how the model's causes work, rather than to how finely a look is rendered, does not owe the checklist. This holds for the optics as for motion. The motion corrections (broadband wind, the rotation hierarchy, the unified twig pivot) change how the canopy moves and leave the rest image as it was; the optical ones (the receiver's cosine law, area-correct mixing at the leaf's edge, the leaf's diffuse split) change the rest image itself, and landed behind gates before this was decided. A correction that moves a shipped look is governed instead by [`preservation.md` §3](preservation.md#3-a-change-that-moves-a-shipped-look-is-reviewed-before-it-ships): the artist reviews what it does to each look it moves before it ships, and may still ask for a gate after seeing it. It is reviewed, not gated by default.

## The cost audit: who may cross a rung

Every axis of per-frame cost is classified, and the class says who may trade it away.

| Class | What it holds | Who may cross it |
|---|---|---|
| **safe** | Sample count, texture resolution, layer count; the sky fill's ray count and fill resolution while the fill is open. Low visual risk. | Proposed automatically for a lite variant; sample count and bake resolution are also the runtime governor's levers below its knee. |
| **risky** | Foliage density (it changes the gap structure); the faithful cast (mode fidelity itself, the largest quality fork, whose cut is the layered cast). | Only an authored lite variant, compared on the A/B wipe and chosen by eye. Never the governor. |
| **style** | Leaf-edge diffraction; the cloth's lateral-diffusion glow; the sky fill; the sky view's single-scatter foliage glow. Deliberate looks, measured for their price. | Only an author. Never cut automatically. At zero the sky view's glow is a different picture, not a lighter one. |
| **tune** | Performance devices: the decoupled bake resolution, the adaptive frame rate. | Measured and proposed like the safe cuts; both ship on as a deliberate performance baseline. |

**Law.** The runtime governor (`auto_quality`) spends the cheapest quality first and touches no physical or artistic parameter: render resolution, then source samples and bake resolution together below the knee. On the faithful path the order flips, samples first across the full range, because the per-sample geometry bake is the whole cost there. The two upward cameras force the layer tier, so their cost is per pixel and they take the floor's order, resolution first. Below the knee the enclosure runs the sample loop and is relieved by trimming it, as the floor is; the sky view declares no sample loop, so samples are inert there and its relief comes wholly from the bake lever shrinking the layers it reads. Inert, not harmful: the seen source is derived analytically, not from the sample sums, so trimming them cannot move the sun that camera looks at. Render resolution is the governor's lever and never a profiler axis: the lite variants exist to lower the static cost so the governor engages less. The profiler measures every axis at full resolution with the governor held off, so each figure is the price of a stylistic decision at full quality.

## The extension contract: a new camera

Transport is one master source compiled per camera ([`../model/transport.md`](../model/transport.md)). A camera is a **mode**: it changes only through a structural rebuild, never inside a frame, so the choice is resolved once into a straight-line program. A camera is an **entry** in one registry, read by every consumer that needs to know what the camera declares, runs and uploads; nothing outside the entry has to learn about it. Adding a receiver is writing an entry, not editing several predicate chains kept in agreement by hand.

A new camera owes six things:

1. **A registry entry**: its snippet composition and its uniform groups, each group naming its declarations, its locations and its upload together, so a uniform declared in one variant and filled in another is a key that does not line up rather than a silent bug.
2. **Its parameters in the defaults**, each classified by transition class (below) or explicitly excluded. A knob that is neither fails loudly.
3. **Editor rows and tooltips**, because a knob nobody can find is a knob nobody authored with.
4. **Harness coverage**: at least one shipped look through the new camera, so the smoke and determinism checks exercise it on every run, plus gate rows holding its off state.
5. **A model section** carrying its physics and, in the same breath, its honest approximations: what it stands in for and what it cannot do.
6. **Cost-audit entries** wherever it carries measurable per-frame cost.

**Materials ride the camera** until a look needs otherwise. Every receiver so far has exactly one material (the floor reflects; both cloth receivers transmit through the same fabric; the retina has none), so the entry names its material and there is no second axis to keep in sync. The named candidate that would split them is the enclosure's mesh panels read as sky rather than as fabric. Inventing that axis before a look needs it would be inventing the combination.

## Parameter classes

**Law.** Every parameter in the defaults belongs to exactly one transition class, or is explicitly excluded with its reason. The classes are disjoint. The class says what a transition may do with the knob; how each route then uses it is [`transitions.md`](transitions.md) and [`../model/transitions.md`](../model/transitions.md).

| Class | What it means | Under a transition | Examples |
|---|---|---|---|
| **MORPH** | Continuous and read live, or rebuilt cheaply without regrowing the grove. | Tweens frame by frame on an ease; angles take the short way round. A gate crossing zero mid-tween may allocate its pass lazily; that is a pass-count change, not a look pop. | Sun elevation and azimuth, cloud thickness, halo radius, eclipse amount, layer heights, `branch_tau`, exposure, contrast, camera framing, `chromatic_aberration`, `vignette`, `sun_cosine`, `canopy_fill`, `leaf_diffuse`, `leaf_wetness`, ground albedo, every fabric, curtain, tent, window and mullion knob, every wind and spring knob, drift. |
| **CANOPY** | Continuous knobs of the grown grove, read when the grove is grown. With the same topology the grove's draws line up, so interpolating them deforms the same grove. | Grove morph: the grove regrows each frame from the interpolated knobs, with no bloom, while the busier end is under the live-morph leaf budget; above it, the route falls back to a structural one. In-flight sway carries over. | `tree_count` (continuous: a fractional count fades a marginal tree in), `canopy_extent_m`, branch angle, length ratio and pitch, foliage density, leaves per cluster, leaf size and aspect, tilt, edge softness, droop, taper, crown aspect, `inner_leaves`, `litter_age`, `litter_drift_m`, and every SEASON key. |
| **SEASON** | The subset of CANOPY that moves only each leaf's transmittance, whether it still hangs, and what lies on the ground; never the skeleton or a leaf's place. | When every differing canopy key is a SEASON key, the grove is re-seasoned over its cached leaves instead of regrown. | Leaf transmittance `trans_r/g/b`, `phenology`, the turn's start, span and spread, pigment capacities, sieve fraction, light-ordering knobs, per-tree clock and pigment spread, the drop's knobs. |
| **TOPO** | Rearranges the grove or reallocates what it is drawn into: a different branching, depth binning, seed, outline, or texture size. Cannot interpolate leaf for leaf. | Snapped once, hidden under a capped bloom; or, where its gate allows, reorganised by a shared-layer crossfade or a travel route. | Branch levels and children, limb count, layer count, leader strength, phyllotaxis, `leaf_shape`, `leaf_variety`, `seed`, texture and bake resolution, sample count, `eclipse`, the fill's ray count and resolution, `edge_area`, `drop_after_turn`, `litter` and its resolution. |
| **MODE** | The scene-mode flags. Not continuous and not inert: flipping one changes what the engine allocates and which camera it compiles. | Never tweens. Forces a full structural rebuild under the bloom, or one of the gated travel routes between modes. | `standing_scene`, `faithful_canopy`, `receiver`, `sky_view`. |
| **Excluded** | Runtime, debug and authoring settings, and two live switches that snap. | Snapped, never tweened, and never the cause of a bloom. A snapping switch lands under a bloom already running, otherwise at the end. | The governor and adaptive-motion settings, automatic drift, debug views, `tone_map`, `wind_pattern`, the inert species label, a legacy cluster count. |

**TUNE** is not a transition class. It marks a knob whose only purpose is cost (bake resolution, the fill's ray count and resolution, the litter's resolution, adaptive motion); such a knob still carries its transition class or exclusion like any other.

**Law.** Every knob is in a class or in the exclusion list with its reason, and a check fails loudly on one that is in neither. A knob left out would mis-morph with no error.

**Law.** A macro writes only what is honest on the camera it is gated to, and never a gate a look has or does not have: the season macro never writes `canopy_fill`, `leaf_diffuse`, `exposure_absolute`, `litter`, `litter_resolution`, `litter_age`, `litter_drift_m` or `leaf_wetness` (`macros.test.js` pins the list). They are physics a look has or does not have, and `litter` is TOPO, which no macro may write.

## The feature registry: what a bundle may cut

A page that embeds the piece downloads only what its looks use. What may be left out is answered from tables, never from judgement.

**Cameras.** A bundle keeps the cameras its looks select and drops the rest, with their shaders, uniform groups and uploads. A transition-only camera is kept only with both of the cameras it joins: the sky-to-floor viewpoint and the shared litter flight need a bundle that keeps both floor and sky.

**The fall tiers.** Six tiers are interleaved in the floor program and the grove, so no camera cut sheds them. A registry says what opens each, derived per look as the camera is, and a bundle keeps the union over its looks:

| Tier | Opens when |
|---|---|
| **fill** | `canopy_fill` > 0 |
| **leaf diffuse** | `leaf_diffuse` > 0, or `edge_area` is on |
| **pigment** | the season is senescing: past `turn_start − tree_clock_spread` |
| **exposure** | the grove is ordered by light (below) |
| **drop** | leaves are dropping |
| **litter** | `litter` > 0 and leaves are dropping (a carpet needs a fallen leaf) |

**Law.** The season's predicates (senescing, lit, dropping, ordered) are defined once and read by the grove and the registry alike, never restated.

**The dependency that is easy to miss.** *Ordered* is *lit*, or *dropping* while the drop is ordered by exposure and does not wait for the turn. The drop consumes the exposure rank (the sunlit leaves go first) even when the turn is not ordered by light, so a look that drops by light opens the exposure tier without turning by it. A bundle that cut exposure under such a look would drop its leaves in another order and paint a different tree without saying so.

**Law.** A cut never changes a kept look. A bundle renders each of its kept looks equal to the raw modules, in one page on one GL stack under frozen motion; a cut whose predicate is wrong fails that check in pixels.

**Law.** A cut that a look then opens is said, not hidden. When params arriving at any door (creation, a live parameter change, a transition) open a tier the bundle cut, the engine warns once per tier per engine that the tier is not in this bundle and stays off, and names how to build one that has it. The raw modules cut nothing and warn about nothing.

**What a bundle does not cut.** The faithful tier, the glow tier and the woody occluder stay in every bundle, gated off at run time. They are interleaved code rather than table data, so cutting them would mean editing the engine instead of reading it, and a later look that opens one still works. The editor tier and the shaders' prose are always removed from a bundle.

**A cost no cut sees.** Leaf variety's pass is interleaved in the grove and reaches the exposure grid and rank, so a bundle whose looks never open it still carries part of it. This is a named cost; a tier that would cut it is not built ([`../exploration/open.md`](../exploration/open.md#harness)).

**The general player carries every fall tier, and that is correct.** It keeps every shipped look but the experimental ones, and `montebello` opens all six. The per-page embed is where the cuts pay.

Bundle sizes and what each tier costs are evidence: [`../evidence/measurements.md#harness`](../evidence/measurements.md#harness).

## Related

- [`preservation.md`](preservation.md): the landing rule a gate obeys and what a correction owes instead.
- [`transitions.md`](transitions.md): each route's gate and promises.
- [`looks.md`](looks.md): which looks open which gates.
- [`../model/transport.md`](../model/transport.md): one program per camera.
- [`../model/transitions.md`](../model/transitions.md): the tiers the classes feed.
- [`../implementation.md`](../implementation.md): the registry, the build and the checks.
