# The komorebi specification

*Sunlight filtering through the leaves of trees, and the shapes it casts on the ground.*

Komorebi is an art piece: a rendering of light through a canopy, built so that a person settles into it the way one settles under trees on a spring afternoon. This folder is the piece's specification. It is written by the artist for anyone who would study the work or implement it: what the piece is for, how its world works, what must stay true as it changes, what has been learned, and what is still open.

**The spec is the work.** The JavaScript in this repository is one implementation of it. The artist's judgement goes into these documents; the implementation is judged against them. When the code and the spec disagree about what the piece *should* do, the spec is read first and the disagreement is brought to the artist. When they disagree about what the code *does*, the code is the fact and the spec is corrected.

## How it is organised

The documents are arranged by the question a reader is answering, not by the order things were built. Within each part, the subsystems (source, canopy, transport, receiver, motion) are the navigation.

| Part | Question it answers | Where |
|---|---|---|
| **Experience** | What are we trying to make someone feel and notice? | [`experience.md`](experience.md) |
| **Principles** | How are decisions judged? | [`principles.md`](principles.md) |
| **Model** | What exists in this world, and what causes what? | [`model/`](model/overview.md) |
| **Contracts** | What must remain true when we change something? | [`contracts/`](contracts/README.md) |
| **Evidence** | Why do we believe this, and how did we find out? | [`evidence/`](evidence/README.md) |
| **Exploration** | What is uncertain, unbuilt, or worth trying? | [`exploration/`](exploration/open.md) |
| **Implementation** | Where does each part of the model live in the code? | [`implementation.md`](implementation.md) |
| **Glossary** | What do the words mean? | [`glossary.md`](glossary.md) |

Read `experience.md` and `principles.md` first; they are short and everything else serves them. Then `model/overview.md`, which holds the causal spine in one page and points into the subsystem accounts. An implementer working on one mechanism reads its model file, then the contracts that name it, and reaches for evidence only when challenging an explanation.

## How it is written

These are the conventions every file follows. They are what keeps the garden tended.

**Present tense for what is.** The model describes the piece as it stands today. History belongs in `evidence/`. A superseded idea does not remain in a model file as a sentence a reader might obey; it moves to `evidence/dead-ends.md` with the reason it was replaced, and the model links to it in a few words.

**The status of a claim is said.** Prose carries it, as a bold lead or a plain phrase:

- **Law** — a requirement, or a physical fact the piece does not negotiate (Beer's law, the sun's half degree).
- **Approximation** — a stand-in for something real, with its limits named beside it and the state in which it is absent.
- **Authored** — a choice of expression, not a claim about the world (a projector's iris, a dark velvet's dye).
- **Provisional** — a value awaiting a measurement that would replace it.
- **Not built** — a named direction with no implementation. Detail lives in `exploration/`.
- **Open** — unexplained or undecided.

Distinguish the phenomenon from the proxy used to represent it. A real mechanism does not make every number standing in for it exact.

**One authoritative home per claim.** A consequential fact is stated fully in one place. Everywhere else it is a sentence and a link. A summary never grows into a second derivation or a second list of current values.

**Model files carry no implementation residue.** Texture formats, uniform slots, test names, byte counts, frame times, commit hashes and bundle sizes live in `implementation.md`, `evidence/measurements.md` or the code. A parameter name appears in a model file only when the reader needs to find the knob, and the mechanism is explained in words first. The phrase "byte-identical" does not appear in a model file; what a feature's off state owes is one contract, [`contracts/preservation.md`](contracts/preservation.md).

**Looks carry their intent.** A shipped look is an authored expression. Its character, and the departures from physics it chooses on purpose, are recorded in [`contracts/looks.md`](contracts/looks.md) so that an intended departure is never mistaken for a defect, and a defect never protected as intent.

**Evidence states its scope.** A measurement names the look, the state and the conditions it was taken under. It does not become a universal claim by being written down.

**The voice is the artist's.** Concrete, warm, exact; the register of `experience.md`. No boilerplate, no hedging for its own sake, no slogans in place of observations.

**Links are relative** and headings are stable. A file begins by saying what it is and ends with what it relates to.

## How to maintain it

A changed law updates its model account and the contracts it touches; the comparison that justified the change goes to evidence. A replaced approximation gets a current explanation; the old one and the reason for replacing it stay reachable as evidence. A deliberately changed look updates its intent in `contracts/looks.md` and leaves a review sheet in evidence. An implementation detail changes the code and, if it was named, `implementation.md`; it never lengthens the model. A resolved question leaves `exploration/` for the model or contracts, and its investigation goes to evidence.

Before adding a gate, a knob, a schema or a tool to this spec, ask whether the piece needs it or only the document does. The structure exists to make reading and tending cheaper.

## Provenance

This folder replaces the single `komorebi-spec.md`, which grew from the founding afternoon through a year of amendments into a document that could not be read in one sitting and in which a buffer layout could stand beside a law of optics with the same apparent authority. That file is retained in the repository as the historical account until the artist retires it. Nothing here cites it as authority; where its history matters, it has been moved into `evidence/`.
