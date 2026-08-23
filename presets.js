// ============================================================================
// Komorebi built-in looks — the shipped presets. Data, not engine: split out of
// komorebi.js so the engine stays a pure renderer. Imported by the editor and the
// player; each look merges over the engine's DEFAULTS. (spec §9)
// ============================================================================
import { DEFAULTS } from "./komorebi.js";

export const PRESETS = {
  // The built-in looks. Definition order below IS the dropdown / ← → order — there is no separate
  // order list to keep in sync. The editor boots into 'afternoon 7'; 'test 1'/'test 2' sit commented
  // at the foot of this object. Any saved (★) look lives in local storage; DEFAULTS is the merge base.
  // 'afternoon 4' — windy predecessor; now a 3-tree grove with wider (52°) branching.
  'afternoon 4': Object.assign({}, DEFAULTS, {
    sample_count:32, core_angular_radius_deg:0.77, halo_angular_radius_deg:4.3,
    core_weight_fraction:0.78, cloud_thickness:0.41, eclipse:false, eclipse_amount:0.42,
    layer_count:3, canopy_base_height_m:2, canopy_thickness_m:2.6, foliage_density:1.65,
    tree_count:3, branch_angle_deg:52,
    clusters_per_layer:82, leaves_per_cluster:59, cluster_spread_m:0.28, leaf_size_m:0.1,
    leaf_aspect:1.75, max_tilt:0.54, edge_softness:0.26, trans_r:0.26, trans_g:0.356, trans_b:0.001,
    canopy_extent_m:6, tex_resolution:1024, seed:290626672,
    sun_elevation_deg:84.5, sun_azimuth_deg:201,
    view_extent_m:3.1, exposure:2.44, contrast:0.98, ambient_skylight:0.97, tone_map:2,
    wind_strength:1.34, wind_direction_deg:132, gust_frequency:0.125, gust_attack:1.2, gust_decay:2.5,
    sway_stiffness:1.2, sway_ceiling:0.4, damping_ratio:0.25, backlash_gain:1, sway_height_gain:1.6,
    limb_count:11, limb_flex:0.25, twig_flex:0.35, stem_length:0.14, leaf_swing:1.35, flutter_freq:1.4,
    drift_amount:0.145, drift_phase:2.876, drift_auto:true, drift_speed:0.04,
  }),
  // 'afternoon 4b' — afternoon 4 under haze: turbid sky (β 0.23), lower exposure, a touch more contrast.
  'afternoon 4b': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.77, "halo_angular_radius_deg": 4.3,
    "core_weight_fraction": 0.78, "cloud_thickness": 0.41, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 3, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 52,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 82, "leaves_per_cluster": 59,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 85.1984375, "sun_azimuth_deg": 185.1914062500001,
    "view_extent_m": 3.1, "exposure": 1.29, "contrast": 1.11, "ambient_skylight": 0.83, "sky_turbidity": 0.23, "tone_map": 2,
    "wind_strength": 1.34, "wind_direction_deg": 132, "gust_frequency": 0.125, "gust_attack": 1.2, "gust_decay": 2.5,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.25, "backlash_gain": 1, "sway_height_gain": 1.6,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.35, "stem_length": 0.14, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 0.1618908759004459, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": false,
  }),
  // 'afternoon 5' — calm near-overhead spring scene, now a 3-tree grove.
  'afternoon 5': Object.assign({}, DEFAULTS, {
    sample_count:32, core_angular_radius_deg:0.77, halo_angular_radius_deg:4.3,
    core_weight_fraction:0.78, cloud_thickness:0.41, eclipse:false, eclipse_amount:0.42,
    layer_count:3, canopy_base_height_m:2, canopy_thickness_m:2.6, foliage_density:1.65,
    tree_count:3,
    clusters_per_layer:82, leaves_per_cluster:59, cluster_spread_m:0.28, leaf_size_m:0.1,
    leaf_aspect:1.75, max_tilt:0.54, edge_softness:0.26, trans_r:0.26, trans_g:0.356, trans_b:0.001,
    canopy_extent_m:6, tex_resolution:1024, seed:290626672,
    sun_elevation_deg:84.5, sun_azimuth_deg:201,
    view_extent_m:3.1, exposure:2.44, contrast:0.98, ambient_skylight:0.97, tone_map:2,
    wind_strength:0.07, wind_direction_deg:132, gust_frequency:0.125, gust_attack:1.2, gust_decay:1.3,
    sway_stiffness:1.2, sway_ceiling:0.4, damping_ratio:0.65, backlash_gain:1, sway_height_gain:0.75,
    limb_count:11, limb_flex:0.25, twig_flex:0.18, stem_length:0.18, leaf_swing:1.35, flutter_freq:1.4,
    drift_amount:0.145, drift_phase:1.403, drift_auto:true, drift_speed:0.04, auto_quality:true,
    ground_r:0.33, ground_g:0.21, ground_b:0.12,   // warm Mount-Royal dirt floor
  }),
  // 'afternoon 5b' — afternoon 5 dropped to a low (23°) sun swung round to the west.
  'afternoon 5b': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.77, "halo_angular_radius_deg": 4.3,
    "core_weight_fraction": 0.78, "cloud_thickness": 0.41, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 3, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 82, "leaves_per_cluster": 59,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 23.233203125002493, "sun_azimuth_deg": 254.1128906249312,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 1.32, "ambient_skylight": 0.97, "sky_turbidity": 0.05, "tone_map": 2,
    "wind_strength": 0.07, "wind_direction_deg": 132, "gust_frequency": 0.125, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 0.30115210461684433, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  // 'prism' — afternoon 5b's low west sun, now surfacing leaf-edge diffraction: red & blue split at every
  // dapple edge (θ∝λ). Same topology as 5b (seed/branching/layers), so 5b↔prism is a clean live morph.
  'prism': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.77, "halo_angular_radius_deg": 4.3,
    "core_weight_fraction": 0.78, "cloud_thickness": 0.41, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 3, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 82, "leaves_per_cluster": 59,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 23.233203125002493, "sun_azimuth_deg": 254.1128906249312,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 1.32, "ambient_skylight": 0.97, "sky_turbidity": 0.05, "tone_map": 2,
    "chromatic_aberration": 3.0,
    "wind_strength": 0.07, "wind_direction_deg": 132, "gust_frequency": 0.125, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 0.30115210461684433, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  'afternoon 6': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.77, "halo_angular_radius_deg": 4.3,
    "core_weight_fraction": 0.78, "cloud_thickness": 0.41, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 4, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 82, "leaves_per_cluster": 59,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 84.5, "sun_azimuth_deg": 201,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "tone_map": 2,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.125, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 4.1025121046151725, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  // 'afternoon 6b' — afternoon 6 with steeper leaf tilt (max_tilt 0.87 -> more footprint foreshortening).
  'afternoon 6b': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.77, "halo_angular_radius_deg": 4.3,
    "core_weight_fraction": 0.78, "cloud_thickness": 0.41, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 4, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 82, "leaves_per_cluster": 59,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.87, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 84.5, "sun_azimuth_deg": 201,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 1.14, "ambient_skylight": 0.97, "sky_turbidity": 0.05, "tone_map": 2,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.125, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 0.8278467974359008, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  'afternoon 7': Object.assign({}, DEFAULTS, {
    "sample_count": 48, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.88, "cloud_thickness": 0.3, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 60, "leaves_per_cluster": 39,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 7, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 84.5, "sun_azimuth_deg": 201,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "tone_map": 2,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 4.873668287691452, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
    "ground_r": 0.33, "ground_g": 0.21, "ground_b": 0.12,   // warm Mount-Royal dirt floor
    "view_pitch_deg": 24, "view_fov_deg": 64,
  }),
  // 'park 1' — (was 'afternoon 8') the first STANDING-SCENE look (spec §4.8): the tree STANDS in the scene and
  // its whole SHADOW (trunk streak → branches → crown dapples) is thrown ACROSS a lit floor — not an infinite
  // canopy hovering overhead (the park model). Two things make it: standing_scene adds the bulk lateral shadow
  // offset the park model omits (so a LOW sun casts the shadow to the side); and a wide view_extent over a small
  // canopy_extent leaves the grove a finite blob with lit floor around it. Orient via sun azimuth / camera orbit.
  'park 1': Object.assign({}, DEFAULTS, {
    "sample_count": 29, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.88, "cloud_thickness": 0.3, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 2, "canopy_thickness_m": 1.6, "foliage_density": 1.55,
    "tree_count": 2, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 41,
    "branch_length_ratio": 0.68, "branch_pitch_deg": 20, "branch_tau": 2.75, "leader_strength": 0.15, "droop": -0.23, "clusters_per_layer": 60, "leaves_per_cluster": 20,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.15, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6.5, "tex_resolution": 1024, "bake_resolution": 768,
    "seed": 290626672, "sun_elevation_deg": 26, "sun_azimuth_deg": 90,
    "view_extent_m": 13.489433156286438, "view_pitch_deg": 61.39999999999994, "view_fov_deg": 60, "view_yaw_deg": 28.50000000000159,
    "view_center_x": -1.4862983633911613, "view_center_y": -6.504920223431666, "standing_scene": true, "faithful_canopy": true, "trunk_radius_m": 0.12, "far_smear": 0,
    "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "sky_turbidity": 0.05, "mesopic_strength": 0.6, "chromatic_aberration": 0, "tone_map": 2,
    "ground_r": 0.33, "ground_g": 0.21, "ground_b": 0.12,   // warm Mount-Royal dirt floor
    "wind_pattern": "squally", "wind_strength": 1.61, "wind_gustiness": 0.25, "wind_direction_deg": 0, "gust_frequency": 0.13,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 3.28912362615405, "drift_auto": true, "drift_speed": 0.02,
    "auto_quality": true,   // park 1 is faithful_canopy (the heaviest path) — without the governor a weak device has no recovery; matches every sibling look
  }),
  // 'curtain 1' — the first CURTAIN look (spec §4.9): the tree's shadow is cast onto a STANDING moss-velvet
  // curtain (a vertical receiver plane), lit from behind by a low sun, seen head-on from the bed. The shadow
  // stands UP the cloth (projected via height - recvZ) instead of lying on the floor. The tree itself sits off
  // the cloth (at world-Y 0); the curtain is `curtain_distance_m` behind it, so only the cast shadow is in view.
  // FRAMING IS NUDGEABLE: curtain dist + sun azimuth/elevation + the pan place the shadow; tune to taste.
  // Uses the FAITHFUL cast (§4.9) re-aimed at the vertical cloth — real per-leaf geometry, no layer banding;
  // the sun azimuth (90°, facing the cloth) must give the projection a Y-component, or the cast degenerates.
  'curtain 1': Object.assign({}, DEFAULTS, {
    "sample_count": 29, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.88, "cloud_thickness": 0.28, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 2, "canopy_thickness_m": 1.6, "foliage_density": 1.4,
    "tree_count": 2, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 41,
    "branch_length_ratio": 0.68, "branch_pitch_deg": 20, "branch_tau": 2.4, "leader_strength": 0.15, "droop": -0.23, "clusters_per_layer": 60, "leaves_per_cluster": 20,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.16, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6.5, "tex_resolution": 1024, "bake_resolution": 768,
    // a low raking sun, well off the cloth's normal: elevation gives the shadow its climb up the drape, and the
    // off-axis azimuth is what makes the fold incidence band one flank lit and the other dark (head-on, az 90°,
    // both flanks only foreshorten — see §4.9).
    "seed": 290626672, "sun_elevation_deg": 13, "sun_azimuth_deg": 62,
    // CURTAIN receiver: a vertical plane 2.5 m behind the tree, viewed head-on. view_center.y sits on the aperture
    // centre so the window is what the frame is about; pitch is irrelevant in curtain mode (head-on map).
    "receiver": 1, "standing_scene": true, "faithful_canopy": true,
    "curtain_distance_m": -2.5, "curtain_tt": 0.22, "curtain_tint_r": 0.45, "curtain_tint_g": 1.0, "curtain_tint_b": 0.28,
    "fold_depth": 0.6, "fold_scale": 0.9, "fold_coarsen": 0.6, "velvet_sheen": 0.15,   // few broad pleats gathering at the rod, gently shaded — the aperture carries the contrast now, not the folds
    "fold_warp": 0.10,   // the pleats stand 10 cm out of the plane, so the cast dapples and the window bars S-bend across them (taste call; the visual pass owns the amplitude)
    "curtain_scatter": 0.4,   // two fifths of the transmit diffuses through the pile — the body glow wraps into the fold flanks instead of leaving them black (taste call; the visual pass owns it)
    // the window: 4 cm off the cloth, so its bars land sharp in the same frame the leaf-gaps stay soft (§4.9's
    // two-regimes image). Values are a taste call — the visual pass owns them.
    "mullion_tau": 2.5, "mullion_pitch_m": 0.35, "mullion_bar_m": 0.025, "mullion_depth_m": 0.04,
    // the APERTURE (§4.9): a 1.5 × 2.1 m sash centred just above waist height. Everything outside it is wall, lit
    // only by the room's own 3% front-side leak — the macro contrast the whole composition rests on, and the frame
    // that confines the bars. Also a taste call.
    "window_w_m": 1.5, "window_h_m": 2.1, "window_cx_m": 0, "window_cy_m": 1.3, "window_wall": 0.03,
    "view_extent_m": 3.2, "view_pitch_deg": 0, "view_fov_deg": 60, "view_yaw_deg": 0,
    "view_center_x": 0, "view_center_y": 1.3, "trunk_radius_m": 0.1, "far_smear": 0,
    // dimmer and less ambient than a floor look wants: the wall must go dark, so the exposure is set by the
    // aperture rather than by the average frame.
    "exposure": 1.4, "contrast": 1.0, "ambient_skylight": 0.5, "sky_turbidity": 0.06, "mesopic_strength": 0.5, "chromatic_aberration": 0, "tone_map": 2,
    "wind_pattern": "squally", "wind_strength": 1.2, "wind_gustiness": 0.25, "wind_direction_deg": 0, "gust_frequency": 0.13,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 3.28912362615405, "drift_auto": true, "drift_speed": 0.02,
    "auto_quality": true,   // faithful is the heavy path (per-sample geometry bake) — the governor keeps a weak device at 60, like park 1
  }),
  // 'tent 1' — komorebi on TENT NYLON (spec §4.9): the receiver's SECOND material instance. Same receiver, same
  // transmission law, same pleat field as 'curtain 1', aimed at the opposite corner of material space — thin
  // near-white nylon (high Tt, near-neutral dye, matte, heavy forward scatter) where the velvet is dark, saturated,
  // pile-sheened. Reference: photographed from inside a tent pitched under trees at a midday festival.
  // NO window and NO mullion grid (both left at their 0 gates): the tent stands UNDER the canopy, so the whole
  // cloth is lit and the field is continuous dapples — the aperture contrast 'curtain 1' rests on has nothing to do
  // with this scene, and the punch comes from exposure + a hot low-cloud sun instead.
  // WHY THE CLOTH SITS 4.5 m FROM THE GROVE: the dapple blur is (h − recvZ)·θ, and the reference lives almost
  // entirely in the PINHOLE regime — soft overlapping sun-images, no leaf resolves. A first cut at 0.8 m put the
  // whole crown in the shape regime (blur ~4 mm ≪ leaf gaps): a hard-edged contact print of every leaf, the
  // reviewed "acid dream". At ~4.5 m the blur scale is ~5 cm, so the canopy melts into blobs and only the grove's
  // NEAREST limbs (crown depth brings them metres closer) read as soft shapes — the sharp/soft split of the photo
  // comes from the tree's own depth spread, at the correct absolute scale.
  // FRAMING IS NUDGEABLE as on 'curtain 1': curtain distance + sun azimuth/elevation + the pan place the cast.
  'tent 1': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.5, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.9, "cloud_thickness": 0.16, "eclipse": false, "eclipse_amount": 0.42,
    // a low crown running well up: the band the analytic (layer-tier) woody occluder normalises against, written to
    // say what the faithful grove already is — limbs starting near tent height, foliage stacked metres over it.
    "layer_count": 4, "canopy_base_height_m": 2.6, "canopy_thickness_m": 3.6, "foliage_density": 2.0,
    // mid-density broadleaf with LOW limbs: shallow branch pitch spreads the arms out near the fabric instead of
    // sending them up, and a slightly positive droop trails the outer twigs back down toward it.
    // a WIDE grove: the reference has no naked-sun fabric anywhere — the canopy's cast must tile the whole cloth view, so
    // several overlapping crowns spread across a broad extent rather than one tree posing for a portrait.
    "tree_count": 6, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 46,
    "branch_length_ratio": 0.66, "branch_pitch_deg": 14, "branch_tau": 1.8, "leader_strength": 0.15, "droop": 0.14, "leaves_per_cluster": 28,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.14, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.3, "trans_g": 0.38, "trans_b": 0.2,   // MUTED gray-green: the reference's shade is pale neutral, not saturated leaf-green — on white nylon the mixing of many soft layers washes the hue out
    "canopy_extent_m": 10, "tex_resolution": 1024, "bake_resolution": 768,
    // midday: a high sun for the near-vertical drop down the cloth, held off the cloth's normal so the cast still
    // rakes a little and the fold flanks band (head-on, az 90°, incidence only foreshortens them — §4.9).
    "seed": 290626672, "sun_elevation_deg": 32, "sun_azimuth_deg": 62,
    // TENT receiver: the same vertical cloth as 'curtain 1', 4.5 m from the grove — pinhole regime for the
    // canopy, with only the crown-depth nearest limbs reading as soft shapes (see the distance note above).
    "receiver": 1, "standing_scene": true, "faithful_canopy": true,
    "curtain_distance_m": -4.5, "curtain_tt": 0.6, "curtain_tint_r": 0.92, "curtain_tint_g": 0.9, "curtain_tint_b": 0.82,
    "velvet_sheen": 0,   // MATTE — nylon has no pile, and the satin ridge glow is the one curtain cue that would break the read
    "curtain_scatter": 0.7,   // most of the transmit diffuses in the weave: shade lifts toward pale gray (never black), the glowy-haze half of the reference
    // LATERAL DIFFUSION (§4.9), the tier this look motivates: the wrap above softens each pixel's own fold, but only
    // this bleeds a hot dapple's glow ACROSS its cast-shadow edge — the reference's spotlight-versus-haze contrast.
    // The one look that opts into the expensive rung; 8 cm of bleed is about right for thin nylon. Both taste calls.
    "curtain_diffuse": 0.45, "curtain_diffuse_m": 0.07,
    // TAUT MEMBRANE — no folds at all. A pitched tent is stretched on poles: unlike the hanging curtain its surface
    // carries NO drape, and every bit of visible variation must come from the LIGHT (dapples, shade masses, bloom),
    // never from a fabric pattern (the reviewed failure: any periodic surface modulation on bright nylon reads as
    // printed wallpaper). fold_depth 0 also zeroes the pile-grain nap — thin nylon has no pile. Panel structure
    // (seams, poles, per-panel tilt) is the enclosure-geometry step, not a texture.
    "fold_scale": 0.45, "fold_coarsen": 0, "fold_warp": 0, "fold_depth": 0,
    "view_extent_m": 3.0, "view_pitch_deg": 0, "view_fov_deg": 60, "view_yaw_deg": 0,
    "view_center_x": 0, "view_center_y": 1.4, "trunk_radius_m": 0.06, "far_smear": 0,
    // brighter and more ambient than 'curtain 1': there is no dark wall to expose for, and the contrast lift is what
    // pushes the hot patches apart from the haze.
    "exposure": 1.35, "contrast": 1.3, "ambient_skylight": 0.9, "sky_turbidity": 0.04, "mesopic_strength": 0, "chromatic_aberration": 0, "tone_map": 2,
    "wind_pattern": "gusty", "wind_strength": 0.9, "wind_gustiness": 0.25, "wind_direction_deg": 0, "gust_frequency": 0.13,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 1.0472, "drift_auto": true, "drift_speed": 0.02,
    "auto_quality": true,   // faithful is the heavy path (per-sample geometry bake) — the governor keeps a weak device at 60, like park 1 and curtain 1
  }),
  // 'memories' — the §1 north-star look: a sparse early-spring grove (foliage 0.45, so individual leaves
  // still matter), clear sky (cloud 0), open branching (children 6, length 0.91, pitch 45°), bright exposure.
  'memories': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.61, "cloud_thickness": 0, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 4.2, "canopy_thickness_m": 2.6, "foliage_density": 0.45,
    "tree_count": 5, "branch_levels": 3, "branch_children": 6, "branch_angle_deg": 34,
    "branch_length_ratio": 0.91, "branch_pitch_deg": 45, "clusters_per_layer": 60, "leaves_per_cluster": 39,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.376, "trans_g": 0.247, "trans_b": 0.113, "canopy_extent_m": 7, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 35.964062500001056, "sun_azimuth_deg": 355.9855468749904,
    "view_extent_m": 3.1, "exposure": 3.01, "contrast": 1.23, "ambient_skylight": 0.93, "sky_turbidity": 0.05, "tone_map": 2, "view_pitch_deg": 24,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 5.568307189744262, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  'morning 1': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.61, "cloud_thickness": 0.39, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 4.2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 60, "leaves_per_cluster": 39,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.195, "canopy_extent_m": 7, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 29.5, "sun_azimuth_deg": 83,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "tone_map": 2, "chromatic_aberration": 0.10,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 4.8099656994860664, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  'morning 2': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.61, "cloud_thickness": 0.39, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 4.2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 60, "leaves_per_cluster": 39,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.21, "trans_g": 0.356, "trans_b": 0.113, "canopy_extent_m": 7, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 23, "sun_azimuth_deg": 164,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "sky_turbidity": 0.2, "mesopic_strength": 1, "tone_map": 2,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 4.97071372563982, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  'morning 3': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.05, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.72, "cloud_thickness": 0.18, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 4.2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 60, "leaves_per_cluster": 39,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.21, "trans_g": 0.356, "trans_b": 0.336, "canopy_extent_m": 7, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 30, "sun_azimuth_deg": 125.26438968275465,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "sky_turbidity": 0.05, "mesopic_strength": 0.6, "tone_map": 2,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 0.18025113743438262, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  // 'morning 3b' — morning 3's crisp clear-sky low sun pushed hard into diffraction (strength 6): the tight
  // pinhole sun-images split into full red/blue rims. Same topology as morning 3, so 3↔3b is a clean morph.
  'morning 3b': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.05, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.72, "cloud_thickness": 0.18, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 4.2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 60, "leaves_per_cluster": 39,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.21, "trans_g": 0.356, "trans_b": 0.336, "canopy_extent_m": 7, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 30, "sun_azimuth_deg": 125.26438968275465,
    "view_extent_m": 3.1, "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "sky_turbidity": 0.05, "mesopic_strength": 0.6, "tone_map": 2, "chromatic_aberration": 6.0,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 0.18025113743438262, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  // 'the void' — a dense 16-tree grove pulled wide (view 6.8 m), deep-green and low-sun.
  'the void': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.61, "cloud_thickness": 0.27, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 3, "canopy_base_height_m": 4.2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 16, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 60, "leaves_per_cluster": 39,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.21, "trans_g": 0.356, "trans_b": 0.113, "canopy_extent_m": 7, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 23, "sun_azimuth_deg": 164,
    "view_extent_m": 6.8, "exposure": 2.44, "contrast": 0.98, "ambient_skylight": 0.97, "sky_turbidity": 0.05, "mesopic_strength": 0.6, "tone_map": 2, "view_pitch_deg": 0,
    "wind_strength": 1.29, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 1.2709150851268554, "drift_auto": true, "drift_speed": 0.04,
    "auto_quality": true,
    "ground_r": 0.12, "ground_g": 0.16, "ground_b": 0.19,   // cool stone-grey floor
  }),
  // 'eclipse' — a single tree's gaps imaging a partially-eclipsed sun: every dapple becomes the same
  // crescent (the moon disk zeroes part of the source cloud). Tiny crisp source, low far-smear and dim
  // ambient keep the crescents sharp and eerie; only a barely-there wind stirs it (auto-drift off).
  'eclipse': Object.assign({}, DEFAULTS, {
    "sample_count": 48, "core_angular_radius_deg": 0.3, "halo_angular_radius_deg": 1,
    "core_weight_fraction": 1, "cloud_thickness": 0, "eclipse": true, "eclipse_amount": 0.6,
    "layer_count": 2, "canopy_base_height_m": 4.9, "canopy_thickness_m": 2.5, "foliage_density": 0.7,
    "tree_count": 1, "branch_levels": 4, "branch_children": 3, "branch_angle_deg": 49,
    "branch_length_ratio": 0.63, "branch_pitch_deg": 51, "clusters_per_layer": 60, "leaves_per_cluster": 49,
    "cluster_spread_m": 0.25, "leaf_size_m": 0.175, "leaf_aspect": 1.75, "max_tilt": 0.84, "edge_softness": 0.09,
    "trans_r": 0.488, "trans_g": 0.611, "trans_b": 0.494, "canopy_extent_m": 8.5, "tex_resolution": 1024,
    "seed": 290626672, "sun_elevation_deg": 19.5, "sun_azimuth_deg": 109.22399419024259,
    "view_extent_m": 4.2, "exposure": 2.1, "contrast": 0.98, "ambient_skylight": 0.4, "sky_turbidity": 0.05,
    "mesopic_strength": 0.6, "tone_map": 2, "ground_r": 0.33, "ground_g": 0.21, "ground_b": 0.12,
    "view_pitch_deg": 36, "view_fov_deg": 51, "far_smear": 1.0,
    "wind_strength": 0.4, "wind_direction_deg": 0, "gust_frequency": 0.04, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 21, "limb_flex": 0.39, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 0.5, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 5.430132496921517, "drift_auto": false, "drift_speed": 0.04,
    "auto_quality": true,
  }),
  /* 'test 1' / 'test 2' — hidden for now, kept for the future. Uncomment this block to restore them to the preset list.
  'test 1': Object.assign({}, DEFAULTS, {
    "sample_count": 21, "core_angular_radius_deg": 0.18, "halo_angular_radius_deg": 4.3,
    "core_weight_fraction": 1, "cloud_thickness": 0.27, "eclipse": false, "eclipse_amount": 0.55,
    "layer_count": 3, "canopy_base_height_m": 3.2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 82, "leaves_per_cluster": 59,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.3, "trans_g": 0.61, "trans_b": 0.5, "canopy_extent_m": 7, "tex_resolution": 2048,
    "seed": 290626672, "sun_elevation_deg": 57.61406249999991, "sun_azimuth_deg": 151.38398437500064,
    "view_extent_m": 6.2, "exposure": 1.44, "contrast": 1.22, "ambient_skylight": 1.33, "tone_map": 2,
    "wind_strength": 0, "wind_direction_deg": 30, "gust_frequency": 0.12, "gust_attack": 1.2, "gust_decay": 2.5,
    "sway_stiffness": 5, "sway_ceiling": 0.4, "damping_ratio": 0.25, "backlash_gain": 1, "sway_height_gain": 0,
    "limb_count": 8, "limb_flex": 0.25, "twig_flex": 0.35, "stem_length": 0.5, "leaf_swing": 0.7, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 3.6079756994865377, "drift_auto": true, "drift_speed": 0.08,
    "auto_quality": false,
  }),
  'test 2': Object.assign({}, DEFAULTS, {
    "sample_count": 21, "core_angular_radius_deg": 0.18, "halo_angular_radius_deg": 4.3,
    "core_weight_fraction": 1, "cloud_thickness": 0.27, "eclipse": false, "eclipse_amount": 0.55,
    "layer_count": 3, "canopy_base_height_m": 3.2, "canopy_thickness_m": 2.6, "foliage_density": 1.65,
    "tree_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 34,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 26, "clusters_per_layer": 82, "leaves_per_cluster": 59,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.1, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.29, "trans_g": 0.61, "trans_b": 0.466, "canopy_extent_m": 7, "tex_resolution": 2048,
    "seed": 290626672, "sun_elevation_deg": 90, "sun_azimuth_deg": 360,
    "view_extent_m": 6.2, "exposure": 1.44, "contrast": 1.22, "ambient_skylight": 1.33, "tone_map": 2,
    "wind_strength": 1.34, "wind_direction_deg": 30, "gust_frequency": 0.125, "gust_attack": 1.2, "gust_decay": 2.5,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.25, "backlash_gain": 1, "sway_height_gain": 1.6,
    "limb_count": 8, "limb_flex": 0.25, "twig_flex": 0.35, "stem_length": 0.5, "leaf_swing": 0.7, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 3.0914450851278223, "drift_auto": true, "drift_speed": 0.08,
    "auto_quality": false,
  }),
  */
};

// ---- TREE_SPECIES (spec §4.5): named SHAPE bundles, the inverse of WIND_PATTERNS — each a partial set of the
// growth/shape knobs (leader, droop, taper, crown_aspect, phyllotaxis + the structural knobs). The editor merges
// the chosen bundle OVER the current look's params (shape ⟂ scene: lighting/camera/wind are untouched), stamps
// `tree_species` as an inert label, and rebuilds. So one click turns the standing tree into an oak / spruce /
// willow on whatever scene you're in. Values are starting points to tune; built from the tree-architecture
// research (apical control, gravitropic droop, pipe-model taper, phyllotaxis). ----
export const TREE_SPECIES = {
  // decurrent dome: low leader → forks low into a few heavy arms, broad rounded, stout slow-thinning wood
  'oak':      { leader_strength:0.12, droop:-0.04, taper_delta:2.4, crown_aspect:0.8, phyllotaxis:'spiral',
                branch_levels:4, branch_children:3, limb_count:5, branch_angle_deg:48, branch_pitch_deg:30, branch_length_ratio:0.62, foliage_density:1.7, leaf_size_m:0.12 },
  // excurrent cone: strong central leader, near-horizontal whorled tiers shortening to the apex, secondary droop
  'spruce':   { leader_strength:0.92, droop:0.22, taper_delta:2.0, crown_aspect:1.9, phyllotaxis:'whorled',
                branch_levels:3, branch_children:3, limb_count:9, branch_angle_deg:22, branch_pitch_deg:12, branch_length_ratio:0.6, foliage_density:1.8, leaf_size_m:0.07 },
  // slender monopodial, lacy fast-thinning periphery, fine outer twigs trailing down
  'birch':    { leader_strength:0.85, droop:0.25, taper_delta:2.7, crown_aspect:1.3, phyllotaxis:'spiral',
                branch_levels:4, branch_children:3, limb_count:7, branch_angle_deg:34, branch_pitch_deg:46, branch_length_ratio:0.64, foliage_density:1.3, leaf_size_m:0.13 },
  // weeping fountain: low leader, scaffolds rise then long whips cascade down
  'willow':   { leader_strength:0.2, droop:0.45, taper_delta:2.4, crown_aspect:0.95, phyllotaxis:'spiral',
                branch_levels:4, branch_children:3, limb_count:7, branch_angle_deg:30, branch_pitch_deg:32, branch_length_ratio:0.78, foliage_density:1.5, leaf_size_m:0.11 },
  // opposite/decussate: a leader carrying stacked symmetric Y-forks (the maple/ash candelabra)
  'maple':    { leader_strength:0.45, droop:-0.05, taper_delta:2.2, crown_aspect:1.0, phyllotaxis:'opposite',
                branch_levels:4, branch_children:3, limb_count:3, branch_angle_deg:26, branch_pitch_deg:52, branch_length_ratio:0.72, foliage_density:1.5, leaf_size_m:0.13 },
  // fastigiate column (Lombardy poplar / Italian cypress): strong leader, steep near-parallel branches, tall-narrow
  'columnar': { leader_strength:0.9, droop:-0.1, taper_delta:2.0, crown_aspect:1.8, phyllotaxis:'spiral',
                branch_levels:3, branch_children:3, limb_count:12, branch_angle_deg:14, branch_pitch_deg:78, branch_length_ratio:0.6, foliage_density:2.0, leaf_size_m:0.12 },
  // a tall bare stipe with a crown of arching fronds up top — a strong leader (so it gets a real TRUNK, not the
  // legacy single-hub stub), fronds (level-1, terminal) attaching high and arching down, constant-thickness stipe.
  // Intentionally the sparsest: ~14 distinct fronds (branch_levels 1), so it leans on big leaves for shadow presence.
  'palm':     { leader_strength:0.85, droop:0.55, taper_delta:1.3, crown_aspect:1.3, phyllotaxis:'spiral',
                branch_levels:1, branch_children:1, limb_count:14, branch_angle_deg:18, branch_pitch_deg:60, branch_length_ratio:1.0, foliage_density:1.4, leaf_size_m:0.20 },
};
