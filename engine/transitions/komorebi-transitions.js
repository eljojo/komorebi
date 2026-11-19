// ============================================================================
// Scene transitions (spec/model/transitions.md) — the cloud-bloom crossfade between looks: MORPH
// knobs tween live, STRUCTURAL ones snap under the bloom peak (dissolve), a
// same-topology grove change morphs, and a mode flip takes the widest bloom.
// transitionTo classifies the route; tickTransition drives it each frame. A long route is an entry in hub.routes
// (komorebi-routes.js) and trans.route the one running: the chooser below is the one place that names a route, and the
// lifecycle (start, tick, land, abort, context loss and restore, dispose) reads only the entry's policy.
// A factory over the engine's shared internals (hub).
// ============================================================================
import { TAU, clamp, lerp, lerpAngle, smoothstep } from '../komorebi-math.js';
import { irisRoute, irisStep, restTrans } from './komorebi-routes.js';
import { beamExposure } from '../light/komorebi-light.js';
import { cameraBetween, cameraPose } from '../transport/komorebi-camera.js';
import { cameraFor } from '../transport/komorebi-transport.js';
import { ANGLE_SET, BLOOM_MAX, LIT_GROUND_DIP, LIT_GROUND_HOLD, CANOPY_KEYS, CANOPY_MORPH_MAX, CROSS_HALF_W, DEFAULTS, DUR_SCALE, MODE_KEYS, MORPH_KEYS, MORPH_SET, SEASON_KEYS, TOPO_KEYS, migrateLegacy, layerBakeSize } from '../komorebi-params.js';
import {seasonTravelEligible} from './komorebi-season-travel.js';
import {litterRiseEligible,litterFallEligible,shadowRiseEligible,shadowFallEligible} from './komorebi-litter-rise.js';
import {groveTravelEligible} from './komorebi-grove-travel.js';
import {densityEligible, densityKey, densityCount, groveFill} from '../canopy/komorebi-grove.js';
import {moonX} from '../light/komorebi-source.js';
import {routeHeights} from '../transport/komorebi-cast.js';

const CAMERA_KEYS = new Set(['view_extent_m','view_pitch_deg','view_fov_deg','view_yaw_deg','view_center_x','view_center_y']);
const WINDOW_KEYS = new Set(['window_w_m','window_h_m','window_cx_m','window_cy_m','window_wall']);
const VIEW_KEYS = new Set([...CAMERA_KEYS,'sky_view','drift_phase','auto_quality','adaptive_motion','adaptive_idle_fps','show_source','show_layer','show_layer_index']);
const hemisphere = p => (p.sky_view ? p.view_pitch_deg : 90-p.view_pitch_deg) > p.view_fov_deg/2;
const proxyGlow = (p) => p.sky_view ? p.sky_scatter : (p.receiver|0)===0 && p.canopy_fill>0 ? p.fill_scatter : 0;

// THE GLIDE: a live morph between two standing looks moves the camera as a person would (cameraBetween), not the floor camera's gauges one by one,
// when the driver asks for it (opts.camera 'glide'). Each end is the look's own camera.
const CAMERA_LOOK = (p) => ({ view_extent_m: p.view_extent_m, view_pitch_deg: p.view_pitch_deg, view_yaw_deg: p.view_yaw_deg, view_fov_deg: p.view_fov_deg, view_center_x: p.view_center_x, view_center_y: p.view_center_y });
export const glideCamera = (a, b, t) => t <= 0 ? CAMERA_LOOK(a) : t >= 1 ? CAMERA_LOOK(b) : cameraBetween(a, b, smoothstep(0, 1, t));

export function makeTransitions(hub){
  const { params, trans, faithfulOn } = hub;
  // A selection that waits for the moving route's settled frame (the latest one replaces it, and the route's own
  // completion no longer fires), and the start of that selection once the route has settled.
  // A look that sees its tree (tree_view, komorebi-tree-view.js) is drawn by the cast's own leaves; the routes that carry those leaves themselves (the grove's,
  // the litter's and the season's travels) do not draw the tree. Such a pair takes the routes that keep the cast: a morph, a re-season, or the scene fade,
  // under which the tree comes and goes whole.
  const seesTree = (P) => !!(P.tree_view && P.standing_scene && P.faithful_canopy);
  const wait = (to, opts) => { trans.waiting = { to, opts }; trans.onEnd = null; };
  const queued = cb => {
    const w = trans.waiting, to = trans.to; trans.waiting = null;
    const next=w ? () => hub.transitionTo(w.to,w.opts) : cb;
    return hub.arrived ? () => { hub.arrived(to); next?.(); } : next;
  };
  // Every field back at rest (komorebi-routes.js), in place: the engine's handle holds this object. The caller's sticky duration stays.
  const toRest = () => { Object.assign(trans, restTrans(), { dur: trans.dur }); };
  // A route that carries its own leaves (the grove's regrouping, the litter's flights) starts from idle, once its begin has
  // prepared it: from rest, with its whole state written at once. No bloom; the long clock.
  function startCarried(route, to, opts, flavour){
    hub.warnCut(to);
    toRest();
    Object.assign(trans,{from:{...params},to,t:0,dur:Math.max(1e-3,opts.duration??trans.dur),durScale:2,
      active:true,route,structDiff:true,bloomMax:0,onEnd:opts.onEnd??null},flavour);
  }

  // ---- preset transitions (spec/model/transitions.md): morph the continuous look, dissolve the structural rebuild behind
  // a transient cloud-bloom. One entry point — the future MIDI/event layer drives this same method. ----
  function transitionTo(target, opts){
    opts = opts || {};
    if(!target || typeof target!=='object') return;
    const to = hub.resolveTarget ? hub.resolveTarget(target) : Object.assign({}, DEFAULTS, migrateLegacy(target));   // Resolve policy before classifying endpoints, including a queued selection.
    // A driver may ask for a fade ({ style: 'fade' }): the two looks dissolve as two moving scenes, whatever their modes, cameras or
    // receivers, and no travel route, morph, crossfade or bloom is taken. Two looks that differ only in live (MORPH) keys and runtime
    // flags have one grove, so a dissolve of the two would show nothing the live morph does not: they morph.
    const styleFade = opts.style==='fade' && [...TOPO_KEYS,...MODE_KEYS,...CANOPY_KEYS].some(k => to[k]!==params[k]);
    trans.waiting = null;
    if(opts.style==='fade' && trans.active){ wait(to, opts); return; }   // a scene dissolve starts from rest; keep the requested style until the current route lands
    const routes = hub.routes;
    if(trans.active&&trans.route?.name==='groveTravel'){trans.route.retarget(to,opts);return;}
    const castOwned = !seesTree(params) && !seesTree(to);   // a route that draws its own leaves may run
    if(!styleFade&&!trans.active&&castOwned&&groveTravelEligible(params,to)&&routes.groveTravel.begin(to)!==false){
      startCarried(routes.groveTravel,to,opts);
      return;
    }
    if(trans.active&&trans.route?.name==='litterRise'){trans.route.retarget(to,opts);return;}
    const shadowRise=!styleFade&&!trans.active&&castOwned&&shadowRiseEligible(params,to)&&hub.faith?.count!==0;
    const litterFall=!styleFade&&!trans.active&&castOwned&&litterFallEligible(params,to)&&routes.litterRise.begin(to,false,true)!==false;
    const shadowFall=!styleFade&&!trans.active&&castOwned&&shadowFallEligible(params,to)&&routes.litterRise.begin(to,true,true)!==false;
    if(!styleFade&&!trans.active&&castOwned&&(litterFall||shadowFall||shadowRise||hub.grove?.litter?.length&&litterRiseEligible(params,to))){
      startCarried(routes.litterRise,to,opts,{shadowRise,litterFall,shadowFall});
      if(!litterFall&&!shadowFall){   // a descent keeps the live sky grove until its floor lands
        routes.litterRise.begin(to,shadowRise);
        for(const k in DEFAULTS)params[k]=to[k];
        hub.rebuildAll();hub.resetPerf();
      }
      return;
    }
    if(trans.active&&trans.route?.name==='seasonTravel'){trans.route.retarget(to,opts);return;}
    // Two dissolving scenes and a crossfade inside its window are each a picture no other route can start from: the
    // outgoing scene or the half-faded grove would be dropped. Such a selection waits, as it does on a travel route.
    if(trans.active && (trans.crossfade && !trans.swapped && hub.crossW>0
        || trans.route?.name==='sceneFade' && (MODE_KEYS.some(k => to[k]!==params[k]) || !faithfulOn() || !to.faithful_canopy))){ wait(to, opts); return; }
    // A seen tree at one end only rides the season travel and fades across it, drawn from the cast's records on their twigs (komorebi-tree-view.js):
    // out over the first half, in over the second, never held through.
    const seasonTravel=!styleFade&&!trans.active&&(castOwned||seesTree(params)!==seesTree(to))&&seasonTravelEligible(params,to);
    const retarget=trans.active&&trans.route?.name==='leafTravel';
    const turnScale=retarget&&trans.route.retarget(to,opts);   // a reversal's clock, scaled to the distance it has left
    if(retarget&&!turnScale)return;
    if(!trans.active) toRest();   // a route started from idle starts from rest; an interrupted one reads what it shows, below
    const irisShown = trans.active && trans.iris ? trans.irisOpacity : null;   // an interrupted fade's opacity, read before anything changes
    const movingView=trans.active && trans.viewpoint;
    const viewpoint=!styleFade && !!((!trans.active || movingView) && (movingView || params.sky_view!==to.sky_view) && !params.faithful_canopy && !to.faithful_canopy
      && params.receiver===0 && to.receiver===0 && params.branch_tau===0 && to.branch_tau===0
      && params.canopy_fill===0 && to.canopy_fill===0 && params.litter===0 && to.litter===0
      && hemisphere(to) && (movingView || hemisphere(params))
      && Object.keys(DEFAULTS).every(k=>VIEW_KEYS.has(k) && (k!=='view_extent_m' || params.standing_scene) || params[k]===to[k]));
    // Only a viewpoint can start from an eye in the middle of the horizon; any other camera would teleport there.
    if(movingView && !viewpoint){ wait(to, opts); return; }
    trans.waiting = null;
    // What an interrupted route shows, read before anything changes: its moon (place on the path and limb), its layer heights, and
    // the layer count of the grove on screen (the layers a route raised above it are empty, so dropping them changes nothing).
    const moonShown = trans.active && trans.moon ? trans.moon : null;
    const layersShown = trans.active && trans.layerRoute ? Float64Array.from(hub.layerHeights()) : null;
    if(layersShown) params.layer_count = trans.swapped ? trans.layerRoute.nTo : trans.layerRoute.nFrom;
    const viewFrom=movingView ? {eye:[...trans.viewEye],elevation:trans.viewElevation,skyWeight:trans.viewSkyWeight} : cameraPose(params);
    trans.viewpoint=viewpoint;
    trans.viewInterrupted=!!movingView;
    if(viewpoint){
      trans.viewFrom=viewFrom; trans.viewTo=cameraPose(to);
      trans.viewEye=[...viewFrom.eye]; trans.viewElevation=viewFrom.elevation; trans.viewSkyWeight=viewFrom.skyWeight;
    }
    hub.warnCut(to);   // a tier this build cut that the target opens stays off, and is said so (once per engine)
    // The look on screen as the route starts, whole (as the carried routes keep it): the morph reads its continuous and canopy keys, and the
    // exposure blend the receiver its camera is chosen by (cameraFor reads sky_view and receiver, which are mode keys).
    const from = {...params};
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
    const floorPair = !params.sky_view && !to.sky_view && (params.receiver|0)===0 && (to.receiver|0)===0;
    trans.backgroundFade = !viewpoint && modeDiff && floorPair;
    trans.settleCamera = trans.backgroundFade && params.standing_scene && !to.standing_scene;
    trans.shadowFrom = shadowFrom;
    trans.shadowOpacity = shadowFrom;
    // Wood must meet zero at the mode swap when only one look has it: otherwise the woodless grove briefly
    // casts the other look's skeleton (an overhead trunk becomes a dot with radial limbs).
    trans.woodFade = modeDiff && ((params.branch_tau > 0) !== (to.branch_tau > 0));
    // THE REACH (grove_reach_m) is not tweened by name: 0 stands for the view, so a look and its zoomed copy are one grove under two values. Where either
    // end names one, the route goes by the span each end's trees are GROWN across (groveFill, the reach capped inside the bake): equal, and only the camera
    // moves, however far apart the two reaches are past the cap; different, and the grove is regrown along the reach like a canopy key (tickTransition).
    // Two looks that both follow their view are left as they were: a regrow in flight reads the tweening view.
    const reachOf = p => p.grove_reach_m > 0 ? p.grove_reach_m : p.view_extent_m;
    trans.reach = params.grove_reach_m > 0 || to.grove_reach_m > 0 ? [reachOf(params), reachOf(to)] : null;
    const canopyDiff = CANOPY_KEYS.some(k => to[k]!==params[k]) || !!trans.reach && groveFill(params)!==groveFill(to);   // branch/leaf knobs differ, or the span they grow across
    const leafCount  = hub.layerVAO.reduce((s,L)=>s+L.count, 0);       // current grove size
    const leavesFrom=hub.hier?.nLeaf??Math.ceil(params.leaves_per_cluster*params.foliage_density),leavesTo=Math.ceil(to.leaves_per_cluster*to.foliage_density);
    const targetClusters=Math.ceil(Math.max(1,to.tree_count))*to.limb_count*Math.max(1,to.branch_children)**Math.max(0,to.branch_levels-1);
    const carrierCount=Math.max(leafCount/Math.max(1,leavesFrom),targetClusters)*Math.max(leavesFrom,leavesTo);
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
    // Two faithful overhead looks that no live or grove morph joins would otherwise dissolve two finished pictures;
    // their leaves travel instead, as they do between the faithful and the layer cast.
    const faithfulStructural=params.faithful_canopy&&to.faithful_canopy&&!modeDiff
      &&(topoDiff||canopyDiff&&morphCost>CANOPY_MORPH_MAX);
    const leafTravel=retarget||(!styleFade&&!trans.active&&(params.faithful_canopy!==to.faithful_canopy||faithfulStructural)
      && !params.sky_view&&!to.sky_view&&!params.standing_scene&&!to.standing_scene
      && params.receiver===0&&to.receiver===0&&params.branch_tau===0&&to.branch_tau===0
      && params.canopy_fill===0&&to.canopy_fill===0&&params.litter===0&&to.litter===0
      && params.leaf_drop===0&&to.leaf_drop===0&&params.leaf_size_m>0&&to.leaf_size_m>0
      && params.edge_area===to.edge_area&&params.eclipse===to.eclipse
      && leafCount>0&&leavesTo>0&&carrierCount<=CANOPY_MORPH_MAX);
    if(leafTravel){trans.backgroundFade=false;trans.settleCamera=false;}
    // a mode flip can't morph leaf-for-leaf (the bake path / faithTex size / crown sizing change), so it forces a
    // dissolve+rebuild just like a topology change — never a live grove morph (which only regrows, no realloc).
    const morphGrove = !styleFade && canopyDiff && !topoDiff && !modeDiff && morphCost <= CANOPY_MORPH_MAX;   // same branching+mode, small enough -> morph it
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
    // THE CROSSFADE GATE (spec/model/transitions.md), v1 and deliberately narrow — every condition is something the crossfade cannot
    // yet do, not something it does badly:
    //  • a TOPOLOGY change, or a grove of the same branching too big to morph, and not a MODE flip — a camera swap has no second
    //    grove to blend, it has a second SCENE;
    //  • neither end faithful — that tier pre-integrates one grove into one texture, with nothing to blend against;
    //  • no WOOD at either end — the analytic occluder is one segment table, and this v1 crossfades LEAVES only.
    //    (The table is a texture since the packet before last and can hold two sets, so the wood crossfade is a
    //    real next step rather than a wish; until it exists, branch_tau > 0 keeps the honest cut.)
    //  • the two groves must share one set of layer textures, so their actual bake sizes have to match. Layer counts may
    //    differ: the route bakes and casts the larger count, each grove in its own bins (trans.layerRoute, below).
    // Anything outside the gate takes the paths it already took.
    const layersShared = layerBakeSize(to)===layerBakeSize(params);
    const canCrossfade = !styleFade && (topoDiff || canopyDiff) && !modeDiff && !morphGrove
                 && !faithfulOn() && !to.faithful_canopy
                 && !(params.branch_tau > 0) && !(to.branch_tau > 0)
                 && layersShared;
    // A moon in flight is not a scene the dissolve of finished pictures can hold (its outgoing scene would show the moon at rest), so it
    // takes the cloud dissolve and the moon carries on.
    // The lit-ground fade and the shared-layer crossfade blend shadows but leave one floor material on screen.
    // Dissolve the two scenes when a carpet would make the grove handoff visible.
    const carpet = p => p.litter>0 && p.leaf_drop>0;
    const carpetFade = !trans.active && floorPair && (trans.backgroundFade || canCrossfade)
      && !seasonTravel && !leafTravel && (carpet(params) || carpet(to));
    const sceneFade = styleFade || carpetFade
      || !seasonTravel && !leafTravel && !moonShown && (trans.structDiff || trans.route?.name==='sceneFade') && !modeDiff && faithfulOn() && to.faithful_canopy;
    const crossOK = canCrossfade && !sceneFade;
    // Each dissolving scene draws its own shadows, window and model from its own look: no shared fade of them applies.
    if(sceneFade){ trans.backgroundFade=false; trans.settleCamera=false; trans.windowFade=false; trans.splitFade=false; }
    if(sceneFade) trans.structDiff=true;   // an interruption still has two different visible scenes to dissolve
    const route = seasonTravel ? routes.seasonTravel : leafTravel ? routes.leafTravel : sceneFade ? routes.sceneFade : null;
    trans.glide = !route && !viewpoint && opts.camera === 'glide' && params.standing_scene && to.standing_scene && !params.sky_view && !to.sky_view
      && (params.receiver|0)===0 && (to.receiver|0)===0 && !trans.backgroundFade;   // THE GLIDE, above
    if(trans.route && trans.route!==route) trans.route.end();   // the route interrupted, when another takes over
    if(sceneFade) routes.sceneFade.begin();   // preserve the outgoing scene before params become the incoming look
    trans.route = route;
    // THE SEEN TREE fades, never switches. A look that sees its tree and one that does not share the grove, the shadow and the floor, so the route
    // runs as it would between the two framings alone (the camera glides, the shadow stays on the ground) while the tree's opacity moves from one
    // end's to the other's. tree_view is held on until landing; an interrupted fade starts from the opacity it shows. Two dissolving scenes keep
    // each its own tree.
    const treeShown = trans.active && trans.treeFade ? trans.treeOpacity : Number(seesTree(params)), treeTo = Number(seesTree(to));
    trans.treeFade = !sceneFade && treeShown !== treeTo;
    trans.treeFrom = treeShown; trans.treeTo = treeTo; trans.treeOpacity = treeShown;
    if(trans.treeFade && to.tree_view) params.tree_view = true;   // a tree fading in is drawn from the route's first frame
    // Feather zero removes the entire mask. Across that gate the hood keeps its own geometry and fades (irisRoute); the
    // dissolving scenes each keep their own.
    trans.iris = sceneFade ? null : irisRoute(params, to, irisShown);
    trans.irisOpacity = trans.iris ? trans.iris.from : 1;
    const tier = modeDiff ? 'mode' : crossOK ? 'cross' : 'dissolve';
    trans.crossfade = crossOK;
    // When low-angle colour fringes and a large change in sun height arrive together, give the shadows more time to turn over.
    const broadWindow = crossOK && floorPair && !params.standing_scene && !to.standing_scene
      && Math.abs(to.sun_elevation_deg-params.sun_elevation_deg)>=45 && Math.abs(to.chromatic_aberration-params.chromatic_aberration)>=4;
    trans.crossHalfW = broadWindow ? 0.4 : CROSS_HALF_W;
    trans.bloomMax = trans.backgroundFade || viewpoint || leafTravel || seasonTravel ? 0 : BLOOM_MAX[tier];
    trans.durScale = trans.structDiff ? DUR_SCALE[tier] : 1;
    if(hub.groveIn){ hub.freeGrove(hub.groveIn); hub.groveIn = null; }   // a transition interrupting a transition drops the half-faded grove
    hub.crossW = 0;
    if(crossOK) hub.groveIn = hub.buildTargetGrove(to);          // grow it NOW, at rest, while it is still invisible
    // BETWEEN LAYER COUNTS the route runs at the larger count: each layer's height moves from where it is shown to the incoming look's
    // own (the shorter array padded with its top layer), a layer the outgoing grove does not fill is allocated now and passes the light
    // whole, and the count comes down to the target's only at landing. A route that interrupts one keeps moving its heights from where they are.
    const travel = sceneFade || leafTravel || seasonTravel;
    trans.layerRoute = null;
    if(!travel && (layersShown || crossOK && to.layer_count!==params.layer_count)){
      const nFrom = params.layer_count, nTo = to.layer_count;
      trans.layerRoute = { from: layersShown ?? routeHeights(nFrom, params.canopy_base_height_m, params.canopy_thickness_m),
                           to: routeHeights(nTo, to.canopy_base_height_m, to.canopy_thickness_m), e: 0, nFrom, nTo };
      params.layer_count = Math.max(nFrom, nTo);
    }
    if(trans.layerRoute || layersShown) hub.sizeLayers(params.layer_count);
    // THE ECLIPSE GATE is crossed by the moon, never switched: `eclipse` is held on for the whole route and the moon moves between the
    // eclipsed look's own bite (x = 0) and clear of the whole source (x = 1), placed each frame by regenSource. An interrupted route's
    // moon starts the next from where it is shown, limb included, as an interrupted hood fade carries its opacity.
    const xTo = to.eclipse ? 0 : 1;
    trans.moon = null;
    if(!travel && (moonShown || params.eclipse!==to.eclipse)){
      const amount = to.eclipse ? to.eclipse_amount : moonShown ? moonShown.amount : params.eclipse_amount;
      let x = !moonShown ? 1 - xTo : moonShown.x;
      if(moonShown && amount!==moonShown.amount){   // a different bite: the same shown distance, placed on the new path (the source re-cut first, so it is this frame's)
        hub.regenSource(); if(hub.src.coreR > 0) x = moonX(hub.src.moonD/hub.src.coreR, amount, hub.src.moonClear);
      }
      trans.moon = { from: x, to: xTo, x, amount, soft: moonShown ? moonShown.soft : 0, softFrom: moonShown ? moonShown.soft : 0 };
      params.eclipse = true;
    }
    trans.from = from; trans.to = to;
    trans.dur = Math.max(1e-3, opts.duration!=null ? opts.duration : trans.dur);   // stays the CALLER's number: it is also the sticky default for a later duration-less call, so the mode-flip stretch is applied at the clock (tickTransition) and never compounded into it
    trans.bloomFrom = trans.active ? trans.bloom : 0;   // an interrupted bloom eases out of the next route from where it is
    trans.t = 0; trans.swapped = false; trans.bloom = trans.bloomFrom; trans.active = true;
    trans.onEnd = opts.onEnd || null;
    if(seasonTravel){trans.structDiff=true;trans.durScale=2;routes.seasonTravel.begin(to);}
    if(leafTravel){
      trans.structDiff=true;trans.durScale=retarget?turnScale:2;
      if(!retarget){
        routes.leafTravel.begin(to);
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

  // The keys a route holds until landing rather than snapping at its swap: the raised layer count, the eclipse while the moon moves, and the seen tree while it fades.
  const held = k => k==='layer_count' && !!trans.layerRoute || k==='eclipse' && !!trans.moon || k==='tree_view' && !!trans.treeFade;
  // A structural handoff gives each grove its own edge, including while both share the layer bake.
  const swaps = k => (k==='edge_softness' || !MORPH_SET.has(k)) && !held(k);

  function tickTransition(dt){
    if(!trans.active) return;
    const dur = trans.dur * trans.durScale;   // the tier's longer clock (see DUR_SCALE); scaled here, never into trans.dur, which stays the caller's sticky default
    trans.t = Math.min(1, trans.t + Math.min(dt,1/15)/dur);   // clamp the step like tick(): a tab-switch spike must not skip the bloom peak
    const t = trans.t, e = smoothstep(0,1,t);              // ease-in-out for the morph; raw t for the bloom hump
    if(trans.layerRoute) trans.layerRoute.e = e;
    if(trans.moon){
      // The moon's place eases with the route; its limb is soft while it moves and hard again at both ends of its path. The softness
      // runs on the raw clock (sin πt), so near either end it shrinks no faster than the eased moon slows: on the eased clock it would
      // close first and a sample still crossing the limb would switch in one frame. An interrupted route's softness eases out over the first half.
      const m = trans.moon;
      m.x = lerp(m.from, m.to, e);
      m.soft = Math.max(m.from!==m.to ? Math.sin(Math.PI*t) : 0, m.softFrom*(1 - smoothstep(0, 0.5, t)));
    }
    const route = trans.route;
    if(trans.viewpoint){
      for(let i=0;i<3;i++) trans.viewEye[i]=lerp(trans.viewFrom.eye[i],trans.viewTo.eye[i],e);
      trans.viewElevation=lerp(trans.viewFrom.elevation,trans.viewTo.elevation,e);
      trans.viewSkyWeight=lerp(trans.viewFrom.skyWeight,trans.viewTo.skyWeight,e);
    }
    // Carried from an interrupted route: its bloom eases out and its shadow opacity back to full over the first half.
    const carried = (trans.bloomFrom ?? 0)*(1 - smoothstep(0, 0.5, t));
    // The lit-ground fade passes through zero rather than resting there: the outgoing shadows hold and then fall steeply into the
    // midpoint, the incoming ones rise as steeply from it, so the bare floor, the swap's cover, is on screen for a breath and not for
    // the seconds a gentler curve spends with too little of either scene to see (LIT_GROUND_DIP is the power of each half's curve).
    const u = clamp((t - 0.5)/0.5, 0, 1), down = clamp(t/0.5, 0, 1);
    const fall = down**LIT_GROUND_DIP, rise = 1 - (1 - u)**LIT_GROUND_DIP;
    trans.shadowOpacity = trans.backgroundFade
      ? (t<0.5 ? lerp(trans.shadowFrom, 0, fall) : rise)
      : lerp(trans.shadowFrom ?? 1, 1, smoothstep(0, 0.5, t));
    // The exposure answers the light the fade lets onto the floor, as the reciprocal of the irradiance mix of a shade that passes
    // LIT_GROUND_HOLD of the beam: a ratio of two lines in the opacity, so the floor shown moves one way between an end and the
    // midpoint, never brighter than both (a straight lerp let the first half overshoot the bare floor). 1 wherever the shadows are
    // whole, and an interrupted fade's carried with its opacity.
    trans.exposureHold = 1/(1 + (1/LIT_GROUND_HOLD - 1)*(1 - trans.shadowOpacity));
    // A route the look does not morph under (the scene fade, the grove's and the litter's travels) steps in place of the morph.
    // Started from rest, the grove's and the litter's carry no bloom and no shadow fade: carried is 0 and the shadow opacity 1.
    if(route && !route.tweens){
      trans.bloom = carried;
      if(route.step(dt,t,e)===false) return giveUp(route);
      if(t<1) return null;
      return land(route);
    }
    // 0 at the ends, deepest at the midpoint — where the swap fires. Both structural tiers stop short of full
    // overcast (BLOOM_MAX): past their own depth the bloom stops dissolving anything and only blows the frame out.
    trans.bloom = Math.max(trans.structDiff ? Math.sin(Math.PI*t) * trans.bloomMax : 0, carried);
    trans.windowOpacity=lerp(trans.windowFrom, trans.windowTo, e);
    // The seen tree goes out over the first half, before the camera has swung far, and comes in over the second; through the lit
    // ground it goes and comes with its shadow, on the same steep curve.
    if(trans.treeFade) trans.treeOpacity=lerp(trans.treeFrom, trans.treeTo, trans.treeTo<trans.treeFrom
      ? (trans.backgroundFade ? fall : smoothstep(0,0.5,t)) : (trans.backgroundFade ? (t<0.5 ? 0 : rise) : smoothstep(0.5,1,t)));
    for(const k of MORPH_KEYS){ const a=trans.from[k], b=trans.to[k];
      if(k==='edge_softness' && trans.structDiff) continue;
      if((trans.viewpoint||route?.keepsDrift) && k==='drift_phase' && params.drift_auto) continue;
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
    if(trans.glide) Object.assign(params, glideCamera(trans.from, trans.to, t));
    if(trans.iris) trans.irisOpacity = irisStep(trans.iris, e, params);
    // Same receiver at both ends: the dapples travel straight from one end's level to the other's (beamExposure).
    // Leaf travel shows one field of dapples in a colour between the two looks. A per-channel tween between two hues has no
    // channel as bright as either end's, and a steep contrast then clamps every partial shadow to black, leaving round holes.
    // The hue still tweens; the ground's brightest channel moves straight from one end's to the other's.
    // Between two faithful groves (patch by patch) each picture is drawn with its own look's ground, so this blend is not shown there.
    if(route?.groundPeak){
      const peak=p=>Math.max(p.ground_r,p.ground_g,p.ground_b), now=peak(params);
      if(now>0){ const s=lerp(peak(trans.from),peak(trans.to),e)/now; params.ground_r*=s; params.ground_g*=s; params.ground_b*=s; }
    }
    // The exposure blends in the target's camera's law when the route lands on the floor or both ends stand on one camera; any other route is the
    // morph's plain tween. On the half of a route the floor camera draws, the dapples' level is exposure times the beam's factor, and the blend keeps
    // that product on a straight line between the two ends where a plain tween of both overshoots. The half drawn by the camera the route left is
    // blended in the same law, which is a stand-in.
    { const cam=cameraFor(trans.to); if(cam==='floor' || cam===cameraFor(trans.from)) params.exposure=beamExposure(cam,trans.from,trans.to,e,params); }
    if(trans.canopyMorph) for(const k of CANOPY_KEYS) params[k] = lerp(trans.from[k], trans.to[k], e);  // deform the SAME grove
    if(trans.canopyMorph && trans.reach) params.grove_reach_m = e>=1 ? trans.reach[1] : lerp(trans.reach[0], trans.reach[1], e);   // ...along the reach each end grows for: named while it moves (the landing writes the target's own value, which grows the same grove)
    let rebuilt = false, wake = null;
    // THE CROSSFADE WINDOW replaces the cut where it is gated on: coverage eases 0 -> 1 across [0.5-HW, 0.5+HW],
    // and the arrangement reorganizes instead of being replaced. The incoming grove is installed as the engine's
    // own once it carries the whole picture, which is also when the structural params can safely snap: nothing
    // reads them again until the next regrow.
    if(route){   // a route the look morphs under (season and leaf travel) steps after the morph
      if(route.step(dt,t,e)===false) return giveUp(route);
      if(t<1) return null;
      return land(route);
    }else if(trans.viewpoint){
      trans.swapped=t>=0.5;   // one grove remains in place through the horizon; its mode-specific state lands at the end
    } else if(trans.crossfade){
      const halfW=trans.crossHalfW;
      hub.crossW = smoothstep(0.5-halfW, 0.5+halfW, t);           // ease it, so the fade has no corners at either end
      if(!trans.swapped && hub.crossW >= 1){
        trans.swapped = true;
        for(const k in DEFAULTS) if(swaps(k)) params[k] = trans.to[k];
        hub.installGrove(hub.groveIn); hub.groveIn = null; hub.crossW = 0;   // it IS the grove now; nothing is faded any more
        if(trans.waiting) wake = queued(null);                        // a selection made inside the window starts from here
      }
    } else if(!trans.swapped && t>=0.5){                   // swap the grove once, hidden under the bloom peak
      trans.swapped = true;
      if(trans.structDiff){
        for(const k in DEFAULTS) if(swaps(k)) params[k] = trans.to[k];
        hub.rebuildAll(trans.to); rebuilt = true;            // regrow grove + textures + source + bake, all at once; the grove is the target's own
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
      // Not on the faithful landing frame: the landing below bakes the exact target, over this one, before anything reads it.
      if(!(t>=1 && faithfulOn()) && (trans.canopyMorph || hub.motionActive() || faithSunMorph || woodFade || (trans.crossfade && trans.active))) hub.bake();
    }
    if(t>=1){                                              // land exactly on the target; clear the bloom
      const drift=params.drift_phase;
      trans.active = false; trans.bloom = 0; trans.treeFade = false;
      for(const k in DEFAULTS) params[k] = trans.to[k];
      if(trans.layerRoute){ hub.sizeLayers(params.layer_count); trans.layerRoute = null; }
      trans.moon = null;
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

  // A long route lands: a route the look morphs under sets the live look to the target (keeping the wind's drift where it
  // keeps it) before its finish installs the end it lands on; then it is ended, and what it owes the landed look is run.
  // The state is not returned to rest: t, the swap, the bloom and the opacities stay what the last frame showed.
  function land(route){
    if(route.tweens){
      const drift=params.drift_phase;
      for(const k in DEFAULTS)params[k]=trans.to[k];
      if(route.keepsDrift&&params.drift_auto)params.drift_phase=drift;
    }
    const pending=route.finish?.();
    trans.active=false;trans.route=null;
    if(route.swaps)trans.swapped=true;
    route.end();
    for(const k of route.landing)hub[k]?.();
    const cb=trans.onEnd;trans.onEnd=null;
    return queued(pending?()=>hub.transitionTo(pending.to,pending.opts):cb);   // a waiting selection still beats the route's pending one
  }
  // A route that gives up mid-flight (its step returned false, having put the look it left back in place) dissolves to the
  // same target from rest, keeping the caller's completion unless a selection waits.
  function giveUp(route){
    const {to,dur,onEnd,waiting}=trans,pending=route.finish?.();
    route.end();trans.active=false;trans.route=null;
    transitionTo(to,{duration:dur,style:'fade',onEnd});
    trans.waiting=waiting??pending;
    if(trans.waiting)trans.onEnd=null;
    return null;
  }

  // A hard swap of the look (setParams): the running route is ended, a half-faded incoming grove freed, and the state returns
  // to rest, so nothing of the route outlives the swap.
  function abortTransition(){
    if(!trans.active) return;
    trans.route?.end();
    if(hub.groveIn){ hub.freeGrove(hub.groveIn); hub.groveIn = null; }
    hub.crossW = 0;
    toRest();
  }
  // The context is lost: every route is ended (its GL died with the context) and none runs. What is owed survives for the
  // restore to land on: a route's pending selection, or a waiting one, with its completion.
  function loseContext(){
    for(const route of Object.values(hub.routes)){
      const pending=route.end();
      if(pending){trans.to=pending.to;trans.onEnd=pending.opts?.onEnd??null;}
    }
    if(trans.waiting){trans.to=trans.waiting.to;trans.onEnd=trans.waiting.opts?.onEnd??null;trans.waiting=null;}
    trans.route=null;
  }
  // The context is back: a route that was running lands on its target rather than resuming half-faded. Returns the
  // completion owed, for the caller to run once the engine has its loop again.
  function restoreContext(){
    if(!trans.active) return null;
    const to=trans.to, cb=trans.onEnd;
    toRest();
    for(const k in DEFAULTS) params[k] = to[k];
    hub.arrived(to);
    return cb;
  }
  // The engine is disposed: every route releases what it holds.
  function endRoutes(){ for(const route of Object.values(hub.routes)) route.end(); }

  return { transitionTo, tickTransition, abortTransition, loseContext, restoreContext, endRoutes };
}
