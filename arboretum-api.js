// ============================================================================
// Komorebi editor — the wire to arboretum (editor-integration-design §6.2). NETWORK ONLY, EDITOR ONLY: loaded through
// the dynamic import that `detect` (playlists.js) gates, so a fork's browser never fetches it, and no engine module or
// bundle may name it (arboretum.test.js holds that). A factory over an injectable `fetch`, so the tests are the wire.
// ============================================================================

// Arboretum's own error shape is `{ error, reason?, keys? }`; a rejection carries those with the status. A fetch that
// throws is status 0. The editor shows `error` verbatim and never rewrites a refusal.
const unreachable = { status: 0, error: "arboretum unreachable" };

// `credentials` is "include" for the session (the default) and "omit" for a reader: the anonymous GETs a link makes from any
// origin, which must not carry a cookie.
export function api(origin, fetchImpl, { credentials = "include" } = {}) {
  // A session call sends the session cookie: harmless same-origin (the dev mode), required cross-origin (komorebi.eljojo.net).
  // A write names its Content-Type or arboretum's CSRF guard refuses it with 415.
  async function call(method, path, body) {
    const init = { method, credentials };
    if (body !== undefined) { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetchImpl(`${origin}${path}`, init); }
    catch { throw unreachable; }
    if (res.ok) return res.json();
    const answer = await res.json().catch(() => ({}));   // a gateway's HTML is not arboretum's JSON
    throw { status: res.status, ...answer, error: answer.error ?? `arboretum answered ${res.status}` };
  }
  const query = (k) => (k === undefined ? "" : `?k=${encodeURIComponent(k)}`);

  // `komorebi_commit` is optional on arboretum, so anything but a good commit.json is simply no commit. The file sits
  // beside the editor page (pages.yml writes it), not on arboretum, and is read once.
  let commit;
  const readCommit = async () => {
    try {
      const res = await fetchImpl("./commit.json");
      if (!res.ok) return null;
      const { commit: sha } = await res.json();
      return typeof sha === "string" && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
    } catch { return null; }
  };

  return {
    health: () => call("GET", "/api/health"),
    me: () => call("GET", "/api/me"),
    preset: (id, { n, k } = {}) => call("GET", `/api/presets/${id}${n === undefined ? "" : `/versions/${n}`}${query(k)}`),
    presets: () => call("GET", "/api/presets?owner=me"),   // the picker's list: yours, newest first, without params
    create: (body) => call("POST", "/api/presets", body),
    addVersion: (id, body) => call("POST", `/api/presets/${id}/versions`, body),
    playlists: () => call("GET", "/api/playlists?owner=me"),
    playlist: (id, { k } = {}) => call("GET", `/api/playlists/${id}${query(k)}`),
    createPlaylist: (body) => call("POST", "/api/playlists", body),
    putItems: (id, items) => call("PUT", `/api/playlists/${id}/items`, { items }),
    commit: () => (commit ??= readCommit()),
  };
}
