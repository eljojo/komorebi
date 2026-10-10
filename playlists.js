// ============================================================================
// Komorebi editor — playlists. PURE: the model of "On this browser" beside the arboretum playlists, and the
// rules that move a look between them (editor-integration-design §3–§6). No DOM, and no network beyond the
// `fetch` that `detect` is handed. Persistence goes through getState/setState only; the ★ half is
// presets-store.js, so `stored` is passed in and handed back for the caller to setStored.
// ============================================================================
import { DEFAULTS, migrateLegacy } from "./komorebi.js";
import * as BUILTINS from "./presets.js";

export const ARB_KEY = "komorebi.arboretum";

const emptyState = () => ({ v: 1, me: null, origin: {}, playlists: {} });
const isObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

// The v1 state; empty on nothing, on corrupt JSON, and on a value that is not v1.
export function getState() {
  try {
    const s = JSON.parse(localStorage.getItem(ARB_KEY) || "null");
    if (!isObject(s) || s.v !== 1) return emptyState();
    return {
      v: 1,
      me: isObject(s.me) ? s.me : null,
      origin: isObject(s.origin) ? s.origin : {},
      playlists: isObject(s.playlists) ? s.playlists : {},
    };
  } catch { return emptyState(); }   // no localStorage, or malformed JSON -> behave as empty
}

export function setState(s) {
  try { localStorage.setItem(ARB_KEY, JSON.stringify(s)); }
  catch { /* storage full / disabled — the cache just isn't kept */ }
}

// ---- where arboretum is on (design §1). The only function here that may reach the network, and only on a
// loopback host under /editor/, which is where arboretum's own dev server puts the editor. ----
const PRODUCTION_HOST = "komorebi.eljojo.net";
const ARBORETUM = "https://arboretum.eljojo.net";

export async function detect(location, fetchImpl) {
  if (location.hostname === PRODUCTION_HOST) return ARBORETUM;
  const loopback = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!loopback || !location.pathname.startsWith("/editor/")) return null;
  try {
    const res = await fetchImpl(`${location.origin}/api/health`);
    if (!res.ok) return null;
    const body = await res.json();
    return body && body.ok === true && typeof body.engine === "string" ? location.origin : null;
  } catch { return null; }   // unreachable or not JSON: not arboretum
}

// ---- the links arboretum hands out (design §5) ------------------------------
const TOKEN = /^[A-Za-z0-9_-]+$/;       // arboretum's share tokens are base64url
const ID = /^[1-9]\d*$/;

export function parseHash(hash) {
  if (typeof hash !== "string") return null;
  const [head, ...rest] = hash.replace(/^#/, "").split("&");
  const [name, value] = head.split("=");
  if (name !== "arboretum" && name !== "arboretum-playlist") return null;
  const [id, n, ...extra] = (value ?? "").split("@");
  if (!ID.test(id) || extra.length) return null;
  const out = { id: Number(id) };
  if (n !== undefined) {
    if (name === "arboretum-playlist" || !ID.test(n)) return null;
    out.n = Number(n);
  }
  const k = rest.find((p) => p.startsWith("k="));
  if (k !== undefined) {
    if (!TOKEN.test(k.slice(2))) return null;
    out.k = k.slice(2);
  }
  return name === "arboretum" ? { preset: out } : { playlist: out };
}

// ---- the list a playlist shows and steps (design §3.2, §3.4) ----------------------
const cloudId = (active) => (active.startsWith("arb:") ? active.slice(4) : null);
const cloudItems = (state, active) => state.playlists[cloudId(active)]?.items ?? [];

// The EXPERIMENTAL looks are hidden unless `showBeta` — but the one you are on (`keep`) always stays listed.
// On this browser a value is a look name, in a cloud playlist an item index (two items may share a name).
export function entries(state, stored, builtins, showBeta, active, keep) {
  if (cloudId(active) !== null)
    return cloudItems(state, active).map((it, i) => ({ value: String(i), label: it.name }));
  const { PRESETS, EXPERIMENTAL } = builtins;
  return [
    ...Object.keys(PRESETS)
      .filter((n) => showBeta || !EXPERIMENTAL.includes(n) || n === keep)
      .map((n) => ({ value: n, label: `${EXPERIMENTAL.includes(n) ? "◦" : "•"} ${n}` })),   // ◦ marks an experimental look
    ...Object.keys(stored).map((n) => ({ value: n, label: `★ ${n}` })),
  ];
}

// The params of an entry, through migrateLegacy so a look saved yesterday loads tomorrow. A ★ shadows the
// built-in of its name.
export function resolve(state, stored, active, value) {
  if (cloudId(active) !== null) return migrateLegacy(cloudItems(state, active)[Number(value)]?.params);
  return migrateLegacy(value in stored ? stored[value] : BUILTINS.PRESETS[value]);
}

// The next value, wrapping; from a value that is not listed, from the first entry.
export function step(list, value, dir) {
  if (!list.length) return undefined;
  const at = Math.max(0, list.findIndex((e) => e.value === value));
  return list[(at + dir + list.length) % list.length].value;
}

// ---- the built-in guard (design §3.8) ----------------------------------------------
// The debug overlays do not change the art, so flipping one must not make a built-in "modified".
const OVERLAY_KEYS = new Set(["show_source", "show_layer", "show_layer_index"]);

// The name of the built-in that `params` still is — equal on every DEFAULTS key but the overlays — or null.
// `time_of_day` / `latitude` are not in DEFAULTS: they only write the sun knobs, which are compared.
export function builtinTwin(params, builtins) {
  const P = migrateLegacy(params);
  const keys = Object.keys(DEFAULTS).filter((k) => !OVERLAY_KEYS.has(k));
  for (const name of Object.keys(builtins.PRESETS)) {
    const B = migrateLegacy(builtins.PRESETS[name]);
    if (keys.every((k) => P[k] === B[k])) return name;
  }
  return null;
}

// ---- the cache of arboretum playlists (design §6.1). Every function below returns a new state. ----
const withOrigin = (state, origin) => ({ ...state, origin });
const withoutKey = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));

// `params` are stored as received (migrateLegacy runs on resolve, never here). The owner's unavailable items
// are not playable, so they leave the list and are counted on the playlist. The share token `k` comes from the
// link (`api.k`) and survives a refresh, so an unlisted playlist can be fetched again.
export function cachePlaylist(state, api) {
  const gone = api.items.filter((i) => i.unavailable).length;
  const entry = {
    id: api.id, name: api.name, owner: api.owner,
    k: api.k ?? state.playlists[api.id]?.k ?? null,
    fetched_at: Date.now(),
    unavailable: api.unavailable ?? gone,
    items: api.items.filter((i) => !i.unavailable).map(({ preset_id, version, owner, name, dwell_s, crossfade_s, params }) =>
      ({ preset_id, version, owner, name, dwell_s, crossfade_s, params })),
  };
  return { ...state, playlists: { ...state.playlists, [api.id]: entry } };
}

export function dropPlaylist(state, id) {
  return { ...state, playlists: withoutKey(state.playlists, String(id)) };
}

// ---- bringing a look in from arboretum (design §5): no duplicates, and unsynced edits are never overwritten ----
export function savePreset(state, stored, api) {
  const record = { id: api.id, version: api.version, owner: api.owner, synced: true };
  const same = Object.keys(stored).filter((n) => state.origin[n]?.id === api.id);
  let name = same.find((n) => state.origin[n].synced);
  if (name === undefined) {
    name = same.length ? `${api.name} (v${api.version})` : api.name;
    // A name a ★ already has belongs to an unrelated look (the same-id ones were found above).
    if (name in stored) name = `${api.name} (#${api.id})`;
    for (let n = 2; name in stored; n++) name = `${api.name} (#${api.id}) ${n}`;
  }
  return {
    state: withOrigin(state, { ...state.origin, [name]: record }),
    stored: { ...stored, [name]: api.params },
    name,
  };
}

// ---- provenance of a local look (design §4.1). `from` is the entry the save started from:
// { kind: 'builtin' | 'local', name } | { kind: 'cloud', item }, or nothing when it is not known. ----
function parentOf(state, from) {
  if (!from) return null;
  if (from.kind === "builtin") return `look:${from.name}`;
  if (from.kind === "cloud") return `preset:${from.item.preset_id}@${from.item.version}`;
  const o = state.origin[from.name];
  if (!o) return null;
  return o.id !== undefined ? `preset:${o.id}@${o.version}` : o.parent;
}

export function onSaved(state, name, from) {
  const here = state.origin[name];
  if (from?.kind === "local" && from.name === name) {   // saved over itself: the arboretum copy is now behind
    return here?.id !== undefined ? withOrigin(state, { ...state.origin, [name]: { ...here, synced: false } }) : state;
  }
  const parent = parentOf(state, from);
  const rest = withoutKey(state.origin, name);
  return withOrigin(state, parent ? { ...rest, [name]: { parent } } : rest);
}

export function onDeleted(state, name) {
  return withOrigin(state, withoutKey(state.origin, name));
}

export function onPushed(state, name, api) {
  return withOrigin(state, { ...state.origin, [name]: { id: api.id, version: api.version, owner: api.owner, synced: true } });
}

// ---- the smart upload (design §4.2) ------------------------------------------------------------
// What an upload would do, decided from what is known about the look, so the button can say it before the click:
//   { kind: 'version' | 'preset', path, body, label, into? } | { refused }
// In On this browser the params are the stored ★ snapshot (what you saved is what goes online); in a cloud
// playlist they are the live look, because the cloud is that folder's store, and `into` names the place the
// uploaded preset takes in it (`at` null: appended). `body.name` is the current look's name — the caller
// replaces it with what the save prompt returns; "" when a cloud playlist has no item to take it from.
// `me` is your username, `cam` the engine's cameraFor. A cloud playlist here is one of yours, and cached.
export function uploadPlan(state, stored, active, value, live, me, commit, cam) {
  const id = cloudId(active);
  const it = id === null ? undefined : cloudItems(state, active)[Number(value)];
  const params = id === null ? (value in stored ? stored[value] : BUILTINS.PRESETS[value]) : live;
  const twin = builtinTwin(params, BUILTINS);
  if (twin !== null) return { refused: `this is the built-in '${twin}', unchanged — change something first` };

  // What the look is known to be on arboretum: a preset id and its owner, or the version it started from.
  const known = id === null
    ? state.origin[value]
    : it && { id: it.preset_id, version: it.version, owner: it.owner };
  const name = id === null ? value : (it?.name ?? "");
  const out = known?.id !== undefined && known.owner === me
    ? { kind: "version", path: `/api/presets/${known.id}/versions`, label: `↑ new version of #${known.id}`, body: { name, params } }
    : { kind: "preset", path: "/api/presets", label: "↑ new preset", body: { name, params } };
  if (commit) out.body.komorebi_commit = commit;
  if (out.kind === "preset") {
    const parent = known?.id !== undefined ? `preset:${known.id}@${known.version}` : known?.parent;
    if (parent) out.body.parent = parent;
    if (cam(params) !== "floor") out.body.tags = ["experimental"];   // arboretum-spec §4.3
  }
  if (id !== null) out.into = { playlist: Number(id), at: it ? Number(value) : null };
  return out;
}

// ---- writing a playlist's items safely (design §3.7) --------------------------------------------
// The list to PUT after one change, applied to a FRESH GET of the playlist, never to the cache. A PUT replaces
// the whole list, so the owner's unavailable items are sent back in their places or they would be dropped.
// `at` counts the playable items only — the numbering `entries` uses. An appended preset carries no times, so
// arboretum's defaults apply; a replacement keeps the times of the place it takes.
// change: { kind: 'append', preset_id } | { kind: 'remove', at } | { kind: 'replace', at, preset_id }
export function itemsAfter(fresh, change) {
  const out = [];
  let playable = 0;
  for (const it of fresh) {
    const times = { dwell_s: it.dwell_s, crossfade_s: it.crossfade_s };
    if (it.unavailable || change.kind === "append" || change.at !== playable++) out.push({ preset_id: it.preset_id, ...times });
    else if (change.kind === "replace") out.push({ preset_id: change.preset_id, ...times });
  }
  if (change.kind === "append") out.push({ preset_id: change.preset_id });
  return out;
}
