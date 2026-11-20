// ============================================================================
// The tree seen from the floor camera (spec model/camera.md, "The tree seen from the floor camera"; model/leaf.md, "A leaf, seen"). On a standing scene cast
// faithfully, the tilted floor camera sees the leaves and wood the shadow is cast from: the faithful cast's own leaf records, stood back up by the same
// vertex code that casts them (VS_TREE is GLSL_FAITH_VERTEX with its TREE_VIEW stage), and its own swayed wood, drawn after the floor in the floor camera's
// perspective. A leaf is lit as a receiver, by the sun through the leaves above it and by the sky above it, read from the low-res layer set the sky fill
// bakes on the faithful path; it is one finite two-faced leaf that passes the look's own transmittance (the slab, komorebi-leaf.js). The pass draws into its own
// multisampled colour and depth, its leaves' outlines turned into sample coverage, and is laid over the frame: every step the floor takes after its light
// (the dusk shift, the haze, the iris, the Look's tail) is per pixel, so the tree takes the same steps in its own shader, the tail's curve its own (tree_tone).
// Pure exports first (the projection the shader runs), then the GL factory, which the engine holds behind FEAT_TREE_VIEW.
// ============================================================================
import { DEG, clamp, smoothstep } from '../komorebi-math.js';
import { atmosphere, beamLoss, shownExposure, skyModel, sunDirection } from '../light/komorebi-light.js';
import { ballisticK, bindLeafShape, SLAB_N, slabClear, slabTable } from '../leaf/komorebi-leaf.js';
import { cameraPose, lookUp } from './komorebi-camera.js';
import { MAX_LAYERS } from '../komorebi-params.js';
import { VS_TREE, FS_TREE, VS_TREE_WOOD, VS_TREE_WOOD_FOOT, FS_TREE_WOOD, FS_CROWN_GRID, FS_TREE_COMPOSITE, VS_FULL, defineIn } from './komorebi-shaders.js';
import { cameraFor } from './komorebi-transport.js';

// ---- THE FLOOR CAMERA RUN FORWARDS: GLSL_TREE_CAMERA's treeClip, on the CPU, for the tests. Returns normalised device x, y and the depth along the gaze in
// eye heights; a point on the floor lands where the floor camera's own ray from that pixel meets the floor. ----
export function treeProject(p, aspect, P){
  const pitch = clamp(p.view_pitch_deg, 0, 80)*DEG, fov = clamp(p.view_fov_deg, 5, 140)*DEG, yaw = p.view_yaw_deg*DEG;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), kf = Math.max(Math.tan(0.5*fov), 1e-4);
  const cg = Math.cos(pitch + lookUp(p)), sg = Math.sin(pitch + lookUp(p));   // the gaze: the tilt plus the look up; the eye keeps the tilt's
  const scale = p.view_extent_m*cp*cp/Math.max(2*kf, 1e-4), targetY = sp/Math.max(cp, 1e-4);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), dx = P[0] - p.view_center_x, dy = P[1] - p.view_center_y;
  const qx = cy*dx - sy*dy, qy = sy*dx + cy*dy;
  const v = [qx/scale, qy/scale + targetY, P[2]/scale - 1];
  const depth = v[1]*sg - v[2]*cg, up = v[1]*cg + v[2]*sg;
  return [v[0]/(kf*aspect)/depth, up/kf/depth, depth];
}
// The plan point the floor camera's ray through normalised device (x, y) meets the floor at: GLSL_T_FLOOR_CAMERA, for the same tests.
export function floorRay(p, aspect, x, y){
  const pitch = clamp(p.view_pitch_deg, 0, 80)*DEG, fov = clamp(p.view_fov_deg, 5, 140)*DEG, yaw = p.view_yaw_deg*DEG;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), kf = Math.max(Math.tan(0.5*fov), 1e-4);
  const cg = Math.cos(pitch + lookUp(p)), sg = Math.sin(pitch + lookUp(p));
  const sxc = x/2*aspect, tyc = y/2;
  const d = [2*kf*sxc, 2*kf*tyc*cg + sg, 2*kf*tyc*sg - cg];
  if(d[2] >= -1e-4) return null;
  const scale = p.view_extent_m*cp*cp/Math.max(2*kf, 1e-4), targetY = sp/Math.max(cp, 1e-4), lam = -1/d[2];
  let w = [scale*lam*d[0], scale*(lam*d[1] - targetY)];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  if(yaw !== 0) w = [cy*w[0] + sy*w[1], -sy*w[0] + cy*w[1]];
  return [w[0] + p.view_center_x, w[1] + p.view_center_y];
}

// The tree's programs, named only behind the flag: a bundle that cut the tier (embed-build.mjs) removes this branch as text, and with it the last reference to the
// shaders, which its orphan sweep then deletes (a minifier will not drop a template that interpolates).
const FEAT_TREE_VIEW = true;
const treeShaders = FEAT_TREE_VIEW ? () => ({ leaf: [VS_TREE, FS_TREE], wood: [VS_TREE_WOOD, FS_TREE_WOOD], woodFoot: [VS_TREE_WOOD_FOOT, FS_TREE_WOOD], grid: [VS_FULL, FS_CROWN_GRID], comp: [VS_FULL, FS_TREE_COMPOSITE] }) : null;
// The names a leaf's or the wood's fragment stage is compiled with, each its own program so a tree without it runs the shaders it always ran: the crown's
// own light read from its grid (crown_light), and the far tree fading into the seen sky (view_sky), as the floor beside it does.
export const treeNames = (params) => [(params.crown_light || 0) > 0 ? 'CROWN_FIELD' : '', params.view_sky ? 'VIEW_SKY' : ''].filter(Boolean);

// THE CROWN'S GRID (crown_light, spec/model/leaf.md): the crown's own light changes over a metre and not within a leaf, so it is gathered once a frame at the
// centres of cells this size over the layers' box, from the floor to the highest leaf, and every leaf and the wood read it between the eight cells about them.
const CROWN_CELL = 0.5;
export const crownGridSize = (extent, top) => [clamp(Math.ceil(extent/CROWN_CELL), 8, 64), clamp(Math.ceil(Math.max(top, 1e-3)/CROWN_CELL), 2, 48)];

// The low-res layer set the tree is lit by: the sky fill's own size (komorebi-bake.js fillLayerRes), so with both open they are one set.
export const treeLayerRes = (params, bakeRes) => Math.min(clamp(params.fill_resolution|0, 32, 1024), bakeRes());

// ============================================================================
// The GL half.
// ============================================================================
export function makeTreeView(hub){
  const { gl, canvas, params, motion, faith, trans, emptyVAO, faithfulOn, bakeRes } = hub;
  let progComp = null, progGrid = null, UC = null, UG = null, slabTex = null, slabTexNeutral = null, gridTex = null, gridFBO = null, gridN = [0, 0], _skyKey = '', _sky = null;
  const progs = new Map();   // the leaf's and the wood's programs, by base and names (treeNames), made on first use
  const gridBox = [0, 0, 0, 1, 1, 1];
  let msFBO = null, msCol = null, msCover = null, msDepth = null, rsFBO = null, rsCol = null, rsCover = null, tw = 0, th = 0;
  const _atm = { sun: [0, 0, 0], ambient: [0, 0, 0] }, _sd = [0, 0, 0];

  // Wanted: the look opens it, its tree stands in the scene and is cast faithfully, the floor camera is the one drawing, and no route owns the cast this frame
  // (the season's, the leaves' and the litter's travels draw their own leaves, and the viewpoint route moves the camera: the tree comes and goes under the fade).
  // The one exception is a tree fading across the season travel: it is drawn from the cast's records on their twigs, turning with them, while it fades.
  const fadingOverSeason = () => trans.treeFade && trans.route?.name === 'seasonTravel';
  const hasLeaves = () => faith.count > 0 && !!(faith.sideBuf || faith.rec);   // the record: a layered grove asked before the regrow that makes it faithful (rebuildTextures sizes the layers first)
  const hasWood = () => params.branch_tau > 0 && faith.segCount > 0 && !!faith.segVAO;
  const wanted = () => !!params.tree_view && !!params.standing_scene && faithfulOn() && cameraFor(params) === 'floor' && (hasLeaves() || hasWood())
    && !(trans.active && (trans.castHeld || trans.travelField || trans.riseField || trans.viewpoint) && !fadingOverSeason());

  const L = (prog, n) => gl.getUniformLocation(prog, n);
  const common = (prog) => ({
    viewExtent: L(prog, 'uViewExtent'), pitch: L(prog, 'uPitch'), lookUp: L(prog, 'uLookUp'), fov: L(prog, 'uFov'), aspect: L(prog, 'uAspect'), yaw: L(prog, 'uViewYaw'), center: L(prog, 'uViewCenter'),
    layers: Array.from({ length: MAX_LAYERS }, (_, i) => L(prog, `uLayer[${i}]`)), heights: L(prog, 'uLayerHeight[0]'), layerCount: L(prog, 'uLayerCount'), layerHalf: L(prog, 'uLayerHalf'),
    layerOrigin: L(prog, 'uLayerOrigin'), layerExtent: L(prog, 'uLayerExtent'), sunG: L(prog, 'uSunG'), beamK: L(prog, 'uBeamK'), leafSun: L(prog, 'uLeafSun'), sunCosine: L(prog, 'uSunCosine'),
    sunDir: L(prog, 'uSunDir'), ambient: L(prog, 'uAmbient'), eye: L(prog, 'uEye'), neutral: L(prog, 'uNeutral'), clearK: L(prog, 'uClearK'), crownP: L(prog, 'uCrownP'), openSky: L(prog, 'uOpenSky'), beamMarch: L(prog, 'uBeamMarch'),
    twilight: L(prog, 'uTwilight'), mesopic: L(prog, 'uMesopic'), haze: L(prog, 'uHazeColor'), halfExtent: L(prog, 'uHalfExtent'), centerF: L(prog, 'uViewCenterF'),
    vignette: L(prog, 'uVignette'), vignetteShape: L(prog, 'uVignetteShape'), irisOpacity: L(prog, 'uIrisOpacity'), target: L(prog, 'uTarget'),
    exposure: L(prog, 'uExposure'), contrast: L(prog, 'uContrast'), tone: L(prog, 'uToneMap'), travelTone: L(prog, 'uTravelTone'), treeTone: L(prog, 'uTreeTone'),
    crownGrid: L(prog, 'uCrownGrid'), crownOrigin: L(prog, 'uCrownOrigin'), crownSize: L(prog, 'uCrownSize'),
    skySunDir: L(prog, 'uSkySunDir'), skyR: L(prog, 'uSkyR'), skyA: L(prog, 'uSkyA'), skyO: L(prog, 'uSkyO'), skyIso: L(prog, 'uSkyIso'), skyMs: L(prog, 'uSkyMs'), skyScale: L(prog, 'uSkyScale'),
  });
  const locs = {
    leaf: (prog) => ({ ...common(prog), ...hub.faithLocs(prog), slab: L(prog, 'uSlab'), f0: L(prog, 'uF0') }),
    wood: (prog) => ({ ...common(prog), eyeW: L(prog, 'uEyeW'), bark: L(prog, 'uBark'), woodPx: L(prog, 'uWoodPx'), groundClip: L(prog, 'uGroundClip'), footCount: L(prog, 'uFootCount'), foot: L(prog, 'uFoot[0]'), barkTex: L(prog, 'uBarkTex'), roundEnds: L(prog, 'uRoundEnds') }),
  };
  function program(kind, names){   // kind: leaf, wood or woodFoot
    const key = `${kind}|${names.join(' ')}`;
    let p = progs.get(key);
    if(!p){
      const [vs, fs] = treeShaders()[kind], prog = hub.sharedProgram(vs, defineIn(fs, names));
      p = { prog, u: locs[kind === 'leaf' ? 'leaf' : 'wood'](prog) };
      progs.set(key, p);
    }
    return p;
  }

  function compile(){
    if(progComp) return;
    const P = hub.sharedProgram, sh = treeShaders();
    progComp = P(...sh.comp); progGrid = P(...sh.grid);
    UG = { ...common(progGrid), crownN: L(progGrid, 'uCrownN'), slice: L(progGrid, 'uCrownSlice') };
    UC = { col: L(progComp, 'uTreeCol'), cover: L(progComp, 'uTreeCover'), opacity: L(progComp, 'uTreeOpacity') };
    // the leaf's two materials (leaf_neutral): the green fit and the tissue, both made once and chosen per draw
    const table = (neutral) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SLAB_N, 3, 0, gl.RGBA, gl.FLOAT, slabTable(SLAB_N, neutral));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    slabTex = table(false); slabTexNeutral = table(true);
  }

  // The targets: four samples of colour, coverage and depth, resolved into two plain textures the composite reads.
  function targets(w, h){
    if(tw === w && th === h) return !!msFBO;
    free();
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    const rb = (fmt) => { const r = gl.createRenderbuffer(); if(!r) return null;
      gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); return r; };
    msCol = rb(gl.RGBA8); msCover = rb(gl.RGBA8); msDepth = rb(gl.DEPTH_COMPONENT24);
    msFBO = gl.createFramebuffer();
    if(!msFBO || !msCol || !msCover || !msDepth) return abandonTargets(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFBO);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msCol);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, msCover);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return abandonTargets(w, h);
    const tex = () => { const t = gl.createTexture(); if(!t) return null;
      gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    rsCol = tex(); rsCover = tex();
    rsFBO = gl.createFramebuffer();
    if(!rsFBO || !rsCol || !rsCover) return abandonTargets(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rsFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rsCol, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, rsCover, 0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return abandonTargets(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    tw = w; th = h;
    return true;
  }
  function abandonTargets(w, h){
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    free();
    tw = w; th = h;   // retry after resize or when the tree view is opened again
    return false;
  }
  function free(){
    for(const f of [msFBO, rsFBO]) if(f) gl.deleteFramebuffer(f);
    for(const r of [msCol, msCover, msDepth]) if(r) gl.deleteRenderbuffer(r);
    for(const t of [rsCol, rsCover]) if(t) gl.deleteTexture(t);
    msFBO = rsFBO = msCol = msCover = msDepth = rsCol = rsCover = null; tw = th = 0;
  }

  // Fill refreshes the shared layers before transport when it is open.
  function ensureLayers(){
    if(!hub.fillWanted()) hub.ensureLightingLayers(treeLayerRes(params, bakeRes));
  }
  function bakeLayers(){
    if(hub.fillWanted() || !wanted()) return;
    hub.ensureLightingLayers(treeLayerRes(params, bakeRes), true);
  }

  // The crown's grid, this frame's: a slice at a time, each pixel a cell, after the layers it reads are baked.
  function bakeGrid(w, h){
    const E = params.canopy_extent_m, top = Math.max(faith.hMax, 1e-3), [nx, nz] = crownGridSize(E, top);
    if(!gridTex || gridN[0] !== nx || gridN[1] !== nz){
      if(gridTex) gl.deleteTexture(gridTex);
      gridTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, gridTex);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, nx, nx, nz, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for(const a of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, a, gl.CLAMP_TO_EDGE);
      if(!gridFBO) gridFBO = gl.createFramebuffer();
      gridN = [nx, nz];
    }
    gridBox[0] = -E/2; gridBox[1] = -E/2; gridBox[2] = 0; gridBox[3] = E; gridBox[4] = E; gridBox[5] = top;
    gl.bindFramebuffer(gl.FRAMEBUFFER, gridFBO); gl.drawBuffers([gl.COLOR_ATTACHMENT0]); gl.viewport(0, 0, nx, nx);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.useProgram(progGrid);
    upload(UG, w, h);
    gl.uniform3f(UG.crownOrigin, gridBox[0], gridBox[1], gridBox[2]); gl.uniform3f(UG.crownSize, gridBox[3], gridBox[4], gridBox[5]); gl.uniform3f(UG.crownN, nx, nx, nz);
    gl.bindVertexArray(emptyVAO);
    for(let z = 0; z < nz; z++){
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gridTex, 0, z);
      gl.uniform1f(UG.slice, z);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  function bindGrid(U){
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_3D, gridTex); gl.uniform1i(U.crownGrid, 8);
    gl.uniform3f(U.crownOrigin, gridBox[0], gridBox[1], gridBox[2]); gl.uniform3f(U.crownSize, gridBox[3], gridBox[4], gridBox[5]);
  }

  function upload(u, w, h){
    const pitch = clamp(params.view_pitch_deg, 0, 80)*DEG, fov = clamp(params.view_fov_deg, 5, 140)*DEG, aspect = canvas.width/canvas.height;
    gl.uniform1f(u.viewExtent, params.view_extent_m); gl.uniform1f(u.pitch, pitch); gl.uniform1f(u.lookUp, lookUp(params)); gl.uniform1f(u.fov, fov); gl.uniform1f(u.aspect, aspect);
    gl.uniform1f(u.yaw, params.view_yaw_deg*DEG); gl.uniform2f(u.center, params.view_center_x, params.view_center_y);
    const eye = cameraPose(params).eye; gl.uniform3f(u.eye, eye[0], eye[1], eye[2]);
    if(u.eyeW) gl.uniform3f(u.eyeW, eye[0], eye[1], eye[2]);
    // the light: the layers the fill bakes over the canopy box, at the faithful tree's own heights
    const E = params.canopy_extent_m, nL = Math.min(params.layer_count, MAX_LAYERS), H = faith.binH;
    for(let i = 0; i < MAX_LAYERS; i++){
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, hub.layerTex[i]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(u.layers[i], i);
    }
    gl.uniform1fv(u.heights, H.subarray(0, MAX_LAYERS)); gl.uniform1i(u.layerCount, nL);
    let half = 0.5*Math.max(faith.hMax - faith.hMin, 1e-3)/Math.max(nL, 1);
    for(let i = 1; i < nL; i++) half = Math.min(half, 0.5*Math.abs(H[i] - H[i - 1]));
    gl.uniform1f(u.layerHalf, half);
    gl.uniform2f(u.layerOrigin, -E/2, -E/2); gl.uniform2f(u.layerExtent, E, E);
    const g = hub.bulkShift(); gl.uniform2f(u.sunG, g[0], g[1]);
    gl.uniform1f(u.beamK, ballisticK(params.leaf_diffuse));
    // the leaf as tissue: the clear leaf's loss as a neutral depth per channel, which the beam pays at every leaf; the crown's own light, its recollision probability
    const neutral = !!params.leaf_neutral;
    gl.uniform1i(u.neutral, neutral ? 1 : 0);
    gl.uniform3f(u.clearK, -Math.log(slabClear(0, neutral)), -Math.log(slabClear(1, neutral)), -Math.log(slabClear(2, neutral)));
    gl.uniform1f(u.crownP, clamp(params.crown_light || 0, 0, 0.9));
    gl.uniform1i(u.openSky, params.open_sky ? 1 : 0);
    gl.uniform1i(u.beamMarch, params.beam_march ? 1 : 0);
    const atm = atmosphere(_atm, params.sun_elevation_deg, params.sky_turbidity, params.ambient_skylight);
    const loss = beamLoss('floor', params)*(hub.src.beamShare ?? 1);
    gl.uniform3f(u.leafSun, atm.sun[0]*loss, atm.sun[1]*loss, atm.sun[2]*loss); gl.uniform1f(u.sunCosine, clamp(params.sun_cosine, 0, 1));
    sunDirection(_sd, params.sun_elevation_deg, params.sun_azimuth_deg); gl.uniform3f(u.sunDir, _sd[0], _sd[1], _sd[2]);
    gl.uniform3f(u.ambient, atm.ambient[0], atm.ambient[1], atm.ambient[2]);
    // the floor's finish (komorebi-render.js's post group, the same values)
    const a = atm.ambient, m = Math.max(a[0], a[1], a[2], 1e-4), hb = 0.6;
    gl.uniform3f(u.haze, a[0]/m*hb, a[1]/m*hb, a[2]/m*hb);
    if(params.view_sky && u.skySunDir){   // the sky seen, as the floor's post group sets it (komorebi-light.js skyModel)
      const key = `${params.sun_elevation_deg}|${params.sun_azimuth_deg}|${params.sky_turbidity}|${a[0]}|${a[1]}|${a[2]}`;
      if(key !== _skyKey){ _skyKey = key; _sky = skyModel(params.sun_elevation_deg, params.sky_turbidity, _sd, a); }
      gl.uniform3fv(u.skySunDir, _sd); gl.uniform3fv(u.skyR, _sky.r); gl.uniform3fv(u.skyA, _sky.a); gl.uniform3fv(u.skyO, _sky.o); gl.uniform3fv(u.skyIso, _sky.iso);
      gl.uniform1f(u.skyMs, _sky.ms); gl.uniform3fv(u.skyScale, _sky.scale);
    }
    gl.uniform1f(u.halfExtent, 0.5*params.view_extent_m*Math.max(Math.hypot(aspect, 1), 1e-4)); gl.uniform2f(u.centerF, params.view_center_x, params.view_center_y);
    gl.uniform1f(u.irisOpacity, trans.active && trans.iris ? trans.irisOpacity : 1);
    gl.uniform1f(u.vignette, clamp(params.vignette, 0, 1)); gl.uniform1f(u.vignetteShape, clamp(params.vignette_shape, 2, 8)); gl.uniform2f(u.target, w, h);
    gl.uniform1f(u.twilight, smoothstep(30, 4, params.sun_elevation_deg)); gl.uniform1f(u.mesopic, params.mesopic_strength);
    gl.uniform1f(u.exposure, shownExposure(params)); gl.uniform1f(u.contrast, params.contrast); gl.uniform1i(u.tone, params.tone_map);
    gl.uniform3fv(u.travelTone, trans.travelTone ?? [0, 0, 0]);
    gl.uniform1f(u.treeTone, clamp(params.tree_tone, 0, 1));
  }

  // Draw the tree over the frame already in `fbo` (w × h).
  function draw(fbo, w, h){
    if(!wanted()){ if(tw) free(); return; }
    if(trans.active && trans.treeFade && !(trans.treeOpacity > 0)) return;
    if(!targets(w, h)) return;
    compile(); ensureLayers();
    const names = treeNames(params), crown = names.includes('CROWN_FIELD');
    if(crown) bakeGrid(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFBO);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    // the leaves: the cast's own records and vertex code, this frame's wind
    if(hasLeaves() && faith.vao){
      const leaf = program('leaf', names), UL = leaf.u;
      gl.useProgram(leaf.prog);
      upload(UL, w, h);
      if(crown) bindGrid(UL);
      gl.uniform1f(UL.edge, params.edge_softness);
      gl.uniform1f(UL.f0, 0.04);
      gl.uniform1f(UL.morph, params.drift_phase); gl.uniform1f(UL.morphAmount, params.drift_amount);
      gl.uniform1f(UL.windLevel, motion.u); gl.uniform1f(UL.air, Math.max(0, params.wind_air)); gl.uniform1f(UL.depth, Math.max(0, params.wind_depth || 0));
      gl.uniform1f(UL.windTime, motion.time); gl.uniform1f(UL.leafSwing, params.leaf_swing); gl.uniform1f(UL.flutterFreq, params.flutter_freq);
      gl.uniform2f(UL.sway, motion.sway[0], motion.sway[1]); gl.uniform1f(UL.hRef, Math.max(faith.hMax, 1e-3));
      bindLeafShape(gl, UL, hub.grove);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hub.clusterTex); gl.uniform1i(UL.clusterTex, 4);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, hub.clusterGeomTex); gl.uniform1i(UL.clusterGeom, 5);
      gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, params.leaf_neutral ? slabTexNeutral : slabTex); gl.uniform1i(UL.slab, 7);
      gl.bindVertexArray(faith.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, faith.count);
    }
    // the wood: the skeleton as the cast swayed it this frame
    if(hasWood()){
      const feet = params.trunk_base ? hub.faith?.trunks : null, nFeet = feet ? Math.min(16, feet.length/3) : 0;   // trunk_base: the feet whose capsules flare
      const wood = program(nFeet ? 'woodFoot' : 'wood', names), U = wood.u;   // the foot's code lives in a program of its own (VS_TREE_WOOD_FOOT), so a tree without feet runs the wood shader it always ran
      gl.useProgram(wood.prog);
      upload(U, w, h);
      if(crown) bindGrid(U);
      gl.uniform3f(U.bark, params.bark_r, params.bark_g, params.bark_b);
      gl.uniform1f(U.woodPx, params.thin_twigs ? 2*Math.tan(0.5*clamp(params.view_fov_deg, 5, 140)*DEG)/h : 0);
      gl.uniform1i(U.groundClip, params.trunk_base ? 1 : 0);
      gl.uniform1f(U.barkTex, clamp(params.bark_texture ?? 0, 0, 1));
      gl.uniform1i(U.roundEnds, params.trunk_split >= 2 && params.growth_years > 0 ? 1 : 0);   // only a grown tree forks (komorebi-growth.js)
      gl.uniform1i(U.footCount, nFeet); if(nFeet) gl.uniform3fv(U.foot, new Float32Array(feet.slice(0, 3*nFeet)));
      gl.bindVertexArray(faith.segVAO);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, faith.segCount);
    }
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.disable(gl.DEPTH_TEST);
    // resolve each target into its texture
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFBO); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rsFBO);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.drawBuffers([gl.NONE, gl.COLOR_ATTACHMENT1]);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    // ...and lay it over the frame: its colour is already weighed by its coverage
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progComp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rsCol); gl.uniform1i(UC.col, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, rsCover); gl.uniform1i(UC.cover, 1);
    gl.uniform1f(UC.opacity, trans.active && trans.treeFade ? trans.treeOpacity : 1);   // a route fading the tree in or out
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    free(); for(const t of [slabTex, slabTexNeutral, gridTex]) if(t) gl.deleteTexture(t); if(gridFBO) gl.deleteFramebuffer(gridFBO);
    slabTex = slabTexNeutral = gridTex = gridFBO = null; gridN = [0, 0];
    progs.clear(); progGrid = progComp = null; _skyKey = '';
  }
  return { treeWanted: wanted, drawTree: draw, bakeTreeLayers: bakeLayers, treeLayerRes: () => treeLayerRes(params, bakeRes), disposeTree: dispose };
}
// What the engine holds in a bundle that cut the tree view: a tree that is never wanted.
export const NO_TREE_VIEW = { treeWanted: () => false, drawTree: () => {}, bakeTreeLayers: () => {}, treeLayerRes: () => 1, disposeTree: () => {} };
