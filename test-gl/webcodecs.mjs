// The probe's direct canvas encoder. Playwright serializes encodeCanvasRun into the existing video page;
// it must depend only on browser globals, never imports or variables in this module's scope.
// It snapshots inside the page's frame callback, closes each native frame, bounds the encoder queue and the compressed
// transfer, and muxes Annex B into MP4 without re-encoding. The optional WebGL2 downscale averages a 2x2 box in linear light
// (the engine's gamma 2.2); raw capture reads only that output for HEVC quality-100, with no lossless intermediate. Completed
// POSTs release their Blobs through the page's exposed GC. Packet stamps are exact CFR; reordered or missing frames refuse
// completion. webcodecs.test.mjs exercises capture, queue and transfer failures and real AVC/HEVC muxing on the CPU;
// webcodecs-gpu.test.mjs checks colours, orientation and dark values against float and the 16-bit FFmpeg chain.
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

export function hevcQuantizerConfig(options) {
  const config = hevcConfig(options);
  delete config.bitrate;
  return { ...config, bitrateMode: 'quantizer' };
}

export function annexBMuxArgs({ fps, out, codec = 'h264' }) {
  return ['-hide_banner', '-nostats', '-y', '-fflags', '+genpts', '-f', codec, '-framerate', String(fps), '-i', '-',
    '-an', '-c:v', 'copy', '-bsf:v', `setts=pts=N:dts=N:duration=1:time_base=1/${fps}`, '-video_track_timescale', String(fps),
    ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []), '-movflags', '+faststart', '-f', 'mp4', out];
}

// Serialized into the browser like encodeCanvasRun. The engine's display codes use pow(1/2.2),
// so a normal canvas resize averages the wrong quantity. Keep the 2x2 box in linear light.
export function installLinearDownscale({ width, height }) {
  window.__v.closeDownscale?.();
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const gl = canvas.getContext('webgl2', { alpha: false, premultipliedAlpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error('GPU downscale needs WebGL2');
  const compile = (type, text) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, `#version 300 es
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`);
  const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    precision highp int;
    uniform highp sampler2D image;
    out vec4 colour;
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy) * 2;
      vec3 light = vec3(0.0);
      for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++)
        light += pow(texelFetch(image, p + ivec2(x,y), 0).rgb, vec3(2.2));
      vec3 code = floor(pow(light * 0.25, vec3(1.0/2.2)) * 255.0 + 0.5) / 255.0;
      colour = vec4(code, 1.0);
    }`);
  const program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program); gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
  gl.disable(gl.DITHER); gl.disable(gl.BLEND);
  const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
  for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width * 2, height * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.viewport(0, 0, width, height);
  window.__v.transformCanvas = (source) => {
    if (source.width !== width * 2 || source.height !== height * 2) throw new Error('GPU downscale requires an exact 2x canvas');
    if (gl.isContextLost()) throw new Error('GPU downscale context lost');
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return canvas;
  };
  window.__v.closeDownscale = () => {
    gl.deleteTexture(texture); gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    delete window.__v.transformCanvas; delete window.__v.closeDownscale;
  };
}

// Serialized into the browser like installLinearDownscale (browser globals only). The gpu pipeline's default: converts each frame to BT.709
// limited-range I420 on the GPU, so the readback is 1.5 bytes a pixel instead of RGBA's 4 and ffmpeg encodes it as it comes;
// on a CPU-bound host the 4K readback, the sink and swscale's conversion were the frame's cost, not the render.
// It reproduces the CPU chain it replaces (video-lib's deliveryFilter, swscale with accurate_rnd, ffmpeg 8.1): luma per pixel;
// chroma averaged over each horizontal pair, then swscale's 8-tap vertical filter (taps fitted to its output, in 1/16384,
// summing to 16384), edge rows repeated. webcodecs-gpu.test.mjs holds every plane within a code of ffmpeg's.
// The planes are written top-down and packed four bytes to an RGBA8 texel (so readPixels' first row is the Y plane's
// first row and no vflip is needed). With ss 2 a first pass averages each 2x2 box in linear light and rounds it to 8-bit
// codes, exactly as installLinearDownscale does, so the conversion sees the RGB the CPU chain was given.
export function installYuvConverter({ width, height, ss }) {
  window.__v.closeYuv?.();
  if (width % 4 || height % 2) throw new Error('GPU YUV needs a width divisible by 4 and an even height');
  if (ss !== 1 && ss !== 2) throw new Error('GPU YUV supports native size or exact 2x supersampling');
  const canvas = document.createElement('canvas');
  canvas.width = width / 4; canvas.height = height * 3 / 2;
  // alpha: every fourth byte of the frame rides in it, and an opaque canvas would read back 255 there
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error('GPU YUV needs WebGL2');
  const shaders = [];
  const compile = (type, text) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, text); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    shaders.push(shader);
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, `#version 300 es
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`);
  const program = (fsText) => {
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsText)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  // ss 2: the linear-light 2x2 box, rounded to 8-bit codes, rows kept top-down
  const down = ss === 2 ? program(`#version 300 es
    precision highp float;
    uniform highp sampler2D image;
    out vec4 colour;
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy) * 2;
      vec3 light = vec3(0.0);
      for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++)
        light += pow(texelFetch(image, p + ivec2(x,y), 0).rgb, vec3(2.2));
      colour = vec4(floor(pow(light * 0.25, vec3(1.0/2.2)) * 255.0 + 0.5) / 255.0, 1.0);
    }`) : null;
  const pack = program(`#version 300 es
    precision highp float;
    precision highp int;
    uniform highp sampler2D rgb;
    uniform int W;
    uniform int H;
    out vec4 colour;
    const vec3 K = vec3(0.2126, 0.7152, 0.0722);
    const float TAP[8] = float[8](-231.0, -687.0, 1968.0, 7142.0, 7142.0, 1968.0, -687.0, -231.0);
    vec3 at(int x, int y) { return texelFetch(rgb, ivec2(x, clamp(y, 0, H - 1)), 0).rgb; }
    vec2 cbcr(vec3 c) { float y = dot(c, K); return vec2((c.b - y) / 1.8556, (c.r - y) / 1.5748); }
    float byteAt(int k) {
      if (k < W * H) return 16.0 + 219.0 * dot(at(k % W, k / W), K);
      int cw = W / 2, n = cw * (H / 2);
      k -= W * H;
      int plane = k / n;   // 0 Cb, 1 Cr
      k -= plane * n;
      int u = k % cw, v = k / cw;
      float s = 0.0;
      for (int i = 0; i < 8; i++) {
        int y = 2 * v - 3 + i;
        vec2 pair = cbcr(at(2 * u, y)) + cbcr(at(2 * u + 1, y));
        s += TAP[i] * (plane == 0 ? pair.x : pair.y);
      }
      return 128.0 + 224.0 * s / 32768.0;   // the taps sum to 16384 and the pair to twice its average
    }
    void main() {
      int k = (int(gl_FragCoord.y) * (W / 4) + int(gl_FragCoord.x)) * 4;
      vec4 b = vec4(byteAt(k), byteAt(k + 1), byteAt(k + 2), byteAt(k + 3));
      colour = clamp(floor(b + 0.5), 0.0, 255.0) / 255.0;
    }`);
  gl.disable(gl.DITHER); gl.disable(gl.BLEND);
  const texture = (w, h) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.NEAREST);
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  };
  const source = texture(width * ss, height * ss);
  const small = ss === 2 ? texture(width, height) : null;
  const fbo = ss === 2 ? gl.createFramebuffer() : null;
  if (fbo) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, small, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GPU YUV downscale target is incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(down); gl.uniform1i(gl.getUniformLocation(down, 'image'), 0);
  }
  gl.useProgram(pack);
  gl.uniform1i(gl.getUniformLocation(pack, 'rgb'), 0);
  gl.uniform1i(gl.getUniformLocation(pack, 'W'), width);
  gl.uniform1i(gl.getUniformLocation(pack, 'H'), height);
  // top-down: the canvas' first row is texel row 0
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  window.__v.transformCanvas = (frame) => {
    if (frame.width !== width * ss || frame.height !== height * ss) throw new Error(`GPU YUV expects a ${width * ss}x${height * ss} canvas`);
    if (gl.isContextLost()) throw new Error('GPU YUV context lost');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    if (fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, width, height);
      gl.useProgram(down); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, small);
    }
    gl.viewport(0, 0, width / 4, height * 3 / 2);
    gl.useProgram(pack); gl.drawArrays(gl.TRIANGLES, 0, 3);
    return canvas;
  };
  window.__v.closeYuv = () => {
    for (const t of [source, small]) if (t) gl.deleteTexture(t);
    if (fbo) gl.deleteFramebuffer(fbo);
    for (const p of [down, pack]) if (p) gl.deleteProgram(p);
    for (const s of shaders) gl.deleteShader(s);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    delete window.__v.transformCanvas; delete window.__v.closeYuv;
  };
}

// The quality-100 alternative retains readback, but after GPU downscale and without a lossless
// intermediate. The probe uses the same frame callback and back-pressure as the native encoder.
export async function captureCanvasRun({ from, to, sink, batch = 8, events, snapAt }) {
  const pending = [];
  let bytes = 0;
  const send = async () => {
    if (!pending.length) return;
    const response = await fetch(sink, { method: 'POST', body: new Blob(pending.splice(0)) });
    if (!response.ok) throw new Error(`raw sink ${response.status}`);
  };
  // Collect after send returns, when its Blob is unreachable; the browser blob store otherwise
  // accumulates raw batches across a long clip (the existing video page uses the same explicit GC).
  const flush = async () => { if (!pending.length) return; await send(); window.gc?.(); };
  const result = await window.__v.runCanvas({ from, to, events, snapAt, beforeFrame: async () => { if (pending.length >= batch) await flush(); }, onFrame(canvas) {
    const out = window.__v.transformCanvas ? window.__v.transformCanvas(canvas) : canvas;
    const gl = out.getContext('webgl2'), data = new Uint8Array(out.width * out.height * 4);
    gl.readPixels(0, 0, out.width, out.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    pending.push(data); bytes += data.byteLength;
  } });
  await flush();
  return { frames: result.pumped, bytes, snapshot: result.snapshot, landings: result.landings };
}

export async function encodeCanvasRun({ config, from, to, sink, queueLimit = 4, quantizer, events, snapAt }) {
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
  const flush = async () => { if (!pending.length) return; await send(); window.gc?.(); };
  const ready = async () => {
    check();
    while (encoder.encodeQueueSize >= queueLimit) {
      await new Promise((resolve) => {
        wake = resolve;
        encoder.addEventListener('dequeue', resolve, { once: true });
      });
      wake = null; check();
    }
    if (buffered >= 1 << 20) await flush();
  };
  const now = window.__clock?.realNow ?? (() => performance.now());
  const started = now();
  try {
    encoder.configure(support.config);
    const result = await window.__v.runCanvas({ from, to, events, snapAt, beforeFrame: ready, onFrame(canvas, i) {
      const timestamp = Math.round(i * 1e6 / config.framerate);
      const duration = Math.round((i + 1) * 1e6 / config.framerate) - timestamp;
      const out = window.__v.transformCanvas ? window.__v.transformCanvas(canvas) : canvas;
      const frame = new VideoFrame(out, { timestamp, duration, alpha: 'discard' });
      try { encoder.encode(frame, { keyFrame: i % (config.framerate * 2) === 0, ...(quantizer === undefined ? {} : { hevc: { quantizer } }) }); }
      finally { frame.close(); }
    } });
    await encoder.flush(); check();
    await flush();
    if (result.pumped !== to - from || chunks !== to - from) throw new Error(`encoded ${chunks} chunks for ${to - from} frames`);
    return { frames: result.pumped, chunks, bytes, snapshot: result.snapshot, landings: result.landings, timestamps: stamps, config: support.config, decoder_config: metadata, wall_ms: now() - started };
  } finally { encoder.close(); }
}
