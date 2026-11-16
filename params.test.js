// ============================================================================
// The parameter registry (komorebi-params.js, PARAMS): every parameter komorebi has is defined there once, and everything that names
// one reads it from there. What must not slip: a parameter with no meaning, no way to travel or no row and no reason; a panel that names
// a parameter the registry lacks, or leaves out one it has; a row whose range does not hold its own default.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { PARAMS, DEFAULTS, LEGACY_KEYS } from "./komorebi-params.js";

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
