import { MAX_SAMPLES, MAX_LAYERS, MAX_OCC } from './komorebi-params.js';
import { GLSL_TONE_TAIL } from './komorebi-shaders.js';

// ============================================================================
// THE TRANSPORT MASTER (spec §4.6 / §4.9) — ONE source, FOUR straight-line programs.
//
// Transport answers one question — how much of the source reached this point, and what does the surface it
// reached do with it — for four different cameras: the floor ray-cast, the cloth seen head-on, the enclosure
// polytope ray-cast from inside, and the sky view looking up. Those four used to be `if(uSkyView)/(uReceiver)`
// chains inside a single mega-shader, which meant every frame carried the uniform footprint and the branch
// weight of all four at once: 246 vec4 rows against WebGL2's guaranteed 224, and a fabric-family upload on
// every park frame.
//
// A camera is not a runtime decision. It is a MODE flag (MODE_KEYS), so it can only change through a full
// structural rebuild — which makes it a COMPILE-TIME selection. Below, the master is a set of named snippets,
// each carrying its own uniform declarations, and buildTransport(camera) emits the ones that camera actually
// runs. The branches do not get rewritten; they disappear by OMISSION, so within a variant every emitted line
// is the line the mega-shader ran. `uSkyView` and `uReceiver` do not survive into any variant at all: the
// branch they selected IS the build key.
// ============================================================================

// ---- the frame head, and the state EVERY camera reads: where the pixel is, where the canopy box is,
// what colour the light is, and the baked layers themselves. ----
const GLSL_T_HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform float uAspect;
uniform vec2  uViewCenter;        // camera PAN: world point the screen centre looks at (0 = frame centre). Lets you walk the view around the floor.
uniform vec2  uCanopyOrigin;
uniform vec2  uCanopyExtent;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform highp sampler2D uLayer[${MAX_LAYERS}];   // highp: optical depth exceeds lowp's ~[-2,2]
uniform float uLayerHeight[${MAX_LAYERS}];
uniform int   uLayerCount;`;

// ---- the three RAY cameras (floor, enclosure, sky) build a direction from pitch/fov and spin it by yaw.
// The cloth is seen head-on and builds no ray at all, so it declares none of them. ----
const GLSL_T_RAY_VIEW = `uniform float uPitch;            // camera tilt from straight-down (rad); 0 = top-down (reduces to the old ortho map)
uniform float uFov;              // vertical full FOV (rad) — perspective strength / lens
uniform float uViewYaw;          // camera orbit about vertical (rad); rotates the sampled floor about frame centre. 0 = unchanged`;

// ---- the layer read every CAST camera makes (floor, cloth, enclosure): optical depth -> transmittance. ----
const GLSL_T_TAP = `vec3 tap(highp sampler2D t, vec2 world){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  return exp(-texture(t,uv).rgb);   // optical depth -> transmittance
}`;

// ---- THE SOURCE SAMPLES and the per-unit-height ground shift: the many-suns integral of §4.2/§4.6. The sky
// view is the one camera that never runs it — it reads the field along the EYE's rays, not the sun's — and
// dropping this block is most of why that variant costs 88 fewer uniform rows than the floor. ----
const GLSL_T_TRANSPORT_DECLS = `#define MAX_SAMPLES ${MAX_SAMPLES}
uniform vec3  uSamples[MAX_SAMPLES];   // xy = angular offset (rad), z = weight (sum=1)
uniform int   uSampleCount;
uniform mat2  uProj;                    // angular->ground per unit height (ellipse + shear)
uniform vec2  uBulkShift;               // STANDING SCENE (§4.8): bulk lateral shadow offset per unit height = cot(elev)·(anti-sun dir).
                                        // The park model omits this (shadows sit directly under the canopy, only stretched) — invisible for
                                        // an infinite canopy, but a discrete tree needs its shadow CAST to the side. 0 = park model, unchanged.`;

// ---- the woody occluder's segment table. Read by all four cameras: three cast it as a shadow, the sky view
// reads the very same segments as GEOMETRY (§4.9). 128 vec4 rows — the single biggest item in every
// variant's footprint, and the reason none of them gets small. ----
const GLSL_T_OCC_DECLS = `// WOODY OCCLUDER (spec §4.5): the trunk + main limbs as CONTINUOUS-height analytic segments. Each carries its two
// endpoints' plan positions and their HEIGHTS above the floor; the per-sample shadow runs from a's projection to b's,
// so a limb's base meets the trunk at a shared height and the whole skeleton shadow stays CONNECTED — unlike the
// layer-stamped branches (now retired), whose discrete-height quantization shattered continuous lines at a low sun.
// THE TABLE IS DATA, NOT UNIFORMS. Two vec4[${MAX_OCC}] arrays would be ${MAX_OCC * 2} vec4 rows of the fragment budget in EVERY
// variant — the segment table was over half of WebGL2's guaranteed 224 all by itself, and it is what kept the
// enclosure over that floor. It is one RGBA32F texture instead: row 0 = the plan endpoints (refilled per frame with
// the limb swing), row 1 = the static heights + radius. texelFetch on RGBA32F is exact — no filtering, no format
// conversion — so the shader reads the identical float32s the uniform upload used to carry, and the cap becomes a
// number the budget no longer has an opinion about.
uniform highp sampler2D uOccTex;     // (k,0) = plan endpoints a.xy, b.xy;  (k,1) = a-height, b-height (above floor), radius, _
uniform int   uOccCount;             // 0 = off (no wood / park model), byte-identical
uniform float uOccTau;               // wood optical depth (= branch_tau); 0 = off
uniform vec2  uOccSway;              // whole-tree drift, matching the leaf bake
uniform float uOccHRef;              // reference height: the drift scales by H/uOccHRef so the trunk FOOT (H=0) stays planted and the crown sways — matches the faithful wood, not a bodily slide`;

const GLSL_T_WOOD_CAST_DECLS = `uniform float uOccPenumbra;          // soft-edge growth per unit height (fakes the area-light penumbra for the once-per-pixel eval)`;

// ---- leaf-edge diffraction (§3.6), a per-channel re-read of the same layers. Cast cameras only. ----
const GLSL_T_CA_DECLS = `uniform vec3  uChroma;            // per-channel diffraction spread of the transport shift (θ∝λ); (1,1,1) = off
// edge diffraction (spec §3.6): light bends round each leaf edge by an angle ∝ λ, so red spreads wider than
// blue — each channel reads its sun-image at a shift scaled by its own wavelength (cs = per-channel scale,
// green=1). The colour fringe lands at every leaf/dapple edge and rides the same H*g shift, so it grows with
// canopy height and the low-sun ellipse for free. Three single-channel taps; only taken when diffraction is on.
vec3 tapCA(highp sampler2D t, vec2 world, vec2 g, float H, vec3 cs){
  float aR = texture(t, (world + H*g*cs.r - uCanopyOrigin)/uCanopyExtent).r;
  float aG = texture(t, (world + H*g*cs.g - uCanopyOrigin)/uCanopyExtent).g;
  float aB = texture(t, (world + H*g*cs.b - uCanopyOrigin)/uCanopyExtent).b;
  return exp(-vec3(aR,aG,aB));      // per-channel optical depth -> transmittance, each at its dispersed path
}`;

// ---- the FAITHFUL tap (§4.5): one pre-integrated texture instead of the sample loop. Floor and cloth only —
// the pre-bake needs ONE flat cast frame, which the enclosure's panels and the sky view's rays are not. That
// used to be a runtime guard inside the mega-shader; here those two variants simply do not carry it. ----
const GLSL_T_FAITH_DECLS = `// FAITHFUL path (spec §4.5): the opt-out from the depth-layer leaf cheat. uFaithTex is the per-sample bake's
// pre-integrated soft shadow (transmittance), in the CAST frame (covers where the shadow lands, offset by the bulk
// throw). uFaithful 0 = the layer loop below runs, byte-identical (park / overhead default).
uniform highp sampler2D uFaithTex;
uniform int   uFaithful;
uniform vec2  uFaithOrigin;
uniform vec2  uFaithExtent;
vec3 tapFaith(vec2 world){ return texture(uFaithTex, (world-uFaithOrigin)/uFaithExtent).rgb; }   // already transmittance (pre-integrated over the disk), no exp`;

// ---- the raw unit sun vector. The floor never needs it (its throw rides uProj/uBulkShift); the fabric's fold
// incidence, the enclosure's per-panel beam and the sky view's seen source all do. ----
const GLSL_T_SUN_DIR_DECLS = `uniform vec3  uSunDir;            // UNIT sun direction (cos el·cos az, cos el·sin az, sin el) — the fold flanks' incidence basis (§4.9); NOT a 1/sin E throw`;

// ---- the tail every variant shares: the mesopic shift, the distance haze, and the Look (§4.7). ----
const GLSL_T_POST_DECLS = `uniform float uTwilight;          // global "sun is low" rod weight (from elevation, §3.5)
uniform float uMesopic;           // Purkinje strength (the mesopic_strength knob)
uniform vec3  uHazeColor;        // linear-HDR distance haze the far floor dissolves into (§4.7)
uniform int   uLinearOut;         // 0 = end the Look here and write display-encoded colour (every look, unchanged). 1 = write LINEAR HDR
                                  // instead: the lateral-diffusion tier (§4.9) must spread light BEFORE the curve, so it runs toneTail itself after the blur.
${GLSL_TONE_TAIL}`;

// ---- FLOOR camera (§4.7) ----
const GLSL_T_FLOOR_DECLS = `uniform float uViewExtent;
uniform float uFarSmear;         // far-field dapple smear (m of extra throw per unit foreshortening, §4.7)
uniform vec3  uGround;            // ground albedo (floor reflectance); (1,1,1) = white floor (old look)`;

const GLSL_T_FLOOR_CAMERA = `    // ---- tilted pinhole camera (spec §4.7): fragment -> ground point on z=0, plus a far-field haze factor.
    // At uPitch=0 this reduces EXACTLY to the old orthographic map (vUv-0.5)*uViewExtent*[aspect,1] for any
    // fov (a flat plane seen straight-on is linear), so presets are untouched until tilted. ----
    float cp=cos(uPitch), sp=sin(uPitch);
    float kf=max(tan(0.5*uFov), 1e-4);                 // image-plane half-extent (guard fov->0)
    float sxc=(vUv.x-0.5)*uAspect, tyc=(vUv.y-0.5);
    vec3 d = vec3(2.0*kf*sxc, 2.0*kf*tyc*cp + sp, 2.0*kf*tyc*sp - cp);   // ray = fwd + 2k*(sx*right + ty*up)
    // camera height is degenerate for a flat floor (it only scales the view, which the uViewExtent hold
    // below cancels exactly), so it's fixed at 1 rather than exposed — eye height would have no effect.
    float scale = uViewExtent*cp*cp / max(2.0*kf, 1e-4);               // hold the on-axis vertical span = uViewExtent
    float targetY = sp/max(cp,1e-4);                                    // recenter: screen centre -> world (0,0)
    // far-field smear (spec §4.7): under a tilted gaze a pixel covers a growing patch of ground toward the
    // horizon; point-sampling it aliases the dapple, so we widen the soft-shadow throw by that ground footprint.
    // det(dworld/dvUv) = uViewExtent^2 * cp^4 * aspect / D^3 with D=-d.z, so the footprint's linear size goes as
    // 1/D^1.5; referenced to the nearest row (D_ref=cp+kf*sp) it is exactly 0 at pitch 0 (uniform footprint, so
    // top-down presets are untouched) and grows toward the horizon. Reusing uProj's g keeps the smear down-sun.
    if (d.z >= -1e-4){ world=vec2(0.0); fog=1.0; }                       // ray at/over the horizon -> all haze
    else {
      float lam = -1.0/d.z;                                             // ray .. ground-plane (z=0) intersection
      world = vec2(scale*lam*d.x, scale*(lam*d.y - targetY));
      float halfExtent = 0.5*uViewExtent*max(length(vec2(uAspect,1.0)),1e-4);
      fog = smoothstep(1.15*halfExtent, 3.0*halfExtent, length(world));  // 0 across the whole frame at pitch 0
      float Dref = cp + kf*sp;                                          // footprint of the nearest visible row
      float fore = clamp(pow(Dref/max(-d.z,1e-4), 1.5) - 1.0, 0.0, 4.0); // 0 at pitch 0 & frame bottom; up toward horizon
      extraThrow = uFarSmear * fore;                                     // extra throw -> wider, softer down-sun penumbra far off
    }
    // camera orbit (uViewYaw): rotate the sampled floor about frame centre — a true orbit for a flat floor (the
    // tilt/foreshortening axis stays put, the world spins under it). The sun-shift g stays in WORLD space below,
    // so shadows remain physically cast as the gaze turns. 0 → identity, byte-identical to the pre-yaw look.
    if(uViewYaw != 0.0){ float cy=cos(uViewYaw), sy=sin(uViewYaw); world = mat2(cy,-sy,sy,cy)*world; }
    world += uViewCenter;            // camera pan: shift the looked-at floor point (0 = unchanged)`;

const GLSL_T_FLOOR_MATERIAL = `    col = (acc*uSunColor + uAmbient) * uGround;            // OPAQUE FLOOR — literal old expression, byte-identical`;

// ---- CLOTH camera (§4.9): the curtain, seen head-on ----
const GLSL_T_CLOTH_DECLS = `uniform float uViewExtent;
uniform float uClothY;            // curtain receiver: the cloth plane's world-Y (its distance behind the tree) — where on the occluder field the shadow lands`;

const GLSL_T_CLOTH_CAMERA = `    // ---- CURTAIN receiver (spec §4.9): the receiver is a VERTICAL plane viewed head-on, NOT the floor. Screen
    // maps straight to the cloth's own coords — u across, v up. The tree's shadow is then projected onto the plane
    // by the (layerHeight - recvZ) height factor in the sample loop below: an occluder a height (h-v) ABOVE this
    // cloth point throws its shadow here, so the pattern stands UP the curtain instead of lying flat on the floor.
    // recvZ = 0 is the floor and leaves that loop byte-identical. TWO cloth coords from here on: clothUV is where
    // this point IS on the cloth (the pleats are attached to it — all shading reads this), castUV is where the
    // pleat's displacement makes the incoming light field arrive from (§4.9's fold warp — every occluder read). ----
    vec2 cuv = (vUv-0.5)*uViewExtent*vec2(uAspect,1.0) + uViewCenter;  // pan/zoom frame the cloth (view_center, view_extent)
    clothUV = cuv;                       // cloth (u across, v up) — the faithTex is baked in THESE coords (§4.9), tapped once below
    foldF = foldField(cuv);              // the drape, once (§4.9)
    castUV = cuv + foldThrow(foldF.x);   // fold warp: the same point's read into the FLAT-baked cast (== cuv when fold_warp 0)
    // the layer path is a PLAN-space read, so carrying the warp in (world.x, recvZ) is exact rather than a stand-in:
    // sliding the receiver point along its own ray lands the occluder lookup world.xy + (h-recvZ)·g on the identical
    // plan point the displaced cloth point sees. The analytic wood then follows for free (it reads world/recvZ too).
    world = vec2(castUV.x, uClothY);   // the cloth plane spans world-X; its world-Y (distance behind the tree) is uClothY
    recvZ = castUV.y;                    // height up the cloth (layer-path fallback; the faithful curtain uses castUV)`;

// ---- the pleat WARP and the cloth-facing throw it shares with the window: curtain-only, because both are
// cast against a flat plane at world-Y cy — an object the enclosure does not have (§4.9). ----
const GLSL_T_WARP_DECLS = `// the sun's cloth-facing throw component, guarded (§4.9). Sun ∥ to the cloth ⇒ gy→0 and every cloth-space throw
// (mullion bars, fold warp) diverges; the clamp keeps the sign so the throw still rakes the right way. Shared so
// the two consumers can't clamp differently.
float clothGy(){ return abs(uBulkShift.y) < 1e-3 ? (uBulkShift.y < 0.0 ? -1e-3 : 1e-3) : uBulkShift.y; }
// FOLD WARP (spec §4.9) — pleat displacement bends the arriving cast. The whole light field (faithful tap, layer
// reads, mullion) is baked/derived against a FLAT cloth at Y=cy. A pleated point sits Δy out of that plane, so it
// intercepts a different ray: the flat-cast plane is then Δy of DEPTH away from it, and the throw is literally
// mullionT's — cloth + (depth/gy)·(gx,1), one central ray up-sun, with Δy standing in for the bar depth. Sign
// convention that makes that identity exact: Δy > 0 bulges the pleat toward the ROOM (away from the sun side), so
// the flat plane sits in FRONT of it exactly as the bars do.
vec2 foldThrow(float shape){
  if(uFoldWarp == 0.0) return vec2(0.0);                                   // flat cloth: no displacement, byte-identical
  float dy = uFoldWarp * shape;                                            // Δy: the pleat's bulge out of the plane
  return (dy / clothGy()) * vec2(uBulkShift.x, 1.0);
}`;

// ---- the WINDOW (§4.9): mullion grid + aperture, both curtain-only for the same reason as the warp. ----
const GLSL_T_WINDOW_DECLS = `uniform vec4  uMullion;           // window mullion grid (§4.9): pitch, bar width, depth in FRONT of the cloth (m), tau. .w = 0 = off
uniform float uMullPenumbra;      // mullion soft edge (m on the cloth) = depth × the source's angular width, CPU-side
uniform vec4  uWindow;            // window aperture (§4.9): HALF width, HALF height, centre x, centre y — cloth metres. .x*.y = 0 = infinite light, off
uniform float uWindowWall;        // light landing outside the aperture (the room's own dim front-side leak; the wall itself is opaque)
// window MULLION GRID (spec §4.9): the authored near-cloth occluder — a rigid grid of vertical + horizontal bars
// standing uMullion.z metres in FRONT of the cloth (sun side), evaluated analytically per pixel in cloth (u,v).
// It is §4.5's woody occluder at centimetre range instead of metres, which is the whole point: at this d the
// aperture beats d·θ by orders of magnitude, so the grid lands in the SHAPE regime — sharp bars — inside the same
// frame where the leaf-gaps metres away are pinhole sun-images. The grid is bounded by the window APERTURE below
// (conf), because the bars are part of the window: past its frame there is wall, and a wall carries no glazing bars.
// THROW: the bar plane sits at world-Y cy+d, so along the central ray it drops r = d/gy to reach the cloth — the
// same projection VS_FAITH's curtain branch casts with (u = px − r·gx, v = h − r), inverted here to ask which bar
// point shadows THIS cloth point: (u,v) + r·(gx,1). One vector, so the grid rakes with the sun exactly as the
// trunk's cast does, just ~1/60th as far. Single central ray, no per-sample integration: at centimetre depths the
// spread across the source disk is sub-millimetre on the cloth, which the penumbra below already stands in for.
// PENUMBRA: depth × the source's angular width — deliberately WITHOUT the woody occluder's 1/sin(elevation)
// obliquity factor: the cloth is viewed head-on, so a bar's shadow is never smeared along a receding plane.
float mullionT(vec2 cloth, float conf){
  vec2 bar = cloth + (uMullion.z/clothGy()) * vec2(uBulkShift.x, 1.0);   // the bar-plane point whose shadow lands here
  float p = max(uMullion.x, 1e-3), hw = 0.5*uMullion.y;
  vec2 d = abs(mod(bar + 0.5*p, p) - 0.5*p);                             // distance to the nearest bar centre, per axis
  float pen = max(uMullPenumbra, 1e-3*p);   // a bar AT the cloth casts a geometrically hard edge; keep a hairline so smoothstep stays well-defined and the edge doesn't crawl. Well under the physical penumbra at any real depth, so it never softens the look.
  vec2 cov = 1.0 - smoothstep(vec2(hw), vec2(hw + pen), d);              // soft edge grows OUTWARD, like the wood's
  return exp(-uMullion.w * max(cov.x, cov.y) * conf);                    // union of the two bar sets: a crossing is still one bar deep. conf = 1 with no aperture, so the infinite grid is byte-identical
}
// THE WINDOW APERTURE (spec §4.9) — the light gets an EDGE. Behind the cloth is not an infinite lit field but a
// finite bright rectangle of sky in an opaque wall, and that macro contrast is most of the §1 composition. Evaluated
// at the SAME warped cast coordinate and the SAME bar-plane throw the mullion uses, because the aperture IS the
// window's outermost frame member: its edge S-bends across the pleats exactly as the glazing bars do, and that
// consistency is what makes the wall read as being behind the same cloth. Soft edge = the mullion penumbra, the same
// depth × the same source, so frame and bars blur together as cloud thickens.
// Returns (mask, inside): mask scales the landed irradiance — leak outside, full light within; inside confines the
// bar grid to the glazing so no fishnet crawls across the wall.
vec2 windowMask(vec2 cloth){
  vec2 ap = cloth + (uMullion.z/clothGy()) * vec2(uBulkShift.x, 1.0);    // the aperture-plane point whose shadow lands here
  vec2 d = abs(ap - uWindow.zw) - uWindow.xy;                            // per-axis signed distance to the rect edge (<0 = inside)
  float pen = max(uMullPenumbra, 1e-4);                                  // bars AT the cloth give a hard edge; a hairline keeps smoothstep well-defined
  vec2 t = 1.0 - smoothstep(vec2(-pen), vec2(0.0), d);                   // the wall's coverage grows OUTWARD from the geometric edge, like the bars' and the wood's
  float inside = t.x*t.y;
  return vec2(uWindowWall + (1.0 - uWindowWall)*inside, inside);
}`;

const GLSL_T_WINDOW_APPLY = `    // The window grid attenuates the WHOLE landed irradiance, not just the beam. A bar metres away (the wood, §4.5)
    // blocks only the sun's small disk, so it multiplies acc alone and the skylight still reaches around it. A bar
    // CENTIMETRES off the cloth subtends nearly the entire hemisphere seen from the point behind it — beam and
    // skylight both — so it scales E. That distinction is the physics of a near-contact occluder, not a shortcut.
    // castUV, not clothUV: the bars are one more plane in FRONT of the cloth, so a displaced pleat sees them at
    // depth (bar depth + Δy) — which is exactly what mullionT's own throw adds on top of the warped coord. The
    // grid's straight lines S-bending across the pleats is the fold warp's defining image. The APERTURE takes E for
    // the same near-contact hemisphere reason the bars do — a wall centimetres off the cloth shuts out beam and sky
    // alike — and it bounds the grid, since the bars are the window's and the wall has none.
    // BOTH ARE CURTAIN-ONLY. They are cast by a central-ray throw in cloth (u,v) against a plane at world-Y cy — the
    // enclosure has no such plane (its world-Y comes out of the ray cast) and no head-on map to read the throw in,
    // so a window in a tent would be drawn in coordinates that mean nothing there.
      float barConf = 1.0;                                 // 1 = infinite window, the grid runs edge to edge (byte-identical)
      if(uWindow.x*uWindow.y > 0.0){
        vec2 win = windowMask(castUV);
        barConf = win.y;
        E *= win.x;
      }
      if(uMullion.w > 0.0) E *= mullionT(castUV, barConf);`;

// ---- THE FABRIC (§4.9), shared by the two cloth receivers: the same material answering on a hanging
// curtain and on a tent stood around the viewer. ----
const GLSL_T_FABRIC_DECLS = `uniform float uTt;                // curtain total throughput Tt∈[0,1] — carries BRIGHTNESS (hue is uFabricTint)
uniform vec3  uFabricTint;        // moss dye — HUE only; normalized to unit peak in-shader so it can't smuggle brightness past Tt
uniform float uFoldDepth;         // curtain drape: pleat SHADING — authored pile thickness on a flat plane (0 = flat cloth, no folds); displacement is uFoldWarp
uniform float uFoldScale;         // curtain drape: pleat frequency (pleats per metre near the top)
uniform float uFoldCoarsen;       // curtain drape: how much the pleats widen toward the hem (heavy fabric)
uniform float uFoldWarp;          // pleat DISPLACEMENT amplitude (m) out of the cloth plane — geometry, not shading: it bends the arriving cast (0 = flat)
uniform float uSheen;             // velvet grazing sheen strength on the fold ridges (the cut-pile glow)
uniform float uScatter;           // fraction of the transmitted light that FORWARD-SCATTERS through the pile (0 = all ballistic, today's look)`;

const GLSL_T_FOLD_DECLS = `// THE PLEAT FIELD, in one place (§4.9) — one displacement, one derivative, one function. Both the shading (which
// flank is edge-on) and the geometry (where that flank sits in depth) read the SAME values here, so the shared-phase
// invariant is structural rather than a convention two call sites have to keep: the warp bends the cast around
// exactly the flanks the velvet shades.
// GRAVITY IS THE CONSTRAINT: hanging cloth has VERTICAL ridges at every height. Each harmonic's phase is therefore a
// function of x ALONE. Coarsening cannot be a frequency chirp (see §4.9's recorded dead end — a k(y) tilts the
// constant-phase ridges into a diagonal fan, x ∝ √(1+c·y), the literal pool-caustic look); it is a spectral
// REWEIGHTING, an octave crossfade — fine gathers at the rod fading out into broad waves at the hem.
// Three harmonics at pairwise irrational ratios: the sum is almost-periodic, so no pleat ever repeats and there is no
// wallpaper tile — aperiodicity with no hash, no RNG, C∞ smooth (which the warp derivative and the incidence both need).
const vec3 FOLD_R = vec3(1.0, 0.6180340, 0.4142136);   // frequency ratios ×uFoldScale: 1 : 1/φ : 1/(1+√2)
const vec3 FOLD_A = vec3(0.4142136, 0.6702134, 1.0);   // amplitude ∝ 1/k, so every harmonic contributes the SAME peak slope; displacement is broad-dominated, slope is not
const vec3 FOLD_P = vec3(0.7, 2.4, 5.1);               // fixed phase offsets — no distinguished point where all three crest together
const float FOLD_NAP = 33.798990;                      // pile-grain frequency ×uFoldScale: 14·(1+√2), irrational against all three harmonics, so the grain never locks onto a fold
// Returns the UNIT pleat shape: (ŝ, dŝ/dx, max|dŝ/dx|), with |ŝ| ≤ 1. uFoldWarp scales it to metres at the consumers
// rather than here, so the shading's facing term keeps its 0..1 meaning on a cloth with no displacement at all.
vec3 foldField(vec2 cloth){
  float f = 1.0/(1.0 + uFoldCoarsen*max(cloth.y, 0.0));                    // 1 at the rod → 0 at the hem: the octave crossfade's mixer
  vec3 w = vec3(f, 1.0, 2.0 - f);                                          // finest dies down the drape, broadest grows to take its place (coarsen 0 ⇒ all 1, even top to bottom)
  vec3 k = uFoldScale * FOLD_R;
  vec3 wa = w * FOLD_A;
  float N = max(wa.x + wa.y + wa.z, 1e-6);                                 // normalize Σwa so the peak displacement stays uFoldWarp metres at EVERY height
  vec3 ph = 6.2831853*k*cloth.x + FOLD_P;
  return vec3(dot(wa, sin(ph))/N,
              6.2831853*dot(wa*k, cos(ph))/N,
              max(6.2831853*dot(wa, k)/N, 1e-6));                          // the sup the almost-periodic derivative approaches (every |cos| → 1 together)
}
// FOLD INCIDENCE (spec §4.9) — the lit/dark banding on a tilted flank is an incidence COSINE, so it takes the real
// sun direction and NOT uProj/uBulkShift: those carry 1/sin(elevation) and blow up at a low sun, where incidence on
// a vertical cloth does the opposite — it PEAKS as the sun lowers head-on toward the window. The slope handed in is
// foldField's own dΔy/du (the one field, scaled to metres), and with Δy measured toward the room the two unit
// normals of the surface (u, cy−Δy, v) are ±(dΔy/du, 1, 0)/‖·‖ — the sun-facing one is the sign of the sun's
// own cloth-facing component. Normalized by the FLAT cloth's incidence so uFoldWarp = 0 returns exactly 1.0: the
// warp geometry is the gate, no separate knob. The ratio exceeds 1 on a flank turned INTO the sun — real (that
// flank truly collects more than the flat plane), and it diverges as the sun rakes parallel to the cloth, the same
// degenerate pose clothGy already guards, where the whole cloth-space cast is meaningless anyway.
float foldIncidence(float slope){
  if(uFoldWarp == 0.0) return 1.0;                                         // flat cloth: no tilt, so nothing to vary — byte-identical
  float sgn = uBulkShift.y < 0.0 ? -1.0 : 1.0;                             // which side of the cloth the sun stands on
  float sx = sgn*uSunDir.x, sy = sgn*uSunDir.y;                            // sun, in the frame where the cloth's sun-facing normal is +Y
  return max(slope*sx + sy, 0.0) / (max(sy, 1e-3) * sqrt(1.0 + slope*slope));
}
// curtain drape + velvet (spec §4.9). A real curtain is not flat — it hangs in vertical PLEATS that coarsen toward
// the hem (foldField above: fine octaves fading out, ridges vertical throughout). This is the SHADING half — uFoldDepth is authored pile thickness on
// a flat plane, NOT the displacement (that is uFoldWarp above, and it deliberately does not enter here: the pleats
// are attached to the cloth, so only the ARRIVING pattern warps). The pleats do two things that read as thick
// velvet rather than a thin woven grid:
//  • backlit THICKNESS — the edge-on fold flanks present more cut-pile, so they transmit LESS → dark vertical bands;
//  • a grazing SHEEN — the face-on ridges catch a soft pale glow, the signature of a standing-fibre pile.
// body is the transmitted moss; sheenCol the pale glow tint. Keyed to the cloth's own (u,v) so it stays on the cloth.
// FORWARD-SCATTER WRAP (uScatter = s, §4.9). Backlit cut pile transmits two ways: a BALLISTIC component that threads
// the pile directly — highly directional, so the edge-on flanks extinguish it (that is band) — and a component that
// DIFFUSES among the fibres and leaves in a broad forward lobe, near-isotropic, so fold orientation barely attenuates
// it. s is the SPLIT of the same transmitted energy between the two, a mix and never an add: both bands are ≤ 1, so
// their mix is, and Tt·tint̂·mix ≤ 1 still forbids the cloth out-glowing the light that landed on it. (The fold
// incidence below rides ON band and can push it past 1 — not a gain in the split, which still divides one fixed
// transmitted energy, but a correction to the irradiance it divides: E is the FLAT plane's, and a flank turned into
// the sun really does collect more than that.) The dye acts on
// scattered light too (it crossed the same pile), so the hue stays tint̂ — no second tint. s=0 collapses to band.
// LIMIT of this per-pixel tier: it redistributes light ANGULARLY at one point, so it wraps the glow around the FOLDS
// but cannot bleed a dapple's glow across a CAST-SHADOW edge — that is the lateral 2-D diffusion tier (§4.9), staged.
// The scatter argument is the forward-scatter share at THIS pixel rather than the uniform, because the mesh band
// (§4.9) is a per-panel MATERIAL: mesh barely diffuses what passes it, so its share drops toward 0 while the nylon
// below the hem keeps the whole knob. Every other receiver passes uScatter straight through, byte-identically.
vec3 velvetCloth(vec2 cloth, vec3 fold, vec3 body, vec3 sheenCol, float scatter){
  float facing = clamp(abs(fold.y)/fold.z, 0.0, 1.0);                    // slope against the field's own peak slope: 1 = edge-on flank, 0 = face-on ridge/valley. Unit shape, so fold_depth's banding is there on an undisplaced cloth too
  float inc = foldIncidence(uFoldWarp * fold.y);                         // true sun-geometry lit/dark on the flanks (1.0 on flat cloth)
  float band = exp(-uFoldDepth * facing) * inc;                          // ballistic: flanks thicker → darker pleat bands (backlit), × how squarely each flank meets the sun
  // the scattered lobe walks the same Beer path at a quarter weight: it still dims edge-on (more pile to cross) but
  // never goes black. 0.25 is an authored "mostly, not wholly, orientation-blind" call — 0 would flatten the glow
  // completely, 1 would collapse it back onto the ballistic band and the wrap would do nothing.
  float bandSoft = exp(-uFoldDepth * facing * 0.25);
  float ridge = 1.0 - facing;                                            // bright where the cloth faces us
  // fine pile grain, TRUE-vertical (varies across x like the pleats). Amplitude rides the pile thickness knob:
  // grain is a property of PILE, so a thin taut fabric (tent nylon, fold_depth→0) is perfectly smooth — any fixed
  // grain on a bright near-white cloth reads as printed pinstripes, not fibre. ±4% at full pile.
  float napAmp = 0.04 * min(uFoldDepth, 1.0);
  float nap = (1.0 - napAmp) + napAmp*sin(6.2831853 * FOLD_NAP*uFoldScale * cloth.x);
  vec3 sheen = sheenCol * (uSheen * ridge * ridge);                      // soft pale glow on the ridges only
  return body * mix(band, bandSoft, scatter) * nap + sheen;
}`;

const GLSL_T_FABRIC_MATERIAL = `    // The landed irradiance the fabric answers. On the ENCLOSURE the beam and the sky are resolved SEPARATELY
    // against this panel's own normal (§4.9): a directional beam takes an incidence cosine, a hemisphere of sky
    // takes how much of the hemisphere the panel sees. beamF/skyF/recvAtten are all 1 on the floor and the curtain,
    // so what those two evaluate is the old expression exactly.
    vec3 E = acc*uSunColor*beamF + uAmbient*skyF;
    E *= recvAtten;                                        // enclosure only: interior depth fade × the ridge seam`;

const GLSL_T_FABRIC_TAIL = `    vec3 tintHat = uFabricTint / max(max(uFabricTint.r, uFabricTint.g), max(uFabricTint.b, 1e-4));   // unit-peak HUE
    // MESH vs NYLON, and it is one material split rather than a painted band. A mesh passes less of what lands on it
    // and DIFFUSES almost none of what it does pass, so it takes both halves of the transmission: the throughput
    // drops toward 0.55, and the forward-scatter share — the thing that turns a cast into a glow — drops toward
    // nothing, which is what makes the band read DARKER and its dapples CRISPER at the same time. meshF is 0 on every
    // other panel and every other receiver, so both lines collapse to the old ones exactly.
    vec3 body = E * (uTt * tintHat) * mix(1.0, 0.55, meshF);   // transmitted moss: brightness × hue; ambient rides through Tt·tint̂ (gated, not free)
    // drape + velvet (§4.9): pleats + grazing sheen on the cloth's own (u=clothUV.x, v=clothUV.y) coords. The sheen
    // is a pale warm tint of the dye (two-tone velvet), brightened a touch where the backlight is hot.
    vec3 sheenCol = mix(tintHat, vec3(1.0,0.96,0.88), 0.7) * (0.4 + 0.6*dot(body, vec3(0.33)));
    col = velvetCloth(clothUV, foldF, body, sheenCol, uScatter * (1.0 - meshF));`;

// ---- ENCLOSURE camera (§4.9): the tent as a convex polytope, ray-cast from inside ----
const GLSL_T_TENT_DECLS = `uniform float uTentRidge;         // ENCLOSURE (§4.9): crown height (m) — the flat top panel's plane; the slopes rise to its long edges
uniform float uTentHalfW;         // ENCLOSURE: half the floor width (m); with the crown height and width it IS the slope pitch
uniform float uTentCrownW;        // ENCLOSURE: half the CROWN panel's width (m) — 0 collapses it to a ridge line and the shape degenerates to an A-frame
uniform float uTentShoulderH;     // ENCLOSURE: height (m) of the arch profile's WAYPOINT — the Bézier's mid control point, where the vault bulges widest
uniform float uTentShoulderW;     // ENCLOSURE: half-width (m) at that height; bulged past the straight base→crown line is what curves the side into an arch rather than a slope
uniform float uTentLen;           // ENCLOSURE: tent length (m) — the far cap's base; the eye rides at 30 % of it
uniform float uTentEndLean;       // ENCLOSURE: how far an end wall leans out per metre of height (0 = a vertical end wall)
uniform float uTentEndApex;       // ENCLOSURE: height (m) of the far end's VENT APEX — the point the two hips converge on, and the top of the foot triangle
uniform float uTentHipRake;       // ENCLOSURE: how much MORE steeply the hips rake back than the end wall (m per metre of height). 0 collapses all three far planes onto one, bit-exactly
uniform float uTentEye;           // ENCLOSURE: eye height (m), clamped strictly inside every half-space CPU-side (an eye on or past one leaves the viewer outside their own tent)
uniform float uTentFade;          // ENCLOSURE: interior depth fade (1/m) — the ridge is infinite, so distance is the only thing that closes it off
uniform float uTentSeam;          // ENCLOSURE: ridge-seam optical depth (0 = no seam)
uniform float uTentMesh;          // ENCLOSURE: how much the panels ABOVE the shoulder hem are mesh rather than nylon (0 = one fabric everywhere, byte-identical)
// THE ENCLOSURE's two hard numbers (§4.9). The tent is a CLOSED convex polytope, so every ray inside it leaves
// through some panel and TENT_TMAX is a safety clamp, not a horizon: the one direction with no exit is straight
// down (the polytope is open below the floor plane the model does not have), which no frame at a sane pitch
// contains. TENT_SEAM_HW is the panel-junction seam's half-width — 24 mm of taped, doubled fabric.
const float TENT_TMAX = 12.0;
const float TENT_SEAM_HW = 0.012;
// ---- THE ENCLOSURE's side profile (spec §4.9): ONE ARC, not two facets. The reference tent is tensioned fabric on
// PRE-BENT pole arcs, so its cross-section is a rounded vault; two flat panels per side read as a barn. The curve is
// a quadratic Bézier through the three authored control points — base (halfW, 0), shoulder (shoulderW, shoulderH),
// crown edge (crownW, ridge) — with the middle one hit exactly at t = 0.5, which pins the control point at
// C = 2·P1 − (P0+P2)/2. A quadratic Bézier is a parabola arc: its curvature cannot change sign, so the curve is
// convex BY CONSTRUCTION and every tangent plane of it bounds one convex region. That is the whole reason the shape
// can round without the exit math being touched. The shoulder params stop naming a crease and start naming the
// arc's waypoint — how far out, and at what height, the vault bulges.
vec2 tentCtrl(){ return 2.0*vec2(uTentShoulderW, uTentShoulderH) - 0.5*(vec2(uTentHalfW, 0.0) + vec2(uTentCrownW, uTentRidge)); }
vec2 tentTangent(vec2 C, float t){ return 2.0*(1.0-t)*(C - vec2(uTentHalfW, 0.0)) + 2.0*t*(vec2(uTentCrownW, uTentRidge) - C); }
vec2 tentProfile(vec2 C, float t){ float u = 1.0-t; return u*u*vec2(uTentHalfW, 0.0) + 2.0*t*u*C + t*t*vec2(uTentCrownW, uTentRidge); }
// The outward unit normal at t, in (x, z), for the +x side; the −x side is the same offset with n.x negated.
// Walking UP the profile the rise is strictly positive — the CPU clamp holds 0 < C.z < ridge, which makes the
// tangent's z-component 2[(1−t)·C.z + t·(ridge − C.z)] > 0 everywhere, so this normalize can never see a zero
// vector and the profile can never double back in height. (dz, −dx) is then the outward-and-up perpendicular, and
// it correctly tips BELOW horizontal wherever the arc flares outward, which is what an overhanging fly does.
vec2 tentNormal(vec2 C, float t){ vec2 d = tentTangent(C, t); return normalize(vec2(d.y, -d.x)); }
// Invert the profile's HEIGHT — the t whose point sits at height h — for the SMOOTH shading normal below.
// B.z(t) = a·t² + b·t with a = ridge − 2·C.z and b = 2·C.z, monotone on [0,1] by the same clamp.
float tentTAtHeight(vec2 C, float h){
  float a = uTentRidge - 2.0*C.y, b = 2.0*C.y, hc = clamp(h, 0.0, uTentRidge);
  if(abs(a) < 1e-6) return clamp(hc/max(b, 1e-6), 0.0, 1.0);           // C.z at half the ridge: the height map is linear
  return clamp((-b + sqrt(max(b*b + 4.0*a*hc, 0.0)))/(2.0*a), 0.0, 1.0);
}
// Which PANEL GROUP a plane belongs to: 0 crown, 1/2 side +x below/above the hem, 3/4 side −x below/above,
// 5 far END WALL (the foot vent), 6/7 the two far HIPS, 8 near END WALL (the head vent), 9/10 the two near HIPS. The seam pass reads this and nothing else: a
// junction between two planes of the SAME group is an artefact of faceting the arc, not a pole line, and drawing it
// is what turned the vault into masonry ribbing (§4.9's recorded dead end). The far cap's three planes are three
// SEPARATE groups precisely because their junctions ARE edges — the spine where the hips meet, and the vent
// triangle's two rising sides. Both caps carry that, so the spine runs the ceiling's whole centreline: it comes in
// over your head from behind, crosses the crown, and forks again at the far vent. Each arch splits at its middle strip boundary for the same reason: that junction is
// the real MESH↔FABRIC hem, so it is the one intra-arch boundary that must draw.
int tentGroup(int i){ return i == 0 ? 0 : i < 3 ? 1 : i < 5 ? 2 : i < 7 ? 3 : i < 9 ? 4 : i - 4; }   // 9..14 -> 5..10
// Is this an UPPER (mesh) side panel? The two strips tangent at t = ⅔ and 1 — everything above the hem.
bool tentMeshPanel(int i){ return (i >= 3 && i <= 4) || (i >= 7 && i <= 8); }`;

const GLSL_T_TENT_CAMERA = `    // ---- ENCLOSURE receiver (spec §4.9): the receiver stops being a plane the camera stares AT and becomes a
    // CLOSED TENT stood around the eye, ray-cast per pixel. It is the hip/brow shape the reference actually is: a
    // flat rectangular CROWN along the top; per side a rounded ARCH — tensioned fabric on a pre-bent pole, sampled
    // as four tangent strips of one convex profile curve and shaded off the SMOOTH normal, so the light rounds
    // continuously across it; and at each end a GABLE (one panel, or two bevelled halves meeting at a vertical
    // centre crease). TENT SPACE: the long axis is +Y, the crown sits at z = uTentRidge, the arches reach
    // the ground at x = ±uTentHalfW, the eye sits 30 % down the tent at uTentEye, gazing along +Y pitched UP by
    // uPitch (in THIS branch the pitch uniform means elevation above horizontal, not the floor camera's tilt from
    // straight-down). What happens downstream is the point of the whole thing: the hit's plan point and height go
    // into (world, recvZ) and §4.9's height-minus-recvZ read casts the canopy onto whichever panel this pixel
    // landed on with ZERO further changes — that generalization was written for a flat cloth and turns out to have
    // been geometry-free all along. ----
    float cp=cos(uPitch), sp=sin(uPitch);
    float kf=max(tan(0.5*uFov), 1e-4);                 // image-plane half-extent (guard fov->0) — the floor camera's 2k·tan convention, verbatim
    float sxc=(vUv.x-0.5)*uAspect, tyc=(vUv.y-0.5);
    // ray = fwd + 2k*(sx*right + ty*up), with fwd=(0,cp,sp), right=(1,0,0), up=(0,-sp,cp). NORMALIZED, unlike the
    // floor's: t below is metres of fabric distance and both the depth fade and TENT_TMAX are quoted in metres.
    vec3 dir = normalize(vec3(2.0*kf*sxc, cp - 2.0*kf*tyc*sp, sp + 2.0*kf*tyc*cp));
    vec3 eye = vec3(0.0, 0.3*uTentLen, uTentEye);      // DERIVED, not a knob: 30 % down the tent puts the far cap ~1.6 m off and the near one just behind you, which is where you lie in a 2P
    // THE THIRTEEN HALF-SPACES, outward unit normal n and offset c (inside is dot(n,X) < c). The tent is the CONVEX
    // intersection of them, and convexity is what makes this cheap and exact at once: a ray from a point strictly
    // inside leaves through exactly one panel, the min over the planes it is advancing into, so there are NO
    // per-panel bounds tests at all. A plane the ray meets outside the tent is always beaten by the one that
    // actually bounds it there. That is the whole intersection routine, and it has not changed a character while the
    // shape went from two panels to five to nine to thirteen — panel count is data here, not structure. Which is
    // exactly what let the sides ROUND: a convex profile curve's tangent planes are a convex half-space set, so
    // sampling four of them per side buys an arch for nothing but four more entries in this table.
    vec2 C = tentCtrl();
    float gn = inversesqrt(1.0 + uTentEndLean*uTentEndLean);
    // THE FAR CAP is ONE PLANE FAMILY with three members, and writing it that way is what makes it collapse:
    //   (a·x ± y + k·z < len + rake·apex),  a = apex·rake/halfW,  k = endLean + rake
    // rake 0 gives a = 0, k = endLean, offset = len — the single leaning end wall, bit-exactly — and the far cap is
    // the tent as it shipped. Turning rake up rakes the two ±a members back FASTER than the wall, so they start
    // binding above the vent apex and the end wall survives only BELOW the line from the apex to each floor corner.
    // The three anchor points are all hull features already, which is why nothing else has to move: the apex
    // A = (0, len − endLean·apex, apex) sits on the end wall at the vent's height, the floor corners (±halfW, len, 0)
    // are the tent's own far corners, and the two hips meet each other along the vertical plane x = 0 — the SPINE.
    float hk = uTentEndLean + uTentHipRake;
    float ha = uTentEndApex*uTentHipRake/max(uTentHalfW, 1e-3);
    float hn = inversesqrt(1.0 + ha*ha + hk*hk);
    float hcF = (uTentLen + uTentHipRake*uTentEndApex)*hn;   // far cap, base line at y = uTentLen
    float hcN = (0.5      + uTentHipRake*uTentEndApex)*hn;   // near cap, base line at y = −0.5 — the SAME family with y negated
    vec3 pn[15]; float pc[15];
    pn[0] = vec3(0.0, 0.0, 1.0);                  pc[0] = uTentRidge;        // CROWN — the flat rectangular panel along the top
    for(int j=0;j<4;j++){
      // tangency at t = 0, 1/3, 2/3, 1 — the ends INCLUDED, so the hull touches the authored base and crown edge
      // exactly and only bulges (by ~1.5 cm at these dimensions) between them. Tangent planes circumscribe a convex
      // curve, so the hull is a superset of the true arch, which is also what keeps the eye-inside proof below free.
      float tj = float(j)/3.0;
      vec2 nz = tentNormal(C, tj);
      float cj = dot(nz, tentProfile(C, tj));
      pn[1+j] = vec3( nz.x, 0.0, nz.y);           pc[1+j] = cj;              // +x ARCH strips, base → crown edge
      pn[5+j] = vec3(-nz.x, 0.0, nz.y);           pc[5+j] = cj;              // −x arch (mirrored: negate n.x, the offset is symmetric)
    }
    // THE FAR CAP — a HIP, not a wall. The end wall survives only as the small upright triangle at the foot (the
    // vent): the hips cut it away above the line from the apex to each floor corner, which is exactly the line the
    // hip and the wall share, so that boundary is the triangle's own rising side and needs no separate authoring.
    // What the eye gets is the reference's shape rather than a slab: a seam down the ceiling's centreline (the two
    // hips meeting), splitting at the apex into the triangle's two sides.
    pn[9]  = vec3(0.0,  gn, uTentEndLean*gn);     pc[9]  = uTentLen*gn;      // FAR END WALL — the foot vent
    pn[10] = vec3( ha*hn,  hn, hk*hn);            pc[10] = hcF;              // FAR HIP +x
    pn[11] = vec3(-ha*hn,  hn, hk*hn);            pc[11] = hcF;              // FAR HIP −x (mirrored: negate n.x, the offset is symmetric — so they meet on x = 0)
    pn[12] = vec3(0.0, -gn, uTentEndLean*gn);     pc[12] = 0.5*gn;           // NEAR END WALL — the head vent
    pn[13] = vec3( ha*hn, -hn, hk*hn);            pc[13] = hcN;              // NEAR HIP +x
    pn[14] = vec3(-ha*hn, -hn, hk*hn);            pc[14] = hcN;              // NEAR HIP −x
    // THE HUBS ARE NOT MODELLED, and that is the argument for doing this as a polytope at all. The corners the
    // reference reads as hardware are simply VERTICES — where an arch strip, the crown and a cap plane all meet — so
    // they appear at the right place for free, and the seam pass below draws the pole lines radiating out of them
    // without any of it being enumerated. The vent apex is the newest of them: hip, hip and end wall, three planes,
    // one point, no authoring.
    // DEGENERACY, the regression anchor: a shoulder placed exactly on the straight base→crown line makes all three
    // Bézier control points collinear, so the curve IS that line, all four tangent planes coincide, and the shape
    // gives back the v2 single-slope tent — and with crown_w → 0 and a large tent_len on top of it, the v1 A-frame.
    int win = dir.x >= 0.0 ? 1 : 5;                    // fallback panel for the one exitless direction (straight down, which no sane pitch puts in frame): the lowest arch strip it is heading toward
    float t = 1e6;
    for(int i=0;i<15;i++){
      float den = dot(pn[i], dir);
      if(den <= 1e-6) continue;                        // the ray recedes from this plane (or runs parallel): it cannot leave through it
      float ti = (pc[i] - dot(pn[i], eye)) / den;      // strictly > 0, because the eye is clamped strictly inside every half-space CPU-side
      if(ti < t){ t = ti; win = i; }
    }
    t = min(t, TENT_TMAX);
    vec3 hit = eye + t*dir;
    vec3 n0 = pn[win];                                 // the winning panel's HULL normal: the seam's edge geometry is the polytope's, not the smooth shading normal's
    vec3 n = n0;                                       // the shading normal, which the arch replaces below — the first receiver in this engine whose orientation varies across the frame
    // SMOOTH NORMALS OVER A COARSE HULL. On the arch the shading normal is the PROFILE's own, evaluated at the hit's
    // height, not the facet's — so the light rounds continuously across the side exactly the way it rounds on
    // tensioned fabric, while the exit math keeps the cheap four-plane hull. This is the classic smooth-shaded coarse
    // hull, and it is the honest cheap road here: the silhouette stays subtly faceted, but a true curved-surface ray
    // intersection would buy sub-centimetre silhouette accuracy on a 64 cm half-width tent — nobody can see it, and
    // it would cost the closed-form single min() that this whole receiver is built on.
    if(win >= 1 && win <= 8){
      vec2 ns = tentNormal(C, tentTAtHeight(C, hit.z));
      n = vec3(win < 5 ? ns.x : -ns.x, 0.0, ns.y);
    }
    // THE MESH BAND — the first PER-PANEL MATERIAL in this receiver, and deliberately not per-panel shading. The
    // Dragonfly's sides are solid nylon to the shoulder and dark mesh above it, and that hard hem is what the eye
    // reads as structure. The bell's shoulder CREASE used to stand in for it by accident; rounding the side into an
    // arc removed the crease and took the hem with it, which is the regression this answers. The normal stays the
    // smooth arc's straight across the hem — the fabric does not kink there, it changes material.
    meshF = tentMeshPanel(win) ? uTentMesh : 0.0;
    // THE POLE LINES, from one measurement: the inside-distance to each non-winning plane of a DIFFERENT PANEL GROUP.
    // The group filter is the whole point. A junction between two strips of the same arch is an artefact of faceting
    // a curve — there is no seam there on a real tent, and drawing one is exactly what turned the vault into
    // masonry ribbing (§4.9's recorded dead end: the user's word was "church"). What survives the filter is the set
    // of real pole lines: the crown's two long edges, the SPINE down the ceiling's centreline where the two hips
    // meet, the foot triangle's two rising sides, and the rims where a cap meets the arches and the crown.
    // MEASURED TO THE EDGE LINE, not to the neighbouring plane, and the difference is a real one. The perpendicular
    // distance to a plane is the distance to the edge FORESHORTENED by the dihedral: walking across the winning panel
    // toward the junction closes that gap at a rate sin(dihedral), so a plane-distance seam paints a band
    // 1/sin(dihedral) wide in fabric and the shallowest junction in the tent draws the fattest tape. Undoing it is
    // one identity — split the neighbour's normal into its component along ours and the rest, and only the rest
    // moves us toward the line:
    //   dEdge = |c_j − n̂_j·hit| / ‖n̂_j − (n̂_j·n̂_w)·n̂_w‖ = |c_j − n̂_j·hit| · inversesqrt(1 − (n̂_j·n̂_w)²)
    // One dot and one inversesqrt per plane, and it makes the tape a fixed width of fabric everywhere. The 1e-6 floor
    // is not a numerical nicety: two PARALLEL panels have no edge, so the distance to it is infinite and no seam is
    // drawn — which is exactly right, and is what keeps a degenerate cap (hip rake → 0, three planes on one) from
    // painting itself dark. abs() because a TMAX-clamped hit sits outside.
    float dSeam = 1e6;
    int wg = tentGroup(win);
    for(int j=0;j<15;j++){
      if(tentGroup(j) == wg) continue;
      float cw = dot(pn[j], n0);                                            // cos of the angle between the two panels' normals
      dSeam = min(dSeam, abs(pc[j] - dot(pn[j], hit)) * inversesqrt(max(1.0 - cw*cw, 1e-6)));
    }
    // the fabric's OWN coords, generalized off the crown: v is the drop BELOW the crown plane, so the pleat field's
    // rod sits on the tent's own pinned top on every panel at once (a tent is pinned at its crown and free at the
    // hem exactly as a curtain is at its rod, so fold_coarsen's octave crossfade broadens the ripples downward the
    // right way round); u runs along the panel's horizontal tangent — down the tent on the slopes, across it on the
    // cap panels, and across it on the crown, whose plan normal is degenerate and needs the explicit fallback.
    vec2 tang = (abs(n.x) + abs(n.y) > 1e-4) ? normalize(vec2(-n.y, n.x)) : vec2(1.0, 0.0);
    clothUV = vec2(dot(hit.xy, tang), uTentRidge - hit.z);
    castUV = clothUV;              // nothing to warp: there is no flat-plane cast here, the read IS the real geometry, so fold_warp is inert in this branch (§4.9)
    foldF = foldField(clothUV);    // the drape, once — velvetCloth needs the field's peak-slope divisor even on a taut tent
    // the tent stands wherever the look places it: uViewYaw turns it about the eye (the floor camera's own orbit
    // matrix, so the two cameras agree on which way is round), uViewCenter walks it across the grove. The canopy and
    // the sun stay in WORLD plan, so the normal is rotated with the hit and the incidence below is a real world angle.
    vec2 plan = hit.xy, nxy = n.xy;
    if(uViewYaw != 0.0){ float cy=cos(uViewYaw), sy=sin(uViewYaw); mat2 rot=mat2(cy,-sy,sy,cy); plan=rot*plan; nxy=rot*nxy; }
    world = plan + uViewCenter;
    recvZ = hit.z;
    n = vec3(nxy, n.z);
    // PER-PANEL LIGHT — the thing a flat wall cannot do, and the reason this receiver exists. beamF is the beam's
    // incidence on THIS panel, normalized by the sun's own vertical component so a HORIZONTAL panel comes out
    // exactly 1: the floor and curtain conventions already absorb sin(elevation) into their irradiance (acc is the
    // fraction of the disk that cleared, landing on a surface those models never tilt), so 1 is precisely what "as
    // bright as the old receivers" has to mean. THE CROWN IS THAT ANCHOR — it is horizontal, so it lands at exactly
    // 1 and the slopes and cap panels read as departures from it. The 0.15 floor (≈8.6° elevation) keeps a horizon sun
    // from dividing by nothing. The sky is a hemisphere rather than a direction, so it takes how much of that
    // hemisphere the panel can see instead — 1 on the crown, and less the more steeply a panel stands up.
    beamF = clamp(dot(n, uSunDir) / max(uSunDir.z, 0.15), 0.0, 2.0);
    skyF  = 0.5 + 0.5*n.z;
    recvAtten = exp(-t*uTentFade);   // a gentle depth cue now rather than the thing that closes the space: the far cap does that, and the tent is metres deep, not infinite
    // THE SEAMS — near-contact occluders in the strictest sense, since they are ON the cloth, so they take beam and
    // sky alike exactly as the mullion bars do. The soft edge is the tape's own near to, then the PIXEL FOOTPRINT
    // far off: 0.004 rad ≈ 3 px on a 78°, 1080-tall frame, so a junction running away from the eye holds a roughly
    // constant screen width instead of thinning to a sub-pixel line that crawls.
    if(uTentSeam > 0.0){
      float pen = max(TENT_SEAM_HW, 0.004*t);
      recvAtten *= exp(-uTentSeam * (1.0 - smoothstep(TENT_SEAM_HW, TENT_SEAM_HW + pen, dSeam)));
    }`;

// ---- SKY VIEW camera (§4.9): the retina as the receiver ----
const GLSL_T_SKY_DECLS = `uniform float uSkyScatter;        // SKY VIEW (§4.9): single-scatter foliage radiance — how brightly a lit crown glows in its own right (0 = pure transmission, byte-identical)
uniform vec2  uSrcAngR;           // the SEEN source's angular radii (core, halo) — the very two the sampler draws its offsets from
uniform vec2  uSrcAngL;           // its radiance in each region (core, halo). CPU-derived from the sampler's own post-cloud weight split, so the sun you look at and the dapples it throws cannot drift apart
uniform vec2  uSrcMoon;           // eclipse: the moon disk's (centre offset, radius) in the sampler's own source plane; .y = 0 = no eclipse
// SKY VIEW's two constants (§4.9). SKY_AA is one angular soft edge, standing in for both a pixel's own angular
// footprint (≈3 px on an 85° frame ~1000 tall) and the penumbra a silhouette really has against the sun's disk.
// SKY_SKY_GAIN converts uAmbient — an authored IRRADIANCE, what the sky delivers ONTO a surface — into the RADIANCE
// you get when you look straight at it. Those are different quantities and the engine only ever had the first, so
// the conversion is authored; ambient_skylight still steers it. It is also the ONE knob that lifts the sky WITHOUT
// lifting the canopy: it multiplies the radiance you see looking at the sky and never the irradiance that lands on a
// leaf, so raising it moves open sky above the brightest crown instead of taking both up together. 7.5 is where a
// daylight look puts open sky near sRGB (184,208,232) and keeps it clear of the thinnest sunlit crown.
const float SKY_AA = 0.004;
const float SKY_SKY_GAIN = 7.5;
// A transmittance normalized to unit peak: the spectrum with its brightness divided out (§3.5's idiom, and the same
// one the curtain's dye uses). What survives is chlorophyll's green-gold; the knob that reads it carries the level.
vec3 leafHue(vec3 t){ return t / max(max(t.r, t.g), max(t.b, 1e-4)); }
// A layer read for the SKY VIEW (§4.9). Same texture, same Beer's law, one difference: OUTSIDE the baked canopy box
// there is no canopy, so the ray sees open sky. The floor path never needs this (its frame lives inside the box),
// but an upward ray leaves the box within a few metres of height, and CLAMP_TO_EDGE would smear the border texel
// across the whole periphery of the frame instead of opening onto blue.
// SKY VIEW's layer tap, and it comes apart into two quantities on purpose (§4.9). .rgb is the FOLIAGE's
// per-channel transmittance; .a is the WOOD's, neutral because wood blocks every colour equally. They are stored in
// different channels of the same texel because they are different KINDS of occluder to the scatter term below: a
// leaf takes light out of the ray and puts some of it back, wood only takes it out. Outside the baked box both are
// 1 — beyond the grove there is open sky, and an upward frame leaves that box within metres.
vec4 tapUpLW(highp sampler2D t, vec2 world){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(1.0);
  vec4 d = texture(t,uv);
  return vec4(exp(-d.rgb), exp(-d.a));
}
// Closest approach between the upward view ray (origin O, UNIT direction U, t ≥ 0) and the wood segment Pa→Pb.
// Returns (distance, distance along the ray to the closest point) — the second feeds the angular soft edge, since an
// angle times a distance is a length. The floor path measures the wood in PLAN because a shadow is a plan object;
// looking at the wood itself asks for the real 3-D distance to the capsule axis, which is this. Standard clamped
// segment/ray minimisation: solve the unconstrained system, clamp the segment parameter, then re-solve the ray's.
vec2 raySegDist(vec3 O, vec3 U, vec3 Pa, vec3 Pb){
  vec3 V = Pb - Pa, W = O - Pa;
  float b = dot(U,V), c = dot(V,V), d = dot(U,W), e = dot(V,W);
  float den = c - b*b;                                   // |U|²|V|² − (U·V)², with |U| = 1; 0 when the ray runs along the segment
  float s, tt;
  if(den > 1e-9){
    tt = clamp((e - b*d)/den, 0.0, 1.0);
    s  = tt*b - d;
    if(s < 0.0){ s = 0.0; tt = clamp(e/max(c,1e-9), 0.0, 1.0); }   // the closest point fell BEHIND the eye: pin the ray at its origin and re-minimise over the segment
  } else {
    tt = clamp(e/max(c,1e-9), 0.0, 1.0);                 // parallel: any segment point will do, take the foot of W
    s  = max(tt*b - d, 0.0);
  }
  return vec2(length(W + s*U - tt*V), s);
}`;

const GLSL_T_SKY_CAMERA = `    // ---- SKY VIEW (spec §4.9): the THIRD camera, and the amendment to "we never see the tree, only what it casts".
    // The eye lies on the ground at uViewCenter and looks UP; the surface the light reaches is the RETINA. Nothing
    // new is invented — it is the same occluder field against the same source, read along upward rays instead of
    // sun rays, which is why the whole thing is one branch and no new physics. uPitch here is gaze ELEVATION (90° =
    // zenith); the ray basis is the enclosure's, character for character, so the two upward cameras agree. ----
    float cp=cos(uPitch), sp=sin(uPitch);
    float kf=max(tan(0.5*uFov), 1e-4);
    float sxc=(vUv.x-0.5)*uAspect, tyc=(vUv.y-0.5);
    vec3 dir = normalize(vec3(2.0*kf*sxc, cp - 2.0*kf*tyc*sp, sp + 2.0*kf*tyc*cp));
    if(uViewYaw != 0.0){ float cy=cos(uViewYaw), sy=sin(uViewYaw); dir.xy = mat2(cy,-sy,sy,cy)*dir.xy; }   // the grove spins under the gaze, the floor camera's own orbit matrix
    vec3 eye = vec3(uViewCenter, 0.0);
    // (no plan point here: the layer read below is per-layer, not per-pixel. In the mega-shader this branch still had
    // to keep the shared 'world' defined for the cast blocks after it; this variant emits none of them, so it has none.)
    if(dir.z <= 1e-3){
      fog = 1.0;                     // at or under the horizon there is no canopy and no sky model: hand it to the same distance haze the floor path uses over its horizon (§4.7). One behaviour, one colour.
    } else {
      // LAYERS AS ANGULAR SILHOUETTE. The ray crosses layer L's plane at plan eye + dir.xy·(h_L/dir.z) — the same
      // texture, the same tap, and deliberately NO shift by g: g is where the SUN's rays land, and this is the EYE's
      // ray. No recvZ either — these are absolute heights over an eye on the ground. Per-channel Beer's law then
      // comes along for free, because tap() exponentiates a per-channel optical depth: a leaf between us and the sun
      // passes its own green-gold and the canopy GLOWS instead of silhouetting flat. That is the §4.5 leaf
      // transmittance finally seen head-on rather than inferred from a dapple's colour.
      vec2 pL0 = eye.xy + dir.xy*(uLayerHeight[0]/dir.z);
      vec2 pL1 = eye.xy + dir.xy*(uLayerHeight[1]/dir.z);
      vec2 pL2 = eye.xy + dir.xy*(uLayerHeight[2]/dir.z);
      vec2 pL3 = eye.xy + dir.xy*(uLayerHeight[3]/dir.z);
      vec4 qL0 = uLayerCount>0 ? tapUpLW(uLayer[0], pL0) : vec4(1.0);
      vec4 qL1 = uLayerCount>1 ? tapUpLW(uLayer[1], pL1) : vec4(1.0);
      vec4 qL2 = uLayerCount>2 ? tapUpLW(uLayer[2], pL2) : vec4(1.0);
      vec4 qL3 = uLayerCount>3 ? tapUpLW(uLayer[3], pL3) : vec4(1.0);
      // tL = what the FOLIAGE does (this layer's leaves alone) — the only thing the scatter term may read.
      // xL = what the RAY loses (leaves × wood) — the only thing transmittance may read.
      vec3 tL0 = qL0.rgb, tL1 = qL1.rgb, tL2 = qL2.rgb, tL3 = qL3.rgb;
      vec3 xL0 = qL0.rgb*qL0.a, xL1 = qL1.rgb*qL1.a, xL2 = qL2.rgb*qL2.a, xL3 = qL3.rgb*qL3.a;
      vec3 T = vec3(1.0);
      T *= xL0; T *= xL1; T *= xL2; T *= xL3;
      // ---- SINGLE-SCATTER FOLIAGE RADIANCE (§4.9). Transmission alone can only DARKEN: every ray is the sky
      // attenuated, so a leaf is at best a dim filter and a deep crown is black. Foliage in daylight is LIT — light
      // reaches a leaf, scatters inside it and leaves in every direction, so a sunlit crown is brighter than a shaded
      // one against the same sky. That is a source term along the ray, and over a layered field it is a sum, not an
      // integral: L += throughput·(1 − t_L)·ŝ_L·S_L, throughput *= t_L, accumulated eye → sky.
      //  • (1 − t_L) is the share of the beam this layer takes OUT of the ray — the scattering density, measured from
      //    the same tap the silhouette uses, not authored.
      //  • S_L is the irradiance arriving at that layer FROM ABOVE: the sun attenuated by the layers over it along
      //    the SUN's ray (offset +g per metre of rise, since that is where the light comes from), plus the skylight.
      //    Those are extra taps and nothing else — the field already holds everything they need.
      //  • ŝ_L is the layer's own transmittance normalized to unit peak: HUE only (§3.5), so the knob carries
      //    brightness and the chlorophyll spectrum carries colour. Taking the LAYER's rather than one leaf's also
      //    accounts to first order for the scattered light filtering back out through the layer that made it.
      // The bound is structural: Σ throughput·(1 − t_L) telescopes to 1 − Π t_L ≤ 1 per channel, ŝ ≤ 1 and
      // uSkyScatter ≤ 1, so a crown can never radiate more than the light falling on it.
      vec3 Lsc = vec3(0.0);
      if(uSkyScatter > 0.0){
        vec2 gS = uSunDir.xy / max(uSunDir.z, 0.05);
        vec3 A0 = vec3(1.0), A1 = vec3(1.0), A2 = vec3(1.0);
        // the SUN's path takes the FULL transmittance — a twig shadows a leaf exactly as another leaf does; it is
        // only as a SOURCE that wood must not participate.
        vec4 a01, a02, a03, a12, a13, a23;
        if(uLayerCount>1){ a01 = tapUpLW(uLayer[1], pL0 + gS*(uLayerHeight[1]-uLayerHeight[0])); A0 *= a01.rgb*a01.a; }
        if(uLayerCount>2){ a02 = tapUpLW(uLayer[2], pL0 + gS*(uLayerHeight[2]-uLayerHeight[0])); A0 *= a02.rgb*a02.a; }
        if(uLayerCount>3){ a03 = tapUpLW(uLayer[3], pL0 + gS*(uLayerHeight[3]-uLayerHeight[0])); A0 *= a03.rgb*a03.a; }
        if(uLayerCount>2){ a12 = tapUpLW(uLayer[2], pL1 + gS*(uLayerHeight[2]-uLayerHeight[1])); A1 *= a12.rgb*a12.a; }
        if(uLayerCount>3){ a13 = tapUpLW(uLayer[3], pL1 + gS*(uLayerHeight[3]-uLayerHeight[1])); A1 *= a13.rgb*a13.a; }
        if(uLayerCount>3){ a23 = tapUpLW(uLayer[3], pL2 + gS*(uLayerHeight[3]-uLayerHeight[2])); A2 *= a23.rgb*a23.a; }
        // THE SOURCE TERM READS FOLIAGE ONLY. Wood appears in the throughput, which can only take light away, and
        // nowhere in the emission — so a ray that meets nothing but wood scatters exactly nothing.
        vec3 thr = vec3(1.0);
        Lsc += thr*(1.0-tL0)*leafHue(tL0)*(uSunColor*A0 + uAmbient); thr *= xL0;
        Lsc += thr*(1.0-tL1)*leafHue(tL1)*(uSunColor*A1 + uAmbient); thr *= xL1;
        Lsc += thr*(1.0-tL2)*leafHue(tL2)*(uSunColor*A2 + uAmbient); thr *= xL2;
        Lsc += thr*(1.0-tL3)*leafHue(tL3)*(uSunColor    + uAmbient);   // nothing is stacked above the top layer
        Lsc *= uSkyScatter;
      }
      // WOOD AS SILHOUETTE. The same segments the floor casts shadows with (§4.5), read as GEOMETRY this time: no
      // uBulkShift term anywhere here, because that vector is where the wood's shadow FALLS and we are looking at the
      // wood itself. The sway is kept, each endpoint drifting by its own height fraction exactly as the cast does, so
      // the trunks lean in unison with the crowns — §5.1's coherent band watched directly instead of read off a floor.
      // Perspective alone converges them on the zenith; nothing draws a column.
      if(uOccCount>0){
        for(int k=0;k<${MAX_OCC};k++){
          if(k>=uOccCount) break;
          vec4 P = texelFetch(uOccTex, ivec2(k,0), 0); vec4 H = texelFetch(uOccTex, ivec2(k,1), 0);
          vec3 Pa = vec3(P.xy + uOccSway*(H.x/uOccHRef), H.x);
          vec3 Pb = vec3(P.zw + uOccSway*(H.y/uOccHRef), H.y);
          vec2 ds = raySegDist(eye, dir, Pa, Pb);
          // soft edge = the greater of a pixel's angular footprint and the source's core radius, carried out along
          // the ray. HONEST v1: a silhouette is θ-soft only where it stands against the SOURCE and knife-sharp
          // against blue sky, and one constant angle cannot know which — it is small either way, and the alternative
          // needs the source's angular coverage at the wood's own position, which is a second ray march.
          float pen = ds.y * max(SKY_AA, uSrcAngR.x);
          // wood occludes only where it stands IN FRONT of the eye (closest approach out along the ray, ds.y > 0).
          // At ds.y = 0 the nearest wood point is AT or behind the eye — an eye beside (or planted on the axis of)
          // a trunk must not be shadowed by it in every direction: that darkens the ENTIRE frame by exp(-tau), sky
          // and sun included. A 5-20 cm ramp keeps the gate C1; wood genuinely crossed by the gaze (ds.y large,
          // ds.x < radius) still blocks fully.
          float infront = smoothstep(0.05, 0.2, ds.y);
          float e = exp(-uOccTau * infront * (1.0 - smoothstep(H.z, H.z + pen, ds.x)));   // Beer's law, same as the cast: overlaps add optical depth
          T *= e;
          Lsc *= e;   // wood stands BELOW the crowns on an upward ray, so it occludes the canopy's own glow as it occludes the sky behind it
        }
      }
      acc = T;   // the SAME quantity acc has always been — "how much of the light got through here" — so the mesopic hook at the tail reads it unchanged, now cued by canopy density instead of shade depth
      // THE SOURCE, SEEN. §3.1 said the sun is not a point and §3.2 said every dapple is its image; this is the
      // first time the thing being imaged is in frame. Both regions come straight from the sampler: a core disk of
      // uSrcAngR.x and a halo annulus out to uSrcAngR.y, each at the radiance its own post-cloud weight spread over
      // its own solid angle gives — so raising cloud_thickness drains the disk into the aureole HERE by exactly the
      // amount it softens the dapples THERE. The annulus is flat rather than a falloff because the sampler's is
      // flat: a smooth glow would look better and would no longer be the source the cast is drawn from.
      float aa = min(SKY_AA, 0.35*max(uSrcAngR.x, 1e-5));
      float ang = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
      float inCore = 1.0 - smoothstep(uSrcAngR.x - aa, uSrcAngR.x + aa, ang);
      float inSrc  = 1.0 - smoothstep(uSrcAngR.y - aa, uSrcAngR.y + aa, ang);
      float L = mix(uSrcAngL.y, uSrcAngL.x, inCore) * inSrc;
      if(uSrcMoon.y > 0.0){
        // ECLIPSE (§3.4): the same moon disk the sampler punches out of its weights, applied angularly in the SAME
        // source plane — so the crescent you look at is the crescent the dapples image. Reconstructing that plane is
        // what makes it the same: uProj's eigenvectors say the sampler's offsets run along the sun's own AZIMUTH
        // direction (an ELEVATION offset in the sky, stretched 1/sin²) and perpendicular to it (a horizontal
        // cross-sun offset, stretched 1/sin), so the two axes below are that basis, lifted back into angle.
        float ce = length(uSunDir.xy);
        vec3 sHor = ce > 1e-4 ? vec3(-uSunDir.y, uSunDir.x, 0.0)/ce : vec3(0.0, 1.0, 0.0);   // a sun at the exact zenith has no azimuth; any horizontal axis is then as good as another
        vec3 sUp  = cross(uSunDir, sHor);                     // in the sun's vertical plane, toward the zenith
        float ca = ce > 1e-4 ? uSunDir.x/ce : 1.0, sa = ce > 1e-4 ? uSunDir.y/ce : 0.0;
        vec2 q = vec2(dot(dir, ca*sUp - sa*sHor), dot(dir, sa*sUp + ca*sHor));   // the ray's offset in the sampler's own (x,y)
        L *= smoothstep(uSrcMoon.y - aa, uSrcMoon.y + aa, length(q - vec2(uSrcMoon.x, 0.0)));
      }
      // COMPOSITION: T·(sky + source). No receiver material of any kind — no Tt, no dye, no folds, no seams, no
      // ground albedo — because there is no surface between the canopy and the eye. The sky is attenuated by the
      // same T the sun is: leaves dim the blue behind them exactly as they dim the disk.
      skyRad = (uAmbient*SKY_SKY_GAIN + uSunColor*L) * T + Lsc;   // transmitted source + sky, plus what the leaves themselves radiate. At sky_scatter 0, Lsc is exactly 0.
    }`;

const GLSL_T_SKY_MATERIAL = `    col = skyRad;                                          // SKY VIEW: no receiver at all — the branch above already answered with radiance (§4.9)`;

// ---- the layer sample loop (§4.6), the general-geometry occluder tier: every cast camera runs it, and the
// receiver enters only as recvZ (0 on the floor, height up the cloth, the hit's height on a tent panel). ----
const GLSL_T_LAYERS = `  bool ca = (uChroma.r!=1.0 || uChroma.g!=1.0 || uChroma.b!=1.0);   // diffraction on? else the byte-identical single-tap path
  // the per-layer shift uses the occluder's height RELATIVE TO THE RECEIVER point, (uLayerHeight - recvZ): on the
  // floor recvZ=0 so this is the plain layer height (byte-identical); on the vertical curtain recvZ is the height
  // up the cloth, so an occluder above the cloth point projects its shadow onto it — the pattern stands up (§4.9).
  for(int i=0;i<MAX_SAMPLES;i++){
    if(i>=uSampleCount) break;
    vec2 g = uProj * uSamples[i].xy + uBulkShift;   // ground displacement per unit height: ellipse/shear of the sample + the bulk sun-angle offset (§4.8)
    float w = uSamples[i].z;
    // light must clear EVERY layer -> multiply transmittance; shift grows with height
    vec3 T = vec3(1.0);
    if(ca){   // diffraction: read each channel at its own λ-scaled shift (red spreads more) -> colour fringe at every leaf edge
      if(uLayerCount>0) T *= tapCA(uLayer[0], world, g, uLayerHeight[0]-recvZ+extraThrow, uChroma);
      if(uLayerCount>1) T *= tapCA(uLayer[1], world, g, uLayerHeight[1]-recvZ+extraThrow, uChroma);
      if(uLayerCount>2) T *= tapCA(uLayer[2], world, g, uLayerHeight[2]-recvZ+extraThrow, uChroma);
      if(uLayerCount>3) T *= tapCA(uLayer[3], world, g, uLayerHeight[3]-recvZ+extraThrow, uChroma);
    } else {
      if(uLayerCount>0) T *= tap(uLayer[0], world + (uLayerHeight[0]-recvZ+extraThrow)*g);
      if(uLayerCount>1) T *= tap(uLayer[1], world + (uLayerHeight[1]-recvZ+extraThrow)*g);
      if(uLayerCount>2) T *= tap(uLayer[2], world + (uLayerHeight[2]-recvZ+extraThrow)*g);
      if(uLayerCount>3) T *= tap(uLayer[3], world + (uLayerHeight[3]-recvZ+extraThrow)*g);
    }
    acc += w*T;                              // sum of shifted sharp shadows == soft shadow
  }`;

// ---- the woody occluder as a CAST (§4.5). Not emitted in the sky variant, which reads the same segments as
// geometry inside its own camera block instead. ----
const GLSL_T_WOOD_CAST = `  // woody occluder (spec §4.5), evaluated ONCE per pixel (NOT per sample — that stalled). The trunk + main limbs
  // cast one CONNECTED shadow using the central sun direction (uBulkShift), with a soft edge that GROWS with height
  // to fake the area-light penumbra. Multiplies the SUN term only (wood blocks the beam, not the ambient sky).
  if(uOccCount>0){
    float woodT = 1.0;
    for(int k=0;k<${MAX_OCC};k++){
      if(k>=uOccCount) break;
      vec4 P = texelFetch(uOccTex, ivec2(k,0), 0); vec4 H = texelFetch(uOccTex, ivec2(k,1), 0);
      vec2 A = P.xy + uOccSway*(H.x/uOccHRef) - (H.x-recvZ)*uBulkShift;   // a's shadow at its height RELATIVE to the receiver (recvZ=0 floor → unchanged; curtain → projected up the cloth, §4.9)
      vec2 B = P.zw + uOccSway*(H.y/uOccHRef) - (H.y-recvZ)*uBulkShift;   // b's below — segment shadow runs a→b, connecting neighbours
      vec2 ab = B - A, ap = world - A;
      float seg = clamp(dot(ap,ab)/max(dot(ab,ab),1e-7), 0.0, 1.0);
      float dist = length(ap - seg*ab);
      float pen = max(0.3*H.z, mix(H.x,H.y,seg)*uOccPenumbra);   // penumbra grows with height (fakes the disk integral)
      float inside = 1.0 - smoothstep(H.z, H.z + pen, dist);
      woodT *= exp(-uOccTau * inside);                          // Beer's law; overlaps add optical depth
    }
    acc *= woodT;
  }`;

const GLSL_T_POST = `  // ---- Purkinje / mesopic dusk shift (§3.5): as the sun sets the eye's rods take over the dim shade —
  // colour desaturates toward a blue-green grey and saturated reds darken first, while the bright dapples
  // stay photopic and warm. Two REAL cues drive it (no absolute luminance exists here): global duskness
  // from elevation (uTwilight) × the local shade darkness (acc — exposure-independent). Linear HDR. ----
  const vec3 ROD_BLUE = vec3(0.92, 1.0, 1.30);          // rods peak ~505nm -> blue-green, not pure blue
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float rod = (1.0 - smoothstep(0.15, 0.6, dot(acc, LUMA))) * uTwilight * uMesopic;  // 1 deep shade, 0 dapples
  col = mix(col, dot(col, LUMA)*ROD_BLUE, rod*0.6);     // cap 0.6 so the deepest shade keeps a hint of green
  col = mix(col, uHazeColor, fog);                       // far floor dissolves into atmospheric haze (§4.7); fog==0 at pitch 0
  // The Look's tail (exposure/curve/contrast/gamma) is toneTail() — shared verbatim with the diffusion composite.
  // Skipping it is the ONLY thing uLinearOut changes: what leaves here is then the same linear HDR radiance the
  // fabric produced, which is the space a lateral spread has to happen in (§4.9).
  if(uLinearOut == 0) col = toneTail(col);
  frag = vec4(col,1.0);`;

// ---- the per-camera prologues: each variant declares the state ITS blocks read, and nothing else. ----
const GLSL_T_PRO_FLOOR = `  vec2 world; float fog = 0.0; float extraThrow = 0.0; float recvZ = 0.0;
  vec3 acc = vec3(0.0);      // "how much of the light got through here" — the quantity the whole pipeline is about
  // recvZ stays 0 here and the shared occluder reads below spell it out anyway: the floor IS the recvZ = 0 case
  // of §4.9's height-minus-recvZ generalization, so those lines are the same lines the cloth and the tent run.`;

const GLSL_T_PRO_CLOTH = `  vec2 world; float fog = 0.0; float extraThrow = 0.0; float recvZ = 0.0; vec2 clothUV = vec2(0.0), castUV = vec2(0.0);
  vec3 foldF = vec3(0.0);   // the pleat field at this cloth point, evaluated ONCE: the warp below and the velvet shading later read the very same (ŝ, dŝ/dx, peak) — that is the shared-phase invariant, structural
  float beamF = 1.0, skyF = 1.0, recvAtten = 1.0;   // the ENCLOSURE's per-panel light, which a flat cloth never varies — constants here, so the shared irradiance line folds to the curtain's old one exactly
  float meshF = 0.0;         // the ENCLOSURE's per-panel MATERIAL; a curtain is one fabric top to bottom, so both mix() terms below fold away
  vec3 acc = vec3(0.0);      // "how much of the light got through here"`;

const GLSL_T_PRO_TENT = `  vec2 world; float fog = 0.0; float extraThrow = 0.0; float recvZ = 0.0; vec2 clothUV = vec2(0.0), castUV = vec2(0.0);
  vec3 foldF = vec3(0.0);   // the pleat field at this cloth point, evaluated ONCE: the warp below and the velvet shading later read the very same (ŝ, dŝ/dx, peak) — that is the shared-phase invariant, structural
  float beamF = 1.0, skyF = 1.0, recvAtten = 1.0;   // the ENCLOSURE's per-panel light: beam incidence, sky-hemisphere view, depth fade × ridge seam. All 1 on the floor and the curtain, so their irradiance line below is the old one exactly
  float meshF = 0.0;         // the ENCLOSURE's per-panel MATERIAL: 1 on a side panel ABOVE the shoulder hem, where the cloth is mesh rather than nylon. 0 everywhere else and on every other receiver
  vec3 acc = vec3(0.0);      // "how much of the light got through here"`;

const GLSL_T_PRO_SKY = `  float fog = 0.0;
  vec3 skyRad = vec3(0.0);   // SKY VIEW's finished radiance — this branch answers with light directly, having no surface to hand it to
  vec3 acc = vec3(0.0);      // "how much of the light got through here" — the sky view fills it with its own upward transmittance (see below), so the mesopic hook at the tail reads it unchanged`;

const GLSL_T_FAITH_FLOOR = `  if(uFaithful != 0){
    // FAITHFUL (§4.5/§4.9): the disk convolution at continuous per-leaf heights, pre-integrated as geometry at bake
    // time -> one tap. The receiver/sky guards this condition used to carry are gone: the enclosure and the sky view
    // are separate programs that never emit this branch at all (see buildTransport).
    acc = tapFaith(world);           // FLOOR: cast in floor (x,y), tap at world
  } else {`;

const GLSL_T_FAITH_CLOTH = `  if(uFaithful != 0){
    // FAITHFUL (§4.5/§4.9): the disk convolution at continuous per-leaf heights, pre-integrated as geometry at bake
    // time -> one tap. The receiver/sky guards this condition used to carry are gone: the enclosure and the sky view
    // are separate programs that never emit this branch at all (see buildTransport).
    acc = tapFaith(castUV);          // CURTAIN: cast onto the vertical cloth (u,v), tap at the warped coord
  } else {`;

const GLSL_T_COL_DECL = `  // ---- Receiver (§4.x/§4.9). The landed irradiance (acc·uSunColor + uAmbient, linear HDR) is answered by the
  // surface: the floor REFLECTS off its albedo, the two cloth receivers TRANSMIT through woven fabric, and the
  // sky view has no surface to answer with and already holds its radiance. One line per variant, chosen at build. ----
  vec3 col;`;

// ============================================================================
// THE CAMERA REGISTRY (spec §4.9 / §9). B1 made a camera a compile-time selection; this makes it DATA.
//
// The three consumers below — the shader assembler, the uniform-location table and the per-frame upload — all
// used to carry their own copy of the same four-way question, as three predicate chains that had to be kept in
// agreement by hand. They now read ONE table. A camera is an entry; adding a receiver is writing an entry, not
// editing three chains, and the extension contract in §9 is the rest of what an entry owes.
//
// Two tables, deliberately: TRANSPORT_GROUPS is the vocabulary (what a uniform group DECLARES and what its
// locations are called), CAMERAS is the sentence (which groups a camera speaks, in what order, and which body
// snippets it runs). The group's third half — the upload — lives in create()'s GROUP_UPLOAD under the SAME key,
// because it needs engine state a module-level table cannot see. Naming the two halves together is the point:
// a uniform declared in one variant and uploaded in another is now a key that does not line up, not a bug.
//
// MATERIALS RIDE THE CAMERA for now — each entry names its own material snippets. That is honest while every
// camera has exactly one material. The moment a real look wants a camera×material pair that does not exist
// (§4.9's named future: the enclosure's mesh panels read as sky, a sky view with a surface in it), materials
// become the second axis. Inventing that axis before a look needs it would be inventing a combination.
// ============================================================================

// ---- THE VOCABULARY. One entry per uniform group: the GLSL it declares, and the location-table keys that GLSL
// supports. A group with no `locs` contributes only functions (the taps, the fold field, the warp). ----
const TRANSPORT_GROUPS = {
  head:      { decls: GLSL_T_HEAD,            locs: { aspect:'uAspect', viewCenter:'uViewCenter', origin:'uCanopyOrigin', extent:'uCanopyExtent',
                                                      sun:'uSunColor', ambient:'uAmbient', heights:'uLayerHeight[0]', layerCount:'uLayerCount',
                                                      layers:['uLayer[0]','uLayer[1]','uLayer[2]','uLayer[3]'] } },
  rayView:   { decls: GLSL_T_RAY_VIEW,        locs: { pitch:'uPitch', fov:'uFov', yaw:'uViewYaw' } },
  occ:       { decls: GLSL_T_OCC_DECLS,       locs: { occTex:'uOccTex', occCount:'uOccCount', occTau:'uOccTau', occSway:'uOccSway', occHRef:'uOccHRef' } },
  transport: { decls: GLSL_T_TRANSPORT_DECLS, locs: { samples:'uSamples[0]', count:'uSampleCount', proj:'uProj', bulkShift:'uBulkShift' } },
  woodCast:  { decls: GLSL_T_WOOD_CAST_DECLS, locs: { occPenumbra:'uOccPenumbra' } },
  tap:       { decls: GLSL_T_TAP },
  ca:        { decls: GLSL_T_CA_DECLS,        locs: { chroma:'uChroma' } },
  faith:     { decls: GLSL_T_FAITH_DECLS,     locs: { faithful:'uFaithful', faithTex:'uFaithTex', faithOrigin:'uFaithOrigin', faithExtent:'uFaithExtent' } },
  sunDir:    { decls: GLSL_T_SUN_DIR_DECLS,   locs: { sunDir:'uSunDir' } },
  floor:     { decls: GLSL_T_FLOOR_DECLS,     locs: { viewExtent:'uViewExtent', farSmear:'uFarSmear', ground:'uGround' } },
  cloth:     { decls: GLSL_T_CLOTH_DECLS,     locs: { viewExtent:'uViewExtent', clothY:'uClothY' } },
  fabric:    { decls: GLSL_T_FABRIC_DECLS,    locs: { tt:'uTt', fabricTint:'uFabricTint', scatter:'uScatter', sheen:'uSheen',
                                                      foldDepth:'uFoldDepth', foldScale:'uFoldScale', foldCoarsen:'uFoldCoarsen', foldWarp:'uFoldWarp' } },
  fold:      { decls: GLSL_T_FOLD_DECLS },
  warp:      { decls: GLSL_T_WARP_DECLS },
  window:    { decls: GLSL_T_WINDOW_DECLS,    locs: { mullion:'uMullion', mullPenumbra:'uMullPenumbra', window:'uWindow', windowWall:'uWindowWall' } },
  tent:      { decls: GLSL_T_TENT_DECLS,      locs: { tentRidge:'uTentRidge', tentHalfW:'uTentHalfW', tentCrownW:'uTentCrownW', tentLen:'uTentLen',
                                                      tentEndLean:'uTentEndLean', tentShoulderH:'uTentShoulderH', tentShoulderW:'uTentShoulderW',
                                                      tentEndApex:'uTentEndApex', tentHipRake:'uTentHipRake', tentEye:'uTentEye',
                                                      tentFade:'uTentFade', tentSeam:'uTentSeam', tentMesh:'uTentMesh' } },
  sky:       { decls: GLSL_T_SKY_DECLS,       locs: { skyScatter:'uSkyScatter', srcAngR:'uSrcAngR', srcAngL:'uSrcAngL', srcMoon:'uSrcMoon' } },
  post:      { decls: GLSL_T_POST_DECLS,      locs: { haze:'uHazeColor', twilight:'uTwilight', mesopic:'uMesopic', linearOut:'uLinearOut',
                                                      exposure:'uExposure', contrast:'uContrast', tone:'uToneMap' } },
};

// ---- THE SENTENCES. One entry per camera. `groups` is ORDERED and that order is the emitted declaration order —
// GLSL's one rule is declaration before use, which is why the fabric's uniforms precede the fold field that reads
// them and the warp precedes the window whose bars read its throw. `faith` is the faithful tier's opening branch,
// null on the cameras that have no flat cast frame to pre-bake into. `params` is documentation, not enforcement:
// the knob families an entry answers for, so a reader can find the other end of a receiver from here. ----
const CAMERAS = {
  floor: {
    groups: ['head','rayView','occ','transport','woodCast','tap','ca','faith','floor','post'],
    prologue: GLSL_T_PRO_FLOOR, camera: GLSL_T_FLOOR_CAMERA, faith: GLSL_T_FAITH_FLOOR,
    material: [GLSL_T_FLOOR_MATERIAL],
    params: ['ground_*', 'far_smear', 'view_*'],
    note: 'the light lands on the ground and REFLECTS (§4.7) — the park default, and the only camera with an albedo',
  },
  cloth: {
    groups: ['head','occ','transport','woodCast','tap','ca','faith','sunDir','cloth','fabric','fold','warp','window','post'],
    prologue: GLSL_T_PRO_CLOTH, camera: GLSL_T_CLOTH_CAMERA, faith: GLSL_T_FAITH_CLOTH,
    material: [GLSL_T_FABRIC_MATERIAL, GLSL_T_WINDOW_APPLY, GLSL_T_FABRIC_TAIL],
    params: ['fabric_*', 'fold_*', 'velvet_sheen', 'cloth_distance_m', 'mullion_*', 'window_*', 'view_extent_m', 'view_center_*'],
    note: 'a standing curtain seen head-on, TRANSMITTING (§4.9); the only camera with a flat plane behind it, so the window and the pleat warp are its alone',
  },
  enclosure: {
    groups: ['head','rayView','occ','transport','woodCast','tap','ca','sunDir','fabric','fold','tent','post'],
    prologue: GLSL_T_PRO_TENT, camera: GLSL_T_TENT_CAMERA, faith: null,
    material: [GLSL_T_FABRIC_MATERIAL, GLSL_T_FABRIC_TAIL],
    params: ['fabric_*', 'fold_*', 'velvet_sheen', 'tent_*', 'view_*'],
    note: 'the same fabric as a closed tent stood AROUND the viewer, ray-cast per pixel (§4.9). No faithful tier: the pre-bake needs one flat cast frame and a polytope has none',
  },
  sky: {
    groups: ['head','rayView','occ','sunDir','sky','post'],
    prologue: GLSL_T_PRO_SKY, camera: GLSL_T_SKY_CAMERA, faith: null,
    material: [GLSL_T_SKY_MATERIAL],
    params: ['sky_*', 'view_pitch_deg', 'view_fov_deg', 'view_yaw_deg', 'view_center_*'],
    note: 'no surface at all — the RETINA receives, so the field is read along the eye\'s rays instead of the sun\'s (§4.9). The one camera that runs no cast, which is why it declares neither the sample integral nor a material',
  },
};
const TRANSPORT_CAMERAS = Object.keys(CAMERAS);
// The groups that carry a per-frame UPLOAD, named at module level because that is the only half of the upload
// registry anything outside an engine can see: the functions themselves live in create()'s GROUP_UPLOAD, since
// they need engine state (the GL objects, params, the grove) a module-level table cannot reach. This list is the
// seam between the two — create() checks its table against it on construction, and registry.test.js checks it
// against TRANSPORT_GROUPS and CAMERAS. Neither half can drift without one of those saying so.
const GROUP_UPLOAD_KEYS = ['head','rayView','occ','transport','woodCast','ca','faith','sunDir','floor','cloth','fabric','window','tent','sky','post'];

// The assembler. Every conditional it used to carry is now a lookup: the decls are the entry's groups in order,
// the body is the entry's own snippets, and the only branch left is the one real structural fork — whether this
// camera casts along the sun's rays at all.
function buildTransport(camera){
  const e = CAMERAS[camera];
  if(!e) throw new Error(`komorebi: unknown transport camera "${camera}"`);
  const p = e.groups.map(g => TRANSPORT_GROUPS[g].decls);
  p.push('void main(){', e.prologue, e.camera);
  if(e.groups.includes('transport')){          // a CAST camera: the faithful tap or the sample loop, then the wood
    if(e.faith) p.push(e.faith);
    p.push(GLSL_T_LAYERS);
    if(e.faith) p.push('  }');
    p.push(GLSL_T_WOOD_CAST);
  }
  p.push(GLSL_T_COL_DECL, ...e.material, GLSL_T_POST, '}');
  return p.join('\n');
}


export { TRANSPORT_GROUPS, CAMERAS, TRANSPORT_CAMERAS, GROUP_UPLOAD_KEYS, buildTransport };
