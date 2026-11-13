// Capture/storage choices leave the engine clock and scene quality to render-video.
// The four capture plans (--pipeline master|gpu|gpu-main10|browser), output-sized VideoToolbox or VA-API commands (Main8, or
// direct P010/Main10), browser HEVC muxing, delivery stream copy and encoded disk budgeting. VA-API uses fixed 60M/75M/120M rate
// control and hardware surfaces on renderD128; its encoder and device are recorded in provenance and in direct run keys.
// pipeline.test.mjs holds the commands and refusals on the CPU; pipeline-gpu.test.mjs (Mac) and vaapi-gpu.test.mjs (Linux AMD)
// interrupt after one segment, resume the saved state and check frame counts, dimensions, colour tags, Main10 and that a
// completed run is skipped.
import { deliveryArgs, deliveryTags, DISK_MARGIN_BYTES, INDEX_PTS } from './video-lib.mjs';
import { annexBMuxArgs } from './webcodecs.mjs';

export const PIPELINES = ['master', 'gpu', 'gpu-main10', 'browser'];
// yuv 'gpu', the gpu pipeline's default: it reads back I420 that installYuvConverter made, 1.5 bytes a pixel instead of RGBA's 4,
// so the readback, the sink and ffmpeg's colour conversion stop costing the CPU per pixel; the output is within a code of ffmpeg's.
// yuv 'cpu' (--cpu-yuv, and every other pipeline) reads back RGBA and lets ffmpeg convert, as before. The I420 rows pack into RGBA8
// texels, so a width not divisible by 4 falls back to 'cpu': decided by the size alone, never by timing, so a resume decides the same.
export function pipelinePlan({ pipeline = 'master', ow, oh, ss = 1, space = 'linear', yuv }) {
  if (!PIPELINES.includes(pipeline)) throw new Error(`--pipeline must be ${PIPELINES.join('|')}`);
  if (yuv !== undefined && !['cpu', 'gpu'].includes(yuv)) throw new Error('yuv must be cpu|gpu');
  const direct = pipeline !== 'master';
  if (direct && ![1, 2].includes(ss)) throw new Error('direct pipeline supports native size or exact 2x supersampling');
  if (direct && ss > 1 && space !== 'linear') throw new Error('direct pipeline downscale uses linear light');
  if (yuv && pipeline !== 'gpu') throw new Error('choosing where YUV is converted is for --pipeline gpu only');
  if (yuv === 'gpu' && (ow % 4 || oh % 2)) throw new Error('GPU YUV conversion needs a width divisible by 4 and an even height');
  yuv ??= pipeline === 'gpu' && ow % 4 === 0 && oh % 2 === 0 ? 'gpu' : 'cpu';
  const frameBytes = yuv === 'gpu' ? ow * oh * 3 / 2 : ow * oh * 4 * (direct ? 1 : ss * ss);
  return { direct, yuv, downscale: direct && ss === 2, extension: direct ? 'mp4' : 'mkv', frameBytes };
}

export function directSegmentArgs({ pipeline, ow, oh, fps, trc, vtQuality, vtBitrate, gop, file, codec = 'hevc_videotoolbox', input = 'rgba' }) {
  if (pipeline === 'browser') return annexBMuxArgs({ fps, out: file, codec: 'hevc' });
  const args = deliveryArgs({ input: ['-f', 'rawvideo', '-pix_fmt', input, '-s', `${ow}x${oh}`, '-framerate', String(fps), '-i', '-'],
    out: file, fps, trc, codec, vtQuality, vtBitrate, gop });
  const i = args.indexOf('-vf') + 1;
  // GPU YUV arrives top-down and already BT.709 limited-range I420: tag it and encode it, no flip and no swscale conversion
  if (input === 'yuv420p') { args[i] = `${INDEX_PTS(fps)},${deliveryTags(trc)}${codec === 'hevc_vaapi' ? ',format=nv12,hwupload' : ''}`; return args; }
  args[i] = `vflip,${args[i]}`;
  if (pipeline === 'gpu-main10') {
    args[i] = args[i].replace(codec === 'hevc_vaapi' ? 'format=nv12' : 'format=yuv420p', 'format=p010le');
    args[args.indexOf('-profile:v') + 1] = 'main10';
    // VAAPI encoders consume hardware surfaces; P010 is selected before hwupload.
    if (codec !== 'hevc_vaapi') args.splice(args.indexOf('-profile:v'), 0, '-pix_fmt', 'p010le');
  }
  return args;
}

export function directJoinArgs({ input, out, fps }) {
  return ['-hide_banner', '-nostats', '-y', ...input, '-an', '-c:v', 'copy', '-tag:v', 'hvc1',
    '-video_track_timescale', String(fps), '-movflags', '+faststart', '-f', 'mp4', out];
}

export function directDiskPlan({ framesToRender, frames, fps, mbit }) {
  const bytesPerSecond = mbit * 1e6 / 8;
  const segments = framesToRender / fps * bytesPerSecond, delivery = frames / fps * bytesPerSecond;
  return { segments, delivery, merged: 0, margin: DISK_MARGIN_BYTES, total: segments + delivery + DISK_MARGIN_BYTES };
}
