// ============================================================================
// Komorebi editor — playlists. PURE: the model of "all looks" beside the arboretum playlists, and the rules that move a
// look between them (editor-integration-design §3–§6). No DOM, no storage and no network beyond the `fetch` that `detect`
// is handed: the state is passed in and handed back (arboretum.js keeps it in localStorage, and the ★ looks beside it).
// ============================================================================
import { DEFAULTS, migrateLegacy } from "./komorebi.js";
import * as BUILTINS from "./presets.js";

// ---- where arboretum is on (design §1). The only function here that may reach the network, and only on a
// loopback host under /editor/, which is where arboretum's own dev server puts the editor. ----
const PRODUCTION_HOST = "komorebi.eljojo.net";
export const ARBORETUM = "https://komorebi.eljojo.net";

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
export const LOCAL_NAME = "all looks";
const cloudId = (active) => (active.startsWith("arb:") ? active.slice(4) : null);
const cloudItems = (state, active) => state.playlists[cloudId(active)]?.items ?? [];
const cloudItem = (state, active, value) => value === "" || value === null || value === undefined ? undefined : cloudItems(state, active)[Number(value)];
const isBuiltin = (PRESETS, name) => Object.hasOwn(PRESETS, name);
const synced = (o) => o?.id !== undefined && o.synced === true;   // a ★ whose arboretum copy is current
// A linked look stays local unless the same owned version is selectable in the cloud view. Other owners and pinned versions
// have no equivalent in the owned mirror, even though their local copies are synced with arboretum.
const browserNames = (state, stored) => Object.keys(stored).filter((n) => {
  const o = state.origin[n], me = state.me?.username;
  return !synced(o) || o.owner !== me || !Object.values(state.playlists).some((p) => p.owner === me && p.items.some((it) =>
    !it.pending && it.preset_id === o.id && it.version === o.version));
});

// In all looks a value is the look's name — except for a ★ that shares a built-in's name, which takes the
// value "★ <name>" so the two stay apart (one value would load the same look for both). A ★ whose name already
// starts "★ " is escaped the same way, so no two values collide. The value never depends on whether the built-in is
// listed, so the experimental toggle cannot move a ★'s value.
const starValueOf = (PRESETS, name) => (isBuiltin(PRESETS, name) || name.startsWith("★ ") ? `★ ${name}` : name);
export const starValue = (name) => starValueOf(BUILTINS.PRESETS, name);

// A refresh may reorder a cloud list without changing the live look. Follow its preset (or waiting save), never the old index.
export function selectionAfter(before, after, active, value) {
  if (cloudId(active) === null) return value;
  if (value === "") return "";
  const old = cloudItems(before, active), item = old[Number(value)];
  if (!item) return "";
  const same = (it) => item.preset_id !== undefined ? it.preset_id === item.preset_id : item.seq !== undefined && it.seq === item.seq;
  const occurrence = old.slice(0, Number(value)).filter(same).length;
  const matches = cloudItems(after, active).map((it, i) => same(it) ? i : -1).filter((i) => i >= 0);
  return matches[occurrence] === undefined ? "" : String(matches[occurrence]);
}

// The ★ an all-looks value denotes, or null when it is a built-in (or nothing).
export function starName(stored, active, value) {
  if (cloudId(active) !== null || typeof value !== "string") return null;
  if (value.startsWith("★ ")) {
    const name = value.slice(2);
    return Object.hasOwn(stored, name) && starValue(name) === value ? name : null;
  }
  return Object.hasOwn(stored, value) && starValue(value) === value ? value : null;   // starValue(value) === value: neither a built-in's name nor one that needs escaping
}

// The look's own name: a ★'s, a built-in's, a cloud item's.
export function entryName(state, stored, active, value) {
  if (cloudId(active) !== null) return cloudItem(state, active, value)?.name;
  return starName(stored, active, value) ?? value;
}

// The playlists a visitor can pick between: all looks, then yours as arboretum lists them (`mine`: summaries,
// not cached until picked), then the cached ones that are not among them. Once you are signed in (`me`), a cached one
// that is someone else's carries its owner's name.
export function playlists(state, mine = [], me = null) {
  const listed = new Set(mine.map((p) => String(p.id)));
  const label = (p) => (me && p.owner !== me ? `${p.name} · ${p.owner}` : p.name);
  return [{ value: "local", label: LOCAL_NAME },
    ...mine.map((p) => ({ value: `arb:${p.id}`, label: p.name })),
    ...Object.values(state.playlists).filter((p) => !listed.has(String(p.id))).map((p) => ({ value: `arb:${p.id}`, label: label(p) }))];
}

// Whether the active playlist plays: only an arboretum playlist carries dwell times (design §3.6).
export const plays = (state, active) => cloudItems(state, active).length > 0;

// The dwell and crossfade of a cloud entry; all looks has none.
export function timing(state, active, value) {
  const it = cloudId(active) === null ? undefined : cloudItem(state, active, value);
  return it ? { dwell_s: it.dwell_s, crossfade_s: it.crossfade_s } : null;
}

// The EXPERIMENTAL looks are hidden unless `showBeta` — but the one you are on (`keep`) always stays listed.
// A value in a cloud playlist is an item index (two items may share a name). Three lists are local: all looks (signed out:
// the built-ins, then the ★ looks), and signed in, built-ins (the shipped looks alone, read-only) and on this browser (the ★
// looks not yet in arboretum — one that is already a synced preset is listed there as itself).
export function entries(state, stored, builtins, showBeta, active, keep, signedIn = false) {
  if (cloudId(active) !== null)
    return cloudItems(state, active).map((it, i) => ({ value: String(i), label: it.name }));
  const { PRESETS, EXPERIMENTAL } = builtins;
  const shipped = Object.keys(PRESETS)
    .filter((n) => showBeta || !EXPERIMENTAL.includes(n) || n === keep)
    .map((n) => ({ value: n, label: `${EXPERIMENTAL.includes(n) ? "◦" : "•"} ${n}` }));   // ◦ marks an experimental look
  const stars = (signedIn ? browserNames(state, stored) : Object.keys(stored))
    .map((n) => ({ value: starValueOf(PRESETS, n), label: `★ ${n}` }));
  return active === "builtins" ? shipped : signedIn ? stars : [...shipped, ...stars];
}

// The params of an entry, through migrateLegacy so a look saved yesterday loads tomorrow.
export function resolve(state, stored, active, value) {
  if (cloudId(active) !== null) return migrateLegacy(cloudItem(state, active, value)?.params);
  const star = starName(stored, active, value);
  return migrateLegacy(star !== null ? stored[star] : BUILTINS.PRESETS[value]);
}

// The next value, wrapping; from a value that is not listed, from the first entry.
export function step(list, value, dir) {
  if (!list.length) return undefined;
  const at = Math.max(0, list.findIndex((e) => e.value === value));
  return list[(at + dir + list.length) % list.length].value;
}

// ---- the built-in guard (design §3.8) ----------------------------------------------
// The debug overlays do not change the art, so flipping one must not make a built-in "modified". drift_phase is an
// animated state (the engine moves it with drift_auto), so it would mark every look edited.
const NOT_THE_LOOK = new Set(["show_source", "show_layer", "show_layer_index", "drift_phase"]);
const LOOK_KEYS = Object.keys(DEFAULTS).filter((k) => !NOT_THE_LOOK.has(k));
const close = (a, b) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-6);   // absolute: a seed is a large integer, a slider step is never under 0.001

// Whether two param sets are the same look: equal on every DEFAULTS key but the ones above, numbers within a tolerance.
// `time_of_day` / `latitude` are not in DEFAULTS: they only write the sun knobs, which are compared.
export function sameLook(a, b) {
  const A = migrateLegacy(a), B = migrateLegacy(b);
  return LOOK_KEYS.every((k) => close(A[k], B[k]));
}

// The name of the built-in that `params` still is, or null.
export function builtinTwin(params, builtins) {
  return Object.keys(builtins.PRESETS).find((name) => sameLook(params, builtins.PRESETS[name])) ?? null;
}

// ---- the cache of arboretum playlists (design §6.1). Every function below returns a new state. ----
const withOrigin = (state, origin) => ({ ...state, origin });
const withoutKey = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const visibilityOf = (p) => p.visibility === undefined ? {} : { visibility: p.visibility };
export const editorWritable = (p) => p.visibility === undefined || p.visibility === "private";

// `params` are stored as received (migrateLegacy runs on resolve, never here). The owner's unavailable items
// are not playable, so they leave the list and are counted on the playlist. The share token `k` comes from the
// link (`api.k`) and survives a refresh, so an unlisted playlist can be fetched again.
export function cachePlaylist(state, api) {
  const gone = api.items.filter((i) => i.unavailable).length;
  const entry = {
    id: api.id, name: api.name, owner: api.owner,
    ...visibilityOf(api),
    ...(api.revision === undefined ? {} : { revision: api.revision }),
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
  const record = { id: api.id, version: api.version, owner: api.owner, synced: true, ...visibilityOf(api) };
  const same = Object.keys(stored).filter((n) => state.origin[n]?.id === api.id);
  let name = same.find((n) => state.origin[n].synced);
  if (name === undefined) {
    name = same.length ? `${api.name} (v${api.version})` : api.name;
    // A name a ★ already has belongs to an unrelated look (the same-id ones were found above), and a built-in's
    // name is taken too: a ★ of that name would shadow the built-in.
    const taken = (n) => n in stored || Object.hasOwn(BUILTINS.PRESETS, n);
    if (taken(name)) name = `${api.name} (#${api.id})`;
    for (let n = 2; taken(name); n++) name = `${api.name} (#${api.id}) ${n}`;
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

// ---- the smart upload (design §4.2) ------------------------------------------------------------
// What an upload would do, decided from what is known about the look:
//   { kind: 'version' | 'preset', path, body, label, into? } | { refused }
// In all looks the params are the stored ★ snapshot (what you saved is what goes online); in a cloud
// playlist they are the live look, because the cloud is that folder's store, and `into` names the place the
// uploaded preset takes in it (`at` null: appended). `body.name` is the current look's name — the caller
// replaces it with what the save prompt returns; "" when a cloud playlist has no item to take it from.
// `me` is your username, `cam` the engine's cameraFor. A cloud playlist here is one of yours, and cached.
export function uploadPlan(state, stored, active, value, live, me, commit, cam) {
  const id = cloudId(active);
  const it = id === null ? undefined : cloudItem(state, active, value);
  const star = starName(stored, active, value);   // the ★ the value denotes, if it is one
  const params = id === null ? (star !== null ? stored[star] : BUILTINS.PRESETS[value]) : live;
  const twin = builtinTwin(params, BUILTINS);
  if (twin !== null) return { refused: refusedTwin(twin) };

  // What the look is known to be on arboretum: a preset id and its owner, or the version it started from.
  const known = id === null
    ? state.origin[star ?? value]
    : it && { id: it.preset_id, version: it.version, owner: it.owner, ...visibilityOf(it) };
  const out = planFrom(params, known, id === null ? (star ?? value) : (it?.name ?? ""), me, commit, cam);
  if (id !== null) out.into = it ? { playlist: Number(id), at: Number(value), target: itemTarget(cloudItems(state, active), Number(value)) } : { playlist: Number(id), at: null };
  return out;
}

const refusedTwin = (twin) => `this is the built-in '${twin}', unchanged — change something first`;

// The upload itself, from what the look is known to be: a new version of your private preset, else a new preset
// with the version or look it started from as its parent.
function planFrom(params, known, name, me, commit, cam) {
  const out = known?.id !== undefined && known.owner === me && editorWritable(known)
    ? { kind: "version", path: `/api/presets/${known.id}/versions`, label: `↑ new version of #${known.id}`, body: { name, params } }
    : { kind: "preset", path: "/api/presets", label: "↑ new preset", body: { name, params } };
  if (commit) out.body.komorebi_commit = commit;
  if (out.kind === "preset") {
    const parent = known?.id !== undefined ? `preset:${known.id}@${known.version}` : known?.parent;
    if (parent) out.body.parent = parent;
    if (cam(params) !== "floor") out.body.tags = ["experimental"];   // arboretum-spec §4.3
  }
  return out;
}

// ---- writing a playlist's items safely (design §3.7) --------------------------------------------
// The list to PUT after one change, applied to a FRESH GET of the playlist, never to the cache. A PUT replaces
// the whole list, so the owner's unavailable items are sent back in their places or they would be dropped.
// `at` counts the playable items only — the numbering `entries` uses. An appended preset carries no times, so
// arboretum's defaults apply; a replacement keeps the times of the place it takes.
// `remove_preset` takes out the first playable item of that preset (a chip, which knows the preset and not a place).
// change: { kind: 'append', preset_id } | { kind: 'remove', at } | { kind: 'replace', at, preset_id } | { kind: 'remove_preset', preset_id }
// A captured target follows a place across reorders. Identical duplicates retain their occurrence only while their count agrees.
const matchesTarget = (it, target) => !it.unavailable && it.preset_id === target.preset_id && it.dwell_s === target.dwell_s && it.crossfade_s === target.crossfade_s;
export function itemTarget(items, at) {
  const it = items[at];
  if (!it || it.preset_id === undefined) return null;
  const target = { preset_id: it.preset_id, dwell_s: it.dwell_s, crossfade_s: it.crossfade_s };
  return { ...target, occurrence: items.slice(0, at).filter((i) => matchesTarget(i, target)).length, count: items.filter((i) => matchesTarget(i, target)).length };
}
function targetAt(items, target) {
  const playable = items.filter((it) => !it.unavailable);
  const matches = playable.map((it, i) => matchesTarget(it, target) ? i : -1).filter((i) => i >= 0);
  return matches.length === target.count ? matches[target.occurrence] ?? -1 : -1;
}
export function itemsAfter(fresh, change) {
  if (change.target) {
    const at = targetAt(fresh, change.target);
    if (at < 0) throw { error: "that playlist item changed; reload the playlist before changing it" };
    change = { ...change, at };
  }
  const out = [];
  let playable = 0, removed = false;
  for (const it of fresh) {
    const times = { dwell_s: it.dwell_s, crossfade_s: it.crossfade_s };
    if (change.kind === "remove_preset") {
      if (!it.unavailable && !removed && it.preset_id === change.preset_id) removed = true;
      else out.push({ preset_id: it.preset_id, ...times });
    } else if (it.unavailable || change.kind === "append" || change.at !== playable++) out.push({ preset_id: it.preset_id, ...times });
    else if (change.kind === "replace") out.push({ preset_id: change.preset_id, ...times });
  }
  if (change.kind === "append") out.push({ preset_id: change.preset_id });
  return out;
}

// ---- what a save started from, and what the buttons say (design §3.5, §4.1, §4.2) ----------------------------
// The entry a save starts from, in the shape onSaved and the provenance rules read; null when it is not a listed entry.
export function fromEntry(state, stored, active, value) {
  if (cloudId(active) !== null) {
    const item = cloudItem(state, active, value);
    return item ? { kind: "cloud", item } : null;
  }
  const star = starName(stored, active, value);
  if (star !== null) return { kind: "local", name: star };
  return typeof value === "string" && isBuiltin(BUILTINS.PRESETS, value) ? { kind: "builtin", name: value } : null;
}

// The arboretum preset an entry already is, or null when it has to go up first: a cloud item is one; a ★ is only
// while its copy is current (an edited ★ is a newer look than the preset the playlist would get).
export function onlineId(state, stored, active, value) {
  if (cloudId(active) !== null) return cloudItem(state, active, value)?.preset_id ?? null;
  const star = starName(stored, active, value);
  const o = star === null ? undefined : state.origin[star];
  return o?.id !== undefined && o.synced ? o.id : null;
}

// The playlists of yours (`mine`: arboretum's summaries) as chips for this look: lit where its preset is an item of the
// cached copy. A playlist not cached yet is unlit.
export function playlistChips(state, stored, active, value, mine) {
  const preset = onlineId(state, stored, active, value);
  return mine.map((p) => ({ id: p.id, name: p.name, lit: preset !== null && !!state.playlists[p.id]?.items.some((it) => it.preset_id === preset) }));
}

// ---- the chip under the look select: where the look lives, in a few words ----
// `live` the params on screen (null while a transition is carrying them, or to skip the edit check); `me` your username;
// `ctx.offline` the active cloud playlist is its cached copy because arboretum could not be reached; `ctx.error` arboretum's
// last refusal for this look, which the title carries verbatim.
export function lookState(state, stored, active, value, live, me, { offline = false, error = null, incomplete = false } = {}) {
  let text, title, params;
  const id = cloudId(active);
  if (id !== null) {
    const it = cloudItem(state, active, value);
    if (!it) return { text: "", title: "" };
    params = it.params;
    if (it.pending) {
      text = "⇡ waiting to go up";
      title = "saved here; it goes to arboretum when arboretum can be reached";
    } else if (offline) {
      text = `offline copy · ${new Date(state.playlists[id].fetched_at).toISOString().slice(0, 10)}`;
      title = "arboretum could not be reached, so this is the copy of your looks kept here";
      if (incomplete) title += " (offline copy incomplete: this browser had room for only part of it)";
    } else {
      text = `☁ #${it.preset_id} v${it.version}${it.owner !== me ? ` · ${it.owner}'s` : ""}`;
      title = it.owner === me ? "an item of your playlist, kept in arboretum" : `an item of ${it.owner}'s preset, kept in arboretum`;
    }
  } else {
    const star = starName(stored, active, value);
    if (star !== null) {
      const o = state.origin[star];
      params = stored[star];
      if (synced(o)) { text = `☁ #${o.id} v${o.version}`; title = "saved here, and kept in arboretum"; }
      else if (o?.id !== undefined) { text = `★ saved here · ☁ #${o.id} is older`; title = "saved here; the copy in arboretum is an older version of it"; }
      else { text = "★ saved here"; title = "saved in this browser, not in arboretum"; }
    } else if (typeof value === "string" && isBuiltin(BUILTINS.PRESETS, value)) {
      params = BUILTINS.PRESETS[value];
      text = "built-in";
      title = "a built-in look: save keeps a copy of your own";
    } else return { text: "", title: "" };
  }
  if (live && !sameLook(live, params)) { text = `● edited · ${text}`; title = `the look on screen differs from the saved one. ${title}`; }
  if (error) title = `${title} — arboretum said: ${error}`;
  return { text, title };
}

// An upload's `into` (uploadPlan) as the change itemsAfter applies to a fresh copy of the playlist.
export function placeChange(into, preset_id) {
  return into.at === null ? { kind: "append", preset_id } : { kind: "replace", at: into.at, preset_id, ...(into.target ? { target: into.target } : {}) };
}

// ---- the links (design §5) -------------------------------------------------------------------------------------
// `GET /api/presets/:id/versions/:n` answers {preset_id, n, name, params, …}: no `id`, `owner` or `version`, which
// savePreset reads off the head. The owner is not on a version at all, so it comes from the head fetched beside it.
export const fromVersion = (v, head) => ({ ...v, id: v.preset_id, version: v.n, owner: head.owner, ...visibilityOf(head) });

// A playlist link: the playlist is cached (with the link's share token, so an unlisted one can be fetched again) and
// becomes the active one, on its first item. Nothing playable is a failure, and nothing is cached for it.
export function linkPlaylist(state, view, k) {
  const next = cachePlaylist(state, k === undefined ? view : { ...view, k });
  if (!next.playlists[view.id].items.length) return { failed: "that playlist has nothing to play" };
  return { state: next, list: `arb:${view.id}`, value: "0" };
}

// ---- playing (design §3.6) ----------------------------------------------------------------------------------------
// A cloud playlist plays: each look is held for its `dwell_s`, then the next fades in over its own `crossfade_s`.
// The dwell starts when a look has finished fading in, so a long crossfade never eats the time a look is meant to be
// seen (José's call; arboretum's own player does the same). The look play starts on is simply there: no fade in.
// The editor owns the engine: `advance` is its step to the next look; it calls `leaving` as that step begins and
// `arrived` when the look has landed — also when a look is put there by hand, which restarts the dwell. Timers are
// injectable so the schedule can be tested without waiting.
export function makePlayer({ timing, advance, onChange, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let on = false, timer = null;
  const idle = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const arrived = (value) => {
    idle();
    const t = on ? timing(value) : null;
    if (t) timer = setTimer(() => { timer = null; if (on) advance(); }, t.dwell_s * 1000);
  };
  return {
    get playing() { return on; },
    start(value) { if (on) return; on = true; arrived(value); onChange?.(); },
    stop() { if (!on) return; on = false; idle(); onChange?.(); },
    leaving: idle,
    arrived,
  };
}

// ============================================================================
// Cloud first (signed in). Arboretum is where your looks live, and a complete copy of it is kept in this browser: the MIRROR.
// It holds every preset you own (head version) and every playlist of yours, newest first / in arboretum's order, and the
// saves that could not go up yet (`queue`, in the order they were made). Signed out, none of it is shown. Playlists are
// folders: the lists you see are the folders, the built-ins, and "uncategorized" — a list derived from the mirror, never
// written to arboretum, that holds your presets that are in no folder.
// ============================================================================
export const emptyMirror = () => ({ v: 1, at: null, incomplete: false, order: [], presets: {}, playlists: [], queue: [] });

const DWELL = { dwell_s: 30, crossfade_s: 5 };   // arboretum's defaults for an item that carries no times
const own = (p) => ({ id: p.id, version: p.version, owner: p.owner, name: p.name, params: p.params, ...visibilityOf(p) });
const itemOf = (p, extra) => ({ preset_id: p.id, version: p.version, owner: p.owner, name: p.name, ...DWELL, params: p.params, ...visibilityOf(p), ...extra });
const waitingItem = (q) => ({ name: q.body.name, ...DWELL, params: q.body.params, pending: true, seq: q.seq });   // no preset_id yet: it is not on arboretum

// The saves that wait, split by what they do to the mirror: an update to a preset patches it wherever it is shown; a new one is an item of its own.
function waiting(mirror) {
  const patches = {}, fresh = [];
  for (const q of mirror.queue) {
    const m = q.kind === "version" ? /^\/api\/presets\/(\d+)\/versions$/.exec(q.path) : null;
    if (m) patches[m[1]] = q; else fresh.push(q);
  }
  return { patches, fresh };
}
const patchedItem = (it, patches) => (patches[it.preset_id] ? { ...it, name: patches[it.preset_id].body.name, params: patches[it.preset_id].body.params, pending: true, seq: patches[it.preset_id].seq } : it);

// Your presets in no folder, newest first; a save that waits is the newest of them.
export function uncategorized(mirror) {
  const { patches, fresh } = waiting(mirror);
  const filed = new Set(mirror.playlists.flatMap((l) => l.items.map((i) => i.preset_id)));
  return [
    ...fresh.filter((q) => !q.into).reverse().map(waitingItem),
    ...mirror.order.map((id) => mirror.presets[id]).filter((p) => p && !filed.has(p.id)).map((p) => patchedItem(itemOf(p), patches)),
  ];
}

// The state the editor reads signed in: your folders and uncategorized join the playlists it already caches (those opened
// by link). Signed out it is the state itself, so the mirror shows nowhere.
export function viewState(state, mirror, me) {
  if (me === null) return state;
  mirror = {
    ...mirror, order: mirror.order.filter((id) => mirror.presets[id]?.owner === me),
    playlists: mirror.playlists.filter((p) => p.owner === me), queue: mirror.queue.filter((q) => q.owner === me),
  };
  const { patches, fresh } = waiting(mirror);
  const folders = {};
  for (const l of mirror.playlists) {
    let items = l.items.map((it) => patchedItem({ ...it, ...visibilityOf(mirror.presets[it.preset_id] ?? it) }, patches));
    for (const q of fresh) {
      if (q.into?.playlist !== l.id) continue;
      const at = q.into.target ? targetAt(items, q.into.target) : q.into.at;
      items = at === null || at < 0 ? [...items, waitingItem(q)] : items.map((it, i) => (i === at ? waitingItem(q) : it));
    }
    folders[l.id] = { ...l, fetched_at: mirror.at ?? l.fetched_at, items };
  }
  const unc = { id: "unc", name: "uncategorized", owner: me, k: null, fetched_at: mirror.at ?? 0, unavailable: 0, items: uncategorized(mirror) };
  return { ...state, me: { username: me }, playlists: { ...state.playlists, ...folders, unc } };
}

// Whether `active` is a private playlist of yours, which an editor save can place a look in.
export const isFolder = (view, active, me) => cloudId(active) !== null && cloudId(active) !== "unc" && !!me && view.playlists[cloudId(active)]?.owner === me && editorWritable(view.playlists[cloudId(active)]);

// The lists the playlist select offers. Signed out: all looks, then the playlists cached from links, as ever. Signed in:
// uncategorized (hidden when empty and you have other folders — unless you are in it), your folders, other cached
// playlists, built-ins, and on this browser while ★ looks not yet in arboretum remain.
export function listChoices(view, { me, stored, mirror, active = null }) {
  if (me === null) return playlists(view);
  const folders = mirror.playlists.filter((p) => p.owner === me);
  const mine = new Set(folders.map((l) => String(l.id)));
  const out = [];
  if (view.playlists.unc.items.length || !mine.size || active === "arb:unc") out.push({ value: "arb:unc", label: "uncategorized" });
  for (const l of folders) out.push({ value: `arb:${l.id}`, label: l.name });
  for (const p of Object.values(view.playlists)) if (p.id !== "unc" && !mine.has(String(p.id))) out.push({ value: `arb:${p.id}`, label: p.owner === me ? p.name : `${p.name} · ${p.owner}` });
  out.push({ value: "builtins", label: "built-ins" });
  if (browserNames(view, stored).length) out.push({ value: "local", label: "on this browser" });
  return out;
}

// ---- keeping the mirror in step with arboretum ----
// `summaries` is GET /api/presets?owner=me: no params. Visibility can change without a new version, and affects where saves go.
export function mirrorDiff(mirror, summaries) {
  const ids = new Set(summaries.map((s) => s.id));
  return {
    fetch: summaries.filter((s) => mirror.presets[s.id]?.version !== s.version || mirror.presets[s.id]?.visibility !== s.visibility).map((s) => s.id),
    order: summaries.map((s) => s.id),
    gone: Object.keys(mirror.presets).map(Number).filter((id) => !ids.has(id)),
  };
}

const playlistEntry = (view) => cachePlaylist({ playlists: {} }, view).playlists[view.id];

// A refresh: `fetched` the presets fetched by id; `listSums` your playlists as arboretum lists them, `views` their views in the
// same order (null where one could not be fetched: its old copy stays). The queue is not the refresh's business.
export function mirrorSync(mirror, summaries, fetched, listSums, views, now) {
  const presets = {};
  for (const s of summaries) {
    const p = fetched[s.id] ? own(fetched[s.id]) : mirror.presets[s.id];
    if (p) presets[s.id] = p;
  }
  return {
    ...mirror, at: now, presets, order: summaries.map((s) => s.id).filter((id) => presets[id]),
    playlists: listSums.map((s, i) => (views[i] ? playlistEntry(views[i]) : mirror.playlists.find((l) => l.id === s.id))).filter(Boolean),
  };
}

// A write's answer, filed at once: the preset at the front, the playlist as arboretum now has it.
export function mirrorPut(mirror, p) {
  return { ...mirror, presets: { ...mirror.presets, [p.id]: own(p) }, order: [p.id, ...mirror.order.filter((id) => id !== p.id)] };
}

export function mirrorPlaylist(mirror, view) {
  const entry = playlistEntry(view);
  const at = mirror.playlists.findIndex((l) => l.id === entry.id);
  return { ...mirror, playlists: at < 0 ? [...mirror.playlists, entry] : mirror.playlists.map((l, i) => (i === at ? entry : l)) };
}

// ---- saves that wait: pushed in the order they were made, on the next successful check ----
export function enqueue(mirror, plan) {
  const seq = Math.max(0, ...mirror.queue.map((q) => q.seq)) + 1;
  return { ...mirror, queue: [...mirror.queue, { seq, ...plan }] };
}

export const dequeue = (mirror, seq) => ({ ...mirror, queue: mirror.queue.filter((q) => q.seq !== seq) });

// ---- moving the local looks in ----
// The ★ looks that are not yet a synced arboretum preset, and what moving each would do (uploadPlan: a new version when
// its origin is your own preset, else a new private preset with its parent; an unchanged built-in is refused).
export const moveCandidates = (state, stored) => Object.keys(stored).filter((n) => !synced(state.origin[n]));

export const movePlan = (state, stored, me, commit, cam) =>
  moveCandidates(state, stored).map((name) => ({ name, plan: uploadPlan(state, stored, "local", starValue(name), null, me, commit, cam) }));

// ---- saving when signed in: every save goes to arboretum, private, and never asks where ----
// In a folder of yours it is uploadPlan's rule (a new version of the item, or a new preset placed there). Anywhere else — uncategorized,
// built-ins, someone else's playlist, a ★, a pasted look — it is a new version when the look is a preset of yours and otherwise
// a new preset, and it lands in uncategorized (`target`). `name` is what the save prompt returned.
export function savePlan(view, stored, active, value, live, me, commit, cam, name) {
  if (isFolder(view, active, me)) {
    const p = uploadPlan(view, stored, active, value, live, me, commit, cam);
    if (!p.refused) { p.body.name = name; p.target = "folder"; }
    return p;
  }
  const twin = builtinTwin(live, BUILTINS);
  if (twin !== null) return { refused: refusedTwin(twin) };
  const it = cloudId(active) === null ? undefined : cloudItem(view, active, value);
  const star = starName(stored, active, value);
  const known = it ? { id: it.preset_id, version: it.version, owner: it.owner, ...visibilityOf(it) }
    : star !== null ? view.origin[star]
    : isBuiltin(BUILTINS.PRESETS, value) ? { parent: `look:${value}` } : undefined;
  return { ...planFrom(live, known, name, me, commit, cam), target: "unc" };
}
