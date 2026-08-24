import { DEG, TAU, lensArea, FAITH_MAX_RATIO, clamp, lerp, smoothstep, lerpAngle, atmosphere, mulberry32, makeGauss, hash3, fbm1, WIND_PATTERNS, windNoise, coneDir, bendDown } from './komorebi-math.js';
import { MAX_SAMPLES, BAKE_MIN, MAX_LAYERS, MAX_OCC, SKY_SUN_GAIN, MORPH_KEYS, MORPH_SET, ANGLE_SET, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS, CANOPY_MORPH_MAX, CROSS_HALF_W, BLOOM_MAX, DUR_SCALE, DEFAULTS, migrateLegacy } from './komorebi-params.js';
import { VS_BAKE, FS_BAKE, VS_FAITH, FS_FAITH, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_FULL, FS_BLIT, FS_PRESENT, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ } from './komorebi-shaders.js';
import { TRANSPORT_GROUPS, CAMERAS, GROUP_UPLOAD_KEYS, buildTransport } from './komorebi-transport.js';

// Build flag. Raw/dev ES-module loads keep EDITOR=true; the player deploy bundle sets it false via
// `bun build --define:KOMOREBI_EDITOR=false`, which const-folds and dead-strips the editor-only debug
// overlays (their shaders, buffers, draw fns). typeof keeps an undefined-global load safe (= true).
const EDITOR = (typeof KOMOREBI_EDITOR !== "undefined") ? KOMOREBI_EDITOR : true;

// ===========================================================================
// create(canvas, opts) — one self-contained engine instance on a canvas.
// ===========================================================================
function create(canvas, opts){
  opts = opts || {};
  const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, premultipliedAlpha:false });
  function fail(msg){ throw new Error(`komorebi: ${msg}`); }
  if (!gl) fail('WebGL2 is required and not available in this browser.');
  const extCBF = gl.getExtension('EXT_color_buffer_float');     // renderable half/float
  gl.getExtension('EXT_float_blend');                            // genuinely OPTIONAL: it only governs blending into *32-bit* float
                                                                 // targets. Every blend target here is RGBA16F (makeLayerTexture: the
                                                                 // layers, faithTex, faithScratch), which is color-renderable AND
                                                                 // blendable in core WebGL2 once EXT_color_buffer_float is present.
                                                                 // The only RGBA32F textures (clusterTex/clusterGeomTex) are data
                                                                 // textures, texelFetch-sampled, never blended — so do NOT promote this
                                                                 // to a hard requirement (it would reject capable 16F-blend devices).
  if (!extCBF) fail('EXT_color_buffer_float is required (float render targets).');
  const MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;  // caps the per-clump data-texture width
  // profiling (EDITOR only): GPU timer queries for absolute per-pass ms. The extension is often absent or
  // coarsened by browsers for privacy — callers must tolerate null (the editor falls back to the stress
  // burst). EXT_disjoint_timer_query_webgl2 measures TIME_ELAPSED over a range of GL commands.
  const extTimer = EDITOR ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;

  const params = Object.assign({}, DEFAULTS, migrateLegacy(opts.params) || {});
  // Auto-quality runtime throttle (driven by the params.auto_quality toggle). Holds the live
  // resolution / sample-count it trims to. Never touches the artistic params.
  const perf = { auto:false, quality:1, resScale:1, sampleCount:params.sample_count, bres:0, acc:0, lowCount:0, hiCount:0, upWait:20, glow:false };  // bres = size the layer textures are currently built at (so applyQuality knows when to reallocate); glow = the lateral-diffusion tier actually ran this frame (false when gated off OR when its 16F targets came back incomplete)
  // Motion — one time-driven state, two bands (spec §5). u = longitudinal sway fraction (signed, along the
  // effective wind), uLat = lateral (crosswind) sway fraction; each its own spring. windX/Y = the effective
  // wind direction after the weather veer; weatherS = the live weather strength multiplier (read by the HUD);
  // driveEnv = the asymmetric-edged longitudinal force; env = [0,1] gust intensity for the hierarchy breathing.
  const motion = { time:0, u:0, v:0, uLat:0, vLat:0, env:0, driveEnv:0, sway:[0,0], windX:1, windY:0, weatherS:1 };
  // Transition — cloud-bloom crossfade between looks (spec §9). t walks 0->1 over dur: the continuous
  // params morph, the grove swaps once at the bloom peak, and `bloom` is a transient overcast that hides it.
  const trans = { active:false, t:0, dur:1.5, durScale:1, bloomMax:1, crossfade:false, from:null, to:null, swapped:false, structDiff:false, canopyMorph:false, bloom:0, onEnd:null };
  const effCloud = () => clamp(lerp(params.cloud_thickness, 1, trans.bloom), 0, 1);  // cloud, swollen toward overcast mid-transition
  const bakeBaseline = () => (params.bake_resolution > 0 ? params.bake_resolution|0 : params.tex_resolution|0);  // TUNE §9: decoupled bake size; 0 follows tex_resolution.
  // Live bake / layer-texture size. Pure function of quality + params: when auto_quality is engaged it trims the
  // bake below the knee (q<0.5) alongside samples, snapped to 256 so the textures only reallocate at a level
  // boundary — not on every fps nudge. rebuildTextures/bake both read this (transport samples by UV → smaller = softer).
  const bakeRes = () => {
    const full = bakeBaseline();
    if(!perf.auto || perf.quality >= 0.5) return full;
    return clamp(Math.round(lerp(BAKE_MIN, full, perf.quality/0.5)/256)*256, BAKE_MIN, full);
  };
  // IS THE FAITHFUL TIER ACTUALLY RUNNING? The flag alone no longer answers it, so nothing reads the flag directly:
  // the faithful bake pre-integrates the whole cast into ONE texture in ONE frame — floor (x,y) or cloth (u,v) — and
  // the ENCLOSURE's receiver is neither, it is a per-pixel ray cast onto sloped panels. So receiver 2 forces the
  // LAYER path, which is the general-geometry tier: it re-projects per pixel from (world, recvZ) and therefore works
  // on any receiver at all. That is not a downgrade here — at enclosure distances the cast is deep in the pinhole
  // regime (metres of occluder height against a fabric a metre or two off), where the layer tier's height
  // quantization is invisible under the disk blur. The cheap path is the correct path in this branch.
  // THE SKY VIEW is out for the same reason, one step further: it has no cast frame at all — it reads the occluder
  // field along the EYE's rays, and the faithful texture is a pre-integration along the SUN's. There is nothing for
  // a single tap to be a tap of.
  // ONE predicate, read by every path decision (bake dispatch, texture sizing, the .z packing convention, the
  // twig-hug, auto-quality's cost model, show_layer, and the uFaithful uniform), because those must agree per frame
  // or the layer bake reads faithful-packed cluster data and the leaves slide off their twigs. Safe to be a derived
  // value rather than state because both `receiver` and `sky_view` are MODE_KEYS flags: a flip forces the full rebuild.
  const faithfulOn = () => params.faithful_canopy && (params.receiver|0) !== 2 && !params.sky_view;

  function compile(type, src){
    const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) fail(`Shader: ${gl.getShaderInfoLog(s)}\n${src}`);
    return s;
  }
  function program(vs,fs){
    const p=gl.createProgram();
    gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));
    gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) fail(`Link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }
  const progBake = program(VS_BAKE, FS_BAKE);
  const progFaith = program(VS_FAITH, FS_FAITH);   // FAITHFUL leaf bake (§4.5): per-sample transmittance at continuous heights
  const progFaithSeg = program(VS_FAITH_SEG, FS_FAITH_SEG);   // FAITHFUL skeleton bake (§4.5): trunk+branches+twigs as geometry
  const progFAcc = program(VS_FULL, FS_FACC);      // FAITHFUL accumulate: Σ w_i·transmittance_i
  const progBlit = program(VS_FULL, FS_BLIT);
  const progPresent = program(VS_FULL, FS_PRESENT);                   // adaptive frame-rate: offscreen frame -> screen
  const progGlowBlur = program(VS_FULL, FS_GLOW_BLUR);                // lateral diffusion (§4.9): one axis of the separable spread
  const progGlowMix = program(VS_FULL, FS_GLOW_MIX);                  // lateral diffusion: the sharp/blurred split + the relocated tone-map tail
  const progPoints = EDITOR ? program(VS_POINTS, FS_POINTS) : null;   // editor-only debug-overlay programs
  const progViz = EDITOR ? program(VS_VIZ, FS_VIZ) : null;

  const U = {};
  function loc(prog, name){ return gl.getUniformLocation(prog, name); }
  U.bake = { origin:loc(progBake,'uCanopyOrigin'), extent:loc(progBake,'uCanopyExtent'), edge:loc(progBake,'uEdge'),
             morph:loc(progBake,'uMorph'), morphAmount:loc(progBake,'uMorphAmount'), sway:loc(progBake,'uSway'),
             windLevel:loc(progBake,'uWindLevel'), windTime:loc(progBake,'uWindTime'),
             leafSwing:loc(progBake,'uLeafSwing'), flutterFreq:loc(progBake,'uFlutterFreq'), stemLen:loc(progBake,'uStemLen'),
             clusterTex:loc(progBake,'uClusterTex'), clusterGeom:loc(progBake,'uClusterGeom'),
             coverage:loc(progBake,'uCoverage') };
  U.faith = { origin:loc(progFaith,'uFaithOrigin'), extent:loc(progFaith,'uFaithExtent'), g:loc(progFaith,'uG'), edge:loc(progFaith,'uEdge'),
              curtainBake:loc(progFaith,'uCurtainBake'), clothY:loc(progFaith,'uClothY'),
              morph:loc(progFaith,'uMorph'), morphAmount:loc(progFaith,'uMorphAmount'), sway:loc(progFaith,'uSway'), hRef:loc(progFaith,'uHRef'),
              windLevel:loc(progFaith,'uWindLevel'), windTime:loc(progFaith,'uWindTime'),
              leafSwing:loc(progFaith,'uLeafSwing'), flutterFreq:loc(progFaith,'uFlutterFreq'),   // (uStemLen removed: faithful dropped the twig-swing that used it)
              clusterTex:loc(progFaith,'uClusterTex'), clusterGeom:loc(progFaith,'uClusterGeom') };
  U.faithSeg = { origin:loc(progFaithSeg,'uFaithOrigin'), extent:loc(progFaithSeg,'uFaithExtent'), g:loc(progFaithSeg,'uG'), woodTau:loc(progFaithSeg,'uWoodTau'),
                 curtainBake:loc(progFaithSeg,'uCurtainBake'), clothY:loc(progFaithSeg,'uClothY'),
                 segSway:loc(progFaithSeg,'uSegSway'), segTau:loc(progFaithSeg,'uSegTau') };
  U.facc = { tex:loc(progFAcc,'uFAccTex'), weight:loc(progFAcc,'uFAccWeight') };
  // ---- THE TRANSPORT PROGRAM CACHE (spec §4.6/§4.9). One program per camera, built by buildTransport, compiled on
  // FIRST USE and then kept for the engine's life. Four is the whole space, and the build key only moves on a MODE
  // flip (sky_view / receiver), which already tears the grove down and rebuilds it under the transition bloom — so
  // the one first-compile a camera ever costs lands inside that bloom, where a frame's hitch is already hidden, and
  // never recurs. Nothing is shared across engines: an A/B wipe's second instance has its own GL context and builds
  // its own cache, because a program belongs to the context that linked it. ----
  const transportCache = new Map();
  // Which variant this draw runs. The same order the old mega-shader's branch chain read, and it can only change
  // across a structural rebuild: sky_view and receiver are both MODE_KEYS.
  const transportCamera = () => params.sky_view ? 'sky' : (params.receiver|0) === 2 ? 'enclosure' : (params.receiver|0) !== 0 ? 'cloth' : 'floor';
  // The per-variant location table, read straight off the registry: a variant's table holds exactly the keys its
  // groups declare, and nothing else. That is what lets the upload skip by GROUP rather than by null-checking a
  // location — a uniform that genuinely goes missing surfaces as a missing one instead of hiding among a dozen
  // deliberate nulls.
  function transportLocs(prog, camera){
    const u = {};
    for(const name of CAMERAS[camera].groups){
      const locs = TRANSPORT_GROUPS[name].locs;
      if(!locs) continue;                                    // a functions-only group (the taps, the fold field, the warp)
      for(const key in locs){
        const n = locs[key];
        u[key] = Array.isArray(n) ? n.map(one => loc(prog, one)) : loc(prog, n);
      }
    }
    return u;
  }
  function transportFor(camera){
    let e = transportCache.get(camera);
    if(!e){
      const prog = program(VS_FULL, buildTransport(camera));
      e = { prog, U: transportLocs(prog, camera) };
      transportCache.set(camera, e);
    }
    return e;
  }
  U.blit = { tex:loc(progBlit,'uTex') };
  U.present = { tex:loc(progPresent,'uTex') };
  U.glowBlur = { tex:loc(progGlowBlur,'uTex'), step:loc(progGlowBlur,'uStep') };
  U.glowMix = { sharp:loc(progGlowMix,'uSharp'), blur:loc(progGlowMix,'uBlur'), diffuse:loc(progGlowMix,'uDiffuse'),
                exposure:loc(progGlowMix,'uExposure'), contrast:loc(progGlowMix,'uContrast'), tone:loc(progGlowMix,'uToneMap') };
  if(EDITOR){   // editor-only debug-overlay uniforms
    U.pts = { scale:loc(progPoints,'uScale'), maxW:loc(progPoints,'uMaxW') };
    U.viz = { point:loc(progViz,'uPoint'), pointAlpha:loc(progViz,'uPointAlpha'), lineAlpha:loc(progViz,'uLineAlpha') };
  }

  // ---- geometry / GPU buffers ----
  const emptyVAO = gl.createVertexArray();           // required to issue attrib-less draws
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  // editor-only debug-overlay buffers (source point cloud + tree-preview inset); skipped in the player build
  let srcDbgBuf=null, srcDbgVAO=null, vizBuf=null, vizVAO=null;
  if(EDITOR){
    srcDbgBuf = gl.createBuffer();
    srcDbgVAO = gl.createVertexArray();
    gl.bindVertexArray(srcDbgVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, srcDbgBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,12,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,1,gl.FLOAT,false,12,8);
    gl.bindVertexArray(null);

    // tree-preview inset buffer: interleaved (pos.xy, col.rgb, size) — 6 floats/vertex, refilled per frame
    vizBuf = gl.createBuffer();
    vizVAO = gl.createVertexArray();
    gl.bindVertexArray(vizVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, vizBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,24,20);
    gl.bindVertexArray(null);
  }

  const bakeFBO = gl.createFramebuffer();
  const faithFBO = gl.createFramebuffer();   // FAITHFUL scratch target (§4.5): faithScratch attached here once per bake so the per-sample loop swaps FBOs instead of re-attaching (was 2N framebufferTexture2D/frame)
  let layerTex = [];           // MAX_LAYERS textures (active sized, inactive 1x1)
  let layerVAO = [];           // per-layer leaf instance VAOs {vao,count,buf}
  let faithTex = null;         // FAITHFUL path (§4.5): pre-integrated soft shadow (RGBA16F); 1×1 when faithful_canopy off
  let faithScratch = null;     // FAITHFUL path: per-sample transmittance scratch (RGBA16F); 1×1 when off
  let hier = null;             // branch hierarchy: limb + twig spring state (built in regenCanopy)
  let groveIn = null;          // the INCOMING grove during a crossfade (§9): grown early, baked alongside the active one, installed when the window closes
  let crossW = 0;              // its coverage share, 0 -> 1 across the window
  let grove = null;            // the ACTIVE grove value (hier + layerVAO + its two data textures); the views above point into it
  let clusterTex = null;       // per-clump dynamic bend angles (limb, twig), updated each frame
  let clusterGeomTex = null;   // per-clump static geometry (clump centre + trunk pivot)
  let benchFBO=null, benchTex=null, benchW=0, benchH=0;   // profiler stress-burst target (EDITOR; hoisted here so dispose() can free it)
  // adaptive frame-rate (TUNE §9): offscreen present target + cadence state. presentFBO/presentTex are canvas-sized
  // and allocated lazily on first use (so a look that never enables adaptive_motion pays nothing).
  let presentFBO=null, presentTex=null, presentW=0, presentH=0, adaptiveLastRender=0, adaptiveHot=true;
  const ADAPT_HI=0.05, ADAPT_LO=0.02;   // hysteresis on the motion magnitude: above HI render every frame, below LO drop to idle_fps
  // lateral diffusion (§4.9): [0] = transport's LINEAR-HDR frame (the sharp one), [1]/[2] = the separable blur's
  // ping/pong. RGBA16F at the render size, one FBO each (attached once at allocation, so no per-frame re-attach),
  // allocated lazily on first use and reallocated on resize — a look that never opens the gate holds no VRAM.
  const glowFBO=[null,null,null], glowTex=[null,null,null];
  let glowW=0, glowH=0, glowFail=false;   // glowFail LATCHES an incomplete FBO: the tier then silently stops being offered (perf.glow stays false) and every frame takes the direct path
  const GLOW_TAPS = 6;                    // 13 taps: centre + this many each side. NOT independently tunable — FS_GLOW_BLUR's weight table is computed for exactly this count; change one and recompute the other
  const GLOW_STEP_MAX = 6.0;              // px between taps — the cap that trades reach for a clean kernel (see FS_GLOW_BLUR)
  const src = { flat:new Float32Array(0), count:0, maxR:1, maxW:1, haloR:0.01,
                coreR:0.005, moonD:0, moonR:0, Lcore:0, Lhalo:0 };   // + the SEEN source (§4.9 sky view): angular radii, the eclipse moon, and the radiance in each region — all filled by regenSource from the sampler's own numbers
  const occ = { rest:[], ht:new Float32Array(0), segBuf:new Float32Array(MAX_OCC*4), count:0, want:0, hRef:1 };   // woody occluder (trunk + main limbs): `rest` segments {ax..py} regrown, `ht` static (heights+radius), `segBuf` refilled per frame with the limb bend, `hRef` = tallest floor height for the drift's height-scale (spec §4.5)
  // ...and the GPU side of that table (§4.5/§6): one RGBA32F, MAX_OCC wide and 2 tall — row 0 the swung plan
  // endpoints, row 1 the static heights + radius. Allocated once at the cap and never resized, because the cap is a
  // compile-time constant on both sides of the wire. This is the clusterTex idiom, for the same reason: a per-frame
  // table that every transport variant reads has no business sitting in the fragment uniform budget.
  const occTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, occTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_OCC, 2, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);   // texelFetch ignores filtering, but an unfilterable float texture must still declare NEAREST to be complete
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const faith = { vao:null, buf:null, count:0, hMin:0, hMax:1, ox:0, oy:0, ext:1,   // FAITHFUL leaf geometry (all leaves, continuous height) + the cast-region frame, computed in bakeFaithful (§4.5)
                  pminx:0, pmaxx:0, pminy:0, pmaxy:0,                                // real plan AABB of leaves+wood (regenCanopy) → cast-frame bound, so a wide grove's outer crown isn't clipped
                  gx:new Float32Array(MAX_SAMPLES), gy:new Float32Array(MAX_SAMPLES),// per-sample ground-shift scratch (hoisted; no per-bake alloc)
                  segVAO:null, segBuf:null, segRest:[], segArr:null, segCount:0 };   // + the woody skeleton (trunk+branches+twigs): rest segments, the per-bake swayed instance array, its VAO
  // SKY VIEW's share of that skeleton (§4.9): the FINE wood (level > 1) the analytic occluder never carries, sorted
  // into the leaves' own depth layers so a twig and the leaves hanging on it stamp into the SAME texture. Built
  // only when the look-up camera is on; empty otherwise, and the layer bake then draws nothing extra.
  const sky = { segVAO:null, segBuf:null, segRest:[], segArr:null, start:[], count:[] };

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
    layerTex.forEach(t=>{ gl.deleteTexture(t); });
    layerTex = [];
    const res = bakeRes();
    perf.bres = res;                                 // remember the built size; applyQuality reallocates when bakeRes() crosses it
    for(let i=0;i<MAX_LAYERS;i++){
      // faithful mode never bakes or samples the layer textures (transport taps faithTex once), so size them 1×1
      // there too — saves ~layer_count·res²·8 bytes of dead VRAM (≈16 MB at defaults). Reallocated full when faithful off.
      layerTex.push(makeLayerTexture((i < params.layer_count && !faithfulOn()) ? res : 1));
    }
    // FAITHFUL path (§4.5): the soft-shadow accumulator + per-sample scratch. 1×1 when off, so the park / layer
    // path allocates nothing extra; full bake-res when faithful_canopy is on.
    if(faithTex) gl.deleteTexture(faithTex);
    if(faithScratch) gl.deleteTexture(faithScratch);
    const fres = faithfulOn() ? res : 1;
    faithTex = makeLayerTexture(fres);
    faithScratch = makeLayerTexture(fres);
  }

  // ---- canopy generation: grow a real recursive skeleton, hang one leaf cluster on each
  // terminal twig, and bin them into depth layers by the height they grew to (spec §4.5) ----
  // ---- BUILD A GROVE (spec §4.5/§9). Pure in the sense that matters: it allocates and returns a grove, it does
  // not install one. That is what lets a transition hold TWO — the outgoing one still drawing while the incoming
  // one is grown — instead of the midpoint swap being the only way a topology change can happen.
  // (occ and faith are still written straight to engine state below. They belong to the ACTIVE grove, and the
  // crossfade's gate excludes both of their consumers — wood needs branch_tau > 0, faith needs faithfulOn() —
  // so a second grove never needs its own copy of either. If that gate ever widens, they move in here too.)
  function buildGrove(prevHier){
    const layerVAO = [];   // this grove's own; the OUTGOING grove's GL objects are freed by installGrove, not here
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
    const TAU2 = Math.PI*2;

    // ---- grow a GROVE: tree_count trees whose trunks spread across the view region with overlapping
    // crowns. Each tree is a trunk -> limb_count arms (rising by branch_pitch, fanned around the
    // circle) -> branch_children sub-branches per node (cone-fanned, shrunk by branch_length_ratio)
    // recursing branch_levels deep; TERMINAL branches are twigs, each carrying one leaf cluster. Big
    // gaps fall between limbs, small gaps between leaves — multi-scale, for free (spec §4.5). A grove
    // (not one centred tree) fills the centre and matches the park: several trees, the smaller ones
    // reading denser (the same cluster packed into a smaller crown). ----
    // tree_count is CONTINUOUS so a tree-count transition can morph (spec §4.5/§9): floor(count) full trees
    // plus a marginal tree faded in by the fraction. At an integer count it's exactly floor trees, no partial.
    const treeCountF = Math.max(1, params.tree_count);
    const nFull  = Math.floor(treeCountF);
    const tFrac  = treeCountF - nFull;                  // marginal-tree coverage; 0 at integer counts
    const nTree  = nFull + (tFrac>1e-4 ? 1 : 0);        // trees actually built this frame
    const lpt    = Math.max(1, params.limb_count|0);   // limbs per tree
    const levels = Math.max(1, params.branch_levels|0);
    const kids   = Math.max(1, params.branch_children|0);
    const lenRatio = clamp(params.branch_length_ratio, 0.2, 0.95);
    const coneA  = params.branch_angle_deg*DEG;
    const limbEl = params.branch_pitch_deg*DEG;        // how steeply limbs rise from horizontal
    const nLimb  = nTree*lpt;                           // global limb count
    const gr = mulberry32(hash3(params.seed>>>0, 0x5EED, 7));   // growth stream (own RNG)
    const segments = [];     // {a,b,level} world-space skeleton, kept for the 3D view ([3])
    const twigs = [];        // terminal nodes: {x,y,z, limb, tx,ty} — plan x,y, height z, global limb, tree trunk
    const limbDir  = new Float32Array(nLimb*2);         // plan unit direction (drives wind torque)
    const limbPlan = new Float32Array(nLimb*2);         // an outboard wind-sample point near each limb
    const limbAttach = new Float32Array(nLimb);         // the height at which each limb MEETS its trunk — sway_pitch anchors its depth-foreshorten here so the join can't open (§5.1). Filled LOCAL in the growth loops, then scaled into world height units with the rest of the tree.

    // crowns overlap so the canopy fills the VIEW (not just the baked extent): the fill radius is tied
    // to view_extent (so the grove fills the frame regardless of zoom), capped to fit inside the bake.
    const golden = Math.PI*(3 - Math.sqrt(5));
    const Rfill = Math.min(E*0.46, Math.max(0.5, params.view_extent_m));
    // crown radius. PARK model: tied to the view so crowns fill the frame. STANDING scene (§4.8): a natural,
    // fixed fraction of the bake extent instead — so a single tree's crown fits the texture (the view-tied size
    // overflows and clips it) and the tree reads as a discrete object, not a frame-filling canopy.
    const crown0 = params.standing_scene ? E*0.26 : (Rfill/Math.sqrt(treeCountF))*1.7;
    const trunkH = crown0*0.6;                          // a real trunk lifts each crown off the ground.
    // It's a CONSTANT (same for every tree), so it only offsets z uniformly — the relative layer-binding
    // below is unchanged, i.e. the cast dapples are untouched; only the 3D structure/preview gains height.

    const L = clamp(params.leader_strength, 0, 1);   // 0 = legacy single-hub; >0 = monopodial leader (limbs ALONG a trunk)
    const droop = clamp(params.droop, -1, 1);        // signed gravitropic curve: >0 sag down (willow/birch), <0 upsweep (conifer); 0 = straight rays
    const phyllo = params.phyllotaxis==='opposite' ? 2 : params.phyllotaxis==='whorled' ? 1 : 0;   // child-azimuth rule (§4.5)

    function grow(out, base, dir, len, level, limb){
      // index the twig this call will bear, if it is a terminal one — the segments pushed below are that twig's
      // OWN wood, and the faithful bake must swing them about the same joint, by the same angle, as its leaves (§5.4).
      const twIdx = (level >= levels) ? out.tw.length : -1;
      // droop/upsweep (spec §4.5): curve the branch toward gravity over a few SUB-SEGMENTS — a smooth arc, not a
      // straight ray and not a single kink. Stronger on outer orders (level/levels), and children inherit the
      // curved END-TANGENT, so the sag compounds toward the tips (the willow cascade / birch trail). 0 = straight.
      const dLevel = droop * (level/levels);
      let tip, endDir = dir;
      if(Math.abs(dLevel) > 1e-3){
        const nSub = Math.min(6, 1 + Math.round(Math.abs(dLevel)*5));
        const dl = len/nSub, dth = dLevel*1.9/nSub;        // total curve ≈ dLevel·1.9 rad over the branch length
        let p = base, d = dir;
        for(let sx=0;sx<nSub;sx++){
          d = bendDown(d, dth);                            // tilt the heading toward −z (down) in its own vertical plane
          const np = [ p[0]+d[0]*dl, p[1]+d[1]*dl, p[2]+d[2]*dl ];
          // f0/f1 = this sub-segment's fractional span of the ONE level→level+1 taper step, so the faithful skeleton
          // thins SMOOTHLY along a drooping branch instead of resetting the full step per sub-segment (a sawtooth).
          out.seg.push({ a:p, b:np, level, limb, f0:sx/nSub, f1:(sx+1)/nSub, tw:twIdx });
          p = np;
        }
        tip = p; endDir = d;
      } else {
        tip = [ base[0]+dir[0]*len, base[1]+dir[1]*len, base[2]+dir[2]*len ];
        out.seg.push({ a:base, b:tip, level, limb, f0:0, f1:1, tw:twIdx });   // straight branch: full step (byte-identical)
      }
      // bx,by = the twig's REAL base: where this terminal branch attaches to its parent. It is the joint the whole
      // twig (wood + the leaves on it) turns about under the medium band, and — being offset from the clump toward
      // the parent by GROWTH — it is a genuine stem joint, so §5.1's anti-vortex property holds without uStemLen.
      if(level >= levels){ out.tw.push({ x:tip[0], y:tip[1], z:tip[2], limb, dx:endDir[0], dy:endDir[1], bx:base[0], by:base[1] }); return; }   // dx,dy = twig heading (plan) so leaves can hug the twig, not scatter as a blob
      // phyllotaxis (§4.5): how children fan around the parent. opposite forces PAIRED forks; whorled an even ring; spiral the golden angle.
      const nKids = (phyllo===2) ? 2 : kids;
      for(let c=0;c<nKids;c++){
        let az, spread;
        if(phyllo===2){       az = level*1.5707963 + c*Math.PI + (gr()-0.5)*0.08;  spread = coneA*(0.9+0.12*gr()); }   // opposite/decussate: a symmetric Y, plane flipped 90° each level
        else if(phyllo===1){  az = (c+0.5)/nKids*TAU2 + (gr()-0.5)*0.15;           spread = coneA*(0.7+0.5*gr()); }   // whorled: even ring (conifer tiers)
        else {                az = (L>0 ? c*golden : (c+0.5)/nKids*TAU2) + (gr()-0.5)*(L>0?0.4:1.2); spread = coneA*(0.55+0.9*gr()); }   // spiral / legacy fan
        grow(out, tip, coneDir(endDir, az, spread), len*lenRatio*(0.8+0.4*gr()), level+1, limb);
      }
    }

    for(let tt=0;tt<nTree;tt++){
      // trunk placement: Vogel disk so trees spread evenly; the first tree sits at the centre.
      const treeCov = (tt===nFull) ? tFrac : 1.0;        // the marginal tree fades in by coverage (1 for full trees)
      const rr = Rfill*Math.sqrt(tt/treeCountF);         // normalise by the continuous count -> trees re-space smoothly as it morphs
      const aa = tt*golden + (gr()-0.5)*0.6;
      const tx = rr*Math.cos(aa), ty = rr*Math.sin(aa);
      const crown = crown0*(0.7+0.6*gr());               // per-tree size variation (smaller -> denser)
      const out = { seg:[], tw:[] };
      const limbBase = tt*lpt, limbRaw = new Float32Array(lpt*2);
      let leaderTop = 0, limbTop = 0;   // limbTop = highest limb-attach height (local); the trunk must at least reach it
      if(L>0){
        // MONOPODIAL (spec §4.5): limbs attach at staggered heights ALONG a continuing trunk axis (plan-centre),
        // so the branches actually MEET the trunk. leader_strength sends the origins UP the bole and shortens
        // limbs toward the top (acrotony → excurrent cone); low values keep them low (a few near-base forks →
        // decurrent dome). This replaces the single-origin hub AND the de-dandelion hack with the real mechanism.
        const boleH = 0.8;                               // BARE BOLE below the crown (local units) — a real trunk, so the tree isn't foliage-to-the-ground (a bush)
        const hLo = boleH, hHi = boleH + (1.0 + 0.6*L);  // crown band sits ABOVE the bole; taller for a stronger leader
        limbTop = hHi;                                   // the topmost limb attaches near hHi — the trunk must reach here
        for(let i=0;i<lpt;i++){
          const gi = limbBase+i;
          const f = (i+0.5)/lpt;                         // 0..1 up the limb set
          const h = hLo + (hHi-hLo)*f;                   // attach height ON the trunk axis, above the bole
          limbAttach[gi] = h;                            // (local; scaled below)
          const azGeo = i*golden + (gr()-0.5)*0.3;       // phyllotaxis spiral (geometry)
          const pitch = limbEl*(1 + 0.4*L*f);            // steeper toward the apex → a tighter cone
          const ce = Math.cos(pitch), se = Math.sin(pitch);
          const len = (0.4+0.2*gr())*(1 - 0.45*L*f);     // limbs SHORTER than the crown is tall → narrow crown on a tall trunk, not a bush; acrotony shortens toward the apex
          const dir = [ce*Math.cos(azGeo), ce*Math.sin(azGeo), se];
          // wind torque rides a BALANCED fan (decoupled from the spiral) so a gust still LEANS, never spins (§5.1)
          const azBal = (i+0.5)/lpt*TAU2 + (gr()-0.5)*(TAU2/lpt)*0.6;
          limbDir[2*gi]=Math.cos(azBal); limbDir[2*gi+1]=Math.sin(azBal);
          limbRaw[2*i]=Math.cos(azGeo)*len; limbRaw[2*i+1]=Math.sin(azGeo)*len;
          grow(out, [0,0,h], dir, len, 1, gi);
        }
      } else {
        // legacy single-hub: every limb from one point (the palm/lollipop) — kept as the leader_strength=0 case
        for(let i=0;i<lpt;i++){
          const gi = limbBase+i;
          const azL = (i+0.5)/lpt*TAU2 + (gr()-0.5)*(TAU2/lpt)*0.6;
          const ce = Math.cos(limbEl), se = Math.sin(limbEl);
          const dir = [ce*Math.cos(azL), ce*Math.sin(azL), se];
          const len = 0.7+0.5*gr();
          limbDir[2*gi]=Math.cos(azL); limbDir[2*gi+1]=Math.sin(azL);
          limbRaw[2*i]=dir[0]*len; limbRaw[2*i+1]=dir[1]*len;
          limbAttach[gi] = 0;                            // the hub IS the attach point (local 0); zLift below puts it at the trunk top
          grow(out, [0,0,0], dir, len, 1, gi);
        }
      }
      // normalise the crown's PLAN extent to `crown` and lift onto the trunk. A monopodial tree carries its own
      // height (limbs are up the bole), so it scales z with the plan and stands on the ground; the legacy hub
      // lifts its whole crown by trunkH.
      let mr=1e-3, mz=1e-3; for(const w of out.tw){ mr=Math.max(mr, Math.hypot(w.x,w.y)); mz=Math.max(mz, w.z); }
      const s = crown/mr;   // PLAN fill (x,y): the widest twig → crown radius
      // HEIGHT scale (§4.5): the old code scaled z by this same s, but s = crown/mr EXPLODES for a narrow-plan tree
      // (steep branches → tiny mr → s of 6+), which — now that the faithful cast uses real z — made columnar ~47m,
      // palm ~16m. Floor the plan radius at mz/RATIO for the HEIGHT scale only: a broad tree (mr above the floor) is
      // UNCHANGED (sV == s, height preserved), a narrow tree is clamped to height = crown·RATIO·aspect. x/y keep s.
      const sV = crown/Math.max(mr, mz/FAITH_MAX_RATIO);
      // trunk top scales with leader_strength (§4.5): a weak leader (decurrent) ends DOWN in the crown at the highest
      // limb attach; a strong leader (excurrent) reaches the foliage apex. Always ≥ limbTop so every limb meets the trunk.
      if(L>0) leaderTop = limbTop + (mz - limbTop)*L;
      const aspect = clamp(params.crown_aspect, 0.4, 3);   // crown height factor (§4.5): scales crown height (narrow trees capped via sV above). Drives the faithful cast + 3D preview; the LAYER cast normalises height away (invariant).
      // scale the legacy-hub lift by aspect too, so an L=0 tree is a TRUE uniform z-scale: otherwise crown_aspect
      // leaks into the layer-mode wood (floorH's bole division assumes a pure scale), breaking the "invisible to the
      // layer cast" invariant for hub trees. aspect=1 (the default and every shipped look) → byte-identical. (§4.5)
      const zLift = (L>0) ? 0 : trunkH*aspect;
      const sc = (p) => [ p[0]*s+tx, p[1]*s+ty, p[2]*sV*aspect+zLift ];
      const twBase = twigs.length;   // this tree's first global twig index — turns grow()'s per-tree tw into the global clump id
      // the twig BASE must ride the very same plan transform as the tip (sc's x,y half), or the shared pivot lands
      // off the wood; it is plan-only because the bend is 2-D yaw, so no z scale is needed.
      for(const w of out.tw){ const q=sc([w.x,w.y,w.z]); w.x=q[0]; w.y=q[1]; w.z=q[2]; w.bx=w.bx*s+tx; w.by=w.by*s+ty; w.tx=tx; w.ty=ty; w.tcov=treeCov; w.tree=tt; twigs.push(w); }
      for(const sg of out.seg){ segments.push({ a:sc(sg.a), b:sc(sg.b), level:sg.level, cov:treeCov, tree:tt, limb:sg.limb, px:tx, py:ty, f0:sg.f0||0, f1:(sg.f1!=null?sg.f1:1), clump:(sg.tw>=0 ? twBase+sg.tw : -1) }); }
      const trunkTop = (L>0) ? leaderTop*sV*aspect : trunkH*aspect;
      segments.push({ a:[tx,ty,0], b:[tx,ty,trunkTop], level:0, cov:treeCov, tree:tt, limb:-1, px:tx, py:ty, f0:0, f1:1, clump:-1 });   // the continuing trunk axis
      for(let i=0;i<lpt;i++){ const gi=limbBase+i;
        limbPlan[2*gi]=limbRaw[2*i]*s*0.6+tx; limbPlan[2*gi+1]=limbRaw[2*i+1]*s*0.6+ty;
        limbAttach[gi]=limbAttach[gi]*sV*aspect+zLift; }   // the attach height must ride the IDENTICAL z transform sc() gives every twig/segment, or the anchor sits off the wood it is meant to hold onto
    }
    if(twigs.length > MAX_TEX) twigs.length = MAX_TEX;   // cap the per-clump data-texture width to the GPU limit

    // ---- map grown heights into the layer band: bin each twig to a layer by its height ----
    let zMin=1e18, zMax=-1e18;
    for(const t of twigs){ zMin=Math.min(zMin,t.z); zMax=Math.max(zMax,t.z); }
    const dz = (zMax-zMin) > 1e-4 ? (zMax-zMin) : 1;
    const nLayer = Math.max(1, params.layer_count|0);
    for(const t of twigs){
      t.layer = nLayer>1 ? clamp(Math.round((t.z-zMin)/dz*(nLayer-1)), 0, nLayer-1) : 0;   // higher foliage -> higher layer -> blurs more
    }
    // LAYER/park height band (spec §2): bole 0→canopy_base, crown canopy_base→+thickness, NORMALISED by [zMin,zMax].
    // Used ONLY by the analytic woody occluder (non-faithful). This normalisation is invariant to a uniform z-scale —
    // correct for the depth cheat, but it would erase crown_aspect (and the real tree shape) from a faithful cast.
    const _cb = params.canopy_base_height_m, _th = params.canopy_thickness_m, _zb = Math.max(zMin, 1e-3);
    const floorH = (z) => z<=zMin ? _cb*(Math.max(0,z)/_zb) : _cb + (z-zMin)/dz*_th;
    // FAITHFUL cast (spec §4.5): leaves & skeleton cast from their REAL grown height — the very z the 3D preview draws,
    // so the shadow IS the preview tree. Any shape change (crown_aspect, droop, taper…) now flows into the shadow.
    let hMin=1e18, hMax=-1e18;
    for(const t of twigs){ if(t.z<hMin)hMin=t.z; if(t.z>hMax)hMax=t.z; }
    faith.hMin = hMin<=hMax ? hMin : 0; faith.hMax = hMax>hMin ? hMax : (faith.hMin+1);

    const nClusterTotal = twigs.length;
    const hier = {
      nLimb, limbDir, limbPlan, limbAttach,
      limbAngle:new Float32Array(nLimb), limbVel:new Float32Array(nLimb),   // scalar YAW bend (radians): rotation about the vertical
      limbPitch:new Float32Array(nLimb), limbPitchVel:new Float32Array(nLimb),   // second DOF (§5.1): ELEVATION bend in the limb's own vertical plane — what sway_pitch foreshortens by. Same spring constants as the yaw.
      nClusterTotal,
      clusterPlan:new Float32Array(nClusterTotal*2), clusterLimb:new Int32Array(nClusterTotal),
      clusterPhase:new Float32Array(nClusterTotal),
      twigAngle:new Float32Array(nClusterTotal), twigVel:new Float32Array(nClusterTotal),
      clusterData:new Float32Array(nClusterTotal*4),   // dynamic: (limb bend, twig bend, .z per MODE — layer's stem seed / faithful's sway_pitch anchor offset, sway_pitch foreshorten factor) — see publishBend
      clusterGeom:new Float32Array(nClusterTotal*4),   // static: (leaf pivot anchor.xy — twig tip on the layer path, real twig base in faithful; tree trunk pivot.xy)
      // topology signature: what makes limb/cluster index i mean the SAME branch across a regrow. tree_count is NOT
      // here (trees append, so the prefix still lines up — that's the morph); branch_angle/length/pitch/droop aren't
      // either (same indices, just bent differently — carrying their sway is the desired no-reset). But seed / depth /
      // children / limb_count / phyllotaxis / the leader↔hub azimuth flip re-mean every index, so the carry is invalid.
      topoSig: `${params.seed>>>0}|${levels}|${kids}|${lpt}|${phyllo}|${L>0?1:0}`,
      segments, twigs, maxV:0,   // twigs (one per leaf cluster) for the 3D preview — so it scatters per twig like the bake, not per terminal segment (droop sub-segments)
    };
    // carry the in-flight sway across a regrow so the wind doesn't reset (an editor tweak or a grove-morph
    // transition). Trees/limbs are appended at the end, so indices 0..min are the same twig: copy the common
    // PREFIX — existing trees keep their sway, a newly-grown tree starts at rest. ONLY when the topology signature
    // matches; a leader/phyllotaxis/depth edit re-means the indices, so we start at rest there (no wrong-twig bend). (§9)
    if(prevHier && prevHier.topoSig === hier.topoSig){
      const nL=Math.min(prevHier.nLimb,nLimb), nC=Math.min(prevHier.nClusterTotal,nClusterTotal);
      hier.limbAngle.set(prevHier.limbAngle.subarray(0,nL)); hier.limbVel.set(prevHier.limbVel.subarray(0,nL));
      hier.limbPitch.set(prevHier.limbPitch.subarray(0,nL)); hier.limbPitchVel.set(prevHier.limbPitchVel.subarray(0,nL));
      hier.twigAngle.set(prevHier.twigAngle.subarray(0,nC)); hier.twigVel.set(prevHier.twigVel.subarray(0,nC));
    }

    // ---- hang a leaf cluster on each twig, accumulating one instance buffer per depth layer ----
    const layerData = [];
    for(let l=0;l<nLayer;l++) layerData.push([]);   // 16 floats/leaf — see attribute layout below
    const faithData = [];                           // FAITHFUL: ALL leaves in one buffer + a 17th float = continuous height (§4.5)
    const faithful = faithfulOn();                  // hoisted: the packing convention below must be ONE decision for the whole grove, not re-asked per leaf
    for(let j=0;j<nClusterTotal;j++){
      const t = twigs[j];
      const rng  = mulberry32(hash3(params.seed>>>0, j, 101));               // arrangement stream
      const rng2 = mulberry32(hash3((params.seed>>>0)^0x5bd1e995, j, 101));  // wind-identity stream (separate)
      const gauss = makeGauss(rng);
      const cx=t.x, cy=t.y;
      let tdx=t.dx||0, tdy=t.dy||0; const tdl=Math.hypot(tdx,tdy), tHasDir=tdl>1e-4; if(tHasDir){ tdx/=tdl; tdy/=tdl; }   // unit twig heading (plan); leaves hug it
      const swayRand = rng2()*2-1; const stemRand = rng2()*2-1;
      hier.clusterPlan[2*j]=cx; hier.clusterPlan[2*j+1]=cy; hier.clusterPhase[j]=swayRand*Math.PI;
      hier.clusterLimb[j]=t.limb;                                    // grown level-1 ancestor (no search needed)
      // .xy is the LEAF PIVOT ANCHOR, and it means different things per path. LAYER/park: the twig tip (= the clump
      // centre), from which VS_BAKE offsets a SYNTHETIC stem joint by uStemLen — no wood is drawn there, so a made-up
      // joint costs nothing. FAITHFUL: the twig's REAL grown base, which is also what the wood twig turns about in
      // bakeFaithful's refill — one shared joint, so the medium band can't slide leaves off their visible twigs (§4.5).
      hier.clusterGeom[4*j]=faithful?t.bx:cx; hier.clusterGeom[4*j+1]=faithful?t.by:cy;
      hier.clusterGeom[4*j+2]=t.tx; hier.clusterGeom[4*j+3]=t.ty;    // limb pivot = this tree's trunk
      hier.clusterData[4*j+2]=stemRand;                             // static stem-angle seed (.z); tick writes .x/.y
      const data = layerData[t.layer];
      for(let k=0;k<nLeaf;k++){
        const cov = ((k===pcInt) ? frac : 1.0) * t.tcov;   // marginal-leaf fade × marginal-tree fade (§4.5)
        // leaves HUG the twig (§4.5): trail back from the tip ALONG the twig heading (1.5×spread) with a tight
        // perpendicular jitter (0.4×spread), instead of an isotropic blob. Same two draws → other attributes unchanged.
        const g1 = gauss(), g2 = gauss();
        const hug = faithful && tHasDir;   // twig-hug only in faithful mode; the layer/park scatter stays byte-identical
        const x = hug ? cx - Math.abs(g1)*params.cluster_spread_m*1.5*tdx - g2*params.cluster_spread_m*0.4*tdy : cx + g1*params.cluster_spread_m;
        const y = hug ? cy - Math.abs(g1)*params.cluster_spread_m*1.5*tdy + g2*params.cluster_spread_m*0.4*tdx : cy + g2*params.cluster_spread_m;
        const size = params.leaf_size_m*(0.6+0.8*rng());
        const A = size*0.5;                              // long half-axis
        const B0 = size*0.5/params.leaf_aspect;          // face-on short half (shader foreshortens)
        const restTilt = rng()*params.max_tilt*(Math.PI*0.5);
        const angle = rng()*Math.PI;
        const ax = 0.4+0.6*rng(), ay = 0.4+0.6*rng();    // incoherent orbit
        const orient = rng()*TAU2, phase = rng()*TAU2;
        const swingGain = 0.6+0.8*rng2(), swingPhase = rng2()*TAU2;
        data.push(x,y,A,B0, angle,restTilt,swingGain,swingPhase,
                  tau[0]*cov,tau[1]*cov,tau[2]*cov, j, ax,ay,orient,phase);
        faithData.push(x,y,A,B0, angle,restTilt,swingGain,swingPhase,
                  tau[0]*cov,tau[1]*cov,tau[2]*cov, j, ax,ay,orient,phase, t.z);   // + REAL grown height (attr 5) — cast == preview
      }
    }

    // ---- build one instanced VAO per depth layer from its accumulated leaves ----
    const buildLayerVAO = (arr) => {
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
      gl.bindVertexArray(null);
      return { vao, count: arr.length/16, buf };
    };
    for(let l=0;l<nLayer;l++) layerVAO.push(buildLayerVAO(new Float32Array(layerData[l])));

    // ---- FAITHFUL path (§4.5): one combined VAO of EVERY leaf, each carrying its continuous floor-height (attr 5),
    // for the per-sample geometry bake. Built always (cheap); only DRAWN when faithful_canopy is on. ----
    if(faith.vao){ gl.deleteVertexArray(faith.vao); gl.deleteBuffer(faith.buf); }
    {
      const arr = new Float32Array(faithData);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S=68;   // 17 floats/leaf: the 16 bake floats + the continuous height
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5,1,gl.FLOAT,false,S,64); gl.vertexAttribDivisor(5,1);
      gl.bindVertexArray(null);
      faith.vao=vao; faith.buf=buf; faith.count=arr.length/17;
    }

    // (the woody shadow is now the CONTINUOUS-height analytic occluder built below, §4.5 — the old layer-stamped
    // branch quads were retired because layer quantization shattered continuous lines at a low sun.)

    // ---- (re)build the per-clump data textures sampled by the bake VS ----
    const makeDataTex = (old, data) => {
      if(old) gl.deleteTexture(old);
      const tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, Math.max(1,nClusterTotal), 1, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tx;
    };
    const clusterTex     = makeDataTex(null, hier.clusterData);      // dynamic bend angles — a NEW texture per grove (the old one is freed at install)
    const clusterGeomTex = makeDataTex(null, hier.clusterGeom);      // static geometry
    // ---- woody occluder (spec §4.5): trunk + MAIN LIMBS (level<=1) as CONTINUOUS-height analytic segments. Map
    // each grown z to a floor height with the SAME crown mapping the leaves bin by (zMin->canopy_base,
    // zMax->base+thickness), and the bole linearly to 0 — so a limb's base lands at the trunk's height and the
    // shadow CONNECTS (no layer-quantization snowflake). Fine sub-branches are dropped; the leaf dapples carry the
    // fine canopy. The trunk passes through all the limb heights, so the trunk shadow meets the crown. ----
    {
      const tf = Math.pow(Math.max(1.001, kids), -1/clamp(params.taper_delta,1,4));   // pipe-model taper for the radius (floorH hoisted above)
      const rest=[], segH=[];
      let want=0;                                      // what the grove ASKED for, before the cap — see occ.want below
      for(const sg of segments){
        if(sg.level>1) continue;                       // trunk + main limbs only; fine sub-branches carried by the leaf dapples
        want++;
        if(rest.length >= MAX_OCC) continue;           // table full: keep counting rather than break, so the shortfall is a number instead of nothing
        const r = Math.max(0.01, params.trunk_radius_m*Math.pow(tf, sg.level));
        rest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], limb:sg.limb, px:sg.px, py:sg.py });   // limb+pivot for the per-frame swing
        segH.push(floorH(sg.a[2]), floorH(sg.b[2]), r, 0);
      }
      // want > count means this grove is TRUNCATED: the tail of the grow order — whole later trees' boles and limbs —
      // casts no wood at all. It is invisible in a single frame (nothing is missing, there is just less), which is
      // exactly why it needs a number: the pixel harness reads these two and says so out loud.
      occ.rest = rest; occ.ht = new Float32Array(segH); occ.count = rest.length; occ.want = want;
      let hRef = 1e-3; for(let i=0;i<segH.length;i+=4) hRef = Math.max(hRef, segH[i], segH[i+1]);   // tallest floor-height → the drift's height-scale reference (foot planted, crown sways)
      occ.hRef = hRef;
    }
    // ---- FAITHFUL skeleton (§4.5): EVERY segment (trunk + branches + TWIGS) as a tapered capsule at continuous
    // heights (the same floorH). Unlike the analytic occluder (level<=1, capped at MAX_OCC), this is a vertex buffer
    // with no level/count cap — so the twigs cast too and the leaves sit on VISIBLE wood. Used only in faithful mode. ----
    {
      const tf = Math.pow(Math.max(1.001, kids), -1/clamp(params.taper_delta,1,4));   // pipe-model taper
      const segRest = [];
      for(const sg of segments){
        // taper by FRACTIONAL level (sg.f0/f1) so a drooping branch's sub-segments thin smoothly across the one
        // level→level+1 step rather than each repeating the whole step (the old sawtooth). Straight branches: f0=0,f1=1 → unchanged.
        const ra = Math.max(0.012, params.trunk_radius_m*Math.pow(tf, sg.level + (sg.f0||0)));     // thick at the base of the segment (min keeps twigs visible)
        const rb = Math.max(0.008, params.trunk_radius_m*Math.pow(tf, sg.level + (sg.f1!=null?sg.f1:1)));  // thinner toward the tip — continuous with the next sub-segment
        // segment→clump linkage: a TERMINAL (twig-order) segment names the clump hanging off it, and carries that
        // twig's real grown base — the pivot its leaves use in VS_FAITH — so the refill can swing wood and leaves
        // as one. -1 = trunk/limb/interior wood (no clump), and also any twig past the MAX_TEX cluster cap, which
        // bears no leaves at all. (twigs[] is already capped and scaled by here.)
        const cj = (sg.clump>=0 && sg.clump<twigs.length) ? sg.clump : -1;
        segRest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], ha:sg.a[2], hb:sg.b[2], ra, rb, limb:sg.limb, px:sg.px, py:sg.py,
                       clump:cj, tbx:(cj>=0?twigs[cj].bx:0), tby:(cj>=0?twigs[cj].by:0),
                       level:sg.level, mz:0.5*(sg.a[2]+sg.b[2]) });   // REAL grown heights (cast == preview); level + midpoint height pick the SKY view's layer bin below
      }
      faith.segRest = segRest; faith.segCount = segRest.length;
      faith.segArr = new Float32Array(segRest.length*8);   // 8 floats/seg: iSeg(ax,ay,bx,by) + iSegH(ha,hb,ra,rb); positions refilled per bake with the sway
      if(faith.segVAO){ gl.deleteVertexArray(faith.segVAO); gl.deleteBuffer(faith.segBuf); }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, faith.segArr, gl.DYNAMIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S=32;
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.bindVertexArray(null);
      faith.segVAO=vao; faith.segBuf=buf;
    }
    // ---- SKY VIEW's layer-stamped wood (§4.9). The look-up camera reads the layer textures as ANGULAR SILHOUETTES,
    // so wood binned into a layer is drawn at that layer's plan and read at the ray's crossing of that layer's height
    // — which is exactly where the leaves in the same bin are drawn and read. Registration therefore holds by
    // CONSTRUCTION for a terminal segment: it takes its own clump's layer, the very bin its leaves went into.
    // ONLY the fine wood goes in. Level 0 and 1 are the trunk and main limbs, which the analytic occluder already
    // draws as real 3-D capsules; binning those would both double them and shatter them, because a segment that
    // spans several layer bands is cut into pieces read at different plan points. Fine wood is short by construction
    // (measured well under one band at every shipped look), so it cannot come apart. ----
    {
      const segRest = [], nL = Math.max(1, params.layer_count|0);
      if(params.sky_view){
        const binOf = (s0) => s0.clump >= 0 ? twigs[s0.clump].layer
                            : (nL > 1 ? clamp(Math.round((s0.mz - zMin)/dz*(nL-1)), 0, nL-1) : 0);   // the twigs' own binning rule, applied to interior wood by its midpoint
        const byLayer = [];
        for(let l=0;l<nL;l++) byLayer.push([]);
        for(const s0 of faith.segRest) if(s0.level > 1) byLayer[binOf(s0)].push(s0);
        for(let l=0;l<nL;l++){ sky.start[l] = segRest.length; sky.count[l] = byLayer[l].length; for(const s0 of byLayer[l]) segRest.push(s0); }
      } else { sky.start.length = 0; sky.count.length = 0; }
      sky.segRest = segRest;
      sky.segArr = new Float32Array(segRest.length*8);
      if(sky.segVAO){ gl.deleteVertexArray(sky.segVAO); gl.deleteBuffer(sky.segBuf); sky.segVAO=null; sky.segBuf=null; }
      if(segRest.length){
        sky.segBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sky.segArr, gl.DYNAMIC_DRAW);
        sky.segVAO = gl.createVertexArray();
        gl.bindVertexArray(sky.segVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,32,0);  gl.vertexAttribDivisor(1,1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,16); gl.vertexAttribDivisor(2,1);
        gl.bindVertexArray(null);
      }
    }
    // FAITHFUL cast-frame plan AABB (spec §4.5 / A5): the REAL plan extent of every leaf (faithData x,y) + every wood
    // endpoint, so bakeFaithful's cast frame covers a wide grove's OUTER crown. (Was bounded by ±canopy_extent/2, which
    // clipped it — park 1's crown reaches ~4.3 m vs half=3.25 m.) Rest positions; the per-bake pad covers sway+drift.
    {
      let px0=1e18,py0=1e18,px1=-1e18,py1=-1e18;
      for(let i=0;i<faithData.length;i+=17){ const x=faithData[i],y=faithData[i+1]; if(x<px0)px0=x; if(x>px1)px1=x; if(y<py0)py0=y; if(y>py1)py1=y; }
      for(const s of faith.segRest){
        if(s.ax<px0)px0=s.ax; if(s.ax>px1)px1=s.ax; if(s.ay<py0)py0=s.ay; if(s.ay>py1)py1=s.ay;
        if(s.bx<px0)px0=s.bx; if(s.bx>px1)px1=s.bx; if(s.by<py0)py0=s.by; if(s.by>py1)py1=s.by;
      }
      if(px0>px1){ const h=params.canopy_extent_m/2; px0=-h;py0=-h;px1=h;py1=h; }   // empty grove fallback
      faith.pminx=px0; faith.pmaxx=px1; faith.pminy=py0; faith.pmaxy=py1;
    }
    return { hier, layerVAO, clusterTex, clusterGeomTex };
  }

  // ---- INSTALL a grove as the active one: free whatever it replaces, then re-point the engine's views at it.
  // hier / layerVAO / clusterTex / clusterGeomTex stay plain engine variables on purpose — some fifty readers
  // across motion, the bake and the debug overlays mean the ACTIVE grove, and rewriting every one of them to
  // say so would be churn without a reader. What the grove VALUE buys is that a second one can exist at all.
  function freeGrove(g){
    if(!g) return;
    g.layerVAO.forEach(L=>{ gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.buf); });
    if(g.clusterTex) gl.deleteTexture(g.clusterTex);
    if(g.clusterGeomTex) gl.deleteTexture(g.clusterGeomTex);
  }
  function installGrove(g){
    if(grove && grove !== g) freeGrove(grove);
    grove = g;
    hier = g.hier; layerVAO = g.layerVAO; clusterTex = g.clusterTex; clusterGeomTex = g.clusterGeomTex;
    publishBend(g);   // push the (preserved or rest) bend into the fresh texture, so a bake right after a regrow isn't a frame snapped to rest
  }
  function regenCanopy(){ installGrove(buildGrove(hier)); }   // the old shape: grow one, make it the one
  // Grow the grove the TARGET look describes, without becoming it: the grove knobs are swapped in for the length
  // of the build and put straight back, so nothing else in the frame notices. No prevHier — the incoming springs
  // start at rest, which is what a newly grown tree has always done.
  function buildTargetGrove(to){
    const keys = [...TOPO_KEYS, ...CANOPY_KEYS], saved = {};
    for(const k of keys){ saved[k] = params[k]; params[k] = to[k]; }
    const g = buildGrove(null);
    for(const k of keys) params[k] = saved[k];
    return g;
  }

  // ---- bake leaves into per-layer optical-depth textures ---------------------
  function bake(){
    if(faithfulOn()){ bakeFaithful(); return; }   // FAITHFUL path (§4.5): cast the real tree, not the layer slabs
    const res = bakeRes();
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
    // WHICH GROVES ARE IN THIS BAKE. Normally one, at full coverage. During a crossfade (§9) two, at
    // complementary coverage into the SAME layer texture — which the additive optical-depth bake makes exact:
    // the depths sum, so at w the picture is (1-w) of the old arrangement plus w of the new, and no leaf ever
    // jumps. Their cluster textures are per-grove, so the binds move inside the loop with them.
    const baking = groveIn ? [[grove, 1-crossW], [groveIn, crossW]] : [[grove, 1]];
    gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);
    gl.viewport(0,0,res,res);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);          // optical depth accumulates additively
    const H=layerHeights(), base=params.canopy_base_height_m;
    // ALPHA IS THE WOOD'S CHANNEL IN SKY MODE (§4.9). The layer texture's rgb is the foliage's per-channel optical
    // depth and its alpha has never been read by anything — tap/tapUp/tapCA and the debug blit all take .rgb — so the
    // look-up camera claims it for the skeleton, and the leaves must stop writing their coverage there or the two
    // would sum into one meaningless number. A colour mask does it without touching the leaf shader, which keeps
    // every other look's bake bit-for-bit what it was.
    for(let l=0;l<params.layer_count;l++){
      // higher layers ride longer levers -> sway more when height gain > 0 (else pure translation)
      const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
      gl.uniform2f(U.bake.sway, motion.sway[0]*f, motion.sway[1]*f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layerTex[l], 0);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // depth 0 -> transmittance 1. UNMASKED: alpha is the wood's channel in sky mode and must be cleared too, or it accumulates across bakes
      if(params.sky_view) gl.colorMask(true, true, true, false);
      for(const [g, cov] of baking){
        if(!(cov > 0)) continue;                               // a grove at zero coverage contributes no optical depth; skip the draw rather than issue it
        gl.uniform1f(U.bake.coverage, cov);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, g.clusterTex);     gl.uniform1i(U.bake.clusterTex, 4);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, g.clusterGeomTex); gl.uniform1i(U.bake.clusterGeom, 5);
        const L=g.layerVAO[l];
        gl.bindVertexArray(L.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, L.count);
      }
      if(params.sky_view) gl.colorMask(true, true, true, true);   // back to full before the next layer's clear
    }
    // The woody TRUNK and MAIN LIMBS are never stamped here — they are the continuous-height analytic occluder in
    // transport (§4.5), because a long segment cut into layer bands casts a shadow that shatters into a staircase.
    // The SKY VIEW adds back the FINE wood only (§4.9): it is read along the eye's ray rather than cast, it is short
    // enough to sit inside one band, and it carries the same per-layer sway the leaves in that band get — so the
    // leaves have visible twigs to hang on instead of floating in clouds around bare limb tips.
    if(params.sky_view && params.branch_tau > 0 && sky.segRest.length > 0){
      fillSwayedSegs(sky.segRest, sky.segArr, 0, 0);   // the coherent translation arrives per LAYER below, exactly as the leaves take it
      gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sky.segArr);
      gl.useProgram(progFaithSeg);
      gl.uniform2f(U.faithSeg.origin, -E/2, -E/2);
      gl.uniform2f(U.faithSeg.extent, E, E);          // the CANOPY plan frame, the leaves' own — no sun projection here
      gl.uniform2f(U.faithSeg.g, 0.0, 0.0);           // g is where a shadow FALLS; nothing here is a shadow
      gl.uniform1i(U.faithSeg.curtainBake, 0);
      gl.uniform1f(U.faithSeg.woodTau, params.branch_tau);
      gl.uniform1i(U.faithSeg.segTau, 1);             // layer textures accumulate OPTICAL DEPTH additively
      gl.bindVertexArray(sky.segVAO);
      for(let l=0;l<params.layer_count;l++){
        if(!sky.count[l]) continue;
        const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
        gl.uniform2f(U.faithSeg.segSway, motion.sway[0]*f, motion.sway[1]*f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layerTex[l], 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);   // draw this layer's slice: no baseInstance in WebGL2, so the attribute origin moves instead
        gl.vertexAttribPointer(1,4,gl.FLOAT,false,32,sky.start[l]*32);
        gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,sky.start[l]*32+16);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sky.count[l]);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- FAITHFUL leaf bake (spec §4.5): the opt-out from the depth-layer cheat. Each leaf casts from its OWN
  // continuous grown height, so the cast IS the preview tree (leaves on their twigs, aligned with the wood). The
  // "many suns" convolution is done as GEOMETRY: for each source sample, draw every leaf shifted to its floor
  // landing (world - height·g_i) with MULTIPLICATIVE blend → transmittance_i in a scratch buffer, then add
  // w_i·transmittance_i into the accumulator. The result is one soft-shadow texture transport taps ONCE. Cost moves
  // from the per-pixel sample loop to per-sample bake passes — gated, so the park / layer path pays nothing. ----
  // ---- the swayed skeleton, filled ONCE and read by two bakes (§4.5/§4.9). Each segment is rotated by its limb's
  // bend about its tree pivot, and a TERMINAL segment first swings about its own twig base by that clump's twig bend —
  // the same pivot, angle and order VS_FAITH gives the leaves hanging on it, so they ride the twig instead of sliding
  // off it. `swx/swy` is the coherent whole-tree translation: the CAST wants it height-scaled and folded in here; the
  // SKY view's layer stamp wants the leaf bake's own per-layer factor instead and passes 0, taking it as a uniform. ----
  function fillSwayedSegs(R, sa, swx, swy){
    const la = hier ? hier.limbAngle : null, ta = hier ? hier.twigAngle : null;
    const lat = hier ? hier.limbAttach : null;   // per-limb attach height: where the sway_pitch foreshorten is anchored (§5.1)
    const lp = hier ? hier.limbPitch : null;     // per-limb pitch DOF: the angle the foreshorten is taken from (§5.1)
    const hRef = Math.max(faith.hMax, 1e-3);
    const sp = Math.max(0, params.sway_pitch);   // 3-D lean (§5): foreshorten the wood heights by the SAME factor the leaves use, so leaf-on-wood registration holds
    for(let k=0;k<R.length;k++){
      const s = R[k];
      const th = (la && s.limb>=0 && s.limb<la.length) ? la[s.limb] : 0;
      // MEDIUM band (§5.4): terminal wood first swings about its OWN twig base by that clump's twig bend, before
      // the limb rotation — the same pivot, angle and order VS_FAITH gives the leaves hanging on it, so they ride
      // the twig instead of sliding off it. Interior wood (clump<0) is untouched. sway_pitch meets the band here
      // and stays orthogonal: `fore` scales HEIGHTS off the limb bend, this is a plan-plane yaw. tf=0 → tt=0 → rest.
      const tt = (ta && s.clump>=0) ? ta[s.clump] : 0;
      let ax=s.ax, ay=s.ay, bx=s.bx, by=s.by;
      if(tt!==0){
        const ctw=Math.cos(tt), stw=Math.sin(tt), tbx=s.tbx, tby=s.tby;
        const dax=ax-tbx, day=ay-tby, dbx=bx-tbx, dby=by-tby;
        ax = tbx + ctw*dax - stw*day; ay = tby + stw*dax + ctw*day;
        bx = tbx + ctw*dbx - stw*dby; by = tby + stw*dbx + ctw*dby;
      }
      const c=Math.cos(th), sn=Math.sin(th), px=s.px, py=s.py, o=k*8;
      // the SAME expression publishBend gives this limb's clumps, off the SAME pitch DOF — leaf-on-wood
      // registration is only kept by the two staying literally in lockstep (§5.1). The plan rotation above
      // is the yaw DOF; this is the elevation one, and the two compose orthogonally.
      const ph = (sp>0 && lp && s.limb>=0 && s.limb<lp.length) ? lp[s.limb] : 0;
      const fore = sp>0 ? clamp(1 - sp*(1-Math.cos(ph)), 0.1, 1) : 1;
      // ANCHOR the foreshorten at the limb's attach height (§5.1): h' = at + (h−at)·fore, so at the join h' = at
      // exactly and the pitching limb cannot part from the trunk axis, which does not pitch. Same sign for a droop
      // tip hanging BELOW the attach — rotating a limb down about its joint moves every point toward the attach
      // plane. Trunk wood (limb<0) never pitches, and at=0 with fore=1 reproduces h' = h exactly (byte-identical).
      const at = (sp>0 && lat && s.limb>=0 && s.limb<lat.length) ? lat[s.limb] : 0;
      const ha = at + (s.ha-at)*fore, hb = at + (s.hb-at)*fore;
      const kA = ha/hRef, kB = hb/hRef;   // sway grows with height: 0 at the ground → the trunk base stays PLANTED, the crown sways; same fraction for a limb & the trunk at its height, so they stay joined
      sa[o]   = px + c*(ax-px) - sn*(ay-py) + swx*kA;
      sa[o+1] = py + sn*(ax-px) + c*(ay-py) + swy*kA;
      sa[o+2] = px + c*(bx-px) - sn*(by-py) + swx*kB;
      sa[o+3] = py + sn*(bx-px) + c*(by-py) + swy*kB;
      sa[o+4]=ha; sa[o+5]=hb; sa[o+6]=s.ra; sa[o+7]=s.rb;
    }
  }

  function bakeFaithful(){
    if(faith.count===0){ gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
    const res = bakeRes(), N = src.count;
    // cast-region frame: the shadow lands OFFSET from the canopy by the bulk throw (standing scene), so the faith
    // texture must cover where it FALLS, not the canopy plan. world = planPoint − g·h, so the cast box is the REAL
    // plan AABB (faith.p*, leaves+wood) swept over the height range [hLo,hMax] and the per-sample g-range — then padded
    // and squared. (Only the g-EXTREMES matter, so track those in the sample loop instead of an O(8N) corner sweep.)
    const proj = projMatrix();
    const gx=faith.gx, gy=faith.gy;
    const _b=bulkShift(), bulkX=_b[0], bulkY=_b[1];   // standing-scene lateral throw (shared helper; 0 when off)
    const woodOn = params.branch_tau > 0 && faith.segCount > 0;
    let gminx=1e18,gmaxx=-1e18,gminy=1e18,gmaxy=-1e18;
    for(let i=0;i<N;i++){
      const sx=src.flat[3*i], sy=src.flat[3*i+1];
      const gxi = proj[0]*sx + proj[2]*sy + bulkX;   // g = uProj·sample + bulk  (mat2 column-major: [0,1]=col0, [2,3]=col1)
      const gyi = proj[1]*sx + proj[3]*sy + bulkY;
      gx[i]=gxi; gy[i]=gyi;
      if(gxi<gminx)gminx=gxi; if(gxi>gmaxx)gmaxx=gxi; if(gyi<gminy)gminy=gyi; if(gyi>gmaxy)gmaxy=gyi;
    }
    // wood reaches the ground (trunk base h=0); without wood, leaves start at hMin — BUT sway_pitch foreshortens
    // heights, so widen the low bound there so a foreshortened leaf's (closer-in) cast isn't clipped out of the
    // frame. 0.1× is publishBend's clamp floor applied from the GROUND, which is now merely CONSERVATIVE padding:
    // the foreshorten is anchored at the limb's attach height (§5.1), so h' = 0.1·h + 0.9·attachH ≥ 0.1·h with
    // attachH ≥ 0. Kept as-is — the slack costs frame padding, nothing else. (A leaf hanging BELOW its attach rises
    // instead, but only toward attachH, a height the trunk wood already occupies — so hHi needs no matching widening.)
    const hLo = woodOn ? 0 : faith.hMin*(params.sway_pitch>0 ? 0.1 : 1), hHi = faith.hMax;
    // pad: the leaf quad half-extent, the incoherent drift orbit, and the live coherent sway (leaves+wood translate
    // by up to |sway| at the crown) — none of which are in the rest plan AABB. (The twig-hug trail-back already is.)
    const pad = params.leaf_size_m + params.drift_amount + Math.hypot(motion.sway[0],motion.sway[1]) + 0.05;
    let minx,maxx,miny,maxy;
    if(params.receiver){
      // CURTAIN cast frame (§4.9): occluders project onto the VERTICAL cloth (Y=cy), not the floor — the projection is
      // nonlinear in g (÷gy), so sweep the plan-AABB corners × the height range through each sample's cloth map
      // (u = px − r·gx, v = h − r; r = (py−cy)/gy) and bound the (u,v) span. (8 corners × N samples — cheap.)
      const cy = params.cloth_distance_m;
      let uMin=1e18,uMax=-1e18,vMin=1e18,vMax=-1e18;
      const pxs=[faith.pminx,faith.pmaxx], pys=[faith.pminy,faith.pmaxy], hs=[hLo,hHi];
      for(let i=0;i<N;i++){
        let gyi=gy[i]; if(Math.abs(gyi)<1e-3) gyi = gyi<0?-1e-3:1e-3;
        for(const py of pys){ const r=(py-cy)/gyi;
          for(const px of pxs){ const u=px - r*gx[i]; if(u<uMin)uMin=u; if(u>uMax)uMax=u; }
          for(const h of hs){ const v=h - r; if(v<vMin)vMin=v; if(v>vMax)vMax=v; }
        }
      }
      minx=uMin-pad; maxx=uMax+pad; miny=vMin-pad; maxy=vMax+pad;
    } else {
      // FLOOR cast frame: world = planPoint − g·h, so the box is the plan AABB swept over the −g·h extremes
      // (only the g-EXTREMES matter, so the per-sample loop tracked those instead of an O(8N) corner sweep).
      const ghx0=Math.min(gminx*hLo,gminx*hHi,gmaxx*hLo,gmaxx*hHi), ghx1=Math.max(gminx*hLo,gminx*hHi,gmaxx*hLo,gmaxx*hHi);
      const ghy0=Math.min(gminy*hLo,gminy*hHi,gmaxy*hLo,gmaxy*hHi), ghy1=Math.max(gminy*hLo,gminy*hHi,gmaxy*hLo,gmaxy*hHi);
      minx=faith.pminx-ghx1-pad; maxx=faith.pmaxx-ghx0+pad; miny=faith.pminy-ghy1-pad; maxy=faith.pmaxy-ghy0+pad;
    }
    const side = Math.max(maxx-minx, maxy-miny, 1e-3);
    faith.ox = (minx+maxx)/2 - side/2; faith.oy = (miny+maxy)/2 - side/2; faith.ext = side;

    gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);
    gl.viewport(0,0,res,res);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, faithTex, 0);
    gl.disable(gl.BLEND); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // accumulator starts at 0 (Σ w·T)
    // attach the two persistent targets ONCE: faithTex→bakeFBO (above) and faithScratch→faithFBO (here). The
    // per-sample loop then just binds whichever FBO it wants — no per-sample framebufferTexture2D (2N → 2/bake).
    gl.bindFramebuffer(gl.FRAMEBUFFER, faithFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, faithScratch, 0);

    // static faith-VS uniforms (wind / flutter — match the preview & the layer bake); only uG changes per sample
    gl.useProgram(progFaith);
    gl.uniform2f(U.faith.origin, faith.ox, faith.oy);
    gl.uniform2f(U.faith.extent, faith.ext, faith.ext);
    gl.uniform1f(U.faith.edge, params.edge_softness);   // soft leaf rim (same as the layer bake); 0 here = hard ellipses
    gl.uniform1i(U.faith.curtainBake, params.receiver ? 1 : 0);   // §4.9: project onto the vertical cloth (curtain) vs the floor
    gl.uniform1f(U.faith.clothY, params.cloth_distance_m);
    gl.uniform1f(U.faith.morph, params.drift_phase);
    gl.uniform1f(U.faith.morphAmount, params.drift_amount);
    gl.uniform1f(U.faith.windLevel, motion.u);
    gl.uniform1f(U.faith.windTime, motion.time);
    gl.uniform1f(U.faith.leafSwing, params.leaf_swing);
    gl.uniform1f(U.faith.flutterFreq, params.flutter_freq);
    gl.uniform2f(U.faith.sway, motion.sway[0], motion.sway[1]);
    gl.uniform1f(U.faith.hRef, Math.max(faith.hMax, 1e-3));   // height-scale the coherent sway → base anchored, crown sways (matches the wood)
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, clusterTex);     gl.uniform1i(U.faith.clusterTex, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, clusterGeomTex); gl.uniform1i(U.faith.clusterGeom, 5);

    // FAITHFUL skeleton (§4.5): refill the instance array with the live limb SWING + whole-tree drift, so the wood
    // sways WITH the leaves; then upload + set its statics once.
    if(woodOn){
      fillSwayedSegs(faith.segRest, faith.segArr, motion.sway[0], motion.sway[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, faith.segBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, faith.segArr);
      gl.useProgram(progFaithSeg);
      gl.uniform2f(U.faithSeg.segSway, 0.0, 0.0);   // the cast's sway is height-scaled and already in the instance data
      gl.uniform1i(U.faithSeg.segTau, 0);           // the cast's scratch is multiplicative: emit transmittance
      gl.uniform2f(U.faithSeg.origin, faith.ox, faith.oy);
      gl.uniform2f(U.faithSeg.extent, faith.ext, faith.ext);
      gl.uniform1f(U.faithSeg.woodTau, params.branch_tau);
      gl.uniform1i(U.faithSeg.curtainBake, params.receiver ? 1 : 0);   // §4.9: cloth vs floor projection (matches the leaves)
      gl.uniform1f(U.faithSeg.clothY, params.cloth_distance_m);
    }

    for(let i=0;i<N;i++){
      // PASS 1: transmittance_i into scratch (clear to 1 = fully lit; each leaf MULTIPLIES it down by exp(-τ))
      gl.bindFramebuffer(gl.FRAMEBUFFER, faithFBO);   // faithScratch (attached once above)
      gl.disable(gl.BLEND); gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.SRC_COLOR);   // dst *= src → Π exp(-τ)
      gl.useProgram(progFaith);
      gl.uniform2f(U.faith.g, gx[i], gy[i]);
      gl.bindVertexArray(faith.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, faith.count);
      if(woodOn){   // wood into the SAME scratch (still multiplicative) → leaves × wood = combined transmittance_i
        gl.useProgram(progFaithSeg);
        gl.uniform2f(U.faithSeg.g, gx[i], gy[i]);
        gl.bindVertexArray(faith.segVAO);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, faith.segCount);
      }
      // PASS 2: acc += w_i · transmittance_i  (additive, fullscreen)
      gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);    // faithTex accumulator (attached once above)
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progFAcc);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, faithScratch); gl.uniform1i(U.facc.tex, 0);
      gl.uniform1f(U.facc.weight, src.flat[3*i+2]);
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- source: Vogel-spiral cloud of weighted point-suns ---------------------
  function regenSource(){
    const N = clamp(Math.round(perf.auto ? perf.sampleCount : params.sample_count), 3, MAX_SAMPLES);
    const coreR = params.core_angular_radius_deg*DEG;
    const t = effCloud();                                  // cloud_thickness, pushed to overcast during a transition
    const haloDeg = lerp(params.halo_angular_radius_deg, 30, trans.bloom);  // the bloom also fattens the halo to wash out the grove swap
    const haloR = lerp(coreR*2.0, haloDeg*DEG, t);
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
    const moonR = params.eclipse ? coreR*1.0 : 0, moonD = params.eclipse ? coreR*(1.3-params.eclipse_amount) : 0;
    if(params.eclipse){
      for(const p of pts){ if(Math.hypot(p[0]-moonD, p[1])<moonR) p[2]=0; }
      let s=0; for(const p of pts) s+=p[2];
      if(s>0) for(const p of pts) p[2]/=s;     // renormalize (keep shape visible)
    }
    // THE SEEN SOURCE (§4.9, sky view): the same distribution these samples approximate, expressed as RADIANCE — the
    // core disk and the halo annulus, each carrying its post-cloud weight over its own solid angle. Derived HERE, from
    // the very numbers the sampler just used, so the sun you look at and the dapples it throws cannot drift apart:
    // raise cloud_thickness and the disk drains into the aureole by exactly the amount the dapples soften. Absolute
    // scale is authored — see SKY_SUN_GAIN.
    // The eclipse renormalization is ANALYTIC (circle-circle overlap) rather than the discrete sum just used above,
    // and deliberately so: the loop's sum is a 32-sample ESTIMATE of the energy the moon removes, and reusing it
    // would bake that estimate's error into the visible source. Integrating the field below against the true
    // overlap areas gives back exactly 1 — the same total the renormalized weights carry. What is left over, the gap
    // between the two core:halo splits, is the SAMPLER's own discretization and belongs to the sampler.
    const aCore = Math.PI*coreR*coreR, aHalo = Math.max(Math.PI*(haloR*haloR - coreR*coreR), 1e-12);
    const eatCore = lensArea(coreR, moonR, moonD);                     // moon ∩ core disk
    const eatHalo = lensArea(haloR, moonR, moonD) - eatCore;           // moon ∩ halo annulus = (moon ∩ whole source) − (moon ∩ core)
    const liveCore = Wcore*(1 - eatCore/aCore), liveHalo = Whalo*(1 - eatHalo/aHalo);
    const live = Math.max(liveCore + liveHalo, 1e-9);                  // 1 with no eclipse, so this whole block is inert then
    src.coreR = coreR; src.haloR = haloR; src.moonD = moonD; src.moonR = moonR;
    src.Lcore = SKY_SUN_GAIN * (Wcore/live) / aCore;
    src.Lhalo = SKY_SUN_GAIN * (Whalo/live) / aHalo;
    const flat=new Float32Array(pts.length*3);
    let mr=1e-9, mw=1e-9;
    pts.forEach((p,i)=>{ flat[i*3]=p[0]; flat[i*3+1]=p[1]; flat[i*3+2]=p[2];
      mr=Math.max(mr,Math.hypot(p[0],p[1])); mw=Math.max(mw,p[2]); });
    src.flat=flat; src.count=pts.length; src.maxR=mr; src.maxW=mw; src.haloR=haloR;
    if(EDITOR){   // push the cloud into the editor's source-inset buffer (player build has none)
      gl.bindBuffer(gl.ARRAY_BUFFER, srcDbgBuf);
      gl.bufferData(gl.ARRAY_BUFFER, flat, gl.DYNAMIC_DRAW);
    }
  }

  // per-frame scratch reused by the look uniforms (projMatrix/layerHeights/atmosphere) so a static frame allocates
  // nothing — they recompute fresh into these each call (no stale-cache risk: the sun-drag path mutates params
  // without an apply(), which a dirty-flag cache would miss; the recompute itself is sub-microsecond).
  const _proj = [0,0,0,0], _lh = new Float32Array(MAX_LAYERS), _atm = { sun:[0,0,0], ambient:[0,0,0] };
  const _bulk = [0,0];
  // STANDING-SCENE bulk shadow offset (§4.8): cot(elev)·(anti-sun direction) per unit height — the lateral throw the
  // park model omits. ONE helper, shared by transport's analytic occluder AND the faithful bake, so the two throws
  // can't silently drift apart. Floored at 6° — deliberately HIGHER than projMatrix's 4° ellipse floor: cot(elev)
  // diverges faster than the ellipse's 1/sin² as the sun nears the horizon, so the throw wants the tighter clamp.
  // Returns the shared scratch [0,0] when standing_scene is off (park model, byte-identical).
  function bulkShift(){
    // the bulk sun-angle throw is needed for BOTH the standing-scene floor AND the curtain receiver (it's what
    // projects the tree's shadow off to the side / onto the cloth). Off for the overhead park (receiver 0 + no
    // standing scene) → 0, byte-identical.
    if(!params.standing_scene && !params.receiver){ _bulk[0]=0; _bulk[1]=0; return _bulk; }
    const el=Math.max(params.sun_elevation_deg,6)*DEG, az=params.sun_azimuth_deg*DEG, k=Math.cos(el)/Math.sin(el);
    _bulk[0]=k*Math.cos(az); _bulk[1]=k*Math.sin(az); return _bulk;
  }
  // ---- the ellipse: angular offset -> ground displacement per unit height ----
  function projMatrix(){
    const el=Math.max(params.sun_elevation_deg,4)*DEG, az=params.sun_azimuth_deg*DEG;
    const se=Math.sin(el);
    const major=1/(se*se), minor=1/se;          // stretch along azimuth grows as sun lowers
    const ca=Math.cos(az), sa=Math.sin(az);
    _proj[0]=major*ca*ca+minor*sa*sa;
    _proj[1]=_proj[2]=(major-minor)*ca*sa;
    _proj[3]=major*sa*sa+minor*ca*ca;
    return _proj;                                // column-major (symmetric)
  }
  function layerHeights(){
    const n=params.layer_count, base=params.canopy_base_height_m, thick=params.canopy_thickness_m;
    for(let i=0;i<MAX_LAYERS;i++) _lh[i]= n>1 ? base+(i/(n-1))*thick : base;
    return _lh;
  }

  // ---- motion: integrate the limb and twig springs (children inherit parents) ----
  // Both take the GROVE they drive rather than reading the active one, because during a crossfade there are two
  // and each carries its own springs: the outgoing one keeps the state it has been living in, the incoming one
  // starts at rest (the tier-2 precedent — a newly grown tree does too). They share the global sway/drift clocks,
  // which are noise-of-time and belong to the weather, not to a grove.
  function tickHierarchy(steps, h, g){
    const hier = g?.hier;
    if(!hier) return;
    const t = motion.time;
    const eb = 0.25 + 0.75*motion.env;       // differential bend breathes with the gust
    const u = motion.u;                       // coherent gust sense (signed, stiffened/backlashed)
    const dz = params.damping_ratio;
    const wL = Math.max(0.3, params.sway_stiffness*0.5), wT = Math.max(0.3, params.sway_stiffness*2.0);
    const kL=wL*wL, kT=wT*wT, cL=2*dz*wL, cT=2*dz*wT, lf=params.limb_flex, tf=params.twig_flex;
    let maxv=0;
    const wx=motion.windX, wy=motion.windY;   // effective downwind direction (after the weather veer, §5.1)
    const sp = Math.max(0, params.sway_pitch);   // gate on the second DOF: off → it never integrates and its state is held at rest
    for(let i=0;i<hier.nLimb;i++){             // limbs pivot about the trunk; bend = wind TORQUE about it
      const dx=hier.limbDir[2*i], dy=hier.limbDir[2*i+1];
      const torque = dx*wy - dy*wx;            // cross(limbDir,wind): tip swings downwind, sign by side —
                                               // so a uniform gust LEANS the whole canopy, never spins it
      const n = windNoise(hier.limbPlan[2*i], hier.limbPlan[2*i+1], t, 0.4);
      const target = lf*(u*torque + 0.6*eb*n);
      for(let s=0;s<steps;s++){ const a = kL*(target - hier.limbAngle[i]) - cL*hier.limbVel[i];
        hier.limbVel[i]+=a*h; hier.limbAngle[i]+=hier.limbVel[i]*h; }
      maxv=Math.max(maxv, Math.abs(hier.limbVel[i]));
      // ---- the SECOND rotational DOF (sway_pitch, §5.1): elevation, in the limb's own vertical plane ----
      // One wind force, resolved two ways about the same joint. The drag PERPENDICULAR to the limb's plan
      // direction has a moment arm about the vertical and yaws it (the cross above); the drag PARALLEL to it
      // has none — it cannot yaw the limb at all, so it loads it end-on and pitches it. Hence dot where the
      // yaw takes cross, on the same balanced mechanical fan (limbDir, decoupled from the drawn azimuth §4.5)
      // — but rotated by the limb's LIVE yaw bend, which is what makes STREAMLINING emergent: a broadside limb
      // is all cross and no dot, so it swings downwind first; that swing turns its live direction INTO the
      // wind's line, the dot grows, and only then does it pitch flat. No alignment special case anywhere.
      // An upwind limb (dot<0) takes negative torque and pitches UP. Same spring as the yaw (no new knobs).
      if(sp>0){
        const ca=Math.cos(hier.limbAngle[i]), sa=Math.sin(hier.limbAngle[i]);
        const lx=ca*dx - sa*dy, ly=sa*dx + ca*dy;      // live plan direction = mechanical fan turned by the yaw bend
        const pTorque = lx*wx + ly*wy;                 // dot(liveDir, wind)
        const pTarget = lf*u*pTorque;
        for(let s=0;s<steps;s++){ const a = kL*(pTarget - hier.limbPitch[i]) - cL*hier.limbPitchVel[i];
          hier.limbPitchVel[i]+=a*h; hier.limbPitch[i]+=hier.limbPitchVel[i]*h; }
        maxv=Math.max(maxv, Math.abs(hier.limbPitchVel[i]));   // the pitch must also hold motionActive open until it settles
      } else { hier.limbPitch[i]=0; hier.limbPitchVel[i]=0; }   // zeroed while off so re-enabling the knob starts from rest
    }
    for(let j=0;j<hier.nClusterTotal;j++){     // twigs: stiffer, faster, mostly decorrelated
      const cxj=hier.clusterPlan[2*j], cyj=hier.clusterPlan[2*j+1];
      const rx=cxj-hier.clusterGeom[4*j+2], ry=cyj-hier.clusterGeom[4*j+3], cl=Math.hypot(rx,ry)||1e-3;  // offset from THIS tree's trunk
      const tq=(rx*wy - ry*wx)/cl;             // downwind torque about the twig's own tree trunk (same lean sense as the limb)
      const n = windNoise(cxj, cyj, t+hier.clusterPhase[j], 1.5);
      const target = tf*(0.4*u*tq + eb*n);
      for(let s=0;s<steps;s++){ const a = kT*(target - hier.twigAngle[j]) - cT*hier.twigVel[j];
        hier.twigVel[j]+=a*h; hier.twigAngle[j]+=hier.twigVel[j]*h; }
      maxv=Math.max(maxv, Math.abs(hier.twigVel[j]));   // (clusterData is written by publishBend, below)
    }
    hier.maxV = maxv;
    publishBend(g);
  }
  // write the current limb/twig bend into the per-clump texture the bake VS samples. Called at the end of a
  // hierarchy tick, and again after a grove-morph regrow (which hands us a fresh, zeroed texture). ----
  function publishBend(g){
    const hier = g?.hier;
    if(!hier) return;
    const sp = Math.max(0, params.sway_pitch);   // 3-D lean (§5): the limb's PITCH DOF → foreshorten factor in .w (faithful only); 0 → factor 1, byte-identical
    const faithful = faithfulOn();
    for(let j=0;j<hier.nClusterTotal;j++){
      const li = hier.clusterLimb[j];
      const lb = hier.limbAngle[li];
      hier.clusterData[4*j]   = lb;                                    // limb YAW bend this clump inherits (the plan rotation)
      hier.clusterData[4*j+1] = hier.twigAngle[j];                     // its own twig bend
      // foreshorten from the PITCH DOF, not the yaw: a limb pitched by θ carries its points to cos θ of their
      // elevation. 1−cos is EVEN, so an upwind limb pitched UP foreshortens too instead of lifting its cast —
      // the approximation named in §5.1; a signed model needs each limb's rest elevation in the motion state.
      const fore = sp>0 ? clamp(1 - sp*(1-Math.cos(hier.limbPitch[li])), 0.1, 1) : 1;
      hier.clusterData[4*j+3] = fore;
      // GOTCHA — .z is packed per MODE and the shader that unpacks it must agree (VS_FAITH vs VS_BAKE; neither
      // side can see the other's convention). LAYER: .z keeps the static stem-angle seed regen wrote, untouched
      // here. FAITHFUL: .z is the OFFSET half of the anchored foreshorten (§5.1) — hEff = attachH·(1−fore) +
      // h·fore, i.e. heights shrink toward the limb's ATTACH height, not toward the ground, so the limb↔trunk
      // join stays closed. Safe because faithful_canopy is a MODE_KEYS flag: a flip rebuilds and republishes both.
      if(faithful) hier.clusterData[4*j+2] = hier.limbAttach[li]*(1-fore);   // sp=0 → fore=1 → exactly 0 → hEff = iHeight, byte-identical
    }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, g.clusterTex);
    // perf todo — clusterTex is single-buffered: this rewrites the whole row, then bake()'s VS texelFetches the
    // SAME texture the same frame, so next frame's upload can stall on the prior bake still draining it (a
    // per-frame GPU sync bubble). Ping-pong a 2-deep ring of cluster textures to break the write-after-read.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, hier.nClusterTotal, 1, gl.RGBA, gl.FLOAT, hier.clusterData);
  }
  function motionActive(){
    return params.wind_strength>0 || (params.drift_auto && params.drift_amount>0)
        || Math.abs(motion.u)>1e-3 || Math.abs(motion.v)>1e-3   // keep simulating until settled
        || Math.abs(motion.uLat)>1e-3 || Math.abs(motion.vLat)>1e-3
        || (hier && hier.maxV>2e-4);
  }
  function tick(dt){
    dt = clamp(dt, 0, 1/15);                                  // guard tab-switch spikes
    const t = motion.time;
    const pat = WIND_PATTERNS[params.wind_pattern] || WIND_PATTERNS.gusty;
    // ---- weather (minutes, spec §5.1): slow deterministic drift of overall STRENGTH and DIRECTION. At
    // weather_variability 0 it is identity (weatherS=1, no veer), so presets are untouched. Driven by low-
    // frequency noise-of-time, not stochastic OU — naturally bounded & mean-reverting, and keeps the whole
    // signal a reproducible function of t (no per-frame RNG). This is "calm day vs gusty day", evolving. ----
    const wv = params.weather_variability, wt = t*0.012*Math.max(1e-3, params.weather_speed);
    const weatherS = clamp(1 + wv*0.85*fbm1(wt, 1, 3, 0.6), 0, 2.5);   // strength swells & lulls over minutes
    const dirVeer  = wv*30*DEG*fbm1(wt+13.1, 1, 3, 0.6);               // ±~30° slow veer/back at full variability
    const effStrength = params.wind_strength*weatherS;
    const effDir = params.wind_direction_deg*DEG + dirVeer;
    motion.windX = Math.cos(effDir); motion.windY = Math.sin(effDir); motion.weatherS = weatherS;   // weatherS exposed for the HUD
    // ---- broadband gust force (seconds): the longitudinal channel carries a steady downwind LEAN plus a
    // gustiness-scaled fluctuation that can dip below zero in deep lulls (so the spring recoils back THROUGH
    // rest — the "comes back" fix); the lateral channel is pure decorrelated crosswind (so it is never a
    // 1-D slide). gust_frequency = the lowest-octave rate; `burst` waveshapes for clustered/squally gusts. --
    const rate = Math.max(1e-3, params.gust_frequency);
    let gL = fbm1(t, rate, pat.octaves, pat.H);
    let gT = fbm1(t+101.7, rate, pat.octaves, pat.H);         // decorrelated lateral stream
    if(pat.burst>0){ const e=1+pat.burst*2;                   // spike peaks, deepen lulls (intermittency)
      gL=Math.sign(gL)*Math.pow(Math.abs(gL),e); gT=Math.sign(gT)*Math.pow(Math.abs(gT),e); }
    const ti = params.wind_gustiness;                         // turbulence intensity σ/U (gL,gT are unit-std)
    const rawL = effStrength*(pat.lean + ti*gL);              // mean lean + fluctuation; <0 in strong lulls → springback through rest
    const driveT = effStrength*(ti*pat.lat*gT);               // zero-mean crosswind — deliberately NOT slewed: the
                                                              // rise-sharp/decay-soft gust-EDGE envelope below is a
                                                              // longitudinal (lean) phenomenon; crosswind has no preferred
                                                              // sign, so an asymmetric slew would bias a zero-mean channel.
    // gust-edge asymmetry: rise sharper than decay (validated). Reuses gust_attack/gust_decay as the slew (LONGITUDINAL only). -
    const tc = (rawL>motion.driveEnv) ? params.gust_attack : params.gust_decay;
    motion.driveEnv += (rawL - motion.driveEnv) * (1 - Math.exp(-dt/Math.max(tc,1e-3)));
    const driveL = motion.driveEnv;
    // ---- two springs (longitudinal u, lateral uLat): underdamped, nonlinear stiffening at the ceiling,
    // backlash (under-damped return stroke). rest = 0 → exact relaxation. wind is a force, not a target. ----
    const w = params.sway_stiffness;
    const steps = Math.max(1, Math.ceil(dt/(1/120)));         // substep for stability across ω
    const h = dt/steps;
    const dz = params.damping_ratio, bl = params.backlash_gain;
    const spring = (u, v, drive) => {                          // one Euler substep of the nonlinear spring
      const denom = Math.max(0.02, 1 - u*u);                  // stiffening: restoring -> ∞ at ceiling
      let damp = dz; if(u*v < 0) damp /= (1 + bl);            // whip-back: under-damp the return stroke
      return v + (w*w*(drive - u/denom) - 2*damp*w*v)*h;      // new velocity
    };
    for(let i=0;i<steps;i++){
      motion.v = spring(motion.u, motion.v, driveL);     motion.u    += motion.v*h;
      motion.vLat = spring(motion.uLat, motion.vLat, driveT); motion.uLat += motion.vLat*h;
    }
    motion.u = clamp(motion.u, -1.5, 1.5);                    // safety; stiffening keeps it near ±1
    motion.uLat = clamp(motion.uLat, -1.5, 1.5);
    // env: a [0,1] "current gust intensity" for the hierarchy breathing (replaces the old gust envelope)
    motion.env += (clamp(Math.abs(motion.u), 0, 1) - motion.env) * (1 - Math.exp(-dt/0.6));
    // compose world sway: u along the (veered) wind, uLat across it, scaled by the ceiling
    const cx = motion.windX, cy = motion.windY, ceil = params.sway_ceiling;
    motion.sway = [ (cx*motion.u - cy*motion.uLat)*ceil, (cy*motion.u + cx*motion.uLat)*ceil ];
    tickHierarchy(steps, h, grove);                           // limb + twig springs (medium band)
    if(groveIn) tickHierarchy(steps, h, groveIn);             // ...and the incoming grove during a crossfade, on the same clocks
    motion.time += dt;
    // incoherent band: advance the drift phase (periodic in 2π). The editor reflects it in its slider.
    if(params.drift_auto && params.drift_amount>0){
      params.drift_phase = (params.drift_phase + params.drift_speed*dt) % TAU;
    }
  }

  // ---- preset transitions (spec §9): morph the continuous look, dissolve the structural rebuild behind
  // a transient cloud-bloom. One entry point — the future MIDI/event layer drives this same method. ----
  function transitionTo(target, opts){
    opts = opts || {};
    if(!target || typeof target!=='object') return;
    const to = Object.assign({}, DEFAULTS, migrateLegacy(target));   // legacy names -> current; missing keys -> defaults (forward-compat, like setParams)
    const from = {};
    for(const k of MORPH_KEYS)  from[k] = params[k];       // continuous look — always morphs live
    for(const k of CANOPY_KEYS) from[k] = params[k];       // continuous canopy — morphs live IF the topology matches
    const topoDiff   = TOPO_KEYS.some(k => to[k]!==params[k]);     // a new tree/layer/seed: can't morph leaf-for-leaf
    const modeDiff   = MODE_KEYS.some(k => to[k]!==params[k]);     // a scene-MODE flag flips (faithful_canopy/standing_scene/receiver): needs a rebuild, NOT a snap-with-stale-state
    const canopyDiff = CANOPY_KEYS.some(k => to[k]!==params[k]);   // branch/leaf knobs differ
    const leafCount  = layerVAO.reduce((s,L)=>s+L.count, 0);       // current grove size
    // a grove morph scales the leaf count by tree_count AND per-twig density (leaves_per_cluster*foliage_density);
    // budget against the busier (more-leaves) end so a dense/many-tree target falls back to the cheap dissolve.
    const densFrom   = Math.max(1e-6, params.leaves_per_cluster*params.foliage_density);
    const densTo     = Math.max(0,    to.leaves_per_cluster*to.foliage_density);
    const morphScale = (Math.max(1, to.tree_count)/Math.max(1, params.tree_count)) * (densTo/densFrom);
    const morphCost  = leafCount * Math.max(1, morphScale);
    // a mode flip can't morph leaf-for-leaf (the bake path / faithTex size / crown sizing change), so it forces a
    // dissolve+rebuild just like a topology change — never a live grove morph (which only regrows, no realloc).
    const morphGrove = canopyDiff && !topoDiff && !modeDiff && morphCost <= CANOPY_MORPH_MAX;   // same branching+mode, small enough -> morph it
    trans.canopyMorph = morphGrove;
    trans.structDiff  = topoDiff || modeDiff || (canopyDiff && !morphGrove);   // dissolve+rebuild on topology OR mode change, or a grove too big to morph
    // WHICH TIER'S BLOOM this is, decided once here rather than re-derived per frame: a mode flip's shallower hump
    // (the camera changes, so cover buys nothing and depth only blows the frame out) or a topology dissolve's
    // deeper one (there is a real grove swap under there that wants hiding). See BLOOM_MAX.
    // Both are STRUCTURAL-only. A tier-1/2 live morph has no bloom to cap, and the longer clock is the bloom's
    // cost being paid for — lengthening an ordinary look-to-look step would change the feel of every arrow press
    // for nothing. (Caught by measurement: applying the stretch to every non-mode route took the tier-1 reference
    // route from 4.9 to 2.6, which is not an improvement, it is a different transition.)
    // THE CROSSFADE GATE (§9), v1 and deliberately narrow — every condition is something the crossfade cannot
    // yet do, not something it does badly:
    //  • a TOPOLOGY change and not a MODE flip — a camera swap has no second grove to blend, it has a second SCENE;
    //  • neither end faithful — that tier pre-integrates one grove into one texture, with nothing to blend against;
    //  • no WOOD at either end — the analytic occluder is one segment table, and this v1 crossfades LEAVES only.
    //    (The table is a texture since the packet before last and can hold two sets, so the wood crossfade is a
    //    real next step rather than a wish; until it exists, branch_tau > 0 keeps the honest cut.)
    //  • the two groves must share one set of layer textures, so the knobs that SIZE those textures have to match.
    // Anything outside the gate takes the paths it already took.
    const layersShared = to.layer_count===params.layer_count && to.tex_resolution===params.tex_resolution
                      && to.bake_resolution===params.bake_resolution;
    const crossOK = topoDiff && !modeDiff && !morphGrove
                 && !faithfulOn() && !to.faithful_canopy
                 && !(params.branch_tau > 0) && !(to.branch_tau > 0)
                 && layersShared;
    const tier = modeDiff ? 'mode' : crossOK ? 'cross' : 'dissolve';
    trans.crossfade = crossOK;
    trans.bloomMax = BLOOM_MAX[tier];
    trans.durScale = trans.structDiff ? DUR_SCALE[tier] : 1;
    if(groveIn){ freeGrove(groveIn); groveIn = null; }   // a transition interrupting a transition drops the half-faded grove
    crossW = 0;
    if(crossOK) groveIn = buildTargetGrove(to);          // grow it NOW, at rest, while it is still invisible
    trans.from = from; trans.to = to;
    trans.dur = Math.max(1e-3, opts.duration!=null ? opts.duration : trans.dur);   // stays the CALLER's number: it is also the sticky default for a later duration-less call, so the mode-flip stretch is applied at the clock (tickTransition) and never compounded into it
    trans.t = 0; trans.swapped = false; trans.bloom = 0; trans.active = true;
    trans.onEnd = opts.onEnd || null;
  }
  function tickTransition(dt){
    if(!trans.active) return;
    const dur = trans.dur * trans.durScale;   // the tier's longer clock (see DUR_SCALE); scaled here, never into trans.dur, which stays the caller's sticky default
    trans.t = Math.min(1, trans.t + Math.min(dt,1/15)/dur);   // clamp the step like tick(): a tab-switch spike must not skip the bloom peak
    const t = trans.t, e = smoothstep(0,1,t);              // ease-in-out for the morph; raw t for the bloom hump
    // 0 at the ends, deepest at the midpoint — where the swap fires. Both structural tiers stop short of full
    // overcast (BLOOM_MAX): past their own depth the bloom stops dissolving anything and only blows the frame out.
    trans.bloom = trans.structDiff ? Math.sin(Math.PI*t) * trans.bloomMax : 0;
    for(const k of MORPH_KEYS){ const a=trans.from[k], b=trans.to[k];
      params[k] = ANGLE_SET.has(k) ? lerpAngle(a,b,e, k==='drift_phase'?TAU:360) : lerp(a,b,e); }
    if(trans.canopyMorph) for(const k of CANOPY_KEYS) params[k] = lerp(trans.from[k], trans.to[k], e);  // deform the SAME grove
    let rebuilt = false;
    // THE CROSSFADE WINDOW replaces the cut where it is gated on: coverage eases 0 -> 1 across [0.5-HW, 0.5+HW],
    // and the arrangement reorganizes instead of being replaced. The incoming grove is installed as the engine's
    // own once it carries the whole picture, which is also when the structural params can safely snap: nothing
    // reads them again until the next regrow.
    if(trans.crossfade){
      crossW = clamp((t - (0.5 - CROSS_HALF_W)) / (2*CROSS_HALF_W), 0, 1);
      crossW = smoothstep(0, 1, crossW);                   // ease it, so the fade has no corners at either end
      if(!trans.swapped && crossW >= 1){
        trans.swapped = true;
        for(const k in DEFAULTS) if(!MORPH_SET.has(k)) params[k] = trans.to[k];
        installGrove(groveIn); groveIn = null; crossW = 0;   // it IS the grove now; nothing is faded any more
      }
    } else if(!trans.swapped && t>=0.5){                   // swap the grove once, hidden under the bloom peak
      trans.swapped = true;
      if(trans.structDiff){
        for(const k in DEFAULTS) if(!MORPH_SET.has(k)) params[k] = trans.to[k];
        rebuildAll(); rebuilt = true;                      // regrow grove + textures + source + bake, all at once
      }
    }
    if(!rebuilt){
      if(trans.canopyMorph) regenCanopy();   // regrow the morphing grove (regenCanopy republishes the carried-over sway)
      regenSource();                         // morphed cloud -> source (always; transport re-reads it every frame)
      // re-bake only when the leaves actually move this frame — a grove morph, or live motion (wind/auto-drift,
      // both of which make motionActive() true). A settled-canopy look-crossfade keeps last frame's identical bake
      // (the tweening leaf_swing/flutter/stem knobs have no effect with motion.u≈0), so it's not re-rasterized.
      // EXCEPT in faithful mode the whole faith texture is sun-projected (its cast frame + per-leaf throw depend on
      // sun_elevation/azimuth), so a still-air time-of-day crossfade MUST re-bake or the dapple freezes at the start
      // angle for the whole morph (the layer path is immune — transport reprojects each frame from uProj/uBulkShift).
      const faithSunMorph = faithfulOn() &&
        (trans.from.sun_elevation_deg!==trans.to.sun_elevation_deg || trans.from.sun_azimuth_deg!==trans.to.sun_azimuth_deg);
      // ...and every frame the crossfade window is open, because the coverage split itself is what changed.
      if(trans.canopyMorph || motionActive() || faithSunMorph || (trans.crossfade && trans.active)) bake();
    }
    if(t>=1){                                              // land exactly on the target; clear the bloom
      trans.active = false; trans.bloom = 0;
      for(const k in DEFAULTS) params[k] = trans.to[k];
      regenSource(); resetPerf();                          // bloom now 0; re-probe quality for the new look (it may carry auto-quality)
      if(faithfulOn()) bake();                   // land the faith texture on the exact target sun (resetPerf only re-bakes on a bake-res change)
      const cb = trans.onEnd; trans.onEnd = null; if(cb) cb();
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
      if(bakeRes() !== perf.bres){ rebuildTextures(); bake(); }   // bake back to baseline if a prior auto session trimmed it
      return;
    }
    const q = perf.quality, KNEE = 0.5, RES_MIN = 0.5, SAMP_MIN = 6;
    let res, samp;
    if(faithfulOn()){
      // FAITHFUL: transport is a single tap (resolution ~free), the per-SAMPLE geometry bake dominates and scales
      // linearly in the sample count — so trim SAMPLES across the whole range (relieving the bake immediately as q
      // drops) and let resolution ride along. bakeRes() still trims below the knee. q=1 → full, look unchanged.
      res  = lerp(RES_MIN, 1, q);
      samp = Math.round(lerp(SAMP_MIN, params.sample_count, q));
    // LAYER MODE, and the two NEW cameras land here by construction: faithfulOn() is false for the enclosure
    // (receiver 2 forces the layer tier) and false for the sky view (no cast frame to pre-bake), so neither can
    // reach the faithful branch above. That is the right branch for both, for the branch's own reason — the cost
    // is per PIXEL, so resolution is the cheapest thing to spend first. What differs is what the second lever
    // buys: the enclosure runs the sample loop, so trimming samples below the knee relieves it exactly as it does
    // the floor; the SKY camera declares no sample loop at all (§4.6), so samples are inert there and its
    // below-knee relief comes entirely from bakeRes() shrinking the layer textures it reads. Harmless either way —
    // a lever with no effect costs nothing — and the seen source is derived analytically, not from the sample
    // sums, so trimming them cannot shift the sun the sky camera is looking at.
    } else if(q >= KNEE){ res = lerp(RES_MIN, 1, (q-KNEE)/(1-KNEE)); samp = params.sample_count; }   // resolution first (on the floor and the enclosure the per-pixel transport sample loop IS the cost)
    else                { res = RES_MIN; samp = Math.round(lerp(SAMP_MIN, params.sample_count, q/KNEE)); } // then samples (and bake, below)
    perf.resScale = res;
    samp = clamp(samp, 3, Math.max(3, params.sample_count));
    if(samp !== perf.sampleCount){ perf.sampleCount = samp; regenSource(); }
    if(bakeRes() !== perf.bres){ rebuildTextures(); bake(); }     // bake_resolution trims with quality below the knee (§9); realloc only at a snapped boundary
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
  // ONE whole rendered frame into `fbo` at w×h — the only entry the frame loop (and the profiler's burst) uses, so
  // the diffusion decision is made in exactly one place. Gate OFF (floor, or glow_bleed 0, or the 16F targets
  // came back incomplete): bind the caller's target and draw transport into it — the literal old path, one extra
  // uniform and an untaken shader branch. Gate ON: transport writes LINEAR HDR into the sharp target instead, and
  // drawDiffusion spreads it and composites into the caller's target (§4.9).
  function drawFrameInto(fbo, w, h){
    // the SKY VIEW joins the diffusion gate (§4.9): the very same linear-HDR spread reads there as the eye's own
    // VEILING GLARE — the wash around a bright source seen through gaps, which is scatter in the eye rather than in
    // a weave, but the same operator on the same quantity. A perception-tier reading of a transport pass, the same
    // honesty class as the mesopic shift below.
    const glow = (params.receiver !== 0 || params.sky_view) && params.glow_bleed > 0 && ensureGlowTargets(w, h);
    perf.glow = glow;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glow ? glowFBO[0] : fbo);
    gl.viewport(0,0,w,h);
    drawTransportInto(glow);
    if(glow) drawDiffusion(fbo, w, h);
  }
  function drawTransport(){ drawFrameInto(null, canvas.width, canvas.height); }                 // to screen
  function drawTransportPresent(){ drawFrameInto(presentFBO, presentW, presentH); }             // adaptive frame-rate: to the offscreen frame
  // LATERAL DIFFUSION targets (§4.9). Returns false — silently, one frame at a time — if the driver won't give us a
  // complete RGBA16F target, and the caller then takes the direct path. That should not happen (create() already
  // fails without EXT_color_buffer_float, and every blend target in the engine is 16F), but the fallback costs three
  // lines and the alternative is a black screen on the one device that disagrees.
  function ensureGlowTargets(w, h){
    if(glowFail) return false;
    if(glowTex[0] && glowW===w && glowH===h) return true;
    for(let i=0;i<3;i++){
      if(glowTex[i]) gl.deleteTexture(glowTex[i]);
      if(!glowFBO[i]) glowFBO[i]=gl.createFramebuffer();
      glowTex[i]=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glowTex[i]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);   // LINEAR HDR: 8-bit would quantize the radiance the blur is about to redistribute
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);              // the blur's taps land between texels
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);           // a tap past the frame edge repeats the edge pixel — the glow leans inward there rather than wrapping light in from the far side
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFBO[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glowTex[i], 0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) glowFail = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    glowW=w; glowH=h;
    if(glowFail) freeGlowTargets();          // don't sit on three full-res 16F buffers we've just proven unusable
    return !glowFail;
  }
  function freeGlowTargets(){
    for(let i=0;i<3;i++){ if(glowTex[i]) gl.deleteTexture(glowTex[i]); glowTex[i]=null; }
    glowW=0; glowH=0;
  }
  // The spread itself: H then V over the linear-HDR frame, then the split + the relocated tail into `fbo`.
  // The pixel radius is PHYSICS, not a look-at-this-resolution number: the curtain map lays view_extent_m across the
  // target's HEIGHT and carries the aspect in x, so px/m is one isotropic number and glow_bleed_m stays the same
  // centimetres of cloth whatever the zoom or the backing store does. Spacing = radius/6 (13 taps over ±3σ), capped.
  // All three passes share the viewport drawFrameInto set — the ping/pong are the same size as the sharp frame.
  // (In the SKY VIEW there is no cloth and no view_extent framing, so the metres-of-fabric reading does not apply:
  // the same two knobs there set a plain screen-space glare radius through the same arithmetic, view_extent_m acting
  // as an arbitrary divisor. Named rather than special-cased — a second scale rule would be a second thing to keep
  // in sync for a knob an author sets by eye anyway.)
  function drawDiffusion(fbo, w, h){
    const rPx = params.glow_bleed_m * h / Math.max(params.view_extent_m, 1e-3);
    const step = Math.min(rPx/GLOW_TAPS, GLOW_STEP_MAX);
    gl.useProgram(progGlowBlur);
    gl.bindVertexArray(emptyVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.glowBlur.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, glowFBO[1]);                  // H: sharp -> ping
    gl.bindTexture(gl.TEXTURE_2D, glowTex[0]);
    gl.uniform2f(U.glowBlur.step, step/w, 0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, glowFBO[2]);                  // V: ping -> pong
    gl.bindTexture(gl.TEXTURE_2D, glowTex[1]);
    gl.uniform2f(U.glowBlur.step, 0, step/h);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);                         // the split + the Look's tail, into the real target
    gl.useProgram(progGlowMix);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, glowTex[0]); gl.uniform1i(U.glowMix.sharp, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glowTex[2]); gl.uniform1i(U.glowMix.blur, 1);
    gl.uniform1f(U.glowMix.diffuse, clamp(params.glow_bleed, 0, 1));
    gl.uniform1f(U.glowMix.exposure, params.exposure);
    gl.uniform1f(U.glowMix.contrast, params.contrast);
    gl.uniform1i(U.glowMix.tone, params.tone_map);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  // the transport draw, assuming a framebuffer + viewport are already bound — so the profiler's stress burst
  // (eng.profiler.bench) can aim it at an offscreen target without flipping to screen. drawFrameInto above owns
  // both callers. linearOut: skip the tone-map tail and write linear HDR for the diffusion tier to spread (§4.9).
  // ---- THE UPLOAD HALF OF THE REGISTRY. One function per uniform GROUP, under the same key TRANSPORT_GROUPS
  // declares it by, so the GLSL that declares a uniform and the JS that fills it are named together and a camera
  // that does not speak a group cannot half-speak it. `u` is the variant's location table; `f` is the handful of
  // per-frame values two groups both need (the canopy box, the atmosphere, whether there is wood to write, and the
  // linear-out flag), computed once in drawTransportInto rather than twice here. Every body below is the body the
  // predicate chain ran — this is a regrouping, not a rewrite. ----
  const GROUP_UPLOAD = {
    head: (u, f) => {
      gl.uniform1f(u.aspect, canvas.width/canvas.height);
      gl.uniform2f(u.viewCenter, params.view_center_x, params.view_center_y);   // camera pan (world m) — frames the off-frame tree; no auto-centre (§4.8)
      gl.uniform2f(u.origin, -f.E/2, -f.E/2);
      gl.uniform2f(u.extent, f.E, f.E);
      // physical sun + sky colour from solar elevation (spec §3.5): warm/red low sun, ozone-blue shadows
      gl.uniform3f(u.sun, f.atm.sun[0], f.atm.sun[1], f.atm.sun[2]);
      gl.uniform3f(u.ambient, f.atm.ambient[0], f.atm.ambient[1], f.atm.ambient[2]);
      gl.uniform1fv(u.heights, layerHeights());
      gl.uniform1i(u.layerCount, params.layer_count);
      for(let i=0;i<MAX_LAYERS;i++){ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, layerTex[i]); gl.uniform1i(u.layers[i], i); }
    },
    rayView: (u) => {
      gl.uniform1f(u.pitch, clamp(params.view_pitch_deg,0,80)*DEG);     // camera tilt (rad); 0 = top-down
      gl.uniform1f(u.yaw, params.view_yaw_deg*DEG);                     // camera orbit (rad); 0 = unchanged
      gl.uniform1f(u.fov, clamp(params.view_fov_deg,5,140)*DEG);        // vertical full FOV (rad)
    },
    // woody occluder (§4.5): trunk + main limbs, continuous heights → connected shadow. Gated by branch_tau (the wood
    // knob): 0 = no wood, byte-identical. The bulk sun-offset (standing scene) rides in `g`, so it casts to the side too.
    // In FAITHFUL mode the whole skeleton (incl. twigs) is baked into the leaf shadow instead, so the analytic occluder is off.
    // The table's texture is bound for every camera (all four read it); its rows are only rewritten when there is
    // wood to write, and with uOccCount 0 the shader never fetches from it.
    occ: (u, f) => {
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, occTex); gl.uniform1i(u.occTex, 5);   // unit 5: 0-3 are the layers, 4 the faith texture
      if(!f.wood){ gl.uniform1i(u.occCount, 0); return; }
      // refill segBuf with the live limb SWING (rotate each segment about its tree's trunk by limbAngle) so the wood
      // sways WITH the leaves; the trunk (limb -1) doesn't rotate. Drift (uOccSway) + sun-shift are added in the shader.
      const buf = occ.segBuf, la = hier ? hier.limbAngle : null;
      for(let k=0;k<occ.count;k++){
        const s = occ.rest[k];
        const th = (la && s.limb>=0 && s.limb<la.length) ? la[s.limb] : 0;
        const c=Math.cos(th), sn=Math.sin(th), px=s.px, py=s.py, o=k*4;
        buf[o]   = px + c*(s.ax-px) - sn*(s.ay-py);
        buf[o+1] = py + sn*(s.ax-px) + c*(s.ay-py);
        buf[o+2] = px + c*(s.bx-px) - sn*(s.by-py);
        buf[o+3] = py + sn*(s.bx-px) + c*(s.by-py);
      }
      // perf todo — occTex is single-buffered, the same tradeoff clusterTex carries and for the same reason: these
      // two rows are rewritten and then fetched by the draw below in the SAME frame, so next frame's upload can
      // stall on this one still draining. A 2-deep ring would break the write-after-read.
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, occ.count, 1, gl.RGBA, gl.FLOAT, buf);        // row 0: plan endpoints, carrying this frame's limb swing
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, occ.count, 1, gl.RGBA, gl.FLOAT, occ.ht);     // row 1: heights + radius, static since the last regrow
      gl.uniform1i(u.occCount, occ.count);
      gl.uniform1f(u.occTau, params.branch_tau);
      gl.uniform2f(u.occSway, motion.sway[0], motion.sway[1]);    // wood drifts with the whole-tree sway
      gl.uniform1f(u.occHRef, Math.max(occ.hRef, 1e-3));          // height-scale ref → trunk foot planted, crown sways
    },
    transport: (u) => {
      gl.uniform3fv(u.samples, src.flat.subarray(0, src.count*3));
      gl.uniform1i(u.count, src.count);
      gl.uniformMatrix2fv(u.proj, false, projMatrix());
      // standing-scene bulk shadow offset (§4.8): cast the shadow to the SIDE by cot(elev) per unit height (the
      // park model omits this — fine for an infinite canopy, wrong for a standing tree). Applied to EVERY occluder
      // (trunk, branches, leaves) via g, so the whole tree shadow stays one connected thing and sweeps together as
      // the sun moves — real physics, no camera tricks. Framing the tree off-frame is the camera's job (a fixed
      // pan, view_center), NOT an auto-centre on the crown (that decouples trunk from crown). Gated → 0 = park.
      const b = bulkShift(); gl.uniform2f(u.bulkShift, b[0], b[1]);   // shared helper (matches the faithful bake; 0 when off)
    },
    woodCast: (u, f) => {
      if(!f.wood) return;                                            // the same gate the table upload took: no wood, no penumbra to size
      const el = Math.max(params.sun_elevation_deg,6)*DEG;            // penumbra/height: source angular core projected to ground (~/sin elev), widened by cloud
      gl.uniform1f(u.occPenumbra, (params.core_angular_radius_deg*DEG)/Math.sin(el)*(1.0+3.0*params.cloud_thickness));
    },
    ca: (u) => {
      // edge diffraction (§3.6): per-channel λ-proportional spread of the transport shift. Green (555nm) is the
      // reference; red(620) spreads more, blue(470) less. 0 -> (1,1,1), the byte-identical single-tap path.
      const d = Math.max(0, params.chromatic_aberration), LR = 620/555, LB = 470/555;
      gl.uniform3f(u.chroma, 1+d*(LR-1), 1, Math.max(0, 1+d*(LB-1)));   // floor blue ≥0: diffraction shrinks the spread to zero, never reverses it
    },
    faith: (u) => {
      // FAITHFUL path (§4.5): tap the pre-integrated soft shadow ONCE instead of the sample loop. The faith texture
      // lives in the cast frame (computed in bakeFaithful, this frame). Off → uFaithful 0 → the layer path, byte-identical.
      // faithfulOn(), not the flag: the enclosure forces the layer tier and never bakes one (§4.9).
      gl.uniform1i(u.faithful, faithfulOn() ? 1 : 0);
      if(!faithfulOn()) return;
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, faithTex); gl.uniform1i(u.faithTex, 4);   // unit 4 free in transport (layers use 0-3)
      gl.uniform2f(u.faithOrigin, faith.ox, faith.oy);
      gl.uniform2f(u.faithExtent, faith.ext, faith.ext);
    },
    // UNIT sun direction — the fold flanks' incidence basis (§4.9), the enclosure's per-panel beam, and the seen
    // source. GOTCHA, and the reason this uniform exists at all: the shader already has two sun vectors, and BOTH
    // are wrong for incidence. uProj and uBulkShift are throw rates per unit height — they carry 1/sin(elevation)
    // and diverge as the sun nears the horizon, so they are floored at 4°/6° to stay finite. Incidence on a VERTICAL
    // cloth does the opposite: cos(el)·|sin(az)| PEAKS as the sun lowers head-on toward the window. So this is the
    // raw unit vector, deliberately unclamped in elevation.
    sunDir: (u) => {
      const el = params.sun_elevation_deg*DEG, az = params.sun_azimuth_deg*DEG;
      gl.uniform3f(u.sunDir, Math.cos(el)*Math.cos(az), Math.cos(el)*Math.sin(az), Math.sin(el));
    },
    floor: (u) => {
      gl.uniform1f(u.viewExtent, params.view_extent_m);
      gl.uniform1f(u.farSmear, Math.max(0, params.far_smear));          // far-field dapple smear (§4.7); 0 at pitch 0 regardless
      gl.uniform3f(u.ground, params.ground_r, params.ground_g, params.ground_b);   // dirt-floor albedo (spec §4.7)
    },
    cloth: (u) => {
      gl.uniform1f(u.viewExtent, params.view_extent_m);
      gl.uniform1f(u.clothY, params.cloth_distance_m);
    },
    // THE FABRIC (§4.9), the material both cloth receivers answer with: Tt carries brightness, the dye only hue.
    fabric: (u) => {
      gl.uniform1f(u.tt, params.fabric_tt);
      gl.uniform3f(u.fabricTint, params.fabric_tint_r, params.fabric_tint_g, params.fabric_tint_b);
      gl.uniform1f(u.foldDepth, params.fold_depth);
      gl.uniform1f(u.foldScale, params.fold_scale);
      gl.uniform1f(u.foldCoarsen, params.fold_coarsen);
      // fold WARP (§4.9): the pleats' out-of-plane displacement in metres — GEOMETRY, feeding transport's read, where
      // fold_depth above is authored shading on a flat plane. 0 leaves every cast read at its flat coordinate.
      gl.uniform1f(u.foldWarp, params.fold_warp);
      gl.uniform1f(u.sheen, params.velvet_sheen);
      // forward-scatter wrap (§4.9): the ballistic/scattered SPLIT of the transmit, not an extra term — energy-bounded
      // by construction, and 0 leaves the pleat shading exactly as it was.
      gl.uniform1f(u.scatter, params.fabric_scatter);
    },
    window: (u) => {
      // window mullion grid (§4.9): the near-cloth authored occluder, analytic in cloth space. tau 0 = off (the shader
      // skips it), and only the curtain declares it, so no other camera pays. The penumbra is the woody occluder's
      // idiom MINUS its 1/sin(elevation) ground-obliquity term — the cloth is seen head-on — so it is just depth ×
      // the source's angular width, cloud widening the source exactly as it does for the wood (§3.4).
      gl.uniform4f(u.mullion, params.mullion_pitch_m, params.mullion_bar_m, params.mullion_depth_m, Math.max(0, params.mullion_tau));
      gl.uniform1f(u.mullPenumbra, params.mullion_depth_m * (params.core_angular_radius_deg*DEG) * (1.0+3.0*params.cloud_thickness));
      // the window APERTURE (§4.9): half-extents, so the shader's rect test is one abs()-minus-half. w·h = 0 is the gate
      // (an infinite lit field — every look before this one, byte-identical); the aperture shares the bars' plane and
      // penumbra above because it IS the window's outermost frame member.
      gl.uniform4f(u.window, 0.5*Math.max(0, params.window_w_m), 0.5*Math.max(0, params.window_h_m), params.window_cx_m, params.window_cy_m);
      gl.uniform1f(u.windowWall, clamp(params.window_wall, 0, 1));
    },
    // THE ENCLOSURE's polytope (§4.9). TWO INVARIANTS THE SHADER RELIES ON, both enforced here and nowhere else.
    // (1) THE EYE SITS STRICTLY INSIDE every half-space, which is what makes every exit distance positive and lets
    // the intersection be a bare min() with no sign handling. Five constraints bind it — the crown overhead
    // (z < ridge), each end wall, which the eye approaches as lean·eye grows toward the clearance the wall leaves at
    // the eye's own y (0.7·len ahead, 0.5 + 0.3·len behind), and each HIP, which rakes back faster than its own wall
    // does and therefore overtakes it above the vent apex. The near pair binds first, being the closer cap. The side
    // walls never bind at x = 0, and no hip's x term does either. All five are taken as a min rather than resolved
    // case-by-case: over-tightening the eye costs nothing, letting it out of the tent costs the whole routine.
    // (2) THE ARCH BULGES OUTWARD at the shoulder, and its profile stays a FUNCTION OF HEIGHT. Note what the first
    // half is NOT protecting: an intersection of half-spaces is convex whatever the planes do, so the min-exit is
    // never wrong. What breaks is the SHAPE. Put the shoulder INSIDE the straight base→crown line and the arc bends
    // the wrong way — the lower tangent planes stop containing the crown edge, so they slice it off, and pushed far
    // enough the eye itself ends up outside, which is invariant (1). So the shoulder half-width is floored at that
    // straight line (where all three Bézier control points go collinear, every tangent plane coincides, and the
    // shape degenerates exactly to the v2 single-slope tent) and capped at a sane flare.
    // The SECOND half is new with the arc and it is what keeps the geometry single-valued: the profile's height
    // sweep is monotone iff the Bézier control point sits strictly between the ends in z, i.e. 0 < 2·shoulderH −
    // ridge/2 < ridge, i.e. shoulderH ∈ (0.25, 0.75)·ridge. Outside that the curve doubles back in height — the
    // tangent's z-component changes sign, the smooth normal's height inversion has two answers, and normalize()
    // gets handed a zero vector. [0.30, 0.70] keeps a margin inside it. Everything else is floored off its
    // degenerate value: a tent with no interior has nothing to cast.
    tent: (u) => {
      const ridge = Math.max(params.tent_ridge_h_m, 1e-2);
      const halfW = Math.max(params.tent_half_w_m, 1e-2);
      const crownW = clamp(params.tent_crown_w_m, 0, 0.9*halfW);   // 0.9 keeps a real horizontal run in the profile even when the crown is asked to be the whole roof
      const len   = Math.max(params.tent_len_m, 0.5);
      const lean  = clamp(params.tent_end_lean, 0, 4);
      const shH   = clamp(params.tent_shoulder_h_m, 0.30*ridge, 0.70*ridge);   // the height-monotonicity window (see above); outside it the arc doubles back
      const shLine = halfW + (crownW - halfW)*(shH/ridge);         // the STRAIGHT base→crown profile at that height — the convexity floor
      // (3) THE HIPS MUST RAKE BACK FASTER THAN THE END WALL, or they never bind and the far cap silently stays the
      // slab it was; and they must stay far enough OFF the wall that the seam pass reads three panels rather than
      // three coincident planes it paints dark end to end. 0.15 is that floor (≈ 4 cm of setback at the shipped
      // dimensions, three times the 12 mm seam core). The apex stays strictly between the floor and the crown: at 0
      // the triangle has no height and at the ridge it swallows the whole end.
      const apex  = clamp(params.tent_end_apex_h_m, 0.10*ridge, 0.90*ridge);
      const rake  = clamp(params.tent_hip_rake, 0.15, 3);
      const gap   = Math.min(                                      // the tightest cap clearance at the eye's own y, per metre of eye height
        (0.7*len)/Math.max(lean, 1e-3),                            // far end wall
        (0.7*len + rake*apex)/(lean + rake),                       // far hip — tighter than the wall wherever the eye rides above the apex
        (0.5 + 0.3*len)/Math.max(lean, 1e-3),                      // near end wall
        (0.5 + 0.3*len + rake*apex)/(lean + rake));                // near hip. The near cap is the CLOSER of the two, so it binds first
      gl.uniform1f(u.tentRidge, ridge);
      gl.uniform1f(u.tentHalfW, halfW);
      gl.uniform1f(u.tentCrownW, crownW);
      gl.uniform1f(u.tentShoulderH, shH);
      gl.uniform1f(u.tentShoulderW, clamp(params.tent_shoulder_w_m, shLine, 1.4*halfW));
      gl.uniform1f(u.tentLen, len);
      gl.uniform1f(u.tentEndLean, lean);
      gl.uniform1f(u.tentEndApex, apex);
      gl.uniform1f(u.tentHipRake, rake);
      gl.uniform1f(u.tentEye, Math.min(Math.max(params.tent_eye_h_m, 0), 0.95*ridge, 0.95*gap));
      gl.uniform1f(u.tentFade, Math.max(0, params.tent_fade));
      gl.uniform1f(u.tentSeam, Math.max(0, params.tent_seam));
      gl.uniform1f(u.tentMesh, clamp(params.tent_mesh, 0, 1));
    },
    // THE SKY VIEW's own three: regenSource's numbers, so the sun you look at and the dapples it throws are drawn
    // from one distribution. No other camera declares them — there is no seen source anywhere else.
    sky: (u) => {
      gl.uniform1f(u.skyScatter, clamp(params.sky_scatter, 0, 1));
      gl.uniform2f(u.srcAngR, src.coreR, src.haloR);
      gl.uniform2f(u.srcAngL, src.Lcore, src.Lhalo);
      gl.uniform2f(u.srcMoon, src.moonD, src.moonR);
    },
    post: (u, f) => {
      // distance haze: the sky/ambient HUE at a steady brightness, so the far floor fades into a time-of-day-
      // consistent atmosphere (only visible once tilt blooms the fog; invisible at pitch 0).
      const a = f.atm.ambient, m = Math.max(a[0],a[1],a[2],1e-4), hb = 0.6;
      gl.uniform3f(u.haze, a[0]/m*hb, a[1]/m*hb, a[2]/m*hb);
      // Purkinje (§3.5): rods take over the dim shade as the sun lowers. The global weight rides the same
      // low-sun band that warms the beam; it hard-gates off (and costs nothing) for a daytime sun.
      gl.uniform1f(u.twilight, smoothstep(30, 4, params.sun_elevation_deg));
      gl.uniform1f(u.mesopic, params.mesopic_strength);
      gl.uniform1f(u.exposure, params.exposure);
      gl.uniform1f(u.contrast, params.contrast);
      gl.uniform1i(u.tone, params.tone_map);
      gl.uniform1i(u.linearOut, f.linearOut);   // 0 = end the Look here (every look); 1 = hand linear HDR to the diffusion passes (§4.9)
    },
  };
  // The seam, closed from this side: GROUP_UPLOAD_KEYS is what the coherence test reads, this is what the engine
  // actually dispatches, and a name in one and not the other would otherwise be an upload that silently never runs.
  for(const k of GROUP_UPLOAD_KEYS) if(!GROUP_UPLOAD[k]) fail(`transport group "${k}" is declared to upload and has no uploader`);
  for(const k in GROUP_UPLOAD) if(!GROUP_UPLOAD_KEYS.includes(k)) fail(`transport group "${k}" uploads but is missing from GROUP_UPLOAD_KEYS`);
  function drawTransportInto(linearOut){
    gl.disable(gl.BLEND);
    // THE CAMERA IS THE PROGRAM (§4.6/§4.9), and the registry is what says so once. Which variant runs is a MODE
    // decision resolved here per draw; what it uploads is its entry's group list, walked in order. There is no
    // predicate chain left to keep in agreement with the shader's — the entry IS the agreement.
    const cam = transportCamera(), variant = transportFor(cam), tp = variant.U;
    gl.useProgram(variant.prog);
    const f = {
      E: params.canopy_extent_m,
      atm: atmosphere(_atm, params.sun_elevation_deg, params.sky_turbidity, params.ambient_skylight),
      wood: !faithfulOn() && params.branch_tau > 0 && occ.count > 0,   // read by the table upload and the penumbra alike, so they cannot disagree
      linearOut: linearOut ? 1 : 0,
    };
    for(const name of CAMERAS[cam].groups){
      const up = GROUP_UPLOAD[name];
      if(up) up(tp, f);                                              // functions-only groups (the taps, the fold field, the warp) upload nothing
    }
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
  // ---- editor-only debug overlays (source + tree-preview insets); EDITOR=false strips this whole block ----
  let drawSourceInset, drawTreeInset, treeInsetHit;
  if(EDITOR){
  drawSourceInset = () => {
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
  };

  // ---- 3D preview of the ACTUAL grove (todo [3]): the grown skeleton + leaf blobs, in a slowly
  // turning 3/4 view that sways with the wind. Optional editor inset ('T'); the geometry is CPU-
  // projected into a scissored corner, so it costs nothing unless shown. ----
  let treeGrow = 0;   // 0 = parked small in the corner, 1 = grown; eases toward the hover/pinned target
  // inset leaf scatter: one blob per LEAF (count = leaves_per_cluster × foliage_density) so the density
  // slider visibly fills/thins the preview. Base positions are scattered once per regrow (keyed on `hier`
  // identity — every canopy knob makes a new hier) and reprojected each frame; the proj buffer is reused.
  let treeLeafHier=null, treeLeafBase=null, treeLeafProj=null;
  function buildTreeLeaves(){
    // Drive the preview off the grove's TWIGS (one cluster per leaf-bearing node) — NOT terminal segments. With droop,
    // a twig is split into sub-segments all tagged level≥levels, so the old segment-filter over-drew nSub×nLeaf clusters
    // at mid-twig joints and mis-keyed the per-twig seed by segment index. Iterating twigs[] matches the bake's count,
    // per-twig seed (hash3(seed,j,101)), hug heading (t.dx/t.dy) and marginal-leaf fade. (spec §9 — preview ≈ bake)
    const tws = hier.twigs || [];
    const pcF = Math.max(0, params.leaves_per_cluster*params.foliage_density);
    const pcInt = Math.floor(pcF), frac = pcF - pcInt;
    const nLeaf = pcInt + (frac>1e-4 ? 1 : 0);
    const base=[];
    const faithful = faithfulOn();   // hoisted, and it must be the SAME answer regenCanopy packed the bake with
    for(let j=0;j<tws.length;j++){
      const t=tws[j], cx=t.x, cy=t.y, cz=t.z, tcov=(t.tcov===undefined?1:t.tcov);
      const ti=(t.tree===undefined?0:t.tree), tnt=((ti*0.61803398875)%1)*2-1;   // per-tree warmth [-1,1], golden-spread so neighbours differ
      let tdx=t.dx||0, tdy=t.dy||0; const tdl=Math.hypot(tdx,tdy), tHasDir=tdl>1e-4; if(tHasDir){ tdx/=tdl; tdy/=tdl; }   // grown twig heading (the bake's stored t.dx,t.dy), so the hug matches even on a drooped twig
      const gauss=makeGauss(mulberry32(hash3(params.seed>>>0, j, 101)));   // per-twig scatter, j = twig index == the bake's seed (same count & spread, not bit-identical)
      for(let k=0;k<nLeaf;k++){
        const g1=gauss(), g2=gauss();   // leaves hug the twig — must match the bake (§4.5)
        const cov = ((k===pcInt) ? frac : 1.0) * tcov;   // marginal-leaf fade × marginal-tree fade — matches the bake (E#54), so a density morph tracks the cast
        const hug = faithful && tHasDir;
        const x = hug ? cx - Math.abs(g1)*params.cluster_spread_m*1.5*tdx - g2*params.cluster_spread_m*0.4*tdy : cx + g1*params.cluster_spread_m;
        const y = hug ? cy - Math.abs(g1)*params.cluster_spread_m*1.5*tdy + g2*params.cluster_spread_m*0.4*tdx : cy + g2*params.cluster_spread_m;
        base.push(x, y, cz, cov, tnt);
      }
    }
    treeLeafBase=new Float32Array(base);
    treeLeafProj=new Float32Array(base.length/5*6);   // base: x,y,z,cov,tint (5) -> proj: x,y,r,g,b,size (6)
    treeLeafHier=hier;
  }
  function treeInsetGeom(){
    const base = Math.min(300, canvas.width*0.32, canvas.height*0.42);
    const big  = Math.min(canvas.width*0.62, canvas.height*0.72);
    const S = Math.round(base + (big-base)*treeGrow);
    return { S, ix: canvas.width-S-8, iy: 8 };        // anchored bottom-right; grows up-left
  }
  treeInsetHit = (ptr) => {                          // is the normalised pointer over the current inset?
    if(!ptr) return false;
    const {S,ix,iy}=treeInsetGeom();
    const l=ix/canvas.width, r=(ix+S)/canvas.width, tp=1-(iy+S)/canvas.height, bt=1-iy/canvas.height;
    return ptr.x>=l && ptr.x<=r && ptr.y>=tp && ptr.y<=bt;
  };
  // grow while hovered; a CLICK pins it big (pinned) until clicked again. ptr = normalised coords or null.
  drawTreeInset = (ptr, pinned) => {
    if(!hier?.segments?.length) return;
    const segs = hier.segments, levels = Math.max(1, params.branch_levels|0);
    treeGrow = clamp(treeGrow + (((pinned||treeInsetHit(ptr))?1:0)-treeGrow)*0.18, 0, 1);   // smooth ease
    const { S, ix, iy } = treeInsetGeom();
    // grove bounds for the fit scale
    let R=1e-3, maxZ=1e-3;
    for(const s of segs){ R=Math.max(R, Math.hypot(s.a[0],s.a[1]), Math.hypot(s.b[0],s.b[1])); maxZ=Math.max(maxZ, s.a[2], s.b[2]); }
    const fit = 0.72/Math.max(R, maxZ*1.4);
    const tt = performance.now()/1000;
    const yaw = tt*0.25, cyw=Math.cos(yaw), syw=Math.sin(yaw);     // slow turntable so it reads as 3D
    const pitch = 24*DEG, hk=Math.cos(pitch), dk=Math.sin(pitch);
    const wx=motion.windX, wy=motion.windY;   // EFFECTIVE wind dir (weather-veered) — matches the bake & trunk drift
    const lean = motion.u*0.9, sx0=motion.sway[0], sy0=motion.sway[1];   // wind: lean + trunk drift (drift carries the lateral channel)
    // NOTE: motion.u is intentionally applied TWICE here — as the height-weighted `lean` (a cheap proxy for the bake's
    // per-joint limb/twig rotation, which the preview doesn't re-derive) and again inside motion.sway (the trunk drift).
    // So the preview leans a touch harder than the bake translates; that's by design (spec §9 — preview ≈ bake, not =).
    const offY = -0.4;
    const P = (p) => {                                   // 3D world (+wind) -> inset NDC
      const lf = lean*(p[2]/maxZ);                       // taller points lean more downwind
      const ax=p[0]+wx*lf+sx0, ay=p[1]+wy*lf+sy0, az=p[2]*1.4;
      const u=ax*cyw-ay*syw, depth=ax*syw+ay*cyw;
      return [ u*fit, (az*hk - depth*dk)*fit + offY ];
    };
    const L=[]; const pushLine=(p,q,r,g,b)=>{ const A=P(p),B=P(q); L.push(A[0],A[1],r,g,b,0, B[0],B[1],r,g,b,0); };
    // ground grid (z=0)
    const gExt=R*1.05, gN=4;
    for(let i=-gN;i<=gN;i++){ const f=i/gN*gExt;
      pushLine([f,-gExt,0],[f,gExt,0], 0.15,0.17,0.15);
      pushLine([-gExt,f,0],[gExt,f,0], 0.15,0.17,0.15); }
    // wind-direction arrow on the ground (only when the wind is blowing)
    if(params.wind_strength>0){ const aL=gExt*0.85, tx=wx*aL, ty=wy*aL, hb=gExt*0.16;
      const rot=(a)=>[wx*Math.cos(a)-wy*Math.sin(a), wx*Math.sin(a)+wy*Math.cos(a)];
      pushLine([0,0,0],[tx,ty,0], 0.5,0.6,0.78);
      const h1=rot(2.6), h2=rot(-2.6);
      pushLine([tx,ty,0],[tx+h1[0]*hb,ty+h1[1]*hb,0], 0.5,0.6,0.78);
      pushLine([tx,ty,0],[tx+h2[0]*hb,ty+h2[1]*hb,0], 0.5,0.6,0.78); }
    // branches as tapered quads (real width, not 1-px GL lines): trunk thickest -> twig thin. Built into a
    // triangles buffer Q, drawn solid behind the foliage and again faintly OVER it so the skeleton ghosts
    // through (level<=1 brown -> twig tan; cov<1 fades a marginal morphing-in tree toward the sky bg).
    const Q=[]; const pushQuad=(p,q,wpx,r,g,b)=>{
      const A=P(p),B=P(q); let dxn=B[0]-A[0],dyn=B[1]-A[1]; const dl=Math.hypot(dxn,dyn)||1e-6; dxn/=dl; dyn/=dl;
      const hw=wpx/S, nx=-dyn*hw, ny=dxn*hw;                  // perpendicular half-width in NDC (square S×S viewport)
      Q.push(A[0]+nx,A[1]+ny,r,g,b,0, A[0]-nx,A[1]-ny,r,g,b,0, B[0]+nx,B[1]+ny,r,g,b,0,
             A[0]-nx,A[1]-ny,r,g,b,0, B[0]-nx,B[1]-ny,r,g,b,0, B[0]+nx,B[1]+ny,r,g,b,0); };
    // branch width follows the SAME pipe-model taper as the shadow occluder (reflects taper_delta), so the
    // preview shows thick-trunk → thin-twig exactly as the cast silhouette will: width × children^(−1/Δ) per level.
    const pkids=Math.max(1,params.branch_children|0), ptf=Math.pow(Math.max(1.001,pkids), -1/clamp(params.taper_delta,1,4));
    for(const s of segs){ const f=Math.max(0, Math.min(1,(s.level-1)/Math.max(1,levels-1))), cv=(s.cov===undefined?1:s.cov);
      const wpx=Math.max(0.6, 4.4*Math.pow(ptf, s.level));   // trunk (level 0) thick -> twig thin, by Δ
      pushQuad(s.a, s.b, wpx, lerp(0.05,0.30+0.20*f,cv), lerp(0.07,0.22+0.16*f,cv), lerp(0.09,0.12+0.06*f,cv)); }
    // leaf blobs: the scatter on every terminal twig, so the density slider fills/thins the preview.
    if(treeLeafHier!==hier) buildTreeLeaves();
    const lsz=S*0.04, nLf=treeLeafBase.length/5;
    // per-leaf opacity falls as the per-twig count climbs, so a dense canopy reads as a translucent haze the
    // branches show through (option 3) instead of an opaque green wall — density stays legible as coverage.
    const leafAlpha=clamp(1.8/Math.sqrt(Math.max(1,Math.round(params.leaves_per_cluster*params.foliage_density))),0.12,0.6);
    for(let i=0;i<nLf;i++){                                  // inline P() — no per-leaf array alloc (there can be tens of thousands)
      const b5=5*i, bx=treeLeafBase[b5], by=treeLeafBase[b5+1], bz=treeLeafBase[b5+2], cv=treeLeafBase[b5+3], w=treeLeafBase[b5+4];
      const lf=lean*(bz/maxZ), ax=bx+wx*lf+sx0, ay=by+wy*lf+sy0, az=bz*1.4;
      const u=ax*cyw-ay*syw, depth=ax*syw+ay*cyw, f=bz/maxZ, o=6*i, vv=1.0+w*0.10;   // w: per-tree warmth -> hue + value shift
      treeLeafProj[o]=u*fit; treeLeafProj[o+1]=(az*hk-depth*dk)*fit+offY;
      treeLeafProj[o+2]=lerp(0.05,0.18+0.12*f,cv)*(1.0+w*0.28)*vv;   // warm trees redder...
      treeLeafProj[o+3]=lerp(0.07,0.42+0.18*f,cv)*(1.0+w*0.05)*vv;
      treeLeafProj[o+4]=lerp(0.09,0.16+0.10*f,cv)*(1.0-w*0.28)*vv;   // ...and cooler trees bluer
      treeLeafProj[o+5]=lsz;
    }
    // ---- draw: framed sky, ground+arrow lines, branches (solid), leaf haze, branches again (faint, over) ----
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(ix-1,iy-1,S+2,S+2); gl.clearColor(0.16,0.20,0.16,1.0); gl.clear(gl.COLOR_BUFFER_BIT);   // frame
    gl.scissor(ix,iy,S,S); gl.viewport(ix,iy,S,S);
    gl.clearColor(0.05,0.07,0.09,1.0); gl.clear(gl.COLOR_BUFFER_BIT);                                    // sky
    gl.useProgram(progViz);
    gl.bindVertexArray(vizVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, vizBuf);
    gl.uniform1f(U.viz.point, 0.0); gl.uniform1f(U.viz.lineAlpha, 1.0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.DYNAMIC_DRAW);     // ground grid + wind arrow
    gl.drawArrays(gl.LINES, 0, L.length/6);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Q), gl.DYNAMIC_DRAW);     // branches, solid (behind the foliage)
    gl.drawArrays(gl.TRIANGLES, 0, Q.length/6);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(U.viz.point, 1.0); gl.uniform1f(U.viz.pointAlpha, leafAlpha);
    gl.bufferData(gl.ARRAY_BUFFER, treeLeafProj, gl.DYNAMIC_DRAW);            // leaf haze
    gl.drawArrays(gl.POINTS, 0, treeLeafProj.length/6);
    gl.uniform1f(U.viz.point, 0.0); gl.uniform1f(U.viz.lineAlpha, 0.4);       // faint skeleton ghosting through the foliage
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Q), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, Q.length/6);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,canvas.width,canvas.height);
  };
  }   // end if(EDITOR) — editor-only inset overlays

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
    const merged = Object.assign({}, DEFAULTS, migrateLegacy(obj));   // legacy names -> current; missing keys -> defaults (forward-compat)
    for(const k in DEFAULTS) params[k] = merged[k];
    rebuildAll();
    resetPerf();                                       // a preset may carry auto-quality
  }

  // ---- profiling primitive (EDITOR only, spec §9). The engine owns measurement because it owns the GL passes;
  // the editor's profiler.js + UI orchestrate. `timed` defaults to a passthrough (so frame() is unaffected in
  // the player build, where this whole block dead-strips); the editor swaps in real GPU timer queries. ----
  let timed = (_pass, draw) => draw();
  let motionTick = tick;   // default: this engine runs its own physics. EDITOR can swap it to mirror another instance.
  let profiler = null;
  if(EDITOR){
    // timer queries: a 2-deep ring per pass, so frame N reads frame N-1's result (it isn't ready same-frame).
    // Disjoint frames are discarded; off or unsupported -> just draw (byte-identical to the un-instrumented path).
    let instrumenting = false;
    const TIME_ELAPSED = 0x88BF, GPU_DISJOINT = 0x8FBB;   // EXT_disjoint_timer_query_webgl2 enums
    const tq = { bake:{q:[null,null], i:0}, transport:{q:[null,null], i:0} };
    timed = (pass, draw) => {
      if(!instrumenting || !extTimer){ draw(); return; }
      const r = tq[pass], cur = r.q[r.i&1];               // this slot's query, issued 2 frames ago (ready now)
      if(cur){
        if(gl.getQueryParameter(cur, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(GPU_DISJOINT))
          profiler[pass==='bake'?'bakeMs':'transportMs'] = gl.getQueryParameter(cur, gl.QUERY_RESULT)/1e6;
        gl.deleteQuery(cur);
      }
      const q = gl.createQuery();
      gl.beginQuery(TIME_ELAPSED, q); draw(); gl.endQuery(TIME_ELAPSED);
      r.q[r.i&1] = q; r.i++;                               // self-advance: each pass flips its own ring per frame
    };
    // offscreen stress burst: render a pass n times into an off-screen RGBA8 target at the live backing size,
    // then readPixels one texel to fence — so wall-clock spans real GPU work uncapped by vsync (one synchronous
    // burst, not one-per-rAF). headroom = a 60fps frame budget / per-render ms. Works even where timer queries don't.
    function ensureBenchTarget(){
      // measure transport at MAX resolution (resScale=1), NOT the live auto-quality-trimmed backing — the
      // profiler exists to show the cost of each stylistic decision at full quality (spec §9), and on a weak
      // device the live canvas may already be downscaled, which would understate the true cost.
      const dpr=Math.min(2, window.devicePixelRatio||1);
      const w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
      if(benchFBO && benchW===w && benchH===h) return;
      if(benchTex) gl.deleteTexture(benchTex);
      if(!benchFBO) benchFBO=gl.createFramebuffer();
      benchTex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, benchTex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, benchFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, benchTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      benchW=w; benchH=h;
    }
    function bench(pass, n){
      n = Math.max(1, n|0);
      // fence the burst with gl.finish() (drains ALL queued GL work). The old readPixels fence was a RGBA/UNSIGNED_BYTE
      // read of an RGBA16F target (layerTex[0]) — an invalid combo that errors instead of flushing, and in faithful
      // mode bake() writes faithTex (layerTex[0] is a 1×1 dummy), so the fence read the wrong/unwritten texture. (E#35)
      if(pass==='transport'){
        ensureBenchTarget();
        const t0=performance.now();
        for(let i=0;i<n;i++) drawFrameInto(benchFBO, benchW, benchH);   // the whole frame, diffusion included — the tier's cost is the thing the axis measures
        gl.finish();
        const ms=(performance.now()-t0)/n;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { ms, headroom: 16.67/Math.max(ms,1e-3) };
      }
      if(pass==='bake'){
        const t0=performance.now();
        for(let i=0;i<n;i++) bake();                            // bake targets its own layer/faith FBOs
        gl.finish();                                            // fence: drains the bake passes (layer or faithful)
        const ms=(performance.now()-t0)/n;
        return { ms, headroom: 16.67/Math.max(ms,1e-3) };
      }
      return { ms:0, headroom:Infinity };
    }
    profiler = { hasTimer: !!extTimer, bakeMs:0, transportMs:0, setInstrument(on){ instrumenting=!!on; }, bench };
  }

  // ---- motion mirror (EDITOR only): drive this engine's wind EXACTLY from another instance instead of its own
  // physics, so the A/B picker's two engines animate in lockstep. Safe because the profiler's variants never
  // change the grove skeleton (tree/limb/branch/seed), so the spring arrays line up 1:1. Holds for faithful_canopy
  // too: flipping it keeps the same grown grove and spring arrays — only the cast path (layer vs per-sample bake)
  // changes — so the mirror stays sound for that axis as well. snapshotMotion exposes
  // live refs (read-only); applyMotion copies them in + re-uploads the bend texture; setMotionSource swaps the
  // per-frame tick for a copy-from-source. The bake only reads angles + sway + time, so velocities aren't needed. ----
  let snapshotMotion, applyMotion, setMotionSource;
  if(EDITOR){
    snapshotMotion = () => ({ m:motion, dphase:params.drift_phase, lA:hier?.limbAngle, lP:hier?.limbPitch, tA:hier?.twigAngle });
    applyMotion = (s) => {
      if(!s) return;
      const sm=s.m;
      motion.time=sm.time; motion.u=sm.u; motion.v=sm.v; motion.uLat=sm.uLat; motion.vLat=sm.vLat;
      motion.env=sm.env; motion.driveEnv=sm.driveEnv; motion.windX=sm.windX; motion.windY=sm.windY; motion.weatherS=sm.weatherS;
      motion.sway[0]=sm.sway[0]; motion.sway[1]=sm.sway[1];
      params.drift_phase = s.dphase;                       // incoherent band rides a param the source advances
      if(hier && s.lA && hier.limbAngle.length===s.lA.length){
        hier.limbAngle.set(s.lA); hier.limbPitch.set(s.lP); hier.twigAngle.set(s.tA);   // BOTH limb DOFs, or the wipe's two engines foreshorten differently
        publishBend(grove);                                // push the mirrored bend into the texture the bake reads
      }
    };
    setMotionSource = (src) => { motionTick = src ? () => applyMotion(src.snapshotMotion()) : tick; };
  }

  // ---- init + frame loop ----
  rebuildAll();
  resetPerf();
  let last=performance.now(), fps=60, paused=false, alive=true;
  const eng = { canvas, gl, params, perf, motion, src, trans, occ, fps:60, apply, setParams, transitionTo, onFrame:opts.onFrame||null,
    // pause the rAF loop so a second engine instance idles at zero GPU when off-screen (the editor's A/B picker)
    setPaused(on){ on=!!on; if(on===paused) return; paused=on; if(!on){ last=performance.now(); requestAnimationFrame(frame); } },
    // dispose: stop the loop and free EVERY GL object + the context, so a disposable second instance (the A/B
    // picker, created per-comparison) leaves zero GPU residue when closed. A disposed engine must not be reused.
    dispose(){
      alive = false;
      [progBake, progFaith, progFaithSeg, progFAcc, progBlit, progPresent, progGlowBlur, progGlowMix, progPoints, progViz].forEach(p => { if(p) gl.deleteProgram(p); });
      transportCache.forEach(v => { gl.deleteProgram(v.prog); });   // however many cameras this engine actually visited
      transportCache.clear();
      layerTex.forEach(t => { gl.deleteTexture(t); });
      [clusterTex, clusterGeomTex, occTex, faithTex, faithScratch, benchTex, presentTex].forEach(t => { if(t) gl.deleteTexture(t); });
      freeGlowTargets();                             // the diffusion tier's three 16F frames (no-op when the gate never opened)
      [bakeFBO, faithFBO, benchFBO, presentFBO, ...glowFBO].forEach(f => { if(f) gl.deleteFramebuffer(f); });
      layerVAO.forEach(L => { gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.buf); });
      if(faith.vao){ gl.deleteVertexArray(faith.vao); gl.deleteBuffer(faith.buf); }
      if(faith.segVAO){ gl.deleteVertexArray(faith.segVAO); gl.deleteBuffer(faith.segBuf); }
      if(sky.segVAO){ gl.deleteVertexArray(sky.segVAO); gl.deleteBuffer(sky.segBuf); }
      [emptyVAO, srcDbgVAO, vizVAO].forEach(v => { if(v) gl.deleteVertexArray(v); });
      [quadBuf, srcDbgBuf, vizBuf].forEach(b => { if(b) gl.deleteBuffer(b); });
      if(EDITOR) setMotionSource(null);              // drop any mirror-source ref so a disposed follower can't pin its source
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    ...(EDITOR ? { drawSourceInset, drawTreeInset, treeInsetHit, profiler, snapshotMotion, applyMotion, setMotionSource,
                   isLowMotion: () => motionMagnitude() < ADAPT_LO } : {}) };   // editor-only handles, stripped from the player build
  // ---- adaptive frame-rate helpers (TUNE §9) ----
  function ensureFrameTarget(){                       // lazy canvas-sized RGBA8 present target; reallocated on resize
    const w=canvas.width, h=canvas.height;
    if(presentFBO && presentW===w && presentH===h) return;
    if(presentTex) gl.deleteTexture(presentTex);
    if(!presentFBO) presentFBO=gl.createFramebuffer();
    presentTex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, presentTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);   // 1:1 same-size copy -> NEAREST is exact, no softening
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, presentFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, presentTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    presentW=w; presentH=h;
  }
  function presentFrame(){                            // blit the last rendered frame to screen (cheap; runs every rAF under adaptive)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(progPresent);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, presentTex); gl.uniform1i(U.present.tex, 0);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  // motion magnitude: how fast the rendered image is changing. Driven by the wind springs (a steady lean still
  // flutters the leaves every frame, so |u| counts) — NOT by slow auto-drift, which is meant to run at idle_fps.
  // Hysteresis between LO/HI so it doesn't flap at the boundary. Returns true if this frame is due to render heavy.
  function motionMagnitude(){   // also read by the editor's profiler to estimate adaptive's skip fraction
    return Math.max(Math.abs(motion.u), Math.abs(motion.uLat),
                    Math.abs(motion.v)*0.5, Math.abs(motion.vLat)*0.5,
                    hier ? hier.maxV*0.5 : 0);
  }
  function adaptiveDue(now){
    const m = motionMagnitude();
    if(adaptiveHot){ if(m < ADAPT_LO) adaptiveHot=false; }
    else if(m > ADAPT_HI) adaptiveHot=true;
    if(adaptiveHot) return true;                                       // moving -> every frame (no judder on real wind)
    return (now - adaptiveLastRender) >= 1000/Math.max(1, params.adaptive_idle_fps);   // low -> idle cadence
  }
  function frame(now){
    if(!alive || paused) return;                     // dispose() halts permanently; setPaused(true) halts until resumed
    const dtms=now-last; last=now; fps += ((1000/Math.max(dtms,1))-fps)*0.1; eng.fps=fps;
    if(perf.auto) tunePerf(dtms, fps);               // auto-quality: nudge resolution/samples toward 60 fps
    resize();
    // adaptive frame-rate (opt-in): only off-transition, non-debug. While motion is low, render the heavy passes
    // at adaptive_idle_fps into presentTex and re-present it the rest of the time; off -> the unchanged path below.
    if(params.adaptive_motion && !trans.active && !params.show_layer){
      if(!adaptiveDue(now)){                          // skip: re-present the last rendered frame (byte-identical), no bake/transport
        presentFrame();
        if(eng.onFrame) eng.onFrame(dtms);
        requestAnimationFrame(frame);
        return;
      }
      const dt = clamp((now - adaptiveLastRender)/1000, 0, 1/15);   // elapsed since last HEAVY render (skipped frames fold in)
      adaptiveLastRender = now;
      if(motionActive()){ motionTick(dt); timed('bake', bake); }
      ensureFrameTarget();
      timed('transport', drawTransportPresent);       // heavy transport (+ the diffusion passes, if the gate is open) -> offscreen
      presentFrame();                                 // offscreen -> screen
      if(eng.onFrame) eng.onFrame(dtms);
      requestAnimationFrame(frame);
      return;
    }
    const dt = dtms/1000;
    if(trans.active){                                // a running transition owns the re-source/re-bake each frame
      if(motionActive()) tick(dt);                   // keep wind alive; the morph re-asserts drift_phase right after
      tickTransition(dt);
    } else if(motionActive()){ motionTick(dt); timed('bake', bake); }   // advance (or mirror a source) + re-bake only when moving
    if(params.show_layer && !faithfulOn()) drawLayerBlit(); else timed('transport', drawTransport);   // show_layer is a no-op in faithful mode (the layer textures aren't baked)
    if(eng.onFrame) eng.onFrame(dtms);               // editor draws HUD + source inset here
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return eng;
}

export { create };
