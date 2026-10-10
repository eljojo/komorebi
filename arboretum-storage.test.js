// Tests for arboretum.js's storage — everything the editor keeps in localStorage, with no network: the ★ looks
// (komorebi.presets) and arboretum's state (komorebi.arboretum: origin records, cached playlists, who you were).
// Run: `bun test arboretum-storage.test.js`. bun has no localStorage, so each test installs a fresh in-memory shim.
import { test, expect, beforeEach } from "bun:test";
import { ARB_KEY, LS_KEY, MIRROR_KEY, getMirror, getPreset, getState, getStored, setMirror, setState, setStored } from "./arboretum.js";
import { emptyMirror } from "./playlists.js";
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


// ---- the mirror: a complete copy of your cloud, for when arboretum cannot be reached ----

const bigPreset = (id, kb) => ({ id, version: 1, owner: "jo", name: `p${id}`, params: { pad: "x".repeat(kb * 1024) } });
const mirrorWith = (n, kb, queue = []) => {
  const presets = Array.from({ length: n }, (_, i) => bigPreset(n - i, kb));   // newest first: ids n..1
  return { ...emptyMirror(), at: 5, order: presets.map((p) => p.id), presets: Object.fromEntries(presets.map((p) => [p.id, p])), queue };
};
// a localStorage whose setItem throws (as a full quota does) for any one value longer than `limit`
const withQuota = (limit) => {
  const set = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (String(v).length > limit) throw new DOMException("quota", "QuotaExceededError"); set(k, v); };
};

test("getMirror is the empty mirror when nothing is stored, when the value is corrupt, and when it is not v1", () => {
  expect(getMirror()).toEqual(emptyMirror());
  localStorage.setItem(MIRROR_KEY, "}{ not json");
  expect(getMirror()).toEqual(emptyMirror());
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ v: 2, order: [1] }));
  expect(getMirror()).toEqual(emptyMirror());
});

test("setMirror / getMirror round-trips, and fills in what a stored mirror lacks", () => {
  const m = mirrorWith(3, 1, [{ seq: 1, kind: "preset", path: "/api/presets", body: { name: "q", params: {} } }]);
  expect(setMirror(m)).toBe(true);
  expect(getMirror()).toEqual(m);
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ v: 1, at: 9 }));
  expect(getMirror()).toEqual({ ...emptyMirror(), at: 9 });
});

test("the mirror lives under its own key, apart from the ★ looks and arboretum's state", () => {
  setMirror(mirrorWith(1, 1));
  setStored({ a: { exposure: 1 } });
  setState({ v: 1, me: { username: "jo" }, origin: {}, playlists: {} });
  setState({ v: 1, me: null, origin: {}, playlists: {} });   // signing out clears who you were, not the copy of what you own
  expect(Object.keys(getMirror().presets)).toEqual(["1"]);
  expect(getStored()).toEqual({ a: { exposure: 1 } });
});

test("when the quota is hit, the newest presets that fit are kept, the copy says it is incomplete, and no waiting save is lost", () => {
  withQuota(40 * 1024);
  const queue = [1, 2, 3].map((seq) => ({ seq, kind: "preset", path: "/api/presets", body: { name: `waiting ${seq}`, params: { pad: "y".repeat(2 * 1024) } } }));
  const wrote = setMirror(mirrorWith(20, 4, queue));   // 80 KB of presets against a 40 KB quota
  const got = getMirror();
  expect(wrote).toBe(true);
  expect(got.incomplete).toBe(true);
  expect(got.queue.map((q) => q.body.name)).toEqual(["waiting 1", "waiting 2", "waiting 3"]);
  const kept = got.order.length;
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(20);
  expect(got.order).toEqual(Array.from({ length: kept }, (_, i) => 20 - i));   // the newest, in order
  expect(Object.keys(got.presets).length).toBe(kept);
});

test("a mirror that fits is not marked incomplete, even if the last one was", () => {
  setMirror({ ...mirrorWith(2, 1), incomplete: true });
  expect(getMirror().incomplete).toBe(false);
});

test("when even the waiting saves alone do not fit, setMirror says so — and what was stored before is left as it was", () => {
  setMirror(mirrorWith(1, 1));
  withQuota(1024);
  const wrote = setMirror(mirrorWith(0, 1, [{ seq: 1, kind: "preset", path: "/api/presets", body: { name: "big", params: { pad: "y".repeat(8 * 1024) } } }]));
  expect(wrote).toBe(false);
  expect(Object.keys(getMirror().presets)).toEqual(["1"]);
});
