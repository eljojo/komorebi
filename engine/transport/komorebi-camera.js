// ============================================================================
// The camera — pure functions, no GL, no engine state. The floor's gauge expressed as a real eye (cameraPose), which the sky view, the tree view and the
// routes between cameras share, and the edge of the frame as the shader computes it (vignetteMask, spec/model/camera.md).
// ============================================================================
import { DEG, clamp, smoothstep } from '../komorebi-math.js';

// The floor's gauge (height plus recenter) expressed as a real eye, in the sky camera's world frame.
function cameraPose(p){
  const pitch=clamp(p.view_pitch_deg,0,80)*DEG;
  if(p.sky_view) return {eye:[p.view_center_x,p.view_center_y,0],elevation:pitch,skyWeight:1};
  const k=Math.max(Math.tan(0.5*clamp(p.view_fov_deg,5,140)*DEG),1e-4);
  const h=p.view_extent_m*Math.cos(pitch)**2/Math.max(2*k,1e-4), offset=h*Math.tan(pitch), yaw=p.view_yaw_deg*DEG;
  return {eye:[p.view_center_x-offset*Math.sin(yaw),p.view_center_y-offset*Math.cos(yaw),h],elevation:pitch-Math.PI/2,skyWeight:0};
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

export { cameraPose, vignetteMask };
