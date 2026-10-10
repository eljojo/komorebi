// ============================================================================
// Komorebi editor — arboretum: the place the editor keeps presets, whether online or not. The editor only ever saves, loads and
// lists looks through this file, and arboretum does the best it can, in tiers:
//   local    always: the ★ looks (komorebi.presets) and arboretum's own state (komorebi.arboretum: where each ★ came from, the
//            playlists cached from links). Works on a fork, offline, anywhere; no network at all. Signed out, this is all there is.
//   read     any origin: opening an #arboretum= / #arboretum-playlist= link GETs it from arboretum without credentials. A browser
//            that blocks it (CORS) or a failing fetch leaves the editor where it was, with the reason. Nothing else reaches out.
//   session  only where `detect` (playlists.js) says arboretum is there (komorebi.eljojo.net, or arboretum's own dev host), and
//            you are signed in: arboretum is where your looks live. Every save goes up (private); playlists are folders, and
//            "uncategorized" is the list of your presets in none of them; the ★ looks you made before signing in are offered a
//            move. A complete copy of your cloud — the mirror (komorebi.arboretum.mirror) — is kept here, refreshed on each
//            successful check and after each write, and answers whenever arboretum cannot be reached; a save made then waits in
//            the mirror and goes up in order on the next check. Signing out leaves the mirror and the waiting saves, and shows
//            neither. The controls live in the advanced panel (#dev) and nowhere else.
// The rules live in playlists.js and the wire in arboretum-api.js; this file connects them to localStorage and the page. The
// editor hands in what it owns (`host`) and gets back the hooks it calls. Everything the editor creates is private: no request
// here ever names `visibility`.
// ============================================================================
import { api as makeApi } from "./arboretum-api.js";
import { cameraFor, migrateLegacy } from "./komorebi.js";
import { PRESETS } from "./presets.js";
import { ARBORETUM, cachePlaylist, dequeue, detect, editorWritable, emptyMirror, enqueue, entryName, fromEntry, fromVersion, isFolder, itemsAfter, itemTarget, linkPlaylist, listChoices,
  mirrorDiff, mirrorPlaylist, mirrorPut, mirrorSync, moveCandidates, movePlan, onDeleted, onSaved, onlineId, placeChange, playlistChips, savePlan, savePreset,
  starValue, uploadPlan, viewState } from "./playlists.js";

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

// ---- the mirror: a complete copy of your cloud (every preset you own, every playlist of yours, the saves that wait), for when
// arboretum cannot be reached. Signing out leaves it and the waiting saves where they are; signed out, nothing shows it. ----
export const MIRROR_KEY = "komorebi.arboretum.mirror";
let mirrorMemo = { raw: undefined, value: null };   // the parse, kept while the stored text is the same

export function getMirror() {
  let raw = null;
  try { raw = localStorage.getItem(MIRROR_KEY); } catch { /* no localStorage: an empty mirror */ }
  if (mirrorMemo.value && raw === mirrorMemo.raw) return mirrorMemo.value;
  let value = emptyMirror();
  try {
    const s = JSON.parse(raw || "null");
    if (isObject(s) && s.v === 1) {
      value = {
        v: 1, at: typeof s.at === "number" ? s.at : null, incomplete: s.incomplete === true,
        order: Array.isArray(s.order) ? s.order : [], presets: isObject(s.presets) ? s.presets : {},
        playlists: Array.isArray(s.playlists) ? s.playlists : [], queue: Array.isArray(s.queue) ? s.queue : [],
      };
    }
  } catch { /* corrupt: empty */ }
  mirrorMemo = { raw, value };
  return value;
}

// Writes the mirror. When the quota refuses it, the newest presets that fit are kept (then, if even none fit, as many playlists as
// do), the copy says it is `incomplete`, and the saves that wait are never what is dropped. Resolves whether anything was written:
// false means not even the waiting saves fit, and what was stored before stays.
export function setMirror(m) {
  const attempt = (x) => {
    try { localStorage.setItem(MIRROR_KEY, JSON.stringify({ ...x, v: 1 })); return true; }
    catch { return false; }
  };
  if (attempt({ ...m, incomplete: false })) return true;
  const trimmed = (presets, lists) => ({
    ...m, incomplete: true, order: m.order.slice(0, presets),
    presets: Object.fromEntries(m.order.slice(0, presets).filter((id) => m.presets[id]).map((id) => [id, m.presets[id]])),
    playlists: m.playlists.slice(0, lists),
  });
  // the most that fits of a quantity in [0, max]: each success overwrites the last, so the last success is the largest
  const most = (max, fits) => { let lo = 0, hi = max, best = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (fits(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1; } return best; };
  if (most(m.order.length, (k) => attempt(trimmed(k, m.playlists.length))) >= 0) return true;
  return most(m.playlists.length, (j) => attempt(trimmed(0, j))) >= 0;
}

const TOAST_MS = 6000;
const clone = (o) => JSON.parse(JSON.stringify(o));
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const networkDown = (e) => e.status === 0 || e.status >= 500;   // arboretum cannot be reached or is down: what was asked waits

// `loc` / `fetchImpl` are the page's own, injectable so the tiers can be tested. Mounting builds nothing and asks nothing until
// `detect` answers: off the session hosts it never does, and arboretum stays local-only (plus the read tier, for a link).
export function mount(host, { loc = globalThis.location, fetchImpl = globalThis.fetch } = {}) {
  const reader = makeApi(ARBORETUM, fetchImpl, { credentials: "omit" });   // the read tier: anonymous GETs, from any origin
  let api = null;                             // the session's wire, once detect says there is one
  let on = false;                             // the session tier is on: detect named an origin

  let me = null;                              // the last answer of /api/me (cached, so a signed-in editor needs no round trip to show your looks)
  let out = false;                            // /api/me (or a write) answered 401: the sign-in button shows
  let offline = false;                        // the last call to arboretum could not reach it: lists show from the mirror
  let refusal = null;                         // arboretum's last refusal and the look it was for: { key, text }
  let wantStart = false;                      // the advanced panel was shown before detect answered
  let movePrompt = false;                     // the "move your looks into arboretum?" notice is up
  let asked = false;                          // ...and it has been put up once this session
  const keyOf = (active, value) => `${active}|${value}`;
  const signedIn = () => on && me !== null;
  const view = () => viewState(getState(), getMirror(), signedIn() ? me : null);

  // ---- the controls (session tier only) ----
  let inRow, chips, status, line, cta, who, moveBox, moveText, moveYes, moveNo;
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

    moveBox = make("div", "ctl arb-move");
    moveBox.style.flexWrap = "wrap";
    moveText = make("span", "arb-move-text");
    moveText.style.cssText = "font-size:11px;color:#9fb89f;flex:1 1 100%";
    moveYes = make("button", "arb-move-yes");
    moveNo = make("button", "arb-move-no", "not now");
    moveBox.append(moveText, moveYes, moveNo);
    line = make("div", "ctl arb-signin");
    cta = make("button", "arb-cta", "keep your looks in arboretum ↗");
    who = make("span", "arb-who");
    who.style.cssText = "font-size:11px;color:#9fb89f";
    line.append(cta, who);
    host.rows.tools.after(moveBox, line);
    cta.addEventListener("click", () => window.open(`${origin}/arboretum/login`, "_blank", "noopener"));
    moveYes.addEventListener("click", moveLocal);
    moveNo.addEventListener("click", () => { movePrompt = false; render(); });
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

  // The chips under the save row: one per playlist of yours (a folder), lit where this look's preset is an item. They follow the
  // look selected and the mirror's copy of your playlists.
  function drawChips() {
    if (!on) return;
    const mine = signedIn() ? getMirror().playlists.filter((p) => p.owner === me && editorWritable(p)) : [];
    inRow.hidden = mine.length === 0;
    if (!mine.length) return;
    chips.replaceChildren(...playlistChips(view(), getStored(), host.active(), host.value(), mine).map((c) => {
      const b = make("button", "arb-in", c.name);
      b.setAttribute("aria-pressed", String(c.lit));
      if (c.lit) b.style.cssText = "background:#2c4a2c;border-color:#7fae7f;color:#e8d9a8";
      b.addEventListener("click", () => toggle(c.id, c.lit));
      return b;
    }));
  }

  // The notice, and the button that stays on the "on this browser" list after "not now": the ★ looks not yet in arboretum.
  function drawMove() {
    const n = signedIn() ? moveCandidates(getState(), getStored()).length : 0;
    const asking = n > 0 && movePrompt, listed = n > 0 && !movePrompt && host.active() === "local";
    moveBox.hidden = !(asking || listed);
    moveText.hidden = !asking;
    moveText.textContent = `move your ${n} look${n === 1 ? "" : "s"} into arboretum? they'll be private`;
    moveYes.textContent = asking ? "move" : "move to arboretum";
    moveNo.hidden = !asking;
  }

  function render() {
    if (!on) return;
    line.hidden = me === null && !out;
    cta.hidden = !out;
    who.hidden = me === null;
    who.textContent = me === null ? "" : `arboretum · ${me}`;
    drawChips();
    drawMove();
    host.sync();
  }

  // ---- who is signed in. Asked when the advanced panel is first shown or a cloud playlist is active, and again whenever
  // the window regains focus, so a sign-in finished in the other tab shows at once. A successful answer sends the saves that
  // waited, refreshes the mirror, and — the first time in a session — offers to move the ★ looks in. ----
  function bindWaitingOwner() {
    const owner = getState().me?.username;
    const m = getMirror();
    // Legacy queues had no owner. Only the previously cached session can identify them; an unknown owner stays unsent.
    if (m.queue.some((q) => q.owner === undefined))
      return setMirror({ ...m, queue: m.queue.map((q) => q.owner === undefined ? { ...q, owner: owner ?? null } : q) });
    return true;
  }
  function signOut() {
    const bound = bindWaitingOwner();
    me = null; out = true;
    if (bound) setState({ ...getState(), me: null });   // the mirror and the waiting saves stay: signing in again resumes from them
    render();
  }
  function fail(e) {
    if (e.status === 401) signOut();
    else if (networkDown(e)) { offline = true; render(); }
    else { say(e.error ?? String(e)); render(); }
  }
  async function check() {
    try {
      const username = (await api.me()).username;
      if (!bindWaitingOwner()) {
        me = null; out = true;
        say("this browser could not keep the waiting saves' owner; free storage before signing in");
        render();
        return;
      }
      me = username;
      out = false;
      offline = false;
      setState({ ...getState(), me: { username: me } });
      await pushQueue();
      await refreshMirror();
      if (!asked && moveCandidates(getState(), getStored()).length) movePrompt = asked = true;
      render();
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
    const bound = bindWaitingOwner();
    me = bound ? getState().me?.username ?? null : null;
    out = !bound;
    buildControls(origin);
    render();
    if (wantStart || host.advancedShown() || host.active() !== "local") start();
    return origin;
  });

  // ---- the mirror ----
  // GET /api/presets?owner=me carries each preset's version but not its params: only the ones whose version moved are fetched.
  async function refreshMirror() {
    const sums = (await api.presets()).presets;
    const d = mirrorDiff(getMirror(), sums);
    const fetched = {};
    await Promise.all(d.fetch.map(async (id) => {
      try { fetched[id] = await api.preset(id); }
      catch (e) { if (e.status === 401 || networkDown(e)) throw e; }   // one preset gone between the list and the fetch: skipped
    }));
    const listSums = (await api.playlists()).playlists;
    const views = await Promise.all(listSums.map((p) => api.playlist(p.id).catch((e) => { if (e.status === 401) throw e; return null; })));
    setMirror(mirrorSync(getMirror(), sums, fetched, listSums, views, Date.now()));
  }
  // A playlist as arboretum has it: yours go to the mirror, someone else's (opened by link) to the cache beside it.
  function cacheView(v) {
    if (v.owner === me) setMirror(mirrorPlaylist(getMirror(), v));
    else setState(cachePlaylist(getState(), v));
  }

  // ---- playlists ----
  // A playlist opened by link is fetched again with the share token the link carried, which the cache kept (an unlisted
  // one of someone else's is not visible without it).
  const fetchList = (id) => api.playlist(id, { k: getState().playlists[id]?.k ?? undefined });

  // Activating a playlist fetches it fresh; when arboretum cannot be reached the copy kept here plays on, and the look's chip says so.
  async function activate(list) {
    if (!on || !/^arb:\d+$/.test(list)) { host.activate(list); return; }
    const id = list.slice(4);
    try {
      cacheView(await fetchList(id));
      offline = false;
    } catch (e) {
      if (e.status === 401) signOut();
      else if (networkDown(e)) offline = true;
      if (!view().playlists[id]) { if (e.status !== 401) say(e.error); host.sync(); return; }
    }
    host.activate(list);
  }

  const askName = () => (prompt("New playlist name:") || "").trim();
  async function create() {
    if (!on) return;
    const name = askName();
    if (!name) return;
    try {
      const made = await api.createPlaylist({ name });
      cacheView(made);
      render();
      host.activate(`arb:${made.id}`);
    } catch (e) { fail(e); }
  }

  // Every write to a playlist's items starts from a fresh GET and applies the one change to that, never to the cache.
  async function writeItems(id, change) {
    if ((change.kind === "remove" || change.kind === "replace") && !change.target)
      throw { error: "that playlist item changed; reload the playlist before changing it" };
    const fresh = await api.playlist(id);
    const v = await api.putItems(id, itemsAfter(fresh.items, change), fresh.revision);
    cacheView(v);
    return v;
  }

  // ---- uploads ----
  const send = (p) => {
    const m = p.path.match(/^\/api\/presets\/(\d+)\/versions$/);
    return m ? api.addVersion(Number(m[1]), p.body) : api.create(p.body);
  };
  // An upload landed: the preset is filed in the mirror at once, and the folder it was saved into takes it (a new preset in the
  // place of the item or at the end; a new version, the playlist already pointing at the preset).
  async function landed(p, res) {
    setMirror(mirrorPut(getMirror(), { id: res.id, version: res.version, owner: res.owner ?? me, name: p.body.name, params: p.body.params, visibility: res.visibility ?? "private" }));
    if (!p.into) return;
    if (p.kind === "version") cacheView(await api.playlist(p.into.playlist));
    else await writeItems(p.into.playlist, placeChange(p.into, res.id));
  }

  // Save, signed in: every save goes to arboretum, private. A new version when the look is a preset of yours, else a new preset;
  // in a folder of yours it is placed there, anywhere else it lands in uncategorized and the editor goes to it. When arboretum
  // cannot be reached the save waits in the mirror, shown as such, and is sent in order on the next successful check.
  async function saveCloud(name, live) {
    const active = host.active(), value = host.value();
    const p = savePlan(view(), getStored(), active, value, clone(live), me, await api.commit(), cameraFor, name);
    if (p.refused) { say(p.refused); return; }
    const list = p.into ? `arb:${p.into.playlist}` : "arb:unc";
    let res;
    try { res = await send(p); }
    catch (e) {
      if (e.status === 401) { signOut(); host.keepLocal(name, live); return; }   // the session ended: the look is kept here, as a ★, until you sign in
      if (networkDown(e)) {
        const m = enqueue(getMirror(), { ...p, owner: me });
        const kept = setMirror(m);
        offline = true;
        render();
        if (!kept) { say("could not save: this browser's storage is full or disabled; the look is still on screen"); return; }
        host.showCloud(list, p.kind === "version" ? { id: Number(p.path.split("/")[3]) } : { seq: m.queue.at(-1).seq });
        return;
      }
      refusal = { key: keyOf(active, value), text: e.error ?? String(e) };
      say(refusal.text);
      render();
      return;
    }
    offline = false;
    if (refusal?.key === keyOf(active, value)) refusal = null;
    try { await landed(p, res); }
    catch (e) { fail(e); host.showCloud(p.kind === "preset" ? "arb:unc" : list, { id: res.id }); return; }
    say(`kept in arboretum · #${res.id} v${res.version}`);
    render();
    host.showCloud(list, { id: res.id });
  }

  // The saves that waited go up in the order they were made. A network failure or an ended session stops the rest, which waits for
  // the next check; one that arboretum refuses would be refused again, so it becomes a ★ here, with the reason said.
  let pushing = false;
  async function pushQueue() {
    if (pushing) return;
    pushing = true;
    try {
      for (const q of getMirror().queue) {
        if (q.owner !== me) continue;
        let res;
        try { res = await send(q); }
        catch (e) {
          if (e.status === 401 || networkDown(e)) throw e;
          const stored = getStored();
          const name = Object.hasOwn(stored, q.body.name) ? `${q.body.name} (${q.seq})` : q.body.name;
          setStored({ ...stored, [name]: q.body.params });
          setMirror(dequeue(getMirror(), q.seq));
          refusal = { key: keyOf("local", starValue(name)), text: e.error ?? String(e) };
          say(refusal.text);
          continue;
        }
        setMirror(dequeue(getMirror(), q.seq));
        try { await landed(q, res); }
        catch (e) { if (e.status === 401 || networkDown(e)) throw e; say(e.error ?? String(e)); }   // it is on arboretum: only its place in a folder failed
      }
    } finally { pushing = false; }
  }

  // Remove: the playlist without the item. The preset itself stays on arboretum.
  async function remove() {
    const active = host.active(), value = host.value();
    if (!on || !value) return;
    const pid = Number(active.slice(4)), at = Number(value);
    try {
      await writeItems(pid, { kind: "remove", at, target: itemTarget(view().playlists[pid]?.items ?? [], at) });
      const n = view().playlists[pid].items.length;
      say("");
      host.select(n ? String(Math.min(at, n - 1)) : "");
    } catch (e) { fail(e); }
  }

  // A ★ look that has gone up leaves local storage: it is a preset of yours now, and the mirror has it.
  function adopt(name, p, res) {
    const stored = getStored();
    delete stored[name];
    setStored(stored);
    setState(onDeleted(getState(), name));
    setMirror(mirrorPut(getMirror(), { id: res.id, version: res.version, owner: res.owner ?? me, name: p.body.name, params: p.body.params, visibility: res.visibility ?? "private" }));
  }

  // A chip: the look joins the folder, or leaves it (the first item of that preset). Joining or leaving moves it out of or back into
  // uncategorized, with no request of its own: the lists are derived from the mirror. A look that is not on arboretum yet goes up first.
  async function toggle(pid, lit) {
    const active = host.active(), value = host.value();
    let res = null;
    try {
      let preset = onlineId(view(), getStored(), active, value);
      if (preset === null) {
        const it = active.startsWith("arb:") ? view().playlists[active.slice(4)]?.items[Number(value)] : null;
        if (it?.pending) { say("this look is waiting to go up"); return; }
        const star = active === "local" ? fromEntry(getState(), getStored(), active, value) : null;
        const p = star?.kind === "local"
          ? uploadPlan(getState(), getStored(), "local", value, null, me, await api.commit(), cameraFor)
          : savePlan(view(), getStored(), active, value, clone(host.params), me, await api.commit(), cameraFor, entryName(view(), getStored(), active, value));
        if (p.refused) { say(p.refused); return; }
        res = await send(p);
        if (star?.kind === "local") adopt(star.name, p, res);
        else setMirror(mirrorPut(getMirror(), { id: res.id, version: res.version, owner: res.owner ?? me, name: p.body.name, params: p.body.params, visibility: res.visibility ?? "private" }));
        preset = res.id;
      }
      await writeItems(pid, lit ? { kind: "remove_preset", preset_id: preset } : { kind: "append", preset_id: preset });
      render();
      // the look joined or left a folder, so uncategorized changed under the selection: follow the look to where it lives now
      if (!lit && active === "arb:unc") host.showCloud(`arb:${pid}`, { id: preset });
      else if (lit && active === `arb:${pid}` && view().playlists.unc.items.some((i) => i.preset_id === preset)) host.showCloud("arb:unc", { id: preset });
      else if (active === `arb:${pid}`) host.reload();
    } catch (e) { fail(e); }
  }

  // Moving the local looks in: each ★ not yet a synced preset goes up as uploadPlan decides — a new version when its origin is your
  // own preset, else a new private preset — and is no longer a separate ★; it lands in uncategorized. A refusal stays local, its
  // reason shown verbatim (and on that look's chip); a network failure stops the move and leaves the rest local for next time.
  async function moveLocal() {
    const wasLocal = host.active() === "local";
    let moved = 0;
    refusal = null;
    try {
      for (const { name, plan: p } of movePlan(getState(), getStored(), me, await api.commit(), cameraFor)) {
        if (p.refused) continue;
        try {
          adopt(name, p, await send(p));
          moved++;
        } catch (e) {
          if (e.status === 401 || networkDown(e)) throw e;
          refusal = { key: keyOf("local", starValue(name)), text: e.error ?? String(e) };
          say(refusal.text);
        }
      }
    } catch (e) { fail(e); }
    movePrompt = false;
    if (moved && !refusal) say(`moved ${moved} look${moved === 1 ? "" : "s"} into arboretum`);   // a refusal's reason, said above, stays on screen
    render();
    if (moved && wasLocal && !moveCandidates(getState(), getStored()).length) host.activate("arb:unc");
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
        if (signedIn() && head.owner === me) {
          for (const p of Object.values(view().playlists)) {
            if (p.owner !== me) continue;
            const at = p.items.findIndex((it) => !it.pending && it.preset_id === id && it.version === r.state.origin[r.name].version);
            if (at >= 0) return { list: `arb:${p.id}`, value: String(at) };
          }
        }
        return { value: starValue(r.name) };
      }
      const got = linkPlaylist(getState(), await wire.playlist(link.playlist.id, { k: link.playlist.k }), link.playlist.k);
      if (got.failed) return { failed: got.failed };
      setState(got.state);
      return { list: got.list, value: got.value, play: true };
    } catch (e) { return { failed: e.error ?? String(e) }; }
  }

  return {
    ready, activate, create, saveCloud, remove, open,
    signedIn,
    view,
    lists: (active) => listChoices(view(), { me: signedIn() ? me : null, stored: getStored(), mirror: getMirror(), active }),
    changed: () => { drawChips(); if (on) drawMove(); },
    advanced: start,
    canRemove: () => signedIn() && isFolder(view(), host.active(), me),
    // what the look's chip needs beyond the saved state: who you are, whether this is the copy kept here because arboretum could not
    // be reached, the last refusal for this look, and whether the copy is incomplete
    info: () => ({
      me: signedIn() ? me : null, offline: offline && signedIn() && host.active().startsWith("arb:"),
      error: refusal?.key === keyOf(host.active(), host.value()) ? refusal.text : null, incomplete: getMirror().incomplete,
    }),
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
