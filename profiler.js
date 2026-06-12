// ============================================================================
// Editor-only logic for the preset auto-profiler. PURE — no WebGL, no DOM.
// The engine (komorebi.js eng.profiler) owns measurement; the editor (index.html)
// owns the UI and the rebuild orchestration; this module owns (a) the taxonomy of
// what may be cut and (b) the algorithm that composes lighter preset variants from
// measured per-axis costs. Kept pure so it unit-tests under `bun test` with no GPU.
// Classification follows the cost audit (komorebi-spec.md §9). Imported only by the
// editor — never by the engine or the player bundle.
// ============================================================================

// cls:  'safe'  low visual risk — the proposer's primary tools
//       'risky' changes gap structure; only the aggressive variant uses it (A/B arbitrates)
//       'style' a deliberate look (diffraction) — measured for its price, NEVER auto-cut
// proposable: may this axis be baked into a SAVED variant? diffraction (a look) is measured for its impact
//       but never persisted. Render resolution is NOT an axis at all: it's auto_quality's runtime lever, not
//       a stylistic decision, so the profiler neither shows nor saves it — the lite variants exist precisely
//       to lower the static cost so that auto-scaler has to kick in LESS.
// pass: which GPU pass this axis touches — 'transport', 'bake', or 'both'. The runner re-measures only that
//       pass and reuses the baseline for the other, so an unchanged pass's measurement noise can't leak in.
// scope: the eng.apply() rebuild a change needs. levels: absolute degraded settings (lightest last);
//       rel: multipliers of the base value instead.
export const AXES = [
  { key: "sample_count", label: "samples", scope: "source", pass: "transport", cls: "safe",
    proposable: true, levels: [24, 16] },
  { key: "tex_resolution", label: "texture res", scope: "textures", pass: "both", cls: "safe",
    proposable: true, levels: [1024] },
  { key: "layer_count", label: "layers", scope: "textures", pass: "both", cls: "safe",
    proposable: true, levels: [2], note: "depth-blur cheat (§2) — A/B it" },
  { key: "foliage_density", label: "foliage density", scope: "canopy", pass: "bake", cls: "risky",
    proposable: true, rel: [0.7, 0.5] },
  { key: "chromatic_aberration", label: "diffraction", scope: "", pass: "transport", cls: "style",
    proposable: false, measureLevel: 0,
    note: "a deliberate look — measured for its price, never cut" },
];

// The value this axis would take when cut to its lightest proposable setting, or null if the base is
// already that light (nothing to cut) or the axis can't be persisted into a saved variant (resScale,
// diffraction). `levels` are absolute (lightest last); `rel` are multipliers of the base.
export function axisValue(axis, base) {
  if (!axis.proposable) return null;
  const cur = base[axis.key];
  const v = axis.rel
    ? cur * axis.rel[axis.rel.length - 1]
    : axis.levels[axis.levels.length - 1];
  return v != null && v < cur ? v : null;
}

// Smallest per-axis saving (fraction of frame) worth proposing as a cut. Below this a visible quality change
// (e.g. dropping a depth layer for 2%) isn't worth the speed — it's still shown in the breakdown, just never
// bundled into a variant. Keeps the variants distinct and each one a real trade rather than padded filler.
const MIN_CUT = 0.05;
const NAMES_BY_COUNT = { 1: ["lite"], 2: ["lite", "min"], 3: ["lite", "medium", "min"] };

// Compose distinct, progressively-lighter variants of `base` from measured per-axis cost. `costs[key]` is the
// FRACTIONAL frame-cost saving of fully degrading that axis. Builds a cumulative ladder of the cuts WORTH taking
// (saving >= MIN_CUT), ranked by saving: the single biggest safe cut (lite), all worthwhile safe cuts (medium),
// then those plus the risky ones (min). Identical rungs collapse — so you never get two variants proposing the
// same thing, and a trivial cut never pads one. Returns 0..3 variants: { name, params, applied[], estReduction }.
export function proposeVariants(base, costs) {
  const worth = (cls) => AXES
    .filter(a => a.proposable && a.cls === cls && (costs[a.key] || 0) >= MIN_CUT && axisValue(a, base) != null)
    .sort((a, b) => (costs[b.key] || 0) - (costs[a.key] || 0));
  const safe = worth("safe"), risky = worth("risky");
  const rungs = [];
  if (safe.length >= 1) rungs.push(safe.slice(0, 1));     // lite: the single biggest safe cut
  if (safe.length >= 2) rungs.push(safe);                 // medium: every worthwhile safe cut
  if (risky.length >= 1) rungs.push([...safe, ...risky]); // min: safe + risky
  // collapse consecutive identical cut-sets (the rungs are cumulative, so equal sets are always adjacent)
  const uniq = [];
  for (const set of rungs) {
    const key = set.map(a => a.key).sort().join(",");
    if (!uniq.length || uniq[uniq.length - 1].key !== key) uniq.push(set);
  }
  const names = NAMES_BY_COUNT[uniq.length] || [];
  return uniq.map((set, i) => {
    let frac = 1; // remaining cost as a fraction of base
    const params = { ...base };
    const applied = set.map(a => {
      const value = axisValue(a, base);
      params[a.key] = value;
      frac *= 1 - (costs[a.key] || 0);
      return { key: a.key, label: a.label, value, cls: a.cls };
    });
    return { name: names[i] || `v${i}`, params, applied, estReduction: 1 - frac };
  });
}
