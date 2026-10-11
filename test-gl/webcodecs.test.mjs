import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const lib = await import('./webcodecs.mjs').catch(() => ({}));

test('AVC configuration requests high quality and Annex B at the actual canvas size', () => {
  const c = lib.avcConfig({ width: 3840, height: 2160, fps: 60, bitrate: 120e6 });
  assert.equal(c.codec, 'avc1.640034');
  assert.equal(c.width, 3840);
  assert.equal(c.height, 2160);
  assert.equal(c.bitrate, 120e6);
  assert.equal(c.hardwareAcceleration, 'prefer-hardware');
  assert.equal(c.latencyMode, 'quality');
  assert.deepEqual(c.avc, { format: 'annexb' });
});

test('HEVC configuration uses Annex B and a high tier for high bitrate 4K exports', () => {
  const c = lib.hevcConfig({ width: 3840, height: 2160, fps: 60, bitrate: 240e6 });
  assert.equal(c.codec, 'hvc1.1.6.H156.B0');
  assert.deepEqual(c.hevc, { format: 'annexb' });
  assert.equal(c.avc, undefined);
  assert.equal(c.hardwareAcceleration, 'prefer-hardware');
});

test('Annex B MP4 muxing retains every decoded frame and exact CFR duration without encoding again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-avc-'));
  try {
    const raw = join(dir, 'input.h264'), out = join(dir, 'output.mp4');
    const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=60', '-frames:v', '12', '-c:v', 'libx264', '-bf', '0', '-f', 'h264', '-']);
    assert.equal(encoded.status, 0, String(encoded.stderr));
    writeFileSync(raw, encoded.stdout);
    const mux = spawnSync('ffmpeg', lib.annexBMuxArgs({ fps: 60, out }).map((s) => s === '-' ? raw : s));
    assert.equal(mux.status, 0, String(mux.stderr));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames,r_frame_rate,duration', '-of', 'json', out], { encoding: 'utf8' });
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.codec_name, 'h264');
    assert.equal(Number(stream.nb_read_frames), 12);
    assert.equal(stream.r_frame_rate, '60/1');
    assert.equal(Number(stream.duration), 0.2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HEVC Annex B muxing preserves frames and creates an Apple-compatible hvc1 MP4', () => {
  const dir = mkdtempSync(join(tmpdir(), 'komorebi-hevc-'));
  try {
    const raw = join(dir, 'input.hevc'), out = join(dir, 'output.mp4');
    const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=60', '-frames:v', '12', '-c:v', 'libx265', '-x265-params', 'bframes=0:log-level=error:pools=1', '-f', 'hevc', '-']);
    assert.equal(encoded.status, 0, String(encoded.stderr));
    writeFileSync(raw, encoded.stdout);
    const mux = spawnSync('ffmpeg', lib.annexBMuxArgs({ fps: 60, out, codec: 'hevc' }).map((s) => s === '-' ? raw : s));
    assert.equal(mux.status, 0, String(mux.stderr));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,codec_tag_string,nb_read_frames,duration', '-of', 'json', out], { encoding: 'utf8' });
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.codec_name, 'hevc');
    assert.equal(stream.codec_tag_string, 'hvc1');
    assert.equal(Number(stream.nb_read_frames), 12);
    assert.equal(Number(stream.duration), 0.2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function browser({ supported = true, failSend = false, missing = false, reorder = false } = {}) {
  const frames = [], packets = [], posts = [], events = [];
  class Frame {
    constructor(canvas, init) { assert.equal(canvas.width, 1920); Object.assign(this, init); frames.push(this); }
    close() { this.closed = true; }
  }
  class Encoder extends EventTarget {
    static async isConfigSupported(config) { return { supported, config }; }
    constructor(callbacks) { super(); this.callbacks = callbacks; this.encodeQueueSize = 0; }
    configure(config) { this.config = config; }
    encode(frame, options) {
      assert.equal(frame.closed, undefined);
      events.push(options.keyFrame);
      this.encodeQueueSize++;
      const timestamp = reorder ? -frame.timestamp : frame.timestamp;
      setImmediate(() => {
        if (!missing) {
          const data = new Uint8Array([0, 0, 0, 1, packets.length]);
          packets.push(timestamp);
          this.callbacks.output({ timestamp, byteLength: data.length, copyTo: (to) => to.set(data) }, { decoderConfig: { colorSpace: { matrix: 'bt709' } } });
        }
        this.encodeQueueSize--;
        this.dispatchEvent(new Event('dequeue'));
      });
    }
    async flush() { while (this.encodeQueueSize) await new Promise((r) => setImmediate(r)); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({ VideoEncoder: Encoder, VideoFrame: Frame, Blob, Uint8Array, Error, Math, Promise,
    performance: { now: () => Date.now() },
    fetch: async (url, options) => { posts.push({ url, bytes: new Uint8Array(await options.body.arrayBuffer()) }); return { ok: !failSend, status: failSend ? 503 : 200 }; },
    window: { __v: { runCanvas: async ({ from, to, beforeFrame, onFrame }) => {
      for (let n = from; n < to; n++) { await beforeFrame(); onFrame({ width: 1920, height: 1080 }, n - from); }
      return { pumped: to - from };
    } } },
  });
  return { frames, packets, posts, events, run: (args) => vm.runInContext(`(${lib.encodeCanvasRun.toString()})`, context)(args) };
}
const args = { from: 1800, to: 1812, sink: '/__sink/encoded', config: { width: 1920, height: 1080, framerate: 60 }, queueLimit: 2 };

test('canvas encoding closes frames, drains native output and sends only compressed bytes in order', async () => {
  const b = browser();
  const r = await b.run(args);
  assert.equal(r.frames, 12);
  assert.equal(r.chunks, 12);
  assert.equal(r.bytes, 60);
  assert.deepEqual(b.packets, Array.from({ length: 12 }, (_, i) => Math.round(i * 1e6 / 60)));
  assert.ok(b.frames.every((f) => f.closed));
  assert.equal(b.frames[0].duration, 16667);
  assert.equal(b.frames[1].duration, 16666);
  const bytes = b.posts.flatMap((p) => [...p.bytes]);
  assert.deepEqual(bytes.filter((_, i) => i % 5 === 4), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(b.events[0], true);
  assert.ok(b.events.slice(1).every((v) => !v));
});

test('unsupported browser codecs refuse before any frames are rendered', async () => {
  const b = browser({ supported: false });
  await assert.rejects(b.run(args), /not supported/);
  assert.equal(b.frames.length, 0);
});

test('failed compressed transfer is surfaced and every captured frame is closed', async () => {
  const b = browser({ failSend: true });
  await assert.rejects(b.run(args), /503/);
  assert.ok(b.frames.every((f) => f.closed));
});

test('missing encoded frames cannot be reported as a complete export', async () => {
  const b = browser({ missing: true });
  await assert.rejects(b.run(args), /frames/);
});

test('reordered output refuses raw Annex B muxing that would lose presentation timestamps', async () => {
  const b = browser({ reorder: true });
  await assert.rejects(b.run(args), /timestamp/);
});

test('the existing video page exposes canvas capture inside onFrame, using the same deterministic clock', async () => {
  const html = readFileSync(new URL('./video.html', import.meta.url), 'utf8');
  const script = html.split('<script type="module">')[1].split('</script>')[0].replace(/^import .*;\n/gm, '');
  const engine = { params: { adaptive_motion: false, auto_quality: false }, perf: { auto: false },
    gl: { getExtension: () => null, getParameter: () => 'test renderer', drawingBufferWidth: 2, drawingBufferHeight: 2 },
  };
  const stamps = [], canvases = [];
  const context = vm.createContext({ create: (canvas) => { canvases.push(canvas); return engine; }, DEFAULTS: {},
    performance: { now: () => 0 },
    document: { createElement: () => ({ style: {}, addEventListener: () => {} }), body: { appendChild: () => {} } },
    window: { devicePixelRatio: 1, __clock: { realNow: () => 0, drain: () => {}, set: () => {}, pump: (stamp) => { stamps.push(stamp); engine.onFrame(); return 1; } } },
  });
  vm.runInContext(script, context);
  const v = context.window.__v;
  v.open({ params: {}, rw: 2, rh: 2, step: 16, T0: 100, at: 5 });
  const captured = [];
  const callback = (canvas, i) => captured.push({ canvas, i });
  const r = await v.runCanvas({ from: 5, to: 8, beforeFrame: async () => {}, onFrame: callback });
  assert.equal(r.pumped, 3);
  assert.deepEqual(stamps, [196, 212, 228]);
  assert.deepEqual(captured.map((f) => f.i), [0, 1, 2]);
  assert.ok(captured.every((f) => f.canvas === canvases[0]));
});

test('a delayed context-loss event from a disposed canvas does not invalidate its replacement', async () => {
  const html = readFileSync(new URL('./video.html', import.meta.url), 'utf8');
  const script = html.split('<script type="module">')[1].split('</script>')[0].replace(/^import .*;\n/gm, '');
  const canvases = [];
  let engine;
  const context = vm.createContext({ create: () => {
    engine = { params: { adaptive_motion: false, auto_quality: false }, perf: { auto: false }, setPaused: () => {}, dispose: () => {},
      gl: { getExtension: () => null, getParameter: () => 'test renderer', drawingBufferWidth: 2, drawingBufferHeight: 2 } };
    return engine;
  }, DEFAULTS: {}, performance: { now: () => 0 },
  document: { createElement: () => { const c = { style: {}, remove: () => {}, addEventListener: (_, fn) => { c.lost = fn; } }; canvases.push(c); return c; }, body: { appendChild: () => {} } },
  window: { devicePixelRatio: 1, __clock: { realNow: () => 0, drain: () => {}, set: () => {}, pump: () => { engine.onFrame(); return 1; } } } });
  vm.runInContext(script, context);
  const v = context.window.__v;
  const open = () => v.open({ params: {}, rw: 2, rh: 2, step: 16, T0: 100, at: 0 });
  open(); open();
  canvases[0].lost();
  const r = await v.runCanvas({ from: 0, to: 1, beforeFrame: async () => {}, onFrame: () => {} });
  assert.equal(r.pumped, 1);
  canvases[1].lost();
  await assert.rejects(v.runCanvas({ from: 1, to: 2, beforeFrame: async () => {}, onFrame: () => {} }), /webglcontextlost/);
});
