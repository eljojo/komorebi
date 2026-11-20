// ============================================================================
// The camera — pure functions, no GL, no engine state. The floor's gauge expressed as a real eye (cameraPose), which the sky view, the tree view and the
// routes between cameras share, the move between two standing cameras (cameraBetween), and the edge of the frame and the seen tree's tone curve as the shader
// computes them (vignetteMask, treeCurve; spec/model/camera.md).
// ============================================================================
import { DEG, clamp, lerp, lerpAngle, smoothstep } from '../komorebi-math.js';

// The floor camera's gaze turned up past its tilt (view_look_up_deg, radians): the eye stays where the gauge puts it and only the gaze turns.
// The floor ray, the tree's projection and the elevation below all add it to the pitch; 0 leaves each the expression it was.
const lookUp = (p) => clamp(p.view_look_up_deg || 0, 0, 70)*DEG;

// The floor's gauge (height plus recenter) expressed as a real eye, in the sky camera's world frame.
function cameraPose(p){
  const pitch=clamp(p.view_pitch_deg,0,80)*DEG;
  if(p.sky_view) return {eye:[p.view_center_x,p.view_center_y,0],elevation:pitch,skyWeight:1};
  const k=Math.max(Math.tan(0.5*clamp(p.view_fov_deg,5,140)*DEG),1e-4);
  const h=p.view_extent_m*Math.cos(pitch)**2/Math.max(2*k,1e-4), offset=h*Math.tan(pitch), yaw=p.view_yaw_deg*DEG;
  return {eye:[p.view_center_x-offset*Math.sin(yaw),p.view_center_y-offset*Math.cos(yaw),h],elevation:pitch+lookUp(p)-Math.PI/2,skyWeight:0};
}

// THE MOVE between two standing cameras (spec/model/transitions.md), w in 0..1 already eased; the live morph's glide and the season and grove travels
// take it. It moves as a person would, one of two ways, by whether the two looks face the same way (their gazes across the ground meet at no more than
// a right angle; a gaze straight down has none):
// - Facing the same way, the camera keeps its aim: the floor point it looks at goes straight from one look's to the other's, and the eye comes in to it
//   (or draws back) while it turns and tilts round it. Turned by its own clock instead, the gaze left the trees: from park 1's scene to under its trees
//   it dropped 6 m in front of them midway and swept back up, a pivot toward a point in the air; from above into park fall it fell 5 m short of them.
// - Facing apart, the eye walks: it goes straight across the ground from one look's eye to the other's while the head turns the short way, since an aim
//   kept between two looks that face apart is passed over, and the camera swung round it is an orbit about the middle of the grove.
// The distance to the aim (walking, the eye's height), the framing and the lens each change by the same ratio each moment, so a lens opening as the eye
// comes in neither swells the frame nor holds it while the perspective warps. Yaw takes the short way.
const across = (p) => { const s = Math.sin(p.view_pitch_deg*DEG); return [s*Math.sin(p.view_yaw_deg*DEG), s*Math.cos(p.view_yaw_deg*DEG)]; };
const ratio = (a, b, w) => a*(b/a)**w;
function cameraBetween(a, b, w){
  const A = cameraPose(a).eye, B = cameraPose(b).eye, ga = across(a), gb = across(b);
  const yaw = lerpAngle(a.view_yaw_deg, b.view_yaw_deg, w, 360), pitch = lerp(a.view_pitch_deg, b.view_pitch_deg, w), c = Math.cos(pitch*DEG);
  const up = lerp(a.view_look_up_deg || 0, b.view_look_up_deg || 0, w);   // the gaze lifts with the head's turn, on the move's own clock
  if(ga[0]*gb[0] + ga[1]*gb[1] >= 0){
    const h = ratio(A[2]/Math.cos(a.view_pitch_deg*DEG), B[2]/Math.cos(b.view_pitch_deg*DEG), w)*c, extent = ratio(a.view_extent_m, b.view_extent_m, w);
    return { view_extent_m: extent, view_pitch_deg: pitch, view_yaw_deg: yaw, view_fov_deg: 2*Math.atan(extent*c*c/(2*h))/DEG,
      view_center_x: lerp(a.view_center_x, b.view_center_x, w), view_center_y: lerp(a.view_center_y, b.view_center_y, w), view_look_up_deg: up };
  }
  const h = ratio(A[2], B[2], w), fov = 2*Math.atan(ratio(Math.tan(a.view_fov_deg*DEG/2), Math.tan(b.view_fov_deg*DEG/2), w))/DEG;
  const offset = h*Math.tan(pitch*DEG);
  return { view_extent_m: 2*Math.tan(fov*DEG/2)*h/c**2, view_pitch_deg: pitch, view_yaw_deg: yaw, view_fov_deg: fov,
    view_center_x: lerp(A[0], B[0], w) + offset*Math.sin(yaw*DEG), view_center_y: lerp(A[1], B[1], w) + offset*Math.cos(yaw*DEG), view_look_up_deg: up };
}

// THE EDGE (spec/model/camera.md), as the shader computes it (GLSL_T_POST): a superellipse mask on the frame, 1 inside radius
// (1 − feather), 0 at the frame's edge and in the corners beyond the curve. u, v in 0..1. The reference the
// vignette test holds the shader's formula to; feather 0 is the gate shut. A transition crossing that gate scales
// what the mask removes by its opacity; opacity 1 keeps the settled formula exactly.
function vignetteMask(u, v, feather, shape, opacity = 1) {
  if (!(feather > 0)) return 1;
  const qx = Math.abs(u * 2 - 1), qy = Math.abs(v * 2 - 1);
  const d = Math.pow(Math.pow(qx, shape) + Math.pow(qy, shape), 1 / shape);
  return 1 - opacity * smoothstep(1 - feather, 1, d);
}

// THE TREE'S CURVE (spec/model/camera.md), as the shader computes it (GLSL_TREE_FINISH): AgX (Sobotka's, in Wrensch's polynomial fit) with its contrast
// look, power 1.35, the seen tree's own tone curve in place of the frame's. The frame's ACES fit works on each channel apart, so a leaf that passes almost no
// blue climbs its shoulder in red and green alone and lands on pure yellow-green; AgX rolls it toward white and keeps its hue. `gain` is authored: it
// shows a sunlit leaf of park 1, from above (the slab's top at a 26° sun, exposed: 0.12, 0.49, 0) at the luminance the ACES fit gave it. Takes exposed
// linear light, returns linear display light in 0..1, before the Look's contrast and gamma.
const TREE_GAIN = 2.3719;
const TREE_POWER = 1.35;
const AGX_IN = [[0.842479062253094, 0.0784335999999992, 0.0792237451477643], [0.0423282422610123, 0.878468636469772, 0.0791661274605434], [0.0423756549057051, 0.0784336, 0.879142973793104]];
const AGX_OUT = [[1.19687900512017, -0.0980208811401368, -0.0990297440797205], [-0.0528968517574562, 1.15190312990417, -0.0989611768448433], [-0.0529716355144438, -0.0980434501171241, 1.15107367264116]];
const mat3 = (m, v) => m.map((r) => r[0]*v[0] + r[1]*v[1] + r[2]*v[2]);
function treeCurve(c){
  const x = mat3(AGX_IN, c.map((v) => Math.max(v*TREE_GAIN, 1e-10))).map((v) => {
    const t = (clamp(Math.log2(v), -12.47393, 4.026069) + 12.47393)/16.5, t2 = t*t, t4 = t2*t2;
    return Math.max(15.5*t4*t2 - 40.14*t4*t + 31.96*t4 - 6.868*t2*t + 0.4298*t2 + 0.1191*t - 0.00232, 0)**TREE_POWER;
  });
  return mat3(AGX_OUT, x).map((v) => clamp(v, 0, 1)**2.2);
}

export { cameraBetween, cameraPose, lookUp, vignetteMask, TREE_GAIN, TREE_POWER, treeCurve };
