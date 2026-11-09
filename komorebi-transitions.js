// ============================================================================
// Scene transitions (spec §9) — the cloud-bloom crossfade between looks: MORPH
// knobs tween live, STRUCTURAL ones snap under the bloom peak (dissolve), a
// same-topology grove change morphs, and a mode flip takes the widest bloom.
// transitionTo classifies the route; tickTransition drives it each frame.
// A factory over the engine's shared internals (hub).
// ============================================================================
import { TAU, beamExposure, cameraPose, clamp, lerp, lerpAngle, smoothstep } from './komorebi-math.js';
import { cameraFor } from './komorebi-transport.js';
import { ANGLE_SET, BLOOM_MAX, CANOPY_KEYS, CANOPY_MORPH_MAX, CROSS_HALF_W, DEFAULTS, DUR_SCALE, MODE_KEYS, MORPH_KEYS, MORPH_SET, SEASON_KEYS, TOPO_KEYS, migrateLegacy } from './komorebi-params.js';
import {seasonTravelEligible} from './komorebi-season-travel.js';
import {litterRiseEligible,litterFallEligible,shadowRiseEligible} from './komorebi-litter-rise.js';
import {groveTravelEligible} from './komorebi-grove-travel.js';
import {densityEligible, densityKey, densityCount} from './komorebi-grove.js';

const CAMERA_KEYS = new Set(['view_extent_m','view_pitch_deg','view_fov_deg','view_yaw_deg','view_center_x','view_center_y']);
const WINDOW_KEYS = new Set(['window_w_m','window_h_m','window_cx_m','window_cy_m','window_wall']);
const VIEW_KEYS = new Set([...CAMERA_KEYS,'sky_view','drift_phase','auto_quality','adaptive_motion','adaptive_idle_fps','show_source','show_layer','show_layer_index']);
const hemisphere = p => (p.sky_view ? p.view_pitch_deg : 90-p.view_pitch_deg) > p.view_fov_deg/2;
const proxyGlow = (p) => p.sky_view ? p.sky_scatter : (p.receiver|0)===0 && p.canopy_fill>0 ? p.fill_scatter : 0;

export function makeTransitions(hub){
  const { params, trans, faithfulOn } = hub;
  // A selection that waits for the moving route's settled frame (the latest one replaces it, and the route's own
  // completion no longer fires), and the start of that selection once the route has settled.
  const wait = (to, opts) => { trans.waiting = { to, opts }; trans.onEnd = null; };
  const queued = cb => { const w = trans.waiting; trans.waiting = null; return w ? () => hub.transitionTo(w.to, w.opts) : cb; };

  // ---- preset transitions (spec §9): morph the continuous look, dissolve the structural rebuild behind
  // a transient cloud-bloom. One entry point — the future MIDI/event layer drives this same method. ----
  function transitionTo(target, opts){
    opts = opts || {};
    if(!target || typeof target!=='object') return;
    const to = Object.assign({}, DEFAULTS, migrateLegacy(target));   // legacy names -> current; missing keys -> defaults (forward-compat, like setParams)
    if(trans.active&&trans.groveTravel){hub.retargetGroveTravel(to,opts);return;}
    if(!trans.active&&groveTravelEligible(params,to)&&hub.beginGroveTravel(to)!==false){
      hub.warnCut(to);
      Object.assign(trans,{from:{...params},to,t:0,dur:Math.max(1e-3,opts.duration??trans.dur),durScale:2,
        active:true,groveTravel:true,litterRise:false,sceneFade:false,seasonTravel:false,leafTravel:false,viewpoint:false,
        structDiff:true,canopyMorph:false,crossfade:false,backgroundFade:false,bloom:0,bloomMax:0,irisRadius:1,swapped:false,onEnd:opts.onEnd??null});
      return;
    }
    if(trans.active&&trans.litterRise){hub.retargetLitterRise(to,opts);return;}
    const shadowRise=!trans.active&&shadowRiseEligible(params,to)&&hub.faith?.count!==0;
    const litterFall=!trans.active&&litterFallEligible(params,to)&&hub.beginLitterRise(to,false,true)!==false;
    if(!trans.active&&(litterFall||shadowRise||hub.grove?.litter?.length&&litterRiseEligible(params,to))){
      hub.warnCut(to);
      Object.assign(trans,{from:{...params},to,t:0,dur:Math.max(1e-3,opts.duration??trans.dur),durScale:2,
        active:true,litterRise:true,shadowRise,litterFall,sceneFade:false,seasonTravel:false,leafTravel:false,viewpoint:false,
        structDiff:true,canopyMorph:false,crossfade:false,backgroundFade:false,bloom:0,bloomMax:0,irisRadius:1,swapped:false,onEnd:opts.onEnd??null});
      if(!litterFall){
        hub.beginLitterRise(to,shadowRise);
        for(const k in DEFAULTS)params[k]=to[k];
        hub.rebuildAll();hub.resetPerf();
      }
      return;
    }
    if(trans.active&&trans.seasonTravel){hub.retargetSeasonTravel(to,opts);return;}
    // Two dissolving scenes and a crossfade inside its window are each a picture no other route can start from: the
    // outgoing scene or the half-faded grove would be dropped. Such a selection waits, as it does on a travel route.
    if(trans.active && (trans.crossfade && !trans.swapped && hub.crossW>0
        || trans.sceneFade && (MODE_KEYS.some(k => to[k]!==params[k]) || !faithfulOn() || !to.faithful_canopy))){ wait(to, opts); return; }
    const seasonTravel=!trans.active&&seasonTravelEligible(params,to);
    trans.seasonTravel=seasonTravel;
    const retarget=trans.active&&trans.leafTravel;
    const turnScale=retarget&&hub.retargetLeafTravel(to,opts);   // a reversal's clock, scaled to the distance it has left
    if(retarget&&!turnScale)return;
    const irisFrom = trans.active ? (trans.irisRadius ?? 1) : 1;
    const movingView=trans.active && trans.viewpoint;
    const viewpoint=!!((!trans.active || movingView) && (movingView || params.sky_view!==to.sky_view) && !params.faithful_canopy && !to.faithful_canopy
      && params.receiver===0 && to.receiver===0 && params.branch_tau===0 && to.branch_tau===0
      && params.canopy_fill===0 && to.canopy_fill===0 && params.litter===0 && to.litter===0
      && hemisphere(to) && (movingView || hemisphere(params))
      && Object.keys(DEFAULTS).every(k=>VIEW_KEYS.has(k) && (k!=='view_extent_m' || params.standing_scene) || params[k]===to[k]));
    // Only a viewpoint can start from an eye in the middle of the horizon; any other camera would teleport there.
    if(movingView && !viewpoint){ wait(to, opts); return; }
    trans.waiting = null;
    const viewFrom=movingView ? {eye:[...trans.viewEye],elevation:trans.viewElevation,skyWeight:trans.viewSkyWeight} : cameraPose(params);
    trans.viewpoint=viewpoint;
    trans.viewInterrupted=!!movingView;
    if(viewpoint){
      trans.viewFrom=viewFrom; trans.viewTo=cameraPose(to);
      trans.viewEye=[...viewFrom.eye]; trans.viewElevation=viewFrom.elevation; trans.viewSkyWeight=viewFrom.skyWeight;
    }
    hub.warnCut(to);   // a tier this build cut that the target opens stays off, and is said so (once per engine)
    const from = {};
    for(const k of MORPH_KEYS)  from[k] = params[k];       // continuous look — always morphs live
    for(const k of CANOPY_KEYS) from[k] = params[k];       // continuous canopy — morphs live IF the topology matches
    const windowOn=params.window_w_m>0 && params.window_h_m>0, windowTo=to.window_w_m>0 && to.window_h_m>0;
    const windowFrom=trans.active && trans.windowFade ? trans.windowOpacity : Number(windowOn);
    trans.windowFade=windowFrom!==Number(windowTo);
    trans.windowFrom=windowFrom; trans.windowTo=Number(windowTo); trans.windowOpacity=windowFrom;
    trans.windowShape=windowOn ? from : to;
    // The authored proxy is inactive above leaf_diffuse zero. Meet at zero light before changing models.
    trans.splitFade=(params.leaf_diffuse===0 && to.leaf_diffuse>0 && proxyGlow(params)>0)
                 || (params.leaf_diffuse>0 && to.leaf_diffuse===0 && proxyGlow(to)>0);
    const topoDiff   = TOPO_KEYS.some(k => to[k]!==params[k]);     // a new tree/layer/seed: can't morph leaf-for-leaf
    const modeDiff   = MODE_KEYS.some(k => to[k]!==params[k]);     // a scene-MODE flag flips (faithful_canopy/standing_scene/receiver): needs a rebuild, NOT a snap-with-stale-state
    const shadowFrom = trans.active ? (trans.shadowOpacity ?? 1) : 1;   // whatever route is interrupted, from the shown opacity
    // Floor-to-floor mode changes meet on the lit ground, so the grove swap carries no shadow discontinuity.
    trans.backgroundFade = !viewpoint && modeDiff && !params.sky_view && !to.sky_view && (params.receiver|0)===0 && (to.receiver|0)===0;
    trans.settleCamera = trans.backgroundFade && params.standing_scene && !to.standing_scene;
    trans.shadowFrom = shadowFrom;
    trans.shadowOpacity = shadowFrom;
    // Wood must meet zero at the mode swap when only one look has it: otherwise the woodless grove briefly
    // casts the other look's skeleton (an overhead trunk becomes a dot with radial limbs).
    trans.woodFade = modeDiff && ((params.branch_tau > 0) !== (to.branch_tau > 0));
    const canopyDiff = CANOPY_KEYS.some(k => to[k]!==params[k]);   // branch/leaf knobs differ
    const leafCount  = hub.layerVAO.reduce((s,L)=>s+L.count, 0);       // current grove size
    const leavesFrom=hub.hier?.nLeaf??Math.ceil(params.leaves_per_cluster*params.foliage_density),leavesTo=Math.ceil(to.leaves_per_cluster*to.foliage_density);
    const targetClusters=Math.ceil(Math.max(1,to.tree_count))*to.limb_count*Math.max(1,to.branch_children)**Math.max(0,to.branch_levels-1);
    const carrierCount=Math.max(leafCount/Math.max(1,leavesFrom),targetClusters)*Math.max(leavesFrom,leavesTo);
    const leafTravel=retarget||(!trans.active&&params.faithful_canopy!==to.faithful_canopy
      && !params.sky_view&&!to.sky_view&&!params.standing_scene&&!to.standing_scene
      && params.receiver===0&&to.receiver===0&&params.branch_tau===0&&to.branch_tau===0
      && params.canopy_fill===0&&to.canopy_fill===0&&params.litter===0&&to.litter===0
      && params.leaf_drop===0&&to.leaf_drop===0&&params.inner_leaves===0&&to.inner_leaves===0&&params.leaf_size_m>0&&to.leaf_size_m>0
      && params.edge_area===to.edge_area&&params.eclipse===to.eclipse
      && leafCount>0&&leavesTo>0&&carrierCount<=CANOPY_MORPH_MAX);
    trans.leafTravel=!!leafTravel;
    if(leafTravel){trans.backgroundFade=false;trans.settleCamera=false;}
    // a grove morph scales the leaf count by tree_count AND per-twig density (leaves_per_cluster*foliage_density);
    // budget against the busier (more-leaves) end so a dense/many-tree target falls back to the cheap dissolve.
    const densFrom   = Math.max(1e-6, params.leaves_per_cluster*params.foliage_density);
    const densTo     = Math.max(0,    to.leaves_per_cluster*to.foliage_density);
    const morphScale = (Math.max(1, to.tree_count)/Math.max(1, params.tree_count)) * (densTo/densFrom);
    const densityMorph = !!hub.hier && params.foliage_density !== to.foliage_density
      && densityEligible(params) && densityEligible(to) && densityKey(params, faithfulOn()) === densityKey(to, faithfulOn())
      && CANOPY_KEYS.every(k => k==='foliage_density' || SEASON_KEYS.includes(k) || to[k]===params[k]);
    // Count the capacity, including the marginal leaf: a bare source's zero draw count must not bypass the peak budget.
    const morphCost  = Math.max(leafCount * Math.max(1, morphScale), densityMorph ? hub.hier.nClusterTotal*Math.max(densityCount(params), densityCount(to)) : 0);
    // a mode flip can't morph leaf-for-leaf (the bake path / faithTex size / crown sizing change), so it forces a
    // dissolve+rebuild just like a topology change — never a live grove morph (which only regrows, no realloc).
    const morphGrove = canopyDiff && !topoDiff && !modeDiff && morphCost <= CANOPY_MORPH_MAX;   // same branching+mode, small enough -> morph it
    trans.canopyMorph = !seasonTravel&&morphGrove;
    trans.seasonMorph = trans.canopyMorph && CANOPY_KEYS.every(k => SEASON_KEYS.includes(k) || to[k]===params[k]);
    trans.densityMorph = trans.canopyMorph && densityMorph;
    trans.structDiff  = viewpoint || topoDiff || modeDiff || (canopyDiff && !morphGrove);   // dissolve+rebuild on topology OR mode change, or a grove too big to morph
    // WHICH TIER'S BLOOM this is, decided once here rather than re-derived per frame: a mode flip's shallower hump
    // (the camera changes, so cover buys nothing and depth only blows the frame out) or a topology dissolve's
    // deeper one (there is a real grove swap under there that wants hiding). See BLOOM_MAX.
    // Both are STRUCTURAL-only. A tier-1/2 live morph has no bloom to cap, and the longer clock is the bloom's
    // cost being paid for — lengthening an ordinary look-to-look step would change the feel of every arrow press
    // for nothing. (Caught by measurement: applying the stretch to every non-mode route took the tier-1 reference
    // route from 4.9 to 2.6, which is not an improvement, it is a different transition.)
    // THE CROSSFADE GATE (§9), v1 and deliberately narrow — every condition is something the crossfade cannot
    // yet do, not something it does badly:
    //  • a TOPOLOGY change and not a MODE flip — a camera swap has no second grove to blend, it has a second SCENE;
    //  • neither end faithful — that tier pre-integrates one grove into one texture, with nothing to blend against;
    //  • no WOOD at either end — the analytic occluder is one segment table, and this v1 crossfades LEAVES only.
    //    (The table is a texture since the packet before last and can hold two sets, so the wood crossfade is a
    //    real next step rather than a wish; until it exists, branch_tau > 0 keeps the honest cut.)
    //  • the two groves must share one set of layer textures, so the knobs that SIZE those textures have to match.
    // Anything outside the gate takes the paths it already took.
    const layersShared = to.layer_count===params.layer_count && to.tex_resolution===params.tex_resolution
                      && to.bake_resolution===params.bake_resolution;
    const crossOK = topoDiff && !modeDiff && !morphGrove
                 && !faithfulOn() && !to.faithful_canopy
                 && !(params.branch_tau > 0) && !(to.branch_tau > 0)
                 && layersShared;
    const sceneFade = !seasonTravel && !leafTravel && (trans.structDiff || !!trans.sceneFade) && !modeDiff && faithfulOn() && to.faithful_canopy;
    if(sceneFade) trans.structDiff=true;   // an interruption still has two different visible scenes to dissolve
    if(!sceneFade && trans.sceneFade) hub.endSceneFade();
    if(sceneFade) hub.beginSceneFade();   // preserve the outgoing scene before params become the incoming look
    trans.sceneFade = sceneFade;
    // Feather zero removes the entire mask. Move its boundary across the frame before crossing that gate.
    trans.irisFrom = !sceneFade && params.vignette===0 && to.vignette>0 ? Math.SQRT2 : irisFrom;
    trans.irisClosing = !sceneFade && params.vignette>0 && to.vignette===0;
    trans.irisRadius = sceneFade ? 1 : trans.irisFrom;
    const tier = modeDiff ? 'mode' : crossOK ? 'cross' : 'dissolve';
    trans.crossfade = crossOK;
    trans.bloomMax = trans.backgroundFade || viewpoint || leafTravel || seasonTravel ? 0 : BLOOM_MAX[tier];
    trans.durScale = trans.structDiff ? DUR_SCALE[tier] : 1;
    if(hub.groveIn){ hub.freeGrove(hub.groveIn); hub.groveIn = null; }   // a transition interrupting a transition drops the half-faded grove
    hub.crossW = 0;
    if(crossOK) hub.groveIn = hub.buildTargetGrove(to);          // grow it NOW, at rest, while it is still invisible
    trans.from = from; trans.to = to;
    trans.dur = Math.max(1e-3, opts.duration!=null ? opts.duration : trans.dur);   // stays the CALLER's number: it is also the sticky default for a later duration-less call, so the mode-flip stretch is applied at the clock (tickTransition) and never compounded into it
    trans.bloomFrom = trans.active ? trans.bloom : 0;   // an interrupted bloom eases out of the next route from where it is
    trans.t = 0; trans.swapped = false; trans.bloom = trans.bloomFrom; trans.active = true;
    trans.onEnd = opts.onEnd || null;
    if(seasonTravel){trans.structDiff=true;trans.durScale=2;hub.beginSeasonTravel(to);}
    if(leafTravel){
      trans.structDiff=true;trans.durScale=retarget?turnScale:2;
      if(!retarget){
        hub.beginLeafTravel(to);
        for(const k in DEFAULTS)params[k]=to[k];
        hub.rebuildAll();hub.resetPerf();
      }
    }
    if(sceneFade){
      trans.bloomMax = 0;
      for(const k in DEFAULTS) params[k] = to[k];
      hub.rebuildAll(); hub.resetPerf();
    }
  }

  function tickTransition(dt){
    if(!trans.active) return;
    const dur = trans.dur * trans.durScale;   // the tier's longer clock (see DUR_SCALE); scaled here, never into trans.dur, which stays the caller's sticky default
    trans.t = Math.min(1, trans.t + Math.min(dt,1/15)/dur);   // clamp the step like tick(): a tab-switch spike must not skip the bloom peak
    const t = trans.t, e = smoothstep(0,1,t);              // ease-in-out for the morph; raw t for the bloom hump
    if(trans.groveTravel){
      hub.stepGroveTravel(dt,t);
      if(t<1)return null;
      const pending=hub.finishGroveTravel();
      trans.active=false;trans.groveTravel=false;trans.swapped=true;
      hub.endGroveTravel();hub.resumeAdaptive?.();
      const cb=trans.onEnd;trans.onEnd=null;
      return pending?()=>hub.transitionTo(pending.to,pending.opts):cb;
    }
    if(trans.litterRise){
      hub.stepLitterRise(dt,t);
      if(t<1)return null;
      const pending=hub.finishLitterRise();
      trans.active=false;trans.litterRise=false;trans.swapped=true;
      hub.endLitterRise();hub.regenSource();hub.bake();hub.resumeAdaptive?.();
      const cb=trans.onEnd;trans.onEnd=null;
      return pending?()=>hub.transitionTo(pending.to,pending.opts):cb;
    }
    if(trans.viewpoint){
      for(let i=0;i<3;i++) trans.viewEye[i]=lerp(trans.viewFrom.eye[i],trans.viewTo.eye[i],e);
      trans.viewElevation=lerp(trans.viewFrom.elevation,trans.viewTo.elevation,e);
      trans.viewSkyWeight=lerp(trans.viewFrom.skyWeight,trans.viewTo.skyWeight,e);
    }
    // Carried from an interrupted route: its bloom eases out and its shadow opacity back to full over the first half.
    const carried = (trans.bloomFrom ?? 0)*(1 - smoothstep(0, 0.5, t));
    trans.shadowOpacity = trans.backgroundFade
      ? (t<0.5 ? lerp(trans.shadowFrom, 0, smoothstep(0,0.5,t)) : smoothstep(0.5,1,t))
      : lerp(trans.shadowFrom ?? 1, 1, smoothstep(0, 0.5, t));
    if(trans.sceneFade){
      trans.bloom = carried;
      hub.stepSceneFade(dt);
      if(t<1) return null;
      trans.active=false; trans.sceneFade=false; trans.swapped=true;
      hub.endSceneFade();
      const cb=trans.onEnd; trans.onEnd=null;
      return queued(cb);
    }
    trans.irisRadius = trans.irisClosing
      ? lerp(trans.irisFrom ?? 1, Math.SQRT2, smoothstep(0.75,1,t))
      : lerp(trans.irisFrom ?? 1, 1, smoothstep(0,0.25,t));
    // 0 at the ends, deepest at the midpoint — where the swap fires. Both structural tiers stop short of full
    // overcast (BLOOM_MAX): past their own depth the bloom stops dissolving anything and only blows the frame out.
    trans.bloom = Math.max(trans.structDiff ? Math.sin(Math.PI*t) * trans.bloomMax : 0, carried);
    trans.windowOpacity=lerp(trans.windowFrom, trans.windowTo, e);
    for(const k of MORPH_KEYS){ const a=trans.from[k], b=trans.to[k];
      if((trans.viewpoint||trans.leafTravel||trans.seasonTravel) && k==='drift_phase' && params.drift_auto) continue;
      if(trans.windowFade && WINDOW_KEYS.has(k)){ params[k]=trans.windowShape[k]; continue; }
      if(trans.splitFade){
        const leaving=trans.from.leaf_diffuse>0;
        if(k==='leaf_diffuse'){ params[k]=lerp(a,b,smoothstep(leaving ? 0 : 0.5, leaving ? 0.5 : 1,t)); continue; }
        if(k==='sky_scatter' || k==='fill_scatter'){
          params[k]=leaving ? lerp(0,b,smoothstep(0.5,1,t)) : lerp(a,0,smoothstep(0,0.5,t)); continue;
        }
      }
      // The returning overhead grove is built for its final framing while invisible, then fades in without a camera landing.
      if(trans.settleCamera && t>=0.5 && CAMERA_KEYS.has(k)){ params[k] = b; continue; }
      const w = k==='branch_tau' && trans.woodFade ? smoothstep(a>0 ? 0 : 0.5, a>0 ? 0.5 : 1, t) : e;
      params[k] = ANGLE_SET.has(k) ? lerpAngle(a,b,w, k==='drift_phase'?TAU:360) : lerp(a,b,w); }
    // Same receiver at both ends: the dapples travel straight from one end's level to the other's (beamExposure).
    { const cam=cameraFor(trans.from); if(cam===cameraFor(trans.to)) params.exposure=beamExposure(cam,trans.from,trans.to,e,params); }
    if(trans.canopyMorph) for(const k of CANOPY_KEYS) params[k] = lerp(trans.from[k], trans.to[k], e);  // deform the SAME grove
    let rebuilt = false, wake = null;
    // THE CROSSFADE WINDOW replaces the cut where it is gated on: coverage eases 0 -> 1 across [0.5-HW, 0.5+HW],
    // and the arrangement reorganizes instead of being replaced. The incoming grove is installed as the engine's
    // own once it carries the whole picture, which is also when the structural params can safely snap: nothing
    // reads them again until the next regrow.
    if(trans.seasonTravel){
      hub.stepSeasonTravel(dt,t);
      if(t<1)return null;
      const drift=params.drift_phase;
      for(const k in DEFAULTS)params[k]=trans.to[k];
      if(params.drift_auto)params.drift_phase=drift;
      const pending=hub.finishSeasonTravel();
      trans.active=false;trans.seasonTravel=false;hub.endSeasonTravel();
      hub.regenSource();hub.resetPerf();hub.bake();
      const cb=trans.onEnd;trans.onEnd=null;
      return pending?()=>hub.transitionTo(pending.to,pending.opts):cb;
    }else if(trans.leafTravel){
      hub.regenSource();hub.stepLeafTravel(dt,e,t);
      if(t<1)return null;
      const drift=params.drift_phase;
      for(const k in DEFAULTS)params[k]=trans.to[k];
      if(params.drift_auto)params.drift_phase=drift;
      const pending=hub.finishLeafTravel();
      trans.active=false;trans.leafTravel=false;trans.travelField=null;trans.travelTone=null;
      hub.endLeafTravel();hub.regenSource();hub.resetPerf();hub.bake();
      const cb=trans.onEnd;trans.onEnd=null;
      return pending?()=>hub.transitionTo(pending.to,pending.opts):cb;
    }else if(trans.viewpoint){
      trans.swapped=t>=0.5;   // one grove remains in place through the horizon; its mode-specific state lands at the end
    } else if(trans.crossfade){
      hub.crossW = clamp((t - (0.5 - CROSS_HALF_W)) / (2*CROSS_HALF_W), 0, 1);
      hub.crossW = smoothstep(0, 1, hub.crossW);                   // ease it, so the fade has no corners at either end
      if(!trans.swapped && hub.crossW >= 1){
        trans.swapped = true;
        for(const k in DEFAULTS) if(!MORPH_SET.has(k)) params[k] = trans.to[k];
        hub.installGrove(hub.groveIn); hub.groveIn = null; hub.crossW = 0;   // it IS the grove now; nothing is faded any more
        if(trans.waiting) wake = queued(null);                        // a selection made inside the window starts from here
      }
    } else if(!trans.swapped && t>=0.5){                   // swap the grove once, hidden under the bloom peak
      trans.swapped = true;
      if(trans.structDiff){
        for(const k in DEFAULTS) if(!MORPH_SET.has(k)) params[k] = trans.to[k];
        hub.rebuildAll(); rebuilt = true;                      // regrow grove + textures + source + bake, all at once
      }
    }
    if(!rebuilt){
      if(trans.canopyMorph){
        if(trans.densityMorph) hub.reweight(Math.max(trans.from.foliage_density, trans.to.foliage_density));
        else if(trans.seasonMorph) hub.reseason();   // one lazy record, then the same leaf arithmetic in the existing buffers
        else hub.regenCanopy();                // geometry still regrows, carrying its live sway
      }
      hub.regenSource();                         // morphed cloud -> source (always; transport re-reads it every frame)
      // re-bake only when the leaves actually move this frame — a grove morph, or live motion (wind/auto-drift,
      // both of which make motionActive() true). A settled-canopy look-crossfade keeps last frame's identical bake
      // (the tweening leaf_swing/flutter/stem knobs have no effect with motion.u≈0), so it's not re-rasterized.
      // EXCEPT in faithful mode the whole faith texture is sun-projected (its cast frame + per-leaf throw depend on
      // sun_elevation/azimuth), so a still-air time-of-day crossfade MUST re-bake or the dapple freezes at the start
      // angle for the whole morph (the layer path is immune — transport reprojects each frame from uProj/uBulkShift).
      const faithSunMorph = faithfulOn() &&
        (trans.from.sun_elevation_deg!==trans.to.sun_elevation_deg || trans.from.sun_azimuth_deg!==trans.to.sun_azimuth_deg);
      // These paths bake wood opacity into textures; a still-air fade must reach them too.
      const woodFade = trans.woodFade && (faithfulOn() || params.sky_view);
      // ...and every frame the crossfade window is open, because the coverage split itself is what changed.
      if(trans.canopyMorph || hub.motionActive() || faithSunMorph || woodFade || (trans.crossfade && trans.active)) hub.bake();
    }
    if(t>=1){                                              // land exactly on the target; clear the bloom
      const drift=params.drift_phase;
      trans.active = false; trans.bloom = 0;
      for(const k in DEFAULTS) params[k] = trans.to[k];
      // The last morph step's lerp can miss sway_pitch by a rounding step; the bake below must read the exact target's bend.
      if(hub.grove) hub.publishBend?.(hub.grove);
      if(trans.viewpoint){
        if(params.drift_auto)params.drift_phase=drift;
        hub.rebuildAll();
      }
      hub.regenSource(); hub.resetPerf();                          // bloom now 0; re-probe quality for the new look (it may carry auto-quality)
      if(faithfulOn()) hub.bake();                   // land the faith texture on the exact target sun (resetPerf only re-bakes on a bake-res change)
      const cb = trans.onEnd; trans.onEnd = null;
      return queued(cb);                             // handed back, not called: frame() calls it after scheduling the next frame, so a throwing onEnd cannot end the animation
    }
    return wake;
  }

  return { transitionTo, tickTransition };
}
