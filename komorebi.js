// ============================================================================
// Komorebi — shared WebGL2 engine, an ES module:  import { create } from "./komorebi.js".
// Pipeline: Source (point-sun cloud) -> Canopy (leaves baked to optical-depth
// layers) -> Transport (shift-multiply-sum) -> Look (tonemap). Motion: two wind
// bands over a trunk/limb/twig spring hierarchy. See komorebi-spec.md.
//
// The editor (index.html) and the reference player (player.html) both build
// on this. create() THROWS on missing WebGL2/float targets so callers can
// degrade: the editor shows the error, the player leaves its background blank.
//
//   const eng = create(canvas, { params, onFrame });
//   eng.params / .perf / .motion / .src / .fps   live state (read for a HUD)
//   eng.apply(scope)        re-run a rebuild: 'source'|'canopy'|'textures'|'bake'|'perf'|''
//   eng.setParams(obj)      merge a full param set and rebuild (no UI side effects)
//   eng.transitionTo(obj, {duration, onEnd})  cloud-bloom crossfade to a look (spec §9 "Scene transitions")
//   eng.trans               live transition state (active, t) — read for a HUD
//   eng.drawSourceInset()   debug overlay: the source point-sun cloud (editor only)
//   eng.drawTreeInset()     debug overlay: a 3D preview of the grown grove, swaying (editor only)
//   eng.onFrame             optional callback invoked after each rendered frame
// ============================================================================

const DEG = Math.PI / 180, TAU = Math.PI*2;
const MAX_SAMPLES = 48;
const BAKE_MIN = 768;   // floor auto_quality trims bake_resolution to below the knee (§9)
const MAX_LAYERS = 4;
// Woody occluder segments (trunk + main limbs incl. droop sub-segments); continuous-height analytic shadow,
// evaluated once per pixel (spec §4.5). The table is a TEXTURE now, not a uniform array, so this number costs
// texels rather than fragment uniform rows (§6) — it is no longer a budget constraint, it is an authored ceiling.
// IT STAYS AT 64 UNTIL SOMEONE CHOOSES OTHERWISE, and the reason is a measurement, not caution: 'the void' grows
// 192 level-≤1 segments and has been silently truncated to 64 for its whole life. Raising the cap does not free
// that look, it REPAINTS it — three times the wood it currently shows. That is a look decision, not a refactor's.
const MAX_OCC = 64;
// SKY VIEW (§4.9): the authored radiance scale for the SEEN source. The physical contrast between a sun disk and a
// blue sky is ~10^6, which neither an ACES tail nor a 13-tap glare kernel can carry — so what ships is a compressed
// stand-in, and this is the compression, stated once. It multiplies the sampler's own angular density (weight over
// solid angle), so the CORE:HALO ratio stays exactly the sampler's post-cloud energy split; only the absolute moves.
// 6e-3 puts the default 0.27° clear-sky disk a few stops over the ACES shoulder at exposure ~1 — unmistakably the
// sun, and bright enough to drive the veiling glare, without whiting out the frame when that pass spreads it.
const SKY_SUN_GAIN = 6.0e-3;
// Area shared by two circles, radii r1/r2, centres d apart — the eclipse's moon against the source's core disk and
// against its whole extent. Used only to renormalize the SEEN source's radiance (§4.9); the cast's own crescent comes
// from zeroing sample weights, which is a discrete estimate of this same area.
function lensArea(r1, r2, d){
  if(r2 <= 0 || r1 <= 0) return 0;
  if(d >= r1 + r2) return 0;                                  // disjoint
  if(d <= Math.abs(r1 - r2)) return Math.PI*Math.min(r1, r2)*Math.min(r1, r2);   // one contains the other
  const a1 = Math.acos(clamp((d*d + r1*r1 - r2*r2)/(2*d*r1), -1, 1));
  const a2 = Math.acos(clamp((d*d + r2*r2 - r1*r1)/(2*d*r2), -1, 1));
  return r1*r1*(a1 - Math.sin(2*a1)/2) + r2*r2*(a2 - Math.sin(2*a2)/2);
}
const FAITH_MAX_RATIO = 1.7;   // faithful-tree height cap (spec §4.5): max crown height:radius before crown_aspect. A broad tree (mr above mz/RATIO) keeps its natural height untouched; a NARROW tree (steep branches → tiny mr → runaway plan-fill scale → tens of metres tall) gets its height clamped to crown·RATIO·aspect. Lower = shorter narrow trees.
// Build flag. Raw/dev ES-module loads keep EDITOR=true; the player deploy bundle sets it false via
// `bun build --define:KOMOREBI_EDITOR=false`, which const-folds and dead-strips the editor-only debug
// overlays (their shaders, buffers, draw fns). typeof keeps an undefined-global load safe (= true).
const EDITOR = (typeof KOMOREBI_EDITOR !== "undefined") ? KOMOREBI_EDITOR : true;
const clamp = (x,a,b) => Math.min(b, Math.max(a, x));
const lerp = (a,b,t) => a + (b-a)*t;
const smoothstep = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
// shortest-arc interpolation for a periodic value (degrees->360, radians->TAU): 350°->10° goes +20°.
const lerpAngle = (a,b,t,period) => { const d=((b-a)%period + period*1.5)%period - period*0.5; return a + d*t; };

// ---- preset transitions (spec §9 "Scene transitions"). Params split two ways: MORPH ones are
// continuous and read live (or rebuild cheaply), so they tween frame-by-frame; everything else is
// STRUCTURAL — it regrows the grove or reallocates textures, so it can't interpolate and is instead
// snapped once at the transition's bloom peak, hidden under a transient widening of the source. ----
const MORPH_KEYS = [
  'core_angular_radius_deg','halo_angular_radius_deg','core_weight_fraction','cloud_thickness','eclipse_amount',
  'canopy_base_height_m','canopy_thickness_m','branch_tau','sky_scatter',   // layer heights + branch-shadow darkness + the sky view's foliage glow — read live, no rebuild
  // NOTE: canopy_base/thickness + trunk_radius_m tween live for the LEAF layers (layerHeights() is live), but the
  // analytic woody occluder's per-segment heights/radius (occ.ht) are baked in regenCanopy and only refresh on a
  // canopy regrow — so in a tier-1-only transition the wood lags the leaves until the next regen. (Off every shipped
  // look: branch_tau>0 only in park 1, which is faithful → analytic occluder gated off. Live occ.ht recompute = TODO.)
  'sun_elevation_deg','sun_azimuth_deg','view_extent_m','view_pitch_deg','view_fov_deg','view_yaw_deg','view_center_x','view_center_y','far_smear','trunk_radius_m','exposure','contrast',
  'ambient_skylight','sky_turbidity','mesopic_strength','chromatic_aberration',
  'ground_r','ground_g','ground_b',                                     // ground albedo (floor reflectance) — live look uniform, tweens in transitions
  'fabric_tt','fabric_tint_r','fabric_tint_g','fabric_tint_b',          // the receiver's fabric (handoff): brightness Tt + moss dye hue — continuous, tween live (the `receiver` gate itself is a scene-mode flag; see MODE_KEYS)
  'cloth_distance_m','fold_depth','fold_scale','fold_coarsen','fold_warp','velvet_sheen','fabric_scatter',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
  'tent_ridge_h_m','tent_half_w_m','tent_crown_w_m','tent_shoulder_h_m','tent_shoulder_w_m','tent_len_m','tent_end_lean','tent_end_apex_h_m','tent_hip_rake','tent_eye_h_m','tent_fade','tent_seam','tent_mesh',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
  'glow_bleed','glow_bleed_m',                                          // lateral-diffusion glow (§4.9): the sharp/blurred split + its cloth-metre radius. Continuous, so they tween — but the split crossing 0 adds/drops the HDR passes mid-tween, which is a pass-count change, not a look pop
  'mullion_tau','mullion_pitch_m','mullion_bar_m','mullion_depth_m',    // window mullion grid (§4.9): analytic cloth-space occluder — continuous live uniforms, tau 0 = off
  'window_w_m','window_h_m','window_cx_m','window_cy_m','window_wall',  // the window APERTURE (§4.9): the finite lit rectangle + its wall leak — continuous live uniforms, w·h = 0 = infinite light
  'wind_strength','wind_gustiness','wind_direction_deg','gust_frequency','weather_variability','weather_speed','gust_attack','gust_decay',
  'sway_stiffness','sway_ceiling','damping_ratio','backlash_gain','sway_height_gain',
  'limb_flex','twig_flex','stem_length','sway_pitch','leaf_swing','flutter_freq',
  'drift_amount','drift_phase','drift_speed',
];
const MORPH_SET = new Set(MORPH_KEYS);
const ANGLE_SET = new Set(['sun_azimuth_deg','wind_direction_deg','drift_phase']);   // interpolate the short way

// ---- canopy morph (the middle tier). With the SAME topology (counts + seed) the grove's RNG draws are
// identical frame-to-frame, so interpolating these continuous canopy knobs deforms the *same* grove
// smoothly (branches fan, leaves recolour/resize) — a true morph, no dissolve. It costs a per-frame
// regrow, so it only runs when the grove is small enough (CANOPY_MORPH_MAX leaves); else it falls back
// to the cloud dissolve. A change to any TOPO_KEY genuinely rearranges the grove (a new tree/layer/seed)
// and *can't* morph leaf-for-leaf, so it always dissolves. ----
const CANOPY_KEYS = [
  'tree_count',                                                       // continuous (spec §4.5): a fractional count grows a marginal tree in, so a tree-count transition MORPHS instead of dissolving
  'canopy_extent_m',                                                  // baked world size — only a regrow + re-bake (NO texture realloc), so it morphs continuously
  'branch_angle_deg','branch_length_ratio','branch_pitch_deg','foliage_density','leaves_per_cluster',
  'cluster_spread_m','leaf_size_m','leaf_aspect','max_tilt','edge_softness','trans_r','trans_g','trans_b','droop','taper_delta','crown_aspect',
];
const TOPO_KEYS = [   // these genuinely re-arrange the grove (different branching / depth / seed) — can't interpolate
  'branch_levels','branch_children','limb_count','layer_count','leader_strength','phyllotaxis',
  'tex_resolution','bake_resolution','seed','sample_count','eclipse',   // bake_resolution reallocs the layer textures like tex_resolution; eclipse: a false->true toggle turns every dapple to a crescent — hide it under a bloom
];   // (tone_map is a live uniform: it just snaps — under the bloom if one's already running, else at the end — never forces one)
// ---- scene-MODE flags. Not continuous (never tween) but NOT inert either: flipping one changes regen-time state
// (faithful_canopy reallocates faithTex + switches the bake path; standing_scene reshapes the bake's crown sizing;
// receiver swaps the whole camera mapping — floor ray-cast ↔ head-on cloth map ↔ enclosure ray-cast — and both re-aims
// the faithful cast frame and, at receiver 2, forces the layer tier, which reallocates the layer textures too;
// sky_view turns the camera over to look UP, which overrides the receiver outright and forces the layer tier for the
// same reason receiver 2 does — so it reallocates the layer textures and re-packs the grove's per-mode cluster data),
// so a transition landing on a differing flag must force a structural rebuild under the bloom — see transitionTo's
// modeDiff. Kept out of TOPO_KEYS (they don't change the grove RNG/topology) but treated like one for the rebuild. ----
const MODE_KEYS = ['standing_scene','faithful_canopy','receiver','sky_view'];
const CANOPY_MORPH_MAX = 80000;   // above this many leaf instances, fall back to the cloud dissolve (don't regrow per frame)

// ---- atmospheric colour: physical sun-disk + sky tint from solar elevation (spec §3.5). A cheap
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

// ---- default parameters. The editor edits a live copy; presets merge over this
// so old/partial JSON stays forward-compatible as new knobs are added. ----------
const DEFAULTS = {
  // Source
  sample_count: 32,
  core_angular_radius_deg: 0.27,   // the sun's half-angle (~0.5deg disk)
  halo_angular_radius_deg: 6.0,    // cloud aureole size at full cloud
  core_weight_fraction: 0.95,      // fraction of energy in the core when clear
  cloud_thickness: 0.15,           // MASTER breathing knob: drains core->halo, spreads halo
  eclipse: false,                  // proof test: dapples should turn crescent
  eclipse_amount: 0.55,
  // Canopy
  layer_count: 2,
  canopy_base_height_m: 8.0,
  canopy_thickness_m: 3.0,         // layers spread base .. base+thickness
  foliage_density: 1.0,
  // grown skeleton (spec §4.5): a GROVE of tree_count trees, each trunk -> limb_count arms ->
  // branch_children sub-branches, branch_levels deep -> twigs. Overlapping crowns fill the frame.
  tree_count: 5,                   // trees in the grove (>1 so crowns overlap and fill the centre)
  branch_levels: 3,                // recursion depth (1 = limbs are the twigs)
  branch_children: 3,              // sub-branches per node
  branch_angle_deg: 34,            // cone half-angle children fan from their parent
  branch_length_ratio: 0.62,       // child length / parent length
  branch_pitch_deg: 26,            // how steeply limbs rise from horizontal (sets the height spread)
  branch_tau: 0.0,                 // trunk+branch shadow (spec §4.5): per-channel optical depth stamped for the woody skeleton. 0 = OFF — leaves-only, byte-identical to the pre-branch looks (no geometry drawn); >0 = the tree casts its own silhouette. Wood is ~opaque & neutral, so one scalar covers RGB.
  leader_strength: 0.0,            // monopodial growth (spec §4.5): 0 = legacy single-hub (all limbs from one point — a palm/lollipop); >0 = limbs attach ALONG a continuing trunk, shorter toward the top → excurrent cone (high) vs decurrent dome (low). The excurrent↔decurrent axis (apical control).
  droop: 0.0,                      // gravitropic curve (spec §4.5): branches bend over sub-segments along their length. >0 = sag DOWN (willow/birch trailing twigs), <0 = upsweep (conifer/elm); stronger on outer orders, compounding toward the tips. 0 = straight rays (byte-identical).
  taper_delta: 2.0,                // pipe-model / Leonardo branch taper (spec §4.5): drawn branch half-width shrinks by children^(−1/Δ) per fork. ~2 = area-conserving (woody); high = stout (oak), low = lacy fast-thinning (birch). Silhouette-only (branch occluder), no dapple cost.
  crown_aspect: 1.0,               // crown height factor (spec §4.5): scales the crown's height. >1 taller (conifer/columnar), <1 broad dome (oak/cedar). A narrow tree's height is capped at crown_radius·FAITH_MAX_RATIO·aspect so it can't run away. Drives the faithful cast + 3D preview; the layer cast normalises height away (invariant).
  phyllotaxis: 'spiral',           // child-azimuth rule (spec §4.5): 'spiral' (golden angle — most trees), 'whorled' (even ring per node — conifer tiers), 'opposite' (paired forks 180° apart, decussate 90°/level — maple/ash).
  tree_species: '',                // INERT label (spec §4.5): the editor expands a TREE_SPECIES bundle into the shape knobs above and stamps the name here; the engine never reads it. '' = custom / no species picked.
  clusters_per_layer: 60,          // legacy (pre-skeleton); unused by the grown canopy, kept for preset compat
  leaves_per_cluster: 22,          // leaves per terminal twig
  cluster_spread_m: 0.13,
  leaf_size_m: 0.09,
  leaf_aspect: 1.6,
  max_tilt: 0.8,                   // orientation foreshortening amount
  edge_softness: 0.25,
  trans_r: 0.04, trans_g: 0.35, trans_b: 0.06,   // per-channel transmittance (green passes)
  canopy_extent_m: 12.0,           // world size of baked layers (>= view + 2*max shift)
  tex_resolution: 2048,
  bake_resolution: 1024,           // TUNE (§9): bake-pass / layer-texture size; 0 = follow tex_resolution. Ships at 1024 (cheaper-bake baseline). auto_quality trims it below the knee like samples; set 0 (follow) per look for a full-res bake.
  seed: 1234,
  // Transport
  sun_elevation_deg: 55,
  sun_azimuth_deg: 30,
  // Look
  view_extent_m: 4.0,              // vertical span of the visible ground (zoom = on-axis span, any tilt)
  view_pitch_deg: 16,              // camera tilt from straight-down (0 = top-down); gentle under-the-tree default
  view_fov_deg: 50,                // vertical FOV — perspective strength / lens
  view_yaw_deg: 0,                 // camera orbit about the vertical axis through frame centre (0 = unchanged); rotates which compass direction is "up the screen" on the floor — for making sense of the structure from the side
  view_center_x: 0, view_center_y: 0,   // camera PAN: world point the screen centre looks at (0,0 = frame centre) — walk the view around the floor (shift-drag), e.g. to put the tree out of frame and watch only its shadow
  // Standing-scene mode (spec §4.8): treat the trees as objects STANDING in a scene casting shadows on the floor,
  // rather than an infinite canopy hovering overhead (the park model). v1 adds the TRUNK shadow — a vertical
  // occluder the layered slab model can't cast (a vertical trunk has no horizontal footprint). Off = the park
  // model, byte-identical. Rooting the trees off to the side + an un-tiled lit floor is the next step.
  // SKY VIEW (spec §4.9): stop looking at what the light LANDS on and look at where it comes FROM. The eye lies on
  // the ground and gazes up: trunks converging overhead, crowns against the sky, the source itself visible through
  // the gaps. It is still pure transmission — the same occluder field, read along upward rays instead of sun rays —
  // and it overrides the receiver entirely (there is no surface, so no fabric, no ground, no seams). Off = every
  // look unchanged.
  sky_view: false,
  sky_scatter: 0.0,                // SKY VIEW (§4.9): how brightly the foliage GLOWS in its own right — single-scatter radiance from the light
                                   // reaching each layer from above, on top of the transmitted sky. 0 = pure transmission, byte-identical (a crown can only darken)
  standing_scene: false,           // opt-in: render the trunk as a real vertical occluder (its swept shadow streak)
  trunk_radius_m: 0.1,             // trunk thickness (m) → width of its shadow streak; the area light softens it along its length
  faithful_canopy: false,          // FAITHFUL TREE (spec §4.5): opt out of the depth-layer leaf cheat. Off = leaves binned to a
                                   // few flat slabs (the park fast path, byte-identical). On = each leaf casts from its OWN continuous
                                   // grown height (a per-sample geometry bake), so the cast shadow IS the preview tree — leaves sit on
                                   // their twigs, aligned with the woody occluder. Costs more; for the standing / curtain looks, not the park.
  // Receiver (curtain handoff / spec §4.x): the surface the LANDED IRRADIANCE answers. 0 = opaque diffuse FLOOR
  // (the park default — reflect off uGround; byte-identical). 1 = translucent woven CURTAIN — TRANSMIT the
  // irradiance through moss-velvet: Tt carries brightness, the dye only hue, so a dark velvet reads dim (not a
  // bright tinted gel). 2 = the ENCLOSURE (§4.9): the same fabric, but an A-frame stood AROUND the viewer — sloped
  // panels ray-cast per pixel, each lit by its own incidence on the sun. Only read when receiver≠0; the floor
  // stays the cheap fast path. Off → every look unchanged.
  receiver: 0,
  fabric_tt: 0.5,                  // fabric total throughput Tt∈[0,1] = BRIGHTNESS (sheer→~0.6, dark terciopelo→~0.1); hue is separate
  fabric_tint_r: 0.35, fabric_tint_g: 1.0, fabric_tint_b: 0.30,      // moss dye HUE (unit-peak; passes green ~550nm, absorbs red/blue — the chlorophyll-twin)
  cloth_distance_m: 0.0,           // curtain plane world-Y (its distance behind the tree); with the sun angle, sets where the tree's shadow lands on the cloth (§4.9)
  fold_depth: 0.0,                 // curtain drape: pleat SHADING — authored pile thickness on a flat plane (0 = flat cloth, up = deep velvet pleats); the geometry is fold_warp
  fold_scale: 2.5,                 // curtain drape: pleat frequency (how many pleats across the cloth)
  fold_coarsen: 0.25,              // curtain drape: how much the pleats widen toward the hem (heavy fabric, λ∝√depth)
  fold_warp: 0.0,                  // pleat GEOMETRY (§4.9): metres the pleat bulges out of the cloth plane, which BENDS the arriving
                                   // cast (dapples + mullion lines S-bend across the folds). Distinct from fold_depth, which is the
                                   // authored pile-thickness SHADING band on a flat plane — depth shades, warp displaces. 0 = flat cloth.
  velvet_sheen: 0.0,               // velvet grazing sheen on the fold ridges (0 = off; the cut-pile glow that reads as terciopelo)
  fabric_scatter: 0.0,             // forward-scatter share of the transmit: how much of the light DIFFUSES through the pile instead of threading it (0 = all ballistic, byte-identical; up = the glow wraps into the dark fold flanks)
  // LATERAL DIFFUSION (§4.9): the neighbour-reading half of the same physics — light spreading sideways THROUGH the
  // weave, which is the only thing that bleeds a hot dapple's glow across its own cast-shadow edge. THE GATE, and an
  // expensive one: >0 routes the frame through a linear-HDR target + two blur passes + a compositing tone-map tail.
  // 0 = the direct-to-screen draw, bit-identical, no extra passes allocated or run.
  glow_bleed: 0.0,                 // the SPLIT: out = mix(sharp, blurred, d) — energy-conserving, never an add (the forward-scatter wrap's discipline, one scale up)
  glow_bleed_m: 0.08,              // how far the weave carries light, in cloth METRES (weave-scale: ~0.03–0.15); converted to a pixel radius through the cloth mapping, so a zoom doesn't change the physics
  // WINDOW MULLION GRID (§4.9): the AUTHORED occluder, the inverse of the grown canopy — a rigid bar grid standing
  // centimetres off the cloth, so it sits deep in the SHAPE regime (you see the grid, sharp) while the tree's leaf-gaps
  // metres away stay pinhole (soft sun-images). Same sun, one frame, opposite regimes — set purely by occluder distance.
  // Analytic in cloth (u,v), the near-contact sibling of §4.5's woody occluder, so it works in BOTH curtain tiers.
  mullion_tau: 0.0,                // bar optical depth — THE GATE (0 = no window, byte-identical); ~2–3 reads as opaque painted wood
  mullion_pitch_m: 0.35,           // pane size: bar-to-bar spacing on the cloth (a sash window's 30–40 cm panes)
  mullion_bar_m: 0.025,            // glazing-bar width (m)
  mullion_depth_m: 0.04,           // how far the bars stand IN FRONT of the cloth (sun side) — sets BOTH the throw and the penumbra
  // THE WINDOW APERTURE (§4.9): the light has an EDGE. A finite bright rectangle of sky at the bar plane, opaque
  // wall around it — the macro contrast the §1 scene is built on, and the window FRAME the mullion grid was missing.
  window_w_m: 0.0,                 // aperture width (m) on the cloth — THE GATE with the height: w·h = 0 = infinite light, byte-identical
  window_h_m: 0.0,                 // aperture height (m)
  window_cx_m: 0.0,                // aperture centre across the cloth
  window_cy_m: 1.3,                // aperture centre up the cloth (a sill about waist-high)
  window_wall: 0.03,               // light landing OUTSIDE the aperture: the wall is opaque, so this stands in for the room's own dim
                                   // front-side light — without it the surround is a void rather than dark cloth
  // THE ENCLOSURE (§4.9), receiver 2: the same fabric as a CLOSED tent stood AROUND the viewer — a flat rectangular
  // crown along the top, a rounded ARCH per side (a convex profile curve sampled as tangent strips), a HIP CAP at the
  // far end (a small upright foot-vent triangle with two hips converging on its apex) and a plain leaning wall behind.
  // These twelve shape it; the fabric itself is the curtain family above (same cloth physics, same transmission law).
  // Only read when receiver == 2 — the floor and the curtain never touch them.
  tent_ridge_h_m: 1.15,            // crown height (m): the flat top panel's plane, and what the upper walls lean in to
  tent_half_w_m: 1.1,              // half the floor width (m): the skirts reach the ground at x = ±this
  tent_crown_w_m: 0.35,            // HALF the crown panel's width (m) — the brow pole's flat. 0 collapses it to a ridge line (the v1 A-frame)
  tent_shoulder_h_m: 0.62,         // height (m) of the ARCH's waypoint — where the vault bulges widest. Held inside [0.30, 0.70]·crown height, outside which the profile doubles back on itself
  tent_shoulder_w_m: 0.92,         // half-width (m) AT that height. BULGED past the straight base→crown line (0.70 m here) is what curves the side out into an arch; on the line exactly the arc flattens to one straight slope
  tent_len_m: 2.3,                 // tent length (m): the far cap's base, and what closes the space instead of a vanishing point. The eye rides at 30 % of it
  tent_end_lean: 0.6,              // metres an end wall leans OUT per metre of height (0 = a vertical end wall); large values push the ends away and degenerate toward the A-frame
  tent_end_apex_h_m: 0.55,         // height (m) of the far end's VENT APEX: the foot triangle stands from the floor up to here, and the two hips converge on it
  tent_hip_rake: 0.45,             // how much MORE steeply the far hips rake back than the end wall (m per metre of height). 0 puts all three far planes on one — the single leaning slab this replaced — so it is floored just above that
  tent_eye_h_m: 0.5,               // eye height (m) inside — sitting up in a sleeping bag; clamped strictly inside every panel, or the viewer is outside their own tent
  tent_fade: 0.06,                 // interior depth fade (1/m): a gentle depth cue down a metres-deep tent — the far cap is what closes the space
  tent_seam: 0.0,                  // panel-junction seam optical depth (0 = none): the dark taped lines at the crown's long edges, the ceiling's centreline spine at the foot, and the cap rims
  tent_mesh: 0.0,                  // how much the side panels ABOVE the shoulder hem are MESH rather than nylon: they pass less light and diffuse almost none of it (0 = one fabric all the way up, byte-identical)
  far_smear: 3.0,                  // far-field dapple smear: extra throw (m) per unit foreshortening; 0 = off, no effect top-down
  exposure: 1.3,
  contrast: 1.0,
  ambient_skylight: 0.5,
  sky_turbidity: 0.05,             // atmospheric haze β (Ångström); reddens low sun, desaturates dusk
  mesopic_strength: 0.6,           // Purkinje: how far rods cool the deep shade at dusk (0 off; gated to low sun)
  chromatic_aberration: 0.0,       // leaf-edge diffraction (θ∝λ): per-channel red/blue spread of the dapples (0 = off, presets untouched)
  tone_map: 2,                     // 0 none, 1 reinhard, 2 aces
  ground_r: 1.0, ground_g: 1.0, ground_b: 1.0,   // ground albedo (floor reflectance, spec §4.7): white floor by default — a few looks set a warm dirt
  // Wind — coherent band (spec §5.1)
  wind_pattern: 'gusty',           // broadband CHARACTER (steady|gusty|squally|choppy|lazy) — shape, shared knobs below
  wind_strength: 0.0,              // "how much": mean force amplitude
  wind_gustiness: 0.25,            // "how alive": turbulence intensity (σ/U) — steady ↔ gusty; deep lulls drive springback
  wind_direction_deg: 30,
  gust_frequency: 0.12,            // "how frequent": gust rate = lowest-octave frequency of the broadband signal
  weather_variability: 0.0,        // slow self-evolving weather: 0 = static (presets unchanged), up = day drifts calm↔gusty + veers
  weather_speed: 1.0,              // how fast the weather drifts (minute-scale at 1)
  gust_attack: 1.2,                // gust-edge asymmetry: rise time constant — sharper (shorter) than the decay below
  gust_decay: 2.5,                 // gust-edge asymmetry: decay time constant (field gusts rise sharper than they fall)
  sway_stiffness: 5.0,
  sway_ceiling: 0.4,
  damping_ratio: 0.25,
  backlash_gain: 1.0,
  sway_height_gain: 0.0,
  sway_pitch: 0.0,                 // 3-D lean (spec §5/§4.5): how far a limb's own PITCH spring — the second DOF, forced by the drag along the limb — foreshortens the heights of the leaves+wood on it, so they cast a SHORTER shadow. FAITHFUL-mode only (needs real heights); 0 = off, byte-identical (no height change, and the pitch DOF never integrates).
  limb_count: 8,
  limb_flex: 0.25,
  twig_flex: 0.35,
  stem_length: 0.5,
  leaf_swing: 0.7,
  flutter_freq: 1.4,
  // Leaf drift — incoherent band preview (spec §5.2)
  drift_amount: 0.0,
  drift_phase: 0.0,
  drift_auto: false,
  drift_speed: 0.4,
  // Debug / runtime
  auto_quality: false,             // watch fps; trim render resolution then samples to hold ~60 fps
  adaptive_motion: true,           // TUNE (§9): while motion is low, render the heavy passes at adaptive_idle_fps and re-present the rest. Ships on; set false for the unchanged direct-to-screen path.
  adaptive_idle_fps: 30,           // the reduced cadence adaptive_motion falls to in low-motion frames
  show_source: true,
  show_layer: false,
  show_layer_index: 0,
};

// ---- legacy parameter names (spec §9). A ★ look saved to local storage, or a JSON exported from any
// earlier build, is data the engine does not get to re-author — so a renamed knob has to keep loading
// forever. One map, applied at every door external params come through (create / setParams / transitionTo,
// and the editor's preset store). Engine-side there is exactly ONE spelling of each knob: nothing below
// reads an old name, and nothing ever writes one back out. ----
const LEGACY_KEYS = {
  curtain_tt: 'fabric_tt',   // the receiver's material family, renamed once the same cloth started serving three receivers
  curtain_tint_r: 'fabric_tint_r', curtain_tint_g: 'fabric_tint_g', curtain_tint_b: 'fabric_tint_b',
  curtain_scatter: 'fabric_scatter',
  curtain_diffuse: 'glow_bleed', curtain_diffuse_m: 'glow_bleed_m',
  curtain_distance_m: 'cloth_distance_m',
};
// Old key -> new key on a COPY, leaving the caller's object untouched (a preset object is shared: PRESETS
// entries are handed out by reference). Returns the argument itself when there is nothing to migrate, so the
// ordinary current-names case allocates nothing. A new key already present WINS — the old one is only dropped.
function migrateLegacy(obj){
  if(!obj || typeof obj!=='object') return obj;
  let out = obj;
  for(const old in LEGACY_KEYS){
    if(!(old in obj)) continue;
    if(out === obj) out = Object.assign({}, obj);
    const now = LEGACY_KEYS[old];
    if(!(now in obj)) out[now] = obj[old];
    delete out[old];
  }
  return out;
}

// ---- deterministic RNG so canopy is frame-stable & reproducible ------------
function mulberry32(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function makeGauss(rng){ return ()=>{ let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }; }
function hash3(a,b,c){ let h=(a^0x9E3779B1)>>>0;
  h=Math.imul(h^b,0x85EBCA6B)>>>0; h=Math.imul(h^c,0xC2B2AE35)>>>0;
  return (h^(h>>>15))>>>0; }

// ---- broadband wind signal (spec §5.1). Real wind is BROADBAND, not a single frequency — a single sine
// reads as a machine because all its energy sits at one period. A frame-stable fractal sum of octaves over
// TIME with per-octave amplitude gain G=2^(-H) gives a power spectrum ∝ f^-(2H+1): the Kolmogorov inertial
// subrange is -5/3, i.e. H=1/3 → G≈0.794 (the number that makes a noise sum *feel* like wind — between
// "pink" H=0 choppy and "brown" H=0.5 sluggish). Pure function of t → no per-frame RNG (all engine motion
// is deterministic-of-time & reproducible, spec §4.4). H is the per-pattern "character" knob below. -------
const VNOISE_STD = 0.496;                  // measured std of vnoise1 — normalizes fbm1 to ~unit std
function vnoise1(x){                       // smooth 1-D value noise -> [-1,1]
  const i=Math.floor(x), f=x-i, u=f*f*(3-2*f);
  const a=(hash3(i>>>0,0x9E37,0x85EB)>>>0)/4294967296;
  const b=(hash3((i+1)>>>0,0x9E37,0x85EB)>>>0)/4294967296;
  return (a+(b-a)*u)*2-1;
}
// fractal Brownian motion in time, normalized to ~UNIT STANDARD DEVIATION (octaves are decorrelated, so
// var(sum)=Σ amp²·var(vnoise); dividing by √(Σamp²)·VNOISE_STD gives σ≈1). Unit std is what makes the
// gustiness knob mean turbulence-intensity (σ/U) honestly — without it, gustiness was nearly inert.
function fbm1(t, freq, octaves, H){
  const G=Math.pow(2,-H); let sum=0, amp=1, a2=0, fr=freq;
  for(let i=0;i<octaves;i++){ sum+=amp*vnoise1(t*fr + i*19.7); a2+=amp*amp; amp*=G; fr*=2; }
  return a2>0 ? sum/(Math.sqrt(a2)*VNOISE_STD) : 0;
}
// ---- wind PATTERNS (spec §5.1): a few broadband CHARACTERS, all reading the SAME shared knobs (strength,
// gustiness, gust rate, direction, weather) but shaped differently inside. `H` = spectral slope (choppy↔
// silky), `octaves` = detail depth, `lean` = steady downwind mean fraction (low → deeper lulls that drive
// the springback through rest), `lat` = crosswind fraction (breaks the 1-D slide), `burst` = waveshape that
// spikes peaks & deepens lulls (clustered/intermittent gusts). Selected by name (`wind_pattern`). ----------
const WIND_PATTERNS = {
  steady:  { H:0.72, octaves:4, lean:0.55, lat:0.45, burst:0.0 },   // smooth rolling directional breeze
  gusty:   { H:0.34, octaves:5, lean:0.35, lat:0.75, burst:0.35 },  // Kolmogorov-ish, the natural default
  squally: { H:0.24, octaves:5, lean:0.22, lat:0.85, burst:0.7 },   // bursty, sharp rises, deep clustered lulls
  choppy:  { H:0.12, octaves:6, lean:0.30, lat:0.80, burst:0.25 },  // nervous fine high-freq, cold-front edge
  lazy:    { H:0.88, octaves:3, lean:0.62, lat:0.40, burst:0.0 },   // very slow faint stir (pairs with glisten)
};
// a smooth, spatially-varying, slowly-evolving wind force — sampled at each node's position. Returns the scalar
// downwind component (the only one the limb/twig loops ever read); the crosswind term it used to also compute
// and box into an array was always discarded, so this is the same number with half the trig and no per-node alloc.
function windNoise(x, y, t, k){
  return 0.7*(Math.sin(x*k + t*0.9) + 0.5*Math.sin(y*k*1.3 - t*1.4 + 1.7));
}

// ---- skeleton growth (spec §4.5): grow real 3D branch segments from a seed ----
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
// gravitropic droop of a branch (spec §4.5). dth<0 lifts it (upsweep). Guards a ~vertical heading (no plane to droop in).
function bendDown(dir, dth){
  const horiz = Math.hypot(dir[0], dir[1]);
  if(horiz < 1e-4) return dir;
  const a = clamp(Math.atan2(dir[2], horiz) - dth, -Math.PI*0.5, Math.PI*0.5);
  const ca = Math.cos(a);
  return [ ca*dir[0]/horiz, ca*dir[1]/horiz, Math.sin(a) ];
}

// ===========================================================================
// Shaders
// ===========================================================================
const VS_BAKE = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1] quad corner
layout(location=1) in vec4 iA;        // center.xy, A (long half), B0 (face-on short half)
layout(location=2) in vec4 iB;        // angle, restTilt, swingGain, swingPhase
layout(location=3) in vec4 iC;        // tau.rgb, clusterId (which twig — hierarchy lookup)
layout(location=4) in vec4 iD;        // orbit: ampX, ampY, orientation, phase (incoherent drift)
uniform vec2  uCanopyOrigin;          // -extent/2
uniform vec2  uCanopyExtent;          // (extent, extent)
uniform float uMorph;                 // drift phase (incoherent band, §5.2)
uniform float uMorphAmount;           // orbit radius scale (m)
uniform vec2  uSway;                  // trunk (coherent) translation for this layer (§5.1)
uniform highp sampler2D uClusterTex;  // per-clump dynamic bend angles (limb, twig) — radians
uniform highp sampler2D uClusterGeom; // per-clump static geometry: clump centre + trunk pivot
uniform float uWindLevel;             // signed sway fraction u(t) — drives leaf swing intensity
uniform float uWindTime;              // seconds, for leaf flutter
uniform float uLeafSwing;             // master: how far leaves rock as wind blows
uniform float uFlutterFreq;           // leaf flutter rate (Hz)
uniform float uStemLen;               // twig stem length: pivot offset toward the limb (swing, not spin)
out vec2 vLocal;
out vec3 vTau;
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  // ---- leaf rocks with the wind: footprint foreshortens -> dapple changes SHAPE (§4.5) ----
  float wm = abs(uWindLevel);
  float swing = uLeafSwing*swingGain*(0.5*uWindLevel + wm*sin(uWindTime*uFlutterFreq*6.2831853+swingPhase));
  float B = B0 * max(0.05, abs(cos(restTilt + swing)));
  // ---- incoherent drift orbit (fast, periodic) ----
  float th = uMorph + iD.w;
  vec2 lp = vec2(iD.x*cos(th), iD.y*sin(th));
  float co=cos(iD.z), so=sin(iD.z);
  vec2 drift = uMorphAmount * mat2(co,-so,so,co) * lp;
  // ---- branch hierarchy (§5): ROTATION about joints, not translation. The twig swings the clump
  // about a stem joint; the limb swings the whole clump as a rigid arc about the TRUNK (canopy
  // centre). A leaf inherits both, so clumps PIVOT and their leaves sweep arcs — not a slab slide. ----
  int cid = int(iC.w + 0.5);
  vec4 geom = texelFetch(uClusterGeom, ivec2(cid,0), 0);    // clump centre .xy, trunk pivot .zw
  vec3 bend = texelFetch(uClusterTex,  ivec2(cid,0), 0).xyz; // limb bend, twig bend, stem-angle seed
  vec2 C = geom.xy, BL = geom.zw; float thL = bend.x, thT = bend.y;
  // twig STEM: a base joint offset from the clump TOWARD the trunk. The twig SWINGS about a real
  // joint instead of spinning about its own centre — which removes the clump-scale vortex/swirl. (§5.1)
  vec2 d = C - BL; float Lr = max(length(d), 1e-3); vec2 radial = d/Lr;
  float sa = bend.z*0.6;                                    // per-twig spread so they don't lockstep
  float ca=cos(sa), sna=sin(sa);
  vec2 Jtwig = C - (mat2(ca,-sna,sna,ca)*radial) * min(uStemLen, Lr*0.9);  // joint between clump & trunk
  float ct=cos(thT), st=sin(thT);
  vec2 p    = Jtwig + mat2(ct,-st,st,ct)*(leafRest - Jtwig); // twig swings clump about its base joint
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,-sl,sl,cl)*(p - BL);            // limb swings clump about the trunk
  float ang = angle + thL + thT + 0.2*swing;               // leaf orientation rotates with the branch
  // ---- place the (foreshortened, rocked) leaf quad ----
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 world = base + uSway + drift + R*(aCorner*vec2(A,B));
  vec2 uv = (world - uCanopyOrigin)/uCanopyExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = aCorner;
  vTau = iC.xyz;
}`;

const FS_BAKE = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
uniform float uEdge;
out vec4 frag;
void main(){
  // soft elliptical leaf mask -> partial coverage at edges (honest area-averaging)
  float r = length(vLocal);
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  // additive: optical depth ADDS across overlaps (order-independent), unlike transmittance
  frag = vec4(vTau*cov, cov);
}`;

// FAITHFUL leaf bake (spec §4.5): the VS_BAKE body verbatim — same grow/flutter/bend, so the cast matches the
// preview — but each leaf is then sun-projected to the FLOOR at its OWN continuous grown height (world -= uG*iHeight,
// uG = this source sample's ground shift g_i), and mapped into the CAST frame (uFaithOrigin/uFaithExtent), which
// covers where the shadow LANDS (offset by the bulk throw), not the canopy plan. One per source sample → the
// "many suns" convolution done as geometry at continuous heights, so leaves sit on their twigs (no layer cheat).
const VS_FAITH = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1] quad corner
layout(location=1) in vec4 iA;        // center.xy, A (long half), B0 (face-on short half)
layout(location=2) in vec4 iB;        // angle, restTilt, swingGain, swingPhase
layout(location=3) in vec4 iC;        // tau.rgb, clusterId (which twig — hierarchy lookup)
layout(location=4) in vec4 iD;        // orbit: ampX, ampY, orientation, phase (incoherent drift)
layout(location=5) in float iHeight;  // FAITHFUL: this leaf's continuous floor-height (floorH of its grown z)
uniform vec2  uFaithOrigin;           // cast-frame origin (floor space)
uniform vec2  uFaithExtent;           // cast-frame extent (floor space)
uniform vec2  uG;                     // this source sample's ground shift g_i = uProj*sample + uBulkShift
uniform int   uCurtainBake;           // 1 = project onto the VERTICAL curtain plane (§4.9); 0 = the floor (byte-identical)
uniform float uClothY;                // curtain plane world-Y (cy) when uCurtainBake
uniform float uMorph;
uniform float uMorphAmount;
uniform vec2  uSway;
uniform float uHRef;                  // reference height: the coherent sway scales by iHeight/uHRef so the canopy bends as ONE piece anchored at the ground (matches the wood)
uniform highp sampler2D uClusterTex;
uniform highp sampler2D uClusterGeom;
uniform float uWindLevel;
uniform float uWindTime;
uniform float uLeafSwing;
uniform float uFlutterFreq;
out vec2 vLocal;
out vec3 vTau;
void main(){
  vec2 leafRest = iA.xy; float A = iA.z, B0 = iA.w;
  float angle = iB.x, restTilt = iB.y, swingGain = iB.z, swingPhase = iB.w;
  float wm = abs(uWindLevel);
  float swing = uLeafSwing*swingGain*(0.5*uWindLevel + wm*sin(uWindTime*uFlutterFreq*6.2831853+swingPhase));
  float B = B0 * max(0.05, abs(cos(restTilt + swing)));
  float th = uMorph + iD.w;
  vec2 lp = vec2(iD.x*cos(th), iD.y*sin(th));
  float co=cos(iD.z), so=sin(iD.z);
  vec2 drift = uMorphAmount * mat2(co,-so,so,co) * lp;
  int cid = int(iC.w + 0.5);
  vec4 geom = texelFetch(uClusterGeom, ivec2(cid,0), 0);
  vec4 bend = texelFetch(uClusterTex,  ivec2(cid,0), 0);   // .x limb bend, .y twig bend, .zw the sway_pitch height affine (see hEff)
  vec2 TB = geom.xy, BL = geom.zw;                         // TB = this twig's REAL grown base (faithful packs it where the layer path packs the tip)
  float thL = bend.x, thT = bend.y;
  // 3-D lean (§5.1): a wind-pitched limb lowers its leaves' height → shorter cast + less drift. The foreshorten is
  // ANCHORED at the limb's attach height: h' = attachH + (h−attachH)·fore, packed as the affine (.z, .w) =
  // (attachH·(1−fore), fore) so the shader is one madd. At the join h' = attachH exactly, so the pitching limb never
  // parts from the trunk axis (which does not pitch). GOTCHA — .z is MODE-dependent: publishBend writes this offset
  // only in faithful mode; on the layer path .z is the synthetic joint's stem seed and VS_BAKE reads it as such. The
  // two must agree per mode, and do because faithful_canopy is a MODE_KEYS flag (a flip rebuilds and republishes).
  float hEff = bend.z + iHeight * bend.w;   // sway_pitch off → (0, 1) → hEff = iHeight, byte-identical.
  // MEDIUM band (§5.4, "gaps morph and rearrange"): the twig swings its clump about TB — the SAME joint, by the
  // same angle and in the same order, that bakeFaithful's refill turns this twig's wood about. So leaf-on-wood
  // registration holds by construction, not by luck; that slip is why the band was dropped here before (§4.5).
  // TB is offset from the clump toward the parent by GROWTH, so it is a real stem joint and §5.1's anti-vortex
  // property comes for free — no uStemLen (the synthetic joint) and no bend.z spread: there is no made-up radial
  // direction left to decorrelate, the grown twig headings already differ. thT rides twig_flex → 0 = rest = byte-identical.
  // sway_pitch composes orthogonally: it only foreshortens iHeight (bend.w) and this is a plan-plane yaw.
  float ct=cos(thT), st=sin(thT);
  vec2 p = TB + mat2(ct,-st,st,ct)*(leafRest - TB);      // twig swings the clump about its own grown base
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,-sl,sl,cl)*(p - BL);          // the limb then swings that twig joint AND its clump about the trunk
  float ang = angle + thL + thT + 0.2*swing;             // orientation rotates with the branch → the footprint presents differently as it turns (§5)
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 world = base + uSway*(hEff/uHRef) + drift + R*(aCorner*vec2(A,B));   // coherent sway grows with height (0 at the ground) — leaves stay on their twigs, base anchored
  // project this leaf onto the RECEIVER along the sun-sample direction (uG.x, uG.y, 1). FLOOR (z=0): world - uG·h
  // (h→0; transport's layer loop adds +h·g to look UP — antipodal, so leaves land where the wood casts). CURTAIN
  // (vertical plane Y=uClothY, §4.9): drop onto the cloth → u = px - r·gx, v = h - r with r=(py-cy)/gy, so a
  // vertical trunk (constant py) casts a vertical line and the whole tree STANDS UP the cloth. Floor byte-identical.
  vec2 recvPt;
  if(uCurtainBake != 0){
    float gy = abs(uG.y) < 1e-3 ? (uG.y < 0.0 ? -1e-3 : 1e-3) : uG.y;   // guard: the sun must FACE the cloth (azimuth not ∥ to it)
    float rr = (world.y - uClothY) / gy;
    recvPt = vec2(world.x - rr*uG.x, hEff - rr);
  } else {
    recvPt = world - uG * hEff;
  }
  vec2 uv = (recvPt - uFaithOrigin)/uFaithExtent;
  gl_Position = vec4(uv*2.0-1.0, 0.0, 1.0);
  vLocal = aCorner;
  vTau = iC.xyz;
}`;

// FAITHFUL pass 1 (per sample): each leaf outputs its TRANSMITTANCE exp(-τ); drawn with multiplicative blend
// (dst *= src) so the scratch buffer ends at Π exp(-τ) = exp(-Σ τ) = the transmittance through the canopy for
// this one sun-sample. Soft edge → 1 at the rim (×1, no darkening), order-independent (multiply commutes).
const FS_FAITH = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTau;
uniform float uEdge;
out vec4 frag;
void main(){
  float r = length(vLocal);
  float cov = 1.0 - smoothstep(1.0-uEdge, 1.0, r);
  if (cov <= 0.0) discard;
  frag = vec4(exp(-vTau*cov), 1.0);
}`;

// FAITHFUL pass 2 (per sample): acc += w_i · transmittance_i, additive, fullscreen. Summed over all samples the
// accumulator holds Σ w_i·T_i — the soft shadow (same "sum of shifted sharp shadows" as transport's loop, but the
// shift is per-leaf-continuous and pre-integrated here so transport taps it ONCE).
const FS_FACC = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uFAccTex;
uniform float uFAccWeight;
out vec4 frag;
void main(){ frag = vec4(uFAccWeight * texture(uFAccTex, vUv).rgb, 1.0); }`;

// FAITHFUL skeleton (spec §4.5): the woody skeleton — trunk + branches + TWIGS — baked into the SAME faithful pass as
// the leaves, so the wood casts at its OWN continuous heights and connects leaves→twigs→limbs→trunk (no more floating
// trunk / invisible twigs). Each segment is a tapered capsule quad; BOTH endpoints carry their own floor-height &
// radius, so the quad shears + thins with the sun. Multiplicative blend, like the leaves → wood × leaves = one T_i.
const VS_FAITH_SEG = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;   // [-1,1]: x = along (a→b), y = ±across (width)
layout(location=1) in vec4 iSeg;      // plan endpoints: a.xy, b.xy
layout(location=2) in vec4 iSegH;     // a-height, b-height, a-radius, b-radius
uniform vec2 uFaithOrigin;
uniform vec2 uFaithExtent;
uniform vec2 uG;
uniform int  uCurtainBake;            // 1 = project onto the VERTICAL curtain plane (§4.9); 0 = floor
uniform float uClothY;                // curtain plane world-Y (cy) when uCurtainBake
uniform vec2 uSegSway;                // rigid plan sway added to both endpoints. The CAST path bakes its own
                                      // height-scaled sway into the instance data and leaves this at 0; the SKY
                                      // view's layer stamp needs the LEAF bake's per-layer sway instead, or the
                                      // twigs and the leaves hanging on them drift apart under wind (§4.9).
out float vAcross;
void main(){
  float t = aCorner.x*0.5 + 0.5;                 // 0 at a, 1 at b
  // project BOTH endpoints to the receiver at their OWN heights FIRST, then build the capsule around that SHADOW spine.
  // The width is ⊥ the streak, so a vertical trunk (no plan extent) still casts a round streak at every azimuth.
  // FLOOR: endpoint - uG·h. CURTAIN (§4.9): onto the vertical cloth → (px - r·gx, h - r), r=(py-cy)/gy.
  vec2 Ap, Bp;
  if(uCurtainBake != 0){
    float gy = abs(uG.y) < 1e-3 ? (uG.y < 0.0 ? -1e-3 : 1e-3) : uG.y;
    float rA = (iSeg.y - uClothY)/gy;  Ap = vec2(iSeg.x - rA*uG.x, iSegH.x - rA);
    float rB = (iSeg.w - uClothY)/gy;  Bp = vec2(iSeg.z - rB*uG.x, iSegH.y - rB);
  } else {
    Ap = iSeg.xy + uSegSway - uG*iSegH.x;
    Bp = iSeg.zw + uSegSway - uG*iSegH.y;
  }
  vec2 spine = Bp - Ap;
  vec2 dir = (dot(spine,spine) > 1e-8) ? normalize(spine) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float r = mix(iSegH.z, iSegH.w, t);            // pipe-model taper along the segment (thinner toward the tip)
  vec2 world = mix(Ap, Bp, t) + perp * (aCorner.y * r);
  gl_Position = vec4((world - uFaithOrigin)/uFaithExtent*2.0-1.0, 0.0, 1.0);
  vAcross = aCorner.y;
}`;

const FS_FAITH_SEG = `#version 300 es
precision highp float;
in float vAcross;
uniform float uWoodTau;
uniform int uSegTau;   // 0 = TRANSMITTANCE, for the cast's multiplicative scratch. 1 = OPTICAL DEPTH, for the layer
                       // textures, which accumulate additively and exponentiate at the tap — the leaves' own convention
out vec4 frag;
void main(){
  float cov = 1.0 - smoothstep(0.9, 1.0, abs(vAcross));    // tight anti-alias rim — keep THIN twigs opaque (the soft penumbra comes from the per-sample integration, not this edge)
  // THE LAYER STAMP WRITES ALPHA ONLY, and the zero in rgb is the whole fix rather than a tidiness: the layer
  // texture's rgb is the FOLIAGE's optical depth, and the sky view's scatter term reads its scattering density and
  // its hue from exactly that. Neutral wood dropped into rgb normalizes to a near-white hue at near-full density, so
  // the twig web lights up as cream filaments brighter than the sky it stands against. Wood occludes; it does not
  // glow. (Additive blend, so a zero in rgb leaves the leaves alone.)
  if(uSegTau != 0){ frag = vec4(0.0, 0.0, 0.0, uWoodTau*cov); return; }
  frag = vec4(vec3(exp(-uWoodTau*cov)), 1.0);              // wood blocks every colour equally → dark, neutral
}`;

const VS_FULL = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID==1)?3.0:-1.0, (gl_VertexID==2)?3.0:-1.0);
  vUv = p*0.5+0.5;
  gl_Position = vec4(p,0.0,1.0);
}`;

// ---- THE LOOK'S TAIL (§4.7), as one shared string. Exposure -> tone curve -> contrast -> gamma: the last thing
// that happens to a pixel, and the step the lateral-diffusion tier (§4.9) has to RELOCATE, because a 2-D spread of
// light must happen in linear HDR, before any of this. Two shaders now run it — transport when it draws straight to
// screen, the diffusion composite when it doesn't — so it lives here rather than twice: the two paths CANNOT drift
// into two different Looks, which is the only way the gate's off state stays bit-identical over time. ----
const GLSL_TONE_TAIL = `
uniform float uExposure;
uniform float uContrast;
uniform int   uToneMap;
vec3 reinhard(vec3 c){ return c/(1.0+c); }
vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
vec3 toneTail(vec3 col){
  col *= uExposure;
  if(uToneMap==1) col=reinhard(col);
  else if(uToneMap==2) col=aces(col);
  else col=clamp(col,0.0,1.0);
  col = clamp((col-0.5)*uContrast+0.5, 0.0, 1.0);
  return pow(col, vec3(1.0/2.2));
}`;

// ============================================================================
// THE TRANSPORT MASTER (spec §4.6 / §4.9) — ONE source, FOUR straight-line programs.
//
// Transport answers one question — how much of the source reached this point, and what does the surface it
// reached do with it — for four different cameras: the floor ray-cast, the cloth seen head-on, the enclosure
// polytope ray-cast from inside, and the sky view looking up. Those four used to be `if(uSkyView)/(uReceiver)`
// chains inside a single mega-shader, which meant every frame carried the uniform footprint and the branch
// weight of all four at once: 246 vec4 rows against WebGL2's guaranteed 224, and a fabric-family upload on
// every park frame.
//
// A camera is not a runtime decision. It is a MODE flag (MODE_KEYS), so it can only change through a full
// structural rebuild — which makes it a COMPILE-TIME selection. Below, the master is a set of named snippets,
// each carrying its own uniform declarations, and buildTransport(camera) emits the ones that camera actually
// runs. The branches do not get rewritten; they disappear by OMISSION, so within a variant every emitted line
// is the line the mega-shader ran. `uSkyView` and `uReceiver` do not survive into any variant at all: the
// branch they selected IS the build key.
// ============================================================================

// ---- the frame head, and the state EVERY camera reads: where the pixel is, where the canopy box is,
// what colour the light is, and the baked layers themselves. ----
const GLSL_T_HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform float uAspect;
uniform vec2  uViewCenter;        // camera PAN: world point the screen centre looks at (0 = frame centre). Lets you walk the view around the floor.
uniform vec2  uCanopyOrigin;
uniform vec2  uCanopyExtent;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform highp sampler2D uLayer[${MAX_LAYERS}];   // highp: optical depth exceeds lowp's ~[-2,2]
uniform float uLayerHeight[${MAX_LAYERS}];
uniform int   uLayerCount;`;

// ---- the three RAY cameras (floor, enclosure, sky) build a direction from pitch/fov and spin it by yaw.
// The cloth is seen head-on and builds no ray at all, so it declares none of them. ----
const GLSL_T_RAY_VIEW = `uniform float uPitch;            // camera tilt from straight-down (rad); 0 = top-down (reduces to the old ortho map)
uniform float uFov;              // vertical full FOV (rad) — perspective strength / lens
uniform float uViewYaw;          // camera orbit about vertical (rad); rotates the sampled floor about frame centre. 0 = unchanged`;

// ---- the layer read every CAST camera makes (floor, cloth, enclosure): optical depth -> transmittance. ----
const GLSL_T_TAP = `vec3 tap(highp sampler2D t, vec2 world){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  return exp(-texture(t,uv).rgb);   // optical depth -> transmittance
}`;

// ---- THE SOURCE SAMPLES and the per-unit-height ground shift: the many-suns integral of §4.2/§4.6. The sky
// view is the one camera that never runs it — it reads the field along the EYE's rays, not the sun's — and
// dropping this block is most of why that variant costs 88 fewer uniform rows than the floor. ----
const GLSL_T_TRANSPORT_DECLS = `#define MAX_SAMPLES ${MAX_SAMPLES}
uniform vec3  uSamples[MAX_SAMPLES];   // xy = angular offset (rad), z = weight (sum=1)
uniform int   uSampleCount;
uniform mat2  uProj;                    // angular->ground per unit height (ellipse + shear)
uniform vec2  uBulkShift;               // STANDING SCENE (§4.8): bulk lateral shadow offset per unit height = cot(elev)·(anti-sun dir).
                                        // The park model omits this (shadows sit directly under the canopy, only stretched) — invisible for
                                        // an infinite canopy, but a discrete tree needs its shadow CAST to the side. 0 = park model, unchanged.`;

// ---- the woody occluder's segment table. Read by all four cameras: three cast it as a shadow, the sky view
// reads the very same segments as GEOMETRY (§4.9). 128 vec4 rows — the single biggest item in every
// variant's footprint, and the reason none of them gets small. ----
const GLSL_T_OCC_DECLS = `// WOODY OCCLUDER (spec §4.5): the trunk + main limbs as CONTINUOUS-height analytic segments. Each carries its two
// endpoints' plan positions and their HEIGHTS above the floor; the per-sample shadow runs from a's projection to b's,
// so a limb's base meets the trunk at a shared height and the whole skeleton shadow stays CONNECTED — unlike the
// layer-stamped branches (now retired), whose discrete-height quantization shattered continuous lines at a low sun.
// THE TABLE IS DATA, NOT UNIFORMS. Two vec4[${MAX_OCC}] arrays would be ${MAX_OCC * 2} vec4 rows of the fragment budget in EVERY
// variant — the segment table was over half of WebGL2's guaranteed 224 all by itself, and it is what kept the
// enclosure over that floor. It is one RGBA32F texture instead: row 0 = the plan endpoints (refilled per frame with
// the limb swing), row 1 = the static heights + radius. texelFetch on RGBA32F is exact — no filtering, no format
// conversion — so the shader reads the identical float32s the uniform upload used to carry, and the cap becomes a
// number the budget no longer has an opinion about.
uniform highp sampler2D uOccTex;     // (k,0) = plan endpoints a.xy, b.xy;  (k,1) = a-height, b-height (above floor), radius, _
uniform int   uOccCount;             // 0 = off (no wood / park model), byte-identical
uniform float uOccTau;               // wood optical depth (= branch_tau); 0 = off
uniform vec2  uOccSway;              // whole-tree drift, matching the leaf bake
uniform float uOccHRef;              // reference height: the drift scales by H/uOccHRef so the trunk FOOT (H=0) stays planted and the crown sways — matches the faithful wood, not a bodily slide`;

const GLSL_T_WOOD_CAST_DECLS = `uniform float uOccPenumbra;          // soft-edge growth per unit height (fakes the area-light penumbra for the once-per-pixel eval)`;

// ---- leaf-edge diffraction (§3.6), a per-channel re-read of the same layers. Cast cameras only. ----
const GLSL_T_CA_DECLS = `uniform vec3  uChroma;            // per-channel diffraction spread of the transport shift (θ∝λ); (1,1,1) = off
// edge diffraction (spec §3.6): light bends round each leaf edge by an angle ∝ λ, so red spreads wider than
// blue — each channel reads its sun-image at a shift scaled by its own wavelength (cs = per-channel scale,
// green=1). The colour fringe lands at every leaf/dapple edge and rides the same H*g shift, so it grows with
// canopy height and the low-sun ellipse for free. Three single-channel taps; only taken when diffraction is on.
vec3 tapCA(highp sampler2D t, vec2 world, vec2 g, float H, vec3 cs){
  float aR = texture(t, (world + H*g*cs.r - uCanopyOrigin)/uCanopyExtent).r;
  float aG = texture(t, (world + H*g*cs.g - uCanopyOrigin)/uCanopyExtent).g;
  float aB = texture(t, (world + H*g*cs.b - uCanopyOrigin)/uCanopyExtent).b;
  return exp(-vec3(aR,aG,aB));      // per-channel optical depth -> transmittance, each at its dispersed path
}`;

// ---- the FAITHFUL tap (§4.5): one pre-integrated texture instead of the sample loop. Floor and cloth only —
// the pre-bake needs ONE flat cast frame, which the enclosure's panels and the sky view's rays are not. That
// used to be a runtime guard inside the mega-shader; here those two variants simply do not carry it. ----
const GLSL_T_FAITH_DECLS = `// FAITHFUL path (spec §4.5): the opt-out from the depth-layer leaf cheat. uFaithTex is the per-sample bake's
// pre-integrated soft shadow (transmittance), in the CAST frame (covers where the shadow lands, offset by the bulk
// throw). uFaithful 0 = the layer loop below runs, byte-identical (park / overhead default).
uniform highp sampler2D uFaithTex;
uniform int   uFaithful;
uniform vec2  uFaithOrigin;
uniform vec2  uFaithExtent;
vec3 tapFaith(vec2 world){ return texture(uFaithTex, (world-uFaithOrigin)/uFaithExtent).rgb; }   // already transmittance (pre-integrated over the disk), no exp`;

// ---- the raw unit sun vector. The floor never needs it (its throw rides uProj/uBulkShift); the fabric's fold
// incidence, the enclosure's per-panel beam and the sky view's seen source all do. ----
const GLSL_T_SUN_DIR_DECLS = `uniform vec3  uSunDir;            // UNIT sun direction (cos el·cos az, cos el·sin az, sin el) — the fold flanks' incidence basis (§4.9); NOT a 1/sin E throw`;

// ---- the tail every variant shares: the mesopic shift, the distance haze, and the Look (§4.7). ----
const GLSL_T_POST_DECLS = `uniform float uTwilight;          // global "sun is low" rod weight (from elevation, §3.5)
uniform float uMesopic;           // Purkinje strength (the mesopic_strength knob)
uniform vec3  uHazeColor;        // linear-HDR distance haze the far floor dissolves into (§4.7)
uniform int   uLinearOut;         // 0 = end the Look here and write display-encoded colour (every look, unchanged). 1 = write LINEAR HDR
                                  // instead: the lateral-diffusion tier (§4.9) must spread light BEFORE the curve, so it runs toneTail itself after the blur.
${GLSL_TONE_TAIL}`;

// ---- FLOOR camera (§4.7) ----
const GLSL_T_FLOOR_DECLS = `uniform float uViewExtent;
uniform float uFarSmear;         // far-field dapple smear (m of extra throw per unit foreshortening, §4.7)
uniform vec3  uGround;            // ground albedo (floor reflectance); (1,1,1) = white floor (old look)`;

const GLSL_T_FLOOR_CAMERA = `    // ---- tilted pinhole camera (spec §4.7): fragment -> ground point on z=0, plus a far-field haze factor.
    // At uPitch=0 this reduces EXACTLY to the old orthographic map (vUv-0.5)*uViewExtent*[aspect,1] for any
    // fov (a flat plane seen straight-on is linear), so presets are untouched until tilted. ----
    float cp=cos(uPitch), sp=sin(uPitch);
    float kf=max(tan(0.5*uFov), 1e-4);                 // image-plane half-extent (guard fov->0)
    float sxc=(vUv.x-0.5)*uAspect, tyc=(vUv.y-0.5);
    vec3 d = vec3(2.0*kf*sxc, 2.0*kf*tyc*cp + sp, 2.0*kf*tyc*sp - cp);   // ray = fwd + 2k*(sx*right + ty*up)
    // camera height is degenerate for a flat floor (it only scales the view, which the uViewExtent hold
    // below cancels exactly), so it's fixed at 1 rather than exposed — eye height would have no effect.
    float scale = uViewExtent*cp*cp / max(2.0*kf, 1e-4);               // hold the on-axis vertical span = uViewExtent
    float targetY = sp/max(cp,1e-4);                                    // recenter: screen centre -> world (0,0)
    // far-field smear (spec §4.7): under a tilted gaze a pixel covers a growing patch of ground toward the
    // horizon; point-sampling it aliases the dapple, so we widen the soft-shadow throw by that ground footprint.
    // det(dworld/dvUv) = uViewExtent^2 * cp^4 * aspect / D^3 with D=-d.z, so the footprint's linear size goes as
    // 1/D^1.5; referenced to the nearest row (D_ref=cp+kf*sp) it is exactly 0 at pitch 0 (uniform footprint, so
    // top-down presets are untouched) and grows toward the horizon. Reusing uProj's g keeps the smear down-sun.
    if (d.z >= -1e-4){ world=vec2(0.0); fog=1.0; }                       // ray at/over the horizon -> all haze
    else {
      float lam = -1.0/d.z;                                             // ray .. ground-plane (z=0) intersection
      world = vec2(scale*lam*d.x, scale*(lam*d.y - targetY));
      float halfExtent = 0.5*uViewExtent*max(length(vec2(uAspect,1.0)),1e-4);
      fog = smoothstep(1.15*halfExtent, 3.0*halfExtent, length(world));  // 0 across the whole frame at pitch 0
      float Dref = cp + kf*sp;                                          // footprint of the nearest visible row
      float fore = clamp(pow(Dref/max(-d.z,1e-4), 1.5) - 1.0, 0.0, 4.0); // 0 at pitch 0 & frame bottom; up toward horizon
      extraThrow = uFarSmear * fore;                                     // extra throw -> wider, softer down-sun penumbra far off
    }
    // camera orbit (uViewYaw): rotate the sampled floor about frame centre — a true orbit for a flat floor (the
    // tilt/foreshortening axis stays put, the world spins under it). The sun-shift g stays in WORLD space below,
    // so shadows remain physically cast as the gaze turns. 0 → identity, byte-identical to the pre-yaw look.
    if(uViewYaw != 0.0){ float cy=cos(uViewYaw), sy=sin(uViewYaw); world = mat2(cy,-sy,sy,cy)*world; }
    world += uViewCenter;            // camera pan: shift the looked-at floor point (0 = unchanged)`;

const GLSL_T_FLOOR_MATERIAL = `    col = (acc*uSunColor + uAmbient) * uGround;            // OPAQUE FLOOR — literal old expression, byte-identical`;

// ---- CLOTH camera (§4.9): the curtain, seen head-on ----
const GLSL_T_CLOTH_DECLS = `uniform float uViewExtent;
uniform float uClothY;            // curtain receiver: the cloth plane's world-Y (its distance behind the tree) — where on the occluder field the shadow lands`;

const GLSL_T_CLOTH_CAMERA = `    // ---- CURTAIN receiver (spec §4.9): the receiver is a VERTICAL plane viewed head-on, NOT the floor. Screen
    // maps straight to the cloth's own coords — u across, v up. The tree's shadow is then projected onto the plane
    // by the (layerHeight - recvZ) height factor in the sample loop below: an occluder a height (h-v) ABOVE this
    // cloth point throws its shadow here, so the pattern stands UP the curtain instead of lying flat on the floor.
    // recvZ = 0 is the floor and leaves that loop byte-identical. TWO cloth coords from here on: clothUV is where
    // this point IS on the cloth (the pleats are attached to it — all shading reads this), castUV is where the
    // pleat's displacement makes the incoming light field arrive from (§4.9's fold warp — every occluder read). ----
    vec2 cuv = (vUv-0.5)*uViewExtent*vec2(uAspect,1.0) + uViewCenter;  // pan/zoom frame the cloth (view_center, view_extent)
    clothUV = cuv;                       // cloth (u across, v up) — the faithTex is baked in THESE coords (§4.9), tapped once below
    foldF = foldField(cuv);              // the drape, once (§4.9)
    castUV = cuv + foldThrow(foldF.x);   // fold warp: the same point's read into the FLAT-baked cast (== cuv when fold_warp 0)
    // the layer path is a PLAN-space read, so carrying the warp in (world.x, recvZ) is exact rather than a stand-in:
    // sliding the receiver point along its own ray lands the occluder lookup world.xy + (h-recvZ)·g on the identical
    // plan point the displaced cloth point sees. The analytic wood then follows for free (it reads world/recvZ too).
    world = vec2(castUV.x, uClothY);   // the cloth plane spans world-X; its world-Y (distance behind the tree) is uClothY
    recvZ = castUV.y;                    // height up the cloth (layer-path fallback; the faithful curtain uses castUV)`;

// ---- the pleat WARP and the cloth-facing throw it shares with the window: curtain-only, because both are
// cast against a flat plane at world-Y cy — an object the enclosure does not have (§4.9). ----
const GLSL_T_WARP_DECLS = `// the sun's cloth-facing throw component, guarded (§4.9). Sun ∥ to the cloth ⇒ gy→0 and every cloth-space throw
// (mullion bars, fold warp) diverges; the clamp keeps the sign so the throw still rakes the right way. Shared so
// the two consumers can't clamp differently.
float clothGy(){ return abs(uBulkShift.y) < 1e-3 ? (uBulkShift.y < 0.0 ? -1e-3 : 1e-3) : uBulkShift.y; }
// FOLD WARP (spec §4.9) — pleat displacement bends the arriving cast. The whole light field (faithful tap, layer
// reads, mullion) is baked/derived against a FLAT cloth at Y=cy. A pleated point sits Δy out of that plane, so it
// intercepts a different ray: the flat-cast plane is then Δy of DEPTH away from it, and the throw is literally
// mullionT's — cloth + (depth/gy)·(gx,1), one central ray up-sun, with Δy standing in for the bar depth. Sign
// convention that makes that identity exact: Δy > 0 bulges the pleat toward the ROOM (away from the sun side), so
// the flat plane sits in FRONT of it exactly as the bars do.
vec2 foldThrow(float shape){
  if(uFoldWarp == 0.0) return vec2(0.0);                                   // flat cloth: no displacement, byte-identical
  float dy = uFoldWarp * shape;                                            // Δy: the pleat's bulge out of the plane
  return (dy / clothGy()) * vec2(uBulkShift.x, 1.0);
}`;

// ---- the WINDOW (§4.9): mullion grid + aperture, both curtain-only for the same reason as the warp. ----
const GLSL_T_WINDOW_DECLS = `uniform vec4  uMullion;           // window mullion grid (§4.9): pitch, bar width, depth in FRONT of the cloth (m), tau. .w = 0 = off
uniform float uMullPenumbra;      // mullion soft edge (m on the cloth) = depth × the source's angular width, CPU-side
uniform vec4  uWindow;            // window aperture (§4.9): HALF width, HALF height, centre x, centre y — cloth metres. .x*.y = 0 = infinite light, off
uniform float uWindowWall;        // light landing outside the aperture (the room's own dim front-side leak; the wall itself is opaque)
// window MULLION GRID (spec §4.9): the authored near-cloth occluder — a rigid grid of vertical + horizontal bars
// standing uMullion.z metres in FRONT of the cloth (sun side), evaluated analytically per pixel in cloth (u,v).
// It is §4.5's woody occluder at centimetre range instead of metres, which is the whole point: at this d the
// aperture beats d·θ by orders of magnitude, so the grid lands in the SHAPE regime — sharp bars — inside the same
// frame where the leaf-gaps metres away are pinhole sun-images. The grid is bounded by the window APERTURE below
// (conf), because the bars are part of the window: past its frame there is wall, and a wall carries no glazing bars.
// THROW: the bar plane sits at world-Y cy+d, so along the central ray it drops r = d/gy to reach the cloth — the
// same projection VS_FAITH's curtain branch casts with (u = px − r·gx, v = h − r), inverted here to ask which bar
// point shadows THIS cloth point: (u,v) + r·(gx,1). One vector, so the grid rakes with the sun exactly as the
// trunk's cast does, just ~1/60th as far. Single central ray, no per-sample integration: at centimetre depths the
// spread across the source disk is sub-millimetre on the cloth, which the penumbra below already stands in for.
// PENUMBRA: depth × the source's angular width — deliberately WITHOUT the woody occluder's 1/sin(elevation)
// obliquity factor: the cloth is viewed head-on, so a bar's shadow is never smeared along a receding plane.
float mullionT(vec2 cloth, float conf){
  vec2 bar = cloth + (uMullion.z/clothGy()) * vec2(uBulkShift.x, 1.0);   // the bar-plane point whose shadow lands here
  float p = max(uMullion.x, 1e-3), hw = 0.5*uMullion.y;
  vec2 d = abs(mod(bar + 0.5*p, p) - 0.5*p);                             // distance to the nearest bar centre, per axis
  float pen = max(uMullPenumbra, 1e-3*p);   // a bar AT the cloth casts a geometrically hard edge; keep a hairline so smoothstep stays well-defined and the edge doesn't crawl. Well under the physical penumbra at any real depth, so it never softens the look.
  vec2 cov = 1.0 - smoothstep(vec2(hw), vec2(hw + pen), d);              // soft edge grows OUTWARD, like the wood's
  return exp(-uMullion.w * max(cov.x, cov.y) * conf);                    // union of the two bar sets: a crossing is still one bar deep. conf = 1 with no aperture, so the infinite grid is byte-identical
}
// THE WINDOW APERTURE (spec §4.9) — the light gets an EDGE. Behind the cloth is not an infinite lit field but a
// finite bright rectangle of sky in an opaque wall, and that macro contrast is most of the §1 composition. Evaluated
// at the SAME warped cast coordinate and the SAME bar-plane throw the mullion uses, because the aperture IS the
// window's outermost frame member: its edge S-bends across the pleats exactly as the glazing bars do, and that
// consistency is what makes the wall read as being behind the same cloth. Soft edge = the mullion penumbra, the same
// depth × the same source, so frame and bars blur together as cloud thickens.
// Returns (mask, inside): mask scales the landed irradiance — leak outside, full light within; inside confines the
// bar grid to the glazing so no fishnet crawls across the wall.
vec2 windowMask(vec2 cloth){
  vec2 ap = cloth + (uMullion.z/clothGy()) * vec2(uBulkShift.x, 1.0);    // the aperture-plane point whose shadow lands here
  vec2 d = abs(ap - uWindow.zw) - uWindow.xy;                            // per-axis signed distance to the rect edge (<0 = inside)
  float pen = max(uMullPenumbra, 1e-4);                                  // bars AT the cloth give a hard edge; a hairline keeps smoothstep well-defined
  vec2 t = 1.0 - smoothstep(vec2(-pen), vec2(0.0), d);                   // the wall's coverage grows OUTWARD from the geometric edge, like the bars' and the wood's
  float inside = t.x*t.y;
  return vec2(uWindowWall + (1.0 - uWindowWall)*inside, inside);
}`;

const GLSL_T_WINDOW_APPLY = `    // The window grid attenuates the WHOLE landed irradiance, not just the beam. A bar metres away (the wood, §4.5)
    // blocks only the sun's small disk, so it multiplies acc alone and the skylight still reaches around it. A bar
    // CENTIMETRES off the cloth subtends nearly the entire hemisphere seen from the point behind it — beam and
    // skylight both — so it scales E. That distinction is the physics of a near-contact occluder, not a shortcut.
    // castUV, not clothUV: the bars are one more plane in FRONT of the cloth, so a displaced pleat sees them at
    // depth (bar depth + Δy) — which is exactly what mullionT's own throw adds on top of the warped coord. The
    // grid's straight lines S-bending across the pleats is the fold warp's defining image. The APERTURE takes E for
    // the same near-contact hemisphere reason the bars do — a wall centimetres off the cloth shuts out beam and sky
    // alike — and it bounds the grid, since the bars are the window's and the wall has none.
    // BOTH ARE CURTAIN-ONLY. They are cast by a central-ray throw in cloth (u,v) against a plane at world-Y cy — the
    // enclosure has no such plane (its world-Y comes out of the ray cast) and no head-on map to read the throw in,
    // so a window in a tent would be drawn in coordinates that mean nothing there.
      float barConf = 1.0;                                 // 1 = infinite window, the grid runs edge to edge (byte-identical)
      if(uWindow.x*uWindow.y > 0.0){
        vec2 win = windowMask(castUV);
        barConf = win.y;
        E *= win.x;
      }
      if(uMullion.w > 0.0) E *= mullionT(castUV, barConf);`;

// ---- THE FABRIC (§4.9), shared by the two cloth receivers: the same material answering on a hanging
// curtain and on a tent stood around the viewer. ----
const GLSL_T_FABRIC_DECLS = `uniform float uTt;                // curtain total throughput Tt∈[0,1] — carries BRIGHTNESS (hue is uFabricTint)
uniform vec3  uFabricTint;        // moss dye — HUE only; normalized to unit peak in-shader so it can't smuggle brightness past Tt
uniform float uFoldDepth;         // curtain drape: pleat SHADING — authored pile thickness on a flat plane (0 = flat cloth, no folds); displacement is uFoldWarp
uniform float uFoldScale;         // curtain drape: pleat frequency (pleats per metre near the top)
uniform float uFoldCoarsen;       // curtain drape: how much the pleats widen toward the hem (heavy fabric)
uniform float uFoldWarp;          // pleat DISPLACEMENT amplitude (m) out of the cloth plane — geometry, not shading: it bends the arriving cast (0 = flat)
uniform float uSheen;             // velvet grazing sheen strength on the fold ridges (the cut-pile glow)
uniform float uScatter;           // fraction of the transmitted light that FORWARD-SCATTERS through the pile (0 = all ballistic, today's look)`;

const GLSL_T_FOLD_DECLS = `// THE PLEAT FIELD, in one place (§4.9) — one displacement, one derivative, one function. Both the shading (which
// flank is edge-on) and the geometry (where that flank sits in depth) read the SAME values here, so the shared-phase
// invariant is structural rather than a convention two call sites have to keep: the warp bends the cast around
// exactly the flanks the velvet shades.
// GRAVITY IS THE CONSTRAINT: hanging cloth has VERTICAL ridges at every height. Each harmonic's phase is therefore a
// function of x ALONE. Coarsening cannot be a frequency chirp (see §4.9's recorded dead end — a k(y) tilts the
// constant-phase ridges into a diagonal fan, x ∝ √(1+c·y), the literal pool-caustic look); it is a spectral
// REWEIGHTING, an octave crossfade — fine gathers at the rod fading out into broad waves at the hem.
// Three harmonics at pairwise irrational ratios: the sum is almost-periodic, so no pleat ever repeats and there is no
// wallpaper tile — aperiodicity with no hash, no RNG, C∞ smooth (which the warp derivative and the incidence both need).
const vec3 FOLD_R = vec3(1.0, 0.6180340, 0.4142136);   // frequency ratios ×uFoldScale: 1 : 1/φ : 1/(1+√2)
const vec3 FOLD_A = vec3(0.4142136, 0.6702134, 1.0);   // amplitude ∝ 1/k, so every harmonic contributes the SAME peak slope; displacement is broad-dominated, slope is not
const vec3 FOLD_P = vec3(0.7, 2.4, 5.1);               // fixed phase offsets — no distinguished point where all three crest together
const float FOLD_NAP = 33.798990;                      // pile-grain frequency ×uFoldScale: 14·(1+√2), irrational against all three harmonics, so the grain never locks onto a fold
// Returns the UNIT pleat shape: (ŝ, dŝ/dx, max|dŝ/dx|), with |ŝ| ≤ 1. uFoldWarp scales it to metres at the consumers
// rather than here, so the shading's facing term keeps its 0..1 meaning on a cloth with no displacement at all.
vec3 foldField(vec2 cloth){
  float f = 1.0/(1.0 + uFoldCoarsen*max(cloth.y, 0.0));                    // 1 at the rod → 0 at the hem: the octave crossfade's mixer
  vec3 w = vec3(f, 1.0, 2.0 - f);                                          // finest dies down the drape, broadest grows to take its place (coarsen 0 ⇒ all 1, even top to bottom)
  vec3 k = uFoldScale * FOLD_R;
  vec3 wa = w * FOLD_A;
  float N = max(wa.x + wa.y + wa.z, 1e-6);                                 // normalize Σwa so the peak displacement stays uFoldWarp metres at EVERY height
  vec3 ph = 6.2831853*k*cloth.x + FOLD_P;
  return vec3(dot(wa, sin(ph))/N,
              6.2831853*dot(wa*k, cos(ph))/N,
              max(6.2831853*dot(wa, k)/N, 1e-6));                          // the sup the almost-periodic derivative approaches (every |cos| → 1 together)
}
// FOLD INCIDENCE (spec §4.9) — the lit/dark banding on a tilted flank is an incidence COSINE, so it takes the real
// sun direction and NOT uProj/uBulkShift: those carry 1/sin(elevation) and blow up at a low sun, where incidence on
// a vertical cloth does the opposite — it PEAKS as the sun lowers head-on toward the window. The slope handed in is
// foldField's own dΔy/du (the one field, scaled to metres), and with Δy measured toward the room the two unit
// normals of the surface (u, cy−Δy, v) are ±(dΔy/du, 1, 0)/‖·‖ — the sun-facing one is the sign of the sun's
// own cloth-facing component. Normalized by the FLAT cloth's incidence so uFoldWarp = 0 returns exactly 1.0: the
// warp geometry is the gate, no separate knob. The ratio exceeds 1 on a flank turned INTO the sun — real (that
// flank truly collects more than the flat plane), and it diverges as the sun rakes parallel to the cloth, the same
// degenerate pose clothGy already guards, where the whole cloth-space cast is meaningless anyway.
float foldIncidence(float slope){
  if(uFoldWarp == 0.0) return 1.0;                                         // flat cloth: no tilt, so nothing to vary — byte-identical
  float sgn = uBulkShift.y < 0.0 ? -1.0 : 1.0;                             // which side of the cloth the sun stands on
  float sx = sgn*uSunDir.x, sy = sgn*uSunDir.y;                            // sun, in the frame where the cloth's sun-facing normal is +Y
  return max(slope*sx + sy, 0.0) / (max(sy, 1e-3) * sqrt(1.0 + slope*slope));
}
// curtain drape + velvet (spec §4.9). A real curtain is not flat — it hangs in vertical PLEATS that coarsen toward
// the hem (foldField above: fine octaves fading out, ridges vertical throughout). This is the SHADING half — uFoldDepth is authored pile thickness on
// a flat plane, NOT the displacement (that is uFoldWarp above, and it deliberately does not enter here: the pleats
// are attached to the cloth, so only the ARRIVING pattern warps). The pleats do two things that read as thick
// velvet rather than a thin woven grid:
//  • backlit THICKNESS — the edge-on fold flanks present more cut-pile, so they transmit LESS → dark vertical bands;
//  • a grazing SHEEN — the face-on ridges catch a soft pale glow, the signature of a standing-fibre pile.
// body is the transmitted moss; sheenCol the pale glow tint. Keyed to the cloth's own (u,v) so it stays on the cloth.
// FORWARD-SCATTER WRAP (uScatter = s, §4.9). Backlit cut pile transmits two ways: a BALLISTIC component that threads
// the pile directly — highly directional, so the edge-on flanks extinguish it (that is band) — and a component that
// DIFFUSES among the fibres and leaves in a broad forward lobe, near-isotropic, so fold orientation barely attenuates
// it. s is the SPLIT of the same transmitted energy between the two, a mix and never an add: both bands are ≤ 1, so
// their mix is, and Tt·tint̂·mix ≤ 1 still forbids the cloth out-glowing the light that landed on it. (The fold
// incidence below rides ON band and can push it past 1 — not a gain in the split, which still divides one fixed
// transmitted energy, but a correction to the irradiance it divides: E is the FLAT plane's, and a flank turned into
// the sun really does collect more than that.) The dye acts on
// scattered light too (it crossed the same pile), so the hue stays tint̂ — no second tint. s=0 collapses to band.
// LIMIT of this per-pixel tier: it redistributes light ANGULARLY at one point, so it wraps the glow around the FOLDS
// but cannot bleed a dapple's glow across a CAST-SHADOW edge — that is the lateral 2-D diffusion tier (§4.9), staged.
// The scatter argument is the forward-scatter share at THIS pixel rather than the uniform, because the mesh band
// (§4.9) is a per-panel MATERIAL: mesh barely diffuses what passes it, so its share drops toward 0 while the nylon
// below the hem keeps the whole knob. Every other receiver passes uScatter straight through, byte-identically.
vec3 velvetCloth(vec2 cloth, vec3 fold, vec3 body, vec3 sheenCol, float scatter){
  float facing = clamp(abs(fold.y)/fold.z, 0.0, 1.0);                    // slope against the field's own peak slope: 1 = edge-on flank, 0 = face-on ridge/valley. Unit shape, so fold_depth's banding is there on an undisplaced cloth too
  float inc = foldIncidence(uFoldWarp * fold.y);                         // true sun-geometry lit/dark on the flanks (1.0 on flat cloth)
  float band = exp(-uFoldDepth * facing) * inc;                          // ballistic: flanks thicker → darker pleat bands (backlit), × how squarely each flank meets the sun
  // the scattered lobe walks the same Beer path at a quarter weight: it still dims edge-on (more pile to cross) but
  // never goes black. 0.25 is an authored "mostly, not wholly, orientation-blind" call — 0 would flatten the glow
  // completely, 1 would collapse it back onto the ballistic band and the wrap would do nothing.
  float bandSoft = exp(-uFoldDepth * facing * 0.25);
  float ridge = 1.0 - facing;                                            // bright where the cloth faces us
  // fine pile grain, TRUE-vertical (varies across x like the pleats). Amplitude rides the pile thickness knob:
  // grain is a property of PILE, so a thin taut fabric (tent nylon, fold_depth→0) is perfectly smooth — any fixed
  // grain on a bright near-white cloth reads as printed pinstripes, not fibre. ±4% at full pile.
  float napAmp = 0.04 * min(uFoldDepth, 1.0);
  float nap = (1.0 - napAmp) + napAmp*sin(6.2831853 * FOLD_NAP*uFoldScale * cloth.x);
  vec3 sheen = sheenCol * (uSheen * ridge * ridge);                      // soft pale glow on the ridges only
  return body * mix(band, bandSoft, scatter) * nap + sheen;
}`;

const GLSL_T_FABRIC_MATERIAL = `    // The landed irradiance the fabric answers. On the ENCLOSURE the beam and the sky are resolved SEPARATELY
    // against this panel's own normal (§4.9): a directional beam takes an incidence cosine, a hemisphere of sky
    // takes how much of the hemisphere the panel sees. beamF/skyF/recvAtten are all 1 on the floor and the curtain,
    // so what those two evaluate is the old expression exactly.
    vec3 E = acc*uSunColor*beamF + uAmbient*skyF;
    E *= recvAtten;                                        // enclosure only: interior depth fade × the ridge seam`;

const GLSL_T_FABRIC_TAIL = `    vec3 tintHat = uFabricTint / max(max(uFabricTint.r, uFabricTint.g), max(uFabricTint.b, 1e-4));   // unit-peak HUE
    // MESH vs NYLON, and it is one material split rather than a painted band. A mesh passes less of what lands on it
    // and DIFFUSES almost none of what it does pass, so it takes both halves of the transmission: the throughput
    // drops toward 0.55, and the forward-scatter share — the thing that turns a cast into a glow — drops toward
    // nothing, which is what makes the band read DARKER and its dapples CRISPER at the same time. meshF is 0 on every
    // other panel and every other receiver, so both lines collapse to the old ones exactly.
    vec3 body = E * (uTt * tintHat) * mix(1.0, 0.55, meshF);   // transmitted moss: brightness × hue; ambient rides through Tt·tint̂ (gated, not free)
    // drape + velvet (§4.9): pleats + grazing sheen on the cloth's own (u=clothUV.x, v=clothUV.y) coords. The sheen
    // is a pale warm tint of the dye (two-tone velvet), brightened a touch where the backlight is hot.
    vec3 sheenCol = mix(tintHat, vec3(1.0,0.96,0.88), 0.7) * (0.4 + 0.6*dot(body, vec3(0.33)));
    col = velvetCloth(clothUV, foldF, body, sheenCol, uScatter * (1.0 - meshF));`;

// ---- ENCLOSURE camera (§4.9): the tent as a convex polytope, ray-cast from inside ----
const GLSL_T_TENT_DECLS = `uniform float uTentRidge;         // ENCLOSURE (§4.9): crown height (m) — the flat top panel's plane; the slopes rise to its long edges
uniform float uTentHalfW;         // ENCLOSURE: half the floor width (m); with the crown height and width it IS the slope pitch
uniform float uTentCrownW;        // ENCLOSURE: half the CROWN panel's width (m) — 0 collapses it to a ridge line and the shape degenerates to an A-frame
uniform float uTentShoulderH;     // ENCLOSURE: height (m) of the arch profile's WAYPOINT — the Bézier's mid control point, where the vault bulges widest
uniform float uTentShoulderW;     // ENCLOSURE: half-width (m) at that height; bulged past the straight base→crown line is what curves the side into an arch rather than a slope
uniform float uTentLen;           // ENCLOSURE: tent length (m) — the far cap's base; the eye rides at 30 % of it
uniform float uTentEndLean;       // ENCLOSURE: how far an end wall leans out per metre of height (0 = a vertical end wall)
uniform float uTentEndApex;       // ENCLOSURE: height (m) of the far end's VENT APEX — the point the two hips converge on, and the top of the foot triangle
uniform float uTentHipRake;       // ENCLOSURE: how much MORE steeply the hips rake back than the end wall (m per metre of height). 0 collapses all three far planes onto one, bit-exactly
uniform float uTentEye;           // ENCLOSURE: eye height (m), clamped strictly inside every half-space CPU-side (an eye on or past one leaves the viewer outside their own tent)
uniform float uTentFade;          // ENCLOSURE: interior depth fade (1/m) — the ridge is infinite, so distance is the only thing that closes it off
uniform float uTentSeam;          // ENCLOSURE: ridge-seam optical depth (0 = no seam)
uniform float uTentMesh;          // ENCLOSURE: how much the panels ABOVE the shoulder hem are mesh rather than nylon (0 = one fabric everywhere, byte-identical)
// THE ENCLOSURE's two hard numbers (§4.9). The tent is a CLOSED convex polytope, so every ray inside it leaves
// through some panel and TENT_TMAX is a safety clamp, not a horizon: the one direction with no exit is straight
// down (the polytope is open below the floor plane the model does not have), which no frame at a sane pitch
// contains. TENT_SEAM_HW is the panel-junction seam's half-width — 24 mm of taped, doubled fabric.
const float TENT_TMAX = 12.0;
const float TENT_SEAM_HW = 0.012;
// ---- THE ENCLOSURE's side profile (spec §4.9): ONE ARC, not two facets. The reference tent is tensioned fabric on
// PRE-BENT pole arcs, so its cross-section is a rounded vault; two flat panels per side read as a barn. The curve is
// a quadratic Bézier through the three authored control points — base (halfW, 0), shoulder (shoulderW, shoulderH),
// crown edge (crownW, ridge) — with the middle one hit exactly at t = 0.5, which pins the control point at
// C = 2·P1 − (P0+P2)/2. A quadratic Bézier is a parabola arc: its curvature cannot change sign, so the curve is
// convex BY CONSTRUCTION and every tangent plane of it bounds one convex region. That is the whole reason the shape
// can round without the exit math being touched. The shoulder params stop naming a crease and start naming the
// arc's waypoint — how far out, and at what height, the vault bulges.
vec2 tentCtrl(){ return 2.0*vec2(uTentShoulderW, uTentShoulderH) - 0.5*(vec2(uTentHalfW, 0.0) + vec2(uTentCrownW, uTentRidge)); }
vec2 tentTangent(vec2 C, float t){ return 2.0*(1.0-t)*(C - vec2(uTentHalfW, 0.0)) + 2.0*t*(vec2(uTentCrownW, uTentRidge) - C); }
vec2 tentProfile(vec2 C, float t){ float u = 1.0-t; return u*u*vec2(uTentHalfW, 0.0) + 2.0*t*u*C + t*t*vec2(uTentCrownW, uTentRidge); }
// The outward unit normal at t, in (x, z), for the +x side; the −x side is the same offset with n.x negated.
// Walking UP the profile the rise is strictly positive — the CPU clamp holds 0 < C.z < ridge, which makes the
// tangent's z-component 2[(1−t)·C.z + t·(ridge − C.z)] > 0 everywhere, so this normalize can never see a zero
// vector and the profile can never double back in height. (dz, −dx) is then the outward-and-up perpendicular, and
// it correctly tips BELOW horizontal wherever the arc flares outward, which is what an overhanging fly does.
vec2 tentNormal(vec2 C, float t){ vec2 d = tentTangent(C, t); return normalize(vec2(d.y, -d.x)); }
// Invert the profile's HEIGHT — the t whose point sits at height h — for the SMOOTH shading normal below.
// B.z(t) = a·t² + b·t with a = ridge − 2·C.z and b = 2·C.z, monotone on [0,1] by the same clamp.
float tentTAtHeight(vec2 C, float h){
  float a = uTentRidge - 2.0*C.y, b = 2.0*C.y, hc = clamp(h, 0.0, uTentRidge);
  if(abs(a) < 1e-6) return clamp(hc/max(b, 1e-6), 0.0, 1.0);           // C.z at half the ridge: the height map is linear
  return clamp((-b + sqrt(max(b*b + 4.0*a*hc, 0.0)))/(2.0*a), 0.0, 1.0);
}
// Which PANEL GROUP a plane belongs to: 0 crown, 1/2 side +x below/above the hem, 3/4 side −x below/above,
// 5 far END WALL (the foot vent), 6/7 the two far HIPS, 8 near END WALL (the head vent), 9/10 the two near HIPS. The seam pass reads this and nothing else: a
// junction between two planes of the SAME group is an artefact of faceting the arc, not a pole line, and drawing it
// is what turned the vault into masonry ribbing (§4.9's recorded dead end). The far cap's three planes are three
// SEPARATE groups precisely because their junctions ARE edges — the spine where the hips meet, and the vent
// triangle's two rising sides. Both caps carry that, so the spine runs the ceiling's whole centreline: it comes in
// over your head from behind, crosses the crown, and forks again at the far vent. Each arch splits at its middle strip boundary for the same reason: that junction is
// the real MESH↔FABRIC hem, so it is the one intra-arch boundary that must draw.
int tentGroup(int i){ return i == 0 ? 0 : i < 3 ? 1 : i < 5 ? 2 : i < 7 ? 3 : i < 9 ? 4 : i - 4; }   // 9..14 -> 5..10
// Is this an UPPER (mesh) side panel? The two strips tangent at t = ⅔ and 1 — everything above the hem.
bool tentMeshPanel(int i){ return (i >= 3 && i <= 4) || (i >= 7 && i <= 8); }`;

const GLSL_T_TENT_CAMERA = `    // ---- ENCLOSURE receiver (spec §4.9): the receiver stops being a plane the camera stares AT and becomes a
    // CLOSED TENT stood around the eye, ray-cast per pixel. It is the hip/brow shape the reference actually is: a
    // flat rectangular CROWN along the top; per side a rounded ARCH — tensioned fabric on a pre-bent pole, sampled
    // as four tangent strips of one convex profile curve and shaded off the SMOOTH normal, so the light rounds
    // continuously across it; and at each end a GABLE (one panel, or two bevelled halves meeting at a vertical
    // centre crease). TENT SPACE: the long axis is +Y, the crown sits at z = uTentRidge, the arches reach
    // the ground at x = ±uTentHalfW, the eye sits 30 % down the tent at uTentEye, gazing along +Y pitched UP by
    // uPitch (in THIS branch the pitch uniform means elevation above horizontal, not the floor camera's tilt from
    // straight-down). What happens downstream is the point of the whole thing: the hit's plan point and height go
    // into (world, recvZ) and §4.9's height-minus-recvZ read casts the canopy onto whichever panel this pixel
    // landed on with ZERO further changes — that generalization was written for a flat cloth and turns out to have
    // been geometry-free all along. ----
    float cp=cos(uPitch), sp=sin(uPitch);
    float kf=max(tan(0.5*uFov), 1e-4);                 // image-plane half-extent (guard fov->0) — the floor camera's 2k·tan convention, verbatim
    float sxc=(vUv.x-0.5)*uAspect, tyc=(vUv.y-0.5);
    // ray = fwd + 2k*(sx*right + ty*up), with fwd=(0,cp,sp), right=(1,0,0), up=(0,-sp,cp). NORMALIZED, unlike the
    // floor's: t below is metres of fabric distance and both the depth fade and TENT_TMAX are quoted in metres.
    vec3 dir = normalize(vec3(2.0*kf*sxc, cp - 2.0*kf*tyc*sp, sp + 2.0*kf*tyc*cp));
    vec3 eye = vec3(0.0, 0.3*uTentLen, uTentEye);      // DERIVED, not a knob: 30 % down the tent puts the far cap ~1.6 m off and the near one just behind you, which is where you lie in a 2P
    // THE THIRTEEN HALF-SPACES, outward unit normal n and offset c (inside is dot(n,X) < c). The tent is the CONVEX
    // intersection of them, and convexity is what makes this cheap and exact at once: a ray from a point strictly
    // inside leaves through exactly one panel, the min over the planes it is advancing into, so there are NO
    // per-panel bounds tests at all. A plane the ray meets outside the tent is always beaten by the one that
    // actually bounds it there. That is the whole intersection routine, and it has not changed a character while the
    // shape went from two panels to five to nine to thirteen — panel count is data here, not structure. Which is
    // exactly what let the sides ROUND: a convex profile curve's tangent planes are a convex half-space set, so
    // sampling four of them per side buys an arch for nothing but four more entries in this table.
    vec2 C = tentCtrl();
    float gn = inversesqrt(1.0 + uTentEndLean*uTentEndLean);
    // THE FAR CAP is ONE PLANE FAMILY with three members, and writing it that way is what makes it collapse:
    //   (a·x ± y + k·z < len + rake·apex),  a = apex·rake/halfW,  k = endLean + rake
    // rake 0 gives a = 0, k = endLean, offset = len — the single leaning end wall, bit-exactly — and the far cap is
    // the tent as it shipped. Turning rake up rakes the two ±a members back FASTER than the wall, so they start
    // binding above the vent apex and the end wall survives only BELOW the line from the apex to each floor corner.
    // The three anchor points are all hull features already, which is why nothing else has to move: the apex
    // A = (0, len − endLean·apex, apex) sits on the end wall at the vent's height, the floor corners (±halfW, len, 0)
    // are the tent's own far corners, and the two hips meet each other along the vertical plane x = 0 — the SPINE.
    float hk = uTentEndLean + uTentHipRake;
    float ha = uTentEndApex*uTentHipRake/max(uTentHalfW, 1e-3);
    float hn = inversesqrt(1.0 + ha*ha + hk*hk);
    float hcF = (uTentLen + uTentHipRake*uTentEndApex)*hn;   // far cap, base line at y = uTentLen
    float hcN = (0.5      + uTentHipRake*uTentEndApex)*hn;   // near cap, base line at y = −0.5 — the SAME family with y negated
    vec3 pn[15]; float pc[15];
    pn[0] = vec3(0.0, 0.0, 1.0);                  pc[0] = uTentRidge;        // CROWN — the flat rectangular panel along the top
    for(int j=0;j<4;j++){
      // tangency at t = 0, 1/3, 2/3, 1 — the ends INCLUDED, so the hull touches the authored base and crown edge
      // exactly and only bulges (by ~1.5 cm at these dimensions) between them. Tangent planes circumscribe a convex
      // curve, so the hull is a superset of the true arch, which is also what keeps the eye-inside proof below free.
      float tj = float(j)/3.0;
      vec2 nz = tentNormal(C, tj);
      float cj = dot(nz, tentProfile(C, tj));
      pn[1+j] = vec3( nz.x, 0.0, nz.y);           pc[1+j] = cj;              // +x ARCH strips, base → crown edge
      pn[5+j] = vec3(-nz.x, 0.0, nz.y);           pc[5+j] = cj;              // −x arch (mirrored: negate n.x, the offset is symmetric)
    }
    // THE FAR CAP — a HIP, not a wall. The end wall survives only as the small upright triangle at the foot (the
    // vent): the hips cut it away above the line from the apex to each floor corner, which is exactly the line the
    // hip and the wall share, so that boundary is the triangle's own rising side and needs no separate authoring.
    // What the eye gets is the reference's shape rather than a slab: a seam down the ceiling's centreline (the two
    // hips meeting), splitting at the apex into the triangle's two sides.
    pn[9]  = vec3(0.0,  gn, uTentEndLean*gn);     pc[9]  = uTentLen*gn;      // FAR END WALL — the foot vent
    pn[10] = vec3( ha*hn,  hn, hk*hn);            pc[10] = hcF;              // FAR HIP +x
    pn[11] = vec3(-ha*hn,  hn, hk*hn);            pc[11] = hcF;              // FAR HIP −x (mirrored: negate n.x, the offset is symmetric — so they meet on x = 0)
    pn[12] = vec3(0.0, -gn, uTentEndLean*gn);     pc[12] = 0.5*gn;           // NEAR END WALL — the head vent
    pn[13] = vec3( ha*hn, -hn, hk*hn);            pc[13] = hcN;              // NEAR HIP +x
    pn[14] = vec3(-ha*hn, -hn, hk*hn);            pc[14] = hcN;              // NEAR HIP −x
    // THE HUBS ARE NOT MODELLED, and that is the argument for doing this as a polytope at all. The corners the
    // reference reads as hardware are simply VERTICES — where an arch strip, the crown and a cap plane all meet — so
    // they appear at the right place for free, and the seam pass below draws the pole lines radiating out of them
    // without any of it being enumerated. The vent apex is the newest of them: hip, hip and end wall, three planes,
    // one point, no authoring.
    // DEGENERACY, the regression anchor: a shoulder placed exactly on the straight base→crown line makes all three
    // Bézier control points collinear, so the curve IS that line, all four tangent planes coincide, and the shape
    // gives back the v2 single-slope tent — and with crown_w → 0 and a large tent_len on top of it, the v1 A-frame.
    int win = dir.x >= 0.0 ? 1 : 5;                    // fallback panel for the one exitless direction (straight down, which no sane pitch puts in frame): the lowest arch strip it is heading toward
    float t = 1e6;
    for(int i=0;i<15;i++){
      float den = dot(pn[i], dir);
      if(den <= 1e-6) continue;                        // the ray recedes from this plane (or runs parallel): it cannot leave through it
      float ti = (pc[i] - dot(pn[i], eye)) / den;      // strictly > 0, because the eye is clamped strictly inside every half-space CPU-side
      if(ti < t){ t = ti; win = i; }
    }
    t = min(t, TENT_TMAX);
    vec3 hit = eye + t*dir;
    vec3 n0 = pn[win];                                 // the winning panel's HULL normal: the seam's edge geometry is the polytope's, not the smooth shading normal's
    vec3 n = n0;                                       // the shading normal, which the arch replaces below — the first receiver in this engine whose orientation varies across the frame
    // SMOOTH NORMALS OVER A COARSE HULL. On the arch the shading normal is the PROFILE's own, evaluated at the hit's
    // height, not the facet's — so the light rounds continuously across the side exactly the way it rounds on
    // tensioned fabric, while the exit math keeps the cheap four-plane hull. This is the classic smooth-shaded coarse
    // hull, and it is the honest cheap road here: the silhouette stays subtly faceted, but a true curved-surface ray
    // intersection would buy sub-centimetre silhouette accuracy on a 64 cm half-width tent — nobody can see it, and
    // it would cost the closed-form single min() that this whole receiver is built on.
    if(win >= 1 && win <= 8){
      vec2 ns = tentNormal(C, tentTAtHeight(C, hit.z));
      n = vec3(win < 5 ? ns.x : -ns.x, 0.0, ns.y);
    }
    // THE MESH BAND — the first PER-PANEL MATERIAL in this receiver, and deliberately not per-panel shading. The
    // Dragonfly's sides are solid nylon to the shoulder and dark mesh above it, and that hard hem is what the eye
    // reads as structure. The bell's shoulder CREASE used to stand in for it by accident; rounding the side into an
    // arc removed the crease and took the hem with it, which is the regression this answers. The normal stays the
    // smooth arc's straight across the hem — the fabric does not kink there, it changes material.
    meshF = tentMeshPanel(win) ? uTentMesh : 0.0;
    // THE POLE LINES, from one measurement: the inside-distance to each non-winning plane of a DIFFERENT PANEL GROUP.
    // The group filter is the whole point. A junction between two strips of the same arch is an artefact of faceting
    // a curve — there is no seam there on a real tent, and drawing one is exactly what turned the vault into
    // masonry ribbing (§4.9's recorded dead end: the user's word was "church"). What survives the filter is the set
    // of real pole lines: the crown's two long edges, the SPINE down the ceiling's centreline where the two hips
    // meet, the foot triangle's two rising sides, and the rims where a cap meets the arches and the crown.
    // MEASURED TO THE EDGE LINE, not to the neighbouring plane, and the difference is a real one. The perpendicular
    // distance to a plane is the distance to the edge FORESHORTENED by the dihedral: walking across the winning panel
    // toward the junction closes that gap at a rate sin(dihedral), so a plane-distance seam paints a band
    // 1/sin(dihedral) wide in fabric and the shallowest junction in the tent draws the fattest tape. Undoing it is
    // one identity — split the neighbour's normal into its component along ours and the rest, and only the rest
    // moves us toward the line:
    //   dEdge = |c_j − n̂_j·hit| / ‖n̂_j − (n̂_j·n̂_w)·n̂_w‖ = |c_j − n̂_j·hit| · inversesqrt(1 − (n̂_j·n̂_w)²)
    // One dot and one inversesqrt per plane, and it makes the tape a fixed width of fabric everywhere. The 1e-6 floor
    // is not a numerical nicety: two PARALLEL panels have no edge, so the distance to it is infinite and no seam is
    // drawn — which is exactly right, and is what keeps a degenerate cap (hip rake → 0, three planes on one) from
    // painting itself dark. abs() because a TMAX-clamped hit sits outside.
    float dSeam = 1e6;
    int wg = tentGroup(win);
    for(int j=0;j<15;j++){
      if(tentGroup(j) == wg) continue;
      float cw = dot(pn[j], n0);                                            // cos of the angle between the two panels' normals
      dSeam = min(dSeam, abs(pc[j] - dot(pn[j], hit)) * inversesqrt(max(1.0 - cw*cw, 1e-6)));
    }
    // the fabric's OWN coords, generalized off the crown: v is the drop BELOW the crown plane, so the pleat field's
    // rod sits on the tent's own pinned top on every panel at once (a tent is pinned at its crown and free at the
    // hem exactly as a curtain is at its rod, so fold_coarsen's octave crossfade broadens the ripples downward the
    // right way round); u runs along the panel's horizontal tangent — down the tent on the slopes, across it on the
    // cap panels, and across it on the crown, whose plan normal is degenerate and needs the explicit fallback.
    vec2 tang = (abs(n.x) + abs(n.y) > 1e-4) ? normalize(vec2(-n.y, n.x)) : vec2(1.0, 0.0);
    clothUV = vec2(dot(hit.xy, tang), uTentRidge - hit.z);
    castUV = clothUV;              // nothing to warp: there is no flat-plane cast here, the read IS the real geometry, so fold_warp is inert in this branch (§4.9)
    foldF = foldField(clothUV);    // the drape, once — velvetCloth needs the field's peak-slope divisor even on a taut tent
    // the tent stands wherever the look places it: uViewYaw turns it about the eye (the floor camera's own orbit
    // matrix, so the two cameras agree on which way is round), uViewCenter walks it across the grove. The canopy and
    // the sun stay in WORLD plan, so the normal is rotated with the hit and the incidence below is a real world angle.
    vec2 plan = hit.xy, nxy = n.xy;
    if(uViewYaw != 0.0){ float cy=cos(uViewYaw), sy=sin(uViewYaw); mat2 rot=mat2(cy,-sy,sy,cy); plan=rot*plan; nxy=rot*nxy; }
    world = plan + uViewCenter;
    recvZ = hit.z;
    n = vec3(nxy, n.z);
    // PER-PANEL LIGHT — the thing a flat wall cannot do, and the reason this receiver exists. beamF is the beam's
    // incidence on THIS panel, normalized by the sun's own vertical component so a HORIZONTAL panel comes out
    // exactly 1: the floor and curtain conventions already absorb sin(elevation) into their irradiance (acc is the
    // fraction of the disk that cleared, landing on a surface those models never tilt), so 1 is precisely what "as
    // bright as the old receivers" has to mean. THE CROWN IS THAT ANCHOR — it is horizontal, so it lands at exactly
    // 1 and the slopes and cap panels read as departures from it. The 0.15 floor (≈8.6° elevation) keeps a horizon sun
    // from dividing by nothing. The sky is a hemisphere rather than a direction, so it takes how much of that
    // hemisphere the panel can see instead — 1 on the crown, and less the more steeply a panel stands up.
    beamF = clamp(dot(n, uSunDir) / max(uSunDir.z, 0.15), 0.0, 2.0);
    skyF  = 0.5 + 0.5*n.z;
    recvAtten = exp(-t*uTentFade);   // a gentle depth cue now rather than the thing that closes the space: the far cap does that, and the tent is metres deep, not infinite
    // THE SEAMS — near-contact occluders in the strictest sense, since they are ON the cloth, so they take beam and
    // sky alike exactly as the mullion bars do. The soft edge is the tape's own near to, then the PIXEL FOOTPRINT
    // far off: 0.004 rad ≈ 3 px on a 78°, 1080-tall frame, so a junction running away from the eye holds a roughly
    // constant screen width instead of thinning to a sub-pixel line that crawls.
    if(uTentSeam > 0.0){
      float pen = max(TENT_SEAM_HW, 0.004*t);
      recvAtten *= exp(-uTentSeam * (1.0 - smoothstep(TENT_SEAM_HW, TENT_SEAM_HW + pen, dSeam)));
    }`;

// ---- SKY VIEW camera (§4.9): the retina as the receiver ----
const GLSL_T_SKY_DECLS = `uniform float uSkyScatter;        // SKY VIEW (§4.9): single-scatter foliage radiance — how brightly a lit crown glows in its own right (0 = pure transmission, byte-identical)
uniform vec2  uSrcAngR;           // the SEEN source's angular radii (core, halo) — the very two the sampler draws its offsets from
uniform vec2  uSrcAngL;           // its radiance in each region (core, halo). CPU-derived from the sampler's own post-cloud weight split, so the sun you look at and the dapples it throws cannot drift apart
uniform vec2  uSrcMoon;           // eclipse: the moon disk's (centre offset, radius) in the sampler's own source plane; .y = 0 = no eclipse
// SKY VIEW's two constants (§4.9). SKY_AA is one angular soft edge, standing in for both a pixel's own angular
// footprint (≈3 px on an 85° frame ~1000 tall) and the penumbra a silhouette really has against the sun's disk.
// SKY_SKY_GAIN converts uAmbient — an authored IRRADIANCE, what the sky delivers ONTO a surface — into the RADIANCE
// you get when you look straight at it. Those are different quantities and the engine only ever had the first, so
// the conversion is authored; ambient_skylight still steers it. It is also the ONE knob that lifts the sky WITHOUT
// lifting the canopy: it multiplies the radiance you see looking at the sky and never the irradiance that lands on a
// leaf, so raising it moves open sky above the brightest crown instead of taking both up together. 7.5 is where a
// daylight look puts open sky near sRGB (184,208,232) and keeps it clear of the thinnest sunlit crown.
const float SKY_AA = 0.004;
const float SKY_SKY_GAIN = 7.5;
// A transmittance normalized to unit peak: the spectrum with its brightness divided out (§3.5's idiom, and the same
// one the curtain's dye uses). What survives is chlorophyll's green-gold; the knob that reads it carries the level.
vec3 leafHue(vec3 t){ return t / max(max(t.r, t.g), max(t.b, 1e-4)); }
// A layer read for the SKY VIEW (§4.9). Same texture, same Beer's law, one difference: OUTSIDE the baked canopy box
// there is no canopy, so the ray sees open sky. The floor path never needs this (its frame lives inside the box),
// but an upward ray leaves the box within a few metres of height, and CLAMP_TO_EDGE would smear the border texel
// across the whole periphery of the frame instead of opening onto blue.
// SKY VIEW's layer tap, and it comes apart into two quantities on purpose (§4.9). .rgb is the FOLIAGE's
// per-channel transmittance; .a is the WOOD's, neutral because wood blocks every colour equally. They are stored in
// different channels of the same texel because they are different KINDS of occluder to the scatter term below: a
// leaf takes light out of the ray and puts some of it back, wood only takes it out. Outside the baked box both are
// 1 — beyond the grove there is open sky, and an upward frame leaves that box within metres.
vec4 tapUpLW(highp sampler2D t, vec2 world){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  if(any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(1.0);
  vec4 d = texture(t,uv);
  return vec4(exp(-d.rgb), exp(-d.a));
}
// Closest approach between the upward view ray (origin O, UNIT direction U, t ≥ 0) and the wood segment Pa→Pb.
// Returns (distance, distance along the ray to the closest point) — the second feeds the angular soft edge, since an
// angle times a distance is a length. The floor path measures the wood in PLAN because a shadow is a plan object;
// looking at the wood itself asks for the real 3-D distance to the capsule axis, which is this. Standard clamped
// segment/ray minimisation: solve the unconstrained system, clamp the segment parameter, then re-solve the ray's.
vec2 raySegDist(vec3 O, vec3 U, vec3 Pa, vec3 Pb){
  vec3 V = Pb - Pa, W = O - Pa;
  float b = dot(U,V), c = dot(V,V), d = dot(U,W), e = dot(V,W);
  float den = c - b*b;                                   // |U|²|V|² − (U·V)², with |U| = 1; 0 when the ray runs along the segment
  float s, tt;
  if(den > 1e-9){
    tt = clamp((e - b*d)/den, 0.0, 1.0);
    s  = tt*b - d;
    if(s < 0.0){ s = 0.0; tt = clamp(e/max(c,1e-9), 0.0, 1.0); }   // the closest point fell BEHIND the eye: pin the ray at its origin and re-minimise over the segment
  } else {
    tt = clamp(e/max(c,1e-9), 0.0, 1.0);                 // parallel: any segment point will do, take the foot of W
    s  = max(tt*b - d, 0.0);
  }
  return vec2(length(W + s*U - tt*V), s);
}`;

const GLSL_T_SKY_CAMERA = `    // ---- SKY VIEW (spec §4.9): the THIRD camera, and the amendment to "we never see the tree, only what it casts".
    // The eye lies on the ground at uViewCenter and looks UP; the surface the light reaches is the RETINA. Nothing
    // new is invented — it is the same occluder field against the same source, read along upward rays instead of
    // sun rays, which is why the whole thing is one branch and no new physics. uPitch here is gaze ELEVATION (90° =
    // zenith); the ray basis is the enclosure's, character for character, so the two upward cameras agree. ----
    float cp=cos(uPitch), sp=sin(uPitch);
    float kf=max(tan(0.5*uFov), 1e-4);
    float sxc=(vUv.x-0.5)*uAspect, tyc=(vUv.y-0.5);
    vec3 dir = normalize(vec3(2.0*kf*sxc, cp - 2.0*kf*tyc*sp, sp + 2.0*kf*tyc*cp));
    if(uViewYaw != 0.0){ float cy=cos(uViewYaw), sy=sin(uViewYaw); dir.xy = mat2(cy,-sy,sy,cy)*dir.xy; }   // the grove spins under the gaze, the floor camera's own orbit matrix
    vec3 eye = vec3(uViewCenter, 0.0);
    // (no plan point here: the layer read below is per-layer, not per-pixel. In the mega-shader this branch still had
    // to keep the shared 'world' defined for the cast blocks after it; this variant emits none of them, so it has none.)
    if(dir.z <= 1e-3){
      fog = 1.0;                     // at or under the horizon there is no canopy and no sky model: hand it to the same distance haze the floor path uses over its horizon (§4.7). One behaviour, one colour.
    } else {
      // LAYERS AS ANGULAR SILHOUETTE. The ray crosses layer L's plane at plan eye + dir.xy·(h_L/dir.z) — the same
      // texture, the same tap, and deliberately NO shift by g: g is where the SUN's rays land, and this is the EYE's
      // ray. No recvZ either — these are absolute heights over an eye on the ground. Per-channel Beer's law then
      // comes along for free, because tap() exponentiates a per-channel optical depth: a leaf between us and the sun
      // passes its own green-gold and the canopy GLOWS instead of silhouetting flat. That is the §4.5 leaf
      // transmittance finally seen head-on rather than inferred from a dapple's colour.
      vec2 pL0 = eye.xy + dir.xy*(uLayerHeight[0]/dir.z);
      vec2 pL1 = eye.xy + dir.xy*(uLayerHeight[1]/dir.z);
      vec2 pL2 = eye.xy + dir.xy*(uLayerHeight[2]/dir.z);
      vec2 pL3 = eye.xy + dir.xy*(uLayerHeight[3]/dir.z);
      vec4 qL0 = uLayerCount>0 ? tapUpLW(uLayer[0], pL0) : vec4(1.0);
      vec4 qL1 = uLayerCount>1 ? tapUpLW(uLayer[1], pL1) : vec4(1.0);
      vec4 qL2 = uLayerCount>2 ? tapUpLW(uLayer[2], pL2) : vec4(1.0);
      vec4 qL3 = uLayerCount>3 ? tapUpLW(uLayer[3], pL3) : vec4(1.0);
      // tL = what the FOLIAGE does (this layer's leaves alone) — the only thing the scatter term may read.
      // xL = what the RAY loses (leaves × wood) — the only thing transmittance may read.
      vec3 tL0 = qL0.rgb, tL1 = qL1.rgb, tL2 = qL2.rgb, tL3 = qL3.rgb;
      vec3 xL0 = qL0.rgb*qL0.a, xL1 = qL1.rgb*qL1.a, xL2 = qL2.rgb*qL2.a, xL3 = qL3.rgb*qL3.a;
      vec3 T = vec3(1.0);
      T *= xL0; T *= xL1; T *= xL2; T *= xL3;
      // ---- SINGLE-SCATTER FOLIAGE RADIANCE (§4.9). Transmission alone can only DARKEN: every ray is the sky
      // attenuated, so a leaf is at best a dim filter and a deep crown is black. Foliage in daylight is LIT — light
      // reaches a leaf, scatters inside it and leaves in every direction, so a sunlit crown is brighter than a shaded
      // one against the same sky. That is a source term along the ray, and over a layered field it is a sum, not an
      // integral: L += throughput·(1 − t_L)·ŝ_L·S_L, throughput *= t_L, accumulated eye → sky.
      //  • (1 − t_L) is the share of the beam this layer takes OUT of the ray — the scattering density, measured from
      //    the same tap the silhouette uses, not authored.
      //  • S_L is the irradiance arriving at that layer FROM ABOVE: the sun attenuated by the layers over it along
      //    the SUN's ray (offset +g per metre of rise, since that is where the light comes from), plus the skylight.
      //    Those are extra taps and nothing else — the field already holds everything they need.
      //  • ŝ_L is the layer's own transmittance normalized to unit peak: HUE only (§3.5), so the knob carries
      //    brightness and the chlorophyll spectrum carries colour. Taking the LAYER's rather than one leaf's also
      //    accounts to first order for the scattered light filtering back out through the layer that made it.
      // The bound is structural: Σ throughput·(1 − t_L) telescopes to 1 − Π t_L ≤ 1 per channel, ŝ ≤ 1 and
      // uSkyScatter ≤ 1, so a crown can never radiate more than the light falling on it.
      vec3 Lsc = vec3(0.0);
      if(uSkyScatter > 0.0){
        vec2 gS = uSunDir.xy / max(uSunDir.z, 0.05);
        vec3 A0 = vec3(1.0), A1 = vec3(1.0), A2 = vec3(1.0);
        // the SUN's path takes the FULL transmittance — a twig shadows a leaf exactly as another leaf does; it is
        // only as a SOURCE that wood must not participate.
        vec4 a01, a02, a03, a12, a13, a23;
        if(uLayerCount>1){ a01 = tapUpLW(uLayer[1], pL0 + gS*(uLayerHeight[1]-uLayerHeight[0])); A0 *= a01.rgb*a01.a; }
        if(uLayerCount>2){ a02 = tapUpLW(uLayer[2], pL0 + gS*(uLayerHeight[2]-uLayerHeight[0])); A0 *= a02.rgb*a02.a; }
        if(uLayerCount>3){ a03 = tapUpLW(uLayer[3], pL0 + gS*(uLayerHeight[3]-uLayerHeight[0])); A0 *= a03.rgb*a03.a; }
        if(uLayerCount>2){ a12 = tapUpLW(uLayer[2], pL1 + gS*(uLayerHeight[2]-uLayerHeight[1])); A1 *= a12.rgb*a12.a; }
        if(uLayerCount>3){ a13 = tapUpLW(uLayer[3], pL1 + gS*(uLayerHeight[3]-uLayerHeight[1])); A1 *= a13.rgb*a13.a; }
        if(uLayerCount>3){ a23 = tapUpLW(uLayer[3], pL2 + gS*(uLayerHeight[3]-uLayerHeight[2])); A2 *= a23.rgb*a23.a; }
        // THE SOURCE TERM READS FOLIAGE ONLY. Wood appears in the throughput, which can only take light away, and
        // nowhere in the emission — so a ray that meets nothing but wood scatters exactly nothing.
        vec3 thr = vec3(1.0);
        Lsc += thr*(1.0-tL0)*leafHue(tL0)*(uSunColor*A0 + uAmbient); thr *= xL0;
        Lsc += thr*(1.0-tL1)*leafHue(tL1)*(uSunColor*A1 + uAmbient); thr *= xL1;
        Lsc += thr*(1.0-tL2)*leafHue(tL2)*(uSunColor*A2 + uAmbient); thr *= xL2;
        Lsc += thr*(1.0-tL3)*leafHue(tL3)*(uSunColor    + uAmbient);   // nothing is stacked above the top layer
        Lsc *= uSkyScatter;
      }
      // WOOD AS SILHOUETTE. The same segments the floor casts shadows with (§4.5), read as GEOMETRY this time: no
      // uBulkShift term anywhere here, because that vector is where the wood's shadow FALLS and we are looking at the
      // wood itself. The sway is kept, each endpoint drifting by its own height fraction exactly as the cast does, so
      // the trunks lean in unison with the crowns — §5.1's coherent band watched directly instead of read off a floor.
      // Perspective alone converges them on the zenith; nothing draws a column.
      if(uOccCount>0){
        for(int k=0;k<${MAX_OCC};k++){
          if(k>=uOccCount) break;
          vec4 P = texelFetch(uOccTex, ivec2(k,0), 0); vec4 H = texelFetch(uOccTex, ivec2(k,1), 0);
          vec3 Pa = vec3(P.xy + uOccSway*(H.x/uOccHRef), H.x);
          vec3 Pb = vec3(P.zw + uOccSway*(H.y/uOccHRef), H.y);
          vec2 ds = raySegDist(eye, dir, Pa, Pb);
          // soft edge = the greater of a pixel's angular footprint and the source's core radius, carried out along
          // the ray. HONEST v1: a silhouette is θ-soft only where it stands against the SOURCE and knife-sharp
          // against blue sky, and one constant angle cannot know which — it is small either way, and the alternative
          // needs the source's angular coverage at the wood's own position, which is a second ray march.
          float pen = ds.y * max(SKY_AA, uSrcAngR.x);
          // wood occludes only where it stands IN FRONT of the eye (closest approach out along the ray, ds.y > 0).
          // At ds.y = 0 the nearest wood point is AT or behind the eye — an eye beside (or planted on the axis of)
          // a trunk must not be shadowed by it in every direction: that darkens the ENTIRE frame by exp(-tau), sky
          // and sun included. A 5-20 cm ramp keeps the gate C1; wood genuinely crossed by the gaze (ds.y large,
          // ds.x < radius) still blocks fully.
          float infront = smoothstep(0.05, 0.2, ds.y);
          float e = exp(-uOccTau * infront * (1.0 - smoothstep(H.z, H.z + pen, ds.x)));   // Beer's law, same as the cast: overlaps add optical depth
          T *= e;
          Lsc *= e;   // wood stands BELOW the crowns on an upward ray, so it occludes the canopy's own glow as it occludes the sky behind it
        }
      }
      acc = T;   // the SAME quantity acc has always been — "how much of the light got through here" — so the mesopic hook at the tail reads it unchanged, now cued by canopy density instead of shade depth
      // THE SOURCE, SEEN. §3.1 said the sun is not a point and §3.2 said every dapple is its image; this is the
      // first time the thing being imaged is in frame. Both regions come straight from the sampler: a core disk of
      // uSrcAngR.x and a halo annulus out to uSrcAngR.y, each at the radiance its own post-cloud weight spread over
      // its own solid angle gives — so raising cloud_thickness drains the disk into the aureole HERE by exactly the
      // amount it softens the dapples THERE. The annulus is flat rather than a falloff because the sampler's is
      // flat: a smooth glow would look better and would no longer be the source the cast is drawn from.
      float aa = min(SKY_AA, 0.35*max(uSrcAngR.x, 1e-5));
      float ang = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
      float inCore = 1.0 - smoothstep(uSrcAngR.x - aa, uSrcAngR.x + aa, ang);
      float inSrc  = 1.0 - smoothstep(uSrcAngR.y - aa, uSrcAngR.y + aa, ang);
      float L = mix(uSrcAngL.y, uSrcAngL.x, inCore) * inSrc;
      if(uSrcMoon.y > 0.0){
        // ECLIPSE (§3.4): the same moon disk the sampler punches out of its weights, applied angularly in the SAME
        // source plane — so the crescent you look at is the crescent the dapples image. Reconstructing that plane is
        // what makes it the same: uProj's eigenvectors say the sampler's offsets run along the sun's own AZIMUTH
        // direction (an ELEVATION offset in the sky, stretched 1/sin²) and perpendicular to it (a horizontal
        // cross-sun offset, stretched 1/sin), so the two axes below are that basis, lifted back into angle.
        float ce = length(uSunDir.xy);
        vec3 sHor = ce > 1e-4 ? vec3(-uSunDir.y, uSunDir.x, 0.0)/ce : vec3(0.0, 1.0, 0.0);   // a sun at the exact zenith has no azimuth; any horizontal axis is then as good as another
        vec3 sUp  = cross(uSunDir, sHor);                     // in the sun's vertical plane, toward the zenith
        float ca = ce > 1e-4 ? uSunDir.x/ce : 1.0, sa = ce > 1e-4 ? uSunDir.y/ce : 0.0;
        vec2 q = vec2(dot(dir, ca*sUp - sa*sHor), dot(dir, sa*sUp + ca*sHor));   // the ray's offset in the sampler's own (x,y)
        L *= smoothstep(uSrcMoon.y - aa, uSrcMoon.y + aa, length(q - vec2(uSrcMoon.x, 0.0)));
      }
      // COMPOSITION: T·(sky + source). No receiver material of any kind — no Tt, no dye, no folds, no seams, no
      // ground albedo — because there is no surface between the canopy and the eye. The sky is attenuated by the
      // same T the sun is: leaves dim the blue behind them exactly as they dim the disk.
      skyRad = (uAmbient*SKY_SKY_GAIN + uSunColor*L) * T + Lsc;   // transmitted source + sky, plus what the leaves themselves radiate. At sky_scatter 0, Lsc is exactly 0.
    }`;

const GLSL_T_SKY_MATERIAL = `    col = skyRad;                                          // SKY VIEW: no receiver at all — the branch above already answered with radiance (§4.9)`;

// ---- the layer sample loop (§4.6), the general-geometry occluder tier: every cast camera runs it, and the
// receiver enters only as recvZ (0 on the floor, height up the cloth, the hit's height on a tent panel). ----
const GLSL_T_LAYERS = `  bool ca = (uChroma.r!=1.0 || uChroma.g!=1.0 || uChroma.b!=1.0);   // diffraction on? else the byte-identical single-tap path
  // the per-layer shift uses the occluder's height RELATIVE TO THE RECEIVER point, (uLayerHeight - recvZ): on the
  // floor recvZ=0 so this is the plain layer height (byte-identical); on the vertical curtain recvZ is the height
  // up the cloth, so an occluder above the cloth point projects its shadow onto it — the pattern stands up (§4.9).
  for(int i=0;i<MAX_SAMPLES;i++){
    if(i>=uSampleCount) break;
    vec2 g = uProj * uSamples[i].xy + uBulkShift;   // ground displacement per unit height: ellipse/shear of the sample + the bulk sun-angle offset (§4.8)
    float w = uSamples[i].z;
    // light must clear EVERY layer -> multiply transmittance; shift grows with height
    vec3 T = vec3(1.0);
    if(ca){   // diffraction: read each channel at its own λ-scaled shift (red spreads more) -> colour fringe at every leaf edge
      if(uLayerCount>0) T *= tapCA(uLayer[0], world, g, uLayerHeight[0]-recvZ+extraThrow, uChroma);
      if(uLayerCount>1) T *= tapCA(uLayer[1], world, g, uLayerHeight[1]-recvZ+extraThrow, uChroma);
      if(uLayerCount>2) T *= tapCA(uLayer[2], world, g, uLayerHeight[2]-recvZ+extraThrow, uChroma);
      if(uLayerCount>3) T *= tapCA(uLayer[3], world, g, uLayerHeight[3]-recvZ+extraThrow, uChroma);
    } else {
      if(uLayerCount>0) T *= tap(uLayer[0], world + (uLayerHeight[0]-recvZ+extraThrow)*g);
      if(uLayerCount>1) T *= tap(uLayer[1], world + (uLayerHeight[1]-recvZ+extraThrow)*g);
      if(uLayerCount>2) T *= tap(uLayer[2], world + (uLayerHeight[2]-recvZ+extraThrow)*g);
      if(uLayerCount>3) T *= tap(uLayer[3], world + (uLayerHeight[3]-recvZ+extraThrow)*g);
    }
    acc += w*T;                              // sum of shifted sharp shadows == soft shadow
  }`;

// ---- the woody occluder as a CAST (§4.5). Not emitted in the sky variant, which reads the same segments as
// geometry inside its own camera block instead. ----
const GLSL_T_WOOD_CAST = `  // woody occluder (spec §4.5), evaluated ONCE per pixel (NOT per sample — that stalled). The trunk + main limbs
  // cast one CONNECTED shadow using the central sun direction (uBulkShift), with a soft edge that GROWS with height
  // to fake the area-light penumbra. Multiplies the SUN term only (wood blocks the beam, not the ambient sky).
  if(uOccCount>0){
    float woodT = 1.0;
    for(int k=0;k<${MAX_OCC};k++){
      if(k>=uOccCount) break;
      vec4 P = texelFetch(uOccTex, ivec2(k,0), 0); vec4 H = texelFetch(uOccTex, ivec2(k,1), 0);
      vec2 A = P.xy + uOccSway*(H.x/uOccHRef) - (H.x-recvZ)*uBulkShift;   // a's shadow at its height RELATIVE to the receiver (recvZ=0 floor → unchanged; curtain → projected up the cloth, §4.9)
      vec2 B = P.zw + uOccSway*(H.y/uOccHRef) - (H.y-recvZ)*uBulkShift;   // b's below — segment shadow runs a→b, connecting neighbours
      vec2 ab = B - A, ap = world - A;
      float seg = clamp(dot(ap,ab)/max(dot(ab,ab),1e-7), 0.0, 1.0);
      float dist = length(ap - seg*ab);
      float pen = max(0.3*H.z, mix(H.x,H.y,seg)*uOccPenumbra);   // penumbra grows with height (fakes the disk integral)
      float inside = 1.0 - smoothstep(H.z, H.z + pen, dist);
      woodT *= exp(-uOccTau * inside);                          // Beer's law; overlaps add optical depth
    }
    acc *= woodT;
  }`;

const GLSL_T_POST = `  // ---- Purkinje / mesopic dusk shift (§3.5): as the sun sets the eye's rods take over the dim shade —
  // colour desaturates toward a blue-green grey and saturated reds darken first, while the bright dapples
  // stay photopic and warm. Two REAL cues drive it (no absolute luminance exists here): global duskness
  // from elevation (uTwilight) × the local shade darkness (acc — exposure-independent). Linear HDR. ----
  const vec3 ROD_BLUE = vec3(0.92, 1.0, 1.30);          // rods peak ~505nm -> blue-green, not pure blue
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float rod = (1.0 - smoothstep(0.15, 0.6, dot(acc, LUMA))) * uTwilight * uMesopic;  // 1 deep shade, 0 dapples
  col = mix(col, dot(col, LUMA)*ROD_BLUE, rod*0.6);     // cap 0.6 so the deepest shade keeps a hint of green
  col = mix(col, uHazeColor, fog);                       // far floor dissolves into atmospheric haze (§4.7); fog==0 at pitch 0
  // The Look's tail (exposure/curve/contrast/gamma) is toneTail() — shared verbatim with the diffusion composite.
  // Skipping it is the ONLY thing uLinearOut changes: what leaves here is then the same linear HDR radiance the
  // fabric produced, which is the space a lateral spread has to happen in (§4.9).
  if(uLinearOut == 0) col = toneTail(col);
  frag = vec4(col,1.0);`;

// ---- the per-camera prologues: each variant declares the state ITS blocks read, and nothing else. ----
const GLSL_T_PRO_FLOOR = `  vec2 world; float fog = 0.0; float extraThrow = 0.0; float recvZ = 0.0;
  vec3 acc = vec3(0.0);      // "how much of the light got through here" — the quantity the whole pipeline is about
  // recvZ stays 0 here and the shared occluder reads below spell it out anyway: the floor IS the recvZ = 0 case
  // of §4.9's height-minus-recvZ generalization, so those lines are the same lines the cloth and the tent run.`;

const GLSL_T_PRO_CLOTH = `  vec2 world; float fog = 0.0; float extraThrow = 0.0; float recvZ = 0.0; vec2 clothUV = vec2(0.0), castUV = vec2(0.0);
  vec3 foldF = vec3(0.0);   // the pleat field at this cloth point, evaluated ONCE: the warp below and the velvet shading later read the very same (ŝ, dŝ/dx, peak) — that is the shared-phase invariant, structural
  float beamF = 1.0, skyF = 1.0, recvAtten = 1.0;   // the ENCLOSURE's per-panel light, which a flat cloth never varies — constants here, so the shared irradiance line folds to the curtain's old one exactly
  float meshF = 0.0;         // the ENCLOSURE's per-panel MATERIAL; a curtain is one fabric top to bottom, so both mix() terms below fold away
  vec3 acc = vec3(0.0);      // "how much of the light got through here"`;

const GLSL_T_PRO_TENT = `  vec2 world; float fog = 0.0; float extraThrow = 0.0; float recvZ = 0.0; vec2 clothUV = vec2(0.0), castUV = vec2(0.0);
  vec3 foldF = vec3(0.0);   // the pleat field at this cloth point, evaluated ONCE: the warp below and the velvet shading later read the very same (ŝ, dŝ/dx, peak) — that is the shared-phase invariant, structural
  float beamF = 1.0, skyF = 1.0, recvAtten = 1.0;   // the ENCLOSURE's per-panel light: beam incidence, sky-hemisphere view, depth fade × ridge seam. All 1 on the floor and the curtain, so their irradiance line below is the old one exactly
  float meshF = 0.0;         // the ENCLOSURE's per-panel MATERIAL: 1 on a side panel ABOVE the shoulder hem, where the cloth is mesh rather than nylon. 0 everywhere else and on every other receiver
  vec3 acc = vec3(0.0);      // "how much of the light got through here"`;

const GLSL_T_PRO_SKY = `  float fog = 0.0;
  vec3 skyRad = vec3(0.0);   // SKY VIEW's finished radiance — this branch answers with light directly, having no surface to hand it to
  vec3 acc = vec3(0.0);      // "how much of the light got through here" — the sky view fills it with its own upward transmittance (see below), so the mesopic hook at the tail reads it unchanged`;

const GLSL_T_FAITH_FLOOR = `  if(uFaithful != 0){
    // FAITHFUL (§4.5/§4.9): the disk convolution at continuous per-leaf heights, pre-integrated as geometry at bake
    // time -> one tap. The receiver/sky guards this condition used to carry are gone: the enclosure and the sky view
    // are separate programs that never emit this branch at all (see buildTransport).
    acc = tapFaith(world);           // FLOOR: cast in floor (x,y), tap at world
  } else {`;

const GLSL_T_FAITH_CLOTH = `  if(uFaithful != 0){
    // FAITHFUL (§4.5/§4.9): the disk convolution at continuous per-leaf heights, pre-integrated as geometry at bake
    // time -> one tap. The receiver/sky guards this condition used to carry are gone: the enclosure and the sky view
    // are separate programs that never emit this branch at all (see buildTransport).
    acc = tapFaith(castUV);          // CURTAIN: cast onto the vertical cloth (u,v), tap at the warped coord
  } else {`;

const GLSL_T_COL_DECL = `  // ---- Receiver (§4.x/§4.9). The landed irradiance (acc·uSunColor + uAmbient, linear HDR) is answered by the
  // surface: the floor REFLECTS off its albedo, the two cloth receivers TRANSMIT through woven fabric, and the
  // sky view has no surface to answer with and already holds its radiance. One line per variant, chosen at build. ----
  vec3 col;`;

// ============================================================================
// THE CAMERA REGISTRY (spec §4.9 / §9). B1 made a camera a compile-time selection; this makes it DATA.
//
// The three consumers below — the shader assembler, the uniform-location table and the per-frame upload — all
// used to carry their own copy of the same four-way question, as three predicate chains that had to be kept in
// agreement by hand. They now read ONE table. A camera is an entry; adding a receiver is writing an entry, not
// editing three chains, and the extension contract in §9 is the rest of what an entry owes.
//
// Two tables, deliberately: TRANSPORT_GROUPS is the vocabulary (what a uniform group DECLARES and what its
// locations are called), CAMERAS is the sentence (which groups a camera speaks, in what order, and which body
// snippets it runs). The group's third half — the upload — lives in create()'s GROUP_UPLOAD under the SAME key,
// because it needs engine state a module-level table cannot see. Naming the two halves together is the point:
// a uniform declared in one variant and uploaded in another is now a key that does not line up, not a bug.
//
// MATERIALS RIDE THE CAMERA for now — each entry names its own material snippets. That is honest while every
// camera has exactly one material. The moment a real look wants a camera×material pair that does not exist
// (§4.9's named future: the enclosure's mesh panels read as sky, a sky view with a surface in it), materials
// become the second axis. Inventing that axis before a look needs it would be inventing a combination.
// ============================================================================

// ---- THE VOCABULARY. One entry per uniform group: the GLSL it declares, and the location-table keys that GLSL
// supports. A group with no `locs` contributes only functions (the taps, the fold field, the warp). ----
const TRANSPORT_GROUPS = {
  head:      { decls: GLSL_T_HEAD,            locs: { aspect:'uAspect', viewCenter:'uViewCenter', origin:'uCanopyOrigin', extent:'uCanopyExtent',
                                                      sun:'uSunColor', ambient:'uAmbient', heights:'uLayerHeight[0]', layerCount:'uLayerCount',
                                                      layers:['uLayer[0]','uLayer[1]','uLayer[2]','uLayer[3]'] } },
  rayView:   { decls: GLSL_T_RAY_VIEW,        locs: { pitch:'uPitch', fov:'uFov', yaw:'uViewYaw' } },
  occ:       { decls: GLSL_T_OCC_DECLS,       locs: { occTex:'uOccTex', occCount:'uOccCount', occTau:'uOccTau', occSway:'uOccSway', occHRef:'uOccHRef' } },
  transport: { decls: GLSL_T_TRANSPORT_DECLS, locs: { samples:'uSamples[0]', count:'uSampleCount', proj:'uProj', bulkShift:'uBulkShift' } },
  woodCast:  { decls: GLSL_T_WOOD_CAST_DECLS, locs: { occPenumbra:'uOccPenumbra' } },
  tap:       { decls: GLSL_T_TAP },
  ca:        { decls: GLSL_T_CA_DECLS,        locs: { chroma:'uChroma' } },
  faith:     { decls: GLSL_T_FAITH_DECLS,     locs: { faithful:'uFaithful', faithTex:'uFaithTex', faithOrigin:'uFaithOrigin', faithExtent:'uFaithExtent' } },
  sunDir:    { decls: GLSL_T_SUN_DIR_DECLS,   locs: { sunDir:'uSunDir' } },
  floor:     { decls: GLSL_T_FLOOR_DECLS,     locs: { viewExtent:'uViewExtent', farSmear:'uFarSmear', ground:'uGround' } },
  cloth:     { decls: GLSL_T_CLOTH_DECLS,     locs: { viewExtent:'uViewExtent', clothY:'uClothY' } },
  fabric:    { decls: GLSL_T_FABRIC_DECLS,    locs: { tt:'uTt', fabricTint:'uFabricTint', scatter:'uScatter', sheen:'uSheen',
                                                      foldDepth:'uFoldDepth', foldScale:'uFoldScale', foldCoarsen:'uFoldCoarsen', foldWarp:'uFoldWarp' } },
  fold:      { decls: GLSL_T_FOLD_DECLS },
  warp:      { decls: GLSL_T_WARP_DECLS },
  window:    { decls: GLSL_T_WINDOW_DECLS,    locs: { mullion:'uMullion', mullPenumbra:'uMullPenumbra', window:'uWindow', windowWall:'uWindowWall' } },
  tent:      { decls: GLSL_T_TENT_DECLS,      locs: { tentRidge:'uTentRidge', tentHalfW:'uTentHalfW', tentCrownW:'uTentCrownW', tentLen:'uTentLen',
                                                      tentEndLean:'uTentEndLean', tentShoulderH:'uTentShoulderH', tentShoulderW:'uTentShoulderW',
                                                      tentEndApex:'uTentEndApex', tentHipRake:'uTentHipRake', tentEye:'uTentEye',
                                                      tentFade:'uTentFade', tentSeam:'uTentSeam', tentMesh:'uTentMesh' } },
  sky:       { decls: GLSL_T_SKY_DECLS,       locs: { skyScatter:'uSkyScatter', srcAngR:'uSrcAngR', srcAngL:'uSrcAngL', srcMoon:'uSrcMoon' } },
  post:      { decls: GLSL_T_POST_DECLS,      locs: { haze:'uHazeColor', twilight:'uTwilight', mesopic:'uMesopic', linearOut:'uLinearOut',
                                                      exposure:'uExposure', contrast:'uContrast', tone:'uToneMap' } },
};

// ---- THE SENTENCES. One entry per camera. `groups` is ORDERED and that order is the emitted declaration order —
// GLSL's one rule is declaration before use, which is why the fabric's uniforms precede the fold field that reads
// them and the warp precedes the window whose bars read its throw. `faith` is the faithful tier's opening branch,
// null on the cameras that have no flat cast frame to pre-bake into. `params` is documentation, not enforcement:
// the knob families an entry answers for, so a reader can find the other end of a receiver from here. ----
const CAMERAS = {
  floor: {
    groups: ['head','rayView','occ','transport','woodCast','tap','ca','faith','floor','post'],
    prologue: GLSL_T_PRO_FLOOR, camera: GLSL_T_FLOOR_CAMERA, faith: GLSL_T_FAITH_FLOOR,
    material: [GLSL_T_FLOOR_MATERIAL],
    params: ['ground_*', 'far_smear', 'view_*'],
    note: 'the light lands on the ground and REFLECTS (§4.7) — the park default, and the only camera with an albedo',
  },
  cloth: {
    groups: ['head','occ','transport','woodCast','tap','ca','faith','sunDir','cloth','fabric','fold','warp','window','post'],
    prologue: GLSL_T_PRO_CLOTH, camera: GLSL_T_CLOTH_CAMERA, faith: GLSL_T_FAITH_CLOTH,
    material: [GLSL_T_FABRIC_MATERIAL, GLSL_T_WINDOW_APPLY, GLSL_T_FABRIC_TAIL],
    params: ['fabric_*', 'fold_*', 'velvet_sheen', 'cloth_distance_m', 'mullion_*', 'window_*', 'view_extent_m', 'view_center_*'],
    note: 'a standing curtain seen head-on, TRANSMITTING (§4.9); the only camera with a flat plane behind it, so the window and the pleat warp are its alone',
  },
  enclosure: {
    groups: ['head','rayView','occ','transport','woodCast','tap','ca','sunDir','fabric','fold','tent','post'],
    prologue: GLSL_T_PRO_TENT, camera: GLSL_T_TENT_CAMERA, faith: null,
    material: [GLSL_T_FABRIC_MATERIAL, GLSL_T_FABRIC_TAIL],
    params: ['fabric_*', 'fold_*', 'velvet_sheen', 'tent_*', 'view_*'],
    note: 'the same fabric as a closed tent stood AROUND the viewer, ray-cast per pixel (§4.9). No faithful tier: the pre-bake needs one flat cast frame and a polytope has none',
  },
  sky: {
    groups: ['head','rayView','occ','sunDir','sky','post'],
    prologue: GLSL_T_PRO_SKY, camera: GLSL_T_SKY_CAMERA, faith: null,
    material: [GLSL_T_SKY_MATERIAL],
    params: ['sky_*', 'view_pitch_deg', 'view_fov_deg', 'view_yaw_deg', 'view_center_*'],
    note: 'no surface at all — the RETINA receives, so the field is read along the eye\'s rays instead of the sun\'s (§4.9). The one camera that runs no cast, which is why it declares neither the sample integral nor a material',
  },
};
const TRANSPORT_CAMERAS = Object.keys(CAMERAS);
// The groups that carry a per-frame UPLOAD, named at module level because that is the only half of the upload
// registry anything outside an engine can see: the functions themselves live in create()'s GROUP_UPLOAD, since
// they need engine state (the GL objects, params, the grove) a module-level table cannot reach. This list is the
// seam between the two — create() checks its table against it on construction, and registry.test.js checks it
// against TRANSPORT_GROUPS and CAMERAS. Neither half can drift without one of those saying so.
const GROUP_UPLOAD_KEYS = ['head','rayView','occ','transport','woodCast','ca','faith','sunDir','floor','cloth','fabric','window','tent','sky','post'];

// The assembler. Every conditional it used to carry is now a lookup: the decls are the entry's groups in order,
// the body is the entry's own snippets, and the only branch left is the one real structural fork — whether this
// camera casts along the sun's rays at all.
function buildTransport(camera){
  const e = CAMERAS[camera];
  if(!e) throw new Error(`komorebi: unknown transport camera "${camera}"`);
  const p = e.groups.map(g => TRANSPORT_GROUPS[g].decls);
  p.push('void main(){', e.prologue, e.camera);
  if(e.groups.includes('transport')){          // a CAST camera: the faithful tap or the sample loop, then the wood
    if(e.faith) p.push(e.faith);
    p.push(GLSL_T_LAYERS);
    if(e.faith) p.push('  }');
    p.push(GLSL_T_WOOD_CAST);
  }
  p.push(GLSL_T_COL_DECL, ...e.material, GLSL_T_POST, '}');
  return p.join('\n');
}

const FS_BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTex;
out vec4 frag;
void main(){
  vec3 T = exp(-texture(uTex, vUv).rgb);   // show transmittance of the baked layer
  frag = vec4(pow(T, vec3(1.0/2.2)), 1.0);
}`;

// plain present blit (TUNE §9 adaptive frame-rate): copy the offscreen-rendered frame straight to screen.
// whatever drew the frame (transport, or the diffusion composite) already wrote final display-encoded colour into
// the target, so this is a verbatim 1:1 copy (NEAREST, identical size) — the re-presented frame is byte-identical.
const FS_PRESENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 frag;
void main(){ frag = texture(uTex, vUv); }`;

// ---- LATERAL DIFFUSION (spec §4.9), pass 1+2: one axis of a separable Gaussian over the LINEAR-HDR frame.
// σ = radius/3, so the 13 taps span exactly ±3σ and the weights below are CONSTANT (exp(−k²/8), normalized): the
// physical radius rides entirely in uStep, the tap SPACING. Separability is what makes a real 2-D neighbourhood
// affordable at all — 13+13 taps instead of 169.
// THE KERNEL'S HONEST LIMIT: 13 taps cannot cover an arbitrarily large radius, so past a cap (GLOW_STEP_MAX) the
// spacing stops growing and the reach falls short of the metres asked for. That is the deliberate trade — spacing the
// taps further apart samples the frame too sparsely, and a hard cast edge then comes out as 13 shifted copies of
// itself instead of a ramp. A glow that stops short reads as a glow; a combed one reads as a bug.
const FS_GLOW_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uTex;     // linear HDR — highp: this is radiance, not display-encoded colour
uniform vec2 uStep;               // ONE tap's offset in UV: (step/w, 0) horizontal, (0, step/h) vertical
out vec4 frag;
const float W[7] = float[7](0.19967567, 0.17621390, 0.12110863, 0.06482489, 0.02702306, 0.00877318, 0.00221816);
void main(){
  vec3 s = texture(uTex, vUv).rgb * W[0];
  for(int k=1; k<=6; k++){
    vec2 o = uStep*float(k);
    s += (texture(uTex, vUv+o).rgb + texture(uTex, vUv-o).rgb) * W[k];   // symmetric pair, one weight
  }
  frag = vec4(s, 1.0);
}`;

// ---- LATERAL DIFFUSION, pass 3 (the composite): the SPLIT, then the relocated tail. uDiffuse is a share of one
// fixed quantity of light, never an addition to it — the same discipline as the per-pixel forward-scatter wrap, one
// scale up: what the hot dapple loses is exactly what its surround gains, so the frame's total light is unchanged
// and no pixel can out-glow what landed on the cloth. Then toneTail — the SAME string transport runs when it draws
// straight to screen — turns the result into display colour.
const FS_GLOW_MIX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform highp sampler2D uSharp;   // transport's linear HDR frame
uniform highp sampler2D uBlur;    // the same frame, spread laterally through the weave
uniform float uDiffuse;           // d: the share of the transmitted light that took the lateral route
${GLSL_TONE_TAIL}
out vec4 frag;
void main(){
  vec3 sharp = texture(uSharp, vUv).rgb;
  vec3 blur  = texture(uBlur,  vUv).rgb;
  frag = vec4(toneTail(mix(sharp, blur, uDiffuse)), 1.0);
}`;

const VS_POINTS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aOff;     // radians
layout(location=1) in float aW;
uniform float uScale;
uniform float uMaxW;
out float vB;
void main(){
  gl_Position = vec4(aOff*uScale, 0.0, 1.0);
  float n = aW/uMaxW;
  gl_PointSize = 2.0 + 16.0*sqrt(n);
  vB = 0.25 + 0.75*n;
}`;

const FS_POINTS = `#version 300 es
precision highp float;
in float vB;
out vec4 frag;
void main(){
  vec2 d = gl_PointCoord*2.0-1.0;
  if(dot(d,d)>1.0) discard;
  frag = vec4(vec3(1.0,0.95,0.85)*vB, 1.0);
}`;

// ---- tree-preview inset: positions are CPU-projected to the inset's NDC, so the VS is trivial. ----
const VS_VIZ = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;      // already projected to inset NDC
layout(location=1) in vec3 aCol;
layout(location=2) in float aSize;    // leaf point size (px); 0 for lines
out vec3 vCol;
void main(){ vCol=aCol; gl_PointSize=aSize; gl_Position=vec4(aPos,0.0,1.0); }`;

const FS_VIZ = `#version 300 es
precision highp float;
in vec3 vCol;
uniform float uPoint;                 // 1 = soft round leaf, 0 = opaque branch/ground line
uniform float uPointAlpha;            // leaf opacity — eased down as foliage density climbs (haze, not a wall)
uniform float uLineAlpha;             // branch/line opacity — 1 solid, <1 for the faint skeleton over the foliage
out vec4 frag;
void main(){
  if(uPoint>0.5){ vec2 d=gl_PointCoord*2.0-1.0; float r2=dot(d,d); if(r2>1.0) discard; frag=vec4(vCol,(1.0-r2)*uPointAlpha); }
  else frag=vec4(vCol, uLineAlpha);
}`;

// ===========================================================================
// create(canvas, opts) — one self-contained engine instance on a canvas.
// ===========================================================================
function create(canvas, opts){
  opts = opts || {};
  const gl = canvas.getContext('webgl2', { antialias:false, alpha:false, premultipliedAlpha:false });
  function fail(msg){ throw new Error(`komorebi: ${msg}`); }
  if (!gl) fail('WebGL2 is required and not available in this browser.');
  const extCBF = gl.getExtension('EXT_color_buffer_float');     // renderable half/float
  gl.getExtension('EXT_float_blend');                            // genuinely OPTIONAL: it only governs blending into *32-bit* float
                                                                 // targets. Every blend target here is RGBA16F (makeLayerTexture: the
                                                                 // layers, faithTex, faithScratch), which is color-renderable AND
                                                                 // blendable in core WebGL2 once EXT_color_buffer_float is present.
                                                                 // The only RGBA32F textures (clusterTex/clusterGeomTex) are data
                                                                 // textures, texelFetch-sampled, never blended — so do NOT promote this
                                                                 // to a hard requirement (it would reject capable 16F-blend devices).
  if (!extCBF) fail('EXT_color_buffer_float is required (float render targets).');
  const MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;  // caps the per-clump data-texture width
  // profiling (EDITOR only): GPU timer queries for absolute per-pass ms. The extension is often absent or
  // coarsened by browsers for privacy — callers must tolerate null (the editor falls back to the stress
  // burst). EXT_disjoint_timer_query_webgl2 measures TIME_ELAPSED over a range of GL commands.
  const extTimer = EDITOR ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;

  const params = Object.assign({}, DEFAULTS, migrateLegacy(opts.params) || {});
  // Auto-quality runtime throttle (driven by the params.auto_quality toggle). Holds the live
  // resolution / sample-count it trims to. Never touches the artistic params.
  const perf = { auto:false, quality:1, resScale:1, sampleCount:params.sample_count, bres:0, acc:0, lowCount:0, hiCount:0, upWait:20, glow:false };  // bres = size the layer textures are currently built at (so applyQuality knows when to reallocate); glow = the lateral-diffusion tier actually ran this frame (false when gated off OR when its 16F targets came back incomplete)
  // Motion — one time-driven state, two bands (spec §5). u = longitudinal sway fraction (signed, along the
  // effective wind), uLat = lateral (crosswind) sway fraction; each its own spring. windX/Y = the effective
  // wind direction after the weather veer; weatherS = the live weather strength multiplier (read by the HUD);
  // driveEnv = the asymmetric-edged longitudinal force; env = [0,1] gust intensity for the hierarchy breathing.
  const motion = { time:0, u:0, v:0, uLat:0, vLat:0, env:0, driveEnv:0, sway:[0,0], windX:1, windY:0, weatherS:1 };
  // Transition — cloud-bloom crossfade between looks (spec §9). t walks 0->1 over dur: the continuous
  // params morph, the grove swaps once at the bloom peak, and `bloom` is a transient overcast that hides it.
  const trans = { active:false, t:0, dur:1.5, from:null, to:null, swapped:false, structDiff:false, canopyMorph:false, bloom:0, onEnd:null };
  const effCloud = () => clamp(lerp(params.cloud_thickness, 1, trans.bloom), 0, 1);  // cloud, swollen toward overcast mid-transition
  const bakeBaseline = () => (params.bake_resolution > 0 ? params.bake_resolution|0 : params.tex_resolution|0);  // TUNE §9: decoupled bake size; 0 follows tex_resolution.
  // Live bake / layer-texture size. Pure function of quality + params: when auto_quality is engaged it trims the
  // bake below the knee (q<0.5) alongside samples, snapped to 256 so the textures only reallocate at a level
  // boundary — not on every fps nudge. rebuildTextures/bake both read this (transport samples by UV → smaller = softer).
  const bakeRes = () => {
    const full = bakeBaseline();
    if(!perf.auto || perf.quality >= 0.5) return full;
    return clamp(Math.round(lerp(BAKE_MIN, full, perf.quality/0.5)/256)*256, BAKE_MIN, full);
  };
  // IS THE FAITHFUL TIER ACTUALLY RUNNING? The flag alone no longer answers it, so nothing reads the flag directly:
  // the faithful bake pre-integrates the whole cast into ONE texture in ONE frame — floor (x,y) or cloth (u,v) — and
  // the ENCLOSURE's receiver is neither, it is a per-pixel ray cast onto sloped panels. So receiver 2 forces the
  // LAYER path, which is the general-geometry tier: it re-projects per pixel from (world, recvZ) and therefore works
  // on any receiver at all. That is not a downgrade here — at enclosure distances the cast is deep in the pinhole
  // regime (metres of occluder height against a fabric a metre or two off), where the layer tier's height
  // quantization is invisible under the disk blur. The cheap path is the correct path in this branch.
  // THE SKY VIEW is out for the same reason, one step further: it has no cast frame at all — it reads the occluder
  // field along the EYE's rays, and the faithful texture is a pre-integration along the SUN's. There is nothing for
  // a single tap to be a tap of.
  // ONE predicate, read by every path decision (bake dispatch, texture sizing, the .z packing convention, the
  // twig-hug, auto-quality's cost model, show_layer, and the uFaithful uniform), because those must agree per frame
  // or the layer bake reads faithful-packed cluster data and the leaves slide off their twigs. Safe to be a derived
  // value rather than state because both `receiver` and `sky_view` are MODE_KEYS flags: a flip forces the full rebuild.
  const faithfulOn = () => params.faithful_canopy && (params.receiver|0) !== 2 && !params.sky_view;

  function compile(type, src){
    const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) fail(`Shader: ${gl.getShaderInfoLog(s)}\n${src}`);
    return s;
  }
  function program(vs,fs){
    const p=gl.createProgram();
    gl.attachShader(p,compile(gl.VERTEX_SHADER,vs));
    gl.attachShader(p,compile(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) fail(`Link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }
  const progBake = program(VS_BAKE, FS_BAKE);
  const progFaith = program(VS_FAITH, FS_FAITH);   // FAITHFUL leaf bake (§4.5): per-sample transmittance at continuous heights
  const progFaithSeg = program(VS_FAITH_SEG, FS_FAITH_SEG);   // FAITHFUL skeleton bake (§4.5): trunk+branches+twigs as geometry
  const progFAcc = program(VS_FULL, FS_FACC);      // FAITHFUL accumulate: Σ w_i·transmittance_i
  const progBlit = program(VS_FULL, FS_BLIT);
  const progPresent = program(VS_FULL, FS_PRESENT);                   // adaptive frame-rate: offscreen frame -> screen
  const progGlowBlur = program(VS_FULL, FS_GLOW_BLUR);                // lateral diffusion (§4.9): one axis of the separable spread
  const progGlowMix = program(VS_FULL, FS_GLOW_MIX);                  // lateral diffusion: the sharp/blurred split + the relocated tone-map tail
  const progPoints = EDITOR ? program(VS_POINTS, FS_POINTS) : null;   // editor-only debug-overlay programs
  const progViz = EDITOR ? program(VS_VIZ, FS_VIZ) : null;

  const U = {};
  function loc(prog, name){ return gl.getUniformLocation(prog, name); }
  U.bake = { origin:loc(progBake,'uCanopyOrigin'), extent:loc(progBake,'uCanopyExtent'), edge:loc(progBake,'uEdge'),
             morph:loc(progBake,'uMorph'), morphAmount:loc(progBake,'uMorphAmount'), sway:loc(progBake,'uSway'),
             windLevel:loc(progBake,'uWindLevel'), windTime:loc(progBake,'uWindTime'),
             leafSwing:loc(progBake,'uLeafSwing'), flutterFreq:loc(progBake,'uFlutterFreq'), stemLen:loc(progBake,'uStemLen'),
             clusterTex:loc(progBake,'uClusterTex'), clusterGeom:loc(progBake,'uClusterGeom') };
  U.faith = { origin:loc(progFaith,'uFaithOrigin'), extent:loc(progFaith,'uFaithExtent'), g:loc(progFaith,'uG'), edge:loc(progFaith,'uEdge'),
              curtainBake:loc(progFaith,'uCurtainBake'), clothY:loc(progFaith,'uClothY'),
              morph:loc(progFaith,'uMorph'), morphAmount:loc(progFaith,'uMorphAmount'), sway:loc(progFaith,'uSway'), hRef:loc(progFaith,'uHRef'),
              windLevel:loc(progFaith,'uWindLevel'), windTime:loc(progFaith,'uWindTime'),
              leafSwing:loc(progFaith,'uLeafSwing'), flutterFreq:loc(progFaith,'uFlutterFreq'),   // (uStemLen removed: faithful dropped the twig-swing that used it)
              clusterTex:loc(progFaith,'uClusterTex'), clusterGeom:loc(progFaith,'uClusterGeom') };
  U.faithSeg = { origin:loc(progFaithSeg,'uFaithOrigin'), extent:loc(progFaithSeg,'uFaithExtent'), g:loc(progFaithSeg,'uG'), woodTau:loc(progFaithSeg,'uWoodTau'),
                 curtainBake:loc(progFaithSeg,'uCurtainBake'), clothY:loc(progFaithSeg,'uClothY'),
                 segSway:loc(progFaithSeg,'uSegSway'), segTau:loc(progFaithSeg,'uSegTau') };
  U.facc = { tex:loc(progFAcc,'uFAccTex'), weight:loc(progFAcc,'uFAccWeight') };
  // ---- THE TRANSPORT PROGRAM CACHE (spec §4.6/§4.9). One program per camera, built by buildTransport, compiled on
  // FIRST USE and then kept for the engine's life. Four is the whole space, and the build key only moves on a MODE
  // flip (sky_view / receiver), which already tears the grove down and rebuilds it under the transition bloom — so
  // the one first-compile a camera ever costs lands inside that bloom, where a frame's hitch is already hidden, and
  // never recurs. Nothing is shared across engines: an A/B wipe's second instance has its own GL context and builds
  // its own cache, because a program belongs to the context that linked it. ----
  const transportCache = new Map();
  // Which variant this draw runs. The same order the old mega-shader's branch chain read, and it can only change
  // across a structural rebuild: sky_view and receiver are both MODE_KEYS.
  const transportCamera = () => params.sky_view ? 'sky' : (params.receiver|0) === 2 ? 'enclosure' : (params.receiver|0) !== 0 ? 'cloth' : 'floor';
  // The per-variant location table, read straight off the registry: a variant's table holds exactly the keys its
  // groups declare, and nothing else. That is what lets the upload skip by GROUP rather than by null-checking a
  // location — a uniform that genuinely goes missing surfaces as a missing one instead of hiding among a dozen
  // deliberate nulls.
  function transportLocs(prog, camera){
    const u = {};
    for(const name of CAMERAS[camera].groups){
      const locs = TRANSPORT_GROUPS[name].locs;
      if(!locs) continue;                                    // a functions-only group (the taps, the fold field, the warp)
      for(const key in locs){
        const n = locs[key];
        u[key] = Array.isArray(n) ? n.map(one => loc(prog, one)) : loc(prog, n);
      }
    }
    return u;
  }
  function transportFor(camera){
    let e = transportCache.get(camera);
    if(!e){
      const prog = program(VS_FULL, buildTransport(camera));
      e = { prog, U: transportLocs(prog, camera) };
      transportCache.set(camera, e);
    }
    return e;
  }
  U.blit = { tex:loc(progBlit,'uTex') };
  U.present = { tex:loc(progPresent,'uTex') };
  U.glowBlur = { tex:loc(progGlowBlur,'uTex'), step:loc(progGlowBlur,'uStep') };
  U.glowMix = { sharp:loc(progGlowMix,'uSharp'), blur:loc(progGlowMix,'uBlur'), diffuse:loc(progGlowMix,'uDiffuse'),
                exposure:loc(progGlowMix,'uExposure'), contrast:loc(progGlowMix,'uContrast'), tone:loc(progGlowMix,'uToneMap') };
  if(EDITOR){   // editor-only debug-overlay uniforms
    U.pts = { scale:loc(progPoints,'uScale'), maxW:loc(progPoints,'uMaxW') };
    U.viz = { point:loc(progViz,'uPoint'), pointAlpha:loc(progViz,'uPointAlpha'), lineAlpha:loc(progViz,'uLineAlpha') };
  }

  // ---- geometry / GPU buffers ----
  const emptyVAO = gl.createVertexArray();           // required to issue attrib-less draws
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  // editor-only debug-overlay buffers (source point cloud + tree-preview inset); skipped in the player build
  let srcDbgBuf=null, srcDbgVAO=null, vizBuf=null, vizVAO=null;
  if(EDITOR){
    srcDbgBuf = gl.createBuffer();
    srcDbgVAO = gl.createVertexArray();
    gl.bindVertexArray(srcDbgVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, srcDbgBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,12,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,1,gl.FLOAT,false,12,8);
    gl.bindVertexArray(null);

    // tree-preview inset buffer: interleaved (pos.xy, col.rgb, size) — 6 floats/vertex, refilled per frame
    vizBuf = gl.createBuffer();
    vizVAO = gl.createVertexArray();
    gl.bindVertexArray(vizVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, vizBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,1,gl.FLOAT,false,24,20);
    gl.bindVertexArray(null);
  }

  const bakeFBO = gl.createFramebuffer();
  const faithFBO = gl.createFramebuffer();   // FAITHFUL scratch target (§4.5): faithScratch attached here once per bake so the per-sample loop swaps FBOs instead of re-attaching (was 2N framebufferTexture2D/frame)
  let layerTex = [];           // MAX_LAYERS textures (active sized, inactive 1x1)
  let layerVAO = [];           // per-layer leaf instance VAOs {vao,count,buf}
  let faithTex = null;         // FAITHFUL path (§4.5): pre-integrated soft shadow (RGBA16F); 1×1 when faithful_canopy off
  let faithScratch = null;     // FAITHFUL path: per-sample transmittance scratch (RGBA16F); 1×1 when off
  let hier = null;             // branch hierarchy: limb + twig spring state (built in regenCanopy)
  let clusterTex = null;       // per-clump dynamic bend angles (limb, twig), updated each frame
  let clusterGeomTex = null;   // per-clump static geometry (clump centre + trunk pivot)
  let benchFBO=null, benchTex=null, benchW=0, benchH=0;   // profiler stress-burst target (EDITOR; hoisted here so dispose() can free it)
  // adaptive frame-rate (TUNE §9): offscreen present target + cadence state. presentFBO/presentTex are canvas-sized
  // and allocated lazily on first use (so a look that never enables adaptive_motion pays nothing).
  let presentFBO=null, presentTex=null, presentW=0, presentH=0, adaptiveLastRender=0, adaptiveHot=true;
  const ADAPT_HI=0.05, ADAPT_LO=0.02;   // hysteresis on the motion magnitude: above HI render every frame, below LO drop to idle_fps
  // lateral diffusion (§4.9): [0] = transport's LINEAR-HDR frame (the sharp one), [1]/[2] = the separable blur's
  // ping/pong. RGBA16F at the render size, one FBO each (attached once at allocation, so no per-frame re-attach),
  // allocated lazily on first use and reallocated on resize — a look that never opens the gate holds no VRAM.
  const glowFBO=[null,null,null], glowTex=[null,null,null];
  let glowW=0, glowH=0, glowFail=false;   // glowFail LATCHES an incomplete FBO: the tier then silently stops being offered (perf.glow stays false) and every frame takes the direct path
  const GLOW_TAPS = 6;                    // 13 taps: centre + this many each side. NOT independently tunable — FS_GLOW_BLUR's weight table is computed for exactly this count; change one and recompute the other
  const GLOW_STEP_MAX = 6.0;              // px between taps — the cap that trades reach for a clean kernel (see FS_GLOW_BLUR)
  const src = { flat:new Float32Array(0), count:0, maxR:1, maxW:1, haloR:0.01,
                coreR:0.005, moonD:0, moonR:0, Lcore:0, Lhalo:0 };   // + the SEEN source (§4.9 sky view): angular radii, the eclipse moon, and the radiance in each region — all filled by regenSource from the sampler's own numbers
  const occ = { rest:[], ht:new Float32Array(0), segBuf:new Float32Array(MAX_OCC*4), count:0, want:0, hRef:1 };   // woody occluder (trunk + main limbs): `rest` segments {ax..py} regrown, `ht` static (heights+radius), `segBuf` refilled per frame with the limb bend, `hRef` = tallest floor height for the drift's height-scale (spec §4.5)
  // ...and the GPU side of that table (§4.5/§6): one RGBA32F, MAX_OCC wide and 2 tall — row 0 the swung plan
  // endpoints, row 1 the static heights + radius. Allocated once at the cap and never resized, because the cap is a
  // compile-time constant on both sides of the wire. This is the clusterTex idiom, for the same reason: a per-frame
  // table that every transport variant reads has no business sitting in the fragment uniform budget.
  const occTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, occTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_OCC, 2, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);   // texelFetch ignores filtering, but an unfilterable float texture must still declare NEAREST to be complete
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const faith = { vao:null, buf:null, count:0, hMin:0, hMax:1, ox:0, oy:0, ext:1,   // FAITHFUL leaf geometry (all leaves, continuous height) + the cast-region frame, computed in bakeFaithful (§4.5)
                  pminx:0, pmaxx:0, pminy:0, pmaxy:0,                                // real plan AABB of leaves+wood (regenCanopy) → cast-frame bound, so a wide grove's outer crown isn't clipped
                  gx:new Float32Array(MAX_SAMPLES), gy:new Float32Array(MAX_SAMPLES),// per-sample ground-shift scratch (hoisted; no per-bake alloc)
                  segVAO:null, segBuf:null, segRest:[], segArr:null, segCount:0 };   // + the woody skeleton (trunk+branches+twigs): rest segments, the per-bake swayed instance array, its VAO
  // SKY VIEW's share of that skeleton (§4.9): the FINE wood (level > 1) the analytic occluder never carries, sorted
  // into the leaves' own depth layers so a twig and the leaves hanging on it stamp into the SAME texture. Built
  // only when the look-up camera is on; empty otherwise, and the layer bake then draws nothing extra.
  const sky = { segVAO:null, segBuf:null, segRest:[], segArr:null, start:[], count:[] };

  function makeLayerTexture(size){
    const t=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,size,size,0,gl.RGBA,gl.HALF_FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return t;
  }
  function rebuildTextures(){
    layerTex.forEach(t=>{ gl.deleteTexture(t); });
    layerTex = [];
    const res = bakeRes();
    perf.bres = res;                                 // remember the built size; applyQuality reallocates when bakeRes() crosses it
    for(let i=0;i<MAX_LAYERS;i++){
      // faithful mode never bakes or samples the layer textures (transport taps faithTex once), so size them 1×1
      // there too — saves ~layer_count·res²·8 bytes of dead VRAM (≈16 MB at defaults). Reallocated full when faithful off.
      layerTex.push(makeLayerTexture((i < params.layer_count && !faithfulOn()) ? res : 1));
    }
    // FAITHFUL path (§4.5): the soft-shadow accumulator + per-sample scratch. 1×1 when off, so the park / layer
    // path allocates nothing extra; full bake-res when faithful_canopy is on.
    if(faithTex) gl.deleteTexture(faithTex);
    if(faithScratch) gl.deleteTexture(faithScratch);
    const fres = faithfulOn() ? res : 1;
    faithTex = makeLayerTexture(fres);
    faithScratch = makeLayerTexture(fres);
  }

  // ---- canopy generation: grow a real recursive skeleton, hang one leaf cluster on each
  // terminal twig, and bin them into depth layers by the height they grew to (spec §4.5) ----
  function regenCanopy(){
    const prevHier = hier;   // keep the old hierarchy so a same-topology regrow can carry the in-flight sway across
    layerVAO.forEach(L=>{ gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.buf); });
    layerVAO = [];
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
    hier = {
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
    clusterTex     = makeDataTex(clusterTex, hier.clusterData);      // dynamic bend angles
    clusterGeomTex = makeDataTex(clusterGeomTex, hier.clusterGeom);  // static geometry
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
    publishBend();   // push the (preserved or rest) bend into the fresh texture, so a bake right after a regrow isn't a frame snapped to rest
  }

  // ---- bake leaves into per-layer optical-depth textures ---------------------
  function bake(){
    if(faithfulOn()){ bakeFaithful(); return; }   // FAITHFUL path (§4.5): cast the real tree, not the layer slabs
    const res = bakeRes();
    const E = params.canopy_extent_m;
    gl.useProgram(progBake);
    gl.uniform2f(U.bake.origin, -E/2, -E/2);
    gl.uniform2f(U.bake.extent, E, E);
    gl.uniform1f(U.bake.edge, params.edge_softness);
    gl.uniform1f(U.bake.morph, params.drift_phase);
    gl.uniform1f(U.bake.morphAmount, params.drift_amount);
    gl.uniform1f(U.bake.windLevel, motion.u);
    gl.uniform1f(U.bake.windTime, motion.time);
    gl.uniform1f(U.bake.leafSwing, params.leaf_swing);
    gl.uniform1f(U.bake.flutterFreq, params.flutter_freq);
    gl.uniform1f(U.bake.stemLen, params.stem_length);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, clusterTex);     gl.uniform1i(U.bake.clusterTex, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, clusterGeomTex); gl.uniform1i(U.bake.clusterGeom, 5);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);
    gl.viewport(0,0,res,res);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);          // optical depth accumulates additively
    const H=layerHeights(), base=params.canopy_base_height_m;
    // ALPHA IS THE WOOD'S CHANNEL IN SKY MODE (§4.9). The layer texture's rgb is the foliage's per-channel optical
    // depth and its alpha has never been read by anything — tap/tapUp/tapCA and the debug blit all take .rgb — so the
    // look-up camera claims it for the skeleton, and the leaves must stop writing their coverage there or the two
    // would sum into one meaningless number. A colour mask does it without touching the leaf shader, which keeps
    // every other look's bake bit-for-bit what it was.
    for(let l=0;l<params.layer_count;l++){
      // higher layers ride longer levers -> sway more when height gain > 0 (else pure translation)
      const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
      gl.uniform2f(U.bake.sway, motion.sway[0]*f, motion.sway[1]*f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layerTex[l], 0);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // depth 0 -> transmittance 1. UNMASKED: alpha is the wood's channel in sky mode and must be cleared too, or it accumulates across bakes
      if(params.sky_view) gl.colorMask(true, true, true, false);
      const L=layerVAO[l];
      gl.bindVertexArray(L.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, L.count);
      if(params.sky_view) gl.colorMask(true, true, true, true);   // back to full before the next layer's clear
    }
    // The woody TRUNK and MAIN LIMBS are never stamped here — they are the continuous-height analytic occluder in
    // transport (§4.5), because a long segment cut into layer bands casts a shadow that shatters into a staircase.
    // The SKY VIEW adds back the FINE wood only (§4.9): it is read along the eye's ray rather than cast, it is short
    // enough to sit inside one band, and it carries the same per-layer sway the leaves in that band get — so the
    // leaves have visible twigs to hang on instead of floating in clouds around bare limb tips.
    if(params.sky_view && params.branch_tau > 0 && sky.segRest.length > 0){
      fillSwayedSegs(sky.segRest, sky.segArr, 0, 0);   // the coherent translation arrives per LAYER below, exactly as the leaves take it
      gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sky.segArr);
      gl.useProgram(progFaithSeg);
      gl.uniform2f(U.faithSeg.origin, -E/2, -E/2);
      gl.uniform2f(U.faithSeg.extent, E, E);          // the CANOPY plan frame, the leaves' own — no sun projection here
      gl.uniform2f(U.faithSeg.g, 0.0, 0.0);           // g is where a shadow FALLS; nothing here is a shadow
      gl.uniform1i(U.faithSeg.curtainBake, 0);
      gl.uniform1f(U.faithSeg.woodTau, params.branch_tau);
      gl.uniform1i(U.faithSeg.segTau, 1);             // layer textures accumulate OPTICAL DEPTH additively
      gl.bindVertexArray(sky.segVAO);
      for(let l=0;l<params.layer_count;l++){
        if(!sky.count[l]) continue;
        const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
        gl.uniform2f(U.faithSeg.segSway, motion.sway[0]*f, motion.sway[1]*f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layerTex[l], 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, sky.segBuf);   // draw this layer's slice: no baseInstance in WebGL2, so the attribute origin moves instead
        gl.vertexAttribPointer(1,4,gl.FLOAT,false,32,sky.start[l]*32);
        gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,sky.start[l]*32+16);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sky.count[l]);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- FAITHFUL leaf bake (spec §4.5): the opt-out from the depth-layer cheat. Each leaf casts from its OWN
  // continuous grown height, so the cast IS the preview tree (leaves on their twigs, aligned with the wood). The
  // "many suns" convolution is done as GEOMETRY: for each source sample, draw every leaf shifted to its floor
  // landing (world - height·g_i) with MULTIPLICATIVE blend → transmittance_i in a scratch buffer, then add
  // w_i·transmittance_i into the accumulator. The result is one soft-shadow texture transport taps ONCE. Cost moves
  // from the per-pixel sample loop to per-sample bake passes — gated, so the park / layer path pays nothing. ----
  // ---- the swayed skeleton, filled ONCE and read by two bakes (§4.5/§4.9). Each segment is rotated by its limb's
  // bend about its tree pivot, and a TERMINAL segment first swings about its own twig base by that clump's twig bend —
  // the same pivot, angle and order VS_FAITH gives the leaves hanging on it, so they ride the twig instead of sliding
  // off it. `swx/swy` is the coherent whole-tree translation: the CAST wants it height-scaled and folded in here; the
  // SKY view's layer stamp wants the leaf bake's own per-layer factor instead and passes 0, taking it as a uniform. ----
  function fillSwayedSegs(R, sa, swx, swy){
    const la = hier ? hier.limbAngle : null, ta = hier ? hier.twigAngle : null;
    const lat = hier ? hier.limbAttach : null;   // per-limb attach height: where the sway_pitch foreshorten is anchored (§5.1)
    const lp = hier ? hier.limbPitch : null;     // per-limb pitch DOF: the angle the foreshorten is taken from (§5.1)
    const hRef = Math.max(faith.hMax, 1e-3);
    const sp = Math.max(0, params.sway_pitch);   // 3-D lean (§5): foreshorten the wood heights by the SAME factor the leaves use, so leaf-on-wood registration holds
    for(let k=0;k<R.length;k++){
      const s = R[k];
      const th = (la && s.limb>=0 && s.limb<la.length) ? la[s.limb] : 0;
      // MEDIUM band (§5.4): terminal wood first swings about its OWN twig base by that clump's twig bend, before
      // the limb rotation — the same pivot, angle and order VS_FAITH gives the leaves hanging on it, so they ride
      // the twig instead of sliding off it. Interior wood (clump<0) is untouched. sway_pitch meets the band here
      // and stays orthogonal: `fore` scales HEIGHTS off the limb bend, this is a plan-plane yaw. tf=0 → tt=0 → rest.
      const tt = (ta && s.clump>=0) ? ta[s.clump] : 0;
      let ax=s.ax, ay=s.ay, bx=s.bx, by=s.by;
      if(tt!==0){
        const ctw=Math.cos(tt), stw=Math.sin(tt), tbx=s.tbx, tby=s.tby;
        const dax=ax-tbx, day=ay-tby, dbx=bx-tbx, dby=by-tby;
        ax = tbx + ctw*dax - stw*day; ay = tby + stw*dax + ctw*day;
        bx = tbx + ctw*dbx - stw*dby; by = tby + stw*dbx + ctw*dby;
      }
      const c=Math.cos(th), sn=Math.sin(th), px=s.px, py=s.py, o=k*8;
      // the SAME expression publishBend gives this limb's clumps, off the SAME pitch DOF — leaf-on-wood
      // registration is only kept by the two staying literally in lockstep (§5.1). The plan rotation above
      // is the yaw DOF; this is the elevation one, and the two compose orthogonally.
      const ph = (sp>0 && lp && s.limb>=0 && s.limb<lp.length) ? lp[s.limb] : 0;
      const fore = sp>0 ? clamp(1 - sp*(1-Math.cos(ph)), 0.1, 1) : 1;
      // ANCHOR the foreshorten at the limb's attach height (§5.1): h' = at + (h−at)·fore, so at the join h' = at
      // exactly and the pitching limb cannot part from the trunk axis, which does not pitch. Same sign for a droop
      // tip hanging BELOW the attach — rotating a limb down about its joint moves every point toward the attach
      // plane. Trunk wood (limb<0) never pitches, and at=0 with fore=1 reproduces h' = h exactly (byte-identical).
      const at = (sp>0 && lat && s.limb>=0 && s.limb<lat.length) ? lat[s.limb] : 0;
      const ha = at + (s.ha-at)*fore, hb = at + (s.hb-at)*fore;
      const kA = ha/hRef, kB = hb/hRef;   // sway grows with height: 0 at the ground → the trunk base stays PLANTED, the crown sways; same fraction for a limb & the trunk at its height, so they stay joined
      sa[o]   = px + c*(ax-px) - sn*(ay-py) + swx*kA;
      sa[o+1] = py + sn*(ax-px) + c*(ay-py) + swy*kA;
      sa[o+2] = px + c*(bx-px) - sn*(by-py) + swx*kB;
      sa[o+3] = py + sn*(bx-px) + c*(by-py) + swy*kB;
      sa[o+4]=ha; sa[o+5]=hb; sa[o+6]=s.ra; sa[o+7]=s.rb;
    }
  }

  function bakeFaithful(){
    if(faith.count===0){ gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
    const res = bakeRes(), N = src.count;
    // cast-region frame: the shadow lands OFFSET from the canopy by the bulk throw (standing scene), so the faith
    // texture must cover where it FALLS, not the canopy plan. world = planPoint − g·h, so the cast box is the REAL
    // plan AABB (faith.p*, leaves+wood) swept over the height range [hLo,hMax] and the per-sample g-range — then padded
    // and squared. (Only the g-EXTREMES matter, so track those in the sample loop instead of an O(8N) corner sweep.)
    const proj = projMatrix();
    const gx=faith.gx, gy=faith.gy;
    const _b=bulkShift(), bulkX=_b[0], bulkY=_b[1];   // standing-scene lateral throw (shared helper; 0 when off)
    const woodOn = params.branch_tau > 0 && faith.segCount > 0;
    let gminx=1e18,gmaxx=-1e18,gminy=1e18,gmaxy=-1e18;
    for(let i=0;i<N;i++){
      const sx=src.flat[3*i], sy=src.flat[3*i+1];
      const gxi = proj[0]*sx + proj[2]*sy + bulkX;   // g = uProj·sample + bulk  (mat2 column-major: [0,1]=col0, [2,3]=col1)
      const gyi = proj[1]*sx + proj[3]*sy + bulkY;
      gx[i]=gxi; gy[i]=gyi;
      if(gxi<gminx)gminx=gxi; if(gxi>gmaxx)gmaxx=gxi; if(gyi<gminy)gminy=gyi; if(gyi>gmaxy)gmaxy=gyi;
    }
    // wood reaches the ground (trunk base h=0); without wood, leaves start at hMin — BUT sway_pitch foreshortens
    // heights, so widen the low bound there so a foreshortened leaf's (closer-in) cast isn't clipped out of the
    // frame. 0.1× is publishBend's clamp floor applied from the GROUND, which is now merely CONSERVATIVE padding:
    // the foreshorten is anchored at the limb's attach height (§5.1), so h' = 0.1·h + 0.9·attachH ≥ 0.1·h with
    // attachH ≥ 0. Kept as-is — the slack costs frame padding, nothing else. (A leaf hanging BELOW its attach rises
    // instead, but only toward attachH, a height the trunk wood already occupies — so hHi needs no matching widening.)
    const hLo = woodOn ? 0 : faith.hMin*(params.sway_pitch>0 ? 0.1 : 1), hHi = faith.hMax;
    // pad: the leaf quad half-extent, the incoherent drift orbit, and the live coherent sway (leaves+wood translate
    // by up to |sway| at the crown) — none of which are in the rest plan AABB. (The twig-hug trail-back already is.)
    const pad = params.leaf_size_m + params.drift_amount + Math.hypot(motion.sway[0],motion.sway[1]) + 0.05;
    let minx,maxx,miny,maxy;
    if(params.receiver){
      // CURTAIN cast frame (§4.9): occluders project onto the VERTICAL cloth (Y=cy), not the floor — the projection is
      // nonlinear in g (÷gy), so sweep the plan-AABB corners × the height range through each sample's cloth map
      // (u = px − r·gx, v = h − r; r = (py−cy)/gy) and bound the (u,v) span. (8 corners × N samples — cheap.)
      const cy = params.cloth_distance_m;
      let uMin=1e18,uMax=-1e18,vMin=1e18,vMax=-1e18;
      const pxs=[faith.pminx,faith.pmaxx], pys=[faith.pminy,faith.pmaxy], hs=[hLo,hHi];
      for(let i=0;i<N;i++){
        let gyi=gy[i]; if(Math.abs(gyi)<1e-3) gyi = gyi<0?-1e-3:1e-3;
        for(const py of pys){ const r=(py-cy)/gyi;
          for(const px of pxs){ const u=px - r*gx[i]; if(u<uMin)uMin=u; if(u>uMax)uMax=u; }
          for(const h of hs){ const v=h - r; if(v<vMin)vMin=v; if(v>vMax)vMax=v; }
        }
      }
      minx=uMin-pad; maxx=uMax+pad; miny=vMin-pad; maxy=vMax+pad;
    } else {
      // FLOOR cast frame: world = planPoint − g·h, so the box is the plan AABB swept over the −g·h extremes
      // (only the g-EXTREMES matter, so the per-sample loop tracked those instead of an O(8N) corner sweep).
      const ghx0=Math.min(gminx*hLo,gminx*hHi,gmaxx*hLo,gmaxx*hHi), ghx1=Math.max(gminx*hLo,gminx*hHi,gmaxx*hLo,gmaxx*hHi);
      const ghy0=Math.min(gminy*hLo,gminy*hHi,gmaxy*hLo,gmaxy*hHi), ghy1=Math.max(gminy*hLo,gminy*hHi,gmaxy*hLo,gmaxy*hHi);
      minx=faith.pminx-ghx1-pad; maxx=faith.pmaxx-ghx0+pad; miny=faith.pminy-ghy1-pad; maxy=faith.pmaxy-ghy0+pad;
    }
    const side = Math.max(maxx-minx, maxy-miny, 1e-3);
    faith.ox = (minx+maxx)/2 - side/2; faith.oy = (miny+maxy)/2 - side/2; faith.ext = side;

    gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);
    gl.viewport(0,0,res,res);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, faithTex, 0);
    gl.disable(gl.BLEND); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // accumulator starts at 0 (Σ w·T)
    // attach the two persistent targets ONCE: faithTex→bakeFBO (above) and faithScratch→faithFBO (here). The
    // per-sample loop then just binds whichever FBO it wants — no per-sample framebufferTexture2D (2N → 2/bake).
    gl.bindFramebuffer(gl.FRAMEBUFFER, faithFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, faithScratch, 0);

    // static faith-VS uniforms (wind / flutter — match the preview & the layer bake); only uG changes per sample
    gl.useProgram(progFaith);
    gl.uniform2f(U.faith.origin, faith.ox, faith.oy);
    gl.uniform2f(U.faith.extent, faith.ext, faith.ext);
    gl.uniform1f(U.faith.edge, params.edge_softness);   // soft leaf rim (same as the layer bake); 0 here = hard ellipses
    gl.uniform1i(U.faith.curtainBake, params.receiver ? 1 : 0);   // §4.9: project onto the vertical cloth (curtain) vs the floor
    gl.uniform1f(U.faith.clothY, params.cloth_distance_m);
    gl.uniform1f(U.faith.morph, params.drift_phase);
    gl.uniform1f(U.faith.morphAmount, params.drift_amount);
    gl.uniform1f(U.faith.windLevel, motion.u);
    gl.uniform1f(U.faith.windTime, motion.time);
    gl.uniform1f(U.faith.leafSwing, params.leaf_swing);
    gl.uniform1f(U.faith.flutterFreq, params.flutter_freq);
    gl.uniform2f(U.faith.sway, motion.sway[0], motion.sway[1]);
    gl.uniform1f(U.faith.hRef, Math.max(faith.hMax, 1e-3));   // height-scale the coherent sway → base anchored, crown sways (matches the wood)
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, clusterTex);     gl.uniform1i(U.faith.clusterTex, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, clusterGeomTex); gl.uniform1i(U.faith.clusterGeom, 5);

    // FAITHFUL skeleton (§4.5): refill the instance array with the live limb SWING + whole-tree drift, so the wood
    // sways WITH the leaves; then upload + set its statics once.
    if(woodOn){
      fillSwayedSegs(faith.segRest, faith.segArr, motion.sway[0], motion.sway[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, faith.segBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, faith.segArr);
      gl.useProgram(progFaithSeg);
      gl.uniform2f(U.faithSeg.segSway, 0.0, 0.0);   // the cast's sway is height-scaled and already in the instance data
      gl.uniform1i(U.faithSeg.segTau, 0);           // the cast's scratch is multiplicative: emit transmittance
      gl.uniform2f(U.faithSeg.origin, faith.ox, faith.oy);
      gl.uniform2f(U.faithSeg.extent, faith.ext, faith.ext);
      gl.uniform1f(U.faithSeg.woodTau, params.branch_tau);
      gl.uniform1i(U.faithSeg.curtainBake, params.receiver ? 1 : 0);   // §4.9: cloth vs floor projection (matches the leaves)
      gl.uniform1f(U.faithSeg.clothY, params.cloth_distance_m);
    }

    for(let i=0;i<N;i++){
      // PASS 1: transmittance_i into scratch (clear to 1 = fully lit; each leaf MULTIPLIES it down by exp(-τ))
      gl.bindFramebuffer(gl.FRAMEBUFFER, faithFBO);   // faithScratch (attached once above)
      gl.disable(gl.BLEND); gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.SRC_COLOR);   // dst *= src → Π exp(-τ)
      gl.useProgram(progFaith);
      gl.uniform2f(U.faith.g, gx[i], gy[i]);
      gl.bindVertexArray(faith.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, faith.count);
      if(woodOn){   // wood into the SAME scratch (still multiplicative) → leaves × wood = combined transmittance_i
        gl.useProgram(progFaithSeg);
        gl.uniform2f(U.faithSeg.g, gx[i], gy[i]);
        gl.bindVertexArray(faith.segVAO);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, faith.segCount);
      }
      // PASS 2: acc += w_i · transmittance_i  (additive, fullscreen)
      gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFBO);    // faithTex accumulator (attached once above)
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progFAcc);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, faithScratch); gl.uniform1i(U.facc.tex, 0);
      gl.uniform1f(U.facc.weight, src.flat[3*i+2]);
      gl.bindVertexArray(emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- source: Vogel-spiral cloud of weighted point-suns ---------------------
  function regenSource(){
    const N = clamp(Math.round(perf.auto ? perf.sampleCount : params.sample_count), 3, MAX_SAMPLES);
    const coreR = params.core_angular_radius_deg*DEG;
    const t = effCloud();                                  // cloud_thickness, pushed to overcast during a transition
    const haloDeg = lerp(params.halo_angular_radius_deg, 30, trans.bloom);  // the bloom also fattens the halo to wash out the grove swap
    const haloR = lerp(coreR*2.0, haloDeg*DEG, t);
    const Wcore = params.core_weight_fraction*(1.0-t);     // energy drains core->halo with cloud
    const Whalo = 1.0 - Wcore;
    const nCore = Math.max(3, Math.round(N*0.5));
    const nHalo = Math.max(0, N - nCore);
    const golden = Math.PI*(3 - Math.sqrt(5));
    const pts = [];
    for(let i=0;i<nCore;i++){
      const r = coreR*Math.sqrt((i+0.5)/nCore), a=i*golden;
      pts.push([r*Math.cos(a), r*Math.sin(a), Wcore/nCore]);
    }
    for(let i=0;i<nHalo;i++){
      const f=(i+0.5)/nHalo;
      const r=Math.sqrt(coreR*coreR + f*(haloR*haloR-coreR*coreR));  // area-uniform annulus
      const a=i*golden+0.5;
      pts.push([r*Math.cos(a), r*Math.sin(a), nHalo>0?Whalo/nHalo:0]);
    }
    // eclipse: occlude a moon-disk over the sun -> remaining samples form a crescent
    const moonR = params.eclipse ? coreR*1.0 : 0, moonD = params.eclipse ? coreR*(1.3-params.eclipse_amount) : 0;
    if(params.eclipse){
      for(const p of pts){ if(Math.hypot(p[0]-moonD, p[1])<moonR) p[2]=0; }
      let s=0; for(const p of pts) s+=p[2];
      if(s>0) for(const p of pts) p[2]/=s;     // renormalize (keep shape visible)
    }
    // THE SEEN SOURCE (§4.9, sky view): the same distribution these samples approximate, expressed as RADIANCE — the
    // core disk and the halo annulus, each carrying its post-cloud weight over its own solid angle. Derived HERE, from
    // the very numbers the sampler just used, so the sun you look at and the dapples it throws cannot drift apart:
    // raise cloud_thickness and the disk drains into the aureole by exactly the amount the dapples soften. Absolute
    // scale is authored — see SKY_SUN_GAIN.
    // The eclipse renormalization is ANALYTIC (circle-circle overlap) rather than the discrete sum just used above,
    // and deliberately so: the loop's sum is a 32-sample ESTIMATE of the energy the moon removes, and reusing it
    // would bake that estimate's error into the visible source. Integrating the field below against the true
    // overlap areas gives back exactly 1 — the same total the renormalized weights carry. What is left over, the gap
    // between the two core:halo splits, is the SAMPLER's own discretization and belongs to the sampler.
    const aCore = Math.PI*coreR*coreR, aHalo = Math.max(Math.PI*(haloR*haloR - coreR*coreR), 1e-12);
    const eatCore = lensArea(coreR, moonR, moonD);                     // moon ∩ core disk
    const eatHalo = lensArea(haloR, moonR, moonD) - eatCore;           // moon ∩ halo annulus = (moon ∩ whole source) − (moon ∩ core)
    const liveCore = Wcore*(1 - eatCore/aCore), liveHalo = Whalo*(1 - eatHalo/aHalo);
    const live = Math.max(liveCore + liveHalo, 1e-9);                  // 1 with no eclipse, so this whole block is inert then
    src.coreR = coreR; src.haloR = haloR; src.moonD = moonD; src.moonR = moonR;
    src.Lcore = SKY_SUN_GAIN * (Wcore/live) / aCore;
    src.Lhalo = SKY_SUN_GAIN * (Whalo/live) / aHalo;
    const flat=new Float32Array(pts.length*3);
    let mr=1e-9, mw=1e-9;
    pts.forEach((p,i)=>{ flat[i*3]=p[0]; flat[i*3+1]=p[1]; flat[i*3+2]=p[2];
      mr=Math.max(mr,Math.hypot(p[0],p[1])); mw=Math.max(mw,p[2]); });
    src.flat=flat; src.count=pts.length; src.maxR=mr; src.maxW=mw; src.haloR=haloR;
    if(EDITOR){   // push the cloud into the editor's source-inset buffer (player build has none)
      gl.bindBuffer(gl.ARRAY_BUFFER, srcDbgBuf);
      gl.bufferData(gl.ARRAY_BUFFER, flat, gl.DYNAMIC_DRAW);
    }
  }

  // per-frame scratch reused by the look uniforms (projMatrix/layerHeights/atmosphere) so a static frame allocates
  // nothing — they recompute fresh into these each call (no stale-cache risk: the sun-drag path mutates params
  // without an apply(), which a dirty-flag cache would miss; the recompute itself is sub-microsecond).
  const _proj = [0,0,0,0], _lh = new Float32Array(MAX_LAYERS), _atm = { sun:[0,0,0], ambient:[0,0,0] };
  const _bulk = [0,0];
  // STANDING-SCENE bulk shadow offset (§4.8): cot(elev)·(anti-sun direction) per unit height — the lateral throw the
  // park model omits. ONE helper, shared by transport's analytic occluder AND the faithful bake, so the two throws
  // can't silently drift apart. Floored at 6° — deliberately HIGHER than projMatrix's 4° ellipse floor: cot(elev)
  // diverges faster than the ellipse's 1/sin² as the sun nears the horizon, so the throw wants the tighter clamp.
  // Returns the shared scratch [0,0] when standing_scene is off (park model, byte-identical).
  function bulkShift(){
    // the bulk sun-angle throw is needed for BOTH the standing-scene floor AND the curtain receiver (it's what
    // projects the tree's shadow off to the side / onto the cloth). Off for the overhead park (receiver 0 + no
    // standing scene) → 0, byte-identical.
    if(!params.standing_scene && !params.receiver){ _bulk[0]=0; _bulk[1]=0; return _bulk; }
    const el=Math.max(params.sun_elevation_deg,6)*DEG, az=params.sun_azimuth_deg*DEG, k=Math.cos(el)/Math.sin(el);
    _bulk[0]=k*Math.cos(az); _bulk[1]=k*Math.sin(az); return _bulk;
  }
  // ---- the ellipse: angular offset -> ground displacement per unit height ----
  function projMatrix(){
    const el=Math.max(params.sun_elevation_deg,4)*DEG, az=params.sun_azimuth_deg*DEG;
    const se=Math.sin(el);
    const major=1/(se*se), minor=1/se;          // stretch along azimuth grows as sun lowers
    const ca=Math.cos(az), sa=Math.sin(az);
    _proj[0]=major*ca*ca+minor*sa*sa;
    _proj[1]=_proj[2]=(major-minor)*ca*sa;
    _proj[3]=major*sa*sa+minor*ca*ca;
    return _proj;                                // column-major (symmetric)
  }
  function layerHeights(){
    const n=params.layer_count, base=params.canopy_base_height_m, thick=params.canopy_thickness_m;
    for(let i=0;i<MAX_LAYERS;i++) _lh[i]= n>1 ? base+(i/(n-1))*thick : base;
    return _lh;
  }

  // ---- motion: integrate the limb and twig springs (children inherit parents) ----
  function tickHierarchy(steps, h){
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
    publishBend();
  }
  // write the current limb/twig bend into the per-clump texture the bake VS samples. Called at the end of a
  // hierarchy tick, and again after a grove-morph regrow (which hands us a fresh, zeroed texture). ----
  function publishBend(){
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
    gl.bindTexture(gl.TEXTURE_2D, clusterTex);
    // perf todo — clusterTex is single-buffered: this rewrites the whole row, then bake()'s VS texelFetches the
    // SAME texture the same frame, so next frame's upload can stall on the prior bake still draining it (a
    // per-frame GPU sync bubble). Ping-pong a 2-deep ring of cluster textures to break the write-after-read.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, hier.nClusterTotal, 1, gl.RGBA, gl.FLOAT, hier.clusterData);
  }
  function motionActive(){
    return params.wind_strength>0 || (params.drift_auto && params.drift_amount>0)
        || Math.abs(motion.u)>1e-3 || Math.abs(motion.v)>1e-3   // keep simulating until settled
        || Math.abs(motion.uLat)>1e-3 || Math.abs(motion.vLat)>1e-3
        || (hier && hier.maxV>2e-4);
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
    tickHierarchy(steps, h);                                  // limb + twig springs (medium band)
    motion.time += dt;
    // incoherent band: advance the drift phase (periodic in 2π). The editor reflects it in its slider.
    if(params.drift_auto && params.drift_amount>0){
      params.drift_phase = (params.drift_phase + params.drift_speed*dt) % TAU;
    }
  }

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
    const leafCount  = layerVAO.reduce((s,L)=>s+L.count, 0);       // current grove size
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
    trans.from = from; trans.to = to;
    trans.dur = Math.max(1e-3, opts.duration!=null ? opts.duration : trans.dur);
    trans.t = 0; trans.swapped = false; trans.bloom = 0; trans.active = true;
    trans.onEnd = opts.onEnd || null;
  }
  function tickTransition(dt){
    if(!trans.active) return;
    trans.t = Math.min(1, trans.t + Math.min(dt,1/15)/trans.dur);   // clamp the step like tick(): a tab-switch spike must not skip the bloom peak
    const t = trans.t, e = smoothstep(0,1,t);              // ease-in-out for the morph; raw t for the bloom hump
    trans.bloom = trans.structDiff ? Math.sin(Math.PI*t) : 0;   // 0 at the ends, full overcast at the midpoint
    for(const k of MORPH_KEYS){ const a=trans.from[k], b=trans.to[k];
      params[k] = ANGLE_SET.has(k) ? lerpAngle(a,b,e, k==='drift_phase'?TAU:360) : lerp(a,b,e); }
    if(trans.canopyMorph) for(const k of CANOPY_KEYS) params[k] = lerp(trans.from[k], trans.to[k], e);  // deform the SAME grove
    let rebuilt = false;
    if(!trans.swapped && t>=0.5){                          // swap the grove once, hidden under the bloom peak
      trans.swapped = true;
      if(trans.structDiff){
        for(const k in DEFAULTS) if(!MORPH_SET.has(k)) params[k] = trans.to[k];
        rebuildAll(); rebuilt = true;                      // regrow grove + textures + source + bake, all at once
      }
    }
    if(!rebuilt){
      if(trans.canopyMorph) regenCanopy();   // regrow the morphing grove (regenCanopy republishes the carried-over sway)
      regenSource();                         // morphed cloud -> source (always; transport re-reads it every frame)
      // re-bake only when the leaves actually move this frame — a grove morph, or live motion (wind/auto-drift,
      // both of which make motionActive() true). A settled-canopy look-crossfade keeps last frame's identical bake
      // (the tweening leaf_swing/flutter/stem knobs have no effect with motion.u≈0), so it's not re-rasterized.
      // EXCEPT in faithful mode the whole faith texture is sun-projected (its cast frame + per-leaf throw depend on
      // sun_elevation/azimuth), so a still-air time-of-day crossfade MUST re-bake or the dapple freezes at the start
      // angle for the whole morph (the layer path is immune — transport reprojects each frame from uProj/uBulkShift).
      const faithSunMorph = faithfulOn() &&
        (trans.from.sun_elevation_deg!==trans.to.sun_elevation_deg || trans.from.sun_azimuth_deg!==trans.to.sun_azimuth_deg);
      if(trans.canopyMorph || motionActive() || faithSunMorph) bake();
    }
    if(t>=1){                                              // land exactly on the target; clear the bloom
      trans.active = false; trans.bloom = 0;
      for(const k in DEFAULTS) params[k] = trans.to[k];
      regenSource(); resetPerf();                          // bloom now 0; re-probe quality for the new look (it may carry auto-quality)
      if(faithfulOn()) bake();                   // land the faith texture on the exact target sun (resetPerf only re-bakes on a bake-res change)
      const cb = trans.onEnd; trans.onEnd = null; if(cb) cb();
    }
  }

  // ---- auto-quality: hold ~60 fps by ratcheting render resolution then samples down; grudging to
  // climb back (each forced drop doubles the wait). Drives perf.*, never the user's art. ----
  function resize(){
    const dpr=Math.min(2, window.devicePixelRatio||1)*perf.resScale;   // auto-quality scales the backing store
    const w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
    if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
  }
  function applyQuality(){
    if(!perf.auto){                                   // off -> restore the user's full quality
      perf.resScale = 1;
      if(perf.sampleCount !== params.sample_count){ perf.sampleCount = params.sample_count; regenSource(); }
      if(bakeRes() !== perf.bres){ rebuildTextures(); bake(); }   // bake back to baseline if a prior auto session trimmed it
      return;
    }
    const q = perf.quality, KNEE = 0.5, RES_MIN = 0.5, SAMP_MIN = 6;
    let res, samp;
    if(faithfulOn()){
      // FAITHFUL: transport is a single tap (resolution ~free), the per-SAMPLE geometry bake dominates and scales
      // linearly in the sample count — so trim SAMPLES across the whole range (relieving the bake immediately as q
      // drops) and let resolution ride along. bakeRes() still trims below the knee. q=1 → full, look unchanged.
      res  = lerp(RES_MIN, 1, q);
      samp = Math.round(lerp(SAMP_MIN, params.sample_count, q));
    // LAYER MODE, and the two NEW cameras land here by construction: faithfulOn() is false for the enclosure
    // (receiver 2 forces the layer tier) and false for the sky view (no cast frame to pre-bake), so neither can
    // reach the faithful branch above. That is the right branch for both, for the branch's own reason — the cost
    // is per PIXEL, so resolution is the cheapest thing to spend first. What differs is what the second lever
    // buys: the enclosure runs the sample loop, so trimming samples below the knee relieves it exactly as it does
    // the floor; the SKY camera declares no sample loop at all (§4.6), so samples are inert there and its
    // below-knee relief comes entirely from bakeRes() shrinking the layer textures it reads. Harmless either way —
    // a lever with no effect costs nothing — and the seen source is derived analytically, not from the sample
    // sums, so trimming them cannot shift the sun the sky camera is looking at.
    } else if(q >= KNEE){ res = lerp(RES_MIN, 1, (q-KNEE)/(1-KNEE)); samp = params.sample_count; }   // resolution first (on the floor and the enclosure the per-pixel transport sample loop IS the cost)
    else                { res = RES_MIN; samp = Math.round(lerp(SAMP_MIN, params.sample_count, q/KNEE)); } // then samples (and bake, below)
    perf.resScale = res;
    samp = clamp(samp, 3, Math.max(3, params.sample_count));
    if(samp !== perf.sampleCount){ perf.sampleCount = samp; regenSource(); }
    if(bakeRes() !== perf.bres){ rebuildTextures(); bake(); }     // bake_resolution trims with quality below the knee (§9); realloc only at a snapped boundary
  }
  function tunePerf(dtms, fps){
    perf.acc += dtms;
    if(perf.acc < 450) return;                        // re-evaluate the smoothed fps about twice a second
    perf.acc = 0;
    if(fps < 58){                                     // not holding 60 -> chase it down (1-tick debounce, so a
      perf.hiCount = 0;                               // lone hitch is ignored but a real shortfall is pursued)
      if(++perf.lowCount >= 2 && perf.quality > 0){
        perf.lowCount = 0;
        perf.quality = clamp(perf.quality - 0.08, 0, 1);
        perf.upWait = Math.min(240, perf.upWait * 2); // having had to drop, get MUCH less eager to climb back
        applyQuality();
      }
      return;
    }
    perf.lowCount = 0;                                // at/above the target
    // Climbing is deliberately grudging: only after a long unbroken run pinned at the cap (genuine
    // headroom), one small step — and that wait doubled every time we were forced down. [58,59.5): hold.
    if(fps > 59.5 && perf.quality < 1){
      if(++perf.hiCount >= perf.upWait){ perf.hiCount = 0; perf.quality = clamp(perf.quality + 0.04, 0, 1); applyQuality(); }
    } else perf.hiCount = 0;
  }

  // ---- render ----
  // ONE whole rendered frame into `fbo` at w×h — the only entry the frame loop (and the profiler's burst) uses, so
  // the diffusion decision is made in exactly one place. Gate OFF (floor, or glow_bleed 0, or the 16F targets
  // came back incomplete): bind the caller's target and draw transport into it — the literal old path, one extra
  // uniform and an untaken shader branch. Gate ON: transport writes LINEAR HDR into the sharp target instead, and
  // drawDiffusion spreads it and composites into the caller's target (§4.9).
  function drawFrameInto(fbo, w, h){
    // the SKY VIEW joins the diffusion gate (§4.9): the very same linear-HDR spread reads there as the eye's own
    // VEILING GLARE — the wash around a bright source seen through gaps, which is scatter in the eye rather than in
    // a weave, but the same operator on the same quantity. A perception-tier reading of a transport pass, the same
    // honesty class as the mesopic shift below.
    const glow = (params.receiver !== 0 || params.sky_view) && params.glow_bleed > 0 && ensureGlowTargets(w, h);
    perf.glow = glow;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glow ? glowFBO[0] : fbo);
    gl.viewport(0,0,w,h);
    drawTransportInto(glow);
    if(glow) drawDiffusion(fbo, w, h);
  }
  function drawTransport(){ drawFrameInto(null, canvas.width, canvas.height); }                 // to screen
  function drawTransportPresent(){ drawFrameInto(presentFBO, presentW, presentH); }             // adaptive frame-rate: to the offscreen frame
  // LATERAL DIFFUSION targets (§4.9). Returns false — silently, one frame at a time — if the driver won't give us a
  // complete RGBA16F target, and the caller then takes the direct path. That should not happen (create() already
  // fails without EXT_color_buffer_float, and every blend target in the engine is 16F), but the fallback costs three
  // lines and the alternative is a black screen on the one device that disagrees.
  function ensureGlowTargets(w, h){
    if(glowFail) return false;
    if(glowTex[0] && glowW===w && glowH===h) return true;
    for(let i=0;i<3;i++){
      if(glowTex[i]) gl.deleteTexture(glowTex[i]);
      if(!glowFBO[i]) glowFBO[i]=gl.createFramebuffer();
      glowTex[i]=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glowTex[i]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);   // LINEAR HDR: 8-bit would quantize the radiance the blur is about to redistribute
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);              // the blur's taps land between texels
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);           // a tap past the frame edge repeats the edge pixel — the glow leans inward there rather than wrapping light in from the far side
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFBO[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glowTex[i], 0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) glowFail = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    glowW=w; glowH=h;
    if(glowFail) freeGlowTargets();          // don't sit on three full-res 16F buffers we've just proven unusable
    return !glowFail;
  }
  function freeGlowTargets(){
    for(let i=0;i<3;i++){ if(glowTex[i]) gl.deleteTexture(glowTex[i]); glowTex[i]=null; }
    glowW=0; glowH=0;
  }
  // The spread itself: H then V over the linear-HDR frame, then the split + the relocated tail into `fbo`.
  // The pixel radius is PHYSICS, not a look-at-this-resolution number: the curtain map lays view_extent_m across the
  // target's HEIGHT and carries the aspect in x, so px/m is one isotropic number and glow_bleed_m stays the same
  // centimetres of cloth whatever the zoom or the backing store does. Spacing = radius/6 (13 taps over ±3σ), capped.
  // All three passes share the viewport drawFrameInto set — the ping/pong are the same size as the sharp frame.
  // (In the SKY VIEW there is no cloth and no view_extent framing, so the metres-of-fabric reading does not apply:
  // the same two knobs there set a plain screen-space glare radius through the same arithmetic, view_extent_m acting
  // as an arbitrary divisor. Named rather than special-cased — a second scale rule would be a second thing to keep
  // in sync for a knob an author sets by eye anyway.)
  function drawDiffusion(fbo, w, h){
    const rPx = params.glow_bleed_m * h / Math.max(params.view_extent_m, 1e-3);
    const step = Math.min(rPx/GLOW_TAPS, GLOW_STEP_MAX);
    gl.useProgram(progGlowBlur);
    gl.bindVertexArray(emptyVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(U.glowBlur.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, glowFBO[1]);                  // H: sharp -> ping
    gl.bindTexture(gl.TEXTURE_2D, glowTex[0]);
    gl.uniform2f(U.glowBlur.step, step/w, 0);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, glowFBO[2]);                  // V: ping -> pong
    gl.bindTexture(gl.TEXTURE_2D, glowTex[1]);
    gl.uniform2f(U.glowBlur.step, 0, step/h);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);                         // the split + the Look's tail, into the real target
    gl.useProgram(progGlowMix);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, glowTex[0]); gl.uniform1i(U.glowMix.sharp, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glowTex[2]); gl.uniform1i(U.glowMix.blur, 1);
    gl.uniform1f(U.glowMix.diffuse, clamp(params.glow_bleed, 0, 1));
    gl.uniform1f(U.glowMix.exposure, params.exposure);
    gl.uniform1f(U.glowMix.contrast, params.contrast);
    gl.uniform1i(U.glowMix.tone, params.tone_map);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  // the transport draw, assuming a framebuffer + viewport are already bound — so the profiler's stress burst
  // (eng.profiler.bench) can aim it at an offscreen target without flipping to screen. drawFrameInto above owns
  // both callers. linearOut: skip the tone-map tail and write linear HDR for the diffusion tier to spread (§4.9).
  // ---- THE UPLOAD HALF OF THE REGISTRY. One function per uniform GROUP, under the same key TRANSPORT_GROUPS
  // declares it by, so the GLSL that declares a uniform and the JS that fills it are named together and a camera
  // that does not speak a group cannot half-speak it. `u` is the variant's location table; `f` is the handful of
  // per-frame values two groups both need (the canopy box, the atmosphere, whether there is wood to write, and the
  // linear-out flag), computed once in drawTransportInto rather than twice here. Every body below is the body the
  // predicate chain ran — this is a regrouping, not a rewrite. ----
  const GROUP_UPLOAD = {
    head: (u, f) => {
      gl.uniform1f(u.aspect, canvas.width/canvas.height);
      gl.uniform2f(u.viewCenter, params.view_center_x, params.view_center_y);   // camera pan (world m) — frames the off-frame tree; no auto-centre (§4.8)
      gl.uniform2f(u.origin, -f.E/2, -f.E/2);
      gl.uniform2f(u.extent, f.E, f.E);
      // physical sun + sky colour from solar elevation (spec §3.5): warm/red low sun, ozone-blue shadows
      gl.uniform3f(u.sun, f.atm.sun[0], f.atm.sun[1], f.atm.sun[2]);
      gl.uniform3f(u.ambient, f.atm.ambient[0], f.atm.ambient[1], f.atm.ambient[2]);
      gl.uniform1fv(u.heights, layerHeights());
      gl.uniform1i(u.layerCount, params.layer_count);
      for(let i=0;i<MAX_LAYERS;i++){ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, layerTex[i]); gl.uniform1i(u.layers[i], i); }
    },
    rayView: (u) => {
      gl.uniform1f(u.pitch, clamp(params.view_pitch_deg,0,80)*DEG);     // camera tilt (rad); 0 = top-down
      gl.uniform1f(u.yaw, params.view_yaw_deg*DEG);                     // camera orbit (rad); 0 = unchanged
      gl.uniform1f(u.fov, clamp(params.view_fov_deg,5,140)*DEG);        // vertical full FOV (rad)
    },
    // woody occluder (§4.5): trunk + main limbs, continuous heights → connected shadow. Gated by branch_tau (the wood
    // knob): 0 = no wood, byte-identical. The bulk sun-offset (standing scene) rides in `g`, so it casts to the side too.
    // In FAITHFUL mode the whole skeleton (incl. twigs) is baked into the leaf shadow instead, so the analytic occluder is off.
    // The table's texture is bound for every camera (all four read it); its rows are only rewritten when there is
    // wood to write, and with uOccCount 0 the shader never fetches from it.
    occ: (u, f) => {
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, occTex); gl.uniform1i(u.occTex, 5);   // unit 5: 0-3 are the layers, 4 the faith texture
      if(!f.wood){ gl.uniform1i(u.occCount, 0); return; }
      // refill segBuf with the live limb SWING (rotate each segment about its tree's trunk by limbAngle) so the wood
      // sways WITH the leaves; the trunk (limb -1) doesn't rotate. Drift (uOccSway) + sun-shift are added in the shader.
      const buf = occ.segBuf, la = hier ? hier.limbAngle : null;
      for(let k=0;k<occ.count;k++){
        const s = occ.rest[k];
        const th = (la && s.limb>=0 && s.limb<la.length) ? la[s.limb] : 0;
        const c=Math.cos(th), sn=Math.sin(th), px=s.px, py=s.py, o=k*4;
        buf[o]   = px + c*(s.ax-px) - sn*(s.ay-py);
        buf[o+1] = py + sn*(s.ax-px) + c*(s.ay-py);
        buf[o+2] = px + c*(s.bx-px) - sn*(s.by-py);
        buf[o+3] = py + sn*(s.bx-px) + c*(s.by-py);
      }
      // perf todo — occTex is single-buffered, the same tradeoff clusterTex carries and for the same reason: these
      // two rows are rewritten and then fetched by the draw below in the SAME frame, so next frame's upload can
      // stall on this one still draining. A 2-deep ring would break the write-after-read.
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, occ.count, 1, gl.RGBA, gl.FLOAT, buf);        // row 0: plan endpoints, carrying this frame's limb swing
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, occ.count, 1, gl.RGBA, gl.FLOAT, occ.ht);     // row 1: heights + radius, static since the last regrow
      gl.uniform1i(u.occCount, occ.count);
      gl.uniform1f(u.occTau, params.branch_tau);
      gl.uniform2f(u.occSway, motion.sway[0], motion.sway[1]);    // wood drifts with the whole-tree sway
      gl.uniform1f(u.occHRef, Math.max(occ.hRef, 1e-3));          // height-scale ref → trunk foot planted, crown sways
    },
    transport: (u) => {
      gl.uniform3fv(u.samples, src.flat.subarray(0, src.count*3));
      gl.uniform1i(u.count, src.count);
      gl.uniformMatrix2fv(u.proj, false, projMatrix());
      // standing-scene bulk shadow offset (§4.8): cast the shadow to the SIDE by cot(elev) per unit height (the
      // park model omits this — fine for an infinite canopy, wrong for a standing tree). Applied to EVERY occluder
      // (trunk, branches, leaves) via g, so the whole tree shadow stays one connected thing and sweeps together as
      // the sun moves — real physics, no camera tricks. Framing the tree off-frame is the camera's job (a fixed
      // pan, view_center), NOT an auto-centre on the crown (that decouples trunk from crown). Gated → 0 = park.
      const b = bulkShift(); gl.uniform2f(u.bulkShift, b[0], b[1]);   // shared helper (matches the faithful bake; 0 when off)
    },
    woodCast: (u, f) => {
      if(!f.wood) return;                                            // the same gate the table upload took: no wood, no penumbra to size
      const el = Math.max(params.sun_elevation_deg,6)*DEG;            // penumbra/height: source angular core projected to ground (~/sin elev), widened by cloud
      gl.uniform1f(u.occPenumbra, (params.core_angular_radius_deg*DEG)/Math.sin(el)*(1.0+3.0*params.cloud_thickness));
    },
    ca: (u) => {
      // edge diffraction (§3.6): per-channel λ-proportional spread of the transport shift. Green (555nm) is the
      // reference; red(620) spreads more, blue(470) less. 0 -> (1,1,1), the byte-identical single-tap path.
      const d = Math.max(0, params.chromatic_aberration), LR = 620/555, LB = 470/555;
      gl.uniform3f(u.chroma, 1+d*(LR-1), 1, Math.max(0, 1+d*(LB-1)));   // floor blue ≥0: diffraction shrinks the spread to zero, never reverses it
    },
    faith: (u) => {
      // FAITHFUL path (§4.5): tap the pre-integrated soft shadow ONCE instead of the sample loop. The faith texture
      // lives in the cast frame (computed in bakeFaithful, this frame). Off → uFaithful 0 → the layer path, byte-identical.
      // faithfulOn(), not the flag: the enclosure forces the layer tier and never bakes one (§4.9).
      gl.uniform1i(u.faithful, faithfulOn() ? 1 : 0);
      if(!faithfulOn()) return;
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, faithTex); gl.uniform1i(u.faithTex, 4);   // unit 4 free in transport (layers use 0-3)
      gl.uniform2f(u.faithOrigin, faith.ox, faith.oy);
      gl.uniform2f(u.faithExtent, faith.ext, faith.ext);
    },
    // UNIT sun direction — the fold flanks' incidence basis (§4.9), the enclosure's per-panel beam, and the seen
    // source. GOTCHA, and the reason this uniform exists at all: the shader already has two sun vectors, and BOTH
    // are wrong for incidence. uProj and uBulkShift are throw rates per unit height — they carry 1/sin(elevation)
    // and diverge as the sun nears the horizon, so they are floored at 4°/6° to stay finite. Incidence on a VERTICAL
    // cloth does the opposite: cos(el)·|sin(az)| PEAKS as the sun lowers head-on toward the window. So this is the
    // raw unit vector, deliberately unclamped in elevation.
    sunDir: (u) => {
      const el = params.sun_elevation_deg*DEG, az = params.sun_azimuth_deg*DEG;
      gl.uniform3f(u.sunDir, Math.cos(el)*Math.cos(az), Math.cos(el)*Math.sin(az), Math.sin(el));
    },
    floor: (u) => {
      gl.uniform1f(u.viewExtent, params.view_extent_m);
      gl.uniform1f(u.farSmear, Math.max(0, params.far_smear));          // far-field dapple smear (§4.7); 0 at pitch 0 regardless
      gl.uniform3f(u.ground, params.ground_r, params.ground_g, params.ground_b);   // dirt-floor albedo (spec §4.7)
    },
    cloth: (u) => {
      gl.uniform1f(u.viewExtent, params.view_extent_m);
      gl.uniform1f(u.clothY, params.cloth_distance_m);
    },
    // THE FABRIC (§4.9), the material both cloth receivers answer with: Tt carries brightness, the dye only hue.
    fabric: (u) => {
      gl.uniform1f(u.tt, params.fabric_tt);
      gl.uniform3f(u.fabricTint, params.fabric_tint_r, params.fabric_tint_g, params.fabric_tint_b);
      gl.uniform1f(u.foldDepth, params.fold_depth);
      gl.uniform1f(u.foldScale, params.fold_scale);
      gl.uniform1f(u.foldCoarsen, params.fold_coarsen);
      // fold WARP (§4.9): the pleats' out-of-plane displacement in metres — GEOMETRY, feeding transport's read, where
      // fold_depth above is authored shading on a flat plane. 0 leaves every cast read at its flat coordinate.
      gl.uniform1f(u.foldWarp, params.fold_warp);
      gl.uniform1f(u.sheen, params.velvet_sheen);
      // forward-scatter wrap (§4.9): the ballistic/scattered SPLIT of the transmit, not an extra term — energy-bounded
      // by construction, and 0 leaves the pleat shading exactly as it was.
      gl.uniform1f(u.scatter, params.fabric_scatter);
    },
    window: (u) => {
      // window mullion grid (§4.9): the near-cloth authored occluder, analytic in cloth space. tau 0 = off (the shader
      // skips it), and only the curtain declares it, so no other camera pays. The penumbra is the woody occluder's
      // idiom MINUS its 1/sin(elevation) ground-obliquity term — the cloth is seen head-on — so it is just depth ×
      // the source's angular width, cloud widening the source exactly as it does for the wood (§3.4).
      gl.uniform4f(u.mullion, params.mullion_pitch_m, params.mullion_bar_m, params.mullion_depth_m, Math.max(0, params.mullion_tau));
      gl.uniform1f(u.mullPenumbra, params.mullion_depth_m * (params.core_angular_radius_deg*DEG) * (1.0+3.0*params.cloud_thickness));
      // the window APERTURE (§4.9): half-extents, so the shader's rect test is one abs()-minus-half. w·h = 0 is the gate
      // (an infinite lit field — every look before this one, byte-identical); the aperture shares the bars' plane and
      // penumbra above because it IS the window's outermost frame member.
      gl.uniform4f(u.window, 0.5*Math.max(0, params.window_w_m), 0.5*Math.max(0, params.window_h_m), params.window_cx_m, params.window_cy_m);
      gl.uniform1f(u.windowWall, clamp(params.window_wall, 0, 1));
    },
    // THE ENCLOSURE's polytope (§4.9). TWO INVARIANTS THE SHADER RELIES ON, both enforced here and nowhere else.
    // (1) THE EYE SITS STRICTLY INSIDE every half-space, which is what makes every exit distance positive and lets
    // the intersection be a bare min() with no sign handling. Five constraints bind it — the crown overhead
    // (z < ridge), each end wall, which the eye approaches as lean·eye grows toward the clearance the wall leaves at
    // the eye's own y (0.7·len ahead, 0.5 + 0.3·len behind), and each HIP, which rakes back faster than its own wall
    // does and therefore overtakes it above the vent apex. The near pair binds first, being the closer cap. The side
    // walls never bind at x = 0, and no hip's x term does either. All five are taken as a min rather than resolved
    // case-by-case: over-tightening the eye costs nothing, letting it out of the tent costs the whole routine.
    // (2) THE ARCH BULGES OUTWARD at the shoulder, and its profile stays a FUNCTION OF HEIGHT. Note what the first
    // half is NOT protecting: an intersection of half-spaces is convex whatever the planes do, so the min-exit is
    // never wrong. What breaks is the SHAPE. Put the shoulder INSIDE the straight base→crown line and the arc bends
    // the wrong way — the lower tangent planes stop containing the crown edge, so they slice it off, and pushed far
    // enough the eye itself ends up outside, which is invariant (1). So the shoulder half-width is floored at that
    // straight line (where all three Bézier control points go collinear, every tangent plane coincides, and the
    // shape degenerates exactly to the v2 single-slope tent) and capped at a sane flare.
    // The SECOND half is new with the arc and it is what keeps the geometry single-valued: the profile's height
    // sweep is monotone iff the Bézier control point sits strictly between the ends in z, i.e. 0 < 2·shoulderH −
    // ridge/2 < ridge, i.e. shoulderH ∈ (0.25, 0.75)·ridge. Outside that the curve doubles back in height — the
    // tangent's z-component changes sign, the smooth normal's height inversion has two answers, and normalize()
    // gets handed a zero vector. [0.30, 0.70] keeps a margin inside it. Everything else is floored off its
    // degenerate value: a tent with no interior has nothing to cast.
    tent: (u) => {
      const ridge = Math.max(params.tent_ridge_h_m, 1e-2);
      const halfW = Math.max(params.tent_half_w_m, 1e-2);
      const crownW = clamp(params.tent_crown_w_m, 0, 0.9*halfW);   // 0.9 keeps a real horizontal run in the profile even when the crown is asked to be the whole roof
      const len   = Math.max(params.tent_len_m, 0.5);
      const lean  = clamp(params.tent_end_lean, 0, 4);
      const shH   = clamp(params.tent_shoulder_h_m, 0.30*ridge, 0.70*ridge);   // the height-monotonicity window (see above); outside it the arc doubles back
      const shLine = halfW + (crownW - halfW)*(shH/ridge);         // the STRAIGHT base→crown profile at that height — the convexity floor
      // (3) THE HIPS MUST RAKE BACK FASTER THAN THE END WALL, or they never bind and the far cap silently stays the
      // slab it was; and they must stay far enough OFF the wall that the seam pass reads three panels rather than
      // three coincident planes it paints dark end to end. 0.15 is that floor (≈ 4 cm of setback at the shipped
      // dimensions, three times the 12 mm seam core). The apex stays strictly between the floor and the crown: at 0
      // the triangle has no height and at the ridge it swallows the whole end.
      const apex  = clamp(params.tent_end_apex_h_m, 0.10*ridge, 0.90*ridge);
      const rake  = clamp(params.tent_hip_rake, 0.15, 3);
      const gap   = Math.min(                                      // the tightest cap clearance at the eye's own y, per metre of eye height
        (0.7*len)/Math.max(lean, 1e-3),                            // far end wall
        (0.7*len + rake*apex)/(lean + rake),                       // far hip — tighter than the wall wherever the eye rides above the apex
        (0.5 + 0.3*len)/Math.max(lean, 1e-3),                      // near end wall
        (0.5 + 0.3*len + rake*apex)/(lean + rake));                // near hip. The near cap is the CLOSER of the two, so it binds first
      gl.uniform1f(u.tentRidge, ridge);
      gl.uniform1f(u.tentHalfW, halfW);
      gl.uniform1f(u.tentCrownW, crownW);
      gl.uniform1f(u.tentShoulderH, shH);
      gl.uniform1f(u.tentShoulderW, clamp(params.tent_shoulder_w_m, shLine, 1.4*halfW));
      gl.uniform1f(u.tentLen, len);
      gl.uniform1f(u.tentEndLean, lean);
      gl.uniform1f(u.tentEndApex, apex);
      gl.uniform1f(u.tentHipRake, rake);
      gl.uniform1f(u.tentEye, Math.min(Math.max(params.tent_eye_h_m, 0), 0.95*ridge, 0.95*gap));
      gl.uniform1f(u.tentFade, Math.max(0, params.tent_fade));
      gl.uniform1f(u.tentSeam, Math.max(0, params.tent_seam));
      gl.uniform1f(u.tentMesh, clamp(params.tent_mesh, 0, 1));
    },
    // THE SKY VIEW's own three: regenSource's numbers, so the sun you look at and the dapples it throws are drawn
    // from one distribution. No other camera declares them — there is no seen source anywhere else.
    sky: (u) => {
      gl.uniform1f(u.skyScatter, clamp(params.sky_scatter, 0, 1));
      gl.uniform2f(u.srcAngR, src.coreR, src.haloR);
      gl.uniform2f(u.srcAngL, src.Lcore, src.Lhalo);
      gl.uniform2f(u.srcMoon, src.moonD, src.moonR);
    },
    post: (u, f) => {
      // distance haze: the sky/ambient HUE at a steady brightness, so the far floor fades into a time-of-day-
      // consistent atmosphere (only visible once tilt blooms the fog; invisible at pitch 0).
      const a = f.atm.ambient, m = Math.max(a[0],a[1],a[2],1e-4), hb = 0.6;
      gl.uniform3f(u.haze, a[0]/m*hb, a[1]/m*hb, a[2]/m*hb);
      // Purkinje (§3.5): rods take over the dim shade as the sun lowers. The global weight rides the same
      // low-sun band that warms the beam; it hard-gates off (and costs nothing) for a daytime sun.
      gl.uniform1f(u.twilight, smoothstep(30, 4, params.sun_elevation_deg));
      gl.uniform1f(u.mesopic, params.mesopic_strength);
      gl.uniform1f(u.exposure, params.exposure);
      gl.uniform1f(u.contrast, params.contrast);
      gl.uniform1i(u.tone, params.tone_map);
      gl.uniform1i(u.linearOut, f.linearOut);   // 0 = end the Look here (every look); 1 = hand linear HDR to the diffusion passes (§4.9)
    },
  };
  // The seam, closed from this side: GROUP_UPLOAD_KEYS is what the coherence test reads, this is what the engine
  // actually dispatches, and a name in one and not the other would otherwise be an upload that silently never runs.
  for(const k of GROUP_UPLOAD_KEYS) if(!GROUP_UPLOAD[k]) fail(`transport group "${k}" is declared to upload and has no uploader`);
  for(const k in GROUP_UPLOAD) if(!GROUP_UPLOAD_KEYS.includes(k)) fail(`transport group "${k}" uploads but is missing from GROUP_UPLOAD_KEYS`);
  function drawTransportInto(linearOut){
    gl.disable(gl.BLEND);
    // THE CAMERA IS THE PROGRAM (§4.6/§4.9), and the registry is what says so once. Which variant runs is a MODE
    // decision resolved here per draw; what it uploads is its entry's group list, walked in order. There is no
    // predicate chain left to keep in agreement with the shader's — the entry IS the agreement.
    const cam = transportCamera(), variant = transportFor(cam), tp = variant.U;
    gl.useProgram(variant.prog);
    const f = {
      E: params.canopy_extent_m,
      atm: atmosphere(_atm, params.sun_elevation_deg, params.sky_turbidity, params.ambient_skylight),
      wood: !faithfulOn() && params.branch_tau > 0 && occ.count > 0,   // read by the table upload and the penumbra alike, so they cannot disagree
      linearOut: linearOut ? 1 : 0,
    };
    for(const name of CAMERAS[cam].groups){
      const up = GROUP_UPLOAD[name];
      if(up) up(tp, f);                                              // functions-only groups (the taps, the fold field, the warp) upload nothing
    }
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function drawLayerBlit(){
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(progBlit);
    const idx=clamp(params.show_layer_index|0,0,params.layer_count-1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, layerTex[idx]);
    gl.uniform1i(U.blit.tex,0);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  // ---- editor-only debug overlays (source + tree-preview insets); EDITOR=false strips this whole block ----
  let drawSourceInset, drawTreeInset, treeInsetHit;
  if(EDITOR){
  drawSourceInset = () => {
    const s=Math.round(Math.min(170, canvas.width*0.22));
    const x=canvas.width-s-8, y=canvas.height-s-8;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x,y,s,s); gl.viewport(x,y,s,s);
    gl.clearColor(0.03,0.04,0.06,1.0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(progPoints);
    gl.uniform1f(U.pts.scale, 0.92/src.maxR);
    gl.uniform1f(U.pts.maxW, src.maxW);
    gl.bindVertexArray(srcDbgVAO);
    gl.drawArrays(gl.POINTS, 0, src.count);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,canvas.width,canvas.height);
  };

  // ---- 3D preview of the ACTUAL grove (todo [3]): the grown skeleton + leaf blobs, in a slowly
  // turning 3/4 view that sways with the wind. Optional editor inset ('T'); the geometry is CPU-
  // projected into a scissored corner, so it costs nothing unless shown. ----
  let treeGrow = 0;   // 0 = parked small in the corner, 1 = grown; eases toward the hover/pinned target
  // inset leaf scatter: one blob per LEAF (count = leaves_per_cluster × foliage_density) so the density
  // slider visibly fills/thins the preview. Base positions are scattered once per regrow (keyed on `hier`
  // identity — every canopy knob makes a new hier) and reprojected each frame; the proj buffer is reused.
  let treeLeafHier=null, treeLeafBase=null, treeLeafProj=null;
  function buildTreeLeaves(){
    // Drive the preview off the grove's TWIGS (one cluster per leaf-bearing node) — NOT terminal segments. With droop,
    // a twig is split into sub-segments all tagged level≥levels, so the old segment-filter over-drew nSub×nLeaf clusters
    // at mid-twig joints and mis-keyed the per-twig seed by segment index. Iterating twigs[] matches the bake's count,
    // per-twig seed (hash3(seed,j,101)), hug heading (t.dx/t.dy) and marginal-leaf fade. (spec §9 — preview ≈ bake)
    const tws = hier.twigs || [];
    const pcF = Math.max(0, params.leaves_per_cluster*params.foliage_density);
    const pcInt = Math.floor(pcF), frac = pcF - pcInt;
    const nLeaf = pcInt + (frac>1e-4 ? 1 : 0);
    const base=[];
    const faithful = faithfulOn();   // hoisted, and it must be the SAME answer regenCanopy packed the bake with
    for(let j=0;j<tws.length;j++){
      const t=tws[j], cx=t.x, cy=t.y, cz=t.z, tcov=(t.tcov===undefined?1:t.tcov);
      const ti=(t.tree===undefined?0:t.tree), tnt=((ti*0.61803398875)%1)*2-1;   // per-tree warmth [-1,1], golden-spread so neighbours differ
      let tdx=t.dx||0, tdy=t.dy||0; const tdl=Math.hypot(tdx,tdy), tHasDir=tdl>1e-4; if(tHasDir){ tdx/=tdl; tdy/=tdl; }   // grown twig heading (the bake's stored t.dx,t.dy), so the hug matches even on a drooped twig
      const gauss=makeGauss(mulberry32(hash3(params.seed>>>0, j, 101)));   // per-twig scatter, j = twig index == the bake's seed (same count & spread, not bit-identical)
      for(let k=0;k<nLeaf;k++){
        const g1=gauss(), g2=gauss();   // leaves hug the twig — must match the bake (§4.5)
        const cov = ((k===pcInt) ? frac : 1.0) * tcov;   // marginal-leaf fade × marginal-tree fade — matches the bake (E#54), so a density morph tracks the cast
        const hug = faithful && tHasDir;
        const x = hug ? cx - Math.abs(g1)*params.cluster_spread_m*1.5*tdx - g2*params.cluster_spread_m*0.4*tdy : cx + g1*params.cluster_spread_m;
        const y = hug ? cy - Math.abs(g1)*params.cluster_spread_m*1.5*tdy + g2*params.cluster_spread_m*0.4*tdx : cy + g2*params.cluster_spread_m;
        base.push(x, y, cz, cov, tnt);
      }
    }
    treeLeafBase=new Float32Array(base);
    treeLeafProj=new Float32Array(base.length/5*6);   // base: x,y,z,cov,tint (5) -> proj: x,y,r,g,b,size (6)
    treeLeafHier=hier;
  }
  function treeInsetGeom(){
    const base = Math.min(300, canvas.width*0.32, canvas.height*0.42);
    const big  = Math.min(canvas.width*0.62, canvas.height*0.72);
    const S = Math.round(base + (big-base)*treeGrow);
    return { S, ix: canvas.width-S-8, iy: 8 };        // anchored bottom-right; grows up-left
  }
  treeInsetHit = (ptr) => {                          // is the normalised pointer over the current inset?
    if(!ptr) return false;
    const {S,ix,iy}=treeInsetGeom();
    const l=ix/canvas.width, r=(ix+S)/canvas.width, tp=1-(iy+S)/canvas.height, bt=1-iy/canvas.height;
    return ptr.x>=l && ptr.x<=r && ptr.y>=tp && ptr.y<=bt;
  };
  // grow while hovered; a CLICK pins it big (pinned) until clicked again. ptr = normalised coords or null.
  drawTreeInset = (ptr, pinned) => {
    if(!hier?.segments?.length) return;
    const segs = hier.segments, levels = Math.max(1, params.branch_levels|0);
    treeGrow = clamp(treeGrow + (((pinned||treeInsetHit(ptr))?1:0)-treeGrow)*0.18, 0, 1);   // smooth ease
    const { S, ix, iy } = treeInsetGeom();
    // grove bounds for the fit scale
    let R=1e-3, maxZ=1e-3;
    for(const s of segs){ R=Math.max(R, Math.hypot(s.a[0],s.a[1]), Math.hypot(s.b[0],s.b[1])); maxZ=Math.max(maxZ, s.a[2], s.b[2]); }
    const fit = 0.72/Math.max(R, maxZ*1.4);
    const tt = performance.now()/1000;
    const yaw = tt*0.25, cyw=Math.cos(yaw), syw=Math.sin(yaw);     // slow turntable so it reads as 3D
    const pitch = 24*DEG, hk=Math.cos(pitch), dk=Math.sin(pitch);
    const wx=motion.windX, wy=motion.windY;   // EFFECTIVE wind dir (weather-veered) — matches the bake & trunk drift
    const lean = motion.u*0.9, sx0=motion.sway[0], sy0=motion.sway[1];   // wind: lean + trunk drift (drift carries the lateral channel)
    // NOTE: motion.u is intentionally applied TWICE here — as the height-weighted `lean` (a cheap proxy for the bake's
    // per-joint limb/twig rotation, which the preview doesn't re-derive) and again inside motion.sway (the trunk drift).
    // So the preview leans a touch harder than the bake translates; that's by design (spec §9 — preview ≈ bake, not =).
    const offY = -0.4;
    const P = (p) => {                                   // 3D world (+wind) -> inset NDC
      const lf = lean*(p[2]/maxZ);                       // taller points lean more downwind
      const ax=p[0]+wx*lf+sx0, ay=p[1]+wy*lf+sy0, az=p[2]*1.4;
      const u=ax*cyw-ay*syw, depth=ax*syw+ay*cyw;
      return [ u*fit, (az*hk - depth*dk)*fit + offY ];
    };
    const L=[]; const pushLine=(p,q,r,g,b)=>{ const A=P(p),B=P(q); L.push(A[0],A[1],r,g,b,0, B[0],B[1],r,g,b,0); };
    // ground grid (z=0)
    const gExt=R*1.05, gN=4;
    for(let i=-gN;i<=gN;i++){ const f=i/gN*gExt;
      pushLine([f,-gExt,0],[f,gExt,0], 0.15,0.17,0.15);
      pushLine([-gExt,f,0],[gExt,f,0], 0.15,0.17,0.15); }
    // wind-direction arrow on the ground (only when the wind is blowing)
    if(params.wind_strength>0){ const aL=gExt*0.85, tx=wx*aL, ty=wy*aL, hb=gExt*0.16;
      const rot=(a)=>[wx*Math.cos(a)-wy*Math.sin(a), wx*Math.sin(a)+wy*Math.cos(a)];
      pushLine([0,0,0],[tx,ty,0], 0.5,0.6,0.78);
      const h1=rot(2.6), h2=rot(-2.6);
      pushLine([tx,ty,0],[tx+h1[0]*hb,ty+h1[1]*hb,0], 0.5,0.6,0.78);
      pushLine([tx,ty,0],[tx+h2[0]*hb,ty+h2[1]*hb,0], 0.5,0.6,0.78); }
    // branches as tapered quads (real width, not 1-px GL lines): trunk thickest -> twig thin. Built into a
    // triangles buffer Q, drawn solid behind the foliage and again faintly OVER it so the skeleton ghosts
    // through (level<=1 brown -> twig tan; cov<1 fades a marginal morphing-in tree toward the sky bg).
    const Q=[]; const pushQuad=(p,q,wpx,r,g,b)=>{
      const A=P(p),B=P(q); let dxn=B[0]-A[0],dyn=B[1]-A[1]; const dl=Math.hypot(dxn,dyn)||1e-6; dxn/=dl; dyn/=dl;
      const hw=wpx/S, nx=-dyn*hw, ny=dxn*hw;                  // perpendicular half-width in NDC (square S×S viewport)
      Q.push(A[0]+nx,A[1]+ny,r,g,b,0, A[0]-nx,A[1]-ny,r,g,b,0, B[0]+nx,B[1]+ny,r,g,b,0,
             A[0]-nx,A[1]-ny,r,g,b,0, B[0]-nx,B[1]-ny,r,g,b,0, B[0]+nx,B[1]+ny,r,g,b,0); };
    // branch width follows the SAME pipe-model taper as the shadow occluder (reflects taper_delta), so the
    // preview shows thick-trunk → thin-twig exactly as the cast silhouette will: width × children^(−1/Δ) per level.
    const pkids=Math.max(1,params.branch_children|0), ptf=Math.pow(Math.max(1.001,pkids), -1/clamp(params.taper_delta,1,4));
    for(const s of segs){ const f=Math.max(0, Math.min(1,(s.level-1)/Math.max(1,levels-1))), cv=(s.cov===undefined?1:s.cov);
      const wpx=Math.max(0.6, 4.4*Math.pow(ptf, s.level));   // trunk (level 0) thick -> twig thin, by Δ
      pushQuad(s.a, s.b, wpx, lerp(0.05,0.30+0.20*f,cv), lerp(0.07,0.22+0.16*f,cv), lerp(0.09,0.12+0.06*f,cv)); }
    // leaf blobs: the scatter on every terminal twig, so the density slider fills/thins the preview.
    if(treeLeafHier!==hier) buildTreeLeaves();
    const lsz=S*0.04, nLf=treeLeafBase.length/5;
    // per-leaf opacity falls as the per-twig count climbs, so a dense canopy reads as a translucent haze the
    // branches show through (option 3) instead of an opaque green wall — density stays legible as coverage.
    const leafAlpha=clamp(1.8/Math.sqrt(Math.max(1,Math.round(params.leaves_per_cluster*params.foliage_density))),0.12,0.6);
    for(let i=0;i<nLf;i++){                                  // inline P() — no per-leaf array alloc (there can be tens of thousands)
      const b5=5*i, bx=treeLeafBase[b5], by=treeLeafBase[b5+1], bz=treeLeafBase[b5+2], cv=treeLeafBase[b5+3], w=treeLeafBase[b5+4];
      const lf=lean*(bz/maxZ), ax=bx+wx*lf+sx0, ay=by+wy*lf+sy0, az=bz*1.4;
      const u=ax*cyw-ay*syw, depth=ax*syw+ay*cyw, f=bz/maxZ, o=6*i, vv=1.0+w*0.10;   // w: per-tree warmth -> hue + value shift
      treeLeafProj[o]=u*fit; treeLeafProj[o+1]=(az*hk-depth*dk)*fit+offY;
      treeLeafProj[o+2]=lerp(0.05,0.18+0.12*f,cv)*(1.0+w*0.28)*vv;   // warm trees redder...
      treeLeafProj[o+3]=lerp(0.07,0.42+0.18*f,cv)*(1.0+w*0.05)*vv;
      treeLeafProj[o+4]=lerp(0.09,0.16+0.10*f,cv)*(1.0-w*0.28)*vv;   // ...and cooler trees bluer
      treeLeafProj[o+5]=lsz;
    }
    // ---- draw: framed sky, ground+arrow lines, branches (solid), leaf haze, branches again (faint, over) ----
    gl.disable(gl.BLEND);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(ix-1,iy-1,S+2,S+2); gl.clearColor(0.16,0.20,0.16,1.0); gl.clear(gl.COLOR_BUFFER_BIT);   // frame
    gl.scissor(ix,iy,S,S); gl.viewport(ix,iy,S,S);
    gl.clearColor(0.05,0.07,0.09,1.0); gl.clear(gl.COLOR_BUFFER_BIT);                                    // sky
    gl.useProgram(progViz);
    gl.bindVertexArray(vizVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, vizBuf);
    gl.uniform1f(U.viz.point, 0.0); gl.uniform1f(U.viz.lineAlpha, 1.0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(L), gl.DYNAMIC_DRAW);     // ground grid + wind arrow
    gl.drawArrays(gl.LINES, 0, L.length/6);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Q), gl.DYNAMIC_DRAW);     // branches, solid (behind the foliage)
    gl.drawArrays(gl.TRIANGLES, 0, Q.length/6);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(U.viz.point, 1.0); gl.uniform1f(U.viz.pointAlpha, leafAlpha);
    gl.bufferData(gl.ARRAY_BUFFER, treeLeafProj, gl.DYNAMIC_DRAW);            // leaf haze
    gl.drawArrays(gl.POINTS, 0, treeLeafProj.length/6);
    gl.uniform1f(U.viz.point, 0.0); gl.uniform1f(U.viz.lineAlpha, 0.4);       // faint skeleton ghosting through the foliage
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Q), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, Q.length/6);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0,0,canvas.width,canvas.height);
  };
  }   // end if(EDITOR) — editor-only inset overlays

  // ---- the rebuild scopes the editor drives, plus a full param swap ----
  function rebuildAll(){ rebuildTextures(); regenCanopy(); bake(); regenSource(); }
  function resetPerf(){ perf.auto=!!params.auto_quality; perf.quality=1; perf.acc=0; perf.lowCount=0; perf.hiCount=0; perf.upWait=20; applyQuality(); }
  function apply(scope){
    if(scope==='source') regenSource();
    else if(scope==='bake') bake();                  // drift moves leaves at bake time only
    else if(scope==='canopy'){ regenCanopy(); bake(); }
    else if(scope==='textures'){ rebuildTextures(); regenCanopy(); bake(); }
    else if(scope==='perf') resetPerf();
  }
  function setParams(obj){
    if(!obj || typeof obj!=='object') return;
    const merged = Object.assign({}, DEFAULTS, migrateLegacy(obj));   // legacy names -> current; missing keys -> defaults (forward-compat)
    for(const k in DEFAULTS) params[k] = merged[k];
    rebuildAll();
    resetPerf();                                       // a preset may carry auto-quality
  }

  // ---- profiling primitive (EDITOR only, spec §9). The engine owns measurement because it owns the GL passes;
  // the editor's profiler.js + UI orchestrate. `timed` defaults to a passthrough (so frame() is unaffected in
  // the player build, where this whole block dead-strips); the editor swaps in real GPU timer queries. ----
  let timed = (_pass, draw) => draw();
  let motionTick = tick;   // default: this engine runs its own physics. EDITOR can swap it to mirror another instance.
  let profiler = null;
  if(EDITOR){
    // timer queries: a 2-deep ring per pass, so frame N reads frame N-1's result (it isn't ready same-frame).
    // Disjoint frames are discarded; off or unsupported -> just draw (byte-identical to the un-instrumented path).
    let instrumenting = false;
    const TIME_ELAPSED = 0x88BF, GPU_DISJOINT = 0x8FBB;   // EXT_disjoint_timer_query_webgl2 enums
    const tq = { bake:{q:[null,null], i:0}, transport:{q:[null,null], i:0} };
    timed = (pass, draw) => {
      if(!instrumenting || !extTimer){ draw(); return; }
      const r = tq[pass], cur = r.q[r.i&1];               // this slot's query, issued 2 frames ago (ready now)
      if(cur){
        if(gl.getQueryParameter(cur, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(GPU_DISJOINT))
          profiler[pass==='bake'?'bakeMs':'transportMs'] = gl.getQueryParameter(cur, gl.QUERY_RESULT)/1e6;
        gl.deleteQuery(cur);
      }
      const q = gl.createQuery();
      gl.beginQuery(TIME_ELAPSED, q); draw(); gl.endQuery(TIME_ELAPSED);
      r.q[r.i&1] = q; r.i++;                               // self-advance: each pass flips its own ring per frame
    };
    // offscreen stress burst: render a pass n times into an off-screen RGBA8 target at the live backing size,
    // then readPixels one texel to fence — so wall-clock spans real GPU work uncapped by vsync (one synchronous
    // burst, not one-per-rAF). headroom = a 60fps frame budget / per-render ms. Works even where timer queries don't.
    function ensureBenchTarget(){
      // measure transport at MAX resolution (resScale=1), NOT the live auto-quality-trimmed backing — the
      // profiler exists to show the cost of each stylistic decision at full quality (spec §9), and on a weak
      // device the live canvas may already be downscaled, which would understate the true cost.
      const dpr=Math.min(2, window.devicePixelRatio||1);
      const w=Math.max(1,Math.round(canvas.clientWidth*dpr)), h=Math.max(1,Math.round(canvas.clientHeight*dpr));
      if(benchFBO && benchW===w && benchH===h) return;
      if(benchTex) gl.deleteTexture(benchTex);
      if(!benchFBO) benchFBO=gl.createFramebuffer();
      benchTex=gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, benchTex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, benchFBO);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, benchTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      benchW=w; benchH=h;
    }
    function bench(pass, n){
      n = Math.max(1, n|0);
      // fence the burst with gl.finish() (drains ALL queued GL work). The old readPixels fence was a RGBA/UNSIGNED_BYTE
      // read of an RGBA16F target (layerTex[0]) — an invalid combo that errors instead of flushing, and in faithful
      // mode bake() writes faithTex (layerTex[0] is a 1×1 dummy), so the fence read the wrong/unwritten texture. (E#35)
      if(pass==='transport'){
        ensureBenchTarget();
        const t0=performance.now();
        for(let i=0;i<n;i++) drawFrameInto(benchFBO, benchW, benchH);   // the whole frame, diffusion included — the tier's cost is the thing the axis measures
        gl.finish();
        const ms=(performance.now()-t0)/n;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { ms, headroom: 16.67/Math.max(ms,1e-3) };
      }
      if(pass==='bake'){
        const t0=performance.now();
        for(let i=0;i<n;i++) bake();                            // bake targets its own layer/faith FBOs
        gl.finish();                                            // fence: drains the bake passes (layer or faithful)
        const ms=(performance.now()-t0)/n;
        return { ms, headroom: 16.67/Math.max(ms,1e-3) };
      }
      return { ms:0, headroom:Infinity };
    }
    profiler = { hasTimer: !!extTimer, bakeMs:0, transportMs:0, setInstrument(on){ instrumenting=!!on; }, bench };
  }

  // ---- motion mirror (EDITOR only): drive this engine's wind EXACTLY from another instance instead of its own
  // physics, so the A/B picker's two engines animate in lockstep. Safe because the profiler's variants never
  // change the grove skeleton (tree/limb/branch/seed), so the spring arrays line up 1:1. Holds for faithful_canopy
  // too: flipping it keeps the same grown grove and spring arrays — only the cast path (layer vs per-sample bake)
  // changes — so the mirror stays sound for that axis as well. snapshotMotion exposes
  // live refs (read-only); applyMotion copies them in + re-uploads the bend texture; setMotionSource swaps the
  // per-frame tick for a copy-from-source. The bake only reads angles + sway + time, so velocities aren't needed. ----
  let snapshotMotion, applyMotion, setMotionSource;
  if(EDITOR){
    snapshotMotion = () => ({ m:motion, dphase:params.drift_phase, lA:hier?.limbAngle, lP:hier?.limbPitch, tA:hier?.twigAngle });
    applyMotion = (s) => {
      if(!s) return;
      const sm=s.m;
      motion.time=sm.time; motion.u=sm.u; motion.v=sm.v; motion.uLat=sm.uLat; motion.vLat=sm.vLat;
      motion.env=sm.env; motion.driveEnv=sm.driveEnv; motion.windX=sm.windX; motion.windY=sm.windY; motion.weatherS=sm.weatherS;
      motion.sway[0]=sm.sway[0]; motion.sway[1]=sm.sway[1];
      params.drift_phase = s.dphase;                       // incoherent band rides a param the source advances
      if(hier && s.lA && hier.limbAngle.length===s.lA.length){
        hier.limbAngle.set(s.lA); hier.limbPitch.set(s.lP); hier.twigAngle.set(s.tA);   // BOTH limb DOFs, or the wipe's two engines foreshorten differently
        publishBend();                                     // push the mirrored bend into the texture the bake reads
      }
    };
    setMotionSource = (src) => { motionTick = src ? () => applyMotion(src.snapshotMotion()) : tick; };
  }

  // ---- init + frame loop ----
  rebuildAll();
  resetPerf();
  let last=performance.now(), fps=60, paused=false, alive=true;
  const eng = { canvas, gl, params, perf, motion, src, trans, occ, fps:60, apply, setParams, transitionTo, onFrame:opts.onFrame||null,
    // pause the rAF loop so a second engine instance idles at zero GPU when off-screen (the editor's A/B picker)
    setPaused(on){ on=!!on; if(on===paused) return; paused=on; if(!on){ last=performance.now(); requestAnimationFrame(frame); } },
    // dispose: stop the loop and free EVERY GL object + the context, so a disposable second instance (the A/B
    // picker, created per-comparison) leaves zero GPU residue when closed. A disposed engine must not be reused.
    dispose(){
      alive = false;
      [progBake, progFaith, progFaithSeg, progFAcc, progBlit, progPresent, progGlowBlur, progGlowMix, progPoints, progViz].forEach(p => { if(p) gl.deleteProgram(p); });
      transportCache.forEach(v => { gl.deleteProgram(v.prog); });   // however many cameras this engine actually visited
      transportCache.clear();
      layerTex.forEach(t => { gl.deleteTexture(t); });
      [clusterTex, clusterGeomTex, occTex, faithTex, faithScratch, benchTex, presentTex].forEach(t => { if(t) gl.deleteTexture(t); });
      freeGlowTargets();                             // the diffusion tier's three 16F frames (no-op when the gate never opened)
      [bakeFBO, faithFBO, benchFBO, presentFBO, ...glowFBO].forEach(f => { if(f) gl.deleteFramebuffer(f); });
      layerVAO.forEach(L => { gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.buf); });
      if(faith.vao){ gl.deleteVertexArray(faith.vao); gl.deleteBuffer(faith.buf); }
      if(faith.segVAO){ gl.deleteVertexArray(faith.segVAO); gl.deleteBuffer(faith.segBuf); }
      if(sky.segVAO){ gl.deleteVertexArray(sky.segVAO); gl.deleteBuffer(sky.segBuf); }
      [emptyVAO, srcDbgVAO, vizVAO].forEach(v => { if(v) gl.deleteVertexArray(v); });
      [quadBuf, srcDbgBuf, vizBuf].forEach(b => { if(b) gl.deleteBuffer(b); });
      if(EDITOR) setMotionSource(null);              // drop any mirror-source ref so a disposed follower can't pin its source
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    ...(EDITOR ? { drawSourceInset, drawTreeInset, treeInsetHit, profiler, snapshotMotion, applyMotion, setMotionSource,
                   isLowMotion: () => motionMagnitude() < ADAPT_LO } : {}) };   // editor-only handles, stripped from the player build
  // ---- adaptive frame-rate helpers (TUNE §9) ----
  function ensureFrameTarget(){                       // lazy canvas-sized RGBA8 present target; reallocated on resize
    const w=canvas.width, h=canvas.height;
    if(presentFBO && presentW===w && presentH===h) return;
    if(presentTex) gl.deleteTexture(presentTex);
    if(!presentFBO) presentFBO=gl.createFramebuffer();
    presentTex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, presentTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);   // 1:1 same-size copy -> NEAREST is exact, no softening
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, presentFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, presentTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    presentW=w; presentH=h;
  }
  function presentFrame(){                            // blit the last rendered frame to screen (cheap; runs every rAF under adaptive)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(progPresent);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, presentTex); gl.uniform1i(U.present.tex, 0);
    gl.bindVertexArray(emptyVAO);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  // motion magnitude: how fast the rendered image is changing. Driven by the wind springs (a steady lean still
  // flutters the leaves every frame, so |u| counts) — NOT by slow auto-drift, which is meant to run at idle_fps.
  // Hysteresis between LO/HI so it doesn't flap at the boundary. Returns true if this frame is due to render heavy.
  function motionMagnitude(){   // also read by the editor's profiler to estimate adaptive's skip fraction
    return Math.max(Math.abs(motion.u), Math.abs(motion.uLat),
                    Math.abs(motion.v)*0.5, Math.abs(motion.vLat)*0.5,
                    hier ? hier.maxV*0.5 : 0);
  }
  function adaptiveDue(now){
    const m = motionMagnitude();
    if(adaptiveHot){ if(m < ADAPT_LO) adaptiveHot=false; }
    else if(m > ADAPT_HI) adaptiveHot=true;
    if(adaptiveHot) return true;                                       // moving -> every frame (no judder on real wind)
    return (now - adaptiveLastRender) >= 1000/Math.max(1, params.adaptive_idle_fps);   // low -> idle cadence
  }
  function frame(now){
    if(!alive || paused) return;                     // dispose() halts permanently; setPaused(true) halts until resumed
    const dtms=now-last; last=now; fps += ((1000/Math.max(dtms,1))-fps)*0.1; eng.fps=fps;
    if(perf.auto) tunePerf(dtms, fps);               // auto-quality: nudge resolution/samples toward 60 fps
    resize();
    // adaptive frame-rate (opt-in): only off-transition, non-debug. While motion is low, render the heavy passes
    // at adaptive_idle_fps into presentTex and re-present it the rest of the time; off -> the unchanged path below.
    if(params.adaptive_motion && !trans.active && !params.show_layer){
      if(!adaptiveDue(now)){                          // skip: re-present the last rendered frame (byte-identical), no bake/transport
        presentFrame();
        if(eng.onFrame) eng.onFrame(dtms);
        requestAnimationFrame(frame);
        return;
      }
      const dt = clamp((now - adaptiveLastRender)/1000, 0, 1/15);   // elapsed since last HEAVY render (skipped frames fold in)
      adaptiveLastRender = now;
      if(motionActive()){ motionTick(dt); timed('bake', bake); }
      ensureFrameTarget();
      timed('transport', drawTransportPresent);       // heavy transport (+ the diffusion passes, if the gate is open) -> offscreen
      presentFrame();                                 // offscreen -> screen
      if(eng.onFrame) eng.onFrame(dtms);
      requestAnimationFrame(frame);
      return;
    }
    const dt = dtms/1000;
    if(trans.active){                                // a running transition owns the re-source/re-bake each frame
      if(motionActive()) tick(dt);                   // keep wind alive; the morph re-asserts drift_phase right after
      tickTransition(dt);
    } else if(motionActive()){ motionTick(dt); timed('bake', bake); }   // advance (or mirror a source) + re-bake only when moving
    if(params.show_layer && !faithfulOn()) drawLayerBlit(); else timed('transport', drawTransport);   // show_layer is a no-op in faithful mode (the layer textures aren't baked)
    if(eng.onFrame) eng.onFrame(dtms);               // editor draws HUD + source inset here
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return eng;
}

// The export surface, and why each group is on it. `create` + `DEFAULTS` are the engine; LEGACY_KEYS/migrateLegacy
// are the params contract (§9); the MAX_* caps and DEG are shared constants consumers size buffers against.
// MORPH/CANOPY/TOPO/MODE_KEYS and CAMERAS/TRANSPORT_GROUPS/GROUP_UPLOAD_KEYS are exported for the SAME reason and
// only that reason: they are couplings that would otherwise fail silently, so a `bun test` reads them and fails
// loudly instead (transitions.test.js classifies every knob, registry.test.js keeps the camera registry's three
// halves in agreement). TRANSPORT_CAMERAS/buildTransport are glslcheck's door onto the assembled variants.
export { create, DEFAULTS, LEGACY_KEYS, migrateLegacy, MAX_LAYERS, MAX_SAMPLES, MAX_OCC, DEG, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS, TRANSPORT_CAMERAS, TRANSPORT_GROUPS, CAMERAS, GROUP_UPLOAD_KEYS, buildTransport };
