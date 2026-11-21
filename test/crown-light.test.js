// ============================================================================
// The light inside a seen crown (spec/model/leaf.md, "A leaf, seen"): four opt-in readings of the tree view's light, each off by default and off the old
// reading. The leaf as tissue (leaf_neutral), the beam through the crown (beam_march), the sky a leaf sees (open_sky), the crown's own light (crown_light).
// They live in GLSL (komorebi-shaders.js GLSL_TREE_LIGHT, carried by FS_TREE and FS_TREE_WOOD); each is mirrored here line for line, and the lines the mirror
// transcribes are held to the shader's own text, so a change to either is caught: the text by the pin, the meaning by the law the mirror is held to.
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULTS, PARAMS } from "../engine/komorebi-params.js";
import { SLAB, SLAB_N, SLAB_NEUTRAL, slabClear, slabLeaf, slabK, slabTable, ballisticK } from "../engine/leaf/komorebi-leaf.js";
import { texelMix } from "../engine/transport/komorebi-fill.js";
import { FS_TREE, FS_TREE_WOOD, FS_CROWN_GRID, defineIn, FS_FILL, FS_FILL_GROUND, FS_FILL_UP, FS_FILL_BOUNCE, GLSL_SKY_RAY } from "../engine/transport/komorebi-shaders.js";
import { TRANSPORT_CAMERAS, buildTransport } from "../engine/transport/komorebi-transport.js";
import { crownGridSize, treeNames } from "../engine/transport/komorebi-tree-view.js";

const TREE = [FS_TREE, FS_TREE_WOOD];   // both carry the tree's light; every pin is held in both
const pin = (line) => { for (const src of TREE) expect(src).toContain(line); };
const lumY = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const oklabHue = ([r, g, b]) => {   // OKLab hue in degrees, for the hue claims
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return Math.atan2(0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 180 / Math.PI;
};
const GOLD = [1.0, 0.6, 0.11];   // the season's carotenoid gold, a fully turned leaf's transmittance (spec/model/season.md)
const clearK = (neutral) => [0, 1, 2].map((c) => -Math.log(slabClear(c, neutral)));   // what the tree view uploads as the clear depth (komorebi-tree-view.js)

// ---- THE LEAF AS TISSUE (leaf_neutral) ----

// texelMixClear, transcribed
function mixClear(tau, c, k, K) {
  if (c < 1e-4) return { T: [1, 1, 1], Tb: [1, 1, 1] };
  const a = Math.min(c, 1), tbar = tau.map((t, i) => t / a + K[i] * (c / a));
  return { T: tbar.map((t) => (1 - a) + a * Math.exp(-t)), Tb: tbar.map((t) => (1 - a) + a * Math.exp(-t - k * c / a)) };
}
test("the tissue mixture is the shader's: the clear depth rides each leaf, c/a leaves deep", () => {
  pin("void texelMixClear(vec3 tau, float c, float k, out vec3 T, out vec3 Tb){");
  pin("  vec3 tbar = tau/a + uClearK*(c/a);");
  pin("  T  = vec3(1.0 - a) + a*exp(-tbar);");
  pin("  Tb = vec3(1.0 - a) + a*exp(-tbar - k*c/a);");
});

test("off, the clear depth is 0 to the bit and the tissue mixture IS texelMix, bit for bit, at any texel and any split", () => {
  const K = clearK(false);
  for (const v of K) expect(v === 0).toBe(true);   // −ln 1: the green fit asks the slab for T as given
  for (let i = 0; i < 2000; i++) {
    const tau = [0.01 + (i % 37) * 0.21, 0.02 + (i % 11) * 0.5, 0.3 + (i % 23) * 0.4], c = (i % 97) / 30, k = [0, 0.5, ballisticK(0.95), 6][i % 4];
    const a = mixClear(tau, c, k, K), b = texelMix(tau, c, k);
    expect(a.T).toEqual(b.T); expect(a.Tb).toEqual(b.Tb);
  }
});

test("on, each leaf passes the clear leaf's share of its pigment's T: one leaf over part of a texel, and leaves stacked, exactly", () => {
  const K = clearK(true), Tc = [0, 1, 2].map((c) => slabClear(c, true)), tau1 = GOLD.map((t) => -Math.log(t)), k = ballisticK(0.95);
  for (const c of [0.1, 0.4, 1]) {                                  // one leaf over c of the texel: the gap passes all, the leaf T_clear·T
    const m = mixClear(tau1.map((t) => t * c), c, k, K);
    for (let i = 0; i < 3; i++) expect(m.T[i]).toBeCloseTo((1 - c) + c * Tc[i] * GOLD[i], 12);
  }
  const two = mixClear(tau1.map((t) => 2 * t), 2, k, K);           // two leaves over the whole texel: the clear loss is paid twice
  for (let i = 0; i < 3; i++) { expect(two.T[i]).toBeCloseTo((Tc[i] * GOLD[i]) ** 2, 12); expect(two.Tb[i]).toBeLessThanOrEqual(two.T[i]); }
});

test("the tissue scatters alike in every channel, and its clear leaf passes about half the light in each", () => {
  const s = SLAB_NEUTRAL.s, g = SLAB.s;
  expect(Math.max(...s) / Math.min(...s)).toBeLessThan(1.05);       // structure, not pigment
  expect(Math.max(...g) / Math.min(...g)).toBeGreaterThan(10);       // where the green fit's scattering carries the leaf's colour
  const Tc = [0, 1, 2].map((c) => slabClear(c, true));
  for (const v of Tc) { expect(v).toBeGreaterThan(0.45); expect(v).toBeLessThan(0.55); }
  expect(Math.max(...Tc) - Math.min(...Tc)).toBeLessThan(0.02);
  for (let c = 0; c < 3; c++) expect(slabClear(c, false)).toBe(1);
});

test("the tissue table passes the clear leaf's share of the look's T at every entry, the underside reflecting no less than the top; off, the table is the green fit's", () => {
  const t = slabTable(SLAB_N, true);
  for (let c = 0; c < 3; c++) for (let i = 0; i < SLAB_N; i++) {
    const o = (c * SLAB_N + i) * 4;
    expect((1 - SLAB.f0) * t[o + 2]).toBeCloseTo(((i / (SLAB_N - 1)) ** 2) * slabClear(c, true), 6);   // Float32 storage
    expect(t[o + 1]).toBeGreaterThanOrEqual(t[o] - 1e-6);
  }
  const off = slabTable(SLAB_N), offExplicit = slabTable(SLAB_N, false);
  expect(Array.from(offExplicit)).toEqual(Array.from(off));
  for (let c = 0; c < 3; c++) for (let i = 0; i < SLAB_N; i++) {
    const T = (i / (SLAB_N - 1)) ** 2, m = slabLeaf(slabK(T, SLAB.s[c]), SLAB.s[c]), o = (c * SLAB_N + i) * 4;
    expect([off[o], off[o + 1], off[o + 2]]).toEqual([Math.fround(m[0]), Math.fround(m[1]), Math.fround(m[2])]);
  }
});

test("a gold leaf reflects gold as tissue, where the green fit reflects it lime", () => {
  // the shader reads the table linearly at √T, between two entries: the same here
  const read = (tab, c, T) => { const x = Math.sqrt(T) * (SLAB_N - 1), i = Math.min(Math.floor(x), SLAB_N - 2), f = x - i, o = (c * SLAB_N + i) * 4, p = o + 4; return [0, 1, 2].map((q) => tab[o + q] * (1 - f) + tab[p + q] * f); };
  const top = (neutral) => [0, 1, 2].map((c) => read(slabTable(SLAB_N, neutral), c, GOLD[c])[0]);
  const gold = oklabHue(GOLD);
  expect(Math.abs(oklabHue(top(true)) - gold)).toBeLessThan(5);
  expect(oklabHue(top(false)) - gold).toBeGreaterThan(30);          // toward green
});

// ---- THE CROWN'S OWN LIGHT (crown_light) ----

// leafAlbedo and crownTap, transcribed
const albedo = (t) => t + Math.max(0.885 * t - 0.019, 0);
function crownTap(tau, c, k, Tbeam, dif, K) {
  if (c < 1e-4) return { dif };
  const a = Math.min(c, 1), n = Math.max(c / a, 1);
  const t1 = tau.map((t, i) => Math.exp(-t / c - K[i])), tb1 = t1.map((v) => v * Math.exp(-k));
  const w = t1.map(albedo), wY = lumY(w);
  const beta = w.map((x, i) => Math.max(x - t1[i], 0) / Math.max(x, 1e-4));
  const kap = w.map((x, i) => Math.sqrt(Math.max((1 - x) * (1 - x + 2 * beta[i] * x), 0)));
  const src = a * 0.5 * Math.max(wY - lumY(tb1), 0);
  return { dif: dif.map((d, i) => d * ((1 - a) + a * Math.exp(-kap[i] * n)) + Tbeam[i] * src * Math.exp(-kap[i] * (n - 1))), kap, w, src };
}
test("the crown's tap is the shader's: one leaf's albedo from what it passes, the two-stream decay per channel, a grey source", () => {
  pin("vec3 leafAlbedo(vec3 T){ return T + max(0.885*T - 0.019, 0.0); }");
  pin("float albedoY(vec3 w){ return dot(w, vec3(0.2126, 0.7152, 0.0722)); }");
  pin("  float a = min(c, 1.0), n = max(c/a, 1.0);");
  pin("  vec3 t1 = exp(-tau/c - uClearK*float(uNeutral)), tb1 = t1*exp(-k);");
  pin("  vec3 w = leafAlbedo(t1);");
  pin("  vec3 beta = max(w - t1, 0.0)/max(w, vec3(1e-4));");
  pin("  vec3 kap = sqrt(max((1.0 - w)*(1.0 - w + 2.0*beta*w), 0.0));");
  pin("  dif = dif*((1.0 - a) + a*exp(-kap*n)) + Tbeam*a*0.5*max(wY - albedoY(tb1), 0.0)*exp(-kap*(n - 1.0));");
});

test("one albedo: the lit leaf keeps the field's bounces by the rule every leaf it meets scatters by, from the same T, its clear tissue's share folded in", () => {
  expect(FS_TREE).toContain("    vec3 w = leafAlbedo(T*exp(-uClearK*float(uNeutral)));");
  expect(FS_TREE).toContain("    col += (1.0 - Fv)*(1.0 - uF0)*0.5*crownField(vWorld, w)*(Rc + Tc);");
  expect(FS_TREE).not.toContain("slabAlbedo");
});

test("not the slab's faces: its clear tissue absorbs nothing, so a gold leaf would scatter all its red and the field would cross a crown without losing any", () => {
  // the rejected reading, held as the reason: the tissue slab's mean face R plus its T, read at √T as the shader samples the table
  const tab = slabTable(SLAB_N, true), read = (c, T) => { const x = Math.sqrt(T) * (SLAB_N - 1), i = Math.min(Math.floor(x), SLAB_N - 2), f = x - i, o = (c * SLAB_N + i) * 4, p = o + 4; return [0, 1, 2].map((q) => tab[o + q] * (1 - f) + tab[p + q] * f); };
  const slabW = GOLD.map((t, c) => { const m = read(c, t); return m[2] + 0.5 * (m[0] + m[1]); });
  expect(slabW[0]).toBeGreaterThan(0.999);                           // lossless: κ 0, ten leaves deep the red field undimmed
  const curveW = GOLD.map((t, c) => albedo(t * slabClear(c, true)));
  expect(curveW[0]).toBeGreaterThan(0.93); expect(curveW[0]).toBeLessThan(0.96);   // PROSPECT-D's bleached leaf loses about 5 %
});

test("the two-stream decay: a black leaf takes e^−1 of the field, a leaf that loses nothing takes none, and between the loss falls as the albedo rises", () => {
  const kOf = (T) => crownTap([-Math.log(T), -Math.log(T), -Math.log(T)], 1, 0, [0, 0, 0], [1, 1, 1], [0, 0, 0]).kap[0];
  expect(kOf(1e-12)).toBeCloseTo(1, 9);
  const lossless = 1.019 / 1.885;                                    // albedo 1: R + T = 1
  expect(albedo(lossless)).toBeCloseTo(1, 12);
  expect(kOf(lossless)).toBeLessThan(1e-6);
  let prev = Infinity;
  for (let i = 1; i <= 50; i++) { const k = kOf(lossless * i / 50); expect(k).toBeLessThan(prev); prev = k; }
});

test("the field decays by channel: ten gold leaves deep it keeps more than twice the light a grey decay at the leaf's luminance albedo would, and a grey leaf is the same either way", () => {
  const deep = (w) => {
    const tau = w.map((x) => -10 * Math.log((x + 0.019) / 1.885));   // ten leaves of this albedo over the whole texel
    const per = crownTap(tau, 10, 0, [0, 0, 0], [1, 1, 1], [0, 0, 0]).dif;
    const wY = lumY(w), g = crownTap(Array(3).fill(-10 * Math.log((wY + 0.019) / 1.885)), 10, 0, [0, 0, 0], [1, 1, 1], [0, 0, 0]).dif[0];
    return lumY(per) / g;
  };
  expect(deep([0.92, 0.77, 0.05])).toBeGreaterThan(2);               // the gold the shader's note names: luminance albedo 0.75
  expect(deep([0.6, 0.6, 0.6])).toBeCloseTo(1, 9);
});

test("the crown's scattered light starts grey: a sunlit texel scatters no colour of its own, only the beam's, and never more than half its albedo's share", () => {
  const K = clearK(true), tau = GOLD.map((t) => -0.6 * Math.log(t));
  for (const [c, k] of [[0.3, 0], [0.6, ballisticK(0.95)], [1, ballisticK(0.5)]]) {
    const r = crownTap(tau, c, k, [1, 1, 1], [0, 0, 0], K);
    expect(r.dif[0]).toBe(r.dif[1]); expect(r.dif[1]).toBe(r.dif[2]);
    expect(r.src).toBeGreaterThan(0); expect(r.src).toBeLessThanOrEqual(0.5 * c * lumY(r.w));
  }
  expect(crownTap(tau, 0, 0, [1, 1, 1], [0.3, 0.2, 0.1], K).dif).toEqual([0.3, 0.2, 0.1]);   // an empty texel passes the field untouched
});

test("the bounces are grey: the field's series runs at the luminance albedo, so a gold leaf keeps its hue, where per-channel bounces turn it toward red", () => {
  for (const src of TREE) expect(src).toContain("  return uCrownP*0.2*(uLeafSun*Dy + wY*G)/max(1.0 - uCrownP*wY, 0.05);");
  const w = GOLD.map((t, c) => albedo(t * slabClear(c, true))), hue = oklabHue(w);   // the tissue gold leaf of yellow ginkgo
  for (const p of [0.5, 0.8]) {
    const grey = w.map((x) => x / (1 - p * lumY(w))), per = w.map((x) => x / (1 - p * x));
    expect(Math.abs(oklabHue(grey) - hue)).toBeLessThan(1e-9);
    expect(hue - oklabHue(per)).toBeGreaterThan(12);                // the rejected reading, held as the reason
  }
});

const withoutCrown = (src) => src.replace(/#ifdef CROWN_FIELD\n[\s\S]*?#endif\n?/g, "");
test("off, nothing gathers: the field starts at 0, every tap is behind p > 0, the beam alone reads the layers bottom up as it did, and the leaf's and the wood's programs hold no read of the field", () => {
  pin("  Tsun = vec3(1.0); float lai = 0.0; dif = vec3(0.0); om = vec3(0.0);");
  pin("    if(uCrownP > 0.0) crownTap(t.rgb*f, t.a*f, uBeamK, Tsun, dif, om);");
  pin("    if(uCrownP > 0.0) crownTap(t.rgb*w, t.a*w, uBeamK, Tsun, dif, om);");
  for (const src of TREE) {
    expect([...src.matchAll(/crownField\(/g)].length).toBe(2);         // its definition and its one use, both in the crown's program alone
    expect(withoutCrown(src)).not.toContain("crownField(");
    expect(withoutCrown(src)).not.toContain("uCrownGrid");
  }
  expect(FS_TREE).toContain("#ifdef CROWN_FIELD\n    Rc[c] = Rseen; Tc[c] = m.b;\n#endif");
  expect(FS_TREE_WOOD).toContain("#ifdef CROWN_FIELD\n  col += 0.5*crownField(vWorld, om)*bark;");
});

test("on, the field is gathered once a frame on a grid and the leaves and the wood read it there: their own programs, the same gather and the same law", () => {
  for (const src of TREE) expect(defineIn(src, ["CROWN_FIELD"])).toBe(src.replace("#version 300 es\n", "#version 300 es\n#define CROWN_FIELD\n"));
  expect(treeNames({ ...DEFAULTS, crown_light: 0.8 })).toEqual(["CROWN_FIELD"]);
  expect(treeNames(DEFAULTS)).toEqual([]);                             // off, the programs the tree always ran
  pin("vec3 crownField(vec3 P, vec3 w){ vec4 g = texture(uCrownGrid, (P - uCrownOrigin)/uCrownSize); return crownLight(g.rgb, g.a, w); }");
  expect(FS_CROWN_GRID).not.toContain("#define CROWN_FIELD");
  expect(FS_CROWN_GRID).toContain("  vec3 P = uCrownOrigin + vec3(gl_FragCoord.xy, uCrownSlice + 0.5)/uCrownN*uCrownSize;");
  expect(FS_CROWN_GRID).toContain("  vec3 S; float Dy, K; crownGather(P, S, Dy, K);");
  expect(FS_CROWN_GRID).toContain("  vec3 sky = uSunHue*(albedoY(uAmbient)/max(albedoY(uSunHue), 1e-6));");
  // a cell is gathered at its centre and read back there: the bake's point and the reader's coordinate are one cell's texel centre
  for (const [extent, top] of [[21.74, 14], [60, 30], [3, 0.2]]) {
    const [nxy, nz] = crownGridSize(extent, top), size = [extent, extent, top], N = [nxy, nxy, nz];
    for (let a = 0; a < 3; a++) for (const i of [0, 1, N[a] - 1]) {
      const P = (i + 0.5) / N[a] * size[a];                            // origin 0 on this axis
      expect(P / size[a] * N[a] - 0.5).toBeCloseTo(i, 12);
    }
  }
});

test("the grid's cells are no wider than the field changes over: half a metre up to its caps, and never fewer than a few", () => {
  expect(crownGridSize(21.74, 14)).toEqual([44, 28]);                  // yellow ginkgo: 0.49 m by 0.5 m
  expect(crownGridSize(60, 30)).toEqual([64, 48]);                     // the caps: 0.94 m by 0.63 m
  expect(crownGridSize(1, 0.1)).toEqual([8, 2]);
  for (let e = 1; e <= 32; e += 0.37) expect(e / crownGridSize(e, 10)[0]).toBeLessThanOrEqual(0.5 + 1e-12);
});

test("the crown grid preserves sky irradiance at totality and the existing source mix in full sun", () => {
  expect(FS_CROWN_GRID).toContain("frag = vec4(uLeafSun*S + sky*K, Dy);");
  const hue = [1, 0.8, 0.4], ambient = [0.03, 0.04, 0.08], K = 5, S = [1.2, 2.1, 3.4];
  const sky = hue.map((v) => v*lumY(ambient)/lumY(hue));
  for (const share of [1, 0.25, 0]) {
    const sun = hue.map((v) => v*share);
    const rgb = sun.map((v, i) => v*S[i] + sky[i]*K);
    expect(rgb.every((v) => v > 0 && v < 65504)).toBe(true);
    if (share > 0) {
      for (const [i, v] of rgb.entries()) expect(v).toBeCloseTo(sun[i]*(S[i] + lumY(ambient)/lumY(sun)*K), 12);
    } else expect(lumY(rgb)).toBeCloseTo(lumY(ambient)*K, 12);
  }
});

// ---- THE SKY A LEAF SEES (open_sky) ----

test("the open sky's weights are the sky's solid angle by band, the cap, the middle and the low sky, and sum to the whole sky", () => {
  const m = FS_TREE.match(/return ([\d.]+)\*Tzenith \+ ([\d.]+)\*0\.25\*mid \+ ([\d.]+)\*0\.25\*low;/);
  expect(m).not.toBeNull();
  const [cap, mid, low] = m.slice(1).map(Number), s = (d) => Math.sin(d * Math.PI / 180);
  expect(cap + mid + low).toBeCloseTo(1, 12);                        // under no leaves a leaf sees all of its sky
  expect(cap).toBeCloseTo(1 - s(60), 2); expect(mid).toBeCloseTo(s(60) - s(30), 2); expect(low).toBeCloseTo(s(30), 2);
});

test("the open sky reads nine paths: the column, four at 45° on the axes and four at 15° between them, each through its leaves 1/sin(elevation) deep", () => {
  const m = FS_TREE.match(/const float SKY_COT_MID = ([\d.]+), SKY_SLANT_MID = ([\d.]+), SKY_COT_LOW = ([\d.]+), SKY_SLANT_LOW = ([\d.]+);/);
  expect(m).not.toBeNull();
  const [cotM, slM, cotL, slL] = m.slice(1).map(Number), r = (d) => d * Math.PI / 180;
  expect(cotM).toBeCloseTo(1 / Math.tan(r(45)), 7); expect(slM).toBeCloseTo(1 / Math.sin(r(45)), 7);
  expect(cotL).toBeCloseTo(1 / Math.tan(r(15)), 7); expect(slL).toBeCloseTo(1 / Math.sin(r(15)), 7);
  const body = FS_TREE.slice(FS_TREE.indexOf("float treeSkyOpen("), FS_TREE.indexOf("// The leaf's light with its sky read as open_sky says."));
  const mids = [...body.matchAll(/skyPath\(P, SKY_COT_MID\*vec2\(([-\d.]+), ([-\d.]+)\), SKY_SLANT_MID\)/g)].map((x) => x.slice(1).map(Number));
  const lows = [...body.matchAll(/skyPath\(P, SKY_COT_LOW\*vec2\((-?D), (-?D)\), SKY_SLANT_LOW\)/g)].map((x) => x.slice(1).join(","));
  expect(mids.map(String).sort()).toEqual(["-1,0", "0,-1", "0,1", "1,0"]);
  expect(lows.sort()).toEqual(["-D,-D", "-D,D", "D,-D", "D,D"]);
  expect(body).toContain("const float D = 0.70710678;");
  pin("  return exp(-0.5*slant*lai);");
});

test("off, the sky is the column above the leaf as it was, and only the gate reads the open sky", () => {
  pin("  Tsky = exp(-0.5*lai);");
  pin("  if(uOpenSky != 0) Tsky = treeSkyOpen(P, Tsky);");
  for (const src of TREE) {
    expect([...src.matchAll(/treeSkyOpen\(/g)].length).toBe(2);       // its definition and the gated call
    expect(src).not.toMatch(/(?<!void )treeLight\(vWorld/);           // leaf and wood both take their light through the gate
  }
});

// ---- THE BEAM THROUGH THE CROWN (beam_march) ----

// beamMarch's taps, transcribed: [height, weight] from the sun's side in
const TAPS = 4;
function taps(h, half, Pz) {
  const z0 = Math.max(Pz, h - half), z1 = h + half;
  if (z1 <= z0) return [];
  const w = (z1 - z0) / (2 * half) / TAPS, out = [];
  for (let j = TAPS - 1; j >= 0; j--) out.push([z0 + (z1 - z0) * (j + 0.5) / TAPS, w]);
  return out;
}
test("the march is the shader's: four heights through the part of the slab above the leaf, met from the sun's side in", () => {
  pin("const int BEAM_TAPS = 4;");
  pin("  float z0 = max(P.z, h - uLayerHalf), z1 = h + uLayerHalf;");
  pin("  float w = (z1 - z0)/(2.0*uLayerHalf)/float(BEAM_TAPS);");
  pin("  for(int j = BEAM_TAPS - 1; j >= 0; j--){");
  pin("    float z = z0 + (z1 - z0)*(float(j) + 0.5)/float(BEAM_TAPS);");
  pin("    vec2 uv = (P.xy + (z - P.z)*uSunG - uLayerOrigin)/uLayerExtent;");
  pin("    if(uNeutral == 0) texelMix(t.rgb*w, t.a*w, uBeamK, T, Tb);");
});

test("the taps share out exactly the part of the slab above the leaf: all of it below, half at its middle, none above, and they run from the top down", () => {
  const sum = (t) => t.reduce((a, [, w]) => a + w, 0);
  expect(sum(taps(5, 1.5, 1))).toBeCloseTo(1, 12);
  expect(sum(taps(5, 1.5, 5))).toBeCloseTo(0.5, 12);
  expect(sum(taps(5, 1.5, 6.4))).toBeCloseTo(0.1 / 3 * 1, 12);
  expect(taps(5, 1.5, 6.5)).toEqual([]);
  for (const Pz of [1, 4.2, 5.9]) {
    const t = taps(5, 1.5, Pz);
    for (let i = 0; i < t.length; i++) { expect(t[i][0]).toBeGreaterThan(Math.max(Pz, 3.5)); expect(t[i][0]).toBeLessThan(6.5); if (i) expect(t[i][0]).toBeLessThan(t[i - 1][0]); }
  }
});

test("under a low sun the plane read is a step from full sun to the whole slab, and the march grades the crown it crosses", () => {
  // one layer at 5 m, 3 m thick, holding a band of crown 9 m wide; the sun 15° up across the band, its path 11 m across the slab; leaves 2 m up, walked across it
  const k = ballisticK(0.95), g = 1 / Math.tan(15 * Math.PI / 180), texel = (x) => (Math.abs(x) < 4.5 ? { tau: [3, 3, 3], c: 1 } : { tau: [0, 0, 0], c: 0 });
  const plane = new Set(), march = new Set();
  for (let x = -25; x <= 5; x += 0.05) {
    const p = texel(x + (5 - 2) * g), P = texelMix(p.tau.map((v) => v * 1), p.c * 1, k).Tb[0];   // f = 1: the whole slab lies above
    plane.add(P.toFixed(6));
    let M = 1;
    for (const [z, w] of taps(5, 1.5, 2)) { const t = texel(x + (z - 2) * g); M *= texelMix(t.tau.map((v) => v * w), t.c * w, k).Tb[0]; }
    march.add(M.toFixed(6));
  }
  expect(plane.size).toBe(2);
  expect(march.size).toBeGreaterThanOrEqual(TAPS + 1);
});

test("off, the beam is read at the layer's plane as it was, and the march is the only other reader", () => {
  pin("  if(uBeamMarch != 0) beamMarch(L, h, P, Tsun, dif, om);");
  pin("  if(uBeamMarch == 0 && all(greaterThanEqual(uvS, vec2(0.0))) && all(lessThanEqual(uvS, vec2(1.0)))){");
  pin("    if(uNeutral == 0) texelMix(t.rgb*f, t.a*f, uBeamK, T, Tb);");
  pin("    else texelMixClear(t.rgb*f, t.a*f, uBeamK, T, Tb);");
});

// ---- ALL FOUR: off by default, the tree view's alone ----

test("all four are off by default, travel as their kind asks, and the tree view uploads each from its key", () => {
  expect([DEFAULTS.leaf_neutral, DEFAULTS.crown_light, DEFAULTS.open_sky, DEFAULTS.beam_march]).toEqual([false, 0, false, false]);
  expect([PARAMS.leaf_neutral.travels, PARAMS.crown_light.travels, PARAMS.open_sky.travels, PARAMS.beam_march.travels]).toEqual(["topo", "morph", "topo", "topo"]);
  expect([PARAMS.crown_light.row.min, PARAMS.crown_light.row.max]).toEqual([0, 0.9]);
  const tv = readFileSync(new URL("../engine/transport/komorebi-tree-view.js", import.meta.url), "utf8");
  expect(tv).toContain("gl.uniform3f(u.clearK, -Math.log(slabClear(0, neutral)), -Math.log(slabClear(1, neutral)), -Math.log(slabClear(2, neutral)));");
  expect(tv).toContain("gl.uniform1f(u.crownP, clamp(params.crown_light || 0, 0, 0.9));");
  expect(tv).toContain("gl.uniform1i(u.openSky, params.open_sky ? 1 : 0);");
  expect(tv).toContain("gl.uniform1i(u.beamMarch, params.beam_march ? 1 : 0);");
  expect(tv).toContain("params.leaf_neutral ? slabTexNeutral : slabTex");
});

test("no floor program reads them: the cast, the fill and the bounce keep the green fit and the beam they had", () => {
  const floor = [...TRANSPORT_CAMERAS.map((c) => buildTransport(c)), FS_FILL, FS_FILL_GROUND, FS_FILL_UP, FS_FILL_BOUNCE, GLSL_SKY_RAY];
  for (const src of floor) expect(src).not.toMatch(/uNeutral|uClearK|uCrownP|uOpenSky|uBeamMarch|texelMixClear|crownTap/);
});
