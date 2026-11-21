// The pure half of the adopt tool (test-gl/adopt.mjs): turning a setting that ships off by default on, and deciding look by look
// whether a built-in takes it or keeps what it was made with (GRANDFATHERED in engine/komorebi-params.js). No browser, no engine
// import: every function is handed what it reads. Held by test/adopt.test.js.
//
// A WORLD is what presets.js evaluates to over one set of DEFAULTS: { defaults, presets, playlists }. A built-in is written as the keys
// it names over LOOK_DEFAULTS, so the only way to know which looks a new default moves, whatever presets.js does with DEFAULTS, is to
// evaluate it twice, once over each, and compare. A look that moves is one whose params differ between the two worlds.

// A key the panel cannot set, or a machine key no look carries (komorebi-session.js FIDELITY_KEYS, PLAYBACK_KEYS), is not a look's setting.
export function parseFlip(args, PARAMS, machineKeys) {
  const flip = {}, problems = [];
  for (const a of args) {
    const at = a.indexOf('=');
    if (at < 1) { problems.push(`${a}: expected key=value`); continue; }
    const key = a.slice(0, at), raw = a.slice(at + 1);
    const d = PARAMS[key];
    if (!d) { problems.push(`${key}: no such parameter`); continue; }
    if (!('default' in d)) { problems.push(`${key}: an editor input, not a stored setting`); continue; }
    if (machineKeys.includes(key)) { problems.push(`${key}: a machine setting, not a look's`); continue; }
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }   // a bare word is a string choice (leaf_shape=maple)
    if (typeof value !== typeof d.default) { problems.push(`${key}: ${JSON.stringify(value)} is a ${typeof value}, its default is a ${typeof d.default}`); continue; }
    if (value === d.default) { problems.push(`${key}: ${JSON.stringify(value)} is already its default`); continue; }
    const r = d.row;
    if (r && typeof value === 'number' && r.min !== undefined && (value < r.min || value > r.max)) problems.push(`${key}: ${value} is outside its row's ${r.min}..${r.max}`);
    flip[key] = value;
  }
  if (!problems.length && !Object.keys(flip).length) problems.push('name at least one key=value');
  return { flip, problems };
}

// `--variant 'name:key=*0.82,key2=1.2'`: another B, the flip with those keys moved too. `*x` multiplies the look's own value (an exposure
// re-sat by the factor a law dims the beam by), anything else is the value itself.
export function parseVariant(s) {
  const at = s.indexOf(':');
  if (at < 1) throw new Error(`--variant ${s}: expected name:key=value[,key=value]`);
  const name = s.slice(0, at), set = {};
  for (const part of s.slice(at + 1).split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) throw new Error(`--variant ${s}: ${part} is not key=value`);
    const key = part.slice(0, eq).trim(), raw = part.slice(eq + 1).trim();
    if (raw.startsWith('*')) {
      const mul = Number(raw.slice(1));
      if (!Number.isFinite(mul)) throw new Error(`--variant ${s}: ${raw} is not a factor`);
      set[key] = { mul };
    } else {
      let val;
      try { val = JSON.parse(raw); } catch { val = raw; }
      set[key] = { val };
    }
  }
  return { name, set };
}

// Rounded to five significant figures here, once, so the value a variant was rendered at is the value apply writes into presets.js.
export function resolveVariant(variant, params) {
  const out = {};
  for (const [k, s] of Object.entries(variant.set)) {
    if ('val' in s) { out[k] = s.val; continue; }
    if (typeof params[k] !== 'number') throw new Error(`variant ${variant.name}: ${k} is not a number on this look, so *${s.mul} means nothing`);
    out[k] = Number((params[k] * s.mul).toPrecision(5));
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const diffKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k]));
export const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

// A params set's identity, independent of key order: apply holds the tree to the one the render saw.
export function paramsKey(p) {
  return JSON.stringify(Object.keys(p).sort().map((k) => [k, p[k]]));
}

// Which looks move, and with which keys. `named` looks say the key themselves and keep their value whatever the default is.
export function survey(before, after) {
  const moved = [], still = [];
  for (const look of Object.keys(before.presets)) {
    const keys = diffKeys(before.presets[look], after.presets[look] ?? {});
    if (keys.length) moved.push({ look, keys, over: pick(after.presets[look], keys) });
    else still.push(look);
  }
  return { moved, still };
}

// The order a person meets the looks in: the shipped playlists, then any built-in no playlist names.
export function lookOrder(presets, playlists) {
  const seen = [];
  for (const pl of Object.values(playlists)) for (const it of pl.items) {
    const look = typeof it === 'string' ? it : it.look;
    if (look in presets && !seen.includes(look)) seen.push(look);
  }
  for (const look of Object.keys(presets)) if (!seen.includes(look)) seen.push(look);
  return seen;
}

// A key that travels as topology, canopy, season or mode is one a route between two looks reads to decide whether they share a grove
// (spec/model/transitions.md): looks equal on every such key travel between each other without a dissolve. Keeping one of them and
// upgrading another would set them apart. Groups of two or more looks, among those the flip moves, that share every grove key today.
export const GROVE_WAYS = ['topo', 'canopy', 'season', 'mode'];
export function groveGroups(presets, looks, PARAMS) {
  const keys = Object.keys(PARAMS).filter((k) => GROVE_WAYS.includes(PARAMS[k].travels));
  const by = new Map();
  for (const look of looks) {
    const sig = JSON.stringify(keys.map((k) => presets[look][k]));
    if (!by.has(sig)) by.set(sig, []);
    by.get(sig).push(look);
  }
  return [...by.values()].filter((g) => g.length > 1);
}
export const flipTravels = (flip, PARAMS) => Object.keys(flip).filter((k) => GROVE_WAYS.includes(PARAMS[k].travels));

// What each moved look ships as, from the decisions: `picks` maps a look to a column letter ('a' as it is, 'b' the flip, 'c'… a
// variant), `rest` is the column every moved look the picks leave out takes. A look the still frame shows unmoved keeps the old value,
// named on purpose (the artist: "i only want the setting for the presets where it makes a difference, for the other ones it should be
// turned off on purpose"); a pick can still give it the flip. A visibly moved look with no pick and no `rest` is an error, never a guess.
export function resolvePicks(decisions, looks, columns) {
  const letters = columns.map((c) => c.letter), out = {}, problems = [];
  const picks = decisions.picks ?? {}, rest = decisions.rest ?? null;
  for (const look of Object.keys(picks)) if (!looks.some((l) => l.look === look)) problems.push(`${look}: picked, but the flip does not move it`);
  if (rest !== null && !letters.includes(rest)) problems.push(`rest: '${rest}' is not a column (${letters.join(', ')})`);
  for (const l of looks) {
    const p = picks[l.look] ?? (l.visible ? rest : 'a');
    if (p === null) problems.push(`${l.look}: moves visibly and has no pick (pick it, or set rest)`);
    else if (!letters.includes(p)) problems.push(`${l.look}: '${p}' is not a column (${letters.join(', ')})`);
    else out[l.look] = p;
  }
  return { picks: out, problems };
}

// Looks that share a grove today and would not after these picks, for a flip whose keys a route reads.
export function splitGroups(groups, picks, flipKeys, expected) {
  const out = [];
  for (const g of groups) {
    const sigs = new Set(g.map((look) => JSON.stringify(flipKeys.map((k) => expected[look][k]))));
    if (sigs.size > 1) out.push(g.map((look) => `${look} (${picks[look] ?? 'b'})`));
  }
  return out;
}

// ---- editing the sources. Each edit finds exactly one place or throws: a guess written into presets.js would be a look changed unseen.

export function jsLiteral(v, quote) {
  if (typeof v === 'string') return quote + v.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`) + quote;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new Error(`cannot write ${JSON.stringify(v)} as a literal`);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A built-in is `  '<name>': Object.assign({}, LOOK_DEFAULTS, {` … `  }),` in presets.js. Returns the header line's end and the body's
// extent (offsets into src).
export function findLook(src, name) {
  const head = new RegExp(`^  ${escapeRe(jsLiteral(name, "'"))}: Object\\.assign\\(\\{\\}, LOOK_DEFAULTS, \\{.*$`, 'gm');
  const hits = [...src.matchAll(head)];
  if (hits.length !== 1) throw new Error(`presets.js: ${hits.length} headers for '${name}', expected 1`);
  const bodyStart = hits[0].index + hits[0][0].length + 1;
  const close = /^ {2}\}\),?$/m.exec(src.slice(bodyStart));
  if (!close) throw new Error(`presets.js: no closing '  }),' after '${name}'`);
  return { bodyStart, bodyEnd: bodyStart + close.index };
}

const codeOf = (line) => line.replace(/\/\/.*$/, '');   // values in presets.js are numbers, booleans and plain words: no '//' inside one
export function namedKeys(body) {
  const out = new Set();
  for (const line of body.split('\n')) for (const m of codeOf(line).matchAll(/"(\w+)"\s*:/g)) out.add(m[1]);
  return out;
}

const insertAt = (src, at, text) => src.slice(0, at) + text + src.slice(at);

// Kept as made: the look names the old values, on one line at the top of its body, as the looks grandfathered before it do.
export function pinLook(src, name, values, comment) {
  const { bodyStart, bodyEnd } = findLook(src, name);
  const named = namedKeys(src.slice(bodyStart, bodyEnd));
  for (const k of Object.keys(values)) if (named.has(k)) throw new Error(`presets.js: '${name}' already names ${k}, so the flip cannot move it`);
  const line = `    ${Object.entries(values).map(([k, v]) => `"${k}": ${jsLiteral(v, '"')},`).join(' ')}   // ${comment}\n`;
  return insertAt(src, bodyStart, line);
}

// A variant's values: a key the look names is changed where it stands, any other is added; one comment line at the top says why.
export function setInLook(src, name, values, comment) {
  let out = src;
  const added = {};
  for (const [k, v] of Object.entries(values)) {
    const { bodyStart, bodyEnd } = findLook(out, name);
    const body = out.slice(bodyStart, bodyEnd);
    if (!namedKeys(body).has(k)) { added[k] = v; continue; }
    const lines = body.split('\n');
    const at = lines.findIndex((l) => new RegExp(`"${k}"\\s*:`).test(codeOf(l)));
    const code = codeOf(lines[at]), rest = lines[at].slice(code.length);
    const re = new RegExp(`("${k}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|[^,}\\s]+)`);
    if (!re.test(code)) throw new Error(`presets.js: cannot read '${name}''s ${k}`);
    lines[at] = code.replace(re, (_, pre) => pre + jsLiteral(v, '"')) + rest;
    out = out.slice(0, bodyStart) + lines.join('\n') + out.slice(bodyEnd);
  }
  const { bodyStart } = findLook(out, name);
  const addLine = Object.keys(added).length ? `    ${Object.entries(added).map(([k, v]) => `"${k}": ${jsLiteral(v, '"')},`).join(' ')}\n` : '';
  return insertAt(out, bodyStart, `    // ${comment}\n${addLine}`);
}

// `  key: { default: <old>,` in komorebi-params.js's PARAMS.
export function setDefault(src, key, value) {
  const re = new RegExp(`^(  ${escapeRe(key)}: \\{ default: )([^,]+)(,)`, 'gm');
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) throw new Error(`komorebi-params.js: ${hits.length} 'default:' lines for ${key}, expected 1`);
  return src.replace(re, (_, a, _old, c) => a + jsLiteral(value, "'") + c);
}

// The old values join GRANDFATHERED, before the two that moved with the first four laws (exposure, ambient_skylight), which close it.
export function addGrandfathered(src, values) {
  const re = /^const GRANDFATHERED = \{(.*)\};/m;
  const m = re.exec(src);
  if (!m) throw new Error('komorebi-params.js: no one-line GRANDFATHERED = { … };');
  const entries = Object.entries(values).map(([k, v]) => `${k}: ${jsLiteral(v, "'")}`).join(', ');
  const inner = m[1];
  const at = inner.indexOf(' exposure:');
  const next = at >= 0 ? `${inner.slice(0, at)} ${entries},${inner.slice(at)}` : `${inner.replace(/\s*$/, '')}, ${entries} `;
  return `${src.slice(0, m.index)}const GRANDFATHERED = {${next}};${src.slice(m.index + m[0].length)}`;
}

// ---- the record (test/defaults.json): every default as last decided. A default that changes without the adopt tool is a flip nobody
// reviewed: every built-in that does not name it moves.
export function checkRecord(record, defaults) {
  const changed = [], added = [], removed = [];
  for (const k of Object.keys(defaults)) {
    if (!(k in record)) added.push(k);
    else if (!same(record[k], defaults[k])) changed.push({ key: k, was: record[k], now: defaults[k] });
  }
  for (const k of Object.keys(record)) if (!(k in defaults)) removed.push(k);
  return { changed, added, removed };
}
export const recordText = (defaults) => `${JSON.stringify(defaults, null, 2)}\n`;

// How a flip reads in a comment: "sway_spread, gust_width_m were".
export const keysPhrase = (keys) => `${keys.join(', ')} ${keys.length > 1 ? 'were' : 'was'}`;

// ---- the four questions an upgrade answers before it ships: what it costs a frame, what it looks like, what it does to the motion, and
// what it does to the routes between looks. Each stage of adopt.mjs answers one into the review folder; questionsOf says which are still
// open, and apply refuses while any is.

// The engine holds about 60 frames a second (auto_quality's target), so a frame rate is read as a viewer sees it: capped at 60. An upgrade
// may cost a look at most FPS_LIMIT of it (the artist: "it can't be more than 10fps slower on my m4").
export const FPS_CAP = 60, FPS_LIMIT = 10;
export const shownFps = (ms) => Math.min(FPS_CAP, 1000 / ms);
export function fpsDrop(aMs, bMs) {
  const a = shownFps(aMs), b = shownFps(bMs);
  return { a, b, drop: a - b, slow: a - b > FPS_LIMIT };
}

// Every route the shipped playlists walk between two built-ins, each once, the last item back to the first (a playlist loops).
export function playlistPairs(playlists, presets) {
  const out = [], seen = new Set();
  for (const pl of Object.values(playlists)) {
    const items = pl.items.map((it) => (typeof it === 'string' ? it : it.look)).filter((l) => l in presets);
    for (let i = 0; i < items.length && items.length > 1; i++) {
      const pair = [items[i], items[(i + 1) % items.length]];
      if (pair[0] === pair[1]) continue;
      const key = JSON.stringify(pair);
      if (!seen.has(key)) { seen.add(key); out.push(pair); }
    }
  }
  return out;
}

// What each question still asks, from what the folder holds. `picks` are decisions.json's resolved (null before there is one: the stages
// then measure every moved look at b). state = { m (the manifest), decisions, cost, transitions, motion }.
export function questionsOf(state, picks, dir) {
  const { m, decisions, cost, transitions, motion } = state;
  const at = (look) => (picks ? picks[look] : 'b');
  const run = (stage, more = '') => `nix run .#adopt -- ${stage} ${dir}${more}`;
  const q = [];

  // 1. cost
  {
    const want = m.looks.filter((l) => at(l.look) !== 'a').flatMap((l) => (picks ? [at(l.look)] : m.columns.slice(1).map((c) => c.letter)).map((c) => [l.look, c]));
    const missing = cost ? want.filter(([look, c]) => !cost.looks[look]?.[c]) : want;
    const slow = cost ? want.filter(([look, c]) => cost.looks[look]?.[c]?.slow) : [];
    const said = (look, c) => { const r = cost.looks[look][c]; return `${look} ${c} (${r.a.toFixed(0)} → ${r.b.toFixed(0)} fps)`; };
    q.push({ key: 'cost', title: 'Realtime cost', open: !cost || missing.length > 0 || (picks !== null && slow.length > 0),
      say: !cost ? `not measured: ${run('cost')}`
        : missing.length ? `not measured for ${missing.map(([l, c]) => `${l} ${c}`).join(', ')}: ${run('cost')}`
        : slow.length ? `more than ${FPS_LIMIT} fps slower: ${slow.map(([l, c]) => said(l, c)).join(', ')}${picks ? '. Pick a for these, or make them cheaper' : ''}`
        : `no look picked loses more than ${FPS_LIMIT} fps (of ${FPS_CAP})` });
  }
  // 2. the look
  q.push({ key: 'look', title: 'The look (A/B)', open: !decisions,
    say: decisions ? 'picked (decisions.json)' : 'not picked: open index.html, pick per look, save decisions.json beside it' });
  // 3. motion
  {
    const measured = motion ? Object.keys(motion.looks) : [];
    const stale = motion && picks ? measured.filter((look) => motion.looks[look].pick !== at(look) && at(look) !== 'a') : [];
    const waived = typeof decisions?.motion === 'string' && decisions.motion.trim();
    q.push({ key: 'motion', title: 'Motion and the komorebi measures', open: !(measured.length && !stale.length) && !waived,
      say: waived ? `not measured: ${decisions.motion}`
        : stale.length ? `measured at another pick for ${stale.join(', ')}: ${run('motion', ` ${stale.map((l) => JSON.stringify(l)).join(' ')}`)}`
        : measured.length ? `measured on ${measured.join(', ')} (motion.json)`
        : `not measured: ${run('motion', ' [look …]')}, or say why it need not be in decisions.json's "motion"` });
  }
  // 4. transitions
  {
    const ranAt = transitions?.picks ?? null;
    const stale = transitions && JSON.stringify(ranAt) !== JSON.stringify(picks ?? null);
    const changed = transitions ? transitions.pairs.filter((p) => p.a.kind !== p.b.kind) : [];
    const ok = typeof decisions?.transitions === 'string' && decisions.transitions.trim();
    q.push({ key: 'transitions', title: 'Transitions', open: !transitions || stale || (changed.length > 0 && !ok),
      say: !transitions ? `not run: ${run('transitions')}`
        : stale ? `run at other picks than decisions.json's: ${run('transitions')}`
        : changed.length ? `${changed.length} route${changed.length > 1 ? 's' : ''} change kind: ${changed.map((p) => `${p.from} → ${p.to} (${p.a.kind} → ${p.b.kind})`).join(', ')}${ok ? `. ${decisions.transitions}` : `. Say why that is fine in decisions.json's "transitions", or pick differently`}`
        : `${transitions.pairs.length} routes keep their kind (transitions.json has each one's numbers and strips)` });
  }
  return q;
}
