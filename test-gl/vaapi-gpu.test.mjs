// Linux AMD GPU checks, separate from the CPU suite. Run under komorebi-render's Nix shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countFrames, ffprobeJson } from './video-lib.mjs';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
function run(args) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ARBORETUM_TOKEN;
    const child = spawn(process.execPath, ['test-gl/render-video.mjs', ...args], { env, detached: true });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      // An injected SIGKILL skips the exporter's cleanup; terminate only this test's remaining children.
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') return reject(error); }
      resolve({ code, signal, output });
    });
  });
}

for (const [pipeline, size, ss] of [
  ['master', '1920x1080', 1],
  ['gpu', '1920x1080', 2],
  ['gpu-main10', '1920x1080', 1],
  ['gpu-main10', '3840x2160', 1],
]) {
  test(`VAAPI ${pipeline} ${size} ss${ss} resumes and verifies hardware HEVC`, { timeout: 240000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'komorebi-vaapi-'));
    const look = join(root, 'look-input.json'), out = join(root, 'run');
    mkdirSync(out);
    writeFileSync(look, JSON.stringify({ params: { wind_strength: 1.3 } }));
    const args = ['--look-json', look, '--commit', commit, '--out', out, '--pipeline', pipeline,
      '--chrome', 'chromium+angle-vulkan+enable-gpu', '--delivery', 'hevc_vaapi', '--size', size,
      '--ss', String(ss), '--seconds', '2', '--fps', '30', '--preroll', '1', '--segment-seconds', '1'];
    if (size === '3840x2160') args.push('--set', 'tex_resolution=4096', '--set', 'bake_resolution=0', '--set', 'sample_count=48');
    if (pipeline === 'master') args.push('--discard-master');

    const interrupted = await run([...args, '--abort-after-seg', '1']);
    assert.equal(interrupted.signal, 'SIGKILL', interrupted.output);
    const first = readFileSync(join(out, 'seg/seg_00000.json'), 'utf8');
    const resumed = await run(args);
    assert.equal(resumed.code, 0, resumed.output);
    assert.match(resumed.output, /resuming at segment 1\/2/);
    assert.equal(readFileSync(join(out, 'seg/seg_00000.json'), 'utf8'), first);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    const stream = ffprobeJson(join(out, 'delivery.mp4')).streams[0];
    assert.equal(countFrames(join(out, 'delivery.mp4')), 60);
    assert.equal(stream.codec_name, 'hevc');
    assert.equal(stream.codec_tag_string, 'hvc1');
    assert.equal(stream.r_frame_rate, '30/1');
    assert.deepEqual([stream.width, stream.height], size.split('x').map(Number));
    assert.equal(stream.profile, pipeline === 'gpu-main10' ? 'Main 10' : 'Main');
    assert.equal(stream.pix_fmt, pipeline === 'gpu-main10' ? 'yuv420p10le' : 'yuv420p');
    assert.equal(stream.color_space, 'bt709');
    assert.equal(stream.color_range, 'tv');
    assert.equal(manifest.frame_accounting.exact, true);
    assert.equal(manifest.delivery.encoder, 'hevc_vaapi');
    assert.equal(manifest.delivery.vaapi_device, '/dev/dri/renderD128');
    assert.equal(manifest.delivery.bitrate_arg, '60M');
    assert.equal(manifest.delivery.maxrate_arg, '75M');
    assert.match(manifest.renderer, /AMD Radeon RX 6800 XT/);
    if (pipeline === 'master') assert.match(manifest.ffmpeg.delivery_command_as_run, /-c:v hevc_vaapi/);
    else {
      assert.ok(manifest.encoded_segments.segments.every(segment => segment.sha256));
      assert.ok(JSON.parse(first).ffmpeg_args.includes('hevc_vaapi'));
      assert.match(manifest.ffmpeg.delivery_command_as_run, /-c:v copy/);
      const key = JSON.parse(readFileSync(join(out, 'run-key.json'), 'utf8'));
      assert.equal(key.body.delivery_settings.encoder, 'hevc_vaapi');
    }
    assert.ok(!readdirSync(join(out, 'seg')).some(file => /\.(mp4|mkv)$/.test(file)));
    const complete = await run(args);
    assert.equal(complete.code, 0, complete.output);
    assert.match(complete.output, /already complete/);
    console.log(`${pipeline} ${size} ss${ss}: 60 decoded frames, ${stream.profile}, resumed segment preserved; ${out}`);
  });
}
