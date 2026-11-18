// The route registry (komorebi-routes.js): every long route is one entry of one shape, or, in a bundle that cut it, a stub with
// its name and an end that does nothing. Run: `bun test routes.test.js`.
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assemble, writeTree } from "../embed-build.mjs";
import { cutRoute, restTrans } from "../engine/transitions/komorebi-routes.js";

const MODULES = { sceneFade: ["engine/transitions/komorebi-scene-fade.js", "makeSceneFade"], leafTravel: ["engine/transitions/komorebi-leaf-travel.js", "makeLeafTravel"],
  seasonTravel: ["engine/transitions/komorebi-season-travel.js", "makeSeasonTravel"], litterRise: ["engine/transitions/komorebi-litter-rise.js", "makeLitterRise"],
  groveTravel: ["engine/transitions/komorebi-grove-travel.js", "makeGroveTravel"] };
const POLICY = ["ownsWind", "hostBakes", "tweens", "keepsDrift", "groundPeak", "swaps"];
const LANDING = ["regenSource", "resetPerf", "bake", "resumeAdaptive"];   // the hub's coordinators a landing may run

// Each module's entry over a hub with no GPU: building one prepares nothing.
async function entries(dir) {
  const out = {};
  for (const [name, [file, factory]] of Object.entries(MODULES)) {
    const hub = { gl: {}, canvas: {}, params: {}, trans: restTrans(), faith: {} };
    out[name] = (await import(pathToFileURL(join(dir, file)).href))[factory](hub);
  }
  return out;
}
function expectFull(name, e) {
  expect(e.name).toBe(name);
  for (const k of ["begin", "step", "draw", "end"]) expect(typeof e[k], `${name}.${k}`).toBe("function");
  for (const k of ["retarget", "finish"]) if (k in e) expect(typeof e[k], `${name}.${k}`).toBe("function");
  for (const k of POLICY) if (k in e) expect(typeof e[k], `${name}.${k}`).toBe("boolean");
  expect(Array.isArray(e.landing), `${name}.landing`).toBe(true);
  for (const k of e.landing) expect(LANDING, `${name}.landing`).toContain(k);
  const known = new Set(["name", "begin", "retarget", "step", "draw", "finish", "end", "landing", ...POLICY]);
  expect(Object.keys(e).filter((k) => !known.has(k)), `${name}: nothing outside the shape`).toEqual([]);
  expect(e.end(), `${name}: end is safe while idle`).toBeUndefined();
}
function expectCut(name, e) {
  expect(Object.keys(e).sort()).toEqual(["end", "name"]);
  expect(e.name).toBe(name);
  expect(e.end()).toBeUndefined();
}

test("every route is one entry of the registry's shape, named for itself", async () => {
  const live = await entries(join(import.meta.dir, ".."));
  expect(Object.keys(live)).toEqual(Object.keys(MODULES));
  for (const [name, e] of Object.entries(live)) expectFull(name, e);
  expect(cutRoute("sceneFade")).toEqual({ name: "sceneFade", end: expect.any(Function) });
});

test("a bundle that cuts a route keeps its entry as a stub: its name and an end that does nothing", async () => {
  // morning 2 opens neither the litter nor the drop nor the flight camera: the season, grove and litter routes are cut.
  const dir = mkdtempSync(join(tmpdir(), "komorebi-routes-"));
  try {
    writeTree(assemble({ looks: ["morning 2"], strip: false }).files, dir);
    const cut = await entries(dir);
    for (const name of ["seasonTravel", "litterRise", "groveTravel"]) expectCut(name, cut[name]);
    for (const name of ["sceneFade", "leafTravel"]) expectFull(name, cut[name]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
