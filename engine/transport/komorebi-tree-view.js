// ============================================================================
// The tree seen from the floor camera (spec model/camera.md, "The tree seen from the floor camera"; model/leaf.md, "A leaf, seen"). On a standing scene cast
// faithfully, the tilted floor camera sees the leaves and wood the shadow is cast from: the faithful cast's own leaf records, stood back up by the same
// vertex code that casts them (VS_TREE is GLSL_FAITH_VERTEX with its TREE_VIEW stage), and its own swayed wood, drawn after the floor in the floor camera's
// perspective. A leaf is lit as a receiver, by the sun through the leaves above it and by the sky above it, read from the low-res layer set the sky fill
// bakes on the faithful path; it is one finite two-faced leaf that passes the look's own transmittance (the slab, komorebi-leaf.js). The pass draws into its own
// multisampled colour and depth, its leaves' outlines turned into sample coverage, and is laid over the frame: every step the floor takes after its light
// (the dusk shift, the haze, the iris, the Look's tail) is per pixel, so the tree takes the same steps in its own shader.
// Pure exports first (the projection the shader runs), then the GL factory, which the engine holds behind FEAT_TREE_VIEW.
// ============================================================================
import { DEG, clamp, smoothstep } from '../komorebi-math.js';
import { atmosphere, beamLoss, shownExposure, sunDirection } from '../light/komorebi-light.js';
import { ballisticK, bindLeafShape, SLAB_N, slabTable } from '../leaf/komorebi-leaf.js';
import { cameraPose } from './komorebi-camera.js';
import { MAX_LAYERS } from '../komorebi-params.js';
import { VS_TREE, FS_TREE, VS_TREE_WOOD, FS_TREE_WOOD, FS_TREE_COMPOSITE, VS_FULL } from './komorebi-shaders.js';
import { cameraFor } from './komorebi-transport.js';

// ---- THE FLOOR CAMERA RUN FORWARDS: GLSL_TREE_CAMERA's treeClip, on the CPU, for the tests. Returns normalised device x, y and the depth along the gaze in
// eye heights; a point on the floor lands where the floor camera's own ray from that pixel meets the floor. ----
export function treeProject(p, aspect, P){
  const pitch = clamp(p.view_pitch_deg, 0, 80)*DEG, fov = clamp(p.view_fov_deg, 5, 140)*DEG, yaw = p.view_yaw_deg*DEG;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), kf = Math.max(Math.tan(0.5*fov), 1e-4);
  const scale = p.view_extent_m*cp*cp/Math.max(2*kf, 1e-4), targetY = sp/Math.max(cp, 1e-4);
  const cy = Math.cos(yaw), sy = Math.sin(yaw), dx = P[0] - p.view_center_x, dy = P[1] - p.view_center_y;
  const qx = cy*dx - sy*dy, qy = sy*dx + cy*dy;
  const v = [qx/scale, qy/scale + targetY, P[2]/scale - 1];
  const depth = v[1]*sp - v[2]*cp, up = v[1]*cp + v[2]*sp;
  return [v[0]/(kf*aspect)/depth, up/kf/depth, depth];
}
// The plan point the floor camera's ray through normalised device (x, y) meets the floor at: GLSL_T_FLOOR_CAMERA, for the same tests.
export function floorRay(p, aspect, x, y){
  const pitch = clamp(p.view_pitch_deg, 0, 80)*DEG, fov = clamp(p.view_fov_deg, 5, 140)*DEG, yaw = p.view_yaw_deg*DEG;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), kf = Math.max(Math.tan(0.5*fov), 1e-4);
  const sxc = x/2*aspect, tyc = y/2;
  const d = [2*kf*sxc, 2*kf*tyc*cp + sp, 2*kf*tyc*sp - cp];
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
const treeShaders = FEAT_TREE_VIEW ? () => ({ leaf: [VS_TREE, FS_TREE], wood: [VS_TREE_WOOD, FS_TREE_WOOD], comp: [VS_FULL, FS_TREE_COMPOSITE] }) : null;

// The low-res layer set the tree is lit by: the sky fill's own size (komorebi-bake.js fillLayerRes), so with both open they are one set.
export const treeLayerRes = (params, bakeRes) => Math.min(clamp(params.fill_resolution|0, 32, 1024), bakeRes());

// ============================================================================
// The GL half.
// ============================================================================
export function makeTreeView(hub){
  const { gl, canvas, params, motion, faith, trans, emptyVAO, faithfulOn, bakeRes } = hub;
  let progLeaf = null, progWood = null, progComp = null, UL = null, UW = null, UC = null, slabTex = null;
  let msFBO = null, msCol = null, msCover = null, msDepth = null, rsFBO = null, rsCol = null, rsCover = null, tw = 0, th = 0;
  let layersBaked = false;
  const _atm = { sun: [0, 0, 0], ambient: [0, 0, 0] }, _sd = [0, 0, 0];

  // Wanted: the look opens it, its tree stands in the scene and is cast faithfully, the floor camera is the one drawing, and no route owns the cast this frame
  // (the season's, the leaves' and the litter's travels draw their own leaves, and the viewpoint route moves the camera: the tree comes and goes under the fade).
  const wanted = () => !!params.tree_view && !!params.standing_scene && faithfulOn() && cameraFor(params) === 'floor' && faith.count > 0 && !!faith.sideBuf
    && !(trans.active && (trans.castHeld || trans.travelField || trans.riseField || trans.viewpoint));

  function compile(){
    if(progLeaf) return;
    const P = hub.sharedProgram, L = (prog, n) => gl.getUniformLocation(prog, n);
    const sh = treeShaders();
    progLeaf = P(...sh.leaf); progWood = P(...sh.wood); progComp = P(...sh.comp);
    const common = (prog) => ({
      viewExtent: L(prog, 'uViewExtent'), pitch: L(prog, 'uPitch'), fov: L(prog, 'uFov'), aspect: L(prog, 'uAspect'), yaw: L(prog, 'uViewYaw'), center: L(prog, 'uViewCenter'),
      layers: Array.from({ length: MAX_LAYERS }, (_, i) => L(prog, `uLayer[${i}]`)), heights: L(prog, 'uLayerHeight[0]'), layerCount: L(prog, 'uLayerCount'), layerHalf: L(prog, 'uLayerHalf'),
      layerOrigin: L(prog, 'uLayerOrigin'), layerExtent: L(prog, 'uLayerExtent'), sunG: L(prog, 'uSunG'), beamK: L(prog, 'uBeamK'), leafSun: L(prog, 'uLeafSun'), sunCosine: L(prog, 'uSunCosine'),
      sunDir: L(prog, 'uSunDir'), ambient: L(prog, 'uAmbient'), eye: L(prog, 'uEye'),
      twilight: L(prog, 'uTwilight'), mesopic: L(prog, 'uMesopic'), haze: L(prog, 'uHazeColor'), halfExtent: L(prog, 'uHalfExtent'), centerF: L(prog, 'uViewCenterF'),
      vignette: L(prog, 'uVignette'), vignetteShape: L(prog, 'uVignetteShape'), irisOpacity: L(prog, 'uIrisOpacity'), target: L(prog, 'uTarget'),
      exposure: L(prog, 'uExposure'), contrast: L(prog, 'uContrast'), tone: L(prog, 'uToneMap'), travelTone: L(prog, 'uTravelTone'),
    });
    UL = { ...common(progLeaf), ...hub.faithLocs(progLeaf), slab: L(progLeaf, 'uSlab'), f0: L(progLeaf, 'uF0') };
    UW = { ...common(progWood), eyeW: L(progWood, 'uEyeW'), bark: L(progWood, 'uBark') };
    UC = { col: L(progComp, 'uTreeCol'), cover: L(progComp, 'uTreeCover'), opacity: L(progComp, 'uTreeOpacity') };
    slabTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, slabTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SLAB_N, 3, 0, gl.RGBA, gl.FLOAT, slabTable(SLAB_N));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // The targets: four samples of colour, coverage and depth, resolved into two plain textures the composite reads.
  function targets(w, h){
    if(msFBO && tw === w && th === h) return;
    free();
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    const rb = (fmt) => { const r = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, r); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h); return r; };
    msCol = rb(gl.RGBA8); msCover = rb(gl.RGBA8); msDepth = rb(gl.DEPTH_COMPONENT24);
    msFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, msFBO);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msCol);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, msCover);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) hub.fail("the tree view's multisampled target is incomplete");
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); return t; };
    rsCol = tex(); rsCover = tex();
    rsFBO = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, rsFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rsCol, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, rsCover, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    tw = w; th = h;
  }
  function free(){
    for(const r of [msCol, msCover, msDepth]) if(r) gl.deleteRenderbuffer(r);
    for(const t of [rsCol, rsCover]) if(t) gl.deleteTexture(t);
    for(const f of [msFBO, rsFBO]) if(f) gl.deleteFramebuffer(f);
    msFBO = rsFBO = msCol = msCover = msDepth = rsCol = rsCover = null; tw = th = 0;
  }

  // The low-res layer set the tree is lit by. With the sky fill open it is the fill's own (bakeFill bakes it with every bake); without, the tree keeps it: allocated
  // at the fill's size, baked by every bake (bakeLayers below, from komorebi-bake.js's bake) and once more when it was just made.
  function ensureLayers(){
    if(hub.fillWanted()) return;
    const res = treeLayerRes(params, bakeRes);
    if(hub.layerSize !== res){ hub.allocLayers(res); layersBaked = false; }
    if(!layersBaked) bakeLayers();
  }
  function bakeLayers(){
    if(hub.fillWanted() || !wanted()) return;
    const res = treeLayerRes(params, bakeRes);
    if(hub.layerSize !== res) hub.allocLayers(res);
    hub.bakeLayers(res, faith.binH, true);
    layersBaked = true;
  }

  function upload(u, w, h){
    const pitch = clamp(params.view_pitch_deg, 0, 80)*DEG, fov = clamp(params.view_fov_deg, 5, 140)*DEG, aspect = canvas.width/canvas.height;
    gl.uniform1f(u.viewExtent, params.view_extent_m); gl.uniform1f(u.pitch, pitch); gl.uniform1f(u.fov, fov); gl.uniform1f(u.aspect, aspect);
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
    const atm = atmosphere(_atm, params.sun_elevation_deg, params.sky_turbidity, params.ambient_skylight), loss = beamLoss('floor', params);
    gl.uniform3f(u.leafSun, atm.sun[0]*loss, atm.sun[1]*loss, atm.sun[2]*loss); gl.uniform1f(u.sunCosine, clamp(params.sun_cosine, 0, 1));
    sunDirection(_sd, params.sun_elevation_deg, params.sun_azimuth_deg); gl.uniform3f(u.sunDir, _sd[0], _sd[1], _sd[2]);
    gl.uniform3f(u.ambient, atm.ambient[0], atm.ambient[1], atm.ambient[2]);
    // the floor's finish (komorebi-render.js's post group, the same values)
    const a = atm.ambient, m = Math.max(a[0], a[1], a[2], 1e-4), hb = 0.6;
    gl.uniform3f(u.haze, a[0]/m*hb, a[1]/m*hb, a[2]/m*hb);
    gl.uniform1f(u.halfExtent, 0.5*params.view_extent_m*Math.max(Math.hypot(aspect, 1), 1e-4)); gl.uniform2f(u.centerF, params.view_center_x, params.view_center_y);
    gl.uniform1f(u.irisOpacity, trans.active && trans.iris ? trans.irisOpacity : 1);
    gl.uniform1f(u.vignette, clamp(params.vignette, 0, 1)); gl.uniform1f(u.vignetteShape, clamp(params.vignette_shape, 2, 8)); gl.uniform2f(u.target, w, h);
    gl.uniform1f(u.twilight, smoothstep(30, 4, params.sun_elevation_deg)); gl.uniform1f(u.mesopic, params.mesopic_strength);
    gl.uniform1f(u.exposure, shownExposure(params)); gl.uniform1f(u.contrast, params.contrast); gl.uniform1i(u.tone, params.tone_map);
    gl.uniform3fv(u.travelTone, trans.travelTone ?? [0, 0, 0]);
  }

  // Draw the tree over the frame already in `fbo` (w × h).
  function draw(fbo, w, h){
    if(!wanted() || trans.active && trans.treeFade && !(trans.treeOpacity > 0)) return;   // nothing to lay over at a fade's zero
    compile(); targets(w, h); ensureLayers();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFBO);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    // the leaves: the cast's own records and vertex code, this frame's wind
    gl.useProgram(progLeaf);
    upload(UL, w, h);
    gl.uniform1f(UL.edge, params.edge_softness);
    gl.uniform1f(UL.f0, 0.04);
    gl.uniform1f(UL.morph, params.drift_phase); gl.uniform1f(UL.morphAmount, params.drift_amount);
    gl.uniform1f(UL.windLevel, motion.u); gl.uniform1f(UL.air, Math.max(0, params.wind_air)); gl.uniform1f(UL.depth, Math.max(0, params.wind_depth || 0));
    gl.uniform1f(UL.windTime, motion.time); gl.uniform1f(UL.leafSwing, params.leaf_swing); gl.uniform1f(UL.flutterFreq, params.flutter_freq);
    gl.uniform2f(UL.sway, motion.sway[0], motion.sway[1]); gl.uniform1f(UL.hRef, Math.max(faith.hMax, 1e-3));
    bindLeafShape(gl, UL, hub.grove);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hub.clusterTex); gl.uniform1i(UL.clusterTex, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, hub.clusterGeomTex); gl.uniform1i(UL.clusterGeom, 5);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, slabTex); gl.uniform1i(UL.slab, 7);
    gl.bindVertexArray(faith.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, faith.count);
    // the wood: the skeleton as the cast swayed it this frame
    if(params.branch_tau > 0 && faith.segCount > 0 && faith.segVAO){
      gl.useProgram(progWood);
      upload(UW, w, h);
      gl.uniform3f(UW.bark, params.bark_r, params.bark_g, params.bark_b);
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

  function dispose(){ free(); if(slabTex) gl.deleteTexture(slabTex); slabTex = null; progLeaf = progWood = progComp = null; }
  return { treeWanted: wanted, drawTree: draw, bakeTreeLayers: bakeLayers, treeLayerRes: () => treeLayerRes(params, bakeRes), disposeTree: dispose };
}
// What the engine holds in a bundle that cut the tree view: a tree that is never wanted.
export const NO_TREE_VIEW = { treeWanted: () => false, drawTree: () => {}, bakeTreeLayers: () => {}, treeLayerRes: () => 1, disposeTree: () => {} };
