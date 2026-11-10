# Motion

*The wind and the spring hierarchy it drives: how the canopy moves, and what that movement hands the cast.*

## One wind field, two bands, one hierarchy

The park held two motions, and they are not two strengths of one thing. They are **two different mechanisms** at the two ends of one structure.

Every node of the branch hierarchy (trunk, limb, twig, leaf) is a small transform with a **rest pose** and a **damped spring** pulling it back to that pose, and children inherit their parent's motion. **Law:** the wind is an offset *force* on those springs. It never drifts a rest pose, so when it dies the tree is exactly where it started.

- The **coherent band** loads the top of the hierarchy: slow, smooth and directional. Because everything hangs off the trunk and the major limbs, the whole canopy shifts together and the pattern on the ground **translates nearly intact**.
- The **incoherent band** lives at the bottom: fast, faint, "in all directions", kicking each leaf a little differently from its neighbours. Neighbours moving independently is what makes the gaps **reorganise** instead of slide.

Between them sits a medium band, twigs flexing differently from one another, which makes gaps morph and recover. The bands coexist and sum. How the three map onto the hierarchy is the mapping at the end.

## The coherent band

The coherent band has four specifics, each a required part of the model, each felt in the park.

- **Breathing.** The wind eases in and out. A gust has an attack and a decay; it never arrives as a square edge.
- **Stiffening.** A real branch resists harder the more it bends, so past a point its motion clips against a ceiling. That rising resistance is what is felt as the branch fighting the wind at the peak of a gust.
- **Backlash.** A branch bent hard against its ceiling has stored elastic energy. When the gust eases it does not glide home: it recoils past rest and rings down. The overshoot grows with how hard it was pushed. So the band is *load → clip against stiffening → whip back → settle*, never *load → relax*.
- **Exact relaxation.** It returns to a stored, honest equilibrium: the starting point.

### The spring that realises them

The whole tree's coherent response is one spring per horizontal axis, its displacement `u` measured as a fraction of the ceiling. The four specifics are made literal:

- **The wind is a force, and the rest is 0.** Relaxation is exact for free.
- **Stiffening diverges at the ceiling.** The restoring force is `∝ u/(1 − u²)`, so no finite gust can push past `|u| = 1`, and the resistance climbs as the branch nears its limit.
- **Backlash is asymmetric damping.** The same underdamped spring has its damping cut on the *return* stroke, when velocity opposes displacement. A branch released from near the ceiling whips back past rest and rings down, and the overshoot scales with the load. No separate mechanism exists for it.
- **Breathing is an asymmetric one-pole envelope** on the forcing, with independent attack and decay constants, so gusts ease in and out. **Law (observed):** the rise is sharper than the decay; the field ratio is in [`../evidence/measurements.md#motion`](../evidence/measurements.md#motion).

The knobs are the spring's stiffness (`sway_stiffness`), its ceiling (`sway_ceiling`, which sets how far the full sway reaches), the damping ratio (`damping_ratio`), how much the return stroke is under-damped (`backlash_gain`), and the gust edges (`gust_attack`, `gust_decay`). **Open:** the shape of the stiffening and the damping that makes the backlash read right, a visible overshoot that never looks rubbery, are tuned by eye.

The trunk's sway translates the whole field: this is the **bulk drift**, the one translation in the model. Everything below the trunk is rotation.

## Translation alone is not wind

**Law of this model: motion that only moves leaf positions looks like a slide.** A single rigid translation, every leaf shifted by the same vector, does not read as wind even with correct breathing and backlash. Every blob keeps its exact silhouette and merely slides, and that is the tell. Two things carry the rest of it.

**The leaves rock.** The wind tilts each leaf, and a tilting leaf's footprint foreshortens (the stamp itself is [`canopy.md`](canopy.md)'s), so the dapple *changes shape* as well as position and returns to rest when the gust passes. A real part of the glisten lives here, in the stamp, not in transport. The rock has two parts:

- a **quasi-static** part: the leaf flags with the wind, in proportion to the signed sway `u`;
- a **flutter**: an oscillation whose amplitude grows with wind strength, in proportion to `|u|`, at the flutter rate, with its phase decorrelated leaf to leaf.

At zero wind both vanish and the still image is untouched. `leaf_swing` scales the rock and `flutter_freq` sets the flutter's rate.

**The sway is not uniform.** Wind is never in only one axis. Clumps flex by different amounts and in slightly different directions, so the field shears and gaps morph rather than the whole sheet marching in lockstep. This is the medium band, carried by the twigs below.

A real share of wind lives in leaf *orientation* driving the footprint, and in *decorrelation* between neighbours. Position is the least of it.

## A hierarchy of rotations

**Law: a branch does not translate; it pivots.** A branch is anchored at a joint, has a length and an angle, and the wind turns it about that joint. Everything hanging off it sweeps an arc, and the whole sub-structure turns as one rigid piece. Rotation is what the eye reads as "branch". Driving limbs and twigs as free translation springs instead makes patches of dapples swim in different directions with no rigid body behind them, uncanny and unresolvable as structure ([`../evidence/dead-ends.md#motion`](../evidence/dead-ends.md#motion)).

The hierarchy has three levels:

- **Trunk.** The coherent spring above. Its sway translates the field.
- **Limbs.** A handful of arms (`limb_count`) radiating from the trunk. Each carries a scalar **bend angle** on a soft, slow spring and pivots about the trunk, the one joint where all its limbs meet. A clump hangs off the far end of its limb, so a limb's bend swings its whole wedge of clumps as a rigid arc. Clumps on one limb swing together; neighbouring wedges bend by different amounts, so the field shears at their seams. `limb_flex` sets the bend amplitude.
- **Twigs.** Every clump carries its own faster, stiffer bend angle and swings about a **stem joint** offset from the clump toward its parent. Bending the twig sweeps the whole clump to one side through an arc, decorrelated clump to clump. `twig_flex` sets the amplitude and is the gate on the medium band: at 0 there is no twig motion.

Limb and twig springs share the trunk's damping and take their stiffness from the trunk's, softer for the limb and stiffer for the twig; there are no separate stiffness knobs.

**A leaf inherits twig swing ∘ limb swing ∘ trunk translation**, in that order: the twig turns about its base, then twig and leaves together turn about the limb's joint, then the tree drifts. **Its own orientation rotates with the branch**, by the limb bend plus the twig bend, so its footprint presents differently as the branch turns. Leaves and wood take the same joint rotation, so foliage cannot part from its wood under wind.

Each bend **breathes with the gust and rests at zero wind**. Beside the torque-driven bend (below), each limb and twig takes a small independent forcing, a slow noise sampled at its own position, so neighbours differ. That forcing is scaled by the effective wind strength (strength times the weather), clamped to at most 1, so it eases to nothing in calm and the springs settle when the wind is off, even while the leaf-drift clock keeps running.

## The stem joint

**Law: the pivot's location, not its amount, separates a branch in wind from a vortex.** A twig pivoted about its own clump's centroid makes the two halves of the clump shear in opposite directions: a little in-place spin. A field of them reads as swirling the eye latches onto, with no agreement with the wind ([`../evidence/dead-ends.md#motion`](../evidence/dead-ends.md#motion)). Moving the pivot **off the clump, onto a stem toward the parent**, makes the whole clump, small beside its stem, swing the *same* way: a directional sweep with only a gentle rotation on top.

On the layer path the stem joint is synthesised: `stem_length` back along the line from the clump toward its tree's trunk, with a little per-twig angular spread so twigs do not lockstep. Set it to zero and the swirl returns; the knob is the diagnosis. On the faithful path the joint is the twig's real grown base, below.

## Torque about the trunk

The same failure returns one level up, for the same reason. Limbs scattered as plan anchors, with clumps bound to the nearest one, put a limb's clumps on every side of its pivot, so opposite sides sweep opposite ways and whole regions spin in place ([`../evidence/dead-ends.md#motion`](../evidence/dead-ends.md#motion)). The cure is the stem principle lifted a level: the limbs grow as arms from the trunk, and each clump hangs off the limb whose direction points toward it, outward from the trunk and never straddling it.

A shared pivot sets a second trap. If every limb bends by the same angle about the same point, the canopy rotates rigidly: the little vortices are traded for one giant pinwheel ([`../evidence/dead-ends.md#motion`](../evidence/dead-ends.md#motion)). So **a limb's bend is the wind's torque about the trunk**:

> bend ∝ `cross(limb_dir, wind)`

Limbs broadside to the wind swing hardest, limbs end-on barely move, and the two sides of the tree swing in opposite senses, so that every tip travels downwind. The canopy **leans** rather than spins. The twig bend takes the same torque, for the same reason. The torque uses each limb's **mechanical direction**, a balanced fan, deliberately decoupled from the azimuth at which the limb is drawn (a phyllotaxis spiral, [`canopy.md`](canopy.md)), so that a gust leans every tree however its limbs are arranged.

**Law of this model: the vortex is scale-free.** It returns at every level where children straddle a pivot turned by a single angle, and it dies the same way each time: put the pivot on the parent, so the children are one-sided, *and* drive the bend by torque, so a gust leans rather than rotates. Moving positions alone looks like a slide; moving positions differently per region looks like soup. The differential motion of a canopy is rotational: angles changing at joints, inherited down a tree.

## The joints are grown

The joints are the grove's own ([`canopy.md`](canopy.md)). Each tree's limbs pivot about **its own** trunk, and the torque is taken about that trunk, so a gust leans every tree about its own base, not about the centre of the frame. A leaf inherits its tree's limb swing ∘ twig swing ∘ the global trunk drift. The core motion is **yaw in the ground plane**: branches turn about vertical axes at their joints.

On the faithful path, where the wood is drawn and seen, the twig's joint is the **real base** recorded at growth, the point where a terminal twig attaches to its parent. **Law:** the leaves and that twig's own wood swing about that one point, by the same per-twig angle, in the same order, so the leaves stay on their twigs under motion by construction. A grown twig's base is offset from its clump toward its parent by definition, so it already *is* a stem joint; `stem_length` is inert on the faithful path. The faithful canopy therefore carries all three bands. An earlier faithful cast dropped the medium band to keep leaves registered on visible wood, which bought registration with stillness ([`../evidence/dead-ends.md#motion`](../evidence/dead-ends.md#motion)).

The motion clocks (the gust signal, the weather, the drift phase) are functions of time and belong to the weather, not to any grove. A newly grown tree starts with its springs at rest and joins the running wind.

## Pitch, the second degree of freedom

Yaw alone has no depth. Each limb also carries a **pitch** angle, its elevation in its own vertical plane, on its own spring with the same stiffness and damping as its yaw.

**The two degrees of freedom are one wind force resolved two ways about one joint.** The drag perpendicular to the limb's plan direction has a moment arm about the vertical and yaws it (`∝ cross`, above). The drag parallel to it has no such arm and cannot turn the limb about the trunk at all; it loads the limb end-on and pitches it:

> pitch forcing ∝ `dot(live_dir, wind)`

Cross and dot are complementary; between them they spend the whole force. Both resolve against the balanced mechanical fan, so neither can spin the canopy.

**Streamlining is emergent.** The pitch is forced by the limb's **live** direction: its mechanical direction rotated by its current yaw bend. A broadside limb is all cross and no dot; it takes the torque and swings downwind. That swing turns its live direction into the wind's line, the dot grows, and only then does it pitch flat. It aligns and then streamlines, in that order, because the first motion creates the second forcing. Nothing tests for alignment. An upwind limb (`dot < 0`) pitches up.

**What reaches the cast.** A pitched limb foreshortens the heights of the leaves and the wood it carries, so they cast a shorter shadow:

> `fore = clamp(1 − sway_pitch·(1 − cos θ_pitch), 0.1, 1)`
> `h' = attachH + (h − attachH)·fore`

`attachH` is the height at which the limb meets its trunk. At the join `h' = attachH` exactly, so a pitching limb cannot part from the trunk, which does not pitch: **the join is closed by construction**. The sign is right for a drooping tip that hangs below its attach too: rotating a limb down about its joint moves every point toward the attach plane. Leaves and wood take the same factor from the same limb's pitch, so a leaf stays registered on its wood.

Two constructions are refused, each for a reason. The foreshortening is not driven from the yaw bend: a limb turning sideways in plan does not by itself lose elevation, so depth needs its own degree of freedom. And heights are not scaled from the ground: that leaves the trunk unscaled and opens a gap at the limb's join under a low sun.

`sway_pitch` scales how much of the pitch reaches the cast. **It is faithful only**, since it needs real per-leaf and per-segment heights and the layer cast has none. It is off by default; off, the pitch spring never integrates and its state is held at rest, so turning it on, or a transition easing it up, starts from rest rather than snapping.

## Broadband forcing

**Law: real wind is broadband.** Its energy is spread across every timescale at once: a minute-long surge carrying second-scale gusts carrying sub-second flutter, falling off in the gust range with the **Kolmogorov −5/3 power spectrum**. A single frequency puts all its energy at one period; the eye locks onto it and reads a machine ([`../evidence/dead-ends.md#motion`](../evidence/dead-ends.md#motion)).

So the coherent spring is driven by a **fractal sum of octaves over time**, a noise of time with no sampling randomness ([`../contracts/determinism.md`](../contracts/determinism.md)). The per-octave amplitude gain `G = 2^(−H)` sets the spectral slope. `H = 1/3` is the physically right value for wind, between "pink" `H = 0`, choppy and nervous, and "brown" `H = 0.5`, smooth and sluggish. `H` is the wind's **character**.

**Law of this model: the first primitive was wrong, not just mis-tuned.** Wind is not a frequency with an amplitude; it is a spectrum across timescales, with a mean that itself drifts. The controls below are that spectrum made controllable.

### Three controls

Each is a real meteorological quantity:

- **strength** (`wind_strength`): the mean force, "how much".
- **gustiness** (`wind_gustiness`): the turbulence intensity `σ/U`, "how alive". It is about 0.1 in calm air, about 0.2 over open country, and higher under a canopy. It scales the fluctuation against the mean. At high gustiness the deep lulls drop the force below the mean lean, so the spring recoils back through rest: the felt "comes back" arises from the forcing itself, not only from the backlash.
- **gust rate** (`gust_frequency`): the lowest octave's frequency, "how frequent". The faster octaves layer on top of it.

The wind's direction is `wind_direction_deg`.

### Crosswind

The coherent motion is two-dimensional. Beside the longitudinal stream runs a **lateral channel**: a second, decorrelated broadband stream on its own spring, perpendicular to the wind, with the same stiffening and backlash. Turbulence has no preferred sign across the wind, so this channel is zero-mean and genuinely bidirectional. The two compose into a 2-D sway, and the bulk drift **wanders** rather than tracking a dead-straight downwind line. This is the trunk's share of the medium band's decorrelation; the limbs and twigs add the rest.

The gust-edge envelope (attack sharper than decay) slews the **longitudinal** force only, the lean channel. The crosswind is left unslewed, because an asymmetric slew would bias a zero-mean channel.

### Patterns

The spectral slope, the number of octaves, the mean-lean fraction, the crosswind fraction and the burstiness are not exposed as raw knobs. **Authored:** they are bundled into a small named set, `wind_pattern`:

| Pattern | Character |
|---|---|
| **steady** | a smooth, rolling directional breeze |
| **gusty** | near the Kolmogorov slope; the natural default |
| **squally** | bursty, sharp rises, deep clustered lulls |
| **choppy** | nervous fine high-frequency stir, a cold-front edge |
| **lazy** | a very slow faint stir, the companion of the glisten |

Every pattern reads the same shared controls (strength, gustiness, rate, direction, weather) and shapes them differently inside, including a waveshaper that spikes peaks and deepens lulls for clustered, intermittent gusts. A look names its pattern; the name is the whole surface, so a pattern can later become a generator of its own without any look changing.

### Weather

Above the gusts sits the slowest band: a **self-evolving weather state**, a low-frequency noise of time that drifts the overall strength (calm spells and gusty spells coming and going over minutes) and slowly veers the direction. It is deterministic, like the rest; a mean-reverting random walk would do the same job but would break the rule that nothing visible comes from sampling. `weather_variability` sets how much the day evolves on its own (0 is a static day) and `weather_speed` how fast. This is the difference between a calm afternoon and a gusty one, and it changes, unbidden, which way the wind leans.

The broadband signal subsumes the single gust, and the deep lulls and the crosswind retire the "leans downwind and never comes back" tell on their own.

## The incoherent band

A **fast, spatially incoherent** forcing, faint and from every direction, kicks individual leaves and petioles slightly differently, with almost no correlation between neighbours. **That decorrelation is the entire difference** from the coherent band. There, neighbours move together and shape is preserved; here, neighbours move independently, and the gaps **reorganise**.

Its visible effect runs from a faint **glisten** to full **caustic-like reorganisation**, and what sets the scale is foliage density, below.

**What is built of it is two parts, not one.** The **drift phase** below moves each leaf's position around its own orbit, on a clock. The **flutter** of the rock (*The leaves rock*, above) turns each leaf's orientation on its own phase, at one frequency (`flutter_freq`), with an amplitude that grows with the wind (`leaf_swing` · |u|): that is an incoherent forcing already, with no correlation between neighbours, on the stamp's shape rather than its place. Afternoon 7 visibly shimmers from it alone. What neither gives is a sideways kick that rises with the gusts, a correlation length, or a spectrum; a prototype that adds them is `test-gl/out/review/2026-11-09-item16-incoherent-band` (2026-11-09).

**The caustics reference is model, not mood.** Pool caustics are bright features that move by **merging, splitting and collapsing** rather than sliding. The same visual grammar is what reorganises here: small gaps drifting in and out of the pinhole regime, neighbouring sun-images overlapping and separating, brightness gathering and dispersing as apertures breathe. It is not literal optical focusing, as water's is; the felt behaviour, the smooth birth, merge and collapse of bright shapes, is shared, and it tells an implementer what the second motion must feel like in a way no equation does.

### The drift phase

The band is driven directly by one continuous **drift phase** φ (`drift_phase`). Each leaf has a fixed rest position and a small bounded **orbit** about it, an ellipse whose amplitudes, orientation and starting phase are all decorrelated between neighbours; advancing φ walks every leaf around its own orbit. `drift_amount` scales the orbits' radius: 0 is still, small twinkles, large reorganises.

**Law:** because the orbits are bounded and share one rate, the canopy is **periodic in φ** and returns exactly to its starting configuration each cycle, 2π. This is the remembered "the gaps change, then go back to what they were".

**Law:** the driver must be continuous. φ and φ + ε differ infinitesimally, so the eye reads a morph, never a cut. Any control that instead reshuffles a set, most obviously an integer leaf count, steps discontinuously and reads as a jump cut.

The phase is moved by hand, or advanced at a constant rate (`drift_auto`, `drift_speed`). It interpolates the short way round in a transition.

## Density sets the regime

Whether independent leaf motion **restructures** the gaps or merely **twinkles** them is set by foliage density, and density is a first-class knob of the motion.

- **Low density**, the early-spring condition, sparse and immature leaves: individual leaves still matter. Moving one opens or closes a real gap, and the caustic-like reorganisation is possible. **Law: low density is the enabling condition for the second motion.**
- **High density**, the summer canopy: every gap is backed by ten more leaves. The topology is saturated, and the same flutter barely changes the cast; it only twinkles.

Density is a count, and a count is a poor axis to sweep. The canopy keeps it continuous: each clump draws from its own stable stream, so one knob never reshuffles unrelated clumps, and the fractional marginal leaf fades in by coverage, so crossing an integer is continuous rather than a pop ([`canopy.md`](canopy.md); [`season.md`](season.md) runs the same fade the other way when a leaf lets go). These smooth the parameter space, not the physics. The reorganisation itself is the drift phase, not density.

## What motion hands the cast

Motion ends where the bake begins. It hands [`canopy.md`](canopy.md) and [`transport.md`](transport.md) four things, and nothing else:

- **positions**: each leaf's place after its twig swing, limb swing, drift orbit and the trunk's sway;
- **orientations**: each leaf's plan angle rotated by its limb and twig bends, and its tilt from the rock, which foreshortens its stamp;
- **heights**, on the faithful path: each leaf's and each wood segment's height foreshortened by its limb's pitch;
- **the coherent drift, scaled by height.**

The last differs between the two cast paths. On the faithful path the sway **scales with real height**, from zero at the ground to full at the crown, for leaves and wood alike, so the tree bends as one piece anchored at its foot rather than sliding bodily. On the layer path each depth layer moves as a rigid plan translation by the sway times `1 + sway_height_gain·(h_L/base − 1)`: higher layers ride longer levers, and at `sway_height_gain` 0 the coherent drift is pure translation. Wood stamped into a layer takes its layer's factor, so a twig and its leaves move together.

Motion continues through every transition; how each route carries the springs across is [`transitions.md`](transitions.md)'s.

## The unifying mapping

The motions on the ground are one structure seen at several timescales, mapped onto the levels of the hierarchy.

| Motion seen on the ground | Hierarchy level | Timescale |
|---|---|---|
| The wind **strengthens, calms and veers** | weather, modulating the whole coherent band | very slow (minutes) |
| The pattern **translates** intact | the trunk and major limbs sway together | slow |
| Gaps **morph and rearrange**, then recover | twigs flex differently from one another | medium |
| The pattern **glistens** | each leaf trembles on its petiole | fast |

The bands coexist and sum, and the coherent band is itself broadband, a fractal spread of rates under a drifting weather. On the spring afternoon a gentle directional breeze and a fine all-directions shimmer were both present, in shifting proportion, moment to moment. **That proportion, the wind's character (pattern and gustiness), and the foliage density are most of the expressive surface of the whole piece.**

## Approximations and limits

- **Approximation: the motion is plan yaw plus one limb pitch.** Branches turn about vertical axes at their joints; only the limb has a depth degree of freedom, and only on the faithful path. Twigs and finer orders do not pitch. Absent state: `sway_pitch` 0 is pure yaw.
- **Approximation: the pitch response is even.** `1 − cos θ` is even, so an upwind limb pitched *up* foreshortens its cast slightly instead of lifting it. A signed response needs each limb's rest elevation carried into the motion, since up and down only mean something relative to the elevation the limb already sits at. The upward case is the smaller effect.
- **Approximation: the layer path's twig joint is synthesised.** It stands at `stem_length` toward the trunk with a small angular spread, not at a real twig base; the layer path has no wood to borrow one from.
- **Inner leaves follow their wood.** A leaf hung back on older wood (`inner_leaves`) drops its twig's bend by its pivot weight, so it no longer slides off the limb under the medium band ([`canopy.md`](canopy.md); built 2026-11-09).
- **Approximation: the incoherent band is a periodic orbit and a one-frequency flutter, not a wind.** The drift phase reproduces the reorganisation's grammar and its exact return, and does not respond to gusts; its rate is constant. The flutter does follow the wind's strength, but on orientation only, at one rate.
- **Approximation: adaptive frame rate excludes slow drift.** While the canopy is nearly still (a deep lull, or a look whose only motion is slow drift) the heavy bake and transport run at a reduced idle cadence and the frames between re-present the last one; full rate returns the instant the springs move. The signal that decides it is the springs' sway and velocity, not the drift phase, so the slow shimmer of a drift-only look **visibly steps** at the idle cadence. That is a known cost to the glisten, paid for a large power saving; it is on by default (`adaptive_motion`) and off restores rendering every frame. See [`../exploration/directions.md`](../exploration/directions.md).
- **Open:** how the two wind bands are finally authored: noise type, spatial correlation length, temporal spectra.
- **Open:** the shape of the stiffening and the damping ratio that make the backlash read right.

## Not built

Detail and status in [`../exploration/open.md`](../exploration/open.md).

- **The incoherent wind field**: a real per-leaf forcing with its own strength, spatial correlation length and flutter spectrum, driven by the gusts. **Building it gives up a law:** a canopy kicked by a wind is no longer periodic in the drift phase and no longer returns to the same arrangement each cycle; it returns only to rest, when the wind dies. Whether the exact return is kept (the band rides on top of the orbit and the return is only of the orbit) or retired is José's call. Prototyped 2026-11-09 (`test-gl/out/review/2026-11-09-item16-incoherent-band`).
- **A signed pitch response**, from each limb's rest elevation.
- **An articulated depth lean of the whole skeleton**: every branch order pitching, not only the limb.
- **Per-pattern generators**: promoting a wind pattern from a bundle of shared parameters to a forcing function of its own, behind the same name.
- **Litter that moves**: the carpet does not skitter in a gust; that is a choice recorded in [`season.md`](season.md).

## Related

- [`overview.md`](overview.md): where motion sits in the causal spine.
- [`canopy.md`](canopy.md): the grown joints, the stamp that foreshortens with tilt, density and inner leaves.
- [`transport.md`](transport.md): how the moved canopy is cast.
- [`season.md`](season.md): the season's authored wind direction, which carries the litter.
- [`transitions.md`](transitions.md): how the wind and springs carry through a change of look.
- [`../contracts/determinism.md`](../contracts/determinism.md): the noise of time and no sampling randomness.
- [`../contracts/continuity.md`](../contracts/continuity.md): calm as a contract; continuous drivers.
- [`../contracts/preservation.md`](../contracts/preservation.md): what the off states owe.
- [`../evidence/dead-ends.md#motion`](../evidence/dead-ends.md#motion): translation springs, the centroid pivot, nearest-limb binding, the uniform limb angle, the single gust frequency, and the faithful cast that bought registration with stillness.
- [`../evidence/measurements.md#motion`](../evidence/measurements.md#motion): the gust-edge asymmetry and the inner-leaf slip.
- [`../experience.md`](../experience.md): the breeze, the backlash, the caustics and the glisten this account serves.
- [`../implementation.md`](../implementation.md): where the springs, the forcing and the joint rotation live.
