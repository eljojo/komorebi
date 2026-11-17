// ============================================================================
// The cast's geometry, shared by every camera (spec/model/transport.md): how a layer's shadow is shifted by its height and stretched
// by a low sun (the ellipse matrix and the layer shift), the standing scene's bulk shift and whether a scene has one, the layers' heights
// (and the heights a route between layer counts starts or ends at), and where one corner of a tilted leaf's shadow lands. The factory is
// over the engine's shared internals (hub) and reads only its params and transition state; the transport's analytic occluder and the
// faithful bake both read what it returns, so their throws cannot drift apart. The source's own sampling is komorebi-source.js.
// ============================================================================
import { DEG, lerp } from './komorebi-math.js';
import { MAX_LAYERS } from './komorebi-params.js';

export function makeCast(hub){
  const { params, trans } = hub;

  // per-call scratch (see the render module's _atm note): recomputed fresh into these each call, so a static
  // frame allocates nothing and there is no stale-cache risk.
  const _proj = [0,0,0,0], _lh = new Float32Array(MAX_LAYERS);
  const _bulk = [0,0];

  // Is the canopy a finite OBJECT with a bulk throw (a standing tree, the curtain, the tent) rather than the endless park? The one
  // question the beam's bulk shift and the sky fill's domain (spec/model/fill.md: wrap the box, or open sky over a padded frame) both ask.
  const bulkOn = () => !!(params.standing_scene || params.receiver);

  // STANDING-SCENE bulk shadow offset (spec/model/transport.md): cot(elev)·(anti-sun direction) per unit height — the lateral throw the
  // park model omits. ONE helper, shared by transport's analytic occluder AND the faithful bake, so the two throws
  // can't silently drift apart. Floored at 6° — deliberately HIGHER than projMatrix's 4° ellipse floor: cot(elev)
  // diverges faster than the ellipse's 1/sin² as the sun nears the horizon, so the throw wants the tighter clamp.
  // Returns the shared scratch [0,0] when standing_scene is off (park model, byte-identical).
  function bulkShift(){
    // the bulk sun-angle throw is needed for BOTH the standing-scene floor AND the curtain receiver (it's what
    // projects the tree's shadow off to the side / onto the cloth). Off for the overhead park (receiver 0 + no
    // standing scene) → 0, byte-identical.
    // The overhead park throws only when park_throw asks it to: the same throw, scaled. 0 is the early return, exactly.
    const scale = bulkOn() ? 1 : params.park_throw;
    if(!(scale > 0)){ _bulk[0]=0; _bulk[1]=0; return _bulk; }
    const el=Math.max(params.sun_elevation_deg,6)*DEG, az=params.sun_azimuth_deg*DEG, k=scale === 1 ? Math.cos(el)/Math.sin(el) : scale*Math.cos(el)/Math.sin(el);
    _bulk[0]=k*Math.cos(az); _bulk[1]=k*Math.sin(az); return _bulk;
  }

  // ---- the ellipse: angular offset -> ground displacement per unit height ----
  function projMatrix(){
    const el=Math.max(params.sun_elevation_deg,4)*DEG, az=params.sun_azimuth_deg*DEG;
    const se=Math.sin(el);
    const major=1/(se*se), minor=1/se;          // stretch along azimuth grows as sun lowers
    const ca=Math.cos(az), sa=Math.sin(az);
    _proj[0]=major*ca*ca+minor*sa*sa;
    _proj[1]=_proj[2]=(major-minor)*ca*sa;
    _proj[3]=major*sa*sa+minor*ca*ca;
    return _proj;                                // column-major (symmetric)
  }

  function layerHeights(){
    // A route between two layer counts (trans.layerRoute): every layer moves from the height it was shown at to the incoming look's
    // own, on the route's eased progress; each end is its array exactly. Otherwise the look's own heights.
    const R = trans.active && trans.layerRoute;
    if(R){ for(let i=0;i<MAX_LAYERS;i++) _lh[i] = R.e <= 0 ? R.from[i] : R.e >= 1 ? R.to[i] : lerp(R.from[i], R.to[i], R.e); return _lh; }
    const n=params.layer_count, base=params.canopy_base_height_m, thick=params.canopy_thickness_m;
    for(let i=0;i<MAX_LAYERS;i++) _lh[i]= n>1 ? base+(i/(n-1))*thick : base;
    return _lh;
  }

  return { bulkShift, bulkOn, projMatrix, layerHeights };
}

// ---- A TILTED LEAF'S SHADOW (spec model/leaf.md, "What one leaf stamps"; tilt_shadow). GLSL_FAITH_VERTEX's cast of one corner, on the CPU: the corner `lc`
// (the leaf's own frame, the unit square's corners for its box) of a leaf of halves A and B0 at plan centre `c`, turned clockwise by `ang`, rolled by
// `roll` (its side times its tilt plus swing), at height `h`, thrown onto the floor along the sun's plan travel per metre of height `g`. Its plan point is
// the flattened leaf's, short half B0·|cos(roll)|; its height is the centre's plus `share` of lc.y·B0·sin(roll). At share 1 the four corners are the
// leaf's true shadow along the sun; at 0 the plan footprint every corner at the centre's height. ----
export function leafShadowCorner(lc, { c, A, B0, ang, roll, h, g, share = 1 }){
  const B = B0*Math.max(0.05, Math.abs(Math.cos(roll))), co = Math.cos(ang), si = Math.sin(ang);
  const x = lc[0]*A, y = lc[1]*B, wx = c[0] + co*x + si*y, wy = c[1] - si*x + co*y;   // R = mat2(c, −s, s, c), column-major: R·v = (c·x + s·y, −s·x + c·y)
  const hc = share > 0 ? h + share*lc[1]*B0*Math.sin(roll) : h;
  return [wx - g[0]*hc, wy - g[1]*hc];
}

// The heights a route between layer counts starts or ends at: the look's own n heights over [base, base+thick], the layers above
// its top padded with the top one, so a layer only one look fills moves to or from the nearest layer the other has.
export function routeHeights(n, base, thick){
  const out = new Float64Array(MAX_LAYERS), top = Math.max(1, n) - 1;
  for(let i=0;i<MAX_LAYERS;i++){ const j = Math.min(i, top); out[i] = n>1 ? base+(j/(n-1))*thick : base; }
  return out;
}
