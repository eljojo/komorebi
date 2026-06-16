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
const MAX_OCC = 64;   // woody occluder segments (trunk + main limbs incl. droop sub-segments); continuous-height analytic shadow, evaluated once per pixel (spec §4.5)
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
  'canopy_base_height_m','canopy_thickness_m','branch_tau',             // layer heights + branch-shadow darkness — read live, no rebuild
  // NOTE: canopy_base/thickness + trunk_radius_m tween live for the LEAF layers (layerHeights() is live), but the
  // analytic woody occluder's per-segment heights/radius (occ.ht) are baked in regenCanopy and only refresh on a
  // canopy regrow — so in a tier-1-only transition the wood lags the leaves until the next regen. (Off every shipped
  // look: branch_tau>0 only in park 1, which is faithful → analytic occluder gated off. Live occ.ht recompute = TODO.)
  'sun_elevation_deg','sun_azimuth_deg','view_extent_m','view_pitch_deg','view_fov_deg','view_yaw_deg','view_center_x','view_center_y','far_smear','trunk_radius_m','exposure','contrast',
  'ambient_skylight','sky_turbidity','mesopic_strength','chromatic_aberration',
  'ground_r','ground_g','ground_b',                                     // ground albedo (floor reflectance) — live look uniform, tweens in transitions
  'curtain_tt','curtain_tint_r','curtain_tint_g','curtain_tint_b',      // curtain receiver (handoff): brightness Tt + moss dye hue — continuous, tween live (the `receiver` gate itself snaps; see KNOWN_EXCLUDED)
  'curtain_distance_m','fold_depth','fold_scale','fold_coarsen','velvet_sheen',   // curtain plane position + drape/velvet — continuous live look uniforms (only read in curtain mode)
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
// (faithful_canopy reallocates faithTex + switches the bake path; standing_scene reshapes the bake's crown sizing),
// so a transition landing on a differing flag must force a structural rebuild under the bloom — see transitionTo's
// modeDiff. Kept out of TOPO_KEYS (they don't change the grove RNG/topology) but treated like one for the rebuild. ----
const MODE_KEYS = ['standing_scene','faithful_canopy'];
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
  standing_scene: false,           // opt-in: render the trunk as a real vertical occluder (its swept shadow streak)
  trunk_radius_m: 0.1,             // trunk thickness (m) → width of its shadow streak; the area light softens it along its length
  faithful_canopy: false,          // FAITHFUL TREE (spec §4.5): opt out of the depth-layer leaf cheat. Off = leaves binned to a
                                   // few flat slabs (the park fast path, byte-identical). On = each leaf casts from its OWN continuous
                                   // grown height (a per-sample geometry bake), so the cast shadow IS the preview tree — leaves sit on
                                   // their twigs, aligned with the woody occluder. Costs more; for the standing / curtain looks, not the park.
  // Receiver (curtain handoff / spec §4.x): the surface the LANDED IRRADIANCE answers. 0 = opaque diffuse FLOOR
  // (the park default — reflect off uGround; byte-identical). 1 = translucent woven CURTAIN — TRANSMIT the
  // irradiance through moss-velvet: Tt carries brightness, the dye only hue, so a dark velvet reads dim (not a
  // bright tinted gel). Only read when receiver≠0; the floor stays the cheap fast path. Off → every look unchanged.
  receiver: 0,
  curtain_tt: 0.5,                 // curtain total throughput Tt∈[0,1] = BRIGHTNESS (sheer→~0.6, dark terciopelo→~0.1); hue is separate
  curtain_tint_r: 0.35, curtain_tint_g: 1.0, curtain_tint_b: 0.30,   // moss dye HUE (unit-peak; passes green ~550nm, absorbs red/blue — the chlorophyll-twin)
  curtain_distance_m: 0.0,         // curtain plane world-Y (its distance behind the tree); with the sun angle, sets where the tree's shadow lands on the cloth (§4.9)
  fold_depth: 0.0,                 // curtain drape: pleat darkness/depth (0 = flat cloth, up = deep velvet pleats)
  fold_scale: 2.5,                 // curtain drape: pleat frequency (how many pleats across the cloth)
  fold_coarsen: 0.25,              // curtain drape: how much the pleats widen toward the hem (heavy fabric, λ∝√depth)
  velvet_sheen: 0.0,               // velvet grazing sheen on the fold ridges (0 = off; the cut-pile glow that reads as terciopelo)
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
  sway_pitch: 0.0,                 // 3-D lean (spec §5/§4.5): a wind-bent limb also pitches DOWN in depth, lowering its leaves+wood so they cast a SHORTER shadow (foreshorten). FAITHFUL-mode only (needs real heights); 0 = off, byte-identical (no height change). First cut — the motion's depth dimension, the spec's named next step past 2-D yaw.
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
uniform float uCurtainY;              // curtain plane world-Y (cy) when uCurtainBake
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
  vec4 bend = texelFetch(uClusterTex,  ivec2(cid,0), 0);   // .x limb bend, .z stem seed (unused here), .w 3-D pitch foreshorten factor (sway_pitch; 1 = off)
  vec2 BL = geom.zw; float thL = bend.x;   // C (geom.xy, the twig tip) unused now that twig-swing is dropped
  float hEff = iHeight * bend.w;            // 3-D lean (§5): a wind-pitched limb lowers its leaves' height → shorter cast + less drift. bend.w=1 when sway_pitch off → hEff=iHeight, byte-identical.
  // FAITHFUL twig-swing is DROPPED (thT≡0): the baked wood twigs (bakeFaithful) rotate only about the limb, and
  // the leaf model pivots about a synthetic stem joint Jtwig ≠ the wood twig's real base, so a per-twig bend would
  // slide the leaves off their (visible, opaque) wood. With thT=0 leaves & wood both move by limb-swing + the
  // per-leaf flutter below, so leaves stay glued to their twigs (spec §4.5). The layer/park path (VS_BAKE) keeps
  // the twig swing — there's no wood there to detach from. (Restoring faithful twig liveliness needs the leaf pivot
  // unified with the wood twig's real base — future work; see spec §4.5.)
  float cl=cos(thL), sl=sin(thL);
  vec2 base = BL + mat2(cl,-sl,sl,cl)*(leafRest - BL);   // limb swings the clump about the trunk; twig swing dropped (thT=0)
  float ang = angle + thL + 0.2*swing;
  float c=cos(ang), s=sin(ang);
  mat2 R=mat2(c,-s,s,c);
  vec2 world = base + uSway*(hEff/uHRef) + drift + R*(aCorner*vec2(A,B));   // coherent sway grows with height (0 at the ground) — leaves stay on their twigs, base anchored
  // project this leaf onto the RECEIVER along the sun-sample direction (uG.x, uG.y, 1). FLOOR (z=0): world - uG·h
  // (h→0; transport's layer loop adds +h·g to look UP — antipodal, so leaves land where the wood casts). CURTAIN
  // (vertical plane Y=uCurtainY, §4.9): drop onto the cloth → u = px - r·gx, v = h - r with r=(py-cy)/gy, so a
  // vertical trunk (constant py) casts a vertical line and the whole tree STANDS UP the cloth. Floor byte-identical.
  vec2 recvPt;
  if(uCurtainBake != 0){
    float gy = abs(uG.y) < 1e-3 ? (uG.y < 0.0 ? -1e-3 : 1e-3) : uG.y;   // guard: the sun must FACE the cloth (azimuth not ∥ to it)
    float rr = (world.y - uCurtainY) / gy;
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
uniform float uCurtainY;              // curtain plane world-Y (cy) when uCurtainBake
out float vAcross;
void main(){
  float t = aCorner.x*0.5 + 0.5;                 // 0 at a, 1 at b
  // project BOTH endpoints to the receiver at their OWN heights FIRST, then build the capsule around that SHADOW spine.
  // The width is ⊥ the streak, so a vertical trunk (no plan extent) still casts a round streak at every azimuth.
  // FLOOR: endpoint - uG·h. CURTAIN (§4.9): onto the vertical cloth → (px - r·gx, h - r), r=(py-cy)/gy.
  vec2 Ap, Bp;
  if(uCurtainBake != 0){
    float gy = abs(uG.y) < 1e-3 ? (uG.y < 0.0 ? -1e-3 : 1e-3) : uG.y;
    float rA = (iSeg.y - uCurtainY)/gy;  Ap = vec2(iSeg.x - rA*uG.x, iSegH.x - rA);
    float rB = (iSeg.w - uCurtainY)/gy;  Bp = vec2(iSeg.z - rB*uG.x, iSegH.y - rB);
  } else {
    Ap = iSeg.xy - uG*iSegH.x;
    Bp = iSeg.zw - uG*iSegH.y;
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
out vec4 frag;
void main(){
  float cov = 1.0 - smoothstep(0.9, 1.0, abs(vAcross));    // tight anti-alias rim — keep THIN twigs opaque (the soft penumbra comes from the per-sample integration, not this edge)
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

const FS_TRANSPORT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
#define MAX_SAMPLES ${MAX_SAMPLES}
uniform vec3  uSamples[MAX_SAMPLES];   // xy = angular offset (rad), z = weight (sum=1)
uniform int   uSampleCount;
// WOODY OCCLUDER (spec §4.5): the trunk + main limbs as CONTINUOUS-height analytic segments. Each carries its two
// endpoints' plan positions and their HEIGHTS above the floor; the per-sample shadow runs from a's projection to b's,
// so a limb's base meets the trunk at a shared height and the whole skeleton shadow stays CONNECTED — unlike the
// layer-stamped branches (now retired), whose discrete-height quantization shattered continuous lines at a low sun.
uniform vec4  uOccSeg[${MAX_OCC}];   // plan endpoints: a.xy, b.xy
uniform vec4  uOccHt[${MAX_OCC}];    // a-height, b-height (above floor), radius, _
uniform int   uOccCount;             // 0 = off (no wood / park model), byte-identical
uniform float uOccTau;               // wood optical depth (= branch_tau); 0 = off
uniform vec2  uOccSway;              // whole-tree drift, matching the leaf bake
uniform float uOccHRef;              // reference height: the drift scales by H/uOccHRef so the trunk FOOT (H=0) stays planted and the crown sways — matches the faithful wood, not a bodily slide
uniform float uOccPenumbra;          // soft-edge growth per unit height (fakes the area-light penumbra for the once-per-pixel eval)
uniform highp sampler2D uLayer[${MAX_LAYERS}];   // highp: optical depth exceeds lowp's ~[-2,2]
uniform float uLayerHeight[${MAX_LAYERS}];
uniform int   uLayerCount;
// FAITHFUL path (spec §4.5): the opt-out from the depth-layer leaf cheat. uFaithTex is the per-sample bake's
// pre-integrated soft shadow (transmittance), in the CAST frame (covers where the shadow lands, offset by the bulk
// throw). uFaithful 0 = the layer loop below runs, byte-identical (park / overhead default).
uniform highp sampler2D uFaithTex;
uniform int   uFaithful;
uniform vec2  uFaithOrigin;
uniform vec2  uFaithExtent;
uniform mat2  uProj;                    // angular->ground per unit height (ellipse + shear)
uniform vec2  uBulkShift;               // STANDING SCENE (§4.8): bulk lateral shadow offset per unit height = cot(elev)·(anti-sun dir).
                                        // The park model omits this (shadows sit directly under the canopy, only stretched) — invisible for
                                        // an infinite canopy, but a discrete tree needs its shadow CAST to the side. 0 = park model, unchanged.
uniform float uViewExtent;
uniform float uAspect;
uniform float uPitch;            // camera tilt from straight-down (rad); 0 = top-down (reduces to the old ortho map)
uniform float uFov;              // vertical full FOV (rad) — perspective strength / lens
uniform float uViewYaw;          // camera orbit about vertical (rad); rotates the sampled floor about frame centre. 0 = unchanged
uniform vec2  uViewCenter;        // camera PAN: world point the screen centre looks at (0 = frame centre). Lets you walk the view around the floor.
uniform float uFarSmear;         // far-field dapple smear (m of extra throw per unit foreshortening, §4.7)
uniform vec3  uHazeColor;        // linear-HDR distance haze the far floor dissolves into (§4.7)
uniform vec2  uCanopyOrigin;
uniform vec2  uCanopyExtent;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform vec3  uGround;            // ground albedo (floor reflectance); (1,1,1) = white floor (old look)
uniform int   uReceiver;          // 0 = opaque floor (byte-identical), 1 = translucent moss-velvet curtain (curtain handoff / spec §4.x)
uniform float uTt;                // curtain total throughput Tt∈[0,1] — carries BRIGHTNESS (hue is uCurtainTint)
uniform vec3  uCurtainTint;       // moss dye — HUE only; normalized to unit peak in-shader so it can't smuggle brightness past Tt
uniform float uCurtainY;          // curtain receiver: the cloth plane's world-Y (its distance behind the tree) — where on the occluder field the shadow lands
uniform float uFoldDepth;         // curtain drape: pleat darkness/depth (0 = flat cloth, no folds)
uniform float uFoldScale;         // curtain drape: pleat frequency (pleats per metre near the top)
uniform float uFoldCoarsen;       // curtain drape: how much the pleats widen toward the hem (heavy fabric)
uniform float uSheen;             // velvet grazing sheen strength on the fold ridges (the cut-pile glow)
uniform float uExposure;
uniform float uContrast;
uniform int   uToneMap;
uniform float uTwilight;          // global "sun is low" rod weight (from elevation, §3.5)
uniform float uMesopic;           // Purkinje strength (the mesopic_strength knob)
uniform vec3  uChroma;            // per-channel diffraction spread of the transport shift (θ∝λ); (1,1,1) = off

vec3 reinhard(vec3 c){ return c/(1.0+c); }
vec3 aces(vec3 x){ float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
vec3 tap(highp sampler2D t, vec2 world){
  vec2 uv=(world-uCanopyOrigin)/uCanopyExtent;
  return exp(-texture(t,uv).rgb);   // optical depth -> transmittance
}
vec3 tapFaith(vec2 world){ return texture(uFaithTex, (world-uFaithOrigin)/uFaithExtent).rgb; }   // already transmittance (pre-integrated over the disk), no exp
// edge diffraction (spec §3.6): light bends round each leaf edge by an angle ∝ λ, so red spreads wider than
// blue — each channel reads its sun-image at a shift scaled by its own wavelength (cs = per-channel scale,
// green=1). The colour fringe lands at every leaf/dapple edge and rides the same H*g shift, so it grows with
// canopy height and the low-sun ellipse for free. Three single-channel taps; only taken when diffraction is on.
vec3 tapCA(highp sampler2D t, vec2 world, vec2 g, float H, vec3 cs){
  float aR = texture(t, (world + H*g*cs.r - uCanopyOrigin)/uCanopyExtent).r;
  float aG = texture(t, (world + H*g*cs.g - uCanopyOrigin)/uCanopyExtent).g;
  float aB = texture(t, (world + H*g*cs.b - uCanopyOrigin)/uCanopyExtent).b;
  return exp(-vec3(aR,aG,aB));      // per-channel optical depth -> transmittance, each at its dispersed path
}
// curtain drape + velvet (spec §4.9). A real curtain is not flat — it hangs in vertical PLEATS that coarsen toward
// the hem (heavy fabric: wavelength ∝ √depth). v1 is shading-only (the cast shadow doesn't bend across the folds
// yet — that's v2 geometry). The pleats do two things that read as thick velvet rather than a thin woven grid:
//  • backlit THICKNESS — the edge-on fold flanks present more cut-pile, so they transmit LESS → dark vertical bands;
//  • a grazing SHEEN — the face-on ridges catch a soft pale glow, the signature of a standing-fibre pile.
// body is the transmitted moss; sheenCol the pale glow tint. Keyed to the cloth's own (u,v) so it stays on the cloth.
vec3 velvetCloth(vec2 cloth, vec3 body, vec3 sheenCol){
  float k = uFoldScale / sqrt(1.0 + uFoldCoarsen * max(cloth.y, 0.0));   // pleat frequency; λ grows down the drape
  float facing = abs(cos(cloth.x * k * 6.2831853));                      // 1 = edge-on flank, 0 = face-on ridge/valley
  float band = exp(-uFoldDepth * facing);                                // flanks thicker → darker pleat bands (backlit)
  float ridge = 1.0 - facing;                                            // bright where the cloth faces us
  float nap = 0.9 + 0.1*sin(cloth.y * k * 12.566370);                    // fine vertical pile grain (nap), tied to pleat scale
  vec3 sheen = sheenCol * (uSheen * ridge * ridge);                      // soft pale glow on the ridges only
  return body * band * nap + sheen;
}
void main(){
  vec2 world; float fog = 0.0; float extraThrow = 0.0; float recvZ = 0.0; vec2 clothUV = vec2(0.0);
  if(uReceiver != 0){
    // ---- CURTAIN receiver (spec §4.9): the receiver is a VERTICAL plane viewed head-on, NOT the floor. Screen
    // maps straight to the cloth's own coords — u across, v up. The tree's shadow is then projected onto the plane
    // by the (layerHeight - recvZ) height factor in the sample loop below: an occluder a height (h-v) ABOVE this
    // cloth point throws its shadow here, so the pattern stands UP the curtain instead of lying flat on the floor.
    // recvZ = 0 is the floor and leaves that loop byte-identical. (Folds that corrugate the plane are still v2.) ----
    vec2 cuv = (vUv-0.5)*uViewExtent*vec2(uAspect,1.0) + uViewCenter;  // pan/zoom frame the cloth (view_center, view_extent)
    world = vec2(cuv.x, uCurtainY);     // the cloth plane spans world-X; its world-Y (distance behind the tree) is uCurtainY
    recvZ = cuv.y;                       // height up the cloth (layer-path fallback; the faithful curtain uses clothUV)
    clothUV = cuv;                       // cloth (u across, v up) — the faithTex is baked in THESE coords (§4.9), tapped once below
  } else {
    // ---- tilted pinhole camera (spec §4.7): fragment -> ground point on z=0, plus a far-field haze factor.
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
    world += uViewCenter;            // camera pan: shift the looked-at floor point (0 = unchanged)
  }
  vec3 acc = vec3(0.0);
  bool ca = (uChroma.r!=1.0 || uChroma.g!=1.0 || uChroma.b!=1.0);   // diffraction on? else the byte-identical single-tap path
  if(uFaithful != 0){
    // FAITHFUL (§4.5/§4.9): the disk convolution at continuous per-leaf heights, pre-integrated as geometry at bake
    // time → one tap. FLOOR: cast in floor (x,y), tap at world. CURTAIN: cast onto the vertical cloth (u,v), tap at clothUV.
    acc = tapFaith(uReceiver != 0 ? clothUV : world);
  } else {
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
  }
  }   // end layer path
  // woody occluder (spec §4.5), evaluated ONCE per pixel (NOT per sample — that stalled). The trunk + main limbs
  // cast one CONNECTED shadow using the central sun direction (uBulkShift), with a soft edge that GROWS with height
  // to fake the area-light penumbra. Multiplies the SUN term only (wood blocks the beam, not the ambient sky).
  if(uOccCount>0){
    float woodT = 1.0;
    for(int k=0;k<${MAX_OCC};k++){
      if(k>=uOccCount) break;
      vec4 P = uOccSeg[k]; vec4 H = uOccHt[k];
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
  }
  // ---- Receiver (curtain handoff / spec §4.x). The landed irradiance (acc·uSunColor + uAmbient, linear HDR) is
  // answered by the surface. FLOOR: reflect off the albedo — the literal old line, byte-identical. CURTAIN: TRANSMIT
  // through woven moss-velvet — Tt carries brightness, the dye only hue (a dark velvet reads dim, not a bright gel),
  // energy-bounded since Tt·tint̂ ≤ 1. One gated branch; receiver default 0 skips the fabric as dead code. ----
  vec3 col;
  if(uReceiver == 0){
    col = (acc*uSunColor + uAmbient) * uGround;            // OPAQUE FLOOR — literal old expression, byte-identical
  } else {
    vec3 E = acc*uSunColor + uAmbient;                     // landed irradiance the fabric answers
    vec3 tintHat = uCurtainTint / max(max(uCurtainTint.r, uCurtainTint.g), max(uCurtainTint.b, 1e-4));   // unit-peak HUE
    vec3 body = E * (uTt * tintHat);                       // transmitted moss: brightness × hue; ambient rides through Tt·tint̂ (gated, not free)
    // drape + velvet (§4.9): pleats + grazing sheen on the cloth's own (u=clothUV.x, v=clothUV.y) coords. The sheen
    // is a pale warm tint of the dye (two-tone velvet), brightened a touch where the backlight is hot.
    vec3 sheenCol = mix(tintHat, vec3(1.0,0.96,0.88), 0.7) * (0.4 + 0.6*dot(body, vec3(0.33)));
    col = velvetCloth(clothUV, body, sheenCol);
  }
  // ---- Purkinje / mesopic dusk shift (§3.5): as the sun sets the eye's rods take over the dim shade —
  // colour desaturates toward a blue-green grey and saturated reds darken first, while the bright dapples
  // stay photopic and warm. Two REAL cues drive it (no absolute luminance exists here): global duskness
  // from elevation (uTwilight) × the local shade darkness (acc — exposure-independent). Linear HDR. ----
  const vec3 ROD_BLUE = vec3(0.92, 1.0, 1.30);          // rods peak ~505nm -> blue-green, not pure blue
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  float rod = (1.0 - smoothstep(0.15, 0.6, dot(acc, LUMA))) * uTwilight * uMesopic;  // 1 deep shade, 0 dapples
  col = mix(col, dot(col, LUMA)*ROD_BLUE, rod*0.6);     // cap 0.6 so the deepest shade keeps a hint of green
  col = mix(col, uHazeColor, fog);                       // far floor dissolves into atmospheric haze (§4.7); fog==0 at pitch 0
  col *= uExposure;
  if(uToneMap==1) col=reinhard(col);
  else if(uToneMap==2) col=aces(col);
  else col=clamp(col,0.0,1.0);
  col = clamp((col-0.5)*uContrast+0.5, 0.0, 1.0);
  col = pow(col, vec3(1.0/2.2));
  frag = vec4(col,1.0);
}`;

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
// transport already wrote final display-encoded colour into the target, so this is a verbatim 1:1 copy
// (NEAREST, identical size) — the re-presented frame is byte-identical to the one transport drew.
const FS_PRESENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 frag;
void main(){ frag = texture(uTex, vUv); }`;

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

  const params = Object.assign({}, DEFAULTS, opts.params || {});
  // Auto-quality runtime throttle (driven by the params.auto_quality toggle). Holds the live
  // resolution / sample-count it trims to. Never touches the artistic params.
  const perf = { auto:false, quality:1, resScale:1, sampleCount:params.sample_count, bres:0, acc:0, lowCount:0, hiCount:0, upWait:20 };  // bres = size the layer textures are currently built at (so applyQuality knows when to reallocate)
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
  const progTransport = program(VS_FULL, FS_TRANSPORT);
  const progBlit = program(VS_FULL, FS_BLIT);
  const progPresent = program(VS_FULL, FS_PRESENT);                   // adaptive frame-rate: offscreen frame -> screen
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
              curtainBake:loc(progFaith,'uCurtainBake'), curtainY:loc(progFaith,'uCurtainY'),
              morph:loc(progFaith,'uMorph'), morphAmount:loc(progFaith,'uMorphAmount'), sway:loc(progFaith,'uSway'), hRef:loc(progFaith,'uHRef'),
              windLevel:loc(progFaith,'uWindLevel'), windTime:loc(progFaith,'uWindTime'),
              leafSwing:loc(progFaith,'uLeafSwing'), flutterFreq:loc(progFaith,'uFlutterFreq'),   // (uStemLen removed: faithful dropped the twig-swing that used it)
              clusterTex:loc(progFaith,'uClusterTex'), clusterGeom:loc(progFaith,'uClusterGeom') };
  U.faithSeg = { origin:loc(progFaithSeg,'uFaithOrigin'), extent:loc(progFaithSeg,'uFaithExtent'), g:loc(progFaithSeg,'uG'), woodTau:loc(progFaithSeg,'uWoodTau'),
                 curtainBake:loc(progFaithSeg,'uCurtainBake'), curtainY:loc(progFaithSeg,'uCurtainY') };
  U.facc = { tex:loc(progFAcc,'uFAccTex'), weight:loc(progFAcc,'uFAccWeight') };
  U.tp = {
    samples:loc(progTransport,'uSamples[0]'), count:loc(progTransport,'uSampleCount'),
    occSeg:loc(progTransport,'uOccSeg[0]'), occHt:loc(progTransport,'uOccHt[0]'), occCount:loc(progTransport,'uOccCount'), occTau:loc(progTransport,'uOccTau'), occSway:loc(progTransport,'uOccSway'), occHRef:loc(progTransport,'uOccHRef'), occPenumbra:loc(progTransport,'uOccPenumbra'),
    heights:loc(progTransport,'uLayerHeight[0]'), layerCount:loc(progTransport,'uLayerCount'),
    proj:loc(progTransport,'uProj'), bulkShift:loc(progTransport,'uBulkShift'), viewExtent:loc(progTransport,'uViewExtent'), aspect:loc(progTransport,'uAspect'),
    pitch:loc(progTransport,'uPitch'), fov:loc(progTransport,'uFov'), yaw:loc(progTransport,'uViewYaw'), viewCenter:loc(progTransport,'uViewCenter'), haze:loc(progTransport,'uHazeColor'),
    farSmear:loc(progTransport,'uFarSmear'),
    origin:loc(progTransport,'uCanopyOrigin'), extent:loc(progTransport,'uCanopyExtent'),
    sun:loc(progTransport,'uSunColor'), ambient:loc(progTransport,'uAmbient'), ground:loc(progTransport,'uGround'),
    receiver:loc(progTransport,'uReceiver'), tt:loc(progTransport,'uTt'), curtainTint:loc(progTransport,'uCurtainTint'),
    curtainY:loc(progTransport,'uCurtainY'), foldDepth:loc(progTransport,'uFoldDepth'), foldScale:loc(progTransport,'uFoldScale'), foldCoarsen:loc(progTransport,'uFoldCoarsen'), sheen:loc(progTransport,'uSheen'),
    twilight:loc(progTransport,'uTwilight'), mesopic:loc(progTransport,'uMesopic'), chroma:loc(progTransport,'uChroma'),
    exposure:loc(progTransport,'uExposure'), contrast:loc(progTransport,'uContrast'), tone:loc(progTransport,'uToneMap'),
    layers:[0,1,2,3].map(i=>loc(progTransport,`uLayer[${i}]`)),
    faithful:loc(progTransport,'uFaithful'), faithTex:loc(progTransport,'uFaithTex'),
    faithOrigin:loc(progTransport,'uFaithOrigin'), faithExtent:loc(progTransport,'uFaithExtent'),
  };
  U.blit = { tex:loc(progBlit,'uTex') };
  U.present = { tex:loc(progPresent,'uTex') };
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
  const src = { flat:new Float32Array(0), count:0, maxR:1, maxW:1, haloR:0.01 };
  const occ = { rest:[], ht:new Float32Array(0), segBuf:new Float32Array(MAX_OCC*4), count:0, hRef:1 };   // woody occluder (trunk + main limbs): `rest` segments {ax..py} regrown, `ht` static (heights+radius), `segBuf` refilled per frame with the limb bend, `hRef` = tallest floor height for the drift's height-scale (spec §4.5)
  const faith = { vao:null, buf:null, count:0, hMin:0, hMax:1, ox:0, oy:0, ext:1,   // FAITHFUL leaf geometry (all leaves, continuous height) + the cast-region frame, computed in bakeFaithful (§4.5)
                  pminx:0, pmaxx:0, pminy:0, pmaxy:0,                                // real plan AABB of leaves+wood (regenCanopy) → cast-frame bound, so a wide grove's outer crown isn't clipped
                  gx:new Float32Array(MAX_SAMPLES), gy:new Float32Array(MAX_SAMPLES),// per-sample ground-shift scratch (hoisted; no per-bake alloc)
                  segVAO:null, segBuf:null, segRest:[], segArr:null, segCount:0 };   // + the woody skeleton (trunk+branches+twigs): rest segments, the per-bake swayed instance array, its VAO

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
      layerTex.push(makeLayerTexture((i < params.layer_count && !params.faithful_canopy) ? res : 1));
    }
    // FAITHFUL path (§4.5): the soft-shadow accumulator + per-sample scratch. 1×1 when off, so the park / layer
    // path allocates nothing extra; full bake-res when faithful_canopy is on.
    if(faithTex) gl.deleteTexture(faithTex);
    if(faithScratch) gl.deleteTexture(faithScratch);
    const fres = params.faithful_canopy ? res : 1;
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
          out.seg.push({ a:p, b:np, level, limb, f0:sx/nSub, f1:(sx+1)/nSub });
          p = np;
        }
        tip = p; endDir = d;
      } else {
        tip = [ base[0]+dir[0]*len, base[1]+dir[1]*len, base[2]+dir[2]*len ];
        out.seg.push({ a:base, b:tip, level, limb, f0:0, f1:1 });   // straight branch: full step (byte-identical)
      }
      if(level >= levels){ out.tw.push({ x:tip[0], y:tip[1], z:tip[2], limb, dx:endDir[0], dy:endDir[1] }); return; }   // dx,dy = twig heading (plan) so leaves can hug the twig, not scatter as a blob
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
      for(const w of out.tw){ const q=sc([w.x,w.y,w.z]); w.x=q[0]; w.y=q[1]; w.z=q[2]; w.tx=tx; w.ty=ty; w.tcov=treeCov; w.tree=tt; twigs.push(w); }
      for(const sg of out.seg){ segments.push({ a:sc(sg.a), b:sc(sg.b), level:sg.level, cov:treeCov, tree:tt, limb:sg.limb, px:tx, py:ty, f0:sg.f0||0, f1:(sg.f1!=null?sg.f1:1) }); }
      const trunkTop = (L>0) ? leaderTop*sV*aspect : trunkH*aspect;
      segments.push({ a:[tx,ty,0], b:[tx,ty,trunkTop], level:0, cov:treeCov, tree:tt, limb:-1, px:tx, py:ty, f0:0, f1:1 });   // the continuing trunk axis
      for(let i=0;i<lpt;i++){ const gi=limbBase+i;
        limbPlan[2*gi]=limbRaw[2*i]*s*0.6+tx; limbPlan[2*gi+1]=limbRaw[2*i+1]*s*0.6+ty; }
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
      nLimb, limbDir, limbPlan,
      limbAngle:new Float32Array(nLimb), limbVel:new Float32Array(nLimb),   // scalar bend (radians)
      nClusterTotal,
      clusterPlan:new Float32Array(nClusterTotal*2), clusterLimb:new Int32Array(nClusterTotal),
      clusterPhase:new Float32Array(nClusterTotal),
      twigAngle:new Float32Array(nClusterTotal), twigVel:new Float32Array(nClusterTotal),
      clusterData:new Float32Array(nClusterTotal*4),   // dynamic: (limb bend, twig bend, stem seed, _)
      clusterGeom:new Float32Array(nClusterTotal*4),   // static: (twig tip.xy, tree trunk pivot.xy)
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
      hier.twigAngle.set(prevHier.twigAngle.subarray(0,nC)); hier.twigVel.set(prevHier.twigVel.subarray(0,nC));
    }

    // ---- hang a leaf cluster on each twig, accumulating one instance buffer per depth layer ----
    const layerData = [];
    for(let l=0;l<nLayer;l++) layerData.push([]);   // 16 floats/leaf — see attribute layout below
    const faithData = [];                           // FAITHFUL: ALL leaves in one buffer + a 17th float = continuous height (§4.5)
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
      hier.clusterGeom[4*j]=cx; hier.clusterGeom[4*j+1]=cy;          // twig tip = the cluster centre
      hier.clusterGeom[4*j+2]=t.tx; hier.clusterGeom[4*j+3]=t.ty;    // limb pivot = this tree's trunk
      hier.clusterData[4*j+2]=stemRand;                             // static stem-angle seed (.z); tick writes .x/.y
      const data = layerData[t.layer];
      for(let k=0;k<nLeaf;k++){
        const cov = ((k===pcInt) ? frac : 1.0) * t.tcov;   // marginal-leaf fade × marginal-tree fade (§4.5)
        // leaves HUG the twig (§4.5): trail back from the tip ALONG the twig heading (1.5×spread) with a tight
        // perpendicular jitter (0.4×spread), instead of an isotropic blob. Same two draws → other attributes unchanged.
        const g1 = gauss(), g2 = gauss();
        const hug = params.faithful_canopy && tHasDir;   // twig-hug only in faithful mode; the layer/park scatter stays byte-identical
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
      for(const sg of segments){
        if(sg.level>1) continue;                       // trunk + main limbs only; fine sub-branches carried by the leaf dapples
        if(rest.length >= MAX_OCC) break;
        const r = Math.max(0.01, params.trunk_radius_m*Math.pow(tf, sg.level));
        rest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], limb:sg.limb, px:sg.px, py:sg.py });   // limb+pivot for the per-frame swing
        segH.push(floorH(sg.a[2]), floorH(sg.b[2]), r, 0);
      }
      occ.rest = rest; occ.ht = new Float32Array(segH); occ.count = rest.length;
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
        segRest.push({ ax:sg.a[0], ay:sg.a[1], bx:sg.b[0], by:sg.b[1], ha:sg.a[2], hb:sg.b[2], ra, rb, limb:sg.limb, px:sg.px, py:sg.py });   // REAL grown heights (cast == preview)
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
    if(params.faithful_canopy){ bakeFaithful(); return; }   // FAITHFUL path (§4.5): cast the real tree, not the layer slabs
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
    for(let l=0;l<params.layer_count;l++){
      // higher layers ride longer levers -> sway more when height gain > 0 (else pure translation)
      const f = 1.0 + params.sway_height_gain*(H[l]/base - 1.0);
      gl.uniform2f(U.bake.sway, motion.sway[0]*f, motion.sway[1]*f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layerTex[l], 0);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);   // depth 0 -> transmittance 1
      const L=layerVAO[l];
      gl.bindVertexArray(L.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, L.count);
    }
    // (woody branches are no longer stamped into the leaf layers — they're the continuous-height analytic
    // occluder in transport now, §4.5; only leaves are baked here.)
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
    // heights down to ~0.1× (publishBend's clamp floor), so widen the low bound there so a foreshortened leaf's
    // (closer-in) cast isn't clipped out of the frame.
    const hLo = woodOn ? 0 : faith.hMin*(params.sway_pitch>0 ? 0.1 : 1), hHi = faith.hMax;
    // pad: the leaf quad half-extent, the incoherent drift orbit, and the live coherent sway (leaves+wood translate
    // by up to |sway| at the crown) — none of which are in the rest plan AABB. (The twig-hug trail-back already is.)
    const pad = params.leaf_size_m + params.drift_amount + Math.hypot(motion.sway[0],motion.sway[1]) + 0.05;
    let minx,maxx,miny,maxy;
    if(params.receiver){
      // CURTAIN cast frame (§4.9): occluders project onto the VERTICAL cloth (Y=cy), not the floor — the projection is
      // nonlinear in g (÷gy), so sweep the plan-AABB corners × the height range through each sample's cloth map
      // (u = px − r·gx, v = h − r; r = (py−cy)/gy) and bound the (u,v) span. (8 corners × N samples — cheap.)
      const cy = params.curtain_distance_m;
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
    gl.uniform1f(U.faith.curtainY, params.curtain_distance_m);
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

    // FAITHFUL skeleton (§4.5): refill the instance array with the live limb SWING (rotate each segment about its tree
    // pivot by the limb bend) + whole-tree drift, so the wood sways WITH the leaves; then upload + set its statics once.
    if(woodOn){
      const la = hier ? hier.limbAngle : null, sa = faith.segArr, R = faith.segRest;
      const swx = motion.sway[0], swy = motion.sway[1], hRef = Math.max(faith.hMax, 1e-3);
      const sp = Math.max(0, params.sway_pitch);   // 3-D lean (§5): foreshorten the wood heights by the SAME factor the leaves use, so leaf-on-wood registration holds
      for(let k=0;k<faith.segCount;k++){
        const s = R[k];
        const th = (la && s.limb>=0 && s.limb<la.length) ? la[s.limb] : 0;
        const c=Math.cos(th), sn=Math.sin(th), px=s.px, py=s.py, o=k*8;
        const fore = sp>0 ? clamp(1 - sp*(1-Math.cos(th)), 0.1, 1) : 1;   // limb pitches with its bend → tip lowers (matches publishBend's per-cluster .w)
        const ha = s.ha*fore, hb = s.hb*fore;
        const kA = ha/hRef, kB = hb/hRef;   // sway grows with height: 0 at the ground → the trunk base stays PLANTED, the crown sways; same fraction for a limb & the trunk at its height, so they stay joined
        sa[o]   = px + c*(s.ax-px) - sn*(s.ay-py) + swx*kA;
        sa[o+1] = py + sn*(s.ax-px) + c*(s.ay-py) + swy*kA;
        sa[o+2] = px + c*(s.bx-px) - sn*(s.by-py) + swx*kB;
        sa[o+3] = py + sn*(s.bx-px) + c*(s.by-py) + swy*kB;
        sa[o+4]=ha; sa[o+5]=hb; sa[o+6]=s.ra; sa[o+7]=s.rb;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, faith.segBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sa);
      gl.useProgram(progFaithSeg);
      gl.uniform2f(U.faithSeg.origin, faith.ox, faith.oy);
      gl.uniform2f(U.faithSeg.extent, faith.ext, faith.ext);
      gl.uniform1f(U.faithSeg.woodTau, params.branch_tau);
      gl.uniform1i(U.faithSeg.curtainBake, params.receiver ? 1 : 0);   // §4.9: cloth vs floor projection (matches the leaves)
      gl.uniform1f(U.faithSeg.curtainY, params.curtain_distance_m);
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
    if(params.eclipse){
      const rm=coreR*1.0, d=coreR*(1.3-params.eclipse_amount);
      for(const p of pts){ if(Math.hypot(p[0]-d, p[1])<rm) p[2]=0; }
      let s=0; for(const p of pts) s+=p[2];
      if(s>0) for(const p of pts) p[2]/=s;     // renormalize (keep shape visible)
    }
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
    for(let i=0;i<hier.nLimb;i++){             // limbs pivot about the trunk; bend = wind TORQUE about it
      const dx=hier.limbDir[2*i], dy=hier.limbDir[2*i+1];
      const torque = dx*wy - dy*wx;            // cross(limbDir,wind): tip swings downwind, sign by side —
                                               // so a uniform gust LEANS the whole canopy, never spins it
      const n = windNoise(hier.limbPlan[2*i], hier.limbPlan[2*i+1], t, 0.4);
      const target = lf*(u*torque + 0.6*eb*n);
      for(let s=0;s<steps;s++){ const a = kL*(target - hier.limbAngle[i]) - cL*hier.limbVel[i];
        hier.limbVel[i]+=a*h; hier.limbAngle[i]+=hier.limbVel[i]*h; }
      maxv=Math.max(maxv, Math.abs(hier.limbVel[i]));
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
    const sp = Math.max(0, params.sway_pitch);   // 3-D lean (§5): a bent limb pitches down → foreshorten factor in .w (faithful only); 0 → factor 1, byte-identical
    for(let j=0;j<hier.nClusterTotal;j++){
      const lb = hier.limbAngle[hier.clusterLimb[j]];
      hier.clusterData[4*j]   = lb;                                    // limb bend this clump inherits
      hier.clusterData[4*j+1] = hier.twigAngle[j];                     // its own twig bend
      hier.clusterData[4*j+3] = sp>0 ? clamp(1 - sp*(1-Math.cos(lb)), 0.1, 1) : 1;   // height foreshorten: tip drops as the limb pitches with its bend
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
    const to = Object.assign({}, DEFAULTS, target);        // missing keys -> defaults (forward-compat, like setParams)
    const from = {};
    for(const k of MORPH_KEYS)  from[k] = params[k];       // continuous look — always morphs live
    for(const k of CANOPY_KEYS) from[k] = params[k];       // continuous canopy — morphs live IF the topology matches
    const topoDiff   = TOPO_KEYS.some(k => to[k]!==params[k]);     // a new tree/layer/seed: can't morph leaf-for-leaf
    const modeDiff   = MODE_KEYS.some(k => to[k]!==params[k]);     // a scene-MODE flag flips (faithful_canopy/standing_scene): needs a rebuild, NOT a snap-with-stale-state
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
      const faithSunMorph = params.faithful_canopy &&
        (trans.from.sun_elevation_deg!==trans.to.sun_elevation_deg || trans.from.sun_azimuth_deg!==trans.to.sun_azimuth_deg);
      if(trans.canopyMorph || motionActive() || faithSunMorph) bake();
    }
    if(t>=1){                                              // land exactly on the target; clear the bloom
      trans.active = false; trans.bloom = 0;
      for(const k in DEFAULTS) params[k] = trans.to[k];
      regenSource(); resetPerf();                          // bloom now 0; re-probe quality for the new look (it may carry auto-quality)
      if(params.faithful_canopy) bake();                   // land the faith texture on the exact target sun (resetPerf only re-bakes on a bake-res change)
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
    if(params.faithful_canopy){
      // FAITHFUL: transport is a single tap (resolution ~free), the per-SAMPLE geometry bake dominates and scales
      // linearly in the sample count — so trim SAMPLES across the whole range (relieving the bake immediately as q
      // drops) and let resolution ride along. bakeRes() still trims below the knee. q=1 → full, look unchanged.
      res  = lerp(RES_MIN, 1, q);
      samp = Math.round(lerp(SAMP_MIN, params.sample_count, q));
    } else if(q >= KNEE){ res = lerp(RES_MIN, 1, (q-KNEE)/(1-KNEE)); samp = params.sample_count; }   // layer mode: resolution first (the per-pixel transport sample loop IS the cost)
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
  function drawTransport(){
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,canvas.width,canvas.height);
    drawTransportInto();
  }
  // the transport draw, assuming a framebuffer + viewport are already bound — so the profiler's stress burst
  // (eng.profiler.bench) can aim it at an offscreen target without flipping to screen. On-screen path above.
  function drawTransportInto(){
    const E=params.canopy_extent_m;
    gl.disable(gl.BLEND);
    gl.useProgram(progTransport);
    gl.uniform3fv(U.tp.samples, src.flat.subarray(0, src.count*3));
    gl.uniform1i(U.tp.count, src.count);
    gl.uniform1fv(U.tp.heights, layerHeights());
    gl.uniform1i(U.tp.layerCount, params.layer_count);
    gl.uniformMatrix2fv(U.tp.proj, false, projMatrix());
    // standing-scene bulk shadow offset (§4.8): cast the shadow to the SIDE by cot(elev) per unit height (the
    // park model omits this — fine for an infinite canopy, wrong for a standing tree). Applied to EVERY occluder
    // (trunk, branches, leaves) via g, so the whole tree shadow stays one connected thing and sweeps together as
    // the sun moves — real physics, no camera tricks. Framing the tree off-frame is the camera's job (a fixed
    // pan, view_center), NOT an auto-centre on the crown (that decouples trunk from crown). Gated → 0 = park.
    { const b=bulkShift(); gl.uniform2f(U.tp.bulkShift, b[0], b[1]); }   // shared helper (matches the faithful bake; 0 when off)
    gl.uniform1f(U.tp.viewExtent, params.view_extent_m);
    gl.uniform1f(U.tp.aspect, canvas.width/canvas.height);
    gl.uniform1f(U.tp.pitch, clamp(params.view_pitch_deg,0,80)*DEG);     // camera tilt (rad); 0 = top-down
    gl.uniform1f(U.tp.yaw, params.view_yaw_deg*DEG);                     // camera orbit (rad); 0 = unchanged
    gl.uniform2f(U.tp.viewCenter, params.view_center_x, params.view_center_y);   // camera pan (world m) — frames the off-frame tree; no auto-centre (§4.8)
    // woody occluder (§4.5): trunk + main limbs, continuous heights → connected shadow. Gated by branch_tau (the wood
    // knob): 0 = no wood, byte-identical. The bulk sun-offset (standing scene) rides in `g`, so it casts to the side too.
    // In FAITHFUL mode the whole skeleton (incl. twigs) is baked into the leaf shadow instead, so the analytic occluder is off.
    if(!params.faithful_canopy && params.branch_tau > 0 && occ.count > 0){
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
      gl.uniform4fv(U.tp.occSeg, buf.subarray(0, occ.count*4));
      gl.uniform4fv(U.tp.occHt, occ.ht.subarray(0, occ.count*4));
      gl.uniform1i(U.tp.occCount, occ.count);
      gl.uniform1f(U.tp.occTau, params.branch_tau);
      gl.uniform2f(U.tp.occSway, motion.sway[0], motion.sway[1]);    // wood drifts with the whole-tree sway
      gl.uniform1f(U.tp.occHRef, Math.max(occ.hRef, 1e-3));          // height-scale ref → trunk foot planted, crown sways
      const el=Math.max(params.sun_elevation_deg,6)*DEG;            // penumbra/height: source angular core projected to ground (~/sin elev), widened by cloud
      gl.uniform1f(U.tp.occPenumbra, (params.core_angular_radius_deg*DEG)/Math.sin(el)*(1.0+3.0*params.cloud_thickness));
    } else gl.uniform1i(U.tp.occCount, 0);
    gl.uniform1f(U.tp.fov, clamp(params.view_fov_deg,5,140)*DEG);        // vertical full FOV (rad)
    gl.uniform1f(U.tp.farSmear, Math.max(0, params.far_smear));          // far-field dapple smear (§4.7); 0 at pitch 0 regardless
    gl.uniform2f(U.tp.origin, -E/2, -E/2);
    gl.uniform2f(U.tp.extent, E, E);
    // FAITHFUL path (§4.5): tap the pre-integrated soft shadow ONCE instead of the sample loop. The faith texture
    // lives in the cast frame (computed in bakeFaithful, this frame). Off → uFaithful 0 → the layer path, byte-identical.
    gl.uniform1i(U.tp.faithful, params.faithful_canopy ? 1 : 0);
    if(params.faithful_canopy){
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, faithTex); gl.uniform1i(U.tp.faithTex, 4);   // unit 4 free in transport (layers use 0-3)
      gl.uniform2f(U.tp.faithOrigin, faith.ox, faith.oy);
      gl.uniform2f(U.tp.faithExtent, faith.ext, faith.ext);
    }
    // physical sun + sky colour from solar elevation (spec §3.5): warm/red low sun, ozone-blue shadows
    const atm = atmosphere(_atm, params.sun_elevation_deg, params.sky_turbidity, params.ambient_skylight);
    gl.uniform3f(U.tp.sun, atm.sun[0], atm.sun[1], atm.sun[2]);
    gl.uniform3f(U.tp.ambient, atm.ambient[0], atm.ambient[1], atm.ambient[2]);
    // distance haze: the sky/ambient HUE at a steady brightness, so the far floor fades into a time-of-day-
    // consistent atmosphere (only visible once tilt blooms the fog; invisible at pitch 0).
    { const a=atm.ambient, m=Math.max(a[0],a[1],a[2],1e-4), hb=0.6;
      gl.uniform3f(U.tp.haze, a[0]/m*hb, a[1]/m*hb, a[2]/m*hb); }
    gl.uniform3f(U.tp.ground, params.ground_r, params.ground_g, params.ground_b);   // dirt-floor albedo (spec §4.7)
    // Receiver (curtain handoff): 0 = opaque floor (byte-identical), 1 = translucent moss-velvet curtain — Tt
    // brightness × dye hue. Only consulted in the shader when receiver≠0, so the floor path costs nothing.
    gl.uniform1i(U.tp.receiver, params.receiver|0);
    gl.uniform1f(U.tp.tt, params.curtain_tt);
    gl.uniform3f(U.tp.curtainTint, params.curtain_tint_r, params.curtain_tint_g, params.curtain_tint_b);
    gl.uniform1f(U.tp.curtainY, params.curtain_distance_m);
    gl.uniform1f(U.tp.foldDepth, params.fold_depth);
    gl.uniform1f(U.tp.foldScale, params.fold_scale);
    gl.uniform1f(U.tp.foldCoarsen, params.fold_coarsen);
    gl.uniform1f(U.tp.sheen, params.velvet_sheen);
    // Purkinje (§3.5): rods take over the dim shade as the sun lowers. The global weight rides the same
    // low-sun band that warms the beam; it hard-gates off (and costs nothing) for a daytime sun.
    gl.uniform1f(U.tp.twilight, smoothstep(30, 4, params.sun_elevation_deg));
    gl.uniform1f(U.tp.mesopic, params.mesopic_strength);
    // edge diffraction (§3.6): per-channel λ-proportional spread of the transport shift. Green (555nm) is the
    // reference; red(620) spreads more, blue(470) less. 0 -> (1,1,1), the byte-identical single-tap path.
    { const d=Math.max(0, params.chromatic_aberration), LR=620/555, LB=470/555;
      gl.uniform3f(U.tp.chroma, 1+d*(LR-1), 1, Math.max(0, 1+d*(LB-1))); }   // floor blue ≥0: diffraction shrinks the spread to zero, never reverses it
    gl.uniform1f(U.tp.exposure, params.exposure);
    gl.uniform1f(U.tp.contrast, params.contrast);
    gl.uniform1i(U.tp.tone, params.tone_map);
    for(let i=0;i<MAX_LAYERS;i++){ gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, layerTex[i]); gl.uniform1i(U.tp.layers[i], i); }
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
    for(let j=0;j<tws.length;j++){
      const t=tws[j], cx=t.x, cy=t.y, cz=t.z, tcov=(t.tcov===undefined?1:t.tcov);
      const ti=(t.tree===undefined?0:t.tree), tnt=((ti*0.61803398875)%1)*2-1;   // per-tree warmth [-1,1], golden-spread so neighbours differ
      let tdx=t.dx||0, tdy=t.dy||0; const tdl=Math.hypot(tdx,tdy), tHasDir=tdl>1e-4; if(tHasDir){ tdx/=tdl; tdy/=tdl; }   // grown twig heading (the bake's stored t.dx,t.dy), so the hug matches even on a drooped twig
      const gauss=makeGauss(mulberry32(hash3(params.seed>>>0, j, 101)));   // per-twig scatter, j = twig index == the bake's seed (same count & spread, not bit-identical)
      for(let k=0;k<nLeaf;k++){
        const g1=gauss(), g2=gauss();   // leaves hug the twig — must match the bake (§4.5)
        const cov = ((k===pcInt) ? frac : 1.0) * tcov;   // marginal-leaf fade × marginal-tree fade — matches the bake (E#54), so a density morph tracks the cast
        const hug = params.faithful_canopy && tHasDir;
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
    const merged = Object.assign({}, DEFAULTS, obj);   // missing keys -> defaults (forward-compat)
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
        gl.bindFramebuffer(gl.FRAMEBUFFER, benchFBO);
        gl.viewport(0,0,benchW,benchH);
        const t0=performance.now();
        for(let i=0;i<n;i++) drawTransportInto();
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
  // change the grove skeleton (tree/limb/branch/seed), so the spring arrays line up 1:1. snapshotMotion exposes
  // live refs (read-only); applyMotion copies them in + re-uploads the bend texture; setMotionSource swaps the
  // per-frame tick for a copy-from-source. The bake only reads angles + sway + time, so velocities aren't needed. ----
  let snapshotMotion, applyMotion, setMotionSource;
  if(EDITOR){
    snapshotMotion = () => ({ m:motion, dphase:params.drift_phase, lA:hier?.limbAngle, tA:hier?.twigAngle });
    applyMotion = (s) => {
      if(!s) return;
      const sm=s.m;
      motion.time=sm.time; motion.u=sm.u; motion.v=sm.v; motion.uLat=sm.uLat; motion.vLat=sm.vLat;
      motion.env=sm.env; motion.driveEnv=sm.driveEnv; motion.windX=sm.windX; motion.windY=sm.windY; motion.weatherS=sm.weatherS;
      motion.sway[0]=sm.sway[0]; motion.sway[1]=sm.sway[1];
      params.drift_phase = s.dphase;                       // incoherent band rides a param the source advances
      if(hier && s.lA && hier.limbAngle.length===s.lA.length){
        hier.limbAngle.set(s.lA); hier.twigAngle.set(s.tA);
        publishBend();                                     // push the mirrored bend into the texture the bake reads
      }
    };
    setMotionSource = (src) => { motionTick = src ? () => applyMotion(src.snapshotMotion()) : tick; };
  }

  // ---- init + frame loop ----
  rebuildAll();
  resetPerf();
  let last=performance.now(), fps=60, paused=false, alive=true;
  const eng = { canvas, gl, params, perf, motion, src, trans, fps:60, apply, setParams, transitionTo, onFrame:opts.onFrame||null,
    // pause the rAF loop so a second engine instance idles at zero GPU when off-screen (the editor's A/B picker)
    setPaused(on){ on=!!on; if(on===paused) return; paused=on; if(!on){ last=performance.now(); requestAnimationFrame(frame); } },
    // dispose: stop the loop and free EVERY GL object + the context, so a disposable second instance (the A/B
    // picker, created per-comparison) leaves zero GPU residue when closed. A disposed engine must not be reused.
    dispose(){
      alive = false;
      [progBake, progFaith, progFaithSeg, progFAcc, progTransport, progBlit, progPresent, progPoints, progViz].forEach(p => { if(p) gl.deleteProgram(p); });
      layerTex.forEach(t => { gl.deleteTexture(t); });
      [clusterTex, clusterGeomTex, faithTex, faithScratch, benchTex, presentTex].forEach(t => { if(t) gl.deleteTexture(t); });
      [bakeFBO, faithFBO, benchFBO, presentFBO].forEach(f => { if(f) gl.deleteFramebuffer(f); });
      layerVAO.forEach(L => { gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.buf); });
      if(faith.vao){ gl.deleteVertexArray(faith.vao); gl.deleteBuffer(faith.buf); }
      if(faith.segVAO){ gl.deleteVertexArray(faith.segVAO); gl.deleteBuffer(faith.segBuf); }
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, presentFBO);
      gl.viewport(0,0,presentW,presentH);
      timed('transport', drawTransportInto);          // heavy transport -> offscreen
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
    if(params.show_layer && !params.faithful_canopy) drawLayerBlit(); else timed('transport', drawTransport);   // show_layer is a no-op in faithful mode (the layer textures aren't baked)
    if(eng.onFrame) eng.onFrame(dtms);               // editor draws HUD + source inset here
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return eng;
}

export { create, DEFAULTS, MAX_LAYERS, MAX_SAMPLES, DEG, MORPH_KEYS, CANOPY_KEYS, TOPO_KEYS, MODE_KEYS };
