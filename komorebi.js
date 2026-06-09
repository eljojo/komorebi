// ============================================================================
// Komorebi — shared WebGL2 engine.  window.Komorebi.create(canvas, opts) -> handle.
// Pipeline: Source (point-sun cloud) -> Canopy (leaves baked to optical-depth
// layers) -> Transport (shift-multiply-sum) -> Look (tonemap). Motion: two wind
// bands over a trunk/limb/twig spring hierarchy. See komorebi-spec.md.
//
// The editor (komorebi.html) and the viewer-only page background (index.html)
// both build on this. create() THROWS on missing WebGL2/float targets so callers
// can degrade: the editor shows the error, the viewer leaves its page static.
//
//   const eng = Komorebi.create(canvas, { params, onFrame });
//   eng.params / .perf / .motion / .src / .fps   live state (read for a HUD)
//   eng.apply(scope)        re-run a rebuild: 'source'|'canopy'|'textures'|'bake'|'perf'|''
//   eng.setParams(obj)      merge a full param set and rebuild (no UI side effects)
//   eng.drawSourceInset()   debug overlay (editor only)
//   eng.onFrame             optional callback invoked after each rendered frame
// ============================================================================
window.Komorebi = (function(){
'use strict';

const DEG = Math.PI / 180, TAU = Math.PI*2;
const MAX_SAMPLES = 48;
const MAX_LAYERS = 4;
const clamp = (x,a,b) => Math.min(b, Math.max(a, x));
const lerp = (a,b,t) => a + (b-a)*t;

// ---- default parameters. The editor edits a live copy; presets merge over this
// so old/partial JSON stays forward-compatible as new knobs are added. ----------
const DEFAULTS = {
  // Source
  sample_count: 32,
  core_angular_radius_deg: 0.27,   // the sun's half-angle (~0.5deg disk)
  halo_angular_radius_deg: 6.0,    // cloud aureole size at full cloud
  core_weight_fraction: 0.95,      // fraction of energy in the core when clear
  cloud_thickness: 0.15,           // MASTER breathing knob: drains core->halo, spreads halo
  eclipse: false,                  // proof test: dapples should turn crescent
  eclipse_amount: 0.55,
  // Canopy
  layer_count: 2,
  canopy_base_height_m: 8.0,
  canopy_thickness_m: 3.0,         // layers spread base .. base+thickness
  foliage_density: 1.0,
  clusters_per_layer: 60,
  leaves_per_cluster: 22,
  cluster_spread_m: 0.13,
  leaf_size_m: 0.09,
  leaf_aspect: 1.6,
  max_tilt: 0.8,                   // orientation foreshortening amount
  edge_softness: 0.25,
  trans_r: 0.04, trans_g: 0.35, trans_b: 0.06,   // per-channel transmittance (green passes)
  canopy_extent_m: 12.0,           // world size of baked layers (>= view + 2*max shift)
  tex_resolution: 2048,
  seed: 1234,
  // Transport
  sun_elevation_deg: 55,
  sun_azimuth_deg: 30,
  // Look
  view_extent_m: 4.0,              // vertical span of the visible ground (zoom)
  exposure: 1.3,
  contrast: 1.0,
  ambient_skylight: 0.5,
  tone_map: 2,                     // 0 none, 1 reinhard, 2 aces
  // Wind — coherent band (spec §5.1)
  wind_strength: 0.0,
  wind_direction_deg: 30,
  gust_frequency: 0.12,
  gust_attack: 1.2,
  gust_decay: 2.5,
  sway_stiffness: 5.0,
  sway_ceiling: 0.4,
  damping_ratio: 0.25,
  backlash_gain: 1.0,
  sway_height_gain: 0.0,
  limb_count: 8,
  limb_flex: 0.25,
  twig_flex: 0.35,
  stem_length: 0.5,
  leaf_swing: 0.7,
  flutter_freq: 1.4,
  // Leaf drift — incoherent band preview (spec §5.2)
  drift_amount: 0.0,
  drift_phase: 0.0,
  drift_auto: false,
  drift_speed: 0.4,
  // Debug / runtime
  auto_quality: false,             // watch fps; trim render resolution then samples to hold ~60 fps
  show_source: true,
  show_layer: false,
  show_layer_index: 0,
};

const BUILTIN_PRESETS = {
  // 'afternoon 5' is the boot default — a calm, warm, near-overhead spring scene, auto-quality on.
  // Any other look is the user's own, saved (★) to local storage via the editor.
  'afternoon 5': Object.assign({}, DEFAULTS, {
    sample_count:32, core_angular_radius_deg:0.77, halo_angular_radius_deg:4.3,
    core_weight_fraction:0.78, cloud_thickness:0.41, eclipse:false, eclipse_amount:0.42,
    layer_count:4, canopy_base_height_m:2, canopy_thickness_m:2.6, foliage_density:1.65,
    clusters_per_layer:82, leaves_per_cluster:59, cluster_spread_m:0.28, leaf_size_m:0.1,
    leaf_aspect:1.75, max_tilt:0.54, edge_softness:0.26, trans_r:0.26, trans_g:0.356, trans_b:0.001,
    canopy_extent_m:6, tex_resolution:1024, seed:290626672,
    sun_elevation_deg:84.5, sun_azimuth_deg:201,
    view_extent_m:3.1, exposure:2.44, contrast:0.98, ambient_skylight:0.97, tone_map:2,
    wind_strength:0.07, wind_direction_deg:132, gust_frequency:0.125, gust_attack:1.2, gust_decay:1.3,
    sway_stiffness:1.2, sway_ceiling:0.4, damping_ratio:0.65, backlash_gain:1, sway_height_gain:0.75,
    limb_count:11, limb_flex:0.25, twig_flex:0.18, stem_length:0.18, leaf_swing:1.35, flutter_freq:1.4,
    drift_amount:0.145, drift_phase:1.403, drift_auto:true, drift_speed:0.04, auto_quality:true,
  }),
  // 'afternoon 4' — the windier predecessor, kept as-is.
  'afternoon 4': Object.assign({}, DEFAULTS, {
    sample_count:32, core_angular_radius_deg:0.77, halo_angular_radius_deg:4.3,
    core_weight_fraction:0.78, cloud_thickness:0.41, eclipse:false, eclipse_amount:0.42,
    layer_count:4, canopy_base_height_m:2, canopy_thickness_m:2.6, foliage_density:1.65,
    clusters_per_layer:82, leaves_per_cluster:59, cluster_spread_m:0.28, leaf_size_m:0.1,
    leaf_aspect:1.75, max_tilt:0.54, edge_softness:0.26, trans_r:0.26, trans_g:0.356, trans_b:0.001,
    canopy_extent_m:6, tex_resolution:1024, seed:290626672,
    sun_elevation_deg:84.5, sun_azimuth_deg:201,
    view_extent_m:3.1, exposure:2.44, contrast:0.98, ambient_skylight:0.97, tone_map:2,
    wind_strength:1.34, wind_direction_deg:132, gust_frequency:0.125, gust_attack:1.2, gust_decay:2.5,
    sway_stiffness:1.2, sway_ceiling:0.4, damping_ratio:0.25, backlash_gain:1, sway_height_gain:1.6,
    limb_count:11, limb_flex:0.25, twig_flex:0.35, stem_length:0.14, leaf_swing:1.35, flutter_freq:1.4,
    drift_amount:0.145, drift_phase:2.876, drift_auto:true, drift_speed:0.04,
  }),
};

// ---- deterministic RNG so canopy is frame-stable & reproducible ------------
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function makeGauss(rng){ return ()=>{ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }; }
function hash3(a,b,c){ let h=(a^0x9E3779B1)>>>0;
  h=Math.imul(h^b,0x85EBCA6B)>>>0; h=Math.imul(h^c,0xC2B2AE35)>>>0;
  return (h^(h>>>15))>>>0; }

// smooth, deterministic gust signal in [0,1] — mostly calm with occasional swells
function gustShape(t, f){
  let s = Math.sin(t*f*TAU)*0.6 + Math.sin(t*f*TAU*2.3+1.7)*0.3 + Math.sin(t*f*TAU*5.1+4.2)*0.1;
  s = 0.5 + 0.5*s;
  return clamp(s*s, 0, 1);          // square -> spend more time low, peak in gusts
}
// a smooth, spatially-varying, slowly-evolving wind force — sampled at each node's position.
function windNoise(x, y, t, k){
  const fx = Math.sin(x*k + t*0.9) + 0.5*Math.sin(y*k*1.3 - t*1.4 + 1.7);
  const fy = Math.sin(y*k - t*1.1) + 0.5*Math.sin(x*k*1.3 + t*1.2 + 2.3);
  return [fx*0.7, fy*0.7];
}

// ===========================================================================
// Shaders
// ===========================================================================
const VS_BAKE = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1] quad corner
layout(location=1) in vec4 iA;        // center.xy, A (long half), B0 (face-on short half)
layout(location=2) in vec4 iB;        // angle, restTilt, swingGain, swingPhase
layout(location=3) in vec4 iC;        // tau.rgb, clusterId (which twig — hierarchy lookup)
layout(location=4) in vec4 iD;        // orbit: ampX, ampY, orientation, phase (incoherent drift)
uniform vec2  uCanopyOrigin;          // -extent/2
uniform vec2  uCanopyExtent;          // (extent, extent)
uniform float uMorph;                 // drift phase (incoherent band, §5.2)
uniform float uMorphAmount;           // orbit radius scale (m)
uniform vec2  uSway;                  // trunk (coherent) translation for this layer (§5.1)
uniform highp sampler2D uClusterTex;  // per-clump dynamic bend angles (limb, twig) — radians
uniform highp sampler2D uClusterGeom; // per-clump static geometry: clump centre + trunk pivot
uniform float uWindLevel;             // signed sway fraction u(t) — drives leaf swing intensity
uniform float uWindTime;              // seconds, for leaf flutter
uniform float uLeafSwing;             // master: how far leaves rock as wind blows
uniform float uFlutterFreq;           // leaf flutter rate (Hz)
uniform float uStemLen;               // twig stem length: pivot offset toward the limb (swing, not spin)
out vec2 vLocal;
out vec3 vTau;
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  // ---- leaf rocks with the wind: footprint foreshortens -> dapple changes SHAPE (§4.5) ----
  float wm = abs(uWindLevel);
  float swing = uLeafSwing*swingGain*(0.5*uWindLevel + wm*sin(uWindTime*uFlutterFreq*6.2831853+swingPhase));
  float B = B0 * max(0.05, abs(cos(restTilt + swing)));
  // ---- incoherent drift orbit (fast, periodic) ----
  float th = uMorph + iD.w;
  vec2 lp = vec2(iD.x*cos(th), iD.y*sin(th));
  float co=cos(iD.z), so=sin(iD.z);
  vec2 drift = uMorphAmount * mat2(co,-so,so,co) * lp;
  // ---- branch hierarchy (§5): ROTATION about joints, not translation. The twig swings the clump
  // about a stem joint; the limb swings the whole clump as a rigid arc about the TRUNK (canopy
  // centre). A leaf inherits both, so clumps PIVOT and their leaves sweep arcs — not a slab slide. ----
  int cid = int(iC.w + 0.5);
  vec4 geom = texelFetch(uClusterGeom, ivec2(cid,0), 0);    // clump centre .xy, trunk pivot .zw
  vec3 bend = texelFetch(uClusterTex,  ivec2(cid,0), 0).xyz; // limb bend, twig bend, stem-angle seed
  vec2 C = geom.xy, BL = geom.zw; float thL = bend.x, thT = bend.y;
  // twig STEM: a base joint offset from the clump TOWARD the trunk. The twig SWINGS about a real
  // joint instead of spinning about its own centre — which removes the clump-scale vortex/swirl. (§5.1)
  vec2 d = C - BL; float Lr = max(length(d), 1e-3); vec2 radial = d/Lr;
  float sa = bend.z*0.6;                                    // per-twig spread so they don't lockstep
  float ca=cos(sa), sna=sin(sa);
  vec2 Jtwig = C - (mat2(ca,-sna,sna,ca)*radial) * min(uStemLen, Lr*0.9);  // joint between clump & trunk
  float ct=cos(thT), st=sin(thT);
  vec2 p    = Jtwig + mat2(ct,-st,st,ct)*(leafRest - Jtwig); // twig swings clump about its base joint
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,-sl,sl,cl)*(p - BL);            // limb swings clump about the trunk
  float ang = angle + thL + thT + 0.2*swing;               // leaf orientation rotates with the branch
  // ---- place the (foreshortened, rocked) leaf quad ----
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 world = base + uSway + drift + R*(aCorner*vec2(A,B));
  vec2 uv = (world - uCanopyOrigin)/uCanopyExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = aCorner;
  vTau = iC.xyz;
}`;

const FS_BAKE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
uniform float uEdge;
out vec4 frag;
void main(){
  // soft elliptical leaf mask -> partial coverage at edges (honest area-averaging)
  float r = length(vLocal);
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  // additive: optical depth ADDS across overlaps (order-independent), unlike transmittance
  frag = vec4(vTau*cov, cov);
}`;

const VS_FULL = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID==1)?3.0:-1.0, (gl_VertexID==2)?3.0:-1.0);
  vUv = p*0.5+0.5;
  gl_Position = vec4(p,0.0,1.0);
}`;

const FS_TRANSPORT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
#define MAX_SAMPLES ${MAX_SAMPLES}
uniform vec3  uSamples[MAX_SAMPLES];   // xy = angular offset (rad), z = weight (sum=1)
uniform int   uSampleCount;
uniform highp sampler2D uLayer[${MAX_LAYERS}];   // highp: optical depth exceeds lowp's ~[-2,2]
uniform float uLayerHeight[${MAX_LAYERS}];
uniform int   uLayerCount;
uniform mat2  uProj;                    // angular->ground per unit height (ellipse + shear)
uniform float uViewExtent;
uniform float uAspect;
uniform vec2  uCanopyOrigin;
uniform vec2  uCanopyExtent;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform float uExposure;
uniform float uContrast;
uniform int   uToneMap;

vec3 reinhard(vec3 c){ return c/(1.0+c); }
vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
vec3 tap(highp sampler2D t, vec2 world){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  return exp(-texture(t,uv).rgb);   // optical depth -> transmittance
}
void main(){
  vec2 world = vec2((vUv.x-0.5)*uViewExtent*uAspect, (vUv.y-0.5)*uViewExtent);
  vec3 acc = vec3(0.0);
  for(int i=0;i<MAX_SAMPLES;i++){
    if(i>=uSampleCount) break;
    vec2 g = uProj * uSamples[i].xy;        // ground displacement per unit height
    float w = uSamples[i].z;
    // light must clear EVERY layer -> multiply transmittance; shift grows with height
    vec3 T = vec3(1.0);
    if(uLayerCount>0) T *= tap(uLayer[0], world + uLayerHeight[0]*g);
    if(uLayerCount>1) T *= tap(uLayer[1], world + uLayerHeight[1]*g);
    if(uLayerCount>2) T *= tap(uLayer[2], world + uLayerHeight[2]*g);
    if(uLayerCount>3) T *= tap(uLayer[3], world + uLayerHeight[3]*g);
    acc += w*T;                              // sum of shifted sharp shadows == soft shadow
  }
  vec3 col = acc*uSunColor + uAmbient;
  col *= uExposure;
  if(uToneMap==1) col=reinhard(col);
  else if(uToneMap==2) col=aces(col);
  else col=clamp(col,0.0,1.0);
  col = clamp((col-0.5)*uContrast+0.5, 0.0, 1.0);
  col = pow(col, vec3(1.0/2.2));
  frag = vec4(col,1.0);
}`;

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTex;
out vec4 frag;
void main(){
  vec3 T = exp(-texture(uTex, vUv).rgb);   // show transmittance of the baked layer
  frag = vec4(pow(T, vec3(1.0/2.2)), 1.0);
}`;

const VS_POINTS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aOff;     // radians
layout(location=1) in float aW;
uniform float uScale;
uniform float uMaxW;
out float vB;
void main(){
  gl_Position = vec4(aOff*uScale, 0.0, 1.0);
  float n = aW/uMaxW;
  gl_PointSize = 2.0 + 16.0*sqrt(n);
  vB = 0.25 + 0.75*n;
}`;

const FS_POINTS = `#version 300 es
precision highp float;
in float vB;
out vec4 frag;
void main(){
  vec2 d = gl_PointCoord*2.0-1.0;
  if(dot(d,d)>1.0) discard;
  frag = vec4(vec3(1.0,0.95,0.85)*vB, 1.0);
}`;

// ===========================================================================
// create(canvas, opts) — one self-contained engine instance on a canvas.
// ===========================================================================
function create(canvas, opts){
  opts = opts || {};
  const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, premultipliedAlpha:false });
  function fail(msg){ throw new Error('komorebi: '+msg); }
  if (!gl) fail('WebGL2 is required and not available in this browser.');
  const extCBF = gl.getExtension('EXT_color_buffer_float');     // renderable half/float
  gl.getExtension('EXT_float_blend');                            // float-target blending (harmless if absent)
  if (!extCBF) fail('EXT_color_buffer_float is required (float render targets).');

  const params = Object.assign({}, DEFAULTS, opts.params || {});
  // Auto-quality runtime throttle (driven by the params.auto_quality toggle). Holds the live
  // resolution / sample-count it trims to. Never touches the artistic params.
  const perf = { auto:false, quality:1, resScale:1, sampleCount:params.sample_count, acc:0, lowCount:0, hiCount:0, upWait:20 };
  // Motion — one time-driven state, two bands (spec §5). u = sway as a fraction of ceiling.
  const motion = { time:0, u:0, v:0, env:0, sway:[0,0] };

  function compile(type, src){
    const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) fail('Shader: '+gl.getShaderInfoLog(s)+'\n'+src);
    return s;
  }
  function program(vs,fs){
    const p=gl.createProgram();
    gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));
    gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) fail('Link: '+gl.getProgramInfoLog(p));
    return p;
  }
  const progBake = program(VS_BAKE, FS_BAKE);
  const progTransport = program(VS_FULL, FS_TRANSPORT);
  const progBlit = program(VS_FULL, FS_BLIT);
  const progPoints = program(VS_POINTS, FS_POINTS);

  const U = {};
  function loc(prog, name){ return gl.getUniformLocation(prog, name); }
  U.bake = { origin:loc(progBake,'uCanopyOrigin'), extent:loc(progBake,'uCanopyExtent'), edge:loc(progBake,'uEdge'),
             morph:loc(progBake,'uMorph'), morphAmount:loc(progBake,'uMorphAmount'), sway:loc(progBake,'uSway'),
             windLevel:loc(progBake,'uWindLevel'), windTime:loc(progBake,'uWindTime'),
             leafSwing:loc(progBake,'uLeafSwing'), flutterFreq:loc(progBake,'uFlutterFreq'), stemLen:loc(progBake,'uStemLen'),
             clusterTex:loc(progBake,'uClusterTex'), clusterGeom:loc(progBake,'uClusterGeom') };
  U.tp = {
    samples:loc(progTransport,'uSamples[0]'), count:loc(progTransport,'uSampleCount'),
    heights:loc(progTransport,'uLayerHeight[0]'), layerCount:loc(progTransport,'uLayerCount'),
    proj:loc(progTransport,'uProj'), viewExtent:loc(progTransport,'uViewExtent'), aspect:loc(progTransport,'uAspect'),
    origin:loc(progTransport,'uCanopyOrigin'), extent:loc(progTransport,'uCanopyExtent'),
    sun:loc(progTransport,'uSunColor'), ambient:loc(progTransport,'uAmbient'),
    exposure:loc(progTransport,'uExposure'), contrast:loc(progTransport,'uContrast'), tone:loc(progTransport,'uToneMap'),
    layers:[0,1,2,3].map(i=>loc(progTransport,'uLayer['+i+']')),
  };
  U.blit = { tex:loc(progBlit,'uTex') };
  U.pts = { scale:loc(progPoints,'uScale'), maxW:loc(progPoints,'uMaxW') };

  // ---- geometry / GPU buffers ----
  const emptyVAO = gl.createVertexArray();           // required to issue attrib-less draws
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const srcDbgBuf = gl.createBuffer();
  const srcDbgVAO = gl.createVertexArray();
  gl.bindVertexArray(srcDbgVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, srcDbgBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,12,0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,1,gl.FLOAT,false,12,8);
  gl.bindVertexArray(null);

  const bakeFBO = gl.createFramebuffer();
  let layerTex = [];           // MAX_LAYERS textures (active sized, inactive 1x1)
  let layerVAO = [];           // per-layer instance VAOs {vao,count,buf}
  let hier = null;             // branch hierarchy: limb + twig spring state (built in regenCanopy)
  let clusterTex = null;       // per-clump dynamic bend angles (limb, twig), updated each frame
  let clusterGeomTex = null;   // per-clump static geometry (clump centre + trunk pivot)
  const src = { flat:new Float32Array(0), count:0, maxR:1, maxW:1, haloR:0.01 };

  function makeLayerTexture(size){
    const t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,size,size,0,gl.RGBA,gl.HALF_FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  function rebuildTextures(){
    layerTex.forEach(t=>gl.deleteTexture(t));
    layerTex = [];
    const res = params.tex_resolution|0;
    for(let i=0;i<MAX_LAYERS;i++){
      layerTex.push(makeLayerTexture(i < params.layer_count ? res : 1));
    }
  }

  // ---- canopy generation: clustered leaf fields, per-clump stable seeding -----
  function regenCanopy(){
    layerVAO.forEach(L=>{ gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.buf); });
    layerVAO = [];
    const E = params.canopy_extent_m;
    const tau = [
      -Math.log(clamp(params.trans_r,1e-4,0.999)),
      -Math.log(clamp(params.trans_g,1e-4,0.999)),
      -Math.log(clamp(params.trans_b,1e-4,0.999)),
    ];
    const pcF = Math.max(0, params.leaves_per_cluster*params.foliage_density);
    const pcInt = Math.floor(pcF);
    const frac = pcF - pcInt;                         // marginal leaf fades in by this
    const nLeaf = pcInt + (frac>1e-4 ? 1 : 0);
    const nClusters = Math.max(1, params.clusters_per_layer|0);
    const TAU2 = Math.PI*2;

    // ---- branch hierarchy: limbs are ARMS radiating from a trunk at the canopy centre (0,0).
    // A clump attaches to the limb whose direction points toward it, so it hangs off that limb's FAR
    // end — every clump sits outward from the trunk pivot, all on one side, so a limb bend reads as a
    // coherent downwind sweep instead of an in-place spin. limbPlan is an outboard wind-sample point.
    const nLimb = Math.max(1, params.limb_count|0);
    const nClusterTotal = params.layer_count * nClusters;
    const lr = mulberry32(hash3(params.seed>>>0, 1009, 7));   // limb layout (own stream)
    const limbDir = new Float32Array(nLimb*2);   // unit trunk->tip direction
    const limbAng = new Float32Array(nLimb);     // its angle, for angular clump assignment
    const limbPlan = new Float32Array(nLimb*2);  // an outboard sample point for the wind-noise field
    for(let i=0;i<nLimb;i++){
      const a = (i+0.5)/nLimb*TAU2 + (lr()-0.5)*(TAU2/nLimb)*0.6;   // fan around the circle, modest jitter
      const len = E*0.5*(0.6+0.4*lr());
      limbAng[i]=a; limbDir[2*i]=Math.cos(a); limbDir[2*i+1]=Math.sin(a);
      limbPlan[2*i]=Math.cos(a)*len*0.6; limbPlan[2*i+1]=Math.sin(a)*len*0.6;
    }
    hier = {
      nLimb, limbPlan, limbDir,
      limbAngle:new Float32Array(nLimb), limbVel:new Float32Array(nLimb),   // scalar bend (radians)
      nClusterTotal,
      clusterPlan:new Float32Array(nClusterTotal*2), clusterLimb:new Int32Array(nClusterTotal),
      clusterPhase:new Float32Array(nClusterTotal),
      twigAngle:new Float32Array(nClusterTotal), twigVel:new Float32Array(nClusterTotal),
      clusterData:new Float32Array(nClusterTotal*4),   // dynamic: (limb bend, twig bend) per clump
      clusterGeom:new Float32Array(nClusterTotal*4),   // static: (clump centre.xy, trunk pivot.xy)
      maxV:0,
    };

    for(let l=0;l<params.layer_count;l++){
      const data = [];   // 16 floats/leaf — see attribute layout below
      for(let c=0;c<nClusters;c++){
        const ci = l*nClusters + c;                                          // global twig id
        const rng  = mulberry32(hash3(params.seed>>>0, l, c));               // arrangement stream
        const rng2 = mulberry32(hash3((params.seed>>>0)^0x5bd1e995, l, c));  // wind-identity stream (separate)
        const gauss = makeGauss(rng);
        const cx=(rng()-0.5)*E*0.94, cy=(rng()-0.5)*E*0.94;
        // rng2 draws kept identical so swingGain/swingPhase (leaf swing) don't shift
        const swayRand = rng2()*2-1; const stemRand = rng2()*2-1;
        hier.clusterPlan[2*ci]=cx; hier.clusterPlan[2*ci+1]=cy; hier.clusterPhase[ci]=swayRand*Math.PI;
        // attach to the limb whose direction points most toward this clump (angular nearest), so the
        // clump hangs off that limb's far end — radially outward from the trunk, never straddling it.
        const bearing = Math.atan2(cy, cx);
        let best=0, bd=1e18;
        for(let i=0;i<nLimb;i++){
          let dA = bearing - limbAng[i];
          dA = Math.abs(Math.atan2(Math.sin(dA), Math.cos(dA)));   // wrapped |Δangle|
          if(dA<bd){ bd=dA; best=i; }
        }
        hier.clusterLimb[ci]=best;
        // the pivot is the TRUNK (canopy centre, 0,0); the clump is radially outward from it.
        hier.clusterGeom[4*ci]=cx; hier.clusterGeom[4*ci+1]=cy;
        hier.clusterGeom[4*ci+2]=0; hier.clusterGeom[4*ci+3]=0;
        hier.clusterData[4*ci+2]=stemRand;   // static stem-angle seed (.z); tick only writes .x/.y
        for(let k=0;k<nLeaf;k++){
          // primary stream draws kept in the SAME order as before -> rest arrangement unchanged
          const cov = (k===pcInt) ? frac : 1.0;
          const x = cx + gauss()*params.cluster_spread_m;
          const y = cy + gauss()*params.cluster_spread_m;
          const size = params.leaf_size_m*(0.6+0.8*rng());
          const A = size*0.5;                              // long half-axis
          const B0 = size*0.5/params.leaf_aspect;          // face-on short half (shader foreshortens)
          const restTilt = rng()*params.max_tilt*(Math.PI*0.5);
          const angle = rng()*Math.PI;
          const ax = 0.4+0.6*rng(), ay = 0.4+0.6*rng();    // incoherent orbit
          const orient = rng()*TAU2, phase = rng()*TAU2;
          const swingGain = 0.6+0.8*rng2(), swingPhase = rng2()*TAU2;
          data.push(x,y,A,B0, angle,restTilt,swingGain,swingPhase,
                    tau[0]*cov,tau[1]*cov,tau[2]*cov, ci, ax,ay,orient,phase);
        }
      }
      const arr=new Float32Array(data);
      const buf=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      gl.bufferData(gl.ARRAY_BUFFER,arr,gl.STATIC_DRAW);
      const vao=gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      const S=64;   // 16 floats/leaf: [c.xy,A,B0][angle,tilt,swingGain,swingPhase][tau.rgb,clusterId][orbit.xyzw]
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.disableVertexAttribArray(5);   // location 5 no longer used
      gl.bindVertexArray(null);
      layerVAO.push({ vao, count: arr.length/16, buf });
    }

    // ---- (re)build the per-clump data textures sampled by the bake VS ----
    const makeDataTex = (old, data) => {
      if(old) gl.deleteTexture(old);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, Math.max(1,nClusterTotal), 1, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    clusterTex     = makeDataTex(clusterTex, hier.clusterData);      // dynamic bend angles
    clusterGeomTex = makeDataTex(clusterGeomTex, hier.clusterGeom);  // static geometry
  }

  // ---- bake leaves into per-layer optical-depth textures ---------------------
  function bake(){
    const res = params.tex_resolution|0;
    const E = params.canopy_extent_m;
    gl.useProgram(progBake);
    gl.uniform2f(U.bake.origin, -E/2, -E/2);
    gl.uniform2f(U.bake.extent, E, E);
    gl.uniform1f(U.bake.edge, params.edge_softness);
    gl.uniform1f(U.bake.morph, params.drift_phase);
    gl.uniform1f(U.bake.morphAmount, params.drift_amount);
    gl.uniform1f(U.bake.windLevel, motion.u);
    gl.uniform1f(U.bake.windTime, motion.time);
    gl.uniform1f(U.bake.leafSwing, params.leaf_swing);
    gl.uniform1f(U.bake.flutterFreq, params.flutter_freq);
    gl.uniform1f(U.bake.stemLen, params.stem_length);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, clusterTex);     gl.uniform1i(U.bake.clusterTex, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, clusterGeomTex); gl.uniform1i(U.bake.clusterGeom, 5);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);
    gl.viewport(0,0,res,res);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);          // optical depth accumulates additively
    const H=layerHeights(), base=params.canopy_base_height_m;
    for(let l=0;l<params.layer_count;l++){
      // higher layers ride longer levers -> sway more when height gain > 0 (else pure translation)
      const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
      gl.uniform2f(U.bake.sway, motion.sway[0]*f, motion.sway[1]*f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layerTex[l], 0);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // depth 0 -> transmittance 1
      const L=layerVAO[l];
      gl.bindVertexArray(L.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, L.count);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- source: Vogel-spiral cloud of weighted point-suns ---------------------
  function regenSource(){
    const N = clamp(Math.round(perf.auto ? perf.sampleCount : params.sample_count), 3, MAX_SAMPLES);
    const coreR = params.core_angular_radius_deg*DEG;
    const t = params.cloud_thickness;
    const haloR = lerp(coreR*2.0, params.halo_angular_radius_deg*DEG, t);
    const Wcore = params.core_weight_fraction*(1.0-t);     // energy drains core->halo with cloud
    const Whalo = 1.0 - Wcore;
    const nCore = Math.max(3, Math.round(N*0.5));
    const nHalo = Math.max(0, N - nCore);
    const golden = Math.PI*(3 - Math.sqrt(5));
    const pts = [];
    for(let i=0;i<nCore;i++){
      const r = coreR*Math.sqrt((i+0.5)/nCore), a=i*golden;
      pts.push([r*Math.cos(a), r*Math.sin(a), Wcore/nCore]);
    }
    for(let i=0;i<nHalo;i++){
      const f=(i+0.5)/nHalo;
      const r=Math.sqrt(coreR*coreR + f*(haloR*haloR-coreR*coreR));  // area-uniform annulus
      const a=i*golden+0.5;
      pts.push([r*Math.cos(a), r*Math.sin(a), nHalo>0?Whalo/nHalo:0]);
    }
    // eclipse: occlude a moon-disk over the sun -> remaining samples form a crescent
    if(params.eclipse){
      const rm=coreR*1.0, d=coreR*(1.3-params.eclipse_amount);
      for(const p of pts){ if(Math.hypot(p[0]-d, p[1])<rm) p[2]=0; }
      let s=0; for(const p of pts) s+=p[2];
      if(s>0) for(const p of pts) p[2]/=s;     // renormalize (keep shape visible)
    }
    const flat=new Float32Array(pts.length*3);
    let mr=1e-9, mw=1e-9;
    pts.forEach((p,i)=>{ flat[i*3]=p[0]; flat[i*3+1]=p[1]; flat[i*3+2]=p[2];
      mr=Math.max(mr,Math.hypot(p[0],p[1])); mw=Math.max(mw,p[2]); });
    src.flat=flat; src.count=pts.length; src.maxR=mr; src.maxW=mw; src.haloR=haloR;
    gl.bindBuffer(gl.ARRAY_BUFFER, srcDbgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, flat, gl.DYNAMIC_DRAW);
  }

  // ---- the ellipse: angular offset -> ground displacement per unit height ----
  function projMatrix(){
    const el=Math.max(params.sun_elevation_deg,4)*DEG, az=params.sun_azimuth_deg*DEG;
    const se=Math.sin(el);
    const major=1/(se*se), minor=1/se;          // stretch along azimuth grows as sun lowers
    const ca=Math.cos(az), sa=Math.sin(az);
    const M00=major*ca*ca+minor*sa*sa;
    const M01=(major-minor)*ca*sa;
    const M11=major*sa*sa+minor*ca*ca;
    return [M00,M01,M01,M11];                    // column-major (symmetric)
  }
  function layerHeights(){
    const h=new Float32Array(MAX_LAYERS);
    const n=params.layer_count, base=params.canopy_base_height_m, thick=params.canopy_thickness_m;
    for(let i=0;i<MAX_LAYERS;i++) h[i]= n>1 ? base+(i/(n-1))*thick : base;
    return h;
  }

  // ---- motion: integrate the limb and twig springs (children inherit parents) ----
  function tickHierarchy(steps, h){
    if(!hier) return;
    const t = motion.time;
    const eb = 0.25 + 0.75*motion.env;       // differential bend breathes with the gust
    const u = motion.u;                       // coherent gust sense (signed, stiffened/backlashed)
    const dz = params.damping_ratio;
    const wL = Math.max(0.3, params.sway_stiffness*0.5), wT = Math.max(0.3, params.sway_stiffness*2.0);
    const kL=wL*wL, kT=wT*wT, cL=2*dz*wL, cT=2*dz*wT, lf=params.limb_flex, tf=params.twig_flex;
    let maxv=0;
    const wd=params.wind_direction_deg*DEG, wx=Math.cos(wd), wy=Math.sin(wd);   // downwind direction
    for(let i=0;i<hier.nLimb;i++){             // limbs pivot about the trunk; bend = wind TORQUE about it
      const dx=hier.limbDir[2*i], dy=hier.limbDir[2*i+1];
      const torque = dx*wy - dy*wx;            // cross(limbDir,wind): tip swings downwind, sign by side —
                                               // so a uniform gust LEANS the whole canopy, never spins it
      const n = windNoise(hier.limbPlan[2*i], hier.limbPlan[2*i+1], t, 0.4)[0];
      const target = lf*(u*torque + 0.6*eb*n);
      for(let s=0;s<steps;s++){ const a = kL*(target - hier.limbAngle[i]) - cL*hier.limbVel[i];
        hier.limbVel[i]+=a*h; hier.limbAngle[i]+=hier.limbVel[i]*h; }
      maxv=Math.max(maxv, Math.abs(hier.limbVel[i]));
    }
    for(let j=0;j<hier.nClusterTotal;j++){     // twigs: stiffer, faster, mostly decorrelated
      const cxj=hier.clusterPlan[2*j], cyj=hier.clusterPlan[2*j+1], cl=Math.hypot(cxj,cyj)||1e-3;
      const tq=(cxj*wy - cyj*wx)/cl;           // downwind torque about the stem (same lean sense as the limb)
      const n = windNoise(cxj, cyj, t+hier.clusterPhase[j], 1.5)[0];
      const target = tf*(0.4*u*tq + eb*n);
      for(let s=0;s<steps;s++){ const a = kT*(target - hier.twigAngle[j]) - cT*hier.twigVel[j];
        hier.twigVel[j]+=a*h; hier.twigAngle[j]+=hier.twigVel[j]*h; }
      hier.clusterData[4*j]   = hier.limbAngle[hier.clusterLimb[j]];   // limb bend this clump inherits
      hier.clusterData[4*j+1] = hier.twigAngle[j];                     // its own twig bend
      maxv=Math.max(maxv, Math.abs(hier.twigVel[j]));
    }
    hier.maxV = maxv;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, clusterTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, hier.nClusterTotal, 1, gl.RGBA, gl.FLOAT, hier.clusterData);
  }
  function motionActive(){
    return params.wind_strength>0 || (params.drift_auto && params.drift_amount>0)
        || Math.abs(motion.u)>1e-3 || Math.abs(motion.v)>1e-3   // keep simulating until settled
        || (hier && hier.maxV>2e-4);
  }
  function tick(dt){
    dt = clamp(dt, 0, 1/15);                                  // guard tab-switch spikes
    // breathing: asymmetric one-pole envelope (attack ≠ decay) on the raw gust
    const raw = gustShape(motion.time, params.gust_frequency);
    const tc = (raw>motion.env) ? params.gust_attack : params.gust_decay;
    motion.env += (raw - motion.env) * (1 - Math.exp(-dt/Math.max(tc,1e-3)));
    const drive = params.wind_strength * motion.env;          // dimensionless; 1 ≈ stiffening onset
    // underdamped nonlinear spring; rest is 0 (exact relaxation), wind is a force, not a target.
    const w = params.sway_stiffness;
    const steps = Math.max(1, Math.ceil(dt/(1/120)));         // substep for stability across ω
    const h = dt/steps;
    for(let i=0;i<steps;i++){
      const denom = Math.max(0.02, 1 - motion.u*motion.u);    // stiffening: restoring -> ∞ at ceiling
      let damp = params.damping_ratio;
      if(motion.u*motion.v < 0) damp /= (1 + params.backlash_gain);  // whip-back: under-damp the return
      const a = w*w*(drive - motion.u/denom) - 2*damp*w*motion.v;
      motion.v += a*h;
      motion.u += motion.v*h;
    }
    motion.u = clamp(motion.u, -1.5, 1.5);                    // safety; stiffening keeps it near ±1
    const dir = params.wind_direction_deg*DEG;
    motion.sway = [Math.cos(dir)*motion.u*params.sway_ceiling, Math.sin(dir)*motion.u*params.sway_ceiling];
    tickHierarchy(steps, h);                                  // limb + twig springs (medium band)
    motion.time += dt;
    // incoherent band: advance the drift phase (periodic in 2π). The editor reflects it in its slider.
    if(params.drift_auto && params.drift_amount>0){
      params.drift_phase = (params.drift_phase + params.drift_speed*dt) % TAU;
    }
  }

  // ---- auto-quality: hold ~60 fps by ratcheting render resolution then samples down; grudging to
  // climb back (each forced drop doubles the wait). Drives perf.*, never the user's art. ----
  function resize(){
    const dpr=Math.min(2, window.devicePixelRatio||1)*perf.resScale;   // auto-quality scales the backing store
    const w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
  }
  function applyQuality(){
    if(!perf.auto){                                   // off -> restore the user's full quality
      perf.resScale = 1;
      if(perf.sampleCount !== params.sample_count){ perf.sampleCount = params.sample_count; regenSource(); }
      return;
    }
    const q = perf.quality, KNEE = 0.5, RES_MIN = 0.5, SAMP_MIN = 6;
    let res, samp;
    if(q >= KNEE){ res = lerp(RES_MIN, 1, (q-KNEE)/(1-KNEE)); samp = params.sample_count; }   // resolution first
    else         { res = RES_MIN; samp = Math.round(lerp(SAMP_MIN, params.sample_count, q/KNEE)); } // then samples
    perf.resScale = res;
    samp = clamp(samp, 3, Math.max(3, params.sample_count));
    if(samp !== perf.sampleCount){ perf.sampleCount = samp; regenSource(); }
  }
  function tunePerf(dtms, fps){
    perf.acc += dtms;
    if(perf.acc < 450) return;                        // re-evaluate the smoothed fps about twice a second
    perf.acc = 0;
    if(fps < 58){                                     // not holding 60 -> chase it down (1-tick debounce, so a
      perf.hiCount = 0;                               // lone hitch is ignored but a real shortfall is pursued)
      if(++perf.lowCount >= 2 && perf.quality > 0){
        perf.lowCount = 0;
        perf.quality = clamp(perf.quality - 0.08, 0, 1);
        perf.upWait = Math.min(240, perf.upWait * 2); // having had to drop, get MUCH less eager to climb back
        applyQuality();
      }
      return;
    }
    perf.lowCount = 0;                                // at/above the target
    // Climbing is deliberately grudging: only after a long unbroken run pinned at the cap (genuine
    // headroom), one small step — and that wait doubled every time we were forced down. [58,59.5): hold.
    if(fps > 59.5 && perf.quality < 1){
      if(++perf.hiCount >= perf.upWait){ perf.hiCount = 0; perf.quality = clamp(perf.quality + 0.04, 0, 1); applyQuality(); }
    } else perf.hiCount = 0;
  }

  // ---- render ----
  function drawTransport(){
    const E=params.canopy_extent_m;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(progTransport);
    gl.uniform3fv(U.tp.samples, src.flat.subarray(0, src.count*3));
    gl.uniform1i(U.tp.count, src.count);
    gl.uniform1fv(U.tp.heights, layerHeights());
    gl.uniform1i(U.tp.layerCount, params.layer_count);
    gl.uniformMatrix2fv(U.tp.proj, false, projMatrix());
    gl.uniform1f(U.tp.viewExtent, params.view_extent_m);
    gl.uniform1f(U.tp.aspect, canvas.width/canvas.height);
    gl.uniform2f(U.tp.origin, -E/2, -E/2);
    gl.uniform2f(U.tp.extent, E, E);
    gl.uniform3f(U.tp.sun, 1.0, 0.96, 0.88);
    const amb=params.ambient_skylight;
    gl.uniform3f(U.tp.ambient, 0.05*amb, 0.08*amb, 0.07*amb);
    gl.uniform1f(U.tp.exposure, params.exposure);
    gl.uniform1f(U.tp.contrast, params.contrast);
    gl.uniform1i(U.tp.tone, params.tone_map);
    for(let i=0;i<MAX_LAYERS;i++){ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, layerTex[i]); gl.uniform1i(U.tp.layers[i], i); }
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function drawLayerBlit(){
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(progBlit);
    const idx=clamp(params.show_layer_index|0,0,params.layer_count-1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, layerTex[idx]);
    gl.uniform1i(U.blit.tex,0);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function drawSourceInset(){
    const s=Math.round(Math.min(170, canvas.width*0.22));
    const x=canvas.width-s-8, y=canvas.height-s-8;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x,y,s,s); gl.viewport(x,y,s,s);
    gl.clearColor(0.03,0.04,0.06,1.0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progPoints);
    gl.uniform1f(U.pts.scale, 0.92/src.maxR);
    gl.uniform1f(U.pts.maxW, src.maxW);
    gl.bindVertexArray(srcDbgVAO);
    gl.drawArrays(gl.POINTS, 0, src.count);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,canvas.width,canvas.height);
  }

  // ---- the rebuild scopes the editor drives, plus a full param swap ----
  function rebuildAll(){ rebuildTextures(); regenCanopy(); bake(); regenSource(); }
  function resetPerf(){ perf.auto=!!params.auto_quality; perf.quality=1; perf.acc=0; perf.lowCount=0; perf.hiCount=0; perf.upWait=20; applyQuality(); }
  function apply(scope){
    if(scope==='source') regenSource();
    else if(scope==='bake') bake();                  // drift moves leaves at bake time only
    else if(scope==='canopy'){ regenCanopy(); bake(); }
    else if(scope==='textures'){ rebuildTextures(); regenCanopy(); bake(); }
    else if(scope==='perf') resetPerf();
  }
  function setParams(obj){
    if(!obj || typeof obj!=='object') return;
    const merged = Object.assign({}, DEFAULTS, obj);   // missing keys -> defaults (forward-compat)
    for(const k in DEFAULTS) params[k] = merged[k];
    rebuildAll();
    resetPerf();                                       // a preset may carry auto-quality
  }

  // ---- init + frame loop ----
  rebuildAll();
  resetPerf();
  let last=performance.now(), fps=60;
  const eng = { canvas, gl, params, perf, motion, src, fps:60, apply, setParams, drawSourceInset, onFrame:opts.onFrame||null };
  function frame(now){
    const dtms=now-last; last=now; fps += ((1000/Math.max(dtms,1))-fps)*0.1; eng.fps=fps;
    if(perf.auto) tunePerf(dtms, fps);               // auto-quality: nudge resolution/samples toward 60 fps
    resize();
    if(motionActive()){ tick(dtms/1000); bake(); }   // advance + re-bake only when something moves
    if(params.show_layer) drawLayerBlit(); else drawTransport();
    if(eng.onFrame) eng.onFrame(dtms);               // editor draws HUD + source inset here
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return eng;
}

return { create, PRESETS: BUILTIN_PRESETS, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG };
})();
