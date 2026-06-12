// Tests for presets-store.js — pure localStorage persistence. Run: `bun test presets-store.test.js`.
// bun has no localStorage, so each test installs a fresh in-memory shim.
import { test, expect, beforeEach } from "bun:test";
import { LS_KEY, getStored, setStored, getPreset } from "./presets-store.js";
import { PRESETS } from "./presets.js";

beforeEach(() => {
  let store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
});

test("setStored / getStored round-trips an object", () => {
  setStored({ "my look": { exposure: 2 } });
  expect(getStored()).toEqual({ "my look": { exposure: 2 } });
});

test("getStored is {} when empty or corrupt", () => {
  expect(getStored()).toEqual({});
  localStorage.setItem(LS_KEY, "}{ not json");
  expect(getStored()).toEqual({});
});

test("getPreset falls back to a built-in when the name isn't saved", () => {
  expect(getPreset("afternoon 7")).toBe(PRESETS["afternoon 7"]);
  expect(getPreset("nope")).toBeUndefined();
});

test("a saved ★ look shadows the built-in of the same name", () => {
  const mine = { exposure: 9, _mine: true };
  setStored({ "afternoon 7": mine });
  expect(getPreset("afternoon 7")).toEqual(mine);
  expect(getPreset("afternoon 7")).not.toBe(PRESETS["afternoon 7"]);
});

test("setStored never throws without localStorage; getStored degrades to {}", () => {
  delete globalThis.localStorage;
  expect(() => setStored({ a: 1 })).not.toThrow();
  expect(getStored()).toEqual({});
});
