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
// `live: false` macros regrow the canopy (CANOPY keys): write them on release.
// macros.test.js holds both claims to the engine's own key classification.
// ============================================================================

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;

// Each macro: label for the UI; scope — the engine rebuild apply() needs after a write ('' = live uniforms);
// probe — the monotone primary param macroValue() inverts to place a thumb on the current look; stops — the
// anchor points, every stop carrying the SAME param set (numbers interpolate piecewise-linearly between
// stops; strings/booleans snap to the nearest stop); gate — where the macro is honest: 'floor' macros carry
// floor-look recipes (the receiver/sky looks run their own exposure regimes and coverage arithmetic — an
// absolute write there tramples hand-derived numbers), 'cast' macros ride the cast cameras and are dead in
// the sky view. macroUsable() answers for the current look; ungated macros work everywhere.
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
  // sparse early spring → full summer, the morning 1 ↔ memories delta made continuous: density is the master,
  // with the open long-limbed branching and the gold-brown leaf coming in as it thins. (memories' other trick,
  // branch_children 6, is a TOPO key — a rebuild-with-dissolve — and deliberately NOT here; this macro stays
  // inside the CANOPY morph class.) Regrows the grove: written on release, not per-move. FLOOR-gated: the
  // sky/cloth looks author their leaf hue per species (canopy 1's chlorophyll green carries its glow).
  season: {
    label: 'season', scope: 'canopy', live: false, probe: 'foliage_density', gate: 'floor',
    stops: [
      { t: 0.0, set: { foliage_density: 0.45, branch_length_ratio: 0.91, branch_pitch_deg: 45, trans_r: 0.376, trans_g: 0.247, trans_b: 0.113 } },  // memories: sparse gold spring
      { t: 0.55, set: { foliage_density: 1.65, branch_length_ratio: 0.62, branch_pitch_deg: 26, trans_r: 0.26, trans_g: 0.356, trans_b: 0.195 } },  // morning 1: full canopy
      { t: 1.0, set: { foliage_density: 2.2, branch_length_ratio: 0.62, branch_pitch_deg: 26, trans_r: 0.21, trans_g: 0.356, trans_b: 0.113 } },    // deep green high summer
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
export function createBus(getParams, apply) {
  return {
    keys: Object.keys(MACROS),
    set(key, t, { commit = true } = {}) {
      const m = MACROS[key];
      const dict = macroParams(key, t);
      apply(dict, commit || m.live ? m.scope : null, m.live);   // a non-live macro previews without its rebuild until commit
      return dict;
    },
    get(key) { return macroValue(key, getParams()); },
    describe(key) { const m = MACROS[key]; return { label: m.label, live: m.live }; },
  };
}
