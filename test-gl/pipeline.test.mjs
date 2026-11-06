import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const lib = await import('./pipeline.mjs').catch(() => ({}));
const base = { ow: 1920, oh: 1080, fps: 60, ss: 2, space: 'linear', trc: 'bt709', vtQuality: '100', vtBitrate: '60M', gop: 120 };

test('four pipeline plans preserve the requested render size and distinguish lossless storage', () => {
  for (const pipeline of ['master', 'gpu', 'gpu-main10', 'browser']) {
    const p = lib.pipelinePlan({ ...base, pipeline });
    assert.equal(p.direct, pipeline !== 'master');
    assert.equal(p.frameBytes, (pipeline === 'master' ? 3840 * 2160 : 1920 * 1080) * 4);
    assert.equal(p.extension, pipeline === 'master' ? 'mkv' : 'mp4');
  }
  assert.equal(lib.pipelinePlan({ ...base, pipeline: 'gpu', ss: 1 }).downscale, false);
  assert.equal(lib.pipelinePlan({ ...base, pipeline: 'gpu' }).downscale, true);
});

test('GPU delivery goes directly from output-sized RGBA to HEVC, with Main10 converting directly to P010', () => {
  for (const pipeline of ['gpu', 'gpu-main10']) {
    const argv = lib.directSegmentArgs({ ...base, pipeline, file: 'seg.mp4' });
    assert.equal(argv[argv.indexOf('-s') + 1], '1920x1080');
    assert.equal(argv[argv.indexOf('-profile:v') + 1], pipeline === 'gpu' ? 'main' : 'main10');
    assert.match(argv[argv.indexOf('-vf') + 1], /^vflip,/);
    assert.match(argv[argv.indexOf('-vf') + 1], pipeline === 'gpu' ? /format=yuv420p/ : /format=p010le/);
    assert.ok(!argv.includes('ffv1'));
  }
});

test('browser segments mux native HEVC without a second encode or pixel conversion', () => {
  const argv = lib.directSegmentArgs({ ...base, pipeline: 'browser', file: 'seg.mp4' });
  assert.equal(argv[argv.indexOf('-c:v') + 1], 'copy');
  assert.equal(argv[argv.indexOf('-f') + 1], 'hevc');
  assert.ok(!argv.includes('-vf'));
});

test('VAAPI direct segments upload NV12 or P010 and select Main8 or Main10 hardware encoding', () => {
  for (const pipeline of ['gpu', 'gpu-main10']) {
    const args = lib.directSegmentArgs({ ...base, vtQuality: undefined, codec: 'hevc_vaapi', pipeline, file: 'seg.mp4' });
    assert.equal(args[args.indexOf('-c:v') + 1], 'hevc_vaapi');
    assert.equal(args[args.indexOf('-vaapi_device') + 1], '/dev/dri/renderD128');
    assert.match(args[args.indexOf('-vf') + 1], /^vflip,/);
    assert.match(args[args.indexOf('-vf') + 1], pipeline === 'gpu' ? /format=nv12,hwupload$/ : /format=p010le,hwupload$/);
    assert.equal(args[args.indexOf('-profile:v') + 1], pipeline === 'gpu' ? 'main' : 'main10');
    assert.deepEqual(args.flatMap((arg, i) => arg === '-pix_fmt' ? [args[i + 1]] : []), ['rgba']);
  }
});

test('the exporter passes VAAPI to master and direct pipelines and stream-copies direct deliveries', () => {
  for (const pipeline of ['master', 'gpu', 'gpu-main10']) {
    const r = spawnSync(process.execPath, ['test-gl/render-video.mjs', '--look-json', '/missing.json', '--tree',
      '--out', '/missing-output', '--delivery', 'hevc_vaapi', '--pipeline', pipeline, '--print-ffmpeg'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const printed = JSON.parse(r.stdout);
    const encoded = pipeline === 'master' ? printed.delivery : printed.segment;
    assert.equal(encoded[encoded.indexOf('-c:v') + 1], 'hevc_vaapi');
    if (pipeline !== 'master') assert.equal(printed.delivery[printed.delivery.indexOf('-c:v') + 1], 'copy');
  }
});

test('delivery joins encoded segments without a second lossy encode', () => {
  const argv = lib.directJoinArgs({ input: ['-f', 'concat', '-safe', '0', '-i', 'seg/list.txt'], out: 'delivery.mp4.part', fps: 60 });
  assert.equal(argv[argv.indexOf('-c:v') + 1], 'copy');
  assert.equal(argv[argv.indexOf('-f', argv.indexOf('-c:v')) + 1], 'mp4');
  assert.ok(argv.includes('+faststart'));
});

test('direct disk planning budgets two encoded copies rather than lossless master storage', () => {
  const p = lib.directDiskPlan({ framesToRender: 600, frames: 1800, fps: 60, mbit: 160 });
  assert.equal(p.segments, 200e6);
  assert.equal(p.delivery, 600e6);
  assert.equal(p.total, 1800e6);
});

test('unsupported direct settings are refused before opening a browser', () => {
  for (const options of [{ pipeline: 'unknown' }, { pipeline: 'gpu', ss: 3 }, { pipeline: 'gpu', space: 'gamma' }]) {
    assert.throws(() => lib.pipelinePlan({ ...base, ...options }), /pipeline|2x|linear/);
  }
  for (const flag of ['--measure', '--encode-only', '--merge-master', '--drop-segments', '--stills']) {
    const r = spawnSync(process.execPath, ['test-gl/render-video.mjs', '--look-json', '/missing.json', '--tree', '--out', '/missing-output', '--pipeline', 'gpu', flag, '1'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /pipeline.*incompatible|incompatible.*pipeline/);
    assert.doesNotMatch(r.stderr, /ENOENT/);
  }
});
