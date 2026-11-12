// Tests for midi.js's pure half: the MIDImix's wire (what a message is, and where on the desk it comes from) and the takeover
// steps (catch and glide). The Web MIDI wiring, the layers and the console are browser-only. Run: `bun test midi.test.js`.
import { expect, test } from "bun:test";
import { catchStep, ccSlot, decode, glideStep, noteSlot } from "./midi.js";

test("a control change is a CC with its value as a fraction, on any channel", () => {
  expect(decode([0xb0, 19, 0])).toEqual({ kind: "cc", cc: 19, u: 0 });
  expect(decode([0xb0, 19, 127])).toEqual({ kind: "cc", cc: 19, u: 1 });
  expect(decode([0xb5, 62, 64])).toEqual({ kind: "cc", cc: 62, u: 64 / 127 });
});

test("a note-on is a press; a note-off, or a note-on at velocity 0, is a release", () => {
  expect(decode([0x90, 25, 127])).toEqual({ kind: "down", note: 25 });
  expect(decode([0x90, 25, 0])).toEqual({ kind: "up", note: 25 });
  expect(decode([0x80, 25, 64])).toEqual({ kind: "up", note: 25 });
  expect(decode([0x93, 1, 127])).toEqual({ kind: "down", note: 1 });
});

test("anything else on the wire is nothing", () => {
  expect(decode([0xe0, 0, 64])).toBeNull();   // pitch bend
  expect(decode([0xf8])).toBeNull();          // clock
  expect(decode([0xc0, 3])).toBeNull();       // program change
});

test("the factory CCs are three knobs and a fader on each of eight strips, and the master fader", () => {
  const BASE = [16, 20, 24, 28, 46, 50, 54, 58];
  BASE.forEach((base, strip) => {
    for (let row = 0; row < 4; row++) expect(ccSlot(base + row)).toEqual({ strip, row });
  });
  expect(ccSlot(62)).toEqual({ strip: "master", row: 3 });
});

test("a CC off the desk has no place", () => {
  for (const cc of [0, 1, 15, 32, 45, 63, 64, 127]) expect(ccSlot(cc)).toBeNull();
});

test("the buttons: MUTE, SOLO-held MUTE and REC ARM per strip, the bank pair and SOLO", () => {
  expect(noteSlot(1)).toEqual({ strip: 0, button: "mute" });
  expect(noteSlot(2)).toEqual({ strip: 0, button: "solo" });
  expect(noteSlot(3)).toEqual({ strip: 0, button: "arm" });
  expect(noteSlot(22)).toEqual({ strip: 7, button: "mute" });
  expect(noteSlot(24)).toEqual({ strip: 7, button: "arm" });
  expect(noteSlot(25)).toEqual({ bank: -1 });
  expect(noteSlot(26)).toEqual({ bank: 1 });
  expect(noteSlot(27)).toEqual({ solo: true });
  const seen = new Set();
  for (let n = 1; n <= 24; n++) seen.add(JSON.stringify(noteSlot(n)));
  expect(seen.size).toBe(24);
  expect(noteSlot(0)).toBeNull();
  expect(noteSlot(28)).toBeNull();
});

test("catch: a hand away from the look's value moves nothing", () => {
  const st = catchStep({ caught: false, prev: null }, 0.8, 0.3);
  expect(st.caught).toBe(false);
  expect(catchStep(st, 0.7, 0.3).caught).toBe(false);   // nearer, not there
});

test("catch: a hand at the look's value takes it", () => {
  expect(catchStep({ caught: false, prev: null }, 0.31, 0.3).caught).toBe(true);
});

test("catch: a hand that passes the look's value between two messages takes it, whichever way", () => {
  expect(catchStep({ caught: false, prev: 0.8 }, 0.1, 0.3).caught).toBe(true);
  expect(catchStep({ caught: false, prev: 0.1 }, 0.8, 0.3).caught).toBe(true);
});

test("catch: once taken, the control follows wherever the hand goes", () => {
  const st = catchStep({ caught: true, prev: 0.3 }, 0.95, 0.3);
  expect(st).toEqual({ caught: true, prev: 0.95 });
});

test("glide: each step moves toward the hand, never past it, and lands on it exactly", () => {
  let x = 0;
  for (let i = 0; i < 400; i++) {
    const nx = glideStep(x, 1, 1 / 60);
    expect(nx).toBeGreaterThanOrEqual(x);
    expect(nx).toBeLessThanOrEqual(1);
    x = nx;
  }
  expect(x).toBe(1);
});

test("glide: the ease composes, so a frame split in two lands where the whole frame does", () => {
  const whole = glideStep(0, 1, 0.1), split = glideStep(glideStep(0, 1, 0.05), 1, 0.05);
  expect(split).toBeCloseTo(whole, 12);
});

test("glide: no time, no move", () => {
  expect(glideStep(0.2, 0.9, 0)).toBe(0.2);
});
