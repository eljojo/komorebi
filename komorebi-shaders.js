import { MAX_LAYERS, MAX_FILL_DIRS } from './komorebi-params.js';
import { LEAF_ID_FRAC, LEAF_VARIANTS } from './komorebi-leaf.js';

// ===========================================================================
// Shaders
// ===========================================================================

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
// komorebi-leaf.js, from the petiole base: θ across the texture (REPEAT: the seam at ±π is one place), one row per variant, sample i at the texel centre (i + ½)/256.
const GLSL_LEAF_Q = `uniform highp sampler2D uLeafTex;   // R16F: r(θ) per variant, in the leaf's own unit frame (area-normalised, ∮½r²dθ = π)
float leafQ(vec2 l, float variant){
  float m = length(l);
  vec2 d = dot(l, l) < 1e-12 ? vec2(1.0, 0.0) : l;                 // atan(0, 0) is undefined: at the base itself any direction will do
  float u = atan(d.y, d.x)*0.15915494 + 0.5;                       // θ/2π + ½
  float v = (variant + 0.5)/${LEAF_VARIANTS}.0;                              // a row's centre: a read between two variants is no leaf
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
out vec2 vLocal;
out vec3 vTau;
out float vFade;
flat out float vVariant;
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  // ---- leaf rocks with the wind: footprint foreshortens -> dapple changes SHAPE (§4.5) ----
  float wm = abs(uWindLevel);
  float swing = uLeafSwing*swingGain*(0.5*uWindLevel + wm*sin(uWindTime*uFlutterFreq*6.2831853+swingPhase));
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
  float ct=cos(thT), st=sin(thT);
  vec2 p    = Jtwig + mat2(ct,-st,st,ct)*(leafRest - Jtwig); // twig swings clump about its base joint
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,-sl,sl,cl)*(p - BL);            // limb swings clump about the trunk
  float ang = angle + thL + thT + 0.2*swing;               // leaf orientation rotates with the branch
  // ---- place the (foreshortened, rocked) leaf quad ----
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 lc = aCorner*uShapeBox.zw + uShapeBox.xy;   // the corner in the leaf's own frame: aCorner·1 + 0 for the ellipse (the same bits), the outline's box for a lobed leaf
  vec2 world = base + uSway + drift + R*(lc*vec2(A,B));
  vec2 uv = (world - uCanopyOrigin)/uCanopyExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = lc;
  vVariant = floor(fract(iC.w)*${LEAF_ID_FRAC}.0 + 0.5);   // the outline's row, in the cluster id's fraction (komorebi-grove.js): j + v/${LEAF_ID_FRAC}, and int(iC.w + 0.5) above is still j
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

// FAITHFUL leaf bake (spec §4.5): the VS_BAKE body verbatim — same grow/flutter/bend, so the cast matches the
// preview — but each leaf is then sun-projected to the FLOOR at its OWN continuous grown height (world -= uG*iHeight,
// uG = this source sample's ground shift g_i), and mapped into the CAST frame (uFaithOrigin/uFaithExtent), which
// covers where the shadow LANDS (offset by the bulk throw), not the canopy plan. One per source sample → the
// "many suns" convolution done as geometry at continuous heights, so leaves sit on their twigs (no layer cheat).
const VS_FAITH = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1] quad corner
layout(location=1) in vec4 iA;        // center.xy, A (long half), B0 (face-on short half)
layout(location=2) in vec4 iB;        // angle, restTilt, swingGain, swingPhase
layout(location=3) in vec4 iC;        // tau.rgb, clusterId (which twig — hierarchy lookup)
layout(location=4) in vec4 iD;        // orbit: ampX, ampY, orientation, phase (incoherent drift)
layout(location=5) in float iHeight;  // FAITHFUL: this leaf's continuous floor-height (floorH of its grown z)
layout(location=6) in float iFade;    // the fade the CPU folded into iC.xyz: the ballistic depth k·fade has to ride it (§4.5)
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
uniform float uWindTime;
uniform float uLeafSwing;
uniform float uFlutterFreq;
uniform vec4  uShapeBox;              // the quad's box in the leaf's own frame (see VS_BAKE)
out vec2 vLocal;
out vec3 vTau;
out float vFade;
flat out float vVariant;
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  float wm = abs(uWindLevel);
  float swing = uLeafSwing*swingGain*(0.5*uWindLevel + wm*sin(uWindTime*uFlutterFreq*6.2831853+swingPhase));
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
  float ct=cos(thT), st=sin(thT);
  vec2 p = TB + mat2(ct,-st,st,ct)*(leafRest - TB);      // twig swings the clump about its own grown base
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,-sl,sl,cl)*(p - BL);          // the limb then swings that twig joint AND its clump about the trunk
  float ang = angle + thL + thT + 0.2*swing;             // orientation rotates with the branch → the footprint presents differently as it turns (§5)
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 lc = aCorner*uShapeBox.zw + uShapeBox.xy;                                 // the corner in the leaf's own frame: the ellipse's square to the bit, or the outline's box (see VS_BAKE)
  vec2 world = base + uSway*(hEff/uHRef) + drift + R*(lc*vec2(A,B));   // coherent sway grows with height (0 at the ground) — leaves stay on their twigs, base anchored
  // project this leaf onto the RECEIVER along the sun-sample direction (uG.x, uG.y, 1). FLOOR (z=0): world - uG·h
  // (h→0; transport's layer loop adds +h·g to look UP — antipodal, so leaves land where the wood casts). CURTAIN
  // (vertical plane Y=uClothY, §4.9): drop onto the cloth → u = px - r·gx, v = h - r with r=(py-cy)/gy, so a
  // vertical trunk (constant py) casts a vertical line and the whole tree STANDS UP the cloth. Floor byte-identical.
  vec2 recvPt;
  if(uCurtainBake != 0){
    float gy = abs(uG.y) < 1e-3 ? (uG.y < 0.0 ? -1e-3 : 1e-3) : uG.y;   // guard: the sun must FACE the cloth (azimuth not ∥ to it)
    float rr = (world.y - uClothY) / gy;
    recvPt = vec2(world.x - rr*uG.x, hEff - rr);
  } else {
    recvPt = world - uG * hEff;
  }
  vec2 uv = (recvPt - uFaithOrigin)/uFaithExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = lc;
  vVariant = floor(fract(iC.w)*${LEAF_ID_FRAC}.0 + 0.5);
  vTau = iC.xyz;
  vFade = iFade;
}`;

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
    frag = vec4(Tb, 1.0);
  }
  else frag = vec4(exp(-vTau*cov), 1.0);
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
}`;

const FS_FAITH_SEG = `#version 300 es
precision highp float;
in float vAcross;
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
  if(uSegTau != 0){ frag = vec4(uWoodTau*cov, 0.0, 0.0, 0.0); return; }
  frag = vec4(vec3(exp(-uWoodTau*cov)), 1.0);              // wood blocks every colour equally → dark, neutral
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
vec3 reinhard(vec3 c){ return c/(1.0+c); }
vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
vec3 toneTail(vec3 col){
  col *= uExposure;
  if(uToneMap==1) col=reinhard(col);
  else if(uToneMap==2) col=aces(col);
  else col=clamp(col,0.0,1.0);
  col = clamp((col-0.5)*uContrast+0.5, 0.0, 1.0);
  return pow(col, vec3(1.0/2.2));
}`;


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
//    that ballistic T·L_sky to first order. Leaf-top reflection goes up, never to an eye below, and an underside has
//    no light to send on (the model has no ground bounce). With the sun off, Lsc is exactly 0.
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
  fillS = vec4(Lsum/K*(uFillBeamK > 0.0 ? 1.0 : uFillScatter), 1.0);   // the albedo is the proxy's; the emitted light is already at its own level
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


export { GLSL_TEXEL_MIX, GLSL_LEAF_Q, VS_BAKE, FS_BAKE, VS_FAITH, FS_FAITH, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_LITTER, FS_LITTER, VS_FULL, GLSL_TONE_TAIL, GLSL_LAYER_FIELD, GLSL_WOOD_FIELD, GLSL_SUN_DIR_DECLS, GLSL_SKY_RAY, FS_FILL, FS_BLIT, FS_PRESENT, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ };
