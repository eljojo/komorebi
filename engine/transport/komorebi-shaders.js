import { MAX_LAYERS, MAX_FILL_DIRS, BOUNCE_BOX } from '../komorebi-params.js';
import { LEAF_VARIANTS, SLAB_N } from '../leaf/komorebi-leaf.js';
import { DEPTH_L0, DEPTH_W, GLSL_FLUTTER } from '../motion/komorebi-air.js';
import { TREE_GAIN, TREE_POWER } from './komorebi-camera.js';

// ===========================================================================
// Shaders
// ===========================================================================

// ---- A TEXEL IS A MIXTURE, NOT A SLAB (spec/model/leaf.md): ONE snippet, carried by every program that reads a baked texel as a mixture (above leaf_diffuse 0, and at 0 under edge_area) — the cast taps
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

// ---- THE LEAF'S OUTLINE, as ONE snippet (spec/model/leaf.md, P4a-2): the three programs that cut a leaf's mask — the layer bake, the faithful stamp and the litter carpet — take
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
layout(location=5) in float iFade;    // the marginal-leaf × marginal-tree fade the CPU already folded into iC.xyz (spec/contracts/continuity.md) — alpha has to carry it too
uniform vec2  uCanopyOrigin;          // -extent/2
uniform vec2  uCanopyExtent;          // (extent, extent)
uniform float uMorph;                 // drift phase (incoherent band, spec/model/motion.md)
uniform float uMorphAmount;           // orbit radius scale (m)
uniform vec2  uSway;                  // tree 0's trunk (coherent) translation for this layer (spec/model/motion.md); a clump's own tree adds row 2 of uClusterTex, times uSwayGain
uniform float uSwayGain;              // this layer's lever on the trunk's sway (uSway is tree 0's times it)
uniform highp sampler2D uClusterTex;  // per-clump dynamic: row 0 the bend angles (limb, twig) — radians; row 1 the air; row 2 its tree's trunk less tree 0's (sway.xy, u)
uniform highp sampler2D uClusterGeom; // per-clump static geometry: clump centre + trunk pivot
uniform float uWindLevel;             // signed sway fraction u(t) — drives leaf swing intensity
uniform float uAir;                   // wind_air: 0 the flutter follows the sway |u|, 1 the air at each clump (the cluster texture's row 1)
uniform float uDepth;                 // wind_depth: 0 every leaf rocks, >0 only as deep into its crown as the wind reaches (depthGate)
uniform float uWindTime;              // seconds, for leaf flutter
uniform float uLeafSwing;             // master: how far leaves rock as wind blows
uniform float uFlutterFreq;           // leaf flutter rate (Hz)
uniform vec2  uFlutterBand;           // flutter_broadband, and its wind pattern's H: the flutter as the wind's own fractal sum (leafFlutter)
uniform float uStemLen;               // twig stem length: pivot offset toward the limb (swing, not spin)
// GROVE-WIDE COVERAGE (spec/model/transitions.md). The per-leaf 'cov' the CPU folds into iC.xyz is the fractional-leaf fade — a marginal
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
${GLSL_FLUTTER}
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  // ---- leaf rocks with the wind: footprint foreshortens -> dapple changes SHAPE (spec/model/canopy.md) ----
  vec3 trunk = texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 2), 0).xyz;   // this leaf's tree's trunk less tree 0's (komorebi-motion.js publishBend): 0 for tree 0, so one tree reads uSway and uWindLevel to the bit
  float uk = uWindLevel + trunk.z;                                          // its tree's signed sway u
  float wm = uAir > 0.0 ? abs(uk)*(1.0 - uAir) + texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 1), 0).x*uAir : abs(uk);   // flutterLevel (komorebi-air.js): the air where this leaf hangs, under wind_air
  float swing = uLeafSwing*swingGain*(0.5*uk + wm*leafFlutter(sin(uWindTime*uFlutterFreq*6.2831853+swingPhase), uWindTime, swingPhase, uFlutterFreq, uFlutterBand.x, uFlutterBand.y));
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
  // ---- branch hierarchy (spec/model/motion.md): ROTATION about joints, not translation. The twig swings the clump
  // about a stem joint; the limb swings the whole clump as a rigid arc about the TRUNK (canopy
  // centre). A leaf inherits both, so clumps PIVOT and their leaves sweep arcs — not a slab slide. ----
  int cid = int(iC.w + 0.5);
  vec4 geom = texelFetch(uClusterGeom, ivec2(cid,0), 0);    // clump centre .xy, trunk pivot .zw
  vec3 bend = texelFetch(uClusterTex,  ivec2(cid,0), 0).xyz; // limb bend, twig bend, stem-angle seed
  vec2 C = geom.xy, BL = geom.zw; float thL = bend.x, thT = bend.y;
  // twig STEM: a base joint offset from the clump TOWARD the trunk. The twig SWINGS about a real
  // joint instead of spinning about its own centre — which removes the clump-scale vortex/swirl. (spec/model/motion.md)
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
  vec2 world = base + (uSway + uSwayGain*trunk.xy) + drift + R*(lc*vec2(A,B));
  vec2 uv = (world - uCanopyOrigin)/uCanopyExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = lc;
  { float x = fract(iC.w)*uLeafIdFrac; vVariant = uLeafIdFrac > 64.0 ? x : floor(x + 0.5); }   // the outline's row, in the cluster id's fraction (komorebi-grove.js): j + row/uLeafIdFrac, and int(iC.w + 0.5) above is still j; a varied grove's (128) is read raw, its fraction the blend leafQ takes
  vTau = iC.xyz * uCoverage;   // x 1.0 is the identity in IEEE, so every non-transitioning frame bakes the bytes it always did
  vFade = iFade * uCoverage;   // the same two lever arms on COVERAGE, so a leaf fading in (or a grove crossfading) fades its ballistic shadow with its tau, not at full weight (spec/model/leaf.md)
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
  // COVERAGE (Σ of the masks, fade included): the one texel carries both transmittances, e^-tau and the beam's e^(-tau - k·alpha) (spec/model/leaf.md)
  frag = vec4(vTau*cov, cov*vFade);
}`;

// ---- THE FLOOR CAMERA, run forwards (the tree seen from the floor camera). GLSL_T_FLOOR_CAMERA (komorebi-transport.js) casts a ray from each pixel to the floor
// from an eye at unit height that the zoom hold scales to `scale` metres: the eye stands H = view_extent·cos²pitch/(2·tan(fov/2)) above the floor, H·tan(pitch)
// back from the looked-at point, turned by the orbit and moved by the pan (cameraPose, komorebi-camera.js, says the same). treeClip is that pinhole the other
// way round: a world point to the pixel whose ray passes through it, so a point on the floor lands on the floor's own pixel, and a leaf above it in perspective.
// The depth is the distance along the gaze, near 2 % and far 200 eye heights. ----
const GLSL_TREE_CAMERA = `uniform float uViewExtent;
uniform float uPitch;
uniform float uLookUp;               // the gaze turned up past the tilt (view_look_up_deg); the eye keeps the tilt's
uniform float uFov;
uniform float uAspect;
uniform float uViewYaw;
uniform vec2  uViewCenter;
vec4 treeClip(vec3 P){
  float cp = cos(uPitch), sp = sin(uPitch), kf = max(tan(0.5*uFov), 1e-4);
  float cg = cos(uPitch + uLookUp), sg = sin(uPitch + uLookUp);
  float scale = uViewExtent*cp*cp/max(2.0*kf, 1e-4), targetY = sp/max(cp, 1e-4);
  float cy = cos(uViewYaw), sy = sin(uViewYaw);
  vec2 q = mat2(cy, sy, -sy, cy)*(P.xy - uViewCenter);              // the floor's orbit, undone
  vec3 v = vec3(q.x/scale, q.y/scale + targetY, P.z/scale - 1.0);   // from the eye, in eye heights
  float depth = v.y*sg - v.z*cg, up = v.y*cg + v.z*sg;              // along the gaze (0, sg, −cg), and up the image (0, cg, sg)
  const float N = 0.02, F = 200.0;
  return vec4(v.x/(kf*uAspect), up/kf, (depth*(F + N) - 2.0*F*N)/(F - N), depth);
}`;

// FAITHFUL leaf bake (spec/model/canopy.md): the VS_BAKE body verbatim — same grow/flutter/bend, so the cast matches the
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
#endif    // the fade the CPU folded into iC.xyz: the ballistic depth k·fade has to ride it (spec/model/leaf.md)
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
uniform int   uCurtainBake;           // 1 = project onto the VERTICAL curtain plane (spec/model/receivers.md); 0 = the floor (byte-identical)
uniform float uClothY;                // curtain plane world-Y (cy) when uCurtainBake
uniform float uMorph;
uniform float uMorphAmount;
uniform vec2  uSway;                  // tree 0's trunk sway; a leaf's own tree adds row 2 of uClusterTex
uniform float uHRef;                  // reference height: the coherent sway scales by iHeight/uHRef so the canopy bends as ONE piece anchored at the ground (matches the wood)
uniform highp sampler2D uClusterTex;
uniform highp sampler2D uClusterGeom;
uniform float uWindLevel;
uniform float uAir;
uniform float uDepth;
uniform float uWindTime;
uniform float uLeafSwing;
uniform float uFlutterFreq;
uniform vec2  uFlutterBand;           // (see VS_BAKE)
uniform vec4  uShapeBox;              // the quad's box in the leaf's own frame (see VS_BAKE)
uniform float uLeafIdFrac;            // the packing of the outline's row in the cluster id's fraction (see VS_BAKE)
out vec2 vLocal;
out vec3 vTau;
out float vFade;
flat out float vVariant;
${GLSL_FLUTTER}
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  vec3 trunk = texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 2), 0).xyz;   // this leaf's tree's trunk less tree 0's (komorebi-motion.js publishBend): 0 for tree 0, so one tree reads uSway and uWindLevel to the bit
  float uk = uWindLevel + trunk.z;                                          // its tree's signed sway u
  float wm = uAir > 0.0 ? abs(uk)*(1.0 - uAir) + texelFetch(uClusterTex, ivec2(int(iC.w + 0.5), 1), 0).x*uAir : abs(uk);   // flutterLevel (komorebi-air.js): the air where this leaf hangs, under wind_air
  float swing = uLeafSwing*swingGain*(0.5*uk + wm*leafFlutter(sin(uWindTime*uFlutterFreq*6.2831853+swingPhase), uWindTime, swingPhase, uFlutterFreq, uFlutterBand.x, uFlutterBand.y));
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
  // 3-D lean (spec/model/motion.md): a wind-pitched limb lowers its leaves' height → shorter cast + less drift. The foreshorten is
  // ANCHORED at the limb's attach height: h' = attachH + (h−attachH)·fore, packed as the affine (.z, .w) =
  // (attachH·(1−fore), fore) so the shader is one madd. At the join h' = attachH exactly, so the pitching limb never
  // parts from the trunk axis (which does not pitch). GOTCHA — .z is MODE-dependent: publishBend writes this offset
  // only in faithful mode; on the layer path .z is the synthetic joint's stem seed and VS_BAKE reads it as such. The
  // two must agree per mode, and do because faithful_canopy is a MODE_KEYS flag (a flip rebuilds and republishes).
  float hEff = bend.z + iHeight * bend.w;   // sway_pitch off → (0, 1) → hEff = iHeight, byte-identical.
  // MEDIUM band (spec/model/motion.md, "gaps morph and rearrange"): the twig swings its clump about TB — the SAME joint, by the
  // same angle and in the same order, that bakeFaithful's refill turns this twig's wood about. So leaf-on-wood
  // registration holds by construction, not by luck; that slip is why the band was dropped here before (spec/model/motion.md).
  // TB is offset from the clump toward the parent by GROWTH, so it is a real stem joint and spec/model/motion.md's anti-vortex
  // property comes for free — no uStemLen (the synthetic joint) and no bend.z spread: there is no made-up radial
  // direction left to decorrelate, the grown twig headings already differ. thT rides twig_flex → 0 = rest = byte-identical.
  // sway_pitch composes orthogonally: it only foreshortens iHeight (bend.w) and this is a plan-plane yaw.
  // mat2 fills columns: positive joint bends turn counterclockwise, as the CPU wood and wind torque do.
  float ct=cos(thT), st=sin(thT);
  vec2 p = TB + mat2(ct,st,-st,ct)*(leafRest - TB);      // twig swings the clump about its own grown base
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,sl,-sl,cl)*(p - BL);          // the limb then swings that twig joint AND its clump about the trunk
  // The leaf outline uses a clockwise rest-angle basis, so joint bends subtract from that angle.
  float ang = angle - thL - thT + 0.2*swing;             // orientation rotates with the branch → the footprint presents differently as it turns (spec/model/motion.md)
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 lc = aCorner*uShapeBox.zw + uShapeBox.xy;                                 // the corner in the leaf's own frame: the ellipse's square to the bit, or the outline's box (see VS_BAKE)
  vec2 world = base + (uSway + trunk.xy)*(hEff/uHRef) + drift + R*(lc*vec2(A,B));   // its tree's coherent sway grows with height (0 at the ground) — leaves stay on their twigs, base anchored
  // THE LEAF'S SHADOW ALONG THE SUN (tilt_shadow). The plan footprint is the leaf flattened: its short half B = B0·|cos(roll)|, every corner at the centre's
  // height. Stood up, a corner sits lc.y·B0·sin(roll) above or below the centre (the tree view's own leaf, below), and projected along the sun from there the
  // quad is the leaf's true shadow, area A·B0·|n·s|/s_z: long for a leaf rolled toward a low sun, thin for one rolled away. A corner keeps its plan point.
  float dz = uTiltShadow > 0.0 ? uTiltShadow*lc.y*B0*sin(iSide*(restTilt + swing)) : 0.0;
#ifdef SEASON_TRAVEL
  if(uSeasonCast!=0){
    float lift=iJourney.w;
    vec2 centre=base+(uSway+trunk.xy)*(hEff/uHRef)+drift;
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
  // (vertical plane Y=uClothY, spec/model/receivers.md): drop onto the cloth → u = px - r·gx, v = h - r with r=(py-cy)/gy, so a
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
// A LEAF IS NOT A WINDOW (spec/model/leaf.md): the beam is only the BALLISTIC share. A stamp is ONE leaf over cov·fade of its pixel, at the depth vTau/vFade the grove
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
uniform int uEdgeArea;   // edge_area (spec/model/leaf.md): the stamp's mixture at k = 0 too — exact for one leaf, where the slab of its mask is not. 0 = the literal old line
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
// The stamp of carriers already moved: grove travel's, which it moves on the CPU, and leaf travel's, which VS_LEAF_CARRY (below) moves.
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
// LEAF TRAVEL'S CARRIERS, MOVED HERE (komorebi-leaf-travel.js): moved() and carry() of that module, the reference this is held to, run once
// per carrier a frame by transform feedback, with nothing drawn. Each end's leaf record is static for the route (five vec4: the faithful
// record's 18 floats, its height slot holding a layered end's layer fraction, then fade, pivot weight and outline row); each end's joints,
// air and trees come from its own grove's cluster textures, which its wind publishes every frame; the rest of its motion and look is four
// uniforms. The outputs are the floats moveLeaves writes (oA, oB, oC) and, PATCH_TRIP, the two movePatchLeaves adds (oD), which the stamp
// above (GLSL_LEAF_TRAVEL_VERTEX) draws from for every sun sample. PATCH_TRIP: each carrier's progress is its own trip's clock (tripClock).
const GLSL_LEAF_CARRY_VERTEX = `precision highp float;
layout(location=0) in vec4 iA0;
layout(location=1) in vec4 iA1;
layout(location=2) in vec4 iA2;
layout(location=3) in vec4 iA3;
layout(location=4) in vec4 iA4;
layout(location=5) in vec4 iB0;
layout(location=6) in vec4 iB1;
layout(location=7) in vec4 iB2;
layout(location=8) in vec4 iB3;
layout(location=9) in vec4 iB4;
layout(location=10) in vec4 iPair;   // live at A, live at B, the carrier's place in the patch field, spare
uniform float uW;                    // the route's progress; PATCH_TRIP: W, the progress inside the moving cast's full-weight middle
uniform vec2 uEdges;                 // PATCH_TRIP: each end's edge softness
uniform float uTripD;                // PATCH_TRIP: the share of the middle one carrier's trip takes (TRIP_D)
uniform highp sampler2D uClusterA,uGeomA,uClusterB,uGeomB;
// per end: (u, sway.xy, time), (leaf_swing, flutter_freq, wind_air, wind_depth), (drift_phase, drift_amount, stem_length, sway_height_gain),
// (faithful, canopy_base_height_m, canopy_thickness_m, hMax)
uniform vec4 uWindA,uFlutterA,uDriftA,uHeightA,uWindB,uFlutterB,uDriftB,uHeightB;
uniform vec2 uBandA,uBandB;   // per end: flutter_broadband and its wind pattern's H (leafFlutter)
out vec4 oA;   // centre.xy, half sizes
out vec4 oB;   // angle, optical depth
out vec4 oC;   // height, fade, outline rows
#ifdef PATCH_TRIP
out vec4 oD;   // own progress, edge
#endif
${GLSL_FLUTTER}
// One end's leaf at its own wind: plan centre, half sizes, angle, height (moved()).
void moved(vec4 r0,vec4 r1,vec4 r2,vec4 r3,vec4 r4,highp sampler2D clusterTex,highp sampler2D geomTex,vec4 wind,vec4 flutter,vec2 band,vec4 drift,vec4 height,
           out vec2 pos,out vec2 size,out float ang,out float z){
  int j=int(r2.w+0.5);
  vec4 G=texelFetch(geomTex,ivec2(j,0),0),D=texelFetch(clusterTex,ivec2(j,0),0),air=texelFetch(clusterTex,ivec2(j,1),0),S=texelFetch(clusterTex,ivec2(j,2),0);
  bool faithful=height.x>0.5;
  float L=D.x,T=faithful?D.y*(1.0-r4.z):D.y;
  vec2 t=G.xy,P=G.zw;
  if(!faithful){
    vec2 d=t-P;float r=max(length(d),0.001),sa=D.z*0.6,cs=cos(sa),sn=sin(sa),len=min(drift.z,r*0.9);
    t-=len*vec2(cs*d.x+sn*d.y,-sn*d.x+cs*d.y)/r;
  }
  float ct=cos(T),st=sin(T),cl=cos(L),sl=sin(L);
  vec2 d=r0.xy-t,x=t+vec2(ct*d.x-st*d.y,st*d.x+ct*d.y);
  float u=wind.x+S.z;
  float wm=flutter.z>0.0?abs(u)*(1.0-flutter.z)+air.x*flutter.z:abs(u);
  float sw=flutter.x*r1.z*(0.5*u+wm*leafFlutter(sin(wind.w*flutter.y*6.2831853+r1.w),wind.w,r1.w,flutter.y,band.x,band.y));
  if(flutter.w>0.0){float dg=clamp((wm/(flutter.w*${DEPTH_L0})-air.y)/${DEPTH_W}+1.0,0.0,1.0);sw*=dg*dg*(3.0-2.0*dg);}
  z=faithful?D.z+r4.x*D.w:height.y+r4.x*height.z;
  float gain=faithful?z/max(height.w,0.001):1.0+drift.w*(z/height.y-1.0);
  float ph=drift.x+r3.w,co=cos(r3.z),so=sin(r3.z);
  vec2 o=vec2(r3.x*cos(ph),r3.y*sin(ph)),xp=x-P;
  pos=P+vec2(cl*xp.x-sl*xp.y,sl*xp.x+cl*xp.y)+(wind.yz+S.xy)*gain+drift.y*vec2(co*o.x+so*o.y,-so*o.x+co*o.y);
  size=vec2(r0.z,r0.w*max(0.05,abs(cos(r1.y+sw))));
  ang=r1.x-L-T+0.2*sw;
}
void main(){
  vec2 pa,pb,sa,sb;float aa,ab,za,zb;
  moved(iA0,iA1,iA2,iA3,iA4,uClusterA,uGeomA,uWindA,uFlutterA,uBandA,uDriftA,uHeightA,pa,sa,aa,za);
  moved(iB0,iB1,iB2,iB3,iB4,uClusterB,uGeomB,uWindB,uFlutterB,uBandB,uDriftB,uHeightB,pb,sb,ab,zb);
#ifdef PATCH_TRIP
  float p=iPair.z,w=smoothstep(p*(1.0-uTripD),p*(1.0-uTripD)+uTripD,uW);
  oD=vec4(w,mix(uEdges.x,uEdges.y,w),0.0,0.0);
#else
  float w=uW;
#endif
  // carry(): area linearly, aspect logarithmically, the angle the short way round
  float area=mix(iPair.x>0.5?sa.x*sa.y:0.0,iPair.y>0.5?sb.x*sb.y:0.0,w);
  float aspect=exp(mix(log(sa.x/sa.y),log(sb.x/sb.y),w));
  oA=vec4(mix(pa,pb,w),sqrt(area*aspect),sqrt(area/aspect));
  oB=vec4(aa+(mod(ab-aa+3.14159265359,6.28318530718)-3.14159265359)*w,mix(iA2.xyz,iB2.xyz,w));
  oC=vec4(mix(za,zb,w),mix(iA4.y,iB4.y,w),iA4.w,iB4.w);
  gl_Position=vec4(0.0,0.0,0.0,1.0);
}`;
const VS_LEAF_CARRY = `#version 300 es
${GLSL_LEAF_CARRY_VERTEX}`;
const VS_LEAF_CARRY_PATCH = `#version 300 es
#define PATCH_TRIP
${GLSL_LEAF_CARRY_VERTEX}`;
// The carriers' pass draws nothing (RASTERIZER_DISCARD); a program still needs a fragment stage to link.
const FS_LEAF_CARRY = `#version 300 es
precision highp float;
out vec4 frag;
void main(){ frag=vec4(0.0); }`;
// What the carriers' pass writes, in the order the stamp reads it (interleaved).
const LEAF_CARRY_OUT = ['oA','oB','oC'], LEAF_CARRY_PATCH_OUT = ['oA','oB','oC','oD'];
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

// FAITHFUL skeleton (spec/model/canopy.md): the woody skeleton — trunk + branches + TWIGS — baked into the SAME faithful pass as
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
uniform int  uCurtainBake;            // 1 = project onto the VERTICAL curtain plane (spec/model/receivers.md); 0 = floor
uniform float uClothY;                // curtain plane world-Y (cy) when uCurtainBake
uniform vec2 uSegSway;                // rigid plan sway added to both endpoints. The CAST path bakes its own
                                      // height-scaled sway into the instance data and leaves this at 0; the SKY
                                      // view's layer stamp needs the LEAF bake's per-layer sway instead, or the
                                      // twigs and the leaves hanging on them drift apart under wind (spec/model/sky-view.md).
out float vAcross;
flat out float vWoodFade;
#ifdef SEG_FINE
// WOOD UNDER ITS OWN PENUMBRA (thin_twigs; komorebi-bake.js draws these once, after the sample loop). A twig narrower than the blur of its shadow
// casts, summed over the sun's samples, a soft stripe as wide as the sample cloud's spread at its height, taking the light its own width takes. So it is
// drawn once, along the cloud's mean direction (uG), as a box that wide (the box with the cloud's variance across the twig: half-width √3·σ·h), at
// least three quarters of a texel so it is never lost between pixel centres, and passing the share of the light its own width leaves (vFrac).
uniform vec3  uGCov;     // the samples' covariance of g: xx, xy, yy
uniform float uTexel;    // one cast texel, in metres
out float vFrac;
#endif
void main(){
  float t = aCorner.x*0.5 + 0.5;                 // 0 at a, 1 at b
  // project BOTH endpoints to the receiver at their OWN heights FIRST, then build the capsule around that SHADOW spine.
  // The width is ⊥ the streak, so a vertical trunk (no plan extent) still casts a round streak at every azimuth.
  // FLOOR: endpoint - uG·h. CURTAIN (spec/model/receivers.md): onto the vertical cloth → (px - r·gx, h - r), r=(py-cy)/gy.
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
#ifdef SEG_FINE
  float h = mix(iSegH.x, iSegH.y, t);
  float s2 = perp.x*perp.x*uGCov.x + 2.0*perp.x*perp.y*uGCov.y + perp.y*perp.y*uGCov.z;
  float halfW = max(max(r, 1.7320508*h*sqrt(max(s2, 0.0))), 0.75*uTexel);
  vFrac = r/halfW; r = halfW;
#endif
  vec2 world = mix(Ap, Bp, t) + perp * (aCorner.y * r);
  gl_Position = vec4((world - uFaithOrigin)/uFaithExtent*2.0-1.0, 0.0, 1.0);
  vAcross = aCorner.y;
  vWoodFade = iWoodFade;
}`;
// thin_twigs' cast of the wood under its own penumbra: the skeleton's shaders with SEG_FINE defined (above), a program of its own, so the cast that never
// opens it runs the shaders it always ran
// A program's variant: its source with one name defined after the version line, written as a literal so a bundle that cuts the variant's tier drops it
// and, with it, the last reference to its source (embed-build.mjs, the orphan sweep).
const afterVersion = (src) => src.slice(src.indexOf('\n') + 1);
// The same at run time, for a program made of a base and the names its look asks for (komorebi-tree-view.js): none, and it is the base itself.
const defineIn = (src, names) => names.length ? `#version 300 es\n${names.map((n) => `#define ${n}\n`).join('')}${afterVersion(src)}` : src;
const VS_FAITH_SEG_FINE = `#version 300 es
#define SEG_FINE
${afterVersion(VS_FAITH_SEG)}`;

const FS_FAITH_SEG = `#version 300 es
precision highp float;
in float vAcross;
flat in float vWoodFade;
#ifdef SEG_FINE
in float vFrac;
#endif
uniform float uWoodTau;
uniform int uSegTau;   // 0 = TRANSMITTANCE, for the cast's multiplicative scratch. 1 = OPTICAL DEPTH, for the layer
                       // textures, which accumulate additively and exponentiate at the tap — the leaves' own convention
out vec4 frag;
void main(){
  float cov = 1.0 - smoothstep(0.9, 1.0, abs(vAcross));    // tight anti-alias rim — keep THIN twigs opaque (the soft penumbra comes from the per-sample integration, not this edge)
  // THE LAYER STAMP WRITES THE WOOD'S OWN TEXTURE, an R16F per layer (spec/model/sky-view.md), and only r of it. The layer texture's rgb is the FOLIAGE's
  // optical depth and its alpha the leaves' COVERAGE, and the sky view's scatter reads its density and hue from exactly those.
  // Neutral wood dropped into rgb normalizes to a near-white hue at near-full density, so the twig web would light up as cream
  // filaments brighter than the sky it stands against; wood occludes, it does not glow — so it lives where the sun's own
  // coverage cannot meet it. (Additive blend, cleared to 0 per layer: a layer with no twigs reads as no wood.) Half float, because
  // the depth accumulates and must round as it did when it shared the layer texture's alpha: the bytes did not move.
  if(uSegTau != 0){ frag = vec4(uWoodTau*cov*vWoodFade, 0.0, 0.0, 0.0); return; }
#ifdef SEG_FINE
  frag = vec4(vec3(1.0 - vFrac*(1.0 - exp(-uWoodTau*cov*vWoodFade))), 1.0);   // the twig's own darkening, spread over its penumbra
#else
  frag = vec4(vec3(exp(-uWoodTau*cov*vWoodFade)), 1.0);              // wood blocks every colour equally → dark, neutral
#endif
}`;
const FS_FAITH_SEG_FINE = `#version 300 es
#define SEG_FINE
${afterVersion(FS_FAITH_SEG)}`;

// THE LITTER CARPET (spec/model/season.md, komorebi-litter.js): the fallen leaves stamped onto the floor, once per regrow, into an RGBA8 texture over the fill's frame.
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
layout(location=2) in vec4 iB;        // cos, sin of its angle on the ground; the fade it carries (spec/contracts/continuity.md); the outline it lies in (komorebi-leaf.js; 0 for the ellipse)
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

// ---- THE LOOK'S TAIL (spec/model/camera.md), as one shared string. Exposure -> tone curve -> contrast -> gamma: the last thing
// that happens to a pixel, and the step the lateral-diffusion tier (spec/model/receivers.md) has to RELOCATE, because a 2-D spread of
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
// set the sky fill bakes on the faithful path (komorebi-bake.js): a point at height z sees the layers above z + half a layer (its own layer would shade it; under beam_march, the part of
// its own layer's slab above it, beamMarch),
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
uniform int   uNeutral;              // leaf_neutral: the leaf as tissue (komorebi-leaf.js SLAB_NEUTRAL); 0 = the texel mixture as it was
uniform vec3  uClearK;               // −ln of what the clear tissue leaf passes, per channel: the neutral depth each leaf adds to the beam when uNeutral is on
uniform float uCrownP;               // crown_light: the recollision probability p; 0 = the crown's own light is not gathered
uniform int   uOpenSky;              // open_sky: a leaf's sky through the gaps around it, not the column above it; 0 = the column, as it was
uniform int   uBeamMarch;            // beam_march: the beam read across each slab's thickness above the leaf; 0 = at the layer's plane, as it was
${GLSL_TEXEL_MIX}
// The texel as a mixture of tissue leaves (uNeutral): each leaf passes the clear leaf's share of its pigment's T, so the clear depth stacks with the
// leaves as the pigment's does (c/a leaves deep). T is what the texel passes, Tb its ballistic share.
void texelMixClear(vec3 tau, float c, float k, out vec3 T, out vec3 Tb){
  if(c < 1e-4){ T = vec3(1.0); Tb = T; return; }
  float a = min(c, 1.0);
  vec3 tbar = tau/a + uClearK*(c/a);
  T  = vec3(1.0 - a) + a*exp(-tbar);
  Tb = vec3(1.0 - a) + a*exp(-tbar - k*c/a);
}
// A leaf's albedo ω = R + T, for the light it scatters into the crown, from what it passes: PROSPECT-D's one curve for every pigment state, R ≈ 0.885·T − 0.019.
// One rule for every leaf the field meets, the lit leaf too; the slab's faces only say how the lit leaf shows it (spec/model/leaf.md).
vec3 leafAlbedo(vec3 T){ return T + max(0.885*T - 0.019, 0.0); }
// THE BOUNCES ARE GREY. A channel is a band, and a band's mean albedo raised to the n is not its albedo raised to the n averaged: a gold leaf keeps 0.89 of
// 555–600 nm and little of 490–540, so bounce after bounce its light stays amber, where the green channel's mean (0.55–0.63) to the n sends it red. Taken
// spectrally (PROSPECT-D) the recollision series keeps a gold leaf's hue within 2–6°, where per-channel powers swing it 12–35° toward red; a green leaf is
// the same either way. A single product of two gold bands reddens as well (a gold leaf in its crown's light: 87° spectrally, 69° as an RGB product, 94°
// as the leaf's own colour under grey light). So the field is grey: every scatter that feeds it, and its decay with depth, at the luminance albedo, and the
// leaf it lights gives it the leaf's colour.
float albedoY(vec3 w){ return dot(w, vec3(0.2126, 0.7152, 0.0722)); }
// THE CROWN'S OWN LIGHT (crown_light, spec/model/leaf.md). Down the sun's path, the light the leaves above scattered rather than passed on as the beam: at each
// layer the beam's intercepted share is scattered by the leaf's ω less what went on ballistically, half of it downward, and the light already scattered
// crosses the layer by its gaps and, through the leaves, decays as the two-stream diffuse field does, e^−κ per leaf with κ = √((1−ω)(1−ω+2βω)), β = R/ω the
// share a leaf sends back: light sent back up is met again and mostly returned. The layers are met in the order the light meets them, from the sun's side.
// The source is grey (the bounces are grey, above), but it DECAYS BY CHANNEL: what survives many leaves is the band the leaf keeps, and a gold leaf keeps
// 0.92 of red and 0.77 of green, so ten leaves deep a grey κ at its luminance albedo 0.75 leaves some 2.5 times too little light. The field is read as its
// luminance (crownField), so the bands set how much of it arrives and the leaf it lights still gives it the colour.
void crownTap(vec3 tau, float c, float k, vec3 Tbeam, inout vec3 dif, inout vec3 om){
  if(c < 1e-4) return;
  float a = min(c, 1.0), n = max(c/a, 1.0);                       // the texel's leaf area and how many leaves deep it stacks
  vec3 t1 = exp(-tau/c - uClearK*float(uNeutral)), tb1 = t1*exp(-k);   // ONE leaf's T and its ballistic share (the stack's would read a clump as one black leaf)
  vec3 w = leafAlbedo(t1);
  float wY = albedoY(w);
  vec3 beta = max(w - t1, 0.0)/max(w, vec3(1e-4));
  vec3 kap = sqrt(max((1.0 - w)*(1.0 - w + 2.0*beta*w), 0.0));
  // the beam is scattered in the stack's first leaf, and what it scatters downward crosses the n − 1 below
  dif = dif*((1.0 - a) + a*exp(-kap*n)) + Tbeam*a*0.5*max(wY - albedoY(tb1), 0.0)*exp(-kap*(n - 1.0));
  om = w;
}
// THE BEAM THROUGH A SLAB (beam_march, spec/model/leaf.md). A layer holds a slab's leaves flattened onto one plane, so read at the one point where the sun's
// path meets that plane it misses the slab everywhere else the path crosses it. Under a low sun the path runs cot(elevation) metres across per metre up, 11 m
// across a 3 m slab at 15°: most leaves' single point falls outside the crown and they stand in full sun, while a few, whose point lands in the crown's
// core, take the whole flattened slab there and go black. Read instead at BEAM_TAPS heights spread through the part of the slab above the leaf, each taking
// its share of the slab's leaves (they are spread through its thickness), the path gathers the crown it really crosses: the sunny side lit, the far side
// in the crown's own shade.
const int BEAM_TAPS = 4;
void beamMarch(highp sampler2D L, float h, vec3 P, inout vec3 Tsun, inout vec3 dif, inout vec3 om){
  float z0 = max(P.z, h - uLayerHalf), z1 = h + uLayerHalf;
  if(z1 <= z0) return;
  float w = (z1 - z0)/(2.0*uLayerHalf)/float(BEAM_TAPS);
  for(int j = BEAM_TAPS - 1; j >= 0; j--){                         // from the sun's side in, the order the light meets them (crownTap)
    float z = z0 + (z1 - z0)*(float(j) + 0.5)/float(BEAM_TAPS);
    vec2 uv = (P.xy + (z - P.z)*uSunG - uLayerOrigin)/uLayerExtent;
    if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
    vec4 t = texture(L, uv); vec3 T, Tb;
    if(uNeutral == 0) texelMix(t.rgb*w, t.a*w, uBeamK, T, Tb);
    else texelMixClear(t.rgb*w, t.a*w, uBeamK, T, Tb);
    if(uCrownP > 0.0) crownTap(t.rgb*w, t.a*w, uBeamK, Tsun, dif, om);
    Tsun *= Tb;
  }
}
// A layer stands for the leaves of a slab a layer thick about its height, so it shades a point by as much of it as lies above the point: none at the
// point's own height (a leaf does not shade itself) rising to all of it a layer above. Continuous in height: a step here draws a line across the crown.
void treeTap(highp sampler2D L, float h, vec3 P, inout vec3 Tsun, inout float lai, inout vec3 dif, inout vec3 om){   // a sampler array takes only a constant index in GLSL ES 3.00: one call a layer
  if(uBeamMarch != 0) beamMarch(L, h, P, Tsun, dif, om);
  float f = clamp((h - P.z)/(2.0*uLayerHalf), 0.0, 1.0);
  if(f <= 0.0) return;
  vec2 uvS = (P.xy + (h - P.z)*uSunG - uLayerOrigin)/uLayerExtent, uvK = (P.xy - uLayerOrigin)/uLayerExtent;
  if(uBeamMarch == 0 && all(greaterThanEqual(uvS, vec2(0.0))) && all(lessThanEqual(uvS, vec2(1.0)))){
    vec4 t = texture(L, uvS); vec3 T, Tb;
    if(uNeutral == 0) texelMix(t.rgb*f, t.a*f, uBeamK, T, Tb);
    else texelMixClear(t.rgb*f, t.a*f, uBeamK, T, Tb);
    if(uCrownP > 0.0) crownTap(t.rgb*f, t.a*f, uBeamK, Tsun, dif, om);
    Tsun *= Tb;
  }
  if(all(greaterThanEqual(uvK, vec2(0.0))) && all(lessThanEqual(uvK, vec2(1.0)))) lai += f*texture(L, uvK).a;
}
// dif: the crown's scattered light reaching P down the sun's path (0 unless uCrownP > 0); om: the albedo of the nearest leaves above P.
void treeLight(vec3 P, out vec3 Tsun, out float Tsky, out vec3 dif, out vec3 om){
  Tsun = vec3(1.0); float lai = 0.0; dif = vec3(0.0); om = vec3(0.0);
  if(uCrownP > 0.0){   // the crown's light is gathered in the order the light meets the layers, the top first (crownTap); without it the order the beam always took
    if(3 < uLayerCount) treeTap(uLayer[3], uLayerHeight[3], P, Tsun, lai, dif, om);
    if(2 < uLayerCount) treeTap(uLayer[2], uLayerHeight[2], P, Tsun, lai, dif, om);
    if(1 < uLayerCount) treeTap(uLayer[1], uLayerHeight[1], P, Tsun, lai, dif, om);
    if(0 < uLayerCount) treeTap(uLayer[0], uLayerHeight[0], P, Tsun, lai, dif, om);
  } else {
    if(0 < uLayerCount) treeTap(uLayer[0], uLayerHeight[0], P, Tsun, lai, dif, om);
    if(1 < uLayerCount) treeTap(uLayer[1], uLayerHeight[1], P, Tsun, lai, dif, om);
    if(2 < uLayerCount) treeTap(uLayer[2], uLayerHeight[2], P, Tsun, lai, dif, om);
    if(3 < uLayerCount) treeTap(uLayer[3], uLayerHeight[3], P, Tsun, lai, dif, om);   // one a layer, MAX_LAYERS of them (komorebi-params.js): tree-view.test.js holds the count to it
  }
  Tsky = exp(-0.5*lai);
}
// THE SKY A LEAF SEES (open_sky, spec/model/leaf.md). The column straight above a leaf on the crown's flank holds the whole crown, so read alone it puts that
// leaf in the dark although half its sky is open beside it. The open sky is gathered along nine paths through the layers above the leaf, each by the share
// of the sky it stands for: a leaf's faces turn every way, so it takes the sky by solid angle, and the sky below 30° is half of it, 30–60° 37%, above 60°
// 13%. The column stands for the top, four paths at 45° for the middle and four at 15° (between them in azimuth) for the low sky a flank leaf has open; a
// slant path crosses its layers' leaves 1/sin(elevation) deep.
const float SKY_COT_MID = 1.0, SKY_SLANT_MID = 1.41421356, SKY_COT_LOW = 3.73205081, SKY_SLANT_LOW = 3.86370331;
void skyTap(highp sampler2D L, float h, vec3 P, vec2 step, inout float lai){
  float f = clamp((h - P.z)/(2.0*uLayerHalf), 0.0, 1.0);
  if(f <= 0.0) return;
  vec2 uv = (P.xy + (h - P.z)*step - uLayerOrigin)/uLayerExtent;
  if(all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) lai += f*texture(L, uv).a;
}
float skyPath(vec3 P, vec2 step, float slant){
  float lai = 0.0;
  if(0 < uLayerCount) skyTap(uLayer[0], uLayerHeight[0], P, step, lai);
  if(1 < uLayerCount) skyTap(uLayer[1], uLayerHeight[1], P, step, lai);
  if(2 < uLayerCount) skyTap(uLayer[2], uLayerHeight[2], P, step, lai);
  if(3 < uLayerCount) skyTap(uLayer[3], uLayerHeight[3], P, step, lai);
  return exp(-0.5*slant*lai);
}
float treeSkyOpen(vec3 P, float Tzenith){
  const float D = 0.70710678;
  float mid = skyPath(P, SKY_COT_MID*vec2(1.0, 0.0), SKY_SLANT_MID) + skyPath(P, SKY_COT_MID*vec2(-1.0, 0.0), SKY_SLANT_MID)
            + skyPath(P, SKY_COT_MID*vec2(0.0, 1.0), SKY_SLANT_MID) + skyPath(P, SKY_COT_MID*vec2(0.0, -1.0), SKY_SLANT_MID);
  float low = skyPath(P, SKY_COT_LOW*vec2(D, D), SKY_SLANT_LOW) + skyPath(P, SKY_COT_LOW*vec2(-D, D), SKY_SLANT_LOW)
            + skyPath(P, SKY_COT_LOW*vec2(D, -D), SKY_SLANT_LOW) + skyPath(P, SKY_COT_LOW*vec2(-D, -D), SKY_SLANT_LOW);
  return 0.13*Tzenith + 0.37*0.25*mid + 0.5*0.25*low;
}
// The leaf's light with its sky read as open_sky says.
void treeLightSky(vec3 P, out vec3 Tsun, out float Tsky, out vec3 dif, out vec3 om){
  treeLight(P, Tsun, Tsky, dif, om);
  if(uOpenSky != 0) Tsky = treeSkyOpen(P, Tsky);
}
// The crown's light field at a leaf of albedo w: what the leaves above scattered down to it and what its neighbours scatter of the beam and of the sky at
// its own depth, each meeting it with probability p, then every further bounce kept by p·ω_Y (Hovi et al. 2020): F = p·(dif + ω_Y·(Tsun + E_sky·Tsky))/(1 − p·ω_Y),
// E_sky the sky's light on a leaf over the beam's. The sky is a source as the sun is: a crown's flank away from the sun is lit by the skylight its leaves
// catch and pass to one another, which takes their colour, far more than by the sky it sees directly. In units of the beam at normal incidence; each face takes half.
// Scattered light does not stay where it was scattered: it spreads through the crown by about a photon's free path between leaves (CROWN_REACH, ~1 m at a
// crown's leaf density of 1–2 m² m⁻³), so the field is gathered at P and at four points that far around it in plan, and a leaf in a clump's shadow is lit by
// its sunlit neighbours.
// It changes over that metre and not within a leaf, so it is gathered once a frame at the centres of a grid of half-metre cells over the layers' box
// (FS_CROWN_GRID) and every leaf and the wood read it there, between the eight cells about them.
const float CROWN_REACH = 1.0;
void crownGather(vec3 P, out vec3 S, out float Dy, out float K){   // the beam (S), the scattered light (Dy, its luminance) and the sky (K) about P, summed
  vec3 Ts, d, o, D = vec3(0.0); float k;
  S = vec3(0.0); K = 0.0;
  treeLight(P, Ts, k, d, o); S += Ts; D += d; K += k;
  treeLight(P + vec3(CROWN_REACH, 0.0, 0.0), Ts, k, d, o); S += Ts; D += d; K += k;
  treeLight(P - vec3(CROWN_REACH, 0.0, 0.0), Ts, k, d, o); S += Ts; D += d; K += k;
  treeLight(P + vec3(0.0, CROWN_REACH, 0.0), Ts, k, d, o); S += Ts; D += d; K += k;
  treeLight(P - vec3(0.0, CROWN_REACH, 0.0), Ts, k, d, o); S += Ts; D += d; K += k;
  Dy = albedoY(D);
}
float crownSky(){ return albedoY(uAmbient)/max(albedoY(uLeafSun), 1e-6); }   // the sky's light on a leaf, in the beam's units
vec3 crownLight(vec3 G, float Dy, vec3 w){   // G: the beam and the sky gathered, S + sky·K
  float wY = albedoY(w);
  return uCrownP*0.2*(vec3(Dy) + wY*G)/max(1.0 - uCrownP*wY, 0.05);   // the field arrives grey, by its luminance (crownTap)
}
#ifdef CROWN_FIELD
uniform highp sampler3D uCrownGrid;  // (S + sky·K, Dy) at each cell's centre, this frame's (FS_CROWN_GRID)
uniform vec3  uCrownOrigin;          // the grid's box (m): the layers' box in plan, the floor to the highest leaf
uniform vec3  uCrownSize;
vec3 crownField(vec3 P, vec3 w){ vec4 g = texture(uCrownGrid, (P - uCrownOrigin)/uCrownSize); return crownLight(g.rgb, g.a, w); }
#endif`;

// THE SKY SEEN (view_sky, spec/model/light.md): the sky's radiance along a ray, which the floor camera shows over its horizon and into which the far floor
// and the far tree fade; its uniforms are set from komorebi-light.js skyModel by whoever draws with it (komorebi-render.js, komorebi-tree-view.js).
const GLSL_SKY_SEEN = `uniform vec3  uSkySunDir, uSkyR, uSkyA, uSkyO, uSkyIso, uSkyScale;   // view_sky: the unit sun and skyModel's air and second order (komorebi-light.js), which this mirrors
uniform float uSkyMs;             // view_sky: the sun's air mass at the ground
// THE SKY SEEN (komorebi-light.js skyShape, which the sky test holds this to): single scattering along the ray through the exponential air, in the receivers' units
const float SKY_G = 0.76, SKY_HR = 8.0, SKY_HA = 1.2, SKY_R = 6371.0, SKY_TOP = 60.0;
const int SKY_STEPS = 16;
vec3 skyRadiance(vec3 d){
  float z = max(d.z, 0.0), mu = dot(vec3(d.xy, z), uSkySunDir);
  float pR = 0.05968310*(1.0 + mu*mu), pA = 0.07957747*(1.0 - SKY_G*SKY_G)/pow(1.0 + SKY_G*SKY_G - 2.0*SKY_G*mu, 1.5);
  float tMax = sqrt((SKY_R + SKY_TOP)*(SKY_R + SKY_TOP) - SKY_R*SKY_R*(1.0 - z*z)) - SKY_R*z, tPrev = 0.0;
  vec3 L = vec3(0.0), tv = vec3(0.0);
  for(int k = 0; k < SKY_STEPS; k++){
    float u = (float(k) + 0.5)/float(SKY_STEPS), t = tMax*u*u, dt = tMax*2.0*u/float(SKY_STEPS);
    float h = max(0.0, sqrt(SKY_R*SKY_R + t*t + 2.0*SKY_R*t*z) - SKY_R), eR = exp(-h/SKY_HR), eA = exp(-h/SKY_HA);
    vec3 sR = uSkyR/SKY_HR*eR, sA = uSkyA/SKY_HA*eA;
    tv += (sR + sA)*(t - tPrev);
    L += ((sR*pR + sA*pA)*exp(-uSkyMs*(uSkyR*eR + uSkyA*eA + uSkyO)) + (sR + sA)*uSkyIso)*exp(-tv)*dt;
    tPrev = t;
  }
  return uSkyScale*L;
}`;

// The Look's per-pixel finish, the floor's GLSL_T_POST in the same order (komorebi-transport.js): the dusk shift keyed by this point's own sun visibility,
// the haze by its distance from the looked-at point as the floor's, the iris mask, the tail. The tail's curve is the tree's own (spec model/camera.md, the
// tree's curve; treeCurve in komorebi-camera.js is this arithmetic on the CPU): AgX with its contrast look, mixed over the frame's by tree_tone, so at 0
// the tree is finished exactly as the floor is.
const GLSL_TREE_FINISH = `uniform float uTreeTone;
uniform float uTwilight;
uniform float uMesopic;
uniform vec3  uHazeColor;
uniform float uHalfExtent;
uniform vec2  uViewCenterF;
uniform float uVignette;
uniform float uVignetteShape;
uniform float uIrisOpacity;
uniform vec2  uTarget;               // the target's size in pixels, for the iris's frame position
#ifdef VIEW_SKY
${GLSL_SKY_SEEN}
#endif
${GLSL_TONE_TAIL}
const mat3 AGX_IN = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const mat3 AGX_OUT = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
vec3 treeTail(vec3 col){
  vec3 frame = toneTail(col);
  if(uTreeTone <= 0.0) return frame;
  vec3 x = AGX_IN*max(col*uExposure*${TREE_GAIN}, vec3(1e-10));
  x = (clamp(log2(x), -12.47393, 4.026069) + 12.47393)/16.5;
  vec3 x2 = x*x, x4 = x2*x2;
  x = pow(max(15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232, vec3(0.0)), vec3(${TREE_POWER}));
  x = pow(clamp(AGX_OUT*x, 0.0, 1.0), vec3(2.2));
  x = clamp((x - 0.5)*uContrast + 0.5, 0.0, 1.0);   // the Look's contrast and gamma, as the frame's tail takes them
  return mix(frame, pow(x, vec3(1.0/2.2)), uTreeTone);
}
vec3 treeFinish(vec3 col, vec3 Tsun, vec3 P){
  const vec3 ROD_BLUE = vec3(0.92, 1.0, 1.30);
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float rod = (1.0 - smoothstep(0.15, 0.6, dot(Tsun, LUMA)))*uTwilight*uMesopic;
  col = mix(col, dot(col, LUMA)*ROD_BLUE, rod*0.6);
  float fog = smoothstep(1.15*uHalfExtent, 3.0*uHalfExtent, length(P.xy - uViewCenterF));
#ifdef VIEW_SKY
  if(fog > 0.0) col = mix(col, skyRadiance(normalize(P - uEye)), fog);   // view_sky: into the sky's horizon along the ray from the eye, as the floor beside it
#else
  col = mix(col, uHazeColor, fog);
#endif
  if(uVignette > 0.0){
    vec2 q = abs(gl_FragCoord.xy/uTarget*2.0 - 1.0);
    float d = pow(pow(q.x, uVignetteShape) + pow(q.y, uVignetteShape), 1.0/uVignetteShape);
    col *= 1.0 - uIrisOpacity*smoothstep(1.0 - uVignette, 1.0, d);
  }
  return treeTail(col);
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
  vec3 Tsun, dif, om; float Tsky; treeLightSky(vWorld, Tsun, Tsky, dif, om);
  vec3 sunE = uLeafSun*mix(1.0, abs(ns), uSunCosine)*Tsun, skyE = uAmbient*Tsky;
  float up = 0.5 + 0.5*n.z, down = 0.5 - 0.5*n.z, skySeen = seenTop ? up : down, skyOther = seenTop ? down : up;
  float Fi = fresnel(abs(ns), 1.56), Fv = fresnel(abs(nv), 1.56);
  vec3 col, Rc = vec3(0.0), Tc = vec3(0.0);
  for(int c = 0; c < 3; c++){
    vec3 m = texture(uSlab, vec2((sqrt(clamp(T[c], 0.0, 1.0))*(${SLAB_N}.0 - 1.0) + 0.5)/${SLAB_N}.0, (float(c) + 0.5)/3.0)).rgb;   // the table is spaced in √T, a sample at each texel's centre
    float Rseen = seenTop ? m.r : m.g;
    col[c] = (1.0 - Fv)*((same ? (1.0 - Fi)*sunE[c]*Rseen : (1.0 - Fi)*sunE[c]*m.b) + (1.0 - uF0)*(skyE[c]*skySeen*Rseen + skyE[c]*skyOther*m.b));
#ifdef CROWN_FIELD
    Rc[c] = Rseen; Tc[c] = m.b;
#endif
  }
#ifdef CROWN_FIELD
  {   // the crown's own light: an isotropic field whose bounces this leaf keeps by its albedo (leafAlbedo, as every leaf it meets), seen half on each face
    vec3 w = leafAlbedo(T*exp(-uClearK*float(uNeutral)));
    col += (1.0 - Fv)*(1.0 - uF0)*0.5*uLeafSun*crownField(vWorld, w)*(Rc + Tc);
  }
#endif
  frag = vec4(treeFinish(col, Tsun, vWorld), a);
  cover = vec4(1.0);
}`;

// THE WOOD, SEEN: the faithful skeleton's own swayed segments (the cast's, this frame), each a cylinder turned to face the eye, its normal rebuilt across it.
// Lit like a leaf's face by the sun through the leaves above and the sky it sees; its colour is the bark's (bark_r/g/b).
// THE ROOT FLARE (trunk_base), as both wood stages read it: the foot widens by FLARE_F of the trunk's radius, falling off over FLARE_H radii up: slight and
// long, as an elm's in the open (at 0.7 it stood on a wide straight-sided base, an elephant's foot; over 0.6 radii it was a lip).
const GLSL_FLARE = `const float FLARE_F = 0.18, FLARE_H = 1.5;`;
const VS_TREE_WOOD = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // x along a→b, y across
layout(location=1) in vec4 iSeg;      // plan endpoints a.xy, b.xy
layout(location=2) in vec4 iSegH;     // heights a, b; radii a, b
layout(location=3) in float iWoodFade;
${GLSL_TREE_CAMERA}
uniform vec3 uEyeW;
uniform float uWoodPx;               // thin_twigs: the height a pixel spans per metre from the eye (2·tan(fov/2)/rows); 0 = the wood at its own width, as it was
uniform int uFootCount;              // trunk_base: the trunks' feet (plan point, radius); 0 = none, the wood as it was
uniform vec3 uFoot[16];
${GLSL_FLARE}
out vec3 vWorld;
out vec3 vAcrossDir;
out vec3 vToEye;
out float vAcross;
out float vWoodCov;
out float vWoodRad;
out float vAlong;                    // the distance along the axis from a (m), the card's run-on past either end included
flat out float vLen;
out float vFlareZ;                   // trunk_base: the height up a foot capsule's axis (−1 on every other capsule)
flat out vec4 vFlare;                // trunk_base: a foot capsule's own radii at its ends, the trunk's radius r0 and its length; the card's half-width is the flare's
flat out vec3 vWoodAx;               // bark_texture: the capsule's axis, which the bark's ridges run along
flat out float vWoodFade;
flat out uint vWoodId;
void main(){
  vec3 A = vec3(iSeg.xy, iSegH.x), B = vec3(iSeg.zw, iSegH.y);
  vWoodId = uint(gl_InstanceID);
  float t = aCorner.x*0.5 + 0.5, rad = mix(iSegH.z, iSegH.w, t);
  vFlareZ = -1.0; vFlare = vec4(0.0);
#ifdef WOOD_FOOT
  // VS_TREE_WOOD_FOOT only: compiled into the program a tree without feet draws with, this loop moved its arithmetic and a pixel of its wood, though it
  // never ran
  for(int i = 0; i < 16; i++){ if(i >= uFootCount) break;   // a foot capsule: its base on a trunk's foot. Its card is the flare's full width all along, cut to the profile in the fragment
    if(A.z < 0.05 && distance(A.xy, uFoot[i].xy) < 0.5*uFoot[i].z){ float L = distance(A, B);
      vFlare = vec4(iSegH.z, iSegH.w, uFoot[i].z, L); rad = iSegH.z + FLARE_F*uFoot[i].z; vFlareZ = t*L + aCorner.x*rad; } }
#endif
  // A twig thinner than a pixel is drawn a pixel wide and as much of it as it covers (thin_twigs): drawn at its own width it would fall between the samples
  // and break into dashes, and drawn wider at full strength it would darken the crown by its whole pixel.
  vWoodCov = 1.0;
  if(uWoodPx > 0.0){ float hp = 0.5*uWoodPx*length(uEyeW - mix(A, B, t)); if(rad < hp){ vWoodCov = rad/hp; rad = hp; } }
  vec3 axis = B - A; float len = max(length(axis), 1e-5); vec3 ax = axis/len;
  vAlong = t*len + aCorner.x*rad; vLen = len;
  vec3 C = mix(A, B, t) + ax*aCorner.x*rad;                          // each end runs on by its radius, so joints close
  vec3 toEye = normalize(uEyeW - C), across = cross(ax, toEye);
  across = length(across) < 1e-5 ? vec3(1.0, 0.0, 0.0) : normalize(across);
  vec3 P = C + across*aCorner.y*rad;
  vWoodRad = rad; vWoodAx = ax;
  vWorld = P; vAcrossDir = across; vToEye = normalize(cross(across, ax)); vAcross = aCorner.y; vWoodFade = iWoodFade;
  if(dot(vToEye, toEye) < 0.0) vToEye = -vToEye;
  gl_Position = treeClip(P);
}`;
// trunk_base with feet to flare
const VS_TREE_WOOD_FOOT = `#version 300 es
#define WOOD_FOOT
${afterVersion(VS_TREE_WOOD)}`;
const FS_TREE_WOOD = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vAcrossDir;
in vec3 vToEye;
in float vAcross;
in float vWoodCov;
in float vWoodRad;
in float vAlong;
flat in float vLen;
in float vFlareZ;
flat in vec4 vFlare;
flat in vec3 vWoodAx;
flat in float vWoodFade;
flat in uint vWoodId;
uniform vec3 uBark;
uniform int uGroundClip;   // trunk_base: 1 = no wood below the ground; 0 = the capsule whole, its foot run on below the ground and drawn over the floor, as it was
uniform vec3 uEyeW;
uniform int uRoundEnds;   // trunk_split: 1 = a capsule's ends are round; 0 = the card's run-on past each end is square, as it was
${GLSL_FLARE}
uniform float uBarkTex;   // bark_texture: how deep the bark's furrows are, 0..1; 0 = smooth bark of one colour, as it was
// THE BARK (bark_texture): an elm's, an oak's, an ash's old bark is ridges running up the stem that part and meet again round long furrows. Laid on the round
// in its own coordinates: round it by angle, BARK_RIDGES ridges whatever the branch's width (a thin limb's bark is as finely cut, for its size, as
// the trunk's), so the pattern closes on itself; along it by the distance up the axis, a ridge BARK_LONG times as long as it is wide. Height 1 is a
// ridge's crest, 0 a furrow's floor. The furrow is darker (it sees less of the sky and the sun) and the crest's flanks turn the round's normal, so a low
// sun picks the ridges out. Under a pixel the ridges average out to the bark's own colour, and the pattern fades out before it can alias.
const float BARK_RIDGES = 24.0, BARK_LONG = 8.0, BARK_PLATES = 8.0;
float barkHash(vec2 p){ p = fract(p*vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y)*p.x); }
float barkNoise(vec2 p, float period){   // value noise, periodic in x
  vec2 i = floor(p), f = fract(p), w = f*f*(3.0 - 2.0*f);
  float i0 = mod(i.x, period), i1 = mod(i.x + 1.0, period);
  return mix(mix(barkHash(vec2(i0, i.y)), barkHash(vec2(i1, i.y)), w.x), mix(barkHash(vec2(i0, i.y + 1.0)), barkHash(vec2(i1, i.y + 1.0)), w.x), w.y);
}
float barkHeight(vec2 p){   // p: (ridges round, ridge lengths up)
  float x = p.x + 1.5*(barkNoise(vec2(p.x*0.5, p.y*1.3) + 7.1, BARK_RIDGES*0.5) - 0.5);   // the ridges wander and interlace
  float r = 1.0 - abs(2.0*barkNoise(vec2(x, p.y), BARK_RIDGES) - 1.0);
  return 0.7*r + 0.3*(1.0 - abs(2.0*barkNoise(vec2(x*2.0 + 3.0, p.y*2.0 + 3.7), BARK_RIDGES*2.0) - 1.0));
}
${GLSL_TREE_LIGHT}
${GLSL_TREE_FINISH}
layout(location=0) out vec4 frag;
layout(location=1) out vec4 cover;
void main(){
  // UNDER ONE SAMPLE (thin_twigs): the target has four samples a pixel and alpha to coverage gives each fragment a whole number of them, so a twig covering
  // less than an eighth of its pixel would vanish and a crown's haze of them with it. Such a fragment is kept at one sample's weight with the chance its
  // coverage asks (4·cov), on a hash of the pixel and the twig: right on average over the haze, and still from frame to frame while the twig is.
  // THE GROUND (trunk_base): the capsule is a card through its axis facing the eye, so its foot ended in a straight edge and ran on a radius below the
  // ground over the floor. The bark this fragment stands for lies in front of the card by the round's depth there (r·√(1 − x²)), toward the eye; below
  // the ground it is not seen. So a trunk meets the ground along the curve a cylinder does, lowest in front.
  // THE ROOT FLARE (trunk_base): a foot capsule's card is as wide as the flare at the ground; what lies outside the flared profile is dropped and the
  // rest read across the profile's own width, so the bark rounds over the flare as over the trunk. The profile is the capsule's own taper plus
  // FLARE_F·r0·(exp(−z/h) − exp(−L/h)), h = FLARE_H·r0: smooth, and the trunk's own width again at the capsule's top, where the next capsule takes over.
  float across = vAcross, rad = vWoodRad;
  if(vFlareZ > -0.5){ float z = clamp(vFlareZ, 0.0, vFlare.w), h = FLARE_H*vFlare.z;
    float r = mix(vFlare.x, vFlare.y, z/max(vFlare.w, 1e-4)) + FLARE_F*vFlare.z*max(exp(-z/h) - exp(-vFlare.w/h), 0.0);
    across = vAcross*vWoodRad/r; rad = r;
    if(abs(across) > 1.0) discard; }
  // ROUND ENDS (trunk_split): a card runs on past each end by its radius so the next capsule's joint closes, and where a stem goes on in one of
  // its own width that run-on is hidden. At a fork the trunk goes on in thinner stems, and its square run-on stood out round them, a sleeve; cut
  // to the half sphere a capsule ends in, the trunk closes over the fork in a dome the stems leave from.
  if(uRoundEnds != 0){ float e = max(-vAlong, vAlong - vLen), xa = clamp(across, -1.0, 1.0);
    if(e > 0.0 && e*e > rad*rad*(1.0 - xa*xa)) discard; }
  if(uGroundClip != 0){ float xa = clamp(across, -1.0, 1.0);
    if((vWorld + normalize(uEyeW - vWorld)*rad*sqrt(1.0 - xa*xa)).z < 0.0) discard; }
  float cov = vWoodCov;
  if(cov < 0.25){
    uvec3 q = uvec3(uvec2(gl_FragCoord.xy), vWoodId)*uvec3(1597334673u, 3812015801u, 2798796415u);
    uint h = (q.x ^ q.y ^ q.z)*1597334673u;
    if(float(h >> 8)*(1.0/16777216.0) >= 4.0*cov) discard;
    cov = 0.25;
  }
  float x = clamp(across, -1.0, 1.0);
  vec3 n = normalize(vAcrossDir*x + vToEye*sqrt(1.0 - x*x));
  vec3 bark = uBark;
  if(uBarkTex > 0.0){
    // The pattern must run on across a joint, where one capsule hands the stem to the next at a slightly different axis. So the angle round is taken
    // from a reference that does not swing with a small tilt (x for a stem nearer upright than 60°, up for the rest), the distance up as the height
    // over the axis's own rise for those stems (two near-upright capsules nearly agree on it at their joint, differing by the height times the change
    // in 1/cos of their tilt, where dot(world, axis) differed by the tree's whole distance from the origin times the tilt; a stem leaning more than 60°
    // still breaks at a bent joint), and the scale by the stem's taper without the flare's swell.
    bool upright = abs(vWoodAx.z) > 0.5;
    vec3 e1 = normalize(cross(upright ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0), vWoodAx)), e2 = cross(vWoodAx, e1);
    float th = atan(dot(n, e2), dot(n, e1)), up = upright ? vWorld.z/vWoodAx.z : dot(vWorld, vWoodAx);
    float rt = vFlareZ > -0.5 ? mix(vFlare.x, vFlare.y, clamp(vFlareZ/max(vFlare.w, 1e-4), 0.0, 1.0)) : vWoodRad;
    vec2 p = vec2(th/6.2831853*BARK_RIDGES, up/(BARK_LONG*6.2831853*max(rt, 1e-3)/BARK_RIDGES));
    // the plates: a few broad dark streaks round the stem, each many ridges long, which still read where the ridges are under a pixel
    vec2 q = vec2(p.x*BARK_PLATES/BARK_RIDGES, p.y*0.25);
    float fq = uBarkTex*(1.0 - smoothstep(0.3, 0.7, max(fwidth(q.x), fwidth(q.y))));
    if(fq > 0.0) bark *= mix(1.0, mix(0.5, 1.15, barkNoise(q + vec2(0.0, 0.5*barkNoise(q*vec2(1.0, 0.5) + 11.3, BARK_PLATES)), BARK_PLATES)), fq);
    float fade = uBarkTex*(1.0 - smoothstep(0.3, 0.7, max(fwidth(p.x), fwidth(p.y))));
    if(fade > 0.0){
      float h = barkHeight(p), dh = barkHeight(p + vec2(0.05, 0.0)) - h;
      bark *= mix(1.0, mix(0.22, 1.1, smoothstep(0.05, 0.55, h)), fade);   // the furrows narrow and dark between broad crests, as the eye reads old bark
      n = normalize(n - cross(vWoodAx, n)*clamp(dh/0.05, -3.0, 3.0)*0.12*fade);   // a crest's flank turns the round's normal toward its side
    }
  }
  vec3 Tsun, dif, om; float Tsky; treeLightSky(vWorld, Tsun, Tsky, dif, om);
  vec3 col = (uLeafSun*mix(1.0, max(dot(n, uSunDir), 0.0), uSunCosine)*Tsun*(dot(n, uSunDir) > 0.0 ? 1.0 : 0.0) + uAmbient*Tsky*(0.5 + 0.5*n.z))*bark;
#ifdef CROWN_FIELD
  col += uLeafSun*0.5*crownField(vWorld, om)*bark;   // the crown's light on the wood inside it, by the albedo of the leaves above
#endif
  frag = vec4(treeFinish(col, Tsun, vWorld), clamp(vWoodFade, 0.0, 1.0)*cov);
  cover = vec4(1.0);
}`;
// THE CROWN'S GRID (crown_light): the field's sources gathered at one cell's centre, a slice of the grid at a time (komorebi-tree-view.js), each pixel a
// cell. What it stores is all the field needs that does not depend on the leaf it lights: the beam and the sky about the point, S + sky·K, and the
// scattered light's luminance, Dy (crownGather); the leaf's albedo is the reader's.
const FS_CROWN_GRID = `#version 300 es
precision highp float;
${GLSL_TREE_LIGHT}
uniform vec3  uCrownOrigin;
uniform vec3  uCrownSize;
uniform vec3  uCrownN;               // cells per axis
uniform float uCrownSlice;           // this slice's index up the box
layout(location=0) out vec4 frag;
void main(){
  vec3 P = uCrownOrigin + vec3(gl_FragCoord.xy, uCrownSlice + 0.5)/uCrownN*uCrownSize;
  vec3 S; float Dy, K; crownGather(P, S, Dy, K);
  frag = vec4(S + crownSky()*K, Dy);
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

// ---- THE WOOD FIELD (spec/model/sky-view.md): the layer-stamped fine wood, one R16F texture per layer, beside the layers it was stamped with. The sky camera
// declares it, and the sky fill's bake carries the same line because it runs the same shared ray — whose wood reads sit behind
// `readWood`, a literal false in the fill, so the four samplers are declared there and never sampled. No cast camera declares it. ----
const GLSL_WOOD_FIELD = `uniform highp sampler2D uWood[${MAX_LAYERS}];   // r = the wood's optical depth (neutral), per layer; read only where readWood is true`;

// ---- the raw unit sun vector. The floor never needs it (its throw rides uProj/uBulkShift); the fabric's fold
// incidence, the enclosure's per-panel beam and the sky view's seen source and sun path all do. (The sky fill does NOT: it lights its
// leaves along the BEAM's path, uFillG, so the shade and the beam it balances share one sun.) ----
const GLSL_SUN_DIR_DECLS = `uniform vec3  uSunDir;            // UNIT sun direction (cos el·cos az, cos el·sin az, sin el) — the fold flanks' incidence basis (spec/model/receivers.md); NOT a 1/sin E throw`;

// ---- ONE UPWARD RAY THROUGH THE LAYER FIELD (spec/model/sky-view.md, fill.md). Everything that reads the canopy ALONG A RAY runs this one
// source: the sky view's eye ray and each of the sky fill's hemisphere rays. The fill's integrand IS the sky view's
// radiance (spec/model/fill.md), so it is the same GLSL rather than a second copy that agrees today — registry.test.js holds both
// programs to this exact text, and the shared bound below (the telescoping sum) is therefore one bound, not two.
// What differs between the two readers is only HOW a ray reads a texel, and that is said at the call as an argument,
// never as a second function:
//   openOutside — outside the baked canopy box there is no canopy, so the eye sees open sky. (The floor's own taps
//                 never need this — a frame lives inside the box — but an upward ray leaves the box within a few
//                 metres of height, and CLAMP_TO_EDGE would smear the border texel across the whole periphery of the
//                 frame instead of opening onto blue.) The fill's hemisphere says it per look (spec/model/fill.md: the finite tree is
//                 open outside its box; the endless park says false and its layer textures are set to REPEAT for that
//                 pass, so the box is one period of a field without an edge).
//   gS          — the plan travel per metre of rise of the SUN's path to a leaf: where the light that reaches a leaf comes
//                 from. The sky view looks at the real sun, so it passes the sun's own direction. The fill balances the
//                 beam, whose path is the bulk shift (none at all in the endless park), so it passes that: one sun per camera.
//   readWood    — a layer's foliage and its wood are different KINDS of occluder to the scatter term (spec/model/sky-view.md): a leaf takes light out of
//                 the ray and puts some of it back, wood only takes it out. So they are two quantities in two textures: the
//                 layer texel's rgb is the foliage's depth and its alpha the leaves' COVERAGE (on every camera, from the one
//                 leaf bake), and the wood's own depth is the layer's R16F in uWood. The sky view says true and reads it; the
//                 fill says false — its hemisphere ignores wood by design (a limb's share of the sky is thin, and the analytic
//                 occluder takes the beam only) — and gets 1.
const GLSL_SKY_RAY = `// A transmittance normalized to unit peak: the spectrum with its brightness divided out (spec/model/light.md's idiom, and the same
// one the curtain's dye uses). What survives is chlorophyll's green-gold; the knob that reads it carries the level.
vec3 leafHue(vec3 t){ return t / max(max(t.r, t.g), max(t.b, 1e-4)); }
${GLSL_TEXEL_MIX}
// One tap of a layer: the foliage's transmittance t, its BALLISTIC share tb and, where readWood, the layer's wood transmittance w from its own texture.
// The texel holds the depth in rgb and the COVERAGE in alpha (the one bake writes both on every camera, spec/model/leaf.md). At beamK 0 the texel is the slab and tb is t
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
// What a tap takes out of the SUN's path: the leaf's BALLISTIC share tb (the diffuse share has left the beam, spec/model/leaf.md, and arrives as the emission below),
// × the wood where it is read — a twig shadows a leaf exactly as another leaf does.
vec3 sunPass(vec3 tb, float w, bool readWood){ return readWood ? tb*w : tb; }
// pL_i is where the ray crosses layer i's plane — the caller's own geometry, so the eye's perspective and the
// hemisphere's fixed directions both fit. Returns T (what the ray passes: leaves × wood, per channel), Tb (what the BEAM passes along it,
// Π tb·w: the sun's disk seen through the canopy — a leaf kills it; = T at beamK 0) and Lsc (the foliage's single-scatter radiance along
// it, BEFORE the albedo at beamK 0: the caller multiplies uSkyScatter / fill_scatter; the lantern's glow, at its own level, above it).
// ---- SINGLE-SCATTER FOLIAGE RADIANCE (spec/model/sky-view.md). Transmission alone can only DARKEN: every ray is the sky attenuated, so
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
//  • ŝ_L is the layer's own transmittance normalized to unit peak: HUE only (spec/model/light.md), so the knob carries
//    brightness and the chlorophyll spectrum carries colour. Taking the LAYER's rather than one leaf's also
//    accounts to first order for the scattered light filtering back out through the layer that made it.
// The bound is structural: Σ throughput·(1 − t_L) telescopes to 1 − Π t_L ≤ 1 per channel, ŝ ≤ 1 and the albedo
// ≤ 1, so a crown can never radiate more than the sunlight falling on it.
// ---- A LEAF IS NOT A WINDOW (spec/model/leaf.md): beamK > 0 replaces that proxy by what it stood in for. Every texel is a MIXTURE of leaf and gap (texelMix, above): it
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

// ---- THE SKY FILL's bake (spec/model/fill.md, "What the shade is lit by"). One fragment per fill texel x (a plan point on the
// floor, over the canopy box), K fixed cosine-weighted rays each, and the two quantities the shade is made of:
//   Tsky(x) = (1/K) Σ_k Π_L T_L(x + h_L·s_k)       the skylight's transmittance through the canopy — forestry's diffuse gap fraction
//   S(x)    = fill_scatter · (1/K) Σ_k Lsc_k        the sunlight the lit leaves scatter down onto it — the sky view's radiance, integrated
//             (at k = 0, the proxy; at uFillBeamK > 0 the measured emission (1/K) Σ_k Σ_L thr·(T − Tb)·sun·A, with no albedo: spec/model/leaf.md)
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
// THE BOOKS CLOSE (spec/model/fill.md). Over a floor of unbounded extent every ray's light from a leaf lands somewhere, so the fill holds exactly
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
uniform vec2  uFillG;                       // the BEAM's sun path, the bulk shift (spec/model/transport.md): 0 in the endless park, the real throw for a standing tree / the cloth. One sun per camera: the light a leaf scatters is the light the beam gave up
uniform bool  uFillOpen;                    // outside the canopy box: open sky (a finite tree) — or, false, the layer textures repeat (the park; the bake sets REPEAT on them for this pass only)
uniform vec3  uFillRay[${MAX_FILL_DIRS}];   // per ray of the PLAIN set: (cos²θ_k, cosφ_k, sinφ_k) — komorebi-fill.js fillRays
uniform vec2  uFillTurn[16];                // per tile slot: (cos, sin) of its azimuth rotation 2π·b/16 — fillTurns. No sin/cos in this shader: GLSL ES only promises ~2⁻¹¹ of them, and a shift is tens of metres long
uniform int   uFillCount;                   // K
const int TILE[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);   // the texel's Bayer slot at (i&3) + 4·(j&3): komorebi-fill.js FILL_TILE, character for character (a test holds them)
uniform float uFillScatter;                 // the leaves' albedo (the P0b proxy): 0 skips the scatter branch unless the split is on (the cloth and the tent are handed 0 there, and read S only through it)
uniform float uFillBeamK;                   // k = −ln(1−leaf_diffuse) (spec/model/leaf.md): above 0 the leaf's diffuse share is the emission, the albedo is off, and every surface camera reads S
uniform int uEdgeArea;   // edge_area (spec/model/leaf.md): at k = 0 every texel is still read as its mixture (the shared ray reads this by name). 0 = the slab
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
uniform highp sampler2D uSlab;         // the leaf's slab, one row per channel: (top R, underside R, tissue T) against √T (komorebi-leaf.js slabTable)
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

// plain present blit (TUNE spec/implementation.md adaptive frame-rate): copy the offscreen-rendered frame straight to screen.
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

// ---- LATERAL DIFFUSION (spec/model/receivers.md), pass 1+2: one axis of a separable Gaussian over the LINEAR-HDR frame.
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


export { GLSL_TEXEL_MIX, GLSL_LEAF_Q, VS_TREE, FS_TREE, VS_TREE_WOOD, VS_TREE_WOOD_FOOT, FS_TREE_WOOD, FS_CROWN_GRID, defineIn, FS_TREE_COMPOSITE, VS_BAKE, FS_BAKE, VS_FAITH, VS_FAITH_PIVOT, VS_SEASON_TRAVEL, FS_FAITH, VS_LEAF_TRAVEL, FS_LEAF_TRAVEL, VS_LEAF_TRAVEL_PATCH, VS_LEAF_CARRY, VS_LEAF_CARRY_PATCH, FS_LEAF_CARRY, LEAF_CARRY_OUT, LEAF_CARRY_PATCH_OUT, FS_LEAF_TRAVEL_PATCH, FS_LEAF_PROGRESS, FS_PROGRESS_BLUR, FS_PATCH_MIX, VS_RISE, FS_RISE, VS_RISE_SKY, FS_RISE_SKY, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_FAITH_SEG_FINE, FS_FAITH_SEG_FINE, VS_LITTER, FS_LITTER, VS_FULL, GLSL_TONE_TAIL, GLSL_LAYER_FIELD, GLSL_WOOD_FIELD, GLSL_SUN_DIR_DECLS, GLSL_SKY_RAY, GLSL_SKY_SEEN, GLSL_GROUND_ALBEDO, FS_FILL, FS_FILL_GROUND, FS_FILL_UP, FS_FILL_BOUNCE, FS_BLIT, FS_PRESENT, FS_SCENE_MIX, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ };
