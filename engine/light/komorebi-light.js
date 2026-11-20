// ============================================================================
// The light — pure functions, no GL, no engine state. The sun and the air it crosses (spec/model/light.md): the 3-band atmosphere that colours the
// beam and the sky, the sun's direction, the cosine law each receiver takes the beam by (spec/model/receivers.md), the air's broadband loss, and the
// exposure the frame is shown at. The renderer, the bakes and the transitions read it so that every reader asks the same law of the same params.
// ============================================================================
import { DEG, clamp, lerp, smoothstep } from '../komorebi-math.js';

// ---- atmospheric colour: physical sun-disk + sky tint from solar elevation (spec/model/light.md). A cheap
// 3-band (R=620, G=555, B=470 nm) Beer's-law model. As the sun lowers, air mass grows and Rayleigh
// (∝ λ⁻⁴) reddens the direct beam; the ozone Chappuis band absorbs red, so the SCATTERED sky stays
// blue (the "blue hour"). Returns LINEAR RGB — the renderer's exposure/ACES/gamma stay downstream. --
const TAU_RAY = [0.0597, 0.0938, 0.1851];   // Rayleigh vertical optical depth per band (sea level)
const TAU_OZ  = [0.0403, 0.0258, 0.0040];   // ozone Chappuis (300 DU) — absorbs red, not blue
const TAU_AER = [1.861, 2.151, 2.670];      // aerosol per unit turbidity β (Ångström λ^-1.3)
function airMass(hDeg){                       // Kasten-Young 1989 — finite at the horizon (1/sin diverges)
  const h = Math.max(hDeg, 0);
  return 1/(Math.sin(h*DEG) + 0.50572*Math.pow(h+6.07995, -1.6364));
}
const _atmT=[0,0,0], _atmSky=[0,0,0];   // module scratch for the 3-band intermediates (written + read within one synchronous call)
// Fills the caller's `out` ({sun:[3], ambient:[3]}) in place rather than allocating, so a static frame makes no garbage.
function atmosphere(out, hDeg, beta, ambientSky){
  const m = airMass(hDeg);
  let tmax=1e-9, smax=1e-9;
  for(let i=0;i<3;i++){
    const ext = TAU_OZ[i] + beta*TAU_AER[i];
    _atmT[i]   = Math.exp(-m*(TAU_RAY[i] + ext));   // direct-beam transmittance -> sun disk
    _atmSky[i] = TAU_RAY[i]*Math.exp(-m*ext);       // Rayleigh single-scatter through ozone/aerosol -> sky
    tmax=Math.max(tmax,_atmT[i]); smax=Math.max(smax,_atmSky[i]);
  }
  const su=out.sun, am=out.ambient;
  su[0]=_atmT[0]/tmax; su[1]=_atmT[1]/tmax; su[2]=_atmT[2]/tmax;   // normalize to HUE; exposure carries brightness
  const kA = 0.08*ambientSky, dusk = smoothstep(15,0,hDeg)*0.5;    // belt-of-Venus: warm beam bleeds into the sky near sunset
  am[0]=(_atmSky[0]/smax + dusk*su[0])*kA;
  am[1]=(_atmSky[1]/smax + dusk*su[1])*kA;
  am[2]=(_atmSky[2]/smax + dusk*su[2])*kA;
  return out;
}

// The sun's UNIT direction (cos el·cos az, cos el·sin az, sin el), written into `out`. Deliberately unclamped in
// elevation (spec/model/receivers.md): incidence on a vertical cloth peaks as the sun lowers, where the 1/sin(el) throws diverge. ONE
// helper because every reader needs the same vector — transport's uSunDir upload (the cloth's and tent's incidence, the sky view's seen source) and the harness.
// The sky fill does not read it: its sun path is the beam's bulk shift (ONE SUN PER CAMERA, komorebi-bake.js, spec/model/fill.md).
function sunDirection(out, elevDeg, azDeg){
  const el=elevDeg*DEG, az=azDeg*DEG;
  out[0]=Math.cos(el)*Math.cos(az); out[1]=Math.cos(el)*Math.sin(az); out[2]=Math.sin(el);
  return out;
}

// The beam lands on a surface by the cosine of its incidence (`sun_cosine`, spec/model/light.md): the geometric factor the atmosphere's spectrum never carried. A pure function of the
// sun's angles and the receiver, ONE table, unclamped in elevation like sunDirection above (the 4° of the editor's clock and the 6° of the throws are floors on those, not
// on the surface: at 2° the floor gets sin 2°, not sin 4°). Radiance is invariant, so the seen disk takes nothing and the sky view gets 1 — the law belongs to the receiver.
//   floor      horizontal, normal +z: sin el.
//   enclosure  the crown, a horizontal panel: sin el. Every panel then multiplies by its own beamF in the shader, which is its incidence RELATIVE to the horizontal, so
//              beamF·sin el is dot(n, sun) only where beamF's two limits are clear of it: its cap at 2 (a panel turned into a sun below 30° is held to 2·sin el of the true
//              dot(n, sun) = 1: 0.845 at 25°, 0.416 at 12°) and its 0.15 divisor floor (below ≈ 8.6° every panel lands sin el/0.15 of its dot, the crown too, so the crown is
//              anchored to the floor only above that). tent 1's 55° is clear of both.
//   cloth      vertical, normal ±y: cos el·|sin az| = |sunDirection.y|. foldIncidence's `sgn` always picks the sun's side of the cloth, so the magnitude is the right one.
// It is the factor f.sunIrr scales uSunColor by (komorebi-render.js) and the fill's S takes the floor's of (komorebi-bake.js), so nothing in a shader multiplies by it.
const SUN_INCIDENCE = {
  floor:     (el) => Math.max(Math.sin(el*DEG), 0),
  enclosure: (el) => Math.max(Math.sin(el*DEG), 0),
  cloth:     (el, az) => Math.abs(Math.cos(el*DEG)*Math.sin(az*DEG)),
  sky:       () => 1,
  rise:      () => 1,   // the flying-leaf view joins the same two hemispheres
  viewpoint: () => 1,   // the upward rays see radiance; the floor branch applies its own incidence
};
function sunIncidence(camera, elevDeg, azDeg){ return SUN_INCIDENCE[camera](elevDeg, azDeg); }
// The beam's broadband loss to the air (`sun_extinction`). atmosphere() divides the beam by its
// brightest channel to keep only its hue, which also divides out how much dimmer a low sun is after the longer path through the air. This is that
// peak transmittance against the zenith's at the same turbidity: 1 overhead, about 0.5 at 12°, so a 12° floor against a 70° one is ×9.1 with the
// cosine law rather than ×4.5. The skylight's own fall at dusk is not in it.
function beamExtinction(hDeg, beta){
  const peak = (m) => { let t = 0; for(let i=0;i<3;i++) t = Math.max(t, Math.exp(-m*(TAU_RAY[i] + TAU_OZ[i] + beta*TAU_AER[i]))); return t; };
  return peak(airMass(hDeg))/peak(airMass(90));
}
// The receiver's share of that loss: exactly 1 at sun_extinction 0. The seen disk (the sky view, and the rays that look up) takes none in this prototype.
const SEEN = new Set(['sky', 'rise', 'viewpoint']);
const beamLoss = (camera, p) => SEEN.has(camera) ? 1 : lerp(1, beamExtinction(p.sun_elevation_deg, p.sky_turbidity), clamp(p.sun_extinction ?? 0, 0, 1));
// The beam's factor on a receiver as the render applies it (komorebi-render.js): exactly 1 at sun_cosine 0 and sun_extinction 0.
// The exposure the frame is shown at. With cloud_exposure up, a thicker cloud brightens the whole frame, as an eye or a camera opens up under a passing
// cloud: exposure × (1 + cloud_exposure·cloud). A look is authored at its own cloud, its exposure re-sat to exposure/(1 + cloud), so it shows as it
// always did there and brightens only as the cloud thickens past it. 0 is exposure itself.
const cloudGain = (p) => p.cloud_exposure > 0 ? 1 + p.cloud_exposure*clamp(p.cloud_thickness, 0, 1) : 1;
const shownExposure = (p) => p.cloud_exposure > 0 ? p.exposure*cloudGain(p) : p.exposure;
const beamIrr = (camera, p) => lerp(1, sunIncidence(camera, p.sun_elevation_deg, p.sun_azimuth_deg), clamp(p.sun_cosine, 0, 1))*beamLoss(camera, p);
// Exposure for a look between a and b at weight w, `now` holding the in-between sun and sun_cosine. Lerping exposure and the law
// apart over-lights the dapples midway (+18% in linear light between a look re-sat for the law and one without it); morphing their
// product instead keeps the dapples moving straight from one end's level to the other's, and only the shade and the sky follow
// exposure. With the law off at both ends every factor is exactly 1, so this is lerp(a.exposure, b.exposure, w) to the bit.
function beamExposure(camera, a, b, w, now){
  const irr = beamIrr(camera, now);
  return irr > 0 ? lerp(a.exposure*beamIrr(camera, a), b.exposure*beamIrr(camera, b), w)/irr : lerp(a.exposure, b.exposure, w);   // a sun at the horizon lights nothing to hold
}

// THE SKY SEEN (`view_sky`, spec/model/light.md): the radiance of the clear sky in a direction, from the same 3-band air as atmosphere(). Single scattering
// along the view ray through an exponential atmosphere over a round earth (Rayleigh scale height SKY_HR, aerosol SKY_HA): at each of SKY_STEPS points the
// sun's light arrives through the air above that point only (the sun's air mass at the ground, Kasten–Young as the beam, times what is left of each
// air above it), is scattered toward the eye by the air (Rayleigh's phase) and the aerosol (Henyey–Greenstein, g = SKY_G), and is dimmed on its way
// back along the ray. So the zenith is blue, scattered high where even a setting sun's light is still white, and the horizon pale where the long path
// saturates, warm and bright toward a low sun. Ozone dims the sun's light by its whole column (it lies above the scattering air) and nothing on the
// view path. A first version took the scattering at the ground for every ray, a sun reddened by its full path everywhere, and the whole sky went grey,
// and yellow at a sunset.
// Its scale is not authored: skyModel sets it so the whole sky lights a horizontal surface with the luminance of the ambient the engine's receivers take
// (atmosphere().ambient, the irradiance a white floor shows in shade), and the shader shows it in the receivers' units (a surface's radiance is its
// irradiance times its albedo, so a sky of uniform radiance L shows as πL). Scaled band by band, its hue was forced to the ambient's. The sun's own
// disk is not drawn. MORE THAN ONCE: single scattering alone left the horizon away from a low sun darker than the sky above it (the haze there scatters
// next to nothing backward and hides the air behind it), where a real horizon is bright with light scattered more than once; so each point also
// scatters, evenly every way, the mean radiance of the single-scattered sky (iso), the light the air there gets from the sky around it. That lifts the
// horizon, not all the way: away from a 12° sun at turbidity 0.05 it is 0.75 of the sky 10° above it (0.37 without), and in every azimuth the
// brightest band sits about 5° up.
// Approximation: two orders, the second isotropic and of one strength at every height; the sun's air mass the ground's at every height; ozone as one
// column above the air.
const SKY_G = 0.76, SKY_HR = 8, SKY_HA = 1.2, SKY_R = 6371, SKY_TOP = 60, SKY_STEPS = 16;   // km
function skyShape(d, s, M){   // the unscaled radiance per band in unit direction d (z up) for unit sun s; M from skyModel
  const z = Math.max(d[2], 0), mu = d[0]*s[0] + d[1]*s[1] + z*s[2];
  const pR = 3/(16*Math.PI)*(1 + mu*mu), pA = (1 - SKY_G*SKY_G)/(4*Math.PI*Math.pow(1 + SKY_G*SKY_G - 2*SKY_G*mu, 1.5));
  const tMax = Math.sqrt((SKY_R + SKY_TOP)**2 - SKY_R*SKY_R*(1 - z*z)) - SKY_R*z;
  const L = [0, 0, 0], tv = [0, 0, 0];
  let tPrev = 0;
  for(let k = 0; k < SKY_STEPS; k++){
    const u = (k + 0.5)/SKY_STEPS, t = tMax*u*u, dt = tMax*2*u/SKY_STEPS;
    const h = Math.max(0, Math.sqrt(SKY_R*SKY_R + t*t + 2*SKY_R*t*z) - SKY_R), eR = Math.exp(-h/SKY_HR), eA = Math.exp(-h/SKY_HA);
    for(let i = 0; i < 3; i++){
      const sR = M.r[i]/SKY_HR*eR, sA = M.a[i]/SKY_HA*eA;
      tv[i] += (sR + sA)*(t - tPrev);
      L[i] += ((sR*pR + sA*pA)*Math.exp(-M.ms*(M.r[i]*eR + M.a[i]*eA + M.o[i])) + (sR + sA)*M.iso[i])*Math.exp(-tv[i])*dt;
    }
    tPrev = t;
  }
  return L;
}
// The air's per-band vertical optical depths for turbidity beta (r Rayleigh, a aerosol, o ozone), the sun's air mass ms at hDeg, iso (the second order:
// the single-scattered sky's mean radiance, its irradiance on a horizontal surface over π), and `scale`: π times the ambient's luminance over the
// luminance of the whole sky's irradiance on a horizontal surface. Both integrals over the upper hemisphere on a 16 × 32 grid.
function skyIrradiance(s, M){
  const E = [0, 0, 0], NE = 16, NA = 32;
  for(let j = 0; j < NE; j++){ const e = (j + 0.5)/NE*Math.PI/2, ce = Math.cos(e), se = Math.sin(e), dw = (Math.PI/2/NE)*(2*Math.PI/NA)*ce;
    for(let k = 0; k < NA; k++){ const az = (k + 0.5)/NA*2*Math.PI, L = skyShape([ce*Math.cos(az), ce*Math.sin(az), se], s, M);
      for(let i = 0; i < 3; i++) E[i] += L[i]*se*dw; } }
  return E;
}
function skyModel(hDeg, beta, s, ambient){
  const M = { r: [...TAU_RAY], a: TAU_AER.map((t) => beta*t), o: [...TAU_OZ], ms: airMass(hDeg), iso: [0, 0, 0] };
  M.iso = skyIrradiance(s, M).map((e) => e/Math.PI);
  const E = skyIrradiance(s, M);
  const Y = (v) => 0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2], k = Math.PI*Y(ambient)/Math.max(Y(E), 1e-12);
  M.scale = [k, k, k];
  return M;
}

export { atmosphere, sunDirection, sunIncidence, beamExtinction, beamLoss, beamIrr, beamExposure, cloudGain, shownExposure, skyShape, skyModel, SKY_G, SKY_HR, SKY_HA, SKY_R, SKY_TOP, SKY_STEPS };
