// ============================================================================
// Arboretum is the place the editor stores presets, local or online (arboretum.js). It lives in the editor and nowhere else: its
// code must never be in an engine module or a bundle a stranger embeds. And it asks the network for nothing it was not asked
// for: off komorebi.eljojo.net and arboretum's dev host it runs local-only, and the one thing that reaches out is a link the
// person opened. Each claim is a test, like maze.test.js's "nothing ships": a leak fails silently otherwise, because a bundle
// that carries dead code still renders.
// ============================================================================
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./embed-build.mjs";
import { api } from "./arboretum-api.js";
import { getStored, mount } from "./arboretum.js";
import { parseHash, starValue } from "./playlists.js";

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
