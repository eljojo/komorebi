// Guards the camera registry's three halves (spec §4.9/§9). Transport is assembled from a table: CAMERAS says which
// uniform GROUPS a camera speaks, TRANSPORT_GROUPS says what each group declares and what its locations are called,
// and GROUP_UPLOAD (inside create(), enumerated at module level by GROUP_UPLOAD_KEYS) says how each group is filled
// per frame. Those three must name the same things, and the failure when they don't is SILENT: a group a camera
// names but no table defines is a missing declaration; a group that declares uniforms but uploads none leaves them
// at zero; an uploader no camera speaks is dead code that looks alive. None of that throws — it renders, wrongly.
// These tests turn each into a loud `bun test` failure. Run: `bun test registry.test.js`.
//
// (The fourth half — that GROUP_UPLOAD's functions match GROUP_UPLOAD_KEYS — cannot be seen from here, because the
// functions close over engine state. create() checks that pair itself, on construction.)
import { test, expect } from "bun:test";
import { CAMERAS, TRANSPORT_GROUPS, GROUP_UPLOAD_KEYS, TRANSPORT_CAMERAS, buildTransport } from "./komorebi.js";

const ALL_GROUPS = Object.keys(TRANSPORT_GROUPS);
const SPOKEN = new Set(Object.values(CAMERAS).flatMap((c) => c.groups));

test("every group a camera speaks is a group that exists", () => {
  for (const [name, cam] of Object.entries(CAMERAS))
    for (const g of cam.groups)
      expect(`${name}: ${g} in TRANSPORT_GROUPS`).toBe(`${name}: ${ALL_GROUPS.includes(g) ? g : `MISSING(${g})`} in TRANSPORT_GROUPS`);
});

test("every group carrying uniforms also carries an upload — a declared uniform nobody fills reads as zero", () => {
  for (const [g, def] of Object.entries(TRANSPORT_GROUPS)) {
    if (!def.locs) continue;   // a functions-only group (the taps, the fold field, the warp) has nothing to fill
    expect(`${g}: ${GROUP_UPLOAD_KEYS.includes(g)}`).toBe(`${g}: true`);
  }
});

test("no uploader without a group, and no group without a camera — both are dead code that looks alive", () => {
  for (const g of GROUP_UPLOAD_KEYS) expect(`upload ${g}: ${ALL_GROUPS.includes(g)}`).toBe(`upload ${g}: true`);
  for (const g of ALL_GROUPS) expect(`group ${g} spoken: ${SPOKEN.has(g)}`).toBe(`group ${g} spoken: true`);
});

test("a functions-only group uploads nothing — the taps and the fold field declare no uniforms of their own", () => {
  for (const g of GROUP_UPLOAD_KEYS) expect(`${g} has locs: ${!!TRANSPORT_GROUPS[g].locs}`).toBe(`${g} has locs: true`);
});

// Every entry has to be complete enough to assemble, and every camera has to be one of the four the selection
// function can return — a camera in the table that nothing selects would never be compiled and never be caught.
test("every camera entry assembles into a whole program", () => {
  expect(TRANSPORT_CAMERAS).toEqual(Object.keys(CAMERAS));
  for (const [name, cam] of Object.entries(CAMERAS)) {
    expect(typeof cam.prologue).toBe("string");
    expect(typeof cam.camera).toBe("string");
    expect(Array.isArray(cam.material) && cam.material.length > 0).toBe(true);
    expect(Array.isArray(cam.params)).toBe(true);          // documentation-grade, but it must be there to be read
    const src = buildTransport(name);
    expect(src.startsWith("#version 300 es")).toBe(true);
    expect(src.includes("void main(){")).toBe(true);
    expect(src.includes("${")).toBe(false);                 // every interpolation resolved at module load
  }
});

test("an unknown camera is refused rather than silently assembled empty", () => {
  expect(() => buildTransport("periscope")).toThrow();
});
