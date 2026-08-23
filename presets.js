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
  // 'canopy 1' — THE HAMMOCK (spec §4.9, sky view). Lying on your back at a festival: tall trunks converging
  // overhead, crowns lit from behind against a bright sky, the whole grove leaning together on the gusts. It is
  // 'park 1's afternoon with the eyes turned the other way — same physics, read along the eye's rays instead of the
  // sun's — so there is no receiver at all here and the whole fabric/ground family switches itself off.
  // THE FRAME MUST BE MOSTLY LUMINOUS. Look up through a grove in daylight and almost nothing is black: bright sky
  // between the crowns, and the crowns with sun on them GLOWING green-gold, brighter than the shaded ones beside
  // them. Silhouette is the exception — the trunks, and the deepest stacks. Every number below serves that.
  // EVERY NUMBER IS A STARTING POINT: none of this has been seen on a GPU.
  // WHAT EACH LOAD-BEARING CHOICE SERVES:
  //  • sky_scatter 0.5 is what makes a crown a light source instead of a filter (§4.9). Derived against the Look's
  //    tail rather than dialled: at ambient 1.5 / exposure 1.3 it puts open sky at sRGB (176,202,229), a crown one
  //    leaf-layer thick at (183,211,179), two layers at (108,190,83) and four at (45,155,41) — luminous all the way
  //    down, green-gold in the middle depths, and never black. At sky_scatter 0 under the SAME light those fall to
  //    (85,160,127), (33,111,36) and (7,43,4): a stencil. A trunk over open sky reads (46,64,102), which is what
  //    "silhouette is the exception" has to mean.
  //  • the LEAF TRANSMITTANCE carries the colour, not the scatter knob: (0.26, 0.50, 0.16) is a chlorophyll green
  //    where the old muted gray-green had nothing for the glow to be made of. The scatter term normalizes it to unit
  //    peak (§3.5), so this sets the HUE of the glow and sky_scatter sets its level.
  //  • the GROVE is a near-conifer: leader 0.85 sends limbs up a continuing bole (the tall bare trunks that converge
  //    are the reference's whole structure), crown_aspect 1.6 stretches them, droop −0.2 upsweeps the branches and
  //    branch_pitch 30 keeps them climbing rather than reaching out. branch_tau 2.2 with a 0.14 m trunk makes that
  //    wood actually read — in this view the analytic occluder is not a shadow, it IS the columns. The FINE wood
  //    (level ≥ 2) now stamps into the seen layers too, so the leaves hang on visible twigs (§4.9).
  //  • ANGULAR COVERAGE is the arithmetic this view adds, and it is about the GROVE's reach, not the box's. A grove
  //    of plan reach R is FULL above elevation atan(h_top/R) and thins from there down to atan(h_base/R), below
  //    which it is open sky. Here Rfill = 9 m (view_extent_m, since it is under canopy_extent·0.46) and
  //    crown0 = 1.7·Rfill/√trees = 5.78 m, so R = 14.8 m: full above 34.1°, thinning from 15.1°. A zenith gaze
  //    through a 60° lens on 16:9 reaches 40.3° at its corners, so the WHOLE frame sits in the full band with ~6° to
  //    spare and no baked-box edge can show. canopy_extent_m 34 is then just the box that has to CONTAIN that grove
  //    (the widest crowns reach 16.5 m).
  //  • limb_count 8 is not a shape choice, it is the OCCLUDER BUDGET. In this camera the trunks are not a shadow,
  //    they ARE the structure, and the analytic occluder holds 64 segments — one per level-1 limb plus one bole per
  //    tree. Seven trees at 11 limbs is 84, so five trees would have drawn wood and two would have had none; at 8 it
  //    is 63 and every tree keeps its trunk. (|droop| under 0.3 matters here too: past it a limb splits into
  //    sub-segments and spends more than one.)
  //  • tree_count 7 is what opens real sky BETWEEN the crowns. Total crown area over covered area is
  //    2.89/(1+1.7/√n)²: 1.30 at twelve trees — solidly tiled — against 1.07 at seven, which is barely covering, so
  //    the gaps are the grove's own and not the edge of the model.
  //  • the SUN is off-centre by design (az 140 against yaw 0): the disk should sit away from the middle of the frame
  //    so the composition is canopy-with-a-sun-in-it, not a lens-flare portrait. cloud 0.2 gives it a small aureole
  //    without draining the disk. Elevation 55 keeps it well inside a 60° lens pointed at the zenith.
  //  • the WIND is the soul: sway_height_gain 1.6 puts the crowns on long levers so a gust leans the whole grove
  //    together — §5.1's coherent band, watched directly for the first time instead of read off a floor pattern.
  //  • curtain_diffuse is the eye's VEILING GLARE here, not a weave (§4.9). With view_extent_m 9 the pair below is
  //    about an 11 px radius on a 1000-tall frame — a screen-space number, so re-judge it if either knob moves, and
  //    re-judge it against the twigs, which are the finest thing in the frame for it to smear.
  //  • exposure 1.3 / contrast 1.0: the sun clips to white and must, and any contrast above 1 clips the backlit
  //    leaves to black (the 'tent 1' finding — the tail stretches about 0.5).
  'canopy 1': Object.assign({}, DEFAULTS, {
    "sky_view": true, "standing_scene": false, "faithful_canopy": false,   // sky view forces the layer tier anyway (no cast frame to pre-bake into) — written false to say so
    "sky_scatter": 0.5,
    "sample_count": 32, "core_angular_radius_deg": 0.27, "halo_angular_radius_deg": 6,
    "core_weight_fraction": 0.95, "cloud_thickness": 0.2, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 4, "canopy_thickness_m": 6, "foliage_density": 1.4,
    "tree_count": 7, "limb_count": 8, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 38,
    "branch_length_ratio": 0.66, "branch_pitch_deg": 30, "branch_tau": 2.2, "leader_strength": 0.85, "droop": -0.2,
    "crown_aspect": 1.6, "leaves_per_cluster": 26, "cluster_spread_m": 0.28, "leaf_size_m": 0.13, "leaf_aspect": 1.75,
    "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.5, "trans_b": 0.16,   // chlorophyll: the glow's hue comes from here, normalized to unit peak by the scatter term
    "canopy_extent_m": 34, "tex_resolution": 1024, "bake_resolution": 1536,   // 34 m over 1536 is 2.2 cm/texel — a 0.13 m leaf is 6 texels across, and leaf silhouettes ARE the picture here
    "seed": 290626672, "sun_elevation_deg": 55, "sun_azimuth_deg": 140,
    "view_extent_m": 9, "view_pitch_deg": 90, "view_fov_deg": 60, "view_yaw_deg": 0,
    "view_center_x": 0, "view_center_y": 0, "trunk_radius_m": 0.14, "far_smear": 0,
    "exposure": 1.3, "contrast": 1.0, "ambient_skylight": 1.5, "sky_turbidity": 0.05, "mesopic_strength": 0, "chromatic_aberration": 0, "tone_map": 2,
    "curtain_diffuse": 0.35, "curtain_diffuse_m": 0.1,   // the eye's veiling glare around the sun, through the gaps (§4.9)
    "wind_pattern": "gusty", "wind_strength": 1.3, "wind_gustiness": 0.3, "wind_direction_deg": 0, "gust_frequency": 0.11,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 1.6,
    "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 2.1, "drift_auto": true, "drift_speed": 0.02,
    "auto_quality": true,   // the layer tier is the cheap path, but seven trees over a 1536 bake plus the three glare passes is real work
  }),
  // ---- THE CANOPIES, 2-4. Three siblings of 'canopy 1', each keyed to ONE look-up photograph's structural
  // identity. The GEOMETRY and the SPECIES are authored to the reference; the LIGHT is coarse and every level in it
  // is a TASTE CALL for the slider pass. NONE of these has been seen on a GPU.
  // Three pieces of arithmetic bind all of them, and they are the reason the numbers look odd next to a floor look:
  //  (1) COVERAGE. A grove of plan reach R is a FULL canopy above elevation atan(h_top/R), thins from there down to
  //      atan(h_base/R) as the upper layers fall outside it, and is open sky below that. R = Rfill + crown0, with
  //      Rfill = min(canopy_extent·0.46, view_extent_m) and crown0 = 1.7·Rfill/√trees. A tall canopy therefore needs
  //      a WIDE grove, and view_extent_m — which frames nothing in this camera — is the knob that sets it.
  //  (2) THE BOX MUST CONTAIN THE GROVE. The widest crowns reach Rfill + 1.3·crown0 (the per-tree size jitter), and
  //      canopy_extent_m has to be at least twice that or the outer crowns are clipped by the bake's own edge.
  //  (3) THE ANALYTIC OCCLUDER HOLDS 64 SEGMENTS. In this camera the trunks are not a shadow, they ARE the picture,
  //      and each tree spends limb_count + 1 of those 64 (one per level-1 limb, one for the bole; keep |droop| under
  //      0.3 or a limb splits into sub-segments and spends more). Past 64 the later trees lose their wood entirely.
  //      So a look whose subject is trunks must trade limbs for trees: 14 culms cost 3 limbs each, and no more.
  // 'canopy 2' — BAMBOO. Standing in a grove of it looking up the culms: dozens of thin pale verticals, close enough
  // to touch, running up out of frame against a brilliant sky, with the leaves only in a thin layer far overhead.
  // The TRUNKS are the subject here, which is the whole reason for the numbers: 14 trees at 3 limbs each is 56 of
  // the occluder's 64 segments, so every culm draws. branch_tau 3.2 makes them read as solid wood (transmittance
  // 0.04) rather than as haze, and a 0.04 m radius keeps them thin. leader_strength 1 runs the bole all the way to
  // the foliage apex — a culm, not a trunk with a crown on it — and crown_aspect 3 with a 62° branch pitch keeps
  // what little foliage there is climbing rather than reaching out. The camera is pitched 58° rather than at the
  // zenith on purpose: near the zenith the culms converge on a point like spokes, and this look wants them PARALLEL.
  // Coverage: Rfill 8 m and crown0 3.63 give a reach of 11.6 m, so the canopy is full above 50°, thins from 43°, and
  // is open below it — and the frame runs 13° to 90°. Most of the picture is therefore honest open sky between the
  // culms, which is the composition.
  'canopy 2': Object.assign({}, DEFAULTS, {
    "sky_view": true, "standing_scene": false, "faithful_canopy": false,
    "sky_scatter": 0.45,
    "sample_count": 32, "core_angular_radius_deg": 0.27, "halo_angular_radius_deg": 5,
    "core_weight_fraction": 0.95, "cloud_thickness": 0.08, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 11, "canopy_thickness_m": 3, "foliage_density": 0.55,
    "tree_count": 14, "limb_count": 3, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 18,
    "branch_length_ratio": 0.62, "branch_pitch_deg": 62, "branch_tau": 3.2, "leader_strength": 1, "droop": 0,
    "crown_aspect": 3, "leaves_per_cluster": 18, "cluster_spread_m": 0.22, "leaf_size_m": 0.09, "leaf_aspect": 3.4,
    "max_tilt": 0.5, "edge_softness": 0.26,
    "trans_r": 0.34, "trans_g": 0.52, "trans_b": 0.14,   // bamboo is a YELLOW-green: more red than a pine, and the glow takes its hue from here
    "canopy_extent_m": 26, "tex_resolution": 1024, "bake_resolution": 1536,   // 1.7 cm/texel
    "seed": 290626672, "sun_elevation_deg": 78, "sun_azimuth_deg": 150,
    "view_extent_m": 8, "view_pitch_deg": 58, "view_fov_deg": 52, "view_yaw_deg": 0,
    "view_center_x": 0, "view_center_y": 0, "trunk_radius_m": 0.04, "far_smear": 0,
    "exposure": 1.35, "contrast": 1.0, "ambient_skylight": 2.0, "sky_turbidity": 0.04, "mesopic_strength": 0, "chromatic_aberration": 0, "tone_map": 2,
    "curtain_diffuse": 0.2, "curtain_diffuse_m": 0.08,
    "wind_pattern": "gusty", "wind_strength": 1.1, "wind_gustiness": 0.35, "wind_direction_deg": 0, "gust_frequency": 0.16,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 2.2, "sway_ceiling": 0.4, "damping_ratio": 0.5, "backlash_gain": 1, "sway_height_gain": 1.6,
    "limb_flex": 0.35, "twig_flex": 0.3, "stem_length": 0.14, "leaf_swing": 1.5, "flutter_freq": 1.8,
    "drift_amount": 0.12, "drift_phase": 0.7, "drift_auto": true, "drift_speed": 0.03,
    "auto_quality": true,
  }),
  // 'canopy 3' — THE RED-PINE COLONNADE. Walking a lane of old pines and tipping your head back: long bare boles
  // going up like columns, the crowns only in the top third, and the lane itself running off across the frame.
  // The gaze is pitched 62° rather than at the zenith so the boles keep their length and the lane keeps its depth;
  // the yaw runs the colonnade across frame rather than straight away from you (a taste call — it is the one knob
  // here that is pure composition). canopy_base_height_m 14 against a 5 m crown band is what confines the foliage
  // to the top: the analytic occluder's boles run 0 to 14 m of bare wood under it. Six trees at 6 limbs is 42 of the
  // 64 occluder segments. Coverage: reach 18.6 m gives a full canopy above 46°, thinning from 37°, against a frame
  // that runs 12° to 90° — so the bottom of the picture is open sky down the lane, which is the depth cue the
  // reference is built on, and the crowns close over only near the top.
  'canopy 3': Object.assign({}, DEFAULTS, {
    "sky_view": true, "standing_scene": false, "faithful_canopy": false,
    "sky_scatter": 0.55,
    "sample_count": 32, "core_angular_radius_deg": 0.3, "halo_angular_radius_deg": 6,
    "core_weight_fraction": 0.92, "cloud_thickness": 0.25, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 14, "canopy_thickness_m": 5, "foliage_density": 1.6,
    "tree_count": 6, "limb_count": 6, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 55,
    "branch_length_ratio": 0.7, "branch_pitch_deg": 8, "branch_tau": 2.6, "leader_strength": 0.75, "droop": 0.15,
    "crown_aspect": 0.8, "leaves_per_cluster": 30, "cluster_spread_m": 0.3, "leaf_size_m": 0.16, "leaf_aspect": 2.6,
    "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.2, "trans_g": 0.42, "trans_b": 0.14,   // pine needles: darker and bluer than a broadleaf
    "canopy_extent_m": 42, "tex_resolution": 1024, "bake_resolution": 1536,   // 2.7 cm/texel
    "seed": 290626672, "sun_elevation_deg": 40, "sun_azimuth_deg": 200,
    "view_extent_m": 11, "view_pitch_deg": 62, "view_fov_deg": 60, "view_yaw_deg": 35,
    "view_center_x": 0, "view_center_y": 0, "trunk_radius_m": 0.22, "far_smear": 0,
    "exposure": 1.35, "contrast": 1.0, "ambient_skylight": 1.6, "sky_turbidity": 0.06, "mesopic_strength": 0, "chromatic_aberration": 0, "tone_map": 2,
    "curtain_diffuse": 0.3, "curtain_diffuse_m": 0.1,
    "wind_pattern": "squally", "wind_strength": 1.2, "wind_gustiness": 0.28, "wind_direction_deg": 0, "gust_frequency": 0.1,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.4,
    "sway_stiffness": 1.0, "sway_ceiling": 0.4, "damping_ratio": 0.6, "backlash_gain": 1, "sway_height_gain": 1.6,
    "limb_flex": 0.22, "twig_flex": 0.2, "stem_length": 0.2, "leaf_swing": 1.2, "flutter_freq": 1.2,
    "drift_amount": 0.12, "drift_phase": 1.8, "drift_auto": true, "drift_speed": 0.02,
    "auto_quality": true,
  }),
  // 'canopy 4' — THE RAINFOREST ZENITH. Flat on your back on the forest floor, looking straight up: enormous dark
  // trunks running in from every side and meeting overhead like spokes, dense crowns closing over them, and a sky
  // so bright and so hazy it has no colour left. Everything in frame is a silhouette against it.
  // This is the one look in the series where sky_scatter is DELIBERATELY LOW (0.12). The glow term exists to keep a
  // canopy from being a stencil, and here the picture IS a stencil — a crown against a near-white sky reads as a
  // dark mass, and turning the glow up would drain the contrast the whole composition is made of.
  // The sky is whitened by TURBIDITY, not by exposure: sky_turbidity 0.45 desaturates the Rayleigh spectrum toward
  // white and warms the beam to (1.00, 0.85, 0.62), where raising exposure alone would only clip the blue.
  // Coverage is the tightest in the series, because a tall canopy under a wide lens is the hardest case: a reach of
  // 23.7 m puts the full canopy above 44° and the thinning edge at 34°, against frame corners at 36° — so the crowns
  // close over the middle of the frame and thin at its very corners, which is what a real canopy does. That is why
  // view_extent_m is 14 and the box is 54 m: neither frames anything, both exist to make the grove wide enough.
  'canopy 4': Object.assign({}, DEFAULTS, {
    "sky_view": true, "standing_scene": false, "faithful_canopy": false,
    "sky_scatter": 0.12,
    "sample_count": 32, "core_angular_radius_deg": 0.4, "halo_angular_radius_deg": 8,
    "core_weight_fraction": 0.7, "cloud_thickness": 0.55, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 16, "canopy_thickness_m": 7, "foliage_density": 2.2,
    "tree_count": 6, "limb_count": 5, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 48,
    "branch_length_ratio": 0.72, "branch_pitch_deg": 18, "branch_tau": 3, "leader_strength": 0.6, "droop": 0.25,
    "crown_aspect": 1, "leaves_per_cluster": 34, "cluster_spread_m": 0.34, "leaf_size_m": 0.22, "leaf_aspect": 1.6,
    "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.16, "trans_g": 0.3, "trans_b": 0.12,   // thick tropical leaves pass little: the crowns are meant to go dark
    "canopy_extent_m": 54, "tex_resolution": 1024, "bake_resolution": 2048,   // 2.6 cm/texel over the widest box in the set
    "seed": 290626672, "sun_elevation_deg": 70, "sun_azimuth_deg": 120,
    "view_extent_m": 14, "view_pitch_deg": 90, "view_fov_deg": 68, "view_yaw_deg": 0,
    "view_center_x": 0, "view_center_y": 0, "trunk_radius_m": 0.3, "far_smear": 0,
    "exposure": 1.3, "contrast": 1.0, "ambient_skylight": 3, "sky_turbidity": 0.45, "mesopic_strength": 0, "chromatic_aberration": 0, "tone_map": 2,
    "curtain_diffuse": 0.3, "curtain_diffuse_m": 0.12,
    "wind_pattern": "lazy", "wind_strength": 0.7, "wind_gustiness": 0.2, "wind_direction_deg": 0, "gust_frequency": 0.07,
    "weather_variability": 0.2, "weather_speed": 1, "gust_attack": 1.6, "gust_decay": 2.4,
    "sway_stiffness": 0.8, "sway_ceiling": 0.4, "damping_ratio": 0.7, "backlash_gain": 1, "sway_height_gain": 1.6,
    "limb_flex": 0.2, "twig_flex": 0.18, "stem_length": 0.22, "leaf_swing": 1.0, "flutter_freq": 0.9,
    "drift_amount": 0.1, "drift_phase": 2.6, "drift_auto": true, "drift_speed": 0.015,
    "auto_quality": true,
  }),
  // 'curtain 1' — sunlit sheer cotton, the plant at the glass (spec §4.9). A thin bright curtain (high Tt,
  // warm dye) in a dark room: one huge window (4.5 x 3.05 m, wall 0 = black surround), a faint translucent
  // mullion grid, and the grove nearly TOUCHING the cloth (0.6 m) so the cast is crisp botanical shadow-play —
  // the near-contact shape regime, wanted here: leaves print as leaves and the deep fold warp S-bends them.
  // Matte broad pleats (sheen ~0), tight strong glow, low warm sun far off-axis so the flanks split lit/dark.
  // Hand-tuned by the author; the grove seed is its own (938460877, 4 trees).
  'curtain 1': Object.assign({}, DEFAULTS, {
    "sample_count": 29, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.88, "cloud_thickness": 0.28, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 2, "canopy_thickness_m": 1.6, "foliage_density": 1.4,
    "tree_count": 4, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 41,
    "branch_length_ratio": 0.68, "branch_pitch_deg": 20, "branch_tau": 2.15, "leader_strength": 0.15, "droop": -0.23, "leaves_per_cluster": 20,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.16, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6.5, "tex_resolution": 1024, "bake_resolution": 768,
    "seed": 938460877, "sun_elevation_deg": 13, "sun_azimuth_deg": 62,
    "receiver": 1, "standing_scene": true, "faithful_canopy": true,
    "curtain_distance_m": 0.6, "curtain_tt": 0.78, "curtain_tint_r": 0.45, "curtain_tint_g": 1, "curtain_tint_b": 0.28,
    "fold_depth": 0.38, "fold_scale": 0.6, "fold_coarsen": 0.22, "fold_warp": 0.28, "velvet_sheen": 0.02,
    "curtain_scatter": 0.42, "curtain_diffuse": 0.74, "curtain_diffuse_m": 0.035,
    "mullion_tau": 0.7, "mullion_pitch_m": 0.44, "mullion_bar_m": 0.032, "mullion_depth_m": 0.04,
    "window_w_m": 4.5, "window_h_m": 3.05, "window_cx_m": 0, "window_cy_m": 1.3, "window_wall": 0,
    "view_extent_m": 4.69, "view_pitch_deg": 19, "view_fov_deg": 60, "view_yaw_deg": -118.85,
    "view_center_x": 0, "view_center_y": 1.3, "trunk_radius_m": 0.1, "far_smear": 0,
    "exposure": 1.4, "contrast": 1, "ambient_skylight": 0.5, "sky_turbidity": 0.06, "mesopic_strength": 0.5, "chromatic_aberration": 0, "tone_map": 2,
    "wind_pattern": "squally", "wind_strength": 1.2, "wind_gustiness": 0.25, "wind_direction_deg": 0, "gust_frequency": 0.13,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 2.43, "drift_auto": true, "drift_speed": 0.02,
    "auto_quality": true,
  }),
  // 'curtain 2' — the same room at BLUE HOUR. curtain 1's grove, seed and window, so the pair live-morphs;
  // what changes is the hour and the cloth. The sun sinks to 7 deg and reddens through haze; the fabric is
  // near-white VOILE (Tt 0.85, neutral tint — at dusk the LIGHT carries the colour); the grove steps back to
  // 1.8 m so BOTH regimes share the frame (near limbs crisp, crown melted soft — §3.2); the glow widens into
  // bloom and the Purkinje shift runs deep: hot gold sun-blobs floating on rod-blue dim cloth. Lazy last-light
  // wind. Authored as the direction's next step; every number is a starting point.
  'curtain 2': Object.assign({}, DEFAULTS, {
    "sample_count": 29, "core_angular_radius_deg": 0.56, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.88, "cloud_thickness": 0.22, "eclipse": false, "eclipse_amount": 0.42,
    "layer_count": 4, "canopy_base_height_m": 2, "canopy_thickness_m": 1.6, "foliage_density": 1.4,
    "tree_count": 4, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 41,
    "branch_length_ratio": 0.68, "branch_pitch_deg": 20, "branch_tau": 2.15, "leader_strength": 0.15, "droop": -0.23, "leaves_per_cluster": 20,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.16, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.26, "trans_g": 0.356, "trans_b": 0.001, "canopy_extent_m": 6.5, "tex_resolution": 1024, "bake_resolution": 768,
    "seed": 938460877, "sun_elevation_deg": 7, "sun_azimuth_deg": 55,
    "receiver": 1, "standing_scene": true, "faithful_canopy": true,
    "curtain_distance_m": 1.8, "curtain_tt": 0.85, "curtain_tint_r": 0.95, "curtain_tint_g": 0.97, "curtain_tint_b": 1,
    "fold_depth": 0.3, "fold_scale": 0.5, "fold_coarsen": 0.22, "fold_warp": 0.34, "velvet_sheen": 0,
    "curtain_scatter": 0.5, "curtain_diffuse": 0.8, "curtain_diffuse_m": 0.05,
    "mullion_tau": 0.55, "mullion_pitch_m": 0.44, "mullion_bar_m": 0.032, "mullion_depth_m": 0.04,
    "window_w_m": 4.5, "window_h_m": 3.05, "window_cx_m": 0, "window_cy_m": 1.3, "window_wall": 0,
    "view_extent_m": 4.69, "view_pitch_deg": 19, "view_fov_deg": 60, "view_yaw_deg": -118.85,
    "view_center_x": 0, "view_center_y": 1.3, "trunk_radius_m": 0.1, "far_smear": 0,
    "exposure": 1.5, "contrast": 1, "ambient_skylight": 0.42, "sky_turbidity": 0.12, "mesopic_strength": 0.85, "chromatic_aberration": 0, "tone_map": 2,
    "wind_pattern": "lazy", "wind_strength": 0.85, "wind_gustiness": 0.25, "wind_direction_deg": 0, "gust_frequency": 0.13,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    "limb_count": 11, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 2.43, "drift_auto": true, "drift_speed": 0.02,
    "auto_quality": true,
  }),
  // 'tent 1' — komorebi from INSIDE a tent (spec §4.9): the ENCLOSURE receiver, receiver 2, now a CLOSED tent.
  // Reference: a NEMO Dragonfly 2P pitched under trees, photographed from inside lying down.
  // THE TWO EARLIER ROUNDS, HONESTLY. First it spent two tuning passes on the flat vertical curtain, which no preset
  // could rescue: a plane has ONE normal, so every part of it takes the light at the same angle, and the reference's
  // whole structure is one panel bright while the next is dim. Then it spent one on an infinite A-frame, which was
  // rejected as "inside an infinite triangle looking toward the infinite — an old-school boy-scout tent". The
  // diagnosis was not the silhouette: an infinite ridge converges to a VANISHING POINT and a real tent converges to
  // FLATNESS, a wall at a finite distance with an edge you can see. Then the bell version, at real dimensions, drew
  // the third: "it feels like a church / a barn — the roof is too flat; the real tent is much more rounded". Flat
  // facets plus a dark rib at every junction is how a stone vault is built, and the Dragonfly is neither — it is
  // tensioned fabric on PRE-BENT pole arcs. So each side is now one smooth ARCH (a convex profile curve sampled as
  // four tangent strips, shaded off the profile's own normal so the light rolls off it continuously), the seams draw
  // only at real POLE LINES, and the far end is ONE triangle. At this framing the frame comes out ~35 % / 35 % the
  // two arches, 17 % crown, 13 % the far triangle — the verdict's own description of the shape.
  // Same cloth as 'curtain 1' at the opposite corner of material space: thin near-white nylon (high Tt, near-neutral
  // dye, matte, heavy forward scatter) where the velvet is dark, saturated, pile-sheened. NO window and NO mullion
  // grid — both are curtain-only and the engine gates them off here anyway; the tent stands UNDER the canopy, so
  // every panel is lit and the field is continuous dapples.
  // BOTH §3.2 REGIMES, from the tree's own depth spread: the panels sit 0.5–1.7 m from the eye under a canopy banded
  // 2.6–6.2 m up, so the dapple blur (h − recvZ)·θ runs ~2–5 cm — pinhole, soft overlapping sun-images — while the
  // grove's lowest limbs, metres nearer, keep soft shape. The crossover is set purely by occluder distance.
  // EVERY NUMBER BELOW IS A STARTING POINT for a pass on the real thing — none of it has been seen on a GPU.
  // Three specific things to look at first: (a) the arch's roundness now lives entirely in the SHADING — the
  // silhouette is still four tangent strips per side, standing at most ~1 cm outside the true curve at these
  // dimensions — so if a side still reads flat it is the light, not the geometry: tent_shoulder_w_m is the bulge
  // knob and sun_azimuth_deg decides how much of the roll-off you can see; (b) the far side is deeply shaded at
  // this sun and carries little dapple — real for a sun this far off to one side, but sun_azimuth_deg trades that
  // evenness back for dapple on both sides; (c) the floor-of-shade block below;
  // (d) the cast read stays inside the 10 m baked canopy, with only the far bottom corner grazing its edge —
  // canopy_extent_m is the lever if that corner shows.
  'tent 1': Object.assign({}, DEFAULTS, {
    "sample_count": 32, "core_angular_radius_deg": 0.5, "halo_angular_radius_deg": 4.8,
    "core_weight_fraction": 0.9, "cloud_thickness": 0.16, "eclipse": false, "eclipse_amount": 0.42,
    // a low crown running well up: 2.6–6.2 m clears the 1.15 m ridge by a comfortable margin, so the tent really is
    // UNDER the canopy. On the layer tier this band is also what the leaves are binned into and what the analytic
    // woody occluder normalises against — one band, both jobs, which is why it is written out.
    "layer_count": 4, "canopy_base_height_m": 2.6, "canopy_thickness_m": 3.6, "foliage_density": 2.0,
    // mid-density broadleaf with LOW limbs: shallow branch pitch spreads the arms out near the fabric instead of
    // sending them up, and a slightly positive droop trails the outer twigs back down toward it.
    // a WIDE grove, and it now stands AROUND the tent rather than in front of a wall: the reference has no naked-sun
    // fabric anywhere, so the cast must tile both panels in every direction — several overlapping crowns across a
    // broad extent, not one tree posing for a portrait.
    "tree_count": 6, "branch_levels": 3, "branch_children": 3, "branch_angle_deg": 46,
    "branch_length_ratio": 0.66, "branch_pitch_deg": 14, "branch_tau": 1.8, "leader_strength": 0.15, "droop": 0.14, "leaves_per_cluster": 28,
    "cluster_spread_m": 0.28, "leaf_size_m": 0.14, "leaf_aspect": 1.75, "max_tilt": 0.54, "edge_softness": 0.26,
    "trans_r": 0.34, "trans_g": 0.4, "trans_b": 0.26,   // MUTED gray-green, and PALER than the curtain's: the reference's shade is pale neutral, not saturated leaf-green — on white nylon the mixing of many soft layers washes the hue out, and a leaf that passes more light is half of keeping the shade off the floor (below)
    "canopy_extent_m": 10, "tex_resolution": 1024, "bake_resolution": 768,
    // MIDDAY, and standing OFF one side of the ridge. Elevation 55° drops the canopy's cast almost straight down
    // onto the panels the way the reference's does; azimuth 205° (with view_yaw 0, so the ridge runs along +Y) puts
    // the sun well out of the ridge's vertical plane, which is what makes the two slopes differ — beamF 1.15 on the
    // −x panel against 0.23 on the +x one. An azimuth of 90° or 270° would put the sun ALONG the ridge and the two
    // slopes would match exactly, which is the one thing this look must not do.
    "seed": 290626672, "sun_elevation_deg": 55, "sun_azimuth_deg": 205,
    // THE ENCLOSURE. faithful_canopy OFF is not a budget cut: the faithful pre-bake fixes one flat receiver frame
    // and the enclosure has none, so receiver 2 forces the layer tier regardless — written false to say so. At these
    // distances the cast is deep pinhole, where the layer tier's height quantization vanishes under the disk blur.
    // (curtain_distance_m is gone with it: the cloth's world-Y comes out of the ray cast now.)
    "receiver": 2, "standing_scene": true, "faithful_canopy": false,
    "curtain_tt": 0.6, "curtain_tint_r": 0.92, "curtain_tint_g": 0.9, "curtain_tint_b": 0.82,
    "velvet_sheen": 0,   // MATTE — nylon has no pile, and the satin ridge glow is the one curtain cue that would break the read
    "curtain_scatter": 0.7,   // most of the transmit diffuses in the weave: shade lifts toward pale gray (never black), the glowy-haze half of the reference
    // THE MESH BAND (§4.9), the first per-panel material: solid nylon to the shoulder, no-see-um mesh above it. At
    // 0.6 the upper band passes ~73 % of what the nylon does and keeps only 40 % of the scatter above, so it reads
    // darker AND crisper — which is the delineation the smooth arch shading took away when the shoulder crease went.
    // The hem line itself is drawn by the seam knob, because the two bands are now separate panel groups.
    "tent_mesh": 0.6,
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
    // THE TENT, at its defaults, written out because they ARE the scene: a 1.15 m crown over a 2.2 m floor with a
    // 70 cm flat top and 2.3 m of length is a real two-person tent, and the eye at 0.5 m is sitting up in a sleeping
    // bag with the ceiling just overhead. The eye's position DOWN the tent is derived (30 % of the length), so the
    // far cap stands about 1.6 m off — close enough to read as a wall, far enough to hold the crown's perspective.
    // THE ARCHES: each side is one smooth vault, not two facets. Its widest point sits 0.55 m up carrying a 0.60 m
    // half-width — 0.14 m OUTSIDE the straight floor-to-ceiling line (0.46 m there), and that bulge IS the
    // roundness: it is the arc's middle control point, and pulling it back to the line would flatten the side to a
    // plain slope. BOTH ENDS ARE HIP CAPS: a 0.55 m vent triangle standing on the floor, and two hips raking back
    // 0.45 m per metre faster than the wall to converge on its apex — which pulls the ceiling's far edge back from
    // 1.62 m to 1.40 m on the centreline and 1.28 m at its corners, and draws the ceiling's centreline seam from one
    // end of the tent to the other. THE VENT TRIANGLES ARE NOT IN THIS FRAME: a vent sits on its end wall's
    // centreline, the gaze below points 64.7° off the near end against a 59.8° half-width, so what shows is the two
    // near hips (40 % of frame) and the spine between them. view_yaw_deg −130 or view_fov_deg 100 brings the near
    // triangle in; raising the apex also would, but by an amount that depends on the canvas aspect.
    // The seam is the one knob off its default, and it draws the POLE LINES only — the crown's two long edges, the
    // ceiling's centreline at the foot, the vent triangle's two rising sides, and the cap rims. The arch's own facet
    // boundaries are filtered out by panel group; drawing them is what once made this read as a church.
    "tent_ridge_h_m": 1.04, "tent_half_w_m": 0.64, "tent_crown_w_m": 0.3,
    "tent_shoulder_h_m": 0.55, "tent_shoulder_w_m": 0.6,
    "tent_len_m": 2.24, "tent_end_lean": 0.6, "tent_end_apex_h_m": 0.55, "tent_hip_rake": 0.45,
    "tent_eye_h_m": 0.42, "tent_fade": 0.06, "tent_seam": 2.0,
    // the camera is the eye INSIDE: pitch is elevation ABOVE horizontal in this branch, so 32° looks up the tent with
    // the far cap's rim at ~35° and the crown sweeping overhead out of the top of frame; 78° is a wide enough lens
    // to hold both slopes and the crown at once, which is the whole composition. view_extent_m no longer frames
    // anything here (the fov and the tent do) — it survives only as the lateral-diffusion tier's px/m reference,
    // which is approximate on a receding panel (§4.9).
    "view_extent_m": 4.9, "view_pitch_deg": 42.5, "view_fov_deg": 88, "view_yaw_deg": -130,   // -115.34 was the hand-tuned light; -130 keeps that character AND brings the near vent triangle into frame (measured: 2.6% of frame, upright) — pull it back if the light mattered more   // the user's hand-tuned framing: the yawed gaze re-aims the sun across the panels — most of what un-churched the look
    "view_center_x": 0, "view_center_y": 0, "trunk_radius_m": 0.06, "far_smear": 0,
    // ---- THE FLOOR OF SHADE IS LOAD-BEARING. Do not "restore contrast" here without re-deriving it. ----
    // The reviewed failure was a frame of vast pitch-BLACK canopy shade; in every reference photo the deepest shade
    // on white nylon stays a luminous mid-gray. That floor is set by three things in this order:
    //  • CONTRAST IS THE BLOCKER, and it is a hard clip, not a taste dial. The Look's tail stretches about 0.5, so
    //    contrast c sends every post-tone-map value under (0.5 − 0.5/c) to pure black: 0.115 at the old 1.3, 0.046
    //    at 1.1. The deepest shade lands near 0.01–0.04 there, so it was clipped to zero outright — and because the
    //    skylight is ozone-BLUE, red clips first and the shade would go cyan on its way to black. Only c ≤ 1 keeps
    //    the low end intact, so this is 1.0 and the separation is bought with exposure and ambient instead.
    //  • AMBIENT IS THE FLOOR ITSELF. With no beam at all the fabric is lit only by sky, so the darkest panel's
    //    value is ambient × its sky-hemisphere share × Tt. 2.2 puts that at ~24 % luminance (sRGB ≈ 46,63,94 on the
    //    shaded slope) against ~224 in a full dapple: a dim blue-gray you can read the seams through, not a hole.
    //    At the old 0.9 it is 13 %, and at 1.1 it is 15 % — dark enough next to a 224 dapple to still read as black.
    //    It is also standing in for something real the model lacks: a white tent's shaded side is mostly lit by
    //    bounce off the lit side opposite, and there is no interreflection here (§4.9's honesty list).
    //  • THE LEAVES, above: paler trans lifts the mid-shade the ambient floor does not reach.
    "exposure": 1.35, "contrast": 1.0, "ambient_skylight": 2.2, "sky_turbidity": 0.04, "mesopic_strength": 0, "chromatic_aberration": 0, "tone_map": 2,
    "wind_pattern": "gusty", "wind_strength": 0.9, "wind_gustiness": 0.25, "wind_direction_deg": 0, "gust_frequency": 0.13,
    "weather_variability": 0.24, "weather_speed": 1, "gust_attack": 1.2, "gust_decay": 1.3,
    "sway_stiffness": 1.2, "sway_ceiling": 0.4, "damping_ratio": 0.65, "backlash_gain": 1, "sway_height_gain": 0.75,
    // limb_count 9 is the WOOD BUDGET, not a shape call. The enclosure runs the layer tier, so the analytic woody
    // occluder is live here, and it holds 64 segments — one bole per tree plus one per level-1 limb. Six trees at
    // eleven limbs asks for 72, and the eight over the cap are dropped in grow order: the last tree loses its trunk
    // and most of its arms, so one sixth of the grove casts no branch shadow at all. Nine puts it at 60.
    "limb_count": 9, "limb_flex": 0.25, "twig_flex": 0.18, "stem_length": 0.18, "leaf_swing": 1.35, "flutter_freq": 1.4,
    "drift_amount": 0.145, "drift_phase": 1.0472, "drift_auto": true, "drift_speed": 0.02,
    // the governor matters LESS here than on its faithful siblings: the enclosure runs the layer tier, which is the
    // cheap path (a per-pixel sample loop over four small textures, no per-sample geometry bake). Left on because
    // the lateral-diffusion tier's three extra full-frame passes are still the expensive thing in this look.
    "auto_quality": true,
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
