// Tests for midi.js — pure MIDI logic, no DOM. Run: `bun test midi.test.js`.
import { test, expect } from "bun:test";
import { parseCC, createMidi } from "./midi.js";

test("parseCC decodes a Control-Change message", () => {
  // 0xB0 = CC on channel 0; data1 = cc number, data2 = value
  expect(parseCC([0xb0, 74, 100])).toEqual({ channel: 0, cc: 74, value: 100 });
  expect(parseCC([0xb5, 7, 0])).toEqual({ channel: 5, cc: 7, value: 0 });
});

test("parseCC rejects non-CC and malformed messages", () => {
  expect(parseCC([0x90, 60, 100])).toBeNull(); // Note On, not CC
  expect(parseCC([0xf8])).toBeNull();           // clock
  expect(parseCC([0xb0, 74])).toBeNull();       // too short
  expect(parseCC(null)).toBeNull();
});

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
  m.feed([0xb0, 74, 64]);
  expect(binds).toEqual([["exposure", "cc74"]]);
  expect(m.bound("exposure")).toBe("cc74");
});

test("re-arming a key moves its binding to the new CC (one CC per key)", () => {
  const { m } = harness();
  m.arm("exposure"); m.feed([0xb0, 74, 64]);
  m.arm("exposure"); m.feed([0xb0, 7, 64]);
  expect(m.bound("exposure")).toBe("cc7");
  // the old CC74 must no longer drive exposure
  const before = m.bound("exposure");
  m.feed([0xb0, 74, 127]);
  expect(m.bound("exposure")).toBe(before);
});

test("unbind removes the mapping", () => {
  const { m } = harness();
  m.arm("contrast"); m.feed([0xb0, 20, 64]);
  m.unbind("contrast");
  expect(m.bound("contrast")).toBeNull();
});

test("disarm cancels learn with no binding", () => {
  const { m, binds } = harness();
  m.arm("contrast"); m.disarm();
  m.feed([0xb0, 20, 64]);
  expect(binds).toEqual([]);
});

test("soft takeover: slider stays put until the knob crosses its value", () => {
  const { m, sets, setCur } = harness();
  setCur(0.5);                           // slider currently at 50%
  m.arm("exposure"); m.feed([0xb0, 74, 100]); // bind at ~0.79 (above 0.5)
  expect(sets).toEqual([]);              // knob is above the slider — no move yet
  m.feed([0xb0, 74, 90]);                // still above 0.5 (~0.71)
  expect(sets).toEqual([]);
  m.feed([0xb0, 74, 63]);                // ~0.496 — crossed below 0.5: capture
  expect(sets.length).toBe(1);
  expect(sets[0][0]).toBe("exposure");
  m.feed([0xb0, 74, 30]);                // captured: every message now passes through
  expect(sets.length).toBe(2);
  expect(sets[1][1]).toBeCloseTo(30 / 127, 5);
});

test("recapture re-arms soft takeover after a manual edit", () => {
  const { m, sets, setCur } = harness();
  setCur(0.2);
  m.arm("exposure"); m.feed([0xb0, 74, 10]); // bind below current, side = -1
  m.feed([0xb0, 74, 60]);                // crossed up past 0.2: capture + apply
  expect(sets.length).toBe(1);
  setCur(0.9);                            // user dragged the slider up to 90%
  m.recapture("exposure");
  m.feed([0xb0, 74, 70]);                // ~0.55, below 0.9 — must NOT move yet
  expect(sets.length).toBe(1);
  m.feed([0xb0, 74, 120]);               // ~0.94, crossed above 0.9: capture
  expect(sets.length).toBe(2);
});

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
  const access = { inputs: new Map([["a", input]]), set onstatechange(_f) {} };
  let s; m.onStatusChange((v) => { s = v; });
  await m.start(async () => access);
  expect(s).toBe("Nano connected");
  m.arm("exposure"); handler({ data: [0xb0, 74, 0] });   // bind
  handler({ data: [0xb0, 74, 64] });                     // drive (cur=0, crosses up)
  expect(sets.length).toBe(1);
});
