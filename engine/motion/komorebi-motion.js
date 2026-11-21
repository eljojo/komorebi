// ============================================================================
// Motion (spec/model/motion.md) — the broadband wind signal driving the trunk/limb/twig
// spring hierarchy: the per-frame weather + gust integration (tick), the
// spring integrator (tickHierarchy), and the bend-texture upload the bake
// reads (publishBend). A factory over the engine's shared internals (hub).
// ============================================================================
import { DEG, TAU, clamp } from '../komorebi-math.js';
import { windNoise, branchNoise, WIND_PATTERNS, flickMeanStep, flickLevel, airRead } from './komorebi-air.js';
import { weatherAt, leanForce, crossForce, gustEdge, advanceAir, airForce, airLevel, airDelay, airAcross, carrySpeed, shelter, makeAirTrack } from './komorebi-air.js';

export const MAX_MOTION_STEP = 1/15;

export function makeMotion(hub){
  const { gl, params, motion, faithfulOn } = hub;
  if(motion && !motion.air) motion.air = makeAirTrack();   // the air's kept past, which belongs to the weather like the clocks, not to a grove

  // THE TRUNKS (motion.md, "The coherent band"): each tree's coherent spring is driven by the gust as it reaches that tree, the
  // force at τ = t − s/U with s its trunk's distance along the wind from the grove's origin (komorebi-air.js, airDelay): a tree
  // downwind leans after one upwind. Tree 0 stands at the origin, so its trunk is the motion's own (motion.u, motion.sway), the
  // one every look with one tree has always had; motion.trunks[k] is tree k's ({ driveEnv, u, v, uLat, vLat, env, sway }),
  // [0] unused. The forces are pure in time, so each tree runs its own gust edges and springs on them, upwind trees included,
  // and its G is the air's G(t − s/U) up to the step. They are the weather's, not a grove's: in a crossfade both groves read
  // tree k's, and a tree newly grown takes tree 0's state and parts from it as its own gusts arrive.
  const trunkOf = (k) => (k && motion.trunks?.[k]) || motion;
  // EACH TREE'S PACE (sway_spread): tree k's springs (trunk, limbs, twigs) run at sway_stiffness × pace_k^sway_spread, pace_k its
  // own (komorebi-grove.js, treePace). Off, every tree's is the look's, and the arithmetic is the one it always was.
  const paceOf = (hier, k) => { const a = params.sway_spread; return a > 0 && hier?.treePace ? Math.pow(hier.treePace[k], a) : 1; };
  let shelterS = new Float64Array(8);   // scratch: S by tree this tick (komorebi-air.js, shelter)

  // ---- motion: integrate the limb and twig springs (children inherit parents) ----
  // Both take the GROVE they drive rather than reading the active one, because during a crossfade there are two
  // and each carries its own springs: the outgoing one keeps the state it has been living in, the incoming one
  // starts at rest (the tier-2 precedent — a newly grown tree does too). They share the global sway/drift clocks,
  // which are noise-of-time and belong to the weather, not to a grove.
  function tickHierarchy(steps, h, g){
    const hier = g?.hier;
    if(!hier) return;
    const t = motion.time;
    const wind = clamp(params.wind_strength*motion.weatherS, 0, 1);
    // the branch noise: windNoise's two tones, or with branch_noise the wind pattern's own broadband signal (komorebi-air.js)
    const bn = clamp(params.branch_noise || 0, 0, 1), pat = WIND_PATTERNS[params.wind_pattern] || WIND_PATTERNS.gusty;
    const noise = bn > 0 ? (x, y, tt, k) => (1 - bn)*windNoise(x, y, tt, k) + bn*branchNoise(x, y, tt, k, pat) : windNoise;
    // each limb and twig takes its own tree's trunk: its coherent gust sense u (signed, stiffened/backlashed) and its gust
    // intensity, which scales the branch noise (branch noise needs wind too; the springs can relax while leaf drift keeps ticking)
    const dz = params.damping_ratio;
    const wL0 = Math.max(0.3, params.sway_stiffness*0.5), wT0 = Math.max(0.3, params.sway_stiffness*2.0);
    let kL=wL0*wL0, kT=wT0*wT0, cL=2*dz*wL0, cT=2*dz*wT0;
    const lf=params.limb_flex, tf=params.twig_flex, paced = params.sway_spread > 0 && !!hier.treePace;
    // a tree's limbs and twigs at its own pace (EACH TREE'S PACE): their stiffness from its trunk's, as the look's are from the look's
    const springsOf = (k) => { const ws = params.sway_stiffness*paceOf(hier, k), wL = Math.max(0.3, ws*0.5), wT = Math.max(0.3, ws*2.0);
      kL=wL*wL; kT=wT*wT; cL=2*dz*wL; cT=2*dz*wT; };
    let maxv=0;
    const wx=motion.windX, wy=motion.windY;   // effective downwind direction (after the weather veer, spec/model/motion.md)
    const sp = Math.max(0, params.sway_pitch);   // gate on the second DOF: off → it never integrates and its state is held at rest
    for(let i=0;i<hier.nLimb;i++){             // limbs pivot about the trunk; bend = wind TORQUE about it
      const tr = trunkOf(hier.limbTree[i]), u = tr.u, eb = (0.25 + 0.75*tr.env)*wind;
      if(paced) springsOf(hier.limbTree[i]);
      const dx=hier.limbDir[2*i], dy=hier.limbDir[2*i+1];
      const torque = dx*wy - dy*wx;            // cross(limbDir,wind): tip swings downwind, sign by side —
                                               // so a uniform gust LEANS the whole canopy, never spins it
      const n = noise(hier.limbPlan[2*i], hier.limbPlan[2*i+1], t, 0.4);
      const target = lf*(u*torque + 0.6*eb*n);
      for(let s=0;s<steps;s++){ const a = kL*(target - hier.limbAngle[i]) - cL*hier.limbVel[i];
        hier.limbVel[i]+=a*h; hier.limbAngle[i]+=hier.limbVel[i]*h; }
      maxv=Math.max(maxv, Math.abs(hier.limbVel[i]));
      // ---- the SECOND rotational DOF (sway_pitch, spec/model/motion.md): elevation, in the limb's own vertical plane ----
      // One wind force, resolved two ways about the same joint. The drag PERPENDICULAR to the limb's plan
      // direction has a moment arm about the vertical and yaws it (the cross above); the drag PARALLEL to it
      // has none — it cannot yaw the limb at all, so it loads it end-on and pitches it. Hence dot where the
      // yaw takes cross, on the same balanced mechanical fan (limbDir, decoupled from the drawn azimuth spec/model/canopy.md)
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
      const tr = trunkOf(hier.clusterTree[j]), u = tr.u, eb = (0.25 + 0.75*tr.env)*wind;
      if(paced) springsOf(hier.clusterTree[j]);
      const cxj=hier.clusterPlan[2*j], cyj=hier.clusterPlan[2*j+1];
      const rx=cxj-hier.clusterGeom[4*j+2], ry=cyj-hier.clusterGeom[4*j+3], cl=Math.hypot(rx,ry)||1e-3;  // offset from THIS tree's trunk
      const tq=(rx*wy - ry*wx)/cl;             // downwind torque about the twig's own tree trunk (same lean sense as the limb)
      const n = noise(cxj, cyj, t+hier.clusterPhase[j], 1.5);
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
    const sp = Math.max(0, params.sway_pitch);   // 3-D lean (spec/model/motion.md): the limb's PITCH DOF → foreshorten factor in .w (faithful only); 0 → factor 1, byte-identical
    const faithful = faithfulOn();
    for(let j=0;j<hier.nClusterTotal;j++){
      const li = hier.clusterLimb[j];
      const lb = hier.limbAngle[li];
      hier.clusterData[4*j]   = lb;                                    // limb YAW bend this clump inherits (the plan rotation)
      hier.clusterData[4*j+1] = hier.twigAngle[j];                     // its own twig bend
      // foreshorten from the PITCH DOF, not the yaw: a limb pitched by θ carries its points to cos θ of their
      // elevation. 1−cos is EVEN, so an upwind limb pitched UP foreshortens too instead of lifting its cast —
      // the approximation named in spec/model/motion.md; a signed model needs each limb's rest elevation in the motion state.
      const fore = sp>0 ? clamp(1 - sp*(1-Math.cos(hier.limbPitch[li])), 0.1, 1) : 1;
      hier.clusterData[4*j+3] = fore;
      // GOTCHA — .z is packed per MODE and the shader that unpacks it must agree (VS_FAITH vs VS_BAKE; neither
      // side can see the other's convention). LAYER: .z keeps the static stem-angle seed regen wrote, untouched
      // here. FAITHFUL: .z is the OFFSET half of the anchored foreshorten (spec/model/motion.md) — hEff = attachH·(1−fore) +
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
    // each tree's trunk, as what it adds to tree 0's (the shared uSway and uWindLevel): row 2, which the vertex shaders add to
    // the sway and the leaves' u. Tree 0's adds exactly 0, so one tree never writes the row and draws as it always has.
    if(hier.nTree > 1){
      const T = hier.treeDelta, S = hier.swayData;
      for(let k=0;k<hier.nTree;k++){
        const tr = k ? motion?.trunks?.[k] : null;   // none for tree 0, nor for a tree the motion has not ticked yet: it is tree 0's
        if(!tr){ T[4*k] = 0; T[4*k+1] = 0; T[4*k+2] = 0; T[4*k+3] = 0; continue; }
        T[4*k] = tr.sway[0] - motion.sway[0]; T[4*k+1] = tr.sway[1] - motion.sway[1]; T[4*k+2] = tr.u - motion.u;
        T[4*k+3] = (tr.flick || 0) - (motion.flick || 0);   // .w: its flick less tree 0's (flutter_gust, komorebi-air.js)
      }
      for(let j=0;j<hier.nClusterTotal;j++){ const k = 4*hier.clusterTree[j]; S[4*j] = T[k]; S[4*j+1] = T[k+1]; S[4*j+2] = T[k+2]; S[4*j+3] = T[k+3]; }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 2, hier.nClusterTotal, 1, gl.RGBA, gl.FLOAT, S);
    }
  }

  // the air at every clump, at the motion's present (komorebi-air.js): its level into the cluster texture's second row,
  // which the bake reads as each leaf's flutter when wind_air is up
  const forceAt = (tau) => airForce(motion.air, tau);
  function publishAir(g){
    const hier = g?.hier;
    if(!hier) return;
    const t = motion.time, wx = motion.windX, wy = motion.windY, A = hier.airData, U = carrySpeed(params, motion.weatherS);
    for(let j=0;j<hier.nClusterTotal;j++) A[4*j] = airLevel(forceAt, t, hier.clusterPlan[2*j], hier.clusterPlan[2*j+1], wx, wy, U);
    uploadAir(g);
  }
  function uploadAir(g){
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, g.clusterTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, g.hier.nClusterTotal, 1, gl.RGBA, gl.FLOAT, g.hier.airData);
  }

  function motionActive(){
    return params.wind_strength>0 || (params.drift_auto && params.drift_amount>0)
        || Math.abs(motion.u)>1e-3 || Math.abs(motion.v)>1e-3   // keep simulating until settled
        || Math.abs(motion.uLat)>1e-3 || Math.abs(motion.vLat)>1e-3
        || (motion.trunks || []).some(s => s && (Math.abs(s.u)>1e-3 || Math.abs(s.v)>1e-3 || Math.abs(s.uLat)>1e-3 || Math.abs(s.vLat)>1e-3))
        || (hub.hier && hub.hier.maxV>2e-4)
        || (params.flutter_gust>0 && (motion.flick||0)>1e-3);   // the leaves still flicker as the last gust dies (flutter_gust)
  }

  function tick(dt){
    dt = clamp(dt, 0, MAX_MOTION_STEP);                         // guard tab-switch spikes
    const t = motion.time;
    // ---- weather (minutes, spec/model/motion.md): slow deterministic drift of overall STRENGTH and DIRECTION. At
    // weather_variability 0 it is identity (weatherS=1, no veer), so presets are untouched. Driven by low-
    // frequency noise-of-time, not stochastic OU — naturally bounded & mean-reverting, and keeps the whole
    // signal a reproducible function of t (no per-frame RNG). This is "calm day vs gusty day", evolving.
    // The force laws are komorebi-air.js's, pure in time, so the air can run them ahead of the trunk. ----
    const { weatherS, dirVeer } = weatherAt(params, t);
    const effDir = params.wind_direction_deg*DEG + dirVeer;
    motion.windX = Math.cos(effDir); motion.windY = Math.sin(effDir); motion.weatherS = weatherS;   // weatherS exposed for the HUD
    // ---- broadband gust force (seconds): the longitudinal channel carries a steady downwind LEAN plus a
    // gustiness-scaled fluctuation that can dip below zero in deep lulls (so the spring recoils back THROUGH
    // rest — the "comes back" fix); the lateral channel is pure decorrelated crosswind (so it is never a
    // 1-D slide). gust_frequency = the lowest-octave rate; `burst` waveshapes for clustered/squally gusts. --
    // ---- two springs (longitudinal u, lateral uLat): underdamped, nonlinear stiffening at the ceiling,
    // backlash (under-damped return stroke). rest = 0 → exact relaxation. wind is a force, not a target. ----
    const w = params.sway_stiffness;
    const steps = Math.max(1, Math.ceil(dt/(1/120)));         // substep for stability across ω
    const h = dt/steps;
    const dz = params.damping_ratio, bl = params.backlash_gain;
    const spring = (u, v, drive, w) => {                       // one Euler substep of the nonlinear spring, at stiffness w
      const denom = Math.max(0.02, 1 - u*u);                  // stiffening: restoring -> ∞ at ceiling
      let damp = dz; if(u*v < 0) damp /= (1 + bl);            // whip-back: under-damp the return stroke
      return v + (w*w*(drive - u/denom) - 2*damp*w*v)*h;      // new velocity
    };
    const cx = motion.windX, cy = motion.windY, ceil = params.sway_ceiling;
    // one trunk s, driven by rawL (mean lean + fluctuation; <0 in strong lulls → springback through rest) and driveT, the
    // zero-mean crosswind — deliberately NOT slewed: the rise-sharp/decay-soft gust-EDGE envelope is a longitudinal (lean)
    // phenomenon; crosswind has no preferred sign, so an asymmetric slew would bias a zero-mean channel
    const trunk = (s, rawL, driveT, wk) => {
      // gust-edge asymmetry: rise sharper than decay (validated). Reuses gust_attack/gust_decay as the slew (LONGITUDINAL only).
      s.driveEnv = gustEdge(s.driveEnv, rawL, dt, params);
      const driveL = s.driveEnv;
      // the flick: how far the drive stands from its own slow mean (komorebi-air.js, flutterGust), the leaves' flutter under flutter_gust
      s.flickMean = flickMeanStep(s.flickMean ?? driveL, driveL, dt); s.flick = flickLevel(driveL, s.flickMean);
      for(let i=0;i<steps;i++){
        s.v = spring(s.u, s.v, driveL, wk);     s.u    += s.v*h;
        s.vLat = spring(s.uLat, s.vLat, driveT, wk); s.uLat += s.vLat*h;
      }
      s.u = clamp(s.u, -1.5, 1.5);                            // safety; stiffening keeps it near ±1
      s.uLat = clamp(s.uLat, -1.5, 1.5);
      // env: a [0,1] "current gust intensity" for the hierarchy breathing (replaces the old gust envelope)
      s.env += (clamp(Math.abs(s.u), 0, 1) - s.env) * (1 - Math.exp(-dt/0.6));
      // compose world sway: u along the (veered) wind, uLat across it, scaled by the ceiling
      s.sway = [ (cx*s.u - cy*s.uLat)*ceil, (cy*s.u + cx*s.uLat)*ceil ];
    };
    // the other trees' trunks (THE TRUNKS, above), each at its own carried time, at the speed the gust is carried at (gust_carry),
    // in its own lane across the wind (gust_width_m) and its own shelter (wind_shelter); a tree with none yet starts as tree 0 is now
    const gA = hub.grove?.hier, gB = hub.groveIn?.hier, nTree = Math.max(gA?.nTree || 1, gB?.nTree || 1);
    const gOf = (k) => (gA && k < gA.nTree ? gA : gB), U = carrySpeed(params, weatherS);
    const sheltered = params.wind_shelter > 0;
    if(sheltered){
      const G = gA && gA.nTree >= nTree ? gA : gB;
      if(shelterS.length < nTree) shelterS = new Float64Array(nTree);
      if(G?.treeCrown) shelter(G.treePos, G.treeCrown, nTree, cx, cy, params.wind_shelter, shelterS); else shelterS.fill(1);
    }
    if(nTree > 1 || motion.trunks){
      if(!motion.trunks) motion.trunks = [];
      const trunks = motion.trunks;
      trunks.length = nTree; trunks[0] = null;
      for(let k=1;k<nTree;k++){
        const g = gOf(k), P = g.treePos, x = P[2*k], y = P[2*k+1];
        if(!trunks[k]) trunks[k] = { driveEnv: motion.driveEnv, u: motion.u, v: motion.v, uLat: motion.uLat, vLat: motion.vLat, env: motion.env, flickMean: motion.flickMean, flick: motion.flick };
        const s = trunks[k], lane = airAcross(x, y, cx, cy), S = sheltered ? shelterS[k] : 1;
        const tau = t - airDelay(x, y, cx, cy, U), ws = weatherAt(params, tau).weatherS;
        trunk(s, leanForce(params, tau, ws, lane, S), crossForce(params, tau, ws, lane, S), w*paceOf(g, k));
      }
    }
    // tree 0's, at the origin, now: the open air's lane, in its own shelter
    const S0 = sheltered ? shelterS[0] : 1, w0 = gA || gB ? w*paceOf(gA || gB, 0) : w;
    trunk(motion, leanForce(params, t, weatherS, 0, S0), crossForce(params, t, weatherS, 0, S0), w0);
    // the leaves' air carries the OPEN air's G (komorebi-air.js runs it ahead unsheltered): in shelter, tree 0's own drive is
    // not that, so the open air's edges are kept beside it
    if(sheltered) motion.airEnv = gustEdge(motion.airEnv ?? motion.driveEnv, leanForce(params, t, weatherS), dt, params);
    tickHierarchy(steps, h, hub.grove);                           // limb + twig springs (medium band)
    if(hub.groveIn) tickHierarchy(steps, h, hub.groveIn);             // ...and the incoming grove during a crossfade, on the same clocks
    motion.time += dt;
    // the air: G kept on its grid always (cheap, and turning wind_air on then finds a past); run ahead and read at each
    // clump only while wind_air is up, so a look without it pays nothing and draws exactly as before
    const air = airRead(params);
    advanceAir(motion.air, params, motion.time, sheltered ? motion.airEnv : motion.driveEnv, air);
    if(air){ publishAir(hub.grove); if(hub.groveIn) publishAir(hub.groveIn); }
    // incoherent band: advance the drift phase (periodic in 2π). The editor reflects it in its slider.
    if(params.drift_auto && params.drift_amount>0){
      params.drift_phase = (params.drift_phase + params.drift_speed*dt) % TAU;
    }
  }

  return { tickHierarchy, publishBend, publishAir, uploadAir, motionActive, tick };
}
