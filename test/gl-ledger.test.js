// ============================================================================
// THE GL LEDGER: the whole engine on a stand-in GL that records every object it creates, deletes, binds, writes and draws, held to
// three invariants a browser holds an engine to only in part, and silently: no object is deleted twice; no object is bound, written,
// attached or drawn after its deletion (a draw reads every enabled attribute of the bound vertex array, so a buffer deleted while
// another vertex array was bound and still read through it counts); and nothing the engine made is left alive after `dispose`.
// A context loss is a ledger event too: every handle from before it is dead, and the engine may neither use nor delete one after
// the restore. Run over the hand-overs a grove goes through: a regrow, a re-season and a re-weight, the crossfade landed, aborted,
// interrupted and disposed, the scene fade, leaf travel landed and reversed, setParams in the middle of each long route, and a
// context lost in the middle of one.
// ============================================================================
import { test, expect, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { create, DEFAULTS } from "../komorebi.js";
import { PRESETS } from "../presets.js";
import * as SH from "../engine/transport/komorebi-shaders.js";
import * as LEAF from "../engine/leaf/komorebi-leaf.js";

const KINDS = { Buffer: "buffer", VertexArray: "vertex array", Texture: "texture", Framebuffer: "framebuffer", Renderbuffer: "renderbuffer", Program: "program", Shader: "shader", Query: "query" };

function makeLedger() {
  let seq = 0, lost = false, casts = 0, layerDraws = 0;
  const live = new Set(), deleted = new Set(), dead = new Set(), faults = [], made = {}, linked = [];
  const at = { array: null, vao: null, fb: null, prog: null, rb: null, unit: "TEXTURE0", units: {} };
  const label = (o) => `${o.kind} #${o.id}`;
  const fault = (m) => { if (!faults.includes(m)) faults.push(m); };   // each fault once, however many frames repeat it
  const use = (o, how) => {
    if (!o || typeof o !== "object" || !o.kind) return;
    if (deleted.has(o)) fault(`${label(o)} ${how} after its deletion`);
    else if (dead.has(o)) fault(`${label(o)} ${how} after its context was lost`);
  };
  const make = (kind) => () => { const o = { kind, id: ++seq }; if (kind === "vertex array") o.attrs = {}; live.add(o); made[kind] = (made[kind] ?? 0) + 1; return o; };
  // GL's own rule: deleting an object unbinds it from the context's binding points and detaches a buffer from the BOUND vertex array only.
  const remove = (o) => {
    if (!o) return;
    if (deleted.has(o)) { fault(`${label(o)} deleted twice`); return; }
    if (dead.has(o)) { fault(`${label(o)} deleted after its context was lost`); return; }
    live.delete(o); deleted.add(o);
    for (const k of ["array", "vao", "fb", "prog", "rb"]) if (at[k] === o) at[k] = null;
    for (const u of Object.values(at.units)) for (const t in u) if (u[t] === o) u[t] = null;
    if (at.vao) for (const a of Object.values(at.vao.attrs)) if (a.buf === o) a.buf = null;
  };
  const bound = (t) => at.units[at.unit]?.[t];
  const attr = (i) => (at.vao.attrs[i] ??= {});
  const draw = () => {
    if (at.vao?.attrs[9]?.on) casts++;   // the faithful leaves' vertex array, the only one with the side attribute: one draw a sample of a faithful cast
    if (at.prog?.shaders?.[0]?.src === SH.VS_BAKE) layerDraws++;
    use(at.prog, "drawn with"); use(at.vao, "drawn"); use(at.fb, "drawn into");
    if (at.vao) for (const [i, a] of Object.entries(at.vao.attrs)) if (a.on) use(a.buf, `read by a draw (attribute ${i})`);
  };
  const fns = {
    bindBuffer: (t, b) => { use(b, "bound"); if (t === "ARRAY_BUFFER") at.array = b; },
    bufferData: () => use(at.array, "written"), bufferSubData: () => use(at.array, "written"), getBufferSubData: () => use(at.array, "read back"),
    bindVertexArray: (v) => { use(v, "bound"); at.vao = v; },
    enableVertexAttribArray: (i) => { if (at.vao) attr(i).on = true; },
    disableVertexAttribArray: (i) => { if (at.vao) attr(i).on = false; },
    vertexAttribPointer: (i) => { use(at.array, "pointed at"); if (at.vao) attr(i).buf = at.array; },
    activeTexture: (u) => { at.unit = u; },
    bindTexture: (t, x) => { use(x, "bound"); at.units[at.unit] ??= {}; at.units[at.unit][t] = x; },
    texImage2D: (t, _level, _format, w, h) => { const x = bound(t); use(x, "written"); if (x) x.size = [w, h]; },
    texImage3D: (t) => use(bound(t), "written"), texSubImage2D: (t) => use(bound(t), "written"),
    texParameteri: (t) => use(bound(t), "written"), generateMipmap: (t) => use(bound(t), "written"),
    bindFramebuffer: (_t, f) => { use(f, "bound"); at.fb = f; },
    framebufferTexture2D: (_t, _a, _tt, x) => { use(at.fb, "written"); use(x, "attached"); },
    framebufferTextureLayer: (_t, _a, x) => { use(at.fb, "written"); use(x, "attached"); },
    bindRenderbuffer: (_t, r) => { use(r, "bound"); at.rb = r; },
    renderbufferStorageMultisample: () => use(at.rb, "written"),
    framebufferRenderbuffer: (_t, _a, _rt, r) => { use(at.fb, "written"); use(r, "attached"); },
    useProgram: (p) => { use(p, "used"); at.prog = p; },
    attachShader: (p, s) => { use(p, "linked"); use(s, "attached"); if (p) p.shaders = [...(p.shaders ?? []), s]; },
    linkProgram: (p) => { use(p, "linked"); linked.push(p.shaders?.map((s) => s.src) ?? []); },
    shaderSource: (s, src) => { use(s, "compiled"); if (s) s.src = src; }, compileShader: (s) => use(s, "compiled"),
    getUniformLocation: (p) => { use(p, "asked"); return {}; },
    drawArrays: draw, drawArraysInstanced: draw,
    clear: () => use(at.fb, "cleared"), blitFramebuffer: () => use(at.fb, "blitted"), readPixels: () => use(at.fb, "read back"),
    beginQuery: (_t, q) => use(q, "begun"), getQueryParameter: (q) => { use(q, "read"); return 0; },
    getParameter: () => 4096, getShaderParameter: () => true, getProgramParameter: () => true, getShaderInfoLog: () => "", getProgramInfoLog: () => "",
    checkFramebufferStatus: () => "FRAMEBUFFER_COMPLETE", getError: () => 0,
    getExtension: (n) => (n === "EXT_disjoint_timer_query_webgl2" ? null : { loseContext() {} }),
  };
  for (const [k, kind] of Object.entries(KINDS)) { fns[`create${k}`] = make(kind); fns[`delete${k}`] = remove; }
  const noop = () => undefined;
  const gl = new Proxy({}, { get(_t, k) {
    if (typeof k !== "string") return undefined;
    if (/^[A-Z][A-Z0-9_]*$/.test(k)) return k;   // a constant is its own name: the engine only compares and offsets them
    if (lost) return k.startsWith("create") ? () => null : k === "getParameter" ? () => 4096 : noop;   // a lost context answers nothing
    return fns[k] ?? noop;
  } });
  return {
    gl, faults,
    lose() { lost = true; for (const o of live) dead.add(o); live.clear(); Object.assign(at, { array: null, vao: null, fb: null, prog: null, rb: null, units: {} }); },
    restore() { lost = false; },
    alive: () => [...live],
    made: () => ({ ...made }),   // every object created so far, by kind
    linked: () => [...linked],   // every program linked so far, as its [vertex, fragment] sources
    casts: () => casts,          // every sample of a faithful cast drawn so far
    layerDraws: () => layerDraws,
    // what is left alive, by kind; shaders aside: the engine links each into its program and lets the program hold it
    leaks: () => { const n = {}; for (const o of live) if (o.kind !== "shader") n[o.kind] = (n[o.kind] ?? 0) + 1; return n; },
  };
}

// The engine over a ledger, on a pumped clock. `lose` and `restore` fire the canvas's own context events.
function engine(look) {
  const L = makeLedger(), on = {};
  let next = null, now = 1000;
  globalThis.requestAnimationFrame = (cb) => { next = cb; return 0; };
  const canvas = { getContext: () => L.gl, addEventListener(n, f) { on[n] = f; }, removeEventListener(n, f) { if (on[n] === f) delete on[n]; }, clientWidth: 64, clientHeight: 36, width: 64, height: 36 };
  const eng = create(canvas, { params: look });
  const pump = (n = 1, dt = 1000 / 60) => { for (let i = 0; i < n; i++) { const f = next; next = null; now += dt; f?.(now); } };
  const land = (max = 2000) => { for (let i = 0; i < max && eng.trans.active; i++) pump(); expect(eng.trans.active, "the route lands").toBe(false); pump(2); };
  return { eng, L, pump, land,
    lose() { L.lose(); on.webglcontextlost({ preventDefault() {} }); },
    restore() { L.restore(); on.webglcontextrestored(); } };
}
// Disposed, the engine holds nothing, and the ledger saw no fault on the way.
function closes(R, what) {
  R.eng.dispose();
  expect(R.L.faults, `${what}: GL faults`).toEqual([]);
  expect(R.L.leaks(), `${what}: alive after dispose`).toEqual({});
}
function withWindow(body) {
  const savedWindow = globalThis.window, savedRaf = globalThis.requestAnimationFrame;
  globalThis.window = { devicePixelRatio: 1 };
  try { body(); } finally { globalThis.window = savedWindow; globalThis.requestAnimationFrame = savedRaf; }
}

const still = { wind_strength: 1, weather_variability: 0, drift_auto: false, auto_quality: false, adaptive_motion: false };
const small = { standing_scene: false, tree_count: 3, branch_levels: 2, branch_children: 2, limb_count: 4, leaves_per_cluster: 4, sample_count: 4, tex_resolution: 64, bake_resolution: 64, ...still };
const FAITHFUL = { ...DEFAULTS, ...small, faithful_canopy: true };   // a faithful overhead grove: its leaves travel to and from LAYERED
const LAYERED = { ...FAITHFUL, faithful_canopy: false };
const OTHER = { ...LAYERED, seed: 77 };                              // another layered grove: the crossfade's
const FALL = { ...PRESETS["afternoon 7"], ...small, inner_leaves: 0, tree_count: 2, leaves_per_cluster: 6, layer_count: 3, phenology: 0.8, leaf_drop: 1 };
const FADE = { ...FAITHFUL, seed: 77 };                              // with { style: 'fade' }: the scene dissolve
const SEASON = [{ ...PRESETS["park fall"], ...still }, { ...PRESETS.montebello, ...still }];
const fixture = (n) => JSON.parse(readFileSync(new URL(`../test-gl/fixtures/${n}.json`, import.meta.url), "utf8"));
const tune = { branch_levels: 2, branch_children: 2, limb_count: 3, sample_count: 4, tex_resolution: 64, bake_resolution: 64, fill_directions: 4, fill_resolution: 32, litter_resolution: 64, ...still };
const RISE = (({ from, to }) => [{ ...from, ...tune, tree_count: 1, leaves_per_cluster: 8 }, { ...to, ...tune, tree_count: 1, leaves_per_cluster: 8 }])(fixture("fall-look-up"));
const GROVE = (({ from, to }) => [{ ...from, ...tune, tree_count: 2, leaves_per_cluster: 6, phenology: 0.85, leaf_drop: 0.6 }, { ...to, ...tune, tree_count: 1, leaves_per_cluster: 6 }])(fixture("fall-park"));

// Starts a route from `from` to `to` and checks it is the one named.
function start(R, to, name, opts = {}) {
  R.eng.transitionTo(to, { duration: 1, ...opts });
  const took = name === "crossfade" ? R.eng.trans.crossfade && "crossfade" : R.eng.trans.route?.name;
  expect(took, `the pair takes the ${name}`).toBe(name);
}

// Each scenario runs the engine from `from` through `steps` and closes it: every fault and every object left alive is the scenario's.
const scenario = (name, from, steps) => test(name, () => withWindow(() => { const R = engine(from); R.pump(3); steps(R); closes(R, name); }));

scenario("a plain regrow", FALL, (R) => { for (let i = 0; i < 3; i++) { R.eng.apply("canopy"); R.pump(); } });
scenario("a re-season", FALL, (R) => {
  expect(R.eng.apply("season")).toBe("build");
  R.eng.params.phenology = 0.85;
  expect(R.eng.apply("season")).toBe("reseason");
  R.pump(2);
});
scenario("a density re-weight", { ...FALL, phenology: 0.5, leaf_drop: 0, foliage_density: 0.4 }, (R) => {
  for (const [density, path] of [[1.4, "build"], [0.6, "reseason"], [2, "build"]]) { R.eng.params.foliage_density = density; expect(R.eng.apply("density")).toBe(path); R.pump(); }
});
scenario("a crossfade keeps the outgoing edge until the incoming grove takes over", LAYERED, (R) => {
  const to = { ...OTHER, edge_softness: 0.8 };
  start(R, to, "crossfade");
  R.pump(30);
  expect(R.eng.trans.swapped).toBe(false);
  expect(R.eng.params.edge_softness).toBe(LAYERED.edge_softness);
  R.land();
  expect(R.eng.params.edge_softness).toBe(to.edge_softness);
});
scenario("a crossfade aborted by setParams", LAYERED, (R) => { start(R, OTHER, "crossfade"); R.pump(5); R.eng.setParams(FAITHFUL); R.pump(3); });
scenario("a crossfade interrupted by another, before its window", LAYERED, (R) => { start(R, OTHER, "crossfade"); R.pump(5); start(R, { ...OTHER, seed: 78 }, "crossfade"); R.land(); });
scenario("dispose in the middle of a crossfade", LAYERED, (R) => { start(R, OTHER, "crossfade"); R.pump(40); expect(R.eng.trans.active, "still in the window").toBe(true); });
scenario("after an aborted crossfade the grove still on screen re-seasons by the fast path", FALL, (R) => {
  expect(R.eng.apply("season")).toBe("build");
  R.eng.params.phenology = 0.82;
  expect(R.eng.apply("season")).toBe("reseason");
  start(R, { ...R.eng.params, seed: 77 }, "crossfade");
  R.pump(3);
  R.eng.transitionTo({ ...FALL, phenology: 0.82 }, { duration: 0.2 });   // back, before the window: the incoming grove is dropped
  R.land();
  R.eng.params.phenology = 0.84;
  expect(R.eng.apply("season"), "the grove on screen is still the one its record describes").toBe("reseason");
});
scenario("a scene fade to its landing", FAITHFUL, (R) => { start(R, FADE, "sceneFade", { style: "fade" }); R.land(); });
scenario("a leaf travel to its landing", FAITHFUL, (R) => { start(R, LAYERED, "leafTravel"); R.land(); });
scenario("a leaf travel reversed home, then a regrow", FAITHFUL, (R) => {
  start(R, LAYERED, "leafTravel"); R.pump(20); R.eng.transitionTo(FAITHFUL, { duration: 0.5 }); R.land();
  R.eng.apply("canopy"); R.pump();
});
scenario("a season travel to its landing", SEASON[0], (R) => { start(R, SEASON[1], "seasonTravel"); R.land(); });
// A route home leaves the engine's layer bookkeeping describing the textures it put back: a later route that sizes the layers replaces only
// a texture whose size changes (a replacement at the size it had is an empty layer for nothing, which is what a stale record of sizes does).
scenario("a leaf travel reversed home puts back the layer textures with their sizes", LAYERED, (R) => {
  start(R, FAITHFUL, "leafTravel"); R.pump(20); R.eng.transitionTo(LAYERED, { duration: 0.5 }); R.land();
  const before = [...R.eng.layers()], sizes = before.map((t) => t.size?.[0]);
  const to = { ...OTHER, layer_count: LAYERED.layer_count + 1 };
  start(R, to, "crossfade");
  const after = R.eng.layers();
  const replaced = before.map((t, i) => (after[i] !== t ? i : -1)).filter((i) => i >= 0);
  expect(replaced.map((i) => [i, sizes[i], after[i].size[0]]), "only the layer the route raises is replaced, and at a new size").toEqual(
    [[LAYERED.layer_count, 1, sizes[0]]]);
  R.land();
});
const ROUTES = [["crossfade", LAYERED, OTHER, {}], ["sceneFade", FAITHFUL, FADE, { style: "fade" }], ["leafTravel", FAITHFUL, LAYERED, {}],
  ["seasonTravel", ...SEASON, {}], ["litterRise", ...RISE, {}], ["groveTravel", ...GROVE, {}]];
for (const [name, from, to, opts] of ROUTES) {
  scenario(`setParams in the middle of the ${name}`, from, (R) => {
    start(R, to, name, opts); R.pump(20);
    expect(R.eng.trans.active, "still running").toBe(true);
    R.eng.setParams(from); R.pump(3);
  });
  scenario(`a context lost and restored in the middle of the ${name}`, from, (R) => {
    start(R, to, name, opts); R.pump(20);
    R.lose(); R.pump(2); R.restore(); R.pump(3);
    expect(R.eng.trans.active, "the restore lands the route").toBe(false);
  });
}

// A grove morph regrows every frame with one layout: the regrow takes the GL objects of the grove it replaces (komorebi-grove.js, THE REGROW IN PLACE),
// so a morph frame makes no buffer, vertex array or texture, with the faithful leaves and wood, the layers, and the sky view's wood each in play.
const made = (R) => { const m = R.L.made(); return ["buffer", "vertex array", "texture"].map((k) => m[k] ?? 0); };
for (const [name, look] of [["faithful, with wood", { ...FAITHFUL, branch_tau: 2 }], ["layered", LAYERED], ["sky view, with wood", { ...LAYERED, sky_view: true, branch_tau: 2 }]]) {
  scenario(`a grove morph frame makes no GL object: ${name}`, look, (R) => {
    R.eng.transitionTo({ ...look, leaf_size_m: look.leaf_size_m * 1.5 }, { duration: 1 });
    expect(R.eng.trans.canopyMorph && !R.eng.trans.seasonMorph && !R.eng.trans.densityMorph, "the pair regrows its grove each frame").toBe(true);
    R.pump();
    const before = made(R), g = R.eng.grove();
    R.pump(5);
    expect(R.eng.grove(), "the grove regrew").not.toBe(g);
    expect(made(R), "buffers, vertex arrays and textures made over five morph frames").toEqual(before);
    R.land();
  });
}

// A route's programs are the context's, taken through the host engine (komorebi-engine.js, THE CONTEXT'S PROGRAMS): once a route has run there and back, running it
// again links none of them. (A borrowed scene's own transport program can still be linked again: the scene was the last to hold it.)
const ROUTE_PROGRAMS = [[SH.VS_FULL, SH.FS_SCENE_MIX], [SH.VS_SEASON_TRAVEL, SH.FS_FAITH], [SH.VS_LEAF_TRAVEL, SH.FS_LEAF_TRAVEL], [SH.VS_LEAF_TRAVEL_PATCH, SH.FS_LEAF_TRAVEL_PATCH],
  [SH.VS_LEAF_TRAVEL_PATCH, SH.FS_LEAF_PROGRESS], [SH.VS_LEAF_CARRY, SH.FS_LEAF_CARRY], [SH.VS_LEAF_CARRY_PATCH, SH.FS_LEAF_CARRY], [SH.VS_FULL, SH.FS_PROGRESS_BLUR], [SH.VS_FULL, SH.FS_PATCH_MIX], [SH.VS_FAITH_SEG, SH.FS_FAITH_SEG], [SH.VS_RISE_SKY, SH.FS_RISE_SKY], [SH.VS_RISE, SH.FS_RISE]];
const routeLinks = (list) => list.filter(([vs, fs]) => ROUTE_PROGRAMS.some(([v, f]) => v === vs && f === fs)).length;
for (const [name, from, to, opts, label = name] of [...ROUTES.filter(([name]) => name !== "crossfade"), ["leafTravel", FAITHFUL, FADE, {}, "leafTravel, patch by patch"]]) {
  scenario(`the ${label} run a second time links none of its programs`, from, (R) => {
    start(R, to, name, opts); R.land();
    R.eng.transitionTo(from, { duration: 1, ...opts }); R.land();
    const before = R.L.linked().length;
    start(R, to, name, opts); R.land();
    expect(routeLinks(R.L.linked().slice(before)), "route programs linked by the second run").toBe(0);
  });
}

// A bake that is overwritten before anything reads it is not made: a scene is baked once, with the motion it copies from its host; a landing that moves the
// motion bakes after it, and a faithful morph's landing frame bakes the exact target alone. Counted in faithful casts, as samples drawn over the source's count.
const bakes = (R, body) => { const c = R.L.casts(); body(); return (R.L.casts() - c)/R.eng.src.count; };
const lastFrame = (R) => { let n = 0; while (R.eng.trans.active && n++ < 2000) { const c = R.L.casts(); R.pump(); if (!R.eng.trans.active) return (R.L.casts() - c)/R.eng.src.count; } throw new Error("the route never landed"); };
scenario("a scene fade's start bakes the outgoing scene once, and the incoming look once", FAITHFUL, (R) => {
  expect(bakes(R, () => start(R, FADE, "sceneFade", { style: "fade" }))).toBe(2);
  R.land();
});
scenario("a layered shadow rise bakes each endpoint once at the host's quality", { ...PRESETS.shrooms, ...tune }, (R) => {
  const before = R.L.layerDraws();
  start(R, { ...PRESETS["look up"], ...tune }, "litterRise");
  expect(R.eng.trans.shadowRise).toBe(true);
  expect(R.L.layerDraws() - before).toBe(6);
  R.land();
});
const MANUAL_DRIFT = { ...LAYERED, wind_strength: 0, drift_amount: 0.3, drift_phase: 0 };
for (const [key, value] of [["drift_phase", 2.2], ["drift_amount", 0.08], ["edge_softness", 0.8]]) {
  scenario(`a still layer morph of ${key} refreshes the cast on the same grove`, MANUAL_DRIFT, (R) => {
    const grove = R.eng.grove();
    const before = R.L.layerDraws();
    R.eng.transitionTo({ ...MANUAL_DRIFT, [key]: value }, { duration: 1 });
    R.pump(10);
    expect(R.L.layerDraws() - before).toBe(10 * MANUAL_DRIFT.layer_count);
    expect(R.eng.grove() === grove).toBe(true);
    expect(R.eng.trans.canopyMorph).toBe(false);
    R.land();
    expect(R.eng.params[key]).toBe(value);
    expect(R.eng.grove() === grove).toBe(true);
    const settled = R.L.layerDraws();
    R.pump();
    expect(R.L.layerDraws()).toBe(settled);
  });
}
scenario("a faithful grove morph's landing frame bakes once", FAITHFUL, (R) => {
  R.eng.transitionTo({ ...FAITHFUL, leaf_size_m: FAITHFUL.leaf_size_m*1.5 }, { duration: 1 });
  expect(R.eng.trans.canopyMorph).toBe(true);
  expect(lastFrame(R)).toBe(1);
});
scenario("the grove travel's landing frame bakes the landed look once", GROVE[0], (R) => { start(R, GROVE[1], "groveTravel"); expect(lastFrame(R)).toBe(1); });
// The descent's last step still bakes its source scene (komorebi-litter-rise.js), which this frame then disposes: that is the route's own, and counted here.
scenario("a litter descent's landing frame bakes the landed look once, beside the route's last step", RISE[1], (R) => {
  R.eng.transitionTo(RISE[0], { duration: 1 });
  expect(R.eng.trans.route?.name).toBe("litterRise");
  expect(R.eng.trans.litterFall || R.eng.trans.shadowFall, "a descent").toBe(true);
  expect(lastFrame(R)).toBe(2);
});

// A new look starts the governor at rest: its state is reset before the rebuild, so the textures are sized and the cast baked once, at full quality,
// rather than at the stepped-down quality and again when the reset steps it back up.
scenario("with the governor stepped down, a setParams to another look sizes the textures once and bakes once", { ...FAITHFUL, auto_quality: true, bake_resolution: 2048 }, (R) => {
  for (let i = 0; i < 400 && R.eng.perf.quality >= 0.5; i++) R.pump(1, 50);
  expect(R.eng.perf.quality, "the governor stepped down past the knee").toBeLessThan(0.5);
  const textures = R.L.made().texture;
  expect(bakes(R, () => R.eng.setParams({ ...FAITHFUL, auto_quality: true, bake_resolution: 2048, seed: 77 })), "bakes").toBe(1);
  expect(R.eng.perf.quality, "at rest").toBe(1);
  const atRest = engine({ ...FAITHFUL, auto_quality: true, bake_resolution: 2048 }), was = atRest.L.made().texture;
  atRest.eng.setParams({ ...FAITHFUL, auto_quality: true, bake_resolution: 2048, seed: 77 });
  expect(R.L.made().texture - textures, "textures made, as many as a setParams from a governor at rest").toBe(atRest.L.made().texture - was);
  atRest.eng.dispose();
});

// A grove a scene grew for the look a route lands on is handed to the engine, not grown again (komorebi-engine.js): grove travel landing on its other end,
// the litter descent landing on its floor, and the litter ascent's source, which takes the grove on screen as the dissolve's outgoing scene does.
// Counted as groves grown, which ask for their leaf outline once each (komorebi-grove.js, growGrove).
const grown = (body) => {
  let n = 0;
  const outline = LEAF.leafShape, spy = spyOn(LEAF, "leafShape").mockImplementation((...a) => { if (new Error().stack.includes("growGrove")) n++; return outline(...a); });
  try { body(); } finally { spy.mockRestore(); }
  return n;
};
scenario("a grove travel grows its other end and its carrier, and lands on the other end's grove", GROVE[0], (R) => {
  expect(grown(() => { start(R, GROVE[1], "groveTravel"); R.land(); }), "groves grown").toBe(2);
});
scenario("a litter ascent grows only the target's grove", RISE[0], (R) => {
  expect(grown(() => { start(R, RISE[1], "litterRise"); R.land(); }), "groves grown").toBe(1);
});
scenario("a litter descent grows only the floor's grove", RISE[1], (R) => {
  expect(grown(() => { R.eng.transitionTo(RISE[0], { duration: 1 }); expect(R.eng.trans.litterFall || R.eng.trans.shadowFall, "a descent").toBe(true); R.land(); }), "groves grown").toBe(1);
});
