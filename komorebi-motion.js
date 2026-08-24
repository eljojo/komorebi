// ============================================================================
// Motion (spec §5) — the broadband wind signal driving the trunk/limb/twig
// spring hierarchy: the per-frame weather + gust integration (tick), the
// spring integrator (tickHierarchy), and the bend-texture upload the bake
// reads (publishBend). A factory over the engine's shared internals (hub).
// ============================================================================
import { DEG, TAU, WIND_PATTERNS, clamp, fbm1, windNoise } from './komorebi-math.js';

export function makeMotion(hub){
  const { gl, params, motion, faithfulOn } = hub;

  // ---- motion: integrate the limb and twig springs (children inherit parents) ----
  // Both take the GROVE they drive rather than reading the active one, because during a crossfade there are two
  // and each carries its own springs: the outgoing one keeps the state it has been living in, the incoming one
  // starts at rest (the tier-2 precedent — a newly grown tree does too). They share the global sway/drift clocks,
  // which are noise-of-time and belong to the weather, not to a grove.
  function tickHierarchy(steps, h, g){
    const hier = g?.hier;
    if(!hier) return;
    const t = motion.time;
    const eb = 0.25 + 0.75*motion.env;       // differential bend breathes with the gust
    const u = motion.u;                       // coherent gust sense (signed, stiffened/backlashed)
    const dz = params.damping_ratio;
    const wL = Math.max(0.3, params.sway_stiffness*0.5), wT = Math.max(0.3, params.sway_stiffness*2.0);
    const kL=wL*wL, kT=wT*wT, cL=2*dz*wL, cT=2*dz*wT, lf=params.limb_flex, tf=params.twig_flex;
    let maxv=0;
    const wx=motion.windX, wy=motion.windY;   // effective downwind direction (after the weather veer, §5.1)
    const sp = Math.max(0, params.sway_pitch);   // gate on the second DOF: off → it never integrates and its state is held at rest
    for(let i=0;i<hier.nLimb;i++){             // limbs pivot about the trunk; bend = wind TORQUE about it
      const dx=hier.limbDir[2*i], dy=hier.limbDir[2*i+1];
      const torque = dx*wy - dy*wx;            // cross(limbDir,wind): tip swings downwind, sign by side —
                                               // so a uniform gust LEANS the whole canopy, never spins it
      const n = windNoise(hier.limbPlan[2*i], hier.limbPlan[2*i+1], t, 0.4);
      const target = lf*(u*torque + 0.6*eb*n);
      for(let s=0;s<steps;s++){ const a = kL*(target - hier.limbAngle[i]) - cL*hier.limbVel[i];
        hier.limbVel[i]+=a*h; hier.limbAngle[i]+=hier.limbVel[i]*h; }
      maxv=Math.max(maxv, Math.abs(hier.limbVel[i]));
      // ---- the SECOND rotational DOF (sway_pitch, §5.1): elevation, in the limb's own vertical plane ----
      // One wind force, resolved two ways about the same joint. The drag PERPENDICULAR to the limb's plan
      // direction has a moment arm about the vertical and yaws it (the cross above); the drag PARALLEL to it
      // has none — it cannot yaw the limb at all, so it loads it end-on and pitches it. Hence dot where the
      // yaw takes cross, on the same balanced mechanical fan (limbDir, decoupled from the drawn azimuth §4.5)
      // — but rotated by the limb's LIVE yaw bend, which is what makes STREAMLINING emergent: a broadside limb
      // is all cross and no dot, so it swings downwind first; that swing turns its live direction INTO the
      // wind's line, the dot grows, and only then does it pitch flat. No alignment special case anywhere.
      // An upwind limb (dot<0) takes negative torque and pitches UP. Same spring as the yaw (no new knobs).
      if(sp>0){
        const ca=Math.cos(hier.limbAngle[i]), sa=Math.sin(hier.limbAngle[i]);
        const lx=ca*dx - sa*dy, ly=sa*dx + ca*dy;      // live plan direction = mechanical fan turned by the yaw bend
        const pTorque = lx*wx + ly*wy;                 // dot(liveDir, wind)
        const pTarget = lf*u*pTorque;
        for(let s=0;s<steps;s++){ const a = kL*(pTarget - hier.limbPitch[i]) - cL*hier.limbPitchVel[i];
          hier.limbPitchVel[i]+=a*h; hier.limbPitch[i]+=hier.limbPitchVel[i]*h; }
        maxv=Math.max(maxv, Math.abs(hier.limbPitchVel[i]));   // the pitch must also hold motionActive open until it settles
      } else { hier.limbPitch[i]=0; hier.limbPitchVel[i]=0; }   // zeroed while off so re-enabling the knob starts from rest
    }
    for(let j=0;j<hier.nClusterTotal;j++){     // twigs: stiffer, faster, mostly decorrelated
      const cxj=hier.clusterPlan[2*j], cyj=hier.clusterPlan[2*j+1];
      const rx=cxj-hier.clusterGeom[4*j+2], ry=cyj-hier.clusterGeom[4*j+3], cl=Math.hypot(rx,ry)||1e-3;  // offset from THIS tree's trunk
      const tq=(rx*wy - ry*wx)/cl;             // downwind torque about the twig's own tree trunk (same lean sense as the limb)
      const n = windNoise(cxj, cyj, t+hier.clusterPhase[j], 1.5);
      const target = tf*(0.4*u*tq + eb*n);
      for(let s=0;s<steps;s++){ const a = kT*(target - hier.twigAngle[j]) - cT*hier.twigVel[j];
        hier.twigVel[j]+=a*h; hier.twigAngle[j]+=hier.twigVel[j]*h; }
      maxv=Math.max(maxv, Math.abs(hier.twigVel[j]));   // (clusterData is written by publishBend, below)
    }
    hier.maxV = maxv;
    publishBend(g);
  }

  // write the current limb/twig bend into the per-clump texture the bake VS samples. Called at the end of a
  // hierarchy tick, and again after a grove-morph regrow (which hands us a fresh, zeroed texture). ----
  function publishBend(g){
    const hier = g?.hier;
    if(!hier) return;
    const sp = Math.max(0, params.sway_pitch);   // 3-D lean (§5): the limb's PITCH DOF → foreshorten factor in .w (faithful only); 0 → factor 1, byte-identical
    const faithful = faithfulOn();
    for(let j=0;j<hier.nClusterTotal;j++){
      const li = hier.clusterLimb[j];
      const lb = hier.limbAngle[li];
      hier.clusterData[4*j]   = lb;                                    // limb YAW bend this clump inherits (the plan rotation)
      hier.clusterData[4*j+1] = hier.twigAngle[j];                     // its own twig bend
      // foreshorten from the PITCH DOF, not the yaw: a limb pitched by θ carries its points to cos θ of their
      // elevation. 1−cos is EVEN, so an upwind limb pitched UP foreshortens too instead of lifting its cast —
      // the approximation named in §5.1; a signed model needs each limb's rest elevation in the motion state.
      const fore = sp>0 ? clamp(1 - sp*(1-Math.cos(hier.limbPitch[li])), 0.1, 1) : 1;
      hier.clusterData[4*j+3] = fore;
      // GOTCHA — .z is packed per MODE and the shader that unpacks it must agree (VS_FAITH vs VS_BAKE; neither
      // side can see the other's convention). LAYER: .z keeps the static stem-angle seed regen wrote, untouched
      // here. FAITHFUL: .z is the OFFSET half of the anchored foreshorten (§5.1) — hEff = attachH·(1−fore) +
      // h·fore, i.e. heights shrink toward the limb's ATTACH height, not toward the ground, so the limb↔trunk
      // join stays closed. Safe because faithful_canopy is a MODE_KEYS flag: a flip rebuilds and republishes both.
      if(faithful) hier.clusterData[4*j+2] = hier.limbAttach[li]*(1-fore);   // sp=0 → fore=1 → exactly 0 → hEff = iHeight, byte-identical
    }
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, g.clusterTex);
    // perf todo — clusterTex is single-buffered: this rewrites the whole row, then bake()'s VS texelFetches the
    // SAME texture the same frame, so next frame's upload can stall on the prior bake still draining it (a
    // per-frame GPU sync bubble). Ping-pong a 2-deep ring of cluster textures to break the write-after-read.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, hier.nClusterTotal, 1, gl.RGBA, gl.FLOAT, hier.clusterData);
  }

  function motionActive(){
    return params.wind_strength>0 || (params.drift_auto && params.drift_amount>0)
        || Math.abs(motion.u)>1e-3 || Math.abs(motion.v)>1e-3   // keep simulating until settled
        || Math.abs(motion.uLat)>1e-3 || Math.abs(motion.vLat)>1e-3
        || (hub.hier && hub.hier.maxV>2e-4);
  }

  function tick(dt){
    dt = clamp(dt, 0, 1/15);                                  // guard tab-switch spikes
    const t = motion.time;
    const pat = WIND_PATTERNS[params.wind_pattern] || WIND_PATTERNS.gusty;
    // ---- weather (minutes, spec §5.1): slow deterministic drift of overall STRENGTH and DIRECTION. At
    // weather_variability 0 it is identity (weatherS=1, no veer), so presets are untouched. Driven by low-
    // frequency noise-of-time, not stochastic OU — naturally bounded & mean-reverting, and keeps the whole
    // signal a reproducible function of t (no per-frame RNG). This is "calm day vs gusty day", evolving. ----
    const wv = params.weather_variability, wt = t*0.012*Math.max(1e-3, params.weather_speed);
    const weatherS = clamp(1 + wv*0.85*fbm1(wt, 1, 3, 0.6), 0, 2.5);   // strength swells & lulls over minutes
    const dirVeer  = wv*30*DEG*fbm1(wt+13.1, 1, 3, 0.6);               // ±~30° slow veer/back at full variability
    const effStrength = params.wind_strength*weatherS;
    const effDir = params.wind_direction_deg*DEG + dirVeer;
    motion.windX = Math.cos(effDir); motion.windY = Math.sin(effDir); motion.weatherS = weatherS;   // weatherS exposed for the HUD
    // ---- broadband gust force (seconds): the longitudinal channel carries a steady downwind LEAN plus a
    // gustiness-scaled fluctuation that can dip below zero in deep lulls (so the spring recoils back THROUGH
    // rest — the "comes back" fix); the lateral channel is pure decorrelated crosswind (so it is never a
    // 1-D slide). gust_frequency = the lowest-octave rate; `burst` waveshapes for clustered/squally gusts. --
    const rate = Math.max(1e-3, params.gust_frequency);
    let gL = fbm1(t, rate, pat.octaves, pat.H);
    let gT = fbm1(t+101.7, rate, pat.octaves, pat.H);         // decorrelated lateral stream
    if(pat.burst>0){ const e=1+pat.burst*2;                   // spike peaks, deepen lulls (intermittency)
      gL=Math.sign(gL)*Math.pow(Math.abs(gL),e); gT=Math.sign(gT)*Math.pow(Math.abs(gT),e); }
    const ti = params.wind_gustiness;                         // turbulence intensity σ/U (gL,gT are unit-std)
    const rawL = effStrength*(pat.lean + ti*gL);              // mean lean + fluctuation; <0 in strong lulls → springback through rest
    const driveT = effStrength*(ti*pat.lat*gT);               // zero-mean crosswind — deliberately NOT slewed: the
                                                              // rise-sharp/decay-soft gust-EDGE envelope below is a
                                                              // longitudinal (lean) phenomenon; crosswind has no preferred
                                                              // sign, so an asymmetric slew would bias a zero-mean channel.
    // gust-edge asymmetry: rise sharper than decay (validated). Reuses gust_attack/gust_decay as the slew (LONGITUDINAL only). -
    const tc = (rawL>motion.driveEnv) ? params.gust_attack : params.gust_decay;
    motion.driveEnv += (rawL - motion.driveEnv) * (1 - Math.exp(-dt/Math.max(tc,1e-3)));
    const driveL = motion.driveEnv;
    // ---- two springs (longitudinal u, lateral uLat): underdamped, nonlinear stiffening at the ceiling,
    // backlash (under-damped return stroke). rest = 0 → exact relaxation. wind is a force, not a target. ----
    const w = params.sway_stiffness;
    const steps = Math.max(1, Math.ceil(dt/(1/120)));         // substep for stability across ω
    const h = dt/steps;
    const dz = params.damping_ratio, bl = params.backlash_gain;
    const spring = (u, v, drive) => {                          // one Euler substep of the nonlinear spring
      const denom = Math.max(0.02, 1 - u*u);                  // stiffening: restoring -> ∞ at ceiling
      let damp = dz; if(u*v < 0) damp /= (1 + bl);            // whip-back: under-damp the return stroke
      return v + (w*w*(drive - u/denom) - 2*damp*w*v)*h;      // new velocity
    };
    for(let i=0;i<steps;i++){
      motion.v = spring(motion.u, motion.v, driveL);     motion.u    += motion.v*h;
      motion.vLat = spring(motion.uLat, motion.vLat, driveT); motion.uLat += motion.vLat*h;
    }
    motion.u = clamp(motion.u, -1.5, 1.5);                    // safety; stiffening keeps it near ±1
    motion.uLat = clamp(motion.uLat, -1.5, 1.5);
    // env: a [0,1] "current gust intensity" for the hierarchy breathing (replaces the old gust envelope)
    motion.env += (clamp(Math.abs(motion.u), 0, 1) - motion.env) * (1 - Math.exp(-dt/0.6));
    // compose world sway: u along the (veered) wind, uLat across it, scaled by the ceiling
    const cx = motion.windX, cy = motion.windY, ceil = params.sway_ceiling;
    motion.sway = [ (cx*motion.u - cy*motion.uLat)*ceil, (cy*motion.u + cx*motion.uLat)*ceil ];
    tickHierarchy(steps, h, hub.grove);                           // limb + twig springs (medium band)
    if(hub.groveIn) tickHierarchy(steps, h, hub.groveIn);             // ...and the incoming grove during a crossfade, on the same clocks
    motion.time += dt;
    // incoherent band: advance the drift phase (periodic in 2π). The editor reflects it in its slider.
    if(params.drift_auto && params.drift_amount>0){
      params.drift_phase = (params.drift_phase + params.drift_speed*dt) % TAU;
    }
  }

  return { tickHierarchy, publishBend, motionActive, tick };
}
