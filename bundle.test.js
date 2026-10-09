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
  pigment: [".wall_fraction", ".anthocyanin"],   // not ".turn_spread" any more: `dropping` reads it (the length of a leaf's own window, drop_after_turn), and the predicates are in every bundle
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

// ONE TREE AHEAD (§4.5): the grove builds a tree's lead for the arms that read it (the pigment, the exposure and the drop) and its depth for the pigment and the exposure alone, and nothing
// otherwise, so a bundle that cuts them carries neither draw. The markers are the salt the draws are made on (TREE_SALT 0x3C6EF372, in a minified bundle its decimal) and the depth's one
// property read, chosen like the tiers' above: in the bundle with everything, gone from the one with nothing.
const TREE_SALT = "1013904242", TREE_DEPTH = ".tree_pigment_spread";
test("the per-tree draws are carried by a bundle that keeps a tier reading them, and by no other: the homepage set has neither the salt nor the depth table", () => {
  const w = text(whole), h = text(home), p = text(player);
  expect(0x3C6EF372, "the marker is the salt").toBe(Number(TREE_SALT));
  for (const m of [TREE_SALT, TREE_DEPTH]) {
    expect(w.includes(m), `'${m}' is in the all-features bundle`).toBe(true);
    expect(p.includes(m), `'${m}' is in the general player`).toBe(true);
    expect(h.includes(m), `'${m}' is still in the homepage bundle`).toBe(false);
  }
});

test("the lead is drawn for the drop alone, the depth for the pigment and the exposure: a bundle that keeps only abscission has the salt and not the depth", () => {
  const drop = build({ looks: HOME, features: ["drop"], out: join(dir, "drop.js"), quiet: true }), t = text(drop);
  expect(t.includes(TREE_SALT), "the drop days shift by the tree's lead").toBe(true);
  expect(t.includes(TREE_DEPTH), "nothing in it reads the depth").toBe(false);
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

// The BUILD literal itself, read out of the minified text: the name, then its own `cut` array. A bare `"fill"` anywhere in the bundle proves
// nothing — FEATURES' group names, TOPO_KEYS ('litter') and MORPH_KEYS ('exposure') carry three of the six whatever BUILD says.
const buildCut = (src, name) => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`name\\s*:\\s*["']${esc}["']\\s*,\\s*cut\\s*:\\s*\\[([^\\]]*)\\]`).exec(src);
  return m ? [...m[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1]).sort() : null;
};

test("const BUILD says which bundle this is and what it cut — the engine's warning reads it", () => {
  expect(buildCut(text(home), "komorebi.embed.min.js (morning 2, afternoon 5b, morning 3)"), "the homepage bundle's BUILD").toEqual(Object.keys(MARKERS).sort());
  expect(buildCut(text(whole), "komorebi.embed.min.js (morning 2, afternoon 5b, morning 3)"), "--features all cuts nothing").toEqual([]);
  expect(buildCut(text(player), "komorebi.player.min.js (every shipped look)"), "the player keeps every tier").toEqual([]);
});

test("a bundle with fewer tiers is the smaller bundle", () => {
  expect(home.gzip).toBeLessThan(whole.gzip);
});
