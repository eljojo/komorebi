// The sun's cosine law (spec §3.5/§4.7/§4.9, `sun_cosine`): the beam lands on a surface by the cosine of its incidence, and the
// receiver is where that lives — the floor takes sin(el), the flat cloth cos(el)·|sin(az)|, each tent panel sin(el) (times its
// own beamF), the sky view nothing. Every way this breaks is silent: a table row that drifts from the sun vector, a 0 that is
// 1.0000000000000002, a factor that also dims the skylight, a fill that goes stale on a live tween, a multiply that sneaks into
// the shader and contracts differently at 1. The pure table and the exactness at 0 are held here; the pixels are the harness's.
import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { DEFAULTS, MORPH_KEYS, CANOPY_KEYS, SEASON_KEYS, TOPO_KEYS, MODE_KEYS, FEATURES, CAMERAS, TRANSPORT_CAMERAS, buildTransport, cameraFor } from "./komorebi.js";
import { DEG, atmosphere, sunDirection, sunIncidence } from "./komorebi-math.js";
import { makeRender } from "./komorebi-render.js";
import { FILL_SIG_LEN, makeFill } from "./komorebi-bake.js";
import { PRESETS } from "./presets.js";

const read = (f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
const ELEVS = [-3, 0, 2, 4, 6, 7, 12, 13, 26, 36, 45, 55, 70, 84.5, 90];
const AZS = [0, 62, 90, 140, 180, 254.1, 359];
// A sun below every floor the engine clamps a sun to somewhere else: the editor's clock (4°), the throws' (6°), the transport's divisor floors. The factor is the surface's own, unclamped in
// elevation, so a clamp at a call site (sunIncidence(cam, Math.max(el, 4), ...)) is invisible at every elevation above it: these straddle 3, 4, 6 and 8 and go through the horizon (0)
// and below it (-3, where the incidence is 0, never a negative).
const LOW_SUN = [-3, 0, 2, 3, 5];

// ---- the table: one pure function --------------------------------------------------------------------------------------------
test("sunIncidence: the floor and the tent take sin(el), the cloth cos(el)·|sin(az)| (= |sunDirection.y|), the sky view 1 — on a grid", () => {
  const sd = [0, 0, 0];
  for (const el of ELEVS) for (const az of AZS) {
    sunDirection(sd, el, az);
    expect(sunIncidence("floor", el, az), `floor ${el}/${az}`).toBe(Math.max(Math.sin(el * DEG), 0));
    expect(sunIncidence("enclosure", el, az), `enclosure ${el}/${az}`).toBe(Math.max(Math.sin(el * DEG), 0));
    expect(sunIncidence("cloth", el, az), `cloth ${el}/${az}`).toBe(Math.abs(sd[1]));
    expect(sunIncidence("sky", el, az), `sky ${el}/${az}`).toBe(1);
  }
});

test("sunIncidence is unclamped in elevation: 2° is sin 2°, not the editor's 4° floor nor the transport's 6° one; the horizon and below give 0, never a negative", () => {
  expect(sunIncidence("floor", 2, 0)).toBe(Math.sin(2 * DEG));
  expect(sunIncidence("floor", 2, 0)).not.toBe(Math.sin(4 * DEG));
  expect(sunIncidence("floor", 2, 0)).not.toBe(Math.sin(6 * DEG));
  expect(sunIncidence("enclosure", 2, 0)).toBe(Math.sin(2 * DEG));
  expect(Object.is(sunIncidence("floor", 0, 0), 0)).toBe(true);
  expect(sunIncidence("floor", -5, 0)).toBe(0);
  expect(sunIncidence("enclosure", -5, 0)).toBe(0);
  expect(sunIncidence("cloth", 2, 90)).toBe(Math.cos(2 * DEG) * Math.sin(90 * DEG));   // the cloth PEAKS as the sun lowers head-on: the opposite of the floor
  expect(sunIncidence("cloth", 2, 90)).toBeGreaterThan(sunIncidence("cloth", 40, 90));
  expect(sunIncidence("cloth", 40, 0)).toBeCloseTo(0, 12);                               // the sun in the cloth's own plane: grazing, nothing lands
});

test("sunIncidence has a row for every camera of the registry — a new receiver must name its surface", () => {
  for (const cam of TRANSPORT_CAMERAS) expect(Number.isFinite(sunIncidence(cam, 30, 100)), cam).toBe(true);
  expect(TRANSPORT_CAMERAS.slice().sort()).toEqual(["cloth", "enclosure", "floor", "sky"]);
});

test("the table's numbers, to 3 places: park 1 .438, curtain 1 .860, curtain 2 .813, tent 1 .819, the y1–y4 sheet .208/.438/.766/.940, the sky views 1", () => {
  const I = (name) => { const p = PRESETS[name]; return sunIncidence(cameraFor(p), p.sun_elevation_deg, p.sun_azimuth_deg); };
  expect(I("park 1")).toBeCloseTo(0.438, 3);
  expect(I("montebello")).toBeCloseTo(0.438, 3);
  expect(I("curtain 1")).toBeCloseTo(0.86, 3);
  expect(I("curtain 2")).toBeCloseTo(0.813, 3);
  expect(I("tent 1")).toBeCloseTo(0.819, 3);
  for (const n of ["canopy 1", "canopy 2", "canopy 3", "canopy 4"]) expect(I(n), n).toBe(1);
  const y = [12, 26, 50, 70].map((el) => sunIncidence("floor", el, 90));
  for (const [i, v] of [0.208, 0.438, 0.766, 0.94].entries()) expect(y[i]).toBeCloseTo(v, 3);
  expect(y[3] / y[0]).toBeCloseTo(4.52, 2);                                  // 70° is ×4.52 brighter than 12°
  expect(sunIncidence("floor", 4, 0)).toBeCloseTo(0.07, 3);                  // the editor's time-of-day clamp
});

// ---- the upload: a stub-GL rig on makeRender. The head uploader is where the factor lands, so the proof is the sun colour it hands
// the shader — read off uniform3f(u.sun, ...), with every location named by its key. ---------------------------------------------
function renderRig(over = {}) {
  const calls = [];
  const gl = new Proxy({}, { get: (_t, name) => (/^[A-Z][A-Z0-9_]+$/.test(name) ? name : (...a) => { calls.push([name, ...a]); return name === "checkFramebufferStatus" ? "FRAMEBUFFER_COMPLETE" : {}; }) });
  const params = { ...DEFAULTS, ...over };
  const U = new Proxy({}, { get: (_t, k) => (k === "layers" || k === "woods" ? [0, 1, 2, 3].map((i) => `${k}${i}`) : k) });
  const hub = {
    gl, canvas: { width: 320, height: 180 }, params, perf: {}, motion: { sway: [0, 0] }, occ: { count: 0 }, occTex: {}, faith: {}, U, emptyVAO: {},
    src: { flat: new Float32Array(48), count: 16, coreR: 0, haloR: 0, Lcore: 0, Lhalo: 0, moonD: 0, moonR: 0 },
    progBlit: {}, progGlowBlur: {}, progGlowMix: {}, faithfulOn: () => false, transportFor: () => ({ prog: {}, U }), transportCamera: () => cameraFor(params),
    fail(m) { throw new Error(m); }, refreshFaith() {}, refreshFill() {}, refreshLitter() {}, layerHeights: () => [2, 3, 4, 5], layerTex: [{}, {}, {}, {}],
    woodTex: [{}, {}, {}, {}], faithTex: {}, projMatrix: () => new Float32Array(4), bulkShift: () => [0, 0], fill: { ready: false }, litter: { ready: false, tex: {} },
  };
  const r = makeRender(hub);
  return {
    params,
    draw() { calls.length = 0; r.drawTransport(); return calls.filter((c) => c[0] === "uniform3f" && c[1] === "sun").map((c) => c.slice(2)); },
    ambient() { return calls.filter((c) => c[0] === "uniform3f" && c[1] === "ambient").map((c) => c.slice(2)); },
  };
}
const CAM_OVER = { floor: {}, cloth: { receiver: 1 }, enclosure: { receiver: 2 }, sky: { sky_view: true } };
const atmSun = (p) => atmosphere({ sun: [0, 0, 0], ambient: [0, 0, 0] }, p.sun_elevation_deg, p.sky_turbidity, p.ambient_skylight);

test("sun_cosine 0 hands the shader atm.sun bit for bit — on every camera, at every elevation (the factor is exactly 1, and x·1 is exact)", () => {
  for (const [cam, over] of Object.entries(CAM_OVER)) {
    const r = renderRig({ ...over, sun_cosine: 0 });
    for (const el of ELEVS) {
      r.params.sun_elevation_deg = el; r.params.sun_azimuth_deg = 62;
      const up = r.draw(), want = atmSun(r.params).sun;
      expect(up.length, `${cam} ${el}: one sun upload`).toBe(1);
      for (let c = 0; c < 3; c++) expect(Object.is(up[0][c], want[c]), `${cam} ${el}° channel ${c}: ${up[0][c]} vs ${want[c]}`).toBe(true);
    }
  }
});

test("sun_cosine 1 scales the beam by the receiver's incidence — floor sin el, tent sin el, cloth |sunDir.y| — and the sky view takes 1", () => {
  for (const [cam, over] of Object.entries(CAM_OVER)) {
    const r = renderRig({ ...over, sun_cosine: 1 });
    for (const el of [...LOW_SUN, 4, 12, 26, 55, 70]) {
      r.params.sun_elevation_deg = el; r.params.sun_azimuth_deg = 62;
      const up = r.draw(), want = atmSun(r.params).sun, I = sunIncidence(cam, el, 62);
      for (let c = 0; c < 3; c++) expect(up[0][c], `${cam} ${el}° channel ${c}`).toBeCloseTo(want[c] * I, 12);
      if (cam === "sky") for (let c = 0; c < 3; c++) expect(Object.is(up[0][c], want[c]), `sky ${el}° channel ${c}: f.sunIrr is exactly 1`).toBe(true);
    }
  }
  const r = renderRig({ sun_cosine: 1, sun_elevation_deg: 26 });
  expect(r.draw()[0][0]).toBeCloseTo(atmSun(r.params).sun[0] * 0.438, 3);   // park 1's number
});

test("an interior sun_cosine is a blend of the old beam and the law, and the skylight is never touched by it", () => {
  const r = renderRig({ sun_cosine: 0.25, sun_elevation_deg: 26 });
  const up = r.draw(), want = atmSun(r.params).sun, I = Math.sin(26 * DEG);
  for (let c = 0; c < 3; c++) expect(up[0][c]).toBeCloseTo(want[c] * (0.75 + 0.25 * I), 12);
  const amb = r.ambient()[0], wantAmb = atmSun(r.params).ambient;
  for (let c = 0; c < 3; c++) expect(Object.is(amb[c], wantAmb[c]), `ambient ${c} is atm.ambient, untouched`).toBe(true);
  const on = renderRig({ sun_cosine: 1, sun_elevation_deg: 26 }); on.draw();
  for (let c = 0; c < 3; c++) expect(Object.is(on.ambient()[0][c], wantAmb[c]), `ambient ${c} at 1`).toBe(true);
});

// The neighbouring uploads clamp their knobs to the documented range (canopy_fill, vignette): past 1 the blend 1 + (I - 1)·c turns the sun colour negative, and below 0 it overshoots the old beam. The upload and
// the fill's S read the same knob, so both hold the line: 2 lands where 1 does and -1 where 0 does, bit for bit (clamp is exact at both ends).
test("sun_cosine is read clamped to 0..1 at the upload: 2 lands the factors of 1, -1 those of 0, on every camera", () => {
  for (const [cam, over] of Object.entries(CAM_OVER)) {
    for (const el of [12, 26, 55]) {
      const at = (c) => { const r = renderRig({ ...over, sun_elevation_deg: el, sun_azimuth_deg: 62, sun_cosine: c }); return r.draw()[0]; };
      for (const [over1, in1] of [[2, 1], [-1, 0]]) {
        const a = at(over1), b = at(in1);
        for (let c = 0; c < 3; c++) expect(Object.is(a[c], b[c]), `${cam} ${el}° channel ${c}: sun_cosine ${over1} gave ${a[c]}, ${in1} gives ${b[c]}`).toBe(true);
      }
    }
  }
  const r2 = renderRig({ sun_cosine: 2, sun_elevation_deg: 26 });
  for (const v of r2.draw()[0]) expect(v, "no negative sun colour").toBeGreaterThan(0);
});

test("komorebi-render.js: the head uploader scales atm.sun by f.sunIrr, and that is the only place the factor is read", () => {
  const code = read("komorebi-render.js").split("\n").map((l) => l.replace(/\/\/.*$/, ""));
  const sunLines = code.filter((l) => l.includes("atm.sun"));
  expect(sunLines.length, "atm.sun is read once").toBe(1);
  expect(sunLines[0].includes("u.sun") && sunLines[0].includes("f.sunIrr")).toBe(true);
  expect(code.filter((l) => l.includes("u.ambient"))[0].includes("sunIrr"), "the skylight is not scaled").toBe(false);
  const defs = code.filter((l) => l.includes("sunIrr") && !l.includes("u.sun"));
  expect(defs.length, "f.sunIrr is computed once, beside the atmosphere, and read nowhere else").toBe(1);
  expect(defs[0].includes("sunIncidence(cam,") && defs[0].includes("params.sun_cosine")).toBe(true);
});

// ---- the gate and its class ------------------------------------------------------------------------------------------------
test("sun_cosine: 0 in DEFAULTS, MORPH class (a live uniform scale and a fill re-run, no bake), none of the others, and not a FEATURE", () => {
  expect(DEFAULTS.sun_cosine).toBe(0);
  expect(MORPH_KEYS).toContain("sun_cosine");
  for (const [name, set] of Object.entries({ CANOPY_KEYS, SEASON_KEYS, TOPO_KEYS, MODE_KEYS })) expect(set.includes("sun_cosine"), name).toBe(false);
  for (const [name, f] of Object.entries(FEATURES)) expect(f.open({ ...DEFAULTS, sun_cosine: 1 }), `${name} is not opened by sun_cosine`).toBe(f.open({ ...DEFAULTS }));   // there is no GLSL to cut
  for (const [name, p] of Object.entries(PRESETS)) expect(p.sun_cosine ?? 0, `${name} ships with the law off`).toBe(0);
});

// ---- the fill: the leaves are lit by their own sin el, and S has to notice a live change --------------------------------------
function fillRig(over = {}) {
  let draws = 0; const calls = [];
  const gl = new Proxy({}, { get: (_t, name) => (/^[A-Z][A-Z0-9_]+$/.test(name) ? name : (...a) => { if (name === "drawArrays") draws++; calls.push([name, ...a]); return name === "checkFramebufferStatus" ? "FRAMEBUFFER_COMPLETE" : {}; }) });
  const params = { ...DEFAULTS, canopy_fill: 1, sun_elevation_deg: 26, ...over };
  const fill = { tex: [null, null], res: 0, ready: false, sig: new Float64Array(FILL_SIG_LEN), K: 0, rays: null, ox: 0, oy: 0, ext: 1 };
  const U = new Proxy({}, { get: (_t, name) => (name === "layers" ? [0, 1, 2, 3] : name) });
  const hub = {
    gl, params, fill, fillFBO: {}, emptyVAO: {}, bakeRes: () => 256, faithfulOn: () => false, faith: {}, layerTex: [{}, {}, {}, {}], layerSize: 256,
    makeLayerTexture: () => ({}), layerHeights: () => [2, 3, 4, 5], bulkOn: () => false, bulkShift: () => [0, 0], fillFor: () => ({ prog: {}, U }),
    allocLayers() {}, bakeLayers() {}, fillFrameNow: () => ({ ox: -5, oy: -5, ext: 10 }), fail(m) { throw new Error(m); },
  };
  return { f: makeFill(hub), params, fill, draws: () => draws, sun: () => calls.filter((c) => c[0] === "uniform3f" && c[1] === "sun").map((c) => c.slice(2)) };
}

test("fillSig notices sun_cosine: a change re-bakes the fill once, an unrelated key (exposure) does not, and the slot is the last of FILL_SIG_LEN", () => {
  const r = fillRig();
  r.f.refreshFill();
  expect(r.fill.ready).toBe(true);
  expect(r.fill.sig.length, "the signature array has room for the slot").toBe(FILL_SIG_LEN);
  expect(FILL_SIG_LEN, "slot 14 is sun_cosine, so the array holds 15").toBe(15);
  expect(r.fill.sig[14], "sun_cosine 0").toBe(0);
  const base = r.draws();
  r.f.refreshFill();
  expect(r.draws(), "nothing moved: no bake").toBe(base);
  r.params.exposure = 2; r.f.refreshFill();
  expect(r.draws(), "exposure is not in the signature").toBe(base);
  r.params.sun_cosine = 1; r.f.refreshFill();
  expect(r.draws(), "sun_cosine 1: one bake").toBe(base + 1);
  expect(r.fill.sig[14]).toBe(1);
  r.f.refreshFill();
  expect(r.draws(), "...once").toBe(base + 1);
  r.params.sun_cosine = 0.4; r.f.refreshFill();
  expect(r.draws(), "a tween step re-bakes too").toBe(base + 2);
  expect(r.fill.sig[14]).toBe(0.4);
});

test("the fill's S is lit by the leaf's own sin el, whatever the receiver: atm.sun x mix(1, sin el, sun_cosine) — and exactly atm.sun at 0", () => {
  for (const over of [{}, { receiver: 1 }, { receiver: 2 }]) {
    for (const el of [...LOW_SUN, 7, 26, 45]) {
      const off = fillRig({ ...over, sun_elevation_deg: el, sun_cosine: 0 }); off.f.refreshFill();
      const want = atmSun(off.params).sun;
      for (let c = 0; c < 3; c++) expect(Object.is(off.sun()[0][c], want[c]), `receiver ${over.receiver ?? 0} ${el}° channel ${c} at 0`).toBe(true);
      const on = fillRig({ ...over, sun_elevation_deg: el, sun_cosine: 1 }); on.f.refreshFill();
      for (let c = 0; c < 3; c++) expect(on.sun()[0][c], `receiver ${over.receiver ?? 0} ${el}° channel ${c} at 1`).toBeCloseTo(want[c] * Math.max(Math.sin(el * DEG), 0), 12);
    }
  }
  const half = fillRig({ sun_elevation_deg: 26, sun_cosine: 0.5 }); half.f.refreshFill();
  expect(half.sun()[0][1]).toBeCloseTo(atmSun(half.params).sun[1] * (0.5 + 0.5 * Math.sin(26 * DEG)), 12);
});

test("sun_cosine is read clamped to 0..1 at the fill's S too: 2 lands the S of 1, -1 that of 0, bit for bit", () => {
  for (const over of [{}, { receiver: 1 }, { receiver: 2 }]) {
    for (const el of [12, 26, 55]) {
      const at = (c) => { const r = fillRig({ ...over, sun_elevation_deg: el, sun_cosine: c }); r.f.refreshFill(); return r.sun()[0]; };
      for (const [over1, in1] of [[2, 1], [-1, 0]]) {
        const a = at(over1), b = at(in1);
        for (let c = 0; c < 3; c++) expect(Object.is(a[c], b[c]), `receiver ${over.receiver ?? 0} ${el}° channel ${c}: sun_cosine ${over1} gave ${a[c]}, ${in1} gives ${b[c]}`).toBe(true);
      }
    }
  }
});

// ---- no GLSL: off is byte-identical by construction -------------------------------------------------------------------------
const stripGlslComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
test("no GLSL literal names sun_cosine or sunIrr in code (a comment may name the knob): the law is a CPU scale of uSunColor", () => {
  const programs = TRANSPORT_CAMERAS.map((c) => [`assembled ${c}`, buildTransport(c)]);
  for (const f of readdirSync(new URL(".", import.meta.url)).filter((n) => /^komorebi.*\.js$/.test(n))) {
    const text = read(f);
    for (const m of text.matchAll(/^const ((?:VS|FS|GLSL)_[A-Z0-9_]*) = `/gm)) {
      const start = m.index + m[0].length;
      programs.push([`${f} ${m[1]}`, text.slice(start, text.indexOf("`", start))]);
    }
  }
  expect(programs.length).toBeGreaterThan(20);
  for (const [name, src] of programs) expect(/sun_?cosine|sunirr/i.test(stripGlslComments(src)), `${name} reads the knob`).toBe(false);
  // ...and the beam's lines are the ones they always were, character for character (the registry tests hold the same; this is the law's own pin)
  expect(buildTransport("floor")).toContain("col = (acc*uSunColor + uAmbient) * uGround;");
  for (const cam of ["cloth", "enclosure"]) expect(buildTransport(cam)).toContain("E = acc*uSunColor*beamF + uAmbient*skyF;");
});

test("the tent's per-panel comment no longer claims the floor and curtain absorb sin(elevation); it says beamF is relative to a horizontal panel and where the sin el arrives", () => {
  const flat = read("komorebi-transport.js").replace(/\s*\n\s*\/\/\s*/g, " ");
  expect(/already absorb\s+sin\(elevation\)/i.test(flat), "the false premise").toBe(false);
  const at = flat.indexOf("PER-PANEL LIGHT");
  expect(at).toBeGreaterThan(0);
  const para = flat.slice(at, flat.indexOf("beamF = clamp(", at));
  expect(/relative to a horizontal/i.test(para)).toBe(true);
  expect(para.includes("uSunColor") && para.includes("sun_cosine")).toBe(true);
});

// beamF·sin el is dot(n, sun) only while beamF's two limits are clear of it, and the sentence that said "exactly above the divisor floor ... at every elevation" was false in both: the cap at 2 binds on a panel
// turned into a sun below 30° (the true dot is 1, the cap lands 2·sin el: 0.845 at 25°, 0.416 at 12°), and the 0.15 floor binds below ≈8.6° on EVERY panel, the crown included (it lands sin el/0.15 of the floor's
// level, so it is anchored to the floor only above that). Three places say it (the table's own comment, the shader's, the spec's §4.9), and each has to name both limits and say tent 1 (55°) clears them.
test("the tent claim names both of beamF's limits wherever it is made — the math table, the shader's PER-PANEL LIGHT comment and the spec's §4.9 — and no longer says 'at every elevation'", () => {
  const flat = (t) => t.replace(/\s*\n\s*(\/\/)?\s*/g, " ");
  const math = read("komorebi-math.js"), transport = read("komorebi-transport.js"), spec = read("komorebi-spec.md");
  const mAt = math.indexOf("//   enclosure"), tAt = transport.indexOf("PER-PANEL LIGHT"), sAt = spec.indexOf("The normalization is the load-bearing part");
  expect(mAt, "the table's enclosure row").toBeGreaterThan(0); expect(tAt, "the shader's comment").toBeGreaterThan(0); expect(sAt, "the spec's §4.9 paragraph").toBeGreaterThan(0);
  const paras = {
    "komorebi-math.js": flat(math.slice(mAt, math.indexOf("//   cloth", mAt))),
    "komorebi-transport.js": flat(transport.slice(tAt, transport.indexOf("beamF = clamp(", tAt))),
    "komorebi-spec.md": spec.slice(sAt, spec.indexOf("\n\n", sAt)),
  };
  for (const [where, para] of Object.entries(paras)) {
    expect(/every elevation/i.test(para), `${where} still claims the crown holds at every elevation`).toBe(false);
    expect(para.includes("0.845") && para.includes("0.416"), `${where} names the cap at 2 (0.845 at 25°, 0.416 at 12°)`).toBe(true);
    expect(/sin(?:\(el\)| el)\/0\.15/.test(para) && para.includes("8.6"), `${where} names the 0.15 floor (below ≈8.6° every panel lands sin el/0.15 of its dot)`).toBe(true);
    expect(/tent 1/.test(para) && para.includes("55°"), `${where} says tent 1 (55°) is clear of both`).toBe(true);
  }
});

// A code span does not shield a pipe in a GFM table: §3.5's cloth row once read `cos el·|sin az|` and the row split into seven cells, so the incidence table rendered with its last row's law cut off. Every table in the
// spec holds its header's cell count in every row (a pipe inside a cell is written \|).
test("the spec's pipe tables render: every row has the header's cell count, so a pipe inside a code span is escaped (§3.5's cloth row)", () => {
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;
  const blocks = []; let cur = [];
  for (const l of read("komorebi-spec.md").split("\n")) { if (/^\s*\|/.test(l)) cur.push(l); else if (cur.length) { blocks.push(cur); cur = []; } }
  if (cur.length) blocks.push(cur);
  expect(blocks.length, "the spec's tables").toBeGreaterThanOrEqual(5);
  for (const b of blocks) for (const row of b) expect(cells(row), `a table row of '${b[0].trim().slice(0, 40)}...' splits into ${cells(row)} cells, the header's are ${cells(b[0])}: ${row.trim().slice(0, 80)}`).toBe(cells(b[0]));
  const cloth = blocks.flat().find((l) => l.includes("cloth (the curtain)"));
  expect(cloth, "the incidence table's cloth row").toBeDefined();
  expect(cloth.includes("\\|sin az\\|") && cloth.includes("\\|sunDir.y\\|"), "both of its pipe pairs are escaped").toBe(true);
});

test("foldIncidence's comment says it is relative to the flat cloth and that the flat cloth's own sy arrives with uSunColor", () => {
  const src = read("komorebi-transport.js");
  const head = src.slice(src.indexOf("// FOLD INCIDENCE (spec §4.9)"), src.indexOf("float foldIncidence("));
  expect(head.length).toBeGreaterThan(100);
  expect(/relative to the flat cloth/i.test(head.replace(/\s*\n\s*\/\/\s*/g, " "))).toBe(true);
  expect(head.includes("uSunColor") && head.includes("sun_cosine")).toBe(true);
});

// ---- the editor ------------------------------------------------------------------------------------------------------------------
test("the editor offers it: a row right after the azimuth, in a group the surface cameras speak and the sky view does not, and a help text in the editor's voice", () => {
  const src = read("editor.js");
  const row = src.indexOf("['s','sun_cosine','cosine',0,1,0.01,'']"), az = src.indexOf("['s','sun_azimuth_deg'");
  expect(row, "the row").toBeGreaterThan(-1);
  expect(row).toBeGreaterThan(az);
  expect(row - az, "right after sun_azimuth_deg").toBeLessThan(120);
  const group = src.match(/\bsun_cosine:'(\w+)'/)?.[1];
  expect(group, "its CAM_GROUP entry").toBeDefined();
  for (const cam of ["floor", "cloth", "enclosure"]) expect(CAMERAS[cam].groups, `${cam} speaks ${group}`).toContain(group);
  expect(CAMERAS.sky.groups, "the sky view never reads it, so its row is hidden there").not.toContain(group);
  const help = src.match(/\n {2}sun_cosine:"(<b>[^\n]*)",?\n/)?.[1];
  expect(help, "its help").toBeDefined();
  expect(/noon/.test(help) && /dusk/.test(help), "the day brightens to noon and dims to dusk").toBe(true);
  expect(/exposure/.test(help) && /2\.3/.test(help), "a look that turns it on re-sits its exposure, about x2.3 at 26 degrees").toBe(true);
  expect(/sun you see/i.test(help), "the sun you see is unchanged").toBe(true);
});
