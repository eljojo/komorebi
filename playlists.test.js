// Tests for playlists.js — the pure playlist model beside presets-store.js. Run: `bun test playlists.test.js`.
// bun has no localStorage, so each test installs a fresh in-memory shim (the presets-store.test.js pattern).
import { test, expect, beforeEach } from "bun:test";
import { ARB_KEY, getState, setState, detect, parseHash, entries, resolve, step, builtinTwin,
  cachePlaylist, dropPlaylist, savePreset, onSaved, onDeleted, onPushed,
  uploadPlan, itemsAfter, playlists, plays, timing, starValue, starName, entryName,
  fromEntry, onlineId, pushButton, placeChange } from "./playlists.js";
import * as builtins from "./presets.js";
import { DEFAULTS, cameraFor } from "./komorebi.js";

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

// ---- state ------------------------------------------------------------------

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

// ---- detect: the one gate (design §1) --------------------------------------------

const loc = (hostname, pathname, origin = `https://${hostname}`) => ({ hostname, pathname, origin });
const fakeFetch = (answer) => {
  const calls = [];
  const f = async (url) => { calls.push(url); return answer; };
  f.calls = calls;
  return f;
};
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("detect: the production host is arboretum.eljojo.net, with no request", async () => {
  const f = fakeFetch(json(200, {}));
  expect(await detect(loc("komorebi.eljojo.net", "/"), f)).toBe("https://arboretum.eljojo.net");
  expect(f.calls).toEqual([]);
});

test("detect: a fork's host is null, with no request", async () => {
  const f = fakeFetch(json(200, { ok: true, engine: "abc" }));
  expect(await detect(loc("someone.github.io", "/komorebi/"), f)).toBeNull();
  expect(await detect(loc("komorebi.example.com", "/editor/"), f)).toBeNull();
  expect(f.calls).toEqual([]);
});

test("detect: localhost outside /editor/ is null, with no request", async () => {
  const f = fakeFetch(json(200, { ok: true, engine: "abc" }));
  expect(await detect(loc("localhost", "/", "http://localhost:8000"), f)).toBeNull();
  expect(await detect(loc("127.0.0.1", "/index.html", "http://127.0.0.1:8000"), f)).toBeNull();
  expect(f.calls).toEqual([]);
});

test("detect: localhost under /editor/ is the page's own origin when /api/health says it is arboretum", async () => {
  const f = fakeFetch(json(200, { ok: true, engine: "abc" }));
  expect(await detect(loc("localhost", "/editor/x", "https://localhost:8787"), f)).toBe("https://localhost:8787");
  expect(f.calls).toEqual(["https://localhost:8787/api/health"]);
  expect(await detect(loc("127.0.0.1", "/editor/", "https://127.0.0.1:8787"), fakeFetch(json(200, { ok: true, engine: "abc" })))).toBe("https://127.0.0.1:8787");
});

test("detect: localhost under /editor/ is null on a 404, a wrong shape, or a failed request", async () => {
  const at = loc("localhost", "/editor/", "https://localhost:8787");
  expect(await detect(at, fakeFetch(json(404, { ok: true, engine: "abc" })))).toBeNull();
  expect(await detect(at, fakeFetch(json(200, { ok: true })))).toBeNull();
  expect(await detect(at, fakeFetch(json(200, { ok: false, engine: "abc" })))).toBeNull();
  expect(await detect(at, fakeFetch(json(200, { engine: "abc" })))).toBeNull();
  expect(await detect(at, fakeFetch(json(200, "ok")))).toBeNull();
  expect(await detect(at, fakeFetch({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }))).toBeNull();
  expect(await detect(at, async () => { throw new TypeError("network"); })).toBeNull();
});

// ---- parseHash (design §5) ------------------------------------------------------

test("parseHash reads a preset link, with a version and a share token", () => {
  expect(parseHash("#arboretum=12")).toStrictEqual({ preset: { id: 12 } });
  expect(parseHash("#arboretum=12@2")).toStrictEqual({ preset: { id: 12, n: 2 } });
  expect(parseHash("#arboretum=12&k=tok_-1")).toStrictEqual({ preset: { id: 12, k: "tok_-1" } });
  expect(parseHash("#arboretum=12@2&k=tok")).toStrictEqual({ preset: { id: 12, n: 2, k: "tok" } });
});

test("parseHash reads a playlist link, with and without a share token", () => {
  expect(parseHash("#arboretum-playlist=7")).toStrictEqual({ playlist: { id: 7 } });
  expect(parseHash("#arboretum-playlist=7&k=tok")).toStrictEqual({ playlist: { id: 7, k: "tok" } });
});

test("parseHash is null for anything else", () => {
  for (const h of ["", "#", "#foo", "#arboretum", "#arboretum=", "#arboretum=abc", "#arboretum=0", "#arboretum=-3",
    "#arboretum=12@", "#arboretum=12@x", "#arboretum=12@0", "#arboretum=1.5", "#arboretum=12&k=", "#arboretum=12&k=a b",
    "#arboretum-playlist=", "#arboretum-playlist=x", "#arboretum-playlist=7@2", "#xarboretum=12", undefined, null])
    expect(parseHash(h)).toBeNull();
});

// ---- the list a playlist shows and steps ------------------------------------------

const fake = { PRESETS: { a: { exposure: 1 }, b: { exposure: 2 }, c: { exposure: 3 } }, EXPERIMENTAL: ["b"] };
const cloud = (items) => ({ ...EMPTY, playlists: { 7: { id: 7, name: "mine", owner: "jo", items } } });
const item = (name, params = {}) => ({ preset_id: 1, version: 1, owner: "jo", name, dwell_s: 30, crossfade_s: 5, params });

test("entries of On this browser: the visible built-ins, then the ★ looks, marked as the dropdown marks them", () => {
  const stored = { x: {}, y: {} };
  expect(entries(EMPTY, stored, fake, false, "local", "a")).toEqual([
    { value: "a", label: "• a" }, { value: "c", label: "• c" }, { value: "x", label: "★ x" }, { value: "y", label: "★ y" }]);
  expect(entries(EMPTY, {}, fake, true, "local", "a")).toEqual([
    { value: "a", label: "• a" }, { value: "b", label: "◦ b" }, { value: "c", label: "• c" }]);
});

test("entries of On this browser keeps the experimental look you are on, even with the toggle off", () => {
  expect(entries(EMPTY, {}, fake, false, "local", "b").map((e) => e.value)).toEqual(["a", "b", "c"]);
});

test("entries of On this browser lists a ★ that shares a built-in's name beside it, as today", () => {
  expect(entries(EMPTY, { a: {} }, fake, false, "local", "a").map((e) => e.label)).toEqual(["• a", "• c", "★ a"]);
});

test("entries gives a ★ that shares a built-in's name a value of its own, so it can be told from the built-in", () => {
  const list = entries(EMPTY, { a: {}, b: {}, x: {} }, fake, false, "local", "a");   // b is a hidden experimental built-in
  expect(list.filter((e) => e.label.endsWith(" a")).map((e) => e.value)).toEqual(["a", "★ a"]);
  expect(new Set(list.map((e) => e.value)).size).toBe(list.length);
  expect(list.find((e) => e.label === "★ b").value).toBe("★ b");   // not tied to whether the built-in is listed
  expect(list.find((e) => e.label === "★ x").value).toBe("x");     // every other ★ keeps its name as its value
});

test("entries keeps values unique even for a ★ named like another ★'s value", () => {
  const list = entries(EMPTY, { a: {}, "★ a": {} }, fake, false, "local", "a");
  expect(new Set(list.map((e) => e.value)).size).toBe(list.length);
});

test("entries of On this browser is, for the shipped looks, exactly the list editor.js builds today", () => {
  const { PRESETS, EXPERIMENTAL } = builtins;
  for (const showBeta of [false, true])
    for (const keep of ["afternoon 7", EXPERIMENTAL[0]]) {
      const today = [...Object.keys(PRESETS).filter((n) => showBeta || !EXPERIMENTAL.includes(n) || n === keep), "mine"];
      expect(entries(EMPTY, { mine: {} }, builtins, showBeta, "local", keep).map((e) => e.value)).toEqual(today);
    }
});

test("entries of a cloud playlist are the item indexes, labelled with the item names (two may share a name)", () => {
  const s = cloud([item("one"), item("two"), item("one")]);
  expect(entries(s, { x: {} }, fake, true, "arb:7", "0")).toEqual([
    { value: "0", label: "one" }, { value: "1", label: "two" }, { value: "2", label: "one" }]);
});

test("entries of a playlist that is not cached is empty", () => {
  expect(entries(EMPTY, {}, fake, true, "arb:9", "0")).toEqual([]);
});

test("resolve of On this browser: a ★ by its value, a built-in by its name, else undefined", () => {
  const mine = { exposure: 9 };
  expect(resolve(EMPTY, { x: mine }, "local", "x")).toEqual(mine);
  expect(resolve(EMPTY, {}, "local", "afternoon 7")).toBe(builtins.PRESETS["afternoon 7"]);
  expect(resolve(EMPTY, {}, "local", "nope")).toBeUndefined();
});

test("resolve tells a ★ that shares a built-in's name from the built-in, by their values", () => {
  const mine = { exposure: 9 };
  const [builtin, star] = entries(EMPTY, { "afternoon 7": mine }, builtins, false, "local", "afternoon 7").filter((e) => e.label.endsWith("afternoon 7"));
  expect(resolve(EMPTY, { "afternoon 7": mine }, "local", builtin.value)).toBe(builtins.PRESETS["afternoon 7"]);
  expect(resolve(EMPTY, { "afternoon 7": mine }, "local", star.value)).toEqual(mine);
});

test("resolve runs migrateLegacy on a ★ look, on a copy", () => {
  const old = { exposure: 1, curtain_tt: 0.5 };
  expect(resolve(EMPTY, { x: old }, "local", "x")).toEqual({ exposure: 1, fabric_tt: 0.5 });
  expect(old).toEqual({ exposure: 1, curtain_tt: 0.5 });
});

test("resolve of a cloud playlist takes the item by index, through migrateLegacy", () => {
  const s = cloud([item("one", { exposure: 1 }), item("two", { curtain_tt: 0.5 })]);
  expect(resolve(s, {}, "arb:7", "0")).toEqual({ exposure: 1 });
  expect(resolve(s, {}, "arb:7", "1")).toEqual({ fabric_tt: 0.5 });
  expect(s.playlists[7].items[1].params).toEqual({ curtain_tt: 0.5 });   // stored as received
  expect(resolve(s, {}, "arb:7", "2")).toBeUndefined();
  expect(resolve(s, {}, "arb:8", "0")).toBeUndefined();
});

test("step goes to the next or previous value and wraps at the ends", () => {
  const e = [{ value: "a" }, { value: "b" }, { value: "c" }];
  expect(step(e, "a", 1)).toBe("b");
  expect(step(e, "c", 1)).toBe("a");
  expect(step(e, "a", -1)).toBe("c");
  expect(step(e, "b", -1)).toBe("a");
});

test("step from a value that is not listed starts from the first entry; an empty list has no step", () => {
  const e = [{ value: "a" }, { value: "b" }, { value: "c" }];
  expect(step(e, "zzz", 1)).toBe("b");
  expect(step([], "a", 1)).toBeUndefined();
});

// ---- the names of the entries (a ★'s value is its name unless a built-in has it) -----------------------

test("starValue is the ★'s name, escaped only where a built-in has that name or another value would collide", () => {
  expect(starValue("mine")).toBe("mine");
  expect(starValue("afternoon 7")).toBe("★ afternoon 7");
  expect(starValue("★ mine")).toBe("★ ★ mine");
});

test("starName reads the ★ an On this browser value denotes: by name, by escape, or none for a built-in", () => {
  const stored = { mine: {}, "afternoon 7": {}, "★ odd": {} };
  expect(starName(stored, "local", "mine")).toBe("mine");
  expect(starName(stored, "local", "★ afternoon 7")).toBe("afternoon 7");
  expect(starName(stored, "local", "★ ★ odd")).toBe("★ odd");
  expect(starName(stored, "local", "afternoon 7")).toBeNull();   // the built-in, though a ★ shares its name
  expect(starName(stored, "local", "memories")).toBeNull();
  expect(starName(stored, "local", "gone")).toBeNull();
  expect(starName(stored, "arb:7", "mine")).toBeNull();
});

test("starName agrees with entries: every ★ entry's value reads back to its name", () => {
  const stored = { mine: {}, "afternoon 7": {}, "★ odd": {}, memories: {} };
  const list = entries(EMPTY, stored, builtins, true, "local", "mine");
  for (const e of list) if (e.label.startsWith("★ ")) expect(starName(stored, "local", e.value)).toBe(e.label.slice(2));
  for (const e of list) if (!e.label.startsWith("★ ")) expect(starName(stored, "local", e.value)).toBeNull();
});

test("entryName is the look's name: the ★'s, the built-in's, or the cloud item's", () => {
  const s = cloud([item("one"), item("two")]);
  expect(entryName(EMPTY, { "afternoon 7": {} }, "local", "★ afternoon 7")).toBe("afternoon 7");
  expect(entryName(EMPTY, { "afternoon 7": {} }, "local", "afternoon 7")).toBe("afternoon 7");
  expect(entryName(EMPTY, { mine: {} }, "local", "mine")).toBe("mine");
  expect(entryName(s, {}, "arb:7", "1")).toBe("two");
  expect(entryName(s, {}, "arb:7", "5")).toBeUndefined();
});

// ---- the playlists a visitor can pick, and what playing needs --------------------------

test("playlists lists On this browser first, then the cached arboretum playlists by their names", () => {
  expect(playlists(EMPTY)).toEqual([{ value: "local", label: "On this browser" }]);
  let s = cachePlaylist(EMPTY, apiList());
  s = cachePlaylist(s, apiList({ id: 8, name: "other" }));
  expect(playlists(s)).toEqual([
    { value: "local", label: "On this browser" }, { value: "arb:7", label: "mine" }, { value: "arb:8", label: "other" }]);
});

test("playlists lists yours as arboretum names them, then the cached ones that are not among them", () => {
  let s = cachePlaylist(EMPTY, apiList({ name: "old name" }));
  s = cachePlaylist(s, apiList({ id: 8, name: "someone's" }));
  expect(playlists(s, [{ id: 9, name: "new" }, { id: 7, name: "mine now" }])).toEqual([
    { value: "local", label: "On this browser" }, { value: "arb:9", label: "new" }, { value: "arb:7", label: "mine now" },
    { value: "arb:8", label: "someone's" }]);
  expect(playlists(EMPTY, [{ id: 3, name: "fresh" }])).toEqual([
    { value: "local", label: "On this browser" }, { value: "arb:3", label: "fresh" }]);
});

test("plays: only a cached cloud playlist with something in it carries dwell times", () => {
  const s = cloud([item("one")]);
  expect(plays(s, "arb:7")).toBe(true);
  expect(plays(s, "local")).toBe(false);
  expect(plays(cloud([]), "arb:7")).toBe(false);
  expect(plays(s, "arb:9")).toBe(false);
});

test("timing is the dwell and crossfade of a cloud item; On this browser has none", () => {
  const s = cloud([{ ...item("one"), dwell_s: 12, crossfade_s: 3 }]);
  expect(timing(s, "arb:7", "0")).toEqual({ dwell_s: 12, crossfade_s: 3 });
  expect(timing(s, "arb:7", "4")).toBeNull();
  expect(timing(s, "local", "afternoon 7")).toBeNull();
});

// ---- the built-in guard (design §3.8) -------------------------------------------------

const clone = (name) => JSON.parse(JSON.stringify(builtins.PRESETS[name]));

test("builtinTwin names the built-in an untouched look is", () => {
  expect(builtinTwin(clone("afternoon 7"), builtins)).toBe("afternoon 7");
});

test("builtinTwin: flipping a debug overlay leaves a look a twin", () => {
  const p = clone("afternoon 7");
  p.show_source = !p.show_source; p.show_layer = !p.show_layer; p.show_layer_index = p.show_layer_index + 1;
  expect(builtinTwin(p, builtins)).toBe("afternoon 7");
});

test("builtinTwin: the editor's time_of_day and latitude helpers alone do not make a look modified", () => {
  const p = { ...clone("afternoon 7"), time_of_day: 9, latitude: 43 };
  expect(builtinTwin(p, builtins)).toBe("afternoon 7");
});

test("builtinTwin: a changed seed, or a moved sun, is a different look", () => {
  expect(builtinTwin({ ...clone("afternoon 7"), seed: clone("afternoon 7").seed + 1 }, builtins)).toBeNull();
  expect(builtinTwin({ ...clone("afternoon 7"), sun_elevation_deg: 30 }, builtins)).toBeNull();
});

test("builtinTwin: a key the look lacks is a difference", () => {
  const p = clone("afternoon 7");
  delete p.seed;
  expect(builtinTwin(p, builtins)).toBeNull();
});

test("builtinTwin sees through an old spelling of a knob", () => {
  const p = clone("afternoon 7");
  p.curtain_tt = p.fabric_tt; delete p.fabric_tt;
  expect(builtinTwin(p, builtins)).toBe("afternoon 7");
});

test("builtinTwin is null for a look no built-in matches", () => {
  expect(builtinTwin({ ...DEFAULTS, exposure: 99 }, builtins)).toBeNull();
});

// ---- the cache of arboretum playlists (design §6.1) ------------------------------------

const apiItem = (preset_id, name, params = {}) => ({ preset_id, version: 2, owner: "jo", name, dwell_s: 30, crossfade_s: 5, params });
const apiList = (extra = {}) => ({
  id: 7, owner: "jo", name: "mine", description: null, created_at: 1, updated_at: 2, visibility: "private", share_token: "secret",
  items: [apiItem(1, "one", { exposure: 1 })], ...extra,
});

test("cachePlaylist keeps what playing and re-fetching need, and nothing else", () => {
  const before = Date.now();
  const s = cachePlaylist(EMPTY, apiList());
  expect(s.playlists[7]).toEqual({
    id: 7, name: "mine", owner: "jo", k: null, fetched_at: expect.any(Number), unavailable: 0,
    items: [{ preset_id: 1, version: 2, owner: "jo", name: "one", dwell_s: 30, crossfade_s: 5, params: { exposure: 1 } }],
  });
  expect(s.playlists[7].fetched_at).toBeGreaterThanOrEqual(before);
  expect(EMPTY.playlists).toEqual({});   // the state it was given is untouched
});

test("cachePlaylist keeps the share token of a link, and across a refresh", () => {
  const s = cachePlaylist(EMPTY, apiList({ k: "tok" }));
  expect(s.playlists[7].k).toBe("tok");
  expect(cachePlaylist(s, apiList({ name: "renamed" })).playlists[7]).toMatchObject({ k: "tok", name: "renamed" });
});

test("cachePlaylist drops the owner's unavailable items from the list and counts them", () => {
  const gone = { preset_id: 9, dwell_s: 30, crossfade_s: 5, unavailable: true };
  const s = cachePlaylist(EMPTY, apiList({ items: [gone, apiItem(1, "one"), gone], unavailable: 2 }));
  expect(s.playlists[7].items.map((i) => i.name)).toEqual(["one"]);
  expect(s.playlists[7].unavailable).toBe(2);
});

test("cachePlaylist leaves the other playlists alone; dropPlaylist forgets one", () => {
  let s = cachePlaylist(EMPTY, apiList());
  s = cachePlaylist(s, apiList({ id: 8, name: "other" }));
  expect(Object.keys(s.playlists)).toEqual(["7", "8"]);
  const d = dropPlaylist(s, 7);
  expect(Object.keys(d.playlists)).toEqual(["8"]);
  expect(Object.keys(s.playlists)).toEqual(["7", "8"]);
});

// ---- bringing a look in: no duplicates, no overwriting unsynced edits (design §5) -----------

const arbPreset = (extra = {}) => ({ id: 12, version: 3, owner: "ana", name: "dusk", params: { exposure: 3 }, ...extra });
const rec = (version, synced) => ({ id: 12, version, owner: "ana", synced });
const stateWith = (origin) => ({ ...EMPTY, origin });

test("savePreset saves a new look as a ★ under its arboretum name, synced", () => {
  const out = savePreset(EMPTY, { other: {} }, arbPreset());
  expect(out.name).toBe("dusk");
  expect(out.stored).toEqual({ other: {}, dusk: { exposure: 3 } });
  expect(out.state.origin).toEqual({ dusk: rec(3, true) });
});

test("savePreset refreshes in place a ★ of the same id that is still synced, keeping its local name", () => {
  const state = stateWith({ mine: rec(2, true) });
  const out = savePreset(state, { mine: { exposure: 2 } }, arbPreset());
  expect(out.name).toBe("mine");
  expect(out.stored).toEqual({ mine: { exposure: 3 } });
  expect(out.state.origin).toEqual({ mine: rec(3, true) });
});

test("savePreset never overwrites a ★ of the same id with unsynced edits: the look is added beside it", () => {
  const state = stateWith({ mine: rec(2, false) });
  const out = savePreset(state, { mine: { exposure: 2, edited: true } }, arbPreset());
  expect(out.name).toBe("dusk (v3)");
  expect(out.stored).toEqual({ mine: { exposure: 2, edited: true }, "dusk (v3)": { exposure: 3 } });
  expect(out.state.origin).toEqual({ mine: rec(2, false), "dusk (v3)": rec(3, true) });
});

test("savePreset: importing the same look again after that refreshes the added one, not a third", () => {
  const state = stateWith({ mine: rec(2, false) });
  const first = savePreset(state, { mine: { exposure: 2 } }, arbPreset());
  const again = savePreset(first.state, first.stored, arbPreset({ version: 4, params: { exposure: 4 } }));
  expect(again.name).toBe("dusk (v3)");
  expect(Object.keys(again.stored)).toEqual(["mine", "dusk (v3)"]);
  expect(again.stored["dusk (v3)"]).toEqual({ exposure: 4 });
  expect(again.state.origin["dusk (v3)"]).toEqual(rec(4, true));
});

test("savePreset: an unrelated ★ of the same name makes the import '<name> (#<id>)'", () => {
  const out = savePreset(EMPTY, { dusk: { exposure: 1 } }, arbPreset());
  expect(out.name).toBe("dusk (#12)");
  expect(out.stored).toEqual({ dusk: { exposure: 1 }, "dusk (#12)": { exposure: 3 } });
  expect(out.state.origin["dusk (#12)"]).toEqual(rec(3, true));
  expect(out.state.origin.dusk).toBeUndefined();
});

test("savePreset: a built-in's name is taken too, so an import named like one never shadows it", () => {
  const out = savePreset(EMPTY, {}, arbPreset({ name: "afternoon 7" }));
  expect(out.name).toBe("afternoon 7 (#12)");
  expect(out.stored).toEqual({ "afternoon 7 (#12)": { exposure: 3 } });
  expect(out.state.origin["afternoon 7 (#12)"]).toEqual(rec(3, true));
});

test("savePreset: the suffixed name of a built-in's import is made unique like any other", () => {
  const out = savePreset(EMPTY, { "afternoon 7 (#12)": { a: 1 } }, arbPreset({ name: "afternoon 7" }));
  expect(out.name).toBe("afternoon 7 (#12) 2");
  expect(out.stored["afternoon 7 (#12)"]).toEqual({ a: 1 });
});

test("savePreset never lands on a name a ★ already has", () => {
  const out = savePreset(EMPTY, { dusk: { a: 1 }, "dusk (#12)": { b: 2 } }, arbPreset());
  expect(out.stored.dusk).toEqual({ a: 1 });
  expect(out.stored["dusk (#12)"]).toEqual({ b: 2 });
  expect(Object.keys(out.stored)).toHaveLength(3);
  expect(out.stored[out.name]).toEqual({ exposure: 3 });
});

test("savePreset does not touch the state or the ★ store it was given", () => {
  const state = stateWith({ mine: rec(2, true) }), stored = { mine: { exposure: 2 } };
  savePreset(state, stored, arbPreset());
  expect(state.origin.mine).toEqual(rec(2, true));
  expect(stored).toEqual({ mine: { exposure: 2 } });
});

// ---- provenance of a local look (design §4.1) ---------------------------------------------

const local = (name) => ({ kind: "local", name });

test("onSaved over the same ★ keeps the arboretum record and marks it unsynced", () => {
  const s = onSaved(stateWith({ mine: rec(2, true) }), "mine", local("mine"));
  expect(s.origin.mine).toEqual(rec(2, false));
});

test("onSaved over the same ★ leaves a parent record, or no record, as it is", () => {
  expect(onSaved(stateWith({ mine: { parent: "look:x" } }), "mine", local("mine")).origin).toEqual({ mine: { parent: "look:x" } });
  expect(onSaved(EMPTY, "mine", local("mine")).origin).toEqual({});
});

test("onSaved under a new name from a built-in records look:<built-in>", () => {
  expect(onSaved(EMPTY, "mine", { kind: "builtin", name: "afternoon 7" }).origin).toEqual({ mine: { parent: "look:afternoon 7" } });
});

test("onSaved under a new name from a ★ with an arboretum id records preset:<id>@<version>", () => {
  const s = onSaved(stateWith({ a: rec(2, false) }), "b", local("a"));
  expect(s.origin.b).toEqual({ parent: "preset:12@2" });
  expect(s.origin.a).toEqual(rec(2, false));
});

test("onSaved under a new name from a cloud item records preset:<id>@<version>", () => {
  expect(onSaved(EMPTY, "b", { kind: "cloud", item: apiItem(5, "x") }).origin).toEqual({ b: { parent: "preset:5@2" } });
});

test("onSaved under a new name from a ★ with only a parent passes that parent on", () => {
  expect(onSaved(stateWith({ a: { parent: "look:x" } }), "b", local("a")).origin.b).toEqual({ parent: "look:x" });
});

test("onSaved with nothing known leaves no record, and clears an older one under that name", () => {
  expect(onSaved(EMPTY, "b", local("a")).origin).toEqual({});
  expect(onSaved(stateWith({ b: rec(1, true) }), "b", local("a")).origin).toEqual({});
  expect(onSaved(stateWith({ b: rec(1, true) }), "b", undefined).origin).toEqual({});
});

test("onSaved does not touch the state it was given", () => {
  const state = stateWith({ mine: rec(2, true) });
  onSaved(state, "mine", local("mine"));
  expect(state.origin.mine.synced).toBe(true);
});

test("onDeleted removes the record of a deleted ★", () => {
  const state = stateWith({ a: rec(1, true), b: { parent: "look:x" } });
  expect(onDeleted(state, "a").origin).toEqual({ b: { parent: "look:x" } });
  expect(state.origin.a).toBeDefined();
});

test("onPushed records the uploaded look as synced, from the response", () => {
  const state = stateWith({ a: { parent: "look:x" } });
  expect(onPushed(state, "a", { id: 31, version: 1, owner: "jo", name: "a", params: {} }).origin.a)
    .toEqual({ id: 31, version: 1, owner: "jo", synced: true });
});

// ---- the smart upload (design §4.2) ---------------------------------------------------------

const COMMIT = "a17b492a17b492a17b492a17b492a17b492a17b4";
const changed = (name = "afternoon 7") => ({ ...clone(name), seed: clone(name).seed + 1 });
const plan = (state, stored, active, value, live, over = {}) =>
  uploadPlan(state, stored, active, value, live, over.me ?? "jo", over.commit ?? null, cameraFor);

test("uploadPlan of a ★ with no arboretum record is a new preset of the stored snapshot", () => {
  const mine = changed();
  const p = plan(EMPTY, { mine }, "local", "mine", { not: "the live look" });
  expect(p).toEqual({ kind: "preset", path: "/api/presets", label: "↑ new preset", body: { name: "mine", params: mine } });
});

test("uploadPlan sends komorebi_commit only when it is known", () => {
  const mine = changed();
  expect(plan(EMPTY, { mine }, "local", "mine", mine, { commit: COMMIT }).body.komorebi_commit).toBe(COMMIT);
  expect("komorebi_commit" in plan(EMPTY, { mine }, "local", "mine", mine).body).toBe(false);
});

test("uploadPlan carries the parent a ★ started from", () => {
  const mine = changed();
  const state = stateWith({ mine: { parent: "look:afternoon 7" } });
  expect(plan(state, { mine }, "local", "mine", mine).body.parent).toBe("look:afternoon 7");
});

test("uploadPlan of a copy of someone else's preset is a new preset whose parent is that version", () => {
  const mine = changed();
  const state = stateWith({ mine: { id: 12, version: 3, owner: "ana", synced: true } });
  const p = plan(state, { mine }, "local", "mine", mine);
  expect(p.kind).toBe("preset");
  expect(p.body.parent).toBe("preset:12@3");
});

test("uploadPlan of your own preset is a new version of it, with no tags and no parent", () => {
  const mine = changed();
  const state = stateWith({ mine: { id: 12, version: 3, owner: "jo", synced: false } });
  expect(plan(state, { mine }, "local", "mine", mine, { commit: COMMIT })).toEqual({
    kind: "version", path: "/api/presets/12/versions", label: "↑ new version of #12",
    body: { name: "mine", params: mine, komorebi_commit: COMMIT },
  });
});

test("uploadPlan tags a look experimental when its camera is not the floor", () => {
  const curtain = { ...clone("curtain 1"), seed: clone("curtain 1").seed + 1 };
  expect(cameraFor(curtain)).not.toBe("floor");
  expect(plan(EMPTY, { c: curtain }, "local", "c", curtain).body.tags).toEqual(["experimental"]);
  const floor = changed();
  expect("tags" in plan(EMPTY, { f: floor }, "local", "f", floor).body).toBe(false);
});

test("uploadPlan refuses an unchanged built-in, however it is held", () => {
  const msg = { refused: "this is the built-in 'afternoon 7', unchanged — change something first" };
  expect(plan(EMPTY, {}, "local", "afternoon 7", clone("afternoon 7"))).toEqual(msg);
  expect(plan(EMPTY, { mine: clone("afternoon 7") }, "local", "mine", {})).toEqual(msg);
  const fromElsewhere = { ...clone("afternoon 7"), show_layer: true };
  expect(plan(EMPTY, { mine: fromElsewhere }, "local", "mine", {})).toEqual(msg);
});

test("uploadPlan reads a ★ that shares a built-in's name by its value: the ★ is uploaded under its name, the built-in is refused", () => {
  const mine = changed();
  const state = stateWith({ "afternoon 7": { parent: "look:afternoon 7" } });
  const p = plan(state, { "afternoon 7": mine }, "local", starValue("afternoon 7"), {});
  expect(p).toEqual({ kind: "preset", path: "/api/presets", label: "↑ new preset", body: { name: "afternoon 7", params: mine, parent: "look:afternoon 7" } });
  expect(plan(state, { "afternoon 7": mine }, "local", "afternoon 7", {}).refused).toMatch(/afternoon 7/);
});

test("uploadPlan accepts a built-in once something is changed", () => {
  expect(plan(EMPTY, { mine: changed() }, "local", "mine", {}).kind).toBe("preset");
});

const inList = (...items) => cloud(items);
const mineItem = { ...item("dawn"), preset_id: 5, version: 4 };
const theirItem = { ...item("dusk"), preset_id: 6, version: 2, owner: "ana" };

test("uploadPlan from a cloud playlist uploads the live look and says which item it replaces", () => {
  const live = changed();
  expect(plan(inList(mineItem), {}, "arb:7", "0", live, { commit: COMMIT })).toEqual({
    kind: "version", path: "/api/presets/5/versions", label: "↑ new version of #5",
    body: { name: "dawn", params: live, komorebi_commit: COMMIT }, into: { playlist: 7, at: 0 },
  });
});

test("uploadPlan from a cloud item that is someone else's is your new preset, parented on it, replacing the item", () => {
  const live = changed();
  const p = plan(inList(mineItem, theirItem), {}, "arb:7", "1", live);
  expect(p).toEqual({
    kind: "preset", path: "/api/presets", label: "↑ new preset",
    body: { name: "dusk", params: live, parent: "preset:6@2" }, into: { playlist: 7, at: 1 },
  });
});

test("uploadPlan into an empty playlist is a new preset that is appended; the name is the caller's to give", () => {
  const live = changed();
  expect(plan(inList(), {}, "arb:7", undefined, live)).toEqual({
    kind: "preset", path: "/api/presets", label: "↑ new preset", body: { name: "", params: live }, into: { playlist: 7, at: null },
  });
});

test("uploadPlan from a cloud playlist refuses an unchanged built-in too", () => {
  expect(plan(inList(mineItem), {}, "arb:7", "0", clone("afternoon 7")).refused).toMatch(/afternoon 7/);
});

// ---- writing a playlist's items safely (design §3.7) ---------------------------------------------

const fresh = () => [
  { preset_id: 1, version: 1, owner: "jo", name: "a", dwell_s: 10, crossfade_s: 2, params: {} },
  { preset_id: 9, dwell_s: 40, crossfade_s: 7, unavailable: true },
  { preset_id: 2, version: 1, owner: "jo", name: "b", dwell_s: 20, crossfade_s: 3, params: {} },
];

test("itemsAfter an append: the whole list, unavailable item kept, the new preset last with arboretum's defaults", () => {
  expect(itemsAfter(fresh(), { kind: "append", preset_id: 3 })).toEqual([
    { preset_id: 1, dwell_s: 10, crossfade_s: 2 },
    { preset_id: 9, dwell_s: 40, crossfade_s: 7 },
    { preset_id: 2, dwell_s: 20, crossfade_s: 3 },
    { preset_id: 3 },
  ]);
});

test("itemsAfter a removal counts places among the playable items and keeps the unavailable one", () => {
  expect(itemsAfter(fresh(), { kind: "remove", at: 1 })).toEqual([
    { preset_id: 1, dwell_s: 10, crossfade_s: 2 },
    { preset_id: 9, dwell_s: 40, crossfade_s: 7 },
  ]);
});

test("itemsAfter a replacement puts the new preset in the place, with that place's times", () => {
  expect(itemsAfter(fresh(), { kind: "replace", at: 1, preset_id: 3 })).toEqual([
    { preset_id: 1, dwell_s: 10, crossfade_s: 2 },
    { preset_id: 9, dwell_s: 40, crossfade_s: 7 },
    { preset_id: 3, dwell_s: 20, crossfade_s: 3 },
  ]);
});

test("itemsAfter does not touch the list it was given", () => {
  const list = fresh();
  itemsAfter(list, { kind: "remove", at: 0 });
  expect(list).toEqual(fresh());
});

// ---- what a save started from, and what is already online (design §4.1, §4.2) ----------------------------

test("fromEntry reads the entry a save starts from: a ★, a built-in, a cloud item, or nothing", () => {
  const state = { ...cloud([item("one")]), origin: {} };
  const stored = { mine: {} };
  expect(fromEntry(state, stored, "local", "mine")).toEqual({ kind: "local", name: "mine" });
  expect(fromEntry(state, stored, "local", "afternoon 7")).toEqual({ kind: "builtin", name: "afternoon 7" });
  expect(fromEntry(state, { "afternoon 7": {} }, "local", "★ afternoon 7")).toEqual({ kind: "local", name: "afternoon 7" });
  expect(fromEntry(state, stored, "arb:7", "0")).toEqual({ kind: "cloud", item: item("one") });
  expect(fromEntry(state, stored, "local", "")).toBeNull();
  expect(fromEntry(state, stored, "local", undefined)).toBeNull();
  expect(fromEntry(state, stored, "arb:7", "5")).toBeNull();
});

test("onlineId is the arboretum preset an entry already is: a cloud item, or a ★ whose copy is still current", () => {
  const state = { ...cloud([{ ...item("one"), preset_id: 4 }]), origin: {
    synced: { id: 12, version: 3, owner: "ana", synced: true }, edited: { id: 13, version: 1, owner: "jo", synced: false }, child: { parent: "look:afternoon 7" } } };
  const stored = { synced: {}, edited: {}, child: {}, loose: {} };
  expect(onlineId(state, stored, "arb:7", "0")).toBe(4);
  expect(onlineId(state, stored, "local", "synced")).toBe(12);
  expect(onlineId(state, stored, "local", "edited")).toBeNull();   // the local look has moved on: it must go up first
  expect(onlineId(state, stored, "local", "child")).toBeNull();
  expect(onlineId(state, stored, "local", "loose")).toBeNull();
  expect(onlineId(state, stored, "local", "afternoon 7")).toBeNull();
  expect(onlineId(state, stored, "arb:7", "3")).toBeNull();
});

test("pushButton says what the smart button does, or that a built-in is unchanged and disables it", () => {
  expect(pushButton({ kind: "version", label: "↑ new version of #12" })).toEqual({ label: "↑ new version of #12", disabled: false });
  expect(pushButton({ kind: "preset", label: "↑ new preset" })).toEqual({ label: "↑ new preset", disabled: false });
  const refused = "this is the built-in 'afternoon 7', unchanged — change something first";
  expect(pushButton({ refused })).toEqual({ label: "built-in · unchanged", disabled: true, title: refused });
});

test("placeChange turns where an upload goes into the change itemsAfter applies", () => {
  expect(placeChange({ playlist: 7, at: 2 }, 31)).toEqual({ kind: "replace", at: 2, preset_id: 31 });
  expect(placeChange({ playlist: 7, at: null }, 31)).toEqual({ kind: "append", preset_id: 31 });
});
