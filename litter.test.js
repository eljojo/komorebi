// ============================================================================
// Litter (spec §4.7, P3b): the floor is a map. A fallen leaf lies ON the receiver — it casts nothing (h = 0: no throw, no
// blur) and is SEEN BY REFLECTION, so the carpet is a texture the floor reads its albedo from, baked once per regrow from
// the grove's litter list (§4.5, P3a). The claims worth holding loudly are the ones that fail SILENTLY: a landing that moves
// with a stream it should not share, a drift that follows the live wind instead of the season's, a carpet laid in the wrong
// order, a colour law that cannot be replaced by the browning process behind the same signature, a gate that leaks a pass
// into a look that never asked, a receiver that reads what it must not. (The drop.test.js pattern: pure laws first, then
// the one place that applies them, then the wiring over a stub GL.)
// ============================================================================
import { test, expect } from "bun:test";
import { CANOPY_KEYS, DEFAULTS, MORPH_KEYS, TOPO_KEYS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import { fillFrame, leafHue } from "./komorebi-fill.js";
import { makeGrove } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";
import * as L from "./komorebi-litter.js";

const fall = (over) => ({ ...DEFAULTS, ...over });
const sum = (a) => a.reduce((s, v) => s + v, 0);

// ---- the family ships off ------------------------------------------------------------------------------------------
test("the family ships off: litter 0 is the gate, and the three that follow it are classified (canopy: regrow-time; topo: reallocates)", () => {
  expect(DEFAULTS.litter).toBe(0);
  expect(DEFAULTS.litter_age).toBe(0.15);
  expect(DEFAULTS.litter_drift_m).toBe(0.4);
  expect(DEFAULTS.litter_resolution).toBe(1024);
  for (const k of ["litter_age", "litter_drift_m"]) expect(CANOPY_KEYS, k).toContain(k);          // they only change the regrow-time bake
  for (const k of ["litter", "litter_resolution"]) expect(TOPO_KEYS, k).toContain(k);              // a gate that allocates, and a size: neither interpolates
});

// ---- a grove with a floor worth covering (the drop.test.js rig: the real grove over a stub GL) --------------------------
function growWith(over) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = fall({ tree_count: 2, leaves_per_cluster: 8, foliage_density: 1.5, layer_count: 2, ...over });
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => false, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  return { params, g, litter: g.litter, layers: g.layerVAO.map((l) => Array.from(l.buf.data)) };
}
const FALL = { phenology: 0.9, leaf_drop: 1, anthocyanin: 0.8, tannin: 0.3, turn_exposure: 1, drop_exposure: 1 };
const SMALL = { tree_count: 3, leaves_per_cluster: 9, foliage_density: 1.5 };   // 13.5 a twig: the last leaf of each is half a leaf, which the fade is worth testing on
const memo = new Map();
const grow = (over) => { const k = JSON.stringify(over); if (!memo.has(k)) memo.set(k, growWith(over)); return memo.get(k); };
const fallen = () => grow({ ...PRESETS["afternoon 7"], ...SMALL, ...FALL });

// ---- the landing -----------------------------------------------------------------------------------------------------
const leaf = (over) => ({ x: 1.5, y: -2.25, h: 6, D: 0.8, tau: [0.2, 1.4, 2.5], size: [0.04, 0.025], j: 17, k: 3, fade: 1, ...over });

test("landing: a pure function of (seed, j, k) and the leaf's own place — nobody else's draw moves it", () => {
  const P = fall({ seed: 77, litter_drift_m: 0.4, wind_direction_deg: 35 });
  const a = L.litterLanding(leaf(), P), b = L.litterLanding(leaf(), P);
  expect(b).toEqual(a);                                                        // pure: same address, same landing
  // computing everyone else's first changes nothing: there is no stream to advance
  for (let j = 0; j < 40; j++) for (let k = 0; k < 9; k++) L.litterLanding(leaf({ j, k }), P);
  expect(L.litterLanding(leaf(), P)).toEqual(a);
  for (const other of [leaf({ j: 18 }), leaf({ k: 4 }), leaf({ j: 3, k: 17 })]) expect(L.litterLanding(other, P), JSON.stringify([other.j, other.k])).not.toEqual(a);   // the address is in it, in order
  expect(L.litterLanding(leaf(), { ...P, seed: 78 })).not.toEqual(a);          // and so is the seed
  expect(L.litterLanding(leaf({ x: 2.5 }), P).x - a.x).toBeCloseTo(1, 12);     // the scatter is a function of the address, not of where it stood
});

test("landing: the mean displacement is h·litter_drift_m along wind_direction_deg, with σ = 0.3·h·litter_drift_m about it", () => {
  const n = 6000;
  for (const [deg, h, m] of [[0, 6, 0.4], [90, 8, 1], [210, 3, 2], [30, 5.5, 0.4]]) {
    const P = fall({ seed: 5, litter_drift_m: m, wind_direction_deg: deg });
    const dx = [], dy = [];
    for (let i = 0; i < n; i++) { const l = L.litterLanding(leaf({ h, x: 0, y: 0, j: i >> 4, k: i & 15 }), P); dx.push(l.x); dy.push(l.y); }
    const mx = sum(dx) / n, my = sum(dy) / n, sig = 0.3 * h * m;
    const want = [h * m * Math.cos(deg * math.DEG), h * m * Math.sin(deg * math.DEG)];
    expect(Math.abs(mx - want[0]), `dir ${deg}: x`).toBeLessThan(4 * sig / Math.sqrt(n));        // 4σ of the mean of n draws
    expect(Math.abs(my - want[1]), `dir ${deg}: y`).toBeLessThan(4 * sig / Math.sqrt(n));
    for (const [v, mu] of [[dx, mx], [dy, my]]) expect(Math.sqrt(sum(v.map((q) => (q - mu) ** 2)) / n) / sig, `dir ${deg}: σ`).toBeCloseTo(1, 1);
  }
  // 0° is +x and 90° is +y — motion.windX/windY's own convention (komorebi-motion.js), which is what "the wind blows toward" means here
  const east = L.litterLanding(leaf({ h: 10, x: 0, y: 0 }), fall({ litter_drift_m: 1, wind_direction_deg: 0 })), north = L.litterLanding(leaf({ h: 10, x: 0, y: 0 }), fall({ litter_drift_m: 1, wind_direction_deg: 90 }));
  expect(east.x).toBeGreaterThan(5); expect(Math.abs(east.y)).toBeLessThan(5);
  expect(north.y).toBeGreaterThan(5); expect(Math.abs(north.x)).toBeLessThan(5);
  expect(L.litterLanding(leaf({ h: 0 }), fall({ litter_drift_m: 2 })).x).toBe(1.5);           // it fell from nowhere: it lies where it grew
});

test("landing: the SEASON's wind, never the live one — wind_strength, gustiness and the weather's veer cannot reach it", () => {
  const base = fall({ seed: 9, wind_direction_deg: 130, litter_drift_m: 0.7 });
  const want = L.litterLanding(leaf(), base);
  for (const over of [{ wind_strength: 0 }, { wind_strength: 3 }, { wind_gustiness: 0.9 }, { weather_variability: 1, weather_speed: 3 }, { wind_pattern: "squally", gust_frequency: 0.9 }, { sway_ceiling: 0.9 }])
    expect(L.litterLanding(leaf(), { ...base, ...over }), JSON.stringify(over)).toEqual(want);
  // and the whole carpet — every landing, in the buffer — is the same at any strength
  const lit = fallen().litter.slice(0, 400), P0 = { ...fall({ seed: 1234, wind_direction_deg: 60 }) };
  for (const l of lit) expect(L.litterLanding(l, { ...P0, wind_strength: 4 })).toEqual(L.litterLanding(l, { ...P0, wind_strength: 0 }));
  // the AUTHORED direction does move it: the carpet follows the season's wind, which is what makes it a function of the look
  expect(L.litterLanding(leaf(), { ...base, wind_direction_deg: 300 })).not.toEqual(want);
});

test("landing: its own rotation, from its own stream — the same leaf lies at the same angle, leaves differ, all of [0, 2π)", () => {
  const P = fall({ seed: 12 });
  const rots = Array.from({ length: 2000 }, (_, i) => L.litterLanding(leaf({ j: i >> 3, k: i & 7 }), P).rot);
  for (const r of rots) expect(r >= 0 && r < 2 * Math.PI).toBe(true);
  expect(new Set(rots).size).toBe(2000);
  const mean = sum(rots) / rots.length;
  expect(Math.abs(mean - Math.PI)).toBeLessThan(4 * (2 * Math.PI / Math.sqrt(12)) / Math.sqrt(2000));   // uniform on a circle
  const deciles = new Array(8).fill(0);
  for (const r of rots) deciles[Math.floor(r / (2 * Math.PI) * 8)]++;
  for (const c of deciles) expect(Math.abs(c - 250)).toBeLessThan(60);
  // the leaf's GROWN angle is not the angle it lies at: a leaf on the ground has no twig to hold it (the stamp is its own draw)
  expect(L.litterLanding(leaf(), P).rot).toBe(L.litterLanding(leaf({ x: 9, h: 2 }), P).rot);   // not a function of where it fell from
});

test("the litter's hashes never touch the growth RNG: their own salt, uncorrelated with every other stream, and no state to advance", () => {
  const salts = [L.LITTER_SALT, 0x51ED270B /* the pigment draw */, 0x7A3C91D5 /* the drop day */, 0x5bd1e995 /* wind identity */, 0x5EED /* growth */];
  expect(new Set(salts).size).toBe(salts.length);
  const corr = (u, v) => {
    const n = u.length, mu = sum(u) / n, mv = sum(v) / n;
    let suv = 0, suu = 0, svv = 0;
    for (let i = 0; i < n; i++) { suv += (u[i] - mu) * (v[i] - mv); suu += (u[i] - mu) ** 2; svv += (v[i] - mv) ** 2; }
    return suv / Math.sqrt(suu * svv);
  };
  const cells = Array.from({ length: 2000 }, (_, i) => [i >> 4, i & 15]), seed = 77;
  const rot = cells.map(([j, k]) => L.litterLanding(leaf({ j, k, x: 0, y: 0, h: 5 }), fall({ seed, litter_drift_m: 0.4 })).rot / (2 * Math.PI));
  const first = (a, b, c) => math.mulberry32(math.hash3(a, b, c))();
  const streams = {
    arrangement: cells.map(([j]) => first(seed, j, 101)),
    wind: cells.map(([j]) => first(seed ^ 0x5bd1e995, j, 101)),
    pigment: cells.map(([j, k]) => first(seed ^ 0x51ED270B, j, k)),
    drop: cells.map(([j, k]) => math.dropHash(seed, j, k)),
  };
  for (const [name, v] of Object.entries(streams)) expect(Math.abs(corr(rot, v)), name).toBeLessThan(0.1);
  // and the grove is the grove however much litter is laid: nothing it draws from is shared with the litter's functions
  const before = JSON.stringify(grow({ ...PRESETS["afternoon 7"], ...SMALL, ...FALL, seed: 31 }).layers);
  const g = growWith({ ...PRESETS["afternoon 7"], ...SMALL, ...FALL, seed: 31 });
  L.litterInstances(g.litter, g.params, { ox: -6, oy: -6, ext: 12 }, true);
  expect(JSON.stringify(growWith({ ...PRESETS["afternoon 7"], ...SMALL, ...FALL, seed: 31 }).layers)).toBe(before);
});

// ---- the order: the last to fall lie on top -----------------------------------------------------------------------------
test("instance order = ascending D: the carpet is laid in the order the leaves fell, ties by their address", () => {
  const { litter } = fallen();
  expect(litter.length).toBeGreaterThan(500);
  const ord = L.litterOrder(litter);
  expect(ord).toHaveLength(litter.length);
  for (let i = 1; i < ord.length; i++) {
    const a = ord[i - 1], b = ord[i];
    expect(a.D <= b.D, `D ${a.D} then ${b.D}`).toBe(true);
    if (a.D === b.D) expect(a.j < b.j || (a.j === b.j && a.k < b.k), "a tie is settled by (j, k), not by whoever the grove listed first").toBe(true);
  }
  const first = L.litterOrder([...litter].reverse());
  expect(first.map((l) => `${l.j}/${l.k}`)).toEqual(ord.map((l) => `${l.j}/${l.k}`));           // the order is a property of the leaves, not of the list
  expect(litter.map((l) => l.D)).not.toEqual([...litter.map((l) => l.D)].sort((a, b) => a - b));   // not vacuous: the grove does NOT hand them in order
  // the instance buffer is that order, instance for instance (no wrap: one stamp per leaf, so slot i IS leaf i)
  const P = fallen().params, big = { ox: -50, oy: -50, ext: 100 };
  const inst = L.litterInstances(litter, P, big, false);
  expect(inst.count).toBe(ord.length);
  for (let i = 0; i < ord.length; i += 37) {
    const land = L.litterLanding(ord[i], P);
    expect(inst.data[i * L.INSTANCE_FLOATS], `x of #${i}`).toBeCloseTo(land.x, 4);
    expect(inst.data[i * L.INSTANCE_FLOATS + 2], `A of #${i}`).toBeCloseTo(ord[i].size[0], 6);
    expect(inst.data[i * L.INSTANCE_FLOATS + 3], `B of #${i}`).toBeCloseTo(ord[i].size[1], 6);
  }
});

test("an instance is one leaf's stamp: where, how big, which way, how much of it is there, and the albedo it reflects with", () => {
  const { litter, params } = fallen();
  const inst = L.litterInstances(litter, params, { ox: -50, oy: -50, ext: 100 }, false), F = L.INSTANCE_FLOATS, ord = L.litterOrder(litter);
  expect(F).toBe(12);
  expect(inst.data).toBeInstanceOf(Float32Array);
  for (let i = 0; i < ord.length; i += 53) {
    const o = i * F, l = ord[i], land = L.litterLanding(l, params);
    expect(inst.data[o + 4], "cos").toBeCloseTo(Math.cos(land.rot), 6);
    expect(inst.data[o + 5], "sin").toBeCloseTo(Math.sin(land.rot), 6);
    expect(Math.hypot(inst.data[o + 4], inst.data[o + 5])).toBeCloseTo(1, 6);                  // the rotation arrives as a unit vector: no trig on the GPU
    expect(inst.data[o + 6], "alpha is the leaf's fade").toBeCloseTo(l.fade, 6);
    const rgb = L.litterAlbedo(l.tau, L.litterAge(params, l.D), params.leaf_wetness);
    for (let c = 0; c < 3; c++) expect(inst.data[o + 8 + c], `albedo ${c}`).toBeCloseTo(rgb[c], 6);
  }
});

test("a marginal leaf lies at its fade, so a density morph does not pop its litter in at full weight", () => {
  const l = leaf({ fade: 0.25 }), P = fall({ seed: 3 });
  const inst = L.litterInstances([l], P, { ox: -50, oy: -50, ext: 100 }, false);
  expect(inst.data[6]).toBeCloseTo(0.25, 7);
  const marginal = fallen().litter.filter((q) => q.fade < 1);
  expect(marginal.length, "the grove carries marginal leaves worth testing").toBeGreaterThan(0);
});

// ---- the colour --------------------------------------------------------------------------------------------------------
const TAUS = {
  summer: [-Math.log(0.04), -Math.log(0.35), -Math.log(0.06)],
  gold: [0.30, 0.55, 2.8],
  red: [0.40, 3.35, 3.8],
  maroon: [0.2, 4.5, 3.4],
  russet: [1.1, 1.75, 4.7],
};
// The redhead (anthocyanin .8, no wall fraction, fully turned): the saturated end of what a maple lays down.
const REDHEAD = math.leafTau(TAUS.summer, { ...DEFAULTS, phenology: 1, anthocyanin: 0.8, tannin: 0, wall_fraction: 0, turn_exposure: 0 }, 290626672, 3, 4);
const sat = (a) => Math.min(...a) / Math.max(...a);                                                                  // min/max: 1 is grey, 0 is a pure primary
// today's law (0.35·leafHue(e^−τ)), frozen here only to say the honest one is less saturated than it
const oldLaw = (tau) => { const h = leafHue(tau.map((t) => Math.exp(-t))); return h.map((v) => 0.35 * v); };

test("the honest law's constants: κ is 2 (PROVISIONAL, the grey card fits it) and the cuticle's dry share is 0.04; LITTER_PEAK is retired", () => {
  expect(L.LITTER_KAPPA).toBe(2);
  expect(L.F_CUTICLE).toBe(0.04);
  expect("LITTER_PEAK" in L).toBe(false);
});

test("TAU_BROWN round-trips: age ≥ 1 is ALBEDO_BROWN to the bit (the branch), and the formula without the branch gives it within 1e-12", () => {
  expect(L.ALBEDO_BROWN).toEqual([0.12, 0.08, 0.05]);
  for (const [name, tau] of Object.entries({ ...TAUS, REDHEAD })) for (const age of [1, 1.0000001, 2, 10, Infinity]) {
    const b = L.litterAlbedo(tau, age); for (let c = 0; c < 3; c++) expect(Object.is(b[c], L.ALBEDO_BROWN[c]), `${name} age ${age} ch ${c}`).toBe(true);
  }
  for (let c = 0; c < 3; c++) {                                                                                      // the law itself, unbranched: R = F + (1−F)·kmReflect(κ·τ_brown)
    const R = L.F_CUTICLE + (1 - L.F_CUTICLE) * L.kmReflect(L.LITTER_KAPPA * L.TAU_BROWN[c]);
    expect(Math.abs(R - L.ALBEDO_BROWN[c]), `ch ${c}`).toBeLessThan(1e-12);
  }
});

test("litterAlbedo is a reflectance: R ∈ [F_w, 1], a white scatterer at τ = 0, strictly darker with every channel's τ", () => {
  expect(L.litterAlbedo([0, 0, 0], 0, 0)).toEqual([1, 1, 1]);
  const rnd = math.mulberry32(5);
  for (let i = 0; i < 300; i++) {
    const tau = [rnd() * 6, rnd() * 6, rnd() * 6], age = rnd() * 1.2, w = rnd();
    const a = L.litterAlbedo(tau, age, w);
    for (let c = 0; c < 3; c++) { expect(a[c]).toBeGreaterThanOrEqual(L.F_CUTICLE * (1 - w) - 1e-15); expect(a[c]).toBeLessThanOrEqual(1); }
  }
  for (let c = 0; c < 3; c++) {
    let prev = 1;
    for (let t = 0.05; t <= 8; t += 0.05) { const tau = [1, 1, 1]; tau[c] = t; const r = L.litterAlbedo(tau, 0, 0)[c]; expect(r < prev, `ch ${c} τ ${t}`).toBe(true); prev = r; }
  }
});

test("the carpet is less saturated than the transmittance colour it replaces: for every TAUS leaf and the redhead, min/max is higher; the redhead keeps its green and stays under half in red", () => {
  for (const [name, tau] of Object.entries({ ...TAUS, REDHEAD })) expect(sat(L.litterAlbedo(tau, 0)), name).toBeGreaterThan(sat(oldLaw(tau)));
  const r = L.litterAlbedo(REDHEAD, 0);
  expect(r[1]).toBeGreaterThanOrEqual(0.3 * r[0]);
  expect(r[0]).toBeLessThan(0.5);
});

test("the numbers at κ 2: TAUS.red at age 0 is (.331, .103, .096) dry and (.227, .057, .053) at w 0.5", () => {
  const dry = L.litterAlbedo(TAUS.red, 0, 0), wet = L.litterAlbedo(TAUS.red, 0, 0.5);
  [0.331, 0.103, 0.096].forEach((v, c) => { expect(Math.abs(dry[c] - v), `dry ${c}`).toBeLessThan(0.002); });
  [0.227, 0.057, 0.053].forEach((v, c) => { expect(Math.abs(wet[c] - v), `wet ${c}`).toBeLessThan(0.002); });
});

test("age walks toward brown monotonically, channel by channel, never overshooting, and is exact at age 1", () => {
  for (const [name, tau] of Object.entries({ ...TAUS, REDHEAD })) {
    const fresh = L.litterAlbedo(tau, 0), prev = [...fresh];
    for (let i = 1; i <= 100; i++) {
      const a = L.litterAlbedo(tau, i / 100);
      for (let c = 0; c < 3; c++) {
        const dir = Math.sign(L.ALBEDO_BROWN[c] - fresh[c]);                                   // toward brown: down for a channel above it, up for one below
        expect(dir * (a[c] - prev[c]) >= -1e-15, `${name} ch ${c} at age ${i / 100} moved away from brown`).toBe(true);
        expect(a[c] >= Math.min(fresh[c], L.ALBEDO_BROWN[c]) - 1e-15 && a[c] <= Math.max(fresh[c], L.ALBEDO_BROWN[c]) + 1e-15, `${name} ch ${c} overshot`).toBe(true);
        prev[c] = a[c];
      }
    }
  }
  expect(L.litterAlbedo(TAUS.red, -3)).toEqual(L.litterAlbedo(TAUS.red, 0));                    // not yet fallen reads as fresh, never as a negative mix
});

test("browning is mixed in K-space, not in reflectance: at age ½ the pigment load q is the mean of fresh's and brown's, so the half-aged leaf is NOT the reflectance midpoint", () => {
  const q = (R) => L.kmInvert((R - L.F_CUTICLE) / (1 - L.F_CUTICLE));    // the load a reflectance implies
  for (const tau of [TAUS.red, TAUS.gold, REDHEAD]) {
    const half = L.litterAlbedo(tau, 0.5), fr = L.litterAlbedo(tau, 0), s = math.smoothstep(0, 1, 0.5);
    let off = 0;
    for (let c = 0; c < 3; c++) {
      const want = (1 - s) * L.LITTER_KAPPA * tau[c] + s * L.LITTER_KAPPA * L.TAU_BROWN[c];
      expect(q(half[c]) / want, `ch ${c}`).toBeCloseTo(1, 10);
      off = Math.max(off, Math.abs(half[c] - (fr[c] + L.ALBEDO_BROWN[c]) / 2));
    }
    expect(off, "K-space is not the reflectance mean").toBeGreaterThan(1e-3);
  }
});

test("litterAlbedo(tau, age) is the ONE colour law: a pure function of its two arguments, filling `out` — P4b's browning replaces it behind this signature", () => {
  expect(L.litterAlbedo.length).toBeGreaterThanOrEqual(2);
  const out = [9, 9, 9], r = L.litterAlbedo(TAUS.gold, 0.3, 0, out);
  expect(r).toBe(out);
  expect(L.litterAlbedo(TAUS.gold, 0.3)).toEqual(r);
  // the bake colours every instance through it and through nothing else: the buffer is the function's output, whatever the function is
  const { litter, params } = fallen();
  const inst = L.litterInstances(litter.slice(0, 50), params, { ox: -50, oy: -50, ext: 100 }, false);
  const ord = L.litterOrder(litter.slice(0, 50));
  for (let i = 0; i < ord.length; i++) {
    const want = L.litterAlbedo(ord[i].tau, L.litterAge(params, ord[i].D), params.leaf_wetness);
    for (let c = 0; c < 3; c++) expect(inst.data[i * L.INSTANCE_FLOATS + 8 + c]).toBeCloseTo(want[c], 6);
  }
});

test("age = (phenology − D) / litter_age: 0 the day it falls, 1 when litter_age has passed, and no division by zero", () => {
  const P = fall({ phenology: 0.9, litter_age: 0.15 });
  expect(L.litterAge(P, 0.9)).toBe(0);
  expect(L.litterAge(P, 0.75)).toBeCloseTo(1, 12);
  expect(L.litterAge(P, 0.825)).toBeCloseTo(0.5, 12);
  expect(L.litterAge(P, 0.5)).toBeGreaterThan(1);
  expect(L.litterAge({ ...P, litter_age: 0 }, 0.9)).toBe(0);                                    // fell this instant: no age at all, not NaN
  expect(L.litterAge({ ...P, litter_age: 0 }, 0.8)).toBe(Infinity);                             // ...and anything older is as old as it gets
  expect(L.litterAge({ ...P, litter_age: 0.3 }, 0.75)).toBeCloseTo(0.5, 12);
});

test("the carpet ages red → copper → brown: the earlier a leaf fell, the browner it lies", () => {
  const { litter, params } = fallen();
  const ord = L.litterOrder(litter), n = ord.length;
  const lum = (l) => { const a = L.litterAlbedo(l.tau, L.litterAge(params, l.D), params.leaf_wetness); return a[0] - a[2]; };   // red minus blue: how far from brown's own 0.07
  const old = ord.slice(0, n >> 2), young = ord.slice(-(n >> 2)), oldest = ord.slice(0, n >> 3);
  const mean = (xs) => sum(xs.map(lum)) / xs.length;
  expect(mean(old), "the first to fall have gone brown").toBeLessThan(mean(young));
  for (const l of old.slice(0, 50)) { expect(L.litterAge(params, l.D)).toBeGreaterThanOrEqual(0); }
  expect(oldest.every((l) => L.litterAge(params, l.D) >= 1), "the oldest eighth are all a litter_age old").toBe(true);
  expect(young.some((l) => L.litterAge(params, l.D) < 1), "and some of the youngest are not").toBe(true);
});

// ---- the frame --------------------------------------------------------------------------------------------------------
test("the park wraps: every landing is folded back into the frame, and a stamp that crosses an edge is drawn again on the other side", () => {
  const { litter, params } = fallen(), E = params.canopy_extent_m, frame = fillFrame(E, 8, false);
  expect(frame).toEqual({ ox: -E / 2, oy: -E / 2, ext: E });
  const inst = L.litterInstances(litter, params, frame, true), F = L.INSTANCE_FLOATS;
  expect(inst.count).toBeGreaterThan(litter.length);                                           // some leaf lay across an edge: the carpet repeats, so it shows on both sides
  expect(inst.count).toBeLessThan(litter.length * 1.5);
  const inside = [];
  for (let i = 0; i < inst.count; i++) {
    const x = inst.data[i * F], y = inst.data[i * F + 1], r = Math.max(inst.data[i * F + 2], inst.data[i * F + 3]);
    expect(x + r >= frame.ox - 1e-4 && x - r <= frame.ox + frame.ext + 1e-4 && y + r >= frame.oy - 1e-4 && y - r <= frame.oy + frame.ext + 1e-4, `stamp ${i} lies on the frame`).toBe(true);
    if (x >= frame.ox && x <= frame.ox + frame.ext && y >= frame.oy && y <= frame.oy + frame.ext) inside.push(i);
  }
  expect(inside.length, "every leaf has exactly one stamp whose centre is in the frame").toBe(litter.length);
  // the copy is the leaf, translated by exactly one period
  const lone = [leaf({ x: 0, y: 0, h: 0 })];                                                  // h 0: lands where it grew... at the middle: no copies
  expect(L.litterInstances(lone, params, frame, true).count).toBe(1);
  const edge = [leaf({ x: E / 2 - 0.01, y: 0, h: 0, size: [0.05, 0.03] })];                    // 1 cm from the right edge, a 5 cm half-axis
  const e = L.litterInstances(edge, params, frame, true);
  expect(e.count).toBe(2);
  expect(Math.abs(e.data[0] - e.data[F])).toBeCloseTo(E, 4);
  expect(e.data[1]).toBe(e.data[F + 1]);
  for (let c = 0; c < F; c++) if (![0].includes(c)) expect(e.data[c], `copy slot ${c}`).toBe(e.data[F + c]);   // same size, rotation, fade and colour
  const corner = [leaf({ x: E / 2 - 0.01, y: E / 2 - 0.01, h: 0, size: [0.05, 0.03] })];
  expect(L.litterInstances(corner, params, frame, true).count).toBe(4);                        // a corner is on four tiles
  for (const [x, y, name] of [[-E / 2 + 0.01, 0, "left"], [0, -E / 2 + 0.01, "bottom"], [0, E / 2 - 0.01, "top"], [-E / 2 + 0.01, -E / 2 + 0.01, "the other corner"]]) {
    const q = L.litterInstances([leaf({ x, y, h: 0, size: [0.05, 0.03] })], params, frame, true);
    expect(q.count, name).toBe(name === "the other corner" ? 4 : 2);                             // every edge repeats, not just the two the sun happens to favour
    expect(Math.hypot(q.data[0] - q.data[F], q.data[1] - q.data[F + 1]), `${name}: one period away`).toBeCloseTo(E, 4);
  }
  // a leaf that drifts off the box lands on the far side of it
  const far = L.litterInstances([leaf({ x: E / 2 - 0.2, y: 0, h: 10 })], fall({ ...params, litter_drift_m: 3, wind_direction_deg: 0 }), frame, true);
  for (let i = 0; i < far.count; i++) expect(far.data[i * F] <= frame.ox + frame.ext + 0.2 && far.data[i * F] >= frame.ox - 0.2).toBe(true);
});

test("a finite tree's carpet is clamped on its padded frame: what lands off it is dropped, and nothing is repeated", () => {
  const { litter, params } = fallen(), frame = fillFrame(params.canopy_extent_m, 8, true);
  expect(frame.ext).toBe(params.canopy_extent_m + 2 * 3 * 8);
  const inst = L.litterInstances(litter, params, frame, false);
  expect(inst.count).toBe(litter.length);                                                     // the frame is wide enough for every drift here
  const tight = L.litterInstances(litter, { ...params, litter_drift_m: 40, wind_direction_deg: 0 }, { ox: -3, oy: -3, ext: 6 }, false);
  expect(tight.count).toBeLessThan(litter.length);                                            // a leaf that lands off it is not drawn (nothing to read there)
  expect(tight.data.length).toBe(tight.count * L.INSTANCE_FLOATS);
});

// ============================================================================
// THE FLOOR READS IT, AND ONLY THE FLOOR (§4.7). One uniform group on one camera; everything else is the program it was.
// ============================================================================
import { CAMERAS, GROUP_UPLOAD_KEYS, TRANSPORT_CAMERAS, TRANSPORT_GROUPS, buildTransport } from "./komorebi.js";
import { FS_LITTER, VS_LITTER } from "./komorebi-shaders.js";

test("the floor's else is the old line: with the carpet unread the material is the one it has always been", () => {
  const floor = buildTransport("floor");
  expect(floor).toContain("col = (acc*uSunColor + uAmbient) * uGround;");                       // canopy_fill 0, litter 0: the literal expression
  expect(floor).toContain("col = (acc*uSunColor + amb) * uGround;");                            // canopy_fill 1, litter 0: the fill's own line
  // ...both of them in the else of the carpet's uniform branch, the way the fill's gate is a branch and not a program (litter is read
  // per frame; a camera program is chosen by MODE flags alone, §4.6)
  const at = floor.indexOf("if(uLitterOn != 0){"), els = floor.indexOf("} else {", at);
  expect(at).toBeGreaterThan(0);
  expect(floor.indexOf("col = (acc*uSunColor + uAmbient) * uGround;")).toBeGreaterThan(els);
  expect(floor.indexOf("col = (acc*uSunColor + amb) * uGround;")).toBeGreaterThan(els);
  // the carpet's own branch: its read, the premultiplied composition over the ground, and the one lighting line both gates share
  expect(floor).toContain("vec4 L = texture(uLitter, (world-uLitterOrigin)/uLitterExtent);");
  expect(floor).toContain("vec3 ground = uGround*(1.0-L.a) + L.rgb;");
  expect(floor).toContain("col = (acc*uSunColor + amb) * ground;");
  // the fill's share is ONE expression, in both: the carpet is lit by what lights the ground beside it (S and Tsky are in `amb`)
  const share = "mix(uAmbient, uAmbient*textureLod(uFillT, fuv, FILL_LOD).rgb + textureLod(uFillS, fuv, FILL_LOD).rgb, uCanopyFill)";
  expect(floor.split(share).length - 1).toBe(2);
  // nothing reads the carpet before its own branch: the declarations are all that precede it
  expect(floor.slice(0, at).replace(/uniform[^;]*uLitter\w*;/g, "").includes("uLitter")).toBe(false);
});

test("the carpet is the floor's alone: no other camera declares it, samples it, or uploads it", () => {
  expect(Object.keys(TRANSPORT_GROUPS.litter.locs).sort()).toEqual(["litter", "litterExtent", "litterOn", "litterOrigin"]);
  expect(GROUP_UPLOAD_KEYS).toContain("litter");
  for (const cam of TRANSPORT_CAMERAS) expect(CAMERAS[cam].groups.includes("litter"), `${cam} speaks the litter group`).toBe(cam === "floor");
  for (const cam of ["cloth", "enclosure", "sky"]) {
    const src = buildTransport(cam);
    expect(/uLitter/.test(src), `${cam} mentions the carpet`).toBe(false);
    expect(/uGround/.test(src), `${cam} reflects off the ground — it has none`).toBe(false);       // the only line the carpet changes is the floor's reflectance
  }
  expect(/uLitter/.test(buildTransport("floor"))).toBe(true);
});

test("the litter group's declarations are the whole of what the floor reads: a flag, the sampler, and the frame it is read by", () => {
  const decls = TRANSPORT_GROUPS.litter.decls;
  expect(decls).toContain("uniform int   uLitterOn;");
  expect(decls).toContain("uniform highp sampler2D uLitter;");
  expect(decls).toContain("uniform vec2  uLitterOrigin;");
  expect(decls).toContain("uniform vec2  uLitterExtent;");
  expect(/uFill/.test(decls.replace(/\/\/.*$/gm, "")), "its own frame, not the fill's — the fill may be shut").toBe(false);
});

test("the carpet's bake: a stamp in a unit quad, premultiplied, sized and turned on the CPU — no trig and no wide smoothing on the GPU", () => {
  const code = (s) => s.replace(/\/\/.*$/gm, "");
  expect(VS_LITTER.startsWith("#version 300 es")).toBe(true); expect(FS_LITTER.startsWith("#version 300 es")).toBe(true);
  for (const n of ["uLitterOrigin", "uLitterExtent"]) expect(code(VS_LITTER).includes(n), n).toBe(true);   // its own frame uniforms, named as the floor's are
  expect(/\b(sin|cos|atan|acos|asin)\s*\(/.test(code(VS_LITTER)), "the angle arrives as a unit vector").toBe(false);
  expect(code(VS_LITTER)).toContain("vCol = vec4(iC.rgb*a, a);");                                       // PREMULTIPLIED: a texel is a mixture, so the bilinear read and the mips average coverage-weighted colour
  expect(code(FS_LITTER)).toContain("fwidth(r)");                                                         // one texel of anti-aliasing, whatever the frame: a 10 cm leaf is sharp
  expect(/\bhalf\b/.test(code(VS_LITTER)), "`half` is a reserved word in GLSL ES").toBe(false);
});

// ============================================================================
// THE BAKE'S WIRING: what the carpet is handed, when it is baked, and when it is not. A stub GL records the calls, and a real makeSource /
// makeBake supply the very bulkOn, layerHeights and fill frame the engine uses — so this holds the wiring, not a restatement of it.
// ============================================================================
import { makeBake, makeFill } from "./komorebi-bake.js";
import { makeSource } from "./komorebi-source.js";
import { MAX_LAYERS } from "./komorebi-params.js";

function litterRig(over = {}, { list = fallen().litter, faithful = false } = {}) {
  const calls = [];
  const gl = new Proxy({}, { get: (_t, name) => (/^[A-Z][A-Z0-9_]+$/.test(name) ? name : (...a) => { calls.push([name, ...a]); return name === "checkFramebufferStatus" ? "FRAMEBUFFER_COMPLETE" : {}; }) });
  const params = { ...fallen().params, litter: 1, canopy_fill: 0, canopy_extent_m: 12, layer_count: 3, canopy_base_height_m: 5, canopy_thickness_m: 3, sun_elevation_deg: 36, sun_azimuth_deg: 30, ...over };
  const { bulkShift, bulkOn, layerHeights } = makeSource({ gl, params, perf: {}, trans: {}, src: {}, effCloud: () => 0 });
  const U = { layers: Array.from({ length: MAX_LAYERS }, (_, i) => `layer${i}`) };
  for (const k of ["origin", "extent", "frameOrigin", "frameExtent", "sunPath", "open", "sun", "heights", "layerCount", "ray", "turn", "count", "scatter", "beamK"]) U[k] = k;
  const fill = { tex: [null, null], res: 0, ready: false, sig: new Float64Array(16), K: 0, rays: null };
  const litter = L.newLitterState();
  const faith = { binH: Float32Array.from([2, 7.5, 9, 4]) };   // where the faithful tree's twigs REALLY grew: not the park band
  const hub = { gl, params, motion: {}, src: {}, faith, sky: {}, U, fill, litter, bakeFBO: { fbo: "bake" }, faithFBO: {}, fillFBO: {}, emptyVAO: {}, quadBuf: { buf: "quad" }, progBake: {}, progFaith: {}, progFaithSeg: {}, progFAcc: {},
    bakeRes: () => 256, faithfulOn: () => faithful, layerTex: Array.from({ length: MAX_LAYERS }, (_, i) => ({ layer: i })), makeLayerTexture: () => ({}), allocLayers: () => {}, layerSize: 256, fail: (m) => { throw new Error(m); },
    fillFor: () => ({ prog: {}, U }), litterFor: () => ({ prog: { prog: "litter" }, U: { origin: "uLitterOrigin", extent: "uLitterExtent", minHalf: "uLitterMinHalf" } }), bulkShift, bulkOn, layerHeights,
    grove: { litter: list } };
  const bake0 = makeBake(hub);
  Object.assign(hub, { bakeLayers: bake0.bakeLayers, fillFrameNow: bake0.fillFrameNow });
  const bake = { ...bake0, ...makeFill(hub) };   // the bake and the fill are two factories now; the rig holds both as one
  const lit = L.makeLitter(hub);
  const count = (name) => calls.filter((c) => c[0] === name).length;
  const draws = () => calls.filter((c) => c[0] === "drawArraysInstanced");
  return { calls, hub, params, litter, fill, bake, lit, count, draws, faith,
    allocs: () => calls.filter((c) => c[0] === "texImage2D").map((c) => c.slice(1)),
    wraps: (which) => calls.filter((c) => c[0] === "texParameteri" && c[2] === "TEXTURE_WRAP_S" && c[3] === which).length };
}

test("litter 0: no texture beyond the 1×1, no bake pass, nothing scheduled — at any frame, with a grove full of fallen leaves", () => {
  const r = litterRig({ litter: 0 });
  for (let i = 0; i < 5; i++) r.lit.refreshLitter();
  expect(r.draws()).toHaveLength(0);
  expect(r.count("drawArrays")).toBe(0);
  expect(r.litter.passes).toBe(0);
  expect(r.litter.ready).toBe(false);
  expect(r.litter.res).toBe(1);
  expect(r.allocs().every((a) => a[3] === 1 && a[4] === 1), "every allocation is the 1×1 default").toBe(true);
  expect(r.allocs()[0].slice(2, 4)).toEqual(["RGBA8", 1]);
  expect(r.count("bufferData")).toBe(0);                                                          // no instance buffer built
  expect(r.count("generateMipmap")).toBe(0);
  expect(r.count("createVertexArray")).toBe(0);                                                   // ...nor a VAO: a look that never opens the gate pays nothing
});

test("litter 1 bakes the carpet: RGBA8 at litter_resolution, premultiplied alpha blend, drop order, one instanced draw, mipped", () => {
  const r = litterRig({ litter: 1, litter_resolution: 512 });
  r.lit.refreshLitter();
  expect(r.draws()).toHaveLength(1);
  expect(r.litter.passes).toBe(1);
  expect(r.litter.ready).toBe(true);
  expect(r.litter.res).toBe(512);
  expect(r.allocs().pop()).toEqual(["TEXTURE_2D", 0, "RGBA8", 512, 512, 0, "RGBA", "UNSIGNED_BYTE", null]);
  const [name, mode, first, verts, n] = r.draws()[0];
  expect([name, mode, first, verts]).toEqual(["drawArraysInstanced", "TRIANGLE_STRIP", 0, 4]);
  const P = r.params, fr = r.litter, want = L.litterInstances(r.hub.grove.litter, P, { ox: fr.ox, oy: fr.oy, ext: fr.ext }, true, 0.75 * fr.ext / 512);
  expect(n).toBe(want.count);
  const data = r.calls.find((c) => c[0] === "bufferData" && c[2] instanceof Float32Array);
  expect(data[2]).toEqual(want.data);                                                             // the buffer IS litterInstances, in drop order
  const blend = r.calls.filter((c) => c[0] === "blendFunc");
  expect(blend).toEqual([["blendFunc", "ONE", "ONE_MINUS_SRC_ALPHA"]]);                          // over, premultiplied: the alpha channel accumulates as 1 − Π(1 − a), not as a·a
  expect(r.calls.some((c) => c[0] === "clearColor" && c.slice(1).join() === "0,0,0,0")).toBe(true);
  const i = (n) => r.calls.findIndex((c) => c[0] === n);
  expect(i("generateMipmap")).toBeGreaterThan(i("drawArraysInstanced"));                          // mipped AFTER the stamps: the far floor is not a shimmer of single texels
  expect(r.calls.some((c) => c[0] === "vertexAttribDivisor")).toBe(true);
  expect(r.calls.filter((c) => c[0] === "disable").map((c) => c[1])).toContain("BLEND");          // and the blend is put back: the next pass is not alpha-blended by accident
});

test("once per regrow: nothing moves, nothing re-bakes — and the live wind, which the carpet must not feel, never does", () => {
  const r = litterRig({ litter: 1 });
  r.lit.refreshLitter();
  for (let i = 0; i < 6; i++) r.lit.refreshLitter();
  expect(r.litter.passes).toBe(1);
  for (const over of [{ wind_strength: 2.5 }, { wind_gustiness: 0.8 }, { weather_variability: 1 }, { sun_elevation_deg: 20 }, { sun_azimuth_deg: 200 }, { canopy_fill: 1 }, { exposure: 2 }]) {
    Object.assign(r.params, over); r.lit.refreshLitter();
  }
  expect(r.litter.passes, "the carpet is the season's: no sun, no gust, no fill moves it").toBe(1);
});

test("…and re-bakes exactly when what it is a function of moves: the grove, the authored wind, the browning, the drift, the season, the size", () => {
  const r = litterRig({ litter: 1 });
  r.lit.refreshLitter();
  let n = 1;
  const moved = (what, f) => { f(); r.lit.refreshLitter(); expect(r.litter.passes, what).toBe(++n); };
  moved("a regrow: the grove is a new value", () => { r.hub.grove = { litter: [...fallen().litter] }; });
  moved("the authored wind direction", () => { r.params.wind_direction_deg += 40; });
  moved("litter_age", () => { r.params.litter_age = 0.3; });
  moved("litter_drift_m", () => { r.params.litter_drift_m = 1.2; });
  moved("leaf_wetness: rain on the carpet re-tints it, and nothing else of it", () => { r.params.leaf_wetness = 0.5; });
  moved("phenology", () => { r.params.phenology = 0.95; });
  moved("the seed", () => { r.params.seed = 99; });
  moved("litter_resolution (and it reallocates)", () => { r.params.litter_resolution = 2048; });
  expect(r.litter.res).toBe(2048);
  moved("the frame: a standing tree is open sky over a padded frame, not a wrapped box", () => { r.params.standing_scene = true; });
});

test("the gate is live both ways: closing it frees the carpet and the floor goes back to the old line; opening it bakes", () => {
  const r = litterRig({ litter: 1 });
  r.lit.refreshLitter();
  expect(r.litter.ready).toBe(true);
  r.params.litter = 0; r.lit.refreshLitter();
  expect(r.litter.ready).toBe(false);
  expect(r.litter.res).toBe(1);
  expect(r.count("deleteTexture")).toBeGreaterThan(0);
  expect(r.litter.passes).toBe(1);
  r.params.litter = 1; r.lit.refreshLitter();
  expect(r.litter.ready).toBe(true);
  expect(r.litter.passes).toBe(2);
});

test("a carpet with nothing on it is not a carpet: no leaf has fallen (no list, or an empty one), so nothing is allocated and the floor is the old floor", () => {
  for (const list of [null, []]) {
    const r = litterRig({ litter: 1 }, { list });
    r.lit.refreshLitter();
    expect(r.draws()).toHaveLength(0);
    expect(r.litter.ready).toBe(false);
    expect(r.litter.res).toBe(1);
  }
  const r = litterRig({ litter: 1 }, { list: null });
  r.hub.grove = { litter: fallen().litter }; r.lit.refreshLitter();                                  // a leaf falls (the season moves on): the carpet appears
  expect(r.litter.ready).toBe(true);
  expect(r.hub.grove).toBeTruthy();
  const none = litterRig({ litter: 1 }); none.hub.grove = null; none.lit.refreshLitter();             // before the first grove exists
  expect(none.litter.ready).toBe(false);
});

test("only the floor bakes it: the curtain, the tent and the sky view pay nothing for a look that asks", () => {
  for (const over of [{ receiver: 1 }, { receiver: 2 }, { sky_view: true }]) {
    const r = litterRig({ litter: 1, ...over });
    for (let i = 0; i < 3; i++) r.lit.refreshLitter();
    expect(r.draws(), JSON.stringify(over)).toHaveLength(0);
    expect(r.litter.ready, JSON.stringify(over)).toBe(false);
    expect(r.litter.res, JSON.stringify(over)).toBe(1);
  }
});

test("the carpet's frame IS the fill's: fillFrame(E, hMax, bulkOn) — computed whether or not canopy_fill is open — and the fill bakes the very same one", () => {
  const E = 12, layerTop = 5 + 3;                                      // the highest of three layers: base + thickness
  const park = litterRig({ litter: 1 });
  park.lit.refreshLitter();
  expect({ ox: park.litter.ox, oy: park.litter.oy, ext: park.litter.ext }).toEqual(fillFrame(E, layerTop, false));
  expect([park.litter.ox, park.litter.oy, park.litter.ext]).toEqual([-6, -6, 12]);                    // the endless park: the box, wrapped
  const tree = litterRig({ litter: 1, standing_scene: true });
  tree.lit.refreshLitter();
  expect({ ox: tree.litter.ox, oy: tree.litter.oy, ext: tree.litter.ext }).toEqual(fillFrame(E, layerTop, true));
  expect(tree.litter.ext).toBe(E + 2 * 3 * layerTop);                                                // padded by 3·h_max on every side
  // the question is the bake module's, asked the same way for every look with a bulk throw (the cloth never bakes a carpet, but its fill is this frame)
  for (const over of [{ standing_scene: true }, { receiver: 1 }, { receiver: 2 }]) expect(litterRig(over).bake.fillFrameNow(), JSON.stringify(over)).toEqual(fillFrame(E, layerTop, true));
  expect(litterRig({}).bake.fillFrameNow()).toEqual(fillFrame(E, layerTop, false));
  const rig = litterRig({});
  expect(rig.bake.fillFrameNow(), "one scratch frame: refreshLitter asks every frame, and a static frame allocates nothing").toBe(rig.bake.fillFrameNow());
  // the faithful tree's layers are where its twigs REALLY grew (faith.binH), and the frame follows them exactly as the fill's does
  const f = litterRig({ litter: 1, standing_scene: true, layer_count: 3 }, { faithful: true });
  f.lit.refreshLitter();
  expect({ ox: f.litter.ox, oy: f.litter.oy, ext: f.litter.ext }).toEqual(fillFrame(E, 9, true));   // max(binH[0..3)) = 9, not the park band's 8
  // both open on one rig: the two textures cover the same square, so a receiver may read one by the other's coordinates
  for (const over of [{}, { standing_scene: true }]) {
    const b = litterRig({ litter: 1, canopy_fill: 1, ...over });
    b.lit.refreshLitter(); b.bake.bakeFill(false);
    expect([b.litter.ox, b.litter.oy, b.litter.ext], JSON.stringify(over)).toEqual([b.fill.ox, b.fill.oy, b.fill.ext]);
  }
});

test("the endless park's carpet REPEATs like its fill; a finite tree's is clamped (empty at the edge of its padded frame)", () => {
  const park = litterRig({ litter: 1 });
  park.lit.refreshLitter();
  expect(park.wraps("REPEAT")).toBeGreaterThan(0);
  const tree = litterRig({ litter: 1, standing_scene: true });
  tree.lit.refreshLitter();
  expect(tree.wraps("REPEAT")).toBe(0);
  expect(tree.wraps("CLAMP_TO_EDGE")).toBeGreaterThan(0);
  // the wrap decides the stamps too: the park's are repeated across the seam, the tree's are not
  const drawn = (r) => r.draws()[0][4];
  expect(drawn(park)).toBeGreaterThan(park.hub.grove.litter.length - 1);
  expect(drawn(tree)).toBeLessThanOrEqual(tree.hub.grove.litter.length);
});

test("the uniforms the bake is handed are the frame it was baked over, and the texel it enlarges a sub-texel leaf to", () => {
  const r = litterRig({ litter: 1, standing_scene: true, litter_resolution: 1024 });
  r.lit.refreshLitter();
  const uni = (name) => r.calls.filter((c) => c[0].startsWith("uniform") && c[1] === name).map((c) => c.slice(2));
  expect(uni("uLitterOrigin")).toEqual([[r.litter.ox, r.litter.oy]]);
  expect(uni("uLitterExtent")).toEqual([[r.litter.ext, r.litter.ext]]);
  expect(uni("uLitterMinHalf")).toEqual([[0.75 * r.litter.ext / 1024]]);
  expect(r.calls.some((c) => c[0] === "viewport" && c[3] === 1024 && c[4] === 1024)).toBe(true);
});

// ---- the engine's own plumbing: a texture, a program, a VAO and a buffer that a lost context or a dispose must not forget. The pixel
// harness runs the real thing (context loss recovers the carpet byte for byte); this holds the lines that make it so.
import { readFileSync } from "node:fs";
test("the engine frees the carpet on dispose and forgets it on a lost context, like the fill it is built beside", () => {
  const src = readFileSync(new URL("./komorebi-engine.js", import.meta.url), "utf8");
  const body = (head) => { const at = src.indexOf(head); return src.slice(at, src.indexOf("\n    },\n", at)); };
  const dispose = body("dispose(){"), restored = src.slice(src.indexOf("function onContextRestored"), src.indexOf("canvas.addEventListener('webglcontextlost'"));
  expect(dispose).toContain("litter.tex");
  expect(dispose).toContain("litterEntry");
  expect(dispose).toContain("litter.vao");
  expect(restored).toContain("litterEntry = null");
  expect(restored).toContain("Object.assign(litter, newLitterState())");
  expect(src).toContain("makeLitter(hub)");                                                          // rebuilt by initGPU, so a restore gets a fresh 1×1 over the new context
  const render = readFileSync(new URL("./komorebi-render.js", import.meta.url), "utf8");
  expect(render).toMatch(/^\s*hub\.refreshLitter\(\);/m);                                           // once per frame (a statement, not the words in a comment), before any target is bound (a re-bake binds its own)
  expect(render.search(/^\s*hub\.refreshLitter\(\);/m)).toBeLessThan(render.indexOf("gl.bindFramebuffer(gl.FRAMEBUFFER, glow ? glowFBO[0] : fbo);"));
});

// ---- the rain day (spec §4.7, "Wet litter"): a dead leaf on the ground soaks, scattering falls as Δn², the leaf darkens and saturates. It is
// applied LAST, to the dry law's output, so the honest reflectance that replaces the dry law later is untouched. 0 is no arithmetic at all.
test("the rain day: WET_RHO is the share of scattering water leaves standing, ((n_wall − n_water)/(n_wall − 1))²", () => {
  expect(L.N_WALL).toBe(1.47); expect(L.N_WATER).toBe(1.333);
  expect(L.WET_RHO).toBeCloseTo(0.085, 3);
  expect(L.WET_RHO).toBeCloseTo(((1.47 - 1.333) / (1.47 - 1)) ** 2, 15);
});

test("the Kubelka–Munk pair round-trips on a log grid, and its ends are exact (no ∞−∞, no NaN)", () => {
  for (let e = -9; e <= -0.0001; e += 0.05) {
    const R = Math.min(10 ** e, 1 - 1e-9);
    expect(Math.abs(L.kmReflect(L.kmInvert(R)) - R) / R, `R ${R}`).toBeLessThan(1e-12);
  }
  expect(L.kmReflect(Infinity)).toBe(0);
  expect(L.kmInvert(1)).toBe(0);
  expect(L.kmReflect(0)).toBe(1);
  expect(L.kmInvert(0)).toBe(Infinity);
});

test("wetten is retired: the wet step is inside the law, and the law no longer reads leafHue", () => {
  expect("wetten" in L).toBe(false);
  const src = readFileSync(new URL("./komorebi-litter.js", import.meta.url), "utf8");
  expect(/import[^\n]*leafHue/.test(src)).toBe(false);
});

test("wetness only darkens: monotone non-increasing in w per channel for every leaf at every age, strictly for 0 < R < 1", () => {
  for (const [name, tau] of Object.entries({ ...TAUS, REDHEAD })) for (const age of [0, 0.5, 1]) {
    let prev = L.litterAlbedo(tau, age, 0);
    for (let i = 1; i <= 200; i++) {
      const a = L.litterAlbedo(tau, age, i / 200);
      for (let c = 0; c < 3; c++) {
        expect(a[c] <= prev[c], `${name} age ${age} ch ${c} w ${i / 200}`).toBe(true);
        if (prev[c] > 0 && prev[c] < 1) expect(a[c] < prev[c], `${name} age ${age} ch ${c} w ${i / 200} strict`).toBe(true);
      }
      prev = a;
    }
  }
});

test("wet litter saturates as it darkens: min/max falls at w 0.5 for every TAUS leaf, the redhead, and brown", () => {
  for (const [name, tau] of Object.entries({ ...TAUS, REDHEAD })) expect(sat(L.litterAlbedo(tau, 0, 0.5)), name).toBeLessThan(sat(L.litterAlbedo(tau, 0, 0)));
  expect(sat(L.litterAlbedo(TAUS.red, 1, 0.5)), "brown").toBeLessThan(sat(L.ALBEDO_BROWN));
});

test("the wet numbers, per channel, at κ 2 and w 0.5: brown ×(.564, .538, .512), a fresh red leaf ×(.685, .553, .549) — the strongly absorbed channels drop most; w is clamped at full soaking", () => {
  const ratios = (age, w) => { const a = L.litterAlbedo(TAUS.red, age, w), d = L.litterAlbedo(TAUS.red, age, 0); return a.map((v, c) => v / d[c]); };
  ratios(1, 0.5).forEach((q, c) => { expect(Math.abs(q - [0.564, 0.538, 0.512][c]), `brown ${c}`).toBeLessThan(0.002); });
  ratios(0, 0.5).forEach((q, c) => { expect(Math.abs(q - [0.685, 0.553, 0.549][c]), `red ${c}`).toBeLessThan(0.002); });
  ratios(0, 1).forEach((q, c) => { expect(Math.abs(q - [0.145, 0.061, 0.058][c]), `red w1 ${c}`).toBeLessThan(0.002); });
  expect(L.litterAlbedo(TAUS.red, 0, 5)).toEqual(L.litterAlbedo(TAUS.red, 0, 1));
});

test("the gate: w ≤ 0 (and NaN) is the dry evaluation to the bit — S_w = 1 and F_w = F exactly, so nothing wet is computed", () => {
  const rnd = math.mulberry32(11);
  for (let i = 0; i < 200; i++) {
    const tau = [rnd() * 3, rnd() * 5, rnd() * 5], age = rnd() * 1.4, want = L.litterAlbedo(tau, age, 0);
    for (const w of [undefined, -0.3, NaN, -0]) { const a = L.litterAlbedo(tau, age, w); for (let c = 0; c < 3; c++) expect(Object.is(a[c], want[c]), `w ${w}`).toBe(true); }
    for (let c = 0; c < 3; c++) {                                                                                    // and the dry value is the unwetted expression, not a lookalike
      const s = math.smoothstep(0, 1, age), q = L.LITTER_KAPPA * ((1 - s) * tau[c] + s * L.TAU_BROWN[c]);
      if (age < 1) expect(Object.is(want[c], L.F_CUTICLE + (1 - L.F_CUTICLE) * L.kmReflect(q))).toBe(true);
    }
  }
});

test("the buffer carries the wet albedo: leaf_wetness 0.5 → litterAlbedo(tau, age, 0.5); 0 → the dry value", () => {
  const { litter, params } = fallen(), ord = L.litterOrder(litter);
  for (const wet of [0, 0.5]) {
    const P = { ...params, leaf_wetness: wet }, inst = L.litterInstances(litter, P, { ox: -50, oy: -50, ext: 100 }, false);
    for (let i = 0; i < ord.length; i += 29) {
      const want = L.litterAlbedo(ord[i].tau, L.litterAge(P, ord[i].D), wet);
      for (let c = 0; c < 3; c++) expect(inst.data[i * L.INSTANCE_FLOATS + 8 + c], `wet ${wet} #${i} ch ${c}`).toBeCloseTo(want[c], 6);
    }
  }
  const a = L.litterInstances(litter, { ...params, leaf_wetness: 0 }, { ox: -50, oy: -50, ext: 100 }, false).data;
  const b = L.litterInstances(litter, { ...params, leaf_wetness: 0.5 }, { ox: -50, oy: -50, ext: 100 }, false).data;
  expect(a).not.toEqual(b);
});

test("leaf_wetness ships 0 and is MORPH-class: the carpet bake alone reads it, so it never regrows the grove", () => {
  expect(DEFAULTS.leaf_wetness).toBe(0);
  expect(MORPH_KEYS).toContain("leaf_wetness");
  expect(CANOPY_KEYS).not.toContain("leaf_wetness");
  expect(TOPO_KEYS).not.toContain("leaf_wetness");
});

test("the re-bake signature holds the wetness (the last slot of a Float64Array is not silently dropped), and holds nothing unrelated", () => {
  expect(L.newLitterState().sig.length).toBe(12);
  const r = litterRig({ litter: 1 });
  r.lit.refreshLitter();
  expect(r.litter.sig[11]).toBe(0);
  r.params.leaf_wetness = 0.5; r.lit.refreshLitter();
  expect(r.litter.sig[11]).toBe(0.5);
  expect(r.litter.passes).toBe(2);
  r.params.exposure = 3; r.lit.refreshLitter();
  expect(r.litter.passes, "an unrelated key does not re-bake").toBe(2);
});

test("the stub-GL rig: rain between two refreshes re-bakes the carpet once, and the same wetness again does not", () => {
  const r = litterRig({ litter: 1, leaf_wetness: 0 });
  r.lit.refreshLitter();
  expect(r.litter.passes).toBe(1);
  r.params.leaf_wetness = 0.5; r.lit.refreshLitter();
  expect(r.litter.passes).toBe(2);
  r.params.leaf_wetness = 0.5; r.lit.refreshLitter(); r.lit.refreshLitter();
  expect(r.litter.passes).toBe(2);
});
