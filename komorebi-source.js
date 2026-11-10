// ============================================================================
// The Source (spec §4.4) — the area light as a Vogel-spiral cloud of weighted
// point-suns, plus the three per-frame geometry helpers every camera shares:
// the bulk shadow offset (§4.8), the ellipse projection (§3.5/§4.6) and the
// per-layer heights. A factory over the engine's shared internals (hub).
// ============================================================================
import { DEG, clamp, lerp } from './komorebi-math.js';
import { MAX_LAYERS, MAX_SAMPLES, SKY_SUN_GAIN } from './komorebi-params.js';

const EDITOR = (typeof KOMOREBI_EDITOR !== "undefined") ? KOMOREBI_EDITOR : true;

export function makeSource(hub){
  const { gl, params, perf, trans, src, effCloud } = hub;

  // ---- source: Vogel-spiral cloud of weighted point-suns ---------------------
  function regenSource(){
    const N = clamp(Math.round(perf.auto ? perf.sampleCount : params.sample_count), 3, MAX_SAMPLES);
    const coreR = params.core_angular_radius_deg*DEG;
    const t = effCloud();                                  // cloud_thickness, pushed to overcast during a transition
    const haloDeg = lerp(params.halo_angular_radius_deg, 30, trans.bloom);  // the bloom also fattens the halo to wash out the grove swap
    const haloR = lerp(coreR*2.0, haloDeg*DEG, t);
    const Wcore = params.core_weight_fraction*(1.0-t);     // energy drains core->halo with cloud
    const Whalo = 1.0 - Wcore;
    const nCore = Math.max(3, Math.round(N*0.5));
    const nHalo = Math.max(0, N - nCore);
    const golden = Math.PI*(3 - Math.sqrt(5));
    const pts = [];
    for(let i=0;i<nCore;i++){
      const r = coreR*Math.sqrt((i+0.5)/nCore), a=i*golden;
      pts.push([r*Math.cos(a), r*Math.sin(a), Wcore/nCore]);
    }
    for(let i=0;i<nHalo;i++){
      const f=(i+0.5)/nHalo;
      const r=Math.sqrt(coreR*coreR + f*(haloR*haloR-coreR*coreR));  // area-uniform annulus
      const a=i*golden+0.5;
      pts.push([r*Math.cos(a), r*Math.sin(a), nHalo>0?Whalo/nHalo:0]);
    }
    // eclipse: occlude a moon-disk over the sun -> remaining samples form a crescent
    const moonR = params.eclipse ? coreR*1.0 : 0;
    let moonD = params.eclipse ? coreR*(1.3-params.eclipse_amount) : 0;
    // A route crossing the eclipse gate moves the moon instead (trans.moon, from komorebi-transitions.js): its place on the path is
    // carried in core radii and turned into a distance from THIS frame's radii, so it stays continuous while they tween, and its limb
    // is soft by `soft` of each ring's own sample spacing while it moves. At rest the rule below is the hard one, exactly.
    const moon = trans.active && trans.moon && params.eclipse && coreR > 0 ? trans.moon : null;
    let dCore = 0, dHalo = 0;
    if(moon){
      [dCore, dHalo] = moonSpacing(coreR, haloR, nCore, nHalo);
      src.moonClear = moonClear(coreR, haloR, dCore, dHalo);
      moonD = coreR*moonDistance(moon.x, moon.amount, src.moonClear);
    }
    if(params.eclipse){
      pts.forEach((p, i) => { p[2] *= moonCover(Math.hypot(p[0]-moonD, p[1]), moonR, moon ? moon.soft*(i < nCore ? dCore : dHalo) : 0); });
      // No renormalisation: the floor dims by the share the moon covers, as a real eclipse does, and each crescent stays as bright per area as the
      // clear sun's disc. To bring back the old look, the crescents at the clear sun's total, renormalise here:
      //   let s=0; for(const p of pts) s+=p[2]; if(s>0) for(const p of pts) p[2]/=s;
      // and divide the seen source's Lcore/Lhalo below by the analytic uncovered share again (see there).
    }
    // THE SEEN SOURCE (§4.9, sky view): the same distribution these samples approximate, expressed as RADIANCE — the
    // core disk and the halo annulus, each carrying its post-cloud weight over its own solid angle. Derived HERE, from
    // the very numbers the sampler just used, so the sun you look at and the dapples it throws cannot drift apart:
    // raise cloud_thickness and the disk drains into the aureole by exactly the amount the dapples soften. Absolute
    // scale is authored — see SKY_SUN_GAIN.
    // The eclipse's seen source is the uncovered disc at its own radiance: the moon removes area, not brightness. The renormalised
    // version divided Lcore/Lhalo by `live`, the analytic share left uncovered (circle-circle overlap via lensArea); `git show 8d75e3b:komorebi-source.js` has it.
    const aCore = Math.PI*coreR*coreR, aHalo = Math.max(Math.PI*(haloR*haloR - coreR*coreR), 1e-12);
    src.coreR = coreR; src.haloR = haloR; src.moonD = moonD; src.moonR = moonR;
    src.Lcore = SKY_SUN_GAIN * Wcore / aCore;                          // the uncovered surface is as bright as ever; the eclipse removes area, not radiance
    src.Lhalo = SKY_SUN_GAIN * Whalo / aHalo;
    const flat=new Float32Array(pts.length*3);
    let mr=1e-9, mw=1e-9;
    pts.forEach((p,i)=>{ flat[i*3]=p[0]; flat[i*3+1]=p[1]; flat[i*3+2]=p[2];
      mr=Math.max(mr,Math.hypot(p[0],p[1])); mw=Math.max(mw,p[2]); });
    src.flat=flat; src.count=pts.length; src.maxR=mr; src.maxW=mw; src.haloR=haloR;
    if(EDITOR && hub.srcDbgBuf){   // driven transition scenes have no editor overlays
      gl.bindBuffer(gl.ARRAY_BUFFER, hub.srcDbgBuf);
      gl.bufferData(gl.ARRAY_BUFFER, flat, gl.DYNAMIC_DRAW);
    }
  }

  // per-call scratch (see the render module's _atm note): recomputed fresh into these each call, so a static
  // frame allocates nothing and there is no stale-cache risk.
  const _proj = [0,0,0,0], _lh = new Float32Array(MAX_LAYERS);
  const _bulk = [0,0];

  // Is the canopy a finite OBJECT with a bulk throw (a standing tree, the curtain, the tent) rather than the endless park? The one
  // question the beam's bulk shift and the sky fill's domain (§4.7: wrap the box, or open sky over a padded frame) both ask.
  const bulkOn = () => !!(params.standing_scene || params.receiver);

  // STANDING-SCENE bulk shadow offset (§4.8): cot(elev)·(anti-sun direction) per unit height — the lateral throw the
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

  return { regenSource, bulkShift, bulkOn, projMatrix, layerHeights };
}

// The heights a route between layer counts starts or ends at: the look's own n heights over [base, base+thick], the layers above
// its top padded with the top one, so a layer only one look fills moves to or from the nearest layer the other has.
export function routeHeights(n, base, thick){
  const out = new Float64Array(MAX_LAYERS), top = Math.max(1, n) - 1;
  for(let i=0;i<MAX_LAYERS;i++){ const j = Math.min(i, top); out[i] = n>1 ? base+(j/(n-1))*thick : base; }
  return out;
}

// ---- THE MOON ON A ROUTE (spec model/transitions.md, "Crossing a gate"). Pure functions of the source's own numbers; the moon's
// radius is the core's, and distances are in core radii. ----
// The share of the path, from the authored bite out, that runs to core contact (2 core radii): the visible bite gets most of the
// moon's travel and the crossing of the halo, where nothing is yet bitten out of the core, is quick.
export const MOON_BITE_SHARE = 0.8;
// Each ring's own area-uniform sample spacing: the core disc and the halo annulus each share their area equally among their samples.
// With no halo samples the halo band is the core's, so the clear distance stays defined.
export function moonSpacing(coreR, haloR, nCore, nHalo){
  const dCore = coreR*Math.sqrt(Math.PI/Math.max(1, nCore));
  return [dCore, nHalo > 0 ? Math.sqrt(Math.PI*Math.max(0, haloR*haloR - coreR*coreR)/nHalo) : dCore];
}
// Clear of the whole sampled source: the moon's centre where its limb, less half a band, passes outside the core and the halo, in
// core radii. Taken with the full band, so a sample is whole there however soft the limb is.
export const moonClear = (coreR, haloR, dCore, dHalo) => (Math.max(coreR + dCore/2, haloR + dHalo/2) + coreR)/coreR;
// The moon's distance at x on its path: 0 is the eclipsed look's own bite (the settled look's 1.3 − eclipse_amount), 1 is clear.
// Monotone in x; the bite part takes MOON_BITE_SHARE of x.
export function moonDistance(x, amount, clear){
  const bite = 1.3 - amount, end = Math.max(clear, bite), contact = clamp(2, bite, end);
  return x <= MOON_BITE_SHARE ? lerp(bite, contact, x/MOON_BITE_SHARE) : lerp(contact, end, (x - MOON_BITE_SHARE)/(1 - MOON_BITE_SHARE));
}
// Where a moon shown at distance m sits on a path to `amount`'s bite: what an interrupted route starts the next one from.
export function moonX(m, amount, clear){
  const bite = 1.3 - amount, end = Math.max(clear, bite), contact = clamp(2, bite, end);
  if(m <= contact) return contact > bite ? (m - bite)/(contact - bite)*MOON_BITE_SHARE : 0;
  return end > contact ? MOON_BITE_SHARE + (m - contact)/(end - contact)*(1 - MOON_BITE_SHARE) : 1;
}
// What of a sample at distance d from the moon's centre survives. A band of 0 is the hard rule (inside the moon it is gone, outside
// it is whole); a positive band fades it linearly across that width, centred on the limb, so the weight is continuous in the moon's place.
export const moonCover = (d, moonR, band) => band > 0 ? clamp((d - moonR)/band + 0.5, 0, 1) : (d < moonR ? 0 : 1);
