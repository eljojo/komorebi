# Web MIDI Slider Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a hardware MIDI controller drive the editor's parameter sliders via MIDI-learn, with soft takeover, bindings living for the session only.

**Architecture:** A new ES module `midi.js` owns all MIDI logic (parsing, bindings, learn, soft-takeover) in normalized `[0,1]` space with no DOM. `editor.js` wires it to the existing control registry: maps `[0,1]` ↔ each slider's `[min,max,step]`, drives the same `applyScope`/`syncControl` path a mouse drag uses, and adds a "MIDI" panel section with a global learn toggle and click-to-arm.

**Tech Stack:** Vanilla ES modules, Web MIDI API, `bun:test` for unit tests, biome for lint.

---

## File Structure

- **Create `midi.js`** — the MIDI subsystem. Exports `parseCC(data)` (pure) and `createMidi({setNorm,getNorm,onBind})` returning `{ start, feed, arm, disarm, unbind, recapture, bound, onStatusChange, get status }`. No DOM, no slider-range knowledge — works in `[0,1]`.
- **Create `midi.test.js`** — `bun:test` unit tests for parse, bind/learn, soft-takeover, recapture, and status.
- **Modify `editor.js`** — build `SLIDER_SPEC` from `PANEL`; add `getControlNorm`/`setControlNorm`; instantiate + `start()` the MIDI controller; call `recapture` from the slider `input` handler; add the MIDI panel section + click-to-arm + binding tags.
- **Modify `index.html`** — small CSS for the binding tag and armed/status rows.

MIDI is editor-only. `komorebi.js`, `player.html`, `komorebi.global.js`, and `dist/` are untouched.

---

## Task 1: `parseCC` — decode Control-Change messages

**Files:**
- Create: `midi.js`
- Test: `midi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// midi.test.js — pure MIDI logic, no DOM. Run: `bun test midi.test.js`.
import { test, expect } from "bun:test";
import { parseCC, createMidi } from "./midi.js";

test("parseCC decodes a Control-Change message", () => {
  // 0xB0 = CC on channel 0; data1 = cc number, data2 = value
  expect(parseCC([0xB0, 74, 100])).toEqual({ channel: 0, cc: 74, value: 100 });
  expect(parseCC([0xB5, 7, 0])).toEqual({ channel: 5, cc: 7, value: 0 });
});

test("parseCC rejects non-CC and malformed messages", () => {
  expect(parseCC([0x90, 60, 100])).toBeNull(); // Note On, not CC
  expect(parseCC([0xF8])).toBeNull();           // clock
  expect(parseCC([0xB0, 74])).toBeNull();       // too short
  expect(parseCC(null)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test midi.test.js`
Expected: FAIL — `parseCC` is not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```js
// midi.js — Web MIDI for the editor: parse CC, hold session bindings, MIDI-learn,
// soft takeover. Pure [0,1] logic + a thin navigator.requestMIDIAccess wiring in
// start(). No DOM; editor.js maps [0,1] to each slider's range. (spec: docs/superpowers/specs/2026-06-16-web-midi-mapping-design.md)

const ccId = (channel, cc) => `${channel}:${cc}`;

// Decode a raw MIDI data array into a Control-Change event, or null for anything else.
export function parseCC(data) {
  if (!data || data.length < 3) return null;
  if ((data[0] & 0xf0) !== 0xb0) return null;          // 0xB_ = Control Change
  return { channel: data[0] & 0x0f, cc: data[1], value: data[2] };
}
```

- [ ] **Step 4: Run test to verify parse tests pass**

Run: `bun test midi.test.js -t parseCC`
Expected: PASS for both parseCC tests (the `createMidi` import will still resolve undefined; later tasks add it).

- [ ] **Step 5: Commit**

```bash
git add midi.js midi.test.js
git commit -m "feat: parseCC — decode MIDI Control-Change messages"
```

---

## Task 2: `createMidi` — bindings + MIDI-learn

**Files:**
- Modify: `midi.js`
- Test: `midi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to midi.test.js
function harness() {
  const sets = [];                       // [key, n] applied via setNorm
  let cur = 0;                           // value getNorm returns
  const binds = [];                      // [key, label] reported via onBind
  const m = createMidi({
    setNorm: (key, n) => sets.push([key, n]),
    getNorm: () => cur,
    onBind: (key, label) => binds.push([key, label]),
  });
  return { m, sets, binds, setCur: (v) => { cur = v; } };
}

test("arm + next CC binds that key and reports a label", () => {
  const { m, binds } = harness();
  m.arm("exposure");
  m.feed([0xB0, 74, 64]);
  expect(binds).toEqual([["exposure", "cc74"]]);
  expect(m.bound("exposure")).toBe("cc74");
});

test("re-arming a key moves its binding to the new CC (one CC per key)", () => {
  const { m } = harness();
  m.arm("exposure"); m.feed([0xB0, 74, 64]);
  m.arm("exposure"); m.feed([0xB0, 7, 64]);
  expect(m.bound("exposure")).toBe("cc7");
  // the old CC74 must no longer drive exposure
  const before = m.bound("exposure");
  m.feed([0xB0, 74, 127]);
  expect(m.bound("exposure")).toBe(before);
});

test("unbind removes the mapping", () => {
  const { m } = harness();
  m.arm("contrast"); m.feed([0xB0, 20, 64]);
  m.unbind("contrast");
  expect(m.bound("contrast")).toBeNull();
});

test("disarm cancels learn with no binding", () => {
  const { m, binds } = harness();
  m.arm("contrast"); m.disarm();
  m.feed([0xB0, 20, 64]);
  expect(binds).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test midi.test.js -t "binds that key"`
Expected: FAIL — `createMidi` is not defined.

- [ ] **Step 3: Write minimal implementation**

```js
// append to midi.js
export function createMidi({ setNorm, getNorm, onBind }) {
  const bindings = new Map();            // ccId -> { key, label, captured, side }
  let armedKey = null;
  let status = "unsupported";
  const statusFns = [];
  const setStatus = (s) => { status = s; for (const f of statusFns) f(s); };

  function bound(key) {
    for (const b of bindings.values()) if (b.key === key) return b.label;
    return null;
  }
  function unbind(key) {
    for (const [id, b] of bindings) if (b.key === key) bindings.delete(id);
  }

  function ingest(ev) {                  // ev = { channel, cc, value }
    const id = ccId(ev.channel, ev.cc);
    if (armedKey !== null) {
      unbind(armedKey);                  // one CC per key
      const label = `cc${ev.cc}`;
      bindings.set(id, { key: armedKey, label, captured: false, side: undefined });
      const key = armedKey; armedKey = null;
      onBind(key, label);
      return;
    }
    const b = bindings.get(id);
    if (!b) return;
    applyValue(b, ev.value / 127);       // soft takeover — implemented in Task 3
  }

  function applyValue(b, n) {            // placeholder; Task 3 replaces this
    setNorm(b.key, n);
  }

  function feed(data) { const ev = parseCC(data); if (ev) ingest(ev); }

  return {
    feed, bound, unbind,
    arm: (key) => { armedKey = key; },
    disarm: () => { armedKey = null; },
    onStatusChange: (f) => { statusFns.push(f); },
    get status() { return status; },
    // start, recapture added in later tasks
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test midi.test.js`
Expected: PASS — all Task 1 + Task 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add midi.js midi.test.js
git commit -m "feat: MIDI bindings + learn (one CC per key)"
```

---

## Task 3: Soft takeover + `recapture`

**Files:**
- Modify: `midi.js`
- Test: `midi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to midi.test.js
test("soft takeover: slider stays put until the knob crosses its value", () => {
  const { m, sets, setCur } = harness();
  setCur(0.5);                           // slider currently at 50%
  m.arm("exposure"); m.feed([0xB0, 74, 100]); // bind at ~0.79 (above 0.5)
  expect(sets).toEqual([]);              // knob is above the slider — no move yet
  m.feed([0xB0, 74, 90]);                // still above 0.5 (~0.71)
  expect(sets).toEqual([]);
  m.feed([0xB0, 74, 63]);                // ~0.496 — crossed below 0.5: capture
  expect(sets.length).toBe(1);
  expect(sets[0][0]).toBe("exposure");
  m.feed([0xB0, 74, 30]);                // captured: every message now passes through
  expect(sets.length).toBe(2);
  expect(sets[1][1]).toBeCloseTo(30 / 127, 5);
});

test("recapture re-arms soft takeover after a manual edit", () => {
  const { m, sets, setCur } = harness();
  setCur(0.2);
  m.arm("exposure"); m.feed([0xB0, 74, 10]); // bind below current, side = -1
  m.feed([0xB0, 74, 60]);                // crossed up past 0.2: capture + apply
  expect(sets.length).toBe(1);
  setCur(0.9);                            // user dragged the slider up to 90%
  m.recapture("exposure");
  m.feed([0xB0, 74, 70]);                // ~0.55, below 0.9 — must NOT move yet
  expect(sets.length).toBe(1);
  m.feed([0xB0, 74, 120]);               // ~0.94, crossed above 0.9: capture
  expect(sets.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test midi.test.js -t "soft takeover"`
Expected: FAIL — placeholder `applyValue` passes everything through, and `recapture` is undefined.

- [ ] **Step 3: Write minimal implementation**

Replace the placeholder `applyValue` in `midi.js` with the takeover version, and add `recapture` to the returned object:

```js
// replace applyValue(b, n) with:
function applyValue(b, n) {
  if (!b.captured) {
    const cur = getNorm(b.key);
    const side = Math.sign(n - cur);     // which side of the slider the knob is on
    if (b.side === undefined && side !== 0) { b.side = side; return; }  // record, wait
    if (side !== 0 && side === b.side) return;                          // same side, keep waiting
    b.captured = true; b.side = undefined;                              // crossed (or exact) → grab it
  }
  setNorm(b.key, n);
}
```

```js
// add to the returned object (alongside feed, bound, unbind, …):
    recapture: (key) => {
      for (const b of bindings.values())
        if (b.key === key) { b.captured = false; b.side = undefined; }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test midi.test.js`
Expected: PASS — all tests through Task 3 green.

- [ ] **Step 5: Commit**

```bash
git add midi.js midi.test.js
git commit -m "feat: soft-takeover value pickup + recapture"
```

---

## Task 4: `start()` — Web MIDI access + status

**Files:**
- Modify: `midi.js`
- Test: `midi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to midi.test.js
test("start reports 'unsupported' with no Web MIDI access fn", async () => {
  const { m } = harness();
  let s; m.onStatusChange((v) => { s = v; });
  await m.start(null);
  expect(s).toBe("unsupported");
});

test("start reports 'permission denied' when access rejects", async () => {
  const { m } = harness();
  let s; m.onStatusChange((v) => { s = v; });
  await m.start(async () => { throw new Error("denied"); });
  expect(s).toBe("permission denied");
});

test("start wires inputs and feeds CC through to bindings", async () => {
  const { m, sets, setCur } = harness();
  setCur(0);
  let handler = null;
  const input = { name: "Nano", set onmidimessage(f) { handler = f; } };
  const access = { inputs: new Map([["a", input]]), set onstatechange(f) {} };
  let s; m.onStatusChange((v) => { s = v; });
  await m.start(async () => access);
  expect(s).toBe("Nano connected");
  m.arm("exposure"); handler({ data: [0xB0, 74, 0] });   // bind
  handler({ data: [0xB0, 74, 64] });                     // drive (cur=0, crosses up)
  expect(sets.length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test midi.test.js -t start`
Expected: FAIL — `m.start` is not a function.

- [ ] **Step 3: Write minimal implementation**

Add `start` to `createMidi`'s returned object. `req` is the access function (injectable for tests); in the browser `editor.js` calls `start()` with no arg.

```js
// inside createMidi, before the return:
  async function start(req = (typeof navigator !== "undefined" && navigator.requestMIDIAccess)
                              ? navigator.requestMIDIAccess.bind(navigator) : null) {
    if (!req) { setStatus("unsupported"); return; }
    let access;
    try { access = await req({ sysex: false }); }
    catch { setStatus("permission denied"); return; }
    const wire = () => {
      const inputs = [...access.inputs.values()];
      for (const input of inputs) input.onmidimessage = (e) => feed(e.data);
      setStatus(inputs.length ? `${inputs[0].name} connected` : "no device");
    };
    access.onstatechange = wire;
    wire();
  }
```

Add `start,` to the returned object literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test midi.test.js`
Expected: PASS — every `midi.test.js` test green.

- [ ] **Step 5: Commit**

```bash
git add midi.js midi.test.js
git commit -m "feat: Web MIDI access + connection status"
```

---

## Task 5: Wire the MIDI controller into the editor

**Files:**
- Modify: `editor.js` (import at top near line 4; `SLIDER_SPEC` + helpers after `PANEL` ~line 146; instantiate after `buildPanel()` ~line 513; `recapture` in slider `input` handler line 161-162)

- [ ] **Step 1: Add the import**

At the top of `editor.js`, after the existing imports (line 4):

```js
import { createMidi } from './midi.js';
```

- [ ] **Step 2: Add the slider-spec map + norm helpers**

Immediately after the `PANEL` array closes (after line 145), add:

```js
// ---- MIDI: map each slider's [min,max,step] so a 0..1 CC value can drive it ----
const SLIDER_SPEC = {};   // key -> {min,max,step,scope}, sliders only (CC maps to these)
for (const it of PANEL) if (it[0] === 's') { const [,k,,min,max,step,scope] = it; SLIDER_SPEC[k] = { min, max, step, scope }; }

function getControlNorm(key){ const s = SLIDER_SPEC[key]; if(!s) return 0;
  return clamp((params[key] - s.min) / (s.max - s.min), 0, 1); }
function setControlNorm(key, n){ const s = SLIDER_SPEC[key]; if(!s) return;
  let v = s.min + clamp(n, 0, 1) * (s.max - s.min);
  v = clamp(Math.round((v - s.min) / s.step) * s.step + s.min, s.min, s.max);   // snap to the slider's step
  params[key] = v;
  if (s.scope === 'suntime') updateSunFromTime(); else applyScope(s.scope);     // same path a drag takes
  syncControl(key);
}
```

- [ ] **Step 3: Declare the controller and reset takeover on manual edits**

Add a module-scoped declaration near the other editor state (e.g. just below the `SLIDER_SPEC` block):

```js
let midi;   // assigned at init (after buildPanel); referenced by the slider input handler below
```

In the slider `input` listener (currently lines 161-162), append a `recapture` call so a mouse/keyboard edit forces the knob to re-catch:

```js
      inp.addEventListener('input',()=>{ params[key]=parseFloat(inp.value); val.textContent=fmt(params[key]);
        if(scope==='suntime') updateSunFromTime(); else applyScope(scope);
        if(midi) midi.recapture(key); });
```

- [ ] **Step 4: Instantiate + start after the panel exists**

After `buildPanel();` (line 513), add:

```js
midi = createMidi({
  setNorm: (key, n) => setControlNorm(key, n),
  getNorm: (key) => getControlNorm(key),
  onBind: (key, label) => setMidiTag(key, label),   // setMidiTag defined in Task 6
});
midi.start();
```

- [ ] **Step 5: Lint**

Run: `nix run .#lint -- editor.js midi.js`
Expected: no errors. (`setMidiTag` is defined in Task 6 — if lint flags it as undefined, proceed; Task 6 adds it before any manual run.)

- [ ] **Step 6: Commit**

```bash
git add editor.js
git commit -m "feat: drive editor sliders from MIDI bindings"
```

---

## Task 6: MIDI panel section — learn toggle, click-to-arm, binding tags

**Files:**
- Modify: `editor.js` (add `buildMidiUI` + arm/tag helpers + delegated pointerdown; call `buildMidiUI()` after the `midi.start()` line from Task 5)
- Modify: `index.html` (CSS for `.midi-tag`)

- [ ] **Step 1: Add the tag + arm helpers and the learn UI**

After the `midi.start();` block (Task 5, ~line 513+), add:

```js
// ---- MIDI panel: a global 'learn' toggle; while on, click a slider to arm it,
// then wiggle a knob to bind. Bound sliders show their CC#; click again to unbind. ----
let midiLearn = false, midiArmedKey = null;
function midiRow(key){ const c = controlEls[key]; return c && c.input.closest('.ctl'); }
function setMidiTag(key, text){ const row = midiRow(key); if(!row) return;   // text=null clears
  let t = row.querySelector('.midi-tag');
  if(!text){ if(t) t.remove(); return; }
  if(!t){ t = document.createElement('span'); t.className = 'midi-tag'; row.appendChild(t); }
  t.textContent = text;
}
function buildMidiUI(){
  const h = document.createElement('h2'); h.textContent = 'MIDI'; h.dataset.tipKey = 'MIDI'; dev.appendChild(h);
  const row = document.createElement('div'); row.className = 'ctl toggle';
  const lab = document.createElement('label'); lab.textContent = 'learn';
  const inp = document.createElement('input'); inp.type = 'checkbox';
  inp.addEventListener('change', ()=>{ midiLearn = inp.checked;
    if(!midiLearn && midiArmedKey && !midi.bound(midiArmedKey)){ setMidiTag(midiArmedKey, null); midiArmedKey = null; } });
  row.append(lab, inp); dev.appendChild(row);
  const stat = document.createElement('div'); stat.className = 'ctl'; stat.style.color = '#9fb89f';
  const sync = (s)=>{ stat.textContent = s;
    const off = (s === 'unsupported' || s === 'permission denied'); inp.disabled = off; };
  sync(midi.status); midi.onStatusChange(sync);
  dev.appendChild(stat);
}
buildMidiUI();

// While learn is on, a pointerdown on a slider row arms it (or unbinds it) instead of dragging.
// Capture phase + preventDefault so the range input doesn't start a drag.
dev.addEventListener('pointerdown', (e)=>{
  if(!midiLearn) return;
  const row = e.target.closest('.ctl'); if(!row) return;
  const key = row.dataset.tipKey;
  if(!SLIDER_SPEC[key]) return;                       // sliders only
  e.preventDefault(); e.stopPropagation();
  if(midiArmedKey && midiArmedKey !== key && !midi.bound(midiArmedKey)) setMidiTag(midiArmedKey, null);
  if(midi.bound(key)){ midi.unbind(key); setMidiTag(key, null); midiArmedKey = null; }   // bound → unbind
  else { midi.arm(key); midiArmedKey = key; setMidiTag(key, '◌'); }                      // free → arm
}, true);
```

Note: `onBind` (set in Task 5) calls `setMidiTag(key, label)`, which replaces the `◌` with the CC label automatically when the knob is wiggled.

- [ ] **Step 2: Add the tag CSS**

In `index.html`, after the `.ctl .val` rule (line 40), add:

```css
  .ctl .midi-tag { flex:0 0 auto; margin-left:6px; color:#e8b06a; font-size:10px; }
```

- [ ] **Step 3: Lint**

Run: `nix run .#lint -- editor.js`
Expected: no errors.

- [ ] **Step 4: Manual verification (handed back — needs a browser + a MIDI device)**

Run: `nix run .#dev`, open http://localhost:8000, click "feel", press **D** for the dev panel. Verify:
1. A **MIDI** section appears at the bottom with a `learn` toggle and a status line ("no device" or "<name> connected"). With no Web MIDI support the toggle is disabled and the line reads "unsupported".
2. Toggle `learn` on, click a slider (e.g. `exposure`) → an amber `◌` appears on that row.
3. Wiggle a hardware knob → `◌` becomes `cc<NN>`; learn no longer waiting.
4. Turn the knob: the slider doesn't move until the knob crosses the slider's current position, then tracks it and the look updates.
5. Drag that slider with the mouse; turn the knob again → it must re-cross before moving (soft takeover reset).
6. With `learn` on, click the bound slider → tag clears (unbound); the knob no longer drives it.
7. Reload → all bindings gone.

- [ ] **Step 5: Commit**

```bash
git add editor.js index.html
git commit -m "feat: MIDI learn panel — toggle, click-to-arm, binding tags"
```

---

## Task 7: Final lint + spec sync

**Files:**
- Modify: none expected (verification task)

- [ ] **Step 1: Full lint**

Run: `nix run .#lint`
Expected: no errors across all hand-written JS.

- [ ] **Step 2: Full test run**

Run: `bun test`
Expected: all suites pass, including `midi.test.js`.

- [ ] **Step 3: Spec sync check**

Per `MEMORY.md` ([keep-spec-in-sync]), check whether `komorebi-spec.md` documents editor input methods. MIDI mapping is an editor-only input (like sun-drag), not an engine model change. If the spec enumerates editor input methods, add a one-line note; otherwise no change. Do not invent a section.

- [ ] **Step 4: Commit (only if the spec changed)**

```bash
git add komorebi-spec.md
git commit -m "docs: note MIDI slider mapping as an editor input"
```

---

## Self-Review Notes

- **Spec coverage:** parse (T1), bindings/learn/one-CC-per-key (T2), soft-takeover + recapture-on-edit (T3), access + status + no-support path (T4), `[0,1]`↔range mapping + same applyScope path + recapture wiring (T5), global learn toggle + click-to-arm + tags + session-only/no-persistence + sliders-only (T6). Out-of-scope items (persistence, toggles/selects, player.html, bundle) are not implemented — correct.
- **Type/name consistency:** `createMidi` returns `{ start, feed, arm, disarm, unbind, recapture, bound, onStatusChange, status }` — every name editor.js calls (`start`, `recapture`, `bound`, `unbind`, `arm`, `onStatusChange`, `status`) is defined. `setMidiTag`/`SLIDER_SPEC`/`midi` are referenced before their defining task only across the T5→T6 boundary (noted in T5 Step 5); both exist before any manual browser run.
- **Soft-takeover note:** on bind, the first message records `side` and does not apply (matches the T3 test feeding bind-then-cross). If a controller binds exactly at the current value (`side === 0`), it captures immediately.
