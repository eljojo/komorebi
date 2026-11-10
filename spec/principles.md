# Principles

*How decisions are judged.* These are the present-tense commitments of the piece. Where two conflict, the earlier one wins. Their history, including the rules they replaced, is in [`evidence/dead-ends.md`](evidence/dead-ends.md).

## 1. The experience judges

The afternoon in [`experience.md`](experience.md) is the arbiter. A choice that makes the simulation more technically correct but less true to what was seen and felt is wrong. So is a familiar picture whose preservation prevents the afternoon from becoming more alive. Physical reasoning serves the experience because coherent causes produce relationships the eye recognises; it is not an instruction to maximise simulation, and technical completeness does not outrank felt truth.

## 2. Calm is an arbiter beside physics

The piece never startles, performs, or asks for attention. Nothing pops: a leaf that appears, leaves, changes shape or colour does so continuously, over a window the eye reads as a change and not a cut. A change that passes every technical test but disturbs the stillness is refused. Calm can hold a distinctive event when it follows from the scene's own causes and the quiet around it stays whole.

## 3. Model reality, not the artifacts

Reproduce the causes and let the appearance fall out. The sun-images, the soft penumbrae, the translation, the reorganising, the twinkle, the green of the shade, the red of a fall tree: all are consequences of a correct model, never special-cased effects. Where something is painted on rather than caused, the spec says so and calls it **authored**.

## 4. Never fake the structure or the optics law

Leaves are really where they are, on twigs that are really on branches. Light really attenuates through them by Beer's law. The light source really integrates over its finite angular size. Where two things must stay registered (a leaf and its twig, a shadow and its occluder, a hue and its level) they share one rule, never two rules that agree today.

## 5. Approximations are few, named, and bounded

The piece approximates where performance genuinely bites and the eye is forgiving, and it says so each time. **Depth discretisation**, the collapse of the canopy's continuous depth into a few layers, is the one approximation every frame pays, and the `faithful` cast is its opt-out for looks whose subject is the tree's structure. Every other approximation (a diffraction proxy, single scattering, a flat sky, a texel read as one leaf and a gap, a coarse hull with smooth shading) is named where it lives, with its limits and the state in which it is absent. A real mechanism does not make its proxy exact, and an approximation is never promoted into a law.

## 6. Model what reaches the eye

Only what changes the light that reaches the viewer is modelled. For the floor looks that means the canopy as a cast and nothing of how a tree looks from the side; they pay nothing for what they cannot see. For a backlit scene the trunk and branches are part of what reaches the surface, as dark silhouette. For the looks that look up, the tree itself is the subject: dark connected wood from trunk to twig, thinning as it goes, and occlusion that is never luminous. The principle is one: the surface decides what counts, and the surface is sometimes the retina.

## 7. Nothing visible comes from the math

All visible motion comes from the canopy; none from sampling. The source samples are frame-stable, the fill's rays are fixed, every per-leaf draw is a pure function of the leaf's address on a stream of its own. Two engines born alike render the same frame. Numerical shimmer may never impersonate the glisten.

## 8. Preservation serves the experience; it is not the goal

A familiar picture that moves without warning breaks an expectation, and that hurts. So preservation is the default and the safer route, taken whenever it costs the experience nothing: a feature lands with its off state unchanged, a look keeps its character, an old frame is kept as evidence.

It is not an end that justifies the means. The piece has taken losses by treating byte-for-byte identity with the first release as a law. When a change is **more komorebi** (truer to the afternoon, more a place, more calm) it may move pixels, including every pixel of a shipped look. An old frame is evidence of what the engine did, not of what it should do. What such a change owes is review: the artist sees it before it ships, with what improved and what was lost, and the look's recorded intent is updated when it is accepted. The contract is [`contracts/preservation.md`](contracts/preservation.md).

## 9. Gaps and clumps are emergent, never authored

Because gaps change when leaves move, a gap cannot be the thing that is drawn. The canopy is grown; clumping is its topology; multi-scale gaps are the skeleton's self-similarity; the gap-size distribution is a tuning target, never a generator. The same rule at the leaf: a maple's lobes are the negative space between its veins.

## 10. One engine, many surfaces

One physics across every surface the light lands on: the floor, the standing cloth, the tent around the viewer, the retina looking up. A receiver takes the arriving irradiance and the surface geometry and returns the radiance toward the eye; geometry feeds up into transport, material flows down from the landed light. A new surface is an addition, never an edit to the others.

## 11. The spec is the work

The implementation is judged against these documents, not the reverse. The artist's input goes into the spec; the spec goes into the implementation. A claim about what the piece should do that is not in the spec is a proposal, however well it renders. A claim in the spec that the code contradicts is a bug in one of them, and the artist decides which.

## Related

- [`experience.md`](experience.md): what these principles serve.
- [`contracts/README.md`](contracts/README.md): the requirements that make them concrete.
- [`evidence/dead-ends.md`](evidence/dead-ends.md): the rules these replaced, and why.
