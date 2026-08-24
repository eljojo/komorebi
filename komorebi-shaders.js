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
}`;

const FS_BAKE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
uniform float uEdge;
out vec4 frag;
void main(){
  // soft elliptical leaf mask -> partial coverage at edges (honest area-averaging)
  float r = length(vLocal);
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  // additive: optical depth ADDS across overlaps (order-independent), unlike transmittance
  frag = vec4(vTau*cov, cov);
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
}`;

// FAITHFUL pass 1 (per sample): each leaf outputs its TRANSMITTANCE exp(-τ); drawn with multiplicative blend
// (dst *= src) so the scratch buffer ends at Π exp(-τ) = exp(-Σ τ) = the transmittance through the canopy for
// this one sun-sample. Soft edge → 1 at the rim (×1, no darkening), order-independent (multiply commutes).
const FS_FAITH = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
uniform float uEdge;
out vec4 frag;
void main(){
  float r = length(vLocal);
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  frag = vec4(exp(-vTau*cov), 1.0);
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
  // THE LAYER STAMP WRITES ALPHA ONLY, and the zero in rgb is the whole fix rather than a tidiness: the layer
  // texture's rgb is the FOLIAGE's optical depth, and the sky view's scatter term reads its scattering density and
  // its hue from exactly that. Neutral wood dropped into rgb normalizes to a near-white hue at near-full density, so
  // the twig web lights up as cream filaments brighter than the sky it stands against. Wood occludes; it does not
  // glow. (Additive blend, so a zero in rgb leaves the leaves alone.)
  if(uSegTau != 0){ frag = vec4(0.0, 0.0, 0.0, uWoodTau*cov); return; }
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


export { VS_BAKE, FS_BAKE, VS_FAITH, FS_FAITH, FS_FACC, VS_FAITH_SEG, FS_FAITH_SEG, VS_FULL, GLSL_TONE_TAIL, FS_BLIT, FS_PRESENT, FS_GLOW_BLUR, FS_GLOW_MIX, VS_POINTS, FS_POINTS, VS_VIZ, FS_VIZ };
