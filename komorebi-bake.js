// ============================================================================
// The bake (spec §4.5) — the per-frame snapshot of the moving canopy in the
// form transport reads fast: leaves stamped as per-layer optical depth
// (additive, order-independent), and the FAITHFUL path's per-sample geometry
// bake into one pre-integrated soft-shadow texture (the opt-out from the
// depth-layer cheat). fillSwayedSegs is the swayed skeleton both bakes share.
// A factory over the engine's shared internals (hub).
// ============================================================================
import { clamp } from './komorebi-math.js';

export function makeBake(hub){
  const { gl, params, motion, src, faith, sky, U, bakeFBO, faithFBO, emptyVAO, progBake, progFaith, progFaithSeg, progFAcc, bakeRes, faithfulOn } = hub;

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
    const baking = hub.groveIn ? [[hub.grove, 1-hub.crossW], [hub.groveIn, hub.crossW]] : [[hub.grove, 1]];
    gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);
    gl.viewport(0,0,res,res);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);          // optical depth accumulates additively
    const H=hub.layerHeights(), base=params.canopy_base_height_m;
    // ALPHA IS THE WOOD'S CHANNEL IN SKY MODE (§4.9). The layer texture's rgb is the foliage's per-channel optical
    // depth and its alpha has never been read by anything — tap/tapUp/tapCA and the debug blit all take .rgb — so the
    // look-up camera claims it for the skeleton, and the leaves must stop writing their coverage there or the two
    // would sum into one meaningless number. A colour mask does it without touching the leaf shader, which keeps
    // every other look's bake bit-for-bit what it was.
    for(let l=0;l<params.layer_count;l++){
      // higher layers ride longer levers -> sway more when height gain > 0 (else pure translation)
      const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
      gl.uniform2f(U.bake.sway, motion.sway[0]*f, motion.sway[1]*f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.layerTex[l], 0);
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
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.layerTex[l], 0);
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
    const la = hub.hier ? hub.hier.limbAngle : null, ta = hub.hier ? hub.hier.twigAngle : null;
    const lat = hub.hier ? hub.hier.limbAttach : null;   // per-limb attach height: where the sway_pitch foreshorten is anchored (§5.1)
    const lp = hub.hier ? hub.hier.limbPitch : null;     // per-limb pitch DOF: the angle the foreshorten is taken from (§5.1)
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
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.faithTex, 0);
    gl.disable(gl.BLEND); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // accumulator starts at 0 (Σ w·T)
    // attach the two persistent targets ONCE: faithTex→bakeFBO (above) and faithScratch→faithFBO (here). The
    // per-sample loop then just binds whichever FBO it wants — no per-sample framebufferTexture2D (2N → 2/bake).
    gl.bindFramebuffer(gl.FRAMEBUFFER, faithFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hub.faithScratch, 0);

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
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hub.clusterTex);     gl.uniform1i(U.faith.clusterTex, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, hub.clusterGeomTex); gl.uniform1i(U.faith.clusterGeom, 5);

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
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hub.faithScratch); gl.uniform1i(U.facc.tex, 0);
      gl.uniform1f(U.facc.weight, src.flat[3*i+2]);
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  return { bake, bakeFaithful };
}
