// ============================================================================
// The routes between looks as entries (spec/implementation.md, "Transitions as a registry"): what a long route is to the
// lifecycle in komorebi-transitions.js, the transition state at rest, and the helpers more than one route uses. Pure: no GL,
// no engine state. The route modules and komorebi-transitions.js import this one, never the reverse.
// ============================================================================
import { clamp, lerp, smoothstep } from '../komorebi-math.js';

// A ROUTE ENTRY. Each long route's module returns one object, built over the engine's hub; the engine keeps them as
// hub.routes, by name, and trans.route is the one running (null when none is). Nothing but the entry and the chooser
// (komorebi-transitions.js › transitionTo) names a route.
//
//   name             'sceneFade' | 'leafTravel' | 'seasonTravel' | 'litterRise' | 'groveTravel'
//   begin(to, …)     prepares the route from the look on screen. Its arguments and its return are the chooser's: a route that
//                    can decline returns false, and has then released whatever it prepared.
//   retarget(to, o)  a selection made while it runs: it reverses toward one of its own ends, or keeps the selection pending
//                    for its landing. Absent on a route the chooser never retargets (the scene fade: a selection waits).
//   step(dt, t, e)   one frame of the route: dt the frame's seconds, t its clock, e = smoothstep(0, 1, t). Returning false
//                    gives the route up; it then lands as a scene fade to the same target.
//   draw()           the frame onto the canvas, in place of the engine's own transport.
//   finish()         at landing, before the route is ended: puts the look it lands on in place; returns the selection it kept
//                    pending, if any. Absent on a route with nothing to do there.
//   end()            releases everything the route holds and returns its pending selection. Safe while idle and twice.
//
// Its policy, read by the lifecycle instead of the route's name (each absent or false unless said):
//   ownsWind         the route advances the wind itself, so the frame does not tick it.
//   hostBakes        the host's canopy is baked under the route on a moving frame.
//   tweens           the look's live keys morph under the route: its step runs after the morph rather than instead of it, and
//                    at landing the live look is set to the target before finish.
//   keepsDrift       the morph, and that landing, leave drift_phase to the wind while drift_auto.
//   groundPeak       the ground's brightest channel moves straight between the ends' while the hue tweens (one field of
//                    dapples in a colour between two looks).
//   swaps            the route lands showing the target's own picture: trans.swapped is true after it.
//   landing          the hub's coordinators run, in this order, once the route is ended: what it still owes the landed look.
//
// A route a bundle cut is cutRoute(name): its gate is cut with it, so nothing but end() is ever reached.
export const cutRoute = name => ({ name, end(){} });

// THE TRANSITION STATE AT REST: every field trans has, at the value under which every reader behaves as "no route running".
// The engine starts from it, so does every hub a route builds; a route started from idle starts from it, and an abort and a
// restored context return to it. Only `dur` is carried over those: it is the caller's sticky default.
export function restTrans(){
  return {
    // The clock and its bookkeeping.
    active: false,     // a route runs; the guard most readers stand behind
    t: 0,              // its clock, 0 → 1
    dur: 1.5,          // the caller's duration (s); a later call without one reuses it
    durScale: 1,       // the tier's longer clock (DUR_SCALE); scaled at the tick, never into dur
    from: null,        // the look the route left
    to: null,          // the look it lands on
    swapped: false,    // the structural swap has happened (the grove, the scene, the half of a viewpoint)
    onEnd: null,       // the caller's completion, handed back at landing
    waiting: null,     // a selection that waits for this route's settled frame: { to, opts }
    structDiff: false, // the route rebuilds the grove (or dissolves two scenes) rather than morphing it
    route: null,       // the running long route's entry (komorebi-routes.js), or null
    // The litter rise's flavour: footprints rising, the carpet falling, footprints falling.
    shadowRise: false, litterFall: false, shadowFall: false,
    // The bloom: the overcast that hides a swap.
    bloom: 0,          // read whether or not a route runs (effCloud, regenSource)
    bloomMax: 1,       // this tier's depth (BLOOM_MAX)
    bloomFrom: 0,      // an interrupted route's bloom, eased out of the next
    // The crossfade window between two groves.
    crossfade: false,
    // The canopy morph: one grove deformed, re-seasoned or re-weighted, along the reach each end grows for.
    canopyMorph: false, seasonMorph: false, densityMorph: false, reach: null,
    // The fade through the lit ground: the shadows' opacity, and the camera set at its invisible midpoint.
    backgroundFade: false, settleCamera: false, shadowFrom: 1, shadowOpacity: 1, exposureHold: 1,
    // The wood meeting zero at a mode swap, and leaf_diffuse's proxy split meeting zero light.
    woodFade: false, splitFade: false,
    // The viewpoint: the eye moving through the horizon.
    viewpoint: false, viewInterrupted: false, viewFrom: null, viewTo: null, viewEye: null, viewElevation: 0, viewSkyWeight: 0,
    // The window aperture across its zero gate.
    windowFade: false, windowFrom: 1, windowTo: 1, windowOpacity: 1, windowShape: null,
    // The seen tree fading in or out.
    treeFade: false, treeFrom: 1, treeTo: 1, treeOpacity: 1,
    glide: false,      // a standing camera's live morph moving the eye, not the gauges (komorebi-transitions.js, THE GLIDE)
    // The hood across its gate (irisRoute).
    iris: null, irisOpacity: 1,
    // The moon across the eclipse gate, and the layer heights between two layer counts.
    moon: null, layerRoute: null,
    // The draw modifiers komorebi-render.js and komorebi-tree-view.js read off a scene's trans, some whether or not a route runs.
    travelField: null, // a moving cast's transmission map, which the floor reads in place of the faithful cast's
    travelTone: null,  // the tone-curve weights a moving picture is finished with; null reads as none
    riseField: null,   // the litter flight's eye targets and atlas
    castHeld: false,   // a route holds the faithful cast: the frame neither refreshes it nor stands it up as the seen tree
  };
}

// A travel route turning back mid-flight (spec: reversal keeps progress): like walking home for a forgotten wallet.
// The momentum it had is spent first, an even deceleration over a tenth of a second that carries it on just past the
// press (never more than half the way left to the far end, which would otherwise be a landing), then it eases home
// and settles at rest. The
// farther out it was, the longer the way back, up to a whole route: half a route for a turn at the start, a whole
// route from halfway on. Progress p and its velocity v (per second) stay continuous; `full` is a whole route in
// seconds. Already heading for `to` (a second turn caught mid-deceleration), it eases there from its current velocity,
// capped where the cubic would overshoot `to`.
export const turnBack = (p, v, to, full) => {
  const T = full*Math.min(1, 0.5 + Math.abs(to-p)), dir = Math.sign(to-p) || 1;
  if(v*dir >= 0){
    const m0 = dir*Math.min(Math.abs(v)*T, 3*Math.abs(to-p));
    return { T,
      at: u => clamp((2*u*u*u-3*u*u+1)*p + (u*u*u-2*u*u+u)*m0 + (3*u*u-2*u*u*u)*to, 0, 1),
      rate: u => ((6*u*u-6*u)*p + (3*u*u-4*u+1)*m0 + (6*u-6*u*u)*to)/T };
  }
  const td = Math.min(0.1, T/2, Math.abs(1-to-p)/Math.abs(v)), turn = p + v*td/2, back = T - td;
  return { T,
    at: u => { const s = u*T; return s < td ? p + v*s - v*s*s/(2*td) : lerp(turn, to, smoothstep(0, back, s-td)); },
    rate: u => { const s = u*T; if(s < td) return v*(1 - s/td); const x = (s-td)/back; return (to-turn)*6*x*(1-x)/back; } };
};

// THE IRIS GATE (spec/model/transitions.md), one rule for every route that crosses it: when only one end has a hood, no boundary moves. The
// hood keeps that end's own feather and shape for the whole route and its opacity runs between 0 and 1. `shown` is
// the opacity an interrupted fade shows, where the next route starts. Null when nothing fades: two hooded ends morph
// their feather and shape at full opacity, two bare ends have no mask.
export function irisRoute(a, b, shown = null) {
  const on = a.vignette > 0, to = Number(b.vignette > 0), from = shown ?? Number(on);
  if (from === to) return null;
  const end = on === (b.vignette > 0) ? null : on ? a : b;
  return { from, to, shape: end && { vignette: end.vignette, vignette_shape: end.vignette_shape } };
}
// One step at the route's eased progress e: holds the hooded end's geometry in p, returns the opacity to draw with.
export function irisStep(route, e, p) {
  if (route.shape) Object.assign(p, route.shape);
  return lerp(route.from, route.to, e);
}
