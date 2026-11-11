# Directions

*Where the artist wants the piece to go: each direction as what should become more true, why it is more komorebi, how it is judged, and where it would land in the model.*

These directions were recorded in October–November 2026 and are the artist's: José's responses to two reviews of the piece, kept with his words where he gave them. They are not designs. Each says what should become more true and how a result is recognised; the algorithm, the representation and the order of work belong to whoever takes it up. Nothing here authorises changing a look; a direction lands through the review that [`../contracts/preservation.md`](../contracts/preservation.md) describes, and the final artistic acceptance is José's.

They name opportunities; the feelings they predict still have to be demonstrated in the piece.

## The enabling decision

### Preservation serves the experience

**Status: [settled].** Now [`../principles.md`](../principles.md) §8 and [`../contracts/preservation.md`](../contracts/preservation.md).

José: *"i feel like the development of komorebi has gone to extreme lengths in order to keep it like pixel-perfect back to the first release and i feel like we've taken losses because of that."*

This came first because the others depend on it. A correction to a cause may change every pixel of a look; an old frame is evidence of what the engine did, not of what it should do. What a change owes is review: old and new shown side by side, moving where motion is the subject, with what was gained and what was lost said in perceptual terms. A retained older behaviour needs a named purpose (a real cost saving, an authored expression, a concrete compatibility need); "the old test expects it" is not one. Determinism, energy accounting, continuity and the independence of unrelated features remain contracts; a historical screenshot hash is not one of them.

## In order of priority

The order is the documents' own. Larger-scale composition comes first because José named it; the others support the sense that the viewer is somewhere, with surroundings, changing conditions and a life beyond the frame. It is a priority, not a dependency graph, and no look is asked to carry every direction.

### Larger-scale composition and the whole scene setting

**Status: [direction].** The first priority.

José: *"i agree that the larger-scale composition needs to improve, the whole scene setting. good points"*

**What should become more true.** At the scale of the whole frame, a scene has a spatial character of its own: sheltered pockets and openings, dense crowns beside exposed ground, larger relationships of light and shade, and a sense of what surrounds the viewer and continues beyond the frame. The overhead grove is grown to fill the view with overlapping crowns, which serves an endless dapple field; filling a frame is a different aim from giving it a place.

**Why it is more komorebi.** The founding experience is an afternoon *in a place*, lying under trees with a world going on around. An opening can become familiar, a dense region can feel sheltering, a quiet patch can give the eye somewhere to rest while movement elsewhere stays available. Looking away and back to a recognisable arrangement is what makes a place feel as if it persists without being watched. The aim is organised unevenness: more random variation does not make a place, and not every look needs a focal point or a backdrop.

**Acceptance criteria.**
- The whole frame has recognisable spatial character; its identity is not carried only by colour grade or fine leaf detail.
- Dense and open, bright and quiet, and the viewer's position among them are in meaningful relation. A uniformly busy image is not the default.
- Looking away and back finds a recognisable part of the place (an opening, a sheltered region) while its light and motion keep changing.
- The composition comes from the scene and its illumination, never from a screen-space mask laid over an unchanged grove.
- It holds under ordinary motion and changing light, not only in one frozen instant.
- The viewer can feel surrounded by a larger world without all of it being rendered.
- It stays calm and lets attention wander; it does not lean on a conspicuous focal effect.
- Different looks can be different kinds of place; no single formula is imposed on every scene.
- It reads at the scale the whole scene is experienced at, even where fine detail cannot be seen.

Begin with what the existing scene mechanisms can already express; new geometry or a broader environment model earns its place by a demonstrated need.

**Model files.** [`../model/canopy.md`](../model/canopy.md) (the grove's layout and its view-filling crowns), [`../model/camera.md`](../model/camera.md), [`../model/transport.md`](../model/transport.md) (the standing scene), [`../model/receivers.md`](../model/receivers.md), [`../model/sky-view.md`](../model/sky-view.md), [`../model/overview.md`](../model/overview.md).

### Cloud breathing within one grove

**Status: [direction].**

**What should become more true.** An unattended view of one grove shows the remembered breathing of light: cloud passing over the sun, the pattern going soft and returning, without a change of look or a hand on a control. Today the weather drifts the wind's strength and direction while cloud is authored per look and moved only by transitions, and variety comes from cycling through looks. The proposal is passing cloud acting on the existing source model; it needs no visible clouds, no meteorology, no day or season, and wind and cloud share a cause only where the relationship is justified.

**Why it is more komorebi.** The founding memory begins with this, and the cloud is the most expressive parameter in the piece. Staying in one place becomes rewarding when the same branches and gaps become newly legible as the source widens and tightens: a patch of light recognised, lost under cloud, found again. Familiar structure under changing conditions is what makes a place feel inhabited by weather.

**Acceptance criteria.**
- An unattended view exhibits the breathing without changing looks or asking the viewer to act.
- The grove keeps its identity; a source change never replaces the leaf arrangement or disguises a scene swap.
- Softness and contrast change together through the light model; it never reads as a screen blur, an exposure pulse or a transition effect.
- Clearer and cloudier passages connect without a flash, a disappearance or a reset.
- There are stretches of relative constancy; the piece does not keep announcing that something is happening.
- Over sustained viewing it never reads as a repeated inhale/exhale with a beat.
- The amount of change suits the place: a quiet look stays quiet.
- A passage can be reproduced to compare before and after a change, without the weather visibly repeating.
- It causes no stalls that defeat the calm it serves.

The successful description is "cloud passed over this place", not "the scene ran its breathing animation".

**Model files.** [`../model/source.md`](../model/source.md), [`../model/motion.md`](../model/motion.md) (the weather band), [`../model/light.md`](../model/light.md), [`../contracts/determinism.md`](../contracts/determinism.md), [`../contracts/continuity.md`](../contracts/continuity.md).

### Protecting the glisten

**Status: [direction].**

**What should become more true.** The faintest motion stays continuous when the renderer saves work. The adaptive frame-rate deliberately leaves slow leaf drift out of its motion signal and names visible stepping on the slow shimmer as its trade, so the system can decide a scene is nearly still while the very motion the viewer came for is still happening. The trade should be chosen by what is visibly changing, with the fine motion given special weight; neither full rate everywhere nor maximum saving everywhere is the aim.

**Why it is more komorebi.** The glisten and the reorganising of sparse gaps are part of the subject, not detail left over after the strong wind. Saving power serves calm too (a hot machine, a fan, a flat battery all undermine an ambient piece), so the answer is a better-judged trade, not the abolition of one.

**Acceptance criteria.**
- In a sparse, nearly still canopy, small gaps open, merge and close continuously enough to read as leaves, not intermittent updates.
- In a denser canopy the glisten stays fine and irregular; it never becomes coarse blinking or stepping when the renderer idles.
- Entering or leaving a lull brings no change of cadence, jump or hitch.
- A truly still scene still saves substantial work.
- It is judged on a device where the trade matters, as well as on a capable machine.
- It is judged with motion playing; equal frozen frames or a good average frame rate prove nothing here.
- Any remaining temporal degradation is described honestly and weighed against its real saving.

If the scheduler becomes the explanation for the movement, it has intruded into the piece.

**Model files.** [`../model/motion.md`](../model/motion.md) (the incoherent band and the drift), [`../contracts/continuity.md`](../contracts/continuity.md), [`../implementation.md`](../implementation.md) (the adaptive frame-rate).

### A breeze that arrives from somewhere

**Status: [direction].**

**What should become more true.** The passage of a disturbance through the grove becomes legible: one crown answers, a neighbour follows, a sheltered part barely moves. Branch forcing already varies in space, layered on a shared sway and gust envelope; whether it can produce this convincingly is the first thing to find out.

**Why it is more komorebi.** A breeze that arrives and passes implies a world beyond the picture, a place weather travels through. The differences in response also reveal the grove's structure: connected branches, distinct crowns, exposed and protected places. What makes the air feel shared is the relationship between responses, not more variety at every point.

**Acceptance criteria.**
- Some passages let the viewer sense where a breeze comes from or how it moves through the grove.
- Neighbouring responses differ consistently with the scene's structure and the forcing.
- Coherence never becomes an obvious travelling wave, a marching sequence or a choreographed ripple.
- It coexists with local irregularity and fine leaf motion; no fixed delay has every branch act out the same event.
- Branches stay attached, load and release convincingly, and settle with their elasticity intact.
- The scene can stay quiet for long periods; legible air does not mean more agitation.
- It shows in a whole-scene view, not only in a diagnostic display of the wind field.

The useful impression is that a breeze crossed this place; a programmed sweep means the organisation is too conspicuous or too regular.

**Model files.** [`../model/motion.md`](../model/motion.md), [`../contracts/continuity.md`](../contracts/continuity.md).

### Shade carrying its surroundings

**Status: [direction].**

**What should become more true.** The shade's light depends on what surrounds it, with spatial structure: a leaf-covered floor faintly colouring the space above it, an opening admitting a different light from the dense canopy beside it. The sky fill already makes shade depend on the grove; its named limits are a flat sky and no light returned by the ground. These are where to look, not proof that a costlier lighting model would be worth it.

**Why it is more komorebi.** Shade is most of the image and much of where the eye rests. Its character is part of what makes a scene feel enclosed, open, warm, cool or sheltered, and relationships of this kind make surfaces and surroundings belong to one place. A uniform lift or a warmer grade would make a frame pleasanter and leave this untouched.

**Acceptance criteria.**
- A change in the surroundings changes the shade understandably, where the surroundings should matter.
- The contribution has spatial structure fitted to the scene, never a uniform tint or glow.
- Shade keeps its depth and variation; added light does not flatten shelter against exposure.
- Material colour and illumination stay distinguishable: a warm floor influences the scene without every surface seeming to share its pigment.
- The difference is felt at the intended viewing scale, not merely measurable.
- Any approximation is stated with its limits, and the cost is judged against the visible benefit.
- Light is accounted coherently; nothing counts an existing source twice.

Establish the value on one setting, with and without the contribution, before any broad lighting expansion.

**Model files.** [`../model/fill.md`](../model/fill.md), [`../model/light.md`](../model/light.md) (the sky's radiance), [`../model/receivers.md`](../model/receivers.md), [`../model/sky-view.md`](../model/sky-view.md), [`../model/season.md`](../model/season.md) (the carpet as a reflector), [`../contracts/conservation.md`](../contracts/conservation.md). Open items: ground bounce and a sky gradient in [`open.md`](open.md).

### Late light's weight

**Status: [direction].**

**What should become more true.** A late-light scene carries a different emotional weight from an afternoon, beyond its palette. The atmosphere normalises sun and sky to their peak channels and leaves brightness to exposure, which keeps the author in control but separates colour from part of the light's changing strength. This reaches past the receiver's cosine law: it concerns how illumination, exposure and perception act together.

**Why it is more komorebi.** An evening can feel intimate because light becomes scarce; a last bright patch matters more as its surroundings recede. That feeling lives in the relationship of light to shade, of seen to unseen, as much as in hue. It does not ask every scene to run through a day, and an author keeps the bright, dreamlike evening when that is the look.

**Acceptance criteria.**
- A late-light scene has a perceptibly different weight from an afternoon one, beyond its palette.
- Bright patches and their surroundings keep a coherent relationship as illumination weakens; multiplying the image by a smaller number is not evidence.
- Shade stays intentional and legible; most of the image lost to undifferentiated black does not by itself make intimacy.
- Exposure and perception support the intended experience without automatically cancelling every change in illumination.
- Where the light evolves over time the response is continuous: no pumping, no abrupt compensation, no flash.
- Authored departures remain possible, and the physical account and the artistic choice can be understood apart.
- It is judged on the display or projector it is meant for where practical, since what dim relationships show depends on it.

The desired result is that the last light feels consequential within the place.

**Model files.** [`../model/light.md`](../model/light.md) (the atmosphere's normalisation, the cosine law, the mesopic shift), [`../model/camera.md`](../model/camera.md) (exposure and the tone tail), [`../contracts/looks.md`](../contracts/looks.md). Open items: the beam's broadband loss and the skylight's level in [`open.md`](open.md#light).

### Distinctive events within calm

**Status: [direction].** Now stated in [`../experience.md`](../experience.md) and [`../principles.md`](../principles.md) §2.

**What should become more true.** The piece may do something worth noticing: a stronger gust followed by a long settling, a brief opening that admits an unusually clear sun-image. The season's tie-break rejected a coherent sweep of falling leaves as "what calm forbids", and rightly, in its context; that local lesson must not harden into a general ban on coherent or noticeable events.

**Why it is more komorebi.** Calm can hold contrast, and a gentle event can deepen the repose around it. What calm forbids is performance: a cadence of effects, a programmed sweep, anything that makes the viewer wait for the next thing. The event belongs to the scene and follows from the same causes as the quiet; this is a principle for judging, not a request for an event scheduler or scripted beats.

**Acceptance criteria.**
- An event can occur without the piece feeling as though it performs.
- Its onset and resolution follow the scene's existing causes, with no arbitrary reset or unexplained discontinuity.
- Quiet passages have the duration and integrity to stay meaningful; events never arrive at a recognisable cadence.
- An event can be local; the whole scene need not take part.
- Noticeability is judged apart from startle: an event can draw attention and stay gentle and coherent.
- Removing a numerical synchronisation artifact does not oblige removing all spatial or temporal coherence from a phenomenon.
- It stays pleasant over sustained, unattended viewing, not only in a chosen clip.

Watch the quiet before and the settling after, not only the event. Do not reopen the tie-break itself without evidence.

**Model files.** [`../model/motion.md`](../model/motion.md), [`../model/source.md`](../model/source.md), [`../model/season.md`](../model/season.md) (the tie-break, in context), [`../contracts/continuity.md`](../contracts/continuity.md).

### Equilibrium without repeating choreography

**Status: [direction].**

**What should become more true.** The fine motion keeps its rest arrangement and its attachment without replaying itself. The leaf drift follows individually different bounded orbits on one shared phase, so the whole configuration repeats exactly after a cycle. Returning toward the same rest is part of the memory; repeating every leaf's journey exactly is a different property, and the first can be kept without the second.

**Why it is more komorebi.** The wind already learned that a recognisable single period feels mechanical, and broadband forcing with an evolving weather corrected it at the larger scales. This applies the same lesson to the smallest visible motion. It is not a request for randomness: sampling noise, unbounded wandering or more nervous movement would all move away from the piece.

**Acceptance criteria.**
- Fine motion stays bounded and continuous, with stable attachment and a meaningful rest arrangement.
- Neighbouring leaves differ enough for gaps to reorganise, while their motion still belongs to the branches that carry them.
- Sustained viewing reveals no shared repeat of the whole fine pattern at the old cycle boundary.
- Removing the repeat does not raise the average agitation to hide it.
- A lull feels like a lull; fine motion does not ask the attention a gust does.
- No per-frame numerical noise impersonates the twinkle.
- The motion can be reproduced for review, and leaf drift can still be explored by hand.

Watch for longer than the old period with the coherent wind quiet. If the repeat is not perceptible in a relevant look, say so; that limits the value of changing it there.

**Model files.** [`../model/motion.md`](../model/motion.md) (the drift phase), [`../contracts/determinism.md`](../contracts/determinism.md), [`../contracts/continuity.md`](../contracts/continuity.md).

### A leaf's form as part of its history

**Status: [direction].**

José, of the leaves on the sheets: *"we need much more leaf diversity, more species and more variability within species … they all look the same to me."*

**What should become more true.** A leaf's outline belongs to the leaf. Variety assigns outlines by light class, and the class is a rank over the whole grove, so a density or tree-count change re-ranks the light and a leaf crossing a class boundary swaps its outline in place: its lobes pop, though its size does not. The distinction to honour is between the light that shaped a leaf as it grew and the light reaching it now. Surroundings can change a leaf's illumination at once; they need not replace its blade.

**Why it is more komorebi.** Species → tree → leaf is one of the piece's strongest causal ideas: a grove of families, shaped by heredity and by where each leaf grew, whose diversity is organised rather than decorative. A visible identity that jumps under a small edit breaks both that idea and the promise that nothing pops. This does not prescribe storing a biological history for every leaf; the representation is open.

**Acceptance criteria.**
- A small density or tree-count change does not make unrelated surviving leaves visibly jump to other outlines.
- Family resemblance within a tree and diversity between leaves stay legible; making every leaf alike is not a fix.
- Exposure keeps a meaningful relationship to form where the model claims one; freezing everything while silently dropping that relationship is incomplete.
- Changing live illumination does not instantly rewrite the grove's growth history.
- When an author deliberately changes growth conditions, the change of form is continuous or plainly belongs to a structural transition.
- A leaf hanging and the same leaf fallen agree about its identity under the same authored state.
- It stays stable under reproducible comparison, and costs no detail the views cannot show.

Follow identifiable leaves through small edits, the held leaf included; then look at the whole grove, so a local fix does not erase the organised diversity that made the feature worth having.

**Model files.** [`../model/leaf.md`](../model/leaf.md) (variety, the light class), [`../model/canopy.md`](../model/canopy.md), [`../model/season.md`](../model/season.md) (the fallen leaf keeps its outline), [`../contracts/determinism.md`](../contracts/determinism.md), [`../contracts/continuity.md`](../contracts/continuity.md). The decision waiting on it is *the outline swap* in [`open.md`](open.md#leaf).

## How work toward a direction is judged

Bring back a concrete comparison:

- the feeling meant, and the spatial or temporal relationship meant to create it;
- the previous and the proposed behaviour, at the scale and duration where the claim lives: the whole frame for composition, a full arrival and settling for a breeze, sustained viewing for anything about calm;
- why the change produces the difference, with any approximation it introduces;
- what improved, what was lost, which historical behaviour was deliberately allowed to change, and which criteria are still uncertain.

A still image can establish structure and colour; a short sequence can expose a pop; only sustained viewing reveals a beat, a restless weather or an afternoon worth staying in. Use the existing review tools where they answer the question, add evidence where a property is missing, and do not turn a qualitative criterion into an arbitrary threshold. Preserving old pixels is not the measure of success; preserving meaningful artistic intent, and the contracts that still matter, is.

The question every direction is finally judged by:

**Does this become somewhere I recognise and want to remain?**

## Open, for later sessions

Items in the bot's working log that José named for later sessions. They are recorded here so that they are not lost; none is a design.

- **The Metal harness backend**: first, José's pick of it *(from the bot's log, uncommitted)*.
- **The natural maple**: the lower half of the leaf, with his leaves 31 and 37 as references (4, 13 and 22 are damaged); sub-lobes, real tips, organic edges and the base *(from the bot's log, uncommitted)*. See [`open.md`](open.md#leaf).
- **Slow change over minutes**: trees wandering like musical chairs, overlaps welcome, and big branch movement *(from the bot's log, uncommitted)*.
- **The "too breathy" wind** *(from the bot's log, uncommitted)*.
- **The editor's sliders against the shipped looks**: whether their ranges fit what the looks actually use *(from the bot's log, uncommitted)*.

## Related

- [`open.md`](open.md): everything uncertain or unbuilt, with its status.
- [`../experience.md`](../experience.md): the afternoon these directions serve.
- [`../principles.md`](../principles.md): how a change toward them is judged.
- [`../contracts/preservation.md`](../contracts/preservation.md): what a change that moves a look's pixels owes.
- [`../evidence/observations.md`](../evidence/observations.md): what José lived and photographed.
