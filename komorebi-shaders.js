import { MAX_LAYERS, MAX_FILL_DIRS, BOUNCE_BOX } from './komorebi-params.js';
import { LEAF_VARIANTS } from './komorebi-leaf.js';
import { DEPTH_L0, DEPTH_W } from './komorebi-air.js';

// ===========================================================================
// Shaders
// ===========================================================================

// The tree view's leaf table (komorebi-tree-view.js slabTable): how many samples of √T it holds per channel.
const SLAB_N = 64;

// ---- A TEXEL IS A MIXTURE, NOT A SLAB (§4.5): ONE snippet, carried by every program that reads a baked texel as a mixture (above leaf_diffuse 0, and at 0 under edge_area) — the cast taps
// (tap, tapCA), the faithful stamp (FS_FAITH) and the shared ray (GLSL_SKY_RAY: the sky camera and the fill). The bake ADDS: rgb = τ = Σ τ_i·cov_i, alpha
// c = Σ cov_i. That is exact for leaves that fill the texel and stack, and Jensen-dark at an edge when read as a slab of depth τ: a texel 30% under a leaf of
// depth 2.8 is 70% open sky and 30% dark leaf (T 0.72), not a thin bright leaf of depth 0.84 (t 0.43) — a cream rim in the glow, a dark halo round every beam.
// With a = min(c, 1) the leaf AREA, τ̄ = τ/a the representative leaf's depth (fade-invariant, and bilinear-safe: it interpolates as a coverage-weighted
// mean of the leaves' depths) and κ = k·c/a (k per leaf, c/a leaves deep where they stack):
//   T  = (1 − a) + a·e^−τ̄          what the texel truly passes (hue, skylight, the light a leaf sends on downward)
//   Tb = (1 − a) + a·e^(−τ̄ − κ)    its BALLISTIC share, what still travels as a beam
//   emit = T − Tb                   the diffuse light the leaf sends on; the gap emits nothing
// Exact for one leaf at any c ≤ 1 and for leaves stacked over the whole texel (c = 2); between, a bounded slab residue. emit ≡ T − Tb by construction, so
// every telescoping sum closes. c < 1e-4 is an empty texel. At c ≥ 1 it is the old slab to the bit. Callers gate on k > 0 or on edge_area (uEdgeArea): at d = 0 with edge_area off it is never called, and the depth-averaged soft edge stays, byte-identical. At k = 0 Tb is T bit for bit.
const GLSL_TEXEL_MIX = `void texelMix(vec3 tau, float c, float k, out vec3 T, out vec3 Tb){
  if(c < 1e-4){ T = vec3(1.0); Tb = T; return; }   // an empty texel (a leaf not there yet, a bake's rounding dust): nothing to pass, nothing to kill
  float a = min(c, 1.0);                           // the leaf AREA of the texel
  vec3 tbar = tau / a;                             // the representative leaf's depth
  T  = vec3(1.0 - a) + a*exp(-tbar);
  Tb = vec3(1.0 - a) + a*exp(-tbar - k*c/a);
}`;

// ---- THE LEAF'S OUTLINE, as ONE snippet (§4.5, P4a-2): the three programs that cut a leaf's mask — the layer bake, the faithful stamp and the litter carpet — take
// it from here, so the edge law cannot be spelled two ways. An outlined leaf is cut by q' = |l| − r(θ) + 1 where the ellipse is cut by |l|: the same ramp reads it
// (smoothstep(1 − uEdge, 1, q')), with the width it has at a tip and at the bottom of a sinus, where |l|/r(θ) would double it at a tip. It is ~0.6× as wide across a
// steep flank — the ramp is radial, and a flank is not — which is named and fine: the bake's edge is a penumbra, and the carpet's one texel. r(θ) is the profile of
// komorebi-leaf.js, from the leaf's origin (the maple's petiole base, a point on the beech's midrib): θ across the texture (REPEAT: the seam at ±π is one place), one row per variant, sample i at the texel centre (i + ½)/256.
const GLSL_LEAF_Q = `uniform highp sampler2D uLeafTex;   // R16F: r(θ) per variant, in the leaf's own unit frame (area-normalised, ∮½r²dθ = π)
uniform float uLeafRows;                   // 0 = the species' eight rows (the literal divide below, as it always was); else the rows of a varied grove's table (leaf_variety: 64), which only that grove sets
float leafQ(vec2 l, float variant){
  float m = length(l);
  vec2 d = dot(l, l) < 1e-12 ? vec2(1.0, 0.0) : l;                 // atan(0, 0) is undefined: at the base itself any direction will do
  float u = atan(d.y, d.x)*0.15915494 + 0.5;                       // θ/2π + ½
  float v = (variant + 0.5)/${LEAF_VARIANTS}.0;                              // a row's centre: a read between two variants is no leaf
  // a varied grove's own table: its first column and the blend toward the next (0.1..0.9 of a row, komorebi-grove.js), the two rows' radii mixed so a leaf
  // between two light classes hangs between their outlines; a whole row (the carpet's) reads w 0. The literal line above is kept for the rest, because a
  // divide by a uniform may compile to a multiply by a reciprocal (2.5 ULP) where a literal one may not
  if(uLeafRows > 0.0){
    float r0 = floor(variant), w = clamp((variant - r0 - 0.1)/0.8, 0.0, 1.0);
    return m - mix(texture(uLeafTex, vec2(u, (r0 + 0.5)/uLeafRows)).r, texture(uLeafTex, vec2(u, (r0 + 1.5)/uLeafRows)).r, w) + 1.0;
  }
  return m - texture(uLeafTex, vec2(u, v)).r + 1.0;
}`;

const VS_BAKE = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1] quad corner
layout(location=1) in vec4 iA;        // center.xy, A (long half), B0 (face-on short half)
layout(location=2) in vec4 iB;        // angle, restTilt, swingGain, swingPhase
layout(location=3) in vec4 iC;        // tau.rgb, clusterId (which twig — hierarchy lookup)
layout(location=4) in vec4 iD;        // orbit: ampX, ampY, orientation, phase (incoherent drift)
layout(location=5) in float iFade;    // the marginal-leaf × marginal-tree fade the CPU already folded into iC.xyz (§5.3) — alpha has to carry it too
uniform vec2  uCanopyOrigin;          // -extent/2
uniform vec2  uCanopyExtent;          // (extent, extent)
uniform float uMorph;                 // drift phase (incoherent band, §5.2)
uniform float uMorphAmount;           // orbit radius scale (m)
uniform vec2  uSway;                  // trunk (coherent) translation for this layer (§5.1)
uniform highp sampler2D uClusterTex;  // per-clump dynamic bend angles (limb, twig) — radians
uniform highp sampler2D uClusterGeom; // per-clump static geometry: clump centre + trunk pivot
uniform float uWindLevel;             // signed sway fraction u(t) — drives leaf swing intensity
uniform float uAir;                   // wind_air: 0 the flutter follows the sway |u|, 1 the air at each clump (the cluster texture's row 1)
uniform float uDepth;                 // wind_depth: 0 every leaf rocks, >0 only as deep into its crown as the wind reaches (depthGate)
uniform float uWindTime;              // seconds, for leaf flutter
uniform float uLeafSwing;             // master: how far leaves rock as wind blows
uniform float uFlutterFreq;           // leaf flutter rate (Hz)
uniform float uStemLen;               // twig stem length: pivot offset toward the limb (swing, not spin)
// GROVE-WIDE COVERAGE (§9). The per-leaf 'cov' the CPU folds into iC.xyz is the fractional-leaf fade — a marginal
// leaf or a marginal tree is faded in by SCALING ITS OPTICAL DEPTH, which the additive bake makes exact: at 0 the
// leaf contributes no depth and is simply not there. This is that same lever with the grove as its subject, so two
// groves can be baked into one layer texture at complementary coverage and the arrangement dissolves between them
// rather than cutting. 1.0 is the identity and the only value any non-transitioning frame ever sees.
uniform float uCoverage;
uniform vec4  uShapeBox;              // the quad's box in the leaf's own frame: (centre.xy, half.xy). The ellipse's (0, 0, 1, 1) is the square it always was; an outline's is the union of its variants' extents (komorebi-leaf.js)
uniform float uLeafIdFrac;            // the packing of the outline's row in the cluster id's fraction: 32 for the species' eight rows, 128 for a varied grove's 64 (leaf_variety) — x·32 and x·128 are exact, so the multiply by 32 is a literal's bits
out vec2 vLocal;
out vec3 vTau;
out float vFade;
flat out float vVariant;
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  // ---- leaf rocks with the wind: footprint foreshortens -> dapple changes SHAPE (§4.5) ----
  float wm = uAir > 0.0 ? abs(uWindLevel)*(1.0 - uAir) + texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 1), 0).x*uAir : abs(uWindLevel);   // flutterLevel (komorebi-air.js): the air where this leaf hangs, under wind_air
  float swing = uLeafSwing*swingGain*(0.5*uWindLevel + wm*sin(uWindTime*uFlutterFreq*6.2831853+swingPhase));
  if(uDepth > 0.0){   // depthGate (komorebi-air.js): only as deep into the crown as the wind reaches, at this clump's depth (row 1 .y)
    float dg = clamp((wm/(uDepth*${DEPTH_L0}) - texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 1), 0).y)/${DEPTH_W} + 1.0, 0.0, 1.0);
    swing *= dg*dg*(3.0 - 2.0*dg);
  }
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
  // mat2 fills columns: positive joint bends turn counterclockwise, as the CPU wood and wind torque do.
  float ct=cos(thT), st=sin(thT);
  vec2 p    = Jtwig + mat2(ct,st,-st,ct)*(leafRest - Jtwig); // twig swings clump about its base joint
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,sl,-sl,cl)*(p - BL);            // limb swings clump about the trunk
  // The leaf outline uses a clockwise rest-angle basis, so joint bends subtract from that angle.
  float ang = angle - thL - thT + 0.2*swing;               // leaf orientation rotates with the branch
  // ---- place the (foreshortened, rocked) leaf quad ----
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 lc = aCorner*uShapeBox.zw + uShapeBox.xy;   // the corner in the leaf's own frame: aCorner·1 + 0 for the ellipse (the same bits), the outline's box for a lobed leaf
  vec2 world = base + uSway + drift + R*(lc*vec2(A,B));
  vec2 uv = (world - uCanopyOrigin)/uCanopyExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = lc;
  { float x = fract(iC.w)*uLeafIdFrac; vVariant = uLeafIdFrac > 64.0 ? x : floor(x + 0.5); }   // the outline's row, in the cluster id's fraction (komorebi-grove.js): j + row/uLeafIdFrac, and int(iC.w + 0.5) above is still j; a varied grove's (128) is read raw, its fraction the blend leafQ takes
  vTau = iC.xyz * uCoverage;   // x 1.0 is the identity in IEEE, so every non-transitioning frame bakes the bytes it always did
  vFade = iFade * uCoverage;   // the same two lever arms on COVERAGE, so a leaf fading in (or a grove crossfading) fades its ballistic shadow with its tau, not at full weight (§4.5)
}`;

const FS_BAKE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
in float vFade;
flat in float vVariant;
uniform float uEdge;
uniform int uLeafShape;   // 0 = the ellipse (the line below, as ever); else this grove's outline — a uniform, because a crossfade bakes two groves, which may differ, in one pass
${GLSL_LEAF_Q}
out vec4 frag;
void main(){
  // soft elliptical leaf mask -> partial coverage at edges (honest area-averaging)
  float r = length(vLocal);
  if(uLeafShape != 0) r = leafQ(vLocal, vVariant);   // an outlined leaf: q' = |l| − r(θ) + 1, which the ramp below reads exactly as it reads the ellipse's |l|
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  // additive: optical depth ADDS across overlaps (order-independent), unlike transmittance. rgb is the leaf's true depth, alpha its
  // COVERAGE (Σ of the masks, fade included): the one texel carries both transmittances, e^-tau and the beam's e^(-tau - k·alpha) (§4.5)
  frag = vec4(vTau*cov, cov*vFade);
}`;

// ---- THE FLOOR CAMERA, run forwards (the tree seen from the floor camera). GLSL_T_FLOOR_CAMERA (komorebi-transport.js) casts a ray from each pixel to the floor
// from an eye at unit height that the zoom hold scales to `scale` metres: the eye stands H = view_extent·cos²pitch/(2·tan(fov/2)) above the floor, H·tan(pitch)
// back from the looked-at point, turned by the orbit and moved by the pan (cameraPose, komorebi-math.js, says the same). treeClip is that pinhole the other
// way round: a world point to the pixel whose ray passes through it, so a point on the floor lands on the floor's own pixel, and a leaf above it in perspective.
// The depth is the distance along the gaze, near 2 % and far 200 eye heights. ----
const GLSL_TREE_CAMERA = `uniform float uViewExtent;
uniform float uPitch;
uniform float uFov;
uniform float uAspect;
uniform float uViewYaw;
uniform vec2  uViewCenter;
vec4 treeClip(vec3 P){
  float cp = cos(uPitch), sp = sin(uPitch), kf = max(tan(0.5*uFov), 1e-4);
  float scale = uViewExtent*cp*cp/max(2.0*kf, 1e-4), targetY = sp/max(cp, 1e-4);
  float cy = cos(uViewYaw), sy = sin(uViewYaw);
  vec2 q = mat2(cy, sy, -sy, cy)*(P.xy - uViewCenter);              // the floor's orbit, undone
  vec3 v = vec3(q.x/scale, q.y/scale + targetY, P.z/scale - 1.0);   // from the eye, in eye heights
  float depth = v.y*sp - v.z*cp, up = v.y*cp + v.z*sp;              // along the gaze (0, sp, −cp), and up the image (0, cp, sp)
  const float N = 0.02, F = 200.0;
  return vec4(v.x/(kf*uAspect), up/kf, (depth*(F + N) - 2.0*F*N)/(F - N), depth);
}`;

// FAITHFUL leaf bake (spec §4.5): the VS_BAKE body verbatim — same grow/flutter/bend, so the cast matches the
// preview — but each leaf is then sun-projected to the FLOOR at its OWN continuous grown height (world -= uG*iHeight,
// uG = this source sample's ground shift g_i), and mapped into the CAST frame (uFaithOrigin/uFaithExtent), which
// covers where the shadow LANDS (offset by the bulk throw), not the canopy plan. One per source sample → the
// "many suns" convolution done as geometry at continuous heights, so leaves sit on their twigs (no layer cheat).
const GLSL_FAITH_VERTEX = `precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1] quad corner
layout(location=1) in vec4 iA;        // center.xy, A (long half), B0 (face-on short half)
layout(location=2) in vec4 iB;        // angle, restTilt, swingGain, swingPhase
layout(location=3) in vec4 iC;        // tau.rgb, clusterId (which twig — hierarchy lookup)
layout(location=4) in vec4 iD;        // orbit: ampX, ampY, orientation, phase (incoherent drift)
layout(location=5) in float iHeight;  // FAITHFUL: this leaf's continuous floor-height (floorH of its grown z)
layout(location=6) in float iFade;
#ifdef PIVOT
layout(location=8) in float iPivotDrop;   // the share of its twig's bend a leaf on older wood drops (inner_leaves; komorebi-grove.js placeLeaf)
#endif    // the fade the CPU folded into iC.xyz: the ballistic depth k·fade has to ride it (§4.5)
#ifdef SEASON_TRAVEL
layout(location=7) in vec4 iJourney;  // floor landing.xy, clockwise angle, height fraction
uniform highp int uSeasonCast;
#endif
layout(location=9) in float iSide;    // which way this leaf rolls about its long axis, ±1 (komorebi-grove.js): which corners stand above its centre and which below
uniform float uTiltShadow;            // tilt_shadow: the share of each corner's height about the centre the cast throws along the sun. 0 = the plan footprint, to the bit
#ifdef TREE_VIEW
${GLSL_TREE_CAMERA}
out vec3 vWorld;                      // where this corner is, in the world (m)
out vec3 vNormal;                     // the leaf's top face, in the world: n.z ≥ 0
#endif
uniform vec2  uFaithOrigin;           // cast-frame origin (floor space)
uniform vec2  uFaithExtent;           // cast-frame extent (floor space)
uniform vec2  uG;                     // this source sample's ground shift g_i = uProj*sample + uBulkShift
uniform int   uCurtainBake;           // 1 = project onto the VERTICAL curtain plane (§4.9); 0 = the floor (byte-identical)
uniform float uClothY;                // curtain plane world-Y (cy) when uCurtainBake
uniform float uMorph;
uniform float uMorphAmount;
uniform vec2  uSway;
uniform float uHRef;                  // reference height: the coherent sway scales by iHeight/uHRef so the canopy bends as ONE piece anchored at the ground (matches the wood)
uniform highp sampler2D uClusterTex;
uniform highp sampler2D uClusterGeom;
uniform float uWindLevel;
uniform float uAir;
uniform float uDepth;
uniform float uWindTime;
uniform float uLeafSwing;
uniform float uFlutterFreq;
uniform vec4  uShapeBox;              // the quad's box in the leaf's own frame (see VS_BAKE)
uniform float uLeafIdFrac;            // the packing of the outline's row in the cluster id's fraction (see VS_BAKE)
out vec2 vLocal;
out vec3 vTau;
out float vFade;
flat out float vVariant;
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  float wm = uAir > 0.0 ? abs(uWindLevel)*(1.0 - uAir) + texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 1), 0).x*uAir : abs(uWindLevel);   // flutterLevel (komorebi-air.js): the air where this leaf hangs, under wind_air
  float swing = uLeafSwing*swingGain*(0.5*uWindLevel + wm*sin(uWindTime*uFlutterFreq*6.2831853+swingPhase));
  if(uDepth > 0.0){   // depthGate (komorebi-air.js): only as deep into the crown as the wind reaches, at this clump's depth (row 1 .y)
    float dg = clamp((wm/(uDepth*${DEPTH_L0}) - texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 1), 0).y)/${DEPTH_W} + 1.0, 0.0, 1.0);
    swing *= dg*dg*(3.0 - 2.0*dg);
  }
  float B = B0 * max(0.05, abs(cos(restTilt + swing)));
  float th = uMorph + iD.w;
  vec2 lp = vec2(iD.x*cos(th), iD.y*sin(th));
  float co=cos(iD.z), so=sin(iD.z);
  vec2 drift = uMorphAmount * mat2(co,-so,so,co) * lp;
  int cid = int(iC.w + 0.5);
  vec4 geom = texelFetch(uClusterGeom, ivec2(cid,0), 0);
  vec4 bend = texelFetch(uClusterTex,  ivec2(cid,0), 0);   // .x limb bend, .y twig bend, .zw the sway_pitch height affine (see hEff)
  vec2 TB = geom.xy, BL = geom.zw;                         // TB = this twig's REAL grown base (faithful packs it where the layer path packs the tip)
  float thL = bend.x, thT = bend.y;
#ifdef PIVOT
  thT *= 1.0 - iPivotDrop;                                 // a leaf on older wood drops its twig's bend by its pivot weight, so it follows the wood it hangs on
#endif
  // 3-D lean (§5.1): a wind-pitched limb lowers its leaves' height → shorter cast + less drift. The foreshorten is
  // ANCHORED at the limb's attach height: h' = attachH + (h−attachH)·fore, packed as the affine (.z, .w) =
  // (attachH·(1−fore), fore) so the shader is one madd. At the join h' = attachH exactly, so the pitching limb never
  // parts from the trunk axis (which does not pitch). GOTCHA — .z is MODE-dependent: publishBend writes this offset
  // only in faithful mode; on the layer path .z is the synthetic joint's stem seed and VS_BAKE reads it as such. The
  // two must agree per mode, and do because faithful_canopy is a MODE_KEYS flag (a flip rebuilds and republishes).
  float hEff = bend.z + iHeight * bend.w;   // sway_pitch off → (0, 1) → hEff = iHeight, byte-identical.
  // MEDIUM band (§5.4, "gaps morph and rearrange"): the twig swings its clump about TB — the SAME joint, by the
  // same angle and in the same order, that bakeFaithful's refill turns this twig's wood about. So leaf-on-wood
  // registration holds by construction, not by luck; that slip is why the band was dropped here before (§4.5).
  // TB is offset from the clump toward the parent by GROWTH, so it is a real stem joint and §5.1's anti-vortex
  // property comes for free — no uStemLen (the synthetic joint) and no bend.z spread: there is no made-up radial
  // direction left to decorrelate, the grown twig headings already differ. thT rides twig_flex → 0 = rest = byte-identical.
  // sway_pitch composes orthogonally: it only foreshortens iHeight (bend.w) and this is a plan-plane yaw.
  // mat2 fills columns: positive joint bends turn counterclockwise, as the CPU wood and wind torque do.
  float ct=cos(thT), st=sin(thT);
  vec2 p = TB + mat2(ct,st,-st,ct)*(leafRest - TB);      // twig swings the clump about its own grown base
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,sl,-sl,cl)*(p - BL);          // the limb then swings that twig joint AND its clump about the trunk
  // The leaf outline uses a clockwise rest-angle basis, so joint bends subtract from that angle.
  float ang = angle - thL - thT + 0.2*swing;             // orientation rotates with the branch → the footprint presents differently as it turns (§5)
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 lc = aCorner*uShapeBox.zw + uShapeBox.xy;                                 // the corner in the leaf's own frame: the ellipse's square to the bit, or the outline's box (see VS_BAKE)
  vec2 world = base + uSway*(hEff/uHRef) + drift + R*(lc*vec2(A,B));   // coherent sway grows with height (0 at the ground) — leaves stay on their twigs, base anchored
  // THE LEAF'S SHADOW ALONG THE SUN (tilt_shadow). The plan footprint is the leaf flattened: its short half B = B0·|cos(roll)|, every corner at the centre's
  // height. Stood up, a corner sits lc.y·B0·sin(roll) above or below the centre (the tree view's own leaf, below), and projected along the sun from there the
  // quad is the leaf's true shadow, area A·B0·|n·s|/s_z: long for a leaf rolled toward a low sun, thin for one rolled away. A corner keeps its plan point.
  float dz = uTiltShadow > 0.0 ? uTiltShadow*lc.y*B0*sin(iSide*(restTilt + swing)) : 0.0;
#ifdef SEASON_TRAVEL
  if(uSeasonCast!=0){
    float lift=iJourney.w;
    vec2 centre=base+uSway*(hEff/uHRef)+drift;
    float angleDelta=mod(ang-iJourney.z+3.14159265359,6.28318530718)-3.14159265359;
    float travelingAngle=iJourney.z+angleDelta*lift+0.20*sin(6.28318530718*lift+iB.w)*sin(3.14159265359*lift);
    mat2 turning=mat2(cos(travelingAngle),-sin(travelingAngle),sin(travelingAngle),cos(travelingAngle));
    vec2 curl=0.22*sin(3.14159265359*lift)*vec2(cos(iB.w+2.0*lift),sin(iB.w+2.0*lift));
    world=mix(iJourney.xy,centre,lift)+curl+turning*(lc*vec2(A,mix(B0,B,lift)));
    hEff*=lift;
    dz*=lift;   // a leaf lying on the floor stands no corner up
  }
#endif
#ifdef TREE_VIEW
  // THE LEAF STOOD UP (the tree seen from the floor camera). The cast stamps this corner at its plan point (world), the leaf's short half B being
  // B0·|cos(roll)|; standing it back up adds the height that foreshortening took away, so the stood-up leaf projects straight down onto exactly the
  // cast's footprint: the leaf and its shadow are one placement. The roll is the record's tilt plus its swing, on the leaf's own side (iSide), and
  // the long axis stays a horizontal chord, as the record's angle defines it.
  {
    float roll = iSide*(restTilt + swing);
    vec3 P = vec3(world, hEff + lc.y*B0*sin(roll));
    vec3 e1 = vec3(R*vec2(1.0, 0.0), 0.0), e2 = vec3(R*vec2(0.0, B/max(B0, 1e-6)), sin(roll));   // the long axis, and the short one as stood up (its plan part is the cast's)
    vNormal = normalize(cross(e1, e2));
    vWorld = P;
    gl_Position = treeClip(P);
    vLocal = lc;
    { float x = fract(iC.w)*uLeafIdFrac; vVariant = uLeafIdFrac > 64.0 ? x : floor(x + 0.5); }
    vTau = iC.xyz;
    vFade = iFade;
    return;
  }
#endif
  // project this leaf onto the RECEIVER along the sun-sample direction (uG.x, uG.y, 1). FLOOR (z=0): world - uG·h
  // (h→0; transport's layer loop adds +h·g to look UP — antipodal, so leaves land where the wood casts). CURTAIN
  // (vertical plane Y=uClothY, §4.9): drop onto the cloth → u = px - r·gx, v = h - r with r=(py-cy)/gy, so a
  // vertical trunk (constant py) casts a vertical line and the whole tree STANDS UP the cloth. Floor byte-identical.
  vec2 recvPt;
  float hc = uTiltShadow > 0.0 ? hEff + dz : hEff;   // this corner's height: the centre's, or its own once the shadow is thrown along the sun
  if(uCurtainBake != 0){
    float gy = abs(uG.y) < 1e-3 ? (uG.y < 0.0 ? -1e-3 : 1e-3) : uG.y;   // guard: the sun must FACE the cloth (azimuth not ∥ to it)
    float rr = (world.y - uClothY) / gy;
    recvPt = vec2(world.x - rr*uG.x, hc - rr);
  } else {
    recvPt = world - uG * hc;
  }
  vec2 uv = (recvPt - uFaithOrigin)/uFaithExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = lc;
  { float x = fract(iC.w)*uLeafIdFrac; vVariant = uLeafIdFrac > 64.0 ? x : floor(x + 0.5); }
  vTau = iC.xyz;
  vFade = iFade;
#ifdef SEASON_TRAVEL
  if(uSeasonCast!=0){float liftCast=smoothstep(0.0,0.13,iJourney.w);vTau*=liftCast;vFade*=liftCast;}
#endif
}`;

const VS_FAITH = `#version 300 es
${GLSL_FAITH_VERTEX}`;
// A grove with leaves on older wood (inner_leaves) bakes with the pivot weight; every other grove with VS_FAITH itself, whose compile merely declaring the attribute
// moved (3 pixels of park 1 on Metal), so the weight is its own specialization. A cleanup candidate (José would rather have the simpler code: fold it into VS_FAITH
// and accept the three pixels; spec/exploration/open.md, harness).
const VS_FAITH_PIVOT = `#version 300 es
#define PIVOT
${GLSL_FAITH_VERTEX}`;
// A separate specialization keeps the native shader's arithmetic and compiler decisions intact.
const VS_SEASON_TRAVEL = `#version 300 es
#define SEASON_TRAVEL
${GLSL_FAITH_VERTEX}`;

// FAITHFUL pass 1 (per sample): each leaf outputs its TRANSMITTANCE exp(-τ); drawn with multiplicative blend
// (dst *= src) so the scratch buffer ends at Π exp(-τ) = exp(-Σ τ) = the transmittance through the canopy for
// this one sun-sample. Soft edge → 1 at the rim (×1, no darkening), order-independent (multiply commutes).
// A LEAF IS NOT A WINDOW (§4.5): the beam is only the BALLISTIC share. A stamp is ONE leaf over cov·fade of its pixel, at the depth vTau/vFade the grove
// folded the fade out of — its mixture (GLSL_TEXEL_MIX: the pair (vTau·cov, cov·fade) is exactly that leaf), (1 − cf) + cf·e^(−vTau/vFade − k), which
// the multiplicative scratch then stacks leaf by leaf. At k = 0 the stamp is still the slab of one leaf's mask, which is not exact; edge_area (uEdgeArea) reads it as
// the mixture there too, which is, and the blend stacks it exactly. A stamp with cov·fade under 1e-4 (a leaf not there yet) is exactly clear: texelMix's own
// guard is what keeps vTau/vFade from dividing by 0. The else is the literal old line.
const FS_FAITH = `#version 300 es
precision highp float;
uniform highp int uSeasonCast;
in vec2 vLocal;
in vec3 vTau;
in float vFade;
flat in float vVariant;
uniform float uEdge;
uniform float uBeamK;   // k = −ln(1−leaf_diffuse), 0 = the old leaf — a uniform branch, because leaf_diffuse tweens
uniform int uEdgeArea;   // edge_area (§4.5): the stamp's mixture at k = 0 too — exact for one leaf, where the slab of its mask is not. 0 = the literal old line
uniform int uLeafShape;   // 0 = the ellipse (the line below, as ever); else the outline (see FS_BAKE)
out vec4 frag;
${GLSL_TEXEL_MIX}
${GLSL_LEAF_Q}
void main(){
  float r = length(vLocal);
  if(uLeafShape != 0) r = leafQ(vLocal, vVariant);
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  if(uBeamK > 0.0 || uEdgeArea != 0){
    vec3 T, Tb;
    texelMix(vTau*cov, cov*vFade, uBeamK, T, Tb);
    // With edge_area off, native zero uses the legacy slab edge. Meet it continuously during a seasonal journey.
    frag = vec4(uSeasonCast!=0&&uEdgeArea==0?mix(exp(-vTau*cov),Tb,smoothstep(0.0,0.08,uBeamK)):Tb, 1.0);
  }
  else frag = vec4(exp(-vTau*cov), 1.0);
}`;

// The transition carries evaluated wind positions, rather than assigning the new grove's joint ids to old leaves.
// PATCH_TRIP (two faithful groves, patch by patch): each carrier brings its own outline mix and edge (iD.xy) in place of
// the route-wide uWeight and uEdge. A separate specialization keeps the single-progress shader's text as it was.
const GLSL_LEAF_TRAVEL_VERTEX = `precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;
layout(location=2) in vec4 iB;
layout(location=3) in vec4 iC;
#ifdef PATCH_TRIP
layout(location=4) in vec4 iD;
flat out vec2 vTrip;
#endif
uniform vec2 uOrigin,uExtent,uG;
uniform vec4 uBox;
out vec2 vLocal;
out vec3 vTau;
out float vFade;
flat out vec2 vRows;
void main(){
  vec2 lc=aCorner*uBox.zw+uBox.xy;
  float c=cos(iB.x),s=sin(iB.x);
  vec2 world=iA.xy+mat2(c,-s,s,c)*(lc*iA.zw)-uG*iC.x;
  gl_Position=vec4(((world-uOrigin)/uExtent)*2.0-1.0,0.0,1.0);
  vLocal=lc;vTau=iB.yzw;vFade=iC.y;vRows=iC.zw;
#ifdef PATCH_TRIP
  vTrip=iD.xy;
#endif
}`;
const VS_LEAF_TRAVEL = `#version 300 es
${GLSL_LEAF_TRAVEL_VERTEX}`;
const VS_LEAF_TRAVEL_PATCH = `#version 300 es
#define PATCH_TRIP
${GLSL_LEAF_TRAVEL_VERTEX}`;
const GLSL_LEAF_TRAVEL_FRAGMENT = `precision highp float;
in vec2 vLocal;
in vec3 vTau;
in float vFade;
flat in vec2 vRows;
uniform highp sampler2D uLeafA,uLeafB;
uniform int uShapeA,uShapeB,uEdgeArea;
uniform float uWeight,uEdge,uBeamK;
#ifdef PATCH_TRIP
flat in vec2 vTrip;
#define TRIP_W vTrip.x
#define TRIP_EDGE vTrip.y
#else
#define TRIP_W uWeight
#define TRIP_EDGE uEdge
#endif
out vec4 frag;
${GLSL_TEXEL_MIX}
float travelRadius(sampler2D leaf,vec2 uv){
  float rows=float(textureSize(leaf,0).y);
  if(rows>${LEAF_VARIANTS}.0){
    float variant=uv.y*rows,r0=floor(variant),w=clamp((variant-r0-0.1)/0.8,0.0,1.0);
    return mix(texture(leaf,vec2(uv.x,(r0+0.5)/rows)).r,texture(leaf,vec2(uv.x,(r0+1.5)/rows)).r,w);
  }
  return texture(leaf,uv).r;
}
void main(){
  vec2 d=dot(vLocal,vLocal)<1e-12?vec2(1.0,0.0):vLocal;
  float u=atan(d.y,d.x)*0.15915494+0.5;
  float ra=uShapeA==0?1.0:travelRadius(uLeafA,vec2(u,vRows.x));
  float rb=uShapeB==0?1.0:travelRadius(uLeafB,vec2(u,vRows.y));
  float r=length(vLocal)-mix(ra,rb,TRIP_W)+1.0;
  float cov=1.0-smoothstep(1.0-TRIP_EDGE,1.0,r);
  if(cov<=0.0)discard;
  if(uBeamK>0.0||uEdgeArea!=0){
    vec3 T,Tb;texelMix(vTau*cov,cov*vFade,uBeamK,T,Tb);frag=vec4(Tb,1.0);
  }else frag=vec4(exp(-vTau*cov),1.0);
}`;
const FS_LEAF_TRAVEL = `#version 300 es
${GLSL_LEAF_TRAVEL_FRAGMENT}`;
const FS_LEAF_TRAVEL_PATCH = `#version 300 es
#define PATCH_TRIP
${GLSL_LEAF_TRAVEL_FRAGMENT}`;
// Patch by patch, the colour map: each carrier's footprint adds (its own progress, 1), so after the blur r/g is the
// coverage-weighted progress of the leaves near a floor point.
const FS_LEAF_PROGRESS = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in vec2 vTrip;
out vec4 frag;
void main(){ if(dot(vLocal,vLocal)>1.0) discard; frag=vec4(vTrip.x,1.0,0.0,0.0); }`;
// One axis of the colour map's Gaussian blur (uSigma in texels, uDir one texel along the axis).
const FS_PROGRESS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uSigma;
out vec4 frag;
void main(){
  float stepT=max(1.0,3.0*uSigma/24.0);vec4 acc=vec4(0.0);float wsum=0.0;
  for(int i=-24;i<=24;i++){float x=float(i)*stepT;float w=exp(-x*x/(2.0*uSigma*uSigma));acc+=w*texture(uTex,vUv+uDir*x);wsum+=w;}
  frag=acc/wsum;
}`;
// Two finished pictures of one moving field, the outgoing look's and the incoming one's, mixed per pixel in linear
// display light by the colour map's progress drawn at each floor point (uP.r).
const FS_PATCH_MIX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA,uB,uP;
out vec4 frag;
void main(){
  vec4 a=texture(uA,vUv),b=texture(uB,vUv);
  float w=texture(uP,vUv).r;
  if(w<=0.0){frag=a;return;}
  if(w>=1.0){frag=b;return;}
  frag=vec4(pow(mix(pow(a.rgb,vec3(2.2)),pow(b.rgb,vec3(2.2)),w),vec3(1.0/2.2)),1.0);
}`;

// The litter lift crosses the horizon as one 3D field. Its two targets accumulate optical depth and reflected-light moments.
const VS_RISE = `#version 300 es
precision highp float;
layout(location=0)in vec2 aCorner;
layout(location=1)in vec4 iA;
layout(location=2)in vec4 iB;
layout(location=3)in vec4 iC;
layout(location=4)in vec4 iMaterial;
layout(location=5)in vec4 iFlight;
uniform vec3 uEye;
uniform mat3 uBasis;
uniform float uFov,uAspect;
uniform vec4 uBox;
out vec2 vLocal,vWorld;
out vec3 vTau,vReflectance;
out float vFade,vBeta,vVisible;
flat out vec2 vRows;
flat out float vWeight;
void main(){
 vec2 lc=aCorner*uBox.zw+uBox.xy;
 float c=cos(iB.x),s=sin(iB.x),roll=iFlight.y;
 vec2 leaf=lc*iA.zw;leaf.y*=cos(roll);
 vec2 xy=iA.xy+mat2(c,-s,s,c)*leaf;
 float z=iC.x+lc.y*iA.w*sin(roll);
 vec3 relative=vec3(xy,z)-uEye;
 vec3 p=vec3(dot(relative,uBasis[0]),dot(relative,uBasis[1]),dot(relative,uBasis[2]));
 float k=tan(.5*uFov),near=.01,far=500.0;
 gl_Position=vec4(p.x/(k*uAspect),p.y/k,(far+near)/(far-near)*p.z-2.0*far*near/(far-near),p.z);
 vLocal=lc;vWorld=xy;vTau=iB.yzw;vFade=iC.y;vRows=iC.zw;
 vReflectance=iMaterial.rgb;vBeta=iMaterial.a;vVisible=iFlight.x;vWeight=iFlight.z;
}`;
const FS_RISE = `#version 300 es
precision highp float;
in vec2 vLocal,vWorld;
in vec3 vTau,vReflectance;
in float vFade,vBeta,vVisible;
flat in vec2 vRows;
flat in float vWeight;
uniform highp sampler2D uLeafA,uLeafB,uFaith,uFillT,uFillS;
uniform int uShapeA,uShapeB;
uniform vec2 uFaithOrigin,uFillOrigin;
uniform float uFaithExtent,uFillExtent,uFillShare,uEdge;
uniform vec3 uSun,uAmbient;
layout(location=0)out vec4 depths;
layout(location=1)out vec4 emissions;
void main(){
 vec2 d=dot(vLocal,vLocal)<1e-12?vec2(1,0):vLocal;
 float u=atan(d.y,d.x)*.15915494+.5;
 float ra=uShapeA==0?1.0:texture(uLeafA,vec2(u,vRows.x)).r;
 float rb=uShapeB==0?1.0:texture(uLeafB,vec2(u,vRows.y)).r;
 float r=length(vLocal)-mix(ra,rb,vWeight)+1.0;
 float cov=(1.0-smoothstep(1.0-uEdge,1.0,r))*vVisible;
 if(cov<=0.0)discard;
 float area=clamp(cov*vFade,0.0,1.0);
 float opaque=-log(max(1.0-area,1e-5));
 vec3 tau=mix(vec3(opaque),vTau*cov,vBeta);
 vec3 beam=texture(uFaith,(vWorld-uFaithOrigin)/uFaithExtent).rgb;
 vec2 fuv=(vWorld-uFillOrigin)/uFillExtent;
 vec3 ambient=mix(uAmbient,uAmbient*textureLod(uFillT,fuv,3.0).rgb+textureLod(uFillS,fuv,3.0).rgb,uFillShare);
 vec3 light=(beam*uSun+ambient)*vReflectance;
 float weight=dot(tau,vec3(.3333333333));
 depths=vec4(tau,area);
 emissions=vec4(light*weight*(1.0-vBeta),weight);
}`;

const VS_RISE_SKY = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iA;
layout(location=2) in vec4 iB;
layout(location=3) in vec4 iC;
layout(location=4) in vec4 iMaterial;
layout(location=5) in vec4 iFlight;
uniform vec2 uOrigin,uExtent;
uniform vec4 uBox;
uniform float uBand;
uniform vec3 uHeights,uEye;
out vec2 vLocal;
out vec3 vTau;
out float vFade,vLayer,vFlightW;
flat out vec2 vRows;
void main(){
  vec2 lc=aCorner*uBox.zw+uBox.xy;
  float c=cos(iB.x),s=sin(iB.x);
  float plane=uBand<0.5?uHeights.x:(uBand<1.5?uHeights.y:uHeights.z);
  float scale=(plane-uEye.z)/max(iC.x-uEye.z,.001);
  vec2 world=uEye.xy+(iA.xy+mat2(c,-s,s,c)*(lc*iA.zw)-uEye.xy)*scale;
  gl_Position=vec4(((world-uOrigin)/uExtent)*2.0-1.0,0.0,1.0);
  float z=iC.x;
  float w0=1.0-smoothstep(uHeights.x,uHeights.y,z),w2=smoothstep(uHeights.y,uHeights.z,z);
  vLayer=(uBand<.5?w0:(uBand<1.5?1.0-w0-w2:w2))*smoothstep(0.0,.02,z-uEye.z)*iMaterial.a*iFlight.x;
  vFlightW=iFlight.z;vLocal=lc;vTau=iB.yzw;vFade=iC.y;vRows=iC.zw;
}`;
const FS_RISE_SKY = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
in float vFade,vLayer,vFlightW;
flat in vec2 vRows;
uniform highp sampler2D uLeafA,uLeafB;
uniform int uShapeA,uShapeB;
uniform float uEdge;
out vec4 frag;
void main(){
  vec2 d=dot(vLocal,vLocal)<1e-12?vec2(1.0,0.0):vLocal;
  float u=atan(d.y,d.x)*.15915494+.5;
  float ra=uShapeA==0?1.0:texture(uLeafA,vec2(u,vRows.x)).r;
  float rb=uShapeB==0?1.0:texture(uLeafB,vec2(u,vRows.y)).r;
  float r=length(vLocal)-mix(ra,rb,vFlightW)+1.0;
  float cov=1.0-smoothstep(1.0-uEdge,1.0,r);
  if(cov<=0.0)discard;
  frag=vec4(vTau*cov,vFade*cov)*vLayer;
}`;

// FAITHFUL pass 2 (per sample): acc += w_i · transmittance_i, additive, fullscreen. Summed over all samples the
// accumulator holds Σ w_i·T_i — the soft shadow (same "sum of shifted sharp shadows" as transport's loop, but the
// shift is per-leaf-continuous and pre-integrated here so transport taps it ONCE).
const FS_FACC = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uFAccTex;
uniform float uFAccWeight;
out vec4 frag;
void main(){ frag = vec4(uFAccWeight * texture(uFAccTex, vUv).rgb, 1.0); }`;

// FAITHFUL skeleton (spec §4.5): the woody skeleton — trunk + branches + TWIGS — baked into the SAME faithful pass as
// the leaves, so the wood casts at its OWN continuous heights and connects leaves→twigs→limbs→trunk (no more floating
// trunk / invisible twigs). Each segment is a tapered capsule quad; BOTH endpoints carry their own floor-height &
// radius, so the quad shears + thins with the sun. Multiplicative blend, like the leaves → wood × leaves = one T_i.
const VS_FAITH_SEG = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1]: x = along (a→b), y = ±across (width)
layout(location=1) in vec4 iSeg;      // plan endpoints: a.xy, b.xy
layout(location=2) in vec4 iSegH;     // a-height, b-height, a-radius, b-radius
layout(location=3) in float iWoodFade; // marginal-tree coverage, shared by its leaves and every wood stamp
uniform vec2 uFaithOrigin;
uniform vec2 uFaithExtent;
uniform vec2 uG;
uniform int  uCurtainBake;            // 1 = project onto the VERTICAL curtain plane (§4.9); 0 = floor
uniform float uClothY;                // curtain plane world-Y (cy) when uCurtainBake
uniform vec2 uSegSway;                // rigid plan sway added to both endpoints. The CAST path bakes its own
                                      // height-scaled sway into the instance data and leaves this at 0; the SKY
                                      // view's layer stamp needs the LEAF bake's per-layer sway instead, or the
                                      // twigs and the leaves hanging on them drift apart under wind (§4.9).
out float vAcross;
flat out float vWoodFade;
void main(){
  float t = aCorner.x*0.5 + 0.5;                 // 0 at a, 1 at b
  // project BOTH endpoints to the receiver at their OWN heights FIRST, then build the capsule around that SHADOW spine.
  // The width is ⊥ the streak, so a vertical trunk (no plan extent) still casts a round streak at every azimuth.
  // FLOOR: endpoint - uG·h. CURTAIN (§4.9): onto the vertical cloth → (px - r·gx, h - r), r=(py-cy)/gy.
  vec2 Ap, Bp;
  if(uCurtainBake != 0){
    float gy = abs(uG.y) < 1e-3 ? (uG.y < 0.0 ? -1e-3 : 1e-3) : uG.y;
    float rA = (iSeg.y - uClothY)/gy;  Ap = vec2(iSeg.x - rA*uG.x, iSegH.x - rA);
    float rB = (iSeg.w - uClothY)/gy;  Bp = vec2(iSeg.z - rB*uG.x, iSegH.y - rB);
  } else {
    Ap = iSeg.xy + uSegSway - uG*iSegH.x;
    Bp = iSeg.zw + uSegSway - uG*iSegH.y;
  }
  vec2 spine = Bp - Ap;
  vec2 dir = (dot(spine,spine) > 1e-8) ? normalize(spine) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float r = mix(iSegH.z, iSegH.w, t);            // pipe-model taper along the segment (thinner toward the tip)
  vec2 world = mix(Ap, Bp, t) + perp * (aCorner.y * r);
  gl_Position = vec4((world - uFaithOrigin)/uFaithExtent*2.0-1.0, 0.0, 1.0);
  vAcross = aCorner.y;
  vWoodFade = iWoodFade;
}`;

const FS_FAITH_SEG = `#version 300 es
precision highp float;
in float vAcross;
flat in float vWoodFade;
uniform float uWoodTau;
uniform int uSegTau;   // 0 = TRANSMITTANCE, for the cast's multiplicative scratch. 1 = OPTICAL DEPTH, for the layer
                       // textures, which accumulate additively and exponentiate at the tap — the leaves' own convention
out vec4 frag;
void main(){
  float cov = 1.0 - smoothstep(0.9, 1.0, abs(vAcross));    // tight anti-alias rim — keep THIN twigs opaque (the soft penumbra comes from the per-sample integration, not this edge)
  // THE LAYER STAMP WRITES THE WOOD'S OWN TEXTURE, an R16F per layer (§4.9), and only r of it. The layer texture's rgb is the FOLIAGE's
  // optical depth and its alpha the leaves' COVERAGE, and the sky view's scatter reads its density and hue from exactly those.
  // Neutral wood dropped into rgb normalizes to a near-white hue at near-full density, so the twig web would light up as cream
  // filaments brighter than the sky it stands against; wood occludes, it does not glow — so it lives where the sun's own
  // coverage cannot meet it. (Additive blend, cleared to 0 per layer: a layer with no twigs reads as no wood.) Half float, because
  // the depth accumulates and must round as it did when it shared the layer texture's alpha: the bytes did not move.
  if(uSegTau != 0){ frag = vec4(uWoodTau*cov*vWoodFade, 0.0, 0.0, 0.0); return; }
  frag = vec4(vec3(exp(-uWoodTau*cov*vWoodFade)), 1.0);              // wood blocks every colour equally → dark, neutral
}`;

// THE LITTER CARPET (§4.7, komorebi-litter.js): the fallen leaves stamped onto the floor, once per regrow, into an RGBA8 texture over the fill's frame.
// A stamp is one flat ellipse — the leaf's own half-axes, lying face up, so no foreshortening and no height: it casts nothing and is seen by
// reflection. Everything a stamp needs arrives ready from the CPU (position, size, the angle as a unit vector, the albedo it reflects with),
// so there is no trig and no colour law here: komorebi-litter.js owns both, and a browning process that replaces its colour needs no shader.
// The output is PREMULTIPLIED — rgb already times coverage — and drawn with ONE, ONE_MINUS_SRC_ALPHA, so the instance order is the layering
// (the last to fall lie on top) and the alpha channel accumulates as 1 − Π(1 − a). Premultiplied is also what makes a texel a mixture: the
// bilinear read and the mips average coverage-weighted colour, where straight alpha would darken every edge toward the empty texels' black.
const VS_LITTER = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1] quad corner
layout(location=1) in vec4 iA;        // centre.xy (m), A (long half), B0 (short half)
layout(location=2) in vec4 iB;        // cos, sin of its angle on the ground; the fade it carries (§5.3); the outline it lies in (komorebi-leaf.js; 0 for the ellipse)
layout(location=3) in vec4 iC;        // the albedo it reflects with (litterAlbedo)
uniform vec2  uLitterOrigin;          // the plan square the carpet covers: the fill's own frame
uniform vec2  uLitterExtent;
uniform vec4  uShapeBox;              // the quad's box in the leaf's own frame (see VS_BAKE): the ellipse's (0, 0, 1, 1), or the outline's
uniform float uLitterMinHalf;         // the smallest half-extent a stamp is drawn at (three quarters of a texel, so a texel and a half across): a leaf under a texel would otherwise fall between pixel centres and vanish
out vec2 vLocal;
out vec4 vCol;
flat out float vVariant;
void main(){
  vec2 hs = iA.zw;
  vec2 k = max(vec2(1.0), uLitterMinHalf/hs);                  // enlarge a sub-texel stamp to a texel's worth...
  float a = iB.z/(k.x*k.y);                                    // ...and spend what it gained in area out of its alpha, so the leaf keeps its area (to the rim's anti-aliasing, which over-counts a stamp this small by ~20%)
  vec2 m = 1.0 + 1.5*uLitterMinHalf/(hs*k);                    // the quad is a texel and a bit wider than the stamp all round: the rim's anti-aliasing ramp lies half outside the ellipse, and a fragment outside the quad is never made (the tips were cut at 50%)
  vec2 lc = aCorner*m*uShapeBox.zw + uShapeBox.xy;             // the corner in the leaf's own frame, margin included (the ellipse's: aCorner·m to the bit)
  vec2 d = lc*hs*k;
  vec2 world = iA.xy + vec2(iB.x*d.x - iB.y*d.y, iB.y*d.x + iB.x*d.y);
  gl_Position = vec4((world - uLitterOrigin)/uLitterExtent*2.0 - 1.0, 0.0, 1.0);
  vLocal = lc;
  vVariant = iB.w;
  vCol = vec4(iC.rgb*a, a);
}`;

const FS_LITTER = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vCol;
flat in float vVariant;
uniform int uLeafShape;   // 0 = the ellipse (the line below, as ever); else the outline (see FS_BAKE)
${GLSL_LEAF_Q}
out vec4 frag;
void main(){
  // a leaf on the ground has a crisp edge: one texel of anti-aliasing, whatever the frame (a stamp's rim in r is one pixel's worth of
  // fwidth), not the soft penumbra mask the canopy's leaves are baked with — that mask is how a leaf throws a shadow, not what it looks like
  float r = length(vLocal);
  if(uLeafShape != 0) r = leafQ(vLocal, vVariant);   // an outlined leaf: the same ramp on q', so its rim is a texel's worth of distance round the lobes
  float cov = clamp((1.0 - r)/max(fwidth(r), 1e-4) + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  frag = vCol*cov;
}`;

const VS_FULL = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID==1)?3.0:-1.0, (gl_VertexID==2)?3.0:-1.0);
  vUv = p*0.5+0.5;
  gl_Position = vec4(p,0.0,1.0);
}`;

// ---- THE LOOK'S TAIL (§4.7), as one shared string. Exposure -> tone curve -> contrast -> gamma: the last thing
// that happens to a pixel, and the step the lateral-diffusion tier (§4.9) has to RELOCATE, because a 2-D spread of
// light must happen in linear HDR, before any of this. Two shaders now run it — transport when it draws straight to
// screen, the diffusion composite when it doesn't — so it lives here rather than twice: the two paths CANNOT drift
// into two different Looks, which is the only way the gate's off state stays bit-identical over time. ----
const GLSL_TONE_TAIL = `
uniform float uExposure;
uniform float uContrast;
uniform int   uToneMap;
uniform vec3  uTravelTone;
vec3 reinhard(vec3 c){ return c/(1.0+c); }
vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
vec3 toneTail(vec3 col){
  col *= uExposure;
  vec3 exposed=col;
  if(uToneMap==1) col=reinhard(col);
  else if(uToneMap==2) col=aces(col);
  else col=clamp(col,0.0,1.0);
  if(dot(uTravelTone,vec3(1.0))>0.0){
    col=uTravelTone.x*clamp(exposed,0.0,1.0)+uTravelTone.y*reinhard(exposed)+uTravelTone.z*aces(exposed);
  }
  col = clamp((col-0.5)*uContrast+0.5, 0.0, 1.0);
  return pow(col, vec3(1.0/2.2));
}`;

// ---- THE TREE SEEN FROM THE FLOOR CAMERA (spec model/camera.md, model/leaf.md). The faithful cast's own leaves and wood, drawn after the floor in the floor
// camera's own perspective, lit as receivers, and finished by the same per-pixel steps the floor takes (dusk shift, haze, the iris, the Look's tail), so a
// tree pixel and the floor pixel beside it are made the same way. ----
const VS_TREE = `#version 300 es
#define TREE_VIEW
${GLSL_FAITH_VERTEX}`;

// What lights a point of the tree: the sun along its beam, through the leaves above it, and the sky above it. The leaves are read from the low-res layer
// set the sky fill bakes on the faithful path (komorebi-bake.js): a point at height z sees the layers above z + half a layer (its own layer would shade it),
// each at the plan point the sun's path crosses it, p + (h − z)·g. The beam takes each texel as the floor's beam does, leaf and gap mixed (texelMix);
// the sky goes as e^(−½·leaf area above), the season's spherical leaf. Outside the layers' box there are no leaves.
const GLSL_TREE_LIGHT = `uniform highp sampler2D uLayer[${MAX_LAYERS}];
uniform float uLayerHeight[${MAX_LAYERS}];
uniform int   uLayerCount;
uniform float uLayerHalf;            // half a layer's spacing (m)
uniform vec2  uLayerOrigin;
uniform vec2  uLayerExtent;
uniform vec2  uSunG;                 // the beam's plan travel per metre of rise (the standing scene's bulk shift)
uniform float uBeamK;
uniform vec3  uLeafSun;              // the beam at normal incidence (the air's loss in, the cosine law out)
uniform float uSunCosine;
uniform vec3  uSunDir;
uniform vec3  uAmbient;
uniform vec3  uEye;                  // the floor camera's eye (m)
${GLSL_TEXEL_MIX}
// A layer stands for the leaves of a slab a layer thick about its height, so it shades a point by as much of it as lies above the point: none at the
// point's own height (a leaf does not shade itself) rising to all of it a layer above. Continuous in height: a step here draws a line across the crown.
void treeTap(highp sampler2D L, float h, vec3 P, inout vec3 Tsun, inout float lai){   // a sampler array takes only a constant index in GLSL ES 3.00: one call a layer
  float f = clamp((h - P.z)/(2.0*uLayerHalf), 0.0, 1.0);
  if(f <= 0.0) return;
  vec2 uvS = (P.xy + (h - P.z)*uSunG - uLayerOrigin)/uLayerExtent, uvK = (P.xy - uLayerOrigin)/uLayerExtent;
  if(all(greaterThanEqual(uvS, vec2(0.0))) && all(lessThanEqual(uvS, vec2(1.0)))){
    vec4 t = texture(L, uvS); vec3 T, Tb;
    texelMix(t.rgb*f, t.a*f, uBeamK, T, Tb);
    Tsun *= Tb;
  }
  if(all(greaterThanEqual(uvK, vec2(0.0))) && all(lessThanEqual(uvK, vec2(1.0)))) lai += f*texture(L, uvK).a;
}
void treeLight(vec3 P, out vec3 Tsun, out float Tsky){
  Tsun = vec3(1.0); float lai = 0.0;
  if(0 < uLayerCount) treeTap(uLayer[0], uLayerHeight[0], P, Tsun, lai);
  if(1 < uLayerCount) treeTap(uLayer[1], uLayerHeight[1], P, Tsun, lai);
  if(2 < uLayerCount) treeTap(uLayer[2], uLayerHeight[2], P, Tsun, lai);
  if(3 < uLayerCount) treeTap(uLayer[3], uLayerHeight[3], P, Tsun, lai);   // one a layer, MAX_LAYERS of them (komorebi-params.js): tree-view.test.js holds the count to it
  Tsky = exp(-0.5*lai);
}`;

// The Look's per-pixel finish, the floor's GLSL_T_POST in the same order (komorebi-transport.js): the dusk shift keyed by this point's own sun visibility,
// the haze by its distance from the looked-at point as the floor's, the iris mask, the tail.
const GLSL_TREE_FINISH = `uniform float uTwilight;
uniform float uMesopic;
uniform vec3  uHazeColor;
uniform float uHalfExtent;
uniform vec2  uViewCenterF;
uniform float uVignette;
uniform float uVignetteShape;
uniform float uIrisOpacity;
uniform vec2  uTarget;               // the target's size in pixels, for the iris's frame position
${GLSL_TONE_TAIL}
vec3 treeFinish(vec3 col, vec3 Tsun, vec3 P){
  const vec3 ROD_BLUE = vec3(0.92, 1.0, 1.30);
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float rod = (1.0 - smoothstep(0.15, 0.6, dot(Tsun, LUMA)))*uTwilight*uMesopic;
  col = mix(col, dot(col, LUMA)*ROD_BLUE, rod*0.6);
  col = mix(col, uHazeColor, smoothstep(1.15*uHalfExtent, 3.0*uHalfExtent, length(P.xy - uViewCenterF)));
  if(uVignette > 0.0){
    vec2 q = abs(gl_FragCoord.xy/uTarget*2.0 - 1.0);
    float d = pow(pow(q.x, uVignetteShape) + pow(q.y, uVignetteShape), 1.0/uVignetteShape);
    col *= 1.0 - uIrisOpacity*smoothstep(1.0 - uVignette, 1.0, d);
  }
  return toneTail(col);
}`;

// A LEAF, SEEN. Two faces of one finite leaf (a Kubelka–Munk slab, komorebi-tree-view.js): its top and its underside reflect, and it passes what the
// look's own transmittance says, so a look keeps its leaf. uSlab holds, per channel (one row each), the top's reflectance, the underside's and the tissue's
// transmittance against T; this leaf's T is its own depth with the fade folded out (vTau/vFade), so a turned leaf is seen turned. The sun lights the face it
// is on; the eye sees the reflection of the face it looks at when the sun is on that face, and what the leaf passes when it is on the other. The sky lights
// each face by the share of it that face sees. The cuticle's own reflection (exact Fresnel at n 1.56, the coat's 4 % for the sky) is taken out of what enters
// and leaves the tissue and NOT drawn: the sheen is not built (spec model/leaf.md). Alpha is the leaf's outline times its fade, which the target turns into
// sample coverage.
const FS_TREE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
in float vFade;
flat in float vVariant;
in vec3 vWorld;
in vec3 vNormal;
uniform float uEdge;
uniform int uLeafShape;
uniform highp sampler2D uSlab;       // one row per channel, (top R, underside R, tissue T) against T
uniform float uF0;
${GLSL_LEAF_Q}
${GLSL_TREE_LIGHT}
${GLSL_TREE_FINISH}
layout(location=0) out vec4 frag;
layout(location=1) out vec4 cover;
float fresnel(float c, float n){
  c = clamp(c, 1e-4, 1.0); float g = sqrt(n*n + c*c - 1.0), a = (g - c)/(g + c), b = (c*(g + c) - 1.0)/(c*(g - c) + 1.0);
  return 0.5*a*a*(1.0 + b*b);
}
void main(){
  float r = length(vLocal);
  if(uLeafShape != 0) r = leafQ(vLocal, vVariant);
  float a = (1.0 - smoothstep(1.0 - uEdge, 1.0, r))*clamp(vFade, 0.0, 1.0);
  if(a <= 0.0) discard;
  vec3 T = exp(-vTau/max(vFade, 1e-4));
  vec3 n = normalize(vNormal);
  vec3 s = uSunDir, v = normalize(uEye - vWorld);
  float ns = dot(n, s), nv = dot(n, v);
  bool sunTop = ns > 0.0, seenTop = nv > 0.0, same = sunTop == seenTop;
  vec3 Tsun; float Tsky; treeLight(vWorld, Tsun, Tsky);
  vec3 sunE = uLeafSun*mix(1.0, abs(ns), uSunCosine)*Tsun, skyE = uAmbient*Tsky;
  float up = 0.5 + 0.5*n.z, down = 0.5 - 0.5*n.z, skySeen = seenTop ? up : down, skyOther = seenTop ? down : up;
  float Fi = fresnel(abs(ns), 1.56), Fv = fresnel(abs(nv), 1.56);
  vec3 col;
  for(int c = 0; c < 3; c++){
    vec3 m = texture(uSlab, vec2((sqrt(clamp(T[c], 0.0, 1.0))*(${SLAB_N}.0 - 1.0) + 0.5)/${SLAB_N}.0, (float(c) + 0.5)/3.0)).rgb;   // the table is spaced in √T, a sample at each texel's centre
    float Rseen = seenTop ? m.r : m.g;
    col[c] = (1.0 - Fv)*((same ? (1.0 - Fi)*sunE[c]*Rseen : (1.0 - Fi)*sunE[c]*m.b) + (1.0 - uF0)*(skyE[c]*skySeen*Rseen + skyE[c]*skyOther*m.b));
  }
  frag = vec4(treeFinish(col, Tsun, vWorld), a);
  cover = vec4(1.0);
}`;

// THE WOOD, SEEN: the faithful skeleton's own swayed segments (the cast's, this frame), each a cylinder turned to face the eye, its normal rebuilt across it.
// Lit like a leaf's face by the sun through the leaves above and the sky it sees; its colour is the bark's (bark_r/g/b).
const VS_TREE_WOOD = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // x along a→b, y across
layout(location=1) in vec4 iSeg;      // plan endpoints a.xy, b.xy
layout(location=2) in vec4 iSegH;     // heights a, b; radii a, b
layout(location=3) in float iWoodFade;
${GLSL_TREE_CAMERA}
uniform vec3 uEyeW;
out vec3 vWorld;
out vec3 vAcrossDir;
out vec3 vToEye;
out float vAcross;
flat out float vWoodFade;
void main(){
  vec3 A = vec3(iSeg.xy, iSegH.x), B = vec3(iSeg.zw, iSegH.y);
  float t = aCorner.x*0.5 + 0.5, rad = mix(iSegH.z, iSegH.w, t);
  vec3 axis = B - A; float len = max(length(axis), 1e-5); vec3 ax = axis/len;
  vec3 C = mix(A, B, t) + ax*aCorner.x*rad;                          // each end runs on by its radius, so joints close
  vec3 toEye = normalize(uEyeW - C), across = cross(ax, toEye);
  across = length(across) < 1e-5 ? vec3(1.0, 0.0, 0.0) : normalize(across);
  vec3 P = C + across*aCorner.y*rad;
  vWorld = P; vAcrossDir = across; vToEye = normalize(cross(across, ax)); vAcross = aCorner.y; vWoodFade = iWoodFade;
  if(dot(vToEye, toEye) < 0.0) vToEye = -vToEye;
  gl_Position = treeClip(P);
}`;
const FS_TREE_WOOD = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vAcrossDir;
in vec3 vToEye;
in float vAcross;
flat in float vWoodFade;
uniform vec3 uBark;
${GLSL_TREE_LIGHT}
${GLSL_TREE_FINISH}
layout(location=0) out vec4 frag;
layout(location=1) out vec4 cover;
void main(){
  float x = clamp(vAcross, -1.0, 1.0);
  vec3 n = normalize(vAcrossDir*x + vToEye*sqrt(1.0 - x*x));
  vec3 Tsun; float Tsky; treeLight(vWorld, Tsun, Tsky);
  vec3 col = (uLeafSun*mix(1.0, max(dot(n, uSunDir), 0.0), uSunCosine)*Tsun*(dot(n, uSunDir) > 0.0 ? 1.0 : 0.0) + uAmbient*Tsky*(0.5 + 0.5*n.z))*uBark;
  frag = vec4(treeFinish(col, Tsun, vWorld), clamp(vWoodFade, 0.0, 1.0));
  cover = vec4(1.0);
}`;
// The tree's resolved target over the frame: its colour is already the Look's and already weighed by the samples it covers, and the second target says how
// many it covers; so the frame keeps (1 − cover) of itself.
const FS_TREE_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTreeCol;
uniform highp sampler2D uTreeCover;
uniform float uTreeOpacity;   // the route's fade of the seen tree (1 at rest); the colour is weighed by its coverage, so both scale
out vec4 frag;
void main(){ frag = vec4(texture(uTreeCol, vUv).rgb, texture(uTreeCover, vUv).r)*uTreeOpacity; }`;



// ---- THE LAYER FIELD, as every program that reads it declares it. The transport head carries these seven lines and
// the sky fill's bake carries the same seven: one string, so a snippet that reads a layer uniform can never find it
// spelled differently (or missing) in one of its two homes. ----
const GLSL_LAYER_FIELD = `uniform vec2  uCanopyOrigin;
uniform vec2  uCanopyExtent;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform highp sampler2D uLayer[${MAX_LAYERS}];   // highp: optical depth exceeds lowp's ~[-2,2]
uniform float uLayerHeight[${MAX_LAYERS}];
uniform int   uLayerCount;`;

// ---- THE FLOOR'S ALBEDO where a leaf has fallen: the carpet (premultiplied: rgb·coverage, coverage in alpha, read as `L`) composed over the ground.
// One expression for the floor the eye sees (komorebi-transport.js) and the floor that lights the crown from below (FS_FILL_GROUND), so the two
// cannot disagree. ----
const GLSL_GROUND_ALBEDO = `uGround*(1.0-L.a) + L.rgb`;

// ---- THE WOOD FIELD (§4.9): the layer-stamped fine wood, one R16F texture per layer, beside the layers it was stamped with. The sky camera
// declares it, and the sky fill's bake carries the same line because it runs the same shared ray — whose wood reads sit behind
// `readWood`, a literal false in the fill, so the four samplers are declared there and never sampled. No cast camera declares it. ----
const GLSL_WOOD_FIELD = `uniform highp sampler2D uWood[${MAX_LAYERS}];   // r = the wood's optical depth (neutral), per layer; read only where readWood is true`;

// ---- the raw unit sun vector. The floor never needs it (its throw rides uProj/uBulkShift); the fabric's fold
// incidence, the enclosure's per-panel beam and the sky view's seen source and sun path all do. (The sky fill does NOT: it lights its
// leaves along the BEAM's path, uFillG, so the shade and the beam it balances share one sun.) ----
const GLSL_SUN_DIR_DECLS = `uniform vec3  uSunDir;            // UNIT sun direction (cos el·cos az, cos el·sin az, sin el) — the fold flanks' incidence basis (§4.9); NOT a 1/sin E throw`;

// ---- ONE UPWARD RAY THROUGH THE LAYER FIELD (§4.9 / §4.7). Everything that reads the canopy ALONG A RAY runs this one
// source: the sky view's eye ray and each of the sky fill's hemisphere rays. The fill's integrand IS the sky view's
// radiance (§4.7), so it is the same GLSL rather than a second copy that agrees today — registry.test.js holds both
// programs to this exact text, and the shared bound below (the telescoping sum) is therefore one bound, not two.
// What differs between the two readers is only HOW a ray reads a texel, and that is said at the call as an argument,
// never as a second function:
//   openOutside — outside the baked canopy box there is no canopy, so the eye sees open sky. (The floor's own taps
//                 never need this — a frame lives inside the box — but an upward ray leaves the box within a few
//                 metres of height, and CLAMP_TO_EDGE would smear the border texel across the whole periphery of the
//                 frame instead of opening onto blue.) The fill's hemisphere says it per look (§4.7: the finite tree is
//                 open outside its box; the endless park says false and its layer textures are set to REPEAT for that
//                 pass, so the box is one period of a field without an edge).
//   gS          — the plan travel per metre of rise of the SUN's path to a leaf: where the light that reaches a leaf comes
//                 from. The sky view looks at the real sun, so it passes the sun's own direction. The fill balances the
//                 beam, whose path is the bulk shift (none at all in the endless park), so it passes that: one sun per camera.
//   readWood    — a layer's foliage and its wood are different KINDS of occluder to the scatter term (§4.9): a leaf takes light out of
//                 the ray and puts some of it back, wood only takes it out. So they are two quantities in two textures: the
//                 layer texel's rgb is the foliage's depth and its alpha the leaves' COVERAGE (on every camera, from the one
//                 leaf bake), and the wood's own depth is the layer's R16F in uWood. The sky view says true and reads it; the
//                 fill says false — its hemisphere ignores wood by design (a limb's share of the sky is thin, and the analytic
//                 occluder takes the beam only) — and gets 1.
const GLSL_SKY_RAY = `// A transmittance normalized to unit peak: the spectrum with its brightness divided out (§3.5's idiom, and the same
// one the curtain's dye uses). What survives is chlorophyll's green-gold; the knob that reads it carries the level.
vec3 leafHue(vec3 t){ return t / max(max(t.r, t.g), max(t.b, 1e-4)); }
${GLSL_TEXEL_MIX}
// One tap of a layer: the foliage's transmittance t, its BALLISTIC share tb and, where readWood, the layer's wood transmittance w from its own texture.
// The texel holds the depth in rgb and the COVERAGE in alpha (the one bake writes both on every camera, §4.5). At beamK 0 the texel is the slab and tb is t
// (the else is the read the engine has always made) unless edge_area is on, which reads it as the mixture at k = 0 too (tb is then t, texelMix's own identity); above it the texel is a MIXTURE of leaf and gap (texelMix): t = what it truly passes, tb what is
// left of the beam, and t − tb the diffuse light it sends on. Open sky outside the box: no leaves, nothing to cover, no wood.
void tapSky(highp sampler2D layer, highp sampler2D wood, vec2 world, bool openOutside, bool readWood, float beamK, out vec3 t, out vec3 tb, out vec3 th, out float w){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  if(openOutside && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))){ t = vec3(1.0); tb = t; th = t; w = 1.0; return; }
  vec4 d = texture(layer, uv);
  if(beamK > 0.0 || uEdgeArea != 0) texelMix(d.rgb, d.a, beamK, t, tb);
  else { t = exp(-d.rgb); tb = t; }
  th = t;   // the hue the P0b proxy normalises: the texel's own t, unless edge_area reads the mixture at k = 0, whose gap share would whiten it
  if(beamK <= 0.0 && uEdgeArea != 0 && d.a >= 1e-4) th = exp(-d.rgb / min(d.a, 1.0));   // the LEAF's own transmittance e^(−τ̄): a hue the leaf has, where the mixture's t has the gap's
  w = readWood ? exp(-texture(wood, uv).r) : 1.0;
}
// What a tap takes out of the SUN's path: the leaf's BALLISTIC share tb (the diffuse share has left the beam, §4.5, and arrives as the emission below),
// × the wood where it is read — a twig shadows a leaf exactly as another leaf does.
vec3 sunPass(vec3 tb, float w, bool readWood){ return readWood ? tb*w : tb; }
// pL_i is where the ray crosses layer i's plane — the caller's own geometry, so the eye's perspective and the
// hemisphere's fixed directions both fit. Returns T (what the ray passes: leaves × wood, per channel), Tb (what the BEAM passes along it,
// Π tb·w: the sun's disk seen through the canopy — a leaf kills it; = T at beamK 0) and Lsc (the foliage's single-scatter radiance along
// it, BEFORE the albedo at beamK 0: the caller multiplies uSkyScatter / fill_scatter; the lantern's glow, at its own level, above it).
// ---- SINGLE-SCATTER FOLIAGE RADIANCE (§4.9). Transmission alone can only DARKEN: every ray is the sky attenuated, so
// a leaf is at best a dim filter and a deep crown is black. Foliage in daylight is LIT — light reaches a leaf,
// scatters inside it and leaves in every direction, so a sunlit crown is brighter than a shaded one against the same
// sky. That is a source term along the ray, and over a layered field it is a sum, not an integral:
// L += throughput·(1 − t_L)·ŝ_L·S_L, throughput *= t_L, accumulated eye → sky.
//  • (1 − t_L) is the share of the beam this layer takes OUT of the ray — the scattering density, measured from
//    the same tap the silhouette uses, not authored.
//  • S_L is the SUN's irradiance arriving at that layer FROM ABOVE: the sun attenuated by the layers over it along
//    the SUN's ray (offset +g per metre of rise, since that is where the light comes from). Those are extra taps
//    and nothing else — the field already holds everything they need.
//    NOT the skylight, which would count it twice: its passage through the leaves is already T·sky (the eye ray's
//    transmission, the fill's Tsky), and for a uniform sky diffuse transmission through Lambertian leaves equals
//    that ballistic T·L_sky to first order. Leaf-top reflection goes up, never to an eye below, and what an underside
//    sends down is the ground's light, which the fill's own bounce passes carry (FS_FILL_UP), never this ray. With the
//    sun off, Lsc is exactly 0.
//  • ŝ_L is the layer's own transmittance normalized to unit peak: HUE only (§3.5), so the knob carries
//    brightness and the chlorophyll spectrum carries colour. Taking the LAYER's rather than one leaf's also
//    accounts to first order for the scattered light filtering back out through the layer that made it.
// The bound is structural: Σ throughput·(1 − t_L) telescopes to 1 − Π t_L ≤ 1 per channel, ŝ ≤ 1 and the albedo
// ≤ 1, so a crown can never radiate more than the sunlight falling on it.
// ---- A LEAF IS NOT A WINDOW (§4.5): beamK > 0 replaces that proxy by what it stood in for. Every texel is a MIXTURE of leaf and gap (texelMix, above): it
// passes t in all, but only tb of it keeps travelling as a beam; the rest, t − tb, is diffuse light the leaf sends on, in its own hue (k is neutral) and
// at the level d·T of the leaf's own area — the gap emits nothing, no ŝ, no albedo, so nothing authored is left in it. It is lit by the
// sun's BALLISTIC path to it (A_L = Π_{M>L} tb_M·w_M) and falls through the layers below on their TRUE t (thr), which telescopes:
//   Π tb + Σ_L thr_L·(t_L − tb_L)·A_L = Π t   (Q_L = Π_{M≤L} t · Π_{M>L} tb steps from the first to the second)
// when the eye ray IS the sun's ray (every A_L then reads the very taps the ray passes): beam + emitted is the total transmitted for
// any d, and at d = 0 the new term is identically zero. Off that line it is not an identity and no inequality either (a lit leaf is
// seen through a leaf beside the sun's path): the bound is per layer, a leaf glows no more than its diffuse share of the sunlight
// landing on it. T is untouched by k: for a uniform sky, diffuse transmission through Lambertian leaves equals the ballistic one to first
// order, so the skylight needs no split — only the sun does. WOOD (readWood, the sky camera) is a pure attenuator: it is in T, Tb, the
// sun's path and thr, and never in the emission, so a ray that meets nothing but wood scatters exactly nothing.
void skyRay(vec2 pL0, vec2 pL1, vec2 pL2, vec2 pL3, vec2 gS, bool scatter, bool openOutside, bool readWood, float beamK, out vec3 T, out vec3 Tb, out vec3 Lsc){
  // a layer that is not there: transmits everything, covers nothing, holds no wood
  vec3 tL0 = vec3(1.0), tL1 = vec3(1.0), tL2 = vec3(1.0), tL3 = vec3(1.0);
  vec3 tbL0 = vec3(1.0), tbL1 = vec3(1.0), tbL2 = vec3(1.0), tbL3 = vec3(1.0);
  vec3 thL0 = vec3(1.0), thL1 = vec3(1.0), thL2 = vec3(1.0), thL3 = vec3(1.0);   // each layer's proxy hue source (tapSky)
  float wL0 = 1.0, wL1 = 1.0, wL2 = 1.0, wL3 = 1.0;
  if(uLayerCount>0) tapSky(uLayer[0], uWood[0], pL0, openOutside, readWood, beamK, tL0, tbL0, thL0, wL0);
  if(uLayerCount>1) tapSky(uLayer[1], uWood[1], pL1, openOutside, readWood, beamK, tL1, tbL1, thL1, wL1);
  if(uLayerCount>2) tapSky(uLayer[2], uWood[2], pL2, openOutside, readWood, beamK, tL2, tbL2, thL2, wL2);
  if(uLayerCount>3) tapSky(uLayer[3], uWood[3], pL3, openOutside, readWood, beamK, tL3, tbL3, thL3, wL3);
  // tL = what the FOLIAGE does (this layer's leaves alone) — the only thing the scatter term may read.
  // xL = what the RAY loses (leaves × wood) — the only thing transmittance may read.
  vec3 xL0 = readWood ? tL0*wL0 : tL0, xL1 = readWood ? tL1*wL1 : tL1, xL2 = readWood ? tL2*wL2 : tL2, xL3 = readWood ? tL3*wL3 : tL3;
  T = vec3(1.0);
  T *= xL0; T *= xL1; T *= xL2; T *= xL3;
  if(beamK > 0.0){   // Π tb·w: the beam's own transmittance along the ray, in the leaves' hue
    Tb = vec3(1.0);
    Tb *= readWood ? tbL0*wL0 : tbL0; Tb *= readWood ? tbL1*wL1 : tbL1; Tb *= readWood ? tbL2*wL2 : tbL2; Tb *= readWood ? tbL3*wL3 : tbL3;
  } else Tb = T;
  Lsc = vec3(0.0);
  if(scatter){
    vec3 A0 = vec3(1.0), A1 = vec3(1.0), A2 = vec3(1.0);
    // the SUN's path takes the FULL transmittance — a twig shadows a leaf exactly as another leaf does; it is
    // only as a SOURCE that wood must not participate.
    vec3 sT, sTb, sTh; float sW;
    if(uLayerCount>1){ tapSky(uLayer[1], uWood[1], pL0 + gS*(uLayerHeight[1]-uLayerHeight[0]), openOutside, readWood, beamK, sT, sTb, sTh, sW); A0 *= sunPass(sTb, sW, readWood); }
    if(uLayerCount>2){ tapSky(uLayer[2], uWood[2], pL0 + gS*(uLayerHeight[2]-uLayerHeight[0]), openOutside, readWood, beamK, sT, sTb, sTh, sW); A0 *= sunPass(sTb, sW, readWood); }
    if(uLayerCount>3){ tapSky(uLayer[3], uWood[3], pL0 + gS*(uLayerHeight[3]-uLayerHeight[0]), openOutside, readWood, beamK, sT, sTb, sTh, sW); A0 *= sunPass(sTb, sW, readWood); }
    if(uLayerCount>2){ tapSky(uLayer[2], uWood[2], pL1 + gS*(uLayerHeight[2]-uLayerHeight[1]), openOutside, readWood, beamK, sT, sTb, sTh, sW); A1 *= sunPass(sTb, sW, readWood); }
    if(uLayerCount>3){ tapSky(uLayer[3], uWood[3], pL1 + gS*(uLayerHeight[3]-uLayerHeight[1]), openOutside, readWood, beamK, sT, sTb, sTh, sW); A1 *= sunPass(sTb, sW, readWood); }
    if(uLayerCount>3){ tapSky(uLayer[3], uWood[3], pL2 + gS*(uLayerHeight[3]-uLayerHeight[2]), openOutside, readWood, beamK, sT, sTb, sTh, sW); A2 *= sunPass(sTb, sW, readWood); }
    // THE SOURCE TERM READS FOLIAGE ONLY. Wood appears in the throughput, which can only take light away, and
    // nowhere in the emission — so a ray that meets nothing but wood scatters exactly nothing.
    vec3 thr = vec3(1.0);
    if(beamK > 0.0){
      Lsc += thr*(tL0 - tbL0)*uSunColor*A0; thr *= xL0;
      Lsc += thr*(tL1 - tbL1)*uSunColor*A1; thr *= xL1;
      Lsc += thr*(tL2 - tbL2)*uSunColor*A2; thr *= xL2;
      Lsc += thr*(tL3 - tbL3)*uSunColor;   // nothing is stacked above the top layer
    } else {
      Lsc += thr*(1.0-tL0)*leafHue(thL0)*uSunColor*A0; thr *= xL0;
      Lsc += thr*(1.0-tL1)*leafHue(thL1)*uSunColor*A1; thr *= xL1;
      Lsc += thr*(1.0-tL2)*leafHue(thL2)*uSunColor*A2; thr *= xL2;
      Lsc += thr*(1.0-tL3)*leafHue(thL3)*uSunColor;   // nothing is stacked above the top layer
    }
  }
}`;

// ---- THE SKY FILL's bake (spec §4.7, "What the shade is lit by"). One fragment per fill texel x (a plan point on the
// floor, over the canopy box), K fixed cosine-weighted rays each, and the two quantities the shade is made of:
//   Tsky(x) = (1/K) Σ_k Π_L T_L(x + h_L·s_k)       the skylight's transmittance through the canopy — forestry's diffuse gap fraction
//   S(x)    = fill_scatter · (1/K) Σ_k Lsc_k        the sunlight the lit leaves scatter down onto it — the sky view's radiance, integrated
//             (at k = 0, the proxy; at uFillBeamK > 0 the measured emission (1/K) Σ_k Σ_L thr·(T − Tb)·sun·A, with no albedo: §4.5)
// where s_k = tanθ_k·(cosφ_k, sinφ_k) is ray k's plan travel per metre of rise. The K directions are the plain set of
// komorebi-fill.js (uFillRay: cos²θ_k and φ_k per ray), and each TEXEL rotates it by its slot in a fixed 4x4 Bayer tile
// (INTERLEAVED SAMPLING): azimuth by 2π·b/16 and cos²θ by a sub-stratum, so the 16 texels of a tile (a mip-2 box) hold
// 16·K distinct directions instead of the same K sixteen times. Without it neighbouring texels hit
// correlated leaves and the mip shows facets. The slot is a pure function of the texel: nothing moves, nothing is random.
// JENSEN IS A LAW OF THIS PASS: the sum is over TRANSMITTANCE. Each ray's product is taken at the ray's own taps and
// the K products are what get averaged — never a mip or a blur of the optical depth, which would turn a gappy canopy
// into a uniform veil and underestimate the fill. The sum is DIVIDED by K (not scaled by 1/K), so K rays of exactly
// 1 sum to exactly K and give exactly 1: no canopy is exactly bright, for any K.
// ENERGY: Tsky ≤ 1 by construction, and at k = 0 S ≤ fill_scatter·(1 − Tsky)·sun per channel by the sky view's
// telescoping bound — structural, no clamp. At k > 0 the bound is per layer only (GLSL_SKY_RAY says why). Wood is not read (readWood false): the analytic occluder takes the
// beam only, and a limb's share of the hemisphere is thin.
// THE BOOKS CLOSE (§4.7). Over a floor of unbounded extent every ray's light from a leaf lands somewhere, so the fill holds exactly
// what the leaves send down — IF the leaves are lit by the beam's own sun (uFillG, not the real one) and the box is not the world:
// the texel's frame (uFillOrigin/Extent) is the canopy box with the layer textures REPEATing for this pass (the endless park), or the
// box padded by 3·h_max with open sky outside it (a finite tree). The sum of S over the frame is then Σ over the layers of what they
// emit, descended through the layers below — held on the real baked layers by the pixel harness's bookkeeping rows.
const FS_FILL = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location=0) out vec4 fillT;
layout(location=1) out vec4 fillS;
${GLSL_LAYER_FIELD}
${GLSL_WOOD_FIELD}
uniform vec2  uFillOrigin;                  // the plan square this pass bakes over: the canopy box (the endless park, which wraps it) or the box padded by 3·h_max (a finite tree, open sky outside it) — komorebi-fill.js fillFrame. uCanopyOrigin/Extent stay the box the LAYERS were baked over
uniform vec2  uFillExtent;
uniform vec2  uFillG;                       // the BEAM's sun path, the bulk shift (§4.8): 0 in the endless park, the real throw for a standing tree / the cloth. One sun per camera: the light a leaf scatters is the light the beam gave up
uniform bool  uFillOpen;                    // outside the canopy box: open sky (a finite tree) — or, false, the layer textures repeat (the park; the bake sets REPEAT on them for this pass only)
uniform vec3  uFillRay[${MAX_FILL_DIRS}];   // per ray of the PLAIN set: (cos²θ_k, cosφ_k, sinφ_k) — komorebi-fill.js fillRays
uniform vec2  uFillTurn[16];                // per tile slot: (cos, sin) of its azimuth rotation 2π·b/16 — fillTurns. No sin/cos in this shader: GLSL ES only promises ~2⁻¹¹ of them, and a shift is tens of metres long
uniform int   uFillCount;                   // K
const int TILE[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);   // the texel's Bayer slot at (i&3) + 4·(j&3): komorebi-fill.js FILL_TILE, character for character (a test holds them)
uniform float uFillScatter;                 // the leaves' albedo (the P0b proxy): 0 skips the scatter branch unless the split is on (the cloth and the tent are handed 0 there, and read S only through it)
uniform float uFillBeamK;                   // k = −ln(1−leaf_diffuse) (§4.5): above 0 the leaf's diffuse share is the emission, the albedo is off, and every surface camera reads S
uniform int uEdgeArea;   // edge_area (§4.5): at k = 0 every texel is still read as its mixture (the shared ray reads this by name). 0 = the slab
uniform highp sampler2D uFillBounce;        // B, the ground returned by the undersides (FS_FILL_BOUNCE), over this same frame at half the resolution
uniform float uGroundBounce;                // ground_bounce: 0 reads nothing, and S is the leaves' light alone
${GLSL_SKY_RAY}
void main(){
  vec2 x = uFillOrigin + vUv*uFillExtent;       // the floor point this texel is (recvZ = 0)
  bool scatter = uFillScatter > 0.0 || uFillBeamK > 0.0;
  float K = float(uFillCount);
  ivec2 q = ivec2(gl_FragCoord.xy) & ivec2(3);      // this texel's place in its 4x4 tile
  int b = TILE[q.x + 4*q.y];
  vec2 turn = uFillTurn[b];                         // the slot's azimuth rotation, and its sub-stratum in cos²θ (in strata, always inside one: θ stays under 90°)
  float sub = (float(15 - b) + 0.5)/16.0 - 0.5;
  vec3 Tsum = vec3(0.0), Lsum = vec3(0.0);
  for(int k=0;k<${MAX_FILL_DIRS};k++){
    if(k>=uFillCount) break;
    vec3 r = uFillRay[k];
    float c2 = r.x - sub/K;                          // cos²θ = 1 − (k + ½ + sub)/K
    vec2 u = vec2(r.y*turn.x - r.z*turn.y, r.z*turn.x + r.y*turn.y);   // (cosφ, sinφ) turned by the slot
    vec2 s = sqrt((1.0 - c2)/c2)*u;                  // tanθ·(cosφ, sinφ)
    vec3 T, Tb, Lsc;
    skyRay(x + s*uLayerHeight[0], x + s*uLayerHeight[1], x + s*uLayerHeight[2], x + s*uLayerHeight[3], uFillG, scatter, uFillOpen, false, uFillBeamK, T, Tb, Lsc);
    Tsum += T; Lsum += Lsc;
  }
  fillT = vec4(Tsum/K, 1.0);
  vec3 S = Lsum/K*(uFillBeamK > 0.0 ? 1.0 : uFillScatter);   // the albedo is the proxy's; the emitted light is already at its own level
  if(uGroundBounce > 0.0) S += uGroundBounce*texture(uFillBounce, vUv).rgb;   // the canopy's other downward diffuse light: every reader of S takes it at S's own share
  fillS = vec4(S, 1.0);
}`;

// ---- THE GROUND, RETURNED BY THE UNDERSIDES (spec model/fill.md; komorebi-fill.js holds the law: groundRef, undersideRef, bounceRef). Three
// passes over the fill's own frame, run before FS_FILL when ground_bounce is up, which adds their result to S:
//   FS_FILL_GROUND  G(p)   = ρ(p)·(sun·B_g(p) + ambient): the floor's albedo (the ground composed with the carpet, the floor's own expression),
//                          lit by the beam along the beam's path and by the OPEN sky (not T_sky: the passes stay free of the fill's output)
//   FS_FILL_UP      W_L(q) = ⟨a·Rb⟩_L(q)·U_L(q): the ground's light reaching layer L's undersides from below (K rays down through the layers
//                          under it), × their leaf area and the slab's underside reflectance, one MRT target per layer
//   FS_FILL_BOUNCE  B(x)   = (1/K) Σ_k Σ_L thr_kL·W_L(x + h_L·s_k): down to the floor through the layers below each, on their true T
// Each texel takes its own slot of the fill's 4x4 interleaving tile, as FS_FILL's texels do. A layer is read as the fill reads it (tapSky,
// readWood false); the emitter is a texel mean over a BOUNCE_BOX² grid of taps. Past a finite tree's frame the ground is open ground, ρ·(sun +
// ambient), and the undersides are none; the endless park repeats all three textures. ----
const GLSL_FILL_DIRS = `uniform vec3  uFillRay[${MAX_FILL_DIRS}];   // the fill's own rays and slot turns (FS_FILL says what they are)
uniform vec2  uFillTurn[16];
uniform int   uFillCount;
uniform vec2  uFillOrigin;
uniform vec2  uFillExtent;
uniform bool  uFillOpen;
uniform float uFillBeamK;
uniform int   uEdgeArea;
const int TILE[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
// ray k of this texel's slot, as plan travel per metre of rise (FS_FILL's own lines)
vec2 fillShift(int k, int b, float K){
  vec3 r = uFillRay[k];
  float sub = (float(15 - b) + 0.5)/16.0 - 0.5, c2 = r.x - sub/K;
  vec2 turn = uFillTurn[b], u = vec2(r.y*turn.x - r.z*turn.y, r.z*turn.x + r.y*turn.y);
  return sqrt((1.0 - c2)/c2)*u;
}
int fillSlot(){ ivec2 q = ivec2(gl_FragCoord.xy) & ivec2(3); return TILE[q.x + 4*q.y]; }
bool pastFrame(vec2 p){ vec2 uv = (p - uFillOrigin)/uFillExtent; return uFillOpen && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))); }`;
// what a ray passes at a layer, as the fill reads it
const GLSL_FILL_PASS = `vec3 passAt(highp sampler2D layer, highp sampler2D wood, vec2 p){ vec3 t, tb, th; float w; tapSky(layer, wood, p, uFillOpen, false, uFillBeamK, t, tb, th, w); return t; }`;

const FS_FILL_GROUND = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
${GLSL_LAYER_FIELD}
${GLSL_WOOD_FIELD}
${GLSL_FILL_DIRS}
uniform vec2  uFillG;          // the beam's path (FS_FILL's)
uniform vec3  uGround;
uniform int   uLitterOn;
uniform highp sampler2D uLitter;
uniform vec2  uLitterOrigin;
uniform vec2  uLitterExtent;
${GLSL_SKY_RAY}
void main(){
  vec2 p = uFillOrigin + vUv*uFillExtent;
  vec3 T, Tb, Lsc;
  skyRay(p + uFillG*uLayerHeight[0], p + uFillG*uLayerHeight[1], p + uFillG*uLayerHeight[2], p + uFillG*uLayerHeight[3], uFillG, false, uFillOpen, false, uFillBeamK, T, Tb, Lsc);
  vec3 rho = uGround;
  if(uLitterOn != 0){ vec4 L = texture(uLitter, (p-uLitterOrigin)/uLitterExtent); rho = ${GLSL_GROUND_ALBEDO}; }
  frag = vec4(rho*(uSunColor*Tb + uAmbient), 1.0);
}`;

const FS_FILL_UP = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location=0) out vec4 w0;
layout(location=1) out vec4 w1;
layout(location=2) out vec4 w2;
layout(location=3) out vec4 w3;
${GLSL_LAYER_FIELD}
${GLSL_WOOD_FIELD}
${GLSL_FILL_DIRS}
uniform highp sampler2D uFillGround;   // G over the fill's frame
uniform vec3  uOpenGround;             // G past a finite tree's frame: open ground
uniform highp sampler2D uSlab;         // the leaf's slab, one row per channel: (top R, underside R, tissue T) against √T (komorebi-tree-view.js slabTable)
uniform float uF0;
uniform float uCell;                   // this pass's texel, in metres: the box the emitter is averaged over
${GLSL_SKY_RAY}
${GLSL_FILL_PASS}
vec3 groundAt(vec2 p){ return pastFrame(p) ? uOpenGround : texture(uFillGround, (p - uFillOrigin)/uFillExtent).rgb; }
// ⟨a·Rb⟩ over this texel: each tap's leaf area a = min(c, 1) and its own T = e^(−τ/a), its underside by the slab (komorebi-fill.js slabUnder)
vec3 underArea(highp sampler2D layer, vec2 q){
  vec3 s = vec3(0.0);
  for(int j = 0; j < ${BOUNCE_BOX}; j++) for(int i = 0; i < ${BOUNCE_BOX}; i++){
    vec2 uv = (q + ((vec2(float(i), float(j)) + 0.5)/${BOUNCE_BOX}.0 - 0.5)*uCell - uCanopyOrigin)/uCanopyExtent;
    if(uFillOpen && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))) continue;
    vec4 d = texture(layer, uv);
    if(!(d.a >= 1e-4)) continue;
    float a = min(d.a, 1.0);
    vec3 T = exp(-d.rgb/a);
    for(int c = 0; c < 3; c++) s[c] += a*min(uF0 + (1.0 - uF0)*texture(uSlab, vec2((sqrt(clamp(T[c], 0.0, 1.0))*(${SLAB_N}.0 - 1.0) + 0.5)/${SLAB_N}.0, (float(c) + 0.5)/3.0)).g, 1.0 - clamp(T[c], 0.0, 1.0));   // R ≤ 1 − T (slabUnder says why)
  }
  return s/float(${BOUNCE_BOX}*${BOUNCE_BOX});
}
void main(){
  vec2 q = uFillOrigin + vUv*uFillExtent;
  int b = fillSlot();
  float K = float(uFillCount), h0 = uLayerHeight[0], h1 = uLayerHeight[1], h2 = uLayerHeight[2], h3 = uLayerHeight[3];
  vec3 U0 = vec3(0.0), U1 = vec3(0.0), U2 = vec3(0.0), U3 = vec3(0.0);
  for(int k=0;k<${MAX_FILL_DIRS};k++){
    if(k>=uFillCount) break;
    vec2 s = fillShift(k, b, K);
    U0 += groundAt(q - s*h0);
    if(uLayerCount>1) U1 += passAt(uLayer[0], uWood[0], q - s*(h1 - h0))*groundAt(q - s*h1);
    if(uLayerCount>2) U2 += passAt(uLayer[0], uWood[0], q - s*(h2 - h0))*passAt(uLayer[1], uWood[1], q - s*(h2 - h1))*groundAt(q - s*h2);
    if(uLayerCount>3) U3 += passAt(uLayer[0], uWood[0], q - s*(h3 - h0))*passAt(uLayer[1], uWood[1], q - s*(h3 - h1))*passAt(uLayer[2], uWood[2], q - s*(h3 - h2))*groundAt(q - s*h3);
  }
  w0 = vec4(underArea(uLayer[0], q)*(U0/K), 1.0);
  w1 = vec4(uLayerCount>1 ? underArea(uLayer[1], q)*(U1/K) : vec3(0.0), 1.0);
  w2 = vec4(uLayerCount>2 ? underArea(uLayer[2], q)*(U2/K) : vec3(0.0), 1.0);
  w3 = vec4(uLayerCount>3 ? underArea(uLayer[3], q)*(U3/K) : vec3(0.0), 1.0);
}`;

const FS_FILL_BOUNCE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
${GLSL_LAYER_FIELD}
${GLSL_WOOD_FIELD}
${GLSL_FILL_DIRS}
uniform highp sampler2DArray uUnder;   // W, one layer per canopy layer
${GLSL_SKY_RAY}
${GLSL_FILL_PASS}
vec3 underAt(float L, vec2 p){ return pastFrame(p) ? vec3(0.0) : texture(uUnder, vec3((p - uFillOrigin)/uFillExtent, L)).rgb; }
void main(){
  vec2 x = uFillOrigin + vUv*uFillExtent;
  int b = fillSlot();
  float K = float(uFillCount);
  vec3 B = vec3(0.0);
  for(int k=0;k<${MAX_FILL_DIRS};k++){
    if(k>=uFillCount) break;
    vec2 s = fillShift(k, b, K);
    vec3 thr = vec3(1.0);
    vec2 p = x + s*uLayerHeight[0];
    B += thr*underAt(0.0, p); thr *= passAt(uLayer[0], uWood[0], p);
    if(uLayerCount>1){ p = x + s*uLayerHeight[1]; B += thr*underAt(1.0, p); thr *= passAt(uLayer[1], uWood[1], p); }
    if(uLayerCount>2){ p = x + s*uLayerHeight[2]; B += thr*underAt(2.0, p); thr *= passAt(uLayer[2], uWood[2], p); }
    if(uLayerCount>3){ p = x + s*uLayerHeight[3]; B += thr*underAt(3.0, p); }
  }
  frag = vec4(B/K, 1.0);
}`;


// ---- the small display passes: blit, adaptive present, glow, editor overlays ----
const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTex;
out vec4 frag;
void main(){
  vec3 T = exp(-texture(uTex, vUv).rgb);   // show transmittance of the baked layer
  frag = vec4(pow(T, vec3(1.0/2.2)), 1.0);
}`;

// plain present blit (TUNE §9 adaptive frame-rate): copy the offscreen-rendered frame straight to screen.
// whatever drew the frame (transport, or the diffusion composite) already wrote final display-encoded colour into
// the target, so this is a verbatim 1:1 copy (NEAREST, identical size) — the re-presented frame is byte-identical.
const FS_PRESENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 frag;
void main(){ frag = texture(uTex, vUv); }`;

// The scene dissolve includes each look's tone map. Decode its display gamma before mixing light.
const FS_SCENE_MIX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uOutgoing;
uniform sampler2D uIncoming;
uniform float uWeight;
out vec4 frag;
void main(){
  vec4 a=texture(uOutgoing,vUv), b=texture(uIncoming,vUv);
  if(uWeight<=0.0){ frag=a; return; }
  if(uWeight>=1.0){ frag=b; return; }
  frag=vec4(pow(mix(pow(a.rgb,vec3(2.2)),pow(b.rgb,vec3(2.2)),uWeight),vec3(1.0/2.2)),1.0);
}`;

// ---- LATERAL DIFFUSION (spec §4.9), pass 1+2: one axis of a separable Gaussian over the LINEAR-HDR frame.
// σ = radius/3, so the 13 taps span exactly ±3σ and the weights below are CONSTANT (exp(−k²/8), normalized): the
// physical radius rides entirely in uStep, the tap SPACING. Separability is what makes a real 2-D neighbourhood
// affordable at all — 13+13 taps instead of 169.
// THE KERNEL'S HONEST LIMIT: 13 taps cannot cover an arbitrarily large radius, so past a cap (GLOW_STEP_MAX) the
// spacing stops growing and the reach falls short of the metres asked for. That is the deliberate trade — spacing the
// taps further apart samples the frame too sparsely, and a hard cast edge then comes out as 13 shifted copies of
// itself instead of a ramp. A glow that stops short reads as a glow; a combed one reads as a bug.
const FS_GLOW_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTex;     // linear HDR — highp: this is radiance, not display-encoded colour
uniform vec2 uStep;               // ONE tap's offset in UV: (step/w, 0) horizontal, (0, step/h) vertical
out vec4 frag;
const float W[7] = float[7](0.19967567, 0.17621390, 0.12110863, 0.06482489, 0.02702306, 0.00877318, 0.00221816);
void main(){
  vec3 s = texture(uTex, vUv).rgb * W[0];
  for(int k=1; k<=6; k++){
    vec2 o = uStep*float(k);
    s += (texture(uTex, vUv+o).rgb + texture(uTex, vUv-o).rgb) * W[k];   // symmetric pair, one weight
  }
  frag = vec4(s, 1.0);
}`;

// ---- LATERAL DIFFUSION, pass 3 (the composite): the SPLIT, then the relocated tail. uDiffuse is a share of one
// fixed quantity of light, never an addition to it — the same discipline as the per-pixel forward-scatter wrap, one
// scale up: what the hot dapple loses is exactly what its surround gains, so the frame's total light is unchanged
// and no pixel can out-glow what landed on the cloth. Then toneTail — the SAME string transport runs when it draws
// straight to screen — turns the result into display colour.
const FS_GLOW_MIX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSharp;   // transport's linear HDR frame
uniform highp sampler2D uBlur;    // the same frame, spread laterally through the weave
uniform float uDiffuse;           // d: the share of the transmitted light that took the lateral route
${GLSL_TONE_TAIL}
out vec4 frag;
void main(){
  vec3 sharp = texture(uSharp, vUv).rgb;
  vec3 blur  = texture(uBlur,  vUv).rgb;
  frag = vec4(toneTail(mix(sharp, blur, uDiffuse)), 1.0);
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

// ---- tree-preview inset: positions are CPU-projected to the inset's NDC, so the VS is trivial. ----
const VS_VIZ = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;      // already projected to inset NDC
layout(location=1) in vec3 aCol;
layout(location=2) in float aSize;    // leaf point size (px); 0 for lines
out vec3 vCol;
void main(){ vCol=aCol; gl_PointSize=aSize; gl_Position=vec4(aPos,0.0,1.0); }`;

const FS_VIZ = `#version 300 es
precision highp float;
in vec3 vCol;
uniform float uPoint;                 // 1 = soft round leaf, 0 = opaque branch/ground line
uniform float uPointAlpha;            // leaf opacity — eased down as foliage density climbs (haze, not a wall)
uniform float uLineAlpha;             // branch/line opacity — 1 solid, <1 for the faint skeleton over the foliage
out vec4 frag;
void main(){
  if(uPoint>0.5){ vec2 d=gl_PointCoord*2.0-1.0; float r2=dot(d,d); if(r2>1.0) discard; frag=vec4(vCol,(1.0-r2)*uPointAlpha); }
  else frag=vec4(vCol, uLineAlpha);
}`;


export { SLAB_N, GLSL_TEXEL_MIX, GLSL_LEAF_Q, VS_TREE, FS_TREE, VS_TREE_WOOD, FS_TREE_WOOD, FS_TREE_COMPOSITE, VS_BAKE, FS_BAKE, VS_FAITH, VS_FAITH_PIVOT, VS_SEASON_TRAVEL, FS_FAITH, VS_LEAF_TRAVEL, FS_LEAF_TRAVEL, VS_LEAF_TRAVEL_PATCH, FS_LEAF_TRAVEL_PATCH, FS_LEAF_PROGRESS, FS_PROGRESS_BLUR, FS_PATCH_MIX, VS_RISE, FS_RISE, VS_RISE_SKY, FS_RISE_SKY, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_LITTER, FS_LITTER, VS_FULL, GLSL_TONE_TAIL, GLSL_LAYER_FIELD, GLSL_WOOD_FIELD, GLSL_SUN_DIR_DECLS, GLSL_SKY_RAY, GLSL_GROUND_ALBEDO, FS_FILL, FS_FILL_GROUND, FS_FILL_UP, FS_FILL_BOUNCE, FS_BLIT, FS_PRESENT, FS_SCENE_MIX, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ };
