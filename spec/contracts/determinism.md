# Determinism

*What must hold so that everything the eye sees moving is the canopy, and two engines given the same look draw the same picture.*

The glisten is the most fragile thing in the piece: a fine twinkle in place, under the faintest breeze. It can only be trusted if nothing else twinkles. These contracts make the math silent, so that every change in the light has a cause in the world, and so that a leaf, a tree and a fallen leaf are each themselves, whatever else is done to the grove around them. They are the concrete form of [principle 7](../principles.md#7-nothing-visible-comes-from-the-math).

1. **All visible motion comes from the canopy.** Applies to every camera, every receiver and every frame. Nothing in the source, the transport, the fill or the Look varies with time except through a quantity that belongs to the world: the wind moving leaves and wood, the cloud and sun of the look, a transition's own clock. Why: numerical shimmer that impersonates the glisten would make the one motion the piece is about untrustworthy. Owner: [`model/motion.md`](../model/motion.md).

2. **The source samples are frame-stable.** Applies to the sampler of point-suns for every look and every cloud state. The samples are a deterministic Vogel spiral; they move only when the source itself moves (the cloud widens, the eclipse advances), never from frame to frame. Why: a sampler that jitters turns blur into flicker, and the source is the blur. Owner: [`model/source.md`](../model/source.md).

3. **The fill's directions are fixed.** Applies to the sky fill's hemisphere quadrature. Its rays are a fixed cosine-weighted set, and the per-texel rotation that interleaves them over a tile is a pure function of the texel's place in that tile, never of time. Why: the shade must be the same shade from one frame to the next, so that a change in it is a change in the canopy. Owner: [`model/fill.md`](../model/fill.md).

4. **There is no sampling randomness anywhere.** Applies to the whole engine: the bake, the transport, the fill, the receivers, the sky view, the wind. Every number that varies between leaves, trees or rays is a deterministic function of the seed and an address; every number that varies in time is a deterministic function of the clock. Where a stochastic process would be the natural model (a mean-reverting random walk for the weather), its deterministic counterpart is used instead. Why: randomness drawn at runtime cannot be reproduced, and what cannot be reproduced cannot be judged. Owner: [`model/motion.md`](../model/motion.md) for the time-varying half, [`model/canopy.md`](../model/canopy.md) for the spatial half.

5. **Two engines born alike render the same frame.** Applies to any two engines created independently with the same look, under frozen motion. Their frames are equal to the byte, and equality, not a tolerance, is what the harness asserts. Why: this is the no-randomness rule measured rather than promised, and it is what lets every other contract be checked by comparison. Owner: [`implementation.md`](../implementation.md) for the harness; the rule itself is this file's.

6. **Every per-leaf, per-tree and per-litter draw is a pure function of (seed, address) on a salt of its own.** Applies to every draw made after the grove's structure is grown. No such draw ever takes a number from the growth stream, the arrangement stream or the wind stream. Each stream is seeded by the look's seed mixed with its own salt and keyed by the address of the thing it describes, so it can be added, removed or consulted without moving anything else. Why: one number drawn from the growth stream would regrow every grove ever made, and a look saved a year ago would come back as a different place. Owner: the model file named for each stream below.

   The streams and what each governs:

   | stream | keyed by | governs | owner |
   |---|---|---|---|
   | growth | seed, then the grammar's own order | the skeleton: trunks, limbs, twigs, their heights and angles | [`canopy.md`](../model/canopy.md) |
   | arrangement | seed, clump | where each leaf sits in its clump, its size, tilt, angle, orbit and phase | [`canopy.md`](../model/canopy.md) |
   | wind identity | seed, clump | each clump's and leaf's own share of the incoherent band | [`motion.md`](../model/motion.md) |
   | pigment clock | seed, cluster, leaf | the leaf's own turn phase and its red and brown capacity | [`season.md`](../model/season.md) |
   | drop day | seed, cluster, leaf | the leaf's own share of the drop order where light does not decide it | [`season.md`](../model/season.md) |
   | inner leaves | seed, cluster, leaf | whether and where along the older wood the leaf hangs | [`canopy.md`](../model/canopy.md) |
   | tree draws | seed, tree | the tree's clock lead, its pigment depth, and then its leaf genotype | [`season.md`](../model/season.md), [`leaf.md`](../model/leaf.md) |
   | genotype spread | seed, genotype, light class | how a genotype's and a row's outlines depart from the species' | [`leaf.md`](../model/leaf.md) |
   | leaf variant and flip | seed, cluster, leaf | which outline variant the leaf takes, and whether it hangs a half turn past the grove's angle | [`leaf.md`](../model/leaf.md) |
   | litter | seed, cluster, leaf | where a fallen leaf scatters about its landing, and its angle on the ground | [`season.md`](../model/season.md) |

   The outlines' own growth and the held leaf's areole maze each have a stream of their own besides; neither touches the grove. A stream reached only behind a gate is not reached at all when the gate is shut: at its zero, nothing is drawn and the grove is the one it was ([`preservation.md`](preservation.md)).

7. **Identity is kept by address, not by position in a list.** Applies to every per-leaf quantity: colour, turn, drop day, outline, inner placement, litter. A leaf is named by its cluster and its place in that cluster, never by a running index over the grove. Why: under a tree-count or density morph the list changes length, and a leaf that is turning red must stay that leaf rather than hand its colour to a neighbour. Owner: [`model/canopy.md`](../model/canopy.md).

8. **Trees are appended at the end of the growth stream.** Applies to `tree_count`, which is continuous. A fractional count grows its whole trees and one marginal tree faded in by the fraction; because new trees are drawn after the existing ones, a change in count adds or removes only the last tree, and every tree already standing keeps its structure. Each clump resets its own arrangement and wind streams, so a leaf consumes the same draws at any density, and a density change only lengthens or shortens a prefix. Why: this is what lets the grove grow a tree in, rather than replace itself, and what keeps an integer count drawing the grove it always drew. Owner: [`model/canopy.md`](../model/canopy.md).

9. **The litter is a function of (phenology, seed), never of the run.** Applies to the carpet of fallen leaves. It does not accumulate at runtime and does not move: where a leaf lands depends on the height it fell from, the look's authored wind direction and its own litter draw, and never on the live wind's strength, its gusts or the weather's veer, which are functions of the clock. The order in which the carpet is laid is a property of the leaves (by drop day, ties broken by address), not of the order the grove happened to list them. Why: the same look must be the same carpet whenever and however long it has been drawn. Owner: [`model/season.md`](../model/season.md).

10. **Weather and gusts are deterministic noise of time.** Applies to the broadband forcing and the slow weather state above it. Both are sums of smooth noise evaluated at the clock, so a given moment of a given look always has the same wind. Why: a wind that is reproducible is a wind that can be reviewed, recorded and returned to. Owner: [`model/motion.md`](../model/motion.md).

11. **Season is read from a fixed representative sun.** Applies to the exposure that orders the turn. The light that ranks the leaves is cast from one fixed direction for every look, not from the look's own sun. Why: pigment integrates over weeks, and a look must not repaint its leaves because its time of day moved or a transition carried its sun. Owner: [`model/season.md`](../model/season.md).

12. **The exposure rank is total, and ties are broken by the leaf's own clock.** Applies to the grove's order of light. Where two leaves receive exactly equal light (the up-sun shell, whose rays clear everything), the leaf whose own turn clock is earlier takes the higher rank. An untied leaf keeps its rank exactly, and the ranks remain an even permutation, so the mean is unchanged. Leaves equal in both light and clock keep their shared middle rank. Why: without a key, a whole shell would share one rank, one turn and one drop day and dim as a sheet; with the leaf's own clock the order inside the tie is the process itself, not a coin. Owner: [`model/season.md`](../model/season.md).

13. **The rank is a property of the grove, cached with it.** Applies to re-seasoning and the season keys. The exposure field and its rank are computed once over the whole summer set and are not recomputed as leaves fall or as the phenology is read at another moment, so a leaf's drop day does not move with the leaves that went before it. Why: a season integral that changed with who is still hanging would be a feedback with no counterpart in the tree. Owner: [`model/season.md`](../model/season.md).

14. **A video render is reproducible, and refuses when it cannot be.** Applies to the video exporter. A run resumes from its last checkpoint only if the engine, the look (for an arboretum preset, its version and parameters), the exporter, the operating system and the browser are all as they were; otherwise it refuses and names what moved rather than splice two renders into one file. How the work is divided between sessions never changes a frame and is not part of that identity. Why: a projector's five minutes is one continuous piece, and a resumed render that silently changed engine halfway is a seam no one asked for. Owner: [`implementation.md`](../implementation.md).

## Known tensions

- **Leaf variety's column depends on the whole grove.** With `leaf_variety` up, the outline a leaf grows is chosen by its light class, and the light class comes from its rank in the grove's exposure order. The rank is a function of every leaf, so a canopy morph (density, tree count, a macro) re-ranks the light, and a leaf's outline moves with its rank: the class is continuous and a leaf between two columns hangs a blend of their outlines, so its lobes change by degrees and its size never steps (the size shift is continuous in the rank too). This is accepted and named: it is the one per-leaf quantity that is not a function of (seed, address) alone. Its size is recorded in [`../evidence/measurements.md#leaf`](../evidence/measurements.md#leaf). The colour, the turn and the drop are untouched by it: variety computes light from the leaves' areas before its size shift, and the season reads the same arrays.
- **The tie-break lives in the rank, and only there.** Where the rank is not used (`exposure_absolute` at 1, which orders by the raw light), the up-sun shell is still one value and still turns and falls together. Between 0 and 1 part of the tie-break survives. A season's sun integrated over more than one direction would end the tie physically; that re-ranks every leaf and is [not built](../exploration/open.md).
- **Inside a tie, the order follows the leaf's clock, not its tree's.** With per-tree clocks on, two leaves of equal light on an early and a late tree are ranked by their own hashes, and their days then differ by the trees' leads on top. Named, not fixed.
- **Whatever later shapes the turn clock shapes the order inside a tie.** A patchy turn, when it is built, will reorder the shell, and must be weighed against calm ([`continuity.md`](continuity.md)).
- **The layer path quantises height.** A leaf moving continuously in height changes depth layer at a bin edge, and its shadow moves to another layer's throw. That is the depth discretisation's own cost, not a failure of identity; the faithful cast does not have it ([`../model/canopy.md`](../model/canopy.md)).
- **Byte equality is held on one implementation's arithmetic.** The contract is that a frame is a pure function of the look and the clock. Equality to the byte between two engines holds within one browser and GPU; across devices, the floating-point rules of shaders allow different last bits. The video exporter's run key exists because of exactly this.

## Related

- [`../principles.md`](../principles.md): principle 7, which this makes concrete.
- [`preservation.md`](preservation.md): what a feature's off state owes, which these streams make cheap to keep.
- [`continuity.md`](continuity.md): calm, which identity by address makes possible under a morph.
- [`conservation.md`](conservation.md): the other half of what keeps the picture honest.
- [`../model/source.md`](../model/source.md), [`../model/fill.md`](../model/fill.md), [`../model/canopy.md`](../model/canopy.md), [`../model/season.md`](../model/season.md), [`../model/leaf.md`](../model/leaf.md), [`../model/motion.md`](../model/motion.md).
- [`../evidence/measurements.md`](../evidence/measurements.md): the tie census and the variety morph's size.
- [`../implementation.md`](../implementation.md): where each stream and the harness live.
