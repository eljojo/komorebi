# Web MIDI slider mapping — design

## Goal

Let a hardware MIDI controller drive the editor's parameter sliders. Bindings are
made by **MIDI learn** (arm a slider, wiggle a knob), use **soft takeover** so the
slider doesn't jump, and live for the **session only** (dropped on reload). Scope is
**range sliders only** — not toggles, selects, or buttons.

MIDI exists only in the editor path. `komorebi.js`, `player.html`, and the deploy
bundle (`komorebi.global.js` / `dist/`) are untouched.

## Architecture

A new ES module `midi.js` owns the whole MIDI subsystem, mirroring the project's
existing module split (`presets.js`, `presets-store.js`, `profiler.js`). `editor.js`
wires it to the existing control registry (`controlEls`, `params`, `PANEL`,
`applyScope`, `syncControl`).

```
hardware  ──► midi.js ──► setNorm(key, n) ──► editor.js: params[key], applyScope, syncControl
                 ▲                            (same path a mouse drag takes)
                 └── getNorm(key) ◄────────── editor.js (for soft-takeover compare)
                 └── onBind(key, label) ─────► editor.js (UI marker)
```

### `midi.js`

Exports `createMidi({ setNorm, getNorm, onBind })` returning
`{ arm, disarm, unbind, recapture, status, onStatusChange }`.

Responsibilities:

- **Access** — call `navigator.requestMIDIAccess()`. Attach a `midimessage`
  listener to every current input and, via `statechange`, to inputs that connect
  later. Maintain a human-readable `status` (e.g. `"no device"`,
  `"Launch Control connected"`, `"unsupported"`, `"permission denied"`).
- **Parse** — decode Control-Change messages only: status nibble `0xB` →
  `{ channel: 0..15, cc: 0..127, value: 0..127 }`. Ignore notes, clock, and other
  message types.
- **Bindings** — a `Map` keyed by CC identity (`` `${channel}:${cc}` ``) → an entry
  `{ key, captured: false }`. One CC drives one param; binding a CC already in use
  replaces the old entry. A given param key can be (re)bound; arming a key that was
  bound elsewhere removes the prior CC→key entry so a key maps from at most one CC.
- **Learn** — `arm(key)` sets a pending target. The next CC message creates/replaces
  that key's binding (`captured: false`), fires `onBind(key, label)` where `label` is
  e.g. `"ch1 cc74"`, and disarms. `disarm()` cancels with no binding.
- **Soft takeover** — for a bound CC, normalize `value/127` → `n ∈ [0,1]`. While the
  entry is not `captured`, compare `n` against `getNorm(key)`: stay silent until `n`
  crosses (reaches or passes) the current slider value, then set `captured = true`.
  Once captured, every message calls `setNorm(key, n)`.
- **`unbind(key)`** — remove whatever CC maps to `key`.

`midi.js` holds no DOM and no knowledge of slider ranges — it works purely in
normalized `[0,1]` space. All range/step/scope handling stays in `editor.js`.

### `editor.js` wiring

- **`setNorm(key, n)`** — look up the control's `[min, max, step]` from `PANEL`, map
  `n` → value, quantize to `step`, write `params[key]`, call the existing
  `applyScope(scope)` (or `updateSunFromTime()` for the `suntime` scope, matching the
  slider's own `input` handler) and `syncControl(key)`. This is the same mutation a
  mouse drag performs.
- **`getNorm(key)`** — inverse map from current `params[key]` to `[0,1]`.
- **Takeover reset on UI edit** — when a slider is changed by mouse/keyboard, reset
  that key's binding to `captured: false` via a `midi.recapture(key)` call, so the
  hardware knob must re-catch the new value before it moves the slider again. Called
  from the slider's existing `input` listener.
- **MIDI panel section** — a new `'h','MIDI'` block in `PANEL` containing:
  - a `learn` toggle,
  - a status line bound to `midi.status` / `onStatusChange`.
- **Learn interaction** — while `learn` is on, clicking a slider row arms that key
  (`midi.arm(key)`); the row shows `◌ waiting…`. The slider's normal drag is
  suppressed while learning so the click registers as "arm" not "drag". On `onBind`,
  the row shows its CC label (e.g. `cc74`). Clicking an already-bound row while
  learning calls `midi.unbind(key)` and clears the marker.
- **No-support path** — if `status` is `"unsupported"` or `"permission denied"`, the
  `learn` toggle is disabled and the status line explains; the rest of the editor is
  unaffected.

## Data flow

1. Page load → `editor.js` calls `createMidi({...})`; module requests MIDI access and
   reports `status`.
2. User toggles `learn` on, clicks the `sun_elevation_deg` row → `midi.arm('sun_elevation_deg')`, row shows `◌ waiting…`.
3. User turns a knob → first CC binds it (`onBind` → row shows `cc74`), learn disarms.
4. User turns the knob further → soft takeover: nothing moves until the knob crosses
   the slider's current position, then the slider tracks the knob, re-baking the look
   through the normal `applyScope` path.
5. User drags that slider with the mouse → its binding's `captured` resets; the knob
   must re-catch before it drives again.
6. Reload → all bindings gone.

## Error handling

- No Web MIDI API (`navigator.requestMIDIAccess` undefined) → `status = "unsupported"`,
  learn disabled.
- Access promise rejects (permission denied) → `status = "permission denied"`, learn
  disabled.
- Non-CC messages → ignored.
- A bound CC whose param key somehow isn't a known control → entry ignored on apply.

## Testing

`midi.js` core logic is pure over a fake message stream and unit-tested in the existing
`*.test.js` setup (no browser):

- **Parse** — raw `[status, d1, d2]` arrays → correct `{channel, cc, value}`; non-CC
  status bytes rejected.
- **Learn** — arming a key then feeding a CC creates the binding and fires `onBind`;
  re-arming the same key from a different CC moves the binding.
- **Soft takeover** — with `getNorm` stubbed, incoming values below the current value
  produce no `setNorm`; the first value that crosses captures, and subsequent values
  pass through.
- **Recapture** — after a takeover reset, the knob must re-cross before `setNorm` fires
  again.

DOM wiring in `editor.js` (panel section, row markers, click-to-arm) is verified
manually in the served editor (`nix run .#dev`) — handed back, not auto-run.

## Out of scope

- Persisting mappings across reloads (localStorage).
- Mapping toggles, selects, or buttons.
- Relative/encoder mode and absolute "jump" pickup (soft takeover only).
- MIDI output, device picking UI (all inputs are listened to), per-channel filtering.
- `player.html` and the deploy bundle.
