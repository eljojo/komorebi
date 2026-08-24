import { clamp, lerp } from './komorebi-math.js';
import { MAX_SAMPLES, BAKE_MIN, MAX_LAYERS, MAX_OCC, CANOPY_KEYS, TOPO_KEYS, DEFAULTS, migrateLegacy } from './komorebi-params.js';
import { VS_BAKE, FS_BAKE, VS_FAITH, FS_FAITH, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_FULL, FS_BLIT, FS_PRESENT, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ } from './komorebi-shaders.js';
import { TRANSPORT_GROUPS, CAMERAS, cameraFor, buildTransport } from './komorebi-transport.js';
import { makeSource } from './komorebi-source.js';
import { makeMotion } from './komorebi-motion.js';
import { makeTransitions } from './komorebi-transitions.js';
import { makeGrove } from './komorebi-grove.js';
import { makeBake } from './komorebi-bake.js';
import { makeRender } from './komorebi-render.js';
import { makeEditorTools } from './komorebi-editor-tools.js';

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
  const hub = {};  // THE SHARED INTERNALS — filled below (stable plumbing + mutable state), closed over by every subsystem factory
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
  // Which variant this draw runs — the registry's own selector (§4.9), bound to these params. It can only change
  // across a structural rebuild: sky_view and receiver are both MODE_KEYS.
  const transportCamera = () => cameraFor(params);
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

  const bakeFBO = gl.createFramebuffer();
  const faithFBO = gl.createFramebuffer();   // FAITHFUL scratch target (§4.5): faithScratch attached here once per bake so the per-sample loop swaps FBOs instead of re-attaching (was 2N framebufferTexture2D/frame)
  // adaptive frame-rate (TUNE §9): offscreen present target + cadence state. presentFBO/presentTex are canvas-sized
  // and allocated lazily on first use (so a look that never enables adaptive_motion pays nothing).
  let presentTex=null, adaptiveLastRender=0, adaptiveHot=true;
  const ADAPT_HI=0.05, ADAPT_LO=0.02;   // hysteresis on the motion magnitude: above HI render every frame, below LO drop to idle_fps
  // lateral diffusion (§4.9): [0] = transport's LINEAR-HDR frame (the sharp one), [1]/[2] = the separable blur's
  // ping/pong. RGBA16F at the render size, one FBO each (attached once at allocation, so no per-frame re-attach),
  // allocated lazily on first use and reallocated on resize — a look that never opens the gate holds no VRAM.
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

  // ---- THE SHARED INTERNALS (hub), continued: the stable plumbing and the shared mutable state. The engine's
  // subsystems live in sibling modules (grove, bake, source,
  // motion, transitions, render, editor tools); each is a factory that closes over this one object. Stable
  // plumbing is destructured at a factory's top; everything REASSIGNED at runtime must be read as E.x so
  // every subsystem sees the current value. The factories also hang their public functions on E, which is
  // how cross-subsystem calls resolve without import cycles. ----
  Object.assign(hub, {
    // stable plumbing (never reassigned)
    gl, canvas, fail, MAX_TEX, extTimer, params, perf, motion, trans, src, occ, occTex, faith, sky, U,
    quadBuf, emptyVAO, bakeFBO, faithFBO,
    progBake, progFaith, progFaithSeg, progFAcc, progBlit, progPresent, progGlowBlur, progGlowMix, progPoints, progViz,
    effCloud, bakeBaseline, bakeRes, faithfulOn, transportFor, transportCamera,
    // shared mutable state (was create()-closure lets)
    layerTex: [],           // MAX_LAYERS textures (active sized, inactive 1x1)
    layerVAO: [],           // per-layer leaf instance VAOs {vao,count,buf}
    faithTex: null,         // FAITHFUL path (§4.5): pre-integrated soft shadow (RGBA16F); 1×1 when faithful_canopy off
    faithScratch: null,     // FAITHFUL path: per-sample transmittance scratch (RGBA16F); 1×1 when off
    hier: null,             // branch hierarchy: limb + twig spring state (built in regenCanopy)
    groveIn: null,          // the INCOMING grove during a crossfade (§9): grown early, baked alongside the active one, installed when the window closes
    crossW: 0,              // its coverage share, 0 -> 1 across the window
    grove: null,            // the ACTIVE grove value (hier + layerVAO + its two data textures); the views above point into it
    clusterTex: null,       // per-clump dynamic bend angles (limb, twig), updated each frame
    clusterGeomTex: null,   // per-clump static geometry (clump centre + trunk pivot)
    benchFBO: null, benchTex: null,   // profiler stress-burst target (EDITOR; here so dispose() can free it)
    presentFBO: null, presentW: 0, presentH: 0,   // adaptive frame-rate present target (TUNE §9), allocated lazily
    srcDbgBuf: null, srcDbgVAO: null, vizBuf: null, vizVAO: null,   // editor-only debug-overlay buffers
    timed: (_pass, draw) => draw(),   // profiling hook: the editor swaps in real GPU timer queries (EDITOR)
    motionTick: null,       // the per-frame physics tick; set below, swapped by the editor's motion mirror
    profiler: null,         // the measurement primitive (EDITOR)
    snapshotMotion: null, applyMotion: null, setMotionSource: null,   // motion mirror (EDITOR)
    drawSourceInset: null, drawTreeInset: null, treeInsetHit: null,   // editor debug overlays (EDITOR)
  });


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
    hub.layerTex.forEach(t=>{ gl.deleteTexture(t); });
    hub.layerTex = [];
    const res = bakeRes();
    perf.bres = res;                                 // remember the built size; applyQuality reallocates when bakeRes() crosses it
    for(let i=0;i<MAX_LAYERS;i++){
      // faithful mode never bakes or samples the layer textures (transport taps faithTex once), so size them 1×1
      // there too — saves ~layer_count·res²·8 bytes of dead VRAM (≈16 MB at defaults). Reallocated full when faithful off.
      hub.layerTex.push(makeLayerTexture((i < params.layer_count && !faithfulOn()) ? res : 1));
    }
    // FAITHFUL path (§4.5): the soft-shadow accumulator + per-sample scratch. 1×1 when off, so the park / layer
    // path allocates nothing extra; full bake-res when faithful_canopy is on.
    if(hub.faithTex) gl.deleteTexture(hub.faithTex);
    if(hub.faithScratch) gl.deleteTexture(hub.faithScratch);
    const fres = faithfulOn() ? res : 1;
    hub.faithTex = makeLayerTexture(fres);
    hub.faithScratch = makeLayerTexture(fres);
  }

  const { buildGrove } = makeGrove(hub);
  Object.assign(hub, { buildGrove });

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
    if(hub.grove && hub.grove !== g) freeGrove(hub.grove);
    hub.grove = g;
    hub.hier = g.hier; hub.layerVAO = g.layerVAO; hub.clusterTex = g.clusterTex; hub.clusterGeomTex = g.clusterGeomTex;
    publishBend(g);   // push the (preserved or rest) bend into the fresh texture, so a bake right after a regrow isn't a frame snapped to rest
  }
  function regenCanopy(){ installGrove(buildGrove(hub.hier)); }   // the old shape: grow one, make it the one
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

  const { bake, bakeFaithful } = makeBake(hub);
  Object.assign(hub, { bake, bakeFaithful });



  const { regenSource, bulkShift, projMatrix, layerHeights } = makeSource(hub);
  Object.assign(hub, { regenSource, bulkShift, projMatrix, layerHeights });


  const { tickHierarchy, publishBend, motionActive, tick } = makeMotion(hub);
  Object.assign(hub, { tickHierarchy, publishBend, motionActive, tick });

  // the engine-resident coordinators the transition route drives (hoisted function declarations)
  Object.assign(hub, { freeGrove, installGrove, regenCanopy, buildTargetGrove, rebuildAll, resetPerf });
  const { transitionTo, tickTransition } = makeTransitions(hub);
  Object.assign(hub, { transitionTo, tickTransition });

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

  const { drawFrameInto, drawTransport, drawTransportPresent, drawDiffusion, freeGlowTargets, drawLayerBlit, glowFBO } = makeRender(hub);
  Object.assign(hub, { drawFrameInto, drawTransport, drawTransportPresent, drawDiffusion, freeGlowTargets, drawLayerBlit });
  if(EDITOR) makeEditorTools(hub);   // debug overlays + profiler + motion mirror; EDITOR=false strips the call (and its module with it)

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
    // an in-flight transition must not outlive the swap: its morph would keep writing params over the new
    // look, and mid-CROSSFADE the incoming grove would keep baking against layer state rebuildAll is about
    // to replace (the observed crash: bake reading a dangling grove's VAOs). Abort it cleanly first —
    // transitionTo already does this for its own interruptions; a hard param swap deserves the same.
    if(trans.active){
      trans.active=false; trans.onEnd=null; trans.swapped=false;
      if(hub.groveIn){ freeGrove(hub.groveIn); hub.groveIn=null; }
      hub.crossW=0;
    }
    const merged = Object.assign({}, DEFAULTS, migrateLegacy(obj));   // legacy names -> current; missing keys -> defaults (forward-compat)
    for(const k in DEFAULTS) params[k] = merged[k];
    rebuildAll();
    resetPerf();                                       // a preset may carry auto-quality
  }

  hub.motionTick = tick;   // default: this engine runs its own physics. EDITOR can swap it to mirror another instance.

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
      hub.layerTex.forEach(t => { gl.deleteTexture(t); });
      [hub.clusterTex, hub.clusterGeomTex, occTex, hub.faithTex, hub.faithScratch, hub.benchTex, presentTex].forEach(t => { if(t) gl.deleteTexture(t); });
      freeGlowTargets();                             // the diffusion tier's three 16F frames (no-op when the gate never opened)
      [bakeFBO, faithFBO, hub.benchFBO, hub.presentFBO, ...glowFBO].forEach(f => { if(f) gl.deleteFramebuffer(f); });
      hub.layerVAO.forEach(L => { gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.buf); });
      if(faith.vao){ gl.deleteVertexArray(faith.vao); gl.deleteBuffer(faith.buf); }
      if(faith.segVAO){ gl.deleteVertexArray(faith.segVAO); gl.deleteBuffer(faith.segBuf); }
      if(sky.segVAO){ gl.deleteVertexArray(sky.segVAO); gl.deleteBuffer(sky.segBuf); }
      [emptyVAO, hub.srcDbgVAO, hub.vizVAO].forEach(v => { if(v) gl.deleteVertexArray(v); });
      [quadBuf, hub.srcDbgBuf, hub.vizBuf].forEach(b => { if(b) gl.deleteBuffer(b); });
      if(EDITOR) hub.setMotionSource(null);              // drop any mirror-source ref so a disposed follower can't pin its source
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    ...(EDITOR ? { drawSourceInset: hub.drawSourceInset, drawTreeInset: hub.drawTreeInset, treeInsetHit: hub.treeInsetHit, profiler: hub.profiler, snapshotMotion: hub.snapshotMotion, applyMotion: hub.applyMotion, setMotionSource: hub.setMotionSource,
                   isLowMotion: () => motionMagnitude() < ADAPT_LO } : {}) };   // editor-only handles, stripped from the player build
  // ---- adaptive frame-rate helpers (TUNE §9) ----
  function ensureFrameTarget(){                       // lazy canvas-sized RGBA8 present target; reallocated on resize
    const w=canvas.width, h=canvas.height;
    if(hub.presentFBO && hub.presentW===w && hub.presentH===h) return;
    if(presentTex) gl.deleteTexture(presentTex);
    if(!hub.presentFBO) hub.presentFBO=gl.createFramebuffer();
    presentTex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, presentTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);   // 1:1 same-size copy -> NEAREST is exact, no softening
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hub.presentFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, presentTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    hub.presentW=w; hub.presentH=h;
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
                    hub.hier ? hub.hier.maxV*0.5 : 0);
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
      if(motionActive()){ hub.motionTick(dt); hub.timed('bake', bake); }
      ensureFrameTarget();
      hub.timed('transport', drawTransportPresent);       // heavy transport (+ the diffusion passes, if the gate is open) -> offscreen
      presentFrame();                                 // offscreen -> screen
      if(eng.onFrame) eng.onFrame(dtms);
      requestAnimationFrame(frame);
      return;
    }
    const dt = dtms/1000;
    if(trans.active){                                // a running transition owns the re-source/re-bake each frame
      if(motionActive()) tick(dt);                   // keep wind alive; the morph re-asserts drift_phase right after
      tickTransition(dt);
    } else if(motionActive()){ hub.motionTick(dt); hub.timed('bake', bake); }   // advance (or mirror a source) + re-bake only when moving
    if(params.show_layer && !faithfulOn()) drawLayerBlit(); else hub.timed('transport', drawTransport);   // show_layer is a no-op in faithful mode (the layer textures aren't baked)
    if(eng.onFrame) eng.onFrame(dtms);               // editor draws HUD + source inset here
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return eng;
}

export { create };
