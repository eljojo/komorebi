// ============================================================================
// dev-server.js — bun static server + live-reload for komorebi (`nix run .#dev`).
// ES-module dev needs http (not file://); this is that http. It serves the repo,
// injects a tiny reload socket into every HTML page, and reloads all open tabs
// whenever a .js/.html/.css file changes. No build in the loop — the pages load
// komorebi.js / presets.js raw, so a save is live on reload. No deps: pure Bun.
//   bun dev-server.js [port]      (default 8000)
//
// THE BRIDGE (dev only): a second injected script lets a tool outside the browser read and change the look in an open
// editor tab and see its frame, over plain HTTP:
//   GET  /__dev          the editor tabs connected, the one answering first, and whether each landed on a kept look
//   GET  /__dev/params   the look as the tab holds it (JSON)
//   POST /__dev/params   merge a JSON object of params into it (content-type application/json); answers the new look
//   GET  /__dev/frame    the tab's next drawn frame (PNG), insets included
//   GET  /__dev/tree     the tree preview (the editor's T), shown big for the capture and put back after (PNG, the preview alone)
//   GET  /__dev/pane     the workspace's tree pane in the view it is on, drawn at ?w=&h= (920×1120) whether or not the workspace is up (PNG)
// The tab that answers is the one most recently focused or connected. It exists only where this server injects it:
// editor.js attaches through `globalThis.__komorebiDev`, which nothing else defines, so a deployed page never has it.
// A hidden tab draws no frames, so /__dev/frame answers 503 there after 8 s. A live reload keeps the editor's look (pageBridge says how).
// ============================================================================
import { watch } from "node:fs";
import { resolve, extname } from "node:path";

const ROOT = process.cwd();
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8000);
const sockets = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon",
};

// auto-reconnecting reload socket, injected before </body>. Before a live reload an attached editor keeps its look (the bridge's keep).
const RELOAD = `<script>(()=>{const c=()=>{const s=new WebSocket("ws://"+location.host+"/__reload");`
  + `s.onmessage=()=>{try{window.__komorebiDev?.keep?.();}catch(e){console.error(e);}location.reload();};s.onclose=()=>setTimeout(c,500);};c();})();</script>`;

// The bridge's page half, injected as source (it runs in the tab, not here). It defines the attach point and does
// nothing else until a page attaches to it; the editor hands it its engine and its own way of loading a look.
// THE KEPT LOOK: a live reload (a saved file) stores the editor's look and the entry it was on in this tab's
// sessionStorage, and the reloaded page takes them back as `kept`, which the editor lands on instead of the
// welcome. The store is cleared only once an editor has attached, having landed on it: one save can send two reloads,
// and the second may come before the first page's editor runs. A reload by hand stores nothing, so it starts fresh.
function pageBridge() {
  const KEY = "komorebi-dev-kept";
  let kept = null;
  try { kept = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { console.error(e); }
  window.__komorebiDev = {
    kept,
    attach({ eng, look, set, value, tree, untree, pane }) {
      sessionStorage.removeItem(KEY);
      window.__komorebiDev.keep = () => sessionStorage.setItem(KEY, JSON.stringify({ look: look(), value: value() }));
      // captures waiting for a frame: { n frames still to wait, crop (a GL-pixel rect, iy from the bottom) or null, resolve }
      const frames = [];
      const prev = eng.onFrame;
      // read the canvas inside the frame's own callback, after the editor drew its insets: outside it the WebGL
      // drawing buffer may already have been cleared for compositing
      const grab = (crop) => {
        const c = eng.canvas;
        if (!crop) return c.toDataURL("image/png");
        const o = document.createElement("canvas"); o.width = crop.S; o.height = crop.S;
        o.getContext("2d").drawImage(c, crop.ix, c.height - crop.iy - crop.S, crop.S, crop.S, 0, 0, crop.S, crop.S);
        return o.toDataURL("image/png");
      };
      eng.onFrame = (dt) => {
        prev?.(dt);
        for (let i = frames.length - 1; i >= 0; i--) {
          const f = frames[i];
          if (--f.n > 0) continue;
          frames.splice(i, 1); f.resolve(grab(f.crop?.()));
        }
      };
      const after = (n, crop) => new Promise((resolve) => frames.push({ n, crop, resolve }));
      const ops = {
        params: () => look(),
        set: (patch) => { set(patch); return look(); },
        frame: () => after(1, null),
        // the preview eases to full size over a few dozen frames once pinned, so the capture waits for it
        tree: async () => { const was = tree(true); try { return await after(45, () => eng.treeInsetRect()); } finally { untree(was); } },
        pane: (size) => pane(size),
      };
      const connect = () => {
        const s = new WebSocket(`ws://${location.host}/__dev`);
        const hello = () => { if (s.readyState === 1) s.send(JSON.stringify({ hello: location.pathname + location.search, kept: !!kept })); };
        s.onopen = hello;
        s.onmessage = async (e) => {
          const { id, op, arg } = JSON.parse(e.data);
          try { s.send(JSON.stringify({ id, ok: true, result: await ops[op](arg) })); }
          catch (err) { s.send(JSON.stringify({ id, ok: false, error: String(err?.message ?? err) })); }
        };
        s.onclose = () => { window.removeEventListener("focus", hello); setTimeout(connect, 500); };
        window.addEventListener("focus", hello);   // the tab being looked at answers
      };
      connect();
    },
  };
}
const BRIDGE = `<script>(${pageBridge.toString()})();</script>`;

// ---- the bridge's server half: editor tabs, and requests waiting on their answer ----
const tabs = new Map();      // ws -> { page, at }: `at` bumps on connect and on focus
const waiting = new Map();   // request id -> { resolve, reject, timer }
let nextId = 1;
const current = () => { let best = null; for (const [ws, t] of tabs) if (!best || t.at > best[1].at) best = [ws, t]; return best?.[0]; };
function ask(op, arg) {
  const ws = current();
  if (!ws) return Promise.reject(new Error("no editor tab is connected: open the editor from this server"));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("the tab did not answer in 8 s (a hidden tab draws no frames)")); }, 8000);   // inside Bun's 10 s idle timeout, which would drop the request unanswered
    waiting.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, op, arg }));
  });
}
const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": MIME[".json"] } });
async function bridge(req, path) {
  try {
    if (path === "/__dev" && req.method === "GET") return json([...tabs.values()].sort((a, b) => b.at - a.at));
    if (path === "/__dev/params" && req.method === "GET") return json(await ask("params"));
    if (path === "/__dev/params" && req.method === "POST") {
      // JSON only: a cross-site form post cannot send this content type without a preflight this server never grants
      if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "send application/json" }, 415);
      const patch = await req.json();
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return json({ error: "send a JSON object of params" }, 400);
      return json(await ask("set", patch));
    }
    if ((path === "/__dev/frame" || path === "/__dev/tree" || path === "/__dev/pane") && req.method === "GET") {
      const q = new URL(req.url).searchParams, dim = (k) => Math.min(4096, Math.max(16, Number(q.get(k)) || 0)) || undefined;
      const url = await ask(path.slice("/__dev/".length), path === "/__dev/pane" ? { w: q.has("w") ? dim("w") : undefined, h: q.has("h") ? dim("h") : undefined } : undefined);
      return new Response(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"), { headers: { "content-type": MIME[".png"] } });
    }
    return json({ error: "not a bridge route" }, 404);
  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 503);
  }
}

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/__reload" || (url.pathname === "/__dev" && req.headers.get("upgrade") === "websocket")) {   // the reload and bridge sockets
      return server.upgrade(req, { data: { kind: url.pathname } }) ? undefined : new Response("expected websocket", { status: 400 });
    }
    if (url.pathname === "/__dev" || url.pathname.startsWith("/__dev/")) return bridge(req, url.pathname);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = resolve(ROOT, `.${path}`);
    if (file !== ROOT && !file.startsWith(`${ROOT}/`)) return new Response("forbidden", { status: 403 });
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response("not found", { status: 404 });
    const ext = extname(file).toLowerCase();
    if (ext === ".html") {                              // inject the reload socket and the bridge's page half
      let html = await f.text();
      html = html.includes("</body>") ? html.replace("</body>", `${RELOAD}${BRIDGE}</body>`) : `${html}${RELOAD}${BRIDGE}`;
      return new Response(html, { headers: { "content-type": MIME[".html"] } });
    }
    return new Response(f, { headers: { "content-type": MIME[ext] || "application/octet-stream" } });
  },
  websocket: {
    open(ws) { if (ws.data.kind === "/__reload") sockets.add(ws); },
    close(ws) { sockets.delete(ws); tabs.delete(ws); },
    message(ws, raw) {
      if (ws.data.kind !== "/__dev") return;
      const m = JSON.parse(String(raw));
      if (m.hello !== undefined) { tabs.set(ws, { page: m.hello, kept: !!m.kept, at: Date.now() }); return; }
      const w = waiting.get(m.id);
      if (!w) return;   // answered after its timeout
      waiting.delete(m.id); clearTimeout(w.timer);
      if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error));
    },
  },
});

let timer = null;                                        // debounce a burst of fs events into one reload
watch(ROOT, (_event, name) => {
  if (!name || !/\.(js|mjs|html|css)$/.test(name)) return;
  clearTimeout(timer);
  timer = setTimeout(() => { for (const ws of sockets) ws.send("reload"); }, 80);
});

console.log(`komorebi dev — http://localhost:${PORT}  (live-reload on .js / .html / .css; the bridge at /__dev)`);
