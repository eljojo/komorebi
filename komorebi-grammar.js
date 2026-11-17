// ============================================================================
// The grammar — pure functions, no GL, no engine state. A tree's skeleton grown from a spec and a stream (spec/model/canopy.md): trunk, limb, branch and
// twig by one recursive rule (growSkeleton), and the direction helpers it turns a child by. buildGrove (komorebi-grove.js) calls it; the year-by-year growth
// (komorebi-growth.js) shares its droop (bendDown).
// ============================================================================
import { GOLDEN, TAU, clamp } from './komorebi-math.js';

// ---- skeleton growth (spec/model/canopy.md): grow real 3D branch segments from a seed ----
function normalize3(v){ const m=Math.hypot(v[0],v[1],v[2])||1e-9; return [v[0]/m, v[1]/m, v[2]/m]; }
// a child direction deviating from unit parent dir `d` by `spread` radians, at azimuth `az`
// around d (in the plane perpendicular to it). Builds an orthonormal basis around d.
function coneDir(d, az, spread){
  const up = Math.abs(d[2])>0.9 ? [1,0,0] : [0,0,1];
  const s = normalize3([ d[1]*up[2]-d[2]*up[1], d[2]*up[0]-d[0]*up[2], d[0]*up[1]-d[1]*up[0] ]); // ⟂ d
  const u = [ d[1]*s[2]-d[2]*s[1], d[2]*s[0]-d[0]*s[2], d[0]*s[1]-d[1]*s[0] ];                   // ⟂ d,s
  const cs=Math.cos(spread), sn=Math.sin(spread), ca=Math.cos(az), sa=Math.sin(az);
  return normalize3([ cs*d[0]+sn*(ca*s[0]+sa*u[0]),
                      cs*d[1]+sn*(ca*s[1]+sa*u[1]),
                      cs*d[2]+sn*(ca*s[2]+sa*u[2]) ]);
}
// tilt a unit direction toward straight-down (−z) by `dth` rad, IN ITS OWN VERTICAL PLANE (azimuth fixed) — the
// gravitropic droop of a branch (spec/model/canopy.md). dth<0 lifts it (upsweep). Guards a ~vertical heading (no plane to droop in).
function bendDown(dir, dth){
  const horiz = Math.hypot(dir[0], dir[1]);
  if(horiz < 1e-4) return dir;
  const a = clamp(Math.atan2(dir[2], horiz) - dth, -Math.PI*0.5, Math.PI*0.5);
  const ca = Math.cos(a);
  return [ ca*dir[0]/horiz, ca*dir[1]/horiz, Math.sin(a) ];
}
// coneDir restricted to the plane z = 0, for an in-plane unit `d`: the cone's offset along the in-plane perpendicular
// (sin·cos az) is kept and the part along z (sin·sin az) is dropped, so az 0 and π fork to opposite sides and az π/2 holds
// the heading. Same side as coneDir's own s axis; always unit, so the zero-length projection coneDir would need a guard
// for (spread π/2 at az π/2) is simply no turn.
function coneDirPlane(d, az, spread){
  const m = Math.hypot(d[0], d[1]) || 1e-9, hx = d[0]/m, hy = d[1]/m;
  const dl = Math.atan2(Math.sin(spread)*Math.cos(az), Math.cos(spread));
  const c = Math.cos(dl), s = Math.sin(dl);
  return [ c*hx + s*hy, c*hy - s*hx, 0 ];
}

// ---- THE GRAMMAR (spec/model/canopy.md): a skeleton grown from a spec, a stream and an `out` — trunk, limb, branch, twig by one
// recursive rule — a function and not a closure, pure and testable on its own.
// The caller owns `out` ({ seg:[], tw:[] }) and may grow many roots into one: a twig's index is the count in `out.tw` before
// it, which the segments of its own wood carry (`tw`, -1 for wood that bears nothing) so the faithful bake swings them about
// the twig's joint (spec/model/motion.md). Pure: nothing is read but the arguments, nothing written but `out`. THE STREAM IS THE CONTRACT —
// three draws per child, in the order azimuth, spread, length; reorder one and every grove there is regrows differently.
// spec: levels (depth; level >= levels bears a twig), kids (children per node; `opposite` is always 2), lenRatio, coneA
// (the child cone's half-angle), droop (signed gravitropic curve, spec/model/canopy.md), phyllo (0 spiral / 1 whorled / 2 opposite),
// leader (monopodial: the spiral steps by the golden angle), and the root: base, dir (unit), len, level, limb.
// plane: a flat 2-D sheet — every z is 0, no droop, children turn by coneDirPlane. The draws are the same, so a plane
// run is the same topology as the 3-D one. No engine caller: it was meant for the leaf's veins, which grow by growLeaf
// instead (komorebi-leaf.js says why); skeleton.test.js holds what it promises.
// THE PATH (`out.path`, optional): a caller that hands an array here gets, parallel to out.tw (the same index), each twig's ancestors — every joint from the twig's tip back to where its limb meets the
// trunk axis (the root's base), droop sub-segment joints included so the path follows the curve — as a list of the very point arrays the segments hold, tip first. It is a PARALLEL structure and
// not a key of the twig record, because skeleton.test.js digests every key of every record; and it draws nothing from the stream. A caller that hands none grows exactly what it grew before; the plane
// mode, which has no trunk to run back to, passes no chain even when one is asked for.
function growSkeleton(spec, rng, out){
  const { base, dir, len, level, limb, plane } = spec;
  if(!plane){ growNode(spec, rng, out, base, dir, len, level, limb, out.path ? [base] : undefined); return; }
  const m = Math.hypot(dir[0], dir[1]) || 1e-9;
  growNode(spec, rng, out, [base[0], base[1], 0], [dir[0]/m, dir[1]/m, 0], len, level, limb);
}
// `chain`: the joints from the root's base to this branch's base, inclusive, or undefined when no path is being collected (see growSkeleton)
function growNode(g, rng, out, base, dir, len, level, limb, chain){
  const { levels, plane } = g;
  // index the twig this call will bear, if it is a terminal one — the segments pushed below are that twig's
  // OWN wood, and the faithful bake must swing them about the same joint, by the same angle, as its leaves (spec/model/motion.md).
  const twIdx = (level >= levels) ? out.tw.length : -1;
  // droop/upsweep (spec/model/canopy.md): curve the branch toward gravity over a few SUB-SEGMENTS — a smooth arc, not a
  // straight ray and not a single kink. Stronger on outer orders (level/levels), and children inherit the
  // curved END-TANGENT, so the sag compounds toward the tips (the willow cascade / birch trail). 0 = straight.
  const dLevel = plane ? 0 : g.droop * (level/levels);
  let tip, endDir = dir;
  const joints = chain ? [] : null;   // the joints this branch adds past its base: every sub-segment's end, or just the tip
  if(Math.abs(dLevel) > 1e-3){
    // rounded by hand, not by Math.round: at a tie like 0.15·(2/3)·5 = 0.49999999999999994 (canopy 3's level 2) JavaScriptCore's Math.round answers 0 cold
    // and 1 once it has JITted this function — the same params, another grove after a few regrows. x − floor(x) is exact, so this is V8's answer everywhere.
    const x = Math.abs(dLevel)*5, fl = Math.floor(x);
    const nSub = Math.min(6, 1 + fl + (x - fl >= 0.5 ? 1 : 0));
    const dl = len/nSub, dth = dLevel*1.9/nSub;        // total curve ≈ dLevel·1.9 rad over the branch length
    let p = base, d = dir;
    for(let sx=0;sx<nSub;sx++){
      d = bendDown(d, dth);                            // tilt the heading toward −z (down) in its own vertical plane
      const np = [ p[0]+d[0]*dl, p[1]+d[1]*dl, p[2]+d[2]*dl ];
      // f0/f1 = this sub-segment's fractional span of the ONE level→level+1 taper step, so the faithful skeleton
      // thins SMOOTHLY along a drooping branch instead of resetting the full step per sub-segment (a sawtooth).
      out.seg.push({ a:p, b:np, level, limb, f0:sx/nSub, f1:(sx+1)/nSub, tw:twIdx });
      if(joints) joints.push(np);
      p = np;
    }
    tip = p; endDir = d;
  } else {
    tip = [ base[0]+dir[0]*len, base[1]+dir[1]*len, base[2]+dir[2]*len ];
    out.seg.push({ a:base, b:tip, level, limb, f0:0, f1:1, tw:twIdx });   // straight branch: full step (byte-identical)
    if(joints) joints.push(tip);
  }
  const here = chain ? chain.concat(joints) : undefined;   // root-first: the trunk end of the wood, then every joint out to this branch's tip
  // bx,by = the twig's REAL base: where this terminal branch attaches to its parent. It is the joint the whole
  // twig (wood + the leaves on it) turns about under the medium band, and — being offset from the clump toward
  // the parent by GROWTH — it is a genuine stem joint, so spec/model/motion.md's anti-vortex property holds without uStemLen.
  if(level >= levels){
    out.tw.push({ x:tip[0], y:tip[1], z:tip[2], limb, dx:endDir[0], dy:endDir[1], bx:base[0], by:base[1] });   // dx,dy = twig heading (plan) so leaves can hug the twig, not scatter as a blob
    if(here) out.path.push(here.reverse());   // tip first (here is this twig's own list, concatenated: the chain its parents hold is untouched)
    return;
  }
  // phyllotaxis (spec/model/canopy.md): how children fan around the parent. opposite forces PAIRED forks; whorled an even ring; spiral the golden angle.
  const { phyllo, coneA, lenRatio, leader } = g;
  const nKids = (phyllo===2) ? 2 : g.kids;
  for(let c=0;c<nKids;c++){
    let az, spread;
    if(phyllo===2){       az = level*1.5707963 + c*Math.PI + (rng()-0.5)*0.08;  spread = coneA*(0.9+0.12*rng()); }   // opposite/decussate: a symmetric Y, plane flipped 90° each level
    else if(phyllo===1){  az = (c+0.5)/nKids*TAU + (rng()-0.5)*0.15;           spread = coneA*(0.7+0.5*rng()); }   // whorled: even ring (conifer tiers)
    else {                az = (leader ? c*GOLDEN : (c+0.5)/nKids*TAU) + (rng()-0.5)*(leader?0.4:1.2); spread = coneA*(0.55+0.9*rng()); }   // spiral / legacy fan
    growNode(g, rng, out, tip, (plane ? coneDirPlane : coneDir)(endDir, az, spread), len*lenRatio*(0.8+0.4*rng()), level+1, limb, here);
  }
}


export { growSkeleton, coneDir, coneDirPlane, bendDown };
