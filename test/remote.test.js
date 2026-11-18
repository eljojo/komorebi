// Tests for remote.js: the screen's label, the state patches and their merge, the commands the phone may send, and the screen's
// side of the conversation over a stand-in socket. The room itself is arboretum's (arboretum/test/remote.test.ts).
// Run: `bun test remote.test.js`.
import { expect, test } from "bun:test";
import { mergeState, mountRemote, readCommand, screenLabel, stateDiff } from "../editor/remote.js";

const SCHEMA = {
  panel: [
    { kind: "area", name: "Sun" },
    { kind: "slider", key: "exposure", label: "exposure", min: -3, max: 3, step: 0.05, fidelity: false },
    { kind: "toggle", key: "eclipse", label: "eclipse" },
    { kind: "select", key: "wind_pattern", label: "pattern", options: [["calm", "calm"], ["gusty", "gusty"]], fidelity: false },
    { kind: "select", key: "texture_resolution", label: "res", options: [["512", "512"]], fidelity: true },
    { kind: "button", id: 7, label: "frame shadow" },
  ],
  dials: { season: { ends: ["green", "fallen"], min: 0.6, max: 0.95, step: 0.005, why: "" } },
  macros: { haze: { label: "haze" } },
  transMax: 6,
};
const read = (m) => readCommand(JSON.stringify(m), SCHEMA);

test("a screen is named by its browser and its system", () => {
  expect(screenLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36")).toBe("Chrome on Mac");
  expect(screenLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15")).toBe("Safari on Mac");
  expect(screenLabel("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox on Linux");
  expect(screenLabel("")).toBe("a browser");
});

test("a patch carries the fields that changed, and of the params only the keys that did", () => {
  const a = { look: { name: "memories" }, playing: false, params: { exposure: 0, contrast: 1 } };
  const b = { look: { name: "memories" }, playing: true, params: { exposure: 0.5, contrast: 1 } };
  expect(stateDiff(null, a)).toBe(a);
  expect(stateDiff(a, b)).toEqual({ playing: true, params: { exposure: 0.5 } });
  expect(stateDiff(b, structuredClone(b))).toBeNull();
  expect(mergeState(a, { t: "state", ...stateDiff(a, b) })).toEqual(b);
});

test("a command is held to the schema: a number to its control's range, a choice to the options, a name to what exists", () => {
  expect(read({ t: "param", key: "exposure", v: 9 })).toEqual({ t: "param", key: "exposure", v: 3 });
  expect(read({ t: "param", key: "eclipse", v: true })).toEqual({ t: "param", key: "eclipse", v: true });
  expect(read({ t: "param", key: "eclipse", v: 1 })).toBeNull();
  expect(read({ t: "param", key: "wind_pattern", v: "gusty" })).toEqual({ t: "param", key: "wind_pattern", v: "gusty" });
  expect(read({ t: "param", key: "wind_pattern", v: "tornado" })).toBeNull();
  expect(read({ t: "param", key: "seed", v: 1 })).toBeNull();
  expect(read({ t: "dial", name: "season", v: 0, end: true })).toEqual({ t: "dial", name: "season", v: 0.6, end: true });
  expect(read({ t: "dial", name: "nope", v: 0 })).toBeNull();
  expect(read({ t: "macro", key: "haze", v: 2 })).toEqual({ t: "macro", key: "haze", v: 1, end: false });
  expect(read({ t: "macro", key: "grove", v: 0.5 })).toBeNull();
  expect(read({ t: "inherit", key: "texture_resolution" })).toEqual({ t: "inherit", key: "texture_resolution" });
  expect(read({ t: "inherit", key: "exposure" })).toBeNull();
  expect(read({ t: "button", id: 7 })).toEqual({ t: "button", id: 7 });
  expect(read({ t: "button", id: 8 })).toBeNull();
  expect(read({ t: "trans", v: 60 })).toEqual({ t: "trans", v: 6 });
});

test("the look, the list and the playlist's items take only well-formed commands", () => {
  expect(read({ t: "step", dir: 1 })).toEqual({ t: "step", dir: 1 });
  expect(read({ t: "step", dir: 5 })).toBeNull();
  expect(read({ t: "save", name: "  dusk  " })).toEqual({ t: "save", name: "dusk" });
  expect(read({ t: "save", name: "   " })).toBeNull();
  expect(read({ t: "save", name: "x".repeat(81) })).toBeNull();
  expect(read({ t: "times", at: 2, dwell_s: 30 })).toEqual({ t: "times", at: 2, times: { dwell_s: 30 } });
  expect(read({ t: "times", at: 2 })).toBeNull();
  expect(read({ t: "times", at: -1, dwell_s: 30 })).toBeNull();
  expect(read({ t: "style", at: 0, style: "fade" })).toEqual({ t: "style", at: 0, style: "fade" });
  expect(read({ t: "style", at: 0, style: "cut" })).toBeNull();
  expect(read({ t: "add", pick: "p:12" })).toEqual({ t: "add", pick: "p:12" });
  expect(read({ t: "add", pick: "12" })).toBeNull();
  expect(read({ t: "presentation", v: "projector" })).toEqual({ t: "presentation", v: "projector" });
  expect(read({ t: "presentation", v: "cinema" })).toBeNull();
  expect(read({ t: "eval", code: "1" })).toBeNull();
  expect(read({ t: "toString" })).toBeNull();
  expect(readCommand("not json", SCHEMA)).toBeNull();
});

// A stand-in for the browser's WebSocket and the editor's host, with the clock in the test's hands.
function rig({ signedIn = true } = {}) {
  const sockets = [], ran = [], hints = [];
  let tick = null, on = true, state = { look: { name: "memories" }, params: { exposure: 0 } };
  const store = new Map();
  const host = {
    enabled: () => on, signedIn: () => signedIn, page: () => "https://komorebi.test/arboretum/remote",
    connect(query) { const ws = { query, sent: [], send(t) { this.sent.push(JSON.parse(t)); }, close() { this.closed = true; } }; sockets.push(ws); return ws; },
    schema: () => SCHEMA, state: () => state, run: (c) => ran.push(c), hint: (t) => hints.push(t), changed() {},
  };
  const remote = mountRemote(host, { storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, ua: "", every: (fn) => { tick = fn; } });
  return { remote, sockets, ran, hints, tick: () => tick(), set state(s) { state = s; }, off() { on = false; }, store };
}

test("a screen connects once it is on and signed in, and sends its board when the room asks", () => {
  const r = rig();
  r.tick();
  expect(r.sockets).toHaveLength(1);
  const ws = r.sockets[0];
  expect(ws.query).toEqual({ role: "screen", screen: expect.stringMatching(/^[a-z0-9]{16}$/), label: "a browser" });
  ws.onopen();
  ws.onmessage({ data: '{"t":"want"}' });
  expect(ws.sent.map((m) => m.t)).toEqual(["schema", "state"]);
  expect(ws.sent[1]).toEqual({ t: "state", look: { name: "memories" }, params: { exposure: 0 } });
});

test("while a phone is there, a state that moved goes as a patch; nothing goes when nothing moved", () => {
  const r = rig();
  r.tick();
  const ws = r.sockets[0];
  ws.onopen();
  ws.onmessage({ data: '{"t":"want"}' });
  ws.onmessage({ data: '{"t":"remotes","n":1}' });
  expect(r.hints).toEqual(["remote: a phone is connected"]);
  r.tick();
  expect(ws.sent).toHaveLength(2);
  r.state = { look: { name: "memories" }, params: { exposure: 0.25 } };
  r.tick();
  expect(ws.sent.at(-1)).toEqual({ t: "state", params: { exposure: 0.25 } });
  expect(r.remote.status()).toBe("on · a phone is connected");
});

test("a command runs only once the board is out, and only as readCommand has it", () => {
  const r = rig();
  r.tick();
  const ws = r.sockets[0];
  ws.onopen();
  ws.onmessage({ data: '{"t":"step","dir":1}' });
  expect(r.ran).toEqual([]);
  ws.onmessage({ data: '{"t":"want"}' });
  ws.onmessage({ data: '{"t":"step","dir":1}' });
  ws.onmessage({ data: '{"t":"param","key":"exposure","v":-9}' });
  expect(r.ran).toEqual([{ t: "step", dir: 1 }, { t: "param", key: "exposure", v: -3 }]);
});

test("a screen whose id a copied tab took comes back under a new one; off, it leaves the room", () => {
  const r = rig();
  r.tick();
  const first = r.sockets[0];
  first.onopen();
  first.onclose({ code: 4000 });
  r.tick();
  expect(r.sockets).toHaveLength(2);
  expect(r.sockets[1].query.screen).not.toBe(first.query.screen);
  expect(r.store.get("komorebi.remote.screen")).toBe(r.sockets[1].query.screen);
  r.sockets[1].onopen();
  r.off();
  r.tick();
  expect(r.sockets[1].closed).toBe(true);
  expect(r.remote.status()).toBe("off");
});

test("signed out, a screen stays out of the room and says why", () => {
  const r = rig({ signedIn: false });
  r.tick();
  expect(r.sockets).toHaveLength(0);
  expect(r.remote.status()).toBe("on · sign in to arboretum here to use it");
});
