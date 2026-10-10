// ============================================================================
// The held leaf (spec §4.5, "The held leaf"): an editor-only proof fixture that grows ONE leaf's areole maze at full resolution — walls gold, cells red —
// against the sun. The engine carries that maze only as a mean (`wall_fraction`), and must stay so; this holds the fixture to the engine's own numbers:
// the veins are the outline's veins (bladeOf), the tissues are leafTau's (to the bit), the walls' share is wall_fraction, and so the picture's mean is the
// mixture the engine computes. The claims worth holding loudly are the ones that fail silently: a maze whose cells do not tile the leaf, a wall that ends in
// mid-air, a share that drifts from the knob, a fixture that leaks into a bundle.
// ============================================================================
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { DEFAULTS } from "./komorebi.js";
import * as math from "./komorebi-math.js";
import * as LEAF from "./komorebi-leaf.js";
import * as MAZE from "./leaf-maze.js";

const { MAPLE, growLeaf, profile, bladeOf, outlineSeed, leafVariant, LEAF_SAMPLES } = LEAF;
const TAU = math.TAU;
const SIZE = 0.103, UNIT = SIZE / 2, A_CELL = (MAZE.AREOLE_M / UNIT) ** 2;

// ---- one blade, one stream ---------------------------------------------------------------------------------------------------
test("bladeOf is profile's body with its skeleton and scale kept: r to the bit, the skeleton growLeaf's own, over 3 seeds x 8 variants", () => {
  for (const seed of [1234, 77, 4242]) for (let v = 0; v < 8; v++) {
    const vs = outlineSeed(MAPLE, seed, v), b = bladeOf(MAPLE, vs), r = profile(MAPLE, vs);
    expect(b.r.length).toBe(LEAF_SAMPLES);
    for (let i = 0; i < LEAF_SAMPLES; i++) expect(Object.is(b.r[i], r[i])).toBe(true);
    expect(b.skel).toEqual(growLeaf(MAPLE, math.mulberry32(vs)));
    expect(b.k).toBeGreaterThan(0);
  }
});

test("the central primary's tip, scaled by k, is the blade's reach along it: the skeleton and the outline share one frame", () => {
  for (const seed of [1234, 77, 4242]) for (let v = 0; v < 8; v++) {
    const b = bladeOf(MAPLE, outlineSeed(MAPLE, seed, v)), tip = b.skel.veins[2].b, len = Math.hypot(tip[0], tip[1]) * b.k, ang = Math.atan2(tip[1], tip[0]);
    let reach = 0;                                                  // the support of the outline along the primary: the lobe's tip is sub-sample narrow, so no single sample sits on it
    for (let i = 0; i < LEAF_SAMPLES; i++) reach = Math.max(reach, b.r[i] * Math.cos(TAU * ((i + 0.5) / LEAF_SAMPLES - 0.5) - ang));
    expect(Math.abs(reach - len)).toBeLessThan(0.04 * len);          // 256 samples round a lobe's tip off by a few %, so not 1e-3; a frame slip (k) would be ~2x
  }
});

// ---- the tissues, from the engine's own function ----------------------------------------------------------------------------
const tauOf = (P) => [P.trans_r, P.trans_g, P.trans_b].map((t) => -Math.log(Math.min(0.999, Math.max(1e-4, t))));
test("two calls to leafTau give the tissues, and mixtureTau of them is leafTau's mixture to the bit, over 200 random leaves past the turn", () => {
  const rnd = math.mulberry32(99);
  for (let n = 0; n < 200; n++) {
    const P = { ...DEFAULTS, phenology: 0.5 + 0.5 * rnd(), turn_start: 0.3, turn_span: 0.3, turn_spread: 0.2 * rnd(), anthocyanin: 1.2 * rnd(), tannin: rnd(), wall_fraction: 0.01 + 0.5 * rnd() };
    const seed = Math.floor(rnd() * 1e6), j = Math.floor(rnd() * 40), k = Math.floor(rnd() * 22), { wall, cell } = MAZE.tissues(P, seed, j, k);
    const mix = math.mixtureTau(wall, cell, P.wall_fraction), tau = math.leafTau(tauOf(P), P, seed, j, k);
    for (let c = 0; c < 3; c++) expect(Object.is(mix[c], tau[c])).toBe(true);
  }
});

test("tissues with a tree's lead and depth are leafTau's with the same, to the bit; handed neither they are the call they were; the walls brown with the tree and the cells redden with it", () => {
  const rnd = math.mulberry32(41);
  for (let n = 0; n < 200; n++) {
    const P = { ...DEFAULTS, phenology: 0.5 + 0.5 * rnd(), turn_start: 0.3, turn_span: 0.3, turn_spread: 0.2 * rnd(), anthocyanin: 1.2 * rnd(), tannin: rnd(), wall_fraction: 0.01 + 0.5 * rnd(), drop_after_turn: n % 2 };
    const seed = Math.floor(rnd() * 1e6), j = Math.floor(rnd() * 40), k = Math.floor(rnd() * 22), dT = -0.15 * rnd() ** 3, cT = 1 + 0.9 * (2 * rnd() - 1);
    const { wall, cell } = MAZE.tissues(P, seed, j, k, dT, cT);
    const mix = math.mixtureTau(wall, cell, P.wall_fraction), tau = math.leafTau(tauOf(P), P, seed, j, k, undefined, undefined, undefined, dT, cT);
    for (let c = 0; c < 3; c++) expect(Object.is(mix[c], tau[c])).toBe(true);
    const bare = MAZE.tissues(P, seed, j, k), none = MAZE.tissues(P, seed, j, k, undefined, undefined);
    for (let c = 0; c < 3; c++) { expect(Object.is(bare.wall[c], none.wall[c])).toBe(true); expect(Object.is(bare.cell[c], none.cell[c])).toBe(true); }
  }
  // the depth acts on the leaf's pigments only: at the end of the turn the cells part from the walls by a·anthocyanin, and a is c times the tree-less leaf's
  const P = { ...DEFAULTS, phenology: 1, turn_start: 0.6, turn_span: 0.3, anthocyanin: 0.8, tannin: 0.5 };
  const base = MAZE.tissues(P, 5, 3, 4), deep = MAZE.tissues(P, 5, 3, 4, undefined, 1.5);
  expect((deep.cell[1] - deep.wall[1]) / (base.cell[1] - base.wall[1])).toBeCloseTo(1.5, 9);
  expect(deep.wall[0] - base.wall[0], "the walls brown with the tree (tannin is in both tissues)").toBeGreaterThan(0.1);
});

test("tissues: before the turn wall = cell = the summer tau; at the end of it the walls are gold and the cells red", () => {
  const P = { ...DEFAULTS, turn_start: 0.6, turn_span: 0.3, turn_spread: 0.18, anthocyanin: 0.8 }, summer = tauOf(P);
  for (const phenology of [0, 0.3, 0.6]) {
    const { wall, cell } = MAZE.tissues({ ...P, phenology }, 5, 3, 4);
    for (let c = 0; c < 3; c++) { expect(Object.is(wall[c], summer[c])).toBe(true); expect(Object.is(cell[c], summer[c])).toBe(true); }
  }
  const wallRatio = [], cellRatio = [];
  for (let k = 0; k < 40; k++) {
    const { wall, cell } = MAZE.tissues({ ...P, phenology: 1 }, 5, 3, k);
    wallRatio.push(Math.exp(-wall[1]) / Math.exp(-wall[0]));
    cellRatio.push(Math.exp(-cell[1]) / Math.exp(-cell[0]));
  }
  cellRatio.sort((a, b) => a - b);
  for (const r of wallRatio) expect(r).toBeGreaterThan(0.5);                         // gold: green passes nearly as red does
  expect(cellRatio[20]).toBeLessThan(0.15);                                          // red: a leaf's anthocyanin is 0.5-1.5 x the knob, so the MEDIAN leaf, not the palest
  expect(cellRatio[39]).toBeLessThan(0.3);
});

// ---- the maze --------------------------------------------------------------------------------------------------------------
const blade0 = bladeOf(MAPLE, outlineSeed(MAPLE, 1234, 0));
const opts = (seed) => ({ seed, cellM: MAZE.AREOLE_M, unitM: UNIT });
const maze = MAZE.growAreoles(blade0, opts(1));
const margin = MAZE.marginOf(blade0);
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

test("the maze is pure: regrown it is bit-equal, another seed grows another, and AREOLE_SALT is a stream of its own", () => {
  expect(MAZE.growAreoles(blade0, opts(1))).toEqual(maze);
  expect(MAZE.growAreoles(blade0, opts(2))).not.toEqual(maze);
  const salts = [MAZE.AREOLE_SALT, LEAF.VARIANT_SALT, LEAF.OUTLINE_SALT, LEAF.GENOTYPE_SALT, 0x2B9D4F6E /* litter */, 0x51ED270B /* pigment */, 0x7A3C91D5 /* drop */, 0x5bd1e995 /* wind */, 0x5EED /* growth */];
  expect(new Set(salts).size).toBe(salts.length);
});

test("the cells tile the margin polygon: areas sum to it to 1e-9, every cell simple, positive and no bigger than a cell of the species", () => {
  const total = area(margin);
  expect(Math.abs(maze.cells.reduce((s, c) => s + area(c.poly), 0) / total - 1)).toBeLessThan(1e-9);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hit = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  for (const c of maze.cells) {
    const a = area(c.poly);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(A_CELL * (1 + 1e-9));
    const n = c.poly.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) expect(hit(c.poly[i], c.poly[(i + 1) % n], c.poly[j], c.poly[(j + 1) % n])).toBe(false);
  }
  const d = maze.cells.map((c) => 2 * Math.sqrt(area(c.poly) / Math.PI) * UNIT * 1000).sort((x, y) => x - y);   // mm
  const med = d[d.length >> 1];
  expect(med).toBeGreaterThan(0.7);
  expect(med).toBeLessThan(1.4);
});

// the nearest the point sits to any wall older than index `idx`, or the margin
const toOlder = (p, idx) => {
  let best = Infinity;
  for (let i = 0; i < idx; i++) best = Math.min(best, segDist(p, maze.walls[i].a, maze.walls[i].b));
  for (let i = 0; i < margin.length; i++) best = Math.min(best, segDist(p, margin[i], margin[(i + 1) % margin.length]));
  return best;
};
const foldedAngle = (u, v) => { const c = Math.abs(u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)); return Math.acos(Math.min(1, c)) / math.DEG; };   // 0..90
const dirOf = (w) => [w.b[0] - w.a[0], w.b[1] - w.a[1]];
// the wall (older than idx) nearest the point, and the margin edge if that is nearer
const meets = (p, idx) => {
  let best = Infinity, dir = null;
  for (let i = 0; i < idx; i++) { const d = segDist(p, maze.walls[i].a, maze.walls[i].b); if (d < best) { best = d; dir = dirOf(maze.walls[i]); } }
  for (let i = 0; i < margin.length; i++) { const a = margin[i], b = margin[(i + 1) % margin.length], d = segDist(p, a, b); if (d < best) { best = d; dir = [b[0] - a[0], b[1] - a[1]]; } }
  return dir;
};

// A junction's arms, from the walls themselves: every wall that touches the point (within 1e-9) contributes its direction pointing away from it, as an angle in
// degrees, and a wall that passes through contributes two. A Y is three arms pairwise 120 degrees apart (within 15): a T has two of them collinear.
const armsAt = (p, walls) => {
  const arms = [], dir = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]) / math.DEG;
  for (const w of walls) {
    if (Math.hypot(w.a[0] - p[0], w.a[1] - p[1]) < 1e-9) arms.push(dir(p, w.b));
    else if (Math.hypot(w.b[0] - p[0], w.b[1] - p[1]) < 1e-9) arms.push(dir(p, w.a));
    else if (segDist(p, w.a, w.b) < 1e-9) arms.push(dir(p, w.a), dir(p, w.b));
  }
  return arms;
};
const gapDeg = (x, y) => { const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };
const isY = (arms) => arms.length === 3 && [[0, 1], [0, 2], [1, 2]].every(([p, q]) => Math.abs(gapDeg(arms[p], arms[q]) - 120) <= 15);

test("the Y classifier can fail: three walls meeting at 120 degrees count 1, a wall met square by another counts 0", () => {
  const P = [3, 4], at = (deg, len = 1) => [P[0] + len * Math.cos(deg * math.DEG), P[1] + len * Math.sin(deg * math.DEG)];
  const y = [{ a: P, b: at(10) }, { a: at(130), b: P }, { a: P, b: at(250, 2) }];          // 10, 130, 250: pairwise 120; one wall ends there, one starts there
  expect(armsAt(P, y).length).toBe(3);
  expect(isY(armsAt(P, y))).toBe(true);
  const t = [{ a: at(0, -1), b: at(0, 1) }, { a: P, b: at(90) }];                           // one wall passing through, one starting on it
  expect(armsAt(P, t).length).toBe(3);
  expect(isY(armsAt(P, t))).toBe(false);
  const nearY = [{ a: P, b: at(0) }, { a: P, b: at(100) }, { a: P, b: at(250) }];            // 0, 100, 250: gaps 100, 110, 150: 150 is not 120 +/- 15
  expect(isY(armsAt(P, nearY))).toBe(false);
  expect([y, t].map((walls) => [P].filter((q) => isY(armsAt(q, walls))).length)).toEqual([1, 0]);
  expect(armsAt([99, 99], y)).toEqual([]);                                                  // a point on no wall has no arms
});

test("T-junctions: every wall of order >= 2 ends on an older wall or the margin; chords meet at ~90 degrees and no junction is a Y", () => {
  const angles = [];
  maze.walls.forEach((w, i) => {
    if (w.order < 2 || (w.order >= 3 && i % 7)) return;               // every secondary, and every 7th chord: the check is O(walls) a wall
    for (const p of [w.a, w.b]) expect(toOlder(p, i)).toBeLessThan(1e-9);
    if (w.order >= 3) for (const p of [w.a, w.b]) { const m = meets(p, i); if (Math.hypot(...m) > 1e-9) angles.push(foldedAngle(dirOf(w), m)); }
  });
  angles.sort((a, b) => a - b);
  const med = angles[angles.length >> 1];
  expect(Math.abs(med - 90)).toBeLessThan(10);
  expect(angles.filter((a) => Math.abs(a - 90) <= 25).length / angles.length).toBeGreaterThanOrEqual(0.8);
  // a T has two of its three arms collinear (180 degrees apart): a Y has none. The arms are read off the REAL walls at the chord's two ends, so the count can be anything.
  const ends = [];
  maze.walls.forEach((w, i) => { if (w.order >= 3 && !(i % 7)) ends.push(w.a, w.b); });
  const junctions = ends.map((p) => armsAt(p, maze.walls)).filter((arms) => arms.length >= 2);   // an end on the margin has only its own chord: not a junction of walls
  expect(junctions.length).toBeGreaterThan(100);
  expect(junctions.filter((arms) => arms.length === 3).length / junctions.length).toBeGreaterThan(0.9);   // three-armed junctions, so a count of 0 Ys is a finding and not a classifier that never sees three arms
  expect(junctions.filter(isY).length).toBe(0);
}, 30000);

test("the hierarchy: 5 primaries, the skeleton's own secondaries, shorter walls with each order, and no cell across a primary", () => {
  const byOrder = new Map();
  for (const w of maze.walls) { if (!byOrder.has(w.order)) byOrder.set(w.order, []); byOrder.get(w.order).push(Math.hypot(...dirOf(w))); }
  expect(byOrder.get(1).length).toBe(5);
  expect(byOrder.get(2).length).toBe(blade0.skel.veins.filter((v) => v.order === 2).length);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  for (let o = 2; o <= 5; o++) expect(mean(byOrder.get(o))).toBeLessThan(mean(byOrder.get(o - 1)));
  for (const w of maze.walls.filter((x) => x.order === 1)) {
    const d = dirOf(w), l = Math.hypot(...d), n = [-d[1] / l, d[0] / l], mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], e = 1e-6;
    const side = (s) => maze.cells.findIndex((c) => inPoly([mid[0] + s * e * n[0], mid[1] + s * e * n[1]], c.poly));
    const l1 = side(1), l2 = side(-1);
    expect(l1).toBeGreaterThanOrEqual(0);
    expect(l2).toBeGreaterThanOrEqual(0);
    expect(l1).not.toBe(l2);
  }
});

// ---- the raster: the walls carry exactly wall_fraction ----------------------------------------------------------------------
const shareOf = (r) => { let w = 0, l = 0; for (let i = 0; i < r.lam.length; i++) { w += r.lam[i] * r.wall[i]; l += r.lam[i]; } return w / l; };
test("the raster's wall share is wall_fraction at N = 512 (to 0.01), and no walls at 0", () => {
  for (const fw of [0.05, 0.2, 0.4]) expect(Math.abs(shareOf(MAZE.rasterLeaf(blade0, maze, fw, 512)) - fw)).toBeLessThan(0.01);
  expect(MAZE.rasterLeaf(blade0, maze, 0, 128).wall.every((v) => v === 0)).toBe(true);
});

test("the picture's mean is the engine's mixture: lamina-weighted transmittance = exp(-mixtureTau) per channel within 2 %", () => {
  const P = { ...DEFAULTS, phenology: 1, turn_start: 0.6, turn_span: 0.3, anthocyanin: 0.8, wall_fraction: 0.2 };
  const { wall, cell } = MAZE.tissues(P, 1234, 2, 5), mix = math.mixtureTau(wall, cell, 0.2), r = MAZE.rasterLeaf(blade0, maze, 0.2, 512);
  for (let c = 0; c < 3; c++) {
    let t = 0, l = 0;
    for (let i = 0; i < r.lam.length; i++) { t += r.lam[i] * (r.wall[i] * Math.exp(-wall[c]) + (1 - r.wall[i]) * Math.exp(-cell[c])); l += r.lam[i]; }
    expect(Math.abs(t / l / Math.exp(-mix[c]) - 1)).toBeLessThan(0.02);
  }
});

test("the blemish hook is a no-op while the list is empty: masks and colours bit-equal to omitting it", () => {
  const a = MAZE.rasterLeaf(blade0, maze, 0.2, 128), b = MAZE.rasterLeaf(blade0, maze, 0.2, 128, []);
  expect(Buffer.from(b.lam.buffer).equals(Buffer.from(a.lam.buffer))).toBe(true);
  expect(Buffer.from(b.wall.buffer).equals(Buffer.from(a.wall.buffer))).toBe(true);
  const { wall, cell } = MAZE.tissues({ ...DEFAULTS, phenology: 1, anthocyanin: 0.8 }, 1, 0, 0);
  expect(Buffer.from(MAZE.paintLeaf(b, wall, cell, [])).equals(Buffer.from(MAZE.paintLeaf(a, wall, cell)))).toBe(true);
});

// ---- the stamp: the row spans paint the box scan's buffer, to the byte ------------------------------------------------------
// THE REFERENCE is the stamp as it was first written, kept here as the proof of any faster one: each wall visits every pixel of its box padded by hw + 1, evaluates the coverage there and keeps the max.
// leaf-maze.js visits only the columns a wall can reach in each row and evaluates the very same expression in them, so on ANY walls the two buffers must agree byte for byte: the mazes' own
// (the star, the maple, the beech and, with leaf_variety, rows of its table) and the ones that make a span's edge cases (zero length, along a row, along a column, off the view, a hairline, a fat wall).
const SS = 4;                                                                           // leaf-maze.js's subsamples per axis
const widthOfRef = (o) => (o === 1 ? 4 : o === 2 ? 3 : 1 + 0.5 * Math.max(0, 5 - o));
function boxStamp(walls, w, view, S) {
  const s = S / (2 * view.half), cover = new Uint8Array(S * S);
  for (const wl of walls) {
    const ax = (wl.a[1] - view.cy) * s + S / 2, ay = S / 2 - (wl.a[0] - view.cx) * s, bx = (wl.b[1] - view.cy) * s + S / 2, by = S / 2 - (wl.b[0] - view.cx) * s;
    const hw = w * widthOfRef(wl.order) * s, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, pad = hw + 1;
    const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad)), c1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx) + pad));
    const r0 = Math.max(0, Math.floor(Math.min(ay, by) - pad)), r1 = Math.min(S - 1, Math.ceil(Math.max(ay, by) + pad));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const px = c + 0.5 - ax, py = r + 0.5 - ay, t = l2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0, d = Math.hypot(px - t * dx, py - t * dy);
      const cov = Math.min(d + 0.5, hw) - Math.max(d - 0.5, -hw);
      if (cov > 0) { const v = Math.round(Math.min(1, cov) * 255), i = r * S + c; if (v > cover[i]) cover[i] = v; }
    }
  }
  return cover;
}
const sameBytes = (got, want) => { if (Buffer.from(got).equals(Buffer.from(want))) return "same"; const i = got.findIndex((v, k) => v !== want[k]); return `differs at ${i}: ${got[i]} for ${want[i]}`; };
const painted = (a) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i]) n++; return n; };
// the maple's first calibration, a literal so the stamp is held to that blade whatever MAPLE becomes: laterals at ±62° and a basal pair 0.55 of the central
const STAR = Object.freeze({
  species: 1, grammar: "palmate", angles: Object.freeze([-105, -62, 0, 62, 105]), angleJitter: 4, lengths: Object.freeze([0.55, 0.85, 1, 0.85, 0.55]), lengthJitter: 0.10,
  hub: 0.12, hold: 0.6, rho: 0.19, taper: 1, secStep: 0.18, secAngle: 45, secJitter: 0.10, tooth: 0.02, toothHalf: 0.06,
});
// [name, blade, the N it is held at]: the preview rasterises at 512 (leaf-preview.js's N); 256 and 1024 are half and double that, other span geometries over the same walls
const stampBlades = [
  ["the star", bladeOf(STAR, outlineSeed(STAR, 1234, 0)), [256, 512, 1024]],
  ["the maple", bladeOf(MAPLE, outlineSeed(MAPLE, 1234, 0)), [256, 512, 1024]],
  ["the maple, the cost test's leaf", bladeOf(MAPLE, outlineSeed(MAPLE, 31, 5)), [256, 512]],
  ["the beech", bladeOf(LEAF.BEECH, outlineSeed(LEAF.BEECH, 1234, 3)), [256, 512, 1024]],
  ...[0, 27, 63].map((row) => [`the maple's leaf_variety row ${row}`, LEAF.rowBlade(MAPLE, 1234, 1, row), [256, 512]]),
  ["the beech's leaf_variety row 27", LEAF.rowBlade(LEAF.BEECH, 1234, 1, 27), [256, 512]],
];
for (const [name, blade, Ns] of stampBlades) {
  test(`the stamp is the box scan's buffer, to the byte: ${name}, N ${Ns.join(" / ")} at wall_fraction 0.05 and 0.4`, () => {
    const m = MAZE.growAreoles(blade, opts(7));
    for (const N of Ns) for (const fw of [0.05, 0.4]) {
      const r = MAZE.rasterLeaf(blade, m, fw, N), S = N * SS, want = boxStamp(m.walls, r.w, r.view, S), got = MAZE.stampWalls(m.walls, r.w, r.view, S);
      expect(painted(want), "the reference paints something").toBeGreaterThan(S * 20);
      expect(sameBytes(got, want), `${name}, N ${N}, wall_fraction ${fw}`).toBe("same");
    }
  }, 30000);
}

test("the stamp is the box scan's buffer, to the byte, on walls that are all edge: zero length, along a row, along a column, off the view, a hairline, a fat wall", () => {
  const rnd = math.mulberry32(2026), pick = (n) => Math.floor(rnd() * n), at = () => 3 * rnd() - 1.5;   // the view is [-1, 1]: a wall may start and end outside it
  const walls = [];
  for (let i = 0; i < 160; i++) {
    const a = [at(), at()], kind = i % 8;
    const b = kind === 0 ? a : kind === 1 ? [a[0], at()] : kind === 2 ? [at(), a[1]] : kind === 3 ? [a[0] + 1e-9 * rnd(), at()] : kind === 4 ? [a[0] + 0.01 * rnd(), a[1] + 0.01 * rnd()] : [at(), at()];
    walls.push({ a, b, order: 1 + pick(5) });
  }
  walls.push({ a: [0.25, 0.25], b: [-0.25, -0.25], order: 1 }, { a: [0, -0.5], b: [0, 0.5], order: 2 }, { a: [-0.5, 0], b: [0.5, 0], order: 3 });   // a diagonal, a column and a row, centred
  for (const S of [64, 256]) for (const w of [1e-4, 0.002, 0.012, 0.15, 0.6]) {
    const view = { cx: 0.1, cy: -0.05, half: 1 };
    expect(sameBytes(MAZE.stampWalls(walls, w, view, S), boxStamp(walls, w, view, S)), `S ${S}, w ${w}`).toBe("same");
  }
}, 30000);

// ---- the gate --------------------------------------------------------------------------------------------------------------
test("nothing ships: no engine module, bundle shim, preset or macro names the fixture", () => {
  const files = [...readdirSync(".").filter((f) => /^komorebi-.*\.js$/.test(f)), "komorebi.js", "komorebi.global.js", "presets.js", "macros.js"];
  for (const f of files) { const src = readFileSync(f, "utf8"); expect(src.includes("leaf-maze"), f).toBe(false); expect(src.includes("leaf-preview"), f).toBe(false); }
});

test("the leaf for an address is memoised and is the grove's own: variant, outline seed, tissues", () => {
  const a = MAZE.leafMaze(MAPLE, 1234, 3, 4, SIZE), b = MAZE.leafMaze(MAPLE, 1234, 3, 4, SIZE);
  expect(b).toBe(a);
  expect(a.variant).toBe(leafVariant(1234, 3, 4));
  expect(a.blade.r).toEqual(profile(MAPLE, outlineSeed(MAPLE, 1234, a.variant)));
});

test("cost: a full grow + raster at N = 512 finishes under 1.5 s", () => {
  const t0 = performance.now(), b = bladeOf(MAPLE, outlineSeed(MAPLE, 31, 5)), m = MAZE.growAreoles(b, opts(31)), r = MAZE.rasterLeaf(b, m, 0.2, 512), ms = performance.now() - t0;
  console.log(`grow + raster N=512: ${ms.toFixed(0)} ms, ${m.cells.length} cells, ${m.walls.length} walls`);
  expect(r.lam.length).toBe(512 * 512);
  expect(ms).toBeLessThan(1500);
});
