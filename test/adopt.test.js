// Turning a default on (test-gl/adopt.mjs). First the guard: every default as last decided is recorded in test/defaults.json, because a
// built-in look fills every key it does not name from DEFAULTS, so a default changed by hand moves every such look with nobody having
// looked. Then the adopt tool's pure parts (test-gl/adopt-lib.mjs), held to the real presets.js and komorebi-params.js where they edit them.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULTS, GRANDFATHERED, PARAMS } from "../engine/komorebi-params.js";
import { FIDELITY_KEYS, PLAYBACK_KEYS } from "../engine/komorebi-session.js";
import { PLAYLISTS, PRESETS } from "../presets.js";
import {
  addGrandfathered, checkRecord, findLook, fpsDrop, groveGroups, lookOrder, namedKeys, paramsKey, parseFlip, parseVariant, pinLook, playlistPairs,
  questionsOf, resolvePicks, resolveVariant, setDefault, setInLook, splitGroups, survey,
} from "../test-gl/adopt-lib.mjs";

const RECORD = JSON.parse(readFileSync("test/defaults.json", "utf8"));
const PRESETS_SRC = readFileSync("presets.js", "utf8");
const PARAMS_SRC = readFileSync("engine/komorebi-params.js", "utf8");
const MACHINE = [...FIDELITY_KEYS, ...PLAYBACK_KEYS];

describe("the record of defaults", () => {
  const { changed, added, removed } = checkRecord(RECORD, DEFAULTS);
  test("no default has changed since it was last decided", () => {
    expect(changed, `a changed default moves every built-in that does not name it. Survey and review it: nix run .#adopt -- survey ${changed.map((c) => `${c.key}=${JSON.stringify(c.now)}`).join(" ")}`).toEqual([]);
  });
  test("every parameter's default is recorded, and no other", () => {
    expect({ added, removed }, "a parameter was added or removed: nix run .#adopt -- record").toEqual({ added: [], removed: [] });
  });
});

describe("the flip", () => {
  test("a key=value for a look's setting", () => {
    expect(parseFlip(["thin_twigs=true", "wind_depth=0.5"], PARAMS, MACHINE)).toEqual({ flip: { thin_twigs: true, wind_depth: 0.5 }, problems: [] });
  });
  test("refused: unknown, an input, a machine key, the wrong type, already the default, off its row", () => {
    const p = (a) => parseFlip([a], PARAMS, MACHINE).problems.join();
    expect(p("no_such=1")).toContain("no such parameter");
    expect(p("time_of_day=12")).toContain("editor input");
    expect(p("sample_count=40")).toContain("machine setting");
    expect(p("thin_twigs=1")).toContain("is a number");
    expect(p(`vignette=${DEFAULTS.vignette}`)).toContain("already its default");
    expect(p("vignette=3")).toContain("outside its row");
  });
  test("a variant: a factor on the look's own value, or a value; rounded once to what apply writes", () => {
    const v = parseVariant("resat:exposure=*0.819,leaf_shape=maple,litter=1");
    expect(v).toEqual({ name: "resat", set: { exposure: { mul: 0.819 }, leaf_shape: { val: "maple" }, litter: { val: 1 } } });
    expect(resolveVariant(v, { exposure: 1.656 })).toEqual({ exposure: 1.3563, leaf_shape: "maple", litter: 1 });
    expect(() => resolveVariant(parseVariant("x:leaf_shape=*2"), { leaf_shape: "maple" })).toThrow("not a number");
  });
});

describe("which looks move", () => {
  const before = { presets: { a: { k: 0, j: 1 }, b: { k: 2, j: 1 }, c: { k: 0, j: 3 } } };
  const after = { presets: { a: { k: 1, j: 1 }, b: { k: 2, j: 1 }, c: { k: 1, j: 3 } } };
  test("a look moves when its params differ between the two worlds", () => {
    expect(survey(before, after)).toEqual({ moved: [{ look: "a", keys: ["k"], over: { k: 1 } }, { look: "c", keys: ["k"], over: { k: 1 } }], still: ["b"] });
  });
  test("the order a person meets them: the playlists, then the rest", () => {
    expect(lookOrder({ x: {}, y: {}, z: {} }, { p: { items: ["z", { look: "x" }, "nope"] } })).toEqual(["z", "x", "y"]);
  });
  test("params' identity does not depend on key order", () => expect(paramsKey({ a: 1, b: 2 })).toBe(paramsKey({ b: 2, a: 1 })));
  test("looks equal on every key a route reads share a grove", () => {
    const P = { t: { travels: "topo" }, m: { travels: "morph" } };
    expect(groveGroups({ a: { t: 1, m: 0 }, b: { t: 1, m: 5 }, c: { t: 2, m: 0 } }, ["a", "b", "c"], P)).toEqual([["a", "b"]]);
  });
});

describe("the picks", () => {
  const columns = [{ letter: "a" }, { letter: "b" }, { letter: "c" }];
  const looks = [{ look: "x", visible: true }, { look: "y", visible: true }, { look: "q", visible: false }];
  test("a picked look takes its pick, the rest `rest`, an unseen change b", () => {
    expect(resolvePicks({ picks: { x: "a" }, rest: "c" }, looks, columns)).toEqual({ picks: { x: "a", y: "c", q: "b" }, problems: [] });
  });
  test("no rest and no pick is an error, never a guess; so is a look or column that is not there", () => {
    expect(resolvePicks({ picks: { x: "a" } }, looks, columns).problems).toEqual(["y: moves visibly and has no pick (pick it, or set rest)"]);
    expect(resolvePicks({ picks: { z: "a", x: "d" }, rest: "b" }, looks, columns).problems.join()).toContain("z: picked, but the flip does not move it");
    expect(resolvePicks({ picks: { x: "d" }, rest: "b" }, looks, columns).problems.join()).toContain("'d' is not a column");
  });
  test("a grove whose looks would no longer agree on the flip is split", () => {
    const expected = { x: { k: 0 }, y: { k: 1 }, z: { k: 1 } };
    expect(splitGroups([["x", "y"], ["y", "z"]], { x: "a", y: "b", z: "b" }, ["k"], expected)).toEqual([["x (a)", "y (b)"]]);
  });
});

describe("editing presets.js", () => {
  test("every built-in is found once, by the header the edits read", () => {
    for (const look of Object.keys(PRESETS)) expect(() => findLook(PRESETS_SRC, look), look).not.toThrow();
  });
  test("a look's named keys are the ones it says, and only those", () => {
    const { bodyStart, bodyEnd } = findLook(PRESETS_SRC, "afternoon 7");
    const named = namedKeys(PRESETS_SRC.slice(bodyStart, bodyEnd));
    expect(named.has("shoot_leaves")).toBe(true);
    expect(named.has("tree_tone")).toBe(false);
  });
  const SRC = `export const PRESETS = {
  'one': Object.assign({}, LOOK_DEFAULTS, {
    "exposure": 1.2, "seed": 3,   // a comment with "litter": in it
    "leaf_shape": "maple",
  }),
  'two': Object.assign({}, LOOK_DEFAULTS, {   // a header comment
    "exposure": 2,
  }),
};
`;
  test("a kept look names its old values on one line at the top of its body", () => {
    const out = pinLook(SRC, "two", { thin_twigs: false, wind_depth: 0 }, "kept as made");
    expect(out).toContain(`  'two': Object.assign({}, LOOK_DEFAULTS, {   // a header comment\n    "thin_twigs": false, "wind_depth": 0,   // kept as made\n    "exposure": 2,`);
    expect(() => pinLook(SRC, "one", { seed: 1 }, "x")).toThrow("already names seed");
    expect(() => pinLook(SRC, "three", { seed: 1 }, "x")).toThrow("0 headers");
  });
  test("a variant changes a named value where it stands and adds the others, the comments kept", () => {
    const out = setInLook(SRC, "one", { exposure: 0.98, litter: 1, leaf_shape: "beech" }, "took k with resat");
    expect(out).toContain(`  'one': Object.assign({}, LOOK_DEFAULTS, {\n    // took k with resat\n    "litter": 1,\n    "exposure": 0.98, "seed": 3,   // a comment with "litter": in it\n    "leaf_shape": "beech",\n  }),`);
    expect(out).toContain(`"exposure": 2,`);   // the other look is untouched
  });
});

describe("editing komorebi-params.js", () => {
  test("every stored parameter's default is on the one line the edit reads", () => {
    for (const k of Object.keys(DEFAULTS)) expect(() => setDefault(PARAMS_SRC, k, DEFAULTS[k]), k).not.toThrow();
  });
  test("a new default is written in place, and nothing else moves", () => {
    const out = setDefault(PARAMS_SRC, "thin_twigs", true);
    expect(out).toContain("  thin_twigs: { default: true,");
    expect(out.length).toBe(PARAMS_SRC.length - "false".length + "true".length);
  });
  test("the old values join GRANDFATHERED before the two that close it", () => {
    // what precedes them is whatever was grandfathered last, so only the anchor is named
    const out = addGrandfathered(PARAMS_SRC, { thin_twigs: false, leaf_shape: "ellipse" });
    expect(out).toContain(", thin_twigs: false, leaf_shape: 'ellipse', exposure: 1.3, ambient_skylight: 0.5 };");
    expect(GRANDFATHERED.exposure).toBe(1.3);
    expect(out.length).toBe(PARAMS_SRC.length + " thin_twigs: false, leaf_shape: 'ellipse',".length);
  });
});

describe("the four questions", () => {
  test("a frame rate is read as seen, capped at 60, and a pick may lose at most 10 of it", () => {
    expect(fpsDrop(4, 8)).toEqual({ a: 60, b: 60, drop: 0, slow: false });          // 250 → 125 fps: both above what is shown
    expect(fpsDrop(16, 20).slow).toBe(false);                                       // 60 → 50
    expect(fpsDrop(16, 21)).toMatchObject({ a: 60, slow: true });                   // 60 → 47.6
    expect(fpsDrop(25, 40).drop).toBeCloseTo(15, 9);                                // 40 → 25
  });
  test("the routes the playlists walk: each once, the last back to the first, only between built-ins", () => {
    const presets = { a: {}, b: {}, c: {} };
    expect(playlistPairs({ one: { items: ["a", { look: "b" }, "gone", "c"] }, two: { items: ["a", "b"] }, three: { items: ["c"] } }, presets))
      .toEqual([["a", "b"], ["b", "c"], ["c", "a"], ["b", "a"]]);
  });
  test("the shipped playlists walk routes", () => {
    expect(playlistPairs(PLAYLISTS, PRESETS).length).toBeGreaterThan(10);
  });

  const m = { columns: [{ letter: "a" }, { letter: "b" }], looks: [{ look: "x", visible: true, rank: 1 }, { look: "y", visible: true, rank: 2 }] };
  const open = (state, picks) => Object.fromEntries(questionsOf({ m, decisions: null, cost: null, motion: null, transitions: null, ...state }, picks, "F").map((q) => [q.key, q.open]));
  const fast = { aMs: 16, bMs: 17, a: 60, b: 58.8, drop: 1.2, slow: false }, slow = { aMs: 16, bMs: 25, a: 60, b: 40, drop: 20, slow: true };
  test("at first every question is open, and each names the command that answers it", () => {
    const qs = questionsOf({ m, decisions: null, cost: null, motion: null, transitions: null }, null, "F");
    expect(qs.map((q) => [q.key, q.open])).toEqual([["cost", true], ["look", true], ["motion", true], ["transitions", true]]);
    expect(qs.find((q) => q.key === "cost").say).toContain("nix run .#adopt -- cost F");
    expect(qs.find((q) => q.key === "transitions").say).toContain("nix run .#adopt -- transitions F");
  });
  test("cost: answered when every picked column is measured and none loses more than 10 fps; a kept look is not asked", () => {
    expect(open({ cost: { looks: { x: { b: fast } } } }, null).cost).toBe(true);   // y unmeasured
    expect(open({ cost: { looks: { x: { b: fast }, y: { b: slow } } } }, null).cost).toBe(false);   // before the picks a slow look is said, not blocking
    const picks = { x: "b", y: "b" }, decisions = { picks };
    expect(open({ decisions, cost: { looks: { x: { b: fast }, y: { b: slow } } } }, picks).cost).toBe(true);
    expect(open({ decisions, cost: { looks: { x: { b: fast }, y: { b: slow } } } }, { x: "b", y: "a" }).cost).toBe(false);
  });
  test("motion: measured at the pick, or waived in words", () => {
    const picks = { x: "b", y: "b" };
    expect(open({ decisions: { picks }, motion: { looks: { x: { pick: "b" } } } }, picks).motion).toBe(false);
    expect(open({ decisions: { picks: { x: "c" } }, motion: { looks: { x: { pick: "b" } } } }, { x: "c", y: "b" }).motion).toBe(true);
    expect(open({ decisions: { picks, motion: "only the leaves' colour moves" } }, picks).motion).toBe(false);
    expect(open({ decisions: { picks, motion: "  " } }, picks).motion).toBe(true);
  });
  test("transitions: run at the picks, and a route that changes kind is answered in words or by another pick", () => {
    const picks = { x: "b", y: "b" }, same = { pairs: [{ from: "x", to: "y", a: { kind: "live morph" }, b: { kind: "live morph" } }] };
    const changed = { pairs: [{ from: "x", to: "y", a: { kind: "live morph" }, b: { kind: "dissolve" } }] };
    expect(open({ decisions: { picks }, transitions: { picks, ...same } }, picks).transitions).toBe(false);
    expect(open({ decisions: { picks }, transitions: { picks: null, ...same } }, picks).transitions).toBe(true);   // run before the picks
    expect(open({ decisions: { picks }, transitions: { picks, ...changed } }, picks).transitions).toBe(true);
    expect(open({ decisions: { picks, transitions: "a dissolve is how this pair always read" }, transitions: { picks, ...changed } }, picks).transitions).toBe(false);
  });
});
