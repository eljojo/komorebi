import { MAX_LAYERS, MAX_FILL_DIRS } from './komorebi-params.js';

// ===========================================================================
// Shaders
// ===========================================================================
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
out vec2 vLocal;
out vec3 vTau;
out float vFade;
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
  vec2 world = base + uSway + drift + R*(aCorner*vec2(A,B));
  vec2 uv = (world - uCanopyOrigin)/uCanopyExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = aCorner;
  vTau = iC.xyz * uCoverage;   // x 1.0 is the identity in IEEE, so every non-transitioning frame bakes the bytes it always did
  vFade = iFade * uCoverage;   // the same two lever arms on COVERAGE, so a leaf fading in (or a grove crossfading) fades its ballistic shadow with its tau, not at full weight (§4.5)
}`;

const FS_BAKE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
in float vFade;
uniform float uEdge;
out vec4 frag;
void main(){
  // soft elliptical leaf mask -> partial coverage at edges (honest area-averaging)
  float r = length(vLocal);
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
out vec2 vLocal;
out vec3 vTau;
out float vFade;
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
  vec2 world = base + uSway*(hEff/uHRef) + drift + R*(aCorner*vec2(A,B));   // coherent sway grows with height (0 at the ground) — leaves stay on their twigs, base anchored
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
  vLocal = aCorner;
  vTau = iC.xyz;
  vFade = iFade;
}`;

// FAITHFUL pass 1 (per sample): each leaf outputs its TRANSMITTANCE exp(-τ); drawn with multiplicative blend
// (dst *= src) so the scratch buffer ends at Π exp(-τ) = exp(-Σ τ) = the transmittance through the canopy for
// this one sun-sample. Soft edge → 1 at the rim (×1, no darkening), order-independent (multiply commutes).
// A LEAF IS NOT A WINDOW (§4.5): the beam is only the BALLISTIC share, exp(-(τ + k·fade)·cov) — the multiplicative scratch
// takes the neutral depth k per unit coverage inside the same exponent, the fade standing where the layer path's alpha does.
const FS_FAITH = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
in float vFade;
uniform float uEdge;
uniform float uBeamK;   // k = −ln(1−leaf_diffuse), 0 = the old leaf — a uniform branch, because leaf_diffuse tweens
out vec4 frag;
void main(){
  float r = length(vLocal);
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  if(uBeamK > 0.0) frag = vec4(exp(-(vTau + uBeamK*vFade)*cov), 1.0);
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
// One tap of a layer: the foliage's transmittance t, its COVERAGE c (alpha — the one bake writes it on every camera, §4.5) and, where
// readWood, the layer's wood transmittance w from its own texture. Open sky outside the box: no leaves, nothing to cover, no wood.
void tapSky(highp sampler2D layer, highp sampler2D wood, vec2 world, bool openOutside, bool readWood, out vec3 t, out float c, out float w){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  if(openOutside && (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0))))){ t = vec3(1.0); c = 0.0; w = 1.0; return; }
  vec4 d = texture(layer, uv);
  t = exp(-d.rgb); c = d.a; w = readWood ? exp(-texture(wood, uv).r) : 1.0;
}
// What a tap takes out of the SUN's path: the leaf's BALLISTIC share tb = t·e^(-k·coverage) (the diffuse share has left the beam, §4.5,
// and arrives as the emission below), × the wood where it is read — a twig shadows a leaf exactly as another leaf does.
vec3 sunPass(vec3 t, float c, float w, bool readWood, float beamK){
  vec3 tb = beamK > 0.0 ? t*exp(-beamK*c) : t;
  return readWood ? tb*w : tb;
}
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
// ---- A LEAF IS NOT A WINDOW (§4.5): beamK > 0 replaces that proxy by what it stood in for. A leaf passes t = e^-τ in all, but only
// tb = e^(-τ - k·coverage) of it keeps travelling as a beam; the rest, t − tb = t·(1 − e^(-k·coverage)), is diffuse light the leaf
// sends on, in its own hue (k is neutral) and at the level d·T — no ŝ, no albedo, so nothing authored is left in it. It is lit by the
// sun's BALLISTIC path to it (A_L = Π_{M>L} tb_M·w_M) and falls through the layers below on their TRUE t (thr), which telescopes:
//   Π tb + Σ_L thr_L·(t_L − tb_L)·A_L = Π t   (Q_L = Π_{M≤L} t · Π_{M>L} tb steps from the first to the second)
// when the eye ray IS the sun's ray (every A_L then reads the very taps the ray passes): beam + emitted is the total transmitted for
// any d, and at d = 0 the new term is identically zero. Off that line it is not an identity and no inequality either (a lit leaf is
// seen through a leaf beside the sun's path): the bound is per layer, a leaf glows no more than its diffuse share of the sunlight
// landing on it. T is untouched: for a uniform sky, diffuse transmission through Lambertian leaves equals the ballistic one to first
// order, so the skylight needs no split — only the sun does. WOOD (readWood, the sky camera) is a pure attenuator: it is in T, Tb, the
// sun's path and thr, and never in the emission, so a ray that meets nothing but wood scatters exactly nothing.
void skyRay(vec2 pL0, vec2 pL1, vec2 pL2, vec2 pL3, vec2 gS, bool scatter, bool openOutside, bool readWood, float beamK, out vec3 T, out vec3 Tb, out vec3 Lsc){
  // a layer that is not there: transmits everything, covers nothing, holds no wood
  vec3 tL0 = vec3(1.0), tL1 = vec3(1.0), tL2 = vec3(1.0), tL3 = vec3(1.0);
  float cL0 = 0.0, cL1 = 0.0, cL2 = 0.0, cL3 = 0.0, wL0 = 1.0, wL1 = 1.0, wL2 = 1.0, wL3 = 1.0;
  if(uLayerCount>0) tapSky(uLayer[0], uWood[0], pL0, openOutside, readWood, tL0, cL0, wL0);
  if(uLayerCount>1) tapSky(uLayer[1], uWood[1], pL1, openOutside, readWood, tL1, cL1, wL1);
  if(uLayerCount>2) tapSky(uLayer[2], uWood[2], pL2, openOutside, readWood, tL2, cL2, wL2);
  if(uLayerCount>3) tapSky(uLayer[3], uWood[3], pL3, openOutside, readWood, tL3, cL3, wL3);
  // tL = what the FOLIAGE does (this layer's leaves alone) — the only thing the scatter term may read.
  // xL = what the RAY loses (leaves × wood) — the only thing transmittance may read.
  vec3 xL0 = readWood ? tL0*wL0 : tL0, xL1 = readWood ? tL1*wL1 : tL1, xL2 = readWood ? tL2*wL2 : tL2, xL3 = readWood ? tL3*wL3 : tL3;
  T = vec3(1.0);
  T *= xL0; T *= xL1; T *= xL2; T *= xL3;
  Tb = beamK > 0.0 ? T*exp(-beamK*(cL0 + cL1 + cL2 + cL3)) : T;   // Π tb·w: the beam's own transmittance along the ray, in the leaves' hue
  Lsc = vec3(0.0);
  if(scatter){
    vec3 A0 = vec3(1.0), A1 = vec3(1.0), A2 = vec3(1.0);
    // the SUN's path takes the FULL transmittance — a twig shadows a leaf exactly as another leaf does; it is
    // only as a SOURCE that wood must not participate.
    vec3 sT; float sC, sW;
    if(uLayerCount>1){ tapSky(uLayer[1], uWood[1], pL0 + gS*(uLayerHeight[1]-uLayerHeight[0]), openOutside, readWood, sT, sC, sW); A0 *= sunPass(sT, sC, sW, readWood, beamK); }
    if(uLayerCount>2){ tapSky(uLayer[2], uWood[2], pL0 + gS*(uLayerHeight[2]-uLayerHeight[0]), openOutside, readWood, sT, sC, sW); A0 *= sunPass(sT, sC, sW, readWood, beamK); }
    if(uLayerCount>3){ tapSky(uLayer[3], uWood[3], pL0 + gS*(uLayerHeight[3]-uLayerHeight[0]), openOutside, readWood, sT, sC, sW); A0 *= sunPass(sT, sC, sW, readWood, beamK); }
    if(uLayerCount>2){ tapSky(uLayer[2], uWood[2], pL1 + gS*(uLayerHeight[2]-uLayerHeight[1]), openOutside, readWood, sT, sC, sW); A1 *= sunPass(sT, sC, sW, readWood, beamK); }
    if(uLayerCount>3){ tapSky(uLayer[3], uWood[3], pL1 + gS*(uLayerHeight[3]-uLayerHeight[1]), openOutside, readWood, sT, sC, sW); A1 *= sunPass(sT, sC, sW, readWood, beamK); }
    if(uLayerCount>3){ tapSky(uLayer[3], uWood[3], pL2 + gS*(uLayerHeight[3]-uLayerHeight[2]), openOutside, readWood, sT, sC, sW); A2 *= sunPass(sT, sC, sW, readWood, beamK); }
    // THE SOURCE TERM READS FOLIAGE ONLY. Wood appears in the throughput, which can only take light away, and
    // nowhere in the emission — so a ray that meets nothing but wood scatters exactly nothing.
    vec3 thr = vec3(1.0);
    if(beamK > 0.0){
      Lsc += thr*tL0*(1.0-exp(-beamK*cL0))*uSunColor*A0; thr *= xL0;
      Lsc += thr*tL1*(1.0-exp(-beamK*cL1))*uSunColor*A1; thr *= xL1;
      Lsc += thr*tL2*(1.0-exp(-beamK*cL2))*uSunColor*A2; thr *= xL2;
      Lsc += thr*tL3*(1.0-exp(-beamK*cL3))*uSunColor;   // nothing is stacked above the top layer
    } else {
      Lsc += thr*(1.0-tL0)*leafHue(tL0)*uSunColor*A0; thr *= xL0;
      Lsc += thr*(1.0-tL1)*leafHue(tL1)*uSunColor*A1; thr *= xL1;
      Lsc += thr*(1.0-tL2)*leafHue(tL2)*uSunColor*A2; thr *= xL2;
      Lsc += thr*(1.0-tL3)*leafHue(tL3)*uSunColor;   // nothing is stacked above the top layer
    }
  }
}`;

// ---- THE SKY FILL's bake (spec §4.7, "What the shade is lit by"). One fragment per fill texel x (a plan point on the
// floor, over the canopy box), K fixed cosine-weighted rays each, and the two quantities the shade is made of:
//   Tsky(x) = (1/K) Σ_k Π_L T_L(x + h_L·s_k)       the skylight's transmittance through the canopy — forestry's diffuse gap fraction
//   S(x)    = fill_scatter · (1/K) Σ_k Lsc_k        the sunlight the lit leaves scatter down onto it — the sky view's radiance, integrated
// where s_k = tanθ_k·(cosφ_k, sinφ_k) is ray k's plan travel per metre of rise. The K directions are the plain set of
// komorebi-fill.js (uFillRay: cos²θ_k and φ_k per ray), and each TEXEL rotates it by its slot in a fixed 4x4 Bayer tile
// (INTERLEAVED SAMPLING): azimuth by 2π·b/16 and cos²θ by a sub-stratum, so the 16 texels of a tile (a mip-2 box) hold
// 16·K distinct directions instead of the same K sixteen times. Without it neighbouring texels hit
// correlated leaves and the mip shows facets. The slot is a pure function of the texel: nothing moves, nothing is random.
// JENSEN IS A LAW OF THIS PASS: the sum is over TRANSMITTANCE. Each ray's product is taken at the ray's own taps and
// the K products are what get averaged — never a mip or a blur of the optical depth, which would turn a gappy canopy
// into a uniform veil and underestimate the fill. The sum is DIVIDED by K (not scaled by 1/K), so K rays of exactly
// 1 sum to exactly K and give exactly 1: no canopy is exactly bright, for any K.
// ENERGY: Tsky ≤ 1 by construction, and S ≤ fill_scatter·(1 − Tsky)·sun per channel by the sky view's
// telescoping bound — structural, no clamp. Wood is not read (readWood false): the analytic occluder takes the
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


export { VS_BAKE, FS_BAKE, VS_FAITH, FS_FAITH, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_FULL, GLSL_TONE_TAIL, GLSL_LAYER_FIELD, GLSL_WOOD_FIELD, GLSL_SUN_DIR_DECLS, GLSL_SKY_RAY, FS_FILL, FS_BLIT, FS_PRESENT, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ };
