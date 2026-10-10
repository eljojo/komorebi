// Tests for playlists.js — the pure playlist model; the storage under it is arboretum.js (arboretum-storage.test.js). Run: `bun test playlists.test.js`.
import { test, expect, beforeEach } from "bun:test";
import { LOCAL_NAME, detect, parseHash, entries, resolve, step, builtinTwin,
  cachePlaylist, dropPlaylist, savePreset, onSaved, onDeleted,
  uploadPlan, itemsAfter, playlists, plays, timing, starValue, starName, entryName,
  fromEntry, onlineId, placeChange, sameLook, lookState, playlistChips,
  emptyMirror, mirrorDiff, mirrorSync, mirrorPut, mirrorPlaylist, enqueue, dequeue, viewState, uncategorized, listChoices, moveCandidates, movePlan, savePlan, isFolder, fromVersion, linkPlaylist, makePlayer } from "./playlists.js";
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
  expect(playlists(EMPTY)).toEqual([{ value: "local", label: "all looks" }]);
  let s = cachePlaylist(EMPTY, apiList());
  s = cachePlaylist(s, apiList({ id: 8, name: "other" }));
  expect(playlists(s)).toEqual([
    { value: "local", label: "all looks" }, { value: "arb:7", label: "mine" }, { value: "arb:8", label: "other" }]);
});

test("playlists lists yours as arboretum names them, then the cached ones that are not among them", () => {
  let s = cachePlaylist(EMPTY, apiList({ name: "old name" }));
  s = cachePlaylist(s, apiList({ id: 8, name: "someone's" }));
  expect(playlists(s, [{ id: 9, name: "new" }, { id: 7, name: "mine now" }])).toEqual([
    { value: "local", label: "all looks" }, { value: "arb:9", label: "new" }, { value: "arb:7", label: "mine now" },
    { value: "arb:8", label: "someone's" }]);
  expect(playlists(EMPTY, [{ id: 3, name: "fresh" }])).toEqual([
    { value: "local", label: "all looks" }, { value: "arb:3", label: "fresh" }]);
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
    body: { name: "dawn", params: live, komorebi_commit: COMMIT }, into: { playlist: 7, at: 0, target: { preset_id: 5, dwell_s: 30, crossfade_s: 5, occurrence: 0, count: 1 } },
  });
});

test("uploadPlan from a cloud item that is someone else's is your new preset, parented on it, replacing the item", () => {
  const live = changed();
  const p = plan(inList(mineItem, theirItem), {}, "arb:7", "1", live);
  expect(p).toEqual({
    kind: "preset", path: "/api/presets", label: "↑ new preset",
    body: { name: "dusk", params: live, parent: "preset:6@2" }, into: { playlist: 7, at: 1, target: { preset_id: 6, dwell_s: 30, crossfade_s: 5, occurrence: 0, count: 1 } },
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

test("placeChange turns where an upload goes into the change itemsAfter applies", () => {
  expect(placeChange({ playlist: 7, at: 2 }, 31)).toEqual({ kind: "replace", at: 2, preset_id: 31 });
  expect(placeChange({ playlist: 7, at: null }, 31)).toEqual({ kind: "append", preset_id: 31 });
});

// ---- the links (design §5, K5) -------------------------------------------------------------

test("fromVersion gives a /versions/:n answer the head's shape, so savePreset takes it", () => {
  const v = { preset_id: 12, n: 2, name: "dusk", description: null, tags: [], params: { exposure: 3 }, via: "web", created_at: 1 };
  const head = { id: 12, owner: "ana", version: 5, name: "dusk, later", params: { exposure: 9 } };
  expect(fromVersion(v, head)).toMatchObject({ id: 12, owner: "ana", version: 2, name: "dusk", params: { exposure: 3 } });
  const out = savePreset(EMPTY, {}, fromVersion(v, head));
  expect(out.name).toBe("dusk");
  expect(out.stored.dusk).toEqual({ exposure: 3 });
  expect(out.state.origin.dusk).toEqual({ id: 12, version: 2, owner: "ana", synced: true });
});

test("linkPlaylist caches the playlist with the link's share token, and names the list and the first item", () => {
  const out = linkPlaylist(EMPTY, apiList({ owner: "ana" }), "tok");
  expect(out.list).toBe("arb:7");
  expect(out.value).toBe("0");
  expect(out.state.playlists[7]).toMatchObject({ id: 7, owner: "ana", k: "tok" });
  expect(EMPTY.playlists).toEqual({});
});

test("linkPlaylist without a token keeps the one already cached", () => {
  const first = linkPlaylist(EMPTY, apiList(), "tok").state;
  expect(linkPlaylist(first, apiList()).state.playlists[7].k).toBe("tok");
});

test("linkPlaylist drops the owner's unavailable items, and fails on a playlist with nothing playable, caching nothing", () => {
  const gone = { preset_id: 9, dwell_s: 30, crossfade_s: 5, unavailable: true };
  expect(linkPlaylist(EMPTY, apiList({ items: [gone, apiItem(1, "one")] })).state.playlists[7].items.map((i) => i.name)).toEqual(["one"]);
  for (const items of [[], [gone]]) {
    const out = linkPlaylist(EMPTY, apiList({ items }));
    expect(out.failed).toBe("that playlist has nothing to play");
    expect(out.state).toBeUndefined();
  }
});

// ---- someone else's playlist is read-only (design §3.5) ----------------------------------------

test("playlists labels a cached playlist that is not yours with its owner, once you are signed in", () => {
  let s = cachePlaylist(EMPTY, apiList({ owner: "jo" }));
  s = cachePlaylist(s, apiList({ id: 8, name: "evening", owner: "ana" }));
  expect(playlists(s, [], "jo")).toEqual([
    { value: "local", label: "all looks" }, { value: "arb:7", label: "mine" }, { value: "arb:8", label: "evening · ana" }]);
  expect(playlists(s, [{ id: 7, name: "mine" }], "jo").map((l) => l.label)).toEqual(["all looks", "mine", "evening · ana"]);
  expect(playlists(s).map((l) => l.label)).toEqual(["all looks", "mine", "evening"]);   // not signed in: names only, as before
});

// ---- playing (design §3.6): the dwell starts when a look has arrived, the first look has no fade in ----------

const clock = () => {
  let now = 0, tasks = [];
  return {
    set: (fn, ms) => { const t = { fn, at: now + ms }; tasks.push(t); return t; },
    clear: (t) => { tasks = tasks.filter((x) => x !== t); },
    advance(ms) {
      now += ms;
      for (let due = tasks.find((t) => t.at <= now); due; due = tasks.find((t) => t.at <= now)) { tasks = tasks.filter((t) => t !== due); due.fn(); }
    },
    pending: () => tasks.length,
  };
};
const TIMES = { 0: { dwell_s: 2, crossfade_s: 5 }, 1: { dwell_s: 3, crossfade_s: 1 } };
function playerOn(extra = {}) {
  const c = clock(), log = { advanced: 0, changed: 0 };
  const p = makePlayer({ timing: (v) => TIMES[v] ?? null, advance: () => { log.advanced++; }, setTimer: c.set, clearTimer: c.clear, onChange: () => { log.changed++; }, ...extra });
  return { p, c, log };
}

test("the look play starts on is simply there: it holds its dwell with no crossfade added", () => {
  const { p, c, log } = playerOn();
  p.start("0");
  expect(p.playing).toBe(true);
  c.advance(1999);
  expect(log.advanced).toBe(0);
  c.advance(1);
  expect(log.advanced).toBe(1);
});

test("a look's dwell starts when it has arrived, not before: nothing is pending while it fades in", () => {
  const { p, c, log } = playerOn();
  p.start("0");
  c.advance(2000);                  // the dwell is up: the editor starts the step to the next look...
  p.leaving();                      // ...and while that look fades in nothing is waiting
  c.advance(60000);
  expect(log.advanced).toBe(1);
  expect(c.pending()).toBe(0);
  p.arrived("1");                   // it has faded in: its own dwell starts now
  c.advance(2999);
  expect(log.advanced).toBe(1);
  c.advance(1);
  expect(log.advanced).toBe(2);
});

test("a look put there by hand restarts the dwell", () => {
  const { p, c, log } = playerOn();
  p.start("0");
  c.advance(1500);
  p.arrived("1");                   // stepped by hand at 1.5 s
  c.advance(2999);
  expect(log.advanced).toBe(0);
  c.advance(1);
  expect(log.advanced).toBe(1);
  expect(c.pending()).toBe(0);
});

test("stopping cancels the dwell, and a look that arrives afterwards starts none", () => {
  const { p, c, log } = playerOn();
  p.start("0");
  p.stop();
  expect(p.playing).toBe(false);
  expect(c.pending()).toBe(0);
  p.arrived("1");
  c.advance(60000);
  expect(log.advanced).toBe(0);
});

test("starting twice does not run two dwells; a look with no times never waits", () => {
  const { p, c, log } = playerOn();
  p.start("0"); p.start("0");
  expect(c.pending()).toBe(1);
  p.arrived("nowhere");             // no dwell for it (On this browser has none)
  expect(c.pending()).toBe(0);
  c.advance(60000);
  expect(log.advanced).toBe(0);
});

test("onChange says when playing starts or stops, and only then", () => {
  const { p, log } = playerOn();
  p.stop();
  expect(log.changed).toBe(0);
  p.start("0"); p.start("0");
  expect(log.changed).toBe(1);
  p.arrived("1");
  expect(log.changed).toBe(1);
  p.stop(); p.stop();
  expect(log.changed).toBe(2);
});

// ---- the shelf: one list of looks, one chip per look, pending uploads, and the playlists a look is in ---------------

test("the local list is called all looks", () => {
  expect(LOCAL_NAME).toBe("all looks");
  expect(playlists(EMPTY)).toEqual([{ value: "local", label: "all looks" }]);
});

// ---- sameLook: the equality builtinTwin uses, for the chip's "edited" ----

test("sameLook compares every DEFAULTS key, ignoring the overlays and drift_phase, with a tolerance on numbers", () => {
  const a = clone("afternoon 7");
  expect(sameLook(a, { ...a })).toBe(true);
  expect(sameLook(a, { ...a, show_source: !a.show_source, show_layer_index: 3 })).toBe(true);
  expect(sameLook(a, { ...a, drift_phase: a.drift_phase + 2 })).toBe(true);   // animated state: it would mark every look edited
  expect(sameLook(a, { ...a, exposure: a.exposure + 1e-9 })).toBe(true);
  expect(sameLook(a, { ...a, exposure: a.exposure + 0.01 })).toBe(false);
  expect(sameLook(a, { ...a, tree_species: "oak" })).toBe(false);
  expect(sameLook(a, { ...a, time_of_day: 3, latitude: 10 })).toBe(true);   // the editor's helpers are not in DEFAULTS
});

test("builtinTwin ignores drift_phase too", () => {
  expect(builtinTwin({ ...clone("afternoon 7"), drift_phase: 4 }, builtins)).toBe("afternoon 7");
});

// ---- lookState: the one chip under the look select ----

const afternoon = clone("afternoon 7");
const synced = { id: 12, version: 2, owner: "jo", synced: true };
const chipOf = (state, stored, active, value, live, me = "jo", ctx = {}) => lookState(state, stored, active, value, live, me, ctx);

test("lookState: a built-in, unchanged", () => {
  expect(chipOf(EMPTY, {}, "local", "afternoon 7", afternoon).text).toBe("built-in");
});

test("lookState: a ★ never uploaded, or with no arboretum", () => {
  expect(chipOf(EMPTY, { mine: afternoon }, "local", "mine", afternoon).text).toBe("★ saved here");
  expect(chipOf({ ...EMPTY, origin: { mine: { parent: "look:afternoon 7" } } }, { mine: afternoon }, "local", "mine", afternoon, null).text).toBe("★ saved here");
});

test("lookState: a ★ that is a synced arboretum preset", () => {
  expect(chipOf({ ...EMPTY, origin: { mine: synced } }, { mine: afternoon }, "local", "mine", afternoon).text).toBe("☁ #12 v2");
});

test("lookState: a ★ whose arboretum copy is behind", () => {
  const behind = { ...EMPTY, origin: { mine: { ...synced, synced: false } } };
  expect(chipOf(behind, { mine: afternoon }, "local", "mine", afternoon).text).toBe("★ saved here · ☁ #12 is older");
});

test("lookState: an item of a cloud playlist, with its owner when it is not yours", () => {
  const s = { ...EMPTY, playlists: { 7: { id: 7, name: "evening", owner: "jo", fetched_at: Date.UTC(2026, 9, 10, 12), items: [
    { preset_id: 5, version: 1, owner: "jo", name: "dawn", dwell_s: 1, crossfade_s: 1, params: afternoon },
    { preset_id: 6, version: 3, owner: "ana", name: "dusk", dwell_s: 1, crossfade_s: 1, params: afternoon }] } } };
  expect(chipOf(s, {}, "arb:7", "0", afternoon).text).toBe("☁ #5 v1");
  expect(chipOf(s, {}, "arb:7", "1", afternoon).text).toBe("☁ #6 v3 · ana's");
  expect(chipOf(s, {}, "arb:7", "1", afternoon, null).text).toBe("☁ #6 v3 · ana's");   // signed out, it is still not yours
});

test("lookState: a cached playlist shown because arboretum could not be reached says so, with the day it was fetched", () => {
  const s = { ...EMPTY, playlists: { 7: { id: 7, name: "evening", owner: "jo", fetched_at: Date.UTC(2026, 9, 10, 12), items: [
    { preset_id: 5, version: 1, owner: "jo", name: "dawn", dwell_s: 1, crossfade_s: 1, params: afternoon }] } } };
  expect(chipOf(s, {}, "arb:7", "0", afternoon, "jo", { offline: true }).text).toBe("offline copy · 2026-10-10");
});

test("lookState: live params that differ from the entry's are prefixed ● edited · , for every kind of entry", () => {
  const edited = { ...afternoon, exposure: afternoon.exposure + 0.3 };
  expect(chipOf(EMPTY, {}, "local", "afternoon 7", edited).text).toBe("● edited · built-in");
  expect(chipOf({ ...EMPTY, origin: { mine: synced } }, { mine: afternoon }, "local", "mine", edited).text).toBe("● edited · ☁ #12 v2");
  const s = { ...EMPTY, playlists: { 7: { id: 7, name: "e", owner: "jo", fetched_at: 0, items: [{ preset_id: 5, version: 1, owner: "jo", name: "dawn", dwell_s: 1, crossfade_s: 1, params: afternoon }] } } };
  expect(chipOf(s, {}, "arb:7", "0", edited).text).toBe("● edited · ☁ #5 v1");
});

test("lookState: drift_phase and a debug overlay do not make a look edited; no live params means no edit to report", () => {
  expect(chipOf(EMPTY, {}, "local", "afternoon 7", { ...afternoon, drift_phase: 3, show_layer: true }).text).toBe("built-in");
  expect(chipOf(EMPTY, {}, "local", "afternoon 7", null).text).toBe("built-in");
});

test("lookState: the title is a sentence, and carries arboretum's last refusal for the look verbatim", () => {
  const c = chipOf(EMPTY, {}, "local", "afternoon 7", afternoon, "jo", { error: "branch_levels must be 1–4" });
  expect(c.title.length).toBeGreaterThan(10);
  expect(c.title).toContain("branch_levels must be 1–4");
  expect(chipOf(EMPTY, {}, "local", "afternoon 7", afternoon).title).not.toContain("undefined");
});

test("lookState says nothing for a value that is not an entry", () => {
  expect(chipOf(EMPTY, {}, "local", "nope", afternoon)).toEqual({ text: "", title: "" });
  expect(chipOf(EMPTY, {}, "arb:9", "0", afternoon)).toEqual({ text: "", title: "" });
});

// ---- the playlists a look is in ----

test("itemsAfter removes the first item with a preset id from a fresh copy, keeping the unavailable items and everyone's times", () => {
  const fresh = [
    { preset_id: 5, dwell_s: 11, crossfade_s: 2 }, { preset_id: 99, dwell_s: 40, crossfade_s: 7, unavailable: true },
    { preset_id: 6, dwell_s: 12, crossfade_s: 3 }, { preset_id: 5, dwell_s: 13, crossfade_s: 4 }];
  expect(itemsAfter(fresh, { kind: "remove_preset", preset_id: 5 })).toEqual([
    { preset_id: 99, dwell_s: 40, crossfade_s: 7 }, { preset_id: 6, dwell_s: 12, crossfade_s: 3 }, { preset_id: 5, dwell_s: 13, crossfade_s: 4 }]);
  expect(itemsAfter(fresh, { kind: "remove_preset", preset_id: 77 }).length).toBe(4);   // not in it: nothing goes
});

test("playlistChips: one per playlist of yours, lit when this look's preset is an item of it", () => {
  const view = (id, ids) => ({ id, name: `p${id}`, owner: "jo", fetched_at: 1, unavailable: 0, items: ids.map((n) => ({ preset_id: n, version: 1, owner: "jo", name: "n", dwell_s: 1, crossfade_s: 1, params: {} })) });
  const state = { ...EMPTY, origin: { mine: synced, behind: { ...synced, id: 13, synced: false }, loose: { parent: "look:a" } },
    playlists: { 7: view(7, [12, 5]), 8: view(8, [5]) } };
  const mine = [{ id: 7, name: "p7" }, { id: 8, name: "p8" }, { id: 9, name: "p9" }];   // 9 is not cached yet
  expect(playlistChips(state, { mine: {} }, "local", "mine", mine)).toEqual([
    { id: 7, name: "p7", lit: true }, { id: 8, name: "p8", lit: false }, { id: 9, name: "p9", lit: false }]);
  expect(playlistChips(state, { behind: {} }, "local", "behind", mine).every((c) => !c.lit)).toBe(true);   // an edited ★ is a newer look than the preset the playlist holds
  expect(playlistChips(state, { loose: {} }, "local", "loose", mine).every((c) => !c.lit)).toBe(true);
  expect(playlistChips(state, {}, "local", "afternoon 7", mine).every((c) => !c.lit)).toBe(true);
  expect(playlistChips(state, {}, "arb:8", "0", mine).map((c) => c.lit)).toEqual([true, true, false]);   // a cloud item: its own preset_id
});

// ---- cloud first: signed in, arboretum is where the looks live, and a full copy of it is kept here ---------------------------------

const preset = (id, name, extra = {}) => ({ id, version: 1, owner: "jo", name, params: { exposure: id }, ...extra });
const mirrorOf = (presets, lists = [], extra = {}) => {
  const m = { ...emptyMirror(), at: Date.UTC(2026, 9, 10, 12), order: presets.map((p) => p.id), presets: Object.fromEntries(presets.map((p) => [p.id, p])), ...extra };
  for (const l of lists) m.playlists.push({ id: l.id, name: l.name, owner: "jo", k: null, fetched_at: 1, unavailable: 0, items: l.ids.map((id) => ({ preset_id: id, version: 1, owner: "jo", name: m.presets[id]?.name ?? "?", dwell_s: 30, crossfade_s: 5, params: {} })) });
  return m;
};

test("an empty mirror holds nothing, and says it was never refreshed", () => {
  expect(emptyMirror()).toEqual({ v: 1, at: null, incomplete: false, order: [], presets: {}, playlists: [], queue: [] });
});

// ---- uncategorized: your presets that are in none of your playlists, newest first ----

test("uncategorized is your presets minus every preset in your playlists, in the mirror's newest-first order", () => {
  const m = mirrorOf([preset(5, "e"), preset(4, "d"), preset(3, "c"), preset(2, "b"), preset(1, "a")], [{ id: 7, name: "evening", ids: [4, 1] }, { id: 8, name: "morning", ids: [1, 2] }]);
  expect(uncategorized(m).map((i) => i.name)).toEqual(["e", "c"]);
});

test("an uncategorized item looks like a playlist item, with arboretum's default times", () => {
  const [it] = uncategorized(mirrorOf([preset(5, "e", { version: 3 })]));
  expect(it).toEqual({ preset_id: 5, version: 3, owner: "jo", name: "e", dwell_s: 30, crossfade_s: 5, params: { exposure: 5 } });
});

test("another user's item in one of your playlists does not hide a preset of yours that shares no id with it", () => {
  const m = mirrorOf([preset(5, "mine")], [{ id: 7, name: "evening", ids: [99] }]);   // 99 is someone else's: not in the mirror's presets
  expect(uncategorized(m).map((i) => i.name)).toEqual(["mine"]);
});

test("a save that waits to go up is uncategorized too, newest first and marked pending; an update to a preset patches it where it is", () => {
  let m = mirrorOf([preset(5, "e"), preset(4, "d")]);
  m = enqueue(m, { kind: "preset", path: "/api/presets", body: { name: "fresh", params: { exposure: 9 } } });
  m = enqueue(m, { kind: "version", path: "/api/presets/4/versions", body: { name: "d2", params: { exposure: 44 } } });
  const items = uncategorized(m);
  expect(items.map((i) => i.name)).toEqual(["fresh", "e", "d2"]);
  expect(items[0]).toMatchObject({ pending: true, params: { exposure: 9 } });
  expect(items[0].preset_id).toBeUndefined();
  expect(items[2]).toMatchObject({ preset_id: 4, pending: true, params: { exposure: 44 } });
  expect(items[1].pending).toBeUndefined();
});

// ---- the view: signed in, the mirror's lists join the state; signed out, there is no mirror ----

test("viewState signed out is the state itself: the mirror shows nowhere", () => {
  const state = { ...EMPTY, playlists: { 3: { id: 3, name: "linked", owner: "ana", items: [] } } };
  const m = mirrorOf([preset(5, "e")], [{ id: 7, name: "evening", ids: [5] }], { queue: [{ seq: 1, kind: "preset", path: "/api/presets", body: { name: "q", params: {} } }] });
  expect(viewState(state, m, null)).toBe(state);
});

test("a signed-in view excludes another account's mirror and waiting saves", () => {
  let m = mirrorOf([preset(5, "alice", { owner: "alice" })], [{ id: 7, name: "alice's folder", ids: [5] }]);
  m.playlists[0].owner = "alice";
  m = enqueue(m, { owner: "alice", kind: "preset", path: "/api/presets", body: { name: "waiting", params: {} } });
  const v = viewState(EMPTY, m, "bob");
  expect(v.playlists.unc.items).toEqual([]);
  expect(v.playlists[7]).toBeUndefined();
  expect(listChoices(v, { me: "bob", stored: {}, mirror: m }).map((l) => l.value)).toEqual(["arb:unc", "builtins"]);
});

test("viewState signed in adds your playlists and the uncategorized list, dated by the last refresh", () => {
  const m = mirrorOf([preset(5, "e"), preset(4, "d")], [{ id: 7, name: "evening", ids: [4] }]);
  const v = viewState(EMPTY, m, "jo");
  expect(Object.keys(v.playlists).sort()).toEqual(["7", "unc"]);
  expect(v.playlists.unc).toMatchObject({ id: "unc", name: "uncategorized", owner: "jo", fetched_at: m.at });
  expect(v.playlists.unc.items.map((i) => i.name)).toEqual(["e"]);
  expect(v.playlists[7].fetched_at).toBe(m.at);
  expect(plays(v, "arb:unc")).toBe(true);
  expect(entries(v, {}, fake, false, "arb:unc", "0").map((e) => e.label)).toEqual(["e"]);
});

test("a waiting update shows in the playlists that hold the preset, and a waiting new look in the folder it was saved into", () => {
  let m = mirrorOf([preset(5, "e"), preset(4, "d")], [{ id: 7, name: "evening", ids: [4] }]);
  m = enqueue(m, { owner: "jo", kind: "version", path: "/api/presets/4/versions", body: { name: "d2", params: { exposure: 44 } } });
  m = enqueue(m, { owner: "jo", kind: "preset", path: "/api/presets", body: { name: "fresh", params: {} }, into: { playlist: 7, at: null } });
  const items = viewState(EMPTY, m, "jo").playlists[7].items;
  expect(items.map((i) => i.name)).toEqual(["d2", "fresh"]);
  expect(items.map((i) => !!i.pending)).toEqual([true, true]);
  expect(viewState(EMPTY, m, "jo").playlists.unc.items.map((i) => i.name)).toEqual(["e"]);   // the new look is in a folder: not uncategorized
});

// ---- the lists the select offers ----

const labels = (c) => c.map((l) => `${l.value}=${l.label}`);

test("signed out: all looks, then the cached playlists as before — the mirror is never offered", () => {
  const m = mirrorOf([preset(5, "e")], [{ id: 7, name: "evening", ids: [5] }]);
  const state = { ...EMPTY, playlists: { 3: { id: 3, name: "linked", owner: "ana", items: [] } } };
  expect(labels(listChoices(viewState(state, m, null), { me: null, stored: { x: {} }, mirror: m }))).toEqual(["local=all looks", "arb:3=linked"]);
});

test("signed in: uncategorized, your playlists, built-ins — and on this browser only while un-moved ★s exist", () => {
  const m = mirrorOf([preset(5, "e"), preset(4, "d")], [{ id: 8, name: "morning", ids: [4] }, { id: 7, name: "evening", ids: [] }]);
  const v = viewState(EMPTY, m, "jo");
  expect(labels(listChoices(v, { me: "jo", stored: {}, mirror: m }))).toEqual(["arb:unc=uncategorized", "arb:8=morning", "arb:7=evening", "builtins=built-ins"]);
  expect(labels(listChoices(v, { me: "jo", stored: { x: {} }, mirror: m })).at(-1)).toBe("local=on this browser");
  const synced = { ...EMPTY, origin: { x: { id: 5, version: 1, owner: "jo", synced: true } } };
  expect(labels(listChoices(viewState(synced, m, "jo"), { me: "jo", stored: { x: {} }, mirror: m })).at(-1)).toBe("builtins=built-ins");   // already in arboretum: not un-moved
});

test("uncategorized is hidden when it is empty and you have other folders — unless you are in it", () => {
  const m = mirrorOf([preset(4, "d")], [{ id: 8, name: "morning", ids: [4] }]);
  const v = viewState(EMPTY, m, "jo");
  expect(labels(listChoices(v, { me: "jo", stored: {}, mirror: m }))).toEqual(["arb:8=morning", "builtins=built-ins"]);
  expect(labels(listChoices(v, { me: "jo", stored: {}, mirror: m, active: "arb:unc" }))[0]).toBe("arb:unc=uncategorized");
  const none = mirrorOf([]);
  expect(labels(listChoices(viewState(EMPTY, none, "jo"), { me: "jo", stored: {}, mirror: none }))).toEqual(["arb:unc=uncategorized", "builtins=built-ins"]);   // no folders at all: it always exists
});

test("signed in: a playlist cached from a link is listed after yours, with its owner", () => {
  const m = mirrorOf([preset(5, "e")], [{ id: 8, name: "morning", ids: [] }]);
  const state = { ...EMPTY, playlists: { 3: { id: 3, name: "linked", owner: "ana", items: [] } } };
  expect(labels(listChoices(viewState(state, m, "jo"), { me: "jo", stored: {}, mirror: m }))).toEqual(["arb:unc=uncategorized", "arb:8=morning", "arb:3=linked · ana", "builtins=built-ins"]);
});

test("isFolder: a playlist of yours that can be written to, not uncategorized, not someone else's", () => {
  const m = mirrorOf([], [{ id: 8, name: "morning", ids: [] }]);
  const state = { ...EMPTY, playlists: { 3: { id: 3, name: "linked", owner: "ana", items: [] } } };
  const v = viewState(state, m, "jo");
  expect(isFolder(v, "arb:8", "jo")).toBe(true);
  expect(isFolder(v, "arb:unc", "jo")).toBe(false);
  expect(isFolder(v, "arb:3", "jo")).toBe(false);
  expect(isFolder(v, "builtins", "jo")).toBe(false);
  expect(isFolder(v, "local", "jo")).toBe(false);
});

// ---- entries per list ----

test("entries of built-ins are the built-ins alone; signed in, on this browser is the un-moved ★s alone; signed out, all looks are both", () => {
  const stored = { x: {}, y: {} };
  const state = { ...cloud([{ ...item("y"), preset_id: 5 }]), me: { username: "jo" }, origin: { y: { id: 5, version: 1, owner: "jo", synced: true } } };
  expect(entries(state, stored, fake, false, "builtins", "a").map((e) => e.label)).toEqual(["• a", "• c"]);
  expect(entries(state, stored, fake, false, "local", "a", true).map((e) => e.label)).toEqual(["★ x"]);
  expect(entries(state, stored, fake, false, "local", "a").map((e) => e.label)).toEqual(["• a", "• c", "★ x", "★ y"]);
});

test("a built-ins value loads its built-in, even beside a ★ of the same name", () => {
  expect(resolve(EMPTY, { "afternoon 7": { exposure: 9 } }, "builtins", "afternoon 7").exposure).toBe(builtins.PRESETS["afternoon 7"].exposure);
});

// ---- the mirror, kept in step with arboretum ----

const summaries = (...ps) => ps.map(({ id, version = 1, name, owner = "jo" }) => ({ id, version, name, owner }));

test("mirrorDiff names the presets to fetch — new ones and ones whose version moved — and not the unchanged", () => {
  const m = mirrorOf([preset(5, "e"), preset(4, "d", { version: 2 }), preset(3, "c")]);
  const d = mirrorDiff(m, summaries({ id: 6, name: "f" }, { id: 5, name: "e" }, { id: 4, version: 3, name: "d" }));
  expect(d.fetch).toEqual([6, 4]);
  expect(d.order).toEqual([6, 5, 4]);
  expect(d.gone).toEqual([3]);
});

test("mirrorSync keeps the unchanged presets as they were, takes the fetched ones, drops the gone ones, and dates the refresh", () => {
  const m = mirrorOf([preset(5, "e"), preset(3, "c")]);
  const fetched = { 6: { id: 6, owner: "jo", name: "f", version: 1, params: { exposure: 6 } } };
  const out = mirrorSync(m, summaries({ id: 6, name: "f" }, { id: 5, name: "e" }), fetched, [], [], 1234);
  expect(out.order).toEqual([6, 5]);
  expect(out.presets[5]).toBe(m.presets[5]);
  expect(out.presets[6]).toEqual({ id: 6, version: 1, owner: "jo", name: "f", params: { exposure: 6 } });
  expect(out.presets[3]).toBeUndefined();
  expect(out.at).toBe(1234);
});

test("mirrorSync takes your playlists' views in the order arboretum lists them; one that could not be fetched keeps its old copy; the queue is untouched", () => {
  const m = mirrorOf([], [{ id: 7, name: "old seven", ids: [] }, { id: 9, name: "gone", ids: [] }], { queue: [{ seq: 1, kind: "preset", path: "/api/presets", body: { name: "q", params: {} } }] });
  const sums = [{ id: 8, name: "eight" }, { id: 7, name: "seven" }];
  const out = mirrorSync(m, [], {}, sums, [{ id: 8, name: "eight", owner: "jo", items: [] }, null], 5);
  expect(out.playlists.map((l) => l.id)).toEqual([8, 7]);
  expect(out.playlists.find((l) => l.id === 7).name).toBe("old seven");
  expect(out.playlists.find((l) => l.id === 8).name).toBe("eight");
  expect(out.queue).toEqual(m.queue);
});

test("mirrorPut files a preset at the front of the order, whether new or a new version", () => {
  const m = mirrorOf([preset(5, "e"), preset(4, "d")]);
  const out = mirrorPut(m, preset(4, "d2", { version: 2 }));
  expect(out.order).toEqual([4, 5]);
  expect(out.presets[4].version).toBe(2);
  expect(mirrorPut(m, preset(9, "n")).order).toEqual([9, 5, 4]);
});

test("mirrorPlaylist files a playlist's view as cachePlaylist stores it, unavailable items out", () => {
  const out = mirrorPlaylist(emptyMirror(), { id: 7, name: "evening", owner: "jo", items: [{ preset_id: 5, version: 1, owner: "jo", name: "e", dwell_s: 1, crossfade_s: 1, params: {} }, { preset_id: 99, dwell_s: 1, crossfade_s: 1, unavailable: true }] });
  expect(out.playlists[0].items.map((i) => i.preset_id)).toEqual([5]);
  expect(out.playlists[0].unavailable).toBe(1);
});

// ---- saves that wait ----

test("the queue keeps saves in the order they were made, numbered, and dequeue takes one out by its number", () => {
  let m = emptyMirror();
  m = enqueue(m, { kind: "preset", path: "/api/presets", body: { name: "a", params: {} } });
  m = enqueue(m, { kind: "preset", path: "/api/presets", body: { name: "b", params: {} } });
  m = enqueue(m, { kind: "version", path: "/api/presets/4/versions", body: { name: "c", params: {} } });
  expect(m.queue.map((q) => [q.seq, q.body.name])).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
  const rest = dequeue(m, 2);
  expect(rest.queue.map((q) => q.body.name)).toEqual(["a", "c"]);
  expect(enqueue(rest, { kind: "preset", path: "/api/presets", body: { name: "d", params: {} } }).queue.at(-1).seq).toBe(4);   // numbers are never reused while others wait
});

// ---- moving the local looks in ----

const edited = { ...afternoon, exposure: afternoon.exposure + 0.5 };

test("moveCandidates are the ★s that are not yet a synced arboretum preset", () => {
  const state = { ...EMPTY, origin: { synced: { id: 5, version: 1, owner: "jo", synced: true }, behind: { id: 6, version: 1, owner: "jo", synced: false }, child: { parent: "look:afternoon 7" } } };
  expect(moveCandidates(state, { synced: {}, behind: {}, child: {}, loose: {} })).toEqual(["behind", "child", "loose"]);
  expect(moveCandidates(EMPTY, {})).toEqual([]);
});

test("movePlan plans each as uploadPlan does: a new version of a preset of yours, a new preset (with its parent) otherwise, a refusal for an unchanged built-in", () => {
  const state = { ...EMPTY, origin: { behind: { id: 6, version: 2, owner: "jo", synced: false }, child: { parent: "look:afternoon 7" } } };
  const stored = { behind: edited, child: edited, twin: afternoon };
  const plans = movePlan(state, stored, "jo", COMMIT, cameraFor);
  expect(plans.map((p) => p.name)).toEqual(["behind", "child", "twin"]);
  expect(plans[0].plan).toMatchObject({ kind: "version", path: "/api/presets/6/versions", body: { name: "behind", komorebi_commit: COMMIT } });
  expect(plans[1].plan).toMatchObject({ kind: "preset", path: "/api/presets", body: { name: "child", parent: "look:afternoon 7" } });
  expect(plans[2].plan.refused).toMatch(/afternoon 7/);
});

// ---- saving when signed in: every save goes to arboretum, and never asks where ----

test("savePlan in a folder of yours is the playlist rules as they were: a new version of the item, or a new preset placed there", () => {
  const m = mirrorOf([preset(5, "e")], [{ id: 8, name: "morning", ids: [5] }]);
  const v = viewState(EMPTY, m, "jo");
  const same = savePlan(v, {}, "arb:8", "0", edited, "jo", null, cameraFor, "e");
  expect(same).toMatchObject({ kind: "version", path: "/api/presets/5/versions", into: { playlist: 8, at: 0 }, target: "folder" });
  const fresh = savePlan(viewState(EMPTY, mirrorOf([], [{ id: 8, name: "morning", ids: [] }]), "jo"), {}, "arb:8", "", edited, "jo", null, cameraFor, "new");
  expect(fresh).toMatchObject({ kind: "preset", into: { playlist: 8, at: null }, target: "folder" });
});

test("savePlan outside a folder targets uncategorized: from a built-in a new preset parented on it", () => {
  const p = savePlan(EMPTY, {}, "builtins", "afternoon 7", edited, "jo", COMMIT, cameraFor, "mine");
  expect(p).toMatchObject({ kind: "preset", path: "/api/presets", target: "unc", body: { name: "mine", parent: "look:afternoon 7", komorebi_commit: COMMIT } });
  expect(p.body.params).toEqual(edited);
  expect(p.into).toBeUndefined();
});

test("savePlan from an uncategorized item of yours is a new version of it; from someone else's playlist, a new preset parented on theirs", () => {
  const m = mirrorOf([preset(5, "e", { version: 3 })]);
  const v = viewState(EMPTY, m, "jo");
  expect(savePlan(v, {}, "arb:unc", "0", edited, "jo", null, cameraFor, "e2")).toMatchObject({ kind: "version", path: "/api/presets/5/versions", target: "unc", body: { name: "e2" } });
  const theirs = { ...EMPTY, playlists: { 3: { id: 3, name: "linked", owner: "ana", items: [{ preset_id: 6, version: 3, owner: "ana", name: "dusk", dwell_s: 1, crossfade_s: 1, params: afternoon }] } } };
  const p = savePlan(theirs, {}, "arb:3", "0", edited, "jo", null, cameraFor, "mine");
  expect(p).toMatchObject({ kind: "preset", target: "unc", body: { name: "mine", parent: "preset:6@3" } });
  expect(p.into).toBeUndefined();
});

test("savePlan from an un-moved ★ carries its parent; an unchanged built-in is refused; a pasted look with no origin is a plain new preset", () => {
  const state = { ...EMPTY, origin: { star: { parent: "look:afternoon 7" } } };
  expect(savePlan(state, { star: edited }, "local", "star", edited, "jo", null, cameraFor, "again").body.parent).toBe("look:afternoon 7");
  expect(savePlan(EMPTY, {}, "builtins", "afternoon 7", afternoon, "jo", null, cameraFor, "same").refused).toMatch(/afternoon 7/);
  const pasted = savePlan(EMPTY, {}, "builtins", "memories", { ...edited, seed: 5 }, "jo", null, cameraFor, "pasted");
  expect(pasted.kind).toBe("preset");
});

test("savePlan tags a look experimental when its camera is not the floor", () => {
  const curtain = { ...clone("curtain 1"), seed: clone("curtain 1").seed + 1 };
  expect(savePlan(EMPTY, {}, "builtins", "curtain 1", curtain, "jo", null, cameraFor, "c").body.tags).toEqual(["experimental"]);
});

// ---- the chip, for the mirror ----

test("lookState: a waiting save is ⇡ waiting to go up, and the title says when the copy here is incomplete", () => {
  const m = enqueue(mirrorOf([preset(5, "e")]), { owner: "jo", kind: "preset", path: "/api/presets", body: { name: "q", params: afternoon } });
  const v = viewState(EMPTY, m, "jo");
  expect(lookState(v, {}, "arb:unc", "0", afternoon, "jo").text).toBe("⇡ waiting to go up");
  expect(lookState(v, {}, "arb:unc", "1", { ...preset(5, "e").params }, "jo", { offline: true }).text).toBe("offline copy · 2026-10-10");
  expect(lookState(v, {}, "arb:unc", "1", preset(5, "e").params, "jo", { offline: true, incomplete: true }).title).toContain("offline copy incomplete");
  expect(lookState(v, {}, "arb:unc", "1", preset(5, "e").params, "jo").title).not.toContain("incomplete");
});
