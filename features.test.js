// ============================================================================
// The feature registry (spec §9, "What a bundle cuts"). The fall tiers (the sky fill, the leaf's diffuse share, the autumn pigment,
// the exposure pass, abscission, the litter carpet) are cut from a bundle by a registry derived per look, as the camera is
// (cameraFor): FEATURES says what opens each one, featuresFor(P) reads a look, embed-build.mjs cuts what no kept look opens.
// Every way this breaks is silent in a bundle (a tier that is cut but needed paints a different tree and throws nothing), so it is
// held here without a GPU: the predicates at their boundaries, the one dependency that is not obvious (the drop consumes the
// exposure rank), the shader tags that make the cut, and — the test that fails if a predicate is wrong — a grove built with exactly
// the features a look does NOT open cut out, which must upload the bytes the whole grove uploads.
// ============================================================================
import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULTS, FEATURES, TRANSPORT_CAMERAS, buildTransport, cutWarnings, featuresFor } from "./komorebi.js";
import { DROP_EPS, dropping, lit, ordered, senescing } from "./komorebi-math.js";
import { makeGrove } from "./komorebi-grove.js";
import { EXPERIMENTAL, PRESETS } from "./presets.js";
import { assemble, dropTagged, templateLiterals, writeTree } from "./embed-build.mjs";

const ROOT = import.meta.dir;
const P = (over = {}) => ({ ...DEFAULTS, ...over });
const open = (over) => [...featuresFor(P(over))].sort();
const ALL = Object.keys(FEATURES);
const merged = (look, over = {}) => ({ ...DEFAULTS, ...PRESETS[look], ...over });

// ---- 1. the predicates, at their edges ---------------------------------------------------------------------------------
test("senescing is strictly past turn_start, dropping strictly past drop_start - DROP_EPS", () => {
  const p = P();
  expect(senescing({ ...p, phenology: p.turn_start })).toBe(false);          // the first leaf's turn begins AT turn_start: nothing has changed yet
  expect(senescing({ ...p, phenology: p.turn_start + 1e-9 })).toBe(true);
  const d = { ...p, leaf_drop: 1 };
  expect(dropping({ ...d, phenology: d.drop_start - DROP_EPS })).toBe(false); // the fade of the earliest leaf begins here, w is still 1
  expect(dropping({ ...d, phenology: d.drop_start - DROP_EPS + 1e-9 })).toBe(true);
  expect(dropping({ ...d, leaf_drop: 0, phenology: 1 })).toBe(false);        // leaf_drop 0: nothing ever drops, whatever the season
});

test("lit needs a turn AND turn_exposure; ordered is lit, or a drop that follows the light", () => {
  const p = P({ phenology: 0.8 });
  expect(lit({ ...p, turn_exposure: 0 })).toBe(false);
  expect(lit({ ...p, turn_exposure: 0.2 })).toBe(true);
  expect(lit({ ...p, turn_exposure: 1, phenology: p.turn_start })).toBe(false);
  expect(ordered({ ...p, turn_exposure: 0.2 })).toBe(true);
});

// ---- 2. one-key probes over DEFAULTS ------------------------------------------------------------------------------------
test("each table key opens its feature, and a feature that needs a season does not open without one", () => {
  expect(open({})).toEqual([]);                                              // the defaults are a summer with nothing special in it
  expect(open({ canopy_fill: 0.5 })).toEqual(["fill"]);
  expect(open({ leaf_diffuse: 0.3 })).toEqual(["leafDiffuse"]);
  expect(open({ phenology: 0.65 })).toEqual(["pigment"]);
  expect(open({ litter: 1 })).toEqual([]);                                   // a carpet needs a leaf that has fallen
  expect(open({ turn_exposure: 1 })).toEqual([]);                            // and light orders nothing in a summer
  expect(open({ leaf_drop: 1 })).toEqual([]);                                // abscission needs its season too
  expect(open({ phenology: 0.65, turn_exposure: 1 })).toEqual(["exposure", "pigment"]);
  const autumn = { phenology: 0.75, turn_start: 0.9, leaf_drop: 1 };         // dropping, and not turning: the drop alone
  expect(open({ ...autumn, drop_exposure: 0 })).toEqual(["drop"]);
  expect(open({ ...autumn, drop_exposure: 0, litter: 1 })).toEqual(["drop", "litter"]);
});

// ---- 3. the dependency ---------------------------------------------------------------------------------------------------
test("the drop consumes the exposure rank even at turn_exposure 0 — and not at drop_exposure 0", () => {
  const B = { phenology: 0.9, leaf_drop: 1, turn_exposure: 0 };              // drop_exposure is 1 by default
  expect(DEFAULTS.drop_exposure).toBe(1);
  expect(open(B)).toContain("exposure");
  expect(open({ ...B, drop_exposure: 0 })).not.toContain("exposure");
  expect(open({ ...B, drop_exposure: 0 })).toEqual(["drop", "pigment"]);
});

// ---- 4. the shipped looks ------------------------------------------------------------------------------------------------
test("montebello opens all six; the summer looks open none (nothing is asserted about the other looks: presets.js is live)", () => {
  expect(open(PRESETS.montebello)).toEqual([...ALL].sort());
  for (const look of ["morning 2", "afternoon 5b", "morning 3"]) expect(open(PRESETS[look]), look).toEqual([]);
});

// ---- 5. the tags -----------------------------------------------------------------------------------------------------------
const SOURCES = readdirSync(ROOT).filter((f) => /^komorebi.*\.js$/.test(f));
const subsets = (xs) => xs.reduce((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
const delta = (s) => (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;

test("every @feature tag ends its comment, and names only features the registry knows", () => {
  let tags = 0;
  for (const f of SOURCES) {
    for (const line of readFileSync(join(ROOT, f), "utf8").split("\n")) {
      if (!line.includes("@feature")) continue;
      tags++;
      const m = line.match(/@feature((?:\s+[A-Za-z]+)+)\s*(?:`;?)?$/);   // a literal may close on the tagged line itself
      expect(m, `${f}: tag does not end the comment: ${line.trim()}`).not.toBeNull();
      for (const name of m[1].trim().split(/\s+/)) expect(ALL.includes(name), `${f}: unknown feature '${name}'`).toBe(true);
    }
  }
  expect(tags).toBeGreaterThan(20);                                          // the tags exist: this is not vacuously true on an untagged tree
});

test("dropping the tagged lines of any subset of {fill, leafDiffuse, litter} leaves every literal as balanced as it was", () => {
  for (const file of ["komorebi-transport.js", "komorebi-shaders.js"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    const raw = templateLiterals(src).map(([a, b]) => delta(src.slice(a, b)));
    for (const cut of subsets(["fill", "leafDiffuse", "litter"])) {
      const out = dropTagged(src, cut);
      const got = templateLiterals(out).map(([a, b]) => delta(out.slice(a, b)));
      expect(got, `${file} without ${cut.join(", ") || "nothing"}`).toEqual(raw);
    }
  }
});

const treeIn = (opts) => {
  const dir = mkdtempSync(join(tmpdir(), "komorebi-feat-"));
  writeTree(assemble(opts).files, dir);
  return dir;
};
const UNIFORMS = {
  fill: ["uCanopyFill", "uFillT", "uFillS", "uFillOrigin", "uFillExtent"],
  litter: ["uLitterOn", "uLitter", "uLitterOrigin", "uLitterExtent"],
  leafDiffuse: ["uBeamK"],
};

test("a program assembled with a feature cut names no uniform of that feature's group — on all four cameras", async () => {
  const looks = [...EXPERIMENTAL, "park 1"];                                  // every camera the repo has a look for
  for (const cut of subsets(["fill", "leafDiffuse", "litter"])) {
    const keep = ALL.filter((f) => !cut.includes(f));
    const dir = treeIn({ looks, features: keep, strip: false });
    try {
      const T = await import(`${pathToFileURL(join(dir, "komorebi-transport.js")).href}?${cut.join("-")}`);
      expect(T.TRANSPORT_CAMERAS.length).toBe(4);
      for (const cam of T.TRANSPORT_CAMERAS) {
        const src = T.buildTransport(cam);
        expect(delta(src), `${cam} braces without ${cut}`).toBe(0);
        for (const f of cut) {
          if (f === "leafDiffuse" && cam === "sky") continue;                // the sky view's group declares and reads its own uBeamK (a camera of its own, not the tap)
          for (const u of UNIFORMS[f]) expect(new RegExp(`\\b${u}\\b`).test(src), `${cam} still names ${u} with ${f} cut`).toBe(false);
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}, 120000);

test("with nothing cut, buildTransport is the program the repo builds, character for character", async () => {
  const dir = treeIn({ looks: [...EXPERIMENTAL, "park 1"], features: "all", strip: false });
  try {
    const T = await import(`${pathToFileURL(join(dir, "komorebi-transport.js")).href}?whole`);
    for (const cam of TRANSPORT_CAMERAS) expect(T.buildTransport(cam), cam).toBe(buildTransport(cam));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- 6. the registry-closed grove ------------------------------------------------------------------------------------------
// A grove built with exactly the features a look does NOT open cut out must upload what the whole grove uploads. The reference is the
// repo's grove with every tier on AND the exposure gate held open (ordered -> true), so it does not trust the predicate it is
// checking: if `ordered` forgets that the drop consumes the rank, the cut grove drops its leaves by a phase the reference does not.
function rig(makeG, params) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => false, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeG(hub).buildGrove(null);
  return { layers: g.layerVAO.map((l) => Array.from(l.buf.data)), faith: Array.from(faith.buf.data), leafW: g.hier.leafW ? Array.from(g.hier.leafW) : null };
}
const small = { tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, seed: 7 };
const B = { phenology: 0.9, leaf_drop: 1 };
const PROBES = {
  "pigment": { phenology: 0.75 },
  "pigment + exposure": { phenology: 0.75, turn_exposure: 1 },
  "drop at turn_exposure 0, drop_exposure 1": { ...B, turn_exposure: 0 },
  "drop at turn_exposure 0, drop_exposure 0": { ...B, turn_exposure: 0, drop_exposure: 0 },
  "drop, litter 1": { ...B, turn_exposure: 0, litter: 1 },
  "drop, litter 0 (the compaction counts the leaves that went, not the carpet)": { ...B, litter: 0 },
  "marcescent": { phenology: 0.95, leaf_drop: 0.5, turn_exposure: 0.5 },
};

async function treeOf(dir, mutate) {
  const pre = assemble({ looks: ["park 1"], features: "all", strip: false });
  const files = { ...pre.files };
  if (mutate) mutate(files);
  writeTree(files, dir);
}
const grove = async (dir, tag) => (await import(`${pathToFileURL(join(dir, "komorebi-grove.js")).href}?${tag}`)).makeGrove;

test("a grove with the features its look does not open cut uploads the bytes the whole grove uploads", async () => {
  for (const [name, over] of Object.entries(PROBES)) {
    const params = P({ ...small, ...over });
    const keep = featuresFor(params);
    const dirRef = mkdtempSync(join(tmpdir(), "komorebi-ref-")), dirCut = mkdtempSync(join(tmpdir(), "komorebi-cut-"));
    try {
      await treeOf(dirRef, (f) => {
        const m = f["komorebi-math.js"], n = m.replace(/const ordered = [^\n]*\n/, "const ordered = () => true;\n");
        expect(n, "math.js declares ordered on one line").not.toBe(m);
        f["komorebi-math.js"] = n;
      });
      writeTree(assemble({ looks: ["park 1"], features: keep, strip: false }).files, dirCut);
      const whole = rig(makeGrove, params);
      const ref = rig(await grove(dirRef, `ref-${name}`), params);
      const cut = rig(await grove(dirCut, `cut-${name}`), params);
      expect(ref, `${name}: the reference is the repo's grove`).toEqual(whole);
      expect(cut, `${name}: cut ${ALL.filter((f) => !keep.includes(f)).join(", ")}`).toEqual(ref);
    } finally { rmSync(dirRef, { recursive: true, force: true }); rmSync(dirCut, { recursive: true, force: true }); }
  }
}, 120000);

// ---- the twelve combination builds (the brief's table): rows 1-10 are exactly what the registry says of their params ----------
const ROWS = [
  [1, "none", {}], [2, "fill", { canopy_fill: 1 }], [3, "leafDiffuse", { leaf_diffuse: 0.5 }], [4, "fill,leafDiffuse", { canopy_fill: 1, leaf_diffuse: 0.5 }],
  [5, "pigment", { phenology: 0.9 }], [6, "pigment,exposure,drop", { ...B, turn_exposure: 1 }], [7, "pigment,drop", { ...B, drop_exposure: 0 }],
  [8, "pigment,exposure,drop,litter", { ...B, turn_exposure: 1, litter: 1 }], [9, "leafDiffuse,pigment,exposure,drop,litter", { ...B, litter: 1, leaf_diffuse: 0.5 }],
  [10, "fill,pigment,exposure,drop", { ...B, canopy_fill: 1 }],
];
test("rows 1-10 of the combination table are exactly featuresFor of their merged params, on every look they are run over", () => {
  for (const [row, set, over] of ROWS) {
    const want = set === "none" ? [] : set.split(",");
    for (const look of ["memories", "park 1", "afternoon 7"]) expect([...featuresFor(merged(look, over))].sort(), `row ${row} on ${look}`).toEqual(want.sort());
  }
  // row 11 cuts what its params open (the drop consumes the rank), and row 12 cuts the fill that its params open: both must fail in pixels
  expect(featuresFor(merged("memories", B))).toContain("exposure");
  expect(featuresFor(merged("morning 2", { canopy_fill: 1 }))).toContain("fill");
});

// ---- 7. the warning -------------------------------------------------------------------------------------------------------
test("cutWarnings names the feature and the build, once per feature, and says nothing about a feature that is closed or kept", () => {
  const build = { name: "komorebi.embed.min.js (morning 2)", cut: ["fill", "litter"] };
  const warned = new Set();
  const w = cutWarnings(P({ canopy_fill: 1 }), build, warned);
  expect(w).toEqual(["komorebi: fill is not in komorebi.embed.min.js (morning 2), so it stays off; build a bundle with the look that uses it (nix run .#embed -- '<look>'…)"]);
  expect(cutWarnings(P({ canopy_fill: 1 }), build, warned)).toEqual([]);      // once per feature
  expect(cutWarnings(P({ phenology: 0.9, leaf_drop: 1, litter: 1 }), build, warned).map((m) => m.split(" ")[1])).toEqual(["litter"]);
  expect(cutWarnings(P({ leaf_diffuse: 0.5 }), build, new Set())).toEqual([]);   // open, but this build kept it
  expect(cutWarnings(P({}), build, new Set())).toEqual([]);                     // not open at all
  expect(cutWarnings(P({ canopy_fill: 1, phenology: 0.9, leaf_drop: 1, litter: 1 }), { name: "modules", cut: [] }, new Set())).toEqual([]);   // the raw modules cut nothing, and cost nothing
});
