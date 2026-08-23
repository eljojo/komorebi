// Guards the one promise a rename makes to data the engine doesn't own (spec §9): a ★ look in local storage, or a
// JSON exported years ago, keeps loading forever. LEGACY_KEYS + migrateLegacy are the whole mechanism, applied at
// every door external params come through — create(), setParams, transitionTo, and the editor's preset store — so
// these tests cover the pure map and the store; the engine doors need a GL context and are exercised by test-gl.
// Run: `bun test legacy-keys.test.js`.
import { test, expect } from "bun:test";
import { DEFAULTS, LEGACY_KEYS, migrateLegacy } from "./komorebi.js";
import { getPreset, setStored } from "./presets-store.js";

test("the map points retired names at knobs that actually exist", () => {
  for (const [old, now] of Object.entries(LEGACY_KEYS)) {
    expect(old in DEFAULTS).toBe(false);   // a retired name must not also be a live knob
    expect(now in DEFAULTS).toBe(true);    // ...and its target must be one (catches a typo'd rename)
  }
});

test("the fabric-family rename is covered end to end", () => {
  expect(LEGACY_KEYS).toEqual({
    curtain_tt: "fabric_tt",
    curtain_tint_r: "fabric_tint_r", curtain_tint_g: "fabric_tint_g", curtain_tint_b: "fabric_tint_b",
    curtain_scatter: "fabric_scatter",
    curtain_diffuse: "glow_bleed", curtain_diffuse_m: "glow_bleed_m",
    curtain_distance_m: "cloth_distance_m",
  });
});

test("an old-key look comes out carrying the new keys, same values", () => {
  const saved = {
    exposure: 1.3, receiver: 1,
    curtain_tt: 0.78, curtain_tint_r: 0.45, curtain_tint_g: 1, curtain_tint_b: 0.28,
    curtain_scatter: 0.42, curtain_diffuse: 0.74, curtain_diffuse_m: 0.035, curtain_distance_m: 0.6,
  };
  expect(migrateLegacy(saved)).toEqual({
    exposure: 1.3, receiver: 1,
    fabric_tt: 0.78, fabric_tint_r: 0.45, fabric_tint_g: 1, fabric_tint_b: 0.28,
    fabric_scatter: 0.42, glow_bleed: 0.74, glow_bleed_m: 0.035, cloth_distance_m: 0.6,
  });
  expect(saved.curtain_tt).toBe(0.78);   // the caller's object is untouched (PRESETS entries are shared by reference)
});

test("a mixed look prefers the new key and drops the old one", () => {
  const mixed = { curtain_diffuse: 0.1, glow_bleed: 0.9, curtain_tt: 0.2 };
  expect(migrateLegacy(mixed)).toEqual({ glow_bleed: 0.9, fabric_tt: 0.2 });
});

test("a current look is returned unchanged, and not copied", () => {
  const look = { exposure: 1.3, glow_bleed: 0.15 };
  expect(migrateLegacy(look)).toBe(look);
  for (const junk of [null, undefined, 7, "look"]) expect(migrateLegacy(junk)).toBe(junk);
});

test("a ★ look saved under the old names loads through the store", () => {
  let store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
  setStored({ "old look": { curtain_tt: 0.78, curtain_diffuse_m: 0.035 } });
  expect(getPreset("old look")).toEqual({ fabric_tt: 0.78, glow_bleed_m: 0.035 });
  delete globalThis.localStorage;
});
