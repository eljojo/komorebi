import { clamp, lerp } from './komorebi-math.js';
import { MAX_SAMPLES, BAKE_MIN, MAX_LAYERS, MAX_OCC, DEFAULTS, migrateLegacy, cutWarnings, layerBakeSize } from './komorebi-params.js';
import { VS_BAKE, FS_BAKE, VS_FAITH, VS_FAITH_PIVOT, FS_FAITH, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_LITTER, FS_LITTER, VS_FULL, FS_FILL, FS_FILL_GROUND, FS_FILL_UP, FS_FILL_BOUNCE, FS_BLIT, FS_PRESENT, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ } from './transport/komorebi-shaders.js';
import { TRANSPORT_GROUPS, CAMERAS, cameraFor, buildTransport } from './transport/komorebi-transport.js';
import { makeSource } from './light/komorebi-source.js';
import { makeCast } from './transport/komorebi-cast.js';
import { makeMotion, MAX_MOTION_STEP } from './motion/komorebi-motion.js';
import { makeTransitions } from './transitions/komorebi-transitions.js';
import { restTrans } from './transitions/komorebi-routes.js';
import { makeGrove, seasonKey, densityEligible, densityCount, growAs, attachGrove, detachGrove, attachedGrove, freeGrove as freeGroveGL } from './canopy/komorebi-grove.js';
import { makeBake, makeFill, NO_FILL, FILL_SIG_LEN } from './transport/komorebi-bake.js';
import { makeTreeView, NO_TREE_VIEW } from './transport/komorebi-tree-view.js';
import { makeLitter, newLitterState, NO_LITTER } from './season/komorebi-litter.js';
import { makeRender } from './transport/komorebi-render.js';
import { makeEditorTools } from './komorebi-editor-tools.js';
import { makeSceneFade } from './transitions/komorebi-scene-fade.js';
import { makeLeafTravel } from './transitions/komorebi-leaf-travel.js';
import { makeSeasonTravel } from './transitions/komorebi-season-travel.js';
import { makeLitterRise } from './transitions/komorebi-litter-rise.js';
import { makeGroveTravel } from './transitions/komorebi-grove-travel.js';
import { authoredLook, FIDELITY_KEYS, PLAYBACK_KEYS, resolveParams, resolveSession, makeFpsProbe } from './komorebi-session.js';

// Build flag. Raw/dev ES-module loads keep EDITOR=true; the player deploy bundle sets it false via
// `bun build --define:KOMOREBI_EDITOR=false`, which const-folds and dead-strips the editor-only debug
// overlays (their shaders, buffers, draw fns). typeof keeps an undefined-global load safe (= true).
const EDITOR = (typeof KOMOREBI_EDITOR !== "undefined") ? KOMOREBI_EDITOR : true;

// The same idea for the fall tiers this file builds (komorebi-params.js FEATURES, embed-build.mjs): a deploy bundle for one page's looks substitutes each of these by a literal,
// and a false one removes the sky fill's factory and program, or the litter carpet's, from the bundle altogether. Raw modules keep both true.
const FEAT_FILL = true;
const FEAT_LITTER = true;
const FEAT_TREE_VIEW = true;
// WHICH BUILD THIS IS and what it cut. The raw modules cut nothing; a bundle's build rewrites this line (verbatim, or it throws) with its file name, the looks it was
// made for and the tiers it left out, so that a host which opens one of those gets told once (warnCut) rather than a quietly different picture.
const BUILD = { name: 'modules', cut: [] };

// ===========================================================================
// create(canvas, opts) — one self-contained engine instance on a canvas.
// ===========================================================================
function create(canvas, opts){ return createEngine(canvas, opts); }

// THE CONTEXT'S PROGRAMS. A program belongs to the GL context that linked it, not to the engine, and a driven scene (a
// dissolve's outgoing look, a litter rise's source, a grove travel's other end) draws on its host's canvas, so on its
// context. So the scene takes the programs its host has already linked instead of linking them again: compiling them
// was most of the frame a dissolve froze on. Each program is counted by the engines holding it and deleted when the
// last one lets go. Sharing a program shares its uniform values, which is safe because every draw uploads each uniform
// its program reads before it draws. Keyed by the two sources, vertex then fragment, so equal text is one program.
const CONTEXT_PROGRAMS = new WeakMap();   // gl -> Map<vs, Map<fs, { prog, users }>>
function contextPrograms(gl){
  let t = CONTEXT_PROGRAMS.get(gl);
  if(!t){ t = new Map(); CONTEXT_PROGRAMS.set(gl, t); }
  return t;
}

// A driven scene shares this canvas's context but owns no animation loop, events or context lifetime.
function createEngine(canvas, opts, driven=false){
  opts = opts || {};
  const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, premultipliedAlpha:false });
  function fail(msg){ throw new Error(`komorebi: ${msg}`); }
  if (!gl) fail('WebGL2 is required and not available in this browser.');
  const hub = {};  // THE SHARED INTERNALS — filled below (stable plumbing + mutable state), closed over by every subsystem factory
  const extCBF = gl.getExtension('EXT_color_buffer_float');     // renderable half/float
  gl.getExtension('EXT_float_blend');                            // genuinely OPTIONAL: it only governs blending into *32-bit* float
                                                                 // targets. Every blend target here is RGBA16F (makeLayerTexture: the
                                                                 // layers, faithTex, faithScratch) or R16F (makeWoodTexture: the sky view's
                                                                 // wood), which are color-renderable AND blendable in core WebGL2 once
                                                                 // EXT_color_buffer_float is present.
                                                                 // The only RGBA32F textures (clusterTex/clusterGeomTex) are data
                                                                 // textures, texelFetch-sampled, never blended — so do NOT promote this
                                                                 // to a hard requirement (it would reject capable 16F-blend devices).
  if (!extCBF) fail('EXT_color_buffer_float is required (float render targets).');
  const MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;  // caps the per-clump data-texture width
  // profiling (EDITOR only): GPU timer queries for absolute per-pass ms. The extension is often absent or
  // coarsened by browsers for privacy — callers must tolerate null (test-gl/cost.mjs requires it).
  // EXT_disjoint_timer_query_webgl2 measures TIME_ELAPSED over a range of GL commands.
  let extTimer = EDITOR ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;   // mutable: extensions are per-context-incarnation, re-fetched by initGPU() after a context restore

  let sessionEnvironment={...opts.environment,maxTextureSize:MAX_TEX};
  let session = opts.session === undefined ? null : resolveSession(opts.session, sessionEnvironment);
  let fpsProbe=session?.automaticAdaptive?makeFpsProbe():null,startupFps=null,skipFpsInterval=false;
  const ownerDocument=canvas.ownerDocument;
  function onVisibilityChange(){skipFpsInterval=true;}
  function applyStartupFps(){
    if(!session)return;
    session.startupFps=startupFps?.fps;
    session.adaptiveDetected=!!startupFps?.low;
    if(session.automaticAdaptive && startupFps?.low)session.playback.adaptive_motion=true;
  }
  let authored = authoredLook(opts.params);
  let pendingSession = false;
  const params = resolveParams(opts.params, session);
  // A ZOOM MOVES THE CAMERA, NEVER THE TREES. The grove fills a reach, which a look that names none takes from its view when the grove is grown
  // (komorebi-grove.js). Once the view has moved under a grown grove the two differ, and the look takes the reach its grove has, so a later regrow
  // and a saved look grow the grove that is on screen. Asked wherever the params are re-applied or read back; a route owns the view while it runs.
  function holdReach(){
    const g = hub.grove;
    if(g && !trans.active && !(params.grove_reach_m > 0) && g.reach !== params.view_extent_m) params.grove_reach_m = g.reach;
  }
  function readLook(){
    holdReach();
    if(!session) return { ...params };
    const look={...authored};
    for(const key in DEFAULTS) if(!FIDELITY_KEYS.includes(key) && !PLAYBACK_KEYS.includes(key) && key!=='edge_area') look[key]=params[key];
    return look;
  }
  function captureLook(){
    const look=readLook();
    if(session)authored=look;
    return {...look};
  }
  function playbackNow(){
    if(!session) return;
    Object.assign(params, session.playback);
    for(const end of [trans.from, trans.to]) if(end) Object.assign(end, session.playback);
  }
  function settleSession(){
    if(!pendingSession || trans.active) return;
    pendingSession=false;
    const next=resolveParams(authored,session);
    const changed=[...FIDELITY_KEYS,'edge_area'].some(key=>params[key]!==next[key]);
    for(const key of [...FIDELITY_KEYS,'edge_area',...PLAYBACK_KEYS]) params[key]=next[key];
    warnCut(params);
    if(!lost && changed)rebuildRested();
  }
  // A tier the host opens that this build cut stays off, and is said so once per engine: at the three doors params come through (here, setParams, transitionTo).
  const warned = new Set();
  const warnCut = (P) => { for(const m of cutWarnings(P, BUILD, warned)) console.warn(m); };
  warnCut(params);
  // Auto-quality runtime throttle (driven by the params.auto_quality toggle). Holds the live
  // resolution / sample-count it trims to. Never touches the artistic params.
  const perf = { auto:false, quality:1, resScale:1, sampleCount:params.sample_count, bres:0, acc:0, lowCount:0, hiCount:0, upWait:20, glow:false };  // bres = size the layer textures are currently built at (so applyQuality knows when to reallocate); glow = the lateral-diffusion tier actually ran this frame (false when gated off OR when its 16F targets came back incomplete)
  // Motion — one time-driven state, two bands (spec/model/motion.md). u = longitudinal sway fraction (signed, along the
  // effective wind), uLat = lateral (crosswind) sway fraction; each its own spring. windX/Y = the effective
  // wind direction after the weather veer; weatherS = the live weather strength multiplier (read by the HUD);
  // driveEnv = the asymmetric-edged longitudinal force; env = [0,1] gust intensity for the hierarchy breathing.
  const motion = { time:0, u:0, v:0, uLat:0, vLat:0, env:0, driveEnv:0, sway:[0,0], windX:1, windY:0, weatherS:1 };
  // Transition — cloud-bloom crossfade between looks (spec/model/transitions.md). t walks 0->1 over dur: the continuous
  // params morph, the grove swaps once at the bloom peak, and `bloom` is a transient overcast that hides it.
  const trans = restTrans();   // every field at rest (komorebi-routes.js)
  const effCloud = () => clamp(lerp(params.cloud_thickness, 1, trans.bloom), 0, 1);  // cloud, swollen toward overcast mid-transition
  const bakeBaseline = () => layerBakeSize(params);  // TUNE spec/implementation.md: decoupled bake size; 0 follows tex_resolution.
  // Live bake / layer-texture size. Pure function of quality + params: when auto_quality is engaged it trims the
  // bake below the knee (q<0.5) alongside samples, snapped to 256 so the textures only reallocate at a level
  // boundary — not on every fps nudge. rebuildTextures/bake both read this (transport samples by UV → smaller = softer).
  const bakeRes = (full=bakeBaseline()) => {
    if(!perf.auto || perf.quality >= 0.5) return full;
    return clamp(Math.round(lerp(BAKE_MIN, full, perf.quality/0.5)/256)*256, BAKE_MIN, full);
  };
  const faithfulSamples = (full=params.sample_count) => clamp(Math.round(lerp(6,full,perf.quality)),session?Math.min(3,full):3,session?full:Math.max(3,full));
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
  function program(vs,fs,feedback){
    const p=gl.createProgram();
    gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));
    gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
    if(feedback) gl.transformFeedbackVaryings(p,feedback,gl.INTERLEAVED_ATTRIBS);   // the outputs a transform-feedback pass writes, named before the link
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) fail(`Link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }
  // The engine's own programs come from the context's table (above), and so do every route's (the dissolve's mix, the season travel's
  // cast, the leaf, grove and litter travels'), which a route used to link at its start and delete at its end: a route takes them through
  // the HOST engine, since a borrowed scene's hold dies with the scene, and deletes none. `held` maps each entry this engine took to its key,
  // one hold per program however often it is asked for, for releasePrograms to give back.
  const held = new Map();
  function shared(vs,fs,feedback){   // feedback: a pass's outputs, which belong to its vertex shader, so the two sources stay the key
    const table = contextPrograms(gl);
    let byFs = table.get(vs);
    if(!byFs){ byFs = new Map(); table.set(vs, byFs); }
    let e = byFs.get(fs);
    if(!e){ e = { prog: program(vs,fs,feedback), users: 0 }; byFs.set(fs, e); }
    if(!held.has(e)){ e.users++; held.set(e, [vs, fs]); }
    return e.prog;
  }
  function releasePrograms(){
    const table = contextPrograms(gl);
    for(const [e, [vs, fs]] of held){
      const byFs = table.get(vs);
      if(byFs?.get(fs) !== e || --e.users > 0) continue;
      gl.deleteProgram(e.prog); byFs.delete(fs);
      if(!byFs.size) table.delete(vs);
    }
    held.clear();
  }
  // initGPU() creates the eager handles — create() calls it once, and a webglcontextrestored calls it again, because
  // a lost context kills all of them. Hence `let`, not `const`. The handles made lazily outside it and held outside the
  // subsystems it rebuilds (the transport cache, the fill's and the litter's programs and textures, the present target,
  // the grove's and the layers' VAOs and textures) must also be forgotten by hand in onContextRestored, or a restore
  // keeps a dead handle.
  let progBake, progFaith, progFaithPivot, progFaithSeg, progFAcc, progBlit, progPresent, progGlowBlur, progGlowMix, progPoints, progViz;
  let emptyVAO, quadBuf, bakeFBO, faithFBO, fillFBO, occTex;
  let reseasonGrove, reseasonable, growGrove, uploadGrove, bake, refreshFaith, refreshLitter, buildGrove, drawFrameInto, drawTransport, drawTransportPresent, drawDiffusion, freeGlowTargets, drawLayerBlit, glowFBO;   // the GL-owning subsystems, rebuilt with the handles they close over

  const U = {};
  function loc(prog, name){ return gl.getUniformLocation(prog, name); }
  function faithLocs(prog){
    return { origin:loc(prog,'uFaithOrigin'), extent:loc(prog,'uFaithExtent'), g:loc(prog,'uG'), edge:loc(prog,'uEdge'),
      seasonCast:loc(prog,'uSeasonCast'),curtainBake:loc(prog,'uCurtainBake'),clothY:loc(prog,'uClothY'),
      morph:loc(prog,'uMorph'),morphAmount:loc(prog,'uMorphAmount'),sway:loc(prog,'uSway'),hRef:loc(prog,'uHRef'),
      windLevel:loc(prog,'uWindLevel'),air:loc(prog,'uAir'),depth:loc(prog,'uDepth'),windTime:loc(prog,'uWindTime'),leafSwing:loc(prog,'uLeafSwing'),flutterFreq:loc(prog,'uFlutterFreq'),tiltShadow:loc(prog,'uTiltShadow'),
      clusterTex:loc(prog,'uClusterTex'),clusterGeom:loc(prog,'uClusterGeom'),beamK:loc(prog,'uBeamK'),edgeArea:loc(prog,'uEdgeArea'),
      leafTex:loc(prog,'uLeafTex'),leafShape:loc(prog,'uLeafShape'),shapeBox:loc(prog,'uShapeBox'),leafIdFrac:loc(prog,'uLeafIdFrac'),leafRows:loc(prog,'uLeafRows')};
  }
  // ---- THE TRANSPORT PROGRAM CACHE (spec/model/transport.md). One program per camera, built by buildTransport, compiled on
  // FIRST USE and then kept for the engine's life. The four authored cameras move on a MODE
  // flip (sky_view / receiver), which already tears the grove down and rebuilds it under the transition bloom — so
  // the one first-compile a camera ever costs lands inside that bloom, where a frame's hitch is already hidden, and
  // never recurs. The programs come from the context's table, so a driven scene on this canvas reuses them; an A/B
  // wipe's second instance has its own GL context and links its own. A fifth program carries sky↔floor
  // transitions through the horizon, using the same grove and the two endpoint cameras' reads. ----
  const transportCache = new Map();
  // Which variant this draw runs — the registry's own selector (spec/implementation.md), bound to these params. It can only change
  // across a structural rebuild (sky_view and receiver are MODE_KEYS), or along the continuous viewpoint route.
  const transportCamera = () => trans.active && trans.riseField ? 'rise' : trans.active && trans.viewpoint && (trans.t>0 || trans.viewInterrupted) ? 'viewpoint' : cameraFor(params);
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
  function transportFor(camera, sky = false){   // sky: view_sky's variant of the floor (buildTransport), compiled the first time it is asked for
    const key = sky && camera === 'floor' ? 'floor+sky' : camera;
    let e = transportCache.get(key);
    if(!e){
      const prog = shared(VS_FULL, buildTransport(camera, sky));
      e = { prog, U: transportLocs(prog, camera) };
      transportCache.set(key, e);
    }
    return e;
  }
  // THE SKY FILL's bake program (spec/model/fill.md): compiled on first use like a transport variant, so a look that never opens
  // canopy_fill (every shipped one but the fall looks) pays neither the compile nor the textures. A program belongs to the context that
  // linked it, so a restore forgets it (see onContextRestored) and the next fill compiles afresh. A const behind its flag and not a function declaration: a bundle that
  // cut the fill must not be left holding the shader this names (a minifier keeps an unused function declaration, and the string with it).
  let fillEntry = null;
  const fillFor = FEAT_FILL ? () => {
    if(!fillEntry){
      const prog = shared(VS_FULL, FS_FILL);
      fillEntry = { prog, U: { origin:loc(prog,'uCanopyOrigin'), extent:loc(prog,'uCanopyExtent'), sun:loc(prog,'uSunColor'),   // origin/extent: the box the LAYERS were baked over; frameOrigin/frameExtent: the plan square the FILL is baked over
        layers:['uLayer[0]','uLayer[1]','uLayer[2]','uLayer[3]'].map(n => loc(prog,n)), heights:loc(prog,'uLayerHeight[0]'), layerCount:loc(prog,'uLayerCount'),
        frameOrigin:loc(prog,'uFillOrigin'), frameExtent:loc(prog,'uFillExtent'), sunPath:loc(prog,'uFillG'), open:loc(prog,'uFillOpen'),
        ray:loc(prog,'uFillRay[0]'), turn:loc(prog,'uFillTurn[0]'), count:loc(prog,'uFillCount'), scatter:loc(prog,'uFillScatter'), beamK:loc(prog,'uFillBeamK'), edgeArea:loc(prog,'uEdgeArea'),
        bounce:loc(prog,'uFillBounce'), groundBounce:loc(prog,'uGroundBounce') } };
    }
    return fillEntry;
  } : null;
  // THE GROUND, RETURNED BY THE UNDERSIDES (spec model/fill.md): the fill's three bounce passes, compiled on the first ground_bounce above 0, as the fill's own
  // program is on the first canopy_fill. Behind the fill's flag, for the same reason.
  let bounceEntry = null;
  const bounceFor = FEAT_FILL ? () => {
    if(!bounceEntry){
      const common = (prog) => ({ prog, origin:loc(prog,'uCanopyOrigin'), extent:loc(prog,'uCanopyExtent'), sun:loc(prog,'uSunColor'), ambient:loc(prog,'uAmbient'),
        layers:['uLayer[0]','uLayer[1]','uLayer[2]','uLayer[3]'].map(n => loc(prog,n)), heights:loc(prog,'uLayerHeight[0]'), layerCount:loc(prog,'uLayerCount'),
        frameOrigin:loc(prog,'uFillOrigin'), frameExtent:loc(prog,'uFillExtent'), open:loc(prog,'uFillOpen'), beamK:loc(prog,'uFillBeamK'), edgeArea:loc(prog,'uEdgeArea'),
        ray:loc(prog,'uFillRay[0]'), turn:loc(prog,'uFillTurn[0]'), count:loc(prog,'uFillCount') });
      const g = common(shared(VS_FULL, FS_FILL_GROUND)), up = common(shared(VS_FULL, FS_FILL_UP)), b = common(shared(VS_FULL, FS_FILL_BOUNCE));
      Object.assign(g, { sunPath:loc(g.prog,'uFillG'), ground:loc(g.prog,'uGround'), litterOn:loc(g.prog,'uLitterOn'), litter:loc(g.prog,'uLitter'),
        litterOrigin:loc(g.prog,'uLitterOrigin'), litterExtent:loc(g.prog,'uLitterExtent') });
      Object.assign(up, { groundTex:loc(up.prog,'uFillGround'), openGround:loc(up.prog,'uOpenGround'), slab:loc(up.prog,'uSlab'), f0:loc(up.prog,'uF0'), cell:loc(up.prog,'uCell') });
      b.under = loc(b.prog,'uUnder');
      bounceEntry = { g, up, b };
    }
    return bounceEntry;
  } : null;
  // THE LITTER CARPET's bake program (spec/model/season.md): compiled on the first carpet, like the fill's, so a look that never lays litter (every shipped one but the fall looks) pays
  // neither the compile nor the buffer. A program belongs to the context that linked it, so a restore forgets it too. Behind its flag for the same reason as the fill's.
  let litterEntry = null;
  const litterFor = FEAT_LITTER ? () => {
    if(!litterEntry){
      const prog = shared(VS_LITTER, FS_LITTER);
      litterEntry = { prog, U: { origin:loc(prog,'uLitterOrigin'), extent:loc(prog,'uLitterExtent'), minHalf:loc(prog,'uLitterMinHalf'),
        leafTex:loc(prog,'uLeafTex'), leafShape:loc(prog,'uLeafShape'), shapeBox:loc(prog,'uShapeBox'), leafIdFrac:loc(prog,'uLeafIdFrac'), leafRows:loc(prog,'uLeafRows') } };   // the carpet's VS has no packing to read: its uLeafIdFrac is a null, and uploading to a null is a no-op
    }
    return litterEntry;
  } : null;
  // adaptive frame-rate (TUNE spec/implementation.md): offscreen present target + cadence state. presentFBO/presentTex are canvas-sized
  // and allocated lazily on first use (so a look that never enables adaptive_motion pays nothing).
  let presentTex=null, adaptiveDeadline=null, adaptiveElapsed=0, adaptiveRate=0, adaptiveHot=true;
  const ADAPT_HI=0.05, ADAPT_LO=0.02;   // hysteresis on the motion magnitude: above HI render every frame, below LO drop to idle_fps
  // lateral diffusion (spec/model/receivers.md): [0] = transport's LINEAR-HDR frame (the sharp one), [1]/[2] = the separable blur's
  // ping/pong. RGBA16F at the render size, one FBO each (attached once at allocation, so no per-frame re-attach),
  // allocated lazily on first use and reallocated on resize — a look that never opens the gate holds no VRAM.
  const src = { flat:new Float32Array(0), count:0, maxR:1, maxW:1, haloR:0.01,
                coreR:0.005, moonD:0, moonR:0, Lcore:0, Lhalo:0 };   // + the SEEN source (spec/model/sky-view.md sky view): angular radii, the eclipse moon, and the radiance in each region — all filled by regenSource from the sampler's own numbers
  const occ = { rest:[], ht:new Float32Array(0), segBuf:new Float32Array(MAX_OCC*4), count:0, want:0, hRef:1 };   // woody occluder (trunk + main limbs): `rest` segments {ax..py} regrown, `ht` static (heights+radius), `segBuf` refilled per frame with the limb bend, `hRef` = tallest floor height for the drift's height-scale (spec/model/canopy.md)
  const faith = { vao:null, buf:null, count:0, hMin:0, hMax:1, ox:0, oy:0, ext:1,   // FAITHFUL leaf geometry (all leaves, continuous height) + the cast-region frame, computed in bakeFaithful (spec/model/canopy.md)
                  pminx:0, pmaxx:0, pminy:0, pmaxy:0,                                // real plan AABB of leaves+wood (regenCanopy) → cast-frame bound, so a wide grove's outer crown isn't clipped
                  gx:new Float32Array(MAX_SAMPLES), gy:new Float32Array(MAX_SAMPLES),// per-sample ground-shift scratch (hoisted; no per-bake alloc)
                  k:0,                                                               // the beam's neutral depth the cast was last baked with (spec/model/leaf.md): the cast pre-integrates it, so a live leaf_diffuse re-bakes it (refreshFaith)
                  edgeArea:0,                                                        // the edge law the cast was last baked with (spec/model/leaf.md): edge_area is baked into each stamp at k = 0, so flipping it re-casts (refreshFaith)
                  n:0,                                                               // the sample count the cast was last baked over: the cast IS its samples, so a governor step or a resetPerf that re-cuts the cloud re-bakes it (refreshFaith)
                  segVAO:null, segBuf:null, segRest:[], segArr:null, segCount:0 };   // + the woody skeleton (trunk+branches+twigs): rest segments, the per-bake swayed instance array, its VAO
  // SKY VIEW's share of that skeleton (spec/model/sky-view.md): the FINE wood (level > 1) the analytic occluder never carries, sorted
  // into the leaves' own depth layers so a twig and the leaves hanging on it stamp into the SAME texture. Built
  // only when the look-up camera is on; empty otherwise, and the layer bake then draws nothing extra.
  const sky = { segVAO:null, segBuf:null, segRest:[], segArr:null, start:[], count:[], woodOn:false };
  // THE SKY FILL's state (spec/model/fill.md): Tsky and S over the fill's frame, allocated lazily when canopy_fill opens and freed when
  // it shuts. `ready` = the textures hold a bake of what `sig` records, so the receiver may believe them.
  const fill = { tex:[null,null], res:0, ready:false, sig:new Float64Array(FILL_SIG_LEN), K:0, rays:null, ox:0, oy:0, ext:1, bounce:null, gb:0 };   // sig: what the bake was made of, sized by komorebi-bake.js's FILL_SIG_LEN, which fillSig is held to — a slot written past a Float64Array's end is silently dropped, and the fill then re-bakes every frame. ox/oy/ext: the plan square the textures cover (the box, or the padded frame of a finite tree), which every receiver reads them by
  // THE LITTER's state (spec/model/season.md): the carpet texture (a 1×1 until a leaf has fallen and the floor asks), the square it covers, and what it was baked of.
  // komorebi-litter.js owns the shape, so a context restore can put it back to the fresh one in a line.
  const litter = newLitterState();

  // ---- THE SHARED INTERNALS (hub), continued: the stable plumbing and the shared mutable state. The engine's
  // subsystems live in sibling modules (grove, bake, source,
  // motion, transitions, render, editor tools); each is a factory that closes over this one object. Stable
  // plumbing is destructured at a factory's top; everything REASSIGNED at runtime must be read as E.x so
  // every subsystem sees the current value. The factories also hang their public functions on E, which is
  // how cross-subsystem calls resolve without import cycles. ----
  Object.assign(hub, {
    // stable plumbing (never reassigned)
    gl, canvas, fail, MAX_TEX, params, perf, motion, trans, src, occ, faith, sky, fill, litter, U,
    // (the GL handles — programs, buffers, FBOs, occTex, extTimer — and the subsystems over them are set by initGPU())
    effCloud, bakeBaseline, bakeRes, faithfulSamples, faithfulOn, transportFor, transportCamera, fillFor, bounceFor, litterFor, warnCut, sharedProgram: shared, faithLocs,
    // shared mutable state (was create()-closure lets)
    layerTex: [],           // MAX_LAYERS textures (active sized, inactive 1x1)
    woodTex: [],            // SKY VIEW (spec/model/sky-view.md): the layer-stamped fine wood, an R16F per layer beside layerTex — layer size when sky_view is on, 1×1 otherwise (the faithTex idiom)
    layerSize: 0,           // the size the active layer textures were last allocated at (allocLayers) — the faithful path's sky fill resizes them in place
    layerVAO: [],           // per-layer leaf instance VAOs {vao,count,buf}
    faithTex: null,         // FAITHFUL path (spec/model/canopy.md): pre-integrated soft shadow (RGBA16F); 1×1 when faithful_canopy off
    faithScratch: null,     // FAITHFUL path: per-sample transmittance scratch (RGBA16F); 1×1 when off
    hier: null,             // branch hierarchy: limb + twig spring state (built in regenCanopy)
    groveIn: null,          // the INCOMING grove during a crossfade (spec/model/transitions.md): grown early, baked alongside the active one, installed when the window closes
    crossW: 0,              // its coverage share, 0 -> 1 across the window
    grove: null,            // the ACTIVE grove value (hier + layerVAO + its two data textures); the views above point into it
    clusterTex: null,       // per-clump dynamic bend angles (limb, twig), updated each frame
    clusterGeomTex: null,   // per-clump static geometry (clump centre + trunk pivot)
    presentFBO: null, presentW: 0, presentH: 0,   // adaptive frame-rate present target (TUNE spec/implementation.md), allocated lazily
    srcDbgBuf: null, srcDbgVAO: null, vizBuf: null, vizVAO: null,   // editor-only debug-overlay buffers
    timed: (_pass, draw) => draw(),   // profiling hook: the editor swaps in real GPU timer queries (EDITOR)
    motionTick: null,       // the per-frame physics tick; set below, swapped by the editor's motion mirror
    profiler: null,         // the measurement primitive (EDITOR)
    snapshotMotion: null, applyMotion: null, setMotionSource: null,   // motion mirror (EDITOR)
    drawSourceInset: null, drawTreeInset: null, treeInsetHit: null, treeInsetRect: null, treeLeaves: null,   // editor debug overlays (EDITOR)
  });


  function initGPU(){
    // a restored context starts with its extensions off again
    gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_float_blend');
    extTimer = EDITOR ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    progBake = shared(VS_BAKE, FS_BAKE);
    progFaith = shared(VS_FAITH, FS_FAITH);   // FAITHFUL leaf bake (spec/model/canopy.md): per-sample transmittance at continuous heights
    progFaithPivot = shared(VS_FAITH_PIVOT, FS_FAITH);   // ...for a grove with leaves on older wood: the pivot weight (inner_leaves)
    progFaithSeg = shared(VS_FAITH_SEG, FS_FAITH_SEG);   // FAITHFUL skeleton bake (spec/model/canopy.md): trunk+branches+twigs as geometry
    progFAcc = shared(VS_FULL, FS_FACC);      // FAITHFUL accumulate: Σ w_i·transmittance_i
    progBlit = shared(VS_FULL, FS_BLIT);
    progPresent = shared(VS_FULL, FS_PRESENT);                   // adaptive frame-rate: offscreen frame -> screen
    progGlowBlur = shared(VS_FULL, FS_GLOW_BLUR);                // lateral diffusion (spec/model/receivers.md): one axis of the separable spread
    progGlowMix = shared(VS_FULL, FS_GLOW_MIX);                  // lateral diffusion: the sharp/blurred split + the relocated tone-map tail
    progPoints = EDITOR ? shared(VS_POINTS, FS_POINTS) : null;   // editor-only debug-overlay programs
    progViz = EDITOR ? shared(VS_VIZ, FS_VIZ) : null;
    U.bake = { origin:loc(progBake,'uCanopyOrigin'), extent:loc(progBake,'uCanopyExtent'), edge:loc(progBake,'uEdge'),
               morph:loc(progBake,'uMorph'), morphAmount:loc(progBake,'uMorphAmount'), sway:loc(progBake,'uSway'), swayGain:loc(progBake,'uSwayGain'),
               windLevel:loc(progBake,'uWindLevel'), air:loc(progBake,'uAir'), depth:loc(progBake,'uDepth'), windTime:loc(progBake,'uWindTime'),
               leafSwing:loc(progBake,'uLeafSwing'), flutterFreq:loc(progBake,'uFlutterFreq'), stemLen:loc(progBake,'uStemLen'),
               clusterTex:loc(progBake,'uClusterTex'), clusterGeom:loc(progBake,'uClusterGeom'),
               coverage:loc(progBake,'uCoverage'),
               leafTex:loc(progBake,'uLeafTex'), leafShape:loc(progBake,'uLeafShape'), shapeBox:loc(progBake,'uShapeBox'), leafIdFrac:loc(progBake,'uLeafIdFrac'), leafRows:loc(progBake,'uLeafRows') };   // the leaf's outline (komorebi-leaf.js): its texture, the gate, the quad's box and the table's packing — bound per grove
    U.faith = faithLocs(progFaith); U.faithPivot = faithLocs(progFaithPivot);   // (uStemLen removed: faithful dropped the twig-swing that used it)
    U.faithSeg = { origin:loc(progFaithSeg,'uFaithOrigin'), extent:loc(progFaithSeg,'uFaithExtent'), g:loc(progFaithSeg,'uG'), woodTau:loc(progFaithSeg,'uWoodTau'),
                   curtainBake:loc(progFaithSeg,'uCurtainBake'), clothY:loc(progFaithSeg,'uClothY'),
                   segSway:loc(progFaithSeg,'uSegSway'), segTau:loc(progFaithSeg,'uSegTau') };
    U.facc = { tex:loc(progFAcc,'uFAccTex'), weight:loc(progFAcc,'uFAccWeight') };
    U.blit = { tex:loc(progBlit,'uTex') };
    U.present = { tex:loc(progPresent,'uTex') };
    U.glowBlur = { tex:loc(progGlowBlur,'uTex'), step:loc(progGlowBlur,'uStep') };
    U.glowMix = { sharp:loc(progGlowMix,'uSharp'), blur:loc(progGlowMix,'uBlur'), diffuse:loc(progGlowMix,'uDiffuse'),
                  exposure:loc(progGlowMix,'uExposure'), contrast:loc(progGlowMix,'uContrast'), tone:loc(progGlowMix,'uToneMap'),travelTone:loc(progGlowMix,'uTravelTone') };
    if(EDITOR){   // editor-only debug-overlay uniforms
      U.pts = { scale:loc(progPoints,'uScale'), maxW:loc(progPoints,'uMaxW') };
      U.viz = { point:loc(progViz,'uPoint'), pointAlpha:loc(progViz,'uPointAlpha'), lineAlpha:loc(progViz,'uLineAlpha') };
    }

    // ---- geometry / GPU buffers ----
    emptyVAO = gl.createVertexArray();           // required to issue attrib-less draws
    // A driven scene draws its quads from its host's buffer: a grove's vertex arrays read the quad buffer of the engine that uploaded them, and a grove a
    // scene grew is handed to its host at a landing, so that buffer must outlive the scene.
    if(opts.host) quadBuf = opts.host.quadBuf;
    else {
      quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    }

    bakeFBO = gl.createFramebuffer();
    fillFBO = gl.createFramebuffer();    // the sky fill's two-target pass (spec/model/fill.md): the textures are attached when the fill allocates them
    faithFBO = gl.createFramebuffer();   // FAITHFUL scratch target (spec/model/canopy.md): faithScratch attached here once per bake so the per-sample loop swaps FBOs instead of re-attaching (was 2N framebufferTexture2D/frame)

    // ...and the GPU side of that table (spec/model/canopy.md, spec/implementation.md): one RGBA32F, MAX_OCC wide and 2 tall — row 0 the swung plan
    // endpoints, row 1 the static heights + radius. Allocated once at the cap and never resized, because the cap is a
    // compile-time constant on both sides of the wire. This is the clusterTex idiom, for the same reason: a per-frame
    // table that every transport variant reads has no business sitting in the fragment uniform budget.
    occTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, occTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_OCC, 2, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);   // texelFetch ignores filtering, but an unfilterable float texture must still declare NEAREST to be complete
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    Object.assign(hub, { extTimer, progBake, progFaith, progFaithPivot, progFaithSeg, progFAcc, progBlit, progPresent, progGlowBlur, progGlowMix, progPoints, progViz,
                         quadBuf, emptyVAO, bakeFBO, faithFBO, fillFBO, occTex });
    // the subsystems that destructure those handles at their top are rebuilt over the fresh ones (they hold no other state)
    const groveSystem = makeGrove(hub);
    ({ buildGrove, growGrove, uploadGrove, reseasonGrove, reseasonable } = groveSystem); Object.assign(hub,{buildGrove,reseasonGrove});
    hub.refreshWood = groveSystem.refreshWood; hub.faithGL = groveSystem.faithGL;
    const bakeSystem = makeBake(hub);
    ({ bake, refreshFaith } = bakeSystem); Object.assign(hub, bakeSystem);
    Object.assign(hub, FEAT_FILL ? makeFill(hub) : NO_FILL);
    ({ refreshLitter } = FEAT_LITTER ? makeLitter(hub) : NO_LITTER); hub.refreshLitter = refreshLitter;
    Object.assign(hub, FEAT_TREE_VIEW ? makeTreeView(hub) : NO_TREE_VIEW);   // the tree seen from the floor camera: it reads the fill's low-res layers, or keeps them itself   // after the bake: the carpet is read over the fill's frame, and asks the bake module for it
    ({ drawFrameInto, drawTransport, drawTransportPresent, drawDiffusion, freeGlowTargets, drawLayerBlit, glowFBO } = makeRender(hub));
    Object.assign(hub, { drawFrameInto, drawTransport, drawTransportPresent, drawDiffusion, freeGlowTargets, drawLayerBlit });
    if(EDITOR) hub.initEditorGL?.();   // the debug overlays' buffers (absent on the very first call: makeEditorTools runs later and calls it itself)
  }

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
  // THE WOOD'S TEXTURE (spec/model/sky-view.md): one half-float channel, because the wood's optical depth is accumulated additively by the stamp and has to
  // round as it did when it shared the layer texture's alpha. Half float for the same reason as everything here it is blended into;
  // R16F is colour-renderable and linearly filterable with EXT_color_buffer_float, like the RGBA16F beside it.
  function makeWoodTexture(size){
    const t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.R16F,size,size,0,gl.RED,gl.HALF_FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  // the active layers at `size`, the rest 1×1 (an inactive layer is never read). The one place layer textures are made — and the
  // wood's beside them: a sky bake with fine wood grows its own maps to match; otherwise the 1×1 textures keep the samplers complete.
  function allocLayers(size){
    hub.layerTex.forEach(t=>{ gl.deleteTexture(t); });
    hub.woodTex.forEach(t=>{ gl.deleteTexture(t); });
    hub.layerTex = [];
    hub.woodTex = [];
    hub.layerSize = size;
    hub.layerSizes = []; hub.woodSizes = [];
    sky.woodOn = false;
    for(let i=0;i<MAX_LAYERS;i++){
      hub.layerSizes.push(i < params.layer_count ? size : 1);
      hub.woodSizes.push(1);
      hub.layerTex.push(makeLayerTexture(hub.layerSizes[i]));
      hub.woodTex.push(makeWoodTexture(hub.woodSizes[i]));
    }
  }
  // The same sizing for n active layers, replacing only the textures whose size changes: a route between layer counts raises the
  // count at its start without touching the layers on screen (a new texture is empty, so it passes the light whole) and lowers it at landing.
  function sizeLayers(n){
    for(let i=0;i<MAX_LAYERS;i++){
      const size = i < n ? hub.layerSize : 1;
      if(hub.layerSizes[i] !== size){ gl.deleteTexture(hub.layerTex[i]); hub.layerTex[i] = makeLayerTexture(size); hub.layerSizes[i] = size; }
    }
  }
  function sizeWoodLayers(n){
    for(let i=0;i<MAX_LAYERS;i++){
      const size = i < n ? hub.layerSize : 1;
      if(hub.woodSizes[i] !== size){ gl.deleteTexture(hub.woodTex[i]); hub.woodTex[i] = makeWoodTexture(size); hub.woodSizes[i] = size; }
    }
  }
  function rebuildTextures(){
    const res = bakeRes();
    perf.bres = res;                                 // remember the built size; applyQuality reallocates when bakeRes() crosses it
    // faithful mode never bakes or samples the layer textures (transport taps faithTex once), so size them 1×1
    // there too — saves ~layer_count·res²·8 bytes of dead VRAM (≈16 MB at defaults). Reallocated full when faithful off.
    // The one exception is the sky fill (spec/model/fill.md): with canopy_fill open it reads a LOW-RES layer bake on that path too.
    allocLayers(!faithfulOn() ? res : hub.fillWanted() ? hub.fillLayerRes() : hub.treeWanted() ? hub.treeLayerRes() : 1);   // ...and so does the tree view, at the same size
    // FAITHFUL path (spec/model/canopy.md): the soft-shadow accumulator + per-sample scratch. 1×1 when off, so the park / layer
    // path allocates nothing extra; full bake-res when faithful_canopy is on.
    if(hub.faithTex) gl.deleteTexture(hub.faithTex);
    if(hub.faithScratch) gl.deleteTexture(hub.faithScratch);
    const fres = faithfulOn() ? res : 1;
    hub.faithTex = makeLayerTexture(fres);
    hub.faithScratch = makeLayerTexture(fres);
  }

  initGPU();   // programs, buffers, FBOs, occTex + the subsystems over them (makeGrove / makeBake / makeRender)

  // ---- INSTALL a grove as the active one: free whatever it replaces, attach it, then re-point the engine's views at it.
  // hier / layerVAO / clusterTex / clusterGeomTex stay plain engine variables on purpose — some fifty readers
  // across motion, the bake and the debug overlays mean the ACTIVE grove, and rewriting every one of them to
  // say so would be churn without a reader. What the grove VALUE buys is that a second one can exist at all.
  // A grove's state and GL objects move only through attachGrove, detachGrove and freeGrove (komorebi-grove.js, ONE GROVE AT A TIME IS ATTACHED), and the
  // views through setViews; installGrove is where the grove it replaces is freed.
  function freeGrove(g){ if(g) freeGroveGL(gl, g); }
  // The views of a host `h` onto grove `g`, or cleared (g null). hier is kept when cleared: a host whose grove was taken still carries its springs into its regrow.
  function setViews(h, g){
    h.grove = g; if(g) h.hier = g.hier;
    h.layerVAO = g ? g.layerVAO : []; h.clusterTex = g ? g.clusterTex : null; h.clusterGeomTex = g ? g.clusterGeomTex : null;
  }
  function installGrove(g){
    if(hub.grove && hub.grove !== g) freeGrove(hub.grove);
    if(g.host !== hub) attachGrove(hub, g);
    setViews(hub, g);
    publishBend(g);   // push the (preserved or rest) bend into the fresh texture, so a bake right after a regrow isn't a frame snapped to rest
    if(params.wind_air > 0) publishAir(g);   // ...and the air, or the fresh texture's flutter reads still for a frame
  }
  function regenCanopy(){ installGrove(buildGrove(hub.hier)); }   // the old shape: grow one, make it the one
  // THE HANDOVER. A dissolve's outgoing scene is the look on screen, whose grove the host is about to replace: the scene takes it,
  // with its state (the faithful leaves and wood, the analytic wood's table, the sky view's binned wood), instead of growing the same
  // grove again. The host is left with no grove and its hier (setViews), so its rebuild frees nothing of this one.
  function adoptGrove(h){
    const g = h.grove;
    detachGrove(h, g); setViews(h, null);
    installGrove(g);
  }
  // Grow the grove the TARGET look describes, without becoming it (growAs: every key the build reads is the target's, MORPH ones
  // included, for the length of the build). No prevHier — the incoming springs start at rest, which is what a newly grown tree has
  // always done. Its leaf edge is recorded with it: the crossfade's bake cuts the incoming grove's leaves with its own look's edge.
  // It stays detached until installGrove: the grove on screen keeps its state on the hub for the length of the crossfade.
  function buildTargetGrove(to){
    const g = growAs(params, to, () => uploadGrove(growGrove(null)));
    g.edgeSoftness = to.edge_softness;
    return g;
  }




  const { regenSource } = makeSource(hub);
  const { bulkShift, bulkOn, projMatrix, layerHeights } = makeCast(hub);
  Object.assign(hub, { regenSource, bulkShift, bulkOn, projMatrix, layerHeights });

  const targetLooks = new WeakMap();
  hub.resolveTarget = target => {
    if(!session) return resolveParams(target);
    const look=targetLooks.get(target) ?? authoredLook(target);
    const resolved=resolveParams(look,session);
    targetLooks.set(resolved,look);
    return resolved;
  };
  hub.arrived = target => {
    authored=targetLooks.get(target) ?? authoredLook(target);
    playbackNow();settleSession();
  };


  const { tickHierarchy, publishBend, publishAir, uploadAir, motionActive, tick } = makeMotion(hub);
  Object.assign(hub, { tickHierarchy, publishBend, publishAir, uploadAir, motionActive, tick });

  // the engine-resident coordinators the transition route drives (hoisted function declarations)
  Object.assign(hub, { freeGrove, installGrove, regenCanopy, reseason, reweight, buildTargetGrove, rebuildAll, sizeLayers, sizeWoodLayers, resetPerf, applyQuality, allocLayers, makeLayerTexture });
  const { transitionTo, tickTransition, abortTransition, loseContext, restoreContext, endRoutes } = makeTransitions(hub);
  Object.assign(hub, { transitionTo, tickTransition });
  function copyMotion(from,to){
    for(const k in from.motion)to.motion[k]=k==='air'||k==='trunks'?structuredClone(from.motion[k]):Array.isArray(from.motion[k])?[...from.motion[k]]:from.motion[k];   // the air's kept past and the trees' trunks are state: each scene advances its own
    if(from.hier.topoSig===to.hier.topoSig){
      for(const k of ['limbAngle','limbVel','limbPitch','limbPitchVel','twigAngle','twigVel'])to.hier[k].set(from.hier[k].subarray(0,to.hier[k].length));
      to.hier.maxV=from.hier.maxV;
    }
    if(to.params.drift_auto)to.params.drift_phase=from.params.drift_phase;
    to.publishBend(to.grove);
    if(to.params.wind_air > 0) to.publishAir(to.grove);
  }
  // adopt: the scene is this engine's look as it stands, and takes its grove (see adoptGrove); this engine must regrow its own next.
  // host: the scene moves as this engine does from its first bake (copyMotion), so it is baked once.
  const createScene=(look=params, adopt=false)=>createEngine(canvas, { params:{...look}, adopt:adopt?hub:null, host:hub }, true);
  function retainTravelSource(){
    // This route has no wood, fill, litter or glow. Keep its actual grove and cast; share only the stateless GL plumbing.
    const g=hub.grove;
    detachGrove(hub,g);
    const outgoing={...hub,params:{...params},perf:{...perf},trans:restTrans(),
      motion:Object.fromEntries(Object.entries(motion).map(([k,v])=>[k,k==='air'||k==='trunks'?structuredClone(v):Array.isArray(v)?[...v]:v])),   // the air's kept past and the trees' trunks are state: the outgoing scene advances its own
      src:{...src},faith:{...faith},occ:{...occ},sky:{...sky},srcDbgBuf:null};   // the bake's records copied, the grove's state left out: it moves below
    outgoing.faithfulOn=()=>outgoing.params.faithful_canopy;
    outgoing.bakeRes=()=>outgoing.perf.bres;
    outgoing.effCloud=()=>clamp(outgoing.params.cloud_thickness,0,1);
    outgoing.transportCamera=()=>cameraFor(outgoing.params);
    outgoing.fillWanted=()=>false;
    outgoing.refreshFill=outgoing.refreshLitter=outgoing.refreshWood=()=>{};
    Object.assign(outgoing,makeSource(outgoing),makeCast(outgoing),makeMotion(outgoing));
    outgoing.motionTick=outgoing.tick;   // the copied parent tick closes over the incoming scene
    Object.assign(outgoing,makeBake(outgoing));
    Object.assign(outgoing,makeRender(outgoing));
    attachGrove(outgoing,g);
    const release=h=>{
      freeGrove(h.grove);
      for(const t of [...h.layerTex,...h.woodTex,h.faithTex,h.faithScratch])if(t)gl.deleteTexture(t);
    };
    const TEXTURES=['layerTex','woodTex','layerSize','layerSizes','woodSizes','faithTex','faithScratch'];   // the texture set, with the sizes sizeLayers keeps it at
    setViews(hub,null);
    Object.assign(hub,{layerTex:[],woodTex:[],faithTex:null,faithScratch:null});
    let owned=true;
    return {hub:outgoing,
      restore(){
        release(hub);
        detachGrove(outgoing,g);
        Object.assign(faith,outgoing.faith);Object.assign(occ,outgoing.occ);Object.assign(sky,outgoing.sky);   // the bake's records that go with the faithTex put back
        attachGrove(hub,g);setViews(hub,g);
        for(const k of TEXTURES)hub[k]=outgoing[k];
        perf.bres=outgoing.perf.bres;
        copyMotion(outgoing,hub);owned=false;
      },
      dispose(){if(owned){release(outgoing);owned=false;}}
    };
  }
  // The long routes between looks (komorebi-routes.js), each given the scenes it borrows; in the order a lost context or a disposal ends them.
  hub.routes={
    sceneFade:makeSceneFade(hub,createScene),
    leafTravel:makeLeafTravel(hub,retainTravelSource),
    seasonTravel:makeSeasonTravel(hub),
    litterRise:makeLitterRise(hub,(look)=>{
      const source=createScene(look,!look);   // an ascent's source is the look on screen: it takes this engine's grove, which transitionTo regrows as the target right after
      const sourcePerf=source.hub.perf;
      if(sourcePerf.auto!==perf.auto || sourcePerf.quality!==perf.quality){
        sourcePerf.auto=perf.auto;sourcePerf.quality=perf.quality;
        source.hub.applyQuality();source.hub.regenSource();source.hub.bake();
      }
      if(look)source.restore=()=>{
        for(const k in DEFAULTS)params[k]=look[k];
        rebuildTextures();adoptGrove(source.hub);regenSource();copyMotion(source.hub,hub);resetPerf();   // the source grew the landed look's grove: it is handed over, not grown again; the route's landing bakes
      };
      return source;
    }),
    groveTravel:makeGroveTravel(hub,createScene,(scene,look)=>{
      const phase=params.drift_phase;
      for(const k in DEFAULTS)params[k]=look[k];
      if(scene.hub===hub){if(params.drift_auto)params.drift_phase=phase;}
      else{rebuildTextures();adoptGrove(scene.hub);regenSource();copyMotion(scene.hub,hub);}   // the scene grew the landed look's grove: it is handed over, not grown again
      resetPerf();bake();
    }),
  };

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
      samp = faithfulSamples();
    // LAYER MODE, and the two NEW cameras land here by construction: faithfulOn() is false for the enclosure
    // (receiver 2 forces the layer tier) and false for the sky view (no cast frame to pre-bake), so neither can
    // reach the faithful branch above. That is the right branch for both, for the branch's own reason — the cost
    // is per PIXEL, so resolution is the cheapest thing to spend first. What differs is what the second lever
    // buys: the enclosure runs the sample loop, so trimming samples below the knee relieves it exactly as it does
    // the floor; the SKY camera declares no sample loop at all (spec/model/transport.md), so samples are inert there and its
    // below-knee relief comes entirely from bakeRes() shrinking the layer textures it reads. Harmless either way —
    // a lever with no effect costs nothing — and the seen source is derived analytically, not from the sample
    // sums, so trimming them cannot shift the sun the sky camera is looking at.
    } else if(q >= KNEE){ res = lerp(RES_MIN, 1, (q-KNEE)/(1-KNEE)); samp = params.sample_count; }   // resolution first (on the floor and the enclosure the per-pixel transport sample loop IS the cost)
    else                { res = RES_MIN; samp = Math.round(lerp(SAMP_MIN, params.sample_count, q/KNEE)); } // then samples (and bake, below)
    perf.resScale = res;
    samp = clamp(samp, session?Math.min(3,params.sample_count):3, session?params.sample_count:Math.max(3, params.sample_count));
    if(samp !== perf.sampleCount){ perf.sampleCount = samp; regenSource(); }
    if(bakeRes() !== perf.bres){ rebuildTextures(); bake(); }     // bake_resolution trims with quality below the knee (spec/implementation.md); realloc only at a snapped boundary
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

  if(EDITOR && !driven) makeEditorTools(hub);   // debug overlays + profiler + motion mirror; EDITOR=false strips the call (and its module with it)

  // ---- the rebuild scopes the editor drives, plus a full param swap ----
  // The cloud is cut BEFORE the bake: the faithful cast pre-integrates its soft shadow over the source's samples (spec/model/canopy.md), so a bake made first casts
  // against whatever cloud came before — empty on a born engine (a dark frame), the previous look's after setParams — and with still air nothing re-bakes it.
  // regenSource reads only params, perf and the transition's bloom; nothing the textures or the grove set up.
  // Given a look, the grove is grown from that look's value of every key it reads and the live params are put straight back: a
  // route's hidden midpoint grows the grove it lands on while the MORPH keys the grove also reads (the view extent sizes a park
  // crown) are still tweening for the picture. Wood radius and heights stay live: the bake's refreshWood re-reads them.
  function rebuildAll(look){ rebuild(look); bake(); }
  // ...and without its bake, for a caller whose next step moves the motion and bakes: a bake before that is never shown.
  function rebuild(look){
    rebuildTextures();
    if(look) growAs(params, look, regenCanopy); else regenCanopy();
    regenSource();
  }
  function resetPerf(){ restPerf(); applyQuality(); }
  // The governor's state at rest, without acting on it: a caller about to rebuild sets it first, so the rebuild sizes the textures and bakes at the quality
  // the reset lands on, and the applyQuality after it finds the textures already that size (only the sample count, which the rebuild's cloud was cut at, is left to it).
  function restPerf(){ perf.auto=!!params.auto_quality; perf.quality=1; perf.acc=0; perf.lowCount=0; perf.hiCount=0; perf.upWait=20; }
  // A whole new look, at the governor's rest: one texture set and one bake, with the cloud cut at the rested sample count before that bake.
  function rebuildRested(){ restPerf(); rebuild(); applyQuality(); bake(); }
  // The season axis (spec/model/season.md "Re-seasoning"): a change to the season set alone is re-run over the grove's cached leaves; anything else the grove reads, or a grove the cache
  // does not describe, regrows (with the cache once the structure holds still, so the NEXT one is the fast one). Only a season-only grove morph may re-season during a
  // transition: the fast path is held to the build's bytes at rest and on that morph alone, and the other routes repurpose the grove they hold. The carpet's signature keys on the grove's identity plus phenology and the litter keys, NOT the capacities, so an anthocyanin-only
  // re-season would leave it stale: dropping the grove it was baked from makes the next refreshLitter bake it.
  // Returns the path it took, 'reseason' or 'build': the editor's cost gate must not fold a one-off cache build into its EMA.
  function reseason(){
    let path = 'reseason';
    if(!hub.groveIn && (!trans.active || trans.canopyMorph && trans.seasonMorph) && reseasonable(hub.grove)){
      reseasonGrove(hub.grove, params); litter.grove = null;
      if(trans.active){
        publishBend(hub.grove);   // the tween may have moved sway_pitch after the wind tick published its bend
        hub.hier.maxV = 0;        // a morph regrow clears this activity hint; keep the same idle decision
      }
    }
    else {
      // The record is kept only when the structure being grown is the one the grove on screen was grown for (grove.key): on the season slider's spring half every tick moves structure, so every
      // tick would build a record (~5 ms, ~7 MB on afternoon 7) that the next one throws away, and the cost would enter the editor's tween gate as well. Leaving that half costs one extra
      // full build: the last tick that moved the structure builds without a record, the next builds with it, and the one after is the fast path.
      installGrove(buildGrove(hub.hier, { keepSeason: hub.grove?.key === seasonKey(params, faithfulOn()) })); path = 'build';
    }
    return path;
  }
  // A fixed summer grove retains the largest requested per-cluster prefix; editor edits can expand it, reversals can reuse it.
  function reweight(capacity = params.foliage_density){
    if(hub.groveIn || trans.active && !(trans.canopyMorph && trans.densityMorph) || !densityEligible(params)){
      regenCanopy(); return 'build';
    }
    const S = hub.grove?.season;
    let path = 'reseason';
    if(S?.density && reseasonable(hub.grove) && densityCount(params, capacity) <= S.nLeaf) reseasonGrove(hub.grove, params);
    else { installGrove(buildGrove(hub.hier, { densityCapacity: capacity })); path = 'build'; }
    litter.grove = null;
    publishBend(hub.grove); hub.hier.maxV = 0;   // the editor's canopy apply also republished bends and replaced this activity hint
    return path;
  }
  // Will the next frame bake before it draws? Only a running loop with the canopy moving and no transition (frame(): a transition's route owns the bake, and an
  // adaptive frame that is not due re-presents the last picture, which no bake here would change). Otherwise an apply must bake for itself.
  const frameBakes = () => !driven && alive && !paused && !lost && !trans.active && motionActive();
  function apply(scope){
    holdReach();
    if(session && !trans.active)captureLook();
    if(lost) return;                                  // see setParams
    if(scope==='source') regenSource();
    else if(scope==='bake') bake();                  // drift moves leaves at bake time only
    else if(scope==='canopy'){ regenCanopy(); bake(); }
    else if(scope==='season'){ const path = reseason(); if(!frameBakes()) bake(); return path; }   // a season step runs many times a second: the frame that shows it bakes anyway when the canopy moves
    else if(scope==='density'){ const path = reweight(); bake(); return path; }
    else if(scope==='textures'){ rebuildTextures(); regenCanopy(); bake(); }
    else if(scope==='perf') resetPerf();
  }
  function setParams(obj){
    if(!obj || typeof obj!=='object') return;
    const nextAuthored=authoredLook(obj),nextParams=resolveParams(obj,session);
    authored=nextAuthored;obj=nextParams;
    pendingSession=false;
    // an in-flight transition must not outlive the swap: its morph would keep writing params over the new
    // look, and mid-CROSSFADE the incoming grove would keep baking against layer state rebuildAll is about
    // to replace (the observed crash: bake reading a dangling grove's VAOs). Abort it cleanly first —
    // transitionTo already does this for its own interruptions; a hard param swap deserves the same.
    // The whole transition state returns to rest with it (abortTransition), the bloom included: effCloud and regenSource read
    // it whether or not a transition runs, so a mid-route value would swell the new look's cloud and halo (softer dapples, a
    // wrong source). Done here, ahead of the `lost` return, because onContextRestored lands only a transition still active.
    abortTransition();
    if(lost){ const m = Object.assign(params, DEFAULTS, migrateLegacy(obj)); warnCut(m); return; }   // no GPU to rebuild on: the live params are what onContextRestored() rebuilds from
    const merged = Object.assign({}, DEFAULTS, migrateLegacy(obj));   // legacy names -> current; missing keys -> defaults (forward-compat)
    warnCut(merged);
    for(const k in DEFAULTS) params[k] = merged[k];
    rebuildRested();                                   // a preset may carry auto-quality
  }

  hub.motionTick = tick;   // default: this engine runs its own physics. EDITOR can swap it to mirror another instance.

  // ---- init + frame loop ----
  if(opts.host){   // a driven scene: its host's motion copied before the one bake, which a born engine's quality reset would precede
    rebuildTextures(); if(opts.adopt) adoptGrove(opts.adopt); else regenCanopy(); regenSource();
    resetPerf(); copyMotion(opts.host, hub); bake();
  }
  else { rebuildAll(); resetPerf(); }
  let last=performance.now(), fps=60, paused=false, alive=true, lost=false;
  // The journey bypasses the cached present frame; refresh it at the landing clock even in still air.
  hub.resumeAdaptive=()=>{adaptiveDeadline=null;adaptiveElapsed=0;adaptiveHot=true;};
  // THE LOOP. `loop` is a generation: every start/stop bumps it, so a callback already queued with rAF by an
  // older loop is dropped when it fires — pause+resume, or a loss+restore inside one frame, can never leave two
  // loops running.
  let loop = 0;
  const schedule = () => { const id = loop; requestAnimationFrame(now => { if(id === loop) frame(now); }); };
  const startLoop = () => { loop++; last = performance.now(); hub.resumeAdaptive(); schedule(); };
  const eng = { canvas, gl, params, perf, motion, src, trans, occ, fps:60, apply, setParams, onFrame:opts.onFrame||null,
    get authored(){ return session ? { ...authored } : { ...params }; },
    get session(){ return session; },
    captureLook,
    setLookRequest(key,value,scope){
      if(!FIDELITY_KEYS.includes(key)) throw new Error(`Not a fidelity request: ${key}`);
      const look=readLook();
      if(value===undefined) delete look[key]; else look[key]=value;
      // With a rebuild scope the request lands in place, as any other knob does through apply(); without one, or mid-route, it swaps the whole look.
      if(scope===undefined || trans.active) return setParams(look);
      const next=resolveParams(look,session);
      if(session) authored=authoredLook(look);
      for(const k of FIDELITY_KEYS) params[k]=next[k];
      return apply(scope);
    },
    setSession(settings,environment){
      const nextEnvironment=environment===undefined?sessionEnvironment:{...sessionEnvironment,...environment,maxTextureSize:MAX_TEX};
      const nextSession=resolveSession(settings,nextEnvironment);
      if(!session?.automaticAdaptive || !nextSession.automaticAdaptive){
        fpsProbe=nextSession.automaticAdaptive?makeFpsProbe():null;startupFps=null;
      }
      sessionEnvironment=nextEnvironment;session=nextSession;
      applyStartupFps();
      if(!trans.active)captureLook();
      pendingSession=true;playbackNow();settleSession();if(!lost)resetPerf();
    },
    transitionTo: (target, o) => {
      if(!target || typeof target!=='object') return;
      if(lost){setParams(target);o?.onEnd?.();return;}
      return transitionTo(target,o);
    },   // nothing to animate on a lost context: land on the target
    // pause the rAF loop so a second engine instance idles at zero GPU when off-screen (the editor's A/B picker)
    setPaused(on){ on=!!on; if(on===paused) return; paused=on; loop++; if(!on && !lost) startLoop(); },   // a loss in progress leaves the restart to the restore
    // dispose: stop the loop and free EVERY GL object + the context, so a disposable second instance (the A/B
    // picker, created per-comparison) leaves zero GPU residue when closed. A disposed engine must not be reused.
    dispose(){
      alive = false; loop++;
      endRoutes();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      ownerDocument?.removeEventListener('visibilitychange',onVisibilityChange);
      releasePrograms();                             // initGPU's, every camera this engine visited, the fill's and the litter's: deleted once no engine on the context holds them
      transportCache.clear(); fillEntry = null; bounceEntry = null; litterEntry = null;
      freeGrove(hub.grove); freeGrove(hub.groveIn);   // the grove on screen and a crossfade's incoming one
      hub.layerTex.forEach(t => { gl.deleteTexture(t); });
      hub.woodTex.forEach(t => { gl.deleteTexture(t); });
      [occTex, hub.faithTex, hub.faithScratch, presentTex, litter.tex, ...fill.tex].forEach(t => { if(t) gl.deleteTexture(t); });
      if(fill.bounce){ gl.deleteFramebuffer(fill.bounce.fbo); [fill.bounce.G, fill.bounce.W, fill.bounce.B, fill.bounce.slab].forEach(t => { gl.deleteTexture(t); }); fill.bounce = null; }
      freeGlowTargets();                             // the diffusion tier's three 16F frames (no-op when the gate never opened)
      [bakeFBO, faithFBO, fillFBO, hub.presentFBO, ...glowFBO].forEach(f => { if(f) gl.deleteFramebuffer(f); });
      hub.disposeTree();                              // the tree view's targets and its leaf table
      if(litter.vao){ gl.deleteVertexArray(litter.vao); gl.deleteBuffer(litter.buf); }
      [emptyVAO, hub.srcDbgVAO, hub.vizVAO].forEach(v => { if(v) gl.deleteVertexArray(v); });
      [opts.host ? null : quadBuf, hub.srcDbgBuf, hub.vizBuf].forEach(b => { if(b) gl.deleteBuffer(b); });   // a scene's quad buffer is its host's
      if(EDITOR && !driven) hub.setMotionSource(null);              // drop any mirror-source ref so a disposed follower can't pin its source
      if(!driven) gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    ...(EDITOR ? { fill, litter, faith, layers: () => hub.layerTex, woods: () => hub.woodTex,   // the sky fill's state + the layers it reads (and the sky view's wood beside them), for the pixel harness's shader-vs-reference checks (test-gl/); stripped from the player build
                   drawSourceInset: hub.drawSourceInset, drawTreeInset: hub.drawTreeInset, treeInsetHit: hub.treeInsetHit, treeInsetRect: () => hub.treeInsetRect(), treeLeaves: () => hub.treeLeaves(), profiler: hub.profiler, snapshotMotion: hub.snapshotMotion, applyMotion: hub.applyMotion, setMotionSource: hub.setMotionSource,
                   isLowMotion: () => motionMagnitude() < ADAPT_LO,
                   grove: () => hub.grove } : {}) };   // editor-only handles, stripped from the player build (grove: the one on screen: the held leaf walks its hier; reseason.test.js reads its season record)
  // ---- adaptive frame-rate helpers (TUNE spec/implementation.md) ----
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
    const rate = Math.max(1, params.adaptive_idle_fps), period = 1000/rate;
    const m = motionMagnitude();
    if(adaptiveHot){ if(m < ADAPT_LO) adaptiveHot=false; }
    else if(m > ADAPT_HI) adaptiveHot=true;
    if(adaptiveHot || adaptiveDeadline===null || adaptiveRate!==rate){
      adaptiveRate=rate;
      adaptiveDeadline=now+period;
      return true;
    }
    // A display frame may land a fraction late. Keep that time against the next deadline, and skip missed deadlines after a stall.
    const late = now-adaptiveDeadline+0.001;   // one microsecond of tolerance at a nominal display tick
    if(late<0) return false;
    adaptiveDeadline += (1+Math.floor(late/period))*period;
    return true;
  }
  function frame(now){
    if(!alive || paused || lost) return;             // dispose() halts permanently; setPaused(true) / a lost context halt until resumed
    const dtms=now-last; last=now; fps += ((1000/Math.max(dtms,1))-fps)*0.1; eng.fps=fps;
    if(ownerDocument?.hidden)skipFpsInterval=true;
    else if(skipFpsInterval)skipFpsInterval=false;
    else if(fpsProbe && !startupFps){
      startupFps=fpsProbe.observe(dtms);
      if(startupFps){applyStartupFps();playbackNow();}
    }
    if(perf.auto) tunePerf(dtms, fps);               // auto-quality: nudge resolution/samples toward 60 fps
    resize();
    // adaptive frame-rate (opt-in): only off-transition, non-debug. While motion is low, render the heavy passes
    // at adaptive_idle_fps into presentTex and re-present it the rest of the time; off -> the unchanged path below.
    if(params.adaptive_motion && !trans.active && !params.show_layer){
      adaptiveElapsed += clamp(dtms/1000, 0, MAX_MOTION_STEP);
      if(!adaptiveDue(now)){                          // skip: re-present the last rendered frame (byte-identical), no bake/transport
        presentFrame();
        schedule();                                   // BEFORE onFrame: a throwing host callback must not end the animation (its error still surfaces)
        if(eng.onFrame) eng.onFrame(dtms);
        return;
      }
      if(motionActive()){
        // Each display interval is already capped for stalls. Integrate the accumulated time in steps the springs can take.
        while(adaptiveElapsed>MAX_MOTION_STEP){hub.motionTick(MAX_MOTION_STEP);adaptiveElapsed-=MAX_MOTION_STEP;}
        hub.motionTick(adaptiveElapsed);
        hub.timed('bake', bake);
      }
      adaptiveElapsed=0;
      ensureFrameTarget();
      hub.timed('transport', drawTransportPresent);       // heavy transport (+ the diffusion passes, if the gate is open) -> offscreen
      presentFrame();                                 // offscreen -> screen
      schedule();
      if(eng.onFrame) eng.onFrame(dtms);
      return;
    }
    if(adaptiveDeadline!==null) hub.resumeAdaptive();
    const dt = dtms/1000;
    let landed = null;                               // the route's onEnd, when it lands this frame
    if(trans.active){                                // a running transition owns the re-source/re-bake each frame
      if(!trans.route?.ownsWind&&motionActive()) tick(dt); // a route that owns the wind (the grove journey's two native states) advances it itself
      if(trans.route?.hostBakes && motionActive()) bake();
      landed = tickTransition(dt);
    } else if(motionActive()){ hub.motionTick(dt); hub.timed('bake', bake); }   // advance (or mirror a source) + re-bake only when moving
    if(trans.route) hub.timed('transport',trans.route.draw);
    else if(params.show_layer && !faithfulOn()){ refreshFaith(); drawLayerBlit(); } else hub.timed('transport', drawTransport);   // show_layer is a no-op in faithful mode (the layer textures aren't baked)
    schedule();
    if(landed) landed();                             // after schedule(), like onFrame: a throwing host callback must not end the animation
    if(eng.onFrame) eng.onFrame(dtms);               // editor draws HUD + source inset here
  }

  // ---- CONTEXT LOSS (automatic recovery). preventDefault on the loss is what lets the browser restore at all.
  // On restore every handle from before is dead: initGPU() recreates the eager ones, the lazy ones are forgotten below (and made
  // again on first use), and the ordinary rebuild path
  // regrows the grove/bake/source from the CURRENT params (the springs in hub.hier survive: they are CPU state).
  function onContextLost(e){
    if(!alive) return;
    e.preventDefault();
    lost = true; loop++;                               // stop the loop; setParams/apply only touch params until the restore
    loseContext();
  }
  function onContextRestored(){
    if(!alive) return;
    transportCache.clear(); presentTex = null;         // dead handles: forgotten, never deleted
    contextPrograms(gl).clear(); held.clear();     // every program the context held died with it, whichever engine linked it
    fillEntry = null; bounceEntry = null; fill.tex = [null, null]; fill.res = 0; fill.ready = false; fill.bounce = null; fill.gb = 0;   // the sky fill's programs and textures died with the context; the first draw that wants it rebuilds them
    litterEntry = null; Object.assign(litter, newLitterState());                   // ...and so did the carpet's: initGPU() makes the fresh 1×1, and the first draw that has fallen leaves to show bakes it again
    detachGrove(hub, attachedGrove(hub)); setViews(hub, null);   // the grove's handles go with it, unfreed
    Object.assign(hub, { layerTex:[], woodTex:[], layerSize:0, faithTex:null, faithScratch:null, groveIn:null, crossW:0,
                         presentFBO:null, presentW:0, presentH:0 });
    initGPU();
    // a transition's crossfade grove died with the context: land the route on its target rather than resume half-faded
    const cb = restoreContext();
    playbackNow();settleSession();
    lost = false;  // settle the target's session before rebuilding its GL resources
    rebuildRested();
    if(!paused) startLoop();                           // exactly one loop; a paused engine waits for setPaused(false)
    if(cb) cb();                                       // after the restart: a throwing onEnd must not leave a restored engine with no loop
  }
  if(driven) return { hub, draw:drawFrameInto, dispose:eng.dispose,
    step(dt){ if(motionActive()){ tick(dt); bake(); } } };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  ownerDocument?.addEventListener('visibilitychange',onVisibilityChange);
  startLoop();
  return eng;
}

export { create };
