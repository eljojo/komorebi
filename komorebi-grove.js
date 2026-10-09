// ============================================================================
// The Canopy, grown (spec §4.5) — buildGrove: a grove of recursive trees
// (leader, droop, taper, phyllotaxis), leaves hung on terminal twigs and
// binned to depth layers, the woody occluder segments, the faithful-path
// geometry, and the per-clump data textures — allocated and RETURNED as one
// grove value (installGrove, in the engine, makes one active). A factory over
// the engine's shared internals (hub).
//
// RE-SEASONING (§4.5, P2b). The season is a function of the grove, not a regrow: a phenology change moves each leaf's tau, the retained weight w, which leaves
// are compacted out, the litter list and leafW — and nothing else. The skeleton, every leaf's place, size, orientation, height and cluster address, the exposure field
// and its keyed rank are the GROVE's. So a grove built with `keepSeason` keeps a per-leaf record (`g.season`), and reseasonGrove re-runs the season arithmetic
// over it in one pass on typed arrays, landing BIT FOR BIT where a fresh buildGrove at the same params lands (reseason.test.js holds it, over every variant): the
// slider's last tick is the resting state and nothing regrows on release.
//   THE KEY. `season.key` is every param buildGrove READS except the season set (komorebi-params.js SEASON_KEYS), plus faithfulOn(). The engine re-seasons only
//   while the key still matches; a changed key regrows. GROVE_READS is derived from `grep -n "params\." komorebi-grove.js` and reseason.test.js greps again, so a
//   new read cannot slip past the key. Every grove carries its key (`grove.key`, cache or not), so the engine can tell a regrow whose structure is the one on screen from one
//   whose structure is still moving: only the first keeps the record, because the next tick of a moving structure would throw it away.
//   THE CACHE IS LAZY. A summer build keeps no record (rec exists only when lit || dropping, and recording always costs ~5 ms and ~7 MB a regrow): the first
//   'season' apply on a grove without one does one full build with keepSeason (when the structure it builds is the one on screen; see THE KEY). The exposure field and its keyed rank are kept from that build when it ran the
//   pass, and otherwise built by the first re-season whose gate needs `u`; the rank is never written into (exposureBlend hands it back itself at exposure_absolute 0).
//   GOTCHAS. A and B0 are kept as DOUBLES: the litter's `size` is read from the doubles in buildGrove, and a float32 copy differs in the last bits. A re-season writes
//   into the EXISTING buffers (layerVAO[l].buf, faith.buf), so the VAO pointers stay valid; it never touches `gr`, the hier springs, clusterData, clusterTex or leafTex —
//   which is also why there is no shallow-copy grove: installGrove would free the textures it shared. faith.* is engine-global (a second grove built for a transition
//   writes it), so the engine re-seasons only with no transition and with faith.buf still this grove's. leafW is a NEW array each time: the tree preview keys on it.
//   MEASURED (bun, median of 7, fall at t 0.9): afternoon 7 73 ms a regrow, the void 201, montebello 15 — see the cost test in reseason.test.js for the re-season's.
// ============================================================================
import { DEG, FAITH_MAX_RATIO, GOLDEN, afterTurn, clamp, dropDay, dropDayAfterTurn, dropHash, dropPhase, exposureBlend, exposureGrid, exposureRank, growSkeleton, hash3, leafClock, leafTau, lit, makeGauss, mulberry32, ordered, redGain, retention, senescing, dropping, treeGains, treeShifts, turnOrder, turnPhase } from './komorebi-math.js';

// The fall tiers this module owns, as the bundler sees them (embed-build.mjs): each is substituted by a literal, true or false, and the code behind a false one is not
// in the bundle. A tier is cut only for a look that does not open it (komorebi-params.js FEATURES), so a flag that is false here means the guarded arithmetic was
// already unreachable for every look the bundle carries. The flags sit in the SAME expression as the call they guard, never in a predicate function or a local that
// holds one (`const sen = FEAT_X && ...`): a minifier inlines neither, and the arithmetic behind a guard it cannot fold stays in the bundle.
const FEAT_PIGMENT = true;
const FEAT_EXPOSURE = true;
const FEAT_DROP = true;
const FEAT_LITTER = true;
import { MAX_LAYERS, MAX_OCC } from './komorebi-params.js';
import { LEAF_ID_FRAC, LEAF_SAMPLES, leafFlip, leafShape, leafVariant } from './komorebi-leaf.js';

// Every param buildGrove reads besides the season set, and so the whole of `season.key` (faithful_canopy and receiver reach it through faithfulOn(), which the key carries
// as the boolean it is). Held against a grep of this file in reseason.test.js.
export const GROVE_READS = [
  'branch_angle_deg','branch_children','branch_length_ratio','branch_levels','branch_pitch_deg','canopy_base_height_m','canopy_extent_m','canopy_thickness_m',
  'cluster_spread_m','crown_aspect','drop_after_turn','droop','faithful_canopy','foliage_density','layer_count','leader_strength','leaf_aspect','leaf_shape','leaf_size_m','leaves_per_cluster',
  'limb_count','max_tilt','phyllotaxis','receiver','seed','sky_view','standing_scene','taper_delta','trans_b','trans_g','trans_r','tree_count','trunk_radius_m','view_extent_m',
];
export const seasonKey = (params, faithful) => `${GROVE_READS.map(k => params[k]).join('|')}|${faithful ? 1 : 0}`;
const SREC = 11;   // a season record: x, y, h, A, B0, area, j, k, cov, layer, start of the leaf's 17 floats in its layer's buffer (the faithful record's first 16 are the same numbers)

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
  function buildGrove(prevHier, { keepSeason = false } = {}){
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
    // THE LEAF'S OUTLINE (§4.5, P4a-2): null is the ellipse — the stamp's own line, and nothing below is asked of it. A grove OWNS its outline (like its cluster
    // textures), because a transition's crossfade bakes two groves into one layer texture and they may not share one.
    const shape = leafShape(params.leaf_shape, params.seed);

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
    // One tree ahead of its neighbours (§4.5): each tree's lead (its clocks run Δ sooner) and depth (its red and brown × c), drawn from (seed, tree index) on a salt of their own, so a tree keeps its numbers
    // as the grove grows and the marginal tree has its own. Tables of nTree, or null while the knob is 0 (no draw, nothing handed on). They touch only a leaf's tau and day; the growth stream is never drawn from.
    // Each table is built only where a tier that reads it is in the bundle: the lead by leafTau (pigment, exposure) and by the two drop days (drop), the depth by leafTau alone. The parentheses are load-bearing: the bundler
    // folds a dead `false ? A : B` as TEXT (embed-build.mjs foldDeadTernaries) and would take the last operand of a bare `||` for the whole condition.
    const tShift = (FEAT_PIGMENT || FEAT_EXPOSURE || FEAT_DROP) ? treeShifts(params, nTree) : null, tGain = (FEAT_PIGMENT || FEAT_EXPOSURE) ? treeGains(params, nTree) : null;
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

    const grammar = { levels, kids, lenRatio, coneA, droop, phyllo, leader:L>0 };   // the tree's grammar, whole (math.growSkeleton): everything a node needs to grow its children, bar the root

    for(let tt=0;tt<nTree;tt++){
      // trunk placement: Vogel disk so trees spread evenly; the first tree sits at the centre.
      const treeCov = (tt===nFull) ? tFrac : 1.0;        // the marginal tree fades in by coverage (1 for full trees)
      const rr = Rfill*Math.sqrt(tt/treeCountF);         // normalise by the continuous count -> trees re-space smoothly as it morphs
      const aa = tt*GOLDEN + (gr()-0.5)*0.6;
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
          const azGeo = i*GOLDEN + (gr()-0.5)*0.3;       // phyllotaxis spiral (geometry)
          const pitch = limbEl*(1 + 0.4*L*f);            // steeper toward the apex → a tighter cone
          const ce = Math.cos(pitch), se = Math.sin(pitch);
          const len = (0.4+0.2*gr())*(1 - 0.45*L*f);     // limbs SHORTER than the crown is tall → narrow crown on a tall trunk, not a bush; acrotony shortens toward the apex
          const dir = [ce*Math.cos(azGeo), ce*Math.sin(azGeo), se];
          // wind torque rides a BALANCED fan (decoupled from the spiral) so a gust still LEANS, never spins (§5.1)
          const azBal = (i+0.5)/lpt*TAU2 + (gr()-0.5)*(TAU2/lpt)*0.6;
          limbDir[2*gi]=Math.cos(azBal); limbDir[2*gi+1]=Math.sin(azBal);
          limbRaw[2*i]=Math.cos(azGeo)*len; limbRaw[2*i+1]=Math.sin(azGeo)*len;
          growSkeleton({ ...grammar, base:[0,0,h], dir, len, level:1, limb:gi }, gr, out);
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
          growSkeleton({ ...grammar, base:[0,0,0], dir, len, level:1, limb:gi }, gr, out);
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
    // Where each depth bin REALLY grew (the mean grown z of its twigs). The faithful cast ignores the park band, but the
    // sky fill's low-res layers (§4.7) are depth bins on that path too, and a hemisphere read at the park band's heights
    // would be the wrong tree's. An empty bin falls back to its even share of the grown range.
    {
      const nb = Math.max(nLayer, MAX_LAYERS), sumZ = new Float64Array(nb), cnt = new Float64Array(nb);
      for(const t of twigs){ sumZ[t.layer] += t.z; cnt[t.layer]++; }
      faith.binH = Float32Array.from(sumZ, (z, l) => cnt[l] ? z/cnt[l] : faith.hMin + (faith.hMax-faith.hMin)*(nLayer>1 ? Math.min(l,nLayer-1)/(nLayer-1) : 0.5));
    }

    const nClusterTotal = twigs.length;
    const hier = {
      nLimb, limbDir, limbPlan, limbAttach,
      limbAngle:new Float32Array(nLimb), limbVel:new Float32Array(nLimb),   // scalar YAW bend (radians): rotation about the vertical
      limbPitch:new Float32Array(nLimb), limbPitchVel:new Float32Array(nLimb),   // second DOF (§5.1): ELEVATION bend in the limb's own vertical plane — what sway_pitch foreshortens by. Same spring constants as the yaw.
      nClusterTotal,
      nLeaf,   // the leaves hung on each cluster, the marginal one counted where there is one: the grove's own record, which the editor's held leaf walks instead of rebuilding it from the params
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
    for(let l=0;l<nLayer;l++) layerData.push([]);   // 17 floats/leaf — see attribute layout below
    let faithData = [];                             // FAITHFUL: ALL leaves in one buffer, + the continuous height (§4.5) before the fade: 18 floats/leaf (let: abscission compacts it)
    const faithful = faithfulOn();                  // hoisted: the packing convention below must be ONE decision for the whole grove, not re-asked per leaf
    // Autumn senescence (§4.5): per-leaf pigment state. Every s_j is exactly 0 until phenology passes turn_start, so
    // below it the authored `tau` goes through untouched — the gate that keeps every shipped look byte-identical.
    const sen = senescing(params), leafT = [0,0,0];
    // Light decides who turns first (§4.5): exposure is a property of the STAND, not of the leaf — it needs every leaf's place
    // and height — so with turn_exposure up each leaf notes where its tau went (rec: x, y, z, area, j, k, fade, layer,
    // slot in its layer buffer, slot in the faithful one) and the loop below rewrites them once the grove is laid out.
    // Off (the default, and every look that never asks) rec is never made and the loop is P0's, bit for bit.
    // Abscission (§4.5) is a second reason to look back: who has let go is decided over the whole stand too (the light orders it), and a
    // leaf that has is compacted out of both buffers. `dropping` is its gate: at leaf_drop 0, or in a season before the first leaf's fade
    // can begin (drop_start - DROP_EPS), rec, the retention arithmetic, the compaction and the litter are never made — P1's buffers to the bit.
    const isLit = lit(params), isDropping = dropping(params), after = afterTurn(params);
    const rec = ((FEAT_EXPOSURE && isLit) || (FEAT_DROP && isDropping)) ? [] : null;
    const sRec = keepSeason ? new Float64Array(nClusterTotal*nLeaf*SREC) : null;   // the re-season's per-leaf record (see the header): doubles, because the litter wants the doubles
    let sEx = null, sRank = null;   // the exposure field and keyed rank, when this build ran the pass: the record keeps them, so the first re-season does not pay it again
    let sAt = 0;
    for(let j=0;j<nClusterTotal;j++){
      const t = twigs[j];
      const dT = tShift ? tShift[t.tree] : undefined, cT = tGain ? tGain[t.tree] : undefined;   // this cluster's tree's lead and depth
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
        let angle = rng()*Math.PI;
        if(shape && leafFlip(params.seed, j, k)) angle += Math.PI;   // an outline is not the same leaf a half turn on: half of them take the other half-plane (komorebi-leaf.js)
        const ax = 0.4+0.6*rng(), ay = 0.4+0.6*rng();    // incoherent orbit
        const orient = rng()*TAU2, phase = rng()*TAU2;
        const swingGain = 0.6+0.8*rng2(), swingPhase = rng2()*TAU2;
        // this leaf's own tau: a leaf not yet turning gets `tau` itself (leafTau's s=0 branch copies it, no arithmetic).
        // The hashes inside leafTau are pure functions of (seed, j, k) — they must never draw from rng/rng2/gr above,
        // or every shipped grove reshuffles.
        const lt = FEAT_PIGMENT && sen ? leafTau(tau, params, params.seed, j, k, leafT, undefined, undefined, dT, cT) : tau;
        // the cluster id the VS reads: j, and for an outline its row in the FRACTION (j + v/32) — a pure hash of (seed, j, k) on the leaf's own salt, like the pigment above
        const cid = shape ? j + leafVariant(params.seed, j, k)/LEAF_ID_FRAC : j;
        // iFade: the very `cov` folded into tau above. The bake writes it into alpha (coverage) so the leaf's BALLISTIC shadow (§4.5) fades out
        // with its tau — the mixture reads (tau·cov, cov·fade) as the same leaf over fade·cov of the area — instead of keeping its full footprint
        // on a leaf that is not there yet; alpha has no other reader.
        data.push(x,y,A,B0, angle,restTilt,swingGain,swingPhase,
                  lt[0]*cov,lt[1]*cov,lt[2]*cov, cid, ax,ay,orient,phase, cov);
        faithData.push(x,y,A,B0, angle,restTilt,swingGain,swingPhase,
                  lt[0]*cov,lt[1]*cov,lt[2]*cov, cid, ax,ay,orient,phase, t.z, cov);   // + REAL grown height (attr 5) — cast == preview — then the fade (attr 6)
        if(rec) rec.push(x, y, t.z, Math.PI*A*B0*cov, j, k, cov, t.layer, data.length-9, faithData.length-10);   // flat area (the ellipse), orientation ignored; the two slots are where this leaf's tau starts
        if(sRec){ sRec[sAt]=x; sRec[sAt+1]=y; sRec[sAt+2]=t.z; sRec[sAt+3]=A; sRec[sAt+4]=B0; sRec[sAt+5]=Math.PI*A*B0*cov; sRec[sAt+6]=j; sRec[sAt+7]=k; sRec[sAt+8]=cov; sRec[sAt+9]=t.layer; sRec[sAt+10]=data.length-17; sAt += SREC; }
      }
    }
    const seasonBase = keepSeason ? layerData.map(a => Float32Array.from(a)) : null;   // the UNCOMPACTED layer records, before the rewrite below touches a tau
    let litter = null, leafW = null;
    if(rec?.length){
      const REC = 10, n = rec.length/REC;
      // each leaf's place in the grove's order of light — and, as far as exposure_absolute says, its raw light — what the two maps in math.js
      // (and the drop day) take. It is the FULL summer set whatever has dropped: exposure is a season integral, not a function of who is
      // still hanging, so a leaf's day does not move as the season is read at another phenology.
      let u = null;
      if(FEAT_EXPOSURE && ordered(params)){
        const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), Ar = new Float64Array(n), K = new Float64Array(n);
        for(let i=0;i<n;i++){ X[i]=rec[REC*i]; Y[i]=rec[REC*i+1]; Z[i]=rec[REC*i+2]; Ar[i]=rec[REC*i+3]; K[i]=leafClock(params.seed, rec[REC*i+4], rec[REC*i+5]); }
        const ex = exposureGrid(X, Y, Z, Ar, E), rank = exposureRank(ex, K);   // K: the leaves nothing shades (e = 1) are ordered by their own clocks, not stacked on one rank
        u = exposureBlend(rank, ex, params.exposure_absolute);   // read below, never written: at exposure_absolute 0 it IS the rank the record keeps
        if(keepSeason){ sEx = ex; sRank = rank; }   // the same leaves in the same order as sRec (one push site), the same seed, clocks and E: what reseasonGrove would build
      }
      let alive = null, gone = 0;
      if(FEAT_DROP && isDropping){ litter = []; leafW = new Float32Array(nClusterTotal*nLeaf).fill(1); alive = new Uint8Array(n).fill(1); }
      for(let i=0;i<n;i++){
        const o = REC*i, j = rec[o+4], k = rec[o+5];
        const dT = tShift ? tShift[twigs[j].tree] : undefined, cT = tGain ? tGain[twigs[j].tree] : undefined;   // this leaf's tree: the hang loop's own pair
        let w = 1, D = 0;
        if(FEAT_DROP && isDropping){
          D = after ? dropDayAfterTurn(params, turnPhase(params, leafClock(params.seed, j, k), FEAT_EXPOSURE && isLit ? turnOrder(u[i]) : undefined), dT)
            : dropDay(params, dropPhase(dropHash(params.seed, j, k), u ? u[i] : 0, params.drop_exposure), dT);
          w = retention(D, params.phenology);
          leafW[j*nLeaf + k] = w;
        }
        if(!(FEAT_EXPOSURE && isLit) && w === 1) continue;                   // nothing about this leaf changed: its tau is already in the buffers
        const lt = FEAT_EXPOSURE && isLit ? leafTau(tau, params, params.seed, j, k, leafT, turnOrder(u[i]), redGain(u[i]), dT, cT) : FEAT_PIGMENT && sen ? leafTau(tau, params, params.seed, j, k, leafT, undefined, undefined, dT, cT) : tau;
        const cov = rec[o+6], cf = cov*w;                                    // §5.3: a leaf leaves by fading — cov <- cov.w scales its tau and the fade its ballistic shadow rides on together
        const d = layerData[rec[o+7]], li = rec[o+8], fi = rec[o+9];
        for(let c=0;c<3;c++){ d[li+c] = lt[c]*cf; faithData[fi+c] = lt[c]*cf; }
        d[li+8] = cf; faithData[fi+9] = cf;
        if(w === 0){
          alive[i] = 0; gone++;
          if(FEAT_LITTER) litter.push({ x: rec[o], y: rec[o+1], h: rec[o+2], D, tau: [lt[0], lt[1], lt[2]], size: [d[li-6], d[li-5]], j, k, fade: cov });   // its own statement: a build without the carpet still compacts, by the count of leaves that went and not by the list
        }
      }
      // A leaf with w = 0 is not a faint leaf, it is no leaf: compacted out of both buffers in one pass over the records, so a bare canopy
      // is not a bake of ten thousand empty quads (a zero-tau quad still costs one in the bake). Survivors keep their order, in both.
      if(gone){
        const keepL = layerData.map(() => []), keepF = [];
        for(let i=0;i<n;i++){
          if(!alive[i]) continue;
          const o = REC*i, li = rec[o+8] - 8, fi = rec[o+9] - 8, kl = keepL[rec[o+7]];
          for(let q=0;q<17;q++) kl.push(layerData[rec[o+7]][li+q]);
          for(let q=0;q<18;q++) keepF.push(faithData[fi+q]);
        }
        for(let l=0;l<nLayer;l++) layerData[l] = keepL[l];
        faithData = keepF;
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
      const S=68;   // 17 floats/leaf: [c.xy,A,B0][angle,tilt,swingGain,swingPhase][tau.rgb,clusterId (+ the outline in its fraction)][orbit.xyzw][iFade]
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5,1,gl.FLOAT,false,S,64); gl.vertexAttribDivisor(5,1);
      gl.bindVertexArray(null);
      return { vao, count: arr.length/17, buf };
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
      const S=72;   // 18 floats/leaf: the 16 bake floats + the continuous height + the fade
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,4,gl.FLOAT,false,S,0);  gl.vertexAttribDivisor(1,1);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,S,16); gl.vertexAttribDivisor(2,1);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3,4,gl.FLOAT,false,S,32); gl.vertexAttribDivisor(3,1);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,S,48); gl.vertexAttribDivisor(4,1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5,1,gl.FLOAT,false,S,64); gl.vertexAttribDivisor(5,1);
      gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6,1,gl.FLOAT,false,S,68); gl.vertexAttribDivisor(6,1);
      gl.bindVertexArray(null);
      faith.vao=vao; faith.buf=buf; faith.count=arr.length/18;
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
    // the outline's own texture, R16F: LEAF_SAMPLES θ across, one row per variant down. θ REPEATs (±π are one place), the variants CLAMP (a read between two rows is no leaf),
    // LINEAR in θ and no mips — a profile is read at its own resolution. 1×1 for the ellipse: bound and never sampled, because the shader's gate is a uniform branch.
    const leafTex = (() => {
      const tx = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx);
      if(shape) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, LEAF_SAMPLES, shape.rows, 0, gl.RED, gl.FLOAT, shape.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tx;
    })();
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
      for(let i=0;i<faithData.length;i+=18){ const x=faithData[i],y=faithData[i+1]; if(x<px0)px0=x; if(x>px1)px1=x; if(y<py0)py0=y; if(y>py1)py1=y; }
      for(const s of faith.segRest){
        if(s.ax<px0)px0=s.ax; if(s.ax>px1)px1=s.ax; if(s.ay<py0)py0=s.ay; if(s.ay>py1)py1=s.ay;
        if(s.bx<px0)px0=s.bx; if(s.bx>px1)px1=s.bx; if(s.by<py0)py0=s.by; if(s.by>py1)py1=s.by;
      }
      if(px0>px1){ const h=params.canopy_extent_m/2; px0=-h;py0=-h;px1=h;py1=h; }   // empty grove fallback
      faith.pminx=px0; faith.pmaxx=px1; faith.pminy=py0; faith.pmaxy=py1;
    }
    hier.leafW = leafW;   // abscission (§4.5): each leaf's retained weight by (twig, slot) for the tree preview, which scatters its own leaves; null at the gate
    const grove = { hier, layerVAO, clusterTex, clusterGeomTex, leafTex, shape, litter, key: seasonKey(params, faithful) };   // key: the structure it was grown for (see THE KEY)
    if(keepSeason){
      let sx0=1e18, sy0=1e18, sx1=-1e18, sy1=-1e18;   // the wood's share of the faithful AABB: the season never moves it
      for(const s of faith.segRest){
        if(s.ax<sx0)sx0=s.ax; if(s.ax>sx1)sx1=s.ax; if(s.ay<sy0)sy0=s.ay; if(s.ay>sy1)sy1=s.ay;
        if(s.bx<sx0)sx0=s.bx; if(s.bx>sx1)sx1=s.bx; if(s.by<sy0)sy0=s.by; if(s.by>sy1)sy1=s.by;
      }
      grove.season = { key: grove.key, rec: sRec, base: seasonBase, n: nClusterTotal*nLeaf, nLeaf, nLayer, nCluster: nClusterTotal, nTree, E, tau, seg: [sx0, sx1, sy0, sy1],
                       faithBuf: faith.buf, ex: sEx, rank: sRank, u: null, outL: null, outF: null };
    }
    return grove;
  }

  // Does this grove's cache still describe the params, and is the engine-global faith.* still its own? (see the header: THE KEY, GOTCHAS)
  const reseasonable = (g) => !!g?.season && g.season.faithBuf === faith.buf && g.season.key === seasonKey(params, faithfulOn());

  // The season arithmetic of buildGrove (the hang loop's tau, the rec rewrite, the compaction, the litter, leafW, the faithful AABB), re-run over g.season in ONE pass
  // on typed arrays. It must stay the same arithmetic as buildGrove's, call for call — reseason.test.js holds the bytes.
  function reseasonGrove(g, P = params){
    const S = g.season, n = S.n, rec = S.rec, nLeaf = S.nLeaf, nLayer = S.nLayer, tau = S.tau, leafT = [0,0,0];
    const sen = senescing(P), isLit = lit(P), isDropping = dropping(P), after = afterTurn(P);
    const tShift = (FEAT_PIGMENT || FEAT_EXPOSURE || FEAT_DROP) ? treeShifts(P, S.nTree) : null, tGain = (FEAT_PIGMENT || FEAT_EXPOSURE) ? treeGains(P, S.nTree) : null, twigs = g.hier.twigs;   // the trees' lead and depth: the build's own tables, from the tree count the record kept, guarded by the same tiers
    let u = null;
    if(n > 0 && FEAT_EXPOSURE && ordered(P)){   // mirrors buildGrove's gate for the light
      if(!S.rank){
        const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n), Ar = new Float64Array(n), K = new Float64Array(n);
        for(let i=0;i<n;i++){ const o = SREC*i; X[i]=rec[o]; Y[i]=rec[o+1]; Z[i]=rec[o+2]; Ar[i]=rec[o+5]; K[i]=leafClock(P.seed, rec[o+6], rec[o+7]); }
        S.ex = exposureGrid(X, Y, Z, Ar, S.E);
        S.rank = exposureRank(S.ex, K);
      }
      if(!S.u) S.u = new Float64Array(n);
      u = exposureBlend(S.rank, S.ex, P.exposure_absolute, S.u);   // at exposure_absolute 0 this IS the rank: read, never written
    }
    if(!S.outL){ S.outL = S.base.map(a => new Float32Array(a.length)); S.outF = new Float32Array(n*18); }
    const outL = S.outL, outF = S.outF, wL = new Int32Array(nLayer);
    const track = isDropping && n > 0;
    const litter = FEAT_DROP && track ? [] : null, leafW = FEAT_DROP && track ? new Float32Array(S.nCluster*nLeaf).fill(1) : null;
    let wF = 0, px0 = S.seg[0], px1 = S.seg[1], py0 = S.seg[2], py1 = S.seg[3];
    let lx0 = 1e18, ly0 = 1e18, lx1 = -1e18, ly1 = -1e18;   // the survivors' plan extent (doubles, like buildGrove's own scan of faithData)
    for(let i=0;i<n;i++){
      const o = SREC*i, j = rec[o+6], k = rec[o+7];
      const dT = tShift ? tShift[twigs[j].tree] : undefined, cT = tGain ? tGain[twigs[j].tree] : undefined;
      let w = 1, D = 0;
      if(FEAT_DROP && track){
        D = after ? dropDayAfterTurn(P, turnPhase(P, leafClock(P.seed, j, k), FEAT_EXPOSURE && isLit ? turnOrder(u[i]) : undefined), dT)
          : dropDay(P, dropPhase(dropHash(P.seed, j, k), u ? u[i] : 0, P.drop_exposure), dT);
        w = retention(D, P.phenology);
        leafW[j*nLeaf + k] = w;
      }
      const lt = FEAT_EXPOSURE && isLit ? leafTau(tau, P, P.seed, j, k, leafT, turnOrder(u[i]), redGain(u[i]), dT, cT) : FEAT_PIGMENT && sen ? leafTau(tau, P, P.seed, j, k, leafT, undefined, undefined, dT, cT) : tau;
      const cov = rec[o+8], cf = cov*w;
      if(w === 0){
        if(FEAT_LITTER) litter.push({ x: rec[o], y: rec[o+1], h: rec[o+2], D, tau: [lt[0], lt[1], lt[2]], size: [rec[o+3], rec[o+4]], j, k, fade: cov });
        continue;
      }
      const l = rec[o+9], li = rec[o+10], bl = S.base[l], dl = outL[l], at = wL[l];
      for(let q=0;q<8;q++){ const v = bl[li+q]; dl[at+q] = v; outF[wF+q] = v; }
      for(let c=0;c<3;c++){ const v = lt[c]*cf; dl[at+8+c] = v; outF[wF+8+c] = v; }
      for(let q=11;q<16;q++){ const v = bl[li+q]; dl[at+q] = v; outF[wF+q] = v; }
      dl[at+16] = cf; outF[wF+16] = rec[o+2]; outF[wF+17] = cf;
      wL[l] = at + 17; wF += 18;
      const x = rec[o], y = rec[o+1];
      if(x<lx0)lx0=x; if(x>lx1)lx1=x; if(y<ly0)ly0=y; if(y>ly1)ly1=y;
    }
    for(let l=0;l<nLayer;l++){
      const L = g.layerVAO[l];
      gl.bindBuffer(gl.ARRAY_BUFFER, L.buf);
      gl.bufferData(gl.ARRAY_BUFFER, outL[l].subarray(0, wL[l]), gl.DYNAMIC_DRAW);
      L.count = wL[l]/17;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, S.faithBuf);
    gl.bufferData(gl.ARRAY_BUFFER, outF.subarray(0, wF), gl.DYNAMIC_DRAW);
    faith.count = wF/18;
    if(lx0<px0)px0=lx0; if(lx1>px1)px1=lx1; if(ly0<py0)py0=ly0; if(ly1>py1)py1=ly1;
    if(px0>px1){ const h=P.canopy_extent_m/2; px0=-h;py0=-h;px1=h;py1=h; }   // empty grove fallback
    faith.pminx=px0; faith.pmaxx=px1; faith.pminy=py0; faith.pmaxy=py1;
    g.litter = litter; g.hier.leafW = leafW;
  }

  return { buildGrove, reseasonGrove, reseasonable };
}

// What a bake hands its program to draw a grove's leaves in THEIR shape: the outline's texture (unit 6: 0-3 are the layers, 4 and 5 the cluster textures), the
// gate (a uniform, per grove — a crossfade bakes an ellipse grove and a maple one in one pass) and the box the quad covers. The ellipse's box is (0, 0, 1, 1), which
// leaves the corner it scales to the bit (x·1 + 0), so the off state is the quad it always was. `u` is a program's own table: bake, faith and litter name them alike.
const NO_BOX = [0, 0, 1, 1];
export function bindLeafShape(gl, u, g){
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, g.leafTex); gl.uniform1i(u.leafTex, 6);
  gl.uniform1i(u.leafShape, g.shape ? 1 : 0);
  gl.uniform4fv(u.shapeBox, g.shape ? g.shape.box : NO_BOX);
}
