# Preservation

*What a change owes the pictures that already exist.*

A familiar picture that moves without warning breaks an expectation, and that hurts. So preservation is the default and the safer route, taken whenever it costs the experience nothing. It is not an end that justifies the means. Over time the rule that every old pixel must survive was read too literally, and it handicapped the piece: changes that were better, more in the komorebi spirit, went a bit short because the rule stood in the way. This contract keeps what preservation protects (the artist's expectations, the stability of what he has seen and approved) and drops what it was never meant to protect (an old frame for its own sake). The policy is [`principles.md` §8](../principles.md#8-preservation-serves-the-experience-it-is-not-the-goal); this file is its contract.

## 1. A feature lands with its off state unchanged

**Law.** A new feature lands behind a gate whose off state renders every existing look unchanged to the pixel, at the commit where it lands.

This is cheap and it is checkable: the harness renders the look with the gate absent and with it shut and requires equal frames, on every camera and path the gate could reach. It keeps that day's expectations whole, so the artist can open the feature on one look and judge it against a picture he already knows. A gate row is paired with a live row, in which opening the gate must change the frame; without it, an equality could pass only because the feature is dead.

The landing rule says nothing about the feature's future. It does not make the gate permanent, and it does not make the off state the right picture forever.

## 2. After landing, a look's intent is the contract

**Law.** Once a feature has landed, what a shipped look owes is its recorded intent in [`looks.md`](looks.md): its character, what it is for, and the departures from physics it chooses on purpose. Old pixels are evidence of what the engine did, not of what it should do.

A frame captured last month says how the look rendered then. It is useful for seeing what a change moved, and it is the right reference for a refactor that means to move nothing. It is not, by itself, a reason to refuse a change.

## 3. A change that moves a shipped look is reviewed before it ships

**Law.** A change that moves a shipped look's pixels is shown to the artist on a review sheet before it ships, with what improved and what was lost, in perceptual terms: brightness, shade colour, gap structure, softness, motion. Moving comparisons are used when the effect is temporal. The look's intent in [`looks.md`](looks.md) is updated when he accepts, and the sheet is kept in [`../evidence/observations.md`](../evidence/observations.md).

A correction to the model's causes may move every pixel of every look, and still be the right change, when it is **more komorebi**: truer to the afternoon, more a place, more calm. The artist chooses the stronger experience; he is not asked to defend it against a demand for old pixels. Preserving a look's character can mean changing its parameters as well as its pixels: re-authoring the look around the improvement is part of the change, not a breach of it.

What review prevents is the silent move. A change that moves a look and is not shown is a defect, however good the new picture is.

## 4. A retained older behaviour needs a named purpose

**Law.** When an older behaviour is kept beside a newer account of the same phenomenon, it is kept for one of three named purposes:

- **a cheaper approximation** of the same phenomenon, with its limits stated in the model (the layered cast beside the faithful cast of the real geometry);
- **an authored departure** the artist chose, recorded in [`looks.md`](looks.md) (a stained-glass leaf that keeps its colour inside its own shadow);
- **compatibility**, a concrete need (a renamed knob keeps its old spelling so a look saved yesterday still loads tomorrow).

"The test expects it" is not a purpose. A historical accident does not become a permanent artistic control because fixing it changes an image; and a departure the artist chose is not dismissed as a defect because it is not physics. A correction does not automatically bring a new switch with it: a control that is added represents a choice an author can understand and wants to make.

## 5. Invariants that bind regardless

**Law.** These hold whatever a change does to a look's pixels, and no review waives them:

- **Determinism.** Two engines born alike render the same frame; nothing visible comes from sampling. See [`determinism.md`](determinism.md).
- **Conservation.** Energy is accounted for: what the canopy takes from the beam is what it gives to the shade, within the bounds the model states. See [`conservation.md`](conservation.md).
- **Continuity.** Nothing pops; every change of a leaf, a tree or a look is continuous over a window the eye reads as change. See [`continuity.md`](continuity.md).
- **Independence between unrelated features.** A feature reaches only what it is about. A floor look ignores the whole fabric family; a zero gate ignores its geometry; a knob that must reach the floor leaves the cloth, the tent and the sky view untouched.
- **The off state at landing** (§1 above).

These are the right place for exact equality. An invariant is a statement about the engine's structure, not about one look's appearance, so exactness costs nothing and catches what a tolerance would let through.

## 6. A reference is updated only with evidence

**Law.** A regression reference (a pinned frame, a recorded hash, a measured band) is updated only with evidence that the new behaviour is the intended improvement: the review of §3 for a look's appearance, or a derivation and a measurement for an invariant's value. It is never updated to make a test green.

A pin written before a refactor that means to move nothing is a promise the refactor keeps; if it moves, the refactor is wrong until shown otherwise.

## 7. One engine

**Law.** The piece has one engine. A change does not leave behind a second permanent engine or a collection of legacy modes. An older behaviour retained for one of §4's purposes is a named path in the one engine, with its purpose written beside it; when its purpose lapses, it is removed.

## Where exactness is kept

Equality in pixels is the right tool for §1 (the off state at landing) and §5 (the invariants), where exactness is cheap and its meaning is structural. It is not a reason to keep an old picture once a better one has been reviewed and accepted under §3. The pixel harness checks the first two on every run; how it is built is in [`../implementation.md`](../implementation.md), and what it has measured is in [`../evidence/measurements.md#harness`](../evidence/measurements.md#harness).

## Related

- [`../principles.md`](../principles.md) §8: the policy this contract states.
- [`looks.md`](looks.md): the recorded intent a change is judged against.
- [`gates-and-rungs.md`](gates-and-rungs.md): what a gate and a rung owe when they land.
- [`determinism.md`](determinism.md), [`conservation.md`](conservation.md), [`continuity.md`](continuity.md): the invariants of §5.
- [`../evidence/observations.md`](../evidence/observations.md): review sheets and the artist's decisions.
