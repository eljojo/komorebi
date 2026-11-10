# Contracts

*What must remain true when the piece changes.*

A contract here is a requirement with its purpose: what must hold, where it applies, and why it matters to the experience. It is never a test restated. A test is one way of checking a contract, and when a test and a contract disagree, the contract is read first and the disagreement is brought to the artist.

Contracts sit between the principles and the model. The [principles](../principles.md) say how a decision is judged; the [model](../model/overview.md) says what exists and what causes what; a contract says what a change may not break, or what it owes before it ships.

## The contracts

- [`preservation.md`](preservation.md): what a change owes the pictures that already exist: the off state at landing, a look's recorded intent as the standard after it, review before a shipped look moves, and the invariants that bind regardless.
- [`determinism.md`](determinism.md): frame-stability and the rule that nothing visible comes from sampling; identity by address and the salts that keep two draws apart.
- [`conservation.md`](conservation.md): energy bounds and the books: what the leaves give up is what the shade receives.
- [`continuity.md`](continuity.md): calm as a contract: no pops, fade windows, step clamps, no coherent wave.
- [`gates-and-rungs.md`](gates-and-rungs.md): what a quality rung and a new camera owe, the parameter classes and how each behaves under a transition, who may cross a rung, and what a bundle may cut.
- [`transitions.md`](transitions.md): the gate for each route between looks and the promises each makes (continuity, reversal, queue, cleanup, context loss).
- [`looks.md`](looks.md): each shipped look's recorded intent and its authored departures, so an intended departure is told from a defect.

## Where the evidence lives

A contract states the requirement; its evidence lives elsewhere. The pixel harness, the unit tests and the transition harness are where a contract is checked on every run; [`../implementation.md`](../implementation.md) says which suite checks which contract. What those checks have measured, and the review sheets on which the artist judged a change, live in [`../evidence/`](../evidence/README.md). A contract does not grow a list of current values or test names; when one is needed, it links.

## Related

- [`../principles.md`](../principles.md): the commitments these contracts make concrete.
- [`../evidence/README.md`](../evidence/README.md): what the checks have found.
- [`../implementation.md`](../implementation.md): where each check lives.
