import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { deliveryFilter, launchBrowser, masterChain } from './video-lib.mjs';
import * as codecs from './webcodecs.mjs';

// This test needs the owner's local GPU; it is deliberately separate from the CPU exporter suite.
test('GPU 2x downscale preserves orientation and linear-light edge/colour/dark averages', async () => {
  assert.equal(typeof codecs.installLinearDownscale, 'function');
  const W = 32, H = 16;
  const patterns = [
    (x, y) => (x + y) % 2 ? 255 : 0,
    (x, y, c) => c === (x + y) % 3 ? 255 : 0,
    (x, y, c) => (x * 13 + y * 19 + c * 41) % 256,
    (x, y, c) => (x * 7 + y * 3 + c) % 5,
    (x, y, c) => ((Math.floor(y / 2) * W / 2 + Math.floor(x / 2)) * 2 + c) % 256,
    (_x, y, c) => y < H / 2 ? [240, 12, 50][c] : [8, 120, 230][c],
  ];
  const b = await launchBrowser(chromium, 'chromium+angle-metal+enable-gpu');
  try {
    const page = await b.browser.newPage();
    await page.evaluate(() => { window.__v = {}; });
    await page.evaluate(codecs.installLinearDownscale, { width: W / 2, height: H / 2 });
    for (const pattern of patterns) {
      const rgb = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) rgb[(y * W + x) * 3 + c] = pattern(x, y, c);
      const expected = [];
      for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) sum += (rgb[((y * 2 + dy) * W + x * 2 + dx) * 3 + c] / 255) ** 2.2;
        expected.push(Math.round((sum / 4) ** (1 / 2.2) * 255));
      }
      const actual = await page.evaluate(([bytes, w, h]) => {
        const source = document.createElement('canvas'); source.width = w; source.height = h;
        const ctx = source.getContext('2d'), data = ctx.createImageData(w, h);
        for (let i = 0; i < bytes.length / 3; i++) { data.data.set(bytes.slice(i * 3, i * 3 + 3), i * 4); data.data[i * 4 + 3] = 255; }
        ctx.putImageData(data, 0, 0);
        const canvas = window.__v.transformCanvas(source), gl = canvas.getContext('webgl2');
        const rgba = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        const result = [];
        for (let y = canvas.height - 1; y >= 0; y--) for (let x = 0; x < canvas.width; x++) for (let c = 0; c < 3; c++) result.push(rgba[(y * canvas.width + x) * 4 + c]);
        return result;
      }, [[...rgb], W, H]);
      assert.equal(actual.length, expected.length);
      const maxFloatError = Math.max(...actual.map((v, i) => Math.abs(v - expected[i])));
      assert.ok(maxFloatError <= 1, `GPU vs float: ${maxFloatError} codes`);
      // masterChain's vflip expects bottom-up raw pixels; the fixture is top-down.
      const ff = spawnSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${W}x${H}`, '-i', '-',
        '-filter_complex', masterChain({ ow: W / 2, oh: H / 2, ss: 2, space: 'linear', master: 'raw' }).replace('vflip,', ''),
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: rgb });
      assert.equal(ff.status, 0, String(ff.stderr));
      const maxFfmpegError = Math.max(...actual.map((v, i) => Math.abs(v - ff.stdout[i])));
      assert.ok(maxFfmpegError <= 1, `GPU vs ffmpeg: ${maxFfmpegError} codes`);
      console.log(`downscale: max GPU/float ${maxFloatError} code; GPU/ffmpeg ${maxFfmpegError} codes`);
    }
    await page.evaluate(() => window.__v.closeDownscale());
    await page.close();
  } finally { await b.browser.close(); }
});

// The GPU's I420 against the CPU chain it replaces: the same output-size RGB codes (native, or the GPU downscale's own for ss 2)
// through ffmpeg's delivery conversion, plane by plane, within a code.
test('GPU YUV: BT.709 limited-range 4:2:0, top-down, within a code of ffmpeg delivery conversion, native and 2x', async () => {
  assert.equal(typeof codecs.installYuvConverter, 'function');
  const W = 32, H = 16;
  const patterns = [
    (x, y) => (x + y) % 2 ? 255 : 0,
    (x, y, c) => c === (x + y) % 3 ? 255 : 0,
    (x, y, c) => (x * 13 + y * 19 + c * 41) % 256,
    (x, y, c) => (x * 7 + y * 3 + c) % 5,
    (x, y, c) => (x * 37 + y * 101 + c * 71 + x * y) % 256,
    (_x, y, c, h) => y < h / 2 ? [240, 12, 50][c] : [8, 120, 230][c],
  ];
  const b = await launchBrowser(chromium, 'chromium+angle-metal+enable-gpu');
  try {
    const page = await b.browser.newPage();
    await page.evaluate(() => { window.__v = {}; });
    // draws top-down rgb24 into a 2D canvas, runs the installed transform, returns the bytes readPixels gives, in memory order
    const through = (bytes, w, h) => page.evaluate(([bytes, w, h]) => {
      const source = document.createElement('canvas'); source.width = w; source.height = h;
      const ctx = source.getContext('2d'), data = ctx.createImageData(w, h);
      for (let i = 0; i < bytes.length / 3; i++) { data.data.set(bytes.slice(i * 3, i * 3 + 3), i * 4); data.data[i * 4 + 3] = 255; }
      ctx.putImageData(data, 0, 0);
      const canvas = window.__v.transformCanvas(source), gl = canvas.getContext('webgl2');
      const out = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [...out];
    }, [[...bytes], w, h]);
    for (const ss of [1, 2]) {
      for (const pattern of patterns) {
        const SW = W * ss, SH = H * ss, src = Buffer.alloc(SW * SH * 3);
        for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) for (let c = 0; c < 3; c++) src[(y * SW + x) * 3 + c] = pattern(x, y, c, SH);
        let rgb = src;
        if (ss === 2) {   // what the CPU chain is given today: the GPU downscale's RGBA, read bottom-up, made top-down rgb24
          await page.evaluate(codecs.installLinearDownscale, { width: W, height: H });
          const rgba = await through(src, SW, SH);
          await page.evaluate(() => window.__v.closeDownscale());
          rgb = Buffer.alloc(W * H * 3);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) rgb[(y * W + x) * 3 + c] = rgba[((H - 1 - y) * W + x) * 4 + c];
        }
        const ff = spawnSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${W}x${H}`, '-i', '-',
          '-vf', deliveryFilter({ fps: 60, trc: 'bt709' }), '-frames:v', '1', '-f', 'rawvideo', '-'], { input: rgb });
        assert.equal(ff.status, 0, String(ff.stderr));
        assert.equal(ff.stdout.length, W * H * 3 / 2);
        await page.evaluate(codecs.installYuvConverter, { width: W, height: H, ss });
        const yuv = await through(src, SW, SH);
        await page.evaluate(() => window.__v.closeYuv());
        assert.equal(yuv.length, W * H * 3 / 2, 'the readback is the I420 frame, nothing more');
        const planes = { Y: [0, W * H], Cb: [W * H, W * H * 5 / 4], Cr: [W * H * 5 / 4, W * H * 3 / 2] };
        const worst = Object.fromEntries(Object.entries(planes).map(([name, [a, z]]) => [name, Math.max(...yuv.slice(a, z).map((v, i) => Math.abs(v - ff.stdout[a + i])))]));
        console.log(`yuv ss ${ss}: max |GPU - ffmpeg| Y ${worst.Y}, Cb ${worst.Cb}, Cr ${worst.Cr} codes`);
        for (const [name, err] of Object.entries(worst)) assert.ok(err <= 1, `${name}: GPU vs ffmpeg ${err} codes (ss ${ss})`);
      }
    }
    await page.close();
  } finally { await b.browser.close(); }
});
