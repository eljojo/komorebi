// The remote control, the phone's half (src/pages/remote.tsx). It opens a socket into the person's room (src/remote.ts), picks a
// screen (an editor with remote control on), and builds its board from what the screen sends: the look and the list, the dials,
// the advanced panel's rows. It knows nothing of komorebi itself: every row, range and choice comes from the screen, and every
// change goes back as a command the screen checks before running it (komorebi's editor/remote.js says the wire).
import { el } from './dom.js';

const PICK_KEY = 'komorebi.remote.pick';
const TAB_KEY = 'komorebi.remote.tab';
const LIVE_MS = 50;    // a held slider sends at most this often; its release goes at once
const HOLD_MS = 800;   // a control the hand moved this recently keeps its value against the screen's echo, which lags behind it

const root = document.getElementById('remote');
const statusEl = root.querySelector('.r-status');
const screensEl = root.querySelector('.r-screens');
const helpEl = root.querySelector('.r-help');
const board = root.querySelector('.r-board');

const stored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* this visit only */ } };
const fmt = (v) => (typeof v !== 'number' ? String(v ?? '') : Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(2));

let ws = null, fails = 0, pickedOn = null, picked = stored(PICK_KEY), screens = [], schema = null, state = null;

// ---- the wire ----
function send(m) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }

// A slider while held: the latest value, at most every LIVE_MS; `final` is its release, which cancels what was waiting.
const waiting = new Map();
function live(key, msg) {
  const p = waiting.get(key) ?? { last: 0, msg: null, timer: 0 };
  waiting.set(key, p);
  p.msg = msg;
  const now = performance.now();
  if (now - p.last >= LIVE_MS) { p.last = now; send(msg); p.msg = null; return; }
  p.timer ||= setTimeout(() => { p.timer = 0; if (p.msg) { p.last = performance.now(); send(p.msg); p.msg = null; } }, LIVE_MS - (now - p.last));
}
function final(key, msg) {
  const p = waiting.get(key);
  if (p) { clearTimeout(p.timer); p.timer = 0; p.msg = null; }
  send(msg);
}

// The screen's patches laid over what the phone has (editor/remote.js mergeState: whole fields, `params` key by key).
function merge(had, patch) {
  const { t: _t, ...fields } = patch;
  return { ...had, ...fields, params: { ...had?.params, ...fields.params } };
}

function say(text) { statusEl.textContent = text; }

function connect() {
  const u = new URL('/api/remote', location.origin);
  u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('role', 'remote');
  const w = new WebSocket(u);
  ws = w;
  w.onopen = () => { fails = 0; };
  w.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  w.onclose = () => {
    if (ws !== w) return;
    ws = null; pickedOn = null; schema = null;
    board.hidden = true;
    fails++;
    say(fails > 3 ? 'cannot reach arboretum; trying again. If you were signed out, reload this page.' : 'connecting…');
    setTimeout(connect, Math.min(30000, 500 * 2 ** Math.min(fails, 6)));
  };
}

function onMessage(m) {
  if (m.t === 'screens') { screens = Array.isArray(m.screens) ? m.screens : []; choose(); return; }
  if (m.t === 'schema') { schema = m; build(); return; }
  if (m.t === 'state') { state = merge(state, m); if (schema) render(); }
}

// ---- which screen ----
// The one picked before, while it is in the room; else the only one there is; else the person chooses.
function choose() {
  const here = screens.some((s) => s.id === picked);
  if (!here) { board.hidden = true; schema = null; state = null; }   // the screen went (a reload brings it back, and its board with it)
  if (!here && screens.length === 1) pick(screens[0].id);
  else if (here && pickedOn !== ws) pick(picked);
  drawScreens();
  if (!screens.length) say('nothing is showing');
  else if (!screens.some((s) => s.id === picked)) say('choose the screen to change');
  else if (!schema) say('waiting for the screen…');
}

function pick(id) {
  picked = id; store(PICK_KEY, id);
  pickedOn = ws; schema = null; state = null;
  board.hidden = true;
  send({ t: 'pick', screen: id });
}

function drawScreens() {
  helpEl.hidden = screens.length > 0;
  screensEl.hidden = screens.length < 2 && screens.some((s) => s.id === picked);
  screensEl.replaceChildren(...screens.map((s) => {
    const b = el('button', { type: 'button', textContent: s.label || 'a screen' });
    b.addEventListener('click', () => pick(s.id));
    const li = el('li', {}, b, ' ', el('span', { className: 'quiet', textContent: `since ${new Date(s.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }));
    if (s.id === picked) li.setAttribute('aria-current', 'true');
    return li;
  }));
}

// ---- the hand: an input it is holding, or moved a moment ago, is not reset from the screen ----
const down = new Set(), movedAt = new WeakMap();
root.addEventListener('pointerdown', (e) => { if (e.target instanceof HTMLInputElement) down.add(e.target); });
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, () => down.clear());
root.addEventListener('input', (e) => movedAt.set(e.target, performance.now()));
function setValue(inp, v) {
  if (down.has(inp) || performance.now() - (movedAt.get(inp) ?? -1e9) < HOLD_MS) return;
  if (inp.type !== 'range' && document.activeElement === inp) return;   // a field being typed in
  if (inp.type === 'checkbox') inp.checked = !!v;
  else if (inp.value !== String(v)) inp.value = String(v);
}

const button = (text, fn, props = {}) => { const b = el('button', { type: 'button', textContent: text, ...props }); b.addEventListener('click', fn); return b; };
const ask = (question, was = '') => (prompt(question, was) ?? '').trim();

// ---- the board ----
let ui = null;
function build() {
  const look = el('div', { className: 'r-look' });
  const name = el('span', { className: 'r-name' });
  const play = button('▶', () => send({ t: 'play', on: !state.playing }), { className: 'r-play' });
  look.append(el('div', { className: 'r-step' }, button('‹', () => send({ t: 'step', dir: -1 })), name, button('›', () => send({ t: 'step', dir: 1 })), play));
  const chip = el('p', { className: 'quiet r-chip' }), note = el('p', { className: 'msg r-say' });
  const acts = el('div', { className: 'r-acts' },
    button('save', () => { const n = ask('Save the look as:', state.look.name); if (n) send({ t: 'save', name: n }); }),
    button('save as new', () => { const n = ask('Save as a new look, named:'); if (n) send({ t: 'saveNew', name: n }); }),
    button('↺ as it was', () => send({ t: 'asItWas' })),
    button('⚄ new leaves', () => send({ t: 'reseed' })));
  look.append(chip, note, acts);

  const panes = { dials: el('div', { className: 'r-pane' }), list: el('div', { className: 'r-pane' }), panel: el('div', { className: 'r-pane' }) };
  const tabs = el('div', { className: 'r-tabs', role: 'tablist' });
  const show = (which) => {
    store(TAB_KEY, which);
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== which;
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === which));
  };
  for (const [k, label] of [['dials', 'dials'], ['list', 'list'], ['panel', 'everything']]) {
    const b = button(label, () => show(k), { role: 'tab' });
    b.dataset.tab = k;
    tabs.append(b);
  }

  ui = { name, play, chip, note, panes, dials: buildDials(panes.dials), list: buildList(panes.list), panel: buildPanel(panes.panel) };
  board.replaceChildren(look, tabs, ...Object.values(panes));
  show(panes[stored(TAB_KEY)] ? stored(TAB_KEY) : 'dials');
  board.hidden = false;
  say('');
  if (state) render();
}

function slider({ min, max, step }, onLive, onEnd) {
  const inp = el('input', { type: 'range', min, max, step });
  inp.addEventListener('input', () => onLive(Number(inp.value)));
  inp.addEventListener('change', () => onEnd(Number(inp.value)));
  return inp;
}

// The dials, the look's own first (the order comes with each state); then the macros of "more" and the transition's time.
function buildDials(pane) {
  const list = el('div', { className: 'r-dials' }), why = el('p', { className: 'quiet r-why' });
  const rows = new Map();
  for (const [n, d] of Object.entries(schema.dials)) {
    const inp = slider(d, (v) => live(`dial:${n}`, { t: 'dial', name: n, v }), (v) => final(`dial:${n}`, { t: 'dial', name: n, v, end: true }));
    const tick = el('span', { className: 'r-home' });
    const row = el('div', { className: 'r-dial' }, el('span', { className: 'r-label', textContent: n }),
      el('div', { className: 'r-ends' }, el('span', { textContent: d.ends[0] }), el('span', { textContent: d.ends[1] })),
      el('div', { className: 'r-track' }, inp, tick));
    row.addEventListener('pointerdown', () => { why.textContent = inp.disabled ? d.why : ''; });
    rows.set(n, { row, inp, tick });
  }
  const more = el('details', {}, el('summary', { textContent: 'more' }));
  const macros = new Map();
  for (const [k, m] of Object.entries(schema.macros)) {
    const inp = slider({ min: 0, max: 1, step: 0.005 }, (v) => live(`macro:${k}`, { t: 'macro', key: k, v }), (v) => final(`macro:${k}`, { t: 'macro', key: k, v, end: true }));
    const row = el('label', { className: 'r-row' }, el('span', { className: 'r-label', textContent: m.label }), inp);
    macros.set(k, { row, inp });
    more.append(row);
  }
  const transVal = el('span', { className: 'r-val' });
  const trans = slider({ min: 0, max: schema.transMax, step: 0.1 }, (v) => { transVal.textContent = fmt(v); live('trans', { t: 'trans', v }); }, (v) => final('trans', { t: 'trans', v }));
  pane.append(list, why, more, el('label', { className: 'r-row' }, el('span', { className: 'r-label', textContent: 'transition (s)' }), trans, transVal));
  return { list, rows, macros, trans, transVal, order: '' };
}

function buildList(pane) {
  const lists = el('select');
  lists.addEventListener('change', () => send({ t: 'list', value: lists.value }));
  const add = button('+', () => { const n = ask('New playlist name:'); if (n) send({ t: 'newList', name: n }); }, { title: 'new playlist' });
  const rename = button('✎', () => { const n = ask('Rename playlist:', lists.selectedOptions[0]?.textContent ?? ''); if (n) send({ t: 'renameList', name: n }); }, { title: 'rename this playlist' });
  const presentation = el('select');
  for (const [v, label] of [['', 'no preference'], ['screen', 'screen / TV'], ['projector', 'projector']]) presentation.append(el('option', { value: v, textContent: label }));
  presentation.addEventListener('change', () => send({ t: 'presentation', v: presentation.value }));
  const presentationRow = el('label', { className: 'r-row' }, el('span', { className: 'r-label', textContent: 'playlist display' }), presentation);
  const items = el('ol', { className: 'plain r-items' });
  const picker = el('select');
  picker.addEventListener('change', () => { const v = picker.value; picker.value = ''; if (v) send({ t: 'add', pick: v }); });
  pane.append(el('div', { className: 'r-lists' }, lists, rename, add), presentationRow, items, picker);
  return { lists, add, rename, presentation, presentationRow, items, picker, drawn: '' };
}

function timeInput(row, at, key, label) {
  const inp = el('input', { type: 'number', min: 0, step: 'any', value: row[key], disabled: !state.editable || !!row.pending, className: 'seconds', title: label });
  inp.addEventListener('change', () => {
    const v = Number(inp.value);
    if (inp.value === '' || !Number.isFinite(v)) { inp.value = row[key]; return; }
    send({ t: 'times', at, [key]: v });
  });
  return el('label', { className: 'inline r-time' }, `${label} `, inp);
}

function drawItems(l) {
  const typing = l.items.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
  const key = JSON.stringify([state.entries, state.editable, state.addable, state.look.value]);
  if (typing || key === l.drawn) return;
  l.drawn = key;
  const n = state.entries.length;
  l.items.replaceChildren(...state.entries.map((row, at) => {
    const li = el('li', {}, button(row.label, () => send({ t: 'go', value: row.value }), { className: 'r-entry' }));
    if (row.value === state.look.value) li.setAttribute('aria-current', 'true');
    if (row.dwell_s !== undefined && state.editable) {
      li.append(el('div', { className: 'r-item' },
        timeInput(row, at, 'dwell_s', 'hold'), timeInput(row, at, 'crossfade_s', 'arrive'),
        button(row.style ?? 'morph', () => send({ t: 'style', at, style: row.style === 'fade' ? 'morph' : 'fade' }), { title: 'how it arrives' }),
        button('↑', () => send({ t: 'move', at, to: at - 1 }), { disabled: at === 0 }),
        button('↓', () => send({ t: 'move', at, to: at + 1 }), { disabled: at === n - 1 }),
        button('×', () => { if (confirm(`Take ${row.label} out of this playlist? It stays in arboretum.`)) send({ t: 'remove', at }); }, { title: 'take it out' })));
    }
    return li;
  }));
  l.picker.hidden = !state.editable;
  l.picker.replaceChildren(el('option', { value: '', textContent: 'add a look…' }), ...state.addable.map((g) =>
    el('optgroup', { label: g.label }, ...g.options.map((o) => el('option', { value: o.value, textContent: o.label })))));
}

// The advanced panel, area by area as the editor lays it out; a row the look cannot use hides as it does there.
function buildPanel(pane) {
  const rows = new Map(), sections = [];
  let area = pane, box = pane;
  const fold = (name, cls, parent) => { const d = el('details', { className: cls }, el('summary', { textContent: name })); parent.append(d); sections.push(d); return d; };
  for (const r of schema.panel) {
    if (r.kind === 'area') { area = box = fold(r.name, 'r-area', pane); continue; }
    if (r.kind === 'group') { box = fold(r.name, 'r-group', area); continue; }
    if (r.kind === 'button') { box.append(el('div', { className: 'r-row' }, button(r.label, () => send({ t: 'button', id: r.id })))); continue; }
    const label = el('span', { className: 'r-label', textContent: r.label });
    const row = el('div', { className: 'r-row' }, label);
    let inp, val = null;
    if (r.kind === 'slider') {
      val = el('span', { className: 'r-val' });
      inp = slider(r, (v) => { val.textContent = fmt(v); live(`param:${r.key}`, { t: 'param', key: r.key, v }); }, (v) => final(`param:${r.key}`, { t: 'param', key: r.key, v }));
      row.append(inp, val);
    } else if (r.kind === 'toggle') {
      inp = el('input', { type: 'checkbox' });
      inp.addEventListener('change', () => send({ t: 'param', key: r.key, v: inp.checked }));
      row.classList.add('r-toggle');
      row.append(inp);
    } else {
      inp = el('select', {}, ...r.options.map(([text, value]) => el('option', { value, textContent: text })));
      inp.addEventListener('change', () => send({ t: 'param', key: r.key, v: inp.value }));
      row.append(inp);
    }
    let inherit = null;
    if (r.fidelity) { inherit = button('use session', () => send({ t: 'inherit', key: r.key })); row.append(inherit); }
    box.append(row);
    rows.set(r.key, { row, inp, val, inherit });
  }
  return { rows, sections };
}

function render() {
  const s = state;
  ui.name.textContent = s.look.name;
  ui.play.hidden = !s.plays;
  ui.play.textContent = s.playing ? '■' : '▶';
  ui.chip.textContent = s.look.chip;
  ui.note.textContent = s.say;

  // dials: laid again only when the look changes which, or in what order
  const d = ui.dials, order = s.dials.map(([n]) => n).join('|');
  if (order !== d.order) { d.order = order; d.list.replaceChildren(...s.dials.map(([n]) => d.rows.get(n).row)); }
  for (const [n, seat, home, usable] of s.dials) {
    const r = d.rows.get(n);
    if (seat !== null) setValue(r.inp, seat);
    r.inp.disabled = !usable;
    r.row.classList.toggle('off', !usable);
    r.tick.hidden = home === null;
    if (home !== null) r.tick.style.left = `${home * 100}%`;
  }
  for (const [k, [t, usable]] of Object.entries(s.macros)) {
    const m = d.macros.get(k);
    setValue(m.inp, t);
    m.inp.disabled = !usable;
    m.row.classList.toggle('off', !usable);
  }
  setValue(d.trans, s.trans);
  d.transVal.textContent = fmt(s.trans);

  // the list
  const l = ui.list;
  const lists = JSON.stringify(s.lists);
  if (l.lists.dataset.drawn !== lists) {
    l.lists.dataset.drawn = lists;
    l.lists.replaceChildren(...s.lists.map((o) => el('option', { value: o.value, textContent: o.label })));
  }
  if (document.activeElement !== l.lists) l.lists.value = s.list;
  l.add.hidden = !s.signedIn;
  l.rename.hidden = !s.mine;
  l.presentationRow.hidden = !s.mine;
  setValue(l.presentation, s.presentation);
  drawItems(l);

  // the panel
  const hidden = new Set(s.hidden);
  for (const [key, r] of ui.panel.rows) {
    r.row.hidden = hidden.has(key);
    const v = s.params[key];
    if (v === undefined) continue;
    setValue(r.inp, typeof v === 'boolean' ? v : String(v));
    if (r.val && !down.has(r.inp)) r.val.textContent = fmt(v);
    if (r.inherit) r.inherit.textContent = s.authored[key] === null ? 'session' : 'use session';
  }
  for (const sec of [...ui.panel.sections].reverse()) sec.hidden = ![...sec.querySelectorAll('.r-row')].some((row) => !row.hidden);
}

connect();
