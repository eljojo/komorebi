// ============================================================================
// Komorebi editor — arboretum's DOM half (editor-integration-design §3–§4, §6.2). EDITOR ONLY, reached solely through the
// dynamic import behind `detect` in editor.js. Every control lives in the advanced panel (#dev): the sign-in button, the
// ↑ and "add to" buttons under the save row, the status line, and the Arboretum group (who is signed in, the picker, refresh).
// Nothing is added to the playful sidebar or the zen strip. The rules live in playlists.js and the wire in arboretum-api.js;
// this file only connects them to the page. The editor hands in what it owns (`host`) and gets back the hooks it calls.
// Everything the editor creates is private: no request here ever names `visibility`.
// ============================================================================
import { api as makeApi } from "./arboretum-api.js";
import { cameraFor } from "./komorebi.js";
import { getStored, setStored } from "./presets-store.js";
import { cachePlaylist, fromEntry, getState, itemsAfter, onDeleted, onPushed, onSaved, onlineId, placeChange,
  playlists, pushButton, savePreset, setState, uploadPlan } from "./playlists.js";

const NEW = "+new";   // the value of "New playlist…", in the playlist select and in "add to"
const clone = (o) => JSON.parse(JSON.stringify(o));
const make = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const option = (value, label) => { const o = make("option", "", label); o.value = value; return o; };

export function mount(origin, host) {
  document.body.dataset.arboretum = origin;
  const api = makeApi(origin, fetch);

  let me = getState().me?.username ?? null;   // the last answer of /api/me; cached, so labels need no round trip
  let out = false;                            // /api/me (or a write) answered 401: the sign-in button shows
  let mine = [];                              // your playlists as arboretum lists them (summaries; items come on activation)
  let presets = [];                           // your presets, for the picker

  // ---- the controls ----
  const push = make("button", "arb-push");
  const addto = make("select", "arb-addto");
  const actions = make("div", "ctl arb-actions");
  actions.append(push, addto);
  const status = make("div", "arb-status");
  status.style.cssText = "font-size:11px;color:#9fb89f;margin:2px 0 6px;word-break:break-word";
  host.rows.save.after(actions, status);

  const head = make("h2", "arb-head", "Arboretum");
  const signin = make("div", "ctl arb-signin");
  const cta = make("button", "arb-cta", "save your playlists in arboretum ↗");
  signin.append(cta);
  const who = make("div", "ctl arb-in");
  const whoText = make("span", "arb-who");
  const refreshBtn = make("button", "arb-refresh", "refresh");
  who.append(whoText, refreshBtn);
  const picker = make("div", "ctl select arb-picker");
  const pickSel = make("select");
  picker.append(pickSel);
  host.rows.tools.after(head, signin, who, picker);

  const say = (text) => { status.textContent = text; status.hidden = text === ""; };
  say("");

  function render() {
    const signedIn = me !== null;
    head.hidden = !signedIn && !out;
    signin.hidden = !out;
    actions.hidden = who.hidden = picker.hidden = !signedIn;
    whoText.textContent = signedIn ? `signed in as ${me}` : "";
    addto.replaceChildren(option("", "add to ▾"), ...mine.map((p) => option(String(p.id), p.name)), option(NEW, "New playlist…"));
    pickSel.replaceChildren(option("", "my presets ▾"), ...presets.map((p) => option(String(p.id), p.name)));
    host.sync();
  }

  // The smart ↑ button belongs to On this browser: in a cloud playlist the look is already online.
  function changed() {
    const value = host.value();
    push.hidden = host.active() !== "local" || !fromEntry(getState(), getStored(), "local", value);
    if (push.hidden) return;
    const b = pushButton(uploadPlan(getState(), getStored(), "local", value, host.params, me, null, cameraFor));
    push.textContent = b.label;
    push.disabled = b.disabled;
    push.title = b.title ?? "";
  }

  // ---- who is signed in. Asked when the advanced panel is first shown or a cloud playlist is active, and again whenever
  // the window regains focus, so a sign-in finished in the other tab shows at once. ----
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
      setState({ ...getState(), me: { username: me } });
      [mine, presets] = await Promise.all([api.playlists().then((r) => r.playlists), api.presets().then((r) => r.presets)]);
      render();
    } catch (e) { fail(e); }
  }
  let started = false;
  function start() {
    if (started) return;
    started = true;
    window.addEventListener("focus", check);
    check();
  }
  if (host.advancedShown() || host.active() !== "local") start();

  cta.addEventListener("click", () => window.open(`${origin}/login`, "_blank", "noopener"));
  refreshBtn.addEventListener("click", async () => {
    await check();
    const a = host.active();
    if (a === "local" || me === null) return;
    try { setState(cachePlaylist(getState(), await api.playlist(a.slice(4)))); host.reload(); } catch (e) { fail(e); }
  });

  // ---- playlists ----
  // The select's options: yours, the cached ones, and — once signed in — "New playlist…".
  const lists = () => [...playlists(getState(), mine), ...(me !== null ? [{ value: NEW, label: "New playlist…" }] : [])];

  // Activating fetches the playlist fresh; when arboretum cannot be reached the cached copy plays on.
  async function activate(list) {
    if (!list.startsWith("arb:")) { host.activate(list); return; }
    const id = list.slice(4);
    try {
      setState(cachePlaylist(getState(), await api.playlist(id)));
      say("");
    } catch (e) {
      if (e.status === 401) signOut();
      const cached = getState().playlists[id];
      if (!cached) { if (e.status !== 401) say(e.error); host.sync(); return; }
      say(`offline copy from ${new Date(cached.fetched_at).toISOString().slice(0, 10)}`);
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
    const name = askName();
    if (!name) { host.sync(); return; }
    try { host.activate(`arb:${await makePlaylist(name)}`); } catch (e) { fail(e); host.sync(); }
  }

  // Every write to a playlist's items starts from a fresh GET and applies the one change to that, never to the cache.
  async function writeItems(id, change) {
    const fresh = await api.playlist(id);
    const view = await api.putItems(id, itemsAfter(fresh.items, change));
    setState(cachePlaylist(getState(), view));
    return view;
  }

  // ---- uploads ----
  async function plan(active, value, live, name) {
    const p = uploadPlan(getState(), getStored(), active, value, live, me, await api.commit(), cameraFor);
    if (p.refused) { say(p.refused); return null; }
    if (name !== undefined) p.body.name = name;
    return p;
  }
  const send = (p) => {
    const m = p.path.match(/^\/api\/presets\/(\d+)\/versions$/);
    return m ? api.addVersion(Number(m[1]), p.body) : api.create(p.body);
  };

  // ↑ in On this browser: the stored ★ goes up, as a new version of its preset when it is yours, else as a new preset.
  async function pushStar() {
    const value = host.value();
    const from = fromEntry(getState(), getStored(), "local", value);
    try {
      const p = await plan("local", value, clone(host.params));
      if (!p) return;
      const res = await send(p);
      if (from?.kind === "local") setState(onPushed(getState(), from.name, res));
      say(`#${res.id} v${res.version}`);
    } catch (e) { fail(e); }
    changed();
  }

  // Save inside a cloud playlist: the look goes to arboretum, and the playlist takes it in the place of the item.
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
      say(`#${res.id} v${res.version}`);
      host.select(at);
    } catch (e) { fail(e); }
  }

  // Remove: the playlist without the item. The preset itself stays on arboretum.
  async function remove() {
    const active = host.active(), value = host.value();
    if (!value) return;
    const pid = Number(active.slice(4)), at = Number(value);
    try {
      await writeItems(pid, { kind: "remove", at });
      const n = getState().playlists[pid].items.length;
      say("");
      host.select(n ? String(Math.min(at, n - 1)) : "");
    } catch (e) { fail(e); }
  }

  // Add to: the look goes up first when it is not online yet, then its preset is appended to the playlist chosen.
  async function addTo(target) {
    const active = host.active(), value = host.value();
    const name = target === NEW ? askName() : null;
    if (target === NEW && !name) return;
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
      const into = target === NEW ? await makePlaylist(name) : Number(target);
      const view = await writeItems(into, { kind: "append", preset_id: preset });
      say(`added to ${view.name}`);
      if (target === NEW) host.activate(`arb:${into}`);
      else if (active === `arb:${into}`) host.reload();
    } catch (e) { fail(e); }
    changed();
  }

  // The picker: one of your presets becomes a ★ in On this browser, by the same rule as a link.
  async function pick(id) {
    try {
      const r = savePreset(getState(), getStored(), await api.preset(id));
      setState(r.state);
      setStored(r.stored);
      host.show(r.name);
    } catch (e) { fail(e); }
  }

  push.addEventListener("click", pushStar);
  addto.addEventListener("change", async () => { const t = addto.value; addto.value = ""; if (t) await addTo(t); });
  pickSel.addEventListener("change", async () => { const id = pickSel.value; pickSel.value = ""; if (id) await pick(id); });
  render();

  return {
    lists, activate, create, save, remove, changed,
    advanced: start,
    // provenance (design §4.1): what the editor's own saves and deletes mean for a ★'s record
    saved: (name, active, value) => setState(onSaved(getState(), name, fromEntry(getState(), getStored(), active, value))),
    deleted: (name) => setState(onDeleted(getState(), name)),
  };
}
