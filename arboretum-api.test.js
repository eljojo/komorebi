// ============================================================================
// arboretum-api.js: every call the editor makes to arboretum, over a fake fetch. What is held here is the wire — URL and
// query, credentials, the Content-Type arboretum's CSRF guard demands of a write, and how an answer becomes a rejection the
// status line can show. No network, no DOM.
// ============================================================================
import { expect, test } from "bun:test";
import { api } from "./arboretum-api.js";

const ORIGIN = "https://arboretum.eljojo.net";

// A fetch that records each call and answers from a queue (or one fixed answer).
function fake(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a instanceof Error) throw a;
    return new Response(a.text !== undefined ? a.text : JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
  };
  return { calls, fetchImpl };
}
const rejection = async (p) => { try { await p; } catch (e) { return e; } throw new Error("did not reject"); };

test("each call goes to its route with the method arboretum expects, and credentials", async () => {
  const f = fake({ body: {} });
  const a = api(ORIGIN, f.fetchImpl);
  await a.health();
  await a.me();
  await a.preset(12);
  await a.presets();
  await a.playlists();
  await a.playlist(7);
  await a.create({ name: "x", params: {} });
  await a.addVersion(12, { name: "x", params: {} });
  await a.createPlaylist({ name: "mine" });
  await a.putItems(7, [{ preset_id: 12 }]);
  expect(f.calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
    `GET ${ORIGIN}/api/health`,
    `GET ${ORIGIN}/api/me`,
    `GET ${ORIGIN}/api/presets/12`,
    `GET ${ORIGIN}/api/presets?owner=me`,
    `GET ${ORIGIN}/api/playlists?owner=me`,
    `GET ${ORIGIN}/api/playlists/7`,
    `POST ${ORIGIN}/api/presets`,
    `POST ${ORIGIN}/api/presets/12/versions`,
    `POST ${ORIGIN}/api/playlists`,
    `PUT ${ORIGIN}/api/playlists/7/items`,
  ]);
  for (const c of f.calls) expect(c.init.credentials, c.url).toBe("include");
});

test("a preset link's @n and k become the version route and ?k=", async () => {
  const f = fake({ body: {} });
  const a = api(ORIGIN, f.fetchImpl);
  await a.preset(12, { n: 2 });
  await a.preset(12, { k: "tok" });
  await a.preset(12, { n: 2, k: "tok" });
  await a.playlist(7, { k: "tok" });
  expect(f.calls.map((c) => c.url)).toEqual([
    `${ORIGIN}/api/presets/12/versions/2`,
    `${ORIGIN}/api/presets/12?k=tok`,
    `${ORIGIN}/api/presets/12/versions/2?k=tok`,
    `${ORIGIN}/api/playlists/7?k=tok`,
  ]);
});

test("a write sends its body as JSON with the Content-Type arboretum's CSRF guard requires; a read sends neither", async () => {
  const f = fake({ body: {} });
  const a = api(ORIGIN, f.fetchImpl);
  const items = [{ preset_id: 12, dwell_s: 30 }];
  await a.create({ name: "x", params: { seed: 1 } });
  await a.addVersion(12, { params: {} });
  await a.createPlaylist({ name: "mine" });
  await a.putItems(7, items);
  await a.me();
  const [create, version, playlist, put, read] = f.calls.map((c) => c.init);
  for (const w of [create, version, playlist, put]) expect(w.headers).toEqual({ "Content-Type": "application/json" });
  expect(JSON.parse(create.body)).toEqual({ name: "x", params: { seed: 1 } });
  expect(JSON.parse(version.body)).toEqual({ params: {} });
  expect(JSON.parse(playlist.body)).toEqual({ name: "mine" });
  expect(JSON.parse(put.body)).toEqual({ items });
  expect(read.body).toBeUndefined();
  expect(read.headers).toBeUndefined();
});

test("a 2xx answer resolves with its JSON", async () => {
  const f = fake({ status: 201, body: { id: 12, version: 1 } });
  expect(await api(ORIGIN, f.fetchImpl).create({ name: "x", params: {} })).toEqual({ id: 12, version: 1 });
});

test("a 401 rejects with its status and arboretum's sentence", async () => {
  const f = fake({ status: 401, body: { error: "sign in, or send a bearer token" } });
  const e = await rejection(api(ORIGIN, f.fetchImpl).me());
  expect(e).toMatchObject({ status: 401, error: "sign in, or send a bearer token" });
});

test("a 422 keeps the error verbatim with its reason and keys", async () => {
  const body = { error: "arboretum is pinned to komorebi abc1234; unknown keys: foo, bar", reason: "unknown_keys", keys: ["foo", "bar"] };
  const e = await rejection(api(ORIGIN, fake({ status: 422, body }).fetchImpl).create({ name: "x", params: { foo: 1, bar: 2 } }));
  expect(e).toEqual({ status: 422, ...body });
});

test("a 429 names the limit it hit", async () => {
  const e = await rejection(api(ORIGIN, fake({ status: 429, body: { error: "at most 100 playlists per user", limit: "playlists" } }).fetchImpl).createPlaylist({ name: "n" }));
  expect(e).toMatchObject({ status: 429, error: "at most 100 playlists per user" });
});

test("an error whose body is not JSON still rejects, with the status", async () => {
  const e = await rejection(api(ORIGIN, fake({ status: 502, text: "<html>bad gateway</html>" }).fetchImpl).me());
  expect(e.status).toBe(502);
  expect(typeof e.error).toBe("string");
});

test("a fetch that throws rejects as arboretum unreachable", async () => {
  const e = await rejection(api(ORIGIN, fake(new TypeError("Failed to fetch")).fetchImpl).playlists());
  expect(e).toEqual({ status: 0, error: "arboretum unreachable" });
});

// ---- komorebi_commit (design §4.3) --------------------------------------------------------------------------------------
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("commit() reads ./commit.json once, lazily, and hands back the same answer after", async () => {
  const f = fake({ body: { commit: SHA } });
  const a = api(ORIGIN, f.fetchImpl);
  expect(f.calls.length).toBe(0);
  expect(await a.commit()).toBe(SHA);
  expect(await a.commit()).toBe(SHA);
  expect(f.calls.map((c) => c.url)).toEqual(["./commit.json"]);
});

test("commit() is null where the site has no commit.json (a 404: the dev mode, a local checkout)", async () => {
  const f = fake({ status: 404, text: "" });
  const a = api(ORIGIN, f.fetchImpl);
  expect(await a.commit()).toBeNull();
  expect(await a.commit()).toBeNull();
  expect(f.calls.length).toBe(1);
});

test("commit() is null for anything arboretum would refuse as a commit, and when the fetch fails", async () => {
  for (const a of [{ body: { commit: "not hex" } }, { body: {} }, { body: { commit: 7 } }, { status: 200, text: "<html>" }, new TypeError("offline")])
    expect(await api(ORIGIN, fake(a).fetchImpl).commit(), JSON.stringify(a)).toBeNull();
});
