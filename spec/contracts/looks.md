# Looks

*The shipped looks and their recorded intent: what each is for, and which departures from physics it chooses on purpose.*

A shipped look is an authored expression. This file is where an intended departure is told from a defect. A departure recorded here is **Authored**: a change that "fixes" it is a change to the look and is reviewed under [`preservation.md` §3](preservation.md#3-a-change-that-moves-a-shipped-look-is-reviewed-before-it-ships). A departure not recorded here has no protection as intent, and a defect is never protected by being old. When the artist accepts a change to a look, its entry is updated here.

Intent is the artist's words, his choices on review sheets and the notes written beside each look when it was authored. Where nothing is recorded, the entry says so; nothing is inferred from the parameters alone.

## How to read an entry

- **Camera and mode.** *Floor, layered* is the endless park: a canopy overhead, cast through depth layers, the floor seen from above. *Floor, standing, faithful* is a finite grove standing in the scene, casting its real geometry and its whole shadow across a lit floor. *Sky view* looks up through the grove. *Cloth* is the standing curtain lit from behind. *Enclosure* is the tent seen from inside.
- **Gates.** The gated features the look opens beyond the defaults. Wood means `branch_tau` > 0. The fall tiers are those of [`gates-and-rungs.md`](gates-and-rungs.md#the-feature-registry-what-a-bundle-may-cut).
- **Experimental.** A look marked experimental ships with the source but is hidden in the editor behind its toggle and left out of the general player bundle.

## Roles some looks carry

- **The editor's default:** `afternoon 7`; the live session enables the runtime governor. It is the look the editor boots into and falls back to.
- **The welcome:** `afternoon 6`, shown faint behind the welcome screen and behind the about page.
- **The season macro's stops:** spring → summer → fall runs `memories` → `morning 1` → `afternoon 4` → the last green day (no look) → `montebello`. Its fall pigment capacities are `montebello`'s.
- **The homepage embed:** `morning 2` → `afternoon 5b` → `morning 3`, cycled with transitions.
- **The look that opens every fall tier:** `montebello` (also `montebello, rain` and `cherry blossom`). It is why the general player carries all six, which the artist accepted.

**Machine tuning.** Standard sample/texture requests and inherited fidelity defaults are omitted from built-ins. Exceptional sample requests and explicitly chosen bake sizes remain, including the sky looks whose silhouettes need their recorded bake resolution. Layer counts and all scene parameters remain authored. Old saved local looks and remote versions are not rewritten.

## Gates no shipped look opens

The authored look data opens neither `vignette` (the projector's iris), `edge_area` (the texel read as a mixture), an outline (`leaf_shape` other than the ellipse), `leaf_variety` or `inner_leaves`.

**Open.** For each of these, the look's off state is the older behaviour. Under [`preservation.md` §4](preservation.md#4-a-retained-older-behaviour-needs-a-named-purpose) an older behaviour kept on a shipped look needs a named purpose, and none is recorded per look. The iris is a presentation device for the projector and belongs to a showing, not to a look. The area-correct texel and the full crown are corrections to the model's causes; the edge law is selected by presentation ([sessions](sessions.md#presentation)); the full crown remains an artistic decision.

## The cosine law

On 2026-11-09 the artist judged every look that has a receiver against the cosine law ([`../model/light.md`](../model/light.md)) on one sheet: each as shipped, with the law at its old exposure, and with the law and its exposure re-sat to `exposure / I` (the sheet is `test-gl/out/review/2026-11-09-item2a-sun-cosine`).

- **Carry the law, exposure re-sat:** `afternoon 4`, `afternoon 4b`, `afternoon 5`, `afternoon 6`, `afternoon 6b`, `afternoon 7`, `forest floor` (under an 84.5° sun the law moves them by less than a level), `park 1`, `montebello`, `park fall`, `the yellow tree`, `montebello, rain`, `cherry blossom`, `acid dreams`, `curtain 1`, `curtain 2`, `tent 1`.
- **Keep the old law:** `eclipse`, `morning 1`, `morning 2`, `morning 3`, `morning 3b`, `memories`, `the void`, `afternoon 5b`, `prism`, `park 2`. **Authored:** the artist preferred their original contrast to the law's ("i preferred the original look"); this is the purpose [`preservation.md` §4](preservation.md#4-a-retained-older-behaviour-needs-a-named-purpose) asks of a retained older behaviour. Under a low sun the law brings the shade and the sky up against the dapples, and these looks keep their dapples' hold over the shade.
- The sky views are not on the sheet: the law gives the seen sky 1.

## The air's loss

On 2026-11-09 the artist judged the air's loss ([`../model/light.md`](../model/light.md#the-airs-loss)) on two sun sweeps, a sunset and the looks under the lowest suns (`test-gl/out/review/2026-11-09-item5-air-loss`). He liked it on the floor between 12° and 26°, on both curtains with their exposure held, and on `montebello` with its exposure re-sat; he disliked it at 6°, where the floor turns to mud, on `morning 2` either way, and on the curtains with their exposure re-sat.

- **Carry the loss, exposure held:** `curtain 1`, `curtain 2`. Their evening gets darker and warmer.
- **Carry the loss, exposure re-sat by it:** `montebello` (exposure 7.116, `2.44 / (sin 26° × 0.782)`).
- **Every other look:** the loss is off. Nothing is recorded as a departure; the looks were not each judged against it beyond the sheet.

## Exposure under cloud

Every shipped look carries `cloud_exposure` 1, with its exposure re-sat to exposure / (1 + its own `cloud_thickness`): it shows as it always did at its own cloud, and a thicker cloud, from a transition, the weather macro or the editor, opens the exposure up instead of only blurring the dapples. A look saved without the key keeps exposure fixed.

## The floor, layered

### afternoon 4
- **Camera and mode:** floor, layered.
- **For:** recorded as the windy predecessor, now a three-tree grove with wider branching. A stop on the season macro (summer).
- **Authored departures:** none recorded.
- **Gates:** `sun_cosine`, exposure re-sat ([the cosine law](#the-cosine-law)).

### afternoon 4b
- **Camera and mode:** floor, layered.
- **For:** `afternoon 4` under haze: a turbid sky, lower exposure, a touch more contrast.
- **Authored departures:** none recorded.
- **Gates:** `sun_cosine`, exposure re-sat ([the cosine law](#the-cosine-law)).

### afternoon 5
- **Camera and mode:** floor, layered.
- **For:** a calm, near-overhead spring scene, a three-tree grove. `afternoon 4 → 5` differs only in branch angle and morphs its branches with no bloom.
- **Authored departures:** a warm Mount-Royal dirt floor, so the deep shade reads as dark earth and only the hottest dapples burn back toward white.
- **Gates:** `sun_cosine`, exposure re-sat ([the cosine law](#the-cosine-law)).

### afternoon 5b
- **Camera and mode:** floor, layered.
- **For:** `afternoon 5` with a low sun swung round to the west. One of the homepage embed's three.
- **Authored departures:** The old receiver law, without the cosine: the artist kept its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** none.

### prism
- **Camera and mode:** floor, layered.
- **For:** `afternoon 5b`'s low west sun surfacing leaf-edge diffraction: red and blue split at every dapple edge. A set piece. Same topology as `afternoon 5b`, so the pair is a clean live morph.
- **Authored departures:** diffraction is exaggerated far above its true, hairline strength. The model calls this knob honestly exaggerated, the way the Purkinje shift is real but amplified; see [`../model/light.md`](../model/light.md). It keeps the old receiver law, without the cosine, for its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** `chromatic_aberration`.

### afternoon 6
- **Camera and mode:** floor, layered.
- **For:** the welcome's look. `afternoon 5 → 6` grows its extra trees in as a continuous tree count rather than a bloom: five trees since 2026-11-09 (José: "i don't think more trees were meant, but i don't hate it"), four before. Its own intent is otherwise not recorded.
- **Authored departures:** none recorded.
- **Gates:** `sun_cosine`, exposure re-sat ([the cosine law](#the-cosine-law)).

### afternoon 6b
- **Camera and mode:** floor, layered.
- **For:** `afternoon 6` with steeper leaf tilt, for more footprint foreshortening.
- **Authored departures:** none recorded.
- **Gates:** `sun_cosine`, exposure re-sat ([the cosine law](#the-cosine-law)).

### afternoon 7
- **Camera and mode:** floor, layered.
- **For:** the editor's default look, played under the session's FPS policy. What it is for beyond that is not recorded.
- **Authored departures:** the warm Mount-Royal dirt floor.
- **Gates:** `sun_cosine`, exposure re-sat ([the cosine law](#the-cosine-law)).

### forest floor
- **Camera and mode:** floor, layered.
- **For:** a working name; the artist has not named it. `afternoon 7` at full fall, the view from under the canopy: a dark crown shadow with warm dapples and green flecks filling the frame, the carpet laid damp beneath it. The "komorebi on the ground" half of his valley memory. Built from what he kept choosing on `afternoon 7` in fall: wet litter, the litter colour, the trees differing in pigment and by a hair in their clock. Each leaf lets go the moment its own turn ends, so the sunlit leaves are down and the buried interior stays green. Sun, camera and grove are `afternoon 7`'s.
- **Authored departures:** the warm dirt floor. The sky fill and the leaf's diffuse share stay shut, as on `afternoon 7`.
- **Gates:** `litter`, `leaf_drop`, `drop_after_turn` with no lag. Fall tiers: pigment, exposure, drop, litter. Also `sun_cosine`, with exposure re-sat ([the cosine law](#the-cosine-law)).

### memories
- **Camera and mode:** floor, layered.
- **For:** the north-star look of the founding afternoon in [`../experience.md`](../experience.md): a sparse early-spring grove, so individual leaves still matter, a clear sky, open branching, bright exposure. The spring stop of the season macro.
- **Authored departures:** none recorded. Its `phenology` is a stamp for the season macro to read, and sits below the turn, where nothing reads it. It keeps the old receiver law, without the cosine, for its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** none.

### morning 1
- **Camera and mode:** floor, layered.
- **For:** not recorded. A stop on the season macro (late spring); its `phenology` is a stamp below the turn, like `memories`'.
- **Authored departures:** a trace of leaf-edge diffraction; why is not recorded. It keeps the old receiver law, without the cosine, for its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** `chromatic_aberration` (slight).

### morning 2
- **Camera and mode:** floor, layered.
- **For:** not recorded. One of the homepage embed's three; its humid haze is the one `montebello, rain` borrows.
- **Authored departures:** The old receiver law, without the cosine: the artist kept its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** none.

### morning 3
- **Camera and mode:** floor, layered.
- **For:** recorded only as a crisp, clear-sky low sun with tight pinhole sun-images. One of the homepage embed's three.
- **Authored departures:** The old receiver law, without the cosine: the artist kept its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** none.

### morning 3b
- **Camera and mode:** floor, layered.
- **For:** `morning 3` pushed hard into diffraction: the tight pinhole sun-images split into full red and blue rims. Same topology, so the pair is a clean morph.
- **Authored departures:** diffraction exaggerated well beyond `prism`'s. It keeps the old receiver law, without the cosine, for its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** `chromatic_aberration`.

### the void
- **Camera and mode:** floor, layered. Experimental.
- **For:** a dense sixteen-tree grove pulled wide, deep green, low sun. Why it is experimental is not recorded.
- **Authored departures:** a cool stone-grey floor. It keeps the old receiver law, without the cosine, for its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** none.
- **Open, needs José:** this grove (sixteen trees) outgrows the old 64-segment analytic occluder table, and the table has since grown to 256. Whether that repainted the look is not recorded. Its wood is shut, and the table only reaches a picture with wood open, so it should not have; José should confirm against his memory of the look.

### eclipse
- **Camera and mode:** floor, layered.
- **For:** a set piece: a single tree's gaps imaging a partially eclipsed sun, so every dapple becomes the same crescent. A tiny crisp source, low far smear and dim ambient keep the crescents sharp and eerie; only a barely-there wind stirs it, with automatic drift off.
- **Authored departures:** the warm dirt floor. The eclipse dims the day by the share the moon covers, as a real one does (since 2026-11-10; the crescents had kept the clear sun's total). The exposure is the one it had, so it reads darker than before; the renormalised version is a comment at the sampler away. The eclipse's shape is a source property; see [`../model/source.md`](../model/source.md). It keeps the old receiver law, without the cosine, for its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** `eclipse`.

### acid dreams
- **Camera and mode:** floor, layered.
- **For:** not recorded.
- **Authored departures:** not recorded. It is authored with a fractional tree count (one tree and a partly faded-in second), the palm species, strong diffraction and a violet-grey floor; whether each is intent is not recorded.
- **Gates:** `chromatic_aberration` (3.6, between `prism` and `morning 3b`), `sun_cosine` with exposure re-sat ([the cosine law](#the-cosine-law)).

## The floor, standing

### park 1
- **Camera and mode:** floor, standing, faithful. Formerly named `afternoon 8`.
- **For:** the first standing-scene look: the tree stands in the scene and its whole shadow, trunk streak to branches to crown dapples, is thrown across a lit floor, not an infinite canopy hovering overhead. A wide view over a small grove leaves the grove a finite blob with lit floor around it. The faithful path is the heaviest; runtime quality policy belongs to the showing.
- **Authored departures:** the warm dirt floor.
- **Gates:** `faithful_canopy`, `standing_scene`, wood, `sun_cosine` with exposure re-sat ([the cosine law](#the-cosine-law)).

### park 2
- **Camera and mode:** floor, standing, faithful.
- **For:** not recorded. It is a partner on two travel routes: `cherry blossom ↔ park 2` (leaves carried between floor and canopy on one grove) and the regrouping journey from `fall memories`.
- **Authored departures:** the warm dirt floor. It keeps the old receiver law, without the cosine, for its original contrast ([the cosine law](#the-cosine-law)).
- **Gates:** `faithful_canopy`, `standing_scene`, wood.

### montebello
- **Camera and mode:** floor, standing, faithful.
- **For:** the first fall look. `park 1`'s grove and seed, seen from the far side with the sun behind the viewer, late in the season, the shadows running away from us. The artist named it after the dry river valley at Dhamma Suttama, Montebello QC, where he sat under the turning trees in early fall 2026, and chose its recipe frame by frame from the review sheets: the exposed leaves turned first, a maple's sieve, soft pigments (he turned down the stronger "redhead" red) with a little tannin for russet among the red, the leaves a blend of glass, the shade lit through the canopy, the sunlit leaves dropped after turning and lying as a carpet round the trees' feet, damp from a rain day. Exposure is `park 1`'s own. The fall stops of the season macro are lifted from it.
- **Authored departures:** the dirt is `park 1`'s at ×0.6, chosen from the review sheets: real soil reflects 0.1–0.2, and on `park 1`'s dirt the honest carpet vanished into the ground. The ground stays dry under wet leaves, which a real rain day would not do; the dirt is lowered by hand until the rain is built to write both. The carpet's reflectance constant is a judgement awaiting a grey-card measurement (**Provisional**; see [`../model/season.md`](../model/season.md)).
- **Gates:** `faithful_canopy`, `standing_scene`, wood, `canopy_fill`, `leaf_diffuse` (0.5, the blend of glass), `leaf_drop`, `drop_after_turn` (the artist: "yes turn it on for both"), `litter`. All six fall tiers. Each tree its own colour and clock: `tree_pigment_spread` 0.6, `tree_clock_spread` 0.05 (José, 2026-11-09: "each tree is unique"); the default lag, 0.09. Also `sun_cosine`, with exposure re-sat ([the cosine law](#the-cosine-law)). The air's loss, exposure re-sat ([the air's loss](#the-airs-loss)).

### park fall
- **Camera and mode:** floor, standing, faithful.
- **For:** the artist's mid-turn look on `montebello`'s grove: the crown still turning, the sunlit leaves already down and damp, the park seen wide from the far side, a deep red where `montebello` is rose-russet. Each leaf lets go a short lag after its own turn ends: `drop_lag` 0.05 since 2026-11-09 (José), where it was 0 (2026-10-09, "i like p1"). Each tree its own colour and clock, as `montebello`.
- **Authored departures:** the warm dirt floor at `park 1`'s level. The sky fill and the leaf's diffuse share stay shut; why is not recorded.
- **Gates:** `faithful_canopy`, `standing_scene`, wood, `leaf_drop`, `drop_after_turn` with a lag of 0.05, `litter`. Fall tiers: pigment, exposure, drop, litter. Also `sun_cosine`, with exposure re-sat ([the cosine law](#the-cosine-law)).

### the yellow tree
- **Camera and mode:** floor, standing, faithful.
- **For:** a working name; the artist has not named it. A place memory of his: one tree at the start of the retreat all yellow, by the end half its leaves on the ground, and "so orange". The one gold look: `montebello`'s leaves and grove with pigments tipped toward orange and a beech russet, the two trees not one colour, half the leaves down (the half that turns last stays on), and the camera moved so the trunk feet sit behind the eye and the carpet stays in view (his pick from the camera sheet).
- **Authored departures:** **the stained-glass leaf.** The leaf's diffuse share is shut on purpose, so each leaf paints its colour inside its own shadow and the dapples are coloured: the artist called it the ultimate goal ("yes the dapples were coloured"). The model says a real leaf is frosted glass, not stained glass ([`../model/leaf.md`](../model/leaf.md)); this look departs from it by choice, with the sky fill still open. The dirt is `montebello`'s. The half-retained drop is the engine's provisional beech value.
- **Gates:** `faithful_canopy`, `standing_scene`, wood, `canopy_fill`, `leaf_diffuse` deliberately 0, `leaf_drop` (half), `drop_after_turn`, `litter`. Fall tiers: fill, pigment, exposure, drop, litter. Also `sun_cosine`, with exposure re-sat ([the cosine law](#the-cosine-law)).

### montebello, rain
- **Camera and mode:** floor, standing, faithful.
- **For:** a working name; the artist has not named it. `montebello` on a rain day, one of the weather variations he asked for. His memory gives the cause, "one day after rain many leaves fell on the ground": every leaf that has finished turning lets go at once. The leaves are soaked, the sky overcast from the weather macro's own stop, the haze `morning 2`'s. Everything else, the camera included, is `montebello`'s.
- **Authored departures:** wet soil at `park 1`'s dirt ×0.4, set by hand because the engine does not wet the ground. The exposure stays `montebello`'s under the haze.
- **Gates:** as `montebello` (`canopy_fill`, `leaf_diffuse` 0.5, `drop_after_turn`), with no lag after the turn; all six fall tiers. Also `sun_cosine`, with exposure re-sat ([the cosine law](#the-cosine-law)).

### cherry blossom
- **Camera and mode:** floor, standing, faithful.
- **For:** a working name, from his own words: "is that spring? i love it omg cherry blossoms". The pink is the redhead pigments, with no russet and no sieve, on the honest carpet, dry and on `park 1`'s paler dirt. Two changes answer his two objections to these pigments: the trees differ, so the crown is not too uniformly red, and the fallen leaves stay fresh rather than browned. Everything else is `montebello`'s.
- **Authored departures:** the warm dirt floor; fallen leaves held fresh by a slower browning.
- **Gates:** as `montebello` (`canopy_fill`, `leaf_diffuse` 0.5, `drop_after_turn`); all six fall tiers. Also `sun_cosine`, with exposure re-sat ([the cosine law](#the-cosine-law)).

## The sky view

The four canopies look up through a grove. Their recorded notes call every number a starting point, the geometry and species authored to a reference photograph and the light a taste call for a later pass. In this camera the analytic wood is not a shadow but the structure itself, so a look whose subject is trunks trades limbs against trees to keep every trunk within the occluder's budget ([`../model/sky-view.md`](../model/sky-view.md)).

### canopy 1
- **Camera and mode:** sky view. Experimental.
- **For:** the hammock of [`../experience.md`](../experience.md): lying back at a festival, tall trunks converging overhead, crowns lit from behind against a bright sky, the whole grove leaning together on the gusts. `park 1`'s afternoon with the eyes turned the other way. **The frame must be mostly luminous:** bright sky between the crowns, sunlit crowns glowing green-gold, silhouette only for the trunks and the deepest stacks. The wind is the soul: crowns on long levers so a gust leans the whole grove together.
- **Authored departures:** the crown's single-scatter glow is an authored gain that makes a crown a light source rather than a filter. The sun sits off-centre by design, so the picture is a canopy with a sun in it rather than a lens-flare portrait, and it clips to white, as it must. The veiling glare is kept small so it halos the sun without dragging the sky down.
- **Gates:** `sky_view`, wood, the foliage glow, the glow tier.

### canopy 2
- **Camera and mode:** sky view. Experimental.
- **For:** bamboo. Standing in a grove looking up the culms: dozens of thin pale verticals close enough to touch, running up out of frame against a brilliant sky, the leaves a thin layer far overhead. The trunks are the subject. Most of the picture is honest open sky between the culms, which is the composition.
- **Authored departures:** the gaze is pitched short of the zenith on purpose, so the culms stand parallel instead of converging like spokes.
- **Gates:** `sky_view`, wood, the foliage glow, the glow tier.

### canopy 3
- **Camera and mode:** sky view. Experimental.
- **For:** the red-pine colonnade. Walking a lane of old pines and tipping the head back: long bare boles going up like columns, the crowns only in the top third, the lane running off across the frame, with open sky down the lane as the depth cue.
- **Authored departures:** the yaw that runs the colonnade across the frame is recorded as pure composition, a taste call.
- **Gates:** `sky_view`, wood, the foliage glow, the glow tier.

### canopy 4
- **Camera and mode:** sky view. Experimental.
- **For:** the rainforest zenith. Flat on the back on the forest floor looking straight up: enormous dark trunks running in from every side and meeting overhead like spokes, dense crowns closing over them, a sky so bright and hazy it has no colour left. Everything in frame is a silhouette.
- **Authored departures:** the foliage glow is **deliberately low**, the one canopy where it is: the picture is a stencil, and the glow would drain the contrast the composition is made of. The sky is whitened by turbidity, not by exposure.
- **Gates:** `sky_view`, wood, the foliage glow (low), the glow tier.

## The cloth

### curtain 1
- **Camera and mode:** cloth, standing, faithful. Experimental.
- **For:** a moss-green velvet with the plant at the glass (since 2026-11-09, José: "i don't hate it. still feels like satin instead of velvet"; it was a sunlit sheer cotton): little light through the pile, the moss dye, deeper pleats and a soft sheen on the ridges, in a dark room: one huge window with a black surround, a faint mullion grid, and the grove nearly touching the cloth, so the cast is crisp botanical shadow-play in the near-contact regime, where leaves print as leaves and the deep fold warp S-bends them. Broad pleats; a low warm sun far off-axis, so the flanks split lit and dark. Hand-tuned by the artist, on a grove seed of its own. The bedroom curtain of [`../experience.md`](../experience.md) is sought and not yet reached.
- **Authored departures:** the near-contact grove is staged on purpose, to show both blur regimes. The velvet's texture is open: it reads as satin, from the sheen and a pile with no grain (`test-gl/out/review/2026-11-09-item18-20-cloth-texture`).
- **Gates:** `receiver` (cloth), `faithful_canopy`, `standing_scene`, wood, the mullion grid, the glow tier, `sun_cosine` with exposure re-sat ([the cosine law](#the-cosine-law)). The air's loss, exposure held ([the air's loss](#the-airs-loss)).

### curtain 2
- **Camera and mode:** cloth, standing, faithful. Experimental.
- **For:** the same room at blue hour: `curtain 1`'s grove, seed and window, so the pair live-morphs. The sun sinks low and reddens through haze; the fabric is near-white voile, because at dusk the light carries the colour; the grove steps back so both blur regimes share the frame; the glow widens into bloom and the Purkinje shift runs deep: hot gold sun-blobs floating on rod-blue dim cloth. Lazy last-light wind. Recorded as the direction's next step, every number a starting point.
- **Authored departures:** the Purkinje shift pushed deep (an amplified real effect, [`../model/light.md`](../model/light.md)).
- **Gates:** `receiver` (cloth), `faithful_canopy`, `standing_scene`, wood, the mullion grid, the glow tier, `sun_cosine` with exposure re-sat ([the cosine law](#the-cosine-law)). The air's loss, exposure held ([the air's loss](#the-airs-loss)).

## The enclosure

### tent 1
- **Camera and mode:** enclosure, standing, layered. Experimental.
- **For:** komorebi from inside a closed tent pitched under trees, lying down; the reference is a NEMO Dragonfly 2P photographed from inside. Different panels at different brightnesses because they face different ways; a small room you are inside of, not a corridor. Each side is one smooth arch of tensioned fabric on pre-bent poles, seams only at real pole lines, the far end one triangle. Thin near-white nylon with heavy forward scatter. Both blur regimes come from the tree's own depth spread rather than an authored near occluder. Every number is recorded as a starting point.
- **Authored departures:** none recorded beyond the reference's geometry. No window and no mullion grid; both are curtain-only. A fine grain on the nylon (`fabric_nap` 0.04): radial lines toward the far end, vertical ones on the lit end wall. The mesh panels' throughput is authored and kept (José, 2026-11-09: "i like the tent mesh, keep it").
- **Gates:** `receiver` (enclosure), `standing_scene`, wood, the glow tier, `sun_cosine` with exposure re-sat ([the cosine law](#the-cosine-law)).

## Looks named elsewhere that are not built in

The model and evidence mention looks that are not in the built-in set: `fall memories`, `look up`, `purple eye`, `ultraviolet`, `green 2` and `cherry green`. They are the artist's own looks, kept in arboretum or as fixtures for the travel routes (`fall memories ↔ park 2`, `fall memories ↔ look up`, `purple eye ↔ look up`) and the projector routes. `ultraviolet` is named as his maple look, and a "projector look" (maple, aspect 1.75) is named in the same passage; whether they are one look is not recorded. Their intent is not recorded here; an entry is added when one ships.

## Related

- [`preservation.md`](preservation.md): what a change to a look owes, and why a look's recorded intent is its standard.
- [`gates-and-rungs.md`](gates-and-rungs.md): the gates and tiers named above.
- [`transitions.md`](transitions.md): the routes between these looks.
- [`../experience.md`](../experience.md): the places these looks serve.
- [`../evidence/observations.md`](../evidence/observations.md): what José lived, which the looks draw on.
