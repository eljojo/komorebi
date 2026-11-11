# Glossary

*The words of the piece, and the file that owns each.*

These are the words the other documents use without stopping to explain. Each entry says what the thing is in a sentence or three, and points to the one file where it is stated in full; the glossary never holds a second derivation. Parameter names appear only where a reader needs to find the knob. Where one word carries two meanings (`exposure`, `κ`, `bake`), both are given.

## A

**abscission.** A leaf letting go of the tree, on a day of its own. Until that day the leaf fades over a short window and is then no leaf at all; it is never a pop. See *senescence*. [`model/season.md`](model/season.md)

**acc.** The fraction of the sun's disk that cleared every occluder on its way to a point: the landed beam, before any colour. Transport produces it, and the receiver turns it into light. It also stands in as the exposure-independent measure of how dark the shade is. [`model/transport.md`](model/transport.md)

**A_L.** The sunlight that reaches layer *L*, read ballistically along the sun's path from where a ray crosses that layer. The fill and the sky view both use it. See *T, T_b, thr, A_L*. [`model/fill.md`](model/fill.md)

**area light.** See *source*.

**aspect law.** A grown outline takes the look's leaf *area* and never its aspect, so a maple at aspect 1.75 is a smaller maple and never a thin one. [`model/leaf.md`](model/leaf.md)

**aureole.** The bright smear of cloud-scattered light many degrees wide around the sun. In the sampler it is the *halo*, a sparse annulus of low-weight point-suns around the *core*. [`model/source.md`](model/source.md)

## B

**backlash.** The recoil of a branch bent hard against its ceiling: when the gust eases it snaps back past rest and rings down, instead of gliding home. It is made literal as damping cut on the return stroke. [`model/motion.md`](model/motion.md)

**bake.** Two senses. The *canopy bake* is the once-a-frame rasterising of leaves into depth layers of per-channel optical depth. A *bake* more loosely is any such once-per-change pass (the faithful cast's pre-integrated shadow, the fill, the litter carpet) that turns structure into something the shader can read cheaply. [`model/canopy.md`](model/canopy.md), [`model/fill.md`](model/fill.md)

**ballistic share.** The part of a leaf's transmitted light that keeps travelling as a beam. See *beam and diffuse share*.

**beam and diffuse share.** A leaf is frosted glass, not a window: of the light it passes, a small ballistic share (`T_b`) keeps its direction and becomes sun-image, and the rest (`T − T_b`, nearly all of it) leaves in every direction as the leaf's own colour. The cast cameras read the beam; the fill and the sky view read the diffuse share. [`model/leaf.md`](model/leaf.md)

**Beer's law.** Light through a medium falls as `e^(−τ)`, with τ the optical depth. The piece carries τ and not transmittance because depths add and order does not matter; and because τ is per channel, two overlapping leaves are darker and greener. [`model/leaf.md`](model/leaf.md), [`model/canopy.md`](model/canopy.md)

**bloom.** Weather used as cover. When two looks cannot be carried leaf for leaf, a cloud thickens over the sun, the field goes soft and low-contrast, the scene swaps, and the cloud thins. It is capped short of overcast and is the last resort. [`model/transitions.md`](model/transitions.md)

**bokeh duality.** A camera's out-of-focus point of light renders the shape of the aperture; komorebi is the inverse, and a small gap renders the shape of the sun. Camera bokeh shows you the hole, komorebi shows you the sun. [`model/source.md`](model/source.md)

**bole.** The bare trunk below the first limbs, which runs down to the ground. See *cluster, twig, limb, trunk, bole*.

**bulk shift.** The ground displacement per unit height, `cot(elevation)` away from the sun, added to every sample's throw when the canopy is a finite object. It is why a standing tree's shadow is one connected thing: trunk streak, then branches, then dappled crown. In an endless overhead park it is zero. [`model/transport.md`](model/transport.md)

## C

**calm.** The feeling the piece must carry, and an arbiter beside the physics. Nothing startles or performs; a change that passes every technical test but disturbs the stillness is refused. As a contract it means no pops, fade windows and step clamps. [`experience.md`](experience.md), [`contracts/continuity.md`](contracts/continuity.md)

**camera (as a mode).** The answer to *what did the light land on*: the floor, the standing cloth, the enclosure, the retina looking up. A camera is a mode of the piece, compiled as its own program and changed only by a structural rebuild; it is not an effect and not a runtime branch. Not to be confused with the view knobs (pitch, orbit, pan, zoom) of the floor camera. [`model/transport.md`](model/transport.md), [`model/camera.md`](model/camera.md)

**canopy.** The grown grove as structure: trunks, limbs, twigs and the leaves on them, each where growth put it, moving on springs. The canopy never knows where the sun is. [`model/canopy.md`](model/canopy.md)

**carpet.** See *litter*.

**cast.** The shadow a canopy throws, or the act of computing it. The *layer cast* uses a few depth layers; the *faithful cast* uses the real geometry. [`model/transport.md`](model/transport.md)

**cluster.** See *cluster, twig, limb, trunk, bole*.

**cluster, twig, limb, trunk, bole.** The grown hierarchy, from the ground up. The trunk (with its bole below the limbs) bears a few limbs; limbs fork into sub-branches; terminal twigs carry clusters, the clumps of leaves. Wind turns each level about its own joint. [`model/canopy.md`](model/canopy.md), [`model/motion.md`](model/motion.md)

**coherent band.** The slow, smooth, directional part of the wind that loads the trunk and major limbs, so the whole canopy shifts together and the gap pattern translates intact. It breathes, stiffens against a ceiling, and recoils. [`model/motion.md`](model/motion.md)

**core.** The tight, heavy population of the sampler: the sun's half-degree disk, carrying most of the energy in clear sky. Cloud drains it into the halo. [`model/source.md`](model/source.md)

**coverage.** How much of a texel, or of a cluster's disc, leaf covers. A cluster's shadow is its areal coverage (leaf count times leaf area over disc area), which is why fullness is leaf size and not count; a texel stores the sum of its leaves' coverage beside their optical depth. [`model/canopy.md`](model/canopy.md), [`model/leaf.md`](model/leaf.md)

**crossfade.** The transition for a topology change that can be made to reorganise rather than dissolve: the incoming grove is grown beside the outgoing one and the two leaf fields share the light while gaps merge, split and collapse. It adds no bloom. [`model/transitions.md`](model/transitions.md)

## D

**dapple.** A bright patch on the surface under a canopy. Most dapples are not the shape of the gaps above them but *sun-images*. [`model/source.md`](model/source.md)

**depth layers.** The few (three to five) height-binned sheets into which the bake collapses the canopy's continuous depth. [`model/canopy.md`](model/canopy.md)

**depth discretisation.** That collapse itself, and the one approximation every frame pays. The faithful cast is its opt-out, for looks whose subject is the tree's structure. [`principles.md`](principles.md), [`model/canopy.md`](model/canopy.md)

**diffraction (leaf-edge).** Light bends around every leaf edge by an angle that grows with wavelength, so each dapple gains a warm rim and a cool core. The piece scales the pinhole shift per channel by `λ/λ_green`; the strength knob is exaggerated on purpose, and at its far end it is the *prism* look. [`model/light.md`](model/light.md)

**diffuse share.** See *beam and diffuse share*.

**distance haze.** The far floor of a tilted view dissolving into the sky's hue before the horizon. Authored, not a model of aerosol along the ray. [`model/camera.md`](model/camera.md)

**drift phase.** The one continuous angle φ that drives the incoherent band. Each leaf has a bounded orbit about its rest position, all at one rate, so the canopy is periodic in φ and returns exactly to its start: the remembered "gaps open, merge, and come back". It is advanced by hand or at a constant rate, not by the wind. [`model/motion.md`](model/motion.md)

## E

**eclipse.** A property of the source: a moon disk laid over it removes the weights of the point-suns it covers, so every dapple becomes the same crescent. The remaining weights are renormalised, an authored departure. [`model/source.md`](model/source.md)

**edge_area.** The rung that makes a leaf's soft edge read as a mixture of leaf and gap even with no diffuse split, removing the Jensen-dark edge the slab reading leaves. It is a boolean, ships off, and changes the look. [`model/leaf.md`](model/leaf.md)

**exposure (the look's free constant).** The multiply, in the look's tail, that sets how bright a look's world is. The cosine law leaves it to the author on purpose, so a look that opens the cosine law re-sits its exposure. [`model/camera.md`](model/camera.md), [`model/light.md`](model/light.md)

**exposure (a leaf's share of light).** The season's measure, computed once per grove: how much leaf area lies between a leaf and the sun along one representative ray. It orders who turns and who falls first, through the *rank*. The two senses share a word and nothing else. [`model/season.md`](model/season.md)

## F

**faithful cast.** The cast of the actual geometry at its real grown heights, every leaf and the whole woody skeleton, projected per source sample and weight-summed into one pre-integrated soft-shadow texture that transport taps once. It is the heavy rung; it needs a single flat receiver frame (floor or cloth) and falls back to the layer cast. [`model/canopy.md`](model/canopy.md), [`model/transport.md`](model/transport.md)

**fill (sky fill).** What lights the shade: the skylight that had to come through the canopy, plus the sunlight the lit leaves scatter down, integrated over each floor point's hemisphere by a fixed set of cosine-weighted rays. It is why the shade is a dim green in summer and red in a fall canopy. [`model/fill.md`](model/fill.md)

**flutter.** The fast oscillation of each leaf's tilt, with amplitude following the coherent sway. With the drift phase it carries the glisten. See *glisten*. [`model/motion.md`](model/motion.md)

## G

**gate.** A parameter whose zero, false or absent state is the previous law. Shut, it allocates and runs nothing; open, the frame changes. [`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md)

**genotype, light class.** With `leaf_variety`, each tree draws one of eight leaf genotypes, and each genotype grows eight outlines, one per light class from deep shade to full sun: 64 outlines a grove. A leaf's class comes from its rank of light. [`model/leaf.md`](model/leaf.md)

**glisten.** The fine twinkle in place under the faintest breeze. It is the most fragile thing in the piece, and the reason nothing else may twinkle. [`experience.md`](experience.md), [`contracts/determinism.md`](contracts/determinism.md)

**glow tier.** The receiver's lateral diffusion of landed light, which in the sky view reads as the eye's veiling glare. It is a style rung, not a quality one. [`model/receivers.md`](model/receivers.md), [`model/sky-view.md`](model/sky-view.md)

**grove.** The canopy as several small recursive trees with overlapping crowns. A single tree leaves a bright bare hole over its trunk; a grove does not. [`model/canopy.md`](model/canopy.md)

## H

**h·θ (the blur scale).** A gap's height above the surface times the sun's angular size: about 10 cm under a canopy 10 m up. A gap much smaller than it throws an image of the sun; one much larger throws its own shape with a penumbra of that width. [`model/source.md`](model/source.md)

**halo.** See *aureole*.

**held leaf.** The editor's `L` inset: one real leaf of the grove held against a white sun, its areole maze drawn at full resolution, walls gold and cells red. A proof bench for the sieve; the maze never enters the frame. [`model/leaf.md`](model/leaf.md)

## I

**incoherent band.** The fast, faint, spatially uncorrelated motion at the bottom of the hierarchy, from every direction at once, which kicks each leaf alone. As built it is the drift phase; the wind field that would drive it is not built. Its visible range runs from glisten to caustic-like reorganisation, set by foliage density. [`model/motion.md`](model/motion.md)

**iris (the projector's).** A soft elliptical-to-rectangular mask on the light, so a throw onto a backyard pools and fades and shows no edge. It multiplies the light before the tail; a presentation device, not physics. [`model/camera.md`](model/camera.md)

## J

**Jensen's inequality.** Beer's law is convex, so the mean of transmittances is brighter than the transmittance of the mean depth. It is why a sieve of walls and cells lifts a deep leaf, why the fill averages transmittance and never blurs optical depth, and why a slab-read edge is dark. [`model/leaf.md`](model/leaf.md), [`model/fill.md`](model/fill.md)

## K

**k (neutral depth).** The ballistic share seen as an optical depth: `k = −ln(1−d)`, clamped at 6, the same in all three channels, added to a leaf's own τ for the beam. It is set by the leaf's scattering structure, not its pigments. [`model/leaf.md`](model/leaf.md)

**κ (two meanings).** In the *mixture*, `κ = k·c/a` is the texel's neutral depth: `k` per leaf, kept deep where leaves stack. In the *litter*, κ is the pigments' absorption per unit optical depth relative to the tissue's scattering in the Kubelka–Munk reflectance law; it is set at 2 by judgement and is provisional. Unrelated quantities. [`model/leaf.md`](model/leaf.md), [`model/season.md`](model/season.md)

**key classes.** Every knob belongs to exactly one class that says what a transition may do with it. **MORPH**: the continuous look (sun, exposure, cloud, wind, grade); it interpolates. **CANOPY**: the grove's continuous shape and colour; it deforms the grove. **SEASON**: a subset of CANOPY (tint, phenology, pigments, drop clocks); when alone, the grove is re-seasoned in place. **TOPO**: the branching itself and the gates that allocate everything at once; they flip, never morph. **MODE**: a camera or cast path; flipping one is a rebuild. [`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md), [`model/transitions.md`](model/transitions.md)

## L

**lantern.** The sky-view leaf: not a window but a source. Light reaching it scatters inside and leaves in every direction, so against the sky a lit crown glows from the sun's light the leaf took out of the beam. The wood never glows. [`model/sky-view.md`](model/sky-view.md)

**layer.** One of the depth-binned sheets of the bake, holding per-channel optical depth and coverage at a height. [`model/canopy.md`](model/canopy.md)

**leaf address (j, k).** A leaf named by its cluster *k* and its place *j* in it, with the grove's seed. Every per-leaf draw is a pure function of the address on a salt of its own, so a leaf is itself whatever else changes. [`contracts/determinism.md`](contracts/determinism.md)

**limb.** See *cluster, twig, limb, trunk, bole*.

**litter.** Fallen leaves as a floor material, the carpet: laid once per grove, a function of phenology and seed and never of the run, in the colour of a leaf seen by reflection (a Kubelka–Munk law, aged toward brown, darkened when wet). It does not accumulate and does not move. [`model/season.md`](model/season.md)

**look, preset.** A look is a complete authored set of parameters: a place, a light, a mood. A preset is its saved form. Each shipped look's character and chosen departures from physics are recorded so an intent is told from a defect. [`contracts/looks.md`](contracts/looks.md)

**the Look (capital L).** The tail every picture passes through, in this order and no other: perception and haze, the iris, exposure, tone curve, contrast, gamma. One definition shared by every path. [`model/camera.md`](model/camera.md)

## M

**marcescence.** A tree holding its dead leaves through the season, as a beech keeps about half of its leaves, brown. It is the *retention floor* `1 − leaf_drop`: the shaded tail of the drop order that never falls. [`model/season.md`](model/season.md)

**marginal leaf, marginal tree.** The fractional last leaf of a clump, and the fractional last tree of a grove, faded in by the remainder so that crossing an integer count is continuous. A leaf letting go fades the same way. [`model/canopy.md`](model/canopy.md), [`model/leaf.md`](model/leaf.md)

**mesopic.** See *Purkinje*.

**mixture (a texel as leaf and gap).** A bake texel stores optical depth and coverage; every reader reads those as one representative leaf and a gap, `T = (1−a) + a·e^(−τ/a)`, not as a slab of averaged depth. It is exact for one leaf or a full stack, bounded in between, and blind to two edges in one texel. [`model/leaf.md`](model/leaf.md)

## O

**optical depth τ.** `−ln T`, per channel. The quantity the model carries, because depths add under additive blending with no sorting. [`model/leaf.md`](model/leaf.md), [`model/canopy.md`](model/canopy.md)

## P

**phenology.** The season as one number: 0 spring bud, 0.5 summer, 1 the end of the fall. Leaves turn between `turn_start` and `turn_start + turn_span`; at 1 every leaf has fully turned, which is not leaf-off. The same look at the same phenology is the same autumn. [`model/season.md`](model/season.md)

**pigment basis.** Optical depth adds, so each pigment (carotenoid, anthocyanin, tannin) is a vector of per-channel optical depth, and a turned leaf is the summer leaf with green taken away and pigments added. The vectors are chosen from known absorption, not fitted. [`model/season.md`](model/season.md)

**pinhole regime.** A gap small against `h·θ` washes out its own shape and the surface shows an image of the sun. The other pole is the *shadow regime*, a gap large against `h·θ` throwing its own shape. [`model/source.md`](model/source.md)

**pitch.** A limb's elevation in its own vertical plane, the second degree of freedom beside yaw, on its own spring. It foreshortens the heights of what the limb carries, so the join with the trunk stays closed. Faithful path only. (Also the floor camera's tilt, `view_pitch_deg`.) [`model/motion.md`](model/motion.md)

**Purkinje, mesopic.** At dusk the retina's rods take over from the cones: dim areas desaturate to blue-grey and saturated reds darken first, while bright dapples stay in cone vision. The piece drives it from duskness times local shade darkness, and amplifies it. [`model/light.md`](model/light.md)

## R

**rank (exposure).** A leaf's percentile `u` in its grove's order of exposure, 0 buried to 1 most exposed. It, not the raw light, sets the turn and drop schedule, so a dense grove and an open one keep the same autumn; `exposure_absolute` blends the raw light back in. Equal light is broken by the leaf's own clock. [`model/season.md`](model/season.md)

**receiver.** The surface the light lands on: an opaque floor, a translucent pleated cloth, a tent of panels around the viewer. It takes the arriving irradiance and its own geometry and returns radiance toward the eye. Geometry feeds up into transport; material flows down from the landed light. [`model/receivers.md`](model/receivers.md)

**recvZ, receiver-relative read.** `z_p`, the height of the receiver point. Each layer is read shifted by `(h − z_p)·g`, so the same equation serves a floor (`z_p = 0`), a cloth (height up the plane) and a tent, with no receiver-specific code in transport. [`model/transport.md`](model/transport.md)

**re-season.** Replacing a grove's colour, retained weights and litter in place, in one pass over a stored record of its leaves, when only season keys differ. It does not regrow the grove. [`model/season.md`](model/season.md)

**rung.** A quality upgrade as a step on a ladder. It owes a gate whose off state is the look before it, a cheaper rung to degrade to, a cost-audit entry and a statement of who may cross it. A correction to how the model works is not a rung. [`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md)

## S

**salt, stream.** Each family of random-looking numbers (growth, arrangement, wind identity, pigment clock, drop day, inner leaves, tree draws, genotype) is a stream seeded by the look's seed mixed with its own salt and keyed by an address. A draw from one stream moves nothing in another. [`contracts/determinism.md`](contracts/determinism.md)

**season set.** The keys that change a leaf's colour, retention and place and nothing structural: the tint, phenology, the turn's start, span and spread, the pigment capacities and the drop clocks. A change confined to them re-seasons. [`model/season.md`](model/season.md)

**senescence.** A leaf turning: chlorophyll dismantled, uncovering carotenoid yellow, anthocyanin made red. Every leaf runs its own clock, light orders them, and trees run ahead of their neighbours. [`model/season.md`](model/season.md)

**shadow regime.** See *pinhole regime*.

**shared ray.** The one ray routine the sky view's eye ray and each of the fill's hemisphere rays run, with the sun's path as an argument, so the piece cannot answer *what does this ray see* two ways. [`model/sky-view.md`](model/sky-view.md), [`model/fill.md`](model/fill.md)

**sieve.** A leaf is bright vein walls beside darker cells, and Beer's law is convex, so its mean transmittance is `f_w·e^(−τ_wall) + (1−f_w)·e^(−τ_cell)`. The engine places no veins; the sieve is a mean. The maze is drawn only in the held leaf. [`model/leaf.md`](model/leaf.md)

**sky view.** The camera with no surface: the eye lies on the ground and looks up through the same canopy along its own rays. The source is in frame, the wood is silhouette, the leaves are lanterns. [`model/sky-view.md`](model/sky-view.md)

**source.** The sun as modelled: a half-degree disk, smeared by cloud into an aureole, held as a fixed cloud of weighted point-suns. It is purely angular and knows nothing of the ground. Also called the area light. [`model/source.md`](model/source.md)

**standing scene.** A canopy treated as a finite object standing in the scene, so its whole shadow, trunk streak to crown dapples, is thrown across a lit floor. It turns on the bulk shift and makes the world outside the box open sky. [`model/transport.md`](model/transport.md)

**stem joint.** The pivot at a twig's base, toward its parent. A twig turned about its own centroid shears the clump into a vortex; the pivot's location, not its amount, separates a branch in wind from a vortex. [`model/motion.md`](model/motion.md)

**sun-image.** The picture of the sun that a small gap projects. The proof is the eclipse, where every dapple is a crescent. See *dapple*.

## T

**T, T_b, thr, A_L.** `T` is what a texel truly passes (hue, skylight, the light sent on); `T_b` its ballistic share (the beam); `T − T_b` the diffuse emission. Along a fill or sky ray, `thr_L` is what light emitted by layer *L* finds below it and `A_L` the sunlight reaching it. Together they make beam plus emission equal total transmitted. [`model/leaf.md`](model/leaf.md), [`model/fill.md`](model/fill.md)

**tier (layer vs faithful).** The two evaluations of transport. The *layer tier* runs the sum per pixel over depth layers and serves any receiver that can name a point and a height. The *faithful tier* pre-integrates once into a single texture and needs one flat frame. The **fall tiers** are the six season features (fill, diffuse share, pigment, exposure, drop, litter) a bundle may cut. [`model/transport.md`](model/transport.md), [`contracts/gates-and-rungs.md`](contracts/gates-and-rungs.md)

**torque (about the trunk).** Each limb bends by `cross(limb_dir, wind)` about its own trunk, so broadside limbs swing hardest, the two sides swing in opposite senses, and the canopy leans rather than spins. A shared angle gives one giant pinwheel. [`model/motion.md`](model/motion.md)

**transport.** How the sun's light is carried from the source through the canopy to a surface: many sharp shadows, each shifted by height times angle, summed. The soft shadow is the sum, and higher foliage blurs more for free. [`model/transport.md`](model/transport.md)

**travel routes.** Transitions in which leaves actually fly: **viewpoint** (a shared grove turns from sky to ground), **leaf travel** (overhead faithful to layer, or between two overhead faithful groves), **season travel** (a shared standing grove between floor and canopy), **litter rise and fall** (carpet to sky and back), **shadow rise and fall** (footprints lift into the sky and come back down) and **grove regrouping** (different standing groves, leaf by leaf). Each lands exactly on its native end, reverses from where it is, and keeps the winds running. [`model/transitions.md`](model/transitions.md), [`contracts/transitions.md`](contracts/transitions.md)

**trunk.** See *cluster, twig, limb, trunk, bole*.

**twig.** See *cluster, twig, limb, trunk, bole*.

**twinkle.** Individual leaves flexing without changing the gap topology, in a dense canopy where every gap is backed by ten more leaves. The sparse early-spring canopy reorganises instead. See *incoherent band*. [`model/motion.md`](model/motion.md)

## V

**vortex (as a named failure).** A twig pivoted about its own centroid, or limbs sharing one bend angle, sheds little whirlpools or turns the canopy rigidly. It is scale-free: it returns wherever children straddle a pivot turned by one angle, and dies the same way each time, by putting the pivot on the parent and bending by torque. [`model/motion.md`](model/motion.md)

**Vogel spiral.** The sunflower pattern: successive points turn by the golden angle and step out by the square root of their index, covering a disk or annulus evenly by area. It lays the sampler's point-suns and is the reason they do not clump or band. [`model/source.md`](model/source.md)

## W

**weather.** Two things. The *weather layer* is the slowest band of the wind, a low-frequency state that drifts strength and direction over minutes. *Cloud* is the source's widening; the weather macro moves both. In causal order, weather changes the source and the forces on the grove. [`model/motion.md`](model/motion.md), [`model/overview.md`](model/overview.md)

**wetness.** After rain a fallen leaf soaks, water cuts its scattering and the carpet reads darker and more saturated. It acts on dead tissue only. [`model/season.md`](model/season.md)

**wood, woody occluder.** Trunks and limbs as a separate producer of shadow beside the leaves. On the layer path an analytic table of continuous-height segments, never binned; on the faithful path every twig as a tapered capsule. The sky view reads the same segments as silhouette, so shadow and seen tree cannot disagree. [`model/canopy.md`](model/canopy.md)

## Related

- [`README.md`](README.md): how the specification is organised and written.
- [`principles.md`](principles.md): the commitments these words serve.
- [`model/overview.md`](model/overview.md): the causal spine that most of these terms hang on.
- [`contracts/README.md`](contracts/README.md): the words of requirement (gate, rung, class, stream).
