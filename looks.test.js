// José's picks from the 2026-10-09 proposals sheet, as the looks that ship. presets.js is data and the pixels are the harness's (the smoke render of every look); what is held here is
// what each pick IS: the values he picked, that nothing he did not pick moved with them, and that none of it went where he did not put it (the EXPERIMENTAL list, the beech outline).
// His words: "i like p1 and p3 (make it without the wind drift), p4 was good too. i like p5, p6, p7, p8, and p9; > more than p1 and p3 and p4.", and on the picks as they
// would ship: "i like k3,k4,k6,k8" (P4: "not sure i see the difference").
import { test, expect } from "bun:test";
import { DEFAULTS } from "./komorebi.js";
import { EXPERIMENTAL, PRESETS } from "./presets.js";

test("park fall: drop_lag 0 (P1) — a leaf lets go the moment its turn ends, and the carpet he picked as pd3 comes back", () => {
  expect(PRESETS["park fall"].drop_lag).toBe(0);
  expect(DEFAULTS.drop_lag, "the default stays: it is this look's, not the engine's").toBe(0.05);
  // the rest of the look is what it was
  expect(PRESETS["park fall"].drop_after_turn).toBe(1);
  expect(PRESETS["park fall"].phenology).toBe(0.79);
  expect(PRESETS["park fall"].leaf_drop).toBe(1);
});

test("montebello keeps its camera: P3 without the drift (k1) left no carpet in frame and was not picked, P4 was not a pick", () => {
  const m = PRESETS.montebello;
  expect([m.view_center_x, m.view_center_y], "his k1 was not among 'i like k3,k4,k6,k8'").toEqual([-0.7, -3]);
  expect(m.ambient_skylight, "P4: 'not sure i see the difference'").toBe(0.97);
  expect(m.drop_lag, "montebello keeps the default lag: drop_lag 0 is park fall's").toBe(DEFAULTS.drop_lag);
});

// P6, P7 and P8 are montebello with their proposal's overrides; the yellow tree also takes the camera with the feet behind the eye, his k8 over k5 on the picks sheet.
const SHEET_MONTEBELLO = PRESETS.montebello;

const NEW_LOOKS = {
  "forest floor": { base: PRESETS["afternoon 7"], over: { phenology: 0.8, turn_exposure: 1, anthocyanin: 0.4, tannin: 0.2, wall_fraction: 0.2, leaf_drop: 1, drop_after_turn: 1, drop_lag: 0, litter: 1, leaf_wetness: 0.5, tree_clock_spread: 0.05, tree_pigment_spread: 0.6 } },
  "the yellow tree": { base: SHEET_MONTEBELLO, over: { anthocyanin: 0.2, tannin: 0.35, leaf_drop: 0.5, leaf_diffuse: 0, tree_pigment_spread: 0.3, view_center_x: -1.75, view_center_y: -4.93 } },
  "montebello, rain": { base: SHEET_MONTEBELLO, over: { leaf_wetness: 0.75, ground_r: 0.132, ground_g: 0.084, ground_b: 0.048, cloud_thickness: 0.55, halo_angular_radius_deg: 8, sky_turbidity: 0.2, drop_lag: 0 } },
  "cherry blossom": { base: SHEET_MONTEBELLO, over: { anthocyanin: 0.8, tannin: 0, wall_fraction: 0, leaf_wetness: 0, ground_r: 0.33, ground_g: 0.21, ground_b: 0.12, tree_pigment_spread: 0.6, litter_age: 0.3 } },
};

test("the four new looks (P5-P8) follow park fall, in the sheet's order, and none is experimental", () => {
  const names = Object.keys(PRESETS);
  expect(names.slice(names.indexOf("park fall") + 1, names.indexOf("park fall") + 5)).toEqual(Object.keys(NEW_LOOKS));
  for (const n of Object.keys(NEW_LOOKS)) expect(EXPERIMENTAL.includes(n), `${n}: he likes it more than the tweaks`).toBe(false);
});

for (const [name, { base, over }] of Object.entries(NEW_LOOKS)) {
  test(`'${name}' is its base look with its proposal's overrides, and not a key more`, () => {
    expect(PRESETS[name], "the look exists").toBeDefined();
    expect(PRESETS[name]).toEqual({ ...DEFAULTS, ...base, ...over });
    for (const [k, v] of Object.entries(over)) expect(PRESETS[name][k], `${name}.${k}`).toBe(v);
  });
}

test("no new look names the beech outline: 'the yellow tree' uses montebello's leaves (the sheet called it 'the beech'; leaf_shape 'beech' is brief 07's)", () => {
  for (const n of Object.keys(NEW_LOOKS)) expect(PRESETS[n].leaf_shape, n).toBe(DEFAULTS.leaf_shape);
  expect(PRESETS["the yellow tree"].leaf_shape).toBe(PRESETS.montebello.leaf_shape);
  expect(PRESETS["the beech"], "the working name moved: it would read as the leaf shape").toBeUndefined();
});

test("P9 'projector maple' is a projector look: a param export on José's side, not a built-in", () => {
  for (const n of ["projector maple", "projector-maple"]) expect(PRESETS[n], n).toBeUndefined();
});
