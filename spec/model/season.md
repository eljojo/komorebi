# The season

*The slow axis: how a leaf's colour, its presence on the tree and its resting place on the ground change across a fall.*

What mattered most in the autumn the trees were watched through was not that leaves go red but **how one tree can be red while the one beside it is yellow or green** ([`../experience.md`](../experience.md#autumn)). Within a crown the sunlit top turns first and reddest; trees and buildings shade one another, and which goes red first follows that geography; one tree runs ahead of its own kind for no visible reason. Then the leaves let go, the sunlit ones first, and lie on the ground as a different object: they cast nothing, they are seen by reflection, they age red to copper to brown, and after rain they lie darker.

None of it is simulated over time: the same look at the same phenology is the same autumn, whenever it is drawn.

## The season clock

`phenology` is the season, one number: **0** spring bud, **0.5** summer, **1** the end of the fall. A leaf's colour turns between `turn_start` (**0.6**) and `turn_start + turn_span` (**0.9**); its letting go is a separate law, abscission, behind its own gate. So phenology 1 is every leaf fully turned, not a bare tree; a bare tree is what abscission makes of it.

There is **no spring half** yet: below the turn, the season is simply summer and the leaf is its authored self.

## Senescence: every leaf runs its own clock

A leaf turns by **losing** something and **gaining** something. The chlorophyll is dismantled, which uncovers the carotenoid yellow that was there all along; anthocyanin is synthesised, red; tannin browns the leaf, the russet of beech and oak. And no two leaves do it together. Each has its own start and its own capacity, which is why one tree in the photographs carries green, gold and red side by side, with about a threefold range in red depth across its leaves.

On the ground this is the colour of the **shade, not of the light**: the sun-images stay white-gold and the shade between them goes warm, because the colour lives in what the leaves pass. That inversion of the dusk law is told in [`light.md`](light.md); the shade's skylight takes the leaves' colour too, through the fill ([`fill.md`](fill.md)).

### The pigment basis

**Law.** Optical depth is additive, so each pigment is a **basis vector of per-channel optical depth**, and a turned leaf is the summer leaf with its green taken away and pigments added. For leaf *j* and channel *c*:

> `τ_cell = τ_summer·(1 − s_j) + s_j·(τ_car + a_j·τ_ant + b_j·τ_brown)`

`τ_summer = −ln(trans_rgb)` is the look's own leaf, so every look keeps the hue its author gave it; `s_j ∈ [0,1]` is how far the leaf has turned; `a_j` and `b_j` are its red and brown capacities. The turned leaf's optical depth is the only thing that changes. Nothing downstream learns about pigments: the bake, the faithful cast, the sky view and the fill read a leaf's optical depth as they always have, so every path that sees a leaf sees it turned.

The leaf is not one tissue. Its vein walls carry the same pigment state with the anthocyanin removed (`τ_wall`: vein tissue makes none), so the veins stay gold while the cells go red; `τ_cell` and `τ_wall` together feed the sieve mixture, `wall_fraction`, whose law is in [`leaf.md`](leaf.md).

**Provisional.** The three basis vectors are chosen from the pigments' known absorption, not fitted: carotenoid absorbs blue and passes red and green (a gold, transmitting about 0.74 / 0.58 / 0.06); anthocyanin absorbs green and a little blue (on the gold it reads orange at a capacity of 0.2, deep red at 0.8, crimson at 1.2); tannin is a broad absorber leaning warm, its depth greatest in blue and least in red. They wait for backlit measurements, one leaf per pigment state against a diffuser, `τ = −ln(leaf / diffuser)`. Until then what is held is their **ordering** and the picture it must paint: a maple at the end of the turn with `anthocyanin` 0.8 passes red over green over blue, its green a fraction of its red.

### The per-leaf clock

Each leaf draws three numbers of its own, φ_j, h_j, h′_j ∈ [0,1):

> `s_j = smoothstep(turn_start + φ_j·turn_spread, turn_start + turn_span, phenology)`
> `a_j = anthocyanin·(0.5 + h_j)`    `b_j = tannin·(0.5 + h′_j)`

A leaf begins at `turn_start` plus its own share of `turn_spread` and has finished by `turn_start + turn_span`, so the middle of the turn is a **mosaic**, not a wash. The default spread, 0.18, is 0.6 of the default span for exactly that reason; the spread is held below the span (at most 0.95 of it) so that no leaf's turn degenerates to a step. The factor `0.5 + h` is the observed threefold range: the deepest leaf is three times the palest. With `drop_after_turn` on, each leaf's turn is instead a window of its own length; see [after the turn](#after-the-turn).

**Law (identity).** The three numbers are pure functions of the leaf's address (seed, cluster, leaf) on a stream of its own, never the growth stream. A leaf keeps its identity as the tree count or the foliage density morphs, so a leaf that turns red stays that leaf; and the grove's structure is never re-drawn by a colour knob ([`../contracts/determinism.md`](../contracts/determinism.md)).

### The summer gate

**Law.** A leaf with `s_j = 0` carries its authored optical depth **literally**, the same numbers with no arithmetic on them, whatever the pigment knobs say. Every leaf is in that state at any phenology up to `turn_start` (up to `turn_start − tree_clock_spread` once a tree can run ahead; see [one tree ahead](#one-tree-ahead-of-its-neighbours)). The default phenology, 0.5, sits behind the gate, so every summer look is its own previous picture with the whole fall family armed.

The gate is `s_j = 0` and not `wall_fraction = 0`: at `s_j = 0` wall and cell are one tissue and the sieve is the identity in exact arithmetic; the gate makes it the identity in practice, which is what lets a vein share ride along on a summer look and change nothing. What a gate's off state owes is [`../contracts/preservation.md`](../contracts/preservation.md).

The pigment knobs are grove-wide leaf colour: they morph the same grove under a transition, and with the rest of the season set they re-season it rather than regrow it ([below](#re-seasoning-the-season-is-a-function-of-the-grove)).

## Light decides who turns first

Anthocyanin is made in light. In a real stand the exposed crown top, the sun side, the outer shell and a tree with no shading neighbour turn first and turn reddest, while the shaded interior and underside turn later and stay yellower; tips red, then yellow, then green at the bottom of the same tree, according to their access to light. So each leaf gets an **exposure** `e_j ∈ (0,1]`, the fraction of a sun ray that reaches it through the leaves in the way, and exposure **orders** the turn that the per-leaf clock alone left to chance. The knob is `turn_exposure`, 0 to 1, default **0**.

### The exposure grid

**Approximation.** Exposure is computed once per grove, on the grown leaves, before their colour is written. Leaf **area** (each leaf's flat ellipse times its marginal fade, so a fading leaf or tree weighs what it is) is binned into a plan grid over the canopy extent, about 48 cells across, and into 24 height bands over the grown crown, at the leaves' real heights, so the layer and faithful paths see one grove. The cell edges sit at fixed multiples of the extent, so a morph that nudges leaves does not slide the lattice; the cells widen only for a grove more than twice the extent across.

Each leaf's ray is walked up-sun, cell by cell, from its own position, and in each cell it takes the area whose height lies **in the slab the ray climbs through there**, not everything above, which would count leaves nowhere near the ray. Area is spread evenly through its band, so a leaf's own cluster shades it by half, and the leaf's own area is taken back out, so a lone leaf, and the topmost, has exposure exactly 1.

> `e_j = exp(−kx·Σ slab area / (cell²·sin el))·groundShade(x, y)`

**Law.** This is Beer–Lambert extinction per unit leaf-area index, `I = I₀·exp(−kx·LAI/sin el)`, with `1/sin el` the longer slant path through each cell. Shading between trees falls out of the same grid: another tree's leaves in the ray's path are simply leaves in the cells it crosses.

**`kx = 0.5`** (**Authored**, a textbook value). The projection function of a canopy whose leaves face every way at random (a spherical leaf-angle distribution): the textbook value for broadleaf stands, whose measured effective extinction runs 0.5 to 0.8.

The grid draws no random numbers: computing exposure cannot reshuffle a grove.

### The representative sun

**Approximation.** The ray is a fixed **45° elevation from the south** (in the engine's convention solar noon is azimuth 180°, east 90°, west 270°). Pigment integrates over weeks of sun. The look's own sun, a time of day, an authored angle, one that moves under a transition, is not a property of the canopy, and a look must not repaint its leaves because its sun moved. A stand at another latitude or on a slope would want another ray; it is one constant.

### `groundShade`

**Not built.** A named seam that returns 1: where the valley's terrain (a hill's shadow, a slope turned from the sun, the building across the way) will multiply its own sun-visibility into exposure, before the rank. Nothing else calls it.

### Rank, and how exposure acts

Let `u_j` be the leaf's **percentile in its grove's order of exposure**, 0 buried, 1 most exposed. Exposure acts on timing and on capacity:

> `φ′_j = mix(φ_j, 1 − u_j, turn_exposure)`    `a′_j = a_j·mix(1, 0.5 + u_j, turn_exposure)`

At full strength the most exposed leaf starts at `turn_start`, the earliest a leaf can, and the most buried with the last, at `turn_start + turn_spread`; the buried leaf makes half the red and the most exposed one and a half times, the same ±50 % as the leaf's own spread. Both maps are linear and monotone in `u`, and `φ′` stays in [0,1) like the clock it blends with. Between 0 and 1 the mix of two independent uniforms keeps the mean start but narrows its spread: the leaves turn a little more together than the clock alone would have them.

**Authored: why the rank and not the raw light.** Raw exposure is a property of how dense a look is: a crowded grove's mean is around 0.3, an open one's around 0.7. Mapping it directly would repaint a look whenever its density moved. The rank is uniform on (0,1) whatever the density, exactly like the leaf's own clock, so **the look's turn schedule and its mean red are untouched by construction**: `u` averages exactly ½, the gain `0.5 + u` averages exactly 1, and exposure moves red from the shade to the sun without minting any. (The per-tree knobs are the deliberate exception: an early tree moves the mean start earlier.)

### Equal light, and the tie-break

A leaf whose one representative ray crosses no leaf area has an exposure of exactly 1: not a rounding snap but a true zero-area ray. These are the **up-sun shell and the top of the stand**, every leaf whose 45° ray clears it, over almost the crown's full height, a few percent of a floor look's leaves. It is the only exact tie in any grove.

**Law.** Within a run of equal exposure, **the leaf's own turn clock breaks the tie**: the leaf with the smaller φ_j, the one that would have started first on its own, takes the higher rank. That is the process, not a coin. Abscission follows senescence, so inside a tie the leaf that began to turn first lets go first, which is the per-leaf rule wherever light is silent. Three things hold: an untied leaf keeps its rank exactly; the ranks stay a permutation of `(i + ½)/n`, so `u` still averages ½; and leaves equal in the clock as well keep the middle rank of their slots (none occurs on the shipped looks).

A shared middle rank for the whole group made the shell turn and fall as one surface, a wave where the season should trickle; the other tie-breaks tried are in [`../evidence/dead-ends.md#season`](../evidence/dead-ends.md#season).

Consequences, named: whatever later shapes the turn clock shapes the order inside a tie; and the tie-break lives in the rank, so it does not reach where the rank is not used (below).

### Ranked and absolute, as a blend

The rank buys the look's schedule and mean red by throwing away how much light there is: a grove wholly in deep shade is ranked exactly like one in full sun, so it still has an early, red half. José's observation was absolute, *"trees and buildings cast shadow onto each other which determine which gets red first"*, and asked to choose he answered *"Both, as a blend"*. So `exposure_absolute`, 0 to 1, default **0**, mixes the two before either map sees them:

> `u_j = mix(u_rank, e_j, exposure_absolute)`

Two questions, two knobs: `turn_exposure` says how far the order matters at all; `exposure_absolute` says what the order is made of, the grove's own ranking of its light or the light itself. At 0 the rank is handed through untouched; at 1 it is the raw exposure; between, every leaf moves monotonically toward its own light. The tie-break lives in the rank, so between 0 and 1 a share `1 − exposure_absolute` of its spreading of the up-sun shell survives, and at 1 none does.

**Authored, physical at 1.** At 1 the maps carry the grove's own light: a crowded grove turns later and, with a mean gain near `0.5 + mean e`, **less red overall**; an open one turns earlier and redder; a grove with a dense crown up-sun of it turns later and paler than the same grove without. That is the intended absolute physics, and it is exactly the repainting-by-density the rank avoids, which is why it is a knob and not the default. The shipped looks' mean exposures and the planted-crown comparison are in [`../evidence/measurements.md#season`](../evidence/measurements.md#season).

### The exposure gates

At `turn_exposure` 0 the turn is the per-leaf clock alone, at any phenology; armed in summer it is inert, since no leaf has begun. The exposure pass runs whenever its order is consumed (`ordered`): a lit turn, or a drop ordered by light on its own clock. `exposure_absolute` moves nothing when neither is open. Both knobs are leaf colour and re-season the grove.

The exposure rank has a second consumer, leaf variety: the summer rank of the same light chooses each leaf's sun or shade form ([`leaf.md`](leaf.md)). Variety reads the rank of the leaves' areas before any shape shift, so it moves no leaf's colour, day or order of fall.

## One tree ahead of its neighbours

José (2026-10-08): *"something that matters a lot to me is the colour of the trees, how some trees are red while the one next to it is yellow or green, why that happens, how they're organized in nature and how is information scattered or grouped."* His photographs give the hierarchy: the **species** sets the palette and the clock; within a species the **individual** shifts it by days to two weeks (σ 0.03 to 0.06 of the season, with a long tail of stressed trees) and its red depth runs about 2:1 between neighbours; within a crown it is the **exposure**. One photograph shows a fully orange sugar maple among green-yellow neighbours of its own kind, which a clock with no tree term cannot draw.

Two knobs are the individual's share. His decisions (2026-10-09): the tree clock is **skewed**, most trees on the look's schedule and a few running early; a tree's lead shifts its start, its finish and its drop together; light still ranks grove-wide; trees are independent for now; the pigment spread scales red and brown alike.

### The draws

**Law (identity).** Each tree draws its numbers as a pure function of (seed, tree index) on a salt of its own: the lead, the depth, then its leaf genotype ([`leaf.md`](leaf.md)). Never the growth or leaf streams, so the skeleton is untouched at any knob value and a tree keeps its numbers at any tree count, the marginal tree's included. With a knob at 0 nothing is drawn.

### The lead

**Authored.** `Δ_t = −S·v³ ≤ 0`, where `S = tree_clock_spread` (0 to 0.15 seasons, default 0) and `v` the lead's draw. The cube is the skew: mean S/4, median S/8, standard deviation 0.283·S, and one tree in five (`1 − 2^(−1/3)`) runs beyond S/2. **S is the reach**, as `turn_spread` is the last leaf's: no tree attains it.

Δ shifts the tree's **clocks**, not the season: the turn starts from `turn_start + Δ_t`, the drop clock from `drop_start + Δ_t` (or, after the turn, from the shifted turn), so the start, the finish and both days move together and a leaf is never half-way between its tree's schedule and the look's. The season itself stays global, so a leaf that fell earlier lies older.

**Light still ranks grove-wide.** The rank's tie key stays the leaf's own clock, so the rank does not depend on the tree knobs, which is what lets them be season keys with the lead added after the rank. Inside an exact tie an early tree's leaf and a late tree's leaf are ranked by their own clocks, and their days differ by the leads on top. Named, not fixed.

### The depth

**Authored.** `c_t = 1 + s·(2w − 1)`, where `s = tree_pigment_spread` (0 to 1, default 0) and `w` the depth's draw: c in [1 − s, 1 + s), mean 1 **in expectation, not by construction**. A tree keeps its draw as the grove grows, so a tree-count morph is an identity on the trees already there; a mean held over the realised trees would repaint every tree each time one is added. At s = 1 a tree may go without red. It scales `a_j` and `b_j` together, after the light's gain, because the red and the brown are one tree's metabolism, and the walls brown with it.

Threshold coins, other powers of v, a centred lead, a mean held by construction and ranking within each tree were all rejected; the reasons are in [`../evidence/dead-ends.md#season`](../evidence/dead-ends.md#season). How these knobs play out on the shipped seed's trees is in [`../evidence/measurements.md#season`](../evidence/measurements.md#season).

### The gates open by the reach

`senescing` opens at `phenology > turn_start − S`; `dropping` opens at `turn_start − S + L + drop_lag − ε` after the turn, or `drop_start − S − ε` on the drop's own clock. One definition, read by the grove, the feature registry and the editor alike. An early open is free (every `s` is 0 and every retained weight is exactly 1); a late one would skip a leaf, so the gates open a hair early on purpose.

**The summer gate, restated: every leaf at a phenology ≤ `turn_start − tree_clock_spread` keeps its authored optical depth literally.** At a reach of 0.1 or less every shipped summer (0.5) is untouched; at 0.15 a tree drawn far enough ahead reaches into it, which is physical.

## Abscission: leaves let go on their own day

José's observation: one all-yellow tree had half its leaves on the ground by the end of ten days, and the sunlit ones went first; and some trees never finish: a beech keeps about half its leaves, brown, on the tree through the season (marcescence). So letting go is a per-leaf day, ordered by the same light, with a floor that never falls. The gate is `leaf_drop`, 0 to 1, default **0**: the share of leaves that let go within the season.

Two laws for the day exist. On the drop's **own clock** (the default) the day is a second clock beside the turn. **After the turn** (`drop_after_turn` 1) the day is the end of the leaf's own turn plus a lag, so the colour and the drop read one order. The second is the truer one; the first is kept because it is the previous law.

### The day, on its own clock

Each leaf (j, k) has a drop phase:

> `φ_d = mix(hash_d, 1 − u, drop_exposure)`    `D = drop_start + drop_span·φ_d/leaf_drop` for `φ_d < leaf_drop`, never otherwise

`hash_d` is the leaf's own draw on its own salt (never the growth, arrangement or pigment streams); `u` is its exposure order exactly as the turn uses it, rank or blend. Abscission **consumes** `u`; it does not recompute it. `drop_start` defaults to **0.7**, `drop_span` to **0.3**, `drop_exposure` to **1**.

So `leaf_drop` is the share down by `drop_start + drop_span`. At `drop_exposure` 1 the most exposed leaf goes at `drop_start` and the most buried last, and the **retention floor** `1 − leaf_drop` is the shaded tail of that order, which is exactly the tissue that is marcescent. Between `drop_exposure` 0 and 1 the mix of two independent uniforms narrows around ½, so the share down by the end is only approximately `leaf_drop` (exact at 0, ½ and 1): fewer than `leaf_drop` have gone when it is below ½, and more when it is above. With the tie-break, at `drop_exposure` 1 and `leaf_drop` 1 the days are exactly `drop_start + drop_span·(i + ½)/n`: one leaf every `drop_span/n`.

### Fading, never popping

**Law (calm).** A leaf's retained weight is

> `w = 1 − smoothstep(D − ε, D, phenology)`, ε = **0.01** in phenology units (**Authored**)

and the grove multiplies the leaf's coverage by it: the one factor the leaf's optical depth and its coverage both carry ([`canopy.md`](canopy.md)'s marginal fade), so the leaf thins in the cast **and** its shadow thins with it, on the layer path and the faithful path alike, from one weight, so the two cannot disagree. Until a leaf's fade begins `w` is 1 with no arithmetic, and below `drop_start − ε` nothing is touched at all. The fade window is the continuity contract's ([`../contracts/continuity.md`](../contracts/continuity.md)).

### Compaction

A leaf with `w = 0` is not a faint leaf; it is no leaf. It leaves both the layer bake and the faithful cast together, so a bare canopy is not a bake of empty quads, and the faithful cast's frame is fitted to what is left (leaves and wood). **A bare faithful canopy bakes its wood, not nothing:** with every leaf gone the cast still runs, and the floor is lit where nothing shades it ([`../evidence/dead-ends.md#season`](../evidence/dead-ends.md#season)).

### The exposure is the whole summer set

**Law.** The exposure grid keeps every leaf, whatever has dropped: exposure is a **season integral**, not a function of who is still hanging. A leaf's day does not move with the phenology the grove is read at, nor with the leaves that went before it.

### After the turn

**The cause.** In life, abscission follows senescence: a leaf lets go after it has turned, with a lag, and the sunlit ones first because they finished first. On the drop's own clock a leaf can let go a third of the way to yellow, and at mid-fall the tree feels disconnected from its carpet, a lemon carpet under a dark crown.

Every leaf's turn ends at the common finish, so "the turn's end plus a lag" would be one day for all. Each leaf needs a window of its own.

**The window and the day** (`drop_after_turn` 1). With `L = turn_span − turn_spread` (at least 0.05 of the span; 0.12 at the defaults), a leaf with turn phase φ′ starts where it always did, `T0 = turn_start + φ′·turn_spread`, so every summer is unchanged, and turns over its own window:

> `s_j = smoothstep(T0, T0 + L, phenology)`    `D = T0 + L + ε + drop_lag` for `φ′ < leaf_drop`, never otherwise

The last leaf still ends at `turn_start + turn_span`. The `+ ε` is the point: the fade begins at `D − ε`, so a leaf is fully turned where its fade **begins**, not only where it ends; at `drop_lag` 0 a leaf fades the instant it has turned. φ′ is the turn's own phase (the leaf's clock, mixed toward its light by `turn_exposure`), and the colour and the day read that one phase, so they cannot drift. There is **no drop hash** in this law: `T0` is already a strict progression, and a hash would be a third clock. `leaf_drop` is still the share; marcescent leaves are the last to turn. `drop_start`, `drop_span` and `drop_exposure` are not read, and the drop no longer opens the exposure pass on its own (a lit turn still does).

**The default lag, 0.09.** José's pick from the sheet (2026-11-09, `test-gl/out/review/2026-11-09-pending/item28-drop-lag.png`): with the ε a total of 0.10, a little past half the leaves still hanging at 0.9 (a total of 0.09 is exactly his beech's half). It was 0.05 (a total of 0.06), which kept the same two thirds down at 0.9 as on the drop's own clock, the same leaves, since both order by φ′; the fall looks' carpets moved with the change. `park fall` keeps 0.05, `forest floor` and `montebello, rain` 0. Every leaf in the litter is fully turned at the start of its fade. The share-down and crown tables are in [`../evidence/measurements.md#season`](../evidence/measurements.md#season).

**The trade, plainly.** This is a turn change inside a drop knob: each leaf's window is `L` long from its own start instead of running to the common finish, so mid-turn the crown reads further along than on the drop's own clock at the same phenology. From `turn_start + turn_span` on the colour is identical. The litter is younger, its days spanning a shorter stretch, so a fallen leaf is less brown at the same age.

`drop_after_turn` is 0 or 1, default **0**, and it **flips, never morphs**: a flip moves every leaf's day and the mid-turn colour at once, so a transition crosses it as a structural change. `drop_lag` is a season key, read only at 1.

**Open:** the shell's shared day at `exposure_absolute` 1 ([equal light](#equal-light-and-the-tie-break)).

### Provisional species values

**Provisional.** Maple 1, red oak 0.8, beech 0.5: what `leaf_drop` would be, were species to carry colour. They are not in the species shape bundles, which are shape only by contract ([`canopy.md`](canopy.md)); a species colour table is where they and the pigment family would live.

### The abscission gate

`leaf_drop` at 0, or a phenology before the first day's fade, is the gate: no retained weights, no compaction, no litter, and the grove is the previous law. Leaf fall is leaf colour's neighbour: it morphs the same grove under a transition, the leaves fading out through it rather than popping.

## Re-seasoning: the season is a function of the grove

Nothing in the fall arithmetic needs the skeleton regrown. A change in the **season set** (the summer tint `trans_rgb`, `phenology`, the turn's start, span and spread, the three pigment capacities and `wall_fraction`, `turn_exposure`, `exposure_absolute`, the two per-tree spreads, `leaf_drop`, the drop's start, span and exposure, and `drop_lag`) moves only each leaf's optical depth, its retained weight, which leaves are compacted out, and the litter list. The skeleton, every leaf's place, size, orientation, height and address, the exposure field and its rank, and the trees the per-tree draws are made for, are **the grove's**.

**Law.** So a grove can keep a record of its leaves beside its uncompacted bake, and re-run the season over it in one pass, writing into the buffers it already owns, with the springs, the cluster data and the outlines untouched. **Re-seasoning gives exactly the grove a fresh build gives at the same parameters**: every bake, the faithful cast, the litter and the cast frame. So a season tween's landing is the resting state, and nothing regrows on release. The summer depth `−ln(trans_rgb)` is recomputed from the current tint on every re-season, so a summer tint change also takes the cheap path.

Any change outside the season set invalidates the record, and the next season change is one full build, which keeps a new one. The costs are in [`../evidence/measurements.md#season`](../evidence/measurements.md#season).

### Density reweighting: a cached prefix, not a season key

Each clump resets its arrangement and wind streams, and a leaf consumes the same draws at any count, so with the structure fixed, changing `foliage_density` changes only **which prefix of each clump's leaves is active**, and the marginal leaf's coverage. A density morph builds once at the larger endpoint density, keeps the uncompacted record, and re-seasons the active prefix into the existing buffers, keeping the marginal-leaf rule exactly (the cutoff below which a leaf is absent, and the marginal leaf times the marginal tree).

**The gate is deliberately summer-only:** no leaf senescing, no leaf drop, no leaf variety, and both ends identical in structure apart from density. Exposure, variety and abscission are functions of the population, so opening any of them rebuilds. Tree count still regrows: it re-spaces trunks and may rescale crowns, which no coverage weight can say.

How these paths are chosen during a transition, and which morphs take them, is [`transitions.md`](transitions.md).

## A season played live

The season axis is played by one macro, spring to summer to fall, probing `phenology`; its stops are lifted from shipped looks, and the pigment and drop capacities are **constant at every stop**, inert below `turn_start`, so the spring and summer stops are their looks and only the clock moves the colour and the drop. The fall half moves only the season set, so it re-seasons rather than regrows.

**Approximation.** The stops' structure (density, limb length and pitch, the summer leaf hue) is the floor family's, so a drag on a park look takes the afternoons' structure on; `montebello`'s own is `park 1`'s. The stops, the tween and the editor's cost gate are in [`../implementation.md`](../implementation.md#the-editor-and-the-player).

**Law (calm).** A leaf fades over ε of phenology, so one applied step may be no wider than **half of it**, or it pops the leaves whose fade it jumps, salt and pepper through the crown. Each applied step of the season is clamped to that; while the clamp binds the season moves slower than the hand and lags it, and the landing still arrives at the stop's exact values. The carpet re-bakes with each step. The contract is [`../contracts/continuity.md`](../contracts/continuity.md).

## The litter: the floor is a map

José: *"one day after rain many leaves fell on the ground"*; and of the beech, by the end of ten days, *"half of its leaves were on the ground"*. A leaf that has let go lies on the receiver, and everything about it changes.

It is at height 0, so it **casts nothing**. And it is **seen by reflection, not transmission.** A backlit red leaf glows red; the same leaf lying on the ground, lit from above, reads tan-brown and desaturated. What a leaf passes is `e^(−τ)`; what it throws back is another, flatter spectrum. So the carpet is not the canopy's cast laid on the ground but an **albedo the floor reads**. The last to fall lie on top, and the carpet ages red to copper to brown. The gate is `litter`, 0 or 1, default **0**, separate from `leaf_drop` so the canopy half can be judged alone.

### The fallen

**Law.** A leaf is in the litter when it is compacted out, at `phenology ≥ D`; one still fading is on the tree at its weight, not yet listed. Each fallen leaf carries its place and the height it fell from, its day `D`, its optical depth, its own size (the face-on ellipse, or its outline), its address, its marginal fade (or a density morph would pop its litter in at full weight), and its outline row, so a fallen leaf keeps its shape.

**A fallen leaf does not freeze its colour at its day.** Its optical depth is the leaf's colour **now**, at the grove's phenology: the turn does go on after a leaf has fallen. What the leaf's own pigments can no longer say is said by the mix toward brown with age, which is the whole of what "it has been lying there a while" means.

### A function of phenology and seed, never of the run

**Authored (calm).** Litter does not accumulate at runtime, José's decision, and does not move: no skitter in a gust, no drift in a breeze. The same look is the same carpet whenever it is drawn. So it is made once per grove and re-made exactly when a number it is a function of moves: the grove, the authored wind direction, `litter_age`, `litter_drift_m`, the wetness, the phenology, the seed, its size or its frame. **Never** the live wind, the sun or the fill.

### Where a leaf lands

> `(x, y) + h·litter_drift_m·(cos, sin)(wind_direction_deg) + σ·gauss`    `σ = 0.3·h·litter_drift_m`

`h` the grown height it fell from; `litter_drift_m` defaults to **0.4** metres per metre of height. **The wind is the season's**: the authored direction alone, never the strength, the gusts or the weather's veer, which are functions of the clock ([`motion.md`](motion.md)). The scatter, and the leaf's angle on the ground (a leaf on the floor has no twig to hold it), come from the leaf's address on a stream of its own, independent of the pigment, drop, arrangement and wind streams.

### What colour it lies in: the reflectance law

A leaf reflects because it scatters: the strongly absorbed channel comes back from the shallowest scatterings, so a real reflectance saturates far less than a transmittance does. The carpet is several leaves deep where it shows, so the honest object is the **opaque pile, Kubelka–Munk `R∞`**, whose one unknown is `κ`, the pigments' absorption per unit optical depth relative to the tissue's scattering.

Laying the leaf's transmittance hue on the floor was the first law, and it was wrong: maximally saturated, an orange-yellow stain ([`../evidence/dead-ends.md#season`](../evidence/dead-ends.md#season)).

Per channel, with `age = (phenology − D)/litter_age`, `s = smoothstep(0, 1, age)` and `w = clamp(leaf_wetness, 0, 1)`:

> `κ = 2` (**Provisional**)    `F = 0.04`, the cuticle's surface share, dry
> `ρ_brown = (0.12, 0.08, 0.05)` linear    `τ_brown = K⁻¹((ρ_brown − F)/(1 − F))/κ`
> `S_w = 1 − w·(1 − ρ_wet)`    `F_w = F·(1 − w)`
> `q = κ·((1 − s)·τ + s·τ_brown)/S_w`    `R = F_w + (1 − F_w)·K(q)`

with the Kubelka–Munk pair `K⁻¹(R) = (1 − R)²/(2R)` and its inverse `K(X) = 1 + X − √(X² + 2X)`, evaluated in a form stable as R approaches 0. `litter_age` is **0.15** phenology units, **Provisional**.

**Browning is mixed inside the pigments**, in absorption, not in reflectance: a reflectance mix would have to be inverted again for wetness; adding optical depths could never raise a red leaf's green toward brown's; the absorption mix is linear in the pigments, monotone per channel toward brown, and exact at age 1 (a fully aged dry leaf is `ρ_brown` exactly). A half-aged leaf is therefore not the reflectance midpoint. At `κ = 2` a clear leaf (`τ = 0`) is a white scatterer, `R` falls strictly with each channel's depth, and the carpet is far less saturated than the stain was.

All of it is one pure function of (optical depth, age, wetness), so a later browning process can replace it behind the same inputs.

### The grey card

**Provisional.** Photographing the same leaves backlit, then dry and wet beside a grey card, would fit `κ`, `F` and the effective scale of wetness. Until then `κ = 2` is José's judgement from review sheets (2026-10-08, [`../evidence/observations.md`](../evidence/observations.md)).

### Wetness: the rain day

A dead leaf on the ground soaks: water fills the air spaces of its tissue, and the refractive-index contrast at every cell-wall interface falls from `n_wall − 1` to `n_wall − n_water` (`n_wall = 1.47`, `n_water = 1.333`). Scattering goes as Δn².

**Law. Scattering is cut by the index law:**

> `ρ_wet = ((n_wall − n_water)/(n_wall − 1))² ≈ 0.085`

the share of its scattering a fully soaked leaf keeps, while absorption is the pigments' and does not move, so `q` rises. Less scattering lets light travel deeper before it returns, so more is absorbed: the leaf **darkens and saturates in one move**, the strongly absorbed channel dropping most. **The surface share is cut by the film**, `F_w = F·(1 − w)`: the water film turns the cuticle's diffuse frost into a mirror lobe that a matte floor never shows.

Rain acts on **dead tissue only**: a turned red leaf on the tree is alive and keeps its frost, so the carpet is the only reader of wetness. `leaf_wetness` defaults to **0**, where the law is the dry law exactly; a rain day is about 0.5. It is a material knob: changing it re-makes only the carpet, never the grove, so a live writer (rain, later) may drive it.

### The layering and the stamp

The fallen are laid in order of their day, earliest first, ties by address, so the order is a property of the leaves and not of how they were listed: **the last to fall lie on top**. Each leaf is one flat stamp in its own outline, the leaf's own size face-on (lying flat it is not foreshortened), at its own angle on the ground, with a crisp anti-aliased rim (not the soft penumbra mask the canopy's leaves are baked with: that mask is how a leaf throws a shadow, not what it looks like), and its marginal fade multiplying its coverage.

The carpet stores **coverage-weighted colour and coverage**, composited over: coverage accumulates as `1 − Π(1 − a)`, and because a texel is a mixture, filtering averages coverage-weighted colour rather than darkening every edge toward bare ground, so the far floor of a tilted camera reads a filtered carpet, not a shimmer.

### The frame

The carpet covers the sky fill's own frame ([`fill.md`](fill.md)), computed whether or not the fill is open. **The endless park repeats it**, like its fill: the frame is one period of an endless field, so a landing is folded into it and a stamp that crosses an edge is drawn again on the far side. **A finite tree clamps it** on the padded frame, empty at its edge, and a stamp wholly off it is dropped. The carpet's resolution (`litter_resolution`) is spent over that frame, so a wide frame wants a finer carpet for a 10 cm leaf to read as a leaf.

### The floor's material

**Law.** The carpet is the outer layer of the floor's albedo:

> `ground = ground·(1 − a) + rgb` (coverage-weighted, so this is `mix(ground, leaf colour, a)`, `ground` the floor albedo `ground_r`, `ground_g`, `ground_b`)    `col = (acc·sun + amb)·ground`

with `amb` exactly the fill's term, one expression for both, so the bare floor and the carpet cannot drift. The carpet is lit by what lights the ground beside it: the beam's suns in whatever colour the canopy let through, and the skylight and scattered light of the fill. How the fill reads it is [`fill.md`](fill.md); the floor itself is [`receivers.md`](receivers.md).

**Only the floor reads it.** The curtain and the tent transmit through fabric and have no ground; the sky view has no surface. None of them knows the carpet exists. The faithful floor shares the material, so a standing tree has its carpet too.

### The litter gate

`litter` 0 is the floor's previous law, with nothing allocated and nothing made. With the gate open and nothing yet fallen (a summer look, or `leaf_drop` 0) the floor is the previous floor too. `litter` and its resolution are structural: neither interpolates, so a transition across them crosses as a structural change rather than popping a carpet in. `litter_age` and `litter_drift_m` change only what the grove's carpet is made of. Transitions that carry leaves between the carpet and the canopy are [`transitions.md`](transitions.md).

## Approximations and limits

- **One representative sun** (Approximation). Exposure is to a fixed 45° ray from the south, the turn's and the drop's alike; a season's sun over many directions would shade the up-sun face and re-rank every leaf. Absent: `turn_exposure` 0 and no light-ordered drop.
- **A coarse grid, one ray** (Approximation). Exposure is binned on a plan grid of about 48 cells and 24 height bands; the cell stands in for the clump, leaf orientation is ignored (a leaf is its flat area, `kx` fixed at the spherical value), and clumping within a cell is not modelled.
- **Rank amplifies** (Authored). In a wholly open canopy the rank still orders the leaves over their whole span, magnifying differences a stand that sunny would barely have, and it discards absolute light; `exposure_absolute` gives it back as far as it is turned up.
- **The floor reads exposure faintly** (Approximation) in a dense look, where the shade is the product of many leaves at every height; the sky view, a lone tree or a sparse park show it plainly.
- **Pigment basis vectors** (Provisional), held by ordering until backlit measurements.
- **The per-leaf clock** (Approximation). A smoothstep on a hashed start and a hashed capacity stands in for each leaf's physiology; capacity is grove-wide, varied per leaf and optionally per tree, with no species palette.
- **No vein geometry** (Approximation). The sieve is a mean; overlapping leaves multiply independent means.
- **Trees are independent** (Approximation). Real neighbours correlate by site (soil, water, the cold pocket) and by species and clone; five trees seldom show a real tail of stressed ones.
- **The tie-break does not reach the raw light** (Open): at `exposure_absolute` 1 the unshaded shell shares `u = 1` and turns and falls together.
- **Leaves vanish where they hang** (Approximation). There is no fall through the air, no gust that shakes a tree bare, no rain that brings many down at once; a leaf fades over ε on the tree and appears in the carpet where the season's wind would have carried it.
- **The marcescent share is grove-wide** (Approximation), not per tree or species; a tree's lead moves its days, never its share.
- **The carpet does not move** (Authored): no skitter, no pile-up over the days. It is the season's carpet, not a simulation of one.
- **Kubelka–Munk's opaque pile** (Approximation; κ Provisional). A thin carpet over dirt is not opaque, and a wet single leaf also transmits more: on dark dirt it reads darker still, on bright dirt lighter; not modelled.
- **Effective wetness** (Approximation). The film's other optics (light trapped by total internal reflection at its surface, after Lekner and Dorf) are the same size as the index law at half wetness and flatter in hue; one grey card cannot separate them, so `w` absorbs them. Full soaking at 1 overstates a fresh leaf.
- **The dirt stays dry** (Approximation). The floor albedo (`ground_r`, `ground_g`, `ground_b`) is authored, and wet leaves on dry dirt raise leaf-to-soil contrast, the opposite of a real rain day; a rain look lowers the dirt by hand.
- **No gloss** (Not built). The floor is matte, which is why the film's mirror lobe is dropped rather than kept.
- **No ground bounce** (Not built). A red carpet should tint the shade above it; there is no term for a bounce.
- **One flat stamp** (Approximation) per fallen leaf: no curl, no relief, no thickness where leaves pile, one reflectance across its face. Leaves are lit by the beam and the fill but not shaded by each other.
- **One age for every leaf** (Approximation): `litter_age` is a single number, and a fallen leaf's colour is its colour now, not at its day.
- **A leaf smaller than a carpet texel** (Approximation) is drawn at a minimum size with its coverage reduced to keep its area, which over-counts so small a leaf slightly ([`../evidence/measurements.md#season`](../evidence/measurements.md#season)).
- **The endless park's carpet repeats** (Approximation) at the frame's period, so a view wider than the frame tiles it; a finite tree's drift leaves the frame only for a very windy look.

## Not built

- The **spring half** of the season: below the turn it is summer ([`../exploration/open.md`](../exploration/open.md)).
- A **patchy turn**, which would reshape the turn clock and so the order inside a tie ([`../exploration/open.md`](../exploration/open.md)).
- A **species** clock and palette, and clonal patches that turn together (the mixed grove), where the provisional drop shares would live ([`../exploration/open.md`](../exploration/open.md)).
- The **valley's terrain** into `groundShade`, and a **site field** correlating neighbours ([`../exploration/open.md`](../exploration/open.md)).
- A **season's sun over many directions** for exposure ([`../exploration/open.md`](../exploration/open.md)).
- A **browning process** replacing the age mix, with a per-leaf dead fraction that rain could also act on in the crown ([`../exploration/open.md`](../exploration/open.md)).
- **Rain** as a live writer of wetness and of the dirt, and a wet leaf's gloss ([`../exploration/open.md`](../exploration/open.md)).
- **Falling leaves** in the air, gusts that shake a tree bare, a carpet that accumulates or moves ([`../exploration/open.md`](../exploration/open.md)).
- A **ground bounce** from the carpet into the shade above ([`../exploration/open.md`](../exploration/open.md)).

## Related

- [`leaf.md`](leaf.md): the sieve mixture `τ_cell` and `τ_wall` feed, the diffuse split, leaf variety (the rank's second consumer), the held leaf.
- [`canopy.md`](canopy.md): the grove the season acts on, the marginal fade, the bake into depth layers, the species shape bundles.
- [`light.md`](light.md): fall's inversion of the dusk law.
- [`fill.md`](fill.md): the shade's skylight through turned leaves, the frame the carpet shares, how the fill lights the carpet.
- [`receivers.md`](receivers.md): the floor whose material the carpet becomes.
- [`motion.md`](motion.md): the authored wind direction that carries the falling leaves.
- [`transitions.md`](transitions.md): re-season and density morphs in a transition, and the routes that carry leaves between carpet and canopy.
- [`../contracts/continuity.md`](../contracts/continuity.md): fade windows and the step clamp.
- [`../contracts/determinism.md`](../contracts/determinism.md): identity by address and the salts.
- [`../contracts/preservation.md`](../contracts/preservation.md): what the gates' off states owe.
- [`../contracts/looks.md`](../contracts/looks.md): the fall looks and their intent.
- [`../evidence/measurements.md#season`](../evidence/measurements.md#season), [`../evidence/dead-ends.md#season`](../evidence/dead-ends.md#season), [`../evidence/observations.md`](../evidence/observations.md).
