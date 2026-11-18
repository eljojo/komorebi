// ============================================================================
// remote.js — EDITOR-only. The remote control: a phone driving this editor while it shows somewhere else (a projector on the
// wall), both signed in to arboretum as the same person. The phone's page is arboretum's /arboretum/remote; between them is the
// person's room on arboretum (arboretum/src/remote.ts), a relay that knows who is in it and nothing of what they say.
// Imported by editor.js alone, which lends it a `host` (see mountRemote). It writes nothing the editor's own controls don't: every
// command lands on the function a slider, a dial, a button or the playlist pane already calls.
//
// THE SCREEN. "Remote control" in Settings turns it on for this device (the editor's settings, `remote`); it connects only while
// signed in, through arboretum.js, the one file that talks to arboretum. A screen names itself with an id this tab keeps in
// sessionStorage (a reload is the same screen, so the phone stays on it; another tab is another screen) and a label read off the
// browser. A second tab that copied the id (a duplicated tab) is told it was replaced, and takes a new one.
//
// THE WIRE, as JSON text. The screen sends:
//   { t:'schema', panel, dials, macros, transMax }   what does not change while the page is open: the advanced panel's rows
//                                                    (area, group, slider, toggle, select, button), the dials' ends and ranges,
//                                                    the macros the playful sidebar's "more" holds
//   { t:'state', ...fields }                         what the phone shows now; after the first, only the fields that changed,
//                                                    and of `params` only the keys that changed (mergeState puts them together)
// both on the room's { t:'want' }, and `state` again whenever something moved, at most every TICK_MS while a phone is there.
// The phone sends commands (COMMANDS): each is checked against the schema here (readCommand) before the editor runs it.
// ============================================================================

const ID_KEY = 'komorebi.remote.screen';
export const TICK_MS = 100;
const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
const MAX_NAME = 80;

// A screen's name as the phone lists it: the browser and the system it runs on, in a few words.
export function screenLabel(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const system = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return system ? `${browser} on ${system}` : browser;
}

export const newScreenId = (random = Math.random) => Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join('');

// What changed between two states, as the wire carries it: whole fields, but `params` key by key. null when nothing did.
export function stateDiff(prev, next) {
  if (!prev) return next;
  const out = {};
  for (const k in next) {
    if (k === 'params') {
      const p = {};
      for (const key in next.params) if (!Object.is(next.params[key], prev.params?.[key])) p[key] = next.params[key];
      if (Object.keys(p).length) out.params = p;
    } else if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) out[k] = next[k];
  }
  return Object.keys(out).length ? out : null;
}

// The phone's half of stateDiff: a patch laid over what it had.
export function mergeState(had, patch) {
  const { t: _t, ...fields } = patch;
  return { ...had, ...fields, params: { ...had?.params, ...fields.params } };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const name = (v) => (typeof v === 'string' && v.trim() && v.length <= MAX_NAME ? v.trim() : null);
const index = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

// Every command the phone may send, and what makes one well formed. `s` is the schema this screen sent; a command naming a dial, a
// macro, a row or a button the schema does not have is dropped, and a number is held to its control's range.
export const COMMANDS = {
  dial: (m, s) => { const d = s.dials[m.name], v = num(m.v); return d && v !== null ? { name: m.name, v: clamp(v, d.min, d.max), end: m.end === true } : null; },
  macro: (m, s) => { const v = num(m.v); return s.macros[m.key] && v !== null ? { key: m.key, v: clamp(v, 0, 1), end: m.end === true } : null; },
  param: (m, s) => {
    const row = s.panel.find((r) => r.key === m.key && r.kind !== 'button');
    if (!row) return null;
    if (row.kind === 'slider') { const v = num(m.v); return v === null ? null : { key: m.key, v: clamp(v, row.min, row.max) }; }
    if (row.kind === 'toggle') return typeof m.v === 'boolean' ? { key: m.key, v: m.v } : null;
    return row.options.some(([, value]) => value === m.v) ? { key: m.key, v: m.v } : null;
  },
  inherit: (m, s) => (s.panel.some((r) => r.key === m.key && r.fidelity) ? { key: m.key } : null),
  button: (m, s) => (s.panel.some((r) => r.kind === 'button' && r.id === m.id) ? { id: m.id } : null),
  step: (m) => (m.dir === 1 || m.dir === -1 ? { dir: m.dir } : null),
  go: (m) => (typeof m.value === 'string' ? { value: m.value } : null),
  list: (m) => (typeof m.value === 'string' ? { value: m.value } : null),
  play: (m) => (typeof m.on === 'boolean' ? { on: m.on } : null),
  trans: (m, s) => { const v = num(m.v); return v === null ? null : { v: clamp(v, 0, s.transMax) }; },
  asItWas: () => ({}),
  reseed: () => ({}),
  save: (m) => (name(m.name) ? { name: name(m.name) } : null),
  saveNew: (m) => (name(m.name) ? { name: name(m.name) } : null),
  newList: (m) => (name(m.name) ? { name: name(m.name) } : null),
  renameList: (m) => (name(m.name) ? { name: name(m.name) } : null),
  presentation: (m) => (['', 'screen', 'projector'].includes(m.v) ? { v: m.v } : null),
  times: (m) => {
    const at = index(m.at), t = {};
    for (const k of ['dwell_s', 'crossfade_s']) if (k in m) { if (num(m[k]) === null) return null; t[k] = m[k]; }
    return at === null || !Object.keys(t).length ? null : { at, times: t };
  },
  style: (m) => (index(m.at) !== null && (m.style === 'morph' || m.style === 'fade') ? { at: m.at, style: m.style } : null),
  move: (m) => (index(m.at) !== null && index(m.to) !== null ? { at: m.at, to: m.to } : null),
  remove: (m) => (index(m.at) !== null ? { at: m.at } : null),
  add: (m) => (typeof m.pick === 'string' && /^(p:\d+|s:.+)$/.test(m.pick) ? { pick: m.pick } : null),
};

// A message from the phone as the editor may run it — { t, ...checked fields } — or null.
export function readCommand(text, schema) {
  let m;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object' || !Object.hasOwn(COMMANDS, m.t)) return null;
  const c = COMMANDS[m.t](m, schema);
  return c ? { t: m.t, ...c } : null;
}

// host: { enabled(), signedIn(), connect(query) → WebSocket | null, schema(), state(), run(command), hint(text), changed(),
//         page() → the phone's address | null }. Returns { status() → the words Settings shows, poke() — look again now }.
export function mountRemote(host, { storage = globalThis.sessionStorage, ua = globalThis.navigator?.userAgent, every = setInterval } = {}) {
  let id = null;
  try { id = storage.getItem(ID_KEY); } catch { /* no storage: a new id each load */ }
  if (!id) { id = newScreenId(); try { storage.setItem(ID_KEY, id); } catch { /* kept for this page only */ } }
  const label = screenLabel(ua);

  let ws = null, open = false, phones = 0, fails = 0, retryAt = 0, schema = null, sent = null, word = '';
  const send = (m) => { if (open) ws.send(JSON.stringify(m)); };

  function say() {
    const w = !host.enabled() ? 'off'
      : !host.signedIn() ? 'on · sign in to arboretum here to use it'
      : !open ? (fails ? 'on · cannot reach arboretum; trying again' : 'on · connecting')
      : phones ? `on · ${phones === 1 ? 'a phone is' : `${phones} phones are`} connected`
      : `on · open ${host.page()} on your phone, signed in as you`;
    if (w !== word) { word = w; host.changed(); }
  }

  function drop() {
    if (!ws) return;
    const w = ws;
    ws = null; open = false; phones = 0;
    w.onopen = w.onmessage = w.onclose = w.onerror = null;
    try { w.close(1000); } catch { /* already closing */ }
  }

  function connect() {
    const w = host.connect({ role: 'screen', screen: id, label });
    if (!w) return;
    ws = w;
    w.onopen = () => { open = true; fails = 0; say(); };
    w.onmessage = (e) => onMessage(e.data);
    w.onclose = (e) => {
      if (ws !== w) return;
      ws = null; open = false; phones = 0;
      if (e.code === 4000) { id = newScreenId(); try { storage.setItem(ID_KEY, id); } catch { /* this page only */ } retryAt = 0; }   // a copy of this tab took the id
      else { retryAt = Date.now() + RETRY_MS[Math.min(fails, RETRY_MS.length - 1)]; fails++; }
      say();
    };
  }

  function onMessage(text) {
    if (typeof text !== 'string') return;
    let m = null;
    try { m = JSON.parse(text); } catch { return; }
    if (m?.t === 'want') {
      schema ??= host.schema();
      send({ t: 'schema', ...schema });
      sent = host.state();
      send({ t: 'state', ...sent });
      return;
    }
    if (m?.t === 'remotes') {
      const was = phones;
      phones = Number.isInteger(m.n) && m.n >= 0 ? m.n : 0;
      if (phones && !was) host.hint('remote: a phone is connected');
      else if (!phones && was) host.hint('remote: the phone has left');
      say();
      return;
    }
    if (!schema) return;   // a command before the board: the phone has not seen what it is changing
    const c = readCommand(text, schema);
    if (!c) return;
    try { host.run(c); } catch (e) { console.error(e); }
  }

  function tick() {
    const want = host.enabled() && host.signedIn();
    if (!want) drop();
    else if (!ws && Date.now() >= retryAt) connect();
    if (open && phones && schema) {
      const now = host.state(), patch = stateDiff(sent, now);
      if (patch) { send({ t: 'state', ...patch }); sent = now; }
    }
    say();
  }
  every(tick, TICK_MS);

  return { status: () => word, poke: tick };
}
