// The lineage page (/lineage): a person's presets and komorebi's built-in looks as one family tree, drawn left to right,
// each look beside the one it came from. The tree is worked out here, in the browser (lineage-infer.js), from the
// person's own export and the built-ins file scripts/engine.mjs writes; clicking a look says why it hangs where it does.
import { failure, send } from './api.js';
import { BASE } from './base.js';
import { el } from './dom.js';
import { lineage } from './lineage-infer.js';

const root = document.getElementById('lineage');
const status = root.querySelector('.msg');
const SVG = 'http://www.w3.org/2000/svg';

const KIND = {
  version: 'the version before',
  sweep: 'a bulk re-save',
  declared: 'declared parent',
  promoted: 'a preset that became a built-in',
  comment: 'named in presets.js',
  copy: 'a copy',
  inferred: 'inferred from parameters',
};
// How each kind of link is drawn: what was said is solid, what was worked out is dashed, and fainter the less sure.
const STROKE = {
  declared: { w: 1.6, op: 0.85 },
  promoted: { w: 2.6, op: 0.95 },
  comment: { w: 1.4, op: 0.75 },
  copy: { w: 1.4, op: 0.8, dash: '2 3' },
  inferred: { w: 1.3, op: 0.7, dash: '5 4' },
};
const SURE = { high: 0.85, medium: 0.6, low: 0.3 };

const svg = (tag, attrs = {}, parent) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  parent?.append(node);
  return node;
};
const day = (ms) => (ms > 1 ? new Date(ms).toISOString().slice(0, 10) : '');
const value = (v) => (typeof v === 'number' && !Number.isInteger(v) ? String(Math.abs(v) >= 100 ? +v.toFixed(1) : +v.toFixed(3)) : String(v));
const origin = (n) => (n.kind === 'root' ? 'root' : n.kind === 'look' ? 'look' : (n.via ?? '').startsWith('token:') ? 'bot' : 'you');
const who = (n) => (n.kind === 'look' ? (n.gone ? 'built-in, no longer shipped' : 'built-in') : n.kind === 'root' ? 'the engine' : (n.via ?? '').replace(/^token:/, ''));

async function start() {
  const [engineRes, exportRes] = await Promise.all([fetch(root.dataset.lineage), send('GET', root.dataset.export)]);
  if (!engineRes.ok) return void (status.textContent = `komorebi's looks could not be read (${engineRes.status})`);
  if (!exportRes.ok) return void (status.textContent = failure(exportRes));
  const engine = await engineRes.json();
  const tree = lineage(engine, exportRes.data);
  status.textContent = '';
  draw(engine, tree);
}

function draw(engine, { nodes, edges, presets }) {
  const N = new Map(nodes.map((n) => [n.id, n]));
  const P = new Map(presets.map((p) => [p.id, p]));
  const primary = new Map(edges.filter((e) => e.primary).map((e) => [e.to, e]));
  const secondary = edges.filter((e) => !e.primary);
  const state = { archived: true, secondary: true, selected: null };

  const lineOf = (n) => (n.kind === 'version' ? `preset:${n.preset}` : n.id);
  const shown = (n) => !(n.kind === 'version' && n.archived && !state.archived);

  // One node per line: a preset with all its versions, or a built-in. A line hangs from the parent of its first version.
  function lines() {
    const out = new Map();
    for (const n of nodes) {
      if (!shown(n)) continue;
      const id = lineOf(n);
      if (!out.has(id)) out.set(id, { id, nodes: [], children: [] });
      out.get(id).nodes.push(n);
    }
    for (const l of out.values()) {
      l.nodes.sort((a, b) => a.rank - b.rank);
      l.first = l.nodes[0];
      l.last = l.nodes.at(-1);
      l.name = l.first.kind === 'version' ? P.get(l.first.preset).name : l.first.name;
      // An archived parent that is hidden hands its children to its own parent.
      let e = primary.get(l.first.id);
      while (e && !shown(N.get(e.from))) e = primary.get(e.from);
      l.edge = e && { ...primary.get(l.first.id), from: e.from };
      l.parent = e ? lineOf(N.get(e.from)) : null;
    }
    for (const l of out.values()) if (l.parent && out.has(l.parent)) out.get(l.parent).children.push(l);
    return out;
  }

  // ---- the tree ----------------------------------------------------------------------------------------------------
  const holder = el('div', { className: 'lineage-tree' });
  const detail = el('aside', { className: 'lineage-detail' });
  const RH = 24, CW = 190, PAD = 22;

  function render() {
    const all = lines();
    const top = all.get('defaults');
    let leaf = 0, depth = 0;
    (function place(l, d) {
      l.depth = d;
      depth = Math.max(depth, d);
      l.children.sort((a, b) => a.first.rank - b.first.rank);
      if (!l.children.length) return void (l.y = leaf++);
      for (const c of l.children) place(c, d + 1);
      l.y = (l.children[0].y + l.children.at(-1).y) / 2;
    })(top, 0);
    const X = (l) => PAD + l.depth * CW;
    const Y = (l) => PAD + l.y * RH;
    const placed = [...all.values()].filter((l) => l.depth !== undefined);

    const drawing = svg('svg', { width: PAD * 2 + depth * CW + 240, height: PAD * 2 + leaf * RH, role: 'img', 'aria-label': 'the family tree of your looks' });
    const links = svg('g', { fill: 'none' }, drawing);
    const marks = svg('g', {}, drawing);
    for (const l of placed) {
      if (!l.parent) continue;
      const p = all.get(l.parent), x1 = X(p), y1 = Y(p), x2 = X(l), y2 = Y(l), mx = x1 + CW * 0.45;
      const s = STROKE[l.edge.kind] ?? STROKE.declared;
      svg('path', { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, class: `link made-${origin(l.first)}`,
        'stroke-width': s.w, 'stroke-dasharray': s.dash, opacity: l.edge.confidence ? SURE[l.edge.confidence] : s.op }, links);
    }
    if (state.secondary) {
      for (const e of secondary) {
        const a = all.get(lineOf(N.get(e.from))), b = all.get(lineOf(N.get(e.to)));
        if (!a || !b || a === b || a.depth === undefined || b.depth === undefined) continue;
        svg('path', { d: `M${X(a)},${Y(a)} Q${(X(a) + X(b)) / 2 + 30},${(Y(a) + Y(b)) / 2} ${X(b)},${Y(b)}`, class: 'link also' }, links);
      }
    }
    for (const l of placed) {
      const o = origin(l.first);
      const g = svg('g', { class: `look-node made-${o}`, 'data-id': l.id, tabindex: 0, role: 'button' }, marks);
      svg('circle', { cx: X(l), cy: Y(l), r: l.first.kind === 'version' ? 3.5 + Math.min(4, l.nodes.length - 1) : 5.5 }, g);
      const t = svg('text', { x: X(l) + 10, y: Y(l) + 4.5 }, g);
      svg('tspan', { class: 'name' }, t).textContent = l.name;
      if (l.first.kind === 'version') svg('tspan', { class: 'aside', dx: 7 }, t).textContent = l.nodes.length > 1 ? `${l.nodes.length} versions` : '';
      if (l.edge?.confidence === 'low') svg('tspan', { class: 'unsure', dx: 6 }, t).textContent = '?';
      svg('title', {}, g).textContent = l.edge ? `${l.name}: ${KIND[l.edge.kind]}${l.edge.confidence ? `, ${l.edge.confidence} confidence` : ''}` : l.name;
      const pick = () => select(l.last.id);
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), pick()));
    }
    holder.replaceChildren(drawing);
    mark();
  }

  // ---- the look picked ---------------------------------------------------------------------------------------------
  const pickable = (id) => {
    const n = N.get(id);
    if (!n) return document.createTextNode(id);
    const several = n.kind === 'version' && P.get(n.preset).versions.length > 1;
    const b = el('button', { type: 'button', className: 'linkish', textContent: several ? `${n.name} (version ${n.n})` : n.name });
    b.addEventListener('click', () => select(id, true));
    return b;
  };
  const meta = (...parts) => el('p', { className: 'meta' }, ...parts);

  function changes(list) {
    if (!list.length) return el('p', { className: 'quiet' }, 'no parameter differs');
    const rows = list.slice(0, 30).map((c) =>
      el('tr', {},
        el('td', {}, engine.labels[c.k] ?? c.k, el('small', {}, c.k)),
        el('td', { className: 'v' }, `${value(c.from)} → `, el('b', {}, value(c.to)), el('span', { className: 'bar', style: `width:${Math.max(2, c.d * 100)}%` }))));
    if (list.length > 30) rows.push(el('tr', {}, el('td', { colSpan: 2, className: 'quiet' }, `and ${list.length - 30} more`)));
    return el('table', { className: 'changes' }, el('tbody', {}, ...rows));
  }

  function explain() {
    const n = N.get(state.selected);
    if (!n) {
      const counts = {};
      for (const e of edges) if (e.primary) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      const sure = {};
      for (const e of edges) if (e.confidence) sure[e.confidence] = (sure[e.confidence] ?? 0) + 1;
      detail.replaceChildren(
        el('h2', {}, 'how the tree is made'),
        el('p', {}, 'Each look hangs from the one it came from. Where arboretum or komorebi says so, that is believed: a preset’s parent, the comment above a built-in look, a preset that later became one. Where nothing says, the nearest older look by parameters is taken, and marked with how sure that is.'),
        el('ul', { className: 'plain' }, ...Object.entries(counts).map(([k, v]) => el('li', {}, `${v} × ${KIND[k]}`))),
        meta(`inferred: ${Object.entries(sure).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`),
      );
      return;
    }
    const e = primary.get(n.id);
    const p = n.kind === 'version' ? P.get(n.preset) : null;
    const parts = [el('h2', {}, n.name)];
    parts.push(meta(`${who(n)}${p ? ` · version ${n.n}${n.head ? ', the latest' : ''}` : ''}${day(n.date) ? ` · ${n.kind === 'look' ? 'in komorebi since ' : ''}${day(n.date)}` : ''}${n.archived ? ' · archived' : ''}${n.visibility ? ` · ${n.visibility}` : ''}`));
    const lists = p ? p.playlists : n.playlists;
    if (lists?.length) parts.push(meta(`in ${lists.join(', ')}`));
    if (p) {
      parts.push(el('p', {}, el('a', { href: `${BASE}/p/${n.preset}/v/${n.n}`, textContent: 'this version' }), ' · ',
        el('a', { href: `/#arboretum=${n.preset}@${n.n}`, textContent: 'open it in komorebi' })));
    }

    parts.push(el('h3', {}, 'came from'));
    if (!e) parts.push(el('p', { className: 'quiet' }, n.kind === 'root' ? 'every look starts here' : 'nothing older'));
    else {
      parts.push(el('div', { className: 'why' }, pickable(e.from),
        meta(`${KIND[e.kind]}${e.confidence ? `, ${e.confidence} confidence` : ''}: ${e.why}`),
        meta(e.distance == null ? '' : `${e.changed.length} parameters differ`)));
      parts.push(changes(e.changed));
    }
    const also = secondary.filter((x) => x.to === n.id);
    if (also.length) parts.push(el('h3', {}, 'also drew from'), el('ul', { className: 'plain' }, ...also.map((x) => el('li', {}, pickable(x.from), meta(x.why)))));
    if (n.kin?.length) {
      parts.push(el('h3', {}, 'the closest older looks'),
        el('ul', { className: 'plain' }, ...n.kin.map((k) => el('li', {}, pickable(k.id), meta(`${k.changed} parameters differ${k.id === e?.from ? ' · the one chosen' : ''}`)))));
    }
    if (p) {
      parts.push(el('h3', {}, 'versions'), el('ul', { className: 'plain' }, ...p.versions.map((id) => {
        const v = N.get(id);
        return el('li', {}, v === n ? el('b', {}, `v${v.n}`) : pickable(id), meta(`${day(v.date)} · ${who(v)}${v.sweep ? ' · a bulk re-save' : ''}`));
      })));
    }
    const children = edges.filter((x) => x.from === n.id && x.kind !== 'version' && x.kind !== 'sweep');
    if (children.length) parts.push(el('h3', {}, 'looks that came from it'), el('ul', { className: 'plain' }, ...children.map((x) => el('li', {}, pickable(x.to), meta(KIND[x.kind])))));
    const text = n.description || n.comment;
    if (text) parts.push(el('h3', {}, n.description ? 'description' : 'its comment in presets.js'), el('p', { className: 'said' }, text));
    detail.replaceChildren(...parts);
  }

  function mark() {
    for (const g of holder.querySelectorAll('.look-node[aria-current]')) g.removeAttribute('aria-current');
    const n = N.get(state.selected);
    const g = n && holder.querySelector(`.look-node[data-id="${CSS.escape(lineOf(n))}"]`);
    g?.setAttribute('aria-current', 'true');
    return g;
  }
  function select(id, reveal = false) {
    state.selected = id;
    const g = mark();
    explain();
    if (reveal) g?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    detail.scrollTop = 0;
  }

  // ---- the bar above -------------------------------------------------------------------------------------------------
  const toggle = (label, key) => {
    const box = el('input', { type: 'checkbox', checked: state[key] });
    box.addEventListener('change', () => {
      state[key] = box.checked;
      render();
    });
    return el('label', { className: 'inline' }, box, ` ${label}`);
  };
  const swatch = (cls, label) => el('span', { className: `key ${cls}` }, label);
  const bar = el('div', { className: 'lineage-bar' },
    swatch('made-look', 'built-in'), swatch('made-you', 'saved by you'), swatch('made-bot', 'saved by a token'),
    swatch('said', 'said'), swatch('worked', 'worked out'),
    el('span', { className: 'grow' }), toggle('archived', 'archived'), toggle('also drew from', 'secondary'));

  root.append(bar, el('div', { className: 'lineage-grid' }, holder, detail));
  render();
  explain();
}

start().catch((err) => {
  status.textContent = `the tree could not be drawn: ${err.message}`;
});
