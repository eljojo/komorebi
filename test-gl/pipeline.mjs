// Capture/storage choices leave the engine clock and scene quality to render-video.
import { deliveryArgs, DISK_MARGIN_BYTES } from './video-lib.mjs';
import { annexBMuxArgs } from './webcodecs.mjs';

export const PIPELINES = ['master', 'gpu', 'gpu-main10', 'browser'];
export function pipelinePlan({ pipeline = 'master', ow, oh, ss = 1, space = 'linear' }) {
  if (!PIPELINES.includes(pipeline)) throw new Error(`--pipeline must be ${PIPELINES.join('|')}`);
  const direct = pipeline !== 'master';
  if (direct && ![1, 2].includes(ss)) throw new Error('direct pipeline supports native size or exact 2x supersampling');
  if (direct && ss > 1 && space !== 'linear') throw new Error('direct pipeline downscale uses linear light');
  return { direct, downscale: direct && ss === 2, extension: direct ? 'mp4' : 'mkv', frameBytes: ow * oh * 4 * (direct ? 1 : ss * ss) };
}

export function directSegmentArgs({ pipeline, ow, oh, fps, trc, vtQuality, vtBitrate, gop, file, codec = 'hevc_videotoolbox' }) {
  if (pipeline === 'browser') return annexBMuxArgs({ fps, out: file, codec: 'hevc' });
  const args = deliveryArgs({ input: ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${ow}x${oh}`, '-framerate', String(fps), '-i', '-'],
    out: file, fps, trc, codec, vtQuality, vtBitrate, gop });
  const i = args.indexOf('-vf') + 1;
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
