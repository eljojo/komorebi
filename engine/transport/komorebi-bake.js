// ============================================================================
// The bake (spec/model/canopy.md) — the per-frame snapshot of the moving canopy in the
// form transport reads fast: leaves stamped as per-layer optical depth
// (additive, order-independent), and the FAITHFUL path's per-sample geometry
// bake into one pre-integrated soft-shadow texture (the opt-out from the
// depth-layer cheat). Then the SKY FILL (spec/model/fill.md): the hemisphere integral of
// those layers that lights the shade the beam does not reach. fillSwayedSegs
// is the swayed skeleton both cast bakes share. Two factories over the engine's
// shared internals (hub): makeBake, and makeFill — the sky fill on its own, so a
// bundle whose looks never open canopy_fill can leave it out whole.
// ============================================================================
import { clamp, lerp } from '../komorebi-math.js';
import { atmosphere, beamLoss, sunIncidence } from '../light/komorebi-light.js';
import { SLAB, SLAB_N, ballisticK, bindLeafShape, slabTable } from '../leaf/komorebi-leaf.js';
import { MAX_FILL_DIRS, MAX_LAYERS, MAX_SAMPLES } from '../komorebi-params.js';
import { fillFrame, fillRays, fillTurns } from './komorebi-fill.js';
import { CAMERAS, cameraFor } from './komorebi-transport.js';

// The tier this module owns besides the fill (which is its own factory below, so a bundle that cuts it cuts the factory): the leaf's diffuse share. The bundler substitutes
// it by a literal (embed-build.mjs); false means no look in the bundle opens leaf_diffuse, and the beam's k is 0 wherever it is read.
const FEAT_LEAF_DIFFUSE = true;
// edge_area (spec/model/leaf.md) as the 0/1 every reader takes it as. Behind the flag for the reason k is: a bundle that cut the leaf's diffuse share has no GLSL that reads it.
const edgeAreaOn = (params) => (FEAT_LEAF_DIFFUSE && params.edge_area ? 1 : 0);
// How many slots the fill's signature has (fillSig, below). The engine sizes its `fill.sig` from this: a write past a Float64Array's end is dropped silently, and
// the fill then re-bakes every frame, so the length is one number in one place.
export const FILL_SIG_LEN = 23;

export function makeBake(hub){
  const { gl, params, motion, src, faith, sky, U, bakeFBO, faithFBO, emptyVAO, progBake, progFaith, progFaithSeg, progFAcc, bakeRes, faithfulOn } = hub;
  let layerEdge, layerDrift, layerPhase;
  const layerPhaseNow = () => params.drift_amount === 0 ? 0 : params.drift_phase;

  // ---- one bake: the cast the camera reads, then (if the shade is lit through the canopy) the fill ----------------
  function bake(){
    hub.refreshWood();
    if(faithfulOn()) bakeFaithful();   // FAITHFUL path (spec/model/canopy.md): cast the real tree, not the layer slabs
    else bakeLayers(bakeRes(), hub.layerHeights(), false);
    if(hub.fillWanted()) hub.bakeFill(true);   // true: on the faithful path the layers are not otherwise baked, so the fill bakes its own low-res set (a bundle without the fill holds a fillWanted that is false)
    else hub.bakeTreeLayers?.();         // the tree view lights its leaves by the same low-res set: without the fill it bakes the set itself (only while it is wanted)
  }

  // ---- bake leaves into per-layer optical-depth textures ---------------------
  // `H` is the heights the layers sit at and `faithfulSway` says which sway rule rides them: the layer path's
  // sway_height_gain lever, or the faithful path's own (coherent sway grows with the real height / hMax — the
  // rule VS_FAITH gives the leaves, spec/model/motion.md), which the sky fill's low-res layers follow so the two stay registered.
  function bakeLayers(res, H, faithfulSway){
    layerEdge = params.edge_softness;
    layerDrift = params.drift_amount;
    layerPhase = layerPhaseNow();
    if(params.sky_view) sky.branchTau=params.branch_tau;
    const E = params.canopy_extent_m;
    gl.useProgram(progBake);
    gl.uniform2f(U.bake.origin, -E/2, -E/2);
    gl.uniform2f(U.bake.extent, E, E);
    gl.uniform1f(U.bake.edge, params.edge_softness);
    gl.uniform1f(U.bake.morph, params.drift_phase);
    gl.uniform1f(U.bake.morphAmount, params.drift_amount);
    gl.uniform1f(U.bake.windLevel, motion.u);
    gl.uniform1f(U.bake.air, Math.max(0, params.wind_air)); gl.uniform1f(U.bake.depth, Math.max(0, params.wind_depth || 0));
    gl.uniform1f(U.bake.windTime, motion.time);
    gl.uniform1f(U.bake.leafSwing, params.leaf_swing);
    gl.uniform1f(U.bake.flutterFreq, params.flutter_freq);
    gl.uniform1f(U.bake.stemLen, params.stem_length);
    // WHICH GROVES ARE IN THIS BAKE. Normally one, at full coverage. During a crossfade (spec/model/transitions.md) two, at
    // complementary coverage into the SAME layer texture — which the additive optical-depth bake makes exact:
    // the depths sum, so at w the picture is (1-w) of the old arrangement plus w of the new, and no leaf ever
    // jumps. Their cluster textures are per-grove, so the binds move inside the loop with them.
    const baking = hub.groveIn ? [[hub.grove, 1-hub.crossW], [hub.groveIn, hub.crossW]] : [[hub.grove, 1]];
    gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);
    gl.viewport(0,0,res,res);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);          // optical depth accumulates additively
    const base=params.canopy_base_height_m;
    // ALPHA IS THE LEAVES' COVERAGE, ON EVERY CAMERA (spec/model/leaf.md, sky-view.md). The layer texture's rgb is the foliage's per-channel optical depth;
    // its alpha is Σ of the leaf masks over the texel, fade included: with the depth beside it, the pair texelMix reads a texel as a MIXTURE of
    // leaf and gap by (spec/model/leaf.md), and so the beam's neutral depth, the fill's emission and the sky camera's glow. At k = 0 nothing reads it. The sky view's fine wood used
    // to claim that channel (a colour mask kept the leaves from writing their coverage there); it has a texture of its own now (woodTex,
    // below), so this bake is the same bake on every camera.
    for(let l=0;l<params.layer_count;l++){
      // higher layers ride longer levers -> sway more when height gain > 0 (else pure translation)
      const f = faithfulSway ? H[l]/Math.max(faith.hMax,1e-3) : 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
      gl.uniform2f(U.bake.sway, motion.sway[0]*f, motion.sway[1]*f); gl.uniform1f(U.bake.swayGain, f);   // tree 0's sway; each clump's own tree adds its share (row 2) by the same lever
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.layerTex[l], 0);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // depth 0 -> transmittance 1, coverage 0: alpha has to reset too, or it accumulates across bakes
      for(const [g, cov] of baking){
        // A grove at zero coverage contributes no optical depth; skip the draw rather than issue it. A route between layer counts bakes
        // the larger count, and a grove binned into fewer layers has nothing above its own top layer.
        if(!(cov > 0) || !g.layerVAO[l]) continue;
        gl.uniform1f(U.bake.coverage, cov);
        // The incoming grove of a crossfade is cut with its own look's leaf edge, so nothing about its leaves changes when it is installed.
        gl.uniform1f(U.bake.edge, g === hub.groveIn ? g.edgeSoftness : params.edge_softness);
        bindLeafShape(gl, U.bake, g);                          // this grove's leaf outline (unit 6), first: the unit left ACTIVE is the cluster geometry's, as it always was — the engine binds a target onto whatever is, and unit 6 is the fill's sampler
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, g.clusterTex);     gl.uniform1i(U.bake.clusterTex, 4);
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, g.clusterGeomTex); gl.uniform1i(U.bake.clusterGeom, 5);
        const L=g.layerVAO[l];
        gl.bindVertexArray(L.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, L.count);
      }
    }
    // The woody TRUNK and MAIN LIMBS are never stamped here — they are the continuous-height analytic occluder in
    // transport (spec/model/canopy.md), because a long segment cut into layer bands casts a shadow that shatters into a staircase.
    // The SKY VIEW adds back the FINE wood only (spec/model/sky-view.md): it is read along the eye's ray rather than cast, it is short
    // enough to sit inside one band, and it carries the same per-layer sway the leaves in that band get — so the
    // leaves have visible twigs to hang on instead of floating in clouds around bare limb tips. It goes in the layer's OWN wood texture
    // (R16F, woodTex[l], cleared to 0 while fine wood is visible), beside the
    // layer it is registered with, so the layer's rgb stays the foliage's depth and its alpha the leaves' coverage.
    if(params.sky_view){
      sky.woodOn = params.branch_tau > 0 && sky.segRest.length > 0;
      hub.sizeWoodLayers(sky.woodOn ? params.layer_count : 0);
    }
    if(params.sky_view && sky.woodOn){
      fillSwayedSegs(sky.segRest, sky.segArr, 0, 0, null);   // the coherent translation arrives per LAYER below, exactly as the leaves take it:
      // tree 0's by the uniform, and what a segment's own tree adds to it here, by its layer's lever, as VS_BAKE adds it to that tree's leaves
      const hr = hub.hier;
      if(hr?.nTree > 1) for(let l=0;l<params.layer_count;l++){
        const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
        for(let k=sky.start[l]|0, e=k+(sky.count[l]|0); k<e; k++){
          const t = 4*sky.segRest[k].tree, dx = hr.treeDelta[t]*f, dy = hr.treeDelta[t+1]*f, o = 9*k;
          sky.segArr[o] += dx; sky.segArr[o+1] += dy; sky.segArr[o+2] += dx; sky.segArr[o+3] += dy;
        }
      }
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
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.woodTex[l], 0);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
        if(!sky.count[l]) continue;
        const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
        gl.uniform2f(U.faithSeg.segSway, motion.sway[0]*f, motion.sway[1]*f);
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);   // draw this layer's slice: no baseInstance in WebGL2, so the attribute origin moves instead
        gl.vertexAttribPointer(1,4,gl.FLOAT,false,36,sky.start[l]*36);
        gl.vertexAttribPointer(2,4,gl.FLOAT,false,36,sky.start[l]*36+16);
        gl.vertexAttribPointer(3,1,gl.FLOAT,false,36,sky.start[l]*36+32);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sky.count[l]);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- FAITHFUL leaf bake (spec/model/canopy.md): the opt-out from the depth-layer cheat. Each leaf casts from its OWN
  // continuous grown height, so the cast IS the preview tree (leaves on their twigs, aligned with the wood). The
  // "many suns" convolution is done as GEOMETRY: for each source sample, draw every leaf shifted to its floor
  // landing (world - height·g_i) with MULTIPLICATIVE blend → transmittance_i in a scratch buffer, then add
  // w_i·transmittance_i into the accumulator. The result is one soft-shadow texture transport taps ONCE. Cost moves
  // from the per-pixel sample loop to per-sample bake passes — gated, so the park / layer path pays nothing. ----
  // ---- the swayed skeleton, filled ONCE and read by two bakes (spec/model/canopy.md, sky-view.md). Each segment is rotated by its limb's
  // bend about its tree pivot, and a TERMINAL segment first swings about its own twig base by that clump's twig bend —
  // the same pivot, angle and order VS_FAITH gives the leaves hanging on it, so they ride the twig instead of sliding
  // off it. `swx/swy` is the coherent whole-tree translation: the CAST wants it height-scaled and folded in here; the
  // SKY view's layer stamp wants the leaf bake's own per-layer factor instead and passes 0, taking it as a uniform. ----
  // swx, swy: tree 0's sway, which grows with height; T (the grove's treeDelta, or null) what each segment's own tree adds to it
  function fillSwayedSegs(R, sa, swx, swy, T){
    const la = hub.hier ? hub.hier.limbAngle : null, ta = hub.hier ? hub.hier.twigAngle : null;
    const lat = hub.hier ? hub.hier.limbAttach : null;   // per-limb attach height: where the sway_pitch foreshorten is anchored (spec/model/motion.md)
    const lp = hub.hier ? hub.hier.limbPitch : null;     // per-limb pitch DOF: the angle the foreshorten is taken from (spec/model/motion.md)
    const hRef = Math.max(faith.hMax, 1e-3);
    const sp = Math.max(0, params.sway_pitch);   // 3-D lean (spec/model/motion.md): foreshorten the wood heights by the SAME factor the leaves use, so leaf-on-wood registration holds
    for(let k=0;k<R.length;k++){
      const s = R[k];
      const th = (la && s.limb>=0 && s.limb<la.length) ? la[s.limb] : 0;
      // MEDIUM band (spec/model/motion.md): terminal wood first swings about its OWN twig base by that clump's twig bend, before
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
      const c=Math.cos(th), sn=Math.sin(th), px=s.px, py=s.py, o=k*9;
      // the SAME expression publishBend gives this limb's clumps, off the SAME pitch DOF — leaf-on-wood
      // registration is only kept by the two staying literally in lockstep (spec/model/motion.md). The plan rotation above
      // is the yaw DOF; this is the elevation one, and the two compose orthogonally.
      const ph = (sp>0 && lp && s.limb>=0 && s.limb<lp.length) ? lp[s.limb] : 0;
      const fore = sp>0 ? clamp(1 - sp*(1-Math.cos(ph)), 0.1, 1) : 1;
      // ANCHOR the foreshorten at the limb's attach height (spec/model/motion.md): h' = at + (h−at)·fore, so at the join h' = at
      // exactly and the pitching limb cannot part from the trunk axis, which does not pitch. Same sign for a droop
      // tip hanging BELOW the attach — rotating a limb down about its joint moves every point toward the attach
      // plane. Trunk wood (limb<0) never pitches, and at=0 with fore=1 reproduces h' = h exactly (byte-identical).
      const at = (sp>0 && lat && s.limb>=0 && s.limb<lat.length) ? lat[s.limb] : 0;
      const ha = at + (s.ha-at)*fore, hb = at + (s.hb-at)*fore;
      const kA = ha/hRef, kB = hb/hRef;   // sway grows with height: 0 at the ground → the trunk base stays PLANTED, the crown sways; same fraction for a limb & the trunk at its height, so they stay joined
      const tx = T ? swx + T[4*s.tree] : swx, ty = T ? swy + T[4*s.tree+1] : swy;   // its own tree's sway, as VS_FAITH gives that tree's leaves
      sa[o]   = px + c*(ax-px) - sn*(ay-py) + tx*kA;
      sa[o+1] = py + sn*(ax-px) + c*(ay-py) + ty*kA;
      sa[o+2] = px + c*(bx-px) - sn*(by-py) + tx*kB;
      sa[o+3] = py + sn*(bx-px) + c*(by-py) + ty*kB;
      sa[o+4]=ha; sa[o+5]=hb; sa[o+6]=s.ra; sa[o+7]=s.rb; sa[o+8]=s.cov;
    }
  }

  // Source offsets and weights matter even at an unchanged count. Snapshot the numeric inputs without per-frame strings or allocations.
  const faithKeys = ['sun_elevation_deg','sun_azimuth_deg','receiver','cloth_distance_m','drift_phase','drift_amount','leaf_swing','flutter_freq','edge_softness','tilt_shadow'];
  const faithInputs = new Float64Array(faithKeys.length+1), faithSource = new Float32Array(MAX_SAMPLES*3);
  let faithReady = false;
  function faithfulInputsMatch(record){
    let same = faithReady;
    for(let i=0;i<=faithKeys.length;i++){
      const value = i===faithKeys.length ? bakeRes() : Number(params[faithKeys[i]]);
      if(!Object.is(faithInputs[i], value)) same = false;
      if(record) faithInputs[i] = value;
    }
    for(let i=0;i<src.count*3;i++){
      if(faithSource[i]!==src.flat[i]) same = false;
      if(record) faithSource[i] = src.flat[i];
    }
    if(record) faithReady = true;
    return same;
  }

  function bakeFaithful(){
    faithfulInputsMatch(true);
    faith.branchTau=params.branch_tau;
    const k = FEAT_LEAF_DIFFUSE ? ballisticK(params.leaf_diffuse) : 0;
    faith.k = k; faith.n = src.count;   // recorded even for an empty grove: refreshFaith compares against them
    faith.edgeArea = edgeAreaOn(params);   // the cast has the edge law baked in, like k
    // Only "no grove built yet" returns early. A grove with no leaves — leaf_drop 1 at leaf-off, spec/model/season.md abscission, or no foliage at all — still has
    // its shadow to bake: the wood if there is any, and otherwise Σw·1 = 1, a lit floor. (An instanced draw of zero leaves is a no-op.) Returning
    // on an empty leaf set left faithTex at zero, which transport reads as a floor in total shade.
    if(!faith.vao && !hub.faithGL(faith)){ gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }   // a layered grove keeps its leaves as a record: faithGL uploads it if one is ever cast (komorebi-grove.js)
    const res = bakeRes(), N = src.count;
    // cast-region frame: the shadow lands OFFSET from the canopy by the bulk throw (standing scene), so the faith
    // texture must cover where it FALLS, not the canopy plan. world = planPoint − g·h, so the cast box is the REAL
    // plan AABB (faith.p*, leaves+wood) swept over the height range [hLo,hMax] and the per-sample g-range — then padded
    // and squared. (Only the g-EXTREMES matter, so track those in the sample loop instead of an O(8N) corner sweep.)
    const proj = hub.projMatrix();
    const gx=faith.gx, gy=faith.gy;
    const _b=hub.bulkShift(), bulkX=_b[0], bulkY=_b[1];   // standing-scene lateral throw (shared helper; 0 when off)
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
    // the foreshorten is anchored at the limb's attach height (spec/model/motion.md), so h' = 0.1·h + 0.9·attachH ≥ 0.1·h with
    // attachH ≥ 0. Kept as-is — the slack costs frame padding, nothing else. (A leaf hanging BELOW its attach rises
    // instead, but only toward attachH, a height the trunk wood already occupies — so hHi needs no matching widening.)
    let hLo = woodOn ? 0 : faith.hMin*(params.sway_pitch>0 ? 0.1 : 1), hHi = faith.hMax;
    // pad: the leaf quad half-extent, the incoherent drift orbit, and the live coherent sway (leaves+wood translate
    // by up to |sway| at the crown) — none of which are in the rest plan AABB. (The twig-hug trail-back already is.)
    // A leaf's long half-axis is at most 0.7·leaf_size_m, which an ellipse's pad of 1 covers with room to spare; a lobed outline reaches rmax of it from its base, and leaf_variety's size shift (scaleMax, up to ~1.15 of the look's) grows the half-axis by as much (×1 is exact when there is none).
    const leafR = params.leaf_size_m*Math.max(1, 0.7*(hub.grove?.shape?.rmax ?? 0)*(hub.grove?.scaleMax ?? 1));
    let swayMax = Math.hypot(motion.sway[0],motion.sway[1]);   // the furthest any tree's crown has swayed
    if(hub.hier?.nTree > 1){ const T = hub.hier.treeDelta; for(let k=1;k<hub.hier.nTree;k++) swayMax = Math.max(swayMax, Math.hypot(motion.sway[0]+T[4*k], motion.sway[1]+T[4*k+1])); }
    const pad = leafR + params.drift_amount + swayMax + 0.05;
    // tilt_shadow throws a corner from up to a leaf's half-extent above or below its centre's height: the frame takes the heights that far out
    // (shut, the heights the frame always took)
    const tz = params.tilt_shadow > 0 ? leafR : 0;
    if(tz > 0){ hLo -= tz; hHi += tz; }
    let minx,maxx,miny,maxy;
    if(params.receiver){
      // CURTAIN cast frame (spec/model/receivers.md): occluders project onto the VERTICAL cloth (Y=cy), not the floor — the projection is
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
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.faithTex, 0);
    gl.disable(gl.BLEND); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // accumulator starts at 0 (Σ w·T)
    // attach the two persistent targets ONCE: faithTex→bakeFBO (above) and faithScratch→faithFBO (here). The
    // per-sample loop then just binds whichever FBO it wants — no per-sample framebufferTexture2D (2N → 2/bake).
    gl.bindFramebuffer(gl.FRAMEBUFFER, faithFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.faithScratch, 0);

    // static faith-VS uniforms (wind / flutter — match the preview & the layer bake); only uG changes per sample
    const pFaith = faith.pivotOn ? hub.progFaithPivot : progFaith, UF = faith.pivotOn ? U.faithPivot : U.faith;   // leaves on older wood: the pivot weight's specialization
    gl.useProgram(pFaith);
    gl.uniform1i(UF.seasonCast,hub.seasonCast?1:0);
    gl.uniform2f(UF.origin, faith.ox, faith.oy);
    gl.uniform2f(UF.extent, faith.ext, faith.ext);
    gl.uniform1f(UF.edge, params.edge_softness);   // soft leaf rim (same as the layer bake); 0 here = hard ellipses
    gl.uniform1f(UF.beamK, k);                     // the BEAM's neutral depth (spec/model/leaf.md), pre-integrated into the cast like everything else the leaves do to it
    gl.uniform1i(UF.edgeArea, faith.edgeArea);     // ...and so is the edge law: at k = 0 each stamp is the leaf's mixture, not the slab of its mask
    gl.uniform1i(UF.curtainBake, params.receiver ? 1 : 0);   // spec/model/receivers.md: project onto the vertical cloth (curtain) vs the floor
    gl.uniform1f(UF.clothY, params.cloth_distance_m);
    gl.uniform1f(UF.morph, params.drift_phase);
    gl.uniform1f(UF.morphAmount, params.drift_amount);
    gl.uniform1f(UF.windLevel, motion.u);
    gl.uniform1f(UF.air, Math.max(0, params.wind_air)); gl.uniform1f(UF.depth, Math.max(0, params.wind_depth || 0));
    gl.uniform1f(UF.windTime, motion.time);
    gl.uniform1f(UF.leafSwing, params.leaf_swing);
    gl.uniform1f(UF.flutterFreq, params.flutter_freq);
    gl.uniform1f(UF.tiltShadow, clamp(params.tilt_shadow, 0, 1));   // each corner thrown from its own height along the sun (0: the plan footprint)
    gl.uniform2f(UF.sway, motion.sway[0], motion.sway[1]);
    gl.uniform1f(UF.hRef, Math.max(faith.hMax, 1e-3));   // height-scale the coherent sway → base anchored, crown sways (matches the wood)
    bindLeafShape(gl, UF, hub.grove);   // the active grove's outline (unit 6), first, so the unit left active is the cluster geometry's (see bakeLayers)
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hub.clusterTex);     gl.uniform1i(UF.clusterTex, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, hub.clusterGeomTex); gl.uniform1i(UF.clusterGeom, 5);

    // FAITHFUL skeleton (spec/model/canopy.md): refill the instance array with the live limb SWING + whole-tree drift, so the wood
    // sways WITH the leaves; then upload + set its statics once.
    if(woodOn){
      fillSwayedSegs(faith.segRest, faith.segArr, motion.sway[0], motion.sway[1], hub.hier?.nTree > 1 ? hub.hier.treeDelta : null);
      gl.bindBuffer(gl.ARRAY_BUFFER, faith.segBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, faith.segArr);
      gl.useProgram(progFaithSeg);
      gl.uniform2f(U.faithSeg.segSway, 0.0, 0.0);   // the cast's sway is height-scaled and already in the instance data
      gl.uniform1i(U.faithSeg.segTau, 0);           // the cast's scratch is multiplicative: emit transmittance
      gl.uniform2f(U.faithSeg.origin, faith.ox, faith.oy);
      gl.uniform2f(U.faithSeg.extent, faith.ext, faith.ext);
      gl.uniform1f(U.faithSeg.woodTau, params.branch_tau);
      gl.uniform1i(U.faithSeg.curtainBake, params.receiver ? 1 : 0);   // spec/model/receivers.md: cloth vs floor projection (matches the leaves)
      gl.uniform1f(U.faithSeg.clothY, params.cloth_distance_m);
    }

    for(let i=0;i<N;i++){
      // PASS 1: transmittance_i into scratch (clear to 1 = fully lit; each leaf MULTIPLIES it down by exp(-τ))
      gl.bindFramebuffer(gl.FRAMEBUFFER, faithFBO);   // faithScratch (attached once above)
      gl.disable(gl.BLEND); gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.SRC_COLOR);   // dst *= src → Π exp(-τ)
      gl.useProgram(pFaith);
      gl.uniform2f(UF.g, gx[i], gy[i]);
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
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hub.faithScratch); gl.uniform1i(U.facc.tex, 0);
      gl.uniform1f(U.facc.weight, src.flat[3*i+2]);
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // The sky fill itself is makeFill, below; what stays here is the frame it is baked over, because the litter carpet reads its frame from this module whether or not the fill is.
  // THE FRAME the fill is baked over: fillFrame(E, h_max, bulkOn), h_max the tallest layer its rays start from — where the faithful tree's twigs
  // REALLY grew on that path, the park band otherwise. It is a function of the look and not of whether the fill is open, which is what lets the
  // litter carpet (komorebi-litter.js) be baked and read over the very same square: it asks here, so the two cannot disagree about it.
  // refreshLitter asks for it every frame to compare signatures, so it allocates nothing: binH read in place (only the first layer_count are
  // read), and one scratch frame, which callers copy out of and never keep.
  const fillHeights = () => faithfulOn() ? faith.binH : hub.layerHeights();
  const _frame = { ox: 0, oy: 0, ext: 0 };
  function fillFrameNow(H = fillHeights()){
    let hMax = 0;
    for(let i=0;i<params.layer_count;i++) hMax = Math.max(hMax, H[i]);
    return fillFrame(params.canopy_extent_m, hMax, hub.bulkOn(), _frame);
  }

  // Once per frame, before transport draws: the faithful cast carries the beam's k pre-integrated (spec/model/leaf.md), so unlike the layer
  // path — which reads k at the tap — it must be re-cast when leaf_diffuse moves without anything else having baked: a
  // tween, a slider. Under wind the bake runs every frame anyway and has already recorded the current k.
  // edge_area is baked into the cast the same way (each stamp's law at k = 0), so flipping it re-casts too; a live toggle rebuilds nothing else.
  // The same goes for the sample count: it is what the cast is made of, and resetPerf (after rebuildAll's bake) or the governor can
  // re-cut the cloud to a count the bake did not see — the old look's, or a trimmed one — with no bake-res change to re-bake it.
  // The numeric snapshot also checks the source shape, sun, cloth plane and leaf-bake uniforms: still air does not make those inputs static.
  function refreshFaith(){
    const woodChanged=hub.refreshWood();
    if(faithfulOn()){
      if(woodChanged || faith.branchTau!==params.branch_tau || faith.k !== (FEAT_LEAF_DIFFUSE ? ballisticK(params.leaf_diffuse) : 0) || faith.n !== src.count || faith.edgeArea !== edgeAreaOn(params) || !faithfulInputsMatch(false)) bakeFaithful();
    }else if(hub.trans.riseField?.weight!==1 && (
      params.edge_softness!==layerEdge || params.drift_amount!==layerDrift || layerPhaseNow()!==layerPhase
      || params.sky_view && (woodChanged || sky.branchTau!==params.branch_tau)
    )) bake();   // The lighting through the old layers must follow the new cast as well.
  }

  return { bake, bakeLayers, bakeFaithful, refreshFaith, fillFrameNow };
}

// ============================================================================
// The sky fill as a factory of its own (spec/model/fill.md): a bundle whose looks never open canopy_fill leaves it out whole (embed-build.mjs, FEATURES.fill), so the engine
// builds it as `FEAT_FILL ? makeFill(hub) : NO_FILL` and reaches it only through the hub. NO_FILL is what the engine holds instead: a fill that is never wanted.
// ============================================================================
export function makeFill(hub){
  const { gl, params, fill, fillFBO, emptyVAO, bakeRes, faithfulOn, faith } = hub;

  // ---- THE SKY FILL (spec/model/fill.md, "What the shade is lit by"). The floor is lit by the beam through the gaps, by the
  // skylight that ALSO had to come through the canopy, and by sunlight the lit leaves scatter downward; the cast
  // filtered only the first. This bakes the other two: Tsky(x) and S(x), the cosine-weighted hemisphere of the layer
  // field, into two low-res textures (komorebi-shaders.js, FS_FILL, runs the very ray the sky view runs). Off (canopy_fill
  // 0, or a camera with no surface to light) nothing is allocated and nothing runs.
  // TWO THINGS KEEP ITS BOOKS CLOSED. ONE SUN PER CAMERA: the sun a leaf is lit by is the BEAM's path (the bulk shift, none in
  // the endless park), because the light the fill hands out is the light the beam gave up. And THE BOX IS NOT THE WORLD: the
  // endless park (no bulk shift) repeats its box, a finite tree has open sky outside it and is baked over a frame padded to
  // hold the glow that spreads past the box (fillFrame). One question — hub.bulkOn() — answers both.
  // ============================================================================
  // Does this look need the fill? The registry answers: a camera that does not speak the fill group cannot read it.
  const fillWanted = () => params.canopy_fill > 0 && CAMERAS[cameraFor(params)].groups.includes('fill');
  const fillK = () => clamp(params.fill_directions|0, 1, MAX_FILL_DIRS);
  const fillRes = () => clamp(params.fill_resolution|0, 32, 1024);
  // The faithful path's layers are 1×1 (it taps one pre-integrated texture), so with the fill open it keeps a LOW-RES
  // set alive for the fill to read. Depth layers are the right tool for a DIFFUSE quantity — the opt-out from the
  // layer cheat is about sharp structure — so this does not reopen it. Sized by the fill, capped by the bake size.
  const fillLayerRes = () => Math.min(fillRes(), bakeRes());
  // Only the floor reads S (the cloth and the tent take Tsky alone), so the others are handed albedo 0 and the
  // scatter branch is skipped in the shader outright.
  const fillAlbedo = () => CAMERAS[cameraFor(params)].groups.includes('floor') ? clamp(params.fill_scatter, 0, 1) : 0;
  const _atm = { sun:[0,0,0], ambient:[0,0,0] }, FILL_TURNS = fillTurns();   // the 16 slot rotations never change
  const _sig = new Float64Array(FILL_SIG_LEN);


  // Everything the fill depends on besides the layers themselves (which rebake it eagerly, from bake()). The sun can
  // move without any bake — a time-of-day morph, the editor's sun drag — and S reads the sun's colour and its path
  // through the layers (never the skylight: Tsky is a transmittance and S is sun-scatter alone), so a draw compares
  // this against what the fill was baked with and re-runs just the pass. (The layer path reprojects the cast per
  // frame for the same reason; the fill has to follow it.)
  function fillSig(o){
    o[0]=params.sun_elevation_deg; o[1]=params.sun_azimuth_deg; o[2]=params.sky_turbidity;
    o[3]=fillAlbedo(); o[4]=fillK(); o[5]=fillRes(); o[6]=params.layer_count; o[7]=params.canopy_base_height_m;
    o[8]=params.canopy_thickness_m; o[9]=params.canopy_extent_m; o[10]=faithfulOn() ? 1 : 0;
    o[11]=FEAT_LEAF_DIFFUSE ? ballisticK(params.leaf_diffuse) : 0;   // the split changes what S is made of, and no bake moves when it tweens
    o[12]=hub.bulkOn() ? 1 : 0;              // wrap vs open + padded frame (the beam's bulk shift itself rides the sun elevation and azimuth above)
    o[13]=edgeAreaOn(params);                // the edge law changes what Tsky and S are made of, and no bake moves when it flips live
    o[14]=params.sun_cosine;                 // S is the leaves' scattered sun and the cosine law scales it, and no bake moves when it tweens
    o[15]=params.sun_extinction;             // ...and so does the air's loss (the turbidity it depends on is o[2])
    o[16]=hub.bulkOn() ? 0 : params.park_throw;   // the park's shear moves the beam's path the fill bakes along (a standing scene's is the sun's alone)
    // the ground the undersides return (S holds ground_bounce·B): its level, and what the ground's light is made of — the floor's albedo, the
    // carpet (a new one per regrow), the open sky. Each 0 while the bounce is shut, so a look without it never re-bakes on them.
    const gb = bounceOn();
    o[17]=gb;
    o[18]=gb > 0 ? params.ground_r : 0; o[19]=gb > 0 ? params.ground_g : 0; o[20]=gb > 0 ? params.ground_b : 0;
    o[21]=gb > 0 ? params.ambient_skylight : 0;
    o[22]=gb > 0 && hub.litter.ready ? hub.litter.passes : -1;
  }
  // ---- THE GROUND, RETURNED BY THE UNDERSIDES (spec model/fill.md; the law in komorebi-fill.js, the passes in komorebi-shaders.js). With
  // ground_bounce up the bake runs three passes before the fill's own: G, the ground's light (half the fill's resolution); W, what each layer's
  // undersides send down (a quarter, one array slice per layer, one MRT target each); B, what reaches the floor (half). The fill pass adds
  // ground_bounce·B to S, so every surface that reads S takes it at S's own share and no camera binds another texture. Allocated when the
  // gate opens, freed when it shuts.
  const bounceOn = () => (params.ground_bounce > 0 ? clamp(params.ground_bounce, 0, 1) : 0);
  const bounceSizes = (res) => ({ g: Math.max(res >> 1, 16), w: Math.max(res >> 2, 8), b: Math.max(res >> 1, 16) });
  function texParams(target, filter){
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function allocBounce(res){
    releaseBounce();
    const n = bounceSizes(res), W = gl.createTexture(), slab = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, W);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA16F, n.w, n.w, MAX_LAYERS, 0, gl.RGBA, gl.HALF_FLOAT, null);
    texParams(gl.TEXTURE_2D_ARRAY, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, slab);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, SLAB_N, 3, 0, gl.RGBA, gl.FLOAT, slabTable(SLAB_N));
    texParams(gl.TEXTURE_2D, gl.LINEAR);
    fill.bounce = { G: hub.makeLayerTexture(n.g), W, B: hub.makeLayerTexture(n.b), slab, fbo: gl.createFramebuffer(), res, n };
  }
  function releaseBounce(){
    const b = fill.bounce;
    if(!b) return;
    gl.deleteFramebuffer(b.fbo);   // first: a texture still attached to a framebuffer is not freed
    for(const t of [b.G, b.W, b.B, b.slab]) gl.deleteTexture(t);
    fill.bounce = null; fill.gb = 0;
  }
  // The uniforms all three passes share: the layers, the frame, the rays, how a layer is read.
  function bounceCommon(e, c){
    gl.useProgram(e.prog);
    gl.uniform2f(e.origin, -c.E/2, -c.E/2); gl.uniform2f(e.extent, c.E, c.E);
    gl.uniform2f(e.frameOrigin, c.fr.ox, c.fr.oy); gl.uniform2f(e.frameExtent, c.fr.ext, c.fr.ext);
    gl.uniform3f(e.sun, c.sun[0], c.sun[1], c.sun[2]); gl.uniform3f(e.ambient, c.amb[0], c.amb[1], c.amb[2]);
    gl.uniform1fv(e.heights, c.H); gl.uniform1i(e.layerCount, params.layer_count);
    gl.uniform1i(e.open, c.wrap ? 0 : 1); gl.uniform1f(e.beamK, c.beamK); gl.uniform1i(e.edgeArea, edgeAreaOn(params));
    gl.uniform3fv(e.ray, fill.rays); gl.uniform2fv(e.turn, FILL_TURNS); gl.uniform1i(e.count, c.K);
    for(let i=0;i<MAX_LAYERS;i++){ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, hub.layerTex[i]); gl.uniform1i(e.layers[i], i); }
  }
  function bakeBounce(c){
    const b = fill.bounce, e = hub.bounceFor(), wrapMode = c.wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE, L = hub.litter;
    for(const [target, t] of [[gl.TEXTURE_2D, b.G], [gl.TEXTURE_2D_ARRAY, b.W], [gl.TEXTURE_2D, b.B]]){   // the park repeats all three, as it repeats the fill
      gl.bindTexture(target, t); gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapMode); gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrapMode);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
    gl.bindVertexArray(emptyVAO);
    const target = (n, ...tex) => {   // attach this pass's targets, and nothing of the last pass's: a texture this pass samples must not be one it draws into
      for(let i=0;i<MAX_LAYERS;i++){
        if(i >= tex.length) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+i, gl.TEXTURE_2D, null, 0);
        else if(tex[i].layer == null) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+i, gl.TEXTURE_2D, tex[i].t, 0);
        else gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0+i, tex[i].t, 0, tex[i].layer);
      }
      gl.drawBuffers(tex.map((_, i) => gl.COLOR_ATTACHMENT0+i));
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) hub.fail("the ground bounce's float targets are incomplete");
      gl.viewport(0, 0, n, n);
    };
    // G: the ground's light. Unit 8 the carpet (the floor's own unit for it)
    target(b.n.g, { t: b.G });
    bounceCommon(e.g, c);
    gl.uniform2f(e.g.sunPath, c.g[0], c.g[1]);
    gl.uniform3f(e.g.ground, params.ground_r, params.ground_g, params.ground_b);
    gl.uniform1i(e.g.litterOn, L.ready ? 1 : 0);
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, L.tex); gl.uniform1i(e.g.litter, 8);
    gl.uniform2f(e.g.litterOrigin, L.ox, L.oy); gl.uniform2f(e.g.litterExtent, L.ext, L.ext);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // W: the undersides, one array slice per layer. Unit 9 G, 10 the slab
    target(b.n.w, { t: b.W, layer: 0 }, { t: b.W, layer: 1 }, { t: b.W, layer: 2 }, { t: b.W, layer: 3 });
    bounceCommon(e.up, c);
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, b.G); gl.uniform1i(e.up.groundTex, 9);
    gl.activeTexture(gl.TEXTURE10); gl.bindTexture(gl.TEXTURE_2D, b.slab); gl.uniform1i(e.up.slab, 10);
    gl.uniform3f(e.up.openGround, params.ground_r*(c.sun[0] + c.amb[0]), params.ground_g*(c.sun[1] + c.amb[1]), params.ground_b*(c.sun[2] + c.amb[2]));   // past a finite tree's frame: open ground, no carpet
    gl.uniform1f(e.up.f0, SLAB.f0);
    gl.uniform1f(e.up.cell, c.fr.ext/b.n.w);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // B: down to the floor. Unit 11 W
    target(b.n.b, { t: b.B });
    bounceCommon(e.b, c);
    gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D_ARRAY, b.W); gl.uniform1i(e.b.under, 11);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE11); gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }

  function fillStale(){
    if(!fill.ready) return true;
    fillSig(_sig);
    for(let i=0;i<_sig.length;i++) if(_sig[i] !== fill.sig[i]) return true;
    return false;
  }

  function allocFill(res){
    for(const t of fill.tex) if(t) gl.deleteTexture(t);
    fill.tex = [hub.makeLayerTexture(res), hub.makeLayerTexture(res)];
    for(const t of fill.tex){ gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }   // the receiver reads a mip level (GLSL_T_FILL_DECLS says why)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fillFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fill.tex[0], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, fill.tex[1], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);   // MRT: Tsky and S in one pass, so the K·L layer taps are read once
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) hub.fail("the sky fill's float targets are incomplete");
    fill.res = res; fill.ready = false;
  }

  // The layer textures are bound to units 0.. (bakeFill binds them): set the wrap of the active ones.
  function setLayerWrap(n, mode){
    for(let i=0;i<n;i++){
      gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, hub.layerTex[i]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
    }
  }

  // layersToo: bake the low-res layer set first (faithful path only — the layer path's own bake just ran, or is
  // current). Called eagerly from bake(), and from refreshFill when something the layers do not carry moved.
  function bakeFill(layersToo){
    const res = fillRes(), K = fillK(), E = params.canopy_extent_m, faithful = faithfulOn();
    if(!fill.tex[0] || fill.res !== res) allocFill(res);
    let H;
    if(faithful){
      const lres = fillLayerRes();
      if(hub.layerSize !== lres){ hub.allocLayers(lres); layersToo = true; }   // the fill was opened on a running faithful look: its layers do not exist yet
      if(layersToo) hub.bakeLayers(lres, faith.binH, true);
      H = faith.binH.subarray(0, MAX_LAYERS);   // where the faithful tree's twigs REALLY grew, not the park band
    } else H = hub.layerHeights();
    // THE FRAME this pass covers, and what the layer textures do outside their box. Both follow one flag: a finite tree (bulkOn) is
    // open sky past its box and is baked over the box padded by 3·h_max; the endless park has no edge, so its box REPEATS and the
    // frame is the box. The fill flips the wrap for this pass and puts CLAMP back; transport sets its own on every draw (komorebi-render.js:
    // REPEAT for the endless park, CLAMP for a finite tree and the sky view).
    const bulk = hub.bulkOn(), wrap = !bulk, nL = params.layer_count;
    // The receiver samples these outside the box too: its shade lighting must repeat with the endless canopy.
    for(const t of fill.tex){
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    }
    const fr = hub.fillFrameNow(H);
    fill.ox = fr.ox; fill.oy = fr.oy; fill.ext = fr.ext;   // what every receiver reads the textures by
    const e = hub.fillFor(), u = e.U;
    gl.disable(gl.BLEND);
    atmosphere(_atm, params.sun_elevation_deg, params.sky_turbidity, params.ambient_skylight);   // the same atmosphere transport lights the frame with
    if(fill.K !== K){ fill.rays = fillRays(K); fill.K = K; }   // cached: the plain set is a function of K alone (each texel rotates it itself)
    // The leaves are near-horizontal (max_tilt), so the sunlight they take is the floor's cosine whatever surface reads S: the beam the leaves remove (scaled at transport) and the S they send down
    // (scaled here) then stay one split of one energy. T_sky is the skylight and keeps its level. GLSL_SKY_RAY is untouched — its input is scaled — so fill.test.js's reference still applies.
    const sunIrr = lerp(1, sunIncidence('floor', params.sun_elevation_deg, params.sun_azimuth_deg), clamp(params.sun_cosine, 0, 1))*beamLoss('floor', params);   // held to 0..1 like the upload that scales the beam (komorebi-render.js), or the two halves of the split would disagree past 1
    const gb = bounceOn();
    if(gb > 0){   // the ground returned by the undersides, baked first: the fill pass adds it to S. The ground is lit by the same sun the leaves are (the floor's cosine)
      if(!fill.bounce || fill.bounce.res !== res) allocBounce(res);
      if(wrap) setLayerWrap(nL, gl.REPEAT);
      bakeBounce({ E, fr, H, K, wrap, g: hub.bulkShift(), sun: _atm.sun.map((v) => v*sunIrr), amb: _atm.ambient, beamK: FEAT_LEAF_DIFFUSE ? ballisticK(params.leaf_diffuse) : 0 });
      if(wrap) setLayerWrap(nL, gl.CLAMP_TO_EDGE);
    } else if(fill.bounce) releaseBounce();
    fill.gb = gb;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fillFBO);
    gl.viewport(0,0,res,res);
    gl.useProgram(e.prog);
    gl.uniform2f(u.origin, -E/2, -E/2);
    gl.uniform2f(u.extent, E, E);
    gl.uniform2f(u.frameOrigin, fr.ox, fr.oy);
    gl.uniform2f(u.frameExtent, fr.ext, fr.ext);
    const g = hub.bulkShift();
    gl.uniform2f(u.sunPath, g[0], g[1]);                   // ONE SUN PER CAMERA: the beam's path, not the sun's direction
    gl.uniform1i(u.open, wrap ? 0 : 1);
    gl.uniform3f(u.sun, _atm.sun[0]*sunIrr, _atm.sun[1]*sunIrr, _atm.sun[2]*sunIrr);
    gl.uniform1fv(u.heights, H);
    gl.uniform1i(u.layerCount, params.layer_count);
    gl.uniform3fv(u.ray, fill.rays);
    gl.uniform2fv(u.turn, FILL_TURNS);
    gl.uniform1i(u.count, K);
    gl.uniform1f(u.scatter, fillAlbedo());
    gl.uniform1f(u.beamK, FEAT_LEAF_DIFFUSE ? ballisticK(params.leaf_diffuse) : 0);   // above 0 the albedo is off and every surface camera reads S (the shader says so)
    gl.uniform1i(u.edgeArea, edgeAreaOn(params));                                      // at k = 0 the rays read each texel as its mixture (spec/model/leaf.md)
    gl.uniform1f(u.groundBounce, gb);
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, gb > 0 ? fill.bounce.B : null); gl.uniform1i(u.bounce, 12);
    for(let i=0;i<MAX_LAYERS;i++){ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, hub.layerTex[i]); gl.uniform1i(u.layers[i], i); }
    if(wrap) setLayerWrap(nL, gl.REPEAT);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if(wrap) setLayerWrap(nL, gl.CLAMP_TO_EDGE);           // put back: every other reader of these textures clamps, and canopy_fill 0 must stay the bytes it was
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for(const t of fill.tex){ gl.bindTexture(gl.TEXTURE_2D, t); gl.generateMipmap(gl.TEXTURE_2D); }   // RGBA16F is renderable and filterable, which is all generateMipmap asks
    fillSig(fill.sig);
    fill.ready = true;
  }

  // Free what a shut gate no longer needs: the look pays nothing for a fill it has switched off.
  function releaseFill(){
    // detach first: a delete frees a texture only once nothing holds it, and it detaches only from the BOUND framebuffer — fillFBO is not
    // bound here, so its two attachments would keep both mip chains resident until the fill reopened
    gl.bindFramebuffer(gl.FRAMEBUFFER, fillFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for(const t of fill.tex) if(t) gl.deleteTexture(t);
    fill.tex = [null, null]; fill.res = 0; fill.ready = false;
    releaseBounce();
    if(faithfulOn() && hub.layerSize > 1) hub.allocLayers(1);   // the faithful layers go back to the 1×1 they are without the fill
  }

  // Once per frame, before transport draws: the fill is current, or it is not wanted and holds nothing.
  function refreshFill(){
    if(!fillWanted()){ if(fill.tex[0]) releaseFill(); return; }
    if(fillStale()) bakeFill(false);
  }

  return { bakeFill, refreshFill, fillWanted, fillLayerRes };
}

export const NO_FILL = { bakeFill: () => {}, refreshFill: () => {}, fillWanted: () => false, fillLayerRes: () => 1 };
