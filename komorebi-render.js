// ============================================================================
// The render half (spec §4.6/§4.7/§9) — one frame onto a target: the transport
// draw with its per-group uniform upload (GROUP_UPLOAD, the upload half of the
// camera registry), the lateral-diffusion glow tier, and the layer-debug blit.
// A factory over the engine's shared internals (hub).
// ============================================================================
import { DEG, atmosphere, clamp, smoothstep } from './komorebi-math.js';
import { MAX_LAYERS } from './komorebi-params.js';
import { CAMERAS, GROUP_UPLOAD_KEYS } from './komorebi-transport.js';

export function makeRender(hub){
  const { gl, canvas, params, perf, motion, src, occ, occTex, faith, U, emptyVAO, progBlit, progGlowBlur, progGlowMix, faithfulOn, transportFor, transportCamera, fail } = hub;

  const glowFBO=[null,null,null], glowTex=[null,null,null];
  let glowW=0, glowH=0, glowFail=false;   // glowFail LATCHES an incomplete FBO: the tier then silently stops being offered (perf.glow stays false) and every frame takes the direct path
  const GLOW_TAPS = 6;                    // 13 taps: centre + this many each side. NOT independently tunable — FS_GLOW_BLUR's weight table is computed for exactly this count; change one and recompute the other
  const GLOW_STEP_MAX = 6.0;              // px between taps — the cap that trades reach for a clean kernel (see FS_GLOW_BLUR)
  // per-frame scratch for the atmosphere's two colour vectors (§3.5), recomputed fresh each call so a static
  // frame allocates nothing (no stale-cache risk: the sun-drag path mutates params without an apply(), which
  // a dirty-flag cache would miss; the recompute itself is sub-microsecond).
  const _atm = { sun:[0,0,0], ambient:[0,0,0] };

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

  function drawTransportPresent(){ drawFrameInto(hub.presentFBO, hub.presentW, hub.presentH); }             // adaptive frame-rate: to the offscreen frame

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
      gl.uniform1fv(u.heights, hub.layerHeights());
      gl.uniform1i(u.layerCount, params.layer_count);
      for(let i=0;i<MAX_LAYERS;i++){ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, hub.layerTex[i]); gl.uniform1i(u.layers[i], i); }
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
      const buf = occ.segBuf, la = hub.hier ? hub.hier.limbAngle : null;
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
      gl.uniformMatrix2fv(u.proj, false, hub.projMatrix());
      // standing-scene bulk shadow offset (§4.8): cast the shadow to the SIDE by cot(elev) per unit height (the
      // park model omits this — fine for an infinite canopy, wrong for a standing tree). Applied to EVERY occluder
      // (trunk, branches, leaves) via g, so the whole tree shadow stays one connected thing and sweeps together as
      // the sun moves — real physics, no camera tricks. Framing the tree off-frame is the camera's job (a fixed
      // pan, view_center), NOT an auto-centre on the crown (that decouples trunk from crown). Gated → 0 = park.
      const b = hub.bulkShift(); gl.uniform2f(u.bulkShift, b[0], b[1]);   // shared helper (matches the faithful bake; 0 when off)
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
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, hub.faithTex); gl.uniform1i(u.faithTex, 4);   // unit 4 free in transport (layers use 0-3)
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
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, hub.layerTex[idx]);
    gl.uniform1i(U.blit.tex,0);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  return { drawFrameInto, drawTransport, drawTransportPresent, drawDiffusion, freeGlowTargets, drawLayerBlit, glowFBO };
}
