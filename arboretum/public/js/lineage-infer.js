// Where each look came from: komorebi's built-in looks and one person's arboretum presets, as one tree. Pure, no DOM: the
// lineage page (lineage.js) runs it in the browser and the tests import it.
//
// `engine` is public/engine/lineage-*.json, written by scripts/engine.mjs: the built-in looks (params, the comment above
// each in presets.js, when git first saw its name) and the tables two looks are compared by. `exported` is GET /api/export.
//
// Every look and every version is a node; the engine's defaults are the root. A node's one parent is always older than it,
// so the tree has no cycle. The parent is chosen by what says the most, in this order:
//   version    preset:<id>@<n-1> before @n, arboretum's own history
//   declared   the version's `parent` field, look:<name> or preset:<id>@<n>
//   promoted   a built-in that carries a preset's name: the preset became the built-in
//   comment    a built-in whose comment in presets.js names another built-in
//   copy       nothing said, and the nearest older look differs in at most three parameters
//   inferred   nothing said: the nearest older look by parameters, with how sure that is
// What else was said (a second look a comment names, a parent declared on a later version) is kept as a secondary edge.

// Parameters that are not the look: debug overlays, the drift's phase, the frame's edge (spec §3.8, as validate.ts has it).
const NOT_THE_ART = ['show_source', 'show_layer', 'show_layer_index', 'drift_phase', 'edge_area'];
// A seed is a different tree, however close the number.
const CATEGORICAL = ['seed'];
// Versions saved by the same hand within this window, this many or more, are one bulk re-save.
const SWEEP_WINDOW_MS = 10 * 60e3;
const SWEEP_MIN = 5;

export function lineage(engine, exported) {
  const skip = new Set([...NOT_THE_ART, ...engine.skipKeys]);
  const keys = Object.keys(engine.defaults).filter((k) => !skip.has(k));
  const angles = new Set(engine.angleKeys);

  const full = (params) => {
    const m = { ...params };
    for (const [old, current] of Object.entries(engine.legacyKeys)) {
      if (!Object.hasOwn(params, old)) continue;
      if (!Object.hasOwn(m, current)) m[current] = params[old];
      delete m[old];
    }
    return Object.fromEntries(keys.map((k) => [k, m[k] ?? engine.defaults[k]]));
  };

  // How far apart one parameter is, 0 to 1: a slider's travel over its range, anything else changed or not.
  function keyDiff(k, a, b) {
    if (a === b) return 0;
    if (typeof a !== 'number' || typeof b !== 'number' || CATEGORICAL.includes(k)) return 1;
    const r = engine.ranges[k];
    let d = Math.abs(a - b);
    if (!r || r.max <= r.min) return Math.min(1, d / (Math.abs(a) + Math.abs(b)));
    if (angles.has(k)) d = Math.min(d % 360, 360 - (d % 360));
    return Math.min(1, d / (r.max - r.min));
  }
  function diff(A, B) {
    const changed = [];
    let distance = 0;
    for (const k of keys) {
      const d = keyDiff(k, A[k], B[k]);
      if (d > 1e-9) {
        changed.push({ k, from: A[k], to: B[k], d });
        distance += d;
      }
    }
    changed.sort((x, y) => y.d - x.d);
    return { distance, changed };
  }

  // ---- nodes ----------------------------------------------------------------------------------------------------
  const nodes = new Map();
  const add = (n) => (nodes.set(n.id, n), n);
  add({ id: 'defaults', kind: 'root', name: 'engine defaults', date: 0, params: full({}) });
  for (const look of engine.looks) {
    add({ id: `look:${look.name}`, kind: 'look', name: look.name, date: look.date ?? 1, order: look.order, comment: look.comment,
      experimental: look.experimental, playlists: look.playlists, params: full(look.params) });
  }
  const presets = [];
  for (const p of exported.presets) {
    const versions = [...p.versions].sort((a, b) => a.n - b.n);
    if (!versions.length) continue;
    const head = versions.at(-1);
    for (const v of versions) {
      add({ id: `preset:${p.id}@${v.n}`, kind: 'version', preset: p.id, n: v.n, name: v.name, description: v.description, tags: v.tags,
        via: v.via, declared: v.parent, date: v.created_at, archived: p.archived_at !== null, visibility: p.visibility,
        head: v === head, params: full(v.params) });
    }
    presets.push({ id: p.id, name: head.name, head: `preset:${p.id}@${head.n}`, versions: versions.map((v) => `preset:${p.id}@${v.n}`),
      archived: p.archived_at !== null, visibility: p.visibility,
      playlists: (exported.playlists ?? []).filter((l) => l.items.some((i) => i.preset_id === p.id)).map((l) => l.name) });
  }
  // A declared look that komorebi no longer ships (renamed or removed) still stands in the tree, without params.
  for (const n of [...nodes.values()]) {
    if (n.declared?.startsWith('look:') && !nodes.has(n.declared)) add({ id: n.declared, kind: 'look', gone: true, name: n.declared.slice(5), date: 1 });
  }

  // One order for everything: the defaults, then by date; looks of one date in the order presets.js writes them.
  const ordered = [...nodes.values()].sort((a, b) => a.date - b.date || (a.order ?? 0) - (b.order ?? 0) || (a.n ?? 0) - (b.n ?? 0));
  ordered.forEach((n, i) => (n.rank = i));

  // ---- bulk re-saves: many presets given a version by the same hand within a few minutes -----------------------------
  const sweeps = new Map();
  for (const n of nodes.values()) {
    if (n.kind !== 'version' || n.n === 1) continue;
    const key = `${n.via}|${Math.floor(n.date / SWEEP_WINDOW_MS)}`;
    sweeps.set(key, [...(sweeps.get(key) ?? []), n]);
  }
  for (const group of sweeps.values()) if (group.length >= SWEEP_MIN) for (const n of group) n.sweep = group.length;

  // ---- edges ------------------------------------------------------------------------------------------------------
  const edges = [];
  const edge = (from, to, kind, why, primary = true) => {
    const A = nodes.get(from), B = nodes.get(to);
    const d = A.params && B.params ? diff(A.params, B.params) : { distance: null, changed: [] };
    const e = { from, to, kind, why, primary, distance: d.distance, changed: d.changed };
    edges.push(e);
    if (primary) B.parent = from;
    return e;
  };
  // A declared parent can be younger than the look that names it (a built-in git first saw after the preset), so a
  // candidate must also not already hang below the node.
  const below = (c, n) => {
    for (let a = c, i = 0; a && i < nodes.size; a = nodes.get(a.parent), i++) if (a.id === n.id) return true;
    return false;
  };
  const nearest = (n, pool) =>
    pool
      .filter((c) => c.params && c !== n && c.rank < n.rank && !below(c, n))
      .map((c) => ({ c, ...diff(c.params, n.params) }))
      .sort((a, b) => a.distance - b.distance || a.c.rank - b.c.rank);
  const confidence = (pick, scored) => {
    const second = scored.find((s) => s !== pick);
    const margin = second ? second.distance - pick.distance : Infinity;
    if (pick.changed.length <= 12 && margin > 0.5) return 'high';
    if (pick.changed.length <= 40) return 'medium';
    return 'low';
  };
  const kin = (scored) => scored.slice(0, 4).map((s) => ({ id: s.c.id, distance: s.distance, changed: s.changed.length }));

  // The built-ins a text names, longest names first so "park 1, the scene" is not also read as "park 1".
  const lookNames = engine.looks.map((l) => l.name).sort((a, b) => b.length - a.length);
  const named = (text, self) => {
    let t = ` ${String(text ?? '').toLowerCase()} `;
    const found = [];
    for (const name of lookNames) {
      if (name === self) continue;
      const re = new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`);
      if (re.test(t)) {
        found.push(name);
        t = t.replace(re, '$1 ');
      }
    }
    return found;
  };
  const loose = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const n of ordered) {
    if (n.kind === 'root' || n.gone) continue;

    if (n.kind === 'version') {
      const others = ordered.filter((c) => c.kind !== 'version' || c.preset !== n.preset);
      const prev = nodes.get(`preset:${n.preset}@${n.n - 1}`);
      if (prev) {
        edge(prev.id, n.id, n.sweep ? 'sweep' : 'version', n.sweep ? `one of ${n.sweep} presets re-saved together by ${n.via}` : 'the version before');
        if (n.declared && n.declared !== prev.declared && nodes.has(n.declared)) edge(n.declared, n.id, 'declared', `this version names ${n.declared} as its parent`, false);
        n.kin = [];
        continue;
      }
      const scored = nearest(n, others);
      n.kin = kin(scored);
      if (n.declared && nodes.has(n.declared)) {
        edge(n.declared, n.id, 'declared', `its parent field says ${n.declared}`);
        continue;
      }
      if (!scored.length) {
        edge('defaults', n.id, 'inferred', 'nothing older to compare with');
        continue;
      }
      // A description that names a built-in is believed while that look is about as close as the nearest one.
      const hinted = new Set(named(n.description, null).map((x) => `look:${x}`));
      const hint = scored.find((s) => hinted.has(s.c.id));
      const pick = hint && hint.distance <= scored[0].distance * 1.5 + 1 ? hint : scored[0];
      const e = pick.changed.length <= 3
        ? edge(pick.c.id, n.id, 'copy', `differs from it in ${pick.changed.length || 'no'} parameter${pick.changed.length === 1 ? '' : 's'}`)
        : edge(pick.c.id, n.id, 'inferred', pick === hint ? `its description names ${pick.c.name}` : 'the nearest older look by parameters');
      e.confidence = confidence(pick, scored);
      continue;
    }

    // A built-in look.
    const scored = nearest(n, ordered.filter((c) => c.kind !== 'root'));
    n.kin = kin(scored);
    const said = [];
    for (const p of presets.filter((p) => loose(p.name) === loose(n.name))) {
      const s = scored.find((x) => x.c.kind === 'version' && x.c.preset === p.id);
      if (s) said.push({ s, kind: 'promoted', why: `the preset "${p.name}" carries its name` });
    }
    for (const name of named(n.comment, n.name)) {
      const s = scored.find((x) => x.c.id === `look:${name}`);
      if (s) said.push({ s, kind: 'comment', why: `its comment in presets.js names "${name}"` });
    }
    said.sort((a, b) => a.s.distance - b.s.distance);
    if (said.length) {
      said.forEach((x, i) => edge(x.s.c.id, n.id, x.kind, x.why, i === 0));
    } else if (scored.length) {
      const e = edge(scored[0].c.id, n.id, 'inferred', 'the nearest older look by parameters');
      e.confidence = confidence(scored[0], scored);
    } else {
      edge('defaults', n.id, 'inferred', 'the oldest look: it grew from the engine defaults');
    }
  }

  return {
    nodes: [...nodes.values()].map(({ params, ...rest }) => rest),
    edges,
    presets,
  };
}
