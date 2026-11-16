// ============================================================================
// The parameter registry (komorebi-params.js, PARAMS): every parameter komorebi has is defined there once, and everything that names
// one reads it from there. What must not slip: a parameter with no meaning, no way to travel or no row and no reason; a panel that names
// a parameter the registry lacks, or leaves out one it has; a row whose range does not hold its own default.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { PARAMS, DEFAULTS, LEGACY_KEYS } from "./komorebi-params.js";
import { GROVE_READS } from "./komorebi-grove.js";

const WAYS = ["morph", "canopy", "season", "topo", "mode", "none"];
const KINDS = ["s", "t", "sel", "sels"];

test("every parameter says what it does, how it travels, and has a default or is an editor input", () => {
  for (const [k, d] of Object.entries(PARAMS)) {
    expect(typeof d.means === "string" && d.means.startsWith("<b>") && d.means.length > 30, `${k}: means`).toBe(true);
    expect(WAYS, `${k}: travels`).toContain(d.travels);
    expect(("default" in d) !== ("input" in d), `${k}: a default or an input, not both`).toBe(true);
    if ("input" in d) expect(d.travels, `${k}: an input is not in a look, so it does not travel`).toBe("none");
  }
});

test("every parameter has a row in the panel or says why it has none", () => {
  for (const [k, d] of Object.entries(PARAMS)) {
    expect(!!d.row !== !!d.noRow, `${k}: a row or a noRow reason, not both`).toBe(true);
    if (!d.row) continue;
    expect(KINDS, `${k}: row kind`).toContain(d.row.kind);
    expect(typeof d.row.label === "string" && d.row.label.length > 0, `${k}: label`).toBe(true);
    expect(typeof d.row.rebuild, `${k}: rebuild scope`).toBe("string");
    if (d.row.kind === "s") {
      expect(d.row.max, `${k}: range`).toBeGreaterThan(d.row.min);
      expect(d.row.step, `${k}: step`).toBeGreaterThan(0);
      if ("default" in d) expect(d.default >= d.row.min && d.default <= d.row.max, `${k}: default ${d.default} inside ${d.row.min}..${d.row.max}`).toBe(true);
    }
    if (d.row.kind === "sel" || d.row.kind === "sels") {
      expect(Array.isArray(d.row.choices) && d.row.choices.length > 1, `${k}: choices`).toBe(true);
      if ("default" in d) expect(d.row.choices.some(([, v]) => v === d.default), `${k}: default ${d.default} among its choices`).toBe(true);
    }
    if (d.row.kind === "t" && "default" in d) expect(typeof d.default, `${k}: a toggle's default`).toBe("boolean");
  }
});

test("the editor's panel names every parameter that has a row, once, and nothing else", () => {
  const src = readFileSync(new URL("./editor.js", import.meta.url), "utf8");
  const at = src.indexOf("const PANEL_LAYOUT = [");
  const named = [...src.slice(at, src.indexOf("\n];", at)).matchAll(/^ {2}'([a-z_0-9]+)',/gm)].map((m) => m[1]);
  const withRow = Object.keys(PARAMS).filter((k) => PARAMS[k].row);
  expect(named.filter((k) => !PARAMS[k]?.row), "named but no row in PARAMS").toEqual([]);
  expect(withRow.filter((k) => !named.includes(k)), "a row in PARAMS, but not in the panel").toEqual([]);
  expect(named.filter((k, i) => named.indexOf(k) !== i), "named twice").toEqual([]);
});

test("DEFAULTS is every parameter but the editor's inputs, in the registry's order; an old name is not a parameter", () => {
  expect(Object.keys(DEFAULTS)).toEqual(Object.keys(PARAMS).filter((k) => !("input" in PARAMS[k])));
  for (const [old, now] of Object.entries(LEGACY_KEYS)) { expect(old in PARAMS, old).toBe(false); expect(now in DEFAULTS, now).toBe(true); }
});

// Which cast the engine runs (the faithful cast or the depth layers) is one predicate over the scene modes. A panel row that flips it
// has to rebuild what that choice allocates and packs: the layer textures are 1×1 while the faithful cast runs, and the grove's
// buffers are packed for one cast or the other. A row that asked for less would leave the new cast reading the old one's buffers.
test("every row the cast's choice reads asks for the scope that rebuilds its textures and its grove", () => {
  const src = readFileSync(new URL("./komorebi-engine.js", import.meta.url), "utf8");
  const predicate = src.match(/const faithfulOn = \(\) => ([^;]+);/);
  expect(predicate, "komorebi-engine.js defines faithfulOn in one line").toBeTruthy();
  const keys = [...predicate[1].matchAll(/params\.([a-z_0-9]+)/g)].map((m) => m[1]);
  expect(keys.sort()).toEqual(["faithful_canopy", "receiver", "sky_view"]);
  for (const k of keys) expect(PARAMS[k].row.rebuild, k).toBe("textures");
});

// A row's scope is what the editor rebuilds when its slider moves. Growing the grove is the dearest of them (tens of milliseconds on a
// full look, on every tick of a drag), so a row asks for it exactly when the grove's build reads its key: GROVE_READS, which
// reseason.test.js holds to the build's own source. Asking for it otherwise regrows for nothing; not asking when the build reads the key
// shows a stale grove. The exceptions are named, with what stands in for the regrow.
test("a row asks for a regrow when the grove's build reads its key, and only then", () => {
  const REGROWS = ["canopy", "density", "textures"];
  const SIZES_TEXTURES = ["tex_resolution", "bake_resolution"];   // a choice, not a drag: the scope that reallocates the textures regrows too, and none reallocates alone
  const WITHOUT_A_REGROW = {
    trunk_radius_m: "bake",        // the build reads these three for the wood alone, and refreshWood re-reads them from the grown skeleton:
    canopy_base_height_m: "",      // the radius at the bake its row asks for, the heights with the frame
    canopy_thickness_m: "",
    view_extent_m: "",             // sizes an overhead park's crowns, and a zoom does not regrow them: measured, still open (spec/evidence/measurements.md, the midpoint grove)
  };
  for (const [k, d] of Object.entries(PARAMS)) {
    if (!d.row) continue;
    const reads = GROVE_READS.includes(k), asks = REGROWS.includes(d.row.rebuild);
    if (k in WITHOUT_A_REGROW) { expect(reads, `${k}: listed as read by the build`).toBe(true); expect(d.row.rebuild, k).toBe(WITHOUT_A_REGROW[k]); continue; }
    if (SIZES_TEXTURES.includes(k)) { expect(d.row.rebuild, k).toBe("textures"); continue; }
    expect(asks, `${k}: the build ${reads ? "reads it" : "does not read it"}, and its row asks for '${d.row.rebuild}'`).toBe(reads);
  }
});
