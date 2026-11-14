// The burn test's pure half: how a level loads the look, how a shuttle's frames are summarised and graded, when a tier
// stops. burn.mjs drives a headed browser through the ladder; burn.html runs the live engine; burn.test.mjs holds this file.
//
// The test is a multi-stage fitness test for live playback at 60 fps. Each LEVEL loads the look a step further, from the
// look as authored (level 0) to every load slider at its editor maximum (the last level). Each level runs three SHUTTLES:
// steady wind, a storm, and a chain of transitions between looks that take different routes. Each shuttle climbs on its own:
// one that breaks at two levels in a row sits out the rest of the tier, so a transition that breaks early does not hide how far
// steady playback goes. A resolution tier ends when every shuttle has stopped.
//
// The browser runs with vsync and the frame-rate cap off, so the interval between two frames is what a frame COST, CPU and
// GPU together: a display would hide everything under 16.7 ms behind its refresh. An off-screen burst of repeated frames was
// tried first and measured cached work, not a frame (the heaviest level ran at 27 fps while the burst said 3.9 ms). The time
// inside each requestAnimationFrame callback cannot split CPU from GPU either: Chrome blocks the script while the GPU catches up,
// so it tracks the frame time at every load. The tiers split it instead: a frame whose cost barely moves from 1080p to 4K is not
// spending it on pixels.
import { MAX_LAYERS } from '../komorebi-params.js';

export const TARGET_MS = 1000 / 60;
export const COMFORT_MS = TARGET_MS * 0.75;   // comfortable: a quarter of the frame budget left over

// One 1920x1080 window rendered at three backing sizes (the engine sizes its canvas by devicePixelRatio, capped at 2).
export const TIERS = { '1080p': { dpr: 1 }, '1440p': { dpr: 4 / 3 }, '4k': { dpr: 2 } };

// The load knobs and their editor maxima (editor.js's sliders); every other key is the look's own.
export const LOAD_KEYS = [
  ['tree_count', 16, 1],
  ['foliage_density', 3, 0.01],
  ['leaves_per_cluster', 80, 1],
  ['layer_count', MAX_LAYERS, 1],
  ['sample_count', 48, 1],
];

export function levelLook(base, level, levels) {
  const f = levels > 1 ? level / (levels - 1) : 1;
  const look = { ...base };
  for (const [key, max, step] of LOAD_KEYS) {
    const v = base[key];
    if (!Number.isFinite(v) || v >= max) continue;   // a look already at or past the maximum keeps its own value
    look[key] = Math.round((v + (max - v) * f) / step) * step;
    if (step < 1) look[key] = Number(look[key].toFixed(2));
  }
  const tex = f >= 2 / 3 ? 4096 : f >= 1 / 3 ? 2048 : 0;
  if (Number.isFinite(base.tex_resolution) && tex > base.tex_resolution) look.tex_resolution = tex;
  return look;
}

const pick = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null;
export function frameStats(intervals) {
  const n = intervals.length;
  if (!n) return { frames: 0, fps: null, p50: null, p95: null, p99: null, worst: null, over: null };
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((a, b) => a + b, 0);
  return { frames: n, fps: 1000 / (total / n), p50: pick(sorted, 0.5), p95: pick(sorted, 0.95), p99: pick(sorted, 0.99), worst: sorted[n - 1],
    over: intervals.filter((ms) => ms > TARGET_MS).length / n };
}

const ORDER = ['comfortable', 'holding', 'breaking'];
// comfortable: even the slowest 1% of frames leave a quarter of the budget spare.
// holding: 95% of frames fit the budget and no more than 3 in 100 miss it.
export function grade(frames) {
  if (!frames.frames) return 'breaking';
  if (frames.p99 <= COMFORT_MS) return 'comfortable';
  if (frames.p95 <= TARGET_MS && frames.over <= 0.03) return 'holding';
  return 'breaking';
}

export const worst = (grades) => grades.reduce((a, g) => (ORDER.indexOf(g) > ORDER.indexOf(a) ? g : a), 'comfortable');

export const SHUTTLES = ['steady', 'storm', 'transitions'];
export const shouldStop = (levelGrades) => levelGrades.length >= 2 && levelGrades.slice(-2).every((g) => g === 'breaking');
// the shuttles still climbing, given each one's grades so far
export const stillRunning = (history) => SHUTTLES.filter((name) => !shouldStop(history[name] ?? []));

export function tierSummary(levelGrades) {
  const upTo = (ok) => { let i = -1; while (i + 1 < levelGrades.length && ok(levelGrades[i + 1])) i++; return i < 0 ? null : i; };
  const b = levelGrades.indexOf('breaking');
  return { comfortableTo: upTo((g) => g === 'comfortable'), holdsTo: upTo((g) => g !== 'breaking'), breaksAt: b < 0 ? null : b };
}

const ROUTES = [['groveTravel', 'grove travel'], ['litterRise', 'litter rise'], ['seasonTravel', 'season travel'], ['leafTravel', 'leaf travel'], ['sceneFade', 'scene fade'], ['crossfade', 'crossfade']];
export function routeOf(trans) {
  if (!trans?.active) return 'none';
  return ROUTES.find(([k]) => trans[k])?.[1] ?? 'morph';
}
