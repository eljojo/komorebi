// ============================================================================
// Komorebi macros — the CONTROL BUS. A macro is one high-level input t ∈ [0,1]
// driving several engine params through an authored mapping, the same pattern
// the editor's time_of_day slider (one knob → the sun model) and TREE_SPECIES
// (one name → a shape bundle) already are — generalized and made data.
//
// Every stop below is lifted from a SHIPPED look, not invented: the presets are
// authored as small hand-tuned steps off each other (afternoon 4 → 4b is the
// haze recipe, 5 → 4 is the calm→windy recipe, morning 1 → memories is sparse
// spring), and those steps ARE the macro anchors. See the per-macro notes.
//
// The bus contract is deliberately tiny — set(key, t) in, a partial param dict
// out — so a slider is only the FIRST source that writes to it: MIDI CCs, audio
// feature extractors, or a learned mapping can drive the same keys later and
// neither the engine nor the UI changes.
//
// `live: true` macros touch only params the engine reads live or rebuilds
// cheaply (MORPH keys + the source rebuild) — safe to write every pointermove.
// `live: false` macros regrow the canopy (CANOPY keys): write them on release — unless they declare
// `tween: τ` (seconds), which makes the slider a TARGET the bus eases toward on the frame clock (see
// createBus). `tween` must never be spelled as a truthy `live`: the UI, the live rule in macros.test.js and
// the editor's applier all branch on `m.live`'s truthiness.
// macros.test.js holds these claims to the engine's own key classification.
// ============================================================================

import { TWEEN_STEP } from './komorebi-math.js';

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;

// Each macro: label for the UI; scope — the engine rebuild apply() needs after a write ('' = live uniforms);
// probe — the monotone primary param macroValue() inverts to place a thumb on the current look; stops — the
// anchor points, every stop carrying the SAME param set (numbers interpolate piecewise-linearly between
// stops; strings/booleans snap to the nearest stop); gate — where the macro is honest: 'floor' macros carry
// floor-look recipes (the receiver/sky looks run their own exposure regimes and coverage arithmetic — an
// absolute write there tramples hand-derived numbers), 'cast' macros ride the cast cameras and are dead in
// the sky view. macroUsable() answers for the current look; ungated macros work everywhere.
const FALL_CAPACITY = { anthocyanin: 0.4, tannin: 0.2, wall_fraction: 0.2, turn_exposure: 1, leaf_drop: 1 };   // montebello's, at every stop of the season axis
const AFTERNOON = { foliage_density: 1.65, branch_length_ratio: 0.62, branch_pitch_deg: 26, trans_r: 0.26, trans_g: 0.356, trans_b: 0.001 };   // afternoon 4's structure and leaf hue

export const MACROS = {
  // clear sky → veiled → overcast. cloud_thickness is the spec's "single most expressive parameter" (§3.4)
  // and the source model does the physics (energy drains core → halo on its own); the halo widens with it the
  // way the overcast looks do. Shipped range tops at 0.55 (canopy 4) — full 1.0 is transition-bloom
  // territory, deliberately out of reach here.
  weather: {
    label: 'weather', scope: 'source', live: true, probe: 'cloud_thickness',
    stops: [
      { t: 0.0, set: { cloud_thickness: 0.0, halo_angular_radius_deg: 4.3 } },   // memories / eclipse: bare disk
      { t: 0.35, set: { cloud_thickness: 0.18, halo_angular_radius_deg: 4.8 } }, // morning 3: thin veil
      { t: 0.7, set: { cloud_thickness: 0.41, halo_angular_radius_deg: 4.8 } },  // the afternoons
      { t: 1.0, set: { cloud_thickness: 0.55, halo_angular_radius_deg: 8.0 } },  // canopy 4: heavy overcast
    ],
  },
  // the afternoon 4 → 4b delta, verbatim, as an axis: turbid sky, and the author DROPS exposure under haze
  // while ambient falls and contrast firms. One authored recipe, one knob. FLOOR-gated: the exposure numbers
  // are the floor regime's — the sky/curtain/tent looks each derive their own (canopy 1's comment calls its
  // 1.3/1.5 load-bearing) and a first touch here would blow them out.
  haze: {
    label: 'haze', scope: '', live: true, probe: 'sky_turbidity', gate: 'floor',
    stops: [
      { t: 0.0, set: { sky_turbidity: 0.05, exposure: 2.44, ambient_skylight: 0.97, contrast: 0.98 } },  // afternoon 4
      { t: 1.0, set: { sky_turbidity: 0.23, exposure: 1.29, ambient_skylight: 0.83, contrast: 1.11 } },  // afternoon 4b
    ],
  },
  // pinhole-crisp → old-prime-lens dreamy. The two knobs must move OPPOSITELY (a fatter core with more halo
  // energy is the dreamy pole): morning 3 sits at (0.05, 0.72)-crisp, the physical sun at (0.27, 0.95), the
  // mornings at (0.56, 0.61), the soft afternoons at (0.77, 0.78) — ordered here into one monotone path.
  focus: {
    label: 'focus', scope: 'source', live: true, probe: 'core_angular_radius_deg',
    stops: [
      { t: 0.0, set: { core_angular_radius_deg: 0.05, core_weight_fraction: 1.0 } },   // morning 3 / eclipse: pinhole
      { t: 0.35, set: { core_angular_radius_deg: 0.27, core_weight_fraction: 0.95 } }, // the real sun
      { t: 0.65, set: { core_angular_radius_deg: 0.56, core_weight_fraction: 0.72 } }, // the mornings
      { t: 1.0, set: { core_angular_radius_deg: 0.77, core_weight_fraction: 0.61 } },  // the dreamy afternoons
    ],
  },
  // wind INTENSITY (the pad's y): force + the drift-glisten floor, nothing else. The springs (damping,
  // height gain, twig/leaf response) deliberately STAY the look's own — the panel's own guidance ("spring
  // mechanics — tuned once. Per scene you really only change strength and direction") and the sky looks'
  // hand-tuned levers (canopy 1's sway_height_gain 1.6 is called its soul) both say a wind knob must not
  // touch them. The bottom quarter is NOT stillness — it is afternoon 5's drift-dominant glisten (§1's
  // faint wind). scope 'bake': drift_amount stamps into the leaves, so a still frame re-bakes to show it.
  wind_y: {
    label: 'wind', scope: 'bake', live: true, probe: 'wind_strength',
    stops: [
      { t: 0.0, set: { wind_strength: 0.0, drift_amount: 0.06 } },     // near-rest (eclipse's barely-there stir)
      { t: 0.25, set: { wind_strength: 0.07, drift_amount: 0.145 } },  // afternoon 5: the glisten
      { t: 0.6, set: { wind_strength: 1.29, drift_amount: 0.145 } },   // the standard breeze
      { t: 1.0, set: { wind_strength: 1.7, drift_amount: 0.145 } },    // afternoon 4 pushed
    ],
  },
  // wind CHARACTER (the pad's x): lazy → steady → gusty → squally, riding the broadband signal's own knobs.
  // The floor looks never touched this system (all ship the default 'gusty'/0.25) — the newer looks do
  // (canopy 4 lazy, park squally, canopy 2 fast-and-bursty), and those are the anchors.
  wind_x: {
    label: 'gusts', scope: '', live: true, probe: 'wind_gustiness',
    stops: [
      { t: 0.0, set: { wind_pattern: 'lazy', wind_gustiness: 0.2, gust_frequency: 0.07, gust_attack: 1.6, gust_decay: 2.4 } },     // canopy 4: slow faint stir
      { t: 0.33, set: { wind_pattern: 'steady', wind_gustiness: 0.22, gust_frequency: 0.08, gust_attack: 1.3, gust_decay: 1.8 } }, // rolling directional breeze
      { t: 0.66, set: { wind_pattern: 'gusty', wind_gustiness: 0.28, gust_frequency: 0.11, gust_attack: 1.2, gust_decay: 1.3 } },  // canopy 1: the natural default
      { t: 1.0, set: { wind_pattern: 'squally', wind_gustiness: 0.35, gust_frequency: 0.16, gust_attack: 1.0, gust_decay: 1.3 } }, // park 1 / canopy 2: bursty, sharp-edged
    ],
  },
  // the floor's palette: bare white → warm Mount-Royal dirt (the afternoons' floor) → the void's cool stone.
  // FLOOR-gated: only the floor camera reads a ground albedo — on cloth/sky looks this write is dead.
  palette: {
    label: 'ground', scope: '', live: true, probe: 'ground_r', gate: 'floor',
    stops: [
      { t: 0.0, set: { ground_r: 1.0, ground_g: 1.0, ground_b: 1.0 } },      // bare white (DEFAULTS)
      { t: 0.5, set: { ground_r: 0.33, ground_g: 0.21, ground_b: 0.12 } },   // warm Mount-Royal dirt
      { t: 1.0, set: { ground_r: 0.12, ground_g: 0.16, ground_b: 0.19 } },   // the void's cool stone
    ],
  },
  // leaf-edge diffraction (§3.6): 0 is byte-identical off, 3 is 'prism', 6 is 'morning 3b'. Pure sparkle.
  // CAST-gated: diffraction rides the cast cameras (floor/curtain/tent); the sky view never reads it.
  prism: {
    label: 'prism', scope: '', live: true, probe: 'chromatic_aberration', gate: 'cast',
    stops: [
      { t: 0.0, set: { chromatic_aberration: 0.0 } },
      { t: 1.0, set: { chromatic_aberration: 6.0 } },
    ],
  },
  // THE SEASON AXIS, spring → summer → fall. Every stop is a recipe lifted from a shipped look (each carries
  // its `from:`; macros.test.js checks the values against PRESETS), and the probe is `phenology`, the season's own
  // clock (strictly monotone across the stops):
  //   0     memories      sparse gold spring (density 0.45, open long-limbed branching, the gold-brown leaf)
  //   0.35  morning 1     full canopy (density 1.65, children-6 → 3's shorter limbs; memories' branch_children 6 is a
  //                       TOPO key and deliberately NOT here — this macro stays inside the CANOPY morph class)
  //   0.55  afternoon 4   the summer floor looks (every afternoon is 1.65 / 0.62 / 26 / .26/.356/.001); phenology 0.5
  //   0.62  the last green day: no look. phenology 0.60 = turn_start, the last value at which no leaf has begun
  //         to turn, so everything up to here is the summer looks' own bytes
  //   1     montebello    phenology 0.9 — the turned, dropping canopy
  // The pigment capacities (anthocyanin, tannin, wall_fraction, turn_exposure, leaf_drop) are CONSTANT at every
  // stop, lifted from montebello. They are inert below turn_start, so spring and summer are byte-identical to
  // the looks they come from; only the clock moves the colour and the drop. The fall stops' structure is the
  // afternoons' (not montebello's own park-1 1.55 / 0.68 / 20), so a drag on a park look — montebello included —
  // takes the afternoons' structure on, as every park-look drag always has. Named, not fixed here.
  // NEVER TARGETS (macros.test.js pins the list): canopy_fill, leaf_diffuse, exposure_absolute, litter,
  // litter_resolution, litter_age, litter_drift_m, leaf_wetness. They are physics a look has or doesn't, and
  // `litter` is TOPO, which no macro may write.
  // THE TWEEN. The slider is a target; the bus eases toward it (one pole, τ 0.8 s) and applies the recipe each
  // tick, so the change of seasons plays as you drag. It is the bus's own and never `transitionTo`, which restarts
  // an ease-in on every input, runs resetPerf at the end of every route and dissolves (a bloom) above budget.
  // Its scope is 'season' (not 'canopy'): the engine re-runs the season arithmetic over the grove's cached leaves when
  // only the season set moved (the fall half of the axis) and regrows when the recipe moves structure (the spring half),
  // so the bus needs no diff. The editor gates the applies by their measured cost. FLOOR-gated: the
  // sky/cloth looks author their leaf hue per species (canopy 1's chlorophyll green carries its glow).
  season: {
    label: 'season', scope: 'season', live: false, tween: 0.8, probe: 'phenology', gate: 'floor',
    stops: [
      { t: 0.0, from: 'memories', set: { phenology: 0.15, foliage_density: 0.45, branch_length_ratio: 0.91, branch_pitch_deg: 45, trans_r: 0.376, trans_g: 0.247, trans_b: 0.113, ...FALL_CAPACITY } },
      { t: 0.35, from: 'morning 1', set: { phenology: 0.40, foliage_density: 1.65, branch_length_ratio: 0.62, branch_pitch_deg: 26, trans_r: 0.26, trans_g: 0.356, trans_b: 0.195, ...FALL_CAPACITY } },
      { t: 0.55, from: 'afternoon 4', set: { phenology: 0.50, ...AFTERNOON, ...FALL_CAPACITY } },
      { t: 0.62, from: null, set: { phenology: 0.60, ...AFTERNOON, ...FALL_CAPACITY } },   // the last green day (= turn_start); no look
      { t: 1.0, from: 'montebello', set: { phenology: 0.90, ...AFTERNOON, ...FALL_CAPACITY } },
    ],
  },
  // one tree → a deep grove, the 'the void' recipe: tree_count with the view widening alongside so the frame
  // stays filled (the void raised view 3.1 → 6.8 with its 16 trees). Regrows: written on release. FLOOR-gated:
  // in the sky view view_extent_m is not zoom at all — it sets the grove's plan reach in canopy 1's coverage
  // arithmetic, and this pairing would silently rewrite it.
  grove: {
    label: 'grove', scope: 'canopy', live: false, probe: 'tree_count', gate: 'floor',
    stops: [
      { t: 0.0, set: { tree_count: 1, view_extent_m: 4.2 } },    // eclipse: a single tree
      { t: 0.4, set: { tree_count: 4, view_extent_m: 3.1 } },    // the intimate afternoons
      { t: 0.7, set: { tree_count: 8, view_extent_m: 4.5 } },
      { t: 1.0, set: { tree_count: 16, view_extent_m: 6.8 } },   // the void
    ],
  },
};

// is this macro honest on the given look? 'floor' recipes need the floor camera; 'cast' ones any cast
// camera (everything but the sky view); ungated macros work everywhere.
export function macroUsable(key, params) {
  const gate = MACROS[key].gate;
  if (gate === 'floor') return (params.receiver | 0) === 0 && !params.sky_view;
  if (gate === 'cast') return !params.sky_view;
  return true;
}

// the params a macro writes: piecewise-linear between the two straddling stops (numbers); strings/booleans
// snap to the nearest stop.
export function macroParams(key, t) {
  const m = MACROS[key];
  if (!m) throw new Error(`unknown macro '${key}'`);
  t = clamp01(t);
  const s = m.stops;
  let i = 0;
  while (i < s.length - 2 && t > s[i + 1].t) i++;
  const a = s[i], b = s[i + 1];
  const f = b.t === a.t ? 0 : clamp01((t - a.t) / (b.t - a.t));
  const out = {};
  for (const k of Object.keys(a.set)) {
    const va = a.set[k], vb = b.set[k];
    out[k] = typeof va === 'number' ? lerp(va, vb, f) : (f < 0.5 ? va : vb);
  }
  return out;
}

// the thumb position for the current look: invert the probe param against its stop values. The probe is
// monotone across the stops (macros.test.js asserts it), so this is a piecewise-linear inverse, clamped —
// a look outside the authored range parks the thumb at the nearest end.
export function macroValue(key, params) {
  const m = MACROS[key];
  if (!m) throw new Error(`unknown macro '${key}'`);
  const v = params[m.probe];
  const s = m.stops;
  const dir = Math.sign(s[s.length - 1].set[m.probe] - s[0].set[m.probe]) || 1;
  if (typeof v !== 'number') return s[0].t;
  for (let i = 0; i < s.length - 1; i++) {
    const va = s[i].set[m.probe], vb = s[i + 1].set[m.probe];
    if (dir * v <= dir * s[0].set[m.probe]) return s[0].t;
    if ((dir * v > dir * va || i === 0) && dir * v <= dir * vb)
      return lerp(s[i].t, s[i + 1].t, vb === va ? 0 : (v - va) / (vb - va));
  }
  return s[s.length - 1].t;
}

// THE BUS. One writer-facing surface: set(key, t) computes the mapping and hands the partial param dict to
// the applier; get(key) reads the thumb back off the live params (inversion, so a preset step re-seats every
// thumb). `apply(dict, scope, live)` is the caller's — the editor writes params + runs the engine rebuild;
// a future MIDI/audio/learned source calls the same set() and needs to know nothing else.
//
// A TWEEN macro (`tween: τ`) is the exception to "set applies": set() only stores the TARGET, and the caller's frame
// clock calls tick(dt), which eases x toward it — x += (target − x)(1 − e^(−dt/τ)), one pole: no velocity state,
// monotone, never overshoots, and it composes across any split of the same elapsed time (so a caller that skips
// ticks while a regrow is expensive can hand the sum later and land where it would have — until the step clamp below binds,
// which deliberately does not compose: it is the one place the season is allowed to lag the clock). Each tick applies
// macroParams(key, x) at the macro's scope ONCE, and only if that dict differs from the last one applied. Inside ε
// of the target it snaps, applies the target's own dict once (the resting state is the stop's bytes) and idles.
// get() on a tween macro keeps reading the look (the probe), not the target. cancel() drops every target and
// applies nothing: the caller loading a whole look must call it, or the tween keeps writing over it.
const TWEEN_EPS = 0.002;
// THE COST GATE's step (the editor times every apply and feeds it here; pure so bun can hold it). Over TWEEN_SLOW_MS the next apply waits cost/TWEEN_BUDGET ms of
// wall time; over TWEEN_OFF_MS on the EMA the look falls back to one exact apply on release. GOTCHA: the first season apply on a grove with no cache is a full build
// ('build', the regrow's cost plus the record) — a one-off the next tick never pays again, which on a heavy look in the fall (~55 ms on afternoon 7) would seed the EMA
// over the off line and latch the fallback for the whole drag. CONSEQUENCE: a 'build' that follows a non-build (or opens the drag) is not measured. A 'build' that follows
// a 'build' IS: that is the spring half, where the recipe moves structure and every tick really regrows, and the gate must keep throttling it.
export const TWEEN_SLOW_MS = 12, TWEEN_BUDGET = 0.30, TWEEN_OFF_MS = 50;
export function tweenGateStep(state, cost, path, t0) {
  if (path === 'build' && state.last !== 'build') return { ...state, last: 'build' };
  const ema = state.cost ? 0.7 * state.cost + 0.3 * cost : cost;
  return { cost: ema, waitUntil: cost > TWEEN_SLOW_MS ? t0 + cost / TWEEN_BUDGET : 0, off: state.off || ema > TWEEN_OFF_MS, last: path };
}
const sameDict = (a, b) => !!a && Object.keys(b).every((k) => a[k] === b[k]);
export function createBus(getParams, apply) {
  const tweens = new Map();   // key -> { x, target, last }
  return {
    keys: Object.keys(MACROS),
    set(key, t, { commit = true } = {}) {
      const m = MACROS[key];
      if (m.tween) {
        const target = clamp01(t);
        const st = tweens.get(key);
        if (st) st.target = target;
        else tweens.set(key, { x: macroValue(key, getParams()), target, last: null });   // a drag starts from where the look is
        return macroParams(key, target);
      }
      const dict = macroParams(key, t);
      apply(dict, commit || m.live ? m.scope : null, m.live);   // a non-live macro previews without its rebuild until commit
      return dict;
    },
    tick(dt) {
      if (!(dt > 0)) return;
      for (const [key, st] of tweens) {
        const m = MACROS[key];
        st.x += (st.target - st.x) * (1 - Math.exp(-dt / m.tween));
        const landed = Math.abs(st.x - st.target) < TWEEN_EPS;
        if (landed) st.x = st.target;
        let dict = macroParams(key, st.x);
        if (!landed) {
          // CALM: an applied step of the probe is at most TWEEN_STEP (komorebi-math.js, beside DROP_EPS, with the trade it makes). The ease is held back to
          // the clamped place, so the remainder is still owed to the next tick and the season simply lags the clock while the clamp binds; the landing above
          // is never clamped, so the resting state is the stop's own bytes (and a release's tick(1e9) lands in one apply). Measured from the last apply, or the look.
          const from = st.last ? st.last[m.probe] : getParams()[m.probe], to = dict[m.probe];
          if (typeof from === 'number' && Math.abs(to - from) > TWEEN_STEP) {
            const stepped = from + Math.sign(to - from) * TWEEN_STEP;
            st.x = macroValue(key, { [m.probe]: stepped });
            dict = macroParams(key, st.x);
            dict[m.probe] = stepped;   // exactly TWEEN_STEP away (the inverse and the lerp agree to a few ulps; the other params are the recipe at st.x)
          }
        }
        if (!sameDict(st.last, dict)) { st.last = dict; apply(dict, m.scope, m.live); }
        if (landed) tweens.delete(key);
      }
    },
    cancel() { tweens.clear(); },
    get(key) { return macroValue(key, getParams()); },
    describe(key) { const m = MACROS[key]; return { label: m.label, live: m.live }; },
  };
}
