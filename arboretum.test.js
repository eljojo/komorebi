// ============================================================================
// Arboretum stays out of komorebi (editor-integration-design §1, §8 K3). The editor is open source and arboretum is one
// deployment's service: its code must reach a browser only when playlists.js's `detect` names an origin, and must never be in an
// engine module or a bundle a stranger embeds. Each claim is a text assertion, like maze.test.js's "nothing ships": a leak
// fails silently otherwise, because a bundle that carries dead code still renders.
// ============================================================================
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./embed-build.mjs";
import { api } from "./arboretum-api.js";

const HOME = ["morning 2", "afternoon 5b", "morning 3"];   // the three-look set the homepage loads
const engine = () => [...readdirSync(".").filter((f) => /^komorebi-.*\.js$/.test(f)), "komorebi.js", "komorebi.global.js", "presets.js", "macros.js"];

test("nothing ships: no engine module, bundle shim, preset or macro names arboretum", () => {
  for (const f of engine()) expect(/arboretum/i.test(readFileSync(f, "utf8")), f).toBe(false);
});

// The two arboretum modules are reached by name from the editor and nowhere else, and only through `import()`: a static import
// would load them (and fetch them) for every visitor, and drag them into any bundle that ever reached the importer.
const ARB = /['"]\.\/arboretum(-api)?(\.js)?['"]/;
test("no module imports an arboretum module statically", () => {
  for (const f of readdirSync(".").filter((f) => /\.(js|mjs)$/.test(f) && !/^arboretum(-api)?(\.test)?\.js$/.test(f))) {
    for (const line of readFileSync(f, "utf8").split("\n"))
      if (/^\s*(import|export)\b/.test(line) && ARB.test(line)) throw new Error(`${f} imports arboretum statically: ${line.trim()}`);
  }
});

test("editor.js reaches arboretum.js by a dynamic import, inside the statement that waits on detect", () => {
  const src = readFileSync("editor.js", "utf8");
  expect(src).toMatch(/detect\([^)]*\)\s*\.then\([^;]*import\(['"]\.\/arboretum\.js['"]\)/s);
  expect([...src.matchAll(/import\(\s*['"]\.\/arboretum/g)].length).toBe(1);
});

test("the gate's target is a module with mount(origin)", async () => {
  expect(typeof (await import("./arboretum.js")).mount).toBe("function");
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
