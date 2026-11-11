# Sessions

*What belongs to the scene, the sequence, and the showing.*

A look owns artistic appearance. A playlist owns dwell, crossfade and morph/fade choice. A session owns the current device's rendering policy and the destination of this showing. Changing the destination never changes a playlist's pacing.

## Rendering

**Law.** A session supplies fidelity ceilings. A look can omit a fidelity request and inherit, or request less than the ceiling; it cannot demand more. The live governor may spend less again to keep motion smooth. A request is not a guaranteed minimum, and independent ceilings do not bound the total cost of a scene or a transition.

**Layer count is authored structure.** It changes the look and remains outside session ceilings, automatic profile selection and the runtime governor. Tone mapping remains the look's grade. The six inheritable fidelity controls and the shipped profile values live in the [implementation account](../implementation.md#session-settings).

**Law.** Frame-rate policy belongs to the session. Loading a look, playing a playlist, reversing or queueing a transition, and restoring a lost context cannot replace an explicit local choice. In particular, turning adaptive FPS off stays off. Automatic selection preserves explicit overrides. These settings do not travel with a newly saved look.

**Provisional.** The software ships a small set of quality profiles. Phone identification selects the compact baseline and adaptive FPS; other live devices start balanced with adaptive FPS off. Hardware texture limits restrict the ceilings, and the existing governor responds to observed frame times. These are starting policies awaiting device measurements, not calibrated performance guarantees. Offline rendering freezes its selection and disables both governors.

## Presentation

**Authored.** Screen presentation uses the area-correct leaf-edge mixture. Projector presentation uses the older, slightly darker edge law: darker frames work better on the projector. A session follows a playlist's optional presentation selection unless this showing explicitly chooses a destination. An explicit screen selection overrides a projector playlist. Without either selection the destination is screen, including TV.

The projector's iris retains its authored look controls until a presentation treatment is chosen. Presentation makes no automatic change to FPS policy. Route gates still apply to the resolved endpoints; changing the edge law can change which travel routes are available.

## Authored data and lifecycle

**Law.** Authored look data remains separate from effective render values. Saving, copying, uploading and queued saves preserve omitted fidelity keys and the original requests, including a request above the current ceiling. Adding or removing an opinion changes the authored look even when today's picture is unchanged. Session edits do not mark the look edited.

Omission means inheritance; null is not an opinion. A bake request of zero means follow the resolved texture resolution before applying the bake ceiling. Old stored looks remain stored as received. Their explicit fidelity values become capped requests in session-aware playback; their legacy FPS fields cannot override its policy.

Runtime choices take effect during playback. Structural session changes wait for a transition to settle; the latest pending choice wins. Every subsequent selection resolves under that choice, including one already queued. Native and temporary scenes use the same resolved endpoints.

Session preferences stay on the device. Arboretum stores a playlist's optional presentation identifier, not device quality, credentials or account-wide setups. Concurrent presentation writes use the playlist revision. An export records authored inputs, the resolved profile definition and every effective endpoint in its run identity. Unknown profile identifiers are refused rather than silently choosing a different destination.

## Related

- [Gates and rungs](gates-and-rungs.md): the runtime governor and unchanged artistic route gates.
- [Camera](../model/camera.md) and [leaf](../model/leaf.md): presentation and the edge mixture.
- [Implementation](../implementation.md#session-settings): APIs, persistence, provisional values and verification.
