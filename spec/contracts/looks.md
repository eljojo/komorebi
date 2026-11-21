# Looks

*The shipped looks and their recorded intent: what each is for, and which departures from physics it chooses on purpose.*

A shipped look is an authored expression. This file is where an intended departure is told from a defect. A departure recorded here is **Authored**: a change that "fixes" it is a change to the look and is reviewed under [`preservation.md` §3](preservation.md#3-a-change-that-moves-a-shipped-look-is-reviewed-before-it-ships). A departure not recorded here has no protection as intent, and a defect is never protected by being old. When the artist accepts a change to a look, its entry is updated here.

Intent is the artist's words, his choices on review sheets and the notes written beside each look when it was authored. Where nothing is recorded, the entry says so; nothing is inferred from the parameters alone.

## How to read an entry

- **Camera and mode.** *Floor, layered* is the endless park: a canopy overhead, cast through depth layers, the floor seen from above. *Floor, standing, faithful* is a finite grove standing in the scene, casting its real geometry and its whole shadow across a lit floor. *Sky view* looks up through the grove. *Cloth* is the standing curtain lit from behind. *Enclosure* is the tent seen from inside.
- **Gates.** The gated features the look opens beyond the defaults. Wood means `branch_tau` > 0. The fall tiers are those of [`gates-and-rungs.md`](gates-and-rungs.md#the-feature-registry-what-a-bundle-may-cut).
- **Experimental.** A look marked experimental ships with the source, plays in the editor in its own playlist, *experiments*, never in the story, and is left out of the general player bundle.

## Roles some looks carry

- **The order:** the built-ins are listed, and the arrows and the swipe walk them, as a story told by showing. First the tree: `park 1, the scene` and `park 1, under the trees` show it, `park1 inside2` looks round from among the trunks (since 2026-11-19, in `park 2`'s place; `park 2`, which left only its shadow, went to the experiments), and `park 1, from above` rises over it to see it straight down (since 2026-11-19). Then its year, from above into `park fall`, `montebello`, `montebello, rain` (`cherry blossom` went to the experiments on 2026-11-19, the artist's choice). Then `forest floor`, which is `afternoon 7`'s grove in fall, where the story ends: a step by hand goes on into the next playlist, and play goes round park story again. This is *park story*, the first of `PLAYLISTS` in `presets.js`. The second is *komorebi*, the three looks that cast komorebi in a room, `projector`, `morning 3` and `afternoon 7` (since 2026-11-20, the artist's name for it; *Komorebi in a room*, below); they stay in *shadows* too. The floor going abstract is the third playlist, *shadows*: the afternoons from 7 down to 4 and the mornings, to `memories`, then the artist's `bluuey`, `shrooms` and `look up`, the sky view, which he put there though it is not quite a shadow (since 2026-11-19, the artist's split), and his projector looks `projector` and `purple eye` (since 2026-11-19). `purple eye` keeps what it never named at its values from before (`GRANDFATHERED`): at its phenology 0 the leaf-out's default would leave its tree bare. The fourth playlist is *rainbow*, the artist's own playlist shipped (since 2026-11-19): eleven projector looks on one grove, red round the spectrum to magenta, each held 1 s and arriving over 6 s, so it reads as one continuous colour change; they take today's defaults for what they do not name, as the editor loads them, and each carries `cloud_exposure` re-sat at its own cloud as every shipped look does. The experimental looks are in none of these: they are the last playlist, `park 1`, `acid dreams`, `eclipse` and `the yellow tree` among them since 2026-11-17, `park 2` and `cherry blossom` since 2026-11-19 (the artist: under the trees goes straight to `park 2`, and the yellow tree leaves the walk), and the three trees recreated from his photographs, `dows lake`, `glebe sunset` and `yellow ginkgo`, since 2026-11-20. The editor plays a playlist once ▶ starts it, each look held 30 s; `looks.test.js` holds the order.
- **The editor's fallback:** `afternoon 7`; the live session enables the runtime governor. It is the look the editor falls back to when a list has nothing to land on; a first visit lands on park story's first look.
- **The welcome:** `afternoon 6`, shown faint behind the welcome screen and behind the about page.
- **The season macro's stops:** spring → summer → fall runs `memories` → `morning 1` → `afternoon 4` → the last green day (no look) → `montebello`. Its fall pigment capacities are `montebello`'s.
- **The homepage embed:** `morning 2` → `afternoon 5b` → `morning 3`, cycled with transitions.
- **Komorebi in a room:** `projector`, `morning 3` and `afternoon 7`. Projected, they cast komorebi in a real room: "those are the ones that when using a projector, it creates komorebi in real life by casting those shadows" (José, 2026-11-20). Measured, they sit nearest the real clips of every look ([`../evidence/measurements.md`](../evidence/measurements.md#the-projected-looks)). They have a playlist of their own, *komorebi*, second after the story. The piece collects looks like these, and goes on looking for more ([`../experience.md`](../experience.md#what-all-of-it-asks-for)).
- **The look that opens every fall tier:** `montebello` (also `montebello, rain` and `cherry blossom`). It is why the general player carries all six, which the artist accepted.

**Machine tuning.** Standard sample/texture requests and inherited fidelity defaults are omitted from built-ins. Exceptional sample requests and explicitly chosen bake sizes remain, including the sky looks whose silhouettes need their recorded bake resolution. Layer counts and all scene parameters remain authored. Old saved local looks and remote versions are not rewritten.

## Gates few shipped looks open

`vignette` (the projector's iris) only the projector looks open: `purple eye` and *rainbow*'s eleven, made for the projector (since 2026-11-19). `leaf_variety` and the beech outline only `purple eye` opens, as it was made. The maple outline only park story's looks open: their leaves are the maple's since 2026-11-19 (the artist's choice, the leaf alone, every other knob as it was). Every other look keeps the ellipse and leaves both the iris and leaf variety off.

The seen tree's newer gates only the three photographed trees open (since 2026-11-20). The tree grown with its finest twigs and their zigzag (`twig_haze`, `sympodial`, `thin_twigs`), its trunk forked (`trunk_split`) or standing in the ground on furrowed bark (`trunk_base`, `bark_texture`), the sky over the horizon (`view_sky`) and the gaze turned up (`view_look_up_deg`): `dows lake` and `glebe sunset`, but for the fork, which is `dows lake`'s alone. The spur leaves, the leaf as tissue, the crown's own light, the sky through the gaps and the beam through the slab (`leaf_years`, `leaf_neutral`, `crown_light`, `open_sky`, `beam_march`): `yellow ginkgo`, with `thin_twigs` and the gaze turned up. The runs' joints (`twig_joints`): `glebe sunset` and `yellow ginkgo`. Two-ranked buds (`two_ranked`) no shipped look opens.

**Open.** For each of these, the look's off state is the older behaviour. Under [`preservation.md` §4](preservation.md#4-a-retained-older-behaviour-needs-a-named-purpose) an older behaviour kept on a shipped look needs a named purpose, and none is recorded per look. The iris is a presentation device for the projector and belongs to a showing, not to a look; the projector looks carry it because the artist made them on the projector with it. Leaf variety changes nothing visible on any shipped look at canopy height (the 2026-11-15 sheet, below), and the artist left it off but on `purple eye`, which was made with it.

## Four laws on by default, and the looks kept as made

On 2026-11-15 the artist judged every shipped look, built-in and online, with each feature the looks left off turned on by a rule meant to keep the look, rendered and measured against itself (`archive/reviews/2026-11-15-adopting-features`). The sun-angle law and soft edges "seemed fine"; inner leaves "seemed fine", except where they fill the bright middle of a crown dark; tree growth "looks too different", and leaf variety changes nothing visible, so both stay off. He asked that the better behaviour be the default and that a look which needs the old one name it: "if we have new settings of higher quality, they should turn the new defaults and the presets that need it off should have it set explicitly".

Since 2026-11-16 `sun_cosine` 1, `sun_extinction` 1, `edge_area` true and `inner_leaves` 0.35 are the defaults. The default `exposure` (1.656) and `ambient_skylight` (0.3925) are the old 1.3 and 0.5 re-sat over the default sun's two laws (× 0.819 × 0.958), so the default scene shows as it did. `GRANDFATHERED` in `komorebi-params.js` holds the values from before, and every built-in look that keeps one names it, with its reason beside it:

- **The old receiver law, without the cosine:** `park 2`. Under its cloud the law raises its sunflecks by 6 to 10 % and no exposure takes that back without darkening the shade; the artist had kept its original contrast before.
- **No air's loss:** `montebello`'s season family: `park 1`, `park 2`, `park fall`, `the yellow tree`, `montebello, rain` and `cherry blossom`; and `park 1`'s two tree-view looks, which are its light. The season travel joins them only while they share one skylight, which the shade-held loss would move. `montebello` keeps the loss as it was chosen ([below](#the-airs-loss)).
- **No soft edges:** `afternoon 4b`, `afternoon 5b`, `prism` and `afternoon 6b`, whose colour soft edges move by 6 to 8 levels; and `afternoon 4` and `afternoon 5`, which share a grove with them, since soft edges travel as topology.
- **No inner leaves:** `prism` and `afternoon 5b`, where they fill the bright middle of the crown dark (the artist: "leave it off on 01-03"), and `afternoon 4`, whose middle goes dark too; `afternoon 5` and `afternoon 4b` share those groves.

Every other built-in carries all four. A look that takes inner leaves has its `foliage_density` brought down (× 0.917, or × 0.841) so as much floor stays in sun; looks that share a grove share one density, so the routes between them keep it. The online looks were given new versions by the same rules, each family on one density, and the public ones a copy (`look up v2`, `fall memories v2`, `purple eye v2`).

**The drawback, accepted.** A look kept anywhere but the built-ins and the online library (a local save, an exported file, an embed's own parameters) that does not name these keys takes the new behaviour on its next load, and may look different. The artist accepted it: "if something's outside of arboretum i think it's a risk we can take … everyone who neds it can turn it off etc under advanced".

## The cosine law

On 2026-11-09 the artist judged every look that has a receiver against the cosine law ([`../model/light.md`](../model/light.md)) with its exposure re-sat to `exposure / I` (`archive/reviews/2026-11-09-item2a-sun-cosine`), and kept the old law on the looks whose original contrast he preferred: `eclipse`, the mornings, `memories`, `the void`, `afternoon 5b`, `prism` and `park 2`. On 2026-11-15 the law was judged again with the shade held as well, the skylight brought down by the same factor (`exposure / I`, `ambient_skylight × I`): it then moves 5 of 62 looks, and the artist kept it on all but `park 2` ([above](#four-laws-on-by-default-and-the-looks-kept-as-made)). The sky views take 1: the law gives the seen sky 1.

## The air's loss

On 2026-11-09 the artist judged the air's loss ([`../model/light.md`](../model/light.md#the-airs-loss)) on two sun sweeps, a sunset and the looks under the lowest suns (`archive/reviews/2026-11-09-item5-air-loss`). He liked it on the floor between 12° and 26°, on both curtains with their exposure held, and on `montebello` with its exposure re-sat; he disliked it at 6°, where the floor turns to mud, and on the curtains with their exposure re-sat. On 2026-11-15 it was judged again with the shade held (`exposure / E`, `ambient_skylight × E`), which moves 5 of 76 looks.

- **Carry the loss, exposure held:** `curtain 1`, `curtain 2`. Their evening gets darker and warmer.
- **Carry the loss, exposure re-sat by it, skylight as it was:** `montebello` (exposure 7.116, `2.44 / (sin 26° × 0.782)`).
- **Off:** the rest of `montebello`'s season family ([above](#four-laws-on-by-default-and-the-looks-kept-as-made)).
- **Every other look:** the loss with the shade held.

## The fitted pigment basis

On 2026-11-16 the artist judged the pigment basis fitted to PROSPECT-D ([`../model/season.md`](../model/season.md#the-pigment-basis)) on the six looks that open the pigment tier, the season macro's fall half on `afternoon 4` and the held leaf (`archive/reviews/2026-11-16-pigment-refit`), with each capacity keeping its strength in green. He accepted it on all six as they are, nothing re-authored. The turned shade and the carpet pass about a fifth more red: `forest floor`, nearly all carpet, warms over the whole frame; `montebello`, `the yellow tree` (its crown shade now orange-red), `montebello, rain` and `cherry blossom` warm in the crown's shade and the carpet patch; `park fall`'s deep red barely moves. Summer looks are untouched.

## Leaves on shoots, by default

Since 2026-11-17 `shoot_leaves` 1 and `tilt_light` 1 are the defaults ([`../model/canopy.md`](../model/canopy.md#leaves-on-shoots)). The artist chose botanical shoots on by default and asked that the afternoon looks keep the old scatter: `afternoon 4`, `afternoon 4b`, `afternoon 5`, `afternoon 5b`, `afternoon 6`, `afternoon 6b` and `afternoon 7` name 0 for both, and so does `forest floor`, which is `afternoon 7`'s grove at full fall. On the review sheet he kept the mornings and `prism` as they were too ("i don't like how it changes the morning looks"; `prism` "1a instead of 1b"): `morning 1`, `morning 2`, `morning 3` and `prism` name 0. Every other look takes both, `memories`, `morning 3b` and `the void` among them ("4b morning 3b that one is interested, keep it enabled on that one") (`archive/reviews/2026-11-17-shoots-by-default`). Its pairs follow each tree's phyllotaxis, as the artist preferred on the sheet. A look kept elsewhere from before takes them on its next load.

## The ground returned by the undersides, by default

Since 2026-11-17 `ground_bounce` 1 is the default ([`../model/fill.md`](../model/fill.md#the-ground-returned-by-the-undersides)): the artist's rule is that a new feature is on unless a look is kept as made. It reads only where `canopy_fill` is open, so of the shipped looks it reaches `montebello`, `montebello, rain`, `the yellow tree` and `cherry blossom`, which take it; their shade moves by under 0.02 of a stop at their 26° sun, nothing the eye can see side by side. It shows where a closed canopy's shade is lit by diffuse light alone, as under the endless park with the fill open (`archive/reviews/2026-11-16-ground-bounce`). A look kept elsewhere from before takes it on its next load, if its fill is open.

## The tree's own curve, by default

Since 2026-11-19 `tree_tone` 1 is the default ([`../model/camera.md`](../model/camera.md#the-trees-curve)): the seen tree is shown through its own tone curve, at the brightness the frame's curve gave a sunlit leaf. It reads only where the tree is seen, so of the shipped looks it reaches `park 1, the scene`, `park 1, under the trees`, `park1 inside2` and `park 1, from above`, which take it; the floor of every look is untouched. The artist chose it to give the tree the character the shadow has: from above the lime goes to softer greens, and under the trees the acid-yellow crown glows pale gold (`archive/reviews/2026-11-19-tree-tone`, his pick of four). A look kept elsewhere from before, seeing its tree, takes it on its next load.

## A tilted leaf's shadow along the sun, by default

Since 2026-11-17 `tilt_shadow` 1 is the default ([`../model/leaf.md`](../model/leaf.md#what-one-leaf-stamps)): the faithful cast throws each tilted leaf along the sun from its corners' own heights instead of stamping the footprint an overhead sun would. Every look cast faithfully takes it; the artist kept none as made ("None, all take it"). At their own 26° sun the standing looks' shade grows 5–35 % and fills in under the crown; under a low sun a canopy closes up as a real one does; `montebello, rain`, nearly bare, barely moves (`archive/reviews/2026-11-17-low-sun-shadow`). The layer-path looks never read it. A look kept elsewhere from before takes it on its next load.

## Leaf-out, by default

Since 2026-11-17 `leaf_out_end` 0.14 is the default ([`../model/season.md`](../model/season.md#leaf-out-the-spring-half)): the season opens with leaf-out below phenology ~0.22. Of the shipped looks only `memories` sits there (0.15); the artist chose for it to take the spring, so its leaves are mid-greening, and its shade is 0.11 stop lighter and paler (`archive/reviews/2026-11-17-spring`). Every other look sits at 0.4 or above and does not move. A look kept elsewhere from before keeps `leaf_out_end` 0.

## The trees apart, by default

Since 2026-11-17 `sway_spread` 1, `gust_width_m` 4, `wind_shelter` 1 and `gust_carry` 1 are the defaults ([`../model/motion.md`](../model/motion.md#each-tree-in-its-own-gust)): each tree at its own pace, in gusts 4 m wide, sheltered by the crowns upwind of it, the gusts carried at the wind's speed. The artist kept all four on an eight-tree standing scene and asked for them on by default (`archive/reviews/2026-11-17-wind-physics`). They move only a look with wind, and only in motion: of the shipped looks, the 33 with wind take them, `eclipse` (one tree, no air among its leaves) by its pace alone. A look kept elsewhere from before, with wind, takes them too.

## Exposure under cloud

Every shipped look carries `cloud_exposure` 1, with its exposure re-sat to exposure / (1 + its own `cloud_thickness`): it shows as it always did at its own cloud, and a thicker cloud, from a transition, the weather macro or the editor, opens the exposure up instead of only blurring the dapples. A look saved without the key keeps exposure fixed.

## The floor, layered

### afternoon 4
- **Camera and mode:** floor, layered.
- **For:** recorded as the windy predecessor, now a three-tree grove with wider branching. A stop on the season macro (summer).
- **Authored departures:** none recorded.
- **Gates:** none beyond the defaults.

### afternoon 4b
- **Camera and mode:** floor, layered.
- **For:** `afternoon 4` under haze: a turbid sky, lower exposure, a touch more contrast.
- **Authored departures:** none recorded.
- **Gates:** none beyond the defaults.

### afternoon 5
- **Camera and mode:** floor, layered.
- **For:** a calm, near-overhead spring scene, a three-tree grove. `afternoon 4 → 5` differs only in branch angle and morphs its branches with no bloom.
- **Authored departures:** a warm Mount-Royal dirt floor, so the deep shade reads as dark earth and only the hottest dapples burn back toward white.
- **Gates:** none beyond the defaults.

### afternoon 5b
- **Camera and mode:** floor, layered.
- **For:** `afternoon 5` with a low sun swung round to the west. One of the homepage embed's three.
- **Authored departures:** none recorded.
- **Gates:** none.

### prism
- **Camera and mode:** floor, layered.
- **For:** `afternoon 5b`'s low west sun surfacing leaf-edge diffraction: red and blue split at every dapple edge. A set piece. Same topology as `afternoon 5b`, so the pair is a clean live morph.
- **Authored departures:** diffraction is exaggerated far above its true, hairline strength. The model calls this knob honestly exaggerated, the way the Purkinje shift is real but amplified; see [`../model/light.md`](../model/light.md).
- **Gates:** `chromatic_aberration`.

### afternoon 6
- **Camera and mode:** floor, layered.
- **For:** the welcome's look. `afternoon 5 → 6` grows its extra trees in as a continuous tree count rather than a bloom: five trees since 2026-11-09 (José: "i don't think more trees were meant, but i don't hate it"), four before. Its own intent is otherwise not recorded.
- **Authored departures:** none recorded.
- **Gates:** none beyond the defaults.

### afternoon 6b
- **Camera and mode:** floor, layered.
- **For:** `afternoon 6` with steeper leaf tilt, for more footprint foreshortening.
- **Authored departures:** none recorded.
- **Gates:** none beyond the defaults.

### afternoon 7
- **Camera and mode:** floor, layered.
- **For:** the editor's default look, played under the session's FPS policy, and one of the three looks that cast komorebi in a room (*Komorebi in a room*, above).
- **Authored departures:** the warm Mount-Royal dirt floor.
- **Gates:** none beyond the defaults.

### forest floor
- **Camera and mode:** floor, layered.
- **For:** a working name; the artist has not named it. `afternoon 7` at full fall, the view from under the canopy: a dark crown shadow with warm dapples and green flecks filling the frame, the carpet laid damp beneath it. The "komorebi on the ground" half of his valley memory. Built from what he kept choosing on `afternoon 7` in fall: wet litter, the litter colour, the trees differing in pigment and by a hair in their clock. Each leaf lets go the moment its own turn ends, so the sunlit leaves are down and the buried interior stays green. Sun, camera and grove are `afternoon 7`'s.
- **Authored departures:** the warm dirt floor. The sky fill and the leaf's diffuse share stay shut, as on `afternoon 7`.
- **Gates:** `litter`, `leaf_drop`, `drop_after_turn` with no lag. Fall tiers: pigment, exposure, drop, litter.

### memories
- **Camera and mode:** floor, layered.
- **For:** the north-star look of the founding afternoon in [`../experience.md`](../experience.md): a sparse early-spring grove, so individual leaves still matter, a clear sky, open branching, bright exposure. The spring stop of the season macro.
- **Authored departures:** none recorded. Its `phenology` 0.15 sits inside the spring: its leaves are full-grown and still greening, a little paler and more translucent than summer (the artist: "Memories takes it").
- **Gates:** none.

### morning 1
- **Camera and mode:** floor, layered.
- **For:** not recorded. A stop on the season macro (late spring); its `phenology` is a stamp below the turn, like `memories`'.
- **Authored departures:** a trace of leaf-edge diffraction; why is not recorded.
- **Gates:** `chromatic_aberration` (slight).

### morning 2
- **Camera and mode:** floor, layered.
- **For:** not recorded. One of the homepage embed's three; its humid haze is the one `montebello, rain` borrows.
- **Authored departures:** none recorded.
- **Gates:** none.

### morning 3
- **Camera and mode:** floor, layered.
- **For:** a crisp, clear-sky low sun with tight pinhole sun-images. One of the homepage embed's three, and one of the three looks that cast komorebi in a room (*Komorebi in a room*, above).
- **Authored departures:** none recorded.
- **Gates:** none.

### morning 3b
- **Camera and mode:** floor, layered.
- **For:** `morning 3` pushed hard into diffraction: the tight pinhole sun-images split into full red and blue rims. Same topology, so the pair is a clean morph.
- **Authored departures:** diffraction exaggerated well beyond `prism`'s.
- **Gates:** `chromatic_aberration`.

### the void
- **Camera and mode:** floor, layered. Experimental.
- **For:** a dense sixteen-tree grove pulled wide, deep green, low sun. Why it is experimental is not recorded.
- **Authored departures:** a cool stone-grey floor.
- **Gates:** none.
- **Open, needs José:** this grove (sixteen trees) outgrows the old 64-segment analytic occluder table, and the table has since grown to 256. Whether that repainted the look is not recorded. Its wood is shut, and the table only reaches a picture with wood open, so it should not have; José should confirm against his memory of the look.

### eclipse
- **Camera and mode:** floor, layered. Experimental since 2026-11-17.
- **For:** a set piece: a single tree's gaps imaging a partially eclipsed sun, so every dapple becomes the same crescent. A tiny crisp source, low far smear and dim ambient keep the crescents sharp and eerie; only a barely-there wind stirs it, with automatic drift off.
- **Authored departures:** the warm dirt floor. The eclipse dims the day by the share the moon covers, as a real one does (since 2026-11-10; the crescents had kept the clear sun's total). The exposure is the one it had, so it reads darker than before; the renormalised version is a comment at the sampler away. The eclipse's shape is a source property; see [`../model/source.md`](../model/source.md).
- **Gates:** `eclipse`.

### acid dreams
- **Camera and mode:** floor, layered. Experimental since 2026-11-17.
- **For:** not recorded.
- **Authored departures:** not recorded. It is authored with a fractional tree count (one tree and a partly faded-in second), the palm species, strong diffraction and a violet-grey floor; whether each is intent is not recorded.
- **Gates:** `chromatic_aberration` (3.6, between `prism` and `morning 3b`).

### projector
- **Camera and mode:** floor, layered.
- **For:** José's look, kept as he made it: one of the three looks that cast komorebi in a room (*Komorebi in a room*, above).
- **Authored departures:** not recorded.
- **Gates:** `eclipse` (`eclipse_amount` 0.42: a moon covers part of the sun, so the sun-images are bitten).

## The floor, standing

### park 1
- **Camera and mode:** floor, standing, faithful. Formerly named `afternoon 8`. Experimental since 2026-11-17: it stays the base its family is built on, out of the walk.
- **For:** the first standing-scene look: the tree stands in the scene and its whole shadow, trunk streak to branches to crown dapples, is thrown across a lit floor, not an infinite canopy hovering overhead. A wide view over a small grove leaves the grove a finite blob with lit floor around it. The faithful path is the heaviest; runtime quality policy belongs to the showing.
- **Authored departures:** the warm dirt floor.
- **Gates:** `faithful_canopy`, `standing_scene`, wood.

### park 1, under the trees
- **Camera and mode:** floor, standing, faithful, the tree seen.
- **For:** a working name; the artist has not named it. `park 1` with its tree in view, from where a person stands on the lawn: the eye 1.6 m up and 4.5 m from the trunks, looking into the sun, the leaves glowing with what they pass and the shadows running toward the viewer. The artist asked for the choice between this first-person framing, "under the tree with tree above and shadow below", and the far one below, and chose a look for each (2026-11-16). Its leaf is `park 1`'s own. Everything else is `park 1`'s.
- **Authored departures:** as `park 1`.
- **Gates:** as `park 1`, and `tree_view`.

### park 1, the scene
- **For:** a working name. `park 1`'s grove and its shadow seen from 12.3 m up, "the farther away videogame scene kind too, it can be such a vibe sometimes". Its leaf is `park 1`'s own. Everything else is `park 1`'s.
- **Camera and mode:** floor, standing, faithful, the tree seen.
- **Authored departures:** as `park 1`.
- **Gates:** as `park 1`, and `tree_view`.

### park 2
- **Camera and mode:** floor, standing, faithful.
- **For:** not recorded. It is a partner on two travel routes: `cherry blossom ↔ park 2` (leaves carried between floor and canopy on one grove) and the regrouping journey from `fall memories`.
- **Quality:** `park 1`'s requests, 29 samples and a 768 bake, since 2026-11-17 (the artist), so that the step from `park 1`'s family to `park 2` rebuilds nothing on account of quality: `park 1 → park 2` morphs, and `park 1, under the trees → park 2`, next to each other in the order, differs only in its camera, its light and the tree it sees. It asked for 48 samples and the session's bake before.
- **Authored departures:** the warm dirt floor. It keeps the old receiver law, without the cosine, and no air's loss ([the defaults](#four-laws-on-by-default-and-the-looks-kept-as-made)).
- **Gates:** `faithful_canopy`, `standing_scene`, wood.

### montebello
- **Camera and mode:** floor, standing, faithful.
- **For:** the first fall look. `park 1`'s grove and seed, seen from the far side with the sun behind the viewer, late in the season, the shadows running away from us. Since 2026-11-19 it takes the camera the artist set on the device (zoom 15.5 m, tilt 44.6°, turned −156.4°), which its rain day shares; the grove is the one its old view grew. The artist named it after the dry river valley at Dhamma Suttama, Montebello QC, where he sat under the turning trees in early fall 2026, and chose its recipe frame by frame from the review sheets: the exposed leaves turned first, a maple's sieve, soft pigments (he turned down the stronger "redhead" red) with a little tannin for russet among the red, the leaves a blend of glass, the shade lit through the canopy, the sunlit leaves dropped after turning and lying as a carpet round the trees' feet, damp from a rain day. Exposure is `park 1`'s own. The fall stops of the season macro are lifted from it.
- **Authored departures:** the dirt is `park 1`'s at ×0.6, chosen from the review sheets: real soil reflects 0.1–0.2, and on `park 1`'s dirt the honest carpet vanished into the ground. The ground stays dry under wet leaves, which a real rain day would not do; the dirt is lowered by hand until the rain is built to write both. The carpet's reflectance constant is a judgement awaiting a grey-card measurement (**Provisional**; see [`../model/season.md`](../model/season.md)).
- **Gates:** `faithful_canopy`, `standing_scene`, wood, `canopy_fill`, `leaf_diffuse` (0.5, the blend of glass), `leaf_drop`, `drop_after_turn` (the artist: "yes turn it on for both"), `litter`. All six fall tiers. Each tree its own colour and clock: `tree_pigment_spread` 0.6, `tree_clock_spread` 0.05 (José, 2026-11-09: "each tree is unique"); the default lag, 0.09. The air's loss, exposure re-sat ([the air's loss](#the-airs-loss)).

### park fall
- **Camera and mode:** floor, standing, faithful.
- **For:** the artist's mid-turn look on `montebello`'s grove: the crown still turning, the sunlit leaves already down and damp, the park seen wide from the far side, a deep red where `montebello` is rose-russet. Each leaf lets go a short lag after its own turn ends: `drop_lag` 0.05 since 2026-11-09 (José), where it was 0 (2026-10-09, "i like p1"). Each tree its own colour and clock, as `montebello`.
- **Authored departures:** the warm dirt floor at `park 1`'s level. The sky fill and the leaf's diffuse share stay shut; why is not recorded.
- **Gates:** `faithful_canopy`, `standing_scene`, wood, `leaf_drop`, `drop_after_turn` with a lag of 0.05, `litter`. Fall tiers: pigment, exposure, drop, litter.

### the yellow tree
- **Camera and mode:** floor, standing, faithful. Experimental since 2026-11-17: out of the walk.
- **For:** a working name; the artist has not named it. A place memory of his: one tree at the start of the retreat all yellow, by the end half its leaves on the ground, and "so orange". The one gold look: `montebello`'s leaves and grove with pigments tipped toward orange and a beech russet, the two trees not one colour, half the leaves down (the half that turns last stays on), and the camera moved so the trunk feet sit behind the eye and the carpet stays in view (his pick from the camera sheet).
- **Authored departures:** **the stained-glass leaf.** The leaf's diffuse share is shut on purpose, so each leaf paints its colour inside its own shadow and the dapples are coloured: the artist called it the ultimate goal ("yes the dapples were coloured"). The model says a real leaf is frosted glass, not stained glass ([`../model/leaf.md`](../model/leaf.md)); this look departs from it by choice, with the sky fill still open. The dirt is `montebello`'s. The half-retained drop is the engine's provisional beech value.
- **Gates:** `faithful_canopy`, `standing_scene`, wood, `canopy_fill`, `leaf_diffuse` deliberately 0, `leaf_drop` (half), `drop_after_turn`, `litter`. Fall tiers: fill, pigment, exposure, drop, litter.

### montebello, rain
- **Camera and mode:** floor, standing, faithful.
- **For:** a working name; the artist has not named it. `montebello` on a rain day, one of the weather variations he asked for. His memory gives the cause, "one day after rain many leaves fell on the ground": every leaf that has finished turning lets go at once. The leaves are soaked, the sky overcast from the weather macro's own stop, the haze `morning 2`'s. Everything else, the camera included, is `montebello`'s.
- **Authored departures:** wet soil at `park 1`'s dirt ×0.4, set by hand because the engine does not wet the ground. The exposure stays `montebello`'s under the haze.
- **Gates:** as `montebello` (`canopy_fill`, `leaf_diffuse` 0.5, `drop_after_turn`), with no lag after the turn; all six fall tiers.

### cherry blossom
- **Camera and mode:** floor, standing, faithful.
- **For:** a working name, from his own words: "is that spring? i love it omg cherry blossoms". The pink is the redhead pigments, with no russet and no sieve, on the honest carpet, dry and on `park 1`'s paler dirt. Two changes answer his two objections to these pigments: the trees differ, so the crown is not too uniformly red, and the fallen leaves stay fresh rather than browned. Everything else is `montebello`'s.
- **Authored departures:** the warm dirt floor; fallen leaves held fresh by a slower browning.
- **Gates:** as `montebello` (`canopy_fill`, `leaf_diffuse` 0.5, `drop_after_turn`); all six fall tiers.

### dows lake
- **Camera and mode:** floor, standing, faithful, the tree seen. Experimental since 2026-11-20.
- **For:** a working name, after the place. The artist's photograph of a bare tree by the path at Dow's Lake, Ottawa, on a November afternoon, recreated as closely as the engine can: one tree with every leaf down and on the ground, seen from where he stood with his phone's lens, the gaze turned up past the tilt to take in the whole crown against the sky. Its finest twigs are the haze he chose from the photographs ("i definitely preferred the haze 2 photos"), zigzagging as an elm's do at the stronger of the two zigzags he was shown; the trunk forks low into three stems in a vase, stands in the ground on a slight root flare (he turned down a wide one as "an elephant's foot"), and its bark is furrowed, which he asked for when a close look showed the smooth bark's "rudeness". The sky is the scene's own, blue overhead and pale toward the horizon. The sun stands where it lights the trunk's right side, as in the photograph, the crown dark against the sky. Everything else is `park 1, under the trees`'s.
- **Authored departures:** the floor is `park 1`'s warm dirt, not the photograph's path and grass. Its exposure is `park 1`'s, kept at a sun of 12°, and the air's loss stays off as on `park 1`.
- **Gates:** as `park 1, under the trees`, with `leaf_drop`, `drop_after_turn`, `litter`, and [the seen tree's newer gates](#gates-few-shipped-looks-open).

### glebe sunset
- **Camera and mode:** floor, standing, faithful, the tree seen. Experimental since 2026-11-20.
- **For:** a working name, after the place. The artist's photograph of a bare tree in the Glebe, Ottawa, against the sky as the sun goes down behind the street: a silhouette, the sun 2° up and nearly behind it, the horizon glowing warm. One trunk, the twigs as `dows lake`'s. Everything else is `park 1, under the trees`'s.
- **Authored departures:** as `dows lake`. The photograph's crown is a taller oval and denser than the grown tree's; not matched.
- **Gates:** as `dows lake`, without the fork, and with `twig_joints`: each run of a cluster's wood turns about its own joint, so the twigs stay on their branches in the wind (since 2026-11-20, the artist, on seeing it beside the cluster turned whole).

### yellow ginkgo
- **Camera and mode:** floor, standing, faithful, the tree seen. Experimental since 2026-11-20.
- **For:** a working name. The artist's photograph of a ginkgo in full autumn gold: "it should be as yellow". Its leaves are small and round-ended on the shoots of the last five years, as a ginkgo bears them on its spurs, a crown as leafy as a real one (about three square metres of leaf over each of the ground it shades, the shipped looks' range) lit through the leaf as tissue, by the light the crown scatters onto itself and by the sky through its gaps. Everything else is `park 1, under the trees`'s.
- **Authored departures:** the frame's curve, not the tree's own; the skylight raised to 2.9 and the exposure set low against it. Why is not recorded beyond the match to the photograph.
- **Gates:** as `park 1, under the trees`, with `drop_after_turn`, `leaf_diffuse` 0.95, [the seen tree's newer gates](#gates-few-shipped-looks-open) for the leaf, and `twig_joints`, so its spurs stay on the spurs they grow from (since 2026-11-20, as `glebe sunset`).

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
- **Authored departures:** the near-contact grove is staged on purpose, to show both blur regimes. The velvet's texture is open: it reads as satin, from the sheen and a pile with no grain (`archive/reviews/2026-11-09-item18-20-cloth-texture`).
- **Gates:** `receiver` (cloth), `faithful_canopy`, `standing_scene`, wood, the mullion grid, the glow tier. The air's loss, exposure held ([the air's loss](#the-airs-loss)).

### curtain 2
- **Camera and mode:** cloth, standing, faithful. Experimental.
- **For:** the same room at blue hour: `curtain 1`'s grove, seed and window, so the pair live-morphs. The sun sinks low and reddens through haze; the fabric is near-white voile, because at dusk the light carries the colour; the grove steps back so both blur regimes share the frame; the glow widens into bloom and the Purkinje shift runs deep: hot gold sun-blobs floating on rod-blue dim cloth. Lazy last-light wind. Recorded as the direction's next step, every number a starting point.
- **Authored departures:** the Purkinje shift pushed deep (an amplified real effect, [`../model/light.md`](../model/light.md)).
- **Gates:** `receiver` (cloth), `faithful_canopy`, `standing_scene`, wood, the mullion grid, the glow tier. The air's loss, exposure held ([the air's loss](#the-airs-loss)).

## The enclosure

### tent 1
- **Camera and mode:** enclosure, standing, layered. Experimental.
- **For:** komorebi from inside a closed tent pitched under trees, lying down; the reference is a NEMO Dragonfly 2P photographed from inside. Different panels at different brightnesses because they face different ways; a small room you are inside of, not a corridor. Each side is one smooth arch of tensioned fabric on pre-bent poles, seams only at real pole lines, the far end one triangle. Thin near-white nylon with heavy forward scatter. Both blur regimes come from the tree's own depth spread rather than an authored near occluder. Every number is recorded as a starting point.
- **Authored departures:** none recorded beyond the reference's geometry. No window and no mullion grid; both are curtain-only. A fine grain on the nylon (`fabric_nap` 0.04): radial lines toward the far end, vertical ones on the lit end wall. The mesh panels' throughput is authored and kept (José, 2026-11-09: "i like the tent mesh, keep it").
- **Gates:** `receiver` (enclosure), `standing_scene`, wood, the glow tier.

## Looks named elsewhere that are not built in

The model and evidence mention looks that are not in the built-in set: `fall memories`, `look up`, `purple eye`, `ultraviolet`, `green 2` and `cherry green`. They are the artist's own looks, kept in arboretum or as fixtures for the travel routes (`fall memories ↔ park 2`, `fall memories ↔ look up`, `purple eye ↔ look up`) and the projector routes. `ultraviolet` is named as his maple look, and a "projector look" (maple, aspect 1.75) is named in the same passage; whether they are one look is not recorded. Their intent is not recorded here; an entry is added when one ships.

## Related

- [`preservation.md`](preservation.md): what a change to a look owes, and why a look's recorded intent is its standard.
- [`gates-and-rungs.md`](gates-and-rungs.md): the gates and tiers named above.
- [`transitions.md`](transitions.md): the routes between these looks.
- [`../experience.md`](../experience.md): the places these looks serve.
- [`../evidence/observations.md`](../evidence/observations.md): what José lived, which the looks draw on.
