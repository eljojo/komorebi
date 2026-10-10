// ============================================================================
// Komorebi editor — arboretum: the place the editor keeps presets, whether online or not. The editor only ever saves, loads and
// lists looks through this file, and arboretum does the best it can, in tiers:
//   local    always: the ★ looks (komorebi.presets) and arboretum's own state (komorebi.arboretum: where each ★ came from, what
//            waits to go up, the cached playlists). Works on a fork, offline, anywhere; no network at all.
//   read     any origin: opening an #arboretum= / #arboretum-playlist= link GETs it from arboretum without credentials. A browser
//            that blocks it (CORS) or a failing fetch leaves the editor where it was, with the reason. Nothing else reaches out.
//   session  only where `detect` (playlists.js) says arboretum is there (komorebi.eljojo.net, or arboretum's own dev host):
//            sign-in, your presets and playlists, uploads, and the controls that show them in the advanced panel (#dev).
// Save is the one verb: a ★ is written here and, with a session, goes up at once (or waits, flagged `pending`, until it can).
// Nothing is added to the playful sidebar or the zen strip. The rules live in playlists.js and the wire in arboretum-api.js;
// this file connects them to localStorage and the page. The editor hands in what it owns (`host`) and gets back the hooks it
// calls. Everything the editor creates is private: no request here ever names `visibility`.
// ============================================================================
import { api as makeApi } from "./arboretum-api.js";
import { cameraFor, migrateLegacy } from "./komorebi.js";
import { PRESETS } from "./presets.js";
import { ARBORETUM, cachePlaylist, clearPending, detect, fromEntry, fromVersion, itemsAfter, linkPlaylist, markPending, onDeleted, onPushed, onSaved,
  onlineId, pendingNames, placeChange, playlistChips, playlists, savePreset, starValue, uploadPlan, writable } from "./playlists.js";

// ---- storage: the ★ looks, and arboretum's state beside them ----
export const LS_KEY = "komorebi.presets";
export const ARB_KEY = "komorebi.arboretum";

// the user's saved (★) looks, keyed by name; {} if none, or if the store is unreadable/corrupt.
export function getStored() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }   // no localStorage, or malformed JSON -> behave as empty
}

export function setStored(o) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(o)); }
  catch { /* storage full / disabled — silently skip, the look just isn't persisted */ }
}

// resolve a look by name: a saved ★ look shadows a built-in of the same name; otherwise the built-in.
// A ★ look saved before a knob was renamed still carries the old key, so it comes back through the engine's alias map —
// the caller only ever sees current names (spec §9).
export function getPreset(name) {
  const s = getStored();
  return migrateLegacy(name in s ? s[name] : PRESETS[name]);
}

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

const TOAST_MS = 6000;
const clone = (o) => JSON.parse(JSON.stringify(o));
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// `loc` / `fetchImpl` are the page's own, injectable so the tiers can be tested. Mounting builds nothing and asks nothing until
// `detect` answers: off the session hosts it never does, and arboretum stays local-only (plus the read tier, for a link).
export function mount(host, { loc = globalThis.location, fetchImpl = globalThis.fetch } = {}) {
  const reader = makeApi(ARBORETUM, fetchImpl, { credentials: "omit" });   // the read tier: anonymous GETs, from any origin
  let api = null;                             // the session's wire, once detect says there is one
  let on = false;                             // the session tier is on: detect named an origin

  let me = null;                              // the last answer of /api/me (cached, so labels need no round trip)
  let known = false;                          // a session has been seen on this browser: a 401 now is an ended session, not a visitor
  let out = false;                            // /api/me (or a write) answered 401: the sign-in button shows
  let mine = [];                              // your playlists as arboretum lists them (summaries; the items are cached with them)
  let presets = [];                           // your presets, which all looks lists beside its ★s
  let offlineList = null;                     // the cloud playlist being shown from its cache because arboretum could not be reached
  let refusal = null;                         // arboretum's last refusal and the look it was for: { key, text }
  let wantStart = false;                      // the advanced panel was shown before detect answered
  const keyOf = (active, value) => `${active}|${value}`;

  // ---- the controls (session tier only) ----
  let inRow, chips, status, line, cta, who;
  function buildControls(origin) {
    document.body.dataset.arboretum = origin;
    inRow = make("div", "ctl arb-inrow");
    inRow.style.flexWrap = "wrap";
    chips = make("span", "arb-chips");
    chips.style.cssText = "display:contents";
    inRow.append(make("label", "", "in:"), chips);
    status = make("div", "arb-status");
    status.style.cssText = "font-size:11px;color:#9fb89f;margin:2px 0 6px;word-break:break-word";
    host.rows.save.after(inRow, status);

    line = make("div", "ctl arb-signin");
    cta = make("button", "arb-cta", "keep your looks in arboretum ↗");
    who = make("span", "arb-who");
    who.style.cssText = "font-size:11px;color:#9fb89f";
    line.append(cta, who);
    host.rows.tools.after(line);
    cta.addEventListener("click", () => window.open(`${origin}/login`, "_blank", "noopener"));
    status.hidden = true;
  }

  // The toast: the status line, cleared 6 s after it was last set.
  let toastTimer = 0;
  const say = (text) => {
    if (!on) return;
    clearTimeout(toastTimer);
    status.textContent = text;
    status.hidden = text === "";
    if (text) toastTimer = setTimeout(() => say(""), TOAST_MS);
  };

  // The chips under the save row: one per playlist of yours, lit where this look's preset is an item. They follow the
  // look selected and the cache of your playlists.
  function drawChips() {
    if (!on) return;
    const show = me !== null && mine.length > 0;
    inRow.hidden = !show;
    if (!show) return;
    chips.replaceChildren(...playlistChips(getState(), getStored(), host.active(), host.value(), mine).map((c) => {
      const b = make("button", "arb-in", c.name);
      b.setAttribute("aria-pressed", String(c.lit));
      if (c.lit) b.style.cssText = "background:#2c4a2c;border-color:#7fae7f;color:#e8d9a8";
      b.addEventListener("click", () => toggle(c.id, c.lit));
      return b;
    }));
  }

  function render() {
    if (!on) return;
    line.hidden = me === null && !out;
    cta.hidden = !out;
    who.hidden = me === null;
    who.textContent = me === null ? "" : `arboretum · ${me}`;
    drawChips();
    host.sync();
  }

  // ---- who is signed in. Asked when the advanced panel is first shown or a cloud playlist is active, and again whenever
  // the window regains focus, so a sign-in finished in the other tab shows at once. A successful answer also caches your
  // playlists (the chips read them) and sends what was waiting to go up. ----
  function signOut() {
    me = null; out = true; mine = []; presets = [];
    setState({ ...getState(), me: null });
    render();
  }
  function fail(e) {
    if (e.status === 401) signOut();
    else say(e.error);
  }
  async function check() {
    try {
      me = (await api.me()).username;
      out = false;
      known = true;
      setState({ ...getState(), me: { username: me } });
      [mine, presets] = await Promise.all([api.playlists().then((r) => r.playlists), api.presets().then((r) => r.presets)]);
      await Promise.all(mine.map(async (p) => {
        try { setState(cachePlaylist(getState(), await api.playlist(p.id))); }
        catch (e) { if (e.status === 401) throw e; }   // one playlist failing leaves its chip unlit, nothing more
      }));
      render();
      await pushPending();
    } catch (e) { fail(e); }
  }
  let started = false;
  function start() {
    if (!on) { wantStart = true; return; }
    if (started) return;
    started = true;
    window.addEventListener("focus", check);
    check();
  }

  // detect is the only thing mount asks the network, and only on the session hosts (it answers null without a request elsewhere)
  const ready = detect(loc, fetchImpl).catch(() => null).then((origin) => {
    if (!origin) return null;
    api = makeApi(origin, fetchImpl);
    on = true;
    me = getState().me?.username ?? null;
    known = me !== null;
    buildControls(origin);
    render();
    if (wantStart || host.advancedShown() || host.active() !== "local") start();
    return origin;
  });

  // ---- playlists ----
  // A playlist opened by link is fetched again with the share token the link carried, which the cache kept (an unlisted
  // one of someone else's is not visible without it).
  const fetchList = (id) => api.playlist(id, { k: getState().playlists[id]?.k ?? undefined });

  // Activating fetches the playlist fresh (the session tier); when arboretum cannot be reached the cached copy plays on, and
  // the look's chip says so. Without a session the cached copy is all there is, and nothing is asked.
  async function activate(list) {
    if (!on || !list.startsWith("arb:")) { offlineList = null; host.activate(list); return; }
    const id = list.slice(4);
    try {
      setState(cachePlaylist(getState(), await fetchList(id)));
      offlineList = null;
    } catch (e) {
      if (e.status === 401) signOut();
      if (!getState().playlists[id]) { if (e.status !== 401) say(e.error); host.sync(); return; }
      offlineList = list;
    }
    host.activate(list);
  }

  const askName = () => (prompt("New playlist name:") || "").trim();
  async function makePlaylist(name) {
    const made = await api.createPlaylist({ name });
    setState(cachePlaylist(getState(), made));
    mine = [{ id: made.id, name: made.name }, ...mine];
    render();
    return made.id;
  }
  async function create() {
    if (!on) return;
    const name = askName();
    if (!name) return;
    try { host.activate(`arb:${await makePlaylist(name)}`); } catch (e) { fail(e); }
  }

  // Every write to a playlist's items starts from a fresh GET and applies the one change to that, never to the cache.
  async function writeItems(id, change) {
    const fresh = await api.playlist(id);
    const view = await api.putItems(id, itemsAfter(fresh.items, change));
    setState(cachePlaylist(getState(), view));
    return view;
  }

  // ---- uploads ----
  async function plan(active, value, live, name, quiet = false) {
    const p = uploadPlan(getState(), getStored(), active, value, live, me, await api.commit(), cameraFor);
    if (p.refused) { if (!quiet) say(p.refused); return null; }
    if (name !== undefined) p.body.name = name;
    return p;
  }
  const send = (p) => {
    const m = p.path.match(/^\/api\/presets\/(\d+)\/versions$/);
    return m ? api.addVersion(Number(m[1]), p.body) : api.create(p.body);
  };

  // What an upload that did not land means. A ★ that could not go up now (arboretum unreachable, a 5xx, a session that
  // ended) is kept and flagged pending: the next successful /api/me check sends it. Any other refusal would be refused
  // again, so it is shown verbatim, kept for the look's chip, and is not pending.
  function unsent(name, e) {
    const key = keyOf("local", starValue(name));
    if (e.status === 401 || e.status === 0 || e.status >= 500) {
      if (e.status === 401) signOut();
      setState(markPending(getState(), name));
      return "pending";
    }
    setState(clearPending(getState(), name));
    refusal = { key, text: e.error ?? String(e) };
    say(refusal.text);
    return "refused";
  }

  // A ★ goes up now, as uploadPlan decides: a new version of its preset when the ★'s origin is yours, else a new private
  // preset. Resolves "kept", "pending" or "refused" (an unchanged built-in under a new name stays local, and says nothing).
  async function keepStar(name, quiet = false) {
    const value = starValue(name);
    let result;
    try {
      const p = await plan("local", value, clone(host.params), undefined, true);
      if (!p) result = "refused";
      else {
        const res = await send(p);
        setState(onPushed(getState(), name, res));
        if (refusal?.key === keyOf("local", value)) refusal = null;
        if (!quiet) say(`kept in arboretum · #${res.id} v${res.version}`);
        result = "kept";
      }
    } catch (e) { result = unsent(name, e); }
    render();
    return result;
  }

  let pushing = false;
  async function pushPending() {
    if (pushing || me === null) return;
    pushing = true;
    try {
      for (const name of pendingNames(getState(), getStored())) if (await keepStar(name, true) === "pending") break;   // the same trouble would meet the rest
    } finally { pushing = false; }
  }

  // Save in all looks (or in someone else's playlist) has written the ★; now it goes up if you are signed in. Signed out
  // after a session that was known, it waits; a visitor who never signed in has nothing to wait for.
  async function keep(name) {
    if (!on) return;
    if (me === null) {
      if (out && known) { setState(markPending(getState(), name)); render(); }
      return;
    }
    const waited = pendingNames(getState(), getStored()).includes(name);
    await pushPending();
    if (!waited) await keepStar(name);   // a ★ that was waiting went up with the rest (or still waits): saving it again is that same upload
  }

  // Save inside a cloud playlist: the look goes to arboretum, the playlist takes it in the place of the item, and it
  // exists here too, as a ★ (savePreset: no duplicate, and an unsynced edit is never overwritten).
  async function save(name, live) {
    const active = host.active(), value = host.value();
    try {
      const p = await plan(active, value, clone(live), name);
      if (!p) return;
      const res = await send(p);
      const pid = p.into.playlist;
      let at = value;
      if (p.kind === "version") setState(cachePlaylist(getState(), await api.playlist(pid)));   // the playlist already points at the preset
      else {
        await writeItems(pid, placeChange(p.into, res.id));
        if (p.into.at === null) at = String(getState().playlists[pid].items.length - 1);
      }
      const r = savePreset(getState(), getStored(), { id: res.id, version: res.version, owner: res.owner, name: res.name ?? name, params: clone(live) });
      setState(r.state);
      setStored(r.stored);
      say(`kept in arboretum · #${res.id} v${res.version}`);
      host.select(at);
    } catch (e) { fail(e); }
  }

  // Remove: the playlist without the item. The preset itself stays on arboretum.
  async function remove() {
    const active = host.active(), value = host.value();
    if (!on || !value) return;
    const pid = Number(active.slice(4)), at = Number(value);
    try {
      await writeItems(pid, { kind: "remove", at });
      const n = getState().playlists[pid].items.length;
      say("");
      host.select(n ? String(Math.min(at, n - 1)) : "");
    } catch (e) { fail(e); }
  }

  // A chip: the look joins the playlist, or leaves it (the first item of that preset). A look that is not online yet goes
  // up first, by the same rule as a save.
  async function toggle(pid, lit) {
    const active = host.active(), value = host.value();
    try {
      let preset = onlineId(getState(), getStored(), active, value);
      if (preset === null) {
        const from = fromEntry(getState(), getStored(), active, value);
        const p = await plan(active, value, clone(host.params));
        if (!p) return;
        const res = await send(p);
        if (from?.kind === "local") setState(onPushed(getState(), from.name, res));
        preset = res.id;
      }
      await writeItems(pid, lit ? { kind: "remove_preset", preset_id: preset } : { kind: "append", preset_id: preset });
      if (active === `arb:${pid}`) host.reload();
    } catch (e) { fail(e); }
    render();
  }

  // A ☁ row of all looks: the preset becomes a ★ here, by the same rule as a link. Resolves whether it did.
  async function bringIn(id) {
    try {
      const r = savePreset(getState(), getStored(), await api.preset(id));
      setState(r.state);
      setStored(r.stored);
      host.show(r.name);
      return true;
    } catch (e) { fail(e); return false; }
  }

  // ---- the links (design §5): the read tier. A link names a look or a playlist; it is GET from arboretum — with the session
  // where there is one, else anonymously from arboretum's own origin — and saved here. Called once at startup, so the fetch is
  // usually done by the time "feel" is pressed. It says where the editor should land; it never throws, and a browser that
  // blocks the request is a failed link like any other. ----
  async function open(link) {
    await ready;
    const wire = on ? api : reader;
    try {
      if (link.preset) {
        const { id, n, k } = link.preset;
        const [head, pinned] = await Promise.all([wire.preset(id, { k }), n === undefined ? null : wire.preset(id, { n, k })]);
        const r = savePreset(getState(), getStored(), pinned ? fromVersion(pinned, head) : head);
        setState(r.state);
        setStored(r.stored);
        return { value: starValue(r.name) };
      }
      const got = linkPlaylist(getState(), await wire.playlist(link.playlist.id, { k: link.playlist.k }), link.playlist.k);
      if (got.failed) return { failed: got.failed };
      setState(got.state);
      return { list: got.list, value: got.value, play: true };
    } catch (e) { return { failed: e.error ?? String(e) }; }
  }

  return {
    ready, activate, create, save, keep, remove, bringIn, open,
    lists: () => playlists(getState(), mine, me),
    cloudPresets: () => presets,
    changed: drawChips,
    advanced: start,
    writable: () => on && writable(getState(), host.active(), me),
    // what the look's chip needs beyond the saved state: who you are, whether this playlist is its offline copy, and the last refusal for this look
    info: () => ({ me, offline: offlineList !== null && offlineList === host.active(), error: refusal?.key === keyOf(host.active(), host.value()) ? refusal.text : null }),
    // the ★ looks and where each came from (design §4.1): what the editor's own saves and deletes mean for a ★'s record
    writeStar(name, params) {
      setState(onSaved(getState(), name, fromEntry(getState(), getStored(), host.active(), host.value())));   // before the selection moves: it is where this ★ came from
      setStored({ ...getStored(), [name]: clone(params) });
    },
    deleteStar(name) {
      const stored = getStored();
      delete stored[name];
      setStored(stored);
      setState(onDeleted(getState(), name));
    },
  };
}
