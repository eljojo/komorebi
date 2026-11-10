# The canopy

*The grove as structure: how the trees grow, where the leaves hang, how the wood occludes, and how the whole moving thing becomes, each frame, something the light can be carried through.*

## The structure is the truth

**Law.** The branch hierarchy is the canopy. It is a real three-dimensional moving structure: trunks, limbs, twigs and the leaves on them, each where growth put it, each moving on the springs of [`motion.md`](motion.md). What the light step reads is a per-frame snapshot of that structure in a form it can read fast. There is no choice to make between "a real tree" and "layers": the tree is real, and every frame its current state is baked into layers.

A leaf, as the canopy holds it, is small: where it rests in the canopy plane (plan view, looking straight down), the height it grew to, its size, its orientation, its RGB transmittance and its spring state. What a leaf is made of and what outline it has belong to [`leaf.md`](leaf.md); how its colour turns belongs to [`season.md`](season.md).

**Law.** The canopy never knows where the scene's sun is. Growth, placement and the bake are the same under any sky; the sun enters only in transport. That separation is what lets the structure and the light be tuned without fighting ([`overview.md`](overview.md)).

## Gaps are leftovers

**Law.** Gaps and clumps are emergent, never authored ([`principles.md`](../principles.md) §9). Motion forces this: gaps change when leaves move, so a gap cannot be the thing that is drawn. It is the negative space between leaves. So:

- A light branch skeleton is grown (a few limbs, then twigs, then leaf clusters) and leaves are hung on it.
- **Clumping is the topology.** Leaves cluster on twigs, twigs on branches, without being told to.
- **Multi-scale gaps come from the skeleton's self-similarity.** Big gaps between branches throw the broad shape-patches; tiny gaps between leaves throw the sun-images.
- **The gap-size distribution is a tuning target**, never a generator.

## The grown grove

The canopy is several small recursive trees, a **grove**. Each is a trunk, a few limbs (`limb_count`), sub-branches that fork `branch_children` ways and recurse `branch_levels` deep, and terminal twigs that carry the leaf clusters. The fork's spread, the length lost per order and the limbs' rise are `branch_angle`, `branch_length_ratio` and `branch_pitch`.

The crowns overlap to fill the frame. One tree grown from a central trunk leaves a bright bare hole over the trunk, because all its foliage hangs outboard in a ring; a grove has no such hole, and it is what the park was: several trees, the smaller ones reading denser because the same cluster is packed into a smaller crown. In the overhead looks the grove's fill radius is tied to the view's extent, so it fills the frame at any zoom. In a standing scene the crown is instead sized to a natural fraction of the bake's extent, so a single tree is a finite object and the surround reads as lit floor ([`receivers.md`](receivers.md), [`camera.md`](camera.md)).

The branching rule is one function of the tree's grammar and one growth stream. Everything a tree is follows from the seed and the knobs; nothing is placed by hand. A leaf's outline is grown by grammars of its own, because a maple's laterals leave the vein along its length, which a grammar of children at a node's tip cannot grow ([`leaf.md`](leaf.md)).

The clustered-point scatter that stood in for the canopy before the grove is retired ([`dead-ends`](../evidence/dead-ends.md#canopy)).

### The leader

**Law of form.** `leader_strength` is apical control, the master axis between species. At 0 every limb grows from one point at the top of a bare bole, fanned evenly around a circle: a palm, and only a palm. Above 0 the trunk is a continuing axis and the limbs attach along it at staggered heights, so the branches meet the trunk. A strong leader spreads the origins up the bole and shortens the limbs toward the top (acrotony), giving the excurrent **cone** of a conifer; a weak but nonzero leader forks a few times near the base into the spreading decurrent **dome** of an oak.

With a leader set, limbs and children take their azimuths from a golden-angle spiral rather than even spokes. The wind's pivot for each limb stays on a balanced fan, so a gust still leans the tree rather than spinning it: the drawn divergence angle and the mechanical pivot are decoupled on purpose ([`motion.md`](motion.md)). A monopodial tree carries its own height, since its limbs are up the bole: it scales its height with its plan and stands on the ground.

A single hub fanned for every tree was the original fault: every tree read as the same spoke-burst. A cosmetic slide of the drawn limb bases off the hub hid it while the branches floated free of the trunk; the leader replaced both ([`dead-ends`](../evidence/dead-ends.md#canopy)).

### Droop and upsweep

**Law of form.** Real branches curve continuously. A bending branch is grown as a few sub-segments, its heading tilted a little at each, accumulating a smooth arc rather than a ray or a single kink. The bend stays in the branch's own vertical plane (gravitropic, never a sideways twist), and children inherit the curved end-tangent, so the sag compounds toward the tips. `droop` is signed: positive weeps (the birch's trail, the willow's fountain), negative sweeps up (the conifer, the elm's vase), 0 is straight. It is weighted by branch order, so the main limbs stay nearly straight and the fine outer twigs curve most. The number of sub-segments grows with the size of the droop; a straight branch is one segment.

Droop moves twigs within the same twig set, so it is a deformation of one grove and morphs.

### Taper

**Law of form.** Wood conserves cross-section at each fork: Leonardo's rule, the pipe model, each unit of foliage fed by its own sapwood pipe. A child's width is

```
width_child = width_parent · children^(−1/Δ)
```

with Δ = `taper_delta`, near 2. High Δ thins slowly into stout limbs (oak); low Δ thins fast into a lacy periphery (birch). The trunk's base width is `trunk_radius_m`. Taper is the dominant cue between a tree and a wireframe in a backlit silhouette. It changes only the width of the wood wherever wood is drawn; the leaves are untouched.

### Crown aspect

`crown_aspect` scales the crown's height: above 1 a tall narrow spire, below 1 a broad dome. In the layer cast it is invisible, because binning by height normalises a uniform height scale away; it shows in the silhouette, the preview and the faithful cast, where the real heights throw the tree's real proportions.

**Law.** Height is decoupled from the plan's fill scale. Each tree's plan is stretched so its widest twig fills the crown radius; scaling height by that same stretch makes a narrow-plan species (steep branches, a tiny plan radius) run away to tens of metres. So the height scale floors the plan radius: a broad tree's height is untouched, and a narrow tree's height is capped at the crown radius times a fixed ratio of 1.7 times its aspect ([`dead-ends`](../evidence/dead-ends.md#canopy)).

### Phyllotaxis

`phyllotaxis` sets how children fan around their parent:

- **spiral**, the golden angle, the even non-repeating fill of most trees (the default);
- **whorled**, an even ring per node, the conifer's tiers;
- **opposite**, children forced to a pair 180° apart, the plane of the pair turned 90° each level: the decussate candelabra of stacked Y-forks of the maple and the ash.

### Species

`TREE_SPECIES` is a table of named shape bundles: `oak`, `spruce`, `birch`, `willow`, `maple`, `columnar`, `palm`. Each is a partial set of the growth knobs above together with the structural branch knobs, `foliage_density` and `leaf_size_m`. Where the wind patterns of [`motion.md`](motion.md) shape a force, species shape growth.

**Law.** Shape is orthogonal to scene. A species is merged over the current look's own params, leaving its light, camera and wind alone; `tree_species` is an inert label the engine never reads, and every knob stays hand-tunable afterwards. One choice turns the standing tree into an oak or a spruce in whatever scene it is in. A species' structural knobs are topology, so a species change regrows the grove and, in a transition, takes the structural route ([`contracts/transitions.md`](../contracts/transitions.md)). The palm is the original single-hub model, `leader_strength` 0: the first tree was not wrong, only stuck being a palm.

**Provisional.** Each bundle's values are starting points from the tree-architecture research, to be tuned.

## Fullness is leaf size, not count

**Law.** A cluster's shadow is its areal coverage:

```
coverage = (leaf count × leaf area) / cluster-disc area
```

`cluster_spread_m`, the radius leaves scatter over on a twig, is fixed while `leaf_size_m` varies, so a small-leaved species scatters as thin specks that never tile the cluster. Its canopy reads naked, a dark skeleton with ghost-faint leaves, however many leaves are added, because the wood is opaque and a sparse cluster passes most of the light. **Leaf size is the strong lever**: coverage grows with area, and raising the count barely moves it. So each species carries a `leaf_size_m` and `foliage_density` tuned for coverage, never for a raw count.

`foliage_density` scales the leaves per twig (`leaves_per_cluster`). Each clump draws from a stream of its own, so changing the density reshuffles no unrelated clump, and the fractional last leaf of a clump fades in by coverage, so crossing an integer count is continuous ([`leaf.md`](leaf.md), [`contracts/continuity.md`](../contracts/continuity.md)). These are measures on the parameter space, not physics. Density as the regime between twinkle and reorganisation is in [`motion.md`](motion.md).

## A full crown: leaves on the older wood

Seen from above, a crown whose leaves hang only at twig tips is a **wheel**: a ring of leaves well out from the trunk, a thin core, bare limbs for spokes. With the wood drawn, the spokes over the thin core break the blob. The cause is the grammar: only a terminal node bears a cluster, and no twig tip lies near the trunk. José, looking down at park 1 under a high sun: *"looked off, like it's broken … I don't think it'd look like that irl."* A real crown carries **shade leaves on the older wood**, on short and epicormic shoots, thinning inward and never to none. So `inner_leaves` hangs a share of every twig's leaves back along the **whole path of its ancestors to the trunk**. Hanging leaves on a twig and its parent alone does not reach the core; the measurements that ruled it and the twig hug out are in [`measurements`](../evidence/measurements.md#canopy).

### The law

**Law.** One function places a leaf, and everything that shows a leaf asks it: the cast and the tree preview alike.

- **The path.** Growth records, beside each twig, every joint from its tip back to where its limb meets the trunk axis, the droop's sub-segment joints included, so the path follows the curve. The path is carried through the same transform the wood goes through, so it is the wood's own three-dimensional arc. It is collected only while the knob is up.
- **The draw.** Each leaf takes two numbers `(h, u)` from a hash of its own address on a salt of its own. Nothing is drawn from the growth, arrangement or wind streams, so a tree-count or density change moves no one ([`contracts/determinism.md`](../contracts/determinism.md)).
- **The share.** The leaf is on the wood by `s = smoothstep(h, h + 0.05, inner_leaves)`. Its plan place and its height are both mixed from the twig position to the wood position by the same `s`. A slider moves each leaf inward along its own line and pops none. The smoothstep's steepest slope bounds the motion: a step of 0.001 in the share moves any leaf at most 0.03 of its own reach from tip to wood ([`contracts/continuity.md`](../contracts/continuity.md)).
- **Where on the wood.** The leaf hangs at arc distance `d = u² · pathLen` from the tip, so the density along the path falls as `d^(−½)`: thinning inward, never to zero.
- **How it hangs.** It scatters about the wood as the twig hug does but tighter: half a spread back along the heading of the segment it lies on, 0.4 of a spread across it (on the layer path, the blob at 0.4 of a spread). It sits at the height of the point it hangs at.
- **Height and layer follow the leaf.** Every reader that asks a leaf's height takes the leaf's own: its faithful height, its layer bin, its fall height in the litter, its place in the exposure grid. A leaf at its twig's height keeps its twig's layer.
- **A share, not more leaves.** The leaf count and the leaf area are the look's. In an unlit look only a leaf's place and height change. Under the season's light rule the leaves on the wood change who shades whom: an inner leaf sits under the shell, the exposure grid ranks it low, and it turns and lets go later. Nothing is told about position; light decides ([`season.md`](season.md)).

**The gate.** `inner_leaves` 0 is the default: no path is collected, no hash is reached, the cast frame is untouched, and the picture is the previous placement ([`contracts/preservation.md`](../contracts/preservation.md)). It moves leaves, so it is a canopy key: a change regrows the grove and a transition morphs it. It is not a season key.

**By species.** Each species bundle carries its share: spruce 0.5, maple 0.45, columnar 0.4, oak 0.35, willow 0.2, birch 0.15, palm 0. A tight cone or column holds more shade leaves inside, a lacy or weeping crown fewer, and a palm's fronds none. Picking a species sets it; no shipped look names a species, so every shipped look ships 0 (decided 2026-11-09, [`../evidence/observations.md`](../evidence/observations.md)). With a share up, the pivot slip below applies.
## The bake into depth layers

Once per frame the current leaf positions, moved by the wind, are rasterised into **a few depth-binned layers** (3 to 5, `layer_count` of them, evenly spaced from `canopy_base_height_m` up through `canopy_thickness_m`). Leaves bin to a layer by the height they grew to, through the crown curve, so higher foliage blurs more for nothing ([`transport.md`](transport.md) reads the layers).

**Law. Stamp optical depth, not transmittance.** Transmittances multiply, since light must clear every leaf, which would force overlaps to be sorted. Optical depth, `−ln T`, adds, so leaves accumulate with plain additive blending: order-independent, no sorting, overlaps darkening correctly on their own. Transport reads transmittance back as `exp(−depth)`.

**Law.** Depth is per channel, so overlapping leaves are darker and greener together, as Beer's law has it ([`leaf.md`](leaf.md)).

**Law. Soft edges are area-averaging.** A leaf edge crossing a texel covers only part of it, so the texel takes a fraction of the depth. How that texel is read back, as one slab or as a mixture of leaf and gap, is [`leaf.md`](leaf.md)'s.

**Law. The footprint follows orientation.** A leaf's stamp is its true shape foreshortened by its tilt, so a fluttering leaf winks small gaps open and shut: a real share of the glisten lives in the stamp, not in transport ([`leaf.md`](leaf.md)).

**Approximation.** Depth discretisation, the collapse of the canopy's continuous depth into a few layers, is the one approximation every frame pays ([`principles.md`](../principles.md) §5). It is the right place to approximate: it is where performance bites and where the eye forgives. The eye needs some dapples crisp and some soft; it cannot count the layers. Its opt-out is the faithful cast below.

### Texture constraints

**Law.** The layers must resolve the **smallest gaps**, which throw the sharpest sun-images; must **extend past the visible ground by the largest layer shift**, so the dapples never run out of canopy at the frame's edge; and must **tile** where the wind is to scroll them indefinitely. How the endless park wraps and the finite tree stays open is [`fill.md`](fill.md)'s.

## The woody occluder

**Law.** Trunks and limbs are occluders. A backlit tree seen from the side needs its wood in the shadow, and a vertical trunk has no horizontal footprint, so no layer can cast it. The wood is therefore a separate producer of shadow beside the leaves: the canopy's occluders are a set of producers (grown leaves, grown wood, later authored architecture such as a window's grid) feeding one shadow ([`receivers.md`](receivers.md)).

`branch_tau` is the wood's optical depth, by Beer's law. At 0 there is no wood and the picture is the previous law; it is a gate ([`contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).

### On the layer path: a connected analytic occluder

**Law.** On the layer path the wood is a continuous-height **analytic** occluder, never stamped into the layers. Binning wood shatters it: layer quantisation snaps a continuous branch to a few heights, and at a low sun adjacent layers shift a metre apart, so a branch spanning two layers jumps and the trunk floats free of the snapped branches. Leaves are a cloud and do not mind; thin continuous wood does ([`dead-ends`](../evidence/dead-ends.md#canopy)).

- The **trunk and main limbs** (orders 0 and 1) are line segments. Each endpoint's height maps through the same crown curve the leaves bin by, and the bole runs linearly down to the ground. A limb's base meets the trunk at a shared height, so each segment's shadow runs from one endpoint's projection to the other's and the whole sums into **one connected streak**.
- The **fine sub-branches are dropped**. The leaf dapples carry the fine canopy, which is physically right: thin twigs blend into the dappled mass rather than throwing distinct shadows.
- It is evaluated once per pixel along the central sun direction, the bulk offset of [`transport.md`](transport.md), with a soft edge that **grows with height** standing in for the area light's penumbra.
- The limbs **swing with the wind**, each segment rotated about its trunk by the live limb bend, so the wood tracks the leaves; and the wood **drifts** with the trunk, the drift scaled by height, zero at the foot and full at the crown, so the trunk stays **planted** rather than sliding bodily.
- The trunk's width is `trunk_radius_m`, tapered by branch order through the pipe model.

**The table.** The analytic occluder holds a fixed number of segments, filled in growth order with every segment of order 0 or 1 until it runs out: one bole per tree and one per limb, more where a droop of 0.3 or more splits a limb into sub-segments. A grove past the table loses its later trees' wood. On the floor a truncated tail costs a few branch shadows; in the look-up camera the wood is the structure, so the budget becomes a composition rule, `tree_count · (limb_count + 1) ≤ 256` ([`sky-view.md`](sky-view.md)). The table is an authored ceiling, not a performance budget, and raising it repaints any look that has rendered truncated with its wood on, so it is a look decision, never a refactor's ([`contracts/preservation.md`](../contracts/preservation.md)). The harness reports every grove that outgrows it.

The trunk's shadow is cast along the standing scene's bulk offset like every other occluder, which is what keeps trunk, limbs and crown one connected shadow that rakes across the floor with a low sun ([`transport.md`](transport.md)).

The wood is re-derived from the grown skeleton whenever its radius, the layer heights or `branch_tau` change, without regrowing the leaves, in still air too.

## The faithful cast

The layer bake is invisible and correct for the overhead park: the tree is never seen, only its dapple field, so where a leaf is relative to its trunk is not even a question. The moment the tree is seen as an object (the standing scene, the curtain), the layers betray it: leaves snap to a few flat heights, decoupled from the twigs they grew on, and what they cast is no longer the tree. José called it the exploding sandwich.

**Law.** `faithful_canopy` casts the **actual geometry at its real grown heights**, so the shadow is the tree. Off, the layer path is the law and the park pays nothing.

For each source sample, every leaf and the **whole woody skeleton** (trunk, branches and the fine twigs, as tapered capsules, no order dropped) are drawn at their own continuous heights, projected to the floor along that sample's direction (`world − height · g_sample`), with multiplicative blend, so the transmittance is the product of `e^(−τ)` over everything crossed. The per-sample results are weight-summed into **one pre-integrated soft shadow**, which transport reads with a single tap ([`transport.md`](transport.md)). The cost moves from the per-pixel sample loop to the per-sample geometry passes.

Because each offset scales with the real height, the leaves **sit on their twigs** and the twigs **bridge branch to leaf**: the connecting wood lands between the branch's shadow and the leaf's. Three details make it read right:

- **Round wood.** Each wood capsule is built across the shadow's spine: both endpoints are projected first and the width is laid across the streak, so a vertical trunk reads round at every azimuth and never as a flat ribbon.
- **Anchored sway.** The coherent sway scales with height, zero at the ground and full at the crown, for leaves and wood alike, so the tree bends as one piece anchored at its foot ([`motion.md`](motion.md)).
- **Leaves hug the twig.** Leaves are distributed along the twig, back from the tip along its heading, with a tight perpendicular jitter, not an isotropic blob. Leaves on the older wood hug that wood in the same way. The layer path keeps the blob.

**Law. One joint, shared.** Leaves and wood are visible and registered, so they must move about the same point. Growth records each terminal twig's real base, where it attaches to its parent, and both the leaves and that twig's own wood swing about it, by the same angle, in the same order: twig about its base, then twig and leaves together about the limb. Registration holds by construction. The stem joint and why it must sit off the clump are [`motion.md`](motion.md)'s, as is the limb pitch's foreshortening, applied to leaves and wood by one factor from one state. An earlier faithful cast dropped the twig band to keep registration, buying it with stillness ([`dead-ends`](../evidence/dead-ends.md#canopy)).

**Law. The frame is the tree's.** The cast frame is bounded by the real plan extent of the leaves and wood, padded for sway and drift, never an assumed box that would clip a wide crown. Its height range starts at the twig tips' lowest and highest, and any leaf hung on wood beyond either end pulls that end out to itself, so the frame always holds the cast.

**Authored.** The faithful wood's rim is a deliberately tight anti-alias, not the leaf's edge softness (which models a leaf half-covering a texel), so thin twigs stay opaque. The wood's penumbra comes from integrating over the sun's disk, not from the rim.

**Law. The pre-baked tier needs a receiver frame.** Where no single frame exists the layer path is forced: in the tent ([`receivers.md`](receivers.md)) and in the sky view, which has no cast frame at all ([`sky-view.md`](sky-view.md)); the reason is [`transport.md`](transport.md)'s. One predicate decides it for every stage, so they always agree.

The faithful cast is the heavy rung. Its fallback is the layer path, and the quality governor never crosses that rung silently ([`contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).

## The continuous tree count

**Law.** `tree_count` is continuous. A fractional count renders its whole part as full trees and one marginal tree faded in by the remainder, its leaves and its wood alike carrying the fade on every reader. Trees are appended at the end of the growth stream, so a fractional count only adds or removes the **last** tree and the others keep their structure; an integer count renders the grove it always did. A tree's own draws (its clock, its pigment depth, its leaf genotype, in [`season.md`](season.md) and [`leaf.md`](leaf.md)) are a pure function of the seed and its index, the marginal tree's included.

So a change of tree count grows a tree in, the others re-spacing to make room and, outside a standing scene, their crowns shrinking a touch, rather than popping a new layout. That re-spacing is a regrow, which is why the count is never a mere reweighting of coverage. When the two looks share a topology the transition is a morph ([`transitions.md`](transitions.md)).

## Approximations and limits

- **Approximation: depth discretisation.** The layer path's few layers stand in for the canopy's continuous depth. Absent under `faithful_canopy`. The one approximation every frame pays.
- **Approximation: the analytic wood's penumbra.** A soft edge that grows with height stands in for the area light's penumbra on the trunk and limbs, cast along the central sun direction only. Absent under `faithful_canopy`, where the disk is integrated.
- **Approximation: no fine wood on the layer path.** Sub-branches below the main limbs throw no shadow there; the dapples carry them. Absent under `faithful_canopy`.
- **Authored: the occluder table.** A grove past the table loses its later trees' analytic wood. Reported, never silent.
- **Approximation: a layer crossing is a layer step.** On the layer path a leaf's layer is a step function of its height, so an inner leaf whose height crosses a bin edge as the share moves changes layer and its shadow changes floor. That is the layer path's own quantisation, not a pop in the share.
- **The pivot weight.** A faithful leaf hung back on wood older than its own twig (past the twig's grown base on its path) drops its twig's bend by its share `s` on the wood, so it follows the wood it hangs on instead of swinging off the limb in the twig band. Without it the slip reached a quarter metre on `park 1` ([`measurements`](../evidence/measurements.md#canopy)); with it, 0 for leaves wholly on the wood, and up to 0.11 m for the few gliding between tip and wood, which keep that share of the twig's bend. Built 2026-11-09 (José). The layer path keeps its synthesised stem. **Approximation:** the transitions' own leaf passes (season travel, leaf travel, the litter flight) read no weight, so a species look with inner leaves swings them with the twig while a transition flies.
- **Approximation: the share is a per-twig budget.** Each twig spends its own leaves along its own path, so a limb carries leaves in proportion to the twigs it bears, not to its length; real shoots are per metre of wood.
- **Approximation: no sun/shade dimorphism in size.** An inner leaf is the size of a tip leaf; a real shade leaf is larger and thinner. (Outline does vary by light class under `leaf_variety`, [`leaf.md`](leaf.md).)
- **Approximation: no epicormic wood.** Inner leaves hang on the grown skeleton's own wood; nothing grows to carry them.
- **Approximation: the sway's height scale moves with the frame.** The faithful sway is a height over the frame's top, so a look whose inner leaves pull the top out (a strong droop puts wood above every tip) leans a hair less at a given height. At `inner_leaves` 0 neither end moves.
- **Approximation: crown aspect is invisible to the layer cast.** Binning by height normalises a uniform height scale away.

## Not built

- Per-order shape arrays (angle, length and count per branch order), multi-stem and clumping trees, the flat-topped savanna form ([`exploration/open.md`](../exploration/open.md)).
- Species per tree, the mixed grove ([`exploration/open.md`](../exploration/open.md)).
- Rooting the trees wholly outside the frame for a pure shadow-only composition ([`exploration/open.md`](../exploration/open.md)).

**Open.** How few skeleton levels still give convincing multi-scale gaps; the default foliage density and how it is exposed; the layer count and the height assignment of each layer ([`exploration/open.md`](../exploration/open.md)).

## Related

- [`overview.md`](overview.md): where the canopy sits in the chain.
- [`leaf.md`](leaf.md): one leaf's material and outline, the texel's mixture and the marginal fade.
- [`season.md`](season.md): the turn, the drop and the litter the grove carries.
- [`motion.md`](motion.md): the wind and the spring hierarchy that move the structure.
- [`transport.md`](transport.md): how the layers, the analytic wood and the faithful shadow are read.
- [`sky-view.md`](sky-view.md): the skeleton seen, the wood's own texture, and the occluder budget as composition.
- [`receivers.md`](receivers.md): the surfaces the shadow lands on, and why the tent forces the layer path.
- [`transitions.md`](transitions.md): grove morphs, the tree count, and the structural routes.
- [`contracts/preservation.md`](../contracts/preservation.md), [`contracts/continuity.md`](../contracts/continuity.md), [`contracts/determinism.md`](../contracts/determinism.md): what the gates, the share and the addresses owe.
- [`evidence/dead-ends.md#canopy`](../evidence/dead-ends.md#canopy), [`evidence/measurements.md#canopy`](../evidence/measurements.md#canopy): the history and the numbers.
