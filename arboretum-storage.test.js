// Tests for arboretum.js's storage — everything the editor keeps in localStorage, with no network: the ★ looks
// (komorebi.presets) and arboretum's state (komorebi.arboretum: origin records, cached playlists, who you were).
// Run: `bun test arboretum-storage.test.js`. bun has no localStorage, so each test installs a fresh in-memory shim.
import { test, expect, beforeEach } from "bun:test";
import { ARB_KEY, LS_KEY, getPreset, getState, getStored, setState, setStored } from "./arboretum.js";
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

const EMPTY = { v: 1, me: null, origin: {}, playlists: {} };

// ---- the ★ looks ----

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

// ---- arboretum's state ----


test("getState is the empty v1 object when nothing is stored", () => {
  expect(getState()).toEqual(EMPTY);
});

test("getState is the empty v1 object when the value is corrupt", () => {
  localStorage.setItem(ARB_KEY, "}{ not json");
  expect(getState()).toEqual(EMPTY);
  localStorage.setItem(ARB_KEY, "[1,2]");
  expect(getState()).toEqual(EMPTY);
  localStorage.setItem(ARB_KEY, JSON.stringify({ v: 2, origin: { a: { parent: "look:x" } } }));
  expect(getState()).toEqual(EMPTY);
});

test("setState / getState round-trips", () => {
  const s = { v: 1, me: { username: "jo" }, origin: { a: { id: 3, version: 1, owner: "jo", synced: true } }, playlists: {} };
  setState(s);
  expect(getState()).toEqual(s);
});

test("getState fills in the fields a stored v1 object lacks", () => {
  localStorage.setItem(ARB_KEY, JSON.stringify({ v: 1, me: { username: "jo" } }));
  expect(getState()).toEqual({ ...EMPTY, me: { username: "jo" } });
});

test("setState never throws without localStorage; getState degrades to empty", () => {
  delete globalThis.localStorage;
  expect(() => setState(EMPTY)).not.toThrow();
  expect(getState()).toEqual(EMPTY);
});

