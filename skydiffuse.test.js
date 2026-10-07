// ============================================================================
// The leaf is a lantern, not a window (spec §4.9, P0c-sky). Looking UP at a backlit leaf you see its diffuse transmission, a
// glowing lamina, never the sun's disk through it. With leaf_diffuse d the disk is the BALLISTIC share only (a leaf kills it),
// and the light the leaf took out of the line of sight reappears as that leaf's glow: the canopy as sunglasses, with leaks
// through the gaps. Per eye ray, per channel (w = the layer-stamped wood; W = the analytic wood the camera multiplies on):
//
//   T_sky = Π t·w         the sky: diffuse ≡ ballistic for a uniform sky          acc = T_sky
//   T_src = Π tb·w        the disk: collimated, so a leaf kills it                srcSeen = sun·L_disk·T_src
//   A_L   = Π_{M>L} tb_M·w_M      the sun on layer L, along the sun's ray, ballistic, through wood
//   thr_L = Π_{M<L} t_M·w_M       the glow descending to the eye: diffuse through leaves, blocked by wood
//   glow  = Σ thr_L·(t_L − tb_L)·sun·A_L     (the wood never glows: it is in thr and A, never in t − tb)
//
// komorebi-fill.js is the reference the pixel harness holds the shader to; these tests hold the reference to the laws, and the
// strings to the contracts that would otherwise fail silently (a gate that is not the old frame, wood read from the wrong place).
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULTS, CAMERAS, TRANSPORT_GROUPS, GROUP_UPLOAD_KEYS, TRANSPORT_CAMERAS, buildTransport } from "./komorebi.js";
import * as M from "./komorebi-math.js";
import * as F from "./komorebi-fill.js";
import { FS_FILL, FS_FAITH_SEG, GLSL_SKY_RAY } from "./komorebi-shaders.js";

const H4 = [2, 3, 4, 5];
const SUN = [1.1, 0.95, 0.8];
const hash = M.hash3;
const u01 = (seed, c, cx, cy, L) => hash(seed * 8 + c, cx * 31 + L, cy) / 4294967296;
const code = (s) => s.replace(/\/\/.*$/gm, "");
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

// A layer is { h, t(x, y) -> [r,g,b], c(x, y) -> coverage, w?(x, y) -> the stamped wood's transmittance }: what a baked texel holds
// (rgb = the leaf's true depth as t, alpha = Σ coverage) and what the wood's own R16F texel holds. No w = no wood read (the fill).
const stack = (seed, nL = 3, wood = false) => H4.slice(0, nL).map((h, L) => ({
  h,
  t: (x, y) => { const cx = Math.floor(x * 7), cy = Math.floor(y * 7); return [0, 1, 2].map((c) => 0.05 + 0.95 * u01(seed, c, cx, cy, L)); },
  c: (x, y) => 2 * u01(seed, 3, Math.floor(x * 7), Math.floor(y * 7), L),
  ...(wood ? { w: (x, y) => 0.1 + 0.9 * u01(seed, 5, Math.floor(x * 7), Math.floor(y * 7), L) } : {}),
}));
const kOf = (seed) => M.ballisticK((hash(seed, 7, 7) % 1000) / 1000);          // d anywhere in [0, 0.999]
const pt = (seed, a) => [(hash(seed, a, 0) % 4000) / 1000 - 2, (hash(seed, a, 1) % 4000) / 1000 - 2];
const dir = (seed, a) => [((hash(seed, a, 0) % 3000) - 1500) / 1000, ((hash(seed, a, 1) % 3000) - 1500) / 1000];   // a plan travel per metre of rise, up to ~56° off the zenith
const zero = [0, 0, 0];

// ---- the eye-ray identity ------------------------------------------------------------------------------------------
test("THE EYE-RAY IDENTITY: when the eye ray IS the sun's ray, Π tb + Σ thr·(t − tb)·A = Π t, to 1e-12, over 10^4 random stacks and any d", () => {
  // The eye ray reads layer i at p + s·h_i, and the sun's path from there to layer M at p + s·h_i + g·(h_M − h_i). With g = s those
  // are the SAME points, so A_L is the product of the very taps the ray itself passes and Q_L = Π_{M≤L} t · Π_{M>L} tb telescopes
  // from Π tb to Π t, one layer per term. Wood is factored out of both sides (a stack with none): see the wood laws below.
  let worst = 0, glowing = 0, shut = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const k = kOf(seed), layers = stack(seed, 1 + (seed % 4)), s = dir(seed, 21);
    const r = F.skyRayRef(layers, pt(seed, 19), s, s, [1, 1, 1], k);
    if (!(k > 0)) { shut++; expect(r.Tb, `seed ${seed}: tb is t at d = 0`).toEqual(r.T); continue; }
    for (let c = 0; c < 3; c++) {
      worst = Math.max(worst, Math.abs(r.Tb[c] + r.L[c] - r.T[c]));
      expect(r.L[c], `seed ${seed}`).toBeGreaterThanOrEqual(0);
      glowing += r.L[c];
    }
  }
  expect(worst).toBeLessThan(1e-12);
  expect(glowing).toBeGreaterThan(100);                                      // not vacuous: the stacks really do glow
  expect(shut).toBeGreaterThan(0);                                           // ...and the d = 0 stacks are in the sweep too
});

test("off the sun's ray the glow is bounded by the light the leaves took out of the beam, never by Π t − Π tb: 0 ≤ glow ≤ Σ thr·(t − tb)·sun", () => {
  // Any eye direction, any sun path (A ≤ 1 is all that is known of it). Spelled out here without skyRayRef's own loop.
  let slack = 0;
  for (let seed = 0; seed < 4000; seed++) {
    const k = kOf(seed) || 2, layers = stack(seed, 2 + (seed % 3)), p = pt(seed, 19), s = dir(seed, 21), g = dir(seed, 23);
    const r = F.skyRayRef(layers, p, s, g, SUN, k);
    const at = layers.map((l) => [p[0] + s[0] * l.h, p[1] + s[1] * l.h]), t = layers.map((l, L) => l.t(...at[L])), cov = layers.map((l, L) => l.c(...at[L]));
    const thr = [1, 1, 1], cap = [0, 0, 0];
    layers.forEach((_l, L) => { for (let c = 0; c < 3; c++) { cap[c] += thr[c] * t[L][c] * (1 - Math.exp(-k * cov[L])) * SUN[c]; thr[c] *= t[L][c]; } });
    for (let c = 0; c < 3; c++) {
      expect(r.L[c], `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(r.L[c], `seed ${seed}`).toBeLessThanOrEqual(cap[c] + 1e-12);
      expect(r.Tb[c], `seed ${seed}: the disk is never brighter than the sky`).toBeLessThanOrEqual(r.T[c]);
      slack += cap[c] - r.L[c];
    }
  }
  expect(slack).toBeGreaterThan(1);                                          // the bound is not an equality in disguise: a sun path that differs from the eye ray loses light to its own leaves
});

test("what does NOT hold off the sun's ray: Π tb + glow can exceed Π t — a lit leaf seen through a dense leaf BESIDE the sun's path", () => {
  // The telescoping bound is an identity along ONE line. Take two layers: the lower leaf (h 2) is lit by the sun through a GAP in the
  // upper layer, and the eye looks at it through a dense leaf in the upper layer, at another plan point. Both are in the model: the
  // sun's path to the lower leaf is clear (A = 1), the eye ray's own beam is nearly dead. The glow is real light — a lit leaf IS
  // visible through a leaf in front of it — and it is more than the eye ray's Π t − Π tb, which counts the SAME column both ways.
  const k = M.ballisticK(0.95);
  const layers = [
    { h: 2, t: () => [0.5, 0.5, 0.5], c: () => 1 },
    { h: 3, t: () => [1, 1, 1], c: (x) => (x < 0.5 ? 3 : 0) },              // dense at the eye's point (x 0), a gap at the sun's (x 1)
  ];
  const r = F.skyRayRef(layers, [0, 0], [0, 0], [1, 0], [1, 1, 1], k);   // sun path: from layer 0 up through the gap: x = 0 + 1·(3 − 2)
  const t0 = 0.5, tb0 = 0.5 * Math.exp(-k), tb1 = Math.exp(-3 * k);
  expect(r.T[0]).toBeCloseTo(0.5, 14);
  expect(r.Tb[0]).toBeCloseTo(tb0 * tb1, 14);
  const over = r.Tb[0] + r.L[0] - r.T[0];
  expect(over).toBeCloseTo((t0 - tb0) * (1 - tb1), 12);                      // the surplus is exactly the lower leaf's glow, unbleached by the sun's clear path
  expect(over).toBeGreaterThan(0.3);
});

test("a wood-only ray emits exactly 0 — at any d, at any sky_scatter — and wood only ever takes light away", () => {
  const k = M.ballisticK(0.95);
  const bare = (seed) => H4.slice(0, 3).map((h, L) => ({ h, t: () => [1, 1, 1], c: () => 0, w: (x, y) => 0.05 + 0.9 * u01(seed, 5, Math.floor(x * 7), Math.floor(y * 7), L) }));
  for (let seed = 0; seed < 300; seed++) {
    const layers = bare(seed), p = pt(seed, 3), s = dir(seed, 5), g = dir(seed, 7);
    for (const kk of [0, k]) {
      const r = F.skySeenRef(layers, p, s, g, { sun: SUN, ambient: [1, 1, 1], disk: 2, k: kk, skyScatter: 1, wood: 0.4 });
      expect(r.glow, `seed ${seed} k ${kk}`).toEqual(zero);
      expect(r.proxy, `seed ${seed} k ${kk}`).toEqual(zero);
    }
  }
  // and wood is a pure attenuator on everything the ray carries: the same stack with wood is ≤ the same without it, per channel
  for (let seed = 0; seed < 600; seed++) {
    const kk = kOf(seed) || 2, leaf = stack(seed, 1 + (seed % 4)), wood = stack(seed, 1 + (seed % 4), true), p = pt(seed, 3), s = dir(seed, 5), g = dir(seed, 7);
    const a = F.skyRayRef(leaf, p, s, g, SUN, kk), b = F.skyRayRef(wood, p, s, g, SUN, kk);
    const W = wood.reduce((w, l) => w * l.w(p[0] + s[0] * l.h, p[1] + s[1] * l.h), 1);
    for (let c = 0; c < 3; c++) {
      expect(b.T[c], `seed ${seed}`).toBeCloseTo(a.T[c] * W, 12);          // the ray's own transmittances take the wood as one factor...
      expect(b.Tb[c], `seed ${seed}`).toBeCloseTo(a.Tb[c] * W, 12);
      expect(b.L[c], `seed ${seed}`).toBeLessThanOrEqual(a.L[c] + 1e-12);   // ...and the glow can only lose
    }
  }
});

test("glow ≡ 0 at k = 0, by identity: tb is t itself, and the lantern term is exactly nothing whatever sky_scatter says", () => {
  const t = [0.3, 0.6, 0.1];
  expect(F.ballistic(t, 1.7, 0)).toBe(t);                                    // tb = t: the input comes back, not an equal copy
  for (let seed = 0; seed < 400; seed++) {
    const layers = stack(seed, 1 + (seed % 4), seed % 2 === 0), p = pt(seed, 3), s = dir(seed, 5), g = dir(seed, 7);
    for (const skyScatter of [0, 0.4, 1]) {
      const r = F.skySeenRef(layers, p, s, g, { sun: SUN, ambient: [0.9, 1.1, 1.4], disk: 3, k: 0, skyScatter, wood: 0.8 });
      expect(r.glow, `seed ${seed}`).toEqual(zero);
      expect(r.Tsrc, `seed ${seed}: the disk sees what the sky sees`).toEqual(r.T);
    }
  }
});

test("at d = 0 the composition IS the old one, bit for bit: (ambient + sun·L)·T + sky_scatter·L_scat, wood on every term", () => {
  // FROZEN from the sky camera before this phase: skyRad = (uAmbient*SKY_SKY_GAIN + uSunColor*L) * T + Lsc, with sky_scatter scaling
  // Lsc first and the wood multiplying T and Lsc after. skySeenRef at k = 0 must reproduce it to the last bit.
  const AMB = [7.5 * 0.31, 7.5 * 0.37, 7.5 * 0.52], DISK = 83.7;
  for (let seed = 0; seed < 600; seed++) {
    const layers = stack(seed, 1 + (seed % 4), true), p = pt(seed, 3), s = dir(seed, 5), g = dir(seed, 7), skyScatter = [0, 0.25, 0.5, 1][seed % 4], wood = 0.3 + 0.7 * u01(seed, 6, 1, 1, 0);
    const base = F.skyRayRef(layers, p, s, skyScatter > 0 ? g : null, SUN, 0);
    const T = base.T.map((v) => v * wood), Lsc = base.L.map((v) => (skyScatter > 0 ? v * skyScatter : v) * wood);
    const want = [0, 1, 2].map((c) => (AMB[c] + SUN[c] * DISK) * T[c] + Lsc[c]);
    const got = F.skySeenRef(layers, p, s, g, { sun: SUN, ambient: AMB, disk: DISK, k: 0, skyScatter, wood });
    expect(got.rad, `seed ${seed}`).toEqual(want);
    expect(got.acc).toEqual(T);
  }
});

test("at d > 0 sky_scatter is retired: the frame is one frame whatever it says — and at d = 0 it is a live knob (the control)", () => {
  const AMB = [2.3, 2.8, 3.9], k = M.ballisticK(0.9);
  for (let seed = 0; seed < 300; seed++) {
    const layers = stack(seed, 1 + (seed % 4), true), p = pt(seed, 3), s = dir(seed, 5), g = dir(seed, 7);
    const at = (skyScatter, kk) => F.skySeenRef(layers, p, s, g, { sun: SUN, ambient: AMB, disk: 40, k: kk, skyScatter, wood: 0.7 });
    expect(at(0.5, k), `seed ${seed}`).toEqual(at(0, k));
    expect(at(1, k), `seed ${seed}`).toEqual(at(0, k));
  }
  const layers = stack(5, 3);
  const live = (v) => F.skySeenRef(layers, [0.2, 0.1], [0.3, 0.1], [0.5, 0.2], { sun: SUN, ambient: AMB, disk: 40, k: 0, skyScatter: v, wood: 1 }).rad;
  expect(live(0.5)).not.toEqual(live(0));
});

test("the mesopic cue keeps its meaning: acc is the sky's transmittance and does not move with d", () => {
  for (let seed = 0; seed < 300; seed++) {
    const layers = stack(seed, 1 + (seed % 4), true), p = pt(seed, 3), s = dir(seed, 5), g = dir(seed, 7);
    const at = (kk) => F.skySeenRef(layers, p, s, g, { sun: SUN, ambient: [1, 1, 1], disk: 9, k: kk, skyScatter: 0, wood: 0.6 });
    expect(at(M.ballisticK(0.95)).acc, `seed ${seed}`).toEqual(at(0).acc);
    expect(at(M.ballisticK(0.95)).T, `seed ${seed}`).toEqual(at(0).T);       // the uniform-sky identity: the sky needs no split
  }
});

test("monotone in d along the sun's ray: T_src falls, the glow rises, and their sum stays Π t", () => {
  let moved = 0;
  for (let seed = 0; seed < 300; seed++) {
    const layers = stack(seed, 1 + (seed % 4)), p = pt(seed, 3), s = dir(seed, 5);
    const start = F.skyRayRef(layers, p, s, s, [1, 1, 1], 0);                  // d = 0: tb is t, and the lantern has nothing to say (its L is the P0b proxy, a different term)
    let prevB = start.Tb, prevL = [0, 0, 0];
    for (let i = 1; i <= 40; i++) {
      const r = F.skyRayRef(layers, p, s, s, [1, 1, 1], M.ballisticK(i / 41));
      for (let c = 0; c < 3; c++) {
        expect(r.Tb[c] + r.L[c], `seed ${seed} d ${i / 41}`).toBeCloseTo(r.T[c], 12);
        expect(r.Tb[c], `seed ${seed} d ${i / 41}`).toBeLessThanOrEqual(prevB[c] + 1e-15);
        expect(r.L[c], `seed ${seed} d ${i / 41}`).toBeGreaterThanOrEqual(prevL[c] - 1e-15);
      }
      prevB = r.Tb; prevL = r.L;
    }
    if (prevL[1] > 1e-3 && prevB[1] < start.Tb[1]) moved++;
  }
  expect(moved).toBeGreaterThan(250);                                         // the sweep really moves something: it is not a monotone constant
});

test("sunglasses with leaks: one unit of coverage keeps (1−d) of the disk and gives its glow; a gap keeps all of it", () => {
  const d = 0.95, k = M.ballisticK(d), t = [0.2, 0.6, 0.1];
  const leaf = [{ h: 3, t: () => t, c: () => 1 }], gap = [{ h: 3, t: () => [1, 1, 1], c: () => 0 }];
  const a = F.skySeenRef(leaf, [0, 0], [0, 0], [0, 0], { sun: [1, 1, 1], ambient: [0, 0, 0], disk: 10, k, wood: 1 });
  for (let c = 0; c < 3; c++) {
    expect(a.Tsrc[c]).toBeCloseTo(t[c] * (1 - d), 14);                       // the disk sees the ballistic share only, in the leaf's own hue
    expect(a.glow[c]).toBeCloseTo(t[c] * d, 14);                              // and the rest is the leaf's glow at the level d·T
    expect(a.srcSeen[c]).toBeCloseTo(10 * t[c] * (1 - d), 12);
  }
  const b = F.skySeenRef(gap, [0, 0], [0, 0], [0, 0], { sun: [1, 1, 1], ambient: [0, 0, 0], disk: 10, k, wood: 1 });
  expect(b.Tsrc).toEqual(b.T);                                                // a gap passes the whole disk...
  expect(b.glow).toEqual(zero);                                               // ...and has nothing to glow
  expect(b.srcSeen).toEqual([10, 10, 10]);
});

test("srcSeen is the leaked disk ALONE and is added last: rad = (sky + glow) + srcSeen", () => {
  const AMB = [2.3, 2.8, 3.9], k = M.ballisticK(0.95);
  for (let seed = 0; seed < 200; seed++) {
    const layers = stack(seed, 3, true), p = pt(seed, 3), s = dir(seed, 5), g = dir(seed, 7);
    const r = F.skySeenRef(layers, p, s, g, { sun: SUN, ambient: AMB, disk: 55, k, wood: 0.9 });
    const sky = [0, 1, 2].map((c) => AMB[c] * r.T[c] + r.glow[c]);
    expect(r.rad, `seed ${seed}`).toEqual([0, 1, 2].map((c) => sky[c] + r.srcSeen[c]));   // the order is the contract: a later phase takes srcSeen out of this sum
    expect(r.srcSeen, `seed ${seed}`).toEqual([0, 1, 2].map((c) => SUN[c] * 55 * r.Tsrc[c]));
  }
});

// ---- the shaders: the gate is the old expression, character for character --------------------------------------------
const sky = buildTransport("sky");
const skyCode = code(sky);

test("the sky camera's d = 0 composition is the literal old line, in the else of a uniform branch on the beam's k", () => {
  expect(sky.includes("skyRay(pL0, pL1, pL2, pL3, uSunDir.xy / max(uSunDir.z, 0.05), uSkyScatter > 0.0 || uBeamK > 0.0, true, true, uBeamK, T, Tsrc, Lsc);")).toBe(true);
  expect(/if\(uBeamK > 0\.0\)\{[^}]*\}\s*else\s*\{\s*skyRad = \(uAmbient\*SKY_SKY_GAIN \+ uSunColor\*L\) \* T \+ Lsc;/.test(skyCode)).toBe(true);
  expect(skyCode.includes("if(uBeamK <= 0.0 && uSkyScatter > 0.0) Lsc *= uSkyScatter;")).toBe(true);   // the retired proxy: the old line, gated off above 0
  expect(skyCode.includes("acc = T;")).toBe(true);                                                       // the mesopic cue is the sky's, at every d
});

test("srcSeen is its own named variable and is composed LAST — never folded into skyRad earlier", () => {
  expect(skyCode.match(/\bsrcSeen\b/g).length).toBe(2);                       // declared once, added once, named nowhere else
  expect(skyCode.includes("vec3 srcSeen = uSunColor*L*Tsrc;")).toBe(true);
  const writes = [...skyCode.matchAll(/skyRad\s*(\+?=)[^;]*;/g)].map((m) => m[0]);
  expect(writes.filter((w) => w.includes("srcSeen"))).toEqual(["skyRad += srcSeen;"]);   // the only write that names it
  const lantern = skyCode.indexOf("skyRad = uAmbient*SKY_SKY_GAIN*T + Lsc;");
  expect(lantern).toBeGreaterThan(0);
  expect(skyCode.indexOf("skyRad += srcSeen;")).toBeGreaterThan(lantern);
  expect(skyCode.indexOf("skyRad += srcSeen;")).toBeGreaterThan(skyCode.indexOf("vec3 srcSeen"));
});

test("the fill passes readWood = false and the sky camera true; the wood is its own texture (tapSky), never alpha", () => {
  expect(FS_FILL.includes("uFillG, scatter, uFillOpen, false, uFillBeamK, T, Tb, Lsc);")).toBe(true);
  expect(sky.includes("uSkyScatter > 0.0 || uBeamK > 0.0, true, true, uBeamK, T, Tsrc, Lsc);")).toBe(true);
  expect(GLSL_SKY_RAY.includes("void tapSky(highp sampler2D layer, highp sampler2D wood, vec2 world, bool openOutside, bool readWood, out vec3 t, out float c, out float w){")).toBe(true);
  expect(GLSL_SKY_RAY.includes("tapSky(uLayer[0], uWood[0], pL0, openOutside, readWood,")).toBe(true);
  expect(code(GLSL_SKY_RAY).includes("exp(-d.a)")).toBe(false);               // alpha is coverage everywhere now
  for (const dead of ["tapUpLW", "woodInAlpha"]) { expect(GLSL_SKY_RAY.includes(dead), dead).toBe(false); expect(sky.includes(dead), dead).toBe(false); expect(FS_FILL.includes(dead), dead).toBe(false); }
});

test("the wood samplers are the sky camera's alone: no floor, cloth or tent program declares or reads them", () => {
  expect(skyCode.includes("uniform highp sampler2D uWood[4];")).toBe(true);
  for (const cam of TRANSPORT_CAMERAS.filter((c) => c !== "sky")) expect(buildTransport(cam).includes("uWood"), cam).toBe(false);
  for (const [name, g] of Object.entries(TRANSPORT_GROUPS)) if (name !== "sky") expect(g.decls.includes("uWood"), name).toBe(false);
  expect(TRANSPORT_GROUPS.sky.decls.includes("uWood")).toBe(true);
  expect(Object.keys(TRANSPORT_GROUPS.sky.locs)).toEqual(expect.arrayContaining(["beamK", "woods"]));
  expect(TRANSPORT_GROUPS.sky.locs.woods).toEqual(["uWood[0]", "uWood[1]", "uWood[2]", "uWood[3]"]);
  expect(GROUP_UPLOAD_KEYS).toContain("sky");
  expect(CAMERAS.sky.groups).toContain("sky");
});

test("both programs that run the shared ray declare the wood field with the SAME line (the fill reads none: readWood is its literal false)", () => {
  expect(FS_FILL.includes("uniform highp sampler2D uWood[4];")).toBe(true);
  expect(sky.includes("uniform highp sampler2D uWood[4];")).toBe(true);
});

// ---- the data move: coverage in alpha on every bake, the wood in its own R16F texture per layer -------------------------
const bakeSrc = src("komorebi-bake.js"), engineSrc = src("komorebi-engine.js"), renderSrc = src("komorebi-render.js");

test("the leaf bake is the same on every camera: alpha is coverage everywhere, no colour mask for the sky view", () => {
  expect(code(bakeSrc).includes("colorMask")).toBe(false);
});

test("the wood stamp attaches woodTex[l], clears it per layer, and writes frag.r with the same additive blend", () => {
  expect(bakeSrc.includes("hub.woodTex[l]")).toBe(true);
  expect(/framebufferTexture2D\(gl\.FRAMEBUFFER, gl\.COLOR_ATTACHMENT0, gl\.TEXTURE_2D, hub\.woodTex\[l\], 0\);\s*gl\.clearColor\(0,0,0,0\); gl\.clear\(gl\.COLOR_BUFFER_BIT\);/.test(bakeSrc)).toBe(true);
  expect(/if\(uSegTau != 0\)\{ frag = vec4\(uWoodTau\*cov, 0\.0, 0\.0, 0\.0\); return; \}/.test(FS_FAITH_SEG)).toBe(true);
  expect(code(FS_FAITH_SEG).includes("vec4(0.0, 0.0, 0.0, uWoodTau*cov)")).toBe(false);
});

test("the engine allocates woodTex at the layer size iff sky_view (1×1 otherwise), as R16F, and frees and forgets it", () => {
  expect(/makeWoodTexture\(params\.sky_view && i < params\.layer_count \? size : 1\)/.test(engineSrc)).toBe(true);
  expect(/texImage2D\(gl\.TEXTURE_2D,0,gl\.R16F,size,size,0,gl\.RED,gl\.HALF_FLOAT,null\)/.test(engineSrc)).toBe(true);   // half float: the wood's depth is accumulated additively and must be today's half-float bytes
  expect(/hub\.woodTex\.forEach\(t => \{ gl\.deleteTexture\(t\); \}\);/.test(engineSrc.slice(engineSrc.indexOf("dispose()")))).toBe(true);
  expect(/Object\.assign\(hub, \{ layerTex:\[\], woodTex:\[\],/.test(engineSrc)).toBe(true);   // the context-restore path
  expect(renderSrc.includes("hub.woodTex[i]")).toBe(true);                                      // the sky group binds them
});

test("params: none new — leaf_diffuse drives it, and still ships at 0", () => {
  expect(DEFAULTS.leaf_diffuse).toBe(0);
  expect(Object.keys(DEFAULTS).filter((k) => /lantern|sky_(split|diffuse|beam)/i.test(k))).toEqual([]);
});
