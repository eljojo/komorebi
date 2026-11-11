# Transition contracts

*Each route between looks: which pairs it joins, the gate that admits a pair, how long it takes, what it promises, and what holds it.*

The model of these routes is [`../model/transitions.md`](../model/transitions.md). The parameter classes that decide between them (MORPH, CANOPY, SEASON, TOPO, MODE) are [`gates-and-rungs.md`](gates-and-rungs.md). Every route is entered through one engine call, given the target look, the driver's duration *D* and, optionally, the driver's style (`fade`, or `morph`, the same as none); a look never stores a duration or a style. A route's gate below is the gate when no fade is asked for; a fade asked for takes the scene dissolve for any pair but a live morph's. **Why it matters:** a transition that cuts, pops or floods breaks the calm the piece exists to hold, and a gate that admits a pair it cannot honour produces exactly that.

The checks that hold each route are listed in [`../implementation.md`](../implementation.md#the-crosswalk). A route's gate is every condition listed; a pair that fails any of them takes the next route that admits it, ending at the cloud dissolve. "Budget" means the live-morph leaf-count budget, measured at the busier end.

## Live morph

| | |
|---|---|
| **Joins** | Any pair differing only in MORPH keys (sun, exposure, cloud, wind, grade, layer heights, camera) and runtime flags. |
| **Gate** | No CANOPY, TOPO or MODE difference. |
| **Duration** | *D*, ease-in-out. |
| **Promises** | No bloom. Angles take the short way. Wood present at one end only fades out over the first half or in over the second, zero at the midpoint; the woodless end never casts the other's skeleton. A faithful cast re-casts every frame its sun or inputs move, even in still air. Runtime flags settle at the end and never trigger a heavier route. Between two looks on one receiver, the dapples move straight from one end's level to the other's whatever the cosine law does; only the shade and the sky follow exposure. |

## Gate crossings (within any morph)

| | |
|---|---|
| **Joins** | A pair where a gate parameter is zero at one end: window aperture width or height; `leaf_diffuse` with an active scatter proxy at the zero end; vignette feather. A pair where `eclipse` differs, on any route but the scene dissolve: `morning 3b → eclipse`, `eclipse → acid dreams`. |
| **Gate** | The crossing itself. Not applied inside a full scene dissolve (each scene keeps its own mask). |
| **Duration** | Aperture: the morph. Diffuse proxy: out over the first half, in over the second. Iris: its opacity, on the route's eased progress across the whole route. Moon: the route's eased progress, four fifths of its path on the visible bite. |
| **Promises** | The enabled end's geometry is kept and its restriction faded; no pinhole or ellipse grows from zero. The eclipse is held on and the moon moves between the authored bite and clear of every sample, continuous while the radii tween; its limb is soft only while it moves, so a settled eclipse is the hard crescent unchanged. Authored values land exactly. No hood boundary moves: a hood turning on or off keeps the hooded end's feather and shape and fades; two hooded ends morph them at full strength. An interrupted hood fade carries its opacity, an interrupted moon its place and limb. No saved parameter. |

## Grove morph (incl. re-season, density)

| | |
|---|---|
| **Joins** | Same branching, different canopy shape or colour: `afternoon 5 → 6` (tree count), `afternoon 4 → 5` (branch angle). |
| **Gate** | CANOPY keys differ; no TOPO or MODE key differs (seed, branch levels and children, limb count, layer count equal); peak leaf count within budget. **Re-season:** every differing canopy key is a SEASON key. **Density:** only density and season keys differ, neither end senescing, no leaf drop, no leaf variety, identical structure otherwise. |
| **Duration** | *D*. |
| **Promises** | No bloom. The same grove deforms; leaves keep identity by address. Tree count is continuous: only the last tree grows or fades, the others keep their structure. The springs' common prefix carries across each regrow; a new tree starts at rest. Re-seasoning lands on exactly the resting grove, so nothing regrows on landing. A density reversal reuses or grows a sufficient capacity once. |

## Shared-layer crossfade

| | |
|---|---|
| **Joins** | A topology change between two layer groves, layer counts included: `morning 1 ↔ memories`, `morning 3b → eclipse`, `eclipse → acid dreams`; a same-branching grove over budget: `morning 3b ↔ the void`. |
| **Gate** | A TOPO difference, or a CANOPY difference over budget, and no MODE difference; not admitted as a grove morph; neither end faithful; no wood at either end; same texture size and bake size (one set of layer textures). |
| **Duration** | 2*D*. |
| **Promises** | No bloom: cloud thickness follows its ordinary interpolation and never overshoots either end. Both groves are baked at complementary coverage across a window around the midpoint; no leaf jumps. The incoming grove is the target's own, cut with its own leaf edge. Across layer counts the route runs at the larger count, the heights move from each end's own, and the count drops only at landing. Native endpoints. Interruption inside the double-bake window is safe; an interruption outside it starts from the shown heights, moon and grove. |

## Cloud dissolve

| | |
|---|---|
| **Joins** | Whatever no other route admits: branching changes and groves over budget outside the crossfade's gate (wood, a faithful end, different layer texture sizes), mode changes no travel or fade route joins (a change of receiver among them). |
| **Gate** | None; the last resort. |
| **Duration** | 2*D*. |
| **Promises** | The scene swaps once at the midpoint under a bloom capped short of overcast: shallower for a mode change, deeper for a topology change. A mode change runs its full rebuild under the bloom, never a flag over stale buffers. |

## Fade through the lit ground

| | |
|---|---|
| **Joins** | Floor-to-floor mode changes over bare ground: `afternoon 7 ↔ park 1`. |
| **Gate** | A MODE difference; neither end a sky view; floor receiver at both ends; no litter carpet (litter and leaf drop both above zero) at either end; no travel route admits the pair. |
| **Duration** | 2*D*.|
| **Promises** | No bloom, no second scene. Shadows ease out to the midpoint and back in, in linear irradiance before material and tone map. Wind continues. Standing → overhead sets the final camera at the invisible midpoint. Interruption starts from the current shadow opacity. |

## Scene dissolve

| | |
|---|---|
| **Joins** | Faithful structural changes no travel route takes: `park 1` to itself with a new seed, density and tone; `curtain 1` to itself with a new seed and outline. Carpeted floor-to-floor mode changes: `park fall ↔ forest floor`, `forest floor ↔ the yellow tree`. Any pair a driver asks to fade that differs in more than MORPH keys and runtime flags. |
| **Gate** | Either: both ends faithful, same scene modes, a structural rebuild needed; or the fade through the lit ground's gate with a litter carpet at either end, from rest. In both, no travel route (season travel, grove regrouping, leaf travel) admits the pair. Or: a fade asked for, from rest, and a CANOPY, TOPO or MODE difference; no travel route, morph, crossfade or bloom is considered. |
| **Duration** | 2*D*, mixed on a full-duration smoothstep. |
| **Promises** | No bloom. Two complete moving scenes, one clock, mixed in linear light, each with its own tone map and mask. The incoming scene continues without rebuild or reset. A fade requested during a transition waits for it to finish; a later selection replaces the waiting request. When an automatic route interrupts a dissolve, it starts from the displayed mixture and releases the older scene. |

## Viewpoint (sky ↔ floor)

| | |
|---|---|
| **Joins** | A sky look and a floor look over one grove. |
| **Gate** | Neither end faithful; floor receiver at both ends; wood, canopy fill and litter off; every non-camera parameter identical (seed, branching, leaf geometry, light, grade, wind); zoom may differ only for a standing grove; each endpoint's view within its own hemisphere. |
| **Duration** | 2*D*. |
| **Promises** | No bloom, no second scene, no midpoint rebuild. Eye and elevation move continuously through the horizon; authored pan, yaw, field of view and zoom kept at both ends. Drift continues through landing. Interruption starts from the displayed eye and gaze. Landing restores exact target params and rebuilds its buffers once. A bundle keeps this camera only when it keeps both sky and floor. |

## Leaf travel (overhead faithful ↔ layer, and between faithful groves)

| | |
|---|---|
| **Joins** | The same overhead scene in its faithful and its layer cast; two overhead faithful groves that differ structurally (`cherry green → green 2`, `green 2 → ultraviolet`). |
| **Gate** | A cast-mode change, or both ends faithful with a TOPO key differing or a canopy change over the grove-morph budget; floor receiver and overhead scene unchanged; wood, canopy fill, litter, leaf drop and inner leaves off at both ends; eclipse and edge-area modes agree; positive leaf sizes; nonempty groves; correspondence within budget. |
| **Duration** | 2*D*. |
| **Promises** | Every endpoint leaf occurs once; surplus contracts to zero area, new leaves grow from zero. Each end keeps its native motion until the shared cast. Each native cast is reached exactly through a smooth handoff at its own end, keeping its authored diffuse value. No clear-floor interval, no bloom, no midpoint swap. Between two faithful groves the travel goes patch by patch (authored): each carrier's own clock is at 0 through the first handoff and at 1 through the last and never runs backward on a forward route; leaves pair within half-patch floor cells; each handoff shows its own look's grade exactly, and between them every pixel is a mix of the two looks' finished pictures. A reversal retraces the same carriers on the same clocks. The faithful ↔ layer route keeps the single progress. |

## Season travel (shared standing grove)

| | |
|---|---|
| **Joins** | `cherry blossom ↔ park 2`, `montebello ↔ park fall`, `montebello, rain ↔ cherry blossom`. |
| **Gate** | Both ends faithful standing scenes on the floor receiver; same tree and leaf geometry, seed, sun angles, core and eclipse settings, wind, grade and other art; leaf variety off; whole leaf population within budget; litter and abscission armed at one end and off at the other, or armed at both. Only these may differ: season keys, drop-after-turn, carpet age, drift and wetness, ground albedo, canopy fill, leaf diffusion, cloud thickness, halo radius, turbidity, the cosine law, the air's loss and exposure, camera, drift phase, sample count, bake resolution, runtime and debug settings. |
| **Duration** | 2*D*. |
| **Promises** | One grove, every leaf by its original twig and slot. A leaf in both carpets stays at height zero. Camera interpolated in eye space, shortest yaw arc. Native casts reached through a smooth handoff at each end; the zero-diffusion edge met continuously. Cast budgets are the larger end's, scaled by the governor: differing quality is a handoff, not a landing pop. The dapples move straight across the cosine law (as in the live morph). Reversal keeps q, identities, wind, manual drift, soil, wetness and weather. Springs keep residual motion at preparation and landing. |

## Litter rise and fall (carpet ↔ sky)

| | |
|---|---|
| **Joins** | `fall memories → look up` (rise), `look up → fall memories` (fall). |
| **Gate** | Checked in floor-to-sky order both ways. Floor end: faithful standing scene with actual litter and abscission. Sky end: layer standing scene, litter, abscission and wood off. Both: floor receiver, three layers, same seed; leaf variety, inner leaves, leaf diffusion and sun-incidence scaling off; leaf sizes positive and at most 0.2 m; correspondence within budget; each view within its own hemisphere; the sky's lowest canopy plane above the floor eye. May differ: canopy geometry, season, camera, sun angles, core radius, turbidity, canopy fill, litter material, runtime and quality. All other art and wind match. Fall: an empty actual carpet declines before commit. Bundles: needs the litter and drop tiers and the shared flight camera. |
| **Duration** | 2*D*. |
| **Promises** | One leaf field crosses the horizon; no midpoint rebuild, bloom or picture dissolve. A leaf changes from ground-lit to canopy material before it crosses the horizon. The native sky takes over through a handoff that completes before landing. Wind never reverses; both clocks advance once per frame; drift continues; adaptive rendering resumes from landing. The fall installs the floor once at q=0 with its motion copied. Resize and cancellation are safe. |

## Shadow rise and fall (footprints ↔ sky)

| | |
|---|---|
| **Joins** | `purple eye → look up` (rise), `look up → purple eye` (fall). |
| **Gate** | Checked in floor-to-sky order both ways. Floor end: faithful, non-standing floor scene, leaf diffusion below 1. Sky end: layer standing sky scene, three layers, zero leaf diffusion. Both: floor receiver; no wood, canopy fill, litter, abscission, inner leaves, sun-incidence scaling or edge-area mixture; eclipse mode agrees; leaf sizes positive and at most 0.2 m; nonempty populations within budget; each view within its own hemisphere. Seeds, branching, outlines, variety, colours, grade and wind may differ. Bundles keep the flight camera when sky and floor are both kept, even with every seasonal tier cut. |
| **Duration** | 2*D*. |
| **Promises** | Optical depth moves from ground cast to filters early in the flight, never doubled. Tone responses interpolate on shared irradiance, the glow included. The native sky takes over before landing. No midpoint rebuild or bloom; zero-time redraw advances nothing. The fall keeps the sky grove as the engine until it installs the floor once at landing with its motion copied; an empty floor grove declines before commit. Queue, resize, cancellation and recovery as the litter flight. |

## Grove regrouping (different standing groves)

| | |
|---|---|
| **Joins** | `fall memoriez ↔ park 2`. |
| **Gate** | Both ends faithful standing floor scenes, floor receiver. Carpet end: three layers, litter and abscission, at most five integer trees. Canopy end: four layers, no litter, abscission or canopy fill, at most two integer trees. Carpet end has at least as many trees and leaf slots per twig. Seed, branch levels and children, limb count, tone map, eclipse mode and leader presence agree. Wood and positive leaf sizes at both ends; inner leaves, outline variety, leaf diffusion, edge-area mixture, pitch sway and sun-incidence scaling off. Full carrier population within budget; its twig table fits the device's texture width untruncated. An empty actual carpet declines at preparation. Cutting the litter or drop tier removes the route. |
| **Duration** | 2*D*. |
| **Promises** | Injective root assignment; every destination leaf one primary carrier; surplus area and wood radius contract to zero. Leaves are picked up in a staggered order that follows their identity. Native casts are reached through a smooth handoff at each end. Both winds advance once per moving frame regardless of direction; zero-time redraw advances nothing. Landing installs the end once with motion, joints and velocities; only the common spring prefix when counts differ. Reversal keeps carriers and q. Adaptive rendering resumes from landing. |

## What every route promises

- **No cut, no pop, no flood.** Leaves appear and leave through area or coverage; gates are crossed by fading; the only bloom is the cloud dissolve's, capped short of overcast.
- **The clocks keep running.** Wind and automatic drift continue through every route and are never reset; a zero-time redraw advances nothing.
- **Native endpoints are exact.** A route lands on the target's own parameters and render path, keeping only the running wind and drift.
- **Reversal.** Where a route reverses (leaf, season and grove travel), selecting its origin mid-flight keeps the carriers, the displayed progress, the tone response and both winds, and restores the outgoing motion on landing. Morphs and fades reverse from their displayed state.
- **The latest selection waits.** An unrelated selection during a travel route waits for its settled frame; only the most recent waiting one survives, and a superseded one's completion never fires.
- **Interruption starts from what is shown.**
- **Cleanup.** Completion, hard replacement, disposal and context loss release every temporary scene, buffer, program and texture. A restored context lands on the requested target, a waiting selection included.
- **No look learns.** No route adds a saved parameter; settled looks keep their native render paths.

## Related

- [`../model/transitions.md`](../model/transitions.md): the routes as a model.
- [`gates-and-rungs.md`](gates-and-rungs.md): the key classes and the feature registry a bundle cuts by.
- [`continuity.md`](continuity.md): calm as a contract.
- [`preservation.md`](preservation.md): what a feature's off state owes.
- [`../evidence/measurements.md#transitions`](../evidence/measurements.md#transitions): the bloom, churn and dissolve measurements.
