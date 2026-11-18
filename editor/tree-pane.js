// ============================================================================
// The workspace's tree pane (spec/implementation.md, "The editor and the player"): EDITOR only, imported by editor.js alone. One
// canvas beside the viewer, showing the grove's own wood and leaves under one of two cameras, flicked with a click:
//   SIDE   from the ground, level, against a sky, the leaves darker with depth: the view a photograph of a tree is taken from,
//          and where a crown's proportions, droop and gaps are judged.
//   TURN   the T inset's view, a slow turntable from 24° above over a ground grid.
// The leaves are the inset's (komorebi-editor-tools.js, groveLeaves: the grove's own placement and draw order), the wood is
// hier.segments at the pipe model's width (trunk_radius_m × taper^(level + f)), so what the pane shows is what the cast was handed.
//
// THE PICTURE. Every leaf is a disc at its own size and every piece of wood a run of discs at its width, drawn as point sprites
// with a depth test on a WebGL2 context of the pane's own, so a near leaf covers a far one. `paneScene` (pure; the bun tests
// hold it) lays the discs out in metres and sets the scale from the grove's bounds, not the camera's, so flicking between the
// views or turning keeps one size; the vertex shader is the camera. The tree stands still: no wind (the cast moves; the pane is
// for its form). Its shaders are not in glslcheck, which reads the engine's modules: a typo throws when the pane is made, which
// the editor smoke records as a page error.
//
// COST. The discs are uploaded once per grove, after the grove has stood still for SETTLE_MS (a slider drag regrows every
// frame; the pane keeps its last tree meanwhile); a frame is one draw of them, and nothing while no workspace is up.
// ============================================================================

const SETTLE_MS = 250;
const TURN_PITCH = 24*Math.PI/180, TURN_RATE = 0.25;   // the T inset's pitch and turning rate (rad/s)

// The grove as discs. leaves: x, y, z, cov, tint, size per leaf (groveLeaves); segs: hier.segments;
// look: { leaf_size_m, trunk_radius_m, branch_children, taper_delta }. Returns the discs (x, y, z, radius in metres, kind:
// 0 wood, 1 leaf, 2 ground grid) and the grove's frame: its plan centre (mx, my), plan radius about it (R) and top.
export function paneScene(leaves, segs, look){
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, top = 1e-3;
  const n = leaves.length/6;
  const see = (x, y, z) => { if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; if(z > top) top = z; };
  for(let i=0;i<n;i++) if(leaves[6*i+3] > 0) see(leaves[6*i], leaves[6*i+1], leaves[6*i+2]);   // only the leaves drawn
  for(const s of segs){ see(s.a[0], s.a[1], s.a[2]); see(s.b[0], s.b[1], s.b[2]); }
  if(!(x1 >= x0)){ x0 = x1 = y0 = y1 = 0; }
  const mx = (x0 + x1)/2, my = (y0 + y1)/2;
  let R = 1e-3;
  for(let i=0;i<n;i++) if(leaves[6*i+3] > 0) R = Math.max(R, Math.hypot(leaves[6*i] - mx, leaves[6*i+1] - my));
  for(const s of segs) for(const p of [s.a, s.b]) R = Math.max(R, Math.hypot(p[0] - mx, p[1] - my));
  const out = [];
  // the wood: a disc at the pipe model's width every 0.7 of it, and never sparser than a 400th of the crown's radius
  const tap = Math.pow(Math.max(1.001, look.branch_children), -1/Math.max(1, look.taper_delta));
  for(const s of segs){
    const r = look.trunk_radius_m*Math.pow(tap, s.level + (s.f0 || 0));
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]), k = Math.max(1, Math.ceil(L/Math.max(0.7*r, R/400)));
    for(let q=0;q<=k;q++){ const t = q/k; out.push(s.a[0] + (s.b[0] - s.a[0])*t, s.a[1] + (s.b[1] - s.a[1])*t, s.a[2] + (s.b[2] - s.a[2])*t, r, 0); }
  }
  for(let i=0;i<n;i++) if(leaves[6*i+3] > 0) out.push(leaves[6*i], leaves[6*i+1], leaves[6*i+2], look.leaf_size_m*leaves[6*i+5]*0.5, 1);
  // the turntable's ground grid, as the T inset has it
  const N = 4, g = R*1.05, step = R/200;
  for(let i=-N;i<=N;i++){ const f = i/N*g;
    for(let v=-g; v<=g; v+=step){ out.push(mx + f, my + v, 0, 0, 2, mx + v, my + f, 0, 0, 2); } }
  return { discs: new Float32Array(out), mx, my, R, top };
}

// The camera for a pane of w×h pixels: px (pixels a metre), the pitch, and baseY (where the trunk's foot lands, from the top).
export function paneCamera(scene, w, h, view){
  const side = view === 'side', pitch = side ? 0 : TURN_PITCH, ground = side ? Math.round(h*0.04) : 0;
  const tall = side ? scene.top : scene.top*Math.cos(pitch) + 2*scene.R*Math.sin(pitch);
  const px = Math.min(w/(2*scene.R*1.08), (side ? (h - ground)*0.92 : h*0.86)/tall);
  const baseY = side ? h - ground : h - (h - tall*px)/2 - scene.R*Math.sin(pitch)*px;
  return { px, pitch, baseY, ground };
}

const VS = `#version 300 es
layout(location=0) in vec4 aDisc;   // x, y, z, radius (m)
layout(location=1) in float aKind;  // 0 wood, 1 leaf, 2 ground grid
uniform vec2 uRes, uCentre, uYaw, uPitch, uDepth;   // uYaw, uPitch: (cos, sin); uDepth: the leaves' nearest and farthest distance
uniform float uPx, uBase, uGrid;
out vec3 vCol;
void main(){
  if(aKind > 1.5 && uGrid < 0.5){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec2 dp = aDisc.xy - uCentre;
  float u = dp.x*uYaw.x - dp.y*uYaw.y, d = dp.x*uYaw.y + dp.y*uYaw.x;
  vec2 p = vec2(uRes.x*0.5 + u*uPx, uBase - (aDisc.z*uPitch.x - d*uPitch.y)*uPx);
  float far = -(d*uPitch.x + aDisc.z*uPitch.y);   // the camera stands on the +d side, lifted by the pitch, as in the T inset
  gl_Position = vec4(p.x/uRes.x*2.0 - 1.0, 1.0 - p.y/uRes.y*2.0, aKind > 1.5 ? 0.999 : clamp((far - uDepth.x)/(uDepth.y - uDepth.x)*0.9 + 0.05, 0.0, 0.99), 1.0);
  gl_PointSize = aKind > 1.5 ? 1.0 : max(aKind > 0.5 ? 1.6 : 1.0, 2.0*aDisc.w*uPx);
  float v = 0.85 - 0.5*clamp((far - uDepth.x)/(uDepth.y - uDepth.x), 0.0, 1.0);   // a leaf darker the farther it hangs
  vCol = aKind > 1.5 ? vec3(0.15, 0.17, 0.15) : aKind > 0.5 ? vec3(0.25, 0.5, 0.12)*v : vec3(0.22, 0.16, 0.10);   // grid, leaf, wood
}`;
const FS = `#version 300 es
precision mediump float;
in vec3 vCol; out vec4 o;
void main(){ vec2 c = gl_PointCoord - 0.5; if(dot(c, c) > 0.25) discard; o = vec4(vCol, 1.0); }`;
const VS_BG = `#version 300 es
void main(){ vec2 q = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)); gl_Position = vec4(q*4.0 - 1.0, 0.9999, 1.0); }`;
const FS_BG = `#version 300 es
precision mediump float;
uniform vec2 uRes; uniform float uSide, uGround; out vec4 o;
void main(){
  float y = uRes.y - gl_FragCoord.y, t = y/uRes.y;   // from the top
  if(uSide < 0.5) o = vec4(0.047, 0.067, 0.086, 1.0);
  else if(y >= uRes.y - uGround) o = vec4(0.30, 0.40, 0.22, 1.0);
  else o = vec4(0.55 + 0.2*t, 0.68 + 0.15*t, 0.85 + 0.05*t, 1.0);
}`;

// The pane: a canvas the workspace's CSS places. sources: { hier() the grove the engine holds, leaves() its groveLeaves }.
export function makeTreePane(params, sources){
  const canvas = document.createElement('canvas');
  canvas.id = 'tree';
  canvas.title = 'click: side view ⇄ turntable';
  const art = document.getElementById('gl');
  if(art) art.after(canvas); else document.body.appendChild(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });   // preserved: the dev bridge reads it back
  let view = 'side', shown = false, scene = null, count = 0, made = null, seen = null, seenAt = 0, draws = 0;
  canvas.dataset.view = view; canvas.dataset.draws = '0'; canvas.dataset.discs = '0';
  canvas.addEventListener('click', () => { view = view === 'side' ? 'turn' : 'side'; canvas.dataset.view = view; });
  const prog = (vs, fs) => {
    const p = gl.createProgram();
    for(const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]){
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`tree pane shader: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`tree pane program: ${gl.getProgramInfoLog(p)}`);
    return p;
  };
  const P = gl && prog(VS, FS), B = gl && prog(VS_BG, FS_BG);
  const U = {}; if(gl) for(const k of ['uRes', 'uCentre', 'uYaw', 'uPitch', 'uDepth', 'uPx', 'uBase', 'uGrid']) U[k] = gl.getUniformLocation(P, k);
  const UB = gl ? { uRes: gl.getUniformLocation(B, 'uRes'), uSide: gl.getUniformLocation(B, 'uSide'), uGround: gl.getUniformLocation(B, 'uGround') } : {};
  const buf = gl?.createBuffer(), vao = gl?.createVertexArray();
  if(gl){
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
    gl.bindVertexArray(null);
  }
  const look = () => ({ leaf_size_m: params.leaf_size_m, trunk_radius_m: params.trunk_radius_m, branch_children: params.branch_children, taper_delta: params.taper_delta });
  // a new grove (or a look knob the discs read) is uploaded once it has stood still for SETTLE_MS
  function refresh(){
    const hier = sources.hier(), lk = look();
    const key = { hier, w: hier?.leafW, lk: `${lk.leaf_size_m}|${lk.trunk_radius_m}|${lk.branch_children}|${lk.taper_delta}` };
    if(!hier?.segments) return;
    if(!seen || key.hier !== seen.hier || key.w !== seen.w || key.lk !== seen.lk){ seen = key; seenAt = performance.now(); if(made) return; }
    if(made === seen || (made && performance.now() - seenAt < SETTLE_MS)) return;
    scene = paneScene(sources.leaves(), hier.segments, lk);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, scene.discs, gl.STATIC_DRAW);
    count = scene.discs.length/5; made = seen; canvas.dataset.discs = String(count);
  }
  function render(w, h, v, yaw){
    if(canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    const cam = paneCamera(scene, w, h, v), side = v === 'side';
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(B); gl.uniform2f(UB.uRes, w, h); gl.uniform1f(UB.uSide, side ? 1 : 0); gl.uniform1f(UB.uGround, cam.ground);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(P);
    const a = side ? 0 : yaw, cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    gl.uniform2f(U.uRes, w, h); gl.uniform2f(U.uCentre, scene.mx, scene.my);
    gl.uniform2f(U.uYaw, Math.cos(a), Math.sin(a)); gl.uniform2f(U.uPitch, cp, sp);
    gl.uniform2f(U.uDepth, -(scene.R*cp + scene.top*sp), scene.R*cp);
    gl.uniform1f(U.uPx, cam.px); gl.uniform1f(U.uBase, cam.baseY); gl.uniform1f(U.uGrid, side ? 0 : 1);
    gl.bindVertexArray(vao); gl.drawArrays(gl.POINTS, 0, count); gl.bindVertexArray(null);
    canvas.dataset.draws = String(++draws);
  }
  const size = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); return [Math.max(1, Math.round(canvas.clientWidth*dpr)), Math.max(1, Math.round(canvas.clientHeight*dpr))]; };
  return {
    canvas,
    show(on){ shown = on; },
    // from eng.onFrame, while the workspace is up
    draw(){
      if(!shown || !gl) return;
      refresh();
      if(!scene) return;
      const [w, h] = size();
      render(w, h, view, performance.now()/1000*TURN_RATE);
    },
    // a PNG of the pane's current view at w×h, drawn now whether or not the workspace is up (the dev bridge's /__dev/pane)
    png(w = 920, h = 1120){
      if(!gl) throw new Error('no WebGL2 for the tree pane');
      made = null; refresh();   // now, not after the settle
      if(!scene) throw new Error('no grove yet');
      const cw = canvas.width, ch = canvas.height;
      render(w, h, view, performance.now()/1000*TURN_RATE);
      const url = canvas.toDataURL('image/png');
      if(shown){ const [sw, sh] = size(); render(sw, sh, view, performance.now()/1000*TURN_RATE); } else { canvas.width = cw; canvas.height = ch; }
      return url;
    },
  };
}
