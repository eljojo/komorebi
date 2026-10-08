// ============================================================================
// What a bundle carries (spec §9, "What a bundle cuts"). embed-build.mjs cuts the fall tiers a page's looks cannot open, and sweeps
// the shader strings nothing reaches; this builds the real bundles (into a temp directory, never dist/) and reads them. A marker is a
// string that exists only in one tier, chosen by measuring the bundle that has everything against the one that has nothing: it must be
// in the first (or the test proves nothing) and not in the second.
// ============================================================================
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "./embed-build.mjs";

const HOME = ["morning 2", "afternoon 5b", "morning 3"];   // the three-look set the homepage loads
const MARKERS = {
  fill: ["uFillRay", ".fill_directions", ".fill_resolution"],
  leafDiffuse: ["texelMix(d.rgb, d.a, uBeamK, T, Tb)", "log1p"],
  pigment: [".turn_spread", ".wall_fraction", ".anthocyanin"],
  exposure: [".exposure_absolute"],
  drop: [".drop_span"],
  litter: ["uLitterMinHalf", ".litter_age", ".litter_drift_m"],
};
let dir, whole, home, player;
const text = (r) => readFileSync(r.out, "utf8");

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "komorebi-bundle-"));
  whole = build({ looks: HOME, features: "all", out: join(dir, "whole.js"), quiet: true });
  home = build({ looks: HOME, out: join(dir, "home.js"), quiet: true });
  player = build({ out: join(dir, "player.js"), quiet: true });
}, 120000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the homepage set opens none of the six, so it drops every one of them", () => {
  expect(home.cut.sort()).toEqual(Object.keys(MARKERS).sort());
});

test("every marker is in a bundle that keeps its tier, and gone from the homepage build", () => {
  const w = text(whole), h = text(home);
  for (const [feature, ms] of Object.entries(MARKERS))
    for (const m of ms) {
      expect(w.includes(m), `${feature}: '${m}' is in the all-features bundle`).toBe(true);
      expect(h.includes(m), `${feature}: '${m}' is still in the homepage bundle`).toBe(false);
    }
});

test("the general player keeps every tier, because montebello ships and opens all six", () => {
  expect(player.cut).toEqual([]);
  const p = text(player);
  for (const [feature, ms] of Object.entries(MARKERS)) for (const m of ms) expect(p.includes(m), `${feature}: '${m}'`).toBe(true);
});

test("the sweep: the sky view's strings are in no floor-only bundle, cut or not (each carries an interpolation a minifier will not drop)", () => {
  for (const r of [whole, home]) for (const m of ["uSkyScatter", "uSrcAngR", "raySegDist"]) expect(text(r).includes(m), m).toBe(false);
  expect(text(player).includes("uSkyScatter")).toBe(false);                    // the shipped looks are all floor looks too
});

test("const BUILD says which bundle this is and what it cut — the engine's warning reads it", () => {
  const h = text(home);
  expect(h.includes("komorebi.embed.min.js (morning 2, afternoon 5b, morning 3)")).toBe(true);
  for (const f of Object.keys(MARKERS)) expect(h.includes(`"${f}"`), f).toBe(true);
  expect(text(whole).includes("komorebi.embed.min.js (morning 2, afternoon 5b, morning 3)")).toBe(true);
  expect(text(player).includes("komorebi.player.min.js")).toBe(true);
});

test("a bundle with fewer tiers is the smaller bundle", () => {
  expect(home.gzip).toBeLessThan(whole.gzip);
});
