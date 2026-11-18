// ============================================================================
// THE GROVE'S REACH (grove_reach_m). The trees are spaced, and an overhead park's crowns sized, to fill a span of ground. That span
// was the view's extent read whenever the grove was grown, so a look zoomed on screen and the same look saved and loaded again were
// two groves. A zoom moves the camera and never the trees: the first time the view moves under a grown grove, the look takes the
// reach its grove was grown for, and carries it. A look that names no reach grows for its own view, as every look did.
// What must not slip: a zoom or a regrow after one changing the grove; a saved look growing a different grove from the one on screen;
// a look that names no reach growing differently from before; a route between a look and its zoomed copy regrowing or popping.
// ============================================================================
import { test, expect } from "bun:test";
import { create, DEFAULTS, PARAMS } from "../komorebi.js";
import { GROVE_READS } from "../engine/canopy/komorebi-grove.js";
import { PRESETS } from "../presets.js";
import { MACROS, macroParams } from "../macros.js";

// an engine on a stand-in GL that keeps what each buffer was given: the grove's leaves, as uploaded
function rig(params) {
  globalThis.requestAnimationFrame = () => 0;
  const gl = new Proxy({}, {
    get(t, name) {
      if (typeof name !== "string") return undefined;
      if (name === "getParameter") return () => 4096;
      if (name === "getShaderParameter" || name === "getProgramParameter") return () => true;
      if (name === "getExtension") return () => ({ loseContext() {} });
      if (name === "FRAMEBUFFER_COMPLETE") return 0x8cd5;
      if (name === "checkFramebufferStatus") return () => 0x8cd5;
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, d) => { if (t.cur) t.cur.data = d; };
      return () => ({});
    },
  });
  const canvas = { getContext: () => gl, addEventListener() {}, removeEventListener() {}, clientWidth: 100, clientHeight: 100, width: 100, height: 100 };
  const eng = create(canvas, { params });
  eng.setPaused(true);
  return eng;
}
const leaves = (eng) => eng.grove().layerVAO.map((l) => Array.from(l.buf.data.subarray(0, l.count * 17)));
// an overhead park small enough to grow many times: its crowns are sized by the reach (3.1 m of a 12 m canopy)
const PARK = { ...PRESETS["afternoon 7"], tree_count: 3, leaves_per_cluster: 6, branch_levels: 2, wind_strength: 0, weather_variability: 0, drift_auto: false, auto_quality: false, adaptive_motion: false };
const VIEW = PARK.view_extent_m;

test("a look that names no reach grows for its own view", () => {
  expect(DEFAULTS.grove_reach_m).toBe(0);
  expect(GROVE_READS).toContain("grove_reach_m");
  expect(PARK.grove_reach_m ?? 0, "the shipped look names none").toBe(0);
  const a = rig({ ...PARK }), b = rig({ ...PARK, grove_reach_m: VIEW }), c = rig({ ...PARK, view_extent_m: VIEW / 2 });
  expect(leaves(a), "naming the view as the reach is the same grove").toEqual(leaves(b));
  expect(leaves(a), "and the reach matters here: another view grows another grove").not.toEqual(leaves(c));
  for (const e of [a, b, c]) e.dispose();
});

test("a zoom leaves the grove standing, the look takes the reach it was grown for, and a regrow keeps it", () => {
  const eng = rig({ ...PARK }), grown = leaves(eng), grove = eng.grove();
  eng.params.view_extent_m = VIEW / 2;
  eng.apply("");                                   // what the view row, a pinch and the wheel leave behind
  expect(eng.grove(), "nothing regrew").toBe(grove);
  expect(eng.params.grove_reach_m, "the look carries the reach its grove has").toBe(VIEW);
  eng.apply("canopy");                             // any later regrow: a slider on the tree, a new seed
  expect(leaves(eng), "the regrown grove is the one that stood").toEqual(grown);
  eng.params.view_extent_m = VIEW * 2; eng.apply("");
  expect(eng.params.grove_reach_m, "a second zoom leaves the reach alone").toBe(VIEW);
  eng.dispose();
});

test("a look saved after a zoom loads as the grove that was on screen", () => {
  const eng = rig({ ...PARK }), grown = leaves(eng);
  eng.params.view_extent_m = VIEW / 2;             // the wheel writes the view and asks for nothing
  const saved = eng.captureLook();
  expect(saved.view_extent_m).toBe(VIEW / 2);
  expect(saved.grove_reach_m, "the saved look names the reach").toBe(VIEW);
  const again = rig(saved);
  expect(leaves(again), "loaded again: the grove that was on screen").toEqual(grown);
  eng.dispose(); again.dispose();
});

test("the reach has a row that regrows, and setting it sizes the park without touching the view", () => {
  expect(PARAMS.grove_reach_m.row.rebuild).toBe("canopy");
  const eng = rig({ ...PARK }), wide = rig({ ...PARK, view_extent_m: VIEW * 1.5 });
  eng.params.grove_reach_m = VIEW * 1.5; eng.apply("canopy");
  expect(eng.params.view_extent_m).toBe(VIEW);
  expect(leaves(eng), "the grove a look at that view grows").toEqual(leaves(wide));
  eng.dispose(); wide.dispose();
});

test("the grove macro sizes the park with its trees: each stop names the reach its view had", () => {
  for (const stop of MACROS.grove.stops) expect(stop.set.grove_reach_m, `t ${stop.t}`).toBe(stop.set.view_extent_m);
  const at = macroParams("grove", 0.85);
  expect(at.grove_reach_m).toBe(at.view_extent_m);
});

test("between a look and its zoomed copy only the camera moves; between two reaches the same grove is regrown a step at a time", () => {
  const savedWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const zoomed = { ...PARK, view_extent_m: VIEW / 2, grove_reach_m: VIEW }, wider = { ...PARK, grove_reach_m: VIEW * 1.5 };
    for (const [from, to, morphs] of [[PARK, zoomed, false], [zoomed, PARK, false], [zoomed, wider, true], [wider, PARK, true]]) {
      const eng = rig({ ...from }), grove = eng.grove();
      let next, now = performance.now();
      globalThis.requestAnimationFrame = (cb) => { next = cb; return 0; };
      eng.setPaused(false);
      eng.transitionTo({ ...to }, { duration: 0.2 });
      expect(eng.trans.canopyMorph, "the grove is regrown only when the reach differs").toBe(morphs);
      expect(eng.trans.structDiff, "never a dissolve").toBe(false);
      let reach = eng.params.grove_reach_m > 0 ? eng.params.grove_reach_m : eng.params.view_extent_m, steps = 0;
      const sign = Math.sign((to.grove_reach_m || to.view_extent_m) - (from.grove_reach_m || from.view_extent_m));
      while (eng.trans.active && steps++ < 60) {
        const frame = next; now += 1000 / 60; frame(now);
        if (!eng.trans.active) break;
        const r = eng.params.grove_reach_m > 0 ? eng.params.grove_reach_m : eng.params.view_extent_m;
        if (morphs) { expect((r - reach) * sign, "the reach moves one way, a step at a time").toBeGreaterThanOrEqual(0); expect(Math.abs(r - reach)).toBeLessThan(VIEW * 0.2); }
        reach = r;
      }
      expect(eng.trans.active).toBe(false);
      expect(eng.params.grove_reach_m, "landed on the look's own value").toBe(to.grove_reach_m ?? 0);
      if (!morphs) expect(eng.grove(), "the grove that stood").toBe(grove);
      const fresh = rig({ ...to });
      expect(leaves(eng), "landed on the grove the look grows").toEqual(leaves(fresh));
      eng.dispose(); fresh.dispose();
    }
  } finally { globalThis.window = savedWindow; }
});
