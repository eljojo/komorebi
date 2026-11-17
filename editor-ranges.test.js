// Every shipped look can be saved in arboretum. Arboretum holds a saved look to the editor's slider ranges, each stretched by a quarter
// of its span at both ends (arboretum/src/validate.ts, RANGE_LEEWAY), angles exempt because they wrap; the ranges are the
// sliders' rows in PARAMS (komorebi-params.js), which the editor builds its panel from and arboretum/scripts/engine.mjs reads. A look whose value lands past that stretch is refused on save, so a look change that moves a value
// (a re-sit of exposure, say) has to move the slider with it.
import { test, expect } from "bun:test";
import { PRESETS } from "./presets.js";
import { PARAMS } from "./komorebi-params.js";

const LEEWAY = 0.25;
const CLUSTERS_PER_LAYER_MAX = 82;   // arboretum's own bound: clusters_per_layer has no slider

// The sliders' rows: { key, min, max, step } for every parameter whose row is a slider.
export const sliderRows = () => Object.entries(PARAMS).filter(([, d]) => d.row?.kind === "s").map(([key, d]) => ({ key, min: d.row.min, max: d.row.max, step: d.row.step }));

// Arboretum's bounds for one slider, leeway included, as validate.ts's boundsOf computes them; undefined for an angle.
export function boundsOf(row) {
  const isAngle = row.key.endsWith("_deg") && ((row.min === -180 && row.max === 180) || (row.min === 0 && row.max === 360));
  if (isAngle) return undefined;
  const tidy = (n) => Number(n.toPrecision(12));
  const stretch = (row.max - row.min) * LEEWAY;
  let lo = tidy(row.min - stretch), hi = tidy(row.max + stretch);
  if (row.min >= 0) lo = Math.max(0, lo);
  if (row.step === 1) { lo = Math.ceil(lo); hi = Math.floor(hi); }
  return { lo, hi };
}

// What arboretum would refuse in a look: the keys past their bounds, with the value and the bounds.
export function outOfRange(look, rows) {
  const out = [];
  for (const row of rows) {
    const v = look[row.key], b = boundsOf(row);
    if (typeof v !== "number" || !b) continue;
    if (v < b.lo || v > b.hi) out.push(`${row.key} ${v} outside ${b.lo}..${b.hi}`);
  }
  if (typeof look.clusters_per_layer === "number" && look.clusters_per_layer > CLUSTERS_PER_LAYER_MAX) out.push(`clusters_per_layer ${look.clusters_per_layer} over ${CLUSTERS_PER_LAYER_MAX}`);
  return out;
}

const ROWS = sliderRows();

test("the sliders' rows: exposure among them, every range ordered", () => {
  expect(ROWS.length).toBeGreaterThan(100);
  expect(ROWS.find((r) => r.key === "exposure")).toBeDefined();
  for (const r of ROWS) expect(r.max, r.key).toBeGreaterThan(r.min);
});

test("every shipped look lies within the editor's sliders as arboretum stretches them, so each can be saved there", () => {
  for (const [name, look] of Object.entries(PRESETS)) expect(outOfRange(look, ROWS), name).toEqual([]);
});
