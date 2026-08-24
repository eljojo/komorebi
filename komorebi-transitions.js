// ============================================================================
// Scene transitions (spec §9) — the cloud-bloom crossfade between looks: MORPH
// knobs tween live, STRUCTURAL ones snap under the bloom peak (dissolve), a
// same-topology grove change morphs, and a mode flip takes the widest bloom.
// transitionTo classifies the route; tickTransition drives it each frame.
// A factory over the engine's shared internals (hub).
// ============================================================================
import { TAU, clamp, lerp, lerpAngle, smoothstep } from './komorebi-math.js';
import { ANGLE_SET, BLOOM_MAX, CANOPY_KEYS, CANOPY_MORPH_MAX, CROSS_HALF_W, DEFAULTS, DUR_SCALE, MODE_KEYS, MORPH_KEYS, MORPH_SET, TOPO_KEYS, migrateLegacy } from './komorebi-params.js';

export function makeTransitions(hub){
  const { params, trans, faithfulOn } = hub;

  // ---- preset transitions (spec §9): morph the continuous look, dissolve the structural rebuild behind
  // a transient cloud-bloom. One entry point — the future MIDI/event layer drives this same method. ----
  function transitionTo(target, opts){
    opts = opts || {};
    if(!target || typeof target!=='object') return;
    const to = Object.assign({}, DEFAULTS, migrateLegacy(target));   // legacy names -> current; missing keys -> defaults (forward-compat, like setParams)
    const from = {};
    for(const k of MORPH_KEYS)  from[k] = params[k];       // continuous look — always morphs live
    for(const k of CANOPY_KEYS) from[k] = params[k];       // continuous canopy — morphs live IF the topology matches
    const topoDiff   = TOPO_KEYS.some(k => to[k]!==params[k]);     // a new tree/layer/seed: can't morph leaf-for-leaf
    const modeDiff   = MODE_KEYS.some(k => to[k]!==params[k]);     // a scene-MODE flag flips (faithful_canopy/standing_scene/receiver): needs a rebuild, NOT a snap-with-stale-state
    const canopyDiff = CANOPY_KEYS.some(k => to[k]!==params[k]);   // branch/leaf knobs differ
    const leafCount  = hub.layerVAO.reduce((s,L)=>s+L.count, 0);       // current grove size
    // a grove morph scales the leaf count by tree_count AND per-twig density (leaves_per_cluster*foliage_density);
    // budget against the busier (more-leaves) end so a dense/many-tree target falls back to the cheap dissolve.
    const densFrom   = Math.max(1e-6, params.leaves_per_cluster*params.foliage_density);
    const densTo     = Math.max(0,    to.leaves_per_cluster*to.foliage_density);
    const morphScale = (Math.max(1, to.tree_count)/Math.max(1, params.tree_count)) * (densTo/densFrom);
    const morphCost  = leafCount * Math.max(1, morphScale);
    // a mode flip can't morph leaf-for-leaf (the bake path / faithTex size / crown sizing change), so it forces a
    // dissolve+rebuild just like a topology change — never a live grove morph (which only regrows, no realloc).
    const morphGrove = canopyDiff && !topoDiff && !modeDiff && morphCost <= CANOPY_MORPH_MAX;   // same branching+mode, small enough -> morph it
    trans.canopyMorph = morphGrove;
    trans.structDiff  = topoDiff || modeDiff || (canopyDiff && !morphGrove);   // dissolve+rebuild on topology OR mode change, or a grove too big to morph
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
    const tier = modeDiff ? 'mode' : crossOK ? 'cross' : 'dissolve';
    trans.crossfade = crossOK;
    trans.bloomMax = BLOOM_MAX[tier];
    trans.durScale = trans.structDiff ? DUR_SCALE[tier] : 1;
    if(hub.groveIn){ hub.freeGrove(hub.groveIn); hub.groveIn = null; }   // a transition interrupting a transition drops the half-faded grove
    hub.crossW = 0;
    if(crossOK) hub.groveIn = hub.buildTargetGrove(to);          // grow it NOW, at rest, while it is still invisible
    trans.from = from; trans.to = to;
    trans.dur = Math.max(1e-3, opts.duration!=null ? opts.duration : trans.dur);   // stays the CALLER's number: it is also the sticky default for a later duration-less call, so the mode-flip stretch is applied at the clock (tickTransition) and never compounded into it
    trans.t = 0; trans.swapped = false; trans.bloom = 0; trans.active = true;
    trans.onEnd = opts.onEnd || null;
  }

  function tickTransition(dt){
    if(!trans.active) return;
    const dur = trans.dur * trans.durScale;   // the tier's longer clock (see DUR_SCALE); scaled here, never into trans.dur, which stays the caller's sticky default
    trans.t = Math.min(1, trans.t + Math.min(dt,1/15)/dur);   // clamp the step like tick(): a tab-switch spike must not skip the bloom peak
    const t = trans.t, e = smoothstep(0,1,t);              // ease-in-out for the morph; raw t for the bloom hump
    // 0 at the ends, deepest at the midpoint — where the swap fires. Both structural tiers stop short of full
    // overcast (BLOOM_MAX): past their own depth the bloom stops dissolving anything and only blows the frame out.
    trans.bloom = trans.structDiff ? Math.sin(Math.PI*t) * trans.bloomMax : 0;
    for(const k of MORPH_KEYS){ const a=trans.from[k], b=trans.to[k];
      params[k] = ANGLE_SET.has(k) ? lerpAngle(a,b,e, k==='drift_phase'?TAU:360) : lerp(a,b,e); }
    if(trans.canopyMorph) for(const k of CANOPY_KEYS) params[k] = lerp(trans.from[k], trans.to[k], e);  // deform the SAME grove
    let rebuilt = false;
    // THE CROSSFADE WINDOW replaces the cut where it is gated on: coverage eases 0 -> 1 across [0.5-HW, 0.5+HW],
    // and the arrangement reorganizes instead of being replaced. The incoming grove is installed as the engine's
    // own once it carries the whole picture, which is also when the structural params can safely snap: nothing
    // reads them again until the next regrow.
    if(trans.crossfade){
      hub.crossW = clamp((t - (0.5 - CROSS_HALF_W)) / (2*CROSS_HALF_W), 0, 1);
      hub.crossW = smoothstep(0, 1, hub.crossW);                   // ease it, so the fade has no corners at either end
      if(!trans.swapped && hub.crossW >= 1){
        trans.swapped = true;
        for(const k in DEFAULTS) if(!MORPH_SET.has(k)) params[k] = trans.to[k];
        hub.installGrove(hub.groveIn); hub.groveIn = null; hub.crossW = 0;   // it IS the grove now; nothing is faded any more
      }
    } else if(!trans.swapped && t>=0.5){                   // swap the grove once, hidden under the bloom peak
      trans.swapped = true;
      if(trans.structDiff){
        for(const k in DEFAULTS) if(!MORPH_SET.has(k)) params[k] = trans.to[k];
        hub.rebuildAll(); rebuilt = true;                      // regrow grove + textures + source + bake, all at once
      }
    }
    if(!rebuilt){
      if(trans.canopyMorph) hub.regenCanopy();   // regrow the morphing grove (regenCanopy republishes the carried-over sway)
      hub.regenSource();                         // morphed cloud -> source (always; transport re-reads it every frame)
      // re-bake only when the leaves actually move this frame — a grove morph, or live motion (wind/auto-drift,
      // both of which make motionActive() true). A settled-canopy look-crossfade keeps last frame's identical bake
      // (the tweening leaf_swing/flutter/stem knobs have no effect with motion.u≈0), so it's not re-rasterized.
      // EXCEPT in faithful mode the whole faith texture is sun-projected (its cast frame + per-leaf throw depend on
      // sun_elevation/azimuth), so a still-air time-of-day crossfade MUST re-bake or the dapple freezes at the start
      // angle for the whole morph (the layer path is immune — transport reprojects each frame from uProj/uBulkShift).
      const faithSunMorph = faithfulOn() &&
        (trans.from.sun_elevation_deg!==trans.to.sun_elevation_deg || trans.from.sun_azimuth_deg!==trans.to.sun_azimuth_deg);
      // ...and every frame the crossfade window is open, because the coverage split itself is what changed.
      if(trans.canopyMorph || hub.motionActive() || faithSunMorph || (trans.crossfade && trans.active)) hub.bake();
    }
    if(t>=1){                                              // land exactly on the target; clear the bloom
      trans.active = false; trans.bloom = 0;
      for(const k in DEFAULTS) params[k] = trans.to[k];
      hub.regenSource(); hub.resetPerf();                          // bloom now 0; re-probe quality for the new look (it may carry auto-quality)
      if(faithfulOn()) hub.bake();                   // land the faith texture on the exact target sun (resetPerf only re-bakes on a bake-res change)
      const cb = trans.onEnd; trans.onEnd = null; if(cb) cb();
    }
  }

  return { transitionTo, tickTransition };
}
