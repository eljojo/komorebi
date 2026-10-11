// Local Mac GPU checks, separate from the CPU suite: interruption, recovery and final MP4 verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countFrames, ffprobeJson } from './video-lib.mjs';

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['test-gl/render-video.mjs', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (b) => { output += b; });
    child.stderr.on('data', (b) => { output += b; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, output }));
  });
}
for (const [pipeline, ss] of [['master', 1], ['gpu', 1], ['gpu', 2], ['gpu-main10', 2], ['browser', 1], ['browser', 2]]) {
  test(`${pipeline} ss${ss} resumes a committed segment and verifies the exact delivery`, { timeout: 120000 }, async () => {
    const root = mkdtempSync('test-gl/out/pipeline-check-');
    const look = join(root, 'look-input.json'), out = join(root, 'run');
    writeFileSync(look, JSON.stringify({ params: { wind_strength: 1.3 } }));
    const args = ['--look-json', look, '--commit', '6d3ee0ad83c0f5254f2ef2045037b732c3197fbf', '--out', out,
      '--pipeline', pipeline, '--seconds', '2', '--fps', '30', '--size', '128x72', '--ss', String(ss),
      '--preroll', '1', '--segment-seconds', '1'];
    if (pipeline !== 'browser' || ss !== 1) args.push('--chrome', 'chromium+angle-metal+enable-gpu');
    if (pipeline !== 'browser') args.push('--vt-quality', '100');
    if (pipeline === 'master') args.push('--discard-master');
    const interrupted = await run([...args, '--abort-after-seg', '1']);
    assert.equal(interrupted.signal, 'SIGKILL', interrupted.output);
    const first = readFileSync(join(out, 'seg/seg_00000.json'), 'utf8');
    const resumed = await run(args);
    assert.equal(resumed.code, 0, resumed.output);
    assert.match(resumed.output, /resuming at segment 1\/2/);
    assert.equal(readFileSync(join(out, 'seg/seg_00000.json'), 'utf8'), first);
    assert.equal(countFrames(join(out, 'delivery.mp4')), 60);
    const stream = ffprobeJson(join(out, 'delivery.mp4')).streams[0];
    assert.equal(stream.width, 128); assert.equal(stream.height, 72);
    assert.equal(stream.r_frame_rate, '30/1');
    assert.ok(Math.abs(Number(stream.duration) - 2) < 1 / 30);
    assert.equal(stream.color_space, 'bt709');
    assert.equal(stream.color_range, 'tv');
    if (pipeline === 'gpu-main10') { assert.equal(stream.profile, 'Main 10'); assert.equal(stream.pix_fmt, 'yuv420p10le'); }
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json')));
    assert.equal(manifest.frame_accounting.exact, true);
    assert.deepEqual(manifest.output.render_size, [128 * ss, 72 * ss]);
    if (pipeline !== 'master') {
      assert.equal(manifest.pipeline, pipeline); assert.equal(manifest.master, null); assert.equal(manifest.hashes, null);
      assert.equal(manifest.encoded_segments.segments.length, 2);
      assert.ok(manifest.encoded_segments.segments.every((s) => s.sha256));
    }
    assert.ok(!readdirSync(join(out, 'seg')).some((f) => /\.(mp4|mkv)$/.test(f)));
    assert.ok(existsSync(join(out, 'ckpt/ckpt_000000060.json')));
    const complete = await run(args);
    assert.equal(complete.code, 0, complete.output);
    assert.match(complete.output, /already complete/);
    console.log(`${pipeline} ss${ss}: 60 frames, resumed segment preserved, complete rerun skipped; ${out}`);
  });
}
