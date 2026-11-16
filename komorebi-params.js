// ============================================================================
// The params contract — everything a caller can hand the engine. The engine
// caps consumers size buffers against, the transition classification of every
// knob (spec §9 "Scene transitions"), DEFAULTS (the editor edits a live copy;
// presets merge over it), and the legacy-name migration (spec §9).
// ============================================================================
import { senescing, dropping, ordered } from './komorebi-math.js';

const MAX_SAMPLES = 48;
const BAKE_MIN = 768;   // floor auto_quality trims bake_resolution to below the knee (§9)
const MAX_LAYERS = 4;
const MAX_FILL_DIRS = 64;   // the sky fill's ray cap (§4.7): fill_directions is clamped to it, and it sizes the fill shader's uniform array
// Woody occluder segments (trunk + main limbs incl. droop sub-segments); continuous-height analytic shadow,
// evaluated once per pixel (spec §4.5). The table is a TEXTURE now, not a uniform array, so this number costs
// texels rather than fragment uniform rows (§6) — it is no longer a budget constraint, it is an authored ceiling.
// It is 256. 'the void' grows 192 level-≤1 segments, which a cap of 64 once truncated; but its wood is shut (branch_tau 0),
// so it never reads the table, and canopy 1–4 use at most 64: raising the cap to 256 repainted no shipped look (byte-identical
// frames at 64 and 256). Raising it further could still repaint a grove that outgrows it: a look decision.
const MAX_OCC = 256;
// SKY VIEW (§4.9): the authored radiance scale for the SEEN source. The physical contrast between a sun disk and a
// blue sky is ~10^6, which neither an ACES tail nor a 13-tap glare kernel can carry — so what ships is a compressed
// stand-in, and this is the compression, stated once. It multiplies the sampler's own angular density (weight over
// solid angle), so the CORE:HALO ratio stays exactly the sampler's post-cloud energy split; only the absolute moves.
// 6e-3 puts the default 0.27° clear-sky disk a few stops over the ACES shoulder at exposure ~1 — unmistakably the
// sun, and bright enough to drive the veiling glare, without whiting out the frame when that pass spreads it.
const SKY_SUN_GAIN = 6.0e-3;

// ---- PARAMS: every parameter komorebi has, and what it is, in one place. Everything else that names a parameter reads it
// from here: the engine's DEFAULTS and transition classes, the editor's rows and hover texts, the bounds a saved look is
// held to where looks are kept, the render service's ranges. One entry a parameter, in the order looks list them:
//   default   its value in a look that leaves it out (DEFAULTS)
//   input     instead of a default: an editor input a look does not store, and what it writes instead
//   row       its control in the editor's advanced panel: kind (s a slider, t a toggle, sel a number's select, sels a
//             string's), label, range (min, max, step) or choices, and what a change rebuilds (rebuild: applyParams' scope)
//   noRow     instead of a row: why it has none
//   travels   how a transition carries it from look to look: morph (tweens live), canopy (regrows the same grove a step
//             at a time), season (a canopy key a re-season moves without regrowing), topo (a different grove: it
//             dissolves), mode (a scene mode: a structural rebuild under the bloom), none (it snaps, or nothing reads it)
//   angle     it wraps, and a transition takes the short way round
//   was       its names in older looks, renamed on load (LEGACY_KEYS)
//   means     what it does, as the editor's hover says it: plain first, then the physics. The player and embed bundles
//             never show it and drop it (embed-build.mjs).
// Where a row sits in the panel, and when it shows, are the editor's (editor.js PANEL and its gates). ----
const PARAMS = {
  time_of_day: { input: 'the editor\'s clock: it writes sun_elevation_deg and sun_azimuth_deg for an equinox day, and a look stores the angles',
    row: { kind: 's', label: 'time (h)', min: 5, max: 19, step: 0.25, rebuild: 'suntime' },
    travels: 'none',
    means: "<b>Set the sun by clock time instead of by angle.</b> Drag from dawn through noon to dusk and the sun rises, arcs over, and sets — warming the light and stretching the dapples as it goes. It works out the real sun position for a spring day at your latitude, and writes the elevation/azimuth below." },
  latitude: { input: 'the editor\'s clock: it writes sun_elevation_deg and sun_azimuth_deg for an equinox day, and a look stores the angles',
    row: { kind: 's', label: 'latitude °', min: 0, max: 66, step: 1, rebuild: 'suntime' },
    travels: 'none',
    means: "<b>Where on Earth you are — it sets how high the noon sun climbs.</b> Near the equator the midday sun is nearly overhead; far north it stays low and raking all day. (45° ≈ Montreal, where this all began.)" },
  // Source
  sample_count: { default: 32,
    row: { kind: 's', label: 'samples', min: 16, max: 48, step: 1, rebuild: 'source' },
    travels: 'topo',   // bake_resolution reallocs the layer textures like tex_resolution; eclipse: a false->true toggle turns every dapple to a crescent — hide it under a bloom
    means: "<b>Smoothness of the light, traded against speed.</b> More samples = silkier dapples; fewer = faster. It's how many tiny suns we spread across the sun's disk. Auto-quality trims it when the frame rate dips." },
  core_angular_radius_deg: { default: 0.27,   // the sun's half-angle (~0.5deg disk)
    row: { kind: 's', label: 'core °', min: 0.05, max: 2, step: 0.01, rebuild: 'source' },
    travels: 'morph',
    means: "<b>How big the sun looks — the master softness of every dapple.</b> A bigger sun blurs the shadows more. Tiny gaps stop showing their own shape and instead cast little pictures of the sun — that's what a dapple is. (Real sun ≈ 0.27°; presets often nudge it bigger for a dreamier feel.)" },
  halo_angular_radius_deg: { default: 6.0,   // cloud aureole size at full cloud
    row: { kind: 's', label: 'halo °', min: 1, max: 30, step: 0.1, rebuild: 'source' },
    travels: 'morph',
    means: "<b>How wide the cloudy glow around the sun spreads.</b> Thin cloud smears the sun into a big halo; this is its size, and it shows up as the CLOUD knob goes up." },
  core_weight_fraction: { default: 0.95,   // fraction of energy in the core when clear
    row: { kind: 's', label: 'core wt', min: 0, max: 1, step: 0.01, rebuild: 'source' },
    travels: 'morph',
    means: "<b>Crisp vs. hazy on a clear day.</b> How much of the light sits in the sharp centre vs. the soft glow around it. The CLOUD knob drains the centre into the glow over time; this is the clear-sky starting point." },
  cloud_thickness: { default: 0.15,   // MASTER breathing knob: drains core->halo, spreads halo
    row: { kind: 's', label: 'CLOUD', min: 0, max: 1, step: 0.01, rebuild: 'source' },
    travels: 'morph',
    means: "<b>The master 'cloudiness' dial — turn it up and everything melts soft.</b> Drifting cloud simply makes the sun look bigger and blurrier, so the dapples bloom, dim and lose contrast all together. The single most expressive control in here." },
  eclipse: { default: false,   // proof test: dapples should turn crescent
    row: { kind: 't', label: 'eclipse', rebuild: 'source' },
    travels: 'topo',   // bake_resolution reallocs the layer textures like tex_resolution; eclipse: a false->true toggle turns every dapple to a crescent — hide it under a bloom
    means: "<b>A little science demo, not weather.</b> Slides a moon across the sun so it becomes a crescent — and watch every dapple on the ground turn into a crescent too. That's the proof the dapples are pictures of the sun, not the shapes of the gaps." },
  eclipse_amount: { default: 0.55,
    row: { kind: 's', label: 'ecl amt', min: 0, max: 1, step: 0.01, rebuild: 'source' },
    travels: 'morph',
    means: "<b>How far the moon covers the sun</b> — i.e. how thin the crescent gets. Only matters with 'eclipse' on." },
  // Canopy
  layer_count: { default: 2,
    row: { kind: 's', label: 'layers', min: 1, max: MAX_LAYERS, step: 1, rebuild: 'textures' },
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>How many depth-slices the tree is flattened into (3–4).</b> The one spot where we cheat. Higher slices shift more as the sun moves, so taller leaves blur more — some dapples crisp, some soft, for free. The eye can't count the slices." },
  canopy_base_height_m: { default: 8.0,
    row: { kind: 's', label: 'base h (m)', min: 2, max: 20, step: 0.1, rebuild: '' },
    travels: 'morph',   // layer heights + branch-shadow darkness + the sky view's foliage glow — read live, no rebuild
    means: "<b>How high the lowest leaves are.</b> A taller canopy gives bigger, softer dapples (a 10 m tree casts ~10 cm-soft edges). It also gives the branches a longer lever to sway on." },
  canopy_thickness_m: { default: 3.0,   // layers spread base .. base+thickness
    row: { kind: 's', label: 'depth (m)', min: 0, max: 10, step: 0.1, rebuild: '' },
    travels: 'morph',   // layer heights + branch-shadow darkness + the sky view's foliage glow — read live, no rebuild
    means: "<b>How deep the leafy layer is, top to bottom.</b> More depth = a wider mix of sharp (low) and soft (high) dapples." },
  foliage_density: { default: 1.0,
    row: { kind: 's', label: 'density', min: 0.1, max: 40, step: 0.05, rebuild: 'density' },   // a grown tree carries tens of thousands of leaves, as a real one does: up to 40 times the grammar's
    travels: 'canopy',
    means: "<b>How full the canopy is — sparse spring vs. thick summer.</b> The big mood knob. Sparse: every leaf matters, so the faint wind can totally reshuffle the gaps. Thick: the same flutter only makes them twinkle." },
  // grown skeleton (spec §4.5): a GROVE of tree_count trees, each trunk -> limb_count arms ->
  // branch_children sub-branches, branch_levels deep -> twigs. Overlapping crowns fill the frame.
  tree_count: { default: 5,   // trees in the grove (>1 so crowns overlap and fill the centre)
    row: { kind: 's', label: 'trees', min: 1, max: 16, step: 1, rebuild: 'canopy' },
    travels: 'canopy',   // continuous (spec §4.5): a fractional count grows a marginal tree in, so a tree-count transition MORPHS instead of dissolving
    means: "<b>How many trees in the grove.</b> Their crowns overlap to fill the frame — a single tree would leave a bright bald spot over its trunk. More trees = fuller, more even cover." },
  grove_reach_m: { default: 0,   // the span of ground the grove fills: the trees are spaced across it and an overhead park's crowns sized to it. 0 = the view's extent as it stands when the grove is grown, which is how every look grew before the reach had a name. A zoom moves the camera and never the trees: the engine names the reach the first time the view moves under a grown grove (holdReach), so a later regrow and a saved look grow the grove that was on screen
    row: { kind: 's', label: 'reach (m)', min: 0, max: 40, step: 0.1, rebuild: 'canopy' },
    travels: 'none',   // 0 and the view it stands for are one grove under two values, so the name is never tweened. Where either end of a route names a reach, the route goes by the reach each end grows for (transitionTo, trans.reach): equal and only the camera moves, different and the same grove is regrown along it. Two looks that both follow their view tween that view, as they always did
    means: "<b>How far the trees spread — apart from how far the camera sees.</b> The trees are spaced, and an overhead park's crowns sized, to fill this much ground. At 0 it is the view as it was when the trees were grown. Zoom never moves the trees: the first time you zoom, this takes the size they already have, and the look keeps it." },
  branch_levels: { default: 3,   // recursion depth (1 = limbs are the twigs)
    row: { kind: 's', label: 'levels', min: 1, max: 4, step: 1, rebuild: 'canopy' },
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>How many times the branches split (trunk → limb → twig …).</b> More levels = finer, more natural branching, so gaps show up at every scale. Leaf count climbs fast with this." },
  branch_children: { default: 3,   // sub-branches per node
    row: { kind: 's', label: 'children', min: 1, max: 6, step: 1, rebuild: 'canopy' },
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>How bushy each branch is — how many shoots come off it.</b> The main 'how full is the tree' knob. More = a denser canopy and many more twigs." },
  branch_angle_deg: { default: 34,   // cone half-angle children fan from their parent
    row: { kind: 's', label: 'branch °', min: 5, max: 80, step: 1, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How wide the branches fan out.</b> Narrow = tight, broom-like trees; wide = open, spreading crowns with bigger gaps." },
  branch_length_ratio: { default: 0.62,   // child length / parent length
    row: { kind: 's', label: 'len ratio', min: 0.3, max: 0.92, step: 0.01, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How fast branches shrink as they split.</b> Low = stubby and compact; high = long, reaching, sparser." },
  branch_pitch_deg: { default: 26,   // how steeply limbs rise from horizontal (sets the height spread)
    row: { kind: 's', label: 'pitch °', min: 0, max: 80, step: 1, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How steeply the limbs tilt upward.</b> This spreads the leaves out in height — and height is what sorts them into the sharp vs. soft slices." },
  branch_tau: { default: 0.0,   // trunk+branch shadow (spec §4.5): per-channel optical depth stamped for the woody skeleton. 0 = OFF — leaves-only, byte-identical to the pre-branch looks (no geometry drawn); >0 = the tree casts its own silhouette. Wood is ~opaque & neutral, so one scalar covers RGB.
    row: { kind: 's', label: 'branches', min: 0, max: 5, step: 0.05, rebuild: 'bake' },
    travels: 'morph',   // layer heights + branch-shadow darkness + the sky view's foliage glow — read live, no rebuild
    means: "<b>Whether the tree shows its own branches &amp; trunk — not just its leaf-gaps.</b> The trunk and main limbs cast one connected shadow — a continuous-height analytic occluder, not stamped into the leaf layers — swaying with the canopy. 0 = off (just dapples, byte-identical); turn it up for denser, darker wood. Wood blocks every colour, so the branch shadow is dark and neutral, never green." },
  leader_strength: { default: 0.0,   // monopodial growth (spec §4.5): 0 = legacy single-hub (all limbs from one point — a palm/lollipop); >0 = limbs attach ALONG a continuing trunk, shorter toward the top → excurrent cone (high) vs decurrent dome (low). The excurrent↔decurrent axis (apical control).
    row: { kind: 's', label: 'leader', min: 0, max: 1, step: 0.01, rebuild: 'canopy' },
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>Does the tree have one main trunk going up (conifer) or fork low into a spreading crown (oak)?</b> The big shape knob. 0 = legacy single-point hub (a palm/lollipop). High = limbs attach all the way up a continuing trunk and shorten toward the top — a Christmas-tree cone. Low-but-nonzero = a few low forks, a broad rounded dome. This is what makes branches actually meet the trunk." },
  growth_years: { default: 0,   // a tree grown year by year from buds, the light deciding which grow (komorebi-growth.js; exploration/directions.md): the years it grows. 0 = the fork-at-the-tip grammar, the old tree to the bit. A prototype: above 0 the grammar's limb_count only sorts the wind's limbs, and branch_levels and branch_length_ratio are not read
    row: { kind: 's', label: 'years', min: 0, max: 20, step: 1, rebuild: 'canopy' },
    travels: 'topo',   // the grown tree (komorebi-growth.js): a year more or less is a different tree, not a deformed one
    means: "<b>How many years the trees grew, from buds.</b> 0 = the branching grammar: every tree drawn in one pass, forking only at branch tips. Above 0, each tree grows that many years: every year each bud grows, waits or dies by the light reaching it, shaded branches fall, and the crown's shape, gaps and density follow from that history. More years = an older tree, its wood finer and its leaves shared out over more shoots: it hangs the leaves the grammar would for the same knobs, so density and leaves per cluster mean the same in both. A prototype." },
  droop: { default: 0.0,   // gravitropic curve (spec §4.5): branches bend over sub-segments along their length. >0 = sag DOWN (willow/birch trailing twigs), <0 = upsweep (conifer/elm); stronger on outer orders, compounding toward the tips. 0 = straight rays (byte-identical).
    row: { kind: 's', label: 'droop', min: -1, max: 1, step: 0.01, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>Do the branches curve as they grow — sagging down or sweeping up?</b> Branches bend along their length (a smooth arc, not straight sticks), more toward the fine outer twigs. Positive = sag DOWN (the trailing twigs of a willow or birch); negative = sweep UP (a conifer or elm vase). 0 = straight rays." },
  taper_delta: { default: 2.0,   // pipe-model / Leonardo branch taper (spec §4.5): drawn branch half-width shrinks by children^(−1/Δ) per fork. ~2 = area-conserving (woody); high = stout (oak), low = lacy fast-thinning (birch). Silhouette-only (branch occluder), no dapple cost.
    row: { kind: 's', label: 'taper', min: 1.2, max: 3.5, step: 0.05, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How fast branches thin as they fork — thick trunk to fine twigs.</b> Real wood conserves cross-section at each split (Leonardo's rule), which is what makes a skeleton read as a tree and not a wireframe. Low = fast-thinning, lacy twigs (birch); high = stout limbs that stay thick (oak). Only affects the drawn branch shadow, not the dapples." },
  crown_aspect: { default: 1.0,   // crown height factor (spec §4.5): scales the crown's height. >1 taller (conifer/columnar), <1 broad dome (oak/cedar). A narrow tree's height is capped at crown_radius·FAITH_MAX_RATIO·aspect so it can't run away. Drives the faithful cast + 3D preview; the layer cast normalises height away (invariant).
    row: { kind: 's', label: 'crown', min: 0.4, max: 3, step: 0.05, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>Crown shape — tall &amp; narrow vs. low &amp; broad.</b> Stretches the crown vertically (a silhouette knob: it shapes the tree's outline and the 3D preview, not the top-down dapples). &gt;1 = a spire (conifer, columnar); &lt;1 = a wide dome (oak, cedar)." },
  phyllotaxis: { default: 'spiral',   // child-azimuth rule (spec §4.5): 'spiral' (golden angle — most trees), 'whorled' (even ring per node — conifer tiers), 'opposite' (paired forks 180° apart, decussate 90°/level — maple/ash).
    row: { kind: 'sels', label: 'phyllo', choices: [['spiral','spiral'],['whorled','whorled'],['opposite','opposite']], rebuild: 'canopy' },
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>How branches arrange around their parent.</b> <i>Spiral</i> (golden angle) — most trees, an even non-repeating fill. <i>Whorled</i> — branches in rings at intervals up the trunk (conifer tiers). <i>Opposite</i> — paired branches 180° apart, each level rotated 90° (the maple/ash candelabra of stacked Y-forks)." },
  leaf_shape: { default: 'ellipse',   // the leaf's OUTLINE (spec §4.5, P4a-2): 'ellipse' is the stamp it has always been (the literal old line, byte-identical); 'maple' is a grown sugar-maple blade and 'beech' a grown beech blade — a radial profile r(θ) from the leaf's origin (the maple's petiole base, a point on the beech's midrib), area-normalised so the canopy's fullness is where it was (komorebi-leaf.js). A species bundle carries it, and every bundle names it, so an oak picked after a maple takes the lobes off. A name with no outline is the ellipse
    row: { kind: 'sels', label: 'leaf shape', choices: [['ellipse','ellipse'],['maple','maple'],['beech','beech']], rebuild: 'canopy' },   // §4.5, P4a-2/3: the leaf's outline — a species bundle sets it (the maple's is 'maple'), and so does every other, so a pick never leaves the lobes behind; the beech has no bundle yet
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>The outline of every leaf: a plain oval, a sugar-maple blade, or a beech's.</b> <i>Ellipse</i> is the soft oval every look has used. <i>Maple</i> cuts three main lobes and two small basal ones, U sinuses and a straight base — the sugar maple of José's photos — grown from veins: eight different leaves, each keeping its own shape when it falls to the ground. <i>Beech</i> is one midrib with a dozen toothed veins a side and a pointed tip, about half as wide as it is long — eight more, grown the same way. The blade has the same area as the oval it replaces, so the canopy is as full as it was; an outline keeps its own width-to-length at any aspect. Lobes read where the bake is fine and the leaves are big; on a coarse bake they are blobs." },
  leaf_variety: { default: 0,   // how far a species' leaves differ (spec §4.5, P4a-4): 0..1.5, 1 = as varied as real maples (José's photographed leaves), above 1 beyond nature — each tree grows its own family of outlines (a genotype from its own stream) and within it each leaf takes its light's (sun leaves smaller and more deeply cut, shade leaves larger and fuller); 1 = the spreads measured against José's maples (about three quarters of his outline distance — the RMS between two whole outlines, not his spread on every axis); only an outline varies; TOPO: a new texture, so it dissolves, never morphs; 0 = eight outlines a species, the same on every tree, bit for bit
    row: { kind: 's', label: 'leaf variety', min: 0, max: 1.5, step: 0.05, rebuild: 'canopy' },   // §4.5, P4a-4: how different the leaves are, tree from tree and sun from shade — only an outline varies, so it is hidden on the ellipse look (LOCAL_GATE); a new texture, so it dissolves rather than morphs (TOPO)
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>How different the leaves are — tree from tree, sun from shade.</b> 0 = eight leaves a species, the same on every tree. Up, each tree grows its own family of leaves (a tree's leaves look like each other, its neighbour's like another family), and inside a crown the sun leaves at the top and the outside are smaller and more deeply cut, the shade leaves within larger and fuller. 1 = about the distance between two of José's maples, read on the whole outline; at 1.5 a leaf now and then loses its central lobe. Only an outline varies: the ellipse has none. A fallen leaf keeps the shape it hung in." },
  tree_species: { default: '',   // INERT label (spec §4.5): the editor expands a TREE_SPECIES bundle into the shape knobs above and stamps the name here; the engine never reads it. '' = custom / no species picked.
    noRow: 'the species menu in Tree shape writes it',
    travels: 'none',
    means: "<b>One-click tree shape — oak, spruce, birch, willow, maple, columnar, palm.</b> Loads a bundle of shape knobs (leader, droop, taper, crown, branching) over your current scene; the lighting, camera and wind stay put. A starting point — tweak any knob afterward (it then reads 'custom')." },
  clusters_per_layer: { default: 60,   // legacy (pre-skeleton); unused by the grown canopy, kept for preset compat
    noRow: 'unused by the grown canopy; kept so old looks load',
    travels: 'none',
    means: "<b>Leaf clusters per depth layer, from before the grove was grown.</b> Unused by the grown canopy; kept so old looks still load." },
  leaves_per_cluster: { default: 22,   // leaves per terminal twig
    row: { kind: 's', label: 'leaves/twig', min: 1, max: 80, step: 1, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How many leaves on each twig-tip.</b> Sets the overall leaf count (and how heavy it is to draw). Crossing whole numbers fades in smoothly, so you can sweep it without it jumping." },
  cluster_spread_m: { default: 0.13,
    row: { kind: 's', label: 'spread (m)', min: 0.02, max: 1, step: 0.01, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How tightly leaves bunch on a twig.</b> Tight = distinct clumps with clear gaps between them; loose = a more even leaf carpet." },
  inner_leaves: { default: 0.35,   // on by default (a look from before it was keeps 0: GRANDFATHERED, below); leaves on the older wood, so the crown is full (§4.5): 0..1, the share of each twig's leaves hung back along the wood it grew from instead of at its tip — shade leaves, thinning inward and never to zero, as a real crown carries them. A share, not more leaves: the count and the area are the look's. 0 = every leaf at its twig, the old placement to the bit (no path is even collected). A canopy key (it moves leaves), not a season key
    row: { kind: 's', label: 'inner leaves', min: 0, max: 1, step: 0.01, rebuild: 'canopy' },   // §4.5: leaves on the older wood, so the crown is full — the share of each twig's leaves hung back along the limbs it grew from; 0 = the hollow crown, leaves at the twigs only
    travels: 'canopy',
    means: "<b>A full crown: sun leaves at the shell, shade leaves inside.</b> A tree only grows leaves at the ends of its twigs, so from above it reads as a wheel — a ring of leaves, a thin core, and bare limbs for spokes. A real crown also carries leaves on the older wood, thinning toward the trunk and never to none. This hangs that share of every twig's leaves back along the limbs it grew from, at the height they hang. 0 = the hollow crown, leaves at the twig tips only. It moves leaves, it adds none: the count and the leaf area stay the look's." },
  leaf_size_m: { default: 0.09,
    row: { kind: 's', label: 'leaf (m)', min: 0.01, max: 0.4, step: 0.005, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How big each leaf is.</b> Bigger leaves block more and leave smaller gaps — and small gaps are exactly what make those soft, round sun-pictures." },
  leaf_aspect: { default: 1.6,
    row: { kind: 's', label: 'aspect', min: 1, max: 4, step: 0.05, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>Leaf shape — round vs. long and narrow.</b> Higher = skinnier leaves. Changes the shape each leaf blocks as it rocks in the wind. An outlined leaf (maple, beech) keeps its own width-to-length: for it the aspect sets only the leaf's area — the area an oval of this size and aspect would have — so a maple at 1.75 is a smaller maple, never a squashed one." },
  max_tilt: { default: 0.8,   // orientation foreshortening amount
    row: { kind: 's', label: 'tilt', min: 0, max: 1, step: 0.01, rebuild: 'canopy' },
    travels: 'canopy',
    means: "<b>How tilted the leaves sit at rest.</b> A tilted leaf is seen more edge-on, so it blocks less — this thins the canopy and gives the wind something to foreshorten." },
  edge_softness: { default: 0.25,
    row: { kind: 's', label: 'edge', min: 0.01, max: 1, step: 0.01, rebuild: 'bake' },   // the bakes cut the rim; the grove's build never reads it
    travels: 'canopy',
    means: "<b>How fuzzy each leaf's own edge is.</b> Small = crisp, detailed leaves; large = softer blobs. (It's honest blur from a leaf only half-covering a pixel.)" },
  // per-channel transmittance (green passes)
  trans_r: { default: 0.04,
    row: { kind: 's', label: 'trans R', min: 0.001, max: 0.6, step: 0.001, rebuild: 'season' },
    travels: 'season',
    means: "<b>How much RED light leaks through a leaf.</b> Keep it low — leaves drink red, which is why shade isn't black. It's the main lever on how warm the shadow-green looks. Stacked leaves multiply, so overlaps go darker." },
  trans_g: { default: 0.35,
    row: { kind: 's', label: 'trans G', min: 0.001, max: 0.9, step: 0.001, rebuild: 'season' },
    travels: 'season',
    means: "<b>How much GREEN light leaks through a leaf.</b> High — leaves pass green, so the shade beneath them glows green instead of going black. The signature komorebi colour." },
  trans_b: { default: 0.06,
    row: { kind: 's', label: 'trans B', min: 0.001, max: 0.6, step: 0.001, rebuild: 'season' },
    travels: 'season',
    means: "<b>How much BLUE light leaks through a leaf.</b> Low, like red. A small nudge on how cool the shade reads." },
  // AUTUMN SENESCENCE (spec §4.5): each leaf runs its own clock and carries its own pigment capacity. `phenology`
  // is the season (0 spring bud · 0.5 summer · 1 leaf-off); a leaf starts turning at turn_start + φ·turn_spread
  // (φ a per-leaf hash) and has finished by turn_start + turn_span. trans_rgb stays the authored SUMMER hue.
  // GATE: a leaf that has not begun to turn (every leaf, at phenology <= turn_start) keeps trans_rgb literally —
  // the shipped looks sit at 0.5, so they render byte-identically whatever the pigment knobs below say.
  phenology: { default: 0.5,
    row: { kind: 's', label: 'phenology', min: 0, max: 1, step: 0.01, rebuild: 'season' },   // §4.5: the season — 0.5 is summer, where the three below (and the turn clock) are inert and hidden
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>The season — spring bud, summer, leaf-off.</b> 0.5 is summer and the leaves are exactly the look's own colour. Past the turn the leaves change, each on its own clock: the green is dismantled, the yellow that was always there shows, red is made. On the ground it's the <i>shade</i> that goes warm — the suns stay white-gold. With <i>leaf fall</i> up it also lets the leaves go, each on its own day." },
  turn_start: { default: 0.6,   // phenology at which the EARLIEST leaf begins to turn (an early tree begins up to tree_clock_spread sooner)
    row: { kind: 's', label: 'turn start', min: 0, max: 1, step: 0.01, rebuild: 'season' },
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>The season at which the first leaf starts to turn.</b> Below it every leaf is summer; this is the threshold the phenology slider has to pass. An early tree (<i>early trees</i>) begins up to that much sooner." },
  turn_span: { default: 0.3,   // ...and by turn_start + turn_span every leaf has finished (with drop_after_turn each leaf finishes turn_span − turn_spread after its own start, the last still at turn_start + turn_span)
    row: { kind: 's', label: 'turn span', min: 0.02, max: 0.6, step: 0.01, rebuild: 'season' },
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>How long the turn takes, in seasons.</b> By turn start plus this, every leaf has finished." },
  turn_spread: { default: 0.18,   // how far the leaves' start times scatter (phenology units, clamped under the span): 0.6 of the default span, so mid-turn is a mosaic (green · gold · red on one tree) and the last leaf still finishes at 0.9
    row: { kind: 's', label: 'turn spread', min: 0, max: 0.6, step: 0.01, rebuild: 'season' },
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>How scattered the leaves' start times are.</b> 0 = the whole tree turns together; up = leaves start at different moments, so mid-turn is a mosaic of green, gold and red on one tree. Held under the span so each leaf's own turn still takes time." },
  anthocyanin: { default: 0.0,   // red capacity (maple, sumac): synthesised as the leaf turns, ×(0.5..1.5) per leaf — the ~3:1 range in red depth across one tree. 0 = a plain gold turn
    row: { kind: 's', label: 'anthocyanin', min: 0, max: 1.5, step: 0.01, rebuild: 'season' },
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>How much red each leaf can make.</b> 0 = a plain gold turn; up = orange, then deep red, then maroon. Every leaf gets between half and one-and-a-half times this, so one tree carries pale and deep reds side by side — about a three-to-one range, as in the photographs. Maples and sumac have a lot; birch has none. Only shows once the season has passed the earliest turn." },
  tannin: { default: 0.0,   // brown (beech, oak): a broad warm absorber, ×(0.5..1.5) per leaf
    row: { kind: 's', label: 'tannin', min: 0, max: 1.5, step: 0.01, rebuild: 'season' },
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>How brown the leaves go.</b> A broad, warm absorber — the russet of beech and oak, dull under the gold. Same per-leaf spread as the red. Only shows once the season has passed the earliest turn." },
  wall_fraction: { default: 0.0,   // share of the leaf that is bright vein walls rather than dark cells (the sieve effect, §4.5): the mean is of transmittances, so a few clear walls lift a deep leaf. 0 = one uniform tissue
    row: { kind: 's', label: 'vein share', min: 0, max: 0.6, step: 0.01, rebuild: 'season' },
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>How much of each leaf is bright vein, not dark cell.</b> Light through a leaf is the average of what its veins and cells <i>transmit</i>, not of how dark they are — so a few clear veins lift a deep red leaf into a glowing orange, more than their share of the area suggests (the sieve effect). The veins make no red. 0 = one uniform tissue." },
  turn_exposure: { default: 0.0,   // light decides who turns first (§4.5, P1): 0..1, how far a leaf's turn is ordered by its exposure to the season's sun (the crown's top, its sun side, a tree with no shading neighbour turn EARLIER and make MORE red; the shaded interior later and yellower). 0 = P0's per-leaf hash alone, bit for bit, at any phenology — every experimental behaviour is a toggle
    row: { kind: 's', label: 'sun first', min: 0, max: 1, step: 0.01, rebuild: 'season' },   // §4.5: light orders the turn — the sunlit crown first and reddest
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>Let the light decide who turns first.</b> Anthocyanin is made in light, so the leaves that see the sun — the top of the crown, its sunny side, the outer shell, a tree with no neighbour shading it — turn earlier and go redder, while the shaded inside and underside turn later and stay yellower. Exposure is worked out from where every leaf sits among the others, under a fixed mid-season sun (not the look's own sun), so it follows the shape of the grove, and a tree standing in another's shade turns after one in the open. The season's pace and the average red stay the look's own — light only decides who goes first and moves red from the shade to the sun. 0 = every leaf turns on its own clock regardless of light. Only shows once the season has passed the earliest turn." },
  exposure_absolute: { default: 0.0,   // ranked vs absolute light (§4.5, P1b): 0..1, how far a leaf's place in the turn follows its RAW exposure instead of its rank in the grove's exposure order — u = mix(rank, exposure, this). 0 = the rank (P1: the look's own schedule and mean red, bit for bit); 1 = the raw light, so a grove in deep shade turns later and paler. Read wherever the exposure order is: through turn_exposure, and through the drop's order (drop_exposure while leaves fall, not after their turn — komorebi-math.js ordered) even at turn_exposure 0
    row: { kind: 's', label: 'absolute light', min: 0, max: 1, step: 0.01, rebuild: 'season' },   // §4.5: what the exposure order is made of — sun first's, and the fall's while leaves let go by the light — 0 the grove's own rank of light, 1 the raw light (a shaded grove turns late and pale)
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>Order by the grove's own light, or by how much light there is.</b> At 0 each leaf is placed by its rank in the grove's order of light, so even a stand wholly in deep shade has a red, early half, and the season's pace and the average red stay the look's own. Up, a leaf's place follows its actual light instead: a crowded grove sitting in its own shade turns later and makes less red, a sparse one in the open turns earlier and deeper. That is the absolute physics, and it repaints a look as its density moves — the blend between is yours to set. It only chooses what the order is made of — the one <i>sun first</i> turns the leaves by, and the one <i>sun falls first</i> drops them by while leaves are falling — so it does nothing while neither is ordering anything. Only shows once the season has passed the earliest turn." },
  tree_clock_spread: { default: 0.0,   // one tree ahead of its neighbours (§4.5): 0..0.15 seasons, how far AHEAD the earliest tree can run. Each tree draws a lead Δ = −this·v³ from (seed, tree index) on its own salt: most trees near the look's schedule (median an eighth of this, one in five beyond half), the lead moving the tree's start, finish and drop together, and the gates open this much sooner (komorebi-math.js turnOpens). 0 = the look's clock for every tree, bit for bit
    row: { kind: 's', label: 'early trees', min: 0, max: 0.15, step: 0.005, rebuild: 'season' },   // §4.5: one tree ahead of its neighbours — how far ahead the earliest tree can run; each tree draws its own lead, its whole clock moves (start, finish, letting go)
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>A few trees run ahead of the rest.</b> Within one kind a few individuals turn early — a stressed tree — while the rest keep to the season. This is how far ahead the earliest can run, in seasons: each tree draws its own lead, most of them close to none and one in five beyond half of this. A tree's whole clock moves with its lead — when it starts, when it has finished, and when it lets go. Light still decides who turns first, inside a crown and across crowns. Up to 0.1 a summer look (phenology 0.5) is untouched; above it a tree with a long lead can already be turning there. 0 = every tree on the look's schedule. Only shows once the season has passed the earliest turn." },
  tree_pigment_spread: { default: 0.0,   // each tree's red AND brown capacity × (1 ± this): 0..1, mean 1 in expectation, not by construction (a tree keeps its draw as the grove grows); 1 lets a tree go without red. 0 = the look's capacity, bit for bit
    row: { kind: 's', label: 'tree pigment', min: 0, max: 1, step: 0.01, rebuild: 'season' },   // §4.5: each tree's own depth of red AND brown, 1 ± this; neighbours of one kind differ about two to one
    travels: 'season',   // leaf colour, like trans_rgb: each is a per-leaf tau read at regrow, so it morphs the SAME grove (spec §4.5); the last two are per TREE, the same tau and day by a tree's own draw
    means: "<b>Neighbours of one kind differ in how red they go.</b> Two trees side by side can differ about two to one in red and in brown. Each tree draws its own factor, 1 ± this, applied to its red and its brown together, so the grove's average stays the look's on average. 1 lets a tree go without any red. 0 = every tree has the look's capacity. Only shows once the season has passed the earliest turn." },
  leaf_drop: { default: 0.0,   // abscission (§4.5, P3a): 0..1, the share of leaves that have let go by drop_start + drop_span; the rest are marcescent (beech keeps ~half its brown leaves) and never drop within the season. THE GATE: 0 = nothing ever drops, P1's buffers bit for bit. Provisional species values: maple 1, red oak 0.8, beech 0.5
    row: { kind: 's', label: 'leaf fall', min: 0, max: 1, step: 0.01, rebuild: 'season' },   // §4.5: abscission — the share of leaves that let go by the end of the fall span; the rest hang on (marcescent). 0 = nothing falls
    travels: 'season',   // abscission (§4.5): which leaves are still on the tree is decided at regrow, so it morphs the SAME grove too (a leaf fades out by §5.3's rule, never pops)
    means: "<b>How many leaves let go before the season is over.</b> Each leaf has its own day, so the canopy thins leaf by leaf, and each one fades out of the cast shadow rather than vanishing. By fall start plus fall span this share is on the ground; the rest hang on, brown and dry — a beech keeps about half its leaves all winter. 0 = nothing falls. Provisional values by species: maple 1, red oak 0.8, beech 0.5. Only shows once the season has passed the earliest turn." },
  drop_start: { default: 0.7,   // the season at which the first leaf lets go (phenology units; the turn starts at turn_start 0.6). Not read with drop_after_turn: the first leaf then goes when it has turned, turn_start + turn_span − turn_spread + drop_lag + DROP_EPS
    row: { kind: 's', label: 'fall start', min: 0, max: 1, step: 0.01, rebuild: 'season' },
    travels: 'season',   // abscission (§4.5): which leaves are still on the tree is decided at regrow, so it morphs the SAME grove too (a leaf fades out by §5.3's rule, never pops)
    means: "<b>The season at which the first leaf lets go.</b> Below it every leaf is on the tree. Phenology units, like turn start — it ships later (0.7 against 0.6), so the leaves colour before they fall. Not used while <i>after its turn</i> is on." },
  drop_span: { default: 0.3,   // how long the dropping share takes to fall, in seasons: the last of it is down by drop_start + drop_span
    row: { kind: 's', label: 'fall span', min: 0.02, max: 0.6, step: 0.01, rebuild: 'season' },
    travels: 'season',   // abscission (§4.5): which leaves are still on the tree is decided at regrow, so it morphs the SAME grove too (a leaf fades out by §5.3's rule, never pops)
    means: "<b>How long the falling takes, in seasons.</b> By fall start plus this, every leaf that is going to fall is down. Not used while <i>after its turn</i> is on." },
  drop_exposure: { default: 1.0,   // how far light orders the drop (0 = each leaf's own hash, 1 = the sunlit leaves go first). Reads the same exposure turn_exposure does, so it needs no turn_exposure of its own
    row: { kind: 's', label: 'sun falls first', min: 0, max: 1, step: 0.01, rebuild: 'season' },   // §4.5: how far light orders the fall — the sunlit crown lets go first (it reads the same exposure sun first does)
    travels: 'season',   // abscission (§4.5): which leaves are still on the tree is decided at regrow, so it morphs the SAME grove too (a leaf fades out by §5.3's rule, never pops)
    means: "<b>Let the sun's side lose its leaves first.</b> At 1 the leaves that see the most sun — the top of the crown, its sunny side — let go first and the shaded inside last, which is where the leaves that stay are; at 0 every leaf lets go on its own day, whatever light it gets. It reads the same exposure as <i>sun first</i>, so it works with that at 0. Only shows while leaf fall is above 0." },
  drop_lag: { default: 0.09,   // after the turn (drop_after_turn 1 only): how long a leaf that has finished turning hangs before it fades, in seasons. 0 = it fades the instant it has turned; 0.09 (a total of 0.10 with DROP_EPS) puts a little under half the leaves down at 0.9 (his beech's half is a total of 0.09). It was 0.05 (a total of 0.06 with DROP_EPS), which kept montebello's 66.7 % down at 0.9
    row: { kind: 's', label: 'fall lag', min: 0, max: 0.2, step: 0.01, rebuild: 'season' },   // §4.5: with 'after its turn', how long a leaf that has finished turning hangs before it fades
    travels: 'season',   // abscission (§4.5): which leaves are still on the tree is decided at regrow, so it morphs the SAME grove too (a leaf fades out by §5.3's rule, never pops)
    means: "<b>How long a leaf that has turned hangs before it lets go.</b> In seasons. 0 = it fades the instant it has finished turning; the default 0.05 keeps most looks' fall about as it was; up, the crown stands turned for longer before it thins. Only shows while <i>after its turn</i> is on." },
  drop_after_turn: { default: 0,   // a leaf lets go only after it has turned (§4.5, Abscission): 0|1, a flip (never morphs). 0 = the day is drop_start + drop_span·φ_d/leaf_drop, its own clock beside the turn, bit for bit. 1 = the end of the leaf's own turn window + DROP_EPS + drop_lag, ordered by the turn's own phase, so a sunlit leaf lets go first because it finished first; drop_start/span/exposure are then unread. THE TRADE: the crown turns SOONER mid-turn (each leaf's window is turn_span − turn_spread long, not a smoothstep to the common finish); from turn_start + turn_span on the colour is identical. The carpet is younger (less brown at the same litter_age)
    row: { kind: 'sel', label: 'after its turn', choices: [['off',0],['on',1]], rebuild: 'canopy' },   // §4.5: a leaf lets go only once it has turned (a regrow: it moves every leaf's day and the mid-turn colour). A select, not a checkbox, for litter's reason: a TOPO key that a preset writes as 0/1
    travels: 'topo',   // a flip moves every leaf's drop day and the mid-turn colour at once; snap it under the bloom.
    means: "<b>A leaf lets go only after it has turned.</b> Off, the fall keeps its own clock beside the turn, so a leaf can drop while it is still half green. On, each leaf lets go once it has finished turning, plus the fall lag, and the sunlit ones go first because they finished first — a lemon carpet no longer lies under a dark crown. Fall start, span and sun side are then not used (the order is the turn's own). Leaf fall still sets how many let go; the last to turn are the ones that stay. <b>It also turns the crown sooner mid-turn:</b> each leaf's turn now takes its own length from its own start, instead of all running to the same finish; from the end of the turn the colour is the same. Only shows while leaf fall is above 0." },
  litter: { default: 0,   // the carpet (§4.7, P3b): the fallen leaves lie on the floor and the floor reflects off them. THE GATE, separate from leaf_drop so the canopy half can be judged alone: 0 = no texture (1x1), no bake pass, the floor's literal old line. Only the floor reads it
    row: { kind: 'sel', label: 'litter', choices: [['off',0],['on',1]], rebuild: '' },   // §4.7: the fallen leaves lie on the floor and the floor reflects off them — the carpet's own gate, apart from leaf fall so the canopy half can be judged alone. A select, not a checkbox: a preset writes 0/1, and a boolean would never equal it
    travels: 'topo',   // the carpet (§4.7): a gate that allocates (1x1 <-> res²) and the size it allocates at — neither interpolates, so a look that crosses them dissolves under the bloom rather than popping a carpet in
    means: "<b>Let the fallen leaves lie on the floor.</b> A leaf that has let go lands on the ground, casts nothing, and is seen by <i>reflection</i> — which is why the same red leaf that glows backlit in the canopy lies there tan and dull, lit from above: it is a surface now, not a window. The last to fall lie on top, the carpet goes from red through copper to brown as it ages, and the wind of the season carries it. It is the same carpet whenever you look: nothing piles up as the clock runs. The sky fill and the sun light it as they light the ground beside it. Off, the floor is exactly what it was. Only the floor has leaves to lie on, and only once leaf fall has dropped some." },
  litter_age: { default: 0.15,   // PROVISIONAL (phenology units): how long a fallen leaf takes to go from its own hue to brown — smoothstep over (phenology − its day) / litter_age. Read by the regrow-time bake only
    row: { kind: 's', label: 'browns over', min: 0.01, max: 0.6, step: 0.01, rebuild: '' },   // §4.7: how long a fallen leaf takes to go from its own hue to brown, in seasons (read at the next bake, which the carpet notices by itself)
    travels: 'canopy',   // the litter carpet (§4.7): how browned each leaf lies and how far the season's wind carried it — read only by the regrow-time bake, so they morph with the grove they are baked from
    means: "<b>How long a fallen leaf takes to turn brown.</b> In seasons, like fall start: a leaf that fell this instant is still its own colour — red stays red — and one that fell this long ago is dry-leaf brown, with a smooth turn between. Low and the carpet is brown almost at once; high and it stays bright for weeks. (A provisional number, until a fresh-and-dry litter photo against a grey card sets it.) Only shows while litter is on." },
  litter_drift_m: { default: 0.4,   // metres a falling leaf is carried per metre of height, along the AUTHORED wind_direction_deg (the season's wind, never the live gusts), with a scatter of 0.3 of that. Read by the regrow-time bake only
    row: { kind: 's', label: 'carried', min: 0, max: 2, step: 0.01, rebuild: '' },   // §4.7: metres a falling leaf is carried per metre of height, along the season's wind
    travels: 'canopy',   // the litter carpet (§4.7): how browned each leaf lies and how far the season's wind carried it — read only by the regrow-time bake, so they morph with the grove they are baked from
    means: "<b>How far the wind carries a falling leaf.</b> Metres sideways per metre of height it falls from, along the season's wind direction (the one in the wind section — not the gusts, so the carpet is the same whenever you look), with a scatter of about a third of that about it. 0 drops every leaf where it hung; up, the carpet lies down-wind of the tree. Only shows while litter is on." },
  leaf_wetness: { default: 0,   // the rain day (§4.7): 0..1, how soaked the fallen leaves lie — darker and more saturated (K–M with scattering cut by the index law). An EFFECTIVE wetness (it absorbs the water film too; a rain day is about 0.5, the grey card will set it). 0 = the dry law with no arithmetic. Read by the carpet bake only, never by the grove or a shader
    row: { kind: 's', label: 'wet', min: 0, max: 1, step: 0.01, rebuild: '' },   // §4.7: the rain day — fallen leaves darker and more saturated; an effective number, about 0.5 after rain
    travels: 'morph',   // the rain day (§4.7): read by the carpet bake only — refreshLitter's signature notices it and only the carpet re-bakes; no regrow (a CANOPY key would regrow the whole grove per frame to re-tint the carpet, and macros may never write CANOPY keys, which P8's rain, a live writer, will need)
    means: "<b>How soaked the fallen leaves lie.</b> A dead leaf on the ground drinks the rain: water fills the air in its tissue, it scatters less light back, and it goes darker and richer in one move — a red leaf gets redder and deeper, a brown one near black. A day after rain is about 0.5; 1 is a leaf under water, an overstatement. It is an <i>effective</i> number that the grey-card photo of dry against wet litter will set, not a measured wetness. Leaves still on the tree are alive and are untouched. The ground itself stays dry, so lower its colour by hand for a rain look. Only shows while litter is on." },
  canopy_extent_m: { default: 12.0,   // world size of baked layers (>= view + 2*max shift)
    row: { kind: 's', label: 'extent (m)', min: 6, max: 80, step: 0.5, rebuild: 'textures' },   // the sky view needs boxes a floor look never did: the grove must reach far enough sideways to fill an upward frame
    travels: 'canopy',   // baked world size — only a regrow + re-bake (NO texture realloc), so it morphs continuously
    means: "<b>How big the simulated patch of ground is.</b> It has to be bigger than what you're viewing (with room for the sun to shift things), or dapples run off the edge. The grove auto-fits inside it." },
  tex_resolution: { default: 2048,
    row: { kind: 'sel', label: 'res', choices: [['1024',1024],['2048',2048],['4096',4096]], rebuild: 'textures' },
    travels: 'topo',   // bake_resolution reallocs the layer textures like tex_resolution; eclipse: a false->true toggle turns every dapple to a crescent — hide it under a bloom
    means: "<b>Detail of the leaf-shadow map.</b> Higher resolves the tiniest gaps (the sharpest dapples) but costs more. 1024 is usually plenty for something this soft." },
  bake_resolution: { default: 1024,   // TUNE (§9): bake-pass / layer-texture size; 0 = follow tex_resolution. Ships at 1024 (cheaper-bake baseline). auto_quality trims it below the knee like samples; set 0 (follow) per look for a full-res bake.
    row: { kind: 'sel', label: 'bake res', choices: [['follow tex',0],['768',768],['1024',1024],['1536',1536],['2048',2048]], rebuild: 'textures' },
    travels: 'topo',   // bake_resolution reallocs the layer textures like tex_resolution; eclipse: a false->true toggle turns every dapple to a crescent — hide it under a bloom
    means: "<b>Resolution of the leaf-shadow bake, split off from texture res.</b> Lower it to make the per-frame bake (the windy-look cost the auto-governor can't touch) ~quadratically cheaper, at the price of softening the very sharpest sub-leaf gaps. <i>follow tex</i> = match texture res (no change). Opt-in." },
  seed: { default: 1234,
    noRow: 'the reseed button and R draw a new one',
    travels: 'topo',   // bake_resolution reallocs the layer textures like tex_resolution; eclipse: a false->true toggle turns every dapple to a crescent — hide it under a bloom
    means: "<b>Which grove.</b> The number every tree, branch and leaf is drawn from: the same seed and knobs always grow the same grove. The reseed button and R draw a new one." },
  // Transport
  sun_elevation_deg: { default: 55,
    row: { kind: 's', label: 'elev °', min: 4, max: 90, step: 0.5, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>How high the sun is — drag it down for sunset.</b> A low sun stretches the dapples into long ellipses, turns the light warm and orange, and lets the shade go cool blue. The most scene-changing knob. (Or just drag on the picture.)" },
  sun_azimuth_deg: { default: 30,
    row: { kind: 's', label: 'azim °', min: 0, max: 360, step: 1, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    angle: true,
    means: "<b>Which compass direction the sun is in.</b> Turns the direction the dapples stretch and lean." },
  // THE SUN'S COSINE LAW (§3.5): the beam lands on every receiver by the cosine of its incidence — the floor and the tent's crown sin(el), the flat cloth cos(el)·|sin(az)| — which the
  // atmosphere's spectrum never carried, so a 12° floor was as bright as a 70° one. 0..1, a blend: 0 = the old full-strength beam, byte-identical (the factor is exactly 1 and nothing
  // in a shader reads it); 1 = the law, normalised to the zenith, so a look that turns it on re-sits its `exposure` (about ×2.3 at 26°). The sky view never reads it: radiance is invariant, the seen
  // disk takes nothing. The skylight is not a beam and keeps its level. Author only 0 or 1 (an interior value is the law under a higher sun, which a real sun does give).
  sun_cosine: { default: 1,   // on by default; a look from before it was keeps 0 (GRANDFATHERED, below)
    row: { kind: 's', label: 'cosine', min: 0, max: 1, step: 0.01, rebuild: '' },   // §3.5: the beam lands by the cosine of its incidence on every receiver — 0 is the old full-strength beam, byte for byte; a look that opens it re-sits its exposure
    travels: 'morph',   // the sun's cosine law and the air's loss (§3.5): a live scale of the uploaded sun colour and a fill re-run (fillSig), no bake — so it tweens
    means: "<b>Let the sun's height light the ground.</b> A low sun spreads its light thin across the floor, the way a torch held at a slant does, so with this up the day brightens toward noon and dims toward dusk at a fixed exposure. At 0 every sun lands at full strength whatever its height (what every look has always done); at 1 the floor takes the cosine of the sun's angle, the curtain and the tent theirs. A look that turns it on re-sits its exposure — about ×2.3 higher for a 26° sun — because the law is measured from a sun straight overhead. The sun you see is unchanged: the disk looks as bright at any height, and the skylight is not sunlight, so it keeps its level. Not shown when looking up." },
  // THE AIR'S LOSS: the beam's broadband transmittance against the zenith's, which atmosphere() divides out to keep
  // only the hue. 0 = the old beam, exactly (the factor is 1); 1 = a 12° sun about half as bright as one overhead, on top of the cosine law. A live scale beside sun_cosine's.
  sun_extinction: { default: 1,   // on by default; a look from before it was keeps 0 (GRANDFATHERED, below)
    row: { kind: 'sel', label: 'air loss', choices: [['off', 0], ['on', 1]], rebuild: '' },
    travels: 'morph',   // the sun's cosine law and the air's loss (§3.5): a live scale of the uploaded sun colour and a fill re-run (fillSig), no bake — so it tweens
    means: "<b>Does a low sun come through dimmer?</b> The air's loss: the sunbeam crosses more air the lower the sun, and arrives weaker. 0 = the sun as bright at any height; 1 = a 12° sun about half as bright as one overhead, on top of the cosine law." },
  // Look
  view_extent_m: { default: 4.0,   // vertical span of the visible ground (zoom = on-axis span, any tilt)
    row: { kind: 's', label: 'view (m)', min: 0.5, max: 40, step: 0.1, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Zoom — how much ground you see.</b> Small = a close-up of a few big dapples; large = a wide field of many small ones. (It's the span at screen centre, so it holds as you tilt.)" },
  view_pitch_deg: { default: 16,   // camera tilt from straight-down (0 = top-down); gentle under-the-tree default
    row: { kind: 's', label: 'tilt °', min: 0, max: 90, step: 1, rebuild: '' },   // 90 is the zenith, which the sky view's looks sit at
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Tilt — straight down vs. out along the floor.</b> 0° is the old top-down map; raise it and you're sitting under the tree — the near floor drops to the bottom of frame, the far floor recedes and dissolves into haze. (Or just drag up/down on the picture.)" },
  view_fov_deg: { default: 50,   // vertical FOV — perspective strength / lens
    row: { kind: 's', label: 'fov °', min: 10, max: 110, step: 1, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Lens — how strong the perspective is.</b> Narrow is flat and telephoto; wide throws the near floor big and rushes the far floor away. Only bites once you've tilted." },
  view_yaw_deg: { default: 0,   // camera orbit about the vertical axis through frame centre (0 = unchanged); rotates which compass direction is "up the screen" on the floor — for making sense of the structure from the side
    row: { kind: 's', label: 'orbit °', min: -180, max: 180, step: 1, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Orbit — spin the view around.</b> Rotates which compass direction is 'up the screen' on the floor, so you can walk around the structure and make sense of it from any side. (Or just drag left/right on the picture.) Doesn't move the sun, so the shadows stay physically cast as you turn." },
  // camera PAN: world point the screen centre looks at (0,0 = frame centre) — walk the view around the floor (shift-drag), e.g. to put the tree out of frame and watch only its shadow
  view_center_x: { default: 0,
    row: { kind: 's', label: 'pan x', min: -25, max: 25, step: 0.1, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Pan — slide the view across the floor.</b> Moves the patch of ground you're centred on, so you can walk over to the shadow or push the tree out of frame and watch only what it casts. (Or shift-drag on the picture.) Pair with zoom (wheel) to back away." },
  view_center_y: { default: 0,
    row: { kind: 's', label: 'pan y', min: -25, max: 25, step: 0.1, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Pan — slide the view across the floor.</b> Moves the patch of ground you're centred on, so you can walk over to the shadow or push the tree out of frame and watch only what it casts. (Or shift-drag on the picture.) Pair with zoom (wheel) to back away." },
  // Standing-scene mode (spec §4.8): treat the trees as objects STANDING in a scene casting shadows on the floor,
  // rather than an infinite canopy hovering overhead (the park model). v1 adds the TRUNK shadow — a vertical
  // occluder the layered slab model can't cast (a vertical trunk has no horizontal footprint). Off = the park
  // model, byte-identical. Rooting the trees off to the side + an un-tiled lit floor is the next step.
  // SKY VIEW (spec §4.9): stop looking at what the light LANDS on and look at where it comes FROM. The eye lies on
  // the ground and gazes up: trunks converging overhead, crowns against the sky, the source itself visible through
  // the gaps. It is still pure transmission — the same occluder field, read along upward rays instead of sun rays —
  // and it overrides the receiver entirely (there is no surface, so no fabric, no ground, no seams). Off = every
  // look unchanged.
  sky_view: { default: false,
    row: { kind: 't', label: 'look up', rebuild: 'textures' },   // the third camera (§4.9): forces the layer tier, so it reallocates like faithful_canopy does
    travels: 'mode',
    means: "<b>Turn over and look UP.</b> Instead of the light landing on something — a floor, a curtain, a tent — you are lying on your back under the trees looking at the canopy itself: trunks converging overhead, leaves lit from behind, the sun burning through the gaps. It is the same physics read the other way round, so everything about the grove and the weather still applies; what changes is that there is no surface any more, so the receiver, its fabric and the ground all switch themselves off. <i>Tilt</i> is now how high you're looking (90° = straight up) and <i>fov</i> is how much sky you take in. Turn up <i>glow bleed</i> for the wash your eye really makes around a bright sun." },
  sky_scatter: { default: 0.0,   // SKY VIEW (§4.9): how brightly the foliage GLOWS in its own right — single-scatter radiance from the SUN's light
    row: { kind: 's', label: 'foliage glow', min: 0, max: 1, step: 0.01, rebuild: '' },   // §4.9: single-scatter radiance — the sunlit crown lights up instead of only filtering
    travels: 'morph',   // layer heights + branch-shadow darkness + the sky view's foliage glow — read live, no rebuild
    means: "<b>How much the leaves GLOW rather than just filter.</b> With this at 0 every leaf can only take light away: the canopy is the sky seen through a dim green filter, and a thick crown goes black. Real foliage in daylight does the opposite — sunlight gets into a leaf, bounces around inside it and comes back out in all directions, so a crown with the sun on it is <i>brighter</i> than a shaded one against the same sky, and it glows green-gold. Turn this up for a canopy lit from within. The colour comes from the leaves themselves, not from this knob — this only sets how strong the glow is, and it can never make a crown brighter than the light landing on it. Deep stacks of leaves still go dark, because little light reaches down there in the first place. Switched off once <i>leaf diffuse</i> is up: that measures this glow instead of authoring it — a leaf seen against the sun is a lantern, lit by the sunlight it took out of your line of sight — and counting both would count it twice." },
                                   // reaching each layer from above, on top of the transmitted sky (which already carries the skylight). 0 = pure transmission, byte-identical (a crown can only darken). INERT once leaf_diffuse is up: the leaf is then a lantern and that glow is measured, not authored
  standing_scene: { default: false,   // opt-in: render the trunk as a real vertical occluder (its swept shadow streak)
    row: { kind: 't', label: 'standing scene', rebuild: 'canopy' },   // changes crown sizing (crown0 in regenCanopy) — needs a regrow, not just the live bulk-offset read
    travels: 'mode',
    means: "<b>Treat the trees as objects STANDING in the scene, not a canopy hovering overhead.</b> Turns on the TRUNK shadow — a vertical trunk has no flat footprint, so the normal layered model can't cast it; this draws its real swept shadow streak. Best with a low, raking sun so the streak stretches across the floor. (Rooting the trees off to the side with a lit floor is coming next.)" },
  trunk_radius_m: { default: 0.1,   // trunk thickness (m) → width of its shadow streak; the area light softens it along its length
    row: { kind: 's', label: 'trunk r', min: 0, max: 0.5, step: 0.01, rebuild: 'bake' },   // the bake's refreshWood re-reads the radius from the grown skeleton: no leaf moves
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>How thick the trunk is</b> — i.e. how wide its shadow streak. The streak softens and widens toward its far end on its own, because the higher part of the trunk is blurred more by the sun's size. 0 = no trunk shadow." },
  faithful_canopy: { default: false,   // FAITHFUL TREE (spec §4.5): opt out of the depth-layer leaf cheat. Off = leaves binned to a
    row: { kind: 't', label: 'faithful tree', rebuild: 'textures' },
    travels: 'mode',
    means: "<b>Cast the real tree, not the depth-layer shortcut.</b> Off: leaves are binned to a few flat height-slices (cheap, and invisible for the overhead park — you never see the tree itself there). On: every leaf casts from its OWN grown height, so the shadow you see IS the tree in the preview — leaves sit on their twigs, lined up with the trunk. Costs more (a per-sample bake); meant for the standing / curtain looks, not the park." },
                                   // few flat slabs (the park fast path, byte-identical). On = each leaf casts from its OWN continuous
                                   // grown height (a per-sample geometry bake), so the cast shadow IS the preview tree — leaves sit on
                                   // their twigs, aligned with the woody occluder. Costs more; for the standing / curtain looks, not the park.
  // Receiver (curtain handoff / spec §4.x): the surface the LANDED IRRADIANCE answers. 0 = opaque diffuse FLOOR
  // (the park default — reflect off uGround; byte-identical). 1 = translucent woven CURTAIN — TRANSMIT the
  // irradiance through moss-velvet: Tt carries brightness, the dye only hue, so a dark velvet reads dim (not a
  // bright tinted gel). 2 = the ENCLOSURE (§4.9): the same fabric, but an A-frame stood AROUND the viewer — sloped
  // panels ray-cast per pixel, each lit by its own incidence on the sun. Only read when receiver≠0; the floor
  // stays the cheap fast path. Off → every look unchanged.
  receiver: { default: 0,
    row: { kind: 'sel', label: 'receiver', choices: [['floor',0],['curtain',1],['tent',2]], rebuild: 'textures' },   // curtain handoff: the surface the light lands on — floor reflects, curtain transmits (moss velvet), tent stands that same cloth around you. 'textures': the tent forces the layer cast (faithfulOn), so a faithful look's layer textures and its grove's packing are made anew, as the faithful toggle's are
    travels: 'mode',
    means: "<b>What surface the light lands on.</b> <i>Floor</i> — the light reflects off the ground (every existing look; unchanged). <i>Curtain</i> — the light passes THROUGH a translucent woven moss-velvet curtain, lit from behind, the way sunset glows through a bedroom drape. (Shipped: transmission, the standing-plane projection, the aperiodic drape folds with their warp of the cast pattern, the velvet sheen, the forward-scatter glow, and the window — mullion grid + aperture with dark wall beyond. Still to come: the lateral glow blur and the directional nap.) <i>Tent</i> — the same cloth, but stood AROUND you: a pitched A-frame with its ridge overhead, seen from inside, sloped panels running off into the distance. Each panel catches the sun at its own angle, so one side is bright and the other dim — the thing a flat wall can never do. The tent knobs below shape it; the window and the mullion bars are curtain-only and switch themselves off here." },
  fabric_tt: { default: 0.5,   // fabric total throughput Tt∈[0,1] = BRIGHTNESS (sheer→~0.6, dark terciopelo→~0.1); hue is separate
    row: { kind: 's', label: 'fabric Tt', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // the receiver's fabric (handoff): brightness Tt + moss dye hue — continuous, tween live (the `receiver` gate itself is a scene-mode flag; see MODE_KEYS)
    was: ['curtain_tt'],
    means: "<b>How much light the curtain lets through (its brightness).</b> Low = a thick dark velvet that only the hottest dapples punch through; high = a thin sheer the sun floods. Brightness only — the colour is set separately below, so a dark green velvet stays dark instead of glowing." },
  // moss dye HUE (unit-peak; passes green ~550nm, absorbs red/blue — the chlorophyll-twin)
  fabric_tint_r: { default: 0.35,
    row: { kind: 's', label: 'moss R', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // the receiver's fabric (handoff): brightness Tt + moss dye hue — continuous, tween live (the `receiver` gate itself is a scene-mode flag; see MODE_KEYS)
    was: ['curtain_tint_r'],
    means: "<b>How much RED the curtain dye passes.</b> Keep it low for moss — the dye drinks red, leaving the green. Only the hue matters here; the overall brightness is the Tt knob above." },
  fabric_tint_g: { default: 1.0,
    row: { kind: 's', label: 'moss G', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // the receiver's fabric (handoff): brightness Tt + moss dye hue — continuous, tween live (the `receiver` gate itself is a scene-mode flag; see MODE_KEYS)
    was: ['curtain_tint_g'],
    means: "<b>How much GREEN the curtain dye passes.</b> High for moss velvet — green is what leaks through, so the body of the curtain glows green-gold against the sunset." },
  fabric_tint_b: { default: 0.30,
    row: { kind: 's', label: 'moss B', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // the receiver's fabric (handoff): brightness Tt + moss dye hue — continuous, tween live (the `receiver` gate itself is a scene-mode flag; see MODE_KEYS)
    was: ['curtain_tint_b'],
    means: "<b>How much BLUE the curtain dye passes.</b> Low for moss. Nudge it for a cooler or warmer green." },
  cloth_distance_m: { default: 0.0,   // curtain plane world-Y (its distance behind the tree); with the sun angle, sets where the tree's shadow lands on the cloth (§4.9)
    row: { kind: 's', label: 'cloth dist', min: -20, max: 20, step: 0.1, rebuild: '' },
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    was: ['curtain_distance_m'],
    means: "<b>How far the curtain hangs from the tree.</b> The curtain is a standing wall; this slides it nearer or further along the ground, which — together with the sun's angle — sets where the tree's shadow lands on the cloth. Nudge it (with the sun angle and the pan) to frame the shadow on the curtain." },
  fold_depth: { default: 0.0,   // curtain drape: pleat SHADING — authored pile thickness on a flat plane (0 = flat cloth, up = deep velvet pleats); the geometry is fold_warp
    row: { kind: 's', label: 'drape', min: 0, max: 2, step: 0.01, rebuild: '' },
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    means: "<b>How draped the curtain is.</b> 0 = a flat sheet; up = the cloth hangs in deep vertical pleats. The pleats darken where the fabric turns edge-on (so more velvet to shine through) — the bright/dark folds of a real hanging curtain. This knob only <i>shades</i> the folds, though — <i>pleat depth</i> below is the one that pushes the cloth out into the room and bends the shadow over it." },
  fabric_nap: { default: 0.0,   // the fabric's fine grain, added to the pile's own (±0.04·min(fold_depth,1)): the amplitude of a fine vertical ripple in the cloth's
    row: { kind: 's', label: 'grain', min: 0, max: 0.1, step: 0.005, rebuild: '' },
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    means: "<b>The cloth's fine grain.</b> A fine vertical ripple in how much light the fabric lets through, on top of the pile's own. 0 = only the pile's (none on a taut nylon); 0.04 a clear grain; 0.08 reads as printed pinstripes." },
                                   // transmission, so a taut cloth with no pile (the tent's nylon) can still show a grain. 0 = the pile's alone; 0.04 is a clear grain, 0.08 pinstripes
  fold_scale: { default: 2.5,   // curtain drape: pleat frequency (how many pleats across the cloth)
    row: { kind: 's', label: 'pleats', min: 0.3, max: 12, step: 0.1, rebuild: '' },
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    means: "<b>How many pleats.</b> Low = a few broad waves; high = many tight gathers. Like choosing how full the curtain is bunched on its rod." },
  fold_coarsen: { default: 0.25,   // curtain drape: how much the pleats widen toward the hem (heavy fabric, λ∝√depth)
    row: { kind: 's', label: 'pleat coarsen', min: 0, max: 2, step: 0.02, rebuild: '' },
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    means: "<b>How the pleats widen toward the bottom.</b> A heavy curtain has tight gathers at the rod that merge into broad waves at the hem (gravity). 0 = even pleats top to bottom; up = they spread out lower down." },
  fold_warp: { default: 0.0,   // pleat GEOMETRY (§4.9): metres the pleat bulges out of the cloth plane, which BENDS the arriving
    row: { kind: 's', label: 'pleat depth (m)', min: 0, max: 0.3, step: 0.005, rebuild: '' },   // GEOMETRY (§4.9): displaces the cloth, so the cast bends — 'drape' above only shades it
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    means: "<b>How far the pleats stand out of the cloth — and so how much the shadow bends over them.</b> The two fold knobs are different things and it's worth knowing which is which: <i>drape</i> only paints the folds on (dark where the cloth turns edge-on), while this one actually pushes the fabric out toward the room. That matters because a pleat sticking out catches the light a little earlier than the flat cloth beside it, so the leaf shadows and the window bars S-bend as they cross each fold instead of running dead straight over a picture of one. 0 = a flat sheet; a few centimetres is a real curtain." },
                                   // cast (dapples + mullion lines S-bend across the folds). Distinct from fold_depth, which is the
                                   // authored pile-thickness SHADING band on a flat plane — depth shades, warp displaces. 0 = flat cloth.
  velvet_sheen: { default: 0.0,   // velvet grazing sheen on the fold ridges (0 = off; the cut-pile glow that reads as terciopelo)
    row: { kind: 's', label: 'velvet sheen', min: 0, max: 1.5, step: 0.01, rebuild: '' },
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    means: "<b>The velvet glow.</b> The soft pale sheen that catches on the front of each fold — the giveaway of a standing-fibre pile (terciopelo) rather than a flat dyed sheet. 0 = matte; up = a richer velvet shine on the ridges." },
  fabric_scatter: { default: 0.0,   // forward-scatter share of the transmit: how much of the light DIFFUSES through the pile instead of threading it (0 = all ballistic, byte-identical; up = the glow wraps into the dark fold flanks)
    row: { kind: 's', label: 'pile scatter', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // curtain plane position + drape/velvet (shading) + the pleat GEOMETRY warp + the forward-scatter split — continuous live look uniforms (only read in curtain mode)
    was: ['curtain_scatter'],
    means: "<b>The soft glow that fills the dark pleat flanks — the velvet lit from within.</b> 0 = only the direct thread-through, so every fold that turns edge-on goes black. Light gets through backlit pile two ways: some of it threads the fibres straight (very picky about angle, which is why the edge-on flanks kill it), and the rest bounces around inside the pile and comes out diffused, spreading almost every way at once — so a fold's angle barely dims it. This knob is the share that takes the second route. It doesn't add light, it splits the light already coming through, so the cloth can never end up brighter than what falls on it." },
  // LATERAL DIFFUSION (§4.9): the neighbour-reading half of the same physics — light spreading sideways THROUGH the
  // weave, which is the only thing that bleeds a hot dapple's glow across its own cast-shadow edge. THE GATE, and an
  // expensive one: >0 routes the frame through a linear-HDR target + two blur passes + a compositing tone-map tail.
  // 0 = the direct-to-screen draw, bit-identical, no extra passes allocated or run.
  glow_bleed: { default: 0.0,   // the SPLIT: out = mix(sharp, blurred, d) — energy-conserving, never an add (the forward-scatter wrap's discipline, one scale up)
    row: { kind: 's', label: 'glow bleed', min: 0, max: 1, step: 0.01, rebuild: '' },   // THE GATE (§4.9): >0 routes the frame through linear HDR + two blur passes + a compositing tone-map
    travels: 'morph',   // lateral-diffusion glow (§4.9): the sharp/blurred split + its cloth-metre radius. Continuous, so they tween — but the split crossing 0 adds/drops the HDR passes mid-tween, which is a pass-count change, not a look pop
    was: ['curtain_diffuse'],
    means: "<b>The glow that bleeds ACROSS a shadow edge — the haze the pile-scatter knob can't make.</b> Light doesn't only pass straight through cloth, it also travels sideways inside the weave, so a hot patch spills a little of itself into the dark right beside it. That's the difference between a light patch that reads as a hard spotlight and one that reads as a soft glowing haze — and the reference photo has both in the same frame. 0 = off and nothing changes. Up = the bright patches grow halos and the shade next to them lifts. It splits the light rather than adding any, so the picture never gets brighter overall, just softer where it's hot. The expensive one: it's the only effect here that has to look at neighbouring pixels, so it costs real frame time." },
  glow_bleed_m: { default: 0.08,   // how far the weave carries light, in cloth METRES (weave-scale: ~0.03–0.15); converted to a pixel radius through the cloth mapping, so a zoom doesn't change the physics
    row: { kind: 's', label: 'bleed (m)', min: 0, max: 0.2, step: 0.005, rebuild: '' },   // how far the weave carries the light, in cloth metres
    travels: 'morph',   // lateral-diffusion glow (§4.9): the sharp/blurred split + its cloth-metre radius. Continuous, so they tween — but the split crossing 0 adds/drops the HDR passes mid-tween, which is a pass-count change, not a look pop
    was: ['curtain_diffuse_m'],
    means: "<b>How far the weave carries the light sideways.</b> Measured in centimetres of actual cloth, not pixels, so zooming the camera doesn't change the physics — a thin tight nylon carries it a couple of centimetres, a thick loose weave further. Small = a tight halo hugging each bright patch; large = a broad wash that softens the whole cast. Very large values stop growing (the blur only has so many samples to spend), so if pushing it does nothing you've hit that ceiling." },
  // WINDOW MULLION GRID (§4.9): the AUTHORED occluder, the inverse of the grown canopy — a rigid bar grid standing
  // centimetres off the cloth, so it sits deep in the SHAPE regime (you see the grid, sharp) while the tree's leaf-gaps
  // metres away stay pinhole (soft sun-images). Same sun, one frame, opposite regimes — set purely by occluder distance.
  // Analytic in cloth (u,v), the near-contact sibling of §4.5's woody occluder, so it works in BOTH curtain tiers.
  mullion_tau: { default: 0.0,   // bar optical depth — THE GATE (0 = no window, byte-identical); ~2–3 reads as opaque painted wood
    row: { kind: 's', label: 'window bars', min: 0, max: 6, step: 0.05, rebuild: '' },   // the gate: 0 = no window grid (analytic cloth-space occluder, curtain only)
    travels: 'morph',   // window mullion grid (§4.9): analytic cloth-space occluder — continuous live uniforms, tau 0 = off
    means: "<b>Puts a window in front of the curtain — the grid of bars whose shadow falls across the cloth.</b> 0 = no window. Up = darker, more solid bars. This is the curtain's signature shot: the bars sit centimetres off the cloth, so the sun draws them SHARP, while the tree's leaf-gaps metres away stay soft round sun-images. Same sun, same frame, two different kinds of shadow — and the only thing that decides which is how far the thing casting it stands from the cloth." },
  mullion_pitch_m: { default: 0.35,   // pane size: bar-to-bar spacing on the cloth (a sash window's 30–40 cm panes)
    row: { kind: 's', label: 'pane (m)', min: 0.05, max: 2, step: 0.01, rebuild: '' },
    travels: 'morph',   // window mullion grid (§4.9): analytic cloth-space occluder — continuous live uniforms, tau 0 = off
    means: "<b>How big the window panes are</b> — the spacing from one bar to the next. A sash window is about 0.3–0.4 m. Small = a many-paned cottage window; large = a few big sheets of glass." },
  mullion_bar_m: { default: 0.025,   // glazing-bar width (m)
    row: { kind: 's', label: 'bar (m)', min: 0.002, max: 0.15, step: 0.001, rebuild: '' },
    travels: 'morph',   // window mullion grid (§4.9): analytic cloth-space occluder — continuous live uniforms, tau 0 = off
    means: "<b>How thick the glazing bars are.</b> Thin = a delicate steel-framed window; thick = chunky painted wood. Just the width of the dark line each bar draws on the cloth." },
  mullion_depth_m: { default: 0.04,   // how far the bars stand IN FRONT of the cloth (sun side) — sets BOTH the throw and the penumbra
    row: { kind: 's', label: 'bar depth (m)', min: 0, max: 0.5, step: 0.005, rebuild: '' },
    travels: 'morph',   // window mullion grid (§4.9): analytic cloth-space occluder — continuous live uniforms, tau 0 = off
    means: "<b>How far the window stands off the curtain.</b> The knob that makes it a WINDOW and not a print. Two things move together, both real: the grid slides a little (its shadow is thrown by the sun like everything else, just barely, because it's so close), and its edges soften — the further off the cloth, the blurrier, exactly the way the distant leaves are blurry. Push it far enough and the bars go soft too." },
  // THE WINDOW APERTURE (§4.9): the light has an EDGE. A finite bright rectangle of sky at the bar plane, opaque
  // wall around it — the macro contrast the §1 scene is built on, and the window FRAME the mullion grid was missing.
  window_w_m: { default: 0.0,   // aperture width (m) on the cloth — THE GATE with the height: w·h = 0 = infinite light, byte-identical
    row: { kind: 's', label: 'window w (m)', min: 0, max: 8, step: 0.05, rebuild: '' },   // the gate: w×h = 0 = no aperture, the light runs to infinity (every look before this one)
    travels: 'morph',   // the window APERTURE (§4.9): the finite lit rectangle + its wall leak — continuous live uniforms, w·h = 0 = infinite light
    means: "<b>How wide the window is — the light stops having an edge and gets one.</b> 0 (either side) = the old behaviour: bright to infinity, bars tiling the whole frame like a fishnet. Give it a width and a height and the glow becomes a real rectangle of sky with dark wall around it, which is most of what makes the shot read as a bedroom at sunset rather than a green field. The frame is the aperture edge itself, and it bends over the pleats exactly like every other shadow does." },
  window_h_m: { default: 0.0,   // aperture height (m)
    row: { kind: 's', label: 'window h (m)', min: 0, max: 8, step: 0.05, rebuild: '' },
    travels: 'morph',   // the window APERTURE (§4.9): the finite lit rectangle + its wall leak — continuous live uniforms, w·h = 0 = infinite light
    means: "<b>How tall the window is.</b> Together with the width it's the on/off switch — either one at 0 means no window at all. A tall narrow aperture reads as a sash or a French door; a wide short one as a kitchen window over the sink. Try it a touch taller than you think: the top edge is usually the one you see." },
  window_cx_m: { default: 0.0,   // aperture centre across the cloth
    row: { kind: 's', label: 'window x', min: -10, max: 10, step: 0.05, rebuild: '' },
    travels: 'morph',   // the window APERTURE (§4.9): the finite lit rectangle + its wall leak — continuous live uniforms, w·h = 0 = infinite light
    means: "<b>Slide the window sideways behind the curtain.</b> Nothing moves on the cloth itself, only the patch of light behind it — so the pleats stay put and the bright rectangle wanders across them." },
  window_cy_m: { default: 1.3,   // aperture centre up the cloth (a sill about waist-high)
    row: { kind: 's', label: 'window y', min: -10, max: 10, step: 0.05, rebuild: '' },
    travels: 'morph',   // the window APERTURE (§4.9): the finite lit rectangle + its wall leak — continuous live uniforms, w·h = 0 = infinite light
    means: "<b>Slide the window up and down.</b> This is the sill height, effectively. Low = you're looking at a window you'd sit beside; high = the light comes from over your head and the cloth below is all dim wall." },
  window_wall: { default: 0.03,   // light landing OUTSIDE the aperture: the wall is opaque, so this stands in for the room's own dim
    row: { kind: 's', label: 'wall leak', min: 0, max: 0.5, step: 0.005, rebuild: '' },
    travels: 'morph',   // the window APERTURE (§4.9): the finite lit rectangle + its wall leak — continuous live uniforms, w·h = 0 = infinite light
    means: "<b>How much light still reaches the cloth outside the window.</b> The wall behind is opaque, so strictly this should be nothing — but the room you're in has its own dim light on this side of the curtain, and without a little of it the surround goes to a flat black void instead of dark cloth you can still read the folds in. A few percent is usually right." },
                                   // front-side light — without it the surround is a void rather than dark cloth
  // THE ENCLOSURE (§4.9), receiver 2: the same fabric as a CLOSED tent stood AROUND the viewer — a flat rectangular
  // crown along the top, a rounded ARCH per side (a convex profile curve sampled as tangent strips), and a HIP CAP at
  // each end (a small upright foot-vent triangle with two hips converging on its apex): fifteen planes. The near cap is
  // behind the eye, so no frame shows it.
  // These twelve shape it; the fabric itself is the curtain family above (same cloth physics, same transmission law).
  // Only read when receiver == 2 — the floor and the curtain never touch them.
  tent_ridge_h_m: { default: 1.15,   // crown height (m): the flat top panel's plane, and what the upper walls lean in to
    row: { kind: 's', label: 'crown h (m)', min: 0.4, max: 3, step: 0.05, rebuild: '' },   // the enclosure's polytope (receiver 'tent'): crown plane, arch run, crown flat, length, end lean, the foot hip cap
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How high the flat crown panel sits overhead</b> (receiver <i>tent</i>). This, the half-width below and the shoulder set the wall profile: a high crown over a narrow floor gives steep walls standing up close, a low one over a wide floor gives a flat shelter you can barely sit up in." },
  tent_half_w_m: { default: 1.1,   // half the floor width (m): the skirts reach the ground at x = ±this
    row: { kind: 's', label: 'half width (m)', min: 0.4, max: 3, step: 0.05, rebuild: '' },
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How far the side walls reach out where they meet the ground</b> (receiver <i>tent</i>) — half the floor width. Widen it and the skirt lies back; narrow it and it stands up steep and close." },
  tent_crown_w_m: { default: 0.35,   // HALF the crown panel's width (m) — the brow pole's flat. 0 collapses it to a ridge line (the v1 A-frame)
    row: { kind: 's', label: 'crown w (m)', min: 0, max: 1.5, step: 0.01, rebuild: '' },   // 0 = no flat top, the walls meet in a ridge line (the v1 A-frame)
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How wide the flat panel along the top is</b> — half of it, so 0.35 is a 70 cm crown. This is the brow pole's flat, the thing that makes a modern tent feel roomier than an old ridge tent: instead of two slopes pinching to a line above you, there's a real ceiling. At 0 it collapses to a ridge line and you're back in a boy-scout A-frame." },
  tent_shoulder_h_m: { default: 0.62,   // height (m) of the ARCH's waypoint — where the vault bulges widest. Held inside [0.30, 0.70]·crown height, outside which the profile doubles back on itself
    row: { kind: 's', label: 'arch h (m)', min: 0.1, max: 2.5, step: 0.01, rebuild: '' },   // the arch's widest point; clamped into [0.30,0.70]x crown height, outside which the profile doubles back
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How high the side walls bulge widest.</b> Each side is a smooth arch — a bent pole with fabric stretched over it — and this is where along its climb the arch reaches furthest out. Low puts the belly near the floor and leaves a long lean-in above; high pushes it up under the ceiling. It's held between 30% and 70% of the crown height, outside which the curve would fold back over itself." },
  tent_shoulder_w_m: { default: 0.92,   // half-width (m) AT that height. BULGED past the straight base→crown line (0.70 m here) is what curves the side out into an arch; on the line exactly the arc flattens to one straight slope
    row: { kind: 's', label: 'arch bulge (m)', min: 0.2, max: 3, step: 0.01, rebuild: '' },   // clamped UP to the straight base->crown line: below it the arc curves the wrong way and would slice the crown off
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How far the side walls bulge out at that height.</b> This is the roundness knob: it's what makes a modern tent feel like a room instead of a wedge, the walls swelling out at elbow height and tucking back in above. Widen it for a fatter, roomier arch. It won't go below the straight line from floor to ceiling — at that line the arch flattens into a plain slope, and narrower than it the wall would curve the wrong way and start cutting the ceiling away." },
  tent_len_m: { default: 2.3,   // tent length (m): the far cap's base, and what closes the space instead of a vanishing point. The eye rides at 30 % of it
    row: { kind: 's', label: 'length (m)', min: 0.8, max: 8, step: 0.1, rebuild: '' },
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How long the tent is</b> — and, more to the point, where the far end wall stands. You sit 30% of the way down it, so most of this is the space in front of you. Short = the far wall looms close; long = it recedes, but it never disappears, which is the point." },
  tent_end_lean: { default: 0.6,   // metres an end wall leans OUT per metre of height (0 = a vertical end wall); large values push the ends away and degenerate toward the A-frame
    row: { kind: 's', label: 'end lean', min: 0, max: 2, step: 0.02, rebuild: '' },
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How much the end walls lean outward as they drop.</b> 0 = flat vertical walls at each end, like a box. Up = the ends splay out toward the floor the way a real tent's fly does, so the end reads as a leaning plane rather than a painted backdrop." },
  tent_end_apex_h_m: { default: 0.55,   // height (m) of each end's VENT APEX: the foot triangle stands from the floor up to here, and the two hips converge on it
    row: { kind: 's', label: 'vent apex (m)', min: 0.05, max: 2, step: 0.01, rebuild: '' },   // the top of the foot triangle, and where the two hips converge
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How high the little triangle at the foot end stands.</b> The far end is not one flat wall: down at the floor there's a small upright triangle — the foot vent — and above it two panels slope up and away to the ceiling, meeting the triangle exactly at its point. This is where that point sits. Low = a squat vent under a lot of sloping roof; high = a tall triangle and short slopes. Push it near the ceiling and the slopes vanish and you're back to one flat end wall." },
  tent_hip_rake: { default: 0.45,   // how much MORE steeply the hips (both ends) rake back than the end wall (m per metre of height). 0 puts all three far planes on one — the single leaning slab this replaced — so it is floored just above that
    row: { kind: 's', label: 'hip rake', min: 0.15, max: 2, step: 0.01, rebuild: '' },   // how much faster the hips rake back than the end wall; floored so they never coincide with it
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How steeply the two panels above the foot vent slope away.</b> They have to lean back faster than the end wall does, or there's nothing for them to cut — so this is the extra. Small = a long shallow roof running almost to the end; large = the ceiling stops short and the end is mostly slope. It's what draws the seam down the middle of the ceiling and the two lines that split off it above the vent's point." },
  tent_eye_h_m: { default: 0.5,   // eye height (m) inside — sitting up in a sleeping bag; clamped strictly inside every panel, or the viewer is outside their own tent
    row: { kind: 's', label: 'eye (m)', min: 0, max: 2, step: 0.05, rebuild: '' },
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How high you're sitting inside the tent.</b> Low = lying down, the crown far overhead and the walls sweeping past you; high = sitting up with your head near the ceiling. It's held just inside every panel — past one you'd be outside your own tent and there'd be nothing to see." },
  tent_fade: { default: 0.06,   // interior depth fade (1/m): a gentle depth cue down a metres-deep tent — the far cap is what closes the space
    row: { kind: 's', label: 'depth fade', min: 0, max: 0.4, step: 0.005, rebuild: '' },
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>How fast the fabric dims with distance.</b> A gentle depth cue: the far end wall is what actually closes the space, so this just keeps the near fabric a touch brighter than the far, the way real light in a small space falls off. Too much and the far end goes murky." },
  tent_seam: { default: 0.0,   // panel-junction seam optical depth (0 = none): the dark taped lines at the crown's long edges, the ceiling's centreline spine at the foot, and the cap rims
    row: { kind: 's', label: 'ridge seam', min: 0, max: 6, step: 0.05, rebuild: '' },   // the gate: 0 = no seam
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>The dark taped seams where the panels meet.</b> 0 = none, the whole tent is one continuous sheet. Turn it up and every junction draws — the two long edges of the ceiling running away from you, the seam down the ceiling's centreline at the foot end and the two lines it splits into over the vent, the rims where the ends meet the roof. It's the strongest cue that you're inside a made object of panels and not a smooth painted shell." },
  tent_mesh: { default: 0.0,   // how much the side panels ABOVE the shoulder hem are MESH rather than nylon: they pass less light and diffuse almost none of it (0 = one fabric all the way up, byte-identical)
    row: { kind: 's', label: 'mesh band', min: 0, max: 1, step: 0.01, rebuild: '' },   // per-panel MATERIAL: the sides above the shoulder hem turn to mesh
    travels: 'morph',   // the ENCLOSURE receiver's polytope (§4.9): every one is a live shader uniform read per pixel, so they tween — reshaping the tent around the viewer needs no rebuild (the `receiver` gate that selects it is the scene-mode flag)
    means: "<b>Turns the side panels above the widest point into mesh.</b> A real tent isn't one fabric: it's solid nylon up to about elbow height and dark no-see-um mesh above that, and the hard line between them is one of the first things your eye finds from inside. Mesh lets less light through, and — this is the part you actually see — it barely scatters what it does let through, so instead of the soft glow the nylon gives you the dapples come through the band crisp and the band itself reads darker. 0 = one fabric all the way up. The wall doesn't bend at the hem, it just changes material, so the light still rolls smoothly around the curve across it." },
  far_smear: { default: 3.0,   // far-field dapple smear: extra throw (m) per unit foreshortening; 0 = off, no effect top-down
    row: { kind: 's', label: 'far smear', min: 0, max: 8, step: 0.25, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Far-field smear — distance softening.</b> A far pixel covers a big patch of ground, so its dapples should melt into soft down-sun streaks while the near floor stays crisp. Higher = more melt (and less far-field shimmer). Has no effect top-down — it grows with the tilt." },
  park_throw: { default: 0.0,   // the overhead park's shear (§4.8): each layer thrown down-sun by its height·cot(elevation), the throw a standing scene always has, × this (0..1).
    row: { kind: 's', label: 'park shear', min: 0, max: 1, step: 0.01, rebuild: '' },   // the park's shear: off by default; on the overhead park only
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Park shear — each canopy layer thrown down-sun by its height.</b> Real under a low sun (leaves at different heights land in different places), but off by default: with far smear up it slashes the floor into sharp down-sun streaks. A mood to choose, not a default." },
                                   // Physically real (leaves at different heights land at different places under a low sun) but off by default: with far_smear it streaks the floor
                                   // into sharp down-sun slashes, an artistic look to choose, never to land on. 0 = the park as it was, to the bit
  exposure: { default: 1.656,   // 1.3 re-sat over the default sun's cosine law and air's loss (× 0.819 × 0.958), so the default floor shows as it did
    row: { kind: 's', label: 'exposure', min: 0, max: 12, step: 0.01, rebuild: '' },   // reaches every shipped look: the cosine law and the air's loss re-sit a low or raking sun's exposure up to ~10 (trippy shadow)
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Brightness.</b> How bright the floor is. Pure look — it never changes the light simulation, just where it lands on screen." },
  cloud_exposure: { default: 0.0,   // a thicker cloud brightens the frame: exposure × (1 + this·cloud_thickness), as an eye opens up under a passing cloud.
    noRow: 'authored per look',
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Does the picture open up under a cloud?</b> A thicker cloud brightens the frame by exposure × (1 + this · cloudiness), as an eye opens up under a passing cloud. Authored per look." },
                                   // A look is authored at its own cloud with its exposure re-sat by it, so only a change of cloud shows. 0 = off
  contrast: { default: 1.0,
    row: { kind: 's', label: 'contrast', min: 0.3, max: 2, step: 0.01, rebuild: '' },
    travels: 'morph',   // Wood stores radius and layer heights in CPU geometry as well as live uniforms. refreshWood keeps those numbers aligned without regrowing the leaves; a faithful or sky bake refreshes when its wood changes.
    means: "<b>Punch.</b> Higher = bold, snappy dapples; lower = the flat, milky look of haze." },
  ambient_skylight: { default: 0.3925,   // 0.5 brought down by as much as exposure went up, so the default shade stays where it was
    row: { kind: 's', label: 'ambient', min: 0, max: 3, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How much the sky fills the shadows.</b> The light that isn't direct sun — now coloured for real (blue by day, warmer at dusk). Up = softer, lifted shade; down = deep, moody shadows." },
  // THE SKY FILL (spec §4.7, "What the shade is lit by"): the shade between the dapples is lit by the skylight that
  // came THROUGH the canopy and by the sunlight the lit leaves scatter downward, not by an unfiltered sky. 0 = the
  // old floor, literally `(acc·sun + ambient)·ground` — the quality-rung gate, ships shut because presets merge over
  // these defaults (a 1 here would relight every shipped look); a look opts in. 1 = the physical shade.
  canopy_fill: { default: 0.0,
    row: { kind: 's', label: 'canopy fill', min: 0, max: 1, step: 0.01, rebuild: '' },   // §4.7: the shade lit THROUGH the canopy — the gate; 0 is the old floor, byte for byte
    travels: 'morph',   // the sky fill (§4.7): two live shader uniforms — the receiver's mix and the leaf albedo the fill pass reads — so they tween; the canopy_fill gate crossing 0 allocates the fill lazily, mid-tween, which is not a look pop
    means: "<b>Light the shade THROUGH the leaves, not around them.</b> The sky that fills the shadows has to come through the canopy too — and the leaves the sun is on scatter some of it down. With this at 0 the shade is lit by an open sky: under a red autumn canopy that is a red beam on a blue-lit floor, and the shade goes magenta. At 1 the sky is filtered by the same leaves, so the shade takes their colour (green in summer, red in fall) and is dimmer — raise <i>ambient</i> or exposure about half a stop to sit a look back where it was. The curtain and the tent take the filtered skylight too; the scattered light only comes with <i>leaf diffuse</i>." },
  fill_scatter: { default: 0.0,   // the leaf's single-scattering albedo: the floor's twin of sky_scatter (§4.9), read only on the floor. 0 = the shade is filtered skylight and nothing else. INERT once leaf_diffuse is up: that is this light, measured instead of authored
    row: { kind: 's', label: 'leaf scatter', min: 0, max: 1, step: 0.01, rebuild: '' },   // the leaf's albedo: the floor's twin of 'foliage glow'; the floor alone reads it, and not at all once leaf diffuse is up
    travels: 'morph',   // the sky fill (§4.7): two live shader uniforms — the receiver's mix and the leaf albedo the fill pass reads — so they tween; the canopy_fill gate crossing 0 allocates the fill lazily, mid-tween, which is not a look pop
    means: "<b>How much sunlight a leaf bounces back down — an authored stand-in for the light it passes.</b> Keep it low: 0.1–0.25 sat right against a beam that was already carrying the leaf's light. The shade is coloured by what the leaves <i>pass</i>, not by how bright they are. 0 = the shade is the filtered sky and nothing else. Only the floor reads it; it can never lift the shade past the light that landed on the leaves. Shown while canopy fill is up — and only until <i>leaf diffuse</i> is: that measures this light instead of guessing it, and counting both would count it twice." },
  // A LEAF IS NOT A WINDOW (spec §4.5/§4.6/§4.7): the share d of a leaf's transmitted light that is DIFFUSE — scattered
  // by the mesophyll like frosted glass, not passed like stained glass. The beam keeps only (1−d)·T, as neutral depth
  // k = −ln(1−d) per leaf (a texel is a mixture of one: κ = k·c/a, §4.5 texelMix); the rest is the light the canopy fill hands to the shade (canopy_fill), in the leaf's
  // own colour. Physically ~0.95. 0 = the old, ballistic leaf: the literal old beam and the P0b proxy, byte-identical.
  // It needs canopy_fill to land anywhere on a surface: with the fill shut the diffuse share just leaves the beam. The sky view needs no fill:
  // looking up, a leaf is a lantern (§4.9) — the disk shows through gaps only, and each leaf glows with the light it took out of the line of sight.
  leaf_diffuse: { default: 0.0,
    row: { kind: 's', label: 'leaf diffuse', min: 0, max: 1, step: 0.01, rebuild: '' },   // §4.5: a leaf is not a window — the share of what it passes that is diffuse, not a beam; 0 = the old ballistic leaf, byte for byte
    travels: 'morph',   // a leaf is not a window (§4.5): k = −ln(1−d) is a live uniform on both paths (the layer tap reads it, the faithful cast re-bakes on it), so it tweens — except across 0: the authored scatter proxy (sky_scatter, fill_scatter) is dropped the moment k > 0, so a tween out of 0 snaps that term off (counting both would count the light twice, §4.9)
    means: "<b>A leaf is frosted glass, not stained glass.</b> The light a leaf passes is almost all <i>diffuse</i> — scattered inside the leaf and sent on in every direction — not a sharp coloured picture of the leaf. This is how much: 0 = the old leaf, which paints its colour as a crisp copy of itself inside its own shadow (and overlapping leaves of opposite colours go mud-dark); ~0.95 is a real leaf. Up, the sun-images keep only what travels straight through, so a leaf a few metres up throws a <i>dark</i> shadow, and the rest lands in the shade in the leaf's own colour, spread over the floor under it. It needs <i>canopy fill</i> to land anywhere — with that shut the diffuse light just leaves the sun-images — and it switches <i>leaf scatter</i> off. The curtain and the tent take it too. Looking up, it is the difference between a window and a lantern: with it up the sun's disk no longer shows through a leaf (only through a gap), and each leaf instead glows with the light it took out of your line of sight, in its own colour — it needs no canopy fill, and it switches <i>foliage glow</i> off." },
  edge_area: { default: true,   // on by default; a look from before it was keeps false (GRANDFATHERED, below). the texel read as a mixture at d = 0 too (§4.5): the depth-averaged soft edge is Jensen-dark, and this reads it as part leaf, part sky. A boolean, because a 0..1 blend of two readings of one texel is a transmittance no texel has. INERT above leaf_diffuse 0: the split is already area-correct
    row: { kind: 't', label: 'edge area', rebuild: '' },   // §4.5: the texel read as a mixture at leaf diffuse 0 too (above it every texel already is). A live uniform plus the two signatures (the faithful cast, the fill), so nothing rebuilds
    travels: 'topo',   // a flip moves every soft edge at once; snap it under the bloom.
    means: "<b>Where a leaf's edge is part leaf, part sky.</b> The bake averages a leaf's depth over a soft edge and reads the average as one thin dark leaf, which darkens every edge a little too much. On, the edge is read as it really is — part leaf, part open sky. Rims brighten a touch and the warm fringe cools; it is subtle everywhere. Only while <i>leaf diffuse</i> is 0: above it every edge is already read this way." },
  fill_directions: { default: 16,   // TUNE: the K cosine-weighted rays the fill integrates (stratified in cos²θ, no noise)
    row: { kind: 's', label: 'fill rays', min: 4, max: 64, step: 1, rebuild: '' },   // the sky fill's two TUNE knobs (§4.7): read live at the next bake, no rebuild
    travels: 'topo',   // the sky fill's TUNE pair (§4.7): a ray count and a texture size are integers that cannot interpolate, and the size reallocates
    means: "<b>How many directions of sky each shade point averages.</b> A fixed, evenly spread fan (no noise, no shimmer). More = a smoother, truer fill; fewer = cheaper — it is a bake cost, paid again whenever the leaves move. 16 is plenty for most looks. Shown while canopy fill is up." },
  fill_resolution: { default: 256,   // TUNE: the fill texture's size over its frame — the canopy box in the endless park (which wraps it), the box PADDED by 3·h_max on a finite look (standing_scene or a receiver: the glow decays across the floor, §4.7), so the texel is coarser there. It varies at the scale of crown gaps, not dapples
    row: { kind: 'sel', label: 'fill res', choices: [['128',128],['256',256],['512',512]], rebuild: '' },
    travels: 'topo',   // the sky fill's TUNE pair (§4.7): a ray count and a texture size are integers that cannot interpolate, and the size reallocates
    means: "<b>Resolution of the shade-light map.</b> It varies at the scale of crown gaps, not dapples, so a coarse map is enough, and halving it makes the bake ~4× cheaper. On an endless-canopy look the map covers the canopy box, and wraps (light leaving one side comes in from the other). On a standing tree, the curtain or the tent it covers the box <i>plus a margin of 3× the canopy height</i> on every side — so the glow can fade out across the floor instead of stopping at an edge — and the same pixels spread wider, which makes each one coarser: raise this if its shade looks blocky. Shown while canopy fill is up." },
  litter_resolution: { default: 1024,   // TUNE (§4.7): the carpet's texture size over the fill's own frame (the box in the endless park, the box padded by 3·h_max on a finite tree). RGBA8, so 4 MiB at 1024 (5.3 with its mips). A 10 cm leaf must read as a leaf: raise it for a wide frame
    row: { kind: 'sel', label: 'litter res', choices: [['512',512],['1024',1024],['2048',2048]], rebuild: '' },   // the carpet's texture over the fill's frame (§4.7): a 10 cm leaf must read as a leaf, and a finite tree's frame is wide
    travels: 'topo',   // the carpet (§4.7): a gate that allocates (1x1 <-> res²) and the size it allocates at — neither interpolates, so a look that crosses them dissolves under the bloom rather than popping a carpet in
    means: "<b>Resolution of the leaf carpet.</b> One square over the same ground the shade-light map covers: the canopy box on an endless-canopy look (where the carpet repeats), that box padded on every side for a tree standing in a scene (where it does not). A 10 cm leaf should still read as a leaf, so a wide frame wants more; it costs 4 MiB at 1024 and 16 MiB at 2048, paid once per regrow. Shown while litter is on." },
  sky_turbidity: { default: 0.05,   // atmospheric haze β (Ångström); reddens low sun, desaturates dusk
    row: { kind: 's', label: 'haze β', min: 0, max: 0.5, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>Haze in the air.</b> Clean air = low; dust or humidity = higher, which makes a low sun redder and a sunset more washed-out orange." },
  mesopic_strength: { default: 0.6,   // Purkinje: how far rods cool the deep shade at dusk (0 off; gated to low sun)
    row: { kind: 's', label: 'dusk rods', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How blue the shadows go at dusk.</b> As light fades your eye quietly switches to night vision, which is colour-blind and blue-ish — so the dim shade cools toward grey-blue while the bright dapples stay warm. Only kicks in at low sun. 0 = off." },
  chromatic_aberration: { default: 0.0,   // leaf-edge diffraction (θ∝λ): per-channel red/blue spread of the dapples (0 = off, presets untouched)
    row: { kind: 's', label: 'diffraction', min: 0, max: 6, step: 0.1, rebuild: '' },
    travels: 'morph',
    means: "<b>Prism fringe — red and blue split at the leaf edges.</b> Light bends round each leaf edge by an angle that grows with its wavelength (diffraction, θ∝λ), so red spreads a touch wider than blue and every dapple gains a warm outer rim and a cool core. Rides the same shift as the dapples, so it grows with canopy height and the low-sun stretch for free. 0 = off; ~1 is the true wavelength spread, higher exaggerates." },
  vignette: { default: 0.0,   // the edge fade (§4.7): the frame's light fades to black over the outer `vignette` fraction of its half-extent. THE GATE and the feather: 0 = off, every look byte-identical. A presentation device for the projector (a real throw is a hard rectangle; the yard has no frame), not physics
    row: { kind: 's', label: 'edge fade', min: 0, max: 1, step: 0.01, rebuild: '' },   // §4.7: the projector's soft iris — the frame's light fades to black over the outer fraction; the gate, 0 = off byte for byte
    travels: 'morph',   // the edge fade (§4.7): two live shader uniforms in the post block every camera runs — the feather (also the gate) and the superellipse exponent — so they tween; a presentation device, not a fall tier
    means: "<b>Edge fade — burns the corners.</b> Fades the frame's edges to black so a projected picture pools instead of showing its rectangle; the value is how much of the way in from the edge the fade reaches. 0 = off." },
  vignette_shape: { default: 2,   // the edge fade's superellipse exponent, 2..8: 2 an ellipse touching all four edges, 8 a rounded rectangle. Inert while vignette is 0
    row: { kind: 's', label: 'edge shape', min: 2, max: 8, step: 0.1, rebuild: '' },   // its superellipse exponent: 2 an ellipse touching the edges, 8 a rounded rectangle; inert while the fade is 0
    travels: 'morph',   // the edge fade (§4.7): two live shader uniforms in the post block every camera runs — the feather (also the gate) and the superellipse exponent — so they tween; a presentation device, not a fall tier
    means: "<b>Edge shape.</b> From round (2) to rounded-rectangle (8). Does nothing while the edge fade is 0." },
  tone_map: { default: 2,   // 0 none, 1 reinhard, 2 aces
    row: { kind: 'sel', label: 'tonemap', choices: [['none',0],['reinhard',1],['aces',2]], rebuild: '' },
    travels: 'none',
    means: "<b>How over-bright light is squeezed onto the screen.</b> ACES is the soft, filmy default; Reinhard is simpler; None just clips the brightest bits." },
  // ground albedo (floor reflectance, spec §4.7): white floor by default — a few looks set a warm dirt
  ground_r: { default: 1.0,
    row: { kind: 's', label: 'ground R', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // ground albedo (floor reflectance) — live look uniform, tweens in transitions
    means: "<b>How much RED the ground reflects.</b> Earth is warm, so red leads — it's what makes the floor read as soil rather than concrete. 1 = pure white on this channel." },
  ground_g: { default: 1.0,
    row: { kind: 's', label: 'ground G', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // ground albedo (floor reflectance) — live look uniform, tweens in transitions
    means: "<b>How much GREEN the ground reflects.</b> Mid for brown dirt; raise it toward mossy or grassy ground, drop it for redder clay." },
  ground_b: { default: 1.0,
    row: { kind: 's', label: 'ground B', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // ground albedo (floor reflectance) — live look uniform, tweens in transitions
    means: "<b>How much BLUE the ground reflects.</b> Low for warm dirt; raise it toward grey gravel or cool stone." },
  // Wind — coherent band (spec §5.1)
  wind_pattern: { default: 'gusty',   // broadband CHARACTER (steady|gusty|squally|choppy|lazy) — shape, shared knobs below
    row: { kind: 'sels', label: 'pattern', choices: [['steady','steady'],['gusty','gusty'],['squally','squally'],['choppy','choppy'],['lazy','lazy']], rebuild: '' },
    travels: 'none',
    means: "<b>The character of the wind.</b> Real wind isn't one frequency — it's a whole spread of them at once, and these are different recipes for that spread. <b>steady</b>: smooth rolling breeze. <b>gusty</b>: the natural default. <b>squally</b>: bursty, comes in clustered shoves with deep lulls. <b>choppy</b>: nervous, fine, cold-front edge. <b>lazy</b>: a very slow faint stir. All five read the same knobs below — they just shape them differently." },
  wind_strength: { default: 0.0,   // "how much": mean force amplitude
    row: { kind: 's', label: 'strength', min: 0, max: 2, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How much wind — how hard it blows.</b> 0 = still. Turn it up and the branches bend, fight at the peak of a gust, then snap back." },
  wind_gustiness: { default: 0.25,   // "how alive": turbulence intensity (σ/U) — steady ↔ gusty; deep lulls drive springback
    row: { kind: 's', label: 'gustiness', min: 0, max: 0.6, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How alive vs. steady the wind is.</b> Low = a smooth, near-constant lean; high = it surges and drops, and the deep lulls let the branches swing all the way back through rest (and even past it). This is the 'is it gusty' knob — real open-air wind sits around 0.1–0.25." },
  wind_direction_deg: { default: 30,
    row: { kind: 's', label: 'dir °', min: 0, max: 360, step: 1, rebuild: '' },
    travels: 'morph',
    angle: true,
    means: "<b>Which way the wind blows.</b> The whole dapple pattern drifts and leans this way (slowly wandering off it if 'weather' is up)." },
  gust_frequency: { default: 0.12,   // "how frequent": gust rate = lowest-octave frequency of the broadband signal
    row: { kind: 's', label: 'gust rate', min: 0.01, max: 1, step: 0.005, rebuild: '' },
    travels: 'morph',
    means: "<b>How frequent the gusts are — their rhythm.</b> It sets the slowest, biggest swell; faster gusts and fine flutter layer on top automatically. Low = long, slow swells; high = busier air." },
  weather_variability: { default: 0.0,   // slow self-evolving weather: 0 = static (presets unchanged), up = day drifts calm↔gusty + veers
    row: { kind: 's', label: 'weather', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>Does the wind have a day of its own?</b> 0 = it stays exactly as you set it. Turn it up and a slow 'weather' drifts over minutes — calm spells and gusty spells come and go, and the direction slowly veers — so it's never quite the same twice. (A calm day = low; a gusty Montreal-spring day = high, with strength up too.)" },
  weather_speed: { default: 1.0,   // how fast the weather drifts (minute-scale at 1)
    row: { kind: 's', label: 'weather spd', min: 0.1, max: 4, step: 0.1, rebuild: '' },
    travels: 'morph',
    means: "<b>How fast the weather changes</b> when 'weather' is up — how quickly it drifts between calm and gusty and swings direction." },
  gust_attack: { default: 1.2,   // gust-edge asymmetry: rise time constant — sharper (shorter) than the decay below
    row: { kind: 's', label: 'attack (s)', min: 0.05, max: 5, step: 0.05, rebuild: '' },
    travels: 'morph',
    means: "<b>How quickly a gust builds up.</b> Short = a sudden shove; long = a gentle rise." },
  gust_decay: { default: 2.5,   // gust-edge asymmetry: decay time constant (field gusts rise sharper than they fall)
    row: { kind: 's', label: 'decay (s)', min: 0.05, max: 8, step: 0.05, rebuild: '' },
    travels: 'morph',
    means: "<b>How quickly a gust fades away.</b> Usually slower than it built — that lingering release." },
  sway_stiffness: { default: 5.0,
    row: { kind: 's', label: 'stiffness ω', min: 0.5, max: 15, step: 0.1, rebuild: '' },
    travels: 'morph',
    means: "<b>Springiness of the sway.</b> Stiff = quick, tight, twitchy motion; soft = slow, lazy, big swings." },
  sway_ceiling: { default: 0.4,
    row: { kind: 's', label: 'ceiling (m)', min: 0.05, max: 1.5, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How far the branches can bend.</b> They hit a limit and clip there — that's the feeling of them fighting the wind at a gust's peak." },
  damping_ratio: { default: 0.25,
    row: { kind: 's', label: 'damping ζ', min: 0.02, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How quickly the swaying settles down.</b> Low = springy and ringing; high = sluggish and dead." },
  backlash_gain: { default: 1.0,
    row: { kind: 's', label: 'backlash', min: 0, max: 4, step: 0.05, rebuild: '' },
    travels: 'morph',
    means: "<b>The snap-back when a gust lets go.</b> Branches recoil past their resting point and ring down, instead of gliding gently home. 0 = no snap." },
  sway_height_gain: { default: 0.0,
    row: { kind: 's', label: 'height gain', min: 0, max: 2, step: 0.05, rebuild: '' },
    travels: 'morph',
    means: "<b>Do taller branches sway more than low ones?</b> 0 = the whole canopy slides as one rigid sheet; turn it up and it shears with height, so gaps morph as well as slide. <i>(No effect in faithful-tree mode — there the sway is always anchored at the foot and grows to the crown.)</i>" },
  sway_pitch: { default: 0.0,   // 3-D lean (spec §5/§4.5): how far a limb's own PITCH spring — the second DOF, forced by the drag along the limb — foreshortens the heights of the leaves+wood on it, so they cast a SHORTER shadow. FAITHFUL-mode only (needs real heights); 0 = off, byte-identical (no height change, and the pitch DOF never integrates).
    row: { kind: 's', label: '3D pitch', min: 0, max: 2, step: 0.05, rebuild: '' },
    travels: 'morph',
    means: "<b>Do branches lean in DEPTH as the wind blows, not just sideways?</b> Each limb carries a real pitch spring driven by the wind blowing ALONG it — so a broadside limb yaws downwind first, then flattens as it comes into the wind's line (streamlining), lowering its leaves so they cast a shorter, foreshortened shadow. <i>Faithful-tree mode only; 0 = off.</i>" },
  limb_count: { default: 8,
    row: { kind: 's', label: 'limbs', min: 1, max: 24, step: 1, rebuild: 'canopy' },
    travels: 'topo',   // leaf_shape: a different outline is a different texture and a different quad — it cannot interpolate, and a transition's crossfade bakes the two groves' shapes in one pass; leaf_variety: a 64-row texture and a row a leaf, the same (the step 0 → ε re-deals every outline once, under the bloom)
    means: "<b>How many big arms each tree has.</b> More = the crown splits into finer wedges that can each lean on their own." },
  limb_flex: { default: 0.25,
    row: { kind: 's', label: 'limb bend', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How much the big limbs bend.</b> The slow, broad sway — a whole wedge of the crown swinging together." },
  twig_flex: { default: 0.35,
    row: { kind: 's', label: 'twig bend', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How much the little twigs bend.</b> The faster, finer motion one level down — each clump of leaves swinging a bit differently, so gaps shear and morph." },
  stem_length: { default: 0.5,
    row: { kind: 's', label: 'stem (m)', min: 0, max: 1.5, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>Where a twig bends from.</b> Pivoting a clump from its own middle makes it spin in place (an ugly little whirlpool); offsetting the pivot toward the branch makes it swing like a real twig. Set it to 0 and the whirlpools come back." },
  leaf_swing: { default: 0.7,
    row: { kind: 's', label: 'leaf swing', min: 0, max: 2, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How much each leaf rocks in the wind.</b> A rocking leaf turns edge-on and back, so dapples change shape and blink — not just slide. This is a big part of what makes it read as wind at all." },
  flutter_freq: { default: 1.4,
    row: { kind: 's', label: 'flutter Hz', min: 0, max: 5, step: 0.05, rebuild: '' },
    travels: 'morph',
    means: "<b>How fast the leaves flutter.</b> The quick trembling on top of the slow sway — the glisten." },
  wind_depth: { default: 0.0,   // a faint wind rocks only a crown's skin, a stronger one reaches the inner leaves, a strong one every leaf (komorebi-air.js, depthGate); 0 = off, every leaf rocks as before
    row: { kind: 's', label: 'depth', min: 0, max: 1.5, step: 0.01, rebuild: '' },
    travels: 'morph',   // how far into a crown the wind reaches (komorebi-air.js, depthGate): continuous too
    means: "<b>How far into a crown the wind reaches.</b> Off, every leaf rocks with the wind. On, a faint wind trembles only the leaves on the outside of each crown, a deeper one reaches the inner leaves, and only a strong one moves them all; higher, the wind needs to be stronger to reach as deep." },
  wind_air: { default: 0.0,   // the leaves flutter in the AIR where they hang, a gust carried through the grove with its eddies (komorebi-air.js), instead of with the trunk's sway |u|; 0 = off, the flutter exactly as before
    row: { kind: 's', label: 'air', min: 0, max: 1, step: 0.01, rebuild: '' },
    travels: 'morph',   // the leaves flutter in the air where they hang (komorebi-air.js): continuous, so it eases in a transition
    means: "<b>The leaves flutter in the air where they hang.</b> Off, every leaf trembles with the trunk's sway, so the whole canopy stills at once each time it swings back through rest. On, a gust is carried through the grove at a walking pace, downwind leaves feeling it after upwind ones, and small eddies make neighbours tremble differently. The air keeps moving while a branch recoils." },
  // Leaf drift — incoherent band preview (spec §5.2)
  drift_amount: { default: 0.0,
    row: { kind: 's', label: 'amount (m)', min: 0, max: 0.4, step: 0.005, rebuild: 'bake' },
    travels: 'morph',
    means: "<b>How much the leaves jiggle in place.</b> 0 = frozen; a little = a faint twinkle; a lot = the gaps fully reshuffle, merging and splitting like light on the bottom of a pool." },
  drift_phase: { default: 0.0,
    row: { kind: 's', label: 'phase', min: 0, max: 6.2832, step: 0.01, rebuild: 'bake' },
    travels: 'morph',
    angle: true,
    means: "<b>Scrub the jiggle by hand.</b> Slides every leaf around its little loop. Because it's a loop, the pattern comes right back to where it started each cycle." },
  drift_auto: { default: false,
    row: { kind: 't', label: 'auto', rebuild: '' },
    travels: 'none',
    means: "<b>Let the jiggle run on its own.</b> A hands-free preview of that faint, all-directions wind." },
  drift_speed: { default: 0.4,
    row: { kind: 's', label: 'speed', min: 0, max: 2, step: 0.01, rebuild: '' },
    travels: 'morph',
    means: "<b>How fast the jiggle runs</b> when 'auto' is on." },
  // Debug / runtime
  auto_quality: { default: false,   // watch fps; trim render resolution then samples to hold ~60 fps
    row: { kind: 't', label: 'auto 60fps', rebuild: 'perf' },
    travels: 'none',
    means: "<b>Auto-tunes quality to hold ~60 fps.</b> Drops the cheapest quality first (resolution, then sample count) when things get heavy, and is slow to crank back up. Never touches the look — only the sharpness." },
  adaptive_motion: { default: true,   // TUNE (§9): while motion is low, render the heavy passes at adaptive_idle_fps and re-present the rest. Ships on; set false for the unchanged direct-to-screen path.
    row: { kind: 't', label: 'adaptive fps', rebuild: '' },
    travels: 'none',
    means: "<b>Drop to a lower frame rate while the canopy is nearly still.</b> When the wind lulls (or a look only slow-drifts), the heavy passes run at the idle rate below and the rest are re-presented — big idle saving, with visible stepping on the slow shimmer as the trade. Full rate returns the moment the wind picks up. Off = render every frame." },
  adaptive_idle_fps: { default: 30,   // the reduced cadence adaptive_motion falls to in low-motion frames
    row: { kind: 'sel', label: 'idle fps', choices: [['24',24],['30',30],['48',48]], rebuild: '' },
    travels: 'none',
    means: "<b>The reduced rate 'adaptive fps' falls to</b> in low-motion frames. Lower saves more but steps the slow shimmer more visibly." },
  show_source: { default: true,
    row: { kind: 't', label: 'show source', rebuild: '' },
    travels: 'none',
    means: "<b>Show a little map of the sun</b> you're sampling (centre + glow) in the corner. Watch it change as you move CLOUD or eclipse." },
  show_layer: { default: false,
    row: { kind: 't', label: 'show layer', rebuild: '' },
    travels: 'none',
    means: "<b>Peek at one raw depth-slice</b> of leaf shadows, instead of the finished picture. <i>(Inert in faithful-tree mode — there the canopy isn't baked into depth slices.)</i>" },
  show_layer_index: { default: 0,
    row: { kind: 's', label: 'layer #', min: 0, max: MAX_LAYERS-1, step: 1, rebuild: '' },
    travels: 'none',
    means: "<b>Which slice to peek at</b> when 'show layer' is on (0 = lowest)." },
};

const keysThatTravel = (...ways) => Object.keys(PARAMS).filter((k) => ways.includes(PARAMS[k].travels));

// ---- preset transitions (spec §9 "Scene transitions"). Params split two ways: MORPH ones are
// continuous and read live (or rebuild cheaply), so they tween frame-by-frame; everything else is
// STRUCTURAL — it regrows the grove or reallocates textures, so it can't interpolate and is instead
// snapped once at the transition's bloom peak, hidden under a transient widening of the source. ----
const MORPH_KEYS = keysThatTravel('morph');
const MORPH_SET = new Set(MORPH_KEYS);
const ANGLE_SET = new Set(Object.keys(PARAMS).filter((k) => PARAMS[k].angle));   // interpolate the short way

// ---- canopy morph (the middle tier). With the SAME topology (counts + seed) the grove's RNG draws are
// identical frame-to-frame, so interpolating these continuous canopy knobs deforms the *same* grove
// smoothly (branches fan, leaves recolour/resize) — a true morph, no dissolve. It costs a per-frame
// regrow (or a re-season when only SEASON_KEYS differ, or density reweighting for a fixed summer grove), so it only runs when the grove is small enough (CANOPY_MORPH_MAX leaves); else it falls back
// to the cloud dissolve. A change to any TOPO_KEY genuinely rearranges the grove (a new tree/layer/seed)
// and *can't* morph leaf-for-leaf, so it always dissolves. ----
const CANOPY_KEYS = keysThatTravel('canopy', 'season');
// THE SEASON SET (§4.5, "Re-seasoning"): the canopy keys a tint or phenology change may move without the grove's SKELETON moving — they change only
// each leaf's tau, whether it is still hanging, and what lies on the ground. A grove built with `keepSeason` re-runs exactly these over its
// cached leaves (komorebi-grove.js reseasonGrove); other canopy keys regrow except the separately gated summer density capacity. A subset of CANOPY_KEYS (reseason.test.js holds it).
const SEASON_KEYS = keysThatTravel('season');
// these genuinely re-arrange the grove (different branching / depth / seed) — can't interpolate
const TOPO_KEYS = keysThatTravel('topo');   // (tone_map is a live uniform: it just snaps — under the bloom if one's already running, else at the end — never forces one)
// ---- scene-MODE flags. Not continuous (never tween) but NOT inert either: flipping one changes regen-time state
// (faithful_canopy reallocates faithTex + switches the bake path; standing_scene reshapes the bake's crown sizing;
// receiver swaps the whole camera mapping — floor ray-cast ↔ head-on cloth map ↔ enclosure ray-cast — and both re-aims
// the faithful cast frame and, at receiver 2, forces the layer tier, which reallocates the layer textures too;
// sky_view turns the camera over to look UP, which overrides the receiver outright and forces the layer tier for the
// same reason receiver 2 does — so it reallocates the layer textures and re-packs the grove's per-mode cluster data),
// so a transition landing on a differing flag must force a structural rebuild under the bloom — see transitionTo's
// modeDiff. Kept out of TOPO_KEYS (they don't change the grove RNG/topology) but treated like one for the rebuild. ----
const MODE_KEYS = keysThatTravel('mode');
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
// The shared bake supplies continuity itself; a bloom would send the source through an unnecessary wider halo.
const CROSS_HALF_W = 0.25;   // the window's half-width in t: [0.25, 0.75], centred where the cut used to be
const BLOOM_MAX = { mode: 0.35, dissolve: 0.55, cross: 0.0 };   // the bloom's peak depth by tier — the mode flip's measured in the packet before this one
const DUR_SCALE = { mode: 2.0,  dissolve: 2.0, cross: 2.0 };    // ...and how much longer than the caller's duration each tier takes to get there

// ---- default parameters. The editor edits a live copy; presets merge over this
// so old/partial JSON stays forward-compatible as new knobs are added. ----------
const DEFAULTS = Object.fromEntries(Object.entries(PARAMS).filter(([, d]) => !('input' in d)).map(([k, d]) => [k, d.default]));

// ---- GRANDFATHERED. A look fills every key it does not name from DEFAULTS, so turning a default on changes every look that never
// named that key. Four were turned on together, because each makes the light truer and none costs a measurable frame: sun_cosine
// (0 → 1), sun_extinction (0 → 1), edge_area (false → true) and inner_leaves (0 → 0.35); exposure and ambient_skylight moved with
// the two laws so the default floor and shade show as before. Every built-in look and every look kept online that keeps a feature
// off names its old value; a look that took the laws carries its own re-sat exposure and skylight. The drawback: a look kept
// anywhere else (a browser's local saves, an exported JSON, a page that embeds komorebi with its own params) and saved before
// these were on takes them on the next load, and its sun may read dimmer. Turn them off in the advanced panel to get it back.
const GRANDFATHERED = { sun_cosine: 0, sun_extinction: 0, edge_area: false, inner_leaves: 0, exposure: 1.3, ambient_skylight: 0.5 };   // their values before

// ---- legacy parameter names (spec §9). A ★ look saved to local storage, or a JSON exported from any
// earlier build, is data the engine does not get to re-author — so a renamed knob has to keep loading
// forever. One map, applied at every door external params come through (create / setParams / transitionTo,
// and the editor's preset store). Engine-side there is exactly ONE spelling of each knob: nothing below
// reads an old name, and nothing ever writes one back out. ----
const LEGACY_KEYS = Object.fromEntries(Object.entries(PARAMS).flatMap(([k, d]) => (d.was ?? []).map((w) => [w, k])));
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

// ---- THE FEATURE REGISTRY (spec §9, "What a bundle cuts"). The fall tiers are code that a look either opens or does not, and a bundle built for one page's
// looks can leave out the ones none of them opens — the way cameraFor lets it leave out the cameras. `open(P)` is the whole question, asked of a look merged over
// DEFAULTS; `group` is the transport uniform group the tier owns (cut with it from every camera), `flag` the FEAT_ constant its modules guard it by (the build
// substitutes it, embed-build.mjs). The predicates are komorebi-math.js's, which the grove reads too: the registry and the grove cannot disagree about when a
// season is on. Two things the table does not say and a bundle depends on: the exposure pass is also opened by a DROP that follows the light (see `ordered`), and
// a carpet needs a leaf that has fallen, so litter is open only for a look that drops.
const FEATURES = {
  fill:        { open: (P) => P.canopy_fill > 0,           group: 'fill',   flag: 'FEAT_FILL' },
  // edge_area opens this tier too: its mixture read lives in the same tagged GLSL and the same beam group, so a bundle that cut the tier would silently ignore the knob
  leafDiffuse: { open: (P) => P.leaf_diffuse > 0 || P.edge_area,   group: 'beam',   flag: 'FEAT_LEAF_DIFFUSE' },
  pigment:     { open: senescing,                          group: null,     flag: 'FEAT_PIGMENT' },
  exposure:    { open: ordered,                            group: null,     flag: 'FEAT_EXPOSURE' },
  drop:        { open: dropping,                           group: null,     flag: 'FEAT_DROP' },
  litter:      { open: (P) => P.litter > 0 && dropping(P), group: 'litter', flag: 'FEAT_LITTER' },
};
const featuresFor = (P) => Object.keys(FEATURES).filter((f) => FEATURES[f].open(P));
// What a host is told when it opens a tier its bundle cut: the tier stays off (the cut code is not there to run), and a look that depends on it would otherwise
// paint something else with nothing said. One message per feature per engine (`warned` is the engine's), none from the raw modules (cut is empty there).
function cutWarnings(P, build, warned){
  const out = [];
  for(const f of build.cut){
    if(warned.has(f) || !FEATURES[f].open(P)) continue;
    warned.add(f);
    out.push(`komorebi: ${f} is not in ${build.name}, so it stays off; build a bundle with the look that uses it (nix run .#embed -- '<look>'…)`);
  }
  return out;
}

export { PARAMS, FEATURES, featuresFor, cutWarnings, MAX_SAMPLES, BAKE_MIN, MAX_LAYERS, MAX_FILL_DIRS, MAX_OCC, SKY_SUN_GAIN, MORPH_KEYS, MORPH_SET, ANGLE_SET, CANOPY_KEYS, SEASON_KEYS, TOPO_KEYS, MODE_KEYS, CANOPY_MORPH_MAX, CROSS_HALF_W, BLOOM_MAX, DUR_SCALE, DEFAULTS, GRANDFATHERED, LEGACY_KEYS, migrateLegacy };
