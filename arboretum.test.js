// ============================================================================
// Arboretum is the place the editor stores presets, local or online (arboretum.js). It lives in the editor and nowhere else: its
// code must never be in an engine module or a bundle a stranger embeds. And it asks the network for nothing it was not asked
// for: off komorebi.eljojo.net and arboretum's dev host it runs local-only, and the one thing that reaches out is a link the
// person opened. Each claim is a test, like maze.test.js's "nothing ships": a leak fails silently otherwise, because a bundle
// that carries dead code still renders.
// ============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./embed-build.mjs";
import { api } from "./arboretum-api.js";
import { getStored, getMirror, MIRROR_KEY, mount, setMirror, setState } from "./arboretum.js";
import { emptyMirror, enqueue, parseHash, starValue } from "./playlists.js";
import * as model from "./playlists.js";

const HOME = ["morning 2", "afternoon 5b", "morning 3"];   // the three-look set the homepage loads
const engine = () => [...readdirSync(".").filter((f) => /^komorebi-.*\.js$/.test(f)), "komorebi.js", "komorebi.global.js", "presets.js", "macros.js"];

test("nothing ships: no engine module, bundle shim, preset or macro names arboretum", () => {
  for (const f of engine()) expect(/arboretum/i.test(readFileSync(f, "utf8")), f).toBe(false);
});

test("the wire is reached through arboretum.js alone: only arboretum.js imports arboretum-api.js", () => {
  for (const f of readdirSync(".").filter((f) => /\.(js|mjs)$/.test(f) && !/^arboretum(-api)?(\.test)?\.js$/.test(f))) {
    for (const line of readFileSync(f, "utf8").split("\n"))
      if (/^\s*(import|export)\b/.test(line) && /['"]\.\/arboretum-api(\.js)?['"]/.test(line)) throw new Error(`${f} imports the wire: ${line.trim()}`);
  }
});

test("the editor's gate to the preset store is a module with mount(host)", () => {
  expect(typeof mount).toBe("function");
});

// ---- the tiers: local always, read from any origin on request, the session only where detect says yes ----
beforeEach(() => {
  let store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
});
const at = (hostname, pathname = "/index.html") => ({ hostname, pathname, origin: `https://${hostname}` });
const host = { params: {}, rows: {}, active: () => "local", value: () => "", sync() {}, select() {}, reload() {}, activate() {}, show() {}, advancedShown: () => false };
const spy = (answer) => {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(answer), { status: 200 }); } };
};

const originalDocument = globalThis.document, originalWindow = globalThis.window;
afterEach(() => {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
});
const json = (body) => new Response(JSON.stringify(body));
// Only the DOM boundary is stubbed: session checks, storage and upload plans run through the real controller.
async function session(fetchImpl, extra = {}) {
  const elements = [], events = {};
  const element = () => {
    const e = { style: {}, dataset: {}, append() {}, after() {}, addEventListener() {}, replaceChildren() {}, setAttribute() {} };
    elements.push(e);
    return e;
  };
  globalThis.document = { body: element(), createElement: element };
  globalThis.window = { addEventListener: (name, fn) => { events[name] = fn; } };
  let synced;
  const h = { ...host, rows: { save: element(), tools: element() }, sync: () => synced?.(), ...extra };
  const a = mount(h, { loc: at("komorebi.eljojo.net"), fetchImpl });
  await a.ready;
  return { a, elements, start: () => new Promise((resolve) => { synced = resolve; a.advanced(); }), focus: () => events.focus() };
}

test("a different account cannot upload the previous account's waiting saves", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  setMirror(enqueue(emptyMirror(), { kind: "preset", path: "/api/presets", body: { name: "alice's look", params: { exposure: 99 } } }));
  let user = "bob";
  const writes = [];
  const s = await session(async (url, init) => {
    if (url.endsWith("/api/me")) return json({ username: user });
    if (init.method === "POST") { writes.push(user); return json({ id: 17, version: 1, owner: user }); }
    if (url.includes("/api/presets?")) return json({ presets: [] });
    if (url.includes("/api/playlists?")) return json({ playlists: [] });
    throw new Error(`unexpected ${url}`);
  });
  await s.start();
  expect(writes).toEqual([]);
  expect(getMirror().queue).toHaveLength(1);
  expect(s.a.view().playlists.unc.items).toEqual([]);
  user = "alice";
  await s.focus();
  expect(writes).toEqual(["alice"]);
  expect(getMirror().queue).toEqual([]);
});

test("signing out preserves the owner of legacy waiting saves", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  setMirror(enqueue(emptyMirror(), { kind: "preset", path: "/api/presets", body: { name: "waiting", params: {} } }));
  let user = null;
  const writes = [];
  const s = await session(async (url, init) => {
    if (url.endsWith("/api/me")) return user ? json({ username: user }) : new Response("{}", { status: 401 });
    if (init.method === "POST") { writes.push(user); return json({ id: 17, version: 1 }); }
    return json(url.includes("/api/presets?") ? { presets: [] } : { playlists: [] });
  });
  await s.start();
  expect(getMirror().queue[0].owner).toBe("alice");
  user = "bob";
  await s.focus();
  expect(writes).toEqual([]);
  expect(getMirror().queue).toHaveLength(1);
});

test("failed ownership persistence cannot reassign a legacy queue on the next check", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  setMirror(enqueue(emptyMirror(), { kind: "preset", path: "/api/presets", body: { name: "waiting", params: {} } }));
  const set = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === MIRROR_KEY) throw new Error("quota"); set(k, v); };
  const writes = [];
  const s = await session(async (url, init) => {
    if (url.endsWith("/api/me")) return json({ username: "bob" });
    if (init.method === "POST") { writes.push("bob"); return json({ id: 17, version: 1 }); }
    return json(url.includes("/api/presets?") ? { presets: [] } : { playlists: [] });
  });
  await s.start();
  expect(s.a.signedIn()).toBe(false);
  localStorage.setItem = set;
  await s.focus();
  expect(writes).toEqual([]);
  expect(getMirror().queue[0].owner).toBe("alice");
});

test("a legacy queue with no known owner stays unsent across repeated session checks", async () => {
  setMirror(enqueue(emptyMirror(), { kind: "preset", path: "/api/presets", body: { name: "unknown owner", params: {} } }));
  const writes = [];
  const s = await session(async (url, init) => {
    if (url.endsWith("/api/me")) return json({ username: "bob" });
    if (init.method === "POST") { writes.push("bob"); return json({ id: 17, version: 1 }); }
    return json(url.includes("/api/presets?") ? { presets: [] } : { playlists: [] });
  });
  await s.start();
  await s.focus();
  expect(writes).toEqual([]);
  expect(getMirror().queue).toHaveLength(1);
});

test("an offline save rejected by storage reports failure without selecting a nonexistent waiting save", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const shown = [];
  const s = await session(async () => { throw new Error("offline"); }, { showCloud: (...args) => shown.push(args) });
  const set = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === MIRROR_KEY) throw new Error("quota"); set(k, v); };
  const live = { exposure: 99 };
  await s.a.saveCloud("waiting", live);
  expect(shown).toEqual([]);
  expect(getMirror().queue).toEqual([]);
  expect(s.elements.find((e) => e.className === "arb-status").textContent).toMatch(/could not save.*storage/i);
  expect(live).toEqual({ exposure: 99 });
});

test("a persisted offline save is selected and bound to the current account", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const shown = [];
  const s = await session(async () => { throw new Error("offline"); }, { showCloud: (...args) => shown.push(args) });
  await s.a.saveCloud("waiting", { exposure: 99 });
  expect(getMirror().queue[0]).toMatchObject({ owner: "alice", body: { name: "waiting", params: { exposure: 99 } } });
  expect(shown).toEqual([["arb:unc", { seq: 1 }]]);
});

test("the editor keeps the selected preset across a mirror reorder, so saving updates that preset", () => {
  const one = { id: 1, version: 1, owner: "alice", name: "one", params: { exposure: 11 } };
  const two = { id: 2, version: 1, owner: "alice", name: "two", params: { exposure: 22 } };
  const m = { ...emptyMirror(), order: [1, 2], presets: { 1: one, 2: two } };
  let state = model.viewState({ origin: {}, playlists: {} }, m, "alice");
  const select = { value: "", appendChild() {} };
  const settings = { selected: {} };
  const source = readFileSync("editor.js", "utf8");
  const body = source.slice(source.indexOf("function refreshPresetSelect("), source.indexOf("// the playlist select exists"));
  const refresh = new Function("presetSel", "presetSelects", "listEntries", "document", "settings", "activeList", "stateNow", "selectionAfter", "saveSettings", "syncPlayPreset", "syncPlaylistUI",
    `let listedState=null, listedActive=null; ${body}; return refreshPresetSelect;`)(
    select, [select], () => model.entries(state, {}, { PRESETS: {}, EXPERIMENTAL: [] }, false, "arb:unc"), { createElement: () => ({}) },
    settings, () => "arb:unc", () => state, model.selectionAfter, () => {}, () => {}, () => {});
  refresh("0");
  state = model.viewState({ origin: {}, playlists: {} }, model.mirrorSync(m, [two, one], {}, [], [], 1), "alice");
  refresh();
  expect(select.value).toBe("1");
  const plan = model.savePlan(state, {}, "arb:unc", select.value, one.params, "alice", null, () => "floor", "one");
  expect(plan.path).toBe("/api/presets/1/versions");
  expect(plan.body.params).toEqual(one.params);
  state = model.viewState({ origin: {}, playlists: {} }, model.mirrorSync(m, [two], {}, [], [], 2), "alice");
  refresh();
  expect(select.value).toBe("");
  expect(model.savePlan(state, {}, "arb:unc", select.value, one.params, "alice", null, () => "floor", "one").kind).toBe("preset");
  expect(model.lookState(state, {}, "arb:unc", "", one.params, "alice")).toEqual({ text: "", title: "" });
});

const playlistItem = (id, owner = "alice", dwell_s = id * 10) => ({ preset_id: id, version: 1, owner, name: `look ${id}`, params: { exposure: id }, dwell_s, crossfade_s: 2 });
const folderMirror = (items) => ({ ...emptyMirror(), playlists: [{ id: 7, owner: "alice", name: "folder", items }] });
const wireItems = (items) => items.map(({ preset_id, dwell_s, crossfade_s }) => ({ preset_id, dwell_s, crossfade_s }));

test("removing after a concurrent reorder removes the displayed item, preserving unavailable entries", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const one = playlistItem(1), two = playlistItem(2), unavailable = { preset_id: 9, dwell_s: 40, crossfade_s: 7, unavailable: true };
  setMirror(folderMirror([one, two]));
  let active = "local";
  const writes = [];
  const s = await session(async (_url, init) => {
    if (init.method === "PUT") { const body = JSON.parse(init.body); writes.push(body.items); return json({ id: 7, owner: "alice", items: body.items }); }
    return json({ id: 7, owner: "alice", items: [two, unavailable, one] });
  }, { active: () => active, value: () => "0" });
  active = "arb:7";
  await s.a.remove();
  expect(writes).toEqual([wireItems([two, unavailable])]);
});

test("a fork replaces its original playlist item after a concurrent reorder", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const one = playlistItem(1, "bob"), two = playlistItem(2);
  setMirror(folderMirror([one, two]));
  let active = "local";
  const writes = [];
  const s = await session(async (url, init) => {
    if (url === "./commit.json") return new Response("{}", { status: 404 });
    if (init.method === "POST") return json({ id: 3, version: 1, owner: "alice" });
    if (init.method === "PUT") { const body = JSON.parse(init.body); writes.push(body.items); return json({ id: 7, owner: "alice", items: body.items }); }
    return json({ id: 7, owner: "alice", items: [two, one] });
  }, { active: () => active, value: () => "0", showCloud() {} });
  active = "arb:7";
  await s.a.saveCloud("fork", { exposure: 99 });
  expect(writes).toEqual([wireItems([two, { ...one, preset_id: 3 }])]);
});

test("a vanished playlist item cannot cause a write to another item", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const one = playlistItem(1), two = playlistItem(2);
  setMirror(folderMirror([one, two]));
  let active = "local";
  const writes = [];
  const s = await session(async (_url, init) => {
    if (init.method === "PUT") { const body = JSON.parse(init.body); writes.push(body.items); return json({ id: 7, owner: "alice", items: body.items }); }
    return json({ id: 7, owner: "alice", items: [two] });
  }, { active: () => active, value: () => "0" });
  active = "arb:7";
  await s.a.remove();
  expect(writes).toEqual([]);
  expect(s.elements.find((e) => e.className === "arb-status").textContent).toMatch(/item.*changed/i);
});

test("duplicate presets with different dwell times retain the intended playlist place", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const short = playlistItem(1), long = playlistItem(1, "alice", 100), two = playlistItem(2);
  setMirror(folderMirror([short, two, long]));
  let active = "local";
  const writes = [];
  const s = await session(async (_url, init) => {
    if (init.method === "PUT") { const body = JSON.parse(init.body); writes.push(body.items); return json({ id: 7, owner: "alice", items: body.items }); }
    return json({ id: 7, owner: "alice", items: [long, short, two] });
  }, { active: () => active, value: () => "2" });
  active = "arb:7";
  await s.a.remove();
  expect(writes).toEqual([wireItems([short, two])]);
});

test("a fork whose playlist target vanished remains uncategorized and keeps the refusal visible", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  setMirror(folderMirror([playlistItem(1, "bob"), playlistItem(2)]));
  let active = "local";
  const writes = [], shown = [];
  const s = await session(async (url, init) => {
    if (url === "./commit.json") return new Response("{}", { status: 404 });
    if (init.method === "POST") return json({ id: 3, version: 1, owner: "alice" });
    if (init.method === "PUT") { writes.push(JSON.parse(init.body).items); return json({ id: 7, owner: "alice", items: [] }); }
    return json({ id: 7, owner: "alice", items: [playlistItem(2)] });
  }, { active: () => active, value: () => "0", showCloud: (...args) => shown.push(args) });
  active = "arb:7";
  await s.a.saveCloud("fork", { exposure: 99 });
  expect(writes).toEqual([]);
  expect(getMirror().presets[3].params).toEqual({ exposure: 99 });
  expect(s.elements.find((e) => e.className === "arb-status").textContent).toMatch(/item.*changed/i);
  expect(shown).toEqual([["arb:unc", { id: 3 }]]);
});

test("a signed-in shared preset link remains selectable on this browser", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const s = await session(async () => json({ id: 20, owner: "bob", version: 1, name: "shared", params: { exposure: 99 } }));
  const opened = await s.a.open(parseHash("#arboretum=20"));
  expect(s.a.lists("local").some((l) => l.value === "local")).toBe(true);
  expect(model.entries(s.a.view(), getStored(), { PRESETS: {}, EXPERIMENTAL: [] }, false, "local", opened.value, true)).toEqual([{ value: "shared", label: "★ shared" }]);
  expect(model.resolve(s.a.view(), getStored(), "local", opened.value)).toEqual({ exposure: 99 });
  expect(model.moveCandidates(s.a.view(), getStored())).toEqual([]);
});

test("a pinned version of an owned preset remains selectable beside its newer mirrored head", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const head = { id: 20, owner: "alice", version: 2, name: "mine", params: { exposure: 22 } };
  setMirror({ ...emptyMirror(), order: [20], presets: { 20: head } });
  const s = await session(async (url) => json(url.includes("/versions/") ? { preset_id: 20, n: 1, name: "old", params: { exposure: 11 } } : head));
  const opened = await s.a.open(parseHash("#arboretum=20@1"));
  expect(s.a.lists("local").some((l) => l.value === "local")).toBe(true);
  expect(model.entries(s.a.view(), getStored(), { PRESETS: {}, EXPERIMENTAL: [] }, false, "local", opened.value, true).map((e) => e.value)).toContain(opened.value);
  expect(model.resolve(s.a.view(), getStored(), "local", opened.value)).toEqual({ exposure: 11 });
});

test("opening the mirrored owned head lands on its cloud entry", async () => {
  setState({ v: 1, me: { username: "alice" }, origin: {}, playlists: {} });
  const head = { id: 20, owner: "alice", version: 2, name: "mine", params: { exposure: 22 } };
  setMirror({ ...emptyMirror(), order: [20], presets: { 20: head } });
  const s = await session(async () => json(head));
  const opened = await s.a.open(parseHash("#arboretum=20"));
  expect(opened).toEqual({ list: "arb:unc", value: "0" });
  expect(model.resolve(s.a.view(), getStored(), opened.list, opened.value)).toEqual(head.params);
});

test("with detect null, mounting makes no fetch and builds nothing", async () => {
  for (const loc of [at("example.org"), at("fork.github.io"), at("localhost", "/index.html"), at("localhost", "/")]) {
    const f = spy({});
    const a = mount(host, { loc, fetchImpl: f.fetchImpl });
    expect(await a.ready, loc.hostname).toBeNull();
    expect(f.calls, loc.hostname).toEqual([]);
  }
});

test("opening a link on any origin is one GET to arboretum, credentials omitted, and lands as a ★", async () => {
  const f = spy({ id: 12, owner: "ana", name: "dusk", version: 2, params: { exposure: 2 } });
  const a = mount(host, { loc: at("example.org"), fetchImpl: f.fetchImpl });
  const out = await a.open(parseHash("#arboretum=12"));
  expect(f.calls.length).toBe(1);
  expect(f.calls[0].url).toBe("https://arboretum.eljojo.net/api/presets/12");
  expect(f.calls[0].init.method).toBe("GET");
  expect(f.calls[0].init.credentials).toBe("omit");
  expect(out).toEqual({ value: starValue("dusk") });
  expect(getStored()).toEqual({ dusk: { exposure: 2 } });
});

test("a link the browser blocks is a quiet failure: the reason, no ★, nothing thrown", async () => {
  const a = mount(host, { loc: at("example.org"), fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  const out = await a.open(parseHash("#arboretum=12"));
  expect(out.failed).toBe("arboretum unreachable");
  expect(getStored()).toEqual({});
});

let dir, player, embed;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "komorebi-arboretum-leak-"));
  player = build({ out: join(dir, "player.js"), quiet: true });
  embed = build({ looks: HOME, out: join(dir, "embed.js"), quiet: true });
}, 120000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("no player or embed bundle contains arboretum code", () => {
  for (const [name, b] of [["player", player], ["embed", embed]]) {
    const text = readFileSync(b.out, "utf8");
    expect(text.length, `${name} bundle was built`).toBeGreaterThan(10000);
    expect(/arboretum/i.test(text), `${name} bundle`).toBe(false);
  }
});

// ---- commit.json (design §4.3): written by the deploy, read by arboretum-api.js --------------------------------------------
const PAGES = readFileSync(".github/workflows/pages.yml", "utf8");

test("pages.yml writes commit.json from $GITHUB_SHA into the site, after the site is assembled", () => {
  const steps = PAGES.split("\n").filter((l) => /^\s*(- )?run:/.test(l));
  const at = steps.findIndex((l) => l.includes("_site/commit.json"));
  expect(at, "a step writes _site/commit.json").toBeGreaterThan(-1);
  expect(steps[at]).toContain("$GITHUB_SHA");
  expect(PAGES.indexOf("_site/commit.json")).toBeGreaterThan(PAGES.indexOf("Assemble the site"));
});

test("and what that step writes is a commit.json the editor's api reads", async () => {
  const cmd = PAGES.split("\n").find((l) => l.includes("_site/commit.json")).replace(/^\s*(- )?run:\s*/, "");
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const tmp = mkdtempSync(join(tmpdir(), "komorebi-commit-"));
  try {
    const run = Bun.spawnSync(["sh", "-c", `mkdir -p _site && ${cmd}`], { cwd: tmp, env: { ...process.env, GITHUB_SHA: sha } });
    expect(run.exitCode, new TextDecoder().decode(run.stderr)).toBe(0);
    const text = readFileSync(join(tmp, "_site", "commit.json"), "utf8");
    expect(await api("https://x", async () => new Response(text)).commit()).toBe(sha);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("a local checkout has no commit.json, so komorebi_commit is left out", () => {
  expect(readdirSync(".")).not.toContain("commit.json");
});
