// ============================================================================
// The params contract — everything a caller can hand the engine. The engine
// caps consumers size buffers against, the transition classification of every
// knob (spec §9 "Scene transitions"), DEFAULTS (the editor edits a live copy;
// presets merge over it), and the legacy-name migration (spec §9).
// ============================================================================
const MAX_SAMPLES = 48;
const BAKE_MIN = 768;   // floor auto_quality trims bake_resolution to below the knee (§9)
const MAX_LAYERS = 4;
// Woody occluder segments (trunk + main limbs incl. droop sub-segments); continuous-height analytic shadow,
// evaluated once per pixel (spec §4.5). The table is a TEXTURE now, not a uniform array, so this number costs
// texels rather than fragment uniform rows (§6) — it is no longer a budget constraint, it is an authored ceiling.
// IT STAYS AT 64 UNTIL SOMEONE CHOOSES OTHERWISE, and the reason is a measurement, not caution: 'the void' grows
// 192 level-≤1 segments and has been silently truncated to 64 for its whole life. Raising the cap does not free
// that look, it REPAINTS it — three times the wood it currently shows. That is a look decision, not a refactor's.
const MAX_OCC = 256;
// SKY VIEW (§4.9): the authored radiance scale for the SEEN source. The physical contrast between a sun disk and a
// blue sky is ~10^6, which neither an ACES tail nor a 13-tap glare kernel can carry — so what ships is a compressed
// stand-in, and this is the compression, stated once. It multiplies the sampler's own angular density (weight over
// solid angle), so the CORE:HALO ratio stays exactly the sampler's post-cloud energy split; only the absolute moves.
// 6e-3 puts the default 0.27° clear-sky disk a few stops over the ACES shoulder at exposure ~1 — unmistakably the
// sun, and bright enough to drive the veiling glare, without whiting out the frame when that pass spreads it.
const SKY_SUN_GAIN = 6.0e-3;

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
// ---- MODE-FLIP shaping (spec §9). A mode flip is the biggest jump this engine makes — the camera itself changes,
// so no amount of grove-dissolve hides it — and it was measurably the roughest: against a tier-1 morph's 4.9 largest
// frame-to-frame luminance step, floor→enclosure measured 56.9, floor→sky 15.6 (test-gl's --transition mode).
// TWO THINGS WERE WRONG, and neither was the swap's alignment — that already lands on the bloom's peak frame.
//  • THE BLOOM WAS SATURATING. At full depth the overcast floods a floor look past white — luma 192 of 255 with
//    patches clipped — and the swap then cut from that to a mid-green tent interior. The FLASH was the defect and
//    the cliff was what it fell off. A bloom deep enough to destroy the dapple structure is reached well before
//    saturation, so a mode flip's bloom is capped short of it: same dissolve, no white-out, and the two sides of
//    the swap are compared at a depth where they are not an over-exposed floor against a shaded interior.
//    (MEASURED DEAD END, kept because it is the obvious idea: landing the LOOK tween on the destination by the
//    bloom peak instead of on the clock — the thought being that the swap should not happen mid-exposure — made
//    floor→enclosure WORSE, 56.9 to 97.2. Exposure is not what dominates under overcast: tent 1's ambient_skylight
//    is 2.2 against afternoon 7's 0.97, so arriving early at the destination's Look made the pre-swap frame
//    brighter, not darker. The bloom's own depth is the term that matters.)
//  • Everything then happens under a hump only half the transition wide, so a mode flip is given more frames.
// THE SAME LESSON, ONE TIER DOWN. The cap above was scoped to mode flips because that is where it was measured;
// a plain TOPOLOGY dissolve still bloomed to full depth, and on a bright look that is worse, not better. Measured:
// memories→morning 1 (tier 3 by a single key — branch_children 6→3) peaks at luma 249.9 of 255 and holds there for
// eight frames. The picture does not dissolve, it DISAPPEARS, and the new grove fades back in from white.
// The swap itself is already invisible on that route (ΔL 0.29 at the peak), which is what makes the depth safe to
// spend: the bloom was buying cover it no longer needed and paying for it in white. So a dissolve is capped too —
// less hard than a mode flip's, because a topology dissolve has real structure to hide and wants the cover.
// TIER 2.5, THE GROVE CROSSFADE (§9). A topology change could only ever be a CUT: one grove is replaced by
// another at the midpoint, and no amount of bloom makes a cut a dissolve — measured, the swap frame's churn
// against the frame's own contrast is 0.800 where a live morph's whole transition peaks at 0.223. The fix is not
// more cover, it is to stop cutting: grow the incoming grove early and bake BOTH into the same layer textures at
// complementary coverage across a window. Leaves never jump; gaps merge, split and collapse into the new
// arrangement, which is §5.2's own grammar covering the change.
const CROSS_HALF_W = 0.25;   // the window's half-width in t: [0.25, 0.75], centred where the cut used to be
const BLOOM_MAX = { mode: 0.35, dissolve: 0.55, cross: 0.20 };   // the bloom's peak depth by tier — the mode flip's measured in the packet before this one
const DUR_SCALE = { mode: 2.0,  dissolve: 2.0, cross: 2.0 };    // ...and how much longer than the caller's duration each tier takes to get there

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

export { MAX_SAMPLES, BAKE_MIN, MAX_LAYERS, MAX_OCC, SKY_SUN_GAIN, MORPH_KEYS, MORPH_SET, ANGLE_SET, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS, CANOPY_MORPH_MAX, CROSS_HALF_W, BLOOM_MAX, DUR_SCALE, DEFAULTS, LEGACY_KEYS, migrateLegacy };
