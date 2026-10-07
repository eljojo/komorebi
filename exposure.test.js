// ============================================================================
// Light decides who turns first (spec §4.5, P1): a CPU twin of the layer bake — a plan grid of leaf area per
// height band, walked up a representative sun ray — hands every leaf an exposure, and exposure orders the turn
// (earlier) and scales the red (more). Held loudly because every way it breaks is silent: a ray walked down-sun,
// a grove that reshuffles because the exposure pass ate the growth RNG, a knob at 0 that is not P0, a grove that
// drifts redder because the gain was never normalised. (The leaf.test.js pattern: pure laws + the one place that
// applies them.)
// ============================================================================
import { test, expect } from "bun:test";
import { CANOPY_KEYS, DEFAULTS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import { makeGrove } from "./komorebi-grove.js";
import { PRESETS } from "./presets.js";

const E = DEFAULTS.canopy_extent_m;
const fall = (over) => ({ ...DEFAULTS, ...over });
const tauOf = (p) => [-Math.log(p.trans_r), -Math.log(p.trans_g), -Math.log(p.trans_b)];

// ---- the pure grid: leaves are parallel arrays (x, y, z, area) --------------------------------------------------
const AREA = 0.02;                                                    // m² — about a leaf
// `n` leaves filling a ball of radius r about c: directions by the golden-angle spiral on the sphere, radii by the
// golden-ratio sequence under a cube root (even in volume) — deterministic, no RNG
function crown(c, r, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const zz = 1 - (2 * (i + 0.5)) / n, rho = Math.sqrt(1 - zz * zz), az = i * Math.PI * (3 - Math.sqrt(5));
    const rad = r * Math.cbrt(((i + 0.5) * 0.6180339887) % 1);
    out.push([c[0] + rad * rho * Math.cos(az), c[1] + rad * rho * Math.sin(az), c[2] + rad * zz]);
  }
  return out;
}
const expose = (pts, area = AREA) => math.exposureGrid(pts.map((p) => p[0]), pts.map((p) => p[1]), pts.map((p) => p[2]), pts.map(() => area), E);
// the unit step toward the sun, in the engine's own frame (the ONE place that convention lives is sunDirection)
const SUN = math.sunDirection([0, 0, 0], 45, 180);
const along = (p, d) => [p[0] + (SUN[0] / SUN[2]) * d, p[1] + (SUN[1] / SUN[2]) * d, p[2] + d];   // d metres up the 45° ray (d metres horizontal, d metres up)

test("the representative sun is the season's: 45° up, due south — and south is azimuth 180° in this engine", () => {
  // updateSunFromTime (editor.js): solar noon at az 180, "east → south → west" is 90 → 180 → 270. A sun at 180 stands at -x.
  expect(math.SEASON_SUN).toEqual({ el: 45, az: 180 });
  expect(SUN[0]).toBeLessThan(-0.7);
  expect(Math.abs(SUN[1])).toBeLessThan(1e-12);
  expect(SUN[2]).toBeCloseTo(Math.SQRT1_2, 12);
});

test("a leaf under a dense cluster is less exposed than the top leaf at its own plan position", () => {
  const probe = [0.07, 0.05, 1], top = [0.07, 0.05, 8];                // (off every cell edge: a probe ON one has a zero-length first step and hides what that step is for)
  const wood = crown(along(probe, 3), 0.4, 60);                       // a bunch squarely ON the probe's ray, three metres up it
  const e = expose([probe, top, ...wood]);
  expect(e[1]).toBe(1);                                               // nothing above the topmost leaf of the scene: not close, one
  expect(e[0]).toBeLessThan(0.5);
  expect(e[0]).toBeGreaterThan(0);
});

test("only the sun's side shades: a lone leaf is fully lit, and so is one with a bunch down-sun, above or below its ray", () => {
  const probe = [0.07, 0.05, 1], top = [0.07, 0.05, 8];
  expect(expose([probe, [4, 4, 8]])[0]).toBe(1);                      // a leaf does not shade itself (the top is elsewhere, so the probe is not the scene's highest)
  const behind = crown([3, 0, 4], 0.4, 60);                           // the mirror image of the ray: +x, away from the sun
  expect(expose([probe, top, ...behind])[0]).toBe(1);
  // and a bunch the ray passes ABOVE or BELOW is not in the way: shading is along the ray, not a column
  const overhead = crown([0.07, 0.05, 6], 0.4, 60), under = crown(along(probe, 3).map((v, i) => (i === 2 ? 1.0 : v)), 0.2, 60);
  expect(expose([probe, top, ...overhead])[0]).toBe(1);
  expect(expose([probe, top, ...under])[0]).toBe(1);
});

test("a lone tree's topmost leaves get exposure ~1, its interior far less", () => {
  const { leaves, e } = exposedGrove({ tree_count: 1 });   // one of the afternoon look's trees, alone
  const zmax = Math.max(...leaves.z), zs = [...leaves.z].sort((a, b) => b - a), cut = zs[Math.floor(zs.length * 0.03)];
  const top = [...leaves.z.keys()].filter((i) => leaves.z[i] === zmax);
  expect(top.length).toBeGreaterThan(0);
  for (const i of top) expect(e[i], `leaf ${i} at the very top`).toBeGreaterThan(0.999);
  const upper = [...leaves.z.keys()].filter((i) => leaves.z[i] >= cut);
  const mean = upper.reduce((s, i) => s + e[i], 0) / upper.length;
  expect(mean, "top 3 % of the crown by height").toBeGreaterThan(0.8);
  expect(Math.min(...e), "an inside leaf is mostly buried").toBeLessThan(0.1);
  const lower = [...leaves.z.keys()].filter((i) => leaves.z[i] <= zs[Math.floor(zs.length * 0.67)]);   // the lowest third of the crown, by leaf count
  expect(mean - lower.reduce((s, i) => s + e[i], 0) / lower.length, "the crown's top is lighter than its underside").toBeGreaterThan(0.1);
});

test("between-tree shading: a leaf a neighbour's crown stands up-sun of is darker than the same leaf alone", () => {
  const probe = [0.07, 0.05, 3];
  const own = crown([0, 0, 2.2], 0.6, 80);                            // its own crown, lower than it: no self-shading either way
  const neighbour = crown([-4, 0, 7], 1.5, 400);                      // a taller tree 4 m up-sun, in the ray's path (3 + 4 = 7 m up)
  const alone = expose([probe, ...own]), shaded = expose([probe, ...own, ...neighbour]);
  expect(alone[0]).toBe(1);
  expect(shaded[0]).toBeLessThan(0.5 * alone[0]);
  // the same neighbour on the other side of the leaf (down-sun) does nothing
  const behind = expose([probe, ...own, ...crown([4, 0, 7], 1.5, 400)]);
  expect(behind[0]).toBe(1);
});

test("the ground-shade hook is the identity until a valley supplies one", () => {
  expect(math.groundShade(0, 0)).toBe(1);
  expect(math.groundShade(-3.7, 11.2)).toBe(1);
});

test("a leaf's rank in its grove is its percentile: monotone, ties alike, the mean exactly one half", () => {
  const ex = Float64Array.from([0.9, 0.1, 0.5, 0.5, 1, 0.01, 0.5, 0.3]);
  const u = math.exposureRank(ex);
  expect(Math.abs(u.reduce((s, v) => s + v, 0) / u.length - 0.5)).toBeLessThan(1e-12);   // so a grove's mean turn time and mean red gain are P0's, not "about"
  expect(u[2]).toBe(u[3]); expect(u[3]).toBe(u[6]);
  for (let i = 0; i < ex.length; i++) {
    expect(u[i] > 0 && u[i] < 1, `rank ${u[i]}`).toBe(true);
    for (let j = 0; j < ex.length; j++) if (ex[i] < ex[j]) expect(u[i], `${ex[i]} below ${ex[j]}`).toBeLessThan(u[j]);
  }
  expect(math.exposureRank(new Float64Array(0)).length).toBe(0);
});

test("the two maps are monotone and keep their ranges: turn order in [0,1), red gain 0.5..1.5 and mean 1", () => {
  let prevPhi = Infinity, prevGain = -Infinity, sum = 0;
  for (let i = 0; i <= 20; i++) {
    const u = i / 20, phi = math.turnOrder(u), gain = math.redGain(u);
    expect(phi >= 0 && phi < 1, `turnOrder(${u}) = ${phi}`).toBe(true);
    expect(phi <= prevPhi, `a more exposed leaf must turn no later (u ${u})`).toBe(true);
    expect(gain > prevGain && gain >= 0.5 && gain <= 1.5, `redGain(${u}) = ${gain}`).toBe(true);
    prevPhi = phi; prevGain = gain; sum += gain;
  }
  expect(math.turnOrder(1)).toBe(0);                                  // the most exposed turns at turn_start, the earliest a leaf can
  expect(math.turnOrder(0)).toBeLessThan(1);                          // the least turns with the last: still a valid hash value
  expect(sum / 21).toBeCloseTo(1, 12);                                // an evenly spread rank averages gain 1
});

// ---- the grove: one place applies the laws, and must not touch the growth RNG -----------------------------------
// buildGrove allocates GL buffers; a recording stub is enough to read the exact floats it uploads. (leaf.test.js's, too.)
function growWith(over, faithful = false) {
  const gl = new Proxy({}, {
    get(t, name) {
      if (name === "createBuffer") return () => ({ data: null });
      if (name === "bindBuffer") return (_, b) => { t.cur = b; };
      if (name === "bufferData") return (_, data) => { if (t.cur) t.cur.data = data; };
      return () => ({});
    },
  });
  const params = fall({ tree_count: 2, leaves_per_cluster: 5, foliage_density: 1.5, layer_count: 2, ...over });
  const faith = {}, hub = { gl, params, MAX_TEX: 4096, quadBuf: {}, faithfulOn: () => faithful, occ: {}, faith, sky: { start: [], count: [] } };
  const g = makeGrove(hub).buildGrove(null);
  return { params, g, layers: g.layerVAO.map((l) => Array.from(l.buf.data)), faithLeaves: Array.from(faith.buf.data) };
}
// faithful record: [x,y,A,B0, angle,tilt,swingGain,swingPhase, tau.rgb,cluster, orbit×4, z, fade] = 18 floats
const STRIDE = 18;
const isTau = (i, stride) => i % stride >= 8 && i % stride <= 10;
const sansTau = (arr, stride) => arr.filter((_, i) => !isTau(i, stride));
const firstDiff = (a, b) => (a.length !== b.length ? Math.min(a.length, b.length) : a.findIndex((v, i) => !Object.is(v, b[i])));
// the leaves of a grove as the exposure pass sees them (area is the ellipse × the leaf's fade), and their exposure
function leavesOf(faithLeaves) {
  const L = { x: [], y: [], z: [], a: [], j: [], fade: [] };
  for (let i = 0; i + STRIDE <= faithLeaves.length; i += STRIDE) {
    L.x.push(faithLeaves[i]); L.y.push(faithLeaves[i + 1]); L.z.push(faithLeaves[i + 16]); L.fade.push(faithLeaves[i + 17]);
    L.a.push(Math.PI * faithLeaves[i + 2] * faithLeaves[i + 3] * faithLeaves[i + 17]); L.j.push(faithLeaves[i + 11]);
  }
  return L;
}
// a grove with a crown worth shading itself: the afternoon look's own leaves, whole (no marginal leaf or tree, so every one counts)
const dense = (over) => ({ ...PRESETS["afternoon 7"], leaves_per_cluster: 40, foliage_density: 1, tree_count: 3, ...over });
function exposedGrove(over) {
  const { faithLeaves, params } = growWith(dense({ phenology: 0.5, ...over }), true);
  const leaves = leavesOf(faithLeaves);
  return { leaves, e: math.exposureGrid(leaves.x, leaves.y, leaves.z, leaves.a, params.canopy_extent_m), params };
}
const corr = (u, v) => {
  const n = u.length, mu = u.reduce((s, x) => s + x, 0) / n, mv = v.reduce((s, x) => s + x, 0) / n;
  let suv = 0, suu = 0, svv = 0;
  for (let i = 0; i < n; i++) { suv += (u[i] - mu) * (v[i] - mv); suu += (u[i] - mu) ** 2; svv += (v[i] - mv) ** 2; }
  return suv / Math.sqrt(suu * svv);
};
const MID = dense({ phenology: 0.75 });                              // mid-turn: some leaves have turned, some have not

test("determinism: two builds agree to the bit, and the exposure pass never touches the growth RNG", () => {
  for (const faithful of [false, true]) {
    const over = { phenology: 0.8, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, turn_exposure: 1 };
    const a = growWith(over, faithful), b = growWith(over, faithful);
    for (const [i, l] of a.layers.entries()) expect(firstDiff(b.layers[i], l), `layer ${i}, faithful ${faithful}`).toBe(-1);
    expect(firstDiff(b.faithLeaves, a.faithLeaves)).toBe(-1);
    // geometry is the growth stream's: identical with the knob down and up. Only the tau slots may move.
    const off = growWith({ ...over, turn_exposure: 0 }, faithful);
    expect(JSON.stringify(a.g.hier.segments)).toBe(JSON.stringify(off.g.hier.segments));
    expect(JSON.stringify(a.g.hier.twigs)).toBe(JSON.stringify(off.g.hier.twigs));
    for (const [i, l] of off.layers.entries()) expect(firstDiff(sansTau(a.layers[i], 17), sansTau(l, 17)), `layer ${i}`).toBe(-1);
    expect(firstDiff(sansTau(a.faithLeaves, STRIDE), sansTau(off.faithLeaves, STRIDE))).toBe(-1);
    expect(firstDiff(a.faithLeaves, off.faithLeaves), "not vacuous: the tau slots moved").toBeGreaterThanOrEqual(0);
  }
});

test("the knob ships off, and is a canopy knob: it morphs the same grove", () => {
  expect(DEFAULTS.turn_exposure).toBe(0);
  expect(CANOPY_KEYS).toContain("turn_exposure");
});

test("exposure never touches a leaf's own hash: a whisper of turn_exposure is a whisper of change", () => {
  // any extra draw from the leaf stream would re-roll every leaf's red and brown at once, however small the knob
  const base = { ...MID, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2 };
  const off = growWith({ ...base, turn_exposure: 0 }, true).faithLeaves, whisper = growWith({ ...base, turn_exposure: 1e-6 }, true).faithLeaves;
  let worst = 0;
  for (let i = 0; i + STRIDE <= off.length; i += STRIDE) for (let c = 8; c <= 10; c++) worst = Math.max(worst, Math.abs(whisper[i + c] - off[i + c]));
  expect(worst).toBeLessThan(1e-3);
  expect(worst, "not vacuous: the whisper is not nothing").toBeGreaterThan(0);
});

// P0's leafTau (db8c65b), frozen: what turn_exposure 0 must reproduce to the bit. It is deliberately not imported —
// a leafTau edited for exposure that quietly changed the zero case would still agree with itself.
function leafTauP0(tauSummer, P, seed, j, k) {
  const r = math.mulberry32(math.hash3((seed >>> 0) ^ 0x51ED270B, j, k));
  const s = math.senescence(P, r());
  if (s === 0) return [tauSummer[0], tauSummer[1], tauSummer[2]];
  const a = P.anthocyanin * (0.5 + r()), b = P.tannin * (0.5 + r());
  const cell = [0, 0, 0], wall = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const base = tauSummer[c] * (1 - s), pig = math.TAU_CAROTENOID[c] + b * math.TAU_TANNIN[c];
    wall[c] = base + s * pig; cell[c] = base + s * (pig + a * math.TAU_ANTHOCYANIN[c]);
  }
  return Array.from(math.mixtureTau(wall, cell, P.wall_fraction));
}

test("turn_exposure 0 is P0 for every leaf, at phenology 0.75 and 1.0", () => {
  const nLeaf = 8, frac = 0.5;                                        // 5 × 1.5 = 7.5 leaves per twig: seven whole, one half
  for (const ph of [0.75, 1.0]) {
    const over = { phenology: ph, anthocyanin: 0.8, tannin: 0.3, wall_fraction: 0.2, turn_exposure: 0 };
    const { params, faithLeaves, layers } = growWith(over, true);
    const tau = tauOf(params);
    let n = 0, turned = 0;
    for (let i = 0; i + STRIDE <= faithLeaves.length; i += STRIDE) {
      const j = faithLeaves[i + 11], k = (i / STRIDE) % nLeaf, cov = k === 7 ? frac : 1;
      const want = leafTauP0(tau, params, params.seed, j, k);
      for (let c = 0; c < 3; c++) expect(faithLeaves[i + 8 + c], `phenology ${ph}, leaf ${j}/${k}, channel ${c}`).toBe(Math.fround(want[c] * cov));
      if (want[1] !== tau[1]) turned++;
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(turned, "not vacuous: leaves have turned").toBeGreaterThan(n * 0.2);
    expect(layers.flat().length / 17).toBe(n);
  }
});

test("both buffers carry the same exposed tau: the layer path and the faithful path see one grove", () => {
  const over = { ...MID, anthocyanin: 0.8, tannin: 0.2, wall_fraction: 0.2, turn_exposure: 0.7 };
  const { g, layers, faithLeaves } = growWith(over, true);
  const want = layers.map(() => []);
  for (let i = 0; i + STRIDE <= faithLeaves.length; i += STRIDE) want[g.hier.twigs[faithLeaves[i + 11]].layer].push(faithLeaves[i + 8], faithLeaves[i + 9], faithLeaves[i + 10]);
  let n = 0;
  for (const [l, buf] of layers.entries()) {
    const got = [];
    for (let i = 0; i + 17 <= buf.length; i += 17) got.push(buf[i + 8], buf[i + 9], buf[i + 10]);
    expect(firstDiff(got, want[l]), `layer ${l}`).toBe(-1);
    n += got.length;
  }
  expect(n).toBeGreaterThan(300);
});

test("with turn_exposure 1 at mid-turn, the sunlit turn first and the red goes to the sunlit", () => {
  // anthocyanin 0 makes tau_r = summer*(1-s) + s*car_r: s_j is recoverable from the red channel, exactly.
  const plain = growWith({ ...MID, anthocyanin: 0, turn_exposure: 1 }, true);
  const lv = leavesOf(plain.faithLeaves);
  const e = math.exposureGrid(lv.x, lv.y, lv.z, lv.a, plain.params.canopy_extent_m);
  const tau = tauOf(plain.params);
  const full = [...lv.fade.keys()].filter((i) => lv.fade[i] === 1);   // whole leaves only: tau is stored times the fade
  const sOf = (buf, i) => (tau[0] - buf[i * STRIDE + 8]) / (tau[0] - math.TAU_CAROTENOID[0]);
  const s = full.map((i) => sOf(plain.faithLeaves, i));
  expect(Math.min(...s), "mid-turn: some have not begun").toBeLessThan(0.02);
  expect(Math.max(...s), "mid-turn: some are well on").toBeGreaterThan(0.4);
  const rS = corr(full.map((i) => e[i]), s);
  expect(rS, "exposure vs the turned state s_j").toBeGreaterThan(0.9);
  const red = growWith({ ...MID, anthocyanin: 0.8, turn_exposure: 1 }, true);
  const rG = corr(full.map((i) => e[i]), full.map((i) => red.faithLeaves[i * STRIDE + 9]));
  expect(rG, "exposure vs red depth (tau_g)").toBeGreaterThan(0.7);
  // the control: with the knob down the order is the hash's, which knows nothing of the light
  const off = growWith({ ...MID, anthocyanin: 0, turn_exposure: 0 }, true);
  expect(Math.abs(corr(full.map((i) => e[i]), full.map((i) => sOf(off.faithLeaves, i))))).toBeLessThan(0.15);
});

test("the look's own turn schedule survives: exposure decides WHO turns, not how much of the grove has", () => {
  // s_j > 0 is read off the red channel (anthocyanin 0 leaves it summer*(1-s) + s*car). Early in the turn (phenology 0.65, a
  // leaf has begun iff phi < 0.28) the share that has begun IS the CDF of the start times at one point: ranked exposure is
  // uniform on (0,1) like the hash it blends with, so at full strength it is P0's share whatever the grove's density. The raw
  // exposure of a dense grove (mean ~0.3) would have put it near a fifth lower — a look that goes green when this knob goes up.
  const began = (over) => {
    const { faithLeaves, params } = growWith({ ...MID, phenology: 0.65, anthocyanin: 0, ...over }, true), tau = tauOf(params);
    let k = 0, n = 0;
    for (let i = 0; i + STRIDE <= faithLeaves.length; i += STRIDE) { if (faithLeaves[i + 8] < Math.fround(tau[0]) - 1e-6) k++; n++; }
    return k / n;
  };
  const p0 = began({ turn_exposure: 0 });
  expect(p0, "P0's share is the uniform's: (0.65 - 0.6)/0.18").toBeGreaterThan(0.25);
  expect(p0).toBeLessThan(0.31);
  expect(Math.abs(began({ turn_exposure: 1 }) - p0), "turn_exposure 1").toBeLessThan(0.02);
  // (Between 0 and 1 the mix of two independent uniforms keeps P0's MEAN start time but narrows its spread — the tail share at
  // one half is 0.12 off — so the leaves turn a little more together than the hash alone. Documented in §4.5, not held here.)
});

test("the grove's mean red capacity does not drift: within 0.5 % at any strength", () => {
  // phenology 1: every s_j = 1, no vein share, no tannin, so tau_g = car_g + a_j * ant_g and a_j comes straight back out.
  // A whole-leaf grove (integer leaves per cluster and trees): every leaf counts in the normalisation and in this mean.
  const cap = (over) => {
    const { faithLeaves, params } = growWith(dense({ phenology: 1, anthocyanin: 0.8, tannin: 0, wall_fraction: 0, ...over }), true);
    const m = [];
    for (let i = 0; i + STRIDE <= faithLeaves.length; i += STRIDE) m.push((faithLeaves[i + 9] - math.TAU_CAROTENOID[1]) / math.TAU_ANTHOCYANIN[1] / params.anthocyanin);
    return m.reduce((s, x) => s + x, 0) / m.length;
  };
  const p0 = cap({ turn_exposure: 0 });
  expect(p0).toBeGreaterThan(0.9); expect(p0).toBeLessThan(1.1);      // the hash's own 0.5..1.5 averages 1
  // The gains are divided by their grove mean, so mean(gain) is exactly 1; what is left is the sample covariance of that gain
  // with each leaf's own independent hash, ~ sigma_a sigma_g / sqrt(n) = 0.3 * 0.3 / sqrt(12000) < 0.1 % (measured 0.04 %).
  for (const w of [0.5, 1]) expect(Math.abs(cap({ turn_exposure: w }) / p0 - 1), `turn_exposure ${w}`).toBeLessThan(0.005);
  // and it is not preserved by doing nothing: the spread of capacity across leaves really widened
  const spread = (over) => {
    const { faithLeaves } = growWith(dense({ phenology: 1, anthocyanin: 0.8, ...over }), true);
    const g = []; for (let i = 0; i + STRIDE <= faithLeaves.length; i += STRIDE) g.push(faithLeaves[i + 9]);
    return Math.max(...g) / Math.min(...g);
  };
  expect(spread({ turn_exposure: 1 })).toBeGreaterThan(spread({ turn_exposure: 0 }) * 1.2);
});
