# Measurements

*Every number the piece has measured about itself, with what it was measured on, so an explanation can be challenged at its source.*

A measurement here is evidence of what the engine did under stated conditions, never a universal claim. Each entry names the look, the state and the knob values it was taken under. "Date: not recorded" means the record carried none. Where a date or a figure comes only from the bot's working log (`QUESTIONS-FOR-JOSE.md`, uncommitted), it is marked "(from the bot's log, uncommitted source)". Where a measurement is **Provisional**, or stands in for a calibration not yet made, the entry says what would replace it.

Looks are named as the engine names them. Seed 290626672 is the seed every look on José's review sheets shares. "Bun" means the CPU unit-test rig; "the harness" means the pixel harness rendering real WebGL2 frames in headless Chromium (SwiftShader) unless another backend is named.

## source

### Sample count and frame rate

- **What was measured:** how many point-suns a fragment shader can sum and hold 60 fps.
- **On:** not recorded (the founding design).
- **Result:** about 16–48 samples holds 60 fps.
- **What it established:** the sampler's working range; the auto-profiler now measures it per look.
- **Date:** not recorded.

### The eclipse's bite in the sampler

- **What was measured:** the sampler's own estimate of how much of the core and halo the moon covers, against the analytic circle–circle overlap.
- **On:** the 32-point sampler under `eclipse`.
- **Result:** the core:halo split of the bite differs from the truth by about 10 %. The seen sky renormalises analytically and carries the sampler's total energy exactly.
- **What it established:** the gap belongs to the sampler, not to the view of the source.
- **Date:** not recorded.

The match between the seen disk and the sampler's weights is under [sky-view](#sky-view).

## light

### The floor did not dim with the sun

- **What was measured:** the floor's level against sun elevation, before the cosine law.
- **On:** one look (not named), a four-frame sheet at sun elevations 12°, 26°, 50° and 70°, a probe on the floor.
- **Result:** the probe read the same level in all four frames.
- **What it established:** the atmosphere modelled the beam's spectrum and not its geometry; the receiver's incidence was missing. This is the finding behind `sun_cosine`.
- **Date:** 2026-10-07 (Fable's park 1 diagnosis of y4) (from the bot's log, uncommitted source).

### The cosine law's arithmetic

- **What was measured:** computed, not rendered: the beam the law lands at two elevations, and the extinction it leaves out.
- **On:** the law normalised to the zenith; atmosphere at β 0.05.
- **Result:**

  | | 12° | 70° | 70° : 12° |
  |---|---|---|---|
  | `sin el` (the law) | 0.208 | 0.940 | ×4.52 |
  | peak-channel normaliser `/tmax` (divided out) | 0.403 | 0.814 | |
  | with broadband extinction kept | | | ×9.1 |

  A look that turns the law on and re-sits its exposure as `exposure/sin el` lifts its shade by about ×2.3 at a 26° sun.
- **What it established:** the law alone gives ×4.5 between a low and a high sun; the air's broadband loss, still divided out, would double it.
- **Date:** 2026-10-09 (from the bot's log, uncommitted source).

### Lit/shade ratios against José's ride photos

- **What was measured:** the ratio of lit floor to shaded floor, set beside José's photographs of bare ground taken on a ride.
- **On:** `montebello` at sun elevations 45°, 25°, 12° and 7°, `sun_cosine` 1, `litter` 0 (bare floor), `tone_map` 0, `contrast` 1, mesopic 0; exposure set per frame so the open floor lands at 0.9 and nothing clips; sRGB decoded to linear; each pixel's `acc` read per channel from a companion frame with the sky and the fill off. The fall canopy passes green and blue at 0.53 and 0.37 of red in the 45° shade, so one channel's `acc` is not another's.
- **The photographs:** lit/shade about 2 to 2.6 under a 12° sun (target about 2.5), about 6 to 8 under 45°.
- **Two estimators.** The *leakage-removed* one takes each shade pixel's own beam leakage out (the fill alone) and sets it against the brightest dapples completed to the full beam. The *literal* one is the mean of the lit floor pixels (`acc_Y` ≥ 0.9, within 40 px of the shade) over the mean of the shade floor pixels (`acc_Y` ≤ 0.15), leakage left in; `acc_Y` is a pixel's share of the open floor's beam luminance.
- **Result:**

  | estimator | law | 45° | 25° | 12° | 7° |
  |---|---|---|---|---|---|
  | leakage removed | on | 17.4 | 11.5 | 5.6 | 2.9 |
  | literal | on | 10.5 | 6.9 | 4.1 | 2.6 |
  | leakage removed | off | 22.2 | 22.7 | 19.2 | 14.3 |
  | literal | off | 12.0 | 9.7 | 7.6 | 6.7 |

  The shade is never pure under a low sun (18 pixels under `acc_Y` 0.02 at 12°, none at 7°), so the literal ratio moves with its threshold:

  | shade threshold `acc_Y` ≤ | 0.02 | 0.05 | 0.1 | 0.15 | 0.25 |
  |---|---|---|---|---|---|
  | literal ratio at 12° | 5.0 | 4.7 | 4.3 | 4.1 | 3.7 |

  The *change* with elevation matches: (lit/shade − 1) falls ×3.6 (leakage removed) and ×3.1 (literal) from 45° to 12°, inside the photographs' own ×3 to ×7 and beside the law's `sin 45°/sin 12°` = ×3.4. The *level* does not: the shade's fill (skylight through the canopy, `kA = 0.08·ambient_skylight` = 0.078 here, plus the leaves' scattered sun) is an authored level that does not fall with the sun, linear 0.0057 at 45° and 0.0055 at 12°, while a lit dapple completed to the full beam falls 0.099 → 0.031.
- **What it established:** at 12° neither estimator is in 2–2.6 (the nearer is 4.1) and at 45° both are above 6–8; the cause is the authored skylight's level against the beam, not the law. Nothing was tuned to reach the band.
- **What would replace it:** the skylight's strength is the author's to set; whether to set it from the photographs is open. The bot's arithmetic (not rendered) put a skylight about three times stronger on both of José's numbers (from the bot's log, uncommitted source).
- **Date:** 2026-10-09, sheets C17–C20 (from the bot's log, uncommitted source).

## camera

No measurement of the camera or the Look's tail is recorded. The projector's iris was judged by eye (see [observations](observations.md#decisions)); the glare's cost to the seen sky is under [sky-view](#sky-view).

## canopy

### The woody shadow shattered in the layers

- **What was measured:** the shadow shift between adjacent depth layers at a low sun, when branches were first stamped into the leaf layers.
- **On:** a backlit standing scene (not named), low sun.
- **Result:** about 1 m between adjacent layers; a branch spanning two layers jumped and the trunk floated free of it (the "snowflake").
- **What it established:** thin continuous wood cannot be binned into discrete heights; the trunk and main limbs became a continuous-height analytic occluder. See [dead-ends](dead-ends.md#canopy).
- **Date:** not recorded.

### A narrow crown's height ran away

- **What was measured:** the height a narrow-plan species computed to once the faithful cast used real heights, when height shared the plan-fill scale.
- **On:** the `columnar` species bundle.
- **Result:** a plan scale `s` of 6 or more, and a tree about 47 m tall.
- **What it established:** height must floor the plan radius (`FAITH_MAX_RATIO`) rather than share its scale.
- **Date:** not recorded.

### A sparse cluster reads naked

- **What was measured:** the transmittance a sparse small-leaf cluster casts.
- **On:** small-leaf species with `cluster_spread_m` fixed; not further recorded.
- **Result:** about 80 % transmittance, whatever the leaf count.
- **What it established:** fullness is leaf area, not count; the species bundles carry size and density tuned for coverage.
- **Date:** not recorded.

### The crown was a wheel

- **What was measured:** where a grown crown's leaves sit in plan, before `inner_leaves`.
- **On:** `park 1`, seen from above (José's y4, sun 70°).
- **Result:** crown radii R 1.28 / 2.07 m; 0.081 of the leaves inside 0.3 R; the area density across the core down to 0.29 of its peak; no twig tip within 0.2 R. The faithful twig hug already trails 58 % of park 1's leaves past the twig base. A simulation hanging half the leaves on the twig and its parent reached 0.063 inside 0.3 R, where hanging 0.3 of them along the whole path to the trunk reached 0.127.
- **What it established:** the core is empty because only terminal nodes bear leaves; neither the hug nor the parent twig reaches it, so a share must hang along the whole ancestral path.
- **Date:** 2026-10-09 (from the bot's log, uncommitted source).

### Inner-leaf densities

- **What was measured:** leaf share inside 0.3 R and inside 0.5 R, and the min ÷ max area density over the first seven bins of r/R, at three settings of `inner_leaves`.
- **On:** bun; `park 1` (faithful hug) and `afternoon 7` (the layer path's blob).
- **Result:**

  | look | `inner_leaves` | inside 0.3 R | inside 0.5 R | min ÷ max density |
  |---|---|---|---|---|
  | park 1 | 0 | 0.081 | 0.398 | 0.29 |
  | park 1 | 0.3 | 0.145 | 0.472 | 0.44 |
  | park 1 | 0.6 | 0.210 | 0.544 | 0.19 |
  | afternoon 7 | 0 | 0.015 | 0.156 | |
  | afternoon 7 | 0.3 | 0.074 | 0.257 | |
  | afternoon 7 | 0.6 | 0.142 | 0.366 | |

  The paths all end on the trunk, so the first bin is the peak, and a higher share fills the core more than it flattens it. The design brief had set a flatness target of ≥ 0.5 at 0.3 from a simulation of an isotropic scatter round the wood, which gives 0.63; the hug, as committed, gives 0.44 (from the bot's log, uncommitted source).
- **What it established:** the share fills the core and thins inward without reaching zero.
- **Date:** 2026-10-09 (from the bot's log, uncommitted source).

### Inner leaves glide, and who shades them

- **What was measured:** (1) how far one leaf moves for a hair of the slider; (2) the exposure rank of an inner leaf against a tip leaf.
- **On:** (1) `inner_leaves` 0.30 → 0.301 on `park 1` and `afternoon 7`; (2) `inner_leaves` 0.5.
- **Result:** (1) the worst leaf moves 0.031 m in plan (reach 1.0 m) and 0.035 m in height on park 1; 0.079 m in plan (reach 2.7 m) and 0.051 m in height on afternoon 7. Leaves whose height crosses a layer bin in that step: 10 of afternoon 7's 32 175, 2 of park 1's 6 138 (in its four layers). (2) Mean rank 0.42–0.44 for an inner leaf against 0.56–0.58 for a tip leaf.
- **What it established:** (1) the per-leaf bound is 0.03 of the leaf's own reach, not a fixed distance; a layer change is the layer path's own quantisation, not a pop. (2) Light alone makes an inner leaf turn later; no position rule is needed.
- **Date:** 2026-10-09 (from the bot's log, uncommitted source).

### Inner leaves slide off the limb in wind

- **What was measured:** how far an inner leaf, pivoting on its twig's base, slips from the limb it hangs on.
- **On:** `park 1` in its squally wind, `twig_flex` 0.18 (and 0.35).
- **Result:**

  | | twig bend | worst slip | mean slip | past a leaf length (0.15 m) |
  |---|---|---|---|---|
  | first second from rest, flex 0.18 | 0.05 rad | 0.07 m | 0.008 m | |
  | half a minute, flex 0.18 | 0.20 rad | 0.26 m | 0.05 m | 5 % |
  | flex 0.35 | | 0.50 m | | a fifth |

- **What it established:** the limit is real and named; it needs a per-leaf pivot weight. Whether it shows in motion was put to José and not answered.
- **Date:** 2026-10-09 (from the bot's log, uncommitted source).

### The faithful frame widens for drooping wood

- **What was measured:** how far leaves on drooping wood rise above the highest twig tip, widening the faithful cast's height range.
- **On:** `inner_leaves` up; willow at droop 0.8 on `park 1`; droop 1, pitch 70, no leader on `afternoon 7`.
- **Result:** park 1: 427 leaves up to 0.26 m above (`hMax` 2.570 → 2.834 m). Afternoon 7: 429 leaves up to 0.40 m above (2.986 → 3.388 m).
- **What it established:** the frame must follow the leaves; such a look leans a hair less at a given height, since the sway scales by height over `hMax`.
- **Date:** not recorded.

## leaf

### The recalibrated maple against José's thirteen

- **What was measured:** the engine's sugar maple outline against José's photographed maples, by one measure applied to both: each leaf's radial profile r(θ) from a hand-placed petiole base along the base-to-central-tip axis, area-normalised to π, read with the leaf-shape test's own `measure`.
- **On:** 24 engine variants (3 seeds × 8: 1, 1234, 90210) against José's thirteen (DSC_0617–0622, DSCF1667 ×3, DSC_0656 ×5; see [observations](observations.md#reference-photographs)), and the five-pointed star the recalibration replaced.
- **Result:**

  | | recalibrated maple | José's 13 | the star it replaces |
  |---|---|---|---|
  | lobe maxima in ±125° | 3–5 (mean 3.9) | 3–5 (3.3) | 5 every time |
  | central–lateral sinus | 0.19–0.40 (0.28) | 0.17–0.34 (0.26) | 0.46–0.61 (0.53) |
  | lateral lobe tips | 38.7–47.1° (43.3) | 33.0–49.9° (43.2) | 58.4–66.8° (62.3) |
  | solidity (area over the convex hull) | 0.76–0.79 (0.772) | 0.71–0.81 (0.760) | 0.64–0.67 (0.652) |
  | width over length | 0.99–1.37 (1.17) | 1.01–1.57 (1.29) | 1.27–1.71 (1.51) |
  | mean r(θ) at 30 / 44 / 62 / 105 / 120 / 150° | 1.39 / 1.74 / 1.17 / 0.30 / 0.15 / 0.09 | 1.38 / 1.66 / 1.15 / 0.36 / 0.11 / 0.03 | 0.77 / 1.05 / 1.62 / 1.02 / 0.74 / 0.30 |
  | tip half-angle (central and laterals) | 29.0–32.7° (30.2) | 20.3–42.8° (28.9) | 26.2–27.5° (26.9) |
  | lateral asymmetry | 0.005–0.19 (0.092) | 0.008–0.16 (0.057) | 0.011–0.21 (0.092) |
  | central lobe over its laterals | ×1.18 | ×1.13 | ×1.18 |
  | his leaf → nearest of 800 engine maples | 0.17 (0.11–0.43) | — (nearest other of his own: 0.13) | 0.40 (0.29–0.67) |

  Solidity is read off the r(θ) profiles, his and the engine's alike; read off his masks it was 0.742. The truncate base took r(150°) from 0.30 to 0.09 (his 0.03). The box of the eight outlines is 6.7 units², the star's 8.6. The stamp's summed coverage is ×1.080–1.084 of the ellipse's at the same edge (variants 0, 3 and 7 of seed 1234), where the star's was ×1.04: the radial ramp loses `½·e·∮r dθ` of the area, and `∮r dθ ≤ 2π` with the area fixed, so the more a profile varies the more a leaf keeps, and a truncate base is a good deal of variation; the harness band was widened from 1..1.06 to 1..1.10 for it. `growLeaf`'s jitter alone (±4°, ±10 %) spreads one leaf's sinus over 0.18–0.40 at any mean, so every leaf cannot sit inside his range on every axis at once; the means sit in his range and each leaf in a wider envelope.
- **What it established:** the recalibrated grammar's means sit inside José's leaves on every axis. What is left of the 0.17 (his own leaves are 0.13 from one another) is the basal region, his most variable, and the sub-lobes and acuminate tips the grammar does not grow. José, of the sheet: "still good enough to commit as is" (see [observations](observations.md#decisions)).
- **Date:** 2026-10-09 (recalibration).

### The star, read on the leaves it claimed to be

- **What was measured:** the first maple (laterals ±62°, basals ±105° of length 0.55, rho 0.19, no clip, "calibrated on José's pressed leaves") by the same measure.
- **On:** 800 engine maples against José's thirteen.
- **Result:** sinuses twice his (0.53 against 0.26); laterals at 62° where his sinuses are (43°); a blade reaching 0.30 behind its petiole (his 0.03); solidity 0.65, below all thirteen of his, and a solidity spread (sd 0.007) a fifth of his (0.035). Each of his leaves was 0.29–0.67 from the nearest of 800 engine maples, while his leaves are 0.04–0.45 from each other. Its first test bands (five lobes, laterals 52–72°, sinus 0.35–0.65) had been fitted to its own output. An earlier design partner's numbers grew a three- or four-lobed mitten. See [dead-ends](dead-ends.md#leaf).
- **What it established:** read a measure on the leaves it claims to be, with the same code, before the bands are written.
- **Date:** 2026-10-09.

### Leaf area is kept

- **What was measured:** the canopy's leaf coverage with an outline against the ellipse it replaces.
- **On:** `memories` and `afternoon 7`.
- **Result:** ×0.96 for the recalibrated maple; ×0.97–0.98 for the star. The radial edge ramp is a little narrower across a flank (about 0.6× as wide).
- **What it established:** area normalisation keeps the canopy's fullness.
- **Date:** not recorded.

### The aspect law: "thin and weird"

- **What was measured:** the width over length a maple outline was drawn at when the hang loop divided its width by `leaf_aspect`.
- **On:** José's projector look (maple, aspect 1.75, 0.1 m), face on; `memories` for continuity.
- **Result:** a blade whose width over length is 1.27–1.71 was squashed to 0.73–0.98, narrower than every one of his thirteen (1.01–1.57 by the test's measure). Under the law the same look draws a leaf of size 0.0756 at aspect 1 with the area it had: the recalibrated maple's own proportions, about 8.2 cm long (7.6–9.2) and 9.6 cm across (width over length 0.99–1.37, mean 1.17). Before the law a maple at 1.75 and the maple at aspect 1 with `leaf_size_m/√1.75` were max Δ103 apart on memories; after, identical to the last bit.
- **What it established:** an outline takes the look's leaf area, never its aspect; a maple at 1.75 is a smaller maple, not a thin one.
- **Date:** 2026-10-09.

### The beech's outlines

- **What was measured:** the pinnate grammar's outlines by the maple's measure.
- **On:** 24 variants (3 seeds × 8, the test's seeds); also 2400 variants over 300 seeds.
- **Result:** width over length 0.50–0.61 (mean 0.55); over 2400 variants 0.47–0.63, and 19 of 300 seeds hold a pair of variants closer than 0.01 RMS. Exactly two maxima, the apex (|θ| < 1°) and the base (178–179°). Apex half-angle 28–43° (mean 35°; the brief had asked for 20–35°). 18–26 teeth, each at most 2 % (3.7 % where two overlap). Area π to 4·10⁻¹⁵; a raster of the profile within 0.1 % of it. Stamp coverage ×1.007–1.012 of the ellipse's at the same edge. Quad 5.0 units² (ellipse 4, maple 6.7, star 8.6). Variants 0.014–0.084 RMS apart (mean 0.049). Star-shaped from its origin on the midrib: 0 re-entrant rays over 24 variants; the box's centre within 0.026–0.097 of the origin over eight seeds.
- **What it established:** the beech holds a radial profile and hangs from the middle of its blade as the ellipse does.
- **Date:** 2026-10-09 (from the bot's log, uncommitted source).

The red oak is not star-shaped from any point of its midrib: 2–33 re-entrant rays per variant, so a radial profile would bridge its sinuses (from the bot's log, uncommitted source).

### Variety spreads

- **What was measured:** pairwise outline distance (r(θ), mirror-min RMS) within José's maples and within the engine's, at several values of `leaf_variety`.
- **On:** José's thirteen; the first maple's eight variants; the recalibrated maple's; the 64 rows of `leaf_variety` on four seeds.
- **Result:**

  | set | pairwise distance |
  |---|---|
  | José's 13 | 0.19 on average (0.24 with the folded leaf in) |
  | the first maple's 8 | 0.105 |
  | the recalibrated maple's 8 | 0.09 |
  | variety 0.5 | 0.10–0.12 |
  | variety 1 | 0.14–0.16 |
  | variety 1.5 | 0.17–0.22 |
  | one genotype's own 8 at variety 1 | 0.11–0.14 |
  | his leaf → nearest of the 64 rows (variety 1) | 0.16 |

  At variety 1 the sun rows' solidity sits 0.03–0.05 below the shade's, and every row is a maple with a central lobe flanked by two. At 1.5, one row in 64 on two seeds in four loses that form: a flank of the central lobe at 92–94°, a basal stub with no lateral on that side (93.5° on seed 1234, 92.1° on 90210), solidity spanning 0.54–0.95. Scaling every spread by 1.6 instead reaches his 0.19–0.22 but loses the central lobe on one row in 64 on four seeds in five and spans solidity 0.53–0.96. The size renormalisation on `afternoon 7` at variety 1 is κ = 0.996, with a leaf's size shift running 0.85–1.15. The per-leaf size spread is already wider than his: ×1.17 within a frame and ×1.45 in the fresh batch, against the draw's 0.6–1.4.
- **What it established:** 1 is about three quarters of José's spread, 1.5 about all of it. Which he means is his to say.
- **Date:** 2026-10-09/10 (from the bot's log, uncommitted source).

### Variety under a morph

- **What was measured:** the largest frame change when a varied grove's exposure rank moves.
- **On:** `afternoon 7` at variety 1 (density 1.5 → 1.51; the knob 1 → 1.001); `memories` for the 0 → ε step.
- **Result:** a density step moves the frame by at most Δ21 of 255; a hair of the knob by Δ14 whatever the step (the grammar's half-percent quantisation of an outline); the step 0 → ε re-deals every outline and the crossfade dissolves it (Δ82 on memories).
- **What it established:** a canopy morph at variety > 0 swaps the outline of leaves whose light class it crosses, a pop of lobes but never of size. Whether to accept this was put to José and not answered.
- **Date:** not recorded.

### The texel as a slab: rims, halos and the mixture

- **What was measured:** what each reader made of a soft-edge texel when it took the stored depth and coverage for a slab, before and after reading it as a mixture of one leaf and a gap.
- **On:** the harness's edge rows, running the engine's own taps, faithful stamp and shared ray over the layers it baked: `canopy 1` at `leaf_diffuse` 0.95 for the lantern's rim; `afternoon 7` for the beam's halo; the faithful stamp. Worked example: a texel 30 % under a leaf of depth 2.8 (blue).
- **Result:**

  | reading | slab | mixture |
  |---|---|---|
  | the worked texel's transmittance | 0.43 | 0.72 |
  | its ballistic beam at d 0.95 | 0.18 | 0.70 |
  | its lantern emission (blue) | 0.256 | 0.017 |
  | rim over interior glow, canopy 1 (R/G/B) | ×1.65 / 1.16 / 2.26 | ×0.95 |
  | soft-edge band's mean beam, afternoon 7 | ×0.43 of the mixture | ×1.000 |
  | the same on the faithful stamp | ×0.44 / 0.51 / 0.40 | ×1.000 |

  Looking up, the slab's emission at coverage 0.3 on canopy 1 was 0.34 against 0.05 in blue (τ 1.83), 0.40 against 0.07 in red (τ 1.35) and 0.48 against 0.14 in green (τ 0.69); the rim peaked at ×2.3 (blue), ×1.7 (red), ×1.2 (green) of its interior, a pale cream outline round a green leaf. After the fix the mean rim over interior runs 0.07, 0.15, 0.25, 0.37, … over coverage 0.05 … 0.95, peaking at ×0.95 in all three channels; the row holds it to ×1.1. Nearly half of every stamp is partial (44 % of the ellipse's area at `edge_softness` 0.25; 45 % at 0.26 on canopy 1, where a 0.13 m leaf is six texels across).
- **Residue of the mixture:** exact for one leaf over any share of a texel and for leaves stacked over the whole texel. For a texel inside one leaf with another's edge across it, the emission's luminance is within 8 % (held to 15 %) and blue within 41 % (held to 45 %; red 25 %, green 6 %), measured against the supersampled texel. Two edges inside one texel can pass ×2.
- **What it established:** the bake averages depth where light averages transmittance; the split made a long-standing edge error loud. See [dead-ends](dead-ends.md#leaf).
- **Date:** overnight 2026-10-06 → 07 (P0c-edge) (from the bot's log, uncommitted source).

### What `edge_area` brightens

- **What was measured:** the effect of reading the soft edge as a mixture at `leaf_diffuse` 0.
- **On:** the shipped looks; the harness on `afternoon 7`, `memories` and `canopy 1`.
- **Result:** the soft-edge band's mean beam under the default slab is ×0.86–0.93 of the mixture's across the shipped looks (×0.87 on afternoon 7, ×0.86 on memories); 15–25 % of covered texels are soft edge. With `edge_area` on, a frame's mean level rises ×1.016 (memories) to ×1.037 (afternoon 7). The canopy 1 proxy-glow rim measures ×0.95 of the interior with it on, ×1.26 in blue with it off, and ×1.39 when the hue was taken from the mixture rather than the leaf. The harness holds the lit band to ×1.00–1.08. The design's earlier estimate was 0.4–2.5 % brighter (from the bot's log, uncommitted source).
- **What it established:** the default slab darkens every leaf edge by about a tenth; the rung is José's to turn on (decision 33).
- **Date:** 2026-10-07 evening (from the bot's log, uncommitted source).

### The marginal fade reaches the ballistic shadow

- **What was measured:** how far the frame moves when a leaf is stepped from nothing to 0.005 of a leaf, with and without the fade in the coverage.
- **On:** the harness's `near` row, on the slab draft before the mixture.
- **Result:** 2 grey levels with the fade carried; 39 with coverage alone.
- **What it established:** a ballistic shadow built on coverage alone pops to full weight; the fade must ride the coverage too.
- **Date:** not recorded.

### The held leaf's maze

- **What was measured:** the junction angles of the grown areole maze.
- **On:** the held-leaf fixture, compared with José's `leaf-maze-crop.png`.
- **Result:** a junction median of 83.5°; T-junctions near right angles, cell rows along the veins. The wall-width multipliers (4 / 3 / 2 / 1.5 / 1 by vein order) are **Provisional**.
- **What it established:** successive domain division gives the leaf's right-angled hierarchy where Voronoi would give 120° Y-junctions.
- **Date:** 2026-10-08 (from the bot's log, uncommitted source).

## season

### The pigment basis vectors (Provisional)

- **What was measured:** nothing yet; the basis vectors are chosen from the pigments' known absorption, not fitted.
- **On:** —- **Result:** carotenoid passes red and green and absorbs blue (gold, T ≈ .74 / .58 / .06); anthocyanin on the gold reads orange at a = 0.2, deep red at 0.8, crimson at 1.2; tannin is a broad absorber leaning warm. The tests hold their ordering, not their numbers.
- **What would replace it:** backlit measurements, one leaf per pigment state against a diffuser, `τ = −ln(leaf / diffuser)`.
- **Two readings against it, not yet acted on:** every yellow blade in José's 2026-10-08 batch measured τr − τg of −0.44 to −0.72 against the carotenoid's −0.25 (yellow leaves are warmer than the engine's gold), and the elm's brown blotches 2 to 3.5 tannin units against the provisional 1. A fully turned leaf at the settings then current passed red:green about 11:1 where a real backlit maple is about 3–5:1; `wall_fraction` 0.2 alone brought it into band (both from the bot's log, uncommitted source).

### The extinction constant

- **What was measured:** not measured here; from the literature.
- **Result:** `kx` = 0.5, the projection function of a spherical leaf-angle distribution, the textbook broadleaf default; measured effective k across broadleaf stands runs 0.5–0.8.
- **What it established:** the exposure grid's attenuation per unit leaf area.

### Equal light at the top of the stand

- **What was measured:** how many leaves have a representative ray that crosses no leaf area at all (exposure exactly 1), and where they are.
- **On:** the shipped floor looks and `canopy 2`, the 45° season sun from the south.
- **Result:** the largest exposure below 1 is 0.99987; a leaf is about 5·10⁻³ m² against the grid's 10⁻⁹ guard, so the tie is a true zero-area ray.

  | look | leaves at exactly 1 | where |
  |---|---|---|
  | afternoon 7 | 1082 of 32 175 (3.4 %) | 1.48–3.61 m of a 1.26–3.61 m crown; mean x −1.25 against −0.26 for all leaves (up-sun) |
  | memories | 3.7 % | |
  | park 1 | 4.1 % | |
  | canopy 2 | 0.4 % | the top alone |

- **What it established:** the tie is the whole up-sun shell plus the top, the only exact tie in any grove.
- **Date:** 2026-10-07 afternoon (from the bot's log, uncommitted source).

### The tie fell as one wave

- **What was measured:** the worst sliding ε-window's share of the drop, against its uniform share, before and after the leaf's own clock broke the tie.
- **On:** `drop_exposure` 1, `leaf_drop` 1.
- **Result:**

  | look | worst ε-window, tied rank | after the tie-break |
  |---|---|---|
  | afternoon 7 | 1.50× | 1.0× |
  | memories | 1.55× | 1.1× |
  | park 1 | 1.61× | 1.2× |
  | the dense test grove | 2.42× (its first ε held nothing, its next its 8 % at once) | |

  Before the fix the first day was about 0.705, the day of the whole group. After, the days are exactly `drop_start + drop_span·(i + ½)/n`.
- **What it established:** the wave was coherence, not count; the tie-break makes the drop a trickle. At `exposure_absolute` 1 the raw light is literally equal and the shell still goes together.
- **Date:** 2026-10-07 afternoon (from the bot's log, uncommitted source).

### The rank keeps the look's red

- **What was measured:** drift of the grove's mean red capacity under `turn_exposure`.
- **On:** not recorded.
- **Result:** 0.04 %, the sample covariance of the gain with each leaf's independent hash.
- **What it established:** exposure moves red from the shade to the sun without minting any.
- **Date:** not recorded.

### Absolute light on a shaded grove

- **What was measured:** mean red capacity and mean turned state under `exposure_absolute`, for an open crown with and without a neighbour up-sun.
- **On:** the planted-crown test: one open crown of a thousand leaves (mean exposure 0.59), alone and with a two-thousand-leaf crown four metres up-sun (mean 0.26).
- **Result:**

  | | `exposure_absolute` | mean red ÷ the hash's | mean turned state |
  |---|---|---|---|
  | alone | 1 | ×1.09 | 0.256 |
  | shaded | 1 | ×0.76 | 0.091 |
  | either | 0 | ×1.00 | 0.208 |

  Mean exposure on the shipped looks: `canopy 2` 0.32, `memories` 0.32, `afternoon 7` 0.31, `park 1` 0.24, so at 1 their mean gain is about 0.8 and their turn phase about 0.7. A thinner grove (40 leaves a twig on three trees) sits at 0.51 and barely moves.
- **What it established:** at 1 a shaded grove turns later and paler, which is the absolute physics and also the repainting by density the rank avoids; hence a knob, default 0.
- **Date:** overnight 2026-10-06 → 07 (from the bot's log, uncommitted source).

### Tree leads at the shipped seed

- **What was measured:** each tree's lead and pigment depth at seed 290626672, and the share of leaves down per tree.
- **On:** the grove's own leaves; mean s over all of a tree's leaves and % down by leaf count; `tree_clock_spread` 0 / 0.05 / 0.1.
- **Result:** the lead's draw v³: tree 0 0.3355, tree 1 0.0015, trees 2–4 0.5572, 0.1894, 0.0002. At S = 0.1 the leads are Δ = −0.0335, −0.0001, −0.0557, −0.0189, −0.0000; the depths at s = 0.6 are 0.718, 1.241, 1.273, 0.821, 0.561. The shipped seed's eight trees draw genotypes 6 0 1 0 1 2 3 2.

  | look, phenology | measure | clock 0 | 0.05 | 0.1 |
  |---|---|---|---|---|
  | montebello, 0.9 | tree 0 % down (tree 1: 90 %) | 44 % | 57 % | 72 % |
  | park fall, 0.79 | tree 0 mean s (tree 1: 0.67) | 0.38 | 0.55 | 0.72 |

  On `canopy 2` (16 trees) at 0.78 with montebello's capacity and clock 0.1, trees 5, 11 and 12 are 61, 42 and 57 % down where most trees are at 0–15 %. At 0.15 a tree with v³ > 2/3 reaches into the shipped summer (0.5); on canopy 2 that is trees 5, 11 and 12.
- **What it established:** on two trees the sheet reads as the trees growing alike (montebello) or tree 0 overtaking (park fall); the lone early tree of photo 0631 is a many-tree picture.
- **Date:** 2026-10-09.

### Drop tables with and without `drop_after_turn`

- **What was measured:** the share down, the turn state of the fallen and the crown, across late phenology, with the drop on its own clock and bound to the end of each leaf's turn.
- **On:** real groves at montebello's capacity; `afternoon 7` (32 175 leaves) and `park 1` (6 138) give identical shares, the rank being uniform.
- **Result, the knob off:**

  | p | down | fell s<0.5 | fell s<0.9 | fell s<1 | median s at D | crown mean s | carpet mean s now |
  |---|---|---|---|---|---|---|---|
  | 0.75 | 16.7 % | 100 % | 100 % | 100 % | 0.33 | 0.15 | 0.46 |
  | 0.80 | 33.3 % | 71 % | 100 % | 100 % | 0.42 | 0.39 | 0.69 |
  | 0.85 | 50.0 % | 48 % | 100 % | 100 % | 0.52 | 0.76 | 0.90 |
  | 0.90 | 66.7 % | 36 % | 80 % | 100 % | 0.62 | 1.00 | 1.00 |

  The most exposed leaf goes at s = 0.259 everywhere.

  **The knob on** (total lag 0.06, `drop_lag` 0.05 plus ε):

  | p | down | crown mean s |
  |---|---|---|
  | 0.75 | 0 % | 0.50 |
  | 0.80 | 11.1 % | 0.75 |
  | 0.85 | 38.9 % | 0.94 |
  | 0.90 | 66.7 % | 1.00 |

  The minimum s at `D − ε` is exactly 1, held for every leaf in the litter on both paths at `turn_exposure` 0 / ½ / 1, `leaf_drop` 1 / ½, lag 0 / 0.05. The fallen leaves' days span [0.78, 0.9] rather than [0.70, 0.9], so the litter is younger. A total lag of 0.09 puts half down at 0.9 (José's beech).
- **What it established:** off, leaves fall before their turn ends (a lemon carpet under a dark crown, k5). On, no leaf falls before it has turned, the mid-turn crown reads further along, and the default lag keeps montebello's carpet at 0.9.
- **Date:** 2026-10-08 (sheets d1–d8) (from the bot's log, uncommitted source).

### A live season step that pops

- **What was measured:** what one applied step of a rate-gated catch-up does to leaves mid-fade.
- **On:** `afternoon 7`, the season macro.
- **Result:** a step of about 0.018 in phenology would thin about 6 % of the leaves as salt-and-pepper in one frame.
- **What it established:** one applied step may not exceed half a fade window; the bus clamps it.
- **Date:** not recorded.

### Leaf-off on the faithful cast

- **What was measured:** the floor's level when a faithful canopy reached leaf-off and the bake returned early on an empty leaf set.
- **On:** `park 1` and `curtain 1` at `leaf_drop` 1.
- **Result:** the whole floor black, ×0.36 of the leafy frame, on a fresh engine; the last leafy bake on a live one.
- **What it established:** a bare faithful canopy must bake its wood and a lit floor, not nothing.
- **Date:** overnight 2026-10-06 → 07 (from the bot's log, uncommitted source).

### The honest carpet colour (κ Provisional)

- **What was measured:** the litter reflectance law's outputs for test leaves, dry and wet.
- **On:** the pure `litterAlbedo` at κ 2, F 0.04, `ALBEDO_BROWN` (0.12, 0.08, 0.05).
- **Result:** TAUS.red at age 0 reflects (0.331, 0.103, 0.096) dry and (0.227, 0.057, 0.053) at wetness 0.5. The redhead (anthocyanin 0.8, no wall fraction) keeps its green at ≥ 0.3× its red and its red under 0.5. Wetting multiplies:

  | wetness | fresh red leaf | the browns |
  |---|---|---|
  | 0.5 | ×(0.685, 0.553, 0.549) | ×(0.564, 0.538, 0.512) |
  | 1 | ×(0.145, 0.061, 0.058) | |

  Min/max falls at 0.5 for every test leaf and for brown, so saturation rises. The scattering a soaked leaf keeps, `WET_RHO` ≈ 0.085, is derived from `n_wall` 1.47 and `n_water` 1.333, not measured.
- **On the sheets:** real soil reflects 0.1–0.2; on park 1's dirt a montebello leaf matched it in chroma and sat at 1.1× its luminance, so the carpet vanished, which is why montebello's dirt came down ×0.6.
- **What it established:** the opaque-pile reflectance is far less saturated than the transmittance stain it replaced; κ 2 was chosen by eye (see [observations](observations.md#decisions)).
- **What would replace it:** the grey-card calibration. Photograph the same leaves backlit (for τ), then dry and wet beside a grey card in the Gatineau; that fits κ, F and wetness's effective scale. The protocol for the photographs: a diffuser (tracing paper) on the glass, a white or grey card behind, RAW, fixed white balance and exposure, Active D-Lighting off, wet and dry labelled (from the bot's log, uncommitted source). `litter_age` 0.15 is **Provisional** with it.
- **Date:** 2026-10-08, sheets in `test-gl/out/review/2026-10-08/`.

### The carpet against its painting

- **What was measured:** the GPU-baked carpet against a CPU painting of the same stamps.
- **On:** a dense carpet, `afternoon 7` (21 450 leaves laying 100 m² of leaf on 49 m² of floor, 84 % covered, many layers deep); a sparse carpet (the first day of the fall); a finite tree; a running engine.
- **Result:** coverage within 0.002 of the right painting per covered texel and colour within 0.001, where the wrong drop order's colour is 0.038 away. The sparse carpet's area is Σπ·A·B0·fade to a few percent and its mean colour the area-weighted mean of the law. A finite tree's carpet is carried down-wind of the leaves' centroid by about `h·litter_drift_m`. `passes` is 1 after two dozen frames: once per regrow. A leaf smaller than a texel, drawn at three quarters of a texel's half-extent with its alpha spent, over-counts its area ×1.26. The anti-aliasing ramp itself adds `π·w²/12` to each leaf's area, `w` the ramp's width: a few percent of a five-texel leaf. The first draft cut every leaf's tips at 50 % coverage: sixteen sub-texel leaves kept ×0.80 of their area.
- **What it established:** the instance order is the layering, the premultiplied blend accumulates coverage correctly, and the quad needs a texel and a half of margin.
- **Date:** overnight 2026-10-06 → 07 (from the bot's log, uncommitted source).

### Carpet texel sizes

- **What was measured:** the carpet's texel on the shipped frames at `litter_resolution` 1024.
- **Result:** `park 1`'s padded frame is 26 m, 2.6 cm a texel; `afternoon 7`'s 7 m box, 0.7 cm. A 10 cm leaf reads as a leaf in the park and as a speck beside a lone tree; 2048 is the lever.

### Bare crowns from below

- **What was measured:** the height of fallen against kept leaves.
- **On:** `canopy 2` at phenology 0.9, looking up.
- **Result:** fallen leaves average 14.75 m high, kept ones 12.42 m; the survivors are dense clumps whose shaded interiors keep a third of the leaves, so it does not read as bare crown tops (from the bot's log, uncommitted source).
- **Date:** overnight 2026-10-06 → 07 (from the bot's log, uncommitted source).

### The season spectrum's first numbers (Not built)

On montebello's grove, a design for summer casualties gave `good` at vigour ½ about 12 % cover at the turn and `dry` at ½ about 23 %, José's photos' low and high ends (from the bot's log, uncommitted source). Date 2026-10-09. See [exploration](../exploration/open.md).

## transport

No transport measurement is recorded. What the beam sees of a leaf is measured under [leaf](#leaf); the woody shadow's layer shift under [canopy](#canopy).

## fill

### Interleaving the rays

- **What was measured:** how close the mean of a 4×4 tile of fill texels, each with its own rotation of the K = 16 fixed rays, lands to a K = 1024 estimate, against every texel using the same 16.
- **On:** leaf-scale gappy stacks (200 for `T_sky`, 60 for `S`), RMS.
- **Result:** 2.25× closer for `T_sky`, 1.9× for `S` (the unit tests hold ≥ 2× and ≥ 1.8×). Every other ordering tried (azimuth only, other sub-stratum permutations, a 256-point Vogel spiral dealt by stride) landed within 0.44–0.50 of the unrotated error.
- **What it established:** the ceiling is the noise of 256 well-spread samples; the rotation reaches it. Without it the first render showed decimetre-scale facets.
- **Date:** not recorded.

### Which mip the receiver reads

- **What was measured:** the floor's error reading the fill at mip level 2 and level 3, against a K = 64 bake of the same read.
- **On:** `memories`, `fill_scatter` 0.5 (the first render drew a regular grid at the texel pitch).
- **Result:** luma RMS 1.99 of 255 at level 3, 2.84 at level 2, 2.14 for a 4-tap smoothing of level 2 (four times the reads), 5.92 before the interleave.
- **What it established:** level 3, four tiles, is 30 % lower in error than level 2 for the same cost.
- **Date:** not recorded.

### No trig on the GPU

- **What was measured:** the shader's error against its CPU reference when it computed `cos φ` itself.
- **On:** the first interleaved fill shader.
- **Result:** 3·10⁻³ to 9·10⁻³, against 2.4·10⁻⁴ before; a few 10⁻⁴ of angle is centimetres on the floor at a ray's tens of metres of plan travel.
- **What it established:** the ray directions and slot rotations are made in float64 on the CPU and uploaded.
- **Date:** not recorded.

### The shader against its reference

- **What was measured:** the engine's baked `T_sky` and `S` against `komorebi-fill.js` at sampled texels, with bilinear taps through the fill's own domain and the bake's heights, atmosphere and beam sun path.
- **On:** a real fill under frozen motion; with the split on, emitted light from coverage read back out of alpha.
- **Result:** within one half-float ulp; with the split on, within 1.2·10⁻⁴. The energy bound `S ≤ fill_scatter·(1 − T_sky)·sun` holds over 10⁴ random stacks.
- **What it established:** a wrong ray, height, weight or sun path would be orders of magnitude out of tolerance.

### The books on the real layers

- **What was measured:** on the layers the engine baked, what the leaves emit, what the hemisphere sends down, what the beam gives up and what the fill texture holds.
- **On:** the harness's bookkeeping rows, frozen frames; `memories`, `afternoon 7`, `park 1`, `curtain 1`, `tent 1`; synthetic stacks in the unit tests.
- **Result:**

  | quantity | result |
  |---|---|
  | beam + emitted = total transmitted, per ray and channel | to 1e−12 over 10⁴ random stacks |
  | beam + fill summed over the plane, against the old total | within 0.5–3 % on every look |
  | bottom layer received = emitted, periodic stack | to 1e−9 |
  | the same on the real layers | to 0.2–0.5 % |
  | fill over what the beam gave up (the clumping band) | −5 % … +15 %; 0.99 on memories, 1.03 on afternoon 7 |
  | independent layers, floor-averaged, at the zenith | within 5 % |
  | beam's share of the floor's light at d 0.95 | 94–98 % on memories, park 1, curtain 1; 79 % in tent 1 |

  Before the domain fix, the bottom layer received 0.69–0.73 of what it emitted on `memories` and a finite tree's box held 41–57 % of what its leaves sent down. Over the padded frame, `S` at the frame's edge is ≤ 0.004 of its brightest block on park 1, curtain 1 and tent 1 (it was 0.27–0.64 at the box's edge). A cosine-weighted ray passes 3·`h_max` with probability 10 %; that tail is 3.5–4.5 % of all the light on those looks (the frame holds 95.5–96.5 %), and 10 % of a leaf's light at the very edge of the box. A ray at 60° from an 8 m layer travels 14 m sideways.
- **The second sun:** lit along the real sun while the park's beam has no bulk shift, the fill emitted about 14 % more than the beam lost at a 36° sun on the real park. On a torus, `Σ_box S = Σ_box D_beam` holds to 1e−9 once the fill takes the beam's path, and is off by 1.3 % on that synthetic stack lit along another sun.
- **What it established:** no light is made or lost; the hemispheric descent differs from the ballistic one by the canopy's clumping, which is physics, not a leak; what a frame shows is displacement. The rows were red on the engine before the wrap, the padded frame and the one sun. The engine's glow closed within 1.5 % of the physics after the fix, against 0.6–0.7 before (from the bot's log, uncommitted source).
- **Date:** overnight 2026-10-06 → 07 (P0c-fix) (from the bot's log, uncommitted source).

### Re-sitting a look with the fill open

- **What was measured:** a frame's display level when the endless park's fill began to wrap.
- **On:** `memories` at `canopy_fill` 1, d = 0.
- **Result:** 151.8 → 126.1 (from the bot's log, uncommitted source). The spec's guidance for authors, about half a stop more `ambient_skylight` or `exposure`, has no recorded measurement behind it.
- **Date:** overnight 2026-10-06 → 07 (from the bot's log, uncommitted source).

### The fill's GPU cost

Not recorded. The fill runs every frame under wind and was timed only on the software rasteriser; the measurement on José's machine was asked for and not reported (from the bot's log, uncommitted source).

## receivers

### Coarsening keeps its metres

- **What was measured:** the pleat field's peak displacement down the drape under `fold_coarsen`.- **Result:** 99.9 % of `fold_warp` reached at every height sampled.
- **What it established:** the divisor holds the knob in metres while the octaves crossfade.
- **Date:** not recorded.

### The mullion's throw

The bar shadow slides with the sun about 1/60th as far as the trunk's at the shipped depths, and the spread across the source disk is sub-millimetre on the cloth: why a central ray suffices. Look and date not recorded.

### The lateral diffusion's reach

The 13-tap kernel's spacing caps at 6 px, so the reach stops growing past a 36 px radius: roughly 7 cm at the tent's 3 m framing on a 1600 px-tall canvas, more cloth than that on a shorter one.

### Tent frame coverage and seam widths

- **What was measured:** the enclosure's geometry and seams on rendered frames and ray grids.
- **On:** the shipped tent dimensions (`tent 1`); a 129×129 ray grid; dense screen sweeps of 240 000 samples per line; a 257² frame for the cap family.
- **Result, the hull:**

  | quantity | result |
  |---|---|
  | hull outside the true arch | at most 1.45 cm |
  | shading normal across an intra-arch facet boundary | moves 4·10⁻⁶ |
  | across a real pole line | jumps 0.8 |
  | four tangent strips with the shoulder on the straight line | differ by 1·10⁻¹⁶ in normal, exactly 0 in offset |
  | cap family at `rake` 0 | 0 difference in normal and offset; no pixel of a 257² frame differs from the single wall |
  | rays with no exit plane, or clamped at `TENT_TMAX` | zero |
  | exit distances | 0.61–1.35 m |
  | hit point's jump at every panel crossing | ≤ 1.5·10⁻⁵ m, below the step between ordinary neighbouring samples |
  | setback at the rake floor 0.15 | about 4 cm |

- **Result, framing:**

  | framing | arches | crown | hips | other |
  |---|---|---|---|---|
  | yaw 0, far end in shot | 33 % / 33 % | 14 % | 9.2 % / 8.9 % | foot triangle 0.7 % |
  | yaw −115.34 (shipped) | −x arch above hem 35 %, below hem 14 % | 11 % | two near hips 40 % | |

  The far vent triangle is 93 px wide at its base row narrowing monotonically to 1 px at its apex, centred to the pixel. At the shipped framing the gaze centre sits 64.7° off the near end against a horizontal half-width of 59.8°, so the near vent's nearest corner falls 3.3° outside the frame. Raising its apex brings it in at 0.65 m on 16:9, 0.75 m at 16:10, 0.85 m at 4:3, and never within the clamp at 1:1. Yaw −130 puts the near vent at 2.6 % of frame; fov 100 at 0.9 %. At pitch 42.5 with an 88° lens the lowest ray is depressed about 1.5°, so from an eye 0.42 m up nothing below eye height is in shot. At yaw 180 the near triangle occupies 123 rows of an 801-row frame, 125 px wide at its base narrowing to 1 px.
- **Result, seams:** of 107 388 arch pixels, 23 468 sit on an intra-arch facet boundary, at 0.078–0.408 m (median 0.173) from the nearest cross-group plane against the 12 mm core; 0.64 % of them land in a core (the hub vertices) and 1.8 % of all arch pixels seam, every one a crown edge or a cap rim. Measured to the plane, the mesh hem (18.4°, the shallowest dihedral) painted 76.0 mm of fabric and a crown edge (46.9°) 32.8 mm; measured to the edge line both paint 24.0 mm, exactly `hw + pen`. The hem lands at z = 0.5533 m, 0.33 cm above the authored shoulder waypoint; across it the shading normal moves 1.9·10⁻⁴ while the facet normals differ by 0.32. The pixel footprint term is 0.004 rad, about 3 px on a 78°, 1080-tall frame.
- **Result, per-panel light:** the crown lands at `beamF` = 1.000000 from a 90° sun down to the divisor floor at about 8.6°. Under `sun_cosine` 1 the cap at 2 holds a panel turned into a low sun to 0.845 of its `n̂·sunDir` at 25° and 0.416 at 12°; `tent 1` (55°) is clear of both limits.
- **What it established:** one closed-form exit is exact, continuous and seam-free; the group filter draws only the object's own edges; a shape tuned to one canvas's edge is undone by a resize, so the camera is the control.
- **Date:** not recorded.

### The cloth and the tent with the split open

- **What was measured:** how much the leaves' diffuse light moves the cloth when `leaf_diffuse` opens, and the factor the vertical curtain reads `S` by.
- **On:** `curtain 1` and `tent 1`, `canopy_fill` 1, on the real faithful cast (after the bake-order fix).
- **Result:**

  | | `skyS` 0.5 | `skyS` 1 | `S` thrown away |
  |---|---|---|---|
  | curtain 1 | ×1.008 | ×1.053 | ×0.957 |
  | tent 1 (its own `skyF`) | ×1.012 | | ×0.81 |

  The beam through the gaps is most of the cloth's light; the leaves' diffuse light adds about 5 %.
- **The measurement on the wrong frame:** first read as ×2.0 at 1 and ×1.5 at 0.5 (and ×1.53 against an expected ×1.3), on the faithful cast's first frame, which was baked before its own source existed: a beam with no sun in it. With the bake order fixed the ratio is ×1.008 and the expectation holds. See [dead-ends](dead-ends.md#receivers).
- **What it established:** a frame measured for a claim has to be the frame the engine really shows; the harness now holds every faithful look's unaided frame against its re-baked one.
- **Date:** 2026-10-07 afternoon (bug a) (from the bot's log, uncommitted source).

## sky-view

### The seen source is the sampler's

- **What was measured:** the seen field's core:halo energy split against the sampler's weights.
- **On:** clear, hazy and overcast.
- **Result:** matches to 0.08 %.
- **What it established:** cloud drains the seen disk into the aureole by exactly what it softens the dapples by.
- **Date:** not recorded.

### Wood as geometry

The closed-form ray/segment closest approach is verified against dense sampling to 3·10⁻¹⁰ m.

### The authored levels

- **What was measured:** the seen sky, crown and disk levels at the shipped daylight setting, and the glare's cost.(only `canopy 1` is named; "a dark preset" is not)
- **Result:** open sky lands at sRGB (184, 208, 232), luminance 205, against the thinnest sunlit crown's 197; the disk clips white. `glow_bleed` at 0.35 costs a daylight sky 13 sRGB levels and takes a dark preset's (81, 109, 157) to (68, 93, 138). The disk's gain over the glow: `L_core` ≈ 65 on `canopy 1` (`W_core` 0.76, r 0.27°), 6 stops over a lossless diffuser lit by the same sun, where physically it is about 5·10⁴ (≈ 1.6·10⁹ against 10⁵ lux/π ≈ 3·10⁴ cd/m², 15.6 stops); the engine compresses it by about 9½ stops. A sun disk is about 10⁶ times a blue sky's radiance (physical).
- **What it established:** the absolute levels are **Authored**, and the glare is a compressed stand-in for a contrast the pipeline cannot carry.
- **Date:** not recorded.

### Telescoping

`Σ_L (Π_{M<L} t_M)(1 − t_L) = 1 − Π t` holds to a maximum deviation of 2·10⁻¹⁶ over 200 000 random four-layer stacks. The lantern's identity along the sun's ray holds to 1e−12 over 10⁴ random stacks.

### Wood darkens, the slab brightened

- **What was measured:** a bare twig's seen luminance against the sky, with wood in its own texture and when wood rode the scatter channel.
- **On:** a shipped-daylight sky of luminance 198.
- **Result:**

  | `branch_tau` | wood in its own texture | wood in the scatter channel |
  |---|---|---|
  | 2.2 | 63 | 216 |
  | 3.2 | 31 | 217 |
  | 5.0 | 10 | 217 |

  A ray meeting nothing but wood emits exactly 0 at every `sky_scatter` up to 1 and every `leaf_diffuse`.
- **What it established:** an opaque occluder in the scatter channel glows; with the split, wood can only darken. Moving wood to its own texture changed no byte of any frame at `leaf_diffuse` 0 (canopy 1–4 pinned).
- **Date:** overnight 2026-10-06 → 07 (P0c-sky) (from the bot's log, uncommitted source).

### The look-up ray against its reference

- **What was measured:** `T`, `T_src` and the glow from a program built of exactly the engine's snippets, against `skyRayRef` on a readback of the same taps.
- **On:** 1024 fixed eye rays, the sky camera's own sun path, the layers and wood the engine baked; `leaf_diffuse` 0, 0.5 and 0.95 on `canopy 1`–`4`.
- **Result:** worst error 1.6·10⁻⁴ (half-float storage; tolerance 10⁻³). Rays whose disk a leaf put out, rays with a lit leaf, rays the wood is in the way of: 20–91 of 1024. A wrong wood read, a throughput that drops wood, a beam that ignores coverage, a sun path that ignores wood, or wood in the emission each move it by 0.06–0.8. The slab in place of the mixture moves `T` by 0.21–0.24, `T_src` by 0.30–0.50 and the glow by 0.09–0.52 at every `d` above 0, and nothing at 0. Before P0c-edge the worst error was 2.5·10⁻⁴ (from the bot's log, uncommitted source).
- **What it established:** the camera's ray is what the model says.

The lantern's rim, the same error as the floor's halo, is under [leaf](#leaf).

## motion

### The spectrum of wind

From the literature, not measured here: a Kolmogorov −5/3 spectrum in the gust range gives a per-octave gain `2^(−H)` with `H` = 1/3; turbulence intensity σ/U is about 0.1 in calm, 0.2 in open country, higher under a canopy; a gust's rise is sharper than its decay by about 1.35×, validated in the field.

### Inner leaves in wind

The slip of an inner leaf from its limb is under [canopy](#canopy).

No other motion measurement is recorded.

## transitions

### The bloom cap

- **What was measured:** the largest frame-to-frame mean-luminance step of a structural transition, as a multiple of a live morph's, and the per-pixel churn.
- **On:** the transition harness; the measured mode-flip and topology-dissolve routes (looks not recorded).
- **Result:**

  | route | uncapped bloom | capped |
  |---|---|---|
  | mode flip | 11.6× a live morph's step | 2.9× |
  | topology dissolve | 3.8× | 1.1× |

  Uncapped, a bright look bloomed to luma 249 of 255 and held there for eight frames. By churn (per-pixel change between frames, read against the frame's contrast) the swap frame scored 3.6× what a live morph's whole transition does.
- **What it established:** full overcast floods rather than dissolves; the two tiers want different depths; a swap luminance cannot see is still a cut, so a topology change that can reorganise crossfades two groves in shared layers.
- **Date:** not recorded.

### The shared-layer crossfade's cloud

- **What was measured:** effective cloud thickness through a shared-layer crossfade under the former 0.20 bloom.
- **On:** `morning 1` ↔ `memories`.
- **Result:** the halo widened toward 30° and cloud overshot both authored ends to about 0.426 before settling at 0 or 0.39.
- **What it established:** two reorganising leaf fields need no cloud cover; the bloom was removed from that tier.
- **Date:** not recorded.

### Faithful scene dissolves

- **What was measured:** the largest frame-to-frame mean-luminance step (0–255) before and after dissolving complete moving scenes in linear display light.
- **On:** José's projector looks (arboretum), 640×360 at 60 fps on Metal, authored 1024 bakes, 32 source samples.
- **Result:**

  | route | before | after |
  |---|---|---|
  | cherry green → green 2 | 127.14 | 0.87 |
  | green 2 → ultraviolet | 23.43 | 0.59 |

- **Date:** not recorded.

### Leaf travel between faithful groves, against the scene dissolve

- **What was measured:** the same three pairs by the scene dissolve (A) and by leaf travel (B): the frame's mean luma (Rec.709 on sRGB, 0–255) against the straight line between the settled ends, the largest frame-to-frame step (mean |Δ| over RGB), each carrier's plan travel, and the frame cost.
- **On:** José's projector and rainbow looks (arboretum, faithful overhead floor looks, as authored), 1280×720 at 60 fps on Metal, a pumped clock, `auto_quality` and `adaptive_motion` off, a 10 s route; the engine before the hood faded, so P1's hood swept in (it accounts for B's dip there). P1: a sparse three-layer grove to a dense four-layer one, with a tone change and the hood turning on. P2: a new seed, leader and maple outline, density down from 2.4 to 1. P3: the maple back to the ellipse outline, four layers to three, with a sun and tone change. Cost on a GPU shared with another render: upper bounds.
- **Result:**

  | pair | route | excursion above / below the line | largest step | carriers | travel median / p95 (of a 3.1 m view) | route ms, median / p95 |
  |---|---|---|---|---|---|---|
  | P1 | A | +26.4 / −0.2 | 3.96 | | | 27.2 / 33.9 |
  | P1 | B | +9.2 / −26.1 | 3.94 | 46 530 | 0.31 m / 0.76 m | 29.0 / 46.3 |
  | P2 | A | +7.2 / −0.2 | 1.25 | | | 28.0 / 38.3 |
  | P2 | B | +4.8 / −7.4 | 1.45 | 46 530 | 0.73 m / 1.55 m | 34.4 / 53.6 |
  | P3 | A | +10.1 / 0.0 | 1.50 | | | 20.8 / 33.9 |
  | P3 | B | +5.9 / −6.6 | 1.89 | 32 175 | 0.73 m / 1.53 m | 27.4 / 38.0 |

  Every largest step is within about 1.7× the settled looks' own motion; no step stands out at the handoffs or where the drawn native scene switches. B lands on the target loaded fresh (max 0). Over the 29 faithful overhead looks in arboretum, all 426 ordered pairs the dissolve took pass leaf travel's gate. A target at 8 samples, a 512 bake or texture, or leaf variety 0.9 also lands with no spike (largest steps 1.88, 1.52, 1.45, 1.47 against 1.45).
- **What it established:** leaf travel joins these pairs without a dissolve of pictures; its motion is busier where the seed changes (a typical leaf moves a quarter of the view), and its middle is softer than either end (the moving cast's texel, about 9.8 mm against a 2.4 mm pixel at a 1024 bake).
- **Date:** 2026-11-10.

### The midpoint grove against the look loaded fresh

- **What was measured:** the landed frame of a route that regrows its grove at the midpoint, against the target loaded fresh (max and mean |difference| over RGB, 0–255).
- **On:** the harness, 320×180, `sample_count` 8, 256 textures and bakes, wind 0, `drift_amount` 0, automatic drift and quality off, a 1 s route (`test-gl/dissolve-landing.mjs`).
- **Result:**

  | route | before | after |
  |---|---|---|
  | `morning 3b → eclipse` (cloud dissolve) | max 141, mean 12.2 | max 0 |
  | `afternoon 7 → park 1` (lit ground) | max 0 | max 0 |
  | `park 1 → afternoon 7` (lit ground, camera settled) | max 0 | max 0 |

  The grove was grown once, under the bloom, while the MORPH parameters were still tweening. `view_extent_m` is one of them and sizes a park crown (3.65 grown, between 3.1 and 4.2; `eclipse`'s crown cap is 3.91), and nothing regrew it. Regrowing alone made the landed frame equal the fresh one. The grove is now grown from the target's own value of every parameter it reads, while the picture keeps tweening.
- **Still open, measured under the same conditions:** the shared-layer crossfade grows its incoming grove at the start from the outgoing MORPH values (`morning 1 → memories` with the target's `view_extent_m` at 2.5: max 206, mean 23.0; 27 shipped pairs differ in the crown this sets). A live morph that changes only `view_extent_m` never regrows (`afternoon 7` to itself at 2.5: max 170, mean 16.6). In still air with automatic drift off and `drift_amount` up, the layer bake made at the midpoint keeps that frame's `drift_phase` through landing (`morning 3b → eclipse` max 109, `park 1 → afternoon 7` max 140); one re-bake after landing makes each equal.
- **Date:** 2026-11-10.

### The eclipse pairs: the cloud dissolve against the moon

- **What was measured:** for `morning 3b → eclipse` (P1) and `eclipse → acid dreams` (P2), the route as shipped before (the cloud dissolve, bloom 0.55, `eclipse` flipped at the midpoint) against the variant José chose (B3: the crossfade across layer counts, each grove with its own leaf edge and grown from its own look, the moon on a path giving the visible bite four fifths of it, its limb soft while it moves). Excursion is the mean luminance's departure from the straight line between the two ends; steps are mean |frame n − frame n−1| in 8-bit levels.
- **On:** the prototype review (`test-gl/out/review/2026-11-10-eclipse-transitions/pass2/`, git-ignored): 1280×720 at 60 fps on Metal, the looks as authored with automatic quality and adaptive motion off, the route called at frame 120 with a 5 s driver (a 10 s route), landing at frame 720. These are the prototype's numbers, not the engine's as built.
- **Result:**

  | pair | route | excursion above / below the line | largest step (frame) |
  |---|---|---|---|
  | P1 | cloud dissolve | +74.9 / −3.3 | 13.09 (f420, the swap) |
  | P1 | B3 | +28.8 / −7.2 | 6.36 (f570, the window's close) |
  | P2 | cloud dissolve | +60.5 / −6.5 | 67.32 (f420, the swap) |
  | P2 | B3 | +29.2 / −21.1 | 0.95 (f410) |

  P1's remaining step at the window's close is the sample count (32 → 48), about 4.2 of it in the prototype's ablation; settled backgrounds are up to 4.1 for `morning 3b`, about 0.3 for `eclipse` and 0.6 for `acid dreams`.
- **As built** (`test-gl/eclipse-crossfade.mjs`: SwiftShader, 320×180, 256 textures and bakes, still air with `drift_amount` 0, a 2 s driver): both pairs land byte-equal to the target loaded fresh, a zero-time redraw at the start equals the outgoing look, no step coincides with a jump in the sampled source (largest single-frame change of any point-sun's weight 0.0067 of the total), and the settled `eclipse` is byte-equal to the engine before the change. The sample-count step at P1's window close is 4.51 against a neighbouring median of 0.86, the route's largest. With the limb's softness on the eased clock, as the prototype had it, P2 showed one spike near the bitten end (0.36 levels, a point-sun moving 0.016 of the total in one frame), because the band closed faster than the moon slowed on this shorter route; on the route's raw clock it shows none.
- **What it established:** the bloom is gone from both pairs at less than half the excursion; what is left is the sample-count handoff, an open item.
- **Date:** 2026-11-10.

### A seasonal yaw

`montebello`'s 208.5° to `park fall`'s −161.797° is a 10.30° turn by the shortest arc (arithmetic).

## harness

### Bundle sizes

- **What was measured:** the deploy bundles' sizes by ablation as each cut landed.
- **Result, the camera pruning** (15 shipped looks, when it landed): the shipped-look bundle 87 kB raw / 25 kB gzip against the old 191 / 60; the eljojo.net four-look set 74 / 24. Shader prose being shipped: about 64 kB. The editor tier, unfolded, shipped 7.6 kB raw / 3.1 kB gzip in every bundle.
- **Result, the fall tiers** (homepage set `morning 2`, `afternoon 5b`, `morning 3`, gzip):

  | build | kB gzip |
  |---|---|
  | before the phase | 36.0 |
  | every tier kept | 35.6 |
  | the orphan sweep alone | 35.1 |
  | every tier cut | 28.4 |

  | tier alone | + kB gzip |
  |---|---|
  | fill | 3.0 |
  | litter | 2.1 |
  | exposure with drop | 2.0 |
  | pigment | 0.4 |
  | drop alone | 0.3 |
  | leaf_diffuse | 0.2 |

  The fall tiers together cost +7.1 kB gzip on the homepage set; the sweep is worth −0.8 kB gzip on every bundle. The player: 37.8 kB before, 37.3 after (36.9 with the sweep alone); it keeps every tier because `montebello` opens all six.
- **Result, later additions:** `leaf_variety`'s pass, which no cut sees, grew the homepage set by +4.6 kB raw / +2.0 kB gzip (88.5 → 93.3 kB raw, 30.4 → 32.5 kB gzip, with the aspect law and the recalibrated maple's 0.2 kB) and the player by +2.5 kB raw. The lantern phase cost the player +1.0 kB raw / +0.16 kB gzip. From the bot's log, uncommitted source: the beech's outlines +394 B gzip on the homepage; `placeLeaf` +862 B gzip (29 051 → 29 913); the player 26.0 → 33.8 kB gzip over the first fall phases; the strip design's estimate 32.4 → 23.5 kB.
- **What it established:** every cut is answerable from the tables; the lasting win is a per-page bundle.
- **Date:** the fall-tier strip 2026-10-07 evening (from the bot's log, uncommitted source); others not recorded.

### Uniform rows

The four-in-one shader declared 246 vec4 rows of uniforms against WebGL2's guaranteed 224. Split by camera, the variants stand at 85 / 94 / 101 / 30 rows (floor / cloth / enclosure / sky, in the order the old spec lists them); the segment table, as two vec4 arrays at its original 64-segment capacity, would have been 128 rows in every camera (the table is now 256 segments).

### Regrow and re-season timings

- **What was measured:** the CPU cost of a grove change.
- **On:** bun, median of 11, a fall frame at t 0.9, regrow against re-season, unless stated.
- **Result:**

  | look | fall regrow | re-season | summer regrow |
  |---|---|---|---|
  | afternoon 7 | 62 ms | ~6 ms | 15 ms |
  | the void | 154 ms | ~14 ms | 47 ms |
  | montebello | 12 ms | ~1 ms | 3.3 ms |

  Keeping the per-leaf record costs about 5 ms and 7 MB a regrow. The tie-break's keyed rank on `canopy 2`'s 88 k leaves takes 21 ms against the keyless 14, and the whole exposure pass 37 ms against 28. `leaf_variety`'s first `leafShape(maple, seed, 1)` costs 30–40 ms, and a regrow with its pass costs ×2.4–2.7 in a summer (median of seven on afternoon 7, 32 k leaves: 50 ms against 19) and ×1.16 in a fall; a canopy morph between two varied looks pays that every frame. Before re-seasoning, a fall regrow cost about 4× summer, so afternoon 7 and the void fell back to regrow-on-release past the turn (from the bot's log, uncommitted source).
- **What it established:** the season is a function of the grove, not a regrow; every floor look plays the fall live.
- **Date:** 2026-10-07 evening (P2b) (from the bot's log, uncommitted source).

### Memory

| allocation | size |
|---|---|
| litter carpet, RGBA8 | 4.0 MiB at 1024 (5.3 with mips), 16 MiB at 2048 (21.3), 1 MiB at 512 (1.3), 4 bytes when off |
| sky view's wood textures, R16F per layer | +18 MiB on canopy 1–3 at a 1536 bake, +32 MiB on canopy 4 at 2048; 8 bytes on a floor look |
| `leaf_variety`'s outline texture | 256 × 64 R16F, 32 KB |
| season record | about 7 MB a regrow|

### The profiler's findings

- An offscreen stress burst measured idealised GPU throughput the driver can collapse, and over-reported spare capacity; it was abandoned for timer queries over real on-screen frames, and survives only as a fallback.
- The bake is co-dominant with transport on the windy looks, so a capable machine could sit at 60 fps and still run hot; `auto_quality` now trims bake resolution below the knee.
- The adaptive frame-rate's win, as a frame-skip fraction, is about 0 on a genuinely windy look and high on a calm one.
- On `faithful_canopy` looks the per-sample geometry bake is the whole cost and resolution buys almost nothing.

Per-look figures are not recorded.

### The harness itself

From the bot's log, uncommitted source: memoised renders and eight ticks (from 24/60) cut a full pixel run from 2000 to 1489 s with every hash identical (2026-10-08). The grove fixtures differ between macOS and Linux because JavaScriptCore's transcendental functions are the system libm's, 1–2 ulp apart (tan on 837 and hypot on 861 of 2000 inputs; the `oak` grove moves by at most 1.8·10⁻¹⁵ m), so the fixtures are keyed by platform. A `branch_droop` of 0.3 lands on a .5 rounding edge and grew 819 or 843 segments depending on JIT warm-up; the fixture was moved off it. The maze's wall-clock assertion (grow and raster under 1.5 s) failed at 1.99 s on a busy Linux host.

### The video exporter

From CLAUDE.md, the exporter's working figures:

| quantity | value |
|---|---|
| default | 1080p60, the look as authored |
| delivery | HEVC at 60 Mbit/s (`-b:v 60M -maxrate 75M`), about 2 GB for five minutes, playable from a FAT32 stick |
| FAT32 limit warned against | 4 GiB |
| lossless master | about 0.8 GiB per 20 s at 1080p, 2.6 GiB at 4K |
| VA-API rate control | fixed 60M / 75M / 120M |
| parallel sessions | `--jobs` 1..8; blocks of consecutive segments, cap 4 by default |

José picked T1 (bt709) for the video tags, by a hair (2026-10-10, from the bot's log, uncommitted source). The parallel renderer's tiny-engine state across fades, its VRAM at N sessions and its speed-up are **unmeasured** until `compare-runs.mjs` says so on a GPU host.

## Related

- [`observations.md`](observations.md): what José saw, his photographs, and the dated decisions these numbers fed.
- [`dead-ends.md`](dead-ends.md): the approaches these measurements retired.
- [`../model/overview.md`](../model/overview.md): the model each section evidences.
- [`../contracts/conservation.md`](../contracts/conservation.md): the energy bounds the fill and sky-view books hold.
- [`../implementation.md`](../implementation.md): where the tests and rows named here live.
