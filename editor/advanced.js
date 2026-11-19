// ============================================================================
// THE ADVANCED DEPTH: every setting the panel has, in the playful sidebar's face (EDITOR-only, imported by editor.js alone).
// Its order is its order of importance. First the look you are editing, by name (a tap opens the stories), and a magnifier that
// opens a find field over every name and meaning. Under it the areas of the picture, then, quieter, the machine: how long a change
// of look takes, and the renderer's own areas (quality requests, debug, the lab) on one page. An area opens on a page of its own
// (the look's name above it is the way back): the settings you reach for first, then its shelves, folded, which hold the low-level
// settings and the ones another setting computes. A row shows its value, a tick where the saved look has it, and a dot and ↺ while
// it differs; its name says what it does (a hover with a mouse, a tap without). While anything differs from the saved look, a bar
// pinned at the sidebar's foot counts it, with undo all and save, where a thumb reaches them.
//
// The rows, their order, their areas and their shelves are editor.js's PANEL_LAYOUT, the same the workspace's docked panel
// builds. This file owns no parameter: it reads and writes only through the host it is given, and keeps only where you are
// (the page, the find text, which shelves are open).
// ============================================================================

// the areas that are the renderer's own machinery rather than the picture's: one page at the foot of the index, after the transition
const MACHINE = new Set(['Quality requests', 'Debug', 'Lab']);
const TRANSITION = 'Transition', MACHINE_PAGE = 'the machine';   // the machine's two pages, as host.area names them

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const keyOf = (item) => item[0] === 'species' ? 'tree_species' : item[0] === 'btn' ? null : item[1];
const plain = (html) => String(html ?? '').replace(/<[^>]*>/g, '');

// host: {
//   layout      the panel's items (PANEL_LAYOUT as rows), the session's own rows already left out; a button's fourth field names its icon
//   label(key), means(key)   a row's name and its meaning (HTML, the registry's own)
//   hover       a mouse is there: the meaning is the host's hover tip (data-tip-key), not a tap on the name
//   value(key)  what the row shows; text(key) the value as words
//   home(key)   the saved look's value, or undefined where there is none to show
//   changed()   the set of keys that differ from the saved look
//   look        the set of keys a look is made of (a change to any other moves no count)
//   write(item, v), reset(key), live(key), species: { names, value(), write(name) }
//   save(), asItWas() (every setting back to the saved look), stories() (open the stories), icon(name) (an icons.js glyph)
//   area: { get(), set(name) }   the page open: an area's name, TRANSITION, MACHINE_PAGE, or null for the index
//   fade: { max, get(), set(v) }   the transition's time, an editor setting and not the look's
// }
// The returned `name` is the look's name on the title line: the host keeps its text, as it keeps every other place that names the look.
export function makeAdvanced(host) {
  // the layout as areas, each with its lead rows and its shelves
  const areas = [];
  for (const item of host.layout) {
    if (item[0] === 'hc') { areas.push({ name: item[1], rows: [], shelves: [] }); continue; }
    const a = areas[areas.length - 1];
    if (item[0] === 'adv') { a.shelves.push({ name: item[1], rows: [] }); continue; }
    (a.shelves.length ? a.shelves[a.shelves.length - 1].rows : a.rows).push(item);
  }
  const keysOf = (rows) => rows.map(keyOf).filter(Boolean);
  const allRows = (a) => [...a.rows, ...a.shelves.flatMap((s) => s.rows)];

  const root = el('div', 'adv');
  // the title line: the look's name, or on a page the way back to the index, and the magnifier
  const title = el('div', 'adv-title');
  const look = el('button', 'adv-look'); look.type = 'button';
  const name = el('span', 'name');
  look.append(host.icon('caret-left'), name);
  look.addEventListener('click', () => { if (page()) { host.area.set(null); render(); } else host.stories(); });
  const findBtn = el('button', 'adv-find ico'); findBtn.type = 'button';
  findBtn.title = 'find a setting'; findBtn.setAttribute('aria-label', 'find a setting');
  findBtn.append(host.icon('magnifying-glass'));
  findBtn.addEventListener('click', () => { if (finding) closeFind(); else { finding = true; render(); find.focus(); } });
  title.append(look, findBtn);
  // the find field stays put while what it finds is laid again under it, so it keeps the focus and the caret
  const find = document.createElement('input'); find.type = 'search'; find.className = 'find'; find.hidden = true;
  find.placeholder = 'a setting, or what it does'; find.setAttribute('aria-label', 'find a setting');
  find.addEventListener('input', () => { query = find.value; render(); });
  find.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  const body = el('div', 'adv-body');
  // the foot: there only while something differs from the saved look
  const foot = el('div', 'adv-foot'); foot.hidden = true;
  const count = el('span', 'adv-count');
  const back = el('button', 'adv-back', 'undo all'); back.type = 'button'; back.title = 'every setting back to the saved look';
  back.addEventListener('click', () => host.asItWas());
  const save = el('button', 'adv-save on', 'save'); save.type = 'button';
  save.addEventListener('click', () => host.save());
  foot.append(count, back, save);
  root.append(title, find, body, foot);
  // the transition's one row, built once: its page shows it, the index shows its value
  const fade = el('div', 'arow slider fade');
  const fadeVal = el('span', 'val');
  const fadeIn = document.createElement('input'); fadeIn.type = 'range'; fadeIn.min = 0; fadeIn.max = host.fade.max; fadeIn.step = 0.1;
  fadeIn.setAttribute('aria-label', 'fade');
  fadeIn.addEventListener('input', () => { host.fade.set(parseFloat(fadeIn.value)); syncFade(); });
  const fadeTop = el('div', 'top'); fadeTop.append(el('span', 'nm', 'fade'), fadeVal);
  const fadeTrack = el('div', 'track'); fadeTrack.append(fadeIn);
  fade.append(fadeTop, fadeTrack);
  if (host.hover) fade.dataset.tipKey = 'fade';
  let fadeShown = null;                        // the transition's value on the index, while the index is up
  const secs = (v) => `${v.toFixed(1)} s`;
  const syncFade = () => { const v = host.fade.get(); fadeIn.value = v; fadeVal.textContent = secs(v); if (fadeShown) fadeShown.textContent = secs(v); };
  syncFade();

  let shown = false, finding = false, query = '', held = false, pending = false;
  const openShelves = new Set();               // `${area}/${shelf}`, for as long as the page is open
  let rows = new Map();                        // key -> the row on the page now, to update in place
  let dots = [];                               // [element, keys] whose changed count follows the look

  const isLive = (item) => { const k = keyOf(item); return k === null || host.live(k); };
  const liveCount = (rowsList) => rowsList.filter((i) => i[0] !== 'btn' && isLive(i)).length;

  // ---- one row --------------------------------------------------------------------------------------------------------------
  function nameButton(key, row) {
    const means = host.means(key);
    if (host.hover) {                            // a plain name: a disabled button would swallow the hover the tip needs
      if (means) row.dataset.tipKey = key;
      return { nm: el('span', 'nm', host.label(key)), m: null };
    }
    const nm = el('button', 'nm', host.label(key)); nm.type = 'button';
    if (means) {
      const m = el('div', 'means'); m.hidden = true;
      m.innerHTML = means;                       // the registry's own words (komorebi-params.js), with their emphasis
      nm.addEventListener('click', () => { m.hidden = !m.hidden; nm.classList.toggle('open', !m.hidden); });
      row.append(m);
      return { nm, m };
    }
    nm.disabled = true;
    return { nm, m: null };
  }
  function rowOf(item) {
    const kind = item[0];
    if (kind === 'btn') {
      const b = el('button', 'arow-btn'); b.type = 'button';
      if (item[3]) b.append(host.icon(item[3]));
      b.append(item[1]);
      b.addEventListener('click', item[2]);
      return { el: b, update() {} };
    }
    const key = keyOf(item);
    const row = el('div', `arow ${kind === 's' ? 'slider' : kind === 't' ? 'toggle' : 'choice'}`);
    row.dataset.key = key;
    const top = el('div', 'top');
    const dot = el('span', 'dot', '●'); dot.title = 'differs from the saved look';
    const rs = el('button', 'rs', '↺'); rs.type = 'button'; rs.title = 'back to the saved look'; rs.setAttribute('aria-label', `${host.label(key)} back to the saved look`);
    rs.addEventListener('click', () => host.reset(key));
    const parts = [];                            // the row's controls, under its top line
    let update;
    if (kind === 's') {
      const [, , , min, max, step] = item;
      const val = el('span', 'val');
      const track = el('div', 'track');
      const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
      inp.setAttribute('aria-label', host.label(key));
      const tick = el('i', 'home');
      track.append(inp, tick);
      inp.addEventListener('pointerdown', () => { held = true; });
      inp.addEventListener('input', () => host.write(item, parseFloat(inp.value)));
      const { nm } = nameButton(key, row);
      top.append(nm, dot, val, rs); parts.push(track);
      update = () => {
        if (!held || document.activeElement !== inp) inp.value = host.value(key);
        val.textContent = host.text(key);
        const h = host.home(key);
        tick.hidden = typeof h !== 'number';
        if (typeof h === 'number') tick.style.left = `${Math.min(1, Math.max(0, (h - min) / (max - min))) * 100}%`;
      };
    } else if (kind === 't') {
      const pill = el('button', 'pill'); pill.type = 'button'; pill.setAttribute('role', 'switch');
      pill.setAttribute('aria-label', host.label(key));
      pill.addEventListener('click', () => host.write(item, !host.value(key)));
      const { nm } = nameButton(key, row);
      top.append(nm, dot, rs, pill);
      update = () => { const on = !!host.value(key); pill.setAttribute('aria-checked', String(on)); pill.classList.toggle('on', on); };
    } else {
      const species = kind === 'species';
      const choices = species ? host.species.names.map((n) => [n, n]) : item[3];
      const chips = el('div', 'chips');
      const btns = choices.map(([label, v]) => {
        const b = el('button', 'chip', label); b.type = 'button';
        b.addEventListener('click', () => species ? host.species.write(v) : host.write(item, v));
        chips.append(b); return [b, v];
      });
      const { nm } = nameButton(key, row);
      top.append(nm, dot, rs); parts.push(chips);
      update = () => {
        const now = species ? host.species.value() : host.value(key);
        for (const [b, v] of btns) b.classList.toggle('on', String(v) === String(now));
      };
    }
    // the meaning sits under the top line, before the control
    const m = row.querySelector('.means');
    row.prepend(top);
    if (m) row.append(m);
    row.append(...parts);
    const r = { el: row, item, update() { update(); } };
    r.mark = (changed) => { row.classList.toggle('changed', changed); rs.hidden = !changed || kind === 'species'; };
    return r;
  }

  // ---- the pages ------------------------------------------------------------------------------------------------------------
  function place(container, item) {
    const r = rowOf(item);
    if (!isLive(item)) r.el.hidden = true;
    const k = keyOf(item);
    if (k) rows.set(k, r);
    container.append(r.el);
    return r;
  }
  function dotFor(keys) { const d = el('span', 'dot'); dots.push([d, keys]); return d; }

  // the page open, or null for the index (a page whose rows this look can use none of is the index too)
  const picture = areas.filter((a) => !MACHINE.has(a.name)), machine = areas.filter((a) => MACHINE.has(a.name));
  const liveMachine = () => machine.filter((a) => liveCount(allRows(a)) > 0);
  function page() {
    const n = host.area.get();
    if (n === TRANSITION) return { kind: 'transition' };
    if (n === MACHINE_PAGE) { const m = liveMachine(); return m.length ? { kind: 'machine', areas: m } : null; }
    const a = picture.find((x) => x.name === n);
    return a && liveCount(allRows(a)) > 0 ? { kind: 'area', areas: [a] } : null;
  }
  function entry(label, tail, to, quiet = false) {
    const b = el('button', quiet ? 'area quiet' : 'area'); b.type = 'button';
    b.append(el('span', 'nm', label), ...tail, el('span', 'go', '›'));
    b.addEventListener('click', () => { host.area.set(to); render(); });
    return b;
  }
  function renderIndex() {
    const list = el('div', 'areas');
    for (const a of picture) if (liveCount(allRows(a))) list.append(entry(a.name, [dotFor(keysOf(allRows(a)))], a.name));
    list.append(el('div', 'machine', 'the machine'));
    fadeShown = el('span', 'v');
    list.append(entry(TRANSITION, [fadeShown], TRANSITION, true));
    const m = liveMachine();
    if (m.length) list.append(entry(m.map((a) => a.name.split(' ')[0]).join(' · '), [dotFor(m.flatMap((a) => keysOf(allRows(a))))], MACHINE_PAGE, true));
    body.append(list);
    syncFade();
  }
  function renderFound(q) {
    let any = false;
    for (const a of areas) {
      const hits = allRows(a).filter((item) => {
        const k = keyOf(item);
        if (!k || !host.live(k)) return false;
        return host.label(k).toLowerCase().includes(q) || k.includes(q) || plain(host.means(k)).toLowerCase().includes(q);
      });
      if (!hits.length) continue;
      any = true;
      const h = el('button', 'found-area', a.name); h.type = 'button';
      h.addEventListener('click', () => { host.area.set(MACHINE.has(a.name) ? MACHINE_PAGE : a.name); closeFind(); });
      body.append(h);
      for (const item of hits) place(body, item);
    }
    if (!any) body.append(el('div', 'none', 'no setting by that name or meaning'));
  }
  function renderSection(a, sub) {
    body.append(el('h3', sub ? 'area-name sub' : 'area-name', a.name));
    for (const item of a.rows) place(body, item);
    for (const s of a.shelves) {
      if (!liveCount(s.rows)) continue;
      const d = el('details', 'shelf');
      const id = `${a.name}/${s.name}`;
      d.open = openShelves.has(id);
      d.addEventListener('toggle', () => { if (d.open) openShelves.add(id); else openShelves.delete(id); });
      const sum = el('summary');
      sum.append(el('span', 'nm', s.name), dotFor(keysOf(s.rows)));
      d.append(sum);
      for (const item of s.rows) place(d, item);
      body.append(d);
    }
  }
  function closeFind() { finding = false; query = ''; find.value = ''; render(); }
  function render() {
    if (!shown) return;
    if (held) { pending = true; return; }     // a page laid again under a finger would drop the slider it holds
    pending = false;
    rows = new Map(); dots = []; fadeShown = null;
    body.replaceChildren();
    const p = page();
    root.classList.toggle('in-page', !!p);
    find.hidden = !finding; findBtn.classList.toggle('open', finding);
    const q = finding ? query.trim().toLowerCase() : '';
    if (q) renderFound(q);
    else if (!p) renderIndex();
    else if (p.kind === 'transition') body.append(el('h3', 'area-name', TRANSITION), fade);
    else for (const a of p.areas) renderSection(a, p.kind === 'machine');
    for (const r of rows.values()) r.update();
    counts();
  }

  // ---- what differs from the saved look -------------------------------------------------------------------------------------
  function counts() {
    if (!shown) return;
    const changed = host.changed();
    const n = [...changed].length;
    count.replaceChildren(el('span', 'dot', '●'), ` ${n} ${n === 1 ? 'change' : 'changes'}`);
    foot.hidden = n === 0;
    for (const [d, keys] of dots) {                    // rewritten only when it changes: a drifting look syncs every frame, and a text node
      const c = keys.filter((k) => changed.has(k)).length, t = c ? `● ${c}` : '';   // replaced under a pressed pointer loses the click in Safari and Firefox
      if (d.textContent !== t) d.textContent = t;
    }
    for (const [k, r] of rows) r.mark?.(changed.has(k));
  }

  const release = () => { if (!held) return; held = false; if (pending) render(); };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  return {
    el: root,
    name,
    show(on) { shown = on; if (on) render(); },
    // one row moved: its row follows, and the counts when the key is part of a look
    sync(key) { if (!shown) return; rows.get(key)?.update(); if (host.look.has(key)) counts(); },
    // a look loaded, or many rows moved at once
    syncAll() { if (!shown) return; for (const r of rows.values()) r.update(); counts(); },
    counts,
    syncFade,
    // which rows the look can use changed: the page is laid again
    gates() { render(); },
  };
}
