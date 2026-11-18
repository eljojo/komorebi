// ============================================================================
// midi.js — EDITOR-only, PROTOTYPE. An AKAI MIDImix as a driver of the editor's controls, over Web MIDI.
// It writes nothing the sliders don't: the try-out dials (the look's own value is home), the macro bus, a few
// panel parameters through the same tryWrite landing, and the arrows' own stepPreset for the bank buttons.
// Imported by editor.js alone, which lends it a `host` (see mountMidi); nothing in the engine knows it exists.
//
// THE MIDIMIX'S FACTORY MAP (channel ignored). Strip i of 8: knobs CC base, base+1, base+2, fader base+3, with
// base 16, 20, 24, 28, 46, 50, 54, 58; the master fader CC 62. Buttons are notes: MUTE 1+3i, SOLO-held MUTE 2+3i,
// REC ARM 3+3i, BANK ◀ 25, BANK ▶ 26, SOLO 27. A note-on to the same note lights a button's LED (127 on, 0 off).
//
// THE TAKEOVER. A fader has a place the look does not know about, so the first touch decides what happens:
//   glide  the control eases toward the hand (one pole, GLIDE_TAU) — a jump becomes a breath, never a cut
//   catch  nothing moves until the hand passes the look's own value, then the control follows exactly
//   jump   the control is where the hand is
// Every mode lands at most once a frame: a fader sends many values per frame and each write can be a rebuild.
// ============================================================================

const STRIP_BASE = [16, 20, 24, 28, 46, 50, 54, 58];
const MASTER_CC = 62, BANK_L = 25, BANK_R = 26, SOLO = 27;
const GLIDE_TAU = 0.45, GLIDE_EPS = 0.002, CATCH_EPS = 0.025, HOME_EPS = 0.015;
const clamp01 = (u) => Math.min(1, Math.max(0, u));

// ---- pure: the wire and the takeover ----
export function decode(data) {
  const s = data[0] & 0xf0;
  if (s === 0xb0) return { kind: 'cc', cc: data[1], u: data[2] / 127 };
  if (s === 0x90 && data[2] > 0) return { kind: 'down', note: data[1] };
  if (s === 0x80 || s === 0x90) return { kind: 'up', note: data[1] };
  return null;
}
// a CC's place on the desk: { strip 0..7, row 0..2 knob / 3 fader } or { strip: 'master' }
export function ccSlot(cc) {
  if (cc === MASTER_CC) return { strip: 'master', row: 3 };
  for (let i = 0; i < 8; i++) if (cc >= STRIP_BASE[i] && cc < STRIP_BASE[i] + 4) return { strip: i, row: cc - STRIP_BASE[i] };
  return null;
}
export function noteSlot(note) {
  if (note === BANK_L) return { bank: -1 };
  if (note === BANK_R) return { bank: 1 };
  if (note === SOLO) return { solo: true };
  if (note >= 1 && note <= 24) return { strip: Math.floor((note - 1) / 3), button: ['mute', 'solo', 'arm'][(note - 1) % 3] };
  return null;
}
// catch: caught once the hand is at the look's value, or has passed it since the last message
export function catchStep(st, u, cur) {
  if (st.caught) return { caught: true, prev: u };
  const crossed = st.prev != null && (st.prev - cur) * (u - cur) <= 0;
  return { caught: crossed || Math.abs(u - cur) < CATCH_EPS, prev: u };
}
export function glideStep(x, target, dt, tau = GLIDE_TAU) {
  const nx = x + (target - x) * (1 - Math.exp(-dt / tau));
  return Math.abs(nx - target) < GLIDE_EPS ? target : nx;
}

// ---- the layout: what each strip is. Grouped by what it touches in the world, light → sun → wind → canopy → season → camera → floor. ----
// { dial } a try-out dial (home = the look's own); { macro } a bus key; { param, offset | scale } a panel row, home-relative;
// { trans } the scene-transition time. A strip's MUTE puts all of it back as the look had it.
const LAYOUT = [
  { name: 'light', knobs: [{ dial: 'focus' }, { macro: 'haze' }, { macro: 'prism', label: 'sparkle' }], fader: { dial: 'cloudiness', label: 'clouds' } },
  { name: 'sun', knobs: [{ dial: 'sun' }], fader: { dial: 'time' } },
  { name: 'wind', knobs: [{ macro: 'wind_x' }, { param: 'wind_direction_deg', offset: 360, wrap: true, label: 'direction' }, { param: 'drift_amount', offset: 0.3, label: 'drift' }], fader: { macro: 'wind_y' } },
  { name: 'canopy', knobs: [{ macro: 'grove', label: 'trees' }], fader: { dial: 'density' } },
  { name: 'season', knobs: [], fader: { dial: 'season' } },
  { name: 'camera', knobs: [{ param: 'view_pitch_deg', offset: 60, label: 'tilt' }, { param: 'view_yaw_deg', offset: 360, wrap: true, label: 'orbit' }, { pan: true, label: 'pan' }], fader: { param: 'view_extent_m', scale: 1.5, label: 'zoom' } },
  { name: 'floor', knobs: [{ macro: 'palette' }, { param: 'contrast', offset: 0.8 }], fader: null },
  { name: 'travel', knobs: [], fader: { trans: true, label: 'transition' } },
];
// THE COLOUR LAYER (REC ARM 7 flips to it and back, lit while it is up; SOLO's own LED is the desk's, not ours). No grade on top of the picture: every control is a physical
// quantity a look already authors, home-relative, at about the spread the shipped looks span. The leaf's hue is what it passes (the
// green of the shade), the ground's is what the floor reflects, the cloth's is the dye the curtain and tent glow through.
// { trio, ch } one channel of an RGB triple (ch 'light' scales all three together); { param, abs } the panel row's whole range.
const LEAF = ['trans_r', 'trans_g', 'trans_b'], GROUND = ['ground_r', 'ground_g', 'ground_b'], CLOTH = ['fabric_tint_r', 'fabric_tint_g', 'fabric_tint_b'];
const COLOUR = [
  { name: 'ground', knobs: [{ trio: GROUND, ch: 0, offset: 0.5, label: 'red', gate: 'floor' }, { trio: GROUND, ch: 1, offset: 0.5, label: 'green', gate: 'floor' }, { trio: GROUND, ch: 2, offset: 0.5, label: 'blue', gate: 'floor' }], fader: { trio: GROUND, ch: 'light', scale: 1.5, label: 'ground light', gate: 'floor' } },
  { name: 'leaf', knobs: [{ trio: LEAF, ch: 0, offset: 0.3, label: 'red' }, { trio: LEAF, ch: 1, offset: 0.3, label: 'green' }, { trio: LEAF, ch: 2, offset: 0.3, label: 'blue' }], fader: { trio: LEAF, ch: 'light', scale: 1, label: 'leaf light' } },
  { name: 'shade', knobs: [{ param: 'ambient_skylight', scale: 1.5, label: 'shade' }, { param: 'mesopic_strength', offset: 1, label: 'dusk rods' }, { param: 'sky_turbidity', offset: 0.4, label: 'haze β' }], fader: { param: 'contrast', offset: 0.8 } },
  { name: 'cloth', knobs: [{ trio: CLOTH, ch: 0, offset: 0.5, label: 'red', gate: 'cloth' }, { trio: CLOTH, ch: 1, offset: 0.5, label: 'green', gate: 'cloth' }, { trio: CLOTH, ch: 2, offset: 0.5, label: 'blue', gate: 'cloth' }], fader: { param: 'fabric_tt', offset: 1, label: 'cloth light', gate: 'cloth' } },
  { name: 'frame', knobs: [{ param: 'vignette_shape', offset: 6, label: 'edge shape' }], fader: { param: 'vignette', abs: true, label: 'edge fade' } },
  { name: 'glow', knobs: [], fader: { param: 'sky_scatter', abs: true, label: 'foliage glow', gate: 'sky' } },
  // the fall's colour: what pigments a turning leaf takes on and whether the sun orders the turn, with the season's own clock (general 5's dial) under
  // the hand, so the knobs come alive as it reaches the turn. Re-seasoned, never regrown (SEASON_KEYS).
  { name: 'fall', knobs: [{ param: 'anthocyanin', abs: true, scope: 'season', label: 'red', gate: 'fall' }, { param: 'tannin', abs: true, scope: 'season', label: 'brown', gate: 'fall' }, { param: 'turn_exposure', abs: true, scope: 'season', label: 'sun first', gate: 'fall' }], fader: { dial: 'season' } },
  { name: 'fallen', knobs: [{ param: 'litter_age', abs: true, label: 'browns over', gate: 'litter' }], fader: { param: 'leaf_wetness', abs: true, label: 'wet', gate: 'litter' } },
];
const LAYERS = { general: LAYOUT, colour: COLOUR };
// where a gated control is honest, and what it says when it is not
const GATES = {
  floor: [(p) => (p.receiver | 0) === 0 && !p.sky_view, 'only the floor has a ground'],
  cloth: [(p) => (p.receiver | 0) > 0, 'only the curtain and the tent have cloth'],
  sky: [(p) => !!p.sky_view && !(p.leaf_diffuse > 0), 'only the looks seen from below glow'],
  fall: [(p) => p.phenology > p.turn_start - (p.tree_clock_spread ?? 0), 'the leaves have not turned yet: season first (general 5)'],
  litter: [(p) => p.litter > 0, 'no fallen leaves lie on this floor'],
};
const MASTER = { param: 'exposure', scale: 2, label: 'brightness' };   // the same on both layers
// REC ARM buttons that do something, on both layers: strip index → action name
const ARM = { 0: 'panel', 1: 'console', 3: 'leaves', 6: 'layer', 7: 'play' };

export function mountMidi(host) {
  const { params } = host;
  const panelRow = (k) => host.PANEL.find((r) => r[1] === k);
  let homeParams = { ...params };

  // ---- controls: { label, get(): u, set(u), home(): u | null, reset(), usable(), settle } ----
  const trios = new Map();   // first key of a triple -> { o: [r, g, b] offsets, s: scale }
  const gated = (spec) => (spec.gate ? { usable: () => GATES[spec.gate][0](params), why: GATES[spec.gate][1] } : { usable: () => true });
  function control(spec, fallback) {
    if (!spec) return null;
    if (spec.dial) {
      const d = host.TRY_SPECS[spec.dial], raw = (u) => d.min + u * (d.max - d.min);
      return {
        label: spec.label ?? spec.dial,
        get: () => (host.tryReady() ? clamp01((d.seat() - d.min) / (d.max - d.min)) : 0.5),   // before the first look lands there is no home to seat against
        set: (u) => d.write(raw(u)),
        home: () => (host.tryReady() ? d.home() : null),
        reset: () => { d.write(raw(d.home())); d.commit?.(); },
        usable: () => host.tryReady() && (spec.dial !== 'season' || host.macroUsable('season', params)),
        settle: false,
      };
    }
    if (spec.macro) {
      const m = host.MACROS[spec.macro];
      let home = null;
      const keys = Object.keys(m.stops[0].set);
      return {
        label: spec.label ?? m.label,
        get: () => host.bus.get(spec.macro),
        set: (u) => host.bus.set(spec.macro, u),
        home: () => home,
        look: () => { home = host.bus.get(spec.macro); },
        reset: () => { const dict = {}; for (const k of keys) dict[k] = homeParams[k]; host.tryWrite(dict, m.scope); },
        usable: () => host.macroUsable(spec.macro, params),
        settle: !m.live && !m.tween,   // a regrow: written once the hand has come to rest
      };
    }
    if (spec.param) {
      const r = panelRow(spec.param), [lo, hi, scope] = [r[3], r[4], spec.scope ?? r[6]];
      const h = () => homeParams[spec.param] ?? params[spec.param];
      const toV = spec.abs ? (u) => lo + u * (hi - lo) : spec.scale
        ? (u) => Math.min(hi, Math.max(lo, h() * 2 ** ((u - 0.5) * 2 * spec.scale)))
        : (u) => { const v = h() + (u - 0.5) * spec.offset; return spec.wrap ? ((v - lo) % (hi - lo) + (hi - lo)) % (hi - lo) + lo : Math.min(hi, Math.max(lo, v)); };
      const toU = spec.abs ? () => clamp01((params[spec.param] - lo) / (hi - lo)) : spec.scale
        ? () => clamp01(0.5 + Math.log2(params[spec.param] / h()) / (2 * spec.scale))
        : () => { let d = params[spec.param] - h(); if (spec.wrap) d = ((d + (hi - lo) / 2) % (hi - lo) + (hi - lo)) % (hi - lo) - (hi - lo) / 2; return clamp01(0.5 + d / spec.offset); };
      return {
        label: spec.label ?? r[2],
        get: toU,
        set: (u) => host.tryWrite({ [spec.param]: toV(u) }, scope),
        home: () => (spec.abs ? clamp01((h() - lo) / (hi - lo)) : 0.5),
        reset: () => host.tryWrite({ [spec.param]: h() }, scope),
        ...gated(spec),
        settle: false,
      };
    }
    // one channel of an RGB triple, or its light (all three scaled). The triple's channels share one state, so a fader's scale and a
    // knob's offset compose: value = (home + offset) · scale. Reset with the look.
    if (spec.trio) {
      const [k0] = spec.trio, rows = spec.trio.map(panelRow), scope = rows[0][6];
      const g = trios.get(k0) ?? trios.set(k0, { o: [0, 0, 0], s: 1 }).get(k0);
      const write = () => {
        const dict = {};
        spec.trio.forEach((k, i) => { dict[k] = Math.min(rows[i][4], Math.max(rows[i][3], ((homeParams[k] ?? params[k]) + g.o[i]) * g.s)); });
        host.tryWrite(dict, scope);
      };
      const light = spec.ch === 'light';
      return {
        label: spec.label,
        get: () => (light ? clamp01(0.5 + Math.log2(g.s) / (2 * spec.scale)) : clamp01(0.5 + g.o[spec.ch] / spec.offset)),
        set: (u) => { if (light) g.s = 2 ** ((u - 0.5) * 2 * spec.scale); else g.o[spec.ch] = (u - 0.5) * spec.offset; write(); },
        home: () => 0.5,
        reset: () => { if (light) g.s = 1; else g.o[spec.ch] = 0; write(); },
        ...gated(spec),
        settle: false,
      };
    }
    // pan: the view walks sideways across the screen, a screen-height either way of the look's own centre. Sideways is the
    // floor map's screen x (world = R(yaw)·screen + view_center, the pinch's ground()), so it follows the orbit.
    if (spec.pan) {
      const side = () => { const a = params.view_yaw_deg * Math.PI / 180; return [Math.cos(a), -Math.sin(a)]; };
      const span = () => 2 * (homeParams.view_extent_m ?? params.view_extent_m);
      const toCenter = (u) => {
        const [dx, dy] = side(), d = (u - 0.5) * span(), c = (v) => Math.min(25, Math.max(-25, v));
        return { view_center_x: c(homeParams.view_center_x + d * dx), view_center_y: c(homeParams.view_center_y + d * dy) };
      };
      return {
        label: spec.label,
        get: () => { const [dx, dy] = side(); return clamp01(0.5 + ((params.view_center_x - homeParams.view_center_x) * dx + (params.view_center_y - homeParams.view_center_y) * dy) / span()); },
        set: (u) => host.tryWrite(toCenter(u), ''),
        home: () => 0.5,
        reset: () => host.tryWrite(toCenter(0.5), ''),
        usable: () => true,
        settle: false,
      };
    }
    if (spec.trans) return {
      label: spec.label, get: () => host.getTransDur() / 6, set: (u) => host.setTransDur(Math.round(u * 60) / 10),
      home: () => null, reset() {}, usable: () => true, settle: false,
    };
    return fallback ?? null;
  }
  const layers = {};
  for (const [name, layout] of Object.entries(LAYERS)) layers[name] = layout.map((s) => ({ name: s.name, rows: [...[0, 1, 2].map((i) => control(s.knobs[i])), control(s.fader)] }));
  let layer = 'general', strips = layers.general;
  const master = { name: 'master', rows: [null, null, null, control(MASTER)] };
  const at = (slot) => (slot.strip === 'master' ? master : strips[slot.strip]).rows[slot.row];
  const all = () => [...Object.values(layers).flat(), master].flatMap((s) => s.rows).filter(Boolean);

  // ---- state ----
  let mode = 'catch';
  const pending = new Map();   // control -> { target, x }
  const catches = new Map();   // control -> { caught, prev }
  let access = null, output = null, status = navigator.requestMIDIAccess ? 'not connected' : 'this browser has no Web MIDI (Chrome, Edge or Firefox have it)';
  const log = [];
  let last = performance.now(), ledAt = 0;
  const leds = new Map();      // note -> on, what the desk was last told

  // ---- the caption: which control moved and where it sits against home, in the look-name's face ----
  const css = document.createElement('style');
  css.textContent = `
  #midiCap { position:fixed; bottom:28px; left:50%; transform:translateX(-50%); z-index:9; text-align:center; pointer-events:none;
    font: italic 400 15px "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; color:#f1e7cf; text-shadow:0 1px 12px rgba(0,0,0,.6);
    opacity:0; transition:opacity .6s ease; }
  #midiCap.on { opacity:.9; }
  #midiCap .bar, #midi .bar { position:relative; height:2px; background:rgba(241,231,207,.2); margin-top:6px; }
  #midiCap .bar { width:180px; margin:8px auto 0; }
  :is(#midiCap,#midi) .bar i { position:absolute; top:-2px; width:2px; height:6px; background:#f1e7cf; transform:translateX(-1px); }
  :is(#midiCap,#midi) .bar b { position:absolute; top:-3px; width:1px; height:8px; background:rgba(241,231,207,.45); }
  #midi { position:fixed; inset:auto 16px 16px auto; z-index:20; max-width:calc(100vw - 32px); max-height:calc(100vh - 32px); overflow:auto;
    background:rgba(16,14,10,.88); color:#e9e1cc; font:12px/1.35 ui-monospace,Menlo,monospace; padding:12px 14px; border-radius:6px; }
  #midi[hidden] { display:none; }
  #midi .grid { display:grid; grid-template-columns:repeat(9, 92px); gap:10px; margin:10px 0; }
  #midi .strip h4 { margin:0 0 4px; font-weight:600; color:#f1e7cf; }
  #midi .strip h4 .n { opacity:.45; font-weight:400; margin-right:5px; }
  #midi .row { margin-bottom:6px; } #midi .row.off { opacity:.35; } #midi .row.none { opacity:.15; }
  #midi button { font:inherit; background:none; color:inherit; border:1px solid rgba(233,225,204,.35); border-radius:3px; padding:2px 8px; margin-right:4px; cursor:pointer; }
  #midi button.on { background:#e9e1cc; color:#111; }
  #midi .head { display:flex; gap:16px; align-items:baseline; }
  #midi pre { margin:0 0 0 auto; opacity:.7; white-space:pre; }`;
  document.head.appendChild(css);
  const cap = document.createElement('div'); cap.id = 'midiCap'; document.body.appendChild(cap);
  let capTimer = 0;
  const barHtml = (u, home) => `<div class="bar">${home == null ? '' : `<b style="left:${home * 100}%"></b>`}<i style="left:${u * 100}%"></i></div>`;
  function say(text, u, home) {
    cap.innerHTML = `${text}${u == null ? '' : barHtml(u, home)}`;
    cap.classList.add('on'); clearTimeout(capTimer); capTimer = setTimeout(() => cap.classList.remove('on'), 1800);
  }

  // ---- the overlay (M): the map, live, the takeover mode and the raw wire ----
  const box = document.createElement('div'); box.id = 'midi'; box.hidden = true; document.body.appendChild(box);
  box.innerHTML = `<div class="head"><div><b>MIDI</b> · <span class="ly"></span> · <span class="st"></span> <button class="conn">connect</button></div><div>takeover: <button data-m="glide">glide</button><button data-m="catch">catch</button><button data-m="jump">jump</button></div><pre></pre></div>
    <div class="grid"></div><div>bank ◀ ▶ step looks · mute: reset look · arm 1 panel · arm 2 this console · arm 4 new leaves · arm 7 colour · arm 8 play/stop</div>`;
  box.querySelector('.conn').addEventListener('click', () => connect());
  for (const b of box.querySelectorAll('[data-m]')) b.addEventListener('click', () => setMode(b.dataset.m));
  function setMode(m) { mode = m; pending.clear(); catches.clear(); paint(); }
  function paint() {
    box.querySelector('.st').textContent = status;
    box.querySelector('.ly').textContent = layer;
    box.querySelector('.conn').hidden = !!access || !navigator.requestMIDIAccess;
    for (const b of box.querySelectorAll('[data-m]')) b.classList.toggle('on', b.dataset.m === mode);
    box.querySelector('.grid').innerHTML = [...strips, master].map((s, i) => `<div class="strip"><h4>${i < 8 ? `<span class="n">${i + 1}</span>` : ''}${s.name}</h4>${s.rows.map((c, i) => {
      if (!c) return `<div class="row none">${i === 3 ? 'fader' : 'knob'} —</div>`;
      const ct = catches.get(c);
      const flag = mode === 'catch' && ct && !ct.caught ? ' ⋯' : '';
      return `<div class="row${c.usable() ? '' : ' off'}">${c.label}${flag}${barHtml(c.get(), c.home())}</div>`;
    }).join('')}</div>`).join('');
    box.querySelector('pre').textContent = log.join('\n');
  }
  let paintTimer = 0;
  function toggle() {
    box.hidden = !box.hidden;
    clearInterval(paintTimer);
    if (!box.hidden) { paint(); paintTimer = setInterval(paint, 120); }
  }

  // ---- the wire ----
  function note(n, on) {
    if (!output || leds.get(n) === on) return;
    leds.set(n, on);
    try { output.send([0x90, n, on ? 127 : 0]); } catch { /* the desk went away mid-send: statechange rebinds */ }
  }
  function bind() {
    const ins = [...access.inputs.values()], outs = [...access.outputs.values()];
    for (const i of ins) i.onmidimessage = (e) => onMessage(e.data, i.name);
    output = outs.find((o) => /mid\s*i?\s*mix/i.test(o.name)) ?? null;
    leds.clear();
    status = ins.length ? ins.map((i) => i.name).join(', ') + (output ? '' : ' (no MIDImix output: no LEDs)') : 'no MIDI inputs';
    if (output) { for (let n = 1; n <= 27; n++) note(n, false); note(BANK_L, true); note(BANK_R, true); }
    paint();
  }
  async function connect() {
    if (!navigator.requestMIDIAccess) return;
    try { access = await navigator.requestMIDIAccess(); access.onstatechange = bind; bind(); }
    catch (e) { status = `refused: ${e.message}`; paint(); }
  }
  navigator.permissions?.query({ name: 'midi' }).then((p) => { if (p.state === 'granted') connect(); }).catch(() => {});

  function onMessage(data, from) {
    const m = decode(data);
    const raw = [...data].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    let what = '?';
    if (m?.kind === 'cc') {
      const slot = ccSlot(m.cc), c = slot && at(slot);
      what = c ? `${slot.strip === 'master' ? 'master' : strips[slot.strip].name} · ${c.label}` : slot ? 'unmapped' : `cc ${m.cc}?`;
      if (c) move(c, m.u);
    } else if (m?.kind === 'down') {
      const slot = noteSlot(m.note);
      what = slot ? press(slot) : `note ${m.note}?`;
    } else if (m?.kind === 'up') what = 'release';
    log.unshift(`${raw.padEnd(9)} ${what}   ${from}`); log.length = 1;
  }
  function move(c, u) {
    if (!c.usable()) { say(`${c.label}: ${c.why ?? 'tuned for the floor looks'}`); return; }
    host.stopPlay();
    if (mode === 'catch') {
      const st = catchStep(catches.get(c) ?? { caught: false, prev: null }, u, c.get());
      catches.set(c, st);
      if (!st.caught) { say(`${c.label} ${u < c.get() ? '↑' : '↓'} to catch`, c.get(), u); return; }
    }
    const p = pending.get(c);
    if (p) p.target = u; else pending.set(c, { target: u, x: null });
  }
  function press(slot) {
    if (slot.bank) { host.stepPreset(slot.bank); return slot.bank < 0 ? 'previous look' : 'next look'; }
    if (slot.solo) return 'solo';
    const s = strips[slot.strip];
    if (slot.button === 'mute') {
      for (const c of s.rows) if (c) { pending.delete(c); catches.delete(c); if (c.usable()) c.reset(); }
      host.syncUI(); say(`${s.name}: as it was`);
      return `${s.name}: as it was`;
    }
    if (slot.button === 'arm') {
      const a = ARM[slot.strip];
      if (a === 'panel') host.toggleControls();
      else if (a === 'console') toggle();
      else if (a === 'layer') {   // the faders now mean other things: every catch is let go, or a hand left high on one layer jumps the other
        layer = layer === 'general' ? 'colour' : 'general'; strips = layers[layer];
        pending.clear(); catches.clear(); say(layer); paint();
        return `layer: ${layer}`;
      }
      else if (a === 'leaves') { host.reseed(); say('new leaves'); }
      else if (a === 'play') host.togglePlay();
      return a ?? 'arm —';
    }
    return slot.button;
  }

  // ---- once a frame (editor's onFrame) ----
  function frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (pending.size && !host.transActive()) {   // a look in transition owns its params; the hand waits for the arrival
      let wrote = null;
      for (const [c, p] of pending) {
        if (mode === 'glide') {
          p.x ??= c.get();
          p.x = glideStep(p.x, p.target, dt);
          const landed = p.x === p.target;
          if (!c.settle || landed) { c.set(p.x); wrote = c; }
          if (landed) pending.delete(c);
        } else { c.set(p.target); wrote = c; pending.delete(c); }
      }
      if (wrote) { host.syncUI(); say(wrote.label, wrote.get(), wrote.home()); }
    }
    if (output && now - ledAt > 200) {
      ledAt = now;
      strips.forEach((s, i) => { note(1 + 3 * i, s.rows.some((c) => c && c.home() != null && c.usable() && Math.abs(c.get() - c.home()) > HOME_EPS)); });
      note(3 + 3 * 7, host.playing());
      note(3 + 3 * 6, layer === 'colour');   // ARM 7: lit on the colour layer
      note(3 + 3 * 3, true); note(3 + 3 * 4, true);   // ARM 4 and 5: always lit, the middle of the desk
    }
  }
  // every load of a look: the new home, and every catch let go (the look's values moved under the hands)
  function look() {
    homeParams = { ...params };
    for (const c of all()) c.look?.();
    for (const g of trios.values()) { g.o = [0, 0, 0]; g.s = 1; }
    pending.clear(); catches.clear();
  }
  look();
  return { frame, look, toggle };
}
