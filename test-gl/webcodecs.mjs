// The probe's direct canvas encoder. Playwright serializes encodeCanvasRun into the existing video page;
// it must depend only on browser globals, never imports or variables in this module's scope.
export function avcConfig({ width, height, fps, bitrate }) {
  return { codec: 'avc1.640034', width, height, framerate: fps, bitrate,
    hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality', bitrateMode: 'variable',
    avc: { format: 'annexb' } };
}

export function hevcConfig(options) {
  const config = avcConfig(options);
  delete config.avc;
  return { ...config, codec: 'hvc1.1.6.H156.B0', hevc: { format: 'annexb' } };
}

export function annexBMuxArgs({ fps, out, codec = 'h264' }) {
  return ['-hide_banner', '-nostats', '-y', '-fflags', '+genpts', '-f', codec, '-framerate', String(fps), '-i', '-',
    '-an', '-c:v', 'copy', '-bsf:v', `setts=pts=N:dts=N:duration=1:time_base=1/${fps}`, '-video_track_timescale', String(fps),
    ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []), '-movflags', '+faststart', '-f', 'mp4', out];
}

export async function encodeCanvasRun({ config, from, to, sink, queueLimit = 4 }) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('WebCodecs is not supported in this browser');
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`WebCodecs ${config.codec} is not supported at ${config.width}x${config.height}`);
  let failure = null, chunks = 0, bytes = 0, buffered = 0, metadata = null;
  const pending = [], stamps = [];
  let wake = null;
  const encoder = new VideoEncoder({
    output(chunk, info) {
      // Raw Annex B carries no presentation timestamps. Refuse reordering or gaps rather than assigning
      // plausible CFR stamps to the wrong pictures when ffmpeg muxes it.
      const expected = Math.round(chunks * 1e6 / config.framerate);
      if (chunk.timestamp !== expected) failure = new Error(`encoded timestamp ${chunk.timestamp}, expected ${expected}; raw Annex B cannot retain reordered timestamps`);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      pending.push(data); buffered += data.byteLength; bytes += data.byteLength;
      stamps.push(chunk.timestamp); chunks++;
      if (info?.decoderConfig) metadata = info.decoderConfig;
      if (failure) wake?.();
    },
    error(error) { failure = error; wake?.(); },
  });
  const check = () => { if (failure) throw failure; };
  const send = async () => {
    check();
    if (!pending.length) return;
    const body = new Blob(pending.splice(0)); buffered = 0;
    const response = await fetch(sink, { method: 'POST', body });
    if (!response.ok) throw new Error(`encoded sink ${response.status}`);
  };
  const ready = async () => {
    check();
    while (encoder.encodeQueueSize >= queueLimit) {
      await new Promise((resolve) => {
        wake = resolve;
        encoder.addEventListener('dequeue', resolve, { once: true });
      });
      wake = null; check();
    }
    if (buffered >= 1 << 20) await send();
  };
  const now = window.__clock?.realNow ?? (() => performance.now());
  const started = now();
  try {
    encoder.configure(support.config);
    const result = await window.__v.runCanvas({ from, to, beforeFrame: ready, onFrame(canvas, i) {
      const timestamp = Math.round(i * 1e6 / config.framerate);
      const duration = Math.round((i + 1) * 1e6 / config.framerate) - timestamp;
      const frame = new VideoFrame(canvas, { timestamp, duration, alpha: 'discard' });
      try { encoder.encode(frame, { keyFrame: i % (config.framerate * 2) === 0 }); }
      finally { frame.close(); }
    } });
    await encoder.flush(); check();
    await send();
    if (result.pumped !== to - from || chunks !== to - from) throw new Error(`encoded ${chunks} chunks for ${to - from} frames`);
    return { frames: result.pumped, chunks, bytes, timestamps: stamps, config: support.config, decoder_config: metadata, wall_ms: now() - started };
  } finally { encoder.close(); }
}
