// The looks chosen from the 2026-10-09 proposals sheet, as they ship. presets.js is data and the pixels are the harness's (the smoke render of every look); what is held
// here is what each chosen look IS: the values chosen, that nothing else moved with them, and that none of it went where it was not put (the EXPERIMENTAL list, the beech
// outline). The picks and the words that chose them are in that sheet's review folder.
import { test, expect } from "bun:test";
import { DEFAULTS } from "../komorebi.js";
import { shownExposure } from "../engine/light/komorebi-light.js";
import { EXPERIMENTAL, PLAYLISTS, PRESETS } from "../presets.js";

test("park fall: drop_lag 0.05, under the default 0.09", () => {
  expect(PRESETS["park fall"].drop_lag).toBe(0.05);
  expect(DEFAULTS.drop_lag, "the default is the engine's").toBe(0.09);
  // the rest of the look is what it was
  expect(PRESETS["park fall"].drop_after_turn).toBe(1);
  expect(PRESETS["park fall"].phenology).toBe(0.79);
  expect(PRESETS["park fall"].leaf_drop).toBe(1);
});

// montebello and its rain day share the camera the artist set on the device (2026-11-19); the grove is the one montebello's old view grew.
const CAMERA = ["view_extent_m", "view_pitch_deg", "view_fov_deg", "view_yaw_deg", "view_center_x", "view_center_y"];
const cameraOf = (p) => Object.fromEntries(CAMERA.map((k) => [k, p[k]]));
test("montebello and montebello, rain share one camera, the artist's; P4 was not a pick", () => {
  const m = PRESETS.montebello;
  expect(cameraOf(m)).toEqual({ view_extent_m: 15.490402951510198, view_pitch_deg: 44.598828125000686, view_fov_deg: 60, view_yaw_deg: -156.41528055324432, view_center_x: -0.5394705917682268, view_center_y: -0.2020796336077202 });
  expect(cameraOf(PRESETS["montebello, rain"])).toEqual(cameraOf(m));
  expect(m.grove_reach_m, "the reach its old view grew").toBe(13.489433156286438);
  expect(m.ambient_skylight, "P4: 'not sure i see the difference'").toBe(0.97);
  expect(m.drop_lag, "montebello keeps the default lag: drop_lag 0 is park fall's").toBe(DEFAULTS.drop_lag);
});

// P6, P7 and P8 are montebello with their proposal's overrides; the yellow tree also takes the camera with the feet behind the eye, his k8 over k5 on the picks sheet.
// montebello as these looks were picked from it: before it took the air's loss, its per-tree colour and the cloud coupling, which the three looks
// built on it do not carry.
// It carries the camera the sheet showed (the trunk feet in the frame), and no reach.
const SHEET_MONTEBELLO = { ...PRESETS.montebello, sun_extinction: 0, exposure: 5.566, tree_pigment_spread: 0, tree_clock_spread: 0, cloud_exposure: 0,
  view_extent_m: 13.489433156286438, view_pitch_deg: 61.39999999999994, view_fov_deg: 60, view_yaw_deg: 208.5, view_center_x: -0.7, view_center_y: -3, grove_reach_m: 0,
  leaf_shape: "ellipse" };   // and its leaves were the ellipse: park story's are maple since 2026-11-19

const NEW_LOOKS = {
  "forest floor": { base: PRESETS["afternoon 7"], over: { phenology: 0.8, turn_exposure: 1, anthocyanin: 0.4, tannin: 0.2, wall_fraction: 0.2, leaf_drop: 1, drop_after_turn: 1, drop_lag: 0, litter: 1, leaf_wetness: 0.5, tree_clock_spread: 0.05, tree_pigment_spread: 0.6, leaf_shape: "maple" } },
  "the yellow tree": { base: SHEET_MONTEBELLO, over: { anthocyanin: 0.2, tannin: 0.35, leaf_drop: 0.5, leaf_diffuse: 0, tree_pigment_spread: 0.3, view_center_x: -1.75, view_center_y: -4.93 } },
  "montebello, rain": { base: SHEET_MONTEBELLO, over: { leaf_wetness: 0.75, ground_r: 0.132, ground_g: 0.084, ground_b: 0.048, cloud_thickness: 0.55, halo_angular_radius_deg: 8, sky_turbidity: 0.2, drop_lag: 0, ...cameraOf(PRESETS.montebello), grove_reach_m: 13.489433156286438, leaf_shape: "maple" } },
  "cherry blossom": { base: SHEET_MONTEBELLO, over: { anthocyanin: 0.8, tannin: 0, wall_fraction: 0, leaf_wetness: 0, ground_r: 0.33, ground_g: 0.21, ground_b: 0.12, tree_pigment_spread: 0.6, litter_age: 0.3 } },
};

test("of the four new looks (P5-P8) only the yellow tree and cherry blossom are experimental, out of the walk since 2026-11-17 and 2026-11-19", () => {
  for (const n of Object.keys(NEW_LOOKS)) expect(EXPERIMENTAL.includes(n), `${n}: he likes it more than the tweaks`).toBe(n === "the yellow tree" || n === "cherry blossom");
});

// The list a person walks first is a story, park story: the tree seen and then only its shadow, its year from the turn to the rain day, to
// the forest floor, where it goes on into the next playlist. The floor going abstract, through the afternoons and mornings to the founding
// afternoon, is the second playlist, shadows. The experimental looks are in neither: they are a playlist of their own, the third.
const looksOf = (list) => list.items.map((it) => (typeof it === "string" ? it : it.look));
test("park story, then shadows, rainbow and experiments, each in its order", () => {
  expect(Object.values(PLAYLISTS).map((l) => l.name)).toEqual(["park story", "shadows", "rainbow", "experiments"]);
  expect(looksOf(PLAYLISTS.story)).toEqual([
    "park 1, the scene", "park 1, under the trees", "park1 inside2", "park 1, from above",
    "park fall", "montebello", "montebello, rain",
    "forest floor",
  ]);
  expect(looksOf(PLAYLISTS.shadows)).toEqual([
    "afternoon 7", "afternoon 6", "afternoon 6b", "afternoon 5", "afternoon 5b", "prism", "afternoon 4", "afternoon 4b",
    "morning 1", "morning 2", "morning 3", "morning 3b", "memories", "bluuey", "shrooms", "look up", "projector", "purple eye",
  ]);
  expect(looksOf(PLAYLISTS.rainbow)).toEqual([
    "projector red", "rainbow orange", "projector cherry green", "projector green (first night)", "rainbow green 2", "rainbow spring green",
    "rainbow cyan", "rainbow azure", "rainbow ultraviolet", "projector cherry", "rainbow magenta",
  ]);
  for (const it of PLAYLISTS.rainbow.items) expect([it.dwell_s, it.crossfade_s], `${it.look}: held 1 s, arriving over 6 s`).toEqual([1, 6]);
});

for (const [name, { base, over }] of Object.entries(NEW_LOOKS)) {
  test(`'${name}' is its base look with its proposal's overrides, and not a key more`, () => {
    expect(PRESETS[name], "the look exists").toBeDefined();
    // exposure is re-sat by each look's own cloud (cloud_exposure), so what must match is the exposure it shows
    const shown = (p) => { const q = { ...DEFAULTS, ...p }; const r = { ...q, exposure: Math.round(shownExposure(q) * 1e9) / 1e9 }; delete r.cloud_exposure; return r; };
    expect(shown(PRESETS[name])).toEqual(shown({ ...base, ...over }));
    for (const [k, v] of Object.entries(over)) expect(PRESETS[name][k], `${name}.${k}`).toBe(v);
  });
}

test("no new look names the beech outline: 'the yellow tree' uses the sheet's leaves (the sheet called it 'the beech'; leaf_shape 'beech' is brief 07's), park story's are maple", () => {
  const story = new Set(looksOf(PLAYLISTS.story));
  for (const n of Object.keys(NEW_LOOKS)) expect(PRESETS[n].leaf_shape, n).toBe(story.has(n) ? "maple" : SHEET_MONTEBELLO.leaf_shape);
  for (const n of story) expect(PRESETS[n].leaf_shape, n).toBe("maple");
  expect(PRESETS["the beech"], "the working name moved: it would read as the leaf shape").toBeUndefined();
});

test("P9 'projector maple' is a projector look: a param export on José's side, not a built-in", () => {
  for (const n of ["projector maple", "projector-maple"]) expect(PRESETS[n], n).toBeUndefined();
});
