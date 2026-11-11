# Evidence

*Why we believe what the model says, and how we found out.*

The model says what komorebi is in the present tense. This folder keeps what that account rests on: what failed, what was measured, what was seen.

## What is here

- [`dead-ends.md`](dead-ends.md): every recorded failure, rejected alternative, superseded rule and lesson, with its cause and what replaced it.
- [`measurements.md`](measurements.md): numbers with their provenance.
- [`observations.md`](observations.md): what José lived and photographed.

## How to read it

Every item states its scope: the look, the state, the conditions it was taken under and, where recorded, its date. A missing date means none was recorded. A measurement from one look is a fact about that look in that state, not a universal claim. An old frame is evidence of what the engine did, not of what it should do ([`../principles.md`](../principles.md), §8).

## How the model links here

Each file is organised under the model's subsystem slugs, so a model file links to its own section: `source`, `light`, `camera`, `canopy`, `leaf`, `season`, `transport`, `fill`, `receivers`, `sky-view`, `motion`, `transitions`, and in `dead-ends.md` also `harness` and `principles`. A model file keeps at most a sentence about history and links here.

## Renders and review sheets

The pixel harness renders every shipped look headlessly and writes a PNG per preset under `test-gl/out/`. Review folders, the sheets José judges changes by, live under `test-gl/out/review/<date>/` with a `manifest.json` recording what each sheet shows (for example `test-gl/out/review/2026-10-08/`, where the litter's κ was chosen). Renders are evidence, not source: they stay untracked.

## Related

- [`../model/overview.md`](../model/overview.md)
- [`../contracts/preservation.md`](../contracts/preservation.md)
