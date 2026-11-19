// ============================================================================
// The camera — pure functions, no GL, no engine state. The floor's gauge expressed as a real eye (cameraPose), which the sky view, the tree view and the
// routes between cameras share, the move between two standing cameras (cameraBetween), and the edge of the frame as the shader computes it (vignetteMask, spec/model/camera.md).
// ============================================================================
import { DEG, clamp, lerp, lerpAngle, smoothstep } from '../komorebi-math.js';

// The floor's gauge (height plus recenter) expressed as a real eye, in the sky camera's world frame.
function cameraPose(p){
  const pitch=clamp(p.view_pitch_deg,0,80)*DEG;
  if(p.sky_view) return {eye:[p.view_center_x,p.view_center_y,0],elevation:pitch,skyWeight:1};
  const k=Math.max(Math.tan(0.5*clamp(p.view_fov_deg,5,140)*DEG),1e-4);
  const h=p.view_extent_m*Math.cos(pitch)**2/Math.max(2*k,1e-4), offset=h*Math.tan(pitch), yaw=p.view_yaw_deg*DEG;
  return {eye:[p.view_center_x-offset*Math.sin(yaw),p.view_center_y-offset*Math.cos(yaw),h],elevation:pitch-Math.PI/2,skyWeight:0};
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
  if(ga[0]*gb[0] + ga[1]*gb[1] >= 0){
    const h = ratio(A[2]/Math.cos(a.view_pitch_deg*DEG), B[2]/Math.cos(b.view_pitch_deg*DEG), w)*c, extent = ratio(a.view_extent_m, b.view_extent_m, w);
    return { view_extent_m: extent, view_pitch_deg: pitch, view_yaw_deg: yaw, view_fov_deg: 2*Math.atan(extent*c*c/(2*h))/DEG,
      view_center_x: lerp(a.view_center_x, b.view_center_x, w), view_center_y: lerp(a.view_center_y, b.view_center_y, w) };
  }
  const h = ratio(A[2], B[2], w), fov = 2*Math.atan(ratio(Math.tan(a.view_fov_deg*DEG/2), Math.tan(b.view_fov_deg*DEG/2), w))/DEG;
  const offset = h*Math.tan(pitch*DEG);
  return { view_extent_m: 2*Math.tan(fov*DEG/2)*h/c**2, view_pitch_deg: pitch, view_yaw_deg: yaw, view_fov_deg: fov,
    view_center_x: lerp(A[0], B[0], w) + offset*Math.sin(yaw*DEG), view_center_y: lerp(A[1], B[1], w) + offset*Math.cos(yaw*DEG) };
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

export { cameraBetween, cameraPose, vignetteMask };
