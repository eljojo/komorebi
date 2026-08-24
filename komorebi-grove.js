// ============================================================================
// The Canopy, grown (spec §4.5) — buildGrove: a grove of recursive trees
// (leader, droop, taper, phyllotaxis), leaves hung on terminal twigs and
// binned to depth layers, the woody occluder segments, the faithful-path
// geometry, and the per-clump data textures — allocated and RETURNED as one
// grove value (installGrove, in the engine, makes one active). A factory over
// the engine's shared internals (hub).
// ============================================================================
import { DEG, FAITH_MAX_RATIO, bendDown, clamp, coneDir, hash3, makeGauss, mulberry32 } from './komorebi-math.js';
import { MAX_OCC } from './komorebi-params.js';

export function makeGrove(hub){
  const { gl, params, MAX_TEX, quadBuf, faithfulOn, occ, faith, sky } = hub;

  // ---- canopy generation: grow a real recursive skeleton, hang one leaf cluster on each
  // terminal twig, and bin them into depth layers by the height they grew to (spec §4.5) ----
  // ---- BUILD A GROVE (spec §4.5/§9). Pure in the sense that matters: it allocates and returns a grove, it does
  // not install one. That is what lets a transition hold TWO — the outgoing one still drawing while the incoming
  // one is grown — instead of the midpoint swap being the only way a topology change can happen.
  // (occ and faith are still written straight to engine state below. They belong to the ACTIVE grove, and the
  // crossfade's gate excludes both of their consumers — wood needs branch_tau > 0, faith needs faithfulOn() —
  // so a second grove never needs its own copy of either. If that gate ever widens, they move in here too.)
  function buildGrove(prevHier){
    const layerVAO = [];   // this grove's own; the OUTGOING grove's GL objects are freed by installGrove, not here
    const E = params.canopy_extent_m;
    const tau = [
      -Math.log(clamp(params.trans_r,1e-4,0.999)),
      -Math.log(clamp(params.trans_g,1e-4,0.999)),
      -Math.log(clamp(params.trans_b,1e-4,0.999)),
    ];
    const pcF = Math.max(0, params.leaves_per_cluster*params.foliage_density);
    const pcInt = Math.floor(pcF);
    const frac = pcF - pcInt;                         // marginal leaf fades in by this
    const nLeaf = pcInt + (frac>1e-4 ? 1 : 0);
    const TAU2 = Math.PI*2;

    // ---- grow a GROVE: tree_count trees whose trunks spread across the view region with overlapping
    // crowns. Each tree is a trunk -> limb_count arms (rising by branch_pitch, fanned around the
    // circle) -> branch_children sub-branches per node (cone-fanned, shrunk by branch_length_ratio)
    // recursing branch_levels deep; TERMINAL branches are twigs, each carrying one leaf cluster. Big
    // gaps fall between limbs, small gaps between leaves — multi-scale, for free (spec §4.5). A grove
    // (not one centred tree) fills the centre and matches the park: several trees, the smaller ones
    // reading denser (the same cluster packed into a smaller crown). ----
    // tree_count is CONTINUOUS so a tree-count transition can morph (spec §4.5/§9): floor(count) full trees
    // plus a marginal tree faded in by the fraction. At an integer count it's exactly floor trees, no partial.
    const treeCountF = Math.max(1, params.tree_count);
    const nFull  = Math.floor(treeCountF);
    const tFrac  = treeCountF - nFull;                  // marginal-tree coverage; 0 at integer counts
    const nTree  = nFull + (tFrac>1e-4 ? 1 : 0);        // trees actually built this frame
    const lpt    = Math.max(1, params.limb_count|0);   // limbs per tree
    const levels = Math.max(1, params.branch_levels|0);
    const kids   = Math.max(1, params.branch_children|0);
    const lenRatio = clamp(params.branch_length_ratio, 0.2, 0.95);
    const coneA  = params.branch_angle_deg*DEG;
    const limbEl = params.branch_pitch_deg*DEG;        // how steeply limbs rise from horizontal
    const nLimb  = nTree*lpt;                           // global limb count
    const gr = mulberry32(hash3(params.seed>>>0, 0x5EED, 7));   // growth stream (own RNG)
    const segments = [];     // {a,b,level} world-space skeleton, kept for the 3D view ([3])
    const twigs = [];        // terminal nodes: {x,y,z, limb, tx,ty} — plan x,y, height z, global limb, tree trunk
    const limbDir  = new Float32Array(nLimb*2);         // plan unit direction (drives wind torque)
    const limbPlan = new Float32Array(nLimb*2);         // an outboard wind-sample point near each limb
    const limbAttach = new Float32Array(nLimb);         // the height at which each limb MEETS its trunk — sway_pitch anchors its depth-foreshorten here so the join can't open (§5.1). Filled LOCAL in the growth loops, then scaled into world height units with the rest of the tree.

    // crowns overlap so the canopy fills the VIEW (not just the baked extent): the fill radius is tied
    // to view_extent (so the grove fills the frame regardless of zoom), capped to fit inside the bake.
    const golden = Math.PI*(3 - Math.sqrt(5));
    const Rfill = Math.min(E*0.46, Math.max(0.5, params.view_extent_m));
    // crown radius. PARK model: tied to the view so crowns fill the frame. STANDING scene (§4.8): a natural,
    // fixed fraction of the bake extent instead — so a single tree's crown fits the texture (the view-tied size
    // overflows and clips it) and the tree reads as a discrete object, not a frame-filling canopy.
    const crown0 = params.standing_scene ? E*0.26 : (Rfill/Math.sqrt(treeCountF))*1.7;
    const trunkH = crown0*0.6;                          // a real trunk lifts each crown off the ground.
    // It's a CONSTANT (same for every tree), so it only offsets z uniformly — the relative layer-binding
    // below is unchanged, i.e. the cast dapples are untouched; only the 3D structure/preview gains height.

    const L = clamp(params.leader_strength, 0, 1);   // 0 = legacy single-hub; >0 = monopodial leader (limbs ALONG a trunk)
    const droop = clamp(params.droop, -1, 1);        // signed gravitropic curve: >0 sag down (willow/birch), <0 upsweep (conifer); 0 = straight rays
    const phyllo = params.phyllotaxis==='opposite' ? 2 : params.phyllotaxis==='whorled' ? 1 : 0;   // child-azimuth rule (§4.5)

    function grow(out, base, dir, len, level, limb){
      // index the twig this call will bear, if it is a terminal one — the segments pushed below are that twig's
      // OWN wood, and the faithful bake must swing them about the same joint, by the same angle, as its leaves (§5.4).
      const twIdx = (level >= levels) ? out.tw.length : -1;
      // droop/upsweep (spec §4.5): curve the branch toward gravity over a few SUB-SEGMENTS — a smooth arc, not a
      // straight ray and not a single kink. Stronger on outer orders (level/levels), and children inherit the
      // curved END-TANGENT, so the sag compounds toward the tips (the willow cascade / birch trail). 0 = straight.
      const dLevel = droop * (level/levels);
      let tip, endDir = dir;
      if(Math.abs(dLevel) > 1e-3){
        const nSub = Math.min(6, 1 + Math.round(Math.abs(dLevel)*5));
        const dl = len/nSub, dth = dLevel*1.9/nSub;        // total curve ≈ dLevel·1.9 rad over the branch length
        let p = base, d = dir;
        for(let sx=0;sx<nSub;sx++){
          d = bendDown(d, dth);                            // tilt the heading toward −z (down) in its own vertical plane
          const np = [ p[0]+d[0]*dl, p[1]+d[1]*dl, p[2]+d[2]*dl ];
          // f0/f1 = this sub-segment's fractional span of the ONE level→level+1 taper step, so the faithful skeleton
          // thins SMOOTHLY along a drooping branch instead of resetting the full step per sub-segment (a sawtooth).
          out.seg.push({ a:p, b:np, level, limb, f0:sx/nSub, f1:(sx+1)/nSub, tw:twIdx });
          p = np;
        }
        tip = p; endDir = d;
      } else {
        tip = [ base[0]+dir[0]*len, base[1]+dir[1]*len, base[2]+dir[2]*len ];
        out.seg.push({ a:base, b:tip, level, limb, f0:0, f1:1, tw:twIdx });   // straight branch: full step (byte-identical)
      }
      // bx,by = the twig's REAL base: where this terminal branch attaches to its parent. It is the joint the whole
      // twig (wood + the leaves on it) turns about under the medium band, and — being offset from the clump toward
      // the parent by GROWTH — it is a genuine stem joint, so §5.1's anti-vortex property holds without uStemLen.
      if(level >= levels){ out.tw.push({ x:tip[0], y:tip[1], z:tip[2], limb, dx:endDir[0], dy:endDir[1], bx:base[0], by:base[1] }); return; }   // dx,dy = twig heading (plan) so leaves can hug the twig, not scatter as a blob
      // phyllotaxis (§4.5): how children fan around the parent. opposite forces PAIRED forks; whorled an even ring; spiral the golden angle.
      const nKids = (phyllo===2) ? 2 : kids;
      for(let c=0;c<nKids;c++){
        let az, spread;
        if(phyllo===2){       az = level*1.5707963 + c*Math.PI + (gr()-0.5)*0.08;  spread = coneA*(0.9+0.12*gr()); }   // opposite/decussate: a symmetric Y, plane flipped 90° each level
        else if(phyllo===1){  az = (c+0.5)/nKids*TAU2 + (gr()-0.5)*0.15;           spread = coneA*(0.7+0.5*gr()); }   // whorled: even ring (conifer tiers)
        else {                az = (L>0 ? c*golden : (c+0.5)/nKids*TAU2) + (gr()-0.5)*(L>0?0.4:1.2); spread = coneA*(0.55+0.9*gr()); }   // spiral / legacy fan
        grow(out, tip, coneDir(endDir, az, spread), len*lenRatio*(0.8+0.4*gr()), level+1, limb);
      }
    }

    for(let tt=0;tt<nTree;tt++){
      // trunk placement: Vogel disk so trees spread evenly; the first tree sits at the centre.
      const treeCov = (tt===nFull) ? tFrac : 1.0;        // the marginal tree fades in by coverage (1 for full trees)
      const rr = Rfill*Math.sqrt(tt/treeCountF);         // normalise by the continuous count -> trees re-space smoothly as it morphs
      const aa = tt*golden + (gr()-0.5)*0.6;
      const tx = rr*Math.cos(aa), ty = rr*Math.sin(aa);
      const crown = crown0*(0.7+0.6*gr());               // per-tree size variation (smaller -> denser)
      const out = { seg:[], tw:[] };
      const limbBase = tt*lpt, limbRaw = new Float32Array(lpt*2);
      let leaderTop = 0, limbTop = 0;   // limbTop = highest limb-attach height (local); the trunk must at least reach it
      if(L>0){
        // MONOPODIAL (spec §4.5): limbs attach at staggered heights ALONG a continuing trunk axis (plan-centre),
        // so the branches actually MEET the trunk. leader_strength sends the origins UP the bole and shortens
        // limbs toward the top (acrotony → excurrent cone); low values keep them low (a few near-base forks →
        // decurrent dome). This replaces the single-origin hub AND the de-dandelion hack with the real mechanism.
        const boleH = 0.8;                               // BARE BOLE below the crown (local units) — a real trunk, so the tree isn't foliage-to-the-ground (a bush)
        const hLo = boleH, hHi = boleH + (1.0 + 0.6*L);  // crown band sits ABOVE the bole; taller for a stronger leader
        limbTop = hHi;                                   // the topmost limb attaches near hHi — the trunk must reach here
        for(let i=0;i<lpt;i++){
          const gi = limbBase+i;
          const f = (i+0.5)/lpt;                         // 0..1 up the limb set
          const h = hLo + (hHi-hLo)*f;                   // attach height ON the trunk axis, above the bole
          limbAttach[gi] = h;                            // (local; scaled below)
          const azGeo = i*golden + (gr()-0.5)*0.3;       // phyllotaxis spiral (geometry)
          const pitch = limbEl*(1 + 0.4*L*f);            // steeper toward the apex → a tighter cone
          const ce = Math.cos(pitch), se = Math.sin(pitch);
          const len = (0.4+0.2*gr())*(1 - 0.45*L*f);     // limbs SHORTER than the crown is tall → narrow crown on a tall trunk, not a bush; acrotony shortens toward the apex
          const dir = [ce*Math.cos(azGeo), ce*Math.sin(azGeo), se];
          // wind torque rides a BALANCED fan (decoupled from the spiral) so a gust still LEANS, never spins (§5.1)
          const azBal = (i+0.5)/lpt*TAU2 + (gr()-0.5)*(TAU2/lpt)*0.6;
          limbDir[2*gi]=Math.cos(azBal); limbDir[2*gi+1]=Math.sin(azBal);
          limbRaw[2*i]=Math.cos(azGeo)*len; limbRaw[2*i+1]=Math.sin(azGeo)*len;
          grow(out, [0,0,h], dir, len, 1, gi);
        }
      } else {
        // legacy single-hub: every limb from one point (the palm/lollipop) — kept as the leader_strength=0 case
        for(let i=0;i<lpt;i++){
          const gi = limbBase+i;
          const azL = (i+0.5)/lpt*TAU2 + (gr()-0.5)*(TAU2/lpt)*0.6;
          const ce = Math.cos(limbEl), se = Math.sin(limbEl);
          const dir = [ce*Math.cos(azL), ce*Math.sin(azL), se];
          const len = 0.7+0.5*gr();
          limbDir[2*gi]=Math.cos(azL); limbDir[2*gi+1]=Math.sin(azL);
          limbRaw[2*i]=dir[0]*len; limbRaw[2*i+1]=dir[1]*len;
          limbAttach[gi] = 0;                            // the hub IS the attach point (local 0); zLift below puts it at the trunk top
          grow(out, [0,0,0], dir, len, 1, gi);
        }
      }
      // normalise the crown's PLAN extent to `crown` and lift onto the trunk. A monopodial tree carries its own
      // height (limbs are up the bole), so it scales z with the plan and stands on the ground; the legacy hub
      // lifts its whole crown by trunkH.
      let mr=1e-3, mz=1e-3; for(const w of out.tw){ mr=Math.max(mr, Math.hypot(w.x,w.y)); mz=Math.max(mz, w.z); }
      const s = crown/mr;   // PLAN fill (x,y): the widest twig → crown radius
      // HEIGHT scale (§4.5): the old code scaled z by this same s, but s = crown/mr EXPLODES for a narrow-plan tree
      // (steep branches → tiny mr → s of 6+), which — now that the faithful cast uses real z — made columnar ~47m,
      // palm ~16m. Floor the plan radius at mz/RATIO for the HEIGHT scale only: a broad tree (mr above the floor) is
      // UNCHANGED (sV == s, height preserved), a narrow tree is clamped to height = crown·RATIO·aspect. x/y keep s.
      const sV = crown/Math.max(mr, mz/FAITH_MAX_RATIO);
      // trunk top scales with leader_strength (§4.5): a weak leader (decurrent) ends DOWN in the crown at the highest
      // limb attach; a strong leader (excurrent) reaches the foliage apex. Always ≥ limbTop so every limb meets the trunk.
      if(L>0) leaderTop = limbTop + (mz - limbTop)*L;
      const aspect = clamp(params.crown_aspect, 0.4, 3);   // crown height factor (§4.5): scales crown height (narrow trees capped via sV above). Drives the faithful cast + 3D preview; the LAYER cast normalises height away (invariant).
      // scale the legacy-hub lift by aspect too, so an L=0 tree is a TRUE uniform z-scale: otherwise crown_aspect
      // leaks into the layer-mode wood (floorH's bole division assumes a pure scale), breaking the "invisible to the
      // layer cast" invariant for hub trees. aspect=1 (the default and every shipped look) → byte-identical. (§4.5)
      const zLift = (L>0) ? 0 : trunkH*aspect;
      const sc = (p) => [ p[0]*s+tx, p[1]*s+ty, p[2]*sV*aspect+zLift ];
      const twBase = twigs.length;   // this tree's first global twig index — turns grow()'s per-tree tw into the global clump id
      // the twig BASE must ride the very same plan transform as the tip (sc's x,y half), or the shared pivot lands
      // off the wood; it is plan-only because the bend is 2-D yaw, so no z scale is needed.
      for(const w of out.tw){ const q=sc([w.x,w.y,w.z]); w.x=q[0]; w.y=q[1]; w.z=q[2]; w.bx=w.bx*s+tx; w.by=w.by*s+ty; w.tx=tx; w.ty=ty; w.tcov=treeCov; w.tree=tt; twigs.push(w); }
      for(const sg of out.seg){ segments.push({ a:sc(sg.a), b:sc(sg.b), level:sg.level, cov:treeCov, tree:tt, limb:sg.limb, px:tx, py:ty, f0:sg.f0||0, f1:(sg.f1!=null?sg.f1:1), clump:(sg.tw>=0 ? twBase+sg.tw : -1) }); }
      const trunkTop = (L>0) ? leaderTop*sV*aspect : trunkH*aspect;
      segments.push({ a:[tx,ty,0], b:[tx,ty,trunkTop], level:0, cov:treeCov, tree:tt, limb:-1, px:tx, py:ty, f0:0, f1:1, clump:-1 });   // the continuing trunk axis
      for(let i=0;i<lpt;i++){ const gi=limbBase+i;
        limbPlan[2*gi]=limbRaw[2*i]*s*0.6+tx; limbPlan[2*gi+1]=limbRaw[2*i+1]*s*0.6+ty;
        limbAttach[gi]=limbAttach[gi]*sV*aspect+zLift; }   // the attach height must ride the IDENTICAL z transform sc() gives every twig/segment, or the anchor sits off the wood it is meant to hold onto
    }
    if(twigs.length > MAX_TEX) twigs.length = MAX_TEX;   // cap the per-clump data-texture width to the GPU limit

    // ---- map grown heights into the layer band: bin each twig to a layer by its height ----
    let zMin=1e18, zMax=-1e18;
    for(const t of twigs){ zMin=Math.min(zMin,t.z); zMax=Math.max(zMax,t.z); }
    const dz = (zMax-zMin) > 1e-4 ? (zMax-zMin) : 1;
    const nLayer = Math.max(1, params.layer_count|0);
    for(const t of twigs){
      t.layer = nLayer>1 ? clamp(Math.round((t.z-zMin)/dz*(nLayer-1)), 0, nLayer-1) : 0;   // higher foliage -> higher layer -> blurs more
    }
    // LAYER/park height band (spec §2): bole 0→canopy_base, crown canopy_base→+thickness, NORMALISED by [zMin,zMax].
    // Used ONLY by the analytic woody occluder (non-faithful). This normalisation is invariant to a uniform z-scale —
    // correct for the depth cheat, but it would erase crown_aspect (and the real tree shape) from a faithful cast.
    const _cb = params.canopy_base_height_m, _th = params.canopy_thickness_m, _zb = Math.max(zMin, 1e-3);
    const floorH = (z) => z<=zMin ? _cb*(Math.max(0,z)/_zb) : _cb + (z-zMin)/dz*_th;
    // FAITHFUL cast (spec §4.5): leaves & skeleton cast from their REAL grown height — the very z the 3D preview draws,
    // so the shadow IS the preview tree. Any shape change (crown_aspect, droop, taper…) now flows into the shadow.
    let hMin=1e18, hMax=-1e18;
    for(const t of twigs){ if(t.z<hMin)hMin=t.z; if(t.z>hMax)hMax=t.z; }
    faith.hMin = hMin<=hMax ? hMin : 0; faith.hMax = hMax>hMin ? hMax : (faith.hMin+1);

    const nClusterTotal = twigs.length;
    const hier = {
      nLimb, limbDir, limbPlan, limbAttach,
      limbAngle:new Float32Array(nLimb), limbVel:new Float32Array(nLimb),   // scalar YAW bend (radians): rotation about the vertical
      limbPitch:new Float32Array(nLimb), limbPitchVel:new Float32Array(nLimb),   // second DOF (§5.1): ELEVATION bend in the limb's own vertical plane — what sway_pitch foreshortens by. Same spring constants as the yaw.
      nClusterTotal,
      clusterPlan:new Float32Array(nClusterTotal*2), clusterLimb:new Int32Array(nClusterTotal),
      clusterPhase:new Float32Array(nClusterTotal),
      twigAngle:new Float32Array(nClusterTotal), twigVel:new Float32Array(nClusterTotal),
      clusterData:new Float32Array(nClusterTotal*4),   // dynamic: (limb bend, twig bend, .z per MODE — layer's stem seed / faithful's sway_pitch anchor offset, sway_pitch foreshorten factor) — see publishBend
      clusterGeom:new Float32Array(nClusterTotal*4),   // static: (leaf pivot anchor.xy — twig tip on the layer path, real twig base in faithful; tree trunk pivot.xy)
      // topology signature: what makes limb/cluster index i mean the SAME branch across a regrow. tree_count is NOT
      // here (trees append, so the prefix still lines up — that's the morph); branch_angle/length/pitch/droop aren't
      // either (same indices, just bent differently — carrying their sway is the desired no-reset). But seed / depth /
      // children / limb_count / phyllotaxis / the leader↔hub azimuth flip re-mean every index, so the carry is invalid.
      topoSig: `${params.seed>>>0}|${levels}|${kids}|${lpt}|${phyllo}|${L>0?1:0}`,
      segments, twigs, maxV:0,   // twigs (one per leaf cluster) for the 3D preview — so it scatters per twig like the bake, not per terminal segment (droop sub-segments)
    };
    // carry the in-flight sway across a regrow so the wind doesn't reset (an editor tweak or a grove-morph
    // transition). Trees/limbs are appended at the end, so indices 0..min are the same twig: copy the common
    // PREFIX — existing trees keep their sway, a newly-grown tree starts at rest. ONLY when the topology signature
    // matches; a leader/phyllotaxis/depth edit re-means the indices, so we start at rest there (no wrong-twig bend). (§9)
    if(prevHier && prevHier.topoSig === hier.topoSig){
      const nL=Math.min(prevHier.nLimb,nLimb), nC=Math.min(prevHier.nClusterTotal,nClusterTotal);
      hier.limbAngle.set(prevHier.limbAngle.subarray(0,nL)); hier.limbVel.set(prevHier.limbVel.subarray(0,nL));
      hier.limbPitch.set(prevHier.limbPitch.subarray(0,nL)); hier.limbPitchVel.set(prevHier.limbPitchVel.subarray(0,nL));
      hier.twigAngle.set(prevHier.twigAngle.subarray(0,nC)); hier.twigVel.set(prevHier.twigVel.subarray(0,nC));
    }

    // ---- hang a leaf cluster on each twig, accumulating one instance buffer per depth layer ----
    const layerData = [];
    for(let l=0;l<nLayer;l++) layerData.push([]);   // 16 floats/leaf — see attribute layout below
    const faithData = [];                           // FAITHFUL: ALL leaves in one buffer + a 17th float = continuous height (§4.5)
    const faithful = faithfulOn();                  // hoisted: the packing convention below must be ONE decision for the whole grove, not re-asked per leaf
    for(let j=0;j<nClusterTotal;j++){
      const t = twigs[j];
      const rng  = mulberry32(hash3(params.seed>>>0, j, 101));               // arrangement stream
      const rng2 = mulberry32(hash3((params.seed>>>0)^0x5bd1e995, j, 101));  // wind-identity stream (separate)
      const gauss = makeGauss(rng);
      const cx=t.x, cy=t.y;
      let tdx=t.dx||0, tdy=t.dy||0; const tdl=Math.hypot(tdx,tdy), tHasDir=tdl>1e-4; if(tHasDir){ tdx/=tdl; tdy/=tdl; }   // unit twig heading (plan); leaves hug it
      const swayRand = rng2()*2-1; const stemRand = rng2()*2-1;
      hier.clusterPlan[2*j]=cx; hier.clusterPlan[2*j+1]=cy; hier.clusterPhase[j]=swayRand*Math.PI;
      hier.clusterLimb[j]=t.limb;                                    // grown level-1 ancestor (no search needed)
      // .xy is the LEAF PIVOT ANCHOR, and it means different things per path. LAYER/park: the twig tip (= the clump
      // centre), from which VS_BAKE offsets a SYNTHETIC stem joint by uStemLen — no wood is drawn there, so a made-up
      // joint costs nothing. FAITHFUL: the twig's REAL grown base, which is also what the wood twig turns about in
      // bakeFaithful's refill — one shared joint, so the medium band can't slide leaves off their visible twigs (§4.5).
      hier.clusterGeom[4*j]=faithful?t.bx:cx; hier.clusterGeom[4*j+1]=faithful?t.by:cy;
      hier.clusterGeom[4*j+2]=t.tx; hier.clusterGeom[4*j+3]=t.ty;    // limb pivot = this tree's trunk
      hier.clusterData[4*j+2]=stemRand;                             // static stem-angle seed (.z); tick writes .x/.y
      const data = layerData[t.layer];
      for(let k=0;k<nLeaf;k++){
        const cov = ((k===pcInt) ? frac : 1.0) * t.tcov;   // marginal-leaf fade × marginal-tree fade (§4.5)
        // leaves HUG the twig (§4.5): trail back from the tip ALONG the twig heading (1.5×spread) with a tight
        // perpendicular jitter (0.4×spread), instead of an isotropic blob. Same two draws → other attributes unchanged.
        const g1 = gauss(), g2 = gauss();
        const hug = faithful && tHasDir;   // twig-hug only in faithful mode; the layer/park scatter stays byte-identical
        const x = hug ? cx - Math.abs(g1)*params.cluster_spread_m*1.5*tdx - g2*params.cluster_spread_m*0.4*tdy : cx + g1*params.cluster_spread_m;
        const y = hug ? cy - Math.abs(g1)*params.cluster_spread_m*1.5*tdy + g2*params.cluster_spread_m*0.4*tdx : cy + g2*params.cluster_spread_m;
        const size = params.leaf_size_m*(0.6+0.8*rng());
        const A = size*0.5;                              // long half-axis
        const B0 = size*0.5/params.leaf_aspect;          // face-on short half (shader foreshortens)
        const restTilt = rng()*params.max_tilt*(Math.PI*0.5);
        const angle = rng()*Math.PI;
        const ax = 0.4+0.6*rng(), ay = 0.4+0.6*rng();    // incoherent orbit
        const orient = rng()*TAU2, phase = rng()*TAU2;
        const swingGain = 0.6+0.8*rng2(), swingPhase = rng2()*TAU2;
        data.push(x,y,A,B0, angle,restTilt,swingGain,swingPhase,
                  tau[0]*cov,tau[1]*cov,tau[2]*cov, j, ax,ay,orient,phase);
        faithData.push(x,y,A,B0, angle,restTilt,swingGain,swingPhase,
                  tau[0]*cov,tau[1]*cov,tau[2]*cov, j, ax,ay,orient,phase, t.z);   // + REAL grown height (attr 5) — cast == preview
      }
    }

    // ---- build one instanced VAO per depth layer from its accumulated leaves ----
    const buildLayerVAO = (arr) => {
      const buf=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      gl.bufferData(gl.ARRAY_BUFFER,arr,gl.STATIC_DRAW);
      const vao=gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      const S=64;   // 16 floats/leaf: [c.xy,A,B0][angle,tilt,swingGain,swingPhase][tau.rgb,clusterId][orbit.xyzw]
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.bindVertexArray(null);
      return { vao, count: arr.length/16, buf };
    };
    for(let l=0;l<nLayer;l++) layerVAO.push(buildLayerVAO(new Float32Array(layerData[l])));

    // ---- FAITHFUL path (§4.5): one combined VAO of EVERY leaf, each carrying its continuous floor-height (attr 5),
    // for the per-sample geometry bake. Built always (cheap); only DRAWN when faithful_canopy is on. ----
    if(faith.vao){ gl.deleteVertexArray(faith.vao); gl.deleteBuffer(faith.buf); }
    {
      const arr = new Float32Array(faithData);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S=68;   // 17 floats/leaf: the 16 bake floats + the continuous height
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5,1,gl.FLOAT,false,S,64); gl.vertexAttribDivisor(5,1);
      gl.bindVertexArray(null);
      faith.vao=vao; faith.buf=buf; faith.count=arr.length/17;
    }

    // (the woody shadow is now the CONTINUOUS-height analytic occluder built below, §4.5 — the old layer-stamped
    // branch quads were retired because layer quantization shattered continuous lines at a low sun.)

    // ---- (re)build the per-clump data textures sampled by the bake VS ----
    const makeDataTex = (old, data) => {
      if(old) gl.deleteTexture(old);
      const tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, Math.max(1,nClusterTotal), 1, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tx;
    };
    const clusterTex     = makeDataTex(null, hier.clusterData);      // dynamic bend angles — a NEW texture per grove (the old one is freed at install)
    const clusterGeomTex = makeDataTex(null, hier.clusterGeom);      // static geometry
    // ---- woody occluder (spec §4.5): trunk + MAIN LIMBS (level<=1) as CONTINUOUS-height analytic segments. Map
    // each grown z to a floor height with the SAME crown mapping the leaves bin by (zMin->canopy_base,
    // zMax->base+thickness), and the bole linearly to 0 — so a limb's base lands at the trunk's height and the
    // shadow CONNECTS (no layer-quantization snowflake). Fine sub-branches are dropped; the leaf dapples carry the
    // fine canopy. The trunk passes through all the limb heights, so the trunk shadow meets the crown. ----
    {
      const tf = Math.pow(Math.max(1.001, kids), -1/clamp(params.taper_delta,1,4));   // pipe-model taper for the radius (floorH hoisted above)
      const rest=[], segH=[];
      let want=0;                                      // what the grove ASKED for, before the cap — see occ.want below
      for(const sg of segments){
        if(sg.level>1) continue;                       // trunk + main limbs only; fine sub-branches carried by the leaf dapples
        want++;
        if(rest.length >= MAX_OCC) continue;           // table full: keep counting rather than break, so the shortfall is a number instead of nothing
        const r = Math.max(0.01, params.trunk_radius_m*Math.pow(tf, sg.level));
        rest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], limb:sg.limb, px:sg.px, py:sg.py });   // limb+pivot for the per-frame swing
        segH.push(floorH(sg.a[2]), floorH(sg.b[2]), r, 0);
      }
      // want > count means this grove is TRUNCATED: the tail of the grow order — whole later trees' boles and limbs —
      // casts no wood at all. It is invisible in a single frame (nothing is missing, there is just less), which is
      // exactly why it needs a number: the pixel harness reads these two and says so out loud.
      occ.rest = rest; occ.ht = new Float32Array(segH); occ.count = rest.length; occ.want = want;
      let hRef = 1e-3; for(let i=0;i<segH.length;i+=4) hRef = Math.max(hRef, segH[i], segH[i+1]);   // tallest floor-height → the drift's height-scale reference (foot planted, crown sways)
      occ.hRef = hRef;
    }
    // ---- FAITHFUL skeleton (§4.5): EVERY segment (trunk + branches + TWIGS) as a tapered capsule at continuous
    // heights (the same floorH). Unlike the analytic occluder (level<=1, capped at MAX_OCC), this is a vertex buffer
    // with no level/count cap — so the twigs cast too and the leaves sit on VISIBLE wood. Used only in faithful mode. ----
    {
      const tf = Math.pow(Math.max(1.001, kids), -1/clamp(params.taper_delta,1,4));   // pipe-model taper
      const segRest = [];
      for(const sg of segments){
        // taper by FRACTIONAL level (sg.f0/f1) so a drooping branch's sub-segments thin smoothly across the one
        // level→level+1 step rather than each repeating the whole step (the old sawtooth). Straight branches: f0=0,f1=1 → unchanged.
        const ra = Math.max(0.012, params.trunk_radius_m*Math.pow(tf, sg.level + (sg.f0||0)));     // thick at the base of the segment (min keeps twigs visible)
        const rb = Math.max(0.008, params.trunk_radius_m*Math.pow(tf, sg.level + (sg.f1!=null?sg.f1:1)));  // thinner toward the tip — continuous with the next sub-segment
        // segment→clump linkage: a TERMINAL (twig-order) segment names the clump hanging off it, and carries that
        // twig's real grown base — the pivot its leaves use in VS_FAITH — so the refill can swing wood and leaves
        // as one. -1 = trunk/limb/interior wood (no clump), and also any twig past the MAX_TEX cluster cap, which
        // bears no leaves at all. (twigs[] is already capped and scaled by here.)
        const cj = (sg.clump>=0 && sg.clump<twigs.length) ? sg.clump : -1;
        segRest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], ha:sg.a[2], hb:sg.b[2], ra, rb, limb:sg.limb, px:sg.px, py:sg.py,
                       clump:cj, tbx:(cj>=0?twigs[cj].bx:0), tby:(cj>=0?twigs[cj].by:0),
                       level:sg.level, mz:0.5*(sg.a[2]+sg.b[2]) });   // REAL grown heights (cast == preview); level + midpoint height pick the SKY view's layer bin below
      }
      faith.segRest = segRest; faith.segCount = segRest.length;
      faith.segArr = new Float32Array(segRest.length*8);   // 8 floats/seg: iSeg(ax,ay,bx,by) + iSegH(ha,hb,ra,rb); positions refilled per bake with the sway
      if(faith.segVAO){ gl.deleteVertexArray(faith.segVAO); gl.deleteBuffer(faith.segBuf); }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, faith.segArr, gl.DYNAMIC_DRAW);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const S=32;
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.bindVertexArray(null);
      faith.segVAO=vao; faith.segBuf=buf;
    }
    // ---- SKY VIEW's layer-stamped wood (§4.9). The look-up camera reads the layer textures as ANGULAR SILHOUETTES,
    // so wood binned into a layer is drawn at that layer's plan and read at the ray's crossing of that layer's height
    // — which is exactly where the leaves in the same bin are drawn and read. Registration therefore holds by
    // CONSTRUCTION for a terminal segment: it takes its own clump's layer, the very bin its leaves went into.
    // ONLY the fine wood goes in. Level 0 and 1 are the trunk and main limbs, which the analytic occluder already
    // draws as real 3-D capsules; binning those would both double them and shatter them, because a segment that
    // spans several layer bands is cut into pieces read at different plan points. Fine wood is short by construction
    // (measured well under one band at every shipped look), so it cannot come apart. ----
    {
      const segRest = [], nL = Math.max(1, params.layer_count|0);
      if(params.sky_view){
        const binOf = (s0) => s0.clump >= 0 ? twigs[s0.clump].layer
                            : (nL > 1 ? clamp(Math.round((s0.mz - zMin)/dz*(nL-1)), 0, nL-1) : 0);   // the twigs' own binning rule, applied to interior wood by its midpoint
        const byLayer = [];
        for(let l=0;l<nL;l++) byLayer.push([]);
        for(const s0 of faith.segRest) if(s0.level > 1) byLayer[binOf(s0)].push(s0);
        for(let l=0;l<nL;l++){ sky.start[l] = segRest.length; sky.count[l] = byLayer[l].length; for(const s0 of byLayer[l]) segRest.push(s0); }
      } else { sky.start.length = 0; sky.count.length = 0; }
      sky.segRest = segRest;
      sky.segArr = new Float32Array(segRest.length*8);
      if(sky.segVAO){ gl.deleteVertexArray(sky.segVAO); gl.deleteBuffer(sky.segBuf); sky.segVAO=null; sky.segBuf=null; }
      if(segRest.length){
        sky.segBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sky.segArr, gl.DYNAMIC_DRAW);
        sky.segVAO = gl.createVertexArray();
        gl.bindVertexArray(sky.segVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,32,0);  gl.vertexAttribDivisor(1,1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,16); gl.vertexAttribDivisor(2,1);
        gl.bindVertexArray(null);
      }
    }
    // FAITHFUL cast-frame plan AABB (spec §4.5 / A5): the REAL plan extent of every leaf (faithData x,y) + every wood
    // endpoint, so bakeFaithful's cast frame covers a wide grove's OUTER crown. (Was bounded by ±canopy_extent/2, which
    // clipped it — park 1's crown reaches ~4.3 m vs half=3.25 m.) Rest positions; the per-bake pad covers sway+drift.
    {
      let px0=1e18,py0=1e18,px1=-1e18,py1=-1e18;
      for(let i=0;i<faithData.length;i+=17){ const x=faithData[i],y=faithData[i+1]; if(x<px0)px0=x; if(x>px1)px1=x; if(y<py0)py0=y; if(y>py1)py1=y; }
      for(const s of faith.segRest){
        if(s.ax<px0)px0=s.ax; if(s.ax>px1)px1=s.ax; if(s.ay<py0)py0=s.ay; if(s.ay>py1)py1=s.ay;
        if(s.bx<px0)px0=s.bx; if(s.bx>px1)px1=s.bx; if(s.by<py0)py0=s.by; if(s.by>py1)py1=s.by;
      }
      if(px0>px1){ const h=params.canopy_extent_m/2; px0=-h;py0=-h;px1=h;py1=h; }   // empty grove fallback
      faith.pminx=px0; faith.pmaxx=px1; faith.pminy=py0; faith.pmaxy=py1;
    }
    return { hier, layerVAO, clusterTex, clusterGeomTex };
  }

  return { buildGrove };
}
