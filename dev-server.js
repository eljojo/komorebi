// ============================================================================
// dev-server.js — bun static server + live-reload for komorebi (`nix run .#dev`).
// ES-module dev needs http (not file://); this is that http. It serves the repo,
// injects a tiny reload socket into every HTML page, and reloads all open tabs
// whenever a .js/.html/.css file changes. No build in the loop — the pages load
// komorebi.js / presets.js raw, so a save is live on reload. No deps: pure Bun.
//   bun dev-server.js [port]      (default 8000)
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

// auto-reconnecting reload socket, injected before </body>
const RELOAD = `<script>(()=>{const c=()=>{const s=new WebSocket("ws://"+location.host+"/__reload");`
  + `s.onmessage=()=>location.reload();s.onclose=()=>setTimeout(c,500);};c();})();</script>`;

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/__reload") {                 // live-reload websocket
      return server.upgrade(req) ? undefined : new Response("expected websocket", { status: 400 });
    }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = resolve(ROOT, `.${path}`);
    if (file !== ROOT && !file.startsWith(`${ROOT}/`)) return new Response("forbidden", { status: 403 });
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response("not found", { status: 404 });
    const ext = extname(file).toLowerCase();
    if (ext === ".html") {                              // inject the reload socket
      let html = await f.text();
      html = html.includes("</body>") ? html.replace("</body>", `${RELOAD}</body>`) : `${html}${RELOAD}`;
      return new Response(html, { headers: { "content-type": MIME[".html"] } });
    }
    return new Response(f, { headers: { "content-type": MIME[ext] || "application/octet-stream" } });
  },
  websocket: { open(ws) { sockets.add(ws); }, close(ws) { sockets.delete(ws); }, message() {} },
});

let timer = null;                                        // debounce a burst of fs events into one reload
watch(ROOT, (_event, name) => {
  if (!name || !/\.(js|mjs|html|css)$/.test(name)) return;
  clearTimeout(timer);
  timer = setTimeout(() => { for (const ws of sockets) ws.send("reload"); }, 80);
});

console.log(`komorebi dev — http://localhost:${PORT}  (live-reload on .js / .html / .css)`);
