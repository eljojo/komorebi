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

The crowns overlap to fill the frame. One tree grown from a central trunk leaves a bright bare hole over the trunk, because all its foliage hangs outboard in a ring; a grove has no such hole, and it is what the park was: several trees, the smaller ones reading denser because the same cluster is packed into a smaller crown. The grove fills a **reach**, a span of ground: its trees are spaced across it, and in the overhead looks its crowns are sized to it, capped to fit inside the bake. In a standing scene the crown is instead sized to a natural fraction of the bake's extent, so a single tree is a finite object and the surround reads as lit floor ([`receivers.md`](receivers.md), [`camera.md`](camera.md)); the reach still spaces its trees.

**Law: a zoom moves the camera and never the trees.** A look names its reach (`grove_reach_m`). One that names none takes the view's extent as it stands when its grove is grown, so the grove fills the frame the look loads in; the first time the view moves under that grove, the look takes the reach the grove has and carries it. A look zoomed on screen and the same look saved and loaded again are then one grove, and a later regrow grows the one that stood. The trees are spaced across the reach only up to a cap inside the bake (0.46 of the canopy's extent), so two reaches past it are one grove ([`measurements`](../evidence/measurements.md#a-park-look-zoomed-against-the-same-look-loaded-at-that-zoom)).

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

**Authored.** The wood drawn at its real heights (the faithful cast, the sky view's fine wood, the tree seen from the floor) is never thinner than 8 mm in radius, 12 mm at a capsule's thick end, so the finest twigs show at all. Seen from across a park, that crosses a full crown with dark hairs, and its shade reads as grey wood rather than leaves. `thin_twigs` lowers the floor to 2 mm, so each twig keeps the pipe model's width down to a 4 mm twig, and the tree view draws one finer than a pixel by how much of the pixel it covers ([`camera.md`](camera.md#the-tree-seen-from-the-floor-camera)). Wood above the old floor, and the analytic occluder, are untouched.

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

### A tree grown from buds

With `growth_years` above 0 a tree is grown rather than drawn: year by year each bud grows a shoot, waits or dies by the light that reaches it from the growth sky, shaded branches fall, and the crown is the record of that history. It is a prototype; how it grows and what it still lacks are in [`directions.md`](../exploration/directions.md#trees-grown-year-by-year-from-buds-under-light). It hangs the leaves the grammar would for the same knobs ([below](#leaves-on-shoots)). Four habits of real trees belong to it alone. Each is off by default, and off is the tree without it ([`contracts/preservation.md`](../contracts/preservation.md)); each regrows the grove, and two looks that differ in one cross as two groves.

- **Two-ranked buds** (`two_ranked`). **Law of form.** On an elm, a beech, a hornbeam or a linden the side buds sit one to a node, alternately left and right of the shoot in one flat plane, so the side shoots fan out in flat sprays. Here the plane is the one through the shoot and the horizontal across it. It takes the phyllotaxis's place in the grown tree; the grammar keeps the look's.
- **Sympodial shoots** (`sympodial`, 0 to 1). **Law of form.** In an elm, a linden or a hornbeam the tip of each year's shoot aborts and the highest side bud carries the axis on, so a twig zigzags, kinking at every node away from the bud it bears. Here each internode of a fine shoot turns off the last, by about 20° at full strength, away from the side bud at the node between them, and the bud that carries the axis on leans toward that side bud. Under two-ranked buds the zigzag lies in the spray's plane. The trunk and the limbs held at their set angle stay straight, as an old elm's do; kinked too, they starved the crown ([`dead-ends`](../evidence/dead-ends.md#canopy)).
- **The trunk's split** (`trunk_split`, 2 to 6 stems). **Law of form.** An elm, a zelkova or a honey locust in the open forks low into a few stems of one rank that lean apart and rise in a vase. Here the leader ends the year it first reaches the fork's height, and sets that many stems in its terminal bud's place. Each stem is of the trunk's own order, so the year's resource divides evenly between them, as between co-dominant leaders. Each leans about 26° off the vertical, at even turns about the trunk, is held toward its lean and keeps three tenths of the trunk's pull upward, so the stems fan out and turn gently up. The trunk is clear of branches up to the fork. **Authored:** the fork stands ten internodes up, where the vase matched the artist's photograph of an elm by Dow's Lake ([`dead-ends`](../evidence/dead-ends.md#canopy)). **Provisional:** the lean, the hold and the pull, set by eye on that tree.
- **Twig haze** (`twig_haze`, 0 to 3 orders). The buds grow fewer orders in the years they run than a real crown carries, so against the sky a grown crown's rim reads emptier than its middle, where a real bare crown is a haze of twigs right out to its edge. Each of the last year's shoots carries `branch_children` side twigs about half its length, turned off it by the branch angle, and each of those the same again, as many orders deep as asked, each finer than the stem it leaves. Under two-ranked buds they alternate in the plane. Each is straight, under sympodial shoots too: wherever a tree is framed whole a haze twig is a small fraction of a pixel wide, and its kink would move it by less than a pixel. They are wood alone, hung on their shoot's cluster so they sway with its leaves; the tree, its leaves and its draws are untouched. They are fine wood whatever the order of the shoot they ride, the leader's included, so the layer path's analytic wood, the trunk and main limbs, never holds one.

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

**The gate.** At `inner_leaves` 0 no path is collected, no hash is reached, the cast frame is untouched, and the picture is the previous placement ([`contracts/preservation.md`](../contracts/preservation.md)). The default is 0.35 since 2026-11-16, and a look made before keeps 0 ([`../contracts/looks.md`](../contracts/looks.md#four-laws-on-by-default-and-the-looks-kept-as-made)). A change regrows the grove. Between looks it travels as topology: two looks that differ in it cross as two groves, because a transition's morph ran each leaf's glide from tip to wood in a few frames and its leaves flew ([`../evidence/dead-ends.md`](../evidence/dead-ends.md#canopy)). It is not a season key.

**By species.** Each species bundle carries its share: spruce 0.5, maple 0.45, columnar 0.4, oak 0.35, willow 0.2, birch 0.15, palm 0. A tight cone or column holds more shade leaves inside, a lacy or weeping crown fewer, and a palm's fronds none. Picking a species sets it. No shipped look names a species; most carry the default share, with their density brought down so as much floor stays in sun, and the few where the full crown fills the middle dark keep 0 ([`../contracts/looks.md`](../contracts/looks.md#four-laws-on-by-default-and-the-looks-kept-as-made)). With a share up, the pivot slip below applies.
## Leaves on shoots

A twig does not carry its leaves as a haze around its tip. **Law.** The twig is last year's long shoot, and this year's shoots leave it at its nodes: the leader at its tip, the laterals back along its own wood, alternately left and right, or in pairs at right angles where the tree's phyllotaxis is opposite. Each shoot carries a few leaves, one a node (three to five, beech) or a pair a node (two to four pairs, maple), and each blade sits off its node on its petiole, fanned forward so the blades point along the branch (Gregory 1980; Dupré et al. 1986; Planchais & Sinoquet 1998). So `shoot_leaves` hangs each cluster's leaves at the nodes of its shoots, and a crown gathers into clumps with sky between.

- **Light decides short or long.** Each cluster has a light: the growth sky's, overhead, never the scene's sun. Every cluster above casts its leaf area down a cone widening by one unit per unit of drop (Pałubicki et al. 2009's shadow pyramid), and the light is `e^(−½ · leaf area index above)`. A shoot in shade stays short, its internodes about 2.5 mm; one in sun grows long, from 11 mm on, and in full light rises toward upright. Which shoots go long is each shoot's own threshold against the share of long laterals, 40 % at 0.14 of open light to 85 % in the open (Lemoine et al. 2002), so the change is a glide, not a step. Lengths are botanical, in blade lengths: a beech blade is 50 mm.
- **A leaf's shoot and node are its own.** They are a pure hash of the leaf's address on a stream of their own, never of the light, so a density step adds leaves at the end of the last shoot and moves no one ([`contracts/determinism.md`](../contracts/determinism.md)). Light moves only continuous things: the internodes, the rise, the tilt.
- **A switch, crossing as two groves.** A leaf's old place and its node can be a limb apart, so the shoots are on or off, never a share: stepped through a share, a one-second change flew a leaf nineteen of its own lengths in a frame and the gaps it crossed flickered ([`../evidence/dead-ends.md`](../evidence/dead-ends.md#canopy)). Two looks that differ in it cross as two groves, the crossfade or the scene fade ([`transitions.md`](transitions.md)), where no leaf travels. With `inner_leaves` up, a share of the **shoots** hangs back on the older wood, whole: spurs on old wood, by the same arc law as single leaves.
- **One function.** The placement is `inner_leaves`' one function ([above](#the-law)), so the cast and the tree preview show the same shoots.
- **A tree grown year by year** (`growth_years`) hangs its leaves on its own grown shoots, and `shoot_leaves` stands aside. They are the last year's shoots, so a grown crown gathers its leaves at the branch ends, in balls with empty crown between. A tree that bears its leaves on short spur shoots along its older wood (ginkgo, apple, larch) leafs the shoots of its last few years (`leaf_years`; 1 is the last year alone): the same clusters and the same leaves, each cluster's shared along more wood, so the crown fills along every branch and shades itself by degrees.
- **Provisional: the shoots and the stalks as wood** (`leaf_stalks`, off by default). A leaf on a shoot hangs at its node, off its twig by the shoot and off its node by its petiole, and neither was drawn, so the leaves floated beside the wood they grow from. With it on, on the faithful canopy, each shoot is drawn as wood from where it leaves drawn wood (the point of its twig's path nearest its base) to its farthest node, and each leaf's petiole from its node to its blade's base, at their own radius, a hundredth of a blade length (about 0.5 mm on a 50 mm beech blade), not the pipe model's, and never the twigs' floor. They turn with their twig as its leaves do. The leaves do not move. Approximations: a shoot is straight from its base to its last node; a petiole lies level, at its node's height; it stays on the wood after its leaf has fallen, and is there before its leaf is out.
- **Provisional: the shoots' base and length** (`shoots_on_twig`, `shoot_length`, off and 1 by default). A lateral shoot was placed by stepping straight back from its twig's tip, along the twig's plan heading and at the tip's height, so on a twig that curves or droops it began in the air beside it; drawn as wood (`leaf_stalks`), the shoot then bridged that gap, up to 42 cm on `park 1`. With `shoots_on_twig` on, a lateral leaves the twig's own grown wood, the same arc back from the tip, held at the twig's base where the twig is shorter; its direction is as before. `shoot_length` scales every internode: they are in blade lengths, set against a 50 mm beech blade, so a look with 15 cm blades grows shoots of 16 cm (median) and up to 26 cm, its leaves spread far along them. Both move leaves; at their defaults the placement is the old one, to the bit. Seen on `park 1` under its trees with the stalks drawn, against half the length and the knobs off, a third read right: about the internodes a 50 mm beech blade has, the leaves close along their twigs and the shoots no longer reading as twigs. Not yet set on any look; the floor under it is not yet seen.

**The gate.** At `shoot_leaves` 0 no light is computed and no shoot drawn, and the picture is the previous placement. The default is 1 since 2026-11-17; the afternoon looks, `forest floor`, `morning 1`, `morning 2`, `morning 3` and `prism` keep 0, as the artist chose ([`../contracts/looks.md`](../contracts/looks.md#leaves-on-shoots-by-default)). It moves leaves into another arrangement, so it is a topology key: a change regrows the grove, and a transition crosses it.

## The bake into depth layers

Once per frame the current leaf positions, moved by the wind, are rasterised into **a few depth-binned layers** (3 to 5, `layer_count` of them, evenly spaced from `canopy_base_height_m` up through `canopy_thickness_m`). Leaves bin to a layer by the height they grew to, through the crown curve, so higher foliage blurs more for nothing ([`transport.md`](transport.md) reads the layers).

**Law. Stamp optical depth, not transmittance.** Transmittances multiply, since light must clear every leaf, which would force overlaps to be sorted. Optical depth, `−ln T`, adds, so leaves accumulate with plain additive blending: order-independent, no sorting, overlaps darkening correctly on their own. Transport reads transmittance back as `exp(−depth)`.

**Law.** Depth is per channel, so overlapping leaves are darker and greener together, as Beer's law has it ([`leaf.md`](leaf.md)).

**Law. Soft edges are area-averaging.** A leaf edge crossing a texel covers only part of it, so the texel takes a fraction of the depth. How that texel is read back, as one slab or as a mixture of leaf and gap, is [`leaf.md`](leaf.md)'s.

**Law. The footprint follows orientation.** A leaf's stamp is its true shape foreshortened by its tilt, so a fluttering leaf winks small gaps open and shut: a real share of the glisten lives in the stamp, not in transport ([`leaf.md`](leaf.md)). A leaf's record keeps its heading, its tilt and its **side**, which way it rolls: the stamp is the same either way, and the tree seen from the floor camera stands each leaf up by it ([`leaf.md`](leaf.md#a-leaf-seen)).

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

**The trunk's foot.** With `trunk_base` the grove finds each tree's foot as it grows: the plan point where its lowest trunk capsule stands on the ground, and the trunk's radius there. The wood is not changed; what reads the foot is what stands round it. The seen trunk stands in the ground, flaring into its roots, and a split trunk closes over its fork in a dome ([`camera.md`](camera.md#the-tree-seen-from-the-floor-camera)); the floor round each foot loses the skylight the trunk hides.

## The faithful cast

The layer bake is invisible and correct for the overhead park: the tree is never seen, only its dapple field, so where a leaf is relative to its trunk is not even a question. The moment the tree is seen as an object (the standing scene, the curtain), the layers betray it: leaves snap to a few flat heights, decoupled from the twigs they grew on, and what they cast is no longer the tree. José called it the exploding sandwich.

**Law.** `faithful_canopy` casts the **actual geometry at its real grown heights**, so the shadow is the tree. Off, the layer path is the law and the park pays nothing.

For each source sample with nonzero weight, every leaf and the **whole woody skeleton** (trunk, branches and the fine twigs, as tapered capsules, no order dropped) are drawn at their own continuous heights, projected to the floor along that sample's direction (`world − height · g_sample`), with multiplicative blend, so the transmittance is the product of `e^(−τ)` over everything crossed. The per-sample results are weight-summed into **one pre-integrated soft shadow**, which transport reads with a single tap ([`transport.md`](transport.md)). The cast bounds still cover the full source so they stay stable as sample weights cross zero. The cost moves from the per-pixel sample loop to the per-sample geometry passes.

Because each offset scales with the real height, the leaves **sit on their twigs** and the twigs **bridge branch to leaf**: the connecting wood lands between the branch's shadow and the leaf's. Three details make it read right:

- **Round wood.** Each wood capsule is built across the shadow's spine: both endpoints are projected first and the width is laid across the streak, so a vertical trunk reads round at every azimuth and never as a flat ribbon.
- **Anchored sway.** The coherent sway scales with height, zero at the ground and full at the crown, for leaves and wood alike, so the tree bends as one piece anchored at its foot ([`motion.md`](motion.md)).
- **Leaves hug the twig.** Leaves are distributed along the twig, back from the tip along its heading, with a tight perpendicular jitter, not an isotropic blob. Leaves on the older wood hug that wood in the same way. The layer path keeps the blob.

**Law. One joint, shared.** Leaves and wood are visible and registered, so they must move about the same point. Growth records each terminal twig's real base, where it attaches to its parent, and both the leaves and that twig's own wood swing about it, by the same angle, in the same order: twig about its base, then twig and leaves together about the limb. Registration holds by construction. The stem joint and why it must sit off the clump are [`motion.md`](motion.md)'s, as is the limb pitch's foreshortening, applied to leaves and wood by one factor from one state. An earlier faithful cast dropped the twig band to keep registration, buying it with stillness ([`dead-ends`](../evidence/dead-ends.md#canopy)).

**Law. The frame is the tree's.** The cast frame is bounded by the real plan extent of the leaves and wood, padded for sway and drift, never an assumed box that would clip a wide crown. Its height range starts at the twig tips' lowest and highest, and any leaf hung on wood beyond either end pulls that end out to itself, so the frame always holds the cast.

**Authored.** The faithful wood's rim is a deliberately tight anti-alias, not the leaf's edge softness (which models a leaf half-covering a texel), so thin twigs stay opaque. The wood's penumbra comes from integrating over the sun's disk, not from the rim.

**Approximation. The wood under its own penumbra** (`thin_twigs`). A capsule narrower than the sun's disk seen from its height (`2r < 0.0093·h`, the disk's 0.53°) has no umbra: each sample casts a sliver of it, and the samples together spread it into a band as wide as the source's footprint at that height and as dark as the twig covers of the band. So such a capsule is not drawn per sample. It is drawn once, after them, at the samples' mean shift, widened across its spine to a box with the samples' own spread there (half-width `√3·σ·h`, `σ` the spread of the sample shifts across the spine, never under a texel's width), passing `1 − (2r/width)·(1 − e^(−τ))`, and that transmittance multiplies the integrated shadow. On average a lone twig's shadow is exact; where fine twigs cross each other or a leaf, the product of their averages stands for the average of their product, so where they overlap they shade a little more evenly than they would. The leaves keep their per-sample draw: their gaps are the sun-images, which exist only in that average of products. A tree with a haze of a hundred thousand twigs then pays one pass of them, not one a sample. Absent: `thin_twigs` off, or on a receiver.

**Law. The pre-baked tier needs a receiver frame.** Where no single frame exists the layer path is forced: in the tent ([`receivers.md`](receivers.md)) and in the sky view, which has no cast frame at all ([`sky-view.md`](sky-view.md)); the reason is [`transport.md`](transport.md)'s. One predicate decides it for every stage, so they always agree.

The faithful cast is the heavy rung. Its fallback is the layer path, and the quality governor never crosses that rung silently ([`contracts/gates-and-rungs.md`](../contracts/gates-and-rungs.md)).

## The continuous tree count

**Law.** `tree_count` is continuous. A fractional count renders its whole part as full trees and one marginal tree faded in by the remainder, its leaves and its wood alike carrying the fade on every reader. Trees are appended at the end of the growth stream, so a fractional count only adds or removes the **last** tree and the others keep their structure; an integer count renders the grove it always did. A tree's own draws (its clock, its pigment depth, its leaf genotype, in [`season.md`](season.md) and [`leaf.md`](leaf.md)) are a pure function of the seed and its index, the marginal tree's included.

So a change of tree count grows a tree in, the others re-spacing to make room and, outside a standing scene, their crowns shrinking a touch, rather than popping a new layout. That re-spacing is a regrow, which is why the count is never a mere reweighting of coverage. When the two looks share a topology the transition is a morph ([`transitions.md`](transitions.md)).

## Approximations and limits

- **Approximation: depth discretisation.** The layer path's few layers stand in for the canopy's continuous depth. Absent under `faithful_canopy`. The one approximation every frame pays.
- **Approximation: the analytic wood's penumbra.** A soft edge that grows with height stands in for the area light's penumbra on the trunk and limbs, cast along the central sun direction only. Absent under `faithful_canopy`, where the disk is integrated.
- **Approximation: no fine wood on the layer path.** Sub-branches below the main limbs throw no shadow there; the dapples carry them. Absent under `faithful_canopy`.
- **Approximation: the wood under its own penumbra** is cast once at the samples' mean, as a box of their spread, multiplied onto the leaves' shadow ([the faithful cast](#the-faithful-cast)). Absent: `thin_twigs` off.
- **Authored: the occluder table.** A grove past the table loses its later trees' analytic wood. Reported, never silent.
- **Approximation: a layer crossing is a layer step.** On the layer path a leaf's layer is a step function of its height, so an inner leaf whose height crosses a bin edge as the share moves changes layer and its shadow changes floor. That is the layer path's own quantisation, not a pop in the share.
- **The pivot weight.** A faithful leaf hung back on wood older than its own twig (past the twig's grown base on its path) drops its twig's bend by its share `s` on the wood, so it follows the wood it hangs on instead of swinging off the limb in the twig band. Without it the slip reached a quarter metre on `park 1` ([`measurements`](../evidence/measurements.md#canopy)); with it, 0 for leaves wholly on the wood, and up to 0.11 m for the few gliding between tip and wood, which keep that share of the twig's bend. Built 2026-11-09 (José). The layer path keeps its synthesised stem. Leaf travel and grove regrouping read the weight, so their leaves leave and land where the bake draws them ([`transitions.md`](transitions.md)). **Approximation:** the other transitions' own leaf passes (season travel, the litter flight) read no weight, so a species look with inner leaves swings them with the twig while those fly.
- **Approximation: the share is a per-twig budget.** Each twig spends its own leaves along its own path, so a limb carries leaves in proportion to the twigs it bears, not to its length; real shoots are per metre of wood.
- **Approximation: no sun/shade dimorphism in size.** An inner leaf is the size of a tip leaf; a real shade leaf is larger and thinner. (Outline does vary by light class under `leaf_variety`, [`leaf.md`](leaf.md).)
- **Approximation: no epicormic wood.** Inner leaves hang on the grown skeleton's own wood; nothing grows to carry them.
- **Approximation: the sway's height scale moves with the frame.** The faithful sway is a height over the frame's top, so a look whose inner leaves pull the top out (a strong droop puts wood above every tip) leans a hair less at a given height. At `inner_leaves` 0 neither end moves.
- **Approximation: the shoots.** A shoot's leaf count does not follow its type; a cluster has one light, its twig's, so an inner shoot on old wood is lit as its twig; the twig's plan heading stands for its three-dimensional axis; a leaf sits at its node's height. Petiole length follows the phyllotaxis (long on an opposite tree, short otherwise), true of maple and beech, not of poplar. **Provisional:** every shoot constant but the cited ones (the long internode at full vigour, the twig's own internodes, the rise, the petioles, the fan).
- **Approximation: no per-branch overlap by light.** Sunny branches overlap more than shaded ones (Planchais: leaf area index 1.6 against 0.95); the shoots give 1.09 at best. That is branching by light, the grown tree's ([`../exploration/directions.md`](../exploration/directions.md)).
- **The cost of the light.** The cluster light is computed on every regrow: the build of `morning 2` takes about twice as long with shoots on, which a grove morph pays every step ([`measurements`](../evidence/measurements.md#canopy)).
- **Approximation: crown aspect is invisible to the layer cast.** Binning by height normalises a uniform height scale away.
- **Authored: the wood's floor.** The finest drawn twigs are wider than the pipe model makes them, so that they show ([Taper](#taper)). `thin_twigs` lowers the floor to 2 mm.
- **Approximation: spurs are old shoots.** Under `leaf_years` the leaves of the years before the last hang along those years' own long shoots, where a real spur is a short shoot standing off the old wood, growing a few millimetres a year. Absent at 1.
- **Approximation: one internode for several nodes.** Under sympodial shoots the side bud the continuing bud stands in for is kept, because a grown internode stands for several of a real shoot's nodes; and the finest shoots keep their turn upward under droop. Taking either away unravelled the crown ([`dead-ends`](../evidence/dead-ends.md#canopy)). Absent at `sympodial` 0.
- **Approximation: the twig haze is added, not grown.** Its twigs come after the tree's growth: no light chooses them, they shade no bud and carry no leaf, and each is straight. Absent at `twig_haze` 0.

## Not built

- Per-order shape arrays (angle, length and count per branch order), clumping trees (several stems from the ground), a fork in the grammar's tree, the flat-topped savanna form ([`exploration/open.md`](../exploration/open.md)). A grown tree's low fork into co-dominant stems is [built](#a-tree-grown-from-buds).
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
- [`camera.md`](camera.md#the-tree-seen-from-the-floor-camera): the tree seen from the floor, where the thin twigs, the foot and the fork are drawn.
- [`transitions.md`](transitions.md): grove morphs, the tree count, and the structural routes.
- [`contracts/preservation.md`](../contracts/preservation.md), [`contracts/continuity.md`](../contracts/continuity.md), [`contracts/determinism.md`](../contracts/determinism.md): what the gates, the share and the addresses owe.
- [`evidence/dead-ends.md#canopy`](../evidence/dead-ends.md#canopy), [`evidence/measurements.md#canopy`](../evidence/measurements.md#canopy): the history and the numbers.
